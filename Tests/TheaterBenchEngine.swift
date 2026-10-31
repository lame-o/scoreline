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

    /// Basketball through the engine.
    static func basketball(_ recording: Recording, label: String, cost: Bool = false,
                           frame: ((PTime, PlanChain<HoopsClip>, FrameScratch) -> Void)? = nil) -> Result {
        run(HoopsBench.self, recording, label: label, cost: cost, frame: frame)
    }

    /// A sport through the engine. `frame`: called with each sampled frame (the video's renderer).
    static func run<B: BenchSport>(_ sport: B.Type, _ recording: Recording, label: String, cost: Bool = false,
                                   frame: ((PTime, PlanChain<B.Sport.Clip>, FrameScratch) -> Void)? = nil) -> Result {
        var result = Result(report: ContinuityReport(label: label))
        // The page hands the timeline the theater's binding horizons (late binding): the replay starts with them.
        guard let sport = recording.sport else { return result }
        var policy = BroadcastLanes.policy(sport, path: recording.path)
        policy.horizons = BindingHorizons(live: policy.horizons.live, byKind: B.Sport.horizons)
        guard var replay = RecordingReplay(recording, policy: policy), let summary = recording.snapshots.last.flatMap(recording.summary) else {
            return result
        }
        var session = TheaterSession<B.Sport>(facts: B.facts(summary))
        var meter = ContinuityMeter(label: label)
        let scratch = FrameScratch()
        let size = TheaterBench.Cost.size
        var lastWall: PTime?
        var decisive: [String: (presented: PTime, anchor: PTime)] = [:]
        var declaredUntil = -Double.infinity
        var sampled = 0
        let trace = ProcessInfo.processInfo.environment["THEATER_TRACE"] != nil
        var measured: [String: Double] = [:]
        var lastT = -Double.infinity
        var lastFigures: [Int: MeterFigure]?
        var lastStep: [Int: Double] = [:]
        func replan(_ now: PTime) {
            guard let request = session.request(now: now) else { return }
            let (baked, next) = TheaterSession<B.Sport>.make(request)
            guard session.accept(baked, nextID: next, now: now) else { return }
            result.plans += 1
            if trace {
                let T = session.theaterTime(at: now) ?? 0
                var line = String(format: "plan w=%.2f T=%.2f c=%.2f shift=%.2f hold=%@ horizon=%.1f", now, T, baked.start, request.shift,
                                  request.deferFrom.map { String(format: "%.1f", $0) } ?? "-", baked.horizon - baked.start)
                for p in baked.plan.placements where p.start >= baked.start - 1e-9 {
                    line += String(format: "\n   %@ %@ start=%+.2f offset=%+.2f still=%.2f dec=%@ anchor=%@ slip=%.2f travel=%d",
                                   p.play ?? "rest", p.clip.ambient ? "ambient" : "clip", p.start - baked.start, p.offset - baked.start, p.clip.still,
                                   p.clip.decisive.map { String(format: "%.2f", $0) } ?? "-",
                                   p.anchor.map { String(format: "%+.2f", $0 + p.shift - baked.start) } ?? "-", p.slip, p.travel.count)
                }
                print(line)
            }
            if trace { scan(baked) }
            mix(&result.hash, baked)
            if baked.plan.declared { declaredUntil = baked.start + 0.25 }
            for p in baked.plan.placements where p.start >= baked.start - 1e-9 {
                guard let id = p.play, let a = p.anchor, let d = p.clip.decisive else { continue }
                decisive[id] = (p.offset + d, a + p.shift)
            }
        }
        /// Each new clip's own frames, before any splice: a step past the cap inside one is the clip's, not the engine's.
        var scanned: Set<String> = []
        func scan(_ baked: BakedPlan<B.Sport.Clip>) {
            for p in baked.plan.placements where p.start >= baked.start - 1e-9 {
                let key = p.play ?? "rest@\(Int(p.offset))"
                guard !scanned.contains(key), p.clip.length.isFinite else { continue }
                scanned.insert(key)
                for i in p.clip.figures.indices {
                    var t = 0.0, last = p.clip.position(i, at: 0)
                    while t < p.clip.length {
                        t += 1.0 / 60
                        let here = p.clip.position(i, at: min(t, p.clip.length))
                        let d = simd_length(here - last)
                        if d > 1.5 {
                            print(String(format: "clipjump %@ fig %d t=%.3f d=%.2f from (%.1f,%.1f) to (%.1f,%.1f) still=%.2f entry=%.2f length=%.2f",
                                         key, i, t, d, last.x, last.y, here.x, here.y, p.clip.still, p.entry, p.clip.length))
                            break
                        }
                        last = here
                    }
                }
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
                let posed = cost ? TheaterProbe.measure { B.pose(chain, scratch, size: size) }
                    : (value: B.pose(chain, scratch, size: size), seconds: 0, allocations: 0)
                if cost {
                    result.cost.pose.append(posed.seconds)
                    result.cost.poseAllocations.append(posed.allocations)
                }
                guard let drawn = posed.value else { continue }
                if cost, sampled % 4 == 0 {
                    let view = B.view(drawn, size: size)
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
                let figures = B.figures(drawn, chain, scratch, size: size)
                var change = MeterFrame.Change.same
                if T <= declaredUntil { change = .declared }
                // Each decisive moment as it's drawn, against its anchor on p (the clock the theater ran on then).
                if let plan = chain.plan(at: T)?.plan {
                    for p in plan.placements {
                        guard let id = p.play, let a = p.anchor, let d = p.clip.decisive, measured[id] == nil else { continue }
                        let at = p.offset + d
                        if at > lastT, at <= T, let pAt = session.presentation(at: w - (T - at)) { measured[id] = pAt - a }
                    }
                }
                if trace, let lastFigures {
                    for f in figures {
                        guard let q = lastFigures[f.key] else { continue }
                        let d = simd_length(f.position - q.position), was = lastStep[f.key] ?? 0
                        if d > 1.5 * f.band.sprint * 1.12 / 60, d > 2.5 * max(was, f.band.sprint / 60 * 0.25) {
                            print(String(format: "jump T=%.3f actor %d d=%.2f was %.2f ", T, f.key, d, was) + describe(chain, ActorID(UInt16(f.key)), at: T)
                                  + " | before: " + describe(chain, ActorID(UInt16(f.key)), at: lastT))
                        }
                    }
                }
                lastStep = Dictionary(uniqueKeysWithValues: figures.compactMap { f in lastFigures?[f.key].map { (f.key, simd_length(f.position - $0.position)) } })
                lastFigures = Dictionary(figures.map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a })
                lastT = T
                meter.add(MeterFrame(t: T, figures: figures, camera: scratch.camera, ball: nil, change: change,
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
        let errors = Array(measured.values)
        report.decisiveErrors = errors
        report.catchUps = errors.filter { $0 > 1e-3 }
        _ = decisive
        report.notes.append("plans spliced: \(result.plans)")
        result.report = report
        return result
    }

    /// Whether T is at a hand-off (a splice's start, a man joining a clip): a jump there is a splice cut, elsewhere a step inside a clip.
    static func splicing<Clip>(_ chain: PlanChain<Clip>, at T: PTime) -> Bool {
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
            // The rig's own feet: where its planted steps are (world), before any pose.
            let m = actor.motion
            let rig = track.rig.feet(at: scratch.p, anchor: CGPoint(x: actor.position.x, y: actor.position.y), heading: m.heading, unit: 1,
                                     speed: m.speed, stand: (RigVector(0, 0.1, 0), RigVector(0, -0.1, 0)))
            func rigWorld(_ v: RigVector) -> SIMD2<Double> {
                SIMD2(actor.position.x + v.x * cos(m.heading) - v.y * sin(m.heading), actor.position.y + v.x * sin(m.heading) + v.y * cos(m.heading))
            }
            let placement = baked.plan.placements[actor.placement]
            let traveling = placement.join[actor.id].map { scratch.p < $0 } ?? false
            var figure = MeterFigure(key: Int(actor.id.raw), position: actor.position, heading: actor.motion.heading,
                                     band: MotionLimits.basketball.band(track.figure.band), feet: (foot(f.body.left), foot(f.body.right)),
                                     planted: (planted.left && f.body.left.z < 0.01, planted.right && f.body.right.z < 0.01),
                                     weight: actor.motion.weight, height: track.figure.height, opacity: actor.opacity)
            figure.source = traveling ? "travel" : "\(placement.clip.kind)"
            figure.rigFeet = (rigWorld(rig.left), rigWorld(rig.right))
            out.append(figure)
        }
        return out
    }

    /// Where a man is in the plan at T: which placement moves him, and how.
    static func describe<Clip>(_ chain: PlanChain<Clip>, _ id: ActorID, at T: PTime) -> String {
        guard let baked = chain.plan(at: T) else { return "no plan" }
        let plan = baked.plan
        guard let k = plan.placement(at: T) else { return "no placement" }
        let p = plan.placements[k]
        var s = String(format: "plan@%.2f k=%d/%d %@ %@ start=%+.2f offset=%+.2f", baked.start, k, plan.placements.count, p.play ?? "rest", "\(type(of: p.clip))",
                       p.start - T, p.offset - T)
        if let i = p.figure(of: id) {
            s += " fig \(i)"
            if let j = p.join[id] { s += String(format: " join=%+.2f%@", j - T, p.travel[id] == nil ? " (no travel)" : "") }
        } else if p.leaving.contains(id) {
            s += " leaving"
        } else {
            s += " absent"
        }
        return s
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
