import Foundation
import simd

// The theater bench's continuity meter (CHOREOGRAPHY §9.2): what a theater
// presented, frame by frame at 60 Hz in the world frame (every figure, the
// ball, the camera), measured against the human limits and the rule that
// nothing jumps outside a declared jump. The same meter reads today's stages
// (TheaterBenchToday.swift) and the engine's plan chain, so the before and
// after numbers mean the same thing.

struct MeterFigure {
    /// The same man from frame to frame (an actor; for today's stages, matched across a swap of scripts).
    var key: Int
    var position: SIMD2<Double>
    var heading: Double
    var band: MotionLimits.Band
    /// His feet in the world (z: off the ground), and whether each is planted, with the gait's weight.
    var feet: (left: SIMD3<Double>, right: SIMD3<Double>)?
    var planted: (left: Bool, right: Bool) = (false, false)
    var weight = 0.0
    /// The rig's height (feet a figure stands): a slip's millimetres are on a 1.8 m man.
    var height = 1.0
    var opacity = 1.0
    /// What moves him now (a clip's kind, or a splice's travel): the report splits speed by it.
    var source = ""
    /// The rig's own planted feet in the world (the stride before any pose blends it), for the spec's footSlip.
    var rigFeet: (left: SIMD2<Double>, right: SIMD2<Double>)?
}

struct MeterFrame {
    enum Change: Equatable {
        /// The same world as the frame before.
        case same
        /// Another scene replaced it at once (a view identity change without a transition).
        case hardCut
        /// Another scene replaced it under a crossfade.
        case crossfade
        /// A declared jump (opening, waking, a Jmax catch-up).
        case declared
    }

    var t: Double
    var figures: [MeterFigure]
    /// x, y of the center on the ground, log span, yaw.
    var camera: SIMD4<Double>?
    var ball: SIMD3<Double>?
    var change: Change = .same
    /// Why the scene changed, for the report ("marquee after a beat", "rest round").
    var reason: String? = nil
}

struct ContinuityReport {
    var label = ""
    var frames = 0
    var seconds = 0.0
    var hardCuts = 0
    var hardCutReasons: [String: Int] = [:]
    var crossfades = 0
    var crossfadeReasons: [String: Int] = [:]
    /// The largest displacement hidden under a crossfade (field units).
    var hiddenTeleport = 0.0
    var teleportMax = 0.0
    var teleportMaxDistance = 0.0
    var actorSeconds = 0.0
    var overSpeedSeconds = 0.0
    var maxOverspeed = 0.0
    var overAccelSeconds = 0.0
    var overTurnSeconds = 0.0
    var movingSeconds = 0.0
    /// Planted feet sliding: the largest in millimetres on a 1.8 m man, and frames over 0.5 mm.
    var footSlipMax = 0.0
    var footSlipFrames = 0
    var footSlipAcrossChanges = 0.0
    var cameraPanMax = 0.0
    var cameraYawJumpMax = 0.0
    var yawSpeedMax = 0.0
    var cameraJumps = 0
    var decisiveErrors: [Double] = []
    var catchUps: [Double] = []
    var notes: [String] = []
    var overSpeedBySource: [String: Double] = [:]
    /// By cause: seconds more than 12% over the sprint, the worst overspeed, seconds over the push limits.
    var overSpeed12BySource: [String: Double] = [:]
    var maxOverspeedBySource: [String: Double] = [:]
    var overAccelBySource: [String: Double] = [:]
    var secondsBySource: [String: Double] = [:]
    /// The rig's own planted feet (§9.2's definition: the stride, before a pose blends it): max mm and frames over 0.5.
    var rigSlipMax = 0.0
    var rigSlipFrames = 0
    var jumpLog: [String] = []
    /// Frames where a man ran past 1.5× his cap for more than a frame (a superhuman glide, not a cut).
    var glideFrames = 0

    var speedShare: Double { actorSeconds > 0 ? overSpeedSeconds / actorSeconds : 0 }
    var accelShare: Double { actorSeconds > 0 ? overAccelSeconds / actorSeconds : 0 }
    var turnShare: Double { movingSeconds > 0 ? overTurnSeconds / movingSeconds : 0 }
}

/// Feeds frames in order; reads the report at the end.
struct ContinuityMeter {
    private(set) var report = ContinuityReport()
    private var previous: MeterFrame?
    private var before: MeterFrame?
    private var yawRate: Double?

    init(label: String) { report.label = label }

