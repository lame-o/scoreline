import SwiftUI

// The play theater's choreography: a `PlayScene` turned into every figure's
// path, the ball's flights and the beats (contact, outs, runs, the stamp),
// in feet and seconds from the pitch. Built once per play; any frame is a
// pure function of the script and t, so the harness can draw t = 1.4
// without playing 0…1.4, and the tests can check that a 6-3's throw beats
// the runner.
//
// Time is a broadcast replay's, not the game's: the delivery and the pitch
// in real time (0.4 s at 95 mph), everything after it about four times
// faster, and the runners are paced to the outcome the scorer recorded (out
// by a step at first; safe with room to spare). A replay runs 2–4 s, then the
// field settles: fielders walk back, runners take their leads, the next
// batter steps in.
//
// The script also says what each figure does (the windup, a catch, a throw,
// a slide), when the headline lands, and where the broadcast camera looks
// (PlayCamera.swift).

// MARK: - The field

/// The field in feet: home plate at the origin, x toward first base's side,
/// y out to center field, z up.
enum Ballpark {
    static let baseline = 90.0
    /// The pitcher's rubber.
    static let rubber = CGPoint(x: 0, y: 60.5)
    /// The infield's dirt reaches 95 ft from the rubber.
    static let skin = 95.0
    static let wallHeight = 10.0

    /// Home (0), first, second, third.
    static func base(_ n: Int) -> CGPoint {
        let d = baseline / 2.squareRoot()
        switch (n % 4 + 4) % 4 {
        case 1: return CGPoint(x: d, y: d)
        case 2: return CGPoint(x: 0, y: 2 * d)
        case 3: return CGPoint(x: -d, y: d)
        default: return .zero
        }
    }

    /// ESPN hit coordinates to feet: home plate at (125, 205), 2.42 ft a unit
    /// (the spray chart's fence, 165 units out, is 400 ft).
    static func feet(_ espn: CGPoint) -> CGPoint {
        CGPoint(x: (espn.x - 125) * 2.42, y: (205 - espn.y) * 2.42)
    }

    /// Radians off the line to center field, positive toward right.
    static func bearing(_ p: CGPoint) -> Double { atan2(p.x, p.y) }

    /// The fence: 330 ft down the lines, 375 in the gaps, 400 to center.
    static func fence(_ bearing: Double) -> Double {
        330 + 70 * cos(2 * min(max(bearing, -.pi / 4), .pi / 4))
    }

    static func distance(_ p: CGPoint) -> Double { hypot(p.x, p.y) }

    static func polar(_ distance: Double, _ degrees: Double) -> CGPoint {
        let a = degrees * .pi / 180
        return CGPoint(x: distance * sin(a), y: distance * cos(a))
    }

    /// Where each fielder stands, by scorer's number.
    static func position(_ n: Int) -> CGPoint {
        switch n {
        case 1: CGPoint(x: 0, y: 56)
        case 2: CGPoint(x: 0, y: -8)
        case 3: polar(110, 37)
        case 4: polar(150, 15)
        case 5: polar(110, -37)
        case 6: polar(150, -15)
        case 7: polar(292, -27)
        case 8: polar(322, 0)
        default: polar(292, 27)
        }
    }

    /// The batter's spot, on his side of the plate: a right-handed batter
    /// stands on the third-base side (the left, from behind the plate).
    static func box(_ bats: PlayScene.Hand) -> CGPoint { CGPoint(x: bats == .left ? 9 : -9, y: 1) }

    /// A runner's lead: a step off the bag toward the next base.
    static func lead(_ base: Int) -> CGPoint {
        let from = self.base(base), to = self.base(base + 1)
        let d = hypot(to.x - from.x, to.y - from.y)
        return CGPoint(x: from.x + (to.x - from.x) / d * 7, y: from.y + (to.y - from.y) / d * 7)
    }

    /// Where a fielder takes a throw at a base: on the bag, a stride inside it.
    static func bag(_ base: Int) -> CGPoint {
        let b = self.base(base)
        guard base % 4 != 0 else { return CGPoint(x: 0, y: -2) }
        let toMound = CGPoint(x: rubber.x - b.x, y: rubber.y - b.y)
        let d = hypot(toMound.x, toMound.y)
        return CGPoint(x: b.x + toMound.x / d * 3, y: b.y + toMound.y / d * 3)
    }

    /// The fielder nearest a spot (outfielders only for a ball beyond the infield).
    static func nearest(to p: CGPoint) -> Int {
        let pool = distance(p) > 175 ? [7, 8, 9] : [1, 3, 4, 5, 6]
        return pool.min { a, b in
            hypot(position(a).x - p.x, position(a).y - p.y) < hypot(position(b).x - p.x, position(b).y - p.y)
        } ?? 8
    }
}

/// A point on or over the field, in feet.
struct FieldPoint: Equatable {
    var x: Double
    var y: Double
    var z: Double = 0

    init(x: Double, y: Double, z: Double = 0) {
        self.x = x
        self.y = y
        self.z = z
    }

    init(_ p: CGPoint, z: Double = 0) { self.init(x: p.x, y: p.y, z: z) }

    var ground: CGPoint { CGPoint(x: x, y: y) }
}

// MARK: - Script

struct PlayScript: Equatable {
    enum Team { case fielding, batting }

    enum Ease {
        case linear, out, inOut

        func value(_ u: Double) -> Double {
            let u = min(max(u, 0), 1)
            switch self {
            case .linear: return u
            // The house ease-out: arriving, it settles.
            case .out: return Motion.curve.value(at: u)
            case .inOut: return u * u * (3 - 2 * u)
            }
        }
    }

