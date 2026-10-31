import { create } from 'zustand'
import { mergeMovies } from '../../shared/core/dedupe'
import {
  STORE_DEFAULTS,
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
import * as sync from './lib/sync'
import { hexToRgb, themeById } from './lib/themes'
import { createWebApi } from './platform/web'

/** Electron provides window.api from its preload; Samsung TV and browsers use the web implementation */
export const api = window.api ?? createWebApi()

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
  /** player shrunk into the floating mini player (Windows + web) */
  playerMini: boolean
  ambient: string | null
  toast: { id: number; text: string } | null
  sourceSheet: { kind: Source['kind']; source?: Source; file?: boolean } | null
  /** selected category per browse screen */
  group: Partial<Record<'live' | 'movies' | 'series', string>>
  syncStatus: { state: 'off' | 'syncing' | 'ok' | 'error'; message?: string }
}

export const useApp = create<State>(() => ({
  ...STORE_DEFAULTS,
  booted: false,
  library: null,
  epg: null,
  loading: false,
  progress: '',
  tab: 'home',
  detail: null,
  player: null,
  playerMini: false,
  ambient: null,
  toast: null,
  sourceSheet: null,
  group: {},
  syncStatus: { state: 'off' }
}))

const set = useApp.setState
const get = useApp.getState

/* ---------------- persistence ---------------- */

export function persist<K extends keyof StoreShape>(key: K, value: StoreShape[K]) {
  set({ [key]: value } as Partial<State>)
  api.setStore(key, value)
}

type Synced = 'sources' | 'favorites' | 'watchlist' | 'history'

/** Persist a synced collection and record what changed (and what was deleted) for the merge */
export function persistSynced<K extends Synced>(key: K, value: StoreShape[K], changed: string[] = [], removed: string[] = []) {
  const now = Date.now()
  const meta = { at: { ...get().meta.at }, tomb: { ...get().meta.tomb } }
  for (const id of changed) (meta.at[`${key}:${id}`] = now), delete meta.tomb[`${key}:${id}`]
  for (const id of removed) (meta.tomb[`${key}:${id}`] = now), delete meta.at[`${key}:${id}`]
  persist(key, value)
  persist('meta', meta)
  scheduleSync()
}

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...get().settings, ...patch }
  persist('settings', settings)
  applyAppearance(settings)
  if (patch.material) api.win.setMaterial(patch.material)
  if (Object.keys(patch).some((k) => (sync.SYNCED_PREFS as readonly string[]).includes(k))) {
    persist('meta', { ...get().meta, at: { ...get().meta.at, prefs: Date.now() } })
    scheduleSync()
  }
}

export function applyAppearance(s: Settings) {
  const t = themeById(s.theme)
  const root = document.documentElement
  root.dataset.theme = t.mode
  root.dataset.material = api.platform === 'win32' ? s.material : 'none'
  root.dataset.device = api.device
  const vars: Record<string, string> = {
    '--fg-rgb': t.fg,
    '--base-rgb': t.base,
    '--accent-rgb': s.accent ? hexToRgb(s.accent) : t.accent,
    '--glow-1': t.glow[0],
    '--glow-2': t.glow[1]
  }
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  api.win.setTheme(t.mode)
}

/* ---------------- boot & loading ---------------- */

