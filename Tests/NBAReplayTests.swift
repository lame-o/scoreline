import Foundation

// NBA court plays, possession, the live trail and the replay, checked without
// views: parsing plays for the court, the data spec's possession rule, the
// live lane spliced over the summary, what the court shows at a moment, and
// the replay's clock.

extension ScorelineTests {
    static func nbaReplay() {
        print("\nNBA court plays and replay")
        let sentinel = (x: -214748340.0, y: -214748365.0)
        func play(_ id: String, _ type: String, _ text: String, home: Int, away: Int, period: Int = 1, clock: String = "10:00",
                  team: String? = nil, scoring: Bool = false, value: Int = 0, attempted: Int = 0, shooting: Bool = false,
                  at spot: (x: Double, y: Double)? = nil, people: [String] = []) -> [String: Any] {
            var p: [String: Any] = ["id": id, "type": ["id": type, "text": type == "412" ? "End Period" : "Play"], "text": text,
                                    "homeScore": home, "awayScore": away, "period": ["number": period],
                                    "clock": ["displayValue": clock], "scoringPlay": scoring, "scoreValue": value,
                                    "pointsAttempted": attempted, "shootingPlay": shooting,
                                    "coordinate": ["x": (spot ?? sentinel).x, "y": (spot ?? sentinel).y],
                                    "participants": people.map { ["athlete": ["id": $0]] }]
            if let team { p["team"] = ["id": team] }
            return p
        }
        // LAL (13) at UTAH (26): the away team is the top team.
        let side: (String?) -> GameDetail.Side? = { $0 == "13" ? .top : $0 == "26" ? .bottom : nil }
        let raw: [[String: Any]] = [
            play("1", "615", "Rudy Gobert vs. Deandre Ayton (Luka Doncic gains possession)", home: 0, away: 0, clock: "12:00",
                 team: "13", people: ["a", "b", "77"]),
            play("2", "92", "Luka Doncic makes 26-foot three point jumper (Austin Reaves assists)", home: 0, away: 3, clock: "11:40",
                 team: "13", scoring: true, value: 3, attempted: 3, shooting: true, at: (3, 14), people: ["77", "1"]),
            play("3", "92", "Lauri Markkanen misses 20-foot jumper", home: 0, away: 3, clock: "11:20", team: "26", attempted: 2,
                 shooting: true, at: (25, 21), people: ["10"]),
            // A defensive rebound copies the miss's spot.
            play("4", "155", "Luka Doncic defensive rebound", home: 0, away: 3, clock: "11:18", team: "13", at: (25, 21), people: ["77"]),
            play("5", "62", "Luka Doncic bad pass (Keyonte George steals)", home: 0, away: 3, clock: "11:05", team: "13",
                 at: (30, 25), people: ["77", "11"]),
            play("6", "44", "Austin Reaves shooting foul", home: 0, away: 3, clock: "10:50", team: "13", at: (24, 3), people: ["1"]),
            play("7", "98", "Keyonte George misses free throw 1 of 2", home: 0, away: 3, clock: "10:50", team: "26", attempted: 1,
                 shooting: true, people: ["11"]),
            // The bookkeeping team rebound between free throws: left out.
            play("8", "156", "Jazz offensive team rebound", home: 0, away: 3, clock: "10:50", team: "26"),
            play("9", "99", "Keyonte George makes free throw 2 of 2", home: 1, away: 3, clock: "10:50", team: "26", scoring: true,
                 value: 1, attempted: 1, shooting: true, people: ["11"]),
            play("10", "584", "Jaxson Hayes enters the game for Deandre Ayton", home: 1, away: 3, clock: "10:50", team: "13"),
            play("11", "42", "Luka Doncic offensive foul", home: 1, away: 3, clock: "10:30", team: "13", at: (20, 12), people: ["77"]),
            play("12", "103", "Luka Doncic makes technical free throw", home: 1, away: 4, clock: "10:30", team: "13", scoring: true,
                 value: 1, attempted: 1, shooting: true, people: ["77"]),
            play("13", "412", "End of the 1st Quarter", home: 1, away: 4, clock: "0.0"),
        ]
        let plays = NBADetail.courtPlays(raw.map(JSON.init), side: side, topIsHome: false)
        check(plays.map(\.id) == ["1", "2", "3", "4", "5", "6", "7", "9", "11", "12", "13"],
              "court plays in game order; substitutions and the free-throw bookkeeping rebound left out", "\(plays.map(\.id))")
        let byID = Dictionary(uniqueKeysWithValues: plays.map { ($0.id, $0) })
        check(byID["1"]?.kind == .jumpBall && byID["1"]?.player == "77" && byID["1"]?.side == .top,
              "a jump ball belongs to whoever gained it")
        check(byID["2"]?.kind == .shot(made: true, value: 3) && byID["2"]?.other == "1" && byID["2"]?.top == 3 && byID["2"]?.bottom == 0,
              "a make: value, assister, and the score after it (top first)")
        check(byID["5"]?.kind == .turnover(steal: true) && byID["5"]?.other == "11", "a turnover with a stealer is a steal")
        check(byID["7"]?.kind == .freeThrow(made: false, last: false, technical: false)
              && byID["9"]?.kind == .freeThrow(made: true, last: true, technical: false)
              && byID["12"]?.kind == .freeThrow(made: true, last: true, technical: true), "free throws: which is last, which is a technical")

        // Where things happened: a defensive rebound and a defensive foul sit at the offense's end.
        check(byID["4"]?.attacking == .bottom && byID["6"]?.attacking == .bottom && byID["11"]?.attacking == .top,
              "a defensive rebound or foul is measured toward the other team's basket")
        if let spot = byID["4"]?.spot {
            check(abs(spot.x - 25) < 0.01 && abs(spot.y - 4) < 0.01, "a rebound sits 3 ft off the rim toward the miss, not at its copied spot",
                  "\(spot)")
        } else {
            check(false, "a rebound has a spot")
        }
        check(byID["9"]?.spot.map { $0 == (25, 15) } == true && byID["1"]?.positioned == true && byID["13"]?.positioned == false,
              "free throws at the line, jump balls at center court, period ends nowhere")
        check(CourtView.point(byID["1"]!) == CGPoint(x: 47, y: 25) && CourtView.ballPoint(byID["2"]!) == CourtView.rim(for: .top)
              && CourtView.ballPoint(byID["5"]!) == CourtView.court(x: 30, y: 25, attacking: .top),
              "the ball ends a shot at the rim, anything else where it happened")

        // The data spec's possession rule, play by play.
        var holder: GameDetail.Side?
        var seen: [GameDetail.Side?] = []
        for p in plays {
            holder = p.possession(after: holder)
            seen.append(holder)
        }
        let expected: [GameDetail.Side?] = [.top, .bottom, nil, .top, .bottom, .bottom, .bottom, .top, .bottom, .bottom, nil]
        check(seen == expected, "possession: jump ball, make, miss (in the air), rebound, steal, foul, free throws, offensive foul, technical, period end",
              "\(seen)")
        check(NBADetail.possession(plays.prefix(4)) == .top && NBADetail.possession(plays.prefix(3)) == nil,
              "possession after the first plays")

        // Game time.
        check(NBADetail.count(plays, through: 0) == 1 && NBADetail.count(plays, through: 70) == 8
              && NBADetail.count(plays, through: 10_000) == plays.count, "a moment includes every play at its clock (free throws share the foul's)",
              "\(NBADetail.count(plays, through: 70))")
        check(NBADetail.clockLabel(at: 0) == "Q1 12:00" && NBADetail.clockLabel(at: 720) == "Q1 0:00"
              && NBADetail.clockLabel(at: 721) == "Q2 11:59" && NBADetail.clockLabel(at: 2880) == "Q4 0:00"
              && NBADetail.clockLabel(at: 2881) == "OT 4:59", "the replay's clock: a boundary is the end of the period before")
        let line = NBADetail.line(for: "77", in: plays)
        check(line.fg == (1, 1) && line.threes == (1, 1) && line.points == 4, "a player's line from the plays (makes and free throws)")

        // The live lane spliced over the summary: its version wins from the overlap on.
        func cp(_ id: String, _ t: Double, made: Bool = false) -> GameDetail.CourtPlay {
            GameDetail.CourtPlay(id: id, kind: .shot(made: made, value: 2), side: .top, player: "p", x: 25, y: 5, period: 1,
                                 clock: "", elapsed: t, text: id, top: 0, bottom: 0)
        }
        let summary = [cp("a", 10), cp("b", 20), cp("c", 30), cp("d", 40)]
        let spliced = NBADetail.plays(summary: summary, lane: [cp("c", 30, made: true), cp("late", 35), cp("e", 50)])
        check(spliced.map(\.id) == ["a", "b", "c", "late", "e"] && spliced[2].kind == .shot(made: true, value: 2),
              "the lane replaces the summary from the overlap: edits, deletions (d) and late inserts", "\(spliced.map(\.id))")
        check(NBADetail.plays(summary: summary, lane: [cp("x", 35), cp("y", 45)]).map(\.id) == ["a", "b", "c", "d", "y"],
              "no overlap: only what's newer than the summary")

        // What the court shows.
        let final = CourtScene.make(shots: [], plays: plays, time: nil, live: false, playing: false, pinned: nil)
        check(final.style == .chart && final.trail.isEmpty && final.shots.map(\.id) == ["2", "3"] && final.newest == nil,
              "a final: every shot, no trail")
        let live = CourtScene.make(shots: [], plays: plays, time: nil, live: true, playing: false, pinned: nil)
        check(live.style == .trail && live.trail.count == CourtScene.trailLength && live.trail.last?.id == "12"
              && live.possession == nil && live.latest?.id == "12", "live: the last 8 placed plays trail to the ball",
              "\(live.trail.map(\.id))")
        let moment = CourtScene.make(shots: [], plays: plays, time: 45, live: false, playing: false, pinned: nil)
        check(moment.style == .trail && moment.shots.map(\.id) == ["2", "3"] && moment.trail.last?.id == "4"
              && moment.possession == .top && moment.newest?.id == "3" && moment.score.map { $0 == (3, 0) } == true,
              "a replay held at a moment: shots so far, the newest larger, the score then")
        let start = CourtScene.make(shots: [], plays: plays, time: -1, live: false, playing: false, pinned: nil)
        check(start.shots.isEmpty && start.score.map { $0 == (0, 0) } == true, "before tip-off: nothing yet, 0–0")
        let running = CourtScene.make(shots: [], plays: plays, time: 30, live: false, playing: true, pinned: nil)
        check(running.style == .playing && running.trail.isEmpty && running.newest?.id == "2", "a running replay: shots land, no trail")
        let picked = CourtScene.make(shots: [], plays: plays, time: nil, live: true, playing: false, pinned: "10")
        check(picked.style == .chart && picked.shots.map(\.id) == ["3"] && picked.trail.isEmpty && picked.newest?.id == "3",
              "a picked player: only their shots, newest larger while live")

        // The replay's state.
        let stage = NBAStage()
        stage.seek(600, end: 2880)
        check(stage.replaying && !stage.playing && stage.time(at: .now) == 600, "a seek holds the replay there")
        stage.seek(2880, end: 2880)
        check(!stage.replaying && stage.time(at: .now) == nil, "seeking to the end is the whole game again")
        stage.play(from: 100, end: 2880)
        let started = stage.playback?.started ?? .now
        check(stage.playing && stage.time(at: started.addingTimeInterval(1)) == 100 + NBAStage.rate
              && stage.time(at: started.addingTimeInterval(1000)) == 2880, "playing: time from the frame's date, stopping at the end")
        check(abs(2880 / NBAStage.rate - 24) < 0.001, "regulation replays in 24 seconds")
        stage.pause(at: started.addingTimeInterval(2))
        check(!stage.playing && stage.time(at: .now) == 100 + 2 * NBAStage.rate, "pausing holds where it was")
        stage.togglePin("77")
        let pinned = stage.pinned
        stage.togglePin("77")
        check(pinned == "77" && stage.pinned == nil, "a second click on the same player clears the pick")
        stage.togglePin("77")
        stage.reset()
        check(stage.pinned == nil && !stage.replaying, "a new game starts clean")

        // Box score columns by width (spec §6.10).
        check(BoxScoreView.columns(for: .compact).map(\.label) == ["MIN", "PTS", "REB", "AST", "+/-"]
              && BoxScoreView.columns(for: .medium).map(\.label) == ["MIN", "PTS", "FG", "3PT", "REB", "AST", "+/-"]
              && BoxScoreView.columns(for: .large).count == 10 && BoxScoreView.columns(for: .xlarge).count == 12,
              "box score: FG and 3PT from medium, FT/STL/BLK from large, TO/PF at xlarge")

        // The game flow's story line.
        func fp(_ id: String, _ top: Int, _ bottom: Int) -> GameDetail.FlowPoint {
            GameDetail.FlowPoint(id: id, elapsed: 0, top: top, bottom: bottom, period: 1, clock: "")
        }
        let story = GameFlowView.story([fp("tip", 0, 0), fp("a", 2, 0), fp("b", 2, 2), fp("c", 2, 5), fp("d", 6, 5), fp("e", 6, 6)])
        check(story.changes == 2 && story.ties == 2 && story.top == 2 && story.bottom == 3,
              "game flow: lead changes, ties and each side's largest lead", "\(story)")
    }
}
