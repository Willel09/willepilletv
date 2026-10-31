// "Install on Samsung TV" assistant: no terminal needed.
// Finds TVs on the LAN, checks Developer Mode, and downloads + opens SmartTV Installer
// (https://github.com/Krishnakant010/smarttv-installer), which signs and installs Lumen.wgt.
import { app, net, shell } from 'electron'
import { spawn } from 'child_process'
import dgram from 'dgram'
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'fs'
import { Socket } from 'net'
import { networkInterfaces } from 'os'
import { join } from 'path'
import type { SamsungTv } from '../shared/types'

const RELEASES = 'https://github.com/Krishnakant010/smarttv-installer/releases/latest'
const RELEASES_API = 'https://api.github.com/repos/Krishnakant010/smarttv-installer/releases/latest'
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** The TV's Developer Mode screen asks for this PC's IP address */
export function localIps(): string[] {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address)
  // home networks first
  return ips.sort((a, b) => Number(/^(192\.168|10\.|172\.)/.test(b)) - Number(/^(192\.168|10\.|172\.)/.test(a)))
}

/** Developer Mode opens the Samsung debug bridge on port 26101 */
export function devModeOn(ip: string): Promise<boolean> {
  if (!IPV4.test(ip)) return Promise.resolve(false)
  return new Promise((resolve) => {
    const s = new Socket()
    const done = (ok: boolean) => (s.destroy(), resolve(ok))
    s.setTimeout(1500)
    s.once('connect', () => done(true))
    s.once('timeout', () => done(false))
    s.once('error', () => done(false))
    s.connect(26101, ip)
  })
}

/** SSDP search: Samsung TVs answer as RemoteControlReceiver / DIAL devices */
export function discoverTvs(timeoutMs = 3500): Promise<SamsungTv[]> {
  return new Promise((resolve) => {
    const found = new Map<string, SamsungTv>()
    const names: Promise<void>[] = []
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const finish = async () => {
      try { sock.close() } catch { /* already closed */ }
      await Promise.allSettled(names)
      const tvs = [...found.values()]
      await Promise.all(tvs.map(async (tv) => (tv.devMode = await devModeOn(tv.ip))))
      resolve(tvs)
    }
    sock.on('message', (buf, rinfo) => {
      const text = buf.toString()
      if (!/samsung|tizen/i.test(text) || found.has(rinfo.address)) return
      const tv: SamsungTv = { ip: rinfo.address, name: 'Samsung TV', devMode: false }
      found.set(rinfo.address, tv)
      const location = text.match(/^location:\s*(\S+)/im)?.[1]
      if (location?.startsWith('http://'))
        names.push(
          fetch(location, { signal: AbortSignal.timeout(1500) })
            .then((r) => r.text())
            .then((xml) => {
              const n = xml.match(/<friendlyName>([^<]+)<\/friendlyName>/)?.[1]
              if (n) tv.name = n.replace(/&amp;/g, '&').replace(/&#\d+;/g, '').trim()
            })
            .catch(() => {})
        )
    })
    sock.on('error', finish)
    sock.bind(() => {
      for (const st of ['urn:samsung.com:device:RemoteControlReceiver:1', 'urn:dial-multiscreen-org:service:dial:1', 'ssdp:all'])
        sock.send(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`, 1900, '239.255.255.250')
    })
    setTimeout(finish, timeoutMs)
  })
}

/** Download (once) and open the SmartTV Installer desktop app */
export async function openTvInstaller(progress: (m: string) => void): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'win32') {
    await shell.openExternal(RELEASES)
    return { ok: true }
  }
  try {
    progress('Finding SmartTV Installer…')
    const rel = (await (await net.fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })).json()) as {
      assets?: { name: string; size: number; browser_download_url: string }[]
    }
    const exes = (rel.assets ?? []).filter((a) => /\.exe$/i.test(a.name))
    const asset = exes.find((a) => /portable/i.test(a.name)) ?? exes.find((a) => !/setup|install/i.test(a.name)) ?? exes[0]
    if (!asset) throw new Error('No Windows download found')

    const dir = join(app.getPath('userData'), 'tools')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, asset.name.replace(/[^\w.-]/g, '_'))
    if (!existsSync(file) || statSync(file).size !== asset.size) {
      const res = await net.fetch(asset.browser_download_url)
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
      const tmp = `${file}.part`
      const out = createWriteStream(tmp)
      const reader = res.body.getReader()
      let got = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        got += value.length
        if (!out.write(value)) await new Promise((r) => out.once('drain', r))
        progress(`Downloading TV installer… ${Math.round((got / asset.size) * 100)}%`)
      }
      await new Promise((r) => out.end(r))
      renameSync(tmp, file)
    }
    progress('')
    spawn(file, [], { detached: true, stdio: 'ignore' }).unref()
    return { ok: true }
  } catch (e) {
    progress('')
    await shell.openExternal(RELEASES)
    return { ok: false, error: `${(e as Error).message}. The download page has been opened in your browser instead.` }
  }
}
