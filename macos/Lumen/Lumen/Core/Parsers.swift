// M3U, Xtream Codes and XMLTV parsing. Ported from src/shared/core/{m3u,xtream,epg}.ts.
import Foundation
import Compression

// MARK: - Hash (cyrb53, same ids as the web app so links stay stable)

nonisolated func cyrb53(_ str: String) -> String {
    var h1: UInt32 = 0xdeadbeef
    var h2: UInt32 = 0x41c6ce57
    for ch in str.utf16 {
        h1 = (h1 ^ UInt32(ch)) &* 2654435761
        h2 = (h2 ^ UInt32(ch)) &* 1597334677
    }
    h1 = ((h1 ^ (h1 >> 16)) &* 2246822507) ^ ((h2 ^ (h2 >> 13)) &* 3266489909)
    h2 = ((h2 ^ (h2 >> 16)) &* 2246822507) ^ ((h1 ^ (h1 >> 13)) &* 3266489909)
    let v = UInt64(2097151 & h2) * 4294967296 + UInt64(h1)
    return String(v, radix: 36)
}

// MARK: - Networking

nonisolated enum Net {
    static func session(userAgent: String) -> URLSession {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 60
        cfg.timeoutIntervalForResource = 600
        cfg.httpAdditionalHeaders = ["User-Agent": userAgent.isEmpty ? "Lumen/1.0 (Macintosh)" : userAgent]
        return URLSession(configuration: cfg)
    }

    static func data(_ urlString: String, ua: String) async throws -> Data {
        guard let url = URL(string: urlString.trimmingCharacters(in: .whitespaces)) else { throw LumenError.message("Invalid URL: \(urlString)") }
        if url.isFileURL { return try Data(contentsOf: url) }
        let (data, resp) = try await session(userAgent: ua).data(from: url)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw LumenError.message("The server answered \(http.statusCode).")
        }
        return Gzip.isGzip(data) ? (Gzip.decompress(data) ?? data) : data
    }

    static func json(_ url: String, ua: String) async throws -> Any {
        let d = try await data(url, ua: ua)
        return try JSONSerialization.jsonObject(with: d, options: [.fragmentsAllowed])
    }
}

nonisolated enum LumenError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let m) = self { return m }; return nil }
}

// MARK: - Gzip (.xml.gz guides)

nonisolated enum Gzip {
    static func isGzip(_ d: Data) -> Bool { d.count > 18 && d[d.startIndex] == 0x1f && d[d.startIndex + 1] == 0x8b }

    static func decompress(_ data: Data) -> Data? {
        let bytes = [UInt8](data)
        guard bytes.count > 18, bytes[0] == 0x1f, bytes[1] == 0x8b, bytes[2] == 8 else { return nil }
        let flags = bytes[3]
        var i = 10
        if flags & 4 != 0 { i += 2 + Int(bytes[i]) + Int(bytes[i + 1]) << 8 }
        if flags & 8 != 0 { while i < bytes.count && bytes[i] != 0 { i += 1 }; i += 1 }
        if flags & 16 != 0 { while i < bytes.count && bytes[i] != 0 { i += 1 }; i += 1 }
        if flags & 2 != 0 { i += 2 }
        guard i < bytes.count - 8 else { return nil }
        let raw = Data(bytes[i..<(bytes.count - 8)])
        // COMPRESSION_ZLIB is raw DEFLATE, which is what gzip wraps
        return try? (raw as NSData).decompressed(using: .zlib) as Data
    }
}

// MARK: - M3U

nonisolated struct M3uResult: Sendable {
    var channels: [Channel] = []
    var movies: [Movie] = []
    var series: [Show] = []
    var epgUrl: String?
}

