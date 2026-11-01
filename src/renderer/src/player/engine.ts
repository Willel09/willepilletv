import Hls, { type ErrorData } from 'hls.js'
import mpegts from 'mpegts.js'

export type EngineKind = 'hls' | 'mpegts' | 'native'
export interface Track {
  id: number
  label: string
}

export interface Engine {
  kind: EngineKind
  destroy(): void
  audio(): Track[]
  subs(): Track[]
  currentAudio(): number
  currentSub(): number
  setAudio(id: number): void
  setSub(id: number): void
}

/** Which playback engines to try, in order, for a stream URL */
export function pickEngines(url: string, live: boolean): EngineKind[] {
  const u = url.split(/[?#]/)[0].toLowerCase()
  if (/\.m3u8?$/.test(u) || u.includes('/hls/')) return ['hls', 'native']
  if (/\.(ts|mts|m2ts|flv)$/.test(u)) return ['mpegts', 'hls', 'native']
  if (/\.(mp4|mkv|webm|mov|m4v|avi|wmv|mp3|aac)$/.test(u)) return ['native']
  // Extension-less live URLs are almost always raw MPEG-TS
  return live ? ['mpegts', 'hls', 'native'] : ['native', 'hls', 'mpegts']
}

function httpHint(code?: number) {
  if (code === 401 || code === 403) return `Access denied by the provider (HTTP ${code}). Your subscription may have expired, or you're already watching on the maximum number of devices.`
  if (code === 404) return 'This stream was not found (HTTP 404). The channel may have been removed or is offline.'
  if (code === 458 || code === 509 || code === 429) return `The provider is limiting connections (HTTP ${code}). Close other players and try again.`
  if (code && code >= 500) return `The provider's server had a problem (HTTP ${code}). Try again in a moment.`
  return undefined
}

const CODEC = "This stream uses a video or audio format that the built-in player can't decode (for example HEVC/H.265, AC3 or DTS)."

function describeHls(d: ErrorData) {
  const code = d.response?.code
  if (d.type === Hls.ErrorTypes.NETWORK_ERROR) return httpHint(code) ?? "Couldn't connect to the stream. The channel may be offline or your connection dropped."
  if (d.type === Hls.ErrorTypes.MEDIA_ERROR) return CODEC
  return `Playback failed (${d.details}).`
}

function describeMpegts(type: string, detail: string, info?: { code?: number; msg?: string }) {
  if (type === mpegts.ErrorTypes.NETWORK_ERROR) {
    if (detail === mpegts.ErrorDetails.NETWORK_STATUS_CODE_INVALID) return httpHint(info?.code) ?? `The server rejected the stream (HTTP ${info?.code}).`
    if (detail === mpegts.ErrorDetails.NETWORK_TIMEOUT) return 'The stream took too long to start. The server may be overloaded.'
    return "Couldn't connect to the stream. The channel may be offline or your connection dropped."
  }
  if (type === mpegts.ErrorTypes.MEDIA_ERROR) return CODEC
  return `Playback failed (${detail}).`
}

function describeNative(e: MediaError | null) {
  switch (e?.code) {
    case MediaError.MEDIA_ERR_NETWORK: return 'A network error interrupted the video.'
    case MediaError.MEDIA_ERR_DECODE: return CODEC
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: return "This file format isn't supported by the built-in player, or the server refused it."
    default: return 'Playback failed.'
  }
}

interface NativeTrackList<T> extends ArrayLike<T> {
  addEventListener(t: string, fn: () => void): void
}
type NativeAudio = { label: string; language: string; enabled: boolean }

/** Samsung TVs: video buffers live in the same limited memory as the app, so keep them short */
const TV = typeof (window as { tizen?: unknown }).tizen !== 'undefined'

export function createEngine(kind: EngineKind, video: HTMLVideoElement, url: string, live: boolean, onFatal: (msg: string) => void, onTracks: () => void): Engine {
  if (kind === 'hls') {
    const hls = new Hls({
      enableWorker: true,
      backBufferLength: TV ? 10 : 30,
      maxBufferLength: live ? 20 : TV ? 30 : 60,
      maxBufferSize: (TV ? 30 : 60) * 1000 * 1000,
      liveDurationInfinity: true,
      manifestLoadingMaxRetry: 2,
      fragLoadingMaxRetry: 4
    })
    let recovered = false
    hls.on(Hls.Events.ERROR, (_e, d) => {
      if (!d.fatal) return
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
        recovered = true
        return hls.recoverMediaError()
      }
      onFatal(describeHls(d))
    })
    for (const ev of [Hls.Events.MANIFEST_PARSED, Hls.Events.AUDIO_TRACKS_UPDATED, Hls.Events.SUBTITLE_TRACKS_UPDATED, Hls.Events.AUDIO_TRACK_SWITCHED, Hls.Events.SUBTITLE_TRACK_SWITCH]) hls.on(ev, onTracks)
    hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().catch(() => {}))
    hls.loadSource(url)
    hls.attachMedia(video)
    hls.subtitleDisplay = false
    const label = (t: { name?: string; lang?: string }, i: number) => t.name || t.lang || `Track ${i + 1}`
    return {
      kind,
      destroy: () => hls.destroy(),
      audio: () => hls.audioTracks.map((t, i) => ({ id: i, label: label(t, i) })),
      subs: () => hls.subtitleTracks.map((t, i) => ({ id: i, label: label(t, i) })),
      currentAudio: () => hls.audioTrack,
      currentSub: () => (hls.subtitleDisplay ? hls.subtitleTrack : -1),
      setAudio: (id) => (hls.audioTrack = id),
      setSub: (id) => {
        hls.subtitleDisplay = id >= 0
        if (id >= 0) hls.subtitleTrack = id
        onTracks()
      }
    }
  }

  if (kind === 'mpegts') {
    const p = mpegts.createPlayer(
      { type: /\.flv(\?|$)/i.test(url) ? 'flv' : 'mpegts', isLive: live, url },
      {
        enableWorker: true, lazyLoad: !live, liveBufferLatencyChasing: live, liveBufferLatencyMaxLatency: 8, liveBufferLatencyMinRemain: 2,
        autoCleanupSourceBuffer: true,
        // default keeps 3 minutes of watched video (hundreds of MB at 4K bitrates): too much for a TV
        ...(TV ? { autoCleanupMaxBackwardDuration: 30, autoCleanupMinBackwardDuration: 15, lazyLoadMaxDuration: 60 } : {})
      }
    )
    p.on(mpegts.Events.ERROR, (type: string, detail: string, info?: { code?: number; msg?: string }) => onFatal(describeMpegts(type, detail, info)))
    p.attachMediaElement(video)
    p.load()
    void Promise.resolve(p.play()).catch(() => {})
    return {
      kind,
      destroy: () => {
        try {
          p.pause()
          p.unload()
          p.detachMediaElement()
          p.destroy()
        } catch {
          /* already torn down */
        }
      },
      audio: () => [],
      subs: () => [],
      currentAudio: () => -1,
      currentSub: () => -1,
      setAudio: () => {},
      setSub: () => {}
    }
  }

  // Native <video>: MP4/MKV/WebM. audioTracks needs the AudioVideoTracks blink feature (enabled in main).
  const onError = () => onFatal(describeNative(video.error))
  video.addEventListener('error', onError)
  video.src = url
  void video.play().catch(() => {})
  const at = (video as unknown as { audioTracks?: NativeTrackList<NativeAudio> }).audioTracks
  at?.addEventListener('change', onTracks)
  at?.addEventListener('addtrack', onTracks)
  video.textTracks.addEventListener('addtrack', onTracks)
  video.addEventListener('loadedmetadata', onTracks)
  const audios = () => (at ? Array.from(at) : [])
  return {
    kind,
    destroy: () => {
      video.removeEventListener('error', onError)
      video.removeEventListener('loadedmetadata', onTracks)
      video.removeAttribute('src')
      video.load()
    },
    // MP4 muxers often label tracks "SoundHandler"; the language is more useful
    audio: () => audios().map((t, i) => ({ id: i, label: (!/handler/i.test(t.label) && t.label) || (t.language && t.language !== 'und' ? t.language.toUpperCase() : `Track ${i + 1}`) })),
    subs: () => Array.from(video.textTracks).map((t, i) => ({ id: i, label: t.label || t.language || `Subtitle ${i + 1}` })),
    currentAudio: () => audios().findIndex((t) => t.enabled),
    currentSub: () => Array.from(video.textTracks).findIndex((t) => t.mode === 'showing'),
    setAudio: (id) => audios().forEach((t, i) => (t.enabled = i === id)),
    setSub: (id) => {
      Array.from(video.textTracks).forEach((t, i) => (t.mode = i === id ? 'showing' : 'disabled'))
      onTracks()
    }
  }
}
