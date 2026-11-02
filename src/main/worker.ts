// Library and TV guide work for the Windows app, off the main process. Parsing a 160 MB library, building
// it from a provider's lists or a guide blocks for seconds; on the main thread Windows then shows
// "Lumen is not responding". The library stays here; the main process only passes messages through.
import { parentPort, workerData } from 'node:worker_threads'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Library, Settings, Source } from '../shared/types'
import { buildEpg, buildLibrary, emptyLibrary, isMerged, mergeLibrary } from '../shared/core/library'
import { gunzipSync } from 'node:zlib'

const dir: string = workerData.dir
const file = (name: string) => join(dir, `${name}.json`)
const read = (name: string) => readFile(file(name), 'utf8').catch(() => null)
const write = (name: string, text: string) => writeFile(file(name), text).catch(() => {})

/** Parts of the library go out in pieces of this many items (see library:part) */
const PART = 20_000
let library: Library | null = null
let outgoing: Library | null = null
let loading: Promise<Library | null> | null = null
// one read at a time: boot asks for the library and the guide refresh needs it too
const loaded = () => (library ? Promise.resolve(library) : (loading ??= load().finally(() => (loading = null))))
const load = async () => {
  const text = await read('library')
  try {
    library = text ? (JSON.parse(text) as Library) : null
  } catch {
    library = null
  }
  // libraries cached unmerged (before 1.3.9) are merged once
  if (library && !isMerged(library)) await mergeLibrary(library), await write('library', JSON.stringify(library))
  return library
}
// shortcut: pieces come from the library last handed over; a refresh finishing mid-transfer would mix them (the window loads one at a time)
const handOver = (lib: Library | null): Library | null => {
  outgoing = lib
  return lib && { ...lib, channels: [], movies: [], series: [], parts: { channels: lib.channels.length, movies: lib.movies.length, series: lib.series.length } }
}
const progress = (m: string) => parentPort!.postMessage({ progress: m })
// downloads are done by the main process (Chromium's network stack); text is decoded here
let rseq = 0
const fetches = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>()
const get = (url: string, timeoutMs?: number) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const rid = ++rseq
    fetches.set(rid, { resolve, reject })
    parentPort!.postMessage({ fetch: { rid, url, timeoutMs } })
  }).then((b) => Buffer.from(b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b).toString('utf8'))

const ops: Record<string, (...args: never[]) => Promise<unknown>> = {
  get: async () => handOver(await loaded()),
  refresh: async (sources: Source[], s: Settings) => {
    library = await buildLibrary(sources, s, get, progress)
    await write('library', JSON.stringify(library))
    return handOver(library)
  },
  // JSON text: copying a string to the main process and on to the window costs next to nothing there
  part: async (list: 'channels' | 'movies' | 'series', from: number) => JSON.stringify(outgoing?.[list].slice(from, from + PART) ?? []),
  epgGet: () => read('epg'),
  epgRefresh: async (s: Settings) => {
    const text = JSON.stringify(await buildEpg((await loaded()) ?? emptyLibrary(), s, get, progress))
    await write('epg', text)
    return text
  }
}

parentPort!.on('message', async ({ id, op, args, rid, bytes, error }: { id: number; op: string; args: never[]; rid?: number; bytes?: Uint8Array; error?: string }) => {
  if (rid) {
    const f = fetches.get(rid)
    fetches.delete(rid)
    return error ? f?.reject(new Error(error)) : f?.resolve(bytes!)
  }
  try {
    parentPort!.postMessage({ id, result: await ops[op](...args) })
  } catch (e) {
    parentPort!.postMessage({ id, error: (e as Error).message })
  }
})
