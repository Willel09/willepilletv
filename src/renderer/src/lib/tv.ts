// Samsung remotes send Tizen key codes; translate them into named keys so the rest of the app
// can handle them like keyboard input (Back behaves like Esc, CH+/− like PageUp/PageDown, ...).

const TIZEN_KEYS: Record<number, string> = {
  10009: 'Escape', // Back
  415: 'MediaPlay',
  19: 'MediaPause',
  10252: 'MediaPlayPause',
  413: 'MediaStop',
  412: 'MediaRewind',
  417: 'MediaFastForward',
  427: 'ChannelUp',
  428: 'ChannelDown',
  403: 'ColorF0Red',
  404: 'ColorF1Green',
  405: 'ColorF2Yellow',
  406: 'ColorF3Blue'
}

export function initTvKeys() {
  const onKey = (e: KeyboardEvent) => {
    const key = TIZEN_KEYS[e.keyCode]
    if (!key || e.key === key) return
    e.preventDefault()
    e.stopImmediatePropagation()
    // re-dispatch with a readable key name; keyCode is 0 on the copy so this handler skips it
    ;(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  }
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}
