import { HardDrive, Pause, Play, RotateCw, Trash2, WifiOff } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { DownloadRec } from '../../../shared/types'
import { Img } from '../components/Img'
import { Button, IconButton, Segmented, Toggle } from '../components/ui'
import { bytes, cleanName } from '../lib/format'
import { api, localPosterOf, playDownload, updateSettings, useApp } from '../store'

const LIMITS = [5, 10, 20, 50, 0]
const num = (s: string) => (a: DownloadRec, b: DownloadRec) => (a.subtitle ?? s).localeCompare(b.subtitle ?? s, undefined, { numeric: true })

function status(d: DownloadRec) {
  const pct = d.size ? Math.min(100, Math.round((d.received / d.size) * 100)) : 0
  switch (d.state) {
    case 'done': return { text: bytes(d.size || d.received), pct: 100, tone: 'text-fg/50' }
    case 'downloading': return { text: `${bytes(d.received)}${d.size ? ` of ${bytes(d.size)} · ${pct}%` : ''}`, pct, tone: 'text-fg/60' }
    case 'queued': return { text: 'Waiting for its turn…', pct, tone: 'text-fg/50' }
    case 'paused': return { text: `Paused · ${bytes(d.received)}${d.size ? ` of ${bytes(d.size)}` : ''}`, pct, tone: 'text-fg/50' }
    case 'error': return { text: d.error ?? 'Failed', pct, tone: 'text-red-400' }
  }
}

