import SwiftUI

// The basketball theater's choreography: a `BasketballScene` turned into ten
// players' paths, the ball's passes, dribbles and flights, the jumps, the
// beats (the catch, the block, the steal), the net and the rim, and the
// camera's shots, in feet and seconds from the start of the replay. Built
// once per play; any frame is a pure function of the script and t, so the
// harness can draw t = 2.1 without playing 0…2.1, and the tests can check
// that a three leaves the shooter's hand where ESPN put him and drops
// through the net.
//
// The court is seen from a high sideline, turned a third of the way round so
// the half court reads in depth: x along the court (0 to 94), y across it
// from the near sideline, z up. Every play is laid out in its own frame, the
// offense attacking the basket at x = 88.75; a play at the left basket is
// drawn turned half a turn (`Hoops.yaw`), so each team attacks the basket it
// attacks on TV (`HoopsDirection`: the visitors at the right in the first
// half by default, the ends swapped at halftime, the viewer's turn on top),
// the basket in play always the one up the court.
// Figures are true to the rim (7 ft against its 10), so a dunk is a real
// leap; an honest parabola carries every shot, timed by gravity.
//
// Time is a replay's: half a second on the set, then the play at about game
// speed (a three's flight 1.2 s), the stamp a beat after the net, and the
// court holds the end until the camera settles.

// MARK: - The court

enum Hoops {
    static let length = 94.0
    static let width = 50.0
    /// The rim the offense attacks: its center 15 in off the backboard, which
    /// stands 4 ft in from the baseline.
    static let rim = CGPoint(x: 88.75, y: 25)
    static let rimHeight = 10.0
    static let rimRadius = 0.75
    static let board = 90.0
    static let boardBottom = 9.5
    static let boardTop = 13.0
    /// The lane: 16 ft wide, the free-throw line 19 ft from the baseline.
    static let lane = 8.0
    static let freeThrow = 75.0
    /// The three-point line: 23 ft 9 in round the rim, 22 ft along the corners
    /// for the first 14 ft (the WNBA's arc is 22 ft 1¾ in; the court's
    /// markings take it as a parameter).
    static let three = 23.75
    static let corner = 22.0
    /// A player as drawn, against the 10 ft rim: true to it, a touch tall.
    static let height = 7.0
    /// His height on the ground's scale (the rig strides in it): heights are
    /// drawn at 0.82 of the ground's feet.
    static let ground = height * 0.82
    /// Body units per foot of height (a jump's lift).
    static let lift = 1.1 / height
    /// The camera's yaw: the court turned a third of the way round.
    static let turn = 30.0 * .pi / 180
    /// The closest the camera comes (feet top to bottom): a shooter and the rim.
    static let tightest = 24.0

    /// The view's turn for the team on offense: the top team's basket up and
    /// to the right; the bottom team's, half a turn round, up and to the left
    /// (the same court from the same sideline). The whole-game convention
    /// (the shot chart's); a live play takes its end from `yaw(right:)`.
    static func yaw(_ offense: GameDetail.Side?) -> Double { yaw(right: offense != .bottom) }

    /// The view's turn for a play at the right basket (up and to the right),
    /// or at the left (half a turn round, up and to the left).
    static func yaw(right: Bool) -> Double { right ? -turn : turn + .pi }

    /// ESPN's half-court feet toward the offense's basket, in the play's frame.
    static func court(_ p: CGPoint) -> CGPoint { CGPoint(x: board - p.y, y: width - p.x) }

    /// ESPN's half-court feet toward the other basket (a steal's: the team
    /// that lost it was going that way), in the play's frame.
    static func otherEnd(_ p: CGPoint) -> CGPoint { CGPoint(x: length - board + p.y, y: p.x) }

    /// The room the camera keeps round a spot, in projected feet: a figure's
    /// height and a jump above it, a ball a little.
    static func room(_ p: FieldPoint, figure: Bool, yaw: Double) -> CGRect {
        let v = Gridiron.view(p.ground, yaw: yaw)
        let x = v.x, y = v.y * 0.5 + p.z * 0.82
        let below = figure ? 2.0 : 2.5, above = figure ? 7.5 : 2.5
        return CGRect(x: x - 4, y: y - below, width: 8, height: below + above)
    }
}

/// The court through the camera: the ballpark's dimetric projection, turned
/// by the yaw, with figures true to the rim.
struct HoopProjection {
    let f: FieldProjection
    let yaw: Double
    /// A player standing, in points.
    let figure: CGFloat

    init(size: CGSize, camera: CameraFrame, yaw: Double) {
        f = FieldProjection(size: size, camera: camera)
        self.yaw = yaw
        figure = max(CGFloat(Hoops.ground) * f.scale, 7)
    }

    func point(_ p: CGPoint, z: Double = 0) -> CGPoint { f.point(Gridiron.view(p, yaw: yaw), z: z) }
    func point(_ p: FieldPoint) -> CGPoint { point(p.ground, z: p.z) }

    /// Depth into the view (further is larger): what's drawn first.
    func depth(_ p: CGPoint) -> Double { Gridiron.view(p, yaw: yaw).y }

    var size: CGSize { f.size }
    var scale: CGFloat { f.scale }
    var bounds: Path { f.bounds }
}

extension RigLens {
    /// The court's lens: the gridiron's dimetric view at the hoops' figure height.
    init(_ h: HoopProjection, at p: CGPoint) {
        let s = Double(h.figure) / 1.1, c = cos(h.yaw), n = sin(h.yaw)
        origin = h.point(p)
        x = CGVector(dx: c * s, dy: 0.5 * n * s)
        y = CGVector(dx: n * s, dy: -0.5 * c * s)
        z = CGVector(dx: 0, dy: -s)
        unit = Double(h.scale) / s
        view = RigVector(-n * 0.866, c * 0.866, -0.5)
        height = h.figure
    }
}

// MARK: - Script

struct BasketballScript: Equatable {
    /// The two fives, and the referee who comes in to make a call.
    enum Team { case offense, defense, official }

    /// A moment of the play in his hands (or reaching for it).
    struct Action: Equatable {
        enum Kind: Equatable {
            case catchBall, pass, lob, shoot, layup, dunk, hook, tip, contest, block, steal, rebound, boxOut
            /// The lighter beats: a hand on a man (a foul), knocked down (a
            /// charge), a referee's signals, a jump ball's toss, waiting.
            case reach, fall, signal, point, toss, hips
        }
        var kind: Kind
        var at: Double
        /// What he turns to face: the rim, the man he passes to.
        var toward: CGPoint
    }

    /// Off the floor: takeoff, the top (held `hang` seconds: a dunk's grip on
    /// the rim), landing; how high his feet get, in feet.
    struct Jump: Equatable {
        var from: Double
        var peak: Double
        var until: Double
        var height: Double
        var hang = 0.0

        /// Feet off the floor at t: up as a ball thrown up rises, held, then down the same way.
        func lift(at t: Double) -> Double {
            guard t > from, t < until else { return 0 }
            if t < peak { let u = (peak - t) / max(peak - from, 0.01); return height * (1 - u * u) }
            if t < peak + hang { return height - 0.25 * min(1, (t - peak) / max(hang, 0.01)) * min(height, 0.4) }
            let down = until - peak - hang, u = (t - peak - hang) / max(down, 0.01)
            let top = hang > 0 ? height - min(height, 0.4) * 0.25 : height
            return top * (1 - u * u)
        }
    }

    struct Player: Equatable {
        var team: Team
        var at: CGPoint
        var moves: [PlayScript.Move] = []
        var actions: [Action] = []
        var jumps: [Jump] = []
        /// On the floor from `enters` until `leaves` (a substitution, the
        /// referee, a walk off at the half), fading over a third of a second.
        var enters = -Double.infinity
        var leaves = Double.infinity

        func opacity(at t: Double) -> Double {
            min(max((t - enters) / 0.3, 0), 1) * min(max((leaves - t) / 0.3, 0), 1)
        }

        /// The newest move that has begun wins: a later move starts from
        /// wherever the one before had got to.
        func position(at t: Double) -> CGPoint {
            guard let move = moves.last(where: { t >= $0.start }) else { return at }
            return t < move.end ? move.point(at: t) : move.path.last ?? at
        }

        /// Feet a second along the floor at t.
        func speed(at t: Double) -> Double {
            let a = position(at: t - 0.03), b = position(at: t + 0.03)
            return hypot(b.x - a.x, b.y - a.y) / 0.06
        }

        func lift(at t: Double) -> Double { jumps.reduce(0) { max($0, $1.lift(at: t)) } }

        func jump(at t: Double) -> Jump? { jumps.first { t > $0.from - 0.2 && t < $0.until + 0.25 } }

        mutating func act(_ kind: Action.Kind, at time: Double, toward point: CGPoint) {
            actions.append(Action(kind: kind, at: time, toward: point))
        }

        mutating func move(to path: [CGPoint], from start: Double, to end: Double, ease: PlayScript.Ease = .inOut) {
            moves.removeAll { $0.start >= start }
            let origin = position(at: start)
            guard let last = path.last, hypot(last.x - origin.x, last.y - origin.y) > 0.2 || path.count > 1 else { return }
            moves.append(PlayScript.Move(start: start, end: max(end, start + 0.05), path: [origin] + path, ease: ease))
        }
    }

    /// Where the ball is, leg by leg: in the air, in someone's hands, bounced
    /// as he goes, on the floor.
    struct Leg: Equatable {
        enum Hand: Equatable {
            case flight(Int)
            case held(Int)
            case dribble(Int)
            case spot(FieldPoint)
        }
        var from: Double
        var until: Double
        var hand: Hand
    }

    enum Beat { case catchBall, block, steal, rim, whistle, horn }

    struct Flash: Equatable {
        var beat: Beat
        var at: Double
        var point: FieldPoint
    }

    /// The ball through the net: when it crosses the rim, how hard (a dunk
    /// snaps it), and which way it was going (the net swings that way).
    struct Net: Equatable {
        var at: Double
        var strength: Double
        var way: CGPoint
    }

    /// The headline across the top: DUNK, AND-ONE, POSTERIZED, BUZZER-BEATER,
    /// REJECTED. It lands with the payoff and clears as the court settles.
    struct Banner: Equatable {
        enum Tone: Equatable {
            /// A team's own color.
            case side(GameDetail.Side?)
            /// A game-winner (or the shot that tied it at the end).
            case gold
        }
        var text: String
        var tone: Tone
        var at: Double
        var until: Double
        /// It brings its own confetti (a buzzer-beater).
        var confetti: Bool
    }

    var players: [Player] = []
    var flights: [PlayScript.Flight] = []
    var legs: [Leg] = []
    var flashes: [Flash] = []
    var banner: Banner?
    /// When the stamp lands.
    var stamp = Double.infinity
    /// The make's moment (the ball through the rim), and the net's motion.
    var score: Double?
    var net: Net?
    /// A dunk's rim, pulled down and let go; a rim-out's ring.
    var rimHit: Double?
    var rimStrength = 0.0
    /// The shot's release, and who shot it.
    var release: Double?
    var shooter: Int?
    var settle = 0.0
    var duration = 0.0
    /// The stamp's corner of the view (bottom left), as fractions of its
    /// width and height: the camera keeps the play out of it.
    var corner = CGSize.zero
    var shots: [Shot] = []
    var camera = CameraPath(rest: CameraFrame(x: 60, y: 10, span: 48))
    var yaw = Hoops.yaw(.top)
    /// The team at the basket in front (players 0–4): who the frame is for.
    var side: GameDetail.Side?
    /// What it says at the top while it plays (SHOOTING FOUL · HAYES), from when.
    var tag: Tag?
    /// When something moves, between plays: the court is still in between (nothing redraws).
    var active: [ClosedRange<Double>] = []
    /// The shape the floor is in: play, the lane for free throws, the benches, an empty court.
    var formation = Lineup.Formation.play
    /// What everyone standing about watches from a moment on (the referee at the table, the shooter at the line).
    var look: Look?
    /// A substitute who came on for a man who went off: the next beat finds him in his place.
    var stand: [Int: Int] = [:]
    /// Who ESPN credits (the shooter, the passer, the blocker, the rebounder,
    /// the man who fouled or lost it, the man coming in), on the figure the
    /// play gives him: the tags over the court name him, and nobody else.
    var credits: [Int: BasketballScene.Person] = [:]

