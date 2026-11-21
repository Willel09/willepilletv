import SwiftUI

#if os(macOS)
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow

    private let tabs: [SidebarItem] = [.home, .live, .movies, .series, .random, .downloads, .search, .settings]

    var body: some View {
        @Bindable var model = model
        ZStack(alignment: .top) {
            Theme.base.ignoresSafeArea()
            NavigationStack(path: $model.path) {
                screen
                    .hideWindowToolbar()
                    .navigationDestination(for: Route.self) { route in
                        switch route {
                        case .detail(let item): DetailView(item: item).hideWindowToolbar()
                        case .category(let kind, let group): BrowseView(kind: kind, initialGroup: group).hideWindowToolbar()
                        case .person(let name, let role): PersonView(name: name, role: role).hideWindowToolbar()
                        case .page: EmptyView()
                        }
                    }
            }
            .id(model.selection)
            topBar
        }
        .ignoresSafeArea(.container, edges: .top)
        .overlay { ToastOverlay() }
        .overlay { if model.pickingProfile { ProfilePickerView() } }
        .modifier(IdleWatcher())
        .modifier(PasteToPlay())
        .onKeyPress("/") { if model.pickingProfile { return .ignored }; model.selection = .search; return .handled }
        .onKeyPress(.escape) { goBack() }
        .onAppear { model.downloads.configure(limitGb: model.settings.downloadLimitGb, userAgent: model.settings.userAgent) }
        .onChange(of: model.selection) { model.path = NavigationPath() }
        .onChange(of: model.pendingPlay) {
            if let r = model.pendingPlay { model.play(openWindow, r); model.pendingPlay = nil }
        }
    }

    private func goBack() -> KeyPress.Result {
        if model.screensaverOn { return .ignored }
        if !model.path.isEmpty { model.path.removeLast(); return .handled }
        if model.selection != .home { model.selection = .home; return .handled }
        return .ignored
    }

    // Floating pill tab bar like the Windows app, with the logo on the left and status on the right.
    private var topBar: some View {
        ZStack {
            LinearGradient(colors: [Theme.base.opacity(0.85), .clear], startPoint: .top, endPoint: .bottom)
                .frame(height: 96).frame(maxHeight: .infinity, alignment: .top).allowsHitTesting(false)
            HStack(spacing: 0) {
                HStack(spacing: 10) {
                    if !model.path.isEmpty {
                        Button { model.path.removeLast() } label: {
                            Image(systemName: "chevron.left").font(.system(size: 13, weight: .bold)).frame(width: 32, height: 32)
                                .background(.white.opacity(0.14), in: Circle())
                        }
                        .buttonStyle(.plain).help("Back (⌘[)")
                    }
                    Spacer(minLength: 0)
                }
                .padding(.leading, 84).frame(width: 190, alignment: .leading)
                Spacer(minLength: 0)
                ViewThatFits(in: .horizontal) { tabBar(labels: true); tabBar(labels: false) }
                Spacer(minLength: 0)
                HStack(spacing: 10) {
                    Spacer(minLength: 0)
                    if let msg = model.progressMessage {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text(msg).font(.system(size: 12, weight: .medium)).foregroundStyle(.white.opacity(0.75)).lineLimit(1)
                        }
                        .padding(.horizontal, 12).frame(height: 32).frame(maxWidth: 240)
                        .background(.white.opacity(0.1), in: Capsule())
                    } else if !model.sources.isEmpty {
                        Button { Task { await model.refresh() } } label: {
                            Image(systemName: "arrow.clockwise").font(.system(size: 13, weight: .semibold)).frame(width: 32, height: 32)
                        }
                        .buttonStyle(.plain).foregroundStyle(.white.opacity(0.55)).help("Refresh library (⌘R)")
                    }
                    Menu {
                        ForEach(model.profiles) { p in Button { model.switchProfile(p.id) } label: { Text(p.name + (p.id == model.activeProfile ? "  ✓" : "")) } }
                        Divider()
                        Button("Who's watching…") { model.pickingProfile = true }
                        Button("My List") { model.selection = .watchlist }
                        Button("TV Guide") { model.selection = .guide }
                        Button("Sources") { model.selection = .sources }
                        Button("Settings") { model.selection = .settings }
                    } label: { AvatarView(id: model.currentProfile.avatar, size: 32) }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                    .help("\(model.currentProfile.name) · switch profile")
                }
                .padding(.trailing, 20).frame(width: 260, alignment: .trailing)
            }
            .frame(maxHeight: .infinity, alignment: .top)
            .padding(.top, 16)
        }
        .frame(height: 76, alignment: .top)
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private func tabHighlight(_ s: SidebarItem?) -> SidebarItem {
        switch s ?? .home { case .guide: .live; case .watchlist: .home; case .sources: .settings; case let x: x }
    }

    private func tabBar(labels: Bool) -> some View {
        HStack(spacing: 2) {
            ForEach(tabs) { t in
                let active = tabHighlight(model.selection) == t
                Button { model.selection = t } label: {
                    HStack(spacing: 7) {
                        Image(systemName: t.symbol).font(.system(size: 13, weight: .semibold))
                        if labels { Text(t.title).font(.system(size: 13, weight: .semibold)).lineLimit(1) }
                    }
                    .padding(.horizontal, 13).frame(height: 34)
                    .foregroundStyle(active ? Color.white : Color.white.opacity(0.58))
                    .background(active ? Color.white.opacity(0.17) : .clear, in: Capsule())
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(5)
        .background(Color(white: 0.16, opacity: 0.92), in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.1)))
    }

    @ViewBuilder private var screen: some View {
        if model.sources.isEmpty && model.selection != .sources {
            OnboardingView().padding(.top, 70)
        } else {
            switch model.selection ?? .home {
            case .home: HomeView()
            case .search: SearchView().padding(.top, 70)
            case .live: LiveView().padding(.top, 70).overlay(alignment: .topTrailing) { LiveSwitch() }
            case .guide: GuideView().padding(.top, 70).overlay(alignment: .topTrailing) { LiveSwitch() }
            case .movies: BrowseView(kind: .movie).padding(.top, 70)
            case .series: BrowseView(kind: .series).padding(.top, 70)
            case .watchlist: WatchlistView().padding(.top, 70)
            case .random: RandomView().padding(.top, 70)
            case .sources: SourcesView().padding(.top, 70)
            case .downloads: DownloadsView()
            case .settings: SettingsView()
            }
        }
    }
}
#endif

