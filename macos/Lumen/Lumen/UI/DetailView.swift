import SwiftUI

struct DetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    let item: Item
    @State private var info: MediaInfo?
    @State private var loading = true
    @State private var season: Int = 1
    @State private var trailer: TmdbTrailer?
    @State private var newList = false
    @State private var newListName = ""
    @State private var tmdbRecs: [Item] = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                header
                if item.kind == .series { episodesSection }
                moreLikeThis
            }
            .padding(.bottom, 40)
        }
        .background(ThemeBackground())
        .navigationTitle(SearchKit.cleanTitle(item.name))
        .task(id: item.id) {
            model.markSeen(item.id)
            Task { await loadTmdb() }
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

    @ViewBuilder private var header: some View {
        if Platform.isPhone { phoneHeader } else { desktopHeader }
    }

    private var phoneHeader: some View {
        VStack(alignment: .leading, spacing: 14) {
            ZStack(alignment: .bottom) {
                Artwork(source: info?.backdrop ?? item.backdrop, size: "w780").frame(height: 300).frame(maxWidth: .infinity).clipped()
                LinearGradient(colors: [.clear, Theme.base], startPoint: .center, endPoint: .bottom)
            }
            VStack(alignment: .leading, spacing: 12) {
                Text(SearchKit.cleanTitle(item.name)).font(.system(size: 30, weight: .bold)).tracking(-1)
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        if let y = info?.year ?? item.year { Tag(text: y) }
                        if let r = info?.rating ?? item.rating { RatingBadge(rating: r) }
                        if let d = info?.duration { Tag(text: d) }
                        if let g = info?.genre { Tag(text: g) }
                        if item.kind == .series, !seasons.isEmpty { Tag(text: "\(seasons.count) season\(seasons.count == 1 ? "" : "s")") }
                    }
                }.scrollIndicators(.hidden)
                ScrollView(.horizontal) { actions }.scrollIndicators(.hidden)
                if let plot = info?.plot { Text(plot).font(.callout).foregroundStyle(.white.opacity(0.85)) }
                else if loading { ProgressView().controlSize(.small) }
                if let d = info?.director { PersonLine(label: "Director", names: d, role: .director) }
                if let c = info?.cast { PersonLine(label: "Cast", names: c, role: .actor, limit: 4) }
            }
            .padding(.horizontal, 16)
        }
    }

    private var desktopHeader: some View {
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
                    if let d = info?.director { PersonLine(label: "Director", names: d, role: .director) }
                    if let c = info?.cast { PersonLine(label: "Cast", names: c, role: .actor, limit: 6) }
                    actions.padding(.top, 6)
                }
                .foregroundStyle(.white)
            }
            .padding(36)
        }
        .frame(height: 500)
        .clipShape(.rect(cornerRadius: 26))
        .padding(.horizontal, 24).padding(.top, 74)
    }

    private var actions: some View {
        HStack(spacing: 12) {
            switch item {
            case .movie:
                let h = model.history(for: item.id)
                Button { if let r = model.request(for: item) { model.play(openWindow, r) } } label: {
                    Label(h.map { !$0.isFinished && $0.position > 30 } == true ? "Resume" : "Play", systemImage: "play.fill").padding(.horizontal, 10)
                }
                .buttonStyle(LumenButtonStyle(prominent: true)).controlSize(.extraLarge)
                .keyboardShortcut(.space, modifiers: [])
                if let h, !h.isFinished, h.position > 30 {
                    Button { if let r = model.request(for: item, resume: false) { model.play(openWindow, r) } } label: {
                        Label("From the Start", systemImage: "backward.end.fill")
                    }
                    .buttonStyle(LumenButtonStyle()).controlSize(.extraLarge)
                }
            case .series(let show):
                if let next = nextUp(show) {
                    Button { model.play(openWindow, model.request(for: next, in: show)) } label: {
                        Label("Play S\(next.season) E\(next.episode)", systemImage: "play.fill").padding(.horizontal, 10)
                    }
                    .buttonStyle(LumenButtonStyle(prominent: true)).controlSize(.extraLarge)
                }
            case .live: EmptyView()
            }
            Button { model.toggleWatchlist(item.id) } label: {
                Label(model.inWatchlist(item.id) ? "In My List" : "My List", systemImage: model.inWatchlist(item.id) ? "checkmark" : "plus")
            }
            .buttonStyle(LumenButtonStyle()).controlSize(.extraLarge)
            Button { model.toggleFavorite(item.id) } label: {
                Image(systemName: model.isFavorite(item.id) ? "heart.fill" : "heart")
            }
            .buttonStyle(LumenButtonStyle()).controlSize(.extraLarge)
            .foregroundStyle(model.isFavorite(item.id) ? .pink : .white)
            if let t = trailer {
                Button { Platform.open(URL(string: "https://www.youtube.com/watch?v=\(t.key)")!) } label: { Label("Trailer", systemImage: "play.rectangle") }
                    .buttonStyle(LumenButtonStyle())
            }
            if item.kind != .live {
                Menu {
                    if case .movie(let m) = item {
                        if let rec = model.downloads.record(m.id), rec.state == .done {
                            Button("Remove Download", systemImage: "trash") { model.downloads.remove(m.id) }
                        } else if let lite = model.downloadLite(movie: m) {
                            Button("Download for Offline", systemImage: "arrow.down.circle") { model.download([lite]) }
                        }
                        if let u = model.streamURL(for: m) {
                            Button("Open in \(model.settings.externalPlayer)") { model.openExternally(u) }
                            Button("Copy Stream URL") { Pasteboard.copy(u) }
                        }
                    }
                    Menu("Add to List") {
                        ForEach(model.user.lists) { l in
                            Button { model.toggleInList(l.id, item.id) } label: { Label(l.name, systemImage: l.items.contains(item.id) ? "checkmark" : "list.bullet") }
                        }
                        if !model.user.lists.isEmpty { Divider() }
                        Button("New List…", systemImage: "plus") { newListName = ""; newList = true }
                    }
                    ShareLink(item: DeepLink.item(item.id).url)
                } label: { Image(systemName: "ellipsis") }
                .menuStyle(.button).menuIndicator(.hidden).buttonStyle(LumenButtonStyle()).fixedSize()
                .alert("New List", isPresented: $newList) {
                    TextField("Name", text: $newListName)
                    Button("Create") { let n = newListName.trimmingCharacters(in: .whitespaces); if !n.isEmpty { model.createList(n, first: item.id) } }
                    Button("Cancel", role: .cancel) {}
                }
            }
        }
    }

    private func loadTmdb() async {
        let key = model.settings.tmdbKey.trimmingCharacters(in: .whitespaces)
        trailer = nil; tmdbRecs = []
        guard !key.isEmpty, item.kind != .live, let tm = await model.tmdb.tmdbId(key: key, item) else { return }
        let kind: TmdbKind = item.kind == .movie ? .movie : .series
        trailer = (try? await TmdbCache.shared.get("trailer:\(kind.rawValue):\(tm)", days: 14) { try await TMDB.trailer(key: key, kind: kind, tmdb: tm) }) ?? nil
        if let recs = await model.tmdb.recommendations(key: key, kind: kind, tmdb: tm) {
            tmdbRecs = Array((await model.tmdb.inLibrary(recs, skip: tm, movies: model.movies, series: model.series)).filter { $0.id != item.id }.prefix(30))
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
                    Menu {
                        Button("Download Season \(season)", systemImage: "arrow.down.circle") {
                            model.download(episodes.filter { $0.season == season }.map { model.downloadLite(episode: $0, in: show) })
                        }
                        Button("Download All Seasons", systemImage: "arrow.down.circle.fill") { model.download(episodes.map { model.downloadLite(episode: $0, in: show) }) }
                    } label: { Label("Download", systemImage: "arrow.down.circle") }
                    .menuStyle(.button).menuIndicator(.hidden).buttonStyle(LumenButtonStyle()).fixedSize()
                    if seasons.count > 1 {
                        Picker("Season", selection: $season) { ForEach(seasons, id: \.self) { Text("Season \($0)").tag($0) } }
                            .frame(width: 160)
                    }
                }
                .padding(.horizontal, Metrics.hPad)
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
                        .padding(.horizontal, Metrics.hPad).padding(.vertical, 10)
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
        let picks = tmdbRecs.isEmpty ? Array(pool.sorted { ($0.rating ?? 0) > ($1.rating ?? 0) }.prefix(20)) : tmdbRecs
        if !picks.isEmpty {
            Shelf(title: "More Like This", symbol: "square.stack") {
                ForEach(picks) { i in PosterCard(item: i).tapOrEnter { model.path.append(Route.detail(i)) } }
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
            .overlay(alignment: .topLeading) {
                if let d = model.downloads.record("\(show.id)|\(episode.id)") {
                    Image(systemName: d.state == .done ? "arrow.down.circle.fill" : "arrow.down.circle").padding(8).foregroundStyle(.white, d.state == .done ? .green : .gray)
                }
            }
            .hoverLift(hovering)
            Text("\(episode.episode). \(episode.title)").font(.callout.weight(.medium)).lineLimit(1)
                .contextMenu {
                    if let d = model.downloads.record("\(show.id)|\(episode.id)") { Button("Remove Download", systemImage: "trash") { model.downloads.remove(d.id) } }
                    else { Button("Download for Offline", systemImage: "arrow.down.circle") { model.download([model.downloadLite(episode: episode, in: show)]) } }
                }
            if let p = episode.plot { Text(p).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
            if let d = episode.duration { Text(d).font(.caption2).foregroundStyle(.tertiary) }
        }
        .frame(width: 280)
        .contentShape(.rect)
        .onHover { hovering = $0 }
    }
}


/// "Director: A, B" with every name a link to that person's page.
struct PersonLine: View {
    @Environment(AppModel.self) private var model
    let label: String
    let names: String
    let role: PersonRole
    var limit = 4

    var body: some View {
        let list = names.split(whereSeparator: { ",/;".contains($0) }).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.prefix(limit)
        HStack(spacing: 6) {
            Text("\(label):").foregroundStyle(.secondary)
            ForEach(Array(list.enumerated()), id: \.offset) { i, n in
                Button { model.path.append(Route.person(n, role)) } label: { Text(n + (i < list.count - 1 ? "," : "")).underline(false) }
                    .buttonStyle(.plain).foregroundStyle(.white.opacity(0.9)).pointerHand()
            }
        }
        .font(.callout).lineLimit(1).frame(maxWidth: 680, alignment: .leading)
    }
}
