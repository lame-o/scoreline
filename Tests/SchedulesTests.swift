import Foundation

// Schedules: ESPN, IFSC, YouTube and bo3.gg responses recorded on 25 Oct 2026
// (Tests/Fixtures/schedules), decoded directly through the pure parsers.
// FixtureProtocol ignores the `dates` query item, so day and month boards
// can't be replayed through it. Also the two provider fixes: the climbing
// off-season row and CS2 canceled/postponed matches.

extension ScorelineTests {
    static func schedules() async {
        print("\nSchedules")
        scheduleDays()
        scheduleESPN()
        scheduleCalendars()
        scheduleAgenda()
        scheduleIFSC()
        scheduleStreams()
        scheduleCS()
        scheduleProviderFixes()
        scheduleNavigation()
        scheduleFolding()
        await scheduleCache()
    }

    // MARK: Helpers

    private static func sched(_ name: String) -> Data {
        (try? Data(contentsOf: URL(fileURLWithPath: "Tests/Fixtures/schedules/\(name)"))) ?? Data()
    }

    nonisolated private static func instant(_ iso: String) -> Date {
        let f = ISO8601DateFormatter()
        return f.date(from: iso) ?? .distantPast
    }

    /// Sunday 25 Oct 2026, 7 PM in California: when the fixtures were recorded.
    nonisolated private static let recorded = instant("2026-10-26T02:00:00Z")
    nonisolated private static let pacific = TimeZone(identifier: "America/Los_Angeles")!
    nonisolated private static let tokyo = TimeZone(identifier: "Asia/Tokyo")!

    private static func espn(_ name: String, path: String, league: String, sport: Sport,
                             now: Date = recorded, zone: TimeZone = pacific) -> [ScheduleItem] {
        ScheduleProvider.ESPN.parseScoreboard(sched(name), path: path, league: league, sport: sport, now: now, zone: zone)
    }

    private static func team(_ name: String, path: String, league: String, sport: Sport,
                             now: Date = recorded, zone: TimeZone = pacific) -> ScheduleProvider.ESPN.TeamSchedule {
        ScheduleProvider.ESPN.parseTeamSchedule(sched(name), path: path, league: league, sport: sport, now: now, zone: zone)
    }

    // MARK: Days

    static func scheduleDays() {
        let day = DayKey(year: 2026, month: 10, day: 25)
        check(day.compact == "20261025" && day.description == "2026-10-25", "day keys print as ESPN and ISO dates")
        check(day.adding(days: 7) == DayKey(year: 2026, month: 11, day: 1) && day.adding(days: -25) == DayKey(year: 2026, month: 9, day: 30),
              "day arithmetic crosses months")
        check(day.weekday == 1 && day.weekStart == day && DayKey(year: 2026, month: 10, day: 31).weekStart == day,
              "weeks run Sunday to Saturday")
        check(DayKey(iso: "2026-08-21T07:00Z") == DayKey(year: 2026, month: 8, day: 21), "a calendar stamp keeps only its date")
        // 05:00Z is midnight in New York, the evening before in California.
        let placeholder = instant("2027-01-03T05:00:00Z")
        check(DayKey.of(placeholder, in: DayKey.eastern) == DayKey(year: 2027, month: 1, day: 3)
              && DayKey.of(placeholder, in: pacific) == DayKey(year: 2027, month: 1, day: 2),
              "an Eastern-midnight placeholder is the previous day in Pacific time (why TBA games use Eastern days)")
        check(DayKey.range(DayKey(year: 2027, month: 4, day: 9), DayKey(year: 2027, month: 4, day: 11)) == "Apr 9–11"
              && DayKey.range(DayKey(year: 2027, month: 4, day: 30), DayKey(year: 2027, month: 5, day: 2)) == "Apr 30–May 2",
              "date ranges read like Calendar's", DayKey.range(DayKey(year: 2027, month: 4, day: 9), DayKey(year: 2027, month: 4, day: 11)))
    }

    // MARK: ESPN

