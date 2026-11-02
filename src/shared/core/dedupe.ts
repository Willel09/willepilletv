// Providers list the same film or series many times ("SE-[4K-Q] - Kubo", "EN - Kubo (2016) [1080p]", once per
// category, once per language). Merge them into one title whose `versions` keep every copy, so nothing
// becomes unplayable. The TMDB id, when the provider sends it, also joins translated titles.
import type { Movie, MovieVersion, Show } from '../types'

type Title = Movie | Show

/** Leading provider tag: "SE-4K - ", "SC-[4K-Q] - ", "EN | ", "|NF| ", "[4K] ", "UK: ". A colon only after a 2-letter code ("TRON: Legacy" stays). */
// The separator before each extra alphanumeric part is required: with it optional, an all-caps title
// ("MISSION IMPOSSIBLE DEAD RECKONING") could be split in exponentially many ways (seconds per name).
const TAG = /^\s*(\|[^|]{1,12}\||\[[^\]]{1,12}\]|[A-Z]{2}\s*:|[A-Z0-9]{2,5}(?:[-_ ]?\[[^\]]{1,10}\]|[-_ ][A-Z0-9+]{1,5})*\s*[|-])\s+/
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
  const s = stripTag(name).replace(/\[[^\]]*\]/g, ' ').replace(/\((?:19|20)\d\d\)/g, ' ') // "[1080p]", "(2026)" anywhere
  return fold(s.replace(QUALITY, ' ').replace(YEAR, '')).replace(/&/g, 'and').replace(/[^a-z0-9]/g, '')
}

const yearOf = (m: Title) => m.year?.match(/(?:19|20)\d\d/)?.[0] ?? m.name.match(/\(((?:19|20)\d\d)\)/)?.[1] ?? stripTag(m.name).replace(QUALITY, ' ').trim().match(YEAR)?.[1] ?? ''

/** "SE-4K", "EN · 1080p", or the category when the name has no tag */
function label(m: Title): string {
  const tag = m.name.match(TAG)?.[1].replace(/[|[\]]/g, '').replace(/[\s|:-]+$/, '').trim()
  const q = [...new Set((stripTag(m.name).match(QUALITY) ?? []).map((x) => x.toUpperCase()))]
  return [tag, ...q].filter(Boolean).join(' · ') || m.group
}

const richness = (m: Title) => ((m.kind === 'movie' ? m.vodId : m.seriesId) ? 4 : 0) + (m.poster ? 2 : 0) + (m.rating ? 1 : 0) + (m.plot ? 1 : 0) + (m.year ? 1 : 0)

export function mergeMovies<T extends Title>(items: T[]): T[] {
  const steps = mergeSteps(items)
  let r = steps.next()
  while (!r.done) r = steps.next()
  return r.value
}

/** Same, with a break for the UI every 5,000 titles: merging 400k in one go freezes a TV for seconds */
export async function mergeMoviesInSteps<T extends Title>(items: T[], pause = () => new Promise<void>((r) => setTimeout(r, 0)), onProgress?: (done: number) => void): Promise<T[]> {
  const steps = mergeSteps(items)
  let r = steps.next()
  while (!r.done) {
    onProgress?.(r.value)
    await pause()
    r = steps.next()
  }
  return r.value
}

/** Yields how far it is (0-1) every 5,000 titles */
function* mergeSteps<T extends Title>(items: T[]): Generator<number, T[]> {
  // 1. title keys, and which TMDB id each title key belongs to (so copies without the id join those with it)
  const keys: string[] = new Array(items.length)
  const idOf = new Map<string, number | 0>() // 0 = two different films share the title: don't guess
  for (let i = 0; i < items.length; i++) {
    if (i % 5000 === 4999) yield (i / items.length) * 0.6
    const k = (keys[i] = titleKey(items[i].name))
    const t = items[i].tmdb
    if (k && t) idOf.set(k, idOf.has(k) && idOf.get(k) !== t ? 0 : t)
  }
  // 2. group by TMDB id (any language) or by title
  const byKey = new Map<string, T[]>()
  const out: T[][] = []
  for (let i = 0; i < items.length; i++) {
    if (i % 5000 === 4999) yield 0.6 + (i / items.length) * 0.2
    const m = items[i]
    const t = m.tmdb || idOf.get(keys[i])
    // M3U series carry their episodes inside: merged, the other copies' episodes would be out of reach
    const k = m.kind === 'series' && !m.seriesId ? '' : t ? `t${t}` : keys[i] ? `k${keys[i]}` : ''
    const list = k ? byKey.get(k) : undefined
    if (list) list.push(m)
    else {
      const fresh = [m]
      if (k) byKey.set(k, fresh)
      out.push(fresh)
    }
  }
  const result: T[] = []
  for (let i = 0; i < out.length; i++) {
    if (i % 5000 === 4999) yield 0.8 + (i / out.length) * 0.2
    const list = out[i]
    if (list.length === 1) {
      result.push(list[0])
      continue
    }
    // a shared TMDB id is the same title for sure; by name, different years are different films (remakes)
    if (list.some((m) => m.tmdb)) {
      result.push(combine(list))
      continue
    }
    const byYear = new Map<string, T[]>()
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

function combine<T extends Title>(copies: T[]): T {
  const primary = copies.reduce((a, b) => (richness(b) > richness(a) ? b : a))
  const ordered = [primary, ...copies.filter((c) => c !== primary)]
  const seenUrl = new Set<string>()
  const versions: MovieVersion[] = []
  for (const c of ordered) {
    // what identifies the copy's stream (Xtream items have no stored URL)
    const stream = c.kind === 'movie' ? c.url ?? `${c.sourceId}:m${c.vodId}` : `${c.sourceId}:s${c.seriesId ?? c.id}`
    if (seenUrl.has(stream)) continue
    seenUrl.add(stream)
    versions.push(c.kind === 'movie' ? { id: c.id, sourceId: c.sourceId, url: c.url, vodId: c.vodId, ext: c.ext, label: label(c) } : { id: c.id, sourceId: c.sourceId, seriesId: c.seriesId, label: label(c) })
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
