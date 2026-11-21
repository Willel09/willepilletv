import SwiftUI

#if os(macOS)
struct LiveView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @State private var group: String = "__fav__"
    @State private var selected: Channel.ID?
    @State private var filter = ""
    @State private var groupFilter = ""

    var body: some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                TextField("Find a category", text: $groupFilter).textFieldStyle(.roundedBorder).padding(10)
                List(selection: Binding(get: { group }, set: { group = $0 ?? "__all__" })) {
                    Label("Favorites", systemImage: "heart.fill").tag("__fav__")
                    Label("Recently Watched", systemImage: "clock").tag("__recent__")
                    Label("All Channels", systemImage: "square.grid.2x2").tag("__all__")
                    Section("Categories") {
                        ForEach(model.liveGroups.filter { groupFilter.isEmpty || $0.localizedCaseInsensitiveContains(groupFilter) }, id: \.self) {
                            Text($0).lineLimit(1).tag($0)
                        }
                    }
                }
                .listStyle(.sidebar)
            }
            .frame(width: 230)
            Divider()
            VStack(spacing: 0) {
            SearchField(text: $filter, prompt: "Filter channels").padding(10)
            List(channels, selection: $selected) { c in
                ChannelRow(channel: c)
                    .tag(c.id)
                    .contentShape(.rect)
                    .onTapGesture(count: 2) { play(c) }
                    .onTapGesture { selected = c.id }
                    .itemContextMenu(.live(c))
            }
            .listStyle(.inset)
            .scrollContentBackground(.hidden)
            .frame(minWidth: 340)
            .overlay {
                if channels.isEmpty {
                    EmptyState(symbol: group == "__fav__" ? "heart" : "tv", title: group == "__fav__" ? "No favorites yet" : "No channels",
                               message: group == "__fav__" ? "Right-click a channel, or press ♥ in its info panel, to add it here." : "Try another category.")
                }
            }
            }
            Divider()
            if let id = selected, case .live(let c) = model.item(id) {
                ChannelInfoPanel(channel: c) { play(c) }
                    .frame(width: 340)
            } else {
                Text("Select a channel").foregroundStyle(.secondary).frame(width: 340).frame(maxHeight: .infinity)
            }
        }
        .onAppear { if model.favoriteChannels.isEmpty && group == "__fav__" { group = "__all__" } }
        .onKeyPress(.return) { if let id = selected, case .live(let c) = model.item(id) { play(c); return .handled }; return .ignored }
    }

    private var channels: [Channel] {
        var list: [Channel]
        switch group {
        case "__fav__": list = model.favoriteChannels
        case "__recent__": list = model.recentChannels
        case "__all__": list = model.channels
        default: list = model.channels.filter { $0.group == group }
        }
        if !filter.isEmpty { list = list.filter { $0.name.localizedCaseInsensitiveContains(filter) || ($0.num.map(String.init) == filter) } }
        return list
    }

    private func play(_ c: Channel) {
        if let r = model.request(for: .live(c)) { model.play(openWindow, r) }
    }
}
#endif

struct ChannelRow: View {
    @Environment(AppModel.self) private var model
    let channel: Channel

