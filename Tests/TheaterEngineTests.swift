import Foundation
import simd

// The choreography engine's core (CHOREOGRAPHY §9.3): the anchor solver
// (pool-adjacent-violators with gaps, ties spread, a stoppage's backdated
// plays placed back from the restart, a frozen prefix), the quintic layer
// (continuity at every key, the closed-form shortest move, retiming within
// the limits, the cruise), the splice (a new plan reproduces the world it
// starts from exactly: positions, velocities, accelerations, the stride with
// its planted feet), the stride carried across it with no foot slip, and the
// camera's yaw (hysteresis, its dwell, critically damped and capped).

/// A clip for the tests: each figure on a straight line at its own speed from its own start, the camera on the first.
private struct LineClip: TheaterClip {
    var starts: [SIMD2<Double>]
    var velocities: [SIMD2<Double>]
    var length = 20.0
    var still = 0.0
    var decisive: Double? = 5
    var essential = 0.0
    var ambient = false
    var figures: [ClipFigure] { starts.indices.map { ClipFigure(group: $0 % 2, kind: "player", band: "wing", height: Hoops.ground) } }
    func position(_ i: Int, at t: Double) -> SIMD2<Double> { starts[i] + velocities[i] * max(t - still, 0) }
    func heading(_ i: Int, at t: Double) -> Double { simd_length(velocities[i]) > 0 ? atan2(velocities[i].y, velocities[i].x) : 0 }
    func opacity(_ i: Int, at t: Double) -> Double { 1 }
    func ball(at t: Double) -> ClipBall? { .held(figure: 0) }
    func camera(at t: Double) -> SIMD4<Double> { let p = position(0, at: t); return SIMD4(p.x, p.y, log(40), HoopsWorld.yaw(right: true)) }
    func moving(at t: Double) -> Bool { true }
}

extension ScorelineTests {
    static func theaterEngine() {
        print("\nTheater engine")
        anchorSolver()
        quintics()
        splice()
        yaw()
    }

