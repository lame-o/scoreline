import Foundation

// Results pages (R2): the pure pieces behind the agenda's Results mode, the
// rows' result words, the round picker and strip, team rows and seasons, the
// league page's pick, the match page's history rules, and the page stack's
// modes. Views only lay out what these decide.

extension ScorelineTests {
    static func resultsPages() {
        print("\nResults pages")
        resultsRowWords()
        resultsTeamSide()
        resultsNavigation()
        resultsHubPick()
        resultsHistory()
        resultsPageStack()
    }

    // MARK: Fixtures

    nonisolated private static let rpDay = DayKey(year: 2026, month: 10, day: 24)

    private static func rpTeam(_ id: String, _ name: String, _ abbr: String, _ score: String?, win: Bool = false) -> ScheduleTeam {
        ScheduleTeam(id: id, name: name, abbreviation: abbr, logo: nil, score: score, winner: win)
    }

    private static func rpGame(_ id: String, sport: Sport = .soccer, status: ScheduleStatus = .final, day: DayKey = rpDay,
                             hour: Double = 15, top: ScheduleTeam, bottom: ScheduleTeam, result: ResultDetail? = nil,
                             competition: String? = nil, venue: String? = nil) -> ScheduleItem {
        ScheduleItem(id: id, sportRaw: sport.rawValue, league: sport == .soccer ? "eng.1" : "nfl", competition: competition, day: day,
                     start: .exact(day.start(in: .current).addingTimeInterval(hour * 3600)), status: status,
                     top: top, bottom: bottom, venue: venue, ref: .espn(path: "soccer/eng.1", id: id), result: result)
    }

    private static func rpDetail(_ label: String, kind: ResultDetail.Kind = .regulation, details: String? = nil, context: String? = nil,
                               shootout: (Int, Int)? = nil, aggregate: (Int, Int)? = nil) -> ResultDetail {
        var d = ResultDetail(kind: kind, label: label)
        d.details = details
        d.context = context
        d.shootout = shootout.map { .init(top: $0.0, bottom: $0.1) }
        d.aggregate = aggregate.map { .init(top: $0.0, bottom: $0.1) }
        return d
    }

    private static var rpVilla: ScheduleItem {
        var d = rpDetail("FT", details: "Jackson 6', 60' · Haaland 52'")
        d.attendance = 36_743
        d.headline = "Man City beaten by double from Villa's Jackson"
        d.spoken = "Aston Villa 2, Man City 1, full time, Aston Villa won. Goals: Jackson, 6th and 60th minute; Haaland, 52nd minute."
        return rpGame("espn-1", hour: 4.5, top: rpTeam("espn-soccer-362", "Aston Villa", "AVL", "2", win: true),
                    bottom: rpTeam("espn-soccer-382", "Man City", "MNC", "1"), result: d, venue: "Villa Park · Birmingham")
    }

    // MARK: Row words

