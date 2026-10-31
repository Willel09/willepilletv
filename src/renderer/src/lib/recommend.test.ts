import { test } from 'node:test'
import assert from 'node:assert/strict'
import { forYou, newest, topRated } from './recommend.ts'

const m = (id: string, group: string, extra = {}) => ({ kind: 'movie' as const, id, sourceId: 's', name: id, group, url: id, poster: 'p', ...extra })

test('For You favours categories you watch, skips what you have seen', () => {
  const pool = [m('a', 'Action', { rating: 6 }), m('b', 'Action', { rating: 8 }), m('c', 'Drama', { rating: 9 }), m('seen', 'Action')]
  const out = forYou([{ id: 'seen', group: 'Action' }], pool).map((x) => x.id)
  assert.deepEqual(out, ['b', 'a'])
  assert.deepEqual(forYou([], pool), [])
})

test('newest puts artwork first, topRated needs 7+', () => {
  assert.deepEqual(newest([m('old', 'G', { added: 1 }), m('new', 'G', { added: 9 }), m('noart', 'G', { added: 99, poster: undefined })]).map((x) => x.id), ['new', 'old', 'noart'])
  assert.deepEqual(topRated([m('x', 'G', { rating: 6.9 }), m('y', 'G', { rating: 8 })]).map((x) => x.id), ['y'])
})