export async function boot() {
  const s = await api.getStore()
  set({ ...s, booted: true })
  applyAppearance(s.settings)
  const [library, epg] = await Promise.all([api.getLibrary(), api.getEpg()])
  set({ library, epg })
  startSync()
  if (!s.sources.length) return
  const empty = !library || !(library.channels.length || library.movies.length || library.series.length)
  const stale = empty || Date.now() - library!.updatedAt > s.settings.refreshHours * 3600_000
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
export const inWatchlist = (id: string) => get().watchlist.some((f) => f.id === id)

// M3U series carry every episode inline; the snapshot doesn't need them (they come from the library)
const snapshot = <T extends Item>(item: T): T => (item.kind === 'series' ? { ...item, episodes: undefined } : item)

export function toggleFavorite(item: Item) {
  const favs = get().favorites
  const on = favs.some((f) => f.id === item.id)
  persistSynced('favorites', on ? favs.filter((f) => f.id !== item.id) : [snapshot(item), ...favs], on ? [] : [item.id], on ? [item.id] : [])
  toast(on ? `Removed “${item.name}” from Favorites` : `Added “${item.name}” to Favorites`)
}

export function toggleWatchlist(item: Movie | Show) {
  const list = get().watchlist
  const on = list.some((f) => f.id === item.id)
  persistSynced('watchlist', on ? list.filter((f) => f.id !== item.id) : [snapshot(item), ...list], on ? [] : [item.id], on ? [item.id] : [])
  toast(on ? `Removed “${item.name}” from your Watchlist` : `Added “${item.name}” to your Watchlist`)
}

export function saveProgress(e: HistoryEntry) {
  const all = [e, ...get().history.filter((h) => h.id !== e.id)]
  persistSynced('history', all.slice(0, 300), [e.id], all.slice(300).map((h) => h.id))
}

export function saveSources(list: Source[], changed: string[], removed: string[] = []) {
  persistSynced('sources', list, changed, removed)
  refreshLibrary()
}

export function clearCollection(key: 'favorites' | 'history' | 'watchlist') {
  persistSynced(key, [], [], get()[key].map((x) => x.id))
}

/* ---------------- sync ---------------- */

let syncTimer: ReturnType<typeof setTimeout> | undefined
let syncing: Promise<void> | null = null

export function scheduleSync(delay = 2500) {
  if (!get().sync.code) return
  clearTimeout(syncTimer)
  syncTimer = setTimeout(syncNow, delay)
}

const localDoc = (): sync.SyncDoc => {
  const s = get()
  const prefs = Object.fromEntries(sync.SYNCED_PREFS.map((k) => [k, s.settings[k]])) as sync.Prefs
  return { v: 1, sources: s.sources, favorites: s.favorites, watchlist: s.watchlist, history: s.history, prefs, meta: s.meta }
}

/** Pull, merge, apply locally, push back. Safe to call often; concurrent calls share one run. */
export function syncNow(): Promise<void> {
  const code = get().sync.code
  if (!code || !sync.supported()) return Promise.resolve()
  return (syncing ??= (async () => {
    set({ syncStatus: { state: 'syncing' } })
    try {
      const local = localDoc()
      const merged = sync.merge(local, await sync.pull(code))
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
      for (const k of sync.COLLECTIONS) if (!same(local[k], merged[k])) persist(k, merged[k] as never)
      persist('meta', merged.meta)
      if (!same(local.prefs, merged.prefs)) {
        const settings = { ...get().settings, ...merged.prefs }
        persist('settings', settings)
        applyAppearance(settings)
      }
      // local playlist files go up before the source list, so other devices can load them right away
      const fileError = await shareFiles(code, merged.sources)
      await sync.push(code, merged)
      persist('sync', { ...get().sync, lastSync: Date.now() })
      set({ syncStatus: fileError ? { state: 'error', message: fileError } : { state: 'ok' } })
      if (!same(local.sources, merged.sources)) refreshLibrary()
    } catch (e) {
      set({ syncStatus: { state: 'error', message: (e as Error).message } })
    } finally {
      syncing = null
    }
  })())
}

/** PC only: share M3U files added from disk with the TV/web (unchanged files are skipped) */
async function shareFiles(code: string, sources: Source[]): Promise<string | undefined> {
  if (!api.readPlaylistFile) return
  for (const s of sources) {
    if (s.kind !== 'm3u' || !s.url || /^https?:\/\//i.test(s.url)) continue
    try {
      const { text, sig } = await api.readPlaylistFile(s.url)
      await sync.pushFile(code, s.id, text, sig)
    } catch (e) {
      return `${s.name}: ${(e as Error).message}`
    }
  }
}

let started = false
function startSync() {
  if (started) return
  started = true
  syncNow()
  // pick up changes from other devices (e.g. something added to the watchlist on the PC shows up on the TV)
  setInterval(() => document.visibilityState === 'visible' && syncNow(), 60_000)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncNow())
}

export function setSyncCode(code: string) {
  persist('sync', { code: code ? sync.normalize(code).match(/.{1,4}/g)!.join('-') : '', lastSync: 0 })
  set({ syncStatus: { state: code ? 'syncing' : 'off' } })
  if (code) syncNow()
}

export const historyFor = (id: string) => get().history.find((h) => h.id === id)

/** Resume only if meaningfully into the video and not basically finished */
export const resumable = (h?: HistoryEntry) => !!h && h.kind !== 'live' && h.position > 30 && h.position < h.duration * 0.95

/* ---------------- playback ---------------- */

export const play = (req: PlayRequest) => set({ player: req, playerMini: false })
export const closePlayer = () => set({ player: null, playerMini: false })
export const canMiniPlayer = api.device !== 'tv'
export const minimizePlayer = () => canMiniPlayer && set({ playerMini: true })
export const expandPlayer = () => set({ playerMini: false })

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

/** A merged movie is listed in every category one of its copies came from */
function groupBy<T extends { group: string; groups?: string[] }>(items: T[]): Group<T>[] {
  const map = new Map<string, T[]>()
  for (const it of items) {
    for (const g of it.groups ?? [it.group]) {
      const list = map.get(g)
      if (list) list.push(it)
      else map.set(g, [it])
    }
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
  const movies = mergeMovies(keep(lib?.movies ?? []))
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
