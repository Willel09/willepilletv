// The phone / iPad app: a tab bar, full-screen player, and the screens that don't share the Mac layout.
#if os(iOS)
import SwiftUI
import AVKit

struct PhoneRoot: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @State private var tabPaths: [SidebarItem: NavigationPath] = [:]

    private var tabs: [SidebarItem] { [.home, .live, .movies, .search, .settings] }

    var body: some View {
        @Bindable var model = model
        TabView(selection: Binding(get: { tab(model.selection) }, set: { switchTo($0) })) {
            ForEach(tabs, id: \.self) { t in
                Tab(title(t), systemImage: t.symbol, value: t, role: t == .search ? .search : nil) {
                    stack(t)
                }
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .overlay { ToastOverlay() }
        .overlay { if model.pickingProfile { ProfilePickerView() } }
        .modifier(IdleWatcher())
        .fullScreenCover(isPresented: $model.showPlayer, onDismiss: { model.activePlayer?.stop(); model.nowPlaying = nil }) {
            PhonePlayer().environment(model).preferredColorScheme(.dark)
        }
        .onChange(of: model.selection) {
            if let s = model.selection, [.random, .watchlist, .downloads, .sources].contains(s), model.path.isEmpty { model.path.append(Route.page(s)) }
        }
        .onChange(of: model.pendingPlay) {
            if let r = model.pendingPlay { model.play(openWindow, r); model.pendingPlay = nil }
        }
        .onAppear { model.downloads.configure(limitGb: model.settings.downloadLimitGb, userAgent: model.settings.userAgent) }
    }

    private func title(_ t: SidebarItem) -> String { t == .movies ? "Library" : t == .settings ? "More" : t.title }
    private func tab(_ s: SidebarItem?) -> SidebarItem {
        switch s ?? .home { case .guide: .live; case .series: .movies; case .watchlist, .random, .downloads, .sources: .settings; case let x: x }
    }

    private func switchTo(_ t: SidebarItem) {
        guard t != tab(model.selection) else { if !model.path.isEmpty { model.path = NavigationPath() }; return }
        tabPaths[tab(model.selection)] = model.path
        model.path = tabPaths[t] ?? NavigationPath()
        model.selection = t
    }

    @ViewBuilder private func page(_ p: SidebarItem) -> some View {
        switch p {
        case .random: RandomView()
        case .watchlist: WatchlistView()
        case .downloads: DownloadsView()
        case .sources: SourcesView()
        case .guide: PhoneGuide(group: "__all__")
        default: SettingsView()
        }
    }

    @ViewBuilder private func stack(_ t: SidebarItem) -> some View {
        @Bindable var model = model
        let active = tab(model.selection) == t
        NavigationStack(path: active ? $model.path : .constant(tabPaths[t] ?? NavigationPath())) {
            Group {
                if model.sources.isEmpty && t != .settings { OnboardingView() }
                else {
                    switch t {
                    case .home: HomeView()
                    case .live: PhoneLive()
                    case .movies: PhoneLibrary()
                    case .search: SearchView()
                    default: PhoneMore()
                    }
                }
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .detail(let item): DetailView(item: item)
                case .category(let kind, let group): BrowseView(kind: kind, initialGroup: group)
                case .person(let name, let role): PersonView(name: name, role: role)
                case .page(let p): page(p)
                }
            }
        }
    }
}

// MARK: - Library (Movies | Series)

struct PhoneLibrary: View {
    @Environment(AppModel.self) private var model
    @State private var kind: MediaKind = .movie

    var body: some View {
        BrowseView(kind: kind, initialGroup: nil)
            .id(kind)
            .safeAreaInset(edge: .top, spacing: 0) {
                Picker("", selection: $kind) { Text("Movies").tag(MediaKind.movie); Text("Series").tag(MediaKind.series) }
                    .pickerStyle(.segmented).padding(.horizontal, 16).padding(.vertical, 8).background(.bar)
            }
            .onAppear { if model.selection == .series { kind = .series } }
    }
}

// MARK: - Live TV

