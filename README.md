# Lumen — a premium IPTV player for Windows

Lumen is a desktop IPTV **player**. It ships with no channels: you add your own M3U playlist, Xtream Codes login and (optionally) an XMLTV guide. The look takes inspiration from Apple's "Liquid Glass", the Apple TV app and Netflix. It does not use any of their logos or trademarks.

**Stack:** Electron · React 19 · TypeScript · Vite (electron-vite) · Tailwind CSS 4 · Framer Motion · hls.js · mpegts.js · electron-store · electron-builder

---

## Quick start (Windows)

You need **Node.js 22 LTS** (or 20.19+) from <https://nodejs.org>. Use **Git** if you clone the repo.

```bash
npm install          # downloads all dependencies + the Electron runtime (one time, ~2 min)
npm run dev          # starts the app with hot reload — edit a file and the window updates
npm run dist         # builds the Windows installer → dist\Lumen-Setup-1.0.0.exe
```

Other useful commands:

| Command | What it does |
| --- | --- |
| `npm test` | Runs the parser tests (M3U, XMLTV, EPG matching) |
| `npm run typecheck` | Type-checks main, preload and renderer code |
| `npm run build` | Compiles everything into `out/` without packaging |
| `npm run preview` | Runs the compiled `out/` build (closest to the installed app) |
| `npm run dist:dir` | Builds an unpacked app in `dist\win-unpacked\Lumen.exe` (faster, no installer) |

> The installer is not code-signed, so Windows SmartScreen will say "Windows protected your PC" the first time. Click **More info → Run anyway**.

---

## Features

- **Sources:** M3U/M3U8 by URL or local file, Xtream Codes (Live, Movies, Series), and XMLTV guides (`.xml` or `.xml.gz`). The provider guide is found automatically from Xtream `xmltv.php` or the M3U `url-tvg` header.
- **Home:** an auto-rotating hero with a cinematic fade, then Netflix-style rows: Continue Watching, Favorites, Recently Watched Channels, and one row per category.
- **Live TV:** a filterable category sidebar, a virtualised channel list with logos and now/next progress, an info panel with the upcoming schedule, and a **full TV guide grid** with a live "now" line.
- **Movies & Series:** a virtualised poster grid (sort by newest, A–Z or top rated) and a detail page with backdrop, rating, cast, a **season/episode picker** and "More Like This".
- **Search** across every channel, movie and series. Accents and case are ignored.
- **Player:**
  - a glass control bar that auto-hides, with seek, volume, audio and subtitle tracks, and speed
  - fullscreen, Picture-in-Picture, and channel up/down
  - an **automatic engine fallback**: mpegts.js → hls.js → native, for example
  - error messages written for people (403 = "subscription expired or too many devices", codec issues and so on)
  - one-click **Open in VLC** and copy the stream URL
- **Favorites, watch history and resume** positions.
- **Keyboard / remote style navigation** with arrow keys, Enter, Esc and Space.
- **Design:** frosted glass panels, a floating pill tab bar, parallax-tilt poster cards with a specular sheen, an ambient background tinted by the focused artwork, spring animations, a frameless window with glass window buttons, and **Windows 11 Mica/Acrylic**.

**Extra quality-of-life features**

- Instant startup: your library and guide are cached and refreshed in the background.
- Type a channel number (`1` `0` `4`) while watching live TV to jump to that channel.
- Up Next with a countdown autoplays the next episode. Press `N` to skip ahead.
- A sleep timer, playback speed, and a resolution badge.
- Paste any stream URL (`Ctrl+V`) anywhere to play it immediately.
- Hide categories by keyword (for example `adult, 24/7`).
- Xtream account expiry date and connection limit are shown in Settings.
- A live stream format toggle (MPEG-TS ↔ HLS) for providers that stutter in one format.
- Dark and light themes, accent colors, and Reduced Motion support.

### Keyboard

| Key | Action |
| --- | --- |
| Arrow keys / Enter | Move focus / select |
| Esc or Backspace | Back |
| Ctrl+1…6 | Switch tabs |
| `/` or Ctrl+F | Search |
| Space / K | Play / pause |
| ← / → | Seek 10 s (movies & episodes) |
| ↑ / ↓, PgUp / PgDn | Channel up / down (live) |
| 0–9 | Jump to channel number |
| F · M · P · C · N | Fullscreen · Mute · Picture-in-Picture · Subtitles · Next episode |

---

## Project structure

