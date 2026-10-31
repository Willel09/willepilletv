// Post-processes Tailwind 4 output so it also renders on older Chromium (Samsung Tizen 7+ = Chrome 94):
// no color-mix(), oklch(), @layer or individual translate/scale properties there.
// Runs on every production build so the Windows app exercises exactly the same CSS.
import type { Plugin } from 'vite'

/** Theme tokens that have an "r g b" twin (see index.css) */
const TRIPLETS: Record<string, string> = {
  fg: '--fg-rgb', 'color-fg': '--fg-rgb',
  base: '--base-rgb', 'color-bg': '--base-rgb',
  accent: '--accent-rgb', 'color-accent': '--accent-rgb'
}

export function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h), b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  return lin.map((x) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(x, 0) ** (1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, v)) * 255)
  }) as [number, number, number]
}

/** Replace `@rule ... { inner }` with `inner` for every match of `opener` (which must end at the `{`) */
function unwrap(css: string, opener: RegExp): string {
  let out = ''
  let i = 0
  for (const m of css.matchAll(opener)) {
    if (m.index! < i) continue // nested inside a block we already unwrapped
    const open = m.index! + m[0].length - 1
    let depth = 0, j = open
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++
      else if (css[j] === '}' && --depth === 0) break
    }
    out += css.slice(i, m.index) + unwrap(css.slice(open + 1, j), opener)
    i = j + 1
  }
  return out + css.slice(i)
}