    struct Look: Equatable {
        var point: CGPoint
        var from: Double
    }
    /// Each player's motion through the replay (heading, stride, footfalls), measured once: by player.
    var rig: [RigTrack] = []

    func room(_ p: FieldPoint, figure: Bool) -> CGRect { Hoops.room(p, figure: figure, yaw: yaw) }

    /// A broadcast tag over the play: its words, whose color, and from when.
    struct Tag: Equatable {
        var text: String
        var side: GameDetail.Side?
        var at: Double
    }

    /// Where everyone is at t, and the ball: what the next beat (or the
    /// court between plays) starts from.
    func lineup(at t: Double) -> Lineup {
        var holder = carrier(at: t)?.player
        if let h = holder, let off = stand.first(where: { $0.value == h })?.key { holder = off }
        if let h = holder, h >= 10 { holder = nil }
        let at = players.indices.prefix(10).map { i in players[stand[i] ?? i].position(at: t) }
        return Lineup(offense: side, at: at, holder: holder, ball: holder == nil ? ball(at: t)?.ground : nil, formation: formation,
                      camera: camera.frame(at: t), yaw: yaw)
    }

    /// The ball at t: in the air, in hand (at his chest, roughly: the frame
    /// puts it in his hands), bouncing at his side, on the floor.
    func ball(at t: Double) -> FieldPoint? {
        guard let first = legs.first else { return nil }
        let leg = t < first.from ? first : legs.last { t >= $0.from } ?? first
        let at = min(max(t, leg.from), leg.until)
        switch leg.hand {
        case let .flight(i):
            return i < flights.count ? flights[i].point(at: at) : nil
        case let .held(p):
            guard p < players.count else { return nil }
            return FieldPoint(players[p].position(at: at), z: 4.4 + players[p].lift(at: at))
        case let .dribble(p):
            guard p < players.count else { return nil }
            return FieldPoint(players[p].position(at: at), z: Self.bounce(at - leg.from) * 3.0 + 0.4)
        case let .spot(point):
            return point
        }
    }

    /// How high a dribble is (0 the floor, 1 the hand), `t` into it: down
    /// fast, up slower, about two and a half a second.
    static func bounce(_ t: Double) -> Double {
        let phase = (t * 2.4).truncatingRemainder(dividingBy: 1)
        return phase < 0.42 ? 1 - Rig.smooth(phase / 0.42) : Rig.smooth((phase - 0.42) / 0.58)
    }

    /// Who has the ball at t (in his hands or on the dribble), since when, and until when.
    func carrier(at t: Double) -> (player: Int, from: Double, until: Double, dribbling: Bool)? {
        guard let i = legs.lastIndex(where: { t >= $0.from }) else { return nil }
        let until = i + 1 < legs.count ? legs[i].until : .infinity
        switch legs[i].hand {
        case let .held(p):
            // A dribble that follows a hold (or the other way) is the same man with the ball.
            var from = legs[i].from
            if i > 0, case let .dribble(q) = legs[i - 1].hand, q == p { from = legs[i - 1].from }
            return (p, from, until, false)
        case let .dribble(p):
            var from = legs[i].from
            if i > 0, case let .held(q) = legs[i - 1].hand, q == p { from = legs[i - 1].from }
            return (p, from, until, true)
        default:
            return nil
        }
    }

    /// The ball's flight at t, when it's in the air.
    func flight(at t: Double) -> PlayScript.Flight? {
        guard let leg = legs.last(where: { t >= $0.from }), t <= leg.until, case let .flight(i) = leg.hand, i < flights.count else { return nil }
        return flights[i]
    }
}

// MARK: - Building

extension BasketballScript {

    /// A play replayed in full (the marquee). `right`: it's at the right
    /// basket (nil: the whole-game convention, the top team's at the right).
    init(_ scene: BasketballScene, right: Bool? = nil) {
        var b = Builder(scene: scene, offense: scene.offense, right: right ?? (scene.offense != .bottom))
        b.build()
        self = b.script
        measureBodies()
    }

    /// Each player's motion, measured once (`RigTrack`), and what each faces
    /// when he isn't running somewhere: what he's doing with the ball (the man
    /// he passes to, the rim he shoots at); a defender his man and the ball,
    /// even shuffling (only a sprint turns him); else the ball.
    mutating func measureBodies() {
        let script = self
        rig = players.map { player in
            RigTrack(from: 0, through: duration, height: Hoops.ground, position: player.position(at:)) { t in
                if let a = player.actions.filter({ t > $0.at - 0.5 && t < $0.at + 0.3 && $0.kind != .boxOut }).min(by: { abs($0.at - t) < abs($1.at - t) }) {
                    return RigFacing(point: a.toward, always: true)
                }
                if let box = player.actions.last(where: { $0.kind == .boxOut && t >= $0.at - 0.2 }), t < script.settle {
                    return RigFacing(point: box.toward, always: true)
                }
                let ball = script.ball(at: t)?.ground ?? Hoops.rim
                if player.team == .official { return RigFacing(point: ball, always: player.speed(at: t) < 6) }
                if let look = script.look, t >= look.from, player.speed(at: t) < 4 { return RigFacing(point: look.point, always: true) }
                if player.team == .defense, player.speed(at: t) < 13 { return RigFacing(point: ball, always: true) }
                return RigFacing(point: ball)
            }
        }
    }

    /// Assembles a script beat by beat.
    struct Builder {
        let scene: BasketballScene?
        var script = BasketballScript()
        var random: SplitMix64
        /// The set holds this long before anyone moves.
        let open = 0.45
        /// When the action is over (the ball on the floor, in someone's hands).
        var over = 0.0
        /// The shot's arrival at the rim.
        var arrive = 0.0

        static let rim = Hoops.rim
        static let rimPoint = FieldPoint(x: Hoops.rim.x, y: Hoops.rim.y, z: Hoops.rimHeight)
        static let g = 32.2

        /// Who has the ball (between plays, nil: nobody yet).
        let offense: GameDetail.Side?
        /// Which basket each team attacks, and where the benches are.
        var ends = HoopsEnds(topRight: true, topOpensRight: true)
        /// Where the last beat left everyone, in this frame (nil: set up fresh).
        var start: Lineup?
        /// Who passed to whom, the last time: the assist is the pass to the shooter.
        var passers: [Int: Int] = [:]

        init(scene: BasketballScene?, offense: GameDetail.Side?, right: Bool, seed: String? = nil) {
            self.scene = scene
            self.offense = offense
            random = SplitMix64(seed: Celebration.seed(seed ?? scene?.id ?? "rest"))
            script.yaw = Hoops.yaw(right: right)
            script.side = offense
        }

        /// The legs in time order, ties kept in the order they were laid down
        /// (a hold that ends as a pass leaves comes before the pass).
        mutating func sortLegs() {
            script.legs = script.legs.enumerated().sorted { ($0.element.from, $0.offset) < ($1.element.from, $1.offset) }.map(\.element)
        }

        // MARK: Helpers

        var rim: CGPoint { Self.rim }

        func position(_ i: Int, _ t: Double) -> CGPoint { script.players[i].position(at: t) }

        mutating func move(_ i: Int, to path: [CGPoint], from start: Double, to end: Double, ease: PlayScript.Ease = .inOut) {
            script.players[i].move(to: path.map(Self.inbounds), from: start, to: end, ease: ease)
        }

        mutating func act(_ i: Int, _ kind: Action.Kind, at t: Double, toward p: CGPoint) {
            script.players[i].act(kind, at: t, toward: p)
        }

        mutating func jump(_ i: Int, from: Double, peak: Double, until: Double, height: Double, hang: Double = 0) {
            script.players[i].jumps.append(Jump(from: from, peak: peak, until: until, height: height, hang: hang))
        }

        @discardableResult
        mutating func fly(from: FieldPoint, to: FieldPoint, start: Double, time: Double, arc: PlayScript.Flight.Arc) -> Int {
            script.flights.append(PlayScript.Flight(start: start, end: start + time, from: from, to: to, arc: arc))
            script.legs.append(Leg(from: start, until: start + time, hand: .flight(script.flights.count - 1)))
            return script.flights.count - 1
        }

        mutating func hold(_ i: Int, from: Double, until: Double) { script.legs.append(Leg(from: from, until: until, hand: .held(i))) }
        mutating func bounce(_ i: Int, from: Double, until: Double) { script.legs.append(Leg(from: from, until: until, hand: .dribble(i))) }

        /// Kept on the floor (and off the baseline's padding).
        static func inbounds(_ p: CGPoint) -> CGPoint { CGPoint(x: min(max(p.x, 1), 92.5), y: min(max(p.y, 1.2), 48.8)) }

        static func unit(_ v: CGPoint) -> CGPoint {
            let d = hypot(v.x, v.y)
            return d > 1e-6 ? CGPoint(x: v.x / d, y: v.y / d) : CGPoint(x: -1, y: 0)
        }

        static func along(_ p: CGPoint, _ dir: CGPoint, _ d: Double) -> CGPoint { CGPoint(x: p.x + dir.x * d, y: p.y + dir.y * d) }

        static func rotate(_ v: CGPoint, _ a: Double) -> CGPoint {
            CGPoint(x: v.x * cos(a) - v.y * sin(a), y: v.x * sin(a) + v.y * cos(a))
        }

        static func distance(_ a: CGPoint, _ b: CGPoint) -> Double { hypot(a.x - b.x, a.y - b.y) }

        /// The way out from the rim to a spot (straight out the top at the rim itself).
        func out(_ p: CGPoint) -> CGPoint {
            Self.distance(p, rim) > 1.5 ? Self.unit(CGPoint(x: p.x - rim.x, y: p.y - rim.y)) : CGPoint(x: -1, y: 0)
        }

        /// The way in to the rim from a spot, from the court's side of the
        /// backboard (a spot ESPN puts under or behind it comes in along the baseline).
        func approach(_ p: CGPoint) -> CGPoint {
            let o = out(p)
            guard o.x > -0.3 else { return o }
            return CGPoint(x: -0.3, y: (o.y >= 0 ? 1 : -1) * (1 - 0.09).squareRoot())
        }

        /// Where a defender stands on his man: between him and the rim, close
        /// on the ball, off and toward the ball away from it.
        func guardSpot(_ man: CGPoint, ball: CGPoint, onBall: Bool) -> CGPoint {
            let toRim = Self.unit(CGPoint(x: rim.x - man.x, y: rim.y - man.y))
            let room = min(Self.distance(man, rim) * 0.45, onBall ? 4 : min(5.5 + 0.17 * Self.distance(man, ball), 10.5))
            var p = Self.along(man, toRim, max(room, 1.5))
            if !onBall { p = CGPoint(x: p.x + (ball.x - p.x) * 0.12, y: p.y + (ball.y - p.y) * 0.12) }
            return p
        }

