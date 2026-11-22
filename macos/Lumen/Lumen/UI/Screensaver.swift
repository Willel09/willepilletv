// Full-window artwork slideshow after a few idle minutes. Any key, click or real mouse movement ends it.
import SwiftUI
#if os(macOS)
import AppKit
#endif

struct ScreensaverView: View {
    @Environment(AppModel.self) private var model
    @State private var titles: [Item] = []
    @State private var index = 0
    @State private var now = Date.now

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if !titles.isEmpty { slide(titles[index % titles.count]).id(index).transition(.opacity) }
            VStack {
                HStack { Spacer(); Text(now, format: .dateTime.hour().minute()).font(.system(size: 28, weight: .light)).monospacedDigit().foregroundStyle(.white.opacity(0.8)) }.padding(40)
                Spacer()
            }
        }
        .animation(.easeInOut(duration: 1.8), value: index)
        .onAppear { titles = pick(24) }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(14))
                index += 1
                now = .now
            }
        }
    }

    private func slide(_ t: Item) -> some View {
        let right = index % 2 == 1
        return ZStack {
            if let b = (t.kind == .series ? t.backdrop : nil) {
                Artwork(source: b, size: "w1280").scaleEffect(1.12).ignoresSafeArea().opacity(0.8)
            }
            LinearGradient(colors: [.black.opacity(0.7), .black.opacity(0.4), .black.opacity(0.85)], startPoint: .top, endPoint: .bottom)
            HStack(spacing: 56) {
                if right { Spacer(minLength: 0) }
                if !right { poster(t) }
                VStack(alignment: .leading, spacing: 14) {
                    Text(t.kind == .movie ? "MOVIE" : "SERIES").font(.system(size: 13, weight: .semibold)).tracking(3).foregroundStyle(.white.opacity(0.6))
                    Text(SearchKit.cleanTitle(t.name)).font(.system(size: 60, weight: .heavy)).tracking(-2).lineLimit(3).minimumScaleFactor(0.6)
                    HStack(spacing: 16) {
                        if let y = t.year { Text(y) }
                        if let r = t.rating { HStack(spacing: 5) { Image(systemName: "star.fill").foregroundStyle(.yellow); Text(r, format: .number.precision(.fractionLength(1))) } }
                    }.font(.title3).foregroundStyle(.white.opacity(0.75))
                }
                .frame(maxWidth: 620, alignment: .leading)
                if right { poster(t) }
                if !right { Spacer(minLength: 0) }
            }
            .padding(.horizontal, 100)
            .foregroundStyle(.white)
        }
    }

    private func poster(_ t: Item) -> some View {
        Artwork(source: t.artwork, size: "w500").frame(width: 300, height: 450).clipShape(.rect(cornerRadius: 24))
            .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(.white.opacity(0.15)))
            .shadow(color: .black.opacity(0.8), radius: 50, y: 30)
    }

    private func pick(_ n: Int) -> [Item] {
        let pool: [Item] = model.movies.map(Item.movie) + model.series.map(Item.series)
        guard !pool.isEmpty else { return [] }
        var out: [Item] = []; var seen = Set<String>()
        for tries in 0..<1500 where out.count < n {
            guard let x = pool.randomElement(), x.artwork != nil, seen.insert(x.id).inserted else { continue }
            if (x.rating ?? 0) < (tries < 800 ? 6.5 : 0.1) { seen.remove(x.id); continue }
            out.append(x)
        }
        return out
    }
}

#if os(macOS)
/// Watches for input; starts the screensaver after `screensaverMins` idle (never while something plays).
struct IdleWatcher: ViewModifier {
    @Environment(AppModel.self) private var model
    @State private var last = Date.now
    @State private var monitor: Any?
    @State private var lastPoint: NSPoint = .zero

    func body(content: Content) -> some View {
        content
            .overlay { if model.screensaverOn { ScreensaverView().transition(.opacity) } }
            .animation(.easeInOut(duration: 0.6), value: model.screensaverOn)
            .onAppear {
                monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .rightMouseDown, .scrollWheel, .mouseMoved]) { e in
                    if e.type == .mouseMoved {
                        let p = e.locationInWindow
                        guard hypot(p.x - lastPoint.x, p.y - lastPoint.y) > 6 else { return e }
                        lastPoint = p
                    }
                    last = .now
                    if AppModel.shared.screensaverOn { AppModel.shared.screensaverOn = false; return nil }
                    return e
                }
            }
            .onDisappear { if let monitor { NSEvent.removeMonitor(monitor) } }
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(10))
                    let mins = model.settings.screensaverMins
                    guard mins > 0, !model.screensaverOn, model.hasContent, !model.pickingProfile else { continue }
                    if model.activePlayer?.isPlaying == true { last = .now; continue }
                    if Date.now.timeIntervalSince(last) >= Double(mins) * 60, NSApp.isActive { model.screensaverOn = true }
                }
            }
    }
}

/// ⌘V anywhere (outside a text field) plays a copied stream link.
struct PasteToPlay: ViewModifier {
    @Environment(\.openWindow) private var openWindow
    @State private var monitor: Any?

    func body(content: Content) -> some View {
        content
            .onAppear {
                monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { e in
                    guard e.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command, e.charactersIgnoringModifiers == "v",
                          !(NSApp.keyWindow?.firstResponder is NSTextView) else { return e }
                    guard let text = NSPasteboard.general.string(forType: .string) else { return e }
                    return AppModel.shared.playPasted(text, openWindow: openWindow) ? nil : e
                }
            }
            .onDisappear { if let monitor { NSEvent.removeMonitor(monitor) } }
    }
}
#else
struct IdleWatcher: ViewModifier {
    @Environment(AppModel.self) private var model
    func body(content: Content) -> some View {
        content.overlay { if model.screensaverOn { ScreensaverView().onTapGesture { model.screensaverOn = false }.transition(.opacity) } }
    }
}
struct PasteToPlay: ViewModifier { func body(content: Content) -> some View { content } }
#endif
