import { AnimatePresence, motion } from 'framer-motion'
import { Check, Info, Play, Plus, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Movie, Show } from '../../../shared/types'
import { cleanName } from '../lib/format'
import { softSpring } from '../lib/motion'
import { inWatchlist, openDetail, playMovie, setAmbient, toggleWatchlist, useApp } from '../store'
import { Button, IconButton } from './ui'

/** Full-bleed featured banner that auto-rotates, with a cinematic gradient fade into the rows below */
// Portrait posters become a blurred backdrop; how strong follows the "Artwork glow" setting
const BACKDROP = { strong: 'opacity-100', subtle: 'opacity-60', off: 'opacity-30' }

export function Hero({ items }: { items: (Movie | Show)[] }) {
  const [i, setI] = useState(0)
  const glow = useApp((s) => s.settings.ambient)
  const [paused, setPaused] = useState(false)
  useApp((s) => s.watchlist)
  const item = items[i % items.length]

  useEffect(() => {
    if (paused || items.length < 2) return
    const id = setTimeout(() => setI((n) => (n + 1) % items.length), 9000)
    return () => clearTimeout(id)
  }, [i, paused, items.length])
  useEffect(() => {
    setAmbient(item?.poster)
  }, [item])

  if (!item) return null
  const art = (item.kind === 'series' && item.backdrop) || item.poster
  const wide = item.kind === 'series' && !!item.backdrop
  const listed = inWatchlist(item.id)

  return (
    <section className="relative h-[min(78vh,760px)] min-h-[540px] overflow-hidden" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {/* Masked so the artwork dissolves into the ambient background instead of ending in a hard edge */}
      <div className="absolute inset-0 [mask-image:linear-gradient(to_bottom,black_45%,transparent_96%)]">
        <AnimatePresence initial={false}>
          <motion.div
            key={item.id}
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 1.06 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ opacity: { duration: 0.9 }, scale: { duration: 9, ease: 'linear' } }}
          >
            {art && (
              <img
                src={art}
                alt=""
                referrerPolicy="no-referrer"
                className={`absolute inset-0 size-full object-cover object-[center_22%] ${wide ? '' : `scale-110 blur-2xl saturate-150 ${BACKDROP[glow]}`}`}
                onError={(e) => (e.currentTarget.style.display = 'none')}
              />
            )}
          </motion.div>
        </AnimatePresence>
        <div className="absolute inset-0 bg-gradient-to-r from-[rgb(var(--base-rgb)/0.92)] via-[rgb(var(--base-rgb)/0.45)] to-transparent" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[rgb(var(--base-rgb)/0.55)] to-transparent" />
      </div>

      <AnimatePresence>
        {/* Portrait posters get a crisp floating card on the right instead of a stretched backdrop */}
        {!wide && art && (
          <motion.img
            key={item.id}
            src={art}
            alt=""
            referrerPolicy="no-referrer"
            initial={{ opacity: 0, y: 30, rotate: -2 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ ...softSpring, delay: 0.15 }}
            className="absolute right-[9%] top-[18%] hidden aspect-[2/3] h-[56%] rounded-[28px] object-cover shadow-[0_50px_100px_-20px_rgb(0_0_0/0.85),inset_0_1px_0_rgb(255_255_255/0.3)] ring-1 ring-white/15 lg:block"
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
        )}
      </AnimatePresence>

      <div className="absolute inset-x-0 bottom-0 px-14 pb-36">
        <AnimatePresence mode="wait">
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={softSpring}
            className="max-w-2xl"
          >
            <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-fg/60">
              <span className="rounded-md bg-fg/12 px-2 py-0.5 text-fg/80">{item.kind === 'series' ? 'Series' : 'Movie'}</span>
              <span className="truncate">{item.group}</span>
            </div>
            <h1 className="text-[clamp(40px,5.4vw,76px)] font-[800] leading-[0.95] tracking-[-0.045em] [text-wrap:balance] drop-shadow-[0_4px_30px_rgb(0_0_0/0.4)]">
              {cleanName(item.name)}
            </h1>
            <div className="mt-4 flex items-center gap-3 text-[14px] font-medium text-fg/70">
              {item.year && <span>{item.year}</span>}
              {!!item.rating && (
                <span className="flex items-center gap-1">
                  <Star className="size-3.5 fill-amber-300 text-amber-300" /> {item.rating.toFixed(1)}
                </span>
              )}
            </div>
            {item.plot && <p className="mt-4 line-clamp-3 max-w-xl text-[15.5px] leading-relaxed text-fg/75">{item.plot}</p>}
            <div className="mt-7 flex items-center gap-3">
              <Button variant="primary" size="lg" icon={<Play className="size-5 fill-current" />} onClick={() => (item.kind === 'movie' ? playMovie(item) : openDetail(item))}>
                {item.kind === 'movie' ? 'Play' : 'Episodes'}
              </Button>
              <Button size="lg" icon={<Info className="size-5" />} onClick={() => openDetail(item)}>
                More Info
              </Button>
              <IconButton label={listed ? 'Remove from Watchlist' : 'Add to Watchlist'} className="size-13" onClick={() => toggleWatchlist(item)}>
                {listed ? <Check className="size-5" /> : <Plus className="size-5" />}
              </IconButton>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {items.length > 1 && (
        <div className="absolute bottom-36 right-14 flex gap-2">
          {items.map((it, n) => (
            <button
              key={it.id}
              tabIndex={-1}
              aria-label={`Show ${it.name}`}
              onClick={() => setI(n)}
              className={`h-1.5 rounded-full transition-all duration-500 ${n === i % items.length ? 'w-7 bg-fg' : 'w-1.5 bg-fg/35 hover:bg-fg/60'}`}
            />
          ))}
        </div>
      )}
    </section>
  )
}
