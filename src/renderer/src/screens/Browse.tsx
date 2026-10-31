import { BookmarkCheck, Clapperboard, Heart, History, Library } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Movie, Show } from '../../../shared/types'
import { PosterCard } from '../components/Cards'
import { CategorySidebar } from '../components/CategorySidebar'
import { PosterGrid } from '../components/PosterGrid'
import { Empty, Segmented } from '../components/ui'
import { openDetail, setGroup, useApp, useIndex } from '../store'
import { ALL, FAV } from './Live'

const RECENT = '__recent'
const WATCH = '__watch'
type Sort = 'added' | 'az' | 'rating'

/** Movies and Series share one browse screen: category sidebar + sortable virtual poster grid */
export default function Browse({ kind }: { kind: 'movies' | 'series' }) {
  const idx = useIndex()
  const favs = useApp((s) => s.favorites)
  const watchlist = useApp((s) => s.watchlist)
  const group = useApp((s) => s.group[kind]) ?? ALL
  const [sort, setSort] = useState<Sort>('added')
  const all: (Movie | Show)[] = kind === 'movies' ? idx.movies : idx.series
  const groups = kind === 'movies' ? idx.movieGroups : idx.seriesGroups
  const itemKind = kind === 'movies' ? 'movie' : 'series'

  const cats = useMemo(
    () => [
      { key: ALL, label: kind === 'movies' ? 'All Movies' : 'All Series', count: all.length, icon: kind === 'movies' ? <Clapperboard className="size-4" /> : <Library className="size-4" /> },
      { key: RECENT, label: 'Recently Added', count: Math.min(200, all.length), icon: <History className="size-4" /> },
      { key: WATCH, label: 'Watchlist', count: watchlist.filter((f) => f.kind === itemKind).length, icon: <BookmarkCheck className="size-4" /> },
      { key: FAV, label: 'Favorites', count: favs.filter((f) => f.kind === itemKind).length, icon: <Heart className="size-4" /> },
      ...groups.map((g) => ({ key: g.name, label: g.name, count: g.items.length }))
    ],
    [all, groups, favs, watchlist, kind, itemKind]
  )

  const items = useMemo(() => {
    let list: (Movie | Show)[]
    if (group === ALL) list = all
    else if (group === RECENT) list = [...all].sort((a, b) => (b.added ?? 0) - (a.added ?? 0)).slice(0, 200)
    else if (group === FAV) list = favs.filter((f): f is Movie | Show => f.kind === itemKind)
    else if (group === WATCH) list = watchlist.filter((f) => f.kind === itemKind)
    else list = groups.find((g) => g.name === group)?.items ?? []
    if (group === RECENT || sort === 'added') return group === RECENT ? list : [...list].sort((a, b) => (b.added ?? 0) - (a.added ?? 0))
    if (sort === 'az') return [...list].sort((a, b) => a.name.localeCompare(b.name))
    return [...list].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
  }, [all, groups, favs, watchlist, group, sort, itemKind])

  if (!all.length)
    return (
      <Empty
        icon={kind === 'movies' ? <Clapperboard className="size-8" /> : <Library className="size-8" />}
        title={kind === 'movies' ? 'No movies' : 'No series'}
        text="Your sources don't include any on-demand content yet. Xtream Codes accounts usually include Movies and Series."
      />
    )

  return (
    <div className="flex h-full gap-5 px-3 pb-3 pt-[136px] md:px-7 md:pb-7 md:pt-[92px]">
      <CategorySidebar items={cats} value={group} onChange={(k) => setGroup(kind, k)} layoutId={`${kind}-cat`} />
      <div className="glass flex min-w-0 flex-1 flex-col overflow-hidden rounded-[28px]">
        <div className="flex items-center justify-between px-7 pt-6">
          <div className="min-w-0">
            <h1 className="truncate text-[30px] font-bold leading-none tracking-[-0.035em]">{cats.find((c) => c.key === group)?.label ?? group}</h1>
            <p className="mt-1.5 text-[13px] text-fg/45">{items.length.toLocaleString()} titles</p>
          </div>
          {group !== RECENT && (
            <Segmented
              layoutId={`${kind}-sort`}
              value={sort}
              onChange={setSort}
              options={[
                { value: 'added', label: 'Newest' },
                { value: 'az', label: 'A–Z' },
                { value: 'rating', label: 'Top Rated' }
              ]}
            />
          )}
        </div>
        {items.length ? (
          <PosterGrid
            items={items}
            resetKey={`${group}:${sort}`}
            render={(it, w) => <PosterCard key={it.id} name={it.name} poster={it.poster} rating={it.rating} width={w} onClick={() => openDetail(it)} />}
          />
        ) : (
          <Empty icon={group === WATCH ? <BookmarkCheck className="size-8" /> : <Heart className="size-8" />} title="Nothing here yet" text={group === WATCH ? 'Add movies and series to your Watchlist from their detail page.' : 'Titles you favorite will show up here.'} />
        )}
      </div>
    </div>
  )
}
