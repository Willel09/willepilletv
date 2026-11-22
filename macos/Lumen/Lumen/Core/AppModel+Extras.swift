// Profiles, custom lists, "new episodes", Home rows, sync scheduling, background tasks.
import Foundation
import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

nonisolated struct ProfilesFile: Codable, Sendable {
    var profiles: [Profile]
    var active: String
    var stash: [String: ProfileLists]
}

extension AppModel {
    nonisolated static var supportURL: URL {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Lumen", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    // MARK: Profiles

    private func currentLists() -> ProfileLists {
        ProfileLists(favorites: user.favorites, watchlist: user.watchlist, history: user.history, lists: user.lists)
    }
    private func load(_ l: ProfileLists) {
        user.favorites = l.favorites; user.watchlist = l.watchlist; user.history = l.history; user.lists = l.lists
    }
    func allProfileLists() -> [String: ProfileLists] {
        var all = stash
        all[activeProfile] = currentLists()
        for p in profiles where all[p.id] == nil { all[p.id] = ProfileLists() }
        return all
    }

    func switchProfile(_ id: String) {
        guard id != activeProfile, profiles.contains(where: { $0.id == id }) else { pickingProfile = false; return }
        stash[activeProfile] = currentLists()
        load(stash[id] ?? ProfileLists())
        stash[id] = nil
        activeProfile = id
        pickingProfile = false
        selection = .home; path = NavigationPath()
        publishWidgets(); refreshHomeRows()
    }

    func saveProfile(_ p: Profile) {
        if let i = profiles.firstIndex(where: { $0.id == p.id }) { profiles[i] = p } else { profiles.append(p) }
    }

    func deleteProfile(_ id: String) {
        guard id != "main", profiles.count > 1 else { return }
        if activeProfile == id { switchProfile("main") }
        stash[id] = nil
        profiles.removeAll { $0.id == id }
    }

    /// Replaces profiles and everyone's lists with what sync merged.
    func applySynced(profiles newProfiles: [Profile], lists: [String: ProfileLists]) {
        applyingSync = true
        defer { applyingSync = false }
        if newProfiles != profiles { profiles = newProfiles }
        if !profiles.contains(where: { $0.id == activeProfile }) { activeProfile = "main" }
        var s = lists
        let mine = s[activeProfile] ?? ProfileLists()
        s[activeProfile] = nil
        stash = s
        saveProfilesNow()
        // avoid pointless writes (and sync loops) when nothing changed
        if mine.favorites != user.favorites { user.favorites = mine.favorites }
        if mine.watchlist != user.watchlist { user.watchlist = mine.watchlist }
        if mine.history != user.history { user.history = mine.history }
        if mine.lists != user.lists { user.lists = mine.lists }
        publishWidgets(); refreshHomeRows()
    }

    // MARK: Custom lists

    @discardableResult
    func createList(_ name: String, first: String? = nil) -> CustomList {
        let l = CustomList(name: name, items: first.map { [$0] } ?? [])
        user.lists.append(l)
        toast = "Created “\(name)”"
        return l
    }
    func toggleInList(_ listId: String, _ itemId: String) {
        guard let i = user.lists.firstIndex(where: { $0.id == listId }) else { return }
        if let j = user.lists[i].items.firstIndex(of: itemId) { user.lists[i].items.remove(at: j); toast = "Removed from \(user.lists[i].name)" }
        else { user.lists[i].items.insert(itemId, at: 0); toast = "Added to \(user.lists[i].name)" }
    }
    func deleteList(_ id: String) { user.lists.removeAll { $0.id == id } }
    func items(in list: CustomList) -> [Item] { list.items.compactMap { item($0) } }

    // MARK: New episodes ("seen" is kept on this Mac only)

    private var seenMap: [String: Double] {
        get { UserDefaults.standard.dictionary(forKey: "lumen.seen") as? [String: Double] ?? [:] }
        set { UserDefaults.standard.set(newValue, forKey: "lumen.seen") }
    }
    func markSeen(_ id: String) { var m = seenMap; m[id] = Date.now.timeIntervalSince1970; seenMap = m }

    func hasNewEpisodes(_ s: Show) -> Bool {
        guard let added = s.added, added > 0 else { return false }
        var m = seenMap
        let seen: Double
        if let t = m[s.id] { seen = t } else { m[s.id] = Date.now.timeIntervalSince1970; seenMap = m; return false }
        let watched = user.history.filter { $0.kind == "episode" && $0.itemId == s.id }.map { $0.watchedAt.timeIntervalSince1970 }.max() ?? 0
        return added > max(seen, watched)
    }

    var followedSeries: [Show] {
        var seen = Set<String>()
        var out: [Show] = []
        let ids = user.watchlist + user.favorites + user.history.filter { $0.kind == "episode" }.map(\.itemId)
        for id in ids where seen.insert(id).inserted { if case .series(let s) = item(id) { out.append(s) } }
        return out
    }
    var newEpisodeShows: [Show] { followedSeries.filter(hasNewEpisodes).sorted { ($0.added ?? 0) > ($1.added ?? 0) }.prefix(30).map { $0 } }

    // MARK: Home rows

    /// What you watched or saved, newest first (the signals for recommendations).
    var homeSignals: [Item] {
        var seen = Set<String>(); var out: [Item] = []
        let ids = user.history.filter { $0.kind != "live" }.map(\.itemId) + user.watchlist + user.favorites
        for id in ids where seen.insert(id).inserted { if let it = item(id), it.kind != .live { out.append(it) } }
        return Array(out.prefix(12))
    }

    func refreshHomeRows() {
        let signals = homeSignals
        let ms = movies, ss = series
        forYouTask?.cancel()
        forYouTask = Task {
            let ids = Task.detached(priority: .utility) { () -> [Item] in
                guard !signals.isEmpty else { return [] }
                var weight: [String: Double] = [:]
                for (i, s) in signals.enumerated() { weight[s.group, default: 0] += 1 / (1 + Double(i) * 0.15) }
                let seen = Set(signals.map(\.id))
                let newest = max(1, ms.prefix(5000).compactMap(\.added).max() ?? 1, ss.prefix(5000).compactMap(\.added).max() ?? 1)
                var best: [(Item, Double)] = []
                func offer(_ it: Item, _ poster: String?, _ rating: Double?, _ added: Double?) {
                    guard poster != nil, !seen.contains(it.id), let g = weight[it.group] else { return }
                    let s = g + ((rating ?? 6) - 6) * 0.15 + ((added ?? 0) / newest) * 0.3
                    if best.count == 30, s <= best[29].1 { return }
                    let at = best.firstIndex { $0.1 < s } ?? best.count
                    best.insert((it, s), at: at)
                    if best.count > 30 { best.removeLast() }
                }
                for m in ms { offer(.movie(m), m.poster, m.rating, m.added) }
                for s in ss { offer(.series(s), s.poster, s.rating, s.added) }
                return best.map(\.0)
            }
            forYou = await ids.value
            tmdb.refresh(model: self)
        }
    }

    // MARK: Sync scheduling

    func scheduleSync(delay: Double = 2.5) {
        guard loaded, !syncCode.isEmpty else { return }
        // Never sync more than once a minute: playback saves its position every 10 s, which would otherwise hit the server (and the radio) constantly.
        let wait = max(delay, 60 - Date().timeIntervalSince(lastSyncRun))
        syncTask?.cancel()
        syncTask = Task {
            try? await Task.sleep(for: .seconds(wait))
            guard !Task.isCancelled else { return }
            lastSyncRun = .now
            await sync.run(model: self)
        }
    }
    func syncNow() async { await sync.run(model: self, manual: true) }

    static var appIsActive: Bool {
        #if os(macOS)
        NSApplication.shared.isActive
        #else
        UIApplication.shared.applicationState == .active
        #endif
    }

    static var activeNotification: Notification.Name {
        #if os(macOS)
        NSApplication.didBecomeActiveNotification
        #else
        UIApplication.didBecomeActiveNotification
        #endif
    }

    func startBackground() async {
        // pick up changes from other devices every few minutes and whenever the app comes forward
        NotificationCenter.default.addObserver(forName: Self.activeNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in AppModel.shared.scheduleSync(delay: 1) }
        }
        scheduleSync(delay: 4)
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(600))
            // only while the app is in front: background polling is what drains the battery
            if !syncCode.isEmpty, Self.appIsActive { lastSyncRun = .now; await sync.run(model: self) }
        }
    }

    func saveProfilesNow() {
        let f = ProfilesFile(profiles: profiles, active: activeProfile, stash: stash)
        if let d = try? JSONEncoder().encode(f) { try? d.write(to: supportDir.appendingPathComponent("profiles.json"), options: .atomic) }
    }

    func disconnectSync() {
        syncCode = ""; lastSync = nil; sync.reset(); saveSyncState()
        try? FileManager.default.removeItem(at: supportDir.appendingPathComponent("sync.json"))
    }
}