    var body: some View {
        let nn = model.nowNext(for: channel)
        HStack(spacing: 12) {
            if let n = channel.num { Text("\(n)").font(.caption.monospacedDigit()).foregroundStyle(.tertiary).frame(width: 34, alignment: .trailing) }
            Artwork(source: channel.logo, contentMode: .fit, placeholder: "tv")
                .frame(width: 54, height: 34)
                .background(.white.opacity(0.06), in: .rect(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(channel.name).font(.body.weight(.medium)).lineLimit(1)
                    if model.isFavorite(channel.id) { Image(systemName: "heart.fill").font(.caption2).foregroundStyle(.pink) }
                }
                if let now = nn.now {
                    HStack(spacing: 6) {
                        Text(now.title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        Spacer(minLength: 4)
                        Text(now.stop, style: .time).font(.caption2).foregroundStyle(.tertiary)
                    }
                    ProgressBar(value: now.progress(), tint: model.accent).frame(maxWidth: 220)
                } else {
                    Text(channel.group).font(.caption).foregroundStyle(.tertiary).lineLimit(1)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

#if os(macOS)
struct ChannelInfoPanel: View {
    @Environment(AppModel.self) private var model
    let channel: Channel
    let play: () -> Void

    var body: some View {
        let schedule = model.schedule(for: channel).filter { $0.stop > .now }.prefix(12)
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Artwork(source: channel.logo, contentMode: .fit, placeholder: "tv")
                    .frame(height: 110).frame(maxWidth: .infinity)
                    .padding(18)
                    .glassPanel()
                Text(channel.name).font(.title2.weight(.bold))
                Text(channel.group).foregroundStyle(.secondary)
                HStack {
                    Button(action: play) { Label("Watch", systemImage: "play.fill").frame(maxWidth: .infinity) }
                        .buttonStyle(LumenButtonStyle(prominent: true)).controlSize(.large)
                    Button { model.toggleFavorite(channel.id) } label: {
                        Image(systemName: model.isFavorite(channel.id) ? "heart.fill" : "heart")
                    }
                    .buttonStyle(LumenButtonStyle()).controlSize(.large)
                    .foregroundStyle(model.isFavorite(channel.id) ? .pink : .primary)
                }
                if schedule.isEmpty {
                    Text(model.hasGuide ? "No guide data for this channel." : "Add an XMLTV guide in Sources to see what's on.")
                        .font(.callout).foregroundStyle(.secondary).padding(.top, 8)
                } else {
                    Text("Schedule").font(.headline).padding(.top, 6)
                    ForEach(Array(schedule.enumerated()), id: \.offset) { _, p in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(p.start, style: .time).font(.caption.monospacedDigit()).foregroundStyle(p.isOn() ? model.accent : .secondary)
                                if p.isOn() { LiveBadge() }
                            }
                            Text(p.title).font(.callout.weight(p.isOn() ? .semibold : .regular))
                            if p.isOn() {
                                ProgressBar(value: p.progress(), tint: model.accent)
                                if let d = p.desc { Text(d).font(.caption).foregroundStyle(.secondary).lineLimit(4) }
                            }
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(p.isOn() ? AnyShapeStyle(.white.opacity(0.07)) : AnyShapeStyle(.clear), in: .rect(cornerRadius: 10))
                    }
                }
            }
            .padding(18)
        }
    }
}

// MARK: - Guide grid

struct GuideView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @State private var group = "__fav__"
    @State private var start: Date = Calendar.current.dateInterval(of: .hour, for: .now)?.start ?? .now
    private let pxPerMinute: CGFloat = 5
    private let hours = 6

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Picker("Category", selection: $group) {
                    Text("Favorites").tag("__fav__")
                    Text("All Channels").tag("__all__")
                    Divider()
                    ForEach(model.liveGroups, id: \.self) { Text($0).tag($0) }
                }
                .frame(maxWidth: 320)
                Spacer()
                Button { start = start.addingTimeInterval(-3600) } label: { Image(systemName: "chevron.left") }
                Button("Now") { start = Calendar.current.dateInterval(of: .hour, for: .now)?.start ?? .now }
                Button { start = start.addingTimeInterval(3600) } label: { Image(systemName: "chevron.right") }
            }
            .buttonStyle(LumenButtonStyle())
            .padding(14)

            if !model.hasGuide {
                EmptyState(symbol: "calendar.badge.exclamationmark", title: model.epgLoading ? "Loading the guide…" : "No TV guide yet",
                           message: "Lumen finds guides from Xtream sources and the M3U url-tvg header automatically, or you can add an XMLTV URL under Sources.")
            } else {
                ScrollView([.horizontal, .vertical]) {
                    VStack(alignment: .leading, spacing: 0) {
                        timeline
                        LazyVStack(alignment: .leading, spacing: 2, pinnedViews: []) {
                            ForEach(channels) { c in guideRow(c) }
                        }
                    }
                }
                .overlay(alignment: .topLeading) { nowLine }
            }
        }
        .navigationTitle("TV Guide")
        .onAppear { if model.favoriteChannels.isEmpty { group = "__all__" } }
    }

    private var channels: [Channel] {
        switch group {
        case "__fav__": model.favoriteChannels
        case "__all__": Array(model.channels.filter { !model.schedule(for: $0).isEmpty }.prefix(300))
        default: model.channels.filter { $0.group == group }
        }
    }

    private var end: Date { start.addingTimeInterval(Double(hours) * 3600) }

    private var timeline: some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: 190, height: 30)
            ForEach(0..<(hours * 2), id: \.self) { i in
                Text(start.addingTimeInterval(Double(i) * 1800), style: .time)
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    .frame(width: 30 * pxPerMinute, alignment: .leading)
            }
        }
    }

    @ViewBuilder private var nowLine: some View {
        let x = 190 + CGFloat(Date.now.timeIntervalSince(start) / 60) * pxPerMinute
        if Date.now > start && Date.now < end {
            Rectangle().fill(model.accent).frame(width: 2).offset(x: x, y: 30).allowsHitTesting(false)
        }
    }

    private func guideRow(_ c: Channel) -> some View {
        HStack(spacing: 0) {
            HStack(spacing: 8) {
                Artwork(source: c.logo, contentMode: .fit, placeholder: "tv").frame(width: 40, height: 26)
                Text(c.name).font(.callout.weight(.medium)).lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(width: 190, height: 54)
            .background(.white.opacity(0.05))
            .onTapGesture { if let r = model.request(for: .live(c)) { model.play(openWindow, r) } }

            ZStack(alignment: .leading) {
                Color.clear.frame(width: CGFloat(hours * 60) * pxPerMinute, height: 54)
                ForEach(Array(model.schedule(for: c).filter { $0.stop > start && $0.start < end }.enumerated()), id: \.offset) { _, p in
                    let s = max(p.start, start), e = min(p.stop, end)
                    let w = max(2, CGFloat(e.timeIntervalSince(s) / 60) * pxPerMinute - 3)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.title).font(.caption.weight(.semibold)).lineLimit(1)
                        Text("\(p.start.formatted(date: .omitted, time: .shortened)) – \(p.stop.formatted(date: .omitted, time: .shortened))")
                            .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .padding(.horizontal, 8)
                    .frame(width: w, height: 50, alignment: .leading)
                    .background(p.isOn() ? AnyShapeStyle(model.accent.opacity(0.35)) : AnyShapeStyle(.white.opacity(0.07)), in: .rect(cornerRadius: 8))
                    .help(p.desc ?? p.title)
                    .offset(x: CGFloat(s.timeIntervalSince(start) / 60) * pxPerMinute)
                    .onTapGesture { if p.isOn(), let r = model.request(for: .live(c)) { model.play(openWindow, r) } }
                }
            }
        }
    }
}
#endif
