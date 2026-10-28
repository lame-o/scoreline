import SwiftUI

// The theaters' players: one pictogram rig for every sport. A figure is a
// skeleton in its own space (forward, left, up, in body units: it stands
// 1.1 tall), posed in 3D, turned to its heading and drawn through the
// theater's own projection, so a man running at the camera strides toward
// the lens and one seen side-on scissors across it. The proportions are the
// old flat figure's (legs half its height, a round head, the same strokes);
// only the hips and shoulders gain a little width, so each limb hangs from
// its own joint.
//
// How it moves comes from where the script sends it, measured once per
// script (`RigTrack`): its heading turns toward where it's going, or what it
// watches, at a limited rate; its stride follows the ground it covers, so
// cadence and stride grow together through a walk, a jog and a sprint, each
// foot planted where it lands until it lifts (the leg reaches it by
// two-bone IK), and a stop finishes its step. What it does (a delivery, a
// catch, a kick) is a pose over that, authored relative to the heading and
// blended joint by joint: feet as IK targets, arms by their joints, knees
// and elbows only ever bending their own way.
//
// Drawn as before, rim first; its limbs sorted by depth every frame, so the
// ones behind the body are shaded and covered and the ones in front cross
// it with a rim of their own, swapping as it turns.

/// A point or direction in a figure's space, in body units: forward, left, up.
typealias RigVector = SIMD3<Double>

enum Rig {
    static let thigh = 0.25, shin = 0.25, upperArm = 0.18, forearm = 0.17
    /// Pelvis to neck, neck to the head's center, and the head.
    static let spine = 0.3, neck = 0.2, head = 0.115
    /// Each hip and shoulder off the body's midline.
    static let hips = 0.045, shoulders = 0.06
    /// The pelvis of a man standing, and each foot off his midline.
    static let stand = 0.488, stance = 0.06
    /// Knees and elbows bend no further than this.
    static let fold = 2.7

    static func smooth(_ x: Double) -> Double { let u = min(max(x, 0), 1); return u * u * (3 - 2 * u) }

    /// Round the vertical, to the left.
    static func yaw(_ v: RigVector, _ a: Double) -> RigVector {
        let c = cos(a), s = sin(a)
        return RigVector(v.x * c - v.y * s, v.x * s + v.y * c, v.z)
    }

    /// Tipped forward (up toward forward).
    static func pitch(_ v: RigVector, _ a: Double) -> RigVector {
        let c = cos(a), s = sin(a)
        return RigVector(v.x * c + v.z * s, v.y, -v.x * s + v.z * c)
    }

    /// Tipped to the left (up toward left).
    static func roll(_ v: RigVector, _ a: Double) -> RigVector {
        let c = cos(a), s = sin(a)
        return RigVector(v.x, v.y * c + v.z * s, -v.y * s + v.z * c)
    }

    /// Two bones from `root` toward `target`, the joint between them bending
    /// toward `pole`: the joint, and where the chain ends (the target, or as
    /// near as it reaches). The joint is always on the pole's side: a knee
    /// never bends backward.
    static func reach(_ root: RigVector, _ target: RigVector, pole: RigVector, _ a: Double, _ b: Double) -> (joint: RigVector, end: RigVector) {
        var d = target - root
        var dist = (d * d).sum().squareRoot()
        let longest = (a + b) * 0.9995, shortest = abs(a - b) + 0.02
        if dist < 1e-9 { d = RigVector(0, 0, -1); dist = 1 }
        let clamped = min(max(dist, shortest), longest)
        let line = d / dist
        d = line * clamped
        var across = pole - line * (pole * line).sum()
        var size = (across * across).sum().squareRoot()
        if size < 1e-9 { across = RigVector(1, 0, 0) - line * line.x; size = max((across * across).sum().squareRoot(), 1e-9) }
        across /= size
        let along = (a * a - b * b + clamped * clamped) / (2 * clamped)
        let out = max(a * a - along * along, 0).squareRoot()
        return (root + line * along + across * out, root + d)
    }
}

// MARK: - Poses

/// An arm, at the shoulder and the elbow, in the torso's frame.
struct RigArm: Equatable {
    /// Forward from hanging (back below zero), out to the side, round the
    /// vertical (outward), and the elbow (forward, never past straight).
    var swing = 0.0
    var spread = 0.12
    var turn = 0.0
    var bend = 0.18

    init(swing: Double = 0, spread: Double = 0.12, turn: Double = 0, bend: Double = 0.18) {
        self.swing = swing
        self.spread = spread
        self.turn = turn
        self.bend = bend
    }

    fileprivate mutating func add(_ a: RigArm, _ w: Double) {
        swing += a.swing * w
        spread += a.spread * w
        turn += a.turn * w
        bend += a.bend * w
    }

    /// The upper arm's and the forearm's directions, for the arm on side `side` (1 left, −1 right).
    func bones(_ side: Double) -> (upper: RigVector, fore: RigVector) {
        let k = min(max(bend, 0), Rig.fold)
        var upper = RigVector(sin(swing), 0, -cos(swing)), fore = RigVector(sin(swing + k), 0, -cos(swing + k))
        upper = Rig.yaw(Rig.roll(upper, -side * spread), side * turn)
        fore = Rig.yaw(Rig.roll(fore, -side * spread), side * turn)
        return (upper, fore)
    }
}

