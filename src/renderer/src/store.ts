import { create } from 'zustand'
import { mergeMovies } from '../../shared/core/dedupe'
import { xtStreamUrl } from '../../shared/core/xtream'
import { hiddenFilter } from '../../shared/core/filter'
import { isMerged, PREPARED, preparedFor } from '../../shared/core/library'
import {
  MAIN_PROFILE,
  STORE_DEFAULTS,
  type Channel,
  type DownloadRec,
  type DownloadRequest,
  type DownloadsState,
  type Epg,
  type Episode,
  type HistoryEntry,
  type Item,
  type Library,
  type Movie,
  type Profile,
  type ProfileLists,
  type Settings,
  type Show,
  type Source,
  type StoreShape
} from '../../shared/types'
import { cleanName } from './lib/format'
import { words } from './lib/search'
import * as sync from './lib/sync'
import { hexToRgb, themeById } from './lib/themes'
import { createWebApi } from './platform/web'
import { serial } from './lib/serial'
import { relink } from '../../shared/core/relink'

/** Electron provides window.api from its preload; Samsung TV and browsers use the web implementation */
export const api = window.api ?? createWebApi()

export type Tab = 'home' | 'live' | 'movies' | 'series' | 'random' | 'downloads' | 'search' | 'settings'

export interface PlayRequest {
  kind: 'live' | 'movie' | 'episode'
  /** history id */
  id: string
  url: string
  title: string
  subtitle?: string
  poster?: string
  startAt?: number
  /** a downloaded copy on this PC: played instead of `url`, which stays the history's address */
  local?: string
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
  /** actor or director page open on top of the title page */
  person: { name: string; role: 'actor' | 'director' } | null
  player: PlayRequest | null
  /** player shrunk into the floating mini player (Windows + web) */
  playerMini: boolean
  /** TV the player is casting to (Windows app) */
  castTo: { id: string; name: string } | null
  ambient: string | null
  toast: { id: number; text: string } | null
  sourceSheet: { kind: Source['kind']; source?: Source; file?: boolean } | null
  /** selected category per browse screen */
  group: Partial<Record<'live' | 'movies' | 'series', string>>
  syncStatus: { state: 'off' | 'syncing' | 'ok' | 'error'; message?: string }
  /** favorites/watchlist/history of every profile; the top-level ones are the active profile's */
  lists: Record<string, ProfileLists>
  /** "Who's watching?" screen open */
  pickProfile: boolean
  /** Windows: films and episodes saved on this PC */
  downloads: DownloadsState | null
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
  person: null,
  player: null,
  playerMini: false,
  castTo: null,
  ambient: null,
  toast: null,
  sourceSheet: null,
  group: {},
  syncStatus: { state: 'off' },
  lists: {},
  pickProfile: false,
  downloads: null
}))

const set = useApp.setState
const get = useApp.getState

/* ---------------- persistence ---------------- */

/** Saved on the device; a full storage (TVs have little) is reported once instead of failing silently */
let storageWarned = false
// sent right away (not after a microtask): a refresh asked for next must find the new sources already saved
const save = (key: keyof StoreShape, value: unknown) =>
  api.setStore(key, value as never).catch(() => {
    if (!storageWarned) (storageWarned = true), toast('Storage is full: some changes could not be saved on this device. Clearing History in Settings frees space.')
  })

export function persist<K extends keyof StoreShape>(key: K, value: StoreShape[K]) {
  set({ [key]: value } as Partial<State>)
  void save(key, value)
}

type ListKey = keyof ProfileLists
type Synced = 'sources' | ListKey
const EMPTY_LISTS: ProfileLists = { favorites: [], watchlist: [], history: [] }

