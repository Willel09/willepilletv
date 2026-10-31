// Cross-device sync over a tiny Supabase backend.
// Everything is encrypted on the device (AES-GCM, key derived from your sync code with PBKDF2),
// and rows are addressed by SHA-256(code), so the server never sees the code or your data.

import { gcm } from '@noble/ciphers/aes.js'
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import type { HistoryEntry, Item, Movie, Settings, Show, Source, SyncMeta } from '../../../shared/types'

const SB_URL = 'https://cbqjczxbcodebmgawknz.supabase.co/rest/v1/rpc'
// Publishable key: safe to ship in the app (the database only exposes the three sync_* functions)
const SB_KEY = 'sb_publishable_FyC8lK8Cz_QkvHemKUnkCA_SNL85fh0'

/** Settings that follow you between devices. Window material, VLC path etc. stay per device. */
export const SYNCED_PREFS = ['theme', 'accent', 'ambient', 'epgUrl', 'autoProviderEpg', 'hiddenGroups', 'liveFormat', 'autoplayNext'] as const
export type Prefs = Partial<Pick<Settings, (typeof SYNCED_PREFS)[number]>>

export interface SyncDoc {
  v: 1
  sources: Source[]
  favorites: Item[]
  watchlist: (Movie | Show)[]
  history: HistoryEntry[]
  prefs: Prefs
  meta: SyncMeta
}

export const COLLECTIONS = ['sources', 'favorites', 'watchlist', 'history'] as const
type Coll = (typeof COLLECTIONS)[number]

/** crypto.getRandomValues works everywhere; WebCrypto (crypto.subtle) is optional, see derive() */
export const supported = () => typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'

/* ---------------- codes ---------------- */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I to avoid typos
const randomCode = (len: number) => Array.from(crypto.getRandomValues(new Uint8Array(len)), (b) => ALPHABET[b % 32]).join('')
const group = (s: string) => s.match(/.{1,4}/g)!.join('-')
export const normalize = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')
/** 20 chars × 5 bits = 100 bits of entropy */
export const newSyncCode = () => group(randomCode(20))
/** 12 chars (60 bits) is plenty for a code that lives 10 minutes */
export const newPairCode = () => group(randomCode(12))

/* ---------------- crypto ----------------
   PBKDF2-SHA256 (150k) -> AES-256-GCM, stored as base64(iv ‖ ciphertext ‖ tag).
   WebCrypto when available; otherwise the audited pure-JS @noble libraries produce the exact same
   bytes. Older Samsung TVs (Tizen 6.0) may not expose crypto.subtle to apps, so both must interoperate. */

const enc = new TextEncoder()
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const b64 = (u: Uint8Array) => {
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(u.subarray(i, i + 0x8000)))
  return btoa(s)
}
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

interface Box {
  id: string
  seal(data: unknown): Promise<string>
  open<T>(data: string): Promise<T>
}

const ITERATIONS = 150_000
const boxes = new Map<string, Promise<Box>>()

/** id = SHA-256(purpose:code); key = PBKDF2(code). Cached: PBKDF2 is deliberately slow (a few seconds on a TV). */
export function derive(code: string, purpose: 'sync' | 'pair', forceJs = false): Promise<Box> {
  const k = `${purpose}:${normalize(code)}`
  const cacheKey = forceJs ? `js:${k}` : k
  if (!boxes.has(cacheKey)) boxes.set(cacheKey, makeBox(k, normalize(code), `lumen-${purpose}-v1`, forceJs))
  return boxes.get(cacheKey)!
}

async function makeBox(k: string, secret: string, salt: string, forceJs: boolean): Promise<Box> {
  const id = hex(sha256(enc.encode(`lumen-${k}`)))
  const subtle = !forceJs && typeof crypto !== 'undefined' ? crypto.subtle : undefined
  if (subtle) {
    const base = await subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey'])
    const key = await subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode(salt), iterations: ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    return {
      id,
      async seal(data) {
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data))))
        return b64(concat(iv, ct))
      },
      async open(data) {
        const raw = unb64(data)
        return JSON.parse(new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12))))
      }
    }
  }
  // asyncTick keeps the TV UI responsive while the key is derived
  const key = await pbkdf2Async(sha256, enc.encode(secret), enc.encode(salt), { c: ITERATIONS, dkLen: 32, asyncTick: 20 })
  return {
    id,
    async seal(data) {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      return b64(concat(iv, gcm(key, iv).encrypt(enc.encode(JSON.stringify(data)))))
    },
    async open(data) {
      const raw = unb64(data)
      return JSON.parse(new TextDecoder().decode(gcm(key, raw.subarray(0, 12)).decrypt(raw.subarray(12))))
    }
  }
}

