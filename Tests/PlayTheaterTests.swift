import SwiftUI

// The play theater, checked without the live lane: ESPN's plays parsed into
// scenes (World Series Game 3's every core play, Tests/Fixtures/ws-g3-plays.json,
// and Game 2's summary for its home runs), the scorer's notation, runners by
// athlete ID, what's news, and the choreography (a throw beats the runner it
// retires, a home run clears the fence, every replay settles to a static field).

extension ScorelineTests {
    static func playTheater() {
        print("\nPlay theater")
        guard let data = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("ws-g3-plays.json")) else {
            return check(false, "Game 3 plays fixture loads")
        }
        let g3 = JSON(data: data)
        let plays = g3["items"].array
        var names: [String: String] = [:]
        for (id, name) in (g3["names"].raw as? [String: String]) ?? [:] { names[id] = name }
        // MIL (8) at TB (30): the visitors are the top team.
        let side: (String?) -> GameDetail.Side? = { $0 == "8" ? .top : $0 == "30" ? .bottom : nil }
        func scene(_ id: String, names: [String: String]? = nil) -> PlayScene? {
            guard let i = plays.firstIndex(where: { $0["id"].string == id }) else { return nil }
            return PlayScene.parse(plays, at: i, side: side, names: names ?? [:])
        }
        func ends(_ s: PlayScene?) -> String {
            (s?.runners ?? []).map { r in
                let from = r.from == 0 ? "B" : "\(r.from)"
                switch r.end {
                case let .base(b): return "\(from)→\(b)"
                case .scored: return "\(from)→R"
                case let .out(at): return "\(from)×\(at.map(String.init) ?? "c")"
                }
            }.joined(separator: " ")
        }

        // MARK: Every play

        let results = plays.indices.filter { plays[$0]["type"]["type"].string == "play-result" }
        let scenes = results.compactMap { PlayScene.parse(plays, at: $0, side: side, names: names) }
        let lineups = results.filter { plays[$0]["alternativeType"]["type"].string == "lineup-change" }.count
        check(scenes.count == results.count - lineups && lineups == 18, "every play-result but a lineup change is a play on the field",
              "\(scenes.count) of \(results.count), \(lineups) lineup changes")
        check(scenes.allSatisfy { !$0.notation.code.isEmpty }, "every Game 3 play has a scorer's mark",
              scenes.filter { $0.notation.code.isEmpty }.map(\.text).joined(separator: " | "))
        check(scenes.filter(\.inPlay).allSatisfy { $0.spot != nil && $0.trajectory != nil }, "every ball in play has its spot and trajectory")
        check(scenes.allSatisfy { $0.batting != nil }, "every play knows the batting team (the result's team, not the pitch's)")
        let miscounted = scenes.filter { s in s.outsAfter - s.outsBefore != s.runners.filter(\.isOut).count }
        check(miscounted.isEmpty, "outs made match the runners put out", miscounted.map(\.text).joined(separator: " | "))

        // MARK: Kinds and notation

