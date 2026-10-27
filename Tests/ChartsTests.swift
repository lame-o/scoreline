import Foundation

// Live charts, tables and brackets at every width: the live table's
// projection (every column agrees while games are live), the zones that
// places earn, column tiers, and the stepped sizes of the charts.

extension ScorelineTests {
    static func charts() {
        print("\nLive table projection")
        func row(_ id: String, rank: Int, p: Int, w: Int, d: Int, l: Int, gf: Int, ga: Int, zone: String? = nil,
                 group: String? = nil) -> StandingsRow {
            StandingsRow(id: id, group: group, name: id, abbreviation: id, logo: nil, rank: rank, played: p, wins: w, draws: d,
                         losses: l, goalDifference: gf - ga, goalsFor: gf, points: 3 * w + d, zone: zone)
        }
        let table = [row("a", rank: 1, p: 8, w: 6, d: 1, l: 1, gf: 18, ga: 6, zone: "Champions League"),
                     row("b", rank: 2, p: 8, w: 5, d: 2, l: 1, gf: 14, ga: 7, zone: "Champions League"),
                     row("c", rank: 3, p: 8, w: 4, d: 3, l: 1, gf: 12, ga: 8, zone: "Europa League"),
                     row("d", rank: 4, p: 8, w: 4, d: 1, l: 3, gf: 11, ga: 10),
                     row("e", rank: 5, p: 8, w: 1, d: 2, l: 5, gf: 5, ga: 15, zone: "Relegation")]
        func live(_ top: String, _ ts: Int, _ bottom: String, _ bs: Int) -> Event {
            Event(id: "\(top)\(bottom)", content: .match(top: comp(top, top, "\(ts)"), bottom: comp(bottom, bottom, "\(bs)")),
                  state: .live, start: .now, detail: "70'", caption: nil, link: nil)
        }
        let quiet = Standings.live(table, liveEvents: [])
        check(quiet.map(\.id) == ["a", "b", "c", "d", "e"] && quiet.allSatisfy { $0.movement == 0 && $0.liveScore == nil },
              "nothing live: the official table")
        check(zip(quiet, table).allSatisfy { lr, r in
            lr.wins == r.wins && lr.draws == r.draws && lr.losses == r.losses && lr.goalsFor == r.goalsFor
                && lr.goalsAgainst == r.goalsFor - r.goalDifference && lr.played == r.played && lr.points == r.points
        }, "nothing live: W, D, L, GF and GA as ESPN has them")

        // d leads c 3–1; e and a draw 2–2.
        let projected = Standings.live(table, liveEvents: [live("d", 3, "c", 1), live("e", 2, "a", 2)])
        let d = projected.first { $0.id == "d" }, c = projected.first { $0.id == "c" }
        let e = projected.first { $0.id == "e" }, a = projected.first { $0.id == "a" }
        check(d?.played == 9 && d?.wins == 5 && d?.draws == 1 && d?.losses == 3 && d?.points == 16,
              "a live lead: +1 played, +1 won, +3 points together", "\(String(describing: d))")
        check(d?.goalsFor == 14 && d?.goalsAgainst == 11 && d?.goalDifference == 3, "a live lead: +3 for, +1 against, GD +2")
        check(c?.played == 9 && c?.wins == 4 && c?.losses == 2 && c?.points == 15 && c?.goalsFor == 13 && c?.goalsAgainst == 11,
              "the trailing side: +1 lost, goals both ways, no points")
        check(e?.draws == 3 && e?.points == 6 && e?.goalsFor == 7 && e?.goalsAgainst == 17
              && a?.draws == 2 && a?.points == 20 && a?.goalsAgainst == 8, "a live draw: +1 drawn, +1 point each")
        check(projected.allSatisfy { r in
            r.points == 3 * r.wins + r.draws && r.played == r.wins + r.draws + r.losses && r.goalDifference == r.goalsFor - r.goalsAgainst
        }, "every projected row adds up: P = W+D+L, Pts = 3W+D, GD = GF−GA")
        check(d?.liveRank == 3 && d?.movement == 1 && c?.liveRank == 4, "the leader climbs past the side it's beating")
        check(d?.zone == "Europa League" && c?.zone == nil && a?.zone == "Champions League",
              "zones belong to places: 3rd's zone goes to whoever is projected 3rd")
        check(d?.liveScore == "3–1" && c?.liveScore == "1–3", "live score from each side")

        let groups = Standings.live([row("x", rank: 1, p: 1, w: 1, d: 0, l: 0, gf: 2, ga: 0, zone: "Playoffs", group: "East"),
                                     row("y", rank: 1, p: 1, w: 0, d: 1, l: 0, gf: 1, ga: 1, group: "West")], liveEvents: [])
        check(groups.first?.zone == "Playoffs" && groups.last?.zone == nil, "zones are per group (each group's 1st is its own)")

        print("\nStandings parse")
        let parsed = Standings.soccer(JSON(["children": [["standings": ["entries": [
            ["team": ["id": "1", "shortDisplayName": "One", "abbreviation": "ONE"],
             "note": ["color": "#81D6AC", "description": "Champions League", "rank": 1],
             "stats": [["name": "rank", "value": 1.0], ["name": "gamesPlayed", "value": 8.0], ["name": "wins", "value": 7.0],
                       ["name": "ties", "value": 0.0], ["name": "losses", "value": 1.0], ["name": "pointsFor", "value": 20.0],
                       ["name": "pointDifferential", "value": 11.0], ["name": "points", "value": 21.0]]],
            ["team": ["id": "2", "shortDisplayName": "Two", "abbreviation": "TWO"],
             "stats": [["name": "rank", "value": 2.0]]],
        ]]]]] as [String: Any]))
        check(parsed.count == 2 && parsed[0].zone == "Champions League" && parsed[1].zone == nil,
              "ESPN's note becomes the place's zone")
        check(parsed[0].wins == 7 && parsed[0].goalsFor == 20 && parsed[0].goalDifference == 11 && parsed[0].points == 21,
              "W, GF, GD and points parsed")

        print("\nTable columns by width")
        typealias Column = StandingsTable.Column
        check(Column.shown(at: .compact) == [.played, .goalDifference, .points], "compact: today's P, GD, Pts")
        check(Column.shown(at: .medium) == [.played, .won, .drawn, .lost, .goalDifference, .points], "medium adds W, D, L")
        check(Column.shown(at: .large) == Column.allCases && Column.shown(at: .xlarge) == Column.allCases, "large adds GF and GA")
        // At each threshold the team column keeps 120pt, in the tighter of the two
        // hosts: a match-page section, where a row's content is C − 12 (its 6pt
        // padding each side). # 30, crest 15, 6pt between the row's children.
        for (cls, threshold) in [(WidthClass.medium, 380.0), (.large, 460.0)] {
            let cols = Column.shown(at: cls)
            let fixed = 30 + 15 + cols.map(\.width).reduce(0, +) + 6 * CGFloat(cols.count + 3)
            check(CGFloat(threshold) - 12 - fixed >= 120, "team column keeps 120pt at the \(cls) threshold",
                  "\(CGFloat(threshold) - 12 - fixed)")
        }
        let shown = projected.sorted { $0.liveRank < $1.liveRank }
        check(StandingsTable.value(.goalDifference, shown[0]) == "+12" && StandingsTable.value(.goalsAgainst, shown[2]) == "11",
              "cell values: signed GD, GA from GF − GD")
        check(StandingsTable.zoneBoundary(at: 0, in: shown) == .init(label: "Champions League")
              && StandingsTable.zoneBoundary(at: 1, in: shown) == nil
              && StandingsTable.zoneBoundary(at: 2, in: shown) == .init(label: "Europa League")
              && StandingsTable.zoneBoundary(at: 3, in: shown) == .init(label: nil)
              && StandingsTable.zoneBoundary(at: 4, in: shown) == .init(label: "Relegation"),
              "zone lines: where each zone begins, unlabeled where mid-table resumes")
        let window = [shown[1], shown[4]]
        check(StandingsTable.zoneBoundary(at: 1, in: window) == .init(label: "Relegation"), "zones read across a window's gap")

        print("\nStepped chart sizes")
        check(StrikeZoneView.plotSize(.compact) == CGSize(width: 120, height: 150)
              && StrikeZoneView.plotSize(.medium) == CGSize(width: 120, height: 150)
              && StrikeZoneView.plotSize(.large) == CGSize(width: 150, height: 188)
              && StrikeZoneView.plotSize(.xlarge) == CGSize(width: 150, height: 188), "strike zone: one step at large")
        check(LeadAscentView.plotHeight(.medium) == 250 && LeadAscentView.plotHeight(.large) == 300, "lead ascent: 250, then 300 from large")
        check([WidthClass.compact, .medium, .large, .xlarge].map(ClimbingWallView.maxLanes) == [8, 9, 10, 12], "wall lanes: 8, 9, 10, 12")
        check(RoundHistoryView.pairedWidth == 572, "CS2 halves pair up from 572pt (34 + 262 + 14 + 262)")
        // Chart units cap where the spec says: pitch 260 tall (unit 421), spray 300 (unit 377).
        check(abs(PitchView.maxPlotHeight * 105 / 68 + 20 - 421.5) < 0.5 && abs(SprayChartView.maxPlotHeight * 250 / 210 + 20 - 377.1) < 0.5,
              "pitch caps at a 421pt unit, spray at 377")

        print("\nLegend summaries")
        func shot(_ side: GameDetail.Side, goal: Bool) -> PitchAction {
            PitchAction(id: 0, kind: goal ? .goal : .shot, side: side, x: 0, y: 0, endX: nil, endY: nil, minute: "1'", text: "")
        }
        check(PitchView.summary([shot(.top, goal: true), shot(.top, goal: false), shot(.bottom, goal: false)], topName: "AVL", bottomName: "MCI")
              == "AVL 2 shots, 1 goal · MCI 1 shot, 0 goals", "pitch: shots and goals per side")

        print("\nBoulder totals")
        let card = GameDetail.BoulderCard(id: 1, rank: 1, name: "A", country: nil, flag: nil,
                                          problems: [.init(reach: .top, tries: 1), .init(reach: .zone, tries: 2),
                                                     .init(reach: .lowZone, tries: 3), .init(reach: .none, tries: 4)], score: "35.0")
        check(BoulderScorecard.totals(card) == (1, 2), "a top is a zone too; a low zone isn't a zone")

        print("\nBrackets")
        check(BracketView.cellWidth(in: 312, rounds: 4) == 69 && BracketView.cellWidth(in: 732, rounds: 4) == 174,
              "MLB: 69pt cells at 340, 174 at 760 (never capped)")
        check(BracketView.cellWidth(in: 732, rounds: 3) == 180 && BracketView.maxWidth(rounds: 3) == 564,
              "three rounds cap at 180 and center as a 564pt unit")
        check(BracketView.cellWidth(in: 312, rounds: 4) < BracketView.namesFrom
              && BracketView.cellWidth(in: 560, rounds: 4) >= BracketView.namesFrom, "names once cells reach 120")
        let stage = CSTournament.swiss(JSON(["rounds": [
            ["round_index": 0, "matches": [["team1_id": 1, "team2_id": 2, "winner_team_id": 1]]],
            ["round_index": 1, "matches": [["team1_id": 2, "team2_id": 1]]],
        ]] as [String: Any]), teams: [1: BracketTeam(id: "1", name: "One", abbreviation: "ONE", logo: nil),
                                      2: BracketTeam(id: "2", name: "Two", abbreviation: "TWO", logo: nil)])
        let one = stage?.rows.first { $0.team.id == "1" }
        check(one?.results == [true, nil] && one?.opponents.map { $0?.id } == ["2", "2"],
              "Swiss: each round's opponent, the next one once drawn")
    }
}
