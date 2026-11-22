// Profile avatars (the same twelve characters as the Windows app), the "Who's watching?" screen and the profile editor.
import SwiftUI

struct AvatarLook: Identifiable {
    enum Ears { case cat, bear, bunny, antenna, antennae, horns, tuft, none }
    enum Eyes { case dot, big, happy, visor, sleepy, cyclops, frog, panda }
    enum Mouth { case smile, open, cat, teeth, o, beak, wide }
    enum Shape { case round, box, ghost }
    let id: String, label: String
    let bg: (String, String)
    let face: String
    var shape: Shape = .round
    let ears: Ears
    var earColor: String?
    let eyes: Eyes
    let mouth: Mouth
    var cheeks = false, snout = false, spots = false

    static let all: [AvatarLook] = [
        .init(id: "kitty", label: "Kitty", bg: ("#ff9a8b", "#ff6a88"), face: "#ffb86b", ears: .cat, eyes: .big, mouth: .cat, cheeks: true),
        .init(id: "bear", label: "Bear", bg: ("#f6d365", "#fda085"), face: "#a0673f", ears: .bear, eyes: .dot, mouth: .smile, snout: true),
        .init(id: "bunny", label: "Bunny", bg: ("#a1c4fd", "#c2e9fb"), face: "#ffffff", ears: .bunny, eyes: .big, mouth: .o, cheeks: true),
        .init(id: "robot", label: "Robot", bg: ("#4facfe", "#00c6fb"), face: "#d5dde8", shape: .box, ears: .antenna, eyes: .visor, mouth: .teeth),
        .init(id: "alien", label: "Alien", bg: ("#43e97b", "#38f9d7"), face: "#8be36b", ears: .antennae, eyes: .big, mouth: .smile, spots: true),
        .init(id: "monster", label: "Monster", bg: ("#a18cd1", "#fbc2eb"), face: "#8e5bd8", ears: .horns, eyes: .cyclops, mouth: .teeth),
        .init(id: "frog", label: "Frog", bg: ("#d4fc79", "#96e6a1"), face: "#5cc45c", ears: .none, eyes: .frog, mouth: .wide, cheeks: true),
        .init(id: "ghost", label: "Ghost", bg: ("#30cfd0", "#330867"), face: "#f4f4ff", shape: .ghost, ears: .none, eyes: .dot, mouth: .o, cheeks: true),
        .init(id: "devil", label: "Devil", bg: ("#f093fb", "#f5576c"), face: "#ff5a5a", ears: .horns, eyes: .happy, mouth: .open),
        .init(id: "panda", label: "Panda", bg: ("#e0c3fc", "#8ec5fc"), face: "#ffffff", ears: .bear, earColor: "#25252f", eyes: .panda, mouth: .smile),
        .init(id: "dozy", label: "Dozy", bg: ("#fddb92", "#d1fdff"), face: "#c8a27a", ears: .none, eyes: .sleepy, mouth: .smile, cheeks: true),
        .init(id: "chick", label: "Chick", bg: ("#fff1a8", "#ffb347"), face: "#ffd84d", ears: .tuft, eyes: .dot, mouth: .beak, cheeks: true)
    ]
    static func named(_ id: String) -> AvatarLook { all.first { $0.id == id } ?? all[0] }
}

struct AvatarView: View {
    let id: String
    var size: CGFloat = 40

    var body: some View {
        let look = AvatarLook.named(id)
        Canvas { ctx, sz in
            let k = sz.width / 100
            ctx.scaleBy(x: k, y: k)
            draw(&ctx, look)
        }
        .frame(width: size, height: size)
        .clipShape(.rect(cornerRadius: size * 0.28))
        .accessibilityLabel(look.label)
    }

    private func c(_ hex: String) -> Color { Color(hex: hex) ?? .gray }
    private let ink = Color(red: 29/255, green: 29/255, blue: 41/255)
    private let pink = Color(red: 1, green: 143/255, blue: 171/255)

