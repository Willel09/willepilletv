#if os(macOS)
import SwiftUI

// MARK: - Shared panel chrome

extension View {
    /// The floating, softly lit panel used across Live TV.
    func livePanel(cornerRadius: CGFloat = 24) -> some View {
        self.background {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(LinearGradient(colors: [.white.opacity(0.065), .white.opacity(0.03)], startPoint: .top, endPoint: .bottom))
                .overlay(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).strokeBorder(.white.opacity(0.07), lineWidth: 1))
        }
        .clipShape(.rect(cornerRadius: cornerRadius, style: .continuous))
    }
}

// MARK: - Channel list

struct LiveChannelList: View {
    @Environment(AppModel.self) private var model
    let title: String
    let channels: [Channel]
    @Binding var filter: String
    @Binding var selected: Channel.ID?
    let emptySymbol: String
    let emptyTitle: String
    let emptyMessage: String
    let play: (Channel) -> Void
    @FocusState private var searching: Bool
    @Namespace private var selection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var selectSpring: Animation? { reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.82) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(size: 26, weight: .bold)).tracking(-0.6).lineLimit(1)
                        .id(title)
                        .transition(reduceMotion ? .opacity : .push(from: .bottom))
                    Text("\(channels.count.formatted()) \(channels.count == 1 ? "channel" : "channels")")
                        .font(.system(size: 13, weight: .medium)).foregroundStyle(.white.opacity(0.45))
                        .contentTransition(.numericText(value: Double(channels.count)))
                }
                .clipped()
                .animation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.85), value: title)
                .animation(.snappy, value: channels.count)
                Spacer(minLength: 16)
                filterField.frame(maxWidth: 260)
            }
            .padding(.horizontal, 22).padding(.top, 18).padding(.bottom, 14)

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 4) {
                        ForEach(Array(channels.enumerated()), id: \.element.id) { i, c in
                            LiveChannelRow(channel: c, selected: selected == c.id, selection: selection)
                                .id(c.id)
                                .modifier(StaggerIn(index: i))
                                .onTapGesture(count: 2) { play(c) }
                                .onTapGesture { withAnimation(selectSpring) { selected = c.id } }
                                .itemContextMenu(.live(c))
                        }
                    }
                    .padding(.horizontal, 12).padding(.bottom, 14)
                    .id(title)
                }
                .scrollIndicators(.automatic)
                .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.02),
                                             .init(color: .black, location: 0.96), .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom))
                .onChange(of: selected) { if let s = selected { withAnimation(.snappy) { proxy.scrollTo(s) } } }
            }
            .overlay {
                if channels.isEmpty {
                    VStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.white.opacity(0.07)).frame(width: 58, height: 58)
                            .overlay(Image(systemName: emptySymbol).font(.system(size: 24, weight: .semibold)).foregroundStyle(.white.opacity(0.6)))
                        Text(emptyTitle).font(.system(size: 17, weight: .semibold))
                        Text(emptyMessage).font(.system(size: 13)).foregroundStyle(.white.opacity(0.5)).multilineTextAlignment(.center).frame(maxWidth: 280)
                    }
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
                }
            }
            .animation(.easeOut(duration: 0.2), value: channels.isEmpty)
        }
        .livePanel()
        .focusable()
        .focusEffectDisabled()
        .onKeyPress(.downArrow) { move(1); return .handled }
        .onKeyPress(.upArrow) { move(-1); return .handled }
    }

    private var filterField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(searching ? 0.8 : 0.4))
            TextField("Filter channels", text: $filter).textFieldStyle(.plain).font(.system(size: 13.5)).focused($searching)
            if !filter.isEmpty {
                Button { filter = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.white.opacity(0.4)) }
                    .buttonStyle(.plain).accessibilityLabel("Clear filter")
            }
        }
        .padding(.horizontal, 11).frame(height: 34)
        .background(.black.opacity(0.28), in: .rect(cornerRadius: 11, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(searching ? model.accent.opacity(0.7) : .white.opacity(0.06), lineWidth: 1))
        .animation(.easeOut(duration: 0.15), value: searching)
    }

    private func move(_ d: Int) {
        guard !channels.isEmpty else { return }
        let i = channels.firstIndex { $0.id == selected } ?? -1
        withAnimation(selectSpring) { selected = channels[max(0, min(channels.count - 1, i + d))].id }
    }
}

struct LiveChannelRow: View {
    @Environment(AppModel.self) private var model
    let channel: Channel
    let selected: Bool
    var selection: Namespace.ID? = nil
    @State private var hover = false
    @Namespace private var fallback