        /// The hand's place for a shot off a jump `lift` ft high: a little
        /// ahead of him, his arm up (7 ft for a player this tall, standing).
        func release(_ spot: CGPoint, lift: Double, reach: Double = 7.0) -> FieldPoint {
            let ahead = Self.along(spot, Self.unit(CGPoint(x: rim.x - spot.x, y: rim.y - spot.y)), 0.45)
            return FieldPoint(ahead, z: reach + lift)
        }

        // MARK: The set

        /// Five on five in the half court round the play: `fixed` are the
        /// places the play needs (the shooter's start, the passer's), the rest
        /// spaced round them (two on the perimeter, a big on the weak-side
        /// block), each defender between his man and the rim.
        mutating func lineUp(_ fixed: [CGPoint], ball: Int) {
            let strong = (fixed.first?.y ?? 30) >= 25 ? 1.0 : -1.0
            func slot(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: x, y: 25 + y * strong) }
            let perimeter = [slot(90.5, -22.5), slot(71.5, -17.5), slot(61.5, 0), slot(90.5, 22.5), slot(71.5, 17.5), slot(66, -9), slot(66, 9)]
            let bigs = [slot(86.5, -8.8), slot(86.5, 8.8), slot(90.5, -11), slot(76, 0)]
            var placed = fixed
            func free(_ p: CGPoint) -> Bool { placed.allSatisfy { Self.distance($0, p) > 9 } }
            while placed.count < 4, let p = perimeter.first(where: free) ?? perimeter.first { placed.append(p) }
            placed.append(bigs.first(where: free) ?? slot(80, -14))
            let at = placed.prefix(5).map { Self.inbounds(CGPoint(x: $0.x + random.in(-1...1), y: $0.y + random.in(-1...1))) }
            script.players = at.map { Player(team: .offense, at: $0) }
            let handler = at[min(ball, at.count - 1)]
            for (k, man) in at.enumerated() {
                script.players.append(Player(team: .defense, at: guardSpot(man, ball: handler, onBall: k == ball)))
            }
        }

        /// The defenders not otherwise busy stay on their men through the play.
        mutating func shadow(from start: Double, to end: Double, except: Set<Int> = []) {
            sortLegs()
            let step = 0.25
            for k in 0..<5 where !except.contains(k + 5) {
                var t = start
                while t < end - 0.01 {
                    let next = min(t + step, end)
                    let man = position(k, next + 0.12)
                    let ball = script.ball(at: next)?.ground ?? rim
                    let onBall = script.carrier(at: next)?.player == k
                    move(k + 5, to: [guardSpot(man, ball: ball, onBall: onBall)], from: t, to: next, ease: .linear)
                    t = next
                }
            }
        }

        // MARK: With the ball

        /// He dribbles from where he is to `to` at `speed` ft/s, starting at
        /// `t`: when he gets there.
        @discardableResult
        mutating func drive(_ i: Int, to p: CGPoint, from t: Double, speed: Double, ease: PlayScript.Ease = .inOut) -> Double {
            let d = Self.distance(position(i, t), p)
            let end = t + max(d / speed * (ease == .linear ? 1 : 1.25), 0.2)
            move(i, to: [p], from: t, to: end, ease: ease)
            return end
        }

        enum PassStyle { case chest, bounce, lob, outlet }

        /// How long a pass from `i` at `t` takes to reach `point` (so the man it's for can be there as it is).
        func passTime(_ i: Int, at t: Double, to point: CGPoint, style: PassStyle) -> Double {
            let from = position(i, t)
            let start = Self.along(from, Self.unit(CGPoint(x: point.x - from.x, y: point.y - from.y)), 0.8)
            let d = Self.distance(start, point)
            switch style {
            case .chest: return min(max(d / 40, 0.26), 0.8)
            case .outlet: return min(max(d / 42, 0.4), 1.1)
            case .bounce: return min(max(d / 30, 0.32), 0.7)
            case .lob: return min(max(d / 26, 0.62), 1.05)
            }
        }

        /// A pass from `i` (holding it) at `t` to `j`, caught where `j` will be
        /// then (at `point`): when it's caught. The flight is a crisp line, a
        /// bounce off the floor, or a lob over the top to a man in the air.
        @discardableResult
        mutating func pass(_ i: Int, to j: Int, at t: Double, point: CGPoint, style: PassStyle, height: Double = 4.4) -> Double {
            let from = position(i, t)
            let dir = Self.unit(CGPoint(x: point.x - from.x, y: point.y - from.y))
            let start = FieldPoint(Self.along(from, dir, 0.8), z: style == .lob ? 7.4 : 4.6)
            let end = FieldPoint(point, z: height)
            let d = Self.distance(start.ground, point)
            let time = passTime(i, at: t, to: point, style: style)
            let arc: PlayScript.Flight.Arc
            switch style {
            case .chest: arc = .arc(0.6 + d * 0.025)
            case .outlet: arc = .arc(2 + d * 0.06)
            case .bounce:
                // Down to the floor two thirds of the way, and up into his hands.
                let n = 24
                let samples = (0...n).map { k -> FieldPoint in
                    let u = Double(k) / Double(n)
                    let g = CGPoint(x: start.x + (point.x - start.x) * u, y: start.y + (point.y - start.y) * u)
                    let z = u < 0.62 ? start.z * (1 - u / 0.62) : height * (u - 0.62) / 0.38 + 1.2 * sin(.pi * (u - 0.62) / 0.38)
                    return FieldPoint(g, z: max(z, 0.4))
                }
                arc = .samples(samples)
            case .lob:
                arc = .arc(max(4.5 - (height - start.z) * 0.5, 2.5) + d * 0.05)
            }
            fly(from: start, to: end, start: t, time: time, arc: arc)
            act(i, style == .lob ? .lob : .pass, at: t, toward: point)
            act(j, .catchBall, at: t + time, toward: from)
            passers[j] = i
            if style != .lob { script.flashes.append(Flash(beat: .catchBall, at: t + time, point: end)) }
            return t + time
        }

        /// A shot from `from` at `start` to `to` (the rim's center for a
        /// make), leaving the hand at `angle` (radians up from level): an
        /// honest parabola, its time set by gravity.
        @discardableResult
        mutating func shoot(from: FieldPoint, to: FieldPoint, at start: Double, angle: Double) -> (flight: Int, end: Double) {
            let d = hypot(to.x - from.x, to.y - from.y), dz = to.z - from.z
            let peak = max((d * tan(angle) - dz) / 4, 0.35)
            let time = (8 * peak / Self.g).squareRoot()
            let i = fly(from: from, to: to, start: start, time: time, arc: .arc(peak))
            return (i, start + time)
        }

        /// The ball through the net at `t`, coming from `way`, then down to the
        /// floor and bouncing to rest.
        mutating func throughNet(at t: Double, way: CGPoint, strength: Double) {
            script.score = t
            script.net = Net(at: t, strength: strength, way: way)
            let below = FieldPoint(Self.along(rim, way, 0.3), z: Hoops.rimHeight - 2.4)
            fly(from: Self.rimPoint, to: below, start: t, time: 0.15, arc: .straight)
            let drift = Self.rotate(way, random.in(-0.5...0.5))
            dropToFloor(from: below, at: t + 0.15, drift: CGPoint(x: drift.x * 2.4, y: drift.y * 2.4), downward: 12)
        }

        /// A ball falling from `from` at `t`, drifting `drift` ft/s, bouncing
        /// twice and coming to rest: the flight's samples (honest physics, the
        /// floor taking two fifths of each bounce).
        mutating func dropToFloor(from: FieldPoint, at t: Double, drift: CGPoint, downward: Double, hops: Int = 2) {
            var points: [FieldPoint] = []
            var z = from.z, v = -downward, x = from.x, y = from.y, bounces = 0
            let dt = 1.0 / 60
            var elapsed = 0.0
            while bounces <= hops, elapsed < 3 {
                points.append(FieldPoint(x: x, y: y, z: max(z, 0.4)))
                v -= Self.g * dt
                z += v * dt
                x += drift.x * dt
                y += drift.y * dt
                elapsed += dt
                if z <= 0.4, v < 0 {
                    z = 0.4
                    v = -v * 0.6
                    bounces += 1
                }
            }
            let end = FieldPoint(x: x, y: y, z: 0.4)
            points.append(end)
            fly(from: from, to: end, start: t, time: Double(points.count - 1) * dt, arc: .samples(points))
            over = max(over, t + Double(points.count - 1) * dt)
            script.legs.append(Leg(from: t + Double(points.count - 1) * dt, until: .infinity, hand: .spot(end)))
        }

        /// A miss off the rim at `t` (the front of it, toward the shooter, or
        /// the back), up and out to `catchAt` (caught at `height`): when it gets there.
        mutating func rimOut(at t: Double, from shooter: CGPoint, back: Bool, catchAt: CGPoint, height: Double) -> Double {
            let toward = out(shooter)
            let side = back ? CGPoint(x: -toward.x, y: -toward.y) : toward
            let hit = FieldPoint(Self.along(rim, side, Hoops.rimRadius), z: Hoops.rimHeight + 0.15)
            script.rimHit = t
            script.rimStrength = 0.35
            script.flashes.append(Flash(beat: .rim, at: t, point: hit))
            let d = Self.distance(hit.ground, catchAt)
            let peak = 2.6 + d * 0.12
            let time = ((8 * peak / Self.g).squareRoot() * 0.8 + 0.1)
            fly(from: hit, to: FieldPoint(catchAt, z: height), start: t, time: time, arc: .arc(peak))
            return t + time
        }

        /// The credited rebounder: of his team (the offense's on an offensive
        /// rebound), the one nearest where the ball comes down, the shooter
        /// when it's his own; nil for a team rebound or one nobody takes.
        func rebounder(for rebound: BasketballScene.Rebound?, near p: CGPoint, at t: Double, exclude: Set<Int>) -> Int? {
            guard let rebound, rebound.person != nil else { return nil }
            if rebound.offensive, rebound.person?.id != nil, rebound.person?.id == scene?.shooter?.id, !exclude.contains(0) { return 0 }
            let pool = (rebound.offensive ? Array(0..<5) : Array(5..<10)).filter { !exclude.contains($0) }
            return pool.min { Self.distance(position($0, t), p) < Self.distance(position($1, t), p) }
        }

        /// Where he can get the ball: where it was headed, or as near as he gets by then (17 ft a second).
        func reach(_ r: Int, toward p: CGPoint, from start: Double, by t: Double) -> CGPoint {
            let here = position(r, start), d = Self.distance(here, p), most = max(t - start - 0.15, 0) * 17 + 1.2
            return d <= most ? p : Self.along(here, Self.unit(CGPoint(x: p.x - here.x, y: p.y - here.y)), most)
        }

        /// Who ESPN credits, on the figure the play gives him (`credits`).
        mutating func credit(_ i: Int?, _ person: BasketballScene.Person?) {
            guard let i, let person, i < script.players.count, person.id != nil || !person.name.isEmpty else { return }
            script.credits[i] = person
        }

        /// He goes up and has it as it gets to him.
        mutating func takeRebound(_ r: Int, at point: CGPoint, arrives t: Double, from start: Double) {
            move(r, to: [Self.along(point, out(point), 0.5)], from: start, to: max(t - 0.05, start + 0.2), ease: .out)
            jump(r, from: t - 0.25, peak: t, until: t + 0.3, height: 1.4)
            act(r, .rebound, at: t, toward: point)
            hold(r, from: t, until: .infinity)
            script.flashes.append(Flash(beat: .catchBall, at: t, point: FieldPoint(point, z: 8)))
            over = max(over, t + 0.3)
        }

