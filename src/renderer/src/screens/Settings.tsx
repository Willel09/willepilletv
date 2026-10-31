import { FileText, FolderOpen, Globe, Keyboard, Link2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { DEFAULT_UA, type Source } from '../../../shared/types'
import { Sheet } from '../components/Sheet'
import { Button, Field, IconButton, Segmented, Toggle } from '../components/ui'
import { ago } from '../lib/format'
import { api, openSourceSheet, persist, refreshEpg, refreshLibrary, toast, updateSettings, useApp } from '../store'

const ACCENTS = ['#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#ff9f0a', '#30d158', '#64d2ff']

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="glass rounded-[28px] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[17px] font-bold tracking-[-0.02em]">{title}</h2>
        {action}
      </div>
      <div className="divide-y divide-fg/8">{children}</div>
    </section>
  )
}

function Line({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-[14px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12.5px] text-fg/45">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** Text field that commits on blur/Enter so we don't write to disk on every keystroke */
function LazyField({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void; placeholder?: string; label?: string; hint?: ReactNode }) {
  const [v, setV] = useState(value)
  return (
    <Field
      {...rest}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

export function SourceSheet({ sheet }: { sheet: NonNullable<ReturnType<typeof useApp.getState>['sourceSheet']> }) {
  const sources = useApp((s) => s.sources)
  const editing = sheet.source
  const [kind, setKind] = useState<'xtream' | 'url' | 'file'>(sheet.kind === 'xtream' ? 'xtream' : sheet.file || (editing?.url && !/^https?:/i.test(editing.url)) ? 'file' : 'url')
  const [f, setF] = useState<Source>(editing ?? { id: crypto.randomUUID().slice(0, 8), name: '', kind: sheet.kind })
  const [error, setError] = useState('')
  const set = (patch: Partial<Source>) => setF((x) => ({ ...x, ...patch }))
  const close = () => useApp.setState({ sourceSheet: null })

  const save = () => {
    const src: Source = { ...f, kind: kind === 'xtream' ? 'xtream' : 'm3u' }
    if (src.kind === 'xtream') {
      if (!src.server || !src.username || !src.password) return setError('Server URL, username and password are required.')
      src.url = undefined
    } else {
      if (!src.url) return setError(kind === 'file' ? 'Choose a playlist file.' : 'Enter the playlist URL.')
      if (kind === 'url' && !/^https?:\/\//i.test(src.url)) return setError('The playlist URL should start with http:// or https://')
    }
    src.name ||= src.kind === 'xtream' ? (() => { try { return new URL(/^https?:/.test(src.server!) ? src.server! : `http://${src.server}`).hostname } catch { return 'Xtream' } })() : kind === 'file' ? src.url!.split(/[\\/]/).pop()! : 'Playlist'
    persist('sources', editing ? sources.map((s) => (s.id === src.id ? src : s)) : [...sources, src])
    close()
    refreshLibrary()
  }

  return (
    <Sheet title={editing ? 'Edit Source' : 'Add Source'} onClose={close}>
      <div className="mb-5">
        <Segmented
          layoutId="src-kind"
          value={kind}
          onChange={(k) => (setKind(k), setError(''))}
          options={[
            { value: 'xtream', label: <><Link2 className="size-4" /> Xtream Codes</> },
            { value: 'url', label: <><Globe className="size-4" /> M3U URL</> },
            { value: 'file', label: <><FileText className="size-4" /> M3U File</> }
          ]}
        />
      </div>
      <div className="space-y-4">
        <Field label="Name" placeholder="My provider" value={f.name} onChange={(e) => set({ name: e.target.value })} />
        {kind === 'xtream' && (
          <>
            <Field label="Server URL" placeholder="http://provider.example:8080" value={f.server ?? ''} onChange={(e) => set({ server: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Username" value={f.username ?? ''} onChange={(e) => set({ username: e.target.value })} />
              <Field label="Password" type="password" value={f.password ?? ''} onChange={(e) => set({ password: e.target.value })} />
            </div>
          </>
        )}
        {kind === 'url' && <Field label="Playlist URL" placeholder="https://…/playlist.m3u" value={f.url ?? ''} onChange={(e) => set({ url: e.target.value })} />}
        {kind === 'file' && (
          <div className="flex items-end gap-3">
            <div className="flex-1"><Field label="Playlist file" readOnly value={f.url ?? ''} placeholder="No file chosen" /></div>
            <Button icon={<FolderOpen className="size-4" />} onClick={async () => { const p = await api.pickPlaylistFile(); if (p) set({ url: p }) }}>
              Browse
            </Button>
          </div>
        )}
        <Field
          label="TV guide (XMLTV) URL — optional"
          placeholder={kind === 'xtream' ? 'Leave empty to use the provider guide' : 'https://…/guide.xml.gz'}
          value={f.epgUrl ?? ''}
          onChange={(e) => set({ epgUrl: e.target.value })}
        />
        {error && <p className="rounded-2xl bg-red-500/12 px-4 py-3 text-[13px] text-red-300">{error}</p>}
        <p className="text-[12px] leading-relaxed text-fg/40">Your login is stored only on this PC. Lumen talks directly to your provider.</p>
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={save}>{editing ? 'Save & Reload' : 'Add & Load'}</Button>
      </div>
    </Sheet>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Arrow keys', 'Move focus'], ['Enter', 'Select / play'], ['Esc / Backspace', 'Back'], ['Ctrl + 1…6', 'Switch tabs'], ['/ or Ctrl + F', 'Search'],
  ['Space / K', 'Play / pause'], ['← / →', 'Seek 10 s (VOD)'], ['↑ / ↓ · PgUp / PgDn', 'Channel up / down'], ['0–9', 'Jump to channel number'],
  ['F', 'Fullscreen'], ['M', 'Mute'], ['P', 'Picture in Picture'], ['C', 'Subtitles on / off'], ['Ctrl + V', 'Play a copied stream URL']
]

export default function Settings() {
  const s = useApp((x) => x.settings)
  const sources = useApp((x) => x.sources)
  const library = useApp((x) => x.library)
  const epg = useApp((x) => x.epg)
  const loading = useApp((x) => x.loading)
  const matched = epg ? Object.keys(epg.programmes).length : 0

  const remove = (src: Source) => {
    if (!confirm(`Remove “${src.name}”? Its channels will disappear from Lumen.`)) return
    persist('sources', sources.filter((x) => x.id !== src.id))
    refreshLibrary()
  }

  return (
    <div className="h-full overflow-y-auto px-8 pb-20 pt-[100px]">
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="px-2 text-[34px] font-bold tracking-[-0.035em]">Settings</h1>

        <Card
          title="Sources"
          action={
            <div className="flex gap-2">
              <Button icon={<RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />} onClick={refreshLibrary} disabled={loading || !sources.length}>Refresh</Button>
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openSourceSheet('xtream')}>Add</Button>
            </div>
          }
        >
          {!sources.length && <p className="py-3 text-[14px] text-fg/50">No sources yet. Add an Xtream Codes login or an M3U playlist.</p>}
          {sources.map((src) => {
            const acc = library?.accounts[src.id]
            const err = library?.errors.find((e) => e.startsWith(`${src.name}:`))
            return (
              <div key={src.id} className="flex items-center gap-4 py-3.5">
                <div className="glass-thin grid size-11 shrink-0 place-items-center rounded-2xl text-fg/75">{src.kind === 'xtream' ? <Link2 className="size-5" /> : <FileText className="size-5" />}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-semibold">{src.name}</div>
                  <div className="truncate text-[12.5px] text-fg/45">
                    {src.kind === 'xtream' ? `Xtream Codes · ${src.username}` : `M3U · ${src.url}`}
                    {acc?.expires && ` · Expires ${new Date(acc.expires).toLocaleDateString()}`}
                    {acc?.maxConnections && ` · ${acc.maxConnections} connection${acc.maxConnections > 1 ? 's' : ''}`}
                  </div>
                  {err && <div className="mt-1 text-[12.5px] text-red-300">{err.slice(src.name.length + 2)}</div>}
                </div>
                <IconButton label="Edit" onClick={() => openSourceSheet(src.kind, src)}><Pencil className="size-4" /></IconButton>
                <IconButton label="Remove" onClick={() => remove(src)} className="hover:text-red-400"><Trash2 className="size-4" /></IconButton>
              </div>
            )
          })}
          {library && sources.length > 0 && (
            <p className="pt-3.5 text-[12.5px] text-fg/40">
              {library.channels.length.toLocaleString()} channels · {library.movies.length.toLocaleString()} movies · {library.series.length.toLocaleString()} series · updated {ago(library.updatedAt)}
            </p>
          )}
        </Card>

        <Card title="TV Guide" action={<Button icon={<RefreshCw className="size-4" />} onClick={() => (toast('Refreshing TV guide…'), refreshEpg())}>Refresh Guide</Button>}>
          <div className="py-3.5">
            <LazyField label="Extra XMLTV guide URL" placeholder="https://…/guide.xml.gz" value={s.epgUrl} onCommit={(epgUrl) => updateSettings({ epgUrl })} hint="Used in addition to guides from your sources. Gzipped (.gz) guides are supported." />
          </div>
          <Line label="Use provider guides automatically" hint="From Xtream Codes accounts and the M3U url-tvg header">
            <Toggle label="Use provider guides" checked={s.autoProviderEpg} onChange={(autoProviderEpg) => updateSettings({ autoProviderEpg })} />
          </Line>
          <p className="pt-3.5 text-[12.5px] text-fg/40">{epg ? `${matched.toLocaleString()} channels have guide data · updated ${ago(epg.updatedAt)}` : 'No guide loaded yet.'}</p>
        </Card>

        <Card title="Playback">
          <Line label="Live stream format" hint="Xtream Codes only. Switch to HLS if live channels stutter or fail.">
            <Segmented layoutId="fmt" value={s.liveFormat} onChange={(liveFormat) => updateSettings({ liveFormat })} options={[{ value: 'ts', label: 'MPEG-TS' }, { value: 'm3u8', label: 'HLS' }]} />
          </Line>
          <Line label="Autoplay next episode">
            <Toggle label="Autoplay next episode" checked={s.autoplayNext} onChange={(autoplayNext) => updateSettings({ autoplayNext })} />
          </Line>
          <div className="space-y-4 py-3.5">
            <LazyField label="VLC path" placeholder="C:\Program Files\VideoLAN\VLC\vlc.exe (auto-detected)" value={s.vlcPath} onCommit={(vlcPath) => updateSettings({ vlcPath })} />
            <LazyField label="User agent" value={s.userAgent} onCommit={(userAgent) => updateSettings({ userAgent: userAgent || DEFAULT_UA })} hint="Some providers only allow specific players. Leave empty to reset." />
          </div>
        </Card>

        <Card title="Appearance">
          <Line label="Theme">
            <Segmented layoutId="theme" value={s.theme} onChange={(theme) => updateSettings({ theme })} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
          </Line>
          <Line label="Window material" hint="Windows 11 only. Lets your desktop tint through the glass.">
            <Segmented layoutId="mat" value={s.material} onChange={(material) => updateSettings({ material })} options={[{ value: 'mica', label: 'Mica' }, { value: 'acrylic', label: 'Acrylic' }, { value: 'none', label: 'Solid' }]} />
          </Line>
          <Line label="Accent color">
            <div className="flex gap-2">
              {ACCENTS.map((c) => (
                <button key={c} aria-label={`Accent ${c}`} onClick={() => updateSettings({ accent: c })} className={`size-7 rounded-full transition ${s.accent === c ? 'ring-2 ring-fg ring-offset-2 ring-offset-transparent' : 'hover:scale-110'}`} style={{ background: c }} />
              ))}
            </div>
          </Line>
        </Card>

        <Card title="Library">
          <Line label="Refresh sources every">
            <Segmented layoutId="refresh" value={String(s.refreshHours)} onChange={(v) => updateSettings({ refreshHours: +v })} options={[{ value: '6', label: '6 h' }, { value: '12', label: '12 h' }, { value: '24', label: '1 day' }, { value: '168', label: '1 week' }]} />
          </Line>
          <div className="py-3.5">
            <LazyField label="Hide categories containing" placeholder="adult, xxx, 24/7" value={s.hiddenGroups} onCommit={(hiddenGroups) => updateSettings({ hiddenGroups })} hint="Comma-separated words. Matching categories are hidden everywhere." />
          </div>
          <Line label="Watch history" hint="Continue Watching and resume positions">
            <Button variant="danger" onClick={() => confirm('Clear watch history?') && persist('history', [])}>Clear</Button>
          </Line>
          <Line label="Favorites">
            <Button variant="danger" onClick={() => confirm('Remove all favorites?') && persist('favorites', [])}>Clear</Button>
          </Line>
        </Card>

        <Card title="Keyboard" action={<Keyboard className="size-5 text-fg/40" />}>
          <div className="grid grid-cols-2 gap-x-8 py-2">
            {SHORTCUTS.map(([k, d]) => (
              <div key={k} className="flex items-center justify-between gap-4 py-2 text-[13px]">
                <span className="text-fg/60">{d}</span>
                <kbd className="glass-thin rounded-lg px-2 py-0.5 font-sans text-[12px] font-semibold text-fg/80">{k}</kbd>
              </div>
            ))}
          </div>
        </Card>

        <p className="pb-4 text-center text-[12px] text-fg/35">Lumen 1.0 · A player only — bring your own content.</p>
      </div>
    </div>
  )
}
