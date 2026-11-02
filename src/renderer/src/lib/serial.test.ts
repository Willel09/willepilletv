import { test } from 'node:test'
import assert from 'node:assert/strict'
import { serial } from './serial.ts'

test('calls during a run cause exactly one more run, which sees the newest state', async () => {
  const seen: string[] = []
  let sources = ['a']
  let release!: () => void
  let runs = 0
  const refresh = serial(async () => {
    runs++
    const snapshot = sources.join(',')
    if (runs === 1) await new Promise<void>((r) => (release = r))
    seen.push(snapshot)
  })
  void refresh()
  sources = ['a', 'b'] // a source is added while the first refresh is loading
  void refresh()
  void refresh()
  release()
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(runs, 2)
  assert.deepEqual(seen, ['a', 'a,b'])
})
