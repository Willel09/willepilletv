import assert from 'node:assert/strict'
import { test } from 'node:test'
import { distance, matchScore, rank, words } from './search.ts'

const searchKey = words

const m = (name: string, q: string, fuzzy = false) => matchScore(searchKey(name), words(q).split(' '), fuzzy)

test('accents and punctuation do not count', () => {
  assert.equal(searchKey('Spider-Man: No Way Home'), 'spider man no way home')
  assert.notEqual(m('Léon', 'leon'), null)
  assert.notEqual(m('Tom & Jerry', 'tom and jerry'), null)
  assert.equal(m('The Matrix', 'en'), null)
})

test('a word start beats the middle of a word, an exact title beats both', () => {
  const exact = m('Alien', 'alien')!
  const start = m('Alien Resurrection', 'alien')!
  const inside = m('Hungarian Alien', 'ali')!
  const mid = m('Malien Days', 'alien')!
  assert.ok(exact > start && start > mid)
  assert.ok(inside > mid)
})

test('every word must match', () => {
  assert.equal(m('The Dark Knight', 'dark joker'), null)
  assert.notEqual(m('The Dark Knight', 'knight dark'), null)
})

test('typos only count when asked for', () => {
  assert.equal(m('The Matrix Reloaded', 'matrx'), null)
  assert.notEqual(m('The Matrix Reloaded', 'matrx', true), null)
  assert.notEqual(m('Interstellar', 'intersteller', true), null)
  assert.equal(m('Interstellar', 'inception', true), null)
  // short words are never guessed
  assert.equal(m('Her', 'hat', true), null)
})

test('distance counts a swap as one', () => {
  assert.equal(distance('teh', 'the', 1), 1)
  assert.equal(distance('kitten', 'sitting', 2), 3)
})

test('rank returns the best first and counts all matches', () => {
  const list = [
    { id: '1', name: 'Making of Alien', poster: 'x' },
    { id: '2', name: 'Alien', poster: 'x' },
    { id: '3', name: 'Alien 3', poster: 'x' },
    { id: '4', name: 'Heat', poster: 'x' }
  ]
  const r = rank(list, 2, ['alien'], (x) => searchKey(x.name))
  assert.equal(r.total, 3)
  assert.deepEqual(r.items.map((x) => x.id), ['2', '3'])
})
