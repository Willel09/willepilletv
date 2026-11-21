// Reusable SwiftUI building blocks: artwork, cards, shelves, glass panels, badges.
import SwiftUI

// MARK: - Artwork loading with an in-memory cache

actor ImageCache {
    static let shared = ImageCache()
    private let cache = NSCache<NSString, PlatformImage>()
    private var inflight: [String: Task<PlatformImage?, Never>] = [:]

    init() { cache.countLimit = 600; cache.totalCostLimit = 160 << 20 }

    /// Downloads and decodes at thumbnail size, never at full resolution.
    func image(for url: URL, maxPixel: Int) async -> PlatformImage? {
        let key = "\(url.absoluteString)#\(maxPixel)" as NSString
        if let i = cache.object(forKey: key) { return i }
        if let t = inflight[key as String] { return await t.value }
        let t = Task.detached(priority: .utility) { () -> PlatformImage? in
            var req = URLRequest(url: url)
            req.cachePolicy = .returnCacheDataElseLoad
            guard let (data, _) = try? await URLSession.shared.data(for: req),
                  let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
            let opts: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true,
                                         kCGImageSourceCreateThumbnailWithTransform: true,
                                         kCGImageSourceShouldCacheImmediately: true,
                                         kCGImageSourceThumbnailMaxPixelSize: maxPixel]
            guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
            return Platform.image(cg)
        }
        inflight[key as String] = t
        let img = await t.value
        inflight[key as String] = nil
        if let img { cache.setObject(img, forKey: key, cost: 600_000) }
        return img
    }
}

struct Artwork: View {
    let source: String?
    var size: String = "w342"
    var contentMode: ContentMode = .fill
    var placeholder: String = "film"
    @State private var image: PlatformImage?

    var body: some View {
        ZStack {
            if let image {
                Image(platformImage: image).resizable().aspectRatio(contentMode: contentMode)
            } else {
                Rectangle().fill(.white.opacity(0.06))
                    .overlay(Image(systemName: placeholder).font(.title2).foregroundStyle(.tertiary))
            }
        }
        .task(id: source) {
            image = nil
            guard let url = source?.artURL(size: size) else { return }
            let w = Int(size.dropFirst()) ?? 342
            let img = await ImageCache.shared.image(for: url, maxPixel: Int(Double(w) * 1.5))
            image = img
        }
    }
}

// MARK: - Glass

extension View {
    /// Liquid Glass panel with a soft rim.
    func glassPanel(cornerRadius: CGFloat = 20) -> some View {
        self.background(Color(white: 0.13, opacity: 0.92), in: .rect(cornerRadius: cornerRadius))
    }

    func hoverLift(_ hovering: Bool) -> some View {
        self.scaleEffect(hovering ? 1.04 : 1).animation(.easeOut(duration: 0.14), value: hovering)
    }
}

enum Theme {
    /// reads the current theme, so views that use it redraw when the theme changes
    static var base: Color { AppModel.shared.theme.baseColor }
    static let card = Color.white.opacity(0.06)
}

/// Theme colour with two soft glows in the top corners (strength follows the "Artwork glow" setting).
struct ThemeBackground: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        let t = model.theme
        let k: Double = model.settings.ambient == .strong ? 0.75 : model.settings.ambient == .subtle ? 0.45 : 0.12
        ZStack {
            t.baseColor
            RadialGradient(colors: [t.glowColors[0].opacity(k), .clear], center: .topLeading, startRadius: 0, endRadius: 700)
            RadialGradient(colors: [t.glowColors[1].opacity(k), .clear], center: .topTrailing, startRadius: 0, endRadius: 600)
        }
        .ignoresSafeArea()
    }
}

/// Flat pill buttons like the Windows app: white Play, translucent secondary.
struct LumenButtonStyle: ButtonStyle {
    var prominent = false
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(prominent ? Color.black : Color.white)
            .padding(.horizontal, 18).padding(.vertical, 10)
            .frame(minHeight: 40)
            .background(prominent ? Color.white : Color.white.opacity(0.16), in: Capsule())
            .opacity(enabled ? (configuration.isPressed ? 0.75 : 1) : 0.4)
            .contentShape(Capsule())
    }
}

