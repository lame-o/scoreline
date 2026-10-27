import SwiftUI

// The soccer theater, checked without the live lane: real Premier League
// moments (24–25 Oct 2026, Tests/Fixtures/soccer-theater-plays.json: each
// clip ESPN's core plays from 24 before a big moment to 5 after) parsed into
// scenes (the build-up, the shot to its point in the goal mouth, who scored,
// saved, blocked), and the choreography (every pass from the man who played
// it to the man it found, the keeper's hands where the ball is, a goal in the
// net, a replay that settles on the frame it holds), the camera, and who
// celebrates what.

extension ScorelineTests {
    static func soccerTheater() {
        print("\nSoccer theater")
        guard let data = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("soccer-theater-plays.json")) else {
            return check(false, "soccer theater fixture loads")
        }
        struct Clip {
            let plays: [JSON]
            let home: String?
        }
        let matches = JSON(data: data)["matches"].array
        let clips = matches.flatMap { m in m["clips"].array.map { Clip(plays: $0.array, home: m["home"]["id"].string) } }
        /// The moment whose text says this, parsed from its clip.
        func find(_ clue: String) -> (scene: SoccerScene, clip: Clip, index: Int)? {
            for clip in clips {
                guard let i = clip.plays.firstIndex(where: { SoccerScene.isMoment($0) && ($0["text"].string ?? "").contains(clue) }),
                      let scene = SoccerScene.parse(clip.plays, at: i, homeTeamID: clip.home, keepers: SoccerScene.keepers(in: clip.plays))
                else { continue }
                return (scene, clip, i)
            }
            return nil
        }
        func near(_ a: CGPoint?, _ b: CGPoint?, _ tolerance: Double = 0.5) -> Bool {
            guard let a, let b else { return false }
            return hypot(a.x - b.x, a.y - b.y) <= tolerance
        }

        // MARK: Every moment

        var scenes: [SoccerScene] = []
        var moments = 0
        for clip in clips {
            let keepers = SoccerScene.keepers(in: clip.plays)
            for i in clip.plays.indices where SoccerScene.isMoment(clip.plays[i]) {
                moments += 1
                if let scene = SoccerScene.parse(clip.plays, at: i, homeTeamID: clip.home, keepers: keepers) { scenes.append(scene) }
            }
        }
        check(moments >= 20 && scenes.count == moments, "every goal, save, block, post and big chance in the clips parses", "\(scenes.count) of \(moments)")
        check(scenes.allSatisfy { s in (-1...106).contains(s.shot.from.x) && (-1...69).contains(s.shot.from.y) },
              "every shot is struck on the pitch")
        check(scenes.allSatisfy { $0.attacksRight ? $0.shot.from.x > Pitch.length / 2 : $0.shot.from.x < Pitch.length / 2 },
              "…in the half its team attacks (home right, as the Live Pitch draws it)")
        let built = scenes.filter { $0.buildUp.count >= 3 || ($0.start != .openPlay && !$0.touches.isEmpty) || $0.start == .penalty }
        check(Double(built.count) / Double(max(scenes.count, 1)) >= 0.6, "most moments get a build-up: three touches or a set piece",
              "\(built.count) of \(scenes.count)")
        check(scenes.allSatisfy { $0.buildUp.count <= SoccerScene.touchLimit }, "a build-up is the last eight touches at most")
        let types = ["pass", "goal-kick", "save", "shot-off-target", "corner-awarded"].map { JSON(["type": ["type": $0], "expectedGoals": 0.05] as [String: Any]) }
        check(types.allSatisfy { !SoccerScene.isMoment($0) }, "a pass, a goal kick, a save entry, a speculative miss aren't moments")
        check(SoccerScene.isMoment(JSON(["type": ["type": "shot-off-target"], "expectedGoals": 0.61] as [String: Any]))
              && SoccerScene.isMoment(JSON(["type": ["type": "goal---volley"]] as [String: Any]))
              && SoccerScene.isMoment(JSON(["type": ["type": "penalty---saved"]] as [String: Any])),
              "a big chance missed, a volley in, a penalty saved are")

        // MARK: The pitch

