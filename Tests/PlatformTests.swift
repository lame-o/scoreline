import SwiftUI

// The platform pieces every page builds on: how a page's height is assembled
// (PageSize), spoken statuses, who steps back in a final, alert copy, the
// entrance cascade, and the legend layout.

extension ScorelineTests {
    static func platform() async {
        print("\nPlatform")
        pageSize()
        spokenStatus()
        stepsBack()
        alerts()
        cascade()
        flowLayout()
        helpers()
        feedEdges()
        await climbingCountries()
    }

    private static func pageSize() {
        let size = PageSize()
        var reports: [(CGFloat, Bool)] = []
        size.onChange = { reports.append(($0, $1)) }
        let header = PageSize.Token(), footer = PageSize.Token(), scroll = PageSize.Token(), flag = PageSize.Token()

        size.chrome(44, for: header)
        check(reports.isEmpty, "no content yet: the page holds the panel's size")
        size.content(300, for: scroll)
        check(reports.count == 1 && reports[0] == (344, false), "header + content", "\(reports)")
        size.chrome(30, for: footer)
        check(reports.last! == (374, false), "a footer adds its height", "\(reports)")
        size.chrome(30, for: footer)
        size.content(300, for: scroll)
        check(reports.count == 2, "the same total again reports nothing", "\(reports.count)")
        size.content(300.4, for: scroll)
        check(reports.count == 2, "a sub-point wobble rounds to the same total")

        // Loading: noted before layout, so the first report already knows.
        size.note(loading: true, for: flag)
        size.content(120, for: scroll)
        check(reports.last! == (194, true), "a spinner reports while loading (RootView won't shrink to it)", "\(reports.last!)")
        size.loading(false, for: flag)
        check(reports.last! == (194, false), "loading ends at the same height: reported again, so the held shrink happens")

        // Hidden under another page: content goes inactive, and coming back reports again.
        let before = reports.count
        size.content(nil, for: scroll)
        check(reports.count == before, "content going inactive reports nothing")
        size.content(120, for: scroll)
        check(reports.count == before + 1 && reports.last! == (194, false),
              "back on top at the same height: reported again (the panel re-fits Scores after Back)")

        // Only the owner clears the content: a view switch's outgoing view going quiet.
        let incoming = PageSize.Token()
        size.content(500, for: incoming)
        size.content(nil, for: scroll)
        check(reports.last! == (574, false), "the outgoing scroll view can't clear the incoming one's height", "\(reports.last!)")

        size.chrome(nil, for: footer)
        check(reports.last! == (544, false), "a footer that goes away stops counting", "\(reports.last!)")
        size.chrome(nil, for: header)
        let count = reports.count
        size.content(600, for: incoming)
        check(reports.count == count, "no chrome at all: holds (a page still assembling)")
    }

    private static func spokenStatus() {
        let cases: [(String, String)] = [
            ("67'", "67th minute"), ("1'", "1st minute"), ("45'+2'", "45th minute plus 2"), ("90'+5'", "90th minute plus 5"),
            ("HT", "Half-time"), ("FT", "Full time"), ("AET", "After extra time"), ("FT-Pens", "After penalties"),
            ("3:10 - 2nd", "3:10 left in the 2nd"), ("0:45 - 4th", "0:45 left in the 4th"), ("2:00 - OT", "2:00 left in overtime"),
            ("1:12 - 2OT", "1:12 left in double overtime"),
            ("Top 5th", "Top of the 5th"), ("Bot 9th", "Bottom of the 9th"), ("Mid 7th", "Middle of the 7th"), ("End 3rd", "End of the 3rd"),
            ("Final", "Final"), ("Final/OT", "Final, overtime"), ("Final/2OT", "Final, double overtime"), ("Final/10", "Final, 10 innings"),
            ("Mirage 5–8", "Mirage 5 to 8"), ("Halftime", "Halftime"),
        ]
        for (raw, spoken) in cases {
            check(Spoken.status(raw) == spoken, "spoken: \(raw) → \(spoken)", Spoken.status(raw))
        }
        let soccer = Event(id: "s", content: .match(top: comp("1", "Arsenal", "2"), bottom: comp("2", "Chelsea", "1")),
                           state: .live, start: .now, detail: "67'", caption: nil, link: nil,
                           ref: .espn(path: "soccer/eng.1", id: "1", sport: .soccer))
        check(soccer.spokenSummary == "Arsenal 2, Chelsea 1, 67th minute", "a live row's summary", soccer.spokenSummary)
        let final = soccer.with(state: .final, detail: .some("FT"))
        check(final.spokenSummary == "Arsenal 2, Chelsea 1, Full time", "a final without a flagged winner names none",
              final.spokenSummary)
        let won = Event(id: "w", content: .match(top: Competitor(id: "1", name: "Arsenal", abbreviation: "ARS", score: "2", logo: nil, isWinner: true),
                                                 bottom: comp("2", "Chelsea", "1")),
                        state: .final, start: .now, detail: "FT", caption: nil, link: nil, ref: soccer.ref)
        check(won.spokenSummary == "Arsenal 2, Chelsea 1, Full time, Arsenal won", "a decided final names its winner", won.spokenSummary)
        let draw = soccer.with(state: .final, content: .match(top: comp("1", "Arsenal", "1"), bottom: comp("2", "Chelsea", "1")),
                               detail: .some("FT"))
        check(draw.spokenResult == "Draw", "a soccer draw is a draw", "\(draw.spokenResult ?? "nil")")
        let preview = soccer.with(state: .scheduled, start: .now + 7200,
                                  content: .match(top: comp("1", "Arsenal"), bottom: comp("2", "Chelsea")))
        check(preview.spokenScore == "Arsenal versus Chelsea" && preview.spokenStatus.hasPrefix("Starts "),
              "before kickoff: who plays, and when", preview.spokenSummary)
        check(MenuBarLabel.liveLabel(1) == "Scoreline, 1 game in progress" && MenuBarLabel.liveLabel(3) == "Scoreline, 3 games in progress",
              "the menu bar's live count reads as words, with the right plural")
    }

