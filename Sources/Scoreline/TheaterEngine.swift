import Foundation
import simd

// The game as one broadcast, part 7: the choreography engine's shared types
// (CHOREOGRAPHY.md §4, §10).
//
// The theaters stop owning time. Each known play's decisive moment (the ball
// through the net, the catch, the pitch crossing the plate) gets an anchor on
// the presentation clock's p (TheaterAnchors.swift); a plan places what
// happens around the anchors from the world as it stands on screen; the plan
// is baked once into dense tracks (TheaterMotion.swift, TheaterCamera.swift);
// and a frame only samples the tracks at p (TheaterPlanChain.swift). New
// data never cuts the picture: it splices a new plan in from a commit point,
// starting exactly from the old plan's state there (positions, velocities,
// the stride, the camera with its velocity), the way an interruptible
// animation retargets from its presentation value.
//
// Everything here is a pure value: no SwiftUI, no clock, no globals, so the
// same code runs off the main actor and ports line for line to the web.

/// One figure on the field for the whole session (CHOREOGRAPHY §5.3).
struct ActorID: Hashable, Comparable, Sendable, CustomStringConvertible {
    let raw: UInt16
    init(_ raw: UInt16) { self.raw = raw }
    static func < (a: Self, b: Self) -> Bool { a.raw < b.raw }
    var description: String { "#\(raw)" }
}

/// Where a beat comes from: a play the feed logged, a rule that inferred it
/// from known plays, or filler that changes nothing the data says.
enum Provenance: Hashable, Sendable {
    case known(play: String)
    case inferred(rule: String, from: [String])
    case ambient
}

/// Where a known play's decisive moment lands on p.
struct PlayAnchor: Equatable, Sendable {
    var at: PTime
    /// Where it may slide (a point for a hard anchor).
    var window: ClosedRange<PTime>
    var hard: Bool
    /// A declared catch-up: how much later than the data puts it the moment
    /// is told (0: on time). Up to `TheaterTiming.microCatchUp` it's quiet; past it, "CATCHING UP".
    var slip: Double = 0

    init(at: PTime, window: ClosedRange<PTime>? = nil, hard: Bool = true, slip: Double = 0) {
        self.at = at
        self.window = window ?? at...at
        self.hard = hard
        self.slip = slip
    }
}

/// The engine's timing rules that aren't per sport (CHOREOGRAPHY §4.5–§4.6; tune).
enum TheaterTiming {
    /// The commit point's lead over now: the bake runs off the main actor in it.
    static let commitLead = 0.25
    /// A late play's decisive moment may slip this much, quietly (a declared micro catch-up).
    static let microCatchUp = 1.5
    /// Plans wholly before p less this are dropped from the chain.
    static let keepBehind = 2.0
    /// Baked tracks' rate.
    static let rate = 60.0
    /// The receding horizon (§4.5, §8.1): a plan places the plays whose moments fall this far past its splice and
    /// bakes about as far; the plan before its horizon runs out reaches the rest.
    static let planAhead = 30.0
}

// MARK: - Motion limits

/// How fast, how hard and how sharply a figure may move (CHOREOGRAPHY §5.5.2),
/// in the field's units and p-seconds; by role.
struct MotionLimits: Equatable, Sendable {
    struct Band: Equatable, Sendable {
        var walk, jog, run, sprint: Double
        /// Over the sprint cap by this share, for at most `overspeedFor` seconds (logged).
        var overspeed: Double
        var overspeedFor: Double
        var accel, decel, lateral: Double
    }

    var bands: [String: Band]
    /// The body's radius for collisions.
    var bodyRadius: Double
    /// A rest-to-rest move longer than this cruises (ramp, cruise, ramp) instead of one easing.
    var cruiseOver: Double
    /// The fallback band for a role the table doesn't name.
    var standard: String

    func band(_ role: String) -> Band { bands[role] ?? bands[standard]! }

    /// The fastest anyone may go at all (the hard-cut threshold's scale).
    var fastest: Double { bands.values.map { $0.sprint * (1 + $0.overspeed) }.max() ?? 0 }

    // The tables (all tune; drawn heights read ~20% faster on screen than court feet).

    static let basketball = MotionLimits(bands: [
        "guard": Band(walk: 4.5, jog: 10, run: 16, sprint: 25, overspeed: 0.12, overspeedFor: 0.6, accel: 20, decel: 26, lateral: 18),
        "wing": Band(walk: 4.5, jog: 10, run: 16, sprint: 25, overspeed: 0.12, overspeedFor: 0.6, accel: 20, decel: 26, lateral: 18),
        "big": Band(walk: 4.5, jog: 10, run: 16, sprint: 22, overspeed: 0.12, overspeedFor: 0.6, accel: 20, decel: 26, lateral: 18),
        "official": Band(walk: 4.5, jog: 10, run: 16, sprint: 22, overspeed: 0.12, overspeedFor: 0.6, accel: 20, decel: 26, lateral: 18),
    ], bodyRadius: 1.0, cruiseOver: 12, standard: "wing")

