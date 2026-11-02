import type { Library, MovieVersion } from '../types'

type Item = { sourceId: string; versions?: (MovieVersion & { label?: string })[] }

/**
 * Adds what source `sourceId` had in `prev` to `lib`, for a source that failed to load: a provider that's down
 * for a moment must not empty the library. Merged titles give back the copies that came from that source.
 */
export function keepOld(prev: Library, sourceId: string, lib: Library) {
  for (const k of ['channels', 'movies', 'series'] as const) {
    const to = lib[k] as unknown as Item[]
    for (const x of prev[k] as unknown as Item[]) {
      if (!x.versions) {
        if (x.sourceId === sourceId) to.push(x)
        continue
      }
      for (const { label: _, ...v } of x.versions) if (v.sourceId === sourceId) to.push({ ...x, ...v, versions: undefined })
    }
  }
  if (prev.accounts[sourceId]) lib.accounts[sourceId] = prev.accounts[sourceId]
}
