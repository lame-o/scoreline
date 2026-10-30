import SwiftUI

// Click a play, watch it (Replays.swift, ReplayWell.swift), checked on real
// games: which rows of a game page replay in the isometric view, per sport
// (the World Series game's summary, Monday Night Football's core plays, the
// Spurs at the Jazz, Aston Villa v Man City as the soccer feed reads it);
// that each replay's scene is the one the live theater builds for the same
// play; the takes it plays and which way they face; the open row; and the
// running order of a replay's takes.

extension ScorelineTests {
    static func replays() async {
        print("\nReplays")
        replayOpening()
        replayClock()
        baseballReplays()
        footballReplays()
        basketballReplays()
        await soccerReplays()
    }

    private static func fixtureJSON(_ name: String) -> JSON? {
        (try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent(name))).map { JSON(data: $0) }
    }

    // MARK: The open row

    static func replayOpening() {
        var o = ReplayOpening()
        let first = ReplayRow(section: .moments, play: "1"), same = ReplayRow(section: .plays, play: "1"),
            other = ReplayRow(section: .moments, play: "2")
        o.toggle(first)
        check(o.row == first, "a click opens its row")
        o.toggle(other)
        check(o.row == other, "opening another row closes the first: one open at a time")
        o.toggle(other)
        check(o.row == nil, "the open row, clicked again, closes")
        o.toggle(first)
        o.toggle(same)
        check(o.row == same, "the same play in the other list is a row of its own")
        check(o.close() && o.row == nil && !o.close(), "Esc closes it (and says so only when something was open)")
        o.toggle(other)
        o.keep { $0 != "2" }
        check(o.row == nil, "a row whose play can't replay any more closes")
        o.toggle(first)
        o.keep { _ in true }
        check(o.row == first, "…and one that still can stays open")

        func event(_ ref: EventRef) -> Event {
            Event(id: "e", content: .match(top: comp("1", "A"), bottom: comp("2", "B")), state: .final, start: .now, detail: nil,
                  caption: nil, link: nil, ref: ref)
        }
        check(PageReplays(event(.espn(path: "soccer/eng.1", id: "1", sport: .soccer))).supported
              && PageReplays(event(.espn(path: NBADetail.path, id: "1", sport: .basketball))).supported
              && !PageReplays(event(.espn(path: "basketball/wnba", id: "1", sport: .basketball))).supported
              && !PageReplays(event(.counterStrike(slug: "x", tournament: nil))).supported,
              "the four sports with an isometric view keep the glyph's place from the start; the others never do")
    }

    // MARK: Running order

    static func replayClock() {
        func near(_ p: (take: Int, t: Double), _ take: Int, _ t: Double) -> Bool {
            p.take == take && (t.isInfinite ? p.t.isInfinite : abs(p.t - t) < 1e-9)
        }
        let one = ReplayClock(lengths: [4])
        check(one.end == 4 && near(one.position(0), 0, 0) && near(one.position(2.5), 0, 2.5) && near(one.position(4), 0, .infinity),
              "one take: it plays from its start, then holds as it ended")
        let two = ReplayClock(lengths: [5, 2])
        check(abs(two.end - 7.3) < 1e-9 && near(two.position(4.9), 0, 4.9) && near(two.position(5.1), 1, -0.2) && near(two.position(5.3), 1, 0)
              && near(two.position(7.2), 1, 1.9) && near(two.position(9), 1, .infinity),
              "a touchdown, then its try a breath (0.3 s) after, its formation standing through it; held at the try's end",
              "\(two.position(5.1)) \(two.position(5.3))")
    }

    // MARK: Baseball

    static func baseballReplays() {
        guard let summary = fixtureJSON("3bd207fad0c0e7da8976ca99.bin") else { return check(false, "MLB summary fixture loads") }
        let plays = summary["plays"].array
        // TB (30) visiting, the top team; MIL (8) at home.
        func side(_ id: String?) -> GameDetail.Side? { id == "30" ? .top : id == "8" ? .bottom : nil }
        let results = plays.indices.filter { plays[$0]["type"]["type"].string == "play-result" }
        // The page's rows: the scoring list, and the last four results (the plays list).
        let scoring = results.filter { plays[$0]["scoringPlay"].bool == true }
        let recent = Array(results.suffix(4))
        let rows = Set((scoring + recent).compactMap { plays[$0]["id"].string })
        let built = Replays.baseball(plays, ids: rows, side: side, names: [:])
        let drawable = Set((scoring + recent).filter { PlayScene.parse(plays, at: $0, side: side) != nil }.compactMap { plays[$0]["id"].string })
        check(Set(built.keys) == drawable && !built.isEmpty, "a row replays exactly when its result is a play on the field the theater parses",
              "\(built.count) built, \(drawable.count) drawable of \(rows.count)")
        check(scoring.allSatisfy { built[plays[$0]["id"].string ?? ""] != nil },
              "every scoring play replays (\(scoring.count))")
        let substitution = recent.first { (plays[$0]["text"].string ?? "").contains(" hit for ") }
        check(substitution.map { built[plays[$0]["id"].string ?? ""] == nil } == true,
              "a pinch hitter's line (\"Williamson hit for Walls\") isn't a play: its row stays as it is")
        // The live path: the lane's theater on the plays as they stood (up to the next play), the field it leaves.
        let same = built.allSatisfy { id, replay in
            guard let i = results.firstIndex(where: { plays[$0]["id"].string == id }) else { return false }
            let end = i + 1 < results.count ? results[i + 1] : plays.count
            let live = BaseballFeed.theater(Array(plays[..<end]), after: TheaterState(), primed: true, now: .now, names: [:], side: side)
            guard let play = live.play else { return false }
            return replay.scene == .baseball(play, rest: PlayTheater.rest(after: play, bases: nil, bats: live.bats, batting: nil))
                && replay.moment == BaseballFeed.moment(plays[results[i]], side: side)
        }
        check(same, "each replay is the scene, the field and the moment the live lane builds for the same play")
        let third = built.values.compactMap { r -> (PlayScene, PlayScript.Rest)? in
            if case let .baseball(p, rest) = r.scene, p.endsInning { return (p, rest) } else { return nil }
        }.first
        let middle = built.values.compactMap { r -> (PlayScene, PlayScript.Rest)? in
            if case let .baseball(p, rest) = r.scene, !p.endsInning { return (p, rest) } else { return nil }
        }.first
        check(third.map { $0.1.swapped && $0.1.bases == [false, false, false] } == true
              && middle.map { $0.1.bases == $0.0.basesAfter && !$0.1.swapped } == true,
              "a third out leaves the sides changing; any other play leaves its own runners on base")
        check(built.values.allSatisfy { r in
            if case .baseball = r.scene { return ReplayTake.takes(r.scene, flipped: true, lineups: [:], topIsHome: false).count == 1 }
            return false
        }, "a baseball play is one take (the diamond never turns)")
    }

    // MARK: Football

    static func footballReplays() {
        guard let items = fixtureJSON("mnf-dal-phi-plays.json")?["items"].array else { return check(false, "MNF plays fixture loads") }
        // DAL (6) visiting, the top team; PHI (21) at home.
        let teams = FootballFeed.Teams(topIsHome: false, topID: "6", bottomID: "21", homeAbbreviation: "PHI", awayAbbreviation: "DAL")
        let scoring = items.filter { $0["scoringPlay"].bool == true }.compactMap { $0["id"].string }
        let timeout = items.first { ($0["type"]["text"].string ?? "").contains("Timeout") }?["id"].string
        let built = Replays.football(items, ids: Set(scoring + [timeout].compactMap { $0 }), teams: teams, charts: [:])
        check(!scoring.isEmpty && Set(built.keys) == Set(scoring), "every scoring play replays (\(scoring.count)): each is a snap or a kick",
              "\(built.count) of \(scoring.count)")
        check(timeout.map { built[$0] == nil } == true, "a timeout isn't a snap: not a replay")
        // The live path: the lane spots each new snap from the one before, watched from the kickoff.
        func sequence(_ i: JSON) -> Double { Double(i["sequenceNumber"].string ?? "") ?? 0 }
        var shown: FootballScene?
        var live: [String: FootballScene] = [:]
        for item in items.enumerated().sorted(by: { (sequence($0.element), $0.offset) < (sequence($1.element), $1.offset) }).map(\.element) {
            guard let snap = FootballScene.parse(item, teams: teams) else { continue }
            shown = FootballFeed.spot([snap], after: shown).last
            live[snap.id] = shown
        }
        check(built.allSatisfy { id, r in r.scene == .football(live[id]!) },
              "each replay is the snap the live lane builds, on the hash the snaps before it put it")
        check(built.values.allSatisfy { $0.moment?.tier == .score }, "…with its scoring moment, what its celebration answers")
        guard let touchdown = built.values.compactMap({ r -> FootballScene? in
            if case let .football(s) = r.scene, s.conversion != nil { return s } else { return nil }
        }).first else { return check(false, "a touchdown with its try") }
        let takes = ReplayTake.takes(.football(touchdown), flipped: false, lineups: [:], topIsHome: false)
        let turned = ReplayTake.takes(.football(touchdown), flipped: true, lineups: [:], topIsHome: false)
        func yaw(_ take: ReplayTake) -> Double? { if case let .football(_, s) = take { return s.yaw } else { return nil } }
        func id(_ take: ReplayTake) -> String? { if case let .football(s, _) = take { return s.id } else { return nil } }
        check(takes.count == 2 && id(takes[1]) == touchdown.id + "-try", "a touchdown plays, then its try, as the live theater follows it")
        check(yaw(takes[0]) == FieldFacing.yaw(touchdown.offense, period: touchdown.period, flipped: false)
              && yaw(turned[0]) == FieldFacing.yaw(touchdown.offense, period: touchdown.period, flipped: true) && yaw(takes[0]) != yaw(turned[0]),
              "it faces the way the game's turn of the field puts it for the play's quarter, as live")
    }

    // MARK: Basketball

    static func basketballReplays() {
        guard let items = fixtureJSON("nba-every-play-401909890.json")?["games"][0]["items"].array else {
            return check(false, "NBA every-play fixture loads")
        }
        let teams = BasketballFeed.Teams(topIsHome: false, topID: "24", bottomID: "26", topName: "SA", bottomName: "UTAH")
        let ids = Set(items.compactMap { $0["id"].string })
        let built = Replays.basketball(items, ids: ids, teams: teams)
        let marquee = Set(items.indices.compactMap { i in BasketballScene.parse(items, at: i, teams: teams).flatMap { $0.replays ? $0.id : nil } })
        check(!built.isEmpty && Set(built.keys) == marquee, "a play replays exactly when the theater replays it in full (\(marquee.count) of \(ids.count))")
        let beats = items.compactMap { i -> String? in
            guard let s = BasketballScene.parse(items, at: items.firstIndex { $0["id"].string == i["id"].string }!, teams: teams) else { return nil }
            return [.defensiveRebound, .timeout, .periodEnd, .substitution].contains(s.kind) ? s.id : nil
        }
        check(!beats.isEmpty && beats.allSatisfy { built[$0] == nil }, "rebounds, timeouts, period ends and changes are beats: their rows stay as they are")
        // The live path: the lane parses each play within its window of the newest plays.
        let same = built.allSatisfy { id, r in
            guard let i = items.firstIndex(where: { $0["id"].string == id }) else { return false }
            let start = max(i - 100, 0), window = Array(items[start..<min(i + 6, items.count)])
            return BasketballScene.parse(window, at: i - start, teams: teams).map { r.scene == .basketball($0) } == true
        }
        check(same, "each replay is the scene the live lane parses for the same play")
        check(built.values.filter { $0.moment != nil }.count > built.count / 2, "…with its moment as it was when new")
        check(Replays.play(of: "401909890312-run") == "401909890312" && Replays.play(of: "401909890312") == "401909890312",
              "a run's row replays its last basket")
        let first = JSON(["id": "1"]), second = JSON(["id": "2", "text": "old"]), edited = JSON(["id": "2", "text": "new"]), third = JSON(["id": "3"])
        check(Replays.merged([first, second], [edited, third]).map { $0["text"].string ?? $0["id"].string! } == ["1", "new", "3"],
              "the game's plays and the live lane's newest: the lane's edits, then what only it has")
        if let scene = built.values.compactMap({ r -> BasketballScene? in if case let .basketball(s) = r.scene { s } else { nil } }).first {
            func right(_ period: Int) -> Bool? {
                var s = scene
                s.period = period
                if case let .basketball(_, script) = ReplayTake.takes(.basketball(s), flipped: false, lineups: [:], topIsHome: false).first {
                    return script.yaw > 0
                }
                return nil
            }
            check(right(1) != nil && right(1) != right(3), "the ends swap at halftime, as the live theater takes the broadcast's")
        }
    }

    // MARK: Soccer

    static func soccerReplays() async {
        let feed = SoccerFeed()
        await feed.update(league: "eng.1", eventID: "401879256", homeTeamID: "362")
        let replays = feed.replays
        check(Set(feed.shots.map(\.playID)).isSubset(of: Set(replays.keys)), "every shot on the shot map replays (\(feed.shots.count))",
              "\(replays.count) replays")
        let goals = feed.shots.filter { $0.kind == .goal }
        check(goals.count == 3 && goals.allSatisfy { g in
            if case let .soccer(s)? = replays[g.playID]?.scene { return s.scored && replays[g.playID]?.moment?.kind == .goal }
            return false
        }, "the three goals replay as goals, each with its goal moment")
        check(feed.trail.filter { $0.kind == .pass }.allSatisfy { replays[$0.playID] == nil }, "a pass isn't a moment: not a replay")
        if let shown = feed.theater.scene {
            check(replays[shown.id]?.scene == .soccer(shown), "the replay of the theater's latest moment is the scene the theater has")
        } else {
            check(false, "the soccer theater has a moment")
        }
        if case let .soccer(scene)? = goals.first.flatMap({ replays[$0.playID]?.scene }) {
            func attacksRight(_ flipped: Bool, period: Int) -> Bool? {
                var s = scene
                s.period = period
                if case let .soccer(drawn, _) = ReplayTake.takes(.soccer(s), flipped: flipped, lineups: [:], topIsHome: true).first {
                    return drawn.attacksRight
                }
                return nil
            }
            check(attacksRight(false, period: 1) != attacksRight(false, period: 2) && attacksRight(false, period: 1) != attacksRight(true, period: 1),
                  "the moment turns round for the second half, and for the game's turn of the pitch")
        }
    }
}