    private static func anchorSolver() {
        // Pool-adjacent-violators: the nearest nondecreasing sequence.
        let iso = AnchorSolver.isotonic([3, 1, 2], [1, 1, 1])
        check(iso.allSatisfy { abs($0 - 2) < 1e-12 }, "isotonic regression pools violators to their weighted mean", "\(iso)")
        let weighted = AnchorSolver.isotonic([4, 0], [3, 1])
        check(abs(weighted[0] - 3) < 1e-12 && abs(weighted[1] - 3) < 1e-12, "weights pull the pooled mean", "\(weighted)")

        func play(_ id: String, w: PTime?, g: Double?, live: Bool = true, stops: Bool = false, weight: Double = 1, gap: Double = 0.15,
                  bounds: ClosedRange<PTime>? = nil, restart: Double = 1) -> AnchorInput {
            AnchorInput(id: id, period: 4, eventTime: w, bounds: bounds, elapsed: g, live: live, stopsClock: stops, weight: weight, gapAfter: gap,
                        restartAfter: restart)
        }
        // A miss and its rebound share a wallclock: the gap spreads them round it.
        let tie = AnchorSolver.solve([play("miss", w: 1000, g: 300, gap: 1.0), play("board", w: 1000, g: 300)])
        if let a = tie["miss"]?.at, let b = tie["board"]?.at {
            check(abs(b - a - 1.0) < 1e-9 && abs((a + b) / 2 - 1000) < 1e-9, "a tied miss and rebound are spread by the gap, centered on their second",
                  "\(a - 1000), \(b - 1000)")
        } else {
            check(false, "tied plays get anchors")
        }
        // A running stretch: whole-second wallclocks, the game clock's tenths place them.
        let stretch = AnchorSolver.solve([play("a", w: 1000, g: 100.4), play("b", w: 1003, g: 102.9), play("c", w: 1005, g: 105.2)])
        let offsets = ["a", "b", "c"].compactMap { stretch[$0]?.at }.enumerated().map { $0.element - [100.4, 102.9, 105.2][$0.offset] }
        check(offsets.count == 3 && offsets.allSatisfy { abs($0 - offsets[0]) < 1e-9 },
              "inside a running stretch the game clock times the plays (one offset for all)", "\(offsets)")
        // A stoppage: the foul stops the clock; the free throws and a substitution are stamped with the whistle's
        // second, though they happened just before play resumed; the next stretch says when that was.
        let cluster = AnchorSolver.solve([
            play("drive", w: 995, g: 495),
            play("foul", w: 1000, g: 500, live: false, stops: true, weight: 0.75, gap: 2),
            play("ft1", w: 1000, g: 500, live: false, stops: true, gap: 6),
            play("sub", w: 1000, g: 500, live: false, stops: true, weight: 0, gap: 2),
            play("ft2", w: 1000, g: 500, live: false, stops: true, gap: 0.15),
            play("shot", w: 1300, g: 510),
        ])
        let restart = 1300 - 510 + 500.0
        if let ft1 = cluster["ft1"]?.at, let sub = cluster["sub"]?.at, let ft2 = cluster["ft2"]?.at, let foul = cluster["foul"]?.at {
            check(abs(ft2 - (restart - 1)) < 1e-6 && ft1 < sub && sub < ft2 && ft2 - ft1 >= 8 - 1e-9,
                  "a stoppage's plays go back from the restart by their gaps (the last a second before it)",
                  "ft1 \(ft1 - restart), sub \(sub - restart), ft2 \(ft2 - restart)")
            check(ft1 > foul + 200 && abs(foul - 1000) < 1e-6, "never collapsed onto the whistle's stamp", "foul \(foul - 1000), ft1 \(ft1 - 1000)")
        } else {
            check(false, "the stoppage's plays get anchors")
        }
        // The rebound that restarts the clock is at the restart; the timeline's bounds place a cluster the same way.
        let bounded = AnchorSolver.solve([
            play("foul", w: 1000, g: 500, live: false, stops: true, weight: 0.75, gap: 2),
            play("ft", w: 1000, g: 500, live: false, stops: true, gap: 0.9, bounds: 1000...1200),
            play("board", w: 1000, g: 500, live: true, gap: 0.15, bounds: 1000...1200, restart: 0),
        ])
        check(abs((bounded["board"]?.at ?? 0) - 1200) < 1e-6 && abs((bounded["ft"]?.at ?? 0) - 1199.1) < 1e-6,
              "with the timeline's bounds: the rebound that restarts the clock at the restart, the free throw a carom before it",
              "\(String(describing: bounded["ft"]?.at)) \(String(describing: bounded["board"]?.at))")
        // Frozen anchors never move; what follows starts no earlier than their gap.
        let frozen = AnchorSolver.solve([play("a", w: 1000, g: 100, gap: 1), play("b", w: 1000.2, g: 100.2), play("c", w: 1001, g: 101)],
                                        frozen: ["a": 1003])
        check(frozen["a"]?.at == 1003 && (frozen["b"]?.at ?? 0) >= 1004 - 1e-9 && (frozen["c"]?.at ?? 0) > (frozen["b"]?.at ?? 0),
              "a frozen anchor holds and the rest keep its gap after it", "\(frozen.mapValues { $0.at - 1000 })")
    }

