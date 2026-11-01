import { AnimatePresence } from 'framer-motion'
import { Check, Cloud, CloudOff, Copy, Download, FileText, FolderOpen, Globe, Keyboard, Link2, MonitorSmartphone, Pencil, Plus, RefreshCw, Trash2, Tv } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_UA, type Source, type UpdateState } from '../../../shared/types'
import { Sheet } from '../components/Sheet'
import { Button, Field, IconButton, Segmented, Toggle } from '../components/ui'
import { ago } from '../lib/format'
import { newPairCode, newSyncCode, receivePairing, sendPairing, supported as syncSupported } from '../lib/sync'
import { THEMES } from '../lib/themes'
import { TvInstallSheet } from './TvInstall'
import { Avatar } from '../components/Avatar'
import { api, clearCollection, currentProfile, openProfilePicker, openSourceSheet, refreshEpg, refreshLibrary, saveSources, setSyncCode, setTab, syncNow, toast, updateSettings, useApp } from '../store'

const ACCENTS = ['#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#ff9f0a', '#30d158', '#64d2ff']
const desktop = api.device === 'desktop'
const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('')

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
  const [f, setF] = useState<Source>(editing ?? { id: uid(), name: '', kind: sheet.kind })
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
    saveSources(editing ? sources.map((s) => (s.id === src.id ? src : s)) : [...sources, src], [src.id])
    close()
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
            ...(desktop ? [{ value: 'file' as const, label: <><FileText className="size-4" /> M3U File</> }] : [])
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
        {kind === 'file' && <p className="text-[12px] leading-relaxed text-fg/40">With Sync on, this file is shared with your TV and phone (encrypted), so they can load it too.</p>}
        <Field
          label="TV guide (XMLTV) URL — optional"
          placeholder={kind === 'xtream' ? 'Leave empty to use the provider guide' : 'https://…/guide.xml.gz'}
          value={f.epgUrl ?? ''}
          onChange={(e) => set({ epgUrl: e.target.value })}
        />
        {error && <p className="rounded-2xl bg-red-500/12 px-4 py-3 text-[13px] text-red-300">{error}</p>}
        <p className="text-[12px] leading-relaxed text-fg/40">Your login stays on your own devices (end-to-end encrypted if you turn on Sync). Lumen talks directly to your provider.</p>
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={save}>{editing ? 'Save & Reload' : 'Add & Load'}</Button>
      </div>
    </Sheet>
  )
}


let pairIntent = false
/** Open Settings straight into "show a pairing code" (used by the Welcome screen) */
export function startPairing() {
  pairIntent = true
  setTab('settings')
}

