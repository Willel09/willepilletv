import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Timeline

struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
    /// Which pick to show (Tonight's Pick rotates hourly)
    var pickIndex = 0
}

struct SnapshotProvider: TimelineProvider {
    var rotatesPicks = false

    func placeholder(in context: Context) -> SnapshotEntry { SnapshotEntry(date: .now, snapshot: .preview) }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        let s = Shared.readSnapshot()
        completion(SnapshotEntry(date: .now, snapshot: context.isPreview && s.updatedAt == .distantPast ? .preview : s))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        let s = Shared.readSnapshot()
        if rotatesPicks && s.picks.count > 1 {
            let entries = s.picks.indices.map { i in SnapshotEntry(date: .now.addingTimeInterval(Double(i) * 3600), snapshot: s, pickIndex: i) }
            completion(Timeline(entries: entries, policy: .atEnd))
        } else {
            // refresh when the current programme ends so "now" stays right
            let nextStop = s.liveNow.compactMap(\.nowStop).filter { $0 > .now }.min() ?? .now.addingTimeInterval(1800)
            completion(Timeline(entries: [SnapshotEntry(date: .now, snapshot: s)], policy: .after(min(nextStop, .now.addingTimeInterval(1800)))))
        }
    }
}

// MARK: - Shared pieces

private func thumb(_ name: String?) -> PlatformImage? {
    guard let name else { return nil }
    return PlatformImage(contentsOfFile: Shared.thumbsDirectory.appendingPathComponent(name).path)
}

private struct Thumb: View {
    let name: String?
    var fit = false
    var symbol = "film"
    var body: some View {
        if let img = thumb(name) {
            Image(platformImage: img).resizable().aspectRatio(contentMode: fit ? .fit : .fill)
        } else {
            ZStack {
                LinearGradient(colors: [.white.opacity(0.12), .white.opacity(0.03)], startPoint: .topLeading, endPoint: .bottomTrailing)
                Image(systemName: symbol).font(.title3).foregroundStyle(.secondary)
            }
        }
    }
}

private struct Bar: View {
    let value: Double
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.25))
                Capsule().fill(.tint).frame(width: max(3, g.size.width * value))
            }
        }
        .frame(height: 4)
    }
}

private struct Header: View {
    let title: String
    let symbol: String
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: symbol).font(.caption2.weight(.bold))
            Text(title.uppercased()).font(.caption2.weight(.heavy)).tracking(0.8)
            Spacer()
            Image(systemName: "sparkles.tv.fill").font(.caption2).foregroundStyle(.secondary)
        }
        .foregroundStyle(.tint)
    }
}

private struct Empty: View {
    let symbol: String
    let text: String
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: symbol).font(.title2).foregroundStyle(.secondary)
            Text(text).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Continue Watching

struct ContinueWatchingWidget: Widget {
    #if os(iOS)
    static let families: [WidgetFamily] = [.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryCircular, .accessoryInline]
    #else
    static let families: [WidgetFamily] = [.systemSmall, .systemMedium, .systemLarge]
    #endif
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Shared.widgetKindContinue, provider: SnapshotProvider()) { e in
            ContinueWatchingView(entry: e).containerBackground(.black.gradient, for: .widget)
        }
        .configurationDisplayName("Continue Watching")
        .description("Pick up the film or episode you were watching.")
        .supportedFamilies(Self.families)
    }
}