    /// A walk or run along a path, from `start` to `end`.
    struct Move: Equatable {
        let start: Double
        let end: Double
        let path: [CGPoint]
        let ease: Ease
        /// Each leg's length, and the whole: measured once, not every frame.
        let lengths: [Double]
        let length: Double

        init(start: Double, end: Double, path: [CGPoint], ease: Ease = .inOut) {
            self.start = start
            self.end = end
            self.path = path
            self.ease = ease
            lengths = zip(path, path.dropFirst()).map { hypot($1.x - $0.x, $1.y - $0.y) }
            length = lengths.reduce(0, +)
        }

        func point(at t: Double) -> CGPoint {
            guard path.count > 1 else { return path.first ?? .zero }
            let u = ease.value(end > start ? (t - start) / (end - start) : 1)
            var remaining = u * length
            for (i, length) in lengths.enumerated() {
                if remaining <= length || i == lengths.count - 1 {
                    let f = length > 0 ? min(remaining / length, 1) : 1
                    return CGPoint(x: path[i].x + (path[i + 1].x - path[i].x) * f, y: path[i].y + (path[i + 1].y - path[i].y) * f)
                }
                remaining -= length
            }
            return path[path.count - 1]
        }
    }

    struct Actor: Equatable {
        /// Who he is on this play: his pose follows from it.
        enum Role: Equatable {
            /// By scorer's number (1: the pitcher, 2: the catcher).
            case fielder(Int)
            case batter
            case runner
        }

        /// A moment of the play in his hands.
        struct Action: Equatable {
            enum Kind: Equatable {
                /// A fly or a pop-up, gloved over his head.
                case catchHigh
                /// A ground ball, gloved at his feet.
                case scoop
                /// A throw or a liner taken at his chest.
                case glove
                case throwBall
            }
            var kind: Kind
            var at: Double
            /// Where the ball comes from or goes: he turns to face it.
            var toward: CGPoint
        }

        var team: Team
        var at: CGPoint
        var role: Role = .runner
        var moves: [Move] = []
        /// Fades in from `appear` and out from `vanish`, over `Self.fade`.
        var appear = -Double.infinity
        var vanish = Double.infinity
        var crouch = false
        /// The batter: his side, when he swings, when he drops the bat.
        var bats: PlayScene.Hand?
        var swing: Double?
        var dropsBat: Double?
        var actions: [Action] = []
        /// Feet first into a base, from this moment until he's gone or settled.
        var slide: Double?

        static let fade = 0.3

        /// The newest move that has begun wins: a later move starts from
        /// wherever the one before had got to.
        func position(at t: Double) -> CGPoint {
            guard let move = moves.last(where: { t >= $0.start }) else { return at }
            return t < move.end ? move.point(at: t) : move.path.last ?? at
        }

        func opacity(at t: Double) -> Double {
            let fadeIn = appear.isFinite ? min(max((t - appear) / Self.fade, 0), 1) : 1
            let fadeOut = vanish.isFinite ? 1 - min(max((t - vanish) / Self.fade, 0), 1) : 1
            return fadeIn * fadeOut
        }

        /// Running, not walking: a stride's bob.
        func running(at t: Double) -> Bool {
            moves.contains { t > $0.start && t < $0.end && $0.length / ($0.end - $0.start) > 40 }
        }

        /// Feet a second along the ground at t, and which way (nil: standing).
        func motion(at t: Double) -> (speed: Double, heading: CGPoint)? {
            guard let move = moves.last(where: { t >= $0.start }), t < move.end, move.length > 0.5 else { return nil }
            let a = move.point(at: max(t - 0.02, move.start)), b = move.point(at: min(t + 0.02, move.end))
            let d = hypot(b.x - a.x, b.y - a.y), dt = min(t + 0.02, move.end) - max(t - 0.02, move.start)
            guard d > 0.01, dt > 0 else { return nil }
            return (d / dt, CGPoint(x: (b.x - a.x) / d, y: (b.y - a.y) / d))
        }

        mutating func act(_ kind: Action.Kind, at time: Double, toward point: CGPoint) {
            actions.append(Action(kind: kind, at: time, toward: point))
        }

        mutating func move(to path: [CGPoint], from start: Double, to end: Double, ease: Ease = .inOut) {
            moves.removeAll { $0.start >= start }
            let origin = position(at: start)
            guard let last = path.last, hypot(last.x - origin.x, last.y - origin.y) > 0.5 || path.count > 1 else { return }
            moves.append(Move(start: start, end: max(end, start + 0.05), path: [origin] + path, ease: ease))
        }
    }

    struct Flight: Equatable {
        enum Arc: Equatable {
            /// A pitch or a carried ball: a gentle line.
            case straight
            /// Bouncing along the ground, this many hops.
            case bounce(Int)
            /// Up to `peak` feet over the line between its ends.
            case arc(Double)
        }
        var start: Double
        var end: Double
        var from: FieldPoint
        var to: FieldPoint
        var arc: Arc
        var ease: Ease = .linear

        func point(at t: Double) -> FieldPoint {
            let raw = end > start ? min(max((t - start) / (end - start), 0), 1) : 1
            let u = ease.value(raw)
            var p = FieldPoint(x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u, z: from.z + (to.z - from.z) * u)
            switch arc {
            case .straight:
                break
            case let .bounce(hops):
                // Each hop lower than the last, from the bat down to the grass.
                let n = Double(max(hops, 1))
                let phase = u * n
                let hop = floor(min(phase, n - 0.0001))
                let local = phase - hop
                let height = 9 * pow(0.45, hop) * (1 - u * 0.5)
                p.z = max(4 * height * local * (1 - local), 0) + from.z * max(1 - phase * 3, 0)
            case let .arc(peak):
                p.z += 4 * peak * raw * (1 - raw)
            }
            return p
        }

