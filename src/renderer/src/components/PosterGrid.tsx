import { useVirtualizer } from '@tanstack/react-virtual'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

const GAP = 22
const MIN_W = 168

/** Virtualised responsive poster grid: renders only visible rows, so 50k movies scroll smoothly */
export function PosterGrid<T>({ items, render, aspect = 1.5, extra = 44, resetKey }: { items: T[]; render: (item: T, width: number) => ReactNode; aspect?: number; extra?: number; resetKey?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current!
    const ro = new ResizeObserver(() => setW(el.clientWidth - 56))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useLayoutEffect(() => {
    ref.current?.scrollTo({ top: 0 })
  }, [resetKey])
  const cols = Math.max(1, Math.floor((w + GAP) / (MIN_W + GAP)))
  const cw = w > 0 ? (w - GAP * (cols - 1)) / cols : MIN_W
  const rows = Math.ceil(items.length / cols)
  const v = useVirtualizer({ count: rows, getScrollElement: () => ref.current, estimateSize: () => cw * aspect + extra + GAP, overscan: 3 })
  useLayoutEffect(() => {
    v.measure()
  }, [cw, v])
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto px-7 pb-10 pt-4">
      <div className="relative" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((row) => (
          <div key={row.key} className="absolute inset-x-0 grid" style={{ transform: `translateY(${row.start}px)`, gap: GAP, gridTemplateColumns: `repeat(${cols}, ${cw}px)` }}>
            {items.slice(row.index * cols, row.index * cols + cols).map((it) => render(it, cw))}
          </div>
        ))}
      </div>
    </div>
  )
}
