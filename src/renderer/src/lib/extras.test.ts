import assert from 'node:assert/strict'
import { test } from 'node:test'

// the helpers read localStorage: a tiny in-memory one
const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v)
}
const { addWatch, readWatch, summarize, dayKey } = await import('./stats.ts')
const { recordSkip, introOf, inIntro, isIntroSkip } = await import('./intro.ts')
const { pickVersion, heightOf } = await import('./quality.ts')

test('stats: totals by window, streak, best weekday and top titles', () => {
  const now = new Date(2026, 10, 25, 20, 0).getTime() // Wed 25 Nov 2026
  const day = 86400_000
  for (const back of [0, 1, 2, 5, 40]) addWatch('p', 3600, { id: back === 40 ? 'old' : 'a', name: back === 40 ? 'Old' : 'Show A' }, now - back * day)
  addWatch('p', 600, undefined, now) // live TV: days only
  const s = summarize(readWatch('p'), now)
  assert.equal(s.week, 4 * 3600 + 600)
  assert.equal(s.month, 4 * 3600 + 600)
  assert.equal(s.year, 5 * 3600 + 600)
  assert.equal(s.streak, 3) // today, yesterday, the day before; the 5-days-ago day is cut off by a gap
  assert.equal(s.best, 5) // Friday: 5 and 40 days back are both Fridays (7200 s) and beat Wednesday (4200 s)
  assert.deepEqual(s.top.map((t) => t.name), ['Show A', 'Old'])
  assert.equal(s.top[0].secs, 4 * 3600)
})

test('stats: a streak survives an empty today, and a day under a minute does not count', () => {
  const now = new Date(2026, 10, 25, 9, 0).getTime()
  addWatch('q', 1800, undefined, now - 86400_000)
  addWatch('q', 30, undefined, now) // too little
  assert.equal(summarize(readWatch('q'), now).streak, 1)
  assert.equal(dayKey(new Date(2026, 0, 5).getTime()), '2026-01-05')
})

test('intro: only deliberate early skips are learned, and the window is the middle of them', () => {
  assert.equal(isIntroSkip(10, 20), false) // a 10 s hop is not an intro skip
  assert.equal(isIntroSkip(900, 1000), false) // not early in the episode
  assert.equal(introOf('s1'), null)
  recordSkip('s1', 60, 150)
  recordSkip('s1', 64, 154)
  recordSkip('s1', 58, 149)
  recordSkip('s1', 3000, 3100) // ignored
  const w = introOf('s1')!
  assert.deepEqual(w, { from: 60, to: 150 })
  assert.equal(inIntro(w, 40), false)
  assert.equal(inIntro(w, 56), true)
  assert.equal(inIntro(w, 146), true)
  assert.equal(inIntro(w, 148), false)
  assert.equal(inIntro(null, 100), false)
})

test('quality: the best copy not above the wish, else the lowest above; auto keeps the first', () => {
  const v = [{ label: 'SE-4K' }, { label: 'EN · 1080P' }, { label: 'EN · 720P' }, { label: 'Action' }]
  assert.equal(heightOf('SE-4K'), 2160)
  assert.equal(pickVersion(v, 'auto'), 0)
  assert.equal(pickVersion(v, '4k'), 0)
  assert.equal(pickVersion(v, '1080p'), 1)
  assert.equal(pickVersion(v, '720p'), 2)
  assert.equal(pickVersion([{ label: '4K' }, { label: '1080P' }], '720p'), 1) // nothing at or under 720: the lowest above
  assert.equal(pickVersion([{ label: 'x' }, { label: 'y' }], '1080p'), 0) // no stated quality: first copy
  assert.equal(pickVersion(undefined, '720p'), 0)
})
