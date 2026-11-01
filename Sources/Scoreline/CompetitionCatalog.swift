import Foundation

/// Catalog capabilities describe what providers actually support, independently of following.
enum CompetitionCatalog {
    static func kind(_ league: League) -> String {
        switch league.id {
        case "cs2": "Game · S-tier tournaments"
        case "ifsc": "Series · Competitions"
        case "eng.league_cup", "eng.fa": "Cup"
        case "uefa.champions", "uefa.europa", "fifa.world": "Tournament"
        default: "League"
        }
    }
    /// Team history is fetched through soccer/all. Navigation must retain the
    /// fixture's competition, including items restored from older caches.
    static func eventPath(_ path: String, league: String, sport: Sport) -> String {
        guard sport == .soccer, path == "soccer/all",
              league.range(of: "^[a-z0-9_-]+(?:\\.[a-z0-9_-]+)+$", options: .regularExpression) != nil else { return path }
        return "soccer/\(league)"
    }
    static func hasTable(_ league: League) -> Bool {
        (league.sport == .soccer && !["eng.league_cup", "eng.fa"].contains(league.id))
            || ["nba", "college-football"].contains(league.id)
    }
}
