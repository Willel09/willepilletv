// Library types, mirroring src/shared/types.ts in the Windows/TV app.
import Foundation

nonisolated enum SourceKind: String, Codable, CaseIterable, Identifiable, Sendable {
    case m3u, xtream
    var id: String { rawValue }
    var label: String { self == .m3u ? "M3U playlist" : "Xtream Codes" }
}

nonisolated struct Source: Codable, Hashable, Identifiable, Sendable {
    var id: String = UUID().uuidString
    var name: String
    var kind: SourceKind
    /// M3U: http(s) URL or file URL
    var url: String?
    var server: String?
    var username: String?
    var password: String?
    var epgUrl: String?
    var enabled: Bool = true
}

nonisolated struct Channel: Codable, Hashable, Identifiable, Sendable {
    var id: String
    var sourceId: String
    var name: String
    var group: String
    var url: String?
    var logo: String?
    var epgId: String?
    var num: Int?
    /// Xtream stream id: the URL is built when played
    var sid: Int?
}

nonisolated struct Episode: Codable, Hashable, Identifiable, Sendable {
    var id: String
    var title: String
    var season: Int
    var episode: Int
    var url: String
    var plot: String?
    var still: String?
    var duration: String?
}

nonisolated struct Movie: Codable, Hashable, Identifiable, Sendable {
    var id: String
    var sourceId: String
    var name: String
    var group: String
    var url: String?
    var ext: String?
    var poster: String?
    var rating: Double?
    var year: String?
    var plot: String?
    var added: Double?
    var vodId: Int?
    var tmdb: Int?
}

nonisolated struct Show: Codable, Hashable, Identifiable, Sendable {
    var id: String
    var sourceId: String
    var name: String
    var group: String
    var poster: String?
    var backdrop: String?
    var rating: Double?
    var year: String?
    var plot: String?
    var added: Double?
    var seriesId: Int?
    var episodes: [Episode]?
    var tmdb: Int?
}

nonisolated enum MediaKind: String, Codable, Sendable, CaseIterable {
    case live, movie, series
}

/// Anything that can be shown as a card.
nonisolated enum Item: Hashable, Identifiable, Sendable {
    case live(Channel)
    case movie(Movie)
    case series(Show)

    var id: String {
        switch self {
        case .live(let c): c.id
        case .movie(let m): m.id
        case .series(let s): s.id
        }
    }
    var name: String {
        switch self {
        case .live(let c): c.name
        case .movie(let m): m.name
        case .series(let s): s.name
        }
    }
    var group: String {
        switch self {
        case .live(let c): c.group
        case .movie(let m): m.group
        case .series(let s): s.group
        }
    }
    var artwork: String? {
        switch self {
        case .live(let c): c.logo
        case .movie(let m): m.poster
        case .series(let s): s.poster
        }
    }
    var backdrop: String? {
        if case .series(let s) = self, let b = s.backdrop { return b }
        return artwork
    }
    var rating: Double? {
        switch self {
        case .live: nil
        case .movie(let m): m.rating
        case .series(let s): s.rating
        }
    }
    var year: String? {
        switch self {
        case .live: nil
        case .movie(let m): m.year
        case .series(let s): s.year
        }
    }
    var added: Double {
        switch self {
        case .live: 0
        case .movie(let m): m.added ?? 0
        case .series(let s): s.added ?? 0
        }
    }
    var kind: MediaKind {
        switch self {
        case .live: .live
        case .movie: .movie
        case .series: .series
        }
    }
    var sourceId: String {
        switch self {
        case .live(let c): c.sourceId
        case .movie(let m): m.sourceId
        case .series(let s): s.sourceId
        }
    }
}

nonisolated struct Account: Codable, Hashable, Sendable {
    var status: String?
    var expires: Date?
    var maxConnections: Int?
    var activeConnections: Int?
}

nonisolated struct Library: Codable, Sendable {
    var channels: [Channel] = []
    var movies: [Movie] = []
    var series: [Show] = []
    var providerEpgUrls: [String] = []
    var accounts: [String: Account] = [:]
    var errors: [String] = []
    var updatedAt: Date = .distantPast

    var isEmpty: Bool { channels.isEmpty && movies.isEmpty && series.isEmpty }
}

