import Foundation
import simd

// The game as one broadcast, part 11: clips and the splice (CHOREOGRAPHY §4.5,
// §12 Phase 0; BROADCAST §4's "generalized bridge").
//
// Phase 0 keeps today's per-play scripts (a replay, a beat, the field between
// plays) and changes who owns time. Each script is a clip: its figures' paths
// in the world, its ball, its camera, its decisive moment. The engine places
// each clip so its decisive moment lands on its play's anchor, and every
// hand-off from one clip to the next is a splice: from the world exactly as
// it stands (each man's position, velocity and acceleration, his stride, the
// ball, the camera with its velocity), each man travels to where the next
// clip wants him within his limits, the ball goes with whoever has it (or is
// passed on, inferred), and the camera bends toward the new framing. A replay
// that follows another play no longer cuts to its own set: the men run there.
// If the time isn't there, the clip runs a little later (a declared catch-up,
// quiet up to 1.5 s); nobody outruns his limits and nothing jumps.
//
// Pure values, no SwiftUI: a sport supplies its clips (BasketballClips.swift…).

/// A clip figure as the splice matches him to the world's men.
struct ClipFigure: Equatable, Sendable {
    /// Whose: a team (0 top, 1 bottom) or the officials and staff (2): never matched across.
    var group: Int
    /// What: his role (matched before distance).
    var kind: String = ""
    /// Who: the data's athlete, when it names him (matched before anything).
    var athlete: String? = nil
    /// His motion band (MotionLimits).
    var band: String
    /// The rig's height (field units).
    var height: Double
}

/// The ball in a clip at an instant (world frame).
enum ClipBall: Equatable, Sendable {
    /// In a figure's hands (or on his dribble).
    case held(figure: Int)
    /// Anywhere else: in the air, bouncing, on the floor.
    case free(SIMD3<Double>, flying: Bool)
}

/// One of today's scripts as the engine places it.
protocol TheaterClip: Sendable {
    /// Its length in its own seconds (it holds its last moment after).
    var length: Double { get }
    /// Its still moment: nothing moves before it, so a splice lands everyone by then.
    var still: Double { get }
    /// Its decisive moment, if it has one (a beat's whistle, a replay's make).
    var decisive: Double? { get }
    /// Once begun, it plays at least this far before anything may splice out of it (its decisive moment and what must follow it).
    var essential: Double { get }
    /// Ambient (the field between plays): it may be spliced out of anywhere but mid-flight.
    var ambient: Bool { get }
    var figures: [ClipFigure] { get }
    func position(_ figure: Int, at t: Double) -> SIMD2<Double>
    func heading(_ figure: Int, at t: Double) -> Double
    func opacity(_ figure: Int, at t: Double) -> Double
    func ball(at t: Double) -> ClipBall?
    /// The camera it wants: ground center, log span, yaw (world).
    func camera(at t: Double) -> SIMD4<Double>
    /// Whether anything moves at t (frame tiers).
    func moving(at t: Double) -> Bool
}

extension TheaterClip {
    func velocity(_ figure: Int, at t: Double) -> SIMD2<Double> {
        let h = 1 / 240.0
        return (position(figure, at: t + h) - position(figure, at: t - h)) / (2 * h)
    }

    func acceleration(_ figure: Int, at t: Double) -> SIMD2<Double> {
        let h = 1 / 120.0
        return (position(figure, at: t + h) - 2 * position(figure, at: t) + position(figure, at: t - h)) / (h * h)
    }

    /// Whether the ball is in the air at t (no splice out of it then).
    func flying(at t: Double) -> Bool {
        if case .free(_, let flying)? = ball(at: t) { return flying }
        return false
    }
}

/// A ball passed or tossed between clips (inferred: the inbound, the outlet, the ball to the man who has it next).
struct BallFlight: Equatable, Sendable {
    var t0: PTime
    var t1: PTime
    var from: SIMD3<Double>
    var to: SIMD3<Double>
    /// How far above the straight line it rises at the middle.
    var apex: Double

    func point(at t: PTime) -> SIMD3<Double> {
        let u = min(max((t - t0) / max(t1 - t0, 1e-6), 0), 1)
        var p = from + (to - from) * u
        p.z += 4 * apex * u * (1 - u)
        return p
    }
}