        check(near(Pitch.metres(x: 83, y: 21.1), CGPoint(x: 88.5, y: 13.84), 0.01) && near(Pitch.metres(x: 88.5, y: 50), CGPoint(x: 94, y: 34), 0.01)
              && near(Pitch.metres(x: 5.8, y: 63.2), CGPoint(x: 5.5, y: 43.16), 0.01),
              "Opta's markings land on the pitch's: the box's corner, the spot, the six-yard box")
        check(abs(Pitch.across(45.2) - Pitch.posts.near) < 0.01 && abs(Pitch.across(54.8) - Pitch.posts.far) < 0.01
              && abs(Pitch.height(38) - Pitch.goalHeight) < 0.01, "the goal mouth: the posts at 45.2 and 54.8, the bar at 38")
        check(Pitch.metres(x: 100.8, y: 50).x > Pitch.length, "a ball over the line is past it")
        check(SoccerScene.surname("Gabriel Magalhães") == "Magalhães" && SoccerScene.surname("Virgil van Dijk") == "van Dijk"
              && SoccerScene.surname("Jan Paul van Hecke") == "van Hecke" && SoccerScene.surname("Alexis Mac Allister") == "Mac Allister"
              && SoccerScene.surname("Rayan") == "Rayan", "surnames for the stamp: particles kept, a single name whole")
        check(SoccerScene.minute("90'+3'") == "90+3'" && SoccerScene.minute("68'") == "68'", "minutes: 68', 90+3'")

        // MARK: Moments

