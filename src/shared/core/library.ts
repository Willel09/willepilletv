import type { Epg, Library, Settings, Source } from '../types'
import { matchEpg, parseXmltv, type XmltvData } from './epg'
import { parseM3u } from './m3u'
import type { GetText } from './net'
import { loadXtream, xtEpgUrl } from './xtream'

export const emptyLibrary = (): Library => ({ channels: [], movies: [], series: [], epgUrls: [], providerEpgUrls: [], accounts: {}, errors: [], updatedAt: Date.now() })

/** Load every source. A failing source is reported in `errors` instead of breaking the others. */
export async function buildLibrary(sources: Source[], s: Settings, get: GetText, progress: (m: string) => void): Promise<Library> {
  const lib = emptyLibrary()
  await Promise.all(
    sources.map(async (src) => {
      try {
        if (src.kind === 'xtream') {
          const r = await loadXtream(src, get, progress)
          lib.channels.push(...r.channels)
          lib.movies.push(...r.movies)
          lib.series.push(...r.series)
          lib.accounts[src.id] = r.account
          if (src.epgUrl) lib.epgUrls.push(src.epgUrl)
          else lib.providerEpgUrls.push(xtEpgUrl(src))
        } else {
          if (!src.url) throw new Error('No playlist URL or file set.')
          progress(`${src.name}: downloading playlist…`)
          const r = parseM3u(await get(src.url), src.id)
          if (!r.channels.length && !r.movies.length && !r.series.length) throw new Error('The playlist is empty or not a valid M3U file.')
          lib.channels.push(...r.channels)
          lib.movies.push(...r.movies)
          lib.series.push(...r.series)
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

export async function buildEpg(lib: Library, s: Settings, get: GetText, progress: (m: string) => void): Promise<Epg> {
  const urls = [...new Set([s.epgUrl, ...lib.epgUrls, ...(s.autoProviderEpg ? lib.providerEpgUrls ?? [] : [])].filter(Boolean))]
  const now = Date.now()
  const errors: string[] = []
  const data: XmltvData[] = []
  for (const url of urls) {
    try {
      progress('Loading TV guide…')
      // Descriptions only for the next 12 h keeps 10k-channel guides small enough for the UI (and TVs)
      data.push(parseXmltv(await get(url, 300_000), now - 2 * 3600_000, now + 26 * 3600_000, now + 12 * 3600_000))
    } catch (e) {
      let host = url
      try { host = new URL(url).host } catch { /* file path */ }
      errors.push(`Guide ${host}: ${(e as Error).message}`)
    }
  }
  progress('')
  return { programmes: matchEpg(lib.channels, data), updatedAt: Date.now(), errors }
}
