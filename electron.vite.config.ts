import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // electron-store is ESM-only, so bundle it into the CJS main process instead of requiring it
  main: { build: { externalizeDeps: { exclude: ['electron-store'] } } },
  preload: {},
  renderer: { plugins: [react(), tailwindcss()] }
})
