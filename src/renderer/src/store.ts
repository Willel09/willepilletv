import { create } from 'zustand'
import {
  DEFAULT_SETTINGS,
  type Channel,
  type Epg,
  type Episode,
  type HistoryEntry,
  type Item,
  type Library,
  type Movie,
  type Settings,
  type Show,
  type Source,
  type StoreShape
} from '../../shared/types'
import { fold } from './lib/format'

export const api = window.api

export type Tab = 'home' | 'live' | 'movies' | 'series' | 'search' | 'settings'

export interface PlayRequest {
  kind: 'live' | 'movie' | 'episode'
  /** history id */
  id: string
  url: string
  title: string
  subtitle?: string
  poster?: string
  startAt?: number
  channel?: Channel
  /** channels to zap through with up/down */
  channels?: Channel[]
  show?: Show
  episode?: Episode
  episodes?: Episode[]
}

interface State extends StoreShape {
  booted: boolean
  library: Library | null
  epg: Epg | null
  loading: boolean
  progress: string
  tab: Tab
  detail: Movie | Show | null
  player: PlayRequest | null
  ambient: string | null
  toast: { id: number; text: string } | null
  sourceSheet: { kind: Source['kind']; source?: Source; file?: boolean } | null
  /** selected category per browse screen */
  group: Partial<Record<'live' | 'movies' | 'series', string>>
}

export const useApp = create<State>(() => ({
  booted: false,
  settings: DEFAULT_SETTINGS,
  sources: [],
  favorites: [],
  history: [],
  library: null,
  epg: null,
  loading: false,
  progress: '',
  tab: 'home',
  detail: null,
  player: null,
  ambient: null,
  toast: null,
  sourceSheet: null,
  group: {}
}))

const set = useApp.setState
const get = useApp.getState

/* ---------------- persistence ---------------- */

export function persist<K extends keyof StoreShape>(key: K, value: StoreShape[K]) {
  set({ [key]: value } as Partial<State>)
  api.setStore(key, value)
}

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...get().settings, ...patch }
  persist('settings', settings)
  applyAppearance(settings)
  if (patch.material) api.win.setMaterial(patch.material)
  if (patch.theme) api.win.setTheme(patch.theme)
}

export function applyAppearance(s: Settings) {
  const root = document.documentElement
  root.dataset.theme = s.theme
  root.dataset.material = api.platform === 'win32' ? s.material : 'none'
  root.style.setProperty('--accent', s.accent)
}

/* ---------------- boot & loading ---------------- */

export async function boot() {
  const s = await api.getStore()
  set({ ...s, booted: true })
  applyAppearance(s.settings)
  const [library, epg] = await Promise.all([api.getLibrary(), api.getEpg()])
  set({ library, epg })
  if (!s.sources.length) return
  const stale = !library || Date.now() - library.updatedAt > s.settings.refreshHours * 3600_000
  if (stale) await refreshLibrary()
  else if (!epg || Date.now() - epg.updatedAt > 6 * 3600_000) refreshEpg()
}

export async function refreshLibrary() {
  if (get().loading) return
  set({ loading: true })
  try {
    const library = await api.refreshLibrary()
    set({ library })
    if (library.errors.length) toast(library.errors[0])
    else toast(`Loaded ${library.channels.length.toLocaleString()} channels, ${library.movies.length.toLocaleString()} movies, ${library.series.length.toLocaleString()} series`)
    refreshEpg()
  } catch (e) {
    toast(`Couldn't load sources: ${(e as Error).message}`)
  } finally {
    set({ loading: false })
  }
}

export async function refreshEpg() {
  try {
    const epg = await api.refreshEpg()
    set({ epg })
    if (epg.errors.length) toast(epg.errors[0])
  } catch (e) {
    toast(`TV guide failed: ${(e as Error).message}`)
  }
}

/* ---------------- ui ---------------- */

let toastId = 0
export function toast(text: string) {
  const id = ++toastId
  set({ toast: { id, text } })
  setTimeout(() => get().toast?.id === id && set({ toast: null }), 4500)
}

export const setTab = (tab: Tab) => set({ tab, detail: null })
export const setAmbient = (src?: string) => {
  if (src && get().ambient !== src) set({ ambient: src })
}
export const openDetail = (item: Movie | Show) => set({ detail: item })
export const closeDetail = () => set({ detail: null })
export const setGroup = (screen: 'live' | 'movies' | 'series', group: string) => set({ group: { ...get().group, [screen]: group } })
export const openSourceSheet = (kind: Source['kind'], source?: Source, file?: boolean) => set({ sourceSheet: { kind, source, file } })

