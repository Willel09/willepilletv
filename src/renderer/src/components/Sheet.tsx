import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { sheetSpring } from '../lib/motion'
import { IconButton } from './ui'

/** Modal glass sheet that springs up from the bottom. Traps arrow-key focus via data-nav-scope. */
export function Sheet({ title, onClose, children, width = 560 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <motion.div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/45 p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        data-nav-scope
        role="dialog"
        aria-label={title}
        initial={{ y: 80, opacity: 0, scale: 0.96 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 60, opacity: 0, scale: 0.97 }}
        transition={sheetSpring}
        style={{ width }}
        className="glass-strong max-h-[calc(var(--vh,1vh)*88)] max-w-full overflow-y-auto rounded-[32px] p-7"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[22px] font-bold tracking-[-0.03em]">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="size-4.5" />
          </IconButton>
        </div>
        {children}
      </motion.div>
    </motion.div>
  )
}
