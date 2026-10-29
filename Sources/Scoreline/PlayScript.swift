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
// When Statcast measured the play, the ball flies for real: the pitch along
// its tracked path from the hand to where it crossed the plate, and the ball
// off the bat from its exit velocity and launch angle, under gravity, drag
// and lift, coming down where MLB measured it (`BattedFlight`). Its flight
// keeps one pace from contact to glove (real speeds, a little quicker: near
// real time for a grounder, about 2.5× for a high fly), and the fielders,
// throws and runners key off when it really gets there. Without Statcast the
// flight is drawn from ESPN's trajectory class, as before.
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
    /// Where the pitch leaves his hand: a stride (6.5 ft) off the rubber.
    static let release = 54.0
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

    /// The first baseman holding a runner on: at the bag, a step toward second.
    static let holding = CGPoint(x: base(1).x - 3, y: base(1).y + 1)

    /// A team's dugout, in foul ground off the line: the home team's on the
    /// first-base side, the visitors' on the third (parks differ; this is the
    /// theater's one assumption, the same every game).
    static func dugout(home: Bool) -> CGPoint { CGPoint(x: home ? 84 : -84, y: 26) }

    /// A team's bullpen gate, in the wall on its dugout's side, in the gap.
    static func bullpen(home: Bool) -> CGPoint {
        let degrees = home ? 36.0 : -36.0
        return polar(fence(degrees * .pi / 180) - 6, degrees)
    }

    /// The on-deck circle on the batting team's side.
    static func onDeck(home: Bool) -> CGPoint { CGPoint(x: home ? 34 : -34, y: -14) }

    /// The plate umpire's spot: behind the catcher, in the slot on the
    /// batter's side of him (looking in over the catcher's inside shoulder),
    /// a little wider and deeper than life so the two figures, drawn larger
    /// than life, both read.
    static func umpire(_ bats: PlayScene.Hand?) -> CGPoint { CGPoint(x: bats == .left ? 3.2 : -3.2, y: -13) }

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
    /// The teams, and the umpires (who wear neither).
    enum Team { case fielding, batting, official }

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
            /// A manager, a coach or a trainer, out of the dugout.
            case coach
            /// The plate umpire.
            case umpire
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
        /// At full stretch for the ball (a diving or leaping catch).
        var dive: Dive?
        /// The pitcher's throwing hand (a lefty's delivery is mirrored) and
        /// his arm slot: 0 sidearm, 1 over the top.
        var arm: PlayScene.Hand?
        var slot = 0.7
        /// A check swing (the bat starts through and holds up), and a bunt squared from here on.
        var check: Double?
        var bunt: Double?
        /// The pitcher set in the stretch; leaning in for the sign; the catcher up out of his crouch.
        var sets: [ClosedRange<Double>] = []
        var sign: ClosedRange<Double>?
        var rise: [ClosedRange<Double>] = []
        /// Head first back into a base (a throw over), from this moment.
        var diveBack: Double?
        /// A practice swing, half speed, from this moment.
        var practice: Double?
        /// An umpire's calls, each from its moment.
        var signals: [Signal] = []

        /// An umpire's call, as he makes it: a called strike's punch (a
        /// strikeout looking's punch-out, side-on), a swinging strike's point,
        /// both arms up for a foul, safe and out at the plate, a tap on the
        /// cap for a challenge.
        struct Signal: Equatable {
            enum Kind: Equatable { case strike, punchOut, swinging, foul, safe, out, challenge }
            var kind: Kind
            var at: Double
            /// Where he's looking as he makes it (the plate for a play there; else the pitcher).
            var toward: CGPoint = Ballpark.rubber
        }

        /// From `start` his glove goes to `target`, reaching it at `reach`;
        /// a dive ends on the grass at `landing`. (The figures don't draw it
        /// yet: a lunge stands in.)
        struct Dive: Equatable {
            var start: Double
            var reach: Double
            var target: FieldPoint
            var landing: CGPoint
        }

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
            /// A tracked pitch: Statcast's path between two of its moments
            /// (seconds from its release), in real time.
            case pitch(Statcast.Pitch, from: Double, to: Double)
            /// A measured batted ball: its flight sampled evenly in time.
            case samples([FieldPoint])
        }
        var start: Double
        var end: Double
        var from: FieldPoint
        var to: FieldPoint
        var arc: Arc
        var ease: Ease = .linear
        /// A measured flight's touchdowns, as fractions of it: the dust puffs.
        var hops: [Double] = []
        /// Another ball (a warm-up throw after the last one came in): unseen until it's thrown.
        var fresh = false

        func point(at t: Double) -> FieldPoint {
            let raw = end > start ? min(max((t - start) / (end - start), 0), 1) : 1
            switch arc {
            case let .pitch(pitch, a, b):
                return pitch.point(at: a + (b - a) * raw)
            case let .samples(points) where points.count > 1:
                let i = raw * Double(points.count - 1), lower = min(Int(i), points.count - 2), f = i - Double(lower)
                let p = points[lower], q = points[lower + 1]
                return FieldPoint(x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, z: p.z + (q.z - p.z) * f)
            default:
                break
            }
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
            case .pitch, .samples:
                break
            }
            return p
        }

        /// When a bouncing ball touches down between hops, and where: the
        /// dust puffs. (Found once, by sampling: the ease has no inverse.)
        var bounces: [(at: Double, point: CGPoint)] {
            if case .samples = arc {
                return self.hops.map { u in (start + u * (end - start), point(at: start + u * (end - start)).ground) }
            }
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
        /// Above the field: a home run in the seats.
        var z = 0.0
    }

    struct Fence: Equatable {
        var at: Double
        var point: FieldPoint
    }

    /// What the status tag says as a beat plays: each from its moment (a
    /// pitch's call as it pops the mitt, a challenge and how it came out).
    struct Caption: Equatable {
        enum Line: Equatable {
            /// The beat's own tag ("MOUND VISIT").
            case tag
            /// A pitch's call (as the umpire made it, when it's then challenged).
            case call(asCalled: Bool)
            /// Who challenged a call, and how it came out.
            case challenge, outcome
        }
        var at: Double
        var line: Line
    }

    /// The infield tarp: rolled out (or in) from `at` over `Tarp.roll`.
    struct Tarp: Equatable {
        static let roll = 2.4
        var at: Double
        var out: Bool

        /// How much of the infield it covers at t (0…1).
        func cover(at t: Double) -> Double {
            let u = PlayScript.Ease.inOut.value((t - at) / Self.roll)
            return out ? u : 1 - u
        }
    }

    /// The strike zone at the front of the plate while a pitch is on its
    /// way (this batter's, as MLB measured it), and where the ball crossed it.
    struct Zone: Equatable {
        var bottom: Double
        var top: Double
        /// When it crosses the plate, and where: feet across, and height.
        var at: Double
        var crossing: CGPoint
        /// Shown from, and fading from.
        var from: Double
        var until: Double

        /// Half the plate's width, and its front (feet from its point).
        static let half = 17.0 / 24
        static let front = 17.0 / 12
    }

    var actors: [Actor] = []
    var flights: [Flight] = []
    var flashes: [Flash] = []
    var captions: [Caption] = []
    var zone: Zone?
    /// A flight the fielders turn to watch (a foul ball) when nothing was put in play.
    var watch: Int?
    var tarp: Tarp?
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
    /// Each figure's motion through the replay (its heading, stride and
    /// footfalls), measured once: by actor.
    var rig: [RigTrack] = []

    /// Between plays: who's where.
    struct Rest: Equatable {
        var bases: [Bool] = [false, false, false]
        /// The batter up, by his side (nil: nobody in the box).
        var bats: PlayScene.Hand?
        /// The half-inning ended: the batting team takes the field.
        var swapped = false
        /// The fielding team is the home team (its dugout and bullpen are on
        /// the first-base side; the visitors' on the third).
        var fieldingHome = true
        /// What still stands on the field between pitches: the trainer out
        /// to an injured man, the tarp in a rain delay.
        var standing: Standing?

        enum Standing: Equatable {
            case injury(PlayBeat.Hurt)
            case tarp
        }

        init(bases: [Bool] = [false, false, false], bats: PlayScene.Hand? = nil, swapped: Bool = false, fieldingHome: Bool = true,
             standing: Standing? = nil) {
            self.bases = bases
            self.bats = bats
            self.swapped = swapped
            self.fieldingHome = fieldingHome
            self.standing = standing
        }

        /// Where fielder `n` waits for the pitch: his position, the first
        /// baseman holding a runner on at the bag.
        func spot(_ n: Int) -> CGPoint {
            if n == 3, bases[0] { return Ballpark.holding }
            return Ballpark.position(n)
        }
    }

    /// The ball at t: in flight, held where its last flight ended, or gone.
    func ball(at t: Double) -> FieldPoint? {
        guard !flights.isEmpty, t >= ballFrom, t < ballGone + Actor.fade else { return nil }
        var held = flights[0].from
        for (i, flight) in flights.enumerated() {
            if t < flight.start { return flight.fresh && i > 0 ? nil : held }
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
        if rest.standing == .tarp {
            // A rain delay: the field's empty under the tarp.
            tarp = Tarp(at: -Tarp.roll, out: true)
            return
        }
        for n in 1...9 { actors.append(Actor(team: .fielding, at: rest.spot(n), role: .fielder(n), crouch: n == 2)) }
        if let bats = rest.bats { actors.append(Actor(team: .batting, at: Ballpark.box(bats), role: .batter, bats: bats)) }
        for base in 1...3 where rest.bases[base - 1] { actors.append(Actor(team: .batting, at: Ballpark.lead(base))) }
        if case let .injury(hurt)? = rest.standing {
            // The trainer and the manager, out with him.
            let spot = Self.hurt(hurt)
            actors.append(Actor(team: hurt == .batter ? .batting : .fielding, at: CGPoint(x: spot.x + 4, y: spot.y - 2), role: .coach))
            actors.append(Actor(team: hurt == .batter ? .batting : .fielding, at: CGPoint(x: spot.x - 4, y: spot.y + 1), role: .coach))
        }
        // The plate umpire, last: every other figure keeps its place.
        actors.append(Actor(team: .official, at: Ballpark.umpire(rest.bats), role: .umpire))
        measureBodies()
    }

    /// The plate umpire's index (the last of the figures there at the start).
    var umpire: Int? { actors.lastIndex { $0.role == .umpire } }

    /// Where an injured man is down: by the plate, on the mound, or (MLB
    /// says only who) on the infield grass.
    static func hurt(_ hurt: PlayBeat.Hurt) -> CGPoint {
        switch hurt {
        case .batter: CGPoint(x: -5, y: 4)
        case .pitcher: CGPoint(x: 0, y: 55)
        case .elsewhere: CGPoint(x: 18, y: 70)
        }
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
        b.umpireCalls()
        b.finish()
        b.settle(rest)
        b.headline()
        b.measureStamp()
        b.shoot()
        self = b.script
        measureBodies()
    }

    /// Each figure's motion, measured once (`RigTrack`, an 8.5 ft figure),
    /// and what each faces when he isn't running somewhere: a fielder the
    /// batter until the ball's in play, then the ball until the play is
    /// over; the catcher his pitcher; the batter the plate; a runner the
    /// mound; anyone with the ball coming to him or leaving his hand, it.
    mutating func measureBodies() {
        let contact = (batted ?? watch).map { flights[$0].start }, settle = settle, script = self
        rig = actors.map { actor in
            RigTrack(from: 0, through: duration, height: 8.5, position: actor.position(at:)) { t in
                if let a = actor.actions.first(where: { t > $0.at - ($0.kind == .throwBall ? 0.5 : 0.45) && t < $0.at + 0.2 }) {
                    return RigFacing(point: a.toward)
                }
                switch actor.role {
                case .fielder(2): return RigFacing(point: Ballpark.rubber)
                case .fielder:
                    if let contact, t > contact + 0.05, t < settle, let ball = script.ball(at: t) { return RigFacing(point: ball.ground) }
                    return RigFacing(point: .zero)
                case .batter: return RigFacing(point: .zero)
                case .runner: return RigFacing(point: Ballpark.rubber)
                case .coach: return RigFacing(point: Ballpark.rubber)
                case .umpire:
                    // His call to where it's made; the ball while it's in play; else the pitcher.
                    if let call = actor.signals.first(where: { t > $0.at - 0.45 && t < $0.at + 1.0 }) { return RigFacing(point: call.toward) }
                    if let contact, t > contact + 0.05, t < settle, let ball = script.ball(at: t) { return RigFacing(point: ball.ground) }
                    return RigFacing(point: Ballpark.rubber)
                }
            }
        }
    }

    /// Assembles a script beat by beat.
    struct Builder {
        let scene: PlayScene
        var script = PlayScript()
        /// Actor index by the base a runner started from (0: the batter).
        var runner: [Int: Int] = [:]
        let batter: Int
        /// The plate umpire.
        let umpire: Int
        let hand: PlayScene.Hand
        /// The pitch leaves his hand after a 0.4 s delivery from the set,
        /// so the replay opens on the battery before anything flies.
        let pitchStart = 0.5
        /// When the pitch reaches the plate.
        let contact: Double
        /// An extra-base hit's batter reaches his base no sooner than this.
        var gathered: Double?
        /// The pitch as Statcast tracked it: its path, and when (seconds from
        /// its fit's start) it left the hand and crossed the front of the plate.
        let tracked: (pitch: Statcast.Pitch, release: Double, plate: Double)?
        /// Who handled the ball, as MLB's official scorer credited it (nil: infer it).
        let handling: PlayScene.Handling?
        /// Each run as it crosses the plate: the runner, and when.
        var crossings: [(actor: Int, at: Double)] = []
        /// When a throw got away (a runner waiting on it goes on).
        var loose: Double?

        init(scene: PlayScene) {
            // MLB's official account of the runners, where it has one.
            let scene = scene.official
            self.scene = scene
            handling = scene.handling
            hand = scene.bats ?? .right
            if let p = scene.measured?.pitch, let plate = p.plateTime, let release = p.time(at: Ballpark.release),
               release < plate, p.plate.y >= 0.3 {
                // Real time from the hand (a stride off the rubber) to the plate.
                tracked = (p, release, plate)
                contact = pitchStart + plate - release
            } else {
                tracked = nil
                // A 92 mph fastball reaches the plate in 0.42 s; slower pitches take longer.
                let mph = Double(scene.pitch?.mph ?? 91)
                contact = pitchStart + min(max(0.42 * 92 / mph, 0.34), 0.62)
            }
            // Where they waited for the pitch (the first baseman holding a runner on).
            let waiting = Rest(bases: scene.basesBefore)
            for n in 1...9 {
                script.actors.append(Actor(team: .fielding, at: waiting.spot(n), role: .fielder(n), crouch: n == 2))
            }
            // On a runner's play the batter is still in the box.
            batter = script.actors.count
            script.actors.append(Actor(team: .batting, at: Ballpark.box(hand), role: .batter, bats: hand))
            runner[0] = batter
            for r in scene.runners where r.from > 0 {
                runner[r.from] = script.actors.count
                script.actors.append(Actor(team: .batting, at: Ballpark.lead(r.from)))
            }
            umpire = script.actors.count
            script.actors.append(Actor(team: .official, at: Ballpark.umpire(hand), role: .umpire))
            // The pitch's type and speed, until the ball's in play: after that it's in the way.
            if scene.pitch?.mph != nil || scene.pitch?.code != nil { script.label = pitchStart...(contact + 0.45) }
        }

        func fielder(_ n: Int) -> Int { min(max(n, 1), 9) - 1 }

        // MARK: Pitch

        /// Where the pitch crosses the plate: Statcast's measurement, else
        /// ESPN's pitch coordinates (zone x 91…141, y 148…192), spread out so
        /// a ball off the plate reads.
        var plate: FieldPoint {
            if let tracked { return tracked.pitch.point(at: tracked.plate) }
            let x = ((scene.pitch?.x ?? 116) - 116) * 0.085
            let z = 3.4 - ((scene.pitch?.y ?? 170) - 148) * 0.045
            return FieldPoint(x: min(max(x, -6), 6), y: 0.5, z: min(max(z, 0.4), 5.5))
        }

        /// When a tracked pitch reaches the catcher's mitt, on past the
        /// plate (or where he picks it out of the dirt).
        var mittTime: Double? {
            guard let tracked, let at = tracked.pitch.time(at: -6.5) else { return nil }
            return min(at, tracked.pitch.time(atHeight: 0.3, after: tracked.plate) ?? at)
        }

        /// The catcher's mitt, where the pitch was.
        var mitt: FieldPoint {
            if let tracked, let at = mittTime { return tracked.pitch.point(at: at) }
            return FieldPoint(x: plate.x * 0.7, y: -6.5, z: max(plate.z * 0.8, 1))
        }

        /// Where the bat meets the ball: where the pitch crossed the plate
        /// when it's tracked, else in front of the plate.
        var contactPoint: FieldPoint { tracked == nil ? FieldPoint(x: hand == .left ? 1.5 : -1.5, y: 2, z: 3) : plate }

        mutating func pitch(to end: FieldPoint, at time: Double) {
            script.release = pitchStart
            script.flights.append(Flight(start: pitchStart, end: time, from: FieldPoint(x: 0, y: Ballpark.release, z: 6), to: end, arc: .arc(0.6)))
        }

        /// The tracked pitch, from the hand to the plate (and on into the
        /// catcher's mitt when he catches it): Statcast's path in real time.
        mutating func trackedPitch(intoMitt: Bool) {
            guard let tracked else { return }
            let end = intoMitt ? mittTime ?? tracked.plate : tracked.plate
            script.release = pitchStart
            script.flights.append(Flight(start: pitchStart, end: contact + end - tracked.plate, from: tracked.pitch.point(at: tracked.release),
                                         to: tracked.pitch.point(at: end), arc: .pitch(tracked.pitch, from: tracked.release, to: end)))
        }

        // MARK: Ball in play

        mutating func ballInPlay() {
            let trajectory = scene.flight
            var target = scene.spot.map(Ballpark.feet) ?? guessSpot()
            // Marked at the plate, though a fielder out in the field took it (an upstream glitch): where he plays.
            if atThePlate(target) { target = guessSpot() }
            // A ground ball an outfielder fielded, marked where it got through the infield: on to him.
            let through = self.through(target)
            if let through { target = through }
            let caught: Bool = switch scene.kind {
            case .flyOut, .lineOut, .popOut, .foulOut, .sacrificeFly: true
            case .doublePlay, .triplePlay: trajectory != .ground
            default: false
            }
            // Measured: the real flight, ending where it's caught, fielded or lands in the seats.
            let real = battedFlight(toward: target, caught: caught)
            if let end = real?.points.last { target = end.ground }
            let bearing = Ballpark.bearing(target), degrees = bearing * 180 / .pi
            let fence = Ballpark.fence(bearing)
            if real == nil, scene.kind == .homeRun {
                // Over the fence, into the first rows.
                target = Ballpark.polar(min(max(Double(scene.distance ?? 0), Ballpark.distance(target), fence + 24), fence + 60), degrees)
            } else if real == nil, Ballpark.distance(target) > fence - 7 {
                target = Ballpark.polar(fence - 7, degrees)
            }
            let distance = Ballpark.distance(target)

            if tracked != nil { trackedPitch(intoMitt: false) } else { pitch(to: contactPoint, at: contact) }
            script.actors[batter].swing = contact
            script.actors[batter].dropsBat = contact + 0.16
            script.flashes.append(Flash(beat: .contact, at: contact, point: contactPoint))

            // `land`: in the glove (caught or fielded on the ground), into the
            // seats, or a hit's first bounce; `reached`: a measured hit getting
            // to its fielder; `over`: a home run clearing the fence.
            let land: Double, to: FieldPoint
            var reached: Double?, over: Double?
            script.batted = script.flights.count
            if let real {
                // One pace from contact to glove: its speeds and slowing real, a little quicker.
                let end = contact + real.duration * Self.pace(real.duration)
                func replay(_ seconds: Double) -> Double { contact + seconds / max(real.duration, 0.01) * (end - contact) }
                to = real.points.last ?? FieldPoint(target)
                script.flights.append(Flight(start: contact, end: end, from: real.points.first ?? contactPoint, to: to, arc: .samples(real.points),
                                             hops: real.hops.map { $0 / max(real.duration, 0.01) }))
                land = caught || scene.kind == .homeRun || (trajectory == .ground && distance < 165) ? end : replay(real.touchdown)
                reached = end
                over = real.over.map(replay)
            } else {
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
                land = contact + time
                to = FieldPoint(target, z: caught ? (scene.effort == .diving ? 1.2 : 4.5) : 0)
                script.flights.append(Flight(start: contact, end: land, from: contactPoint, to: to, arc: arc, ease: ease))
                if scene.kind == .homeRun { over = contact + time * min(max((fence - 2) / max(distance, 1), 0), 1) }
            }

            let first = handling?.fielder ?? scene.fielders.first ?? scene.error ?? Ballpark.nearest(to: target)
            // Everyone else leans toward the ball.
            for n in 1...9 where n != first && n != 2 {
                let home = Ballpark.position(n)
                let dx = target.x - home.x, dy = target.y - home.y, d = hypot(dx, dy)
                guard d > 1 else { continue }
                let step = min(d * 0.08, 9)
                script.actors[fielder(n)].move(to: [CGPoint(x: home.x + dx / d * step, y: home.y + dy / d * step)],
                                               from: contact + 0.1, to: contact + 0.75, ease: .out)
            }
            if through != nil || handling?.deflection != nil { reachForIt(fielded: first) }

            if scene.kind == .homeRun {
                // The outfielder runs back to the track and watches it go.
                let track = Ballpark.polar(fence - 9, degrees)
                script.actors[fielder(Ballpark.nearest(to: track))].move(to: [track], from: contact + 0.1, to: land - 0.3, ease: .out)
                let over = over ?? land
                let p = script.flights[script.flights.count - 1].point(at: over)
                script.fence = Fence(at: over, point: FieldPoint(x: p.x, y: p.y, z: max(p.z, Ballpark.wallHeight + 4)))
                script.landing = Landing(point: target, mark: .homeRun, at: land, z: to.z)
                script.ballGone = land + 0.15
                script.stamp = over + 0.05
                // The trot: quicker than the game's, so the replay ends with him crossing the plate.
                runners(start: contact + 0.3, pace: 140, outs: [:])
                sequenceTrot(after: over + Self.trotCut, pace: 140)
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
                // A hit falls in; the fielder gets to it a beat later (a measured one where it hops to him,
                // one through the infield as it gets to him).
                held = reached ?? land + (through == nil ? 0.3 : 0)
                script.actors[f1].move(to: [target], from: contact + 0.1, to: held, ease: .out)
                script.actors[f1].act(.scoop, at: held, toward: .zero)
                script.landing = Landing(point: target, mark: .hit, at: reached ?? land)
            }
            if let effort = scene.effort { stretch(f1, effort, for: to, at: caught ? land : held) }

            let throwing = scene.text.contains("throwing error")
            // MLB's credits say who booted it, and every throw (one that got away too); else ESPN's text.
            if handling?.fumble != nil || (handling == nil && scene.error != nil && !throwing && scene.fielders.count <= 1) {
                // A fielding error: the ball gets away from him.
                let d = max(Ballpark.distance(target), 1)
                let loose = CGPoint(x: target.x + target.x / d * 18, y: target.y + target.y / d * 18)
                script.flights.append(Flight(start: held, end: held + 0.4, from: FieldPoint(target), to: FieldPoint(loose), arc: .bounce(2), ease: .out))
                script.actors[f1].move(to: [loose], from: held + 0.05, to: held + 0.65, ease: .out)
                holder = loose
                held += 0.65
            } else if handling == nil, throwing, scene.fielders.count <= 1 {
                // A throwing error: wide of first, and on into foul ground.
                script.actors[fielder(3)].move(to: [Ballpark.bag(1)], from: contact + 0.1, to: held)
                throwBall(from: holder, to: Ballpark.bag(1), at: held + 0.16, overshoot: true, by: first)
            }

            // The throws, to where the outs were made.
            let chain = throwChain(from: holder, holding: first, at: held, inferred: scene.fielders.isEmpty)
            holder = chain.holder
            held = chain.at

            if scene.runners.allSatisfy({ !$0.isOut }) && scene.error == nil && handling?.chain.isEmpty != false {
                if distance >= 165 {
                    // A hit to the outfield: the ball comes back in to the cutoff.
                    // (Not the man who went out for it.)
                    let relay = first == 6 ? 4 : first == 4 ? 6 : target.x < 0 ? 6 : 4
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
            // The rest of the story in order: the runs once the ball's been handled, then the batter's base.
            let lastOut = chain.outs.values.max()
            sequenceRuns(after: max(chain.at, lastOut ?? 0), pace: 95, before: scene.outsAfter >= 3 ? lastOut : nil)
        }

        /// Replay seconds a second of a measured flight takes: one pace for
        /// the whole flight, near real time for a grounder, quicker the longer
        /// it hangs (a 5 s fly plays in about 2).
        static func pace(_ seconds: Double) -> Double { min(0.82 * pow(max(seconds, 0.05), -0.42), 1) }

        /// The batted ball's real flight, when Statcast measured its launch:
        /// toward its spot, coming down at its measured distance (within this
        /// park's walls: a home run clears them, anything else stays in).
        func battedFlight(toward espnSpot: CGPoint, caught: Bool) -> BattedFlight? {
            guard let batted = scene.measured?.batted, let speed = batted.launchSpeed, let angle = batted.launchAngle else { return nil }
            var spot = batted.spot.map { Ballpark.feet(CGPoint(x: $0.x, y: $0.y)) } ?? espnSpot
            if atThePlate(spot) { spot = espnSpot }
            spot = through(spot) ?? spot
            let degrees = Ballpark.bearing(spot) * 180 / .pi, fence = Ballpark.fence(Ballpark.bearing(spot))
            let measured = batted.distance.map { Ballpark.polar($0, degrees) }
            if scene.kind == .homeRun {
                let landing = Ballpark.polar(max(batted.distance ?? Double(scene.distance ?? 0), fence + 18), degrees)
                return BattedFlight(speed: speed, angle: angle, from: contactPoint, landing: landing, end: .homeRun)
            }
            if caught {
                let at = Ballpark.polar(min(batted.distance ?? Ballpark.distance(spot), fence - 7), degrees)
                return BattedFlight(speed: speed, angle: angle, from: contactPoint, landing: at, end: .caught(height: 4.5))
            }
            if Ballpark.distance(spot) > fence - 7 { spot = Ballpark.polar(fence - 7, degrees) }
            return BattedFlight(speed: speed, angle: angle, from: contactPoint, landing: measured, end: .fielded(spot))
        }

        /// A spot for a ball in play ESPN didn't place: where the fielder named stands.
        func guessSpot() -> CGPoint {
            if let n = handling?.fielder ?? scene.fielders.first ?? scene.error {
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
            var steps: [(receiver: Int?, base: Int?, wild: Bool)] = []
            if receivers.count >= bases.count {
                let relays = receivers.count - bases.count
                steps = receivers.prefix(relays).map { ($0, nil, false) } + zip(receivers.suffix(bases.count), bases).map { ($0, $1, false) }
            } else {
                let missing = bases.count - receivers.count
                steps = bases.prefix(missing).map { (nil, $0, false) } + zip(receivers, bases.suffix(receivers.count)).map { ($0, $1, false) }
            }
            if scene.error != nil, !inferred, scene.text.contains("throwing error"), !steps.isEmpty { steps[steps.count - 1].wild = true }
            // MLB's credits name every throw: to whom, where, in the order of the outs, and the one that got away.
            if let handling { steps = handling.chain.map { ($0.to, $0.base, $0.wild) } }
            var holder = start, number = first, held = time + 0.16
            var outs: [Int: Double] = [:]
            for (i, step) in steps.enumerated() {
                guard let base = step.base else {
                    // A relay: the cutoff man lines up between the ball and the next base.
                    guard let r = step.receiver else { continue }
                    let next = steps[(i + 1)...].first { $0.base != nil }?.base ?? 2
                    let bag = Ballpark.bag(next)
                    var cutoff = CGPoint(x: holder.x + (bag.x - holder.x) * 0.45, y: holder.y + (bag.y - holder.y) * 0.45)
                    // A runner caught between bases (no ball in play): each man in the rundown takes it at his own
                    // bag, or chasing him off it toward the last one.
                    if !scene.inPlay, let own = [2: 0, 3: 1, 4: 2, 5: 3, 6: 2][r] {
                        let a = Ballpark.bag(own), b = Ballpark.bag(own == next ? own - 1 : own)
                        cutoff = CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
                    }
                    script.actors[fielder(r)].move(to: [cutoff], from: contact + 0.15, to: held)
                    let arrive = throwBall(from: holder, to: cutoff, at: held, by: number, catcher: r)
                    holder = cutoff; number = r; held = arrive + 0.1
                    continue
                }
                let bag = Ballpark.bag(base)
                let near = hypot(bag.x - holder.x, bag.y - holder.y) < 32
                if let receiver = step.receiver ?? (near ? nil : PlayScene.coverer(of: base, after: number)), receiver != number {
                    script.actors[fielder(receiver)].move(to: [bag], from: contact + 0.1, to: max(contact + 0.7, held - 0.05))
                    let arrive = throwBall(from: holder, to: bag, at: held, overshoot: step.wild, by: number, catcher: receiver)
                    if step.wild {
                        // Past him: whoever was waiting on it goes on.
                        loose = arrive - 0.1
                        continue
                    }
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
                if let waits = r.waits, let loose { onTheThrow(r, index: index, waits: waits, loose: loose, leave: leave, pace: pace) }
            }
        }

        // MARK: Strikeout, walk, runners

        /// When the pitch pops the catcher's mitt.
        var pop: Double { tracked.map { contact + (mittTime ?? $0.plate) - $0.plate } ?? contact + 0.05 }

        /// The pitch, all the way into the catcher's mitt.
        mutating func pitchToMitt() {
            if tracked != nil { trackedPitch(intoMitt: true) } else { pitch(to: mitt, at: pop) }
        }

        mutating func strikeout() {
            pitchToMitt()
            script.actors[fielder(2)].act(.glove, at: pop, toward: Ballpark.rubber)
            if scene.kind == .strikeout(looking: false) { script.actors[batter].swing = contact - 0.03 }
            // Strike three pops the mitt.
            script.flashes.append(Flash(beat: .catchBall, at: pop, point: mitt))
            script.flashes.append(Flash(beat: .out, at: pop + 0.03, point: FieldPoint(Ballpark.box(hand))))
            script.stamp = pop + 0.09
            script.actors[batter].vanish = contact + 0.75
            // A runner going on the pitch: strike him out, throw him out.
            let chain = throwChain(from: mitt.ground, holding: 2, at: pop, inferred: true)
            runners(start: pitchStart - 0.1, pace: 80, outs: chain.outs)
            droppedThirdStrike(outs: chain.outs)
        }

        mutating func walk() {
            if scene.kind == .hitByPitch {
                let at = FieldPoint(Ballpark.box(hand), z: 3)
                pitch(to: at, at: contact - 0.02)
                script.flights.append(Flight(start: contact - 0.02, end: contact + 0.35, from: at,
                                             to: FieldPoint(x: at.x * 0.4, y: 9), arc: .bounce(2), ease: .out))
                script.flashes.append(Flash(beat: .hitBatter, at: contact - 0.02, point: at))
            } else {
                pitchToMitt()
                script.actors[fielder(2)].act(.glove, at: pop, toward: Ballpark.rubber)
            }
            script.actors[batter].dropsBat = contact + 0.22
            script.stamp = contact + 0.3
            // A jog to first; the runners forced along with him.
            runners(start: contact + 0.3, pace: 62, outs: [:])
        }

        /// A steal, a pickoff, a wild pitch: the runners' play.
        mutating func runnersPlay() {
            // (A runner caught stealing on a pickoff: the pitcher's throw, as MLB credits it or the text says.)
            let pitched = scene.kind != .pickoff && scene.kind != .balk && handling?.fielder != 1 && !scene.text.contains("picked off")
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
            // (The runner who stole: with first and third on, the man on third may stay put.)
            if scene.kind == .stolenBase, let r = scene.runners.first(where: { r in
                if case let .base(b) = r.end { return r.from > 0 && b > r.from }
                return false
            }), case let .base(b) = r.end {
                // The throw, a beat behind him; one that got away (the text's throwing error) went to the
                // base he stole, and he goes on from there as it's past.
                let wild = b > r.from + 1 && scene.text.contains("throwing error")
                let stolen = wild ? r.from + 1 : b
                let bag = Ballpark.bag(stolen)
                script.actors[fielder(PlayScene.coverer(of: stolen, after: 2))].move(to: [bag], from: contact, to: contact + 0.6)
                let safe = leave + Double(stolen - r.from) * Ballpark.baseline / 85 + 0.12
                let past = throwBall(from: holder, to: bag, at: max(safe - throwTime(from: holder, to: bag), held + 0.1), overshoot: wild,
                                     by: holding, catcher: PlayScene.coverer(of: stolen, after: 2))
                if wild, let index = runner[r.from] { onTheThrow(r, index: index, waits: stolen, loose: past - 0.1, leave: leave, pace: 85) }
            }
        }

        // MARK: The umpire

        /// The plate umpire through the play: in his set behind the catcher
        /// as the pitch comes; strike three's call (the punch-out, looking);
        /// out from behind the plate on a ball in play, watching it; and at
        /// the plate for a play there, safe or out. A home run's trot and a
        /// run walked in aren't plays at the plate.
        mutating func umpireCalls() {
            let u = umpire
            if script.release != nil { script.actors[u].sets.append((pitchStart - 0.45)...((scene.inPlay ? contact : pop) + 0.25)) }
            switch scene.kind {
            case .strikeout(looking: true): script.actors[u].signals.append(Actor.Signal(kind: .punchOut, at: pop + 0.08))
            case .strikeout: script.actors[u].signals.append(Actor.Signal(kind: .swinging, at: pop + 0.1))
            default: break
            }
            // Out from behind the catcher, up the third-base side, to watch it.
            if scene.inPlay { script.actors[u].move(to: [CGPoint(x: -4.5, y: -5)], from: contact + 0.2, to: contact + 0.75, ease: .out) }
            switch scene.kind {
            case .homeRun, .walk, .hitByPitch: return
            default: break
            }
            let calls = script.flashes.filter { ($0.beat == .run || $0.beat == .out) && hypot($0.point.x, $0.point.y) < 3 }
            guard let first = calls.map(\.at).min() else { return }
            // Up the line to see it: the plate between him and the runner's path in.
            script.actors[u].move(to: [CGPoint(x: -7, y: -4)], from: max(first - 1.0, scene.inPlay ? contact + 0.3 : 0.2), to: first - 0.12,
                                  ease: .out)
            for call in calls {
                script.actors[u].signals.append(Actor.Signal(kind: call.beat == .run ? .safe : .out, at: call.at + 0.05, toward: .zero))
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
                // The runs on the mark land as the last one crosses.
                if let run = crossings.last?.at { script.stamp = max(script.stamp, run) }
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
            // The title is at most about a third of the view (it steps down when longer); Statcast's line under it, about as wide.
            let readout = scene.readout
            let title = min(Double(scene.title.count + (scene.kind == .homeRun && scene.distance != nil && readout == nil ? 9 : 0)) * 0.72 * 0.28, 3.4)
            let numbers = readout.map { min(Double($0.count) * 0.6 * 0.26, 4.4) } ?? 0
            let width = 0.055 + max(code, title, numbers) * 0.2
            script.corner = CGSize(width: width / CameraFrame.aspect + 0.03, height: readout == nil ? 0.3 : 0.36)
        }

        /// After the hold: fielders walk back, runners take their leads, the
        /// next batter steps in. At the end of a half-inning the teams change
        /// sides instead.
        mutating func settle(_ rest: Rest) {
            let s = script.settle
            var back = s + 0.8
            if rest.swapped {
                // The side that fielded jogs off to its dugout, the batters to theirs; the side that batted
                // comes out of its dugout and takes the field. A long way out (an outfielder's) is seen in
                // part: he's gone part way there, or comes into view part way out, at a jog.
                let leaving = Ballpark.dugout(home: !rest.fieldingHome), coming = Ballpark.dugout(home: rest.fieldingHome)
                let pace = 38.0, play = scene.id
                func stagger(_ i: Int) -> Double { Double(PlayBeat.seed("\(play).\(i)") % 40) / 100 }
                for i in script.actors.indices where script.actors[i].vanish > s && script.actors[i].team != .official {
                    let from = script.actors[i].position(at: s)
                    let to = script.actors[i].team == .fielding ? leaving : coming
                    let d = max(hypot(to.x - from.x, to.y - from.y), 1), jog = min(d / pace, 1.9), start = s + stagger(i)
                    let f = min(jog * pace / d, 1)
                    script.actors[i].move(to: [CGPoint(x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f)], from: start,
                                          to: start + jog, ease: .linear)
                    script.actors[i].vanish = min(script.actors[i].vanish, start + jog - Actor.fade)
                }
                var arrived = s
                for n in 1...9 {
                    let spot = rest.spot(n)
                    let d = max(hypot(spot.x - coming.x, spot.y - coming.y), 1), jog = min(d / pace, 2.1)
                    let f = max(1 - jog * pace / d, 0), start = s + 0.6 + stagger(n + 20)
                    let from = CGPoint(x: coming.x + (spot.x - coming.x) * f, y: coming.y + (spot.y - coming.y) * f)
                    var a = Actor(team: .batting, at: from, role: .fielder(n), appear: start - 0.1, crouch: n == 2)
                    a.move(to: [spot], from: start, to: start + jog, ease: .out)
                    script.actors.append(a)
                    arrived = max(arrived, start + jog)
                }
                for base in 1...3 where rest.bases[base - 1] {
                    script.actors.append(Actor(team: .fielding, at: Ballpark.lead(base), appear: arrived))
                }
                if let bats = rest.bats {
                    script.actors.append(Actor(team: .fielding, at: Ballpark.box(bats), role: .batter, appear: arrived, bats: bats))
                }
                back = arrived + 0.2
                // The umpire stays: back behind the plate.
                script.actors[umpire].move(to: [Ballpark.umpire(rest.bats)], from: s, to: s + 1.2)
            } else {
                for n in 1...9 { script.actors[fielder(n)].move(to: [rest.spot(n)], from: s, to: back) }
                script.actors[umpire].move(to: [Ballpark.umpire(rest.bats)], from: s, to: back)
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

// MARK: - The official account, told in order

extension PlayScript.Builder {
    /// A home run's trot is cut to this long after the ball clears the wall.
    static let trotCut = 0.8

    /// A ground ball an outfielder fielded (MLB's credit, else ESPN's text),
    /// marked short of the outfield grass: that's where it got through the
    /// infield, not where he picked it up. On along its line to where he
    /// meets it, charging in from where he plays. Nil for anything else.
    func through(_ spot: CGPoint) -> CGPoint? {
        guard scene.flight == .ground, let n = handling?.fielder ?? scene.fielders.first, (7...9).contains(n),
              hypot(spot.x - Ballpark.rubber.x, spot.y - Ballpark.rubber.y) < Ballpark.skin + 5 else { return nil }
        let d = max(Ballpark.distance(spot), 1), u = CGPoint(x: spot.x / d, y: spot.y / d)
        let home = Ballpark.position(n)
        // Level with him on its line, less the ground he makes up charging it.
        let meet = max(home.x * u.x + home.y * u.y - 50, d + 40)
        return CGPoint(x: u.x * meet, y: u.y * meet)
    }

    /// A spot at the plate for a ball someone out in the field took (not the
    /// pitcher or the catcher): a glitch upstream (ESPN's and MLB's alike).
    func atThePlate(_ spot: CGPoint) -> Bool {
        guard let n = handling?.fielder ?? scene.fielders.first else { return false }
        return Ballpark.distance(spot) < 12 && n > 2
    }

    /// A ground ball through the infield: the infielders it gets between
    /// reach for it as it goes by, and miss; the one MLB credits with a
    /// deflection gets a glove on it. (How far each goes is inferred: MLB
    /// says only who fielded it, and who it glanced off.)
    mutating func reachForIt(fielded first: Int) {
        guard let index = script.batted else { return }
        let flight = script.flights[index]
        for n in [1, 3, 4, 5, 6] where n != first {
            let home = Ballpark.position(n)
            // Where and when it passes nearest him, low enough to reach.
            var near = (at: flight.end, d: Double.infinity, p: CGPoint.zero)
            for k in 0...80 {
                let t = flight.start + (flight.end - flight.start) * Double(k) / 80, p = flight.point(at: t)
                let d = hypot(p.x - home.x, p.y - home.y)
                if p.z < 6, d < near.d { near = (t, d, p.ground) }
            }
            // As far as he can get before it's by (about 28 ft a second), and near enough to try.
            let glances = n == handling?.deflection, steps = max(near.at - contact - 0.1, 0) * 28
            guard glances || (near.d < 32 && near.d - steps < 10) else { continue }
            // A few quick steps (all the way, for the man it glances off), the glove down as it goes by.
            let reach = glances ? 1 : min(max(1 - 6 / max(near.d, 1), 0), 0.8, steps / max(near.d, 1))
            let spot = CGPoint(x: home.x + (near.p.x - home.x) * reach, y: home.y + (near.p.y - home.y) * reach)
            script.actors[fielder(n)].move(to: [spot], from: contact + 0.06, to: near.at, ease: .out)
            script.actors[fielder(n)].act(.scoop, at: near.at, toward: near.p)
        }
    }

    /// A catch the scorer's text calls diving or leaping: his last strides
    /// at full stretch, the glove to the ball low on the grass or up over
    /// his head (`Actor.dive`, for the figures to draw; until they do, a
    /// lunge stands in for a dive).
    mutating func stretch(_ index: Int, _ effort: PlayScene.Effort, for ball: FieldPoint, at time: Double) {
        let from = script.actors[index].position(at: time - 0.3)
        let d = hypot(ball.x - from.x, ball.y - from.y)
        let diving = effort == .diving
        let landing = diving && d > 1 ? CGPoint(x: ball.x + (ball.x - from.x) / d * 4, y: ball.y + (ball.y - from.y) / d * 4) : ball.ground
        let glove = FieldPoint(ball.ground, z: diving ? min(ball.z, 1.5) : max(ball.z, 8.5))
        script.actors[index].dive = PlayScript.Actor.Dive(start: time - 0.3, reach: time, target: glove, landing: landing)
        guard diving else { return }
        script.actors[index].actions.removeAll { abs($0.at - time) < 0.01 }
        script.actors[index].act(.scoop, at: time, toward: ball.ground)
        script.actors[index].move(to: [landing], from: time, to: time + 0.3, ease: .out)
    }

    /// The rest of the play in the order a replay tells it: once the ball's
    /// been handled (fielded, thrown, the outs made), each run crosses the
    /// plate, the lead runner first, a beat apart; then the batter takes his
    /// extra base. Runners leave as the play has them; one who'd be home
    /// sooner (off screen, while the camera's on the ball) is held at third
    /// first. A run beats a third out, though: after one it wouldn't count.
    mutating func sequenceRuns(after told: Double, pace: Double, before third: Double?) {
        var last = -Double.infinity, clear = -Double.infinity
        for r in scene.runners.filter({ $0.end == .scored }).sorted(by: { $0.from > $1.from }) {
            guard let index = runner[r.from], let leave = script.actors[index].moves.first?.start,
                  let natural = script.actors[index].moves.last?.end else { continue }
            let cross = third == nil ? max(natural, told + 0.55, last + 0.6) : natural
            if cross > natural + 0.01 {
                // Held at third, unless the man ahead is still there when he'd get to it.
                let atThird = leave + Double(3 - min(r.from, 3)) * Ballpark.baseline / pace
                holdThenRun(index, from: r.from, hold: atThird > clear + 0.1 ? 3 : 2, arrive: cross, was: natural, pace: pace)
            }
            crossings.append((index, cross))
            last = cross
            clear = cross - Ballpark.baseline / pace
        }
        // The batter into second or third once they're in, while he's still running it.
        guard let last = crossings.last?.at, case let .base(b)? = scene.batter?.end, b >= 2, scene.batter?.waits == nil,
              let move = script.actors[batter].moves.last, move.path.last == Ballpark.base(b), move.end < last + 0.45 else { return }
        let arrive = last + 0.45
        guard Double(b) * Ballpark.baseline / (arrive - move.start) >= 50 else { return }
        script.actors[batter].move(to: basePath(from: 0, to: b), from: move.start, to: arrive)
        if script.actors[batter].slide != nil { script.actors[batter].slide = arrive - 0.26 }
    }

    /// A home run's trot as the replay tells it: the runners watch it go,
    /// then come in ahead of the batter, a beat apart, once the camera has
    /// cut to the trot (so it sees every run cross); the batter last.
    mutating func sequenceTrot(after cut: Double, pace: Double) {
        var last = -Double.infinity
        let order = scene.runners.filter { $0.end == .scored }.sorted { a, b in a.from == 0 ? false : b.from == 0 ? true : a.from > b.from }
        for (k, r) in order.enumerated() {
            guard let index = runner[r.from], let move = script.actors[index].moves.last else { continue }
            let natural = move.end
            let cross = max(natural, cut + 0.1 + 0.4 * Double(k), last + 0.4)
            if cross > natural + 0.01 {
                if r.from == 0 {
                    // The batter: the same trot, a little slower.
                    script.actors[index].move(to: basePath(from: 0, to: 4), from: move.start, to: cross)
                    retime(index, from: natural, to: cross)
                } else {
                    holdThenRun(index, from: r.from, hold: nil, arrive: cross, was: natural, pace: pace)
                }
            }
            crossings.append((index, cross))
            last = cross
        }
    }

    /// A runner who scores later than his pace would have him. On a ball in
    /// play he runs on as far as `hold` (third, or second while the man
    /// ahead is still on third) and is held there until he must go (from
    /// his own base, a couple of shuffles off it first); on a home run
    /// (`hold` nil) he watches it from his base, then trots. Either way he
    /// crosses at `arrive`, and the plate's pop moves with him.
    mutating func holdThenRun(_ index: Int, from base: Int, hold: Int?, arrive: Double, was natural: Double, pace: Double) {
        guard let leave = script.actors[index].moves.first?.start else { return }
        let at = script.actors[index].at, stop = max(hold ?? base, base)
        let reach = leave + Double(stop - base) * Ballpark.baseline / pace
        let go = max(arrive - Double(4 - stop) * Ballpark.baseline / pace, reach)
        script.actors[index].moves.removeAll()
        if stop > base {
            script.actors[index].move(to: basePath(from: base, to: stop), from: leave, to: reach)
        } else if hold != nil, go > leave + 0.3 {
            let next = Ballpark.base(base + 1), d = hypot(next.x - at.x, next.y - at.y)
            if d > 12 {
                script.actors[index].move(to: [CGPoint(x: at.x + (next.x - at.x) / d * 8, y: at.y + (next.y - at.y) / d * 8)],
                                          from: leave, to: min(leave + 0.5, go), ease: .out)
            }
        }
        script.actors[index].move(to: basePath(from: stop, to: 4), from: go, to: arrive)
        retime(index, from: natural, to: arrive)
    }

    /// Strike three that got away from the catcher (MLB credits his throw
    /// to first): the batter drops the bat and runs for it once the pitch is
    /// by, out a step behind the throw (or safe at first, when he beat it).
    mutating func droppedThirdStrike(outs: [Int: Double]) {
        guard let r = scene.batter else { return }
        let base: Int
        switch r.end {
        case let .out(at?) where at > 0: base = at
        case let .base(b) where b > 0: base = b
        default: return
        }
        let arrive = max((outs[base] ?? pop + 1.0) + 0.1, pop + 0.7)
        script.actors[batter].moves.removeAll()
        script.actors[batter].move(to: basePath(from: 0, to: base), from: pop + 0.12, to: arrive)
        script.actors[batter].dropsBat = pop + 0.12
        script.actors[batter].vanish = r.isOut ? arrive + 0.25 : .infinity
        // Not out at the plate after all.
        let box = Ballpark.box(hand)
        script.flashes.removeAll { $0.beat == .out && $0.point.ground == box }
    }

    /// A run's moment moved: the plate's pop, and when he's gone.
    mutating func retime(_ index: Int, from natural: Double, to cross: Double) {
        if let i = script.flashes.firstIndex(where: { $0.beat == .run && abs($0.at - natural) < 0.001 }) { script.flashes[i].at = cross }
        script.actors[index].vanish = cross + 0.15
    }

    /// MLB's account of a runner who took his last base on a throw that got
    /// away (or went elsewhere): he gets to the base before it, waits, and
    /// goes on as the ball gets past.
    mutating func onTheThrow(_ r: PlayScene.Runner, index: Int, waits: Int, loose: Double, leave: Double, pace: Double) {
        let end: Int
        switch r.end {
        case let .base(b): end = b
        case .scored: end = 4
        default: return
        }
        guard waits > r.from || r.from == 0, waits < end else { return }
        let reach = leave + Double(waits - r.from) * Ballpark.baseline / pace
        let go = max(loose, reach + 0.1), arrive = go + Double(end - waits) * Ballpark.baseline / pace
        let natural = script.actors[index].moves.last?.end ?? arrive
        script.actors[index].moves.removeAll()
        script.actors[index].move(to: basePath(from: r.from, to: waits), from: leave, to: reach)
        script.actors[index].move(to: basePath(from: waits, to: end), from: go, to: arrive)
        if end == 4 { retime(index, from: natural, to: arrive) }
        if script.actors[index].slide != nil { script.actors[index].slide = arrive - 0.26 }
    }
}

// MARK: - Measured flights

extension Statcast.Pitch {
    /// Where it is in the field's frame, which is Statcast's own: feet from
    /// the plate's point, x toward first base (the catcher's right), y out
    /// toward the mound, z up.
    func point(at t: Double) -> FieldPoint {
        let p = position(at: t)
        return FieldPoint(x: p.x, y: p.y, z: p.z)
    }

    /// When it's `y` feet from the plate's point on its way in: before its
    /// fit's start for the hand (Statcast starts it at 50 ft), past the plate for the mitt.
    func time(at y: Double) -> Double? {
        let a = acceleration.y / 2, b = velocity.y, c = release.y - y
        guard a != 0 else { return b == 0 ? nil : -c / b }
        let d = b * b - 4 * a * c
        guard d >= 0 else { return nil }
        return [(-b - d.squareRoot()) / (2 * a), (-b + d.squareRoot()) / (2 * a)].first { velocity.y + acceleration.y * $0 < 0 }
    }

    /// When it first drops to `height` feet after `t` (a pitch in the dirt), if it does.
    func time(atHeight height: Double, after t: Double) -> Double? {
        let a = acceleration.z / 2, b = velocity.z, c = release.z - height
        let d = b * b - 4 * a * c
        guard a != 0, d >= 0 else { return nil }
        return [(-b - d.squareRoot()) / (2 * a), (-b + d.squareRoot()) / (2 * a)].filter { $0 > t }.min()
    }
}

/// A batted ball's real flight, from Statcast's launch: off the bat at its
/// exit velocity and launch angle, toward its spot, under gravity, air drag
/// and the lift of its backspin. Each ball's drag is calibrated (bisected
/// once, when the script is built) so it comes down where MLB measured it:
/// caught where it was caught; a hit, or a grounder's first hop, landing at
/// its distance and hopping on to its fielder; a drive off the wall back to
/// him; a home run into the seats. The lift is fixed (about a fly ball's), so
/// hang times come out real: a 105 mph fly at 28° carries 400 ft in about
/// 5 s, a liner is on its fielder in under 2, a pop-up hangs for 5. Sampled
/// every 1/120 s of the game's time; drawing reads the samples.
struct BattedFlight: Equatable {
    enum End: Equatable {
        /// In a glove this high (feet) where it comes down.
        case caught(height: Double)
        /// On along the ground after it lands, to where it was fielded.
        case fielded(CGPoint)
        /// Over the fence and into the seats.
        case homeRun
    }

    /// A moment of the flight in its own upright plane: feet along the
    /// ground and up, and their speeds (feet a second).
    struct State: Equatable {
        var s: Double
        var z: Double
        var vs: Double
        var vz: Double
    }

    /// The game's seconds between samples.
    static let step = 1.0 / 120
    static let gravity = 32.174
    /// Drag, as k in a deceleration of k·v² (per foot): a baseball's is
    /// about 0.0022 (what it meets once it's down). The calibration stays in
    /// this range and stretches the path for whatever's left (nothing, for a real ball).
    static let drag = 0.0004...0.006, airDrag = 0.0022
    /// Lift, as k·v² square to the flight: a fly ball's backspin (a lift
    /// coefficient near 0.16), fading out for a ball driven into the ground.
    static func lift(_ degrees: Double) -> Double { 0.0009 * min(max(degrees / 15, 0), 1) }
    /// Off the ground: how much of its vertical speed a hop keeps; the grip
    /// of a bounce (pace lost in proportion to the vertical speed it turns
    /// round: a chopper slows, a skipping liner hardly); a roll's friction (ft/s²).
    static let restitution = 0.45, scuff = 0.35, friction = 3.0

    /// The ball every `step` from contact.
    let points: [FieldPoint]
    /// Seconds from contact: when it first touches the grass (or is caught,
    /// or lands in the seats), and every touchdown, that one included.
    let touchdown: Double
    let hops: [Double]
    /// A home run's moment over the fence.
    let over: Double?

    var duration: Double { Double(max(points.count - 1, 0)) * Self.step }

    /// `speed` (mph) and `angle` (degrees) off the bat at `contact`, coming
    /// down at `landing` (caught there, a home run's spot on the field's
    /// level, a hit's first bounce; nil: wherever an average ball's drag
    /// brings it, toward its spot).
    init(speed: Double, angle: Double, from contact: FieldPoint, landing: CGPoint?, end: End) {
        var spot: CGPoint?
        if case let .fielded(p) = end { spot = p }
        let aim = landing ?? spot ?? CGPoint(x: 0, y: 200)
        let reach = max(hypot(aim.x - contact.x, aim.y - contact.y), 1)
        let u = CGPoint(x: (aim.x - contact.x) / reach, y: (aim.y - contact.y) / reach)
        let v0 = speed * 5280 / 3600, a = min(angle, 88) * .pi / 180, lift = Self.lift(angle)
        let start = State(s: 0, z: max(contact.z, 0.3), vs: v0 * cos(a), vz: v0 * sin(a))
        func field(_ s: Double, _ z: Double) -> FieldPoint { FieldPoint(x: contact.x + u.x * s, y: contact.y + u.y * s, z: max(z, 0)) }
        // This park's fence, in feet along the flight.
        let fence = Ballpark.fence(Ballpark.bearing(aim)) - (contact.x * u.x + contact.y * u.y)
        var floor = 0.0
        if case let .caught(height) = end {
            // A liner caught at his shoetops comes down only that far.
            floor = min(height, max(start.z + pow(max(start.vz, 0), 2) / (2 * Self.gravity) - 0.75, 0.3))
        }
        // Where it comes down: a home run far enough out to clear this park's
        // fence; a drive that would land past it hits the wall instead.
        var goal: Double? = landing == nil ? nil : reach
        var offWall = false
        switch end {
        case .homeRun: goal = max(goal ?? 0, fence + 18)
        case .caught: break
        case .fielded: if let g = goal, g > fence - 3 { offWall = true; goal = min(g, fence + 6) }
        }
        var drag = Self.airDrag, stretch = 1.0
        if let g = goal {
            (drag, stretch) = Self.calibrate(start, lift: lift, floor: floor, to: g)
            // Over the wall's top, not through it.
            var clear = g
            while end == .homeRun, clear < fence + 80, Self.height(start, drag: drag, lift: lift, at: fence / stretch) < Ballpark.wallHeight + 3 {
                clear += 8
                (drag, stretch) = Self.calibrate(start, lift: lift, floor: floor, to: clear)
            }
        }
        // Fielded before it came down: it ends at the glove.
        let fieldedAt = spot.map { hypot($0.x - contact.x, $0.y - contact.y) }.flatMap { s in !offWall && s < (goal ?? .infinity) - 2 ? s : nil }
        let air = Self.fly(start, drag: drag, lift: lift, floor: floor, until: (offWall ? fence - 1 : fieldedAt ?? .infinity) / stretch, record: true)
        var points = air.path.map { field($0.s * stretch, $0.z) }
        var hops: [Double] = []
        var over: Double?

        switch end {
        case .caught:
            break
        case .homeRun:
            // Over the fence, then down into the seats.
            func beyond(_ p: FieldPoint) -> Double { Ballpark.distance(p.ground) - Ballpark.fence(Ballpark.bearing(p.ground)) }
            if let cut = points.firstIndex(where: { beyond($0) > 0 && $0.z <= Self.seats(beyond($0)) }) {
                points = Array(points.prefix(cut + 1))
                points[cut].z = Self.seats(beyond(points[cut]))
            }
            over = points.firstIndex { beyond($0) >= 0 }.map { Double($0) * Self.step }
        case let .fielded(spot):
            guard air.landed || offWall else { break }
            var down = air.end
            down.s *= stretch
            if !air.landed {
                // Off the wall: back off it, and down.
                let carom = Self.fly(State(s: down.s, z: down.z, vs: -0.45 * down.vs, vz: 0.6 * down.vz), drag: drag, lift: 0, floor: 0, record: true)
                points += carom.path.dropFirst().map { field($0.s, $0.z) }
                down = carom.end
            }
            hops.append(Double(points.count - 1) * Self.step)
            // On along the ground to the fielder.
            let at = field(down.s, 0).ground
            let length = hypot(spot.x - at.x, spot.y - at.y)
            guard length > 1 else { break }
            let w = CGPoint(x: (spot.x - at.x) / length, y: (spot.y - at.y) / length)
            let ground = Self.along(speed: abs(down.vs), sink: min(down.vz, 0), length: length)
            let first = points.count - 1
            points += ground.path.dropFirst().map { FieldPoint(x: at.x + w.x * $0.s, y: at.y + w.y * $0.s, z: $0.z) }
            hops += ground.hops.map { Double(first + $0) * Self.step }
        }
        self.points = points
        touchdown = hops.first ?? Double(points.count - 1) * Self.step
        self.hops = hops
        self.over = over
    }

    func point(at seconds: Double) -> FieldPoint {
        guard points.count > 1 else { return points.first ?? FieldPoint(x: 0, y: 0) }
        let i = min(max(seconds / Self.step, 0), Double(points.count - 1))
        let lower = min(Int(i), points.count - 2), f = i - Double(lower)
        let p = points[lower], q = points[lower + 1]
        return FieldPoint(x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, z: p.z + (q.z - p.z) * f)
    }

    /// The seats' height this far past the fence (the stands the field draws).
    static func seats(_ beyond: Double) -> Double {
        beyond < 6 ? Ballpark.wallHeight + beyond / 3 : min(Ballpark.wallHeight + 2 + (beyond - 6) / 2, 44)
    }

    // MARK: Simulation

    /// One step (1/120 s), midpoint: gravity, drag against the flight, lift square to it.
    static func advance(_ p: State, drag k: Double, lift l: Double) -> State {
        let dt = step
        var v = (p.vs * p.vs + p.vz * p.vz).squareRoot()
        let ms = p.vs + (-k * v * p.vs - l * v * p.vz) * dt / 2, mz = p.vz + (-gravity - k * v * p.vz + l * v * p.vs) * dt / 2
        v = (ms * ms + mz * mz).squareRoot()
        return State(s: p.s + ms * dt, z: p.z + mz * dt, vs: p.vs + (-k * v * ms - l * v * mz) * dt,
                     vz: p.vz + (-gravity - k * v * mz + l * v * ms) * dt)
    }

    /// Part of the way from one moment to the next.
    static func between(_ p: State, _ q: State, _ f: Double) -> State {
        State(s: p.s + (q.s - p.s) * f, z: p.z + (q.z - p.z) * f, vs: p.vs + (q.vs - p.vs) * f, vz: p.vz + (q.vz - p.vz) * f)
    }

    /// Through the air until it comes down through `floor`, reaches `until`
    /// feet along, or 12 s pass: every step on the way when `record`ed, where
    /// it ended, and whether that was coming down.
    static func fly(_ start: State, drag k: Double, lift l: Double, floor: Double, until limit: Double = .infinity,
                    record: Bool) -> (path: [State], end: State, landed: Bool) {
        var p = start, path: [State] = []
        if record {
            path.reserveCapacity(720)
            path.append(start)
        }
        for _ in 0..<12 * 120 {
            let q = advance(p, drag: k, lift: l)
            if q.vz < 0, q.z <= floor, p.z > floor {
                let end = between(p, q, (p.z - floor) / (p.z - q.z))
                if record { path.append(end) }
                return (path, end, true)
            }
            if q.s >= limit {
                let end = between(p, q, (limit - p.s) / max(q.s - p.s, 1e-9))
                if record { path.append(end) }
                return (path, end, false)
            }
            p = q
            if record { path.append(p) }
        }
        return (path, p, false)
    }

    /// Its height `s` feet along.
    static func height(_ start: State, drag k: Double, lift l: Double, at s: Double) -> Double {
        fly(start, drag: k, lift: l, floor: -.infinity, until: s, record: false).end.z
    }

    /// The drag that brings it down `goal` feet along (false position, a
    /// few flights), and the stretch that makes up the last inches, or
    /// whatever the drag's range can't.
    static func calibrate(_ start: State, lift l: Double, floor: Double, to goal: Double) -> (drag: Double, stretch: Double) {
        func reach(_ k: Double) -> Double { max(fly(start, drag: k, lift: l, floor: floor, record: false).end.s, 0.1) }
        var low = drag.lowerBound, high = drag.upperBound
        var far = reach(low), near = reach(high)
        if goal >= far { return (low, goal / far) }
        if goal <= near { return (high, goal / near) }
        var k = airDrag, r = reach(k), side = 0
        for _ in 0..<8 where abs(r - goal) > 0.1 {
            if r > goal { (low, far) = (k, r) } else { (high, near) = (k, r) }
            // Illinois: an end kept twice running counts half, so neither stalls.
            let lean = r > goal ? 1 : -1
            if side == lean { if lean > 0 { near = goal + (near - goal) / 2 } else { far = goal + (far - goal) / 2 } }
            side = lean
            k = low + (far - goal) / (far - near) * (high - low)
            r = reach(k)
        }
        return (k, goal / r)
    }

    /// Along the ground from where it came down, `length` feet to its
    /// fielder: hops, each lower and a little slower, then a roll. A ball
    /// that would stop short (a dribbler the fielder charged) rolls on with
    /// less friction, as far as it must. Every step, and the hops' steps.
    static func along(speed: Double, sink: Double, length: Double) -> (path: [(s: Double, z: Double)], hops: [Int]) {
        if run(speed, sink, grip: 1, to: length, record: false).reached {
            let r = run(speed, sink, grip: 1, to: length, record: true)
            return (r.path, r.hops)
        }
        // It would stop short: less friction, so it would roll a little past him.
        var low = 0.0, high = 1.0
        for _ in 0..<12 {
            let grip = (low + high) / 2
            if run(speed, sink, grip: grip, to: .infinity, record: false).s > length * 1.15 { low = grip } else { high = grip }
        }
        let r = run(speed, sink, grip: low, to: length, record: true)
        guard !r.reached, let last = r.path.last, last.s > 0 else { return (r.path, r.hops) }
        // Not even then (a very soft ball, a long way): the same roll, drawn out to him.
        return (r.path.map { ($0.s * length / last.s, $0.z) }, r.hops)
    }

    /// The ground's part of a flight with friction scaled by `grip`, to `end`
    /// feet on or until it stops (10 s at most).
    static func run(_ speed: Double, _ sink: Double, grip: Double, to end: Double,
                    record: Bool) -> (path: [(s: Double, z: Double)], hops: [Int], reached: Bool, s: Double) {
        let dt = step, k = airDrag
        var s = 0.0, z = 0.0, v = speed, vz = 0.0, rolling = false, landing = sink
        var path: [(s: Double, z: Double)] = record ? [(0, 0)] : [], hops: [Int] = []
        for n in 1...10 * 120 {
            if landing < 0 {
                // A bounce: up again at a fraction of its sink, its pace scuffed in proportion.
                let up = -landing * restitution
                v = max(v - grip * scuff * (up - landing), v * 0.5)
                if up < 2.5 { rolling = true; vz = 0 } else { vz = up }
                if n > 1, !rolling { hops.append(n - 1) }
                landing = 0
            }
            if rolling {
                v = max(v - (friction * grip + k * v * v) * dt, 0)
            } else {
                v = max(v - k * v * v * dt, 0)
                z += vz * dt - gravity * dt * dt / 2
                vz -= gravity * dt
                if z <= 0 { z = 0; landing = vz }
            }
            if s + v * dt >= end {
                if record { path.append((end, z)) }
                return (path, hops, true, end)
            }
            s += v * dt
            if record { path.append((s, z)) }
            if rolling, v < 0.5 { break }
        }
        return (path, hops, false, s)
    }
}