        let header = find("Gabriel Magalhães (Arsenal) header from very close range")
        if let s = header?.scene {
            let build = s.buildUp
            check(s.outcome == .goal && s.shot.technique == .header && s.start == .openPlay && s.side == .top && s.minute == "68'",
                  "Arsenal 2-0: Gabriel's header, home, attacking right, 68'")
            check(build.count == 8 && build.last?.kind == .cross && build.last?.lofted == true && build.last?.player == "Ben White"
                  && near(build.last?.to, s.shot.from), "…the last eight touches of a nine-pass move, White's cross in the air to his head",
                  "\(build.map(\.player))")
            check(s.assist == "Ben White" && s.shot.from.x > Pitch.length - Pitch.sixDepth && s.distance == 6,
                  "…assisted by White, from inside the six-yard box (6 yd)")
            if let mouth = s.shot.mouth {
                check(mouth.y > Pitch.posts.near && mouth.y < Pitch.posts.far && mouth.z < Pitch.goalHeight && mouth.y > Pitch.width / 2,
                      "…to the bottom left corner: inside the posts, under the bar, to the header's left", "y \(mouth.y) z \(mouth.z)")
            }
        } else {
            check(false, "Gabriel's header parses")
        }
        if let s = find("Erling Haaland (Manchester City) header from very close range")?.scene {
            check(s.start == .freeKick && s.touches.first?.kind == .restart && s.touches.first?.player == "Enzo Fernández"
                  && s.buildUp.last?.kind == .cross && s.side == .bottom && s.shot.from.x < Pitch.sixDepth,
                  "Haaland's equalizer: Fernández's free kick, Ndiaye's cross, the away side attacking left",
                  "\(s.touches.map(\.player)) from \(s.shot.from)")
        }
        if let s = find("Ezri Konsa (Arsenal) right footed shot from very close range")?.scene {
            check(s.start == .corner && s.touches.contains { $0.kind == .shot && $0.player == "Gabriel Magalhães" }
                  && s.touches.contains { $0.defending && $0.player == "Jordan Pickford" } && s.keeper.name == "Jordan Pickford",
                  "Konsa from the scramble: a corner, Gabriel's header saved by Pickford, the rebound", "\(s.touches.map(\.player))")
        }
        let save = find("Rayan Cherki (Manchester City) left footed shot from the centre")
        if let s = save?.scene {
            check(s.outcome == .saved && s.keeper.name == "Zion Suzuki" && s.keeper.at.map { $0.x < Pitch.sixDepth } == true
                  && s.shot.stopped.map { $0.x < 2 } == true && s.rebound == nil,
                  "Cherki's chance: saved by Suzuki on his line, and held", "\(String(describing: s.keeper)) \(String(describing: s.rebound))")
            check(SoccerFrame.detail(s) == "SAVED BY SUZUKI · 13 YD", "…its stamp: saved by Suzuki, 13 yards out", SoccerFrame.detail(s))
        } else {
            check(false, "Cherki's save parses")
        }
        let blocked = find("Erling Haaland (Manchester City) header from the centre of the box is blocked")
        if let s = blocked?.scene {
            check(s.outcome == .blocked && s.blocker?.name == "Ian Maatsen" && s.blocker?.at != nil && s.shot.stopped != nil
                  && s.shot.technique == .header && s.buildUp.last?.kind == .cross,
                  "Haaland's header blocked by Maatsen, from Foden's cross")
        }
        let post = find("Iliman Ndiaye (Manchester City) hits the left post")
        if let s = post?.scene {
            check(s.outcome == .woodwork && !s.crossbar && s.rebound.map { $0.x < 0 } == true && s.buildUp.count >= 5,
                  "Ndiaye off the left post, the ball out behind, after a six-pass move", "\(s.buildUp.count) touches")
        }
        let penalty = find("converts the penalty")
        if let s = penalty?.scene {
            check(s.start == .penalty && s.touches.isEmpty && s.shot.penalty && near(s.shot.from, CGPoint(x: Pitch.length - Pitch.spot, y: 34), 0.1)
                  && s.distance == 12, "McBurnie's penalty: from the spot, no build-up, 12 yd")
        }
        let ownGoal = find("Own Goal by Mike Penders")
        if let s = ownGoal?.scene {
            check(s.outcome == .ownGoal && s.shooter == "Mike Penders" && s.side == .bottom && s.start == .corner && s.scored,
                  "Penders' own goal: credited to Tottenham (away, attacking left), off a corner")
        }
        if let s = find("Dango Ouattara (Brentford) right footed shot from very close range")?.scene {
            check(s.shot.technique == .volley && s.touches.contains { $0.kind == .shot && $0.player == "Mikkel Damsgaard" }
                  && s.touches.contains { $0.defending }, "Ouattara's volley: after Damsgaard's header and a Hull touch")
        }
        if let s = find("Joe Gelhardt (Hull City) left footed shot from the centre of the box is close")?.scene {
            check(s.outcome == .wide && (s.shot.xg ?? 0) >= PitchAction.bigChanceXG && SoccerFrame.detail(s) == "BIG CHANCE · 0.61 XG · WIDE",
                  "Gelhardt's miss: a big chance, wide", SoccerFrame.detail(s))
        }
        // A late goal that changes the result.
        if var s = header?.scene {
            s.clock = 88 * 60
            (s.topScore, s.bottomScore) = (2, 2)
            let leveller = SoccerScene.decides(s)
            (s.topScore, s.bottomScore) = (3, 2)
            let winner = SoccerScene.decides(s)
            (s.topScore, s.bottomScore) = (3, 0)
            let cushion = SoccerScene.decides(s)
            s.clock = 60 * 60
            (s.topScore, s.bottomScore) = (2, 2)
            check(leveller && winner && !cushion && !SoccerScene.decides(s), "decisive: a late equalizer or winner, not a third goal or a 60th-minute one")
        }

        // MARK: What's news

        if let s = header?.scene, let when = s.wallclock {
            let opened = SoccerFeed.theater(s, after: SoccerTheaterState(), primed: false, now: when + 600)
            let fresh = SoccerFeed.theater(s, after: SoccerTheaterState(), primed: false, now: when + 25)
            let arrived = SoccerFeed.theater(s, after: SoccerTheaterState(scene: save?.scene, news: false), primed: true, now: .distantFuture)
            let again = SoccerFeed.theater(s, after: SoccerTheaterState(scene: s, news: false), primed: true, now: .distantFuture)
            check(!opened.news && fresh.news && arrived.news && !again.news,
                  "news: a moment that arrives while the page is open, or one 25 s old; not one ten minutes old, nor one already showing")
        }

        // MARK: Choreography