// MARK: - Badges

struct RatingBadge: View {
    let rating: Double
    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "star.fill").font(.system(size: 9, weight: .bold))
            Text(rating, format: .number.precision(.fractionLength(1))).font(.system(size: 11, weight: .semibold).monospacedDigit())
        }
        .foregroundStyle(rating >= 7.5 ? .yellow : .white)
        .padding(.horizontal, 7).padding(.vertical, 3)
        .background(.black.opacity(0.55), in: Capsule())
    }
}

struct LiveBadge: View {
    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(.red).frame(width: 7, height: 7)
            Text("LIVE").font(.system(size: 10, weight: .heavy)).tracking(0.8)
        }
        .padding(.horizontal, 7).padding(.vertical, 3)
        .background(.black.opacity(0.55), in: Capsule())
    }
}

struct Tag: View {
    let text: String
    var body: some View {
        Text(text).font(.caption.weight(.medium))
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(.white.opacity(0.1), in: Capsule())
            .overlay(Capsule().strokeBorder(.white.opacity(0.12)))
    }
}

struct ProgressBar: View {
    let value: Double
    var tint: Color = .accentColor
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.22))
                Capsule().fill(tint).frame(width: max(4, g.size.width * value))
            }
        }
        .frame(height: 4)
    }
}

// MARK: - Cards

struct PosterCard: View {
    @Environment(AppModel.self) private var model
    let item: Item
    var width: CGFloat = Metrics.poster
    var badge: String?
    @State private var hovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Artwork(source: item.artwork, placeholder: item.kind == .series ? "tv" : "film")
                .frame(width: width, height: width * 1.5)
                .clipShape(.rect(cornerRadius: 14))
                .overlay(alignment: .bottomLeading) {
                    if let badge { Text(badge.uppercased()).font(.system(size: 10, weight: .heavy)).tracking(0.6).padding(.horizontal, 8).padding(.vertical, 3).background(model.accent, in: Capsule()).foregroundStyle(.white).padding(8) }
                }
                .overlay(alignment: .topTrailing) {
                    if let r = item.rating, r > 0 { RatingBadge(rating: r).padding(7) }
                }
                .overlay(alignment: .topLeading) {
                    if model.inWatchlist(item.id) {
                        Image(systemName: "bookmark.fill").font(.caption).padding(6)
                            .background(.black.opacity(0.55), in: Circle()).padding(7)
                    }
                }
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.white.opacity(hovering ? 0.4 : 0.08), lineWidth: 1))
                .hoverLift(hovering)
            Text(SearchKit.cleanTitle(item.name)).font(.callout.weight(.medium)).lineLimit(1)
            Text([item.year, item.kind == .series ? "Series" : nil].compactMap { $0 }.joined(separator: " · "))
                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(width: width)
        .contentShape(.rect)
        .onHover { hovering = $0 }
        .itemContextMenu(item)
    }
}

struct ChannelTile: View {
    @Environment(AppModel.self) private var model
    let channel: Channel
    var width: CGFloat = Platform.isPhone ? 170 : 220
    @State private var hovering = false

    var body: some View {
        let nn = model.nowNext(for: channel)
        VStack(alignment: .leading, spacing: 8) {
            ZStack {
                LinearGradient(colors: [.white.opacity(0.1), .white.opacity(0.03)], startPoint: .topLeading, endPoint: .bottomTrailing)
                Artwork(source: channel.logo, contentMode: .fit, placeholder: "tv")
                    .padding(26)
            }
            .frame(width: width, height: width * 9 / 16)
            .clipShape(.rect(cornerRadius: 14))
            .overlay(alignment: .topLeading) { LiveBadge().padding(8) }
            .overlay(alignment: .topTrailing) {
                if model.isFavorite(channel.id) { Image(systemName: "heart.fill").foregroundStyle(.pink).padding(9) }
            }
            .overlay(alignment: .bottom) {
                if let now = nn.now { ProgressBar(value: now.progress(), tint: model.accent).padding(.horizontal, 10).padding(.bottom, 8) }
            }
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.white.opacity(hovering ? 0.35 : 0.08)))
            .hoverLift(hovering)
            Text(channel.name).font(.callout.weight(.medium)).lineLimit(1)
            Text(nn.now?.title ?? channel.group).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(width: width)
        .contentShape(.rect)
        .onHover { hovering = $0 }
        .itemContextMenu(.live(channel))
    }
}

