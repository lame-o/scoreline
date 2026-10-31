import Foundation
import simd

// The game as one broadcast, part 9: motion (CHOREOGRAPHY §5.5). Keyframes to
// tracks a person could run.
//
// Every segment between two keys is a quintic Hermite: position, velocity and
// acceleration match at both ends, so a path is C² everywhere but at a
// declared contact. Velocities at keys a figure runs through come from
// non-uniform Catmull–Rom (clamped to his sprint), accelerations from their
// neighbors (clamped to his limits); he arrives at rest where he stops. A long
// move from rest to rest cruises (ramp, cruise, ramp), the way a man runs up
// to a speed and holds it, rather than one easing that reads sluggish. The
// splice's travel (TheaterClips.swift) is the same synthesis from the world's
// exact state to where the next clip wants him, timed by what his limits
// allow: if the time isn't there, the plan takes more (a declared catch-up),
// never a faster man.
//
// Closed forms and bounded searches only: deterministic, and portable.

/// One quintic Hermite segment of a 2-D path, on [t0, t0 + duration].
struct Quintic: Equatable, Sendable {
    var t0: PTime
    var duration: Double
    /// p(s) = c0 + c1 s + … + c5 s⁵ with s = (t − t0)/duration.
    private var c: (SIMD2<Double>, SIMD2<Double>, SIMD2<Double>, SIMD2<Double>, SIMD2<Double>, SIMD2<Double>)

    init(t0: PTime, duration: Double, from x0: SIMD2<Double>, _ v0: SIMD2<Double>, _ a0: SIMD2<Double>,
         to x1: SIMD2<Double>, _ v1: SIMD2<Double>, _ a1: SIMD2<Double>) {
        self.t0 = t0
        let T = max(duration, 1e-6)
        self.duration = T
        let d = x1 - x0, V0 = v0 * T, V1 = v1 * T, A0 = a0 * T * T, A1 = a1 * T * T
        c = (x0, V0, 0.5 * A0,
             10 * d - 6 * V0 - 4 * V1 - 1.5 * A0 + 0.5 * A1,
             -15 * d + 8 * V0 + 7 * V1 + 1.5 * A0 - A1,
             6 * d - 3 * V0 - 3 * V1 - 0.5 * A0 + 0.5 * A1)
    }

    var t1: PTime { t0 + duration }

    static func == (a: Quintic, b: Quintic) -> Bool {
        a.t0 == b.t0 && a.duration == b.duration && a.c.0 == b.c.0 && a.c.1 == b.c.1 && a.c.2 == b.c.2 && a.c.3 == b.c.3
            && a.c.4 == b.c.4 && a.c.5 == b.c.5
    }

    private func s(_ t: PTime) -> Double { min(max((t - t0) / duration, 0), 1) }

    func position(at t: PTime) -> SIMD2<Double> {
        let s = s(t)
        return c.0 + s * (c.1 + s * (c.2 + s * (c.3 + s * (c.4 + s * c.5))))
    }

    func velocity(at t: PTime) -> SIMD2<Double> {
        let s = s(t)
        return (c.1 + s * (2 * c.2 + s * (3 * c.3 + s * (4 * c.4 + s * 5 * c.5)))) / duration
    }

    func acceleration(at t: PTime) -> SIMD2<Double> {
        let s = s(t)
        return (2 * c.2 + s * (6 * c.3 + s * (12 * c.4 + s * 20 * c.5))) / (duration * duration)
    }
}

/// A path from keys: quintic segments end to end, holding its first and last points outside them.
struct MotionPath: Equatable, Sendable {
    var segments: [Quintic]
    /// Where it stands before the first segment (and after the last, if it has none).
    var rest: SIMD2<Double>

    init(at point: SIMD2<Double>) {
        segments = []
        rest = point
    }

    init(segments: [Quintic]) {
        self.segments = segments
        rest = segments.first?.position(at: segments.first!.t0) ?? .zero
    }

    var start: PTime { segments.first?.t0 ?? -.infinity }
    var end: PTime { segments.last?.t1 ?? -.infinity }

