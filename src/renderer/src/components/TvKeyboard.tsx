import { ArrowBigUp, Delete } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

// TVs: our own on-screen keyboard instead of Tizen's. Text fields are made read-only when they get focus (so
// Tizen never opens its keyboard); OK on a field (or opening Search) shows this one, driven with the arrows.

type Text = HTMLInputElement | HTMLTextAreaElement
export const isTextField = (el: unknown): el is Text =>
  (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range', 'file', 'hidden'].includes(el.type)) || el instanceof HTMLTextAreaElement

const LETTERS = ['abcdefghij', 'klmnopqrst', 'uvwxyzåäö-'].map((r) => [...r])
const SYMBOLS = [[...'./:@_?=&%#'], [...'+~!$*(),\'"'], ['.com', '.se', 'www.', 'http://', 'https://']]
const DIGITS = [...'1234567890']

/** Sets the value the way typing does, so React's onChange sees it */
function write(el: Text, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function Key({ children, onClick, wide, first, label }: { children: ReactNode; onClick: () => void; wide?: boolean; first?: boolean; label?: string }) {
  return (
    <button
      aria-label={label}
      data-nav-default={first ? '' : undefined}
      onClick={onClick}
      className={`kb-key grid h-14 place-items-center rounded-2xl bg-fg/10 px-3 text-[20px] font-semibold text-fg ${wide ? 'flex-1' : 'min-w-14'}`}
    >
      {children}
    </button>
  )
}

export function TvKeyboard() {
  const [target, setTarget] = useState<Text | null>(null)
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'abc' | 'ABC' | 'sym'>('abc')
  // while we hand focus back to the field and send it Enter, that must not open the keyboard again
  const closing = useRef(false)

  useEffect(() => {
    const open = (el: Text) => (setText(el.value), setMode('abc'), setTarget(el))
    const ours = (el: unknown): el is Text => isTextField(el) && el.dataset.kb === '1'
    const onFocus = (e: FocusEvent) => {
      const el = e.target
      // a field the app itself made read-only (e.g. a chosen file) stays untouched
      if (!isTextField(el) || (el.readOnly && !ours(el))) return
      el.readOnly = true
      el.dataset.kb = '1'
      if (!closing.current && el.hasAttribute('data-keyboard-auto')) open(el)
    }
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (e.key !== 'Enter' || closing.current || !ours(el)) return
      e.preventDefault()
      open(el)
    }
    const onClick = (e: MouseEvent) => ours(e.target) && !closing.current && open(e.target)
    window.addEventListener('focusin', onFocus)
    window.addEventListener('keydown', onKey)
    window.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('focusin', onFocus)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onClick)
    }
  }, [])

  const type = (edit: (s: string) => string) => {
    if (!target) return
    let v = edit(target.value)
    if (target.maxLength > 0) v = v.slice(0, target.maxLength)
    write(target, v)
    setText(v)
  }

  // Done or Back: focus returns to the field, and Enter tells it the text is finished (fields that save on Enter save)
  const close = () => {
    const el = target
    setTarget(null)
    if (!el?.isConnected) return
    closing.current = true
    el.focus({ preventScroll: true })
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    closing.current = false
  }

  // While open: Back closes, and number keys on the remote (or a USB keyboard) type
  const keys = useRef({ type, close })
  keys.current = { type, close }
  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current
      if (e.key === 'Escape') k.close()
      else if (e.key === 'Backspace') k.type((s) => s.slice(0, -1))
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) k.type((s) => s + e.key)
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [target])

  // start on "a", not on the field behind the keyboard
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => panel.current?.querySelector<HTMLElement>('[data-nav-default]')?.focus({ preventScroll: true }), [target])

  if (!target) return null
  const rows = mode === 'sym' ? SYMBOLS : mode === 'ABC' ? LETTERS.map((r) => r.map((c) => c.toUpperCase())) : LETTERS
  const shown = target.type === 'password' ? '•'.repeat(text.length) : text

  return (
    <div ref={panel} data-nav-scope className="fixed inset-x-0 bottom-0 z-[70] border-t border-fg/10 bg-[rgb(var(--base-rgb))] pb-8 pt-5 shadow-[0_-30px_60px_rgb(0_0_0/0.5)]">
      <div className="mx-auto w-[720px]">
        <div className="mb-4 flex h-14 items-center overflow-hidden rounded-2xl bg-fg/8 px-5 text-[22px] font-medium">
          <span className="truncate">{shown || <span className="text-fg/35">{target.placeholder || 'Type with the remote'}</span>}</span>
          <span className="ml-0.5 h-7 w-[3px] shrink-0 rounded bg-[var(--accent)]" />
        </div>
        {[...rows, DIGITS].map((row, i) => (
          <div key={`${mode}${i}`} className="mb-2 flex gap-2">
            {row.map((k, j) => (
              <Key key={k} wide first={i === 0 && j === 0} onClick={() => type((s) => s + k)}>{k}</Key>
            ))}
          </div>
        ))}
        <div className="flex gap-2">
          {mode !== 'sym' && (
            <Key label="Upper case" onClick={() => setMode(mode === 'abc' ? 'ABC' : 'abc')}>
              <ArrowBigUp className={`size-6 ${mode === 'ABC' ? 'fill-current' : ''}`} />
            </Key>
          )}
          <Key onClick={() => setMode(mode === 'sym' ? 'abc' : 'sym')}>{mode === 'sym' ? 'abc' : '#+='}</Key>
          <Key wide onClick={() => type((s) => s + ' ')}>Space</Key>
          <Key label="Delete" onClick={() => type((s) => s.slice(0, -1))}><Delete className="size-6" /></Key>
          <Key onClick={() => type(() => '')}>Clear</Key>
          <Key onClick={close}>Done</Key>
        </div>
      </div>
    </div>
  )
}
