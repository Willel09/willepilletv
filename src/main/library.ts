import { app } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Epg, Library, Settings, Source } from '../shared/types'
import { matchEpg, parseXmltv, type XmltvData } from './epg'
import { getText } from './http'
import { parseM3u } from './m3u'
import { loadXtream, xtEpgUrl } from './xtream'

const cacheFile = (name: string) => join(app.getPath('userData'), `${name}.json`)

export async function readCache<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(cacheFile(name), 'utf8')) as T
  } catch {
    return null
  }
}
const writeCache = (name: string, data: unknown) => writeFile(cacheFile(name), JSON.stringify(data)).catch(() => {})

/** Load every source. A failing source is reported in `errors` instead of breaking the others. */
export async function buildLibrary(sources: Source[], s: Settings, progress: (m: string) => void): Promise<Library> {
  const lib: Library = { channels: [], movies: [], series: [], epgUrls: [], providerEpgUrls: [], accounts: {}, errors: [], updatedAt: Date.now() }
  await Promise.all(
    sources.map(async (src) => {
      try {
        if (src.kind === 'xtream') {
          const r = await loadXtream(src, s.userAgent, progress)
          lib.channels.push(...r.channels)
          lib.movies.push(...r.movies)
          lib.series.push(...r.series)
          lib.accounts[src.id] = r.account
          if (src.epgUrl) lib.epgUrls.push(src.epgUrl)
          else lib.providerEpgUrls.push(xtEpgUrl(src))
        } else {
          if (!src.url) throw new Error('No playlist URL or file set.')
          progress(`${src.name}: downloading playlist…`)
          const r = parseM3u(await getText(src.url, s.userAgent), src.id)
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
  await writeCache('library', lib)
  return lib
}

export async function buildEpg(lib: Library, s: Settings, progress: (m: string) => void): Promise<Epg> {
  const urls = [...new Set([s.epgUrl, ...lib.epgUrls, ...(s.autoProviderEpg ? lib.providerEpgUrls ?? [] : [])].filter(Boolean))]
  const from = Date.now() - 2 * 3600_000
  const to = Date.now() + 26 * 3600_000
  const descUntil = Date.now() + 12 * 3600_000
  const errors: string[] = []
  const data: XmltvData[] = []
  for (const url of urls) {
    try {
      progress('Loading TV guide…')
      data.push(parseXmltv(await getText(url, s.userAgent, 300_000), from, to, descUntil))
    } catch (e) {
      let host = url
      try { host = new URL(url).host } catch { /* file path */ }
      errors.push(`Guide ${host}: ${(e as Error).message}`)
    }
  }
  progress('')
  const epg: Epg = { programmes: matchEpg(lib.channels, data), updatedAt: Date.now(), errors }
  await writeCache('epg', epg)
  return epg
}
