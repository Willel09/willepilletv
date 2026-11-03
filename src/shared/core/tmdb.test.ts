import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ageOn, fetchRecommendations, findPerson, parsePerson, resolveTmdb, tmdbUrl } from './tmdb.ts'

test('a v3 key goes in the address, a v4 token in a header', () => {
  assert.match(tmdbUrl('abc123', '/search/person', { query: 'Tom Hanks' }), /api_key=abc123&query=Tom\+Hanks$/)
  assert.doesNotMatch(tmdbUrl('x'.repeat(60), '/x'), /api_key/)
})

test('age counts whole years, and stops at death', () => {
  assert.equal(ageOn('1956-07-09', new Date('2026-07-08')), 69)
  assert.equal(ageOn('1956-07-09', new Date('2026-07-09')), 70)
  assert.equal(ageOn('nonsense', new Date()), undefined)
})

const person = {
  id: 31,
  name: 'Tom Hanks',
  birthday: '1956-07-09',
  profile_path: '/p.jpg',
  place_of_birth: 'Concord, California, USA',
  known_for_department: 'Acting',
  combined_credits: {
    cast: [
      { id: 13, media_type: 'movie', title: 'Forrest Gump', release_date: '1994-06-23', vote_average: 8.5, vote_count: 25000, character: 'Forrest' },
      { id: 13, media_type: 'movie', title: 'Forrest Gump', release_date: '1994-06-23', vote_average: 8.5, vote_count: 25000 },
      { id: 497, media_type: 'movie', title: 'The Green Mile', release_date: '1999-12-10', vote_average: 8.5, vote_count: 17000 },
      { id: 1, media_type: 'tv', name: 'Some Talk Show', first_air_date: '2010-01-01', vote_average: 9, vote_count: 500, genre_ids: [10767] },
      { id: 2, media_type: 'movie', title: 'Not Out Yet', release_date: '2999-01-01', vote_average: 0, vote_count: 0 },
      { id: 3, media_type: 'movie', title: 'Obscure', release_date: '2001-01-01', vote_average: 1, vote_count: 3 },
      { id: 4, media_type: 'person', name: 'Not a title' }
    ],
    crew: [{ id: 99, media_type: 'movie', title: 'That Thing You Do!', release_date: '1996-10-04', vote_average: 6.9, vote_count: 2500, job: 'Director' }]
  }
}

test('an actor page: counts released work, skips talk shows, averages well-voted titles only', () => {
  const p = parsePerson(person, 'actor', new Date('2026-01-01'))
  assert.deepEqual(p.credits.map((c) => c.title), ['Forrest Gump', 'The Green Mile', 'Obscure'])
  assert.equal(p.count, 3)
  assert.equal(p.average, 8.5)
  assert.equal(p.age, 69)
  assert.equal(p.credits[0].role, 'Forrest')
  assert.equal(p.photo, 'https://image.tmdb.org/t/p/w342/p.jpg')
})

test('a director page counts directing credits only', () => {
  const p = parsePerson(person, 'director', new Date('2026-01-01'))
  assert.deepEqual(p.credits.map((c) => c.title), ['That Thing You Do!'])
  assert.equal(p.average, 6.9)
})

test('a person who died has the age they reached', () => {
  const p = parsePerson({ id: 1, name: 'X', birthday: '1930-05-05', deathday: '2000-05-04' }, 'actor', new Date('2026-01-01'))
  assert.equal(p.age, 69)
})

test('findPerson prefers an exact name over the first hit', async () => {
  const get = async () => ({ results: [{ id: 1, name: 'Tom Hanksy' }, { id: 31, name: 'Tom Hanks' }] })
  assert.equal(await findPerson(get, 'k', 'tom hanks'), 31)
})

test('resolveTmdb uses the IMDb id first, then falls back to a search', async () => {
  const urls: string[] = []
  const get = async (u: string) => (urls.push(u), u.includes('/find/') ? { movie_results: [] } : { results: [{ id: 603 }] })
  assert.equal(await resolveTmdb(get, 'k', { kind: 'movie', title: 'The Matrix', year: '1999', imdbId: 'tt0133093' }), 603)
  assert.equal(urls.length, 2)
  assert.match(urls[1], /search\/movie.*year=1999/)
})

test('recommendations are padded with similar titles, without repeats', async () => {
  const get = async (u: string) =>
    u.includes('/recommendations')
      ? { results: [{ id: 1, title: 'A', release_date: '2001-01-01' }, { id: 2, title: 'B' }] }
      : { results: [{ id: 2, title: 'B' }, { id: 3, title: 'C' }] }
  const r = await fetchRecommendations(get, 'k', 'movie', 7)
  assert.deepEqual(r.map((x) => x.tmdb), [1, 2, 3])
})

test('a rejected key is explained', async () => {
  const get = async () => {
    throw new Error('HTTP 401')
  }
  await assert.rejects(findPerson(get, 'bad', 'x'), /did not accept the key/)
})