        /// When a bouncing ball touches down between hops, and where: the
        /// dust puffs. (Found once, by sampling: the ease has no inverse.)
        var bounces: [(at: Double, point: CGPoint)] {
            guard case let .bounce(hops) = arc, hops > 1, end > start else { return [] }
            var out: [(Double, CGPoint)] = []
            var hop = 0
            for i in 1...96 {
                let raw = Double(i) / 96, phase = ease.value(raw) * Double(hops)
                guard Int(phase) > hop, Int(phase) < hops else { continue }
                hop = Int(phase)
                let t = start + raw * (end - start)
                out.append((t, point(at: t).ground))
            }
            return out
        }
    }

    /// Dust kicked up where a grounder touches down.
    struct Puff: Equatable {
        var at: Double
        var point: CGPoint
    }

    /// The headline across the top of the field for a marquee play: HOME
    /// RUN, TRIPLE, DOUBLE PLAY. It lands with the payoff and clears as the
    /// field settles.
    struct Banner: Equatable {
        enum Tone: Equatable {
            /// The batting team's color: a hit.
            case hit
            /// A grand slam or a walk-off.
            case gold
            /// Outs: neutral ink.
            case out
            /// The app's red.
            case strikeout
        }
        var text: String
        var tone: Tone
        var at: Double
        var until: Double
        /// It brings its own confetti (a triple, a home run, a walk-off).
        var confetti: Bool
    }

    enum Beat { case contact, out, run, catchBall, hitBatter }

    struct Flash: Equatable {
        var beat: Beat
        var at: Double
        var point: FieldPoint
    }

    /// What's left where the ball went: the spray chart's marks.
    enum Mark { case hit, out, homeRun }

    struct Landing: Equatable {
        var point: CGPoint
        var mark: Mark
        var at: Double
    }

    struct Fence: Equatable {
        var at: Double
        var point: FieldPoint
    }

    var actors: [Actor] = []
    var flights: [Flight] = []
    var flashes: [Flash] = []
    /// The batted ball's flight (traced), and where it came down.
    var batted: Int?
    var landing: Landing?
    /// When the scorer's mark appears.
    var stamp = Double.infinity
    /// The pitch's type and speed, while it's in the air.
    var label: ClosedRange<Double>?
    /// A home run clearing the fence: when, and where (for the fireworks).
    var fence: Fence?
    /// The ball is shown from the pitch until it fades from here.
    var ballFrom = 0.0
    var ballGone = Double.infinity
    var settle = 0.0
    var duration = 0.0
    /// When the pitcher lets the pitch go (nil: nobody pitched).
    var release: Double?
    var puffs: [Puff] = []
    var banner: Banner?
    /// The scorer's mark's corner of the view (bottom left), as fractions
    /// of its width and height: the camera keeps the play out of it.
    var corner = CGSize.zero
    /// The broadcast camera, shot by shot, and where it looks at each frame.
    var shots: [Shot] = []
    var camera = CameraTrack()

    /// Between plays: who's where.
    struct Rest: Equatable {
        var bases: [Bool] = [false, false, false]
        /// The batter up, by his side (nil: nobody in the box).
        var bats: PlayScene.Hand?
        /// The half-inning ended: the batting team takes the field.
        var swapped = false
    }

    /// The ball at t: in flight, held where its last flight ended, or gone.
    func ball(at t: Double) -> FieldPoint? {
        guard !flights.isEmpty, t >= ballFrom, t < ballGone + Actor.fade else { return nil }
        var held = flights[0].from
        for flight in flights {
            if t < flight.start { return held }
            if t <= flight.end { return flight.point(at: t) }
            held = flight.to
        }
        return held
    }

    func ballOpacity(at t: Double) -> Double {
        ballGone.isFinite ? 1 - min(max((t - ballGone) / Actor.fade, 0), 1) : 1
    }
}

// MARK: - Building

extension PlayScript {
    /// The field with nobody moving: no play yet.
    init(rest: Rest) {
        for n in 1...9 { actors.append(Actor(team: .fielding, at: Ballpark.position(n), role: .fielder(n), crouch: n == 2)) }
        if let bats = rest.bats { actors.append(Actor(team: .batting, at: Ballpark.box(bats), role: .batter, bats: bats)) }
        for base in 1...3 where rest.bases[base - 1] { actors.append(Actor(team: .batting, at: Ballpark.lead(base))) }
    }

    init(_ scene: PlayScene, rest: Rest) {
        var b = Builder(scene: scene)
        switch scene.kind {
        case .strikeout:
            b.strikeout()
        case .walk, .hitByPitch:
            b.walk()
        case .stolenBase, .caughtStealing, .pickoff, .wildPitch, .passedBall, .balk, .indifference:
            b.runnersPlay()
        default:
            if scene.inPlay { b.ballInPlay() } else { b.runnersPlay() }
        }
        b.finish()
        b.settle(rest)
        b.headline()
        b.measureStamp()
        b.shoot()
        self = b.script
    }

    /// Assembles a script beat by beat.
    struct Builder {
        let scene: PlayScene
        var script = PlayScript()
        /// Actor index by the base a runner started from (0: the batter).
        var runner: [Int: Int] = [:]
        let batter: Int
        let hand: PlayScene.Hand
        /// The pitch leaves his hand after a 0.4 s delivery from the set,
        /// so the replay opens on the battery before anything flies.
        let pitchStart = 0.5
        /// When the pitch reaches the plate.
        let contact: Double
        /// An extra-base hit's batter reaches his base no sooner than this.
        var gathered: Double?

