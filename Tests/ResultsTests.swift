import Foundation

// Results: ESPN boards and team schedules recorded on 26 Oct 2026
// (Tests/Fixtures/results, slimmed from specs/results), decoded directly
// through the pure parsers (FixtureProtocol ignores `dates`, so boards can't
// be replayed through it), plus synthetic worst cases (specs/results.md §11)
// and the store over a stubbed cache.

extension ScorelineTests {
    static func results() async {
        print("\nResults")
        resultsSoccer()
        resultsKnockouts()
        resultsUSSports()
        resultsTeamSeasons()
        resultsWorstCases()
        resultsRounds()
        await resultsStore()
        await resultsScoresList()
    }

    // MARK: Helpers

    private static func resultFixture(_ name: String) -> Data {
        (try? Data(contentsOf: URL(fileURLWithPath: "Tests/Fixtures/results/\(name)"))) ?? Data()
    }

    private static func scheduleFixture(_ name: String) -> Data {
        (try? Data(contentsOf: URL(fileURLWithPath: "Tests/Fixtures/schedules/\(name)"))) ?? Data()
    }

    nonisolated private static func at(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso) ?? .distantPast }

    /// Monday 26 Oct 2026, 10 AM in California: when the samples were recorded.
    nonisolated private static let monday = at("2026-10-26T17:00:00Z")
    nonisolated private static let california = TimeZone(identifier: "America/Los_Angeles")!

    private static func board(_ data: Data, path: String, league: String, sport: Sport) -> [ScheduleItem] {
        ScheduleProvider.ESPN.parseScoreboard(data, path: path, league: league, sport: sport, now: monday, zone: california)
    }

    private static func game(_ items: [ScheduleItem], _ id: String) -> ScheduleItem? { items.first { $0.id == "espn-\(id)" } }

    // MARK: Soccer

    static func resultsSoccer() {
        let day = board(resultFixture("espn_eng1_day_20261024.json"), path: "soccer/eng.1", league: "eng.1", sport: .soccer)
        check(day.count == 4 && day.allSatisfy { $0.status == .final && $0.result?.label == "FT" && $0.result?.kind == .regulation },
              "EPL Oct 24: four finals, each \"FT\"", "\(day.map { $0.result?.label ?? "-" })")

        let villa = game(day, "401879256")
        let r = villa?.result
        check(r?.scorers.map { "\($0.top ? "top" : "bottom") \($0.name) \($0.minute)" }
              == ["top N. Jackson 6'", "bottom E. Haaland 52'", "top N. Jackson 60'"],
              "Villa 2–1 City: Jackson 6', 60' for Villa (top), Haaland 52' for City", "\(String(describing: r?.scorers))")
        check(r?.details == "Jackson 6', 60' · Haaland 52'", "details: \"Jackson 6', 60' · Haaland 52'\"", r?.details ?? "nil")
        check(r?.gamesPlayed == 8 && r?.attendance == 36743 && r?.headline == "Man City beaten by double from Villa's Jackson",
              "matchweek 8 from the records, attendance 36,743, the recap headline")
        check(r?.spoken == "Aston Villa 2, Man City 1, full time, Aston Villa won. Goals: Jackson, 6th and 60th minute; Haaland, 52nd minute.",
              "VoiceOver: score, full time, winner, then the goals in words", r?.spoken ?? "nil")
        check(villa?.top?.winner == true && villa?.bottom?.winner == false && villa?.event().stepsBack(villa!.event().competitors[1]) == true,
              "City dims (lost the match)")

        let chelsea = game(day, "401878767")?.result
        let penders = chelsea?.scorers.first { $0.name == "M. Penders" }
        let palmer = chelsea?.scorers.first { $0.mark == .red }
        check(penders?.mark == .ownGoal && penders?.top == false, "Penders' own goal counts for Spurs (bottom), not Chelsea")
        check(palmer?.name == "C. Palmer" && palmer?.minute == "80'" && palmer?.top == true, "Palmer's red card, 80', Chelsea (top)")
        check(chelsea?.details == "Penders 77' (OG) · Tel 87' · ▮ Palmer 80'",
              "details: own goal marked, the red card last with its mark", chelsea?.details ?? "nil")
        check(chelsea?.attendance == nil, "attendance 0 means unknown (not shown)")

        let arsenal = game(day, "401878768")
        check(arsenal?.top?.abbreviation == "ARS" && arsenal?.top?.score == "2" && arsenal?.bottom?.score == "0"
              && arsenal?.result?.details == "Konsa 7' · Magalhães 68'",
              "Everton at Arsenal: Arsenal on top (home), 2–0, Konsa and Magalhães", arsenal?.result?.details ?? "nil")
    }

    // MARK: Knockouts: two legs, extra time, penalties

    static func resultsKnockouts() {
        let ucl = board(resultFixture("espn_ucl_month_202603_two_legs.json"), path: "soccer/uefa.champions",
                        league: "uefa.champions", sport: .soccer)
        let spurs = game(ucl, "401862580")
        let r = spurs?.result
        check(r?.leg == 2 && r?.aggregate == .init(top: 5, bottom: 7) && r?.advances == "Atlético Madrid",
              "Spurs 3–2 Atlético (2nd leg): aggregate 5–7, Atlético Madrid advance")
        check(spurs?.top?.winner == true && spurs?.bottom?.winner == false,
              "Spurs won the match: the winner follows the score, not ESPN's tie winner (Atlético)")
        check(r?.secondLine == "Agg 5–7" && r?.context == "Round of 16 · 2nd leg · Atlético advance 7–5 on agg.",
              "status line 2 \"Agg 5–7\"; the advance said in words", "\(r?.secondLine ?? "nil") | \(r?.context ?? "nil")")
        check(r?.details == "Kolo Muani 30' · Simons 52', 90' (P) · Álvarez 47' · Hancko 75'",
              "a penalty is marked (P) after its minute; surnames keep particles", r?.details ?? "nil")
        check(r?.spoken?.contains("Round of 16, second leg: Atlético Madrid advance 7 to 5 on aggregate.") == true,
              "VoiceOver says who went through", r?.spoken ?? "nil")
        let firstLegs = ucl.filter { $0.result?.leg == 1 }
        check(firstLegs.count == 8 && firstLegs.allSatisfy { $0.result?.aggregate == nil && $0.result?.secondLine == nil },
              "eight 1st legs, no aggregate")
        let sporting = game(ucl, "401862584")?.result
        check(sporting?.kind == .extraTime && sporting?.label == "AET" && sporting?.advances != nil, "Sporting 5–0 Bodø: AET, advances")

        let wc = board(resultFixture("espn_wc_month_202607_aet_pens.trimmed.json"), path: "soccer/fifa.world", league: "fifa.world", sport: .soccer)
        let egypt = game(wc, "760499")
        let p = egypt?.result
        check(p?.kind == .penalties && p?.label == "Pens" && p?.shootout == .init(top: 2, bottom: 4) && p?.secondLine == "2–4",
              "Australia 1–1 Egypt: \"Pens\", shootout 2–4 on line 2")
        check(egypt?.bottom?.winner == true && egypt?.top?.winner == false && p?.advances == "Egypt", "Egypt won (level score: the shootout)")
        check(p?.scorers.count == 2 && p?.scorers.allSatisfy { $0.minute != "120'" } == true,
              "no shootout kick among the scorers (six excluded)", "\(String(describing: p?.scorers.map(\.name)))")
        check(p?.context == "Round of 32 · Egypt advance 4–2 on pens.", "context: the round and the shootout", p?.context ?? "nil")
        check(p?.spoken?.hasPrefix("Australia 1, Egypt 1, after penalties, Egypt won 4 to 2 on penalties. Round of 32.") == true,
              "VoiceOver: \"after penalties, Egypt won 4 to 2 on penalties. Round of 32.\"", p?.spoken ?? "nil")
        check(game(wc, "760517")?.result?.kind == .extraTime && game(wc, "760517")?.result?.label == "AET"
              && game(wc, "760493")?.result?.label == "AET", "the final (Spain 1–0 Argentina) and Belgium–Senegal: AET")
        check(game(wc, "760517")?.result?.context == nil, "a single game with no leg or shootout leaves the line to the scorers")
    }

    // MARK: Football, baseball, basketball

    static func resultsUSSports() {
        let nfl = board(resultFixture("espn_nfl_week7.json"), path: "football/nfl", league: "nfl", sport: .football)
        let giants = game(nfl, "401873016")?.result
        check(giants?.label == "Final/OT" && giants?.kind == .overtime && giants?.periods == 5, "Giants at Texans: Final/OT, period 5")
        check(giants?.performers.map { "\($0.category) \($0.name)" } == ["passingYards J.J. McCarthy", "rushingYards C. Skattebo",
                                                                        "receivingYards M. Nabers"],
              "leaders from the competition: McCarthy, Skattebo, Nabers")
        check(giants?.details == "McCarthy 252 yds · Skattebo 124 rush yds, 1 TD", "compact: passer and the bigger of rush/rec",
              giants?.details ?? "nil")
        check(giants?.detailsWide == "McCarthy 20/28, 252 yds · Skattebo 124 rush yds, 1 TD · Nabers 7 rec, 111 yds",
              "wide: all three", giants?.detailsWide ?? "nil")
        check(giants?.spoken?.hasPrefix("Giants 27, Texans 21, final, overtime, Giants won.") == true, "VoiceOver: final, overtime",
              giants?.spoken ?? "nil")
        let paris = game(nfl, "401873011")
        check(paris?.notes == ["NFL Paris Game"] && paris?.result?.context == nil, "the Paris game keeps its note; it isn't knockout context")
        check(game(nfl, "401873009")?.result == nil, "Monday night (scheduled): no result")

        let cfb = board(resultFixture("espn_cfb_week8_ot.trimmed.json"), path: "football/college-football", league: "college-football",
                        sport: .football)
        let ucf = game(cfb, "401856835")?.result
        check(ucf?.label == "Final/2OT" && ucf?.periods == 6 && ucf?.spoken?.contains("double overtime") == true,
              "BYU at UCF: Final/2OT, period 6, \"double overtime\"")

        let mlb = board(resultFixture("espn_mlb_day_20261024_ws_g2.json"), path: "baseball/mlb", league: "mlb", sport: .baseball)
        let ws = game(mlb, "401908043")?.result
        check(ws?.decisions?.win == .init(name: "A. Uribe", record: "1–0", athleteID: "4917865")
              && ws?.decisions?.loss?.record == "0–2" && ws?.decisions?.save?.record == "3",
              "decisions from competitions[0].status: W Uribe 1–0, L Wells 0–2, S Ashby 3")
        check(ws?.details == "W Uribe (1–0) · L Wells (0–2) · S Ashby (3)", "details: \"W Uribe (1–0) · L Wells (0–2) · S Ashby (3)\"",
              ws?.details ?? "nil")
        check(ws?.series == "MIL leads 2–0" && ws?.context == "World Series · Game 2 · MIL leads 2–0",
              "series \"MIL leads 2–0\"; the context line is the series", ws?.context ?? "nil")
        check(ws?.spoken == "Rays 4, Brewers 5, final, Brewers won. World Series, Game 2, Milwaukee leads 2 to 0. "
              + "Winning pitcher Uribe, losing pitcher Wells, save Ashby.", "VoiceOver: the series and the decisions", ws?.spoken ?? "nil")

        let extra = board(resultFixture("espn_mlb_day_20260915_extra_innings.trimmed.json"), path: "baseball/mlb", league: "mlb", sport: .baseball)
        let elevens = extra.compactMap(\.result).filter { $0.label == "Final/11" }
        check(elevens.count == 2 && elevens.allSatisfy { $0.periods == 11 && $0.kind == .overtime && $0.spoken?.contains("11 innings") == true },
              "two Final/11 games: 11 periods, spoken \"11 innings\"")

        let nba = board(resultFixture("espn_nba_day_20261025.trimmed.json"), path: "basketball/nba", league: "nba", sport: .basketball)
        let lakers = game(nba, "401909861")?.result
        check(lakers?.details == "Doncic 52 pts · Markkanen 28 pts", "Lakers at Jazz: points leaders, winner first", lakers?.details ?? "nil")
        check(lakers?.detailsWide == "Doncic 52 pts, 8 reb, 10 ast · George 24 pts, 9 reb, 10 ast", "wide: the rating lines",
              lakers?.detailsWide ?? "nil")
        let finals = board(resultFixture("espn_nba_month_202606_finals.trimmed.json"), path: "basketball/nba", league: "nba", sport: .basketball)
        check(game(finals, "401859967")?.result?.series == "NY wins 4–1"
              && game(finals, "401859967")?.notes == ["NBA Finals · Game 5 · NY wins 4–1"], "Finals game 5: \"NY wins 4–1\"")
    }

    // MARK: Team seasons

    static func resultsTeamSeasons() {
        let parsed = ScheduleProvider.ESPN.parseTeamSchedule(scheduleFixture("espn_team_all_359_results.json"), path: "soccer/all",
                                                             league: "soccer", sport: .soccer, now: monday, zone: california)
        let arsenal = ScheduleTeamRef(id: "espn-soccer-359", name: "Arsenal", logo: nil)
        let friendlies = parsed.items.filter(TeamSeasons.isFriendly)
        check(friendlies.count == 4 && Set(friendlies.map(\.league)) == ["club.friendly", "friendly.emirates_cup"],
              "four friendlies (club.friendly, friendly.emirates_cup); the Community Shield is competitive")
        let dortmund = parsed.items.first { $0.id == "espn-401881706" }
        check(dortmund?.top?.winner == false && dortmund?.bottom?.winner == true && dortmund?.result?.kind == .penalties
              && dortmund?.result?.shootout == .init(top: 5, bottom: 4),
              "Arsenal 2–3 Dortmund (Emirates Cup): Dortmund won the match; Arsenal's 5–4 shootout from the note")
        if let dortmund, let o = TeamSeasons.outcome(dortmund, team: arsenal.id) {
            let mark = TeamSeasons.mark(dortmund, letter: o.letter, mine: o.mine, other: o.other)
            check(mark.letter == "L" && mark.readout.contains("L 2–3 · won 5–4 on pens"),
                  "form follows the match: \"L 2–3 · won 5–4 on pens\"", mark.readout)
        }
        check(parsed.items.first { $0.id == "espn-401886555" }?.result?.context == "Arsenal win 4–3 on pens.",
              "Arsenal 1–1 Como: \"Arsenal win 4–3 on pens.\"")

        let season = TeamSeasons.summarize(items: parsed.items, team: arsenal, season: "2026–27", isCurrent: true, summary: parsed.summary)
        check(season.played == 13 && season.won == 11 && season.drawn == 1 && season.lost == 1,
              "Arsenal: 13 played, W 11 D 1 L 1 (4 friendlies excluded)", "\(season.played) \(season.won) \(season.drawn) \(season.lost)")
        check(season.scoredFor == 26 && season.scoredAgainst == 9, "goals 26–9", "\(season.scoredFor ?? -1)–\(season.scoredAgainst ?? -1)")
        check(season.record == "7–0–1" && season.standing == "2nd in Premier League",
              "the current season: ESPN's \"7–0–1 · 2nd in Premier League\"", "\(season.record ?? "nil") \(season.standing ?? "nil")")
        check(season.form.suffix(5).map(\.letter) == ["W", "W", "W", "D", "W"] && season.form.count == 10
              && season.form.last?.readout == "Sat, Oct 24 · W 2–0 vs Everton · Premier League"
              && season.form.last?.spoken == "October 24, won 2 to 0 against Everton",
              "form W W W D W (oldest → newest), readout and words", season.form.last?.readout ?? "nil")
        check(season.results.first?.id == "espn-401878768" && season.results.count == 13, "results newest first")
        let all = TeamSeasons.summarize(items: parsed.items, team: arsenal, season: "2026–27", isCurrent: true, summary: parsed.summary,
                                        includeFriendlies: true)
        check(all.played == 17, "with friendlies: 17 played")

        let kc = ScheduleProvider.ESPN.parseTeamSchedule(resultFixture("espn_team_nfl_12_season2024.json"), path: "football/nfl",
                                                         league: "nfl", sport: .football, now: monday, zone: california)
        let chiefs = TeamSeasons.summarize(items: kc.items, team: ScheduleTeamRef(id: "espn-football-12", name: "Chiefs", logo: nil),
                                           season: "2024", isCurrent: false, summary: kc.summary)
        check(kc.items.count == 17 && kc.summary == "5–1 · 1st in AFC West" && chiefs.record == "15–2" && chiefs.standing == nil
              && chiefs.played == 17, "Chiefs 2024: ESPN's \"5–1\" is this season's, so the record is computed: 15–2, no standing",
              "\(chiefs.record ?? "nil")")
        check(TeamSeasons.label(year: 2023, sport: .soccer, league: "eng.1") == "2023–24"
              && TeamSeasons.label(year: 2024, sport: .basketball, league: "nba") == "2023–24"
              && TeamSeasons.label(year: 2024, sport: .football, league: "nfl") == "2024",
              "season numbering: soccer 2023 is 2023–24, NBA 2024 is 2023–24, NFL 2024 is 2024")
        let october = DayKey(year: 2026, month: 10, day: 26)
        check(TeamSeasons.choices(for: arsenal, today: october).map(\.label) == ["2026–27", "2025–26", "2024–25"]
              && TeamSeasons.choices(for: arsenal, today: october).map(\.year) == [nil, 2025, 2024],
              "Season menu: 2026–27 (current), 2025–26, 2024–25")
        check((try? TeamSeasons.url(path: "soccer/eng.1", team: "359", season: 2023, seasonType: nil))?.absoluteString.hasSuffix("schedule?season=2023") == true
              && (try? TeamSeasons.url(path: "baseball/mlb", team: "19", season: nil, seasonType: 2))?.absoluteString.hasSuffix("schedule?seasontype=2") == true,
              "team URLs: soccer past seasons by season alone; a season type alone")
        let cs = CSHistory.url(teamIDs: [667], page: 1).absoluteString.removingPercentEncoding ?? ""
        check(cs.contains("filter[matches.team_ids][overlap]=667") && cs.contains("filter[matches.status][in]=finished,defwin")
              && cs.contains("sort=-start_date") && cs.contains("page[limit]=20") && cs.contains("page[offset]=20"),
              "CS2 history URL: finished and forfeits, newest first, 20 a page", cs)
    }

    // MARK: Worst cases (§11)

    private static func syntheticBoard(_ events: [[String: Any]]) -> Data {
        (try? JSONSerialization.data(withJSONObject: ["events": events])) ?? Data()
    }

    private static func syntheticGame(_ id: String, status: String, short: String, completed: Bool = true, period: Int = 2,
                                      home: (String, String, String), away: (String, String, String),
                                      winner: String? = nil, details: [[String: Any]] = [], notes: [String] = []) -> [String: Any] {
        func side(_ t: (String, String, String), _ homeAway: String) -> [String: Any] {
            ["homeAway": homeAway, "score": t.2, "winner": winner == t.0,
             "team": ["id": t.0, "shortDisplayName": t.1, "displayName": t.1, "abbreviation": String(t.1.prefix(3)).uppercased()]]
        }
        return ["id": id, "date": "2026-12-26T15:00Z",
                "competitions": [["competitors": [side(home, "home"), side(away, "away")], "details": details,
                                  "notes": notes.map { ["headline": $0] },
                                  "status": ["period": period, "type": ["name": status, "state": "post", "completed": completed,
                                                                         "shortDetail": short]]]]]
    }

    private static func goal(_ team: String, _ short: String, _ id: String, _ minute: String) -> [String: Any] {
        ["scoringPlay": true, "team": ["id": team], "clock": ["displayValue": minute],
         "athletesInvolved": [["shortName": short, "id": id, "team": ["id": team]]]]
    }

    static func resultsWorstCases() {
        let data = syntheticBoard([
            syntheticGame("1", status: "STATUS_FULL_TIME", short: "FT", home: ("10", "Wolves", "1"), away: ("20", "Leeds", "1"),
                          details: [goal("10", "N. Jackson", "a", "6'"), goal("20", "B. Jackson", "b", "52'")]),
            syntheticGame("2", status: "STATUS_FULL_TIME", short: "FT", home: ("10", "Wolves", "0"), away: ("20", "Leeds", "0")),
            syntheticGame("3", status: "STATUS_ABANDONED", short: "Abandoned", completed: false, home: ("10", "Wolves", "1"),
                          away: ("20", "Leeds", "0")),
            syntheticGame("4", status: "STATUS_FORFEIT", short: "Forfeit", home: ("10", "Wolves", "1"), away: ("20", "Leeds", "0"),
                          winner: "10"),
            syntheticGame("5", status: "STATUS_POSTPONED", short: "Postponed", completed: false, home: ("10", "Wolves", "0"),
                          away: ("20", "Leeds", "0"), notes: ["Snow"]),
            syntheticGame("6", status: "STATUS_FINAL_PEN", short: "FT-Pens", period: 5, home: ("10", "Wolves", "0"),
                          away: ("20", "Leeds", "0"), winner: "20", notes: ["Leeds advance 5-4 on penalties"]),
            syntheticGame("w", status: "STATUS_WALKOVER", short: "W/O", completed: false, home: ("10", "Wolves", "0"),
                          away: ("20", "Leeds", "0"), winner: "20"),
            syntheticGame("c", status: "STATUS_CANCELED", short: "Canceled", completed: false, home: ("10", "Wolves", "0"),
                          away: ("20", "Leeds", "0")),
        ])
        let soccer = board(data, path: "soccer/eng.1", league: "eng.1", sport: .soccer)
        check(game(soccer, "1")?.result?.details == "N. Jackson 6' · B. Jackson 52'", "two Jacksons in one game keep their initials",
              game(soccer, "1")?.result?.details ?? "nil")
        check(game(soccer, "1")?.top?.winner == false && game(soccer, "1")?.bottom?.winner == false
              && game(soccer, "1")?.result?.spoken?.contains("draw") == true, "1–1: nobody wins, \"draw\"")
        let nil0 = game(soccer, "2")?.result
        check(nil0 != nil && nil0?.details == nil && nil0?.context == nil, "0–0: no caption line at all")
        let abandoned = game(soccer, "3")
        check(abandoned?.status == .final && abandoned?.result?.kind == .abandoned && abandoned?.result?.label == "Abandoned"
              && abandoned?.top?.score == "1" && abandoned?.top?.winner == false
              && abandoned?.result?.context == "Abandoned · score at the time",
              "abandoned: a result with the score at the time, nobody wins")
        let forfeit = game(soccer, "4")
        check(forfeit?.result?.kind == .forfeit && forfeit?.result?.label == "Forfeit" && forfeit?.top?.score == nil
              && forfeit?.top?.winner == true && forfeit?.result?.context == "Awarded to Wolves",
              "forfeit: no score, awarded to Wolves")
        let postponed = game(soccer, "5")
        check(postponed?.status == .postponed && postponed?.result?.label == "Postponed" && postponed?.result?.context == "Snow"
              && postponed?.top?.score == nil, "postponed: label, reason, no score")
        let walkover = game(soccer, "w")
        check(walkover?.status == .final && walkover?.result?.kind == .forfeit && walkover?.result?.label == "Forfeit"
              && walkover?.top?.score == nil && walkover?.bottom?.winner == true && walkover?.result?.context == "Awarded to Leeds",
              "walkover: a forfeit, no score, \"Awarded to Leeds\"")
        let canceled = game(soccer, "c")
        check(canceled?.status == .canceled && canceled?.result?.label == "Canceled" && canceled?.top?.score == nil
              && canceled?.result?.spoken == "Wolves versus Leeds, canceled.", "canceled: label, no score, said as canceled")
        let shootout = game(soccer, "6")?.result
        check(shootout?.shootout == .init(top: 4, bottom: 5) && game(soccer, "6")?.bottom?.winner == true,
              "a 0–0 decided on penalties without shootoutScore: 4–5 from the note")

        let long = syntheticBoard([
            syntheticGame("7", status: "STATUS_FINAL", short: "Final/19", period: 19, home: ("1", "Mets", "4"), away: ("2", "Orioles", "3")),
            syntheticGame("8", status: "STATUS_FINAL", short: "Final/7OT", period: 11, home: ("3", "Illinois", "20"),
                          away: ("4", "Penn State", "18")),
            syntheticGame("9", status: "STATUS_FINAL", short: "Final/OT", period: 5, home: ("5", "Giants", "20"), away: ("6", "Eagles", "20")),
        ])
        let mlb = board(long, path: "baseball/mlb", league: "mlb", sport: .baseball)
        check(game(mlb, "7")?.result?.label == "Final/19" && game(mlb, "7")?.result?.spoken?.contains("19 innings") == true,
              "19 innings: \"Final/19\", spoken \"19 innings\"")
        let football = board(long, path: "football/nfl", league: "nfl", sport: .football)
        check(game(football, "8")?.result?.label == "Final/7OT" && game(football, "8")?.result?.spoken?.contains("7th overtime") == true,
              "seven overtimes: \"Final/7OT\"", game(football, "8")?.result?.spoken ?? "nil")
        let tie = game(football, "9")
        check(tie?.top?.winner == false && tie?.bottom?.winner == false && tie?.result?.spoken?.contains("tie") == true,
              "an NFL tie after overtime: nobody dims, \"tie\"")

        let defwin = ScheduleItem(id: "cs-1", sportRaw: Sport.esports.rawValue, league: "cs2", day: DayKey(year: 2026, month: 10, day: 29),
                                  start: .exact(monday), status: .final, statusDetail: "Forfeit",
                                  top: ScheduleTeam(id: "cs-1", name: "G2", abbreviation: "G2", logo: nil, score: "1", winner: true),
                                  bottom: ScheduleTeam(id: "cs-2", name: "Vexar", abbreviation: "VEX", logo: nil, score: "0"),
                                  ref: .counterStrike(slug: "g2-vs-vexar", tournament: nil))
        let awarded = ResultParse.counterStrike(defwin)
        check(awarded.top?.score == nil && awarded.bottom?.score == nil && awarded.result?.kind == .forfeit
              && awarded.result?.context == "Awarded to G2" && awarded.result?.spoken == "G2 versus Vexar, forfeit, awarded to G2.",
              "a CS2 forfeit (defwin) shows no score (bo3's 1–0 is fake): \"Awarded to G2\"")
        check(Rounds.summary([awarded], sport: .esports) == "1 result" && Rounds.summary([game(soccer, "5")!], sport: .soccer) == "Postponed"
              && Rounds.summary(Array(repeating: game(soccer, "5")!, count: 3), sport: .soccer) == "All 3 games postponed",
              "counts agree: \"1 result\", \"All 3 games postponed\"")
    }

    // MARK: Rounds

    private static func synthetic(_ id: String, _ day: DayKey, gamesPlayed: Int?, status: ScheduleStatus = .final, leg: Int? = nil) -> ScheduleItem {
        let start = day.start(in: DayKey.utc).addingTimeInterval(15 * 3600)
        return ScheduleItem(id: id, sportRaw: "soccer", league: "eng.1", day: day, start: .exact(start), status: status,
                            top: ScheduleTeam(id: "a\(id)", name: "A", abbreviation: "A", logo: nil, score: "1"),
                            bottom: ScheduleTeam(id: "b\(id)", name: "B", abbreviation: "B", logo: nil, score: "0"),
                            ref: .espn(path: "soccer/eng.1", id: id),
                            result: status == .final ? ResultDetail(label: "FT", leg: leg, gamesPlayed: gamesPlayed) : nil)
    }

    static func resultsRounds() {
        let epl = League.with(id: "eng.1")!
        let calendar = ScheduleProvider.ESPN.parseCalendar(scheduleFixture("espn_eng1_undated.json"))
        let items = board(resultFixture("espn_eng1_month_202608.json"), path: "soccer/eng.1", league: "eng.1", sport: .soccer)
            + board(resultFixture("espn_eng1_month_202610.json"), path: "soccer/eng.1", league: "eng.1", sport: .soccer)
        let today = DayKey(year: 2026, month: 10, day: 26)
        let layout = Rounds.layout(days: calendar.days, items: items, calendar: calendar, league: epl, today: today)
        let labels = layout.rounds.map(\.label)
        check(labels == ["Matchweek 1 · Aug 21–24", "Matchweek 2 · Aug 28–31", "Sep 4–6", "Sep 12–14", "Sep 18–20",
                         "Matchweek 6 · Oct 10–12", "Matchweek 7 · Oct 17–19", "Matchweek 8 · Oct 23–25"],
              "EPL rounds to Oct 26: matchweeks where loaded, September by its dates until it loads", labels.joined(separator: " | "))
        let mw8 = layout.rounds.last
        check(mw8?.kind == .matchweek && mw8?.section == "2026–27" && mw8?.played == 10 && mw8?.total == 10
              && layout.members[mw8?.id ?? ""]?.count == 10 && layout.rounds[2].kind == .dates && layout.rounds[2].played == nil,
              "Matchweek 8: 10 of 10 played, season 2026–27")
        check(Rounds.build(days: calendar.days, items: items, calendar: calendar, league: epl, today: today).map(\.id) == layout.rounds.map(\.id),
              "Rounds.build gives the layout's rounds")
        check(Rounds.summary(layout.members[mw8?.id ?? ""] ?? [], sport: .soccer) == "10 results · 19 goals",
              "the round says \"10 results · 19 goals\"", Rounds.summary(layout.members[mw8?.id ?? ""] ?? [], sport: .soccer) ?? "nil")

        // A holiday run holding two matchweeks splits; one rearranged game doesn't.
        let boxing = (26...30).map { DayKey(year: 2026, month: 12, day: $0) }
        let run = (0..<10).map { synthetic("h18-\($0)", boxing[$0 / 4], gamesPlayed: 18) }
            + (0..<10).map { synthetic("h19-\($0)", boxing[2 + $0 / 4], gamesPlayed: 19) }
        let split = Rounds.layout(days: boxing, items: run, calendar: nil, league: epl, today: DayKey(year: 2027, month: 1, day: 2))
        check(split.rounds.map(\.label) == ["Matchweek 18 · Dec 26–28", "Matchweek 19 · Dec 28–30"]
              && split.rounds.allSatisfy { split.members[$0.id]?.count == 10 },
              "Boxing Day run (20 games in 5 days) splits into Matchweeks 18 and 19", split.rounds.map(\.label).joined(separator: " | "))
        let january = (9...11).map { DayKey(year: 2027, month: 1, day: $0) }
        let rearranged = (0..<9).map { synthetic("j\($0)", january[$0 % 3], gamesPlayed: 21) } + [synthetic("j9", january[1], gamesPlayed: 20)]
        let one = Rounds.layout(days: january, items: rearranged, calendar: nil, league: epl, today: DayKey(year: 2027, month: 1, day: 12))
        check(one.rounds.map(\.title) == ["Matchweek 21"] && one.members[one.rounds[0].id]?.count == 10,
              "a rearranged game played in another week stays one matchweek (majority rule)")

        // Cups: the stage, the matchday, the legs.
        let ucl = League.with(id: "uefa.champions")!
        let uclCalendar = ScheduleProvider.ESPN.parseCalendar(resultFixture("espn_ucl_calendar.json"))
        let leaguePhase = board(resultFixture("espn_ucl_day_20261021.json"), path: "soccer/uefa.champions", league: "uefa.champions", sport: .soccer)
        let md3 = Rounds.layout(days: [], items: leaguePhase, calendar: uclCalendar, league: ucl, today: today)
        check(md3.rounds.map(\.title) == ["League Phase · Matchday 3"] && md3.rounds.first?.section == "League Phase"
              && md3.rounds.first?.kind == .stage, "UCL Oct 21: \"League Phase · Matchday 3\"", md3.rounds.map(\.title).joined())
        var march = ScheduleCalendar()
        march.weeks = [.init(label: "Rd of 16", detail: "", number: 3, seasonType: 2, start: at("2026-03-09T08:00:00Z"),
                             end: at("2026-04-06T06:59:00Z"))]
        let legs = board(resultFixture("espn_ucl_month_202603_two_legs.json"), path: "soccer/uefa.champions", league: "uefa.champions", sport: .soccer)
        let r16 = Rounds.layout(days: [], items: legs, calendar: march, league: ucl, today: today)
        check(r16.rounds.map(\.label) == ["Round of 16 · 1st legs · Mar 10–11", "Round of 16 · 2nd legs · Mar 17–18"],
              "UCL March: \"Round of 16 · 1st legs\" (Mar 10–11), \"2nd legs\" (Mar 17–18)", r16.rounds.map(\.label).joined(separator: " | "))

        // Football weeks.
        let nflCalendar = ScheduleProvider.ESPN.parseCalendar(scheduleFixture("espn_nfl_undated.json"))
        let nfl = League.with(id: "nfl")!
        let weeks = Rounds.build(days: [], items: [], calendar: nflCalendar, league: nfl, today: today, now: monday)
        check(weeks.last?.title == "Week 7" && weeks.last?.week == 7 && weeks.last?.seasonType == 2 && weeks.last?.detail == "Oct 21–27"
              && weeks.last?.section == "Regular Season" && weeks.first?.title == "Week 1",
              "NFL on Monday: Week 1 … Week 7 (preseason left out); Week 7 is Oct 21–27", weeks.last?.label ?? "nil")
        let wednesday = Rounds.build(days: [], items: [], calendar: nflCalendar, league: nfl, today: today, now: at("2026-10-28T12:00:00Z"))
        check(Rounds.latest(wednesday) { $0.week == 8 ? false : true }?.title == "Week 7",
              "Wednesday: Week 8 has begun without a final, so the default stays Week 7")

        // Daily leagues: the latest game day with a final.
        let mlbCalendar = ScheduleProvider.ESPN.parseCalendar(scheduleFixture("espn_mlb_undated.json"))
        let days = Rounds.gameDays(mlbCalendar, through: today)
        let mlbRounds = Rounds.build(days: days, items: [], calendar: mlbCalendar, league: League.with(id: "mlb")!, today: today)
        check(days.suffix(3) == [DayKey(year: 2026, month: 10, day: 23), DayKey(year: 2026, month: 10, day: 24), today],
              "MLB game days through Oct 26 skip the off day (Oct 25)", "\(days.suffix(3))")
        check(Rounds.latest(mlbRounds) { $0.first == today ? false : nil }?.first == DayKey(year: 2026, month: 10, day: 24)
              && mlbRounds.last?.title == today.longLabel,
              "MLB on Monday morning: nothing final today, so the default is Saturday, Oct 24")
    }

    // MARK: Store

    /// A results store over an in-memory cache whose network is a folder of
    /// fixtures (FixtureProtocol keys; `dates` is ignored, so one month file
    /// answers every month).
    static func resultsStore() async {
        let fixtures = FileManager.default.temporaryDirectory.appendingPathComponent("scoreline-results-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: fixtures, withIntermediateDirectories: true)
        let saved = FixtureProtocol.directory
        FixtureProtocol.directory = fixtures
        defer {
            FixtureProtocol.directory = saved
            try? FileManager.default.removeItem(at: fixtures)
        }
        func serve(_ url: URL, _ data: Data) { try? data.write(to: fixtures.appendingPathComponent(FixtureProtocol.key(for: url) + ".bin")) }
        typealias E = ScheduleProvider.ESPN
        let october = E.scoreboardURL(path: "soccer/eng.1", window: .month(year: 2026, month: 10))
        serve(E.scoreboardURL(path: "soccer/eng.1", window: .undated), scheduleFixture("espn_eng1_undated.json"))
        serve(october, resultFixture("espn_eng1_month_202610.json"))

        let store = ResultsStore(schedule: ScheduleStore(cache: ScheduleCache(directory: nil)))
        store.clock = { monday }
        let scope = ScheduleScope.league("eng.1")
        let context = ResultsStore.Context(leagues: [League.with(id: "eng.1")!])
        await store.open(scope, context: context)
        let state = store.state(scope)
        check(state?.round?.label == "Matchweek 8 · Oct 23–25" && state?.items.count == 10 && state?.loading == false
              && state?.summary == "10 results · 19 goals",
              "opens on the latest round: Matchweek 8 · Oct 23–25, 10 results", state?.round?.label ?? "nil")
        let tottenham = state?.items.first { $0.id == "espn-401878767" }
        check(tottenham?.bottom?.name == "Spurs" && tottenham?.bottom?.winner == true, "Chelsea 0–2 Spurs: Spurs won")

        let first = store.groups(scope, context: context)
        let builds = store.groupBuilds
        let second = store.groups(scope, context: context)
        check(first == second && store.groupBuilds == builds && first.map(\.day) == [DayKey(year: 2026, month: 10, day: 23),
                                                                                    DayKey(year: 2026, month: 10, day: 24),
                                                                                    DayKey(year: 2026, month: 10, day: 25)],
              "groups are memoized (two reads, one build), days Friday → Sunday")

        // The network now answers with nothing: a step served from the cache shows ten games.
        serve(october, Data("{\"events\":[]}".utf8))
        let revision = state?.revision ?? 0
        await store.show(scope, context: context, target: .step(-1), force: false)
        let previous = store.state(scope)
        check(previous?.round?.title == "Matchweek 7" && previous?.items.count == 10 && previous?.loading == false,
              "‹ to Matchweek 7 comes from the cache without a request", previous?.round?.label ?? "nil")
        check((previous?.revision ?? 0) == revision + 1, "a cached step publishes once (no skeleton in between)",
              "\(revision) → \(previous?.revision ?? -1)")
        await store.show(scope, context: context, target: .step(1), force: false)
        check(store.state(scope)?.round?.title == "Matchweek 8", "› back to Matchweek 8")

        // The hub's latest round, and Back keeping the round shown.
        await store.show(scope, context: context, target: .step(-1), force: false)
        await store.open(scope, context: context)
        check(store.state(scope)?.round?.title == "Matchweek 7", "coming back keeps the round shown")
        let hub = await store.latest(League.with(id: "eng.1")!, context: context)
        check(hub?.round.title == "Matchweek 8" && hub?.items.count == 10 && store.state(scope)?.round?.title == "Matchweek 7",
              "the hub's latest round doesn't move the page")

        // Filters equal the scores list's: college's Top 25.
        let cfb = board(resultFixture("espn_cfb_week8_ot.trimmed.json"), path: "football/college-football", league: "college-football",
                        sport: .football)
        let college = League.with(id: "college-football")!
        let top25 = ResultsStore.Context(leagues: [college], collegeTop25Only: true)
        let following = ResultsStore.Context(leagues: [college], collegeTop25Only: true,
                                             followed: [ScheduleTeamRef(id: "espn-ncaaf-2026", name: "App State", logo: nil)])
        check(top25.filter(cfb, league: college, showAll: false).count == 2 && top25.filter(cfb, league: college, showAll: true).count == 5
              && following.filter(cfb, league: college, showAll: false).count == 3,
              "college Top 25: 2 of 5 overtime games (BYU, Indiana), 3 with a followed team, all 5 with Show All Games")
        let picks = ResultsStore.Context(leagues: [League.with(id: "eng.1")!], picks: ["eng.1": ["espn-soccer-359"]])
        check(picks.filter(state?.items ?? [], league: League.with(id: "eng.1")!, showAll: false).map(\.id) == ["espn-401878768"],
              "picked teams only, as the scores list")

        // A team's season through the cache (the team schedule's own URL).
        serve(try! E.teamURL(path: "soccer/all", team: "359"), scheduleFixture("espn_team_all_359_results.json"))
        let arsenal = ScheduleTeamRef(id: "espn-soccer-359", name: "Arsenal", logo: nil, league: "eng.1")
        let season = await store.season(arsenal, year: nil)
        check(season?.played == 13 && season?.won == 11 && season?.scoredFor == 26 && season?.scoredAgainst == 9 && season?.season == "2026–27",
              "Arsenal's season card: 13 played, W 11 D 1 L 1, goals 26–9, 2026–27")
        let teamScope = ScheduleScope.team(arsenal)
        await store.open(teamScope, context: context)
        check(store.state(teamScope)?.items.count == 13 && store.state(teamScope)?.more == false && store.state(teamScope)?.season?.played == 13,
              "the team scope lists 13 results")
        store.includeFriendlies = [arsenal.id]
        check(store.state(teamScope)?.items.count == 17 && store.state(teamScope)?.more == false,
              "Include Friendlies: 17, without a request")
        store.includeFriendlies = []

        // Freshness: finals more than 48 hours old keep 30 days.
        let today = DayKey(year: 2026, month: 10, day: 26)
        check(ScheduleStore.ttl(for: DayKey(year: 2026, month: 10, day: 20), today: today) == 30 * 86_400
              && ScheduleStore.ttl(for: DayKey(year: 2026, month: 10, day: 25), today: today) == 30 * 60
              && ScheduleStore.finalTTL > 29 * 86_400,
              "a board of finals over 48 hours ago stays fresh 30 days (read without a request on day 29); yesterday's 30 minutes")
    }

    /// The scores list adopts the same rules (RH9): "Pens", and the winner by score.
    static func resultsScoresList() async {
        let fixtures = FileManager.default.temporaryDirectory.appendingPathComponent("scoreline-results-list-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: fixtures, withIntermediateDirectories: true)
        let saved = FixtureProtocol.directory
        FixtureProtocol.directory = fixtures
        defer {
            FixtureProtocol.directory = saved
            try? FileManager.default.removeItem(at: fixtures)
        }
        func serve(_ path: String, _ data: Data) {
            let url = URL(string: "https://site.api.espn.com/apis/site/v2/sports/\(path)/scoreboard")!
            try? data.write(to: fixtures.appendingPathComponent(FixtureProtocol.key(for: url) + ".bin"))
        }
        serve("soccer/uefa.champions", resultFixture("espn_ucl_month_202603_two_legs.json"))
        serve("soccer/fifa.world", resultFixture("espn_wc_month_202607_aet_pens.trimmed.json"))
        let ucl = (try? await Providers.events(for: League.with(id: "uefa.champions")!)) ?? []
        let spurs = ucl.first { $0.id == "espn-401862580" }
        check(spurs?.competitors.first?.isWinner == true && spurs?.competitors.last?.isWinner == false
              && spurs.map { $0.stepsBack($0.competitors[1]) } == true,
              "scores list: Spurs 3–2 Atlético, Atlético dims (it lost the match)")
        let wc = (try? await Providers.events(for: League.with(id: "fifa.world")!)) ?? []
        let egypt = wc.first { $0.id == "espn-760499" }
        check(egypt?.detail == "Pens" && egypt?.competitors.last?.isWinner == true, "scores list: \"Pens\", Egypt won the shootout",
              egypt?.detail ?? "nil")
    }
}
