import SwiftUI

#if os(macOS)
/// Close / minimise / zoom, drawn by us because the full-bleed window hides the system ones.
struct TrafficLights: View {
    @State private var hover = false
    private func btn(_ color: Color, _ glyph: String, _ action: @escaping (NSWindow) -> Void) -> some View {
        Button { if let w = NSApp.keyWindow ?? NSApp.windows.first(where: { $0.isVisible && $0.canBecomeMain }) { action(w) } } label: {
            Circle().fill(color).frame(width: 13, height: 13)
                .overlay { Image(systemName: glyph).font(.system(size: 7, weight: .heavy)).foregroundStyle(.black.opacity(0.6)).opacity(hover ? 1 : 0) }
        }.buttonStyle(.plain)
    }
    var body: some View {
        HStack(spacing: 8) {
            btn(Color(red: 1, green: 0.37, blue: 0.34), "xmark") { $0.close() }
            btn(Color(red: 1, green: 0.74, blue: 0.18), "minus") { $0.miniaturize(nil) }
            btn(Color(red: 0.16, green: 0.79, blue: 0.25), "plus") { $0.toggleFullScreen(nil) }
        }
        .padding(8).background(.black.opacity(0.18), in: Capsule())
        .onHover { hover = $0 }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow

    private let tabs: [SidebarItem] = [.home, .live, .movies, .series, .random, .downloads, .search, .settings]
    @Namespace private var tabPill
    @State private var direction: CGFloat = 1
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var navSpring: Animation { reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.42, dampingFraction: 0.86) }

    var body: some View {
        @Bindable var model = model
        ZStack(alignment: .top) {
            Theme.base.ignoresSafeArea()
            NavigationStack(path: $model.path) {
                screen
                    .hideWindowToolbar()
                    .navigationDestination(for: Route.self) { route in
                        switch route {
                        case .detail(let item): DetailView(item: item).hideWindowToolbar().modifier(PushIn())
                        case .category(let kind, let group): BrowseView(kind: kind, initialGroup: group).hideWindowToolbar().modifier(PushIn())
                        case .person(let name, let role): PersonView(name: name, role: role).hideWindowToolbar().modifier(PushIn())
                        case .page: EmptyView()
                        }
                    }
            }
            .id(model.selection)
            .transition(reduceMotion ? .opacity : .asymmetric(
                insertion: .opacity.combined(with: .offset(x: 36 * direction)).combined(with: .scale(scale: 0.985)),
                removal: .opacity.combined(with: .offset(x: -24 * direction))))
            topBar
            TrafficLights().padding(.leading, 20).padding(.top, 18).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .ignoresSafeArea(.container, edges: .top)
        .animation(navSpring, value: model.selection)
        .background(WindowReader { w in
            // keep the red/yellow/green buttons: transparent title bar, content runs underneath
            w.styleMask.insert([.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView])
            w.titlebarAppearsTransparent = true
            w.titleVisibility = .hidden
            w.isMovableByWindowBackground = false
            for b in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] { w.standardWindowButton(b)?.isHidden = true }
        })
        .overlay { ToastOverlay() }
        .overlay { if model.pickingProfile { ProfilePickerView() } }
        .modifier(IdleWatcher())
        .modifier(PasteToPlay())
        .onKeyPress("/") { if model.pickingProfile { return .ignored }; model.selection = .search; return .handled }
        .onKeyPress(.escape) { goBack() }
        .onAppear { if UserDefaults.standard.bool(forKey: "showProfiles") { model.pickingProfile = true }; if let t = UserDefaults.standard.string(forKey: "startTab"), let s = SidebarItem.allCases.first(where: { "\($0)" == t }) { model.selection = s }; Updater.shared.checkIfDue(); model.downloads.configure(limitGb: model.settings.downloadLimitGb, userAgent: model.settings.userAgent) }
        .task {
            // developer hook for screenshots: -openDetail YES opens the first film
            guard UserDefaults.standard.bool(forKey: "openDetail") else { return }
            for _ in 0..<60 { if let m = model.movies.last { model.path.append(Route.detail(.movie(m))); break }; try? await Task.sleep(for: .milliseconds(250)) }
        }
        .onChange(of: model.selection) { old, new in
            // slide the new page in from the side its tab sits on
            let i = tabs.firstIndex(of: tabHighlight(old)) ?? 0, j = tabs.firstIndex(of: tabHighlight(new)) ?? 0
            direction = j >= i ? 1 : -1
            model.path = NavigationPath()
        }
        .onChange(of: model.pendingPlay) {
            if let r = model.pendingPlay { model.play(openWindow, r); model.pendingPlay = nil }
        }
        // widgets follow the app's theme and accent
        .onChange(of: model.widgetAccentHex) { model.publishWidgets() }
        .onChange(of: model.settings.theme) { model.publishWidgets() }
        .onChange(of: model.settings.widgetAccent) { model.publishWidgets() }
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
                        Button { withAnimation(navSpring) { model.path.removeLast() } } label: {
                            Image(systemName: "chevron.left").font(.system(size: 13, weight: .bold)).frame(width: 32, height: 32)
                                .background(.white.opacity(0.14), in: Circle())
                                .overlay(Circle().strokeBorder(.white.opacity(0.12), lineWidth: 1))
                        }
                        .buttonStyle(HoverPopStyle()).help("Back (⌘[)")
                        .transition(.scale(scale: 0.5).combined(with: .opacity))
                    }
                    Spacer(minLength: 0)
                }
                .padding(.leading, 112).frame(width: 210, alignment: .leading)
                .animation(navSpring, value: model.path.isEmpty)
                Spacer(minLength: 0)
                ViewThatFits(in: .horizontal) { tabBar(labels: true); tabBar(labels: false) }
                Spacer(minLength: 0)
                HStack(spacing: 10) {
                    Spacer(minLength: 0)
                    if let msg = model.progressMessage {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text(msg).font(.system(size: 12, weight: .medium)).foregroundStyle(.white.opacity(0.75)).lineLimit(1)
                            if model.isRefreshing {
                                Button { model.cancelRefresh() } label: {
                                    Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).frame(width: 20, height: 20)
                                        .background(.white.opacity(0.1), in: Circle())
                                }
                                .buttonStyle(.plain).foregroundStyle(.white.opacity(0.7)).help("Cancel refresh").accessibilityLabel("Cancel refresh")
                            }
                        }
                        .padding(.leading, 12).padding(.trailing, 6).frame(height: 32).frame(maxWidth: 280)
                        .transition(.opacity.combined(with: .scale(scale: 0.85, anchor: .trailing)))
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
                .animation(navSpring, value: model.progressMessage == nil)
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
                TabPillButton(item: t, labels: labels, active: tabHighlight(model.selection) == t, namespace: tabPill) {
                    withAnimation(navSpring) { model.selection = t }
                }
            }
        }
        .padding(5)
        .background(Color(white: 0.16, opacity: 0.92), in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.1)))
        .animation(navSpring, value: tabHighlight(model.selection))
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

