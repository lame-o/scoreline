import Foundation
import simd

// The game as one broadcast, part 12: plans, the bake and the chain
// (CHOREOGRAPHY §4.2, §4.5, §8.2).
//
// A plan is what happens from a splice on: clips placed on p, how the world
// gets to each, the cues. It's baked once, off the main actor, into dense
// tracks: every man's position and presence every 1/60 s, his stride
// (RigTrack, carried on from the plan before), which clip poses him and when
// the next takes over, the ball, the camera's state, and the frame tiers.
// A frame only samples: a cached index, a lerp, a binary search; nothing
// allocates. The chain holds the plans spliced end to end; each new one
// starts exactly from the state the one before had at its splice.

/// A plan (Phase 0): clips placed on p from a splice.
struct Plan<Clip: TheaterClip>: Sendable {
    let revision: UInt32
    /// The splice: where it takes over from the plan before.
    let start: PTime
    var horizon: PTime
    /// The world at `start` (nil: opening, a declared jump).
    let state: WorldState?
    /// Each man's path just behind the splice (oldest first, 1/60 s apart): his stride's smoothing reads it.
    var history: [ActorID: [SIMD2<Double>]] = [:]
    var placements: [ClipPlacement<Clip>]
    /// Who every man is (the splice matches by it).
    var actors: [ActorID: ClipFigure]
    var cues: [Cue] = []
    var notes: [PlanNote] = []
    /// The camera's yaw: the rule (basketball's ball end), the target at the splice and since when.
    var yawRule: YawRule? = nil
    var yaw: (target: Double, since: PTime)? = nil
    /// The camera at an opening (no state): where it starts.
    var openingCamera: SIMD4<Double>? = nil
    /// Opening, waking, a Jmax catch-up: the frame fades in over 0.25 s (the only discontinuity).
    var declared = false
    /// Plays told by placements this plan no longer carries.
    var toldBefore: Set<String> = []
    /// Where each play this plan tells is presented on p (its decisive moment): the timeline presents it there too.
    var published: [String: PTime] = [:]
    /// Each placed play's decisive moment on the theater's time (the director maps it to p through the clock).
    var decisive: [String: PTime] = [:]

    func placement(at t: PTime) -> Int? {
        guard let first = placements.first else { return nil }
        if t < first.start { return 0 }
        return placements.lastIndex { $0.start <= t }
    }
}

/// Who poses a man from when: a clip figure; while he travels to it, blended from the one before.
struct PoseSpan: Equatable, Sendable {
    var from: PTime
    var placement: Int
    var figure: Int
    /// The clip he leaves (−1: none), blended out by `blendUntil`.
    var previousPlacement = -1
    var previousFigure = -1
    var blendUntil: PTime = -.infinity
}

/// One man through a baked plan.
struct ActorTrack: Sendable {
    let id: ActorID
    let figure: ClipFigure
    let start: PTime
    /// Every 1/60 s from `start`.
    let xy: ContiguousArray<SIMD2<Float>>
    let opacity: ContiguousArray<Float>
    let rig: RigTrack
    let poses: [PoseSpan]

    func index(_ t: PTime) -> (Int, Float) {
        let x = max((t - start) * TheaterTiming.rate, 0)
        let i = min(Int(x), max(xy.count - 2, 0))
        return (i, Float(min(x - Double(i), 1)))
    }

    func position(at t: PTime) -> SIMD2<Double> {
        guard xy.count > 1 else { return xy.first.map(SIMD2<Double>.init) ?? .zero }
        let (i, u) = index(t)
        return SIMD2<Double>(xy[i] + (xy[i + 1] - xy[i]) * u)
    }

    func presence(at t: PTime) -> Double {
        guard opacity.count > 1 else { return Double(opacity.first ?? 0) }
        let (i, u) = index(t)
        return Double(opacity[i] + (opacity[i + 1] - opacity[i]) * u)
    }

