import SwiftUI

struct DownloadsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        let dl = model.downloads
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Downloads").font(.system(size: 30, weight: .bold)).tracking(-1)
                    Spacer()
                    let limit = Int64(model.settings.downloadLimitGb) << 30
                    Text("\(ByteCountFormatter.string(fromByteCount: dl.used, countStyle: .file))\(limit > 0 ? " of \(ByteCountFormatter.string(fromByteCount: limit, countStyle: .file))" : "")")
                        .font(.callout).foregroundStyle(.secondary)
                    #if os(macOS)
                    Button { NSWorkspace.shared.activateFileViewerSelecting([dl.dir]) } label: { Image(systemName: "folder") }.buttonStyle(.plain).help("Show in Finder")
                    #endif
                }
                if dl.items.isEmpty {
                    EmptyState(symbol: "arrow.down.circle", title: "Nothing downloaded", message: "Open a movie or an episode and choose Download to watch it offline.").frame(minHeight: 360)
                } else {
                    ForEach(dl.items) { d in row(d) }
                }
            }
            .padding(.horizontal, Metrics.hPad).padding(.top, Metrics.top).padding(.bottom, 40)
        }
        .background(ThemeBackground())
    }

    private func row(_ d: DownloadRec) -> some View {
        let dl = model.downloads
        return HStack(spacing: 16) {
            Group {
                if let u = dl.posterURL(d), let img = Platform.image(file: u) { Image(platformImage: img).resizable().aspectRatio(contentMode: .fill) }
                else { Artwork(source: d.poster) }
            }
            .frame(width: 60, height: 90).clipShape(.rect(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 5) {
                Text(d.title).font(.headline).lineLimit(1)
                if let s = d.subtitle { Text(s).font(.callout).foregroundStyle(.secondary).lineLimit(1) }
                switch d.state {
                case .done: Text("\(ByteCountFormatter.string(fromByteCount: d.size, countStyle: .file)) · ready offline").font(.caption).foregroundStyle(.green)
                case .error: Text(d.error ?? "Failed").font(.caption).foregroundStyle(.red).lineLimit(2)
                default:
                    ProgressView(value: d.progress).tint(model.accent)
                    Text("\(d.state == .paused ? "Paused · " : d.state == .queued ? "Waiting · " : "")\(ByteCountFormatter.string(fromByteCount: d.received, countStyle: .file))\(d.size > 0 ? " of \(ByteCountFormatter.string(fromByteCount: d.size, countStyle: .file))" : "")")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            switch d.state {
            case .done: Button { model.playDownload(d, openWindow: openWindow) } label: { Label("Play", systemImage: "play.fill") }.buttonStyle(LumenButtonStyle(prominent: true))
            case .downloading: Button { dl.pause(d.id) } label: { Image(systemName: "pause.fill") }.buttonStyle(LumenButtonStyle())
            case .paused, .error, .queued: Button { dl.resumeDownload(d.id) } label: { Image(systemName: "arrow.clockwise") }.buttonStyle(LumenButtonStyle()).help("Resume")
            }
            Button(role: .destructive) { dl.remove(d.id) } label: { Image(systemName: "trash") }.buttonStyle(LumenButtonStyle()).help("Remove")
        }
        .padding(12)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 16))
    }
}