    static func scheduleESPN() {
        typealias E = ScheduleProvider.ESPN
        let urls = [E.scoreboardURL(path: "basketball/nba", window: .day(DayKey(year: 2026, month: 11, day: 1))),
                    E.scoreboardURL(path: "soccer/eng.1", window: .month(year: 2026, month: 11)),
                    E.scoreboardURL(path: "football/nfl", window: .week(9, seasonType: 2)),
                    E.scoreboardURL(path: "football/college-football", window: .week(10, seasonType: 2))]
        check(urls[0].absoluteString.hasSuffix("scoreboard?dates=20261101")
              && urls[1].absoluteString.hasSuffix("scoreboard?dates=202611&limit=500")
              && urls[2].absoluteString.hasSuffix("scoreboard?week=9&seasontype=2")
              && urls[3].absoluteString.hasSuffix("week=10&seasontype=2&groups=80"),
              "scoreboard URLs: a day, a month (limit 500), an NFL week, an FBS week", urls.map(\.absoluteString).joined(separator: " "))
        let months = E.months(from: DayKey(year: 2026, month: 12, day: 28), to: DayKey(year: 2027, month: 1, day: 3))
        let monthURLs = months.map { E.scoreboardURL(path: "soccer/eng.1", window: $0).absoluteString }
        check(months.count == 2 && monthURLs.allSatisfy { !($0.split(separator: "?").last ?? "").contains("-") },
              "a window across New Year is two months, never a date range (ESPN answers ranges with a 400)")

        // Premier League, November.
        let epl = espn("espn_eng1_month_202611.json", path: "soccer/eng.1", league: "eng.1", sport: .soccer)
        let first = Agenda.sorted(epl).first
        check(epl.count == 32, "EPL November: 32 fixtures", "\(epl.count)")
        check(first?.top?.name == "Liverpool" && first?.bottom?.name == "Arsenal" && first?.start == .exact(instant("2026-11-01T16:30:00Z")),
              "first fixture Liverpool (home, on top) v Arsenal, Nov 1 16:30 UTC", "\(String(describing: first))")
        check(epl.allSatisfy { if case .exact = $0.start { true } else { false } }, "fixtures within six weeks keep exact times")
        check(epl.allSatisfy(\.networks.isEmpty), "no US TV listed this far ahead (none shown, never 'TBA')")

        // NFL week 9: byes, Madrid, Prime Video.
        let nfl = espn("espn_nfl_week9.json", path: "football/nfl", league: "nfl", sport: .football)
        let madrid = nfl.first { $0.notes.contains("NFL Madrid Game") }
        check(nfl.count == 15 && E.parseByes(sched("espn_nfl_week9.json")) == ["Titans", "Steelers"], "NFL week 9: 15 games, byes Titans and Steelers")
        check(madrid?.day == DayKey(year: 2026, month: 11, day: 8) && madrid?.venue == "Santiago Bernabéu · Madrid"
              && madrid?.top?.abbreviation == "CIN" && madrid?.networks == ["NFL Network"],
              "the Madrid game: Nov 8 in California, at the Bernabéu, the away Bengals on top, NFL Network",
              "\(String(describing: madrid))")
        check(nfl.first { $0.top?.abbreviation == "JAX" }?.networks == ["Prime Video"], "Thursday night: Prime Video")

        // Chiefs' season: flex weeks TBA on the Eastern date, summary, venue.
        let kc = team("espn_team_nfl_12_schedule.json", path: "football/nfl", league: "nfl", sport: .football)
        let week17 = kc.items.first { $0.week == 17 }
        let week17Tokyo = team("espn_team_nfl_12_schedule.json", path: "football/nfl", league: "nfl", sport: .football, zone: tokyo)
            .items.first { $0.week == 17 }
        let week8 = kc.items.first { $0.week == 8 }
        check(kc.items.count == 17 && kc.byeWeek == 5 && kc.summary == "5–0 · 1st in AFC West",
              "Chiefs: 17 games, bye in week 5, \"5–0 · 1st in AFC West\"", "\(kc.items.count) \(String(describing: kc.summary))")
        check(week17?.start == .tba && week17?.notes == ["Flex game: Sat, Jan 2 or Sun, Jan 3"],
              "week 17 is a flex game without a time", "\(String(describing: week17?.notes))")
        check(week17?.day == DayKey(year: 2027, month: 1, day: 3) && week17Tokyo?.day == DayKey(year: 2027, month: 1, day: 3),
              "a TBA game stays on its Eastern date in California and in Tokyo")
        check(week8?.start == .exact(instant("2026-11-01T21:25:00Z")) && week8?.networks == ["CBS"]
              && week8?.venue == "Empower Field at Mile High · Denver" && week8?.top?.abbreviation == "KC",
              "week 8 at Denver: 1:25 PM PST, CBS, venue and city", "\(String(describing: week8))")

        // College: TBA is the norm beyond next week; Top 25 games.
        let cfb = espn("espn_cfb_week10.json", path: "football/college-football", league: "college-football", sport: .football)
        let ranked = cfb.filter { $0.teams.contains { $0.rank != nil } }
        check(cfb.count == 63 && cfb.filter { $0.start == .tba }.count == 40, "college week 10: 63 FBS games, 40 without a time")
        check(ranked.count == 18 && ranked.filter { $0.start == .tba }.count == 14, "18 Top 25 games, 14 of them TBA")
        let michigan = team("espn_team_cfb_130_schedule.json", path: "football/college-football", league: "college-football", sport: .football)
        let tbaDays = michigan.items.filter { $0.start == .tba }.map(\.day)
        check(michigan.items.count == 12 && tbaDays == [DayKey(year: 2026, month: 11, day: 7), DayKey(year: 2026, month: 11, day: 14),
                                                        DayKey(year: 2026, month: 11, day: 21)],
              "Michigan: 12 games, TBA on Nov 7, 14 and 21", "\(tbaDays)")
        check(michigan.items.last?.start == .exact(instant("2026-11-28T17:00:00Z")) && michigan.items.last?.top?.abbreviation == "MICH",
              "at Ohio State, Nov 28 noon Eastern")

        // MLB October: the World Series, "if necessary", a rainout and its makeup.
        let mlb = espn("espn_mlb_month_202610.json", path: "baseball/mlb", league: "mlb", sport: .baseball)
        let game3 = mlb.first { $0.id == "espn-401908044" }
        let game5 = mlb.first { $0.id == "espn-401908046" }
        let rainout = mlb.first { $0.id == "espn-401908026" }
        let makeup = mlb.first { $0.id == "espn-401908027" }
        check(game3?.notes == ["World Series · Game 3 · MIL leads 2–0"] && game3?.networks == ["FOX"],
              "World Series game 3: series standing, FOX", "\(String(describing: game3?.notes)) \(String(describing: game3?.networks))")
        check(game5?.ifNecessary == true && game5?.notes.first?.hasPrefix("World Series · Game 5 · If necessary") == true,
              "games 5–7 are marked if necessary", "\(String(describing: game5?.notes))")
        check(rainout?.status == .postponed && rainout?.notes == ["ALCS · Game 4 · Rain, makeup Oct 18"] && makeup?.status == .final,
              "the rained-out ALCS game 4 says when it's made up; the makeup is its own final", "\(String(describing: rainout?.notes))")
        let dodgers = team("espn_team_mlb_19_season2027.json", path: "baseball/mlb", league: "mlb", sport: .baseball)
        let opener = Agenda.sorted(dodgers.items).first
        check(dodgers.items.count == 162 && dodgers.items.allSatisfy { $0.start == .tba }, "Dodgers 2027: 162 games, none timed yet")
        check(opener?.day == DayKey(year: 2027, month: 3, day: 25) && opener?.top?.abbreviation == "ATL",
              "Opening Day 2027: Mar 25 against Atlanta", "\(String(describing: opener?.day))")

        // NBA: the Lakers' 80 listed games, NBA Cup nights.
        let lakers = team("espn_team_nba_13_schedule.json", path: "basketball/nba", league: "nba", sport: .basketball)
        check(lakers.items.count == 80 && lakers.items.filter { $0.notes.contains("NBA Cup · Group Play") }.count == 4,
              "Lakers: 80 games listed (2 depend on the NBA Cup), 4 Cup group games")

        // Arsenal across competitions; EPL provisional beyond six weeks.
        let arsenal = team("espn_team_all_359_schedule.json", path: "soccer/all", league: "soccer", sport: .soccer)
        let byLeague = Dictionary(grouping: arsenal.items, by: \.league).mapValues(\.count)
        let cup = Agenda.sorted(arsenal.items).first
        check(arsenal.items.count == 36 && byLeague == ["eng.1": 30, "uefa.champions": 5, "eng.league_cup": 1],
              "Arsenal: 30 Premier League, 5 Champions League, 1 Carabao Cup fixtures", "\(byLeague)")
        check(cup?.competition == "Carabao Cup · Fourth Round" && cup?.networks == ["Paramount+"] && cup?.id.hasPrefix("espn-") == true,
              "the Carabao Cup tie names its round and network", "\(String(describing: cup?.competition))")
        let epl6 = arsenal.items.first { $0.league == "eng.1" && $0.day == DayKey(year: 2026, month: 12, day: 6) }
        let epl13 = arsenal.items.first { $0.league == "eng.1" && $0.day == DayKey(year: 2026, month: 12, day: 13) }
        let ucl = arsenal.items.filter { $0.league == "uefa.champions" }
        check(epl6.map { if case .exact = $0.start { true } else { false } } == true
              && epl13.map { if case .provisional(_, .tvPicks) = $0.start { true } else { false } } == true
              && ucl.allSatisfy { if case .exact = $0.start { true } else { false } },
              "EPL kickoffs more than 42 days out are provisional; the Champions League's never are")
        let results = team("espn_team_all_359_results.json", path: "soccer/all", league: "soccer", sport: .soccer)
        check(results.items.count == 17 && results.items.allSatisfy { $0.status == .final } && results.items.first?.top?.score != nil,
              "Arsenal's results across competitions, with scores")

        // European soccer without a time: the day may move too.
        let laliga = espn("espn_esp.1_month_202612.json", path: "soccer/esp.1", league: "esp.1", sport: .soccer)
        check(laliga.count == 30 && laliga.allSatisfy { $0.start == .tbc }, "LaLiga December: 30 fixtures, all TBC")
        let year = "espn_eng1_year_2027_limit500.trimmed.json"
        let farOff = espn(year, path: "soccer/eng.1", league: "eng.1", sport: .soccer)
        let nearer = espn(year, path: "soccer/eng.1", league: "eng.1", sport: .soccer, now: instant("2026-12-01T12:00:00Z"))
        check(farOff.count == 12 && farOff.allSatisfy { if case .provisional = $0.start { true } else { false } }
              && nearer.allSatisfy { if case .exact = $0.start { true } else { false } },
              "January EPL fixtures: provisional in October, exact by December")

        // The Event a row opens.
        if let item = week8 {
            let event = item.event()
            check(event.id == "espn-401873033" && event.state == .scheduled && event.broadcast == "CBS"
                  && event.competitors.first?.id == "espn-football-12",
                  "a schedule item opens as the scores list's Event (same ID, team IDs, broadcast)", "\(event.id)")
        }
    }

