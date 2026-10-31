import type { Transition } from 'framer-motion'

export const spring: Transition = { type: 'spring', stiffness: 380, damping: 30, mass: 0.8 }
export const softSpring: Transition = { type: 'spring', stiffness: 220, damping: 28 }
export const sheetSpring: Transition = { type: 'spring', stiffness: 300, damping: 32 }
