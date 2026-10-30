import SwiftUI

// The hand-off from the field between plays to a replay, the same way in all
// four theaters. ESPN posts a play 15–45 s after it happens, so it lands
// whenever it lands, often midway through one of the idle's beats (a huddle
// breaking, a man in motion, the half-court set swinging the ball, the ball
// going round, a runner stretching his lead). The replay still starts
// at once, but from wherever the figures are on screen: over a short bridge
// each one goes from his live idle spot and pose to his place in the play's
// opening formation, and the camera eases from the idle's framing to the
// replay's, on the strong ease-in-out the theaters' name glide uses (it's
// on-screen movement); then the replay runs as written. A figure in only one
// of the two scenes (a trainer out to a man hurt, a coach with his red flag)
// fades out or in over the bridge.
//
// The bridge runs inside the replay's own lead-in (the half second on the
// formation before the snap, the set before anyone moves) when it fits, so
// the action isn't delayed; only when it doesn't is the difference added in
// front, and the replay's clock starts that much later. An idle beat a moment
// from its natural end (0.3 s or less) finishes first. When the play starts
// far from where the idle stands (the idle has moved on to the next down's
// spot, or to the other end), men sprinting backwards would look wrong: a
// quick crossfade instead (0.25 s, ease-out) into the play's set formation.
// With Reduce Motion, always that crossfade, nothing travels.
//
// Replay to replay (a queue of plays back to back) is unchanged: this is the
// idle's hand-off alone. Pure values: a sport describes its two scenes'
// figures (`Figure`), the plan says how they meet, and each frame blends by
// the plan's weight at t.

enum TheaterBridge {
    /// The bridge's length: half a second for a short settle, up to 0.7 s
    /// for the longest one it takes.
    static let shortest = 0.5
    static let longest = 0.7
    /// The crossfade when the play starts far off (and with Reduce Motion).
    static let crossfade = 0.25
    /// An idle beat this close to its end plays out before the bridge.
    static let finishing = 0.3

    /// On-screen movement eases in and out: the name glide's curve,
    /// cubic-bezier(0.77, 0, 0.175, 1).
    static func ease(_ u: Double) -> Double { Celebrate.sweepCurve.value(at: min(max(u, 0), 1)) }

    /// A crossfade eases out (the house curve).
    static func fade(_ u: Double) -> Double { Motion.curve.value(at: min(max(u, 0), 1)) }

    /// The far rule, per sport: how far (the median of the men's moves, in
    /// the sport's own units) the idle can stand from the play's opening and
    /// still settle into it. Beyond it most of them would be sprinting
    /// there, backwards as often as not; the replay crossfades in.
    enum Far {
        /// Football, in feet: four yards. Lined up at the snap's spot, or
        /// still jogging to it from the huddle's break, everyone settles (a
        /// formation re-set moves a few men, not most); the next down's spot
        /// after a five-yard gain (fifteen feet for everyone), a huddle seven
        /// yards back, the other end, crossfade.
        static let football = 12.0
        /// Basketball, in feet: about three strides. A half-court set that
        /// has swung the ball round settles into the replay's set; a play at
        /// the other end (a break, the ball the other way) crossfades.
        static let basketball = 10.0
        /// Soccer, in metres: a sprint's ten metres a second over the
        /// longest bridge. The shape shifting with the ball settles; a move
        /// that starts away from where the ball was going round crossfades.
        static let soccer = 7.0
        /// Baseball, in feet: everyone's set between pitches and the idle's
        /// moves are a step (a lead, the catcher up, a practice swing); a man
        /// that far out of place means another field: crossfade.
        static let baseball = 8.0
    }

    /// A figure as the bridge matches it: whose he is (a team, the staff:
    /// never matched across), what he is (his slot or role: matched first),
    /// who (his athlete, when the data names him: matched before anything),
    /// and where he stands, in the replay's frame.
    struct Figure: Equatable {
        var group: Int
        var kind: String = ""
        var athlete: String? = nil
        var at: CGPoint
    }

    enum Mode: Equatable {
        /// Each man travels from his idle spot and pose to the replay's.
        case bridge
        /// The idle fades out over the replay's set formation.
        case crossfade
    }

