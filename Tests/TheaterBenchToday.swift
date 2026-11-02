import SwiftUI
import simd

// Today's theaters on the bench (the "before" of every gate): each sport's
// stage (BasketballStage, FootballStage, SoccerStage, PlayStage) replayed on a
// virtual wall clock, plays arriving as the recording delivered them, with
// the stage's own running order (its queue, its holds, its bridge from the
// field between plays, its view-identity swaps and crossfades). Every 1/60 s
// the world it presents (each figure where its script has him, posed by the
// frame's own pose, the camera) goes to the continuity meter.
//
// A swap of scripts gives figures no identity across it: the meter's keys
// pair them the most charitable way (the bridge's own match: the same man,
// then his role, then the nearest), so a "jump" is the least the eye could
// have read.

@MainActor
enum Today {
    /// What the recording delivered, as the page's lane would have it: when, and the plays then.
    struct Arrival {
        var t: Double
        var plays: [JSON]
    }

    static func arrivals(_ recording: Recording) -> (arrivals: [Arrival], summary: JSON?) {
        guard var replay = RecordingReplay(recording) else { return ([], nil) }
        var out: [Arrival] = []
        replay.run(.app(replay.policy)) { replay, t, _, change in
            guard let change, !change.isEmpty else { return }
            out.append(Arrival(t: t, plays: replay.engine.timeline.records.map(\.entry.payload.json)))
        }
        let summary = recording.snapshots.last.flatMap(recording.summary)
        return (out, summary)
    }
}

// MARK: - Basketball

extension Today {
    /// BasketballStage, step for step (BasketballTheater.swift `advance`, `finish`, `breathe`, the bridge, `.id(now.key)`).
    @MainActor struct Basketball {
        let teams: BasketballFeed.Teams
        let topIsHome = false
        var state = BasketballTheaterState()
        var possession: GameDetail.Side?

        struct Showing {
            let unit: BasketballQueue.Unit
            let script: BasketballScript
            let start: Double
        }

        struct Resting {
            let rest: BasketballScript.Rest
            let script: BasketballScript
            let start: Double
        }

        struct Bridge {
            let id: String
            let came: Double
            let plan: TheaterBridge.Plan
            let script: BasketballScript
            let since: Double
            let tracks: [Int: RigTrack]
        }

        var showing: Showing?
        var resting: Resting?
        var bridge: Bridge?
        var cursor: String?
        var told = Set<String>()
        var context: BasketballScene?
        var toldRest: BasketballScript.Rest?
        /// When each event fires: finishing what's told, the next round of the court between plays.
        var finishAt: Double?
        var breatheAt: Double?
        /// The decisive moment of each play told as a replay or a beat (wall time), and plays passed over.
        var decisive: [(id: String, at: Double)] = []
        var skipped = 0

        func ends(_ period: Int?) -> HoopsEnds { HoopsEnds(period: period ?? 4, topIsHome: topIsHome, flipped: false) }

        var restPeriod: Int? { context?.period ?? state.plays.last?.period }

        func lineup(at date: Double) -> Lineup? {
            if let showing { return showing.script.lineup(at: min(date - showing.start, showing.script.duration)) }
            if let resting { return resting.script.lineup(at: date - resting.start) }
            return nil
        }

