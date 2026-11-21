// Settings: profiles, themes, library, TMDB, sync & devices, downloads, playback.
import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var editing: ProfileEdit?
    @State private var linkSheet: LinkMode?
    @State private var tvInstall = false
    @State private var enterCode = ""
    @State private var showCode = false

    enum LinkMode: String, Identifiable { case send, receive; var id: String { rawValue } }

    var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Settings").font(.system(size: 30, weight: .bold)).tracking(-1).padding(.bottom, 4)

                card("Profiles", symbol: "person.2.fill", note: "Everyone gets their own list, favorites and history.") {
                    HStack(spacing: 18) {
                        ForEach(model.profiles) { p in
                            VStack(spacing: 6) {
                                AvatarView(id: p.avatar, size: 56)
                                    .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(.white, lineWidth: p.id == model.activeProfile ? 2.5 : 0))
                                Text(p.name).font(.caption).lineLimit(1)
                            }
                            .frame(width: 70)
                            .contentShape(.rect)
                            .onTapGesture { model.switchProfile(p.id) }
                            .contextMenu { Button("Edit…") { editing = ProfileEdit(profile: p) } }
                        }
                        Button { editing = ProfileEdit(profile: nil) } label: { Image(systemName: "plus").font(.title3).frame(width: 56, height: 56).background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 16)) }
                            .buttonStyle(.plain)
                        Spacer()
                        Button("Who's watching…") { model.pickingProfile = true }.buttonStyle(LumenButtonStyle())
                    }
                }

                card("Appearance", symbol: "paintbrush.fill") {
                    Text("Theme").font(.callout.weight(.semibold))
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 12)], spacing: 12) {
                        ForEach(LumenTheme.all) { t in
                            VStack(spacing: 6) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 12).fill(t.baseColor)
                                    RadialGradient(colors: [t.glowColors[0].opacity(0.8), .clear], center: .topLeading, startRadius: 0, endRadius: 70)
                                    Circle().fill(Color(hex: t.accent) ?? .gray).frame(width: 18, height: 18).offset(x: 30, y: 16)
                                }
                                .frame(height: 58)
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(model.settings.theme == t.id ? Color.white : .white.opacity(0.12), lineWidth: model.settings.theme == t.id ? 2.5 : 1))
                                Text(t.name).font(.caption)
                            }
                            .onTapGesture { model.settings.theme = t.id }
                        }
                    }
                    Divider().opacity(0.3)
                    Text("Accent colour").font(.callout.weight(.semibold))
                    HStack(spacing: 10) {
                        accentDot(nil)
                        ForEach(LumenTheme.accents, id: \.self) { accentDot($0) }
                        ColorPicker("", selection: Binding(get: { model.accent }, set: { model.settings.accentOverride = $0.hexString }), supportsOpacity: false).labelsHidden()
                    }
                    Picker("Artwork glow", selection: $model.settings.ambient) {
                        Text("Strong").tag(AppSettings.Ambient.strong); Text("Subtle").tag(AppSettings.Ambient.subtle); Text("Off").tag(AppSettings.Ambient.off)
                    }.pickerStyle(.segmented).frame(maxWidth: 320)
                    Stepper(model.settings.screensaverMins == 0 ? "Screensaver: never" : "Screensaver after \(model.settings.screensaverMins) min idle", value: $model.settings.screensaverMins, in: 0...60)
                    #if os(macOS)
                    Toggle("Show Lumen in the menu bar", isOn: $model.settings.showMenuBarExtra)
                    #endif
                }

                card("Library", symbol: "externaldrive.connected.to.line.below.fill") {
                    Text("\(model.channels.count.formatted()) channels · \(model.movies.count.formatted()) movies · \(model.series.count.formatted()) series · \(model.sources.count) source\(model.sources.count == 1 ? "" : "s")")
                        .foregroundStyle(.secondary)
                    HStack {
                        Button("Manage sources…") { model.selection = .sources }.buttonStyle(LumenButtonStyle())
                        Button { Task { await model.refresh() } } label: { Label("Reload library", systemImage: "arrow.clockwise") }.buttonStyle(LumenButtonStyle()).disabled(model.isRefreshing)
                    }
                    Toggle("Remove BS (hide Arabic and Indian channels, movies and series)", isOn: $model.settings.removeBs)
                    TextField("Hidden categories (comma separated)", text: $model.settings.hiddenGroups).textFieldStyle(.roundedBorder)
                    TextField("TV guide (XMLTV) URL", text: $model.settings.epgUrl).textFieldStyle(.roundedBorder)
                    Toggle("Find the guide from my providers automatically", isOn: $model.settings.autoProviderEpg)
                    Stepper("Refresh every \(model.settings.refreshHours) h", value: $model.settings.refreshHours, in: 1...72)
                }

                card("TMDB & ratings", symbol: "star.fill", note: "A free TMDB key turns on actor and director pages, “Recommended for You” and genre rows.") {
                    SecureField("TMDB API key or read access token", text: $model.settings.tmdbKey).textFieldStyle(.roundedBorder)
                    Link("Get a free key at themoviedb.org/settings/api", destination: URL(string: "https://www.themoviedb.org/settings/api")!).font(.caption)
                    SecureField("OMDb key (optional)", text: $model.settings.omdbKey).textFieldStyle(.roundedBorder)
                }

                card("Sync & devices", symbol: "arrow.triangle.2.circlepath", note: "Your sources, lists, favorites, history and settings follow you between Mac, PC, TV and web. Everything is encrypted on this Mac first.") {
                    if model.syncCode.isEmpty {
                        HStack {
                            Button("Create sync code") { model.syncCode = SyncCrypto.newSyncCode(); model.scheduleSync(delay: 0.5) }.buttonStyle(LumenButtonStyle(prominent: true))
                            Button("Get it from another device…") { linkSheet = .receive }.buttonStyle(LumenButtonStyle())
                        }
                        HStack {
                            TextField("or type a sync code", text: $enterCode).textFieldStyle(.roundedBorder).frame(maxWidth: 300)
                            Button("Use code") { model.syncCode = SyncCrypto.group(SyncCrypto.normalize(enterCode)); enterCode = ""; model.scheduleSync(delay: 0.5) }
                                .disabled(SyncCrypto.normalize(enterCode).count < 20)
                        }
                    } else {
                        HStack {
                            Text(showCode ? model.syncCode : String(repeating: "•", count: 29)).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                            Button { showCode.toggle() } label: { Image(systemName: showCode ? "eye.slash" : "eye") }.buttonStyle(.plain)
                            Button { Pasteboard.copy(model.syncCode); model.toast = "Sync code copied" } label: { Image(systemName: "doc.on.doc") }.buttonStyle(.plain)
                        }
                        HStack(spacing: 10) {
                            if model.syncing { ProgressView().controlSize(.small) }
                            Text(model.syncStatus ?? (model.lastSync.map { "Synced \($0.formatted(.relative(presentation: .named)))" } ?? "Not synced yet"))
                                .font(.callout).foregroundStyle(model.syncStatus == nil ? Color.secondary : Color.orange)
                            Spacer()
                            Button { Task { await model.syncNow() } } label: { Label("Sync now", systemImage: "arrow.triangle.2.circlepath") }.buttonStyle(LumenButtonStyle()).disabled(model.syncing)
                        }
                        HStack {
                            Button { linkSheet = .send } label: { Label("Link a device…", systemImage: "tv.and.mediabox") }.buttonStyle(LumenButtonStyle(prominent: true))
                            Button("Stop syncing", role: .destructive) { model.disconnectSync() }.buttonStyle(LumenButtonStyle())
                        }
                        Text("To link a TV or another computer, open Lumen on it, choose “Already use Lumen on another device? Link it”, and type the code it shows here.").font(.caption).foregroundStyle(.secondary)
                    }
                    Divider().opacity(0.3)
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Samsung TV").font(.callout.weight(.semibold))
                            Text("Install Lumen on a Samsung TV step by step.").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Install on Samsung TV…") { tvInstall = true }.buttonStyle(LumenButtonStyle())
                    }
                }

                card("Downloads", symbol: "arrow.down.circle.fill") {
                    Stepper(model.settings.downloadLimitGb == 0 ? "No size limit" : "Use up to \(model.settings.downloadLimitGb) GB", value: $model.settings.downloadLimitGb, in: 0...2000, step: 5)
                    Toggle("Remove a download once I've watched it to the end", isOn: $model.settings.deleteWatched)
                    Text("\(ByteCountFormatter.string(fromByteCount: model.downloads.used, countStyle: .file)) used").font(.caption).foregroundStyle(.secondary)
                }

                card("Playback", symbol: "play.rectangle.fill") {
                    Picker("Live stream format", selection: $model.settings.liveFormat) {
                        Text("HLS (.m3u8) — recommended on Mac").tag(AppSettings.LiveFormat.m3u8)
                        Text("MPEG-TS (.ts)").tag(AppSettings.LiveFormat.ts)
                    }
                    Toggle("Play the next episode automatically", isOn: $model.settings.autoplayNext)
                    Picker("External player", selection: $model.settings.externalPlayer) {
                        Text("IINA").tag("IINA"); Text("VLC").tag("VLC"); Text("Infuse").tag("Infuse")
                    }
                    TextField("User-Agent", text: $model.settings.userAgent, prompt: Text("Lumen/1.0 (Macintosh)")).textFieldStyle(.roundedBorder)
                    Text("The external player is used for formats macOS can't play itself, such as MKV with AC3 audio or raw MPEG-TS. Tip: paste a stream link anywhere (⌘V) to play it.").font(.caption).foregroundStyle(.secondary)
                }

                card("Data", symbol: "trash") {
                    HStack {
                        Button("Clear watch history", role: .destructive) { model.user.history.removeAll(); model.publishWidgets() }.buttonStyle(LumenButtonStyle())
                        Button("Clear My List", role: .destructive) { model.user.watchlist.removeAll(); model.publishWidgets() }.buttonStyle(LumenButtonStyle())
                    }
                }
            }
            .padding(.horizontal, Metrics.hPad).padding(.top, Metrics.top).padding(.bottom, 50).frame(maxWidth: 820, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(ThemeBackground())
        .sheet(item: $editing) { ProfileEditor(edit: $0) }
        .sheet(item: $linkSheet) { LinkDeviceSheet(mode: $0) }
        .sheet(isPresented: $tvInstall) { TvInstallSheet() }
    }

    private func accentDot(_ hex: String?) -> some View {
        let h = hex ?? model.theme.accent
        let selected = hex == nil ? model.settings.accentOverride.isEmpty : model.settings.accentOverride.caseInsensitiveCompare(h) == .orderedSame
        return Circle().fill(Color(hex: h) ?? .gray).frame(width: 22, height: 22)
            .overlay(Circle().strokeBorder(.white, lineWidth: selected ? 2.5 : 0))
            .overlay { if hex == nil { Image(systemName: "sparkles").font(.system(size: 9, weight: .bold)).foregroundStyle(.white) } }
            .onTapGesture { model.settings.accentOverride = hex ?? "" }
            .help(hex == nil ? "Theme accent" : h)
    }

    private func card<C: View>(_ title: String, symbol: String, note: String? = nil, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: symbol).font(.system(size: 17, weight: .bold))
            if let note { Text(note).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            content()
        }
        .padding(18).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(.white.opacity(0.07)))
    }
}