        // MARK: Build

        mutating func build() {
            guard let scene else { return }
            if scene.kind == .freeThrow {
                freeThrow()
            } else if scene.steal != nil, scene.made {
                transition()
            } else if scene.kind == .putback {
                putback()
            } else {
                halfCourt()
            }
            // The shooter, and the man who passed it to him for the assist; a block's blocker.
            credit(script.shooter, scene.shooter)
            if scene.assister != nil { credit(script.shooter.flatMap { passers[$0] }, scene.assister) }
            if scene.blocker != nil { credit((5..<script.players.count).first { k in script.players[k].actions.contains { $0.kind == .block } }, scene.blocker) }
            aftermath()
            finish()
            headline()
            measureStamp()
            settle()
            shoot()
        }

        // MARK: The half court

        /// A basket (or a block, or a late miss) out of the half court: the set,
        /// the ball to him the way ESPN's type says he got it, his move, the
        /// shot and what came of it.
        mutating func halfCourt() {
            guard let scene, let spotESPN = scene.spot else { return }
            let spot = Self.inbounds(Hoops.court(spotESPN))
            let shotKind = scene.shot ?? scene.kind
            let assisted = scene.assister != nil
            switch shotKind {
            case .alleyOop:
                alleyOop(spot)
            case .layup, .dunk:
                if scene.move == .cut, assisted { cut(spot) } else { driveToRim(spot, assisted: assisted) }
            default:
                jumper(spot, kind: shotKind)
            }
        }

        /// The finish the scene asks for at the rim, for player `i`, coming in
        /// along `approach` (out from the rim) and taking off at `takeoff` (t):
        /// a layup off the glass or over the front of the rim, a dunk. Returns
        /// the release (or the slam).
        @discardableResult
        mutating func finishAtRim(_ i: Int, approach: CGPoint, takeoff t: Double, dunk: Bool, hasBall: Bool = true) -> Double {
            guard let scene else { return t }
            if dunk {
                // Up off both feet, carried in under the rim; the ball hammered down through it.
                // In to a stride off the rim by the top (his hands over it), then down under it.
                let slam = t + 0.36
                let hang = scene.posterized || scene.andOne ? 0.24 : 0.1
                move(i, to: [Self.along(rim, approach, 1.7)], from: t, to: slam, ease: .out)
                move(i, to: [Self.along(rim, approach, 0.9)], from: slam + hang, to: slam + hang + 0.38, ease: .inOut)
                jump(i, from: t, peak: slam, until: slam + hang + 0.38, height: 3.4, hang: hang)
                act(i, .dunk, at: slam, toward: rim)
                if hasBall { hold(i, from: script.legs.last.map { min($0.until, t) } ?? t, until: slam - 0.04) }
                let hand = FieldPoint(Self.along(rim, approach, 0.6), z: Hoops.rimHeight + 0.9)
                if scene.made {
                    fly(from: hand, to: Self.rimPoint, start: slam - 0.04, time: 0.04, arc: .straight)
                    script.rimHit = slam
                    script.rimStrength = 1
                    throughNet(at: slam, way: CGPoint(x: -approach.x, y: -approach.y), strength: 1)
                }
                script.release = slam - 0.04
                return slam
            }
            // The layup: off one foot, the knee up, laid in from the hand at the top of the jump.
            let landing = Self.along(rim, approach, scene.reverse ? -1.6 : 0.9)
            move(i, to: [landing], from: t, to: t + 0.66, ease: .linear)
            let top = t + 0.31
            jump(i, from: t, peak: top, until: t + 0.64, height: 2.3)
            act(i, .layup, at: top, toward: rim)
            if hasBall { hold(i, from: script.legs.last.map { min($0.until, t) } ?? t, until: top) }
            script.release = top
            let at = position(i, top)
            let hand = FieldPoint(Self.along(at, Self.unit(CGPoint(x: rim.x - at.x, y: rim.y - at.y)), 0.35), z: 7.05 + 2.3)
            let flight = shoot(from: hand, to: scene.made ? Self.rimPoint : FieldPoint(Self.along(rim, approach, 0.7), z: 10.1),
                               at: top, angle: 0.95)
            arrive = flight.end
            if scene.made { throughNet(at: flight.end, way: CGPoint(x: -approach.x, y: -approach.y), strength: 0.55) }
            return top
        }

        /// Off the dribble to the rim: from out top (or off the wing, along the
        /// way his spot lies), past his man, the help coming over; or a catch
        /// on the move and straight in.
        mutating func driveToRim(_ spot: CGPoint, assisted: Bool) {
            guard let scene else { return }
            let dunk = scene.dunk || scene.shot == .dunk
            var approach = self.approach(spot)
            if Self.distance(spot, rim) < 2.5 {
                // At the rim itself the spot doesn't say the way in: off a wing or straight down the lane.
                approach = Self.rotate(CGPoint(x: -1, y: 0), random.in(-0.9...0.9))
            }
            let start = Self.inbounds(Self.along(rim, approach, 26))
            let takeoff = Self.along(rim, approach, dunk ? 5.4 : 4.6)
            let passer = assisted ? 1 : nil
            let passerAt = passer.map { _ in Self.inbounds(Self.along(rim, Self.rotate(approach, approach.y >= 0 ? -1.15 : 1.15), 24)) }
            lineUp([assisted ? Self.along(start, approach, 4) : start] + (passerAt.map { [$0] } ?? []), ball: assisted ? 1 : 0)
            script.shooter = 0
            var t = open
            if let passer {
                // A pass to him on the move, a step inside the arc.
                hold(passer, from: 0, until: t + 0.25)
                let catchAt = Self.along(rim, approach, 19)
                move(0, to: [start, catchAt], from: t - 0.1, to: t + 0.25 + passTime(passer, at: t + 0.25, to: catchAt, style: .chest), ease: .inOut)
                t = pass(passer, to: 0, at: t + 0.25, point: catchAt, style: .chest)
                hold(0, from: t, until: t + 0.12)
                bounce(0, from: t + 0.12, until: .infinity)
                t = drive(0, to: takeoff, from: t + 0.12, speed: 21, ease: .linear)
            } else {
                hold(0, from: 0, until: t)
                bounce(0, from: t, until: .infinity)
                // A hesitation, then downhill.
                t = drive(0, to: takeoff, from: t + 0.1, speed: 22)
            }
            script.legs[script.legs.count - 1].until = t
            // His man a step behind; the help over from the weak side to meet him.
            let finish = finishAtRim(0, approach: approach, takeoff: t, dunk: dunk)
            shadow(from: 0, to: finish + 0.6, except: [5, 9])
            trail(5, behind: 0, from: open, to: t + 0.3, way: approach.negated)
            let helper = 9
            let meet = Self.along(rim, Self.rotate(approach, approach.y >= 0 ? -0.5 : 0.5), dunk ? 3.4 : 2.6)
            move(helper, to: [meet], from: max(t - 0.9, open), to: t - 0.05, ease: .inOut)
            contestAtRim(helper, at: finish, blocker: scene.result == .blocked)
            if scene.result == .blocked { blockAtRim(helper, shooter: 0, at: finish, approach: approach) }
            else if !scene.made { rimMiss(from: position(0, finish), at: arrive, exclude: [0]) }
            if scene.andOne { foulContact(helper, at: finish) }
            boxOut(after: finish)
        }

        /// Off the ball to the rim: a cut along the baseline or down the lane,
        /// the pass in (a bounce pass, or a lob over the top), the finish.
        mutating func cut(_ spot: CGPoint) {
            guard let scene else { return }
            let dunk = scene.dunk || scene.shot == .dunk
            var approach = self.approach(spot)
            // At the rim itself the spot doesn't say the way in: along the baseline from one side or the other.
            if Self.distance(spot, rim) < 2.5 { approach = CGPoint(x: -0.35, y: 0.94 * random.sign()) }
            let start = Self.inbounds(Self.along(rim, approach, 18))
            let passerAt = Self.inbounds(Self.along(rim, Self.rotate(approach, approach.y >= 0 ? -1.25 : 1.25), 23))
            lineUp([start, passerAt], ball: 1)
            script.shooter = 0
            hold(1, from: 0, until: open + 0.55)
            let catchAt = Self.along(rim, approach, 8)
            let takeoff = Self.along(rim, approach, dunk ? 5.2 : 4.4)
            let lands = open + 0.55 + passTime(1, at: open + 0.55, to: catchAt, style: .bounce)
            move(0, to: [catchAt], from: lands - 0.85, to: lands, ease: .inOut)
            let caught = pass(1, to: 0, at: open + 0.55, point: catchAt, style: .bounce, height: 4.2)
            move(0, to: [takeoff], from: caught, to: caught + 0.2, ease: .linear)
            hold(0, from: caught, until: .infinity)
            let finish = finishAtRim(0, approach: approach, takeoff: caught + 0.2, dunk: dunk, hasBall: false)
            if let last = script.legs.lastIndex(where: { $0.hand == .held(0) }) { script.legs[last].until = script.release ?? finish }
            shadow(from: 0, to: finish + 0.6, except: [5, 9])
            trail(5, behind: 0, from: lands - 0.85, to: caught + 0.4, way: approach.negated)
            let meet = Self.along(rim, Self.rotate(approach, 0.55), 2.8)
            move(9, to: [meet], from: open + 0.4, to: caught + 0.1)
            contestAtRim(9, at: finish, blocker: false)
            if scene.andOne { foulContact(9, at: finish) }
            boxOut(after: finish)
        }

        /// The lob: the passer out top, the cutter from the weak side in
        /// stride to the rim, the ball laid up over the defense to where he'll
        /// be at the top of his jump, and finished there.
        mutating func alleyOop(_ spot: CGPoint) {
            guard let scene else { return }
            let dunk = scene.dunk
            var approach = self.approach(spot)
            if Self.distance(spot, rim) < 2.5 { approach = Self.rotate(CGPoint(x: -0.45, y: 0.89), random.next() & 1 == 0 ? 0 : -2.2) }
            let start = Self.inbounds(Self.along(rim, approach, 22))
            let passerAt = Self.inbounds(Self.along(rim, Self.rotate(approach, approach.y >= 0 ? -1.0 : 1.0), 25))
            lineUp([start, passerAt], ball: 1)
            script.shooter = 0
            let takeoff = Self.along(rim, approach, 5.6)
            let t = drive(0, to: takeoff, from: open + 0.1, speed: 21, ease: .inOut)
            let peak = t + 0.38
            move(0, to: [Self.along(rim, approach, 2.0)], from: t, to: peak, ease: .out)
            move(0, to: [Self.along(rim, approach, 0.7)], from: peak + 0.12, to: peak + 0.55, ease: .inOut)
            jump(0, from: t, peak: peak, until: peak + (dunk ? 0.5 : 0.36), height: dunk ? 3.4 : 2.6, hang: dunk ? 0.12 : 0)
            // Caught over his head, a little ahead of him.
            let catchPoint = Self.along(position(0, peak), approach.negated, 0.5)
            // The lob leaves so it's there as he is.
            let lobTime = passTime(1, at: peak - 0.8, to: catchPoint, style: .lob)
            hold(1, from: 0, until: peak - lobTime)
            let caught = pass(1, to: 0, at: peak - lobTime, point: catchPoint, style: .lob, height: Hoops.rimHeight + 1.2)
            script.release = caught
            if dunk {
                act(0, .dunk, at: caught + 0.06, toward: rim)
                hold(0, from: caught, until: caught + 0.04)
                fly(from: FieldPoint(catchPoint, z: Hoops.rimHeight + 1.2), to: Self.rimPoint, start: caught + 0.04, time: 0.06, arc: .straight)
                script.rimHit = caught + 0.1
                script.rimStrength = 1
                if scene.made { throughNet(at: caught + 0.1, way: CGPoint(x: -approach.x, y: -approach.y), strength: 1) }
            } else {
                act(0, .layup, at: caught + 0.05, toward: rim)
                hold(0, from: caught, until: caught + 0.08)
                let f = shoot(from: FieldPoint(catchPoint, z: Hoops.rimHeight + 1.0), to: Self.rimPoint, at: caught + 0.08, angle: 0.7)
                if scene.made { throughNet(at: f.end, way: CGPoint(x: -approach.x, y: -approach.y), strength: 0.6) }
            }
            shadow(from: 0, to: peak + 0.6, except: [5])
            trail(5, behind: 0, from: open + 0.1, to: t + 0.5, way: approach.negated)
            boxOut(after: caught)
        }

