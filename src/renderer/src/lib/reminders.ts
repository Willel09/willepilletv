// Reminders for live programmes: a notification when one starts. Kept on this device.
import { useEffect, useState } from 'react'
import { readLocal, writeLocal } from './store-local'

export interface Reminder {
  channelId: string
  channelName: string
  title: string
  start: number
}

const KEY = 'lumen:reminders'
const EVENT = 'lumen:reminders'
const idOf = (r: { channelId: string; start: number }) => `${r.channelId}@${r.start}`
const read = () => readLocal<Reminder[]>(KEY, [])
const save = (list: Reminder[]) => (writeLocal(KEY, list), window.dispatchEvent(new Event(EVENT)))

/** Notifications exist on the PC and the web; TVs have none */
export const remindersSupported = () => typeof Notification !== 'undefined' && document.documentElement.dataset.device !== 'tv'

export function toggleReminder(r: Reminder): boolean {
  const list = read()
  const on = list.some((x) => idOf(x) === idOf(r))
  save(on ? list.filter((x) => idOf(x) !== idOf(r)) : [...list, r])
  if (!on && Notification.permission === 'default') void Notification.requestPermission()
  return !on
}

export function useReminders(): Set<string> {
  const [list, setList] = useState(read)
  useEffect(() => {
    const on = () => setList(read())
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  return new Set(list.map(idOf))
}
export const reminderKey = idOf

/** Reminders to fire now (starting within a minute, or just started); also drops the ones long past */
export function takeDue(now = Date.now()): Reminder[] {
  const list = read()
  const due = list.filter((r) => r.start - now <= 60_000 && now - r.start < 5 * 60_000)
  const keep = list.filter((r) => r.start - now > 60_000)
  if (keep.length !== list.length) save(keep)
  return due
}
