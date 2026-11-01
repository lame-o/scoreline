import Foundation

extension ScorelineTests {
    static func followingPolicy() {
        print("\nFollowing policy")
        let picks: [String: Set<String>] = ["eng.1": ["espn-soccer-364"], "nba": []]
        check(FollowingPolicy.migrateFilters(["eng.1", "nba", "ifsc"], picks: picks, version: 0) == ["eng.1", "ifsc"], "migration keeps scoped picks and preserves legacy empty selection as all games")
        check(FollowingPolicy.migrateFilters(["nba"], picks: picks, version: 2) == ["nba"], "v2 intentionally empty selections stay empty")
        let edition = EditionFollow(source: "cs2", key: "major-2026", name: "Major 2026")
        check(FollowingPolicy.sanitizeEditions([edition, edition]) == [edition], "stored editions deduplicate by provider identity")
        check(edition.valid, "edition accepts stable provider slug")
        check(!EditionFollow(source: "cs2", key: "../../other", name: "Other").valid, "edition rejects malformed provider identity")
        check(!EditionFollow(source: "ifsc", key: "NaN", name: "Other").valid, "climbing edition requires numeric event identity")
        let team = FollowedTeam(id: "cs-1", name: "Team", logo: nil)
        var match = Event(id: "cs-match", content: .match(top: comp(team.id, team.name), bottom: comp("cs-2", "Opponent")), state: .live, start: .now, detail: nil, caption: nil, link: nil, ref: .counterStrike(slug: "match", tournament: "major-2026"))
        check(edition.matches(match), "edition includes its own tournament match")
        match.ref = .counterStrike(slug: "match", tournament: "other-major")
        check(!edition.matches(match), "edition never expands to the entire game")
        check(!FollowingPolicy.alertsFor(match, followed: [team], muted: [team.id], enabled: true), "a silent team follow produces no alerts")
        check(FollowingPolicy.alertsFor(match, followed: [team], muted: [], enabled: true), "team alerts can be enabled independently")
        check(!FollowingPolicy.alertsFor(match, followed: [team], muted: [], enabled: false), "master alert switch pauses individual alerts")
        match.ref = .climbing(eventID: 1489, category: "Lead Women", resultURL: nil, round: nil, eventName: "Santiago", nextURL: nil)
        check(EditionFollow(source: "ifsc", key: "1489", name: "Santiago").matches(match), "climbing follows apply across the event's categories")
        check(!EditionFollow(source: "ifsc", key: "1490", name: "Santiago").matches(match), "same city in a different edition does not match")
        check(FollowingPolicy.teamLeague("espn-wnba-3") == "wnba" && FollowingPolicy.teamLeague("espn-basketball-3") == "nba", "WNBA and NBA follow independently")
        check(FollowingPolicy.teamLeague("espn-ncaaf-3") == "college-football", "college follows retain their separate namespace")
        check(FollowingPolicy.teamLeague("espn-football-3") == "nfl", "NFL team follow can poll without a league subscription")
        check(CompetitionCatalog.kind(League.with(id: "cs2")!).contains("Game"), "game is a discovery scope, not a tournament")
        check(CompetitionCatalog.kind(League.with(id: "eng.league_cup")!) == "Cup", "cups are first-class competitions")
        check(!CompetitionCatalog.hasTable(League.with(id: "eng.league_cup")!), "cup does not advertise an unsupported standings table")
        check(RootView.Page.following.backTitle == "Following" && RootView.Page.addSports.backTitle == "Sports", "navigation names the destination the user came from")
        let data = try? JSONEncoder().encode([edition])
        check(data.flatMap { try? JSONDecoder().decode([EditionFollow].self, from: $0) } == [edition], "edition follows round-trip through persistence")
    }
}
