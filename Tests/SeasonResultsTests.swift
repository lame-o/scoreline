import Foundation

// Results for climbing and CS2 (specs/results.md §10.2): IFSC full results,
// ties, speed's elimination final, the round a past result opens, bo3.gg
// placings, a tournament's rounds, forfeits and the bracket's Swiss stage.
// Responses recorded 26 Oct 2026 (Tests/Fixtures/results), decoded through
// the pure parsers; the store runs offline against the same files.

extension ScorelineTests {
    static func seasonResults() async {
        print("\nSeason results")
        seasonResultsEvent()
        seasonResultsCategories()
        await seasonResultsRound()
        seasonResultsFinished()
        seasonResultsMatches()
        seasonResultsBracket()
        await seasonResultsStore()
    }

    // MARK: Helpers

    private static func results(_ name: String) -> Data {
        (try? Data(contentsOf: URL(fileURLWithPath: "Tests/Fixtures/results/\(name)"))) ?? Data()
    }

    nonisolated private static func at(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso) ?? .distantPast
    }

    /// Serves `files` (URL → fixture) through `FixtureProtocol` while `body` runs.
    private static func serving(_ files: [URL: String], _ body: () async -> Void) async {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("scoreline-season-results-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let saved = FixtureProtocol.directory
        FixtureProtocol.directory = dir
        defer {
            FixtureProtocol.directory = saved
            try? FileManager.default.removeItem(at: dir)
        }
        for (url, name) in files {
            try? results(name).write(to: dir.appendingPathComponent(FixtureProtocol.key(for: url) + ".bin"))
        }
        await body()
    }

    // MARK: IFSC event detail (RH2, the IFSC half)

    static func seasonResultsEvent() {
        typealias I = ScheduleProvider.IFSC
        guard let santiago = SeasonResults.standaloneEvent(results("ifsc_event_1489_santiago2026.json"), now: at("2026-10-26T17:00:00Z"))
        else { return check(false, "Santiago's detail parses on its own") }
        check(santiago.id == "ifsc-1489" && santiago.shortName == "Santiago" && santiago.startDay == DayKey(year: 2026, month: 10, day: 23)
              && santiago.endDay == DayKey(year: 2026, month: 10, day: 25) && santiago.countryCode == "CL" && santiago.status == .finished,
              "a competition opened cold builds itself from its own detail: Santiago, Oct 23–25, Chile, finished",
              "\(santiago.shortName) \(santiago.startDay) \(String(describing: santiago.countryCode)) \(santiago.status)")
        let lead = santiago.categories.first { $0.name == "Lead Women" }
        check(lead?.dcatID == 5, "Lead Women is dcat 5 (its full results)", "\(String(describing: lead?.dcatID))")
        check(lead?.rounds.map(\.id) == [10451, 11360, 11362] && lead?.rounds.map(\.name) == ["Qualification", "Semi-final", "Final"]
              && lead?.rounds.last?.resultPath == "/api/v1/category_rounds/11362/results" && lead?.rounds.allSatisfy { $0.status == "finished" } == true,
              "its rounds: Qualification 10451, Semi-final 11360, Final 11362, each with the result URL the match page loads")
        let first = lead?.podiumAthletes.first
        check(first?.athleteID == 1147 && first?.rank == 1 && first?.first == "Janja" && first?.last == "Garnbret" && first?.country == "SLO"
              && lead?.podiumAthletes.count == 3,
              "podium with IDs: 1 Janja Garnbret (SLO, athlete 1147), three places", "\(String(describing: first))")
        check(santiago.categories.map(\.name) == ["Speed Men", "Speed Women", "Lead Men", "Lead Women"]
              && santiago.categories.allSatisfy { $0.podium.count == 3 },
              "the existing podium strings are unchanged (Upcoming still reads them)")
        check(SeasonResults.winners(santiago) == "🥇 🇨🇳 Zhao · 🇨🇳 Deng · 🇨🇭 Utelli · 🇸🇮 Garnbret"
              && SeasonResults.winners(santiago, limit: 2) == "🥇 🇨🇳 Zhao · 🇨🇳 Deng",
              "the row's winners line: every category's winner, or the first two", SeasonResults.winners(santiago) ?? "nil")
        // The same detail into a season's event keeps the season's fields (one URL, one parsed type).
        let base = SeasonEvent(id: "ifsc-1489", kind: .climbing(1489), name: "World Climbing Series Santiago 2026", shortName: "Santiago",
                               startDay: DayKey(year: 2026, month: 10, day: 23), endDay: DayKey(year: 2026, month: 10, day: 25),
                               lanes: ["speed", "lead"], status: .finished)
        let detailed = I.parseEvent(results("ifsc_event_1489_santiago2026.json"), into: base)
        check(detailed.categories == santiago.categories && detailed.detailed, "parseEvent fills the same categories into a season's event")
        // Disciplines you don't follow don't appear: their lanes, categories and rounds go, and so does a competition of only them.
        var mixed = detailed
        mixed.rounds = [ClimbingRound(name: "Final", discipline: "Lead", categories: ["Men"], status: "finished"),
                        ClimbingRound(name: "Final", discipline: "Speed", categories: ["Men"], status: "finished")]
        let followed = mixed.tracking(["lead", "boulder"])
        let keptNames = followed?.categories.map { $0.name } ?? []
        check(followed?.lanes == ["lead"] && !keptNames.isEmpty && keptNames.allSatisfy { !$0.lowercased().contains("speed") }
              && followed?.rounds.map { $0.discipline } == ["Lead"],
              "a competition keeps only the disciplines you follow", "\(followed?.lanes ?? []) \(keptNames)")
        check(base.tracking(["boulder"]) == nil, "a competition of only disciplines you don't follow doesn't appear")
        let cs = SeasonEvent(id: "cs-1", kind: .tournament(slug: "major"), name: "Major", shortName: "Major",
                             startDay: base.startDay, endDay: base.endDay, lanes: ["s"], status: .upcoming)
        check(cs.tracking([]) == cs, "a CS2 event isn't filtered by climbing disciplines")

        let menu = SeasonResults.resultSeasons(ScheduleStore.SeasonList(current: .init(id: 38, name: "2026"),
                                                                       all: [.init(id: 40, name: "2027"), .init(id: 38, name: "2026"),
                                                                             .init(id: 37, name: "2025"), .init(id: 42, name: "2032")]))
        check(menu.map(\.name) == ["2026", "2025"], "the results season menu: the current season and earlier, newest first",
              "\(menu.map(\.name))")
        check(SeasonResults.ttl(endedAt: at("2026-10-20T00:00:00Z"), now: at("2026-10-26T00:00:00Z")) == 30 * 86_400
              && SeasonResults.ttl(endedAt: at("2026-10-25T12:00:00Z"), now: at("2026-10-26T00:00:00Z")) == 30 * 60,
              "finals keep 30 days once two days old; half an hour before (corrections)")
    }

    // MARK: Full results

    static func seasonResultsCategories() {
        let lead = SeasonResults.parseCategory(results("ifsc_result_1489_5_lead_women.json"))
        check(lead.rows.count == 48 && lead.category == "Lead Women" && lead.discipline == "lead"
              && lead.rounds.map(\.short) == ["Qual.", "Semi", "Final"],
              "Lead Women: 48 athletes, three rounds", "\(lead.rows.count) \(lead.category)")
        let garnbret = lead.rows.first
        check(garnbret?.name == "Janja Garnbret" && garnbret?.rank == 1 && garnbret?.country == "SLO"
              && garnbret?.scores.map(\.rank) == [1, 1, 1] && garnbret?.score(in: 10451)?.score == "1.0" && garnbret?.last?.score == "TOP",
              "Garnbret: 1st in every round, qualification points 1.0, the final topped", "\(String(describing: garnbret))")
        check(garnbret?.spoken == "1st, Janja Garnbret, Slovenia, final: top", "VoiceOver: \"1st, Janja Garnbret, Slovenia, final: top\"",
              garnbret?.spoken ?? "")
        let fisher = lead.rows.first { $0.name == "Ella Fisher" }
        let oda = lead.rows.first { $0.name == "Natsumi Oda" }
        check(fisher?.rank == 8 && fisher?.stage == "Final" && fisher?.last?.score == "37+"
              && oda?.rank == 9 && oda?.stage == "Semi-final" && oda?.last?.score == "36+",
              "Fisher (8th) last climbed the final, 37+; Oda (9th) the semi-final, 36+")
        let stages = lead.rows.map(\.stage).reduce(into: [String]()) { if $0.last != $1 { $0.append($1) } }
        check(stages == ["Final", "Semi-final", "Qualification"], "the field drops round by round: Final, Semi-final, Qualification",
              "\(stages)")

        let boulder = SeasonResults.parseCategory(results("ifsc_result_1488_7_boulder_women_ties.json"))
        let tied = boulder.rows.filter { $0.rank == 55 }
        check(boulder.rows.count == 58 && tied.count == 4 && tied.allSatisfy(\.tied) && !boulder.rows[0].tied,
              "SLC Boulder Women: 58 athletes, four tied at 55th (and only they are tied)", "\(boulder.rows.count) \(tied.count)")
        check(tied.map(\.name) == ["Aimara Luz Baldasare Tello", "Florencia Gomez Claro", "Iris Heikkinen", "Tamara Fatima Ortiz Ruiz"]
              && tied.allSatisfy { $0.rankText == "55" },
              "a tie repeats the rank, sorted by surname inside it", "\(tied.map(\.name))")
        check(tied.first?.spoken.hasPrefix("55th, tied, Aimara Luz Baldasare Tello, Argentina, qualification: 0") == true,
              "VoiceOver says \"55th, tied\"", tied.first?.spoken ?? "")

        let speed = SeasonResults.parseCategory(results("ifsc_result_1489_2_speed_men.json"))
        let zurloni = speed.rows.first { $0.name.hasSuffix("Zurloni") }
        check(zurloni?.rank == 16 && zurloni?.last?.score == "5.43 (5.12)" && zurloni?.last?.placing == "Round of 16"
              && zurloni?.stage == "Round of 16",
              "Speed Men: Zurloni 16th, \"5.43 (5.12)\" kept as IFSC writes it, out in the round of 16",
              "\(String(describing: zurloni?.last))")
        let placings = speed.rows.prefix(9).map { $0.last?.placing ?? "-" }
        check(placings == ["1st", "2nd", "3rd", "4th", "Quarter-final", "Quarter-final", "Quarter-final", "Quarter-final", "Round of 16"],
              "the elimination final places 1st–4th, then how far each went", "\(placings)")
        let groups = speed.rows.map(\.stage).reduce(into: [String]()) { if $0.last != $1 { $0.append($1) } }
        check(groups == ["Final", "Quarter-final", "Round of 16", "Qualification"], "speed's ranking groups by heat, then qualification",
              "\(groups)")
        check(speed.rows.first { $0.rank == 52 }?.last?.score == "10.54", "a fall in qualification keeps its ranking time")

        let countries = Set(["USA", "JPN"])
        let best = SeasonResults.best(in: lead, countries: countries)
        check(best.map { "\($0.country) \($0.rank)" } == ["JPN 5", "USA 8"] && best.last?.text == "🇺🇸 Ella Fisher · 8th",
              "your countries' best off the podium: Japan 5th, USA 8th (\"🇺🇸 Ella Fisher · 8th\")", "\(best.map(\.text))")
        check(SeasonResults.best(in: lead, countries: ["SLO"]).isEmpty, "a country already on the podium adds no line")
    }

    // MARK: Opening a past round (§4.4)

    static func seasonResultsRound() async {
        guard let santiago = SeasonResults.standaloneEvent(results("ifsc_event_1489_santiago2026.json"), now: at("2026-10-26T17:00:00Z")),
              let lead = santiago.categories.first(where: { $0.name == "Lead Women" }), let final = lead.rounds.last
        else { return check(false, "Santiago's Lead Women final") }
        guard let event = SeasonResults.roundEvent(santiago, category: lead.name, round: final, winner: "🇸🇮 J. Garnbret")
        else { return check(false, "a finished round makes an event") }
        check(event.id == "ifsc-1489-r11362" && event.state == .final && event.detail == "Final" && event.caption == "Santiago 2026"
              && event.content == .field(title: "Lead Women", summary: "Final · Winner 🇸🇮 J. Garnbret"),
              "the round's event: final, \"Lead Women\", \"Final · Winner 🇸🇮 J. Garnbret\"", "\(event.content)")
        if case let .climbing(eventID, category, resultURL, round, eventName, nextURL)? = event.ref {
            check(eventID == 1489 && category == "Lead Women" && resultURL == "/api/v1/category_rounds/11362/results" && round == "Final"
                  && eventName == "Santiago" && nextURL == nil,
                  "it opens /api/v1/category_rounds/11362/results, the URL ClimbingDetail already loads")
        } else {
            check(false, "the round's ref is a climbing ref")
        }
        let url = URL(string: "https://ifsc.results.info/api/v1/category_rounds/11362/results")!
        await serving([url: "ifsc_round_11362_lead_women_final.json"]) {
            let detail = try? await DetailProvider.detail(for: event)
            check(detail?.roundName == "Final" && detail?.ranking.count == 8 && detail?.ranking.first?.name == "Janja Garnbret",
                  "the match page loads it with the existing parser: \"Final\", 8 ranked, Garnbret first",
                  "\(String(describing: detail?.roundName)) \(detail?.ranking.count ?? -1)")
        }
    }

    // MARK: bo3.gg: finished tournaments and placings

    static func seasonResultsFinished() {
        let s = SeasonResults.parseFinished(results("bo3_tournaments_finished_s_with_prizes.json"))
        check(s.items.count == 12 && s.total == 138, "12 S-tier tournaments with placings (138 in all)", "\(s.items.count) \(s.total)")
        guard let epl = s.items.first(where: { $0.slug == "esl-pro-league-season-24" }) else { return check(false, "ESL Pro League Season 24") }
        check(epl.bo3ID == 5110 && epl.event.status == .finished && epl.event.shortName == "ESL Pro League Season 24",
              "ESL Pro League Season 24: bo3 ID 5110, finished")
        let p = epl.placements
        check(p.count == 16 && p.first?.place == "1st" && p.first?.team.name == "Vitality" && p.first?.team.id == "cs-667"
              && p.first?.money == 125_000 && p.first?.clubMoney == 170_000 && p[1].place == "2nd" && p[1].team.name == "MOUZ",
              "placings sorted: 1st Vitality ($125K, club $170K), 2nd MOUZ", "\(p.prefix(2).map { "\($0.place) \($0.team.name)" })")
        check(p.filter { $0.place == "5th–8th" }.count == 4 && p.filter { $0.order == 5 }.count == 4 && p.last?.place == "15th–16th",
              "\"5-8th\" reads \"5th–8th\" (four teams), down to \"15th–16th\"")
        check(epl.summary == "🏆 Vitality · 2nd MOUZ · $1M", "the row's line: \"🏆 Vitality · 2nd MOUZ · $1M\"", epl.summary ?? "nil")
        let starladder = s.items.first { $0.slug.hasPrefix("starladder") }
        check(starladder?.placements.map(\.order) == [1, 2, 3, 4, 5, 5, 7, 7], "bo3.gg's shuffled list comes back in place order",
              "\(String(describing: starladder?.placements.map(\.order)))")
        let fissure = s.items.first { $0.slug.hasPrefix("fissure") }
        check(fissure?.placements.count == 15 && fissure?.placements.filter { $0.place == "3rd–4th" }.count == 1,
              "a placing with no team is left out (FISSURE's second 3rd–4th); the place stays on the next row")
        let stage1 = s.items.first { $0.event.name.hasSuffix("Stage 1") }
        check(stage1?.placements.first?.place == "1st–2nd" && stage1?.summary == "1st–2nd B8, BetBoom"
              && stage1?.placements.allSatisfy { ScheduleProvider.CS.prize($0.money) == nil } == true,
              "a Major stage: shared top places (\"1st–2nd B8, BetBoom\"), no prize money", stage1?.summary ?? "nil")

        let older = SeasonResults.parseFinished(results("bo3_tournaments_finished_s_page2.json"))
        check(older.items.count == 19 && older.total == 138 && !older.items.contains { $0.event.name.localizedCaseInsensitiveContains("qualifier") }
              && older.items.contains { $0.event.name == "StarLadder Budapest Major 2025 Stage 1" },
              "an older S-tier page: its closed qualifier left out (1 of 20), Major stages kept", "\(older.items.count)")
        check(older.items.first?.placements.isEmpty == true && older.items.first?.summary == "$1.22M",
              "without placings a tournament still says its prize", older.items.first?.summary ?? "nil")

        check(SeasonResults.displayName("Intel Extreme Masters Cologne Major 2026 Stage 2") == "IEM Cologne Major Stage 2"
              && SeasonResults.displayName("ESL Pro League Season 24") == "ESL Pro League Season 24"
              && SeasonResults.displayName("Esports World Cup 2026") == "Esports World Cup" && stage1?.title == "IEM Cologne Major Stage 1",
              "names drop a year the dates give, even mid-name (\"IEM Cologne Major Stage 2\")")
        let labels = ["5-8th", "1-2nd", "3-4th", "25-32nd", "1st", "17-24th"].compactMap { SeasonResults.placeLabel($0)?.0 }
        check(labels == ["5th–8th", "1st–2nd", "3rd–4th", "25th–32nd", "1st", "17th–24th"], "bo3.gg's places read as words",
              "\(labels)")
        let url = SeasonResults.finishedURL(page: 1).absoluteString.removingPercentEncoding ?? ""
        check(url.contains("filter[tournaments.status][in]=finished") && url.contains("sort=-end_date") && url.contains("page[limit]=6")
              && url.contains("page[offset]=6") && url.contains("with=tournament_prizes"),
              "finished tournaments: newest first, six with placings a page")
    }

    // MARK: bo3.gg: a tournament's matches, forfeits, team history

    static func seasonResultsMatches() {
        let now = at("2026-10-26T17:00:00Z")
        let matches = SeasonResults.parseTournamentMatches(results("bo3_matches_tournament_5110.json"), now: now)
        check(matches.items.count == 41 && matches.total == 41 && matches.stage.count == 41 && matches.round["cs-130754"] == 40473,
              "ESL Pro League: 41 matches, each with its stage and round", "\(matches.items.count)")
        let stages = ["bo3_stage_10851_swiss.json", "bo3_stage_10850_playoffs.json", "bo3_stage_10897_3rd_place.json"]
            .compactMap { SeasonResults.parseStage(results($0)) }
        check(stages.count == 3 && stages[0].format == "swiss" && stages[0].rounds.count == 5 && stages[2].rounds.first?.name == "3rd place",
              "stages: Swiss (5 rounds), playoffs, the 3rd-place decider")
        let groups = SeasonResults.groups(matches, stages: stages, tournament: "ESL Pro League Season 24")
        check(groups.prefix(4).map(\.title) == ["Grand final", "3rd place", "Semifinal", "Quarterfinal"]
              && groups.dropFirst(4).map(\.title) == (1...5).reversed().map { "Swiss · Round \($0)" },
              "rounds newest first: Grand final, 3rd place, semis, quarters, then Swiss Round 5 … 1", "\(groups.map(\.title))")
        check(groups.first?.items.count == 1 && groups.reduce(0) { $0 + $1.items.count } == 41
              && groups.allSatisfy { g in zip(g.items, g.items.dropFirst()).allSatisfy { $0.sortDate <= $1.sortDate } },
              "every match in one round, start order inside")
        let trimmed = SeasonResults.parseStage(Data(#"{"id": 1, "title": "X Group Stage", "format_type": "group", "rounds": [{"name": "Round 1", "round_index": 1, "matches": [{"round_id": 77}]}]}"#.utf8))
        check(trimmed?.rounds.first?.id == 77 && SeasonResults.stageName(trimmed!, tournament: "X") == "Group Stage",
              "a round without its own ID takes it from its matches; a group stage keeps its name")
        let page = SeasonResults.parseFinished(results("bo3_tournaments_finished_s_with_prizes.json"))
        if let epl = page.items.first(where: { $0.bo3ID == 5110 }) {
            check(SeasonResults.finalLine(epl, groups: groups) == "beat MOUZ 3–0 in the grand final",
                  "the champion's card: \"beat MOUZ 3–0 in the grand final\"", SeasonResults.finalLine(epl, groups: groups) ?? "nil")
        }
        let paged = SeasonResults.tournamentMatchesURL(5110, offset: 100).absoluteString.removingPercentEncoding ?? ""
        check(paged.contains("filter[matches.tournament_id][eq]=5110") && paged.contains("page[limit]=100") && paged.contains("page[offset]=100"),
              "a tournament's matches page at bo3.gg's cap of 100")

        let forfeits = ScheduleProvider.CS.parseMatches(results("bo3_matches_defwin.json"), now: now).map(ResultParse.counterStrike)
        let vexar = forfeits.first
        check(forfeits.count == 3 && vexar?.status == .final && vexar?.statusDetail == "Forfeit" && vexar?.result?.kind == .forfeit
              && vexar?.result?.label == "Forfeit" && vexar?.top?.score == nil && vexar?.bottom?.score == nil
              && vexar?.result?.context == "Awarded to Vexar",
              "a forfeit hides bo3.gg's fake 1–0: \"Forfeit\", awarded to Vexar", "\(String(describing: vexar?.result))")
        if let vexar {
            let event = vexar.event()
            check(event.competitors.allSatisfy { $0.score == nil } && event.stepsBack(event.competitors[1]),
                  "the match page and row get no score; the side it wasn't awarded to steps back")
        }

        let history = ScheduleProvider.CS.parseMatches(results("bo3_matches_team_667_finished.json"), now: now)
        let fut = history.first
        check(history.count == 20 && history.allSatisfy { $0.status == .final } && zip(history, history.dropFirst()).allSatisfy { $0.sortDate >= $1.sortDate },
              "Vitality's history: 20 finals, newest first")
        if let fut {
            let event = fut.event()
            check(fut.top?.name == "Vitality" && fut.top?.score == "1" && fut.bottom?.name == "FUT" && fut.bottom?.winner == true
                  && event.stepsBack(event.competitors[0]) && !event.stepsBack(event.competitors[1]),
                  "Vitality 1–2 FUT: Vitality steps back")
        }
        check(matches.items.allSatisfy { $0.result?.label == "Final" } && matches.items.first { $0.id == "cs-130754" }?.result?.kind == .regulation,
              "a tournament's matches carry R1's result (\"Final\"), so its rows read as results")
    }

    // MARK: Bracket (RH16)

    static func seasonResultsBracket() {
        let list = JSON(data: results("bo3_matches_tournament_5110.json"))["results"].array
        let stages: [Int: JSON] = [10851: JSON(data: results("bo3_stage_10851_swiss.json")),
                                   10850: JSON(data: results("bo3_stage_10850_playoffs.json")),
                                   10897: JSON(data: results("bo3_stage_10897_3rd_place.json"))]
        let built = CSTournament.build(name: "ESL Pro League Season 24", stageInfo: [(10850, "playoff"), (10851, "swiss"), (10897, "playoff")],
                                       stages: stages, matches: list)
        check(built.swiss?.rows.count == 16 && built.swiss?.rounds == 5 && built.swiss?.winsToAdvance == 3,
              "a stage typed \"swiss\" is the Swiss table: 16 teams, 5 rounds, 3 wins to go through",
              "\(built.swiss?.rows.count ?? -1) \(built.swiss?.rounds ?? -1)")
        let vitality = built.swiss?.rows.first { $0.team.name == "Vitality" }
        check(vitality?.wins == 3 && vitality?.losses == 0, "Vitality went through 3–0", "\(vitality?.wins ?? -1)–\(vitality?.losses ?? -1)")
        check(built.bracket?.rounds == ["Quarterfinal", "Semifinal", "Grand final"] && built.bracket?.extra.first?.title == "3rd place",
              "the playoffs stay the tree, the 3rd-place match under it", "\(String(describing: built.bracket?.rounds))")
        check(CSTournament.isSwiss("group") && CSTournament.isSwiss("swiss") && !CSTournament.isSwiss("playoff"),
              "\"group\" stages (IEM) still count as Swiss")
        let page = (try? CSTournament.matchesURL(tournament: 5110, offset: 100))?.absoluteString.removingPercentEncoding ?? ""
        check(page.contains("page[limit]=100") && page.contains("page[offset]=100") && !page.contains("limit]=200"),
              "the bracket pages its matches at 100 (asking 200 silently truncated)")
    }

    // MARK: Store (offline, through the cache)

    static func seasonResultsStore() async {
        typealias S = SeasonResults
        let cacheDir = FileManager.default.temporaryDirectory.appendingPathComponent("scoreline-results-cache-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: cacheDir) }
        let files: [URL: String] = [
            S.slugURL("esl-pro-league-season-24"): "bo3_tournaments_slug_esl-pro-league-season-24.json",
            S.tournamentMatchesURL(5110): "bo3_matches_tournament_5110.json",
            S.stageURL(10850): "bo3_stage_10850_playoffs.json",
            S.stageURL(10851): "bo3_stage_10851_swiss.json",
            S.stageURL(10897): "bo3_stage_10897_3rd_place.json",
            ScheduleProvider.IFSC.eventURL(1489): "ifsc_event_1489_santiago2026.json",
            S.categoryURL(event: 1489, dcat: 5): "ifsc_result_1489_5_lead_women.json",
            S.finishedURL(page: 0): "bo3_tournaments_finished_s_with_prizes.json",
        ]
        await serving(files) {
            let store = SeasonResultsStore(cache: ScheduleCache(directory: cacheDir))
            await store.loadTournament(slug: "esl-pro-league-season-24")
            let page = store.tournament("esl-pro-league-season-24")
            check(page.tournament?.bo3ID == 5110 && page.tournament?.placements.count == 16 && page.matches == 41
                  && page.groups.first?.title == "Grand final" && page.final == "beat MOUZ 3–0 in the grand final" && !page.failed,
                  "a tournament page opened cold: found by slug, 16 placings, 41 matches by round",
                  "\(page.matches) \(page.groups.first?.title ?? "-") \(page.final ?? "-")")

            await store.loadCategory(eventID: 1489, dcatID: 5)
            let category = store.category(1489, 5)
            check(category.results?.rows.count == 48 && category.event?.shortName == "Santiago" && category.event?.detailed == true
                  && !category.failed,
                  "a category page opened cold: the competition from its own detail, 48 athletes")

            await store.loadTournaments()
            check(store.tournaments.items.count == 12 && store.tournaments.more && store.tournaments.pages == 1,
                  "finished tournaments: the first page, more to come", "\(store.tournaments.items.count)")
            // A later read is served from the cache (the network now has nothing).
            FixtureProtocol.directory = FileManager.default.temporaryDirectory.appendingPathComponent("scoreline-empty-\(UUID().uuidString)")
            await store.loadTournament(slug: "esl-pro-league-season-24")
            check(store.tournament("esl-pro-league-season-24").groups.count == 9, "settled matches come back from the cache, no request")
        }
    }
}
