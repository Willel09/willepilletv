import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pick } from './nav.ts'

const r = (left: number, top: number, width = 176, height = 264) => ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect
// two poster rows, cards 196 px apart; the lower row is scrolled further right than the upper one
const upper = [0, 1, 2, 3, 4, 5].map((i) => r(56 + i * 196, 100))
const lower = [0, 1, 2, 3, 4, 5].map((i) => r(56 - 98 + i * 196, 500))

test('Up goes to the card straight above, not to a nearer-centred one elsewhere', () => {
  const from = lower[3] // x 548..724
  const menu = r(600, 10, 120, 40) // a menu button closer in centre distance but far above
  const i = pick(from, [...upper, menu], 'up')
  assert.ok(i >= 0 && i < 6)
  const got = upper[i]
  assert.ok(got.right > from.left && got.left < from.right, 'overlaps horizontally')
})

test('Left/Right stay in the row; at the row end nothing aligned means nearest elsewhere only as fallback', () => {
  assert.equal(pick(upper[2], [...upper, ...lower], 'right'), 3)
  assert.equal(pick(upper[2], [...upper, ...lower], 'left'), 1)
})

test('Up from the top row with nothing aligned falls back to the nearest thing above (the menu)', () => {
  const tabs = [r(650, 10, 100, 40), r(760, 10, 100, 40)]
  assert.equal(pick(r(56, 300, 120, 50), tabs, 'up'), 0)
  assert.equal(pick(r(56, 300, 120, 50), tabs, 'down'), -1)
})

test('Up from a row lands on the level in between (title image buttons), not on the aligned menu further up', () => {
  const card = r(644, 600)
  const heroButtons = [r(56, 400, 114, 52), r(182, 400, 150, 52), r(344, 400, 52, 52)]
  const menuTab = r(638, 20, 90, 40) // straight above the card, but further away
  const i = pick(card, [menuTab, ...heroButtons], 'up')
  assert.equal(i, 3, 'the hero button nearest sideways')
})

test('Right at the end of a grid row does nothing (no jump to the profile button)', () => {
  const lastCard = r(1020, 188, 220, 330)
  const profile = r(1224, 22, 36, 36)
  const nextRowFirst = r(56, 560, 220, 330)
  assert.equal(pick(lastCard, [profile, nextRowFirst], 'right'), -1)
})