function SyncCard() {
  const cfg = useApp((s) => s.sync)
  const status = useApp((s) => s.syncStatus)
  const [mode, setMode] = useState<'idle' | 'enter' | 'receive' | 'send'>(() => (pairIntent ? ((pairIntent = false), 'receive') : 'idle'))
  const [input, setInput] = useState('')
  const [reveal, setReveal] = useState(false)
  const [pairCode] = useState(newPairCode)

  // New device: show a pairing code and wait for another device to send the sync code to it
  useEffect(() => {
    if (mode !== 'receive') return
    let stop = false
    const deadline = Date.now() + 600_000
    const tick = async () => {
      if (stop) return
      if (Date.now() > deadline) return setMode('idle')
      try {
        const code = await receivePairing(pairCode)
        if (code) {
          setSyncCode(code)
          toast('Linked! Your watchlist, favorites and sources are syncing.')
          return setMode('idle')
        }
      } catch {
        /* keep polling */
      }
      setTimeout(tick, 3000)
    }
    tick()
    return () => void (stop = true)
  }, [mode, pairCode])

  if (!syncSupported()) return <p className="py-3 text-[13px] text-fg/50">Sync isn't supported on this device.</p>

  const send = async () => {
    try {
      await sendPairing(input, cfg.code)
      toast('Sent! The other device links in a few seconds.')
      setMode('idle')
      setInput('')
    } catch (e) {
      toast((e as Error).message)
    }
  }

  if (!cfg.code)
    return (
      <div className="py-2">
        <p className="mb-4 text-[13.5px] leading-relaxed text-fg/60">
          Keep your watchlist, favorites, resume positions, sources and theme in sync between this {api.device === 'tv' ? 'TV' : 'device'}, your PC and the web app. Data is encrypted on the device before it leaves it.
        </p>
        {mode === 'receive' ? (
          <div className="glass-thin rounded-[22px] p-6 text-center">
            <p className="text-[13px] text-fg/60">On a device that already syncs, open Settings → Sync → <b>Link a device</b> and enter:</p>
            <div className="mt-3 font-mono text-[34px] font-bold tracking-[0.12em]">{pairCode}</div>
            <p className="mt-2 text-[12px] text-fg/40">Waiting for the other device… (valid for 10 minutes)</p>
          </div>
        ) : mode === 'enter' ? (
          <div className="flex items-end gap-3">
            <div className="flex-1"><Field label="Sync code" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" value={input} onChange={(e) => setInput(e.target.value)} /></div>
            <Button variant="primary" disabled={input.replace(/[^a-z0-9]/gi, '').length < 20} onClick={() => setSyncCode(input)}>Connect</Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<MonitorSmartphone className="size-4" />} onClick={() => setMode('receive')}>Link with another device</Button>
            <Button icon={<Cloud className="size-4" />} onClick={() => setSyncCode(newSyncCode())}>Start syncing from here</Button>
            <Button variant="ghost" onClick={() => setMode('enter')}>I have a sync code</Button>
          </div>
        )}
      </div>
    )

  return (
    <>
      <Line
        label={status.state === 'error' ? 'Sync problem' : 'Sync is on'}
        hint={status.state === 'error' ? status.message : status.state === 'syncing' ? 'Syncing…' : cfg.lastSync ? `Last synced ${ago(cfg.lastSync)}` : 'Not synced yet'}
      >
        <div className="flex gap-2">
          <Button icon={<RefreshCw className={`size-4 ${status.state === 'syncing' ? 'animate-spin' : ''}`} />} onClick={() => syncNow()}>Sync now</Button>
          <Button variant="primary" icon={<MonitorSmartphone className="size-4" />} onClick={() => setMode(mode === 'send' ? 'idle' : 'send')}>Link a device</Button>
        </div>
      </Line>
      {mode === 'send' && (
        <div className="py-3.5">
          <p className="mb-3 text-[13px] text-fg/55">On the new device (e.g. your TV) choose <b>Link with another device</b>, then type the code it shows:</p>
          <div className="flex items-end gap-3">
            <div className="flex-1"><Field placeholder="ABCD-EFGH-JKLM" value={input} onChange={(e) => setInput(e.target.value)} /></div>
            <Button variant="primary" disabled={input.replace(/[^a-z0-9]/gi, '').length !== 12} onClick={send}>Send</Button>
          </div>
        </div>
      )}
      <Line label="Sync code" hint="Anyone with this code can read your synced data. Keep it private.">
        <div className="flex items-center gap-2">
          <code className="font-mono text-[13px] text-fg/70">{reveal ? cfg.code : '••••-••••-••••-••••-••••'}</code>
          <Button variant="ghost" onClick={() => setReveal(!reveal)}>{reveal ? 'Hide' : 'Show'}</Button>
          {desktop && <IconButton label="Copy sync code" onClick={() => navigator.clipboard.writeText(cfg.code).then(() => toast('Sync code copied'))}><Copy className="size-4" /></IconButton>}
        </div>
      </Line>
      <Line label="Stop syncing on this device" hint="Your data stays here and on your other devices.">
        <Button variant="danger" icon={<CloudOff className="size-4" />} onClick={() => confirm('Stop syncing on this device?') && setSyncCode('')}>Turn off</Button>
      </Line>
    </>
  )
}

function UpdateCard() {
  const [st, setSt] = useState<UpdateState>({ status: 'idle' })
  useEffect(() => api.update.onState(setSt), [])
  const text: Record<UpdateState['status'], string> = {
    idle: 'Lumen checks for updates automatically.',
    checking: 'Checking for updates…',
    none: "You're up to date.",
    unsupported: desktop ? 'Updates work in the installed app (not in dev mode).' : 'Updates install automatically when the app starts.',
    available: 'Downloading update…',
    downloading: 'Downloading update…',
    ready: 'An update is ready.',
    error: 'Update check failed.'
  }
  return (
    <Line label={`Lumen ${api.version}`} hint={st.status === 'error' ? st.message : st.status === 'downloading' && st.percent ? `Downloading… ${st.percent}%` : text[st.status]}>
      {st.status === 'ready' ? (
        <Button variant="primary" icon={<Download className="size-4" />} onClick={api.update.install}>Restart to update to {st.version}</Button>
      ) : (
        <Button icon={<RefreshCw className={`size-4 ${st.status === 'checking' ? 'animate-spin' : ''}`} />} onClick={api.update.check}>Check for updates</Button>
      )}
    </Line>
  )
}

