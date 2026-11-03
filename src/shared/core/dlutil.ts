// Pure helpers of the download manager (src/main/downloads.ts), kept apart so they can be tested without Electron.

export const TYPES: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', mov: 'video/quicktime', avi: 'video/x-msvideo', ts: 'video/mp2t', jpg: 'image/jpeg' }
export const NAME = /^[a-f0-9]{16}\.[a-z0-9]{2,5}$/

/** Why a server said no, in words */
export function httpProblem(code: number): string {
  if (code === 401 || code === 403) return `The provider refused the download (HTTP ${code}). Your account may not allow downloads, or it is already streaming on the most devices it allows.`
  if (code === 404) return 'This file is not served to your account (HTTP 404).'
  if (code === 458 || code === 509 || code === 429) return `The provider is limiting connections (HTTP ${code}). Stop watching on other devices and resume.`
  if (code >= 500) return `The provider's server had a problem (HTTP ${code}). Resume in a moment.`
  return `The provider answered HTTP ${code}.`
}

export const extOf = (url: string) => {
  const e = url.split(/[?#]/)[0].match(/\.([a-z0-9]{2,4})$/i)?.[1].toLowerCase()
  return e && TYPES[e] && e !== 'jpg' ? e : 'mp4'
}

/** The parts of a Range header: from, to (inclusive) of a file of `size` bytes; null = not satisfiable */
export function parseRange(header: string | null, size: number): { start: number; end: number; partial: boolean } | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/)
  if (!m || (m[1] === '' && m[2] === '')) return size ? { start: 0, end: size - 1, partial: false } : null
  let start: number, end: number
  if (m[1] === '') {
    start = Math.max(0, size - +m[2]) // the last n bytes
    end = size - 1
  } else {
    start = +m[1]
    end = m[2] === '' ? size - 1 : Math.min(+m[2], size - 1)
  }
  return start > end || start >= size ? null : { start, end, partial: true }
}