    mutating func add(_ frame: MeterFrame) {
        defer {
            before = previous
            previous = frame
        }
        report.frames += 1
        guard let prev = previous else { return }
        let dt = frame.t - prev.t
        guard dt > 1e-6 else { return }
        report.seconds += dt
        let byKey = Dictionary(prev.figures.map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a })
        let older = before.map { b in Dictionary(b.figures.map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a }) } ?? [:]
        // How far each man moved, against what a man can. A jump is a frame's move far past both the cap
        // and the man's own move the frame before (a discontinuity); a sustained superhuman run is a glide.
        var jump = 0.0, jumpDistance = 0.0
        for f in frame.figures where f.opacity > 0.05 {
            guard let p = byKey[f.key], p.opacity > 0.05 else { continue }
            let d = simd_length(f.position - p.position)
            let cap = f.band.sprint * (1 + f.band.overspeed)
            let ratio = d / max(cap * dt, 1e-9)
            let was = older[f.key].map { simd_length(p.position - $0.position) }
            if ratio > 1.5, frame.change == .same, let was, d < 2.5 * max(was, 1e-9) { report.glideFrames += 1 }
            let discontinuous = was.map { d > 2.5 * max($0, cap * dt * 0.25) } ?? true
            if discontinuous || frame.change != .same, ratio > jump { jump = ratio; jumpDistance = d }
            if ratio > report.teleportMax, frame.change == .same {
                report.teleportMax = ratio
                report.teleportMaxDistance = d
            }
            if ratio > 1.5, discontinuous, frame.change == .same, report.jumpLog.count < 40 {
                report.jumpLog.append(String(format: "t=%.2f key=%d d=%.2f from (%.1f,%.1f) to (%.1f,%.1f) %@", frame.t, f.key, d, p.position.x, p.position.y,
                                             f.position.x, f.position.y, frame.reason ?? ""))
            }
            if frame.change == .same {
                report.actorSeconds += dt
                report.secondsBySource[f.source, default: 0] += dt
                let v = d / dt
                if v > f.band.sprint * 1.001 {
                    report.overSpeedSeconds += dt
                    report.overSpeedBySource[f.source, default: 0] += dt
                    report.maxOverspeed = max(report.maxOverspeed, v / f.band.sprint - 1)
                    report.maxOverspeedBySource[f.source] = max(report.maxOverspeedBySource[f.source] ?? 0, v / f.band.sprint - 1)
                    if v > f.band.sprint * 1.12 { report.overSpeed12BySource[f.source, default: 0] += dt }
                }
                if let q = older[f.key], before?.change == .same || prev.change == .same {
                    let dt0 = prev.t - (before?.t ?? prev.t)
                    if dt0 > 1e-6 {
                        let v1 = (f.position - p.position) / dt, v0 = (p.position - q.position) / dt0
                        let a = (v1 - v0) / ((dt + dt0) / 2)
                        let speed = simd_length((v1 + v0) / 2)
                        if speed > 0.5 {
                            let dir = (v1 + v0) / 2 / speed
                            let along = simd_dot(a, dir)
                            let across = simd_length(a - along * dir)
                            if along > f.band.accel * 1.001 || -along > f.band.decel * 1.001 || across > f.band.lateral * 1.001 {
                                report.overAccelSeconds += dt
                                report.overAccelBySource[f.source, default: 0] += dt
                            }
                        } else if simd_length(a) > max(f.band.accel, f.band.decel) * 1.001 {
                            report.overAccelSeconds += dt
                            report.overAccelBySource[f.source, default: 0] += dt
                        }
                    }
                }
                // Turning: the rig's own cap (11 − 5·run rad/s, speed in heights a second), while faster than a jog.
                if v > f.band.jog {
                    report.movingSeconds += dt
                    let turn = abs(remainder(f.heading - p.heading, 2 * .pi)) / dt
                    let cap = 11 - 5 * RigGait.run(v / max(f.height, 1e-6))
                    if turn > cap * 1.05 { report.overTurnSeconds += dt }
                }
            }
            // The rig's own planted foot (the stride itself).
            if let a = f.rigFeet, let b = p.rigFeet, f.weight > 0.5, p.weight > 0.5 {
                for (now, was, down) in [(a.left, b.left, f.planted.left && p.planted.left), (a.right, b.right, f.planted.right && p.planted.right)] where down {
                    let slip = simd_length(now - was) / max(f.height, 1e-6) * 1800
                    report.rigSlipMax = max(report.rigSlipMax, slip)
                    if slip > 0.5 { report.rigSlipFrames += 1 }
                }
            }
            // A planted foot must stay where it was planted (as drawn, the pose's blends included).
            if let a = f.feet, let b = p.feet, f.weight > 0.5, p.weight > 0.5 {
                for (now, was, down) in [(a.left, b.left, f.planted.left && p.planted.left), (a.right, b.right, f.planted.right && p.planted.right)] where down {
                    let slip = simd_length(SIMD2(now.x - was.x, now.y - was.y)) / max(f.height, 1e-6) * 1800
                    report.footSlipMax = max(report.footSlipMax, slip)
                    if slip > 0.5 { report.footSlipFrames += 1 }
                    if frame.change != .same { report.footSlipAcrossChanges = max(report.footSlipAcrossChanges, slip) }
                }
            }
        }
        // The camera: a pan of more than 0.2 view heights, or 5° of yaw, in one frame is a cut.
        var cameraCut = false
        if let c = frame.camera, let p = prev.camera {
            let span = exp((c.z + p.z) / 2)
            let d = SIMD2(c.x - p.x, c.y - p.y)
            let yaw = c.w
            // Across the view (x) and up it (y halved by the dimetric view), in view heights.
            let across = d.x * cos(yaw) + d.y * sin(yaw), up = (-d.x * sin(yaw) + d.y * cos(yaw)) * 0.5
            let pan = (across * across + up * up).squareRoot() / span
            let zoom = abs(c.z - p.z)
            let yawStep = abs(remainder(c.w - p.w, 2 * .pi))
            let rate = yawStep / dt
            if frame.change == .same {
                report.cameraPanMax = max(report.cameraPanMax, pan)
                report.cameraYawJumpMax = max(report.cameraYawJumpMax, yawStep * 180 / .pi)
                report.yawSpeedMax = max(report.yawSpeedMax, rate * 180 / .pi)
            }
            yawRate = rate
            cameraCut = pan > 0.2 || yawStep > 5 * .pi / 180 || zoom > log(1.25)
            if cameraCut, frame.change == .same || frame.change == .hardCut { report.cameraJumps += 1 }
        }
        let figureCut = jump > 1.5
        switch frame.change {
        case .same:
            if figureCut || cameraCut {
                report.hardCuts += 1
                report.hardCutReasons[frame.reason ?? (figureCut ? "a figure jumped" : "the camera jumped"), default: 0] += 1
            }
        case .hardCut:
            if figureCut || cameraCut || frame.figures.count != prev.figures.count {
                report.hardCuts += 1
                report.hardCutReasons[frame.reason ?? "scene swap", default: 0] += 1
            }
        case .crossfade:
            report.crossfades += 1
            report.crossfadeReasons[frame.reason ?? "crossfade", default: 0] += 1
            report.hiddenTeleport = max(report.hiddenTeleport, jumpDistance)
        case .declared:
            break
        }
    }
}