        init(scene: PlayScene) {
            self.scene = scene
            hand = scene.bats ?? .right
            // A 92 mph fastball reaches the plate in 0.42 s; slower pitches take longer.
            let mph = Double(scene.pitch?.mph ?? 91)
            contact = pitchStart + min(max(0.42 * 92 / mph, 0.34), 0.62)
            for n in 1...9 {
                script.actors.append(Actor(team: .fielding, at: Ballpark.position(n), role: .fielder(n), crouch: n == 2))
            }
            // On a runner's play the batter is still in the box.
            batter = script.actors.count
            script.actors.append(Actor(team: .batting, at: Ballpark.box(hand), role: .batter, bats: hand))
            runner[0] = batter
            for r in scene.runners where r.from > 0 {
                runner[r.from] = script.actors.count
                script.actors.append(Actor(team: .batting, at: Ballpark.lead(r.from)))
            }
            // The pitch's type and speed, until the ball's in play: after that it's in the way.
            if scene.pitch?.mph != nil || scene.pitch?.code != nil { script.label = pitchStart...(contact + 0.45) }
        }

        func fielder(_ n: Int) -> Int { min(max(n, 1), 9) - 1 }

        // MARK: Pitch

        /// Where the pitch crosses the plate: ESPN's pitch coordinates (zone
        /// x 91…141, y 148…192), spread out so a ball off the plate reads.
        var plate: FieldPoint {
            let x = ((scene.pitch?.x ?? 116) - 116) * 0.085
            let z = 3.4 - ((scene.pitch?.y ?? 170) - 148) * 0.045
            return FieldPoint(x: min(max(x, -6), 6), y: 0.5, z: min(max(z, 0.4), 5.5))
        }

        /// The catcher's mitt, where the pitch was.
        var mitt: FieldPoint { FieldPoint(x: plate.x * 0.7, y: -6.5, z: max(plate.z * 0.8, 1)) }

        /// Where the bat meets the ball, in front of the plate.
        var contactPoint: FieldPoint { FieldPoint(x: hand == .left ? 1.5 : -1.5, y: 2, z: 3) }

        mutating func pitch(to end: FieldPoint, at time: Double) {
            script.release = pitchStart
            script.flights.append(Flight(start: pitchStart, end: time, from: FieldPoint(x: 0, y: 54, z: 6), to: end, arc: .arc(0.6)))
        }

        // MARK: Ball in play

