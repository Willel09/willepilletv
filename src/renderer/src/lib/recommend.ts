// Home page rows built from the library and what you've watched or saved.
// Libraries can hold 500k titles and TVs are slow, so every row is one pass that keeps only the best few:
// sorting everything to show 30 posters froze a TV for seconds.
import type { Movie, Show } from '../../../shared/types'

type Title = Movie | Show
const groupsOf = (t: { group: string; groups?: string[] }) => t.groups ?? [t.group]

type Score<T> = (x: T) => number | null
type Best<T> = { x: T; s: number }[]

function offer<T>(best: Best<T>, n: number, x: T, s: number | null) {
  if (s === null || (best.length === n && s <= best[n - 1].s)) return
  let i = best.length
  while (i > 0 && best[i - 1].s < s) i--
  best.splice(i, 0, { x, s })
  if (best.length > n) best.pop()
}

/** The n highest-scoring items (null = skip), best first; equal scores keep list order */
export function top<T>(lists: T[][], n: number, score: Score<T>): T[] {
  const best: Best<T> = []
  for (const list of lists) for (const x of list) offer(best, n, x, score(x))
  return best.map((b) => b.x)
}

/**
 * Several rows in one pass, with a break for the screen every 20,000 items: five separate passes over
 * 500k titles froze a TV for about two seconds.
 */
export async function topMany<T>(lists: T[][], rows: { n: number; score: Score<T> }[], pause = () => new Promise<void>((r) => setTimeout(r, 0))): Promise<T[][]> {
  const best: Best<T>[] = rows.map(() => [])
  let done = 0
  for (const list of lists)
    for (const x of list) {
      for (let r = 0; r < rows.length; r++) offer(best[r], rows[r].n, x, rows[r].score(x))
      if (++done % 20_000 === 0) await pause()
    }
  return best.map((b) => b.map((e) => e.x))
}

/** Newest first; titles without artwork go last so rows look good */
export const newestScore = (only?: (x: Title) => boolean) => (x: Title) => (only && !only(x) ? null : (x.poster ? 1e13 : 0) + (x.added ?? 0))
export const newest = (xs: Title[], n = 30, only?: (x: Title) => boolean) => top([xs], n, newestScore(only))

/** Rated 7+, with artwork; rating first (to 0.01), then newest */
export const topRatedScore = (x: Title) => ((x.rating ?? 0) >= 7 && x.poster ? x.rating! * 1e12 + (x.added ?? 0) : null)
export const topRated = (lists: Title[][], n = 30) => top(lists, n, topRatedScore)

/**
 * "For You": titles from the categories of what you watched / saved (recent signals count more),
 * nudged by rating and freshness. Excludes what you've already seen or saved.
 */
export const forYou = (signals: { id: string; group: string; groups?: string[] }[], pools: Title[][], n = 30): Title[] => {
  const score = forYouScore(signals, pools)
  return score ? top(pools, n, score) : []
}

export function forYouScore(signals: { id: string; group: string; groups?: string[] }[], pools: Title[][]): Score<Title> | null {
  if (!signals.length) return null
  const weight = new Map<string, number>()
  signals.forEach((s, i) => {
    for (const g of groupsOf(s)) weight.set(g, (weight.get(g) ?? 0) + 1 / (1 + i * 0.15))
  })
  const seen = new Set(signals.map((s) => s.id))
  let newestAdded = 1
  for (const p of pools) for (let i = 0; i < Math.min(5000, p.length); i++) newestAdded = Math.max(newestAdded, p[i].added ?? 0)
  return (t) => {
    if (seen.has(t.id) || !t.poster) return null
    let g = 0
    for (const x of groupsOf(t)) g = Math.max(g, weight.get(x) ?? 0)
    return g ? g + ((t.rating ?? 6) - 6) * 0.15 + ((t.added ?? 0) / newestAdded) * 0.3 : null
  }
}
