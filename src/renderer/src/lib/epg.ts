import { useEffect, useState } from 'react'
import type { Programme } from '../../../shared/types'

export function nowNext(list: Programme[] | undefined, t = Date.now()) {
  if (!list) return {}
  const i = list.findIndex((p) => p.stop > t)
  if (i < 0) return {}
  const now = list[i].start <= t ? list[i] : undefined
  const next = now ? list[i + 1] : list[i]
  const progress = now ? (t - now.start) / (now.stop - now.start) : 0
  return { now, next, progress, upcoming: list.slice(now ? i + 1 : i, (now ? i + 1 : i) + 6) }
}

/** Re-render on a timer so live progress bars keep moving */
export function useNow(ms = 30_000) {
  const [t, setT] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return t
}