    func pose(at t: PTime) -> PoseSpan? {
        guard !poses.isEmpty, t >= poses[0].from else { return poses.first }
        var lo = 0, hi = poses.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if poses[mid].from <= t { lo = mid } else { hi = mid - 1 }
        }
        return poses[lo]
    }
}

/// The ball through a baked plan: in a clip, in a man's hands across a splice, or passed between them.
enum BallSpan: Equatable, Sendable {
    case clip(placement: Int, from: PTime)
    case held(ActorID, from: PTime)
    case flight(BallFlight)

    var from: PTime {
        switch self {
        case let .clip(_, from), let .held(_, from): from
        case let .flight(f): f.t0
        }
    }
}

/// A run of frames at one rate (§5.6.7): 60 while anything's quick or decisive, 30 while it moves, 0 when nothing does.
struct FrameTier: Equatable, Sendable {
    var from: PTime
    var until: PTime
    var fps: UInt8
}

struct BakedPlan<Clip: TheaterClip>: Sendable {
    let plan: Plan<Clip>
    /// Sorted by id.
    let tracks: [ActorTrack]
    /// The camera operator's state every 1/60 s from `plan.start`: x, y, log span, yaw; and its velocity.
    let camera: ContiguousArray<SIMD4<Float>>
    let cameraVelocity: ContiguousArray<SIMD4<Float>>
    let ball: [BallSpan]
    let tiers: [FrameTier]
    /// The yaw's targets (changes and when), carried to the next plan.
    let yawTargets: [(at: PTime, yaw: Double)]

    var start: PTime { plan.start }
    var horizon: PTime { plan.horizon }

    func track(_ id: ActorID) -> ActorTrack? {
        var lo = 0, hi = tracks.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if tracks[mid].id < id { lo = mid + 1 } else { hi = mid }
        }
        return lo < tracks.count && tracks[lo].id == id ? tracks[lo] : nil
    }

    /// The camera at t: x, y, log span, yaw.
    func cameraValue(at t: PTime) -> SIMD4<Double> {
        guard camera.count > 1 else { return camera.first.map(SIMD4<Double>.init) ?? .zero }
        let x = max((t - plan.start) * TheaterTiming.rate, 0)
        let i = min(Int(x), camera.count - 2)
        let u = min(x - Double(i), 1)
        var a = SIMD4<Double>(camera[i]), b = SIMD4<Double>(camera[i + 1])
        b.w = a.w + remainder(b.w - a.w, 2 * .pi)
        a += (b - a) * u
        return a
    }

    func cameraState(at t: PTime) -> CameraState {
        let x = max((t - plan.start) * TheaterTiming.rate, 0)
        let i = min(Int(x.rounded()), max(cameraVelocity.count - 1, 0))
        let v = cameraVelocity.isEmpty ? .zero : SIMD4<Double>(cameraVelocity[i])
        return CameraState(value: cameraValue(at: t), velocity: v)
    }
}

// MARK: - Evaluating a plan (exactly: the splice's source and the bake's)

extension Plan {
    /// Where the man is at t, how fast, and how present; nil before he's on and after he's gone.
    func motion(of id: ActorID, at t: PTime) -> (position: SIMD2<Double>, velocity: SIMD2<Double>, acceleration: SIMD2<Double>, opacity: Double)? {
        guard let k = placement(at: t) else { return nil }
        let p = placements[k]
        if let i = p.figure(of: id) {
            if let path = p.travel[id], let join = p.join[id], t < join {
                let o = p.clip.opacity(i, at: max(p.time(t), 0))
                return (path.position(at: t), path.velocity(at: t), path.acceleration(at: t), o)
            }
            let local = p.time(t)
            let clamped = min(max(local, 0), p.clip.length)
            let moving = local > 0 && local < p.clip.length
            // A man entering fades in where the clip has him.
            let enters = p.entering.contains(id) ? min(max((t - p.start) / 0.4, 0), 1) : 1
            return (p.clip.position(i, at: clamped), moving ? p.clip.velocity(i, at: clamped) : .zero,
                    moving ? p.clip.acceleration(i, at: clamped) : .zero, p.clip.opacity(i, at: clamped) * enters)
        }
        if p.leaving.contains(id) {
            // He stands where the splice found him and fades.
            guard let here = standing(id, at: p.start, before: k) else { return nil }
            let fade = 1 - min(max((t - p.start) / 0.4, 0), 1)
            return fade > 0 ? (here, .zero, .zero, fade * (state?.actor(id)?.opacity ?? 1)) : nil
        }
        return nil
    }