    private static func quintics() {
        let band = MotionLimits.basketball.band("wing")
        // C² at every key: the segments meet in position, velocity and acceleration.
        let keys = [MotionKey(t: 0, at: SIMD2(0, 0), kind: .depart, hard: true), MotionKey(t: 1.2, at: SIMD2(8, 3), kind: .through, hard: false),
                    MotionKey(t: 2.0, at: SIMD2(12, 10), kind: .through, hard: false), MotionKey(t: 3.4, at: SIMD2(20, 10), kind: .arrive, hard: true)]
        let path = TheaterMotion.path(keys, band: band)
        var seam = 0.0
        for k in 1..<(path.segments.count) {
            let a = path.segments[k - 1], b = path.segments[k]
            seam = max(seam, simd_length(a.position(at: a.t1) - b.position(at: b.t0)), simd_length(a.velocity(at: a.t1) - b.velocity(at: b.t0)),
                       simd_length(a.acceleration(at: a.t1) - b.acceleration(at: b.t0)))
        }
        check(path.segments.count == 3 && seam < 1e-9, "quintic segments meet C² at every key", "seam \(seam)")
        check(simd_length(path.position(at: 3.4) - SIMD2(20, 10)) < 1e-9 && simd_length(path.velocity(at: 3.4)) < 1e-9,
              "an arrival ends exactly there, at rest")
        // The closed form: the shortest rest-to-rest move peaks at the sprint cap or the acceleration limit, not past them.
        let d = 30.0, T = TheaterMotion.shortest(distance: d, band: band)
        let rest = MotionPath(segments: [Quintic(t0: 0, duration: T, from: .zero, .zero, .zero, to: SIMD2(d, 0), .zero, .zero)])
        let over = TheaterMotion.violations(rest, from: 0, to: T, band: band).map(\.over).max() ?? 0
        let under = TheaterMotion.violations(MotionPath(segments: [Quintic(t0: 0, duration: T * 0.9, from: .zero, .zero, .zero, to: SIMD2(d, 0), .zero, .zero)]),
                                             from: 0, to: T * 0.9, band: band)
        check(over < 0.01 && !under.isEmpty, "the closed-form shortest move is just inside the limits (any quicker breaks them)",
              "over \(over), quicker: \(under.count) violations")
        // Retiming: the least time from a moving start fits; a little less doesn't.
        let v0 = SIMD2(-12.0, 4), a0 = SIMD2(3.0, 0)
        let need = TheaterMotion.shortestTravel(from: .zero, v0, a0, to: SIMD2(24, -6), band: band, cruiseOver: 12)
        let fits = TheaterMotion.travel(from: .zero, v0, a0, at: 0, to: SIMD2(24, -6), duration: need, band: band, cruiseOver: 12)
        let tight = TheaterMotion.travel(from: .zero, v0, a0, at: 0, to: SIMD2(24, -6), duration: need * 0.85, band: band, cruiseOver: 12)
        check(TheaterMotion.violations(fits, from: 0, to: need, band: band).isEmpty && !TheaterMotion.violations(tight, from: 0, to: need * 0.85, band: band).isEmpty
              && simd_length(fits.velocity(at: 0) - v0) < 1e-9 && simd_length(fits.acceleration(at: 0) - a0) < 1e-9,
              "a travel from a man running the other way starts from his velocity and acceleration, and is timed by his limits",
              "need \(need)")
        // A long move with time to spare cruises at an easy pace and arrives at rest.
        let long = TheaterMotion.travel(from: .zero, .zero, .zero, at: 0, to: SIMD2(60, 0), duration: 9, band: band, cruiseOver: 12)
        let peak = stride(from: 0.0, through: 9, by: 1.0 / 60).map { simd_length(long.velocity(at: $0)) }.max() ?? 0
        check(long.segments.count == 3 && peak < band.run && simd_length(long.position(at: 9) - SIMD2(60, 0)) < 1e-6
              && TheaterMotion.violations(long, from: 0, to: 9, band: band).isEmpty,
              "a long move with time to spare ramps to an easy cruise and back (never a sprint it doesn't need)", "peak \(peak) ft/s")
        // Collisions: two men on one line step round each other.
        let lanes = [[MotionKey(t: 0, at: SIMD2(0, 0), kind: .depart, hard: true), MotionKey(t: 2, at: SIMD2(20, 0), kind: .arrive, hard: true)],
                     [MotionKey(t: 0, at: SIMD2(20, 0.2), kind: .depart, hard: true), MotionKey(t: 2, at: SIMD2(0, 0.2), kind: .arrive, hard: true)]]
        let separated = TheaterMotion.separate(lanes, bands: [band, band], priority: [1, 0], from: 0, to: 2, radius: 1)
        check(separated.residual.isEmpty && separated.keys[1].count == 3 && separated.keys[0].count == 2,
              "two men who'd run through each other: the lower-priority one steps round", "\(separated.residual.count) left")
    }

