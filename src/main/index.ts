import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import { DEFAULT_SETTINGS, STORE_DEFAULTS, type Library, type Settings, type StoreShape, type UpdateState } from '../shared/types'
import { buildEpg, buildLibrary, emptyLibrary } from '../shared/core/library'
import { xtreamInfo } from '../shared/core/xtream'
import { getText } from './http'
import { readCache, writeCache } from './library'
import { devModeOn, discoverTvs, localIps, openTvInstaller } from './tvinstall'

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
let library: Library | null = null

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
  const sendState = () => win?.webContents.send('win:state', { maximized: win.isMaximized(), fullscreen: win.isFullScreen() })
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) win.on(ev as 'maximize', sendState)
  // Never navigate the app window away; open links in the browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file:')) e.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
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

const progress = (m: string) => win?.webContents.send('progress', m)
const get = (url: string, timeoutMs?: number) => getText(url, settings().userAgent, timeoutMs)
const STORE_KEYS = Object.keys(STORE_DEFAULTS) as (keyof StoreShape)[]

function registerIpc() {
  ipcMain.on('app:version', (e) => (e.returnValue = app.getVersion()))
  ipcMain.handle('store:all', () => ({ ...STORE_DEFAULTS, ...store.store, settings: settings() }))
  ipcMain.handle('store:set', (_e, key: keyof StoreShape, value: unknown) => {
    if (!STORE_KEYS.includes(key)) throw new Error(`Unknown store key ${key}`)
    store.set(key, value as never)
  })
  ipcMain.handle('library:get', async () => (library ??= await readCache<Library>('library')))
  ipcMain.handle('library:refresh', async () => {
    library = await buildLibrary(store.get('sources'), settings(), get, progress)
    await writeCache('library', library)
    return library
  })
  ipcMain.handle('epg:get', () => readCache('epg'))
  ipcMain.handle('epg:refresh', async () => {
    library ??= await readCache<Library>('library')
    const epg = await buildEpg(library ?? emptyLibrary(), settings(), get, progress)
    await writeCache('epg', epg)
    return epg
  })
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
    return r.canceled ? null : r.filePaths[0]
  })
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
  win?.webContents.send('update:state', s)
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

app.whenReady().then(() => {
  app.setAppUserModelId('app.lumen.iptv')
  patchNetworking()
  registerIpc()
  createWindow()
  setupUpdater()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => app.quit())