// MARK: - Link a device

struct LinkDeviceSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let mode: SettingsView.LinkMode
    @State private var code = ""
    @State private var pairCode = SyncCrypto.newPairCode()
    @State private var status: String?
    @State private var busy = false
    @State private var done = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if mode == .send {
                Text("Link a device").font(.title2.weight(.bold))
                Text("On the other device choose “Already use Lumen on another device? Link it”. It shows a code. Type it here.").foregroundStyle(.secondary)
                TextField("ABCD-EFGH-JKLM", text: $code).textFieldStyle(.roundedBorder).font(.system(.title3, design: .monospaced)).onSubmit(send)
                if let status { Text(status).foregroundStyle(done ? .green : .orange) }
                HStack { Spacer(); Button("Close") { dismiss() }; Button { send() } label: { if busy { ProgressView().controlSize(.small) } else { Text("Link") } }
                    .buttonStyle(.borderedProminent).disabled(SyncCrypto.normalize(code).count < 12 || busy) }
            } else {
                Text("Get your library from another device").font(.title2.weight(.bold))
                Text("On a device that already uses Lumen open Settings → Sync & devices → Link a device, then type this code there:").foregroundStyle(.secondary)
                Text(pairCode).font(.system(size: 32, weight: .bold, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity)
                HStack(spacing: 8) { if !done { ProgressView().controlSize(.small) }; Text(status ?? "Waiting for the other device…").foregroundStyle(done ? .green : .secondary) }
                HStack { Spacer(); Button(done ? "Done" : "Cancel") { dismiss() } }
            }
        }
        .padding(26).frame(maxWidth: 520)
        .task { if mode == .receive { await wait() } }
    }

    private func send() {
        guard !busy else { return }
        busy = true; status = nil
        Task {
            do {
                if model.syncCode.isEmpty { model.syncCode = SyncCrypto.newSyncCode() }
                try await SyncServer.sendPairing(pairCode: code, syncCode: model.syncCode)
                await model.sync.run(model: model)
                status = "Sent. The other device is linking now."; done = true
            } catch { status = error.localizedDescription }
            busy = false
        }
    }

    private func wait() async {
        let deadline = Date.now.addingTimeInterval(600)
        while !Task.isCancelled && Date.now < deadline {
            if let c = try? await SyncServer.receivePairing(pairCode: pairCode) {
                model.syncCode = c; status = "Linked! Loading your library…"; done = true
                await model.sync.run(model: model, manual: true)
                return
            }
            try? await Task.sleep(for: .seconds(3))
        }
        if !done { status = "The code expired. Close this and try again." }
    }
}