        /// A jump shot: off the catch (the pass from where an assist comes
        /// from on that shot: a kick out of a drive, a swing from the top, an
        /// entry to the post) or off the dribble (a pull-up, a step-back, a
        /// fadeaway, a floater, a hook), his man closing out to contest.
        mutating func jumper(_ spot: CGPoint, kind: BasketballScene.Kind) {
            guard let scene else { return }
            let move = scene.move
            let assisted = scene.assister != nil
            let o = out(spot), d = Self.distance(spot, rim)
            let lateral = Self.unit(CGPoint(x: -o.y, y: o.x))
            let side = random.sign()
            // Where he starts, by his move.
            var start: CGPoint
            switch move {
            case .catchAndShoot: start = spot.x > 82 ? Self.along(spot, CGPoint(x: -1, y: 0), 1.5) : Self.along(spot, lateral, 5 * side)
            case .pullUp: start = Self.along(Self.along(spot, o, 6), lateral, 8 * side)
            case .stepBack: start = Self.along(spot, o, 9)
            case .fadeaway, .turnaround, .hook: start = Self.along(spot, o, -2.2)
            case .floater: start = Self.along(rim, Self.rotate(o, 0.3 * side), max(d + 13, 22))
            default: start = Self.along(spot, lateral, 4 * side)
            }
            start = Self.inbounds(start)
            // An assist from where it would come: a drive and kick to the arc, a swing from the top, an entry to the post.
            var passerAt: CGPoint?
            var drives = false
            if assisted {
                if kind == .three, spot.x > 80 {
                    passerAt = CGPoint(x: 70, y: 25 + (spot.y >= 25 ? 9 : -9)); drives = true
                } else if kind == .three, abs(spot.y - 25) > 9 {
                    passerAt = CGPoint(x: 62, y: 25 - (spot.y - 25) * 0.25); drives = random.next() & 1 == 0
                } else if kind == .three {
                    passerAt = CGPoint(x: 84, y: spot.y >= 25 ? 17 : 33)
                } else if move == .hook || move == .turnaround || move == .fadeaway {
                    passerAt = Self.inbounds(Self.along(start, Self.rotate(o, side * 0.9), 16))
                } else {
                    passerAt = Self.inbounds(Self.along(rim, Self.rotate(o, side * 1.0), 24))
                }
            }
            lineUp([start] + (passerAt.map { [$0] } ?? []), ball: assisted ? 1 : 0)
            script.shooter = 0
            var t = open
            var at = spot
            var lift = 1.5
            var angle = 0.84
            var fade = 0.0
            if let passerAt, assisted {
                var leave = t + 0.3
                hold(1, from: 0, until: t)
                if drives {
                    // Into the lane, drawing his man, then out to the shooter.
                    bounce(1, from: t, until: .infinity)
                    let lane = Self.along(passerAt, Self.unit(CGPoint(x: rim.x - passerAt.x, y: rim.y - passerAt.y)), 8)
                    leave = drive(1, to: lane, from: t, speed: 16)
                    script.legs[script.legs.count - 1].until = leave
                } else {
                    hold(1, from: t, until: leave)
                }
                let lead = Self.distance(position(1, leave), spot) / 40
                self.move(0, to: [spot], from: max(leave - 0.45, open), to: leave + lead + 0.02, ease: .out)
                t = pass(1, to: 0, at: leave, point: spot, style: .chest)
                hold(0, from: t, until: .infinity)
                if move == .hook || move == .turnaround || move == .fadeaway {
                    // In the post: a beat, the turn, up.
                    t += 0.35
                } else {
                    t += 0.22
                }
            } else {
                hold(0, from: 0, until: t)
                bounce(0, from: t, until: .infinity)
                switch move {
                case .stepBack:
                    // At his man, then a hop back to the spot.
                    let inside = Self.along(spot, o, -3.2)
                    let at1 = drive(0, to: inside, from: t + 0.05, speed: 15)
                    self.move(0, to: [spot], from: at1, to: at1 + 0.26, ease: .out)
                    t = at1 + 0.26
                case .fadeaway, .turnaround, .hook:
                    t += 0.5
                case .floater:
                    t = drive(0, to: Self.along(spot, o, 2.5), from: t + 0.05, speed: 18, ease: .linear)
                default:
                    t = drive(0, to: spot, from: t + 0.05, speed: 15)
                }
                script.legs[script.legs.count - 1].until = t
                hold(0, from: t, until: .infinity)
                t += move == .floater ? 0.02 : 0.12
            }
            switch move {
            case .fadeaway, .turnaround:
                fade = move == .fadeaway ? 2.2 : 0.8
                lift = 1.6
            case .floater:
                lift = 1.1; angle = 1.02
                at = Self.along(spot, o, 0.6)
            case .hook:
                lift = 0.9; angle = 1.0
            default:
                lift = kind == .three ? 1.3 : 1.5
                angle = d > 18 ? 0.84 : 0.88
            }
            // Up: the dip, the rise, the release just before the top.
            let takeoff = t + 0.1
            let airtime = 2 * (2 * lift / Self.g).squareRoot()
            let peak = takeoff + airtime / 2
            let releaseAt = peak - 0.03
            if fade > 0 {
                self.move(0, to: [Self.along(at, o, fade)], from: takeoff, to: takeoff + airtime, ease: .linear)
            } else if move == .floater {
                self.move(0, to: [Self.along(at, o, -2)], from: takeoff, to: takeoff + airtime, ease: .linear)
            }
            jump(0, from: takeoff, peak: peak, until: takeoff + airtime, height: lift)
            act(0, move == .hook ? .hook : .shoot, at: releaseAt, toward: rim)
            if let last = script.legs.lastIndex(where: { $0.hand == .held(0) }) { script.legs[last].until = releaseAt }
            script.release = releaseAt
            let hand = release(position(0, releaseAt), lift: lift * 0.97)
            let target = scene.made ? Self.rimPoint : FieldPoint(Self.along(rim, o, 0.7), z: 10.1)
            let flight = shoot(from: hand, to: target, at: releaseAt, angle: angle)
            arrive = flight.end
            // His man: up on him as he catches, a hand up as it goes.
            shadow(from: 0, to: arrive + 0.2, except: [5])
            let blocked = scene.result == .blocked
            let contestAt = Self.along(position(0, releaseAt), Self.unit(CGPoint(x: rim.x - spot.x, y: rim.y - spot.y)),
                                       blocked ? 2.3 : move == .stepBack ? 4.6 : 3.2)
            let closeFrom = assisted ? max(t - 0.75, open) : open
            self.move(5, to: [guardSpot(position(0, closeFrom + 0.3), ball: spot, onBall: true), contestAt], from: closeFrom,
                      to: releaseAt - 0.02, ease: .out)
            contest(5, at: releaseAt + (blocked ? 0.08 : 0), toward: hand.ground, height: blocked ? 2.9 : 1.0)
            if blocked {
                blockShot(5, flight: flight.flight, at: releaseAt + 0.08)
            } else if scene.made {
                throughNet(at: flight.end, way: Self.unit(CGPoint(x: rim.x - hand.x, y: rim.y - hand.y)), strength: 0.55)
            } else {
                rimMiss(from: hand.ground, at: flight.end, exclude: [])
            }
            boxOut(after: releaseAt)
        }

        // MARK: Putback, transition, the line

        /// A miss and the putback: the first shot off the rim (from where ESPN
        /// put it), up to the man under it, and back in: a tip, a putback, a
        /// tip dunk. His own miss, he follows it.
        mutating func putback() {
            guard let scene, let spotESPN = scene.spot else { return }
            let finishSpot = Hoops.court(spotESPN)
            let miss = scene.miss ?? BasketballScene.Miss(spot: CGPoint(x: 25 + random.in(-12...12), y: 24), shooter: nil, value: 3, close: false)
            let missSpot = Self.inbounds(Hoops.court(miss.spot))
            let own = miss.shooter?.id != nil && miss.shooter?.id == scene.shooter?.id
            // The man under it: on the weak side of the shot, a step off the rim.
            let o = out(missSpot)
            let weak = Self.inbounds(Self.along(rim, Self.rotate(CGPoint(x: -o.x, y: -o.y), 0.9 * (o.y >= 0 ? 1 : -1) * 0.6 + .pi), 7))
            let under = Self.along(rim, out(Self.distance(finishSpot, rim) > 1.5 ? finishSpot : weak), 3.2)
            lineUp(own ? [missSpot] : [weak, missSpot], ball: own ? 0 : 1)
            script.shooter = 0
            let shooter = own ? 0 : 1
            if !own { credit(1, miss.shooter) }
            var t = open
            hold(shooter, from: 0, until: t)
            // The first shot.
            let hand: FieldPoint
            let releaseAt: Double
            if miss.close {
                bounce(shooter, from: t, until: .infinity)
                let takeoff = Self.along(rim, o, 4.6)
                let at = drive(shooter, to: takeoff, from: t + 0.05, speed: 18)
                script.legs[script.legs.count - 1].until = at
                hold(shooter, from: at, until: at + 0.31)
                move(shooter, to: [Self.along(rim, o, 1.2)], from: at, to: at + 0.62, ease: .linear)
                jump(shooter, from: at, peak: at + 0.31, until: at + 0.62, height: 2.2)
                act(shooter, .layup, at: at + 0.31, toward: rim)
                releaseAt = at + 0.31
                hand = FieldPoint(Self.along(rim, o, 2.2), z: 9.3)
            } else {
                hold(shooter, from: t, until: t + 0.4)
                let lift = miss.value == 3 ? 1.3 : 1.5
                let takeoff = t + 0.3, airtime = 2 * (2 * lift / Self.g).squareRoot()
                jump(shooter, from: takeoff, peak: takeoff + airtime / 2, until: takeoff + airtime, height: lift)
                releaseAt = takeoff + airtime / 2 - 0.03
                act(shooter, .shoot, at: releaseAt, toward: rim)
                script.legs[script.legs.count - 1].until = releaseAt
                hand = release(missSpot, lift: lift)
            }
            t = releaseAt
            let back = random.next() & 1 == 0
            let firstFlight = shoot(from: hand, to: FieldPoint(Self.along(rim, back ? CGPoint(x: -o.x, y: -o.y) : o, Hoops.rimRadius), z: 10.15),
                                    at: releaseAt, angle: miss.close ? 0.95 : 0.84)
            // Off the rim, up to him at the top of his jump.
            let tipPoint = Self.along(under, out(under), -0.6)
            let up = rimOut(at: firstFlight.end, from: hand.ground, back: back, catchAt: tipPoint, height: scene.dunk ? 11.2 : 10.6)
            // Under it as it comes off (his own miss: he lands, and goes straight back up for it).
            move(0, to: [Self.along(tipPoint, out(tipPoint), 0.45)], from: own ? releaseAt + 0.35 : releaseAt, to: up - 0.28, ease: .inOut)
            jump(0, from: up - 0.36, peak: up, until: up + 0.42, height: scene.dunk ? 3.2 : 2.6)
            if scene.dunk {
                act(0, .dunk, at: up + 0.08, toward: rim)
                hold(0, from: up, until: up + 0.05)
                fly(from: FieldPoint(tipPoint, z: 11.2), to: Self.rimPoint, start: up + 0.05, time: 0.07, arc: .straight)
                script.rimHit = up + 0.12
                script.rimStrength = 0.9
                throughNet(at: up + 0.12, way: out(tipPoint).negated, strength: 0.95)
            } else {
                act(0, .tip, at: up, toward: rim)
                let f = shoot(from: FieldPoint(tipPoint, z: 10.6), to: Self.rimPoint, at: up, angle: 0.75)
                throughNet(at: f.end, way: out(tipPoint).negated, strength: 0.5)
            }
            script.release = up
            arrive = up
            shadow(from: 0, to: up + 0.6, except: [9, 5])
            // The defenders under it go up too, a beat late.
            move(5, to: [Self.along(under, Self.rotate(out(under), 1.2), 2.6)], from: releaseAt, to: up - 0.2)
            jump(5, from: up - 0.3, peak: up + 0.05, until: up + 0.4, height: 1.6)
            act(5, .contest, at: up, toward: tipPoint)
            boxOut(after: releaseAt)
        }