        mutating func ballInPlay() {
            let trajectory = scene.flight
            var target = scene.spot.map(Ballpark.feet) ?? guessSpot()
            let bearing = Ballpark.bearing(target), degrees = bearing * 180 / .pi
            let fence = Ballpark.fence(bearing)
            if scene.kind == .homeRun {
                // Over the fence, into the first rows.
                target = Ballpark.polar(min(max(Double(scene.distance ?? 0), Ballpark.distance(target), fence + 24), fence + 60), degrees)
            } else if Ballpark.distance(target) > fence - 7 {
                target = Ballpark.polar(fence - 7, degrees)
            }
            let distance = Ballpark.distance(target)
            let caught: Bool = switch scene.kind {
            case .flyOut, .lineOut, .popOut, .foulOut, .sacrificeFly: true
            case .doublePlay, .triplePlay: trajectory != .ground
            default: false
            }

            pitch(to: contactPoint, at: contact)
            script.actors[batter].swing = contact
            script.actors[batter].dropsBat = contact + 0.16
            script.flashes.append(Flash(beat: .contact, at: contact, point: contactPoint))

            // The flight, by ESPN's trajectory: a grounder hops and slows, a
            // liner is fast and flat, a fly hangs, a pop-up climbs.
            let time: Double, arc: Flight.Arc, ease: Ease
            switch trajectory {
            case .ground:
                time = min(max(distance / 125, 0.42), 1.25); arc = .bounce(distance > 150 ? 4 : 3); ease = .out
            case .line:
                time = min(max(0.28 + distance / 260, 0.38), 1.05); arc = .arc(5 + distance * 0.045); ease = .linear
            case .fly:
                time = scene.kind == .homeRun ? 1.75 : min(max(0.85 + distance / 300, 1.05), 1.85)
                arc = .arc(scene.kind == .homeRun ? 25 + distance * 0.13 : 22 + distance * 0.21); ease = .linear
            case .popUp:
                time = min(max(1.15 + distance / 600, 1.2), 1.5); arc = .arc(95 + distance * 0.1); ease = .linear
            }
            let land = contact + time
            let to = FieldPoint(target, z: caught ? 4.5 : 0)
            script.batted = script.flights.count
            script.flights.append(Flight(start: contact, end: land, from: contactPoint, to: to, arc: arc, ease: ease))

            let first = scene.fielders.first ?? scene.error ?? Ballpark.nearest(to: target)
            // Everyone else leans toward the ball.
            for n in 1...9 where n != first && n != 2 {
                let home = Ballpark.position(n)
                let dx = target.x - home.x, dy = target.y - home.y, d = hypot(dx, dy)
                guard d > 1 else { continue }
                let step = min(d * 0.08, 9)
                script.actors[fielder(n)].move(to: [CGPoint(x: home.x + dx / d * step, y: home.y + dy / d * step)],
                                               from: contact + 0.1, to: contact + 0.75, ease: .out)
            }

            if scene.kind == .homeRun {
                // The outfielder runs back to the track and watches it go.
                let track = Ballpark.polar(fence - 9, degrees)
                script.actors[fielder(Ballpark.nearest(to: track))].move(to: [track], from: contact + 0.1, to: land - 0.3, ease: .out)
                let over = contact + time * min(max((fence - 2) / max(distance, 1), 0), 1)
                let p = script.flights[script.flights.count - 1].point(at: over)
                script.fence = Fence(at: over, point: FieldPoint(x: p.x, y: p.y, z: max(p.z, Ballpark.wallHeight + 4)))
                script.landing = Landing(point: target, mark: .homeRun, at: land)
                script.ballGone = land + 0.15
                script.stamp = over + 0.05
                // The trot: quicker than the game's, so the replay ends with him crossing the plate.
                runners(start: contact + 0.3, pace: 140, outs: [:])
                return
            }

            let f1 = fielder(first)
            var holder = target, held = land
            if caught {
                script.actors[f1].move(to: [target], from: contact + 0.08, to: land, ease: .out)
                script.actors[f1].act(trajectory == .line ? .glove : .catchHigh, at: land, toward: .zero)
                script.flashes.append(Flash(beat: .catchBall, at: land, point: to))
                script.landing = Landing(point: target, mark: .out, at: land)
            } else if trajectory == .ground && distance < 165 {
                // Fielded where ESPN marks it.
                script.actors[f1].move(to: [target], from: contact + 0.05, to: land, ease: .out)
                script.actors[f1].act(.scoop, at: land, toward: .zero)
                script.landing = Landing(point: target, mark: scene.runners.contains(where: \.isOut) ? .out : .hit, at: land)
            } else {
                // A hit falls in; the fielder gets to it a beat later.
                held = land + 0.3
                script.actors[f1].move(to: [target], from: contact + 0.1, to: held, ease: .out)
                script.actors[f1].act(.scoop, at: held, toward: .zero)
                script.landing = Landing(point: target, mark: .hit, at: land)
            }

            let throwing = scene.text.contains("throwing error")
            if scene.error != nil, !throwing, scene.fielders.count <= 1 {
                // A fielding error: the ball gets away from him.
                let d = max(Ballpark.distance(target), 1)
                let loose = CGPoint(x: target.x + target.x / d * 18, y: target.y + target.y / d * 18)
                script.flights.append(Flight(start: held, end: held + 0.4, from: FieldPoint(target), to: FieldPoint(loose), arc: .bounce(2), ease: .out))
                script.actors[f1].move(to: [loose], from: held + 0.05, to: held + 0.65, ease: .out)
                holder = loose
                held += 0.65
            } else if throwing, scene.fielders.count <= 1 {
                // A throwing error: wide of first, and on into foul ground.
                script.actors[fielder(3)].move(to: [Ballpark.bag(1)], from: contact + 0.1, to: held)
                throwBall(from: holder, to: Ballpark.bag(1), at: held + 0.16, overshoot: true, by: first)
            }

            // The throws, to where the outs were made.
            let chain = throwChain(from: holder, holding: first, at: held, inferred: scene.fielders.isEmpty)
            holder = chain.holder
            held = chain.at

            if scene.runners.allSatisfy({ !$0.isOut }) && scene.error == nil {
                if distance >= 165 {
                    // A hit to the outfield: the ball comes back in to the cutoff.
                    let relay = target.x < 0 ? 6 : 4
                    let cutoff = Ballpark.polar(150, degrees * 0.8)
                    script.actors[fielder(relay)].move(to: [cutoff], from: contact + 0.2, to: held)
                    throwBall(from: holder, to: cutoff, at: held + 0.25, by: first, catcher: relay)
                } else if scene.kind == .single {
                    // An infield single: the throw to first, a step late.
                    let beat = contact + 0.16 + Ballpark.baseline / 95 + 0.12
                    let bag = Ballpark.bag(1)
                    script.actors[fielder(3)].move(to: [bag], from: contact + 0.1, to: contact + 0.6)
                    throwBall(from: holder, to: bag, at: max(beat - throwTime(from: holder, to: bag), held + 0.1), by: first, catcher: 3)
                }
            }
            // An extra-base hit: the batter pulls in just after the ball's gathered (the camera cuts to him as it is).
            if !caught, scene.error == nil, case let .base(b)? = scene.batter?.end, b >= 2, !scene.runners.contains(where: \.isOut) {
                gathered = held + 0.5
            }
            runners(start: caught ? land + 0.05 : contact + 0.12, pace: 95, outs: chain.outs)
            if caught, scene.batter?.isOut == true {
                // He jogs out of the box until the catch.
                script.actors[batter].move(to: [CGPoint(x: 22, y: 22)], from: contact + 0.15, to: land + 0.2, ease: .linear)
                script.actors[batter].vanish = land + 0.25
            }
        }

        /// A spot for a ball in play ESPN didn't place: where the fielder named stands.
        func guessSpot() -> CGPoint {
            if let n = scene.fielders.first ?? scene.error {
                return n == 2 ? CGPoint(x: 0, y: 12) : n == 1 ? CGPoint(x: 0, y: 45) : Ballpark.position(n)
            }
            switch scene.kind {
            case .homeRun: return Ballpark.polar(410, 0)
            case .double, .triple: return Ballpark.polar(300, -20)
            case .single: return Ballpark.polar(200, 10)
            default: return Ballpark.polar(150, 0)
            }
        }

        func throwTime(from: CGPoint, to: CGPoint) -> Double {
            min(max(hypot(to.x - from.x, to.y - from.y) / 175 + 0.08, 0.22), 0.85)
        }

        /// A throw, by and to fielders by scorer's number when they're known
        /// (the thrower's arm comes through; the receiver gloves it).
        @discardableResult
        mutating func throwBall(from: CGPoint, to: CGPoint, at start: Double, overshoot: Bool = false,
                                by thrower: Int? = nil, catcher receiver: Int? = nil) -> Double {
            let d = hypot(to.x - from.x, to.y - from.y)
            let time = throwTime(from: from, to: to)
            var end = FieldPoint(to, z: 4)
            if overshoot, d > 1 {
                end = FieldPoint(x: to.x + (to.x - from.x) / d * 28 + 6, y: to.y + (to.y - from.y) / d * 28, z: 0)
            }
            script.flights.append(Flight(start: start, end: start + time * (overshoot ? 1.3 : 1), from: FieldPoint(from, z: 5), to: end,
                                         arc: .arc(3 + d * 0.035)))
            if let thrower { script.actors[fielder(thrower)].act(.throwBall, at: start, toward: to) }
            if let receiver, !overshoot { script.actors[fielder(receiver)].act(.glove, at: start + time, toward: from) }
            return start + time
        }

