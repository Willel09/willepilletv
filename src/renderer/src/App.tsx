import { AnimatePresence, MotionConfig, MotionGlobalConfig, motion } from 'framer-motion'
import { ProfilePicker } from './screens/Profiles'
import { useEffect } from 'react'
import { Ambient } from './components/Ambient'
import { Screensaver, useIdle } from './components/Screensaver'
import { TitleBar, visibleTabs } from './components/TitleBar'
import { Toast } from './components/Toast'
import { initSpatialNav } from './lib/nav'
import { initTvKeys } from './lib/tv'
import { spring } from './lib/motion'
import Player from './player/Player'
import Browse from './screens/Browse'
import Detail from './screens/Detail'
import Downloads from './screens/Downloads'
import Home from './screens/Home'
import PersonPage from './screens/Person'
import Live from './screens/Live'
import Random from './screens/Random'
import Search from './screens/Search'
import Settings, { SourceSheet } from './screens/Settings'
import { api, boot, closeDetail, closePerson, play, setTab, toast, useApp } from './store'


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
        {tab === 'random' && <Random />}
        {tab === 'downloads' && <Downloads />}
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

// TVs: every framer animation (including exits, which otherwise keep a closed screen around) finishes at once
if (api.device === 'tv') MotionGlobalConfig.skipAnimations = true

export default function App() {
  const booted = useApp((s) => s.booted)
  const detail = useApp((s) => s.detail)
  const person = useApp((s) => s.person)
  const pickProfile = useApp((s) => s.pickProfile)
  const player = useApp((s) => s.player)
  const sheet = useApp((s) => s.sourceSheet)
  const [saver, wake] = useIdle(useApp((s) => s.settings.screensaverMins))

  useEffect(() => {
    // must run before every other key handler (registers the first capture listener)
    const offTv = api.device === 'tv' ? initTvKeys() : () => {}
    boot().catch((e: Error) => toast(`Lumen couldn't start properly: ${e.message}`))
    const offProgress = api.onProgress((progress) => useApp.setState({ progress }))
    const offNav = initSpatialNav()
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState()
      // the full-screen player owns the keyboard; a mini player leaves the app navigable
      if ((s.player && !s.playerMini) || s.sourceSheet) return
      if ((e.ctrlKey && e.key === 'f') || (e.key === '/' && !isTyping())) {
        e.preventDefault()
        return setTab('search')
      }
      if (e.ctrlKey && /^[1-7]$/.test(e.key)) return visibleTabs()[+e.key - 1] && setTab(visibleTabs()[+e.key - 1].id)
      if (e.key === 'Escape' || (e.key === 'Backspace' && !isTyping())) {
        if (s.person) closePerson()
        else if (s.detail) closeDetail()
        else if (isTyping()) (document.activeElement as HTMLElement).blur()
        else if (s.tab !== 'home') setTab('home')
        else if (api.device === 'tv') api.win.close() // Back on Home exits the TV app
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
      offTv()
      offProgress()
      offNav()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
    }
  }, [])

  return (
    // TVs: no movement animations (framer then jumps straight to the end state), which keeps the remote snappy
    <MotionConfig reducedMotion={api.device === 'tv' ? 'always' : 'user'} transition={api.device === 'tv' ? { duration: 0 } : spring}>
      <Ambient />
      {booted && (
        <div className="relative h-full">
          <main className="absolute inset-0">
            <Screen />
          </main>
          <AnimatePresence>{detail && <Detail key={detail.id} item={detail} />}</AnimatePresence>
          <AnimatePresence>{person && <PersonPage key={`${person.role}:${person.name}`} name={person.name} role={person.role} />}</AnimatePresence>
          <TitleBar />
        </div>
      )}
      <AnimatePresence>{player && <Player key="player" req={player} />}</AnimatePresence>
      <AnimatePresence>{sheet && <SourceSheet key="sheet" sheet={sheet} />}</AnimatePresence>
      <AnimatePresence>{booted && pickProfile && <ProfilePicker key="profiles" />}</AnimatePresence>
      <Toast />
      {saver && <Screensaver onWake={wake} />}
    </MotionConfig>
  )
}