        let scripts = scenes.map { ($0, SoccerScript($0)) }
        let finite = scripts.allSatisfy { _, s in
            stride(from: 0.0, through: s.duration, by: 0.05).allSatisfy { t in
                s.actors.allSatisfy { a in let p = a.position(at: t); return p.x.isFinite && p.y.isFinite }
                    && (s.ball(at: t).map { $0.x.isFinite && $0.y.isFinite && $0.z.isFinite && $0.z >= -0.01 } ?? true)
            }
        }
        check(finite, "every moment's players and ball stay finite, the ball never under the grass")
        let lengths = scripts.map { $0.1.duration }
        check(lengths.allSatisfy { $0 >= 3 && $0 <= 11 }, "every replay runs 3–11 s",
              "\(String(format: "%.1f", lengths.min() ?? 0))–\(String(format: "%.1f", lengths.max() ?? 0))")
        // The ball never jumps: each flight starts where (and how high) the one before ended, or at a player's feet.
        let jumps = scripts.filter { _, s in
            zip(s.flights, s.flights.dropFirst()).contains { a, b in
                b.start <= a.end + 0.2 && abs(b.from.z - a.to.z) > 0.3 && hypot(b.from.x - a.to.x, b.from.y - a.to.y) < 1.5
            }
        }
        check(jumps.isEmpty, "the ball never jumps between flights (a cross arrives at the head that meets it)",
              jumps.map { $0.0.shooter }.joined(separator: ", "))
        check(scripts.allSatisfy { _, s in zip(s.flights, s.flights.dropFirst()).allSatisfy { $0.start <= $1.start + 1e-9 } }
              && scripts.allSatisfy { _, s in s.shot.map { s.flights[$0].start == s.strike } == true },
              "the ball's flights run in order, the shot at the strike")
        // Pass to pass: whoever plays it is on it, whoever it finds is there when it arrives.
        let passes = scripts.flatMap { scene, s in s.flights.filter { $0.kind == .pass && $0.end <= s.strike }.map { (scene, s, $0) } }
        let played = passes.filter { _, s, f in s.actors.contains { near($0.position(at: f.start), f.from.ground, 0.6) } }.count
        let found = passes.filter { _, s, f in s.actors.contains { near($0.position(at: f.end), f.to.ground, 0.6) } }.count
        let lost = passes.filter { _, s, f in !s.actors.contains { near($0.position(at: f.end), f.to.ground, 0.6) } }
        check(passes.count > 30 && played == passes.count && found == passes.count,
              "every pass leaves a player's feet and finds one standing where ESPN says", "\(played), \(found) of \(passes.count): "
                + lost.map { scene, s, f in "\(scene.shooter) \(f.to.ground) at \(f.end): \(s.actors.map { "\($0.name) \($0.position(at: f.end))" })" }.joined(separator: " | "))
        let carries = scripts.flatMap { _, s in s.flights.filter { $0.kind == .carry && $0.end > $0.start + 0.05 }.map { (s, $0) } }
        let loose = carries.filter { s, f in
            !stride(from: f.start, through: f.end, by: 0.05).allSatisfy { t in s.actors.contains { near($0.position(at: t), f.point(at: t).ground, 0.6) } }
        }
        check(loose.isEmpty, "a man running with it keeps it at his feet",
              loose.prefix(3).map { s, f in "\(f.from.ground)→\(f.to.ground) \(f.start)–\(f.end): "
                + (s.actors.min { hypot($0.position(at: (f.start + f.end) / 2).x - f.point(at: (f.start + f.end) / 2).x, $0.position(at: (f.start + f.end) / 2).y - f.point(at: (f.start + f.end) / 2).y) < hypot($1.position(at: (f.start + f.end) / 2).x - f.point(at: (f.start + f.end) / 2).x, $1.position(at: (f.start + f.end) / 2).y - f.point(at: (f.start + f.end) / 2).y) }.map { "\($0.name) \($0.position(at: (f.start + f.end) / 2)) vs \(f.point(at: (f.start + f.end) / 2).ground) moves \($0.moves.map { "\($0.start)-\($0.end)" })" } ?? "") }.joined(separator: " | "))