struct ContinueWatchingView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        #if os(iOS)
        if family.isAccessory { LockContinue(items: entry.snapshot.continueWatching, family: family) } else { content }
        #else
        content
        #endif
    }

    @ViewBuilder private var content: some View {
        let items = entry.snapshot.continueWatching
        if items.isEmpty {
            Empty(symbol: "play.circle", text: "Start a film or series in Lumen and it shows up here.")
        } else if family == .systemSmall, let i = items.first {
            ZStack(alignment: .bottomLeading) {
                Thumb(name: i.thumb).frame(maxWidth: .infinity, maxHeight: .infinity).clipped()
                LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .center, endPoint: .bottom)
                VStack(alignment: .leading, spacing: 4) {
                    Text(i.title).font(.caption.weight(.bold)).lineLimit(2)
                    if let s = i.subtitle { Text(s).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                    Bar(value: i.progress ?? 0)
                }
                .padding(12)
            }
            .foregroundStyle(.white)
            .widgetURL(DeepLink.play(i.id).url)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Header(title: "Continue Watching", symbol: "play.fill")
                if family == .systemLarge {
                    ForEach(items.prefix(4)) { i in listRow(i) }
                    Spacer(minLength: 0)
                } else {
                    HStack(spacing: 10) {
                        ForEach(items.prefix(3)) { i in
                            Link(destination: DeepLink.play(i.id).url) {
                                VStack(alignment: .leading, spacing: 5) {
                                    Thumb(name: i.thumb).frame(maxWidth: .infinity).frame(height: 78).clipShape(.rect(cornerRadius: 9))
                                    Text(i.title).font(.caption2.weight(.semibold)).lineLimit(1)
                                    Bar(value: i.progress ?? 0)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private func listRow(_ i: WidgetItem) -> some View {
        Link(destination: DeepLink.play(i.id).url) {
            HStack(spacing: 10) {
                Thumb(name: i.thumb).frame(width: 52, height: 74).clipShape(.rect(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 4) {
                    Text(i.title).font(.callout.weight(.semibold)).lineLimit(1)
                    if let s = i.subtitle { Text(s).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                    Bar(value: i.progress ?? 0)
                }
                Image(systemName: "play.circle.fill").font(.title2).foregroundStyle(.tint)
            }
        }
    }
}

// MARK: - Live Now

struct LiveNowWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Shared.widgetKindLive, provider: SnapshotProvider()) { e in
            LiveNowView(entry: e).containerBackground(.black.gradient, for: .widget)
        }
        .configurationDisplayName("Live Now")
        .description("What's on your favorite channels right now.")
        .supportedFamilies(ContinueWatchingWidget.families)
    }
}

struct LiveNowView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        #if os(iOS)
        if family.isAccessory { LockLive(chans: entry.snapshot.liveNow, family: family) } else { content }
        #else
        content
        #endif
    }

    @ViewBuilder private var content: some View {
        let chans = entry.snapshot.liveNow
        if chans.isEmpty {
            Empty(symbol: "heart", text: "Add favorite channels in Lumen to see what's on.")
        } else if family == .systemSmall, let c = chans.first {
            VStack(alignment: .leading, spacing: 8) {
                Header(title: "Live", symbol: "dot.radiowaves.left.and.right")
                Thumb(name: c.thumb, fit: true, symbol: "tv").frame(height: 44).frame(maxWidth: .infinity, alignment: .leading)
                Text(c.name).font(.caption.weight(.bold)).lineLimit(1)
                Text(c.nowTitle ?? "On air").font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                Spacer(minLength: 0)
                progress(c)
            }
            .widgetURL(DeepLink.live(c.id).url)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Header(title: "Live Now", symbol: "dot.radiowaves.left.and.right")
                ForEach(chans.prefix(family == .systemLarge ? 7 : 3)) { c in
                    Link(destination: DeepLink.live(c.id).url) {
                        HStack(spacing: 10) {
                            Thumb(name: c.thumb, fit: true, symbol: "tv").frame(width: 40, height: 26)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(c.name).font(.caption.weight(.semibold)).lineLimit(1)
                                    Spacer()
                                    if let stop = c.nowStop { Text(stop, style: .time).font(.caption2).foregroundStyle(.tertiary) }
                                }
                                Text(c.nowTitle ?? "On air").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                progress(c)
                            }
                        }
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }

    @ViewBuilder private func progress(_ c: WidgetChannel) -> some View {
        if let s = c.nowStart, let e = c.nowStop, e > s, e > entry.date {
            // updates by itself while the widget is on screen
            ProgressView(timerInterval: s...e, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                .progressViewStyle(.linear).tint(.accentColor).labelsHidden()
        }
    }
}

// MARK: - Tonight's Pick

struct TonightsPickWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Shared.widgetKindPick, provider: SnapshotProvider(rotatesPicks: true)) { e in
            TonightsPickView(entry: e).containerBackground(for: .widget) {
                ZStack {
                    Color.black
                    if let p = e.snapshot.picks[safe: e.pickIndex] { Thumb(name: p.thumb).blur(radius: 30).opacity(0.5) }
                }
            }
        }
        .configurationDisplayName("Tonight's Pick")
        .description("A well-rated title from your library you haven't seen. Changes every hour.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct TonightsPickView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        if let p = entry.snapshot.picks[safe: entry.pickIndex] {
            HStack(spacing: 14) {
                Thumb(name: p.thumb).aspectRatio(2/3, contentMode: .fit).clipShape(.rect(cornerRadius: 10))
                    .shadow(radius: 8)
                if family != .systemSmall {
                    VStack(alignment: .leading, spacing: 6) {
                        Header(title: "Tonight's Pick", symbol: "dice.fill")
                        Spacer(minLength: 0)
                        Text(p.title).font(family == .systemLarge ? .title2.weight(.bold) : .headline).lineLimit(3)
                        if let s = p.subtitle, !s.isEmpty { Text(s).font(.caption).foregroundStyle(.secondary) }
                        Text(p.kind == "series" ? "Series" : "Movie").font(.caption2.weight(.semibold))
                            .padding(.horizontal, 7).padding(.vertical, 3).background(.white.opacity(0.15), in: Capsule())
                    }
                }
            }
            .foregroundStyle(.white)
            .widgetURL(DeepLink.item(p.id).url)
        } else {
            Empty(symbol: "dice", text: "Add a source in Lumen to get picks.")
        }
    }
}

// MARK: - Library stats

struct LibraryStatsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Shared.widgetKindStats, provider: SnapshotProvider()) { e in
            LibraryStatsView(snapshot: e.snapshot).containerBackground(.black.gradient, for: .widget)
        }
        .configurationDisplayName("Library")
        .description("How big your library is.")
        .supportedFamilies([.systemSmall])
    }
}