/// A body's pose relative to its heading: where the pelvis and the feet are
/// (the legs reach the feet), how the body turns and tips, how the torso
/// leans and twists over the pelvis, and the arms. Poses blend joint by
/// joint, so a blend between two poses is a pose.
struct RigPose: Equatable {
    /// The body turned off the heading (to the left): a thrower side-on to his target.
    var turn = 0.0
    /// The pelvis: forward, left and up from the ground point it's placed at.
    var hip = RigVector(0, 0, Rig.stand)
    /// The whole body tipped round the pelvis: forward (flat out), then over to the left round forward (a keeper's dive).
    var pitch = 0.0
    var bank = 0.0
    /// The torso over the pelvis: forward, to the left, and the shoulders twisted (to the left).
    var lean = 0.0
    var roll = 0.0
    var twist = 0.0
    /// The head, forward off the spine (a header's snap).
    var nod = 0.0
    /// Where the feet are, from the ground point, before any tip.
    var left = RigVector(0, Rig.stance, 0)
    var right = RigVector(0, -Rig.stance, 0)
    /// The knees turned out from forward.
    var knees = 0.1
    var leftArm = RigArm()
    var rightArm = RigArm()

    /// Left for right: a left-hander's delivery, a lefty's swing.
    var mirrored: RigPose {
        var p = self
        func flip(_ v: RigVector) -> RigVector { RigVector(v.x, -v.y, v.z) }
        p.turn = -turn
        p.hip = flip(hip)
        p.bank = -bank
        p.roll = -roll
        p.twist = -twist
        p.left = flip(right)
        p.right = flip(left)
        p.leftArm = rightArm
        p.rightArm = leftArm
        return p
    }

    /// Part way to another pose.
    func mix(_ o: RigPose, _ u: Double) -> RigPose {
        guard u > 0 else { return self }
        guard u < 1 else { return o }
        var p = RigPose(zero: ())
        p.add(self, 1 - u)
        p.add(o, u)
        return p
    }

    /// Another pose over this one by `u`: all of it standing still, only
    /// above the hips on the move (`moving` 1), where the legs keep their
    /// stride and the shoulders take the turn the hips don't (a catch, a
    /// throw on the run).
    func over(_ o: RigPose, _ u: Double, moving w: Double) -> RigPose {
        guard u > 0 else { return self }
        var p = mix(o, u * (1 - min(max(w, 0), 1)))
        let m = mix(o, u)
        p.lean = m.lean
        p.roll = m.roll
        p.twist = m.twist + m.turn - p.turn
        p.nod = m.nod
        p.leftArm = m.leftArm
        p.rightArm = m.rightArm
        return p
    }

    /// A weighted sum of poses (the weights summing to one): a blend, or a
    /// spline through keys. Elbows stay between straight and folded.
    static func sum(_ terms: [(RigPose, Double)]) -> RigPose {
        var p = RigPose(zero: ())
        for (q, w) in terms where w != 0 { p.add(q, w) }
        p.leftArm.bend = min(max(p.leftArm.bend, 0), Rig.fold)
        p.rightArm.bend = min(max(p.rightArm.bend, 0), Rig.fold)
        return p
    }

    private mutating func add(_ q: RigPose, _ w: Double) {
        turn += q.turn * w
        hip += q.hip * w
        pitch += q.pitch * w
        bank += q.bank * w
        lean += q.lean * w
        roll += q.roll * w
        twist += q.twist * w
        nod += q.nod * w
        left += q.left * w
        right += q.right * w
        knees += q.knees * w
        leftArm.add(q.leftArm, w)
        rightArm.add(q.rightArm, w)
    }

    private init(zero: ()) {
        hip = .zero
        left = .zero
        right = .zero
        knees = 0
        leftArm = RigArm(swing: 0, spread: 0, turn: 0, bend: 0)
        rightArm = leftArm
    }

    init(turn: Double = 0, hip: RigVector = RigVector(0, 0, Rig.stand), pitch: Double = 0, bank: Double = 0, lean: Double = 0,
         roll: Double = 0, twist: Double = 0, nod: Double = 0, left: RigVector = RigVector(0, Rig.stance, 0),
         right: RigVector = RigVector(0, -Rig.stance, 0), knees: Double = 0.1, leftArm: RigArm = RigArm(), rightArm: RigArm = RigArm()) {
        self.turn = turn
        self.hip = hip
        self.pitch = pitch
        self.bank = bank
        self.lean = lean
        self.roll = roll
        self.twist = twist
        self.nod = nod
        self.left = left
        self.right = right
        self.knees = knees
        self.leftArm = leftArm
        self.rightArm = rightArm
    }

