// window.api for Samsung Tizen TVs and plain browsers. Electron uses its preload instead.
// Same core loaders as the desktop app; networking happens in-page (Tizen allows cross-origin
// requests for packaged apps via <access origin="*"> in config.xml).

import { gunzipSync } from 'fflate'
import { buildEpg, buildLibrary, emptyLibrary } from '../../../shared/core/library'
import { HTTP_HINT } from '../../../shared/core/net'
import { xtreamInfo } from '../../../shared/core/xtream'
import { DEFAULT_SETTINGS, STORE_DEFAULTS, type Epg, type IptvApi, type Library, type StoreShape, type UpdateState } from '../../../shared/types'

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
async function idb<T>(mode: 'get' | 'put', key: string, value?: unknown): Promise<T | null> {
  try {
    const store = (await db()).transaction('kv', mode === 'get' ? 'readonly' : 'readwrite').objectStore('kv')
    const req = mode === 'get' ? store.get(key) : store.put(value, key)
    return await new Promise((res, rej) => ((req.onsuccess = () => res((req.result as T) ?? null)), (req.onerror = () => rej(req.error))))
  } catch {
    return null
  }
}

/* ---------- networking ---------- */
async function getText(url: string, timeoutMs = 180_000): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Local playlist files only work on the PC that added them.')
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
  const buf = new Uint8Array(await res.arrayBuffer())
  // fflate instead of DecompressionStream, which older TVs (Chromium < 80) don't have
  return new TextDecoder().decode(buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf)
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
    getLibrary: async () => (library ??= await idb<Library>('get', 'library')),
    refreshLibrary: async () => {
      library = await buildLibrary(load('sources'), settings(), getText, progress)
      await idb('put', 'library', library)
      return library
    },
    getEpg: () => idb<Epg>('get', 'epg'),
    refreshEpg: async () => {
      const epg = await buildEpg(library ?? (await idb<Library>('get', 'library')) ?? emptyLibrary(), settings(), getText, progress)
      await idb('put', 'epg', epg)
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
