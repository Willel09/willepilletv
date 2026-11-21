import SwiftUI

struct DetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    let item: Item
    @State private var info: MediaInfo?
    @State private var loading = true
    @State private var season: Int = 1

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                header
                if item.kind == .series { episodesSection }
                moreLikeThis
            }
            .padding(.bottom, 40)
        }
        .background { AmbientBackground(artwork: item.artwork) }
        .navigationTitle(SearchKit.cleanTitle(item.name))
        .task(id: item.id) {
            loading = true
            info = await model.info(for: item)
            loading = false
            if let h = model.user.history.first(where: { $0.itemId == item.id && $0.kind == "episode" }),
               let eid = h.id.split(separator: "|").last, let e = episodes.first(where: { $0.id == eid }) {
                season = e.season
            } else if let first = seasons.first { season = first }
        }
    }

    private var episodes: [Episode] {
        if let e = info?.episodes, !e.isEmpty { return e }
        if case .series(let s) = item { return s.episodes ?? [] }
        return []
    }
    private var seasons: [Int] { Array(Set(episodes.map(\.season))).sorted() }

    // MARK: Header

    private var header: some View {
        ZStack(alignment: .bottomLeading) {
            Artwork(source: info?.backdrop ?? item.backdrop, size: "w1280")
                .frame(height: 500).frame(maxWidth: .infinity).clipped()
            LinearGradient(colors: [.clear, .black.opacity(0.5), .black.opacity(0.92)], startPoint: .top, endPoint: .bottom)
            LinearGradient(colors: [.black.opacity(0.7), .clear], startPoint: .leading, endPoint: .trailing)

            HStack(alignment: .bottom, spacing: 28) {
                Artwork(source: info?.poster ?? item.artwork, size: "w500")
                    .frame(width: 210, height: 315)
                    .clipShape(.rect(cornerRadius: 18))
                    .shadow(color: .black.opacity(0.6), radius: 30, y: 16)
                VStack(alignment: .leading, spacing: 14) {
                    Text(SearchKit.cleanTitle(item.name)).font(.system(size: 40, weight: .bold)).lineLimit(2)
                    HStack(spacing: 8) {
                        if let y = info?.year ?? item.year { Tag(text: y) }
                        if let r = info?.rating ?? item.rating { RatingBadge(rating: r) }
                        if let d = info?.duration { Tag(text: d) }
                        if let g = info?.genre { Tag(text: g) }
                        if item.kind == .series, !seasons.isEmpty { Tag(text: "\(seasons.count) season\(seasons.count == 1 ? "" : "s")") }
                    }
                    if let plot = info?.plot {
                        Text(plot).font(.body).foregroundStyle(.white.opacity(0.85)).lineLimit(5).frame(maxWidth: 680, alignment: .leading)
                    } else if loading {
                        ProgressView().controlSize(.small)
                    }
                    if let d = info?.director { Text("Director: \(d)").font(.callout).foregroundStyle(.secondary) }
                    if let c = info?.cast { Text("Cast: \(c)").font(.callout).foregroundStyle(.secondary).lineLimit(2).frame(maxWidth: 680, alignment: .leading) }
                    actions.padding(.top, 6)
                }
                .foregroundStyle(.white)
            }
            .padding(36)
        }
        .frame(height: 500)
        .clipShape(.rect(cornerRadius: 26))
        .padding(.horizontal, 24).padding(.top, 8)
    }

    private var actions: some View {
        HStack(spacing: 12) {
            switch item {
            case .movie:
                let h = model.history(for: item.id)
                Button { if let r = model.request(for: item) { model.play(openWindow, r) } } label: {
                    Label(h.map { !$0.isFinished && $0.position > 30 } == true ? "Resume" : "Play", systemImage: "play.fill").padding(.horizontal, 10)
                }
                .buttonStyle(.glassProminent).controlSize(.extraLarge)
                .keyboardShortcut(.space, modifiers: [])
                if let h, !h.isFinished, h.position > 30 {
                    Button { if let r = model.request(for: item, resume: false) { model.play(openWindow, r) } } label: {
                        Label("From the Start", systemImage: "backward.end.fill")
                    }
                    .buttonStyle(.glass).controlSize(.extraLarge)
                }
            case .series(let show):
                if let next = nextUp(show) {
                    Button { model.play(openWindow, model.request(for: next, in: show)) } label: {
                        Label("Play S\(next.season) E\(next.episode)", systemImage: "play.fill").padding(.horizontal, 10)
                    }
                    .buttonStyle(.glassProminent).controlSize(.extraLarge)
                }
            case .live: EmptyView()
            }
            Button { model.toggleWatchlist(item.id) } label: {
                Label(model.inWatchlist(item.id) ? "In My List" : "My List", systemImage: model.inWatchlist(item.id) ? "checkmark" : "plus")
            }
            .buttonStyle(.glass).controlSize(.extraLarge)
            Button { model.toggleFavorite(item.id) } label: {
                Image(systemName: model.isFavorite(item.id) ? "heart.fill" : "heart")
            }
            .buttonStyle(.glass).controlSize(.extraLarge)
            .foregroundStyle(model.isFavorite(item.id) ? .pink : .white)
            if case .movie(let m) = item, let u = model.streamURL(for: m) {
                Menu {
                    Button("Open in \(model.settings.externalPlayer)") { model.openExternally(u) }
                    Button("Copy Stream URL") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(u, forType: .string) }
                    ShareLink(item: DeepLink.item(item.id).url)
                } label: { Image(systemName: "ellipsis") }
                .menuStyle(.button).menuIndicator(.hidden).buttonStyle(.glass).controlSize(.extraLarge)
                .fixedSize()
            }
        }
    }

    /// The episode to resume, or the one after the last finished, or the first.
    private func nextUp(_ show: Show) -> Episode? {
        let eps = episodes
        guard !eps.isEmpty else { return nil }
        if let h = model.user.history.first(where: { $0.itemId == show.id && $0.kind == "episode" }),
           let eid = h.id.split(separator: "|").last, let i = eps.firstIndex(where: { $0.id == eid }) {
            return h.isFinished && i + 1 < eps.count ? eps[i + 1] : eps[i]
        }
        return eps.first
    }

    // MARK: Episodes

    @ViewBuilder private var episodesSection: some View {
        if case .series(let show) = item {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("Episodes").font(.title2.weight(.bold))
                    Spacer()
                    if seasons.count > 1 {
                        Picker("Season", selection: $season) { ForEach(seasons, id: \.self) { Text("Season \($0)").tag($0) } }
                            .frame(width: 160)
                    }
                }
                .padding(.horizontal, 32)
                if loading && episodes.isEmpty {
                    ProgressView().padding(.horizontal, 32)
                } else if episodes.isEmpty {
                    Text("No episodes found.").foregroundStyle(.secondary).padding(.horizontal, 32)
                } else {
                    ScrollView(.horizontal) {
                        LazyHStack(alignment: .top, spacing: 18) {
                            ForEach(episodes.filter { $0.season == season }) { e in
                                EpisodeCard(show: show, episode: e)
                                    .onTapGesture { model.play(openWindow, model.request(for: e, in: show)) }
                            }
                        }
                        .padding(.horizontal, 32).padding(.vertical, 10)
                    }
                    .scrollIndicators(.never)
                    .scrollClipDisabled()
                }
            }
        }
    }

    @ViewBuilder private var moreLikeThis: some View {
        let pool: [Item] = item.kind == .movie ? model.movies.filter { $0.group == item.group && $0.id != item.id }.prefix(200).map(Item.movie)
                                                : model.series.filter { $0.group == item.group && $0.id != item.id }.prefix(200).map(Item.series)
        let picks = Array(pool.sorted { ($0.rating ?? 0) > ($1.rating ?? 0) }.prefix(20))
        if !picks.isEmpty {
            Shelf(title: "More Like This", symbol: "square.stack") {
                ForEach(picks) { i in PosterCard(item: i).onTapGesture { model.path.append(Route.detail(i)) } }
            }
        }
    }
}

