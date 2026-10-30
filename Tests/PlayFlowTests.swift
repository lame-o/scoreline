import SwiftUI

// The play flow on the isometric views, all four sports: a replay that comes
// in while the field between plays is on screen takes over from it
// (TheaterBridge: each figure from where he is, or a quick crossfade when
// the play starts far off, and with Reduce Motion); an official on the field
// only while the data has him doing something; and the action slowed where
// it ran faster than life (football's snap to dead ball 1.3×, basketball's
// approach 1.2×, soccer's build-up 1.3×), the walk-up, the hold and the
// reset at their own pace.

extension ScorelineTests {
    static func playFlow() {
        print("\nPlay flow: the hand-off from the idle, the officials, the pace")
        let dir = FixtureProtocol.directory
        guard let mnf = try? Data(contentsOf: dir.appendingPathComponent("mnf-dal-phi-plays.json")),
              let nba = try? Data(contentsOf: dir.appendingPathComponent("nba-theater-plays.json")),
              let epl = try? Data(contentsOf: dir.appendingPathComponent("soccer-theater-plays.json")),
              let stops = try? Data(contentsOf: dir.appendingPathComponent("nfl-stoppages-plays.json")) else {
            return check(false, "the MNF, NBA, soccer and stoppage fixtures load")
        }
        let nflTeams = FootballFeed.Teams(topIsHome: false, topID: "6", bottomID: "21", homeAbbreviation: "PHI", awayAbbreviation: "DAL")
        let nfl = JSON(data: mnf)["items"].array.compactMap { FootballScene.parse($0, teams: nflTeams) }
        let games = JSON(data: nba)["games"].array
        let hoops: [BasketballScene] = games.flatMap { g -> [BasketballScene] in
            let teams = BasketballFeed.Teams(topIsHome: false, topID: g["away"]["id"].string, bottomID: g["home"]["id"].string,
                                             topName: g["away"]["abbreviation"].string ?? "", bottomName: g["home"]["abbreviation"].string ?? "")
            let items = g["items"].array
            return items.indices.compactMap { BasketballScene.parse(items, at: $0, teams: teams) }
        }
        let matches = JSON(data: epl)["matches"].array
        func near(_ a: CGPoint, _ b: CGPoint, _ tolerance: Double = 0.01) -> Bool { hypot(a.x - b.x, a.y - b.y) <= tolerance }

        // MARK: The bridge's plan

        let idleMen = [TheaterBridge.Figure(group: 0, kind: "qb", at: CGPoint(x: 0, y: -24)), TheaterBridge.Figure(group: 0, kind: "wr", at: CGPoint(x: 10, y: -20)),
                       TheaterBridge.Figure(group: 1, kind: "cb", at: CGPoint(x: 12, y: 18)), TheaterBridge.Figure(group: 2, at: CGPoint(x: 80, y: 0))]
        let replayMen = [TheaterBridge.Figure(group: 0, kind: "wr", at: CGPoint(x: 40, y: -2)), TheaterBridge.Figure(group: 0, kind: "qb", at: CGPoint(x: 0, y: -15)),
                         TheaterBridge.Figure(group: 1, kind: "cb", at: CGPoint(x: 40, y: 15)), TheaterBridge.Figure(group: 1, kind: "lb", at: CGPoint(x: 0, y: 12))]
        let pairs = TheaterBridge.match(idle: idleMen, replay: replayMen)
        check(pairs == [0: 1, 1: 0, 2: 2], "who becomes whom: each man the replay has, the idle's man of his kind on his side (the staff never); a man the idle didn't have fades in",
              "\(pairs)")
        let roomy = TheaterBridge.plan(idle: idleMen, replay: replayMen, room: 1.0, far: 40)
        let tight = TheaterBridge.plan(idle: idleMen, replay: replayMen, room: 0.2, far: 40)
        check(roomy.mode == .bridge && roomy.length >= TheaterBridge.shortest && roomy.length <= TheaterBridge.longest && roomy.lead == 0
              && abs(tight.length - roomy.length) < 1e-9 && abs(tight.lead - (tight.length - 0.2)) < 1e-9,
              "the bridge (0.5–0.7 s) runs inside the replay's own lead-in when it fits; only what doesn't fit is added in front",
              String(format: "%.2f %.2f %.2f", roomy.length, roomy.lead, tight.lead))
        let half = roomy.weight(roomy.length * 0.25)
        check(roomy.weight(0) == 0 && abs(half - Celebrate.sweepCurve.value(at: 0.25)) < 1e-9 && abs(roomy.weight(roomy.end) - 1) < 1e-9
              && TheaterBridge.ease(0.5) == Celebrate.sweepCurve.value(at: 0.5),
              "the hand-off eases on the name glide's curve, cubic-bezier(0.77, 0, 0.175, 1): from the idle at 0 to the replay at the bridge's end")
        let finishing = TheaterBridge.plan(idle: idleMen, replay: replayMen, room: 1.0, far: 40, beatLeft: 0.22)
        let midBeat = TheaterBridge.plan(idle: idleMen, replay: replayMen, room: 1.0, far: 40, beatLeft: 1.4)
        check(abs(finishing.wait - 0.22) < 1e-9 && finishing.weight(0.2) == 0 && finishing.replayTime(finishing.wait + finishing.lead) == 0 && midBeat.wait == 0,
              "an idle beat 0.3 s or less from its end finishes first (its last moment, then the bridge); one further off doesn't wait")
        let reduced = TheaterBridge.plan(idle: idleMen, replay: replayMen, room: 0.2, far: 40, reduceMotion: true, beatLeft: 0.2)
        check(reduced.mode == .crossfade && reduced.length == TheaterBridge.crossfade && reduced.pairs.isEmpty && reduced.delay == 0
              && TheaterBridge.fade(0.5) == Motion.curve.value(at: 0.5),
              "with Reduce Motion: a 0.25 s crossfade (ease-out), nothing travels, nothing waits")
        let far = TheaterBridge.plan(idle: idleMen, replay: replayMen, room: 1.0, far: 5)
        let apart = TheaterBridge.plan(idle: idleMen, replay: replayMen, room: 1.0, far: 40, together: false)
        check(far.mode == .crossfade && far.moved > 5 && apart.mode == .crossfade && far.length == TheaterBridge.crossfade,
              "a play that starts far from where the idle stands (the median move past the sport's far rule), or at another end: a quick crossfade instead")
        TheaterDelays.note("flow-test", roomy.delay + 0.3)
        check(abs(TheaterDelays.delay("flow-test") - 0.3) < 1e-9 && TheaterDelays.delay("never-bridged") == 0,
              "a bridged replay's late start is noted for its play, so the scoring slide still lands with its climax")

        // MARK: Football: the field between snaps into the snap's formation

        guard let pass = nfl.first(where: { $0.kind == .pass && $0.text.contains("short") }), let offense = pass.offense else {
            return check(false, "a short pass on Monday night")
        }
        let yaw = FieldFacing.yaw(pass.offense, period: pass.period, flipped: false)
        let replay = FootballScript(pass, yaw: yaw)
        let lined = FootballIdle.make(play: nil, stoppage: nil, rest: FootballScript.Rest(yard: pass.from, gain: nil), offense: offense, down: nil,
                                      kickoff: false, flipped: false)
        let idle = FootballScript(idle: lined)
        // Mid-beat: the huddle broken, the men jogging to the line.
        let t0 = stride(from: 7.6, through: 10.0, by: 0.2).first { idle.moving(at: $0)
            && FootballTheater.bridge(from: idle, offense: offense, at: $0, to: replay, offense: offense, reduceMotion: false).mode == .bridge } ?? 8.4
        let plan = FootballTheater.bridge(from: idle, offense: offense, at: t0, to: replay, offense: offense, reduceMotion: false)
        let tracks = TheaterBridge.tracks(plan, height: 8.5, idle: { j, s in
            (idle.players[j].position(at: idle.idleTime(t0 + s)), idle.rig[j].motion(at: idle.idleTime(t0 + s)).heading)
        }, replay: { i, s in (replay.players[i].position(at: plan.replayTime(s)), replay.rig[i].motion(at: plan.replayTime(s)).heading) })
        check(plan.mode == .bridge && plan.pairs.count >= 20 && abs(plan.lead - max(plan.length - replay.leadIn, 0)) < 1e-9 && replay.leadIn >= 0.5
              && replay.leadIn < 0.6,
              "football: a snap that comes in as the men jog to the line bridges from there, inside the formation's half second before the snap (and a little more)",
              describe(plan))
        let starts = plan.pairs.allSatisfy { r, i in
            guard tracks[r] != nil else { return false }
            let from = idle.players[i].position(at: idle.idleTime(t0)), to = replay.players[r].position(at: plan.replayTime(plan.end))
            return near(TheaterBridge.mix(from, replay.players[r].position(at: plan.replayTime(0)), plan.weight(0)), from)
                && near(TheaterBridge.mix(idle.players[i].position(at: idle.idleTime(t0 + plan.end)), to, plan.weight(plan.end)), to)
        }
        check(starts, "…each man starts where the idle has him on screen and ends on his place in the formation: no jump either end")
        let size = CGSize(width: 312, height: 156)
        let teams = FootballTeams(offense: Uniform(.red), defense: Uniform(.blue))
        func camera(_ s: Double) -> CameraFrame {
            FootballFrame(scene: pass, script: replay, t: plan.replayTime(s), teams: teams, ink: TheaterInk(.dark), size: size,
                          bridge: FootballFrame.Bridge(script: idle, t: idle.idleTime(t0 + s), w: plan.weight(s), s: s, pairs: plan.pairs, tracks: tracks))
                .projection(size).camera
        }
        let landed = replay.camera.frame(at: plan.replayTime(plan.end))
        check(camera(0) == idle.camera.frame(at: idle.idleTime(t0)) && abs(camera(plan.end - 1e-4).x - landed.x) < 0.05 && abs(camera(plan.end - 1e-4).span - landed.span) < 0.05,
              "…the camera eases from the idle's framing to the replay's")
        let walked = FootballIdle.make(play: nil, stoppage: nil, rest: FootballScript.Rest(yard: pass.from + 6, gain: nil), offense: offense, down: nil,
                                       kickoff: false, flipped: false)
        let walkedPlan = FootballTheater.bridge(from: FootballScript(idle: walked), offense: offense, at: 16, to: replay, offense: offense, reduceMotion: false)
        let otherEnd = FootballIdle.make(play: nil, stoppage: nil, rest: FootballScript.Rest(yard: 100 - pass.from, gain: nil), offense: FootballScene.opponent(offense),
                                         down: nil, kickoff: false, flipped: false)
        let otherPlan = FootballTheater.bridge(from: FootballScript(idle: otherEnd), offense: otherEnd.offense, at: 16, to: replay, offense: offense, reduceMotion: false)
        check(walkedPlan.mode == .crossfade && walkedPlan.moved > TheaterBridge.Far.football && otherPlan.mode == .crossfade,
              "…the idle already at the next down's spot (six yards on), or the other team's ball: a crossfade into the formation (four yards, median)",
              describe(walkedPlan))
        check(FootballTheater.bridge(from: idle, offense: offense, at: t0, to: replay, offense: offense, reduceMotion: true).mode == .crossfade,
              "…with Reduce Motion, a crossfade")

        // MARK: Basketball: the half-court set into the replay's

        let ends = HoopsEnds(topRight: true, topOpensRight: true)
        if let three = hoops.first(where: { $0.replays && $0.kind == .three }) {
            let replay = BasketballScript(three, right: ends.right(three.offense))
            let rest = BasketballScript(rest: BasketballScript.Rest(offense: three.offense, ends: ends, phase: .live, seed: "flow"))
            let t = rest.active.dropFirst().first.map { ($0.lowerBound + $0.upperBound) / 2 } ?? 6
            let plan = BasketballTheater.bridge(from: rest, at: t, to: replay, reduceMotion: false)
            let other = BasketballScript(rest: BasketballScript.Rest(offense: three.offense == .top ? .bottom : .top, ends: ends, phase: .live, seed: "flow"))
            check(plan.mode == .bridge && plan.pairs.count == 10 && plan.moved <= TheaterBridge.Far.basketball
                  && BasketballTheater.bridge(from: other, at: t, to: replay, reduceMotion: false).mode == .crossfade
                  && BasketballTheater.bridge(from: rest, at: t, to: replay, reduceMotion: true).mode == .crossfade,
                  "basketball: a basket that comes in mid-beat of the half-court set bridges all ten from where they are; with the ball the other way (the other end), or Reduce Motion, a crossfade",
                  describe(plan))
        } else { check(false, "a three that replays") }

        // MARK: Soccer: the ball going round into the move's first touch

        let match = matches[0], home = match["home"]["id"].string
        let lineups = SoccerLineup.lineups(match["rosters"]) { $0 == home ? .top : .bottom }
        var soccerBridged = false, soccerFar = false, soccerReduced = false
        for clip in match["clips"].array.map(\.array) {
            for i in clip.indices where SoccerScene.isMoment(clip[i]) {
                guard let scene = SoccerScene.parse(clip, at: i, homeTeamID: home, keepers: SoccerScene.keepers(in: clip)), scene.touches.count >= 2 else { continue }
                let drawn = PitchFacing.homeAttacksRight(period: scene.period, flipped: false) ? scene : scene.turned()
                let replay = SoccerScript(drawn, lineups: lineups)
                let start = scene.touches.first?.at ?? scene.shot.from
                func idle(_ at: CGPoint) -> (SoccerIdle, SoccerScript) {
                    let idle = SoccerIdle.make(event: nil, touch: SoccerTouch(side: scene.side, at: at, order: 0, period: scene.period), scene: nil,
                                               period: scene.period, lineups: lineups, flipped: false)
                    return (idle, SoccerScript(idle: idle))
                }
                let (near, nearScript) = idle(start), (away, awayScript) = idle(CGPoint(x: Pitch.length - start.x, y: start.y))
                let plan = SoccerTheater.bridge(from: nearScript, possession: near.possession, at: 1, to: replay, side: drawn.side, reduceMotion: false)
                if plan.mode == .bridge, plan.pairs.count >= 20 { soccerBridged = true }
                if SoccerTheater.bridge(from: awayScript, possession: away.possession, at: 1, to: replay, side: drawn.side, reduceMotion: false).mode == .crossfade,
                   Pitch.length - 2 * start.x > 40 || 2 * start.x - Pitch.length > 40 { soccerFar = true }
                if SoccerTheater.bridge(from: nearScript, possession: near.possession, at: 1, to: replay, side: drawn.side, reduceMotion: true).mode == .crossfade {
                    soccerReduced = true
                }
            }
        }
        check(soccerBridged && soccerFar && soccerReduced,
              "soccer: a moment whose move starts where the ball was going round bridges both elevens (the same men, by athlete); one in the other half crossfades; Reduce Motion crossfades")

        // MARK: Baseball: the routine between pitches into the pitch

        let rest = PlayScript.Rest(bases: [true, false, false], bats: .right, fieldingHome: false)
        let pitch = PlayScript(beat: PlayBeat(id: "flow", kind: .pitch(PlayBeat.Pitch(call: .ball, number: 1, balls: 1, strikes: 0))), rest: rest)
        let routine = PlayScript(idle: .lead, rest: rest, seed: 3, arm: .right)
        let bbPlan = PlayTheater.bridge(from: routine, at: routine.duration / 2, to: pitch, reduceMotion: false, beatLeft: routine.duration / 2)
        check(bbPlan.mode == .bridge && bbPlan.pairs.count == pitch.actors.count && bbPlan.lead == 0
              && PlayTheater.bridge(from: routine, at: 1, to: pitch, together: false, reduceMotion: false).mode == .crossfade
              && PlayTheater.bridge(from: routine, at: 1, to: pitch, reduceMotion: true).mode == .crossfade,
              "baseball: a pitch that comes in mid-routine (the runner stretching his lead) bridges every figure, the umpire too, inside the pitch's own wind-up; the other half's field, or Reduce Motion, a crossfade",
              describe(bbPlan))

        // MARK: Officials: only while the data has one doing something

        let flagged = nfl.filter { !$0.flags.isEmpty }
        let replays = nfl.prefix(120).map { FootballScript($0) }
        check(replays.allSatisfy { s in s.flags.isEmpty == !s.players.contains { $0.team == .official } } && !flagged.isEmpty,
              "football: an official in a replay only when he throws a flag; none in any other")
        let throwers = flagged.prefix(20).allSatisfy { scene in
            let s = FootballScript(scene)
            return s.players.indices.filter { s.players[$0].team == .official }.allSatisfy { i in
                let p = s.players[i], thrown = p.actions.filter { $0.kind == .flagThrow }.map(\.at)
                guard let first = thrown.min(), let last = thrown.max() else { return false }
                return p.opacity(at: first - 0.4) > 0.99 && p.opacity(at: first - FootballScript.Builder.officialBefore - 0.01) == 0
                    && p.opacity(at: last + FootballScript.Builder.officialAfter + FootballScript.Player.fade + 0.01) == 0
            }
        }
        check(throwers, "…in it for his throw alone, from his post: fading in as he reaches back, gone once it's down")
        let stoppageGames = JSON(data: stops)["games"].array
        var idles: [FootballScript] = []
        for g in stoppageGames {
            let teams = FootballFeed.Teams(topIsHome: false, topID: g["away"]["id"].string, bottomID: g["home"]["id"].string,
                                           homeAbbreviation: g["home"]["abbreviation"].string ?? "", awayAbbreviation: g["away"]["abbreviation"].string ?? "")
            for item in g["items"].array {
                let play = FootballScene.parse(item, teams: teams), stop = FootballStoppage.parse(item, teams: teams)
                guard play?.review != nil || play?.injuries.isEmpty == false || stop != nil else { continue }
                let idle = FootballIdle.make(play: play, stoppage: stop, rest: FootballScript.Rest(yard: 40, gain: 50), offense: play?.offense ?? .top, down: nil,
                                             kickoff: false, flipped: false)
                idles.append(FootballScript(idle: idle))
            }
        }
        idles.append(idle)
        check(idles.count > 10 && idles.allSatisfy { !$0.players.contains { $0.team == .official } },
              "…and none between snaps: the huddle, the line, a timeout, a TV timeout, a challenge (no referee walking to the monitor), a man hurt, the half",
              "\(idles.count) idles")

        let marquees = hoops.filter(\.replays).prefix(60).map { BasketballScript($0) }
        check(marquees.allSatisfy { !$0.players.contains { $0.team == .official } }, "basketball: no referee in a replay")
        let beats = hoops.filter { !$0.replays && $0.kind != .substitution }.prefix(260).map { BasketballScript(beat: $0, group: [], ends: ends, from: nil, fallback: $0.offense) }
        let refs = beats.flatMap { s in s.players.filter { $0.team == .official }.map { (s, $0) } }
        let acting = refs.allSatisfy { s, ref in
            // Each referee does something (in to a call, signals, tosses, passes the ball), and is gone a beat after the last of it.
            let ball = s.legs.contains { if case let .held(p) = $0.hand { return s.players[p] == ref }; return false }
            let last = (ref.actions.map(\.at) + ref.moves.map(\.end) + (ball ? s.flights.map(\.start) : [])).max() ?? -1
            return (!ref.actions.isEmpty || !ref.moves.isEmpty || ball) && ref.leaves <= last + BasketballScript.Builder.signalled + 0.2
        }
        let tips = beats.filter { s in s.players.contains { p in p.actions.contains { $0.kind == .toss } } }
        let lanes = BasketballScript(rest: BasketballScript.Rest(offense: .top, ends: ends, phase: .lane, seed: "flow"))
        var onLane = BasketballScript.Rest(offense: .top, ends: ends, phase: .lane, seed: "flow")
        onLane.from = lanes.lineup(at: lanes.duration)
        let standing = BasketballScript(rest: onLane)
        check(!refs.isEmpty && acting && !tips.isEmpty && lanes.players.contains { $0.team == .official && $0.leaves < 4 }
              && !standing.players.contains { $0.team == .official }
              && !BasketballScript(rest: BasketballScript.Rest(offense: .top, ends: ends, phase: .live, seed: "flow")).players.contains { $0.team == .official },
              "…a referee only while he acts: in to his whistle and gone once his signal's down, the jump ball's toss, handing the ball for free throws; nobody standing under the basket or on the court between plays",
              "\(refs.count) referees in \(beats.count) beats")

        func soccerIdle(_ kind: SoccerEvent.Kind) -> SoccerScript {
            let event = SoccerEvent(id: "flow-\(kind)", kind: kind, side: .bottom, player: "Rodri", other: "John McGinn", at: CGPoint(x: 70, y: 30))
            return SoccerScript(idle: SoccerIdle.make(event: event, touch: nil, scene: nil, period: 1, lineups: lineups, flipped: false))
        }
        let acts: [SoccerEvent.Kind] = [.card(red: false, second: false), .offside, .substitution]
        let none: [SoccerEvent.Kind] = [.corner, .foul, .handball, .injury, .varCheck, .varDecision("No penalty"), .kickoff, .halftime]
        let props: [SoccerProp.Kind] = [.yellowCard, .flag, .board]
        let withOfficial = zip(acts, props).allSatisfy { kind, prop in
            let s = soccerIdle(kind), officials = s.actors.indices.filter { s.actors[$0].team == .official }
            return officials.count == 1 && s.props.contains { $0.kind == prop && $0.actor == officials[0] }
                && s.actors[officials[0]].appear >= 0 && s.actors[officials[0]].vanish.isFinite
                && s.props.filter { $0.actor == officials[0] }.allSatisfy { $0.until <= s.actors[officials[0]].vanish + 0.01 }
        }
        let play = SoccerScript(idle: SoccerIdle.make(event: nil, touch: nil, scene: nil, period: 1, lineups: lineups, flipped: false))
        check(withOfficial && (none.map(soccerIdle) + [play]).allSatisfy { s in !s.actors.contains { $0.team == .official } },
              "soccer: the referee for a booking (the card), the assistant for an offside (the flag), the fourth official for a substitution (the board), each fading in for it and out after; nobody for a corner, a foul, a man hurt, VAR, the kick-off, the ball going round")

        let umpire = PlayScript(rest: rest).actors.filter { $0.team == .official }
        check(umpire.count == 1 && umpire[0].role == .umpire && near(umpire[0].at, Ballpark.umpire(.right)),
              "baseball: the plate umpire stays, behind the catcher, unchanged")

        let small = TheaterDraw.zebraBands(2.4), large = TheaterDraw.zebraBands(5.5)
        check(Uniform.zebra(dark: true).stripes != nil && large.count == 2 && small.count == 1 && large.black == large.white
              && abs(CGFloat(large.count) * large.black + CGFloat(large.count + 1) * large.white - 5.5) < 1e-9 && small.black >= 0.6,
              "the zebra shirt: two bold black stripes across the torso (one on the smallest figures), black and white bands one width, filling it edge to edge")

        // MARK: Pace: the action slowed, the rest at its own pace

        func paced(_ scene: FootballScene) -> (FootballScript, FootballScript) {
            let yaw = FieldFacing.yaw(scene.offense, period: scene.period, flipped: false)
            return (FootballScript(scene, yaw: yaw, pace: 1), FootballScript(scene, yaw: yaw))
        }
        if let run = nfl.first(where: { $0.kind == .rush && $0.scoring == nil && $0.to - $0.from > 3 }) {
            for (scene, what) in [(pass, "a pass"), (run, "a run")] {
                let (laid, played) = paced(scene)
                let snap = laid.players.compactMap(\.set).min() ?? 0.5
                let k = FootballScript.actionPace
                let preSnap = laid.players.indices.allSatisfy { near(laid.players[$0].position(at: snap * 0.9), played.players[$0].position(at: snap * 0.9)) }
                let flights = zip(laid.flights, played.flights).filter { $0.0.start > snap + 0.01 && $0.0.end < laid.stamp - 0.3 }
                let slowed = !flights.isEmpty || scene.kind == .rush
                let flown = flights.allSatisfy { abs(($1.end - $1.start) - ($0.end - $0.start) * k) < 0.01 && abs(($1.start - snap) - ($0.start - snap) * k) < 0.01 }
                let hit = { (s: FootballScript) in s.flashes.last { $0.beat == .hit || $0.beat == .catchBall }?.at ?? s.stamp }
                let held = abs((played.settle - played.stamp) - (laid.settle - laid.stamp)) < 0.01
                let reset = abs((played.duration - played.settle) - (laid.duration - laid.settle)) < 0.35
                check(slowed && preSnap && flown && abs((hit(played) - snap) - (hit(laid) - snap) * k) < 0.02 && held && reset
                      && abs(played.local(snap + (hit(laid) - snap) * k) - hit(laid)) < 0.01,
                      "football, \(what): from the snap to the ball being dead 1.3× slower (the throw, its flight, the run, the stop), the walk-up before it, the hold on the stamp and the jog back as they were",
                      String(format: "stamp %.2f → %.2f, hold %.2f → %.2f, reset %.2f → %.2f", laid.stamp, played.stamp, laid.settle - laid.stamp,
                             played.settle - played.stamp, laid.duration - laid.settle, played.duration - played.settle))
            }
        }
        let pace = FootballScript.Pace(from: 0.5, to: 2.5, factor: 1.3)
        check(pace.stretched(0.3) == 0.3 && abs(pace.stretched(1.5) - 1.8) < 1e-9 && abs(pace.stretched(3) - 3.6) < 1e-9
              && [0.2, 0.9, 2.2, 3.1, 5].allSatisfy { abs(pace.laidOut(pace.stretched($0)) - $0) < 1e-9 },
              "the stretch: nothing before the snap moves, the action runs 1.3× slower, everything after it comes as much later; a pose keyed off an action plays on its laid-out clock")
        if let touchdown = nfl.first(where: { $0.scoring == .touchdown && $0.kind == .pass }) {
            let (laid, played) = paced(touchdown)
            check(played.score.map { s in played.banner.map { abs($0.at - s) < 0.01 } ?? false } == true && played.stamp > laid.stamp
                  && ScoringSlide.climax(played) == played.score,
                  "…the headline, the stamp and the scoring slide's climax all keep time with the slowed play")
        }
        if let three = hoops.first(where: { $0.replays && $0.kind == .three && $0.assister != nil }) {
            let laid = BasketballScript(three, pace: 1), played = BasketballScript(three)
            let k = BasketballScript.approachPace
            let shot = { (s: BasketballScript) in s.flights.first { abs($0.to.z - Hoops.rimHeight) < 0.4 } }
            check(abs(laid.leadIn - played.leadIn) < 1e-9 && abs(((played.release ?? 0) - 0.55 - played.leadIn) - ((laid.release ?? 0) - 0.55 - laid.leadIn) * k) < 0.01
                  && shot(laid).map { a in shot(played).map { abs(($0.end - $0.start) - (a.end - a.start)) < 1e-9 } ?? false } == true
                  && abs((played.stamp - (played.release ?? 0)) - (laid.stamp - (laid.release ?? 0))) < 0.01,
                  "basketball: the approach (the set to the shooter gathering) 1.2× slower; the shot's flight (gravity's time), the stamp after it, as they were")
        }
        if let move = matches[0]["clips"].array.map(\.array).lazy.compactMap({ clip -> SoccerScene? in
            clip.indices.lazy.compactMap { i in SoccerScene.isMoment(clip[i]) ? SoccerScene.parse(clip, at: i, homeTeamID: home, keepers: SoccerScene.keepers(in: clip)) : nil }
                .first { $0.touches.count >= 3 && !$0.shot.penalty }
        }).first {
            let laid = SoccerScript(move, lineups: lineups, pace: 1), played = SoccerScript(move, lineups: lineups)
            let first = laid.flights.first { $0.end - $0.start > 0.05 }?.start ?? 0
            check(abs((played.strike - first) - (laid.strike - first) * SoccerScript.buildUpPace) < 0.01
                  && abs((played.arrive - played.strike) - (laid.arrive - laid.strike)) < 1e-9 && abs((played.stamp - played.arrive) - (laid.stamp - laid.arrive)) < 1e-9,
                  "soccer: the build-up (the first pass to the strike) 1.3× slower; the shot, the payoff and the stamp at their own pace")
        }
    }

    private static func describe(_ p: TheaterBridge.Plan) -> String {
        String(format: "%@ %.2f s, median %.1f, lead %.2f, wait %.2f", p.mode == .bridge ? "bridge" : "crossfade", p.length, p.moved, p.lead, p.wait)
    }
}
