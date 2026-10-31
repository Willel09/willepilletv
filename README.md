# Lumen — a premium IPTV player for Windows, Samsung TV and the web

Lumen is an IPTV **player**. It ships with no channels: you add your own M3U playlist, Xtream Codes login and (optionally) an XMLTV guide. The look takes inspiration from Apple's "Liquid Glass", the Apple TV app and Netflix. It does not use any of their logos or trademarks.

| Device | How it runs | Updates |
| --- | --- | --- |
| **Windows** | Electron app (`Lumen-Setup-x.y.z.exe`) | Downloads new versions in the background, then offers **Restart to update** |
| **Samsung TV** (Tizen 6.5+, 2022 models and newer) | `Lumen.wgt`, installed with [smarttv-installer](https://github.com/Krishnakant010/smarttv-installer) | Loads the newest version from GitHub Pages every time it starts. No reinstall needed |
| **Web / phone** | <https://willel09.github.io/apple-iptv/> | Always the latest |

**Stack:** Electron · React 19 · TypeScript · Vite · Tailwind CSS 4 · Framer Motion · hls.js · mpegts.js · electron-store · electron-updater · Supabase (sync)

---

## Quick start (Windows)

You need **Node.js 22 LTS** (or 20.19+) from <https://nodejs.org>.

```bash
npm install          # downloads all dependencies + the Electron runtime (one time, ~2 min)
npm run dev          # starts the app with hot reload — edit a file and the window updates
npm run dist         # builds the Windows installer → dist\Lumen-Setup-1.1.0.exe
```

| Command | What it does |
| --- | --- |
| `npm test` | Runs the unit tests (M3U/XMLTV parsers, sync merge, TV CSS compatibility) |
| `npm run typecheck` | Type-checks all code |
| `npm run build:tv` | Builds the TV package `dist\Lumen.wgt` and the web app in `dist\web` |
| `npm run dev:web` | Runs the TV/web version in your browser with hot reload (handy for TV layout work) |
| `npm run preview` | Runs the compiled desktop build |
| `npm run dist:dir` | Builds an unpacked app in `dist\win-unpacked\Lumen.exe` (faster, no installer) |

> The installer is not code-signed, so Windows SmartScreen will say "Windows protected your PC" the first time. Click **More info → Run anyway**.

---

## One-time setup: releases and auto-update

Updates come from **GitHub Releases** (Windows) and **GitHub Pages** (TV and web). Do this once:

1. Make the repository **public**: GitHub → *Settings → General → Danger Zone → Change visibility*. Releases and Pages must be downloadable without logging in.
2. Turn on Pages: GitHub → *Settings → Pages → Build and deployment → Source: **GitHub Actions***.

### Shipping a new version

From then on, every update you make reaches every device with two commands:

```bash
npm version minor
```
```bash
git push --follow-tags
```

`npm version minor` bumps 1.1.0 → 1.2.0, commits and tags it. Use `patch` for small fixes (1.1.0 → 1.1.1). Pushing the tag starts the **Release** workflow (`.github/workflows/release.yml`, about 10 minutes), which:

- builds the Windows installer and publishes it with `latest.yml` to a GitHub Release, so installed apps update themselves;
- builds `Lumen.wgt` and attaches it to the same release;
- deploys the web app to GitHub Pages, so TVs pick up the new version the next time Lumen is opened.

Follow it under the repo's **Actions** tab.

---

## Install on a Samsung TV

Lumen for Samsung is the same app as on Windows, packaged as a Tizen web app (`Lumen.wgt`). It is installed with [smarttv-installer](https://github.com/Krishnakant010/smarttv-installer), which signs the package with a developer certificate for *your* TV.

**1. Turn on Developer Mode on the TV** (once):
Open **Apps** → press **1 2 3 4 5** on the remote → set **Developer mode: On** → enter your **PC's IP address** as Host PC IP → restart the TV fully (hold the power button until the logo appears).

**2. Get smarttv-installer** (once) on the same PC:

```bash
git clone https://github.com/Krishnakant010/smarttv-installer.git
```
```bash
cd smarttv-installer
```
```bash
npm install
```

**3. Install Lumen.** Replace `192.168.1.50` with your TV's IP address (TV → Settings → General → Network → Network Status → IP Settings).

Install the latest release:
```bash
node cli.js --ip 192.168.1.50 --repo Willel09/apple-iptv --tag latest
```
…or a package you built yourself with `npm run build:tv`:
```bash
node cli.js --ip 192.168.1.50 --file ..\apple-iptv\dist\Lumen.wgt
```

There's also a GUI: run `npm start` in the smarttv-installer folder.

**4. Link the TV with your PC** so you never have to type a password with the remote. On the TV, the Welcome screen has **Already use Lumen on another device? Link it**, which shows a code. On the PC, go to *Settings → Sync & Devices → Link a device* and type that code. Your sources, watchlist, favorites, resume positions and theme appear on the TV within seconds.

**TV remote:**

| Button | Action |
| --- | --- |
| Arrows / OK | Move / select |
| Back | Go back; exits the app on Home |
| Play/Pause, ◀◀ ▶▶ | Playback, seek 10 s |
| CH + / CH − | Next / previous channel |
| 0–9 | Jump to a channel number |
| Red / Green (in the player) | Favorite the channel / toggle subtitles |

> You only need to reinstall the `.wgt` if the TV package itself changes (rare: new permissions or app id). Normal updates load automatically.

---

## Sync between devices

*Settings → Sync & Devices* keeps these in sync between your PC, TV and the web app:

- watchlist, favorites, watch history and resume positions;
- sources (Xtream logins and playlists), so only one device needs typing;
- theme, accent, artwork glow, extra guide URL, hidden categories, stream format and autoplay.

**Privacy:** everything is encrypted on your device (AES-256-GCM, with a key derived from your sync code) before it is sent. The server stores only ciphertext under a SHA-256 hash of the code, so it never sees the code, your logins or your lists. Anyone who has your **sync code** can read your synced data, so keep it private. Turning sync off on a device keeps its local data.

**Backend:** a free Supabase project, `lumen-sync` (Stockholm). The database only exposes three functions (`sync_get`, `sync_put`, `sync_delete`); the table itself can't be read or listed. Free Supabase projects pause after about a week without any traffic. If sync shows *Sync failed* after a long break, open the project in the [Supabase dashboard](https://supabase.com/dashboard) and click **Restore**.

**Deletions sync too.** Removing something from the watchlist on the TV removes it on the PC, rather than it coming back on the next sync.

---

## Web app (phone, tablet, any browser)

<https://willel09.github.io/apple-iptv/> runs the same app. Link it like the TV (Settings → Sync → Link with another device) to see and manage your watchlist, favorites and Continue Watching from your phone.

> **Limitation:** browsers block plain `http://` IPTV servers on secure (`https://`) pages, and most providers don't allow browser access (CORS). So on the web you can usually *manage* your lists, but playback works only if your provider supports it. The Windows and TV apps aren't affected.

---

## Features

- **Sources:** M3U/M3U8 by URL or local file (Windows), Xtream Codes (Live, Movies, Series), and XMLTV guides (`.xml` / `.xml.gz`, found automatically from Xtream or the M3U `url-tvg` header).
- **Home:** an auto-rotating hero, then rows: Continue Watching, **My Watchlist**, Favorites, Recently Watched Channels, and one row per category.
- **Watchlist:** add movies and series from the hero (＋) or the detail page. It also appears as a category under Movies and Series, and syncs between devices.
- **Live TV:** a filterable category sidebar, a virtualised channel list with now/next, an info panel with the upcoming schedule, and a full **TV guide grid**.
- **Movies & Series:** a virtualised poster grid (newest, A–Z, top rated), and detail pages with backdrop, cast, season/episode picker and "More Like This".
- **Player:** a glass control bar; audio/subtitle tracks; speed; sleep timer; PiP; fullscreen; channel zapping and number entry; resume; Up Next autoplay; automatic engine fallback; error messages written for people; Open in VLC (Windows).
- **Themes:** Graphite (default), Midnight (OLED black), Crimson, Nordic, Ember, Forest, Rosé, Aurora, Daylight and Sand. You can also set a custom accent colour and choose **Artwork glow: Vivid / Subtle / Off** for how much posters tint the background.
- **Updates:** see *Settings → Updates* for the current version and **Check for updates**.
- **Keyboard / remote navigation** everywhere, Windows 11 Mica/Acrylic, and Reduced Motion support.

### Keyboard (Windows)

| Key | Action |
| --- | --- |
| Arrow keys / Enter | Move focus / select |
| Esc or Backspace | Back |
| Ctrl+1…6 | Switch tabs |
| `/` or Ctrl+F | Search |
| Space / K | Play / pause |
| ← / → | Seek 10 s |
| ↑ / ↓, PgUp / PgDn | Channel up / down (live) |
| 0–9 | Jump to channel number |
| F · M · P · C · N | Fullscreen · Mute · PiP · Subtitles · Next episode |

---

## Project structure

```
apple-iptv/
├─ package.json                  scripts + dependencies
├─ electron.vite.config.ts       Windows app build (main, preload, renderer)
├─ vite.web.config.mts           TV + web build of the same renderer
├─ electron-builder.yml          Windows installer + auto-update (GitHub Releases)
├─ scripts/build-web.mjs         web build → update loader (boot.js) → dist/Lumen.wgt
├─ tools/css-compat.mts          makes Tailwind 4 CSS work on older TV browsers (Chromium 85+)
├─ .github/workflows/release.yml builds + publishes everything when you push a version tag
└─ src/
   ├─ shared/
   │  ├─ types.ts                types shared by every platform
   │  └─ core/                   M3U, Xtream, XMLTV/EPG and library loading (used by Windows, TV and web)
   ├─ main/                      Electron main process: window, Mica, IPC, VLC, auto-update, CORS/UA rewriting
   ├─ preload/index.ts           window.api bridge for the Windows app
   └─ renderer/src/
      ├─ platform/web.ts         window.api for TV/web (localStorage, IndexedDB cache, Tizen keys, update check)
      ├─ store.ts                app state, watchlist/favorites/history, sync orchestration
      ├─ lib/sync.ts             end-to-end encrypted sync + merge + device pairing
      ├─ lib/themes.ts           theme presets
      ├─ lib/tv.ts               Samsung remote key mapping
      ├─ components/  screens/  player/
      └─ index.css               the Liquid Glass design system and theme tokens
```

## Troubleshooting

- **A channel won't play.** The error card explains why. Try **Try HLS / Try MPEG-TS** (Xtream), or **Open in VLC** on Windows. If there's no sound on Windows, the stream probably uses AC3/DTS audio. Samsung TVs can usually decode those.
- **The provider blocks the app.** Change the user agent in Settings → Playback (Windows).
- **The TV install fails.** Make sure Developer Mode shows your PC's IP, the TV was fully restarted, and both are on the same network.
- **No TV guide.** Check that the channels have `tvg-id` values matching the guide, or matching names.
- **Fresh start:** on Windows delete `%APPDATA%\Lumen`. On TV, uninstall and reinstall Lumen.
