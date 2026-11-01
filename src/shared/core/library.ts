import type { Epg, Library, Settings, Source } from '../types'
import { matchEpg, parseXmltv, XmltvParser, type XmltvData } from './epg'
import { parseM3u } from './m3u'
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
export async function buildLibrary(sources: Source[], s: Settings, get: GetText, progress: (m: string) => void, stream?: GetStream): Promise<Library> {
  const lib = emptyLibrary()
  await Promise.all(
    sources.map(async (src) => {
      try {
        if (src.kind === 'xtream') {
          const r = await loadXtream(src, get, progress, stream)
          add(lib, r)
          lib.accounts[src.id] = r.account
          if (src.epgUrl) lib.epgUrls.push(src.epgUrl)
          else lib.providerEpgUrls.push(xtEpgUrl(src))
        } else {
          if (!src.url) throw new Error('No playlist URL or file set.')
          progress(`${src.name}: downloading playlist…`)
          const r = parseM3u(await get(src.url), src.id)
          if (!r.channels.length && !r.movies.length && !r.series.length) throw new Error('The playlist is empty or not a valid M3U file.')
          add(lib, r)
          if (src.epgUrl) lib.epgUrls.push(src.epgUrl)
          else if (r.epgUrl) lib.providerEpgUrls.push(r.epgUrl)
        }
      } catch (e) {
        lib.errors.push(`${src.name}: ${(e as Error).message}`)
      }
    })
  )
  progress('')
  return lib
}

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
