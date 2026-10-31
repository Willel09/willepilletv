import { app } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'

const cacheFile = (name: string) => join(app.getPath('userData'), `${name}.json`)

export async function readCache<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(cacheFile(name), 'utf8')) as T
  } catch {
    return null
  }
}

export const writeCache = (name: string, data: unknown) => writeFile(cacheFile(name), JSON.stringify(data)).catch(() => {})
