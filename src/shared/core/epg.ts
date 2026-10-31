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
 * Regex scan instead of a DOM parser: XMLTV files are often 100MB+, this keeps memory flat and is fast.
 * Descriptions are only kept until `descUntil` so a 10k-channel guide stays small enough to ship to the UI.
 */
export function parseXmltv(xml: string, from: number, to: number, descUntil = to): XmltvData {
  const names = new Map<string, string[]>()
  for (const m of xml.matchAll(/<channel\b([^>]*)>([\s\S]*?)<\/channel>/g)) {
    const id = decodeXml(attr(m[1], 'id'))
    names.set(id, [...m[2].matchAll(/<display-name[^>]*>([\s\S]*?)<\/display-name>/g)].map((x) => decodeXml(x[1])))
  }
  const programmes = new Map<string, Programme[]>()
  for (const m of xml.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme>/g)) {
    const start = parseXmltvTime(attr(m[1], 'start'))
    const stop = parseXmltvTime(attr(m[1], 'stop'))
    if (!(stop > from && start < to)) continue
    const ch = decodeXml(attr(m[1], 'channel'))
    const desc = start < descUntil ? tag(m[2], 'desc') : undefined
    const p: Programme = { start, stop, title: tag(m[2], 'title') || 'Untitled', desc: desc && desc.slice(0, 280) }
    const list = programmes.get(ch)
    if (list) list.push(p)
    else programmes.set(ch, [p])
  }
  for (const list of programmes.values()) list.sort((a, b) => a.start - b.start)
  return { names, programmes }
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
