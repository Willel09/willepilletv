// Reusable SwiftUI building blocks: artwork, cards, shelves, glass panels, badges.
import SwiftUI
import CoreImage

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
    /// Called with the image's average colour once it has loaded (used for the ambient glow).
    var onColor: ((Color) -> Void)? = nil
    @State private var image: PlatformImage?
    @State private var loading = false

    var body: some View {
        ZStack {
            if let image {
                Image(platformImage: image).resizable().aspectRatio(contentMode: contentMode)
                    .transition(.opacity)
            } else if loading {
                Rectangle().fill(.white.opacity(0.05)).shimmer()
            } else {
                Rectangle().fill(.white.opacity(0.06))
                    .overlay(Image(systemName: placeholder).font(.title2).foregroundStyle(.tertiary))
            }
        }
        .animation(.easeOut(duration: 0.28), value: image == nil)
        .task(id: source) {
            image = nil
            guard let url = source?.artURL(size: size) else { loading = false; return }
            loading = true
            let w = Int(size.dropFirst()) ?? 342
            let img = await ImageCache.shared.image(for: url, maxPixel: Int(Double(w) * 1.5))
            guard !Task.isCancelled else { return }
            image = img
            loading = false
            if let img, let onColor, let c = await AmbientColor.shared.color(for: url.absoluteString, image: img) { onColor(c) }
        }
    }
}

// MARK: - Ambient colour

/// Average colour of an artwork, boosted so it reads as a glow. Cached by URL.
actor AmbientColor {
    static let shared = AmbientColor()
    private var cache: [String: Color] = [:]
    private let ctx = CIContext(options: [.workingColorSpace: NSNull()])

    func color(for key: String, image: PlatformImage) -> Color? {
        if let c = cache[key] { return c }
        #if os(macOS)
        guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        #else
        guard let cg = image.cgImage else { return nil }
        #endif
        let ci = CIImage(cgImage: cg)
        guard let f = CIFilter(name: "CIAreaAverage", parameters: [kCIInputImageKey: ci, kCIInputExtentKey: CIVector(cgRect: ci.extent)]),
              let out = f.outputImage else { return nil }
        var px = [UInt8](repeating: 0, count: 4)
        ctx.render(out, toBitmap: &px, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBA8, colorSpace: nil)
        // push saturation and brightness up: a raw average is usually muddy brown
        var h: CGFloat = 0, sat: CGFloat = 0, b: CGFloat = 0
        #if os(macOS)
        let ns = NSColor(red: CGFloat(px[0]) / 255, green: CGFloat(px[1]) / 255, blue: CGFloat(px[2]) / 255, alpha: 1)
        ns.usingColorSpace(.sRGB)?.getHue(&h, saturation: &sat, brightness: &b, alpha: nil)
        #else
        UIColor(red: CGFloat(px[0]) / 255, green: CGFloat(px[1]) / 255, blue: CGFloat(px[2]) / 255, alpha: 1).getHue(&h, saturation: &sat, brightness: &b, alpha: nil)
        #endif
        let c = Color(hue: h, saturation: min(1, sat * 1.6 + 0.12), brightness: min(0.9, max(0.45, b * 1.35)))
        cache[key] = c
        return c
    }
}

/// The colour picked up from whatever artwork is in focus (Home hero, Detail).
@MainActor @Observable final class Ambient {
    static let shared = Ambient()
    var color: Color?
}

// MARK: - Shimmer (skeleton loading)

private struct Shimmer: ViewModifier {
    @State private var phase: CGFloat = -1
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content
            .overlay {
                GeometryReader { g in
                    LinearGradient(colors: [.clear, .white.opacity(0.09), .clear], startPoint: .leading, endPoint: .trailing)
                        .frame(width: g.size.width * 0.8)
                        .offset(x: phase * g.size.width * 1.4)
                }
                .allowsHitTesting(false)
            }
            .clipped()
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.3).repeatForever(autoreverses: false)) { phase = 1 }
            }
    }
}

extension View {
    func shimmer() -> some View { modifier(Shimmer()) }
}

/// Placeholder shelf shown while the library loads for the first time.
struct SkeletonShelf: View {
    var poster: CGFloat = Metrics.poster
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            RoundedRectangle(cornerRadius: 6).fill(.white.opacity(0.08)).frame(width: 180, height: 18).shimmer()
            HStack(spacing: 18) {
                ForEach(0..<9, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 8) {
                        RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.white.opacity(0.06))
                            .frame(width: poster, height: poster * 1.5).shimmer()
                            .clipShape(.rect(cornerRadius: 16, style: .continuous))
                        RoundedRectangle(cornerRadius: 4).fill(.white.opacity(0.07)).frame(width: poster * 0.75, height: 11)
                        RoundedRectangle(cornerRadius: 4).fill(.white.opacity(0.05)).frame(width: poster * 0.4, height: 9)
                    }
                }
            }
        }
        .padding(.horizontal, Platform.isPhone ? 20 : 56)
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipped()
        .accessibilityHidden(true)
    }
}

// MARK: - Interface sounds