    private func segment(at t: PTime) -> Quintic? {
        guard let first = segments.first else { return nil }
        if t <= first.t0 { return first }
        var lo = 0, hi = segments.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if segments[mid].t0 <= t { lo = mid } else { hi = mid - 1 }
        }
        return segments[lo]
    }

    func position(at t: PTime) -> SIMD2<Double> { segment(at: t)?.position(at: t) ?? rest }

    /// Outside its segments it holds still.
    func velocity(at t: PTime) -> SIMD2<Double> {
        guard let s = segment(at: t), t >= start, t <= end else { return .zero }
        return s.velocity(at: t)
    }

    func acceleration(at t: PTime) -> SIMD2<Double> {
        guard let s = segment(at: t), t >= start, t < end else { return .zero }
        return s.acceleration(at: t)
    }
}

enum TheaterMotion {
    // MARK: Closed forms

    /// The shortest rest-to-rest quintic over `distance` within a band: its peak speed is
    /// 1.875·d/T and its peak acceleration 5.77·d/T² (§5.5.4).
    static func shortest(distance d: Double, band: MotionLimits.Band) -> Double {
        guard d > 1e-9 else { return 0 }
        return max(1.875 * d / band.sprint, (5.77 * d / min(band.accel, band.decel)).squareRoot())
    }

    // MARK: Synthesis

    /// A path through `keys` (in time order) for a man with this band:
    /// Catmull–Rom velocities at through keys, accelerations from the
    /// neighbors, at rest at arrivals and departures, the given values at
    /// hard keys that carry them (the splice's).
    static func path(_ keys: [MotionKey], band: MotionLimits.Band) -> MotionPath {
        guard keys.count > 1 else { return MotionPath(at: keys.first?.at ?? .zero) }
        let n = keys.count
        var v = [SIMD2<Double>](repeating: .zero, count: n), a = [SIMD2<Double>](repeating: .zero, count: n)
        for j in 0..<n {
            let k = keys[j]
            if let given = k.velocity { v[j] = given; continue }
            switch k.kind {
            case .arrive, .depart: v[j] = .zero
            case .through, .contact:
                guard j > 0, j < n - 1 else { v[j] = .zero; continue }
                let t0 = keys[j].t - keys[j - 1].t, t1 = keys[j + 1].t - keys[j].t
                guard t0 > 1e-9, t1 > 1e-9 else { continue }
                let back = (keys[j].at - keys[j - 1].at) / t0, ahead = (keys[j + 1].at - keys[j].at) / t1
                v[j] = clamp((t1 / (t0 + t1)) * back + (t0 / (t0 + t1)) * ahead, band.sprint)
            }
        }
        for j in 0..<n {
            let k = keys[j]
            if let given = k.acceleration { a[j] = given; continue }
            guard case .through = k.kind, j > 0, j < n - 1 else { continue }
            let span = keys[j + 1].t - keys[j - 1].t
            guard span > 1e-9 else { continue }
            a[j] = clamp(0.5 * (v[j + 1] - v[j - 1]) / span, min(band.accel, band.decel))
        }
        var segments: [Quintic] = []
        segments.reserveCapacity(n - 1)
        for j in 0..<(n - 1) where keys[j + 1].t > keys[j].t + 1e-9 {
            segments.append(Quintic(t0: keys[j].t, duration: keys[j + 1].t - keys[j].t, from: keys[j].at, v[j], a[j], to: keys[j + 1].at, v[j + 1], a[j + 1]))
        }
        return MotionPath(segments: segments)
    }

    static func clamp(_ v: SIMD2<Double>, _ most: Double) -> SIMD2<Double> {
        let m = simd_length(v)
        return m > most && m > 0 ? v * (most / m) : v
    }

    // MARK: Travel (the splice's)