/// One clip on p: where its time starts, who plays whom, and how the world got to it.
struct ClipPlacement<Clip: TheaterClip>: Sendable {
    var clip: Clip
    /// p of the clip's time 0.
    var offset: PTime
    /// When it takes over: the splice (the travel to it begins here).
    var start: PTime
    /// Each clip figure's man.
    var cast: [ActorID]
    /// Each traveling man's path from the splice to his place in the clip, and when he's on it.
    var travel: [ActorID: MotionPath] = [:]
    var join: [ActorID: PTime] = [:]
    /// Men the clip has no part for: they fade where they stand over the travel.
    var leaving: [ActorID] = []
    /// The ball, from the splice until the clip has it.
    var ball: BallFlight?
    /// Who has the ball at the splice and until the flight (or the clip) takes it.
    var holder: ActorID?
    /// The play it tells (nil: the field between plays), its anchor (on p) and how late it was told.
    var play: String?
    var anchor: PTime?
    var slip = 0.0
    /// The theater's time less p when it was placed: its decisive moment is at `anchor + shift + slip` on the chain.
    var shift = 0.0
    /// Every play its telling covers (its own, a miss's rebound, a replay's retold lead-in).
    var covers: [String] = []

    func time(_ p: PTime) -> Double { p - offset }
    func figure(of actor: ActorID) -> Int? { cast.firstIndex(of: actor) }
    /// When the clip has everyone (the last join).
    var joined: PTime { join.values.max() ?? start }
    /// The earliest a following splice may begin: its essential part done, and never mid-flight.
    func essentialEnd(after p: PTime) -> PTime {
        var at = max(offset + clip.essential, joined, p)
        var guardSteps = 0
        while clip.flying(at: at - offset), guardSteps < 600 {
            at += 1 / TheaterTiming.rate
            guardSteps += 1
        }
        return at
    }
}

// MARK: - Who becomes whom

enum CastMatch {
    /// A man (or a clip figure) as the match sees him.
    struct Figure: Equatable, Sendable {
        var group: Int
        var kind: String
        var athlete: String?
        var at: SIMD2<Double>
    }

    /// Clip figure → world man: the same athlete first, then the nearest of
    /// his group and kind, then the nearest of his group; a final pass swaps
    /// any two whose swap shortens their moves (TheaterBridge.match, by value).
    static func match(world: [Figure], clip: [Figure]) -> [Int: Int] {
        func cost(_ r: Int, _ i: Int) -> Double {
            let a = clip[r], b = world[i]
            if let x = a.athlete, let y = b.athlete, x == y { return -1 }
            var c = simd_length(a.at - b.at)
            if a.kind != b.kind { c += 1000 }
            if let x = a.athlete, let y = b.athlete, x != y { c += 500 }
            return c
        }
        var options: [(cost: Double, r: Int, i: Int)] = []
        for r in clip.indices {
            for i in world.indices where world[i].group == clip[r].group { options.append((cost(r, i), r, i)) }
        }
        options.sort { ($0.cost, $0.r, $0.i) < ($1.cost, $1.r, $1.i) }
        var pairs: [Int: Int] = [:], taken = Set<Int>()
        for o in options where pairs[o.r] == nil && !taken.contains(o.i) {
            pairs[o.r] = o.i
            taken.insert(o.i)
        }
        var keys = pairs.keys.sorted()
        for _ in 0..<3 {
            var swapped = false
            for (n, a) in keys.enumerated() {
                for b in keys[(n + 1)...] where clip[a].group == clip[b].group {
                    guard let ia = pairs[a], let ib = pairs[b] else { continue }
                    if cost(a, ib) + cost(b, ia) < cost(a, ia) + cost(b, ib) - 0.01 {
                        pairs[a] = ib
                        pairs[b] = ia
                        swapped = true
                    }
                }
            }
            if !swapped { break }
            keys = pairs.keys.sorted()
        }
        return pairs
    }
}

// MARK: - The splice

enum Splice {
    /// The world's men as the splice needs them: their state at an instant, who they are.
    struct Man: Equatable, Sendable {
        var state: ActorState
        var figure: ClipFigure
    }

    /// How the world meets a clip: who plays whom, when the travel begins,
    /// each man's path and when he's on the clip, and how much later than
    /// asked the clip has to run.
    struct Meeting: Sendable {
        var cast: [ActorID]
        var start: PTime
        var offset: PTime
        var travel: [ActorID: MotionPath]
        var join: [ActorID: PTime]
        var leaving: [ActorID]
        var slip: Double
        var newcomers: [ActorID]
    }

