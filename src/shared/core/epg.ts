import type { Channel, Programme } from '../types'

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e] ?? m
    )
    .trim()
}

/** XMLTV time: "20240101120000 +0100" (offset optional, defaults to UTC). */
export function parseXmltvTime(s: string): number {
  const m = s.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*(?:([+-])(\d{2}):?(\d{2}))?/)
  if (!m) return NaN
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0))
  const off = m[7] ? (m[7] === '-' ? -1 : 1) * (+m[8] * 60 + +m[9]) : 0
  return utc - off * 60_000
}

const attr = (s: string, name: string) => s.match(new RegExp(`\\b${name}=["']([^"']*)["']`))?.[1] ?? ''
const tag = (s: string, name: string) => {
  const m = s.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`))
  return m ? decodeXml(m[1]) : undefined
}

export interface XmltvData {
  /** epg channel id -> display names */
  names: Map<string, string[]>
  /** epg channel id -> programmes (sorted) */
  programmes: Map<string, Programme[]>
}

/**
 * Copies a substring out of its source text. V8 keeps substrings as "slices" that point at the whole
 * parent, so one programme title would otherwise keep an entire 100 MB guide (or playlist) in memory.
 */
export const own = (s: string) => (' ' + s).slice(1)

/** V8 also keeps the last string a regex ran on (RegExp.lastMatch); point it at something tiny */
export const releaseRegexInput = () => void /x/.test('x')

/**
 * Regex scan instead of a DOM parser: XMLTV files are often 100MB+. Text can be pushed in chunks while
 * it downloads, so the whole file never has to be in memory. Descriptions are only kept until `descUntil`.
 */
export class XmltvParser {
  private rest = ''
  /** titles repeat across channels and days ("News", "Weather"): keep one copy of each */
  private titles = new Map<string, string>()
  readonly names = new Map<string, string[]>()
  readonly programmes = new Map<string, Programme[]>()
  private from: number
  private to: number
  private descUntil: number
  constructor(from: number, to: number, descUntil = to) {
    this.from = from
    this.to = to
    this.descUntil = descUntil
  }

  push(chunk: string) {
    const buf = this.rest + chunk
    // <channel> and <programme> are flat siblings: everything up to the last closing tag is complete
    const end = Math.max(buf.lastIndexOf('</programme>'), buf.lastIndexOf('</channel>'))
    if (end < 0) return void (this.rest = buf)
    const cut = buf.indexOf('>', end) + 1
    this.scan(buf.slice(0, cut))
    this.rest = own(buf.slice(cut))
  }

  finish(): XmltvData {
    this.scan(this.rest)
    this.rest = ''
    this.titles.clear()
    for (const list of this.programmes.values()) list.sort((a, b) => a.start - b.start)
    releaseRegexInput()
    return { names: this.names, programmes: this.programmes }
  }

  private scan(xml: string) {
    for (const m of xml.matchAll(/<channel\b([^>]*)>([\s\S]*?)<\/channel>/g)) {
      const id = own(decodeXml(attr(m[1], 'id')))
      this.names.set(id, [...m[2].matchAll(/<display-name[^>]*>([\s\S]*?)<\/display-name>/g)].map((x) => own(decodeXml(x[1]))))
    }
    for (const m of xml.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme>/g)) {
      const start = parseXmltvTime(attr(m[1], 'start'))
      const stop = parseXmltvTime(attr(m[1], 'stop'))
      if (!(stop > this.from && start < this.to)) continue
      const ch = decodeXml(attr(m[1], 'channel'))
      const desc = start < this.descUntil ? tag(m[2], 'desc') : undefined
      const t = tag(m[2], 'title') || 'Untitled'
      let title = this.titles.get(t)
      if (title === undefined) this.titles.set((title = own(t)), title)
      const p: Programme = { start, stop, title, desc: desc ? own(desc.slice(0, 280)) : undefined }
      const list = this.programmes.get(ch)
      if (list) list.push(p)
      else this.programmes.set(own(ch), [p])
    }
  }
}

export function parseXmltv(xml: string, from: number, to: number, descUntil = to): XmltvData {
  const p = new XmltvParser(from, to, descUntil)
  p.push(xml)
  return p.finish()
}

/** Normalise a channel name for fuzzy matching: "UK: BBC One HD" -> "bbcone" */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/^\s*[|[(]?\s*[a-z]{2,3}\s*[|\])]?\s*[:|-]\s*/, '')
    .replace(/\b(hd|fhd|uhd|4k|sd|hevc|h\.?26[45]|backup|raw)\b/g, '')
    .replace(/[^a-z0-9+]/g, '')
}

/** Map guide data onto channels: exact tvg-id/epg_channel_id first, then normalised display name. */
export function matchEpg(channels: Channel[], data: XmltvData[]): Record<string, Programme[]> {
  const byId = new Map<string, Programme[]>()
  const byName = new Map<string, Programme[]>()
  for (const d of data) {
    for (const [id, list] of d.programmes) {
      if (!byId.has(id.toLowerCase())) byId.set(id.toLowerCase(), list)
      for (const n of d.names.get(id) ?? []) {
        const k = normName(n)
        if (k && !byName.has(k)) byName.set(k, list)
      }
    }
  }
  const out: Record<string, Programme[]> = {}
  for (const ch of channels) {
    const list = (ch.epgId && byId.get(ch.epgId.toLowerCase())) || byName.get(normName(ch.name))
    if (list) out[ch.id] = list
  }
  return out
}