```
apple-iptv/
├─ package.json               scripts + dependencies
├─ electron.vite.config.ts    builds main, preload and renderer with Vite
├─ electron-builder.yml       Windows installer (NSIS) settings
├─ build/icon.png             app icon
└─ src/
   ├─ shared/types.ts         types shared by every process (Source, Channel, Movie, Settings, the window.api bridge…)
   ├─ main/                   Electron main process (Node.js) — all networking lives here, so CORS never blocks it
   │  ├─ index.ts             window (frameless + Mica), IPC handlers, VLC launcher, stream header/CORS rewriting
   │  ├─ http.ts              fetch with a custom user agent, gzip support, friendly error messages
   │  ├─ m3u.ts               M3U parser (splits live / movies / series episodes)
   │  ├─ xtream.ts            Xtream Codes API client
   │  ├─ epg.ts               fast streaming-style XMLTV parser + channel matching
   │  ├─ library.ts           loads all sources, builds the guide, disk cache
   │  └─ parsers.test.ts      unit tests
   ├─ preload/index.ts        safe bridge: exposes window.api to the UI
   └─ renderer/               the React app
      ├─ index.html
      └─ src/
         ├─ App.tsx           shell: screens, overlays, global shortcuts
         ├─ store.ts          app state (zustand), favorites, history, playback actions, library index
         ├─ index.css         the Liquid Glass design system (glass, glass-thin, glass-strong, theme tokens)
         ├─ lib/              spatial keyboard navigation, EPG helpers, formatting, spring presets
         ├─ components/       TitleBar + tab pill, Hero, Row, poster/channel cards, sidebar, virtual grid, sheet, toast
         ├─ screens/          Home, Live, Guide, Browse (Movies/Series), Detail, Search, Settings
         └─ player/           Player UI + engine.ts (hls.js / mpegts.js / native with fallback)
```

### How it works

1. The **main process** downloads playlists, Xtream data and XMLTV. Node isn't subject to CORS, and it sends a VLC-style user agent that most providers accept.
2. Video streams are fetched by hls.js/mpegts.js in the **renderer**. Most IPTV servers don't send CORS headers, so the main process rewrites stream responses (adds `Access-Control-Allow-Origin`, removes `Origin`/`Referer`, sets the user agent). Web security stays on.
3. Settings, sources, favorites and history are kept in **electron-store** (`%APPDATA%\Lumen\lumen.json`). The large library and guide caches are `library.json` / `epg.json` in the same folder.
4. Big lists (10,000+ channels, 50,000+ movies, 1,000+ categories) are **virtualised** with `@tanstack/react-virtual`, so only what's on screen is rendered.

---

## Step-by-step: what was built and how to test each step

1. **Project setup.** Run `npm install`, then `npm run dev`. A dark window opens with the glass tab bar and a "Welcome to Lumen" card.
2. **Glass design system.** Look at the floating tab pill, the window buttons (top right) and the Welcome card. Hover the tabs to see the spring-animated highlight. Try Settings → Appearance → Light / Accent color.
3. **Playlist & Xtream loading.** Click **Xtream Codes Login** (or **M3U Playlist**) and enter your details. The spinner pill in the top-right corner shows progress. Settings → Sources then shows the channel, movie and series counts and your account expiry.
4. **Home / Live / Movies / Series.** Hover posters for the tilt and glow, then use the arrow keys to move around. Open a movie or series to see the detail page and episode picker.
5. **Player.** Play anything. Move the mouse to show the controls, which hide after 3 seconds. Test ↑/↓ on live TV, ←/→ on movies, `F` for fullscreen and `P` for Picture-in-Picture. If a stream fails, try **Open in VLC** (VLC must be installed).
6. **EPG.** Live TV → **TV Guide**. If your provider guide is missing, paste an XMLTV URL in Settings → TV Guide and click **Refresh Guide**.
7. **Packaging.** Run `npm run dist`. The installer is written to `dist\Lumen-Setup-1.0.0.exe`.

## Troubleshooting

- **A channel won't play.** The error card explains why. Try **Try HLS / Try MPEG-TS** (Xtream), then **Open in VLC**. If there's no sound, the stream probably uses AC3/DTS audio, which Chromium can't decode; VLC can.
- **The provider blocks the app.** Change the user agent in Settings → Playback.
- **No TV guide.** Check that the channels in your playlist have `tvg-id` values that match the guide, or that the names match.
- **Want a fresh start?** Delete `%APPDATA%\Lumen`.
