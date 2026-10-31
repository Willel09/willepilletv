import { useVirtualizer } from '@tanstack/react-virtual'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarDays, Heart, LayoutList, Play, Tv } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Channel } from '../../../shared/types'
import { CategorySidebar } from '../components/CategorySidebar'
import { Img } from '../components/Img'
import { Button, Empty, IconButton, Segmented } from '../components/ui'
import { nowNext, useNow } from '../lib/epg'
import { cleanName, clock } from '../lib/format'
import { softSpring } from '../lib/motion'
import { isFavorite, playChannel, setAmbient, setGroup, toggleFavorite, useApp, useIndex } from '../store'
import { Guide } from './Guide'

export const ALL = '__all'
export const FAV = '__fav'

export function useChannels(): { channels: Channel[]; group: string } {
  const idx = useIndex()
  const favs = useApp((s) => s.favorites)
  const group = useApp((s) => s.group.live) ?? ALL
  const channels = useMemo(() => {
    if (group === ALL) return idx.channels
    if (group === FAV) return favs.filter((f): f is Channel => f.kind === 'live')
    return idx.liveGroups.find((g) => g.name === group)?.items ?? []
  }, [idx, favs, group])
  return { channels, group }
}

function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-[3px] overflow-hidden rounded-full bg-fg/15 ${className}`}>
      <div className="h-full rounded-full bg-fg/80" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  )
}

function ChannelList({ channels, selected, onSelect }: { channels: Channel[]; selected?: Channel; onSelect: (c: Channel) => void }) {
  const epg = useApp((s) => s.epg)
  useApp((s) => s.favorites)
  const t = useNow()
  const ref = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: channels.length, getScrollElement: () => ref.current, estimateSize: () => 80, overscan: 10 })
  useLayoutEffect(() => {
    ref.current?.scrollTo({ top: 0 })
  }, [channels])
  return (
    <div ref={ref} className="glass min-h-0 min-w-0 flex-1 overflow-y-auto rounded-[28px] p-2">
      <div className="relative" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((row) => {
          const c = channels[row.index]
          const { now, next, progress } = nowNext(epg?.programmes[c.id], t)
          const active = selected?.id === c.id
          return (
            <button
              key={c.id}
              onClick={() => playChannel(c, channels)}
              onFocus={() => onSelect(c)}
              onMouseEnter={() => onSelect(c)}
              className={`card absolute inset-x-0 flex h-[76px] items-center gap-4 rounded-[20px] px-4 text-left transition-colors duration-200 ${active ? 'bg-fg/12 shadow-[inset_0_1px_0_rgb(255_255_255/0.15)]' : 'hover:bg-fg/6'}`}
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <span className="w-9 shrink-0 text-right text-[13px] font-semibold tabular-nums text-fg/35">{c.num ?? row.index + 1}</span>
              <div className="h-12 w-[76px] shrink-0 overflow-hidden rounded-[13px] bg-fg/6 shadow-[inset_0_0_0_1px_var(--glass-edge)]">
                <Img src={c.logo} name={c.name} contain className="size-full p-1.5 [&_span]:text-[10px]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14.5px] font-semibold tracking-[-0.01em]">{cleanName(c.name)}</span>
                  {isFavorite(c.id) && <Heart className="size-3.5 shrink-0 fill-rose-400 text-rose-400" />}
                </div>
                {now ? (
                  <div className="mt-1 flex items-center gap-3">
                    <span className="truncate text-[12.5px] text-fg/60">{now.title}</span>
                    <ProgressBar value={progress!} className="w-16 shrink-0" />
                  </div>
                ) : (
                  <div className="mt-1 truncate text-[12.5px] text-fg/35">{c.group}</div>
                )}
              </div>
              {next && (
                <div className="hidden w-52 shrink-0 truncate text-right text-[12px] text-fg/40 xl:block">
                  <span className="font-semibold text-fg/55">{clock(next.start)}</span> {next.title}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ChannelInfo({ channel, channels }: { channel?: Channel; channels: Channel[] }) {
  const epg = useApp((s) => s.epg)
  useApp((s) => s.favorites)
  const t = useNow()
  if (!channel) return null
  const { now, progress, upcoming } = nowNext(epg?.programmes[channel.id], t)
  const fav = isFavorite(channel.id)
  return (
    <aside className="glass hidden w-[360px] shrink-0 flex-col overflow-hidden rounded-[28px] lg:flex">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={channel.id}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={softSpring}
          className="flex min-h-0 flex-1 flex-col p-5"
        >
          <div className="glass-thin grid aspect-video place-items-center overflow-hidden rounded-[22px]">
            <Img src={channel.logo} name={channel.name} contain className="size-full p-8" />
          </div>
          <h2 className="mt-5 text-[24px] font-bold leading-tight tracking-[-0.03em]">{cleanName(channel.name)}</h2>
          <p className="mt-1 truncate text-[13px] text-fg/45">{channel.group}</p>
          {now ? (
            <div className="mt-5">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-red-400">
                <span className="size-1.5 animate-pulse rounded-full bg-red-500" /> Now
              </div>
              <div className="mt-1.5 text-[16px] font-semibold tracking-[-0.01em]">{now.title}</div>
              <div className="mt-2 flex items-center gap-3 text-[12px] tabular-nums text-fg/50">
                {clock(now.start)}
                <ProgressBar value={progress!} className="flex-1" />
                {clock(now.stop)}
              </div>
              {now.desc && <p className="mt-3 line-clamp-4 text-[13px] leading-relaxed text-fg/60">{now.desc}</p>}
            </div>
          ) : (
            <p className="mt-5 text-[13px] text-fg/40">No guide information for this channel.</p>
          )}
          {!!upcoming?.length && (
            <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-fg/40">Up Next</div>
              {upcoming.map((p) => (
                <div key={p.start} className="flex gap-3 border-t border-fg/8 py-2.5 text-[13px]">
                  <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-fg/50">{clock(p.start)}</span>
                  <span className="truncate text-fg/75">{p.title}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-auto flex gap-2 pt-4">
            <Button variant="primary" className="flex-1" icon={<Play className="size-4 fill-current" />} onClick={() => playChannel(channel, channels)}>
              Watch
            </Button>
            <IconButton label={fav ? 'Remove from Favorites' : 'Add to Favorites'} onClick={() => toggleFavorite(channel)}>
              <Heart className={`size-4.5 ${fav ? 'fill-rose-400 text-rose-400' : ''}`} />
            </IconButton>
          </div>
        </motion.div>
      </AnimatePresence>
    </aside>
  )
}

export default function Live() {
  const idx = useIndex()
  const favs = useApp((s) => s.favorites)
  const { channels, group } = useChannels()
  const [view, setView] = useState<'list' | 'guide'>('list')
  const [selected, setSelected] = useState<Channel>()
  const cats = useMemo(
    () => [
      { key: ALL, label: 'All Channels', count: idx.channels.length, icon: <Tv className="size-4" /> },
      { key: FAV, label: 'Favorites', count: favs.filter((f) => f.kind === 'live').length, icon: <Heart className="size-4" /> },
      ...idx.liveGroups.map((g) => ({ key: g.name, label: g.name, count: g.items.length }))
    ],
    [idx, favs]
  )
  const shown = selected && channels.includes(selected) ? selected : channels[0]
  const select = (c: Channel) => {
    setSelected(c)
    setAmbient(c.logo)
  }

  if (!idx.channels.length) return <Empty icon={<Tv className="size-8" />} title="No live channels" text="Add an M3U playlist or Xtream Codes account in Settings." />

  return (
    <div className="flex h-full gap-5 px-3 pb-3 pt-[136px] md:px-7 md:pb-7 md:pt-[92px]">
      <CategorySidebar items={cats} value={group} onChange={(k) => setGroup('live', k)} layoutId="live-cat" />
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex items-center justify-between px-2">
          <div>
            <h1 className="text-[30px] font-bold leading-none tracking-[-0.035em]">{cats.find((c) => c.key === group)?.label ?? group}</h1>
            <p className="mt-1.5 text-[13px] text-fg/45">{channels.length.toLocaleString()} channels</p>
          </div>
          <Segmented
            layoutId="live-view"
            value={view}
            onChange={setView}
            options={[
              { value: 'list', label: <><LayoutList className="size-4" /> Channels</> },
              { value: 'guide', label: <><CalendarDays className="size-4" /> TV Guide</> }
            ]}
          />
        </div>
        <div className="flex min-h-0 flex-1 gap-5">
          {!channels.length ? (
            <div className="glass flex-1 rounded-[28px]">
              <Empty icon={<Heart className="size-8" />} title="Nothing here yet" text="Favorite channels from the list to collect them here." />
            </div>
          ) : view === 'list' ? (
            <>
              <ChannelList channels={channels} selected={shown} onSelect={select} />
              <ChannelInfo channel={shown} channels={channels} />
            </>
          ) : (
            <Guide channels={channels} />
          )}
        </div>
      </div>
    </div>
  )
}
