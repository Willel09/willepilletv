// An actor's or director's page: photo, facts and every title of theirs, those in your library first.
import SwiftUI

struct PersonView: View {
    @Environment(AppModel.self) private var model
    let name: String
    let role: PersonRole
    @State private var state: Load = .loading
    @State private var inLib: [(TmdbTitle, Item)] = []
    @State private var other: [TmdbTitle] = []
    @State private var fullBio = false

    enum Load { case loading, nokey, missing, error(String), ready(TmdbPerson) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                switch state {
                case .loading: ProgressView().frame(maxWidth: .infinity).padding(.top, 120)
                case .nokey:
                    EmptyState(symbol: "key", title: "Add a TMDB key", message: "Actor and director pages come from TMDB. A free key takes a minute: themoviedb.org/settings/api. Paste it under Settings → TMDB.",
                               action: ("Open Settings", { model.selection = .settings; model.path = NavigationPath() }))
                        .padding(.top, 80)
                case .missing: EmptyState(symbol: "person.crop.circle.badge.questionmark", title: "No one found", message: "TMDB doesn't know “\(name)”.").padding(.top, 80)
                case .error(let m): EmptyState(symbol: "exclamationmark.triangle", title: "Couldn't load", message: m).padding(.top, 80)
                case .ready(let p):
                    header(p)
                    if !inLib.isEmpty {
                        Shelf(title: "In your library", subtitle: "\(inLib.count)", symbol: "play.rectangle.on.rectangle") {
                            ForEach(inLib, id: \.1.id) { t, item in
                                PosterCard(item: item).tapOrEnter { model.path.append(Route.detail(item)) }
                                    .overlay(alignment: .bottom) { if let r = t.role { Text(r).font(.caption2).padding(4).background(.black.opacity(0.6), in: Capsule()).lineLimit(1).padding(.bottom, 44) } }
                            }
                        }
                    }
                    if !other.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(inLib.isEmpty ? "Known for" : "Not in your library").font(.title2.weight(.bold)).padding(.horizontal, 32)
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 130, maximum: 150), spacing: 16, alignment: .top)], spacing: 20) {
                                ForEach(other) { t in creditCard(t) }
                            }
                            .padding(.horizontal, 32)
                        }
                    }
                }
            }
            .padding(.top, Metrics.top).padding(.bottom, 50)
        }
        .background(ThemeBackground())
        .task(id: "\(name)|\(role.rawValue)|\(model.settings.tmdbKey)") { await load() }
    }

    private func header(_ p: TmdbPerson) -> some View {
        HStack(alignment: .top, spacing: 30) {
            Artwork(source: p.photo, size: "w342", placeholder: "person.fill")
                .frame(width: 190, height: 285).clipShape(.rect(cornerRadius: 20))
                .shadow(color: .black.opacity(0.5), radius: 20, y: 10)
            VStack(alignment: .leading, spacing: 12) {
                Text(role == .director ? "DIRECTOR" : (p.department ?? "ACTOR").uppercased()).font(.system(size: 12, weight: .bold)).tracking(1.5).foregroundStyle(model.accent)
                Text(p.name).font(.system(size: 44, weight: .heavy)).tracking(-1.5)
                HStack(spacing: 8) {
                    if let a = p.age { Tag(text: p.died == nil ? "\(a) years old" : "Died aged \(a)") }
                    if let b = p.birthplace { Tag(text: b) }
                    Tag(text: "\(p.count) title\(p.count == 1 ? "" : "s")")
                    if let avg = p.average { RatingBadge(rating: avg) }
                }
                if let bio = p.bio {
                    Text(bio).font(.body).foregroundStyle(.white.opacity(0.8)).lineLimit(fullBio ? nil : 6).frame(maxWidth: 760, alignment: .leading)
                    if bio.count > 450 { Button(fullBio ? "Less" : "Read more") { fullBio.toggle() }.buttonStyle(.plain).foregroundStyle(model.accent) }
                }
            }
        }
        .padding(.horizontal, 32)
    }

    private func creditCard(_ t: TmdbTitle) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Artwork(source: t.poster, size: "w342", placeholder: t.kind == .series ? "tv" : "film")
                .frame(width: 130, height: 195).clipShape(.rect(cornerRadius: 12)).opacity(0.55)
                .overlay(alignment: .topTrailing) { if let r = t.rating { RatingBadge(rating: r).padding(6) } }
            Text(t.title).font(.callout.weight(.medium)).lineLimit(1)
            Text([t.year, t.role].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(width: 130)
        .help("Not in your library")
    }

    private func load() async {
        let key = model.settings.tmdbKey.trimmingCharacters(in: .whitespaces)
        guard !key.isEmpty else { state = .nokey; return }
        state = .loading
        do {
            let r = role
            let person = try await TmdbCache.shared.get("person:\(r.rawValue):\(name.lowercased())", days: 14) { try await TMDB.person(key: key, name: name, role: r) }
            guard let person else { state = .missing; return }
            let m = await TMDBModel.match(person.credits, movies: model.movies, series: model.series)
            var seen = Set<String>(); var a: [(TmdbTitle, Item)] = []; var b: [TmdbTitle] = []
            for t in person.credits { if let it = m[t.id] { if seen.insert(it.id).inserted { a.append((t, it)) } } else { b.append(t) } }
            inLib = a; other = Array(b.prefix(60)); state = .ready(person)
        } catch { state = .error(error.localizedDescription) }
    }
}
