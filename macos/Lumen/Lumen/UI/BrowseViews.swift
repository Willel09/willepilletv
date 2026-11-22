import SwiftUI

enum SortOrder: String, CaseIterable, Identifiable {
    case newest = "Newest", az = "A–Z", rating = "Top Rated"
    var id: String { rawValue }
}

/// Movies or Series: a category list on the left, a poster grid on the right.
struct BrowseView: View {
    @Environment(AppModel.self) private var model
    let kind: MediaKind
    var initialGroup: String?
    @State private var group: String? = nil
    @State private var sort: SortOrder = .newest
    @State private var filter = ""
    @State private var shown: [Item] = []
    @State private var hideWatched = false
    @State private var counts: [String: Int] = [:]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let allKey = "__all__"
    private static let listKey = "__mylist__"
    private static let recentKey = "__recent__"
    private static let favKey = "__fav__"
    private static let customPrefix = "__list:"

    @ViewBuilder private var layout: some View {
        #if os(iOS)
        VStack(spacing: 0) { phoneBar; gridScroll }
        #else
        HStack(spacing: 12) {
            CategoryRail(shortcuts: shortcuts, categories: categories,
                         selection: Binding(get: { group ?? Self.allKey }, set: { group = $0 }))
                .frame(width: 268)
            grid.livePanel()
        }
        .padding(.horizontal, 14).padding(.bottom, 14)
        #endif
    }

