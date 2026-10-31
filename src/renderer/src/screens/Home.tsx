import { motion } from 'framer-motion'
import { FileText, Link2, MonitorSmartphone, Tv } from 'lucide-react'
import { useMemo } from 'react'
import { ChannelTile, PosterCard, WideCard } from '../components/Cards'
import { Hero } from '../components/Hero'
import { Row } from '../components/Row'
import { Button, Spinner } from '../components/ui'
import { nowNext } from '../lib/epg'
import { softSpring } from '../lib/motion'
import { openDetail, openSourceSheet, playChannel, playMovie, resume, resumable, setGroup, setTab, toggleWatchlist, useApp, useIndex } from '../store'
import type { Item } from '../../../shared/types'
import { startPairing } from './Settings'

function Welcome() {
  return (
    <div className="grid h-full place-items-center px-10">
      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={softSpring} className="glass max-w-2xl rounded-[36px] p-12 text-center">
        <div className="mx-auto mb-7 grid size-20 place-items-center rounded-[26px] bg-[conic-gradient(from_200deg,var(--accent),#bf5af2,#ff375f,var(--accent))] shadow-[0_20px_60px_-10px_var(--accent)]">
          <Tv className="size-9 text-white" />
        </div>
        <h1 className="text-[44px] font-[800] leading-none tracking-[-0.045em]">Welcome to Lumen</h1>
        <p className="mx-auto mt-4 max-w-md text-[15.5px] leading-relaxed text-fg/60">
          A beautiful player for your own IPTV subscription. Lumen has no built-in channels — add your playlist or Xtream Codes login to begin.
        </p>
        <div className="mt-9 flex justify-center gap-3">
          <Button variant="primary" size="lg" icon={<Link2 className="size-5" />} onClick={() => openSourceSheet('xtream')}>
            Xtream Codes Login
          </Button>
          <Button size="lg" icon={<FileText className="size-5" />} onClick={() => openSourceSheet('m3u')}>
            M3U Playlist
          </Button>
        </div>
        <button onClick={startPairing} className="mx-auto mt-6 flex items-center gap-2 rounded-full px-4 py-2 text-[14px] font-semibold text-fg/60 transition hover:bg-fg/8 hover:text-fg">
          <MonitorSmartphone className="size-4" /> Already use Lumen on another device? Link it
        </button>
      </motion.div>
    </div>
  )
}

export default function Home() {
  const idx = useIndex()
  const sources = useApp((s) => s.sources)
  const loading = useApp((s) => s.loading)
  const favorites = useApp((s) => s.favorites)
  const watchlist = useApp((s) => s.watchlist)
  const history = useApp((s) => s.history)
  const epg = useApp((s) => s.epg)

  const featured = useMemo(() => {
    const pool = [...idx.movies, ...idx.series].filter((x) => x.poster)
    const rated = pool.filter((x) => (x.rating ?? 0) >= 6.5)
    const src = rated.length >= 6 ? rated : pool
    // newest first gives a "what's new" feel; fall back to a random sample
    const sorted = [...src].sort((a, b) => (b.added ?? 0) - (a.added ?? 0)).slice(0, 40)
    return sorted.sort(() => Math.random() - 0.5).slice(0, 6)
  }, [idx])

  if (!sources.length) return <Welcome />
  if (!idx.channels.length && !idx.movies.length && !idx.series.length && !watchlist.length && !favorites.length && !history.length)
    return (
      <div className="grid h-full place-items-center text-fg/60">
        {loading ? (
          <div className="glass flex items-center gap-3 rounded-full px-6 py-3"><Spinner /> Loading your library…</div>
        ) : (
          <div className="text-center">
            <p className="mb-4">Nothing loaded yet. Check your sources in Settings.</p>
            <Button onClick={() => setTab('settings')}>Open Settings</Button>
          </div>
        )}
      </div>
    )

  const cont = history.filter((h) => resumable(h)).slice(0, 20)
  const recentLive = history.filter((h) => h.kind === 'live').slice(0, 20)
  const open = (it: Item) => (it.kind === 'live' ? playChannel(it) : it.kind === 'movie' ? playMovie(it) : openDetail(it))
  const poster = (it: Item) =>
    it.kind === 'live' ? (
      <ChannelTile key={it.id} name={it.name} logo={it.logo} subtitle={nowNext(epg?.programmes[it.id]).now?.title} onClick={() => open(it)} />
    ) : (
      <PosterCard key={it.id} name={it.name} poster={it.poster} rating={it.rating} onClick={() => open(it)} />
    )

  const rows = [
    ...idx.movieGroups.slice(0, 10).map((g) => ({ g, screen: 'movies' as const })),
    ...idx.seriesGroups.slice(0, 8).map((g) => ({ g, screen: 'series' as const })),
    ...idx.liveGroups.slice(0, 6).map((g) => ({ g, screen: 'live' as const }))
  ]

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      {featured.length > 0 ? <Hero items={featured} /> : <div className="h-28" />}
      <div className={`relative space-y-2 pb-16 ${featured.length ? '-mt-28' : ''}`}>
        {cont.length > 0 && (
          <Row title="Continue Watching">
            {cont.map((h) => (
              <WideCard key={h.id} name={h.name} subtitle={h.subtitle} art={h.poster} progress={h.position / h.duration} onClick={() => resume(h)} />
            ))}
          </Row>
        )}
        {watchlist.length > 0 && <Row title="My Watchlist" count={watchlist.length}>{watchlist.slice(0, 40).map((it) => <PosterCard key={it.id} name={it.name} poster={it.poster} rating={it.rating} onClick={() => openDetail(it)} onRemove={() => toggleWatchlist(it)} />)}</Row>}
        {favorites.length > 0 && <Row title="Favorites">{favorites.slice(0, 40).map(poster)}</Row>}
        {recentLive.length > 0 && (
          <Row title="Recently Watched Channels">
            {recentLive.map((h) => (
              <ChannelTile key={h.id} name={h.name} logo={h.poster} subtitle={nowNext(epg?.programmes[h.id]).now?.title} onClick={() => resume(h)} />
            ))}
          </Row>
        )}
        {rows.map(({ g, screen }) => (
          <Row
            key={`${screen}:${g.name}`}
            title={g.name}
            count={g.items.length}
            onSeeAll={() => {
              setGroup(screen, g.name)
              setTab(screen)
            }}
          >
            {g.items.slice(0, 30).map(poster)}
          </Row>
        ))}
      </div>
    </div>
  )
}
