import SwiftUI

@main
struct DawsonsCompanionApp: App {
    var body: some Scene {
        WindowGroup {
            RootTabView()
        }
    }
}

/// Two genuinely different mobile-native surfaces, not a single browser
/// clone: a lightweight capture tool (Voice Notes) and the full touch
/// DAW, switched with a standard iOS tab bar.
private struct RootTabView: View {
    var body: some View {
        TabView {
            ContentView()
                .tabItem { Label("Voice Notes", systemImage: "waveform") }
            DAWView()
                .tabItem { Label("DAW", systemImage: "slider.horizontal.3") }
        }
    }
}