struct ContinueCard: View {
    @Environment(AppModel.self) private var model
    let entry: HistoryEntry
    var width: CGFloat = Platform.isPhone ? 250 : 300
    @State private var hovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .bottomLeading) {
                Artwork(source: model.item(entry.itemId)?.backdrop ?? entry.artwork, size: "w780")
                    .frame(width: width, height: width * 9 / 16)
                LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .center, endPoint: .bottom)
                HStack {
                    Image(systemName: "play.fill")
                    Text(remaining).font(.caption.weight(.semibold))
                }
                .padding(12)
                .opacity(hovering ? 1 : 0.85)
                ProgressBar(value: entry.progress, tint: model.accent).padding(.horizontal, 12).padding(.bottom, 6)
            }
            .frame(width: width, height: width * 9 / 16)
            .clipShape(.rect(cornerRadius: 14))
            .overlay(alignment: .topTrailing) {
                if hovering {
                    Button { withAnimation { model.removeFromContinue(entry) } } label: {
                        Image(systemName: "xmark").font(.caption.weight(.bold)).padding(7)
                    }
                    .buttonStyle(LumenButtonStyle()).clipShape(Circle()).padding(8)
                    .help("Remove from Continue Watching")
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.white.opacity(hovering ? 0.35 : 0.08)))
            .hoverLift(hovering)
            Text(entry.name).font(.callout.weight(.medium)).lineLimit(1)
            if let s = entry.subtitle { Text(s).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
        }
        .frame(width: width)
        .contentShape(.rect)
        .onHover { hovering = $0 }
    }

    private var remaining: String {
        let left = max(0, entry.duration - entry.position)
        let m = Int(left / 60)
        return m >= 60 ? "\(m / 60) h \(m % 60) min left" : "\(m) min left"
    }
}

// MARK: - Shelf

struct Shelf<Content: View>: View {
    let title: String
    var subtitle: String?
    var symbol: String?
    var seeAll: (() -> Void)?
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if let symbol { Image(systemName: symbol).foregroundStyle(.secondary) }
                Text(title).font(.title2.weight(.bold))
                if let subtitle { Text(subtitle).font(.callout).foregroundStyle(.secondary) }
                Spacer()
                if let seeAll {
                    Button("See All", action: seeAll).buttonStyle(.borderless).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, Metrics.hPad)
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: Platform.isPhone ? 12 : 18) { content() }
                    .macFocusSection()
                    .padding(.horizontal, Metrics.hPad)
                    .padding(.vertical, 12)
            }
            .scrollIndicators(.never)
            .scrollClipDisabled()
        }
    }
}

// MARK: - Empty state

struct EmptyState: View {
    let symbol: String
    let title: String
    let message: String
    var action: (title: String, run: () -> Void)?

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: symbol).font(.system(size: 46, weight: .light)).foregroundStyle(.secondary)
            Text(title).font(.title2.weight(.semibold))
            Text(message).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 420)
            if let action { Button(action.title, action: action.run).buttonStyle(LumenButtonStyle(prominent: true)).controlSize(.large).padding(.top, 6) }
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Ambient background (picks up the focused artwork)

struct AmbientBackground: View {
    var artwork: String?
    var body: some View { ThemeBackground() }
}

// MARK: - Context menu + actions shared by every card

struct PlayAction {
    let model: AppModel
    let openWindow: OpenWindowAction

    func callAsFunction(_ item: Item) {
        if let req = model.request(for: item) { model.play(openWindow, req) }
        else { model.path.append(Route.detail(item)) }
    }
    func callAsFunction(_ req: PlaybackRequest) { model.play(openWindow, req) }
}