    /// Through key poses at their times: a spline that eases through each
    /// (a little past it, as a body overshoots and settles) and out of the
    /// first and into the last, never a stop at every key. Nil outside them.
    static func keyed(_ keys: [(Double, RigPose)], at x: Double) -> RigPose? {
        guard let first = keys.first?.0, let last = keys.last?.0, x > first, x < last,
              let i = keys.lastIndex(where: { $0.0 <= x }), i + 1 < keys.count else { return nil }
        let (t1, p1) = keys[i], (t2, p2) = keys[i + 1]
        let u = (x - t1) / (t2 - t1), u2 = u * u, u3 = u2 * u
        let h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2
        // Catmull-Rom tangents through the neighbours; flat at the ends.
        var terms: [(RigPose, Double)] = [(p1, h00), (p2, h01)]
        if i > 0 {
            let s = (t2 - t1) / (t2 - keys[i - 1].0)
            terms += [(p2, h10 * s), (keys[i - 1].1, -h10 * s)]
        }
        if i + 2 < keys.count {
            let s = (t2 - t1) / (keys[i + 2].0 - t1)
            terms += [(keys[i + 2].1, h11 * s), (p1, -h11 * s)]
        }
        return sum(terms)
    }
}

extension RigPose {
    /// Standing at ease: an outfielder, a runner at rest.
    static let stand = RigPose()
    /// Knees bent, weight forward, hands low in front: an infielder as the pitch comes.
    static let ready = RigPose(hip: RigVector(-0.06, 0, 0.41), lean: 0.6, left: RigVector(0.03, 0.17, 0), right: RigVector(0.03, -0.17, 0),
                               knees: 0.4, leftArm: RigArm(swing: 0.35, spread: 0.3, turn: -0.35, bend: 0.6),
                               rightArm: RigArm(swing: 0.35, spread: 0.3, turn: -0.35, bend: 0.6))
    /// Arms up for a ball over his head, reaching.
    static let catchHigh = RigPose(hip: RigVector(0, 0, 0.5), lean: -0.12, nod: -0.25, left: RigVector(0.02, 0.06, 0), right: RigVector(-0.04, -0.06, 0),
                                   leftArm: RigArm(swing: 2.75, spread: 0.18, turn: -0.1, bend: 0.25),
                                   rightArm: RigArm(swing: 2.6, spread: 0.12, turn: -0.15, bend: 0.4))
    /// The ball taken at the chest: both hands out in front.
    static let glove = RigPose(hip: RigVector(-0.01, 0, 0.45), lean: 0.12, left: RigVector(0.08, 0.08, 0), right: RigVector(-0.06, -0.08, 0),
                               leftArm: RigArm(swing: 1.2, spread: 0.12, turn: -0.3, bend: 0.5),
                               rightArm: RigArm(swing: 1.0, spread: 0.1, turn: -0.35, bend: 0.75))
    /// A ground ball: down low, the glove at the grass in front of him.
    static let scoop = RigPose(hip: RigVector(-0.05, 0, 0.3), lean: 0.95, nod: -0.4, left: RigVector(0.1, 0.17, 0), right: RigVector(-0.08, -0.15, 0),
                               knees: 0.5, leftArm: RigArm(swing: 0.55, spread: 0.12, turn: -0.15, bend: 0.25),
                               rightArm: RigArm(swing: 0.35, spread: 0.1, turn: -0.2, bend: 0.4))
    /// The throw: side-on to the target, the arm cocked back and up, the glove pointing.
    static let cock = RigPose(turn: -1.25, hip: RigVector(0, 0, 0.45), lean: -0.08, twist: -0.35,
                              left: RigVector(0.08, 0.17, 0), right: RigVector(-0.04, -0.12, 0), knees: 0.2,
                              leftArm: RigArm(swing: 1.45, spread: 0.1, turn: 0.15, bend: 0.25),
                              rightArm: RigArm(swing: 1.2, spread: 0.2, turn: 1.75, bend: 1.55))
    /// …over the top and through: square to it, the arm coming down across him.
    static let release = RigPose(turn: 0.25, hip: RigVector(0.04, 0, 0.43), lean: 0.42, twist: 0.4,
                                 left: RigVector(0.1, 0.16, 0), right: RigVector(-0.18, -0.06, 0.06), knees: 0.2,
                                 leftArm: RigArm(swing: 0.15, spread: 0.3, turn: 0.4, bend: 1.3),
                                 rightArm: RigArm(swing: 1.65, spread: 0.0, turn: -0.35, bend: 0.25))
}

// MARK: - Motion

/// What a figure faces when it isn't going anywhere: a point it watches;
/// `always`, and it keeps facing it on the move (a backpedal, a drop).
struct RigFacing {
    var point: CGPoint
    var always = false
}

/// A figure's motion through a script, measured once: every 1/60 s its
/// heading (turning at a limited rate toward where it's going, or what it
/// watches), its speed (in its own heights a second) and push (speeding
/// up, slowing), how far through its stride it is, and how much it's
/// moving at all; and where each foot lands, when it lifts, and where it
/// lands next. Any frame reads it at t.
struct RigTrack: Equatable {
    struct Sample: Equatable {
        var heading: Float
        var phase: Float
        var speed: Float
        var push: Float
        var weight: Float
    }

    /// A foot down: from when it lands to when it lifts, where (the ground
    /// under the hips at the middle of it), and which way the body faced
    /// then. On a step he comes to rest on (`still`), the ground under him
    /// as he stops, and the foot goes where his standing pose puts it: the
    /// last stride lands in his stance, the next leaves from it.
    struct Step: Equatable {
        var land: Double
        var lift: Double
        var at: CGPoint
        var heading: Double
        var still = false
    }