function Item({ d, sub }: { d: DownloadRec; sub?: boolean }) {
  const st = status(d)
  const remove = () => (d.state !== 'done' || confirm(`Delete “${cleanName(d.title)}${d.subtitle ? ` ${d.subtitle}` : ''}” from this PC?`)) && void api.downloads!.remove(d.id)
  return (
    <div className={`flex items-center gap-4 rounded-2xl p-3 ${sub ? 'pl-4' : 'glass-thin'}`}>
      {!sub && <Img src={localPosterOf(d)} name={d.title} className="aspect-[2/3] w-14 shrink-0 rounded-xl" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-semibold tracking-[-0.01em]">{sub ? d.subtitle || d.title : cleanName(d.title)}</div>
        {!sub && d.subtitle && <div className="truncate text-[12.5px] text-fg/50">{d.subtitle}</div>}
        <div className={`mt-0.5 truncate text-[12.5px] ${st.tone}`}>{st.text}</div>
        {d.state !== 'done' && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-fg/12">
            <div className={`h-full rounded-full ${d.state === 'error' ? 'bg-red-400' : 'bg-fg'} transition-[width] duration-500`} style={{ width: `${st.pct}%` }} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {d.state === 'done' && <Button variant="primary" icon={<Play className="size-4 fill-current" />} onClick={() => playDownload(d)}>Play</Button>}
        {(d.state === 'downloading' || d.state === 'queued') && <IconButton label="Pause" onClick={() => void api.downloads!.pause(d.id)}><Pause className="size-4.5" /></IconButton>}
        {(d.state === 'paused' || d.state === 'error') && <IconButton label={d.state === 'error' ? 'Try again' : 'Resume'} onClick={() => void api.downloads!.resume(d.id)}>{d.state === 'error' ? <RotateCw className="size-4.5" /> : <Play className="size-4.5" />}</IconButton>}
        <IconButton label="Delete" onClick={remove}><Trash2 className="size-4.5" /></IconButton>
      </div>
    </div>
  )
}

export default function Downloads() {
  const dl = useApp((s) => s.downloads)
  const limitGb = useApp((s) => s.settings.downloadLimitGb)
  const deleteWatched = useApp((s) => s.settings.deleteWatched)
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(navigator.onLine)
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    return () => (window.removeEventListener('online', on), window.removeEventListener('offline', on))
  }, [])

  // movies, and each series' episodes under one heading; what is still coming in on top
  const { movies, shows } = useMemo(() => {
    const items = dl?.items ?? []
    const movies = items.filter((d) => d.kind === 'movie' || !d.parentId).sort((a, b) => b.addedAt - a.addedAt)
    const by = new Map<string, DownloadRec[]>()
    for (const d of items) if (d.kind === 'episode' && d.parentId) by.set(d.parentId, [...(by.get(d.parentId) ?? []), d])
    const shows = [...by.values()].map((eps) => eps.sort(num('')))
    return { movies, shows }
  }, [dl])
  const busy = (dl?.items ?? []).filter((d) => d.state === 'downloading' || d.state === 'queued').length

  if (!dl) return <div className="grid h-full place-items-center text-fg/50">Loading…</div>
  const cap = dl.limit || dl.used + (dl.free ?? 0)
  const pct = cap ? Math.min(100, (dl.used / cap) * 100) : 0

  return (
    <div className="h-full overflow-y-auto pt-[100px]">
      <div className="mx-auto max-w-4xl px-8 pb-20">
        <h1 className="text-[34px] font-[800] leading-none tracking-[-0.04em]">Downloads</h1>
        <p className="mt-2 text-[14px] text-fg/55">Films and episodes saved on this PC. They play inside Lumen, also without internet.</p>

        {!online && (
          <div className="glass-thin mt-5 flex items-center gap-3 rounded-2xl px-4 py-3 text-[13.5px] text-fg/75">
            <WifiOff className="size-4.5 shrink-0" /> You're offline. Downloaded titles still play.
          </div>
        )}

        <div className="glass mt-6 rounded-[24px] p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 text-[14px] font-semibold"><HardDrive className="size-4.5 text-fg/50" /> {bytes(dl.used)} used{dl.limit ? ` of ${bytes(dl.limit)}` : ''}</div>
            <div className="text-[12.5px] text-fg/45">{dl.free !== null ? `${bytes(dl.free)} free on this PC` : ''}</div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-fg/12">
            <div className={`h-full rounded-full ${pct > 90 ? 'bg-red-400' : 'bg-fg'} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-fg/60">Limit</span>
              <Segmented layoutId="dl-limit" value={String(limitGb)} onChange={(v) => updateSettings({ downloadLimitGb: +v })} options={LIMITS.map((g) => ({ value: String(g), label: g ? `${g} GB` : 'None' }))} />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-fg/60">Delete when watched</span>
              <Toggle label="Delete downloads when watched" checked={deleteWatched} onChange={(deleteWatched) => updateSettings({ deleteWatched })} />
            </div>
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-fg/40">
            Files are saved as they are on your provider. To use less room, pick the smallest version when you download (the list shows each one's size). Lumen doesn't re-encode them.
            {busy > 1 ? ' One download runs at a time.' : ''}
          </p>
        </div>

        {!dl.items.length && (
          <div className="mt-16 text-center text-fg/45">
            <HardDrive className="mx-auto mb-4 size-12" strokeWidth={1.3} />
            <p className="text-[15px]">Nothing downloaded yet.</p>
            <p className="mt-1 text-[13px]">Open a film or an episode and press Download.</p>
          </div>
        )}

        {movies.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-[19px] font-semibold tracking-[-0.02em]">Movies</h2>
            <div className="space-y-3">{movies.map((d) => <Item key={d.id} d={d} />)}</div>
          </section>
        )}
        {shows.map((eps) => (
          <section key={eps[0].parentId} className="mt-8">
            <div className="mb-3 flex items-center gap-3">
              <Img src={localPosterOf(eps[0])} name={eps[0].title} className="aspect-[2/3] w-9 rounded-lg" />
              <h2 className="text-[19px] font-semibold tracking-[-0.02em]">{cleanName(eps[0].title)}</h2>
              <span className="text-[13px] text-fg/40">{eps.length} {eps.length === 1 ? 'episode' : 'episodes'}</span>
            </div>
            <div className="glass-thin space-y-1 rounded-2xl p-2">{eps.map((d) => <Item key={d.id} d={d} sub />)}</div>
          </section>
        ))}
      </div>
    </div>
  )
}
