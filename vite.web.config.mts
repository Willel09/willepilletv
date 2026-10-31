// Browser build of the same UI: used for the Samsung TV (.wgt) and the web app on GitHub Pages.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json' with { type: 'json' }
import { cssCompatPlugin } from './tools/css-compat.mts'

export default defineConfig({
  root: 'src/renderer',
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), tailwindcss(), cssCompatPlugin({ legacy: true })],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    // Samsung 2021 TVs (Tizen 6.0, e.g. QN90A) run Chromium 76
    target: 'chrome76',
    cssTarget: 'chrome76',
    // TV apps load from file://, where <script type="module"> is blocked: ship one classic script
    modulePreload: false,
    // keep CSS as its own file so tools/css-compat can lower it
    cssCodeSplit: false,
    rolldownOptions: { output: { format: 'iife', codeSplitting: false } }
  }
})
