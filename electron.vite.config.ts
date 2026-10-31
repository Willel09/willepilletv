import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json'
import { cssCompatPlugin } from './tools/css-compat.mts'

export default defineConfig({
  // electron-store is ESM-only, so bundle it into the CJS main process instead of requiring it
  main: { build: { externalizeDeps: { exclude: ['electron-store'] } } },
  preload: {},
  renderer: {
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    plugins: [react(), tailwindcss(), cssCompatPlugin()]
  }
})
