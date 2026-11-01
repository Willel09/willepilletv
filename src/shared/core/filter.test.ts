import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isArabicOrIndian as bs } from './filter.ts'

test('Remove BS hides Arabic and Indian items, keeps the rest', () => {
  for (const [name, group] of [['MBC 1 HD', 'News'], ['Channel', 'AR | Movies'], ['Film', 'Bollywood'], ['|IN| Star Plus', 'Live'], ['قناة', 'G'], ['फ़िल्म', 'G'], ['Kids', 'KSA: Kids'], ['Show', 'Tamil Series']])
    assert.equal(bs({ name, group }), true, `${name} / ${group}`)
  for (const [name, group] of [['Indiana Jones', 'Action'], ['SE-4K - War Machine', 'SE-4K'], ['Into the Wild', 'IN THE SPOTLIGHT'], ['Arabian Nights?', 'Fantasy'], ['UK: BBC One', 'UK'], ['Marathon Man', 'Thriller']])
    assert.equal(bs({ name, group }), false, `${name} / ${group}`)
})

test('hiddenFilter combines hidden category words and Remove BS', async () => {
  const { hiddenFilter } = await import('./filter.ts')
  assert.equal(hiddenFilter({ hiddenGroups: '', removeBs: false }), null)
  const f = hiddenFilter({ hiddenGroups: 'adult, 24/7', removeBs: true })!
  assert.equal(f({ name: 'X', group: 'ADULT Movies' }), true)
  assert.equal(f({ name: 'Bollywood Nights', group: 'Movies' }), true)
  assert.equal(f({ name: 'Mutiny', group: 'Action' }), false)
  assert.equal(f({ name: 'Señor Café', group: 'Comédie 24/7' }), true)
})