nonisolated struct Programme: Codable, Hashable, Sendable {
    var start: Date
    var stop: Date
    var title: String
    var desc: String?

    func isOn(at date: Date = .now) -> Bool { start <= date && date < stop }
    func progress(at date: Date = .now) -> Double {
        let total = stop.timeIntervalSince(start)
        guard total > 0 else { return 0 }
        return min(1, max(0, date.timeIntervalSince(start) / total))
    }
}

nonisolated struct MediaInfo: Codable, Hashable, Sendable {
    var plot: String?
    var backdrop: String?
    var poster: String?
    var cast: String?
    var director: String?
    var genre: String?
    var duration: String?
    var rating: Double?
    var year: String?
    var episodes: [Episode]?
}

nonisolated struct HistoryEntry: Codable, Hashable, Identifiable, Sendable {
    /// item id for live/movie; "<showId>|<episodeId>" for episodes
    var id: String
    var kind: String // live | movie | episode
    var itemId: String
    var name: String
    var subtitle: String?
    var artwork: String?
    var position: Double = 0
    var duration: Double = 0
    var watchedAt: Date = .now

    var progress: Double { duration > 0 ? min(1, position / duration) : 0 }
    var isFinished: Bool { duration > 0 && position / duration > 0.92 }
}

nonisolated struct AppSettings: Codable, Hashable, Sendable {
    enum LiveFormat: String, Codable, CaseIterable, Sendable { case m3u8, ts }
    enum Ambient: String, Codable, CaseIterable, Sendable { case strong, subtle, off }

    var liveFormat: LiveFormat = .m3u8
    var epgUrl: String = ""
    var autoProviderEpg: Bool = true
    var userAgent: String = ""
    var hiddenGroups: String = ""
    var removeBs: Bool = false
    var autoplayNext: Bool = true
    var refreshHours: Int = 12
    var ambient: Ambient = .subtle
    var accentHex: String = "#98A2B3"
    var externalPlayer: String = "IINA"
    var screensaverMins: Int = 5
    var showMenuBarExtra: Bool = true

    init() {}
    init(from decoder: Decoder) throws {
        // tolerant decoding: new keys get defaults instead of throwing away old settings
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = AppSettings.defaults
        liveFormat = (try? c.decode(LiveFormat.self, forKey: .liveFormat)) ?? d.liveFormat
        epgUrl = (try? c.decode(String.self, forKey: .epgUrl)) ?? d.epgUrl
        autoProviderEpg = (try? c.decode(Bool.self, forKey: .autoProviderEpg)) ?? d.autoProviderEpg
        userAgent = (try? c.decode(String.self, forKey: .userAgent)) ?? d.userAgent
        hiddenGroups = (try? c.decode(String.self, forKey: .hiddenGroups)) ?? d.hiddenGroups
        removeBs = (try? c.decode(Bool.self, forKey: .removeBs)) ?? d.removeBs
        autoplayNext = (try? c.decode(Bool.self, forKey: .autoplayNext)) ?? d.autoplayNext
        refreshHours = (try? c.decode(Int.self, forKey: .refreshHours)) ?? d.refreshHours
        ambient = (try? c.decode(Ambient.self, forKey: .ambient)) ?? d.ambient
        accentHex = (try? c.decode(String.self, forKey: .accentHex)) ?? d.accentHex
        externalPlayer = (try? c.decode(String.self, forKey: .externalPlayer)) ?? d.externalPlayer
        screensaverMins = (try? c.decode(Int.self, forKey: .screensaverMins)) ?? d.screensaverMins
        showMenuBarExtra = (try? c.decode(Bool.self, forKey: .showMenuBarExtra)) ?? d.showMenuBarExtra
    }
    static let defaults = AppSettings()
}

nonisolated struct UserData: Codable, Sendable {
    var favorites: [String] = []
    var watchlist: [String] = []
    var history: [HistoryEntry] = []
    var lists: [String: [String]] = [:]
    var settings = AppSettings()
}

/// What the player window is asked to play.
nonisolated struct PlaybackRequest: Codable, Hashable, Sendable {
    var historyId: String
    var kind: String // live | movie | episode
    var itemId: String
    var title: String
    var subtitle: String?
    var url: String
    var artwork: String?
    var startAt: Double = 0
    /// series context for Up Next
    var showId: String?
    var episodeId: String?
}

extension String {
    /// "~file.jpg" is short for TMDB artwork, same as the web app's artUrl
    nonisolated func artURL(size: String = "w342") -> URL? {
        if hasPrefix("~") { return URL(string: "https://image.tmdb.org/t/p/\(size)/\(dropFirst())") }
        return URL(string: self)
    }
}
