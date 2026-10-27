import Foundation

// NBA polish (wave 3): the live linescore's T column from the lane, the
// on-fire threshold and its milestones (tuned on the data spec's recorded
// games; the recorded NY at BOS game checks the rate), the last-name
// fallback for narrow columns, and the possession state the hero and the
// docked scorebar read from the live lane.

extension ScorelineTests {
    static func nbaPolish() {
        print("\nNBA polish")
        let sentinel = (x: -214748340.0, y: -214748365.0)
        func play(_ id: String, _ type: String = "92", home: Int = 0, away: Int = 0, period: Int = 1, clock: String = "10:00",
                  team: String? = nil, scoring: Bool = false, value: Int = 0, attempted: Int = 0, shooting: Bool = false,
                  at spot: (x: Double, y: Double)? = nil, people: [String] = []) -> JSON {
            var p: [String: Any] = ["id": id, "type": ["id": type, "text": type == "402" ? "End Game" : "Play"], "text": "play \(id)",
                                    "homeScore": home, "awayScore": away, "period": ["number": period],
                                    "clock": ["displayValue": clock], "scoringPlay": scoring, "scoreValue": value,
                                    "pointsAttempted": attempted, "shootingPlay": shooting,
                                    "coordinate": ["x": (spot ?? sentinel).x, "y": (spot ?? sentinel).y],
                                    "participants": people.map { ["athlete": ["id": $0]] }]
            if let team { p["team"] = ["id": team] }
            return JSON(p)
        }
        // LAL (13) at UTAH (26): the away team is the top team.
        let lakers = BasketballFeed.Teams(topIsHome: false, topID: "13", bottomID: "26", topName: "LAL", bottomName: "UTAH")

        // MARK: Live linescore

        let summary = GameDetail.Linescore(headers: ["1", "2", "3", "T"], top: ["30", "25", "10", "65"], bottom: ["28", "27", "8", "63"])
        let ahead = NBADetail.linescore(summary, lane: (top: 69, bottom: 63), period: 3)
        check(ahead.top == ["30", "25", "14", "69"] && ahead.bottom == ["28", "27", "8", "63"] && ahead.headers == summary.headers,
              "live linescore: T is the lane's score, and the points since go to the current quarter", "\(ahead.top) \(ahead.bottom)")
        let nextQuarter = NBADetail.linescore(summary, lane: (top: 67, bottom: 63), period: 4)
        check(nextQuarter.top == ["30", "25", "10", "67"] && nextQuarter.headers == summary.headers,
              "across a break (the lane's in a quarter the summary hasn't opened) only T moves", "\(nextQuarter.top)")
        let behind = NBADetail.linescore(summary, lane: (top: 63, bottom: 63), period: 3)
        check(behind.top == summary.top && behind.bottom == summary.bottom, "a lane behind the summary changes nothing")
        let overtime = GameDetail.Linescore(headers: ["1", "2", "3", "4", "OT", "T"], top: ["30", "25", "20", "25", "2", "102"],
                                            bottom: ["28", "27", "22", "23", "0", "100"])
        let ot = NBADetail.linescore(overtime, lane: (top: 102, bottom: 103), period: 5)
        check(ot.top.suffix(2) == ["2", "102"] && ot.bottom.suffix(2) == ["3", "103"], "in overtime the OT cell takes the points",
              "\(ot.bottom)")
        let baseball = GameDetail.Linescore(headers: ["1", "2", "R", "H", "E"], top: ["0", "1", "1", "4", "0"], bottom: ["2", "0", "2", "5", "1"])
        check(NBADetail.linescore(baseball, lane: (top: 9, bottom: 9), period: 2).top == baseball.top,
              "a linescore that doesn't end in T is left alone")

        let feed = BasketballFeed()
        // UTAH (home, bottom) score in Q1: the lane's 0–5 against a summary that has 0–2.
        let early: [JSON] = [
            play("1", "615", team: "13", people: ["x", "y", "p"]),
            play("2", home: 2, clock: "11:30", team: "26", scoring: true, value: 2, attempted: 2, shooting: true, at: (25, 5), people: ["a"]),
            play("3", "62", home: 2, clock: "11:10", team: "13", at: (30, 20), people: ["p"]),
            play("4", home: 5, clock: "10:50", team: "26", scoring: true, value: 3, attempted: 3, shooting: true, at: (3, 5), people: ["a"]),
        ]
        feed.ingest(early, start: 0, teams: lakers)
        let q1 = GameDetail.Linescore(headers: ["1", "T"], top: ["0", "0"], bottom: ["2", "2"])
        let laned = feed.linescore(q1, topIsHome: false)
        check(feed.period == 1 && laned.top == ["0", "0"] && laned.bottom == ["5", "5"],
              "the feed puts its own score (top first) and period into the summary's linescore", "\(laned.bottom)")
        let ended = BasketballFeed()
        ended.ingest(early + [play("9", "402", home: 5, period: 4, clock: "0.0")], start: 0, teams: lakers)
        check(ended.linescore(q1, topIsHome: false).bottom == ["2", "2"], "once the game isn't on, the summary's linescore stands")

        // MARK: On fire

        check(NBADetail.fireStreak == 4 && (3...10).map(NBADetail.isFireMilestone) == [false, true, false, true, false, true, false, true],
              "on fire at four straight; news at 4, 6, 8… (quiet between)")
        let makes: [JSON] = (1...7).map { n in
            play("m\(n)", home: 2 * n, clock: String(format: "%d:00", 11 - n), team: "26", scoring: true, value: 2, attempted: 2,
                 shooting: true, at: (25, 5), people: ["a"])
        }
        func accent(after count: Int) -> LiveMoment? {
            BasketballFeed.moment(at: count - 1, in: Array(makes.prefix(count)), teams: lakers, fromTipOff: true)
        }
        check(accent(after: 4)?.accents.contains(.onFire) == true && accent(after: 5)?.accents.contains(.onFire) == false
              && accent(after: 6)?.accents.contains(.onFire) == true && accent(after: 6)?.detail.hasSuffix("· 6 straight") == true
              && accent(after: 7)?.accents.contains(.onFire) == false,
              "a 4th and 6th straight make celebrate the flame; the 5th and 7th are plain makes")
        let hot = BasketballFeed()
        hot.ingest(Array(makes.prefix(5)), start: 0, teams: lakers)
        check(hot.streaks == ["a": 5], "the flame stays lit between milestones (5 straight)", "\(hot.streaks)")
        let warm = BasketballFeed()
        warm.ingest(Array(makes.prefix(3)), start: 0, teams: lakers)
        check(warm.streaks.isEmpty, "three straight isn't a flame")

        // The rate on a recorded game (NY at BOS): at three straight, 11 makes carried the
        // flame; at four with milestones, 2 (Towns' 4th, Tatum's 4th). The data spec's 41
        // games average 3.8 (median 3), against 12.9 at three.
        if let data = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("nba-plays-401909095.json")) {
            let game = JSON(data: data)["items"].array
            let celtics = BasketballFeed.Teams(topIsHome: false, topID: "18", bottomID: "2", topName: "NY", bottomName: "BOS")
            let fired = game.indices.compactMap { i in
                BasketballFeed.moment(at: i, in: game, teams: celtics, fromTipOff: true).flatMap { $0.accents.contains(.onFire) ? i : nil }
            }
            check(fired == [148, 450], "a recorded game: two flames (Towns at Q2 9:20, Tatum at Q4 0:30)", "\(fired)")
        } else {
            check(false, "the recorded game loads")
        }

