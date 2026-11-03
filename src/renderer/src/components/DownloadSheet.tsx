import { motion } from 'framer-motion'
import { Download, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { bytes } from '../lib/format'
import { sheetSpring } from '../lib/motion'
import { api, useApp } from '../store'
import { Button } from './ui'

export interface Choice {
  label: string
  url: string
}

/** Which copy of a film to download, with the size of each: the smallest one saves the most room */
export function DownloadSheet({ title, choices, selected, onPick, onClose }: { title: string; choices: Choice[]; selected: number; onPick: (i: number) => void; onClose: () => void }) {
  const [sizes, setSizes] = useState<(number | null)[] | null>(null)
  const [i, setI] = useState(selected)
  const dl = useApp((s) => s.downloads)

  useEffect(() => {
    let live = true
    api.downloads!.sizes(choices.map((c) => c.url)).then((s) => live && setSizes(s), () => live && setSizes(choices.map(() => null)))
    return () => void (live = false)
  }, [choices])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose())
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const known = (sizes ?? []).filter((x): x is number => !!x && x > 0)
  const smallest = known.length > 1 ? Math.min(...known) : null
  const room = dl ? (dl.limit ? Math.max(0, dl.limit - dl.used) : dl.free) : null

  return (
    <motion.div data-nav-scope className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="glass-strong w-full max-w-lg rounded-[28px] p-7" initial={{ y: 30, scale: 0.97 }} animate={{ y: 0, scale: 1 }} transition={sheetSpring} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[22px] font-bold tracking-[-0.025em]">Download</h2>
        <p className="mt-1 truncate text-[14px] text-fg/55">{title}</p>
        <div role="radiogroup" aria-label="Version" className="mt-5 space-y-2">
          {choices.map((c, n) => (
            <button
              key={c.url}
              role="radio"
              aria-checked={n === i}
              autoFocus={n === selected}
              onClick={() => setI(n)}
              className={`flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition-colors ${n === i ? 'bg-fg text-bg' : 'glass-thin hover:bg-fg/10'}`}
            >
              <span className="min-w-0 truncate text-[14px] font-semibold">{c.label}</span>
              <span className="flex shrink-0 items-center gap-2 text-[13px] font-medium opacity-80">
                {smallest !== null && sizes?.[n] === smallest && <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${n === i ? 'bg-bg/15' : 'bg-fg/12'}`}>Smallest</span>}
                {sizes === null ? <Loader2 className="size-3.5 animate-spin" /> : sizes[n] ? bytes(sizes[n]!) : 'size unknown'}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-4 text-[12.5px] leading-relaxed text-fg/45">
          {room !== null && room !== undefined ? `Room left for downloads: ${bytes(room)}. ` : ''}
          Most providers allow one stream at a time, so watching something else while this downloads may be refused.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<Download className="size-4.5" />} onClick={() => (onPick(i), onClose())}>
            Download
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