        /// The fielding chain after the first fielder: a throw to whoever
        /// covered each base where an out was made, relays through the
        /// cutoff, and outs the holder makes on foot (3U). Returns when each
        /// base's out was made, and where the ball ended up.
        mutating func throwChain(from start: CGPoint, holding first: Int, at time: Double,
                                 inferred: Bool) -> (outs: [Int: Double], holder: CGPoint, at: Double) {
            // Outs at bases in the order they were made: the lead runner's first.
            let bases = scene.runners.compactMap { r -> Int? in
                guard case let .out(at?) = r.end, at != 0 || r.from > 0 else { return nil }
                return at
            }.sorted { ($0 == 0 ? 4 : $0) > ($1 == 0 ? 4 : $1) }
            let receivers = inferred ? [] : Array(scene.fielders.dropFirst())
            var steps: [(receiver: Int?, base: Int?)] = []
            if receivers.count >= bases.count {
                let relays = receivers.count - bases.count
                steps = receivers.prefix(relays).map { ($0, nil) } + zip(receivers.suffix(bases.count), bases).map { ($0, $1) }
            } else {
                let missing = bases.count - receivers.count
                steps = bases.prefix(missing).map { (nil, $0) } + zip(receivers, bases.suffix(receivers.count)).map { ($0, $1) }
            }
            var holder = start, number = first, held = time + 0.16
            var outs: [Int: Double] = [:]
            var wild = scene.error != nil && !inferred && scene.text.contains("throwing error")
            for (i, step) in steps.enumerated() {
                guard let base = step.base else {
                    // A relay: the cutoff man lines up between the ball and the next base.
                    guard let r = step.receiver else { continue }
                    let next = steps[(i + 1)...].first { $0.base != nil }?.base ?? 2
                    let bag = Ballpark.bag(next)
                    let cutoff = CGPoint(x: holder.x + (bag.x - holder.x) * 0.45, y: holder.y + (bag.y - holder.y) * 0.45)
                    script.actors[fielder(r)].move(to: [cutoff], from: contact + 0.15, to: held)
                    let arrive = throwBall(from: holder, to: cutoff, at: held, by: number, catcher: r)
                    holder = cutoff; number = r; held = arrive + 0.1
                    continue
                }
                let bag = Ballpark.bag(base)
                let near = hypot(bag.x - holder.x, bag.y - holder.y) < 32
                if let receiver = step.receiver ?? (near ? nil : PlayScene.coverer(of: base, after: number)), receiver != number {
                    script.actors[fielder(receiver)].move(to: [bag], from: contact + 0.1, to: max(contact + 0.7, held - 0.05))
                    let arrive = throwBall(from: holder, to: bag, at: held, overshoot: wild && i == steps.count - 1,
                                           by: number, catcher: receiver)
                    if wild && i == steps.count - 1 { wild = false; continue }
                    outs[base] = arrive
                    script.flashes.append(Flash(beat: .out, at: arrive, point: FieldPoint(Ballpark.base(base))))
                    holder = bag; number = receiver; held = arrive + 0.1
                } else {
                    // He takes it there himself.
                    let d = hypot(bag.x - holder.x, bag.y - holder.y)
                    let arrive = held + max(d / 70, 0.2)
                    script.actors[fielder(number)].move(to: [bag], from: held - 0.1, to: arrive, ease: .out)
                    script.flights.append(Flight(start: held - 0.1, end: arrive, from: FieldPoint(holder, z: 4), to: FieldPoint(bag, z: 4),
                                                 arc: .straight, ease: .out))
                    outs[base] = arrive
                    script.flashes.append(Flash(beat: .out, at: arrive, point: FieldPoint(Ballpark.base(base))))
                    holder = bag; held = arrive + 0.1
                }
            }
            return (outs, holder, held)
        }

        /// Along the bases from one to another (4: home).
        func basePath(from: Int, to: Int) -> [CGPoint] {
            to > from ? ((from + 1)...to).map { Ballpark.base($0) } : []
        }

        /// Every runner to where the scorer put him: at `pace` ft/s, or, when
        /// he's out, a step behind the ball.
        mutating func runners(start: Double, pace: Double, outs: [Int: Double]) {
            for r in scene.runners {
                guard let index = runner[r.from] else { continue }
                let leave = r.from == 0 ? start + 0.04 : start
                switch r.end {
                case let .base(b) where b > r.from:
                    let arrive = max(leave + Double(b - r.from) * Ballpark.baseline / pace, r.from == 0 ? gathered ?? 0 : 0)
                    script.actors[index].move(to: basePath(from: r.from, to: b), from: leave, to: arrive)
                    // A steal, and a triple's last few strides: feet first.
                    if scene.kind == .stolenBase || (r.from == 0 && b == 3) { script.actors[index].slide = arrive - 0.26 }
                case .base:
                    break
                case .scored:
                    let home = leave + Double(4 - r.from) * Ballpark.baseline / pace
                    script.actors[index].move(to: basePath(from: r.from, to: 4), from: leave, to: home)
                    script.flashes.append(Flash(beat: .run, at: home, point: FieldPoint(x: 0, y: 0)))
                    script.actors[index].vanish = home + 0.15
                case let .out(at):
                    // The batter's own out at the plate (a strikeout), or at the catch: not a run.
                    guard let at, !(r.from == 0 && at == 0) else { continue }
                    let target = at == 0 ? 4 : at
                    if target <= r.from {
                        // Doubled off or picked off: back toward his own base, too late.
                        let when = outs[at] ?? leave + 0.6
                        script.actors[index].move(to: [Ballpark.base(r.from)], from: leave, to: when + 0.08)
                        script.actors[index].vanish = when + 0.35
                    } else {
                        let when = outs[at] ?? leave + Double(target - r.from) * Ballpark.baseline / pace
                        // A step short when the ball arrives.
                        let arrive = max(when + 0.1, leave + 0.35)
                        script.actors[index].move(to: basePath(from: r.from, to: target), from: leave, to: arrive)
                        script.actors[index].vanish = arrive + 0.25
                        // A close play at second, third or home: he slides into the tag.
                        if target >= 2 { script.actors[index].slide = max(arrive - 0.26, leave + 0.1) }
                    }
                }
            }
        }

