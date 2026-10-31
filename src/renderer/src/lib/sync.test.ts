import { test } from 'node:test'
import assert from 'node:assert/strict'
import { merge, type SyncDoc } from './sync.ts'

const movie = (id: string) => ({ kind: 'movie' as const, id, sourceId: 's', name: id, group: 'g', url: 'u' })
const doc = (p: Partial<SyncDoc>): SyncDoc => ({ v: 1, sources: [], favorites: [], watchlist: [], history: [], prefs: {}, meta: { at: {}, tomb: {} }, ...p })

test('union of both sides, newest first', () => {
  const a = doc({ watchlist: [movie('a')], meta: { at: { 'watchlist:a': 10 }, tomb: {} } })
  const b = doc({ watchlist: [movie('b')], meta: { at: { 'watchlist:b': 20 }, tomb: {} } })
  assert.deepEqual(merge(a, b).watchlist.map((m) => m.id), ['b', 'a'])
})

test('a newer deletion on another device removes the item', () => {
  const now = Date.now()
  const local = doc({ watchlist: [movie('a')], meta: { at: { 'watchlist:a': now - 1000 }, tomb: {} } })
  const remote = doc({ meta: { at: {}, tomb: { 'watchlist:a': now } } })
  const m = merge(local, remote)
  assert.equal(m.watchlist.length, 0)
  assert.ok(m.meta.tomb['watchlist:a'])
})

test('re-adding after a deletion brings it back', () => {
  const now = Date.now()
  const local = doc({ watchlist: [movie('a')], meta: { at: { 'watchlist:a': now }, tomb: {} } })
  const remote = doc({ meta: { at: {}, tomb: { 'watchlist:a': now - 5000 } } })
  assert.equal(merge(local, remote).watchlist.length, 1)
})

test('newer prefs win and history keeps the newest position', () => {
  const h = (pos: number) => ({ id: 'm', kind: 'movie' as const, name: 'm', url: 'u', position: pos, duration: 100, updatedAt: pos })
  const local = doc({ prefs: { theme: 'nordic' }, history: [h(10)], meta: { at: { prefs: 5, 'history:m': 10 }, tomb: {} } })
  const remote = doc({ prefs: { theme: 'crimson' }, history: [h(50)], meta: { at: { prefs: 9, 'history:m': 50 }, tomb: {} } })
  const m = merge(local, remote)
  assert.equal(m.prefs.theme, 'crimson')
  assert.equal(m.history[0].position, 50)
})

test('items saved before change-tracking existed (no timestamp) are kept on both sides', () => {
  const legacy = doc({ sources: [{ id: 'src1', name: 'Provider', kind: 'xtream' }], favorites: [movie('old')] })
  const fresh = doc({})
  assert.equal(merge(fresh, legacy).sources.length, 1)
  assert.equal(merge(legacy, legacy).favorites.length, 1)
  assert.equal(merge(fresh, legacy).favorites[0].id, 'old')
})
