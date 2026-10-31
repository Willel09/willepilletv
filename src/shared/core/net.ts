/** Platform-provided text fetcher: Electron main uses net.fetch + fs, browsers/TV use fetch */
export type GetText = (url: string, timeoutMs?: number) => Promise<string>

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