struct PhoneLive: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @State private var group = "__fav__"
    @State private var filter = ""
    @State private var guide = false

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $guide) { Text("Channels").tag(false); Text("TV Guide").tag(true) }
                .pickerStyle(.segmented).padding(.horizontal, 16).padding(.vertical, 8)
            if guide { PhoneGuide(group: group) } else {
                SearchField(text: $filter, prompt: "Filter channels").padding(.horizontal, 16).padding(.bottom, 8)
                groupBar
                List(channels) { c in
                    Button { if let r = model.request(for: .live(c)) { model.play(openWindow, r) } } label: { ChannelRow(channel: c) }
                        .buttonStyle(.plain).listRowBackground(Color.clear)
                        .swipeActions { Button { model.toggleFavorite(c.id) } label: { Image(systemName: model.isFavorite(c.id) ? "heart.slash" : "heart") }.tint(.pink) }
                        .itemContextMenu(.live(c))
                }
                .listStyle(.plain)
                .overlay { if channels.isEmpty { EmptyState(symbol: "tv", title: "No channels", message: group == "__fav__" ? "Swipe a channel to favorite it." : "Try another category.") } }
            }
        }
        .background(ThemeBackground())
        .navigationTitle("Live TV")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { if model.favoriteChannels.isEmpty && group == "__fav__" { group = "__all__" } }
    }

    private var groupBar: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                chip("Favorites", "__fav__"); chip("Recent", "__recent__"); chip("All", "__all__")
                ForEach(model.liveGroups, id: \.self) { chip($0, $0) }
            }.padding(.horizontal, 16)
        }.scrollIndicators(.hidden).padding(.bottom, 6)
    }
    private func chip(_ title: String, _ key: String) -> some View {
        Button { group = key } label: {
            Text(title).font(.system(size: 13, weight: .semibold)).lineLimit(1).padding(.horizontal, 12).frame(height: 30)
                .background(group == key ? model.accent.opacity(0.9) : Color.white.opacity(0.1), in: Capsule())
                .foregroundStyle(group == key ? .white : .white.opacity(0.8))
        }.buttonStyle(.plain)
    }

    private var channels: [Channel] {
        var list: [Channel]
        switch group {
        case "__fav__": list = model.favoriteChannels
        case "__recent__": list = model.recentChannels
        case "__all__": list = Array(model.channels.prefix(3000))
        default: list = model.channels.filter { $0.group == group }
        }
        if !filter.isEmpty { list = model.channels.filter { $0.name.localizedCaseInsensitiveContains(filter) } }
        return Array(list.prefix(800))
    }
}

struct PhoneGuide: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    let group: String

    var body: some View {
        let list: [Channel] = group == "__fav__" ? model.favoriteChannels : Array(model.channels.filter { !model.schedule(for: $0).isEmpty }.prefix(150))
        if !model.hasGuide {
            EmptyState(symbol: "calendar", title: "No TV guide", message: "Lumen finds guides from Xtream sources and the M3U url-tvg header, or add an XMLTV URL in Settings.")
        } else {
            List(list) { c in
                let nn = model.nowNext(for: c)
                Button { if let r = model.request(for: .live(c)) { model.play(openWindow, r) } } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(c.name).font(.headline).lineLimit(1)
                        if let now = nn.now {
                            HStack { Text(now.title).lineLimit(1); Spacer(); Text("until \(now.stop.formatted(date: .omitted, time: .shortened))").foregroundStyle(.secondary) }.font(.subheadline)
                            ProgressBar(value: now.progress(), tint: model.accent)
                        }
                        if let next = nn.next { Text("Next · \(next.start.formatted(date: .omitted, time: .shortened)) \(next.title)").font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                    }
                }
                .buttonStyle(.plain).listRowBackground(Color.clear)
            }.listStyle(.plain)
        }
    }
}

// MARK: - More

struct PhoneMore: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @State private var settings = false

    var body: some View {
        List {
            Section {
                Button { model.pickingProfile = true } label: {
                    HStack(spacing: 14) { AvatarView(id: model.currentProfile.avatar, size: 44); VStack(alignment: .leading) { Text(model.currentProfile.name).font(.headline); Text("Switch profile").font(.caption).foregroundStyle(.secondary) } }
                }
            }
            Section {
                Button {
                    if let t = Pasteboard.string, model.playPasted(t, openWindow: openWindow) {} else { model.toast = "The clipboard doesn't hold a stream link." }
                } label: { Label("Play Link from Clipboard", systemImage: "doc.on.clipboard") }
                navLink("My List", "bookmark.fill", .watchlist)
                navLink("Downloads", "arrow.down.circle.fill", .downloads)
                navLink("Random", "dice.fill", .random)
                navLink("Sources", "externaldrive.connected.to.line.below.fill", .sources)
                navLink("Settings", "gearshape.fill", .settings)
            }
        }
        .scrollContentBackground(.hidden)
        .background(ThemeBackground())
        .navigationTitle("More")
    }

    private func navLink(_ title: String, _ symbol: String, _ p: SidebarItem) -> some View {
        NavigationLink(value: Route.page(p)) { Label(title, systemImage: symbol) }
    }
}

