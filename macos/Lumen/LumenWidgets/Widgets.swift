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

private func hexColor(_ hex: String?) -> Color? {
    guard var s = hex?.trimmingCharacters(in: .whitespaces) else { return nil }
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
    return Color(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
}

extension WidgetSnapshot {
    var accent: Color { hexColor(accentHex) ?? .accentColor }
    var glow: [Color] { (glowHex ?? []).compactMap(hexColor) }
}

/// Same look as the app: near-black base, theme glow in one corner, optional blurred artwork on top.
struct WidgetBackdrop: View {
    let snapshot: WidgetSnapshot
    var art: String? = nil
    var body: some View {
        ZStack {
            Color(red: 0.05, green: 0.05, blue: 0.07)
            let g = snapshot.glow
            RadialGradient(colors: [(g.first ?? snapshot.accent).opacity(0.55), .clear], center: .topLeading, startRadius: 0, endRadius: 260)
            RadialGradient(colors: [(g.dropFirst().first ?? .clear).opacity(0.5), .clear], center: .bottomTrailing, startRadius: 0, endRadius: 220)
            if let img = thumb(art) {
                Image(platformImage: img).resizable().scaledToFill().blur(radius: 34).opacity(0.55).saturation(1.3)
                LinearGradient(colors: [.black.opacity(0.15), .black.opacity(0.6)], startPoint: .top, endPoint: .bottom)
            }
        }
    }
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
                LinearGradient(colors: [.white.opacity(0.14), .white.opacity(0.04)], startPoint: .topLeading, endPoint: .bottomTrailing)
                Image(systemName: symbol).font(.system(size: 18, weight: .semibold)).foregroundStyle(.white.opacity(0.35))
            }
        }
    }
}

/// Rounded thumbnail with a soft rim, like PosterCard in the app.
private struct Card: View {
    let name: String?
    var radius: CGFloat = 12
    var symbol = "film"
    var body: some View {
        Thumb(name: name, symbol: symbol)
            .clipShape(.rect(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous)
                .strokeBorder(LinearGradient(colors: [.white.opacity(0.28), .white.opacity(0.04)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
            .shadow(color: .black.opacity(0.45), radius: 8, y: 4)
    }
}

private struct Bar: View {
    let value: Double
    let tint: Color
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.18))
                Capsule().fill(LinearGradient(colors: [tint.opacity(0.75), tint], startPoint: .leading, endPoint: .trailing))
                    .frame(width: max(4, g.size.width * min(1, max(0, value))))
                    .shadow(color: tint.opacity(0.6), radius: 3)
                    .widgetAccentable()
            }
        }
        .frame(height: 4)
    }
}

/// Progress ring with percent, the same style as the ring in Live TV.
private struct Ring: View {
    let value: Double
    let tint: Color
    var size: CGFloat = 34
    var showsPercent = true
    var body: some View {
        ZStack {
            Circle().fill(.black.opacity(0.35))
            Circle().stroke(.white.opacity(0.18), lineWidth: 3)
            Circle().trim(from: 0, to: min(1, max(0.02, value)))
                .stroke(tint, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .shadow(color: tint.opacity(0.7), radius: 3)
                .widgetAccentable()
            if showsPercent {
                Text("\(Int((value * 100).rounded()))").font(.system(size: size * 0.32, weight: .bold, design: .rounded).monospacedDigit())
            } else {
                Image(systemName: "play.fill").font(.system(size: size * 0.3, weight: .bold)).offset(x: 1)
            }
        }
        .frame(width: size, height: size)
        .foregroundStyle(.white)
    }
}

private struct Eyebrow: View {
    let title: String
    let symbol: String
    let tint: Color
    var trailing: String? = nil
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).font(.system(size: 9, weight: .heavy))
                .frame(width: 18, height: 18)
                .background(LinearGradient(colors: [tint, tint.opacity(0.65)], startPoint: .top, endPoint: .bottom), in: .rect(cornerRadius: 5, style: .continuous))
                .foregroundStyle(.white)
                .widgetAccentable()
            Text(title.uppercased()).font(.system(size: 10.5, weight: .heavy)).tracking(1.1).foregroundStyle(.white.opacity(0.85))
            Spacer(minLength: 4)
            if let trailing { Text(trailing).font(.system(size: 10.5, weight: .semibold).monospacedDigit()).foregroundStyle(.white.opacity(0.45)) }
        }
    }
}

