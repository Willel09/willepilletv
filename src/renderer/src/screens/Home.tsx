import { motion } from 'framer-motion'
import { FileText, Link2, MonitorSmartphone, Tv } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChannelTile, PosterCard, WideCard } from '../components/Cards'
import { Hero } from '../components/Hero'
import { Row } from '../components/Row'
import { Button, Spinner } from '../components/ui'
import { nowNext } from '../lib/epg'
import { cleanName } from '../lib/format'
import { forYouScore, newestScore, topMany, topRatedScore } from '../lib/recommend'
import { softSpring } from '../lib/motion'
import { openDetail, openSourceSheet, playChannel, playMovie, resume, resumable, setGroup, setTab, toggleWatchlist, useApp, useIndex } from '../store'
import type { Channel, Item, Movie, Show } from '../../../shared/types'
import { RECENT } from './Browse'
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

  // Curated rows (not one row per category), all computed in one pass over the library with breaks for the
  // screen in between: on a TV with 500k titles, separate passes froze the remote for seconds
  type Title = Movie | Show
  const [rows, setRows] = useState<{ featured: Title[]; forYou: Title[]; newMovies: Title[]; newSeries: Title[]; topRated: Title[]; last?: Title; similar: Title[] } | null>(null)
  const hero = useRef<{ idx: unknown; items: Title[] } | null>(null)
  useEffect(() => {
    let live = true
    void (async () => {
      // look up only the (at most 300) titles in the history, not a table of the whole library
      const wanted = history.filter((h) => h.kind !== 'live').map((h) => (h.kind === 'episode' && h.parentId ? h.parentId : h.id))
      const want = new Set(wanted)
      const found = new Map<string, Title>()
      let seen = 0
      if (want.size)
        for (const list of [idx.movies, idx.series] as Title[][])
          for (const x of list) {
            if (want.has(x.id)) found.set(x.id, x)
            if (x.kind === 'movie' && x.versions) for (const v of x.versions) if (want.has(v.id)) found.set(v.id, x)
            if (++seen % 20_000 === 0) await new Promise((r) => setTimeout(r, 0)) // a break for the screen
          }
      const watched = wanted.map((id) => found.get(id)).filter((x): x is Title => !!x)
      const saved = [...watchlist, ...favorites].filter((x): x is Title => x.kind === 'movie' || x.kind === 'series')
      const gs = (x: Title) => (x.kind === 'movie' && x.groups) || [x.group]
      const last = watched[0]
      const lastGroups = last ? gs(last) : []
      const none = () => null
      const [featRated, featAny, forYou, newMovies, newSeries, topRated, similar] = await topMany<Title>(
        [idx.movies, idx.series],
        [
          { n: 40, score: (x) => (x.poster && (x.rating ?? 0) >= 6.5 ? x.added ?? 0 : null) },
          { n: 40, score: (x) => (x.poster ? x.added ?? 0 : null) },
          { n: 30, score: forYouScore([...watched, ...saved], [idx.movies, idx.series]) ?? none },
          { n: 30, score: newestScore((x) => x.kind === 'movie') },
          { n: 30, score: newestScore((x) => x.kind === 'series') },
          { n: 30, score: topRatedScore },
          { n: 30, score: last ? newestScore((x) => x.kind === last.kind && x.id !== last.id && gs(x).some((g) => lastGroups.includes(g))) : none }
        ]
      )
      if (!live) return
      // the hero only reshuffles when the library changes, not every time the history does
      if (hero.current?.idx !== idx) hero.current = { idx, items: (featRated.length >= 6 ? featRated : featAny).sort(() => Math.random() - 0.5).slice(0, 6) }
      setRows({ featured: hero.current.items, forYou, newMovies, newSeries, topRated, last, similar })
    })()
    return () => void (live = false)
  }, [idx, history, watchlist, favorites])
  const featured = rows?.featured ?? []

  // channels on air right now (favorites first), so live TV has a place on Home
  const liveNow = useMemo(() => {
    const out: Channel[] = []
    const seen = new Set<string>()
    if (!epg) return out
    // favorites, then the first channels: scanning 110k channels for "on now" is wasted work on a TV
    for (const list of [favorites.filter((f): f is Channel => f.kind === 'live'), idx.channels.slice(0, 3000)])
      for (const c of list) {
        if (out.length >= 30) break
        if (seen.has(c.id) || !nowNext(epg?.programmes[c.id]).now) continue
        seen.add(c.id)
        out.push(c)
      }
    return out
  }, [idx, favorites, epg])

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

  const seeAll = (screen: 'movies' | 'series' | 'live', group: string) => () => (setGroup(screen, group), setTab(screen))
  const titleCard = (it: Movie | Show) => <PosterCard key={it.id} name={it.name} poster={it.poster} rating={it.rating} onClick={() => openDetail(it)} />

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
        {rows && rows.forYou.length > 0 && <Row title="For You">{rows.forYou.map(titleCard)}</Row>}
        {watchlist.length > 0 && <Row title="My Watchlist" count={watchlist.length}>{watchlist.slice(0, 40).map((it) => <PosterCard key={it.id} name={it.name} poster={it.poster} rating={it.rating} onClick={() => openDetail(it)} onRemove={() => toggleWatchlist(it)} />)}</Row>}
        {rows && rows.newMovies.length > 0 && <Row title="Newest Movies" onSeeAll={seeAll('movies', RECENT)}>{rows.newMovies.map(titleCard)}</Row>}
        {rows && rows.newSeries.length > 0 && <Row title="Newest Series" onSeeAll={seeAll('series', RECENT)}>{rows.newSeries.map(titleCard)}</Row>}
        {rows?.last && rows.similar.length > 0 && <Row title={`Because you watched ${cleanName(rows.last.name)}`}>{rows.similar.map(titleCard)}</Row>}
        {liveNow.length > 0 && <Row title="Live Now" onSeeAll={() => setTab('live')}>{liveNow.map(poster)}</Row>}
        {rows && rows.topRated.length > 0 && <Row title="Top Rated">{rows.topRated.map(titleCard)}</Row>}
        {favorites.length > 0 && <Row title="Favorites">{favorites.slice(0, 40).map(poster)}</Row>}
        {recentLive.length > 0 && (
          <Row title="Recently Watched Channels">
            {recentLive.map((h) => (
              <ChannelTile key={h.id} name={h.name} logo={h.poster} subtitle={nowNext(epg?.programmes[h.id]).now?.title} onClick={() => resume(h)} />
            ))}
          </Row>
        )}
      </div>
    </div>
  )
}
