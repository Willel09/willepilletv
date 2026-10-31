import type { Channel, Episode, Movie, Show } from '../types'

/** 53-bit string hash (cyrb53): short, stable ids with negligible collisions at 100k+ items. */
export function hash(str: string): string {
  let h1 = 0xdeadbeef ^ 0
  let h2 = 0x41c6ce57 ^ 0
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

const VOD_EXT = /\.(mp4|mkv|avi|mov|m4v|wmv|flv|webm)(\?|$)/i
const EPISODE = /^(.*?)[\s._-]*S(\d{1,2})[\s._-]*E(\d{1,3})\b/i

export interface M3uResult {
  channels: Channel[]
  movies: Movie[]
  series: Show[]
  epgUrl?: string
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of s.matchAll(/([\w-]+)=("([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = (m[3] ?? m[4] ?? '').trim()
  return out
}

/** The display name is everything after the first comma that isn't inside quotes. */
function displayName(info: string): string {
  let q = ''
  for (let i = 0; i < info.length; i++) {
    const c = info[i]
    if (q) {
      if (c === q) q = ''
    } else if (c === '"' || c === "'") q = c
    else if (c === ',') return info.slice(i + 1).trim()
  }
  return ''
}

export function parseM3u(text: string, sourceId: string): M3uResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const res: M3uResult = { channels: [], movies: [], series: [] }
  const shows = new Map<string, Show>()
  let info: Record<string, string> | null = null
  let name = ''
  let extGroup = ''

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#EXTM3U')) {
      const a = attrs(line)
      res.epgUrl = (a['url-tvg'] || a['x-tvg-url'] || '').split(',')[0].trim() || undefined
      continue
    }
    if (line.startsWith('#EXTINF:')) {
      const body = line.slice(8)
      info = attrs(body)
      name = displayName(body) || info['tvg-name'] || ''
      continue
    }
    if (line.startsWith('#EXTGRP:')) {
      extGroup = line.slice(8).trim()
      continue
    }
    if (line.startsWith('#')) continue

    // A URL line closes the current entry
    const url = line
    const a = info ?? {}
    const title = name || a['tvg-name'] || url.split('/').pop() || 'Untitled'
    const group = a['group-title'] || extGroup || 'Uncategorized'
    const logo = a['tvg-logo'] || undefined
    const id = `${sourceId}:${hash(`${group}|${title}|${url}`)}`
    const ep = /\/series\//i.test(url) ? title.match(EPISODE) : null

    if (ep) {
      const showName = ep[1].trim() || title
      const key = `${group}|${showName}`
      let show = shows.get(key)
      if (!show) {
        show = { kind: 'series', id: `${sourceId}:s${hash(key)}`, sourceId, name: showName, group, poster: logo, episodes: [] }
        shows.set(key, show)
        res.series.push(show)
      }
      const e: Episode = { id: hash(url), title, season: +ep[2], episode: +ep[3], url, still: logo }
      show.episodes!.push(e)
    } else if (/\/(movie|movies|vod)\//i.test(url) || VOD_EXT.test(url)) {
      res.movies.push({ kind: 'movie', id, sourceId, name: title, group, url, poster: logo })
    } else {
      const num = parseInt(a['tvg-chno'] || '', 10)
      res.channels.push({
        kind: 'live', id, sourceId, name: title, group, url, logo,
        epgId: a['tvg-id'] || undefined,
        num: Number.isFinite(num) ? num : undefined
      })
    }
    info = null
    name = ''
    extGroup = ''
  }
  for (const s of res.series) s.episodes!.sort((x, y) => x.season - y.season || x.episode - y.episode)
  return res
}
