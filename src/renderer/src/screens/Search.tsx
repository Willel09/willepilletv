import { Search as SearchIcon, X } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { ChannelTile, PosterCard } from '../components/Cards'
import { Row } from '../components/Row'
import { nowNext } from '../lib/epg'
import { rank, words } from '../lib/search'
import { api, openDetail, playChannel, useApp, useIndex } from '../store'

const LIMIT = 60

export default function Search() {
  const idx = useIndex()
  const epg = useApp((s) => s.epg)
  const [q, setQ] = useState('')
  const dq = useDeferredValue(q)

  const results = useMemo(() => {
    const terms = words(dq).split(' ').filter(Boolean)
    if (!terms.length) return null
    const run = (fuzzy: boolean) => ({
      channels: rank(idx.channels, LIMIT, terms, idx.key, fuzzy),
      movies: rank(idx.movies, LIMIT, terms, idx.key, fuzzy),
      series: rank(idx.series, LIMIT, terms, idx.key, fuzzy),
      fuzzy
    })
    // typos are only guessed at when little was found: guessing on 500k titles is slow, and exact hits are what's wanted
    const exact = run(false)
    const slow = api.device === 'tv' && idx.channels.length + idx.movies.length + idx.series.length > 200_000
    return slow || exact.channels.total + exact.movies.total + exact.series.total >= 6 ? exact : run(true)
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
        {results?.fuzzy && !none && <p className="mt-4 text-center text-[13px] text-fg/45">Close matches for “{dq}”</p>}
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
