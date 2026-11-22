#if os(macOS)
import SwiftUI

/// One entry in a category rail: shortcuts carry a symbol and tint, categories get a flag or monogram.
struct RailEntry: Identifiable, Hashable {
    let id: String
    let label: String
    let count: Int
    var symbol: String? = nil
    var tint: Color? = nil
}

/// Floating category panel shared by Movies and Series (Live TV has its own with live counts).
struct CategoryRail: View {
    @Environment(AppModel.self) private var model
    let shortcuts: [RailEntry]
    let categories: [RailEntry]
    @Binding var selection: String
    @State private var query = ""
    @FocusState private var searching: Bool
    @Namespace private var highlight
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var spring: Animation? { reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.82) }

    private var visible: [RailEntry] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return q.isEmpty ? categories : categories.filter { $0.label.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white.opacity(searching ? 0.8 : 0.4))
                TextField("Filter categories", text: $query).textFieldStyle(.plain).font(.system(size: 14)).focused($searching)
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.white.opacity(0.4)) }
                        .buttonStyle(.plain).accessibilityLabel("Clear filter")
                }
            }
            .padding(.horizontal, 12).frame(height: 38)
            .background(.black.opacity(0.28), in: .rect(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(searching ? model.accent.opacity(0.7) : .white.opacity(0.06), lineWidth: 1))
            .animation(.easeOut(duration: 0.15), value: searching)
            .padding(.horizontal, 14).padding(.top, 14).padding(.bottom, 12)

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        if query.isEmpty {
                            VStack(spacing: 4) { ForEach(shortcuts) { shortcutRow($0) } }.padding(.bottom, 18)
                        }
                        HStack(alignment: .firstTextBaseline) {
                            Text("Categories").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white.opacity(0.55))
                            Spacer()
                            Text("\(visible.count)").font(.system(size: 12, weight: .medium).monospacedDigit()).foregroundStyle(.white.opacity(0.35))
                        }
                        .padding(.horizontal, 10).padding(.bottom, 6)
                        LazyVStack(spacing: 2) { ForEach(visible) { categoryRow($0).id($0.id) } }
                        if visible.isEmpty && !query.isEmpty {
                            Text("No category matches “\(query)”.").font(.callout).foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity).padding(.vertical, 30)
                        }
                    }
                    .padding(.horizontal, 8).padding(.bottom, 14)
                }
                .scrollIndicators(.never)
                .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.025),
                                             .init(color: .black, location: 0.94), .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom))
                .onChange(of: selection) { withAnimation(.snappy) { proxy.scrollTo(selection, anchor: .center) } }
            }
        }
        .livePanel()
        .focusable()
        .focusEffectDisabled()
        .onKeyPress(.downArrow) { step(1); return .handled }
        .onKeyPress(.upArrow) { step(-1); return .handled }
    }

    private func shortcutRow(_ e: RailEntry) -> some View {
        let on = selection == e.id
        let tint = e.tint ?? model.accent
        return RailRow(selected: on, tint: tint, namespace: highlight) {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(LinearGradient(colors: [tint, tint.opacity(0.7)], startPoint: .top, endPoint: .bottom))
                .frame(width: 30, height: 30)
                .overlay(Image(systemName: e.symbol ?? "square.grid.2x2.fill").font(.system(size: 13, weight: .bold)).foregroundStyle(.white))
                .shadow(color: tint.opacity(on ? 0.45 : 0.2), radius: on ? 8 : 4, y: 2)
            Text(e.label).font(.system(size: 14, weight: on ? .semibold : .medium)).lineLimit(1)
            Spacer(minLength: 6)
            Text(e.count, format: .number).font(.system(size: 12, weight: .semibold).monospacedDigit())
                .foregroundStyle(on ? tint : .white.opacity(0.35))
                .contentTransition(.numericText(value: Double(e.count)))
        } action: { withAnimation(spring) { selection = e.id } }
    }

    private func categoryRow(_ e: RailEntry) -> some View {
        let on = selection == e.id
        return RailRow(selected: on, tint: model.accent, compact: true, namespace: highlight) {
            CategoryBadge(name: e.label)
            Text(e.label).font(.system(size: 13.5, weight: on ? .semibold : .regular)).lineLimit(1)
                .foregroundStyle(.white.opacity(on ? 1 : 0.82))
            Spacer(minLength: 6)
            Text(e.count, format: .number).font(.system(size: 11.5, weight: .medium).monospacedDigit())
                .foregroundStyle(on ? model.accent : .white.opacity(0.3))
        } action: { withAnimation(spring) { selection = e.id } }
    }

    private func step(_ d: Int) {
        let all = (query.isEmpty ? shortcuts.map(\.id) : []) + visible.map(\.id)
        guard !all.isEmpty else { return }
        let i = all.firstIndex(of: selection) ?? -1
        withAnimation(spring) { selection = all[max(0, min(all.count - 1, i + d))] }
    }
}

/// A row whose selection highlight glides to the next selected row.
struct RailRow<Content: View>: View {
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
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(LinearGradient(colors: [tint.opacity(0.24), tint.opacity(0.12)], startPoint: .leading, endPoint: .trailing))
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(tint.opacity(0.3), lineWidth: 1))
                                .matchedGeometryEffect(id: "highlight", in: namespace ?? fallback)
                        }
                    }
                }
                .contentShape(.rect(cornerRadius: 12))
        }
        .buttonStyle(RailPressStyle())
        .onHover { hover = $0 }
        .animation(.easeOut(duration: 0.14), value: hover)
    }
}


/// Pill segmented control whose thumb slides between options.
struct GlideSegmented<T: Hashable>: View {
    let options: [(T, String)]
    @Binding var value: T
    @Namespace private var thumb
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options.indices, id: \.self) { i in
                let (v, label) = options[i]
                let on = v == value
                Button { withAnimation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.8)) { value = v } } label: {
                    Text(label).font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(on ? .white : .white.opacity(0.55))
                        .padding(.horizontal, 14).frame(height: 30)
                        .background {
                            if on {
                                Capsule().fill(.white.opacity(0.16))
                                    .overlay(Capsule().strokeBorder(.white.opacity(0.12), lineWidth: 1))
                                    .matchedGeometryEffect(id: "thumb", in: thumb)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(3)
        .background(.black.opacity(0.28), in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.06), lineWidth: 1))
    }
}
#endif