/* ---------------- favorites & history ---------------- */

export const isFavorite = (id: string) => get().favorites.some((f) => f.id === id)

export function toggleFavorite(item: Item) {
  const favs = get().favorites
  const on = favs.some((f) => f.id === item.id)
  persist('favorites', on ? favs.filter((f) => f.id !== item.id) : [item, ...favs])
  toast(on ? `Removed “${item.name}” from Favorites` : `Added “${item.name}” to Favorites`)
}

export function saveProgress(e: HistoryEntry) {
  persist('history', [e, ...get().history.filter((h) => h.id !== e.id)].slice(0, 300))
}

export const historyFor = (id: string) => get().history.find((h) => h.id === id)

/** Resume only if meaningfully into the video and not basically finished */
export const resumable = (h?: HistoryEntry) => !!h && h.kind !== 'live' && h.position > 30 && h.position < h.duration * 0.95

/* ---------------- playback ---------------- */

export const play = (req: PlayRequest) => set({ player: req })
export const closePlayer = () => set({ player: null })

export function playChannel(channel: Channel, channels?: Channel[]) {
  play({ kind: 'live', id: channel.id, url: channel.url, title: channel.name, poster: channel.logo, channel, channels })
}

export function playMovie(movie: Movie, fromStart = false) {
  const h = historyFor(movie.id)
  play({ kind: 'movie', id: movie.id, url: movie.url, title: movie.name, poster: movie.poster, startAt: !fromStart && resumable(h) ? h!.position : undefined })
}

export function playEpisode(show: Show, episode: Episode, episodes: Episode[], fromStart = false) {
  const id = `${show.id}:${episode.id}`
  const h = historyFor(id)
  play({
    kind: 'episode', id, url: episode.url, title: show.name,
    subtitle: `S${episode.season} · E${episode.episode}  ${episode.title.includes(show.name) ? '' : episode.title}`.trim(),
    poster: show.poster, show, episode, episodes, startAt: !fromStart && resumable(h) ? h!.position : undefined
  })
}

/** Continue a history entry straight from Home */
export function resume(h: HistoryEntry) {
  if (h.kind === 'live') {
    const ch = index().channelById.get(h.id)
    return ch ? playChannel(ch) : play({ kind: 'live', id: h.id, url: h.url, title: h.name, poster: h.poster })
  }
  play({ kind: h.kind, id: h.id, url: h.url, title: h.name, subtitle: h.subtitle, poster: h.poster, startAt: resumable(h) ? h.position : undefined })
}

/* ---------------- derived library index ---------------- */

export interface Group<T> {
  name: string
  items: T[]
}

export interface LibraryIndex {
  channels: Channel[]
  movies: Movie[]
  series: Show[]
  liveGroups: Group<Channel>[]
  movieGroups: Group<Movie>[]
  seriesGroups: Group<Show>[]
  channelById: Map<string, Channel>
  keys: Map<string, string>
}

function groupBy<T extends { group: string }>(items: T[]): Group<T>[] {
  const map = new Map<string, T[]>()
  for (const it of items) {
    const list = map.get(it.group)
    if (list) list.push(it)
    else map.set(it.group, [it])
  }
  return [...map].map(([name, items]) => ({ name, items }))
}

let cache: { lib: Library | null; hidden: string; idx: LibraryIndex } | null = null

/** Memoised across all components: rebuilding indexes for 50k items is not free */
export function index(): LibraryIndex {
  const { library: lib, settings } = get()
  if (cache && cache.lib === lib && cache.hidden === settings.hiddenGroups) return cache.idx
  const words = settings.hiddenGroups.split(',').map((w) => fold(w.trim())).filter(Boolean)
  const keep = <T extends { group: string }>(xs: T[]) => (words.length ? xs.filter((x) => !words.some((w) => fold(x.group).includes(w))) : xs)
  const channels = keep(lib?.channels ?? [])
  const movies = keep(lib?.movies ?? [])
  const series = keep(lib?.series ?? [])
  const keys = new Map<string, string>()
  for (const x of [...channels, ...movies, ...series]) keys.set(x.id, fold(x.name))
  const idx: LibraryIndex = {
    channels, movies, series,
    liveGroups: groupBy(channels), movieGroups: groupBy(movies), seriesGroups: groupBy(series),
    channelById: new Map(channels.map((c) => [c.id, c])),
    keys
  }
  cache = { lib, hidden: settings.hiddenGroups, idx }
  return idx
}

export function useIndex() {
  useApp((s) => s.library)
  useApp((s) => s.settings.hiddenGroups)
  return index()
}
