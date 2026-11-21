// Xcode canvas previews. They use the library on this Mac (Application Support/Lumen).
import SwiftUI

#Preview("Main Window", traits: .fixedLayout(width: 1360, height: 860)) {
    RootView().environment(AppModel.shared).preferredColorScheme(.dark)
}

#Preview("Live TV", traits: .fixedLayout(width: 1200, height: 700)) {
    NavigationStack { LiveView() }.environment(AppModel.shared).preferredColorScheme(.dark)
}

#Preview("Movie Detail", traits: .fixedLayout(width: 1200, height: 900)) {
    let m = AppModel.shared
    return NavigationStack {
        if let movie = m.movies.first { DetailView(item: .movie(movie)) } else { Text("Load a library first") }
    }
    .environment(m).preferredColorScheme(.dark)
}

#Preview("Onboarding", traits: .fixedLayout(width: 1100, height: 700)) {
    OnboardingView().environment(AppModel.shared).preferredColorScheme(.dark)
}