extension View {
    func itemContextMenu(_ item: Item) -> some View { modifier(ItemContextMenu(item: item)) }
}

private struct ItemContextMenu: ViewModifier {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    let item: Item

    func body(content: Content) -> some View {
        content.contextMenu {
            if item.kind != .series {
                Button("Play", systemImage: "play.fill") { PlayAction(model: model, openWindow: openWindow)(item) }
            }
            if item.kind != .live {
                Button("Show Details", systemImage: "info.circle") { model.path.append(Route.detail(item)) }
                Button(model.inWatchlist(item.id) ? "Remove from My List" : "Add to My List",
                       systemImage: model.inWatchlist(item.id) ? "bookmark.slash" : "bookmark") { model.toggleWatchlist(item.id) }
            }
            Button(model.isFavorite(item.id) ? "Remove from Favorites" : "Add to Favorites",
                   systemImage: model.isFavorite(item.id) ? "heart.slash" : "heart") { model.toggleFavorite(item.id) }
            Divider()
            if case .live(let c) = item, let u = model.streamURL(for: c) {
                Button("Open in \(model.settings.externalPlayer)", systemImage: "arrow.up.forward.app") { model.openExternally(u) }
                Button("Copy Stream URL", systemImage: "doc.on.doc") { Pasteboard.copy(u) }
            }
            if case .movie(let m) = item, let u = model.streamURL(for: m) {
                Button("Open in \(model.settings.externalPlayer)", systemImage: "arrow.up.forward.app") { model.openExternally(u) }
            }
            ShareLink(item: DeepLink.item(item.id).url) { Label("Share Link", systemImage: "square.and.arrow.up") }
        }
    }
}

// MARK: - Toast

struct ToastOverlay: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        VStack {
            Spacer()
            if let t = model.toast {
                Text(t).font(.callout.weight(.medium))
                    .padding(.horizontal, 18).padding(.vertical, 11)
                    .background(Color(white: 0.13, opacity: 0.92), in: Capsule())
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task(id: t) {
                        try? await Task.sleep(for: .seconds(3))
                        withAnimation { model.toast = nil }
                    }
                    .padding(.bottom, 28)
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: model.toast)
        .allowsHitTesting(false)
    }
}

struct SearchField: View {
    @Binding var text: String
    var prompt: String
    var autofocus = false
    @FocusState private var focused: Bool
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.white.opacity(0.5))
            TextField(prompt, text: $text).textFieldStyle(.plain).focused($focused)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.white.opacity(0.4)) }.buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12).frame(height: 34)
        .background(.white.opacity(0.09), in: Capsule())
        .onAppear { if autofocus { focused = true } }
    }
}

struct DownloadCard: View {
    @Environment(AppModel.self) private var model
    let rec: DownloadRec
    @State private var hovering = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Group {
                if let u = model.downloads.posterURL(rec), let img = Platform.image(file: u) { Image(platformImage: img).resizable().aspectRatio(contentMode: .fill) }
                else { Artwork(source: rec.poster) }
            }
            .frame(width: 160, height: 240).clipShape(.rect(cornerRadius: 14))
            .overlay(alignment: .topLeading) { Image(systemName: "arrow.down.circle.fill").padding(8).foregroundStyle(.white, .green) }
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.white.opacity(hovering ? 0.4 : 0.08)))
            .hoverLift(hovering)
            Text(rec.title).font(.callout.weight(.medium)).lineLimit(1)
            if let s = rec.subtitle { Text(s).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
        }
        .frame(width: 160).contentShape(.rect).onHover { hovering = $0 }
    }
}

extension View {
    /// Click, or Return when the card has keyboard focus (arrow keys move between cards).
    func tapOrEnter(_ action: @escaping () -> Void) -> some View {
        self.onTapGesture(perform: action)
            .focusable()
            .onKeyPress(.return) { action(); return .handled }
            .onKeyPress(.space) { action(); return .handled }
    }
}

extension View {
    @ViewBuilder func macFocusSection() -> some View {
        #if os(macOS)
        self.focusSection()
        #else
        self
        #endif
    }
}