    static let rate = 60.0

    var start = 0.0
    var end = 0.0
    var samples: [Sample] = []
    var left: [Step] = []
    var right: [Step] = []
    /// A standing figure's height in the field's units (feet, metres): a speed in heights a second is a stride's.
    var height = 1.0

    /// Standing there, facing `heading`.
    init(at p: CGPoint = .zero, heading: Double = 0, height: Double = 1) {
        samples = [Sample(heading: Float(heading), phase: 0, speed: 0, push: 0, weight: 0)]
        left = [Step(land: -.infinity, lift: .infinity, at: p, heading: heading, still: true)]
        right = left
        self.height = height
    }

    /// Measured from `start` through `end` (where it holds), for a figure
    /// `height` tall at `position`, facing what `facing` says when it isn't
    /// moving (or always).
    init(from start: Double, through end: Double, height: Double, position: (Double) -> CGPoint, facing: (Double) -> RigFacing?) {
        self.start = start
        self.end = end
        self.height = height
        let dt = 1 / Self.rate
        let n = max(Int(((end - start) * Self.rate).rounded(.up)), 0)
        func time(_ i: Int) -> Double { i >= n ? end : start + Double(i) * dt }
        // Speed and direction from the path, then smoothed both ways (it's all known): a new move's jump in pace eases.
        var raw = [Double](repeating: 0, count: n + 1), ways = [Double](repeating: 0, count: n + 1), spots = [CGPoint]()
        spots.reserveCapacity(n + 1)
        var way = 0.0
        for i in 0...n {
            let t = time(i), a = position(t - dt / 2), b = position(t + dt / 2)
            spots.append(position(t))
            let d = hypot(b.x - a.x, b.y - a.y)
            raw[i] = d / dt / height
            if d / dt > 0.04 * height { way = atan2(b.y - a.y, b.x - a.x) }
            ways[i] = way
        }
        func smoothed(_ x: [Double], _ r: Int) -> [Double] {
            guard r > 0, x.count > 2 else { return x }
            return x.indices.map { i in
                var s = 0.0, w = 0.0
                for k in max(i - r, 0)...min(i + r, x.count - 1) {
                    let c = Double(r + 1 - abs(k - i))
                    s += x[k] * c; w += c
                }
                return s / w
            }
        }
        let speeds = smoothed(raw, 5)
        let pushes = smoothed(speeds.indices.map { i in
            (speeds[min(i + 1, n)] - speeds[max(i - 1, 0)]) / (Double(min(i + 1, n) - max(i - 1, 0)) * dt)
        }, 6)
        // Their first look at what they face.
        var heading = speeds[0] > 0.3 && !(facing(start)?.always ?? false) ? ways[0] : facing(start).map { f in
            hypot(f.point.x - spots[0].x, f.point.y - spots[0].y) > 1e-6 ? atan2(f.point.y - spots[0].y, f.point.x - spots[0].x) : ways[0]
        } ?? ways[0]
        var phase = 0.0
        samples.reserveCapacity(n + 1)
        for i in 0...n {
            let t = time(i), v = speeds[i]
            if i > 0 {
                // Turning: toward where it's going, else what it watches; quickly standing, wider at a sprint.
                let face = facing(t)
                var goal: Double?
                if v > 0.3, face?.always != true { goal = ways[i] } else if let p = face?.point,
                   hypot(p.x - spots[i].x, p.y - spots[i].y) > 0.05 * height { goal = atan2(p.y - spots[i].y, p.x - spots[i].x) }
                if let goal {
                    let gap = remainder(goal - heading, 2 * .pi)
                    let fastest = 11 - 5 * RigGait.run(v)
                    heading += min(max(gap * 16, -fastest), fastest) * dt
                }
                // The stride: as far as the ground covered asks; stopped, it finishes its step (both feet down).
                var cadence = RigGait.cadence(v) * Rig.smooth(v / 0.12)
                let duty = RigGait.duty(v)
                let a = phase - floor(phase)
                let down = a < duty - 0.5 || (a >= 0.5 && a < duty)
                if v < 0.15, !down { cadence = max(cadence, 1.8) }
                phase += cadence * dt
            }
            // At the end it's still: the frame it holds.
            let weight = Rig.smooth(speeds[i] / 0.35) * Rig.smooth((end - t) / 0.2)
            samples.append(Sample(heading: Float(heading), phase: Float(phase), speed: Float(v), push: Float(pushes[i]), weight: Float(weight)))
        }
        // The steps: each foot lands as its part of the stride comes round, and lifts after its share.
        for (side, offset) in [(0, 0.0), (1, 0.5)] {
            var steps = [Step(land: -.infinity, lift: .infinity, at: spots[0], heading: Double(samples[0].heading))]
            var count = floor(offset), down = true
            for i in stride(from: 1, through: n, by: 1) {
                let a = Double(samples[i - 1].phase) + offset, b = Double(samples[i].phase) + offset
                guard b > a else { continue }
                func when(_ x: Double) -> Double { time(i - 1) + (time(i) - time(i - 1)) * (x - a) / (b - a) }
                if down, b - count >= RigGait.duty(speeds[i]) {
                    steps[steps.count - 1].lift = when(max(count + RigGait.duty(speeds[i]), a))
                    down = false
                }
                if !down, floor(b) > count {
                    count = floor(b)
                    steps.append(Step(land: when(count), lift: .infinity, at: .zero, heading: 0))
                    down = true
                }
            }
            // Each foot lands under where the hips will be halfway through its time down; or where he stands, if he stops on it.
            for k in steps.indices {
                let s = steps[k]
                let from = Int(((max(s.land, start) - start) * Self.rate).rounded(.up)), to = Int(((min(s.lift, end) - start) * Self.rate).rounded(.down))
                if from <= to, let i = (max(from, 0)...max(min(to, n), 0)).first(where: { samples[$0].weight < 0.04 }) {
                    steps[k].still = true
                    steps[k].at = spots[i]
                    steps[k].heading = Double(samples[i].heading)
                } else if k > 0 {
                    let middle = s.lift.isFinite ? (s.land + s.lift) / 2 : s.land + 0.5 * RigGait.duty(0) / RigGait.cadence(0)
                    let m = min(max(middle, start), end)
                    steps[k].at = position(m)
                    steps[k].heading = Double(sample(at: m).heading)
                }
            }
            if side == 0 { left = steps } else { right = steps }
        }
    }

