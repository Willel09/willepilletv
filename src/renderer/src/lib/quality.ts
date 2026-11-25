import type { MovieVersion } from '../../../shared/types'

export type Quality = 'auto' | '4k' | '1080p' | '720p'
const HEIGHT = { '4k': 2160, '1080p': 1080, '720p': 720 } as const

/** Picture height a version's label promises ("SE-4K", "EN · 1080P"), 0 if it says nothing */
export const heightOf = (label: string) => (/4k|2160|uhd/i.test(label) ? 2160 : /1080|fhd/i.test(label) ? 1080 : /720|\bhd\b/i.test(label) ? 720 : /576|480|\bsd\b/i.test(label) ? 480 : 0)

/**
 * Which copy to start on: the best one that is not above the wished quality, otherwise the lowest above it.
 * Copies without a stated quality are not guessed about; "auto" keeps the first (best) copy.
 */
export function pickVersion(versions: Pick<MovieVersion, 'label'>[] | undefined, quality: Quality): number {
  if (!versions?.length || quality === 'auto') return 0
  const want = HEIGHT[quality]
  const rated = versions.map((v, i) => ({ i, h: heightOf(v.label) })).filter((x) => x.h > 0)
  const under = rated.filter((x) => x.h <= want).sort((a, b) => b.h - a.h)[0]
  return (under ?? rated.sort((a, b) => a.h - b.h)[0])?.i ?? 0
}
