// Home page rows built from the library and what you've watched or saved.
import type { Movie, Show } from '../../../shared/types'

type Title = Movie | Show
const groupsOf = (t: { group: string; groups?: string[] }) => t.groups ?? [t.group]

/** Newest first; titles without artwork go last so rows look good */
export const newest = (xs: Title[], n = 30) =>
  [...xs].sort((a, b) => Number(!!b.poster) - Number(!!a.poster) || (b.added ?? 0) - (a.added ?? 0)).slice(0, n)

export const topRated = (xs: Title[], n = 30) =>
  xs.filter((x) => (x.rating ?? 0) >= 7 && x.poster).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.added ?? 0) - (a.added ?? 0)).slice(0, n)

/**
 * "For You": titles from the categories of what you watched / saved (recent signals count more),
 * nudged by rating and freshness. Excludes what you've already seen or saved.
 */
export function forYou(signals: { id: string; group: string; groups?: string[] }[], pool: Title[], n = 30): Title[] {
  if (!signals.length) return []
  const weight = new Map<string, number>()
  signals.forEach((s, i) => {
    for (const g of groupsOf(s)) weight.set(g, (weight.get(g) ?? 0) + 1 / (1 + i * 0.15))
  })
  const seen = new Set(signals.map((s) => s.id))
  const newestAdded = Math.max(1, ...pool.slice(0, 5000).map((x) => x.added ?? 0))
  const scored: { t: Title; s: number }[] = []
  for (const t of pool) {
    if (seen.has(t.id) || !t.poster) continue
    const g = Math.max(0, ...groupsOf(t).map((x) => weight.get(x) ?? 0))
    if (!g) continue
    scored.push({ t, s: g + ((t.rating ?? 6) - 6) * 0.15 + ((t.added ?? 0) / newestAdded) * 0.3 })
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.t)
}