    /// Where a man stood at `t` in the placements before `k` (or the splice's state).
    func standing(_ id: ActorID, at t: PTime, before k: Int) -> SIMD2<Double>? {
        var j = k - 1
        while j >= 0 {
            let p = placements[j]
            if let i = p.figure(of: id) {
                if let path = p.travel[id], let join = p.join[id], t < join { return path.position(at: t) }
                return p.clip.position(i, at: min(max(p.time(t), 0), p.clip.length))
            }
            if p.leaving.contains(id) { break }
            j -= 1
        }
        return state?.actor(id)?.position
    }

    /// Every man the plan has, sorted.
    var everyone: [ActorID] { actors.keys.sorted() }
}

// MARK: - The bake

enum TheaterBake {
    /// Bakes a plan (off the main actor; pure). `facing(placement, figure, t)` is what a man faces at t in his clip.
    static func bake<Clip: TheaterClip>(_ plan: Plan<Clip>, camera tuning: CameraOperator.Tuning = CameraOperator.Tuning()) -> BakedPlan<Clip> {
        let dt = 1 / TheaterTiming.rate
        let n = max(Int(((plan.horizon - plan.start) * TheaterTiming.rate).rounded(.up)), 1) + 1
        func time(_ i: Int) -> PTime { plan.start + Double(i) * dt }
        var tracks: [ActorTrack] = []
        tracks.reserveCapacity(plan.actors.count)
        for id in plan.everyone {
            guard let figure = plan.actors[id] else { continue }
            var xy = ContiguousArray<SIMD2<Float>>(), opacity = ContiguousArray<Float>()
            xy.reserveCapacity(n)
            opacity.reserveCapacity(n)
            var last = plan.state?.actor(id)?.position ?? plan.placements.first.flatMap { p in p.figure(of: id).map { p.clip.position($0, at: 0) } } ?? .zero
            for i in 0..<n {
                if let m = plan.motion(of: id, at: time(i)) {
                    last = m.position
                    xy.append(SIMD2<Float>(m.position))
                    opacity.append(Float(m.opacity))
                } else {
                    xy.append(SIMD2<Float>(last))
                    opacity.append(0)
                }
            }
            let history = plan.history[id] ?? []
            func position(_ t: PTime) -> CGPoint {
                if t < plan.start {
                    let back = (plan.start - t) * TheaterTiming.rate
                    guard !history.isEmpty else { return CGPoint(x: Double(xy[0].x), y: Double(xy[0].y)) }
                    let k = Double(history.count) - back
                    if k <= 0 { return CGPoint(x: history[0].x, y: history[0].y) }
                    let lo = min(Int(k), history.count - 1), u = k - Double(lo)
                    let a = history[lo], b = lo + 1 < history.count ? history[lo + 1] : SIMD2<Double>(xy[0])
                    let p = a + (b - a) * u
                    return CGPoint(x: p.x, y: p.y)
                }
                let x = (t - plan.start) * TheaterTiming.rate
                let i = min(Int(x), n - 2), u = Float(min(x - Double(i), 1))
                let p = xy[i] + (xy[i + 1] - xy[i]) * u
                return CGPoint(x: Double(p.x), y: Double(p.y))
            }
            let poses = poseSpans(plan, id)
            let rig = RigTrack(from: plan.start, through: plan.horizon, height: figure.height, history: Double(history.count) * dt,
                               continuing: plan.state?.actor(id)?.rig, position: position) { t in
                facing(plan, poses, id, at: t)
            }
            tracks.append(ActorTrack(id: id, figure: figure, start: plan.start, xy: xy, opacity: opacity, rig: rig, poses: poses))
        }
        let ball = ballSpans(plan)
        // The yaw: the rule's targets from the ball's end (basketball), else each clip's own.
        var yawTargets: [(at: PTime, yaw: Double)] = []
        if let rule = plan.yawRule {
            let first = plan.yaw ?? (plan.placements.first.map { ($0.clip.camera(at: 0).w, plan.start - rule.dwell) } ?? (rule.high, plan.start))
            yawTargets = rule.targets(from: first.target, since: first.since, at: plan.start, through: plan.horizon) { t in
                ballPoint(plan, ball, at: t).map(\.x)
            }
        }
        let initial = plan.state?.camera ?? CameraState(value: plan.openingCamera ?? goal(plan, at: plan.start, yaw: yawTargets))
        let baked = CameraOperator.bake(from: initial, at: plan.start, through: plan.start + Double(n - 1) * dt, tuning: tuning) { t in
            goal(plan, at: t, yaw: yawTargets)
        }
        // The operator's velocity at each sample, for an exact splice on the grid.
        var velocity = ContiguousArray<SIMD4<Float>>()
        velocity.reserveCapacity(baked.samples.count)
        for i in baked.samples.indices {
            let a = SIMD4<Double>(baked.samples[max(i - 1, 0)]), b = SIMD4<Double>(baked.samples[min(i + 1, baked.samples.count - 1)])
            var d = (b - a) / (Double(min(i + 1, baked.samples.count - 1) - max(i - 1, 0)) * dt)
            d.w = remainder(b.w - a.w, 2 * .pi) / (Double(min(i + 1, baked.samples.count - 1) - max(i - 1, 0)) * dt)
            velocity.append(SIMD4<Float>(i == 0 ? (plan.state?.camera.velocity ?? d) : d))
        }
        let tiers = frameTiers(plan, tracks: tracks, ball: ball, camera: baked.samples)
        return BakedPlan(plan: plan, tracks: tracks, camera: baked.samples, cameraVelocity: velocity, ball: ball, tiers: tiers, yawTargets: yawTargets)
    }