extension ContinuityReport {
    func render(units: String) -> String {
        func f(_ x: Double, _ d: Int = 2) -> String { String(format: "%.\(d)f", x) }
        func reasons(_ r: [String: Int]) -> String {
            r.isEmpty ? "" : " (" + r.sorted { $0.value > $1.value }.map { "\($0.key) \($0.value)" }.joined(separator: ", ") + ")"
        }
        var lines = ["  \(label): \(frames) frames over \(f(seconds / 60, 1)) min"]
        lines.append("    hard cuts: \(hardCuts)\(reasons(hardCutReasons))")
        lines.append("    crossfades: \(crossfades)\(reasons(crossfadeReasons)); largest jump hidden under one: \(f(hiddenTeleport, 1)) \(units)")
        lines.append("    teleportMax (continuous frames): \(f(teleportMax)) × the cap (\(f(teleportMaxDistance, 2)) \(units) in a frame); glide frames past 1.5× the cap: \(glideFrames)")
        lines.append("    speed over the sprint cap: \(f(speedShare * 100))% of actor-seconds, max +\(f(maxOverspeed * 100, 0))%")
        lines.append("    accel over the limits: \(f(accelShare * 100))%; turning over the rig's cap: \(f(turnShare * 100))%")
        lines.append("    footSlip (the rig's planted foot): max \(f(rigSlipMax, 2)) mm-eq, \(rigSlipFrames) foot-frames over 0.5 mm")
        lines.append("    footSlip (as drawn): max \(f(footSlipMax, 1)) mm-eq, \(footSlipFrames) foot-frames over 0.5 mm; across scene changes \(f(footSlipAcrossChanges, 1)) mm-eq")
        if !secondsBySource.isEmpty {
            lines.append("    by what moves him (share of all actor-seconds over the sprint / over +12% / over the push limits; his own seconds; worst):")
            for (k, v) in secondsBySource.sorted(by: { ($0.value, $0.key) > ($1.value, $1.key) }) {
                let all = max(actorSeconds, 1e-9)
                lines.append("      \(k.isEmpty ? "?" : k): \(f((overSpeedBySource[k] ?? 0) / all * 100, 3))% / \(f((overSpeed12BySource[k] ?? 0) / all * 100, 3))% / "
                             + "\(f((overAccelBySource[k] ?? 0) / all * 100, 3))%; \(f(v / 60, 1)) actor-min; max +\(f((maxOverspeedBySource[k] ?? 0) * 100, 0))%")
            }
        }
        lines.append("    camera: max pan \(f(cameraPanMax, 3)) view-heights/frame, max yaw step \(f(cameraYawJumpMax, 2))°, max yaw speed \(f(yawSpeedMax, 1))°/s, jumps \(cameraJumps)")
        if !decisiveErrors.isEmpty {
            let abs = decisiveErrors.map { Swift.abs($0) }
            lines.append("    decisiveError (on time; catch-ups apart): n=\(abs.count) p50 \(f(Stats.quantile(abs, 0.5), 3)) s, p95 \(f(Stats.quantile(abs, 0.95), 3)) s, max \(f(abs.max() ?? 0, 3)) s")
        }
        if !catchUps.isEmpty {
            lines.append("    catch-ups: \(catchUps.count), p50 \(f(Stats.quantile(catchUps, 0.5))) s, max \(f(catchUps.max() ?? 0)) s")
        }
        for note in notes { lines.append("    " + note) }
        if ProcessInfo.processInfo.environment["THEATER_TRACE"] != nil { for j in jumpLog { lines.append("    jump " + j) } }
        return lines.joined(separator: "\n")
    }
}
