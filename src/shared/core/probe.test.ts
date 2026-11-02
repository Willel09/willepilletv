import { test } from 'node:test'
import assert from 'node:assert/strict'
import { explainProbe, sniffCodecs } from './probe.ts'

const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255)

test('codecs are recognised in Matroska and MP4 headers', () => {
  assert.deepEqual(sniffCodecs(bytes('\x1aE\xdf\xa3...V_MPEGH/ISO/HEVC...A_EAC3...')), ['HEVC (H.265) video', 'Dolby Digital Plus (E-AC3) audio'])
  assert.deepEqual(sniffCodecs(bytes('....ftypisom....avc1....mp4a')), [])
  assert.deepEqual(sniffCodecs(bytes('stsd....hvc1....ac-3')), ['HEVC (H.265) video', 'Dolby Digital (AC3) audio'])
})

test('explanations people can act on', () => {
  assert.match(explainProbe({ status: 403, codecs: [], account: { status: 'Active', active: 1, max: 1 } }, 'desktop')!, /allows 1 connection and 1 is in use/)
  assert.match(explainProbe({ status: 200, codecs: [], account: { status: 'Expired' } }, 'tv')!, /"Expired"/)
  assert.match(explainProbe({ status: 206, codecs: ['DTS audio'] }, 'desktop')!, /DTS audio.*VLC/)
  assert.equal(explainProbe({ status: 206, codecs: ['DTS audio'] }, 'tv'), null) // TVs play it
  assert.match(explainProbe({ status: 200, type: 'text/html', codecs: [] }, 'desktop')!, /web page/)
  assert.equal(explainProbe({ status: 206, type: 'video/x-matroska', codecs: [] }, 'desktop'), null)
})