        // MARK: Strikeout, walk, runners

        mutating func strikeout() {
            pitch(to: mitt, at: contact + 0.05)
            script.actors[fielder(2)].act(.glove, at: contact + 0.05, toward: Ballpark.rubber)
            if scene.kind == .strikeout(looking: false) { script.actors[batter].swing = contact - 0.03 }
            // Strike three pops the mitt.
            script.flashes.append(Flash(beat: .catchBall, at: contact + 0.05, point: mitt))
            script.flashes.append(Flash(beat: .out, at: contact + 0.08, point: FieldPoint(Ballpark.box(hand))))
            script.stamp = contact + 0.14
            script.actors[batter].vanish = contact + 0.75
            // A runner going on the pitch: strike him out, throw him out.
            let chain = throwChain(from: mitt.ground, holding: 2, at: contact + 0.05, inferred: true)
            runners(start: pitchStart - 0.1, pace: 80, outs: chain.outs)
        }

        mutating func walk() {
            if scene.kind == .hitByPitch {
                let at = FieldPoint(Ballpark.box(hand), z: 3)
                pitch(to: at, at: contact - 0.02)
                script.flights.append(Flight(start: contact - 0.02, end: contact + 0.35, from: at,
                                             to: FieldPoint(x: at.x * 0.4, y: 9), arc: .bounce(2), ease: .out))
                script.flashes.append(Flash(beat: .hitBatter, at: contact - 0.02, point: at))
            } else {
                pitch(to: mitt, at: contact + 0.05)
                script.actors[fielder(2)].act(.glove, at: contact + 0.05, toward: Ballpark.rubber)
            }
            script.actors[batter].dropsBat = contact + 0.22
            script.stamp = contact + 0.3
            // A jog to first; the runners forced along with him.
            runners(start: contact + 0.3, pace: 62, outs: [:])
        }

        /// A steal, a pickoff, a wild pitch: the runners' play.
        mutating func runnersPlay() {
            let pitched = scene.kind != .pickoff && scene.kind != .balk
            var holder = mitt.ground, holding = 2, held = contact + 0.05
            if !pitched {
                holder = Ballpark.position(1); holding = 1; held = 0.45
                script.flights.append(Flight(start: 0, end: 0.3, from: FieldPoint(holder, z: 5), to: FieldPoint(holder, z: 5), arc: .straight))
            } else if scene.kind == .wildPitch || scene.kind == .passedBall {
                // In the dirt, past the catcher, to the backstop.
                let short = FieldPoint(x: plate.x, y: -4, z: 0.6)
                let backstop = CGPoint(x: plate.x >= 0 ? 16 : -16, y: -34)
                pitch(to: short, at: contact + 0.05)
                script.flights.append(Flight(start: contact + 0.05, end: contact + 0.75, from: short, to: FieldPoint(backstop),
                                             arc: .bounce(2), ease: .out))
                script.actors[fielder(2)].move(to: [CGPoint(x: backstop.x * 0.8, y: -28)], from: contact + 0.15, to: contact + 0.85, ease: .out)
                holder = backstop; held = contact + 0.9
            } else {
                pitch(to: mitt, at: contact + 0.05)
                script.actors[fielder(2)].act(.glove, at: contact + 0.05, toward: Ballpark.rubber)
            }
            let thrown = scene.kind == .caughtStealing || scene.kind == .pickoff || scene.runners.contains(where: \.isOut)
            let chain = thrown ? throwChain(from: holder, holding: holding, at: held, inferred: scene.fielders.isEmpty)
                : (outs: [:], holder: holder, at: held)
            // Stealing, they go with the pitch.
            let leave = !pitched ? 0.5 : scene.kind == .stolenBase || scene.kind == .caughtStealing ? pitchStart - 0.05 : contact + 0.1
            runners(start: leave, pace: 85, outs: chain.outs)
            if scene.kind == .stolenBase, let r = scene.runners.first(where: { $0.from > 0 }), case let .base(b) = r.end, b > r.from {
                // The throw, a beat behind him.
                let bag = Ballpark.bag(b)
                script.actors[fielder(PlayScene.coverer(of: b, after: 2))].move(to: [bag], from: contact, to: contact + 0.6)
                let safe = leave + Double(b - r.from) * Ballpark.baseline / 85 + 0.12
                throwBall(from: holder, to: bag, at: max(safe - throwTime(from: holder, to: bag), held + 0.1),
                          by: holding, catcher: PlayScene.coverer(of: b, after: 2))
            }
        }

        // MARK: End and settle

