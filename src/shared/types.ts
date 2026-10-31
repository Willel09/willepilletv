// Types shared by the Electron main process, preload bridge and React renderer.

export type SourceKind = 'm3u' | 'xtream'

export interface Source {
  id: string
  name: string
  kind: SourceKind
  /** M3U: http(s) URL or local file path */
  url?: string
  /** Xtream Codes */
  server?: string
  username?: string
  password?: string
  /** Optional XMLTV guide for this source */
  epgUrl?: string
}

export interface Channel {
  kind: 'live'
  id: string
  sourceId: string
  name: string
  group: string
  url: string
  logo?: string
  epgId?: string
  num?: number
  /** Xtream live stream: the extension can be switched between .ts and .m3u8 */
  xt?: boolean
}

export interface Movie {
  kind: 'movie'
  id: string
  sourceId: string
  name: string
  group: string
  url: string
  poster?: string
  rating?: number
  year?: string
  plot?: string
  added?: number
  /** Xtream VOD id, used to fetch details */
  vodId?: number
  /** Set when duplicates were merged into this entry: every copy, best first */
  versions?: MovieVersion[]
  /** Every category the merged copies came from */
  groups?: string[]
}

export interface MovieVersion {
  id: string
  sourceId: string
  url: string
  vodId?: number
  /** e.g. "SE-4K", "EN · 1080P" or the category */
  label: string
}

export interface Episode {
  id: string
  title: string
  season: number
  episode: number
  url: string
  plot?: string
  still?: string
  duration?: string
}

export interface Show {
  kind: 'series'
  id: string
  sourceId: string
  name: string
  group: string
  poster?: string
  backdrop?: string
  rating?: number
  year?: string
  plot?: string
  added?: number
  /** Xtream series id, used to fetch seasons/episodes */
  seriesId?: number
  /** M3U playlists carry their episodes inline */
  episodes?: Episode[]
}

export type Item = Channel | Movie | Show

export interface Account {
  status?: string
  expires?: number
  maxConnections?: number
  activeConnections?: number
}

export interface Library {
  channels: Channel[]
  movies: Movie[]
  series: Show[]
  /** XMLTV URLs set explicitly on sources */
  epgUrls: string[]
  /** XMLTV URLs discovered from providers (M3U url-tvg header / Xtream xmltv.php) */
  providerEpgUrls: string[]
  accounts: Record<string, Account>
  errors: string[]
  updatedAt: number
}

export interface Programme {
  start: number
  stop: number
  title: string
  desc?: string
}

/** Guide data keyed by Channel.id */
export interface Epg {
  programmes: Record<string, Programme[]>
  updatedAt: number
  errors: string[]
}

export interface MediaInfo {
  plot?: string
  backdrop?: string
  poster?: string
  cast?: string
  director?: string
  genre?: string
  duration?: string
  rating?: number
  year?: string
  episodes?: Episode[]
}

export interface Settings {
  /** theme preset id, see renderer lib/themes.ts */
  theme: string
  /** how strongly the background picks up the focused artwork */
  ambient: 'strong' | 'subtle' | 'off'
  material: 'mica' | 'acrylic' | 'none'
  accent: string
  liveFormat: 'ts' | 'm3u8'
  epgUrl: string
  autoProviderEpg: boolean
  userAgent: string
  vlcPath: string
  hiddenGroups: string
  /** Hide Arabic and Indian channels, movies and series */
  removeBs: boolean
  autoplayNext: boolean
  refreshHours: number
}

export interface HistoryEntry {
  id: string
  kind: 'live' | 'movie' | 'episode'
  name: string
  subtitle?: string
  poster?: string
  url: string
  position: number
  duration: number
  updatedAt: number
  /** For episodes: the Show id */
  parentId?: string
}

/** Per-item change times + deletion tombstones, keyed "<collection>:<id>". Drives sync merges. */
export interface SyncMeta {
  at: Record<string, number>
  tomb: Record<string, number>
}

