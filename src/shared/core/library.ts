import type { Epg, Library, Settings, Source } from '../types'
import { keepOld } from './keep'
import { matchEpg, parseXmltv, XmltvParser, type XmltvData } from './epg'
import { parseM3u } from './m3u'
import { mergeMoviesInSteps } from './dedupe'
import { hiddenFilter } from './filter'
import type { GetStream, GetText } from './net'
import { loadXtream, xtEpgUrl } from './xtream'

export const emptyLibrary = (): Library => ({ channels: [], movies: [], series: [], epgUrls: [], providerEpgUrls: [], accounts: {}, errors: [], updatedAt: Date.now() })

/** push(...big) overflows the call stack past ~100k items, so append in a loop */
const append = <T>(to: T[], from: T[]) => {
  for (const x of from) to.push(x)
}
const add = (lib: Library, r: Pick<Library, 'channels' | 'movies' | 'series'>) => {
  append(lib.channels, r.channels)
  append(lib.movies, r.movies)
  append(lib.series, r.series)
}

/** Load every source. A failing source is reported in `errors` instead of breaking the others. */
/**
 * Sources load one after another (several 100 MB providers at once would not fit on a TV).
 * `lean` (TVs): titles hidden by the library filters are dropped while loading, see loadXtream.
 */
export async function buildLibrary(sources: Source[], s: Settings, get: GetText, progress: (m: string) => void, opts: { stream?: GetStream; lean?: boolean; previous?: Library | null } = {}): Promise<Library> {
  const lib = emptyLibrary()
  const skip = opts.lean ? hiddenFilter(s) : null
  for (const src of sources) {
    try {
      if (src.kind === 'xtream') {
        const r = await loadXtream(src, get, progress, { ...opts, skip })
        add(lib, r)
        lib.accounts[src.id] = r.account
        if (src.epgUrl) lib.epgUrls.push(src.epgUrl)
        else lib.providerEpgUrls.push(xtEpgUrl(src))
      } else {
        if (!src.url) throw new Error('No playlist URL or file set.')
        progress(`${src.name}: downloading playlist…`)
        const r = parseM3u(await get(src.url), src.id)
        if (!r.channels.length && !r.movies.length && !r.series.length) throw new Error('The playlist is empty or not a valid M3U file.')
        if (skip) for (const k of ['channels', 'movies', 'series'] as const) (r[k] as { name: string; group: string }[]) = r[k].filter((x) => !skip(x))
        add(lib, r)
        if (src.epgUrl) lib.epgUrls.push(src.epgUrl)
        else if (r.epgUrl) lib.providerEpgUrls.push(r.epgUrl)
      }
    } catch (e) {
      lib.errors.push(`${src.name}: ${(e as Error).message}`)
      // a provider that's down for a moment must not empty the library: keep what this source had last time
      if (opts.previous) {
        keepOld(opts.previous, src.id, lib)
        if (src.kind === 'xtream') {
          if (src.epgUrl) lib.epgUrls.push(src.epgUrl)
          else lib.providerEpgUrls.push(xtEpgUrl(src))
        }
      }
    }
  }
  // done here, in steps, so the UI never has to do it in one blocking go (and restarts load it ready-made)
  await mergeLibrary(lib, progress)
  if (opts.lean) lib.prepared = preparedFor(s)
  progress('')
  return lib
}

/** Merges duplicate movies and series in place; Windows also uses it to upgrade a library cached unmerged */
export async function mergeLibrary(lib: Library, progress?: (m: string) => void) {
  // shown while it runs: 400k titles take a while, and a bare "Loading…" looks stuck
  const movies = lib.movies.length, all = movies + lib.series.length || 1
  const say = (done: number) => progress?.(`Merging duplicates… ${Math.round((done / all) * 100)}%`)
  lib.movies = await mergeMoviesInSteps(lib.movies, undefined, (f) => say(f * movies))
  lib.series = await mergeMoviesInSteps(lib.series, undefined, (f) => say(movies + f * (all - movies)))
  progress?.('')
  lib.merged = PREPARED
}
export const isMerged = (lib: Library) => lib.merged === PREPARED || !!lib.prepared?.startsWith(PREPARED)

/** Which filter settings a prepared library was built with (see Library.prepared) */
// v2: series are merged too, and by TMDB id; libraries prepared by older versions get rebuilt
export const PREPARED = 'v2|'
export const preparedFor = (s: Pick<Settings, 'hiddenGroups' | 'removeBs'>) => `${PREPARED}${s.hiddenGroups}|${!!s.removeBs}`

/**
 * `stream` parses the guide while it downloads; `hours` limits how far ahead programmes are kept
 * (TVs keep 12 h and refresh the guide more often, instead of holding a full day of 10k channels).
 */
export async function buildEpg(lib: Library, s: Settings, get: GetText, progress: (m: string) => void, opts: { stream?: GetStream; hours?: number } = {}): Promise<Epg> {
  const urls = [...new Set([s.epgUrl, ...lib.epgUrls, ...(s.autoProviderEpg ? lib.providerEpgUrls ?? [] : [])].filter(Boolean))]
  const now = Date.now()
  const errors: string[] = []
  const data: XmltvData[] = []
  for (const url of urls) {
    try {
      progress('Loading TV guide…')
      // Descriptions only for the next 12 h (TV: 4 h) keeps 10k-channel guides small enough for the UI
      const hours = opts.hours ?? 26
      const window = [now - 2 * 3600_000, now + hours * 3600_000, now + Math.min(12, hours / 3) * 3600_000] as const
      if (opts.stream) {
        const p = new XmltvParser(...window)
        await opts.stream(url, (chunk) => p.push(chunk), 300_000)
        data.push(p.finish())
      } else data.push(parseXmltv(await get(url, 300_000), ...window))
    } catch (e) {
      let host = url
      try { host = new URL(url).host } catch { /* file path */ }
      errors.push(`Guide ${host}: ${(e as Error).message}`)
    }
  }
  progress('')
  return { programmes: matchEpg(lib.channels, data), updatedAt: Date.now(), errors }
}
