import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasNew } from './seen.ts'

test('new when the provider changed the series after you last looked or watched', () => {
  assert.equal(hasNew(2000, 1000, 0), true)
  assert.equal(hasNew(2000, 3000, 0), false) // looked at it after the change
  assert.equal(hasNew(2000, 1000, 2500), false) // watched an episode after the change
  assert.equal(hasNew(undefined, 1000, 0), false)
})
