// window.api for Samsung Tizen TVs and plain browsers. Electron uses its preload instead.
// Same core loaders as the desktop app; networking happens in-page (Tizen allows cross-origin
// requests for packaged apps via <access origin="*"> in config.xml).

import { Gunzip, gunzipSync } from 'fflate'
import { buildEpg, buildLibrary, emptyLibrary } from '../../../shared/core/library'
import { HTTP_HINT, type GetStream } from '../../../shared/core/net'
import { xtreamInfo } from '../../../shared/core/xtream'
import { pullFile } from '../lib/sync'
import { DEFAULT_SETTINGS, STORE_DEFAULTS, type Epg, type IptvApi, type Programme, type Library, type StoreShape, type UpdateState } from '../../../shared/types'

declare const __APP_VERSION__: string
/** Set by the TV/web OTA loader (public/boot.js) */
declare global {
  interface Window {
    __LUMEN_BOOT__?: { manifestUrl: string; running: string }
    tizen?: { application: { getCurrentApplication(): { exit(): void } }; tvinputdevice?: { registerKey(k: string): void } }
  }
}

export const isTizen = () => typeof window.tizen !== 'undefined' || /Tizen/i.test(navigator.userAgent)

/* ---------- tiny IndexedDB key/value store for the (large) library + guide caches ---------- */
let dbp: Promise<IDBDatabase> | null = null
const db = () =>
  (dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('lumen', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('kv')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  }))
/** get: the value or null. put: the key, or null if it could not be stored. Never hangs: a value that is
    too large aborts the transaction without a request error, so the transaction's outcome is what counts. */
async function idb<T>(mode: 'get' | 'put', key: string, value?: unknown): Promise<T | null> {
  try {
    const tx = (await db()).transaction('kv', mode === 'get' ? 'readonly' : 'readwrite')
    const req = mode === 'get' ? tx.objectStore('kv').get(key) : tx.objectStore('kv').put(value, key)
    return await new Promise((res) => {
      tx.oncomplete = () => res((req.result as T) ?? null)
      tx.onabort = tx.onerror = () => res(null)
    })
  } catch {
    return null
  }
}

/* Chromium refuses single IndexedDB values over ~128 MB (less on older TVs); a 400k-title library is bigger.
   Big lists are stored in pieces under "<key>:<list>:<n>", the head (written last) says how many. */
const PIECE = 20_000
type Parts = { __parts?: Record<string, number> }

async function putBig(key: string, value: object, lists: string[]): Promise<void> {
  const head: Record<string, unknown> & Parts = { ...value, __parts: {} }
  // drop the old head first: if writing stops halfway it must not point at a mix of old and new pieces
  if ((await idb('put', key, null)) === null) return
  for (const name of lists) {
    const list = (value as Record<string, unknown[]>)[name]
    delete head[name]
    head.__parts![name] = Math.ceil(list.length / PIECE)
    for (let i = 0; i * PIECE < list.length; i++)
      if ((await idb('put', `${key}:${name}:${i}`, list.slice(i * PIECE, (i + 1) * PIECE))) === null) return // not cached; loads again next start
  }
  await idb('put', key, head)
}

async function getBig<T>(key: string): Promise<T | null> {
  const head = await idb<Record<string, unknown> & Parts>('get', key)
  if (!head?.__parts) return head as T | null // also values saved whole by older versions
  const { __parts, ...out } = head
  for (const [name, n] of Object.entries(__parts)) {
    const pieces: unknown[][] = []
    for (let i = 0; i < n; i++) {
      const piece = await idb<unknown[]>('get', `${key}:${name}:${i}`)
      if (!piece) return null
      pieces.push(piece)
    }
    out[name] = pieces.flat()
  }
  return out as T
}

/** Read back from IndexedDB, every item has its own copy of "movie", its category and source id
    (~30 MB across 600k items). Share them again. */
function shareStrings(lib: Library | null) {
  if (!lib) return lib
  const pool = new Map<string, string>()
  const one = (s: string) => pool.get(s) ?? (pool.set(s, s), s)
  for (const list of [lib.channels, lib.movies, lib.series] as unknown as { kind: string; sourceId: string; group: string }[][])
    for (const x of list) ((x.kind = one(x.kind)), (x.sourceId = one(x.sourceId)), (x.group = one(x.group)))
  return lib
}

