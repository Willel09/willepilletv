import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extOf, httpProblem, parseRange } from './dlutil.ts'

test('the file type comes from the address, mp4 when unsure', () => {
  assert.equal(extOf('http://s:80/movie/u/p/123.mkv'), 'mkv')
  assert.equal(extOf('http://s/movie/u/p/123.MP4?x=1'), 'mp4')
  assert.equal(extOf('http://s/stream/123'), 'mp4')
  assert.equal(extOf('http://s/x.exe'), 'mp4')
  assert.equal(extOf('http://s/x.jpg'), 'mp4')
})

test('Range: whole file, a span, an open end, the last bytes, and what cannot be served', () => {
  assert.deepEqual(parseRange(null, 1000), { start: 0, end: 999, partial: false })
  assert.deepEqual(parseRange('bytes=100-199', 1000), { start: 100, end: 199, partial: true })
  assert.deepEqual(parseRange('bytes=900-', 1000), { start: 900, end: 999, partial: true })
  assert.deepEqual(parseRange('bytes=0-5000', 1000), { start: 0, end: 999, partial: true })
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999, partial: true })
  assert.equal(parseRange('bytes=1000-', 1000), null)
  assert.equal(parseRange('bytes=500-100', 1000), null)
  assert.equal(parseRange(null, 0), null)
})

test('a refusal is explained, not just numbered', () => {
  assert.match(httpProblem(403), /refused/)
  assert.match(httpProblem(404), /not served to your account/)
  assert.match(httpProblem(458), /limiting connections/)
  assert.match(httpProblem(503), /server had a problem/)
})
