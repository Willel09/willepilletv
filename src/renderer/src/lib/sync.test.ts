import { test } from 'node:test'
import assert from 'node:assert/strict'
import { derive, merge, type SyncDoc } from './sync.ts'

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

test('WebCrypto and the pure-JS fallback produce interchangeable ciphertext', async () => {
  const code = 'ABCD-EFGH-JKLM-NPQR-STUV'
  const [web, js] = await Promise.all([derive(code, 'sync'), derive(code, 'sync', true)])
  assert.equal(web.id, js.id)
  const doc = { hello: 'TV', n: [1, 2, 3] }
  assert.deepEqual(await js.open(await web.seal(doc)), doc)
  assert.deepEqual(await web.open(await js.seal(doc)), doc)
})

test('playlist file: chunked upload, skip unchanged, readable from another device', async () => {
  const { pushFile, pullFile } = await import('./sync.ts')
  const blobs = new Map<string, string>()
  let puts = 0
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body)
    const fn = url.split('/').pop()
    if (fn === 'sync_put') (puts++, blobs.set(body.p_id, body.p_data))
    const row = blobs.get(body.p_id)
    return new Response(JSON.stringify(fn === 'sync_get' ? (row ? [{ data: row }] : []) : null), { status: 200 })
  }) as typeof fetch
  try {
    // ~6 MB of random-ish text that gzip can't shrink below one chunk
    const rnd = () => Math.random().toString(36).slice(2)
    const text = '#EXTM3U\n' + Array.from({ length: 160_000 }, (_, i) => `#EXTINF:-1,${rnd()}${i}\nhttp://x/${rnd()}${rnd()}.ts`).join('\n')
    await pushFile('AAAA-BBBB-CCCC-DDDD-EEEE', 'src1', text, 'v1')
    assert.ok(puts > 2, `expected several chunks, got ${puts - 1}`)
    assert.ok([...blobs.values()].every((d) => d.length < 4_000_000))
    const before = puts
    await pushFile('AAAA-BBBB-CCCC-DDDD-EEEE', 'src1', text, 'v1')
    assert.equal(puts, before, 'unchanged file is not re-uploaded')
    assert.equal(await pullFile('aaaabbbbccccddddeeee', 'src1'), text)
    assert.equal(await pullFile('AAAA-BBBB-CCCC-DDDD-EEEE', 'other'), null)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('profiles: add/edit/delete and per-profile lists merge independently', async () => {
  const { mergeProfiles } = await import('./sync.ts')
  const now = Date.now()
  const kid = { id: 'kid', name: 'Kid', avatar: 'robot' }
  const a = { v: 1 as const, profiles: [kid], data: { kid: { favorites: [], watchlist: [movie('x')], history: [] } }, meta: { at: { 'profiles:kid': now - 10, 'kid/watchlist:x': now - 10 }, tomb: {} } }
  // other device renamed the kid profile and added y to its watchlist; also created 'mum'
  const b = {
    v: 1 as const,
    profiles: [{ ...kid, name: 'Kiddo' }, { id: 'mum', name: 'Mum', avatar: 'bear' }],
    data: { kid: { favorites: [], watchlist: [movie('y')], history: [] }, mum: { favorites: [], watchlist: [movie('z')], history: [] } },
    meta: { at: { 'profiles:kid': now, 'profiles:mum': now, 'kid/watchlist:y': now, 'mum/watchlist:z': now }, tomb: {} }
  }
  const m = mergeProfiles(a, b)
  assert.deepEqual(m.profiles.map((p) => p.name), ['Kiddo', 'Mum'])
  assert.deepEqual(m.data.kid.watchlist.map((x) => x.id), ['y', 'x'])
  assert.deepEqual(m.data.mum.watchlist.map((x) => x.id), ['z'])
  assert.equal(m.meta.at['kid/watchlist:x'], now - 10)
  // deleting a profile removes it (and its lists) everywhere
  const del = { ...m, profiles: m.profiles.filter((p) => p.id !== 'mum'), meta: { at: { ...m.meta.at }, tomb: { 'profiles:mum': now + 5 } } }
  delete del.meta.at['profiles:mum']
  const after = mergeProfiles(del, m)
  assert.deepEqual(after.profiles.map((p) => p.id), ['kid'])
  assert.equal(after.data.mum, undefined)
})
