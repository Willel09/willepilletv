import { useEffect, useState } from 'react'
import { titleKey } from '../../../shared/core/dedupe'
import { fetchGenreTitles, fetchPerson, fetchRecommendations, fetchTrailer, MOVIE_GENRES, resolveTmdb, SERIES_GENRES, type GetJson, type Person, type TmdbKind, type TmdbTitle, type Trailer } from '../../../shared/core/tmdb'
import type { Movie, Show } from '../../../shared/types'
import { cleanName } from './format'
import { index, useApp } from '../store'

type Title = Movie | Show

/* ---------------- lookups, remembered on the device ---------------- */

const get: GetJson = async (url, headers) => {
  const r = await fetch(url, { headers })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

const CACHE = 'lumen:tmdb'
const MAX = 150
const DAY = 86400_000
type Entry = [unknown, number]
let mem: Record<string, Entry> | null = null
const table = () => {
  try {
    return (mem ??= JSON.parse(localStorage.getItem(CACHE) ?? '{}'))!
  } catch {
    return (mem = {})
  }
}
function remember(id: string, v: unknown) {
  const t = table()
  t[id] = [v, Date.now()]
  const keys = Object.keys(t)
  if (keys.length > MAX) for (const k of keys.sort((a, b) => t[a][1] - t[b][1]).slice(0, keys.length - MAX)) delete t[k]
  try {
    localStorage.setItem(CACHE, JSON.stringify(t))
  } catch {
    /* storage full: keep it in memory only */
  }
}

/** A lookup kept for `days`; not found is kept for one day. Errors are not kept. Concurrent asks share one request. */
const inflight = new Map<string, Promise<unknown>>()
async function cached<T>(id: string, days: number, fn: () => Promise<T | null>): Promise<T | null> {
  const hit = table()[id]
  if (hit && Date.now() - hit[1] < (hit[0] === null ? 1 : days) * DAY) return hit[0] as T | null
  let p = inflight.get(id) as Promise<T | null> | undefined
  if (!p) {
    p = fn()
      .then((v) => (remember(id, v), v))
      .finally(() => inflight.delete(id))
    inflight.set(id, p)
  }
  return p
}

const kindOf = (x: Title): TmdbKind => (x.kind === 'movie' ? 'movie' : 'series')

/** TMDB id of a library title: from the provider when it sent one, otherwise looked up once */
export async function tmdbIdOf(key: string, x: Title, imdbId?: string): Promise<number | null> {
  if (x.tmdb) return x.tmdb
  const title = cleanName(x.name).replace(/\s*\(?\b(19|20)\d\d\)?\s*$/, '')
  return cached(`id:${kindOf(x)}:${imdbId ?? title.toLowerCase()}:${x.year ?? ''}`, 60, () => resolveTmdb(get, key, { kind: kindOf(x), title, year: x.year?.match(/(19|20)\d\d/)?.[0], imdbId }))
}

export const recommendationsFor = (key: string, kind: TmdbKind, tmdb: number) =>
  cached<TmdbTitle[]>(`rec:${kind}:${tmdb}`, 7, async () => fetchRecommendations(get, key, kind, tmdb))

/* ---------------- what the library has ---------------- */

const pause = () => new Promise<void>((r) => setTimeout(r, 0))
// answers per library list, so asking again for the same title costs nothing
const found = new WeakMap<object, Map<string, Title | null>>()
const yearOf = (x: Title) => x.year?.match(/(19|20)\d\d/)?.[0]

/**
 * The library's copy of each TMDB title: by TMDB id when the provider sent one, otherwise by name and year.
 * One pass over the library for all of them, with breaks for the screen (500k titles).
 */
/** Key of a TMDB title in matchLibrary's answer: a film and a series can share a number */
export const tmdbKey = (c: { kind: TmdbKind; tmdb: number }) => `${c.kind}${c.tmdb}`

export async function matchLibrary(cands: TmdbTitle[]): Promise<Map<string, Title>> {
  const idx = index()
  const memo = found.get(idx.movies) ?? (found.set(idx.movies, new Map()), found.get(idx.movies)!)
  const out = new Map<string, Title>()
  const todo = new Map<string, TmdbTitle>()
  for (const c of cands) {
    const k = tmdbKey(c)
    const m = memo.get(k)
    if (m) out.set(k, m)
    else if (m === undefined) todo.set(k, c)
  }
  if (todo.size) {
    const byTitle = new Map<string, TmdbTitle[]>()
    for (const c of todo.values()) {
      const k = c.kind + titleKey(c.title)
      byTitle.set(k, [...(byTitle.get(k) ?? []), c])
    }
    const hit = new Map<string, Title>()
    let n = 0
    for (const list of [idx.movies, idx.series] as Title[][])
      for (const x of list) {
        if (++n % 20_000 === 0) await pause()
        const kind = kindOf(x)
        const byId = x.tmdb ? todo.get(`${kind}${x.tmdb}`) : undefined
        if (byId) {
          hit.set(`${kind}${byId.tmdb}`, x)
          continue
        }
        // a title the provider gave a TMDB id is a different title unless the id matches
        if (x.tmdb) continue
        const cs = byTitle.get(kind + titleKey(x.name))
        if (!cs) continue
        const y = yearOf(x)
        for (const c of cs) if (!hit.has(`${kind}${c.tmdb}`) && (!y || !c.year || Math.abs(+y - +c.year) <= 1)) hit.set(`${kind}${c.tmdb}`, x)
      }
    for (const [k, c] of todo) {
      const x = hit.get(k) ?? null
      memo.set(k, x)
      if (x) out.set(k, x)
    }
  }
  return out
}

/** The recommended titles that are in the library, in TMDB's order */
export async function inLibrary(recs: TmdbTitle[], skipTmdb?: number): Promise<Title[]> {
  const m = await matchLibrary(recs.filter((r) => r.tmdb !== skipTmdb))
  const seen = new Set<string>()
  const out: Title[] = []
  for (const r of recs) {
    const x = m.get(tmdbKey(r))
    if (x && !seen.has(x.id)) (seen.add(x.id), out.push(x))
  }
  return out
}

/* ---------------- hooks ---------------- */

export type PersonState = { status: 'nokey' | 'loading' | 'missing' | 'ready' | 'error'; person?: Person; error?: string }

export function usePerson(name: string, role: 'actor' | 'director'): PersonState {
  const key = useApp((s) => s.settings.tmdbKey)
  const [state, setState] = useState<PersonState>({ status: key ? 'loading' : 'nokey' })
  useEffect(() => {
    if (!key) return setState({ status: 'nokey' })
    let live = true
    setState({ status: 'loading' })
    cached<Person>(`person:${role}:${name.toLowerCase()}`, 14, () => fetchPerson(get, key, name, role)).then(
      (person) => live && setState(person ? { status: 'ready', person } : { status: 'missing' }),
      (e: Error) => live && setState({ status: 'error', error: e.message })
    )
    return () => void (live = false)
  }, [key, name, role])
  return state
}

/** Library titles TMDB recommends after this one (pass null to wait) */
export function useSimilar(item: Title | null, imdbId?: string): Title[] {
  const key = useApp((s) => s.settings.tmdbKey)
  const [list, setList] = useState<Title[]>([])
  const id = item && `${item.id}|${imdbId ?? ''}`
  useEffect(() => {
    setList([])
    if (!key || !item) return
    let live = true
    void (async () => {
      const tmdb = await tmdbIdOf(key, item, imdbId)
      if (!tmdb) return
      const recs = await recommendationsFor(key, kindOf(item), tmdb)
      const titles = recs ? (await inLibrary(recs, tmdb)).filter((x) => x.id !== item.id) : []
      if (live) setList(titles.slice(0, 30))
    })().catch(() => {}) // recommendations are a bonus: a failed lookup leaves the category list
    return () => void (live = false)
  }, [key, id]) // eslint-disable-line react-hooks/exhaustive-deps
  return list
}

/**
 * "Recommended for you": what TMDB recommends after the latest things you watched or saved, titles that several
 * of them recommend first, then the better rated. Waits a moment after start so the library gets the CPU first.
 */
export function useRecommended(signals: Title[]): Title[] {
  const key = useApp((s) => s.settings.tmdbKey)
  const [list, setList] = useState<Title[]>([])
  const sig = signals.map((s) => s.id).join('|')
  useEffect(() => {
    if (!key || !signals.length) return setList([])
    let live = true
    const timer = setTimeout(() => {
      void (async () => {
        const have = new Set<number>()
        const score = new Map<number, { t: TmdbTitle; s: number }>()
        await Promise.all(
          signals.slice(0, 6).map(async (x, i) => {
            const tmdb = await tmdbIdOf(key, x)
            if (!tmdb) return
            have.add(tmdb)
            const recs = await recommendationsFor(key, kindOf(x), tmdb)
            // recent signals count more; only the first 20 recommendations are close
            recs?.slice(0, 20).forEach((t, j) => {
              const e = score.get(t.tmdb) ?? { t, s: 0 }
              e.s += (1 - i * 0.12) * (1 - j * 0.02) + (t.rating ?? 6) / 40
              score.set(t.tmdb, e)
            })
          })
        )
        const ranked = [...score.values()].filter((e) => !have.has(e.t.tmdb)).sort((a, b) => b.s - a.s).slice(0, 80).map((e) => e.t)
        const titles = await inLibrary(ranked)
        const seen = new Set(signals.map((s) => s.id))
        if (live) setList(titles.filter((x) => !seen.has(x.id)).slice(0, 30))
      })().catch(() => {})
    }, 1500)
    return () => (clearTimeout(timer), void (live = false))
  }, [key, sig]) // eslint-disable-line react-hooks/exhaustive-deps
  return list
}

/** The trailer on YouTube, when TMDB has one (pass null to wait) */
export function useTrailer(item: Title | null, imdbId?: string): Trailer | null {
  const key = useApp((s) => s.settings.tmdbKey)
  const [t, setT] = useState<Trailer | null>(null)
  const id = item && `${item.id}|${imdbId ?? ''}`
  useEffect(() => {
    setT(null)
    if (!key || !item) return
    let live = true
    void (async () => {
      const tmdb = await tmdbIdOf(key, item, imdbId)
      if (!tmdb) return
      const r = await cached<Trailer>(`trailer:${kindOf(item)}:${tmdb}`, 14, () => fetchTrailer(get, key, kindOf(item), tmdb))
      if (live) setT(r)
    })().catch(() => {})
    return () => void (live = false)
  }, [key, id]) // eslint-disable-line react-hooks/exhaustive-deps
  return t
}

export interface GenreRow {
  name: string
  kind: TmdbKind
  items: Title[]
}

/**
 * Rows like "Thriller" and "Crime series": TMDB's most popular titles of each genre, the ones your library has.
 * Starts a few seconds after the app so the library and the recommendations get the CPU first.
 */
export function useGenreRows(): GenreRow[] {
  const key = useApp((s) => s.settings.tmdbKey)
  const library = useApp((s) => s.library)
  const [rows, setRows] = useState<GenreRow[]>([])
  useEffect(() => {
    if (!key || !library) return setRows([])
    let live = true
    const timer = setTimeout(() => {
      void (async () => {
        const jobs = [...MOVIE_GENRES.map((g) => ({ g, kind: 'movie' as const })), ...SERIES_GENRES.map((g) => ({ g, kind: 'series' as const }))]
        const lists = await Promise.all(jobs.map(({ g, kind }) => cached<TmdbTitle[]>(`genre:${kind}:${g.id}`, 7, () => fetchGenreTitles(get, key, kind, g.id)).catch(() => null)))
        // one pass over the library for all of them
        const m = await matchLibrary(lists.flatMap((l) => l ?? []))
        const out: GenreRow[] = []
        jobs.forEach(({ g, kind }, i) => {
          const seen = new Set<string>()
          const items: Title[] = []
          for (const t of lists[i] ?? []) {
            const x = m.get(tmdbKey(t))
            if (x && !seen.has(x.id)) (seen.add(x.id), items.push(x))
          }
          if (items.length >= 6) out.push({ name: kind === 'movie' ? g.name : `${g.name} series`, kind, items: items.slice(0, 30) })
        })
        if (live) setRows(out)
      })().catch(() => {})
    }, 3500)
    return () => (clearTimeout(timer), void (live = false))
  }, [key, library])
  return rows
}