    static let football = MotionLimits(bands: [
        "skill": Band(walk: 4.5, jog: 10, run: 20, sprint: 32, overspeed: 0.10, overspeedFor: 0.8, accel: 22, decel: 28, lateral: 20),
        "line": Band(walk: 4.5, jog: 10, run: 20, sprint: 24, overspeed: 0.10, overspeedFor: 0.8, accel: 22, decel: 28, lateral: 20),
        "official": Band(walk: 4.5, jog: 10, run: 20, sprint: 24, overspeed: 0.10, overspeedFor: 0.8, accel: 22, decel: 28, lateral: 20),
    ], bodyRadius: 1.0, cruiseOver: 20, standard: "skill")

    static let soccer = MotionLimits(bands: [
        "outfield": Band(walk: 1.4, jog: 3.5, run: 6.0, sprint: 9.0, overspeed: 0.10, overspeedFor: 0.8, accel: 6.0, decel: 7.5, lateral: 5.5),
        "keeper": Band(walk: 1.4, jog: 3.5, run: 6.0, sprint: 7.5, overspeed: 0.10, overspeedFor: 0.8, accel: 6.0, decel: 7.5, lateral: 5.5),
        "official": Band(walk: 1.4, jog: 3.5, run: 6.0, sprint: 7.5, overspeed: 0.10, overspeedFor: 0.8, accel: 6.0, decel: 7.5, lateral: 5.5),
    ], bodyRadius: 0.35, cruiseOver: 6, standard: "outfield")

    /// Baseball keeps today's approved compressed play pace (§11.4): its limits scale by the pace factor.
    static func baseball(pace: Double = 1) -> MotionLimits {
        func scaled(_ b: Band) -> Band {
            Band(walk: b.walk * pace, jog: b.jog * pace, run: b.run * pace, sprint: b.sprint * pace, overspeed: b.overspeed,
                 overspeedFor: b.overspeedFor, accel: b.accel * pace * pace, decel: b.decel * pace * pace, lateral: b.lateral * pace * pace)
        }
        return MotionLimits(bands: [
            "runner": scaled(Band(walk: 4.5, jog: 10, run: 20, sprint: 28, overspeed: 0, overspeedFor: 0, accel: 20, decel: 24, lateral: 16)),
            "fielder": scaled(Band(walk: 4.5, jog: 10, run: 20, sprint: 27, overspeed: 0, overspeedFor: 0, accel: 20, decel: 24, lateral: 16)),
            "official": scaled(Band(walk: 4.5, jog: 10, run: 20, sprint: 27, overspeed: 0, overspeedFor: 0, accel: 20, decel: 24, lateral: 16)),
        ], bodyRadius: 1.0, cruiseOver: 20, standard: "fielder")
    }
}

// MARK: - Keys, overlays, cues

/// A keyframe for one figure (CHOREOGRAPHY §5.5.1). Hard keys come from the
/// splice and from anchors; soft keys from tactics, and may slide in their window.
struct MotionKey: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        /// Through, at whatever speed the neighbors give.
        case through
        /// Arriving at rest.
        case arrive
        /// Leaving from rest.
        case depart
        /// Meeting another figure (a screen, a tackle, a tag): C² waived here.
        case contact(ActorID)
    }

    var t: PTime
    var at: SIMD2<Double>
    var kind: Kind
    var velocity: SIMD2<Double>? = nil
    var acceleration: SIMD2<Double>? = nil
    var window: ClosedRange<PTime>? = nil
    var radius: Double = 0
    var hard: Bool
}

/// A timed presentation event (CHOREOGRAPHY §5.6.5): the stamp, a banner, a
/// flash, the net, the status tag, a celebration, the score changing.
struct Cue: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case stamp(String)
        case banner(String, tone: UInt8, confetti: Bool)
        case flash(UInt8, SIMD3<Double>)
        case net(strength: Double)
        case status(String?)
        case celebrate(String)
        /// The scoring play's decisive moment: the score changes, the slide lands (BROADCAST §3).
        case scored(String)
        case replayIn
        case replayOut
    }

    var at: PTime
    var until: PTime
    var kind: Kind
    var source: Provenance
}

/// What the bench reports about a plan: catch-ups, overspeeds, slips.
struct PlanNote: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        /// A decisive moment told later than its anchor (seconds), and whether it's past the quiet micro catch-up.
        case catchUp(play: String, late: Double)
        /// A figure over his sprint cap (the share over), for how long.
        case overspeed(ActorID, over: Double, seconds: Double)
        /// A transition that couldn't fit its window and took longer.
        case stretched(ActorID, seconds: Double)
        /// Two figures still overlapping after the collision pass.
        case overlap(ActorID, ActorID)
    }

    var at: PTime
    var kind: Kind
}

