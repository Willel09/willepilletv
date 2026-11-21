import SwiftUI
import AppIntents
import AVFoundation

@main
struct LumenApp: App {
    @State private var model = AppModel.shared
    @Environment(\.openWindow) private var openWindow

    init() {
        URLCache.shared = URLCache(memoryCapacity: 64 << 20, diskCapacity: 600 << 20)
        LumenShortcuts.updateAppShortcutParameters()
    }

    var body: some Scene {
        WindowGroup("Lumen", id: "main") {
            RootView()
                .environment(model)
                .frame(minWidth: 1000, minHeight: 640)
                .tint(model.accent)
                .preferredColorScheme(.dark)
                .onOpenURL { url in
                    guard let link = DeepLink(url: url) else { return }
                    if let r = model.handle(link) { model.pendingPlay = r }
                }
        }
        .defaultSize(width: 1360, height: 860)
        .windowToolbarStyle(.unified)
        .commands { LumenCommands(model: model) }

        Window("Player", id: "player") {
            PlayerWindow()
                .environment(model)
                .tint(model.accent)
        }
        .defaultSize(width: 1100, height: 640)
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentMinSize)
        .commandsRemoved()

        Settings {
            SettingsView().environment(model).tint(model.accent)
        }

        MenuBarExtra("Lumen", systemImage: "sparkles.tv", isInserted: Binding(get: { model.settings.showMenuBarExtra }, set: { model.settings.showMenuBarExtra = $0 })) {
            MenuBarContent().environment(model)
        }
        .menuBarExtraStyle(.window)
    }
}

struct LumenCommands: Commands {
    let model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandGroup(after: .newItem) {
            Button("Reload Library") { Task { await model.refresh() } }.keyboardShortcut("r")
            Button("Reload TV Guide") { Task { await model.refreshGuide() } }.keyboardShortcut("r", modifiers: [.command, .shift])
        }
        CommandMenu("Go") {
            ForEach(Array(SidebarItem.allCases.enumerated()), id: \.element) { i, s in
                Button(s.title) { model.selection = s; model.path = NavigationPath() }
                    .keyboardShortcut(KeyEquivalent(Character("\(i + 1)")), modifiers: .command)
            }
            Divider()
            Button("Search") { model.selection = .search }.keyboardShortcut("f")
            Button("Back") { if !model.path.isEmpty { model.path.removeLast() } }.keyboardShortcut("[")
        }
        CommandMenu("Playback") {
            Button("Play/Pause") {
                guard let p = model.activePlayer else { return }
                p.isPlaying ? p.player.pause() : p.player.play()
            }
            .keyboardShortcut("p", modifiers: [.command, .option])
            Button("Next Channel") { model.activePlayer?.zap(1) }.keyboardShortcut(.downArrow, modifiers: .command)
            Button("Previous Channel") { model.activePlayer?.zap(-1) }.keyboardShortcut(.upArrow, modifiers: .command)
            Divider()
            Button("Surprise Me") {
                if let i = model.randomPick(kind: nil, minRating: 7) { model.selection = .random; model.path = NavigationPath(); model.path.append(Route.detail(i)) }
            }
            .keyboardShortcut("y", modifiers: [.command, .shift])
            Menu("Favorite Channels") {
                ForEach(Array(model.favoriteChannels.prefix(9).enumerated()), id: \.element.id) { i, c in
                    Button(c.name) { if let r = model.request(for: .live(c)) { model.play(openWindow, r) } }
                        .keyboardShortcut(KeyEquivalent(Character("\(i + 1)")), modifiers: [.command, .option])
                }
            }
        }
    }
}

/// The menu bar extra: favorites, continue watching and a quick search.
struct MenuBarContent: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @State private var query = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "sparkles.tv.fill").foregroundStyle(model.accent)
                Text("Lumen").font(.headline)
                Spacer()
                if model.isRefreshing { ProgressView().controlSize(.mini) }
                Button { Task { await model.refresh() } } label: { Image(systemName: "arrow.clockwise") }.buttonStyle(.borderless)
            }
            TextField("Search Lumen", text: $query)
                .textFieldStyle(.roundedBorder)
                .onSubmit { model.searchQuery = query; model.selection = .search; openMain() }

            if !model.continueWatching.isEmpty {
                Text("Continue Watching").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                ForEach(model.continueWatching.prefix(3)) { h in
                    row(title: h.name, subtitle: h.subtitle, art: h.artwork, progress: h.progress) {
                        if let r = model.handle(.play(h.itemId)) { model.play(openWindow, r) }
                    }
                }
            }
            let favs = model.favoriteChannels.isEmpty ? model.recentChannels : model.favoriteChannels
            if !favs.isEmpty {
                Text(model.favoriteChannels.isEmpty ? "Recent Channels" : "Favorite Channels").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                ForEach(favs.prefix(6)) { c in
                    row(title: c.name, subtitle: model.nowNext(for: c).now?.title, art: c.logo, progress: model.nowNext(for: c).now?.progress(), fit: true) {
                        if let r = model.request(for: .live(c)) { model.play(openWindow, r) }
                    }
                }
            }
            Divider()
            HStack {
                Button("Open Lumen") { openMain() }
                Spacer()
                Button("Quit") { NSApp.terminate(nil) }
            }
            .buttonStyle(.borderless)
        }
        .padding(14)
        .frame(width: 320)
    }

    private func openMain() {
        openWindow(id: "main")
        NSApp.activate()
    }

    private func row(title: String, subtitle: String?, art: String?, progress: Double?, fit: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Artwork(source: art, contentMode: fit ? .fit : .fill, placeholder: fit ? "tv" : "film")
                    .frame(width: 48, height: 30).clipShape(.rect(cornerRadius: 6))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.callout).lineLimit(1)
                    if let subtitle { Text(subtitle).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                    if let progress, progress > 0 { ProgressBar(value: progress, tint: model.accent) }
                }
                Spacer(minLength: 0)
                Image(systemName: "play.fill").font(.caption).foregroundStyle(.secondary)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}