    private static func stepsBack() {
        func final(_ top: (String, Bool), _ bottom: (String, Bool), state: EventState = .final) -> Event {
            Event(id: "f", content: .match(top: Competitor(id: "a", name: "A", abbreviation: "A", score: top.0, logo: nil, isWinner: top.1),
                                           bottom: Competitor(id: "b", name: "B", abbreviation: "B", score: bottom.0, logo: nil, isWinner: bottom.1)),
                  state: state, start: .now, detail: nil, caption: nil, link: nil)
        }
        let decided = final(("2", true), ("1", false))
        check(!decided.stepsBack(decided.competitors[0]) && decided.stepsBack(decided.competitors[1]), "a final: the loser steps back")
        let drawn = final(("1", false), ("1", false))
        check(!drawn.stepsBack(drawn.competitors[0]) && !drawn.stepsBack(drawn.competitors[1]), "a draw: nobody steps back")
        let live = final(("2", false), ("1", false), state: .live)
        check(!live.stepsBack(live.competitors[1]), "live: nobody steps back")
    }

    private static func alerts() {
        let ref = EventRef.espn(path: "football/nfl", id: "9", sport: .football)
        let before = Event(id: "n", content: .match(top: comp("kc", "Chiefs", "14"), bottom: comp("buf", "Bills", "14")),
                           state: .live, start: .now, detail: "3:10 - 2nd", caption: nil, link: nil, ref: ref)
        let after = before.with(content: .match(top: comp("kc", "Chiefs", "21"), bottom: comp("buf", "Bills", "14")))
        check(Notifier.body(from: before, to: after) == "Chiefs scored · 3:10 left in the 2nd", "alert: who scored, and when",
              Notifier.body(from: before, to: after) ?? "nil")
        let kickoff = before.with(state: .scheduled)
        check(Notifier.body(from: kickoff, to: before) == "Started", "alert: a start says Started")
        let soccerRef = EventRef.espn(path: "soccer/eng.1", id: "1", sport: .soccer)
        let s0 = Event(id: "s", content: .match(top: comp("1", "Arsenal", "0"), bottom: comp("2", "Chelsea", "0")),
                       state: .live, start: .now, detail: "23'", caption: nil, link: nil, ref: soccerRef)
        let s1 = s0.with(content: .match(top: comp("1", "Arsenal", "1"), bottom: comp("2", "Chelsea", "0")))
        check(Notifier.body(from: s0, to: s1) == "Goal · 23rd minute", "alert: a goal and its minute", Notifier.body(from: s0, to: s1) ?? "nil")
        check(Notifier.body(from: s1, to: s0) == "Score updated · 23rd minute", "alert: a goal taken back isn't a goal",
              Notifier.body(from: s1, to: s0) ?? "nil")
        let ft = s1.with(state: .final, detail: .some("FT"))
        check(Notifier.body(from: s1, to: ft) == "Full time", "alert: the final whistle", Notifier.body(from: s1, to: ft) ?? "nil")
        let postponed = s0.with(state: .final, content: .match(top: comp("1", "Arsenal"), bottom: comp("2", "Chelsea")))
        check(Notifier.body(from: s0.with(state: .scheduled), to: postponed) == nil, "alert: a postponement isn't a result")
        check(ErrorCopy.title("Team") == "Can't Load Team" && ErrorCopy.retry == "Try Again"
              && ErrorCopy.message == "Check your internet connection and try again.", "one error copy everywhere")
    }