        mutating func advance(at date: Double) {
            let from = lineup(at: date)
            if let unit = BasketballQueue.next(after: cursor, told: told, in: state) {
                cursor = unit.scene.id
                told.formUnion([unit.scene.id] + unit.covers)
                skipped += unit.skipped
                if told.count > 400 { told = Set(state.plays.map(\.id)).intersection(told) }
                if unit.scene.kind != .substitution { context = unit.scene }
                if let resting { toldRest = resting.rest }
                let fallback = resting?.rest.offense ?? showing?.script.side ?? possession
                bridge = nil
                var start = date
                let ends = ends(unit.scene.period)
                let script = unit.marquee ? BasketballScript(unit.scene, right: ends.right(unit.scene.offense))
                    : BasketballScript(beat: unit.scene, group: unit.group, ends: ends, from: from, fallback: fallback)
                if unit.marquee, let resting {
                    let rest = resting.script, elapsed = date - resting.start
                    let beatLeft = rest.active.first { elapsed >= $0.lowerBound && elapsed < $0.upperBound }.map { $0.upperBound - elapsed }
                    let plan = BasketballTheater.bridge(from: rest, at: elapsed, to: script, reduceMotion: false, beatLeft: beatLeft)
                    let tracks = TheaterBridge.tracks(plan, height: Hoops.ground, idle: { j, s in
                        let u = elapsed + s
                        return (rest.players[j].position(at: u), j < rest.rig.count ? rest.rig[j].motion(at: u).heading : 0)
                    }, replay: { i, s in
                        let u = max(plan.replayTime(s), 0)
                        return (script.players[i].position(at: u), i < script.rig.count ? script.rig[i].motion(at: u).heading : 0)
                    })
                    bridge = Bridge(id: unit.scene.id, came: date, plan: plan, script: rest, since: resting.start, tracks: tracks)
                    start = date + plan.delay
                }
                showing = Showing(unit: unit, script: script, start: start)
                resting = nil
                breatheAt = nil
                if let d = script.score ?? script.release ?? script.flashes.first?.at { decisive.append((unit.scene.id, start + d)) }
                // finish(): its length and a beat to read it (shorter when more is waiting).
                let pending = BasketballQueue.next(after: cursor, told: told, in: state) != nil
                let read = unit.marquee ? (pending ? 0.9 : 1.6) : (pending ? 0.2 : 0.45)
                finishAt = start + script.duration + read
                return
            }
            guard showing != nil || resting == nil else { return }
            let last = showing?.unit.scene ?? state.plays.last { $0.kind != .substitution }
            var rest = BasketballFlow.rest(after: last, previous: toldRest, from: from, ends: ends(last?.period), possession: possession)
            rest.ends = ends(restPeriod)
            let script = BasketballScript(rest: rest)
            resting = Resting(rest: rest, script: script, start: date)
            showing = nil
            finishAt = nil
            breatheAt = script.duration >= BasketballScript.Builder.restLength ? date + script.duration : nil
        }

        /// breathe(): the court between plays ran out; it goes on as a new one from where it stands.
        mutating func breathe(at date: Double) {
            guard let resting else { return }
            var next = resting.rest
            next.from = resting.script.lineup(at: resting.script.duration)
            next.round += 1
            if case .inbound = next.phase { next.phase = .live }
            let script = BasketballScript(rest: next)
            self.resting = Resting(rest: next, script: script, start: date)
            breatheAt = script.duration >= BasketballScript.Builder.restLength ? date + script.duration : nil
        }

        /// What's on screen: its view identity, and whether a change of it cuts or crossfades.
        var key: String {
            if let showing { return showing.unit.scene.id }
            if let resting { return "rest-\(resting.rest.seed)-\(resting.rest.round)" }
            return "none"
        }

        var cuts: Bool { showing?.unit.marquee == true }
    }

    /// Today's basketball stage over a recording: the continuity meter's report.
    /// A crossfade under way on today's stage: the frame it leaves (frozen as it was) and how far the new one is in.
    struct Fade {
        var script: BasketballScript
        var scene: BasketballScene?
        var t: Double
        var w: Double
    }

