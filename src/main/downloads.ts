// Films and episodes saved on this PC for watching offline (Windows app).
//
// Files are plain video files in <userData>/downloads, one download at a time (providers allow few
// connections). A download can be paused and picked up later where it stopped (HTTP Range). The app plays them
// through the lumen-dl:// address (dlprotocol.ts), which understands Range, so seeking works like it does online.
// Electron's network stack is passed in (net.fetch), so this file runs, and is tested, in plain Node.
import { createHash } from 'crypto'
import { createWriteStream, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs'
import { stat, statfs, unlink } from 'fs/promises'
import { join } from 'path'
import { once } from 'events'
import { extOf, httpProblem, NAME } from '../shared/core/dlutil.ts'
import type { DownloadRec, DownloadRequest, DownloadsState } from '../shared/types.ts'

const GB = 1024 ** 3

export class Downloads {
  private items: DownloadRec[] = []
  private active: { id: string; ac: AbortController; then: 'paused' | 'removed' } | null = null
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private emitAt = 0
  private emitTimer: ReturnType<typeof setTimeout> | undefined

  readonly dir: string
  private ua: () => string
  private limitGb: () => number
  private emit: (s: DownloadsState) => void
  private fetch: typeof globalThis.fetch

  constructor(dir: string, ua: () => string, limitGb: () => number, emit: (s: DownloadsState) => void, fetchFn: typeof globalThis.fetch = globalThis.fetch) {
    ;(this.dir = dir), (this.ua = ua), (this.limitGb = limitGb), (this.emit = emit), (this.fetch = fetchFn)
    mkdirSync(dir, { recursive: true })
    try {
      this.items = (JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as DownloadRec[]).map((r) => ({
        ...r,
        // an app that was closed mid-download: waits for you to continue it (the provider may be in use elsewhere)
        state: r.state === 'downloading' || r.state === 'queued' ? 'paused' : r.state
      }))
    } catch {
      /* first start */
    }
    // files nothing refers to: left behind by a delete that Windows refused while the video was still open
    const known = new Set(this.items.flatMap((r) => [r.file, r.file.replace(/\.\w+$/, '.jpg')]))
    try {
      for (const f of readdirSync(dir)) if (NAME.test(f) && !known.has(f)) void unlink(join(dir, f)).catch(() => {})
    } catch {
      /* unreadable folder: nothing to clean */
    }
  }

  /* ---------- state ---------- */

  private used = () => this.items.reduce((n, r) => n + r.received, 0)

  async state(): Promise<DownloadsState> {
    let free: number | null = null
    try {
      const s = await statfs(this.dir)
      free = s.bavail * s.bsize
    } catch {
      /* not every file system says */
    }
    return { items: this.items, limit: this.limitGb() * GB, used: this.used(), free }
  }

  /** Pushes the state to the window; progress is at most a few times a second */
  private changed(now = true) {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), 800)
    const push = () => {
      this.emitAt = Date.now()
      void this.state().then(this.emit)
    }
    if (now || Date.now() - this.emitAt > 500) return push()
    this.emitTimer ??= setTimeout(() => ((this.emitTimer = undefined), push()), 500)
  }

  save() {
    clearTimeout(this.saveTimer)
    const tmp = join(this.dir, 'index.json.tmp')
    writeFileSync(tmp, JSON.stringify(this.items))
    renameSync(tmp, join(this.dir, 'index.json'))
  }

  private get = (id: string) => this.items.find((r) => r.id === id)

  /* ---------- asking ---------- */

  add(reqs: DownloadRequest[]): { added: number; error?: string } {
    let added = 0
    for (const q of reqs) {
      if (typeof q.id !== 'string' || !q.id || q.id.length > 300 || typeof q.url !== 'string' || !/^https?:\/\//i.test(q.url)) continue
      const have = this.get(q.id)
      if (have) {
        // asked for again: carries on if it stopped; a finished one stays as it is
        if (have.state === 'paused' || have.state === 'error') (have.state = 'queued'), (have.error = undefined), added++
        continue
      }
      const file = `${createHash('sha1').update(q.id).digest('hex').slice(0, 16)}.${extOf(q.url)}`
      this.items.push({ id: q.id, kind: q.kind === 'episode' ? 'episode' : 'movie', title: String(q.title).slice(0, 300), subtitle: q.subtitle?.slice(0, 300), poster: q.poster, parentId: q.parentId, url: q.url, file, hasPoster: false, size: 0, received: 0, state: 'queued', addedAt: Date.now() })
      added++
      void this.fetchPoster(this.items[this.items.length - 1])
    }
    this.changed()
    this.pump()
    return { added }
  }

  pause(id: string) {
    const r = this.get(id)
    if (!r) return
    if (this.active?.id === id) return void ((this.active.then = 'paused'), this.active.ac.abort())
    if (r.state === 'queued') (r.state = 'paused'), this.changed()
  }

  resume(id: string) {
    const r = this.get(id)
    if (r && (r.state === 'paused' || r.state === 'error')) (r.state = 'queued'), (r.error = undefined), this.changed(), this.pump()
  }

  async remove(id: string) {
    const r = this.get(id)
    if (!r) return
    this.items = this.items.filter((x) => x !== r)
    if (this.active?.id === id) (this.active.then = 'removed'), this.active.ac.abort()
    this.changed()
    // Windows won't delete a file the player still has open: try again for a few seconds, the sweep at start
    // takes what is left
    for (const f of [r.file, r.file.replace(/\.\w+$/, '.jpg')])
      for (let i = 0; i < 6; i++) {
        try {
          await unlink(join(this.dir, f))
          break
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') break
          await new Promise((res) => setTimeout(res, 700))
        }
      }
    this.pump()
  }

  /** Sizes of the files at these addresses, without downloading them: asks for the first byte and reads the total */
  async sizes(urls: string[]): Promise<(number | null)[]> {
    const out: (number | null)[] = []
    for (const url of urls) {
      if (!/^https?:\/\//i.test(url)) {
        out.push(null)
        continue
      }
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 8000)
      try {
        const res = await this.fetch(url, { headers: { Range: 'bytes=0-0', 'User-Agent': this.ua() }, signal: ac.signal })
        const total = res.headers.get('content-range')?.match(/\/(\d+)$/)?.[1]
        const len = res.status === 200 ? res.headers.get('content-length') : null
        out.push(total ? +total : len ? +len : null)
        void res.body?.cancel().catch(() => {})
      } catch {
        out.push(null)
      } finally {
        clearTimeout(timer)
        ac.abort()
      }
    }
    return out
  }

  /* ---------- downloading ---------- */

  private pump() {
    if (this.active) return
    const next = this.items.find((r) => r.state === 'queued')
    if (next) void this.run(next)
  }

  private async fetchPoster(r: DownloadRec) {
    const src = r.poster?.startsWith('~') ? `https://image.tmdb.org/t/p/w342/${r.poster.slice(1)}` : r.poster?.replace(/^(https?:\/\/image\.tmdb\.org\/t\/p\/)[^/]+\//, '$1w342/')
    if (!src || !/^https?:\/\//i.test(src)) return
    try {
      const res = await this.fetch(src, { headers: { 'User-Agent': this.ua() } })
      if (!res.ok) return
      const bytes = Buffer.from(await res.arrayBuffer())
      if (bytes.length > 2_000_000 || !this.get(r.id)) return
      writeFileSync(join(this.dir, r.file.replace(/\.\w+$/, '.jpg')), bytes)
      r.hasPoster = true
      this.changed()
    } catch {
      /* the poster is a bonus: without it the title card is drawn instead */
    }
  }

  private async run(r: DownloadRec) {
    const ac = new AbortController()
    this.active = { id: r.id, ac, then: 'paused' }
    r.state = 'downloading'
    r.error = undefined
    this.changed()
    const path = join(this.dir, r.file)
    try {
      let have = 0
      try {
        have = (await stat(path)).size
      } catch {
        /* nothing yet */
      }
      r.received = have
      const res = await this.fetch(r.url, { headers: { 'User-Agent': this.ua(), ...(have ? { Range: `bytes=${have}-` } : {}) }, signal: ac.signal })
      if (res.status === 416 && r.size && have >= r.size) return this.finish(r)
      if (!res.ok || !res.body) {
        if (res.status === 416) (r.received = 0), await unlink(path).catch(() => {}) // a file that doesn't fit: start over
        throw new Error(httpProblem(res.status))
      }
      const partial = res.status === 206 && have > 0
      if (!partial) r.received = 0 // the server ignored Range (or this is a first start): from the top
      const total = res.headers.get('content-range')?.match(/\/(\d+)$/)?.[1] ?? (partial ? undefined : res.headers.get('content-length')) ?? undefined
      r.size = total ? +total : 0
      this.checkRoom(r)
      const out = createWriteStream(path, { flags: partial ? 'a' : 'w' })
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          if (!out.write(chunk)) await once(out, 'drain')
          r.received += chunk.length
          if (!r.size) this.checkRoom(r) // the size is unknown: the limit is watched as it grows
          this.changed(false)
        }
      } finally {
        out.end()
        await once(out, 'close').catch(() => {})
      }
      if (r.size && r.received < r.size) throw new Error('The connection ended before the whole file arrived. Resume to continue.')
      this.finish(r)
    } catch (e) {
      const then = this.active?.then
      if (ac.signal.aborted) {
        if (then === 'paused') r.state = 'paused'
      } else {
        r.state = 'error'
        r.error = (e as Error).message
      }
    } finally {
      this.active = null
      this.changed()
      this.pump()
    }
  }

  private finish(r: DownloadRec) {
    r.state = 'done'
    r.doneAt = Date.now()
    if (!r.size) r.size = r.received
  }

  /** Stops a download that would go over the limit the user set, or fill the disk */
  private checkRoom(r: DownloadRec) {
    const limit = this.limitGb() * GB
    const others = this.used() - r.received
    if (limit && others + Math.max(r.size, r.received) > limit)
      throw new Error(`The download limit (${this.limitGb()} GB) would be passed. Remove something you have watched, or raise the limit in Settings.`)
  }
}
