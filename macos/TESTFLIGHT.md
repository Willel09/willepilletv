# Lumen on iPhone: TestFlight

The iPhone/iPad app is the same Xcode target as the Mac app (`Lumen`, scheme `Lumen`, bundle id `se.willepille.Lumen`),
with the widgets in `LumenWidgetsExtension`. It builds for the simulator and for devices today; only the Apple account
steps below need you.

## One-time setup (needs a paid Apple Developer Program membership, 99 USD/year)

1. Xcode → Settings → Accounts → add your Apple ID.
2. developer.apple.com → Certificates, Identifiers & Profiles → **App Groups** → register `group.se.willepille.Lumen`.
3. App Store Connect → Apps → **+** → New App: platform iOS, bundle id `se.willepille.Lumen` (register it if it isn't listed), name "Lumen".
4. In Xcode open `macos/Lumen/Lumen.xcodeproj`, select the `Lumen` target → Signing & Capabilities → pick your team, and the same for
   `LumenWidgetsExtension` (bundle id `se.willepille.Lumen.LumenWidgets`). Both already point at the App Group entitlement for device builds.

## Each TestFlight build

1. Destination: **Any iOS Device (arm64)**. Product → **Archive**.
2. Organizer → the new archive → **Distribute App** → App Store Connect → Upload.
3. App Store Connect → TestFlight → wait for processing (a few minutes), add yourself under Internal Testing, and install with the TestFlight app.
4. Bump *Build* (CURRENT_PROJECT_VERSION) before every upload.

Encryption export compliance is already answered (`ITSAppUsesNonExemptEncryption = NO`).

## Run it in the simulator without any account

```bash
cd macos/Lumen
xcodebuild -project Lumen.xcodeproj -scheme Lumen -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/lumen-ios build CODE_SIGNING_ALLOWED=NO
xcrun simctl install booted /tmp/lumen-ios/Build/Products/Debug-iphonesimulator/Lumen.app
xcrun simctl launch booted se.willepille.Lumen
```
