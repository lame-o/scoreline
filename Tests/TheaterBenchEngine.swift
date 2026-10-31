import SwiftUI
import simd

// The engine on the bench (the "after" of every gate): a recording through
// the real lanes, the timeline and the presentation clock (RecordingReplay),
// then the theater session exactly as the page's director runs it (plans made
// and baked at each change, spliced in on the theater's time), sampled every
// 1/60 s of wall time into the same continuity meter as today's stages, the
// frames posed by the painter the view uses.

@MainActor
enum EngineRun {
    struct Result {
        var report: ContinuityReport
        /// FNV-1a over every baked track, camera sample and cue: two runs must agree.
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        var plans = 0
        var cost = TheaterBench.Cost.Series(label: "engine")
        var sampling: [Double] = []
        var samplingAllocations: [Int] = []
    }

    /// Basketball through the engine. `frame`: called with each sampled frame (the video's renderer).
    static func basketball(_ recording: Recording, label: String, cost: Bool = false,
                           frame: ((PTime, PlanChain<HoopsClip>, FrameScratch) -> Void)? = nil) -> Result {
        var result = Result(report: ContinuityReport(label: label))
        guard var replay = RecordingReplay(recording), let summary = recording.snapshots.last.flatMap(recording.summary) else { return result }
        let teams = TheaterBench.Samples.nbaTeams(summary)
        let facts = HoopsFacts(topIsHome: teams.topIsHome, flipped: false, topID: teams.topID, bottomID: teams.bottomID, topName: teams.topName,
                               bottomName: teams.bottomName)
        var session = TheaterSession<HoopsSport>(facts: facts)
        var meter = ContinuityMeter(label: label)
        let scratch = FrameScratch()
        let size = TheaterBench.Cost.size
        var lastWall: PTime?
        var decisive: [String: (presented: PTime, anchor: PTime)] = [:]
        var declaredUntil = -Double.infinity
        var sampled = 0
        func replan(_ now: PTime) {
            guard let request = session.request(now: now) else { return }
            let (baked, next) = TheaterSession<HoopsSport>.make(request)
            guard session.accept(baked, nextID: next, now: now) else { return }
            result.plans += 1
            mix(&result.hash, baked)
            if baked.plan.declared { declaredUntil = baked.start + 0.25 }
            for p in baked.plan.placements where p.start >= baked.start - 1e-9 {
                guard let id = p.play, let a = p.anchor, let d = p.clip.decisive else { continue }
                decisive[id] = (p.offset + d, a + p.shift)
            }
        }
        func frames(through t: PTime) {
            guard var w = lastWall else { return }
            while w + 1.0 / 60 <= t + 1e-9 {
                w += 1.0 / 60
                guard let T = session.theaterTime(at: w) else { continue }
                // The plan running out (nothing new for a while): the director's one wake.
                if let last = session.chain.plans.last, T > last.horizon - 15 { replan(w) }
                let chain = session.chain
                if cost {
                    let s = TheaterProbe.measure { chain.sample(T, into: scratch) }
                    result.sampling.append(s.seconds)
                    result.samplingAllocations.append(s.allocations)
                } else {
                    chain.sample(T, into: scratch)
                }
                frame?(T, chain, scratch)
                let posed = cost ? TheaterProbe.measure { HoopsPainter.frame(chain, scratch, size: size) }
                    : (value: HoopsPainter.frame(chain, scratch, size: size), seconds: 0, allocations: 0)
                if cost {
                    result.cost.pose.append(posed.seconds)
                    result.cost.poseAllocations.append(posed.allocations)
                }
                guard let drawn = posed.value else { continue }
                if cost, sampled % 4 == 0 {
                    let view = BasketballFrame(scene: drawn.clip.scene, script: drawn.clip.script, t: drawn.t, teams: BasketballTeams(offense: Uniform(.orange), defense: Uniform(.blue)),
                                               ink: TheaterInk(.dark), size: size, world: drawn.world)
                    TheaterProbe.canvases.removeAll(keepingCapacity: true)
                    TheaterProbe.recording = true
                    let renderer = ImageRenderer(content: view.frame(width: size.width, height: size.height))
                    renderer.scale = TheaterBench.Cost.scale
                    _ = renderer.cgImage
                    TheaterProbe.recording = false
                    if let c = TheaterProbe.canvases.first {
                        result.cost.canvas.append(c.seconds)
                        result.cost.canvasAllocations.append(c.allocations)
                    }
                }
                sampled += 1
                let figures = meterFigures(chain, scratch, drawn, size: size)
                var change = MeterFrame.Change.same
                if T <= declaredUntil { change = .declared }
                meter.add(MeterFrame(t: w, figures: figures, camera: scratch.camera, ball: nil, change: change,
                                     reason: splicing(chain, at: T) ? "at a splice" : "inside a clip"))
            }
            lastWall = w
        }
        replay.run(.app(replay.policy)) { replay, t, step, change in
            let engine = replay.engine
            guard engine.started else { return }
            frames(through: t)
            let clockChanged = session.clockDidUpdate(engine.clock, events: step.events, now: t)
            var data = false
            if let change, !change.isEmpty {
                session.timelineDidChange(engine.snapshot(at: t))
                data = true
            }
            if data || clockChanged || session.chain.isEmpty { replan(t) }
            if lastWall == nil { lastWall = t }
        }
        if let w = lastWall { frames(through: w + 30) }
        var report = meter.report
        let errors = decisive.values.map { $0.presented - $0.anchor }
        report.decisiveErrors = errors
        report.catchUps = errors.filter { $0 > 1e-3 }
        report.notes.append("plans spliced: \(result.plans)")
        result.report = report
        return result
    }

