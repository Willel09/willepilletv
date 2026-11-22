// Cross-device sync, compatible with the Windows / TV / web app: everything is encrypted on the device
// (AES-256-GCM, key from the sync code with PBKDF2-SHA256), rows are addressed by SHA-256 of the code.
import Foundation
import CryptoKit
import CommonCrypto

typealias JSON = [String: Any]

nonisolated struct SyncMetaT: Codable, Sendable {
    var at: [String: Double] = [:]
    var tomb: [String: Double] = [:]
}

nonisolated struct SyncFile: Codable, Sendable {
    var code: String = ""
    var lastSync: Date?
    var meta = SyncMetaT()
    var profileMeta = SyncMetaT()
    var customMeta = SyncMetaT()
    var lastPrefs: [String: String] = [:]
    var raw: [String: String] = [:]   // item id -> JSON text, for titles this Mac doesn't have in its library
}

nonisolated enum SyncCrypto {
    static let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
    static func random(_ n: Int) -> String {
        var rng = SystemRandomNumberGenerator()
        return String((0..<n).map { _ in alphabet[Int(rng.next() % 32)] })
    }
    static func group(_ s: String) -> String { stride(from: 0, to: s.count, by: 4).map { String(Array(s)[$0..<min($0 + 4, s.count)]) }.joined(separator: "-") }
    static func normalize(_ c: String) -> String { String(c.uppercased().filter { $0.isLetter && $0.isASCII || $0.isNumber }) }
    static func newSyncCode() -> String { group(random(20)) }
    static func newPairCode() -> String { group(random(12)) }
    static func hex(_ d: some Sequence<UInt8>) -> String { d.map { String(format: "%02x", $0) }.joined() }
    static func sha(_ s: String) -> String { hex(SHA256.hash(data: Data(s.utf8))) }

    struct Box: Sendable {
        let id: String
        let key: SymmetricKey
        func sealBytes(_ d: Data) throws -> String { try AES.GCM.seal(d, using: key).combined!.base64EncodedString() }
        func openBytes(_ s: String) throws -> Data {
            guard let raw = Data(base64Encoded: s) else { throw SyncError.decrypt }
            return try AES.GCM.open(try AES.GCM.SealedBox(combined: raw), using: key)
        }
        func seal(_ obj: Any) throws -> String { try sealBytes(try JSONSerialization.data(withJSONObject: obj)) }
        func open(_ s: String) throws -> Any { try JSONSerialization.jsonObject(with: try openBytes(s), options: [.fragmentsAllowed]) }
    }

    nonisolated(unsafe) private static var boxes: [String: Box] = [:]
    private static let lock = NSLock()

    static func derive(_ code: String, purpose: String) -> Box {
        let secret = normalize(code)
        let k = "\(purpose):\(secret)"
        lock.lock(); defer { lock.unlock() }
        if let b = boxes[k] { return b }
        var out = [UInt8](repeating: 0, count: 32)
        let salt = Array("lumen-\(purpose)-v1".utf8), pass = Array(secret.utf8)
        CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pass.map { Int8(bitPattern: $0) }, pass.count, salt, salt.count,
                             CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 150_000, &out, 32)
        let b = Box(id: sha("lumen-\(k)"), key: SymmetricKey(data: out))
        boxes[k] = b
        return b
    }
}

nonisolated enum SyncError: LocalizedError {
    case offline, slow, status(Int), decrypt, tooLarge
    var errorDescription: String? {
        switch self {
        case .offline: "Sync server unreachable. Check your internet connection."
        case .slow: "The sync server took too long to answer."
        case .status(let c): "Sync failed (\(c))"
        case .decrypt: "Couldn't decrypt synced data. Is the sync code correct?"
        case .tooLarge: "That playlist file is too large to sync."
        }
    }
}

