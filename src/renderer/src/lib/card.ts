// "Share as Card": a title card as a PNG (poster, name, year and rating), to paste into a chat.
import { api } from '../store'
import { artUrl } from './format'

export interface CardInfo {
  title: string
  /** e.g. "2019 · ★ 8.1 · Thriller" */
  meta: string
  plot?: string
  poster?: string
}

async function loadPoster(src: string | undefined): Promise<ImageBitmap | null> {
  const url = src && artUrl(src, 780)
  if (!url) return null
  try {
    // the Windows app fetches it (remote artwork usually has no CORS headers, which would stop the canvas export)
    const direct = api.fetchImage ? await api.fetchImage(url) : null
    const blob = direct ? await (await fetch(direct)).blob() : await (await fetch(url)).blob()
    return await createImageBitmap(blob)
  } catch {
    return null
  }
}

function lines(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > width && line) (out.push(line), (line = word))
    else line = next
  }
  if (line) out.push(line)
  if (out.length > max) {
    out.length = max
    out[max - 1] = out[max - 1].replace(/\s*\S*$/, '…')
  }
  return out
}

export async function makeCard(info: CardInfo): Promise<Blob> {
  const W = 1080, H = 1350
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  const hue = [...info.title].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, `hsl(${hue} 45% 22%)`)
  bg.addColorStop(1, '#09090d')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  const poster = await loadPoster(info.poster)
  const pw = 600, ph = 900, px = (W - pw) / 2, py = 80
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = 60
  ctx.shadowOffsetY = 30
  ctx.beginPath()
  ctx.roundRect(px, py, pw, ph, 36)
  ctx.fillStyle = `hsl(${hue} 40% 30%)`
  ctx.fill()
  ctx.restore()
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(px, py, pw, ph, 36)
  ctx.clip()
  if (poster) {
    // cover: fill the frame, crop the overflow
    const k = Math.max(pw / poster.width, ph / poster.height)
    ctx.drawImage(poster, px + (pw - poster.width * k) / 2, py + (ph - poster.height * k) / 2, poster.width * k, poster.height * k)
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.font = '800 320px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(info.title.trim()[0]?.toUpperCase() ?? '?', W / 2, py + ph / 2 + 110)
  }
  ctx.restore()

  ctx.textAlign = 'center'
  ctx.fillStyle = '#fff'
  ctx.font = '800 62px system-ui, sans-serif'
  const title = lines(ctx, info.title, W - 160, 2)
  title.forEach((l, i) => ctx.fillText(l, W / 2, 1075 + i * 70))
  const y = 1075 + title.length * 70
  ctx.fillStyle = 'rgba(255,255,255,0.65)'
  ctx.font = '500 32px system-ui, sans-serif'
  ctx.fillText(info.meta, W / 2, y + 10)
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.font = '700 26px system-ui, sans-serif'
  ctx.fillText('LUMEN', W / 2, H - 50)
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not draw the card'))), 'image/png'))
}

/** Copies the card to the clipboard; if that is not allowed, saves it as a file */
export async function shareCard(info: CardInfo): Promise<'copied' | 'saved'> {
  const blob = await makeCard(info)
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return 'copied'
  } catch {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${info.title.replace(/[^\w ]+/g, '').trim() || 'Lumen'}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    return 'saved'
  }
}