    var body: some View {
        let nn = model.nowNext(for: channel)
        let tint = model.accent
        HStack(spacing: 14) {
            Artwork(source: channel.logo, contentMode: .fit, placeholder: "tv")
                .padding(6)
                .frame(width: 66, height: 44)
                .background(.white.opacity(0.06), in: .rect(cornerRadius: 11, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(.white.opacity(0.06), lineWidth: 1))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(channel.name).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                    if model.isFavorite(channel.id) { Image(systemName: "heart.fill").font(.system(size: 10)).foregroundStyle(Color(red: 1, green: 0.42, blue: 0.55)) }
                }
                if let now = nn.now {
                    Text(now.title).font(.system(size: 12.5)).foregroundStyle(.white.opacity(0.6)).lineLimit(1)
                    // scale instead of GeometryReader: no extra layout pass per row
                    Capsule().fill(.white.opacity(0.1)).frame(maxWidth: 240).frame(height: 3)
                        .overlay(alignment: .leading) { Capsule().fill(tint).scaleEffect(x: max(0.02, now.progress()), anchor: .leading) }
                } else {
                    Text(channel.group).font(.system(size: 12.5)).foregroundStyle(.white.opacity(0.4)).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                if let n = channel.num {
                    Text("\(n)").font(.system(size: 11, weight: .semibold).monospacedDigit()).foregroundStyle(.white.opacity(0.5))
                        .padding(.horizontal, 7).padding(.vertical, 2).background(.white.opacity(0.07), in: Capsule())
                }
                if let now = nn.now {
                    Text(minutesLeft(now)).font(.system(size: 11, weight: .medium).monospacedDigit()).foregroundStyle(.white.opacity(0.4))
                }
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.white.opacity(hover && !selected ? 0.05 : 0))
                if selected {
                    // one highlight that glides from row to row
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(LinearGradient(colors: [tint.opacity(0.24), tint.opacity(0.1)], startPoint: .leading, endPoint: .trailing))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(tint.opacity(0.3), lineWidth: 1))
                        .matchedGeometryEffect(id: "selection", in: selection ?? fallback)
                }
            }
        }
        .contentShape(.rect(cornerRadius: 14))
        .onHover { hover = $0 }
        .animation(.easeOut(duration: 0.14), value: hover)
    }

    private func minutesLeft(_ p: Programme) -> String {
        let m = Int(max(0, p.stop.timeIntervalSinceNow) / 60)
        return m >= 60 ? "\(m / 60) h \(m % 60) min left" : "\(m) min left"
    }
}

// MARK: - Info panel

struct LiveInfoPanel: View {
    @Environment(AppModel.self) private var model
    let channel: Channel
    let play: () -> Void
    private let heart = Color(red: 1, green: 0.42, blue: 0.55)
    @State private var burst = 0

    var body: some View {
        let all = model.schedule(for: channel).filter { $0.stop > .now }
        let now = all.first { $0.isOn() }
        let upcoming = all.filter { !$0.isOn() }.prefix(8)
        let fav = model.isFavorite(channel.id)
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                // logo stage with its own colour glow
                Artwork(source: channel.logo, contentMode: .fit, placeholder: "tv")
                    .frame(width: 150, height: 86)
                    .shadow(color: .black.opacity(0.45), radius: 14, y: 6)
                .frame(height: 150).frame(maxWidth: .infinity)
                .background {
                    // the logo's own colours, blurred into a soft glow
                    Artwork(source: channel.logo, contentMode: .fit, placeholder: "tv")
                        .frame(width: 220, height: 130).blur(radius: 46).opacity(0.7).saturation(1.4)
                        .allowsHitTesting(false)
                }
                .background(.black.opacity(0.3))
                .clipShape(.rect(cornerRadius: 20, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(.white.opacity(0.08), lineWidth: 1))

                VStack(alignment: .leading, spacing: 6) {
                    Text(channel.name).font(.system(size: 22, weight: .bold)).tracking(-0.4).lineLimit(2)
                    HStack(spacing: 7) {
                        CategoryBadge(name: channel.group)
                        Text(channel.group).font(.system(size: 13, weight: .medium)).foregroundStyle(.white.opacity(0.55)).lineLimit(1)
                        if let n = channel.num { Text("· \(n)").font(.system(size: 13, weight: .medium).monospacedDigit()).foregroundStyle(.white.opacity(0.4)) }
                    }
                }

                HStack(spacing: 10) {
                    Button(action: play) { Label("Watch", systemImage: "play.fill").frame(maxWidth: .infinity) }
                        .buttonStyle(LumenButtonStyle(prominent: true))
                    Button { model.toggleFavorite(channel.id); if !fav { burst += 1; UISound.play(.tap) } } label: {
                        Image(systemName: fav ? "heart.fill" : "heart").font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(fav ? heart : .white).frame(width: 44, height: 40)
                            .background(fav ? heart.opacity(0.18) : .white.opacity(0.1), in: Capsule())
                            .overlay(Capsule().strokeBorder(fav ? heart.opacity(0.4) : .white.opacity(0.12), lineWidth: 1))
                            .contentTransition(.symbolEffect(.replace))
                            .symbolEffect(.bounce, value: fav)
                            .overlay { HeartBurst(trigger: burst, tint: heart) }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(fav ? "Remove from favorites" : "Add to favorites")
                }

                if let now { onNowCard(now) }

                if !upcoming.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Up next").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white.opacity(0.55)).padding(.bottom, 10)
                        ForEach(Array(upcoming.enumerated()), id: \.offset) { i, p in
                            timelineRow(p, last: i == upcoming.count - 1).modifier(StaggerIn(index: i + 3))
                        }
                    }
                } else if now == nil {
                    Text(model.hasGuide ? "No guide data for this channel." : "Add an XMLTV guide in Sources to see what's on.")
                        .font(.system(size: 13)).foregroundStyle(.white.opacity(0.5))
                        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                        .background(.white.opacity(0.04), in: .rect(cornerRadius: 14, style: .continuous))
                }
            }
            .padding(18).padding(.top, 44)
        }
        .scrollIndicators(.never)
        .livePanel()
        .id(channel.id)
        .transition(.opacity)
    }

    /// "On now" card with a progress ring, the way a health app shows a daily goal.
    private func onNowCard(_ p: Programme) -> some View {
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                ProgressRing(programme: p, tint: model.accent).frame(width: 62, height: 62)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        LiveBadge()
                        Text("\(p.start.formatted(date: .omitted, time: .shortened)) - \(p.stop.formatted(date: .omitted, time: .shortened))")
                            .font(.system(size: 11.5, weight: .medium).monospacedDigit()).foregroundStyle(.white.opacity(0.5))
                    }
                    Text(p.title).font(.system(size: 15, weight: .semibold)).lineLimit(2)
                }
            }
            if let d = p.desc, !d.isEmpty {
                Text(d).font(.system(size: 12.5)).foregroundStyle(.white.opacity(0.6)).lineLimit(5).lineSpacing(2)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LinearGradient(colors: [model.accent.opacity(0.16), model.accent.opacity(0.04)], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: .rect(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(model.accent.opacity(0.22), lineWidth: 1))
    }

    private func timelineRow(_ p: Programme, last: Bool) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(p.start, style: .time).font(.system(size: 12, weight: .semibold).monospacedDigit()).foregroundStyle(.white.opacity(0.55))
                .frame(width: 46, alignment: .trailing)
            VStack(spacing: 0) {
                Circle().fill(.white.opacity(0.35)).frame(width: 7, height: 7).padding(.top, 4)
                if !last { Rectangle().fill(.white.opacity(0.1)).frame(width: 1).frame(maxHeight: .infinity) }
            }
            Text(p.title).font(.system(size: 13)).foregroundStyle(.white.opacity(0.85)).lineLimit(2)
                .padding(.bottom, last ? 0 : 14)
            Spacer(minLength: 0)
        }
    }
}