    static func basketball(_ recording: Recording, label: String, frameHook: ((Double, [MeterFigure]) -> Void)? = nil,
                           render: ((Double, Basketball, Fade?) -> Void)? = nil) -> ContinuityReport {
        let (arrivals, summary) = arrivals(recording)
        guard let summary, let first = arrivals.first else { return ContinuityReport(label: label) }
        let teams = TheaterBench.Samples.nbaTeams(summary)
        var stage = Basketball(teams: teams)
        var meter = ContinuityMeter(label: label)
        let opening = Set(first.plays.compactMap { $0["id"].string })
        var nextArrival = 0
        let end = (arrivals.last?.t ?? first.t) + 40
        let dt = 1.0 / 60
        var keys = Keys()
        var lastKey = ""
        var crossfadeUntil = -Double.infinity
        var leaving: (script: BasketballScript, scene: BasketballScene?, t: Double)?
        var shownNow: (script: BasketballScript, scene: BasketballScene?, t: Double)?
        var t = first.t
        while t <= end {
            // Plays in (the lane's onChange): the stage advances only when nothing's being told.
            while nextArrival < arrivals.count, arrivals[nextArrival].t <= t {
                let a = arrivals[nextArrival]
                let scenes = a.plays.indices.compactMap { BasketballScene.parse(a.plays, at: $0, teams: teams) }
                stage.state = BasketballTheaterState(plays: scenes, news: Set(scenes.map(\.id)).subtracting(opening), heard: nil)
                stage.possession = scenes.last { $0.after != nil }?.after
                if stage.showing == nil { stage.advance(at: a.t) }
                nextArrival += 1
            }
            if let at = stage.finishAt, at <= t { stage.finishAt = nil; stage.advance(at: at) }
            if let at = stage.breatheAt, at <= t { stage.breatheAt = nil; stage.breathe(at: at) }
            // The frame.
            let key = stage.key
            let rekey = key != lastKey
            var change = MeterFrame.Change.same
            var reason: String?
            if key != lastKey, !lastKey.isEmpty {
                let bridging = stage.bridge.map { $0.id == key && $0.plan.mode == .bridge } ?? false
                if stage.cuts && !bridging {
                    change = stage.bridge?.plan.mode == .crossfade ? .crossfade : .hardCut
                    reason = stage.bridge == nil ? "marquee replay after a beat (B1)" : "replay far from the court between plays (B3)"
                } else if !stage.cuts {
                    change = .crossfade
                    reason = stage.showing != nil ? "beat" : "court between plays"
                    crossfadeUntil = t + 0.28
                    leaving = shownNow
                }
            }
            lastKey = key
            shownNow = current(stage, at: t)
            if let render {
                let u = min(max(1 - (crossfadeUntil - t) / 0.28, 0), 1)
                let w = u < 0.5 ? 2 * u * u : 1 - pow(-2 * u + 2, 2) / 2
                render(t, stage, t < crossfadeUntil ? leaving.map { Fade(script: $0.script, scene: $0.scene, t: $0.t, w: w) } : nil)
            }
            let (figures, camera) = present(stage, at: t, keys: &keys, swapped: rekey)
            frameHook?(t, figures)
            meter.add(MeterFrame(t: t, figures: figures, camera: camera, ball: nil, change: change, reason: reason))
            _ = crossfadeUntil
            t += dt
        }
        var report = meter.report
        // Today tells each play when it gets to it: its decisive moment's lag behind the play, against a steady one.
        let lags = stage.decisive.compactMap { d -> Double? in
            guard let play = stage.state.plays.first(where: { $0.id == d.id }), let w = play.wallclock else { return nil }
            return d.at - w.timeIntervalSince1970
        }
        if !lags.isEmpty {
            let median = Stats.quantile(lags, 0.5)
            report.decisiveErrors = lags.map { $0 - median }
            report.notes.append(String(format: "told %d plays; lag behind the play p50 %.1f s, spread p95 %.1f s; %d plays passed over (catching up)",
                                       lags.count, median, Stats.quantile(lags.map { abs($0 - median) }, 0.95), stage.skipped))
        }
        return report
    }

    /// Keys for a frame's figures: kept for the same script; across a swap, the most charitable pairing with the frame
    /// before (the same man, then his role, then the nearest); a bridge's own pairs when it says who becomes whom.
    static func assignKeys(_ keys: inout Keys, _ placed: [(index: Int, figure: TheaterBridge.Figure)], swapped: Bool, pairs: [Int: Int]? = nil) {
        if swapped || keys.current.isEmpty {
            var assigned: [Int: Int] = [:]
            if let pairs, swapped {
                for (i, j) in pairs { if let k = keys.current[j] { assigned[i] = k } }
            } else {
                let matched = TheaterBridge.match(idle: keys.previous.map(\.figure), replay: placed.map(\.figure))
                for (r, i) in matched { assigned[placed[r].index] = keys.previous[i].key }
            }
            keys.current = [:]
            for p in placed { keys.current[p.index] = assigned[p.index] ?? keys.fresh() }
        } else {
            for p in placed where keys.current[p.index] == nil { keys.current[p.index] = keys.fresh() }
        }
        keys.previous = placed.map { (keys.current[$0.index] ?? 0, $0.figure) }
    }

