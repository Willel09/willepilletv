// Spatial navigation: arrow keys move focus to the nearest focusable element in that direction,
// like a TV remote. Overlays mark themselves with data-nav-scope to trap focus inside.

type Dir = 'up' | 'down' | 'left' | 'right'
const KEYS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([type=hidden]):not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

const isText = (el: Element) =>
  (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'range'].includes(el.type)) || el instanceof HTMLTextAreaElement

export function score(a: DOMRect, b: DOMRect, dir: Dir): number {
  const acx = a.left + a.width / 2, acy = a.top + a.height / 2
  const bcx = b.left + b.width / 2, bcy = b.top + b.height / 2
  let primary: number, orth: number
  switch (dir) {
    case 'up': if (bcy >= acy - 1 || b.top >= a.top) return Infinity; primary = Math.max(0, a.top - b.bottom); orth = Math.abs(acx - bcx); break
    case 'down': if (bcy <= acy + 1 || b.bottom <= a.bottom) return Infinity; primary = Math.max(0, b.top - a.bottom); orth = Math.abs(acx - bcx); break
    case 'left': if (bcx >= acx - 1 || b.left >= a.left) return Infinity; primary = Math.max(0, a.left - b.right); orth = Math.abs(acy - bcy); break
    case 'right': if (bcx <= acx + 1 || b.right <= a.right) return Infinity; primary = Math.max(0, b.left - a.right); orth = Math.abs(acy - bcy); break
  }
  return primary + orth * 0.7
}

export function initSpatialNav() {
  const onKey = (e: KeyboardEvent) => {
    const dir = KEYS[e.key]
    if (!dir || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
    const active = document.activeElement as HTMLElement | null
    if (active && (active.closest('[data-nav-ignore]') || (isText(active) && (dir === 'left' || dir === 'right')))) return
    const scopes = document.querySelectorAll<HTMLElement>('[data-nav-scope]')
    const scope: ParentNode = scopes[scopes.length - 1] ?? document
    const items = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && el.offsetWidth > 0 && el.offsetHeight > 0)
    e.preventDefault()
    if (!active || active === document.body || !(scope as Node).contains(active)) {
      items[0]?.focus()
      return
    }
    const a = active.getBoundingClientRect()
    let best: HTMLElement | null = null
    let bestScore = Infinity
    for (const el of items) {
      if (el === active) continue
      const s = score(a, el.getBoundingClientRect(), dir)
      if (s < bestScore) (bestScore = s), (best = el)
    }
    if (best) {
      best.focus({ preventScroll: true })
      // TVs jump: smooth scrolling repaints the whole screen for every frame on a slow GPU
      best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: document.documentElement.dataset.device === 'tv' ? 'auto' : 'smooth' })
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
