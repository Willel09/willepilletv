// Cast to TVs on the local network, from the Windows app:
//   - Chromecast / Google TV: found by mDNS, played with the Default Media Receiver over the Cast v2 protocol
//   - Samsung (and other DLNA) TVs: found by SSDP as UPnP MediaRenderers, played with AVTransport SOAP calls
import { randomBytes } from 'crypto'
import dgram from 'dgram'
import http from 'http'
import type { AddressInfo } from 'net'
import { networkInterfaces } from 'os'
import { Readable } from 'stream'
import tls from 'tls'
import type { CastDevice, CastMedia } from '../shared/types'
import { encodeCast, frameReader, GOOGLECAST, mdnsQuery, parseMdns, type CastMsg } from './castproto'

const devices = new Map<string, CastDevice & { control?: string; port?: number }>()
let session: { stop: () => Promise<void> } | null = null

/* ---------- discovery ---------- */

function findChromecasts(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    sock.on('message', (buf, rinfo) => {
      const r = parseMdns(buf)
      if (!r.cast || !r.name) return
      devices.set(`cc:${rinfo.address}`, { id: `cc:${rinfo.address}`, name: r.name, kind: 'chromecast', model: r.model, host: rinfo.address, port: r.port ?? 8009 })
    })
    sock.on('error', () => resolve())
    sock.bind(0, () => {
      const q = mdnsQuery(GOOGLECAST)
      sock.send(q, 5353, '224.0.0.251')
      setTimeout(() => sock.send(q, 5353, '224.0.0.251'), 800) // one retry, UDP gets lost
    })
    setTimeout(() => (sock.close(), resolve()), ms)
  })
}

const tag = (xml: string, t: string) => xml.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1]?.trim()
const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

function findDlna(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const seen = new Set<string>()
    const pending: Promise<void>[] = []
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    sock.on('message', (buf) => {
      const location = buf.toString().match(/^location:\s*(\S+)/im)?.[1]
      if (!location?.startsWith('http://') || seen.has(location)) return
      seen.add(location)
      pending.push(
        fetch(location, { signal: AbortSignal.timeout(2000) })
          .then((r) => r.text())
          .then((xml) => {
            const svc = xml.split('<service>').find((s) => s.includes('urn:schemas-upnp-org:service:AVTransport:1'))
            const control = svc && tag(svc, 'controlURL')
            if (!control) return
            const name = unxml(tag(xml, 'friendlyName') ?? 'TV')
            devices.set(`dlna:${location}`, { id: `dlna:${location}`, name, kind: 'dlna', model: tag(xml, 'manufacturer'), host: new URL(location).hostname, control: new URL(control, tag(xml, 'URLBase') || location).href })
          })
          .catch(() => {})
      )
    })
    sock.on('error', () => resolve())
    sock.bind(() => {
      const msg = 'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n'
      sock.send(msg, 1900, '239.255.255.250')
      setTimeout(() => sock.send(msg, 1900, '239.255.255.250'), 800)
    })
    setTimeout(async () => {
      try { sock.close() } catch { /* closed */ }
      await Promise.allSettled(pending)
      resolve()
    }, ms)
  })
}

export async function discoverCast(): Promise<CastDevice[]> {
  devices.clear()
  await Promise.all([findChromecasts(2500), findDlna(2500)])
  return [...devices.values()].map(({ id, name, kind, model, host }) => ({ id, name, kind, model, host }))
}

/* ---------- playback ---------- */

