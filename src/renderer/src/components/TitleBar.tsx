import { motion } from 'framer-motion'
import { Clapperboard, Copy, Home, Minus, RefreshCw, Search, Settings, Square, Tv, Library, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { spring } from '../lib/motion'
import { api, refreshLibrary, setTab, useApp, type Tab } from '../store'
import { Spinner } from './ui'

export const TABS: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'live', label: 'Live TV', icon: Tv },
  { id: 'movies', label: 'Movies', icon: Clapperboard },
  { id: 'series', label: 'Series', icon: Library },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'settings', label: 'Settings', icon: Settings }
]

function TabBar() {
  const tab = useApp((s) => s.tab)
  return (
    <nav className="glass no-drag flex items-center gap-0.5 rounded-full p-1.5">
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = tab === id
        return (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-current={active ? 'page' : undefined}
            className={`relative flex h-9 items-center gap-2 rounded-full px-4 text-[13.5px] font-semibold tracking-[-0.01em] transition-colors duration-200 ${active ? 'text-fg' : 'text-fg/60 hover:text-fg'}`}
          >
            {active && (
              <motion.span
                layoutId="tab-pill"
                transition={spring}
                className="absolute inset-0 rounded-full bg-fg/16 shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_6px_18px_-6px_rgb(0_0_0/0.5)]"
              />
            )}
            <Icon className="relative size-4" strokeWidth={2.2} />
            <span className="relative">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function WindowButtons() {
  const [max, setMax] = useState(false)
  useEffect(() => api.onWindowState((s) => setMax(s.maximized)), [])
  const btn = 'glass-thin grid size-8 place-items-center rounded-full text-fg/70 transition hover:text-fg'
  return (
    <div className="no-drag flex items-center gap-2">
      <button tabIndex={-1} aria-label="Minimize" className={`${btn} hover:bg-fg/12`} onClick={api.win.minimize}>
        <Minus className="size-3.5" strokeWidth={2.5} />
      </button>
      <button tabIndex={-1} aria-label={max ? 'Restore' : 'Maximize'} className={`${btn} hover:bg-fg/12`} onClick={api.win.toggleMaximize}>
        {max ? <Copy className="size-3 -scale-x-100" strokeWidth={2.5} /> : <Square className="size-3" strokeWidth={2.5} />}
      </button>
      <button tabIndex={-1} aria-label="Close" className={`${btn} hover:bg-red-500/80 hover:text-white`} onClick={api.win.close}>
        <X className="size-3.5" strokeWidth={2.5} />
      </button>
    </div>
  )
}

export function TitleBar() {
  const loading = useApp((s) => s.loading)
  const progress = useApp((s) => s.progress)
  const hasSources = useApp((s) => s.sources.length > 0)
  return (
    <header className="drag absolute inset-x-0 top-0 z-30 flex h-[76px] items-center justify-between px-6">
      {/* iOS-style scroll edge: content scrolling underneath softly blurs and dims away */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[96px] bg-gradient-to-b from-[color-mix(in_srgb,var(--base)_82%,transparent)] to-transparent backdrop-blur-[14px] [mask-image:linear-gradient(to_bottom,black_25%,transparent)]" />
      <div className="flex w-64 items-center gap-2.5">
        <div className="grid size-8 place-items-center rounded-[10px] bg-[conic-gradient(from_200deg,var(--accent),#bf5af2,#ff375f,var(--accent))] shadow-[0_6px_20px_-6px_var(--accent)]">
          <div className="size-3 rounded-full bg-white/95 shadow-[0_0_12px_white]" />
        </div>
        <span className="text-[17px] font-bold tracking-[-0.03em]">Lumen</span>
      </div>
      <TabBar />
      <div className="flex w-64 items-center justify-end gap-3">
        {loading || progress ? (
          <div className="glass-thin no-drag flex h-8 max-w-44 items-center gap-2 rounded-full px-3 text-[12px] font-medium text-fg/75" title={progress}>
            <Spinner className="size-3.5 shrink-0" />
            <span className="truncate">{progress || 'Loading…'}</span>
          </div>
        ) : (
          hasSources && (
            <button tabIndex={-1} onClick={refreshLibrary} aria-label="Refresh library" title="Refresh library" className="no-drag grid size-8 place-items-center rounded-full text-fg/50 transition hover:bg-fg/10 hover:text-fg">
              <RefreshCw className="size-3.5" />
            </button>
          )
        )}
        <WindowButtons />
      </div>
    </header>
  )
}
