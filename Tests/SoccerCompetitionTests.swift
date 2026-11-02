import Foundation

extension ScorelineTests {
    private static func fixture(_ name: String) -> JSON {
        JSON(data: (try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("competitions/\(name).json"))) ?? Data())
    }

    /// A recorded season as the page gets it, on the day it was recorded.
    private static func season(_ name: String, slug: String) -> SoccerCompetition {
        let json = fixture(name)
        return SoccerCompetition(slug: slug, info: CompetitionInfo(json["info"]), season: CompetitionSeason(json["season"])!,
                                 games: CompetitionGame.board(json["board"], slug: slug), today: DayKey(year: 2026, month: 11, day: 2))
    }

    private static func names(_ bracket: Bracket, _ id: String) -> [String] {
        [bracket.matches[id]?.top?.name, bracket.matches[id]?.bottom?.name].compactMap { $0 }
    }

    private static func winner(_ match: BracketMatch?) -> String? {
        match?.winner == .top ? match?.top?.name : match?.winner == .bottom ? match?.bottom?.name : nil
    }

    /// A team's tie in a tree's round: which column it's in, then which teams.
    private static func tie(_ bracket: Bracket, round: String, team: String) -> BracketMatch? {
        guard let column = bracket.rounds.firstIndex(of: round), let ids = bracket.columns?[column] else { return nil }
        return ids.compactMap { bracket.matches[$0] }.first { $0.top?.name == team || $0.bottom?.name == team }
    }

    static func soccerCompetitions() {
        print("\nSoccer competitions")
        competitionTrees()
        competitionPages()
        matchCompetitions()
        olderPlays()
    }

    private static func competitionTrees() {
        // A cup in progress: the last 16 played, the quarterfinals drawn, the rest not.
        let carabao = season("carabao-2026", slug: "eng.league_cup")
        check(carabao.title == "Carabao Cup" && carabao.seasonLabel == "2026–27", "a competition reads as its name and season, not ESPN's \"2026-27 English Carabao Cup\"")
        guard let tree = carabao.bracket else { return check(false, "a cup with its quarterfinals drawn has a tree") }
        check(tree.rounds == ["Fourth Round", "Quarterfinals", "Semifinals", "Final"], "the tree starts at the last 16, not the 92 teams of round one", "\(tree.rounds)")
        check(tree.columns?.map(\.count) == [8, 4, 2, 1], "each round holds its place, drawn or not", "\(tree.columns?.map(\.count) ?? [])")
        let pending = tree.matches.values.filter(\.pending)
        check(pending.count == 3 && pending.allSatisfy { $0.top == nil && $0.bottom == nil && $0.feeders.isEmpty },
              "undrawn rounds are empty places, with no lines to them")
        check(tree.matches[tree.finalID]?.pending == true, "no champion is invented")
        let liverpool = tie(tree, round: "Fourth Round", team: "Liverpool")
        check(winner(liverpool) == "Liverpool" && liverpool?.topScore == 1 && liverpool?.bottomScore == 1,
              "a shootout winner goes through on a level score", "\(String(describing: liverpool))")
        let next = tie(tree, round: "Quarterfinals", team: "Liverpool")
        check(next?.feeders.contains(liverpool?.id ?? "") == true && next?.topScore == nil, "the winner's line reaches the real next tie, which has no score yet")
        let layout = BracketLayout(tree)
        check(layout.slots.count == 15 && layout.height < 400, "the whole tree fits a page", "\(layout.slots.count) cells, \(layout.height)pt")
        if let ids = tree.columns, let semis = ids[safe: 2], let quarters = ids[safe: 1] {
            let spots = quarters.compactMap { layout.slots[$0]?.center }.sorted()
            let expected = (spots[0] + spots[1]) / 2
            check(semis.compactMap { layout.slots[$0]?.center }.contains { abs($0 - expected) < 0.5 }, "an undrawn place sits where the tree would put it")
        }

        // A finished cup: 91 ties, of which the tree shows the last 15.
        let finished = season("carabao-2025", slug: "eng.league_cup")
        check(finished.stages.flatMap(\.ties).count > 80, "every round's ties stay in Fixtures")
        guard let whole = finished.bracket else { return check(false, "a finished cup has a tree") }
        check(whole.rounds.first == "Fourth Round" && whole.matches.count == 15 && BracketLayout(whole).height < 400, "a finished cup's tree stays the same size", "\(whole.matches.count)")
        check(!whole.matches.values.contains(where: \.pending), "nothing is pending once it's played")
        check(whole.columns?.dropFirst().allSatisfy { $0.allSatisfy { whole.matches[$0]?.feeders.count == 2 } } == true, "every tie past the first round has both its feeders")
        let semis = finished.stages.first { $0.name == "Semifinals" }
        check(semis?.ties.count == 2 && semis?.ties.allSatisfy { $0.games.count == 2 } == true, "two legs are one tie")
        let arsenal = semis?.ties.first { $0.match.top?.id == "359" || $0.match.bottom?.id == "359" }
        check(winner(arsenal?.match) == "Arsenal" && arsenal?.match.bottomScore == 4, "aggregate goals decide it, whichever side the team was on", "\(String(describing: arsenal?.match))")

        // An early-round FA Cup: nothing of the tree is drawn.
        let early = season("fa-cup-2026", slug: "eng.fa")
        check(early.bracket == nil && early.undrawnFrom == "Fifth Round", "no fake tree before the last 16 is drawn", "\(String(describing: early.undrawnFrom))")
        let fa = season("fa-cup-2025", slug: "eng.fa")
        check(fa.bracket?.rounds.first == "Fifth Round", "a cup whose early rounds don't halve still has a clean tree", "\(fa.bracket?.rounds ?? [])")

        // Stages with standings aren't knockout rounds, and rounds around them aren't neighbours.
        let ucl = season("champions-2026", slug: "uefa.champions")
        check(ucl.bracket == nil && ucl.undrawnFrom == "Round of 16" && ucl.hasTable, "a league phase has a table, and a bracket to come", "\(String(describing: ucl.undrawnFrom))")
        let lastUCL = season("champions-2025", slug: "uefa.champions")
        check(lastUCL.bracket?.rounds.first == "Round of 16", "the knockout playoffs, which doesn't halve, stays in Fixtures")
        let libertadores = season("libertadores-2026", slug: "conmebol.libertadores")
        check(libertadores.bracket?.rounds.first == "Round of 16", "nothing crosses a group stage: Third Stage winners don't feed the Round of 16", "\(libertadores.bracket?.rounds ?? [])")
        // ESPN's series flag says Platense; its own note says "Fluminense win 3-2 on aggregate".
        let fluminense = libertadores.bracket.flatMap { tie($0, round: "Quarterfinals", team: "Platense") }
        check(winner(fluminense) == "Fluminense" && fluminense?.topScore == 3 && fluminense?.bottomScore == 2,
              "the aggregate names the winner over ESPN's flag", "\(String(describing: fluminense))")
        check(libertadores.bracket?.columns?.dropFirst().allSatisfy { $0.allSatisfy { libertadores.bracket?.matches[$0]?.feeders.count == 2 } } == true,
              "so every connection survives")

        // MLS: conference playoffs across eighteen ESPN stages, best-of-three, an All-Star game.
        let mls = season("mls-2025", slug: "usa.1")
        check(!mls.stages.contains { $0.name.contains("All-Star") || $0.name == "Combined" }, "exhibitions and empty placeholders aren't stages")
        check(mls.stages.filter { $0.name == "Round One" }.count == 1 && Set(mls.stages.map(\.id)).count == mls.stages.count, "same-named stages are one round")
        let roundOne = mls.stages.first { $0.name == "Round One" }
        check(roundOne?.ties.count == 8 && roundOne?.ties.allSatisfy { $0.games.count == 3 } == true, "a best-of-three is one tie of three games", "\(roundOne?.ties.count ?? 0)")
        check(mls.bracket?.rounds == ["Round One", "Conference Semifinals", "Conference Finals", "MLS Cup"], "both conferences make one clean tree", "\(mls.bracket?.rounds ?? [])")
        let series = mls.bracket.flatMap { tie($0, round: "Round One", team: "Philadelphia") ?? tie($0, round: "Round One", team: "Union") }
        check(series?.topScore == 2 && series?.bottomScore == 0 && series?.winner == .top, "a series scores games won, not goals", "\(String(describing: series))")
        check(mls.bracket?.columns?.dropFirst().allSatisfy { $0.allSatisfy { mls.bracket?.matches[$0]?.feeders.count == 2 } } == true, "every playoff connection is there")

        // Others.
        let worldCup = season("world-cup-2026", slug: "fifa.world")
        check(worldCup.bracket?.rounds.first == "Round of 32" && worldCup.bracket?.columns?.first?.count == 16, "a knockout phase opening wide after groups is all one tree")
        check(worldCup.bracket?.extra.first?.title == "3rd-Place Match", "the third-place match sits under the tree")
        let league = season("premier-league-2026", slug: "eng.1")
        check(league.bracket == nil && !league.hasKnockout && league.hasTable, "a league has a table and no bracket")
        let mexico = season("liga-mx-2025", slug: "mex.1")
        check(mexico.bracket?.rounds.first?.hasPrefix("Clausura") == true, "two tournaments in a season: the tree is the latest one's", "\(mexico.bracket?.rounds ?? [])")
        check(CompetitionGame.isPlaceholder("TBD Away") && CompetitionGame.isPlaceholder("Winner Match 73") && !CompetitionGame.isPlaceholder("Bolton Wanderers"),
              "a side ESPN doesn't know yet is no team")

        let json = fixture("carabao-2026")
        let older = CompetitionGame.board(fixture("carabao-2025")["board"], slug: "eng.league_cup")
        let mixed = SoccerCompetition(slug: "eng.league_cup", info: CompetitionInfo(json["info"]), season: CompetitionSeason(json["season"])!,
                                      games: CompetitionGame.board(json["board"], slug: "eng.league_cup") + older, today: DayKey(year: 2026, month: 11, day: 2))
        check(mixed.stages.flatMap(\.games).count == carabao.stages.flatMap(\.games).count, "a calendar year's board holds two seasons: only this one's games count")
    }

    private static func competitionPages() {
        let carabao = season("carabao-2026", slug: "eng.league_cup")
        check(CompetitionPage.tabs(carabao) == [.bracket, .fixtures], "a cup: bracket and fixtures")
        check(CompetitionPage.openingTab(carabao, highlight: []) == .bracket, "a cup in its last rounds opens on the bracket")
        let ucl = season("champions-2026", slug: "uefa.champions")
        check(CompetitionPage.tabs(ucl) == [.bracket, .fixtures, .table] && CompetitionPage.openingTab(ucl, highlight: []) == .table, "the league phase opens on its table")
        let early = season("fa-cup-2026", slug: "eng.fa")
        check(CompetitionPage.openingTab(early, highlight: []) == .fixtures, "an early round opens on its fixtures")
        let league = season("premier-league-2026", slug: "eng.1")
        check(CompetitionPage.tabs(league) == [.fixtures, .table], "a league: fixtures and table")
        check(carabao.stage(meeting: ["364", "363"])?.name == "Fourth Round", "a match's teams find the round they met in")
        check(carabao.summary.headline == "Carabao Cup" && carabao.summary.subline?.hasPrefix("Quarterfinals") == true && carabao.summary.logo != nil,
              "the hero has its logo, name and round", "\(String(describing: carabao.summary.subline))")
        let finished = season("carabao-2025", slug: "eng.league_cup")
        check(finished.summary.subline?.contains(" won") == true, "a finished season says who won", "\(String(describing: finished.summary.subline))")
        let axis = carabao.axis(today: DayKey(year: 2026, month: 11, day: 2))
        check(axis.events.count == carabao.stages.count && axis.resting == carabao.focusStage?.id, "every round is on the axis")
        check(CompetitionPage.seasonLabel(2025, like: "2026–27") == "2025–26" && CompetitionPage.seasonLabel(2025, like: "2026") == "2025", "the season menu names seasons alike")
        check(SoccerCompetitionProvider.parseSeasons(fixture("carabao-seasons")).first == 2026, "the seasons ESPN has, newest first")
        check(SoccerCompetition.title(displayName: "2026-27 Spanish Copa del Rey") == "Copa del Rey", "an unlisted competition's name loses its season and nation")
        check(League.resolving(id: "esp.copa_catalunya")?.source == .espn(path: "soccer/esp.copa_catalunya") && League.resolving(id: "../nba") == nil,
              "any ESPN soccer competition can be watched for a followed team; anything else isn't one")
        check(League.with(id: "eng.league_cup")?.hasTable == false && League.with(id: "uefa.champions")?.hasTable == true, "a cup has no table to offer")
        let search = SportsSearch.results("cup", directory: [:], editions: [])
        check(search.competitions.map(\.id).contains("eng.fa") && search.competitions.map(\.id).contains("fifa.world"), "search finds competitions")
        let liverpool = TeamOption(id: "espn-soccer-364", name: "Liverpool", logo: nil)
        let elsewhere = TeamOption(id: "espn-soccer-99", name: "Atlético Madrid", logo: nil)
        let teams = SportsSearch.results("atletico", directory: ["eng.1": [liverpool], "esp.1": [elsewhere]], editions: []).teams
        check(teams.map(\.option.name) == ["Atlético Madrid"], "search ignores accents")
        check(SportsSearch.results("liverpool", directory: ["eng.1": [liverpool], "eng.2": [liverpool]], editions: []).teams.count == 1, "a team in two lists is found once")
    }

    private static func matchCompetitions() {
        // Read through the Premier League's path, as a team's page does: it's still a Champions League match.
        let ucl = MatchCompetition(fixture("summary-ucl"))
        check(ucl?.slug == "uefa.champions" && ucl?.line == "Champions League · League Phase" && ucl?.hasKnockout == true,
              "a match is in the competition its summary says, whatever path opened it", "\(String(describing: ucl))")
        let cup = MatchCompetition(fixture("summary-cup"))
        check(cup?.line == "Carabao Cup · Fourth Round" && cup?.note == "Liverpool win 6-5 on penalties" && cup?.year == 2026, "the hero's line and note")
        let league = MatchCompetition(fixture("summary-league"))
        check(league?.line == "Premier League" && league?.hasKnockout == false, "a league match has no bracket to point to")
    }

    private static func olderPlays() {
        // Current plays: the goals Liverpool v Chelsea reported, all located.
        let goals = fixture("cup-goals")["items"].array
        check(OlderSoccerPlays.isOlder(goals) == false, "current plays are left as they are")
        check(goals.count == 2 && goals.indices.allSatisfy { Replays.soccer(goals, at: $0, homeTeamID: "364", keepers: [:]) != nil },
              "both Carabao goals build replays from ESPN's data")

        let legacy = fixture("legacy-plays")
        /// Metres to the goal being attacked, for the first goal in a run of plays.
        func distance(_ plays: [JSON], home: String) -> Double? {
            let read = plays.map(OlderSoccerPlays.current)
            guard let index = read.indices.first(where: { read[$0]["scoringPlay"].bool == true }),
                  let replay = Replays.soccer(read, at: index, homeTeamID: home, keepers: [:]), case let .soccer(scene) = replay.scene else { return nil }
            return scene.side == .top ? Pitch.length - scene.shot.from.x : scene.shot.from.x
        }
        let far = legacy["farFromGoal"].array, close = legacy["closeToGoal"].array, penalty = legacy["penalty"].array
        check(OlderSoccerPlays.isOlder(far) == true, "older plays are told by their 0…1 coordinates")
        check(OlderSoccerPlays.isOlder(fixture("unlocated-plays")["items"].array) == nil, "plays with no location say nothing either way")
        // Szoboszlai's goal against Barnsley: from outside the box, 30 yards out.
        let long = distance(far, home: "364")
        check(long.map { (20...45).contains($0) } == true, "an older long-range goal starts in the attacking half, outside the box", "\(String(describing: long))")
        let near = distance(close, home: "364")
        check(near.map { $0 < 16.5 } == true, "an older goal from close in starts in the box", "\(String(describing: near))")
        let spot = distance(penalty, home: "379")
        check(spot.map { abs($0 - 11) < 1 } == true, "an older penalty starts on the spot", "\(String(describing: spot))")
        if let shot = far.first(where: { $0["scoringPlay"].bool == true }).map(OlderSoccerPlays.current) {
            check(shot["goalPositionY"].double.map { (44.2...55.8).contains($0) } == true, "an older goal crosses the line between the posts", "\(String(describing: shot["goalPositionY"].double))")
            let action = SoccerFeed.action(shot, index: 0, homeTeamID: "364")
            check(action.map { $0.kind == .goal && $0.x > 50 } == true, "the shot map places it at the right end too", "\(String(describing: action?.x))")
        }

        // No location, no replay: nothing to promise on the row. A penalty's place is known all the same.
        let unlocated = fixture("unlocated-plays")["items"].array
        let scoring = unlocated.indices.filter { unlocated[$0]["scoringPlay"].bool == true }
        let open = scoring.filter { unlocated[$0]["type"]["text"].string?.hasPrefix("Penalty") != true }
        check(!open.isEmpty && open.allSatisfy { Replays.soccer(unlocated, at: $0, homeTeamID: "364", keepers: [:]) == nil },
              "a goal ESPN placed nowhere has no replay")
        check(SoccerFeed.action(unlocated[scoring.first ?? 0], index: 0, homeTeamID: "364") == nil, "and no place on the shot map")
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
