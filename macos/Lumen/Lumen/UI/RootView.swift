import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        @Bindable var model = model
        NavigationSplitView {
            List(selection: $model.selection) {
                Section {
                    ForEach([SidebarItem.home, .search]) { row($0) }
                }
                Section("Library") {
                    ForEach([SidebarItem.live, .guide, .movies, .series]) { row($0) }
                }
                Section("You") {
                    ForEach([SidebarItem.watchlist, .random, .sources]) { row($0) }
                }
                if !model.favoriteChannels.isEmpty {
                    Section("Favorite Channels") {
                        ForEach(model.favoriteChannels.prefix(8)) { c in
                            Button {
                                if let r = model.request(for: .live(c)) { model.play(openWindow, r) }
                            } label: {
                                Label { Text(c.name).lineLimit(1) } icon: {
                                    Artwork(source: c.logo, contentMode: .fit, placeholder: "tv").frame(width: 18, height: 18)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: 200, ideal: 230)
            .safeAreaInset(edge: .bottom) { StatusFooter().padding(12) }
        } detail: {
            NavigationStack(path: $model.path) {
                screen
                    .navigationDestination(for: Route.self) { route in
                        switch route {
                        case .detail(let item): DetailView(item: item)
                        case .category(let kind, let group): BrowseView(kind: kind, initialGroup: group)
                        }
                    }
            }
        }
        .onChange(of: model.selection) { model.path = NavigationPath() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await model.refresh() }
                } label: {
                    if model.isRefreshing { ProgressView().controlSize(.small) } else { Label("Refresh", systemImage: "arrow.clockwise") }
                }
                .help("Reload all sources (⌘R)")
                .disabled(model.sources.isEmpty)
            }
        }
        .overlay { ToastOverlay() }
        .onChange(of: model.pendingPlay) {
            if let r = model.pendingPlay { model.play(openWindow, r); model.pendingPlay = nil }
        }
    }

    private func row(_ s: SidebarItem) -> some View {
        Label(s.title, systemImage: s.symbol).tag(s)
    }

    @ViewBuilder private var screen: some View {
        if model.sources.isEmpty && model.selection != .sources {
            OnboardingView()
        } else {
            switch model.selection ?? .home {
            case .home: HomeView()
            case .search: SearchView()
            case .live: LiveView()
            case .guide: GuideView()
            case .movies: BrowseView(kind: .movie)
            case .series: BrowseView(kind: .series)
            case .watchlist: WatchlistView()
            case .random: RandomView()
            case .sources: SourcesView()
            }
        }
    }
}

private struct StatusFooter: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        if let msg = model.progressMessage {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(msg).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .glassPanel(cornerRadius: 12)
        } else if model.library.updatedAt > .distantPast {
            Text("Updated \(model.library.updatedAt, format: .relative(presentation: .named))")
                .font(.caption2).foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Home

struct HomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @State private var ambientArt: String?

    var body: some View {
        let play = PlayAction(model: model, openWindow: openWindow)
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 34) {
                if !model.heroItems.isEmpty {
                    HeroCarousel(items: model.heroItems) { ambientArt = $0 }
                }
                if model.isRefreshing && !model.hasContent {
                    ProgressView(model.progressMessage ?? "Loading your library…").frame(maxWidth: .infinity).padding(80)
                }
                if !model.continueWatching.isEmpty {
                    Shelf(title: "Continue Watching", symbol: "play.circle") {
                        ForEach(model.continueWatching) { h in
                            ContinueCard(entry: h).onTapGesture { resume(h) }
                        }
                    }
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
                        ForEach(live) { c in ChannelTile(channel: c).onTapGesture { play(.live(c)) } }
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
                if !model.topRated.isEmpty {
                    Shelf(title: "Top Rated", symbol: "star") {
                        ForEach(model.topRated) { posterButton($0) }
                    }
                }
                if !model.recentChannels.isEmpty {
                    Shelf(title: "Recently Watched Channels", symbol: "clock.arrow.circlepath") {
                        ForEach(model.recentChannels) { c in ChannelTile(channel: c).onTapGesture { play(.live(c)) } }
                    }
                }
            }
            .padding(.bottom, 40)
        }
        .background { AmbientBackground(artwork: ambientArt) }
        .navigationTitle("Home")
    }

    private func posterButton(_ item: Item) -> some View {
        PosterCard(item: item)
            .onTapGesture { model.path.append(Route.detail(item)) }
            .onHover { if $0 { ambientArt = item.artwork } }
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
    var onChange: (String?) -> Void
    @State private var index = 0
    @State private var paused = false

    var body: some View {
        let item = items[min(index, items.count - 1)]
        ZStack(alignment: .bottomLeading) {
            Artwork(source: item.backdrop, size: "w1280")
                .frame(height: 440)
                .frame(maxWidth: .infinity)
                .clipped()
                .id(item.id)
                .transition(.opacity)
            LinearGradient(colors: [.clear, .black.opacity(0.35), .black.opacity(0.85)], startPoint: .top, endPoint: .bottom)
            LinearGradient(colors: [.black.opacity(0.6), .clear], startPoint: .leading, endPoint: .center)

            VStack(alignment: .leading, spacing: 14) {
                Text(item.kind == .series ? "NEW SERIES" : "NEW MOVIE").font(.caption.weight(.heavy)).tracking(1.5).foregroundStyle(model.accent)
                Text(SearchKit.cleanTitle(item.name)).font(.system(size: 44, weight: .bold)).lineLimit(2)
                    .shadow(radius: 12)
                HStack(spacing: 8) {
                    if let y = item.year { Tag(text: y) }
                    if let r = item.rating { RatingBadge(rating: r) }
                    Tag(text: item.group)
                }
                HStack(spacing: 12) {
                    Button {
                        if item.kind == .movie, let r = model.request(for: item) { model.play(openWindow, r) }
                        else { model.path.append(Route.detail(item)) }
                    } label: { Label(item.kind == .movie ? "Play" : "Episodes", systemImage: "play.fill").padding(.horizontal, 8) }
                    .buttonStyle(.glassProminent).controlSize(.extraLarge)
                    Button { model.toggleWatchlist(item.id) } label: {
                        Image(systemName: model.inWatchlist(item.id) ? "checkmark" : "plus")
                    }
                    .buttonStyle(.glass).controlSize(.extraLarge).help("My List")
                    Button { model.path.append(Route.detail(item)) } label: { Image(systemName: "info") }
                        .buttonStyle(.glass).controlSize(.extraLarge).help("Details")
                }
                .padding(.top, 4)
            }
            .padding(40)
            .foregroundStyle(.white)

            HStack(spacing: 6) {
                ForEach(items.indices, id: \.self) { i in
                    Capsule().fill(.white.opacity(i == index ? 0.95 : 0.35))
                        .frame(width: i == index ? 22 : 7, height: 7)
                        .onTapGesture { withAnimation { index = i } }
                }
            }
            .padding(40)
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .frame(height: 440)
        .clipShape(.rect(cornerRadius: 26))
        .padding(.horizontal, 24)
        .padding(.top, 8)
        .onHover { paused = $0 }
        .animation(.easeInOut(duration: 0.7), value: index)
        .onAppear { onChange(item.artwork) }
        .onChange(of: index) { onChange(items[index].artwork) }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(8))
                if !paused { index = (index + 1) % max(1, items.count) }
            }
        }
    }
}