const MIME: Record<string, string> = { m3u8: 'application/x-mpegURL', ts: 'video/mp2t', mp4: 'video/mp4', m4v: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo', webm: 'video/webm', mov: 'video/quicktime' }
const mimeOf = (url: string) => MIME[url.split('?')[0].split('.').pop()?.toLowerCase() ?? ''] ?? 'video/mp4'

const NS = { conn: 'urn:x-cast:com.google.cast.tp.connection', beat: 'urn:x-cast:com.google.cast.tp.heartbeat', recv: 'urn:x-cast:com.google.cast.receiver', media: 'urn:x-cast:com.google.cast.media' }
const DEFAULT_RECEIVER = 'CC1AD845'

function castChromecast(host: string, port: number, m: CastMedia): Promise<{ stop: () => Promise<void> }> {
  const url = m.hlsUrl ?? m.url // the Default Media Receiver can't play raw MPEG-TS, HLS works
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, rejectUnauthorized: false }) // Cast devices use self-signed certs
    const send = (dest: string, ns: string, data: object) => sock.write(encodeCast({ source: 'sender-0', destination: dest, namespace: ns, data: JSON.stringify(data) }))
    let transport = '', sessionId = '', done = false
    const fail = (msg: string) => {
      if (done) return
      done = true
      clearInterval(beat)
      sock.destroy()
      reject(new Error(msg))
    }
    const timer = setTimeout(() => fail("The TV didn't respond. Check that it's on and on the same network."), 15000)
    const beat = setInterval(() => send('receiver-0', NS.beat, { type: 'PING' }), 5000)
    const stop = async () => {
      clearInterval(beat)
      if (sessionId) send('receiver-0', NS.recv, { type: 'STOP', sessionId, requestId: 9 })
      await new Promise((r) => setTimeout(r, 300))
      sock.destroy()
    }
    sock.on('error', (e) => fail(`Couldn't connect to the TV (${e.message}).`))
    sock.on('close', () => clearInterval(beat))
    sock.on('data', frameReader((msg: CastMsg) => {
      let d: { type?: string; status?: { applications?: { appId: string; transportId: string; sessionId: string }[] }; reason?: string }
      try { d = JSON.parse(msg.data) } catch { return }
      if (d.type === 'PING') return send(msg.source, NS.beat, { type: 'PONG' })
      if (d.type === 'RECEIVER_STATUS' && !transport) {
        const app = d.status?.applications?.find((a) => a.appId === DEFAULT_RECEIVER)
        if (!app) return
        transport = app.transportId
        sessionId = app.sessionId
        send(transport, NS.conn, { type: 'CONNECT' })
        send(transport, NS.media, {
          type: 'LOAD', requestId: 2, autoplay: true, currentTime: m.live ? undefined : m.startAt ?? 0,
          media: { contentId: url, contentType: mimeOf(url), streamType: m.live ? 'LIVE' : 'BUFFERED', metadata: { metadataType: 0, title: m.title, images: m.poster ? [{ url: m.poster }] : [] } }
        })
      } else if (d.type === 'MEDIA_STATUS' && transport && !done) {
        done = true
        clearTimeout(timer)
        resolve({ stop })
      } else if (d.type === 'LOAD_FAILED' || d.type === 'LOAD_CANCELLED' || d.type === 'INVALID_REQUEST') {
        clearTimeout(timer)
        fail("The TV couldn't play this stream. Chromecast plays MP4 and HLS; some providers also block other devices.")
      } else if (d.type === 'LAUNCH_ERROR') {
        clearTimeout(timer)
        fail(`The TV refused to start playback (${d.reason ?? 'launch error'}).`)
      }
    }))
    sock.on('secureConnect', () => {
      send('receiver-0', NS.conn, { type: 'CONNECT' })
      send('receiver-0', NS.recv, { type: 'LAUNCH', appId: DEFAULT_RECEIVER, requestId: 1 })
    })
  })
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/* ---------- relay: the PC re-serves the stream so DLNA TVs accept it ----------
   Samsung TVs check the stream when they get the URL and refuse IPTV servers' generic content types
   (application/octet-stream) and missing DLNA headers; some providers also require a User-Agent.
   The relay only serves the stream being cast, under an unguessable token. */

let relay: { server: http.Server; port: number } | null = null
const relayed = new Map<string, { url: string; mime: string; ua: string }>()

function serveRelay(req: http.IncomingMessage, res: http.ServerResponse) {
  const item = relayed.get(req.url?.split('/')[1] ?? '')
  if (!item || (req.method !== 'GET' && req.method !== 'HEAD')) return void res.writeHead(404).end()
  const ctl = new AbortController()
  res.on('close', () => ctl.abort())
  fetch(item.url, { headers: { 'User-Agent': item.ua, ...(req.headers.range ? { Range: req.headers.range } : {}) }, signal: ctl.signal })
    .then((up) => {
      if (!up.ok || !up.body) return void res.writeHead(502).end()
      const seekable = up.headers.get('accept-ranges') === 'bytes' || up.status === 206
      const headers: Record<string, string> = {
        'Content-Type': item.mime,
        'transferMode.dlna.org': 'Streaming',
        'contentFeatures.dlna.org': `DLNA.ORG_OP=${seekable ? '01' : '00'};DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000`
      }
      for (const h of ['content-length', 'content-range']) if (up.headers.get(h)) headers[h] = up.headers.get(h)!
      if (seekable) headers['Accept-Ranges'] = 'bytes'
      res.writeHead(up.status, headers)
      if (req.method === 'HEAD') return void (up.body.cancel().catch(() => {}), res.end())
      Readable.fromWeb(up.body as never).on('error', () => res.destroy()).pipe(res)
    })
    .catch(() => (res.headersSent ? res.destroy() : res.writeHead(502).end()))
}