struct LibraryStatsView: View {
    let snapshot: WidgetSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Header(title: "Library", symbol: "square.stack.fill")
            Spacer(minLength: 0)
            stat("dot.radiowaves.left.and.right", snapshot.channelCount, "channels")
            stat("film.fill", snapshot.movieCount, "movies")
            stat("tv.fill", snapshot.seriesCount, "series")
            stat("bookmark.fill", snapshot.watchlistCount, "in My List")
        }
        .widgetURL(DeepLink.home.url)
    }
    private func stat(_ symbol: String, _ n: Int, _ label: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).font(.caption2).foregroundStyle(.tint).frame(width: 14)
            Text(n.formatted(.number.notation(.compactName))).font(.callout.weight(.bold).monospacedDigit())
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }
}

// MARK: - Lock Screen

extension WidgetFamily {
    var isAccessory: Bool {
        #if os(iOS)
        self == .accessoryRectangular || self == .accessoryCircular || self == .accessoryInline
        #else
        false
        #endif
    }
}

#if os(iOS)
struct LockContinue: View {
    let items: [WidgetItem]
    let family: WidgetFamily
    var body: some View {
        if let i = items.first {
            switch family {
            case .accessoryInline: Text("▶︎ \(i.title)")
            case .accessoryCircular:
                Gauge(value: i.progress ?? 0) { Image(systemName: "play.fill") }.gaugeStyle(.accessoryCircularCapacity)
            default:
                VStack(alignment: .leading, spacing: 2) {
                    Label("Continue", systemImage: "play.fill").font(.caption2)
                    Text(i.title).font(.headline).lineLimit(1)
                    ProgressView(value: i.progress ?? 0)
                }
            }
        } else { Label("Lumen", systemImage: "play.rectangle") }
    }
}

struct LockLive: View {
    let chans: [WidgetChannel]
    let family: WidgetFamily
    var body: some View {
        if let c = chans.first {
            switch family {
            case .accessoryInline: Text("\(c.name): \(c.nowTitle ?? "On air")")
            case .accessoryCircular: Image(systemName: "dot.radiowaves.left.and.right").font(.title2)
            default:
                VStack(alignment: .leading, spacing: 2) {
                    Label(c.name, systemImage: "dot.radiowaves.left.and.right").font(.caption2)
                    Text(c.nowTitle ?? "On air").font(.headline).lineLimit(1)
                    if let n = c.nextTitle { Text("Next · \(n)").font(.caption2).lineLimit(1) }
                }
            }
        } else { Label("Lumen", systemImage: "tv") }
    }
}
#endif

