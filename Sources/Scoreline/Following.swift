import Foundation
import SwiftUI

struct EditionFollow: Codable, Hashable, Identifiable {
    let source: String
    let key: String
    let name: String
    var id: String { "\(source):\(key)" }
    var valid: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && name.count <= 200
            && (source == "cs2" ? key.range(of: "^[a-z0-9][a-z0-9-]{0,199}$", options: .regularExpression) != nil
                : source == "ifsc" && key.range(of: "^[1-9][0-9]{0,9}$", options: .regularExpression) != nil)
    }
    func matches(_ event: Event) -> Bool {
        switch event.ref {
        case let .counterStrike(_, tournament): source == "cs2" && tournament == key
        case let .climbing(eventID, _, _, _, _, _): source == "ifsc" && String(eventID) == key
        default: false
        }
    }
}

enum FollowingPolicy {
    static func sanitizeEditions(_ editions: [EditionFollow]) -> [EditionFollow] {
        var seen: Set<String> = []
        return editions.filter { $0.valid && seen.insert($0.id).inserted }
    }
    /// Old versions treated an empty selection as all games. Preserve that effective scope once.
    static func migrateFilters(_ filters: Set<String>, picks: [String: Set<String>], version: Int) -> Set<String> {
        version >= 2 ? filters : filters.filter { $0 == "ifsc" || !(picks[$0] ?? []).isEmpty }
    }
    static func teamLeague(_ id: String) -> String? {
        if id.hasPrefix("cs-") { return "cs2" }
        if id.hasPrefix("espn-ncaaf-") { return "college-football" }
        if id.hasPrefix("espn-football-") { return "nfl" }
        if id.hasPrefix("espn-baseball-") { return "mlb" }
        if id.hasPrefix("espn-wnba-") { return "wnba" }
        if id.hasPrefix("espn-basketball-") { return "nba" }
        return nil
    }
    static func alertsFor(_ event: Event, followed: [FollowedTeam], muted: Set<String>, enabled: Bool) -> Bool {
        enabled && event.competitors.contains { c in c.id.map { id in followed.contains { $0.id == id } && !muted.contains(id) } ?? false }
    }
}

struct EditionFollowButton: View {
    @Environment(ScoreStore.self) private var store
    let edition: EditionFollow
    var body: some View {
        let on = store.editions.contains { $0.id == edition.id }
        Button { store.toggleEdition(edition) } label: { Label(on ? "Following edition" : "Follow edition", systemImage: on ? "star.fill" : "star") }
            .controlSize(.small).help("This edition only · Alerts off")
            .accessibilityValue(on ? "Following" : "Not following")
    }
}

/// A settings navigation row shares the list's hover treatment and readable hit area.
struct NavigationFormRow: View {
    let title: String
    let symbol: String
    let action: () -> Void
    @State private var hovering = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: symbol).font(.system(size: 11)).foregroundStyle(.secondary).frame(width: 16)
                Text(title).font(.system(size: 13))
                Spacer(minLength: 8)
                Image(systemName: "chevron.right").font(Glyph.row).foregroundStyle(.tertiary).accessibilityHidden(true)
            }.padding(.horizontal, 12).padding(.vertical, 8)
        }.buttonStyle(ListRowStyle(hovering: hovering)).onHover { hovering = $0 }
    }
}