enum UISound {
    case start, done, tap
    @MainActor static func play(_ s: UISound) {
        #if os(macOS)
        guard UserDefaults.standard.object(forKey: "uiSounds") as? Bool ?? true else { return }
        let name: String = switch s { case .start: "Pop"; case .done: "Glass"; case .tap: "Tink" }
        guard let snd = NSSound(named: NSSound.Name(name)) else { return }
        snd.volume = s == .tap ? 0.25 : 0.4
        snd.play()
        #endif
    }
}

// MARK: - Heart burst

/// Little hearts that fly out when something is favorited.
struct HeartBurst: View {
    let trigger: Int
    var tint: Color = .pink
    @State private var fire = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            ForEach(0..<8, id: \.self) { i in
                let a = Double(i) / 8 * 2 * .pi
                Image(systemName: "heart.fill").font(.system(size: i.isMultiple(of: 2) ? 9 : 6, weight: .bold))
                    .foregroundStyle(tint)
                    .offset(x: fire ? cos(a) * 30 : 0, y: fire ? sin(a) * 30 : 0)
                    .scaleEffect(fire ? 0.4 : 1)
                    .opacity(fire ? 0 : 1)
            }
        }
        .opacity(trigger == 0 ? 0 : 1)
        .allowsHitTesting(false)
        .onChange(of: trigger) {
            guard !reduceMotion else { return }
            fire = false
            withAnimation(.easeOut(duration: 0.6)) { fire = true }
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
    /// Tint the top of the page with the colour of the artwork in focus.
    var ambient = false
    var body: some View {
        let t = model.theme
        let k: Double = model.settings.ambient == .strong ? 0.75 : model.settings.ambient == .subtle ? 0.45 : 0.12
        ZStack {
            t.baseColor
            RadialGradient(colors: [t.glowColors[0].opacity(k), .clear], center: .topLeading, startRadius: 0, endRadius: 760)
            RadialGradient(colors: [t.glowColors[1].opacity(k * 0.9), .clear], center: .topTrailing, startRadius: 0, endRadius: 640)
            if ambient, let c = Ambient.shared.color, model.settings.ambient != .off {
                RadialGradient(colors: [c.opacity(k * 0.7), c.opacity(k * 0.18), .clear], center: .init(x: 0.5, y: 0.05), startRadius: 0, endRadius: 1100)
                    .blendMode(.plusLighter)
                    .transition(.opacity)
            }
            // soft vignette keeps the lower half calm so posters carry the page
            LinearGradient(colors: [.clear, t.baseColor.opacity(0.55)], startPoint: .center, endPoint: .bottom)
        }
        .animation(.easeInOut(duration: 1.1), value: ambient ? Ambient.shared.color : nil)
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
            .background(prominent ? AnyShapeStyle(Color.white) : AnyShapeStyle(.ultraThinMaterial), in: Capsule())
            .overlay(Capsule().strokeBorder(.white.opacity(prominent ? 0 : 0.14), lineWidth: 1))
            .shadow(color: .black.opacity(prominent ? 0.25 : 0), radius: 10, y: 4)
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
    /// pointer position over the poster, -1...1 on each axis
    @State private var tilt: CGPoint = .zero
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Artwork(source: item.artwork, placeholder: item.kind == .series ? "tv" : "film")
                .frame(width: width, height: width * 1.5)
                .overlay {
                    // soft light that follows the pointer
                    if hovering && !reduceMotion {
                        RadialGradient(colors: [.white.opacity(0.22), .clear], center: UnitPoint(x: 0.5 + tilt.x / 2, y: 0.5 + tilt.y / 2), startRadius: 0, endRadius: width)
                            .blendMode(.plusLighter).allowsHitTesting(false)
                    }
                }
                .clipShape(.rect(cornerRadius: 16, style: .continuous))
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
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(
                    LinearGradient(colors: [.white.opacity(hovering ? 0.5 : 0.18), .white.opacity(0.02)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
                .shadow(color: .black.opacity(hovering ? 0.6 : 0.35), radius: hovering ? 22 : 10, y: hovering ? 12 : 5)
                .rotation3DEffect(.degrees(reduceMotion ? 0 : Double(-tilt.y) * 7), axis: (x: 1, y: 0, z: 0), perspective: 0.6)
                .rotation3DEffect(.degrees(reduceMotion ? 0 : Double(tilt.x) * 7), axis: (x: 0, y: 1, z: 0), perspective: 0.6)
                .hoverLift(hovering)
                #if os(macOS)
                .onContinuousHover { phase in
                    switch phase {
                    case .active(let p):
                        let next = CGPoint(x: (p.x / width) * 2 - 1, y: (p.y / (width * 1.5)) * 2 - 1)
                        withAnimation(.interactiveSpring(response: 0.25, dampingFraction: 0.8)) { tilt = next }
                    case .ended:
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) { tilt = .zero }
                    }
                }
                #endif
            Text(SearchKit.cleanTitle(item.name)).font(.system(size: 13, weight: .semibold)).lineLimit(1).padding(.top, 2)
            Text([item.year, item.kind == .series ? "Series" : nil].compactMap { $0 }.joined(separator: " · "))
                .font(.system(size: 11.5, weight: .medium)).foregroundStyle(.white.opacity(0.5)).lineLimit(1)
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
    var width: CGFloat = Platform.isPhone ? 250 : 400
    @State private var hovering = false

    var body: some View {
        let h = width * 9 / 16
        ZStack(alignment: .bottomLeading) {
            Artwork(source: model.item(entry.itemId)?.backdrop ?? entry.artwork, size: "w780")
                .frame(width: width, height: h)
                .scaleEffect(hovering ? 1.05 : 1)
            LinearGradient(stops: [.init(color: .clear, location: 0.35), .init(color: .black.opacity(0.85), location: 1)], startPoint: .top, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .center, spacing: 12) {
                    Image(systemName: "play.fill").font(.system(size: 15, weight: .bold)).foregroundStyle(.black)
                        .frame(width: 44, height: 44)
                        .background(.white.opacity(hovering ? 1 : 0.9), in: Circle())
                        .shadow(color: .black.opacity(0.35), radius: 8, y: 3)
                        .scaleEffect(hovering ? 1.08 : 1)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(SearchKit.cleanTitle(entry.name)).font(.system(size: 17, weight: .bold)).lineLimit(1)
                        Text(entry.subtitle ?? remaining).font(.system(size: 12.5, weight: .medium)).foregroundStyle(.white.opacity(0.65)).lineLimit(1)
                    }
                }
                Capsule().fill(.white.opacity(0.25)).frame(height: 4)
                    .overlay(alignment: .leading) { Capsule().fill(.white).scaleEffect(x: max(0.02, entry.progress), anchor: .leading) }
            }
            .padding(.horizontal, 20).padding(.bottom, 18)
        }
        .frame(width: width, height: h)
        .clipShape(.rect(cornerRadius: 22, style: .continuous))
        .overlay(alignment: .topLeading) {
            Button { withAnimation(.snappy) { model.removeFromContinue(entry) } } label: {
                Label("Remove", systemImage: "xmark").font(.system(size: 13, weight: .semibold))
                    .padding(.horizontal, 12).frame(height: 30)
                    .background(.black.opacity(0.55), in: Capsule())
                    .overlay(Capsule().strokeBorder(.white.opacity(0.14), lineWidth: 1))
            }
            .buttonStyle(RailPressStyle())
            .padding(12)
            .opacity(hovering ? 1 : 0.0001)
            .help("Remove from Continue Watching")
        }
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(.white.opacity(hovering ? 0.35 : 0.1), lineWidth: 1))
        .shadow(color: .black.opacity(hovering ? 0.55 : 0.3), radius: hovering ? 24 : 12, y: hovering ? 14 : 6)
        .scaleEffect(hovering ? 1.02 : 1)
        .contentShape(.rect(cornerRadius: 22))
        .onHover { hovering = $0 }
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: hovering)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(entry.name), \(remaining)")
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
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                if let symbol { Image(systemName: symbol).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white.opacity(0.55)) }
                Text(title).font(.system(size: 21, weight: .bold)).tracking(-0.4)
                if let subtitle { Text(subtitle).font(.system(size: 13, weight: .medium)).foregroundStyle(.white.opacity(0.5)) }
                Spacer()
                if let seeAll {
                    Button(action: seeAll) {
                        HStack(spacing: 3) { Text("See All"); Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)) }
                            .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(.white.opacity(0.08), in: Capsule())
                    }
                    .buttonStyle(.plain)
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

    @Environment(AppModel.self) private var model
    @State private var float = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle().fill(model.accent.opacity(0.22)).frame(width: 130, height: 130).blur(radius: 30)
                Circle().fill(.ultraThinMaterial).frame(width: 88, height: 88)
                    .overlay(Circle().fill(LinearGradient(colors: [model.accent.opacity(0.35), model.accent.opacity(0.08)], startPoint: .top, endPoint: .bottom)))
                    .overlay(Circle().strokeBorder(LinearGradient(colors: [.white.opacity(0.35), .white.opacity(0.04)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
                    .shadow(color: model.accent.opacity(0.35), radius: 18, y: 8)
                Image(systemName: symbol).font(.system(size: 34, weight: .semibold)).foregroundStyle(.white)
                    .symbolRenderingMode(.hierarchical)
            }
            .offset(y: float ? -5 : 3)
            .padding(.bottom, 8)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 2.6).repeatForever(autoreverses: true)) { float = true }
            }
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

/// Small press-down for custom buttons.
struct RailPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.98 : 1).animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

/// Soft ring that breathes out from a button, to say "you can pick up where you left off".
struct PulseHalo: View {
    @State private var on = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        Capsule().strokeBorder(.white.opacity(on ? 0 : 0.55), lineWidth: 2)
            .scaleEffect(x: on ? 1.12 : 1, y: on ? 1.4 : 1)
            .allowsHitTesting(false)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeOut(duration: 1.8).repeatForever(autoreverses: false)) { on = true }
            }
    }
}