// MARK: - Control Center controls

struct OpenLumenLinkIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Lumen"
    static let isDiscoverable = false
    @Parameter(title: "Link") var link: String

    init() { link = DeepLink.home.url.absoluteString }
    init(_ deepLink: DeepLink) { link = deepLink.url.absoluteString }

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(URL(string: link) ?? DeepLink.home.url))
    }
}

struct SurpriseMeControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "SurpriseMeControl") {
            ControlWidgetButton(action: OpenLumenLinkIntent(.random)) { Label("Surprise Me", systemImage: "dice.fill") }
        }
        .displayName("Lumen: Surprise Me")
        .description("Opens the random picker.")
    }
}

struct ContinueWatchingControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "ContinueWatchingControl") {
            let first = Shared.readSnapshot().continueWatching.first
            ControlWidgetButton(action: OpenLumenLinkIntent(first.map { .play($0.id) } ?? .home)) {
                Label(first?.title ?? "Continue Watching", systemImage: "play.circle.fill")
            }
        }
        .displayName("Lumen: Continue Watching")
        .description("Resumes what you were watching.")
    }
}

struct SearchControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "SearchControl") {
            ControlWidgetButton(action: OpenLumenLinkIntent(.search(""))) { Label("Search", systemImage: "magnifyingglass") }
        }
        .displayName("Lumen: Search")
        .description("Opens search.")
    }
}

struct LiveChannelControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "LiveChannelControl") {
            let c = Shared.readSnapshot().liveNow.first
            ControlWidgetButton(action: OpenLumenLinkIntent(c.map { .live($0.id) } ?? .home)) {
                Label(c?.name ?? "Live TV", systemImage: "dot.radiowaves.left.and.right")
            }
        }
        .displayName("Lumen: Favorite Channel")
        .description("Tunes to your first favorite channel.")
    }
}

struct OpenLumenControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "OpenLumenControl") {
            ControlWidgetButton(action: OpenLumenLinkIntent(.home)) { Label("Lumen", systemImage: "sparkles.tv") }
        }
        .displayName("Lumen")
        .description("Opens Lumen.")
    }
}

// MARK: - Preview data

extension WidgetSnapshot {
    static let preview = WidgetSnapshot(
        continueWatching: [
            WidgetItem(id: "1", title: "Interstellar", subtitle: "1 h 12 min left", progress: 0.42, kind: "movie"),
            WidgetItem(id: "2", title: "Severance", subtitle: "S2 · E4", progress: 0.7, kind: "episode"),
            WidgetItem(id: "3", title: "Dune: Part Two", subtitle: "38 min left", progress: 0.81, kind: "movie"),
        ],
        liveNow: [
            WidgetChannel(id: "a", name: "SVT1 HD", number: 1, nowTitle: "Rapport", nowStart: .now.addingTimeInterval(-600), nowStop: .now.addingTimeInterval(1200), nextTitle: "Sportnytt"),
            WidgetChannel(id: "b", name: "TV4 HD", number: 4, nowTitle: "Nyheterna", nowStart: .now.addingTimeInterval(-900), nowStop: .now.addingTimeInterval(900)),
            WidgetChannel(id: "c", name: "Discovery", number: 12, nowTitle: "Gold Rush", nowStart: .now.addingTimeInterval(-1800), nowStop: .now.addingTimeInterval(1800)),
        ],
        picks: [WidgetItem(id: "p", title: "Arrival", subtitle: "2016 · ★ 7.9", kind: "movie")],
        movieCount: 48210, seriesCount: 9312, channelCount: 12480, watchlistCount: 17, updatedAt: .now)
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

#Preview(as: .systemMedium) { ContinueWatchingWidget() } timeline: { SnapshotEntry(date: .now, snapshot: .preview) }
#Preview(as: .systemLarge) { LiveNowWidget() } timeline: { SnapshotEntry(date: .now, snapshot: .preview) }
#Preview(as: .systemMedium) { TonightsPickWidget() } timeline: { SnapshotEntry(date: .now, snapshot: .preview) }
