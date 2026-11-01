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
    static func hasTable(_ league: League) -> Bool {
        (league.sport == .soccer && !["eng.league_cup", "eng.fa"].contains(league.id))
            || ["nba", "college-football"].contains(league.id)
    }
}