/** Record changes/deletions for the merge, under "<prefix><key>:<id>" in meta or profileMeta */
function touch(metaKey: 'meta' | 'profileMeta', prefix: string, changed: string[], removed: string[]) {
  const now = Date.now()
  const meta = { at: { ...get()[metaKey].at }, tomb: { ...get()[metaKey].tomb } }
  for (const k of changed) (meta.at[prefix + k] = now), delete meta.tomb[prefix + k]
  for (const k of removed) (meta.tomb[prefix + k] = now), delete meta.at[prefix + k]
  persist(metaKey, meta)
}

/** Save one list of a profile. Main keeps the original store keys (older app versions read those). */
function saveList<K extends ListKey>(pid: string, key: K, value: ProfileLists[K]) {
  const lists = { ...get().lists, [pid]: { ...(get().lists[pid] ?? EMPTY_LISTS), [key]: value } }
  set({ lists, ...(pid === get().activeProfile ? { [key]: value } : {}) })
  if (pid === 'main') return void save(key, value)
  persist('profileData', Object.fromEntries(Object.entries(lists).filter(([id]) => id !== 'main')))
}

/** Persist a synced collection (lists: of the active profile) and record what changed for the merge */
export function persistSynced<K extends Synced>(key: K, value: StoreShape[K], changed: string[] = [], removed: string[] = []) {
  const pid = key === 'sources' ? 'main' : get().activeProfile
  const ids = (xs: string[]) => xs.map((id) => `${key}:${id}`)
  if (pid === 'main') touch('meta', '', ids(changed), ids(removed))
  else touch('profileMeta', `${pid}/`, ids(changed), ids(removed))
  if (key === 'sources') persist('sources', value as Source[])
  else saveList(pid, key as ListKey, value as never)
  scheduleSync()
}

/* ---------------- profiles ---------------- */

export const profilesOf = (list: Profile[]) => (list.length ? list : [MAIN_PROFILE])
export const currentProfile = () => profilesOf(get().profiles).find((p) => p.id === get().activeProfile) ?? MAIN_PROFILE

export function switchProfile(id: string) {
  flushHistory() // pending positions belong to the profile being left
  persist('activeProfile', id)
  closePlayer()
  set({ ...(get().lists[id] ?? EMPTY_LISTS), pickProfile: false, detail: null, tab: 'home' })
  relinkSaved()
}

export const openProfilePicker = () => set({ pickProfile: true })

export function saveProfile(p: Profile) {
  const list = profilesOf(get().profiles)
  persist('profiles', list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p])
  touch('profileMeta', 'profiles:', [p.id], [])
  scheduleSync()
}

export function deleteProfile(id: string) {
  if (id === 'main') return
  if (get().activeProfile === id) switchProfile('main')
  persist('profiles', profilesOf(get().profiles).filter((p) => p.id !== id))
  touch('profileMeta', 'profiles:', [], [id])
  const lists = { ...get().lists }
  delete lists[id]
  set({ lists })
  persist('profileData', Object.fromEntries(Object.entries(lists).filter(([k]) => k !== 'main')))
  scheduleSync()
}

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...get().settings, ...patch }
  persist('settings', settings)
  applyAppearance(settings)
  if (patch.material) api.win.setMaterial(patch.material)
  if ('removeBs' in patch || 'hiddenGroups' in patch) reloadIfFiltered()
  if (Object.keys(patch).some((k) => (sync.SYNCED_PREFS as readonly string[]).includes(k))) {
    persist('meta', { ...get().meta, at: { ...get().meta.at, prefs: Date.now() } })
    scheduleSync()
  }
}

/** TVs and phones drop hidden titles while loading (see buildLibrary), so a filter change needs a reload there */
const reloadIfFiltered = () => api.device !== 'desktop' && get().sources.length > 0 && void refreshLibrary()

const mixRgb = (a: string, b: string, k: number) => {
  const x = a.split(' ').map(Number), y = b.split(' ').map(Number)
  return x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(' ')
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
    '--glow-2': t.glow[1],
    // TVs: flat opaque panels, the theme's background lifted a little toward its text colour
    '--tv-panel': mixRgb(t.base, t.fg, t.mode === 'dark' ? 0.09 : 0.04),
    '--tv-panel-strong': mixRgb(t.base, t.fg, t.mode === 'dark' ? 0.13 : 0.07)
  }
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  api.win.setTheme(t.mode)
}

