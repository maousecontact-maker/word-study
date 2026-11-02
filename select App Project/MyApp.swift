import SwiftUI
import SwiftData

@main struct MyApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(for: [Deck.self, Word.self, SavedProgress.self, TestRecord.self])
    }
}