    /// How a man gets from his state at `t0` (where, how fast, accelerating
    /// how) to `x1`, arriving with `v1` (and `a1`) at `t0 + duration`. A
    /// short move is one quintic; a long one ramps to a cruise and back,
    /// the cruise as slow as the time allows (a jog when there's time, a
    /// sprint when there isn't).
    static func travel(from x0: SIMD2<Double>, _ v0: SIMD2<Double>, _ a0: SIMD2<Double>, at t0: PTime, to x1: SIMD2<Double>,
                       _ v1: SIMD2<Double> = .zero, _ a1: SIMD2<Double> = .zero, duration: Double, band: MotionLimits.Band,
                       cruiseOver: Double) -> MotionPath {
        let direct = steer(from: x0, v0, a0, at: t0, to: x1, v1, a1, duration: duration, band: band, cruiseOver: cruiseOver)
        // Already on the move and the straight path asks more than his legs (running the wrong way, too fast to turn):
        // he pulls up first, as a man does, then goes.
        guard simd_length(v0) > 0.5, !violations(direct, from: t0, to: t0 + duration, band: band).isEmpty,
              let braked = brake(from: x0, v0, a0, at: t0, to: x1, v1, a1, duration: duration, band: band, cruiseOver: cruiseOver) else {
            return direct
        }
        return braked
    }

    /// Pulling up from his speed (as hard as the band allows, no harder), standing a moment if there's time, then the
    /// move to `x1` at a natural pace; nil if the time doesn't allow both.
    static func brake(from x0: SIMD2<Double>, _ v0: SIMD2<Double>, _ a0: SIMD2<Double>, at t0: PTime, to x1: SIMD2<Double>,
                      _ v1: SIMD2<Double>, _ a1: SIMD2<Double>, duration: Double, band: MotionLimits.Band, cruiseOver: Double) -> MotionPath? {
        let speed = simd_length(v0)
        let stop = max(0.35, 1.875 * speed / min(band.decel, band.lateral) * 1.05)
        let xs = x0 + v0 * (stop / 2) + a0 * (stop * stop / 12)
        let left = duration - stop
        let need = simd_length(v1) > 1e-9 ? simd_length(x1 - xs) / max(band.run, 1e-6) + 0.45 : shortest(distance: simd_length(x1 - xs), band: band)
        guard left >= need else { return nil }
        // As slow as a jog allows, no slower than the time left needs.
        let pace = min(left, max(need * 1.6, need))
        let pull = Quintic(t0: t0, duration: stop, from: x0, v0, a0, to: xs, .zero, .zero)
        let go = steer(from: xs, .zero, .zero, at: t0 + duration - pace, to: x1, v1, a1, duration: pace, band: band, cruiseOver: cruiseOver)
        return MotionPath(segments: [pull] + go.segments)
    }

    /// The straight form: one quintic, or a ramp, a cruise and a ramp.
    static func steer(from x0: SIMD2<Double>, _ v0: SIMD2<Double>, _ a0: SIMD2<Double>, at t0: PTime, to x1: SIMD2<Double>,
                      _ v1: SIMD2<Double> = .zero, _ a1: SIMD2<Double> = .zero, duration: Double, band: MotionLimits.Band,
                      cruiseOver: Double) -> MotionPath {
        let d = simd_length(x1 - x0)
        let T = max(duration, 1e-3)
        guard d > cruiseOver, simd_length(v1) < 1e-9 else {
            return MotionPath(segments: [Quintic(t0: t0, duration: T, from: x0, v0, a0, to: x1, v1, a1)])
        }
        let dir = (x1 - x0) / d
        // The cruise speed that fits the time: ramps of at least 0.45 s, each as long as its change of speed needs.
        let along = max(simd_dot(v0, dir), 0)
        func plan(_ vc: Double) -> (r1: Double, r3: Double, cruise: Double, d1: Double, d3: Double) {
            // The first ramp turns him onto the line as well as bringing him to speed: as long as the whole change of velocity needs.
            let change = simd_length(dir * vc - v0)
            let r1 = max(0.45, 1.875 * change / min(band.accel, band.lateral)), r3 = max(0.45, 1.875 * vc / band.decel)
            let d1 = (along + vc) / 2 * r1, d3 = vc / 2 * r3
            let cruise = max(d - d1 - d3, 0) / max(vc, 1e-6)
            return (r1, r3, cruise, d1, d3)
        }
        var lo = band.walk * 0.5, hi = band.sprint
        for _ in 0..<40 {
            let mid = (lo + hi) / 2, p = plan(mid)
            if p.r1 + p.cruise + p.r3 > T { lo = mid } else { hi = mid }
        }
        let vc = hi, p = plan(vc)
        // Too little room for a cruise at all (or the ramps overrun, or not even a sprint fits the time): one quintic,
        // which lands on time whatever it asks of him (the limits check is the caller's: `shortestTravel` finds the time).
        guard p.d1 + p.d3 < d, p.r1 + p.r3 < T, p.r1 + p.cruise + p.r3 <= T + 1e-6 else {
            return MotionPath(segments: [Quintic(t0: t0, duration: T, from: x0, v0, a0, to: x1, .zero, .zero)])
        }
        let slack = T - (p.r1 + p.cruise + p.r3)
        let cruise = p.cruise + max(slack, 0)
        let xa = x0 + dir * p.d1, xb = x1 - dir * p.d3
        let ta = t0 + p.r1, tb = ta + cruise
        let cruiseSpeed = cruise > 1e-6 ? simd_length(xb - xa) / cruise : vc
        let vCruise = dir * cruiseSpeed
        return MotionPath(segments: [
            Quintic(t0: t0, duration: p.r1, from: x0, v0, a0, to: xa, vCruise, .zero),
            Quintic(t0: ta, duration: max(cruise, 1e-3), from: xa, vCruise, .zero, to: xb, vCruise, .zero),
            Quintic(t0: tb, duration: p.r3, from: xb, vCruise, .zero, to: x1, .zero, .zero),
        ])
    }