struct LogoMark: View {
    @Environment(AppModel.self) private var model
    var size: CGFloat = 30
    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.31)
            .fill(AngularGradient(colors: [model.accent, Color(red: 0.75, green: 0.35, blue: 0.95), Color(red: 1, green: 0.22, blue: 0.37), model.accent], center: .center))
            .frame(width: size, height: size)
            .overlay(Circle().fill(.white.opacity(0.95)).frame(width: size * 0.38, height: size * 0.38))
    }
}

enum Metrics {
    static var top: CGFloat { Platform.isPhone ? 8 : 76 }
    static var hPad: CGFloat { Platform.isPhone ? 16 : 32 }
    static var heroH: CGFloat { Platform.isPhone ? 520 : 600 }
    static var poster: CGFloat { Platform.isPhone ? 118 : 160 }
}

// MARK: - Home

struct HomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        let play = PlayAction(model: model, openWindow: openWindow)
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 30) {
                if !model.heroItems.isEmpty {
                    HeroCarousel(items: model.heroItems)
                }
                #if os(macOS)
                if model.heroItems.isEmpty { Color.clear.frame(height: 70) }
                #endif
                if model.isRefreshing && !model.hasContent {
                    ProgressView(model.progressMessage ?? "Loading your library…").frame(maxWidth: .infinity).padding(80)
                }
                if !model.continueWatching.isEmpty {
                    Shelf(title: "Continue Watching", symbol: "play.circle") {
                        ForEach(model.continueWatching) { h in
                            ContinueCard(entry: h).tapOrEnter { resume(h) }
                        }
                    }
                }
                let fresh = model.newEpisodeShows
                if !fresh.isEmpty {
                    Shelf(title: "New Episodes", symbol: "sparkles.tv") {
                        ForEach(fresh) { s in PosterCard(item: .series(s), badge: "New").tapOrEnter { model.markSeen(s.id); model.path.append(Route.detail(.series(s))) } }
                    }
                }
                let offline = model.downloads.doneItems
                if !offline.isEmpty {
                    Shelf(title: "Downloaded", symbol: "arrow.down.circle", seeAll: { model.selection = .downloads }) {
                        ForEach(offline.prefix(20)) { d in DownloadCard(rec: d).tapOrEnter { model.playDownload(d, openWindow: openWindow) } }
                    }
                }
                if !model.tmdb.recommended.isEmpty {
                    Shelf(title: "Recommended for You", symbol: "wand.and.stars") { ForEach(model.tmdb.recommended) { posterButton($0) } }
                }
                if !model.forYou.isEmpty {
                    Shelf(title: model.tmdb.recommended.isEmpty ? "For You" : "More Like Your Taste", symbol: "heart.text.square") { ForEach(model.forYou) { posterButton($0) } }
                }
                if !model.watchlistItems.isEmpty {
                    Shelf(title: "My List", symbol: "bookmark", seeAll: { model.selection = .watchlist }) {
                        ForEach(model.watchlistItems.prefix(30)) { posterButton($0) }
                    }
                }
                let live = liveNow
                if !live.isEmpty {
                    Shelf(title: "Live Now", subtitle: model.hasGuide ? "On air right now" : nil, symbol: "dot.radiowaves.left.and.right",
                          seeAll: { model.selection = .live }) {
                        ForEach(live) { c in ChannelTile(channel: c).tapOrEnter { play(.live(c)) } }
                    }
                }
                if !model.newestMovies.isEmpty {
                    Shelf(title: "Newest Movies", symbol: "sparkles", seeAll: { model.selection = .movies }) {
                        ForEach(model.newestMovies) { posterButton(.movie($0)) }
                    }
                }
                if !model.newestSeries.isEmpty {
                    Shelf(title: "Newest Series", symbol: "sparkles.tv", seeAll: { model.selection = .series }) {
                        ForEach(model.newestSeries) { posterButton(.series($0)) }
                    }
                }
                if let because = becauseYouWatched {
                    Shelf(title: "Because you watched \(because.title)", symbol: "wand.and.stars") {
                        ForEach(because.items) { posterButton($0) }
                    }
                }
                ForEach(model.user.lists.filter { !$0.items.isEmpty }) { l in
                    Shelf(title: l.name, symbol: "list.bullet.rectangle") { ForEach(model.items(in: l)) { posterButton($0) } }
                }
                if !model.topRated.isEmpty {
                    Shelf(title: "Top Rated", symbol: "star") {
                        ForEach(model.topRated) { posterButton($0) }
                    }
                }
                ForEach(model.tmdb.genreRows) { g in
                    Shelf(title: g.name, symbol: g.kind == .movie ? "film" : "tv") { ForEach(g.items) { posterButton($0) } }
                }
                if !model.favoriteItems.isEmpty {
                    Shelf(title: "Favorites", symbol: "heart") { ForEach(model.favoriteItems.prefix(40)) { posterButton($0) } }
                }
                if !model.recentChannels.isEmpty {
                    Shelf(title: "Recently Watched Channels", symbol: "clock.arrow.circlepath") {
                        ForEach(model.recentChannels) { c in ChannelTile(channel: c).tapOrEnter { play(.live(c)) } }
                    }
                }
            }
            .padding(.bottom, 40)
        }
        .background(ThemeBackground())
    }

    private func posterButton(_ item: Item) -> some View {
        PosterCard(item: item)
            .onTapGesture { model.path.append(Route.detail(item)) }
    }

    private func resume(_ h: HistoryEntry) {
        if let r = model.handle(.play(h.itemId)) { model.play(openWindow, r) }
    }

    private var liveNow: [Channel] {
        let favs = model.favoriteChannels
        let rest = model.channels.prefix(400).filter { model.nowNext(for: $0).now != nil && !model.isFavorite($0.id) }
        return Array((favs + rest).prefix(20))
    }

    /// Titles from the same category as the most recently watched film or series.
    private var becauseYouWatched: (title: String, items: [Item])? {
        guard let last = model.user.history.first(where: { $0.kind != "live" }), let item = model.item(last.itemId) else { return nil }
        let pool: [Item] = item.kind == .movie ? model.movies.filter { $0.group == item.group && $0.id != item.id }.map(Item.movie)
                                               : model.series.filter { $0.group == item.group && $0.id != item.id }.map(Item.series)
        let picks = pool.sorted { ($0.rating ?? 0) > ($1.rating ?? 0) }.prefix(24)
        return picks.count >= 4 ? (SearchKit.cleanTitle(item.name), Array(picks)) : nil
    }
}

