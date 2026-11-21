# Lumen for Mac

A native SwiftUI version of [Lumen](https://github.com/Willel09/willepilletv) for macOS 26+, with Liquid Glass design.

Open `Lumen/Lumen.xcodeproj` in Xcode and press **Run** (⌘R).

## What's in it

| Area | Files |
| --- | --- |
| Models, M3U / Xtream / XMLTV (incl. `.xml.gz`) parsers, ranked search, "Remove BS" filter | `Lumen/Core/` |
| App state, refresh, history, favorites, widget publishing | `Lumen/Core/AppModel.swift` |
| SwiftUI components (posters, channel tiles, shelves, hero, glass panels, toasts) | `Lumen/UI/Components.swift` |
| Screens: Home, Search, Live TV, TV Guide grid, Movies/Series, Detail, My List, Random, Sources, Settings | `Lumen/UI/` |
| Player: AVKit (PiP, AirPlay, tracks, speed), channel zapping, number entry, Up Next, sleep timer, Keep on Top, media keys / Now Playing | `Lumen/Player/Player.swift` |
| Shortcuts & Siri: Watch Channel, Continue Watching, Surprise Me, Search, Refresh | `Lumen/Intents/` |
| Widgets: Continue Watching, Live Now, Tonight's Pick, Library + Control Center controls | `LumenWidgets/` |
| Snapshot + deep links shared by app and widgets (`lumen://…`) | `Shared/` |

Also: a menu bar extra, a Go/Playback menu with shortcuts (⌘1–9, ⌘F, ⌘R, ⌘↑/↓ to zap, ⌥⌘1–9 favorite channels).

IDs use the same cyrb53 hash as the Windows/TV/web app.

## Formats

AVFoundation plays HLS (`.m3u8`), MP4 and MOV. Xtream live channels use HLS by default. For MKV/AVI/raw TS the player
offers **Open in IINA / VLC** (pick the player in Settings → Playback).

## Widgets and signing

Without an Apple ID in Xcode the project signs locally, and the app writes the widget data straight into the widget's
own container. For the proper App Group setup:

1. Xcode → Settings → Accounts → add your Apple ID (a free one works).
2. Select your team for both targets under Signing & Capabilities.
3. Set `CODE_SIGN_ENTITLEMENTS` to `Lumen/Lumen.entitlements` (app) and `LumenWidgetsExtension.entitlements` (widget).
   Both already contain the `group.se.willepille.Lumen` App Group; the code picks it up automatically.

## Demo

`Demo/demo.m3u` has public test streams (Apple HLS samples, Blender films). Add it under **Sources → Add M3U Playlist → Choose File…**.
`Demo/guide.xml` is a sample XMLTV guide for those channels (ids `bipbop`, `advanced`, `mux`); paste its `file://` URL as the
source's guide URL to try the TV Guide. Its times are fixed, so the programmes only line up on the day it was generated.
