// Profile avatars: little SVG characters assembled from parts (ears, eyes, mouth, extras).
import { useId } from 'react'

type Ears = 'cat' | 'bear' | 'bunny' | 'antenna' | 'antennae' | 'horns' | 'tuft' | 'none'
type Eyes = 'dot' | 'big' | 'happy' | 'visor' | 'sleepy' | 'cyclops' | 'frog' | 'panda'
type Mouth = 'smile' | 'open' | 'cat' | 'teeth' | 'o' | 'beak' | 'wide'

interface Look {
  id: string
  label: string
  bg: [string, string]
  face: string
  shape?: 'round' | 'box' | 'ghost'
  ears: Ears
  earColor?: string
  eyes: Eyes
  mouth: Mouth
  cheeks?: boolean
  snout?: boolean
  spots?: boolean
}

export const AVATARS: Look[] = [
  { id: 'kitty', label: 'Kitty', bg: ['#ff9a8b', '#ff6a88'], face: '#ffb86b', ears: 'cat', eyes: 'big', mouth: 'cat', cheeks: true },
  { id: 'bear', label: 'Bear', bg: ['#f6d365', '#fda085'], face: '#a0673f', ears: 'bear', eyes: 'dot', mouth: 'smile', snout: true },
  { id: 'bunny', label: 'Bunny', bg: ['#a1c4fd', '#c2e9fb'], face: '#ffffff', ears: 'bunny', eyes: 'big', mouth: 'o', cheeks: true },
  { id: 'robot', label: 'Robot', bg: ['#4facfe', '#00c6fb'], face: '#d5dde8', shape: 'box', ears: 'antenna', eyes: 'visor', mouth: 'teeth' },
  { id: 'alien', label: 'Alien', bg: ['#43e97b', '#38f9d7'], face: '#8be36b', ears: 'antennae', eyes: 'big', mouth: 'smile', spots: true },
  { id: 'monster', label: 'Monster', bg: ['#a18cd1', '#fbc2eb'], face: '#8e5bd8', ears: 'horns', eyes: 'cyclops', mouth: 'teeth' },
  { id: 'frog', label: 'Frog', bg: ['#d4fc79', '#96e6a1'], face: '#5cc45c', ears: 'none', eyes: 'frog', mouth: 'wide', cheeks: true },
  { id: 'ghost', label: 'Ghost', bg: ['#30cfd0', '#330867'], face: '#f4f4ff', shape: 'ghost', ears: 'none', eyes: 'dot', mouth: 'o', cheeks: true },
  { id: 'devil', label: 'Devil', bg: ['#f093fb', '#f5576c'], face: '#ff5a5a', ears: 'horns', eyes: 'happy', mouth: 'open' },
  { id: 'panda', label: 'Panda', bg: ['#e0c3fc', '#8ec5fc'], face: '#ffffff', ears: 'bear', earColor: '#25252f', eyes: 'panda', mouth: 'smile' },
  { id: 'dozy', label: 'Dozy', bg: ['#fddb92', '#d1fdff'], face: '#c8a27a', ears: 'none', eyes: 'sleepy', mouth: 'smile', cheeks: true },
  { id: 'chick', label: 'Chick', bg: ['#fff1a8', '#ffb347'], face: '#ffd84d', ears: 'tuft', eyes: 'dot', mouth: 'beak', cheeks: true }
]

const INK = '#1d1d29'
const PINK = '#ff8fab'

function EarsPart({ type, c }: { type: Ears; c: string }) {
  switch (type) {
    case 'cat':
      return <g><polygon points="22,46 28,14 48,32" fill={c} /><polygon points="78,46 72,14 52,32" fill={c} /><polygon points="28,38 31,22 41,32" fill={PINK} /><polygon points="72,38 69,22 59,32" fill={PINK} /></g>
    case 'bear':
      return <g><circle cx="27" cy="33" r="12" fill={c} /><circle cx="73" cy="33" r="12" fill={c} /><circle cx="27" cy="33" r="5.5" fill="#000" opacity=".22" /><circle cx="73" cy="33" r="5.5" fill="#000" opacity=".22" /></g>
    case 'bunny':
      return <g><ellipse cx="38" cy="20" rx="8" ry="19" fill={c} /><ellipse cx="62" cy="20" rx="8" ry="19" fill={c} /><ellipse cx="38" cy="21" rx="3.5" ry="13" fill={PINK} /><ellipse cx="62" cy="21" rx="3.5" ry="13" fill={PINK} /></g>
    case 'antenna':
      return <g><line x1="50" y1="32" x2="50" y2="14" stroke="#8a96a8" strokeWidth="3" /><circle cx="50" cy="12" r="5" fill="#ff5a7a" /></g>
    case 'antennae':
      return <g stroke={c} strokeWidth="3" strokeLinecap="round"><line x1="41" y1="32" x2="32" y2="14" /><line x1="59" y1="32" x2="68" y2="14" /><circle cx="31" cy="12" r="5" fill="#ffe14d" stroke="none" /><circle cx="69" cy="12" r="5" fill="#ffe14d" stroke="none" /></g>
    case 'horns':
      return <g fill="#ffe9a8"><path d="M30 42 Q20 22 30 12 Q32 28 42 34 Z" /><path d="M70 42 Q80 22 70 12 Q68 28 58 34 Z" /></g>
    case 'tuft':
      return <g fill={c}><path d="M50 30 Q44 16 50 10 Q52 20 50 30 Z" /><path d="M50 30 Q56 18 64 16 Q56 24 50 30 Z" /><path d="M50 30 Q42 20 36 20 Q44 24 50 30 Z" /></g>
    default:
      return null
  }
}

