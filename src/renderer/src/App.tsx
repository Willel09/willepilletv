import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { useEffect } from 'react'
import { Ambient } from './components/Ambient'
import { TABS, TitleBar } from './components/TitleBar'
import { Toast } from './components/Toast'
import { initSpatialNav } from './lib/nav'
import { spring } from './lib/motion'
import Player from './player/Player'
import Browse from './screens/Browse'
import Detail from './screens/Detail'
import Home from './screens/Home'
import Live from './screens/Live'
import Search from './screens/Search'
import Settings, { SourceSheet } from './screens/Settings'
import { api, boot, closeDetail, play, setTab, useApp } from './store'


function Screen() {
  const tab = useApp((s) => s.tab)
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={tab}
        className="absolute inset-0"
        initial={{ opacity: 0, y: 14, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.99 }}
        transition={spring}
      >
        {tab === 'home' && <Home />}
        {tab === 'live' && <Live />}
        {tab === 'movies' && <Browse kind="movies" />}
        {tab === 'series' && <Browse kind="series" />}
        {tab === 'search' && <Search />}
        {tab === 'settings' && <Settings />}
      </motion.div>
    </AnimatePresence>
  )
}

const isTyping = () => {
  const el = document.activeElement
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
}

export default function App() {
  const booted = useApp((s) => s.booted)
  const detail = useApp((s) => s.detail)
  const player = useApp((s) => s.player)
  const sheet = useApp((s) => s.sourceSheet)

  useEffect(() => {
    boot()
    const offProgress = api.onProgress((progress) => useApp.setState({ progress }))
    const offNav = initSpatialNav()
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState()
      if (s.player || s.sourceSheet) return
      if ((e.ctrlKey && e.key === 'f') || (e.key === '/' && !isTyping())) {
        e.preventDefault()
        return setTab('search')
      }
      if (e.ctrlKey && /^[1-6]$/.test(e.key)) return setTab(TABS[+e.key - 1].id)
      if (e.key === 'Escape' || (e.key === 'Backspace' && !isTyping())) {
        if (s.detail) closeDetail()
        else if (isTyping()) (document.activeElement as HTMLElement).blur()
        else if (s.tab !== 'home') setTab('home')
      }
    }
    // Paste a stream URL anywhere to play it straight away
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text').trim() ?? ''
      if (isTyping() || useApp.getState().player || !/^(https?|rtmp|rtsp):\/\/\S+$/i.test(text)) return
      play({ kind: /\.(mp4|mkv|avi|mov|webm|m4v)(\?|$)/i.test(text) ? 'movie' : 'live', id: `url:${text}`, url: text, title: new URL(text).hostname })
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    return () => {
      offProgress()
      offNav()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
    }
  }, [])

  return (
    <MotionConfig reducedMotion="user" transition={spring}>
      <Ambient />
      {booted && (
        <div className="relative h-full">
          <main className="absolute inset-0">
            <Screen />
          </main>
          <AnimatePresence>{detail && <Detail key={detail.id} item={detail} />}</AnimatePresence>
          <TitleBar />
        </div>
      )}
      <AnimatePresence>{player && <Player key="player" req={player} />}</AnimatePresence>
      <AnimatePresence>{sheet && <SourceSheet key="sheet" sheet={sheet} />}</AnimatePresence>
      <Toast />
    </MotionConfig>
  )
}
