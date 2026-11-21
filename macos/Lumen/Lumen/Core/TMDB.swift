// TMDB: person pages, recommendations and genre rows (free key from themoviedb.org/settings/api).
import Foundation

nonisolated enum TmdbKind: String, Codable, Sendable { case movie, series }

nonisolated struct TmdbTitle: Codable, Hashable, Identifiable, Sendable {
    var tmdb: Int
    var kind: TmdbKind
    var title: String
    var year: String?
    var rating: Double?
    var votes: Int
    var poster: String?
    var role: String?
    var id: String { "\(kind.rawValue)\(tmdb)" }
}

nonisolated struct TmdbPerson: Codable, Sendable {
    var id: Int
    var name: String
    var photo: String?
    var born: String?
    var died: String?
    var birthplace: String?
    var age: Int?
    var bio: String?
    var department: String?
    var credits: [TmdbTitle]
    var count: Int
    var average: Double?
}

nonisolated struct TmdbTrailer: Codable, Sendable { var key: String; var name: String }

nonisolated enum TMDB {
    static let img = "https://image.tmdb.org/t/p"

    struct Raw: Decodable {
        var id: Int
        var media_type: String?
        var title: String?
        var name: String?
        var release_date: String?
        var first_air_date: String?
        var vote_average: Double?
        var vote_count: Int?
        var poster_path: String?
        var character: String?
        var job: String?
        var genre_ids: [Int]?
    }
    struct RawPerson: Decodable {
        var id: Int
        var name: String
        var profile_path: String?
        var birthday: String?
        var deathday: String?
        var place_of_birth: String?
        var biography: String?
        var known_for_department: String?
        var combined_credits: Credits?
        struct Credits: Decodable { var cast: [Raw]?; var crew: [Raw]? }
    }
    struct Page: Decodable { var results: [Raw]? }
    struct RawVideo: Decodable { var site: String?; var type: String?; var key: String?; var name: String?; var official: Bool?; var iso_639_1: String? }

    enum Failure: LocalizedError {
        case badKey, http(Int)
        var errorDescription: String? {
            switch self {
            case .badKey: "TMDB didn't accept the key. Check it in Settings."
            case .http(let c): "TMDB answered \(c)."
            }
        }
    }

    static func data(_ key: String, _ path: String, _ params: [String: String] = [:]) async throws -> Data {
        var comps = URLComponents(string: "https://api.themoviedb.org/3\(path)")!
        var items = params.map { URLQueryItem(name: $0.key, value: $0.value) }
        let bearer = key.count > 40
        if !bearer { items.append(URLQueryItem(name: "api_key", value: key)) }
        comps.queryItems = items
        var req = URLRequest(url: comps.url!)
        req.timeoutInterval = 20
        if bearer { req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization") }
        let (d, r) = try await URLSession.shared.data(for: req)
        if let h = r as? HTTPURLResponse {
            if h.statusCode == 401 { throw Failure.badKey }
            if h.statusCode >= 400 { throw Failure.http(h.statusCode) }
        }
        return d
    }

    static func call<T: Decodable>(_ key: String, _ path: String, _ params: [String: String] = [:], as: T.Type = T.self) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await data(key, path, params))
    }

    static func parse(_ r: Raw, kind: TmdbKind? = nil) -> TmdbTitle? {
        let k: TmdbKind? = kind ?? (r.media_type == "movie" ? .movie : r.media_type == "tv" ? .series : nil)
        guard let k, let title = r.title ?? r.name else { return nil }
        let date = r.release_date ?? r.first_air_date
        return TmdbTitle(tmdb: r.id, kind: k, title: title, year: date.flatMap { $0.count >= 4 ? String($0.prefix(4)) : nil },
                         rating: r.vote_average.flatMap { $0 > 0 ? (($0 * 10).rounded() / 10) : nil }, votes: r.vote_count ?? 0,
                         poster: r.poster_path.map { "\(img)/w342\($0)" }, role: (r.character?.isEmpty == false ? r.character : nil) ?? (r.job?.isEmpty == false ? r.job : nil))
    }

    static func age(born: String, on d: Date) -> Int? {
        let p = born.split(separator: "-").compactMap { Int($0) }
        guard p.count >= 3 else { return nil }
        let c = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day], from: d)
        var a = (c.year ?? 0) - p[0]
        if (c.month ?? 0) < p[1] || ((c.month ?? 0) == p[1] && (c.day ?? 0) < p[2]) { a -= 1 }
        return a >= 0 && a < 130 ? a : nil
    }

    static func person(key: String, name: String, role: PersonRole) async throws -> TmdbPerson? {
        struct Hits: Decodable { var results: [H]?; struct H: Decodable { var id: Int; var name: String } }
        let hits = try await call(key, "/search/person", ["query": name], as: Hits.self).results ?? []
        let same = hits.filter { $0.name.lowercased() == name.lowercased() }
        guard let id = (same.isEmpty ? hits : same).first?.id else { return nil }
        let j = try await call(key, "/person/\(id)", ["append_to_response": "combined_credits"], as: RawPerson.self)
        let notWork: Set<Int> = [10763, 10764, 10767]
        let raw: [Raw] = role == .director ? (j.combined_credits?.crew ?? []).filter { $0.job == "Director" }
                                           : (j.combined_credits?.cast ?? []).filter { !($0.genre_ids ?? []).contains(where: notWork.contains) }
        var seen = Set<String>(); var credits: [TmdbTitle] = []
        let thisYear = Calendar.current.component(.year, from: .now)
        for r in raw {
            guard let t = parse(r), let y = t.year, let yi = Int(y), yi <= thisYear, seen.insert(t.id).inserted else { continue }
            credits.append(t)
        }
        credits.sort { $0.votes > $1.votes }
        let rated = credits.filter { ($0.rating ?? 0) > 0 && $0.votes >= 20 }
        let avg = rated.isEmpty ? nil : (rated.reduce(0) { $0 + $1.rating! } / Double(rated.count) * 10).rounded() / 10
        let died = j.deathday.flatMap { $0.isEmpty ? nil : $0 }
        let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd"
        return TmdbPerson(id: j.id, name: j.name, photo: j.profile_path.map { "\(img)/w342\($0)" }, born: j.birthday.flatMap { $0.isEmpty ? nil : $0 },
                          died: died, birthplace: j.place_of_birth.flatMap { $0.isEmpty ? nil : $0 },
                          age: j.birthday.flatMap { age(born: $0, on: died.flatMap { fmt.date(from: $0) } ?? .now) },
                          bio: j.biography?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty, department: j.known_for_department,
                          credits: Array(credits.prefix(80)), count: credits.count, average: avg)
    }

    static func resolve(key: String, kind: TmdbKind, title: String, year: String?, imdb: String? = nil) async throws -> Int? {
        if let imdb {
            struct Found: Decodable { var movie_results: [Raw]?; var tv_results: [Raw]? }
            let r = try await call(key, "/find/\(imdb)", ["external_source": "imdb_id"], as: Found.self)
            if let id = (kind == .movie ? r.movie_results : r.tv_results)?.first?.id { return id }
        }
        var p = ["query": title]
        if let year { p[kind == .movie ? "year" : "first_air_date_year"] = year }
        return try await call(key, kind == .movie ? "/search/movie" : "/search/tv", p, as: Page.self).results?.first?.id
    }

    static func recommendations(key: String, kind: TmdbKind, tmdb: Int) async throws -> [TmdbTitle] {
        let path = "/\(kind == .movie ? "movie" : "tv")/\(tmdb)"
        async let rec = call(key, "\(path)/recommendations", as: Page.self)
        async let sim = try? call(key, "\(path)/similar", as: Page.self)
        var seen = Set<Int>(); var out: [TmdbTitle] = []
        let recR = try await rec.results ?? []
        let simR = await sim?.results ?? []
        for r in recR + simR {
            if let t = parse(r, kind: kind), seen.insert(t.tmdb).inserted { out.append(t) }
        }
        return out
    }

    static func trailer(key: String, kind: TmdbKind, tmdb: Int) async throws -> TmdbTrailer? {
        struct V: Decodable { var results: [RawVideo]? }
        let v = try await call(key, "/\(kind == .movie ? "movie" : "tv")/\(tmdb)/videos", ["language": "en-US"], as: V.self).results ?? []
        func score(_ v: RawVideo) -> Int { (v.type == "Trailer" ? 4 : 0) + (v.official == true ? 2 : 0) + (v.iso_639_1 == "en" ? 1 : 0) }
        let best = v.filter { $0.site == "YouTube" && $0.key != nil && ($0.type == "Trailer" || $0.type == "Teaser") }.max { score($0) < score($1) }
        return best.map { TmdbTrailer(key: $0.key!, name: $0.name ?? "Trailer") }
    }

    static let movieGenres: [(Int, String)] = [(53, "Thriller"), (35, "Comedy"), (28, "Action"), (878, "Science Fiction"), (27, "Horror"), (18, "Drama"), (10749, "Romance"), (16, "Animation"), (80, "Crime"), (12, "Adventure")]
    static let seriesGenres: [(Int, String)] = [(80, "Crime"), (35, "Comedy"), (18, "Drama"), (10765, "Sci-Fi & Fantasy"), (10759, "Action & Adventure"), (9648, "Mystery"), (16, "Animation")]

    static func genreTitles(key: String, kind: TmdbKind, genre: Int) async -> [TmdbTitle] {
        let path = kind == .movie ? "/discover/movie" : "/discover/tv"
        var out: [TmdbTitle] = []; var seen = Set<Int>()
        for page in 1...3 {
            let r = try? await call(key, path, ["with_genres": String(genre), "sort_by": "popularity.desc", "vote_count.gte": "300", "include_adult": "false", "page": String(page)], as: Page.self)
            for x in r?.results ?? [] { if let t = parse(x, kind: kind), seen.insert(t.tmdb).inserted { out.append(t) } }
        }
        return out
    }
}

