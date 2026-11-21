// Shortcuts, Siri and Spotlight actions.
import AppIntents
import SwiftUI

struct ChannelEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Channel"
    static let defaultQuery = ChannelQuery()
    let id: String
    let name: String
    let group: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)", subtitle: "\(group)") }
}

struct ChannelQuery: EntityStringQuery {
    @MainActor func entities(for identifiers: [String]) async throws -> [ChannelEntity] {
        identifiers.compactMap { id in
            if case .live(let c) = AppModel.shared.item(id) { ChannelEntity(id: c.id, name: c.name, group: c.group) } else { nil }
        }
    }
    @MainActor func entities(matching string: String) async throws -> [ChannelEntity] {
        AppModel.shared.channels.filter { $0.name.localizedCaseInsensitiveContains(string) }.prefix(30)
            .map { ChannelEntity(id: $0.id, name: $0.name, group: $0.group) }
    }
    @MainActor func suggestedEntities() async throws -> [ChannelEntity] {
        let m = AppModel.shared
        return (m.favoriteChannels.isEmpty ? m.recentChannels : m.favoriteChannels).prefix(20).map { ChannelEntity(id: $0.id, name: $0.name, group: $0.group) }
    }
}

struct WatchChannelIntent: AppIntent {
    static let title: LocalizedStringResource = "Watch Channel"
    static let description = IntentDescription("Starts a live TV channel in Lumen.")
    static let openAppWhenRun = true
    @Parameter(title: "Channel") var channel: ChannelEntity

    @MainActor func perform() async throws -> some IntentResult {
        if let r = AppModel.shared.handle(.live(channel.id)) { AppModel.shared.pendingPlay = r }
        return .result()
    }
}

struct ContinueWatchingIntent: AppIntent {
    static let title: LocalizedStringResource = "Continue Watching"
    static let description = IntentDescription("Resumes the last movie or episode you were watching.")
    static let openAppWhenRun = true

    @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
        let m = AppModel.shared
        guard let h = m.continueWatching.first else { return .result(dialog: "There's nothing to continue.") }
        if let r = m.handle(.play(h.itemId)) { m.pendingPlay = r }
        return .result(dialog: "Resuming \(h.name).")
    }
}

struct SurpriseMeIntent: AppIntent {
    static let title: LocalizedStringResource = "Pick Something to Watch"
    static let description = IntentDescription("Lumen picks a well-rated movie or series you haven't seen.")
    static let openAppWhenRun = true

    @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
        let m = AppModel.shared
        guard let pick = m.randomPick(kind: nil, minRating: 7) ?? m.randomPick(kind: nil) else { return .result(dialog: "Your library is empty.") }
        _ = m.handle(.item(pick.id))
        return .result(dialog: "How about \(SearchKit.cleanTitle(pick.name))?")
    }
}

struct SearchLumenIntent: AppIntent {
    static let title: LocalizedStringResource = "Search Lumen"
    static let openAppWhenRun = true
    @Parameter(title: "Search for") var query: String

    @MainActor func perform() async throws -> some IntentResult {
        _ = AppModel.shared.handle(.search(query))
        return .result()
    }
}

struct RefreshLibraryIntent: AppIntent {
    static let title: LocalizedStringResource = "Refresh Lumen Library"
    static let description = IntentDescription("Reloads every playlist and guide.")

    @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
        let m = AppModel.shared
        await m.refresh()
        return .result(dialog: "\(m.channels.count) channels, \(m.movies.count) movies and \(m.series.count) series.")
    }
}

struct LumenShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: ContinueWatchingIntent(), phrases: ["Continue watching in \(.applicationName)", "Resume \(.applicationName)"],
                    shortTitle: "Continue Watching", systemImageName: "play.circle")
        AppShortcut(intent: WatchChannelIntent(), phrases: ["Watch \(\.$channel) in \(.applicationName)", "Put on \(\.$channel) in \(.applicationName)"],
                    shortTitle: "Watch Channel", systemImageName: "dot.radiowaves.left.and.right")
        AppShortcut(intent: SurpriseMeIntent(), phrases: ["What should I watch in \(.applicationName)", "Surprise me in \(.applicationName)"],
                    shortTitle: "Surprise Me", systemImageName: "dice")
        AppShortcut(intent: RefreshLibraryIntent(), phrases: ["Refresh \(.applicationName)"],
                    shortTitle: "Refresh Library", systemImageName: "arrow.clockwise")
    }
}
