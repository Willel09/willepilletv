import { AnimatePresence, motion } from 'framer-motion'
import { artUrl } from '../lib/format'
import { useApp } from '../store'

const LEVEL = { strong: { opacity: 0.42, sat: 'saturate-[1.6]' }, subtle: { opacity: 0.2, sat: 'saturate-[1.1]' }, off: null }

/** The theme's soft glow, plus (optionally) a blurred wash of whatever artwork is focused */
export function Ambient() {
  const src = useApp((s) => s.ambient)
  const level = LEVEL[useApp((s) => s.settings.ambient)]
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_15%_0%,rgb(var(--glow-1)/0.32),transparent_70%),radial-gradient(55%_55%_at_95%_100%,rgb(var(--glow-2)/0.4),transparent_70%)]" />
      <AnimatePresence>
        {level && src && (
          <motion.img
            key={src}
            src={artUrl(src, 342)}
            alt=""
            referrerPolicy="no-referrer"
            onError={(e) => (e.currentTarget.style.display = 'none')}
            initial={{ opacity: 0, scale: 1.25 }}
            animate={{ opacity: level.opacity, scale: 1.15 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.4, ease: [0.2, 0.7, 0.2, 1] }}
            className={`ambient-art absolute inset-0 size-full object-cover blur-[100px] ${level.sat}`}
          />
        )}
      </AnimatePresence>
      {/* keep text legible over very bright artwork */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_30%,transparent,rgb(var(--base-rgb)/0.7))]" />
    </div>
  )
}
