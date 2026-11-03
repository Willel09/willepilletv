import { Clapperboard, Dices, Library, Play, RotateCcw, Star, Tv } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Channel, Movie, Show } from '../../../shared/types'
import { Img } from '../components/Img'
import { Button, Segmented } from '../components/ui'
import { nowNext } from '../lib/epg'
import { cleanName } from '../lib/format'
import { openDetail, playChannel, playMovie, useApp, useIndex } from '../store'

type Kind = 'movie' | 'series' | 'channel'
type Pick = Movie | Show | Channel

const TV = typeof (window as { tizen?: unknown }).tizen !== 'undefined'
/** cards on the reel, and which of them the reel stops on (a few more follow it, as on a real slot machine) */
const CARDS = TV ? 26 : 44
const STOP = CARDS - 5
const GAP = 20
const SPIN_MS = 5600
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const widthOf = (k: Kind) => (k === 'channel' ? 236 : 176)
const imgOf = (x: Pick) => (x.kind === 'live' ? x.logo : x.poster)

/** `n` different random items that pass `ok`; fewer if the library has fewer */
function sample<T extends { id: string }>(list: T[], n: number, ok: (x: T) => boolean): T[] {
  const out: T[] = []
  const seen = new Set<string>()
  for (let tries = 0; tries < n * 40 && out.length < n; tries++) {
    const x = list[Math.floor(Math.random() * list.length)]
    if (x && !seen.has(x.id) && ok(x)) (seen.add(x.id), out.push(x))
  }
  // a small or picky library: fill up with anything
  for (let tries = 0; list.length && out.length < n && tries < n * 20; tries++) {
    const x = list[Math.floor(Math.random() * list.length)]
    if (!seen.has(x.id)) (seen.add(x.id), out.push(x))
  }
  return out
}

/** Sparks that fly out from the winner */
function Burst() {
  const sparks = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => {
        const a = (i / 28) * Math.PI * 2 + Math.random() * 0.4
        const d = 120 + Math.random() * 170
        return { bx: Math.cos(a) * d, by: Math.sin(a) * d, hue: Math.floor(Math.random() * 360), size: 6 + Math.random() * 7, delay: Math.random() * 0.12 }
      }),
    []
  )
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-10">
      {sparks.map((s, i) => (
        <span
          key={i}
          className="rnd-burst absolute rounded-full"
          style={{ ['--bx' as string]: `${s.bx}px`, ['--by' as string]: `${s.by}px`, width: s.size, height: s.size, background: `hsl(${s.hue} 90% 65%)`, animationDelay: `${s.delay}s` }}
        />
      ))}
    </div>
  )
}

function Card({ x, kind, won }: { x: Pick; kind: Kind; won: boolean }) {
  const w = widthOf(kind)
  return (
    <div className="relative shrink-0" style={{ width: w }}>
      <div className={`relative overflow-hidden rounded-[22px] bg-[var(--card-bg)] ${kind === 'channel' ? 'aspect-video glass-thin' : 'aspect-[2/3]'} ${won ? 'rnd-pop z-10 shadow-[0_0_80px_-4px_rgb(var(--accent-rgb)/0.9)] ring-2 ring-white' : ''}`}>
        <Img src={imgOf(x)} name={x.name} contain={kind === 'channel'} className={`size-full ${kind === 'channel' ? 'p-[14%]' : ''}`} />
      </div>
    </div>
  )
}

