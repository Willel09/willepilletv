import { Worker } from 'node:worker_threads'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, session, shell } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { stat } from 'fs/promises'
import { fileURLToPath, pathToFileURL } from 'url'
import { join } from 'path'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import { DEFAULT_SETTINGS, STORE_DEFAULTS, type CastMedia, type DownloadRequest, type Settings, type StoreShape, type UpdateState } from '../shared/types'
import { xtreamInfo } from '../shared/core/xtream'
import { discoverCast, startCast, stopCast } from './cast'
import { Downloads } from './downloads'
import { registerScheme, serveDownloads } from './dlprotocol'
import { probeStream } from '../shared/core/probe'
import { getBytes, getText } from './http'
import { devModeOn, discoverTvs, localIps, openTvInstaller } from './tvinstall'

registerScheme() // lumen-dl:// plays downloaded files, see downloads.ts

// Lets <video> expose audioTracks for multi-language MP4/MKV files
app.commandLine.appendSwitch('enable-blink-features', 'AudioVideoTracks')

// cast: electron-store's dotted-path typing can't express Record<> fields in SyncMeta
const store = new Store<StoreShape>({ name: 'lumen', defaults: STORE_DEFAULTS as never })
// v1.0 stored theme as 'dark' | 'light'
const LEGACY_THEME: Record<string, string> = { dark: 'graphite', light: 'daylight' }
const settings = (): Settings => {
  const s = { ...DEFAULT_SETTINGS, ...store.get('settings') }
  return { ...s, theme: LEGACY_THEME[s.theme] ?? s.theme }
}

let win: BrowserWindow | null = null
let downloads: Downloads

const isWin11 = process.platform === 'win32' && Number(process.getSystemVersion().split('.')[2] ?? 0) >= 22000

function createWindow() {
  const s = settings()
  nativeTheme.themeSource = s.theme === 'daylight' || s.theme === 'sand' ? 'light' : 'dark'
  const material = isWin11 && s.material !== 'none' ? s.material : undefined
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    // 'hidden' keeps native resize/snap but removes the title bar; we draw glass window buttons ourselves
    titleBarStyle: 'hidden',
    frame: process.platform === 'win32',
    backgroundColor: material ? '#00000000' : '#08080c',
    backgroundMaterial: material,
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
  })
  win.once('ready-to-show', () => win?.show())
  const sendState = () => win && send('win:state', { maximized: win.isMaximized(), fullscreen: win.isFullScreen() })
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) win.on(ev as 'maximize', sendState)
  // Never navigate the app window away; open links in the browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // only the app's own page (a reload), never another local file or site
  const page = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href
  win.webContents.on('will-navigate', (e, url) => {
    if (url.split(/[?#]/)[0] !== page.split(/[?#]/)[0]) e.preventDefault()
  })
  win.loadURL(page)
}

/**
 * IPTV servers rarely send CORS headers and often reject browser user agents.
 * Rewrite stream/image requests so hls.js and mpegts.js can fetch them from the renderer.
 */
function patchNetworking() {
  const filter = { urls: ['http://*/*', 'https://*/*'] }
  const local = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u)
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (d, cb) => {
    if (local(d.url)) return cb({})
    const h = d.requestHeaders
    h['User-Agent'] = settings().userAgent || DEFAULT_SETTINGS.userAgent
    delete h.Origin
    delete h.Referer
    cb({ requestHeaders: h })
  })
  session.defaultSession.webRequest.onHeadersReceived(filter, (d, cb) => {
    if (local(d.url)) return cb({})
    const h = d.responseHeaders ?? {}
    for (const k of Object.keys(h)) if (k.toLowerCase().startsWith('access-control-')) delete h[k]
    h['Access-Control-Allow-Origin'] = ['*']
    h['Access-Control-Allow-Headers'] = ['*']
    h['Access-Control-Allow-Methods'] = ['GET, HEAD, OPTIONS']
    h['Access-Control-Expose-Headers'] = ['*']
    cb({ responseHeaders: h, statusLine: d.method === 'OPTIONS' ? 'HTTP/1.1 200 OK' : d.statusLine })
  })
}

/** To the window, if it's still open: the updater and the library worker keep going after it's closed */
const send = (channel: string, v: unknown) => win && !win.isDestroyed() && win.webContents.send(channel, v)
const progress = (m: string) => send('progress', m)
const get = (url: string, timeoutMs?: number) => getText(url, settings().userAgent, timeoutMs)
const STORE_KEYS = Object.keys(STORE_DEFAULTS) as (keyof StoreShape)[]

