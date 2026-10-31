// Builds the browser version (Samsung TV + web app) and packages dist/Lumen.wgt for smarttv-installer.
//   node scripts/build-web.mjs
// Output:
//   dist/web/        the web app (deployed to GitHub Pages; the TV loads updates from there)
//   dist/Lumen.wgt   the Samsung Tizen package (unsigned: smarttv-installer signs it for your TV)
import { build } from 'vite'
import { readFileSync, writeFileSync, readdirSync, statSync, copyFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { zipSync } from 'fflate'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
// Where newer versions are published (GitHub Pages of this repo). Override with LUMEN_UPDATE_URL.
const UPDATE_URL = process.env.LUMEN_UPDATE_URL ?? 'https://willel09.github.io/willepilletv/'
const OUT = 'dist/web'

await build({ configFile: 'vite.web.config.mts', logLevel: 'warn' })

// 1. Swap Vite's direct <script>/<link> for a tiny loader that can pick a newer build from UPDATE_URL
let html = readFileSync(join(OUT, 'index.html'), 'utf8')
const js = html.match(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/)?.[1]
const css = html.match(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/)?.[1]
if (!js || !css) throw new Error('Could not find entry assets in index.html')
const manifest = { version: pkg.version, js, css }
html = html
  .replace(/\s*<script type="module" crossorigin src="[^"]+"><\/script>/, '')
  .replace(/\s*<link rel="stylesheet" crossorigin href="[^"]+">/, '')
  .replace('</body>', '    <script src="./boot.js"></script>\n  </body>')
  // allow scripts/styles/fonts from the update host
  .replace(/(script-src|style-src|font-src) ([^;"]+)/g, (_, d, v) => `${d} ${v} ${new URL(UPDATE_URL).origin}`)
  .replace('<title>Lumen</title>', '<title>Lumen</title>\n    <link rel="manifest" href="./app.webmanifest" />\n    <meta name="theme-color" content="#0b0b0d" />\n    <link rel="apple-touch-icon" href="./icon.png" />')
writeFileSync(join(OUT, 'index.html'), html)
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest))
writeFileSync(
  join(OUT, 'boot.js'),
  `// Lumen boot loader: run the newest build. Falls back to the bundled copy when offline.
(function () {
  var LOCAL = ${JSON.stringify(manifest)};
  var REMOTE = ${JSON.stringify(UPDATE_URL)};
  function newer(a, b) {
    var x = a.split('.'), y = b.split('.');
    for (var i = 0; i < 3; i++) if ((+x[i] || 0) !== (+y[i] || 0)) return (+x[i] || 0) > (+y[i] || 0);
    return false;
  }
  var started = false;
  function start(base, m) {
    if (started) return;
    started = true;
    window.__LUMEN_BOOT__ = { manifestUrl: REMOTE + 'manifest.json', running: m.version, base: base };
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.crossOrigin = ''; l.href = base + m.css;
    document.head.appendChild(l);
    var s = document.createElement('script');
    s.type = 'module'; s.crossOrigin = ''; s.src = base + m.js;
    s.onerror = function () { if (base !== './') { started = false; start('./', LOCAL); } };
    document.body.appendChild(s);
  }
  // The web app itself is served from REMOTE: nothing to check
  if (location.href.indexOf(REMOTE) === 0 || !window.fetch) return start('./', LOCAL);
  setTimeout(function () { start('./', LOCAL); }, 4000);
  fetch(REMOTE + 'manifest.json?t=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (m) { start(newer(m.version, LOCAL.version) ? REMOTE : './', newer(m.version, LOCAL.version) ? m : LOCAL); })
    .catch(function () { start('./', LOCAL); });
})();
`
)
copyFileSync('build/icon.png', join(OUT, 'icon.png'))
writeFileSync(
  join(OUT, 'app.webmanifest'),
  JSON.stringify({ name: 'Lumen', short_name: 'Lumen', start_url: './', display: 'standalone', background_color: '#0b0b0d', theme_color: '#0b0b0d', icons: [{ src: 'icon.png', sizes: '1024x1024', type: 'image/png' }] })
)

// 2. Samsung Tizen package
const config = `<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" id="https://github.com/Willel09/willepilletv" version="${pkg.version}" viewmodes="maximized">
  <tizen:application id="LumenTvApp.Lumen" package="LumenTvApp" required_version="6.5"/>
  <content src="index.html"/>
  <feature name="http://tizen.org/feature/screen.size.normal.1080.1920"/>
  <icon src="icon.png"/>
  <name>Lumen</name>
  <tizen:profile name="tv-samsung"/>
  <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
  <access origin="*" subdomains="true"/>
  <tizen:setting screen-orientation="landscape" context-menu="disable" background-support="disable" encryption="disable" install-location="auto" hwkey-event="enable"/>
</widget>
`
const files = { 'config.xml': new TextEncoder().encode(config) }
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p)
    else files[relative(OUT, p).split('\\').join('/')] = readFileSync(p)
  }
}
walk(OUT)
writeFileSync('dist/Lumen.wgt', zipSync(files, { level: 9 }))
console.log(`✓ dist/web (web app) and dist/Lumen.wgt (Samsung TV) — version ${pkg.version}`)
