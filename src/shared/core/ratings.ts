// Real ratings (IMDb, Rotten Tomatoes, Metacritic) from OMDb. Free key: 1,000 lookups a day, see omdbapi.com.

export interface Ratings {
  imdb?: number
  /** IMDb vote count */
  votes?: number
  /** Rotten Tomatoes Tomatometer, 0-100 */
  rt?: number
  /** Metacritic Metascore, 0-100 */
  meta?: number
  imdbId?: string
}

export interface RatingQuery {
  kind: 'movie' | 'series'
  title: string
  year?: string
  imdbId?: string
}

export const omdbUrl = (key: string, q: RatingQuery, withYear = true) => {
  const p = new URLSearchParams({ apikey: key, type: q.kind })
  if (q.imdbId) p.set('i', q.imdbId)
  else {
    p.set('t', q.title)
    if (withYear && q.year) p.set('y', q.year)
  }
  return `https://www.omdbapi.com/?${p}`
}

type Omdb = { Response?: string; Error?: string; imdbRating?: string; imdbVotes?: string; Metascore?: string; imdbID?: string; Ratings?: { Source: string; Value: string }[] }

/** null = not found; throws on a key/limit error so it isn't cached as "no ratings" */
export function parseOmdb(j: Omdb): Ratings | null {
  if (j.Response !== 'True') {
    if (/not found/i.test(j.Error ?? '')) return null
    throw new Error(j.Error || 'OMDb error')
  }
  const n = (s?: string) => (s && s !== 'N/A' ? parseFloat(s.replace(/,/g, '')) : undefined)
  const rt = j.Ratings?.find((r) => r.Source === 'Rotten Tomatoes')?.Value
  const r: Ratings = { imdb: n(j.imdbRating), votes: n(j.imdbVotes), rt: n(rt), meta: n(j.Metascore), imdbId: j.imdbID }
  return r.imdb || r.rt || r.meta ? r : null
}

/** Looks a title up by IMDb id, or by title + year, then title alone (provider years are often off by one) */
export async function fetchRatings(key: string, q: RatingQuery, fetchFn: typeof fetch = fetch): Promise<Ratings | null> {
  const get = async (withYear: boolean) => parseOmdb((await (await fetchFn(omdbUrl(key, q, withYear))).json()) as Omdb)
  return (await get(true)) ?? (!q.imdbId && q.year ? get(false) : null)
}