    private static func splice() {
        // A first plan: two men running, one standing.
        let first = LineClip(starts: [SIMD2(20, 20), SIMD2(40, 30), SIMD2(60, 25)], velocities: [SIMD2(9, 2), SIMD2(-7, 0), .zero])
        let ids = [ActorID(1), ActorID(2), ActorID(3)]
        var actors: [ActorID: ClipFigure] = [:]
        for (i, id) in ids.enumerated() { actors[id] = first.figures[i] }
        let p0 = 1_000_000.0
        let plan0 = Plan(revision: 1, start: p0, horizon: p0 + 12, state: nil, placements: [ClipPlacement(clip: first, offset: p0, start: p0, cast: ids)],
                         actors: actors)
        var chain = PlanChain<LineClip>()
        chain.splice(TheaterBake.bake(plan0), now: p0)
        // The splice: a second clip asks everyone somewhere else, met from the world as it stands.
        let c = chain.commit(after: p0 + 4.03)
        guard let state = chain.state(at: c) else { return check(false, "the chain has a state to splice from") }
        let second = LineClip(starts: [SIMD2(70, 10), SIMD2(30, 40), SIMD2(62, 26)], velocities: [.zero, SIMD2(3, 0), .zero], still: 2.5)
        var next: UInt16 = 10
        let meeting = Splice.meet(second, offset: c + 0.5, earliest: c, limits: .basketball, cast: [0: ids[0], 1: ids[1], 2: ids[2]], nextID: &next) { t in
            ids.compactMap { id in
                chain.state(at: t)?.actor(id).map { Splice.Man(state: $0, figure: actors[id]!) }
            }
        }
        var plan1 = Plan<LineClip>(revision: 2, start: c, horizon: c + 30, state: state, placements: [], actors: actors)
        plan1.history = chain.history(before: c)
        plan1.placements = [ClipPlacement(clip: first, offset: p0, start: p0, cast: ids),
                            ClipPlacement(clip: second, offset: meeting.offset, start: meeting.start, cast: meeting.cast, travel: meeting.travel,
                                          join: meeting.join)]
        let baked1 = TheaterBake.bake(plan1)
        // The new plan reproduces the world at c exactly.
        var worst = 0.0
        for a in state.actors {
            guard let m = plan1.motion(of: a.id, at: c) else { worst = .infinity; continue }
            worst = max(worst, simd_length(m.position - a.position), simd_length(m.velocity - a.velocity) * 0.1,
                        simd_length(m.acceleration - a.acceleration) * 0.01)
        }
        check(worst < 1e-6, "the splice reproduces the world it starts from: positions, velocities, accelerations", "worst \(worst)")
        // The stride carries on: the same phase, heading and planted feet at c.
        var stride = 0.0, feet = 0.0
        for id in ids {
            guard let old = chain.plan(at: c)?.track(id), let new = baked1.track(id) else { stride = .infinity; continue }
            let a = old.rig.carry(at: c), b = new.rig.carry(at: c)
            stride = max(stride, abs(a.phase - b.phase), abs(remainder(a.heading - b.heading, 2 * .pi)))
            for (x, y) in [(a.left, b.left), (a.right, b.right)] where x.lift == .infinity {
                feet = max(feet, hypot(x.at.x - y.at.x, x.at.y - y.at.y))
            }
        }
        check(stride < 1e-5 && feet == 0, "the stride carries across the splice: phase, heading, the planted feet where they were",
              "stride \(stride), feet \(feet)")
        // No foot slides across the splice: each planted foot stays put frame to frame through it.
        chain.splice(baked1, now: c)
        var slip = 0.0
        var previous: [ActorID: (CGPoint, CGPoint, (Bool, Bool))] = [:]
        var t = c - 0.5
        while t < c + 1.5 {
            for id in ids {
                guard let track = chain.plan(at: t)?.track(id) else { continue }
                let m = track.rig.motion(at: t), at = track.position(at: t)
                let feetNow = track.rig.feet(at: t, anchor: CGPoint(x: at.x, y: at.y), heading: m.heading, unit: 1, speed: m.speed,
                                             stand: (RigVector(0, 0.1, 0), RigVector(0, -0.1, 0)))
                func world(_ f: RigVector) -> CGPoint {
                    CGPoint(x: at.x + f.x * cos(m.heading) - f.y * sin(m.heading), y: at.y + f.x * sin(m.heading) + f.y * cos(m.heading))
                }
                let planted = track.rig.planted(at: t)
                let now = (world(feetNow.left), world(feetNow.right), (planted.left && feetNow.left.z == 0, planted.right && feetNow.right.z == 0))
                if let was = previous[id], m.weight > 0.5 {
                    if now.2.0 && was.2.0 { slip = max(slip, hypot(now.0.x - was.0.x, now.0.y - was.0.y)) }
                    if now.2.1 && was.2.1 { slip = max(slip, hypot(now.1.x - was.1.x, now.1.y - was.1.y)) }
                }
                previous[id] = now
            }
            t += 1.0 / 60
        }
        check(slip < 1e-6, "no planted foot slides across the splice", "slip \(slip) ft")
        check(meeting.slip == 0 && meeting.travel.count == 3, "the clip was met on time: everyone could get there within his limits",
              "slip \(meeting.slip)")
        // The camera carries its velocity across.
        let cam0 = chain.plans[0].cameraState(at: c), cam1 = baked1.cameraState(at: c)
        check(simd_length(cam0.value - cam1.value) < 1e-3, "the camera starts the new plan where it was", "\(cam0.value) vs \(cam1.value)")
    }

