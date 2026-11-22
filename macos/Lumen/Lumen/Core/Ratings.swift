// IMDb, Rotten Tomatoes and Metacritic scores from OMDb (free key in Settings → TMDB & ratings).
import Foundation

nonisolated struct ExternalRatings: Codable, Hashable, Sendable {
    var imdb: Double?
    var votes: Int?
    var rottenTomatoes: Int?
    var metacritic: Int?
    var isEmpty: Bool { imdb == nil && rottenTomatoes == nil && metacritic == nil }
}

nonisolated enum OMDb {
    static func ratings(key: String, title: String, year: String?, series: Bool) async throws -> ExternalRatings? {
        var c = URLComponents(string: "https://www.omdbapi.com/")!
        var q = [URLQueryItem(name: "apikey", value: key), URLQueryItem(name: "t", value: title),
                 URLQueryItem(name: "type", value: series ? "series" : "movie")]
        if let y = year?.prefix(4), y.count == 4 { q.append(URLQueryItem(name: "y", value: String(y))) }
        c.queryItems = q
        guard let url = c.url else { return nil }
        let (d, _) = try await URLSession.shared.data(from: url)
        guard let j = try JSONSerialization.jsonObject(with: d) as? [String: Any], (j["Response"] as? String) == "True" else { return nil }
        var r = ExternalRatings()
        r.imdb = (j["imdbRating"] as? String).flatMap(Double.init)
        r.votes = (j["imdbVotes"] as? String).flatMap { Int($0.replacingOccurrences(of: ",", with: "")) }
        r.metacritic = (j["Metascore"] as? String).flatMap(Int.init)
        if let list = j["Ratings"] as? [[String: String]],
           let rt = list.first(where: { $0["Source"] == "Rotten Tomatoes" })?["Value"] {
            r.rottenTomatoes = Int(rt.replacingOccurrences(of: "%", with: ""))
        }
        return r.isEmpty ? nil : r
    }
}

extension AppModel {
    /// Cached for a week per title; nil when there is no OMDb key or no match.
    func externalRatings(for item: Item, year: String?) async -> ExternalRatings? {
        let key = settings.omdbKey.trimmingCharacters(in: .whitespaces)
        guard !key.isEmpty, item.kind != .live else { return nil }
        let title = SearchKit.cleanTitle(item.name)
            .replacingOccurrences(of: #"\s*\(\d{4}\)\s*$"#, with: "", options: .regularExpression)
        let series = item.kind == .series
        return (try? await TmdbCache.shared.get("omdb:\(series ? "s" : "m"):\(title.lowercased()):\(year ?? "")", days: 7) {
            try await OMDb.ratings(key: key, title: title, year: year, series: series)
        }) ?? nil
    }
}
