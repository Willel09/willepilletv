// Xcode canvas previews. They use the library on this Mac (Application Support/Lumen).
import SwiftUI

#if os(macOS)
#Preview("Live TV", traits: .fixedLayout(width: 1200, height: 700)) {
    NavigationStack { LiveView() }.environment(AppModel.shared).preferredColorScheme(.dark)
}

#Preview("Main Window", traits: .fixedLayout(width: 1360, height: 860)) {
    RootView().environment(AppModel.shared).preferredColorScheme(.dark)
}


#endif

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

#Preview("Settings", traits: .fixedLayout(width: 1100, height: 1100)) {
    SettingsView().environment(AppModel.shared).preferredColorScheme(.dark)
}

#Preview("Profiles", traits: .fixedLayout(width: 1000, height: 600)) {
    ProfilePickerView().environment(AppModel.shared).preferredColorScheme(.dark)
}

#Preview("Downloads", traits: .fixedLayout(width: 1000, height: 500)) {
    DownloadsView().environment(AppModel.shared).preferredColorScheme(.dark)
}

#Preview("TV Install", traits: .fixedLayout(width: 640, height: 640)) {
    TvInstallSheet().environment(AppModel.shared).preferredColorScheme(.dark)
}

#if os(iOS)
#Preview("Phone") { PhoneRoot().environment(AppModel.shared).preferredColorScheme(.dark) }
#endif