function Head({ look }: { look: Look }) {
  if (look.shape === 'box') return <rect x="22" y="30" width="56" height="54" rx="13" fill={look.face} />
  if (look.shape === 'ghost') return <path d="M22 60 a28 28 0 0 1 56 0 v26 l-7 -6 -7 6 -7 -6 -7 6 -7 -6 -7 6 -7 -6 -7 6 Z" fill={look.face} />
  return <circle cx="50" cy="58" r="30" fill={look.face} />
}

function EyesPart({ type, face }: { type: Eyes; face: string }) {
  const pupil = (cx: number, cy: number, r = 4.5) => <g><circle cx={cx} cy={cy} r={r} fill={INK} /><circle cx={cx + r * 0.35} cy={cy - r * 0.35} r={r * 0.35} fill="#fff" /></g>
  switch (type) {
    case 'dot':
      return <g>{pupil(39, 54)}{pupil(61, 54)}</g>
    case 'big':
      return <g><circle cx="39" cy="53" r="8.5" fill="#fff" /><circle cx="61" cy="53" r="8.5" fill="#fff" />{pupil(40, 54, 5)}{pupil(62, 54, 5)}</g>
    case 'happy':
      return <g fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round"><path d="M32 56 q7 -8 14 0" /><path d="M54 56 q7 -8 14 0" /></g>
    case 'sleepy':
      return <g fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round"><path d="M32 53 q7 6 14 0" /><path d="M54 53 q7 6 14 0" /></g>
    case 'visor':
      return <g><rect x="29" y="45" width="42" height="15" rx="7.5" fill={INK} /><circle cx="40" cy="52.5" r="4" fill="#5ff3ff" /><circle cx="60" cy="52.5" r="4" fill="#5ff3ff" /></g>
    case 'cyclops':
      return <g><circle cx="50" cy="51" r="13" fill="#fff" />{pupil(51, 52, 6.5)}</g>
    case 'frog':
      return <g><circle cx="35" cy="34" r="11" fill={face} /><circle cx="65" cy="34" r="11" fill={face} /><circle cx="35" cy="34" r="7.5" fill="#fff" /><circle cx="65" cy="34" r="7.5" fill="#fff" />{pupil(36, 35)}{pupil(66, 35)}</g>
    case 'panda':
      return <g><ellipse cx="38" cy="54" rx="8" ry="10" fill="#25252f" transform="rotate(-20 38 54)" /><ellipse cx="62" cy="54" rx="8" ry="10" fill="#25252f" transform="rotate(20 62 54)" /><circle cx="39" cy="53" r="3" fill="#fff" /><circle cx="61" cy="53" r="3" fill="#fff" /></g>
  }
}

function MouthPart({ type }: { type: Mouth }) {
  switch (type) {
    case 'smile':
      return <path d="M41 66 q9 9 18 0" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
    case 'open':
      return <g><path d="M39 64 q11 16 22 0 Z" fill={INK} /><path d="M45 70 q5 5 10 0 q-5 -3 -10 0 Z" fill={PINK} /></g>
    case 'cat':
      return <g><polygon points="47,62 53,62 50,65.5" fill={PINK} /><path d="M44 67 q3 4 6 0 q3 4 6 0" fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round" /></g>
    case 'teeth':
      return <g><rect x="37" y="65" width="26" height="10" rx="4" fill={INK} /><path d="M41 65 l3 4 3 -4 M53 65 l3 4 3 -4" fill="#fff" stroke="#fff" strokeWidth="1" /></g>
    case 'o':
      return <ellipse cx="50" cy="69" rx="4" ry="5" fill={INK} />
    case 'beak':
      return <polygon points="43,63 57,63 50,72" fill="#ff8c1a" />
    case 'wide':
      return <path d="M32 64 q18 14 36 0" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
  }
}

export const avatarById = (id: string) => AVATARS.find((a) => a.id === id) ?? AVATARS[0]

export function Avatar({ id, className = 'size-10', title }: { id: string; className?: string; title?: string }) {
  const look = avatarById(id)
  const g = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 100 100" className={`${className} shrink-0 overflow-hidden rounded-[28%]`} role="img" aria-label={title ?? look.label}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={look.bg[0]} />
          <stop offset="1" stopColor={look.bg[1]} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${g})`} />
      <EarsPart type={look.ears} c={look.earColor ?? look.face} />
      <Head look={look} />
      {look.spots && <g fill="#fff" opacity=".35"><circle cx="34" cy="70" r="4" /><circle cx="66" cy="44" r="3" /><circle cx="70" cy="68" r="2.5" /></g>}
      {look.snout && <g><ellipse cx="50" cy="67" rx="11" ry="8" fill="#fff" opacity=".85" /><ellipse cx="50" cy="63" rx="4" ry="3" fill={INK} /></g>}
      <EyesPart type={look.eyes} face={look.face} />
      {!look.snout && <MouthPart type={look.mouth} />}
      {look.snout && <path d="M45 69 q5 4 10 0" fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />}
      {look.cheeks && <g fill={PINK} opacity=".55"><circle cx="29" cy="64" r="5" /><circle cx="71" cy="64" r="5" /></g>}
    </svg>
  )
}