export interface SyncConfig {
  /** secret sync code shared by your devices; never sent to the server in plain form */
  code: string
  lastSync: number
}

export interface StoreShape {
  settings: Settings
  sources: Source[]
  favorites: Item[]
  watchlist: (Movie | Show)[]
  history: HistoryEntry[]
  meta: SyncMeta
  sync: SyncConfig
}

export const DEFAULT_UA = 'VLC/3.0.21 LibVLC/3.0.21'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'graphite',
  ambient: 'subtle',
  material: 'mica',
  accent: '',
  liveFormat: 'ts',
  epgUrl: '',
  autoProviderEpg: true,
  userAgent: DEFAULT_UA,
  vlcPath: '',
  hiddenGroups: '',
  removeBs: false,
  autoplayNext: true,
  refreshHours: 12
}

export type WindowState = { maximized: boolean; fullscreen: boolean }

export interface SamsungTv {
  ip: string
  name: string
  /** Developer Mode answers on port 26101 */
  devMode: boolean
}

export type UpdateState =
  | { status: 'idle' | 'checking' | 'none' | 'unsupported' }
  | { status: 'available' | 'downloading'; version: string; percent?: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }

export const STORE_DEFAULTS: StoreShape = {
  settings: DEFAULT_SETTINGS,
  sources: [],
  favorites: [],
  watchlist: [],
  history: [],
  meta: { at: {}, tomb: {} },
  sync: { code: '', lastSync: 0 }
}

/** The bridge exposed on window.api by the preload script */
export interface IptvApi {
  platform: string
  /** desktop = Electron app, tv = Samsung Tizen, web = browser */
  device: 'desktop' | 'tv' | 'web'
  version: string
  getStore(): Promise<StoreShape>
  setStore<K extends keyof StoreShape>(key: K, value: StoreShape[K]): Promise<void>
  getLibrary(): Promise<Library | null>
  refreshLibrary(): Promise<Library>
  getEpg(): Promise<Epg | null>
  refreshEpg(): Promise<Epg>
  mediaInfo(sourceId: string, kind: 'movie' | 'series', id: number): Promise<MediaInfo>
  pickPlaylistFile(): Promise<string | null>
  /** Desktop: cast to Chromecast / Google TV and DLNA (Samsung) TVs on the network */
  cast?: {
    discover(): Promise<CastDevice[]>
    start(deviceId: string, media: CastMedia): Promise<{ ok: boolean; error?: string }>
    stop(): Promise<void>
  }
  /** Desktop: read a local playlist file so sync can share it with the TV. `sig` changes when the file does. */
  readPlaylistFile?(path: string): Promise<{ text: string; sig: string }>
  openInVlc(url: string, title: string): Promise<{ ok: boolean; error?: string }>
  win: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    setFullscreen(on: boolean): void
    setMaterial(m: Settings['material']): void
    setTheme(mode: 'dark' | 'light'): void
  }
  onWindowState(cb: (s: WindowState) => void): () => void
  onProgress(cb: (msg: string) => void): () => void
  update: {
    check(): void
    install(): void
    onState(cb: (s: UpdateState) => void): () => void
  }
  /** Windows app only: helpers for installing Lumen on a Samsung TV */
  tvInstall?: {
    localIps(): Promise<string[]>
    discover(): Promise<SamsungTv[]>
    checkDevMode(ip: string): Promise<boolean>
    openInstaller(): Promise<{ ok: boolean; error?: string }>
  }
}

export interface CastDevice {
  id: string
  name: string
  kind: 'chromecast' | 'dlna'
  model?: string
  host: string
}

export interface CastMedia {
  url: string
  /** HLS variant of an Xtream live stream: Chromecast can't play raw .ts */
  hlsUrl?: string
  title: string
  poster?: string
  live: boolean
  startAt?: number
}