struct LiveInfoEmpty: View {
    var body: some View {
        VStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(LinearGradient(colors: [.white.opacity(0.12), .white.opacity(0.04)], startPoint: .top, endPoint: .bottom))
                .frame(width: 64, height: 64)
                .overlay(Image(systemName: "play.tv").font(.system(size: 26, weight: .semibold)).foregroundStyle(.white.opacity(0.7)))
            Text("Pick a channel").font(.system(size: 17, weight: .semibold))
            Text("Double-click or press Return to watch.").font(.system(size: 13)).foregroundStyle(.white.opacity(0.5))
        }
        .padding(.top, 44)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .livePanel()
    }
}
#endif

#if os(macOS)
/// Fills to the programme's progress when it appears, then keeps itself current every 30 s.
struct ProgressRing: View {
    let programme: Programme
    let tint: Color
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { ctx in
            let progress = programme.progress(at: ctx.date)
            let left = Int(max(0, programme.stop.timeIntervalSince(ctx.date)) / 60)
            ZStack {
                Circle().stroke(.white.opacity(0.1), lineWidth: 6)
                Circle().trim(from: 0, to: shown ? progress : 0)
                    .stroke(AngularGradient(colors: [tint.opacity(0.55), tint], center: .center), style: StrokeStyle(lineWidth: 6, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .shadow(color: tint.opacity(0.5), radius: 5)
                VStack(spacing: -2) {
                    Text("\(left)").font(.system(size: 17, weight: .bold).monospacedDigit()).contentTransition(.numericText(value: Double(left)))
                    Text("min").font(.system(size: 9.5, weight: .semibold)).foregroundStyle(.white.opacity(0.5))
                }
            }
            .animation(.easeInOut(duration: 0.6), value: progress)
        }
        .onAppear { withAnimation(reduceMotion ? nil : .spring(response: 1.0, dampingFraction: 0.9).delay(0.15)) { shown = true } }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(Int(programme.progress() * 100)) percent watched")
    }
}

/// Rows near the top fade and rise in sequence when a list appears; rows further down (loaded while scrolling) show at once.
struct StaggerIn: ViewModifier {
    let index: Int
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let animate = index < 14 && !reduceMotion
        content
            .opacity(!animate || shown ? 1 : 0)
            .offset(y: !animate || shown ? 0 : 10)
            .onAppear {
                guard animate, !shown else { return }
                withAnimation(.spring(response: 0.45, dampingFraction: 0.86).delay(Double(index) * 0.022)) { shown = true }
            }
    }
}
#endif