// the guide's per-channel record is stored as a list of [channel, programmes] pairs so it can be split too
const putEpg = (epg: Epg) => putBig('epg', { ...epg, programmes: Object.entries(epg.programmes) }, ['programmes'])
const getEpg = async () => {
  const e = await getBig<Omit<Epg, 'programmes'> & { programmes: Epg['programmes'] | [string, Programme[]][] }>('epg')
  return e && { ...e, programmes: Array.isArray(e.programmes) ? Object.fromEntries(e.programmes) : e.programmes }
}

/* ---------- networking ---------- */
const read = <T,>(k: string): T | null => {
  try { return JSON.parse(localStorage.getItem(`lumen:${k}`) ?? 'null') as T } catch { return null }
}
/** An M3U file added on the PC: Lumen for Windows shares it through sync (see shareFiles in store.ts).
    shortcut: edits to the file reach this device on its next library refresh (Refresh or the auto-refresh timer), not instantly. */
async function syncedFile(path: string): Promise<string> {
  const code = read<StoreShape['sync']>('sync')?.code
  const src = read<StoreShape['sources']>('sources')?.find((s) => s.url === path)
  const text = code && src ? await pullFile(code, src.id) : null
  if (text == null) throw new Error('This playlist file is on your PC. Open Lumen on the PC with Sync turned on, and it will be shared with this device.')
  return text
}

async function open(url: string, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(url, { signal: ctl.signal })
  } catch {
    if (ctl.signal.aborted) throw new Error('The server took too long to respond.')
    if (location.protocol === 'https:' && url.startsWith('http:'))
      throw new Error('Browsers block http:// providers on secure pages. Use the Windows or TV app to play this source.')
    throw new Error(isTizen() ? "Couldn't reach the server. Check the address and your TV's internet connection." : "Couldn't reach the server. It may be offline, or it blocks browser apps (CORS).")
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error(HTTP_HINT(res.status, res.statusText))
  return res
}

async function getText(url: string, timeoutMs = 180_000): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return syncedFile(url)
  const res = await open(url, timeoutMs)
  // plain text straight from the browser: no second copy of a 50 MB playlist or JSON list
  if (!/\.gz(\?|$)/i.test(url) && !/gzip|octet-stream/i.test(res.headers.get('content-type') ?? '')) return res.text()
  const buf = new Uint8Array(await res.arrayBuffer())
  // fflate instead of DecompressionStream, which older TVs (Chromium < 80) don't have
  return new TextDecoder().decode(buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf)
}

/** The guide arrives in pieces (gunzipped on the fly), so a 100 MB XMLTV file never sits in memory whole */
const getStream: GetStream = async (url, onText, timeoutMs = 300_000) => {
  if (!/^https?:\/\//i.test(url)) return onText(await syncedFile(url))
  const res = await open(url, timeoutMs)
  if (!res.body) return onText(await res.text())
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let gz: Gunzip | null | undefined // undefined until the first bytes tell us
  // the request timeout only covers the headers: give up on a server that stalls mid-download
  const read = () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const stall = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('The server stopped sending data.')), 60_000)))
    return Promise.race([reader.read(), stall]).finally(() => clearTimeout(timer))
  }
  for (;;) {
    const { done, value } = await read().catch((e) => (reader.cancel().catch(() => {}), Promise.reject(e)))
    if (done) break
    if (gz === undefined) gz = value[0] === 0x1f && value[1] === 0x8b ? new Gunzip((d) => onText(dec.decode(d, { stream: true }))) : null
    if (gz) gz.push(value)
    else onText(dec.decode(value, { stream: true }))
  }
  if (gz) gz.push(new Uint8Array(0), true)
  onText(dec.decode())
}

/* ---------- OTA updates (TV + web): newer builds are published to GitHub Pages ---------- */
const updateListeners = new Set<(s: UpdateState) => void>()
const emitUpdate = (s: UpdateState) => updateListeners.forEach((cb) => cb(s))
const newer = (a: string, b: string) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}
async function checkOta() {
  const boot = window.__LUMEN_BOOT__
  if (!boot) return emitUpdate({ status: 'unsupported' })
  emitUpdate({ status: 'checking' })
  try {
    const m = (await (await fetch(`${boot.manifestUrl}?t=${Date.now()}`, { cache: 'no-store' })).json()) as { version: string }
    emitUpdate(newer(m.version, boot.running) ? { status: 'ready', version: m.version } : { status: 'none' })
  } catch {
    emitUpdate({ status: 'error', message: "Couldn't check for updates." })
  }
}

