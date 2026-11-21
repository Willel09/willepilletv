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
    @State private var groupFilter = ""

    private static let allKey = "__all__"
    private static let listKey = "__mylist__"

    var body: some View {
        HStack(spacing: 0) {
            categoryList
                .frame(width: 240)
            Divider()
            grid
        }
        .navigationTitle(kind == .movie ? "Movies" : "Series")
        .toolbar {
            ToolbarItem {
                Picker("Sort", selection: $sort) { ForEach(SortOrder.allCases) { Text($0.rawValue).tag($0) } }
                    .pickerStyle(.segmented)
            }
        }
        .searchable(text: $filter, placement: .toolbar, prompt: "Filter this category")
        .task(id: "\(group ?? "")|\(sort.rawValue)|\(filter)|\(model.library.updatedAt.timeIntervalSince1970)") { await recompute() }
        .onAppear { if group == nil { group = initialGroup ?? Self.allKey } }
    }

    private var groups: [String] { kind == .movie ? model.movieGroups : model.seriesGroups }

    private var categoryList: some View {
        VStack(spacing: 0) {
            TextField("Find a category", text: $groupFilter)
                .textFieldStyle(.roundedBorder)
                .padding(10)
            List(selection: $group) {
                Label("All", systemImage: "square.grid.2x2").tag(Self.allKey)
                Label("My List", systemImage: "bookmark").tag(Self.listKey)
                Section("Categories") {
                    ForEach(groups.filter { groupFilter.isEmpty || $0.localizedCaseInsensitiveContains(groupFilter) }, id: \.self) { g in
                        Text(g).lineLimit(1).tag(g)
                    }
                }
            }
            .listStyle(.sidebar)
        }
    }

    private var grid: some View {
        ScrollView {
            if shown.isEmpty {
                EmptyState(symbol: kind == .movie ? "film" : "tv", title: "Nothing here", message: filter.isEmpty ? "This category is empty." : "No titles match “\(filter)”.")
                    .frame(minHeight: 400)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 180), spacing: 20, alignment: .top)], spacing: 26) {
                    ForEach(shown) { item in
                        PosterCard(item: item, width: 150)
                            .onTapGesture { model.path.append(Route.detail(item)) }
                    }
                }
                .padding(24)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if !shown.isEmpty {
                Text("\(shown.count.formatted()) titles").font(.caption).foregroundStyle(.secondary)
                    .padding(.horizontal, 10).padding(.vertical, 5).glassEffect(.regular, in: Capsule()).padding(14)
            }
        }
    }

    private func recompute() async {
        let base: [Item]
        switch group {
        case Self.listKey: base = model.watchlistItems.filter { $0.kind == kind }
        case Self.allKey, nil: base = kind == .movie ? model.movies.map(Item.movie) : model.series.map(Item.series)
        case let g?: base = kind == .movie ? model.movies.filter { $0.group == g }.map(Item.movie) : model.series.filter { $0.group == g }.map(Item.series)
        }
        let q = filter, s = sort
        let result = await Task.detached(priority: .userInitiated) { () -> [Item] in
            if !q.isEmpty { return SearchKit.search(q, in: base, limit: 2000) }
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

    var body: some View {
        @Bindable var model = model
        ScrollView {
            if model.searchQuery.isEmpty {
                EmptyState(symbol: "magnifyingglass", title: "Search everything",
                           message: "Channels, movies and series. Close spellings work too — “intersteller” finds Interstellar.")
                    .frame(minHeight: 480)
            } else if results.isEmpty && !searching {
                EmptyState(symbol: "questionmark.circle", title: "No results", message: "Nothing matches “\(model.searchQuery)”.").frame(minHeight: 480)
            } else {
                VStack(alignment: .leading, spacing: 30) {
                    let ch = results.compactMap { if case .live(let c) = $0 { c } else { nil } }
                    let mv = results.filter { $0.kind == .movie }
                    let sr = results.filter { $0.kind == .series }
                    if !ch.isEmpty {
                        Shelf(title: "Channels", symbol: "dot.radiowaves.left.and.right") {
                            ForEach(ch) { c in ChannelTile(channel: c).onTapGesture { PlayAction(model: model, openWindow: openWindow)(.live(c)) } }
                        }
                    }
                    if !mv.isEmpty {
                        Shelf(title: "Movies", symbol: "film") { ForEach(mv) { i in PosterCard(item: i).onTapGesture { model.path.append(Route.detail(i)) } } }
                    }
                    if !sr.isEmpty {
                        Shelf(title: "Series", symbol: "tv") { ForEach(sr) { i in PosterCard(item: i).onTapGesture { model.path.append(Route.detail(i)) } } }
                    }
                }
                .padding(.vertical, 24)
            }
        }
        .navigationTitle("Search")
        .searchable(text: $model.searchQuery, placement: .toolbar, prompt: "Movies, series and channels")
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
        .overlay { if searching { ProgressView().controlSize(.large) } }
    }
}

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
                        PosterCard(item: item, width: 150).onTapGesture { model.path.append(Route.detail(item)) }
                    }
                }
                .padding(24)
            }
        }
        .navigationTitle("My List")
    }
}