        if let s = header?.scene {
            let script = SoccerScript(s)
            let shot = script.shot.map { script.flights[$0] }
            check(shot.map { $0.to.x == Pitch.length && $0.to.y == s.shot.mouth?.y && $0.to.z == s.shot.mouth?.z } == true && shot?.from.z ?? 0 > 1.5,
                  "a goal: the header flies from head height to the exact point in the mouth")
            let rest = script.ball(at: .infinity)
            check(rest.map { $0.x > Pitch.length && $0.z < 0.5 } == true && script.impacts.contains { $0.kind == .net }, "…into the net, which ripples")
            check(script.banners.map(\.text) == ["GOAL"] && script.banners[0].tone == .team && script.banners[0].confetti
                  && script.banners[0].at >= script.arrive && script.stamp > script.arrive,
                  "…GOAL lands as it goes in, in the team's color, then the stamp")
            let scorer = script.actors.firstIndex { $0.name == s.shooter && $0.team == .attacking }
            check(scorer.map { i in script.actors[i].actions.contains { $0.kind == .celebrate }
                    && hypot(script.actors[i].position(at: .infinity).x - s.shot.from.x, script.actors[i].position(at: .infinity).y - s.shot.from.y) > 6 } == true,
                  "…and the scorer wheels away, arms up")
            var late = s
            late.decisive = true
            check(SoccerScript(late).banners.first?.tone == .gold, "a late winner's headline is gold")
            check(SoccerFrame.detail(s) == "AST WHITE · HEADER · 6 YD", "…its stamp: the assist, how, how far", SoccerFrame.detail(s))
        }
        if let s = save?.scene {
            let script = SoccerScript(s)
            let end = script.shot.map { script.flights[$0].to }
            let keeper = script.actors.first { $0.role == .keeper }
            let hands = keeper?.dive?.target ?? keeper.map { FieldPoint($0.position(at: script.arrive)) }
            check(end != nil && hands != nil && hypot(end!.x - hands!.x, end!.y - hands!.y) < 1.0 && script.heldBy != nil
                  && script.impacts.contains { $0.kind == .save && $0.at == script.arrive },
                  "a save: the keeper's hands are where the ball is when it gets there, and he holds on")
            check(script.banners.map(\.text) == ["SAVE"] && script.banners[0].tone == .neutral, "…SAVE, in neutral ink")
        }
        if let s = blocked?.scene {
            let script = SoccerScript(s)
            let end = script.shot.map { script.flights[$0].to.ground }
            check(script.actors.contains { $0.team == .defending && $0.role == .outfield && near($0.position(at: script.arrive), end, 0.6) }
                  && script.banners.isEmpty && script.impacts.contains { $0.kind == .block },
                  "a block: the shot stops at the defender in its way; no headline")
        }
        if let s = post?.scene {
            let script = SoccerScript(s)
            let end = script.shot.map { script.flights[$0].to }
            check(end.map { abs($0.y - Pitch.posts.near) < 0.01 || abs($0.y - Pitch.posts.far) < 0.01 } == true
                  && script.impacts.contains { $0.kind == .woodwork } && script.banners.first?.text == "OFF THE POST",
                  "the woodwork: onto the post, which rings: OFF THE POST")
        }
        if let s = penalty?.scene {
            let script = SoccerScript(s)
            let taker = script.actors.first { $0.name == s.shooter }
            check(script.banners.map(\.text) == ["PENALTY", "GOAL"] && script.banners[0].until < script.banners[1].at,
                  "a penalty: PENALTY as it's set, then GOAL, one at a time")
            check(taker.map { hypot($0.position(at: 0).x - s.shot.from.x, $0.position(at: 0).y - s.shot.from.y) > 2
                    && near($0.position(at: script.strike), s.shot.from, 0.6) } == true,
                  "…the taker runs up to it from the edge of the D")
            let keeper = script.actors.first { $0.role == .keeper }
            check(keeper.map { abs($0.position(at: script.strike).x - Pitch.length) < 0.6 } == true, "…the keeper on his line")
        }
        if let s = ownGoal?.scene {
            let script = SoccerScript(s)
            check(script.banners.first?.text == "OWN GOAL" && script.actors.contains { $0.name == s.shooter && $0.team == .defending }
                  && script.ball(at: .infinity).map { $0.x < 0 } == true, "an own goal: OWN GOAL, the defender who turned it in, in his own net")
        }

        // MARK: The camera