// MARK: - Samsung TV guide

struct TvInstallSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    @State private var ips: [String] = []
    @State private var tvs: [SamsungTV]?
    @State private var scanning = false
    @State private var ip = ""
    @State private var devMode: Bool?
    private let repo = "Willel09/willepilletv"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack { Text("Install Lumen on your Samsung TV").font(.title2.weight(.bold)); Spacer(); Button("Close") { dismiss() } }.padding(.bottom, 10)

                step(1, "Turn on Developer Mode on the TV", done: devMode == true) {
                    Text("On the TV open **Apps**, then press **1 2 3 4 5** on the remote. Switch **Developer mode** on and enter this Mac's IP address as the **Host PC IP**:")
                    if ips.isEmpty { Text("No network connection found.").foregroundStyle(.secondary) }
                    ForEach(ips.prefix(2), id: \.self) { copyChip("This Mac", $0) }
                    Text("Then turn the TV off and on again (hold the power button until the logo appears).")
                }
                step(2, "Find your TV", done: devMode == true) {
                    ForEach(tvs ?? []) { t in
                        Button { ip = t.ip; devMode = t.devMode } label: {
                            HStack {
                                Image(systemName: "tv")
                                VStack(alignment: .leading) { Text(t.name).fontWeight(.semibold); Text(t.ip).font(.caption).foregroundStyle(.secondary) }
                                Spacer()
                                Label(t.devMode ? "Developer Mode on" : "Developer Mode off", systemImage: t.devMode ? "checkmark" : "xmark").font(.caption.weight(.semibold)).foregroundStyle(t.devMode ? .green : .orange)
                            }
                            .padding(12).background(ip == t.ip ? Color.white.opacity(0.14) : Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
                        }.buttonStyle(.plain)
                    }
                    if let tvs, tvs.isEmpty, !scanning { Text("No TV found automatically. Type its IP address below (TV → Settings → General → Network → Network Status → IP Settings).").foregroundStyle(.secondary) }
                    HStack {
                        TextField("TV IP address, e.g. 192.168.1.50", text: $ip).textFieldStyle(.roundedBorder).onChange(of: ip) { devMode = nil }
                        Button("Check") { Task { devMode = await TvInstall.devModeOn(ip.trimmingCharacters(in: .whitespaces)) } }.disabled(ip.isEmpty)
                        Button { Task { await scan() } } label: { if scanning { ProgressView().controlSize(.small) } else { Label("Search again", systemImage: "dot.radiowaves.left.and.right") } }.disabled(scanning)
                    }
                    if devMode == false { Text("Developer Mode isn't answering on \(ip). Check step 1 and restart the TV.").foregroundStyle(.orange) }
                    if devMode == true { Text("Ready: the TV accepts installs.").foregroundStyle(.green) }
                }
                step(3, "Install") {
                    Text("Open **SmartTV Installer** (a free, open-source tool). Choose **Samsung**, then fill in:")
                    copyChip("TV IP address", ip.isEmpty ? "—" : ip)
                    copyChip("Preset → Custom GitHub Repository", repo)
                    Text("Press **Install**. The first time, a Samsung account sign-in opens in your browser. That creates the developer certificate for your TV (free; any Samsung account works).")
                    Button { Platform.open(URL(string: "https://github.com/Krishnakant010/smarttv-installer/releases/latest")!) } label: { Label("Open TV Installer download", systemImage: "arrow.up.forward.app") }
                        .buttonStyle(LumenButtonStyle(prominent: true))
                }
                step(4, "Link the TV to this Mac") {
                    Text("Open Lumen on the TV and choose **Already use Lumen on another device? Link it**. Then, here in Settings, press **Sync & devices → Link a device** and type the code the TV shows. Your sources and lists appear on the TV, with no typing on the remote.")
                }
            }
            .padding(26)
        }
        .frame(maxWidth: 640, maxHeight: 640)
        .task { ips = TvInstall.localIps(); await scan() }
    }

    private func scan() async {
        scanning = true
        let found = await TvInstall.discover()
        tvs = found; scanning = false
        if let ready = found.first(where: \.devMode) ?? found.first, ip.isEmpty { ip = ready.ip; devMode = ready.devMode }
    }

    private func copyChip(_ label: String, _ value: String) -> some View {
        Button { Pasteboard.copy(value); model.toast = "Copied \(value)" } label: {
            HStack { Text(label).foregroundStyle(.secondary); Spacer(); Text(value).font(.system(.body, design: .monospaced).weight(.semibold)); Image(systemName: "doc.on.doc").font(.caption) }
                .padding(.horizontal, 14).padding(.vertical, 9).background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
        }.buttonStyle(.plain)
    }

    private func step<C: View>(_ n: Int, _ title: String, done: Bool = false, @ViewBuilder _ content: () -> C) -> some View {
        HStack(alignment: .top, spacing: 14) {
            ZStack { Circle().fill(done ? Color.green : Color.white.opacity(0.14)).frame(width: 30, height: 30); if done { Image(systemName: "checkmark").fontWeight(.bold) } else { Text("\(n)").fontWeight(.bold) } }
            VStack(alignment: .leading, spacing: 10) { Text(title).font(.headline); content().foregroundStyle(.white.opacity(0.75)) }
        }
        .padding(.bottom, 18)
    }
}
