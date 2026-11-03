import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { join } from 'path'
import { Readable } from 'stream'
import { protocol } from 'electron'
import { NAME, parseRange, TYPES } from '../shared/core/dlutil.ts'

export const SCHEME = 'lumen-dl'
/** Before the app is ready: the scheme must be allowed to stream and be used as a media source */
export const registerScheme = () =>
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }])

/** lumen-dl://f/<file>: serves a downloaded video (or its poster) with Range support, and nothing else */
export function serveDownloads(dir: string) {
  protocol.handle(SCHEME, async (req) => {
    const name = new URL(req.url).pathname.replace(/^\//, '')
    if (!NAME.test(name)) return new Response('Not found', { status: 404 })
    const path = join(dir, name)
    let size: number
    try {
      size = (await stat(path)).size
    } catch {
      return new Response('Not found', { status: 404 })
    }
    const range = parseRange(req.headers.get('range'), size)
    if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    const body = createReadStream(path, { start: range.start, end: range.end })
    req.signal.addEventListener('abort', () => body.destroy())
    return new Response(Readable.toWeb(body) as unknown as ReadableStream, {
      status: range.partial ? 206 : 200,
      headers: {
        'Content-Type': TYPES[name.split('.').pop()!] ?? 'application/octet-stream',
        'Content-Length': String(range.end - range.start + 1),
        'Accept-Ranges': 'bytes',
        ...(range.partial ? { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` } : {}),
        'Access-Control-Allow-Origin': '*'
      }
    })
  })
}
