// Data shared between Lumen and its widgets: a small snapshot the app writes after every change,
// plus the deep links the widgets open. Lives in the App Group container.
import Foundation
#if os(macOS)
import Security
#endif
import SwiftUI

nonisolated enum Shared {
    static let appGroup = "group.se.willepille.Lumen"
    static let widgetKindContinue = "ContinueWatching"
    static let widgetKindLive = "LiveNow"
    static let widgetKindPick = "TonightsPick"
    static let widgetKindStats = "LibraryStats"

    static let widgetBundleId = "se.willepille.Lumen.LumenWidgets"

    /// True when this process was signed with the App Group (needs a development team in Xcode).
    #if os(iOS)
    static let hasAppGroup = true
    #else
    static let hasAppGroup: Bool = {
        guard let task = SecTaskCreateFromSelf(nil),
              let value = SecTaskCopyValueForEntitlement(task, "com.apple.security.application-groups" as CFString, nil) as? [String] else { return false }
        return value.contains(appGroup)
    }()
    #endif

    static var isWidget: Bool { Bundle.main.bundleIdentifier == widgetBundleId }

    /// Where the snapshot lives:
    /// - signed with a team: the App Group container both processes can use;
    /// - signed locally (no team): the widget's own sandbox container, which the (unsandboxed) app writes into.
    static var directory: URL {
        let fm = FileManager.default
        let base: URL
        if hasAppGroup, let group = fm.containerURL(forSecurityApplicationGroupIdentifier: appGroup) {
            base = group
        } else if isWidget {
            base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Lumen", isDirectory: true)
        } else {
            let home = URL(fileURLWithPath: NSHomeDirectory())
            base = home.appendingPathComponent("Library/Containers/\(widgetBundleId)/Data/Library/Application Support/Lumen", isDirectory: true)
        }
        let dir = base.appendingPathComponent("Shared", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static var snapshotURL: URL { directory.appendingPathComponent("widget.json") }
    static var thumbsDirectory: URL {
        let d = directory.appendingPathComponent("thumbs", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    static func thumbURL(for id: String) -> URL {
        let safe = id.replacingOccurrences(of: "[^A-Za-z0-9_-]", with: "_", options: .regularExpression)
        return thumbsDirectory.appendingPathComponent("\(safe).jpg")
    }

    static func readSnapshot() -> WidgetSnapshot {
        guard let data = try? Data(contentsOf: snapshotURL),
              let snap = try? JSONDecoder().decode(WidgetSnapshot.self, from: data) else { return .empty }
        return snap
    }

    static func write(_ snapshot: WidgetSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        try? data.write(to: snapshotURL, options: .atomic)
    }
}

nonisolated struct WidgetItem: Codable, Hashable, Identifiable, Sendable {
    var id: String
    var title: String
    var subtitle: String?
    /// 0...1 watched
    var progress: Double?
    var kind: String // live | movie | series | episode
    var thumb: String? // file name in thumbs dir
    var accentHex: String?
}

nonisolated struct WidgetChannel: Codable, Hashable, Identifiable, Sendable {
    var id: String
    var name: String
    var number: Int?
    var nowTitle: String?
    var nowStart: Date?
    var nowStop: Date?
    var nextTitle: String?
    var thumb: String?
}

nonisolated struct WidgetSnapshot: Codable, Sendable {
    var continueWatching: [WidgetItem]
    var liveNow: [WidgetChannel]
    var picks: [WidgetItem]
    var movieCount: Int
    var seriesCount: Int
    var channelCount: Int
    var watchlistCount: Int
    var updatedAt: Date
    /// App accent and theme glow so widgets match the app's look
    var accentHex: String? = nil
    var glowHex: [String]? = nil

    static let empty = WidgetSnapshot(continueWatching: [], liveNow: [], picks: [], movieCount: 0, seriesCount: 0,
                                      channelCount: 0, watchlistCount: 0, updatedAt: .distantPast)
}

/// lumen://item/<id>, lumen://play/<id>, lumen://live/<id>, lumen://random, lumen://search?q=
nonisolated enum DeepLink: Hashable, Sendable {
    case item(String)
    case play(String)
    case live(String)
    case random
    case search(String)
    case home

    var url: URL {
        var c = URLComponents()
        c.scheme = "lumen"
        switch self {
        case .item(let id): c.host = "item"; c.path = "/" + id
        case .play(let id): c.host = "play"; c.path = "/" + id
        case .live(let id): c.host = "live"; c.path = "/" + id
        case .random: c.host = "random"
        case .search(let q): c.host = "search"; c.queryItems = [URLQueryItem(name: "q", value: q)]
        case .home: c.host = "home"
        }
        return c.url ?? URL(string: "lumen://home")!
    }

    init?(url: URL) {
        guard url.scheme == "lumen" else { return nil }
        let id = String(url.path.dropFirst()).removingPercentEncoding ?? String(url.path.dropFirst())
        switch url.host {
        case "item": self = .item(id)
        case "play": self = .play(id)
        case "live": self = .live(id)
        case "random": self = .random
        case "search":
            let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "q" }?.value ?? ""
            self = .search(q)
        default: self = .home
        }
    }
}


#if os(macOS)
import AppKit
typealias PlatformImage = NSImage
extension Image { init(platformImage: PlatformImage) { self.init(nsImage: platformImage) } }
#else
import UIKit
typealias PlatformImage = UIImage
extension Image { init(platformImage: PlatformImage) { self.init(uiImage: platformImage) } }
#endif
