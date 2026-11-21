// The app's state: sources, the loaded library, guide data, user lists and history.
// One instance, shared by every window, the menu bar extra and the App Intents.
import Foundation
import SwiftUI
import AppKit
import WidgetKit

enum SidebarItem: String, Hashable, CaseIterable, Identifiable {
    case home, search, live, guide, movies, series, watchlist, random, sources
    var id: String { rawValue }
    var title: String {
        switch self {
        case .home: "Home"
        case .search: "Search"
        case .live: "Live TV"
        case .guide: "TV Guide"
        case .movies: "Movies"
        case .series: "Series"
        case .watchlist: "My List"
        case .random: "Random"
        case .sources: "Sources"
        }
    }
    var symbol: String {
        switch self {
        case .home: "house.fill"
        case .search: "magnifyingglass"
        case .live: "dot.radiowaves.left.and.right"
        case .guide: "calendar.day.timeline.left"
        case .movies: "film.fill"
        case .series: "tv.fill"
        case .watchlist: "bookmark.fill"
        case .random: "dice.fill"
        case .sources: "externaldrive.connected.to.line.below.fill"
        }
    }
}

enum Route: Hashable {
    case detail(Item)
    case category(MediaKind, String)
}

@Observable
final class AppModel {
    static let shared = AppModel()

    // MARK: Persistent state
    var sources: [Source] = [] { didSet { saveSources() } }
    var user = UserData() { didSet { scheduleSaveUser() } }
    private(set) var library = Library()

    // MARK: Derived (rebuilt when the library or filters change)
    private(set) var channels: [Channel] = []
    private(set) var movies: [Movie] = []
    private(set) var series: [Show] = []
    private(set) var liveGroups: [String] = []
    private(set) var movieGroups: [String] = []
    private(set) var seriesGroups: [String] = []
    private var byId: [String: Item] = [:]

    // MARK: Guide
    private var programmes: [String: [Programme]] = [:]
    private var epgNames: [String: String] = [:]
    private(set) var epgUpdatedAt: Date?
    private(set) var epgLoading = false

    // MARK: Transient UI state
    var isRefreshing = false
    var progressMessage: String?
    var lastErrors: [String] = []
    var selection: SidebarItem? = .home
    var path = NavigationPath()
    var searchQuery = ""
    var toast: String?
    var infoCache: [String: MediaInfo] = [:]
    /// Set by deep links / intents; the root view reacts to it
    var pendingPlay: PlaybackRequest?
    /// What the player window shows; setting it while the window is open switches the stream
    var nowPlaying: PlaybackRequest?
    @ObservationIgnored var activePlayer: PlayerModel?

    var settings: AppSettings {
        get { user.settings }
        set {
            let filtersChanged = newValue.hiddenGroups != user.settings.hiddenGroups || newValue.removeBs != user.settings.removeBs
            user.settings = newValue
            if filtersChanged { rebuild() }
        }
    }
    var accent: Color { Color(hex: settings.accentHex) ?? .accentColor }

    // MARK: Files
    private let dir: URL = {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Lumen", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    private var sourcesURL: URL { dir.appendingPathComponent("sources.json") }
    private var userURL: URL { dir.appendingPathComponent("user.json") }
    private var libraryURL: URL { dir.appendingPathComponent("library.json") }
    private var epgURL: URL { dir.appendingPathComponent("epg.json") }
    private var loaded = false

    private init() {
        if let d = try? Data(contentsOf: sourcesURL), let s = try? JSONDecoder().decode([Source].self, from: d) { sources = s }
        if let d = try? Data(contentsOf: userURL), let u = try? JSONDecoder().decode(UserData.self, from: d) { user = u }
        loaded = true
        Task { await loadCache() }
    }

    private func loadCache() async {
        let libURL = libraryURL, gURL = epgURL
        let (lib, epg) = await Task.detached(priority: .userInitiated) { () -> (Library?, EpgCache?) in
            let l = (try? Data(contentsOf: libURL)).flatMap { try? JSONDecoder().decode(Library.self, from: $0) }
            let e = (try? Data(contentsOf: gURL)).flatMap { try? JSONDecoder().decode(EpgCache.self, from: $0) }
            return (l, e)
        }.value
        if let lib { library = lib; rebuild() }
        if let epg { programmes = epg.programmes; epgNames = epg.names; epgUpdatedAt = epg.updatedAt }
        let stale = library.updatedAt.addingTimeInterval(Double(max(1, settings.refreshHours)) * 3600) < .now
        if !sources.isEmpty && (library.isEmpty || stale) { await refresh() }
        else if !sources.isEmpty && (epgUpdatedAt ?? .distantPast).addingTimeInterval(6 * 3600) < .now { await refreshGuide() }
        publishWidgets()
    }

    private func saveSources() {
        guard loaded, let d = try? JSONEncoder().encode(sources) else { return }
        try? d.write(to: sourcesURL, options: [.atomic])
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: sourcesURL.path)
    }

