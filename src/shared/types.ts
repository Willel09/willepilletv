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
  theme: 'dark' | 'light'
  material: 'mica' | 'acrylic' | 'none'
  accent: string
  liveFormat: 'ts' | 'm3u8'
  epgUrl: string
  autoProviderEpg: boolean
  userAgent: string
  vlcPath: string
  hiddenGroups: string
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

export interface StoreShape {
  settings: Settings
  sources: Source[]
  favorites: Item[]
  history: HistoryEntry[]
}

export const DEFAULT_UA = 'VLC/3.0.21 LibVLC/3.0.21'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  material: 'mica',
  accent: '#0a84ff',
  liveFormat: 'ts',
  epgUrl: '',
  autoProviderEpg: true,
  userAgent: DEFAULT_UA,
  vlcPath: '',
  hiddenGroups: '',
  autoplayNext: true,
  refreshHours: 12
}

export type WindowState = { maximized: boolean; fullscreen: boolean }

/** The bridge exposed on window.api by the preload script */
export interface IptvApi {
  platform: string
  getStore(): Promise<StoreShape>
  setStore<K extends keyof StoreShape>(key: K, value: StoreShape[K]): Promise<void>
  getLibrary(): Promise<Library | null>
  refreshLibrary(): Promise<Library>
  getEpg(): Promise<Epg | null>
  refreshEpg(): Promise<Epg>
  mediaInfo(sourceId: string, kind: 'movie' | 'series', id: number): Promise<MediaInfo>
  pickPlaylistFile(): Promise<string | null>
  openInVlc(url: string, title: string): Promise<{ ok: boolean; error?: string }>
  win: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    setFullscreen(on: boolean): void
    setMaterial(m: Settings['material']): void
    setTheme(t: Settings['theme']): void
  }
  onWindowState(cb: (s: WindowState) => void): () => void
  onProgress(cb: (msg: string) => void): () => void
}
