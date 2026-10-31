import { Check, Copy, ExternalLink, Radar, Tv, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { SamsungTv } from '../../../shared/types'
import { Sheet } from '../components/Sheet'
import { Button, Field, Spinner } from '../components/ui'
import { api, toast } from '../store'

const REPO = 'Willel09/willepilletv'

function CopyChip({ label, value }: { label: string; value: string }) {
  return (
    <button
      onClick={() => navigator.clipboard.writeText(value).then(() => toast(`Copied ${value}`))}
      className="glass-thin flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-left transition hover:bg-fg/10"
    >
      <span className="text-[12.5px] text-fg/55">{label}</span>
      <span className="flex items-center gap-2 font-mono text-[14px] font-semibold">
        {value} <Copy className="size-3.5 text-fg/50" />
      </span>
    </button>
  )
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className={`grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-bold ${done ? 'bg-green-500 text-white' : 'bg-fg/12'}`}>
        {done ? <Check className="size-4" /> : n}
      </div>
      <div className="min-w-0 flex-1 pb-6">
        <h3 className="mb-2 text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
        <div className="space-y-2.5 text-[13.5px] leading-relaxed text-fg/65">{children}</div>
      </div>
    </div>
  )
}

/** Guided Samsung TV install: no terminal, just a few clicks */
export function TvInstallSheet({ onClose }: { onClose: () => void }) {
  const tvApi = api.tvInstall!
  const [ips, setIps] = useState<string[]>([])
  const [tvs, setTvs] = useState<SamsungTv[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [ip, setIp] = useState('')
  const [devMode, setDevMode] = useState<boolean | null>(null)
  const [opening, setOpening] = useState(false)

  const scan = async () => {
    setScanning(true)
    const found = await tvApi.discover()
    setTvs(found)
    setScanning(false)
    const ready = found.find((t) => t.devMode) ?? found[0]
    if (ready && !ip) (setIp(ready.ip), setDevMode(ready.devMode))
  }
  useEffect(() => {
    tvApi.localIps().then(setIps)
    scan()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const check = async (addr = ip) => setDevMode(await tvApi.checkDevMode(addr.trim()))
  const open = async () => {
    setOpening(true)
    const r = await tvApi.openInstaller()
    setOpening(false)
    if (!r.ok) toast(r.error!)
  }

  return (
    <Sheet title="Install Lumen on your Samsung TV" onClose={onClose} width={620}>
      <Step n={1} title="Turn on Developer Mode on the TV" done={devMode === true}>
        <p>
          On the TV, open <b>Apps</b>, then press <b>1 2 3 4 5</b> on the remote. Switch <b>Developer mode</b> on and enter this PC's IP address as the <b>Host PC IP</b>:
        </p>
        {ips.length ? ips.slice(0, 2).map((x) => <CopyChip key={x} label="This PC" value={x} />) : <p className="text-fg/40">No network connection found.</p>}
        <p>Then turn the TV off and on again (hold the power button until the logo appears).</p>
      </Step>

      <Step n={2} title="Find your TV" done={devMode === true}>
        <div className="space-y-2">
          {tvs?.map((t) => (
            <button
              key={t.ip}
              onClick={() => (setIp(t.ip), setDevMode(t.devMode))}
              className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition ${ip === t.ip ? 'bg-fg/14 shadow-[inset_0_0_0_1px_var(--glass-edge)]' : 'glass-thin hover:bg-fg/10'}`}
            >
              <Tv className="size-5 shrink-0 text-fg/70" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-fg">{t.name}</span>
                <span className="text-[12px] text-fg/50">{t.ip}</span>
              </span>
              <span className={`flex items-center gap-1 text-[12px] font-semibold ${t.devMode ? 'text-green-400' : 'text-amber-300'}`}>
                {t.devMode ? <><Check className="size-3.5" /> Developer Mode on</> : <><X className="size-3.5" /> Developer Mode off</>}
              </span>
            </button>
          ))}
          {tvs && !tvs.length && !scanning && <p>No TV found automatically. Type its IP address below (TV → Settings → General → Network → Network Status → IP Settings).</p>}
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field placeholder="TV IP address, e.g. 192.168.1.50" value={ip} onChange={(e) => (setIp(e.target.value), setDevMode(null))} />
          </div>
          <Button onClick={() => check()} disabled={!ip.trim()}>Check</Button>
          <Button icon={scanning ? <Spinner className="size-4" /> : <Radar className="size-4" />} onClick={scan} disabled={scanning}>
            {scanning ? 'Searching…' : 'Search again'}
          </Button>
        </div>
        {devMode === false && <p className="text-amber-300">Developer Mode isn't answering on {ip}. Check step 1 and restart the TV.</p>}
        {devMode === true && <p className="text-green-400">Ready: the TV accepts installs.</p>}
      </Step>

      <Step n={3} title="Install">
        <p>
          Click the button. Lumen downloads and opens <b>SmartTV Installer</b> (a free, open-source tool). In it, choose <b>Samsung</b>, then fill in:
        </p>
        <CopyChip label="TV IP address" value={ip.trim() || '—'} />
        <CopyChip label="Preset → Custom GitHub Repository" value={REPO} />
        <p>
          Press <b>Install</b>. The first time, a Samsung account sign-in opens in your browser. That creates the developer certificate for your TV (free; any Samsung account works).
        </p>
        <Button variant="primary" size="lg" icon={opening ? <Spinner className="size-5" /> : <ExternalLink className="size-5" />} onClick={open} disabled={opening}>
          {opening ? 'Opening…' : 'Open TV Installer'}
        </Button>
      </Step>

      <Step n={4} title="Link the TV to this PC">
        <p>
          Open Lumen on the TV and choose <b>Already use Lumen on another device? Link it</b>. Then, here on the PC, go to <b>Settings → Sync &amp; Devices → Link a device</b> and type the code the TV shows. Your sources and lists appear on the TV, with no typing on the remote.
        </p>
      </Step>
    </Sheet>
  )
}
