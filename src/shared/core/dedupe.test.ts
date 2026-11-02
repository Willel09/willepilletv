import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeMovies, stripTag, titleKey } from './dedupe.ts'
import type { Movie } from '../types.ts'

let n = 0
const mv = (name: string, extra: Partial<Movie> = {}): Movie => ({ kind: 'movie', id: `m${++n}`, sourceId: 's', name, group: 'G', url: `http://x/${n}.mp4`, ...extra })

test('stripTag removes provider tags, keeps real titles', () => {
  assert.equal(stripTag('SE-4K - Ali G: Who Iz I?'), 'Ali G: Who Iz I?')
  assert.equal(stripTag('EN | Kubo'), 'Kubo')
  assert.equal(stripTag('|NF| War Machine'), 'War Machine')
  assert.equal(stripTag('UK: BBC One HD'), 'BBC One HD')
  assert.equal(stripTag('TRON: Legacy'), 'TRON: Legacy')
  assert.equal(stripTag('Mutiny'), 'Mutiny')
})

test('titleKey ignores tags, quality and year', () => {
  assert.equal(titleKey('SE-4K - Kubo and the Two Strings'), titleKey('Kubo & The Two Strings (2016) 1080p'))
  assert.notEqual(titleKey('Dune'), titleKey('Dunes'))
})

test('duplicates become one movie with every copy as a version', () => {
  const out = mergeMovies([
    mv('SE-4K - Ali G: Who Iz I?', { group: 'SE-4K' }),
    mv('Mutiny'),
    mv('Ali G: Who Iz I?', { poster: 'p.jpg', rating: 6.1, vodId: 7, group: 'Comedy' }),
    mv('Kubo and the Two Strings', { poster: 'k.jpg' }),
    mv('Kubo and the Two Strings', { poster: 'k.jpg' })
  ])
  assert.deepEqual(out.map((m) => m.name), ['Ali G: Who Iz I?', 'Mutiny', 'Kubo and the Two Strings'])
  const ali = out[0]
  assert.equal(ali.vodId, 7, 'richest copy is the primary')
  assert.deepEqual(ali.versions?.map((v) => v.label), ['Comedy', 'SE-4K'])
  assert.deepEqual(ali.groups, ['SE-4K', 'Comedy'])
  assert.equal(out[2].versions?.length, 2)
})

test('remakes with different years stay separate; undated copy joins the dated one', () => {
  const out = mergeMovies([mv('Dune (1984)'), mv('Dune (2021)'), mv('Halloween', { year: '2018' }), mv('EN - Halloween')])
  assert.equal(out.length, 3)
  assert.equal(out.find((m) => m.name === 'Halloween')?.versions?.length, 2)
})

test('identical URLs collapse to one version', () => {
  const out = mergeMovies([mv('Up', { url: 'http://x/up.mp4' }), mv('Up', { url: 'http://x/up.mp4' })])
  assert.equal(out.length, 1)
  assert.equal(out[0].versions, undefined)
})

test('bracket tags, [quality] and (year) anywhere: the Ali G copies become one film', () => {
  const out = mergeMovies([
    mv('SC-[4K-Q] - Ali G: Who Iz I? (2026)'),
    mv('SE-[4K-Q] - Ali G: Who Iz I?'),
    mv('Ali G: Who Iz I? [1080p]'),
    mv('Ali G Indahouse (2002)')
  ])
  assert.deepEqual(out.map((m) => m.name).sort(), ['Ali G Indahouse (2002)', 'Ali G: Who Iz I? (2026)'].sort())
  assert.equal(out.find((m) => m.name.startsWith('Ali G: Who'))?.versions?.length, 3)
  assert.equal(stripTag('SC-[4K-Q] - Ali G: Who Iz I?'), 'Ali G: Who Iz I?')
})

test('a shared TMDB id joins translated titles; copies without the id join by title', () => {
  const out = mergeMovies([
    mv('Ali G: Who Iz I?', { tmdb: 1234 }),
    mv("Ali G : J'suis qui ? (2026) [1080p]", { tmdb: 1234 }),
    mv('DE - Ali G: Leben in XXXL', { tmdb: 1234 }),
    mv('SE-[4K-Q] - Ali G: Who Iz I?'),
    mv('Up', { tmdb: 14160 })
  ])
  assert.equal(out.length, 2)
  assert.equal(out.find((m) => m.tmdb === 1234)?.versions?.length, 4)
})

test('series merge too (Xtream ones), with their series ids as versions; M3U series stay apart', () => {
  const show = (name: string, extra: Record<string, unknown> = {}) => ({ kind: 'series' as const, id: `s${++n}`, sourceId: 's', name, group: 'G', ...extra })
  const out = mergeMovies([show('SE - Dark', { seriesId: 1 }), show('Dark [4K]', { seriesId: 2 }), show('Dark', { episodes: [] }), show('Dark', { episodes: [] })])
  const merged = out.find((x) => x.versions)
  assert.deepEqual(merged?.versions?.map((v) => v.seriesId), [1, 2])
  assert.equal(out.length, 3)
})
