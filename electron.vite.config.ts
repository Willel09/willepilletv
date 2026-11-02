import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json'
import { cssCompatPlugin } from './tools/css-compat.mts'

export default defineConfig({
  // electron-store is ESM-only, so bundle it into the CJS main process instead of requiring it
  main: {
    build: {
      externalizeDeps: { exclude: ['electron-store'] },
      // the library worker (main/worker.ts) is its own entry
      rolldownOptions: { input: { index: 'src/main/index.ts', worker: 'src/main/worker.ts' } }
    },
    plugins: [
      {
        // rolldown adds a bare require("./index.js") to the worker (no binding from it is used). Loading index.js
        // in a worker thread runs the app's Electron startup there and crashes it, so drop that line.
        name: 'standalone-worker',
        generateBundle(_, bundle) {
          const w = bundle['worker.js']
          if (w?.type !== 'chunk') return
          w.code = w.code.replace(/^require\("\.\/index\.js"\);\n/m, '')
          if (/index\.js|require\("electron"\)/.test(w.code)) throw new Error('worker.js must not load index.js or electron')
        }
      }
    ]
  },
  preload: {},
  renderer: {
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    plugins: [react(), tailwindcss(), cssCompatPlugin()]
  }
})