private struct LivePulse: View {
    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(.red).frame(width: 6, height: 6).shadow(color: .red, radius: 3)
            Text("LIVE").font(.system(size: 9, weight: .heavy)).tracking(0.8)
        }
        .padding(.horizontal, 6).padding(.vertical, 3)
        .background(.black.opacity(0.45), in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.12), lineWidth: 1))
        .foregroundStyle(.white)
    }
}

private struct Empty: View {
    let symbol: String
    let title: String
    let text: String
    let tint: Color
    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                Circle().fill(tint.opacity(0.18)).frame(width: 52, height: 52).blur(radius: 6)
                Circle().fill(LinearGradient(colors: [tint.opacity(0.45), tint.opacity(0.15)], startPoint: .top, endPoint: .bottom))
                    .frame(width: 40, height: 40)
                    .overlay(Circle().strokeBorder(.white.opacity(0.2), lineWidth: 1))
                Image(systemName: symbol).font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
            }
            .widgetAccentable()
            Text(title).font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
            Text(text).font(.system(size: 11)).foregroundStyle(.white.opacity(0.55)).multilineTextAlignment(.center).lineLimit(3)
        }
        .padding(.horizontal, 6)
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
            ContinueWatchingView(entry: e)
                .containerBackground(for: .widget) { WidgetBackdrop(snapshot: e.snapshot, art: e.snapshot.continueWatching.first?.thumb) }
        }
        .configurationDisplayName("Continue Watching")
        .description("Pick up the film or episode you were watching.")
        .supportedFamilies(Self.families)
        .contentMarginsDisabled()
    }
}

struct ContinueWatchingView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry
    private var tint: Color { entry.snapshot.accent }

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
            Empty(symbol: "play.fill", title: "Nothing in progress", text: "Start a film or series and it shows up here.", tint: tint).padding(14)
        } else if family == .systemSmall, let i = items.first {
            small(i)
        } else if family == .systemLarge {
            VStack(alignment: .leading, spacing: 10) {
                Eyebrow(title: "Continue Watching", symbol: "play.fill", tint: tint, trailing: "\(items.count)")
                hero(items[0]).frame(height: 150)
                ForEach(items.dropFirst().prefix(3)) { listRow($0) }
                Spacer(minLength: 0)
            }
            .padding(16)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Eyebrow(title: "Continue Watching", symbol: "play.fill", tint: tint, trailing: "\(items.count)")
                HStack(spacing: 10) {
                    ForEach(items.prefix(3)) { i in
                        Link(destination: DeepLink.play(i.id).url) {
                            VStack(alignment: .leading, spacing: 5) {
                                Card(name: i.thumb, radius: 10)
                                    .frame(maxWidth: .infinity).frame(height: 84)
                                    .overlay(alignment: .bottomTrailing) { Ring(value: i.progress ?? 0, tint: tint, size: 26).padding(5) }
                                Text(i.title).font(.system(size: 11.5, weight: .semibold)).lineLimit(1).foregroundStyle(.white)
                                if let s = i.subtitle { Text(s).font(.system(size: 10)).foregroundStyle(.white.opacity(0.5)).lineLimit(1) }
                            }
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(14)
        }
    }

    private func small(_ i: WidgetItem) -> some View {
        ZStack(alignment: .bottomLeading) {
            Thumb(name: i.thumb).frame(maxWidth: .infinity, maxHeight: .infinity).clipped()
            LinearGradient(stops: [.init(color: .clear, location: 0.3), .init(color: .black.opacity(0.92), location: 1)], startPoint: .top, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 5) {
                HStack { Spacer(); Ring(value: i.progress ?? 0, tint: tint, size: 32) }
                Spacer(minLength: 0)
                Text(i.title).font(.system(size: 14, weight: .bold)).lineLimit(2)
                if let s = i.subtitle { Text(s).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.65)).lineLimit(1) }
                Bar(value: i.progress ?? 0, tint: tint)
            }
            .padding(13)
        }
        .foregroundStyle(.white)
        .widgetURL(DeepLink.play(i.id).url)
    }

    private func hero(_ i: WidgetItem) -> some View {
        Link(destination: DeepLink.play(i.id).url) {
            ZStack(alignment: .bottomLeading) {
                Thumb(name: i.thumb).frame(maxWidth: .infinity, maxHeight: .infinity).clipped()
                LinearGradient(stops: [.init(color: .clear, location: 0.25), .init(color: .black.opacity(0.9), location: 1)], startPoint: .top, endPoint: .bottom)
                HStack(alignment: .bottom, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(i.title).font(.system(size: 18, weight: .bold)).lineLimit(1)
                        if let s = i.subtitle { Text(s).font(.system(size: 11.5, weight: .medium)).foregroundStyle(.white.opacity(0.65)) }
                        Bar(value: i.progress ?? 0, tint: tint).frame(maxWidth: 160)
                    }
                    Spacer()
                    Ring(value: i.progress ?? 0, tint: tint, size: 40, showsPercent: false)
                }
                .padding(12)
            }
            .clipShape(.rect(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.white.opacity(0.14), lineWidth: 1))
            .foregroundStyle(.white)
        }
    }

    private func listRow(_ i: WidgetItem) -> some View {
        Link(destination: DeepLink.play(i.id).url) {
            HStack(spacing: 11) {
                Card(name: i.thumb, radius: 8).frame(width: 44, height: 62)
                VStack(alignment: .leading, spacing: 4) {
                    Text(i.title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                    if let s = i.subtitle { Text(s).font(.system(size: 11)).foregroundStyle(.white.opacity(0.5)).lineLimit(1) }
                    Bar(value: i.progress ?? 0, tint: tint)
                }
                Ring(value: i.progress ?? 0, tint: tint, size: 30, showsPercent: false)
            }
            .foregroundStyle(.white)
        }
    }
}

