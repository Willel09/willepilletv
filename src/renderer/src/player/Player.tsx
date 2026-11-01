import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, Captions, Maximize2, X, ChevronDown, ChevronLeft, ChevronUp, Copy, ExternalLink, Gauge, Heart, Languages, Maximize, Minimize,
  Cast, Moon, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, SkipForward, Volume1, Volume2, VolumeX
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Spinner } from '../components/ui'
import { nowNext, useNow } from '../lib/epg'
import { artUrl, cleanName, clock, duration } from '../lib/format'
import { sheetSpring, spring } from '../lib/motion'
import type { CastDevice } from '../../../shared/types'
import { api, canMiniPlayer, closePlayer, setCastTo, expandPlayer, index, isFavorite, minimizePlayer, playChannel, playEpisode, saveProgress, toast, toggleFavorite, useApp, type PlayRequest } from '../store'

const desktop = api.device === 'desktop'
const tv = api.device === 'tv'
import { createEngine, pickEngines, type Engine, type Track } from './engine'

const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n))
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const SLEEP = [0, 15, 30, 60, 90]

function CtrlBtn({ label, onClick, children, active, big }: { label: string; onClick: () => void; children: ReactNode; active?: boolean; big?: boolean }) {
  return (
    <motion.button
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.92 }}
      transition={spring}
      aria-label={label}
      title={label}
      onClick={onClick}
      data-nav-default={big ? '' : undefined}
      className={`grid shrink-0 place-items-center rounded-full transition-colors ${big ? 'size-13 bg-white text-black hover:bg-white/90' : 'size-10 text-white/85 hover:bg-white/14 hover:text-white'} ${active ? 'bg-white/18 text-white' : ''}`}
    >
      {children}
    </motion.button>
  )
}

function Menu<T extends string | number>({ title, options, value, onPick, footer }: { title: string; options: { value: T; label: string }[]; value: T; onPick: (v: T) => void; footer?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.95 }}
      transition={spring}
      className="glass-strong absolute bottom-full right-0 mb-16 w-60 origin-bottom-right rounded-[22px] p-2"
    >
      <div className="px-3 pb-1.5 pt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white/45">{title}</div>
      <div className="max-h-72 overflow-y-auto">
        {options.map((o) => (
          <button key={String(o.value)} onClick={() => onPick(o.value)} className={`flex w-full items-center justify-between rounded-[14px] px-3 py-2 text-left text-[13.5px] font-medium hover:bg-white/10 ${o.value === value ? 'text-white' : 'text-white/70'}`}>
            <span className="truncate">{o.label}</span>
            {o.value === value && <span className="size-2 rounded-full bg-accent shadow-[0_0_10px_var(--accent)]" />}
          </button>
        ))}
      </div>
      {footer && <div className="px-3 pb-2 pt-1 text-[11.5px] leading-snug text-white/45">{footer}</div>}
    </motion.div>
  )
}

