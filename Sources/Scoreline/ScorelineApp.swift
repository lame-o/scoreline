import SwiftUI

@main
struct ScorelineApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        // The panel and its menu bar item are AppKit (PanelController), so the
        // user can move and resize it. SwiftUI needs a scene: Settings never
        // opens, and its ⌘, item is removed so the panel's own ⌘, still works.
        // The rest of SwiftUI's menu is never seen and never shadows the
        // panel's keys: a key window answers key equivalents before the main
        // menu (⌘W, ⌘M and ⌘Q are the panel's, PanelController.swift; the Edit
        // menu keeps copy and paste working in text fields).
        Settings { EmptyView() }
            .commands { CommandGroup(replacing: .appSettings) {} }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var controller: PanelController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        MainActor.assumeIsolated {
            TeamColors.shared.isEnabled = true
            let controller = PanelController(store: ScoreStore())
            self.controller = controller
            // Sparkle's daily check (Updater.swift). Smoke runs skip it: an
            // update alert would land on top of what they're capturing.
            if ProcessInfo.processInfo.environment["SCORELINE_SMOKE"] == nil {
                Updater.shared.start()
            }
            if ProcessInfo.processInfo.environment["SCORELINE_SMOKE"] == "open" {
                controller.smokeOpen(snapshot: ProcessInfo.processInfo.environment["SCORELINE_SMOKE_PNG"])
            } else if ProcessInfo.processInfo.environment["SCORELINE_SMOKE"] == "1" {
                controller.smokeTest(snapshot: ProcessInfo.processInfo.environment["SCORELINE_SMOKE_PNG"])
            }
        }
    }

    /// Launching Scoreline while it's running (Finder, Spotlight, Launchpad)
    /// opens the panel: the way back when the item is hidden behind the notch.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        MainActor.assumeIsolated { controller?.open() }
        return false
    }
}
