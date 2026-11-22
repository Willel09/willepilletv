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
            VStack(spacing: 10) {
                Text("Feeling lucky?").font(.system(size: 42, weight: .heavy)).tracking(-1.6)
                Text("Pick what you're in the mood for and let Lumen choose.").font(.system(size: 15)).foregroundStyle(.white.opacity(0.55))
            }
            .padding(.top, 26)
            #if os(macOS)
            HStack(spacing: 12) {
                GlideSegmented(options: [(MediaKind.movie, "Movie"), (.series, "Series"), (.live, "Channel")], value: $kind).fixedSize()
                if kind != .live {
                    GlideSegmented(options: [(false, "Anything"), (true, "Rated 7+")], value: $highRated).fixedSize()
                        .transition(.opacity.combined(with: .scale(scale: 0.9)))
                }
            }
            .animation(.snappy, value: kind)
            .onChange(of: kind) { pick = nil; reel = filler(14); offset = CGFloat(reel.count / 2) * (cardW + gap) }
            #else
            HStack(spacing: 14) {
                Picker("Kind", selection: $kind) {
                    Text("Movie").tag(MediaKind.movie)
                    Text("Series").tag(MediaKind.series)
                    Text("Channel").tag(MediaKind.live)
                }
                .pickerStyle(.segmented).frame(width: 280)
                Toggle("Rated 7+", isOn: $highRated).toggleStyle(.switch).disabled(kind == .live)
            }
            #endif

            GeometryReader { g in
                HStack(spacing: gap) {
                    ForEach(Array(reel.enumerated()), id: \.offset) { i, item in
                        Artwork(source: item.artwork, contentMode: kind == .live ? .fit : .fill, placeholder: kind == .live ? "tv" : "film")
                            .frame(width: cardW, height: cardW * 1.5)
                            .background(.white.opacity(0.05))
                            .clipShape(.rect(cornerRadius: 20, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(.white.opacity(!spinning && i == reel.count - 3 && pick != nil ? 0.6 : 0.08), lineWidth: 1.5))
                            .shadow(color: !spinning && i == reel.count - 3 && pick != nil ? model.accent.opacity(0.55) : .black.opacity(0.3), radius: !spinning && i == reel.count - 3 ? 30 : 10, y: 8)
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
                VStack(spacing: 12) {
                    Text(SearchKit.cleanTitle(pick.name)).font(.system(size: 36, weight: .heavy)).tracking(-1.2).multilineTextAlignment(.center).lineLimit(2)
                        .frame(maxWidth: 760)
                    HStack(spacing: 12) {
                        if let y = pick.year { Text(y) }
                        if let r = pick.rating, r > 0 { HStack(spacing: 4) { Image(systemName: "star.fill").foregroundStyle(.yellow).font(.system(size: 12)); Text(r, format: .number.precision(.fractionLength(1))) } }
                        Text(pick.group).lineLimit(1).foregroundStyle(.white.opacity(0.5))
                    }
                    .font(.system(size: 15, weight: .medium)).foregroundStyle(.white.opacity(0.65))
                    HStack(spacing: 12) {
                        if pick.kind != .series {
                            Button { PlayAction(model: model, openWindow: openWindow)(pick) } label: { Label(pick.kind == .live ? "Watch" : "Play", systemImage: "play.fill") }
                                .buttonStyle(BigButtonStyle(prominent: true))
                        }
                        if pick.kind != .live {
                            Button("Details") { model.path.append(Route.detail(pick)) }.buttonStyle(BigButtonStyle(prominent: pick.kind == .series))
                        }
                        Button { spin() } label: { Label("Spin again", systemImage: "arrow.counterclockwise") }.buttonStyle(BigButtonStyle())
                            .keyboardShortcut(.space, modifiers: [])
                    }
                    .padding(.top, 8)
                }
                .transition(.scale(scale: 0.9).combined(with: .opacity))
            } else {
                VStack(spacing: 14) {
                    Button { spin() } label: { Label(spinning ? "Spinning…" : "Spin", systemImage: "dice.fill").font(.system(size: 17, weight: .bold)).padding(.horizontal, 18) }
                        .buttonStyle(BigButtonStyle(prominent: true))
                        .disabled(spinning || filler(1).isEmpty)
                        .keyboardShortcut(.space, modifiers: [])
                    if filler(1).isEmpty {
                        Text("There are no \(kind == .live ? "channels" : kind == .movie ? "movies" : "series") in your library yet.")
                            .font(.system(size: 14)).foregroundStyle(.white.opacity(0.5))
                    }
                }
            }
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .background {
            ZStack {
                ThemeBackground()
                if let pick, !spinning {
                    Artwork(source: pick.artwork, size: "w342").blur(radius: 90).saturation(1.6).opacity(0.35)
                        .frame(width: 700, height: 500).frame(maxWidth: .infinity, maxHeight: .infinity)
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.8), value: spinning)
        }
        .navigationTitle("Random")
        .task(id: model.movies.count + model.series.count + model.channels.count) { if reel.count < 3 { reel = filler(14); offset = CGFloat(reel.count / 2) * (cardW + gap) } }
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
    @State private var linking = false

    @ViewBuilder private var choices: some View {
        choice(.xtream, symbol: "server.rack", text: "Server, username and password from your provider")
        choice(.m3u, symbol: "list.bullet.rectangle", text: Platform.isPhone ? "A playlist URL or an .m3u file" : "A playlist URL or an .m3u file on this Mac")
    }

    var body: some View {
        VStack(spacing: 22) {
            Image(systemName: "sparkles.tv.fill").font(.system(size: 64)).foregroundStyle(model.accent.gradient)
                .symbolEffect(.bounce, options: .nonRepeating)
            Text("Welcome to Lumen").font(.system(size: Platform.isPhone ? 30 : 38, weight: .bold))
            Text("Lumen is an IPTV player. It ships with no channels — bring your own M3U playlist or Xtream Codes login, and optionally an XMLTV guide.")
                .font(Platform.isPhone ? .callout : .title3).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 560)
            ViewThatFits {
                HStack(spacing: 18) { choices }
                VStack(spacing: 14) { choices }
            }
            .padding(.top, 10)
            Button { linking = true } label: { Label("Already use Lumen on another device? Link it", systemImage: "link") }
                .buttonStyle(.plain).foregroundStyle(.secondary).font(.callout)
        }
        .padding(Platform.isPhone ? 20 : 50)
        .sheet(isPresented: $linking) { LinkDeviceSheet(mode: .receive) }
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
            .frame(maxWidth: Platform.isPhone ? .infinity : 220).frame(width: Platform.isPhone ? nil : 220, height: 160)
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
                TextField("Hide categories containing (adult, xxx, 24/7)", text: $model.settings.hiddenGroups)
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
                Button("Save & Load") { save() }.keyboardShortcut(.defaultAction).buttonStyle(LumenButtonStyle(prominent: true)).disabled(!valid)
            }
            .padding(20)
        }
        .frame(maxWidth: 520)
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