    static func scheduleCalendars() {
        typealias E = ScheduleProvider.ESPN
        let epl = E.parseCalendar(sched("espn_eng1_undated.json"))
        check(epl.days.count == 77 && epl.days.first == DayKey(year: 2026, month: 8, day: 21) && epl.weeks.isEmpty,
              "EPL calendar: 77 match days from Aug 21", "\(epl.days.count)")
        check(epl.nextDay(onOrAfter: DayKey(year: 2026, month: 10, day: 27)) == DayKey(year: 2026, month: 10, day: 31),
              "the next match day after a quiet midweek")
        let nfl = E.parseCalendar(sched("espn_nfl_undated.json"))
        let regular = nfl.weeks.filter { $0.seasonType == 2 }
        let week8 = regular.first { $0.number == 8 }
        check(regular.count == 18 && week8?.detail == "Oct 28-Nov 3" && nfl.weeks.contains { $0.label == "Super Bowl" },
              "NFL calendar: 18 regular weeks, week 8 Oct 28–Nov 3, the postseason", "\(regular.count)")
        check(nfl.week(at: recorded)?.number == 7 && week8.flatMap(nfl.week(after:))?.number == 9,
              "the current week is week 7; after week 8 comes week 9")
        let cfb = E.parseCalendar(sched("espn_cfb_undated.trimmed.json"))
        check(cfb.weeks.first { $0.number == 9 && $0.seasonType == 2 }?.detail == "Oct 26-Nov 1"
              && cfb.weeks.contains { $0.label == "Bowls" } && cfb.weeks.contains { $0.label == "CFP" },
              "college calendar: week 9 Oct 26–Nov 1, then Bowls and the CFP")
    }

    // MARK: Agenda