    #if os(iOS)
    private var phoneBar: some View {
        HStack(spacing: 8) {
            SearchField(text: $filter, prompt: "Filter")
            Menu {
                Picker("Category", selection: Binding(get: { group ?? Self.allKey }, set: { group = $0 })) {
                    Text("All").tag(Self.allKey)
                    Text("My List").tag(Self.listKey)
                    ForEach(groups, id: \.self) { Text($0).tag($0) }
                }
            } label: { Image(systemName: "line.3.horizontal.decrease.circle").font(.title3).frame(width: 36, height: 34) }
            Menu {
                Picker("Sort", selection: $sort) { ForEach(SortOrder.allCases) { Text($0.rawValue).tag($0) } }
            } label: { Image(systemName: "arrow.up.arrow.down.circle").font(.title3).frame(width: 36, height: 34) }
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
    }
    #endif

    var body: some View {
        layout
        .background(ThemeBackground())
        .task(id: "\(group ?? "")|\(sort.rawValue)|\(filter)|\(hideWatched)|\(model.library.updatedAt.timeIntervalSince1970)|\(model.user.watchlist.count)|\(model.user.favorites.count)") { await recompute() }
        .task(id: "\(kind)|\(model.library.updatedAt.timeIntervalSince1970)") {
            let pool: [String] = kind == .movie ? model.movies.map(\.group) : model.series.map(\.group)
            counts = await Task.detached(priority: .utility) { var c: [String: Int] = [:]; for g in pool { c[g, default: 0] += 1 }; return c }.value
        }
        .onAppear { if group == nil { group = initialGroup ?? Self.allKey } }
    }

    private var groups: [String] { kind == .movie ? model.movieGroups : model.seriesGroups }

    #if os(macOS)
    private var kindItems: [Item] { kind == .movie ? model.movies.map(Item.movie) : model.series.map(Item.series) }
    private var total: Int { kind == .movie ? model.movies.count : model.series.count }

    private var shortcuts: [RailEntry] {
        var out: [RailEntry] = [
            RailEntry(id: Self.allKey, label: kind == .movie ? "All Movies" : "All Series", count: total,
                      symbol: kind == .movie ? "film.stack.fill" : "tv.fill", tint: Color(red: 0.4, green: 0.68, blue: 1)),
            RailEntry(id: Self.recentKey, label: "Recently Added", count: min(200, total), symbol: "clock.arrow.circlepath", tint: Color(red: 0.35, green: 0.82, blue: 0.62)),
            RailEntry(id: Self.listKey, label: "Watchlist", count: model.watchlistItems.filter { $0.kind == kind }.count, symbol: "bookmark.fill", tint: Color(red: 1, green: 0.66, blue: 0.3)),
            RailEntry(id: Self.favKey, label: "Favorites", count: model.favoriteItems.filter { $0.kind == kind }.count, symbol: "heart.fill", tint: Color(red: 1, green: 0.42, blue: 0.55))
        ]
        for l in model.user.lists {
            out.append(RailEntry(id: Self.customPrefix + l.id, label: l.name, count: model.items(in: l).filter { $0.kind == kind }.count,
                                 symbol: "list.bullet", tint: Color(red: 0.72, green: 0.52, blue: 1)))
        }
        return out
    }

    private var categories: [RailEntry] { groups.map { RailEntry(id: $0, label: $0, count: counts[$0] ?? 0) } }

    private var title: String {
        let g = group ?? Self.allKey
        return shortcuts.first { $0.id == g }?.label ?? g
    }
    #endif

    #if os(macOS)
    private var grid: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(size: 28, weight: .bold)).tracking(-0.8).lineLimit(1)
                        .id(title).transition(reduceMotion ? .opacity : .push(from: .bottom))
                    Text("\(shown.count.formatted()) \(shown.count == 1 ? "title" : "titles")")
                        .font(.system(size: 13, weight: .medium)).foregroundStyle(.white.opacity(0.45))
                        .contentTransition(.numericText(value: Double(shown.count)))
                }
                .clipped()
                .animation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.85), value: title)
                .animation(.snappy, value: shown.count)
                Spacer(minLength: 12)
                BrowseSearchField(text: $filter, prompt: kind == .movie ? "Search movies" : "Search series").frame(maxWidth: 240)
                if kind == .movie {
                    Button { withAnimation(.snappy) { hideWatched.toggle() } } label: {
                        Text("Hide watched").font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(hideWatched ? Color.black : .white.opacity(0.7))
                            .padding(.horizontal, 14).frame(height: 34)
                            .background(hideWatched ? AnyShapeStyle(Color.white) : AnyShapeStyle(Color.black.opacity(0.28)), in: Capsule())
                            .overlay(Capsule().strokeBorder(.white.opacity(hideWatched ? 0 : 0.06), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(hideWatched ? .isSelected : [])
                }
                if group != Self.recentKey {
                    GlideSegmented(options: SortOrder.allCases.map { ($0, $0.rawValue) }, value: $sort).fixedSize()
                }
            }
            .padding(.horizontal, 24).padding(.top, 20).padding(.bottom, 12)
            gridScroll
                .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.02),
                                             .init(color: .black, location: 0.97), .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom))
        }
    }

    #endif

    private var gridScroll: some View {
        ScrollView {
            if shown.isEmpty {
                EmptyState(symbol: kind == .movie ? "film" : "tv", title: "Nothing here", message: filter.isEmpty ? "This category is empty." : "No titles match “\(filter)”.")
                    .frame(minHeight: 400)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: Platform.isPhone ? 104 : 168, maximum: Platform.isPhone ? 140 : 190), spacing: Platform.isPhone ? 12 : 22, alignment: .top)], spacing: Platform.isPhone ? 18 : 28) {
                    ForEach(Array(shown.enumerated()), id: \.element.id) { i, item in
                        PosterCard(item: item, width: Platform.isPhone ? 104 : 168)
                            .modifier(StaggerInGrid(index: i))
                            .onTapGesture { model.path.append(Route.detail(item)) }
                    }
                }
                .padding(Platform.isPhone ? 12 : 24)
                .id("\(group ?? "")|\(sort.rawValue)")
            }
        }
        #if os(iOS)
        .overlay(alignment: .bottomTrailing) {
            if !shown.isEmpty {
                Text("\(shown.count.formatted()) titles").font(.caption).foregroundStyle(.secondary)
                    .padding(.horizontal, 10).padding(.vertical, 5).background(Color(white: 0.13, opacity: 0.92), in: Capsule()).padding(14)
            }
        }
        #endif
    }

    private func recompute() async {
        var base: [Item]
        var recent = false
        switch group {
        case Self.listKey: base = model.watchlistItems.filter { $0.kind == kind }
        case Self.favKey: base = model.favoriteItems.filter { $0.kind == kind }
        case Self.recentKey: recent = true; base = kind == .movie ? model.movies.map(Item.movie) : model.series.map(Item.series)
        case Self.allKey, nil: base = kind == .movie ? model.movies.map(Item.movie) : model.series.map(Item.series)
        case let g? where g.hasPrefix(Self.customPrefix):
            let id = String(g.dropFirst(Self.customPrefix.count))
            base = model.user.lists.first { $0.id == id }.map { model.items(in: $0).filter { $0.kind == kind } } ?? []
        case let g?: base = kind == .movie ? model.movies.filter { $0.group == g }.map(Item.movie) : model.series.filter { $0.group == g }.map(Item.series)
        }
        if hideWatched && kind == .movie {
            let seen = Set(model.user.history.filter { $0.kind == "movie" && $0.isFinished }.map(\.itemId))
            base = base.filter { !seen.contains($0.id) }
        }
        let q = filter, s = recent ? SortOrder.newest : sort
        let result = await Task.detached(priority: .userInitiated) { () -> [Item] in
            if !q.isEmpty { return SearchKit.search(q, in: base, limit: 2000) }
            if recent { return Array(base.sorted { $0.added > $1.added }.prefix(200)) }
            switch s {
            case .newest: return base.sorted { $0.added > $1.added }
            case .az: return base.sorted { SearchKit.cleanTitle($0.name).localizedCaseInsensitiveCompare(SearchKit.cleanTitle($1.name)) == .orderedAscending }
            case .rating: return base.sorted { ($0.rating ?? 0) > ($1.rating ?? 0) }
            }
        }.value
        shown = result
    }
}