    /// Whether T is at a hand-off (a splice's start, a man joining a clip): a jump there is a splice cut, elsewhere a step inside a clip.
    static func splicing(_ chain: PlanChain<HoopsClip>, at T: PTime) -> Bool {
        guard let plan = chain.plan(at: T)?.plan else { return false }
        let near = 2.5 / 60
        return plan.placements.contains { p in abs(p.start - T) < near || p.join.values.contains { abs($0 - T) < near } || abs(p.offset - T) < near }
            || abs(plan.start - T) < near
    }

    /// Each man as the meter reads him: where, which way, his feet as the painter poses them.
    static func meterFigures(_ chain: PlanChain<HoopsClip>, _ scratch: FrameScratch, _ drawn: (clip: HoopsClip, t: Double, world: BasketballFrame.World),
                             size: CGSize) -> [MeterFigure] {
        let baked = chain.plans[scratch.plan]
        let right = drawn.clip.right
        let h = HoopProjection(size: size, camera: drawn.world.camera, yaw: drawn.world.yaw)
        var out: [MeterFigure] = []
        for actor in scratch.actors {
            let track = baked.tracks[actor.track]
            guard let f = drawn.world.figures.first(where: { $0.index == Int(actor.id.raw) }) else { continue }
            let unit = RigLens(h, at: f.at).unit
            func foot(_ v: RigVector) -> SIMD3<Double> {
                let c = cos(f.heading), s = sin(f.heading)
                let local = CGPoint(x: f.at.x + (v.x * c - v.y * s) / unit, y: f.at.y + (v.x * s + v.y * c) / unit)
                let w = HoopsWorld.point(local, right: right)
                return SIMD3(w.x, w.y, v.z / unit)
            }
            let planted = track.rig.planted(at: scratch.p)
            out.append(MeterFigure(key: Int(actor.id.raw), position: actor.position, heading: actor.motion.heading,
                                   band: MotionLimits.basketball.band(track.figure.band), feet: (foot(f.body.left), foot(f.body.right)),
                                   planted: (planted.left && f.body.left.z < 0.01, planted.right && f.body.right.z < 0.01),
                                   weight: actor.motion.weight, height: track.figure.height, opacity: actor.opacity))
        }
        return out
    }

    /// Every baked number into the determinism hash.
    static func mix<Clip>(_ hash: inout UInt64, _ baked: BakedPlan<Clip>) {
        TheaterHash.mix(&hash, baked.start.bitPattern)
        TheaterHash.mix(&hash, baked.horizon.bitPattern)
        for track in baked.tracks {
            TheaterHash.mix(&hash, UInt64(track.id.raw))
            for p in track.xy { TheaterHash.mix(&hash, UInt64(p.x.bitPattern) << 32 | UInt64(p.y.bitPattern)) }
            for o in track.opacity { TheaterHash.mix(&hash, UInt64(o.bitPattern)) }
            for s in track.rig.samples { TheaterHash.mix(&hash, UInt64(s.heading.bitPattern) << 32 | UInt64(s.phase.bitPattern)) }
            for s in track.rig.left + track.rig.right { TheaterHash.mix(&hash, s.land.bitPattern ^ Double(s.at.x).bitPattern ^ Double(s.at.y).bitPattern) }
        }
        for c in baked.camera {
            TheaterHash.mix(&hash, UInt64(c.x.bitPattern) << 32 | UInt64(c.y.bitPattern))
            TheaterHash.mix(&hash, UInt64(c.z.bitPattern) << 32 | UInt64(c.w.bitPattern))
        }
        for cue in baked.plan.cues { TheaterHash.mix(&hash, cue.at.bitPattern) }
    }
}
