import SwiftUI

// The play theater from MLB's official account (World Series Games 3 and 4:
// ESPN's plays, Tests/Fixtures/ws-g3-plays.json and ws-g4-plays.json, and
// MLB's feed for each, statcast-849804.json and statcast-849803.json): every
// runner's legs and every fielder's credit parsed; the ball to the man who
// fielded it, at the real spot (on through the infield to an outfielder);
// the throws along the credited chain to the putouts, errors and deflections
// as credited; each runner on his real path, the outs at the real bases in
// the real order; and the story told in order, the camera taking every run
// home. Without MLB's account, ESPN's text and today's inference, as before.

extension ScorelineTests {
    static func playCredits() {
        print("\nPlay theater: the official account")
        let dir = FixtureProtocol.directory
        struct Game {
            let plays: [JSON]
            let names: [String: String]
            let atBats: [Statcast.AtBat]
        }
        func load(_ espn: String, _ mlb: String) -> Game? {
            guard let e = try? Data(contentsOf: dir.appendingPathComponent(espn)), let m = try? Data(contentsOf: dir.appendingPathComponent(mlb)) else {
                return nil
            }
            let j = JSON(data: e)
            var names: [String: String] = [:]
            for (id, name) in (j["names"].raw as? [String: String]) ?? [:] { names[id] = name }
            return Game(plays: j["items"].array, names: names, atBats: Statcast.atBats(JSON(data: m)))
        }
        guard let g3 = load("ws-g3-plays.json", "statcast-849804.json"), let g4 = load("ws-g4-plays.json", "statcast-849803.json") else {
            return check(false, "Games 3 and 4's plays and MLB feeds load")
        }
        // MIL (8) at TB (30) both nights.
        let side: (String?) -> GameDetail.Side? = { $0 == "8" ? .top : $0 == "30" ? .bottom : nil }
        func scene(_ id: String, in g: Game, measured: Bool = true) -> PlayScene? {
            guard let i = g.plays.firstIndex(where: { $0["id"].string == id }), var s = PlayScene.parse(g.plays, at: i, side: side, names: g.names) else {
                return nil
            }
            if measured { s.measured = s.measurement(in: g.atBats) }
            return s
        }
        func scenes(_ g: Game) -> [PlayScene] {
            g.plays.indices.filter { g.plays[$0]["type"]["type"].string == "play-result" }.compactMap { i in
                PlayScene.parse(g.plays, at: i, side: side, names: g.names).map { s in var s = s; s.measured = s.measurement(in: g.atBats); return s }
            }
        }
        func script(_ s: PlayScene?) -> PlayScript? {
            s.map { PlayScript($0, rest: PlayScript.Rest(bases: $0.endsInning ? [false, false, false] : $0.basesAfter, bats: .right,
                                                          swapped: $0.endsInning)) }
        }
        func ends(_ runners: [PlayScene.Runner]) -> String {
            runners.map { r in
                let from = r.from == 0 ? "B" : "\(r.from)"
                switch r.end {
                case let .base(b): return "\(from)→\(b)"
                case .scored: return "\(from)→R"
                case let .out(at): return "\(from)×\(at.map(String.init) ?? "c")"
                }
            }.joined(separator: " ")
        }
        let all3 = scenes(g3), all4 = scenes(g4)

        // MARK: MLB's account, parsed

        let contreras = g3.atBats.first { $0.inning == 3 && $0.top && $0.batter == "William Contreras" }
        let legs = contreras?.result ?? []
        check(legs.count == 6 && legs.filter { $0.runner == legs[0].runner }.map(\.to) == [1, nil]
              && legs.last?.out == 2 && legs.last?.outNumber == 2 && legs.last?.reason == "r_out_stretching"
              && legs.last?.credits.map(\.position) == [9, 9, 6] && legs.last?.credits.last?.kind == .putout,
              "a play's legs: Contreras singles, then out stretching at second (9 to 6), the second out", "\(legs)")
        let bauers = legs.filter { $0.runner == legs.first { $0.from == 2 }?.runner }
        check(bauers.map(\.to) == [3, 4], "…Bauers from second to third, then home (4: a run)")
        check(contreras?.batted?.fielder == 9, "…and the ball's fielder (MLB's location): the right fielder")
        let stealAndWalk = g3.atBats.first { $0.inning == 5 && $0.top && $0.batter == "Christian Yelich" }
        check(stealAndWalk.map { $0.runners.count == 2 && $0.result.count == 1 && $0.result[0].from == 0 && $0.result[0].to == 1 } == true,
              "a steal between pitches is the at-bat's, but not its result's: the walk's legs are the batter's alone")
        check(Statcast.fields.contains("runners") && Statcast.fields.contains("credits") && Statcast.fields.contains("location"),
              "the feed's fields ask for the runners, their credits and the ball's fielder")
        let appearances4 = all4.filter { $0.appearance != nil }
        check(!appearances4.isEmpty && appearances4.allSatisfy { $0.measurement(in: g4.atBats) != nil },
              "every plate appearance in Game 4 finds its MLB at-bat", "\(appearances4.filter { $0.measured == nil }.map(\.text))")

        // MARK: The handling, credited

        typealias Throw = PlayScene.Handling.Throw
        let sixThree = scene("4019080440005990057", in: g3)?.handling
        check(sixThree == PlayScene.Handling(fielder: 6, chain: [Throw(to: 3, base: 1)]), "6-3: the shortstop fields it, the throw to first",
              "\(String(describing: sixThree))")
        let dp = scene("4019080441102990057", in: g3)?.handling
        check(dp == PlayScene.Handling(fielder: 4, chain: [Throw(to: 6, base: 2), Throw(to: 3, base: 1)]),
              "4-6-3: second to short at second (the first out), short to first (the second)", "\(String(describing: dp))")
        let unassisted = scene("4019080441303990057", in: g3)
        check(unassisted?.handling == PlayScene.Handling(fielder: 3, chain: [Throw(to: 3, base: 1)]),
              "3U: the first baseman takes it to the bag himself (no toss to the pitcher)")
        check(scene("4019080440102990057", in: g3)?.handling == PlayScene.Handling(fielder: 9), "F9: the catch is the out, no throw")
        let stretch = scene("4019080440405990057", in: g3)
        check(stretch?.handling == PlayScene.Handling(fielder: 9, chain: [Throw(to: 6, base: 2)]),
              "a single, the batter out stretching: fielded by the right fielder, his throw to the shortstop at second")
        let e5 = scene("4019080441002990057", in: g3)
        check(e5?.handling == PlayScene.Handling(fielder: 5, chain: [Throw(to: 3, base: 1, wild: true)]),
              "1B E5: the third baseman fields it, and his throw to first gets away", "\(String(describing: e5?.handling))")
        check(scene("4019080440808990057", in: g3)?.handling == PlayScene.Handling(fielder: 7, deflection: 5),
              "a double off the third baseman's glove: deflected by him, fielded by the left fielder")
        check(scene("4019080440902990057", in: g3)?.handling?.chain.isEmpty == true, "strike three: the catcher's, no throw")
        check(scene("4019080440005990057", in: g3, measured: false)?.handling == nil, "without MLB's account, no handling: infer it")

        // MARK: The runners, official

        let espnRunners = (all3 + all4).filter { $0.measured != nil }
        let disagree = espnRunners.filter { ends($0.official.runners) != ends($0.runners) }
        check(disagree.map(\.id) == ["4019080451503990057", "4019080451903990057"],
              "every Game 3 and 4 runner goes where MLB's legs took him; ESPN's account agrees but for two it can't know "
                + "(Game 4's third strikes dropped and thrown to first: out at first, not at the plate)",
              disagree.map { "\($0.id) \($0.text): \(ends($0.runners)) vs \(ends($0.official.runners))" }.joined(separator: " | "))
        check(stretch?.official.runners.first?.outNumber == 2 && e5?.official.runners.first?.waits == 1,
              "…with the order of the outs, and a wait at first for a throw that got away")
        let flyMovement = Statcast.Movement(runner: 1, from: 0, to: nil, out: 1, outNumber: 1, reason: nil, event: 0,
                                            credits: [Statcast.Credit(position: 8, kind: .putout)])
        check(ends(PlayScene.runners([PlayScene.Runner(id: "b", from: 0, end: .base(1))], after: [flyMovement], caughtOut: true, struckOut: false)) == "B×c",
              "the batter's out on a fly is at the catch (MLB's \"1B\" is a placeholder)")
        let missing = Statcast.Movement(runner: 2, from: 2, to: 3, out: nil, outNumber: nil, reason: "r_adv_play", event: 0, credits: [])
        check(ends(PlayScene.runners([PlayScene.Runner(id: "b", from: 0, end: .base(1))], after: [missing], caughtOut: false, struckOut: false))
              == "B→1 2→3", "a runner only MLB has joins the play; the batter MLB doesn't list keeps ESPN's account")
        if var partial = scene("4019080440806990057", in: g3) {
            partial.measured?.movements.removeAll { $0.to == 4 }
            check(partial.legs == nil && partial.official.runners == partial.runners && partial.handling == nil,
                  "an account still being posted (fewer runs than ESPN's): ESPN's runners, and the handling inferred")
        }

        // MARK: The owner's two plays (Game 4, top of the 4th)

        // Frelick singles on a ground ball between first and second, through to the right fielder.
        let frelick = scene("4019080450603990057", in: g4)
        if let s = frelick, let sc = script(s), let b = sc.batted {
            let flight = sc.flights[b], end = flight.to.ground
            let gather = sc.actors[8].actions.first { $0.kind == .scoop }
            let mlbSpot = Ballpark.feet(CGPoint(x: 151.11, y: 162.18))
            let line = abs(Ballpark.bearing(end) - Ballpark.bearing(mlbSpot)) * Ballpark.distance(mlbSpot)
            check(Ballpark.distance(end) > 200 && gather.map { abs($0.at - flight.end) < 0.001 } == true
                  && hypot(sc.actors[8].position(at: flight.end).x - end.x, sc.actors[8].position(at: flight.end).y - end.y) < 1,
                  "the owner's single through the right side: the right fielder fields it on the grass, \(Int(Ballpark.distance(end))) ft out")
            check(line < 1.5, "…on its line through MLB's spot, where it got past the infield", "\(line) ft off")
            check(sc.actors[2].actions.contains { $0.kind == .scoop && $0.at < flight.end } && !sc.actors[0].actions.contains { $0.kind == .scoop },
                  "…the first baseman reaches for it as it goes by (the pitcher, too far away, doesn't)")
            check(!sc.flights.contains { $0.to.ground == Ballpark.bag(1) } && !sc.actors[3].actions.contains { $0.kind == .throwBall },
                  "…and nobody fields it on the infield and throws to first")
        } else {
            check(false, "the owner's single loads")
        }
        // Pratt doubles to left; Frelick scores from first. The hit, the fielding, the run, the batter's base.
        let pratt = scene("4019080450604990057", in: g4)
        if let s = pratt, let sc = script(s), let b = sc.batted, let run = sc.flashes.first(where: { $0.beat == .run }) {
            let gathered = sc.actors[6].actions.first { $0.kind == .scoop }?.at ?? .infinity
            let second = sc.actors[9].moves.first { $0.path.last == Ballpark.base(2) }?.end ?? 0
            check(sc.flights[b].start < gathered && gathered < run.at && run.at < second,
                  "the owner's double: the hit, the left fielder gathers it, Frelick crosses, then Pratt pulls into second",
                  "gathered \(gathered), run \(run.at), second \(second)")
            let frame = sc.camera.frame(at: run.at)
            let runner = sc.actors.firstIndex { $0.role == .runner } ?? 10
            check(inView(.init(x: 0, y: 0), frame) && inView(FieldPoint(sc.actors[runner].position(at: run.at - 0.05)), frame),
                  "…the camera on the plate and Frelick as he crosses it")
            check(inView(FieldPoint(Ballpark.base(2)), sc.camera.frame(at: second)), "…and on second as Pratt gets there")
            check(sc.stamp >= run.at && sc.duration < 8.5, "…the mark (+1) once he's in, all in under 8 s", "\(sc.duration)")
        } else {
            check(false, "the owner's double loads")
        }

        // MARK: Every play, against MLB's account

        var firsts = 0, firstsOK = 0, chains = 0, chainsOK = 0, misses: [String] = []
        for s in (all3 + all4) where s.inPlay && s.kind != .homeRun {
            guard let h = s.handling, let sc = script(s), let b = sc.batted else { continue }
            let flight = sc.flights[b]
            let fielders = Array(0..<9)
            let first = fielders.flatMap { i in sc.actors[i].actions.filter { [.catchHigh, .scoop, .glove].contains($0.kind) && $0.at >= flight.end - 0.01 }.map { (i, $0.at) } }
                .min { $0.1 < $1.1 }?.0
            firsts += 1
            if first == h.fielder - 1 { firstsOK += 1 } else { misses.append("first: \(s.text)") }
            // Each throw to the credited man, and the outs at the credited bases in the credited order.
            let throwsTo = sc.flights.indices.filter { $0 > b }.compactMap { j -> Int? in
                fielders.first { i in sc.actors[i].actions.contains { $0.kind == .glove && abs($0.at - sc.flights[j].end) < 0.001 } }.map { $0 + 1 }
            }
            // (A putout he makes himself is a carry, not a throw.)
            var holder = h.fielder, credited: [Int] = []
            for t in h.chain where !t.wild {
                if t.to != holder { credited.append(t.to) }
                holder = t.to
            }
            let outs = sc.flashes.filter { $0.beat == .out }.sorted { $0.at < $1.at }.map(\.point.ground)
            let bases = h.chain.filter { !$0.wild }.compactMap(\.base).map { FieldPoint(Ballpark.base($0)).ground }
            guard !h.chain.isEmpty else { continue }
            chains += 1
            if Array(throwsTo.prefix(credited.count)) == credited && outs == bases { chainsOK += 1 } else {
                misses.append("chain: \(s.text) \(throwsTo)/\(credited) \(outs.count)/\(bases.count)")
            }
        }
        check(firsts > 70 && firstsOK == firsts, "every ball in play in Games 3 and 4 goes to the man MLB credits with fielding it (\(firstsOK)/\(firsts))",
              misses.joined(separator: " | "))
        check(chains > 15 && chainsOK == chains, "…and every credited throw to its man, the outs at the credited bases in order (\(chainsOK)/\(chains))",
              misses.joined(separator: " | "))

        // MARK: The story in order, the camera on every run

        let homerScene: PlayScene? = {
            guard let summary = try? Data(contentsOf: dir.appendingPathComponent("3bd207fad0c0e7da8976ca99.bin")) else { return nil }
            let g2 = JSON(data: summary)["plays"].array
            return g2.firstIndex { $0["id"].string == "4019080430005990057" }.flatMap { PlayScene.parse(g2, at: $0, side: { $0 == "30" ? .top : .bottom }) }
        }()
        var offscreen: [String] = [], outsUnseen: [String] = [], long: [String] = []
        let everything = (all3 + all4).flatMap { s -> [PlayScene] in var bare = s; bare.measured = nil; return [s, bare] } + [homerScene].compactMap { $0 }
        for s in everything {
            guard let sc = script(s) else { continue }
            for run in sc.flashes where run.beat == .run {
                let frame = sc.camera.frame(at: run.at)
                let crossing = sc.actors.indices.filter { sc.actors[$0].team == .batting && abs(sc.actors[$0].vanish - run.at - 0.15) < 0.01 }
                if !inView(FieldPoint(x: 0, y: 0), frame) || !crossing.allSatisfy({ inView(FieldPoint(sc.actors[$0].position(at: run.at - 0.1)), frame, slack: 0.03) }) {
                    offscreen.append("\(s.text) at \(String(format: "%.2f", run.at))")
                }
            }
            for out in sc.flashes where out.beat == .out && !inView(out.point, sc.camera.frame(at: out.at), slack: 0.03) {
                outsUnseen.append("\(s.text) at \(String(format: "%.2f", out.at))")
            }
            if sc.settle - 0.75 > (s.runs > 1 ? 7.0 : 5.6) { long.append("\(s.text) \(String(format: "%.2f", sc.settle - 0.75))") }
        }
        check(offscreen.isEmpty, "the camera never leaves a run scoring off screen: the plate and the runner in view as he crosses (every play, with and without MLB)",
              offscreen.joined(separator: " | "))
        check(outsUnseen.isEmpty, "…nor an out", outsUnseen.joined(separator: " | "))
        check(long.isEmpty, "replays stay short: under 5.6 s before the field settles, 7 for a multi-run play", long.joined(separator: " | "))
        // Two runs on an infield single (Game 3): each crosses, a beat apart, after the shortstop has it.
        if let s = scene("4019080440806990057", in: g3), let sc = script(s) {
            let runs = sc.flashes.filter { $0.beat == .run }.map(\.at).sorted()
            let gathered = sc.actors[5].actions.first { $0.kind == .scoop }?.at ?? .infinity
            check(runs.count == 2 && runs[0] > gathered && runs[1] - runs[0] >= 0.55, "a two-run single: each run crosses after the ball's gathered, a beat apart",
                  "\(runs), gathered \(gathered)")
        }
        // A home run: its runner crosses ahead of the batter, after the cut to the trot.
        if let s = homerScene, let sc = script(s), let cut = sc.shots.first(where: \.cut) {
            let runs = sc.flashes.filter { $0.beat == .run }.map(\.at).sorted()
            check(runs.count == 2 && runs.allSatisfy { $0 > cut.from } && sc.actors[9].vanish > runs[0] + 0.15 && sc.settle - 0.75 < 4.8,
                  "a two-run home run: the runner home ahead of the batter, both after the cut to the trot", "\(runs) cut \(cut.from)")
        }
        // Three runs (Game 3's two-run double with the bases loaded): still told in about 8 s.
        if var s = scene("4019080440808990057", in: g3), let m = s.measured {
            s.runners.insert(PlayScene.Runner(id: "x", from: 3, end: .scored), at: 1)
            s.runs = 3
            s.measured?.movements = m.movements + [Statcast.Movement(runner: 99, from: 3, to: 4, out: nil, outNumber: nil, reason: "r_adv_force", event: 0, credits: [])]
            if let sc = script(s) {
                let runs = sc.flashes.filter { $0.beat == .run }.map(\.at).sorted()
                check(runs.count == 3 && zip(runs, runs.dropFirst()).allSatisfy { $1 - $0 >= 0.55 } && sc.duration < 9 && sc.settle - 0.75 < 7,
                      "three runs on a double: each crosses a beat apart, and the replay still settles in about 7 s", "\(runs), \(sc.duration)")
            }
        }

        // MARK: Throws that get away, relays, a runner thrown out at home

        if let s = e5, let sc = script(s) {
            let wild = sc.flights.first { $0.from.z == 5 && $0.to.z == 0 }
            let batter = sc.actors[9]
            let atFirst = batter.moves.first { $0.path.last == Ballpark.base(1) }?.end ?? .infinity
            let onward = batter.moves.first { $0.path.last == Ballpark.base(2) }?.start ?? 0
            check(wild != nil && sc.flashes.allSatisfy { $0.beat != .out } && atFirst < onward
                  && wild.map { onward >= $0.start + ($0.end - $0.start) / 1.3 - 0.12 } == true,
                  "1B E5: the throw sails past first; the batter, there already, goes on to second as it gets by")
        }
        // A relay, and a runner thrown out at home (Games 1 and 2's credits, on Game 3's double).
        if var s = scene("4019080440809990057", in: g3), let m = s.measured {
            let relay = [Statcast.Credit(position: 7, kind: .assist), Statcast.Credit(position: 7, kind: .outfieldAssist),
                         Statcast.Credit(position: 6, kind: .assist), Statcast.Credit(position: 2, kind: .putout)]
            s.measured?.movements = m.movements.map { leg in
                leg.from == 3 ? Statcast.Movement(runner: leg.runner, from: 3, to: nil, out: 4, outNumber: 1, reason: "r_thrown_out", event: leg.event,
                                                   credits: relay) : leg
            }
            s.runners = s.runners.map { $0.from == 2 ? PlayScene.Runner(id: $0.id, from: 2, end: .out(at: 0)) : $0 }
            s.runs = 0
            let h = s.handling
            check(h?.chain == [Throw(to: 6, base: nil), Throw(to: 2, base: 0)], "a relay home: left to short (the cutoff), short to the catcher",
                  "\(String(describing: h))")
            if let sc = script(s), let out = sc.flashes.first(where: { $0.beat == .out }) {
                let runner = sc.actors.firstIndex { $0.role == .runner } ?? 10
                check(out.point.ground == Ballpark.base(0) && sc.actors[5].actions.contains { $0.kind == .throwBall }
                      && sc.actors[runner].vanish > out.at && sc.flashes.allSatisfy { $0.beat != .run },
                      "…the runner from second out at the plate, a step behind the relay, and no run")
            }
        }

        // MARK: Game 4's odd ones: a third strike dropped, a rundown, a throw that let a run in

        let dropped = scene("4019080451503990057", in: g4)
        check(dropped?.handling == PlayScene.Handling(fielder: 2, chain: [Throw(to: 3, base: 1)])
              && dropped.map { ends($0.official.runners) } == "B×1",
              "strike three dropped (\"catcher to first baseman\"): the catcher's throw, the batter out at first, not at the plate")
        check(dropped?.notation.code == "K 2-3" && scene("4019080440902990057", in: g3)?.notation.code == "K",
              "…its mark the scorer's \"K 2-3\" (a plain strikeout still K)",
              "\(dropped?.notation.code ?? "-") \(dropped?.fielders ?? []) \(scene("4019080440902990057", in: g3)?.notation.code ?? "-")")
        if let s = dropped, let sc = script(s), let out = sc.flashes.last(where: { $0.beat == .out }) {
            check(out.point.ground == Ballpark.base(1) && sc.actors[1].actions.contains { $0.kind == .throwBall }
                  && sc.actors[9].position(at: out.at).x > 40, "…he runs for it, a step behind the throw")
        }
        let rundown = scene("4019080450705040298", in: g4, measured: false).map { s in var s = s; s.measured = s.runnerMeasurement(in: g4.atBats); return s }
        check(rundown?.handling == PlayScene.Handling(fielder: 1, chain: [Throw(to: 3, base: nil), Throw(to: 6, base: nil), Throw(to: 4, base: 2)]),
              "a pickoff into a rundown: pitcher to first, to short, to second for the tag", "\(String(describing: rundown?.handling))")
        check(rundown?.notation.code == "CS 1-3-6-4" && scene("4019080450705040298", in: g4, measured: false)?.notation.code == "CS",
              "…marked CS 1-3-6-4 from MLB's credits (ESPN's text names no one: CS alone)")
        if let s = rundown, let sc = script(s) {
            check(sc.actors[0].actions.contains { $0.kind == .throwBall } && sc.actors[2].actions.contains { $0.kind == .throwBall }
                  && sc.actors[5].actions.contains { $0.kind == .throwBall } && sc.actors[3].actions.contains { $0.kind == .glove }
                  && sc.flashes.filter { $0.beat == .out }.map(\.point.ground) == [Ballpark.base(2)],
                  "…the pitcher, first baseman and shortstop each throw, the second baseman tags him at second")
        }
        let fcError = scene("4019080450703990057", in: g4)
        check(fcError?.handling == PlayScene.Handling(fielder: 5, chain: [Throw(to: 6, base: 3, wild: true)])
              && fcError?.official.runners.first { $0.from == 2 }?.waits == 3,
              "a fielder's choice the third baseman throws away: to third, past it, and the runner from second comes on home",
              "\(String(describing: fcError?.handling))")

        // MARK: A diving catch

        if var s = scene("4019080440203990057", in: g3) {
            s.effort = PlayScene.effort("Frelick lines out to left fielder Chandler Simpson on a diving catch.")
            if let sc = script(s), let dive = sc.actors[6].dive {
                check(s.effort == .diving && dive.target.z <= 1.5 && sc.actors[6].actions.contains { $0.kind == .scoop && abs($0.at - dive.reach) < 0.001 },
                      "a diving catch (the text says so): the left fielder at full stretch, the glove to the ball low (a dive for the figures; a lunge until then)")
            } else {
                check(false, "a diving catch has a dive")
            }
            check(PlayScene.effort("leaping catch at the wall") == .leaping && PlayScene.effort("Díaz lined out to left.") == nil
                  && script(scene("4019080440203990057", in: g3))?.actors.allSatisfy { $0.dive == nil } == true,
                  "…a leap when it says leaping; nothing when it doesn't")
        }

        // MARK: Plays between pitches

        func runnersOnly(_ plays: [PlayScene], _ g: Game) -> [PlayScene] {
            plays.filter { $0.batter == nil }.map { s in var s = s; s.measured = s.runnerMeasurement(in: g.atBats); return s }
        }
        let runnerPlays = runnersOnly(all3, g3) + runnersOnly(all4, g4)
        check(runnerPlays.count >= 6 && runnerPlays.allSatisfy { $0.legs != nil },
              "every runner's play between pitches (steals, caught stealing, a wild pitch, indifference) finds its legs in MLB's feed",
              runnerPlays.filter { $0.legs == nil }.map(\.text).joined(separator: " | "))
        let steal = runnerPlays.first { $0.id == "4019080450004040298" }
        check(steal.map { ends($0.runners) } == "1→3" && steal.map { ends($0.official.runners) } == "1→3" && steal?.official.runners.first?.waits == 2,
              "Yelich's steal and the catcher's throwing error: MLB's legs take him to third (ESPN's bases left him at second; its text, read now, agrees)")
        check(steal?.handling == PlayScene.Handling(fielder: 2, chain: [Throw(to: 4, base: 2, wild: true)])
              && runnerPlays.first { $0.text.contains("caught stealing, catcher to shortstop") || $0.notation.code == "CS 2-6" }?.handling
                == PlayScene.Handling(fielder: 2, chain: [Throw(to: 6, base: 2)]),
              "…the catcher's throw to second got away; a caught stealing, catcher to shortstop at second")
        if let s = steal, let sc = script(s), let runner = sc.actors.firstIndex(where: { $0.role == .runner }) {
            let moves = Array(sc.actors[runner].moves.prefix(2))
            let wild = sc.flights.first { $0.to.z == 0 && $0.from.z == 5 }
            check(moves.count == 2 && moves[0].path.last == Ballpark.base(2) && moves[1].path.last == Ballpark.base(3)
                  && wild.map { moves[1].start >= $0.start + ($0.end - $0.start) / 1.3 - 0.12 } == true,
                  "…the throw to second gets past the bag, and Yelich, there, goes on to third")
        }
    }

    /// Where a point sits in the view, as fractions across and up, is inside it.
    private static func inView(_ p: FieldPoint, _ c: CameraFrame, slack: Double = 0) -> Bool {
        let x = 0.5 + (p.x - c.x) / (c.span * CameraFrame.aspect), y = 0.5 + (p.y * 0.5 + p.z * 0.82 - c.y) / c.span
        return x >= -slack && x <= 1 + slack && y >= -slack && y <= 1 + slack
    }
}