    private static func cascade() {
        check(StackIn.delay(at: .zero) == 0, "cascade: the top-left block goes first")
        check(abs(StackIn.delay(at: CGPoint(x: 0, y: 96)) - 2 * Motion.stackStep) < 1e-9, "cascade: a step per 48pt down")
        check(StackIn.delay(at: CGPoint(x: 340, y: 4000)) == Motion.stackCap, "cascade: capped, so a tall page settles fast")
        check(Motion.stackCap + 0.25 < 0.4, "cascade: a page settles in under 0.4s")
    }

    private static func flowLayout() {
        let sizes = [CGSize(width: 60, height: 10), CGSize(width: 60, height: 12), CGSize(width: 60, height: 10)]
        let rows = FlowLayout.arrange(width: 140, sizes: sizes, spacing: 12)
        check(rows.map(\.indices) == [[0, 1], [2]] && rows[0].height == 12 && rows[0].width == 132,
              "legend: wraps when the next item doesn't fit", "\(rows)")
        let wide = FlowLayout.arrange(width: 30, sizes: [CGSize(width: 60, height: 10)], spacing: 12)
        check(wide.count == 1 && wide[0].indices == [0], "legend: an item wider than the row still gets a row")
    }

    private static func helpers() {
        check(Period.label(3, sport: .basketball) == "Q3" && Period.label(5, sport: .basketball) == "OT"
              && Period.label(6, sport: .football) == "2OT" && Period.label(11, sport: .football) == "7OT",
              "periods: quarters, then OT, 2OT … 7OT")
        check(Period.label(5, sport: .football, style: .header) == "OT" && Period.label(2, sport: .football, style: .header) == "2"
              && Period.label(3, sport: .basketball, style: .ordinal) == "3rd", "periods: linescore headers and prose")
        check(Period.label(10, sport: .baseball, style: .ordinal) == "10th" && Period.label(10, sport: .baseball) == "10",
              "periods: extra innings are innings, not overtimes")
        check(plural(1, "game") == "1 game" && plural(3, "game") == "3 games" && plural(0, "team") == "0 teams"
              && plural(2, "match") == "2 matches" && plural(2, "person", plural: "people") == "2 people", "plurals agree")

        // The menu bar's width budget, measured for real.
        let ref = EventRef.espn(path: "basketball/nba", id: "1", sport: .basketball)
        let por = Competitor(id: "22", name: "Trail Blazers", abbreviation: "POR", score: "148", logo: nil, isWinner: false)
        let min = Competitor(id: "16", name: "Timberwolves", abbreviation: "MIN", score: "150", logo: nil, isWinner: false)
        let long = Event(id: "m", content: .match(top: por, bottom: min), state: .live, start: .now, detail: "0:03 - 4OT",
                         caption: nil, link: nil, ref: ref)
        check(MenuBarLabel.text(for: long) == "POR 148–150 MIN", "menu bar: past the budget, the score alone",
              MenuBarLabel.text(for: long))
        let short = long.with(content: .match(top: Competitor(id: "1", name: "Arsenal", abbreviation: "ARS", score: "2", logo: nil, isWinner: false),
                                              bottom: Competitor(id: "2", name: "Chelsea", abbreviation: "CHE", score: "1", logo: nil, isWinner: false)),
                              detail: .some("3:10 - 2nd"))
        check(MenuBarLabel.text(for: short) == "ARS 2–1 CHE · 3:10 2nd", "menu bar: the status fits, without ESPN's dash",
              MenuBarLabel.text(for: short))

        let centered = TitleBarLayout.titleFrame(width: 60, in: 0...320, leading: 80, trailing: 28, gap: 8)
        check(centered == 130...190, "header: a short title is centered on the panel", "\(centered)")
        let pushed = TitleBarLayout.titleFrame(width: 160, in: 0...320, leading: 150, trailing: 28, gap: 8)
        check(pushed.lowerBound >= 158 && pushed.upperBound <= 284, "header: a long title moves clear of Back and truncates",
              "\(pushed)")
        let noTrailing = TitleBarLayout.titleFrame(width: 100, in: 0...320, leading: 120, trailing: 0, gap: 8)
        check(noTrailing.lowerBound >= 128 && noTrailing.upperBound <= 320, "header: with nothing trailing, it may use the right side",
              "\(noTrailing)")
        check(StatusColumn.width(for: [(text: "FT", live: false)]) == Metrics.statusWidth, "status column: never under 70pt")
        let wide = StatusColumn.width(for: [(text: "Rain Delay · 2nd", live: true), (text: "FT", live: false)])
        check(wide > Metrics.statusWidth && wide <= StatusColumn.range.upperBound, "status column: widens for its widest row",
              "\(wide)")
        check(StatusColumn.width(for: [(text: String(repeating: "W", count: 30), live: false)]) == StatusColumn.range.upperBound,
              "status column: capped, so names keep their room")
    }