        let size = CGSize(width: 640, height: 320)
        func inView(_ p: FieldPoint, _ frame: CameraFrame, slack: Double = 0) -> Bool {
            let q = PitchProjection(size: size, camera: frame).point(p)
            return q.x >= -slack * size.width && q.x <= size.width * (1 + slack) && q.y >= -slack * size.height && q.y <= size.height * (1 + slack)
        }
        var seen = 0, total = 0
        for (_, s) in scripts {
            for t in stride(from: 0.4, to: s.strike, by: 1.0 / 30) {
                guard let ball = s.ball(at: t) else { continue }
                total += 1
                if inView(ball, s.frame(at: t), slack: 0.02) { seen += 1 }
            }
        }
        check(total > 500 && Double(seen) / Double(total) > 0.97, "the camera rides the ball through every build-up", "\(seen) of \(total) frames")
        let struck = scripts.filter { scene, s in
            let goal = SoccerScript.goalFrame(right: scene.attacksRight)
            return goal.prefix(4).allSatisfy { inView($0, s.frame(at: s.arrive), slack: 0.02) }
        }.count
        check(struck == scripts.count, "…and has the goal mouth in frame as the shot gets there", "\(struck) of \(scripts.count)")
        let wider = scripts.filter { scene, s in
            guard scene.distance <= 25 else { return false }
            let buildUp = stride(from: 0.4, to: max(s.strike - 0.6, 0.41), by: 0.1).map { s.frame(at: $0).span }
            return !(buildUp.isEmpty || s.frame(at: s.arrive).span <= (buildUp.max() ?? 0) + 0.5)
        }
        check(wider.isEmpty, "…pushing in for the shot, never out (but for a shot from distance, which needs the width)",
              wider.map { scene, s in "\(scene.shooter) \(s.frame(at: s.arrive).span) vs \(stride(from: 0.4, to: max(s.strike - 0.6, 0.41), by: 0.1).map { s.frame(at: $0).span }.max() ?? 0)" }.joined(separator: " | "))
        if let s = header?.scene {
            let script = SoccerScript(s)
            let end = script.frame(at: .infinity)
            let scorer = script.actors.first { $0.name == s.shooter }
            check(SoccerScript.goalFrame(right: true).prefix(4).allSatisfy { inView($0, end) } && scorer.map { inView(FieldPoint($0.position(at: .infinity)), end) } == true,
                  "it ends on the goal and the scorer")
            let settled = script.frame(at: script.settle)
            check(script.frame(at: script.duration) == end && hypot(settled.x - end.x, settled.y - end.y) < 0.01 && abs(settled.span - end.span) < 0.01,
                  "…and holds that frame from the moment the play has settled", "\(settled) vs \(end)")
        }
        let calm = scripts.allSatisfy { _, s in
            zip(s.camera, s.camera.dropFirst()).allSatisfy { a, b in hypot(b.x - a.x, b.y - a.y) * CameraFollow.rate <= 1.45 * a.span + 0.01 }
        }
        check(calm, "the camera never pans faster than 1.4 view-heights a second")
        check(PitchCamera.fitting([PitchCamera.Room(FieldPoint(x: 52.5, y: 34), figure: true)], headroom: CameraFrame.headroom, closest: 12).span >= 12,
              "no closer than it's asked")

        // MARK: Who celebrates

