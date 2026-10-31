import { net } from 'electron'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { gunzipSync } from 'zlib'

const FRIENDLY: [RegExp, string][] = [
  [/ERR_NAME_NOT_RESOLVED|ENOTFOUND/, 'Server not found. Check the address for typos.'],
  [/ERR_CONNECTION_REFUSED|ECONNREFUSED/, 'The server refused the connection. Check the port.'],
  [/ERR_CONNECTION_(TIMED_OUT|RESET|CLOSED)|ETIMEDOUT|ECONNRESET/, 'The connection dropped. The server may be down.'],
  [/ERR_INTERNET_DISCONNECTED/, 'You appear to be offline.'],
  [/ERR_CERT|SSL/, 'The server has an invalid security certificate.'],
  [/TimeoutError|aborted/i, 'The server took too long to respond.']
]

function friendly(e: unknown, url: string): Error {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e)
  const hit = FRIENDLY.find(([re]) => re.test(msg))
  let host = url
  try { host = new URL(url).host } catch { /* local path */ }
  return new Error(`${hit ? hit[1] : msg} (${host})`)
}

const decode = (b: Buffer) => (b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b).toString('utf8')

/** Fetch text from a URL or local file; transparently gunzips .gz guides. Runs in main, so no CORS. */
export async function getText(url: string, ua: string, timeoutMs = 180_000): Promise<string> {
  if (!/^https?:\/\//i.test(url)) {
    try {
      return decode(await readFile(url.startsWith('file:') ? fileURLToPath(url) : url))
    } catch (e) {
      throw new Error(`Could not read file: ${(e as Error).message}`)
    }
  }
  let res: Response
  try {
    res = await net.fetch(url, { headers: { 'User-Agent': ua, Accept: '*/*' }, signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    throw friendly(e, url)
  }
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? ' Access denied: check your login or subscription.' : res.status === 404 ? ' Not found: check the URL.' : ''
    throw new Error(`Server replied ${res.status} ${res.statusText}.${hint}`)
  }
  return decode(Buffer.from(await res.arrayBuffer()))
}

export async function getJson<T>(url: string, ua: string): Promise<T> {
  const text = await getText(url, ua, 90_000)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('The server did not return valid data. Is this an Xtream Codes server?')
  }
}