    private func poly(_ pts: [(CGFloat, CGFloat)]) -> Path {
        var p = Path(); p.move(to: CGPoint(x: pts[0].0, y: pts[0].1))
        for q in pts.dropFirst() { p.addLine(to: CGPoint(x: q.0, y: q.1)) }
        p.closeSubpath(); return p
    }
    private func circle(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat) -> Path { Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)) }
    private func ell(_ x: CGFloat, _ y: CGFloat, _ rx: CGFloat, _ ry: CGFloat) -> Path { Path(ellipseIn: CGRect(x: x - rx, y: y - ry, width: rx * 2, height: ry * 2)) }
    private func curve(_ x: CGFloat, _ y: CGFloat, _ dx: CGFloat, _ dy: CGFloat, _ dx2: CGFloat = 0) -> Path {
        var p = Path(); p.move(to: CGPoint(x: x, y: y))
        p.addQuadCurve(to: CGPoint(x: x + dx2 + (dx2 == 0 ? dx * 2 : 0), y: y), control: CGPoint(x: x + dx, y: y + dy)); return p
    }

    private func pupil(_ ctx: inout GraphicsContext, _ x: CGFloat, _ y: CGFloat, _ r: CGFloat = 4.5) {
        ctx.fill(circle(x, y, r), with: .color(ink))
        ctx.fill(circle(x + r * 0.35, y - r * 0.35, r * 0.35), with: .color(.white))
    }

    private func draw(_ ctx: inout GraphicsContext, _ l: AvatarLook) {
        ctx.fill(Path(CGRect(x: 0, y: 0, width: 100, height: 100)), with: .linearGradient(Gradient(colors: [c(l.bg.0), c(l.bg.1)]), startPoint: .zero, endPoint: CGPoint(x: 100, y: 100)))
        let ec = c(l.earColor ?? l.face)
        switch l.ears {
        case .cat:
            ctx.fill(poly([(22, 46), (28, 14), (48, 32)]), with: .color(ec)); ctx.fill(poly([(78, 46), (72, 14), (52, 32)]), with: .color(ec))
            ctx.fill(poly([(28, 38), (31, 22), (41, 32)]), with: .color(pink)); ctx.fill(poly([(72, 38), (69, 22), (59, 32)]), with: .color(pink))
        case .bear:
            ctx.fill(circle(27, 33, 12), with: .color(ec)); ctx.fill(circle(73, 33, 12), with: .color(ec))
            ctx.fill(circle(27, 33, 5.5), with: .color(.black.opacity(0.22))); ctx.fill(circle(73, 33, 5.5), with: .color(.black.opacity(0.22)))
        case .bunny:
            ctx.fill(ell(38, 20, 8, 19), with: .color(ec)); ctx.fill(ell(62, 20, 8, 19), with: .color(ec))
            ctx.fill(ell(38, 21, 3.5, 13), with: .color(pink)); ctx.fill(ell(62, 21, 3.5, 13), with: .color(pink))
        case .antenna:
            var p = Path(); p.move(to: CGPoint(x: 50, y: 32)); p.addLine(to: CGPoint(x: 50, y: 14))
            ctx.stroke(p, with: .color(Color(white: 0.58)), lineWidth: 3); ctx.fill(circle(50, 12, 5), with: .color(Color(red: 1, green: 0.35, blue: 0.48)))
        case .antennae:
            for (x1, x2) in [(41.0, 32.0), (59.0, 68.0)] {
                var p = Path(); p.move(to: CGPoint(x: x1, y: 32)); p.addLine(to: CGPoint(x: x2, y: 14))
                ctx.stroke(p, with: .color(ec), style: StrokeStyle(lineWidth: 3, lineCap: .round)); ctx.fill(circle(x2 - (x1 < 50 ? 1 : -1), 12, 5), with: .color(Color(red: 1, green: 0.88, blue: 0.3)))
            }
        case .horns:
            let h = Color(red: 1, green: 0.91, blue: 0.66)
            var a = Path(); a.move(to: CGPoint(x: 30, y: 42)); a.addQuadCurve(to: CGPoint(x: 30, y: 12), control: CGPoint(x: 20, y: 22)); a.addQuadCurve(to: CGPoint(x: 42, y: 34), control: CGPoint(x: 32, y: 28)); a.closeSubpath()
            var b = Path(); b.move(to: CGPoint(x: 70, y: 42)); b.addQuadCurve(to: CGPoint(x: 70, y: 12), control: CGPoint(x: 80, y: 22)); b.addQuadCurve(to: CGPoint(x: 58, y: 34), control: CGPoint(x: 68, y: 28)); b.closeSubpath()
            ctx.fill(a, with: .color(h)); ctx.fill(b, with: .color(h))
        case .tuft:
            ctx.fill(poly([(50, 30), (46, 16), (50, 10), (52, 20)]), with: .color(ec)); ctx.fill(poly([(50, 30), (56, 18), (64, 16), (56, 24)]), with: .color(ec)); ctx.fill(poly([(50, 30), (42, 20), (36, 20), (44, 24)]), with: .color(ec))
        case .none: break
        }
        // head
        let face = c(l.face)
        switch l.shape {
        case .box: ctx.fill(Path(roundedRect: CGRect(x: 22, y: 30, width: 56, height: 54), cornerRadius: 13), with: .color(face))
        case .ghost:
            var p = Path(); p.move(to: CGPoint(x: 22, y: 60)); p.addArc(center: CGPoint(x: 50, y: 60), radius: 28, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: false)
            p.addLine(to: CGPoint(x: 78, y: 86))
            for i in 0..<4 { let x = 78 - CGFloat(i) * 14; p.addLine(to: CGPoint(x: x - 7, y: 80)); p.addLine(to: CGPoint(x: x - 14, y: 86)) }
            p.closeSubpath(); ctx.fill(p, with: .color(face))
        case .round: ctx.fill(circle(50, 58, 30), with: .color(face))
        }
        if l.spots { for (x, y, r) in [(34.0, 70.0, 4.0), (66.0, 44.0, 3.0), (70.0, 68.0, 2.5)] { ctx.fill(circle(x, y, r), with: .color(.white.opacity(0.35))) } }
        if l.snout { ctx.fill(ell(50, 67, 11, 8), with: .color(.white.opacity(0.85))); ctx.fill(ell(50, 63, 4, 3), with: .color(ink)) }
        // eyes
        switch l.eyes {
        case .dot: pupil(&ctx, 39, 54); pupil(&ctx, 61, 54)
        case .big:
            ctx.fill(circle(39, 53, 8.5), with: .color(.white)); ctx.fill(circle(61, 53, 8.5), with: .color(.white)); pupil(&ctx, 40, 54, 5); pupil(&ctx, 62, 54, 5)
        case .happy:
            for x in [32.0, 54.0] { ctx.stroke(curve(x, 56, 7, -8, 14), with: .color(ink), style: StrokeStyle(lineWidth: 3.2, lineCap: .round)) }
        case .sleepy:
            for x in [32.0, 54.0] { ctx.stroke(curve(x, 53, 7, 6, 14), with: .color(ink), style: StrokeStyle(lineWidth: 3.2, lineCap: .round)) }
        case .visor:
            ctx.fill(Path(roundedRect: CGRect(x: 29, y: 45, width: 42, height: 15), cornerRadius: 7.5), with: .color(ink))
            ctx.fill(circle(40, 52.5, 4), with: .color(Color(red: 0.37, green: 0.95, blue: 1))); ctx.fill(circle(60, 52.5, 4), with: .color(Color(red: 0.37, green: 0.95, blue: 1)))
        case .cyclops: ctx.fill(circle(50, 51, 13), with: .color(.white)); pupil(&ctx, 51, 52, 6.5)
        case .frog:
            ctx.fill(circle(35, 34, 11), with: .color(face)); ctx.fill(circle(65, 34, 11), with: .color(face))
            ctx.fill(circle(35, 34, 7.5), with: .color(.white)); ctx.fill(circle(65, 34, 7.5), with: .color(.white)); pupil(&ctx, 36, 35); pupil(&ctx, 66, 35)
        case .panda:
            let patch = Color(red: 0.145, green: 0.145, blue: 0.185)
            ctx.drawLayer { g in
                g.translateBy(x: 38, y: 54); g.rotate(by: .degrees(-20)); g.fill(ell(0, 0, 8, 10), with: .color(patch))
            }
            ctx.drawLayer { g in
                g.translateBy(x: 62, y: 54); g.rotate(by: .degrees(20)); g.fill(ell(0, 0, 8, 10), with: .color(patch))
            }
            ctx.fill(circle(39, 53, 3), with: .color(.white)); ctx.fill(circle(61, 53, 3), with: .color(.white))
        }
        // mouth
        if l.snout {
            ctx.stroke(curve(45, 69, 5, 4, 10), with: .color(ink), style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
        } else {
            switch l.mouth {
            case .smile: ctx.stroke(curve(41, 66, 9, 9, 18), with: .color(ink), style: StrokeStyle(lineWidth: 3, lineCap: .round))
            case .open:
                var p = Path(); p.move(to: CGPoint(x: 39, y: 64)); p.addQuadCurve(to: CGPoint(x: 61, y: 64), control: CGPoint(x: 50, y: 80)); p.closeSubpath()
                ctx.fill(p, with: .color(ink)); ctx.fill(ell(50, 70, 5, 2.5), with: .color(pink))
            case .cat:
                ctx.fill(poly([(47, 62), (53, 62), (50, 65.5)]), with: .color(pink))
                var p = Path(); p.move(to: CGPoint(x: 44, y: 67)); p.addQuadCurve(to: CGPoint(x: 50, y: 67), control: CGPoint(x: 47, y: 71)); p.addQuadCurve(to: CGPoint(x: 56, y: 67), control: CGPoint(x: 53, y: 71))
                ctx.stroke(p, with: .color(ink), style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
            case .teeth:
                ctx.fill(Path(roundedRect: CGRect(x: 37, y: 65, width: 26, height: 10), cornerRadius: 4), with: .color(ink))
                ctx.fill(poly([(41, 65), (44, 69), (47, 65)]), with: .color(.white)); ctx.fill(poly([(53, 65), (56, 69), (59, 65)]), with: .color(.white))
            case .o: ctx.fill(ell(50, 69, 4, 5), with: .color(ink))
            case .beak: ctx.fill(poly([(43, 63), (57, 63), (50, 72)]), with: .color(Color(red: 1, green: 0.55, blue: 0.1)))
            case .wide: ctx.stroke(curve(32, 64, 18, 14, 36), with: .color(ink), style: StrokeStyle(lineWidth: 3, lineCap: .round))
            }
        }
        if l.cheeks { ctx.fill(circle(29, 64, 5), with: .color(pink.opacity(0.55))); ctx.fill(circle(71, 64, 5), with: .color(pink.opacity(0.55))) }
    }
}

// MARK: - Who's watching?

struct ProfilePickerView: View {
    @Environment(AppModel.self) private var model
    @State private var manage = false
    @State private var editing: ProfileEdit?

    @State private var appeared = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial).ignoresSafeArea()
            Rectangle().fill(.black.opacity(0.72)).ignoresSafeArea()
            RadialGradient(colors: [model.accent.opacity(0.18), .clear], center: .center, startRadius: 0, endRadius: 620).ignoresSafeArea()
            VStack(spacing: 46) {
                Text(manage ? "Manage profiles" : "Who's watching?")
                    .font(.system(size: 52, weight: .heavy)).tracking(-2)
                    .contentTransition(.opacity)
                    .opacity(appeared ? 1 : 0).offset(y: appeared ? 0 : 12)
                HStack(spacing: 34) {
                    ForEach(Array(model.profiles.enumerated()), id: \.element.id) { i, p in
                        ProfileTile(name: p.name, active: p.id == model.activeProfile && !manage, editing: manage) {
                            AvatarView(id: p.avatar, size: 150)
                        } action: {
                            if manage { editing = ProfileEdit(profile: p) } else { model.switchProfile(p.id) }
                        }
                        .opacity(appeared ? 1 : 0).scaleEffect(appeared ? 1 : 0.9).offset(y: appeared ? 0 : 18)
                        .animation(reduceMotion ? nil : .spring(response: 0.55, dampingFraction: 0.8).delay(0.06 + Double(i) * 0.06), value: appeared)
                    }
                    if model.profiles.count < 8 {
                        ProfileTile(name: "Add profile", active: false, editing: false) {
                            RoundedRectangle(cornerRadius: 42, style: .continuous)
                                .fill(LinearGradient(colors: [.white.opacity(0.12), .white.opacity(0.04)], startPoint: .top, endPoint: .bottom))
                                .frame(width: 150, height: 150)
                                .overlay(RoundedRectangle(cornerRadius: 42, style: .continuous).strokeBorder(.white.opacity(0.12), lineWidth: 1))
                                .overlay(Image(systemName: "plus").font(.system(size: 40, weight: .light)).foregroundStyle(.white.opacity(0.7)))
                        } action: { editing = ProfileEdit(profile: nil) }
                        .opacity(appeared ? 1 : 0).scaleEffect(appeared ? 1 : 0.9)
                        .animation(reduceMotion ? nil : .spring(response: 0.55, dampingFraction: 0.8).delay(0.06 + Double(model.profiles.count) * 0.06), value: appeared)
                    }
                }
                HStack(spacing: 22) {
                    Button { withAnimation(.snappy) { manage.toggle() } } label: {
                        Label(manage ? "Done" : "Manage profiles", systemImage: manage ? "checkmark" : "pencil")
                            .font(.system(size: 15, weight: .semibold)).padding(.horizontal, 22).frame(height: 44)
                            .background(manage ? AnyShapeStyle(Color.white) : AnyShapeStyle(Color.white.opacity(0.1)), in: Capsule())
                            .foregroundStyle(manage ? Color.black : .white)
                            .overlay(Capsule().strokeBorder(.white.opacity(manage ? 0 : 0.16), lineWidth: 1))
                    }
                    .buttonStyle(RailPressStyle())
                    if !manage {
                        Button("Close") { model.pickingProfile = false }
                            .buttonStyle(.plain).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white.opacity(0.6))
                            .keyboardShortcut(.cancelAction)
                    }
                }
                .opacity(appeared ? 1 : 0)
                .animation(.easeOut(duration: 0.4).delay(0.3), value: appeared)
            }
            .foregroundStyle(.white)
        }
        .onAppear { withAnimation(reduceMotion ? nil : .spring(response: 0.5, dampingFraction: 0.85)) { appeared = true } }
        .sheet(item: $editing) { ProfileEditor(edit: $0) }
        .transition(.opacity)
    }
}

