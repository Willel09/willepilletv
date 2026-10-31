import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ExternalLink, Heart, Play, RotateCcw, Star } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Episode, MediaInfo, Movie, Show } from '../../../shared/types'
import { PosterCard } from '../components/Cards'
import { Img } from '../components/Img'
import { Row } from '../components/Row'
import { Button, IconButton, Spinner } from '../components/ui'
import { cleanName, duration } from '../lib/format'
import { sheetSpring, softSpring, spring } from '../lib/motion'
import { api, closeDetail, historyFor, index, isFavorite, openDetail, playEpisode, playMovie, resumable, setAmbient, toast, toggleFavorite, useApp } from '../store'

function EpisodeCard({ show, ep, episodes, art }: { show: Show; ep: Episode; episodes: Episode[]; art?: string }) {
  const h = useApp((s) => s.history.find((x) => x.id === `${show.id}:${ep.id}`))
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.035 }}
      whileFocus={{ scale: 1.035 }}
      transition={spring}
      onClick={() => playEpisode(show, ep, episodes)}
      className="card group glass-thin flex flex-col overflow-hidden rounded-[22px] text-left"
    >
      <div className="relative aspect-video overflow-hidden">
        <Img src={ep.still || art} name={ep.title} className="size-full" />
        <div className="absolute inset-0 grid place-items-center bg-black/0 transition group-hover:bg-black/30 group-focus:bg-black/30">
          <span className="grid size-12 scale-75 place-items-center rounded-full bg-white/90 opacity-0 shadow-xl transition group-hover:scale-100 group-hover:opacity-100 group-focus:scale-100 group-focus:opacity-100">
            <Play className="ml-0.5 size-5 fill-black text-black" />
          </span>
        </div>
        {h && h.duration > 0 && (
          <div className="absolute inset-x-3 bottom-3 h-1 overflow-hidden rounded-full bg-white/25">
            <div className="h-full bg-white" style={{ width: `${Math.min(100, (h.position / h.duration) * 100)}%` }} />
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-fg/45">
          Episode {ep.episode}
          {ep.duration && <span className="ml-2 font-medium normal-case tracking-normal">{ep.duration}</span>}
        </div>
        <div className="mt-1 line-clamp-1 text-[14.5px] font-semibold tracking-[-0.01em]">{ep.title}</div>
        {ep.plot && <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-fg/55">{ep.plot}</p>}
      </div>
    </motion.button>
  )
}

export default function Detail({ item }: { item: Movie | Show }) {
  const [info, setInfo] = useState<MediaInfo>({})
  const [loading, setLoading] = useState(false)
  const [season, setSeason] = useState<number>()
  useApp((s) => s.favorites)
  const history = useApp((s) => s.history)

  useEffect(() => {
    const xtId = item.kind === 'movie' ? item.vodId : item.seriesId
    if (!xtId) return
    setLoading(true)
    api
      .mediaInfo(item.sourceId, item.kind, xtId)
      .then(setInfo)
      .catch((e) => toast(`Couldn't load details: ${e.message}`))
      .finally(() => setLoading(false))
  }, [item])

  const art = info.backdrop || (item.kind === 'series' ? item.backdrop : undefined) || info.poster || item.poster
  useEffect(() => {
    setAmbient(art)
  }, [art])

  const episodes = useMemo(() => (item.kind === 'series' ? info.episodes ?? item.episodes ?? [] : []), [item, info])
  const seasons = useMemo(() => [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b), [episodes])
  const curSeason = season ?? seasons[0]
  const seasonEps = episodes.filter((e) => e.season === curSeason)

  const similar = useMemo(() => {
    const idx = index()
    const groups = item.kind === 'movie' ? idx.movieGroups : idx.seriesGroups
    return ((groups.find((g) => g.name === item.group)?.items ?? []) as (Movie | Show)[]).filter((x) => x.id !== item.id).slice(0, 24)
  }, [item])

  const fav = isFavorite(item.id)
  const plot = info.plot || item.plot
  const rating = info.rating || item.rating
  const year = info.year || item.year
  const movieH = item.kind === 'movie' ? historyFor(item.id) : undefined
  // Series: continue from the most recently watched episode
  const lastEp = item.kind === 'series' ? history.find((h) => h.parentId === item.id || h.id.startsWith(`${item.id}:`)) : undefined
  const nextEp = lastEp && episodes.find((e) => `${item.id}:${e.id}` === lastEp.id)

  const playMain = () => {
    if (item.kind === 'movie') return playMovie(item)
    const ep = nextEp ?? episodes[0]
    if (ep) playEpisode(item, ep, episodes)
  }
  const vlc = async () => {
    const url = item.kind === 'movie' ? item.url : (nextEp ?? episodes[0])?.url
    if (!url) return
    const r = await api.openInVlc(url, item.name)
    if (!r.ok) toast(r.error!)
  }

  return (
    <motion.div
      data-nav-scope
      className="fixed inset-0 z-20 overflow-y-auto overflow-x-hidden bg-[var(--app-bg)]"
      initial={{ opacity: 0, y: 60 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      transition={sheetSpring}
    >
      <div className="relative min-h-[88vh]">
        <motion.div className="absolute inset-0 overflow-hidden [mask-image:linear-gradient(to_bottom,black_50%,transparent)]" initial={{ scale: 1.08 }} animate={{ scale: 1 }} transition={{ duration: 1.6, ease: [0.2, 0.7, 0.2, 1] }}>
          {art && <img src={art} alt="" referrerPolicy="no-referrer" className={`size-full object-cover object-[center_20%] ${info.backdrop || (item.kind === 'series' && item.backdrop) ? '' : 'scale-110 blur-2xl saturate-150'}`} onError={(e) => (e.currentTarget.style.display = 'none')} />}
        </motion.div>
        <div className="absolute inset-0 bg-gradient-to-r from-[color-mix(in_srgb,var(--base)_92%,transparent)] via-[color-mix(in_srgb,var(--base)_60%,transparent)] to-transparent" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[color-mix(in_srgb,var(--base)_55%,transparent)] to-transparent" />

        <div className="relative flex items-end gap-12 px-14 pb-14 pt-32">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ ...softSpring, delay: 0.08 }} className="min-w-0 max-w-3xl flex-1">
            <IconButton label="Back" onClick={closeDetail} className="mb-8 size-11">
              <ChevronLeft className="size-5" />
            </IconButton>
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-fg/55">{item.group}</div>
            <h1 className="text-[clamp(38px,5vw,72px)] font-[800] leading-[0.95] tracking-[-0.045em] [text-wrap:balance]">{cleanName(item.name)}</h1>
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] font-medium text-fg/65">
              {year && <span>{year}</span>}
              {!!rating && (
                <span className="flex items-center gap-1">
                  <Star className="size-3.5 fill-amber-300 text-amber-300" /> {rating.toFixed(1)}
                </span>
              )}
              {info.duration && <span>{info.duration}</span>}
              {info.genre && <span className="text-fg/50">{info.genre}</span>}
              {item.kind === 'series' && seasons.length > 0 && <span>{seasons.length} Season{seasons.length > 1 ? 's' : ''}</span>}
              {loading && <Spinner className="size-4 text-fg/40" />}
            </div>
            {plot && <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-fg/80">{plot}</p>}
            {(info.cast || info.director) && (
              <div className="mt-4 max-w-2xl space-y-1 text-[13px] text-fg/50">
                {info.director && <p><span className="font-semibold text-fg/70">Director</span> {info.director}</p>}
                {info.cast && <p className="line-clamp-2"><span className="font-semibold text-fg/70">Cast</span> {info.cast}</p>}
              </div>
            )}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" autoFocus icon={<Play className="size-5 fill-current" />} onClick={playMain} disabled={item.kind === 'series' && !episodes.length}>
                {item.kind === 'movie'
                  ? resumable(movieH) ? `Resume · ${duration(movieH!.duration - movieH!.position)} left` : 'Play'
                  : nextEp ? `Continue S${nextEp.season} E${nextEp.episode}` : 'Play S1 E1'}
              </Button>
              {item.kind === 'movie' && resumable(movieH) && (
                <Button size="lg" icon={<RotateCcw className="size-4.5" />} onClick={() => playMovie(item, true)}>
                  From Beginning
                </Button>
              )}
              <IconButton label={fav ? 'Remove from Favorites' : 'Add to Favorites'} className="size-13" onClick={() => toggleFavorite(item)}>
                <Heart className={`size-5 ${fav ? 'fill-rose-400 text-rose-400' : ''}`} />
              </IconButton>
              <IconButton label="Open in VLC" className="size-13" onClick={vlc}>
                <ExternalLink className="size-5" />
              </IconButton>
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 40, rotate: 2 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ ...softSpring, delay: 0.15 }}
            className="hidden w-[260px] shrink-0 overflow-hidden rounded-[28px] shadow-[0_50px_100px_-20px_rgb(0_0_0/0.85)] ring-1 ring-white/15 xl:block"
          >
            <Img src={info.poster || item.poster} name={item.name} className="aspect-[2/3] w-full" />
          </motion.div>
        </div>
      </div>

      {item.kind === 'series' && (
        <section className="relative px-14 pb-20">
          {seasons.length > 1 && (
            <div className="no-scrollbar mb-6 flex gap-2 overflow-x-auto py-1">
              {seasons.map((s) => (
                <button
                  key={s}
                  onClick={() => setSeason(s)}
                  className={`relative h-10 shrink-0 rounded-full px-5 text-[13.5px] font-semibold transition-colors ${s === curSeason ? 'text-bg' : 'glass-thin text-fg/70 hover:text-fg'}`}
                >
                  {s === curSeason && <motion.span layoutId="season-pill" transition={spring} className="absolute inset-0 rounded-full bg-fg" />}
                  <span className="relative">Season {s}</span>
                </button>
              ))}
            </div>
          )}
          {loading && !episodes.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
              {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton aspect-[16/12] rounded-[22px]" />)}
            </div>
          ) : !episodes.length ? (
            <p className="text-fg/50">No episodes available.</p>
          ) : (
            <AnimatePresence mode="popLayout">
              <motion.div key={curSeason} className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
                {seasonEps.map((ep) => <EpisodeCard key={ep.id} show={item} ep={ep} episodes={episodes} art={art} />)}
              </motion.div>
            </AnimatePresence>
          )}
        </section>
      )}

      {similar.length > 0 && (
        <div className="relative pb-12">
          <Row title="More Like This">
            {similar.map((it) => <PosterCard key={it.id} name={it.name} poster={it.poster} rating={it.rating} onClick={() => openDetail(it)} />)}
          </Row>
        </div>
      )}
    </motion.div>
  )
}