    static func scheduleAgenda() {
        let kc = team("espn_team_nfl_12_schedule.json", path: "football/nfl", league: "nfl", sport: .football)
        let cup = team("espn_team_all_359_schedule.json", path: "soccer/all", league: "soccer", sport: .soccer)
        let days = Agenda.build(kc.items + cup.items, leagueOrder: ["eng.1", "nfl"], grouped: true)
        let nov1 = days.first { $0.day == DayKey(year: 2026, month: 11, day: 1) }
        check(nov1?.groups.map(\.league) == ["eng.1", "nfl"], "a day's leagues follow the user's order",
              "\(String(describing: nov1?.groups.map(\.league)))")
        check(days.first { $0.day == DayKey(year: 2026, month: 10, day: 27) }?.groups.first?.league == "eng.1",
              "a cup tie sits with its sport's league in the All scope")
        let jan3 = days.first { $0.day == DayKey(year: 2027, month: 1, day: 3) }?.items ?? []
        check(jan3.last?.start == .tba, "games without a time come after the day's timed games")
        let split = Agenda.split(days, today: DayKey(year: 2026, month: 10, day: 25))
        check(split.earlier.allSatisfy { $0.day < DayKey(year: 2026, month: 10, day: 25) } && split.upcoming.first?.day == DayKey(year: 2026, month: 10, day: 25),
              "Earlier holds the days before today")
        let results = team("espn_team_all_359_results.json", path: "soccer/all", league: "soccer", sport: .soccer)
        let form = Agenda.form(results.items, teamID: "espn-soccer-359")
        check(form.count == 5 && form.allSatisfy { ["W", "D", "L"].contains($0) }, "form over the last five results", "\(form)")

        // CS2 in the All scope: followed teams' matches stay rows, the rest fold by tournament day.
        let store = ScheduleStore(cache: ScheduleCache(directory: nil))
        let matches = ScheduleProvider.CS.parseMatches(sched("bo3_tournament_5113_matches.json"), now: recorded)
        let folded = store.collapseTournamentDays(matches, followed: ["cs-793"])
        let day = folded.first { $0.children != nil }
        check(folded.count == 2 && folded.contains { $0.children == nil && $0.teams.contains { $0.id == "cs-793" } }
              && day?.children?.count == 7 && day?.subtitle?.hasPrefix("7 matches") == true,
              "IEM Beijing day one: G2's match stays a row, the other seven fold into one", "\(folded.map(\.id))")
    }

    // MARK: IFSC

    static func scheduleIFSC() {
        typealias I = ScheduleProvider.IFSC
        let seasons = I.seasons(root: sched("ifsc_root.json"))
        check(seasons.current == .init(id: 38, name: "2026") && I.currentAndNext(seasons).map(\.id) == [38, 40],
              "seasons by ID: 2026 is 38 (current), 2027 is 40")
        let y2027 = I.parseSeason(sched("ifsc_season_40_2027.json"), now: recorded)
        let tokyo = y2027.first
        check(y2027.count == 14 && tokyo?.shortName == "Tokyo" && tokyo?.startDay == DayKey(year: 2027, month: 4, day: 9)
              && tokyo?.endDay == DayKey(year: 2027, month: 4, day: 11) && tokyo?.timeZone == "Asia/Tokyo" && tokyo?.lanes == ["boulder"]
              && tokyo?.countryCode == "JP",
              "2027: 14 competitions, opening in Tokyo, Apr 9–11, boulder", "\(y2027.count) \(String(describing: tokyo))")
        let brno = y2027.first { $0.shortName == "Brno" }
        check(brno?.badge == "World Championships" && brno?.lanes == ["lead", "speed", "boulder"] && brno?.dayCount == 9,
              "Brno: the World Championships, all three disciplines, nine days")
        check(y2027.last?.shortName == "Paris" && y2027.last?.endDay == DayKey(year: 2027, month: 9, day: 26), "the season ends in Paris on Sep 26")
        let y2026 = I.parseSeason(sched("ifsc_season_38_2026.json"), now: recorded)
        let santiago = y2026.first { $0.shortName == "Santiago" }
        check(santiago?.status == .live && I.status(startsAt: santiago?.startsAt, endsAt: santiago?.endsAt,
                                                     now: instant("2026-10-27T12:00:00Z")) == .finished,
              "Santiago is underway on the evening of Oct 25 (Pacific), finished by the 27th")
        check(!y2026.contains { $0.name.localizedCaseInsensitiveContains("cancelled") } && !y2026.contains { $0.name.contains("Youth") },
              "no cancelled, youth or continental events")

        let all = y2026 + y2027
        check(I.opener(in: all, now: recorded) == nil, "no opener while a competition is underway")
        let after = I.opener(in: all, now: instant("2026-10-27T12:00:00Z"))
        check(after?.id == "ifsc-1544", "once Santiago is over, the next competition is Tokyo 2027", "\(String(describing: after?.id))")
        if let after {
            let row = I.openerEvent(after)
            check(row.id == "ifsc-1544" && row.content == .field(title: "Tokyo 2027", summary: "Tokyo, Japan")
                  && row.caption == "Season opener · Apr 9–11 · Boulder" && row.state == .scheduled
                  && row.start == DayKey(year: 2027, month: 4, day: 9).start(in: .current),
                  "the off-season row: Tokyo 2027, its place, \"Season opener · Apr 9–11 · Boulder\", from its first local day",
                  "\(row.content) \(String(describing: row.caption))")
            if case let .climbing(eventID, category, _, _, _, _)? = row.ref {
                check(eventID == 1544 && category.isEmpty, "it opens the whole competition, as the in-season row does")
            }
        }

        if let santiago {
            let detailed = I.parseEvent(sched("ifsc_event_1489_santiago2026.json"), into: santiago)
            let lead = detailed.rounds.filter { $0.discipline == "Lead" }
            check(detailed.categories.count == 4 && lead.map(\.name) == ["Qualification", "Semi-final", "Final"]
                  && lead.allSatisfy { Set($0.categories) == ["Men", "Women"] && $0.status == "finished" && $0.start == .tba },
                  "Santiago: 4 categories; lead rounds merge men and women; no times from IFSC",
                  "\(lead.map { "\($0.name) \($0.categories) \($0.status)" })")
            check(detailed.categories.first { $0.name == "Lead Women" }?.podium == ["SLO Garnbret", "ITA Rogora", "SLO Rekar"],
                  "Lead Women podium: Garnbret, Rogora, Rekar")
        }
        if let tokyo {
            let detailed = I.parseEvent(sched("ifsc_event_1544_tokyo2027.json"), into: tokyo)
            check(detailed.categories.map(\.name) == ["Boulder Men", "Boulder Women", "Boulder Mixed"]
                  && detailed.rounds.count == 1 && detailed.rounds.first?.categories == ["Men", "Women", "Mixed"]
                  && detailed.rounds.first?.status == "pending",
                  "Tokyo 2027: boulder men, women and the new mixed category, one pending round", "\(detailed.categories.map(\.name))")
        }
        check(I.parseRegistrations(sched("ifsc_registrations_1489.json"), countries: ["USA", "SLO"]) == ["USA": 18, "SLO": 5],
              "your countries in Santiago: 18 USA athletes confirmed, 5 Slovenians")
    }