        /// A steal at the other end and the break: the ball taken where ESPN
        /// says, pushed up the floor (ahead to whoever finished it, or his own
        /// way), the other team chasing back, and the finish.
        mutating func transition() {
            guard let scene, let spotESPN = scene.spot, let steal = scene.steal else { return }
            let finishSpot = Self.inbounds(Hoops.court(spotESPN))
            let at = Self.inbounds(steal.spot.map(Hoops.otherEnd) ?? CGPoint(x: 30, y: 20 + random.in(0...10)))
            let stealerIsShooter = steal.stealer?.id != nil && steal.stealer?.id == scene.shooter?.id
            let stealerIsPasser = steal.stealer?.id != nil && steal.stealer?.id == scene.assister?.id
            // Their offense (our defense, 5–9) at the far end, the man who lost it on the ball by the steal.
            let farRim = CGPoint(x: Hoops.length - rim.x, y: rim.y)
            func far(_ p: CGPoint) -> CGPoint { CGPoint(x: Hoops.length - p.x, y: Hoops.width - p.y) }
            let loserStart = Self.inbounds(Self.along(at, Self.unit(CGPoint(x: at.x - farRim.x, y: at.y - farRim.y)), 5))
            let spots = [loserStart, far(CGPoint(x: 72, y: 8)), far(CGPoint(x: 72, y: 42)), far(CGPoint(x: 89, y: 14)), far(CGPoint(x: 64, y: 30))]
            var defense = spots.map { Self.inbounds(CGPoint(x: $0.x + random.in(-1.5...1.5), y: $0.y + random.in(-1.5...1.5))) }
            for k in 1..<5 where Self.distance(defense[k], loserStart) < 7 {
                defense[k] = Self.inbounds(Self.along(defense[k], CGPoint(x: 0, y: defense[k].y > 25 ? -1 : 1), 8))
            }
            // Ours guarding them, between each man and their rim.
            func guarding(_ man: CGPoint, _ onBall: Bool) -> CGPoint {
                let toRim = Self.unit(CGPoint(x: farRim.x - man.x, y: farRim.y - man.y))
                return Self.inbounds(Self.along(man, toRim, onBall ? 3.5 : 7))
            }
            // Which of ours took it: the shooter, the passer, or another.
            let stealer = stealerIsShooter ? 0 : stealerIsPasser ? 1 : 2
            var offense = defense.enumerated().map { guarding($1, $0 == 0) }
            offense.swapAt(0, stealer)
            script.players = offense.map { Player(team: .offense, at: $0) } + defense.map { Player(team: .defense, at: $0) }
            script.shooter = 0
            let loser = 5
            credit(stealer, steal.stealer)
            credit(loser, steal.loser)
            // He has it, going their way; ours jumps the lane and takes it.
            hold(loser, from: 0, until: open)
            bounce(loser, from: open, until: open + 0.45)
            move(loser, to: [Self.along(loserStart, Self.unit(CGPoint(x: farRim.x - loserStart.x, y: farRim.y - loserStart.y)), 3.5)],
                 from: open, to: open + 0.6)
            let takeAt = open + 0.5
            move(stealer, to: [at], from: open + 0.05, to: takeAt, ease: .out)
            act(stealer, .steal, at: takeAt, toward: position(loser, takeAt))
            fly(from: FieldPoint(position(loser, open + 0.45), z: 2.5), to: FieldPoint(at, z: 3.2), start: open + 0.45, time: takeAt - open - 0.45,
                arc: .straight)
            script.flashes.append(Flash(beat: .steal, at: takeAt, point: FieldPoint(at, z: 3)))
            // The break.
            hold(stealer, from: takeAt, until: takeAt + 0.12)
            bounce(stealer, from: takeAt + 0.12, until: .infinity)
            let dunk = scene.dunk || scene.shot == .dunk
            let jumpShot = [BasketballScene.Kind.jumper, .three].contains(scene.shot ?? scene.kind)
            var approach = self.approach(finishSpot)
            if Self.distance(finishSpot, rim) < 2.5 { approach = Self.rotate(CGPoint(x: -1, y: 0), (at.y - 25) / 25 * 0.6) }
            let takeoff = Self.along(rim, approach, dunk ? 5.4 : 4.6)
            // Ours run the lanes; theirs sprint back.
            let lanes: [CGPoint] = [CGPoint(x: 70, y: 9), CGPoint(x: 70, y: 41), CGPoint(x: 62, y: 25), CGPoint(x: 58, y: 16), CGPoint(x: 58, y: 34)]
            var laneIndex = 0
            for k in 0..<5 where k != stealer && k != 0 && !(k == 1 && stealer == 0 && scene.assister != nil) {
                move(k, to: [lanes[laneIndex % lanes.count]], from: takeAt + 0.1, to: takeAt + 2.3 + Double(k) * 0.15, ease: .inOut)
                laneIndex += 1
            }
            var t = takeAt + 0.12
            if stealer == 0, scene.assister == nil {
                // His own way, the length of the floor.
                t = drive(0, to: jumpShot ? finishSpot : takeoff, from: t, speed: 27, ease: .inOut)
            } else {
                // Ahead to whoever runs out with it.
                let receiver = stealer == 0 ? 1 : 0
                let ahead = jumpShot && receiver == 0 ? finishSpot : Self.inbounds(CGPoint(x: 66, y: approach.y >= 0 ? 34 : 16))
                let passAt = drive(stealer, to: Self.along(at, CGPoint(x: 1, y: 0), 12), from: t, speed: 20, ease: .inOut)
                script.legs[script.legs.count - 1].until = passAt
                move(receiver, to: [ahead], from: takeAt + 0.1, to: passAt + Self.distance(position(stealer, passAt), ahead) / 42 + 0.05, ease: .inOut)
                t = pass(stealer, to: receiver, at: passAt, point: ahead, style: .outlet)
                if receiver == 0 {
                    hold(0, from: t, until: jumpShot ? .infinity : t + 0.1)
                    if !jumpShot {
                        bounce(0, from: t + 0.1, until: .infinity)
                        t = drive(0, to: takeoff, from: t + 0.1, speed: 21, ease: .linear)
                    }
                } else {
                    // The give and go: back to him going to the rim.
                    hold(1, from: t, until: t + 0.15)
                    let catchAt = Self.along(rim, approach, 10)
                    move(0, to: [catchAt], from: passAt - 0.2, to: t + 0.15 + Self.distance(position(1, t + 0.15), catchAt) / 40, ease: .inOut)
                    t = pass(1, to: 0, at: t + 0.15, point: catchAt, style: .chest)
                    hold(0, from: t, until: t + 0.08)
                    bounce(0, from: t + 0.08, until: .infinity)
                    t = drive(0, to: takeoff, from: t + 0.08, speed: 20, ease: .linear)
                }
            }
            if let i = script.legs.lastIndex(where: { $0.hand == .dribble(0) }) { script.legs[i].until = t }
            if jumpShot {
                hold(0, from: t, until: .infinity)
                let lift = scene.shot == .three ? 1.3 : 1.5
                let takeoffAt = t + 0.18, airtime = 2 * (2 * lift / Self.g).squareRoot()
                jump(0, from: takeoffAt, peak: takeoffAt + airtime / 2, until: takeoffAt + airtime, height: lift)
                let releaseAt = takeoffAt + airtime / 2 - 0.03
                act(0, .shoot, at: releaseAt, toward: rim)
                if let last = script.legs.lastIndex(where: { $0.hand == .held(0) }) { script.legs[last].until = releaseAt }
                script.release = releaseAt
                let hand = release(finishSpot, lift: lift)
                let f = shoot(from: hand, to: Self.rimPoint, at: releaseAt, angle: 0.84)
                throughNet(at: f.end, way: Self.unit(CGPoint(x: rim.x - hand.x, y: rim.y - hand.y)), strength: 0.55)
                arrive = f.end
            } else {
                finishAtRim(0, approach: approach, takeoff: t, dunk: dunk, hasBall: true)
            }
            // Theirs chase back, the man who lost it first; the rest behind the ball.
            let end = (script.release ?? t) + 0.4
            for k in 5..<10 {
                let goal = k == 5 ? Self.along(rim, Self.rotate(approach, 0.7), 7) : CGPoint(x: 66 + Double(k - 5) * 3, y: 12 + Double(k - 5) * 7)
                move(k, to: [Self.inbounds(goal)], from: takeAt + 0.15 + Double(k - 5) * 0.05, to: end - Double(k - 5) * 0.05 + 0.6, ease: .inOut)
            }
        }

        /// A free throw that tied it or went ahead late: both teams on the
        /// lane, the shooter at the line, the routine and the shot.
        mutating func freeThrow() {
            guard let scene else { return }
            let line = CGPoint(x: Hoops.freeThrow - 0.6, y: 25)
            let lane: [CGPoint] = [CGPoint(x: 80, y: 33.8), CGPoint(x: 80, y: 16.2), CGPoint(x: 66, y: 38), CGPoint(x: 66, y: 12)]
            let theirs: [CGPoint] = [CGPoint(x: 64, y: 25), CGPoint(x: 84, y: 33.8), CGPoint(x: 84, y: 16.2), CGPoint(x: 76.5, y: 33.8), CGPoint(x: 76.5, y: 16.2)]
            script.players = ([line] + lane).map { Player(team: .offense, at: $0) } + theirs.map { Player(team: .defense, at: $0) }
            script.shooter = 0
            hold(0, from: 0, until: 0.55)
            bounce(0, from: 0.55, until: 1.15)
            hold(0, from: 1.15, until: 1.75)
            act(0, .shoot, at: 1.75, toward: rim)
            jump(0, from: 1.6, peak: 1.78, until: 1.95, height: 0.25)
            script.release = 1.75
            let hand = release(line, lift: 0.2)
            let f = shoot(from: hand, to: scene.made ? Self.rimPoint : FieldPoint(Self.along(rim, CGPoint(x: -1, y: 0), 0.7), z: 10.1),
                          at: 1.75, angle: 0.9)
            arrive = f.end
            if scene.made { throughNet(at: f.end, way: CGPoint(x: 1, y: 0), strength: 0.5) }
            for k in 6..<10 { act(k, .boxOut, at: f.end - 0.2, toward: position(k - 5, f.end)) }
        }