// MARK: - Live Now

struct LiveNowWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Shared.widgetKindLive, provider: SnapshotProvider()) { e in
            LiveNowView(entry: e).containerBackground(for: .widget) { WidgetBackdrop(snapshot: e.snapshot) }
        }
        .configurationDisplayName("Live Now")
        .description("What's on your favorite channels right now.")
        .supportedFamilies(ContinueWatchingWidget.families)
    }
}

struct LiveNowView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry
    private var tint: Color { entry.snapshot.accent }

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
            Empty(symbol: "heart.fill", title: "No favorites yet", text: "Heart a channel in Live TV to see what's on.", tint: tint)
        } else if family == .systemSmall, let c = chans.first {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top) {
                    logo(c, size: 52)
                    Spacer()
                    LivePulse()
                }
                Spacer(minLength: 0)
                Text(c.name).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.55)).lineLimit(1)
                Text(c.nowTitle ?? "On air").font(.system(size: 14, weight: .bold)).foregroundStyle(.white).lineLimit(2)
                progress(c)
                if let n = c.nextTitle { Text("Next · \(n)").font(.system(size: 10)).foregroundStyle(.white.opacity(0.45)).lineLimit(1) }
            }
            .widgetURL(DeepLink.live(c.id).url)
        } else {
            VStack(alignment: .leading, spacing: family == .systemLarge ? 9 : 7) {
                Eyebrow(title: "Live Now", symbol: "dot.radiowaves.left.and.right", tint: tint, trailing: Date.now.formatted(date: .omitted, time: .shortened))
                ForEach(chans.prefix(family == .systemLarge ? 6 : 3)) { c in
                    Link(destination: DeepLink.live(c.id).url) { row(c) }
                }
                Spacer(minLength: 0)
            }
        }
    }

    private func row(_ c: WidgetChannel) -> some View {
        HStack(spacing: 10) {
            logo(c, size: family == .systemLarge ? 40 : 34)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(c.name).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.55)).lineLimit(1)
                    Spacer(minLength: 4)
                    if let stop = c.nowStop { Text(stop, style: .time).font(.system(size: 10, weight: .medium).monospacedDigit()).foregroundStyle(.white.opacity(0.4)) }
                }
                Text(c.nowTitle ?? "On air").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                progress(c)
                if family == .systemLarge, let n = c.nextTitle {
                    Text("Next · \(n)").font(.system(size: 10)).foregroundStyle(.white.opacity(0.4)).lineLimit(1)
                }
            }
        }
    }

    /// Channel logo on a tile with a soft glow behind it, like the Live TV info panel.
    private func logo(_ c: WidgetChannel, size: CGFloat) -> some View {
        ZStack {
            if let img = thumb(c.thumb) {
                Image(platformImage: img).resizable().scaledToFit().blur(radius: 12).opacity(0.7).frame(width: size, height: size)
            }
            RoundedRectangle(cornerRadius: size * 0.26, style: .continuous).fill(.white.opacity(0.08))
                .overlay(RoundedRectangle(cornerRadius: size * 0.26, style: .continuous).strokeBorder(.white.opacity(0.14), lineWidth: 1))
            if let img = thumb(c.thumb) {
                Image(platformImage: img).resizable().scaledToFit().padding(size * 0.16)
            } else {
                Text(String(c.name.prefix(2)).uppercased()).font(.system(size: size * 0.32, weight: .heavy, design: .rounded)).foregroundStyle(.white.opacity(0.8))
            }
        }
        .frame(width: size, height: size)
    }

    @ViewBuilder private func progress(_ c: WidgetChannel) -> some View {
        if let s = c.nowStart, let e = c.nowStop, e > s, e > entry.date {
            // updates by itself while the widget is on screen
            ProgressView(timerInterval: s...e, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                .progressViewStyle(.linear).tint(tint).labelsHidden()
                .widgetAccentable()
        }
    }
}