private struct EpisodeCard: View {
    @Environment(AppModel.self) private var model
    let show: Show
    let episode: Episode
    @State private var hovering = false

    var body: some View {
        let h = model.history(for: "\(show.id)|\(episode.id)")
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .bottomLeading) {
                Artwork(source: episode.still ?? show.backdrop ?? show.poster, size: "w500")
                    .frame(width: 280, height: 158)
                LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .center, endPoint: .bottom)
                if hovering {
                    Image(systemName: "play.circle.fill").font(.system(size: 42)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                if let h, h.progress > 0 {
                    ProgressBar(value: h.isFinished ? 1 : h.progress, tint: model.accent).padding(10)
                }
            }
            .frame(width: 280, height: 158)
            .clipShape(.rect(cornerRadius: 12))
            .overlay(alignment: .topTrailing) {
                if h?.isFinished == true {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).padding(8)
                }
            }
            .hoverLift(hovering)
            Text("\(episode.episode). \(episode.title)").font(.callout.weight(.medium)).lineLimit(1)
            if let p = episode.plot { Text(p).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
            if let d = episode.duration { Text(d).font(.caption2).foregroundStyle(.tertiary) }
        }
        .frame(width: 280)
        .contentShape(.rect)
        .onHover { hovering = $0 }
    }
}