    /// How the idle on screen meets a replay, from the moment the play came in.
    struct Plan: Equatable {
        var mode: Mode
        /// Replay figure → idle figure: the men who travel. The rest fade.
        var pairs: [Int: Int] = [:]
        /// The bridge's (or the crossfade's) length.
        var length: Double
        /// What the bridge didn't fit in the replay's own lead-in: its clock
        /// starts this much later.
        var lead = 0.0
        /// The idle beat's last moment, played out first.
        var wait = 0.0
        /// How far the men travel (the median), in the sport's units.
        var moved = 0.0

        /// The replay's clock `s` seconds after the play came in.
        func replayTime(_ s: Double) -> Double { s - wait - lead }

        /// How far the hand-off is `s` seconds after the play came in: 0 the
        /// idle, 1 the replay.
        func weight(_ s: Double) -> Double {
            let u = (s - wait) / max(length, 0.01)
            return mode == .bridge ? TheaterBridge.ease(u) : TheaterBridge.fade(u)
        }

        /// Seconds after the play came in when it's all the replay's.
        var end: Double { wait + length }

        /// From the play coming in to the replay's clock at 0.
        var delay: Double { wait + lead }
    }

    /// How the idle's figures meet the replay's (pure; tested):
    /// - `room`: the replay's own lead-in (seconds before anyone moves);
    /// - `far`: the sport's far rule (`Far`);
    /// - `together`: the two are on the same end, facing the same way (else a crossfade);
    /// - `beatLeft`: what's left of the idle beat on screen (nil: it's still).
    static func plan(idle: [Figure], replay: [Figure], room: Double, far: Double, together: Bool = true, reduceMotion: Bool = false,
                     beatLeft: Double? = nil) -> Plan {
        if reduceMotion { return Plan(mode: .crossfade, length: crossfade) }
        let wait = beatLeft.map { $0 > 0 && $0 <= finishing ? $0 : 0 } ?? 0
        guard together else { return Plan(mode: .crossfade, length: crossfade, wait: wait, moved: .infinity) }
        let pairs = match(idle: idle, replay: replay)
        let moved = Self.moved(pairs, idle: idle, replay: replay)
        guard moved <= far else { return Plan(mode: .crossfade, length: crossfade, wait: wait, moved: moved) }
        let length = shortest + (longest - shortest) * min(max(moved / far, 0), 1)
        return Plan(mode: .bridge, pairs: pairs, length: length, lead: max(length - max(room, 0), 0), wait: wait, moved: moved)
    }

