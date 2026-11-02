import { useEffect, useState } from 'react'
import { fetchRatings, type RatingQuery, type Ratings } from '../../../shared/core/ratings'
import { toast, useApp } from '../store'

// Looked-up ratings are kept on the device: the free OMDb key allows 1,000 lookups a day
const KEY = 'lumen:ratings'
const MAX = 3000
const DAY = 86400_000
type Entry = [Ratings | null, number]
let cache: Record<string, Entry> | null = null
const load = () => {
  try {
    return (cache ??= JSON.parse(localStorage.getItem(KEY) ?? '{}'))!
  } catch {
    return (cache = {})
  }
}
const save = () => {
  const c = load()
  const keys = Object.keys(c)
  if (keys.length > MAX) for (const k of keys.sort((a, b) => c[a][1] - c[b][1]).slice(0, keys.length - MAX)) delete c[k]
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    /* storage full: keep it in memory only */
  }
}
let warned = false

/** IMDb / Rotten Tomatoes / Metacritic for a title, when an OMDb key is set in Settings. Pass null to wait. */
export function useRatings(q: RatingQuery | null): Ratings | null {
  const apiKey = useApp((s) => s.settings.omdbKey)
  const id = q && `${q.kind}|${q.imdbId ?? `${q.title.toLowerCase()}|${q.year ?? ''}`}`
  const [r, setR] = useState<Ratings | null>(null)
  useEffect(() => {
    setR(null)
    if (!apiKey || !q || !id) return
    const hit = load()[id]
    // found: 30 days; not on OMDb: retry after 7
    if (hit && Date.now() - hit[1] < (hit[0] ? 30 : 7) * DAY) return void setR(hit[0])
    let live = true
    fetchRatings(apiKey, q)
      .then((res) => {
        load()[id] = [res, Date.now()]
        save()
        if (live) setR(res)
      })
      .catch((e) => {
        if (!warned) toast(`Ratings: ${e.message}`), (warned = true)
      })
    return () => void (live = false)
  }, [apiKey, id]) // eslint-disable-line react-hooks/exhaustive-deps
  return r
}
