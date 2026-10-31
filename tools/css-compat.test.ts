import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cssCompat, oklchToRgb } from './css-compat.mts'

test('oklch converts to sRGB', () => {
  assert.deepEqual(oklchToRgb(0.637, 0.237, 25.331), [251, 44, 54]) // Tailwind red-500 ≈ #fb2c36
  assert.deepEqual(oklchToRgb(1, 0, 0), [255, 255, 255])
})

test('color-mix, layers, supports and transforms are lowered', () => {
  const css = `@layer theme, base;@layer theme{:root{--color-red-500:oklch(63.7% .237 25.331)}}@layer utilities{.a{color:var(--fg)}@supports (color:color-mix(in lab,red,red)){.a{color:color-mix(in oklab,var(--fg)60%,transparent)}}.b{background:color-mix(in oklab,var(--color-red-500) 90%,transparent)}.c{--tw-scale-x:110%;scale:var(--tw-scale-x) var(--tw-scale-y)}.d{mask-image:linear-gradient(red,blue)}.e{scale:.97}}`
  const out = cssCompat(css)
  for (const bad of ['@layer', '@supports', 'color-mix', 'oklch', 'scale:']) assert.ok(!out.includes(bad), `${bad} left in: ${out}`)
  assert.ok(out.includes('color:rgb(var(--fg-rgb) / 60%)'))
  assert.ok(out.includes('background:rgb(251 44 54 / 90%)'))
  assert.ok(out.includes('--tw-scale-x:1.1'))
  assert.ok(out.includes('-webkit-mask-image:linear-gradient(red,blue)'))
  assert.ok(out.includes('--tw-scale-x:.97;--tw-scale-y:.97;transform:'))
})