/* ---------------- boot & loading ---------------- */

export async function boot() {
  const s = await api.getStore()
  const lists: Record<string, ProfileLists> = { ...s.profileData, main: { favorites: s.favorites, watchlist: s.watchlist, history: s.history } }
  const active = lists[s.activeProfile] && profilesOf(s.profiles).some((p) => p.id === s.activeProfile) ? s.activeProfile : 'main'
  set({ ...s, ...lists[active], activeProfile: active, lists, booted: true, pickProfile: profilesOf(s.profiles).length > 1 })
  applyAppearance(s.settings)
  window.addEventListener('pagehide', flushHistory)
  if (api.downloads) {
    api.downloads.onChange((downloads) => set({ downloads }))
    api.downloads.list().then((downloads) => set({ downloads }), () => {})
  }
  // a cache that can't be read must not stop the app: say so, then sync and reload from the sources as usual
  const [library, epg] = await Promise.all([
    api
      .getLibrary()
      .then(whole)
      .catch((e: Error) => (toast(`Couldn't open the saved library: ${e.message}`), null)),
    api.getEpg().catch(() => null)
  ])
  set({ library, epg })
  relinkSaved()
  startSync()
  // the guide only covers the next hours (12 on TVs): keep it fresh while the app stays open
  setInterval(() => {
    const epg = get().epg
    if (get().sources.length && !get().loading && (!epg || Date.now() - epg.updatedAt > (api.device === 'tv' ? 4 : 6) * 3600_000)) refreshEpg()
  }, 30 * 60_000)
  if (!s.sources.length) return
  const empty = !library || !(library.channels.length || library.movies.length || library.series.length)
  // also rebuild libraries prepared by an older version (see PREPARED)
  const stale = empty || Date.now() - library!.updatedAt > s.settings.refreshHours * 3600_000 || (!!library!.prepared && !library!.prepared.startsWith(PREPARED))
  if (stale) await refreshLibrary()
  else if (!epg || Date.now() - epg.updatedAt > 6 * 3600_000) refreshEpg()
}

/** Windows hands the library over in pieces (see library:part), so the window keeps answering clicks meanwhile */
async function whole(lib: Library | null): Promise<Library | null> {
  if (!lib?.parts || !api.libraryPart) return lib
  try {
    return await pieces(lib)
  } catch (e) {
    // a newer library replaced this one mid-transfer (a refresh finished): fetch that one instead
    if (/STALE/.test((e as Error).message)) return whole(await api.getLibrary())
    throw e
  }
}
async function pieces(lib: Library) {
  const parts = lib.parts!
  for (const k of ['channels', 'movies', 'series'] as const) {
    const all: unknown[] = []
    while (all.length < parts[k]) {
      const part = await api.libraryPart!(k, all.length, parts.gen)
      if (!part.length) break
      for (const x of part) all.push(x)
    }
    ;(lib[k] as unknown[]) = all
  }
  delete lib.parts
  return lib
}

/** Sources changed while a refresh was running load again when it's done (see serial), or the new source would be missing */
export const refreshLibrary = serial(async () => {
  set({ loading: true })
  try {
    const library = (await whole(await api.refreshLibrary()))!
    set({ library })
    relinkSaved()
    if (library.errors.length) toast(library.errors[0])
    else toast(`Loaded ${library.channels.length.toLocaleString()} channels, ${library.movies.length.toLocaleString()} movies, ${library.series.length.toLocaleString()} series`)
    refreshEpg()
  } catch (e) {
    const m = (e as Error).message
    toast(/cancelled/i.test(m) ? 'Refresh cancelled. Your library is as it was.' : `Couldn't load sources: ${m}`)
  } finally {
    set({ loading: false, progress: '' })
  }
})

