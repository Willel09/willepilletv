import { test } from 'node:test'
import assert from 'node:assert/strict'
import { forYou, newest, topRated } from './recommend.ts'

const m = (id: string, group: string, extra = {}) => ({ kind: 'movie' as const, id, sourceId: 's', name: id, group, url: id, poster: 'p', ...extra })

test('For You favours categories you watch, skips what you have seen', () => {
  const pool = [m('a', 'Action', { rating: 6 }), m('b', 'Action', { rating: 8 }), m('c', 'Drama', { rating: 9 }), m('seen', 'Action')]
  const out = forYou([{ id: 'seen', group: 'Action' }], [pool]).map((x) => x.id)
  assert.deepEqual(out, ['b', 'a'])
  assert.deepEqual(forYou([], [pool]), [])
})

test('newest puts artwork first, topRated needs 7+', () => {
  assert.deepEqual(newest([m('old', 'G', { added: 1 }), m('new', 'G', { added: 9 }), m('noart', 'G', { added: 99, poster: undefined })]).map((x) => x.id), ['new', 'old', 'noart'])
  assert.deepEqual(topRated([[m('x', 'G', { rating: 6.9 }), m('y', 'G', { rating: 8 })]]).map((x) => x.id), ['y'])
})

test('top keeps the n best in one pass, ties in list order', async () => {
  const { top } = await import('./recommend.ts')
  const xs = Array.from({ length: 1000 }, (_, i) => ({ i, s: (i * 7919) % 1000 }))
  const want = [...xs].sort((a, b) => b.s - a.s || a.i - b.i).slice(0, 10).map((x) => x.i)
  assert.deepEqual(top([xs.slice(0, 500), xs.slice(500)], 10, (x) => x.s).map((x) => x.i), want)
  assert.deepEqual(top([[{ s: 1, i: 'a' }, { s: 1, i: 'b' }, { s: 2, i: 'c' }]], 2, (x) => x.s).map((x) => x.i), ['c', 'a'])
  assert.deepEqual(top([[1, 2, 3]], 5, (x) => (x === 2 ? null : x)), [3, 1])
})
