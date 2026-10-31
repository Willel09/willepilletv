import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeCast, frameReader, mdnsQuery, parseMdns } from './castproto.ts'

test('cast messages survive framing, split across TCP chunks', () => {
  const msgs = [
    { source: 'sender-0', destination: 'receiver-0', namespace: 'urn:x-cast:com.google.cast.tp.connection', data: '{"type":"CONNECT"}' },
    { source: 'a', destination: 'b', namespace: 'n', data: JSON.stringify({ title: 'Ä'.repeat(300) }) } // >127 bytes: multi-byte varint
  ]
  const got: unknown[] = []
  const read = frameReader((m) => got.push(m))
  const all = Buffer.concat(msgs.map(encodeCast))
  for (let i = 0; i < all.length; i += 7) read(all.subarray(i, i + 7))
  assert.deepEqual(got, msgs)
})

test('mDNS: query is well-formed, response yields name/model/port', () => {
  const q = mdnsQuery()
  assert.equal(q.readUInt16BE(4), 1)
  assert.ok(q.includes('_googlecast'))
  // response: 1 answer PTR + TXT + SRV, names via compression pointer to the question
  const name = Buffer.concat([...'_googlecast._tcp.local'.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])])
  const rr = (type: number, data: Buffer) => Buffer.concat([Buffer.from([0xc0, 12]), Buffer.from([0, type, 0, 1, 0, 0, 0, 120, data.length >> 8, data.length & 255]), data])
  const txt = Buffer.concat(['id=abc', 'md=Google TV', 'fn=Living Room TV'].map((s) => Buffer.concat([Buffer.from([Buffer.byteLength(s)]), Buffer.from(s)])))
  const srv = Buffer.from([0, 0, 0, 0, 0x1f, 0x49, 0])
  const res = Buffer.concat([Buffer.from([0, 0, 0x84, 0, 0, 1, 0, 3, 0, 0, 0, 0]), name, Buffer.from([0, 12, 0, 1]), rr(12, Buffer.from([0xc0, 12])), rr(16, txt), rr(33, srv)])
  assert.deepEqual(parseMdns(res), { cast: true, name: 'Living Room TV', model: 'Google TV', port: 8009 })
})