/** one guide download at a time: the periodic refresh and a library refresh can ask at once */
export const refreshEpg = serial(async () => {
  try {
    const epg = await api.refreshEpg()
    set({ epg })
    if (epg.errors.length) toast(epg.errors[0])
  } catch (e) {
    toast(`TV guide failed: ${(e as Error).message}`)
  }
})

/* ---------------- ui ---------------- */

let toastId = 0
export function toast(text: string) {
  const id = ++toastId
  set({ toast: { id, text } })
  setTimeout(() => get().toast?.id === id && set({ toast: null }), 4500)
}

export const setTab = (tab: Tab) => set({ tab, detail: null, person: null })
export const setAmbient = (src?: string) => {
  // TVs draw no artwork wash, so focusing a card shouldn't touch the store at all
  if (src && api.device !== 'tv' && get().ambient !== src) set({ ambient: src })
}
export const openDetail = (item: Movie | Show) => set({ detail: item })
export const closeDetail = () => set({ detail: null, person: null })
export const openPerson = (name: string, role: 'actor' | 'director') => set({ person: { name, role } })
export const closePerson = () => set({ person: null })
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
  toast(on ? `Removed “${cleanName(item.name)}” from your Watchlist` : `Added “${cleanName(item.name)}” to your Watchlist`)
}

// Watching updates the position every 15 s and every zap adds a channel: Continue Watching changes in memory
// right away, but the list is written and synced at most once a minute, or at once on pause/close/end
let historyChanges: { changed: Set<string>; removed: Set<string> } | null = null
let historyTimer: ReturnType<typeof setTimeout> | undefined

export function saveProgress(e: HistoryEntry, now = false) {
  // watched to the end: the downloaded copy has done its job
  if (get().settings.deleteWatched && e.duration > 0 && e.position >= e.duration * 0.97 && downloadOf(e.id)) void api.downloads?.remove(e.id)
  const all = [e, ...get().history.filter((h) => h.id !== e.id)]
  historyChanges ??= { changed: new Set(), removed: new Set() }
  historyChanges.changed.add(e.id)
  for (const h of all.slice(300)) historyChanges.removed.add(h.id)
  const pid = get().activeProfile
  const history = all.slice(0, 300)
  set({ history, lists: { ...get().lists, [pid]: { ...(get().lists[pid] ?? EMPTY_LISTS), history } } })
  if (now) flushHistory()
  else historyTimer ??= setTimeout(flushHistory, 60_000)
}

/** Gives saved M3U items their current ids again (see relink): after 1.3.12's new ids, or a provider's new URLs */
function relinkSaved() {
  const s = get()
  const m3u = new Set(s.sources.filter((x) => x.kind === 'm3u').map((x) => x.id))
  if (!s.library || !m3u.size) return
  const r = relink(s.library, { favorites: s.favorites, watchlist: s.watchlist, history: s.history }, m3u)
  for (const k of ['favorites', 'watchlist', 'history'] as const) {
    const x = r[k]
    if (x) persistSynced(k, x.list as never, x.changed, x.removed)
  }
}

/** Takes entries out of Continue Watching (and the history behind it); the removal syncs to the other devices */
export function removeHistory(ids: string[]) {
  flushHistory() // pending positions are written first, so the removal isn't undone by them
  const drop = new Set(ids)
  const gone = get().history.filter((h) => drop.has(h.id)).map((h) => h.id)
  if (gone.length) persistSynced('history', get().history.filter((h) => !drop.has(h.id)), [], gone)
}

/** Every history entry of a title: the movie itself, or any of its episodes (also under a merged copy's id) */
export function historyOfTitle(item: { id: string; versions?: { id: string }[] }): HistoryEntry[] {
  const ids = [item.id, ...(item.versions ?? []).map((v) => v.id)]
  return get().history.filter((h) => ids.some((id) => h.id === id || h.parentId === id || h.id.startsWith(`${id}:`)))
}