        // MARK: Defense

        /// Beaten off the dribble: from in front of him, round to his hip and
        /// a step behind as he goes by (going `way`), chasing.
        mutating func trail(_ d: Int, behind i: Int, from start: Double, to end: Double, way: CGPoint) {
            let side = Self.rotate(way, .pi / 2)
            var t = start
            while t < end - 0.01 {
                let next = min(t + 0.25, end)
                let him = position(i, next)
                let beaten = Rig.smooth((next - start) / 0.7)
                let front = guardSpot(him, ball: him, onBall: true), hip = Self.along(Self.along(him, way, -1.6), side, 2.2)
                move(d, to: [CGPoint(x: front.x + (hip.x - front.x) * beaten, y: front.y + (hip.y - front.y) * beaten)], from: t, to: next,
                     ease: .linear)
                t = next
            }
        }

        /// A hand up at the shot: a closeout's, a little hop.
        mutating func contest(_ d: Int, at t: Double, toward p: CGPoint, height: Double) {
            act(d, height > 1.6 ? .block : .contest, at: t, toward: p)
            jump(d, from: t - 0.22, peak: t + 0.02, until: t + 0.3, height: height)
        }

        /// The help at the rim: up with both arms (a block's leap when he gets it).
        mutating func contestAtRim(_ d: Int, at t: Double, blocker: Bool) {
            act(d, blocker ? .block : .contest, at: t, toward: rim)
            jump(d, from: t - 0.3, peak: t + 0.02, until: t + 0.42, height: blocker ? 2.8 : 2.0)
        }

        /// The and-one: the help takes the contact, knocked back a step.
        mutating func foulContact(_ d: Int, at t: Double) {
            credit(d, scene?.fouler)
            let here = position(d, t)
            move(d, to: [Self.along(here, out(here), 2.2)], from: t + 0.15, to: t + 0.6, ease: .out)
        }

        /// A layup or a dunk swatted at the rim: the ball cut off on its way up, sent away.
        mutating func blockAtRim(_ d: Int, shooter: Int, at t: Double, approach: CGPoint) {
            // The finish's flight (from his hand toward the rim) goes no further than the swat.
            if let i = script.flights.indices.last(where: { script.flights[$0].start >= t - 0.06 }) {
                let f = script.flights[i]
                let at = f.point(at: f.start + 0.06)
                script.flights[i] = PlayScript.Flight(start: f.start, end: f.start + 0.06, from: f.from, to: at, arc: .straight)
                if let leg = script.legs.lastIndex(where: { $0.hand == .flight(i) }) { script.legs[leg].until = f.start + 0.06 }
                script.legs.removeAll { $0.from > f.start + 0.06 }
                script.flights.removeSubrange((i + 1)...)
                script.score = nil
                script.net = nil
                swat(from: at, at: f.start + 0.06, shooterSide: approach)
            } else {
                let at = FieldPoint(Self.along(rim, approach, 2), z: 10)
                script.legs.removeAll { $0.from > t }
                swat(from: at, at: t, shooterSide: approach)
            }
        }

        /// A jump shot blocked just out of his hand.
        mutating func blockShot(_ d: Int, flight i: Int, at t: Double) {
            let f = script.flights[i]
            let at = f.point(at: t)
            script.flights[i] = PlayScript.Flight(start: f.start, end: t, from: f.from, to: at,
                                                  arc: .samples((0...8).map { f.point(at: f.start + (t - f.start) * Double($0) / 8) }))
            if let leg = script.legs.lastIndex(where: { $0.hand == .flight(i) }) { script.legs[leg].until = t }
            script.legs.removeAll { $0.from > t }
            script.flights.removeSubrange((i + 1)...)
            script.score = nil
            script.net = nil
            swat(from: at, at: t, shooterSide: out(f.from.ground))
        }

        /// The swat: away hard and down, to the credited rebounder (or the floor).
        mutating func swat(from at: FieldPoint, at t: Double, shooterSide: CGPoint) {
            guard let scene else { return }
            script.flashes.append(Flash(beat: .block, at: t, point: at))
            arrive = t
            let away = Self.rotate(shooterSide, random.in(-0.7...0.7))
            let nominal = Self.inbounds(Self.along(at.ground, away, random.in(11...16)))
            if let r = rebounder(for: scene.rebound, near: nominal, at: t, exclude: [0]) {
                credit(r, scene.rebound?.person)
                let land = reach(r, toward: nominal, from: t + 0.06, by: t + 0.5)
                let time = min(max(Self.distance(at.ground, land) / 30, 0.3), 0.55)
                fly(from: at, to: FieldPoint(land, z: 6), start: t, time: time, arc: .arc(1.2))
                takeRebound(r, at: land, arrives: t + time, from: t + 0.06)
            } else {
                fly(from: at, to: FieldPoint(nominal, z: 2.2), start: t, time: 0.48, arc: .arc(1.4))
                dropToFloor(from: FieldPoint(nominal, z: 2.2), at: t + 0.48, drift: CGPoint(x: away.x * 6, y: away.y * 6), downward: 14)
            }
        }

        /// A miss off the rim to the rebounder (or the floor).
        mutating func rimMiss(from shooter: CGPoint, at t: Double, exclude: Set<Int>) {
            guard let scene else { return }
            let o = out(shooter)
            let long = Self.distance(shooter, rim) > 18
            let nominal = Self.inbounds(Self.along(rim, Self.rotate(o, random.in(-1.2...1.2)), long ? random.in(10...15) : random.in(6...9)))
            let after = script.release ?? t - 1
            if let r = rebounder(for: scene.rebound, near: nominal, at: t, exclude: exclude) {
                credit(r, scene.rebound?.person)
                let land = reach(r, toward: nominal, from: after, by: t + 0.75)
                let caught = rimOut(at: t, from: shooter, back: false, catchAt: land, height: 8)
                takeRebound(r, at: land, arrives: caught, from: after)
            } else {
                let caught = rimOut(at: t, from: shooter, back: false, catchAt: nominal, height: 8)
                dropToFloor(from: FieldPoint(nominal, z: 8), at: caught, drift: CGPoint(x: o.x * 4, y: o.y * 4), downward: 6)
            }
        }

        /// After a shot goes up, the defense finds the offense's bigs and boxes out.
        mutating func boxOut(after t: Double) {
            for k in 6..<10 where script.players[k].actions.isEmpty {
                let man = position(k - 5, t + 0.4)
                guard Self.distance(man, rim) < 16 else { continue }
                let spot = Self.along(man, Self.unit(CGPoint(x: rim.x - man.x, y: rim.y - man.y)), 2.2)
                move(k, to: [spot], from: t + 0.05, to: t + 0.45, ease: .out)
                act(k, .boxOut, at: t + 0.3, toward: man)
            }
        }

        // MARK: End and settle

        /// After the basket: the shooter back down, the offense turning to get
        /// back, a defender taking the ball out from under the basket.
        mutating func aftermath() {
            guard let scene else { return }
            sortLegs()
            guard let score = script.score, scene.made else { return }
            for k in 1..<5 where (script.players[k].moves.last?.end ?? 0) < score + 0.3 {
                let here = position(k, score)
                move(k, to: [CGPoint(x: here.x - 6, y: here.y + (25 - here.y) * 0.15)], from: score + 0.35, to: score + 1.5, ease: .inOut)
            }
            if let ball = script.ball(at: score + 1.2)?.ground {
                let inbounder = (5..<10).min { Self.distance(position($0, score), ball) < Self.distance(position($1, score), ball) } ?? 9
                if script.players[inbounder].jumps.allSatisfy({ $0.until < score + 0.2 }) {
                    move(inbounder, to: [Self.inbounds(Self.along(ball, CGPoint(x: 1, y: 0), 1.5))], from: score + 0.5, to: score + 1.4, ease: .inOut)
                }
            }
        }

        /// The action ends when the last thing stops; the stamp lands a beat
        /// after the net (the block, the rebound).
        mutating func finish() {
            guard scene != nil else { return }
            sortLegs()
            if let score = script.score {
                script.stamp = score + 0.18
            } else if let block = script.flashes.first(where: { $0.beat == .block }) {
                script.stamp = block.at + 0.35
            } else {
                script.stamp = max(arrive + 0.3, open + 0.6)
            }
            let hold = 0.35
            let ends = [script.stamp + hold + 0.4, min(over, script.stamp + 1.0), (script.flashes.map(\.at).max() ?? 0) + 0.4]
            script.settle = max(ends.max() ?? 0, 1.5) + hold
        }

        /// The headline for a marquee play, landing with its payoff.
        mutating func headline() {
            guard let scene else { return }
            func banner(_ text: String, _ tone: Banner.Tone, at time: Double, confetti: Bool = false) {
                script.banner = Banner(text: text, tone: tone, at: time, until: max(script.settle, time + 1.5), confetti: confetti)
            }
            if scene.result == .blocked, let block = script.flashes.first(where: { $0.beat == .block }) {
                banner("REJECTED", .side(scene.defense), at: block.at + 0.04)
                return
            }
            guard scene.made, let at = script.score else { return }
            if scene.buzzer {
                banner("BUZZER-BEATER", scene.decisive ? .gold : .side(scene.offense), at: at, confetti: true)
            } else if scene.posterized {
                banner("POSTERIZED", .side(scene.offense), at: at)
            } else if scene.andOne {
                banner("AND-ONE", .side(scene.offense), at: at + 0.1)
            } else if scene.dunk {
                banner("DUNK", .side(scene.offense), at: at)
            }
        }

        /// The stamp's corner, measured from its type as the frame sets it:
        /// the number at a fifth of the view's height; the lines under it at
        /// about an eighteenth, narrowed to fit under 44% of the width; in a
        /// view twice as wide as tall.
        mutating func measureStamp() {
            guard let scene else { return }
            let stamp = BasketballStamp(scene)
            var code = 0.0
            for part in stamp.parts {
                code += part.text.reduce(0.0) { width, c in width + (c.isNumber ? 0.6 : c == "+" ? 0.62 : 0.7) } * (part.heavy ? 1 : 0.42) + 0.16
            }
            let number = (0.055 + code * 0.2) / CameraFrame.aspect
            let line = min(Double(stamp.lines.map(\.count).max() ?? 0) * 0.66 * 0.056 / CameraFrame.aspect, 0.44) + 0.03
            script.corner = CGSize(width: max(number, line) + 0.03, height: 0.27 + 0.065 * Double(stamp.lines.count))
        }

        /// After the hold everyone stays where it ended.
        mutating func settle() {
            script.duration = script.settle + 0.3
        }

        // MARK: Camera