// MARK: - Player

struct PhonePlayer: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var pm = PlayerModel()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            PlayerController(player: pm.player, title: pm.request?.title ?? "", subtitle: pm.request?.subtitle, artwork: pm.request?.artwork)
                .ignoresSafeArea()
            if pm.buffering && pm.error == nil { ProgressView().controlSize(.large).tint(.white) }
            if let e = pm.error { errorCard(e) }
            if let next = pm.upNext { upNext(next) }
            VStack {
                HStack(spacing: 10) {
                    Button { dismiss() } label: { Image(systemName: "chevron.down").font(.system(size: 15, weight: .bold)).frame(width: 40, height: 40).background(.black.opacity(0.5), in: Circle()) }
                    Spacer()
                    if pm.request?.kind == "live" {
                        Button { pm.zap(-1) } label: { Image(systemName: "chevron.up").frame(width: 40, height: 40).background(.black.opacity(0.5), in: Circle()) }
                        Button { pm.zap(1) } label: { Image(systemName: "chevron.down").frame(width: 40, height: 40).background(.black.opacity(0.5), in: Circle()) }
                    }
                    Menu {
                        if let id = pm.request?.itemId { Button(model.isFavorite(id) ? "Remove Favorite" : "Favorite", systemImage: "heart") { model.toggleFavorite(id) } }
                        Section("Sleep Timer") {
                            ForEach([15, 30, 60, 90], id: \.self) { m in Button("\(m) minutes") { pm.sleepAt = .now.addingTimeInterval(Double(m) * 60); model.toast = "Pausing in \(m) min" } }
                            if pm.sleepAt != nil { Button("Turn Off") { pm.sleepAt = nil } }
                        }
                        if let u = pm.request?.url, pm.request?.localFile == nil {
                            Button("Open in \(model.settings.externalPlayer)") { pm.player.pause(); model.openExternally(u) }
                            Button("Copy Stream URL") { Pasteboard.copy(u) }
                        }
                    } label: { Image(systemName: "ellipsis").frame(width: 40, height: 40).background(.black.opacity(0.5), in: Circle()) }
                }
                .foregroundStyle(.white).padding(.horizontal, 16).padding(.top, 8)
                Spacer()
            }
        }
        .onAppear { if let r = model.nowPlaying { pm.load(r) }; model.activePlayer = pm }
        .onChange(of: model.nowPlaying) { if let r = model.nowPlaying, r != pm.request { pm.load(r) } }
        .statusBarHidden(true)
    }

    private func errorCard(_ e: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill").font(.largeTitle).foregroundStyle(.yellow)
            Text(e).multilineTextAlignment(.center)
            HStack {
                Button("Try Again") { if let r = pm.request { pm.load(r) } }.buttonStyle(LumenButtonStyle())
                if let u = pm.request?.url { Button("Open in \(model.settings.externalPlayer)") { model.openExternally(u) }.buttonStyle(LumenButtonStyle(prominent: true)) }
            }
        }
        .padding(22).background(Color(white: 0.12, opacity: 0.95), in: RoundedRectangle(cornerRadius: 22)).padding(30)
    }

    private func upNext(_ next: PlaybackRequest) -> some View {
        VStack { Spacer(); HStack {
            VStack(alignment: .leading) { Text("Up next in \(pm.upNextCountdown)").font(.caption).foregroundStyle(.secondary); Text(next.subtitle ?? next.title).font(.callout.weight(.semibold)).lineLimit(1) }
            Spacer()
            Button("Play Now") { pm.load(next) }.buttonStyle(LumenButtonStyle(prominent: true))
            Button("Cancel") { pm.upNext = nil }.buttonStyle(LumenButtonStyle())
        }.padding(14).background(Color(white: 0.12, opacity: 0.95), in: RoundedRectangle(cornerRadius: 18)).padding(16).padding(.bottom, 50) }
    }
}

/// AVPlayerViewController: native controls with AirPlay, Picture in Picture, subtitles and speed.
struct PlayerController: UIViewControllerRepresentable {
    let player: AVPlayer
    let title: String
    let subtitle: String?
    let artwork: String?

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        vc.player = player
        vc.allowsPictureInPicturePlayback = true
        vc.canStartPictureInPictureAutomaticallyFromInline = true
        vc.entersFullScreenWhenPlaybackBegins = false
        vc.showsPlaybackControls = true
        vc.videoGravity = .resizeAspect
        return vc
    }
    func updateUIViewController(_ vc: AVPlayerViewController, context: Context) { if vc.player !== player { vc.player = player } }
}
#endif