const KEYS_DESKTOP: [string, string][] = [
  ['Arrow keys', 'Move focus'], ['Enter', 'Select / play'], ['Esc / Backspace', 'Back'], ['Ctrl + 1…6', 'Switch tabs'], ['/ or Ctrl + F', 'Search'],
  ['Space / K', 'Play / pause'], ['← / →', 'Seek 10 s (VOD)'], ['↑ / ↓ · PgUp / PgDn', 'Channel up / down'], ['0–9', 'Jump to channel number'],
  ['Esc (player)', 'Mini player'], ['F', 'Fullscreen'], ['M', 'Mute'], ['P', 'Picture in Picture'], ['C', 'Subtitles on / off'], ['Ctrl + V', 'Play a copied stream URL']
]
const KEYS_TV: [string, string][] = [
  ['Arrows / OK', 'Move / select'], ['Back', 'Back (exit on Home)'], ['Play / Pause', 'Play / pause'], ['◀◀ / ▶▶', 'Seek 10 s'],
  ['CH + / CH −', 'Channel up / down'], ['0–9', 'Jump to channel'], ['Red', 'Add to Favorites'], ['Green', 'Subtitles on / off']
]

export default function Settings() {
  const s = useApp((x) => x.settings)
  const sources = useApp((x) => x.sources)
  const library = useApp((x) => x.library)
  const epg = useApp((x) => x.epg)
  const loading = useApp((x) => x.loading)
  const matched = epg ? Object.keys(epg.programmes).length : 0
  const [tvSheet, setTvSheet] = useState(false)

  const remove = (src: Source) => {
    if (!confirm(`Remove “${src.name}”? Its channels will disappear from Lumen.`)) return
    saveSources(sources.filter((x) => x.id !== src.id), [], [src.id])
  }

  return (
    <div className="h-full overflow-y-auto px-3 pb-20 pt-[100px] md:px-8">
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
          {!sources.length && (
            <p className="py-3 text-[14px] text-fg/50">
              No sources yet. Add an Xtream Codes login or an M3U playlist{api.device === 'tv' ? ' — or link this TV with your PC under Sync below, so you never have to type a password with the remote.' : '.'}
            </p>
          )}
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

        <Card title="Sync & Devices" action={<MonitorSmartphone className="size-5 text-fg/40" />}>
          <SyncCard />
        </Card>

        {api.tvInstall && (
          <Card title="Samsung TV" action={<Tv className="size-5 text-fg/40" />}>
            <Line label="Watch Lumen on your Samsung TV" hint="A guided install: no terminal, about 5 minutes the first time. Afterwards the TV updates itself.">
              <Button variant="primary" icon={<Tv className="size-4" />} onClick={() => setTvSheet(true)}>Install on TV</Button>
            </Line>
          </Card>
        )}
        <AnimatePresence>{tvSheet && <TvInstallSheet key="tv" onClose={() => setTvSheet(false)} />}</AnimatePresence>

        <Card title="Appearance">
          <div className="py-3.5">
            <div className="mb-3 text-[14px] font-medium">Theme</div>
            <div className="grid grid-cols-3 gap-3 md:grid-cols-5">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  aria-label={`${t.name} theme`}
                  onClick={() => updateSettings({ theme: t.id, accent: '' })}
                  className={`card group relative overflow-hidden rounded-[18px] text-left transition ${s.theme === t.id ? 'ring-2 ring-accent' : 'ring-1 ring-fg/10 hover:ring-fg/30'}`}
                >
                  <div
                    className="relative h-[72px]"
                    style={{ background: `radial-gradient(80% 90% at 10% 0%, rgb(${t.glow[0]} / .7), transparent 70%), radial-gradient(70% 80% at 100% 100%, rgb(${t.glow[1]} / .8), transparent 70%), rgb(${t.base})` }}
                  >
                    <div className="absolute left-2.5 top-2.5 h-3 w-12 rounded-full" style={{ background: t.mode === 'dark' ? 'rgb(255 255 255 / .16)' : 'rgb(255 255 255 / .7)', boxShadow: 'inset 0 1px 0 rgb(255 255 255 / .4)' }} />
                    <div className="absolute bottom-2.5 right-2.5 size-4 rounded-full" style={{ background: `rgb(${t.accent})` }} />
                    {s.theme === t.id && <Check className="absolute bottom-2 left-2.5 size-4" style={{ color: `rgb(${t.fg})` }} />}
                  </div>
                  <div className="bg-[var(--card-bg)] px-2.5 py-1.5 text-[12px] font-semibold">{t.name}</div>
                </button>
              ))}
            </div>
          </div>
          <Line label="Accent color" hint="Overrides the theme's accent">
            <div className="flex items-center gap-2">
              <button onClick={() => updateSettings({ accent: '' })} className={`h-7 rounded-full px-3 text-[12px] font-semibold ${!s.accent ? 'bg-fg/15' : 'text-fg/55 hover:text-fg'}`}>Theme</button>
              {ACCENTS.map((c) => (
                <button key={c} aria-label={`Accent ${c}`} onClick={() => updateSettings({ accent: c })} className={`size-7 rounded-full transition ${s.accent === c ? 'ring-2 ring-fg ring-offset-2 ring-offset-transparent' : 'hover:scale-110'}`} style={{ background: c }} />
              ))}
            </div>
          </Line>
          <Line label="Artwork glow" hint="How much the background takes on the colours of the focused poster">
            <Segmented layoutId="ambient" value={s.ambient} onChange={(ambient) => updateSettings({ ambient })} options={[{ value: 'strong', label: 'Vivid' }, { value: 'subtle', label: 'Subtle' }, { value: 'off', label: 'Off' }]} />
          </Line>
          {api.platform === 'win32' && (
            <Line label="Window material" hint="Windows 11 only. Lets your desktop tint through the glass.">
              <Segmented layoutId="mat" value={s.material} onChange={(material) => updateSettings({ material })} options={[{ value: 'mica', label: 'Mica' }, { value: 'acrylic', label: 'Acrylic' }, { value: 'none', label: 'Solid' }]} />
            </Line>
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
          {desktop && (
            <div className="space-y-4 py-3.5">
              <LazyField label="VLC path" placeholder="C:\Program Files\VideoLAN\VLC\vlc.exe (auto-detected)" value={s.vlcPath} onCommit={(vlcPath) => updateSettings({ vlcPath })} />
              <LazyField label="User agent" value={s.userAgent} onCommit={(userAgent) => updateSettings({ userAgent: userAgent || DEFAULT_UA })} hint="Some providers only allow specific players. Leave empty to reset." />
            </div>
          )}
        </Card>

        <Card title="Profiles">
          <Line label={`Watching as ${currentProfile().name}`} hint="Each profile has its own watchlist, favorites and Continue Watching. Sources and settings are shared.">
            <div className="flex items-center gap-3">
              <Avatar id={currentProfile().avatar} className="size-9" />
              <Button onClick={openProfilePicker}>Switch or manage</Button>
            </div>
          </Line>
        </Card>

        <Card title="Library">
          <Line label="Refresh sources every">
            <Segmented layoutId="refresh" value={String(s.refreshHours)} onChange={(v) => updateSettings({ refreshHours: +v })} options={[{ value: '6', label: '6 h' }, { value: '12', label: '12 h' }, { value: '24', label: '1 day' }, { value: '168', label: '1 week' }]} />
          </Line>
          <Line label="Remove BS" hint="Hides Arabic and Indian channels, movies and series everywhere">
            <Toggle label="Remove BS" checked={s.removeBs} onChange={(removeBs) => updateSettings({ removeBs })} />
          </Line>
          <div className="py-3.5">
            <LazyField label="Hide categories containing" placeholder="adult, xxx, 24/7" value={s.hiddenGroups} onCommit={(hiddenGroups) => updateSettings({ hiddenGroups })} hint="Comma-separated words. Matching categories are hidden everywhere." />
          </div>
          {(['watchlist', 'favorites', 'history'] as const).map((k) => (
            <Line key={k} label={{ watchlist: 'Watchlist', favorites: 'Favorites', history: 'Watch history' }[k]} hint={k === 'history' ? 'Continue Watching and resume positions' : undefined}>
              <Button variant="danger" onClick={() => confirm(`Clear your ${k === 'history' ? 'watch history' : k}? This also clears it on synced devices.`) && clearCollection(k)}>Clear</Button>
            </Line>
          ))}
        </Card>

        <Card title="Updates">
          <UpdateCard />
        </Card>

        <Card title={api.device === 'tv' ? 'Remote control' : 'Keyboard'} action={<Keyboard className="size-5 text-fg/40" />}>
          <div className="grid grid-cols-2 gap-x-8 py-2">
            {(api.device === 'tv' ? KEYS_TV : KEYS_DESKTOP).map(([k, d]) => (
              <div key={k} className="flex items-center justify-between gap-4 py-2 text-[13px]">
                <span className="text-fg/60">{d}</span>
                <kbd className="glass-thin rounded-lg px-2 py-0.5 font-sans text-[12px] font-semibold text-fg/80">{k}</kbd>
              </div>
            ))}
          </div>
        </Card>

        <p className="pb-4 text-center text-[12px] text-fg/35">Lumen {api.version} · A player only — bring your own content.</p>
      </div>
    </div>
  )
}
