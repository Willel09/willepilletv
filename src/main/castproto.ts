// Wire formats for casting, kept free of Electron so they can be unit tested:
// Chromecast CastMessage protobuf framing, and the mDNS query/response for _googlecast._tcp.
// shortcut: hand-rolled because castv2/castv2-client pull in protobufjs 6 (critical CVEs).

export interface CastMsg {
  source: string
  destination: string
  namespace: string
  data: string
}

const varint = (n: number) => {
  const out: number[] = []
  while (n > 0x7f) (out.push((n & 0x7f) | 0x80), (n >>>= 7))
  out.push(n)
  return Buffer.from(out)
}
const str = (field: number, s: string) => {
  const b = Buffer.from(s, 'utf8')
  return Buffer.concat([Buffer.from([(field << 3) | 2]), varint(b.length), b])
}

/** CastMessage { protocol_version=0, source_id, destination_id, namespace, payload_type=STRING, payload_utf8 } with 4-byte length prefix */
export function encodeCast(m: CastMsg): Buffer {
  const body = Buffer.concat([Buffer.from([0x08, 0x00]), str(2, m.source), str(3, m.destination), str(4, m.namespace), Buffer.from([0x28, 0x00]), str(6, m.data)])
  const len = Buffer.alloc(4)
  len.writeUInt32BE(body.length)
  return Buffer.concat([len, body])
}

export function decodeCast(body: Buffer): CastMsg {
  const m: CastMsg = { source: '', destination: '', namespace: '', data: '' }
  let i = 0
  const readVarint = () => {
    let n = 0, shift = 0, b: number
    do {
      b = body[i++]
      n += (b & 0x7f) * 2 ** shift
      shift += 7
    } while (b & 0x80 && i < body.length)
    return n
  }
  while (i < body.length) {
    const key = readVarint()
    const field = key >>> 3, wire = key & 7
    if (wire === 0) readVarint()
    else if (wire === 2) {
      const len = readVarint()
      const s = body.subarray(i, i + len).toString('utf8')
      i += len
      if (field === 2) m.source = s
      else if (field === 3) m.destination = s
      else if (field === 4) m.namespace = s
      else if (field === 6) m.data = s
    } else break // unknown wire type: stop rather than misparse
  }
  return m
}

/** Splits a TCP stream into length-prefixed messages */
export function frameReader(onMessage: (m: CastMsg) => void) {
  let buf = Buffer.alloc(0)
  return (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) {
      const n = buf.readUInt32BE(0)
      onMessage(decodeCast(buf.subarray(4, 4 + n)))
      buf = buf.subarray(4 + n)
    }
  }
}

/* ---------- mDNS ---------- */

export const GOOGLECAST = '_googlecast._tcp.local'

/** One-shot PTR query (sent from a random port, so devices answer by unicast) */
export function mdnsQuery(name = GOOGLECAST): Buffer {
  const labels = name.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)]))
  return Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]), ...labels, Buffer.from([0, 0, 12, 0, 1])])
}

/** Friendly name (TXT fn=), model (md=) and port (SRV) from a response */
export function parseMdns(b: Buffer): { name?: string; model?: string; port?: number; cast: boolean } {
  const out: { name?: string; model?: string; port?: number; cast: boolean } = { cast: b.includes('_googlecast') }
  if (b.length < 12) return out
  const skipName = (i: number) => {
    while (i < b.length) {
      const l = b[i]
      if (l === 0) return i + 1
      if (l >= 0xc0) return i + 2
      i += l + 1
    }
    return i
  }
  let i = 12
  for (let q = b.readUInt16BE(4); q > 0; q--) i = skipName(i) + 4
  const records = b.readUInt16BE(6) + b.readUInt16BE(8) + b.readUInt16BE(10)
  for (let r = 0; r < records && i + 10 <= b.length; r++) {
    i = skipName(i)
    const type = b.readUInt16BE(i)
    const len = b.readUInt16BE(i + 8)
    const start = i + 10
    if (type === 16) {
      for (let j = start; j < start + len; ) {
        const s = b.subarray(j + 1, j + 1 + b[j]).toString('utf8')
        j += b[j] + 1
        if (s.startsWith('fn=')) out.name = s.slice(3)
        if (s.startsWith('md=')) out.model = s.slice(3)
      }
    } else if (type === 33 && len >= 6) out.port = b.readUInt16BE(start + 4)
    i = start + len
  }
  return out
}