    /// Who poses a man and from when.
    static func poseSpans<Clip: TheaterClip>(_ plan: Plan<Clip>, _ id: ActorID) -> [PoseSpan] {
        var spans: [PoseSpan] = []
        var previous: (placement: Int, figure: Int)?
        for (k, p) in plan.placements.enumerated() {
            guard let i = p.figure(of: id) else {
                if p.leaving.contains(id) { previous = nil }
                continue
            }
            var span = PoseSpan(from: k == 0 ? -.infinity : p.start, placement: k, figure: i)
            if let previous, k > 0 {
                span.previousPlacement = previous.placement
                span.previousFigure = previous.figure
                span.blendUntil = p.join[id] ?? p.start
            }
            spans.append(span)
            previous = (k, i)
        }
        return spans
    }

    /// What a man faces at t: his clip's heading while he's on it (he turns as it turns him); while he
    /// travels to it, where he's going, and the clip's heading once he's there.
    static func facing<Clip: TheaterClip>(_ plan: Plan<Clip>, _ poses: [PoseSpan], _ id: ActorID, at t: PTime) -> RigFacing? {
        guard let k = plan.placement(at: t) else { return nil }
        let p = plan.placements[k]
        guard let i = p.figure(of: id) else { return nil }
        let here = p.clip.position(i, at: min(max(p.time(t), 0), p.clip.length))
        let local = max(p.time(t), 0)
        let heading = p.clip.heading(i, at: min(local, p.clip.length))
        if let join = p.join[id], t < join, let path = p.travel[id] {
            let at = path.position(at: t)
            let goal = p.clip.heading(i, at: p.clip.still)
            return RigFacing(point: CGPoint(x: at.x + cos(goal) * 10, y: at.y + sin(goal) * 10), always: false)
        }
        return RigFacing(point: CGPoint(x: here.x + cos(heading) * 10, y: here.y + sin(heading) * 10), always: true)
    }

