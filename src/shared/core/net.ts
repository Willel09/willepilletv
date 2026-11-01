/** Platform-provided text fetcher: Electron main uses net.fetch + fs, browsers/TV use fetch */
export type GetText = (url: string, timeoutMs?: number) => Promise<string>

/** Streaming variant: text arrives in pieces as it downloads (TVs can't afford a 100 MB guide in one string) */
export type GetStream = (url: string, onText: (chunk: string) => void, timeoutMs?: number) => Promise<void>

export async function getJson<T>(get: GetText, url: string): Promise<T> {
  const text = await get(url, 90_000)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('The server did not return valid data. Is this an Xtream Codes server?')
  }
}

export const HTTP_HINT = (status: number, statusText: string) => {
  const hint = status === 401 || status === 403 ? ' Access denied: check your login or subscription.' : status === 404 ? ' Not found: check the URL.' : ''
  return `Server replied ${status} ${statusText}.${hint}`
}

/**
 * Hands over each object inside a top-level JSON array, or each value of a top-level object (some Xtream
 * panels send lists as {"1": {...}}), while the text streams in. A 100 MB list then never exists as one
 * string or as one array of raw provider objects.
 */
export class JsonArrayStream {
  private buf = ''
  private pos = 0
  private start = -1
  private depth = 0
  private inStr = false
  private esc = false
  private state: 'before' | 'array' | 'done' = 'before'
  private onItem: (item: unknown) => void
  constructor(onItem: (item: unknown) => void) {
    this.onItem = onItem
  }

  push(chunk: string) {
    if (this.state === 'done') return
    const b = this.buf + chunk
    let i = this.pos
    for (; i < b.length; i++) {
      const c = b.charCodeAt(i)
      if (this.inStr) {
        if (this.esc) this.esc = false
        else if (c === 92) this.esc = true // backslash
        else if (c === 34) this.inStr = false // "
        continue
      }
      if (this.state === 'before') {
        if (c === 91 || c === 123) this.state = 'array' // [ or {
        else if (c > 32) return void (this.state = 'done') // not JSON we can list
        continue
      }
      if (c === 34) this.inStr = true
      else if (c === 123 || c === 91) {
        if (this.depth++ === 0) this.start = i
      } else if (c === 125 || c === 93) {
        if (this.depth === 0) return void (this.state = 'done') // end of the outer container
        if (--this.depth === 0) {
          this.onItem(JSON.parse(b.slice(this.start, i + 1)))
          this.start = -1
        }
      }
    }
    // keep only the unfinished element
    const keep = this.start >= 0 ? this.start : i
    this.buf = b.slice(keep)
    this.pos = i - keep
    if (this.start >= 0) this.start = 0
  }
}
