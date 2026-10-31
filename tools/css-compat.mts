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

export const cssCompatPlugin = (): Plugin => ({
  name: 'lumen-css-compat',
  apply: 'build',
  generateBundle(_, bundle) {
    for (const f of Object.values(bundle)) if (f.type === 'asset' && f.fileName.endsWith('.css')) f.source = cssCompat(String(f.source))
  }
})
