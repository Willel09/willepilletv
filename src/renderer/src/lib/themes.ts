export interface Theme {
  id: string
  name: string
  mode: 'dark' | 'light'
  /** RGB triplets ("r g b") */
  base: string
  fg: string
  accent: string
  glow: [string, string]
}

const DARK_FG = '245 245 247'

export const THEMES: Theme[] = [
  { id: 'graphite', name: 'Graphite', mode: 'dark', base: '11 11 13', fg: DARK_FG, accent: '152 162 179', glow: ['92 100 118', '48 48 58'] },
  { id: 'midnight', name: 'Midnight', mode: 'dark', base: '0 0 0', fg: '255 255 255', accent: '10 132 255', glow: ['18 52 110', '20 14 40'] },
  { id: 'crimson', name: 'Crimson', mode: 'dark', base: '10 8 8', fg: '245 241 241', accent: '229 9 20', glow: ['118 12 18', '44 10 12'] },
  { id: 'nordic', name: 'Nordic', mode: 'dark', base: '13 19 28', fg: '236 242 248', accent: '136 192 208', glow: ['52 92 128', '28 44 70'] },
  { id: 'ember', name: 'Ember', mode: 'dark', base: '17 12 9', fg: '250 243 236', accent: '255 159 10', glow: ['150 76 20', '66 28 10'] },
  { id: 'forest', name: 'Forest', mode: 'dark', base: '9 15 12', fg: '236 244 239', accent: '94 209 154', glow: ['30 104 70', '12 48 38'] },
  { id: 'rose', name: 'Rosé', mode: 'dark', base: '17 10 14', fg: '250 240 244', accent: '255 120 160', glow: ['140 48 88', '58 20 48'] },
  { id: 'aurora', name: 'Aurora', mode: 'dark', base: '7 7 11', fg: DARK_FG, accent: '10 132 255', glow: ['10 90 200', '120 60 230'] },
  { id: 'daylight', name: 'Daylight', mode: 'light', base: '236 238 243', fg: '29 29 31', accent: '0 113 227', glow: ['150 185 255', '215 200 255'] },
  { id: 'sand', name: 'Sand', mode: 'light', base: '241 235 225', fg: '42 33 24', accent: '176 106 44', glow: ['232 196 150', '240 222 196'] }
]

export const themeById = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0]

export const hexToRgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}