export function flushHistory() {
  clearTimeout(historyTimer)
  historyTimer = undefined
  const c = historyChanges
  if (!c) return
  historyChanges = null
  persistSynced('history', get().history, [...c.changed], [...c.removed])
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
/** a change made while a sync was running: run another one when it's done, so the change gets pushed */
let syncAgain = false

export function scheduleSync(delay = 2500) {
  if (!get().sync.code) return
  clearTimeout(syncTimer)
  syncTimer = setTimeout(syncNow, delay)
}

const localDoc = (): sync.SyncDoc => {
  const s = get()
  const prefs = Object.fromEntries(sync.SYNCED_PREFS.map((k) => [k, s.settings[k]])) as sync.Prefs
  const main = s.lists.main ?? EMPTY_LISTS
  return { v: 1, sources: s.sources, favorites: main.favorites, watchlist: main.watchlist, history: main.history, prefs, meta: s.meta }
}

/** Pull, merge, apply locally, push back. Safe to call often; concurrent calls share one run. */
export function syncNow(): Promise<void> {
  const code = get().sync.code
  if (!code || !sync.supported()) return Promise.resolve()
  if (syncing) return (syncAgain = true), syncing
  return (syncing = (async () => {
    set({ syncStatus: { state: 'syncing' } })
    try {
      let sourcesChanged = false
      let fileError: string | undefined
      // compare-and-swap: if another device pushed between our pull and push, pull and merge again
      for (let attempt = 0; ; attempt++) {
        const pulled = sync.pull(code)
        const { local, merged } = await sync.pullAndMerge(localDoc, pulled.then((p) => p.doc))
        const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
        for (const k of sync.COLLECTIONS) {
          if (same(local[k], merged[k])) continue
          if (k === 'sources') persist('sources', merged.sources)
          else saveList('main', k, merged[k] as never)
        }
        persist('meta', merged.meta)
        if (!same(local.prefs, merged.prefs)) {
          const settings = { ...get().settings, ...merged.prefs }
          persist('settings', settings)
          applyAppearance(settings)
          if (local.prefs.removeBs !== merged.prefs.removeBs || local.prefs.hiddenGroups !== merged.prefs.hiddenGroups) reloadIfFiltered()
        }
        sourcesChanged ||= !same(local.sources, merged.sources)
        // local playlist files go up before the source list, so other devices can load them right away
        if (attempt === 0) fileError = await shareFiles(code, merged.sources)
        if (await sync.pushIf(code, merged, (await pulled).at)) break
        if (attempt === 4) throw new Error('Another device kept changing the synced data at the same time. Try again.')
      }
      await syncProfiles(code)
      persist('sync', { ...get().sync, lastSync: Date.now() })
      set({ syncStatus: fileError ? { state: 'error', message: fileError } : { state: 'ok' } })
      if (sourcesChanged) refreshLibrary()
    } catch (e) {
      set({ syncStatus: { state: 'error', message: (e as Error).message } })
    } finally {
      syncing = null
      if (syncAgain) (syncAgain = false), scheduleSync(0)
    }
  })())
}

/** Extra profiles sync in their own blob (see lib/sync.ts). Nothing is uploaded until a profile exists. */
async function syncProfiles(code: string) {
  const s = get()
  const remote = await sync.pullProfiles(code)
  if (!remote && !s.profiles.length) return
  const local: sync.ProfilesDoc = { v: 1, profiles: s.profiles, data: s.profileData, meta: s.profileMeta }
  const merged = sync.mergeProfiles(local, remote)
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  if (!same(local.profiles, merged.profiles)) persist('profiles', merged.profiles)
  persist('profileMeta', merged.meta)
  for (const [pid, l] of Object.entries(merged.data))
    for (const k of ['favorites', 'watchlist', 'history'] as const) if (!same(get().lists[pid]?.[k] ?? [], l[k])) saveList(pid, k, l[k] as never)
  const alive = new Set(merged.profiles.map((p) => p.id))
  const gone = Object.keys(get().lists).filter((id) => id !== 'main' && !alive.has(id))
  if (gone.length) {
    if (gone.includes(get().activeProfile)) switchProfile('main')
    const lists = Object.fromEntries(Object.entries(get().lists).filter(([id]) => !gone.includes(id)))
    set({ lists })
    persist('profileData', Object.fromEntries(Object.entries(lists).filter(([id]) => id !== 'main')))
  }
  if (!same(merged, remote)) await sync.pushProfiles(code, merged)
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

/* ---------------- downloads (Windows) ---------------- */

export const downloadOf = (id: string) => get().downloads?.items.find((d) => d.id === id)
export const localUrlOf = (id: string) => {
  const d = downloadOf(id)
  return d?.state === 'done' ? `lumen-dl://f/${d.file}` : undefined
}
export const localPosterOf = (d: DownloadRec) => (d.hasPoster ? `lumen-dl://f/${d.file.replace(/\.\w+$/, '.jpg')}` : d.poster)

export async function startDownloads(reqs: DownloadRequest[]) {
  if (!api.downloads || !reqs.length) return
  try {
    const r = await api.downloads.add(reqs)
    toast(r.added ? (reqs.length === 1 ? `Downloading “${cleanName(reqs[0].title)}”` : `Downloading ${r.added} episodes`) : 'Already downloaded')
  } catch (e) {
    toast(`Couldn't start the download: ${(e as Error).message}`)
  }
}

/** A finished download from the Downloads screen or Home: an episode plays as part of the downloaded ones of its series */
export function playDownload(d: DownloadRec) {
  const h = historyFor(d.id)
  const startAt = resumable(h) ? h!.position : undefined
  if (d.kind === 'movie' || !d.parentId) return play({ kind: 'movie', id: d.id, url: d.url, title: d.title, poster: d.poster, startAt })
  const parentId = d.parentId
  const ep = (x: DownloadRec): Episode => {
    const m = x.subtitle?.match(/S(\d+) · E(\d+)\s*(.*)/)
    return { id: x.id.slice(parentId.length + 1), title: m?.[3] || x.subtitle || x.title, season: +(m?.[1] ?? 1), episode: +(m?.[2] ?? 1), url: x.url }
  }
  const siblings = (get().downloads?.items ?? []).filter((x) => x.parentId === parentId && x.state === 'done').map(ep).sort((a, b) => a.season - b.season || a.episode - b.episode)
  const show: Show = { kind: 'series', id: parentId, sourceId: '', name: d.title, group: '', poster: d.poster }
  playEpisode(show, ep(d), siblings)
}

/* ---------------- playback ---------------- */

export const play = (req: PlayRequest) => {
  // a downloaded film or episode plays from the PC, also offline
  const local = req.kind === 'live' || req.local ? req.local : localUrlOf(req.id)
  set({ player: local ? { ...req, local } : req, playerMini: false })
}
export const closePlayer = () => {
  if (get().castTo) void api.cast?.stop()
  set({ player: null, playerMini: false, castTo: null })
}
export const setCastTo = (castTo: { id: string; name: string } | null) => set({ castTo })
export const canMiniPlayer = api.device !== 'tv'
export const minimizePlayer = () => canMiniPlayer && set({ playerMini: true })
export const expandPlayer = () => set({ playerMini: false })

export function playChannel(channel: Channel, channels?: Channel[]) {
  play({ kind: 'live', id: channel.id, url: urlOf(channel), title: channel.name, poster: channel.logo, channel, channels })
}

/** Stream address. Xtream items don't store it (that's ~70 bytes × 600k titles): it's built from the source here. */
export function urlOf(x: Channel | Movie): string {
  if (x.url) return x.url
  const src = get().sources.find((s) => s.id === x.sourceId)
  if (!src || src.kind !== 'xtream') return ''
  return x.kind === 'live' ? xtStreamUrl(src, 'live', x.sid ?? x.id.split(':l').pop()!, 'ts') : xtStreamUrl(src, 'movie', x.vodId ?? 0, x.ext ?? 'mp4')
}

export function playMovie(movie: Movie, fromStart = false) {
  const h = historyFor(movie.id)
  play({ kind: 'movie', id: movie.id, url: urlOf(movie), title: movie.name, poster: movie.poster, startAt: !fromStart && resumable(h) ? h!.position : undefined })
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
  const plain = () => play({ kind: h.kind, id: h.id, url: h.url, title: h.name, subtitle: h.subtitle, poster: h.poster, startAt: resumable(h) ? h.position : undefined })
  if (h.kind !== 'episode' || !h.parentId) return plain()
  // an episode: play it as part of its series, so Next Episode and autoplay work from here too
  return void resumeEpisode(h).then((ok) => ok || plain(), plain)
}

async function resumeEpisode(h: HistoryEntry): Promise<boolean> {
  const show = index().series.find((s) => s.id === h.parentId || s.versions?.some((v) => v.id === h.parentId))
  if (!show) return false
  let episodes = show.episodes
  if (!episodes?.length && show.seriesId) {
    // Xtream: episodes come with the details; the copy whose id the history entry carries
    const v = show.versions?.find((x) => x.id === h.parentId)
    episodes = (await api.mediaInfo(v?.sourceId ?? show.sourceId, 'series', v?.seriesId ?? show.seriesId)).episodes
  }
  const ep = episodes?.find((e) => `${h.parentId}:${e.id}` === h.id || e.url === h.url)
  if (!ep || !episodes) return false
  playEpisode({ ...show, id: h.parentId! }, ep, episodes)
  return true
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
  /** search key (words of the name without provider tag, see lib/search); the table is built on the first search, not at startup */
  key: (x: { id: string; name: string }) => string
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
  const hidden = `${settings.hiddenGroups}|${settings.removeBs}`
  if (cache && cache.lib === lib && cache.hidden === hidden) return cache.idx
  // a library prepared while loading (TVs, phones) is already filtered and merged for these settings
  const ready = !!lib?.prepared && lib.prepared === preparedFor(settings)
  const isHidden = ready ? null : hiddenFilter(settings)
  const keep = <T extends { group: string; name: string }>(xs: T[]) => (isHidden ? xs.filter((x) => !isHidden(x)) : xs)
  const channels = keep(lib?.channels ?? [])
  // prepared libraries are already merged; after a filter change they're only re-filtered until the reload lands
  const merged = !!lib && isMerged(lib)
  const movies = merged ? keep(lib!.movies) : mergeMovies(keep(lib?.movies ?? []))
  const series = merged ? keep(lib!.series) : mergeMovies(keep(lib?.series ?? []))
  let keys: Map<string, string> | null = null
  const key = (x: { id: string; name: string }) => {
    if (!keys) {
      keys = new Map()
      for (const list of [channels, movies, series] as { id: string; name: string }[][]) for (const y of list) keys.set(y.id, words(cleanName(y.name)))
    }
    return keys.get(x.id) ?? words(cleanName(x.name))
  }
  // built when a screen first needs them: Home doesn't, and each is a pass over up to 400k titles
  let lg: Group<Channel>[] | undefined, mg: Group<Movie>[] | undefined, sg: Group<Show>[] | undefined, byId: Map<string, Channel> | undefined
  const idx: LibraryIndex = {
    channels, movies, series, key,
    get liveGroups() { return (lg ??= groupBy(channels)) },
    get movieGroups() { return (mg ??= groupBy(movies)) },
    get seriesGroups() { return (sg ??= groupBy(series)) },
    get channelById() { return (byId ??= new Map(channels.map((c) => [c.id, c]))) }
  }
  cache = { lib, hidden, idx }
  return idx
}

export function useIndex() {
  useApp((s) => s.library)
  useApp((s) => s.settings.hiddenGroups)
  useApp((s) => s.settings.removeBs)
  return index()
}
