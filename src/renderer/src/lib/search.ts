// Search ranking: whole words and word starts first, then parts of words, then (only when little was found)
// one-letter typos. Keys are built from names without the provider tag (cleanName) and without punctuation,
// so "spider man" finds "Spider-Man" and "en" doesn't match every English title.
/** Lower-case words of a title: accents, tags and punctuation removed */
export const words = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Edit distance up to `max` (insert, delete, change, swap of two letters); max + 1 when further apart */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev2: number[] | null = null
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur[j] = v
      if (v < best) best = v
    }
    if (best > max) return max + 1
    prev2 = prev
    prev = cur
  }
  return prev[b.length]
}

/** How well one query word matches a title key (already folded): null = not at all */
function termScore(key: string, t: string, fuzzy: boolean): number | null {
  if (key === t) return 6
  if (key.startsWith(t)) return 5
  if (key.includes(' ' + t)) return 4
  if (key.includes(t)) return 1.5
  if (!fuzzy || t.length < 4) return null
  const max = t.length >= 8 ? 2 : 1
  let best: number | null = null
  for (const w of key.split(' ')) {
    // a typo in the whole word, or in the start of a longer word ("matrx" -> "matrix reloaded")
    const d = Math.min(distance(w, t, max), w.length > t.length ? distance(w.slice(0, t.length), t, max) : max + 1)
    if (d <= max) best = Math.max(best ?? 0, 2.5 - d * 0.5)
  }
  return best
}

/** Score of a title key for the query words, or null when a word doesn't match */
export function matchScore(key: string, terms: string[], fuzzy = false): number | null {
  let sum = 0
  for (const t of terms) {
    const s = termScore(key, t, fuzzy)
    if (s === null) return null
    sum += s
  }
  const joined = terms.join(' ')
  if (key === joined) sum += 10
  else if (key.startsWith(joined)) sum += 4
  // among equals, shorter names (the film itself, not "Making of …") come first
  return sum - key.length / 200
}

export interface Ranked<T> {
  items: T[]
  total: number
}

/**
 * The `n` best matches of a list, best first, and how many matched in all. `quality` nudges ties toward
 * titles with artwork and a good rating.
 */
export function rank<T extends { id: string; poster?: string; rating?: number }>(list: T[], n: number, terms: string[], keyOf: (x: T) => string, fuzzy = false): Ranked<T> {
  const best: { x: T; s: number }[] = []
  let total = 0
  for (const x of list) {
    let s = matchScore(keyOf(x), terms, fuzzy)
    if (s === null) continue
    total++
    s += (x.poster ? 0.4 : 0) + (x.rating ?? 0) * 0.03
    if (best.length === n && s <= best[n - 1].s) continue
    let i = best.length
    while (i > 0 && best[i - 1].s < s) i--
    best.splice(i, 0, { x, s })
    if (best.length > n) best.pop()
  }
  return { items: best.map((b) => b.x), total }
}
