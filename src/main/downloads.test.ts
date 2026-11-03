import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { Downloads } from './downloads.ts'
import type { DownloadsState } from '../shared/types.ts'

const BODY = Buffer.alloc(300_000, 7)
let mode: 'ok' | 'norange' | 'forbidden' | 'slow' = 'ok'

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (mode === 'forbidden') return void res.writeHead(403).end()
  const m = req.headers.range?.match(/bytes=(\d+)-(\d*)/)
  if (m && mode !== 'norange') {
    const start = +m[1]
    const end = m[2] ? +m[2] : BODY.length - 1
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${BODY.length}`, 'Content-Length': end - start + 1 })
    return void res.end(BODY.subarray(start, end + 1))
  }
  res.writeHead(200, { 'Content-Length': BODY.length })
  if (mode === 'slow') {
    // half now, the rest never: the test pauses in between
    res.write(BODY.subarray(0, 100_000))
    return
  }
  res.end(BODY)
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
after(() => server.closeAllConnections() || server.close())

const make = (limitGb = 0) => {
  const dir = mkdtempSync(join(tmpdir(), 'lumen-dl-'))
  const states: DownloadsState[] = []
  const d = new Downloads(join(dir, 'downloads'), () => 'test', () => limitGb, (s) => states.push(s))
  return { d, dir: join(dir, 'downloads'), states }
}
const req = (n: string) => ({ id: `movie:${n}`, kind: 'movie' as const, title: n, url: `${base}/${n}.mkv` })
const until = async (d: Downloads, id: string, ok: (s: string) => boolean) => {
  for (let i = 0; i < 200; i++) {
    const s = (await d.state()).items.find((x) => x.id === id)?.state
    if (s && ok(s)) return s
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`timed out waiting (now ${(await d.state()).items.find((x) => x.id === id)?.state})`)
}

test('downloads a whole file and reports its size', async () => {
  mode = 'ok'
  const { d, dir } = make()
  d.add([req('a')])
  await until(d, 'movie:a', (s) => s === 'done')
  const rec = (await d.state()).items[0]
  assert.equal(rec.size, BODY.length)
  assert.equal(rec.received, BODY.length)
  assert.match(rec.file, /^[a-f0-9]{16}\.mkv$/)
  assert.deepEqual(readFileSync(join(dir, rec.file)), BODY)
})

test('a paused download carries on from where it stopped', async () => {
  const { d, dir } = make()
  mode = 'slow'
  d.add([req('b')])
  await until(d, 'movie:b', (s) => s === 'downloading')
  for (let i = 0; i < 100 && (await d.state()).items[0].received < 100_000; i++) await new Promise((r) => setTimeout(r, 25))
  d.pause('movie:b')
  await until(d, 'movie:b', (s) => s === 'paused')
  const half = (await d.state()).items[0].received
  assert.ok(half >= 100_000 && half < BODY.length, `half: ${half}`)
  mode = 'ok'
  d.resume('movie:b')
  await until(d, 'movie:b', (s) => s === 'done')
  assert.deepEqual(readFileSync(join(dir, (await d.state()).items[0].file)), BODY)
})

test('a server that ignores Range gives a whole, correct file', async () => {
  const { d, dir } = make()
  mode = 'slow'
  d.add([req('c')])
  for (let i = 0; i < 100 && !((await d.state()).items[0]?.received >= 100_000); i++) await new Promise((r) => setTimeout(r, 25))
  d.pause('movie:c')
  await until(d, 'movie:c', (s) => s === 'paused')
  mode = 'norange'
  d.resume('movie:c')
  await until(d, 'movie:c', (s) => s === 'done')
  assert.deepEqual(readFileSync(join(dir, (await d.state()).items[0].file)), BODY)
})

test('a refusal is reported in words and can be retried', async () => {
  const { d } = make()
  mode = 'forbidden'
  d.add([req('d')])
  await until(d, 'movie:d', (s) => s === 'error')
  assert.match((await d.state()).items[0].error!, /refused the download \(HTTP 403\)/)
  mode = 'ok'
  d.resume('movie:d')
  await until(d, 'movie:d', (s) => s === 'done')
})

test('the size limit stops a download that would pass it', async () => {
  mode = 'ok'
  const { d } = make(0.0001) // ~107 KB
  d.add([req('e')])
  await until(d, 'movie:e', (s) => s === 'error')
  assert.match((await d.state()).items[0].error!, /download limit/)
})

test('downloads run one after another; removing deletes the file', async () => {
  mode = 'ok'
  const { d, dir } = make()
  d.add([req('f'), req('g')])
  await until(d, 'movie:g', (s) => s === 'done')
  assert.equal((await d.state()).items.filter((x) => x.state === 'done').length, 2)
  const file = (await d.state()).items[0].file
  await d.remove('movie:f')
  assert.equal(existsSync(join(dir, file)), false)
  assert.equal((await d.state()).items.length, 1)
})

test('only web addresses are accepted, and the list survives a restart (unfinished ones wait paused)', async () => {
  mode = 'ok'
  const { d, dir } = make()
  assert.equal(d.add([{ id: 'x', kind: 'movie', title: 'x', url: 'file:///etc/passwd' }]).added, 0)
  d.add([req('h')])
  await until(d, 'movie:h', (s) => s === 'done')
  d.save()
  const again = new Downloads(dir, () => 'test', () => 0, () => {})
  assert.equal((await again.state()).items[0].state, 'done')
  assert.equal(readdirSync(dir).filter((f) => f.endsWith('.mkv')).length, 1)
})
