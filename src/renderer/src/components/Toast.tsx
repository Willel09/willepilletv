import { AnimatePresence, motion } from 'framer-motion'
import { sheetSpring } from '../lib/motion'
import { useApp } from '../store'

export function Toast() {
  const toast = useApp((s) => s.toast)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-8 z-[70] flex justify-center px-6">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            role="status"
            initial={{ opacity: 0, y: 30, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={sheetSpring}
            className="glass-strong max-w-xl rounded-full px-6 py-3 text-center text-[13.5px] font-medium"
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
