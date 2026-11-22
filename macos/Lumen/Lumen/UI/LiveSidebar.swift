#if os(macOS)
import SwiftUI

/// Live TV category rail: a floating panel with soft tinted shortcuts, flags and channel counts.
struct LiveSidebar: View {
    @Environment(AppModel.self) private var model
    @Binding var group: String
    @State private var query = ""
    @State private var counts: [String: Int] = [:]
    @FocusState private var searching: Bool
    @Namespace private var highlight
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var spring: Animation? { reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.82) }

    private struct Shortcut: Identifiable {
        let id: String, title: String, symbol: String, tint: Color
    }
    private let shortcuts: [Shortcut] = [
        .init(id: "__fav__", title: "Favorites", symbol: "heart.fill", tint: Color(red: 1, green: 0.42, blue: 0.55)),
        .init(id: "__recent__", title: "Recently Watched", symbol: "clock.fill", tint: Color(red: 1, green: 0.66, blue: 0.3)),
        .init(id: "__all__", title: "All Channels", symbol: "square.grid.2x2.fill", tint: Color(red: 0.4, green: 0.68, blue: 1))
    ]

    private var groups: [String] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return q.isEmpty ? model.liveGroups : model.liveGroups.filter { $0.localizedCaseInsensitiveContains(q) }
    }

    private func count(_ id: String) -> Int {
        switch id {
        case "__fav__": model.favoriteChannels.count
        case "__recent__": model.recentChannels.count
        case "__all__": model.channels.count
        default: counts[id] ?? 0
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            searchField.padding(.horizontal, 14).padding(.top, 14).padding(.bottom, 12)
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        if query.isEmpty {
                            VStack(spacing: 4) { ForEach(shortcuts) { shortcutRow($0) } }
                                .padding(.bottom, 18)
                        }
                        HStack(alignment: .firstTextBaseline) {
                            Text("Categories").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white.opacity(0.55))
                            Spacer()
                            Text("\(groups.count)").font(.system(size: 12, weight: .medium).monospacedDigit()).foregroundStyle(.white.opacity(0.35))
                        }
                        .padding(.horizontal, 10).padding(.bottom, 6)
                        LazyVStack(spacing: 2) {
                            ForEach(groups, id: \.self) { g in categoryRow(g).id(g) }
                        }
                        if groups.isEmpty && !query.isEmpty {
                            Text("No category matches “\(query)”.").font(.callout).foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity).padding(.vertical, 30)
                        }
                    }
                    .padding(.horizontal, 8).padding(.bottom, 14)
                }
                .scrollIndicators(.never)
                .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.025),
                                             .init(color: .black, location: 0.94), .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom))
                .onChange(of: group) { withAnimation(.snappy) { proxy.scrollTo(group, anchor: .center) } }
            }
        }
        .background {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(LinearGradient(colors: [.white.opacity(0.065), .white.opacity(0.03)], startPoint: .top, endPoint: .bottom))
                .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(.white.opacity(0.07), lineWidth: 1))
        }
        .clipShape(.rect(cornerRadius: 24, style: .continuous))
        .focusable()
        .focusEffectDisabled()
        .onKeyPress(.downArrow) { step(1); return .handled }
        .onKeyPress(.upArrow) { step(-1); return .handled }
        .task(id: model.channels.count) {
            let chans = model.channels
            counts = await Task.detached(priority: .utility) {
                var c: [String: Int] = [:]
                for ch in chans { c[ch.group, default: 0] += 1 }
                return c
            }.value
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white.opacity(searching ? 0.8 : 0.4))
            TextField("Find a category", text: $query).textFieldStyle(.plain).font(.system(size: 14)).focused($searching)
            if !query.isEmpty {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.white.opacity(0.4)) }
                    .buttonStyle(.plain).accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12).frame(height: 38)
        .background(.black.opacity(0.28), in: .rect(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(searching ? model.accent.opacity(0.7) : .white.opacity(0.06), lineWidth: 1))
        .animation(.easeOut(duration: 0.15), value: searching)
    }

    private func shortcutRow(_ s: Shortcut) -> some View {
        let on = group == s.id
        return SidebarRow(selected: on, tint: s.tint, namespace: highlight) {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(LinearGradient(colors: [s.tint, s.tint.opacity(0.7)], startPoint: .top, endPoint: .bottom))
                .frame(width: 30, height: 30)
                .overlay(Image(systemName: s.symbol).font(.system(size: 13, weight: .bold)).foregroundStyle(.white))
                .shadow(color: s.tint.opacity(on ? 0.45 : 0.2), radius: on ? 8 : 4, y: 2)
            Text(s.title).font(.system(size: 14, weight: on ? .semibold : .medium))
            Spacer(minLength: 6)
            Text(count(s.id), format: .number).font(.system(size: 12, weight: .semibold).monospacedDigit())
                .foregroundStyle(on ? s.tint : .white.opacity(0.35))
        } action: { withAnimation(spring) { group = s.id } }
    }

    private func categoryRow(_ g: String) -> some View {
        let on = group == g
        return SidebarRow(selected: on, tint: model.accent, compact: true, namespace: highlight) {
            CategoryBadge(name: g)
            Text(g).font(.system(size: 13.5, weight: on ? .semibold : .regular)).lineLimit(1)
                .foregroundStyle(.white.opacity(on ? 1 : 0.82))
            Spacer(minLength: 6)
            if let n = counts[g] {
                Text(n, format: .number).font(.system(size: 11.5, weight: .medium).monospacedDigit())
                    .foregroundStyle(on ? model.accent : .white.opacity(0.3))
            }
        } action: { withAnimation(spring) { group = g } }
    }

    private func step(_ d: Int) {
        let all = (query.isEmpty ? shortcuts.map(\.id) : []) + groups
        guard !all.isEmpty else { return }
        let i = all.firstIndex(of: group) ?? -1
        withAnimation(spring) { group = all[max(0, min(all.count - 1, i + d))] }
    }
}

