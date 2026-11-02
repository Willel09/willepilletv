import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keepOld } from './keep.ts'
import type { Library } from '../types.ts'

const empty = (): Library => ({ channels: [], movies: [], series: [], epgUrls: [], providerEpgUrls: [], accounts: {}, errors: [], updatedAt: 0 })

test('a failed source keeps its old channels, movies and its copies inside merged titles', () => {
  const prev = empty()
  prev.channels = [
    { kind: 'live', id: 'b:1', name: 'B One', group: 'G', url: 'u', sourceId: 'b' },
    { kind: 'live', id: 'a:1', name: 'A One', group: 'G', url: 'u', sourceId: 'a' }
  ] as Library['channels']
  prev.movies = [
    {
      kind: 'movie', id: 'a:m1', name: 'Kubo', group: 'Films', sourceId: 'a', vodId: 1, poster: 'p',
      versions: [{ id: 'a:m1', sourceId: 'a', vodId: 1, label: 'EN' }, { id: 'b:m9', sourceId: 'b', vodId: 9, ext: 'mkv', label: 'SE' }]
    },
    { kind: 'movie', id: 'b:m2', name: 'Only B', group: 'Films', sourceId: 'b', vodId: 2 }
  ] as Library['movies']
  prev.accounts = { b: { status: 'Active' } }
  const lib = empty()
  keepOld(prev, 'b', lib)
  assert.deepEqual(lib.channels.map((c) => c.id), ['b:1'])
  assert.deepEqual(lib.movies.map((m) => [m.id, m.sourceId, m.vodId, m.poster, m.versions]), [['b:m9', 'b', 9, 'p', undefined], ['b:m2', 'b', 2, undefined, undefined]])
  assert.equal('label' in lib.movies[0], false)
  assert.deepEqual(lib.accounts, { b: { status: 'Active' } })
})
