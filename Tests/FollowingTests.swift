import Foundation

extension ScorelineTests {
    /// A store on its own preferences, shaped like a real user's.
    private static func store(_ set: (UserDefaults) -> Void) -> (ScoreStore, UserDefaults) {
        let domain = "io.github.lame-o.Scoreline.following-tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: domain)!
        defaults.set(false, forKey: "showCoStream")
        set(defaults)
        return (ScoreStore(defaults: defaults), defaults)
    }

    static func followingPolicy() {
        print("\nFollowing policy")
        let picks: [String: Set<String>] = ["eng.1": ["espn-soccer-364"], "nba": []]
        check(FollowingPolicy.migrateFilters(["eng.1", "nba", "ifsc"], picks: picks, version: 0) == ["eng.1", "ifsc"], "an old empty selection meant every game, and keeps meaning it")
        check(FollowingPolicy.migrateFilters(["nba"], picks: picks, version: 2) == ["nba"], "after that, selecting no teams means no games")
        let edition = EditionFollow(source: "cs2", key: "major-2026", name: "Major 2026")
        check(FollowingPolicy.sanitizeEditions([edition, edition]) == [edition], "a tournament is followed once")
        check(!EditionFollow(source: "cs2", key: "../../other", name: "Other").valid, "a stored tournament needs a real provider key")
        check(!EditionFollow(source: "ifsc", key: "NaN", name: "Other").valid, "a stored climbing event needs a numeric ID")
        let team = FollowedTeam(id: "cs-1", name: "Team", logo: nil)
        var match = Event(id: "cs-match", content: .match(top: comp(team.id, team.name), bottom: comp("cs-2", "Opponent")), state: .live, start: .now, detail: nil, caption: nil, link: nil, ref: .counterStrike(slug: "match", tournament: "major-2026"))
        check(edition.matches(match), "a followed tournament includes its own matches")
        match.ref = .counterStrike(slug: "match", tournament: "other-major")
        check(!edition.matches(match), "and nobody else's")
        check(!FollowingPolicy.alertsFor(match, followed: [team], muted: [team.id], enabled: true), "a team's bell turns its alerts off")
        check(FollowingPolicy.alertsFor(match, followed: [team], muted: [], enabled: true), "a followed team alerts")
        check(!FollowingPolicy.alertsFor(match, followed: [team], muted: [], enabled: false), "the one toggle turns them all off")
        match.ref = .climbing(eventID: 1489, category: "Lead Women", resultURL: nil, round: nil, eventName: "Santiago", nextURL: nil)
        check(EditionFollow(source: "ifsc", key: "1489", name: "Santiago").matches(match), "a followed climbing event spans its categories")
        check(!EditionFollow(source: "ifsc", key: "1490", name: "Santiago").matches(match), "another edition in the same city doesn't match")
        check(FollowingPolicy.teamLeague("espn-wnba-3") == "wnba" && FollowingPolicy.teamLeague("espn-basketball-3") == "nba", "a WNBA team and an NBA team with the same number are different teams")
        check(FollowingPolicy.teamLeague("espn-ncaaf-3") == "college-football" && FollowingPolicy.teamLeague("espn-football-3") == "nfl", "a football team's board is its league's")
        check(FollowingPolicy.teamLeague("espn-soccer-364") == nil && FollowingPolicy.teamLeague("cs-9") == "cs2", "a soccer team has no one board: its next game says which")

        // A user's own settings: picks in use, picks parked, a followed team.
        let (saved, defaults) = store { defaults in
            defaults.set(["ifsc", "eng.1", "uefa.champions", "mlb", "cs2", "nfl", "nba", "usa.1"], forKey: "enabledLeagues")
            defaults.set(["mlb", "uefa.champions", "ifsc"], forKey: "filteredLeagues")
            defaults.set(["eng.1": ["espn-soccer-382", "espn-soccer-363", "espn-soccer-364", "espn-soccer-360", "espn-soccer-359"],
                          "mlb": ["espn-baseball-8", "espn-baseball-25", "espn-baseball-19"],
                          "uefa.champions": ["espn-soccer-132", "espn-soccer-360", "espn-soccer-382", "espn-soccer-364", "espn-soccer-359", "espn-soccer-86", "espn-soccer-83", "espn-soccer-160"],
                          "ifsc": ["country-USA"]], forKey: "teamFilters")
            defaults.set(["cs2", "ifsc", "uefa.champions"], forKey: "collapsedSections")
            defaults.set(try? JSONEncoder().encode([FollowedTeam(id: "espn-baseball-25", name: "San Diego Padres", logo: nil)]), forKey: "followedTeams")
        }
        let ucl = League.with(id: "uefa.champions")!, epl = League.with(id: "eng.1")!, mlb = League.with(id: "mlb")!
        check(saved.picks(for: ucl).count == 8 && saved.picks(for: mlb).count == 3 && saved.picks(for: epl).count == 5, "every pick survives")
        check(saved.isFilterOn(ucl) && saved.isFilterOn(mlb) && !saved.isFilterOn(epl), "and which leagues use them")
        check(saved.collapsed.contains("uefa.champions") && saved.followed.map(\.id) == ["espn-baseball-25"] && saved.mutedTeams.isEmpty, "collapsed sections and followed teams stay, alerting as they did")
        func game(_ a: String, _ b: String) -> Event {
            Event(id: "\(a)-\(b)", content: .match(top: comp(a, a), bottom: comp(b, b)), state: .scheduled, start: .now, detail: nil, caption: nil, link: nil, ref: nil)
        }
        let games = [game("espn-soccer-364", "espn-soccer-1"), game("espn-soccer-2", "espn-soccer-3")]
        check(saved.filtered(games, league: epl).count == 2, "parked picks don't filter: every Premier League match shows")
        saved.setFilterOn(epl, true)
        check(saved.filtered(games, league: epl).map(\.id) == ["espn-soccer-364-espn-soccer-1"], "turning Selected Teams on brings the parked picks back")
        saved.setFilterOn(epl, false)
        check(saved.picks(for: epl).count == 5, "and turning it off keeps them")
        saved.setEnabled(ucl, false)
        check(saved.picks(for: ucl).count == 8, "unfollowing a competition keeps its picks")
        check(defaults.integer(forKey: "followingSchemaVersion") == 2, "the migration is written once")

        // Alerts: a new follow alerts until its bell says otherwise.
        let (alerts, _) = store { _ in }
        let liverpool = Competitor(id: "espn-soccer-364", name: "Liverpool", abbreviation: "LIV", score: nil, logo: nil, isWinner: false)
        alerts.toggleFollow(liverpool)
        check(alerts.isFollowing(liverpool) && !alerts.mutedTeams.contains("espn-soccer-364"), "a new follow alerts by default")
        alerts.setTeamAlerts("espn-soccer-364", false)
        check(alerts.mutedTeams.contains("espn-soccer-364"), "its bell turns them off")
        alerts.toggleFollow(liverpool)
        check(alerts.mutedTeams.isEmpty, "unfollowing forgets the bell")
        // A followed team's next game, wherever it's played, puts that board on the poll.
        check(alerts.polledLeagues.allSatisfy { League.resolving(id: $0.id) != nil }, "only real boards are polled")
        alerts.setEnabled(League.with(id: "eng.league_cup")!, true)
        check(alerts.enabledLeagues.contains { $0.id == "eng.league_cup" } && alerts.isEnabled(League.with(id: "eng.league_cup")!), "a cup can be followed")
        let data = try? JSONEncoder().encode([edition])
        check(data.flatMap { try? JSONDecoder().decode([EditionFollow].self, from: $0) } == [edition], "a followed tournament round-trips through preferences")
    }
}