struct SearchView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @State private var results: [Item] = []
    @State private var searching = false
    @State private var past: [String] = UserDefaults.standard.stringArray(forKey: "recentSearches") ?? []

    var body: some View {
        @Bindable var model = model
        VStack(spacing: 0) {
            #if os(macOS)
            VStack(spacing: 18) {
                BigSearchField(text: $model.searchQuery)
                if model.searchQuery.isEmpty {
                    if !past.isEmpty {
                        FlowLayout(spacing: 8) {
                            ForEach(past, id: \.self) { t in
                                Button { model.searchQuery = t } label: {
                                    Label(t, systemImage: "clock.arrow.circlepath").font(.system(size: 13, weight: .medium))
                                        .padding(.horizontal, 14).frame(height: 32)
                                        .background(.white.opacity(0.08), in: Capsule()).overlay(Capsule().strokeBorder(.white.opacity(0.1), lineWidth: 1))
                                }
                                .buttonStyle(RailPressStyle()).foregroundStyle(.white.opacity(0.8))
                            }
                            Button("Clear") { withAnimation(.snappy) { past = []; UserDefaults.standard.removeObject(forKey: "recentSearches") } }
                                .buttonStyle(.plain).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.45)).frame(height: 32)
                        }
                        .frame(maxWidth: 680)
                        .transition(.opacity)
                    }
                    Text("Search across \(model.channels.count.formatted()) channels, \(model.movies.count.formatted()) movies and \(model.series.count.formatted()) series")
                        .font(.system(size: 13.5)).foregroundStyle(.white.opacity(0.4))
                }
            }
            .padding(.top, 24).padding(.bottom, 10).padding(.horizontal, 32)
            .animation(.snappy, value: model.searchQuery.isEmpty)
            #else
            SearchField(text: $model.searchQuery, prompt: "Movies, series and channels", autofocus: !Platform.isPhone)
                .frame(maxWidth: 560).padding(.vertical, 14).padding(.horizontal, Platform.isPhone ? 16 : 0)
            #endif
            resultsScroll
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ThemeBackground())
        .task(id: model.searchQuery) {
            let q = model.searchQuery
            guard !q.isEmpty else { results = []; return }
            searching = true
            try? await Task.sleep(for: .milliseconds(220))
            guard !Task.isCancelled else { return }
            let all = model.allItems
            let r = await Task.detached(priority: .userInitiated) { SearchKit.search(q, in: all, limit: 150) }.value
            guard !Task.isCancelled else { return }
            results = r
            searching = false
        }
        .overlay { if searching && results.isEmpty { ProgressView().controlSize(.large) } }
    }

    private var resultsScroll: some View {
        ScrollView {
            if model.searchQuery.isEmpty {
                #if os(iOS)
                EmptyState(symbol: "magnifyingglass", title: "Search everything",
                           message: "Channels, movies and series. Close spellings work too: “intersteller” finds Interstellar.")
                    .frame(minHeight: 480)
                #endif
            } else if results.isEmpty && !searching {
                EmptyState(symbol: "questionmark.circle", title: "No results for “\(model.searchQuery)”", message: "Try another spelling, or fewer words.").frame(minHeight: 420)
            } else {
                VStack(alignment: .leading, spacing: 30) {
                    let ch = results.compactMap { if case .live(let c) = $0 { c } else { nil } }
                    let mv = results.filter { $0.kind == .movie }
                    let sr = results.filter { $0.kind == .series }
                    #if os(macOS)
                    if let top = results.first {
                        TopResultCard(item: top) { remember(); open(top) }
                            .padding(.horizontal, 56)
                            .modifier(StaggerInGrid(index: 0))
                    }
                    #endif
                    if !ch.isEmpty {
                        Shelf(title: "Channels", subtitle: "\(ch.count)", symbol: "dot.radiowaves.left.and.right") {
                            ForEach(Array(ch.enumerated()), id: \.element.id) { n, c in
                                ChannelTile(channel: c).tapOrEnter { remember(); PlayAction(model: model, openWindow: openWindow)(.live(c)) }
                                    .modifier(StaggerInGrid(index: n + 1))
                            }
                        }
                    }
                    if !mv.isEmpty {
                        Shelf(title: "Movies", subtitle: "\(mv.count)", symbol: "film") {
                            ForEach(Array(mv.enumerated()), id: \.element.id) { n, i in
                                PosterCard(item: i).tapOrEnter { remember(); model.path.append(Route.detail(i)) }.modifier(StaggerInGrid(index: n + 2))
                            }
                        }
                    }
                    if !sr.isEmpty {
                        Shelf(title: "Series", subtitle: "\(sr.count)", symbol: "tv") {
                            ForEach(Array(sr.enumerated()), id: \.element.id) { n, i in
                                PosterCard(item: i).tapOrEnter { remember(); model.path.append(Route.detail(i)) }.modifier(StaggerInGrid(index: n + 3))
                            }
                        }
                    }
                }
                .id(model.searchQuery)
                .padding(.vertical, 24)
                .transition(.opacity)
            }
        }
    }

    private func open(_ i: Item) {
        if case .live(let c) = i { PlayAction(model: model, openWindow: openWindow)(.live(c)) } else { model.path.append(Route.detail(i)) }
    }

    /// Keeps the last eight searches that led somewhere.
    private func remember() {
        let q = model.searchQuery.trimmingCharacters(in: .whitespaces)
        guard q.count > 1 else { return }
        past = Array(([q] + past.filter { $0.caseInsensitiveCompare(q) != .orderedSame }).prefix(8))
        UserDefaults.standard.set(past, forKey: "recentSearches")
    }
}

