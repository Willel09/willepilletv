// Why won't it play? The built-in players only say "format not supported or the server refused it".
// This looks at the stream itself: the HTTP answer, the codecs named in the container header, and,
// for Xtream, how many connections the account has in use.

export interface ProbeResult {
  /** HTTP status, 0 = unreachable */
  status: number
  type?: string
  codecs: string[]
  account?: { status?: string; active?: number; max?: number }
}

type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>

// codec names as they appear in Matroska (V_/A_ ids) and MP4 (sample entry fourccs) headers
const MARKERS: [string, string][] = [
  ['V_MPEGH/ISO/HEVC', 'HEVC (H.265) video'],
  ['hvc1', 'HEVC (H.265) video'],
  ['hev1', 'HEVC (H.265) video'],
  ['V_AV1', 'AV1 video'],
  ['A_EAC3', 'Dolby Digital Plus (E-AC3) audio'],
  ['ec-3', 'Dolby Digital Plus (E-AC3) audio'],
  ['A_AC3', 'Dolby Digital (AC3) audio'],
  ['ac-3', 'Dolby Digital (AC3) audio'],
  ['A_DTS', 'DTS audio'],
  ['dtsc', 'DTS audio'],
  ['A_TRUEHD', 'Dolby TrueHD audio']
]

export function sniffCodecs(bytes: Uint8Array): string[] {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)))
  return [...new Set(MARKERS.filter(([m]) => s.includes(m)).map(([, label]) => label))]
}

const timeout = (ms: number) => {
  const c = new AbortController()
  setTimeout(() => c.abort(), ms)
  return c.signal
}

export async function probeStream(url: string, fetchFn: Fetch, ua: string): Promise<ProbeResult> {
  const out: ProbeResult = { status: 0, codecs: [] }
  try {
    const res = await fetchFn(url, { headers: { 'User-Agent': ua, Range: 'bytes=0-262143' }, signal: timeout(8000) })
    out.status = res.status
    out.type = res.headers.get('content-type') ?? undefined
    if (res.ok && res.body) {
      const reader = res.body.getReader()
      const parts: Uint8Array[] = []
      let got = 0
      while (got < 262144) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
        got += value.length
      }
      reader.cancel().catch(() => {})
      const all = new Uint8Array(got)
      let o = 0
      for (const p of parts) all.set(p.subarray(0, got - o), o), (o += p.length)
      out.codecs = sniffCodecs(all)
    }
  } catch {
    /* unreachable: status 0 */
  }
  // Xtream: /movie|series|live/<user>/<pass>/<id>.<ext> → the account's connection count
  const m = url.match(/^(https?:\/\/[^/]+)\/(?:movie|series|live)\/([^/]+)\/([^/]+)\//)
  if (m && out.status !== 200 && out.status !== 206) {
    try {
      const r = await fetchFn(`${m[1]}/player_api.php?username=${m[2]}&password=${m[3]}`, { headers: { 'User-Agent': ua }, signal: timeout(6000) })
      const ui = ((await r.json()) as { user_info?: { status?: string; active_cons?: string; max_connections?: string } })?.user_info
      if (ui) out.account = { status: ui.status, active: Number(ui.active_cons), max: Number(ui.max_connections) }
    } catch {
      /* no account info */
    }
  }
  return out
}

/** A message people can act on, or null when the probe found nothing more specific */
export function explainProbe(r: ProbeResult, device: 'desktop' | 'tv' | 'web'): string | null {
  const acct = r.account
  if (acct?.status && acct.status !== 'Active') return `Your provider account is "${acct.status}". Check your subscription with the provider.`
  if (r.status === 0) return "The provider's server didn't answer. Check your internet connection, or try again in a minute."
  if (r.status >= 400) {
    if (acct?.max && acct.active !== undefined && acct.active >= acct.max)
      return `The provider refused the stream: your subscription allows ${acct.max} connection${acct.max > 1 ? 's' : ''} and ${acct.active} ${acct.active === 1 ? 'is' : 'are'} in use. Stop playback on your other device (the TV?) and try again.`
    if (r.status === 404) return 'This title is no longer available at the provider (HTTP 404).'
    if (r.status === 401 || r.status === 403 || r.status === 458 || r.status === 509)
      return `The provider refused the stream (HTTP ${r.status}). Usually the connection limit is reached (another device is playing) or the subscription has expired.`
    return `The provider's server had a problem (HTTP ${r.status}). Try again in a moment.`
  }
  if (r.type && /text\/html|application\/json/i.test(r.type)) return 'The provider sent a web page instead of the video. The subscription may have expired, or the provider blocks this app.'
  // Samsung TVs decode all of these; browsers and the Windows app don't (HEVC depends on the PC's graphics)
  if (device !== 'tv' && r.codecs.length)
    return `This video uses ${r.codecs.join(' and ')}, which the built-in player can't play${device === 'desktop' ? ' on this PC. Use Open in VLC, or Cast to TV.' : ' here. Use the Windows or TV app.'}`
  return null
}