    private static func yaw() {
        let rule = YawRule.basketball
        // Inside the band either side of half court: it holds.
        let wobble = rule.targets(from: rule.high, since: -10, at: 0, through: 10) { t in 47 + 5 * sin(t * 2) }
        check(wobble.count == 1, "the ball wandering inside ±6 ft of half court never turns the camera", "\(wobble.count - 1) turns")
        // Over to the left end and straight back: one turn, then the dwell before it may turn back.
        let back = rule.targets(from: rule.high, since: -10, at: 0, through: 6) { t in t < 1 ? 60 : t < 1.5 ? 30 : 60 }
        check(back.count == 3 && abs(back[1].at - 1) < 0.02 && abs(back[2].at - 3) < 0.02,
              "the yaw turns when the ball crosses the band, and not again for two seconds", "\(back.map { ($0.at, $0.yaw) })")
        // The orbit: critically damped (no overshoot), and never faster than 45° a second.
        var op = CameraOperator(CameraState(center: SIMD2(47, 25), span: 40, yaw: rule.high))
        var peak = 0.0, overshoot = 0.0
        for _ in 0..<600 {
            op.step(toward: SIMD4(47, 25, log(40), rule.low), moving: .zero, dt: 1.0 / 60)
            peak = max(peak, abs(op.state.velocity.w))
            overshoot = max(overshoot, op.state.yaw - rule.low)
        }
        check(peak <= 45 * .pi / 180 + 1e-9 && overshoot < 1e-6 && abs(op.state.yaw - rule.low) < 1e-3,
              "a change of ends orbits the camera smoothly: critically damped, never past 45°/s", "peak \(peak * 180 / .pi)°/s")
    }
}