    static func resultsRowWords() {
        let pens = rpGame("p", top: rpTeam("a", "Australia", "AUS", "1"), bottom: rpTeam("e", "Egypt", "EGY", "1", win: true),
                        result: rpDetail("Pens", kind: .penalties, shootout: (2, 4)))
        var legs = rpDetail("FT", context: "Round of 16 · 2nd leg · Atlético advance 7–5 on agg.", aggregate: (5, 7))
        legs.leg = 2
        let twoLegs = rpGame("l", top: rpTeam("t", "Tottenham", "TOT", "3", win: true), bottom: rpTeam("m", "Atlético Madrid", "ATM", "2"),
                             result: legs)
        check(pens.result?.secondLine == "2–4" && ResultText.copy(pens) == "AUS 1–1 EGY · Pens 2–4", "Copy: the shootout beside its label",
              ResultText.copy(pens))
        check(ResultText.copy(twoLegs).contains("FT Agg 5–7 · Round of 16"), "Copy: the aggregate, then the context", ResultText.copy(twoLegs))
        check(ResultText.copy(rpVilla) == "AVL 2–1 MNC · FT · Jackson 6', 60' · Haaland 52'", "Copy: score, label, details",
              ResultText.copy(rpVilla))
        let tip = ResultText.tooltip(rpVilla)
        check(tip.hasPrefix("Kicked off ") && tip.contains("Villa Park, Birmingham · 36,743 · Man City beaten by double"),
              "tooltip: kickoff, venue, attendance, recap", tip)
        check(tip.hasSuffix("\nJackson 6', 60' · Haaland 52'"), "tooltip ends with the details in full", tip)
        let red = rpGame("r", top: rpTeam("c", "Chelsea", "CHE", "0"), bottom: rpTeam("s", "Tottenham", "TOT", "2", win: true),
                       result: rpDetail("FT", details: "Penders 77' (OG) · Tel 87' · ▮ Palmer 80'"))
        check(ResultText.copy(red).hasSuffix("Tel 87' · Red card Palmer 80'"), "Copy spells the red card", ResultText.copy(red))
        check(ResultText.tooltip(twoLegs).contains("Atlético advance 7–5 on agg."), "tooltip carries the context in full")
        // VoiceOver: the parser's whole sentence, then the day it was played.
        let spoken = ScheduleSpeech.row(rpVilla, event: rpVilla.event())
        let day = rpDay.displayDate.formatted(.dateTime.weekday(.wide).month(.wide).day())
        check(spoken == "Aston Villa 2, Man City 1, full time, Aston Villa won. Goals: Jackson, 6th and 60th minute; Haaland, 52nd minute. \(day).",
              "row speech: the result's sentence and the day, said once", spoken)
        var cup = rpVilla
        cup.competition = "Carabao Cup · Fourth Round"
        check(ScheduleSpeech.row(cup, event: cup.event()).hasPrefix("Carabao Cup · Fourth Round. Aston Villa 2"), "row speech: the competition first")
        // Dimming follows the score: Tottenham won the match and isn't dimmed.
        let e = twoLegs.event()
        if case let .match(top, bottom) = e.content {
            check(!e.stepsBack(top) && e.stepsBack(bottom), "two legs: the match loser dims, not the side that went out")
        } else {
            check(false, "two legs: a match")
        }
    }

    // MARK: A team's side

    static func resultsTeamSide() {
        let me = "espn-soccer-359"
        let home = rpGame("h", top: rpTeam(me, "Arsenal", "ARS", "2", win: true), bottom: rpTeam("e", "Everton", "EVE", "0"))
        let r = TeamResult(home, team: me)
        check(r.letter == "W" && r.score == "2–0" && r.home && r.opponent?.name == "Everton", "soccer: home side first, W 2–0 vs Everton")
        let away = rpGame("a", top: rpTeam("b", "Bayern", "BAY", "2"), bottom: rpTeam(me, "Arsenal", "ARS", "2"))
        check(TeamResult(away, team: me).letter == "D" && !TeamResult(away, team: me).home, "soccer draw away: D, at")
        let loss = rpGame("l", top: rpTeam("l", "Liverpool", "LIV", "1", win: true), bottom: rpTeam(me, "Arsenal", "ARS", "0"))
        check(TeamResult(loss, team: me).letter == "L" && TeamResult(loss, team: me).score == "0–1", "a loss reads from the team's side")
        let pens = rpGame("p", top: rpTeam(me, "Arsenal", "ARS", "1", win: true), bottom: rpTeam("c", "Crystal Palace", "CRY", "1"),
                        result: rpDetail("Pens", kind: .penalties, shootout: (4, 3)))
        check(TeamResult(pens, team: me).letter == "W" && TeamResult(pens, team: me).shootout, "a shootout win: W, marked (P)")
        let nfl = rpGame("k", sport: .football, top: rpTeam("espn-football-12", "Chiefs", "KC", "27", win: true),
                       bottom: rpTeam("espn-football-7", "Broncos", "DEN", "24"))
        check(!TeamResult(nfl, team: "espn-football-12").home && TeamResult(nfl, team: "espn-football-7").home,
              "US sports: the away side is listed first")
        check(TeamResult(rpGame("t", sport: .football, top: rpTeam("x", "X", "X", "20"), bottom: rpTeam("y", "Y", "Y", "20")), team: "x").letter == "T",
              "a football tie is T")
        let forfeit = rpGame("f", top: rpTeam("cs-1", "G2", "G2", "1", win: true), bottom: rpTeam("cs-2", "Vexar", "VEX", "0"),
                           result: rpDetail("Forfeit", kind: .forfeit))
        check(TeamResult(forfeit, team: "cs-1").letter == "W" && TeamResult(forfeit, team: "cs-1").score == nil, "a forfeit: W, no score")
        let postponed = rpGame("x", status: .postponed, top: rpTeam(me, "Arsenal", "ARS", nil), bottom: rpTeam("b", "Brentford", "BRE", nil))
        check(TeamResult(postponed, team: me).letter == nil, "postponed: no letter")
        check(TeamResult(rpGame("z", top: rpTeam(me, "Arsenal", "ARS", nil), bottom: rpTeam("b", "B", "B", nil)), team: me).letter == nil,
              "a bare final (no scores): no letter")
        check(TeamResult(loss, team: me).spoken == "lost 0 to 1", "spoken from the team's side")
        let months = ResultsAgendaPage.months([home, rpGame("s", day: DayKey(year: 2026, month: 9, day: 30), top: rpTeam(me, "A", "A", "1"), bottom: rpTeam("q", "Q", "Q", "0")), rpGame("s2", day: DayKey(year: 2026, month: 9, day: 2), top: rpTeam(me, "A", "A", "1"), bottom: rpTeam("q", "Q", "Q", "0"))])
        check(months.map(\.count) == [1, 2], "team list: split by month, newest first")
    }