/// Avatar with its name; lifts and glows on hover.
private struct ProfileTile<Art: View>: View {
    let name: String
    let active: Bool
    let editing: Bool
    @ViewBuilder let art: () -> Art
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            VStack(spacing: 16) {
                art()
                    .overlay {
                        if editing {
                            RoundedRectangle(cornerRadius: 42, style: .continuous).fill(.black.opacity(0.45))
                                .overlay(Image(systemName: "pencil").font(.system(size: 34, weight: .semibold)))
                                .transition(.opacity)
                        }
                    }
                    .overlay(RoundedRectangle(cornerRadius: 48, style: .continuous).strokeBorder(.white, lineWidth: active || hover ? 3 : 0).padding(-6))
                    .shadow(color: .black.opacity(hover ? 0.55 : 0.35), radius: hover ? 28 : 14, y: hover ? 16 : 8)
                    .scaleEffect(hover ? 1.06 : 1)
                Text(name).font(.system(size: 17, weight: active || hover ? .bold : .semibold))
                    .foregroundStyle(active || hover ? .white : .white.opacity(0.55))
            }
            .frame(width: 170)
            .contentShape(.rect)
        }
        .buttonStyle(RailPressStyle())
        .onHover { hover = $0 }
        .animation(.spring(response: 0.3, dampingFraction: 0.75), value: hover)
        .animation(.easeOut(duration: 0.2), value: editing)
    }
}