    /// The ball through the plan.
    static func ballSpans<Clip: TheaterClip>(_ plan: Plan<Clip>) -> [BallSpan] {
        var spans: [BallSpan] = []
        for (k, p) in plan.placements.enumerated() {
            let from = k == 0 ? -.infinity : p.start
            if let flight = p.ball {
                if let holder = p.holder, flight.t0 > from { spans.append(.held(holder, from: from)) }
                spans.append(.flight(flight))
                spans.append(.clip(placement: k, from: flight.t1))
            } else if let holder = p.holder, let join = p.join.values.max(), join > from {
                spans.append(.held(holder, from: from))
                spans.append(.clip(placement: k, from: join))
            } else {
                spans.append(.clip(placement: k, from: from))
            }
        }
        return spans
    }

    static func ballSpan(_ spans: [BallSpan], at t: PTime) -> BallSpan? {
        guard !spans.isEmpty else { return nil }
        var lo = 0, hi = spans.count - 1
        if t < spans[0].from { return spans[0] }
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if spans[mid].from <= t { lo = mid } else { hi = mid - 1 }
        }
        return spans[lo]
    }

    /// The ball's ground point at t (for the yaw rule), from the plan's evaluation.
    static func ballPoint<Clip: TheaterClip>(_ plan: Plan<Clip>, _ spans: [BallSpan], at t: PTime) -> SIMD2<Double>? {
        switch ballSpan(spans, at: t) {
        case let .clip(k, _)?:
            let p = plan.placements[k]
            switch p.clip.ball(at: min(max(p.time(t), 0), p.clip.length)) {
            case let .held(i)?: return plan.motion(of: p.cast[i], at: t)?.position
            case let .free(point, _)?: return SIMD2(point.x, point.y)
            case nil: return nil
            }
        case let .held(id, _)?: return plan.motion(of: id, at: t)?.position
        case let .flight(f)?:
            let p = f.point(at: t)
            return SIMD2(p.x, p.y)
        case nil: return nil
        }
    }

    /// The camera's goal at t: the clip's own framing; while men travel to a clip, eased from the one before's to
    /// its opening one (the operator bends from wherever it is); the yaw from the rule when there is one.
    static func goal<Clip: TheaterClip>(_ plan: Plan<Clip>, at t: PTime, yaw targets: [(at: PTime, yaw: Double)]) -> SIMD4<Double> {
        guard let k = plan.placement(at: t) else { return plan.openingCamera ?? .zero }
        let p = plan.placements[k]
        var g = p.clip.camera(at: min(max(p.time(t), 0), p.clip.length))
        let joined = p.joined
        if k > 0, t < joined, joined > p.start {
            let q = plan.placements[k - 1]
            let from = q.clip.camera(at: min(max(q.time(t), 0), q.clip.length))
            let u = TheaterCurve.inOut((t - p.start) / (joined - p.start))
            var mixed = from + (g - from) * u
            mixed.w = from.w + remainder(g.w - from.w, 2 * .pi) * u
            g = mixed
        }
        if !targets.isEmpty { g.w = YawRule.target(targets, at: t) }
        return g
    }

    /// The frame tiers (§5.6.7).
    static func frameTiers<Clip: TheaterClip>(_ plan: Plan<Clip>, tracks: [ActorTrack], ball: [BallSpan], camera: ContiguousArray<SIMD4<Float>>) -> [FrameTier] {
        let n = camera.count
        guard n > 1 else { return [] }
        let dt = 1 / TheaterTiming.rate
        let decisive = plan.placements.compactMap { p in p.clip.decisive.map { p.offset + $0 } }
        var tiers: [FrameTier] = []
        for i in 0..<n {
            let t = plan.start + Double(i) * dt
            var fps: UInt8 = 0
            let j = min(i + 1, n - 1), h = Double(max(j - i, 1)) * dt
            for track in tracks where i < track.xy.count {
                let a = track.xy[i], b = track.xy[min(i + 1, track.xy.count - 1)]
                let v = Double(simd_length(b - a)) / h
                if track.opacity[i] > 0.01, v > 0.05 * track.figure.height { fps = max(fps, 30) }
                if track.opacity[i] > 0.01, v > 2.6 * track.figure.height { fps = 60 }
                if i + 1 < track.opacity.count, abs(track.opacity[i + 1] - track.opacity[i]) > 1e-4 { fps = max(fps, 30) }
            }
            if fps < 60, case .flight? = ballSpan(ball, at: t) { fps = 60 }
            if fps < 60, case let .clip(k, _)? = ballSpan(ball, at: t), plan.placements[k].clip.flying(at: plan.placements[k].time(t)) { fps = 60 }
            if fps < 60, decisive.contains(where: { abs($0 - t) <= 1.5 }) { fps = 60 }
            let ca = SIMD4<Double>(camera[i]), cb = SIMD4<Double>(camera[j])
            let span = exp(ca.z)
            let pan = simd_length(SIMD2(cb.x - ca.x, cb.y - ca.y)) / h / span
            if pan > 0.15 || abs(remainder(cb.w - ca.w, 2 * .pi)) / h > 0.02 { fps = 60 } else if pan > 0.002 || abs(cb.z - ca.z) / h > 0.002 { fps = max(fps, 30) }
            if fps < 30, let k = plan.placement(at: t), plan.placements[k].clip.moving(at: plan.placements[k].time(t)) { fps = 30 }
            if let last = tiers.last, last.fps == fps {
                tiers[tiers.count - 1].until = t + dt
            } else {
                tiers.append(FrameTier(from: t, until: t + dt, fps: fps))
            }
        }
        return tiers
    }
}