    /// Feed values the boards really send: suspended and delayed games, a
    /// break between quarters, emoji in a team name.
    private static func feedEdges() {
        func board(_ state: String, completed: Bool, name: String, detail: String, lastPlay: String? = nil) -> Data {
            var competition: [String: Any] = ["competitors": [
                ["homeAway": "home", "score": "4", "team": ["id": "10", "shortDisplayName": "Yankees", "abbreviation": "NYY"]],
                ["homeAway": "away", "score": "2", "team": ["id": "2", "shortDisplayName": "Red Sox", "abbreviation": "BOS"]],
            ]]
            if let lastPlay { competition["situation"] = ["lastPlay": ["type": ["text": lastPlay], "text": lastPlay]] }
            let event: [String: Any] = ["id": "77", "date": "2026-10-25T23:05Z",
                                        "status": ["type": ["state": state, "completed": completed, "name": name, "shortDetail": detail]],
                                        "competitions": [competition]]
            return try! JSONSerialization.data(withJSONObject: ["events": [event]])
        }
        let suspended = try? Providers.espnEvents(scoreboard: board("post", completed: false, name: "STATUS_SUSPENDED", detail: "Suspended"),
                                                  path: "baseball/mlb", sport: .baseball).first
        check(suspended?.competitors.map(\.score) == ["2", "4"], "a suspended game keeps its score (it resumes from there)",
              "\(suspended?.competitors.map(\.score) ?? [])")
        let postponed = try? Providers.espnEvents(scoreboard: board("post", completed: false, name: "STATUS_POSTPONED", detail: "Postponed"),
                                                  path: "baseball/mlb", sport: .baseball).first
        check(postponed?.competitors.allSatisfy { $0.score == nil } == true, "a postponed game still shows no placeholder score")
        let delayed = try? Providers.espnEvents(scoreboard: board("pre", completed: false, name: "STATUS_DELAYED", detail: "10/25 - 7:05 PM EDT"),
                                                path: "baseball/mlb", sport: .baseball).first
        check(delayed?.state == .scheduled && delayed?.detail == "Delayed" && delayed?.spokenStatus == "Delayed",
              "a delayed start says Delayed (and VoiceOver says so)", delayed?.detail ?? "nil")
        let half = try? Providers.espnEvents(scoreboard: board("in", completed: false, name: "STATUS_HALFTIME", detail: "Halftime",
                                                                lastPlay: "End of Half"),
                                             path: "football/nfl", sport: .football).first
        check(half != nil && half?.liveLine == nil, "halftime: no context line repeating the status", half?.liveLine ?? "nil")
        let quarter = try? Providers.espnEvents(scoreboard: board("in", completed: false, name: "STATUS_END_PERIOD", detail: "End of 3rd",
                                                                   lastPlay: "End Period"),
                                                path: "football/nfl", sport: .football).first
        check(quarter?.liveLine == nil, "end of a quarter: no context line repeating it", quarter?.liveLine ?? "nil")
        let kick = try? Providers.espnEvents(scoreboard: board("in", completed: false, name: "STATUS_IN_PROGRESS", detail: "12:00 - 2nd",
                                                                lastPlay: "Kickoff"),
                                             path: "football/nfl", sport: .football).first
        check(kick?.liveLine == "Kickoff", "other plays between snaps still say what happened", kick?.liveLine ?? "nil")
        check(CounterStrike.abbreviate("🐺 Wolves Esports") == "WOL" && CounterStrike.abbreviate("Natus Vincere") == "NV"
              && CounterStrike.abbreviate("G2") == "G2", "CS2 short names drop emoji", CounterStrike.abbreviate("🐺 Wolves Esports"))
    }

    private static func climbingCountries() async {
        guard let ifsc = League.with(id: "ifsc"), let options = try? await TeamCatalog.options(for: ifsc) else {
            return check(false, "climbing countries load")
        }
        let names = options.map(\.name)
        check(names == names.sorted { $0.localizedStandardCompare($1) == .orderedAscending } && names.firstIndex(of: "France")! < names.firstIndex(of: "Spain")!,
              "climbing countries are in name order", "\(names.prefix(12))")
    }
}