    private var saveTask: Task<Void, Never>?
    private func scheduleSaveUser() {
        guard loaded else { return }
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled, let d = try? JSONEncoder().encode(user) else { return }
            try? d.write(to: userURL, options: .atomic)
        }
    }

    // MARK: Refresh

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false; progressMessage = nil }
        let ua = settings.userAgent
        var next = Library()
        var errors: [String] = []
        for src in sources where src.enabled {
            do {
                switch src.kind {
                case .m3u:
                    progressMessage = "\(src.name): downloading playlist…"
                    let data = try await Net.data(src.url ?? "", ua: ua)
                    progressMessage = "\(src.name): reading playlist…"
                    let id = src.id
                    let r = await Task.detached(priority: .userInitiated) {
                        M3U.parse(String(decoding: data, as: UTF8.self), sourceId: id)
                    }.value
                    next.channels += r.channels; next.movies += r.movies; next.series += r.series
                    if let e = r.epgUrl { next.providerEpgUrls.append(e) }
                case .xtream:
                    let r = try await Xtream.load(src, ua: ua) { msg in Task { @MainActor in AppModel.shared.progressMessage = msg } }
                    next.channels += r.channels; next.movies += r.movies; next.series += r.series
                    next.accounts[src.id] = r.account
                    next.providerEpgUrls.append(Xtream.epgUrl(src))
                }
            } catch {
                errors.append("\(src.name): \(error.localizedDescription)")
                // keep the titles we already had from a source that failed
                next.channels += library.channels.filter { $0.sourceId == src.id }
                next.movies += library.movies.filter { $0.sourceId == src.id }
                next.series += library.series.filter { $0.sourceId == src.id }
            }
        }
        next.errors = errors
        next.updatedAt = .now
        library = next
        lastErrors = errors
        rebuild()
        let lib = library, url = libraryURL
        Task.detached(priority: .background) { if let d = try? JSONEncoder().encode(lib) { try? d.write(to: url, options: .atomic) } }
        if errors.isEmpty { toast = "Library updated · \(channels.count.formatted()) channels, \(movies.count.formatted()) movies, \(series.count.formatted()) series" }
        else { toast = errors.first }
        publishWidgets()
        await refreshGuide()
    }

    func refreshGuide() async {
        var urls: [String] = sources.compactMap { $0.enabled ? $0.epgUrl : nil }.filter { !$0.isEmpty }
        if !settings.epgUrl.isEmpty { urls.append(settings.epgUrl) }
        if settings.autoProviderEpg { urls += library.providerEpgUrls }
        urls = Array(NSOrderedSet(array: urls)) as? [String] ?? urls
        guard !urls.isEmpty, !epgLoading else { return }
        epgLoading = true
        defer { epgLoading = false }
        let ua = settings.userAgent
        var progs: [String: [Programme]] = [:]
        var names: [String: String] = [:]
        for u in urls {
            progressMessage = "Loading TV guide…"
            guard let data = try? await Net.data(u, ua: ua) else { continue }
            let p = await Task.detached(priority: .utility) { XMLTVParser.parse(data) }.value
            progs.merge(p.programmes) { a, _ in a }
            names.merge(p.names) { a, _ in a }
        }
        progressMessage = nil
        guard !progs.isEmpty else { return }
        programmes = progs
        epgNames = names
        epgUpdatedAt = .now
        let cache = EpgCache(programmes: progs, names: names, updatedAt: .now), url = epgURL
        Task.detached(priority: .background) { if let d = try? JSONEncoder().encode(cache) { try? d.write(to: url, options: .atomic) } }
        publishWidgets()
    }

    // MARK: Derived lists

    private func hidden(_ name: String, _ group: String, hiddenSet: Set<String>) -> Bool {
        if hiddenSet.contains(group.lowercased()) { return true }
        if settings.removeBs && SearchKit.isBs(name: name, group: group) { return true }
        return false
    }

    func rebuild() {
        let hiddenSet = Set(settings.hiddenGroups.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty })
        channels = library.channels.filter { !hidden($0.name, $0.group, hiddenSet: hiddenSet) }
        movies = library.movies.filter { !hidden($0.name, $0.group, hiddenSet: hiddenSet) }
        series = library.series.filter { !hidden($0.name, $0.group, hiddenSet: hiddenSet) }
        func groups<T>(_ xs: [T], _ g: (T) -> String) -> [String] {
            var seen = Set<String>(); var out: [String] = []
            for x in xs { let k = g(x); if seen.insert(k).inserted { out.append(k) } }
            return out
        }
        liveGroups = groups(channels, \.group)
        movieGroups = groups(movies, \.group)
        seriesGroups = groups(series, \.group)
        var map: [String: Item] = [:]
        map.reserveCapacity(channels.count + movies.count + series.count)
        for c in channels { map[c.id] = .live(c) }
        for m in movies { map[m.id] = .movie(m) }
        for s in series { map[s.id] = .series(s) }
        byId = map
        rebuildShelves()
    }

    func item(_ id: String) -> Item? { byId[id] }
    func source(_ id: String) -> Source? { sources.first { $0.id == id } }
    var hasContent: Bool { !channels.isEmpty || !movies.isEmpty || !series.isEmpty }

    var allItems: [Item] { channels.map(Item.live) + movies.map(Item.movie) + series.map(Item.series) }

    private(set) var newestMovies: [Movie] = []
    private(set) var newestSeries: [Show] = []
    private(set) var topRated: [Item] = []
    private(set) var heroItems: [Item] = []

    private func rebuildShelves() {
        newestMovies = Array(movies.sorted { ($0.added ?? 0) > ($1.added ?? 0) }.prefix(30))
        newestSeries = Array(series.sorted { ($0.added ?? 0) > ($1.added ?? 0) }.prefix(30))
        let m = movies.filter { ($0.rating ?? 0) >= 7.5 }.map(Item.movie)
        let s = series.filter { ($0.rating ?? 0) >= 7.5 }.map(Item.series)
        topRated = Array((m + s).sorted { ($0.rating ?? 0) > ($1.rating ?? 0) }.prefix(30))
        let pool = (newestMovies.prefix(12).map(Item.movie) + newestSeries.prefix(8).map(Item.series)).filter { $0.backdrop != nil }
        // same picks for an hour
        var rng = SeededRNG(seed: UInt64(Date.now.timeIntervalSince1970 / 3600))
        heroItems = Array(pool.shuffled(using: &rng).prefix(6))
    }

    // MARK: Guide lookups

    func epgKey(for c: Channel) -> String? {
        if let e = c.epgId?.lowercased(), programmes[e] != nil { return e }
        return epgNames[c.name.lowercased()]
    }
    func schedule(for c: Channel) -> [Programme] { epgKey(for: c).flatMap { programmes[$0] } ?? [] }
    func nowNext(for c: Channel, at date: Date = .now) -> (now: Programme?, next: Programme?) {
        let s = schedule(for: c)
        guard let i = s.firstIndex(where: { $0.stop > date }) else { return (nil, nil) }
        let now = s[i].start <= date ? s[i] : nil
        let next = now == nil ? s[i] : (i + 1 < s.count ? s[i + 1] : nil)
        return (now, next)
    }
    var hasGuide: Bool { !programmes.isEmpty }

    // MARK: Lists

    func isFavorite(_ id: String) -> Bool { user.favorites.contains(id) }
    func toggleFavorite(_ id: String) {
        if let i = user.favorites.firstIndex(of: id) { user.favorites.remove(at: i); toast = "Removed from Favorites" }
        else { user.favorites.insert(id, at: 0); toast = "Added to Favorites" }
        publishWidgets()
    }
    func inWatchlist(_ id: String) -> Bool { user.watchlist.contains(id) }
    func toggleWatchlist(_ id: String) {
        if let i = user.watchlist.firstIndex(of: id) { user.watchlist.remove(at: i); toast = "Removed from My List" }
        else { user.watchlist.insert(id, at: 0); toast = "Added to My List" }
        publishWidgets()
    }
    var favoriteChannels: [Channel] { user.favorites.compactMap { if case .live(let c) = byId[$0] { c } else { nil } } }
    var watchlistItems: [Item] { user.watchlist.compactMap { byId[$0] } }

    var continueWatching: [HistoryEntry] {
        var seenShows = Set<String>()
        return user.history.filter { h in
            guard h.kind != "live", !h.isFinished, h.position > 30 else { return false }
            if h.kind == "episode" { return seenShows.insert(h.itemId).inserted }
            return true
        }.prefix(20).map { $0 }
    }
    var recentChannels: [Channel] {
        var seen = Set<String>()
        return user.history.filter { $0.kind == "live" && seen.insert($0.itemId).inserted }.prefix(15).compactMap {
            if case .live(let c) = byId[$0.itemId] { c } else { nil }
        }
    }
    func removeFromContinue(_ h: HistoryEntry) {
        user.history.removeAll { $0.id == h.id || ($0.kind == "episode" && $0.itemId == h.itemId) }
        publishWidgets()
    }
    func history(for id: String) -> HistoryEntry? { user.history.first { $0.id == id } }

    func record(_ req: PlaybackRequest, position: Double, duration: Double) {
        var h = HistoryEntry(id: req.historyId, kind: req.kind, itemId: req.itemId, name: req.title, subtitle: req.subtitle,
                             artwork: req.artwork, position: position, duration: duration.isFinite ? duration : 0, watchedAt: .now)
        if req.kind == "live" { h.position = 0; h.duration = 0 }
        user.history.removeAll { $0.id == h.id }
        user.history.insert(h, at: 0)
        if user.history.count > 300 { user.history.removeLast(user.history.count - 300) }
    }

    // MARK: Details

    func info(for item: Item) async -> MediaInfo? {
        if let c = infoCache[item.id] { return c }
        guard let src = source(item.sourceId), src.kind == .xtream else {
            if case .series(let s) = item { return MediaInfo(plot: s.plot, episodes: s.episodes) }
            if case .movie(let m) = item { return MediaInfo(plot: m.plot) }
            return nil
        }
        let ua = settings.userAgent
        do {
            let info: MediaInfo
            switch item {
            case .movie(let m): info = try await Xtream.info(src, kind: .movie, id: m.vodId ?? 0, ua: ua)
            case .series(let s): info = try await Xtream.info(src, kind: .series, id: s.seriesId ?? 0, ua: ua)
            case .live: return nil
            }
            infoCache[item.id] = info
            return info
        } catch {
            return nil
        }
    }

    // MARK: Playback

    func streamURL(for c: Channel) -> String? {
        if let u = c.url { return u }
        guard let src = source(c.sourceId), let sid = c.sid else { return nil }
        return Xtream.streamUrl(src, kind: "live", id: String(sid), ext: settings.liveFormat.rawValue)
    }
    func streamURL(for m: Movie) -> String? {
        if let u = m.url { return u }
        guard let src = source(m.sourceId), let id = m.vodId else { return nil }
        return Xtream.streamUrl(src, kind: "movie", id: String(id), ext: m.ext ?? "mp4")
    }

    func request(for item: Item, resume: Bool = true) -> PlaybackRequest? {
        switch item {
        case .live(let c):
            guard let u = streamURL(for: c) else { return nil }
            let now = nowNext(for: c).now?.title
            return PlaybackRequest(historyId: c.id, kind: "live", itemId: c.id, title: c.name, subtitle: now ?? c.group, url: u, artwork: c.logo)
        case .movie(let m):
            guard let u = streamURL(for: m) else { return nil }
            let start = resume ? (history(for: m.id).map { $0.isFinished ? 0 : $0.position } ?? 0) : 0
            return PlaybackRequest(historyId: m.id, kind: "movie", itemId: m.id, title: SearchKit.cleanTitle(m.name), subtitle: m.year, url: u, artwork: m.poster, startAt: start)
        case .series:
            return nil
        }
    }

    func request(for e: Episode, in show: Show, resume: Bool = true) -> PlaybackRequest {
        let hid = "\(show.id)|\(e.id)"
        let start = resume ? (history(for: hid).map { $0.isFinished ? 0 : $0.position } ?? 0) : 0
        return PlaybackRequest(historyId: hid, kind: "episode", itemId: show.id, title: SearchKit.cleanTitle(show.name),
                               subtitle: "S\(e.season) · E\(e.episode) — \(e.title)", url: e.url, artwork: show.poster, startAt: start,
                               showId: show.id, episodeId: e.id)
    }

    /// The episode after the one in `req`, for Up Next.
    func nextEpisode(after req: PlaybackRequest) async -> PlaybackRequest? {
        guard let sid = req.showId, case .series(let show) = item(sid), let eid = req.episodeId else { return nil }
        let eps = (await info(for: .series(show)))?.episodes ?? show.episodes ?? []
        guard let i = eps.firstIndex(where: { $0.id == eid }), i + 1 < eps.count else { return nil }
        return request(for: eps[i + 1], in: show, resume: false)
    }

    /// Channel zapping: neighbour in the same category.
    func neighbourChannel(of id: String, offset: Int) -> Channel? {
        guard case .live(let c) = item(id) else { return nil }
        let list = channels.filter { $0.group == c.group }
        guard let i = list.firstIndex(where: { $0.id == id }), !list.isEmpty else { return nil }
        return list[(i + offset + list.count) % list.count]
    }

    func randomPick(kind: MediaKind?, minRating: Double = 0) -> Item? {
        let watched = Set(user.history.map(\.itemId))
        var pool: [Item]
        switch kind {
        case .movie: pool = movies.map(Item.movie)
        case .series: pool = series.map(Item.series)
        case .live: pool = channels.map(Item.live)
        case nil: pool = movies.map(Item.movie) + series.map(Item.series)
        }
        if minRating > 0 { pool = pool.filter { ($0.rating ?? 0) >= minRating } }
        let fresh = pool.filter { !watched.contains($0.id) }
        return (fresh.isEmpty ? pool : fresh).randomElement()
    }

    func openExternally(_ url: String) {
        guard let u = URL(string: url) else { return }
        let name = settings.externalPlayer
        let ws = NSWorkspace.shared
        if let app = ["IINA": "com.colliderli.iina", "VLC": "org.videolan.vlc", "Infuse": "com.firecore.infuse"][name],
           let appURL = ws.urlForApplication(withBundleIdentifier: app) {
            ws.open([u], withApplicationAt: appURL, configuration: NSWorkspace.OpenConfiguration())
        } else {
            toast = "\(name) isn't installed. Get IINA or VLC to play this format."
        }
    }

    // MARK: Deep links

    func handle(_ link: DeepLink) -> PlaybackRequest? {
        switch link {
        case .home: selection = .home; path = NavigationPath()
        case .random: selection = .random; path = NavigationPath()
        case .search(let q): selection = .search; searchQuery = q
        case .item(let id):
            if let it = item(id) { selection = it.kind == .series ? .series : it.kind == .movie ? .movies : .live; path = NavigationPath(); path.append(Route.detail(it)) }
        case .live(let id):
            if let it = item(id) { return request(for: it) }
        case .play(let id):
            if let h = user.history.first(where: { $0.itemId == id && $0.kind == "episode" }), case .series(let show) = item(id) {
                let eid = String(h.id.split(separator: "|").last ?? "")
                let eps = infoCache[show.id]?.episodes ?? show.episodes ?? []
                if let e = eps.first(where: { $0.id == eid }) { return request(for: e, in: show) }
                // the episode list isn't loaded yet: resume from what history remembers
                if let src = source(show.sourceId), src.kind == .xtream, !eid.isEmpty {
                    var r = PlaybackRequest(historyId: h.id, kind: "episode", itemId: show.id, title: h.name, subtitle: h.subtitle,
                                            url: Xtream.streamUrl(src, kind: "series", id: eid, ext: "mp4"), artwork: h.artwork, startAt: h.position)
                    r.showId = show.id; r.episodeId = eid
                    return r
                }
                selection = .series; path = NavigationPath(); path.append(Route.detail(.series(show)))
            } else if let it = item(id) { return request(for: it) }
        }
        return nil
    }

    // MARK: Widgets

    private var widgetTask: Task<Void, Never>?
    func publishWidgets() {
        widgetTask?.cancel()
        widgetTask = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            let cont: [WidgetItem] = continueWatching.prefix(6).map { h in
                WidgetItem(id: h.itemId, title: h.name, subtitle: h.subtitle, progress: h.progress, kind: h.kind,
                           thumb: h.artwork == nil ? nil : Shared.thumbURL(for: h.itemId).lastPathComponent)
            }
            let favs = favoriteChannels.isEmpty ? Array(recentChannels.prefix(8)) : Array(favoriteChannels.prefix(8))
            let live: [WidgetChannel] = favs.map { c in
                let nn = nowNext(for: c)
                return WidgetChannel(id: c.id, name: c.name, number: c.num, nowTitle: nn.now?.title, nowStart: nn.now?.start,
                                     nowStop: nn.now?.stop, nextTitle: nn.next?.title, thumb: c.logo.map { _ in Shared.thumbURL(for: c.id).lastPathComponent })
            }
            var picks: [WidgetItem] = []
            for _ in 0..<12 {
                guard let p = randomPick(kind: nil, minRating: 6.5) ?? randomPick(kind: nil), !picks.contains(where: { $0.id == p.id }) else { continue }
                picks.append(WidgetItem(id: p.id, title: SearchKit.cleanTitle(p.name), subtitle: [p.year, p.rating.map { String(format: "★ %.1f", $0) }].compactMap { $0 }.joined(separator: " · "),
                                        kind: p.kind.rawValue, thumb: p.artwork.map { _ in Shared.thumbURL(for: p.id).lastPathComponent }))
                if picks.count == 6 { break }
            }
            let snap = WidgetSnapshot(continueWatching: cont, liveNow: live, picks: picks, movieCount: movies.count, seriesCount: series.count,
                                      channelCount: channels.count, watchlistCount: user.watchlist.count, updatedAt: .now)
            var art: [(String, String)] = continueWatching.prefix(6).compactMap { h in h.artwork.map { (h.itemId, $0) } }
            art += favs.compactMap { c in c.logo.map { (c.id, $0) } }
            art += picks.compactMap { p in item(p.id)?.artwork.map { (p.id, $0) } }
            let ua = settings.userAgent
            await Task.detached(priority: .utility) {
                await ThumbWriter.write(art, ua: ua)
                Shared.write(snap)
            }.value
            WidgetCenter.shared.reloadAllTimelines()
        }
    }
}

