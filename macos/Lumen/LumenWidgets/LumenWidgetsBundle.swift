import WidgetKit
import SwiftUI

@main
struct LumenWidgetsBundle: WidgetBundle {
    var body: some Widget {
        ContinueWatchingWidget()
        LiveNowWidget()
        TonightsPickWidget()
        LibraryStatsWidget()
        SurpriseMeControl()
        ContinueWatchingControl()
    }
}
