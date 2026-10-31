// Small shims for older TV browsers (Samsung Tizen 6.0 = Chromium 76). No-ops on modern engines.
/* eslint-disable @typescript-eslint/no-explicit-any */

const def = (obj: object, name: string, value: unknown) =>
  Object.defineProperty(obj, name, { value, writable: true, configurable: true, enumerable: false })

if (!(Array.prototype as any).at)
  def(Array.prototype, 'at', function (this: unknown[], i: number) {
    const n = Math.trunc(i) || 0
    return this[n < 0 ? n + this.length : n]
  })
if (!(Object as any).hasOwn) def(Object, 'hasOwn', (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k))
if (!(String.prototype as any).replaceAll)
  def(String.prototype, 'replaceAll', function (this: string, a: string | RegExp, b: string) {
    return typeof a === 'string' ? this.split(a).join(b) : this.replace(a, b)
  })

// Web Animations before Chromium 84 lack Animation.finished / commitStyles, which framer-motion uses
// for hardware-accelerated animations. Without Element.animate it falls back to JS-driven animations.
try {
  const probe = Element.prototype.animate && document.createElement('div').animate([], 0)
  if (probe && !('finished' in probe)) delete (Element.prototype as any).animate
  probe?.cancel()
} catch {
  /* ignore */
}