    // MARK: Navigation

    static func resultsNavigation() {
        check(ResultsNavigation.of(.league("eng.1")) == .rounds && ResultsNavigation.of(.league("uefa.champions")) == .rounds,
              "soccer pages by round")
        check(ResultsNavigation.of(.league("nfl")) == .rounds && ResultsNavigation.of(.league("college-football")) == .rounds,
              "football by week")
        check(ResultsNavigation.of(.league("mlb")) == .days && ResultsNavigation.of(.league("nba")) == .days && ResultsNavigation.of(.all) == .days,
              "daily leagues and everything by day")
        check(ResultsNavigation.of(.yourTeams) == .list && ResultsNavigation.of(.team(ScheduleTeamRef(id: "x", name: "X", logo: nil))) == .list,
              "teams as lists")
        func r(_ id: String, _ d: Int, section: String? = nil) -> ResultRound {
            let first = DayKey(year: 2026, month: 10, day: d)
            return ResultRound(id: id, kind: .day, title: first.longLabel, detail: first.shortLabel, first: first, last: first, section: section)
        }
        // Game days Oct 3, 8, 14, 17, 18, 24 (oldest first, as the store keeps them).
        let days = [r("d3", 3), r("d8", 8), r("d14", 14), r("d17", 17), r("d18", 18), r("d24", 24)]
        check(ResultsNavigation.weekStep(-1, from: DayKey(year: 2026, month: 10, day: 24), rounds: days)?.id == "d17",
              "‹ a week: the game day nearest a week back")
        check(ResultsNavigation.weekStep(-1, from: DayKey(year: 2026, month: 10, day: 14), rounds: days)?.id == "d8",
              "‹ from Wednesday the 14th: Thursday the 8th")
        check(ResultsNavigation.weekStep(1, from: DayKey(year: 2026, month: 10, day: 24), rounds: days) == nil, "› past the newest: nothing")
        check(ResultsNavigation.weekStep(-1, from: DayKey(year: 2026, month: 10, day: 3), rounds: days) == nil, "‹ before the first: nothing")
        let monday = DayKey(year: 2026, month: 10, day: 26)
        check(ResultsNavigation.stripStart(DayKey(year: 2026, month: 10, day: 25), today: monday) == DayKey(year: 2026, month: 10, day: 20),
              "this week's strip ends today: Tue 20 to Mon 26")
        check(ResultsNavigation.stripStart(DayKey(year: 2026, month: 10, day: 14), today: monday) == DayKey(year: 2026, month: 10, day: 11),
              "an earlier week runs Sunday to Saturday")
        let gap = [r("a", 1), r("b", 29)]
        check(ResultsNavigation.weekStep(-1, from: DayKey(year: 2026, month: 10, day: 29), rounds: gap)?.id == "a",
              "‹ over an empty week: the next game day back")
        // The picker's menu: newest first, sections by their newest round.
        let rounds = [r("w1", 1, section: "Regular Season"), r("w2", 8, section: "Regular Season"), r("p1", 15, section: "Postseason")]
        let sections = RoundPicker.sections(rounds)
        check(sections.map(\.title) == ["Postseason", "Regular Season"] && sections[1].options.map(\.id) == ["w2", "w1"],
              "round menu: newest first", "\(sections.map { ($0.title, $0.options.map(\.id)) })")
    }