struct ProfileEdit: Identifiable { let id = UUID(); var profile: Profile? }

struct ProfileEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let edit: ProfileEdit
    @State private var name = ""
    @State private var avatar = "kitty"

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(edit.profile == nil ? "Add profile" : "Edit profile").font(.title2.weight(.bold))
            HStack(spacing: 16) {
                AvatarView(id: avatar, size: 80)
                TextField("Name", text: $name).textFieldStyle(.roundedBorder).onSubmit(save)
            }
            Text("Choose an avatar").font(.callout).foregroundStyle(.secondary)
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(64), spacing: 12), count: 6), spacing: 12) {
                ForEach(AvatarLook.all) { a in
                    AvatarView(id: a.id, size: 60).overlay(RoundedRectangle(cornerRadius: 17).strokeBorder(.white, lineWidth: a.id == avatar ? 3 : 0))
                        .onTapGesture { avatar = a.id }
                }
            }
            HStack {
                if let p = edit.profile, p.id != "main" {
                    Button("Delete profile", role: .destructive) { model.deleteProfile(p.id); dismiss() }
                }
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Save", action: save).buttonStyle(.borderedProminent).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if let p = edit.profile, p.id != "main" { Text("Deleting removes this profile's list, favorites and history on all your devices.").font(.caption).foregroundStyle(.secondary) }
        }
        .padding(26).frame(maxWidth: 520)
        .onAppear {
            name = edit.profile?.name ?? ""
            let taken = Set(model.profiles.map(\.avatar))
            avatar = edit.profile?.avatar ?? AvatarLook.all.first { !taken.contains($0.id) }?.id ?? "kitty"
        }
    }

    private func save() {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        model.saveProfile(Profile(id: edit.profile?.id ?? "p" + String(UUID().uuidString.prefix(8)).lowercased(), name: String(n.prefix(24)), avatar: avatar))
        dismiss()
    }
}