extension String {
    nonisolated var nilIfEmpty: String? { isEmpty ? nil : self }

    /// Matching key like the Windows app's titleKey: no provider tag, quality words or year, letters and digits only.
    nonisolated var titleKey: String {
        var s = replacingOccurrences(of: #"^\s*(\|[^|]{1,12}\||\[[^\]]{1,12}\]|[A-Z]{2}\s*:|[A-Z0-9]{2,5}(?:[-_ ]?\[[^\]]{1,10}\]|[-_ ][A-Z0-9+]{1,5})*\s*[|-])\s+"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\[[^\]]*\]"#, with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\((?:19|20)\d\d\)"#, with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\b(4k|uhd|fhd|hd|sd|hdr10?|hevc|x26[45]|h\.?26[45]|2160p|1080p|720p|multi[- ]?sub|multi|vost(?:fr)?|subbed|dubbed)\b"#, with: " ", options: [.regularExpression, .caseInsensitive])
        s = s.replacingOccurrences(of: #"[(\[]?\b((?:19|20)\d\d)\b[)\]]?\s*$"#, with: "", options: .regularExpression)
        let folded = s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased().replacingOccurrences(of: "&", with: "and")
        return String(folded.unicodeScalars.filter { ($0.value >= 97 && $0.value <= 122) || ($0.value >= 48 && $0.value <= 57) })
    }
}

// MARK: - Disk cache

actor TmdbCache {
    static let shared = TmdbCache()
    private var table: [String: Entry] = [:]
    private var loaded = false
    struct Entry: Codable { var json: String; var at: Date }

    private var url: URL { AppModel.supportURL.appendingPathComponent("tmdb-cache.json") }

    private func load() {
        guard !loaded else { return }
        loaded = true
        if let d = try? Data(contentsOf: url), let t = try? JSONDecoder().decode([String: Entry].self, from: d) { table = t }
    }

    func get<T: Codable>(_ key: String, days: Double, _ fetch: () async throws -> T?) async throws -> T? {
        load()
        if let e = table[key], Date.now.timeIntervalSince(e.at) < (e.json == "null" ? 1 : days) * 86400 {
            if e.json == "null" { return nil }
            if let v = try? JSONDecoder().decode(T.self, from: Data(e.json.utf8)) { return v }
        }
        let v = try await fetch()
        let json = v.flatMap { try? String(decoding: JSONEncoder().encode($0), as: UTF8.self) } ?? "null"
        table[key] = Entry(json: json, at: .now)
        if table.count > 200 { for k in table.sorted(by: { $0.value.at < $1.value.at }).prefix(table.count - 200).map(\.key) { table[k] = nil } }
        if let d = try? JSONEncoder().encode(table) { try? d.write(to: url, options: .atomic) }
        return v
    }
}

// MARK: - Observable rows for Home

struct GenreRow: Identifiable { var id: String { name }; var name: String; var kind: TmdbKind; var items: [Item] }

@MainActor @Observable
final class TMDBModel {
    var recommended: [Item] = []
    var genreRows: [GenreRow] = []
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var signature = ""

    private func kind(_ i: Item) -> TmdbKind { i.kind == .movie ? .movie : .series }

    func tmdbId(key: String, _ item: Item) async -> Int? {
        let tm: Int?
        switch item { case .movie(let m): tm = m.tmdb; case .series(let s): tm = s.tmdb; case .live: tm = nil }
        if let tm { return tm }
        let title = SearchKit.cleanTitle(item.name)
        let year = item.year?.firstMatch(of: /(19|20)\d\d/).map { String($0.0) }
        let ck = "id:\(kind(item).rawValue):\(title.lowercased()):\(year ?? "")"
        return try? await TmdbCache.shared.get(ck, days: 60) { try await TMDB.resolve(key: key, kind: kind(item), title: title, year: year) }
    }

    func recommendations(key: String, kind: TmdbKind, tmdb: Int) async -> [TmdbTitle]? {
        (try? await TmdbCache.shared.get("rec:\(kind.rawValue):\(tmdb)", days: 7) { try await TMDB.recommendations(key: key, kind: kind, tmdb: tmdb) }) ?? nil
    }

    /// Library titles for TMDB titles: by TMDB id when the provider sent one, otherwise by name and year.
    nonisolated static func match(_ cands: [TmdbTitle], movies: [Movie], series: [Show]) async -> [String: Item] {
        await Task.detached(priority: .utility) {
            var byTitle: [String: [TmdbTitle]] = [:]
            var byId: [String: TmdbTitle] = [:]
            for c in cands { byTitle[c.kind.rawValue + c.title.titleKey, default: []].append(c); byId[c.id] = c }
            var hit: [String: Item] = [:]
            func visit(kind: TmdbKind, name: String, tmdb: Int?, year: String?, item: Item) {
                if let tmdb, let c = byId["\(kind.rawValue)\(tmdb)"] { hit[c.id] = item; return }
                if tmdb != nil { return }
                guard let cs = byTitle[kind.rawValue + name.titleKey] else { return }
                let y = year?.firstMatch(of: /(19|20)\d\d/).flatMap { Int(String($0.0)) }
                for c in cs where hit[c.id] == nil {
                    if let y, let cy = c.year.flatMap(Int.init), abs(y - cy) > 1 { continue }
                    hit[c.id] = item
                }
            }
            for m in movies { visit(kind: .movie, name: m.name, tmdb: m.tmdb, year: m.year, item: .movie(m)) }
            for s in series { visit(kind: .series, name: s.name, tmdb: s.tmdb, year: s.year, item: .series(s)) }
            return hit
        }.value
    }

    func inLibrary(_ recs: [TmdbTitle], skip: Int? = nil, movies: [Movie], series: [Show]) async -> [Item] {
        let m = await Self.match(recs.filter { $0.tmdb != skip }, movies: movies, series: series)
        var seen = Set<String>(); var out: [Item] = []
        for r in recs { if let x = m[r.id], seen.insert(x.id).inserted { out.append(x) } }
        return out
    }

    /// "Recommended for You" and the genre rows. Waits a moment so the library gets the CPU first.
    func refresh(model: AppModel, force: Bool = false) {
        let key = model.settings.tmdbKey.trimmingCharacters(in: .whitespaces)
        let signals = model.homeSignals
        let sig = "\(key)|\(signals.map(\.id).joined(separator: ","))|\(model.library.updatedAt.timeIntervalSince1970)"
        guard force || sig != signature else { return }
        signature = sig
        task?.cancel()
        guard !key.isEmpty else { recommended = []; genreRows = []; return }
        let movies = model.movies, series = model.series
        task = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            // recommended
            var have = Set<Int>(); var score: [Int: (t: TmdbTitle, s: Double)] = [:]
            for (i, x) in signals.prefix(6).enumerated() {
                guard let tm = await tmdbId(key: key, x) else { continue }
                have.insert(tm)
                for (j, t) in (await recommendations(key: key, kind: kind(x), tmdb: tm) ?? []).prefix(20).enumerated() {
                    var e = score[t.tmdb] ?? (t, 0)
                    e.s += (1 - Double(i) * 0.12) * (1 - Double(j) * 0.02) + (t.rating ?? 6) / 40
                    score[t.tmdb] = e
                }
            }
            let ranked = score.values.filter { !have.contains($0.t.tmdb) }.sorted { $0.s > $1.s }.prefix(80).map(\.t)
            let titles = await inLibrary(Array(ranked), movies: movies, series: series)
            let seen = Set(signals.map(\.id))
            guard !Task.isCancelled else { return }
            recommended = Array(titles.filter { !seen.contains($0.id) }.prefix(30))
            // genres
            try? await Task.sleep(for: .seconds(1.5))
            let jobs = TMDB.movieGenres.map { ($0, TmdbKind.movie) } + TMDB.seriesGenres.map { ($0, TmdbKind.series) }
            var lists: [[TmdbTitle]] = []
            for ((gid, _), k) in jobs {
                let l = (try? await TmdbCache.shared.get("genre:\(k.rawValue):\(gid)", days: 7) { await TMDB.genreTitles(key: key, kind: k, genre: gid) }) ?? nil
                lists.append(l ?? [])
                if Task.isCancelled { return }
            }
            let m = await Self.match(lists.flatMap { $0 }, movies: movies, series: series)
            var rows: [GenreRow] = []
            for (n, ((_, gname), k)) in jobs.enumerated() {
                var seenIds = Set<String>(); var items: [Item] = []
                for t in lists[n] { if let x = m[t.id], seenIds.insert(x.id).inserted { items.append(x) } }
                if items.count >= 6 { rows.append(GenreRow(name: k == .movie ? gname : "\(gname) series", kind: k, items: Array(items.prefix(30)))) }
            }
            genreRows = rows
        }
    }
}
