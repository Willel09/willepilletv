// Providers list the same film many times ("SE-4K - Kubo", "EN - Kubo (2016)", once per category).
// Merge them into one Movie whose `versions` keep every copy, so nothing becomes unplayable.
import type { Movie, MovieVersion } from '../types'

/** Leading provider tag: "SE-4K - ", "EN | ", "|NF| ", "[4K] ", "UK: ". A colon only after a 2-letter code ("TRON: Legacy" stays). */
const TAG = /^\s*(\|[^|]{1,12}\||\[[^\]]{1,12}\]|[A-Z]{2}\s*:|[A-Z0-9]{2,5}(?:[-_ ][A-Z0-9+]{1,5})?\s*[|-])\s+/
const QUALITY = /\b(4k|uhd|fhd|hd|sd|hdr10?|hevc|x26[45]|h\.?26[45]|2160p|1080p|720p|multi[- ]?sub|multi|vost(?:fr)?|subbed|dubbed)\b/gi
const YEAR = /[([]?\b((?:19|20)\d\d)\b[)\]]?\s*$/

/** Display name without the provider tag: "SE-4K - War Machine" -> "War Machine" */
export function stripTag(name: string): string {
  let s = name
  for (let i = 0; i < 2; i++) s = s.replace(TAG, '') // "SE-4K - EN - Title"
  return s.trim() || name.trim()
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Matching key: no tag, no quality words, no year, letters and digits only */
export function titleKey(name: string): string {
  return fold(stripTag(name).replace(QUALITY, ' ').replace(YEAR, '')).replace(/&/g, 'and').replace(/[^a-z0-9]/g, '')
}

const yearOf = (m: Movie) => m.year?.match(/(?:19|20)\d\d/)?.[0] ?? stripTag(m.name).replace(QUALITY, ' ').trim().match(YEAR)?.[1] ?? ''

/** "SE-4K", "EN · 1080p", or the category when the name has no tag */
function label(m: Movie): string {
  const tag = m.name.match(TAG)?.[1].replace(/[|[\]]/g, '').replace(/[\s|:-]+$/, '').trim()
  const q = [...new Set((stripTag(m.name).match(QUALITY) ?? []).map((x) => x.toUpperCase()))]
  return [tag, ...q].filter(Boolean).join(' · ') || m.group
}

const richness = (m: Movie) => (m.vodId ? 4 : 0) + (m.poster ? 2 : 0) + (m.rating ? 1 : 0) + (m.plot ? 1 : 0) + (m.year ? 1 : 0)

export function mergeMovies(movies: Movie[]): Movie[] {
  const steps = mergeSteps(movies)
  let r = steps.next()
  while (!r.done) r = steps.next()
  return r.value
}

/** Same, with a break for the UI every 5,000 titles: merging 400k in one go freezes a TV for seconds */
export async function mergeMoviesInSteps(movies: Movie[], pause = () => new Promise<void>((r) => setTimeout(r, 0))): Promise<Movie[]> {
  const steps = mergeSteps(movies)
  let r = steps.next()
  while (!r.done) {
    await pause()
    r = steps.next()
  }
  return r.value
}

function* mergeSteps(movies: Movie[]): Generator<void, Movie[]> {
  const byKey = new Map<string, Movie[]>()
  const out: Movie[][] = []
  for (let i = 0; i < movies.length; i++) {
    if (i % 5000 === 4999) yield
    const m = movies[i]
    const k = titleKey(m.name)
    const list = k ? byKey.get(k) : undefined
    if (list) list.push(m)
    else {
      const fresh = [m]
      if (k) byKey.set(k, fresh)
      out.push(fresh)
    }
  }
  const result: Movie[] = []
  for (let i = 0; i < out.length; i++) {
    if (i % 5000 === 4999) yield
    const list = out[i]
    if (list.length === 1) {
      result.push(list[0])
      continue
    }
    // same title but different years are different films (remakes); undated copies join the only dated one
    const byYear = new Map<string, Movie[]>()
    for (const m of list) {
      const y = yearOf(m)
      byYear.set(y, [...(byYear.get(y) ?? []), m])
    }
    const undated = byYear.get('')
    if (undated && byYear.size === 2) {
      byYear.delete('')
      const dated = byYear.values().next().value!
      dated.push(...undated)
    }
    for (const copies of byYear.values()) result.push(copies.length === 1 ? copies[0] : combine(copies))
  }
  return result
}

function combine(copies: Movie[]): Movie {
  const primary = copies.reduce((a, b) => (richness(b) > richness(a) ? b : a))
  const ordered = [primary, ...copies.filter((c) => c !== primary)]
  const seenUrl = new Set<string>()
  const versions: MovieVersion[] = []
  for (const c of ordered) {
    const stream = c.url ?? `${c.sourceId}:${c.vodId}` // Xtream movies have no stored URL
    if (seenUrl.has(stream)) continue
    seenUrl.add(stream)
    versions.push({ id: c.id, sourceId: c.sourceId, url: c.url, vodId: c.vodId, ext: c.ext, label: label(c) })
  }
  return {
    ...primary,
    name: stripTag(primary.name),
    poster: primary.poster ?? copies.find((c) => c.poster)?.poster,
    rating: primary.rating ?? copies.find((c) => c.rating)?.rating,
    year: primary.year ?? copies.find((c) => c.year)?.year,
    plot: primary.plot ?? copies.find((c) => c.plot)?.plot,
    added: Math.max(...copies.map((c) => c.added ?? 0)) || undefined,
    groups: [...new Set(copies.map((c) => c.group))],
    versions: versions.length > 1 ? versions : undefined
  }
}