struct HeroCarousel: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    let items: [Item]
    @State private var index = 0
    @State private var paused = false

    var body: some View {
        let item = items[min(index, items.count - 1)]
        let wide = item.backdrop != nil
        ZStack(alignment: .bottomLeading) {
            Group {
                if wide {
                    Artwork(source: item.backdrop, size: "w1280")
                } else {
                    LinearGradient(colors: [model.accent.opacity(0.35), Theme.base], startPoint: .topTrailing, endPoint: .bottomLeading)
                }
            }
            .frame(maxWidth: .infinity).frame(height: Metrics.heroH).clipped()
            .id(item.id)
            LinearGradient(colors: [Theme.base.opacity(0.92), Theme.base.opacity(0.45), .clear], startPoint: .leading, endPoint: .trailing)
            LinearGradient(colors: [.clear, Theme.base], startPoint: .init(x: 0.5, y: 0.5), endPoint: .bottom)
            LinearGradient(colors: [Theme.base.opacity(0.55), .clear], startPoint: .top, endPoint: .init(x: 0.5, y: 0.25))

            if !wide && !Platform.isPhone {
                Artwork(source: item.artwork, size: "w500")
                    .frame(width: 250, height: 375)
                    .clipShape(.rect(cornerRadius: 22))
                    .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(.white.opacity(0.15)))
                    .shadow(color: .black.opacity(0.6), radius: 30, y: 20)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
                    .padding(.trailing, 110).padding(.top, 20)
            }

            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Text(item.kind == .series ? "SERIES" : "MOVIE").font(.system(size: 11, weight: .bold)).tracking(1.6)
                        .padding(.horizontal, 8).padding(.vertical, 3).background(.white.opacity(0.14), in: RoundedRectangle(cornerRadius: 6))
                    Text(item.group).font(.system(size: 12, weight: .semibold)).tracking(1.2).textCase(.uppercase).lineLimit(1)
                        .foregroundStyle(.white.opacity(0.6))
                }
                Text(SearchKit.cleanTitle(item.name)).font(.system(size: Platform.isPhone ? 36 : 56, weight: .heavy)).tracking(-2).lineLimit(2).minimumScaleFactor(0.7)
                    .frame(maxWidth: 680, alignment: .leading)
                HStack(spacing: 12) {
                    if let y = item.year { Text(y) }
                    if let r = item.rating {
                        HStack(spacing: 4) { Image(systemName: "star.fill").foregroundStyle(.yellow).font(.system(size: 12)); Text(r, format: .number.precision(.fractionLength(1))) }
                    }
                }
                .font(.system(size: 14, weight: .medium)).foregroundStyle(.white.opacity(0.75))
                HStack(spacing: 12) {
                    Button {
                        if item.kind == .movie, let r = model.request(for: item) { model.play(openWindow, r) }
                        else { model.path.append(Route.detail(item)) }
                    } label: { Label(item.kind == .movie ? "Play" : "Episodes", systemImage: "play.fill") }
                    .buttonStyle(LumenButtonStyle(prominent: true))
                    Button { model.path.append(Route.detail(item)) } label: { Label("More Info", systemImage: "info.circle") }
                        .buttonStyle(LumenButtonStyle())
                    Button { model.toggleWatchlist(item.id) } label: { Image(systemName: model.inWatchlist(item.id) ? "checkmark" : "plus") }
                        .buttonStyle(LumenButtonStyle()).help("My List")
                }
                .padding(.top, 8)
            }
            .padding(.leading, Platform.isPhone ? 20 : 56).padding(.bottom, Platform.isPhone ? 50 : 90)
            .foregroundStyle(.white)

            HStack(spacing: 6) {
                ForEach(items.indices, id: \.self) { i in
                    Capsule().fill(.white.opacity(i == index ? 0.95 : 0.35))
                        .frame(width: i == index ? 28 : 6, height: 6)
                        .onTapGesture { index = i }
                }
            }
            .padding(.trailing, Platform.isPhone ? 20 : 56).padding(.bottom, Platform.isPhone ? 22 : 92)
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .frame(height: Metrics.heroH)
        .onHover { paused = $0 }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(9))
                if !paused { index = (index + 1) % max(1, items.count) }
            }
        }
    }
}

#if os(macOS)
/// Channels | TV Guide, inside the Live TV tab like the Windows app.
struct LiveSwitch: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        HStack(spacing: 0) {
            ForEach([SidebarItem.live, .guide], id: \.self) { t in
                Button { model.selection = t } label: {
                    Text(t == .live ? "Channels" : "TV Guide").font(.system(size: 12, weight: .semibold)).padding(.horizontal, 12).frame(height: 28)
                        .background(model.selection == t ? Color.white.opacity(0.2) : .clear, in: Capsule())
                }.buttonStyle(.plain)
            }
        }
        .padding(3).background(Color(white: 0.16, opacity: 0.92), in: Capsule())
        .padding(.top, 76).padding(.trailing, 20)
    }
}
#endif