/** Library and guide work runs in a worker thread, see worker.ts */
let worker: Worker | null = null
let cancelling = false
let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
function work<T>(op: string, ...args: unknown[]): Promise<T> {
  if (!worker) {
    cancelling = false
    worker = new Worker(join(__dirname, 'worker.js'), { workerData: { dir: app.getPath('userData') } })
    const w = worker
    w.on('message', (m: { id?: number; progress?: string; result?: unknown; error?: string; fetch?: { rid: number; url: string; timeoutMs?: number } }) => {
      if (m.progress !== undefined) return progress(m.progress)
      // downloads for the worker go through Chromium's network stack here; the bytes are handed over, not copied
      if (m.fetch) {
        const { rid, url, timeoutMs } = m.fetch
        // local files: picked playlists, or XMLTV guide files (Settings > Extra guide URL), nothing else
        if (!/^https?:\/\//i.test(url) && !playlistFiles.has(url) && !/\.(xml|xmltv)(\.gz)?$/i.test(url)) return void w.postMessage({ rid, error: 'Not a playlist or guide file' })
        getBytes(url, settings().userAgent || DEFAULT_SETTINGS.userAgent, timeoutMs).then(
          (bytes) => w.postMessage({ rid, bytes }, [bytes.buffer as ArrayBuffer]),
          (e: Error) => w.postMessage({ rid, error: e.message })
        )
        return
      }
      const p = pending.get(m.id!)
      pending.delete(m.id!)
      if (m.error) p?.reject(new Error(m.error))
      else p?.resolve(m.result)
    })
    // a worker that dies (error, or out of memory) must not leave the app 'Loading…' forever
    const died = (e: Error) => {
      for (const p of pending.values()) p.reject(e)
      pending.clear()
      if (worker === w) worker = null
    }
    w.on('error', died)
    w.on('exit', (code) => died(new Error(cancelling ? 'Refresh cancelled' : `The library worker stopped (code ${code}). Try Refresh.`)))
  }
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    worker!.postMessage({ id, op, args })
  })
}

/** Local playlist files the window may read: chosen in the file dialog, or already sources at start */
const playlistFiles = new Set<string>()

