// "Skip Intro", learned per series: when you jump forward early in an episode, the jump is remembered; the next
// episodes of that series offer a button over the same stretch. No intro database needed.
const read = <T>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full: a convenience, losing one write is fine */
  }
}

type Mark = [from: number, to: number]
const KEY = 'lumen:intro'
const MAX_MARKS = 5

/** Only a deliberate skip of an intro counts: 25 s to 5 min forward, starting within the first 10 minutes */
export const isIntroSkip = (from: number, to: number) => to - from >= 25 && to - from <= 300 && from >= 0 && from < 600

export function recordSkip(showId: string, from: number, to: number) {
  if (!isIntroSkip(from, to)) return
  const all = read<Record<string, Mark[]>>(KEY, {})
  all[showId] = [...(all[showId] ?? []), [Math.round(from), Math.round(to)] as Mark].slice(-MAX_MARKS)
  const ids = Object.keys(all)
  if (ids.length > 300) delete all[ids[0]]
  write(KEY, all)
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

/** Where the intro usually is: the middle of what you skipped before, or null if you never skipped one */
export function introOf(showId: string): { from: number; to: number } | null {
  const marks = read<Record<string, Mark[]>>(KEY, {})[showId]
  return marks?.length ? { from: median(marks.map((m) => m[0])), to: median(marks.map((m) => m[1])) } : null
}

/** The button shows from a little before the usual start until just before the usual end */
export const inIntro = (w: { from: number; to: number } | null, t: number) => !!w && t >= w.from - 5 && t < w.to - 3
