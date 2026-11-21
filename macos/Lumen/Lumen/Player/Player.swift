import SwiftUI
import AVKit
import AVFoundation
import MediaPlayer
import Combine

extension AppModel {
    /// Play in the single player window (opens it, or swaps what it plays).
    func play(_ open: OpenWindowAction, _ req: PlaybackRequest) {
        nowPlaying = req
        #if os(macOS)
        open(id: "player")
        #else
        showPlayer = true
        #endif
    }
}

@Observable
final class PlayerModel {
    let player = AVPlayer()
    private(set) var request: PlaybackRequest?
    var error: String?
    var isPlaying = false
    var buffering = true
    var upNext: PlaybackRequest?
    var upNextCountdown = 0
    var sleepAt: Date?
    var channelEntry = ""

    private var timeObserver: Any?
    private var cancellables = Set<AnyCancellable>()
    private var lastSaved: Double = 0
    private let model = AppModel.shared

    init() {
        player.allowsExternalPlayback = true
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback, policy: .longFormVideo)
        try? AVAudioSession.sharedInstance().setActive(true)
        player.audiovisualBackgroundPlaybackPolicy = .continuesIfPossible
        #endif
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 1, preferredTimescale: 2), queue: .main) { [weak self] t in
            MainActor.assumeIsolated { self?.tick(t.seconds) }
        }
        player.publisher(for: \.timeControlStatus).receive(on: RunLoop.main).sink { [weak self] s in
            self?.isPlaying = s == .playing
            self?.buffering = s == .waitingToPlayAtSpecifiedRate
            self?.updateNowPlaying()
        }.store(in: &cancellables)
        NotificationCenter.default.publisher(for: AVPlayerItem.didPlayToEndTimeNotification).receive(on: RunLoop.main).sink { [weak self] n in
            guard let self, (n.object as? AVPlayerItem) === self.player.currentItem else { return }
            Task { await self.didFinish() }
        }.store(in: &cancellables)
        setupRemoteCommands()
    }

    func load(_ req: PlaybackRequest) {
        save()
        request = req
        error = nil
        upNext = nil
        lastSaved = 0
        guard let url = URL(string: req.url) else { error = "This stream has no valid address."; return }
        let ua = model.settings.userAgent.isEmpty ? "Lumen/1.0 (Macintosh)" : model.settings.userAgent
        let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": ["User-Agent": ua]])
        let item = AVPlayerItem(asset: asset)
        item.preferredForwardBufferDuration = req.kind == "live" ? 4 : 0
        item.publisher(for: \.status).receive(on: RunLoop.main).sink { [weak self, weak item] status in
            guard let self, let item, status == .failed else { return }
            self.error = Self.humanError(item.error, url: req.url)
        }.store(in: &cancellables)
        player.replaceCurrentItem(with: item)
        if req.startAt > 5 { player.seek(to: CMTime(seconds: req.startAt, preferredTimescale: 600)) }
        player.play()
        model.record(req, position: req.startAt, duration: 0)
        updateNowPlaying()
    }

    static func humanError(_ e: Error?, url: String) -> String {
        let ext = URL(string: url)?.pathExtension.lowercased() ?? ""
        if ["mkv", "avi", "wmv", "flv", "ts"].contains(ext) {
            return "macOS can't play .\(ext) files itself. Open it in IINA or VLC instead\(ext == "ts" ? ", or switch Live format to HLS in Settings" : "")."
        }
        let ns = e as NSError?
        if ns?.domain == NSURLErrorDomain {
            switch ns?.code {
            case NSURLErrorNotConnectedToInternet: return "You're offline."
            case NSURLErrorTimedOut: return "The provider didn't answer in time. Try again in a moment."
            case NSURLErrorUserAuthenticationRequired, -1013: return "The provider refused the login. Your subscription may have expired."
            default: break
            }
        }
        if let d = ns?.localizedFailureReason ?? ns?.localizedDescription, d.contains("403") || d.contains("401") {
            return "The provider refused this stream. Most providers allow one stream at a time — close it on other devices."
        }
        return "This stream couldn't be played. It may be offline, or in a format macOS can't decode."
    }

    private func tick(_ seconds: Double) {
        guard let req = request, seconds.isFinite else { return }
        if let at = sleepAt, Date.now >= at { player.pause(); sleepAt = nil; model.toast = "Sleep timer: paused" }
        if req.kind != "live", abs(seconds - lastSaved) >= 10 { save() }
    }

    func save() {
        guard let req = request, req.kind != "live" else { return }
        let pos = player.currentTime().seconds
        let dur = player.currentItem?.duration.seconds ?? 0
        guard pos.isFinite, pos > 0 else { return }
        lastSaved = pos
        model.record(req, position: pos, duration: dur.isFinite ? dur : 0)
    }

    func stop() {
        save()
        player.pause()
        player.replaceCurrentItem(with: nil)
        model.publishWidgets()
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    private func didFinish() async {
        save()
        guard let req = request, req.kind == "episode", model.settings.autoplayNext, let next = await model.nextEpisode(after: req) else { return }
        upNext = next
        upNextCountdown = 8
        while upNextCountdown > 0 {
            try? await Task.sleep(for: .seconds(1))
            guard upNext == next else { return }
            upNextCountdown -= 1
        }
        if upNext == next { load(next) }
    }

    func zap(_ offset: Int) {
        guard let req = request, req.kind == "live", let c = model.neighbourChannel(of: req.itemId, offset: offset),
              let r = model.request(for: .live(c)) else { return }
        model.nowPlaying = r
    }

    func jumpToChannel(number: Int) {
        guard let c = model.channels.first(where: { $0.num == number }), let r = model.request(for: .live(c)) else {
            model.toast = "No channel \(number)"; return
        }
        model.nowPlaying = r
    }

    func skip(_ s: Double) {
        let t = player.currentTime().seconds + s
        player.seek(to: CMTime(seconds: max(0, t), preferredTimescale: 600))
    }

    // MARK: Now Playing + media keys

    private func updateNowPlaying() {
        guard let req = request else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: req.title,
            MPNowPlayingInfoPropertyIsLiveStream: req.kind == "live",
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
        ]
        if let s = req.subtitle { info[MPMediaItemPropertyArtist] = s }
        let t = player.currentTime().seconds
        if t.isFinite { info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = t }
        if let d = player.currentItem?.duration.seconds, d.isFinite { info[MPMediaItemPropertyPlaybackDuration] = d }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = isPlaying ? .playing : .paused
    }

    private func setupRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.togglePlayPauseCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { guard let self else { return }; self.isPlaying ? self.player.pause() : self.player.play() }
            return .success
        }
        c.playCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.player.play() }; return .success }
        c.pauseCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.player.pause() }; return .success }
        c.nextTrackCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { guard let self else { return }; self.request?.kind == "live" ? self.zap(1) : self.skip(30) }
            return .success
        }
        c.previousTrackCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { guard let self else { return }; self.request?.kind == "live" ? self.zap(-1) : self.skip(-10) }
            return .success
        }
    }
}