// MARK: - The chain

/// The plans spliced end to end: what the view samples (CHOREOGRAPHY §10).
struct PlanChain<Clip: TheaterClip>: Sendable {
    private(set) var plans: [BakedPlan<Clip>] = []
    /// Bumps on every splice: a frame compares it, never the plans.
    private(set) var revision: UInt64 = 0

    var isEmpty: Bool { plans.isEmpty }

    /// The plan covering p (the last that has begun).
    func index(at p: PTime) -> Int? {
        guard !plans.isEmpty else { return nil }
        var lo = 0, hi = plans.count - 1
        if p < plans[0].start { return 0 }
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if plans[mid].start <= p { lo = mid } else { hi = mid - 1 }
        }
        return lo
    }

    func plan(at p: PTime) -> BakedPlan<Clip>? { index(at: p).map { plans[$0] } }

    /// Takes in a plan from its splice on: anything at or after its start is superseded; plans long behind are let go.
    mutating func splice(_ next: BakedPlan<Clip>, now p: PTime) {
        plans.removeAll { $0.start >= next.start - 1e-9 }
        plans.append(next)
        // Wholly behind p (the next one already began more than a moment ago): gone.
        while plans.count > 1, plans[1].start <= p - TheaterTiming.keepBehind { plans.removeFirst() }
        revision &+= 1
    }

    /// The frame tiers end to end: each plan's until the next one takes over.
    var tiers: [FrameTier] {
        var out: [FrameTier] = []
        for (i, plan) in plans.enumerated() {
            let until = i + 1 < plans.count ? plans[i + 1].start : .infinity
            for var tier in plan.tiers where tier.from < until {
                tier.until = min(tier.until, until)
                out.append(tier)
            }
        }
        return out
    }

    /// The splice's commit point: at least `lead` past p, on the covering plan's 1/60 s grid (so its state there is exact).
    func commit(after p: PTime, lead: Double = TheaterTiming.commitLead) -> PTime {
        guard let plan = plan(at: p + lead) else { return p + lead }
        let k = ((p + lead - plan.start) * TheaterTiming.rate).rounded(.up)
        return plan.start + max(k, 0) / TheaterTiming.rate
    }

    /// The world exactly at t (the splice source).
    func state(at t: PTime) -> WorldState? {
        guard let baked = plan(at: t) else { return nil }
        let plan = baked.plan
        var actors: [ActorState] = []
        for track in baked.tracks {
            guard let m = plan.motion(of: track.id, at: t) else { continue }
            actors.append(ActorState(id: track.id, position: m.position, velocity: m.velocity, acceleration: m.acceleration,
                                     rig: track.rig.carry(at: t), opacity: m.opacity))
        }
        var ball: BallState?
        switch TheaterBake.ballSpan(baked.ball, at: t) {
        case let .clip(k, _)?:
            let p = plan.placements[k]
            switch p.clip.ball(at: min(max(p.time(t), 0), p.clip.length)) {
            case let .held(i)?:
                let id = p.cast[i]
                if let m = plan.motion(of: id, at: t) { ball = BallState(position: SIMD3(m.position.x, m.position.y, 4.4), holder: id) }
            case let .free(point, _)?: ball = BallState(position: point)
            case nil: break
            }
        case let .held(id, _)?:
            if let m = plan.motion(of: id, at: t) { ball = BallState(position: SIMD3(m.position.x, m.position.y, 4.4), holder: id) }
        case let .flight(f)?: ball = BallState(position: f.point(at: t))
        case nil: break
        }
        let cues = plan.cues.filter { $0.at <= t && $0.until > t }
        return WorldState(at: t, actors: actors, ball: ball, camera: baked.cameraState(at: t), cues: cues)
    }

    /// Each man's path over the `count` frames before t (the next plan's history).
    func history(before t: PTime, count: Int = 12) -> [ActorID: [SIMD2<Double>]] {
        guard let baked = plan(at: t) else { return [:] }
        var out: [ActorID: [SIMD2<Double>]] = [:]
        for track in baked.tracks {
            out[track.id] = (0..<count).reversed().map { k in
                let at = t - Double(k + 1) / TheaterTiming.rate
                return (plan(at: at)?.track(track.id) ?? track).position(at: at)
            }
        }
        return out
    }

    // MARK: Sampling (allocation-free)

    /// Everything a frame needs at p, into the scratch (its buffers reused): which plan, the camera, each man.
    func sample(_ p: PTime, into scratch: FrameScratch) {
        scratch.p = p
        scratch.actors.removeAll(keepingCapacity: true)
        scratch.ball = .none
        guard let k = index(at: p) else {
            scratch.plan = -1
            return
        }
        scratch.plan = k
        let baked = plans[k]
        scratch.camera = baked.cameraValue(at: p)
        scratch.placement = baked.plan.placement(at: p) ?? -1
        for (n, track) in baked.tracks.enumerated() {
            let o = track.presence(at: p)
            guard o > 0.004, let span = track.pose(at: p) else { continue }
            let placement = baked.plan.placements[span.placement]
            var actor = FrameScratch.Actor(id: track.id, track: n, position: track.position(at: p), opacity: o, motion: track.rig.motion(at: p),
                                           placement: span.placement, figure: span.figure, clipTime: placement.time(p))
            if span.previousPlacement >= 0, p < span.blendUntil {
                let from = baked.plan.placements[span.placement].start
                let u = (p - from) / max(span.blendUntil - from, 1e-6)
                actor.previousPlacement = span.previousPlacement
                actor.previousFigure = span.previousFigure
                actor.previousTime = baked.plan.placements[span.previousPlacement].time(p)
                actor.blend = TheaterCurve.inOut(u)
            }
            scratch.actors.append(actor)
        }
        switch TheaterBake.ballSpan(baked.ball, at: p) {
        case let .clip(placement, _)?: scratch.ball = .clip(placement)
        case let .held(id, _)?: scratch.ball = .held(id)
        case let .flight(f)?: scratch.ball = .free(f.point(at: p))
        case nil: scratch.ball = .none
        }
    }
}