// MARK: - Downloads and pasted links

extension AppModel {
    func downloadLite(movie m: Movie) -> PlaybackRequestLite? {
        guard let u = streamURL(for: m) else { return nil }
        return PlaybackRequestLite(id: m.id, kind: "movie", title: SearchKit.cleanTitle(m.name), subtitle: m.year, poster: m.poster, url: u)
    }
    func downloadLite(episode e: Episode, in show: Show) -> PlaybackRequestLite {
        PlaybackRequestLite(id: "\(show.id)|\(e.id)", kind: "episode", title: SearchKit.cleanTitle(show.name),
                            subtitle: "S\(e.season) · E\(e.episode) — \(e.title)", poster: show.poster, parentId: show.id, url: e.url)
    }
    func download(_ reqs: [PlaybackRequestLite]) {
        downloads.configure(limitGb: settings.downloadLimitGb, userAgent: settings.userAgent)
        if let msg = downloads.add(reqs) { toast = msg } else { toast = reqs.count == 1 ? "Downloading “\(reqs[0].title)”" : "Downloading \(reqs.count) episodes" }
    }

    func playDownload(_ d: DownloadRec, openWindow: OpenWindowAction) {
        guard let local = downloads.localURL(for: d.id) else { return }
        let start = history(for: d.id).map { $0.isFinished ? 0 : $0.position } ?? 0
        var r = PlaybackRequest(historyId: d.id, kind: d.kind, itemId: d.parentId ?? d.id, title: d.title, subtitle: d.subtitle, url: local.absoluteString, artwork: d.poster, startAt: start)
        r.localFile = local.path
        if d.kind == "episode", let parent = d.parentId {
            r.showId = parent; r.episodeId = String(d.id.dropFirst(parent.count + 1))
        }
        play(openWindow, r)
    }

    /// A pasted stream link plays straight away. Returns false when the text isn't one.
    @discardableResult
    func playPasted(_ text: String, openWindow: OpenWindowAction) -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.range(of: #"^(https?|rtmp|rtsp)://\S+$"#, options: .regularExpression) != nil, let u = URL(string: t) else { return false }
        let isFile = t.range(of: #"\.(mp4|mkv|avi|mov|webm|m4v)(\?|$)"#, options: [.regularExpression, .caseInsensitive]) != nil
        let r = PlaybackRequest(historyId: "url:\(t)", kind: isFile ? "movie" : "live", itemId: "url:\(t)", title: u.host ?? "Stream", subtitle: "Pasted link", url: t)
        play(openWindow, r)
        return true
    }
}

extension AppModel {
    var favoriteItems: [Item] { user.favorites.compactMap { item($0) } }
}