    // MARK: Streams

    static func scheduleStreams() {
        typealias S = ScheduleProvider.Streams
        check(S.scheduledDate("Scheduled for 10/29/26, 10:45\u{202F}AM") == instant("2026-10-29T10:45:00Z"),
              "\"Scheduled for\" with a narrow no-break space parses as UTC")
        let nasa = S.parse(html: String(decoding: sched("yt_nasa_streams_tz_utc.html"), as: UTF8.self))
        check(nasa.count == 1 && nasa.first?.start == instant("2026-10-29T10:45:00Z"),
              "the streams tab with tz=UTC: one scheduled stream at 10:45 UTC (matches its watch page)", "\(nasa)")
        let climbing = S.parse(html: String(decoding: sched("yt_worldclimbing_streams_2026-10-24.html"), as: UTF8.self))
        check(climbing.map(\.title) == ["Lead semi-finals | Santiago 2026", "Lead finals | Santiago 2026"],
              "World Climbing on Oct 24: the lead semi-finals and finals scheduled", "\(climbing.map(\.title))")
        let y2026 = ScheduleProvider.IFSC.parseSeason(sched("ifsc_season_38_2026.json"), now: recorded)
        if let santiago = y2026.first(where: { $0.shortName == "Santiago" }) {
            let detailed = ScheduleProvider.IFSC.parseEvent(sched("ifsc_event_1489_santiago2026.json"), into: santiago)
            let timed = S.attach(climbing, to: detailed)
            let semi = timed.rounds.first { $0.discipline == "Lead" && $0.name == "Semi-final" }
            let final = timed.rounds.first { $0.discipline == "Lead" && $0.name == "Final" }
            let qual = timed.rounds.first { $0.discipline == "Lead" && $0.name == "Qualification" }
            if let s = semi?.start.date, let f = final?.start.date {
                check(f.timeIntervalSince(s) == 9 * 3600 && semi?.stream != nil && qual?.start == .tba,
                      "streams time the lead semi-final and final (nine hours apart); qualification stays TBA")
            } else {
                check(false, "streams time the lead semi-final and final", "\(timed.rounds)")
            }
        }
    }

    // MARK: bo3.gg

    static func scheduleCS() {
        typealias C = ScheduleProvider.CS
        let upcoming = C.parseTournaments(sched("bo3_tournaments_upcoming_s.json"))
        let singapore = upcoming.first { $0.shortName == "PGL Major Singapore" }
        check(upcoming.count == 7 && upcoming.first?.shortName == "IEM Beijing" && upcoming.allSatisfy { $0.lanes == ["s"] }
              && upcoming.first?.startDay == DayKey(year: 2026, month: 11, day: 2) && upcoming.first?.endDay == DayKey(year: 2026, month: 11, day: 7),
              "7 upcoming S-tier tournaments on the one lane, from IEM Beijing (Nov 2–7)", "\(upcoming.count)")
        check(singapore?.badge == "Major" && singapore?.prize == 1_250_000 && singapore?.format == "LAN",
              "the Singapore Major: badge, $1.25M, LAN")
        check(C.prize(1_250_000) == "$1.25M" && C.prize(1_000_000) == "$1M" && C.prize(1_320_000) == "$1.32M" && C.prize(100_000) == "$100K",
              "prizes read $1.25M, $1M, $1.32M, $100K", "\(String(describing: C.prize(1_320_000)))")
        let current = C.parseTournaments(sched("bo3_tournaments_current_s.json"))
        check(current.count == 1 && current.first?.status == .live && current.first?.shortName == "PGL Masters Bucharest",
              "PGL Masters Bucharest is live")
        check(upcoming.contains { $0.shortName == "IEM Beijing" && $0.name == "Intel Extreme Masters Beijing 2026" },
              "Intel Extreme Masters reads IEM Beijing, as fans say it (the dates give the year)")
        if let beijing = upcoming.first(where: { $0.shortName == "IEM Beijing" }) {
            let detailed = C.parseTournament(sched("bo3_tournament_iem-beijing-2026.json"), into: beijing)
            check(detailed.countryCode == "CN" && detailed.flag == "🇨🇳" && detailed.teams.count == 16 && C.topTen(detailed.teams) == 6
                  && detailed.teams.first?.name == "Legacy",
                  "IEM Beijing: China, 16 teams, 6 of the top 10 (Legacy ranked highest)", "\(detailed.teams.count) \(C.topTen(detailed.teams))")
        }
        let opening = C.parseMatches(sched("bo3_tournament_5113_matches.json"), now: recorded)
        check(opening.count == 8 && opening.allSatisfy { if case .provisional(_, .orderOfPlay) = $0.start { true } else { false } },
              "IEM Beijing's eight opening matches all at 07:00 UTC: order of play provisional")
        let teams = C.parseMatches(sched("bo3_teams_793_667_upcoming.json"), now: recorded)
        let g2 = teams.first { $0.top?.name == "G2" }
        check(teams.count == 5 && g2?.start == .exact(instant("2026-10-26T17:00:00Z")) && g2?.bottom?.name == "DENDELE"
              && g2?.competition == "PGL Masters Bucharest 2026" && g2?.format == "Best of 3",
              "G2 and Vitality: 5 matches; G2 v DENDELE Oct 26 17:00 UTC, best of 3", "\(teams.count)")
        let url = C.teamMatchesURL(teamIDs: [793, 667]).absoluteString.removingPercentEncoding ?? ""
        check(url.contains("filter[matches.team_ids][overlap]=793,667") && url.contains("upcoming,current"),
              "one request covers several teams, either side")
    }

