import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Star } from 'lucide-react'
import type { Movie, Show } from '../../../shared/types'
import { artUrl, cleanName } from '../lib/format'
import { api, index, useApp } from '../store'

type Title = Movie | Show

const SLIDE_MS = 14_000
const TV = api.device === 'tv'

/** Not at random from the whole list (500k titles): a few hundred random picks, the ones with artwork and a decent rating */
function pick(n: number): Title[] {
  const idx = index()
  const lists = [idx.movies, idx.series].filter((l) => l.length)
  const out: Title[] = []
  const seen = new Set<string>()
  for (let tries = 0; tries < 1500 && out.length < n; tries++) {
    const list = lists[Math.floor(Math.random() * lists.length)] as Title[]
    const x = list[Math.floor(Math.random() * list.length)]
    if (!x?.poster || seen.has(x.id) || (x.rating ?? 0) < (tries < 800 ? 6.5 : 0.1)) continue
    seen.add(x.id)
    out.push(x)
  }
  return out
}

const time = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function Slide({ t }: { t: Title }) {
  // each slide drifts its own way and sits somewhere else on the screen, which also spares OLED panels
  const look = useMemo(() => {
    const r = () => Math.random()
    return { dx: `${(r() * 4 - 2).toFixed(1)}%`, dy: `${(r() * 3 - 1.5).toFixed(1)}%`, right: r() > 0.5 }
  }, [])
  const art = artUrl(t.poster, 780)
  const wide = t.kind === 'series' && t.backdrop ? artUrl(t.backdrop, 1280) : undefined
  return (
    <div className="ss-slide absolute inset-0 overflow-hidden">
      {/* TVs: a blurred, scaled poster is a full-screen filter, too heavy there */}
      {!TV && (wide || art) && (
        <img
          src={wide ?? art}
          alt=""
          referrerPolicy="no-referrer"
          className={`ss-bg absolute inset-0 size-full object-cover ${wide ? '' : 'scale-125 blur-3xl saturate-150'}`}
          style={{ ['--ss-dx' as string]: look.dx, ['--ss-dy' as string]: look.dy }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/70" />
      <div className={`absolute inset-0 flex items-center gap-14 px-[8%] ${look.right ? 'flex-row-reverse' : ''}`}>
        <img src={art} alt="" referrerPolicy="no-referrer" className="aspect-[2/3] h-[62%] shrink-0 rounded-[28px] object-cover shadow-[0_50px_100px_-20px_rgb(0_0_0/0.9)] ring-1 ring-white/15" />
        <div className="min-w-0 max-w-2xl text-white">
          <div className="text-[13px] font-semibold uppercase tracking-[0.18em] text-white/60">{t.kind === 'movie' ? 'Movie' : 'Series'}</div>
          <h2 className="mt-3 text-[52px] font-[800] leading-[0.98] tracking-[-0.04em] [text-wrap:balance] 2xl:text-[72px]">{cleanName(t.name)}</h2>
          <div className="mt-5 flex items-center gap-4 text-[18px] font-medium text-white/75">
            {t.year && <span>{t.year}</span>}
            {!!t.rating && (
              <span className="flex items-center gap-1.5">
                <Star className="size-4.5 fill-amber-300 text-amber-300" /> {t.rating.toFixed(1)}
              </span>
            )}
          </div>
          {t.plot && <p className="mt-6 line-clamp-4 text-[19px] leading-relaxed text-white/70">{t.plot}</p>}
        </div>
      </div>
    </div>
  )
}

/** Full-screen artwork slideshow. Any key press, click or real mouse movement ends it (and is not passed on). */
export function Screensaver({ onWake }: { onWake: () => void }) {
  const [titles] = useState(() => pick(24))
  const [i, setI] = useState(0)
  const [now, setNow] = useState(time)

  useEffect(() => {
    const slides = setInterval(() => setI((x) => x + 1), SLIDE_MS)
    const clock = setInterval(() => setNow(time()), 15_000)
    let lx = -1, ly = -1
    const wake = (e: Event) => {
      if (e instanceof PointerEvent && e.type === 'pointermove') {
        // a mouse resting on the desk reports tiny moves
        const moved = lx < 0 || Math.hypot(e.clientX - lx, e.clientY - ly) > 6
        if (lx < 0) (lx = e.clientX), (ly = e.clientY)
        if (!moved) return
      }
      e.stopPropagation()
      e.preventDefault()
      onWake()
    }
    const evs = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const
    for (const ev of evs) window.addEventListener(ev, wake, { capture: true, passive: false })
    return () => {
      clearInterval(slides)
      clearInterval(clock)
      for (const ev of evs) window.removeEventListener(ev, wake, { capture: true })
    }
  }, [onWake])

  if (!titles.length) return null
  const t = titles[i % titles.length]
  return (
    <div className="fixed inset-0 z-[200] cursor-none bg-black" role="presentation">
      <Slide key={`${i}:${t.id}`} t={t} />
      <div className="absolute bottom-10 right-14 text-[34px] font-light tabular-nums tracking-tight text-white/70">{now}</div>
    </div>
  )
}

/**
 * True once nothing was touched for `mins` minutes. Playing something counts as being there: the screensaver
 * never starts while a video is open (a paused film can be left for a while).
 */
export function useIdle(mins: number): [boolean, () => void] {
  const [idle, setIdle] = useState(false)
  // the wake-up key press is swallowed (see Screensaver), so the timer is restarted here, or it would start again at once
  const last = useRef(Date.now())
  const playing = useApp((s) => !!s.player)
  const hasArt = useApp((s) => !!s.library?.movies.length || !!s.library?.series.length || !!s.library?.parts)
  useEffect(() => {
    if (!mins || playing || !hasArt) return setIdle(false)
    last.current = Date.now()
    const touch = () => (last.current = Date.now())
    const evs = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const
    for (const ev of evs) window.addEventListener(ev, touch, { passive: true })
    const timer = setInterval(() => Date.now() - last.current >= mins * 60_000 && setIdle(true), 5000)
    return () => {
      clearInterval(timer)
      for (const ev of evs) window.removeEventListener(ev, touch)
    }
  }, [mins, playing, hasArt])
  const wake = useCallback(() => ((last.current = Date.now()), setIdle(false)), [])
  return [idle, wake]
}
