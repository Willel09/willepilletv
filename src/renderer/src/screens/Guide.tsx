import { useVirtualizer } from '@tanstack/react-virtual'
import { useLayoutEffect, useRef } from 'react'
import type { Channel } from '../../../shared/types'
import { Img } from '../components/Img'
import { useNow } from '../lib/epg'
import { cleanName, clock } from '../lib/format'
import { playChannel, useApp } from '../store'

const PX_PER_MIN = 5
const ROW_H = 68
const LEFT = 230
const HEAD = 46
const SLOT = 30 * 60_000
const HOURS = 14

/** Full TV guide grid: virtualised rows, sticky channel column and time header, live "now" line */
export function Guide({ channels }: { channels: Channel[] }) {
  const epg = useApp((s) => s.epg)
  const now = useNow(60_000)
  const ref = useRef<HTMLDivElement>(null)
  // Anchor the window when the guide opens; it only re-anchors when remounted
  const start = useRef(Math.floor(Date.now() / SLOT) * SLOT - SLOT).current
  const end = start + HOURS * 3600_000
  const width = ((end - start) / 60_000) * PX_PER_MIN
  const x = (t: number) => ((Math.max(start, Math.min(end, t)) - start) / 60_000) * PX_PER_MIN
  const v = useVirtualizer({ count: channels.length, getScrollElement: () => ref.current, estimateSize: () => ROW_H, overscan: 8 })

  useLayoutEffect(() => {
    ref.current?.scrollTo({ left: Math.max(0, x(Date.now()) - 120), top: 0 })
  }, [channels]) // eslint-disable-line react-hooks/exhaustive-deps

  const slots = Array.from({ length: (HOURS * 3600_000) / SLOT }, (_, i) => start + i * SLOT)

  return (
    <div ref={ref} className="glass relative min-h-0 min-w-0 flex-1 overflow-auto rounded-[28px]">
      <div className="relative" style={{ width: LEFT + width, height: HEAD + v.getTotalSize() }}>
        {/* time header */}
        <div className="sticky top-0 z-20 flex border-b border-fg/8 bg-[color-mix(in_srgb,var(--base)_80%,transparent)] backdrop-blur-xl" style={{ height: HEAD }}>
          <div className="sticky left-0 z-10 flex shrink-0 items-center bg-[color-mix(in_srgb,var(--base)_92%,transparent)] px-5 text-[12px] font-bold uppercase tracking-[0.12em] text-fg/50 backdrop-blur-xl" style={{ width: LEFT }}>
            {new Date(now).toLocaleDateString([], { weekday: 'long' })}
          </div>
          {slots.map((t) => (
            <div key={t} className="flex shrink-0 items-center border-l border-fg/8 px-3 text-[12.5px] font-semibold tabular-nums text-fg/60" style={{ width: (SLOT / 60_000) * PX_PER_MIN }}>
              {clock(t)}
            </div>
          ))}
        </div>

        {/* now line */}
        <div className="pointer-events-none absolute bottom-0 z-10 w-0.5 bg-accent shadow-[0_0_12px_var(--accent)]" style={{ left: LEFT + x(now), top: HEAD - 6 }}>
          <div className="absolute -left-[5px] -top-1 size-3 rounded-full bg-accent" />
        </div>

        {v.getVirtualItems().map((row) => {
          const c = channels[row.index]
          const progs = (epg?.programmes[c.id] ?? []).filter((p) => p.stop > start && p.start < end)
          return (
            <div key={c.id} className="absolute inset-x-0 flex border-b border-fg/6" style={{ top: HEAD + row.start, height: ROW_H }}>
              <button
                onClick={() => playChannel(c, channels)}
                className="card sticky left-0 z-10 flex shrink-0 items-center gap-3 bg-[color-mix(in_srgb,var(--base)_90%,transparent)] px-4 text-left backdrop-blur-xl hover:bg-[color-mix(in_srgb,var(--base)_75%,var(--fg))]"
                style={{ width: LEFT }}
              >
                <div className="h-9 w-14 shrink-0 overflow-hidden rounded-[10px] bg-fg/6">
                  <Img src={c.logo} name={c.name} contain className="size-full p-1 [&_span]:text-[9px]" />
                </div>
                <span className="truncate text-[13px] font-semibold">{cleanName(c.name)}</span>
              </button>
              <div className="relative flex-1">
                {progs.length ? (
                  progs.map((p) => {
                    const live = p.start <= now && p.stop > now
                    const past = p.stop <= now
                    return (
                      <button
                        key={p.start}
                        onClick={() => playChannel(c, channels)}
                        title={`${clock(p.start)}–${clock(p.stop)}  ${p.title}${p.desc ? `\n\n${p.desc}` : ''}`}
                        className={`card absolute inset-y-1.5 overflow-hidden rounded-[14px] px-3 py-2 text-left transition-colors ${live ? 'bg-accent/25 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)] hover:bg-accent/35' : past ? 'bg-fg/4 text-fg/40 hover:bg-fg/8' : 'glass-thin hover:bg-fg/12'}`}
                        style={{ left: x(p.start) + 2, width: Math.max(4, x(p.stop) - x(p.start) - 4) }}
                      >
                        <div className="truncate text-[13px] font-semibold">{p.title}</div>
                        <div className="truncate text-[11.5px] tabular-nums text-fg/50">
                          {clock(p.start)} – {clock(p.stop)}
                        </div>
                      </button>
                    )
                  })
                ) : (
                  <div className="absolute inset-y-1.5 left-0.5 flex items-center rounded-[14px] bg-fg/3 px-4 text-[12.5px] text-fg/30" style={{ width: width - 4 }}>
                    No guide information
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
