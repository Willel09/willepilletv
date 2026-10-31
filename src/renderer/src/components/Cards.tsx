import { motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { Heart, Play, Star } from 'lucide-react'
import type { PointerEvent, ReactNode } from 'react'
import { cleanName } from '../lib/format'
import { spring } from '../lib/motion'
import { setAmbient } from '../store'
import { Img } from './Img'

/** tvOS-style parallax: the card tilts toward the pointer and a specular sheen follows it */
function useTilt() {
  const x = useMotionValue(0.5)
  const y = useMotionValue(0.5)
  const sx = useSpring(x, { stiffness: 250, damping: 22 })
  const sy = useSpring(y, { stiffness: 250, damping: 22 })
  const rotateY = useTransform(sx, [0, 1], [-9, 9])
  const rotateX = useTransform(sy, [0, 1], [7, -7])
  const sheenX = useTransform(sx, [0, 1], ['0%', '100%'])
  const sheenY = useTransform(sy, [0, 1], ['0%', '100%'])
  const sheen = useMotionTemplate`radial-gradient(90% 70% at ${sheenX} ${sheenY}, rgba(255,255,255,0.28), transparent 60%)`
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    x.set((e.clientX - r.left) / r.width)
    y.set((e.clientY - r.top) / r.height)
  }
  const onPointerLeave = () => (x.set(0.5), y.set(0.5))
  return { rotateX, rotateY, sheen, onPointerMove, onPointerLeave }
}

const lift = {
  rest: { scale: 1, y: 0, boxShadow: '0 12px 30px -14px rgba(0,0,0,0.6)' },
  focus: { scale: 1.08, y: -6, boxShadow: '0 40px 70px -18px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.18), 0 0 46px -6px rgb(var(--accent-rgb) / 0.45)' }
}
const fade = { rest: { opacity: 0 }, focus: { opacity: 1 } }

interface CardShellProps {
  aspect: string
  width: number | string
  art?: string
  ambientArt?: string
  name: string
  contain?: boolean
  onClick: () => void
  footer?: ReactNode
  overlay?: ReactNode
  className?: string
}

function CardShell({ aspect, width, art, ambientArt, name, contain, onClick, footer, overlay, className = '' }: CardShellProps) {
  const t = useTilt()
  const ambient = () => setAmbient(ambientArt ?? art)
  return (
    <motion.button
      className={`card group relative shrink-0 text-left ${className}`}
      style={{ width }}
      initial="rest"
      animate="rest"
      whileHover="focus"
      whileFocus="focus"
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      onFocus={ambient}
      onMouseEnter={ambient}
      onPointerMove={t.onPointerMove}
      onPointerLeave={t.onPointerLeave}
    >
      <motion.div
        variants={lift}
        transition={spring}
        style={{ rotateX: t.rotateX, rotateY: t.rotateY, transformPerspective: 900 }}
        className={`relative overflow-hidden rounded-[22px] bg-[var(--card-bg)] ${aspect}`}
      >
        <Img src={art} name={name} contain={contain} className={`size-full ${contain ? 'p-[14%]' : ''}`} />
        {overlay}
        {/* specular sheen */}
        <motion.div
          variants={fade}
          transition={spring}
          className="pointer-events-none absolute inset-0"
          style={{ background: t.sheen }}
        />
        <div className="pointer-events-none absolute inset-0 rounded-[22px] shadow-[inset_0_1px_0_rgb(255_255_255/0.22),inset_0_0_0_1px_rgb(255_255_255/0.08)]" />
      </motion.div>
      {footer}
    </motion.button>
  )
}

const Title = ({ children }: { children: ReactNode }) => (
  <div className="mt-3 truncate px-1 text-[13px] font-medium text-fg/65 transition-colors group-hover:text-fg group-focus:text-fg">{children}</div>
)

export function PosterCard({ name, poster, rating, onClick, width = 176, badge }: { name: string; poster?: string; rating?: number; onClick: () => void; width?: number | string; badge?: ReactNode }) {
  return (
    <CardShell
      aspect="aspect-[2/3]"
      width={width}
      art={poster}
      name={name}
      onClick={onClick}
      overlay={
        <>
          {!!rating && (
            <span className="glass-thin absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white">
              <Star className="size-3 fill-amber-300 text-amber-300" />
              {rating.toFixed(1)}
            </span>
          )}
          {badge}
        </>
      }
      footer={<Title>{cleanName(name)}</Title>}
    />
  )
}

export function ChannelTile({ name, logo, subtitle, onClick, width = 236, fav }: { name: string; logo?: string; subtitle?: string; onClick: () => void; width?: number | string; fav?: boolean }) {
  return (
    <CardShell
      aspect="aspect-video glass-thin"
      width={width}
      art={logo}
      name={name}
      contain
      onClick={onClick}
      overlay={fav && <Heart className="absolute right-3 top-3 size-4 fill-rose-400 text-rose-400" />}
      footer={
        <div className="mt-3 px-1">
          <div className="truncate text-[13px] font-semibold text-fg/85 group-hover:text-fg">{cleanName(name)}</div>
          {subtitle && <div className="truncate text-[12px] text-fg/45">{subtitle}</div>}
        </div>
      }
    />
  )
}

export function WideCard({ name, art, subtitle, progress, onClick, width = 340 }: { name: string; art?: string; subtitle?: string; progress?: number; onClick: () => void; width?: number }) {
  return (
    <CardShell
      aspect="aspect-video"
      width={width}
      art={art}
      name={name}
      onClick={onClick}
      overlay={
        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/20 to-transparent p-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/90 text-black shadow-lg">
              <Play className="ml-0.5 size-4 fill-black" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold tracking-[-0.01em] text-white">{cleanName(name)}</div>
              {subtitle && <div className="truncate text-[12px] text-white/65">{subtitle}</div>}
            </div>
          </div>
          {progress !== undefined && (
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-white" style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </div>
          )}
        </div>
      }
    />
  )
}