        let goalMoment = LiveMoment(id: "g", chart: .pitch, tier: .score, kind: .goal, lead: "Goal", detail: "")
        var post2 = LiveMoment(id: "p", chart: .pitch, tier: .swing, kind: .shotWide, lead: "Off the woodwork", detail: "")
        post2.accents = .woodwork
        let wide = LiveMoment(id: "w", chart: .pitch, tier: .swing, kind: .shotWide, lead: "Wide", detail: "")
        let card = LiveMoment(id: "c", chart: .pitch, tier: .swing, kind: .card(red: false), lead: "Yellow card", detail: "")
        check(GoalCelebration.theaterOwns(goalMoment) && GoalCelebration.theaterOwns(post2) && !GoalCelebration.theaterOwns(wide)
              && !GoalCelebration.theaterOwns(card), "the theater owns goals, saves, blocks, the woodwork and big chances; not cards or a plain miss")
        check(!GoalCelebration.pitchBursts(goalMoment, theaterShown: true) && GoalCelebration.pitchBursts(goalMoment, theaterShown: false)
              && GoalCelebration.pitchBursts(card, theaterShown: true), "…so the Live Pitch only bursts for a goal when the theater isn't on the page")
        if let found = header, let s = Optional(found.scene) {
            let script = SoccerScript(s)
            var m = SoccerFeed.action(found.clip.plays[found.index], index: 0, homeTeamID: found.clip.home)?.moment
            m?.burst = true
            let bursts = GoalCelebration.theater(m, scene: s, script: script, level: .full, reduceMotion: false, height: 320)
            let net = script.impacts.first { $0.kind == .net }?.at ?? 0
            let fireworks = bursts.first { $0.cue.effects.contains { if case .fireworks = $0 { return true }; return false } }
            check(fireworks.map { abs($0.at + $0.cue.delay - net) < 0.01 && $0.cue.effects.contains(.fireworks(shells: 2)) } == true
                  && bursts.contains { $0.anchor == .banner }, "a goal's fireworks burst over the net as it goes in, with confetti off GOAL")
            check(GoalCelebration.theater(m, scene: s, script: script, level: .off, reduceMotion: false, height: 320).isEmpty,
                  "…none at Off")
            let calmed = GoalCelebration.theater(m, scene: s, script: script, level: .full, reduceMotion: true, height: 320)
            check(!calmed.isEmpty && calmed.allSatisfy { $0.cue.effects.allSatisfy { if case .bloom = $0 { return true }; return false } },
                  "…a bloom with Reduce Motion")
            var cooled = m
            cooled?.burst = false
            check(GoalCelebration.theater(cooled, scene: s, script: script, level: .full, reduceMotion: false, height: 320)
                .allSatisfy { !$0.cue.bursts }, "…sparks inside the ten-second cooldown")
            var late = s
            late.decisive = true
            let gold = GoalCelebration.theater(m, scene: late, script: SoccerScript(late), level: .full, reduceMotion: false, height: 320)
            check(gold.contains { $0.cue.gold && $0.cue.effects.contains(.fireworks(shells: 3)) }, "…three shells in gold for a late winner")
            check(GoalCelebration.theater(goalMoment, scene: s, script: script, level: .full, reduceMotion: false, height: 320).isEmpty,
                  "…and nothing for another moment")
        }
        if let found = save {
            var m = SoccerFeed.action(found.clip.plays[found.index], index: 0, homeTeamID: found.clip.home)?.moment
            m?.burst = true
            let script = SoccerScript(found.scene)
            let bursts = GoalCelebration.theater(m, scene: found.scene, script: script, level: .full, reduceMotion: false, height: 320)
            check(bursts.count == 1 && bursts[0].cue.glint && !bursts[0].cue.bursts, "a save glints in the keeper's hands (sparks, no confetti)")
        }

        // MARK: Drawn

        // The last frame of a replay is the moment at rest, pixel for pixel.
        if let s = header?.scene {
            let script = SoccerScript(s)
            let teams = SoccerTeams(attacking: Uniform(.red), defending: Uniform(.blue))
            func frame(_ t: Double) -> Data? {
                let view = ZStack {
                    PitchLayer(ink: TheaterInk(.dark), camera: script.frame(at: t))
                    SoccerFrame(scene: s, script: script, t: t, teams: teams, ink: TheaterInk(.dark), size: CGSize(width: 312, height: 156))
                }
                .frame(width: 312, height: 156)
                .background(Color(white: 0.16))
                .environment(\.colorScheme, .dark)
                let renderer = ImageRenderer(content: view)
                renderer.scale = 2
                return renderer.cgImage?.dataProvider?.data as Data?
            }
            let rest = frame(.infinity)
            check(rest != nil && frame(script.duration) == rest, "a replay ends exactly on the frame it holds")
            check(frame(script.strike) != rest, "…and mid-play it isn't (the comparison sees the play)")
        }
        check(SoccerTheater.sentences("with a cross.Goal confirmed following VAR Review.") == "with a cross. Goal confirmed following VAR Review."
              && SoccerTheater.sentences("0.39 xG.") == "0.39 xG.", "the caption puts a space where ESPN ran two sentences together")
    }
}