    /// Who becomes whom: the same man first (his athlete), then each of a
    /// group with the nearest of his kind, then with the nearest at all; a
    /// final pass swaps any two whose swap shortens their moves. Replay
    /// figure → idle figure. (pure; tested)
    static func match(idle: [Figure], replay: [Figure]) -> [Int: Int] {
        // A different kind costs as much as a long run; a different man (both named) more.
        func cost(_ r: Int, _ i: Int) -> Double {
            let a = replay[r], b = idle[i]
            if let x = a.athlete, let y = b.athlete, x == y { return -1 }
            var c = hypot(a.at.x - b.at.x, a.at.y - b.at.y)
            if a.kind != b.kind { c += 1000 }
            if let x = a.athlete, let y = b.athlete, x != y { c += 500 }
            return c
        }
        var options: [(cost: Double, r: Int, i: Int)] = []
        for r in replay.indices {
            for i in idle.indices where idle[i].group == replay[r].group { options.append((cost(r, i), r, i)) }
        }
        options.sort { ($0.cost, $0.r, $0.i) < ($1.cost, $1.r, $1.i) }
        var pairs: [Int: Int] = [:], taken = Set<Int>()
        for o in options where pairs[o.r] == nil && !taken.contains(o.i) {
            pairs[o.r] = o.i
            taken.insert(o.i)
        }
        // Untangle: two men who'd cross over swap places.
        var keys = pairs.keys.sorted()
        for _ in 0..<3 {
            var swapped = false
            for (n, a) in keys.enumerated() {
                for b in keys[(n + 1)...] where replay[a].group == replay[b].group {
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

    // MARK: Blending

    static func mix(_ a: CGPoint, _ b: CGPoint, _ w: Double) -> CGPoint { CGPoint(x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w) }

    /// A heading part way to another, the short way round.
    static func turn(_ a: Double, _ b: Double, _ w: Double) -> Double {
        var d = (b - a).truncatingRemainder(dividingBy: 2 * .pi)
        if d > .pi { d -= 2 * .pi } else if d < -.pi { d += 2 * .pi }
        return a + d * w
    }

    /// Each traveller's path over the bridge (`s`: seconds since the play
    /// came in), from where the idle has him to where the replay does, by
    /// the plan's weight, and his motion along it measured once (`RigTrack`:
    /// his stride, so he steps rather than glides), facing the way the two
    /// scenes have him facing, blended. `idle` and `replay`: a figure's spot
    /// and heading at `s` in each scene. Replay figure → track.
    static func tracks(_ plan: Plan, height: Double, idle: (Int, Double) -> (at: CGPoint, heading: Double),
                       replay: (Int, Double) -> (at: CGPoint, heading: Double)) -> [Int: RigTrack] {
        guard plan.mode == .bridge else { return [:] }
        var tracks: [Int: RigTrack] = [:]
        for (r, i) in plan.pairs {
            func spot(_ s: Double) -> (at: CGPoint, heading: Double) {
                let a = idle(i, s), b = replay(r, s), w = plan.weight(s)
                return (mix(a.at, b.at, w), turn(a.heading, b.heading, w))
            }
            tracks[r] = RigTrack(from: 0, through: plan.end, height: height, position: { spot($0).at }) { s in
                let p = spot(s)
                return RigFacing(point: CGPoint(x: p.at.x + cos(p.heading) * height, y: p.at.y + sin(p.heading) * height), always: true)
            }
        }
        return tracks
    }

    /// A traveller posed mid-bridge (pure): his idle pose and his replay
    /// pose (each as its own scene has him, where he stands in it) blended
    /// by `w`, striding along the bridge's path while he covers ground
    /// (`track` at `s`), the way he faces blended too.
    static func pose(from: (pose: RigPose, heading: Double), to: (pose: RigPose, heading: Double), w: Double, track: RigTrack?, s: Double,
                     at: CGPoint, unit: Double) -> (RigPose, Double) {
        var body = from.pose.mix(to.pose, w)
        let heading = turn(from.heading, to.heading, w)
        if let track {
            let m = track.motion(at: s)
            if m.weight > 0.01 {
                let feet = track.feet(at: s, anchor: at, heading: heading, unit: unit, speed: m.speed, stand: (body.left, body.right))
                body = body.mix(.gait(m, feet: feet), m.weight)
            }
        }
        return (body, heading)
    }

    /// How far the paired men travel, as the far rule measures it: the
    /// median move (a few men re-forming a set travel further; when the
    /// whole scene has moved on, most of them do). `share`: another
    /// percentile.
    static func moved(_ pairs: [Int: Int], idle: [Figure], replay: [Figure], share: Double = 0.5) -> Double {
        let moves = pairs.map { r, i in hypot(replay[r].at.x - idle[i].at.x, replay[r].at.y - idle[i].at.y) }.sorted()
        guard !moves.isEmpty else { return .infinity }
        return moves[min(max(Int((Double(moves.count) * share).rounded(.up)) - 1, 0), moves.count - 1)]
    }
}

// MARK: - Delays

/// How long each bridged replay's clock started after its play came in (the
/// idle beat's last moment, the time added in front), by play: the scoring
/// slide that lands with a replay's climax waits that much longer, so it
/// still lands with it.
@MainActor
enum TheaterDelays {
    private static var delays: [String: (delay: Double, noted: Date)] = [:]

    static func note(_ id: String, _ delay: Double, at date: Date = .now) {
        // A minute is long enough for any slide to have landed.
        delays = delays.filter { date.timeIntervalSince($0.value.noted) < 60 }
        delays[id] = delay > 0 ? (delay, date) : nil
    }

    static func delay(_ id: String) -> Double { delays[id]?.delay ?? 0 }
}