function SeekBar({ time, dur, buffered, onSeek }: { time: number; dur: number; buffered: number; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const ratio = (x: number) => {
    const r = ref.current!.getBoundingClientRect()
    return clamp((x - r.left) / r.width)
  }
  const pos = drag ?? (dur ? time / dur : 0)
  return (
    <div
      ref={ref}
      className="group relative flex h-6 cursor-pointer items-center"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setDrag(ratio(e.clientX))
      }}
      onPointerMove={(e) => {
        const r = ratio(e.clientX)
        setHover(r)
        if (drag !== null) setDrag(r)
      }}
      onPointerUp={() => {
        if (drag !== null) onSeek(drag * dur)
        setDrag(null)
      }}
      onPointerLeave={() => setHover(null)}
    >
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/20 transition-[height] duration-200 group-hover:h-2">
        <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${clamp(dur ? buffered / dur : 0) * 100}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${pos * 100}%` }} />
      </div>
      <div className="absolute size-4 -translate-x-1/2 scale-0 rounded-full bg-white shadow-[0_2px_10px_rgb(0_0_0/0.5)] transition-transform group-hover:scale-100" style={{ left: `${pos * 100}%` }} />
      {hover !== null && (
        <div className="glass-strong pointer-events-none absolute -top-10 -translate-x-1/2 rounded-xl px-2.5 py-1 text-[12px] font-semibold tabular-nums" style={{ left: `${hover * 100}%` }}>
          {duration(hover * dur)}
        </div>
      )}
    </div>
  )
}

interface SessionProps {
  req: PlayRequest
  mini: boolean
  fullscreen: boolean
  sleepAt: number
  setSleepAt: (t: number) => void
}

/** One playback session. Re-keyed on every channel zap / episode so all state resets cleanly. */
function Session({ req, mini, fullscreen, sleepAt, setSleepAt }: SessionProps) {
  const settings = useApp((s) => s.settings)
  const epg = useApp((s) => s.epg)
  useApp((s) => s.favorites)
  const t = useNow(15_000)
  const live = req.kind === 'live'
  const video = useRef<HTMLVideoElement>(null)
  const engine = useRef<Engine | null>(null)

  const [altFormat, setAltFormat] = useState(false)
  const [engineIdx, setEngineIdx] = useState(0)
  const [nonce, setNonce] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const firstError = useRef<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(true)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(() => +(localStorage.getItem('volume') ?? 1))
  const [muted, setMuted] = useState(false)
  const [res, setRes] = useState('')
  const [rate, setRate] = useState(1)
  const [menu, setMenu] = useState<'audio' | 'subs' | 'speed' | 'sleep' | 'cast' | null>(null)
  const castTo = useApp((s) => s.castTo)
  const casting = useRef(false)
  casting.current = !!castTo
  const [castDevices, setCastDevices] = useState<CastDevice[] | null>(null)
  const [tracks, setTracks] = useState<{ audio: Track[]; subs: Track[]; ca: number; cs: number }>({ audio: [], subs: [], ca: -1, cs: -1 })
  const [visible, setVisible] = useState(true)
  const [numBuf, setNumBuf] = useState('')
  const [upNext, setUpNext] = useState<number | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Xtream live channels can be switched between MPEG-TS and HLS
  const fmt = req.channel?.xt ? (altFormat ? (settings.liveFormat === 'ts' ? 'm3u8' : 'ts') : settings.liveFormat) : null
  const url = fmt ? req.url.replace(/\.(ts|m3u8)$/, `.${fmt}`) : req.url
  const engines = useMemo(() => pickEngines(url, live), [url, live])

  // casting: hand the stream to the TV (again after zapping) and keep the local video paused
  useEffect(() => {
    if (!castTo || !api.cast) return
    video.current?.pause()
    const at = video.current?.currentTime || req.startAt
    api.cast
      .start(castTo.id, { url: req.channel?.xt ? req.url.replace(/\.(ts|m3u8)$/, '.ts') : url, hlsUrl: req.channel?.xt ? req.url.replace(/\.(ts|m3u8)$/, '.m3u8') : undefined, title: cleanName(req.title), poster: artUrl(req.poster ?? req.channel?.logo, 780), live, startAt: at })
      .then((r) => {
        if (r.ok) return toast(`Playing on ${castTo.name}`)
        toast(r.error!)
        setCastTo(null)
      })
  }, [castTo?.id, url]) // eslint-disable-line react-hooks/exhaustive-deps
  const openCast = () => {
    setMenu(menu === 'cast' ? null : 'cast')
    setCastDevices(null)
    api.cast!.discover().then(setCastDevices)
  }
  const stopCast = () => {
    void api.cast?.stop()
    setCastTo(null)
    video.current?.play().catch(() => {})
  }

  const nextEp = useMemo(() => {
    if (!req.episodes || !req.episode) return undefined
    const i = req.episodes.findIndex((e) => e.id === req.episode!.id)
    return i >= 0 ? req.episodes[i + 1] : undefined
  }, [req])

  /* ---------- engine lifecycle ---------- */
  useEffect(() => {
    const v = video.current!
    let done = false
    let started = false
    setError(null)
    setBuffering(true)
    const fail = (msg: string) => {
      if (done) return
      done = true
      firstError.current ??= msg
      if (engineIdx < engines.length - 1) setEngineIdx((i) => i + 1)
      else setError(firstError.current)
    }
    const onPlaying = () => (started = true)
    v.addEventListener('playing', onPlaying)
    const stall = setTimeout(() => !started && fail("The stream isn't responding. The channel may be offline."), 25_000)
    const syncTracks = () => {
      const e = engine.current
      if (e) setTracks({ audio: e.audio(), subs: e.subs(), ca: e.currentAudio(), cs: e.currentSub() })
    }
    engine.current = createEngine(engines[engineIdx], v, url, live, fail, syncTracks)
    return () => {
      done = true
      clearTimeout(stall)
      v.removeEventListener('playing', onPlaying)
      engine.current?.destroy()
      engine.current = null
    }
  }, [url, engineIdx, nonce, engines, live])

  const retry = () => {
    firstError.current = null
    setEngineIdx(0)
    setNonce((n) => n + 1)
  }

  /* ---------- progress / history ---------- */
  // Tracked in a ref: by the time unmount cleanups run, the engine has already unloaded the <video>
  const pos = useRef({ t: 0, d: 0 })
  const save = useCallback(() => {
    const { t, d } = pos.current
    if (live || !isFinite(d) || d < 60 || t < 1) return
    saveProgress({ id: req.id, kind: req.kind, name: req.title, subtitle: req.subtitle, poster: req.poster, url: req.url, position: t, duration: d, updatedAt: Date.now(), parentId: req.show?.id })
  }, [req, live])

  useEffect(() => {
    const id = setInterval(() => !video.current?.paused && save(), 15_000)
    return () => {
      clearInterval(id)
      save()
    }
  }, [save])

  /* ---------- video events ---------- */
  const resumed = useRef(false)
  const onMeta = () => {
    const v = video.current!
    v.volume = volume
    v.playbackRate = rate
    setRes(v.videoHeight ? (v.videoHeight >= 2000 ? '4K' : `${v.videoHeight >= 1000 ? 1080 : v.videoHeight >= 700 ? 720 : v.videoHeight}p`) : '')
    if (req.startAt && !resumed.current) {
      resumed.current = true
      v.currentTime = req.startAt
      toast(`Resumed from ${duration(req.startAt)}`)
    }
  }
  const onFirstPlay = () => {
    if (live && req.channel)
      saveProgress({ id: req.id, kind: 'live', name: req.title, poster: req.channel.logo, url: req.url, position: 0, duration: 0, updatedAt: Date.now() })
  }
  const onEnded = () => {
    const v = video.current!
    if (live) return setError('The stream ended.')
    saveProgress({ id: req.id, kind: req.kind, name: req.title, subtitle: req.subtitle, poster: req.poster, url: req.url, position: v.duration, duration: v.duration, updatedAt: Date.now(), parentId: req.show?.id })
    if (nextEp && settings.autoplayNext) setUpNext(8)
    else closePlayer()
  }

  useEffect(() => {
    if (upNext === null) return
    if (upNext <= 0) return void playEpisode(req.show!, nextEp!, req.episodes!, true)
    const id = setTimeout(() => setUpNext((n) => (n ?? 1) - 1), 1000)
    return () => clearTimeout(id)
  }, [upNext, req, nextEp])

  /* ---------- controls ---------- */
  const show = useCallback(() => {
    setVisible(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      // TVs: controls hide only when no button is in use; a menu or the error card keeps them up
      const a = document.activeElement as HTMLElement | null
      if (tv && a?.tagName === 'BUTTON' && a.closest('[data-player]')) return show()
      setVisible(false)
    }, 3200)
  }, [])
  useEffect(() => (show(), () => clearTimeout(hideTimer.current)), [show])

  const v = () => video.current!
  const toggle = () => (v().paused ? v().play().catch(() => {}) : v().pause())
  const seek = (d: number) => !live && (v().currentTime = clamp(v().currentTime + d, 0, v().duration || 0))
  const setVol = (x: number) => {
    const n = clamp(x)
    v().volume = n
    v().muted = false
    setVolume(n)
    localStorage.setItem('volume', String(n))
  }
  const zap = (d: number) => {
    const list = req.channels ?? index().channels
    if (!req.channel || !list.length) return
    const i = list.findIndex((c) => c.id === req.channel!.id)
    playChannel(list[(i + d + list.length) % list.length], list)
  }
  const pip = () => (document.pictureInPictureElement ? document.exitPictureInPicture() : v().requestPictureInPicture()).catch(() => toast('Picture in Picture is not available for this stream'))
  const vlc = async () => {
    const r = await api.openInVlc(url, req.title)
    if (!r.ok) toast(r.error!)
    else v().pause()
  }
  const copy = () => navigator.clipboard.writeText(url).then(() => toast('Stream URL copied'))
  const toggleSubs = () => {
    if (!tracks.subs.length) return toast('No subtitles in this stream')
    engine.current?.setSub(tracks.cs >= 0 ? -1 : 0)
  }
  // Esc/Back: leave fullscreen first, then shrink to the mini player (TV: close)
  const close = () => (fullscreen ? api.win.setFullscreen(false) : canMiniPlayer ? minimizePlayer() : closePlayer())

  // Channel number entry ("1", "0", "4" → channel 104)
  useEffect(() => {
    if (!numBuf) return
    const id = setTimeout(() => {
      const n = +numBuf
      setNumBuf('')
      const list = req.channels ?? index().channels
      const ch = list.find((c) => c.num === n) ?? list[n - 1]
      if (ch) playChannel(ch, list)
      else toast(`No channel ${n}`)
    }, 1300)
    return () => clearTimeout(id)
  }, [numBuf, req.channels])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mini || useApp.getState().sourceSheet) return
      show()
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (tv) {
        // The remote: with a player button in focus (controls, a menu, the error card) the arrows move between
        // buttons and Back steps out of them; with none, the arrows seek / zap and OK brings up the controls
        const a = document.activeElement as HTMLElement | null
        const onButton = a?.tagName === 'BUTTON' && !!a.closest('[data-player]')
        if (onButton && k.startsWith('Arrow')) return // spatial navigation takes it
        if (onButton && (k === 'Escape' || k === 'Backspace') && !menu && !error) {
          a!.blur()
          setVisible(false)
          e.preventDefault()
          return void e.stopImmediatePropagation()
        }
        if (!onButton && (k === 'Enter' || (!live && (k === 'ArrowDown' || k === 'ArrowUp')))) {
          document.querySelector<HTMLElement>('[data-player] [data-nav-default]')?.focus()
          e.preventDefault()
          return void e.stopImmediatePropagation()
        }
      }
      switch (k) {
        case ' ':
        case 'k':
        case 'MediaPlayPause': toggle(); break
        case 'MediaPlay': v().play().catch(() => {}); break
        case 'MediaPause': v().pause(); break
        case 'MediaStop': closePlayer(); break
        case 'MediaRewind': seek(-10); break
        case 'MediaFastForward': seek(10); break
        case 'ChannelUp': zap(1); break
        case 'ChannelDown': zap(-1); break
        case 'ColorF0Red': if (req.channel) toggleFavorite(req.channel); break
        case 'ColorF1Green': toggleSubs(); break
        case 'Escape':
        case 'Backspace': if (menu) setMenu(null); else close(); break
        case 'ArrowLeft': seek(-10); break
        case 'ArrowRight': seek(10); break
        case 'ArrowUp': live ? zap(1) : setVol(volume + 0.05); break
        case 'ArrowDown': live ? zap(-1) : setVol(volume - 0.05); break
        case 'PageUp': zap(1); break
        case 'PageDown': zap(-1); break
        case 'f': api.win.setFullscreen(!fullscreen); break
        case 'm': v().muted = !v().muted; break
        case 'p': pip(); break
        case 'c': toggleSubs(); break
        case 'n': if (nextEp) playEpisode(req.show!, nextEp, req.episodes!, true); break
        default:
          if (live && /^[0-9]$/.test(k)) setNumBuf((b) => (b + k).slice(-4))
          else return // let Enter/Tab etc. work normally
      }
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  // Sleep timer
  useEffect(() => {
    if (!sleepAt) return
    const id = setInterval(() => {
      if (Date.now() < sleepAt) return
      setSleepAt(0)
      video.current?.pause()
      api.win.setFullscreen(false)
      closePlayer()
      toast('Sleep timer: playback stopped. Good night!')
    }, 5000)
    return () => clearInterval(id)
  }, [sleepAt, setSleepAt])

  const shown = !mini && (visible || !playing || !!menu || !!error)
  const { now, next, progress } = live ? nowNext(epg?.programmes[req.id], t) : {}
  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const fav = req.channel && isFavorite(req.channel.id)

  return (
    <div className="absolute inset-0" style={{ cursor: shown || mini ? 'default' : 'none' }} onMouseMove={show} onClick={() => setMenu(null)}>
      <video
        ref={video}
        className="absolute inset-0 size-full bg-black object-contain"
        playsInline
        onClick={toggle}
        onDoubleClick={() => api.win.setFullscreen(!fullscreen)}
        onPlay={(e) => (casting.current ? e.currentTarget.pause() : setPlaying(true))}
        onPause={() => setPlaying(false)}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => (setBuffering(false), setError(null))}
        onCanPlay={() => setBuffering(false)}
        onLoadedMetadata={onMeta}
        onLoadedData={onFirstPlay}
        onTimeUpdate={(e) => {
          const el = e.currentTarget
          if (el.currentSrc || el.srcObject) pos.current = { t: el.currentTime, d: el.duration }
          setTime(el.currentTime)
        }}
        onDurationChange={(e) => setDur(isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        onProgress={(e) => {
          const b = e.currentTarget.buffered
          if (b.length) setBuffered(b.end(b.length - 1))
        }}
        onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
        onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
        onEnded={onEnded}
      />

      {/* casting */}
      {castTo && !mini && (
        <div className="absolute inset-0 grid place-items-center bg-black/80">
          <div className="glass-strong flex flex-col items-center gap-4 rounded-[28px] px-10 py-8 text-center">
            <Cast className="size-10 text-white" />
            <div>
              <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white/55">Playing on</div>
              <div className="mt-1 text-[22px] font-bold text-white">{castTo.name}</div>
            </div>
            <button onClick={stopCast} className="rounded-full bg-white px-6 py-2.5 text-[14px] font-semibold text-black hover:bg-white/90">Stop casting</button>
          </div>
        </div>
      )}

      {/* buffering */}
      <AnimatePresence>
        {buffering && !error && !castTo && (
          <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="glass-strong flex flex-col items-center gap-3 rounded-[28px] px-8 py-6">
              <Spinner className="size-8 text-white" />
              <span className="text-[13px] font-medium text-white/70">{engineIdx > 0 ? 'Trying another way to play…' : live ? 'Tuning in…' : 'Loading…'}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* top bar */}
      <motion.div animate={{ opacity: shown ? 1 : 0, y: shown ? 0 : -20 }} transition={spring} className={`${mini ? '' : 'drag'} absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 pb-16 pt-5 sm:px-8 sm:pt-7 ${shown ? '' : 'pointer-events-none'}`}>
        <div className="no-drag flex min-w-0 items-center gap-4">
          <CtrlBtn label={canMiniPlayer ? 'Mini player (Esc)' : 'Back'} onClick={canMiniPlayer ? minimizePlayer : closePlayer}><ChevronLeft className="size-6" /></CtrlBtn>
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              {live && req.channel?.num !== undefined && <span className="text-[15px] font-semibold tabular-nums text-white/50">{req.channel.num}</span>}
              <h2 className="truncate text-[22px] font-bold tracking-[-0.025em] text-white">{cleanName(req.title)}</h2>
            </div>
            {(req.subtitle || now) && <p className="truncate text-[14px] text-white/65">{req.subtitle ?? now?.title}</p>}
          </div>
        </div>
        <div className="no-drag flex shrink-0 items-center gap-2">
          {live && <span className="hidden items-center gap-1.5 rounded-full bg-red-500/90 sm:flex px-3 py-1 text-[11.5px] font-bold uppercase tracking-[0.1em] text-white"><span className="size-1.5 animate-pulse rounded-full bg-white" />Live</span>}
          {res && <span className="glass-thin hidden rounded-full px-3 py-1 sm:inline text-[11.5px] font-bold text-white/85">{res}</span>}
          {req.channel && (
            <CtrlBtn label={fav ? 'Remove from Favorites' : 'Add to Favorites'} onClick={() => toggleFavorite(req.channel!)}>
              <Heart className={`size-5 ${fav ? 'fill-rose-400 text-rose-400' : ''}`} />
            </CtrlBtn>
          )}
          {canMiniPlayer && <CtrlBtn label="Close" onClick={closePlayer}><X className="size-5" /></CtrlBtn>}
        </div>
      </motion.div>

      {/* number entry */}
      <AnimatePresence>
        {numBuf && (
          <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="glass-strong absolute right-10 top-28 rounded-[24px] px-7 py-4 text-[44px] font-bold tabular-nums tracking-[-0.03em] text-white">
            {numBuf}
          </motion.div>
        )}
      </AnimatePresence>

      {/* bottom controls */}
      <motion.div
        animate={{ opacity: shown ? 1 : 0, y: shown ? 0 : 40 }}
        transition={spring}
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent pb-8 pt-24 ${shown ? '' : 'pointer-events-none'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="glass-strong mx-auto w-[94%] max-w-[1120px] rounded-[30px] px-3 pb-3 pt-3 sm:px-6 sm:pb-4 sm:pt-4">
          {live ? (
            <div className="flex items-center gap-4 px-1 text-[12.5px] tabular-nums text-white/60">
              {now ? (
                <>
                  <span>{clock(now.start)}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-white" style={{ width: `${(progress ?? 0) * 100}%` }} /></div>
                  <span>{clock(now.stop)}</span>
                  {next && <span className="hidden max-w-64 truncate text-white/45 md:inline">Next: {next.title}</span>}
                </>
              ) : (
                <div className="h-1.5 flex-1 rounded-full bg-gradient-to-r from-red-500/80 to-red-500/30" />
              )}
            </div>
          ) : (
            <div className="flex items-center gap-4 text-[12.5px] font-medium tabular-nums text-white/65">
              <span className="w-14 text-right">{duration(time)}</span>
              <div className="flex-1"><SeekBar time={time} dur={dur} buffered={buffered} onSeek={(x) => (v().currentTime = x)} /></div>
              <span className="w-14">-{duration(Math.max(0, dur - time))}</span>
            </div>
          )}

          <div className="mt-2.5 flex items-center gap-1.5">
            {live ? (
              <>
                <CtrlBtn label="Previous channel (↓)" onClick={() => zap(-1)}><ChevronDown className="size-5.5" /></CtrlBtn>
                <CtrlBtn big label={playing ? 'Pause' : 'Play'} onClick={toggle}>{playing ? <Pause className="size-6 fill-black" /> : <Play className="ml-0.5 size-6 fill-black" />}</CtrlBtn>
                <CtrlBtn label="Next channel (↑)" onClick={() => zap(1)}><ChevronUp className="size-5.5" /></CtrlBtn>
              </>
            ) : (
              <>
                <CtrlBtn label="Back 10 seconds" onClick={() => seek(-10)}><RotateCcw className="size-5" /></CtrlBtn>
                <CtrlBtn big label={playing ? 'Pause' : 'Play'} onClick={toggle}>{playing ? <Pause className="size-6 fill-black" /> : <Play className="ml-0.5 size-6 fill-black" />}</CtrlBtn>
                <CtrlBtn label="Forward 10 seconds" onClick={() => seek(10)}><RotateCw className="size-5" /></CtrlBtn>
                {nextEp && <CtrlBtn label="Next episode (N)" onClick={() => playEpisode(req.show!, nextEp, req.episodes!, true)}><SkipForward className="size-5" /></CtrlBtn>}
              </>
            )}

            {/* TVs have their own volume: the slider would only trap the remote's arrows */}
            <div className={`group/vol ml-3 hidden items-center gap-1 ${tv ? '' : 'sm:flex'}`}>
              <CtrlBtn label="Mute (M)" onClick={() => (v().muted = !v().muted)}><VolIcon className="size-5" /></CtrlBtn>
              <input data-nav-ignore type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume} onChange={(e) => setVol(+e.target.value)} aria-label="Volume" className="w-24 cursor-pointer" />
            </div>

            <div className="flex-1" />

            <div className="relative hidden sm:block" onClick={(e) => e.stopPropagation()}>
              <CtrlBtn label="Audio" active={menu === 'audio'} onClick={() => setMenu(menu === 'audio' ? null : 'audio')}><Languages className="size-5" /></CtrlBtn>
              <AnimatePresence>
                {menu === 'audio' && (
                  <Menu
                    title="Audio"
                    value={tracks.ca}
                    options={tracks.audio.length ? tracks.audio.map((a) => ({ value: a.id, label: a.label })) : [{ value: -1, label: 'Default' }]}
                    onPick={(id) => (engine.current?.setAudio(id), setTracks((x) => ({ ...x, ca: id })), setMenu(null))}
                    footer={desktop ? "No sound? AC3/DTS audio isn't supported by the built-in player — open the stream in VLC." : undefined}
                  />
                )}
              </AnimatePresence>
            </div>
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <CtrlBtn label="Subtitles (C)" active={menu === 'subs' || tracks.cs >= 0} onClick={() => setMenu(menu === 'subs' ? null : 'subs')}><Captions className="size-5" /></CtrlBtn>
              <AnimatePresence>
                {menu === 'subs' && (
                  <Menu title="Subtitles" value={tracks.cs} options={[{ value: -1, label: 'Off' }, ...tracks.subs.map((s) => ({ value: s.id, label: s.label }))]} onPick={(id) => (engine.current?.setSub(id), setMenu(null))} footer={!tracks.subs.length ? 'This stream has no subtitles.' : undefined} />
                )}
              </AnimatePresence>
            </div>
            {!live && (
              <div className="relative" onClick={(e) => e.stopPropagation()}>
                <CtrlBtn label="Playback speed" active={menu === 'speed' || rate !== 1} onClick={() => setMenu(menu === 'speed' ? null : 'speed')}><Gauge className="size-5" /></CtrlBtn>
                <AnimatePresence>
                  {menu === 'speed' && <Menu title="Speed" value={rate} options={SPEEDS.map((s) => ({ value: s, label: s === 1 ? 'Normal' : `${s}×` }))} onPick={(s) => ((v().playbackRate = s), setMenu(null))} />}
                </AnimatePresence>
              </div>
            )}
            <div className="relative hidden sm:block" onClick={(e) => e.stopPropagation()}>
              <CtrlBtn label="Sleep timer" active={menu === 'sleep' || !!sleepAt} onClick={() => setMenu(menu === 'sleep' ? null : 'sleep')}><Moon className="size-5" /></CtrlBtn>
              <AnimatePresence>
                {menu === 'sleep' && (
                  <Menu
                    title="Sleep Timer"
                    value={sleepAt ? -1 : 0}
                    options={SLEEP.map((m) => ({ value: m, label: m ? `${m} minutes` : 'Off' }))}
                    onPick={(m) => (setSleepAt(m ? Date.now() + m * 60_000 : 0), setMenu(null), m && toast(`Playback will stop in ${m} minutes`))}
                    footer={sleepAt ? `Stopping at ${clock(sleepAt)}` : undefined}
                  />
                )}
              </AnimatePresence>
            </div>
            {api.cast && (
              <div className="relative" onClick={(e) => e.stopPropagation()}>
                <CtrlBtn label="Cast to TV" active={menu === 'cast' || !!castTo} onClick={openCast}><Cast className="size-5" /></CtrlBtn>
                <AnimatePresence>
                  {menu === 'cast' && (
                    <Menu
                      title="Cast to"
                      value={castTo?.id ?? ''}
                      options={[
                        ...(castDevices ?? []).map((d) => ({ value: d.id, label: `${d.name}${d.kind === 'dlna' ? ' · DLNA' : ''}` })),
                        ...(castTo ? [{ value: '__stop', label: 'Stop casting' }] : [])
                      ]}
                      onPick={(id) => (setMenu(null), id === '__stop' ? stopCast() : setCastTo({ id, name: castDevices!.find((d) => d.id === id)!.name }))}
                      footer={castDevices === null ? 'Searching your network…' : !castDevices.length ? 'No TVs found. Chromecast / Google TV and Samsung TVs must be on and on the same network as this PC.' : undefined}
                    />
                  )}
                </AnimatePresence>
              </div>
            )}
            {!tv && <div className="hidden sm:block"><CtrlBtn label="Picture in Picture (P)" onClick={pip}><PictureInPicture2 className="size-5" /></CtrlBtn></div>}
            {desktop && <CtrlBtn label="Open in VLC" onClick={vlc}><ExternalLink className="size-5" /></CtrlBtn>}
            {!tv && <CtrlBtn label="Fullscreen (F)" onClick={() => api.win.setFullscreen(!fullscreen)}>{fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}</CtrlBtn>}
          </div>
        </div>
      </motion.div>

      {/* mini player overlay: click to expand */}
      {mini && (
        <div className="group absolute inset-0 cursor-pointer" onClick={expandPlayer}>
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/40 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            <div className="min-w-0 pt-1 text-white">
              <div className="truncate text-[13px] font-semibold">{cleanName(req.title)}</div>
              {(req.subtitle || now) && <div className="truncate text-[11.5px] text-white/65">{req.subtitle ?? now?.title}</div>}
            </div>
            <div className="flex shrink-0 gap-1.5" onClick={(e) => e.stopPropagation()}>
              <button aria-label="Expand" onClick={expandPlayer} className="glass-thin grid size-8 place-items-center rounded-full text-white hover:bg-white/20"><Maximize2 className="size-4" /></button>
              <button aria-label="Close" onClick={closePlayer} className="glass-thin grid size-8 place-items-center rounded-full text-white hover:bg-white/20"><X className="size-4" /></button>
            </div>
          </div>
          <button
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={(e) => (e.stopPropagation(), toggle())}
            className="absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-black opacity-0 shadow-xl transition-opacity duration-300 group-hover:opacity-100"
          >
            {playing ? <Pause className="size-5 fill-black" /> : <Play className="ml-0.5 size-5 fill-black" />}
          </button>
          {live ? (
            <span className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-white"><span className="size-1 rounded-full bg-white" />Live</span>
          ) : (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20"><div className="h-full bg-white" style={{ width: `${dur ? (time / dur) * 100 : 0}%` }} /></div>
          )}
          {error && !castTo && <div className="absolute inset-0 grid place-items-center bg-black/70 p-4 text-center text-[12.5px] font-medium text-white">Can't play this {live ? 'channel' : 'video'}. Click to see why.</div>}
        </div>
      )}

      {/* up next */}
      <AnimatePresence>
        {!mini && upNext !== null && nextEp && (
          <motion.div initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }} transition={sheetSpring} className="glass-strong absolute bottom-40 right-10 w-80 rounded-[26px] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/50">Up Next in {upNext}</div>
            <div className="mt-1 truncate text-[16px] font-semibold text-white">S{nextEp.season} E{nextEp.episode} · {nextEp.title}</div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setUpNext(0)} className="flex-1 rounded-full bg-white py-2 text-[13px] font-semibold text-black">Play Now</button>
              <button onClick={() => (setUpNext(null), closePlayer())} className="glass-thin flex-1 rounded-full py-2 text-[13px] font-semibold text-white">Close</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* error */}
      <AnimatePresence>
        {error && !mini && !castTo && menu !== 'cast' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-md" onClick={(e) => e.stopPropagation()}>
            <motion.div initial={{ y: 30, scale: 0.95 }} animate={{ y: 0, scale: 1 }} transition={sheetSpring} className="glass-strong w-[500px] max-w-[92vw] rounded-[32px] p-8 text-center">
              <div className="mx-auto mb-5 grid size-16 place-items-center rounded-full bg-amber-400/15 text-amber-300"><AlertTriangle className="size-8" /></div>
              <h3 className="text-[22px] font-bold tracking-[-0.025em] text-white">Can't play this {live ? 'channel' : 'video'}</h3>
              <p className="mx-auto mt-3 max-w-sm text-[14px] leading-relaxed text-white/65">{error}</p>
              <div className="mt-7 flex flex-wrap justify-center gap-2.5">
                <button autoFocus onClick={retry} className="flex h-10 items-center gap-2 rounded-full bg-white px-5 text-[13.5px] font-semibold text-black"><RotateCw className="size-4" /> Retry</button>
                {req.channel?.xt && (
                  <button onClick={() => (setAltFormat((a) => !a), (firstError.current = null), setEngineIdx(0))} className="glass-thin flex h-10 items-center rounded-full px-5 text-[13.5px] font-semibold text-white">
                    Try {fmt === 'ts' ? 'HLS' : 'MPEG-TS'}
                  </button>
                )}
                {api.cast && <button onClick={openCast} className="glass-thin flex h-10 items-center gap-2 rounded-full px-5 text-[13.5px] font-semibold text-white"><Cast className="size-4" /> Cast to TV</button>}
                {desktop && <button onClick={vlc} className="glass-thin flex h-10 items-center gap-2 rounded-full px-5 text-[13.5px] font-semibold text-white"><ExternalLink className="size-4" /> Open in VLC</button>}
                {!tv && <button onClick={copy} className="glass-thin flex h-10 items-center gap-2 rounded-full px-5 text-[13.5px] font-semibold text-white"><Copy className="size-4" /> Copy URL</button>}
              </div>
              {live && <button onClick={() => zap(1)} className="mt-4 text-[13px] font-semibold text-white/55 hover:text-white">Next channel →</button>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** `req` is passed as a prop (not read from the store) so the exit animation keeps the last frame */
export default function Player({ req }: { req: PlayRequest }) {
  const [fullscreen, setFullscreen] = useState(false)
  const [sleepAt, setSleepAt] = useState(0)
  const mini = useApp((s) => s.playerMini)
  // where the mini player was dragged to (relative to its corner); kept for the next time it shrinks
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragged = useRef(false)
  // the visible area (visualViewport) — on phones innerWidth can include off-screen layout width
  const viewport = () => ({ w: visualViewport?.width ?? innerWidth, h: visualViewport?.height ?? innerHeight })
  const [vp, setVp] = useState(viewport)
  useEffect(() => {
    const onResize = () => setVp(viewport())
    addEventListener('resize', onResize)
    visualViewport?.addEventListener('resize', onResize)
    return () => (removeEventListener('resize', onResize), visualViewport?.removeEventListener('resize', onResize))
  }, [])
  useEffect(() => api.onWindowState((s) => setFullscreen(s.fullscreen)), [])
  useEffect(
    () => () => {
      api.win.setFullscreen(false)
      if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {})
    },
    []
  )
  useEffect(() => {
    if (mini) api.win.setFullscreen(false)
  }, [mini])

  // Position and size are animated as plain properties (no layout transforms), and the drag offset
  // is part of the same target, so shrinking, dragging and expanding never fight each other.
  const margin = vp.w < 520 ? 12 : 24
  const mw = Math.min(420, vp.w - margin * 2)
  const mh = Math.round((mw * 9) / 16)
  const left = vp.w - mw - margin
  const top = vp.h - mh - margin
  const box = mini
    ? { top, left, width: mw, height: mh, borderRadius: 22, ...offset }
    // percentages, not innerWidth: phone browsers can report a layout viewport wider than the screen
    : { top: 0, left: 0, width: '100%', height: '100%', borderRadius: 0, x: 0, y: 0 }

  const startDrag = (e: React.PointerEvent) => {
    if (!mini || e.button !== 0) return
    const start = { px: e.clientX, py: e.clientY, ...offset }
    let moved = false
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.px
      const dy = ev.clientY - start.py
      if (!moved && Math.hypot(dx, dy) < 6) return
      moved = true
      setDragging(true)
      // keep the whole mini player on screen
      setOffset({ x: Math.min(12, Math.max(12 - left, start.x + dx)), y: Math.min(12, Math.max(12 - top, start.y + dy)) })
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      setDragging(false)
      if (moved) (dragged.current = true), setTimeout(() => (dragged.current = false), 50)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  return (
    <motion.div
      data-theme="dark"
      data-nav-scope={mini ? undefined : ''}
      data-player
      onPointerDown={startDrag}
      // a drag that ends over the player must not count as "click to expand"
      onClickCapture={(e) => dragged.current && e.stopPropagation()}
      className={`force-dark no-drag fixed z-50 overflow-hidden bg-black text-fg ${mini ? `shadow-[0_30px_80px_-10px_rgb(0_0_0/0.8)] ring-1 ring-white/15 ${dragging ? 'cursor-grabbing' : ''}` : ''}`}
      initial={{ opacity: 0, scale: 1.06, filter: 'blur(12px)', ...box }}
      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', ...box }}
      exit={{ opacity: 0, scale: mini ? 0.9 : 1.03, filter: 'blur(8px)' }}
      transition={dragging ? { duration: 0 } : sheetSpring}
    >
      <Session key={req.id} req={req} mini={mini} fullscreen={fullscreen} sleepAt={sleepAt} setSleepAt={setSleepAt} />
    </motion.div>
  )
}
