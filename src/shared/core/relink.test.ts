import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseM3u } from './m3u.ts'
import { relink } from './relink.ts'
import type { Library } from '../types.ts'

const playlist = (token: string) => `#EXTM3U
#EXTINF:-1 group-title="News",BBC One
http://p.tv/live/${token}/1.ts
#EXTINF:-1 group-title="News",BBC One
http://p.tv/live/${token}/2.ts
#EXTINF:-1 group-title="Shows",Lost S01 E02
http://p.tv/series/${token}/9.mkv
`
const lib = (token: string): Library => ({ ...parseM3u(playlist(token), 'src'), epgUrls: [], providerEpgUrls: [], accounts: {}, errors: [], updatedAt: 0 })

test('M3U ids stay the same when the token in the stream URLs changes', () => {
  const a = lib('aaa'), b = lib('bbb')
  assert.deepEqual(a.channels.map((c) => c.id)[0], b.channels.map((c) => c.id)[0])
  assert.equal(a.series[0].episodes![0].id, '1x2')
  assert.notEqual(a.channels[0].id, a.channels[1].id) // same name in the same group: still two channels
})

test('favorites and history saved with old ids are matched again by URL', () => {
  const now = lib('aaa')
  const ch = now.channels[0], show = now.series[0], ep = show.episodes![0]
  const oldFav = { ...ch, id: 'src:oldhash' }
  const lists = {
    favorites: [oldFav, { ...now.channels[1] }],
    watchlist: [],
    history: [
      { id: 'src:oldhash', kind: 'live' as const, name: ch.name, url: ch.url, position: 0, duration: 0, updatedAt: 1 },
      { id: `${show.id}:oldep`, kind: 'episode' as const, name: ep.title, url: ep.url, position: 50, duration: 100, updatedAt: 2, parentId: show.id }
    ]
  }
  const r = relink(now, lists, new Set(['src']))
  assert.deepEqual(r.favorites!.list.map((x) => x.id), [ch.id, now.channels[1].id])
  assert.deepEqual(r.favorites!.removed, ['src:oldhash'])
  assert.deepEqual(r.history!.list.map((h) => h.id), [ch.id, `${show.id}:1x2`])
  assert.equal(r.watchlist, undefined)
  // nothing to do the second time
  assert.deepEqual(relink(now, { favorites: r.favorites!.list, watchlist: [], history: r.history!.list }, new Set(['src'])), {})
})

test('an episode alone in history is relinked too', () => {
  const now = lib('aaa')
  const show = now.series[0], ep = show.episodes![0]
  const r = relink(now, { favorites: [], watchlist: [], history: [{ id: `${show.id}:oldep`, kind: 'episode', name: ep.title, url: ep.url, position: 5, duration: 9, updatedAt: 1, parentId: show.id }] }, new Set(['src']))
  assert.deepEqual(r.history!.list.map((h) => h.id), [`${show.id}:1x2`])
})