    private func sample(at t: Double) -> Sample {
        guard let first = samples.first, let last = samples.last else { return Sample(heading: 0, phase: 0, speed: 0, push: 0, weight: 0) }
        guard t > start else { return first }
        guard t < end, samples.count > 1 else { return last }
        // Every 1/60 s, the last at the end.
        let i = min(Int((t - start) * Self.rate), samples.count - 2)
        let t0 = start + Double(i) / Self.rate, t1 = i + 2 == samples.count ? end : t0 + 1 / Self.rate
        let a = samples[i], b = samples[i + 1], u = Float(min(max((t - t0) / max(t1 - t0, 1e-9), 0), 1))
        let turn = Float(remainder(Double(b.heading - a.heading), 2 * .pi))
        return Sample(heading: a.heading + turn * u, phase: a.phase + (b.phase - a.phase) * u, speed: a.speed + (b.speed - a.speed) * u,
                      push: a.push + (b.push - a.push) * u, weight: a.weight + (b.weight - a.weight) * u)
    }

    /// The motion at t (t = ∞: how it ends).
    func motion(at t: Double) -> RigMotion {
        let s = sample(at: t)
        return RigMotion(heading: Double(s.heading), phase: Double(s.phase), speed: Double(s.speed), push: Double(s.push), weight: Double(s.weight))
    }

    /// Where each foot is at t, in the frame of `heading` from `anchor` (the
    /// ground under the hips), `unit` body units to the field's: planted,
    /// or on its way from one plant to the next, lifting as it goes; where
    /// he stands still, where `stand` (his standing pose's feet) puts them.
    func feet(at t: Double, anchor: CGPoint, heading: Double, unit: Double, speed: Double,
              stand: (left: RigVector, right: RigVector)) -> (left: RigVector, right: RigVector) {
        let run = RigGait.run(speed)
        // A walk barely lifts its foot; a run folds the heel up behind early in its swing.
        let lift = 0.05 + 0.17 * run + 0.06 * RigGait.sprint(speed), peak = 0.48 - 0.13 * run
        let curve = log(0.5) / log(peak)
        func foot(_ steps: [Step], _ side: Double, _ standing: RigVector) -> RigVector {
            guard !steps.isEmpty else { return standing }
            // Where a step puts the foot, from the anchor, along the field's axes.
            func place(_ s: Step) -> RigVector {
                let foot = Rig.yaw(s.still ? RigVector(standing.x, standing.y, 0) : RigVector(0, side * Rig.stance, 0), s.heading)
                return RigVector((s.at.x - anchor.x) * unit + foot.x, (s.at.y - anchor.y) * unit + foot.y, 0)
            }
            var lo = 0, hi = steps.count - 1
            while lo < hi {
                let mid = (lo + hi + 1) / 2
                if steps[mid].land <= t { lo = mid } else { hi = mid - 1 }
            }
            let s = steps[lo]
            var at = place(s)
            if t >= s.lift, lo + 1 < steps.count {
                let next = steps[lo + 1]
                let w = min(max((t - s.lift) / max(next.land - s.lift, 1e-6), 0), 1)
                // Smootherstep: still as it lifts and as it lands, so neither slides.
                let e = w * w * w * (w * (w * 6 - 15) + 10)
                at += (place(next) - at) * e
                at.z = lift * sin(.pi * pow(w, curve))
                // Never further from the hips than a leg swings: a replay's fast-forward run strides long, not into the splits.
                let r = hypot(at.x, at.y), knee = 0.24, most = 0.36
                if r > knee {
                    let k = (knee + (most - knee) * tanh((r - knee) / (most - knee))) / r
                    at.x *= k
                    at.y *= k
                }
            }
            return Rig.yaw(at, -heading)
        }
        return (foot(left, 1, stand.left), foot(right, -1, stand.right))
    }
}