export function createWebApi(): IptvApi {
  const progressCbs = new Set<(m: string) => void>()
  const progress = (m: string) => progressCbs.forEach((cb) => cb(m))
  const load = <K extends keyof StoreShape>(k: K): StoreShape[K] => {
    try {
      const v = localStorage.getItem(`lumen:${k}`)
      return v ? (JSON.parse(v) as StoreShape[K]) : STORE_DEFAULTS[k]
    } catch {
      return STORE_DEFAULTS[k]
    }
  }
  const settings = () => ({ ...DEFAULT_SETTINGS, ...load('settings') })
  let library: Library | null = null
  const tv = isTizen()

  if (tv) {
    // Media/colour/number keys must be registered before Tizen delivers them to the app
    const keys = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind', 'ChannelUp', 'ChannelDown', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', ...'0123456789']
    for (const k of keys) try { window.tizen?.tvinputdevice?.registerKey(k) } catch { /* not supported on this model */ }
  }
  setTimeout(checkOta, 15_000)

  return {
    platform: tv ? 'tizen' : 'web',
    device: tv ? 'tv' : 'web',
    version: window.__LUMEN_BOOT__?.running ?? __APP_VERSION__,
    getStore: async () => {
      const out = {} as StoreShape
      for (const k of Object.keys(STORE_DEFAULTS) as (keyof StoreShape)[]) (out as unknown as Record<string, unknown>)[k] = load(k)
      out.settings = settings()
      return out
    },
    setStore: async (k, v) => localStorage.setItem(`lumen:${k}`, JSON.stringify(v)),
    getLibrary: async () => (library ??= shareStrings(await getBig<Library>('library'))),
    refreshLibrary: async () => {
      library = await buildLibrary(load('sources'), settings(), getText, progress, getStream)
      await putBig('library', library, ['channels', 'movies', 'series'])
      return library
    },
    getEpg,
    refreshEpg: async () => {
      const epg = await buildEpg(library ?? (await getBig<Library>('library')) ?? emptyLibrary(), settings(), getText, progress, { stream: getStream, hours: tv ? 12 : 26 })
      await putEpg(epg)
      return epg
    },
    mediaInfo: async (sourceId, kind, id) => {
      const src = load('sources').find((s) => s.id === sourceId)
      return src?.kind === 'xtream' ? xtreamInfo(src, kind, id, getText) : {}
    },
    pickPlaylistFile: async () => null,
    openInVlc: async () => ({ ok: false, error: 'VLC is only available in the Windows app.' }),
    win: {
      minimize: () => {},
      toggleMaximize: () => {},
      close: () => window.tizen?.application.getCurrentApplication().exit(),
      setFullscreen: (on) => {
        if (tv) return
        const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
        if (on) {
          const root = document.documentElement
          if (root.requestFullscreen)
            // phones: fullscreen video always plays sideways (Android Chrome; ignored on desktop)
            root.requestFullscreen().then(() => orientation?.lock?.('landscape')).catch(() => {})
          // iPhone Safari has no element fullscreen: use the native video player instead
          else (document.querySelector('video') as HTMLVideoElement & { webkitEnterFullscreen?: () => void } | null)?.webkitEnterFullscreen?.()
        } else {
          try { orientation?.unlock() } catch { /* not locked */ }
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
        }
      },
      setMaterial: () => {},
      setTheme: () => {}
    },
    onWindowState: (cb) => {
      const fn = () => cb({ maximized: false, fullscreen: !!document.fullscreenElement })
      document.addEventListener('fullscreenchange', fn)
      return () => document.removeEventListener('fullscreenchange', fn)
    },
    onProgress: (cb) => (progressCbs.add(cb), () => void progressCbs.delete(cb)),
    update: {
      check: checkOta,
      // the boot loader picks the newest build on start
      install: () => location.reload(),
      onState: (cb) => (updateListeners.add(cb), () => void updateListeners.delete(cb))
    }
  }
}
