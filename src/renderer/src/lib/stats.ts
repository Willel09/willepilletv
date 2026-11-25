// "Your Stats": how long you watch, kept on this device per profile. Only counts time actually spent playing.
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

export interface WatchLog {
  /** seconds watched per local day, "YYYY-MM-DD" */
  days: Record<string, number>
  /** seconds per film or series (episodes count toward their series) */
  titles: Record<string, { name: string; secs: number }>
}

const keyOf = (profile: string) => `lumen:stats:${profile}`
const pad = (n: number) => String(n).padStart(2, '0')
export const dayKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Adds watched seconds; `title` is omitted for live TV, which counts toward the days only */
export function addWatch(profile: string, secs: number, title?: { id: string; name: string }, now = Date.now()) {
  const log = read<WatchLog>(keyOf(profile), { days: {}, titles: {} })
  const day = dayKey(now)
  log.days[day] = (log.days[day] ?? 0) + secs
  if (title) {
    const t = (log.titles[title.id] ??= { name: title.name, secs: 0 })
    t.secs += secs
    // keep the file small: the 300 most watched titles are plenty for a top list
    const ids = Object.keys(log.titles)
    if (ids.length > 300) for (const id of ids.sort((a, b) => log.titles[a].secs - log.titles[b].secs).slice(0, ids.length - 300)) delete log.titles[id]
  }
  write(keyOf(profile), log)
}

export const readWatch = (profile: string) => read<WatchLog>(keyOf(profile), { days: {}, titles: {} })

const DAY = 86400_000

export function summarize(log: WatchLog, now = Date.now()) {
  const within = (days: number) => {
    let s = 0
    for (let i = 0; i < days; i++) s += log.days[dayKey(now - i * DAY)] ?? 0
    return s
  }
  // a day counts toward a streak with at least a minute of watching; today may still be empty
  const active = (t: number) => (log.days[dayKey(t)] ?? 0) >= 60
  let streak = 0
  for (let t = active(now) ? now : now - DAY; active(t); t -= DAY) streak++
  const weekdays = [0, 0, 0, 0, 0, 0, 0]
  for (const [k, secs] of Object.entries(log.days)) weekdays[new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)).getDay()] += secs
  const best = weekdays.some((x) => x > 0) ? weekdays.indexOf(Math.max(...weekdays)) : -1
  const top = Object.values(log.titles).sort((a, b) => b.secs - a.secs).slice(0, 5)
  return { week: within(7), month: within(30), year: within(365), streak, weekdays, best, top }
}
