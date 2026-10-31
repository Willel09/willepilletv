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

import { legacyCompat, legacyLeftovers, lowerSelector } from './css-compat.mts'

test('selectors without :is/:where for Chromium 76', () => {
  assert.deepEqual(lowerSelector('abbr:where([title])'), ['abbr[title]'])
  assert.deepEqual(lowerSelector('.group-hover\\:h-2:is(:where(.group):hover *)'), ['.group:hover .group-hover\\:h-2'])
  assert.deepEqual(lowerSelector('.peer-x:is(:where(.peer):checked ~ *)'), ['.peer:checked~.peer-x'])
  assert.deepEqual(lowerSelector('input:where([type=button],[type=reset])'), ['input[type=button]', 'input[type=reset]'])
  assert.deepEqual(lowerSelector(':where(.space-y-2>:not(:last-child))'), ['.space-y-2>:not(:last-child)'])
  assert.deepEqual(lowerSelector('a:not(.b,.c)'), ['a:not(.b):not(.c)'])
  assert.deepEqual(lowerSelector('[hidden]:where(:not([hidden=until-found]))'), ['[hidden]:not([hidden=until-found])'])
})

test('legacy lowering leaves nothing Chromium 76 cannot parse', () => {
  const css = `.inset-0{inset:calc(var(--spacing) * 0)}.inset-x-0{inset-inline:0}.px-4{padding-inline:calc(var(--spacing) * 4)}.mx-auto{margin-inline:auto}abbr:where([title]){text-decoration:underline}.gap-5{gap:calc(var(--spacing) * 5)}.aspect-video{aspect-ratio:16/9}:focus-visible{outline:2px solid red}@media (hover:hover){.g\\:o:is(:where(.group):hover *){opacity:1}}`
  const out = legacyCompat(css)
  assert.deepEqual(legacyLeftovers(out), [])
  assert.ok(out.includes('.inset-0{top:calc(var(--spacing) * 0);right:calc(var(--spacing) * 0);bottom:calc(var(--spacing) * 0);left:calc(var(--spacing) * 0)}'))
  assert.ok(out.includes('padding-left:calc(var(--spacing) * 4);padding-right:calc(var(--spacing) * 4)'))
  assert.ok(out.includes('.group:hover .g\\:o{opacity:1}'))
  assert.ok(out.includes('[data-device=tv] :focus{outline:2px solid red}'))
  assert.ok(out.includes('@supports not (aspect-ratio:1/1){'))
  assert.ok(out.includes('.gap-5:not(.grid):not(.inline-grid):not(.flex-col)>*+*{margin-left:calc(var(--spacing) * 5)}'))
  assert.ok(out.includes('padding-bottom:56.2500%'))
})