/// A figure's motion at an instant (see `RigTrack`).
struct RigMotion {
    var heading: Double
    var phase: Double
    /// Heights a second.
    var speed: Double
    /// Heights a second, a second.
    var push: Double
    /// Moving at all: 0 standing, 1 on the move.
    var weight: Double
}

/// The stride by speed (in heights a second): one smooth curve from a walk to a sprint.
enum RigGait {
    /// Strides a second (each foot once): a walk's one and a half, a sprint's three and a half, a fast-forward's four and a half.
    static func cadence(_ v: Double) -> Double { 1.0 + 4.2 * v / (v + 5.5) }

    /// How much of its stride each foot is down: most of a walk, a sixth of
    /// a sprint, and never more ground than a leg can reach under the hips.
    static func duty(_ v: Double) -> Double {
        let walking = 0.64 - 0.4 * Rig.smooth((v - 0.8) / 4.2)
        return max(min(walking, 0.36 * cadence(v) / max(v * 1.1, 1e-6)), 0.08)
    }

    /// How much of a run it is (0 a walk), and of a sprint.
    static func run(_ v: Double) -> Double { Rig.smooth((v - 1.2) / 2.2) }
    static func sprint(_ v: Double) -> Double { Rig.smooth((v - 4) / 4.5) }
}

extension RigPose {
    /// On the move: the legs reaching for their planted feet (the hips as
    /// high as both can reach, bobbing with the stride), the arms swinging
    /// against the legs, leaning into the run and into a push.
    static func gait(_ m: RigMotion, feet: (left: RigVector, right: RigVector)) -> RigPose {
        let v = m.speed, run = RigGait.run(v), sprint = RigGait.sprint(v), duty = RigGait.duty(v)
        // Each leg through its stride: 0 landing, π lifting, 2π landing again; cos, how far forward it is.
        func cycle(_ x: Double) -> Double {
            let a = x - floor(x)
            return a < duty ? .pi * a / duty : .pi + .pi * (a - duty) / (1 - duty)
        }
        let l = cycle(m.phase), r = cycle(m.phase + 0.5)
        var p = RigPose()
        p.left = feet.left
        p.right = feet.right
        // The pelvis turns with the leg going forward; the shoulders against it.
        p.turn = 0.09 * run * (cos(r) - cos(l)) / 2
        p.twist = -2.2 * p.turn
        p.lean = 0.05 + 0.2 * run + 0.1 * sprint + min(max(m.push * 0.02, -0.12), 0.18)
        // Lowest as a foot takes the weight in a run, highest over it in a walk.
        let bob = (0.022 * run - 0.012 * (1 - run)) * cos(2 * l)
        var height = Rig.stand - 0.02 * run - 0.01 * sprint + bob
        let leg = (Rig.thigh + Rig.shin) * 0.995
        for (foot, side) in [(feet.left, 1.0), (feet.right, -1.0)] {
            let joint = Rig.yaw(RigVector(0, side * Rig.hips, 0), p.turn)
            let across = hypot(foot.x - joint.x, foot.y - joint.y)
            let reach = foot.z + max(leg * leg - across * across, 0.0004).squareRoot()
            // A soft minimum: the hips settle into the reach, never kink at it.
            height = (height + reach - ((height - reach) * (height - reach) + 0.0004).squareRoot()) / 2
        }
        // Never a crouch: past its reach, a foot trails.
        p.hip = RigVector(0, 0, max(height, Rig.stand - 0.12))
        // The arms: against the legs, a touch behind them; bent more the faster he goes, most on the way forward.
        let swing = 0.3 + 0.42 * run + 0.25 * sprint
        func arm(_ phase: Double) -> RigArm {
            let a = -swing * cos(phase - 0.3)
            return RigArm(swing: a, spread: 0.1 + 0.06 * run, turn: -0.15 * run,
                          bend: 0.25 + 1.1 * run + 0.15 * sprint + 0.35 * run * max(a, 0) / swing)
        }
        p.leftArm = arm(l)
        p.rightArm = arm(r)
        return p
    }
}

// MARK: - Skeleton

/// A pose put together: each joint in the frame of the heading, from the
/// ground point under the figure.
struct RigSkeleton {
    var hip: RigVector
    var neck: RigVector
    var head: RigVector
    /// Left then right.
    var hips: (RigVector, RigVector)
    var knees: (RigVector, RigVector)
    var feet: (RigVector, RigVector)
    var shoulders: (RigVector, RigVector)
    var elbows: (RigVector, RigVector)
    var hands: (RigVector, RigVector)
    /// The way each knee bends and the axis each elbow bends round: the joint limits (tested).
    var kneeForward: (RigVector, RigVector)
    var elbowAxis: (RigVector, RigVector)

