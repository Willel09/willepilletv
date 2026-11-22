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
    @State private var scores: ExternalRatings?
    @State private var appeared = false
    @State private var burst = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                header
                if item.kind == .series { episodesSection }
                moreLikeThis
            }
            .padding(.bottom, 40)
        }
        .background(ThemeBackground(ambient: true))
        .navigationTitle(SearchKit.cleanTitle(item.name))
        .task(id: item.id) {
            model.markSeen(item.id)
            Task { await loadTmdb() }
            loading = true
            info = await model.info(for: item)
            loading = false
            Task { let r = await model.externalRatings(for: item, year: info?.year ?? item.year); withAnimation(.snappy) { scores = r } }
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
        let backdrop = info?.backdrop ?? item.backdrop
        return ZStack(alignment: .bottomLeading) {
            // full-bleed art that settles in, fading into the page
            Group {
                if let backdrop {
                    Artwork(source: backdrop, size: "w1280", onColor: { Ambient.shared.color = $0 })
                } else {
                    Artwork(source: info?.poster ?? item.artwork, size: "w500").blur(radius: 50).saturation(1.5).scaleEffect(1.2)
                }
            }
            .frame(height: 680).frame(maxWidth: .infinity).clipped()
            .scaleEffect(appeared || reduceMotion ? 1 : 1.08)
            .mask(LinearGradient(stops: [.init(color: .black, location: 0.5), .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom))
            LinearGradient(stops: [.init(color: Theme.base.opacity(0.94), location: 0), .init(color: Theme.base.opacity(0.6), location: 0.45), .init(color: .clear, location: 0.85)],
                           startPoint: .leading, endPoint: .trailing)
            LinearGradient(colors: [Theme.base.opacity(0.6), .clear], startPoint: .top, endPoint: .init(x: 0.5, y: 0.25))

            HStack(alignment: .bottom, spacing: 48) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(item.group).font(.system(size: 12, weight: .semibold)).tracking(1.6).textCase(.uppercase)
                        .foregroundStyle(.white.opacity(0.55)).lineLimit(1).padding(.bottom, 12)
                    Text(SearchKit.cleanTitle(item.name))
                        .font(.system(size: 60, weight: .heavy)).tracking(-2.6).lineSpacing(-4)
                        .lineLimit(3).minimumScaleFactor(0.55).frame(maxWidth: 820, alignment: .leading)
                        .shadow(color: .black.opacity(0.35), radius: 20, y: 6)
                    metaRow.padding(.top, 18)
                    if let plot = info?.plot, !plot.isEmpty {
                        Text(plot).font(.system(size: 16)).lineSpacing(3).foregroundStyle(.white.opacity(0.8))
                            .lineLimit(5).frame(maxWidth: 680, alignment: .leading).padding(.top, 18)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        if let d = info?.director { PersonLine(label: "Director", names: d, role: .director) }
                        if let c = info?.cast { PersonLine(label: "Cast", names: c, role: .actor, limit: 6) }
                    }
                    .padding(.top, 14)
                    desktopActions.padding(.top, 28)
                }
                .foregroundStyle(.white)
                .opacity(appeared || reduceMotion ? 1 : 0).offset(y: appeared || reduceMotion ? 0 : 30)
                Spacer(minLength: 0)
                if backdrop != nil {
                    Artwork(source: info?.poster ?? item.artwork, size: "w500")
                        .frame(width: 230, height: 345)
                        .clipShape(.rect(cornerRadius: 22, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(.white.opacity(0.14), lineWidth: 1))
                        .shadow(color: .black.opacity(0.55), radius: 34, y: 20)
                        .opacity(appeared || reduceMotion ? 1 : 0).scaleEffect(appeared || reduceMotion ? 1 : 0.94)
                }
            }
            .padding(.horizontal, 56).padding(.bottom, 40).padding(.top, 130)
        }
        .frame(minHeight: 680, alignment: .bottom)
        .onAppear {
            withAnimation(.easeOut(duration: 1.6)) { appeared = true }
        }
        .animation(.spring(response: 0.6, dampingFraction: 0.85).delay(0.08), value: appeared)
    }

    private var metaRow: some View {
        HStack(spacing: 12) {
            if let y = info?.year ?? item.year { Text(y) }
            if let sc = scores {
                if let i = sc.imdb { ScorePill(label: "IMDb", value: String(format: "%.1f", i), bg: Color(red: 0.96, green: 0.77, blue: 0.09), fg: .black)
                    .help(sc.votes.map { "\($0.formatted()) votes" } ?? "IMDb") }
                if let rt = sc.rottenTomatoes { ScorePill(label: "RT", value: "\(rt)%", bg: Color(red: 0.98, green: 0.2, blue: 0.04), fg: .white).help("Rotten Tomatoes") }
                if let mc = sc.metacritic {
                    ScorePill(label: "MC", value: "\(mc)", bg: mc >= 61 ? Color(red: 0.4, green: 0.8, blue: 0.2) : mc >= 40 ? Color(red: 1, green: 0.8, blue: 0.2) : .red,
                              fg: mc >= 40 ? .black : .white).help("Metacritic")
                }
            } else if let r = info?.rating ?? item.rating, r > 0 {
                HStack(spacing: 4) { Image(systemName: "star.fill").foregroundStyle(.yellow).font(.system(size: 12)); Text(r, format: .number.precision(.fractionLength(1))) }
            }
            if let d = info?.duration { Text(d) }
            if let g = info?.genre { Text(g).foregroundStyle(.white.opacity(0.5)).lineLimit(1) }
            if item.kind == .series, !seasons.isEmpty { Text("\(seasons.count) Season\(seasons.count == 1 ? "" : "s")") }
            if loading { ProgressView().controlSize(.small) }
        }
        .font(.system(size: 14, weight: .medium)).foregroundStyle(.white.opacity(0.7))
    }

    private var desktopActions: some View {
        FlowLayout(spacing: 12) {
            switch item {
            case .movie(let m):
                let h = model.history(for: item.id)
                let resumable = h.map { !$0.isFinished && $0.position > 30 } ?? false
                Button { if let r = model.request(for: item) { model.play(openWindow, r) } } label: {
                    Label(resumable ? "Resume · \(minutesLeft(h!)) left" : "Play", systemImage: "play.fill").font(.system(size: 16, weight: .bold)).padding(.horizontal, 10)
                }
                .buttonStyle(BigButtonStyle(prominent: true)).keyboardShortcut(.space, modifiers: [])
                .background { if resumable { PulseHalo() } }
                if resumable {
                    Button { if let r = model.request(for: item, resume: false) { model.play(openWindow, r) } } label: { Label("From Beginning", systemImage: "arrow.counterclockwise") }
                        .buttonStyle(BigButtonStyle())
                }
                watchlistButton
                listMenu
                heartButton
                trailerButton
                downloadButton(m)
                if let h, resumable {
                    Button { withAnimation(.snappy) { model.removeFromContinue(h) }; model.toast = "Removed from Continue Watching" } label: { Label("Remove from Continue Watching", systemImage: "eye.slash") }
                        .buttonStyle(BigButtonStyle())
                }
                if let u = model.streamURL(for: m) {
                    Button { model.openExternally(u) } label: { Image(systemName: "arrow.up.forward.app").font(.system(size: 17, weight: .semibold)) }
                        .buttonStyle(BigButtonStyle(circle: true)).help("Open in \(model.settings.externalPlayer)")
                }
            case .series(let show):
                if let next = nextUp(show) {
                    let started = model.user.history.contains { $0.itemId == show.id && $0.kind == "episode" }
                    Button { model.play(openWindow, model.request(for: next, in: show)) } label: {
                        Label(started ? "Continue S\(next.season) E\(next.episode)" : "Play S\(next.season) E\(next.episode)", systemImage: "play.fill")
                            .font(.system(size: 16, weight: .bold)).padding(.horizontal, 10)
                    }
                    .buttonStyle(BigButtonStyle(prominent: true)).keyboardShortcut(.space, modifiers: [])
                    .background { if started { PulseHalo() } }
                } else if loading {
                    Button {} label: { Label("Loading episodes…", systemImage: "hourglass") }.buttonStyle(BigButtonStyle(prominent: true)).disabled(true)
                }
                watchlistButton
                listMenu
                heartButton
                trailerButton
            case .live: EmptyView()
            }
        }
    }

    private var watchlistButton: some View {
        let on = model.inWatchlist(item.id)
        return Button { withAnimation(.snappy) { model.toggleWatchlist(item.id) } } label: {
            Label(on ? "In Watchlist" : "Watchlist", systemImage: on ? "checkmark" : "plus").contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(BigButtonStyle())
    }

    private var listMenu: some View {
        let count = model.user.lists.filter { $0.items.contains(item.id) }.count
        return Menu {
            ForEach(model.user.lists) { l in
                Button { model.toggleInList(l.id, item.id) } label: { Label(l.name, systemImage: l.items.contains(item.id) ? "checkmark" : "list.bullet") }
            }
            if !model.user.lists.isEmpty { Divider() }
            Button("New List…", systemImage: "plus") { newListName = ""; newList = true }
            Divider()
            ShareLink(item: DeepLink.item(item.id).url)
        } label: {
            Label(count > 0 ? "In \(count) \(count == 1 ? "list" : "lists")" : "Save to list", systemImage: count > 0 ? "checkmark" : "text.badge.plus")
        }
        .menuStyle(.button).menuIndicator(.hidden).buttonStyle(BigButtonStyle()).fixedSize()
        .alert("New List", isPresented: $newList) {
            TextField("Name", text: $newListName)
            Button("Create") { let n = newListName.trimmingCharacters(in: .whitespaces); if !n.isEmpty { model.createList(n, first: item.id) } }
            Button("Cancel", role: .cancel) {}
        }
    }

    private var heartButton: some View {
        let fav = model.isFavorite(item.id)
        return Button { model.toggleFavorite(item.id); if !fav { burst += 1; UISound.play(.tap) } } label: {
            Image(systemName: fav ? "heart.fill" : "heart").font(.system(size: 18, weight: .semibold))
                .foregroundStyle(fav ? Color(red: 1, green: 0.42, blue: 0.55) : .white)
                .contentTransition(.symbolEffect(.replace)).symbolEffect(.bounce, value: fav)
                .overlay { HeartBurst(trigger: burst, tint: Color(red: 1, green: 0.42, blue: 0.55)) }
        }
        .buttonStyle(BigButtonStyle(circle: true)).help(fav ? "Remove from Favorites" : "Add to Favorites")
    }

    @ViewBuilder private var trailerButton: some View {
        if let t = trailer {
            Button { Platform.open(URL(string: "https://www.youtube.com/watch?v=\(t.key)")!) } label: { Label("Trailer", systemImage: "film") }
                .buttonStyle(BigButtonStyle())
                .transition(.opacity.combined(with: .scale(scale: 0.9)))
        }
    }

    @ViewBuilder private func downloadButton(_ m: Movie) -> some View {
        let rec = model.downloads.record(m.id)
        Button {
            if rec != nil { model.selection = .downloads } else if let lite = model.downloadLite(movie: m) { model.download([lite]) }
        } label: {
            switch rec?.state {
            case nil: Label("Download", systemImage: "arrow.down.circle")
            case .done?: Label("Downloaded", systemImage: "checkmark.circle.fill")
            case .error?: Label("Download failed", systemImage: "exclamationmark.triangle")
            case .paused?: Label("Paused", systemImage: "pause.circle")
            case .queued?: Label("Queued", systemImage: "clock")
            case .downloading?: Label("Downloading \(Int((rec?.progress ?? 0) * 100))%", systemImage: "arrow.down.circle.dotted").monospacedDigit()
            }
        }
        .buttonStyle(BigButtonStyle())
    }

    private func minutesLeft(_ h: HistoryEntry) -> String {
        let m = Int(max(0, h.duration - h.position) / 60)
        return m >= 60 ? "\(m / 60) h \(m % 60) min" : "\(m) min"
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
                    Text("Episodes").font(.system(size: 24, weight: .bold)).tracking(-0.6)
                    #if os(macOS)
                    if seasons.count > 1 && seasons.count <= 8 {
                        GlideSegmented(options: seasons.map { ($0, "Season \($0)") }, value: $season).fixedSize().padding(.leading, 12)
                    }
                    #endif
                    Spacer()
                    Menu {
                        Button("Download Season \(season)", systemImage: "arrow.down.circle") {
                            model.download(episodes.filter { $0.season == season }.map { model.downloadLite(episode: $0, in: show) })
                        }
                        Button("Download All Seasons", systemImage: "arrow.down.circle.fill") { model.download(episodes.map { model.downloadLite(episode: $0, in: show) }) }
                    } label: { Label("Download", systemImage: "arrow.down.circle") }
                    .menuStyle(.button).menuIndicator(.hidden).buttonStyle(LumenButtonStyle()).fixedSize()
                    if seasons.count > (Platform.isPhone ? 1 : 8) {
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
                            ForEach(Array(episodes.filter { $0.season == season }.enumerated()), id: \.element.id) { i, e in
                                EpisodeCard(show: show, episode: e)
                                    .modifier(StaggerInGrid(index: i))
                                    .onTapGesture { model.play(openWindow, model.request(for: e, in: show)) }
                            }
                        }
                        .padding(.horizontal, Metrics.hPad).padding(.vertical, 10)
                        .id(season)
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
                Image(systemName: "play.fill").font(.system(size: 16, weight: .bold)).foregroundStyle(.black)
                    .frame(width: 46, height: 46).background(.white, in: Circle())
                    .shadow(color: .black.opacity(0.4), radius: 10, y: 4)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .opacity(hovering ? 1 : 0).scaleEffect(hovering ? 1 : 0.8)
                if let h, h.progress > 0 {
                    ProgressBar(value: h.isFinished ? 1 : h.progress, tint: model.accent).padding(10)
                }
            }
            .frame(width: 280, height: 158)
            .clipShape(.rect(cornerRadius: 16, style: .continuous))
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
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.white.opacity(hovering ? 0.35 : 0.08), lineWidth: 1))
            .shadow(color: .black.opacity(hovering ? 0.5 : 0.25), radius: hovering ? 18 : 8, y: hovering ? 10 : 4)
            .hoverLift(hovering)
            .animation(.spring(response: 0.3, dampingFraction: 0.75), value: hovering)
            Text("\(episode.episode). \(episode.title)").font(.system(size: 14, weight: .semibold)).lineLimit(1).padding(.top, 2)
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