        /// Cuts the play into shots: the set in the half court; each pass with
        /// the man it goes to; the shot with the shooter and the rim; the
        /// finish tight on the rim; then where it ended.
        mutating func shoot() {
            let everyone = Array(script.players.indices)
            var shots = [Shot(from: 0, actors: everyone, points: [Self.rimPoint], closest: 38, at: 0)]
            if let steal = script.flashes.first(where: { $0.beat == .steal }) {
                // The steal: the two of them; then the break, with the man who has it and the rim ahead.
                shots[0] = Shot(from: 0, actors: [5, script.players.indices.min { Self.distance(position($0, steal.at), steal.point.ground) < Self.distance(position($1, steal.at), steal.point.ground) } ?? 0],
                                points: [steal.point], closest: 32)
                shots.append(Shot(from: steal.at + 0.35, actors: [0], points: [Self.rimPoint], closest: 40, carrier: true))
            }
            let release = script.release ?? 0
            // The passes (not the shot): each with the man it goes to.
            for (i, f) in script.flights.enumerated() where f.start > open && f.start < release - 0.05 && f.end - f.start > 0.25 {
                let near = script.players.indices.min { a, b in
                    Self.distance(position(a, f.end), f.to.ground) < Self.distance(position(b, f.end), f.to.ground)
                }
                shots.append(Shot(from: max(f.start - 0.25, (shots.last?.from ?? 0) + 0.3), flight: i, actors: near.map { [$0] } ?? [],
                                  points: [Self.rimPoint], closest: 32))
            }
            // The shot: the shooter, the ball and the rim; the finish tight on it.
            if let shooter = script.shooter {
                let from = max(release - 0.5, (shots.last?.from ?? 0) + 0.3)
                let shot = script.flights.indices.first { script.flights[$0].start >= release - 0.06 && script.flights[$0].start <= release + 0.1 }
                shots.append(Shot(from: from, flight: shot, actors: [shooter], points: [Self.rimPoint], closest: 28))
            }
            // The end: the rim, the shooter, where the ball went.
            var ending: [FieldPoint] = [Self.rimPoint]
            if let ball = script.ball(at: script.settle) { ending.append(FieldPoint(ball.ground)) }
            let endFrom = min(max(script.stamp - 0.35, (shots.last?.from ?? 0) + 0.3), script.settle - 0.2)
            shots.append(Shot(from: endFrom, actors: script.shooter.map { [$0] } ?? [], points: ending, closest: 30))
            script.shots = shots

            let banner = script.banner.map { $0.at...$0.until }
            let corner = CGSize(width: script.corner.width + 0.03, height: script.corner.height + 0.04), stamp = script.stamp
            let script = self.script
            let restRegion = restRegion()
            func goal(_ t: Double) -> CameraFrame {
                let k = shots.lastIndex { $0.from <= t } ?? 0
                let shot = shots[k]
                var items = shot.region(in: script, at: t)
                var region = items.isEmpty ? restRegion : items.reduce(items[0]) { $0.union($1) }
                var closest = shot.closest
                if k > 0, !shot.cut {
                    let before = shots[k - 1].region(in: script, at: t)
                    if !before.isEmpty {
                        let a = before.reduce(before[0]) { $0.union($1) }
                        let blend = CameraRig.blend(from: a, to: region, elapsed: t - shot.from)
                        if blend.u < 1 {
                            region = blend.region
                            closest = shots[k - 1].closest + (closest - shots[k - 1].closest) * blend.u
                            items += before
                        }
                    }
                }
                let headroom = CameraRig.headroom(at: t, banner: banner)
                guard stamp.isFinite, t >= stamp - 0.3 else { return CameraFrame.fitting(region, headroom: headroom, closest: closest, tightest: Hoops.tightest) }
                let others = script.players.indices.flatMap { i in [t, t + 0.4].map { script.room(FieldPoint(script.players[i].position(at: $0)), figure: true) } }
                guard t > script.settle else {
                    return CameraFrame.clearing(region, items: items, others: others, headroom: headroom, closest: closest, corner: corner,
                                                tightest: Hoops.tightest)
                }
                return CameraFrame.clearing(restRegion, items: others.filter { restRegion.intersects($0) }, others: others, headroom: headroom,
                                            closest: 32, corner: corner, tightest: Hoops.tightest)
            }
            let rest = restFrame()
            let followed = script.duration
            let samples = CameraRig.follow(until: followed, goal: goal)
            let last = samples.last ?? rest
            let pan = hypot(last.x - rest.x, last.y - rest.y) / min(last.span, rest.span), zoom = log(rest.span / last.span)
            let glide = max(0.4, 1.5 * pan / 1.25, 1.5 * abs(zoom) / (zoom > 0 ? 2 : 1))
            self.script.duration = max(followed + glide, (script.banner?.until ?? 0) + 0.3)
            self.script.camera = CameraPath(samples: samples, settle: followed, back: followed + glide, rest: rest)
        }

        /// What the camera rests on: the rim and everyone near the end of it.
        func restRegion() -> CGRect {
            let t = script.settle + 2
            var items = script.players.indices.map { script.room(FieldPoint(script.players[$0].position(at: t)), figure: true) }
            let rim = script.room(Self.rimPoint, figure: false)
            items = items.filter { abs($0.midX - rim.midX) < 34 }
            items.append(rim)
            if let ball = script.ball(at: t) { items.append(script.room(FieldPoint(ball.ground), figure: false)) }
            return items.dropFirst().reduce(items[0]) { $0.union($1) }
        }

        func restFrame() -> CameraFrame {
            let t = script.settle + 2
            let region = restRegion()
            let items = script.players.indices.map { script.room(FieldPoint(script.players[$0].position(at: t)), figure: true) }
            return CameraFrame.clearing(region, items: items.filter { region.intersects($0) }, others: items, headroom: CameraFrame.headroom,
                                        closest: 32, corner: script.corner, tightest: Hoops.tightest)
        }
    }
}

private extension CGPoint {
    var negated: CGPoint { CGPoint(x: -x, y: -y) }
    var normalized: CGPoint {
        let d = hypot(x, y)
        return d > 1e-9 ? CGPoint(x: x / d, y: y / d) : self
    }
}

// MARK: - Shots

extension BasketballScript {
    /// One shot of the broadcast: from when, and what it keeps in frame.
    struct Shot: Equatable {
        var from: Double
        /// A flight's ball, now and a beat ahead.
        var flight: Int? = nil
        /// Players by index, now and a beat ahead.
        var actors: [Int] = []
        /// Fixed spots: the rim.
        var points: [FieldPoint] = []
        /// No closer than this (feet top to bottom).
        var closest = 48.0
        var cut = false
        /// Players framed where they stood at this moment (the set), not as they move.
        var at: Double? = nil
        /// Whoever has the ball, too.
        var carrier = false

        /// What it keeps in frame at t: each figure's or ball's room.
        func region(in script: BasketballScript, at t: Double) -> [CGRect] {
            var items = points.map { script.room($0, figure: false) }
            if let flight, flight < script.flights.count {
                let f = script.flights[flight]
                for dt in [0, 0.2, 0.45] {
                    let p = f.point(at: min(max(t + dt, f.start), f.end))
                    items.append(script.room(p, figure: false))
                    items.append(script.room(FieldPoint(p.ground), figure: false))
                }
            }
            var people = actors
            if carrier, let c = script.carrier(at: t)?.player { people.append(c) }
            for index in people where index < script.players.count {
                let player = script.players[index]
                if let fixed = at {
                    items.append(script.room(FieldPoint(player.position(at: fixed)), figure: true))
                    continue
                }
                for dt in [0, 0.25] {
                    items.append(script.room(FieldPoint(player.position(at: t + dt), z: player.lift(at: t + dt)), figure: true))
                }
            }
            if carrier, let ball = script.ball(at: t + 0.3) { items.append(script.room(ball, figure: false)) }
            return items
        }
    }
}

// MARK: - Stamp

/// The stamp for a play, low on the left as it resolves, in the box score's
/// own words: the points heavy in the scoring team's color ("+3"), "BLK" in
/// the blocker's, "MISS"; the shot under it as the play-by-play names it
/// ("BROWN JR. · 23 FT JUMP SHOT"), then the assist, the steal, the
/// rebound ("AST ELLIS", "STL DEMIN", "REB HAUSER"). Between the shots, a
/// rebound's "REB", a steal's "STL", a turnover's "TO". (pure; tested)
struct BasketballStamp: Equatable {
    struct Part: Equatable {
        var text: String
        var heavy: Bool
    }

    enum Tone: Equatable {
        /// The shooting team's color: a basket.
        case score
        /// The blocking team's.
        case block
        case neutral
    }

    var parts: [Part] = []
    /// The lines under the number, each in small capitals.
    var lines: [String] = []
    var tone = Tone.neutral

    init(_ scene: BasketballScene) {
        let shooter = scene.shooter?.name.uppercased() ?? ""
        func line(_ words: String?...) -> String { words.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ") }
        // The ball plays between the shots: a rebound, a steal, a turnover in
        // the open floor. A whistle has its tag, not a stamp.
        switch scene.kind {
        case .offensiveRebound, .defensiveRebound:
            parts = [Part(text: "REB", heavy: true)]
            tone = .score
            lines = [line(shooter.isEmpty ? "TEAM" : shooter, scene.kind == .offensiveRebound ? "OFFENSIVE REBOUND" : "DEFENSIVE REBOUND")]
            return
        case .steal, .turnover:
            let what = BasketballScene.callWords(scene.typeText)
            if let stealer = scene.steal?.stealer?.name, !stealer.isEmpty, scene.kind == .steal {
                parts = [Part(text: "STL", heavy: true)]
                tone = .block
                lines = [stealer.uppercased(), line(shooter, what)]
            } else {
                parts = [Part(text: "TO", heavy: true)]
                lines = [line(shooter, what)]
            }
            return
        case .foul, .violation, .jumpBall, .substitution, .timeout, .periodEnd, .challenge:
            return
        default:
            break
        }
        // The shot as ESPN's play-by-play names it, with its distance from 4 ft out.
        let name = scene.typeText.uppercased().replacingOccurrences(of: " - ", with: " ")
        let feet = scene.distance.flatMap { $0 >= 4 && scene.kind != .freeThrow ? "\(Int($0)) FT" : nil }
        let shot = [feet, name.isEmpty ? nil : name].compactMap { $0 }.joined(separator: " ")
        var credits: [String] = []
        if let a = scene.assister?.name, !a.isEmpty { credits.append("AST \(a.uppercased())") }
        if let s = scene.steal?.stealer?.name, !s.isEmpty, scene.made { credits.append("STL \(s.uppercased())") }
        switch scene.result {
        case .make:
            parts = [Part(text: "+\(scene.points)", heavy: true)]
            if scene.kind == .freeThrow { parts.append(Part(text: "FT", heavy: false)) }
            else if scene.value == 3 { parts.append(Part(text: "3PT", heavy: false)) }
            tone = .score
            lines = [line(shooter, shot)]
        case .blocked:
            parts = [Part(text: "BLK", heavy: true)]
            tone = .block
            lines = [scene.blocker?.name.uppercased() ?? "", line(shooter, shot)]
        case .miss:
            parts = [Part(text: "MISS", heavy: true)]
            if scene.value == 3 { parts.append(Part(text: "3PT", heavy: false)) }
            lines = [line(shooter, shot)]
            if let r = scene.rebound?.person?.name, !r.isEmpty { credits.append("REB \(r.uppercased())") }
        }
        if !credits.isEmpty { lines.append(credits.joined(separator: " · ")) }
        lines = lines.filter { !$0.isEmpty }
    }
}