        let single = scene("4019080440003990057")
        check(single?.kind == .single && single?.notation.code == "1B" && single?.trajectory == .fly
              && single?.spot == CGPoint(x: 64, y: 142) && single?.fielders == [7],
              "a single on a fly ball to the left fielder", "\(String(describing: single))")
        check(ends(single) == "B→1 1→2" && single?.outsBefore == 1 && single?.outsAfter == 1, "…the batter to first, the runner from first to second",
              ends(single))
        check(single?.bats == .left && single?.pitch?.code == "FF" && single?.pitch?.mph == 95 && single?.batting == .top,
              "…batting left-handed, off a 95 mph four-seamer, for the top team")
        let groundOut = scene("4019080440005990057")
        check(groundOut?.notation.code == "6-3" && groundOut?.kind == .groundOut && groundOut?.flight == .ground,
              "grounds out, shortstop to first baseman: 6-3", groundOut?.notation.code ?? "nil")
        check(ends(groundOut) == "B×1 2→2 1→1" && groundOut?.endsInning == true, "…the batter out at first; the runners stranded as the inning ends",
              ends(groundOut))
        check(scene("4019080441303990057")?.notation.code == "3U", "grounds out to the first baseman, unassisted: 3U")
        check(scene("4019080440004990057")?.notation.code == "P6" && scene("4019080440004990057")?.trajectory == .popUp,
              "an infield fly to the shortstop: P6")
        check(scene("4019080440102990057")?.notation.code == "F9", "flies out to the right fielder: F9")
        check(scene("4019080440203990057")?.notation.code == "L7", "lines out to the left fielder: L7")
        check(scene("4019080441602990057")?.notation.code == "P3" && scene("4019080441402990057")?.notation.code == "F7",
              "foul outs by trajectory: P3 popped up, F7 flied")
        let force = scene("4019080440103990057")
        check(force?.notation.code == "FC 6-4" && ends(force) == "B→1 1×2", "a force at second: FC 6-4, the runner from first out at second",
              "\(force?.notation.code ?? "nil") \(ends(force))")
        let dp = scene("4019080441102990057")
        check(dp?.notation.code == "4-6-3 DP" && dp?.outsBefore == 0 && dp?.outsAfter == 2 && ends(dp) == "B×1 1×2",
              "a 4-6-3 double play: both outs, the lead runner's at second", "\(dp?.notation.code ?? "nil") \(ends(dp))")
        let looking = scene("4019080440902990057")
        check(looking?.kind == .strikeout(looking: true) && looking?.notation.backwards == true && looking?.notation.description == "ꓘ",
              "called out on strikes: a K drawn backwards")
        let swinging = scene("4019080440002990057")
        check(swinging?.notation.code == "K" && swinging?.notation.backwards == false && ends(swinging) == "B×0 1→1",
              "struck out swinging (on a foul tip): K, out at the plate, the runner holds", ends(swinging))
        check(scene("4019080440702990057")?.kind == .strikeout(looking: true), "an overturned call that stands as strike three is still looking")
        let walk = scene("4019080440403990057")
        check(walk?.notation.code == "BB" && ends(walk) == "B→1 1→2", "a walk forces the runner from first to second", ends(walk))
        check(scene("4019080441604990057")?.notation.code == "HBP", "hit by pitch: HBP")
        check(scene("4019080440104040298")?.notation.code == "CS 2-4" && ends(scene("4019080440104040298")) == "1×2",
              "caught stealing, catcher to second: CS 2-4, from the text's relay clause")
        check(scene("4019080440204050298")?.notation.code == "CS 2-6", "caught stealing, catcher to shortstop: CS 2-6")
        check(scene("4019080440804050298")?.notation.code == "SB" && ends(scene("4019080440804050298")) == "1→2"
              && scene("4019080440804050298")?.batter == nil, "a stolen base: no batter on it, the runner to second")
        check(scene("4019080441704020298")?.notation.code == "DI", "defensive indifference: DI")
        let error = scene("4019080441002990057")
        check(error?.notation.code == "1B E5" && ends(error) == "B→2", "an infield single and a throwing error: 1B E5, the batter to second",
              "\(error?.notation.code ?? "nil") \(ends(error))")
        check(scene("4019080440808990057")?.fielders == [7], "a deflection isn't a fielding credit (doubles to left, deflected by the third baseman)")

        // Who scored and who was out, when both happened: the text settles it by surname.
        let stretch = scene("4019080440405990057", names: names)
        check(stretch?.fielders == [9, 6] && ends(stretch) == "B×2 2→R 1→3" && stretch?.runs == 1,
              "a single, a run home, the batter thrown out stretching (9-6), the runner to third", ends(stretch))
        let stretchNoNames = scene("4019080440405990057")
        check(stretchNoNames?.runners.filter(\.isOut).count == 1 && stretchNoNames?.runners.filter { $0.end == .scored }.count == 1,
              "…without names, still one out and one run (the lead runner scores)", ends(stretchNoNames))
        let twoRuns = scene("4019080440806990057", names: names)
        check(ends(twoRuns) == "B→1 3→R 2→R 1→2" && twoRuns?.runs == 2, "two runs score on an infield single", ends(twoRuns))

        // MARK: The summary's plays (Game 2): no scorer's text, ids instead of links