// MARK: - World state (the splice source)

/// The ball as the splice carries it: where, how fast, and in whose hands.
struct BallState: Equatable, Sendable {
    var position: SIMD3<Double>
    var velocity: SIMD3<Double> = .zero
    var holder: ActorID?
}

/// The camera as one operator for the session (CHOREOGRAPHY §5.6.1): the
/// ground point at the view's center, the span (field units top to bottom,
/// kept in log space so zooms feel even), the yaw, and their velocities.
struct CameraState: Equatable, Sendable {
    /// x, y of the center on the ground (world frame), log of the span, yaw (radians).
    var value: SIMD4<Double>
    var velocity: SIMD4<Double> = .zero

    var center: SIMD2<Double> { SIMD2(value.x, value.y) }
    var span: Double { exp(value.z) }
    var yaw: Double { value.w }

    init(center: SIMD2<Double>, span: Double, yaw: Double, velocity: SIMD4<Double> = .zero) {
        value = SIMD4(center.x, center.y, log(max(span, 1e-6)), yaw)
        self.velocity = velocity
    }

    init(value: SIMD4<Double>, velocity: SIMD4<Double> = .zero) {
        self.value = value
        self.velocity = velocity
    }
}

/// One figure as the splice carries him.
struct ActorState: Equatable, Sendable {
    var id: ActorID
    var position: SIMD2<Double>
    var velocity: SIMD2<Double>
    var acceleration: SIMD2<Double>
    var rig: RigTrack.Carry
    var opacity: Double
}

/// Everything on screen at one p, exactly: what a new plan starts from.
struct WorldState: Equatable, Sendable {
    var at: PTime
    /// Sorted by id.
    var actors: [ActorState]
    var ball: BallState?
    var camera: CameraState
    /// Live at `at`.
    var cues: [Cue] = []

    func actor(_ id: ActorID) -> ActorState? {
        var lo = 0, hi = actors.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if actors[mid].id < id { lo = mid + 1 } else { hi = mid }
        }
        return lo < actors.count && actors[lo].id == id ? actors[lo] : nil
    }
}

// MARK: - Curves and hashing (pure, portable)

enum TheaterCurve {
    /// A CSS cubic-bezier easing (x1, y1, x2, y2) at u in 0…1: x solved by Newton's method, then y.
    static func bezier(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double, _ u: Double) -> Double {
        let u = min(max(u, 0), 1)
        if u == 0 || u == 1 { return u }
        func coordinate(_ s: Double, _ a: Double, _ b: Double) -> Double {
            let k = 1 - s
            return 3 * k * k * s * a + 3 * k * s * s * b + s * s * s
        }
        func slope(_ s: Double, _ a: Double, _ b: Double) -> Double {
            let k = 1 - s
            return 3 * k * k * a + 6 * k * s * (b - a) + 3 * s * s * (1 - b)
        }
        var s = u
        for _ in 0..<8 {
            let dx = coordinate(s, x1, x2) - u
            if abs(dx) < 1e-7 { break }
            let d = slope(s, x1, x2)
            if abs(d) < 1e-6 { break }
            s = min(max(s - dx / d, 0), 1)
        }
        // A few bisection steps settle any case Newton's left close.
        var lo = 0.0, hi = 1.0
        for _ in 0..<20 where abs(coordinate(s, x1, x2) - u) > 1e-7 {
            s = (lo + hi) / 2
            if coordinate(s, x1, x2) < u { lo = s } else { hi = s }
        }
        return coordinate(s, y1, y2)
    }

    /// On-screen movement eases in and out: the house curve, cubic-bezier(0.77, 0, 0.175, 1).
    static func inOut(_ u: Double) -> Double { bezier(0.77, 0, 0.175, 1, u) }

    /// Entrances ease out: cubic-bezier(0.23, 1, 0.32, 1).
    static func out(_ u: Double) -> Double { bezier(0.23, 1, 0.32, 1, u) }
}

enum TheaterHash {
    /// FNV-1a of a string: stable across runs and platforms (Swift's Hasher is seeded per process).
    static func of(_ text: String) -> UInt64 {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in text.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01b3
        }
        return hash
    }

    /// Mixes a value into a running FNV-1a hash (the bench's determinism check).
    static func mix(_ hash: inout UInt64, _ bits: UInt64) {
        for k in 0..<8 {
            hash ^= (bits >> (8 * UInt64(k))) & 0xff
            hash = hash &* 0x0000_0100_0000_01b3
        }
    }
}