#if os(macOS)
/// One tab: the white pill glides between tabs, the icon gives a small bounce when chosen.
private struct TabPillButton: View {
    let item: SidebarItem
    let labels: Bool
    let active: Bool
    let namespace: Namespace.ID
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: item.symbol).font(.system(size: 13, weight: .semibold))
                    .symbolEffect(.bounce.down, value: active)
                if labels { Text(item.title).font(.system(size: 13, weight: .semibold)).lineLimit(1) }
            }
            .padding(.horizontal, 13).frame(height: 34)
            .foregroundStyle(active ? Color.white : Color.white.opacity(hover ? 0.85 : 0.58))
            .background {
                ZStack {
                    if hover && !active { Capsule().fill(.white.opacity(0.07)).transition(.opacity) }
                    if active {
                        Capsule().fill(.white.opacity(0.17))
                            .overlay(Capsule().strokeBorder(.white.opacity(0.1), lineWidth: 1))
                            .shadow(color: .black.opacity(0.25), radius: 6, y: 2)
                            .matchedGeometryEffect(id: "pill", in: namespace)
                    }
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(HoverPopStyle(scale: 0.95))
        .onHover { hover = $0 }
        .animation(.easeOut(duration: 0.15), value: hover)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}
#endif

/// Press-down for buttons in the bar.
struct HoverPopStyle: ButtonStyle {
    var scale: CGFloat = 0.9
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? scale : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

/// Pushed pages (detail, person, category) rise in instead of popping in.
struct PushIn: ViewModifier {
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(x: shown || reduceMotion ? 0 : 28)
            .onAppear { withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.45, dampingFraction: 0.88)) { shown = true } }
    }
}

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
                    Label(model.progressMessage ?? "Loading your library…", systemImage: "arrow.triangle.2.circlepath")
                        .font(.system(size: 13, weight: .medium)).foregroundStyle(.white.opacity(0.55))
                        .symbolEffect(.rotate, options: .repeat(.continuous))
                        .padding(.horizontal, Platform.isPhone ? 20 : 56)
                    ForEach(0..<3, id: \.self) { _ in SkeletonShelf() }
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
        .background(ThemeBackground(ambient: true))
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let items: [Item]
    @State private var index = 0
    @State private var paused = false
    @State private var hovering = false
    /// 0...1 fill of the active page dot
    @State private var fill: CGFloat = 0
    @State private var zoom = false
    @State private var forward = true
    private let interval: Double = 9

    var body: some View {
        let item = items[min(index, items.count - 1)]
        let wide = item.backdrop != nil
        ZStack(alignment: .bottomLeading) {
            ZStack {
            ZStack {
                Group {
                    if wide {
                        Artwork(source: item.backdrop, size: "w1280", onColor: { c in Ambient.shared.color = c })
                    } else {
                        LinearGradient(colors: [model.accent.opacity(0.35), Theme.base], startPoint: .topTrailing, endPoint: .bottomLeading)
                    }
                }
                .frame(maxWidth: .infinity).frame(height: Metrics.heroH)
                // slow Ken Burns drift
                .scaleEffect(zoom && !reduceMotion ? 1.07 : 1, anchor: index.isMultiple(of: 2) ? .topLeading : .bottomTrailing)
                .clipped()
            }
            .id(item.id)
            .transition(.asymmetric(insertion: .opacity.combined(with: .scale(scale: 1.03)), removal: .opacity))
            LinearGradient(colors: [Theme.base.opacity(0.92), Theme.base.opacity(0.45), .clear], startPoint: .leading, endPoint: .trailing)
            LinearGradient(colors: [Theme.base.opacity(0.55), .clear], startPoint: .top, endPoint: .init(x: 0.5, y: 0.25))
            }
            // fade the art out to transparent so the page's ambient glow shows through without a seam
            .mask(LinearGradient(stops: [.init(color: .black, location: 0.5), .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom))

            if !wide && !Platform.isPhone {
                Artwork(source: item.artwork, size: "w500", onColor: { c in Ambient.shared.color = c })
                    .frame(width: 250, height: 375)
                    .clipShape(.rect(cornerRadius: 22))
                    .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(.white.opacity(0.15)))
                    .shadow(color: .black.opacity(0.6), radius: 30, y: 20)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
                    .padding(.trailing, 110).padding(.top, 20)
                    .id("poster" + item.id)
                    .transition(.opacity.combined(with: .offset(x: forward ? 40 : -40)))
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
                    .shadow(color: .black.opacity(0.55), radius: 24, y: 6)
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
                    Button { model.toggleWatchlist(item.id) } label: {
                        Image(systemName: model.inWatchlist(item.id) ? "checkmark" : "plus").contentTransition(.symbolEffect(.replace))
                    }
                    .buttonStyle(LumenButtonStyle()).help("My List")
                }
                .padding(.top, 8)
            }
            .id("text" + item.id)
            .transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: 18)), removal: .opacity))
            .padding(.leading, Platform.isPhone ? 20 : 56).padding(.bottom, Platform.isPhone ? 50 : 90)
            .foregroundStyle(.white)

            HStack(spacing: 6) {
                ForEach(items.indices, id: \.self) { i in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.white.opacity(0.3))
                        if i == index {
                            Capsule().fill(.white).frame(width: 28 * fill)
                        }
                    }
                    .frame(width: i == index ? 28 : 6, height: 6)
                    .contentShape(Rectangle().inset(by: -6))
                    .onTapGesture { go(to: i) }
                }
            }
            .padding(.trailing, Platform.isPhone ? 20 : 56).padding(.bottom, Platform.isPhone ? 22 : 92)
            .frame(maxWidth: .infinity, alignment: .trailing)

            #if os(macOS)
            if items.count > 1 {
                HStack {
                    arrow("chevron.left") { go(to: (index - 1 + items.count) % items.count) }
                    Spacer()
                    arrow("chevron.right") { go(to: (index + 1) % items.count) }
                }
                .padding(.horizontal, 14)
                .frame(maxHeight: .infinity)
                .opacity(hovering ? 1 : 0)
                .animation(.easeOut(duration: 0.2), value: hovering)
            }
            #endif
        }
        .frame(height: Metrics.heroH)
        .clipped()
        .onHover { hovering = $0; paused = $0 }
        .task(id: index) {
            // restart the dot fill and the drift for this page, then move on
            var t = Transaction(); t.disablesAnimations = true
            withTransaction(t) { fill = 0; zoom = false }
            withAnimation(.linear(duration: interval)) { fill = 1 }
            withAnimation(.easeInOut(duration: interval + 2)) { zoom = true }
            try? await Task.sleep(for: .seconds(interval))
            while !Task.isCancelled && (paused || !AppModel.appIsActive) { try? await Task.sleep(for: .seconds(0.5)) }
            guard !Task.isCancelled, items.count > 1 else { return }
            go(to: (index + 1) % items.count)
        }
    }

    private func go(to i: Int) {
        forward = i > index || (index == items.count - 1 && i == 0)
        withAnimation(reduceMotion ? .none : .easeInOut(duration: 0.75)) { index = i }
    }

    #if os(macOS)
    private func arrow(_ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 16, weight: .bold))
                .frame(width: 44, height: 44)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().strokeBorder(.white.opacity(0.15), lineWidth: 1))
                .shadow(color: .black.opacity(0.35), radius: 10, y: 4)
        }
        .buttonStyle(HoverPopStyle())
        .accessibilityLabel(symbol == "chevron.left" ? "Previous" : "Next")
    }
    #endif
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