#if os(macOS)
// MARK: - AVPlayerView bridge

struct VideoSurface: NSViewRepresentable {
    let player: AVPlayer
    func makeNSView(context: Context) -> AVPlayerView {
        let v = AVPlayerView()
        v.player = player
        v.controlsStyle = .floating
        v.allowsPictureInPicturePlayback = true
        v.showsFullScreenToggleButton = true
        v.showsSharingServiceButton = false
        v.allowsVideoFrameAnalysis = true
        v.videoGravity = .resizeAspect
        return v
    }
    func updateNSView(_ v: AVPlayerView, context: Context) { if v.player !== player { v.player = player } }
}

/// Lets the SwiftUI view reach its NSWindow (for "Keep on Top" and the title).
struct WindowReader: NSViewRepresentable {
    var onWindow: (NSWindow) -> Void
    func makeNSView(context: Context) -> NSView {
        let v = NSView()
        DispatchQueue.main.async { if let w = v.window { onWindow(w) } }
        return v
    }
    func updateNSView(_ v: NSView, context: Context) { DispatchQueue.main.async { if let w = v.window { onWindow(w) } } }
}

// MARK: - Player window

struct PlayerWindow: View {
    @Environment(AppModel.self) private var model
    @State private var pm = PlayerModel()
    @State private var showChrome = true
    @State private var hideTask: Task<Void, Never>?
    @State private var window: NSWindow?
    @State private var keepOnTop = false
    @State private var mini = false
    @State private var savedFrame: NSRect?
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            Color.black
            VideoSurface(player: pm.player)
            if pm.buffering && pm.error == nil {
                ProgressView().controlSize(.large).tint(.white)
            }
            if let e = pm.error { errorCard(e) }
            if let next = pm.upNext { upNextCard(next) }
            if !pm.channelEntry.isEmpty {
                Text(pm.channelEntry).font(.system(size: 64, weight: .bold).monospacedDigit())
                    .padding(24).glassPanel(cornerRadius: 24)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing).padding(40)
            }
            VStack { (mini ? AnyView(miniBar) : AnyView(topBar)).opacity(showChrome ? 1 : 0); Spacer() }
        }
        .environment(\.colorScheme, .dark)
        .background(WindowReader { w in
            if window !== w { window = w }
            w.title = pm.request?.title ?? "Lumen"
            w.titlebarAppearsTransparent = true
            w.isMovableByWindowBackground = true
        })
        .frame(minWidth: mini ? 300 : 480, minHeight: mini ? 170 : 270)
        .onContinuousHover { phase in
            if case .active = phase { poke() }
        }
        .focusable()
        .focused($focused)
        .focusEffectDisabled()
        .onKeyPress(phases: .down) { press in handleKey(press) }
        .onAppear {
            focused = true
            if let r = model.nowPlaying { pm.load(r) }
            model.activePlayer = pm
            poke()
        }
        .onChange(of: model.nowPlaying) { if let r = model.nowPlaying, r != pm.request { pm.load(r); poke() } }
        .onDisappear {
            pm.stop()
            model.activePlayer = nil
            model.nowPlaying = nil
        }
    }

    /// A small always-on-top player in the corner while you browse.
    func setMini(_ on: Bool) {
        guard let w = window, on != mini else { return }
        if on {
            savedFrame = w.frame
            let vf = (w.screen ?? NSScreen.main)?.visibleFrame ?? w.frame
            w.setFrame(NSRect(x: vf.maxX - 420, y: vf.minY + 24, width: 400, height: 225), display: true, animate: true)
            w.level = .floating
            w.collectionBehavior.insert(.canJoinAllSpaces)
        } else {
            if let f = savedFrame { w.setFrame(f, display: true, animate: true) }
            w.level = keepOnTop ? .floating : .normal
            w.collectionBehavior.remove(.canJoinAllSpaces)
        }
        mini = on
        if on { NSApp.windows.first { $0.identifier?.rawValue.contains("main") == true }?.makeKeyAndOrderFront(nil) }
    }

    private var miniBar: some View {
        HStack(spacing: 8) {
            Text(pm.request?.title ?? "").font(.caption.weight(.semibold)).lineLimit(1)
            Spacer()
            Button { pm.isPlaying ? pm.player.pause() : pm.player.play() } label: { Image(systemName: pm.isPlaying ? "pause.fill" : "play.fill").frame(width: 22, height: 22) }.buttonStyle(.plain)
            Button { setMini(false) } label: { Image(systemName: "arrow.up.left.and.arrow.down.right").frame(width: 22, height: 22) }.buttonStyle(.plain).help("Back to the full player")
            Button { window?.close() } label: { Image(systemName: "xmark").frame(width: 22, height: 22) }.buttonStyle(.plain).help("Close")
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(Color(white: 0.12, opacity: 0.9), in: .rect(cornerRadius: 12))
        .padding(8).padding(.top, 14)
        .allowsHitTesting(showChrome)
    }

    private func poke() {
        withAnimation(.easeOut(duration: 0.2)) { showChrome = true }
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            withAnimation(.easeIn(duration: 0.4)) { showChrome = false }
        }
    }

    private var isLive: Bool { pm.request?.kind == "live" }

    private var topBar: some View {
        HStack(spacing: 12) {
            if let a = pm.request?.artwork, isLive {
                Artwork(source: a, contentMode: .fit, placeholder: "tv").frame(width: 46, height: 30)
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text(pm.request?.title ?? "").font(.headline).lineLimit(1)
                    if isLive { LiveBadge() }
                }
                if let s = liveSubtitle ?? pm.request?.subtitle { Text(s).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
            Spacer()
            Group {
                HStack(spacing: 8) {
                    if isLive {
                        chromeButton("chevron.up", help: "Previous channel (↑)") { pm.zap(-1) }
                        chromeButton("chevron.down", help: "Next channel (↓)") { pm.zap(1) }
                    } else {
                        chromeButton("gobackward.10", help: "Back 10 s (←)") { pm.skip(-10) }
                        chromeButton("goforward.30", help: "Forward 30 s (→)") { pm.skip(30) }
                    }
                    if let id = pm.request?.itemId {
                        chromeButton(model.isFavorite(id) ? "heart.fill" : "heart", help: "Favorite") { model.toggleFavorite(id) }
                    }
                    Menu {
                        Section("Sleep Timer") {
                            ForEach([15, 30, 60, 90], id: \.self) { m in Button("\(m) minutes") { pm.sleepAt = .now.addingTimeInterval(Double(m) * 60); model.toast = "Pausing in \(m) min" } }
                            if pm.sleepAt != nil { Button("Turn Off") { pm.sleepAt = nil } }
                        }
                        Button("Mini Player", systemImage: "rectangle.inset.bottomright.filled") { setMini(true) }
                        Toggle("Keep on Top", isOn: Binding(get: { keepOnTop }, set: { keepOnTop = $0; window?.level = $0 ? .floating : .normal }))
                        if let u = pm.request?.url {
                            Button("Open in \(model.settings.externalPlayer)") { pm.player.pause(); model.openExternally(u) }
                            Button("Copy Stream URL") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(u, forType: .string) }
                        }
                    } label: { Image(systemName: "ellipsis").frame(width: 30, height: 30) }
                    .menuStyle(.button).menuIndicator(.hidden).buttonStyle(LumenButtonStyle()).fixedSize()
                }
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .background(Color(white: 0.13, opacity: 0.92), in: .rect(cornerRadius: 22))
        .padding(.horizontal, 16).padding(.top, 34)
        .allowsHitTesting(showChrome)
    }

    private var liveSubtitle: String? {
        guard isLive, let id = pm.request?.itemId, case .live(let c) = model.item(id), let now = model.nowNext(for: c).now else { return nil }
        return "\(now.title) · until \(now.stop.formatted(date: .omitted, time: .shortened))"
    }

    private func chromeButton(_ symbol: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).frame(width: 30, height: 30) }
            .buttonStyle(LumenButtonStyle()).help(help)
    }

    private func errorCard(_ e: String) -> some View {
        VStack(spacing: 14) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 38)).foregroundStyle(.yellow)
            Text("Can't play this").font(.title2.weight(.bold))
            Text(e).multilineTextAlignment(.center).foregroundStyle(.secondary).frame(maxWidth: 420)
            HStack {
                Button("Try Again") { if let r = pm.request { pm.load(r) } }.buttonStyle(LumenButtonStyle())
                if let u = pm.request?.url {
                    Button("Open in \(model.settings.externalPlayer)") { model.openExternally(u) }.buttonStyle(LumenButtonStyle(prominent: true))
                }
            }
            .controlSize(.large)
        }
        .padding(30)
        .glassPanel(cornerRadius: 26)
    }

    private func upNextCard(_ next: PlaybackRequest) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("UP NEXT IN \(pm.upNextCountdown)").font(.caption.weight(.heavy)).tracking(1.2).foregroundStyle(model.accent)
            Text(next.subtitle ?? next.title).font(.headline).lineLimit(2)
            HStack {
                Button("Play Now") { pm.load(next) }.buttonStyle(LumenButtonStyle(prominent: true))
                Button("Cancel") { pm.upNext = nil }.buttonStyle(LumenButtonStyle())
            }
        }
        .padding(20)
        .frame(width: 320, alignment: .leading)
        .glassPanel(cornerRadius: 22)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
        .padding(.trailing, 30).padding(.bottom, 90)
    }

    private func handleKey(_ press: KeyPress) -> KeyPress.Result {
        poke()
        switch press.key {
        case .space: pm.isPlaying ? pm.player.pause() : pm.player.play(); return .handled
        case .upArrow where isLive: pm.zap(-1); return .handled
        case .downArrow where isLive: pm.zap(1); return .handled
        case .leftArrow where !isLive: pm.skip(-10); return .handled
        case .rightArrow where !isLive: pm.skip(30); return .handled
        case .escape:
            if window?.styleMask.contains(.fullScreen) == true { window?.toggleFullScreen(nil); return .handled }
            return .ignored
        default: break
        }
        if press.characters == "f" { window?.toggleFullScreen(nil); return .handled }
        if press.characters == "m" { setMini(!mini); return .handled }
        if isLive, let d = press.characters.first, d.isNumber {
            pm.channelEntry += String(d)
            let entry = pm.channelEntry
            Task {
                try? await Task.sleep(for: .seconds(1.4))
                if pm.channelEntry == entry, let n = Int(entry) { pm.channelEntry = ""; pm.jumpToChannel(number: n) }
            }
            return .handled
        }
        return .ignored
    }
}
#endif