// MARK: - Tonight's Pick

struct TonightsPickWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Shared.widgetKindPick, provider: SnapshotProvider(rotatesPicks: true)) { e in
            TonightsPickView(entry: e).containerBackground(for: .widget) {
                WidgetBackdrop(snapshot: e.snapshot, art: e.snapshot.picks[safe: e.pickIndex]?.thumb)
            }
        }
        .configurationDisplayName("Tonight's Pick")
        .description("A well-rated title from your library you haven't seen. Changes every hour.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

struct TonightsPickView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry
    private var tint: Color { entry.snapshot.accent }

    var body: some View {
        if let p = entry.snapshot.picks[safe: entry.pickIndex] {
            Group {
                switch family {
                case .systemSmall: small(p)
                case .systemLarge: large(p)
                default: medium(p)
                }
            }
            .foregroundStyle(.white)
            .widgetURL(DeepLink.item(p.id).url)
        } else {
            Empty(symbol: "dice.fill", title: "No picks yet", text: "Add a source in Lumen to get picks.", tint: tint).padding(14)
        }
    }

    private func small(_ p: WidgetItem) -> some View {
        ZStack(alignment: .bottomLeading) {
            Thumb(name: p.thumb).frame(maxWidth: .infinity, maxHeight: .infinity).clipped()
            LinearGradient(stops: [.init(color: .clear, location: 0.35), .init(color: .black.opacity(0.92), location: 1)], startPoint: .top, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 3) {
                Text("TONIGHT").font(.system(size: 9.5, weight: .heavy)).tracking(1.2).foregroundStyle(tint).widgetAccentable()
                Text(p.title).font(.system(size: 15, weight: .bold)).lineLimit(2)
                if let s = p.subtitle, !s.isEmpty { Text(s).font(.system(size: 10.5, weight: .medium)).foregroundStyle(.white.opacity(0.65)) }
            }
            .padding(13)
        }
    }

    private func medium(_ p: WidgetItem) -> some View {
        HStack(spacing: 14) {
            Card(name: p.thumb, radius: 12).aspectRatio(2/3, contentMode: .fit)
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow(title: "Tonight's Pick", symbol: "dice.fill", tint: tint)
                Spacer(minLength: 0)
                Text(p.title).font(.system(size: 19, weight: .bold)).lineLimit(2).minimumScaleFactor(0.8)
                chips(p)
                playPill
            }
        }
        .padding(14)
    }

    private func large(_ p: WidgetItem) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Eyebrow(title: "Tonight's Pick", symbol: "dice.fill", tint: tint, trailing: "changes hourly")
            HStack(alignment: .bottom, spacing: 14) {
                Card(name: p.thumb, radius: 14).aspectRatio(2/3, contentMode: .fit).frame(maxHeight: 210)
                VStack(alignment: .leading, spacing: 8) {
                    Text(p.title).font(.system(size: 24, weight: .heavy)).lineLimit(3).minimumScaleFactor(0.7)
                    chips(p)
                    playPill
                }
            }
            Spacer(minLength: 0)
            let more = entry.snapshot.picks.enumerated().filter { $0.offset != entry.pickIndex }.prefix(4).map(\.element)
            if !more.isEmpty {
                Text("ALSO TONIGHT").font(.system(size: 9.5, weight: .heavy)).tracking(1.1).foregroundStyle(.white.opacity(0.45))
                HStack(spacing: 8) {
                    ForEach(more) { m in
                        Link(destination: DeepLink.item(m.id).url) { Card(name: m.thumb, radius: 8).aspectRatio(2/3, contentMode: .fit) }
                    }
                }
                .frame(height: 78)
            }
        }
        .padding(16)
    }

    private func chips(_ p: WidgetItem) -> some View {
        HStack(spacing: 5) {
            chip(p.kind == "series" ? "Series" : "Movie")
            if let s = p.subtitle, !s.isEmpty { chip(s) }
        }
    }

    private func chip(_ t: String) -> some View {
        Text(t).font(.system(size: 10, weight: .semibold)).lineLimit(1)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(.white.opacity(0.14), in: Capsule())
            .overlay(Capsule().strokeBorder(.white.opacity(0.1), lineWidth: 1))
    }

    private var playPill: some View {
        Label("Watch", systemImage: "play.fill").font(.system(size: 11.5, weight: .bold))
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(LinearGradient(colors: [tint, tint.opacity(0.75)], startPoint: .top, endPoint: .bottom), in: Capsule())
            .shadow(color: tint.opacity(0.5), radius: 6, y: 2)
            .widgetAccentable()
    }
}

