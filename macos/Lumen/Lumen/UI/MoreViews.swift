import SwiftUI
import UniformTypeIdentifiers

// MARK: - Random: a reel of posters that slows down on tonight's pick

struct RandomView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @State private var kind: MediaKind = .movie
    @State private var highRated = false
    @State private var reel: [Item] = []
    @State private var offset: CGFloat = 0
    @State private var pick: Item?
    @State private var spinning = false
    private let cardW: CGFloat = 180, gap: CGFloat = 20

    var body: some View {
        VStack(spacing: 28) {
            HStack(spacing: 14) {
                Picker("Kind", selection: $kind) {
                    Text("Movie").tag(MediaKind.movie)
                    Text("Series").tag(MediaKind.series)
                    Text("Channel").tag(MediaKind.live)
                }
                .pickerStyle(.segmented).frame(width: 280)
                Toggle("Rated 7+", isOn: $highRated).toggleStyle(.switch).disabled(kind == .live)
            }
            .padding(.top, 30)

            GeometryReader { g in
                HStack(spacing: gap) {
                    ForEach(Array(reel.enumerated()), id: \.offset) { i, item in
                        Artwork(source: item.artwork, contentMode: kind == .live ? .fit : .fill, placeholder: kind == .live ? "tv" : "film")
                            .frame(width: cardW, height: cardW * 1.5)
                            .background(.white.opacity(0.05))
                            .clipShape(.rect(cornerRadius: 16))
                            .scaleEffect(!spinning && i == reel.count - 3 ? 1.12 : 0.92)
                            .opacity(!spinning && pick != nil && i != reel.count - 3 ? 0.35 : 1)
                    }
                }
                .offset(x: g.size.width / 2 - cardW / 2 - offset)
                .frame(height: cardW * 1.5 + 30)
            }
            .frame(height: cardW * 1.5 + 30)
            .mask(LinearGradient(colors: [.clear, .black, .black, .clear], startPoint: .leading, endPoint: .trailing))

            if let pick, !spinning {
                VStack(spacing: 10) {
                    Text("Tonight's pick").font(.caption.weight(.heavy)).tracking(1.4).foregroundStyle(model.accent)
                    Text(SearchKit.cleanTitle(pick.name)).font(.largeTitle.weight(.bold)).multilineTextAlignment(.center)
                    HStack { if let y = pick.year { Tag(text: y) }; if let r = pick.rating { RatingBadge(rating: r) }; Tag(text: pick.group) }
                    HStack(spacing: 12) {
                        if pick.kind != .series {
                            Button { PlayAction(model: model, openWindow: openWindow)(pick) } label: { Label("Play", systemImage: "play.fill") }
                                .buttonStyle(.glassProminent)
                        }
                        if pick.kind != .live {
                            Button("Details") { model.path.append(Route.detail(pick)) }.buttonStyle(.glass)
                        }
                        Button { spin() } label: { Label("Spin Again", systemImage: "arrow.trianglehead.2.clockwise") }.buttonStyle(.glass)
                    }
                    .controlSize(.extraLarge)
                }
                .transition(.scale(scale: 0.9).combined(with: .opacity))
            } else {
                Button { spin() } label: { Label("Spin", systemImage: "dice.fill").font(.title3.weight(.semibold)).padding(.horizontal, 26).padding(.vertical, 6) }
                    .buttonStyle(.glassProminent).controlSize(.extraLarge)
                    .disabled(spinning || !model.hasContent)
                    .keyboardShortcut(.space, modifiers: [])
            }
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .background { AmbientBackground(artwork: spinning ? nil : pick?.artwork) }
        .navigationTitle("Random")
        .onAppear { if reel.isEmpty { reel = filler(14) } }
    }

    private func filler(_ n: Int) -> [Item] { (0..<n).compactMap { _ in model.randomPick(kind: kind, minRating: highRated ? 7 : 0) } }

    private func spin() {
        guard let target = model.randomPick(kind: kind, minRating: highRated ? 7 : 0) else { return }
        var r = filler(34)
        r.append(target)
        r += filler(2)
        offset = 0
        reel = r
        pick = target
        spinning = true
        let distance = CGFloat(reel.count - 3) * (cardW + gap)
        withAnimation(.timingCurve(0.1, 0.7, 0.15, 1, duration: 3.6)) { offset = distance } completion: {
            withAnimation(.spring(response: 0.45, dampingFraction: 0.7)) { spinning = false }
        }
    }
}

