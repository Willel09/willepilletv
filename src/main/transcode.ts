// Dolby (AC3 / E-AC3), DTS and TrueHD sound for the built-in player, which can't decode them.
//
// A small server on this PC (127.0.0.1, with a secret in the address, so only Lumen's own window can use it) runs
// ffmpeg for one film: the picture is copied untouched (cheap), the sound becomes stereo AAC, and the result
// streams to the <video> as fragmented MP4. Starting costs a second or two; seeking restarts ffmpeg at the new
// position (the player adds that offset to its clock), so a jump outside what is already loaded takes a short wait. Electron-free, so it is tested in plain Node.
import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { createServer } from 'http'

export interface MediaInfo {
  /** seconds, 0 if unknown */
  duration: number
  video: string
  audio: string[]
}

/** What `ffmpeg -i` prints about a file (on stderr) */
export function parseInfo(text: string): MediaInfo {
  const d = text.match(/Duration: (\d+):(\d\d):(\d\d(?:\.\d+)?)/)
  return {
    duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0,
    video: text.match(/Video: (\w+)/)?.[1] ?? '',
    audio: [...text.matchAll(/Audio: (\w+)/g)].map((m) => m[1])
  }
}

/** Audio formats Chromium can't play */
export const needsConversion = (audio: string[]) => audio.some((a) => /^(ac3|eac3|dts|truehd|mlp)$/i.test(a))

export function streamArgs(input: string, ss: number, hevc: boolean, ua?: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'error',
    ...(ua && /^https?:/i.test(input) ? ['-user_agent', ua] : []),
    ...(ss > 0 ? ['-ss', String(ss)] : []),
    '-i', input,
    '-map', '0:v:0', '-map', '0:a?', '-sn', '-dn',
    '-c:v', 'copy', ...(hevc ? ['-tag:v', 'hvc1'] : []), // Chromium wants hvc1, not ffmpeg's default hev1
    '-c:a', 'aac', '-ac', '2', '-b:a', '192k',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1'
  ]
}

interface Options {
  ffmpeg: string
  ua: () => string
  /** the address or file ffmpeg may open for `src`, or null if it isn't allowed */
  resolve: (src: string) => string | null
}

export function startTranscoder(o: Options): Promise<{ base: string; close: () => void }> {
  const token = randomBytes(16).toString('hex')
  const running = new Set<ReturnType<typeof spawn>>()
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1')
    const [, tok, route] = u.pathname.split('/')
    const input = o.resolve(u.searchParams.get('src') ?? '')
    if (tok !== token || !input) return void res.writeHead(404).end()
    if (route === 'info') {
      // ffmpeg exits with an error here (no output file given), which is expected: the details are on stderr
      const p = spawn(o.ffmpeg, ['-hide_banner', ...(/^https?:/i.test(input) ? ['-user_agent', o.ua()] : []), '-i', input], { stdio: ['ignore', 'ignore', 'pipe'] })
      running.add(p)
      let err = ''
      p.stderr.on('data', (c) => (err += c))
      const timer = setTimeout(() => p.kill(), 20_000)
      p.on('close', () => {
        clearTimeout(timer)
        running.delete(p)
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(parseInfo(err)))
      })
      return
    }
    if (route !== 'stream.mp4') return void res.writeHead(404).end()
    const ss = Math.max(0, Number(u.searchParams.get('ss')) || 0)
    const p = spawn(o.ffmpeg, streamArgs(input, ss, u.searchParams.get('hevc') === '1', o.ua()), { stdio: ['ignore', 'pipe', 'ignore'] })
    running.add(p)
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' })
    p.stdout.pipe(res)
    // a seek or a closed player: stop converting
    res.on('close', () => p.kill())
    p.on('close', () => (running.delete(p), res.end()))
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      resolve({
        base: `http://127.0.0.1:${port}/${token}`,
        close: () => {
          for (const p of running) p.kill()
          server.close()
        }
      })
    })
  )
}
