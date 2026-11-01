// Spatial navigation: arrow keys move focus like a TV remote. Overlays mark themselves with
// data-nav-scope to trap focus inside.
//
// Rules that make it predictable on a TV:
//  - Up/Down go to what is straight above/below (same column), Left/Right stay in the same row; only
//    when nothing lines up does focus jump to the nearest thing in that direction (e.g. up to the menu).
//  - The focused row is scrolled to the middle of the screen, so it never ends up behind the menu bar.
//  - Closing an overlay (Back) puts focus back where it was; a fresh screen starts on its main content.

type Dir = 'up' | 'down' | 'left' | 'right'
const KEYS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([type=hidden]):not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

const isText = (el: Element) =>
  (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'range'].includes(el.type)) || el instanceof HTMLTextAreaElement

interface Score {
  /** distance to the next level in that direction (0 = touching) */
  gap: number
  /** sideways distance between the two (0 = they overlap, i.e. line up) */
  side: number
  centre: number
}

/** Where b lies relative to a in direction dir, or null if it isn't in that direction */
export function score(a: DOMRect, b: DOMRect, dir: Dir): Score | null {
  const acx = a.left + a.width / 2, acy = a.top + a.height / 2
  const bcx = b.left + b.width / 2, bcy = b.top + b.height / 2
  const across = (lo1: number, hi1: number, lo2: number, hi2: number) => Math.max(0, Math.max(lo1, lo2) - Math.min(hi1, hi2))
  switch (dir) {
    case 'up':
      if (bcy >= acy - 1 || b.top >= a.top) return null
      return { gap: Math.max(0, a.top - b.bottom), side: across(a.left, a.right, b.left, b.right), centre: Math.abs(acx - bcx) }
    case 'down':
      if (bcy <= acy + 1 || b.bottom <= a.bottom) return null
      return { gap: Math.max(0, b.top - a.bottom), side: across(a.left, a.right, b.left, b.right), centre: Math.abs(acx - bcx) }
    case 'left':
      if (bcx >= acx - 1 || b.left >= a.left) return null
      return { gap: Math.max(0, a.left - b.right), side: across(a.top, a.bottom, b.top, b.bottom), centre: Math.abs(acy - bcy) }
    case 'right':
      if (bcx <= acx + 1 || b.right <= a.right) return null
      return { gap: Math.max(0, b.left - a.right), side: across(a.top, a.bottom, b.top, b.bottom), centre: Math.abs(acy - bcy) }
  }
}

/**
 * Where focus goes: among the things on the nearest level in that direction (the next row up/down,
 * the next column left/right), the one that lines up best. Something lined up but further away
 * (the menu bar above the big title image) never wins over the level in between.
 */
export function pick(a: DOMRect, rects: DOMRect[], dir: Dir): number {
  // Left/Right only move within what lines up (the same row); at the end of a row nothing happens,
  // instead of jumping to whatever happens to be further right (like the profile button)
  const sideways = dir === 'left' || dir === 'right'
  const scores = rects.map((r) => {
    const s = score(a, r, dir)
    return s && sideways && s.side > 0 ? null : s
  })
  let nearest = Infinity
  for (const s of scores) if (s && s.gap < nearest) nearest = s.gap
  if (nearest === Infinity) return -1
  // the level: everything within a little of the nearest gap (items in a row aren't always pixel-equal)
  const level = nearest + 40
  let best = -1, bestSide = Infinity, bestCentre = Infinity
  scores.forEach((s, i) => {
    if (!s || s.gap > level) return
    if (s.side < bestSide || (s.side === bestSide && s.centre < bestCentre)) (best = i), (bestSide = s.side), (bestCentre = s.centre)
  })
  return best
}

const visible = (el: HTMLElement) => el.tabIndex >= 0 && el.offsetWidth > 0 && el.offsetHeight > 0