    // MARK: Provider fixes

    static func scheduleProviderFixes() {
        func match(_ status: String, winner: Int? = nil) -> Event? {
            let json = """
            {"id": 9001, "slug": "g2-vs-faze", "status": "\(status)", "bo_type": 3, "start_date": "2026-10-28T15:00:00.000+00:00",
             "team1_score": 0, "team2_score": \(winner == nil ? 0 : 1), "winner_team_id": \(winner.map(String.init) ?? "null"),
             "team1": {"id": 793, "name": "G2"}, "team2": {"id": 791, "name": "FaZe"}, "tournament": {"name": "BLAST Rivals Fall 2026"}}
            """
            guard let m = try? JSONDecoder().decode(CounterStrike.Match.self, from: Data(json.utf8)) else { return nil }
            return CounterStrike.makeEvent(m)
        }
        let canceled = match("canceled"), postponed = match("postponed"), forfeit = match("defwin", winner: 791)
        check(canceled?.state == .final && canceled?.detail == "Canceled" && canceled?.competitors.allSatisfy({ $0.score == nil && !$0.isWinner }) == true,
              "CS2: a canceled match is over, says Canceled, and has no score (not upcoming)")
        check(postponed?.state == .final && postponed?.detail == "Postponed" && postponed?.competitors.allSatisfy({ $0.score == nil }) == true,
              "CS2: a postponed match says Postponed, without a score")
        check(forfeit?.state == .final && forfeit?.detail == "Forfeit" && forfeit?.competitors.last?.isWinner == true,
              "CS2: a forfeit is final, with its winner")
        check(match("upcoming")?.state == .scheduled && match("current")?.state == .live, "upcoming and live matches are unchanged")
        let upcomingURL = CounterStrike.listURL(status: "upcoming,postponed", sort: "start_date", limit: 12,
                                                after: instant("2026-10-24T00:00:00Z")).absoluteString.removingPercentEncoding ?? ""
        let finishedURL = CounterStrike.listURL(status: "finished,defwin,canceled", sort: "-start_date", limit: 12,
                                                before: instant("2026-10-28T00:00:00Z")).absoluteString.removingPercentEncoding ?? ""
        check(upcomingURL.contains("[in]=upcoming,postponed") && upcomingURL.contains("start_date][gte]=2026-10-24")
              && finishedURL.contains("[in]=finished,defwin,canceled") && finishedURL.contains("start_date][lte]=2026-10-28"),
              "the lists fetch postponed and canceled matches, bounded by date so old ones can't take a slot")
        // CS2 is S-tier only: every bo3.gg list asks for tier S, and nothing else.
        let csLists = [upcomingURL, finishedURL,
                       ScheduleProvider.CS.tournamentsURL(status: "upcoming").absoluteString,
                       ScheduleProvider.CS.matchesURL(from: instant("2026-10-24T00:00:00Z"), to: instant("2026-10-31T00:00:00Z")).absoluteString,
                       ScheduleProvider.CS.teamMatchesURL(teamIDs: [793]).absoluteString,
                       CSHistory.url(teamIDs: [793], page: 0).absoluteString,
                       SeasonResults.finishedURL(page: 0).absoluteString,
                       BO3Profiles.upcomingURL(teamID: 793)?.absoluteString ?? ""]
            .map { $0.removingPercentEncoding ?? $0 }
        check(csLists.allSatisfy { $0.contains("tier][in]=s") && !$0.contains("tier][in]=s,") },
              "CS2: scores, schedules, tournaments, results and team pages all ask bo3.gg for S-tier only")

        // The climbing off-season (pure parts; the provider branch calls these).
        let all = ScheduleProvider.IFSC.parseSeason(sched("ifsc_season_38_2026.json")) + ScheduleProvider.IFSC.parseSeason(sched("ifsc_season_40_2027.json"))
        check(ScheduleProvider.IFSC.opener(in: all, now: instant("2026-12-15T12:00:00Z"))?.shortName == "Tokyo"
              && ScheduleProvider.IFSC.opener(in: all, now: instant("2027-04-10T03:00:00Z")) == nil
              && ScheduleProvider.IFSC.opener(in: all, now: instant("2027-04-12T12:00:00Z"))?.shortName == "Keqiao",
              "climbing off-season: Tokyo through the winter, nothing extra during Tokyo, Keqiao after it")
    }

    // MARK: Navigation (S3) and brackets

