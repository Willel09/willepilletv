// "Not for me": titles Random never picks again. Kept on this device.
import { readLocal, writeLocal } from './store-local'

const KEY = 'lumen:notforme'
export const notForMe = () => new Set(readLocal<string[]>(KEY, []))
export function markNotForMe(id: string) {
  writeLocal(KEY, [...new Set([...readLocal<string[]>(KEY, []), id])].slice(-2000))
}
export const clearNotForMe = () => writeLocal(KEY, [])
