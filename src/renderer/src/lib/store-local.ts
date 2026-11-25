// Small per-device JSON values in localStorage (stats, reminders, learned intros...). Nothing here is synced.
export function readLocal<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full: these are conveniences, losing one write is fine */
  }
}