        // MARK: Names

        check(NBADetail.lastName("C. Cunningham") == "Cunningham" && NBADetail.lastName("S. Gilgeous-Alexander") == "Gilgeous-Alexander"
              && NBADetail.lastName("J. Jackson Jr.") == "Jackson Jr." && NBADetail.lastName("Nikola Jokić") == "Nikola Jokić"
              && NBADetail.lastName("") == "" && NBADetail.lastName("D. White") == "White",
              "the surname fallback drops only a leading initial")

        // MARK: Possession for the hero and the docked scorebar

        let ball = BasketballFeed()
        let trip: [JSON] = [
            play("1", "615", team: "13", people: ["x", "y", "p"]),                                    // LAL win the tip
            play("2", team: "13", attempted: 2, shooting: true, at: (25, 10), people: ["p"]),        // a miss: in the air
        ]
        ball.ingest(trip, start: 0, teams: lakers)
        check(ball.possession == .top && ball.ballInAir && ball.ballHolder == nil,
              "a shot in the air: possession is the shooting team's, and the glyph (ballHolder) hides")
        ball.ingest(trip + [play("3", "155", clock: "9:50", team: "26", at: (25, 10), people: ["r"])], start: 0, teams: lakers)
        check(ball.possession == .bottom && !ball.ballInAir && ball.ballHolder == .bottom, "the rebound decides it: UTAH's ball")
        let late: [JSON] = [
            play("1", home: 98, away: 100, period: 4, clock: "4:40", team: "13"),
            play("2", home: 100, away: 100, period: 4, clock: "4:30", team: "26", scoring: true, value: 2, attempted: 2,
                 shooting: true, at: (25, 5), people: ["a"]),
        ]
        let close = BasketballFeed()
        close.ingest(late, start: 0, teams: lakers)
        check(close.clutch && close.ballHolder == .top, "tied with 4:30 left in the 4th: clutch, and LAL's ball after the make")
        close.ingest(late + [play("3", "402", home: 100, away: 100, period: 4, clock: "0.0")], start: 0, teams: lakers)
        check(!close.playing && close.possession == nil && !close.ballInAir && close.ballHolder == nil && !close.clutch,
              "after End of Game: no possession, no ball in the air, no clutch")
    }
}

/// Test-only: who has the ball once the rebound decides it (nobody while a
/// shot is in the air), the rule the possession checks are written against.
extension BasketballFeed {
    var ballHolder: GameDetail.Side? { ballInAir ? nil : possession }
}
