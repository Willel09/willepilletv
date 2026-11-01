import type { Account, Channel, Episode, MediaInfo, Movie, Show, Source } from '../types'
import { getJson, JsonArrayStream, type GetStream, type GetText } from './net'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any

export function xtBase(server: string): string {
  let s = server.trim()
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`
  return s.replace(/\/(player_api|get|panel_api|xmltv)\.php.*$/i, '').replace(/\/+$/, '')
}

const api = (src: Source) =>
  `${xtBase(src.server!)}/player_api.php?username=${encodeURIComponent(src.username!)}&password=${encodeURIComponent(src.password!)}`

export const xtStreamUrl = (src: Source, kind: 'live' | 'movie' | 'series', id: string | number, ext: string) =>
  `${xtBase(src.server!)}/${kind}/${encodeURIComponent(src.username!)}/${encodeURIComponent(src.password!)}/${id}.${ext}`

export const xtEpgUrl = (src: Source) =>
  `${xtBase(src.server!)}/xmltv.php?username=${encodeURIComponent(src.username!)}&password=${encodeURIComponent(src.password!)}`

const arr = (x: Json): Json[] => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : [])
const num = (x: Json) => (x === null || x === undefined || x === '' || isNaN(+x) ? undefined : +x)
const str = (x: Json) => (typeof x === 'string' && x.trim() ? x.trim() : undefined)
const year = (x: Json) => str(x)?.match(/\d{4}/)?.[0]

/** TMDB artwork is stored as "~<file>" (the renderer's artUrl expands it at the size it needs): the
    shared "https://image.tmdb.org/t/p/w600_and_h900_bestv2/" prefix is ~45 bytes × 500k titles */
const TMDB = /^https?:\/\/image\.tmdb\.org\/t\/p\/[^/]+\/([^/?#]+)$/
const art = (x: Json) => {
  const s = str(x)
  const m = s?.match(TMDB)
  return m ? `~${m[1]}` : s
}
const exts = new Map<string, string>()
const extOf = (x: Json) => {
  const e = str(x) ?? 'mp4'
  return exts.get(e) ?? (exts.set(e, e), e)
}

export interface XtreamResult {
  channels: Channel[]
  movies: Movie[]
  series: Show[]
  account: Account
}

/**
 * `stream`: parse the big lists while they download. `lean` (TVs): leave out what only the detail page
 * shows (series plot and backdrop, which it fetches anyway). `skip`: titles hidden by the library filters
 * are dropped as they arrive instead of being kept in memory.
 */
export async function loadXtream(
  src: Source,
  get: GetText,
  progress: (m: string) => void,
  { stream, lean, skip }: { stream?: GetStream; lean?: boolean; skip?: ((x: { name: string; group: string }) => boolean) | null } = {}
): Promise<XtreamResult> {
  if (!src.server || !src.username || !src.password) throw new Error('Server, username and password are required.')
  const base = api(src)
  progress(`${src.name}: signing in…`)
  const auth = await getJson<Json>(get, base)
  const ui = auth?.user_info
  if (!ui || +ui.auth === 0) throw new Error('Login failed. Check your username and password.')
  if (ui.status && ui.status !== 'Active') throw new Error(`Account is ${ui.status}.`)
  const account: Account = {
    status: str(ui.status),
    expires: num(ui.exp_date) ? +ui.exp_date * 1000 : undefined,
    maxConnections: num(ui.max_connections),
    activeConnections: num(ui.active_cons)
  }

  progress(`${src.name}: loading channels, movies and series…`)
  const act = (action: string) => getJson<Json>(get, `${base}&action=${action}`).catch(() => [])
  const [lc, vc, sc] = await Promise.all([act('get_live_categories'), act('get_vod_categories'), act('get_series_categories')])
  const catMap = (c: Json) => new Map(arr(c).map((x) => [String(x.category_id), str(x.category_name) ?? 'Uncategorized']))
  const lcm = catMap(lc), vcm = catMap(vc), scm = catMap(sc)

  // The big lists one after another, each turned into compact items as it arrives: providers' raw JSON can be
  // 50-100 MB per list (400k movies), and holding that plus the parsed raw objects runs a TV out of memory
  const list = async <T,>(action: string, map: (s: Json) => T): Promise<T[]> => {
    if (!stream) return arr(await act(action)).map(map).filter((x) => !skip?.(x as never))
    const out: T[] = []
    const parser = new JsonArrayStream((s) => {
      const x = map(s as Json)
      if (!skip?.(x as never)) out.push(x)
    })
    try {
      await stream(`${base}&action=${action}`, (chunk) => parser.push(chunk), 300_000)
      return out
    } catch {
      return []
    }
  }
  const channels: Channel[] = await list('get_live_streams', (s) => ({
    kind: 'live', id: `${src.id}:l${s.stream_id}`, sourceId: src.id,
    name: str(s.name) ?? 'Channel', group: lcm.get(String(s.category_id)) ?? 'Uncategorized',
    logo: str(s.stream_icon), epgId: str(s.epg_channel_id), num: num(s.num), xt: true, sid: +s.stream_id
  }))
  const movies: Movie[] = await list('get_vod_streams', (s) => ({
    kind: 'movie', id: `${src.id}:m${s.stream_id}`, sourceId: src.id,
    name: str(s.name) ?? 'Movie', group: vcm.get(String(s.category_id)) ?? 'Uncategorized',
    ext: extOf(s.container_extension), poster: art(s.stream_icon),
    rating: num(s.rating) || undefined, added: num(s.added), vodId: +s.stream_id, year: year(s.year ?? s.releasedate)
  }))
  const series: Show[] = await list('get_series', (s) => ({
    kind: 'series', id: `${src.id}:s${s.series_id}`, sourceId: src.id,
    name: str(s.name) ?? 'Series', group: scm.get(String(s.category_id)) ?? 'Uncategorized',
    poster: art(s.cover), backdrop: lean ? undefined : art(arr(s.backdrop_path)[0]), rating: num(s.rating) || undefined,
    year: year(s.releaseDate ?? s.release_date), plot: lean ? undefined : str(s.plot)?.slice(0, 240), added: num(s.last_modified), seriesId: +s.series_id
  }))
  return { channels, movies, series, account }
}

export async function xtreamInfo(src: Source, kind: 'movie' | 'series', id: number, get: GetText): Promise<MediaInfo> {
  const base = api(src)
  if (kind === 'movie') {
    const r = await getJson<Json>(get, `${base}&action=get_vod_info&vod_id=${id}`)
    const i = r?.info ?? {}
    return {
      plot: str(i.plot) ?? str(i.description), backdrop: str(arr(i.backdrop_path)[0]), poster: str(i.movie_image),
      cast: str(i.cast) ?? str(i.actors), director: str(i.director), genre: str(i.genre), duration: str(i.duration),
      rating: num(i.rating) || undefined, year: year(i.releasedate ?? i.release_date)
    }
  }
  const r = await getJson<Json>(get, `${base}&action=get_series_info&series_id=${id}`)
  const i = r?.info ?? {}
  const episodes: Episode[] = []
  for (const [season, list] of Object.entries(r?.episodes ?? {})) {
    for (const e of arr(list)) {
      episodes.push({
        id: String(e.id), title: str(e.title) ?? `Episode ${e.episode_num}`,
        season: num(e.season) ?? +season, episode: num(e.episode_num) ?? 0,
        url: xtStreamUrl(src, 'series', e.id, str(e.container_extension) ?? 'mp4'),
        plot: str(e.info?.plot), still: str(e.info?.movie_image), duration: str(e.info?.duration)
      })
    }
  }
  episodes.sort((a, b) => a.season - b.season || a.episode - b.episode)
  return {
    plot: str(i.plot), backdrop: str(arr(i.backdrop_path)[0]), poster: str(i.cover), cast: str(i.cast),
    director: str(i.director), genre: str(i.genre), rating: num(i.rating) || undefined,
    year: year(i.releaseDate ?? i.release_date), episodes
  }
}
