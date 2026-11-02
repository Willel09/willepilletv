import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchRatings, omdbUrl, parseOmdb } from './ratings.ts'

test('parses IMDb, Rotten Tomatoes and Metacritic', () => {
  const r = parseOmdb({ Response: 'True', imdbRating: '8.8', imdbVotes: '2,612,345', Metascore: '74', imdbID: 'tt1375666', Ratings: [{ Source: 'Internet Movie Database', Value: '8.8/10' }, { Source: 'Rotten Tomatoes', Value: '87%' }, { Source: 'Metacritic', Value: '74/100' }] })
  assert.deepEqual(r, { imdb: 8.8, votes: 2612345, rt: 87, meta: 74, imdbId: 'tt1375666' })
})

test('N/A everywhere and not found are null; key errors throw', () => {
  assert.equal(parseOmdb({ Response: 'True', imdbRating: 'N/A', Metascore: 'N/A', Ratings: [] }), null)
  assert.equal(parseOmdb({ Response: 'False', Error: 'Movie not found!' }), null)
  assert.throws(() => parseOmdb({ Response: 'False', Error: 'Request limit reached!' }), /limit/)
  assert.throws(() => parseOmdb({ Response: 'False', Error: 'Invalid API key!' }), /Invalid/)
})

test('url: imdb id wins, otherwise title + year + type', () => {
  assert.equal(omdbUrl('k', { kind: 'movie', title: 'X', imdbId: 'tt1' }), 'https://www.omdbapi.com/?apikey=k&type=movie&i=tt1')
  assert.equal(omdbUrl('k', { kind: 'series', title: 'Ali G: Who Iz I?', year: '2026' }), 'https://www.omdbapi.com/?apikey=k&type=series&t=Ali+G%3A+Who+Iz+I%3F&y=2026')
})

test('retries without the year when title + year finds nothing', async () => {
  const urls: string[] = []
  const f = (async (u: string) => {
    urls.push(u)
    return { json: async () => (u.includes('&y=') ? { Response: 'False', Error: 'Movie not found!' } : { Response: 'True', imdbRating: '7.1' }) }
  }) as unknown as typeof fetch
  assert.deepEqual(await fetchRatings('k', { kind: 'movie', title: 'Dune', year: '2020' }, f), { imdb: 7.1, votes: undefined, rt: undefined, meta: undefined, imdbId: undefined })
  assert.equal(urls.length, 2)
})