// MARK: - Library stats (Liquid Glass)

struct LibraryStatsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Shared.widgetKindStats, provider: SnapshotProvider()) { e in
            LibraryStatsView(snapshot: e.snapshot).containerBackground(for: .widget) { GlassBackdrop(snapshot: e.snapshot) }
        }
        .configurationDisplayName("Library")
        .description("How big your library is.")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()
    }
}

/// Colourful light blobs behind the glass, so the glass has something to bend.
struct GlassBackdrop: View {
    let snapshot: WidgetSnapshot
    var body: some View {
        let a = snapshot.accent
        let g = snapshot.glow
        ZStack {
            Color(red: 0.04, green: 0.04, blue: 0.06)
            GeometryReader { geo in
                let w = geo.size.width, h = geo.size.height
                Circle().fill(a.opacity(0.85)).frame(width: w * 0.75).blur(radius: 36).position(x: w * 0.12, y: h * 0.1)
                Circle().fill((g.first ?? .purple).opacity(0.9)).frame(width: w * 0.7).blur(radius: 40).position(x: w * 0.95, y: h * 0.35)
                Circle().fill(Color.orange.opacity(0.45)).frame(width: w * 0.5).blur(radius: 40).position(x: w * 0.3, y: h * 1.0)
                Circle().fill((g.dropFirst().first ?? .blue).opacity(0.8)).frame(width: w * 0.55).blur(radius: 36).position(x: w * 0.85, y: h * 1.05)
            }
        }
    }
}

/// Frosted glass drawn by hand: a tinted translucent body, a bright top rim, an inner highlight and a soft drop shadow.
extension View {
    func glassCard(tint: Color, radius: CGFloat) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return self
            .background {
                ZStack {
                    shape.fill(.white.opacity(0.05))
                    shape.fill(tint)
                    shape.fill(LinearGradient(colors: [.white.opacity(0.22), .white.opacity(0.0)], startPoint: .top, endPoint: .center))
                }
            }
            .overlay(shape.strokeBorder(LinearGradient(colors: [.white.opacity(0.55), .white.opacity(0.08), .white.opacity(0.22)], startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1))
            .shadow(color: .black.opacity(0.25), radius: 8, y: 4)
    }
}

struct LibraryStatsView: View {
    @Environment(\.widgetFamily) private var family
    let snapshot: WidgetSnapshot
    private var tint: Color { snapshot.accent }
    private var total: Int { snapshot.movieCount + snapshot.seriesCount + snapshot.channelCount }