/// Large pill button for the detail page (white primary, frosted secondary, or a round icon).
struct BigButtonStyle: ButtonStyle {
    var prominent = false
    var circle = false
    @Environment(\.isEnabled) private var enabled
    @State private var hover = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(prominent ? Color.black : Color.white)
            .padding(.horizontal, circle ? 0 : 22)
            .frame(width: circle ? 52 : nil, height: 52)
            .background {
                if prominent { Capsule().fill(.white) }
                else { Capsule().fill(.white.opacity(hover ? 0.2 : 0.12)).overlay(Capsule().strokeBorder(.white.opacity(0.16), lineWidth: 1)) }
            }
            .shadow(color: .black.opacity(prominent ? 0.3 : 0), radius: 14, y: 6)
            .scaleEffect(configuration.isPressed ? 0.96 : (hover && enabled ? 1.03 : 1))
            .opacity(enabled ? 1 : 0.5)
            .contentShape(Capsule())
            .onHover { hover = $0 }
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
            .animation(.easeOut(duration: 0.15), value: hover)
    }
}

/// IMDb / RT / MC chip.
struct ScorePill: View {
    let label: String
    let value: String
    let bg: Color
    let fg: Color
    var body: some View {
        HStack(spacing: 5) {
            Text(label).font(.system(size: 10.5, weight: .heavy))
            Text(value).font(.system(size: 13, weight: .bold).monospacedDigit())
        }
        .foregroundStyle(fg)
        .padding(.horizontal, 8).frame(height: 24)
        .background(bg, in: .rect(cornerRadius: 6, style: .continuous))
        .transition(.scale(scale: 0.8).combined(with: .opacity))
    }
}

/// Lays children out in rows, wrapping when the width runs out.
struct FlowLayout: Layout {
    var spacing: CGFloat = 10
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, widest: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0 && x + s.width > maxW { y += rowH + spacing; x = 0; rowH = 0 }
            x += s.width + spacing; rowH = max(rowH, s.height); widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, maxW), height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > bounds.minX && x + s.width > bounds.maxX { y += rowH + spacing; x = bounds.minX; rowH = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing; rowH = max(rowH, s.height)
        }
    }
}