    static func scheduleNavigation() {
        typealias Page = RootView.Page
        let match = Event(id: "espn-1", content: .field(title: "x", summary: ""), state: .scheduled, start: .now,
                          detail: nil, caption: nil, link: nil)
        check(Page.schedule(.all).parent == .scores && Page.schedule(.climbing).memoryKey == "schedule:climbing"
              && Page.schedule(.all).depth == 1,
              "a schedule is a page of its own, one step from Scores")
        check(Page.schedule(.all).backTitle == "Schedule" && Page.schedule(.tournaments).backTitle == "Tournaments"
              && Page.detail(match).backTitle == "Match" && Page.scores.backTitle == "Scores",
              "Back buttons name the page they return to")
        check(Page.standings(League.with(id: "eng.1")!, returnTo: match).parent == .detail(match)
              && Page.addSports.parent == .manage && Page.scores.parent == nil,
              "with nothing to return to, Back keeps the old one-level rule")

        // Brackets: a canceled match wasn't played.
        func bracketMatch(_ status: String) -> BracketMatch? {
            let json = JSON(data: Data("""
            {"id": 7, "status": "\(status)", "team1_id": 793, "team2_id": 791, "team1_score": 0, "team2_score": 0,
             "winner_team_id": null, "bo_type": 3, "start_date": "2026-10-28T15:00:00.000+00:00"}
            """.utf8))
            let teams = [793: BracketTeam(id: "793", name: "G2", abbreviation: "G2", logo: nil),
                         791: BracketTeam(id: "791", name: "FaZe", abbreviation: "FAZE", logo: nil)]
            return CSTournament.match(json, teams: teams, live: [])
        }
        let canceled = bracketMatch("canceled"), postponed = bracketMatch("postponed"), played = bracketMatch("finished")
        check(canceled?.topScore == nil && canceled?.winner == nil && canceled?.live == false
              && canceled?.note == "Best of 3 · Canceled" && postponed?.note == "Best of 3 · Postponed",
              "brackets: a canceled or postponed match has no score and says so", "\(String(describing: canceled?.note))")
        check(played?.topScore == 0, "a played match keeps its score")
    }

    // MARK: Folding, list pages, the league page

    static func scheduleFolding() {
        func item(_ id: String, _ day: DayKey, league: String = "nba", field: Bool = false) -> ScheduleItem {
            ScheduleItem(id: id, sportRaw: field ? Sport.climbing.rawValue : Sport.basketball.rawValue, league: league, day: day,
                         start: .tba, status: .scheduled,
                         top: field ? nil : ScheduleTeam(id: "\(id)a", name: "A", abbreviation: "A", logo: nil),
                         bottom: field ? nil : ScheduleTeam(id: "\(id)b", name: "B", abbreviation: "B", logo: nil),
                         title: field ? "Round" : nil, ref: field ? .climbing(eventID: 1) : .espn(path: "basketball/nba", id: id))
        }
        let mon = DayKey(year: 2026, month: 10, day: 26)
        func days(_ counts: [Int], from start: DayKey = mon) -> [AgendaDay] {
            var items: [ScheduleItem] = []
            for (offset, count) in counts.enumerated() where count > 0 {
                items += (0..<count).map { item("g\(offset)-\($0)", start.adding(days: offset)) }
            }
            return Agenda.build(items, leagueOrder: ["nba"], grouped: true)
        }
        let busy = days([10, 8, 9, 12, 11, 14, 13])
        check(Agenda.defaultOpen(busy, today: mon) == [mon, mon.adding(days: 1)],
              "a busy week opens today and the next game day; the rest fold")
        let nfl = days([0, 0, 0, 1, 0, 0, 13], from: mon.adding(days: -1))   // Thursday night, then Sunday
        check(Agenda.defaultOpen(nfl, today: mon) == [mon.adding(days: 2), mon.adding(days: 5)],
              "a lone Thursday game doesn't leave Sunday folded", "\(Agenda.defaultOpen(nfl, today: mon))")
        let sparse = days([1, 1, 1, 1, 1])
        check(Agenda.defaultOpen(sparse, today: mon).count == 3, "small days: at most three open at first")
        check(Agenda.defaultOpen(days([0, 0, 4, 5]), today: mon) == [mon.adding(days: 2), mon.adding(days: 3)],
              "nothing today: the next two game days")

        let mixed = Agenda.build([item("a", mon), item("b", mon), item("c", mon, league: "eng.1"),
                                  item("d", mon, league: "ifsc", field: true)], leagueOrder: ["eng.1", "nba", "ifsc"], grouped: true)
        check(Agenda.summary(mixed[0], namesLeagues: true) == "3 games · 1 event · EPL, NBA, Climbing"
              && Agenda.count(mixed[0]) == "3 games · 1 event" && Agenda.leagues(mixed[0]) == "EPL, NBA, Climbing",
              "a folded day in one line: games, events, leagues in your order", Agenda.summary(mixed[0], namesLeagues: true))
        check(Agenda.summary(busy[0], namesLeagues: false) == "10 games", "a league's own page doesn't name itself")

        // Day boards: Eastern days, only those the league plays.
        let at = instant("2026-10-26T16:00:00Z")
        let london = TimeZone(identifier: "Europe/London")!
        let week = (mon, mon.adding(days: 6))
        check(ScheduleProvider.ESPN.boardDays(from: week.0, to: week.1, zone: DayKey.eastern, at: at).count == 7,
              "in New York a week is seven boards (it was nine)")
        check(ScheduleProvider.ESPN.boardDays(from: week.0, to: week.1, zone: london, at: at).first == mon.adding(days: -1),
              "ahead of New York: the evening before (its late games are tomorrow morning here)")
        check(ScheduleProvider.ESPN.boardDays(from: week.0, to: week.1, zone: pacific, at: at).last == mon.adding(days: 7),
              "behind New York: the day after")
        let played = [mon, mon.adding(days: 3), mon.adding(days: 5)]
        check(ScheduleProvider.ESPN.boardDays(from: week.0, to: week.1, calendar: ScheduleCalendar(days: played), zone: DayKey.eastern, at: at) == played,
              "days the calendar doesn't list cost no request")
        // MLB's calendar lists days off, not game days (calendarIsWhitelist: false).
        let mlb = ScheduleProvider.ESPN.parseCalendar(sched("espn_mlb_undated.json"))
        let wsOff = DayKey(year: 2026, month: 10, day: 29)
        check(mlb.days.isEmpty && mlb.offDays?.contains(wsOff) == true && mlb.seasonEnd == DayKey(year: 2026, month: 11, day: 11)
              && mlb.plays(on: DayKey(year: 2026, month: 10, day: 27)) == true && mlb.plays(on: wsOff) == false
              && mlb.plays(on: DayKey(year: 2026, month: 12, day: 1)) == false,
              "MLB: the listed days are days off (the World Series' Oct 29 travel day), so Oct 27 has a game")
        check(mlb.nextDay(onOrAfter: wsOff) == DayKey(year: 2026, month: 10, day: 30)
              && ScheduleProvider.ESPN.boardDays(from: week.0, to: week.1, calendar: mlb, zone: DayKey.eastern, at: at)
                 == [26, 27, 28, 30, 31].map { DayKey(year: 2026, month: 10, day: $0) },
              "MLB this week: boards for the game days only, none for the travel day")

        check(ScheduleScope.league("nba").navigator == .list && ScheduleScope.league("eng.1").navigator == .list
              && ScheduleScope.league("nfl").navigator == .weekPicker && ScheduleScope.all.navigator == .weekStrip,
              "a daily league's full schedule is a list of game days; football goes week by week")
        check(ScheduleScope.all.foldsDays && ScheduleScope.league("nba").foldsDays
              && !ScheduleScope.team(ScheduleTeamRef(id: "x", name: "X", logo: nil)).foldsDays,
              "the calendar and league pages fold days; a team's page doesn't")
        check(ScheduleScope.for(league: League.with(id: "ifsc")!) == .climbing && ScheduleScope.for(league: League.with(id: "cs2")!) == .tournaments,
              "climbing's and CS2's full schedules are their season pages")
        check(RootView.Page.league(League.with(id: "nba")!, fromScores: true).backTitle == "NBA",
              "a schedule opened from a sport's page goes back to it by name")

        // The league page's "when": no clicking through days to find it.
        let today = DayKey(year: 2026, month: 10, day: 26)   // a Monday
        typealias U = LeagueUpcomingSection
        check(U.relative(start: today.adding(days: 4), end: today.adding(days: 6), today: today) == "This weekend"
              && U.relative(start: today.adding(days: 2), end: today.adding(days: 2), today: today) == "Wednesday"
              && U.relative(start: today.adding(days: 9), end: today.adding(days: 11), today: today) == "Next week"
              && U.relative(start: today.adding(days: -1), end: today.adding(days: 1), today: today) == "Now"
              && U.relative(start: DayKey(year: 2027, month: 4, day: 9), end: DayKey(year: 2027, month: 4, day: 11), today: today) == "In 5 months",
              "competitions say when: this weekend, Wednesday, next week, now, in 5 months",
              U.relative(start: DayKey(year: 2027, month: 4, day: 9), end: DayKey(year: 2027, month: 4, day: 11), today: today))
    }

