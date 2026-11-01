export const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function duration(sec: number) {
  if (!isFinite(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec % 60), m = Math.floor((sec / 60) % 60), h = Math.floor(sec / 3600)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.round(m / 60)} h ago`
  return new Date(ms).toLocaleDateString()
}

/** Strip common IPTV prefixes like "EN | " or "|UK| " for nicer titles */
export { stripTag as cleanName } from '../../../shared/core/dedupe'

export const hue = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

/**
 * Many providers link TMDB artwork at its original size (often 2000×3000). A decoded image costs
 * width × height × 4 bytes, ~24 MB each, which is what runs a TV out of memory. Ask TMDB for a size
 * that fits instead; other hosts are left alone.
 */
export const artUrl = (src: string | undefined, width: 342 | 780 | 1280) =>
  src?.replace(/^(https?:\/\/image\.tmdb\.org\/t\/p\/)[^/]+\//, `$1w${width}/`)