        /// The stamp lands as the play resolves (the last out, the batter
        /// reaching his base); the action ends when the last thing stops.
        mutating func finish() {
            script.flights.sort { $0.start < $1.start }
            let lastOut = script.flashes.filter { $0.beat == .out }.map(\.at).max()
            let reached = script.actors[batter].moves.last?.end
            if !script.stamp.isFinite {
                script.stamp = lastOut ?? max(reached ?? 0, script.landing?.at ?? contact + 0.3)
            }
            let ends = [script.stamp + 0.4, script.flights.map(\.end).max() ?? 0, (script.flashes.map(\.at).max() ?? 0) + 0.45,
                        script.actors.flatMap { $0.moves.map(\.end) }.max() ?? 0]
            script.settle = max(ends.max() ?? 0, 1.2) + 0.75
            script.ballGone = min(script.ballGone, script.settle)
            script.puffs = script.flights.flatMap { flight in flight.bounces.map { Puff(at: $0.at, point: $0.point) } }
        }

        /// The banner for a marquee play, landing with its payoff: off the
        /// bat for a home run, the batter reaching his base for a double or a
        /// triple, the last out of a double play, strike three. A single, a
        /// walk and a routine out keep to the stamp.
        mutating func headline() {
            let moves = script.actors[batter].moves
            func reached(_ base: Int) -> Double? { moves.first { $0.path.last == Ballpark.base(base) }?.end }
            func banner(_ text: String, _ tone: Banner.Tone, at time: Double, confetti: Bool = false) {
                script.banner = Banner(text: text, tone: tone, at: time, until: max(script.settle, time + 1.2), confetti: confetti)
            }
            if scene.walkOff {
                let run = script.flashes.filter { $0.beat == .run }.map(\.at).max()
                banner("WALK-OFF", .gold, at: scene.kind == .homeRun ? contact + 0.3 : run ?? script.stamp, confetti: true)
                return
            }
            switch scene.kind {
            case .homeRun:
                let slam = scene.runs == 4
                banner(slam ? "GRAND SLAM" : "HOME RUN", slam ? .gold : .hit, at: contact + 0.3, confetti: true)
            case .triple: banner("TRIPLE", .hit, at: reached(3) ?? script.stamp, confetti: true)
            case .double: banner("DOUBLE", .hit, at: reached(2) ?? script.stamp)
            case .doublePlay: banner("DOUBLE PLAY", .out, at: script.stamp)
            case .triplePlay: banner("TRIPLE PLAY", .out, at: script.stamp)
            case .strikeout: banner("STRIKEOUT", .strikeout, at: script.stamp)
            default: break
            }
        }

        /// The scorer's mark's corner, measured from its type: the code at a
        /// fifth of the view's height, the title under it at about a
        /// eighteenth, in a view twice as wide as tall.
        mutating func measureStamp() {
            let notation = scene.notation
            guard !notation.code.isEmpty else { return }
            let marks: Set<String> = ["HR", "BB", "HBP", "IBB", "SB", "WP", "PB", "BK", "DI", "K"]
            var code = 0.0
            for part in notation.code.split(separator: " ") {
                let bold = part.contains(where: \.isNumber) || marks.contains(String(part))
                code += part.reduce(0.0) { width, c in width + (c.isNumber ? 0.6 : c == "-" ? 0.5 : 0.68) } * (bold ? 1 : 0.5) + 0.25
            }
            if scene.runs > 0 { code += 1.15 }
            // The title is at most about a third of the view (it steps down when longer).
            let title = min(Double(scene.title.count + (scene.kind == .homeRun && scene.distance != nil ? 9 : 0)) * 0.72 * 0.28, 3.4)
            let width = 0.055 + max(code, title) * 0.2
            script.corner = CGSize(width: width / CameraFrame.aspect + 0.03, height: 0.3)
        }

        /// After the hold: fielders walk back, runners take their leads, the
        /// next batter steps in. At the end of a half-inning the teams change
        /// sides instead.
        mutating func settle(_ rest: Rest) {
            let s = script.settle, back = s + 0.8
            if rest.swapped {
                for i in script.actors.indices { script.actors[i].vanish = min(script.actors[i].vanish, s) }
                // The team that batted takes the field.
                for n in 1...9 {
                    script.actors.append(Actor(team: .batting, at: Ballpark.position(n), role: .fielder(n), appear: s + 0.15, crouch: n == 2))
                }
                for base in 1...3 where rest.bases[base - 1] {
                    script.actors.append(Actor(team: .fielding, at: Ballpark.lead(base), appear: s + 0.4))
                }
                if let bats = rest.bats {
                    script.actors.append(Actor(team: .fielding, at: Ballpark.box(bats), role: .batter, appear: s + 0.4, bats: bats))
                }
            } else {
                for n in 1...9 { script.actors[fielder(n)].move(to: [Ballpark.position(n)], from: s, to: back) }
                // A runner stays where the live bases have one; anyone else leaves.
                var covered = Set<Int>()
                for r in scene.runners {
                    guard let index = runner[r.from], case let .base(b) = r.end else { continue }
                    if rest.bases[b - 1], !covered.contains(b) {
                        covered.insert(b)
                        script.actors[index].move(to: [Ballpark.lead(b)], from: s, to: back)
                    } else {
                        script.actors[index].vanish = min(script.actors[index].vanish, s)
                    }
                }
                for base in 1...3 where rest.bases[base - 1] && !covered.contains(base) {
                    script.actors.append(Actor(team: .batting, at: Ballpark.lead(base), appear: s + 0.2))
                }
                if scene.batter == nil {
                    // A runner's play: the batter is still up.
                    if rest.bats == nil { script.actors[batter].vanish = min(script.actors[batter].vanish, s) }
                } else if let bats = rest.bats {
                    script.actors.append(Actor(team: .batting, at: Ballpark.box(bats), role: .batter, appear: s + 0.3, bats: bats))
                }
            }
            script.duration = back + Actor.fade
        }
    }
}