nonisolated struct EpgCache: Codable, Sendable {
    var programmes: [String: [Programme]]
    var names: [String: String]
    var updatedAt: Date
}

/// Downloads artwork and stores small JPEGs the widgets can read (they can't load from the network while rendering).
nonisolated enum ThumbWriter {
    static func write(_ items: [(String, String)], ua: String) async {
        await withTaskGroup(of: Void.self) { g in
            for (id, art) in items {
                let dest = Shared.thumbURL(for: id)
                if let attrs = try? FileManager.default.attributesOfItem(atPath: dest.path),
                   let d = attrs[.modificationDate] as? Date, d.timeIntervalSinceNow > -7 * 86400 { continue }
                guard let url = art.artURL(size: "w342") else { continue }
                g.addTask {
                    guard let data = try? await Net.data(url.absoluteString, ua: ua), let img = NSImage(data: data) else { return }
                    let maxSide: CGFloat = 360
                    let s = img.size
                    let scale = min(1, maxSide / max(s.width, s.height, 1))
                    let size = NSSize(width: max(1, s.width * scale), height: max(1, s.height * scale))
                    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
                                                     bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                                     colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return }
                    NSGraphicsContext.saveGraphicsState()
                    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
                    img.draw(in: NSRect(origin: .zero, size: size))
                    NSGraphicsContext.restoreGraphicsState()
                    if let jpg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.82]) { try? jpg.write(to: dest, options: .atomic) }
                }
            }
        }
    }
}

struct SeededRNG: RandomNumberGenerator {
    private var state: UInt64
    init(seed: UInt64) { state = seed &+ 0x9E3779B97F4A7C15 }
    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}

extension Color {
    init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}
