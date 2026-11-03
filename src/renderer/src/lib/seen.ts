// When you last looked at a series, to tell which of those on your watchlist have new episodes since.
// Kept on the device: it only decides what gets a "new" badge.
const KEY = 'lumen:seen'
const read = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}
const write = (m: Record<string, number>) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* storage full: the badge just comes back */
  }
}
const nowSec = () => Math.floor(Date.now() / 1000)

/**
 * When any of these ids (a series and its merged copies) was last seen, in seconds. A series never seen before
 * counts as seen now: only episodes that arrive from here on are new, not the whole back catalogue.
 */
export function seenOf(ids: string[]): number {
  const m = read()
  const known = ids.map((id) => m[id]).filter((t): t is number => !!t)
  if (known.length) return Math.max(...known)
  const t = nowSec()
  for (const id of ids) m[id] = t
  write(m)
  return t
}

export function markSeen(ids: string[]) {
  const m = read()
  const t = nowSec()
  for (const id of ids) m[id] = t
  const keys = Object.keys(m)
  if (keys.length > 2000) for (const k of keys.slice(0, keys.length - 2000)) delete m[k]
  write(m)
}

/** New episodes: the provider changed the series after you last saw it or watched an episode */
export const hasNew = (added: number | undefined, seen: number, watchedAt: number) => !!added && added > Math.max(seen, watchedAt)