    // MARK: Cache

    static func scheduleCache() async {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("scoreline-schedule-cache-\(UUID().uuidString)")
        let fixtures = FileManager.default.temporaryDirectory.appendingPathComponent("scoreline-schedule-fixtures-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: fixtures, withIntermediateDirectories: true)
        let url = URL(string: "https://example.invalid/schedule-cache-test?x=1")!
        let saved = FixtureProtocol.directory
        FixtureProtocol.directory = fixtures
        defer {
            FixtureProtocol.directory = saved
            try? FileManager.default.removeItem(at: dir)
            try? FileManager.default.removeItem(at: fixtures)
        }
        let file = fixtures.appendingPathComponent(FixtureProtocol.key(for: url) + ".bin")
        try? Data("{\"n\": 7}".utf8).write(to: file)
        let parse: @Sendable (Data) throws -> Int = { JSON(data: $0)["n"].int ?? -1 }

        let cache = ScheduleCache(directory: dir)
        let first = try? await cache.get(url, ttl: 600, parse: parse)
        try? FileManager.default.removeItem(at: file)       // the network now has nothing
        let second = try? await cache.get(url, ttl: 600, parse: parse)
        check(first?.value == 7 && second?.value == 7 && second?.fetchedAt == first?.fetchedAt,
              "a fresh entry comes back without a request")
        let stale = try? await cache.get(url, ttl: 0, parse: parse)
        check(stale?.value == 7 && stale?.stale == true, "when the network fails, the stale entry is served and flagged")
        let reopened = ScheduleCache(directory: dir)
        let peeked = await ScheduleCache(directory: dir).peek(url, as: Int.self)
        check(peeked?.value == 7 && peeked?.stale == true && peeked?.fetchedAt == first?.fetchedAt,
              "a first paint reads what's saved, however old, without a request")
        let unknown = await cache.peek(URL(string: "https://example.invalid/never")!, as: Int.self)
        check(unknown == nil, "nothing saved: no first paint (the skeleton stays)")
        let fromDisk = try? await reopened.get(url, ttl: 600, parse: parse)
        check(fromDisk?.value == 7, "entries survive on disk (a new session starts warm)")
        await cache.invalidate(url)
        let gone = try? await ScheduleCache(directory: dir).get(url, ttl: 600, parse: parse)
        check(gone == nil, "invalidating removes the entry from memory and disk")
    }
}
