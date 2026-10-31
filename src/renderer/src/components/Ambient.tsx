import { AnimatePresence, motion } from 'framer-motion'
import { useApp } from '../store'

/** The whole app picks up a blurred, colour-rich wash of whatever artwork is focused */
export function Ambient() {
  const src = useApp((s) => s.ambient)
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_15%_0%,color-mix(in_srgb,var(--accent)_22%,transparent),transparent_70%),radial-gradient(50%_50%_at_95%_100%,rgb(140_70_255/0.12),transparent_70%)]" />
      <AnimatePresence>
        {src && (
          <motion.img
            key={src}
            src={src}
            alt=""
            referrerPolicy="no-referrer"
            onError={(e) => (e.currentTarget.style.display = 'none')}
            initial={{ opacity: 0, scale: 1.25 }}
            animate={{ opacity: 0.42, scale: 1.15 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.4, ease: [0.2, 0.7, 0.2, 1] }}
            className="absolute inset-0 size-full object-cover blur-[100px] saturate-[1.6]"
          />
        )}
      </AnimatePresence>
      {/* keep text legible over very bright artwork */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_30%,transparent,color-mix(in_srgb,var(--base)_70%,transparent))]" />
    </div>
  )
}