export default function Random() {
  const idx = useIndex()
  const epg = useApp((s) => s.epg)
  const history = useApp((s) => s.history)
  const [kind, setKind] = useState<Kind>('movie')
  const [good, setGood] = useState(false)
  // one spin: the reel's cards, and where it is
  const [spin, setSpin] = useState<{ n: number; kind: Kind; cards: Pick[]; phase: 'start' | 'run' | 'done' } | null>(null)
  const view = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const counts = { movie: idx.movies.length, series: idx.series.length, channel: idx.channels.length }
  const empty = counts[kind] === 0

  const go = useCallback(() => {
    if (!counts[kind]) return
    const watched = new Set(history.map((h) => h.id))
    const ok = (x: Pick) => (x.kind === 'live' ? !!x.logo : !!x.poster && (!good || (x.rating ?? 0) >= 7) && !watched.has(x.id))
    const list = (kind === 'movie' ? idx.movies : kind === 'series' ? idx.series : idx.channels) as Pick[]
    clearTimeout(timer.current)
    setSpin((s) => ({ n: (s?.n ?? 0) + 1, kind, cards: sample(list, CARDS, ok), phase: 'start' }))
  }, [kind, good, idx, history, counts[kind]]) // eslint-disable-line react-hooks/exhaustive-deps

  // the reel starts at the left, then (one frame later, so the browser has drawn that) rolls to the winner
  useEffect(() => {
    if (spin?.phase !== 'start') return
    const f = requestAnimationFrame(() => requestAnimationFrame(() => setSpin((s) => s && { ...s, phase: 'run' })))
    return () => cancelAnimationFrame(f)
  }, [spin?.n, spin?.phase])
  useEffect(() => {
    if (spin?.phase !== 'run') return
    timer.current = setTimeout(() => setSpin((s) => s && { ...s, phase: 'done' }), reduced() ? 50 : SPIN_MS + 150)
    return () => clearTimeout(timer.current)
  }, [spin?.n, spin?.phase])

  const winner = spin && spin.cards.length > STOP ? spin.cards[STOP] : spin?.cards[spin.cards.length - 1]
  const w = spin ? widthOf(spin.kind) : 0
  // centre the winner under the marker, and a little off-centre when the reel starts so it never sits still
  const x = spin?.phase === 'start' ? 0 : -(Math.min(STOP, (spin?.cards.length ?? 1) - 1) * (w + GAP) + w / 2) + (view.current?.clientWidth ?? 1000) / 2

  const open = () => {
    if (!winner) return
    if (winner.kind === 'live') playChannel(winner)
    else if (winner.kind === 'movie') playMovie(winner)
    else openDetail(winner)
  }
  const details = () => winner && winner.kind !== 'live' && openDetail(winner)
  const now = winner?.kind === 'live' ? nowNext(epg?.programmes[winner.id]).now?.title : undefined
  const done = spin?.phase === 'done' && winner

  return (
    <div className="h-full overflow-y-auto pt-[100px]">
      <div className="mx-auto flex max-w-4xl flex-col items-center px-8 pb-6 text-center">
        <h1 className="text-[40px] font-[800] leading-none tracking-[-0.04em]">Feeling lucky?</h1>
        <p className="mt-3 text-[15px] text-fg/55">Pick what you're in the mood for and let Lumen choose.</p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
          <Segmented
            layoutId="rnd-kind"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'movie', label: <><Clapperboard className="size-4" /> Movie</> },
              { value: 'series', label: <><Library className="size-4" /> Series</> },
              { value: 'channel', label: <><Tv className="size-4" /> Channel</> }
            ]}
          />
          {kind !== 'channel' && (
            <Segmented layoutId="rnd-good" value={good ? 'good' : 'any'} onChange={(v) => setGood(v === 'good')} options={[{ value: 'any', label: 'Anything' }, { value: 'good', label: 'Rated 7+' }]} />
          )}
        </div>
      </div>

      {/* the reel */}
      <div ref={view} className="relative mx-auto h-[330px] w-full max-w-[1500px] overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
        {spin && (
          <div
            key={spin.n}
            className="absolute left-0 top-0 flex h-full items-center will-change-transform"
            style={{
              gap: GAP,
              transform: `translate3d(${x}px,0,0)`,
              transition: spin.phase === 'start' ? 'none' : reduced() ? 'none' : `transform ${SPIN_MS}ms cubic-bezier(0.1, 0.72, 0.1, 1)`
            }}
          >
            {spin.cards.map((c, i) => (
              <Card key={c.id} x={c} kind={spin.kind} won={spin.phase === 'done' && i === STOP} />
            ))}
          </div>
        )}
        {!spin && (
          <div className="grid h-full place-items-center text-fg/35">
            <Dices className="size-24" strokeWidth={1.2} />
          </div>
        )}
        {/* the marker the reel stops at */}
        {spin && <div className="pointer-events-none absolute inset-y-4 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-white/60 to-transparent" />}
        {done && <Burst />}
      </div>

      <div className="mx-auto flex max-w-3xl flex-col items-center px-8 pb-20 text-center">
        {done ? (
          <div key={spin.n} className="rnd-rise mt-4">
            <h2 className="text-[34px] font-[800] leading-tight tracking-[-0.035em] [text-wrap:balance]">{cleanName(winner.name)}</h2>
            <div className="mt-2 flex items-center justify-center gap-3 text-[15px] font-medium text-fg/60">
              {winner.kind !== 'live' && winner.year && <span>{winner.year}</span>}
              {winner.kind !== 'live' && !!winner.rating && (
                <span className="flex items-center gap-1">
                  <Star className="size-3.5 fill-amber-300 text-amber-300" /> {winner.rating.toFixed(1)}
                </span>
              )}
              {winner.kind === 'live' && <span>{now ? `Now: ${now}` : winner.group}</span>}
            </div>
            {winner.kind !== 'live' && winner.plot && <p className="mx-auto mt-3 line-clamp-3 max-w-xl text-[14.5px] leading-relaxed text-fg/60">{winner.plot}</p>}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button variant="primary" size="lg" data-nav-default icon={<Play className="size-5 fill-current" />} onClick={open}>
                {winner.kind === 'series' ? 'Open series' : 'Play'}
              </Button>
              {winner.kind === 'movie' && <Button size="lg" onClick={details}>Details</Button>}
              <Button size="lg" icon={<RotateCcw className="size-4.5" />} onClick={go}>Spin again</Button>
            </div>
          </div>
        ) : (
          <div className="mt-6">
            <Button variant="primary" size="lg" autoFocus data-nav-default disabled={empty || spin?.phase === 'run' || spin?.phase === 'start'} icon={<Dices className="size-5" />} onClick={go}>
              {spin ? 'Rolling…' : 'Spin'}
            </Button>
            {empty && <p className="mt-4 text-[14px] text-fg/50">There are no {kind === 'channel' ? 'channels' : kind === 'movie' ? 'movies' : 'series'} in your library yet.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
