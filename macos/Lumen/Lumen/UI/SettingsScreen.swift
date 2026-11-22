// Settings: profiles, themes, library, TMDB, sync & devices, downloads, playback.
import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var editing: ProfileEdit?
    @AppStorage("uiSounds") private var uiSounds = true
    @State private var linkSheet: LinkMode?
    @State private var tvInstall = false
    @State private var enterCode = ""
    @State private var showCode = false
    @State private var editingSource: Source?

    enum LinkMode: String, Identifiable { case send, receive; var id: String { rawValue } }

    var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Settings").font(.system(size: 34, weight: .bold)).tracking(-1.2).padding(.horizontal, 6).padding(.bottom, 6)

                #if os(macOS)
                card("Sources", symbol: "link", actions: {
                    Button { Task { await model.refresh() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                        .buttonStyle(LumenButtonStyle()).disabled(model.isRefreshing || model.sources.isEmpty)
                    Menu {
                        Button("Xtream Codes account") { editingSource = Source(name: "My Provider", kind: .xtream) }
                        Button("M3U playlist") { editingSource = Source(name: "My Playlist", kind: .m3u) }
                    } label: { Label("Add", systemImage: "plus") }
                        .menuStyle(.button).buttonStyle(LumenButtonStyle(prominent: true)).fixedSize()
                }) {
                    if model.sources.isEmpty {
                        Text("Add an Xtream Codes account or an M3U playlist to fill your library.").font(.callout).foregroundStyle(.secondary)
                    }
                    ForEach(model.sources) { src in SourceRow(source: src) { editingSource = src } }
                    if !model.sources.isEmpty {
                        Divider().opacity(0.4)
                        HStack(spacing: 6) {
                            Text("\(model.channels.count.formatted()) channels · \(model.movies.count.formatted()) movies · \(model.series.count.formatted()) series")
                            if model.library.updatedAt > .distantPast { Text("· updated \(model.library.updatedAt, format: .relative(presentation: .named))") }
                        }
                        .font(.system(size: 13)).foregroundStyle(.white.opacity(0.45))
                    }
                    ForEach(model.lastErrors, id: \.self) { Label($0, systemImage: "exclamationmark.triangle.fill").font(.callout).foregroundStyle(.orange) }
                }

                card("TV Guide", symbol: "list.bullet.rectangle") {
                    settingRow("Use provider guides", "Load the XMLTV guide from each Xtream account automatically.") {
                        Toggle("", isOn: $model.settings.autoProviderEpg).labelsHidden().toggleStyle(.switch)
                    }
                    settingRow("Extra XMLTV guide URL", ".xml or .xml.gz, used on top of the provider guides.") {
                        TextField("https://…", text: $model.settings.epgUrl).textFieldStyle(.plain).font(.system(size: 13.5))
                            .padding(.horizontal, 14).frame(width: 280, height: 36)
                            .background(.black.opacity(0.28), in: Capsule())
                            .overlay(Capsule().strokeBorder(.white.opacity(0.08), lineWidth: 1))
                    }
                    settingRow(model.epgLoading ? "Loading the guide…" : "Guide",
                               model.epgUpdatedAt.map { "Updated \($0.formatted(.relative(presentation: .named)))" } ?? "Not loaded yet") {
                        Button { Task { await model.refreshGuide() } } label: { Label("Reload", systemImage: "arrow.clockwise") }
                            .buttonStyle(LumenButtonStyle()).disabled(model.epgLoading)
                    }
                }
                #endif

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
                    Divider().opacity(0.3)
                    Text("Widget colour").font(.callout.weight(.semibold))
                    HStack(spacing: 10) {
                        widgetDot(nil)
                        ForEach(LumenTheme.accents, id: \.self) { widgetDot($0) }
                        ColorPicker("", selection: Binding(get: { Color(hex: model.widgetAccentHex) ?? model.accent }, set: { model.settings.widgetAccent = $0.hexString }), supportsOpacity: false).labelsHidden()
                    }
                    Text("Colours the widgets on your desktop. Pick the first dot to follow the app's accent.").font(.caption).foregroundStyle(.secondary)
                    Picker("Artwork glow", selection: $model.settings.ambient) {
                        Text("Strong").tag(AppSettings.Ambient.strong); Text("Subtle").tag(AppSettings.Ambient.subtle); Text("Off").tag(AppSettings.Ambient.off)
                    }.pickerStyle(.segmented).frame(maxWidth: 320)
                    Stepper(model.settings.screensaverMins == 0 ? "Screensaver: never" : "Screensaver after \(model.settings.screensaverMins) min idle", value: $model.settings.screensaverMins, in: 0...60)
                    #if os(macOS)
                    Toggle("Show Lumen in the menu bar", isOn: $model.settings.showMenuBarExtra)
                    Toggle("Interface sounds (play, favorite, download done)", isOn: $uiSounds)
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
                    TextField("Hide categories containing (adult, xxx, 24/7)", text: $model.settings.hiddenGroups).textFieldStyle(.roundedBorder)
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
                    TextField("User-Agent", text: $model.settings.userAgent, prompt: Text(Net.defaultUA)).textFieldStyle(.roundedBorder)
                    Text("The external player is used for formats macOS can't play itself, such as MKV with AC3 audio or raw MPEG-TS. Tip: paste a stream link anywhere (⌘V) to play it.").font(.caption).foregroundStyle(.secondary)
                }

                #if os(macOS)
                card("Updates", symbol: "arrow.down.app.fill", note: "Lumen updates itself: it downloads the newest Mac release from GitHub, swaps the app and restarts. No reinstall.") {
                    UpdateRow()
                }
                #endif

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
        .sheet(item: $editingSource) { SourceEditor(source: $0) }
        .sheet(isPresented: $tvInstall) { TvInstallSheet() }
    }

    private func widgetDot(_ hex: String?) -> some View {
        let h = hex ?? model.accentHex
        let selected = hex == nil ? model.settings.widgetAccent.isEmpty : model.settings.widgetAccent.caseInsensitiveCompare(h) == .orderedSame
        return Circle().fill(Color(hex: h) ?? .gray).frame(width: 22, height: 22)
            .overlay(Circle().strokeBorder(.white, lineWidth: selected ? 2.5 : 0))
            .overlay { if hex == nil { Image(systemName: "link").font(.system(size: 9, weight: .bold)).foregroundStyle(.white) } }
            .onTapGesture { model.settings.widgetAccent = hex ?? "" }
            .help(hex == nil ? "Follow the app accent" : h)
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
        card(title, symbol: symbol, note: note, actions: { EmptyView() }, content: content)
    }

    /// Big top-lit card like the Windows app: title row with actions on the right, content below.
    private func card<A: View, C: View>(_ title: String, symbol: String, note: String? = nil, @ViewBuilder actions: () -> A, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.system(size: 18, weight: .bold)).tracking(-0.3)
                    if let note { Text(note).font(.system(size: 13)).foregroundStyle(.white.opacity(0.5)).fixedSize(horizontal: false, vertical: true) }
                }
                Spacer(minLength: 12)
                HStack(spacing: 10) { actions() }
                Image(systemName: symbol).font(.system(size: 17, weight: .medium)).foregroundStyle(.white.opacity(0.28))
            }
            content()
        }
        .padding(.horizontal, 28).padding(.vertical, 24).frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(LinearGradient(colors: [.white.opacity(0.085), .white.opacity(0.035)], startPoint: .top, endPoint: .bottom))
                .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .strokeBorder(LinearGradient(colors: [.white.opacity(0.16), .white.opacity(0.04)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
                .shadow(color: .black.opacity(0.25), radius: 24, y: 12)
        }
    }

    /// Title and explanation on the left, the control on the right.
    private func settingRow<C: View>(_ title: String, _ subtitle: String? = nil, @ViewBuilder control: () -> C) -> some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 15, weight: .semibold))
                if let subtitle { Text(subtitle).font(.system(size: 13)).foregroundStyle(.white.opacity(0.48)).fixedSize(horizontal: false, vertical: true) }
            }
            Spacer(minLength: 12)
            control()
        }
        .padding(.vertical, 4)
    }
}