    /// The least time a travel needs to stay inside the band (sampled at 60 Hz): a scan, then bisection.
    static func shortestTravel(from x0: SIMD2<Double>, _ v0: SIMD2<Double>, _ a0: SIMD2<Double>, to x1: SIMD2<Double>,
                               _ v1: SIMD2<Double> = .zero, _ a1: SIMD2<Double> = .zero, band: MotionLimits.Band, cruiseOver: Double,
                               within limit: Double = 30) -> Double {
        // Already faster than his sprint (a clip's own glide): the travel may begin at that speed, and only slow from it.
        var lenient = band
        lenient.sprint = max(band.sprint, simd_length(v0) * 1.0001)
        func fits(_ T: Double) -> Bool {
            let path = travel(from: x0, v0, a0, at: 0, to: x1, v1, a1, duration: T, band: band, cruiseOver: cruiseOver)
            return violations(path, from: 0, to: T, band: lenient).isEmpty
        }
        let d = simd_length(x1 - x0)
        if d < 1e-6, simd_length(v0) < 1e-6, simd_length(a0) < 1e-6 { return 0 }
        var lo = 0.0, hi = max(0.25, shortest(distance: d, band: band) * 0.8)
        while !fits(hi) {
            lo = hi
            hi *= 1.3
            if hi > limit { return limit }
        }
        for _ in 0..<14 {
            let mid = (lo + hi) / 2
            if fits(mid) { hi = mid } else { lo = mid }
        }
        return hi
    }

    // MARK: Limits

    struct Violation: Equatable, Sendable {
        enum Kind: Equatable, Sendable { case speed, accel, decel, lateral }
        var kind: Kind
        var at: PTime
        /// How far over the limit (a share: 0.1 is 10% over).
        var over: Double
    }

    /// Where a path breaks the band, sampled every 1/60 s (§5.5.4).
    static func violations(_ path: MotionPath, from t0: PTime, to t1: PTime, band: MotionLimits.Band) -> [Violation] {
        var out: [Violation] = []
        var t = t0
        let dt = 1 / TheaterTiming.rate
        while t <= t1 + 1e-9 {
            let v = path.velocity(at: t), a = path.acceleration(at: t)
            let speed = simd_length(v)
            if speed > band.sprint * 1.0001 { out.append(Violation(kind: .speed, at: t, over: speed / band.sprint - 1)) }
            if speed > 0.25 {
                let dir = v / speed
                let along = simd_dot(a, dir), across = simd_length(a - along * dir)
                if along > band.accel * 1.0001 { out.append(Violation(kind: .accel, at: t, over: along / band.accel - 1)) }
                if -along > band.decel * 1.0001 { out.append(Violation(kind: .decel, at: t, over: -along / band.decel - 1)) }
                if across > band.lateral * 1.0001 { out.append(Violation(kind: .lateral, at: t, over: across / band.lateral - 1)) }
            } else if simd_length(a) > max(band.accel, band.decel) * 1.0001 {
                out.append(Violation(kind: .accel, at: t, over: simd_length(a) / max(band.accel, band.decel) - 1))
            }
            t += dt
        }
        return out
    }

