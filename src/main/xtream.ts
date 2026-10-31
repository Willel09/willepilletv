import type { Account, Channel, Episode, MediaInfo, Movie, Show, Source } from '../shared/types'
import { getJson } from './http'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any

export function xtBase(server: string): string {
  let s = server.trim()
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`
  return s.replace(/\/(player_api|get|panel_api|xmltv)\.php.*$/i, '').replace(/\/+$/, '')
}

const api = (src: Source) =>
  `${xtBase(src.server!)}/player_api.php?username=${encodeURIComponent(src.username!)}&password=${encodeURIComponent(src.password!)}`

const path = (src: Source, kind: 'live' | 'movie' | 'series', id: string | number, ext: string) =>
  `${xtBase(src.server!)}/${kind}/${encodeURIComponent(src.username!)}/${encodeURIComponent(src.password!)}/${id}.${ext}`

export const xtEpgUrl = (src: Source) =>
  `${xtBase(src.server!)}/xmltv.php?username=${encodeURIComponent(src.username!)}&password=${encodeURIComponent(src.password!)}`

const arr = (x: Json): Json[] => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : [])
const num = (x: Json) => (x === null || x === undefined || x === '' || isNaN(+x) ? undefined : +x)
const str = (x: Json) => (typeof x === 'string' && x.trim() ? x.trim() : undefined)
const year = (x: Json) => str(x)?.match(/\d{4}/)?.[0]

export interface XtreamResult {
  channels: Channel[]
  movies: Movie[]
  series: Show[]
  account: Account
}

export async function loadXtream(src: Source, ua: string, progress: (m: string) => void): Promise<XtreamResult> {
  if (!src.server || !src.username || !src.password) throw new Error('Server, username and password are required.')
  const base = api(src)
  progress(`${src.name}: signing in…`)
  const auth = await getJson<Json>(base, ua)
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
  const get = (action: string) => getJson<Json>(`${base}&action=${action}`, ua).catch(() => [])
  const [lc, ls, vc, vs, sc, ss] = await Promise.all([
    get('get_live_categories'), get('get_live_streams'),
    get('get_vod_categories'), get('get_vod_streams'),
    get('get_series_categories'), get('get_series')
  ])
  const catMap = (c: Json) => new Map(arr(c).map((x) => [String(x.category_id), str(x.category_name) ?? 'Uncategorized']))
  const lcm = catMap(lc), vcm = catMap(vc), scm = catMap(sc)

  const channels: Channel[] = arr(ls).map((s) => ({
    kind: 'live', id: `${src.id}:l${s.stream_id}`, sourceId: src.id,
    name: str(s.name) ?? 'Channel', group: lcm.get(String(s.category_id)) ?? 'Uncategorized',
    url: path(src, 'live', s.stream_id, 'ts'), logo: str(s.stream_icon), epgId: str(s.epg_channel_id),
    num: num(s.num), xt: true
  }))
  const movies: Movie[] = arr(vs).map((s) => ({
    kind: 'movie', id: `${src.id}:m${s.stream_id}`, sourceId: src.id,
    name: str(s.name) ?? 'Movie', group: vcm.get(String(s.category_id)) ?? 'Uncategorized',
    url: path(src, 'movie', s.stream_id, str(s.container_extension) ?? 'mp4'), poster: str(s.stream_icon),
    rating: num(s.rating) || undefined, added: num(s.added), vodId: +s.stream_id, year: year(s.year ?? s.releasedate)
  }))
  const series: Show[] = arr(ss).map((s) => ({
    kind: 'series', id: `${src.id}:s${s.series_id}`, sourceId: src.id,
    name: str(s.name) ?? 'Series', group: scm.get(String(s.category_id)) ?? 'Uncategorized',
    poster: str(s.cover), backdrop: str(arr(s.backdrop_path)[0]), rating: num(s.rating) || undefined,
    year: year(s.releaseDate ?? s.release_date), plot: str(s.plot), added: num(s.last_modified), seriesId: +s.series_id
  }))
  return { channels, movies, series, account }
}

export async function xtreamInfo(src: Source, kind: 'movie' | 'series', id: number, ua: string): Promise<MediaInfo> {
  const base = api(src)
  if (kind === 'movie') {
    const r = await getJson<Json>(`${base}&action=get_vod_info&vod_id=${id}`, ua)
    const i = r?.info ?? {}
    return {
      plot: str(i.plot) ?? str(i.description), backdrop: str(arr(i.backdrop_path)[0]), poster: str(i.movie_image),
      cast: str(i.cast) ?? str(i.actors), director: str(i.director), genre: str(i.genre), duration: str(i.duration),
      rating: num(i.rating) || undefined, year: year(i.releasedate ?? i.release_date)
    }
  }
  const r = await getJson<Json>(`${base}&action=get_series_info&series_id=${id}`, ua)
  const i = r?.info ?? {}
  const episodes: Episode[] = []
  for (const [season, list] of Object.entries(r?.episodes ?? {})) {
    for (const e of arr(list)) {
      episodes.push({
        id: String(e.id), title: str(e.title) ?? `Episode ${e.episode_num}`,
        season: num(e.season) ?? +season, episode: num(e.episode_num) ?? 0,
        url: path(src, 'series', e.id, str(e.container_extension) ?? 'mp4'),
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
