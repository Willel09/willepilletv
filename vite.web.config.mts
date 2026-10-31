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
  plugins: [react(), tailwindcss(), cssCompatPlugin()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    // Samsung 2022 TVs (Tizen 6.5) run Chromium 85
    target: 'chrome85',
    cssTarget: 'chrome85'
  }
})