#if os(macOS)
/// The best match, shown big above the shelves.
struct TopResultCard: View {
    @Environment(AppModel.self) private var model
    let item: Item
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 20) {
                Artwork(source: item.artwork, size: "w342", contentMode: item.kind == .live ? .fit : .fill, placeholder: item.kind == .live ? "tv" : "film",
                        onColor: nil)
                    .padding(item.kind == .live ? 14 : 0)
                    .frame(width: item.kind == .live ? 120 : 92, height: item.kind == .live ? 92 : 138)
                    .background(.white.opacity(item.kind == .live ? 0.08 : 0), in: .rect(cornerRadius: 14, style: .continuous))
                    .clipShape(.rect(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.white.opacity(0.16), lineWidth: 1))
                    .shadow(color: .black.opacity(0.45), radius: 14, y: 8)
                VStack(alignment: .leading, spacing: 8) {
                    Text("TOP RESULT").font(.system(size: 11, weight: .heavy)).tracking(1.4).foregroundStyle(model.accent)
                    Text(SearchKit.cleanTitle(item.name)).font(.system(size: 28, weight: .heavy)).tracking(-0.6).lineLimit(2)
                    HStack(spacing: 8) {
                        kindChip
                        if let y = item.year { Text(y).foregroundStyle(.white.opacity(0.6)) }
                        if let r = item.rating, r > 0 { RatingBadge(rating: r) }
                        Text(item.group).lineLimit(1).foregroundStyle(.white.opacity(0.45))
                    }
                    .font(.system(size: 13, weight: .medium))
                }
                Spacer(minLength: 12)
                Image(systemName: item.kind == .live ? "play.fill" : "arrow.right")
                    .font(.system(size: 17, weight: .bold)).foregroundStyle(.black)
                    .frame(width: 48, height: 48).background(.white, in: Circle())
                    .shadow(color: .black.opacity(0.3), radius: 10, y: 4)
                    .scaleEffect(hover ? 1.08 : 1)
            }
            .padding(18)
            .frame(maxWidth: 900, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: 24, style: .continuous).fill(.ultraThinMaterial)
                    .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(LinearGradient(colors: [model.accent.opacity(hover ? 0.2 : 0.12), .clear], startPoint: .topLeading, endPoint: .bottomTrailing)))
                    .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .strokeBorder(LinearGradient(colors: [.white.opacity(0.28), .white.opacity(0.04)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
                    .shadow(color: .black.opacity(0.35), radius: 24, y: 12)
            }
            .contentShape(.rect(cornerRadius: 24))
        }
        .buttonStyle(RailPressStyle())
        .onHover { hover = $0 }
        .animation(.spring(response: 0.3, dampingFraction: 0.75), value: hover)
        .itemContextMenu(item)
    }

    private var kindChip: some View {
        let (label, symbol, tint): (String, String, Color) = switch item.kind {
        case .live: ("Channel", "dot.radiowaves.left.and.right", .red)
        case .series: ("Series", "tv.fill", .purple)
        default: ("Movie", "film.fill", .orange)
        }
        return Label(label, systemImage: symbol).font(.system(size: 11.5, weight: .bold))
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(tint.opacity(0.22), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.4), lineWidth: 1))
            .foregroundStyle(.white)
    }
}