    /// Persistent keys for figures across swaps of scripts.
    struct Keys {
        var next = 0
        var current: [Int: Int] = [:]
        var previous: [(key: Int, figure: TheaterBridge.Figure)] = []

        mutating func fresh() -> Int { next += 1; return next }
    }

    /// The figures and camera the stage presents at `t`, in the world.
    static func present(_ stage: Basketball, at t: Double, keys: inout Keys, swapped: Bool) -> ([MeterFigure], SIMD4<Double>?) {
        let size = TheaterBench.Cost.size
        let script: BasketballScript, local: Double
        if let showing = stage.showing {
            script = showing.script
            local = max(t - showing.start, 0)
        } else if let resting = stage.resting {
            script = resting.script
            local = t - resting.start
        } else {
            return ([], nil)
        }
        let right = HoopsWorld.right(script.yaw)
        let teams = BasketballTeams(offense: Uniform(.orange), defense: Uniform(.blue))
        let frame = BasketballFrame(scene: stage.showing?.unit.scene, script: script, t: local, teams: teams, ink: TheaterInk(.dark), size: size)
        let offense = script.side ?? .top
        func group(_ team: BasketballScript.Team, _ side: GameDetail.Side) -> Int {
            switch team {
            case .offense: side == .top ? 0 : 1
            case .defense: side == .top ? 1 : 0
            case .official, .staff: 2
            }
        }
        // Mid-bridge: the court between plays on under the hand-off.
        let blend = stage.bridge.flatMap { b -> (Basketball.Bridge, s: Double, w: Double, idleT: Double)? in
            let s = t - b.came
            guard b.id == stage.showing?.unit.scene.id, s < b.plan.end, b.plan.mode == .bridge else { return nil }
            return (b, s, b.plan.weight(s), t - b.since)
        }
        var camera = script.camera.frame(at: local), yaw = script.yaw
        if let blend { camera = blend.0.script.camera.frame(at: blend.idleT).mix(camera, blend.w); yaw = blend.0.script.yaw }
        let h = HoopProjection(size: size, camera: camera, yaw: yaw)
        let band = MotionLimits.basketball.band("wing")
        var figures: [MeterFigure] = []
        var placed: [(index: Int, figure: TheaterBridge.Figure, meter: MeterFigure, ghost: Bool)] = []
        for (i, player) in script.players.enumerated() {
            var at = player.position(at: local)
            var opacity = player.opacity(at: local)
            let lens = RigLens(h, at: at)
            var (body, heading) = frame.pose(player, i, at: at, unit: lens.unit)
            var track = i < script.rig.count ? script.rig[i] : RigTrack(at: at)
            var trackT = local
            if let blend {
                if let j = blend.0.plan.pairs[i] {
                    let other = blend.0.script.players[j]
                    let idle = BasketballFrame(scene: nil, script: blend.0.script, t: blend.idleT, teams: teams, ink: TheaterInk(.dark), size: size)
                    let from = other.position(at: blend.idleT)
                    at = TheaterBridge.mix(from, at, blend.w)
                    (body, heading) = TheaterBridge.pose(from: idle.pose(other, j, at: from, unit: lens.unit), to: (body, heading), w: blend.w,
                                                         track: blend.0.tracks[i], s: blend.s, at: at, unit: lens.unit)
                    opacity = other.opacity(at: blend.idleT) + (opacity - other.opacity(at: blend.idleT)) * blend.w
                    if let bt = blend.0.tracks[i] { track = bt; trackT = blend.s }
                } else {
                    opacity *= blend.w
                }
            }
            guard opacity > 0.01 else { continue }
            let m = track.motion(at: trackT)
            let world = HoopsWorld.point(at, right: right)
            let worldHeading = HoopsWorld.heading(heading, right: right)
            func foot(_ f: RigVector) -> SIMD3<Double> {
                let c = cos(heading), s = sin(heading)
                let local = CGPoint(x: at.x + (f.x * c - f.y * s) / lens.unit, y: at.y + (f.x * s + f.y * c) / lens.unit)
                let w = HoopsWorld.point(local, right: right)
                return SIMD3(w.x, w.y, f.z / lens.unit)
            }
            let planted = track.planted(at: trackT)
            var fig = MeterFigure(key: 0, position: world, heading: worldHeading, band: band, feet: (foot(body.left), foot(body.right)),
                                  planted: (planted.left && body.left.z < 0.01, planted.right && body.right.z < 0.01), weight: m.weight,
                                  height: Hoops.ground, opacity: opacity)
            fig.source = blend != nil ? "bridge" : stage.showing.map { $0.unit.marquee ? "replay" : "beat" } ?? "rest"
            let rig = track.feet(at: trackT, anchor: at, heading: m.heading, unit: 1, speed: m.speed,
                                 stand: (RigVector(0, 0.1, 0), RigVector(0, -0.1, 0)))
            func rigWorld(_ v: RigVector) -> SIMD2<Double> {
                HoopsWorld.point(CGPoint(x: at.x + v.x * cos(m.heading) - v.y * sin(m.heading), y: at.y + v.x * sin(m.heading) + v.y * cos(m.heading)),
                                 right: right)
            }
            fig.rigFeet = (rigWorld(rig.left), rigWorld(rig.right))
            let athlete = script.credits[i].flatMap { $0.id ?? $0.name }
            placed.append((i, TheaterBridge.Figure(group: group(player.team, offense), athlete: athlete, at: CGPoint(x: world.x, y: world.y)), fig, false))
        }
        // Keys: kept for the same script; across a swap, the most charitable pairing with the frame before.
        if swapped || keys.current.isEmpty || placed.contains(where: { keys.current[$0.index] == nil }) {
            if swapped || keys.current.isEmpty {
                var assigned: [Int: Int] = [:]
                if let blend, swapped {
                    // A bridge says who becomes whom.
                    for (i, j) in blend.0.plan.pairs { if let k = keys.current[j] { assigned[i] = k } }
                } else {
                    let pairs = TheaterBridge.match(idle: keys.previous.map(\.figure), replay: placed.map(\.figure))
                    for (r, i) in pairs { assigned[placed[r].index] = keys.previous[i].key }
                }
                keys.current = [:]
                for p in placed { keys.current[p.index] = assigned[p.index] ?? keys.fresh() }
            } else {
                for p in placed where keys.current[p.index] == nil { keys.current[p.index] = keys.fresh() }
            }
        }
        for p in placed {
            var f = p.meter
            f.key = keys.current[p.index] ?? 0
            figures.append(f)
        }
        keys.previous = placed.map { (keys.current[$0.index] ?? 0, $0.figure) }
        return (figures, HoopsWorld.camera(camera, yaw: yaw))
    }
}


