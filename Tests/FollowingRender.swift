import AppKit
import SwiftUI

extension ScorelineTests {
    /// Opt-in visual regression capture; never reads or writes the app's preference domain.
    static func renderFollowing(to directory: String) async {
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.accessory)
        let domain = "io.github.lame-o.Scoreline.following-render.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: domain)!
        defer { defaults.removePersistentDomain(forName: domain) }
        defaults.set(["eng.1", "eng.league_cup", "nba", "cs2"], forKey: "enabledLeagues")
        defaults.set(false, forKey: "notifyFollowed")
        defaults.set(false, forKey: "showCoStream")
        defaults.set(["eng.league_cup"], forKey: "filteredLeagues")
        defaults.set(["eng.league_cup": ["espn-soccer-364"]], forKey: "teamFilters")
        defaults.set(try? JSONEncoder().encode([FollowedTeam(id: "espn-soccer-364", name: "Liverpool", logo: nil)]), forKey: "followedTeams")
        let store = ScoreStore(defaults: defaults)
        try? FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        for dark in [false, true] {
            for width in [340.0, 600.0] {
                let pages: [(String, AnyView)] = [
                    ("sports", AnyView(AddSportsView(onBack: {}))),
                    ("following", AnyView(ManageView(followingPage: true, onDone: {}, onOpenLeague: { _ in }, onAddSports: {}))),
                    ("settings", AnyView(ManageView(onDone: {}, onOpenLeague: { _ in }, onAddSports: {})))
                ]
                for (name, page) in pages {
                    let frame = NSRect(x: 0, y: 0, width: width, height: 760)
                    let host = NSHostingView(rootView: page.environment(store).environment(\.colorScheme, dark ? .dark : .light)
                        .frame(width: width, height: 760).background(Color(nsColor: .windowBackgroundColor)))
                    let window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
                    window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                    window.contentView = host
                    window.orderBack(nil)
                    try? await Task.sleep(for: .milliseconds(1000))
                    host.layoutSubtreeIfNeeded()
                    host.displayIfNeeded()
                    if let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) {
                        host.cacheDisplay(in: host.bounds, to: bitmap)
                        let path = URL(fileURLWithPath: directory).appendingPathComponent("mac-\(name)-\(Int(width))-\(dark ? "dark" : "light").png")
                        try? bitmap.representation(using: .png, properties: [:])?.write(to: path)
                        print("Rendered \(path.lastPathComponent)")
                    }
                    window.orderOut(nil)
                    window.contentView = nil
                }
            }
        }
    }
}