/// The tall, centred search field from the Windows app.
struct BigSearchField: View {
    @Environment(AppModel.self) private var model
    @Binding var text: String
    @FocusState private var focused: Bool
    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "magnifyingglass").font(.system(size: 19, weight: .semibold)).foregroundStyle(.white.opacity(0.5))
            TextField("Channels, movies and series", text: $text).textFieldStyle(.plain)
                .font(.system(size: 19, weight: .medium)).focused($focused)
                .onKeyPress(.escape) { if text.isEmpty { return .ignored }; text = ""; return .handled }
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).frame(width: 26, height: 26).background(.white.opacity(0.15), in: Circle())
                }
                .buttonStyle(.plain).foregroundStyle(.white.opacity(0.75)).accessibilityLabel("Clear")
                .transition(.scale.combined(with: .opacity))
            }
        }
        .padding(.horizontal, 24).frame(height: 62).frame(maxWidth: 680)
        .background {
            Capsule().fill(LinearGradient(colors: [.white.opacity(0.12), .white.opacity(0.06)], startPoint: .top, endPoint: .bottom))
                .overlay(Capsule().strokeBorder(focused ? model.accent.opacity(0.8) : .white.opacity(0.12), lineWidth: focused ? 2 : 1))
                .shadow(color: .black.opacity(0.3), radius: 20, y: 10)
        }
        .animation(.snappy, value: text.isEmpty)
        .animation(.easeOut(duration: 0.15), value: focused)
        .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { focused = true } }
    }
}
#endif

struct WatchlistView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        ScrollView {
            let items = model.watchlistItems
            if items.isEmpty {
                EmptyState(symbol: "bookmark", title: "Your list is empty", message: "Press + on a movie or series to save it here. Right-click any card for more.")
                    .frame(minHeight: 480)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 180), spacing: 20, alignment: .top)], spacing: 26) {
                    ForEach(items) { item in
                        PosterCard(item: item, width: 150).tapOrEnter { model.path.append(Route.detail(item)) }
                    }
                }
                .padding(24)
            }
        }
        .navigationTitle("My List")
    }
}

/// Capsule search field used in the browse header.
struct BrowseSearchField: View {
    @Environment(AppModel.self) private var model
    @Binding var text: String
    let prompt: String
    @FocusState private var focused: Bool
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(focused ? 0.8 : 0.45))
            TextField(prompt, text: $text).textFieldStyle(.plain).font(.system(size: 13.5)).focused($focused)
                .onKeyPress(.escape) { if text.isEmpty { return .ignored }; text = ""; return .handled }
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.white.opacity(0.45)) }
                    .buttonStyle(.plain).accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 14).frame(height: 34)
        .background(.black.opacity(0.28), in: Capsule())
        .overlay(Capsule().strokeBorder(focused ? model.accent.opacity(0.7) : .white.opacity(0.06), lineWidth: 1))
        .animation(.easeOut(duration: 0.15), value: focused)
    }
}

/// Grid version of the stagger: the first two rows rise in, everything else appears at once.
struct StaggerInGrid: ViewModifier {
    let index: Int
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        let animate = index < 12 && !reduceMotion
        content
            .opacity(!animate || shown ? 1 : 0)
            .offset(y: !animate || shown ? 0 : 14)
            .onAppear {
                guard animate, !shown else { return }
                withAnimation(.spring(response: 0.5, dampingFraction: 0.85).delay(Double(index) * 0.03)) { shown = true }
            }
    }
}