        if let summary = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("3bd207fad0c0e7da8976ca99.bin")) {
            let g2 = JSON(data: summary)["plays"].array
            let side2: (String?) -> GameDetail.Side? = { $0 == "30" ? .top : $0 == "8" ? .bottom : nil }
            func scene2(_ id: String) -> PlayScene? {
                g2.firstIndex { $0["id"].string == id }.flatMap { PlayScene.parse(g2, at: $0, side: side2) }
            }
            let homer = scene2("4019080430005990057")
            check(homer?.kind == .homeRun && homer?.distance == 411 && homer?.runs == 2 && ends(homer) == "B→R 1→R"
                  && homer?.trajectory == .fly && homer?.batting == .top,
                  "a two-run home run, 411 feet, from the summary's plays", ends(homer))
            check(scene2("4019080431101990057")?.distance == 408 && ends(scene2("4019080431101990057")) == "B→R", "a solo home run, 408 feet")
            let sacrifice = g2.first { $0["text"].string?.hasPrefix("Walls hit sacrifice bunt") == true }?["id"].string.flatMap(scene2)
            check(sacrifice?.notation.code == "SAC 1-3" && ends(sacrifice) == "B×1 1→2", "a sacrifice bunt to the pitcher went to first: SAC 1-3",
                  sacrifice?.notation.code ?? "nil")
            let home = g2.first { $0["text"].string?.contains("Chourio out at home") == true }?["id"].string.flatMap(scene2)
            check(home?.notation.code == "FC 6-2" && ends(home) == "B→1 3×0 2→3", "a force at home: the catcher took the throw (FC 6-2)",
                  "\(home?.notation.code ?? "nil") \(ends(home))")
            let summaryScenes = g2.indices.compactMap { PlayScene.parse(g2, at: $0, side: side2) }
            check(summaryScenes.count > 60 && summaryScenes.allSatisfy { !$0.notation.code.isEmpty }, "every Game 2 play has a mark",
                  "\(summaryScenes.count)")
        } else {
            check(false, "Game 2 summary fixture loads")
        }

        // MARK: Graceful with what it doesn't know

        let unknown = JSON(["id": "x", "atBatId": "a", "type": ["type": "play-result"], "alternativeType": ["type": "brand-new-play"],
                            "text": "Something new happened.", "team": ["id": "8"], "hitCoordinate": ["x": 150, "y": 100],
                            "participants": [["type": "batter", "athlete": ["id": "1"]], ["type": "onFirst", "athlete": ["id": "1"]]]] as [String: Any])
        let odd = PlayScene.parse([unknown], at: 0, side: side)
        check(odd?.kind == .other && odd?.inPlay == true && ends(odd) == "B→1", "an unknown play with a spot: the ball to its spot, the batter to first")
        let oddScript = odd.map { PlayScript($0, rest: PlayScript.Rest()) }
        check(oddScript?.batted != nil && oddScript.map { $0.duration > 1 && $0.duration < 7 } == true, "…and it still replays")
        let bare = JSON(["id": "y", "type": ["type": "play-result"], "alternativeType": ["type": "brand-new-play"], "text": ""] as [String: Any])
        check(PlayScene.parse([bare], at: 0, side: side).map { PlayScript($0, rest: PlayScript.Rest()).duration > 0 } == true,
              "a play with nothing to go on still makes a (quiet) script")
        check(PlayScene.parse([JSON(["id": "z", "type": ["type": "play-result"], "alternativeType": ["type": "lineup-change"]] as [String: Any])],
                              at: 0, side: side) == nil, "a lineup change isn't a play")

        // MARK: What's news, and who's up

        let through = plays.firstIndex { $0["id"].string == "4019080440003990057" }!
        let window = Array(plays[...(through + 2)])
        let opened = BaseballFeed.theater(window, after: TheaterState(), primed: false, now: single!.wallclock! + 600, names: names, side: side)
        check(opened.play?.id == single?.id && opened.news == false, "a page opened ten minutes after a play shows it as it ended")
        let fresh = BaseballFeed.theater(window, after: TheaterState(), primed: false, now: single!.wallclock! + 25, names: names, side: side)
        check(fresh.news, "…but replays one that happened 25 s ago (ESPN posts plays 15–45 s late)")
        let arrived = BaseballFeed.theater(window, after: TheaterState(play: groundOut), primed: true, now: .distantFuture, names: names, side: side)
        check(arrived.news, "a play that arrives while the page is open is news")
        let again = BaseballFeed.theater(window, after: TheaterState(play: single, news: false), primed: true, now: .distantFuture,
                                         names: names, side: side)
        check(!again.news, "a play already showing stays what it was")
        check(opened.bats == .right, "who's up: the next batter's side, from his first entry (Contreras bats right)")
        let steal = plays.firstIndex { $0["id"].string == "4019080440804050298" }!
        let midAtBat = PlayScene.theater(Array(plays[...steal]), side: side)
        check(midAtBat.play?.kind == .stolenBase && midAtBat.bats == .left, "after a steal the same batter is still up (Yelich, left)")
        let endOfHalf = plays.firstIndex { $0["id"].string == "4019080440005990057" }!
        check(PlayScene.theater(Array(plays[...endOfHalf]), side: side).bats == nil, "after the third out nobody's in the box yet")
        // The play's end gives way to the live field once the next at-bat's first pitch is in.
        let walkAt = plays.firstIndex { $0["id"].string == "4019080440403990057" }!
        let nextPitch = plays[(walkAt + 1)...].firstIndex { $0["pitchCoordinate"].exists && $0["summaryType"].string == "P" }
        check(!PlayScene.theater(Array(plays[...walkAt]), side: side).cleared, "right after a play its end stays on the field")
        if let nextPitch {
            let pitched = PlayScene.theater(Array(plays[...nextPitch]), side: side)
            check(pitched.cleared && pitched.play?.id == "4019080440403990057", "…and clears at the next at-bat's first pitch")
        } else {
            check(false, "a pitch follows the walk in the fixture")
        }
        check(!midAtBat.cleared, "a steal's end stays until the next pitch to the same batter")

        // MARK: Choreography

        func script(_ s: PlayScene?, bases: [Bool]? = nil) -> PlayScript? {
            s.map { PlayScript($0, rest: PlayScript.Rest(bases: $0.endsInning ? [false, false, false] : bases ?? $0.basesAfter,
                                                          bats: .right, swapped: $0.endsInning)) }
        }
        // A 6-3: the throw beats the runner by a step, and the stamp waits for it.
        if let s = script(groundOut), let out = s.flashes.first(where: { $0.beat == .out }) {
            let batterRunner = s.actors[9]
            let reaches = batterRunner.moves.last?.end ?? 0
            check(out.point.ground == Ballpark.base(1) && out.at < reaches, "6-3: the out is at first, before the runner gets there",
                  "throw \(out.at), runner \(reaches)")
            check(s.stamp >= out.at && s.flights.contains { $0.to.ground == Ballpark.bag(1) }, "…the mark lands with the throw")
            check(s.settle - 0.75 > 1.8 && s.settle - 0.75 < 4.2, "…a replay of 2–4 s", "\(s.settle - 0.75)")
        } else {
            check(false, "6-3 script")
        }
        if let s = script(dp) {
            let outs = s.flashes.filter { $0.beat == .out }.sorted { $0.at < $1.at }.map(\.point.ground)
            check(outs == [Ballpark.base(2), Ballpark.base(1)], "4-6-3: out at second, then at first", "\(outs)")
        }
        let homerScene: PlayScene? = {
            guard let summary = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("3bd207fad0c0e7da8976ca99.bin")) else { return nil }
            let g2 = JSON(data: summary)["plays"].array
            return g2.firstIndex { $0["id"].string == "4019080430005990057" }.flatMap {
                PlayScene.parse(g2, at: $0, side: { $0 == "30" ? .top : .bottom })
            }
        }()
        if let s = script(homerScene), let fence = s.fence, let batted = s.batted {
            let flight = s.flights[batted]
            let landing = Ballpark.distance(flight.to.ground)
            check(fence.at > flight.start && fence.at < flight.end && landing > Ballpark.fence(Ballpark.bearing(flight.to.ground)),
                  "a home run clears the fence mid-flight and lands beyond it", "fence at \(fence.at), lands \(Int(landing)) ft")
            check(fence.point.z > Ballpark.wallHeight, "…over the wall's top, where the fireworks start")
            check(s.flashes.filter { $0.beat == .run }.count == 2, "…and both runs cross the plate")
            check(s.settle - 0.75 < 4.4, "…the trot done in about four seconds", "\(s.settle - 0.75)")
        } else {
            check(false, "home run script")
        }
        if let s = script(walk) {
            check(s.batted == nil && s.actors[9].position(at: .infinity) == Ballpark.lead(1), "a walk: no ball in play; the batter ends at first, leading off")
        }
        check(script(looking)?.actors[9].swing == nil && script(swinging)?.actors[9].swing != nil, "looking, he doesn't swing; swinging, he does")
        // At rest: fielders home, the ball put away, runners leading off the bases the play left.
        if let s = script(single) {
            check((0..<9).allSatisfy { s.actors[$0].position(at: .infinity) == Ballpark.position($0 + 1) } && s.ball(at: .infinity) == nil,
                  "after a play the fielders walk back and the ball is put away")
            let box = Ballpark.box(.right)
            let runners = s.actors.filter { $0.team == .batting && $0.opacity(at: .infinity) > 0.99 }.map { $0.position(at: .infinity) }
            check(Set(runners.map { "\($0)" }) == Set([Ballpark.lead(1), Ballpark.lead(2), box].map { "\($0)" }),
                  "…runners take their leads at first and second, the next batter steps in", "\(runners)")
        }
        if let s = script(groundOut) {
            let fielders = s.actors.filter { $0.opacity(at: .infinity) > 0.99 && $0.bats == nil }
            check(fielders.count == 9 && fielders.allSatisfy { $0.team == .batting }, "after the third out the team that batted takes the field")
        }
        // Every play in the game: a sane, finite script.
        let all = scenes.compactMap { script($0) }
        let finite = all.allSatisfy { s in
            stride(from: 0.0, through: s.duration, by: 0.1).allSatisfy { t in
                s.actors.allSatisfy { a in let p = a.position(at: t); return p.x.isFinite && p.y.isFinite }
                    && (s.ball(at: t).map { $0.x.isFinite && $0.y.isFinite && $0.z.isFinite && $0.z >= -0.01 } ?? true)
            }
        }
        check(finite, "every play's figures and ball stay finite, the ball never under the grass")
        // A run-scoring play tells its runs in order once the ball's been handled (PlayCreditsTests): a little longer.
        let lengths = all.map { $0.settle - 0.75 }, quiet = zip(scenes, lengths).filter { $0.0.runs == 0 }.map(\.1)
        check(quiet.allSatisfy { $0 >= 1.2 && $0 <= 4.4 } && lengths.allSatisfy { $0 >= 1.2 && $0 <= 5.6 },
              "every replay runs 1.2–4.4 s before it settles (one with runs, told in order, up to 5.6)",
              "\(String(format: "%.2f", lengths.min() ?? 0))–\(String(format: "%.2f", lengths.max() ?? 0))")
        // Every figure, every frame, every play: the poses and every blend between them.
        let broken = zip(scenes, all).compactMap { scene, s -> String? in
            let frame = { (t: Double) in PlayFrame(scene: scene, script: s, t: t, teams: TheaterTeams(batting: .blue, fielding: .gray),
                                                   ink: TheaterInk(.dark), size: CGSize(width: 312, height: 156)) }
            return jointsBreak(s.duration, s.actors.count) { i, t in
                frame(t).pose(s.actors[i], i, at: s.actors[i].position(at: t), unit: 1.1 / 8.5).0
            }.map { "\(scene.text.prefix(30)): \($0)" }
        }
        check(broken.isEmpty, "in every play of the game, knees and elbows bend only their own way, never past folded",
              broken.prefix(3).joined(separator: " | "))

        // MARK: Drawn

        // The last frame of a replay is the field at rest, pixel for pixel.
        if let s = script(single), let play = single {
            func frame(_ t: Double) -> Data? {
                let view = PlayFrame(scene: play, script: s, t: t, teams: TheaterTeams(batting: .blue, fielding: .gray), ink: TheaterInk(.dark),
                                     size: CGSize(width: 312, height: 156))
                    .frame(width: 312, height: 156)
                    .background(Color(white: 0.16))
                    .environment(\.colorScheme, .dark)
                let renderer = ImageRenderer(content: view)
                renderer.scale = 2
                return renderer.cgImage?.dataProvider?.data as Data?
            }
            let rest = frame(.infinity)
            check(rest != nil && frame(s.duration) == rest, "a replay ends exactly on the static scene")
            check(frame(1.2) != rest, "…and mid-play it isn't (the comparison sees the play)")
        }
    }
}

