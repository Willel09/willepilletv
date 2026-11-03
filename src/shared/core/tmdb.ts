// People and recommendations from TMDB (free key: themoviedb.org/settings/api). No dependencies, so the
// parsing can be tested and the same code runs on the PC, TVs and the web.

const BASE = 'https://api.themoviedb.org/3'
export const TMDB_IMG = 'https://image.tmdb.org/t/p'

export type TmdbKind = 'movie' | 'series'
export type GetJson = (url: string, headers?: Record<string, string>) => Promise<unknown>

/** A film or series a person worked on, or that TMDB recommends */
export interface TmdbTitle {
  tmdb: number
  kind: TmdbKind
  title: string
  year?: string
  /** TMDB audience rating 0-10 */
  rating?: number
  votes: number
  poster?: string
  /** the character (actors) or job (crew) */
  role?: string
}

export interface Person {
  id: number
  name: string
  photo?: string
  born?: string
  died?: string
  birthplace?: string
  /** age today, or at death */
  age?: number
  bio?: string
  department?: string
  /** the best known released films and series (at most 80), best known first */
  credits: TmdbTitle[]
  /** How many films and series, and their average rating (titles with enough votes to mean something) */
  count: number
  average?: number
}

/** A v4 "read access token" is a long JWT and goes in a header; the short v3 key goes in the address */
const bearer = (key: string) => key.length > 40

export function tmdbUrl(key: string, path: string, params: Record<string, string | number | undefined> = {}) {
  const p = new URLSearchParams()
  if (!bearer(key)) p.set('api_key', key)
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v))
  return `${BASE}${path}?${p}`
}

const headers = (key: string) => (bearer(key) ? { Authorization: `Bearer ${key}` } : undefined)

async function call<T>(get: GetJson, key: string, path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  try {
    return (await get(tmdbUrl(key, path, params), headers(key))) as T
  } catch (e) {
    if (/\b401\b/.test((e as Error).message)) throw new Error('TMDB did not accept the key. Check it in Settings.')
    throw e
  }
}

const yearOf = (d?: string) => d?.slice(0, 4) || undefined

type RawTitle = {
  id: number
  media_type?: string
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  vote_average?: number
  vote_count?: number
  poster_path?: string | null
  character?: string
  job?: string
  genre_ids?: number[]
  episode_count?: number
}

/** TMDB's talk shows, news and reality programmes: appearances "as himself", not work */
const NOT_WORK = new Set([10763, 10764, 10767])

export function parseTitle(r: RawTitle, kind?: TmdbKind): TmdbTitle | null {
  const k: TmdbKind | null = kind ?? (r.media_type === 'movie' ? 'movie' : r.media_type === 'tv' ? 'series' : null)
  if (!k || !r.id) return null
  const title = r.title ?? r.name
  if (!title) return null
  return {
    tmdb: r.id,
    kind: k,
    title,
    year: yearOf(r.release_date ?? r.first_air_date),
    rating: r.vote_average ? Math.round(r.vote_average * 10) / 10 : undefined,
    votes: r.vote_count ?? 0,
    poster: r.poster_path ? `${TMDB_IMG}/w342${r.poster_path}` : undefined,
    role: r.character || r.job || undefined
  }
}

/** Age in whole years on `on` (a date), from a "YYYY-MM-DD" birthday */
export function ageOn(born: string, on: Date): number | undefined {
  const m = born.match(/^(\d{4})-(\d\d)-(\d\d)/)
  if (!m) return
  const age = on.getUTCFullYear() - +m[1] - (on.getUTCMonth() + 1 < +m[2] || (on.getUTCMonth() + 1 === +m[2] && on.getUTCDate() < +m[3]) ? 1 : 0)
  return age >= 0 && age < 130 ? age : undefined
}

type RawPerson = {
  id: number
  name: string
  profile_path?: string | null
  birthday?: string | null
  deathday?: string | null
  place_of_birth?: string | null
  biography?: string
  known_for_department?: string
  combined_credits?: { cast?: RawTitle[]; crew?: RawTitle[] }
}

/**
 * A person page. Directors (and other crew) count their directing work, actors their roles. Credits that are
 * not out yet, or are talk-show appearances, are left out.
 */