const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

/* ---------------- server ---------------- */

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${SB_URL}/${fn}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  } catch {
    throw new Error('Sync server unreachable. Check your internet connection.')
  }
  if (!res.ok) throw new Error(`Sync failed (${res.status})`)
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export async function pull(code: string): Promise<SyncDoc | null> {
  const box = await derive(code, 'sync')
  const rows = await rpc<{ data: string }[]>('sync_get', { p_id: box.id })
  if (!rows.length) return null
  try {
    return await box.open<SyncDoc>(rows[0].data)
  } catch {
    throw new Error("Couldn't decrypt synced data. Is the sync code correct?")
  }
}

export async function push(code: string, doc: SyncDoc) {
  const box = await derive(code, 'sync')
  await rpc('sync_put', { p_id: box.id, p_data: await box.seal(doc) })
}

/** Device that already has the sync code sends it to a device showing `pairCode` */
export async function sendPairing(pairCode: string, syncCode: string) {
  const box = await derive(pairCode, 'pair')
  await rpc('sync_put', { p_id: box.id, p_data: await box.seal({ code: syncCode }), p_ttl_seconds: 600 })
}

/** New device polls for the sync code sent to its pairing code */
export async function receivePairing(pairCode: string): Promise<string | null> {
  const box = await derive(pairCode, 'pair')
  const rows = await rpc<{ data: string }[]>('sync_get', { p_id: box.id })
  if (!rows.length) return null
  const { code } = await box.open<{ code: string }>(rows[0].data)
  await rpc('sync_delete', { p_id: box.id })
  return code
}

/* ---------------- merge ---------------- */

const TOMB_TTL = 90 * 86400_000
const keyOf = (c: Coll, id: string) => `${c}:${id}`

/**
 * Per-item last-writer-wins. A deletion (tombstone) beats the item if it is newer, so removing
 * something from the watchlist on one device removes it everywhere instead of resurrecting it.
 */
export function merge(local: SyncDoc, remote: SyncDoc | null): SyncDoc {
  if (!remote) return local
  const meta: SyncMeta = { at: {}, tomb: {} }
  const now = Date.now()
  for (const [k, t] of [...Object.entries(local.meta.tomb), ...Object.entries(remote.meta.tomb)])
    if (now - t < TOMB_TTL && t > (meta.tomb[k] ?? 0)) meta.tomb[k] = t

  const out = { v: 1 } as SyncDoc
  for (const c of COLLECTIONS) {
    const byId = new Map<string, { item: { id: string }; at: number }>()
    for (const [doc] of [[local], [remote]] as [SyncDoc][]) {
      for (const item of doc[c] as { id: string }[]) {
        // items saved before change-tracking existed have no timestamp: treat them as old but present
        const at = doc.meta.at[keyOf(c, item.id)] ?? 1
        const cur = byId.get(item.id)
        if (!cur || at > cur.at) byId.set(item.id, { item, at })
      }
    }
    const kept = [...byId.values()].filter(({ item, at }) => at > (meta.tomb[keyOf(c, item.id)] ?? 0))
    // newest first, except sources where the user's order matters
    if (c !== 'sources') kept.sort((a, b) => b.at - a.at)
    if (c === 'history') kept.splice(300) // same cap as on-device history, so every device converges
    for (const { item, at } of kept) meta.at[keyOf(c, item.id)] = at
    ;(out[c] as { id: string }[]) = kept.map((k) => k.item)
  }
  const lp = local.meta.at.prefs ?? 0
  const rp = remote.meta.at.prefs ?? 0
  out.prefs = rp > lp ? remote.prefs : local.prefs
  meta.at.prefs = Math.max(lp, rp)
  out.meta = meta
  return out
}
