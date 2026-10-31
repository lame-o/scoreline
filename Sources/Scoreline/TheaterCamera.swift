import Foundation
import simd

// The game as one broadcast, part 10: the camera operator (CHOREOGRAPHY §5.6).
//
// One camera for the whole session: the ground point at the view's center,
// the span (in log space, so zooms feel even), and the yaw, with their
// velocities. It's integrated at 60 Hz toward each moment's goal and carried
// across every splice, so a new goal never restarts it: the state keeps its
// velocity and bends toward the new target, Apple's interruptible-animation
// rule. Every axis is critically damped (a camera isn't a thrown object: no
// overshoot, ever): pan and zoom at ω = 7 with today's caps (1.4 view
// heights a second across; ×3 a second in, ×9 out), the yaw at ω = 3.6,
// capped at 45° a second.
//
// It tracks a moving goal without lag: the goal's own velocity is fed forward,
// so the error alone is what decays (critically, from wherever a retarget
// left it), and inside one clip the camera is that clip's own operator's work.
//
// The yaw is a camera parameter now, never a script's frame: basketball's
// follows the ball's end of the floor (§5.6.3), with hysteresis and a dwell,
// so a change of possession is a broadcast pan, not a 60° snap under a crossfade.

struct CameraOperator: Sendable {
    struct Tuning: Equatable, Sendable {
        var pan = 7.0
        var zoom = 7.0
        var yaw = 3.6
        /// View heights a second across the view.
        var panCap = 1.4
        /// Log-span units a second: in (narrowing) and out.
        var zoomIn = 1.1
        var zoomOut = 2.2
        /// Radians a second.
        var yawCap = 45.0 * .pi / 180
        /// The dimetric view squashes the ground's depth: up the view is half the ground's.
        var depth = 0.5
    }

    var tuning = Tuning()
    var state: CameraState

    init(_ state: CameraState, tuning: Tuning = Tuning()) {
        self.state = state
        self.tuning = tuning
    }

    /// One step of `dt` toward `goal` (x, y, log span, yaw) moving at `goalVelocity`.
    mutating func step(toward goal: SIMD4<Double>, moving goalVelocity: SIMD4<Double>, dt: Double) {
        var x = state.value, v = state.velocity
        var e = x - goal
        e.w = remainder(e.w, 2 * .pi)
        let ev = v - goalVelocity
        let w = SIMD4(tuning.pan, tuning.pan, tuning.zoom, tuning.yaw)
        // Semi-implicit Euler (stable and smooth at ω·dt ≈ 0.12).
        v += (-(w * w) * e - 2 * w * ev) * dt
        // The caps: across the view in view heights, the zoom's in and out, the yaw's.
        let yaw = x.w, span = exp(x.z)
        let across = v.x * cos(yaw) + v.y * sin(yaw), up = (-v.x * sin(yaw) + v.y * cos(yaw)) * tuning.depth
        let speed = (across * across + up * up).squareRoot(), reach = tuning.panCap * span
        if speed > reach {
            v.x *= reach / speed
            v.y *= reach / speed
        }
        v.z = min(max(v.z, -tuning.zoomIn), tuning.zoomOut)
        v.w = min(max(v.w, -tuning.yawCap), tuning.yawCap)
        x += v * dt
        x.w = remainder(x.w, 2 * .pi)
        state = CameraState(value: x, velocity: v)
    }

    /// The camera from `state` at `t0` through `t1`, every 1/60 s, toward
    /// `goal(t)`: the samples (the first is the state itself) and the state at the end.
    static func bake(from state: CameraState, at t0: PTime, through t1: PTime, tuning: Tuning = Tuning(),
                     goal: (PTime) -> SIMD4<Double>) -> (samples: ContiguousArray<SIMD4<Float>>, end: CameraState) {
        let dt = 1 / TheaterTiming.rate
        let n = max(Int(((t1 - t0) * TheaterTiming.rate).rounded(.up)), 0)
        var op = CameraOperator(state, tuning: tuning)
        var samples = ContiguousArray<SIMD4<Float>>()
        samples.reserveCapacity(n + 1)
        samples.append(SIMD4<Float>(op.state.value))
        var previous = goal(t0)
        for i in 1...max(n, 1) where n > 0 {
            let t = t0 + Double(i) * dt
            let g = goal(t)
            var gv = (g - previous) / dt
            gv.w = remainder(g.w - previous.w, 2 * .pi) / dt
            // A goal that cuts (a script's own cut) isn't a velocity to follow: the error takes it.
            if abs(gv.x) + abs(gv.y) > 400 || abs(gv.z) > 20 || abs(gv.w) > 20 { gv = .zero }
            op.step(toward: g, moving: gv, dt: dt)
            samples.append(SIMD4<Float>(op.state.value))
            previous = g
        }
        return (samples, op.state)
    }
}

/// Which way the camera looks along the floor: basketball's follows the
/// ball's end (§5.6.3). Beyond `band` of half court toward a basket, the
/// yaw is that basket's; inside the band it holds (hysteresis), and it
/// changes at most once every `dwell` seconds.
struct YawRule: Equatable, Sendable {
    var middle: Double
    var band: Double
    var dwell: Double
    /// The yaw toward the higher-x end, and toward the lower.
    var high: Double
    var low: Double

    static let basketball = YawRule(middle: Hoops.length / 2, band: 6, dwell: 2, high: HoopsWorld.yaw(right: true),
                                    low: HoopsWorld.yaw(right: false))

    /// The yaw targets over a sampled ball track (`ball(t)`: its x, nil while unknown), from `yaw` at `t0`:
    /// each change of end and when it happened.
    func targets(from yaw: Double, since changed: PTime, at t0: PTime, through t1: PTime, step: Double = 1 / TheaterTiming.rate,
                 ball: (PTime) -> Double?) -> [(at: PTime, yaw: Double)] {
        var out: [(at: PTime, yaw: Double)] = [(t0, yaw)]
        var current = yaw, last = changed
        var t = t0
        while t <= t1 + 1e-9 {
            if let x = ball(t), t - last >= dwell {
                let wanted = x > middle + band ? high : x < middle - band ? low : current
                if abs(remainder(wanted - current, 2 * .pi)) > 1e-6 {
                    current = wanted
                    last = t
                    out.append((t, wanted))
                }
            }
            t += step
        }
        return out
    }

    /// The target in force at `t` from a list of changes.
    static func target(_ changes: [(at: PTime, yaw: Double)], at t: PTime) -> Double {
        var lo = 0, hi = changes.count - 1
        guard hi >= 0 else { return 0 }
        if t < changes[0].at { return changes[0].yaw }
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if changes[mid].at <= t { lo = mid } else { hi = mid - 1 }
        }
        return changes[lo].yaw
    }
}
