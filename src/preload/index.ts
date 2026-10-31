import { contextBridge, ipcRenderer } from 'electron'
import type { IptvApi } from '../shared/types'

const on = <T>(channel: string, cb: (v: T) => void) => {
  const fn = (_e: unknown, v: T) => cb(v)
  ipcRenderer.on(channel, fn)
  return () => void ipcRenderer.removeListener(channel, fn)
}

const api: IptvApi = {
  platform: process.platform,
  device: 'desktop',
  version: ipcRenderer.sendSync('app:version'),
  getStore: () => ipcRenderer.invoke('store:all'),
  setStore: (key, value) => ipcRenderer.invoke('store:set', key, value),
  getLibrary: () => ipcRenderer.invoke('library:get'),
  refreshLibrary: () => ipcRenderer.invoke('library:refresh'),
  getEpg: () => ipcRenderer.invoke('epg:get'),
  refreshEpg: () => ipcRenderer.invoke('epg:refresh'),
  mediaInfo: (sourceId, kind, id) => ipcRenderer.invoke('media:info', sourceId, kind, id),
  pickPlaylistFile: () => ipcRenderer.invoke('dialog:playlist'),
  readPlaylistFile: (path) => ipcRenderer.invoke('file:read', path),
  openInVlc: (url, title) => ipcRenderer.invoke('vlc:open', url, title),
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
    close: () => ipcRenderer.send('win:close'),
    setFullscreen: (on) => ipcRenderer.send('win:fullscreen', on),
    setMaterial: (m) => ipcRenderer.send('win:material', m),
    setTheme: (mode) => ipcRenderer.send('win:theme', mode)
  },
  onWindowState: (cb) => on('win:state', cb),
  onProgress: (cb) => on('progress', cb),
  tvInstall: {
    localIps: () => ipcRenderer.invoke('tv:ips'),
    discover: () => ipcRenderer.invoke('tv:discover'),
    checkDevMode: (ip) => ipcRenderer.invoke('tv:devmode', ip),
    openInstaller: () => ipcRenderer.invoke('tv:installer')
  },
  update: {
    check: () => ipcRenderer.send('update:check'),
    install: () => ipcRenderer.send('update:install'),
    onState: (cb) => on('update:state', cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
