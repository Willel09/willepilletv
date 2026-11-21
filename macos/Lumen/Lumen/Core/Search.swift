// Ranked search with typo tolerance, provider-tag stripping and the "Remove BS" filter.
import Foundation

nonisolated enum SearchKit {
    /// "EN | Spider-Man: No Way Home (2021) [4K]" → "spider man no way home"
    static func normalize(_ s: String) -> String {
        var t = s.lowercased().folding(options: [.diacriticInsensitive, .widthInsensitive], locale: nil)
        // provider tags like "EN |", "SC-[4K-Q] -", "[1080p]", "(2016)"
        t = t.replacingOccurrences(of: #"^\s*[a-z0-9]{1,4}\s*[|:-]\s+"#, with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: #"[\[\(][^\]\)]*[\]\)]"#, with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: #"\b(4k|uhd|fhd|hd|sd|1080p|720p|2160p|hevc|x265|h264|multi|sub|dub)\b"#, with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: #"[^a-z0-9]+"#, with: " ", options: .regularExpression)
        return t.trimmingCharacters(in: .whitespaces)
    }

    /// Display title without provider prefixes and quality brackets.
    static func cleanTitle(_ s: String) -> String {
        var t = s.replacingOccurrences(of: #"^\s*[A-Za-z0-9]{1,4}\s*[|]\s*"#, with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: #"^\s*[A-Z]{2,3}-\[[^\]]*\]\s*-\s*"#, with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: #"\s*\[(4K|UHD|FHD|HD|SD|1080p|720p|MULTI)[^\]]*\]"#, with: "", options: [.regularExpression, .caseInsensitive])
        t = t.replacingOccurrences(of: #"\s*\((19|20)\d{2}\)\s*$"#, with: "", options: .regularExpression)
        return t.trimmingCharacters(in: .whitespaces)
    }

    static func levenshtein(_ a: [Character], _ b: [Character], limit: Int) -> Int {
        if abs(a.count - b.count) > limit { return limit + 1 }
        var prev = Array(0...b.count)
        for i in 1...max(1, a.count) where !a.isEmpty {
            var cur = [i] + Array(repeating: 0, count: b.count)
            var best = cur[0]
            for j in 1...max(1, b.count) where !b.isEmpty {
                cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1))
                best = min(best, cur[j])
            }
            if best > limit { return limit + 1 }
            prev = cur
        }
        return prev[b.count]
    }

    /// 0 = no match. Exact > starts with > all words > contains > close spelling.
    static func score(query q: String, qWords: [String], title t: String) -> Int {
        if t == q { return 1000 }
        if t.hasPrefix(q) { return 800 - min(200, t.count) }
        let tWords = t.split(separator: " ").map(String.init)
        if qWords.allSatisfy({ w in tWords.contains { $0.hasPrefix(w) } }) { return 600 - min(200, t.count) }
        if t.contains(q) { return 400 }
        // squashed ("spiderman" ↔ "spider man")
        let squashed = t.replacingOccurrences(of: " ", with: "")
        if squashed.contains(q.replacingOccurrences(of: " ", with: "")) { return 350 }
        // typo tolerance on the first words
        if q.count >= 5 {
            let limit = q.count >= 9 ? 2 : 1
            let prefix = Array(squashed.prefix(q.count + 1))
            let qa = Array(q.replacingOccurrences(of: " ", with: ""))
            if levenshtein(qa, Array(prefix.prefix(qa.count)), limit: limit) <= limit { return 200 }
            for w in tWords where w.count >= 4 && levenshtein(qa, Array(w), limit: limit) <= limit { return 150 }
        }
        return 0
    }

    static func search(_ query: String, in items: [Item], limit: Int = 120) -> [Item] {
        let q = normalize(query)
        guard !q.isEmpty else { return [] }
        let words = q.split(separator: " ").map(String.init)
        var scored: [(Int, Item)] = []
        scored.reserveCapacity(256)
        for item in items {
            let s = score(query: q, qWords: words, title: normalize(item.name))
            if s > 0 { scored.append((s + Int((item.rating ?? 0) * 2), item)) }
        }
        return scored.sorted { $0.0 > $1.0 }.prefix(limit).map(\.1)
    }

    // MARK: Remove BS — hide Arabic and Indian content (script, language names, country tags)

    private static let bsRegex = try! NSRegularExpression(
        pattern: #"[\x{0600}-\x{06FF}\x{0900}-\x{0DFF}]|\b(arab(ic)?|hindi|tamil|telugu|malayalam|kannada|punjabi|bengali|urdu|marathi|gujarati|bollywood|tollywood|mbc|osn|rotana|zee|star plus|sony sab|colors tv)\b|^\s*(ar|in|ind|pk|af|ae|sa|eg|ma|dz|tn|iq|sy|lb|jo|kw|qa|bh|om|ye)\s*[|:-]"#,
        options: [.caseInsensitive])

    static func isBs(name: String, group: String) -> Bool {
        let s = "\(group) \(name)"
        return bsRegex.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil
            || bsRegex.firstMatch(in: group, range: NSRange(location: 0, length: (group as NSString).length)) != nil
    }
}