    // MARK: League page

    static func resultsHubPick() {
        let followed: Set<String> = ["espn-soccer-359"]
        var items: [ScheduleItem] = (0..<10).map { i in
            rpGame("g\(i)", day: DayKey(year: 2026, month: 10, day: 23 + i / 4), hour: Double(10 + i),
                 top: rpTeam("t\(i)", "T", "T", "1", win: true), bottom: rpTeam("b\(i)", "B", "B", "0"))
        }
        items.append(rpGame("ars", day: DayKey(year: 2026, month: 10, day: 25), hour: 22,
                          top: rpTeam("espn-soccer-359", "Arsenal", "ARS", "2", win: true), bottom: rpTeam("e", "Everton", "EVE", "0")))
        items.append(rpGame("next", status: .scheduled, day: DayKey(year: 2026, month: 10, day: 26),
                          top: rpTeam("x", "X", "X", nil), bottom: rpTeam("y", "Y", "Y", nil)))
        let picked = LeagueResultsSection.pick(items, followed: followed)
        check(picked.count == 8, "league page: eight results at most")
        check(picked.contains { $0.id == "ars" }, "your team's result makes the cut, even last on the last day")
        check(!picked.contains { $0.id == "next" }, "games still to play stay in Upcoming")
        check(picked.map(\.day) == picked.map(\.day).sorted(), "by day")
        let lastDay = picked.filter { $0.day == DayKey(year: 2026, month: 10, day: 25) }
        check(lastDay.first?.id == "ars", "within its day, your team's first", "\(lastDay.map(\.id))")
    }

    // MARK: Match page history

    static func resultsHistory() {
        let now = Date(timeIntervalSince1970: 1_793_000_000)
        func event(_ state: EventState, hoursAgo: Double) -> Event {
            Event(id: "e", content: .field(title: "", summary: ""), state: state, start: now - hoursAgo * 3600, detail: nil,
                  caption: nil, link: nil)
        }
        check(DetailView.isHistory(event(.final, hoursAgo: 7), now: now), "a final from 7 h ago loads once")
        check(!DetailView.isHistory(event(.final, hoursAgo: 2), now: now), "a final from 2 h ago keeps refreshing (stat corrections)")
        check(!DetailView.isHistory(event(.live, hoursAgo: 9), now: now), "a long live game keeps refreshing")
        let today = Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: now)!
        check(DetailView.playedOn(today.addingTimeInterval(-3600), now: today) == "Today", "hero: today")
        check(DetailView.playedOn(today.addingTimeInterval(-86_400), now: today) == "Yesterday", "hero: yesterday")
        let week = today.addingTimeInterval(-5 * 86_400)
        check(DetailView.playedOn(week, now: today) == week.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()),
              "hero: this season, weekday and date")
        let old = today.addingTimeInterval(-700 * 86_400)
        check(DetailView.playedOn(old, now: today) == old.formatted(.dateTime.month(.abbreviated).day().year()), "hero: an old game has its year")
    }

    // MARK: Page stack

    static func resultsPageStack() {
        typealias Page = RootView.Page
        let epl = ScheduleScope.league("eng.1")
        check(Page.schedule(epl).memoryKey == "schedule:league:eng.1", "Upcoming keeps its scroll memory key")
        check(Page.schedule(epl, mode: .results).memoryKey == "schedule:league:eng.1:results", "Results remembers its own scroll")
        check(Page.schedule(epl) == Page.schedule(epl, mode: .upcoming), "a schedule defaults to Upcoming")
        check(Page.schedule(epl, mode: .results).backTitle == "Results" && Page.schedule(epl).backTitle == "Schedule", "Back titles by mode")
        check(Page.schedule(.climbing).backTitle == "Season" && Page.schedule(.tournaments).backTitle == "Tournaments",
              "season pages keep their names")
        check(Page.schedule(epl, mode: .results).depth == 1 && Page.schedule(epl, mode: .results).parent == .scores,
              "Results sits where Schedule does")
    }
}