nonisolated enum SyncServer {
    static let base = "https://cbqjczxbcodebmgawknz.supabase.co/rest/v1/rpc"
    static let key = "sb_publishable_FyC8lK8Cz_QkvHemKUnkCA_SNL85fh0"

    static func rpc(_ fn: String, _ body: JSON) async throws -> Any? {
        var req = URLRequest(url: URL(string: "\(base)/\(fn)")!)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue(key, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let data: Data, resp: URLResponse
        do { (data, resp) = try await URLSession.shared.data(for: req) }
        catch let e as URLError { throw e.code == .timedOut ? SyncError.slow : SyncError.offline }
        guard let h = resp as? HTTPURLResponse else { throw SyncError.offline }
        guard (200..<300).contains(h.statusCode) else { throw SyncError.status(h.statusCode) }
        if h.statusCode == 204 || data.isEmpty { return nil }
        return try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    static func get(_ id: String) async throws -> (data: String, at: String)? {
        guard let rows = try await rpc("sync_get", ["p_id": id]) as? [JSON], let r = rows.first, let d = r["data"] as? String else { return nil }
        return (d, r["updated_at"] as? String ?? "")
    }
    static func put(_ id: String, _ data: String, ttl: Int? = nil) async throws {
        var b: JSON = ["p_id": id, "p_data": data]
        if let ttl { b["p_ttl_seconds"] = ttl }
        _ = try await rpc("sync_put", b)
    }
    /// false = another device wrote in between
    static func putIf(_ id: String, _ data: String, expect: String?) async throws -> Bool {
        let r = try await rpc("sync_put_if", ["p_id": id, "p_data": data, "p_expect": expect as Any? ?? NSNull()])
        return r != nil && !(r is NSNull)
    }
    static func delete(_ id: String) async throws { _ = try await rpc("sync_delete", ["p_id": id]) }

    static func sendPairing(pairCode: String, syncCode: String) async throws {
        let box = SyncCrypto.derive(pairCode, purpose: "pair")
        try await put(box.id, try box.seal(["code": syncCode]), ttl: 600)
    }
    static func receivePairing(pairCode: String) async throws -> String? {
        let box = SyncCrypto.derive(pairCode, purpose: "pair")
        guard let row = try await get(box.id), let o = try box.open(row.data) as? JSON, let code = o["code"] as? String else { return nil }
        try await delete(box.id)
        return code
    }

    // playlist files added on the PC
    static func fileId(_ code: String, _ source: String, _ part: String) -> String { SyncCrypto.sha("lumen-file:\(SyncCrypto.normalize(code)):\(source):\(part)") }
    static func pullFile(code: String, sourceId: String) async throws -> String? {
        let box = SyncCrypto.derive(code, purpose: "sync")
        guard let h = try await get(fileId(code, sourceId, "head")), let head = try box.open(h.data) as? JSON,
              let sig = head["sig"] as? String, let n = head["n"] as? Int else { return nil }
        var all = Data()
        for i in 0..<n {
            var row = try await get(fileId(code, sourceId, "\(sig):\(i)"))
            if row == nil { row = try await get(fileId(code, sourceId, String(i))) }
            guard let row else { throw SyncError.status(404) }
            all.append(try box.openBytes(row.data))
        }
        let raw = Gzip.isGzip(all) ? (Gzip.decompress(all) ?? all) : all
        return String(decoding: raw, as: UTF8.self)
    }
}

// MARK: - Merge (same per-item last-writer-wins rules as the Windows app)

nonisolated struct SyncDocT {
    var colls: [String: [JSON]] = [:]
    var prefs: JSON = [:]
    var meta = SyncMetaT()
}

nonisolated enum SyncMerge {
    static let tombTTL = 90.0 * 86400_000
    static func key(_ c: String, _ id: String) -> String { "\(c):\(id)" }

    static func merge(_ local: SyncDocT, _ remote: SyncDocT?, collections: [String], keepOrder: Set<String> = ["sources"], localFirstFavorites: Bool = true) -> SyncDocT {
        guard let remote else { return local }
        var meta = SyncMetaT()
        let now = Date().timeIntervalSince1970 * 1000
        for (k, t) in local.meta.tomb.merging(remote.meta.tomb, uniquingKeysWith: { max($0, $1) }) where now - t < tombTTL { meta.tomb[k] = t }
        var out = SyncDocT()
        for c in collections {
            var byId: [String: (item: JSON, at: Double)] = [:]
            var order: [String] = []
            for doc in [local, remote] {
                for item in doc.colls[c] ?? [] {
                    guard let id = item["id"] as? String else { continue }
                    let at = doc.meta.at[key(c, id)] ?? 1
                    if let cur = byId[id] { if at > cur.at { byId[id] = (item, at) } }
                    else { byId[id] = (item, at); order.append(id) }
                }
            }
            var kept = order.compactMap { id -> (item: JSON, at: Double)? in
                guard let e = byId[id], e.at > (meta.tomb[key(c, id)] ?? 0) else { return nil }
                return e
            }
            if c == "favorites" && localFirstFavorites {
                let mine = Set((local.colls[c] ?? []).compactMap { $0["id"] as? String })
                kept = kept.filter { !mine.contains($0.item["id"] as! String) } + kept.filter { mine.contains($0.item["id"] as! String) }
            } else if !keepOrder.contains(c) {
                kept.sort { $0.at > $1.at }
            }
            if c == "history" && kept.count > 300 { kept.removeLast(kept.count - 300) }
            for e in kept { meta.at[key(c, e.item["id"] as! String)] = e.at }
            out.colls[c] = kept.map(\.item)
        }
        let lp = local.meta.at["prefs"] ?? 0, rp = remote.meta.at["prefs"] ?? 0
        out.prefs = rp > lp ? remote.prefs : local.prefs
        meta.at["prefs"] = max(lp, rp)
        out.meta = meta
        return out
    }

    /// Meta keys starting with `from`, renamed to start with `to`
    static func remeta(_ m: SyncMetaT, from: String, to: String) -> SyncMetaT {
        func pick(_ r: [String: Double]) -> [String: Double] {
            Dictionary(uniqueKeysWithValues: r.filter { $0.key.hasPrefix(from) }.map { (to + $0.key.dropFirst(from.count), $0.value) })
        }
        return SyncMetaT(at: pick(m.at), tomb: pick(m.tomb))
    }
}

// MARK: - Engine

@MainActor
final class SyncEngine {
    private var file = SyncFile()
    private var running = false
    private var raw: [String: JSON] = [:]

    func restore(_ f: SyncFile) {
        file = f
        raw = f.raw.compactMapValues { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? JSON }
    }
    func snapshot(code: String, lastSync: Date?) -> SyncFile {
        var f = file; f.code = code; f.lastSync = lastSync
        f.raw = Dictionary(uniqueKeysWithValues: raw.prefix(1500).compactMap { k, v in (try? JSONSerialization.data(withJSONObject: v)).map { (k, String(decoding: $0, as: UTF8.self)) } })
        return f
    }
    func reset() { file = SyncFile(); raw = [:] }

    // MARK: conversions

    private func encodeJSON<T: Encodable>(_ v: T) -> JSON {
        guard let d = try? JSONEncoder().encode(v), let o = try? JSONSerialization.jsonObject(with: d) as? JSON else { return [:] }
        return o
    }

    private func itemJSON(_ id: String, model: AppModel) -> JSON? {
        if let it = model.item(id) {
            var j: JSON
            switch it {
            case .live(let c): j = encodeJSON(c); j["kind"] = "live"
            case .movie(let m): j = encodeJSON(m); j["kind"] = "movie"
            case .series(var s): s.episodes = nil; j = encodeJSON(s); j["kind"] = "series"
            }
            raw[id] = j
            return j
        }
        return raw[id]
    }

    private func historyJSON(_ h: HistoryEntry) -> JSON {
        var j: JSON = ["id": h.kind == "episode" ? h.id.replacingOccurrences(of: "|", with: ":") : h.id, "kind": h.kind, "name": h.name,
                       "url": h.url ?? "", "position": h.position, "duration": h.duration, "updatedAt": (h.watchedAt.timeIntervalSince1970 * 1000).rounded()]
        if let s = h.subtitle { j["subtitle"] = s }
        if let a = h.artwork { j["poster"] = a }
        if h.kind == "episode" { j["parentId"] = h.itemId }
        return j
    }

    private func historyFrom(_ j: JSON) -> HistoryEntry? {
        guard let id = j["id"] as? String, let kind = j["kind"] as? String, let name = j["name"] as? String else { return nil }
        let parent = j["parentId"] as? String ?? (kind == "episode" ? String(id.split(separator: ":").first ?? "") : id)
        let hid = kind == "episode" ? (parent + "|" + id.dropFirst(parent.count + 1)) : id
        let ms = (j["updatedAt"] as? Double) ?? Date().timeIntervalSince1970 * 1000
        var h = HistoryEntry(id: hid, kind: kind, itemId: kind == "episode" ? parent : id, name: name, subtitle: j["subtitle"] as? String,
                             artwork: j["poster"] as? String, position: (j["position"] as? Double) ?? 0, duration: (j["duration"] as? Double) ?? 0,
                             watchedAt: Date(timeIntervalSince1970: ms / 1000))
        h.url = (j["url"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        return h
    }

    private static let prefKeys = ["theme", "accent", "ambient", "epgUrl", "autoProviderEpg", "hiddenGroups", "removeBs", "liveFormat", "autoplayNext", "omdbKey", "tmdbKey"]

    private func prefsJSON(_ s: AppSettings) -> JSON {
        ["theme": s.theme, "accent": s.accentOverride, "ambient": s.ambient.rawValue, "epgUrl": s.epgUrl, "autoProviderEpg": s.autoProviderEpg,
         "hiddenGroups": s.hiddenGroups, "removeBs": s.removeBs, "liveFormat": s.liveFormat.rawValue, "autoplayNext": s.autoplayNext,
         "omdbKey": s.omdbKey, "tmdbKey": s.tmdbKey]
    }
    private func applyPrefs(_ p: JSON, to s: inout AppSettings) {
        if let v = p["theme"] as? String { s.theme = v }
        if let v = p["accent"] as? String { s.accentOverride = v }
        if let v = p["ambient"] as? String, let a = AppSettings.Ambient(rawValue: v) { s.ambient = a }
        if let v = p["epgUrl"] as? String { s.epgUrl = v }
        if let v = p["autoProviderEpg"] as? Bool { s.autoProviderEpg = v }
        if let v = p["hiddenGroups"] as? String { s.hiddenGroups = v }
        if let v = p["removeBs"] as? Bool { s.removeBs = v }
        if let v = p["liveFormat"] as? String, let f = AppSettings.LiveFormat(rawValue: v) { s.liveFormat = f }
        if let v = p["autoplayNext"] as? Bool { s.autoplayNext = v }
        if let v = p["omdbKey"] as? String { s.omdbKey = v }
        if let v = p["tmdbKey"] as? String { s.tmdbKey = v }
    }
    private func prefsText(_ p: JSON) -> [String: String] { p.mapValues { "\($0)" } }

    /// Tracks changes by comparing what's there now with what the meta already knows.
    private func track(_ meta: inout SyncMetaT, collection c: String, prefix: String = "", ids: [String], times: [String: Double] = [:]) {
        let now = Date().timeIntervalSince1970 * 1000
        let present = Set(ids)
        for id in ids {
            let k = prefix + SyncMerge.key(c, id)
            if let t = times[id] { if t > (meta.at[k] ?? 0) { meta.at[k] = t } }
            else if meta.at[k] == nil { meta.at[k] = now; meta.tomb[k] = nil }
            if (meta.tomb[k] ?? 0) >= (meta.at[k] ?? 0) { meta.at[k] = now; meta.tomb[k] = nil }
        }
        let pre = prefix + c + ":"
        for k in meta.at.keys where k.hasPrefix(pre) && !present.contains(String(k.dropFirst(pre.count))) {
            meta.at[k] = nil; meta.tomb[k] = now
        }
    }

    // MARK: run

    func run(model: AppModel, manual: Bool = false) async {
        let code = model.syncCode
        guard !code.isEmpty, !running else { return }
        running = true
        model.syncing = true
        defer { running = false; model.syncing = false }
        do {
            // build local
            let allLists = model.allProfileLists()
            let mainLists = allLists["main"] ?? ProfileLists()

            var mainDoc = SyncDocT()
            mainDoc.colls["sources"] = model.sources.map { s in
                var j = encodeJSON(s); j["enabled"] = nil; return j.filter { !($0.value is NSNull) }
            }
            mainDoc.colls["favorites"] = mainLists.favorites.compactMap { itemJSON($0, model: model) }
            mainDoc.colls["watchlist"] = mainLists.watchlist.compactMap { itemJSON($0, model: model) }
            mainDoc.colls["history"] = mainLists.history.map(historyJSON)
            mainDoc.meta = file.meta
            for c in ["sources", "favorites", "watchlist"] { track(&mainDoc.meta, collection: c, ids: (mainDoc.colls[c] ?? []).compactMap { $0["id"] as? String }) }
            let hist = mainDoc.colls["history"] ?? []
            track(&mainDoc.meta, collection: "history", ids: hist.compactMap { $0["id"] as? String },
                  times: Dictionary(uniqueKeysWithValues: hist.compactMap { h in (h["id"] as? String).map { ($0, (h["updatedAt"] as? Double) ?? 0) } }))
            let prefs = prefsJSON(model.settings)
            mainDoc.prefs = prefs
            // not on the very first run after linking: this Mac's defaults must not overwrite the settings of the device it links to
            if !file.lastPrefs.isEmpty, prefsText(prefs) != file.lastPrefs { mainDoc.meta.at["prefs"] = Date().timeIntervalSince1970 * 1000 }

            // pull + merge + push main (retry if another device wrote in between)
            let box = SyncCrypto.derive(code, purpose: "sync")
            var merged = mainDoc
            for _ in 0..<3 {
                let row = try await SyncServer.get(box.id)
                var remote: SyncDocT?
                if let row {
                    guard let o = try? box.open(row.data) as? JSON else { throw SyncError.decrypt }
                    remote = docFrom(o)
                }
                merged = SyncMerge.merge(mainDoc, remote, collections: ["sources", "favorites", "watchlist", "history"])
                if try await SyncServer.putIf(box.id, try box.seal(docTo(merged)), expect: row?.at) { break }
            }

            // profiles
            let profilesId = SyncCrypto.sha("lumen-profiles:\(SyncCrypto.normalize(code))")
            var pDoc = SyncDocT(); pDoc.meta = file.profileMeta
            pDoc.colls["sources"] = model.profiles.map { ["id": $0.id, "name": $0.name, "avatar": $0.avatar] }
            track(&pDoc.meta, collection: "sources", prefix: "", ids: model.profiles.map(\.id))
            // profiles keep their meta under "profiles:<id>"
            var pMetaFlat = SyncMetaT()
            pMetaFlat = file.profileMeta
            var profileColls: [String: ProfileLists] = allLists
            profileColls["main"] = nil
            let remotePRow = try await SyncServer.get(profilesId)
            var remoteP: JSON?
            if let remotePRow { remoteP = try box.open(remotePRow.data) as? JSON }
            let (mergedP, mergedPMeta) = mergeProfiles(model: model, profiles: model.profiles, lists: profileColls, meta: &pMetaFlat, remote: remoteP)
            file.profileMeta = mergedPMeta
            if try await SyncServer.putIfNone(profilesId, try box.seal(mergedP.json)) {}

            // custom lists
            let listsId = SyncCrypto.sha("lumen-lists:\(SyncCrypto.normalize(code))")
            let remoteLRow = try await SyncServer.get(listsId)
            var remoteL: JSON?
            if let remoteLRow { remoteL = try box.open(remoteLRow.data) as? JSON }
            let mergedLists = mergeLists(model: model, all: allLists, remote: remoteL)
            try await SyncServer.put(listsId, try box.seal(mergedLists.json))

            // apply to the model
            file.meta = merged.meta
            file.lastPrefs = prefsText(merged.prefs)
            applyAll(model: model, main: merged, profiles: mergedP.profiles, profileLists: mergedP.lists, lists: mergedLists.lists)
            model.lastSync = .now
            model.syncStatus = nil
            let known = Set((merged.colls["sources"] ?? []).compactMap { $0["id"] as? String })
            let saved = (merged.colls["favorites"] ?? []) + (merged.colls["watchlist"] ?? [])
            let lost = saved.filter { !known.contains($0["sourceId"] as? String ?? "") }.count
            let counts = "\(known.count) sources, \((merged.colls["favorites"] ?? []).count) favorites, \((merged.colls["watchlist"] ?? []).count) watchlist, \((merged.colls["history"] ?? []).count) history, \(mergedLists.lists.count) lists"
            model.syncInfo = "On the server: " + counts + (lost > 0 ? ". \(lost) saved titles belong to a source this Mac doesn't have." : "")
            model.saveSyncState()
        } catch {
            model.syncStatus = error.localizedDescription
            if manual { model.toast = error.localizedDescription }
        }
    }

    // MARK: doc <-> JSON

    private func docFrom(_ o: JSON) -> SyncDocT {
        var d = SyncDocT()
        for c in ["sources", "favorites", "watchlist", "history"] { d.colls[c] = (o[c] as? [JSON]) ?? [] }
        d.prefs = (o["prefs"] as? JSON) ?? [:]
        d.meta = metaFrom(o["meta"] as? JSON)
        for c in ["favorites", "watchlist"] { for it in d.colls[c] ?? [] { if let id = it["id"] as? String { raw[id] = it } } }
        return d
    }
    private func docTo(_ d: SyncDocT) -> JSON {
        var o: JSON = ["v": 1]
        for c in ["sources", "favorites", "watchlist", "history"] { o[c] = d.colls[c] ?? [] }
        o["prefs"] = d.prefs
        o["meta"] = metaTo(d.meta)
        return o
    }
    private func metaFrom(_ j: JSON?) -> SyncMetaT {
        SyncMetaT(at: (j?["at"] as? [String: Any])?.compactMapValues { ($0 as? NSNumber)?.doubleValue } ?? [:],
                  tomb: (j?["tomb"] as? [String: Any])?.compactMapValues { ($0 as? NSNumber)?.doubleValue } ?? [:])
    }
    private func metaTo(_ m: SyncMetaT) -> JSON { ["at": m.at, "tomb": m.tomb] }

    // MARK: profiles & lists

    struct ProfilesOut { var profiles: [Profile]; var lists: [String: ProfileLists]; var json: JSON }

    private func mergeProfiles(model: AppModel, profiles: [Profile], lists: [String: ProfileLists], meta: inout SyncMetaT, remote: JSON?) -> (ProfilesOut, SyncMetaT) {
        // local doc
        var local = SyncDocT()
        local.meta = meta
        let people = profiles.map { JSON(dictionaryLiteral: ("id", $0.id), ("name", $0.name), ("avatar", $0.avatar)) }
        track(&local.meta, collection: "profiles", ids: profiles.map(\.id))
        var localData: [String: [String: [JSON]]] = [:]
        for p in profiles where p.id != "main" {
            let l = lists[p.id] ?? ProfileLists()
            let favs = l.favorites.compactMap { itemJSON($0, model: model) }, wl = l.watchlist.compactMap { itemJSON($0, model: model) }, hs = l.history.map(historyJSON)
            localData[p.id] = ["favorites": favs, "watchlist": wl, "history": hs]
            for (c, arr) in localData[p.id]! {
                track(&local.meta, collection: c, prefix: "\(p.id)/", ids: arr.compactMap { $0["id"] as? String },
                      times: c == "history" ? Dictionary(uniqueKeysWithValues: arr.compactMap { h in (h["id"] as? String).map { ($0, (h["updatedAt"] as? Double) ?? 0) } }) : [:])
            }
        }
        // remote
        var remoteDoc: (profiles: [JSON], data: [String: [String: [JSON]]], meta: SyncMetaT)?
        if let r = remote {
            var d: [String: [String: [JSON]]] = [:]
            for (pid, v) in (r["data"] as? [String: Any]) ?? [:] {
                guard let o = v as? JSON else { continue }
                d[pid] = ["favorites": (o["favorites"] as? [JSON]) ?? [], "watchlist": (o["watchlist"] as? [JSON]) ?? [], "history": (o["history"] as? [JSON]) ?? []]
                for c in ["favorites", "watchlist"] { for it in d[pid]![c]! { if let id = it["id"] as? String { raw[id] = it } } }
            }
            remoteDoc = ((r["profiles"] as? [JSON]) ?? [], d, metaFrom(r["meta"] as? JSON))
        }
        // merge profiles themselves (meta keys "profiles:<id>")
        var lp = SyncDocT(); lp.colls["people"] = people
        lp.meta = SyncMerge.remeta(local.meta, from: "profiles:", to: "people:")
        var rp: SyncDocT?
        if let rd = remoteDoc { var d = SyncDocT(); d.colls["people"] = rd.profiles; d.meta = SyncMerge.remeta(rd.meta, from: "profiles:", to: "people:"); rp = d }
        let mp = SyncMerge.merge(lp, rp, collections: ["people"], keepOrder: ["people"])
        let outProfiles = (mp.colls["people"] ?? []).compactMap { j -> Profile? in
            guard let id = j["id"] as? String, let n = j["name"] as? String else { return nil }
            return Profile(id: id, name: n, avatar: (j["avatar"] as? String) ?? "kitty")
        }
        var outMeta = SyncMerge.remeta(mp.meta, from: "people:", to: "profiles:")
        var outData: [String: ProfileLists] = [:]
        var jsonData: JSON = [:]
        for p in outProfiles where p.id != "main" {
            var l = SyncDocT(); l.meta = SyncMerge.remeta(local.meta, from: "\(p.id)/", to: "")
            for c in ["favorites", "watchlist", "history"] { l.colls[c] = localData[p.id]?[c] ?? [] }
            var r: SyncDocT?
            if let rd = remoteDoc, let rdata = rd.data[p.id] { var d = SyncDocT(); d.meta = SyncMerge.remeta(rd.meta, from: "\(p.id)/", to: ""); d.colls = rdata; r = d }
            let m = SyncMerge.merge(l, r, collections: ["favorites", "watchlist", "history"])
            outData[p.id] = ProfileLists(favorites: (m.colls["favorites"] ?? []).compactMap { $0["id"] as? String },
                                         watchlist: (m.colls["watchlist"] ?? []).compactMap { $0["id"] as? String },
                                         history: (m.colls["history"] ?? []).compactMap(historyFrom),
                                         lists: lists[p.id]?.lists ?? [])
            jsonData[p.id] = ["favorites": m.colls["favorites"] ?? [], "watchlist": m.colls["watchlist"] ?? [], "history": m.colls["history"] ?? []]
            var mine = SyncMerge.remeta(SyncMetaT(at: m.meta.at.filter { $0.key != "prefs" }, tomb: m.meta.tomb), from: "", to: "\(p.id)/")
            mine.at.removeValue(forKey: "\(p.id)/prefs")
            outMeta.at.merge(mine.at) { $1 }; outMeta.tomb.merge(mine.tomb) { $1 }
        }
        let json: JSON = ["v": 1, "profiles": mp.colls["people"] ?? [], "data": jsonData, "meta": metaTo(outMeta)]
        return (ProfilesOut(profiles: outProfiles, lists: outData, json: json), outMeta)
    }

    struct ListsOut { var lists: [CustomListSync]; var json: JSON }
    struct CustomListSync { var profile: String; var list: CustomList }

    private func mergeLists(model: AppModel, all: [String: ProfileLists], remote: JSON?) -> ListsOut {
        var local = SyncDocT()
        local.meta = file.customMeta
        var arr: [JSON] = []
        for (pid, l) in all {
            for cl in l.lists { arr.append(["id": cl.id, "profile": pid, "name": cl.name, "items": cl.items.compactMap { itemJSON($0, model: model) }]) }
        }
        local.colls["sources"] = arr
        local.meta = SyncMerge.remeta(file.customMeta, from: "lists:", to: "sources:")
        track(&local.meta, collection: "sources", ids: arr.compactMap { $0["id"] as? String })
        // a list that changed locally gets a fresh timestamp
        for a in arr { if let id = a["id"] as? String, let prev = lastListText[id], prev != "\(a["name"] ?? "")|\((a["items"] as? [JSON])?.count ?? 0)" { local.meta.at["sources:\(id)"] = Date().timeIntervalSince1970 * 1000 } }
        var rd: SyncDocT?
        if let r = remote { var d = SyncDocT(); d.colls["sources"] = (r["lists"] as? [JSON]) ?? []; d.meta = SyncMerge.remeta(metaFrom(r["meta"] as? JSON), from: "lists:", to: "sources:"); rd = d
            for l in d.colls["sources"] ?? [] { for it in (l["items"] as? [JSON]) ?? [] { if let id = it["id"] as? String { raw[id] = it } } } }
        let m = SyncMerge.merge(local, rd, collections: ["sources"], keepOrder: ["sources"])
        file.customMeta = SyncMerge.remeta(m.meta, from: "sources:", to: "lists:")
        let out = (m.colls["sources"] ?? []).compactMap { j -> CustomListSync? in
            guard let id = j["id"] as? String, let n = j["name"] as? String else { return nil }
            lastListText[id] = "\(n)|\((j["items"] as? [JSON])?.count ?? 0)"
            return CustomListSync(profile: (j["profile"] as? String) ?? "main", list: CustomList(id: id, name: n, items: ((j["items"] as? [JSON]) ?? []).compactMap { $0["id"] as? String }))
        }
        return ListsOut(lists: out, json: ["v": 1, "lists": m.colls["sources"] ?? [], "meta": metaTo(file.customMeta)])
    }
    private var lastListText: [String: String] = [:]

    // MARK: apply

    private func applyAll(model: AppModel, main: SyncDocT, profiles: [Profile], profileLists: [String: ProfileLists], lists: [CustomListSync]) {
        // sources: keep Mac-only fields
        let existing = Dictionary(uniqueKeysWithValues: model.sources.map { ($0.id, $0) })
        let srcs: [Source] = (main.colls["sources"] ?? []).compactMap { j in
            guard let d = try? JSONSerialization.data(withJSONObject: j), var s = try? JSONDecoder().decode(Source.self, from: d) else { return nil }
            if let e = existing[s.id] { s.enabled = e.enabled }
            return s
        }
        // never wipe the local list because entries failed to decode
        let incoming = main.colls["sources"] ?? []
        if srcs.count == incoming.count, srcs != model.sources { model.applyingSync = true; model.sources = srcs; model.applyingSync = false; if !srcs.isEmpty { Task { await model.refreshAfterSync() } } }
        // prefs
        var st = model.settings
        applyPrefs(main.prefs, to: &st)
        if st != model.settings { model.settings = st }
        // main lists
        var all = profileLists
        var mainL = ProfileLists()
        mainL.favorites = (main.colls["favorites"] ?? []).compactMap { $0["id"] as? String }
        mainL.watchlist = (main.colls["watchlist"] ?? []).compactMap { $0["id"] as? String }
        mainL.history = (main.colls["history"] ?? []).compactMap(historyFrom)
        all["main"] = mainL
        for (pid, l) in all { all[pid]?.lists = lists.filter { $0.profile == pid }.map(\.list); _ = l }
        model.applySynced(profiles: profiles.isEmpty ? [.main] : profiles, lists: all)
    }
}

extension SyncServer {
    static func putIfNone(_ id: String, _ data: String) async throws -> Bool { try await put(id, data); return true }
}