    var body: some View {
        Group {
            if family == .systemMedium {
                HStack(spacing: 8) {
                    hero.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                        .padding(14)
                        .glassCard(tint: tint.opacity(0.12), radius: 18)
                    grid.frame(width: 176)
                }
                .padding(10)
            } else {
                VStack(spacing: 8) {
                    hero.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 6).padding(.top, 4)
                    grid.frame(maxHeight: .infinity)
                }
                .padding(9)
            }
        }
        .foregroundStyle(.white)
        .widgetURL(DeepLink.home.url)
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 5) {
                Image(systemName: "square.stack.fill").font(.system(size: 9, weight: .heavy)).widgetAccentable()
                Text("LIBRARY").font(.system(size: 9.5, weight: .heavy)).tracking(1.1)
            }
            .foregroundStyle(.white.opacity(0.75))
            if family == .systemMedium { Spacer(minLength: 0) }
            Text(total.formatted(.number.notation(.compactName)))
                .font(.system(size: family == .systemMedium ? 40 : 30, weight: .heavy, design: .rounded).monospacedDigit())
                .shadow(color: .black.opacity(0.25), radius: 6, y: 2)
            if family == .systemMedium {
                Text("titles & channels").font(.system(size: 10, weight: .medium)).foregroundStyle(.white.opacity(0.6))
            }
        }
    }

    private var grid: some View {
        Grid(horizontalSpacing: family == .systemSmall ? 6 : 7, verticalSpacing: family == .systemSmall ? 6 : 7) {
            GridRow {
                tile("dot.radiowaves.left.and.right", snapshot.channelCount, "Live", .red)
                tile("film.fill", snapshot.movieCount, family == .systemSmall ? "Films" : "Movies", .orange)
            }
            GridRow {
                tile("tv.fill", snapshot.seriesCount, "Series", .indigo)
                tile("bookmark.fill", snapshot.watchlistCount, family == .systemSmall ? "List" : "My List", tint)
            }
        }
    }

    @ViewBuilder private func tileContent(_ symbol: String, _ n: Int, _ label: String, _ color: Color) -> some View {
        let icon = Image(systemName: symbol).font(.system(size: 11, weight: .bold)).foregroundStyle(color).widgetAccentable()
        let count = Text(n.formatted(.number.notation(.compactName))).font(.system(size: 13, weight: .bold, design: .rounded).monospacedDigit())
        let name = Text(label).font(.system(size: 9, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
        if family == .systemSmall {
            HStack(spacing: 4) {
                icon.frame(width: 12)
                VStack(alignment: .leading, spacing: 0) { count.minimumScaleFactor(0.6).lineLimit(1); name.minimumScaleFactor(0.8).lineLimit(1) }
                Spacer(minLength: 0)
            }
        } else {
            VStack(alignment: .leading, spacing: 2) { icon; count; name }
        }
    }

    private func tile(_ symbol: String, _ n: Int, _ label: String, _ color: Color) -> some View {
        tileContent(symbol, n, label, color)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .padding(.horizontal, family == .systemSmall ? 6 : 8).padding(.vertical, 5)
            .glassCard(tint: color.opacity(0.34), radius: 14)
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
            ControlWidgetButton(action: OpenLumenLinkIntent(.random)) { Label("Surprise Me", systemImage: "dice.fill").tint(.purple) }
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
                Label(first?.title ?? "Continue Watching", systemImage: "play.circle.fill").tint(Shared.readSnapshot().accent)
            }
        }
        .displayName("Lumen: Continue Watching")
        .description("Resumes what you were watching.")
    }
}

struct SearchControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "SearchControl") {
            ControlWidgetButton(action: OpenLumenLinkIntent(.search(""))) { Label("Search", systemImage: "magnifyingglass").tint(.blue) }
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
                Label(c?.name ?? "Live TV", systemImage: "dot.radiowaves.left.and.right").tint(.red)
            }
        }
        .displayName("Lumen: Favorite Channel")
        .description("Tunes to your first favorite channel.")
    }
}

struct OpenLumenControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "OpenLumenControl") {
            ControlWidgetButton(action: OpenLumenLinkIntent(.home)) { Label("Lumen", systemImage: "sparkles.tv").tint(Shared.readSnapshot().accent) }
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
        movieCount: 48210, seriesCount: 9312, channelCount: 12480, watchlistCount: 17, updatedAt: .now, accentHex: "#0A84FF", glowHex: ["#123470", "#140E28"])
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

#Preview(as: .systemMedium) { ContinueWatchingWidget() } timeline: { SnapshotEntry(date: .now, snapshot: .preview) }
#Preview(as: .systemLarge) { LiveNowWidget() } timeline: { SnapshotEntry(date: .now, snapshot: .preview) }
#Preview(as: .systemLarge) { TonightsPickWidget() } timeline: { SnapshotEntry(date: .now, snapshot: .preview) }

#Preview(as: .systemMedium) { LibraryStatsWidget() } timeline: { SnapshotEntry(date: .now, snapshot: .preview) }
#Preview(as: .systemSmall) { LibraryStatsWidget() } timeline: { SnapshotEntry(date: .now, snapshot: .preview) }
