import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JsonArrayStream } from './net.ts'

const items = [
  { stream_id: 1, name: 'A {tricky} [name]', icon: 'http://x/"q".png' },
  { stream_id: 2, name: 'Back\\slash \\" quote', nested: { a: [1, { b: '}' }] } },
  { stream_id: 3, name: 'Ünïcødé 🎬', empty: {} }
]

const run = (text: string, size: number) => {
  const got: unknown[] = []
  const p = new JsonArrayStream((x) => got.push(x))
  for (let i = 0; i < text.length; i += size) p.push(text.slice(i, i + size))
  return got
}

test('streams items of a JSON array, whatever the chunk boundaries', () => {
  const text = ' \n' + JSON.stringify(items, null, 1)
  for (const size of [1, 2, 5, 17, 1000]) assert.deepEqual(run(text, size), items, `chunk ${size}`)
})

test('object-form lists ({"1": {...}}) give their values; non-lists give nothing', () => {
  const obj = JSON.stringify({ 1: items[0], 2: items[1], 3: items[2] })
  for (const size of [1, 7, 1000]) assert.deepEqual(run(obj, size), items)
  assert.deepEqual(run('"error"', 3), [])
  assert.deepEqual(run('[]', 1), [])
})