export function parsePerson(j: RawPerson, role: 'actor' | 'director', now = new Date()): Person {
  const raw = role === 'director' ? (j.combined_credits?.crew ?? []).filter((c) => c.job === 'Director') : (j.combined_credits?.cast ?? []).filter((c) => !c.genre_ids?.some((g) => NOT_WORK.has(g)))
  const seen = new Set<string>()
  const credits: TmdbTitle[] = []
  for (const r of raw) {
    const t = parseTitle(r)
    if (!t || !t.year || +t.year > now.getFullYear() || seen.has(`${t.kind}${t.tmdb}`)) continue
    seen.add(`${t.kind}${t.tmdb}`)
    credits.push(t)
  }
  credits.sort((a, b) => b.votes - a.votes)
  // titles with a handful of votes would swing the average
  const rated = credits.filter((c) => c.rating && c.votes >= 20)
  const average = rated.length ? Math.round((rated.reduce((s, c) => s + c.rating!, 0) / rated.length) * 10) / 10 : undefined
  const died = j.deathday || undefined
  return {
    id: j.id,
    name: j.name,
    photo: j.profile_path ? `${TMDB_IMG}/w342${j.profile_path}` : undefined,
    born: j.birthday || undefined,
    died,
    birthplace: j.place_of_birth || undefined,
    age: j.birthday ? ageOn(j.birthday, died ? new Date(died) : now) : undefined,
    bio: j.biography?.trim() || undefined,
    department: j.known_for_department,
    credits: credits.slice(0, 80), // the best known; count and average cover all of them
    count: credits.length,
    average
  }
}

/** Looks a person up by name: the best-known one with exactly that name, otherwise the first hit */
export async function findPerson(get: GetJson, key: string, name: string): Promise<number | null> {
  const r = await call<{ results?: { id: number; name: string; popularity?: number }[] }>(get, key, '/search/person', { query: name })
  const hits = r.results ?? []
  const same = hits.filter((h) => h.name.toLowerCase() === name.toLowerCase())
  return (same.length ? same : hits)[0]?.id ?? null
}

export async function fetchPerson(get: GetJson, key: string, name: string, role: 'actor' | 'director'): Promise<Person | null> {
  const id = await findPerson(get, key, name)
  if (!id) return null
  return parsePerson(await call<RawPerson>(get, key, `/person/${id}`, { append_to_response: 'combined_credits' }), role)
}

/** TMDB id of a title: by IMDb id when known, otherwise by name and year */
export async function resolveTmdb(get: GetJson, key: string, q: { kind: TmdbKind; title: string; year?: string; imdbId?: string }): Promise<number | null> {
  if (q.imdbId) {
    const r = await call<{ movie_results?: { id: number }[]; tv_results?: { id: number }[] }>(get, key, `/find/${q.imdbId}`, { external_source: 'imdb_id' })
    const id = (q.kind === 'movie' ? r.movie_results : r.tv_results)?.[0]?.id
    if (id) return id
  }
  const r = await call<{ results?: { id: number }[] }>(get, key, q.kind === 'movie' ? '/search/movie' : '/search/tv', {
    query: q.title,
    ...(q.year ? (q.kind === 'movie' ? { year: q.year } : { first_air_date_year: q.year }) : {})
  })
  return r.results?.[0]?.id ?? null
}

/** What TMDB recommends after this title (viewers of it also watched), padded with similar titles */
export async function fetchRecommendations(get: GetJson, key: string, kind: TmdbKind, tmdb: number): Promise<TmdbTitle[]> {
  const path = `/${kind === 'movie' ? 'movie' : 'tv'}/${tmdb}`
  const [rec, sim] = await Promise.all([
    call<{ results?: RawTitle[] }>(get, key, `${path}/recommendations`),
    call<{ results?: RawTitle[] }>(get, key, `${path}/similar`).catch(() => ({ results: [] as RawTitle[] }))
  ])
  const seen = new Set<number>()
  const out: TmdbTitle[] = []
  for (const r of [...(rec.results ?? []), ...(sim.results ?? [])]) {
    const t = parseTitle(r, kind)
    if (t && !seen.has(t.tmdb)) (seen.add(t.tmdb), out.push(t))
  }
  return out
}
