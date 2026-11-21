// Colour themes, the same presets as the Windows app (the two light ones are left out: the Mac UI is dark only).
import SwiftUI

nonisolated struct LumenTheme: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let base: (Double, Double, Double)
    let accent: String
    let glow1: (Double, Double, Double)
    let glow2: (Double, Double, Double)

    static func == (a: LumenTheme, b: LumenTheme) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }

    var baseColor: Color { Color(red: base.0 / 255, green: base.1 / 255, blue: base.2 / 255) }
    var glowColors: [Color] {
        [Color(red: glow1.0 / 255, green: glow1.1 / 255, blue: glow1.2 / 255), Color(red: glow2.0 / 255, green: glow2.1 / 255, blue: glow2.2 / 255)]
    }

    static let all: [LumenTheme] = [
        .init(id: "graphite", name: "Graphite", base: (11, 11, 13), accent: "#98A2B3", glow1: (92, 100, 118), glow2: (48, 48, 58)),
        .init(id: "midnight", name: "Midnight", base: (0, 0, 0), accent: "#0A84FF", glow1: (18, 52, 110), glow2: (20, 14, 40)),
        .init(id: "crimson", name: "Crimson", base: (10, 8, 8), accent: "#E50914", glow1: (118, 12, 18), glow2: (44, 10, 12)),
        .init(id: "nordic", name: "Nordic", base: (13, 19, 28), accent: "#88C0D0", glow1: (52, 92, 128), glow2: (28, 44, 70)),
        .init(id: "ember", name: "Ember", base: (17, 12, 9), accent: "#FF9F0A", glow1: (150, 76, 20), glow2: (66, 28, 10)),
        .init(id: "forest", name: "Forest", base: (9, 15, 12), accent: "#5ED19A", glow1: (30, 104, 70), glow2: (12, 48, 38)),
        .init(id: "rose", name: "Rosé", base: (17, 10, 14), accent: "#FF78A0", glow1: (140, 48, 88), glow2: (58, 20, 48)),
        .init(id: "aurora", name: "Aurora", base: (7, 7, 11), accent: "#0A84FF", glow1: (10, 90, 200), glow2: (120, 60, 230))
    ]
    static func named(_ id: String) -> LumenTheme { all.first { $0.id == id } ?? all[0] }

    static let accents = ["#98A2B3", "#0A84FF", "#E50914", "#30D158", "#FF9F0A", "#BF5AF2", "#64D2FF", "#FF78A0", "#FFD60A"]
}
