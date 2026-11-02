import type { HistoryEntry, Item, Library } from '../types'

type Lists = { favorites: Item[]; watchlist: Item[]; history: HistoryEntry[] }
export type Relinked = { [K in keyof Lists]?: { list: Lists[K]; changed: string[]; removed: string[] } }

/**
 * Saved items whose id is no longer in the library (M3U ids changed in 1.3.12, or a provider changed its stream
 * URLs) are matched again: by stream URL, else by kind + group + name, and get the library's current id.
 * Only items of `sourceIds` (the M3U sources) are looked at. Returns just the lists that changed.
 */
export function relink(lib: Library, lists: Lists, sourceIds: Set<string>): Relinked {
  const own = (x: { id: string }) => sourceIds.has(x.id.split(':')[0])
  const all = [...lib.channels, ...lib.movies, ...lib.series].filter((x) => sourceIds.has(x.sourceId)) as Item[]
  const ids = new Set(all.map((x) => x.id))
  if (![...lists.favorites, ...lists.watchlist, ...lists.history].some(own)) return {}
  const lost = (x: { id: string }) => own(x) && !ids.has(x.id)
  const byUrl = new Map<string, Item>()
  const byName = new Map<string, Item>()
  for (const x of all) {
    if ('url' in x && x.url) byUrl.set(x.url, x)
    byName.set(`${x.sourceId}|${x.kind}|${x.group}|${x.name}`, x)
  }
  const out: Relinked = {}
  const items = (key: 'favorites' | 'watchlist') => {
    const changed: string[] = [], removed: string[] = []
    const list = lists[key].map((x) => {
      if (!lost(x)) return x
      const now = ('url' in x && x.url && byUrl.get(x.url)) || byName.get(`${x.sourceId}|${x.kind}|${x.group}|${x.name}`)
      if (!now || now.id === x.id) return x
      changed.push(now.id), removed.push(x.id)
      return now
    })
    if (changed.length) out[key] = { list: dedupe(list), changed, removed }
  }
  items('favorites')
  items('watchlist')
  const changed: string[] = [], removed: string[] = []
  const history = lists.history.map((h) => {
    if (!h.id.includes(':') || !own(h)) return h
    let id = h.id
    if (h.kind === 'episode' && h.parentId) {
      const show = all.find((x) => x.id === h.parentId)
      const ep = show && 'episodes' in show ? show.episodes?.find((e) => e.url === h.url) : undefined
      if (ep) id = `${h.parentId}:${ep.id}`
    } else if (!ids.has(h.id)) id = byUrl.get(h.url)?.id ?? h.id
    if (id === h.id) return h
    changed.push(id), removed.push(h.id)
    return { ...h, id }
  })
  if (changed.length) out.history = { list: dedupe(history), changed, removed }
  return out
}

const dedupe = <T extends { id: string }>(xs: T[]) => xs.filter((x, i) => xs.findIndex((y) => y.id === x.id) === i)