export function initSpatialNav() {
  const tv = () => document.documentElement.dataset.device === 'tv'
  // where focus was outside any overlay, to return to it when the overlay closes
  let lastOutside: HTMLElement | null = null
  // last focused element per group, to come back to it
  const lastIn = new WeakMap<Element, HTMLElement>()
  let lastFocused: HTMLElement | null = null
  const onFocus = (e: FocusEvent) => {
    const t = e.target as HTMLElement
    if (!(t instanceof HTMLElement)) return
    lastFocused = t
    const sc = t.closest('[data-nav-scope]')
    if (sc) lastIn.set(sc, t)
    else lastOutside = t
    const g = t.closest('[data-nav-group]')
    if (g) lastIn.set(g, t)
  }

  const onKey = (e: KeyboardEvent) => {
    const dir = KEYS[e.key]
    if (!dir || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
    const active = document.activeElement as HTMLElement | null
    if (active && (active.closest('[data-nav-ignore]') || (isText(active) && (dir === 'left' || dir === 'right')))) return
    const scopes = document.querySelectorAll<HTMLElement>('[data-nav-scope]')
    const scope: ParentNode = scopes[scopes.length - 1] ?? document
    e.preventDefault()

    if (!active || active === document.body || !(scope as Node).contains(active)) {
      // back from an overlay: where we were; otherwise the screen's main content, not the menu bar
      if (!scopes.length && lastOutside?.isConnected && visible(lastOutside)) return void lastOutside.focus()
      const main = scopes.length ? scope : document.querySelector('main') ?? document
      const first = main.querySelector<HTMLElement>('[data-nav-default]:not([disabled])') ?? [...main.querySelectorAll<HTMLElement>(FOCUSABLE)].find(visible)
      return void first?.focus()
    }

    const items = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el !== active && visible(el))
    // A group (category list, info panel) counts as one target and is entered at its entry point or where
    // you last were in it: Left from the channel list goes to the selected category, not the nearest one
    const here = active.closest('[data-nav-group]')
    const targets: { el: HTMLElement; group?: HTMLElement }[] = []
    const groups = new Set<Element>()
    for (const el of items) {
      const g = el.closest<HTMLElement>('[data-nav-group]')
      if (!g || g === here) targets.push({ el })
      else if (!groups.has(g)) groups.add(g), targets.push({ el, group: g })
    }
    const i = pick(active.getBoundingClientRect(), targets.map((t) => (t.group ?? t.el).getBoundingClientRect()), dir)
    if (i < 0) return
    let best = targets[i].el
    const g = targets[i].group
    if (g) {
      const inside = items.filter((el) => g.contains(el))
      const last = lastIn.get(g)
      const entry = g.querySelector<HTMLElement>('[data-nav-entry]')
      if (last && last.isConnected && visible(last) && g.contains(last)) best = last
      else if (entry && visible(entry)) best = entry
      else best = inside[Math.max(0, pick(active.getBoundingClientRect(), inside.map((el) => el.getBoundingClientRect()), dir))] ?? best
    }
    best.focus({ preventScroll: true })
    if (tv())
      // TVs: rows move to the middle of the screen (never under the menu bar), and jump instead of gliding
      best.scrollIntoView({ block: dir === 'up' || dir === 'down' ? 'center' : 'nearest', inline: 'nearest', behavior: 'auto' })
    else best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }
  // TVs: when an overlay closes, its focused button disappears and focus falls to the page; put it back at once
  const mo = new MutationObserver(() => {
    // only when the focused element was removed (an overlay closed), not after a deliberate blur
    if (!tv() || document.activeElement !== document.body || !lastFocused || lastFocused.isConnected) return
    lastFocused = null
    const scopes = document.querySelectorAll<HTMLElement>('[data-nav-scope]')
    const top = scopes[scopes.length - 1]
    // back to where you were on the layer that is now on top (e.g. Play on the film page), or on the page
    const back = top ? lastIn.get(top) ?? top.querySelector<HTMLElement>('[data-nav-default]:not([disabled])') : lastOutside
    if (back?.isConnected && visible(back)) back.focus({ preventScroll: true })
  })
  mo.observe(document.body, { childList: true, subtree: true })
  window.addEventListener('keydown', onKey)
  window.addEventListener('focusin', onFocus)
  return () => {
    mo.disconnect()
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('focusin', onFocus)
  }
}