const hexTriplet = (hex: string) => {
  let h = hex.slice(1)
  if (h.length <= 4) h = [...h].map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

export function cssCompat(css: string): string {
  // oklch() literals (Tailwind palette) -> rgb()
  css = css.replace(/oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?))?\s*\)/g, (_, l, pct, c, h, a, apct) => {
    const [r, g, b] = oklchToRgb(pct ? +l / 100 : +l, +c, +h)
    return a === undefined ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${apct ? +a / 100 : +a})`
  })

  const palette = new Map<string, string>([['color-white', '255 255 255'], ['color-black', '0 0 0']])
  for (const m of css.matchAll(/--(color-[\w-]+):\s*(#[0-9a-f]{3,8}|rgb\(\s*(\d+)\s+(\d+)\s+(\d+)[^)]*\))/gi))
    palette.set(m[1], m[3] ? `${m[3]} ${m[4]} ${m[5]}` : hexTriplet(m[2]))

  // color-mix(in <space>, var(--x) N%, transparent) -> rgb(r g b / N%)
  css = css.replace(/color-mix\(\s*in\s+[\w-]+\s*,\s*var\(--([\w-]+)\)\s*([\d.]+)%\s*,\s*transparent\s*\)/g, (m, name: string, p: string) => {
    const rgb = TRIPLETS[name] ? `var(${TRIPLETS[name]})` : palette.get(name)
    return rgb ? `rgb(${rgb} / ${p}%)` : m
  })

  // The color-mix rules are now plain rgb(): apply them unconditionally (they come after the fallbacks)
  css = unwrap(css, /@supports\s*\(\s*color\s*:\s*color-mix\(\s*in\s+lab\s*,\s*red\s*,\s*red\s*\)\s*\)\s*\{/g)

  // Cascade layers (Chrome 99+): output is already in layer order, so flattening keeps precedence
  css = css.replace(/@layer\s+[\w-]+(\s*,\s*[\w-]+)*\s*;/g, '')
  css = unwrap(css, /@layer\s+[\w-]+\s*\{/g)

  // translate/scale properties (Chrome 104+) -> one composite transform driven by the same variables
  const T = 'transform:translate(var(--tw-translate-x,0),var(--tw-translate-y,0)) scale(var(--tw-scale-x,1),var(--tw-scale-y,1))'
  css = css.replace(/([;{\s])translate:\s*var\(--tw-translate-x\)\s+var\(--tw-translate-y\)/g, `$1${T}`)
  css = css.replace(/([;{\s])scale:\s*var\(--tw-scale-x\)\s+var\(--tw-scale-y\)/g, `$1${T}`)
  css = css.replace(/([;{\s])scale:\s*(-?[\d.]+)(?=\s*[;}])/g, `$1--tw-scale-x:$2;--tw-scale-y:$2;${T}`)
  css = css.replace(/(--tw-scale-[xyz]:\s*)(-?[\d.]+)%/g, (_, p: string, n: string) => `${p}${+n / 100}`)

  // mask-image is prefixed before Chrome 120
  css = css.replace(/([;{\s])mask-image:([^;}]+)/g, '$1-webkit-mask-image:$2;mask-image:$2')
  return css
}


/* ===================== legacy mode: Chromium 76 (Samsung Tizen 6.0, 2021 TVs) ===================== */

/** split on top-level occurrences of `sep` (ignores parentheses/brackets/quotes) */
function splitTop(s: string, sep: (c: string) => boolean): string[] {
  const out: string[] = []
  let depth = 0, q = '', cur = ''
  for (const c of s) {
    if (q) (cur += c), c === q && (q = '')
    else if (c === '"' || c === "'") (q = c), (cur += c)
    else if (c === '(' || c === '[') depth++, (cur += c)
    else if (c === ')' || c === ']') depth--, (cur += c)
    else if (depth === 0 && sep(c)) out.push(cur), (cur = '')
    else cur += c
  }
  out.push(cur)
  return out
}

/** index of the ')' matching the '(' at `open` */
function closeParen(s: string, open: number): number {
  for (let i = open, d = 0; i < s.length; i++) {
    if (s[i] === '(') d++
    else if (s[i] === ')' && --d === 0) return i
  }
  return -1
}

/** Rewrite one selector without :is()/:where() (Chromium 88) and :not(a,b) lists. Returns 1+ selectors. */
export function lowerSelector(sel: string): string[] {
  // first :is(/:where( — or a :not( that holds a list (single-argument :not() is fine in Chromium 76)
  let found: { name: string; at: number; open: number; close: number; parts: string[] } | null = null
  for (const m of sel.matchAll(/:(is|where|not)\(/g)) {
    const open = m.index! + m[0].length - 1
    const close = closeParen(sel, open)
    if (close < 0) return [sel]
    const parts = splitTop(sel.slice(open + 1, close), (c) => c === ',').map((x) => x.trim())
    if (m[1] !== 'not' || parts.length > 1) {
      found = { name: m[1], at: m.index!, open, close, parts }
      break
    }
  }
  if (!found) return [sel]
  const { name, at, close, parts } = found
  const pre = sel.slice(0, at)
  const post = sel.slice(close + 1)

  if (name === 'not') return lowerSelector(pre + parts.map((x) => `:not(${x})`).join('') + post)
  if (parts.length > 1) return parts.flatMap((alt) => lowerSelector(`${pre}:is(${alt})${post}`))

  const content = parts[0]
  const tail = content.match(/^(.*?)\s*([ >~+])\s*\*$/)
  if (tail && /[^\s>~+]$/.test(pre)) {
    // Tailwind group/peer variants: X:is(ANCESTOR *) -> ANCESTOR X
    const cut = Math.max(pre.lastIndexOf(' '), pre.lastIndexOf('>'), pre.lastIndexOf('~'), pre.lastIndexOf('+')) + 1
    const comb = tail[2] === ' ' ? ' ' : tail[2]
    return lowerSelector(pre.slice(0, cut) + tail[1] + comb + pre.slice(cut) + post)
  }
  return lowerSelector(pre + content + post)
}

/** Apply `fn` to every style-rule selector list (skips at-rule preludes) */
function mapSelectors(css: string, fn: (list: string) => string): string {
  let out = '', start = 0, q = ''
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (q) { if (c === q) q = ''; continue }
    if (c === '"' || c === "'") { q = c; continue }
    if (c === '{') {
      const prelude = css.slice(start, i)
      out += prelude.trim().startsWith('@') ? prelude : fn(prelude)
      out += '{'
      start = i + 1
    } else if (c === '}' || c === ';') {
      out += css.slice(start, i + 1)
      start = i + 1
    }
  }
  return out + css.slice(start)
}

const LOGICAL: [RegExp, (v: string[]) => string][] = [
  [/(^|[;{\s])inset:([^;}]+)/g, (v) => { const [t, r = t, b = t, l = r] = v; return `top:${t};right:${r};bottom:${b};left:${l}` }],
  [/(^|[;{\s])inset-inline:([^;}]+)/g, ([a, b = a]) => `left:${a};right:${b}`],
  [/(^|[;{\s])inset-block:([^;}]+)/g, ([a, b = a]) => `top:${a};bottom:${b}`],
  [/(^|[;{\s])padding-inline:([^;}]+)/g, ([a, b = a]) => `padding-left:${a};padding-right:${b}`],
  [/(^|[;{\s])padding-block:([^;}]+)/g, ([a, b = a]) => `padding-top:${a};padding-bottom:${b}`],
  [/(^|[;{\s])margin-inline:([^;}]+)/g, ([a, b = a]) => `margin-left:${a};margin-right:${b}`],
  [/(^|[;{\s])margin-block:([^;}]+)/g, ([a, b = a]) => `margin-top:${a};margin-bottom:${b}`]
]

export function legacyCompat(css: string): string {
  // Tailwind's @property fallbacks are guarded by Safari/Firefox checks: make them unconditional
  css = unwrap(css, /@supports\s*\([^{]*margin-trim[^{]*\)\s*\{/g)

  // logical properties (Chromium 87) -> physical (Lumen is left-to-right only)
  for (const [re, f] of LOGICAL) css = css.replace(re, (_, lead: string, v: string) => lead + f(splitTop(v.trim(), (c) => c === ' ').filter(Boolean)))

  // :is()/:where()/:not(list) -> plain selectors
  css = mapSelectors(css, (list) => {
    if (!/:(is|where|not)\(/.test(list)) return list
    const sels = splitTop(list, (c) => c === ',').flatMap((x) => lowerSelector(x.trim()))
    return [...new Set(sels)].join(',')
  })

  const fallbacks: string[] = []
  // :focus-visible (Chromium 86): TVs have no mouse, so plain :focus is right there
  for (const m of css.matchAll(/(^|})([^{}@]*:focus-visible[^{}]*)\{([^{}]*)\}/g)) {
    const sels = splitTop(m[2], (c) => c === ',').map((x) => `[data-device=tv] ${x.trim().replace(/:focus-visible/g, ':focus')}`)
    fallbacks.push(`${sels.join(',')}{${m[3]}}`)
  }
  const old: string[] = []
  // flexbox gap (Chromium 84): sibling margins instead
  for (const m of css.matchAll(/(?:^|})\.([\w\\.\-\[\]\/%]+)\{(gap|column-gap|row-gap):([^;}]+)\}/g)) {
    const [, cls, prop, v] = m
    if (prop !== 'row-gap') old.push(`.${cls}:not(.grid):not(.inline-grid):not(.flex-col)>*+*{margin-left:${v}}`)
    if (prop !== 'column-gap') old.push(`.${cls}.flex-col>*+*{margin-top:${v}}`)
  }
  // aspect-ratio (Chromium 88): padding-box technique (images keep their intrinsic ratio)
  for (const m of css.matchAll(/(?:^|})\.([\w\\.\-\[\]\/%]+)\{aspect-ratio:\s*([\d.]+)\s*\/\s*([\d.]+)\}/g)) {
    const [, cls, w, h] = m
    old.push(`.${cls}:not(img){height:0;padding-bottom:${((+h / +w) * 100).toFixed(4)}%}`)
    old.push(`.${cls}:not(img):not(.absolute):not(.fixed){position:relative}`)
    old.push(`.${cls}:not(img)>:not(.absolute){position:absolute;top:0;left:0;width:100%;height:100%}`)
  }
  // @supports itself exists since Chromium 28; engines with aspect-ratio also have flex gap
  return css + fallbacks.join('') + (old.length ? `@supports not (aspect-ratio:1/1){${old.join('')}}` : '')
}

/** Anything still in the CSS that Chromium 76 can't parse. Used as a build guard for the TV package. */
export function legacyLeftovers(css: string): string[] {
  const checks: [string, RegExp][] = [
    [':is()/:where()', /:(is|where)\(/],
    ['logical shorthand', /(^|[;{\s])(inset|inset-inline|inset-block|padding-inline|padding-block|margin-inline|margin-block):/],
    ['@layer', /@layer/],
    ['min()/max()/clamp()', /(^|[^-\w])(min|max|clamp)\(/],
    ['oklch()', /oklch\(/],
    ['translate/scale/rotate property', /[;{](translate|scale|rotate):(?!initial)/]
  ]
  return checks.filter(([, re]) => re.test(css)).map(([n, re]) => `${n}: …${css.slice(Math.max(0, css.search(re) - 60), css.search(re) + 60)}…`)
}

export const cssCompatPlugin = (opts: { legacy?: boolean } = {}): Plugin => ({
  name: 'lumen-css-compat',
  apply: 'build',
  // run after Vite has emitted and minified the CSS (incl. the single file when cssCodeSplit is off)
  enforce: 'post',
  generateBundle(_, bundle) {
    for (const f of Object.values(bundle)) if (f.type === 'asset' && f.fileName.endsWith('.css')) f.source = opts.legacy ? legacyCompat(cssCompat(String(f.source))) : cssCompat(String(f.source))
  }
})
