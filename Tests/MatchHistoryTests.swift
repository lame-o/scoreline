import Foundation

extension ScorelineTests {
    static func matchHistory() {
        print("\nMatch history")
        func fixture(_ name: String) -> JSON {
            JSON(data: (try? Data(contentsOf: URL(fileURLWithPath: "Tests/Fixtures/\(name)"))) ?? Data())
        }
        func date(_ s: String) -> Date { DateParser.parse(s) ?? .distantPast }
        let origin = date("2026-11-01T18:00:00Z")
        func play(_ id: String, _ stamp: String?, period: Int = 1, clock: String = "12:00", text: String = "A play",
                  kind: String = "play", team: String? = nil, score: Int = 0) -> [String: Any] {
            var value: [String: Any] = ["id": id, "period": ["number": period], "clock": ["displayValue": clock],
                                        "text": text, "type": ["type": kind], "scoreValue": score]
            if let stamp { value["wallclock"] = stamp }
            if let team { value["team"] = ["id": team] }
            return value
        }
        let a = play("a", "2026-11-01T18:00:00Z", text: "Opening play")
        let b = play("b", "2026-11-01T18:01:00Z", clock: "11:30", text: "Home team scores", team: "home", score: 2)
        let c = play("c", "2026-11-01T18:00:50Z", clock: "11:20", text: "Clock correction")
        let d = play("d", "2026-11-01T18:20:00Z", period: 2, text: "Second period begins")
        let e = play("e", "2026-11-01T18:40:00Z", period: 2, clock: "0:00", text: "End of game")
        let missing = play("missing", nil, clock: "10:00", text: "Untimed score", score: 3)
        let header: [String: Any] = ["competitions": [["competitors": [
            ["team": ["id": "away"], "homeAway": "away"], ["team": ["id": "home"], "homeAway": "home"]
        ]]]]
        let summary = JSON(["header": header, "plays": [a, b, c, missing, d, e]])
        let history = MatchHistory.parse(summary, sport: .basketball, topID: "away", bottomID: "home")
        check(history.events.map(\.id) == ["a", "b", "c", "d", "e"],
              "only reported wall times get placed; an untimed score stays unplaced")
        check(history.events[1].side == .bottom, "events preserve provider team identity")
        check(history.events[2].t == origin + 60, "a backwards wall stamp is ordered conservatively")
        let baseline = OddsBaseline.parse(summary, sport: .basketball, topID: "away", bottomID: "home")
        let placed = MatchHistory.chronology(summary, sport: .basketball)
        check(baseline.periods == history.periods && placed.map(\.t) == history.events.map(\.t),
              "the ESPN odds baseline and event history use exactly the same chronology")
        check(history.time(of: "b") == origin + 60 && history.time(of: "b-run") == origin + 60 && history.time(of: "nope") == nil,
              "a play's time by its ID; an NBA run's moment is its last basket")

        let shown = history.shown(until: origin + 30)
        check(shown.events.map(\.id) == ["a"] && shown.periods.count == 1 && shown.periods[0].end == origin + 30,
              "the broadcast boundary clips events, future periods and period ends")
        check(history.shown(until: origin - 1).events.isEmpty && history.shown(until: origin - 1).periods.isEmpty,
              "before the first event no future game clock or period is exposed")
        check(history.shown(until: origin + 9000) == history, "nothing past the boundary: the history as it is")
        let finalDomain = history.domain(state: .final, window: .game, eventStart: origin - 900, latest: origin + 9000)
        check(finalDomain == origin...(origin + 2400),
              "final history ends at the last play, regardless of later market settlement")

        // A live axis is the game's usual length, and doesn't move as the game goes on.
        let pace = history.pace.game
        let early = history.shown(until: origin + 600), later = history.shown(until: origin + 2000)
        let earlyDomain = early.domain(state: .live, window: .game, eventStart: origin, latest: origin + 590, until: origin + 600)
        let laterDomain = later.domain(state: .live, window: .game, eventStart: origin, latest: origin + 1990, until: origin + 2000)
        check(earlyDomain == origin...(origin + pace) && laterDomain == earlyDomain,
              "a live game's axis stays put: first play to its usual length, however far it's got")
        check(early.now(eventStart: origin, latest: origin + 590, until: origin + 600) == origin + 600
              && history.now(eventStart: origin, latest: origin + 2500) == origin + 2500,
              "now: what's presented, or without a broadcast the newest thing heard")
        let long = history.domain(state: .live, window: .game, eventStart: origin, latest: origin + pace + 60)
        let longer = history.domain(state: .live, window: .game, eventStart: origin, latest: origin + pace + 120)
        check(long.upperBound == origin + pace + 900 && longer == long,
              "past its usual length (overtime, a delay) it grows by a quarter hour, not a tick at a time")
        let recentDomain = history.domain(state: .live, window: .recent, eventStart: origin, latest: origin + 2500)
        check(recentDomain == (origin + 1900)...(origin + 2500), "10 min slides with the newest moment")
        let delayed = history.domain(state: .live, window: .game, eventStart: origin, latest: origin + 5000, until: origin + 30)
        check(delayed == origin...(origin + pace) && history.now(eventStart: origin, latest: origin + 5000, until: origin + 30) == origin + 30,
              "a future market tick cannot move the axis or the now line past the broadcast")
        let empty = MatchHistory(sport: .soccer)
        let emptyRange = empty.domain(state: .live, window: .game, eventStart: origin, latest: nil, until: origin - 300)
        check(emptyRange.lowerBound < emptyRange.upperBound && emptyRange.lowerBound == origin - 301,
              "opening before kickoff retains a valid finite domain without exposing future timestamps")

        // Zoomed to a period, both modules ask the same function.
        let firstPeriod = history.domain(state: .final, window: .period(1), eventStart: origin)
        check(firstPeriod == origin...(origin + 60), "a final's period runs from its first play to its last")
        let secondLive = history.domain(state: .live, window: .period(2), eventStart: origin, latest: origin + 2410)
        check(secondLive.lowerBound == origin + 1200 && secondLive.upperBound == origin + 1200 + pace / Double(history.pace.periods),
              "the period under way is its usual length, like the game's")
        check(history.domain(state: .final, window: .period(9), eventStart: origin) == finalDomain,
              "a period the game doesn't have: the whole game")
        check(OddsWindow.recent.effective(in: .final) == .game && OddsWindow.period(2).effective(in: .final) == .period(2)
              && OddsWindow.period(2).effective(in: .scheduled) == .game && OddsWindow.recent.effective(in: .live) == .recent,
              "only a live game has a last 10 minutes; a final zooms; before the game, nothing to zoom to")

        // One late stamp never drags the plays after it to its time.
        let t0 = origin
        let late = MatchHistory.placed([t0, t0 + 10, t0 + 300, t0 + 20, t0 + 30, t0 + 40, t0 + 310])
        check(late == [t0, t0 + 10, t0 + 20, t0 + 20, t0 + 30, t0 + 40, t0 + 310],
              "a forward stamp moves to its neighbors; the plays after it keep their own times, no pile-up")
        check(MatchHistory.inOrder([t0, t0 + 60, t0 + 50, t0 + 1200]) == [true, true, false, true],
              "between runs of the same length, the earlier play stands")
        check(MatchHistory.placed([]) == [] && MatchHistory.placed([t0]) == [t0], "no plays, one play")
        let ordered = (0..<50).map { t0 + Double($0) }
        check(MatchHistory.placed(ordered) == ordered, "stamps in order stand as reported")

        // Soccer commentary can be reversed, while keyEvents supplies type
        // and team metadata for the very same play ID.
        let kickoff = play("kickoff", "2026-11-01T18:00:00Z", clock: "", text: "First Half begins.", kind: "kickoff")
        let goal = play("goal", "2026-11-01T18:22:00Z", clock: "22'", text: "Goal! Home 1, Away 0.")
        let second = play("second", "2026-11-01T19:02:00Z", period: 2, clock: "45'", text: "Second Half begins.")
        var keyGoal = goal
        keyGoal["type"] = ["type": "goal"]
        keyGoal["team"] = ["id": "home"]
        keyGoal["homeScore"] = 1
        keyGoal["awayScore"] = 0
        let untimedGoal = play("untimed", nil, period: 2, clock: "90'+3'", text: "Untimed goal", kind: "goal")
        let soccer = JSON(["header": header, "commentary": [second, goal, kickoff].map { ["play": $0, "text": $0["text"]!] },
                           "keyEvents": [keyGoal, untimedGoal]])
        let match = MatchHistory.parse(soccer, sport: .soccer, topID: "home", bottomID: "away")
        check(match.events.map(\.id) == ["kickoff", "goal", "second"] && match.events[1].side == .top,
              "reversed soccer commentary sorts by wall time and joins key events by stable play ID")
        check(match.events[1].clock == "22'" && match.events[2].clock == "45'"
              && match.events[2].t.timeIntervalSince(match.events[1].t) == 2400,
              "soccer keeps its game minute labels and actual halftime gap; untimed added-time goal is not guessed")
        check(match.events.map(\.id) == MatchHistory.parse(soccer, sport: .soccer, topID: "home", bottomID: "away").events.map(\.id),
              "event identities survive identical refreshes")

        let football = JSON(["drives": ["previous": [["plays": [a, b]]], "current": ["plays": [b, d]]]])
        let nfl = MatchHistory.parse(football, sport: .football, topID: "away", bottomID: "home")
        check(nfl.events.map(\.id) == ["a", "b", "d"] && nfl.events.last?.clock == "Q2 12:00",
              "NFL and college drive/current-drive overlap does not duplicate timeline events")
        var inning = b
        inning["period"] = ["number": 10, "type": "bottom"]
        let mlb = MatchHistory.parse(JSON(["plays": [inning]]), sport: .baseball, topID: "away", bottomID: "home")
        check(mlb.events.first?.clock == "Bot 10th" && mlb.periods.first?.label == "10",
              "baseball uses inning/half-inning labels including extra innings")
        let college = MatchHistory.parse(summary, sport: .basketball, topID: "away", bottomID: "home", path: "basketball/mens-college-basketball")
        check(college.periods.map(\.label) == ["H1", "H2"], "college basketball labels halves without relabeling NBA/WNBA quarters")
        check(MatchHistory.parse(summary, sport: .esports, topID: nil, bottomID: nil).events.isEmpty
              && MatchHistory.parse(summary, sport: .climbing, topID: nil, bottomID: nil).events.isEmpty,
              "providers without absolute event times do not fabricate market-aligned CS/climbing history")

        // Real recorded games exercise hundreds of timestamps, including
        // provider regressions and soccer's halftime gap.
        let nbaJSON = fixture("odds/espn-nba-401909888.json")
        let nba = MatchHistory.parse(nbaJSON, sport: .basketball, topID: "9", bottomID: "16")
        let nbaOdds = OddsBaseline.parse(nbaJSON, sport: .basketball, topID: "9", bottomID: "16")
        let stamps = nbaJSON["plays"].array.compactMap { DateParser.parse($0["wallclock"].string) }
        let moved = zip(stamps, nba.events.map(\.t)).filter { $0 != $1 }.count
        check(nba.events.count == 552 && moved > 0 && moved < 23 && zip(nba.events, nba.events.dropFirst()).allSatisfy { $0.t <= $1.t }
              && nba.periods == nbaOdds.periods && nba.end == date("2026-10-29T02:43:59Z"),
              "real GSW–MIN: 552 events in order, only the plays out of order moved, same four periods as the odds chart", "\(moved) moved")
        let eplJSON = fixture("odds/espn-epl-401879252.json")
        let epl = MatchHistory.parse(eplJSON, sport: .soccer, topID: nil, bottomID: nil)
        let eplOdds = OddsBaseline.parse(eplJSON, sport: .soccer, topID: nil, bottomID: nil)
        check(epl.start == date("2026-10-25T14:00:42Z") && epl.end == date("2026-10-25T15:54:12Z")
              && epl.periods == eplOdds.periods,
              "real Man Utd–Bournemouth: kickoff through final whistle, identical wall-time periods")
        check(Set(epl.events.map(\.id)).count == epl.events.count
              && zip(epl.events, epl.events.dropFirst()).allSatisfy { $0.t <= $1.t },
              "real soccer commentary/key-event overlap keeps one monotonic event per provider ID")
        let nflFixture = fixture("nfl-cle-pit-halftime.json")
        let actualNFL = MatchHistory.parse(JSON(["plays": nflFixture["items"].array.compactMap(\.raw)]), sport: .football, topID: nil, bottomID: nil)
        check(!actualNFL.events.isEmpty && actualNFL.periods.map(\.number) == [1, 2],
              "recorded Browns–Steelers halftime contains the correct first two quarters")
        let mlbFixture = fixture("ws-g5-plays.json")
        let actualMLB = MatchHistory.parse(JSON(["plays": mlbFixture["items"].array.compactMap(\.raw)]), sport: .baseball, topID: nil, bottomID: nil)
        check(!actualMLB.events.isEmpty && actualMLB.periods.count == 9,
              "recorded World Series history preserves all nine innings")
        let nflSummary = fixture("odds/espn-nfl-401873029.json")
        let turnovers = MatchHistory.parse(nflSummary, sport: .football, topID: "13", bottomID: "20").events.filter(\.turnover)
        check(turnovers.count == 1 && turnovers.first?.side == .bottom && turnovers.first?.text.contains("INTERCEPTED") == true,
              "real Raiders–Jets: the interception, in the lane of the team that threw it", "\(turnovers)")
        for (name, sample) in [("soccer", epl), ("NBA", nba), ("NFL", actualNFL), ("MLB", actualMLB), ("college", college)] {
            let domain = sample.domain(state: .final, window: .game, eventStart: origin)
            let oddsLayout = OddsLayout(size: CGSize(width: 500, height: 170), plotHeight: 150, domain: domain, labelWidth: 70)
            let timelineLayout = OddsLayout(size: CGSize(width: 500, height: 100), plotHeight: 80, domain: domain, labelWidth: 70)
            check(sample.events.allSatisfy { abs(oddsLayout.x($0.t) - timelineLayout.x($0.t)) < 0.0001 }
                  && oddsLayout.plot.minX == timelineLayout.plot.minX && oddsLayout.plot.maxX == timelineLayout.plot.maxX,
                  "\(name): separate odds/event modules map every timestamp to the identical horizontal coordinate")
        }
    }
}