// MARK: - Onboarding

struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var adding: SourceKind?

    var body: some View {
        VStack(spacing: 22) {
            Image(systemName: "sparkles.tv.fill").font(.system(size: 64)).foregroundStyle(model.accent.gradient)
                .symbolEffect(.bounce, options: .nonRepeating)
            Text("Welcome to Lumen").font(.system(size: 38, weight: .bold))
            Text("Lumen is an IPTV player. It ships with no channels — bring your own M3U playlist or Xtream Codes login, and optionally an XMLTV guide.")
                .font(.title3).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 560)
            HStack(spacing: 18) {
                choice(.xtream, symbol: "server.rack", text: "Server, username and password from your provider")
                choice(.m3u, symbol: "list.bullet.rectangle", text: "A playlist URL or an .m3u file on this Mac")
            }
            .padding(.top, 10)
        }
        .padding(50)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { AmbientBackground(artwork: nil) }
        .sheet(item: $adding) { SourceEditor(source: Source(name: $0 == .m3u ? "My Playlist" : "My Provider", kind: $0)) }
    }

    private func choice(_ kind: SourceKind, symbol: String, text: String) -> some View {
        Button { adding = kind } label: {
            VStack(spacing: 12) {
                Image(systemName: symbol).font(.system(size: 30))
                Text(kind.label).font(.headline)
                Text(text).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .frame(width: 220, height: 160)
            .glassPanel(cornerRadius: 22)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Sources

struct SourcesView: View {
    @Environment(AppModel.self) private var model
    @State private var editing: Source?

    var body: some View {
        @Bindable var model = model
        Form {
            Section {
                ForEach(model.sources) { src in
                    HStack(spacing: 14) {
                        Image(systemName: src.kind == .xtream ? "server.rack" : "list.bullet.rectangle")
                            .font(.title2).frame(width: 34).foregroundStyle(model.accent)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(src.name).font(.headline)
                            Text(src.kind == .xtream ? (src.server ?? "") : (src.url ?? "")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            if let acc = model.library.accounts[src.id] {
                                HStack(spacing: 10) {
                                    if let s = acc.status { Text(s).foregroundStyle(s == "Active" ? .green : .orange) }
                                    if let e = acc.expires { Text("Expires \(e.formatted(date: .abbreviated, time: .omitted))") }
                                    if let m = acc.maxConnections { Text("\(acc.activeConnections ?? 0)/\(m) connections") }
                                }
                                .font(.caption2)
                            }
                        }
                        Spacer()
                        Toggle("Enabled", isOn: Binding(get: { src.enabled }, set: { v in
                            if let i = model.sources.firstIndex(where: { $0.id == src.id }) { model.sources[i].enabled = v }
                        })).labelsHidden().toggleStyle(.switch)
                        Button("Edit") { editing = src }
                    }
                    .padding(.vertical, 4)
                    .contextMenu {
                        Button("Edit") { editing = src }
                        Button("Delete", role: .destructive) { model.sources.removeAll { $0.id == src.id } }
                    }
                }
                .onDelete { model.sources.remove(atOffsets: $0) }
                HStack {
                    Button { editing = Source(name: "My Provider", kind: .xtream) } label: { Label("Add Xtream Codes", systemImage: "plus") }
                    Button { editing = Source(name: "My Playlist", kind: .m3u) } label: { Label("Add M3U Playlist", systemImage: "plus") }
                    Spacer()
                    Button { Task { await model.refresh() } } label: { Label("Reload All", systemImage: "arrow.clockwise") }
                        .disabled(model.isRefreshing || model.sources.isEmpty)
                }
            } header: { Text("Sources") }

            if !model.lastErrors.isEmpty {
                Section("Problems on the last refresh") {
                    ForEach(model.lastErrors, id: \.self) { Label($0, systemImage: "exclamationmark.triangle").foregroundStyle(.orange) }
                }
            }

            Section("TV Guide") {
                TextField("Extra XMLTV URL (.xml or .xml.gz)", text: $model.settings.epgUrl)
                Toggle("Use guides from my providers automatically", isOn: $model.settings.autoProviderEpg)
                HStack {
                    if let d = model.epgUpdatedAt { Text("Updated \(d, format: .relative(presentation: .named))").foregroundStyle(.secondary) }
                    Spacer()
                    Button("Reload Guide") { Task { await model.refreshGuide() } }.disabled(model.epgLoading)
                }
            }

            Section("Library") {
                Text("\(model.channels.count.formatted()) channels · \(model.movies.count.formatted()) movies · \(model.series.count.formatted()) series")
                    .foregroundStyle(.secondary)
                Toggle("Remove BS (hide Arabic and Indian channels, movies and series)", isOn: $model.settings.removeBs)
                TextField("Hidden categories (comma separated)", text: $model.settings.hiddenGroups)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Sources")
        .sheet(item: $editing) { SourceEditor(source: $0) }
    }
}

struct SourceEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State var source: Source
    @State private var importing = false
    @State private var testing = false
    @State private var testResult: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(model.sources.contains { $0.id == source.id } ? "Edit Source" : "Add \(source.kind.label)")
                .font(.title2.weight(.bold)).padding([.horizontal, .top], 24)
            Form {
                Picker("Type", selection: $source.kind) { ForEach(SourceKind.allCases) { Text($0.label).tag($0) } }
                TextField("Name", text: $source.name)
                if source.kind == .xtream {
                    TextField("Server", text: bind(\.server), prompt: Text("http://provider.example:8080"))
                    TextField("Username", text: bind(\.username))
                    SecureField("Password", text: bind(\.password))
                } else {
                    HStack {
                        TextField("Playlist URL", text: bind(\.url), prompt: Text("https://… or choose a file"))
                        Button("Choose File…") { importing = true }
                    }
                }
                TextField("XMLTV guide URL (optional)", text: bind(\.epgUrl))
                if let testResult { Text(testResult).font(.callout).foregroundStyle(testResult.hasPrefix("✓") ? .green : .orange) }
            }
            .formStyle(.grouped)
            HStack {
                if source.kind == .xtream {
                    Button { Task { await test() } } label: { testing ? AnyView(ProgressView().controlSize(.small)) : AnyView(Text("Test Login")) }
                        .disabled(testing)
                }
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Save & Load") { save() }.keyboardShortcut(.defaultAction).buttonStyle(.glassProminent).disabled(!valid)
            }
            .padding(20)
        }
        .frame(width: 520)
        .fileImporter(isPresented: $importing, allowedContentTypes: [UTType(filenameExtension: "m3u") ?? .plainText, UTType(filenameExtension: "m3u8") ?? .plainText, .plainText]) { r in
            if case .success(let url) = r { source.url = url.absoluteString; if source.name == "My Playlist" { source.name = url.deletingPathExtension().lastPathComponent } }
        }
    }

    private var valid: Bool {
        source.kind == .m3u ? !(source.url ?? "").isEmpty : !(source.server ?? "").isEmpty && !(source.username ?? "").isEmpty && !(source.password ?? "").isEmpty
    }

    private func bind(_ kp: WritableKeyPath<Source, String?>) -> Binding<String> {
        Binding(get: { source[keyPath: kp] ?? "" }, set: { source[keyPath: kp] = $0.isEmpty ? nil : $0.trimmingCharacters(in: .whitespaces) })
    }

    private func test() async {
        testing = true
        defer { testing = false }
        do {
            let auth = try await Net.json(Xtream.api(source), ua: model.settings.userAgent) as? [String: Any]
            let ui = auth?["user_info"] as? [String: Any]
            if ui == nil || Xtream.num(ui?["auth"]) == 0 { testResult = "Login failed. Check your username and password." }
            else { testResult = "✓ Signed in · \(Xtream.str(ui?["status"]) ?? "OK")" }
        } catch { testResult = error.localizedDescription }
    }

    private func save() {
        if let i = model.sources.firstIndex(where: { $0.id == source.id }) { model.sources[i] = source } else { model.sources.append(source) }
        dismiss()
        Task { await model.refresh() }
    }
}

// MARK: - Settings window (⌘,)

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        @Bindable var model = model
        TabView {
            Form {
                Picker("Artwork glow", selection: $model.settings.ambient) {
                    Text("Strong").tag(AppSettings.Ambient.strong); Text("Subtle").tag(AppSettings.Ambient.subtle); Text("Off").tag(AppSettings.Ambient.off)
                }
                ColorPicker("Accent colour", selection: Binding(get: { model.accent }, set: { model.settings.accentHex = $0.hexString }))
                HStack {
                    ForEach(["#98A2B3", "#0A84FF", "#FF375F", "#30D158", "#FF9F0A", "#BF5AF2", "#64D2FF"], id: \.self) { hex in
                        Circle().fill(Color(hex: hex) ?? .gray).frame(width: 20, height: 20)
                            .overlay(Circle().strokeBorder(.white, lineWidth: model.settings.accentHex == hex ? 2 : 0))
                            .onTapGesture { model.settings.accentHex = hex }
                    }
                }
                Toggle("Show Lumen in the menu bar", isOn: $model.settings.showMenuBarExtra)
            }
            .formStyle(.grouped)
            .tabItem { Label("Appearance", systemImage: "paintbrush") }

            Form {
                Picker("Live stream format", selection: $model.settings.liveFormat) {
                    Text("HLS (.m3u8) — recommended on Mac").tag(AppSettings.LiveFormat.m3u8)
                    Text("MPEG-TS (.ts)").tag(AppSettings.LiveFormat.ts)
                }
                Toggle("Play the next episode automatically", isOn: $model.settings.autoplayNext)
                Picker("External player", selection: $model.settings.externalPlayer) {
                    Text("IINA").tag("IINA"); Text("VLC").tag("VLC"); Text("Infuse").tag("Infuse")
                }
                Text("Used for formats macOS can't play itself, such as MKV with AC3 audio or raw MPEG-TS.").font(.caption).foregroundStyle(.secondary)
            }
            .formStyle(.grouped)
            .tabItem { Label("Playback", systemImage: "play.rectangle") }

            Form {
                Stepper("Refresh the library every \(model.settings.refreshHours) h", value: $model.settings.refreshHours, in: 1...72)
                TextField("User-Agent", text: $model.settings.userAgent, prompt: Text("Lumen/1.0 (Macintosh)"))
                Section("Data") {
                    Button("Clear Watch History", role: .destructive) { model.user.history.removeAll(); model.publishWidgets() }
                    Button("Clear My List", role: .destructive) { model.user.watchlist.removeAll(); model.publishWidgets() }
                }
            }
            .formStyle(.grouped)
            .tabItem { Label("Advanced", systemImage: "gearshape.2") }
        }
        .frame(width: 520, height: 380)
    }
}

extension Color {
    var hexString: String {
        let c = NSColor(self).usingColorSpace(.sRGB) ?? .gray
        return String(format: "#%02X%02X%02X", Int(c.redComponent * 255), Int(c.greenComponent * 255), Int(c.blueComponent * 255))
    }
}