// MARK: - Today's frame, drawn (the video)

extension Today {
    /// What today's stage has on screen at t: its script, the play, and the script's time.
    static func current(_ stage: Basketball, at t: Double) -> (script: BasketballScript, scene: BasketballScene?, t: Double)? {
        if let showing = stage.showing { return (showing.script, showing.unit.scene, min(max(t - showing.start, 0), showing.script.duration)) }
        if let resting = stage.resting { return (resting.script, nil, max(t - resting.start, 0)) }
        return nil
    }

    /// Today's frame at t as the page draws it: mid-bridge the court between plays blends into the replay's set; in a
    /// crossfade the frame it leaves fades out under the new one.
    @ViewBuilder
    static func frame(_ stage: Basketball, at t: Double, fade: Fade?, teams: BasketballTeams, ink: TheaterInk, size: CGSize) -> some View {
        if let now = current(stage, at: t) {
            let blend = stage.bridge.flatMap { b -> BasketballFrame.Bridge? in
                let s = t - b.came
                guard b.id == stage.showing?.unit.scene.id, s < b.plan.end, b.plan.mode == .bridge else { return nil }
                return BasketballFrame.Bridge(script: b.script, t: t - b.since, w: b.plan.weight(s), s: s, pairs: b.plan.pairs, tracks: b.tracks)
            }
            ZStack {
                if let fade {
                    BasketballFrame(scene: fade.scene, script: fade.script, t: fade.t, teams: teams, ink: ink, size: size)
                        .opacity(1 - fade.w)
                }
                BasketballFrame(scene: now.scene, script: now.script, t: now.t, teams: teams, ink: ink, size: size, bridge: blend)
                    .opacity(fade?.w ?? 1)
            }
        }
    }
}
