import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { needsConversion, parseInfo, startTranscoder, streamArgs } from './transcode.ts'

const ffmpeg = createRequire(import.meta.url)('ffmpeg-static') as string

test('reads duration and codecs from ffmpeg output', () => {
  const t = `Duration: 01:32:10.50, start: 0.000000, bitrate: 9000 kb/s
  Stream #0:0: Video: hevc (Main 10), yuv420p10le
  Stream #0:1(eng): Audio: eac3, 48000 Hz, 5.1(side), fltp
  Stream #0:2(swe): Audio: aac (LC), 48000 Hz, stereo`
  assert.deepEqual(parseInfo(t), { duration: 5530.5, video: 'hevc', audio: ['eac3', 'aac'] })
  assert.equal(parseInfo('nothing').duration, 0)
})

test('only formats the player cannot decode are converted', () => {
  assert.equal(needsConversion(['aac', 'ac3']), true)
  assert.equal(needsConversion(['dts']), true)
  assert.equal(needsConversion(['aac', 'mp3', 'opus']), false)
})

test('seeking restarts at the position; HEVC gets the tag Chromium wants', () => {
  const a = streamArgs('http://x/f.mkv', 90, true, 'UA')
  assert.ok(a.join(' ').includes('-ss 90 -i http://x/f.mkv'))
  assert.ok(a.join(' ').includes('-tag:v hvc1'))
  assert.ok(!streamArgs('/tmp/f.mkv', 0, false).includes('-ss'))
})

test('a real file: Dolby sound in, AAC out, from the middle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumen-tc-'))
  const src = join(dir, 'in.mkv')
  execFileSync(ffmpeg, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=6:size=160x120:rate=25', '-f', 'lavfi', '-i', 'sine=duration=6', '-c:v', 'libx264', '-g', '25', '-pix_fmt', 'yuv420p', '-c:a', 'ac3', '-shortest', src])
  const t = await startTranscoder({ ffmpeg, ua: () => 'x', resolve: (s) => (s === 'ok' ? src : null) })
  try {
    const info = (await (await fetch(`${t.base}/info?src=ok`)).json()) as { duration: number; audio: string[] }
    assert.deepEqual(info.audio, ['ac3'])
    assert.ok(info.duration > 5.5 && info.duration < 6.5)
    assert.equal((await fetch(`${t.base}/info?src=nope`)).status, 404)
    assert.equal((await fetch(t.base.replace(/[a-f0-9]{32}$/, 'bad') + '/info?src=ok')).status, 404)
    const out = Buffer.from(await (await fetch(`${t.base}/stream.mp4?src=ok&ss=3`)).arrayBuffer())
    assert.equal(out.subarray(4, 8).toString(), 'ftyp')
    const f = join(dir, 'out.mp4')
    writeFileSync(f, out)
    const res = (() => {
      try {
        execFileSync(ffmpeg, ['-hide_banner', '-i', f], { stdio: 'pipe' })
        return ''
      } catch (e) {
        return String((e as { stderr: Buffer }).stderr)
      }
    })()
    const got = parseInfo(res)
    assert.deepEqual(got.audio, ['aac'])
    assert.equal(got.video, 'h264')
    // 3 s of the film from the middle (to the next keyframe or so)
    assert.ok(got.duration > 2 && got.duration < 4.5, `duration ${got.duration}`)
  } finally {
    t.close()
  }
})
