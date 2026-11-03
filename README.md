# Lumen — a premium IPTV player for Windows, Samsung TV and the web

Lumen is an IPTV **player**. It ships with no channels: you add your own M3U playlist, Xtream Codes login and (optionally) an XMLTV guide. The look takes inspiration from Apple's "Liquid Glass", the Apple TV app and Netflix. It does not use any of their logos or trademarks.

| Device | How it runs | Updates |
| --- | --- | --- |
| **Windows** | Electron app (`Lumen-Setup-x.y.z.exe`) | Downloads new versions in the background, then offers **Restart to update** |
| **Samsung TV** (Tizen 6.0+, 2021 models and newer, e.g. QN90A) | `Lumen.wgt`, installed from Lumen for Windows (*Settings → Samsung TV*) | Loads the newest version from GitHub Pages every time it starts. No reinstall needed |
| **Web / phone** | <https://willel09.github.io/willepilletv/> | Always the latest |

**Stack:** Electron · React 19 · TypeScript · Vite · Tailwind CSS 4 · Framer Motion · hls.js · mpegts.js · electron-store · electron-updater · Supabase (sync)

---

## Install — no terminal needed

### Windows

1. Open **[the latest release](https://github.com/Willel09/willepilletv/releases/latest)** and download **`Lumen-Setup-x.y.z.exe`**.
2. Open the file and follow the installer.

> The installer isn't code-signed, so the first time Windows may say "Windows protected your PC". Click **More info → Run anyway**.

After that Lumen updates itself: when a new version is out, *Settings → Updates* (and a prompt) offer **Restart to update**.

### Samsung TV (2021 models and newer)

Everything happens in Lumen for Windows: **Settings → Samsung TV → Install on TV**. The assistant walks you through it.

1. **Developer Mode.** On the TV: **Apps** → press **1 2 3 4 5** → *Developer mode: On* → type the PC's IP address that the assistant shows → restart the TV fully (hold the power button).
2. **Find the TV.** The assistant searches your network and shows ✓ when Developer Mode is answering. You can also type the TV's IP.
3. **Install.** Click **Open TV Installer**. Lumen downloads and opens [SmartTV Installer](https://github.com/Krishnakant010/smarttv-installer), a free open-source tool. Choose **Samsung**, enter the TV IP, pick **Custom GitHub Repository** → `Willel09/willepilletv` (both have copy buttons in the assistant), then press **Install**. The first time, a Samsung account sign-in opens in the browser to create the TV's developer certificate.
4. **Link.** On the TV choose **Already use Lumen on another device? Link it**. On the PC: *Settings → Sync & Devices → Link a device* (or **Enter a code** if the PC isn't syncing yet), then type the 12-character code the TV shows. Your sources and lists appear on the TV with no typing on the remote.

The TV loads new versions by itself every time Lumen starts (requires GitHub Pages to be on, see below). You only reinstall if the TV package itself changes (rare).

#### Samsung QN90A and other 2021 models (Tizen 6.0)

These TVs run an older browser engine (Chromium 76), so the TV build is made specifically for it:

- the app ships as one classic script (no ES modules, which TV apps loading from `file://` can't use);
- the CSS is lowered: no `:is/:where`, logical properties, `@layer` or `min()/clamp()`, plus flex-gap, aspect-ratio and focus-ring fallbacks. The build **fails** if anything unsupported is left (`npm run build:tv`);
- **sync works without WebCrypto:** if the TV doesn't give apps `crypto.subtle`, Lumen uses the audited pure-JS `@noble` libraries, which produce exactly the same encryption. Linking takes a few extra seconds the first time;
- animations switch to JS mode where the TV lacks newer Web Animations features;
- `.gz` guides are unpacked in JS.

**Tip for the QN90A remote (Solar Cell remote):** Play/Pause, CH ▲▼ and Back work directly. The coloured and number keys are under the **123** button.

**Made for the sofa:** on TV the app is laid out at 1280 px and shown 1.5× larger (bigger text, cards and buttons), with a thick white focus frame. The remote moves predictably: Up/Down go to what is straight above/below, Left/Right stay in the row (nothing happens at the end of a row), the focused row scrolls to the middle of the screen, and Back returns focus to where you were. Lists like the categories remember where you were in them; the channel info panel is entered on **Watch**.

**TV remote:**

| Button | Action |
| --- | --- |
| Arrows / OK | Move / select |
| Back | Go back; exits the app on Home |
| Play/Pause, ◀◀ ▶▶ | Playback, seek 10 s |
| In the player: ◀ ▶ | Seek 10 s (films) |
| In the player: ▲ ▼ | Next / previous channel (live) |
| In the player: OK | Show the controls (then the arrows move between buttons; Back hides them again) |
| CH + / CH − | Next / previous channel |
| 0–9 | Jump to a channel number |
| Red / Green (in the player) | Favorite the channel / toggle subtitles |

### Phone / any browser

Open <https://willel09.github.io/willepilletv/>. On a phone, use the browser's *Add to Home screen*. In fullscreen the video turns to landscape on Android; on iPhone it uses the native player, which follows the phone's rotation.

---

## How releases happen (automatic)

Whenever the `version` in `package.json` changes on the default branch, the **Release** workflow (`.github/workflows/release.yml`, about 10–15 minutes) builds and publishes everything:

- the Windows installer + `latest.yml` to a GitHub Release, so installed apps update themselves;
- `Lumen.wgt` attached to the same release, for SmartTV Installer;
- the web app to GitHub Pages, where TVs and phones pick up the new version on next start.

You can also start it by hand: GitHub → **Actions → Release → Run workflow**. Pushes that don't change the version are skipped.

**One-time setting:** GitHub → *Settings → Pages → Build and deployment → Source: **GitHub Actions***. Without it the Windows installer is still published, but TV/web updates aren't.

---

## For developers

You need **Node.js 22 LTS** from <https://nodejs.org>.

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies (one time) |
| `npm run dev` | Windows app with hot reload |
| `npm run dev:web` | TV/web version in the browser with hot reload |
| `npm test` | Unit tests (parsers, sync merge, TV CSS compatibility) |
| `npm run typecheck` | Type-check all code |
| `npm run dist` | Build the Windows installer locally → `dist\Lumen-Setup-x.y.z.exe` |
| `npm run build:tv` | Build `dist\Lumen.wgt` + the web app in `dist\web` |

---

## Sync between devices

*Settings → Sync & Devices* keeps these in sync between your PC, TV and the web app:

- watchlist, favorites, watch history and resume positions;
- sources (Xtream logins and playlists), so only one device needs typing. **M3U files added from the PC's disk are shared too:** Lumen for Windows uploads the file (compressed and encrypted, up to ~70 MB) so the TV and phone can load it. Edits to the file reach other devices on their next refresh;
- theme, accent, artwork glow, extra guide URL, hidden categories, stream format and autoplay.

**Privacy:** everything is encrypted on your device (AES-256-GCM, with a key derived from your sync code) before it is sent. The server stores only ciphertext under a SHA-256 hash of the code, so it never sees the code, your logins or your lists. Anyone who has your **sync code** can read your synced data, so keep it private. Turning sync off on a device keeps its local data.

**Backend:** a free Supabase project, `lumen-sync` (Stockholm). The database only exposes four functions (`sync_get`, `sync_put`, `sync_put_if`, `sync_delete`); the table itself can't be read or listed. The synced document is written with `sync_put_if` (compare-and-swap): when two devices sync at the same moment, the second one merges again instead of overwriting the first. Something you change while a sync is running is kept and synced right after. Free Supabase projects pause after about a week without any traffic. If sync shows *Sync failed* after a long break, open the project in the [Supabase dashboard](https://supabase.com/dashboard) and click **Restore**.

**Your order of favorites is kept**, and ones added on another device appear first.

**Deletions sync too.** Removing something from the watchlist on the TV removes it on the PC, rather than it coming back on the next sync.

---

## Web app (phone, tablet, any browser)

<https://willel09.github.io/willepilletv/> runs the same app. Link it like the TV (Settings → Sync → Link with another device) to see and manage your watchlist, favorites and Continue Watching from your phone.

> **Limitation:** browsers block plain `http://` IPTV servers on secure (`https://`) pages, and most providers don't allow browser access (CORS). So on the web you can usually *manage* your lists, but playback works only if your provider supports it. The Windows and TV apps aren't affected.

---

## Features

- **Sources:** M3U/M3U8 by URL or local file (Windows; shared with your TV through Sync), Xtream Codes (Live, Movies, Series), and XMLTV guides (`.xml` / `.xml.gz`, found automatically from Xtream or the M3U `url-tvg` header).
- **Home:** an auto-rotating hero, then curated rows: Continue Watching, **Recommended for You** (TMDB key) and **For You** (from the categories you watch and save), My Watchlist, **Newest Movies**, **Newest Series**, **Because you watched …**, **Live Now** (channels on air, favorites first), **Top Rated**, Favorites and Recently Watched Channels. Categories live under Movies / Series / Live TV.
- **Watchlist:** add movies and series from the hero (＋) or the detail page; remove them with the **✕ Remove** button on each card. Clicking a card opens its detail page. It also appears as a category under Movies and Series, and syncs between devices.
- **Live TV:** a filterable category sidebar, a virtualised channel list with now/next, an info panel with the upcoming schedule, and a full **TV guide grid**.
- **One title, many copies:** when a provider lists the same film or series several times ("SC-[4K-Q] - Kubo", "Kubo (2016) [1080p]", once per category or language), Lumen shows it once. The detail page lists every copy under **Versions** so you choose which to play (for series: whose seasons and episodes). Copies are matched by the TMDB id when the provider sends it (that also joins translated titles like "Ali G: Who Iz I?" and "Ali G : J'suis qui ?"), otherwise by the title without provider tags, quality words, brackets and year; same-title films from different years stay separate.
- **Remove BS** (*Settings → Library*): one switch hides Arabic and Indian channels, movies and series everywhere (matched by script, language/network names like Hindi, Tamil, MBC, and country tags like `AR |`, `IN |`). Synced between devices.
- **Search inside Movies and Series:** a search field above the poster grid filters the current category.
- **Movies & Series:** a virtualised poster grid (newest, A–Z, top rated), and detail pages with backdrop, cast, season/episode picker and "More Like This".
- **Player:** a glass control bar; a draggable **mini player** (Esc or ‹ shrinks it to a corner so you can keep browsing; click to expand); audio/subtitle tracks; speed; sleep timer; PiP; fullscreen; channel zapping and number entry; resume; Up Next autoplay; automatic engine fallback; error messages written for people; Open in VLC (Windows).
- **Cast to TV** (Windows app): the cast button in the player (or **Cast to TV** on the error card) finds Chromecast / Google TV and Samsung (DLNA) TVs on your network and plays the stream there. Channel zapping follows to the TV; **Stop casting** brings playback back to the PC. Handy when the PC can't play a format (MKV, AC3) that the TV can.
- **Real ratings** (*Settings → Ratings*): paste a free [OMDb](https://www.omdbapi.com/apikey.aspx) key (1,000 lookups a day; only an email needed) and movie and series pages show **IMDb**, **Rotten Tomatoes** and **Metacritic** scores instead of the provider's rating. Each title is looked up once when you open it and remembered for 30 days. The key syncs to your other devices, so type it on the PC. Cards in rows keep the provider's rating: looking up hundreds of thousands of titles would take far more than the free 1,000 a day.
- **Search:** results are ranked (the exact title first, then titles that start with your words, then the rest), provider tags like `EN |` and punctuation don't count (`spiderman` finds *Spider-Man*), and when little matches, close spellings are offered (`intersteller` finds *Interstellar*). The same matching filters the poster grids under Movies and Series.
- **Continue Watching:** take a title out with the **✕ Remove** button on its card (Windows, web), the **red button** on a Samsung remote (or **Delete** on a keyboard) while the card is focused, or **Remove from Continue Watching** on the title's page (everywhere). The removal syncs.
- **Actors and directors** (*Settings → Ratings → TMDB key*, free at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)): the cast and director names on a title page open a page with the person's age, how many films and series they have been in, their average rating, their best-rated title, a short biography, and **which of their films are in your library**. The key syncs to your other devices. Looked-up people are kept on the device for two weeks.
- **Recommendations:** with the TMDB key, **Recommended for You** on Home is built from TMDB's recommendations for what you last watched and saved (titles several of them recommend come first), and a title page shows **Recommended** instead of "More Like This": both only list titles your library actually has (matched by TMDB id, or by name and year). Without the key Lumen keeps picking by category.
- **Screensaver** (*Settings → Appearance*): after 2, 5 (default) or 15 minutes without input, slowly drifting artwork from your library with title, year, rating and a clock. Any key, click or mouse movement ends it, and that key press is not passed on. It never starts while something is playing.
- **Random:** pick Movie, Series or Channel (and *Rated 7+* if you like), press **Spin**, and a reel of posters rolls and slows to a stop on tonight's pick, with **Play**, **Details** and **Spin again**. Titles you've already watched are skipped when there are others.
- **Downloads** (Windows app only): **Download** on a film's page, on an episode (the arrow on its card), or **Download season**. When a film has several copies, a list shows each one's size and marks the smallest, so you can keep the most room. Downloads run one at a time, can be paused and continue where they stopped, are capped by a limit you set on the *Downloads* tab (5, 10, 20, 50 GB or none; a download that would pass it stops with a message) and can be deleted automatically once you've watched them to the end. They are plain video files in `%APPDATA%\Lumen\downloads` that play only inside Lumen (including seeking, audio tracks and *Continue Watching*), also with no internet. Lumen does not re-encode files: that would take hours of CPU per film and needs a bundled encoder, so the saving comes from choosing the smallest copy. Most providers allow one stream at a time, so a running download can make a second stream refuse.
- **Trailers:** with the TMDB key, a **Trailer** button on a title's page opens the official YouTube trailer in your browser (not shown on Samsung TVs). Looked-up trailers are remembered for two weeks.
- **New Episodes:** series on your watchlist, in favorites or that you've watched get a **New** badge on Home when the provider has updated them since you last opened the series or watched an episode. Opening the series clears it. A series you already had when you first got this version doesn't count as new until it changes again. Kept per device. (Providers report when a series changed, not which episode, so it can't say how many.)
- **Genre rows** (TMDB key): Home shows rows like *Thriller*, *Comedy*, *Horror*, *Crime series* made of TMDB's most popular titles in each genre that your library has (only genres with at least six matches appear). Looked up once a week.
- **Small things:** *Hide watched* in Movies, the last searches as chips under the search box, and **L** (Yellow on a Samsung remote) for the previous channel.
- **Profiles:** each profile has its own watchlist, favorites and Continue Watching (sources and settings are shared). Pick one on the *Who's watching?* screen at start, or with the avatar top right. 12 hand-drawn avatars (kitty, robot, alien, ghost, panda…). Profiles sync between devices like everything else.
- **Themes:** Graphite (default), Midnight (OLED black), Crimson, Nordic, Ember, Forest, Rosé, Aurora, Daylight and Sand. You can also set a custom accent colour and choose **Artwork glow: Vivid / Subtle / Off** for how much posters tint the background.
- **Updates:** see *Settings → Updates* for the current version and **Check for updates**.
- **Keyboard / remote navigation** everywhere, Windows 11 Mica/Acrylic, and Reduced Motion support.

### Keyboard (Windows)

| Key | Action |
| --- | --- |
| Arrow keys / Enter | Move focus / select |
| Esc or Backspace | Back |
| Ctrl+1…8 | Switch tabs |
| `/` or Ctrl+F | Search |
| Space / K | Play / pause |
| ← / → | Seek 10 s |
| ↑ / ↓, PgUp / PgDn | Channel up / down (live) |
| 0–9 | Jump to channel number |
| Esc | Shrink to the mini player (leaves fullscreen first) |
| F · M · P · C · N | Fullscreen · Mute · PiP · Subtitles · Next episode |
| L (Yellow on a Samsung remote) | Previous channel |

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

- **A title or channel won't play.** The error card explains why: when every way to play it fails, Lumen looks at the stream itself and tells you whether the provider refused it (with your account's connection count, e.g. *1 of 1 in use: stop playback on the TV*), whether the subscription has expired, or which codec the built-in player can't decode (HEVC, AC3/E-AC3, DTS…, which **Open in VLC** or **Cast to TV** can play). Try **Try HLS / Try MPEG-TS** (Xtream), or **Open in VLC** on Windows. **HEVC (H.265) on Windows:** the app asks Windows to decode it with your graphics chip. It works when the chip supports HEVC (most Intel since 2016, Nvidia GTX 950 and newer, AMD RX 400 and newer) and the free [HEVC Video Extensions](https://apps.microsoft.com/detail/9nmzlz57r3t7) from the Microsoft Store are installed; otherwise use **Open in VLC**. Samsung TVs play HEVC themselves. If there's no sound on Windows, the stream probably uses AC3/DTS audio. Samsung TVs can usually decode those.
- **The provider blocks the app.** Change the user agent in Settings → Playback (Windows).
- **SmartTV Installer crashes with "Cannot find module 'tar'".** The official v1.1.0 Windows build is broken. Lumen downloads `SmartTV-Installer-for-Lumen.exe` from our releases instead: the same app rebuilt with the missing module.
- **Casting to a Samsung TV fails.** If the TV refuses the provider's link, Lumen streams it through the PC with the content type and DLNA headers Samsung expects. Windows asks once whether Lumen may use the network: choose **Allow** (private networks).
- **The TV install fails.** In the assistant, Developer Mode must show ✓. Check that the TV has your PC's IP, that it was fully restarted, and that both are on the same network.
- **No TV guide.** Check that the channels have `tvg-id` values matching the guide, or matching names.
- **Huge providers** are supported, also on Samsung TVs. Tested with 110,791 channels + 398,072 movies + 96,259 series and an 8,000-channel guide, with the browser limited to a TV-like 384 MB of memory. What makes that work on a TV:
  - provider lists and the TV guide are parsed **while they download**, so a 100 MB JSON list or XMLTV file never sits in memory whole;
  - the library is cached in **pieces** (a single IndexedDB value over ~128 MB is refused, which used to leave the TV stuck on *Loading your library…*);
  - TMDB artwork is requested at the size it's shown instead of the original (a 2000×3000 poster costs ~24 MB once decoded);
  - home rows only exist near the screen, and a row starts with ~10 cards and grows as you move right;
  - **no Liquid Glass on TV:** panels are flat and opaque, with no backdrop blurs, blur filters, masks, big soft shadows or artwork glow behind the app. Cards are plain buttons (no animation library per card);
  - a held arrow key moves focus at most once per frame, so focus stops when you let go (measured at a TV-like CPU speed: a focus step takes half as long as in 1.3.6, with half the page elements);
  - the TV keeps a 12-hour guide (refreshed automatically) and shorter video buffers;
  - titles are stored lean: Xtream stream addresses are built when you press Play, TMDB artwork is stored as its file name, and TVs leave series plots/backdrops to the detail page (~100 MB less for 600k titles);
  - on TVs and phones, **Remove BS** and hidden categories apply while loading, so hidden titles never take memory (changing them reloads the library);
  - duplicate merging, home rows and the guide are computed in small steps with breaks for the screen, so the remote never freezes for long (longest pause ~0.5 s at a TV-like CPU speed, down from 4–10 s);
  - no animations on TV: no movement, fades, tilt or rotating hero, and scrolling jumps instead of gliding.
- **Windows: "Lumen is not responding" / stuck on *Who's watching?***: fixed in 1.3.10. Reading, saving and building a huge library (and the TV guide) now happens in a background thread, so the app's window and its main process never wait on it; duplicates are merged there while loading, and the library reaches the window in pieces. Downloads still go through Chromium's network stack in the main process (1.3.10 briefly used Node's fetch, which some providers failed with), and if the background thread ever stops, you get an error instead of an endless *Loading…*. Measured with 110k channels + 398k movies + 96k series: the main process never stalls (it stalled up to 1.6 s here, longer on slower PCs), the window at most ~0.7 s at start and 0.2 s during a refresh.
- **A provider is down during a refresh:** the library keeps that source's titles from last time and shows the error; nothing disappears. A refresh that takes too long can be stopped with the **×** in the loading pill (or **Cancel** in Settings); the library stays as it was.
- **Changed M3U links (new token or password in the URLs):** favorites, watchlist and history stay linked; channels are identified by their category and name, not their URL.
- **Fresh start:** on Windows delete `%APPDATA%\Lumen`. On TV, uninstall and reinstall Lumen.