    /// Meets `clip`, asked to start its time at `offset`, from the world as
    /// `world(t)` has it from `earliest` on (the previous clip's essential
    /// end). Each matched man travels from his state at the splice to his
    /// place at the clip's still moment, as slowly as the time allows and no
    /// faster than his limits; the splice begins as late as everyone can
    /// still make it (the field between plays plays on until then). When
    /// not even `earliest` leaves enough time, the clip runs later by the
    /// difference (the slip). `cast`: who plays whom when the sport knows
    /// (a clip built from the world's own lineup); else matched.
    static func meet<Clip: TheaterClip>(_ clip: Clip, offset: PTime, earliest: PTime, limits: MotionLimits, cast known: [Int: ActorID]? = nil,
                                        nextID: inout UInt16, world: (PTime) -> [Man]) -> Meeting {
        // Who plays whom, from the world at the earliest splice.
        let men = world(earliest)
        var cast = [ActorID?](repeating: nil, count: clip.figures.count)
        if let known {
            for (i, id) in known where i < cast.count { cast[i] = id }
        } else {
            let start = max(offset + clip.still, earliest)
            let pairs = CastMatch.match(
                world: men.map { CastMatch.Figure(group: $0.figure.group, kind: $0.figure.kind, athlete: $0.figure.athlete, at: $0.state.position) },
                clip: clip.figures.indices.map { i in
                    CastMatch.Figure(group: clip.figures[i].group, kind: clip.figures[i].kind, athlete: clip.figures[i].athlete,
                                     at: clip.position(i, at: max(start - offset, 0)))
                })
            for (r, i) in pairs { cast[r] = men[i].state.id }
        }
        var newcomers: [ActorID] = []
        for i in cast.indices where cast[i] == nil {
            cast[i] = ActorID(nextID)
            newcomers.append(ActorID(nextID))
            nextID &+= 1
        }
        let castIDs = cast.map { $0! }
        let present = Set(castIDs)
        let leaving = men.map(\.state.id).filter { !present.contains($0) }
        // How long each man needs from a state to his place at the still moment: at an easy pace (a run, not
        // a sprint; gentler starts and stops) when there's room, at his limits when there isn't.
        func needs(_ men: [Man], easy: Bool) -> Double {
            var most = 0.0
            for (i, id) in castIDs.enumerated() {
                guard let man = men.first(where: { $0.state.id == id }), clip.opacity(i, at: clip.still) > 0.01 else { continue }
                let target = clip.position(i, at: clip.still)
                var band = limits.band(man.figure.band)
                if easy {
                    band.sprint = band.run
                    band.accel *= 0.6
                    band.decel *= 0.6
                    band.lateral *= 0.6
                }
                let need = TheaterMotion.shortestTravel(from: man.state.position, man.state.velocity, man.state.acceleration, to: target, band: band,
                                                 cruiseOver: limits.cruiseOver)
                most = max(most, need)
            }
            return most
        }
        var offset = offset
        var easy = true
        var start = max(earliest, offset + clip.still - needs(men, easy: true))
        // From the later splice the men may be elsewhere: measure again (twice settles it).
        for _ in 0..<2 where start > earliest + 1e-6 {
            start = max(earliest, offset + clip.still - needs(world(start), easy: true))
        }
        var atStart = world(start)
        if start + needs(atStart, easy: true) > offset + clip.still + 1e-6 {
            // No room for the easy pace: their limits, from as late as that allows.
            easy = false
            start = max(earliest, offset + clip.still - needs(men, easy: false))
            for _ in 0..<2 where start > earliest + 1e-6 {
                start = max(earliest, offset + clip.still - needs(world(start), easy: false))
            }
            atStart = world(start)
        }
        let need = needs(atStart, easy: easy)
        var slip = 0.0
        if start + need > offset + clip.still + 1e-6 {
            slip = start + need - (offset + clip.still)
            offset += slip
        }
        let joinAt = offset + clip.still
        var travel: [ActorID: MotionPath] = [:], join: [ActorID: PTime] = [:]
        for (i, id) in castIDs.enumerated() {
            guard let man = atStart.first(where: { $0.state.id == id }) else { continue }
            let target = clip.position(i, at: clip.still)
            let band = limits.band(man.figure.band)
            travel[id] = TheaterMotion.travel(from: man.state.position, man.state.velocity, man.state.acceleration, at: start, to: target,
                                       duration: max(joinAt - start, 1e-3), band: band, cruiseOver: limits.cruiseOver)
            join[id] = joinAt
        }
        return Meeting(cast: castIDs, start: start, offset: offset, travel: travel, join: join, leaving: leaving, slip: slip, newcomers: newcomers)
    }
}
