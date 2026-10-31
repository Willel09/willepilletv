// Cross-device sync over a tiny Supabase backend.
// Everything is encrypted on the device (AES-GCM, key derived from your sync code with PBKDF2),
// and rows are addressed by SHA-256(code), so the server never sees the code or your data.

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

export const supported = () => typeof crypto !== 'undefined' && !!crypto.subtle

/* ---------------- codes ---------------- */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I to avoid typos
const randomCode = (len: number) => Array.from(crypto.getRandomValues(new Uint8Array(len)), (b) => ALPHABET[b % 32]).join('')
const group = (s: string) => s.match(/.{1,4}/g)!.join('-')
export const normalize = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')
/** 20 chars × 5 bits = 100 bits of entropy */
export const newSyncCode = () => group(randomCode(20))
/** 12 chars (60 bits) is plenty for a code that lives 10 minutes */
export const newPairCode = () => group(randomCode(12))

/* ---------------- crypto ---------------- */

const enc = new TextEncoder()
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('')
const b64 = (u: Uint8Array) => {
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

const keys = new Map<string, Promise<{ id: string; key: CryptoKey }>>()
/** id = SHA-256(purpose:code); key = PBKDF2(code). Cached: PBKDF2 is deliberately slow (~1 s on a TV). */
function derive(code: string, purpose: 'sync' | 'pair') {
  const k = `${purpose}:${normalize(code)}`
  if (!keys.has(k))
    keys.set(
      k,
      (async () => {
        const id = hex(await crypto.subtle.digest('SHA-256', enc.encode(`lumen-${k}`)))
        const base = await crypto.subtle.importKey('raw', enc.encode(normalize(code)), 'PBKDF2', false, ['deriveKey'])
        const key = await crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: enc.encode(`lumen-${purpose}-v1`), iterations: 150_000, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        )
        return { id, key }
      })()
    )
  return keys.get(k)!
}

async function seal(key: CryptoKey, data: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data))))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return b64(out)
}

async function open<T>(key: CryptoKey, data: string): Promise<T> {
  const raw = unb64(data)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12))
  return JSON.parse(new TextDecoder().decode(pt)) as T
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
  const { id, key } = await derive(code, 'sync')
  const rows = await rpc<{ data: string }[]>('sync_get', { p_id: id })
  if (!rows.length) return null
  try {
    return await open<SyncDoc>(key, rows[0].data)
  } catch {
    throw new Error("Couldn't decrypt synced data. Is the sync code correct?")
  }
}

export async function push(code: string, doc: SyncDoc) {
  const { id, key } = await derive(code, 'sync')
  await rpc('sync_put', { p_id: id, p_data: await seal(key, doc) })
}

/** Device that already has the sync code sends it to a device showing `pairCode` */
export async function sendPairing(pairCode: string, syncCode: string) {
  const { id, key } = await derive(pairCode, 'pair')
  await rpc('sync_put', { p_id: id, p_data: await seal(key, { code: syncCode }), p_ttl_seconds: 600 })
}

/** New device polls for the sync code sent to its pairing code */
export async function receivePairing(pairCode: string): Promise<string | null> {
  const { id, key } = await derive(pairCode, 'pair')
  const rows = await rpc<{ data: string }[]>('sync_get', { p_id: id })
  if (!rows.length) return null
  const { code } = await open<{ code: string }>(key, rows[0].data)
  await rpc('sync_delete', { p_id: id })
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