#if os(macOS)
/// A source in Settings: icon tile, name, account details, edit and remove buttons.
struct SourceRow: View {
    @Environment(AppModel.self) private var model
    let source: Source
    let edit: () -> Void
    @State private var confirmDelete = false

    var body: some View {
        HStack(spacing: 16) {
            RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.white.opacity(0.08))
                .frame(width: 48, height: 48)
                .overlay(Image(systemName: source.kind == .xtream ? "link" : "list.bullet.rectangle").font(.system(size: 18, weight: .semibold)).foregroundStyle(.white.opacity(0.75)))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.white.opacity(0.08), lineWidth: 1))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(source.name).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                    if !source.enabled { Text("Off").font(.system(size: 11, weight: .bold)).padding(.horizontal, 7).padding(.vertical, 2).background(.white.opacity(0.1), in: Capsule()) }
                }
                Text(details).font(.system(size: 13)).foregroundStyle(.white.opacity(0.5)).lineLimit(1)
            }
            Spacer(minLength: 12)
            Toggle("", isOn: Binding(get: { source.enabled }, set: { v in
                if let i = model.sources.firstIndex(where: { $0.id == source.id }) { model.sources[i].enabled = v }
            })).labelsHidden().toggleStyle(.switch).help(source.enabled ? "Turn this source off" : "Turn this source on")
            circleButton("pencil", label: "Edit", action: edit)
            circleButton("trash", label: "Remove") { confirmDelete = true }
        }
        .padding(.vertical, 4)
        .confirmationDialog("Remove \(source.name)?", isPresented: $confirmDelete) {
            Button("Remove", role: .destructive) { withAnimation(.snappy) { model.sources.removeAll { $0.id == source.id } } }
        } message: { Text("Its channels, movies and series leave your library. You can add it again later.") }
    }

    private var details: String {
        var parts: [String] = [source.kind == .xtream ? "Xtream Codes" : "M3U playlist"]
        if let acc = model.library.accounts[source.id] {
            if let e = acc.expires { parts.append("Expires \(e.formatted(date: .numeric, time: .omitted))") }
            if let m = acc.maxConnections { parts.append("\(m) connection\(m == 1 ? "" : "s")") }
            if let st = acc.status, st != "Active" { parts.append(st) }
        }
        return parts.joined(separator: " · ")
    }

    private func circleButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 14, weight: .semibold)).frame(width: 40, height: 40)
                .background(.white.opacity(0.08), in: Circle())
                .overlay(Circle().strokeBorder(.white.opacity(0.1), lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(RailPressStyle())
        .help(label).accessibilityLabel(label)
    }
}
#endif

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
                if !done {
                    Divider().opacity(0.4)
                    Text("Or type the sync code from your other device (Settings → Sync & devices):").foregroundStyle(.secondary)
                    HStack {
                        TextField("XXXXX-XXXXX-XXXXX-XXXXX-XXXXX", text: $code).textFieldStyle(.roundedBorder)
                            .font(.system(.body, design: .monospaced)).onSubmit(useCode)
                        Button { useCode() } label: { if busy { ProgressView().controlSize(.small) } else { Text("Use code") } }
                            .buttonStyle(.borderedProminent).disabled(SyncCrypto.normalize(code).count < 20 || busy)
                    }
                }
                HStack { Spacer(); Button(done ? "Done" : "Cancel") { dismiss() } }
            }
        }
        .padding(26).frame(maxWidth: 520)
        .task { if mode == .receive { await wait() } }
    }

    /// Link by typing the sync code straight in, instead of waiting for the other device.
    private func useCode() {
        guard !busy, SyncCrypto.normalize(code).count >= 20 else { return }
        busy = true; status = "Linking…"; done = false
        model.sync.reset()   // start from a clean slate: old bookkeeping must not read as deletions
        model.syncCode = SyncCrypto.group(SyncCrypto.normalize(code))
        Task {
            await model.sync.run(model: model, manual: true)
            busy = false
            if let err = model.syncStatus {
                status = err
            } else {
                done = true
                status = model.sources.isEmpty ? "Linked. That code has no sources yet." : "Linked! Loading your library…"
            }
        }
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
                if let err = model.syncStatus { status = err; done = false }
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

#if os(macOS)
struct UpdateRow: View {
    private var u: Updater { Updater.shared }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Text("Version \(u.currentVersion)").font(.callout.weight(.semibold))
                Spacer()
                switch u.state {
                case .available:
                    Button("Update and Restart") { Task { await u.install() } }.buttonStyle(LumenButtonStyle())
                case .downloading, .installing, .checking:
                    ProgressView().controlSize(.small)
                default:
                    Button("Check for Updates") { Task { await u.check() } }.buttonStyle(LumenButtonStyle())
                }
            }
            switch u.state {
            case .upToDate: Label("You're on the latest version.", systemImage: "checkmark.circle.fill").font(.caption).foregroundStyle(.secondary)
            case .available(let v, _): Label("Version \(v) is available.", systemImage: "sparkles").font(.caption).foregroundStyle(.secondary)
            case .downloading(let p): ProgressView(value: p).tint(.white)
            case .installing: Text("Installing — Lumen will restart.").font(.caption).foregroundStyle(.secondary)
            case .failed(let m): Text(m).font(.caption).foregroundStyle(.red)
            default: EmptyView()
            }
        }
    }
}
#endif
