import { app, Menu, Tray, type BrowserWindow } from 'electron'

export type TrayAction = 'resume' | 'random' | 'search'

/**
 * The icon in the notification area (the Windows counterpart of the Mac menu bar item): click to show or hide
 * Lumen, right-click for Continue Watching, a random pick, Search and Quit. The icon is the app's own (the exe).
 */
export function startTray(getWin: () => BrowserWindow | null, act: (a: TrayAction) => void) {
  let tray: Tray | null = null
  let resume: string | null = null
  const show = () => {
    const w = getWin()
    if (!w || w.isDestroyed()) return
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }
  const menu = () =>
    Menu.buildFromTemplate([
      { label: 'Open Lumen', click: show },
      { type: 'separator' },
      { label: resume ? `Continue: ${resume}` : 'Nothing to continue yet', enabled: !!resume, click: () => (show(), act('resume')) },
      { label: 'Surprise me', click: () => (show(), act('random')) },
      { label: 'Search', click: () => (show(), act('search')) },
      { type: 'separator' },
      { label: 'Quit Lumen', click: () => app.quit() }
    ])
  void app.getFileIcon(process.execPath, { size: 'small' }).then((icon) => {
    tray = new Tray(icon)
    tray.setToolTip('Lumen')
    tray.setContextMenu(menu())
    tray.on('click', () => {
      const w = getWin()
      if (w?.isVisible() && w.isFocused()) w.hide()
      else show()
    })
  }).catch(() => {
    /* no notification area (some Linux setups): the app works without the icon */
  })
  return {
    setResume(title: string | null) {
      resume = title ? title.slice(0, 60) : null
      tray?.setContextMenu(menu())
    }
  }
}
