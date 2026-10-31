import { useVirtualizer } from '@tanstack/react-virtual'
import { motion } from 'framer-motion'
import { Search } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { fold } from '../lib/format'
import { spring } from '../lib/motion'

export interface Category {
  key: string
  label: string
  count: number
  icon?: ReactNode
}

/** Virtualised glass category list; providers can ship 1,000+ categories */
export function CategorySidebar({ items, value, onChange, layoutId }: { items: Category[]; value: string; onChange: (k: string) => void; layoutId: string }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => (q ? items.filter((c) => fold(c.label).includes(fold(q))) : items), [items, q])
  const ref = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: list.length, getScrollElement: () => ref.current, estimateSize: () => 44, overscan: 12 })
  return (
    <aside className="glass flex w-[264px] shrink-0 flex-col overflow-hidden rounded-[28px]">
      <div className="p-3 pb-2">
        <label className="flex h-10 items-center gap-2 rounded-2xl bg-fg/7 px-3 text-fg/45 focus-within:shadow-[inset_0_0_0_2px_var(--accent)]">
          <Search className="size-4 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter categories" className="w-full bg-transparent text-[13px] text-fg outline-none placeholder:text-fg/35" />
        </label>
      </div>
      <div ref={ref} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="relative" style={{ height: v.getTotalSize() }}>
          {v.getVirtualItems().map((row) => {
            const c = list[row.index]
            const active = c.key === value
            return (
              <button
                key={c.key}
                onClick={() => onChange(c.key)}
                className={`absolute inset-x-0 flex h-[42px] items-center gap-2.5 rounded-[14px] px-3 text-left text-[13.5px] font-medium transition-colors ${active ? 'text-fg' : 'text-fg/60 hover:bg-fg/6 hover:text-fg'}`}
                style={{ transform: `translateY(${row.start}px)` }}
              >
                {active && <motion.span layoutId={layoutId} transition={spring} className="absolute inset-0 rounded-[14px] bg-fg/14 shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]" />}
                {c.icon && <span className="relative shrink-0 text-fg/70">{c.icon}</span>}
                <span className="relative min-w-0 flex-1 truncate">{c.label}</span>
                <span className="relative text-[11.5px] tabular-nums text-fg/35">{c.count.toLocaleString()}</span>
              </button>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