function registerIpc() {
  for (const s of store.get('sources')) if (s.kind === 'm3u' && s.url && !/^https?:\/\//i.test(s.url)) playlistFiles.add(s.url)
  ipcMain.on('app:version', (e) => (e.returnValue = app.getVersion()))
  ipcMain.handle('store:all', () => ({ ...STORE_DEFAULTS, ...store.store, settings: settings() }))
  ipcMain.handle('store:set', (_e, key: keyof StoreShape, value: unknown) => {
    if (!STORE_KEYS.includes(key)) throw new Error(`Unknown store key ${key}`)
    store.set(key, value as never)
  })
  ipcMain.handle('library:get', () => work('get'))
  ipcMain.handle('library:refresh', () => work('refresh', store.get('sources'), settings()))
  // Cancel: stop the worker. Nothing was written yet (the cache is saved at the end), so the library stays as it
  // was; the next request starts a fresh worker that reads it again.
  ipcMain.on('library:cancel', () => {
    if (!worker) return
    cancelling = true
    void worker.terminate()
  })
  ipcMain.handle('library:part', (_e, list: string, from: number, gen: number) => work('part', list, from, gen))
  ipcMain.handle('epg:get', () => work('epgGet'))
  ipcMain.handle('epg:refresh', () => work('epgRefresh', settings()))
  ipcMain.handle('media:info', (_e, sourceId: string, kind: 'movie' | 'series', id: number) => {
    const src = store.get('sources').find((x) => x.id === sourceId)
    if (!src || src.kind !== 'xtream') return {}
    return xtreamInfo(src, kind, id, get)
  })
  ipcMain.handle('dialog:playlist', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Choose a playlist',
      properties: ['openFile'],
      filters: [{ name: 'Playlists', extensions: ['m3u', 'm3u8', 'txt'] }]
    })
    if (r.canceled) return null
    playlistFiles.add(r.filePaths[0])
    return r.filePaths[0]
  })
  ipcMain.handle('file:read', async (_e, path: string) => {
    // only files the user picked in the file dialog (or that were sources when the app started): the window
    // can write any source list to the store, so the store alone can't vouch for a path
    if (!playlistFiles.has(path) || !store.get('sources').some((s) => s.kind === 'm3u' && s.url === path)) throw new Error('Not a playlist source')
    const st = await stat(path.startsWith('file:') ? fileURLToPath(path) : path)
    return { text: await get(path), sig: `${st.mtimeMs}:${st.size}` }
  })
  ipcMain.handle('media:probe', (_e, url: string) =>
    /^https?:\/\//i.test(url) ? probeStream(url, (u, init) => net.fetch(u, init), settings().userAgent || DEFAULT_SETTINGS.userAgent) : { status: 0, codecs: [] }
  )
  ipcMain.handle('cast:discover', () => discoverCast())
  ipcMain.handle('cast:start', (_e, id: string, media: CastMedia) => startCast(id, media, settings().userAgent || DEFAULT_SETTINGS.userAgent))
  ipcMain.handle('cast:stop', () => stopCast())
  ipcMain.handle('vlc:open', (_e, url: string, title: string) => {
    // Only hand real stream URLs to VLC so a crafted playlist entry can't pass VLC command-line options
    if (!/^(https?|rtmp|rtsp|rtp|udp|mms):\/\//i.test(url)) return { ok: false, error: 'This stream address cannot be opened in VLC.' }
    const s = settings()
    const candidates = [
      s.vlcPath,
      'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
      'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
      '/Applications/VLC.app/Contents/MacOS/VLC',
      '/usr/bin/vlc',
      '/snap/bin/vlc'
    ].filter(Boolean)
    const exe = candidates.find((p) => existsSync(p))
    if (!exe) return { ok: false, error: 'VLC was not found. Install it from videolan.org or set its path in Settings.' }
    spawn(exe, [url, `--http-user-agent=${s.userAgent}`, `--meta-title=${title}`], { detached: true, stdio: 'ignore' }).unref()
    return { ok: true }
  })
  ipcMain.handle('dl:list', () => downloads.state())
  ipcMain.handle('dl:add', (_e, reqs: DownloadRequest[]) => (Array.isArray(reqs) ? downloads.add(reqs.slice(0, 500)) : { added: 0 }))
  ipcMain.handle('dl:pause', (_e, id: string) => downloads.pause(String(id)))
  ipcMain.handle('dl:resume', (_e, id: string) => downloads.resume(String(id)))
  ipcMain.handle('dl:remove', (_e, id: string) => downloads.remove(String(id)))
  ipcMain.handle('dl:sizes', (_e, urls: string[]) => downloads.sizes(Array.isArray(urls) ? urls.slice(0, 20).map(String) : []))
  ipcMain.handle('tv:ips', () => localIps())
  ipcMain.handle('tv:discover', () => discoverTvs())
  ipcMain.handle('tv:devmode', (_e, ip: string) => devModeOn(String(ip)))
  ipcMain.handle('tv:installer', () => openTvInstaller(progress))
  ipcMain.on('win:minimize', () => win?.minimize())
  ipcMain.on('win:toggleMaximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()))
  ipcMain.on('win:close', () => win?.close())
  ipcMain.on('win:fullscreen', (_e, on: boolean) => win?.setFullScreen(on))
  // Mica/Acrylic tint follows nativeTheme, so keep it in step with the app theme
  ipcMain.on('win:theme', (_e, mode: 'dark' | 'light') => (nativeTheme.themeSource = mode))
  ipcMain.on('update:check', () => checkForUpdates())
  ipcMain.on('update:install', () => autoUpdater.quitAndInstall(false, true))
  ipcMain.on('win:material', (_e, m: Settings['material']) => {
    if (!isWin11 || !win) return
    win.setBackgroundMaterial(m === 'none' ? 'none' : m)
    win.setBackgroundColor(m === 'none' ? '#08080c' : '#00000000')
  })
}

/**
 * Auto-update from GitHub Releases (electron-builder publishes latest.yml next to the installer).
 * Downloads in the background; the UI offers "Restart to update", otherwise it installs on quit.
 */
function sendUpdate(s: UpdateState) {
  send('update:state', s)
}
function checkForUpdates() {
  if (!app.isPackaged) return sendUpdate({ status: 'unsupported' })
  autoUpdater.checkForUpdates().catch((e) => sendUpdate({ status: 'error', message: String(e?.message ?? e) }))
}
function setupUpdater() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => sendUpdate({ status: 'checking' }))
  autoUpdater.on('update-not-available', () => sendUpdate({ status: 'none' }))
  autoUpdater.on('update-available', (i) => sendUpdate({ status: 'available', version: i.version }))
  autoUpdater.on('download-progress', (p) => sendUpdate({ status: 'downloading', version: '', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => sendUpdate({ status: 'ready', version: i.version }))
  autoUpdater.on('error', (e) => sendUpdate({ status: 'error', message: e.message }))
  if (!app.isPackaged) return
  setTimeout(checkForUpdates, 8000)
  setInterval(checkForUpdates, 4 * 3600_000)
}

// One Lumen at a time: two would write library.json and the settings at once. A second start focuses this one.
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

app.whenReady().then(() => {
  app.setAppUserModelId('app.lumen.iptv')
  patchNetworking()
  downloads = new Downloads(join(app.getPath('userData'), 'downloads'), () => settings().userAgent || DEFAULT_SETTINGS.userAgent, () => settings().downloadLimitGb, (st) => send('dl:state', st), (input, init) => net.fetch(input instanceof URL ? input.href : input, init))
  serveDownloads(downloads.dir)
  registerIpc()
  createWindow()
  setupUpdater()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('before-quit', () => downloads?.save()) // a download cut short continues from the file's size next time
app.on('window-all-closed', () => app.quit())
