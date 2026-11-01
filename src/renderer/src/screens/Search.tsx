import { Search as SearchIcon, X } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import type { Item } from '../../../shared/types'
import { ChannelTile, PosterCard } from '../components/Cards'
import { Row } from '../components/Row'
import { nowNext } from '../lib/epg'
import { fold } from '../lib/format'
import { openDetail, playChannel, useApp, useIndex } from '../store'

const LIMIT = 60

export default function Search() {
  const idx = useIndex()
  const epg = useApp((s) => s.epg)
  const [q, setQ] = useState('')
  const dq = useDeferredValue(q)

  const results = useMemo(() => {
    const terms = fold(dq).split(/\s+/).filter(Boolean)
    if (!terms.length) return null
    const hit = (x: Item) => {
      const k = idx.key(x)
      return terms.every((t) => k.includes(t))
    }
    const take = <T extends Item>(xs: T[]) => {
      const out: T[] = []
      let total = 0
      for (const x of xs) if (hit(x)) total++ < LIMIT && out.push(x)
      return { items: out, total }
    }
    return { channels: take(idx.channels), movies: take(idx.movies), series: take(idx.series) }
  }, [dq, idx])

  const none = results && !results.channels.total && !results.movies.total && !results.series.total

  return (
    <div className="h-full overflow-y-auto pt-[100px]">
      <div className="mx-auto mb-6 max-w-2xl px-8">
        <label className="glass flex h-16 items-center gap-4 rounded-full px-6 focus-within:shadow-[inset_0_0_0_2px_var(--accent),var(--glass-shadow)]">
          <SearchIcon className="size-5.5 shrink-0 text-fg/50" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Channels, movies and series"
            className="h-full flex-1 bg-transparent text-[19px] font-medium tracking-[-0.01em] outline-none placeholder:text-fg/35"
          />
          {q && (
            <button aria-label="Clear" onClick={() => setQ('')} className="grid size-7 place-items-center rounded-full bg-fg/15 text-fg/70 hover:bg-fg/25">
              <X className="size-4" />
            </button>
          )}
        </label>
        {!results && (
          <p className="mt-5 text-center text-[13.5px] text-fg/40">
            Search across {idx.channels.length.toLocaleString()} channels, {idx.movies.length.toLocaleString()} movies and {idx.series.length.toLocaleString()} series
          </p>
        )}
        {none && <p className="mt-10 text-center text-[15px] text-fg/50">No results for “{dq}”</p>}
      </div>
      {results && (
        <div className="pb-16">
          {results.channels.total > 0 && (
            <Row title="Channels" count={results.channels.total}>
              {results.channels.items.map((c) => (
                <ChannelTile key={c.id} name={c.name} logo={c.logo} subtitle={nowNext(epg?.programmes[c.id]).now?.title ?? c.group} onClick={() => playChannel(c, results.channels.items)} />
              ))}
            </Row>
          )}
          {results.movies.total > 0 && (
            <Row title="Movies" count={results.movies.total}>
              {results.movies.items.map((m) => <PosterCard key={m.id} name={m.name} poster={m.poster} rating={m.rating} onClick={() => openDetail(m)} />)}
            </Row>
          )}
          {results.series.total > 0 && (
            <Row title="Series" count={results.series.total}>
              {results.series.items.map((s) => <PosterCard key={s.id} name={s.name} poster={s.poster} rating={s.rating} onClick={() => openDetail(s)} />)}
            </Row>
          )}
        </div>
      )}
    </div>
  )
}
