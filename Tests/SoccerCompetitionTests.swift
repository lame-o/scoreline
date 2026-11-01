import Foundation

extension ScorelineTests {
    static func soccerCompetitions() {
        print("\nSoccer competitions")
        func fixture(_ name: String) -> JSON {
            JSON(data: (try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("competitions/\(name).json"))) ?? Data())
        }
        let request = SoccerFeedRequest(.espn(path: "soccer/sco.cis", id: "401921842", sport: .soccer))
        check(request?.league == "sco.cis" && request?.eventID == "401921842", "uncataloged cups are eligible for soccer replays")
        check(SoccerFeedRequest(.espn(path: "basketball/nba", id: "1", sport: .basketball)) == nil,
              "other sports do not request the soccer feed")
        let boards = fixture("boards")
        let current = SoccerCompetitionProvider.parse(season: fixture("current-season"), boards: [boards, boards], slug: "eng.league_cup")
        check(current.year == 2026 && current.stages.count == 8, "cup season metadata defines all eight rounds")
        let fourth = current.stages.first { $0.slug == "fourth-round" }
        check(fourth?.ties.count == 8, "fourth round has eight ties, deduplicated across boards")
        let liverpool = fourth?.ties.first { $0.games.contains { $0.id == "espn-401921842" } }
        check(liverpool?.match.top?.id == "364" && liverpool?.match.winner == .top
              && liverpool?.match.topScore == 1 && liverpool?.match.bottomScore == 1,
              "Liverpool advances after penalties despite the 1-1 match score")
        check(current.stages.last?.ties.isEmpty == true && current.bracket == nil,
              "unpublished final has no invented bracket or champion")
        check(current.stages.flatMap(\.ties).flatMap(\.games).allSatisfy { $0.sortDate > DateParser.parse("2026-06-01T00:00:00Z")! },
              "previous season games in the same calendar year are excluded")
        let previous = SoccerCompetitionProvider.parse(season: fixture("previous-season"), boards: [boards], slug: "eng.league_cup")
        let semi = previous.stages.first { $0.slug == "semifinals" }
        check(semi?.ties.count == 2 && semi?.ties.allSatisfy { $0.games.count == 2 } == true,
              "two semifinal legs form one tie per pair of teams")
        let arsenal = semi?.ties.first { $0.match.has(team: "359") }
        check(arsenal?.match.winner == .bottom && arsenal?.match.bottom?.id == "359" && arsenal?.match.bottomScore == 4,
              "aggregate winner and scores retain team identity when home and away swap")
        check(previous.bracket?.matches[previous.bracket!.finalID]?.feeders.count == 2,
              "known semifinal winners connect to the actual final")
        let champions = SoccerCompetitionProvider.parse(season: fixture("champions-season"), boards: [], slug: "uefa.champions")
        check(champions.stages.first?.hasStandings == true && champions.bracket == nil,
              "the Champions League phase is not treated as knockout matches")
        let goals = fixture("cup-goals")["items"].array
        check(goals.count == 2 && goals.indices.allSatisfy {
            Replays.soccer(goals, at: $0, homeTeamID: "364", keepers: [:]) != nil
        }, "both reported Carabao goals build isometric replays from ESPN's data")
    }
}
