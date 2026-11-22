import SwiftUI

struct DownloadsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        let dl = model.downloads
        let limit = Int64(model.settings.downloadLimitGb) << 30
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Downloads").font(.system(size: 34, weight: .bold)).tracking(-1.2).padding(.horizontal, 6)
                storageCard(used: dl.used, limit: limit, count: dl.items.filter { $0.state == .done }.count)
                if dl.items.isEmpty {
                    VStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 18, style: .continuous).fill(.white.opacity(0.08)).frame(width: 64, height: 64)
                            .overlay(Image(systemName: "arrow.down.circle").font(.system(size: 28, weight: .semibold)).foregroundStyle(.white.opacity(0.7)))
                        Text("Nothing downloaded").font(.system(size: 18, weight: .semibold))
                        Text("Open a movie or an episode and choose Download to watch it offline.").font(.system(size: 13)).foregroundStyle(.white.opacity(0.5))
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 60)
                } else {
                    VStack(spacing: 6) {
                        ForEach(Array(dl.items.enumerated()), id: \.element.id) { i, d in
                            DownloadRow(rec: d).modifier(StaggerInGrid(index: i))
                                .transition(.opacity.combined(with: .move(edge: .trailing)))
                        }
                    }
                    .padding(10)
                    .background {
                        RoundedRectangle(cornerRadius: 28, style: .continuous)
                            .fill(LinearGradient(colors: [.white.opacity(0.07), .white.opacity(0.03)], startPoint: .top, endPoint: .bottom))
                            .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).strokeBorder(.white.opacity(0.08), lineWidth: 1))
                    }
                    .animation(.snappy, value: dl.items.map(\.id))
                }
            }
            .padding(.horizontal, 32).padding(.top, Metrics.top).padding(.bottom, 40)
            .frame(maxWidth: 980).frame(maxWidth: .infinity)
        }
        .background(ThemeBackground())
    }

    static func bytes(_ n: Int64) -> String {
        let f = ByteCountFormatter(); f.countStyle = .file; f.allowsNonnumericFormatting = false
        return f.string(fromByteCount: n)
    }

    /// Storage at a glance: a ring for how full the download folder is, big numbers beside it.
    private func storageCard(used: Int64, limit: Int64, count: Int) -> some View {
        let frac = limit > 0 ? min(1, Double(used) / Double(limit)) : 0
        return HStack(spacing: 22) {
            ZStack {
                Circle().stroke(.white.opacity(0.1), lineWidth: 9)
                Circle().trim(from: 0, to: limit > 0 ? frac : 0)
                    .stroke(AngularGradient(colors: [model.accent.opacity(0.6), model.accent], center: .center), style: StrokeStyle(lineWidth: 9, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.spring(response: 0.9, dampingFraction: 0.9), value: frac)
                Image(systemName: "internaldrive.fill").font(.system(size: 20, weight: .semibold)).foregroundStyle(.white.opacity(0.75))
            }
            .frame(width: 74, height: 74)
            VStack(alignment: .leading, spacing: 4) {
                Text(Self.bytes(used)).font(.system(size: 30, weight: .bold).monospacedDigit()).tracking(-0.8)
                    .contentTransition(.numericText())
                Text(limit > 0 ? "of \(Self.bytes(limit)) · \(count) ready offline" : "\(count) ready offline")
                    .font(.system(size: 13, weight: .medium)).foregroundStyle(.white.opacity(0.5))
            }
            Spacer()
            #if os(macOS)
            Button { NSWorkspace.shared.activateFileViewerSelecting([model.downloads.dir]) } label: { Label("Show in Finder", systemImage: "folder") }
                .buttonStyle(LumenButtonStyle())
            #endif
        }
        .padding(.horizontal, 26).padding(.vertical, 22)
        .background {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(LinearGradient(colors: [model.accent.opacity(0.14), .white.opacity(0.03)], startPoint: .topLeading, endPoint: .bottomTrailing))
                .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).strokeBorder(.white.opacity(0.1), lineWidth: 1))
        }
    }
}

private struct DownloadRow: View {
    private static func bytes(_ n: Int64) -> String { DownloadsView.bytes(n) }
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    let rec: DownloadRec
    @State private var hover = false

    var body: some View {
        let dl = model.downloads
        let d = rec
        HStack(spacing: 16) {
            Group {
                if let u = dl.posterURL(d), let img = Platform.image(file: u) { Image(platformImage: img).resizable().aspectRatio(contentMode: .fill) }
                else { Artwork(source: d.poster) }
            }
            .frame(width: 56, height: 84).clipShape(.rect(cornerRadius: 10, style: .continuous))
            .shadow(color: .black.opacity(0.35), radius: 6, y: 3)
            VStack(alignment: .leading, spacing: 6) {
                Text(SearchKit.cleanTitle(d.title)).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                if let s = d.subtitle { Text(s).font(.system(size: 13)).foregroundStyle(.white.opacity(0.55)).lineLimit(1) }
                switch d.state {
                case .done:
                    Label("\(Self.bytes(d.size)) · ready offline", systemImage: "checkmark.circle.fill")
                        .font(.system(size: 12, weight: .medium)).foregroundStyle(Color(red: 0.35, green: 0.82, blue: 0.55))
                case .error:
                    Label(d.error ?? "Download failed", systemImage: "exclamationmark.triangle.fill").font(.system(size: 12, weight: .medium)).foregroundStyle(.orange).lineLimit(2)
                default:
                    Capsule().fill(.white.opacity(0.1)).frame(maxWidth: 320).frame(height: 5)
                        .overlay(alignment: .leading) { Capsule().fill(model.accent).scaleEffect(x: max(0.02, d.progress), anchor: .leading) }
                        .animation(.linear(duration: 0.4), value: d.progress)
                    Text("\(d.state == .paused ? "Paused · " : d.state == .queued ? "Waiting · " : "")\(Self.bytes(d.received))\(d.size > 0 ? " of \(Self.bytes(d.size))" : "")")
                        .font(.system(size: 12, weight: .medium).monospacedDigit()).foregroundStyle(.white.opacity(0.5))
                }
            }
            Spacer(minLength: 12)
            switch d.state {
            case .done:
                Button { model.playDownload(d, openWindow: openWindow) } label: { Label("Play", systemImage: "play.fill") }.buttonStyle(LumenButtonStyle(prominent: true))
            case .downloading:
                circle("pause.fill", "Pause") { dl.pause(d.id) }
            case .paused, .error, .queued:
                circle("arrow.clockwise", "Resume") { dl.resumeDownload(d.id) }
            }
            circle("trash", "Remove") { withAnimation(.snappy) { dl.remove(d.id) } }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(.white.opacity(hover ? 0.06 : 0)))
        .onHover { hover = $0 }
        .animation(.easeOut(duration: 0.14), value: hover)
    }

    private func circle(_ symbol: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 14, weight: .semibold)).frame(width: 40, height: 40)
                .background(.white.opacity(0.08), in: Circle()).overlay(Circle().strokeBorder(.white.opacity(0.1), lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(RailPressStyle()).help(label).accessibilityLabel(label)
    }
}
