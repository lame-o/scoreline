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
        check(history.events.map(\.id) == ["a", "b", "c", "d", "e"] && history.missingTimeCount == 1,
              "only reported wall times get placed; an untimed score stays unplaced")
        check(history.events[1].side == .bottom && history.keyEvents.map(\.id) == ["b"] && history.events[1].score == nil,
              "events preserve provider team identity and do not invent an absent score")
        check(history.events[2].t == origin + 60 && history.events[2].timing == .adjusted,
              "a backwards wall stamp is ordered conservatively and labeled approximate")
        let baseline = OddsBaseline.parse(summary, sport: .basketball, topID: "away", bottomID: "home")
        let placed = MatchHistory.chronology(summary, sport: .basketball)
        check(baseline.periods == history.periods && placed.map(\.t) == history.events.map(\.t),
              "the ESPN odds baseline and event history use exactly the same chronology")
        check(history.context(at: origin - 1) == nil && history.context(at: origin + 59)?.id == "a"
              && history.context(at: origin + 60)?.id == "c",
              "inspection uses the last known game clock and never the next event's state")
        check(history.event(near: origin + 61, within: 2)?.id == "c"
              && history.event(near: origin + 600, within: 90) == nil,
              "nearby event search is bounded instead of inventing activity inside a long break")
        check(history.previous(before: origin + 61)?.id == "b"
              && history.next(after: origin)?.id == "b"
              && history.previous(before: origin + 60) == nil,
              "event stepping is strict and uses meaningful markers")

        let shown = history.shown(until: origin + 30)
        check(shown.events.map(\.id) == ["a"] && shown.periods.count == 1
              && shown.periods[0].end == origin + 30 && shown.missingTimeCount == 0,
              "the broadcast boundary clips events, future periods, period ends and unplaceable-event counts")
        check(history.shown(until: origin - 1).events.isEmpty && history.shown(until: origin - 1).periods.isEmpty,
              "before the first event no future game clock or period is exposed")
        let finalDomain = history.domain(state: .final, window: .game, eventStart: origin - 900, latest: origin + 9000)
        check(finalDomain == origin...(origin + 2400),
              "final history ends at the last play, regardless of later market settlement")
        let liveDomain = history.domain(state: .live, window: .game, eventStart: origin, latest: origin + 2500)
        let recentDomain = history.domain(state: .live, window: .recent, eventStart: origin, latest: origin + 2500)
        check(liveDomain == origin...(origin + 2500) && recentDomain == (origin + 1900)...(origin + 2500),
              "Game and 10 min share the same last instant and preserve real break widths")
        let delayed = history.domain(state: .live, window: .game, eventStart: origin, latest: origin + 5000, until: origin + 30)
        check(delayed.upperBound == origin + 30 && delayed.lowerBound == origin,
              "a future market tick cannot move the domain beyond the broadcast")
        let empty = MatchHistory(sport: .soccer)
        let emptyRange = empty.domain(state: .live, window: .game, eventStart: origin, latest: nil, until: origin - 300)
        check(emptyRange.lowerBound < emptyRange.upperBound && emptyRange.upperBound == origin - 300,
              "opening before kickoff retains a valid finite domain without exposing future timestamps")
        check(empty.domain(state: .scheduled, window: .game, eventStart: origin, latest: origin - 300).upperBound == origin - 300,
              "pregame history ends at the actual latest market instant, not the scheduled kickoff")

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
        check(match.events.map(\.id) == ["kickoff", "goal", "second"] && match.events[1].kind == .goal
              && match.events[1].side == .top && match.events[1].score == "1–0",
              "reversed soccer commentary sorts by wall time and joins key events by stable play ID")
        check(match.events[1].clock == "22'" && match.events[2].clock == "45'"
              && match.events[2].t.timeIntervalSince(match.events[1].t) == 2400 && match.missingTimeCount == 1,
              "soccer keeps its game minute labels and actual halftime gap; untimed added-time goal is not guessed")
        check(match.events.map(\.id) == MatchHistory.parse(soccer, sport: .soccer, topID: "home", bottomID: "away").events.map(\.id),
              "event identities survive identical refreshes")

        let goalKick = play("goal-kick", "2026-11-01T18:05:00Z", clock: "5'", text: "Goal kick, Home.", kind: "goal-kick")
        let headerGoal = play("header-goal", "2026-11-01T18:10:00Z", clock: "10'", text: "A headed goal.", kind: "goal---header")
        let soccerKinds = MatchHistory.parse(JSON(["keyEvents": [goalKick, headerGoal]]), sport: .soccer, topID: nil, bottomID: nil)
        check(soccerKinds.events.first?.kind == .play && soccerKinds.keyEvents.map(\.id) == ["header-goal"],
              "a goal kick is not a goal marker, while the provider's headed-goal subtype is")
        var missedShot = play("missed-shot", "2026-11-01T18:15:00Z", clock: "8:00", text: "Player misses a two-point shot", score: 2)
        missedShot["scoringPlay"] = false
        let madeShot = play("made-shot", "2026-11-01T18:16:00Z", clock: "7:00", text: "Player makes a two-point shot", score: 2)
        let basketballKinds = MatchHistory.parse(JSON(["plays": [missedShot, madeShot]]), sport: .basketball, topID: nil, bottomID: nil)
        check(basketballKinds.events.first?.kind == .play && basketballKinds.keyEvents.map(\.id) == ["made-shot"],
              "an explicit non-scoring play overrides shot value; a trimmed NBA record may fall back to score value")

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
        check(nba.events.count == 552 && nba.events.contains { $0.timing == .adjusted }
              && nba.periods == nbaOdds.periods && nba.end == date("2026-10-29T02:43:59Z"),
              "real GSW–MIN: 552 events, timestamp corrections explicit, same four periods as the odds chart")
        let eplJSON = fixture("odds/espn-epl-401879252.json")
        let epl = MatchHistory.parse(eplJSON, sport: .soccer, topID: nil, bottomID: nil)
        let eplOdds = OddsBaseline.parse(eplJSON, sport: .soccer, topID: nil, bottomID: nil)
        check(epl.start == date("2026-10-25T14:00:42Z") && epl.end == date("2026-10-25T15:54:12Z")
              && epl.periods == eplOdds.periods && epl.keyEvents.filter { $0.kind == .goal }.count == 3,
              "real Man Utd–Bournemouth: kickoff through final whistle, three goals, identical wall-time periods")
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