/** The PC's address on the TV's network */
function lanIpFor(host: string) {
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address)
  const prefix = host.split('.').slice(0, 3).join('.')
  return ips.find((ip) => ip.startsWith(prefix + '.')) ?? ips[0] ?? '127.0.0.1'
}

async function relayUrl(url: string, mime: string, ua: string, tvHost: string) {
  if (!relay) {
    const server = http.createServer(serveRelay)
    await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '0.0.0.0', () => resolve()))
    relay = { server, port: (server.address() as AddressInfo).port }
  }
  const token = randomBytes(16).toString('hex')
  relayed.clear() // only the current cast is served
  relayed.set(token, { url, mime, ua })
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? 'mp4'
  return `http://${lanIpFor(tvHost)}:${relay.port}/${token}/video.${ext}`
}

async function soap(control: string, action: string, args: string) {
  const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID>${args}</u:${action}></s:Body></s:Envelope>`
  const res = await fetch(control, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"urn:schemas-upnp-org:service:AVTransport:1#${action}"` },
    body,
    signal: AbortSignal.timeout(8000)
  })
  if (!res.ok) {
    // UPnP faults carry the reason, e.g. 714 "Illegal MIME-type", 716 "Resource not found"
    const xml = await res.text().catch(() => '')
    const code = xml.match(/<errorCode>(\d+)</)?.[1]
    const desc = xml.match(/<errorDescription>([^<]*)</)?.[1]
    throw new Error(`${action} failed (${res.status}${code ? `, UPnP ${code}${desc ? ` ${desc}` : ''}` : ''})`)
  }
}

async function castDlna(control: string, host: string, m: CastMedia, ua: string) {
  const mime = mimeOf(m.url)
  const load = async (url: string, type: string) => {
    // Samsung TVs want DIDL-Lite metadata with a protocolInfo, or they reject the URI
    const didl = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="-1" restricted="1"><dc:title>${esc(m.title)}</dc:title><upnp:class>object.item.videoItem</upnp:class><res protocolInfo="http-get:*:${type}:*">${esc(url)}</res></item></DIDL-Lite>`
    await soap(control, 'SetAVTransportURI', `<CurrentURI>${esc(url)}</CurrentURI><CurrentURIMetaData>${esc(didl)}</CurrentURIMetaData>`)
    await soap(control, 'Play', '<Speed>1</Speed>')
  }
  await soap(control, 'Stop', '').catch(() => {}) // a TV still playing something may refuse a new URI
  // 1) the provider's URL as is; 2) through the relay (right content type + DLNA headers + User-Agent);
  // 3) Samsung's older Matroska type for .mkv
  const attempts: [() => Promise<string>, string][] = [
    [async () => m.url, mime],
    [() => relayUrl(m.url, mime, ua, host), mime],
    ...(mime === 'video/x-matroska' ? [[() => relayUrl(m.url, 'video/x-mkv', ua, host), 'video/x-mkv'] as [() => Promise<string>, string]] : [])
  ]
  let last: Error | null = null
  for (const [url, type] of attempts) {
    try {
      await load(await url(), type)
      last = null
      break
    } catch (e) {
      last = e as Error
    }
  }
  if (last)
    throw new Error(
      /UPnP 714|MIME/i.test(last.message)
        ? `The TV can't play this format (${last.message}). Try another title, or Chromecast.`
        : /EADDRINUSE|EACCES/.test(last.message)
          ? "Couldn't start streaming from this PC. Check that Windows Firewall allows Lumen on private networks."
          : `The TV didn't accept the stream (${last.message}). If Windows asked about network access for Lumen, choose Allow, then try again.`
    )
  if (m.startAt && !m.live) {
    const t = Math.floor(m.startAt)
    const hms = [t / 3600, (t / 60) % 60, t % 60].map((x) => String(Math.floor(x)).padStart(2, '0')).join(':')
    // the TV must be playing before it accepts a seek
    setTimeout(() => soap(control, 'Seek', `<Unit>REL_TIME</Unit><Target>${hms}</Target>`).catch(() => {}), 4000)
  }
  return { stop: () => soap(control, 'Stop', '').catch(() => {}) }
}

export async function startCast(id: string, media: CastMedia, ua: string): Promise<{ ok: boolean; error?: string }> {
  const dev = devices.get(id)
  if (!dev) return { ok: false, error: 'That TV is no longer available. Search again.' }
  if (!/^https?:\/\//i.test(media.url)) return { ok: false, error: 'Only internet streams can be cast.' }
  await stopCast()
  try {
    session = dev.kind === 'chromecast' ? await castChromecast(dev.host, dev.port ?? 8009, media) : await castDlna(dev.control!, dev.host, media, ua)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function stopCast() {
  const s = session
  session = null
  relayed.clear()
  await s?.stop()
}