    init(_ p: RigPose) {
        let hip = p.hip
        // The legs: from each hip to its foot, the knees forward (turned out a little).
        func leg(_ foot: RigVector, _ side: Double) -> (hip: RigVector, knee: RigVector, foot: RigVector, forward: RigVector) {
            let joint = hip + Rig.yaw(RigVector(0, side * Rig.hips, 0), p.turn)
            var target = foot
            if abs(p.pitch) < 0.3, abs(p.bank) < 0.3 { target.z = max(target.z, 0) }
            // Forward, turned out, and a touch up: a thigh out in front still bends its knee up, not down.
            let forward = Rig.yaw(RigVector(1, 0, 0), p.turn + side * p.knees) + RigVector(0, 0, 0.15)
            let (knee, end) = Rig.reach(joint, target, pole: forward, Rig.thigh, Rig.shin)
            return (joint, knee, end, forward)
        }
        let l = leg(p.left, 1), r = leg(p.right, -1)
        // The torso over the pelvis, the shoulders twisted on it, the head on the spine (its axes found once).
        func rotated(_ v: RigVector) -> RigVector { Rig.yaw(Rig.pitch(Rig.roll(Rig.yaw(v, p.twist), p.roll), p.lean), p.turn) }
        let tx = rotated(RigVector(1, 0, 0)), ty = rotated(RigVector(0, 1, 0)), tz = rotated(RigVector(0, 0, 1))
        func torso(_ v: RigVector) -> RigVector { tx * v.x + ty * v.y + tz * v.z }
        let neck = hip + torso(RigVector(0, 0, Rig.spine))
        let head = neck + torso(Rig.pitch(RigVector(0, 0, Rig.neck), p.nod))
        func arm(_ a: RigArm, _ side: Double) -> (shoulder: RigVector, elbow: RigVector, hand: RigVector, axis: RigVector) {
            let shoulder = neck + torso(RigVector(0, side * Rig.shoulders, -0.025))
            let bones = a.bones(side)
            let elbow = shoulder + torso(bones.upper) * Rig.upperArm
            let axis = Rig.yaw(Rig.roll(RigVector(0, 1, 0), -side * a.spread), side * a.turn)
            return (shoulder, elbow, elbow + torso(bones.fore) * Rig.forearm, torso(axis))
        }
        let la = arm(p.leftArm, 1), ra = arm(p.rightArm, -1)
        // Tipped whole round the pelvis.
        let tipped = p.pitch != 0 || p.bank != 0
        func tilt(_ v: RigVector) -> RigVector { Rig.yaw(Rig.roll(Rig.pitch(Rig.yaw(v, -p.turn), p.pitch), p.bank), p.turn) }
        let ux = tipped ? tilt(RigVector(1, 0, 0)) : RigVector(1, 0, 0), uy = tipped ? tilt(RigVector(0, 1, 0)) : RigVector(0, 1, 0)
        let uz = tipped ? tilt(RigVector(0, 0, 1)) : RigVector(0, 0, 1)
        func turned(_ v: RigVector) -> RigVector { tipped ? ux * v.x + uy * v.y + uz * v.z : v }
        func tip(_ v: RigVector) -> RigVector { tipped ? hip + turned(v - hip) : v }
        self.hip = hip
        self.neck = tip(neck)
        self.head = tip(head)
        hips = (tip(l.hip), tip(r.hip))
        knees = (tip(l.knee), tip(r.knee))
        feet = (tip(l.foot), tip(r.foot))
        shoulders = (tip(la.shoulder), tip(ra.shoulder))
        elbows = (tip(la.elbow), tip(ra.elbow))
        hands = (tip(la.hand), tip(ra.hand))
        kneeForward = (turned(l.forward), turned(r.forward))
        elbowAxis = (turned(la.axis), turned(ra.axis))
    }
}

// MARK: - Projection

/// How a theater sees a figure where it stands: the screen point under it,
/// the screen offset of a body unit along the field's x, y and up, body
/// units to the field's (so a planted foot lands exactly on its spot), and
/// which way the camera looks (what's further along it is drawn first).
struct RigLens {
    var origin: CGPoint
    var x: CGVector
    var y: CGVector
    var z: CGVector
    var unit: Double
    var view: RigVector
    /// The figure standing, in points.
    var height: CGFloat

    func point(_ p: RigVector) -> CGPoint {
        CGPoint(x: origin.x + x.dx * p.x + y.dx * p.y + z.dx * p.z, y: origin.y + x.dy * p.x + y.dy * p.y + z.dy * p.z)
    }

    /// The ballpark's and the gridiron's dimetric view: the ground squashed to
    /// half height (turned by `yaw` first), the figure upright at its full height.
    init(_ f: FieldProjection, at p: CGPoint, yaw: Double = 0) {
        let s = Double(f.figure) / 1.1, c = cos(yaw), n = sin(yaw)
        origin = f.point(Gridiron.view(p, yaw: yaw))
        x = CGVector(dx: c * s, dy: 0.5 * n * s)
        y = CGVector(dx: n * s, dy: -0.5 * c * s)
        z = CGVector(dx: 0, dy: -s)
        unit = Double(f.scale) / s
        // From behind and above (the half-height ground is a 30° look down): further is up the field and lower.
        view = RigVector(-n * 0.866, c * 0.866, -0.5)
        height = f.figure
    }

    init(_ f: GridProjection, at p: CGPoint) { self.init(f.f, at: p, yaw: f.yaw) }