    // MARK: Collisions (§5.5.5)

    /// Two men who'd overlap: who, when they're closest, and how close.
    struct Overlap: Equatable, Sendable {
        var a: Int
        var b: Int
        var at: PTime
        var distance: Double
    }

    /// Overlaps between paths (sampled at 20 Hz) lasting longer than 0.1 s, closer than two radii; `contacts`
    /// pairs (a screen, a box-out) are allowed to `1.2 ×` the radius.
    static func overlaps(_ paths: [MotionPath], from t0: PTime, to t1: PTime, radius: Double, contacts: Set<[Int]> = []) -> [Overlap] {
        var out: [Overlap] = []
        guard paths.count > 1 else { return out }
        let dt = 0.05
        for i in 0..<paths.count {
            for j in (i + 1)..<paths.count {
                let least = contacts.contains([i, j]) ? 1.2 * radius : 2 * radius
                var run = 0.0, closest = Double.infinity, when = t0
                var t = t0
                while t <= t1 + 1e-9 {
                    let d = simd_length(paths[i].position(at: t) - paths[j].position(at: t))
                    if d < least {
                        run += dt
                        if d < closest { closest = d; when = t }
                    } else {
                        if run > 0.1 { out.append(Overlap(a: i, b: j, at: when, distance: closest)) }
                        run = 0
                        closest = .infinity
                    }
                    t += dt
                }
                if run > 0.1 { out.append(Overlap(a: i, b: j, at: when, distance: closest)) }
            }
        }
        return out
    }

    /// The collision pass: the lower-priority man of each overlapping pair
    /// steps round the other (a detour key at the closest approach, `2.2 ×`
    /// the radius off his line), his path re-made from his keys; three passes
    /// at most. `priority`: higher keeps his line. Returns the keys and what's left over.
    static func separate(_ keys: [[MotionKey]], bands: [MotionLimits.Band], priority: [Int], from t0: PTime, to t1: PTime, radius: Double,
                         contacts: Set<[Int]> = []) -> (keys: [[MotionKey]], residual: [Overlap]) {
        var keys = keys
        var paths = zip(keys, bands).map { path($0, band: $1) }
        var left: [Overlap] = []
        for _ in 0..<3 {
            left = overlaps(paths, from: t0, to: t1, radius: radius, contacts: contacts)
            guard !left.isEmpty else { break }
            var moved = Set<Int>()
            for o in left {
                let (mover, other) = priority[o.a] < priority[o.b] ? (o.a, o.b) : (o.b, o.a)
                guard !moved.contains(mover), keys[mover].count >= 2 else { continue }
                // Off his line at the closest approach, away from the other man.
                let here = paths[mover].position(at: o.at), there = paths[other].position(at: o.at)
                let heading = paths[mover].velocity(at: o.at)
                var side = SIMD2(-heading.y, heading.x)
                if simd_length(side) < 1e-6 { side = here - there }
                if simd_length(side) < 1e-6 { side = SIMD2(1, 0) }
                side = simd_normalize(side)
                if simd_dot(side, here - there) < 0 { side = -side }
                let detour = MotionKey(t: o.at, at: here + side * 2.2 * radius, kind: .through, hard: false)
                // Never in place of a hard key, and only between two of his keys.
                guard let k = keys[mover].firstIndex(where: { $0.t > o.at }), k > 0,
                      !keys[mover].contains(where: { $0.hard && abs($0.t - o.at) < 0.15 }) else { continue }
                keys[mover].insert(detour, at: k)
                paths[mover] = path(keys[mover], band: bands[mover])
                moved.insert(mover)
            }
            if moved.isEmpty { break }
        }
        return (keys, left)
    }
}