/// One selectable row: soft tinted fill when selected, faint wash on hover, a small press.
private struct SidebarRow<Content: View>: View {
    let selected: Bool
    let tint: Color
    var compact = false
    var namespace: Namespace.ID? = nil
    @Namespace private var fallback
    @ViewBuilder let content: () -> Content
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 11) { content() }
                .padding(.horizontal, 10).padding(.vertical, compact ? 7 : 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.white.opacity(hover && !selected ? 0.05 : 0))
                        if selected {
                            // a single highlight that glides between rows
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(LinearGradient(colors: [tint.opacity(0.24), tint.opacity(0.12)], startPoint: .leading, endPoint: .trailing))
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(tint.opacity(0.3), lineWidth: 1))
                                .matchedGeometryEffect(id: "highlight", in: namespace ?? fallback)
                        }
                    }
                }
                .contentShape(.rect(cornerRadius: 12))
        }
        .buttonStyle(PressStyle())
        .onHover { hover = $0 }
        .animation(.easeOut(duration: 0.14), value: hover)
    }
}

private struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.98 : 1).animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

/// Flag for country categories, a soft monogram tile for everything else.
struct CategoryBadge: View {
    let name: String
    var body: some View {
        Group {
            if let flag = CategoryBadge.flag(for: name) {
                Text(flag).font(.system(size: 30)).frame(width: 22, height: 15)
                    .clipShape(.rect(cornerRadius: 4, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(.white.opacity(0.14), lineWidth: 0.5))
                    .shadow(color: .black.opacity(0.3), radius: 2, y: 1)
            } else {
                Text(CategoryBadge.monogram(name)).font(.system(size: 10, weight: .bold)).foregroundStyle(.white.opacity(0.75))
                    .frame(width: 22, height: 22)
                    .background(CategoryBadge.tint(name).opacity(0.35), in: .rect(cornerRadius: 6, style: .continuous))
            }
        }
        .frame(width: 24, height: 22)
    }

    nonisolated(unsafe) private static var cache: [String: String?] = [:]
    private static let regions: [String: String] = {
        let en = Locale(identifier: "en_US")
        var d: [String: String] = [:]
        for r in Locale.Region.isoRegions where r.identifier.count == 2 {
            if let n = en.localizedString(forRegionCode: r.identifier) { d[norm(n)] = r.identifier }
        }
        let alias = ["usa": "US", "us": "US", "united states of america": "US", "uk": "GB", "england": "GB", "great britain": "GB",
                     "russia": "RU", "south korea": "KR", "korea": "KR", "north korea": "KP", "czech republic": "CZ", "czechia": "CZ",
                     "ivory coast": "CI", "bosnia": "BA", "macedonia": "MK", "north macedonia": "MK", "uae": "AE", "emirates": "AE",
                     "vietnam": "VN", "turkey": "TR", "turkiye": "TR", "holland": "NL", "netherlands": "NL", "ex-yu": "RS",
                     "latino": "MX", "arabic": "SA", "kurdistan": "IQ", "persian": "IR", "taiwan": "TW", "hong kong": "HK"]
        for (k, v) in alias { d[k] = v }
        return d
    }()

    private static func norm(_ s: String) -> String {
        s.lowercased().replacingOccurrences(of: "&", with: "and").folding(options: .diacriticInsensitive, locale: nil)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func flag(for name: String) -> String? {
        if let c = cache[name] { return c }
        var code = regions[norm(name)]
        if code == nil {
            // "UK | Sports", "SE: Kids", "Sweden - Movies"
            let head = name.split(whereSeparator: { "|:-/[]()".contains($0) }).first.map(String.init) ?? name
            code = regions[norm(head)]
            if code == nil, head.trimmingCharacters(in: .whitespaces).count == 2 {
                let c = head.trimmingCharacters(in: .whitespaces).uppercased()
                code = c == "UK" ? "GB" : (Locale.Region(c).isISORegion ? c : nil)
            }
        }
        let f = code.map { c in String(String.UnicodeScalarView(c.unicodeScalars.compactMap { UnicodeScalar(127397 + $0.value) })) }
        cache[name] = f
        return f
    }

    static func monogram(_ s: String) -> String {
        let words = s.split(whereSeparator: { !$0.isLetter && !$0.isNumber })
        let m = words.count >= 2 ? String(words[0].prefix(1) + words[1].prefix(1)) : String(s.prefix(2))
        return m.uppercased()
    }

    static func tint(_ s: String) -> Color {
        let palette: [Color] = [.blue, .purple, .pink, .orange, .teal, .green, .indigo, .mint]
        return palette[s.unicodeScalars.reduce(0) { $0 &+ Int($1.value) } % palette.count]
    }
}
#endif