    /// The pitch in perspective: the ground as the lens sees it round the
    /// figure's feet (smaller further off), the figure upright.
    init(_ f: PitchProjection, at p: CGPoint) {
        let ground = FieldPoint(p)
        height = f.figure(at: p)
        let s = Double(height) / 1.1, b = f.basis
        let d = SIMD3(ground.x, ground.y, ground.z) - b.eye
        let depth = max((d * b.forward).sum(), 0.5)
        let u = (d * b.right).sum() / depth, v = (d * b.up).sum() / depth
        let unit = f.scale(at: ground) / s
        // The lens's rate of change along each axis, per metre, in points; then per body unit.
        func along(_ e: SIMD3<Double>) -> CGVector {
            let forward = (e * b.forward).sum()
            return CGVector(dx: f.focal * ((e * b.right).sum() - u * forward) / depth / unit,
                            dy: -f.focal * ((e * b.up).sum() - v * forward) / depth / unit)
        }
        self.unit = unit
        origin = f.point(ground)
        x = along(SIMD3(1, 0, 0))
        y = along(SIMD3(0, 1, 0))
        z = CGVector(dx: 0, dy: -s)
        view = b.forward
    }
}

// MARK: - Figure

/// A pose on screen: its joints projected, its limbs in the order they're
/// drawn (behind the body first, shaded by how far behind; then those in
/// front), the stroke widths, and its shadow's place.
struct RigFigure {
    struct Limb {
        var root: CGPoint
        var joint: CGPoint
        var end: CGPoint
        /// 0: level with the body or in front; up to `RigFigure.shades − 1`, well behind it.
        var shade: Int
        var front: Bool
        var depth: Double
    }

    static let shades = 5

    var hip: CGPoint
    var neck: CGPoint
    var head: CGPoint
    var headRadius: CGFloat
    /// Far to near: which side of the body each is on.
    var limbs: [Limb]
    var hands: (CGPoint, CGPoint)
    /// Stroke widths.
    var torso: CGFloat
    var limb: CGFloat
    /// The ground under the hips, and how far the lower foot is off it (body units).
    var ground: CGPoint
    var air: Double

    /// Between the hands: where a bat or a held ball is.
    var grip: CGPoint { CGPoint(x: (hands.0.x + hands.1.x) / 2, y: (hands.0.y + hands.1.y) / 2) }

    init(_ pose: RigPose, heading: Double, lens: RigLens) {
        self.init(RigSkeleton(pose), heading: heading, lens: lens)
    }

    init(_ k: RigSkeleton, heading: Double, lens: RigLens) {
        let c = cos(heading), s = sin(heading)
        func world(_ p: RigVector) -> RigVector { RigVector(p.x * c - p.y * s, p.x * s + p.y * c, p.z) }
        func screen(_ p: RigVector) -> CGPoint { lens.point(world(p)) }
        func depth(_ p: RigVector) -> Double { (world(p) * lens.view).sum() }
        let scale = lens.height / 1.1
        hip = screen(k.hip)
        neck = screen(k.neck)
        head = screen(k.head)
        headRadius = max(Rig.head * scale, 1.5)
        torso = max(0.19 * scale, 2)
        limb = max(0.085 * scale, 1.1)
        hands = (screen(k.hands.0), screen(k.hands.1))
        ground = screen(RigVector(k.hip.x, k.hip.y, 0))
        air = max(min(k.feet.0.z, k.feet.1.z), 0)
        // Each limb against the body: which side of the spine it's on, toward the camera or away.
        var spine = k.neck - k.hip
        spine /= max((spine * spine).sum().squareRoot(), 1e-9)
        func part(_ a: RigVector, _ b: RigVector, _ e: RigVector) -> Limb {
            let v = (a + 2 * b + e) / 4 - k.hip
            let d = depth(v - spine * (v * spine).sum())
            let shade = Int((min(max(d / 0.05, 0), 1) * Double(Self.shades - 1)).rounded())
            return Limb(root: screen(a), joint: screen(b), end: screen(e), shade: shade, front: d < 0, depth: d)
        }
        limbs = [part(k.hips.0, k.knees.0, k.feet.0), part(k.hips.1, k.knees.1, k.feet.1),
                 part(k.shoulders.0, k.elbows.0, k.hands.0), part(k.shoulders.1, k.elbows.1, k.hands.1)]
            .sorted { $0.depth > $1.depth }
    }

    /// Moved on screen (a keeper's hands taken to the ball).
    mutating func shift(by d: CGVector) {
        func moved(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x + d.dx, y: p.y + d.dy) }
        hip = moved(hip)
        neck = moved(neck)
        head = moved(head)
        hands = (moved(hands.0), moved(hands.1))
        for i in limbs.indices {
            limbs[i].root = moved(limbs[i].root)
            limbs[i].joint = moved(limbs[i].joint)
            limbs[i].end = moved(limbs[i].end)
        }
    }

    var headRect: CGRect { CGRect(x: head.x - headRadius, y: head.y - headRadius, width: 2 * headRadius, height: 2 * headRadius) }

    var body: Path {
        var p = Path()
        p.move(to: hip)
        p.addLine(to: neck)
        return p
    }
}