nonisolated enum M3U {
    private static let attrRegex = try! NSRegularExpression(pattern: #"([\w-]+)=("([^"]*)"|'([^']*)')"#)
    private static let episodeRegex = try! NSRegularExpression(pattern: #"^(.*?)[\s._-]*S(\d{1,2})[\s._-]*E(\d{1,3})\b"#, options: .caseInsensitive)
    private static let vodExt = try! NSRegularExpression(pattern: #"\.(mp4|mkv|avi|mov|m4v|wmv|flv|webm)(\?|$)"#, options: .caseInsensitive)

    static func attrs(_ s: String) -> [String: String] {
        var out: [String: String] = [:]
        let ns = s as NSString
        for m in attrRegex.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
            let key = ns.substring(with: m.range(at: 1)).lowercased()
            let r = m.range(at: 3).location != NSNotFound ? m.range(at: 3) : m.range(at: 4)
            out[key] = r.location != NSNotFound ? ns.substring(with: r).trimmingCharacters(in: .whitespaces) : ""
        }
        return out
    }

    /// Everything after the first comma that isn't inside quotes.
    static func displayName(_ info: String) -> String {
        var quote: Character?
        for (i, c) in info.enumerated() {
            if let q = quote { if c == q { quote = nil } }
            else if c == "\"" || c == "'" { quote = c }
            else if c == "," { return String(info.dropFirst(i + 1)).trimmingCharacters(in: .whitespaces) }
        }
        return ""
    }

    static func parse(_ text: String, sourceId: String) -> M3uResult {
        var res = M3uResult()
        var seen = Set<String>()
        var showIndex: [String: Int] = [:]
        var info: [String: String]?
        var name = ""
        var extGroup = ""

        text.enumerateLines { raw, _ in
            let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty { return }
            if line.hasPrefix("#EXTM3U") {
                let a = attrs(line)
                let e = (a["url-tvg"] ?? a["x-tvg-url"] ?? "").split(separator: ",").first.map(String.init)?.trimmingCharacters(in: .whitespaces)
                res.epgUrl = (e?.isEmpty ?? true) ? nil : e
                return
            }
            if line.hasPrefix("#EXTINF:") {
                let body = String(line.dropFirst(8))
                info = attrs(body)
                name = displayName(body)
                if name.isEmpty { name = info?["tvg-name"] ?? "" }
                return
            }
            if line.hasPrefix("#EXTGRP:") { extGroup = String(line.dropFirst(8)).trimmingCharacters(in: .whitespaces); return }
            if line.hasPrefix("#") { return }

            let url = line
            let a = info ?? [:]
            let title = !name.isEmpty ? name : (a["tvg-name"].flatMap { $0.isEmpty ? nil : $0 } ?? url.split(separator: "/").last.map(String.init) ?? "Untitled")
            let group = [a["group-title"], extGroup].compactMap { $0 }.first { !$0.isEmpty } ?? "Uncategorized"
            let logo = a["tvg-logo"].flatMap { $0.isEmpty ? nil : $0 }
            let base = "\(group)|\(title)"
            let id = "\(sourceId):\(cyrb53(seen.contains(base) ? "\(base)|\(url)" : base))"
            seen.insert(base)

            let lower = url.lowercased()
            let nsTitle = title as NSString
            let ep = lower.contains("/series/") ? episodeRegex.firstMatch(in: title, range: NSRange(location: 0, length: nsTitle.length)) : nil

            if let ep {
                var showName = nsTitle.substring(with: ep.range(at: 1)).trimmingCharacters(in: .whitespaces)
                if showName.isEmpty { showName = title }
                let season = Int(nsTitle.substring(with: ep.range(at: 2))) ?? 0
                let number = Int(nsTitle.substring(with: ep.range(at: 3))) ?? 0
                let key = "\(group)|\(showName)"
                let idx: Int
                if let i = showIndex[key] { idx = i } else {
                    res.series.append(Show(id: "\(sourceId):s\(cyrb53(key))", sourceId: sourceId, name: showName, group: group, poster: logo, episodes: []))
                    idx = res.series.count - 1
                    showIndex[key] = idx
                }
                let se = "\(season)x\(number)"
                let exists = res.series[idx].episodes?.contains { $0.id == se } ?? false
                res.series[idx].episodes?.append(Episode(id: exists ? cyrb53(url) : se, title: title, season: season, episode: number, url: url, still: logo))
            } else if lower.contains("/movie/") || lower.contains("/movies/") || lower.contains("/vod/")
                        || vodExt.firstMatch(in: url, range: NSRange(location: 0, length: (url as NSString).length)) != nil {
                let yr = title.range(of: #"\((19|20)\d{2}\)"#, options: .regularExpression).map { String(title[$0].dropFirst().dropLast()) }
                res.movies.append(Movie(id: id, sourceId: sourceId, name: title, group: group, url: url, poster: logo, year: yr))
            } else {
                res.channels.append(Channel(id: id, sourceId: sourceId, name: title, group: group, url: url, logo: logo,
                                            epgId: a["tvg-id"].flatMap { $0.isEmpty ? nil : $0 }, num: Int(a["tvg-chno"] ?? "")))
            }
            info = nil; name = ""; extGroup = ""
        }
        for i in res.series.indices { res.series[i].episodes?.sort { ($0.season, $0.episode) < ($1.season, $1.episode) } }
        return res
    }
}

// MARK: - Xtream Codes

nonisolated enum Xtream {
    static func base(_ server: String) -> String {
        var s = server.trimmingCharacters(in: .whitespaces)
        if !s.lowercased().hasPrefix("http://") && !s.lowercased().hasPrefix("https://") { s = "http://" + s }
        if let r = s.range(of: #"/(player_api|get|panel_api|xmltv)\.php.*$"#, options: [.regularExpression, .caseInsensitive]) { s.removeSubrange(r) }
        while s.hasSuffix("/") { s.removeLast() }
        return s
    }

    private static func enc(_ s: String?) -> String { (s ?? "").addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?&=+"))) ?? "" }

    static func api(_ src: Source) -> String { "\(base(src.server ?? ""))/player_api.php?username=\(enc(src.username))&password=\(enc(src.password))" }
    static func epgUrl(_ src: Source) -> String { "\(base(src.server ?? ""))/xmltv.php?username=\(enc(src.username))&password=\(enc(src.password))" }
    static func streamUrl(_ src: Source, kind: String, id: String, ext: String) -> String {
        "\(base(src.server ?? ""))/\(kind)/\(enc(src.username))/\(enc(src.password))/\(id).\(ext)"
    }

    private static func arr(_ x: Any?) -> [[String: Any]] {
        if let a = x as? [[String: Any]] { return a }
        if let d = x as? [String: Any] { return d.values.compactMap { $0 as? [String: Any] } }
        return []
    }
    static func num(_ x: Any?) -> Double? {
        if let n = x as? NSNumber { return n.doubleValue }
        if let s = x as? String, let d = Double(s.trimmingCharacters(in: .whitespaces)) { return d }
        return nil
    }
    static func str(_ x: Any?) -> String? {
        guard let s = x as? String else { return nil }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
    static func year(_ x: Any?) -> String? {
        guard let s = str(x), let r = s.range(of: #"\d{4}"#, options: .regularExpression) else { return nil }
        return String(s[r])
    }
    /// TMDB artwork is shortened to "~file" like the web app does
    static func art(_ x: Any?) -> String? {
        guard let s = str(x) else { return nil }
        if let r = s.range(of: #"^https?://image\.tmdb\.org/t/p/[^/]+/([^/?#]+)$"#, options: .regularExpression), r.lowerBound == s.startIndex {
            return "~" + (s.split(separator: "/").last.map(String.init) ?? "")
        }
        return s
    }
    private static func firstArt(_ x: Any?) -> String? {
        if let a = x as? [Any] { return art(a.first) }
        return art(x)
    }

    struct Result: Sendable { var channels: [Channel]; var movies: [Movie]; var series: [Show]; var account: Account }

    static func load(_ src: Source, ua: String, progress: @Sendable (String) -> Void) async throws -> Result {
        guard src.server?.isEmpty == false, src.username?.isEmpty == false, src.password?.isEmpty == false else {
            throw LumenError.message("Server, username and password are required.")
        }
        let b = api(src)
        progress("\(src.name): signing in…")
        let auth = try await Net.json(b, ua: ua) as? [String: Any]
        guard let ui = auth?["user_info"] as? [String: Any], num(ui["auth"]) != 0 else {
            throw LumenError.message("Login failed. Check your username and password.")
        }
        if let st = str(ui["status"]), st != "Active" { throw LumenError.message("Account is \(st).") }
        let account = Account(status: str(ui["status"]), expires: num(ui["exp_date"]).map { Date(timeIntervalSince1970: $0) },
                              maxConnections: num(ui["max_connections"]).map(Int.init), activeConnections: num(ui["active_cons"]).map(Int.init))

        progress("\(src.name): loading categories…")
        @Sendable func act(_ a: String) async -> [String: String] {
            var m: [String: String] = [:]
            for x in arr(try? await Net.json("\(b)&action=\(a)", ua: ua)) { m["\(x["category_id"] ?? "")"] = str(x["category_name"]) ?? "Uncategorized" }
            return m
        }
        async let lc = act("get_live_categories")
        async let vc = act("get_vod_categories")
        async let sc = act("get_series_categories")
        let (lcm, vcm, scm) = (await lc, await vc, await sc)
        func cat(_ m: [String: String], _ v: Any?) -> String { m["\(v ?? "")"] ?? "Uncategorized" }

        progress("\(src.name): loading channels (1/3)…")
        let live = arr(try await Net.json("\(b)&action=get_live_streams", ua: ua))
        let channels: [Channel] = live.compactMap { s in
            guard let sid = num(s["stream_id"]).map(Int.init) else { return nil }
            return Channel(id: "\(src.id):l\(sid)", sourceId: src.id, name: str(s["name"]) ?? "Channel", group: cat(lcm, s["category_id"]),
                           logo: str(s["stream_icon"]), epgId: str(s["epg_channel_id"]), num: num(s["num"]).map(Int.init), sid: sid)
        }
        progress("\(src.name): loading movies (2/3)…")
        let vod = arr(try await Net.json("\(b)&action=get_vod_streams", ua: ua))
        let movies: [Movie] = vod.compactMap { s in
            guard let vid = num(s["stream_id"]).map(Int.init) else { return nil }
            let r = num(s["rating"])
            return Movie(id: "\(src.id):m\(vid)", sourceId: src.id, name: str(s["name"]) ?? "Movie", group: cat(vcm, s["category_id"]),
                         ext: str(s["container_extension"]) ?? "mp4", poster: art(s["stream_icon"]), rating: (r ?? 0) > 0 ? r : nil,
                         year: year(s["year"] ?? s["releasedate"]), added: num(s["added"]), vodId: vid, tmdb: num(s["tmdb"] ?? s["tmdb_id"]).map(Int.init))
        }
        progress("\(src.name): loading series (3/3)…")
        let ser = arr(try await Net.json("\(b)&action=get_series", ua: ua))
        let series: [Show] = ser.compactMap { s in
            guard let id = num(s["series_id"]).map(Int.init) else { return nil }
            let r = num(s["rating"])
            return Show(id: "\(src.id):s\(id)", sourceId: src.id, name: str(s["name"]) ?? "Series", group: cat(scm, s["category_id"]),
                        poster: art(s["cover"]), backdrop: firstArt(s["backdrop_path"]), rating: (r ?? 0) > 0 ? r : nil,
                        year: year(s["releaseDate"] ?? s["release_date"]), added: num(s["last_modified"]), seriesId: id,
                        tmdb: num(s["tmdb"] ?? s["tmdb_id"]).map(Int.init))
        }
        return Result(channels: channels, movies: movies, series: series, account: account)
    }

    static func info(_ src: Source, kind: MediaKind, id: Int, ua: String) async throws -> MediaInfo {
        let b = api(src)
        if kind == .movie {
            let r = try await Net.json("\(b)&action=get_vod_info&vod_id=\(id)", ua: ua) as? [String: Any]
            let i = r?["info"] as? [String: Any] ?? [:]
            let rating = num(i["rating"])
            return MediaInfo(plot: str(i["plot"]) ?? str(i["description"]), backdrop: firstArt(i["backdrop_path"]), poster: str(i["movie_image"]),
                             cast: str(i["cast"]) ?? str(i["actors"]), director: str(i["director"]), genre: str(i["genre"]),
                             duration: str(i["duration"]), rating: (rating ?? 0) > 0 ? rating : nil, year: year(i["releasedate"] ?? i["release_date"]))
        }
        let r = try await Net.json("\(b)&action=get_series_info&series_id=\(id)", ua: ua) as? [String: Any]
        let i = r?["info"] as? [String: Any] ?? [:]
        var episodes: [Episode] = []
        if let eps = r?["episodes"] as? [String: Any] {
            for (season, list) in eps {
                for e in arr(list) {
                    let eid = "\(e["id"] ?? "")"
                    let info = e["info"] as? [String: Any]
                    let num = num(e["episode_num"]).map(Int.init) ?? 0
                    episodes.append(Episode(id: eid, title: str(e["title"]) ?? "Episode \(num)",
                                            season: Self.num(e["season"]).map(Int.init) ?? Int(season) ?? 0, episode: num,
                                            url: streamUrl(src, kind: "series", id: eid, ext: str(e["container_extension"]) ?? "mp4"),
                                            plot: str(info?["plot"]), still: str(info?["movie_image"]), duration: str(info?["duration"])))
                }
            }
        }
        episodes.sort { ($0.season, $0.episode) < ($1.season, $1.episode) }
        let rating = num(i["rating"])
        return MediaInfo(plot: str(i["plot"]), backdrop: firstArt(i["backdrop_path"]), poster: str(i["cover"]), cast: str(i["cast"]),
                         director: str(i["director"]), genre: str(i["genre"]), rating: (rating ?? 0) > 0 ? rating : nil,
                         year: year(i["releaseDate"] ?? i["release_date"]), episodes: episodes)
    }
}

// MARK: - XMLTV

/// Streams an XMLTV document and keeps programmes from 3 hours ago to 36 hours ahead, keyed by XMLTV channel id (lowercased).
nonisolated final class XMLTVParser: NSObject, XMLParserDelegate {
    private(set) var programmes: [String: [Programme]] = [:]
    /// display-name (lowercased) → channel id
    private(set) var names: [String: String] = [:]
    private var current: (channel: String, start: Date, stop: Date)?
    private var channelId: String?
    private var element = ""
    private var text = ""
    private var title = ""
    private var desc = ""
    private let from = Date.now.addingTimeInterval(-3 * 3600)
    private let until = Date.now.addingTimeInterval(36 * 3600)

    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyyMMddHHmmss Z"
        return f
    }()
    private static let formatterNoZone: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyyMMddHHmmss"
        return f
    }()
    static func date(_ s: String) -> Date? {
        let t = s.trimmingCharacters(in: .whitespaces)
        return formatter.date(from: t) ?? formatterNoZone.date(from: String(t.prefix(14)))
    }

    static func parse(_ data: Data) -> XMLTVParser {
        let p = XMLTVParser()
        let parser = XMLParser(data: data)
        parser.delegate = p
        parser.parse()
        for k in p.programmes.keys { p.programmes[k]?.sort { $0.start < $1.start } }
        return p
    }

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes a: [String: String] = [:]) {
        element = name
        text = ""
        switch name {
        case "channel": channelId = a["id"]?.lowercased()
        case "programme":
            if let ch = a["channel"]?.lowercased(), let s = a["start"].flatMap(Self.date), let e = a["stop"].flatMap(Self.date), e > from, s < until {
                current = (ch, s, e)
            } else { current = nil }
            title = ""; desc = ""
        default: break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) { text += string }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        switch name {
        case "display-name": if let id = channelId { names[text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()] = id }
        case "channel": channelId = nil
        case "title": if current != nil && title.isEmpty { title = text.trimmingCharacters(in: .whitespacesAndNewlines) }
        case "desc": if current != nil && desc.isEmpty { desc = text.trimmingCharacters(in: .whitespacesAndNewlines) }
        case "programme":
            if let c = current {
                programmes[c.channel, default: []].append(Programme(start: c.start, stop: c.stop, title: title.isEmpty ? "Untitled" : title, desc: desc.isEmpty ? nil : desc))
            }
            current = nil
        default: break
        }
        text = ""
    }
}
