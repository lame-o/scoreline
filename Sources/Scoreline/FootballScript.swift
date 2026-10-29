import SwiftUI

// The football theater's choreography: a `FootballScene` turned into every
// player's path, the ball's flights and carries, the beats (the catch, the
// hit, the flag), the lines on the field and the camera's shots, in feet and
// seconds from the start of the replay. Built once per play; any frame is a
// pure function of the script and t, so the harness can draw t = 2.1
// without playing 0…2.1, and the tests can check that a pass reaches its
// receiver where ESPN says it was caught.
//
// The field is drawn from behind the offense, as a broadcast's end-zone
// camera sees it: x across (the offense's right is +), y downfield from its
// own goal line, z up. The offense lines up as the play says (in the gun or
// under center, heavy, empty, a bunch, the punt and field-goal units, the
// kickoff), round the ball on its hash. Time is a replay's: the snap after
// half a second on the formation, everything after it about one and a half
// times the game's speed, so a snap runs 2–5 s, and the stamp holds a third
// of a second on it. Then the field settles: on a new down the two teams jog
// back to the new line; after a score, a kick or a turnover they hold where
// it ended. A touchdown's try is a scene of its own, a shorter beat.
//
// The play is told in the order it happened, by the men ESPN credits: the
// defense in its own base front, each man in his depth-chart slot; the rush
// that got home as he threw; the strip, the scramble for the ball and who
// came up with it, then the return; the kick blocked at the line; each flag
// thrown by the nearest official when and where its foul happened, and the
// yards walked off after.

// MARK: - The field

/// The field in feet, in the offense's frame: its own goal line at y = 0,
/// the one it attacks at 300, the sidelines at x = ±80.
enum Gridiron {
    static let yard = 3.0
    static let half = 80.0
    static let endZone = 30.0
    /// The inbound lines (hash marks): 70 ft 9 in from each sideline.
    static let hash = 9.25
    /// The yard numbers' centers across: about 10 yards in from the sidelines.
    static let numbers = 50.0
    static let crossbar = 10.0
    /// The uprights: 18 ft 6 in apart, 35 ft above the crossbar.
    static let upright = 9.25
    static let uprightTop = 45.0
    /// The goalposts stand on the end lines.
    static let backLine = 330.0

    static func y(_ yard: Double) -> Double { yard * Self.yard }

    /// Where the ball sits across the field on a hash: on the marks, 18 ft 6 in apart.
    static func spot(_ hash: FootballScene.Lane) -> Double {
        switch hash {
        case .left: -(Self.hash - 1)
        case .right: Self.hash - 1
        case .middle: 0
        }
    }

    /// The camera's yaw: the field turned a third of the way round, so the
    /// offense attacks up and to the right and the field reads in depth
    /// (straight from behind, a squashed rectangle reads flat). A kick at the
    /// posts is shot straight from behind, as broadcasts do, so its line
    /// through (or past) the uprights is plain.
    static let yaw = 30.0 * .pi / 180

    /// A point on the field as the camera's projection takes it (x across the view, y into it).
    static func view(_ p: CGPoint, yaw: Double = yaw) -> CGPoint {
        CGPoint(x: p.x * cos(yaw) + p.y * sin(yaw), y: -p.x * sin(yaw) + p.y * cos(yaw))
    }

    static func view(_ p: FieldPoint, yaw: Double = yaw) -> FieldPoint { FieldPoint(view(p.ground, yaw: yaw), z: p.z) }

    /// The room the camera keeps round a spot on the field.
    static func room(_ p: FieldPoint, figure: Bool, yaw: Double = yaw) -> CGRect { CameraRig.room(view(p, yaw: yaw), figure: figure) }
}

/// The field's projection through the camera at a yaw.
struct GridProjection {
    let f: FieldProjection
    let yaw: Double

    init(size: CGSize, camera: CameraFrame, yaw: Double) {
        f = FieldProjection(size: size, camera: camera)
        self.yaw = yaw
    }

    func point(_ p: CGPoint, z: Double = 0) -> CGPoint { f.point(Gridiron.view(p, yaw: yaw), z: z) }
    func point(_ p: FieldPoint) -> CGPoint { f.point(Gridiron.view(p, yaw: yaw)) }

    var size: CGSize { f.size }
    var camera: CameraFrame { f.camera }
    var scale: CGFloat { f.scale }
    var figure: CGFloat { f.figure }
    var bounds: Path { f.bounds }
}

// MARK: - Script

struct FootballScript: Equatable {
    /// The two teams, the official who throws a flag, and the trainers who come out to a man hurt.
    enum Team { case offense, defense, official, staff }

    /// Who he is on the play: his stance and pose follow from it.
    enum Role: Equatable {
        case line, quarterback, back, receiver, tightEnd
        case front, backer, corner, safety
        case kicker, holder, punter, returner, cover
        case official
    }

    /// A moment of the play in his hands.
    struct Action: Equatable {
        enum Kind: Equatable {
            case catchHigh, catchChest, throwBall, handoff, kick, tackle, block, spike, scoop
            /// A punch at the ball in another man's arms: the strip.
            case strip
            /// Laid out on the grass for a loose ball.
            case scramble
            /// An official's flag, thrown.
            case flagThrow
            /// Up off the line, both arms high: a kick blocked.
            case leap
        }
        var kind: Kind
        var at: Double
        /// Where the ball comes from or goes: he turns to face it.
        var toward: CGPoint
    }

    /// A pose held from a moment on: on a knee, down after the tackle, both
    /// arms up in the end zone, a hand up for the fair catch, on his back
    /// after a hit as he threw.
    struct Hold: Equatable {
        enum Kind: Equatable { case kneel, down, touchdown, fairCatch, knocked }
        var kind: Kind
        var from: Double
        var until = Double.infinity
    }

    /// Where a man looks from a moment on when he's standing (in a huddle,
    /// its middle; lined up, across the line): between snaps, not in them.
    struct Look: Equatable {
        var from: Double
        var point: CGPoint
    }

    struct Player: Equatable {
        var team: Team
        var at: CGPoint
        var role: Role
        /// The depth-chart slot he lines up in ("lde", "rcb", "ss", "lt"):
        /// a credited man is this man, on this side.
        var key: String? = nil
        var moves: [PlayScript.Move] = []
        var actions: [Action] = []
        var holds: [Hold] = []
        var looks: [Look] = []
        /// In his stance until the snap, and again once he's set at the new line.
        var set: Double?
        var resets: Double?
        var appear = -Double.infinity
        var vanish = Double.infinity

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

        /// Feet a second along the ground at t, and which way (nil: standing).
        func motion(at t: Double) -> (speed: Double, heading: CGPoint)? {
            guard let move = moves.last(where: { t >= $0.start }), t < move.end, move.length > 0.5 else { return nil }
            let a = move.point(at: max(t - 0.02, move.start)), b = move.point(at: min(t + 0.02, move.end))
            let d = hypot(b.x - a.x, b.y - a.y), dt = min(t + 0.02, move.end) - max(t - 0.02, move.start)
            guard d > 0.01, dt > 0 else { return nil }
            return (d / dt, CGPoint(x: (b.x - a.x) / d, y: (b.y - a.y) / d))
        }

        func hold(at t: Double) -> Hold? { holds.last { t >= $0.from && (t < $0.until || !$0.until.isFinite) } }

        func inStance(at t: Double) -> Bool { set.map { t < $0 } == true || resets.map { t >= $0 } == true }

        mutating func act(_ kind: Action.Kind, at time: Double, toward point: CGPoint) {
            actions.append(Action(kind: kind, at: time, toward: point))
        }

        mutating func move(to path: [CGPoint], from start: Double, to end: Double, ease: PlayScript.Ease = .inOut) {
            moves.removeAll { $0.start >= start }
            let origin = position(at: start)
            guard let last = path.last, hypot(last.x - origin.x, last.y - origin.y) > 0.5 || path.count > 1 else { return }
            moves.append(PlayScript.Move(start: start, end: max(end, start + 0.05), path: [origin] + path, ease: ease))
        }
    }

    /// Where the ball is, leg by leg: in the air, in someone's hands, on the ground.
    struct Leg: Equatable {
        enum Hand: Equatable {
            case flight(Int)
            case carry(Int)
            case spot(FieldPoint)
            /// Slid along the ground between two spots (a flag's yards walked off).
            case slide(from: FieldPoint, to: FieldPoint)
        }
        var from: Double
        var until: Double
        var hand: Hand
    }

    enum Beat { case snap, kick, catchBall, hit, deflect, flag }

    struct Flash: Equatable {
        var beat: Beat
        var at: Double
        var point: FieldPoint
    }

    /// The broadcast's lines: the line of scrimmage (blue) and the line to
    /// gain (yellow), in feet down the field; nil: not drawn.
    struct Lines: Equatable {
        var scrimmage: Double?
        var gain: Double?
    }

    /// A flag thrown in: from where, to where, when it lands; a declined
    /// one says so beside it once the play is over.
    struct Flag: Equatable {
        var thrown: Double
        var lands: Double
        var from: FieldPoint
        var to: CGPoint
        var declined = false
        /// A coach's red challenge flag, thrown in from his bench.
        var red = false
    }

    /// A flag's yards walked off: the spot moves from one line to another.
    struct March: Equatable {
        var from: Double
        var to: Double
        var start: Double
        var end: Double
    }

    /// The headline across the top for a marquee play: TOUCHDOWN, FIELD
    /// GOAL, INTERCEPTION. It lands with the payoff and clears as the field settles.
    struct Banner: Equatable {
        enum Tone: Equatable {
            /// A team's own color: its score.
            case side(GameDetail.Side?)
            /// Turnovers and misses: neutral ink.
            case neutral
            /// A game-winner.
            case gold
        }
        var text: String
        var tone: Tone
        var at: Double
        var until: Double
        /// It brings its own confetti (a touchdown).
        var confetti: Bool
    }

    var players: [Player] = []
    var flights: [PlayScript.Flight] = []
    var legs: [Leg] = []
    var flashes: [Flash] = []
    /// The lines through the snap, and after the play (they move at `linesMove`).
    var lines = Lines()
    var next = Lines()
    var linesMove = Double.infinity
    /// Every flag on the play, in the order they're thrown.
    var flags: [Flag] = []
    var march: March?
    var banner: Banner?
    /// When the stamp lands.
    var stamp = Double.infinity
    /// The touchdown's moment (the ball crossing the goal line) or the kick's
    /// (crossing the crossbar), and where: the celebration's.
    var score: Double?
    var scorePoint: FieldPoint?
    /// Where the play ended: the end spot.
    var end: FieldPoint?
    var settle = 0.0
    var duration = 0.0
    /// The stamp's corner of the view (bottom left), as fractions of its
    /// width and height: the camera keeps the play out of it.
    var corner = CGSize.zero
    var shots: [Shot] = []
    var camera = CameraPath(rest: CameraFrame(x: 0, y: 60, span: 80))
    var yaw = Gridiron.yaw
    /// The ball is put away from here (a kick that's through the posts).
    var ballGone = Double.infinity
    /// Each player's motion through the replay (his heading, stride and
    /// footfalls), measured once: by player.
    var rig: [RigTrack] = []
    /// Between snaps (FootballIdle.swift): the loop its beats come round in,
    /// the field turning as the teams change ends, and when anything moves.
    var loop: Loop?
    var turn: Turn?
    var beats: [ClosedRange<Double>] = []

    /// The room the camera keeps round a spot, at this script's yaw.
    func room(_ p: FieldPoint, figure: Bool) -> CGRect { Gridiron.room(p, figure: figure, yaw: yaw) }

    /// The first flag thrown.
    var flag: Flag? { flags.first }

    /// The ball at t: in the air, in hand, on the ground.
    func ball(at t: Double) -> FieldPoint? {
        guard let first = legs.first, !(ballGone.isFinite && t >= ballGone) else { return nil }
        let leg = t < first.from ? first : legs.last { t >= $0.from } ?? first
        let at = min(max(t, leg.from), leg.until)
        switch leg.hand {
        case let .flight(i):
            return i < flights.count ? flights[i].point(at: at) : nil
        case let .carry(p):
            return p < players.count ? FieldPoint(players[p].position(at: at), z: 3.4) : nil
        case let .spot(point):
            return point
        case let .slide(from, to):
            let u = PlayScript.Ease.inOut.value(leg.until > leg.from ? (at - leg.from) / (leg.until - leg.from) : 1)
            return FieldPoint(x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u, z: from.z)
        }
    }

    /// Who has the ball in his hands at t (as `ball(at:)` has it), since
    /// when, and until when it leaves them (∞: it never does).
    func carrier(at t: Double) -> (player: Int, from: Double, until: Double)? {
        guard let i = legs.lastIndex(where: { t >= $0.from }), case let .carry(p) = legs[i].hand else { return nil }
        return (p, legs[i].from, i + 1 < legs.count ? legs[i].until : .infinity)
    }

    /// The ball's flight at t, when it's in the air.
    func flight(at t: Double) -> PlayScript.Flight? {
        guard let leg = legs.last(where: { t >= $0.from }), t <= leg.until, case let .flight(i) = leg.hand, i < flights.count else { return nil }
        return flights[i]
    }

    /// A line at t: where it is, and how strongly it's drawn (it fades in or
    /// out when there's a line on only one side of the move).
    static func line(_ a: Double?, _ b: Double?, u: Double) -> (y: Double, opacity: Double)? {
        switch (a, b) {
        case let (a?, b?): return (a + (b - a) * u, 1)
        case let (a?, nil): return u < 1 ? (a, 1 - u) : nil
        case let (nil, b?): return u > 0 ? (b, u) : nil
        default: return nil
        }
    }

    /// How far the lines have moved at t (0 to 1, eased).
    func linesProgress(at t: Double) -> Double {
        guard linesMove.isFinite else { return 0 }
        return PlayScript.Ease.inOut.value((t - linesMove) / 0.45)
    }
}

// MARK: - Building

extension FootballScript {
    /// Between plays with nothing replayed: the offense set at its line.
    struct Rest: Equatable {
        /// Yards from the offense's own goal line.
        var yard: Double
        var gain: Double?
    }

    init(rest: Rest, yaw: Double = Gridiron.yaw) {
        var b = Builder(scene: nil, line: Gridiron.y(rest.yard), shotgun: true)
        b.script.yaw = yaw
        b.scrimmage()
        for i in b.script.players.indices where b.script.players[i].set != nil { b.script.players[i].resets = 0 }
        b.script.lines = Lines(scrimmage: Gridiron.y(rest.yard), gain: rest.gain.map(Gridiron.y))
        b.script.next = b.script.lines
        b.script.legs = [Leg(from: 0, until: 0, hand: .spot(FieldPoint(x: 0, y: Gridiron.y(rest.yard), z: 0.6)))]
        b.script.camera = CameraPath(rest: b.restFrame())
        self = b.script
        measureBodies()
    }

    init(_ scene: FootballScene) { self.init(scene, yaw: Gridiron.yaw) }

    /// A snap's replay, the field facing as `yaw` turns it (FieldFacing: up
    /// and to the right when the offense attacks the screen's right).
    init(_ scene: FootballScene, yaw: Double) {
        var b = Builder(scene: Self.played(scene) ?? scene, ruling: scene, line: Gridiron.y(scene.from), shotgun: scene.shotgun)
        b.script.yaw = yaw
        b.build()
        self = b.script
        measureBodies()
    }

    /// A snap a flag wiped out ("… - No Play"), as it was run before the
    /// flag came back: ESPN types it a penalty, but its words say what
    /// happened (a pass, a run, a sack) and where he was stopped. Nil for a
    /// flag that stopped the snap, or a play the words don't name. (pure; tested)
    static func played(_ scene: FootballScene) -> FootballScene? {
        guard scene.kind == .penalty, !scene.flags.contains(where: { $0.timing == .beforeSnap && $0.status == .accepted }) else { return nil }
        let words = FootballScene.playText(scene.text).lowercased()
        let kind: FootballScene.Kind
        if words.contains("sacked") { kind = .sack }
        else if words.contains("kneels") || words.contains("kneel down") { kind = .kneel }
        else if words.contains(" pass ") || words.hasPrefix("pass ") { kind = words.contains("incomplete") ? .incomplete : .pass }
        else if words.contains(" rush") || words.contains("scrambles") || scene.gap != nil || words.contains(" up the middle") { kind = .rush }
        else { return nil }
        var played = scene
        played.kind = kind
        played.to = scene.stopped ?? scene.from
        played.scoring = nil
        played.flips = false
        played.onDowns = false
        played.penalty = nil
        played.flags = []
        played.stopped = nil
        // The depth the words give, at the medians caught passes are thrown to (5 yards short, 20 deep).
        if kind == .pass || kind == .incomplete {
            let gain = played.to - scene.from
            played.air = kind == .pass ? min(gain, scene.depth == .deep ? 20 : 5) : scene.depth == .deep ? 20 : 5
        }
        return played
    }

    /// Each player's motion, measured once (`RigTrack`, an 8.5 ft figure),
    /// and what each faces when he isn't running somewhere: the ball he's
    /// taking, throwing or tackling at; dropping back before the ball's away
    /// (a quarterback's drop, a defender's backpedal), up the field; once
    /// it's live, the ball; else up the field, his own way.
    mutating func measureBodies() {
        let snap = players.compactMap(\.set).min() ?? 0.5, settle = settle, script = self
        rig = players.map { player in
            let way: Double = player.team == .offense ? 1 : -1
            return RigTrack(from: 0, through: duration, height: 8.5, position: player.position(at:)) { t in
                let here = player.position(at: t), ahead = CGPoint(x: here.x, y: here.y + 60 * way)
                if let a = player.actions.first(where: { t > $0.at - 0.45 && t < $0.at + 0.2 }) {
                    return RigFacing(point: a.kind == .spike || a.kind == .kick ? ahead : a.toward)
                }
                if let look = player.looks.last(where: { t >= $0.from }) { return RigFacing(point: look.point) }
                if t > snap, t < snap + 1.6 {
                    let a = player.position(at: t - 0.05), b = player.position(at: t + 0.05)
                    if (b.y - a.y) * way < -0.5 * hypot(b.x - a.x, b.y - a.y) { return RigFacing(point: ahead, always: true) }
                }
                if t > snap + 0.3, t < settle, let ball = script.ball(at: t), hypot(ball.x - here.x, ball.y - here.y) > 2 {
                    return RigFacing(point: ball.ground)
                }
                return RigFacing(point: ahead)
            }
        }
    }

    /// Assembles a script beat by beat.
    struct Builder {
        /// The play as it was run.
        let scene: FootballScene?
        /// The play as it stands: the same, unless a flag wiped it out (the
        /// spot, the lines, the stamp and the flags are its).
        let ruling: FootballScene?
        var script = FootballScript()
        /// The line of scrimmage, in feet.
        let line: Double
        let shotgun: Bool
        /// Where the ball sits across the field: on its hash (a kickoff and
        /// a try from the middle).
        let ballX: Double
        /// The ball is snapped a beat after the replay opens on the
        /// formation (a try's beat is shorter).
        let snap: Double
        /// Players by their place in the formation.
        var slots: [Slot: Int] = [:]
        /// When the action is over (the tackle, the ball coming down), before a flag's walk.
        var over = 0.0
        /// The play's moments, for a flag's: the throw, the ball arriving, the stop (and where).
        var release: Double?
        var arrival: (at: Double, point: CGPoint)?
        var stop: (at: Double, point: CGPoint)?
        /// When a loose ball was recovered.
        var recoveredAt: Double?
        /// The formation's strong side (the tight end's): 1 the offense's right, −1 its left.
        var strong = 1.0
        /// Shots to come.
        var shots: [Shot] = []

        enum Slot: Hashable {
            case center, guardLeft, guardRight, tackleLeft, tackleRight, quarterback, back
            /// The strong side's tight end and wide receiver, the slot inside
            /// them, and the wide receiver alone on the weak side.
            case tightEnd, wideStrong, slot, wideWeak
            /// A second tight end off the line, a fullback, a lineman reported in.
            case wing, fullback, extra
            case front(Int), backer(Int), corner(Int), safety(Int)
            case kicker, holder, punter, returner, deep, gunner(Int), protector(Int), lineman(Int), rusher(Int), cover(Int), setup(Int)
        }

        init(scene: FootballScene?, ruling: FootballScene? = nil, line: Double, shotgun: Bool) {
            self.scene = scene
            self.ruling = ruling ?? scene
            self.line = line
            self.shotgun = shotgun
            ballX = scene.map { $0.kind == .kickoff || $0.pointAfter != nil ? 0 : Gridiron.spot($0.hash) } ?? 0
            snap = scene?.pointAfter != nil ? 0.4 : 0.5
        }

        var offense: [Int] { script.players.indices.filter { script.players[$0].team == .offense } }
        var defense: [Int] { script.players.indices.filter { script.players[$0].team == .defense } }

        /// The players in these roles on a team.
        func players(_ team: Team, _ roles: Role...) -> [Int] {
            script.players.indices.filter { script.players[$0].team == team && roles.contains(script.players[$0].role) }
        }

        /// A place in a formation laid out round a ball in the middle, moved
        /// to the ball on its hash: the box moves with it; out wide, the
        /// players keep their room to the sideline, squeezed toward the near
        /// one, spread toward the far.
        func across(_ x: Double) -> Double {
            let box = 24.0, h = Gridiron.half
            guard abs(x) > box else { return ballX + x }
            return x > 0 ? ballX + box + (x - box) * (h - ballX - box) / (h - box) : ballX - box + (x + box) * (h + ballX - box) / (h - box)
        }

        mutating func add(_ slot: Slot, _ team: Team, _ role: Role, x: Double, dy: Double, set: Bool = false) {
            slots[slot] = script.players.count
            script.players.append(Player(team: team, at: CGPoint(x: across(x), y: line + dy), role: role, set: set ? snap : nil))
        }

        // MARK: Formations

        /// Eleven on eleven at the line, as the offense lined up: in the gun
        /// or under center, its strength (the tight end and the slot) to the
        /// side the play went; two backs under center on a run; an extra
        /// lineman reported in (a heavy set), an empty backfield, a bunch,
        /// the kneel's victory formation. The defense answers it: nickel
        /// against three wide, base against two backs, eight in the box
        /// against a heavy set, dime against empty; in its own base front
        /// (a 3-4's nose tackle and a backer standing up on the edge), each
        /// man in his depth-chart slot.
        mutating func scrimmage() {
            let formation = scene?.formation ?? .base
            // The strong side: the way the play went (the right when it doesn't say).
            let s: Double = scene?.lane == .left ? -1 : 1
            strong = s
            let gun = shotgun && formation != .victory
            let running = [.rush, .fumble, .other].contains(scene?.kind)
            add(.center, .offense, .line, x: 0, dy: -2, set: true)
            add(.guardLeft, .offense, .line, x: -5.5, dy: -2.5, set: true)
            add(.guardRight, .offense, .line, x: 5.5, dy: -2.5, set: true)
            add(.tackleLeft, .offense, .line, x: -11, dy: -3, set: true)
            add(.tackleRight, .offense, .line, x: 11, dy: -3, set: true)
            add(.quarterback, .offense, .quarterback, x: 0, dy: gun ? -15 : -4.5, set: !gun)
            func skill(_ slot: Slot, _ role: Role, _ x: Double, _ dy: Double, set: Bool = false) {
                add(slot, .offense, role, x: x * s, dy: dy, set: set)
            }
            func defend(fronts: [Double], backers: [(Double, Double)], corners: [(Double, Double)], safeties: [(Double, Double)]) {
                var fronts = fronts, backers = backers
                // A 3-4: a nose tackle over the ball and the ends a step inside; the fourth man stands up on the weak edge.
                if scene?.front == .threeFour, fronts.count == 4, let low = fronts.min(), let high = fronts.max() {
                    fronts = [low + 4, 0, high - 5]
                    backers.append((low - 4, 2.5))
                }
                for (i, x) in fronts.enumerated() { add(.front(i), .defense, .front, x: x * s, dy: 3, set: true) }
                for (i, (x, dy)) in backers.enumerated() { add(.backer(i), .defense, .backer, x: x * s, dy: dy) }
                for (i, (x, dy)) in corners.enumerated() { add(.corner(i), .defense, .corner, x: x * s, dy: dy) }
                for (i, (x, dy)) in safeties.enumerated() { add(.safety(i), .defense, .safety, x: x * s, dy: dy) }
            }
            let four = [-15.0, -5.5, 5.5, 19]
            switch formation {
            case .base where !gun && running:
                // The I: a fullback in front of the back, two wide; base 4-3, the strong safety down.
                skill(.tightEnd, .tightEnd, 17, -3, set: true)
                skill(.fullback, .back, 0, -12)
                skill(.back, .back, 0, -21)
                skill(.wideStrong, .receiver, 58, -2)
                skill(.wideWeak, .receiver, -60, -2)
                defend(fronts: four, backers: [(-14, 16), (1, 15), (16, 16)], corners: [(-58, 15), (56, 15)], safeties: [(24, 26), (-8, 42)])
            case .base:
                // Three wide, the tight end and the slot to the strong side; the back beside the
                // quarterback in the gun (on the weak side), behind him under center. Nickel.
                skill(.tightEnd, .tightEnd, 17, -3, set: true)
                skill(.slot, .receiver, 38, -4)
                skill(.wideStrong, .receiver, 62, -2)
                skill(.wideWeak, .receiver, -62, -2)
                skill(.back, .back, gun ? -6 : 0, gun ? -15 : -21)
                defend(fronts: four, backers: [(-6, 15), (10, 15)], corners: [(-60, 18), (60, 18), (36, 10)],
                        safeties: [(-24, 40), (28, 42)])
            case .heavy:
                // Jumbo: the lineman reported in on the weak side, two tight ends, two backs. Goal line: eight in the box.
                add(.extra, .offense, .line, x: -17 * s, dy: -3, set: true)
                skill(.tightEnd, .tightEnd, 17, -3, set: true)
                skill(.wing, .tightEnd, 22, -7)
                skill(.fullback, .back, gun ? 6 : 0, gun ? -15 : -12)
                skill(.back, .back, gun ? -6 : 0, gun ? -15 : -21)
                defend(fronts: [-20, -7, 4, 15], backers: [(-14, 9), (-4, 8), (7, 8), (18, 9)], corners: [(-26, 6), (28, 7)],
                        safeties: [(0, 24)])
            case .empty:
                // Five wide, the back split out on the weak side. Dime.
                skill(.tightEnd, .tightEnd, 24, -4)
                skill(.slot, .receiver, 40, -4)
                skill(.wideStrong, .receiver, 62, -2)
                skill(.back, .back, -36, -4)
                skill(.wideWeak, .receiver, -62, -2)
                defend(fronts: four, backers: [(2, 15)], corners: [(-60, 16), (-34, 10), (38, 10), (60, 16)],
                        safeties: [(-20, 38), (24, 40)])
            case .bunch:
                // Three in a tight triangle to the strong side; the corners stacked over it.
                skill(.wideStrong, .receiver, 36.5, -2)
                skill(.tightEnd, .tightEnd, 33, -5.5)
                skill(.slot, .receiver, 40, -5)
                skill(.wideWeak, .receiver, -62, -2)
                skill(.back, .back, gun ? -6 : 0, gun ? -15 : -21)
                defend(fronts: four, backers: [(-6, 15), (10, 15)], corners: [(-60, 18), (34, 8), (44, 14)],
                        safeties: [(-20, 40), (30, 38)])
            case .victory:
                // The kneel: a back at each hip, one deep, a tight end each side; the defense up close.
                skill(.back, .back, 5, -9)
                skill(.fullback, .back, -5, -9)
                skill(.deep, .back, 0, -30)
                skill(.tightEnd, .tightEnd, 17, -3, set: true)
                skill(.wing, .tightEnd, -17, -3, set: true)
                defend(fronts: [-15, -5.5, 5.5, 15], backers: [(-12, 10), (0, 9), (12, 10)], corners: [(-28, 8), (28, 8)],
                        safeties: [(-12, 22), (12, 22)])
            }
            label(strong: s)
        }

        /// Each man's depth-chart slot, from where he lines up: the
        /// offense's linemen left to right (its left is "l"); the defense's
        /// ends and tackles (or the nose), its backers weak to strong (inside
        /// ones in a 3-4), the corners outside and the nickel in the slot, the
        /// strong safety on the tight end's side. The defense's left is the
        /// offense's right, as its depth chart has it.
        mutating func label(strong s: Double) {
            func x(_ i: Int) -> Double { position(i, 0).x - ballX }
            func key(_ i: Int, _ key: String) { script.players[i].key = key }
            let names: [Slot: String] = [.center: "c", .guardLeft: "lg", .guardRight: "rg", .tackleLeft: "lt", .tackleRight: "rt",
                                         .quarterback: "qb", .back: "rb", .fullback: "fb", .tightEnd: "te", .wing: "te", .wideStrong: "wr",
                                         .wideWeak: "wr", .slot: "wr"]
            for (slot, name) in names { if let i = at(slot) { key(i, name) } }
            let fronts = players(.defense, .front).sorted { x($0) < x($1) }
            for (k, i) in fronts.enumerated() {
                let side = x(i) > 0 ? "l" : "r"
                key(i, k == 0 || k == fronts.count - 1 ? side + "de" : fronts.count == 3 ? "nt" : side + "dt")
            }
            let backers = players(.defense, .backer)
            let edge = backers.filter { position($0, 0).y - line < 6 }
            for i in edge { key(i, x(i) * s > 0 ? "slb" : "wlb") }
            var inside = backers.filter { !edge.contains($0) }.sorted { x($0) * s < x($1) * s }
            if edge.isEmpty {
                for (k, i) in inside.enumerated() {
                    key(i, k == 0 && inside.count > 1 ? "wlb" : k == inside.count - 1 && inside.count > 2 ? "slb" : "mlb")
                }
            } else {
                // A 3-4: the strong-side backer, and the inside two by side.
                if inside.count >= 3, let strongest = inside.popLast() { key(strongest, "slb") }
                for i in inside { key(i, inside.count == 1 ? "mlb" : x(i) > 0 ? "lilb" : "rilb") }
            }
            let corners = players(.defense, .corner)
            let outside = [corners.filter { x($0) > 0 }.max { x($0) < x($1) }, corners.filter { x($0) <= 0 }.min { x($0) < x($1) }]
            for i in corners { key(i, i == outside[0] ? "lcb" : i == outside[1] ? "rcb" : "nb") }
            let safeties = players(.defense, .safety).sorted { x($0) * s > x($1) * s }
            for (k, i) in safeties.enumerated() { key(i, k == 0 && safeties.count > 1 ? "ss" : "fs") }
        }

        /// The man ESPN credits, on his team: the one in his depth-chart
        /// slot (the strong safety himself), else one of his slot's kind on
        /// its side of the ball (an inside backer for a middle one, a corner
        /// in the nickel's place), else the nearest of his position to the
        /// spot, else of `fallback`'s.
        func man(_ p: FootballScene.Participant?, _ team: Team, near spot: CGPoint, at t: Double, excluding: Set<Int> = [],
                 fallback: [Role] = []) -> Int? {
            let pool = script.players.indices.filter { script.players[$0].team == team && !excluding.contains($0) }
            func nearest(_ among: [Int]) -> Int? {
                among.min { hypot(position($0, t).x - spot.x, position($0, t).y - spot.y) < hypot(position($1, t).x - spot.x, position($1, t).y - spot.y) }
            }
            if let slot = p?.slot {
                if let i = pool.first(where: { script.players[$0].key == slot }) { return i }
                let kind = Self.kind(slot)
                var alike = pool.filter { script.players[$0].key.map(Self.kind) == kind }
                // His side: the slot's left or right, else the strong side (the tight end's) for the strong-side backer,
                // the strong safety and the nickel, the weak side for the weak-side backer.
                let lane = FootballDepthChart.Slot(key: slot, athletes: [], defense: team == .defense).lane.map(Self.sign)
                let side = lane ?? (["slb", "ss", "nb"].contains(slot) ? strong : slot == "wlb" ? -strong : 0)
                if side != 0 {
                    let sided = alike.filter { (position($0, 0).x - ballX) * side > 0 }
                    if !sided.isEmpty { alike = sided }
                }
                if let i = nearest(alike) { return i }
            }
            let roles = Self.roles(p?.position)
            if !roles.isEmpty, let i = nearest(pool.filter { roles.contains(script.players[$0].role) }) { return i }
            if !fallback.isEmpty, let i = nearest(pool.filter { fallback.contains(script.players[$0].role) }) { return i }
            return nearest(pool.filter { script.players[$0].role != .official })
        }

        /// A slot's kind, whichever side it's on: an end, an interior
        /// lineman, a backer, a corner, a safety; the offense's line,
        /// receivers, tight ends, backs.
        static func kind(_ slot: String) -> String {
            switch slot {
            case "lde", "rde": "de"
            case "ldt", "rdt", "nt", "ut", "ng": "dt"
            case "wlb", "mlb", "slb", "lilb", "rilb", "lolb", "rolb": "lb"
            case "lcb", "rcb", "nb": "cb"
            case "ss", "fs": "s"
            case "c", "lg", "rg", "lt", "rt", "og", "t": "ol"
            case "rb", "fb": "rb"
            default: slot
            }
        }

        /// The punt: the snapper and six on the line, three protectors, the
        /// punter fifteen yards back, a gunner wide each side; across from
        /// them six at the line, a jammer on each gunner, the returner deep.
        mutating func puntFormation(returner: CGPoint) {
            add(.center, .offense, .line, x: 0, dy: -2, set: true)
            for (i, x) in [-5.5, 5.5, -11, 11, -16.5, 16.5].enumerated() { add(.lineman(i), .offense, .line, x: x, dy: -2.5, set: true) }
            for (i, (x, dy)) in [(-4.0, -15.0), (4, -15), (0, -21)].enumerated() { add(.protector(i), .offense, .back, x: x, dy: dy) }
            add(.punter, .offense, .punter, x: 0, dy: -45)
            add(.gunner(0), .offense, .cover, x: -64, dy: -2)
            add(.gunner(1), .offense, .cover, x: 62, dy: -2)
            for (i, x) in [-20.0, -11, -4, 4, 11, 20].enumerated() { add(.rusher(i), .defense, .front, x: x, dy: 3, set: true) }
            add(.corner(0), .defense, .corner, x: -60, dy: 5)
            add(.corner(1), .defense, .corner, x: 58, dy: 5)
            add(.backer(0), .defense, .backer, x: 0, dy: 30)
            slots[.returner] = script.players.count
            script.players.append(Player(team: .defense, at: returner, role: .returner))
        }

        /// The field goal: the snapper and eight on the line with a wing at
        /// each end, the holder seven yards back, the kicker a step off him;
        /// nine across the line to block it, two back.
        mutating func kickFormation() {
            add(.center, .offense, .line, x: 0, dy: -2, set: true)
            for (i, x) in [-4.5, 4.5, -9, 9, -13.5, 13.5, -18, 18].enumerated() {
                add(.lineman(i), .offense, .line, x: x, dy: -2.5, set: true)
            }
            add(.holder, .offense, .holder, x: 0, dy: -21)
            add(.kicker, .offense, .kicker, x: -7, dy: -30)
            for (i, x) in [-17.0, -12, -7, -2.5, 2.5, 7, 12, 17, 22].enumerated() { add(.rusher(i), .defense, .front, x: x, dy: 3, set: true) }
            add(.safety(0), .defense, .safety, x: -14, dy: 24)
            add(.safety(1), .defense, .safety, x: 14, dy: 24)
        }

        /// The kickoff as the NFL sets it now: the kicker behind the ball on
        /// his 35, ten teammates across the field at the other team's 40;
        /// nine of theirs in the setup zone five yards beyond, two deep.
        mutating func kickoffFormation(returner: CGPoint) {
            add(.kicker, .offense, .kicker, x: -4, dy: -15)
            for (i, x) in [-66.0, -52, -38, -24, -10, 10, 24, 38, 52, 66].enumerated() { add(.cover(i), .offense, .cover, x: x, dy: 75) }
            for (i, x) in [-58.0, -40, -24, -10, 4, 18, 32, 46, 62].enumerated() {
                add(.setup(i), .defense, .front, x: x, dy: 93 + Double(i % 2) * 9)
            }
            add(.deep, .defense, .returner, x: returner.x > 0 ? -18 : 18, dy: max(returner.y - line - 24, 120))
            slots[.returner] = script.players.count
            script.players.append(Player(team: .defense, at: returner, role: .returner))
        }

        // MARK: Helpers

        func at(_ slot: Slot) -> Int? { slots[slot] }

        func position(_ i: Int, _ t: Double) -> CGPoint { script.players[i].position(at: t) }

        mutating func move(_ i: Int?, to path: [CGPoint], from start: Double, to end: Double, ease: PlayScript.Ease = .inOut) {
            guard let i else { return }
            script.players[i].move(to: path, from: start, to: end, ease: ease)
        }

        /// Moves someone part of the way toward a point.
        mutating func drift(_ i: Int, toward p: CGPoint, by fraction: Double, max cap: Double = 40, from start: Double, to end: Double) {
            let here = position(i, start)
            let dx = p.x - here.x, dy = p.y - here.y, d = hypot(dx, dy)
            guard d > 1 else { return }
            let step = min(d * fraction, cap)
            move(i, to: [CGPoint(x: here.x + dx / d * step, y: here.y + dy / d * step)], from: start, to: end, ease: .out)
        }

        @discardableResult
        mutating func fly(from: FieldPoint, to: FieldPoint, start: Double, time: Double, arc: PlayScript.Flight.Arc,
                          ease: PlayScript.Ease = .linear) -> Int {
            script.flights.append(PlayScript.Flight(start: start, end: start + time, from: from, to: to, arc: arc, ease: ease))
            script.legs.append(Leg(from: start, until: start + time, hand: .flight(script.flights.count - 1)))
            return script.flights.count - 1
        }

        mutating func carry(_ i: Int, from start: Double, until end: Double) {
            script.legs.append(Leg(from: start, until: end, hand: .carry(i)))
        }

        /// The ball on the ground at the line before the snap.
        var spot: FieldPoint { FieldPoint(x: ballX, y: line, z: 0.6) }

        /// The snap: to the quarterback's hands, or back to the holder or the punter.
        mutating func snapBall(to receiver: Int, height: Double = 3.4) -> Double {
            script.legs.append(Leg(from: 0, until: snap, hand: .spot(spot)))
            let target = position(receiver, snap)
            let d = abs(target.y - line)
            script.flashes.append(Flash(beat: .snap, at: snap, point: spot))
            if d < 8 {
                // Under center: in his hands at once.
                carry(receiver, from: snap, until: snap + 0.05)
                return snap + 0.05
            }
            let time = min(max(d / 75, 0.22), 0.5)
            fly(from: FieldPoint(x: ballX, y: line - 1, z: 1), to: FieldPoint(target, z: height), start: snap, time: time, arc: .arc(d > 30 ? 3 : 1.5))
            return snap + time
        }

        /// Of the players on a team and in a position, the nearest a spot at t.
        func nearest(_ team: Team, to p: CGPoint, at t: Double, roles: [Role] = [], excluding: Set<Int> = []) -> Int? {
            script.players.indices
                .filter { script.players[$0].team == team && !excluding.contains($0) && (roles.isEmpty || roles.contains(script.players[$0].role)) }
                .min { a, b in
                    let pa = position(a, t), pb = position(b, t)
                    return hypot(pa.x - p.x, pa.y - p.y) < hypot(pb.x - p.x, pb.y - p.y)
                }
        }

        static func roles(_ position: FootballScene.Position?) -> [Role] {
            switch position {
            case .defensiveLine?: [.front]
            case .linebacker?: [.backer]
            case .corner?: [.corner]
            case .safety?: [.safety]
            // College credits a "DB" without saying corner or safety.
            case .defensiveBack?: [.corner, .safety]
            case .receiver?: [.receiver]
            case .tightEnd?: [.tightEnd]
            case .back?, .fullback?: [.back]
            case .quarterback?: [.quarterback]
            case .lineman?: [.line]
            case .kicker?: [.kicker]
            case .punter?: [.punter]
            default: []
            }
        }

        /// The ones credited with the stop (each the man in his slot, else
        /// the nearest of his position), else the nearest defender: they
        /// arrive with the ball carrier.
        mutating func tackle(_ runner: Int, at time: Double, spot: CGPoint, by team: Team, credited: [FootballScene.Participant?],
                             from start: Double, excluding: Set<Int> = []) -> [Int] {
            var taken: Set<Int> = excluding.union([runner])
            var tacklers: [Int] = []
            for credit in credited.prefix(3) {
                if let i = man(credit, team, near: spot, at: start, excluding: taken) {
                    taken.insert(i)
                    tacklers.append(i)
                }
            }
            stop = (time, spot)
            for (k, i) in tacklers.enumerated() {
                let here = position(i, start)
                let dx = here.x - spot.x, dy = here.y - spot.y, d = max(hypot(dx, dy), 1)
                let side = k == 0 ? 0.0 : (k % 2 == 0 ? 1.0 : -1.0)
                let contact = CGPoint(x: spot.x + dx / d * 3 + side * 3, y: spot.y + dy / d * 3)
                move(i, to: [contact], from: start, to: time, ease: .inOut)
                script.players[i].act(.tackle, at: time, toward: spot)
            }
            if !tacklers.isEmpty {
                script.flashes.append(Flash(beat: .hit, at: time, point: FieldPoint(spot, z: 3)))
                script.players[runner].holds.append(Hold(kind: .down, from: time + 0.12))
            }
            return tacklers
        }

        /// Everyone near the ball closes on it a little, defenders more.
        mutating func converge(on p: CGPoint, from start: Double, to end: Double, except: Set<Int>) {
            for i in script.players.indices where !except.contains(i) {
                let here = position(i, start)
                let d = hypot(here.x - p.x, here.y - p.y)
                guard d > 12, d < 160 else { continue }
                let defense = script.players[i].team == .defense
                drift(i, toward: p, by: defense ? 0.35 : 0.12, max: defense ? 30 : 14, from: start, to: end)
            }
        }

        /// The receiver for a pass of this side, depth and receiving position:
        /// of the receivers on that side, the one inside on a short ball, the
        /// one outside on a deep one; over the middle, whoever's inside.
        func target(_ credited: FootballScene.Position?, lane: FootballScene.Lane) -> Int? {
            switch credited {
            case .tightEnd?: return at(.tightEnd) ?? at(.wing)
            case .back?: return at(.back)
            case .fullback?: return at(.fullback) ?? at(.back)
            default:
                let side = Self.sign(lane)
                let receivers = players(.offense, .receiver)
                let pool = receivers.isEmpty ? players(.offense, .tightEnd) : receivers
                func out(_ i: Int) -> Double { (position(i, 0).x - ballX) * (side == 0 ? 1 : side) }
                let onSide = side == 0 ? pool : pool.filter { out($0) > 0 }
                let choices = onSide.isEmpty ? pool : onSide
                if side == 0 { return choices.min { abs(out($0)) < abs(out($1)) } }
                return scene?.depth == .deep ? choices.max { out($0) < out($1) } : choices.min { out($0) < out($1) }
            }
        }

        static func sign(_ lane: FootballScene.Lane?) -> Double { lane == .left ? -1 : lane == .right ? 1 : 0 }

        /// Where a play ended on the field: its yard line, and across, by the
        /// side it went to (over the sideline when he went out of bounds).
        func endPoint(from p: CGPoint, toward lane: FootballScene.Lane?, y: Double) -> CGPoint {
            guard let scene else { return CGPoint(x: p.x, y: y) }
            let side = abs(p.x - ballX) < 0.5 ? Self.sign(lane) : (p.x > ballX ? 1.0 : -1.0)
            if scene.outOfBounds { return CGPoint(x: (side == 0 ? 1 : side) * (Gridiron.half + 3), y: y) }
            let x = p.x + side * abs(y - p.y) * 0.12
            return CGPoint(x: min(max(x, -70), 70), y: y)
        }

        /// The end spot in feet: in the end zone for a touchdown.
        var endY: Double {
            guard let scene else { return line }
            if scene.scoring == .touchdown { return scene.to <= 0.5 ? -12 : 312 }
            return Gridiron.y(scene.to)
        }

        // MARK: Build

        mutating func build() {
            guard let scene else { return }
            if case .fieldGoal = scene.kind { script.yaw = 0 }
            if case .extraPoint = scene.kind { script.yaw = 0 }
            // A foul before the snap (a false start, a delay): the ball is never snapped, whatever college logs after it.
            let stopped = ruling?.flags.contains { $0.timing == .beforeSnap && $0.status == .accepted } == true
            switch stopped ? .penalty : scene.kind {
            case .pass, .incomplete, .interception: scrimmage(); pass()
            case .rush, .other: scrimmage(); rush()
            case .kneel: scrimmage(); kneel()
            case .spike: scrimmage(); spike()
            case .sack: scrimmage(); sack()
            case .fumble:
                // Lost from a sack (a strip-sack), after a catch, or on a run.
                scrimmage()
                let words = FootballScene.playText(scene.text).lowercased()
                if !scene.sackers.isEmpty || words.contains("sacked") { sack() }
                else if words.contains(" pass "), !words.contains("incomplete") { pass() }
                else { rush() }
            case .punt: punt()
            case .kickoff: kickoff()
            case .fieldGoal, .extraPoint: fieldGoal()
            case .penalty: scrimmage(); penalty()
            }
            if !stopped, scene.kind != .penalty { flags() }
            finish()
            headline()
            measureStamp()
            settle()
            shoot()
        }

        // MARK: Pass

        /// The quarterback's drop, the routes, the throw to where it was
        /// caught (or broken up, or picked off), the run after the catch and the stop.
        mutating func pass() {
            guard let scene, let qb = at(.quarterback) else { return }
            // (A catch that was then fumbled away is a catch first.)
            let caught = scene.kind == .pass || scene.kind == .fumble, picked = scene.kind == .interception
            let deep = scene.depth == .deep || (scene.air ?? 0) >= 18
            let lane = scene.lane ?? .middle
            let receiver = target(scene.position("receiver"), lane: lane) ?? at(.tightEnd) ?? at(.back) ?? qb
            let inHand = snapBall(to: qb)
            // The drop: seven yards deep from under center, a step or two in the gun.
            let pocket = CGPoint(x: ballX, y: line - 21)
            move(qb, to: [pocket], from: snap + 0.08, to: snap + (shotgun ? 0.55 : 0.8), ease: .out)
            let release = snap + (deep ? 1.35 : 1.0) + (shotgun ? 0 : 0.1)
            carry(qb, from: inHand, until: release)
            script.players[qb].act(.throwBall, at: release, toward: CGPoint(x: ballX, y: line + 60))

            // Where it was caught, picked off or thrown to.
            let air = scene.air ?? (deep ? 24 : 7)
            let side = Self.sign(lane)
            let start = position(receiver, 0)
            let back = script.players[receiver].role != .receiver
            var catchX = side == 0 ? (deep ? 4 : -6) : side * (deep ? 50 : back ? 26 : 38)
            if air < 0 { catchX = (side == 0 ? 1 : side) * 30 }
            let catchPoint = CGPoint(x: min(max(across(catchX), -72), 72), y: line + Gridiron.y(air))
            let from = FieldPoint(x: pocket.x + 1.5, y: pocket.y + 1, z: 7)
            let d = hypot(catchPoint.x - from.x, catchPoint.y - from.y)
            let time = min(max(0.26 + d / 150, 0.38), 1.25)
            let arrive = release + time
            let flight = fly(from: from, to: FieldPoint(catchPoint, z: caught || picked ? 5 : 4), start: release, time: time,
                             arc: .arc(deep ? 12 + d * 0.11 : 3 + d * 0.045))
            // The route: a stem upfield, then the break to the ball.
            let stem = CGPoint(x: start.x + (catchPoint.x - start.x) * 0.2, y: start.y + max((catchPoint.y - start.y) * 0.6, 0))
            move(receiver, to: catchPoint.y - start.y > 24 ? [stem, catchPoint] : [catchPoint], from: snap + 0.05,
                 to: picked || !caught ? arrive + 0.05 : arrive, ease: .inOut)
            decoys(except: [receiver, qb], release: release)
            protect(rush: snap + 0.85)
            self.release = release
            arrival = (arrive, catchPoint)
            var taken: Set<Int> = [qb, receiver]
            taken.formUnion(pressure(on: qb, at: release, in: pocket))

            if picked {
                interception(receiver: receiver, at: arrive, point: catchPoint, flight: flight, taken: &taken)
                return
            }
            // The defender on him closes as the ball arrives: the one credited with the breakup, else whoever covers him.
            let coverRoles: [Role] = deep ? [.corner, .safety] : [.corner, .backer, .safety]
            let breakup = scene.participants.first { $0.role == "passDefender" }
            let defender = breakup.flatMap { man($0, .defense, near: catchPoint, at: snap, excluding: taken, fallback: coverRoles) }
                ?? nearest(.defense, to: catchPoint, at: snap, roles: coverRoles, excluding: taken)
            if !caught {
                // Broken up, or just out of reach: it comes down on the grass.
                if let defender {
                    move(defender, to: [CGPoint(x: catchPoint.x + 3, y: catchPoint.y + 2)], from: snap + 0.1, to: arrive - 0.02)
                }
                let broken = scene.position("passDefender") != nil
                if broken, let defender {
                    script.players[defender].act(.block, at: arrive, toward: catchPoint)
                    script.flashes.append(Flash(beat: .deflect, at: arrive, point: FieldPoint(catchPoint, z: 5)))
                }
                let away = CGPoint(x: catchPoint.x + (broken ? -side * 10 : side * 6), y: catchPoint.y + (broken ? -6 : 14))
                fly(from: FieldPoint(catchPoint, z: 4), to: FieldPoint(away), start: arrive, time: 0.5, arc: .bounce(2), ease: .out)
                script.players[receiver].act(.catchHigh, at: arrive, toward: from.ground)
                over = arrive + 0.5
                script.stamp = arrive + 0.4
                return
            }
            script.players[receiver].act(deep ? .catchHigh : .catchChest, at: arrive, toward: from.ground)
            script.flashes.append(Flash(beat: .catchBall, at: arrive, point: FieldPoint(catchPoint, z: 5)))
            if let defender {
                move(defender, to: [CGPoint(x: catchPoint.x + (catchPoint.x > 0 ? 6 : -6), y: catchPoint.y + 9)], from: snap + 0.1,
                     to: arrive + 0.15)
                taken.insert(defender)
            }
            run(receiver, from: catchPoint, at: arrive + 0.04, taken: taken)
        }

        /// The other receivers run their routes; the backs and the tight end
        /// release; corners and safeties turn and run with them.
        mutating func decoys(except: Set<Int>, release: Double) {
            for i in players(.offense, .receiver, .tightEnd, .back) where !except.contains(i) {
                let role = script.players[i].role
                let p = position(i, 0)
                let depth = role == .back ? 10.0 : role == .tightEnd ? 24 : 42
                let lean = role == .back ? (p.x >= ballX ? 16.0 : -16) : (p.x > ballX ? -8 : 8)
                move(i, to: [CGPoint(x: p.x + lean, y: max(p.y, line) + depth)], from: snap + 0.05, to: release + 0.4, ease: .inOut)
            }
            for i in players(.defense, .corner) {
                let p = position(i, 0)
                move(i, to: [CGPoint(x: ballX + (p.x - ballX) * 0.92, y: p.y + 26)], from: snap + 0.08, to: release + 0.5, ease: .out)
            }
            for i in players(.defense, .safety, .backer) {
                let p = position(i, 0)
                move(i, to: [CGPoint(x: ballX + (p.x - ballX) * 0.85, y: p.y + (script.players[i].role == .safety ? 10 : 12))],
                     from: snap + 0.08, to: snap + 0.9, ease: .out)
            }
        }

        /// The pocket: the line sets back, the front rushes into it.
        mutating func protect(rush: Double) {
            for i in players(.offense, .line) {
                let p = position(i, 0)
                move(i, to: [CGPoint(x: ballX + (p.x - ballX) * 1.1, y: p.y - 6)], from: snap + 0.04, to: snap + 0.55, ease: .out)
                script.players[i].act(.block, at: snap + 0.55, toward: CGPoint(x: p.x, y: line + 10))
            }
            for i in players(.defense, .front) where !script.players[i].moves.contains(where: { $0.start > snap }) {
                let p = position(i, 0)
                move(i, to: [CGPoint(x: ballX + (p.x - ballX) * 0.85, y: line - 5)], from: snap + 0.04, to: rush, ease: .out)
            }
        }

        /// The rush getting home as he throws. A hit (the NFL's bracketed
        /// credit): the man in his slot, round the edge or straight up the
        /// middle, reaches the quarterback as the ball leaves and puts him
        /// on his back after it. A hurry (college's "QB hurried by"): he
        /// closes on him, a stride short. Returns who came.
        mutating func pressure(on qb: Int, at release: Double, in pocket: CGPoint) -> Set<Int> {
            guard let pressure = scene?.pressure else { return [] }
            let thrower = position(qb, release)
            var by: [Int] = []
            for (k, credit) in pressure.by.prefix(2).enumerated() {
                guard let i = man(credit, .defense, near: pocket, at: 0, excluding: Set(by), fallback: [.front, .backer]) else { continue }
                by.append(i)
                let start = position(i, 0), side: Double = start.x >= ballX ? 1 : -1
                let reach = pressure.hit ? 2.2 : 5.5
                let contact = CGPoint(x: thrower.x + side * reach * 0.8, y: thrower.y + reach * 0.6)
                let wide = abs(start.x - ballX) > 12
                let path = wide ? [CGPoint(x: ballX + side * max(abs(start.x - ballX) + 4, 16), y: line - 6), contact] : [contact]
                let arrive = release + (pressure.hit ? 0.06 : -0.05) + Double(k) * 0.08
                move(i, to: path, from: snap + 0.04, to: arrive, ease: .inOut)
                if pressure.hit { script.players[i].act(.tackle, at: arrive + 0.04, toward: thrower) }
            }
            guard pressure.hit, let hitter = by.first else { return Set(by) }
            let hit = release + 0.1
            script.flashes.append(Flash(beat: .hit, at: hit, point: FieldPoint(thrower, z: 4)))
            // Driven back a stride from the hit, and down.
            let from = position(hitter, hit), dx = thrower.x - from.x, dy = thrower.y - from.y, d = max(hypot(dx, dy), 0.1)
            move(qb, to: [CGPoint(x: thrower.x + dx / d * 3, y: thrower.y + dy / d * 3)], from: hit, to: hit + 0.35, ease: .out)
            script.players[qb].holds.append(Hold(kind: .knocked, from: hit + 0.06))
            script.players[hitter].holds.append(Hold(kind: .down, from: hit + 0.22))
            return Set(by)
        }

        mutating func interception(receiver: Int, at arrive: Double, point: CGPoint, flight: Int, taken: inout Set<Int>) {
            guard let scene else { return }
            // The man who picked it off, by his slot: credited as the interceptor, or the returner, or for the breakup.
            let credit = ["interceptor", "returner", "passDefender"].lazy.compactMap { role in scene.participants.first { $0.role == role } }.first
            guard let taker = man(credit, .defense, near: point, at: snap, excluding: taken, fallback: [.corner, .safety, .backer]) else { return }
            // He jumps the route: in front of the receiver as the ball arrives.
            let jump = CGPoint(x: point.x - (point.x > ballX ? 2 : -2), y: point.y - 3)
            move(taker, to: [jump], from: snap + 0.15, to: arrive, ease: .inOut)
            script.flights[flight].to = FieldPoint(jump, z: 5)
            script.players[taker].act(.catchChest, at: arrive, toward: CGPoint(x: ballX, y: line - 20))
            script.flashes.append(Flash(beat: .catchBall, at: arrive, point: FieldPoint(jump, z: 5)))
            script.players[receiver].act(.catchHigh, at: arrive - 0.04, toward: CGPoint(x: ballX, y: line - 20))
            taken.insert(taker)
            script.score = nil
            run(taker, from: jump, at: arrive + 0.05, taken: taken, returning: true)
        }

        /// The ball carrier from where he got it to where he was stopped: the
        /// tacklers arrive with him, everyone else closes in. Into the end zone
        /// with both arms up for a touchdown; out over the sideline when he went out.
        /// A fumble on the way (lost, or recovered by his own side) stops him
        /// where it came loose, and the scramble for it takes over.
        mutating func run(_ runner: Int, from start: CGPoint, at time: Double, taken: Set<Int>, returning: Bool = false,
                          path: [CGPoint] = [], recovered: Bool = false) {
            guard let scene else { return }
            let opponents: Team = script.players[runner].team == .offense ? .defense : .offense
            if !returning, !recovered, let loose = scene.loose, [.rush, .pass, .fumble].contains(scene.kind) {
                // Stripped where it came loose: the man credited with it (else the first tackler) gets there with him.
                let at = endPoint(from: path.last ?? start, toward: scene.lane, y: Gridiron.y(loose))
                var length = 0.0, previous = start
                for p in path + [at] { length += hypot(p.x - previous.x, p.y - previous.y); previous = p }
                let arrive = time + min(max(length / 47, 0.35), 2.2)
                move(runner, to: path + [at], from: time, to: arrive, ease: .out)
                carry(runner, from: time, until: arrive)
                let credit = scene.stripper ?? scene.participants.first { $0.role == "tackler" }
                var stripped = taken.union([runner])
                if let stripper = man(credit, opponents, near: at, at: max(time - 0.3, snap), excluding: stripped) {
                    let here = position(stripper, max(time - 0.3, snap)), d = max(hypot(here.x - at.x, here.y - at.y), 1)
                    move(stripper, to: [CGPoint(x: at.x + (here.x - at.x) / d * 2.5, y: at.y + (here.y - at.y) / d * 2.5)],
                         from: max(time - 0.3, snap), to: arrive, ease: .inOut)
                    script.players[stripper].act(.strip, at: arrive, toward: at)
                    stripped.insert(stripper)
                }
                script.players[runner].holds.append(Hold(kind: .down, from: arrive + 0.14))
                stop = (arrive, at)
                fumbled(from: runner, at: arrive, loose: at, taken: stripped)
                return
            }
            carry(runner, from: time, until: .infinity)
            // Stopped where the text says when a flag's yards come after; else at the end spot.
            let y = scene.scoring == .touchdown ? endY : Gridiron.y((scene.penalty != nil ? scene.stopped : nil) ?? scene.to)
            let stop = endPoint(from: path.last ?? start, toward: scene.lane, y: y)
            let finish = scene.scoring == .touchdown ? CGPoint(x: stop.x * 0.6, y: endY) : stop
            let route = path + [finish]
            var length = 0.0, previous = start
            for p in route { length += hypot(p.x - previous.x, p.y - previous.y); previous = p }
            let duration = min(max(length / 47, 0.35), 2.5)
            let arrive = time + duration
            move(runner, to: route, from: time, to: arrive, ease: .out)
            over = arrive
            if scene.scoring == .touchdown {
                script.players[runner].holds.append(Hold(kind: .touchdown, from: arrive + 0.05))
                // The moment the ball crosses the goal line.
                let goal = returning || scene.to <= 0.5 ? 0.0 : 300
                let u = min(max(abs(goal - start.y) / max(abs(finish.y - start.y), 1), 0), 1)
                script.score = time + duration * min(max(u * 0.82, 0), 1)
                script.scorePoint = FieldPoint(x: finish.x * 0.8, y: goal, z: 0)
                converge(on: finish, from: time, to: arrive + 0.2, except: taken.union([runner]))
                script.end = FieldPoint(finish)
                script.stamp = arrive + 0.15
                return
            }
            let credited: [FootballScene.Participant?] = scene.participants.filter { $0.role == "tackler" || $0.role == "assistedBy" }
            let tacklers = scene.outOfBounds && credited.isEmpty ? []
                : tackle(runner, at: arrive, spot: finish, by: opponents, credited: credited.isEmpty ? [nil] : credited,
                         from: max(time - 0.3, snap), excluding: taken)
            if tacklers.isEmpty { self.stop = (arrive, finish) }
            converge(on: finish, from: time, to: arrive + 0.15, except: taken.union(tacklers).union([runner]))
            script.end = FieldPoint(finish)
            script.stamp = arrive + 0.12
        }

        /// The ball out: it pops from `carrier`'s arms at `time` where it
        /// came loose and skitters to where it was recovered, the nearest man
        /// from each side laying out for it, and the man ESPN credits comes
        /// up with it (the defense's on a fumble lost): then the return, or
        /// he stays down on it.
        mutating func fumbled(from carrier: Int, at time: Double, loose: CGPoint, taken: Set<Int>) {
            guard let scene else { return }
            let lost = scene.kind == .fumble
            let own = script.players[carrier].team, team: Team = lost ? (own == .offense ? .defense : .offense) : own
            let recoveryY = Gridiron.y(scene.recovered ?? scene.turn ?? scene.loose ?? scene.to)
            let recovery = CGPoint(x: loose.x + (abs(recoveryY - loose.y) > 3 ? 4 : 1.5), y: recoveryY)
            // Up out of his arms, down, and away.
            let out = time + 0.3
            fly(from: FieldPoint(position(carrier, time), z: 3.4), to: FieldPoint(loose, z: 0.6), start: time, time: 0.3, arc: .arc(3.5))
            let rolls = max(hypot(recovery.x - loose.x, recovery.y - loose.y) / 26, 0.35)
            fly(from: FieldPoint(loose, z: 0.6), to: FieldPoint(recovery, z: 0.6), start: out, time: rolls, arc: .bounce(2), ease: .out)
            script.flashes.append(Flash(beat: .deflect, at: time + 0.02, point: FieldPoint(position(carrier, time), z: 3.4)))
            let reached = out + rolls
            recoveredAt = reached
            var busy = taken.union([carrier])
            let credit = scene.participants.first { $0.role == "recoverer" }
            // (The man who lost it can fall on it himself: "and recovers".)
            let taker = man(credit, team, near: recovery, at: time, excluding: taken.subtracting([carrier])) ?? carrier
            busy.insert(taker)
            let returns = lost && (scene.scoring == .touchdown || abs(Gridiron.y(scene.to) - recovery.y) > 4)
            let advances = !lost && abs(Gridiron.y(scene.to) - recovery.y) > 4
            if taker != carrier {
                move(taker, to: [recovery], from: max(time - 0.2, snap), to: reached, ease: .inOut)
                script.players[taker].act(returns || advances ? .scoop : .scramble, at: reached, toward: recovery)
                if !(returns || advances) { script.players[taker].holds.append(Hold(kind: .down, from: reached + 0.18)) }
            }
            // The scramble: the nearest man on each side lays out for it, just behind him.
            for side in [Team.offense, .defense] {
                guard let i = nearest(side, to: recovery, at: time, excluding: busy) else { continue }
                busy.insert(i)
                let here = position(i, time), dx = here.x - recovery.x, dy = here.y - recovery.y, d = max(hypot(dx, dy), 1)
                guard d < 60 else { continue }
                move(i, to: [CGPoint(x: recovery.x + dx / d * 3.5, y: recovery.y + dy / d * 3.5)], from: time, to: reached + 0.08, ease: .inOut)
                script.players[i].act(.scramble, at: reached + 0.08, toward: recovery)
                script.players[i].holds.append(Hold(kind: .down, from: reached + 0.25))
            }
            if returns || advances {
                run(taker, from: recovery, at: reached + 0.06, taken: busy, returning: lost, recovered: true)
                return
            }
            carry(taker, from: reached, until: .infinity)
            converge(on: recovery, from: time, to: reached + 0.3, except: busy)
            over = reached + 0.35
            script.end = FieldPoint(recovery)
            script.stamp = reached + 0.3
        }

        // MARK: Run

        /// The handoff at the mesh, the back through the hole ESPN names (a
        /// guard's, a tackle's, outside the end, up the middle) and on to the
        /// spot; the quarterback keeps it on a scramble or a sneak.
        mutating func rush() {
            guard let scene, let qb = at(.quarterback), let back = at(.back) else { return }
            let side = Self.sign(scene.lane)
            let carrier = scene.position("rusher") ?? scene.position("fumbler")
            let keeper = carrier == .quarterback
            let runner: Int
            switch carrier {
            case .quarterback?: runner = qb
            // A sweep: the receiver nearest the side it went.
            case .receiver?: runner = players(.offense, .receiver).min { abs(position($0, 0).x - across(side * 34)) < abs(position($1, 0).x - across(side * 34)) } ?? back
            case .tightEnd?: runner = at(.tightEnd) ?? back
            case .fullback?: runner = at(.fullback) ?? back
            default: runner = back
            }
            let inHand = snapBall(to: qb)
            if scene.text.contains("(Aborted)") {
                // The snap never made it: on the ground at his feet, and the scramble for it.
                script.legs.append(Leg(from: inHand, until: inHand + 0.12, hand: .carry(qb)))
                protect(rush: snap + 0.6)
                let loose = CGPoint(x: position(qb, inHand).x + 1.5, y: Gridiron.y(scene.loose ?? scene.from) - 1)
                script.players[qb].act(.scramble, at: inHand + 0.5, toward: loose)
                script.players[qb].holds.append(Hold(kind: .down, from: inHand + 0.68))
                fumbled(from: qb, at: inHand + 0.12, loose: loose, taken: [qb])
                return
            }
            let hole: Double = switch scene.gap {
            case .guard?: 7
            case .tackle?: 13.5
            case .end?: 26
            default: 0
            }
            let holeX = ballX + side * hole
            let gain = scene.to - scene.from
            let through = CGPoint(x: holeX, y: line + (gain > 0 ? 3 : -1))
            var meshTime = snap + (shotgun ? 0.36 : 0.45)
            var mesh = position(qb, snap)
            if keeper {
                // A scramble: he drops, then runs for it.
                let scrambles = scene.text.contains("scrambles")
                let pocket = CGPoint(x: ballX, y: line - (scrambles ? 19 : 6))
                move(qb, to: [pocket], from: snap + 0.08, to: snap + (scrambles ? 0.7 : 0.25), ease: .out)
                meshTime = snap + (scrambles ? 1.2 : 0.3)
                mesh = pocket
                carry(qb, from: inHand, until: meshTime)
                if scrambles { protect(rush: snap + 1.0) }
            } else {
                // The quarterback opens to the back; they meet a few yards deep.
                mesh = CGPoint(x: ballX + side * 2.5, y: line - (shotgun ? 13 : 10))
                move(qb, to: [CGPoint(x: mesh.x - side * 1.5, y: mesh.y + 1)], from: snap + 0.05, to: meshTime - 0.05, ease: .out)
                move(runner, to: [mesh], from: snap + 0.02, to: meshTime, ease: .inOut)
                carry(qb, from: inHand, until: meshTime)
                script.players[qb].act(.handoff, at: meshTime, toward: mesh)
                // The fake: he carries out the boot the other way.
                move(qb, to: [CGPoint(x: ballX - side * 14 + (side == 0 ? 8 : 0), y: line - 16)], from: meshTime + 0.1, to: meshTime + 0.9,
                     ease: .out)
            }
            // The line and the tight ends drive the way of the run and open the hole; a fullback leads through it.
            for i in players(.offense, .line, .tightEnd) where i != runner {
                let p = position(i, 0)
                let away = p.x == holeX ? 0 : (p.x < holeX ? -2.5 : 2.5)
                move(i, to: [CGPoint(x: p.x + side * 2 + away, y: p.y + 6)], from: snap + 0.03, to: snap + 0.7, ease: .out)
                script.players[i].act(.block, at: snap + 0.5, toward: CGPoint(x: p.x, y: line + 10))
            }
            if let lead = at(.fullback), lead != runner, !keeper {
                move(lead, to: [CGPoint(x: holeX + side * 1.5, y: line + 5)], from: snap + 0.04, to: meshTime + 0.35, ease: .inOut)
                script.players[lead].act(.block, at: meshTime + 0.35, toward: CGPoint(x: holeX, y: line + 12))
            }
            for i in players(.defense, .front) {
                let p = position(i, 0)
                move(i, to: [CGPoint(x: p.x + (p.x < holeX ? -2 : 2), y: line + 1)], from: snap + 0.03, to: snap + 0.6, ease: .out)
            }
            // The receivers block downfield.
            for i in players(.offense, .receiver) where i != runner {
                let p = position(i, 0)
                move(i, to: [CGPoint(x: ballX + (p.x - ballX) * 0.9, y: line + 14)], from: snap + 0.05, to: snap + 1.1, ease: .out)
            }
            // The linebackers fill toward the hole.
            for i in players(.defense, .backer) {
                drift(i, toward: through, by: 0.45, max: 16, from: snap + 0.1, to: meshTime + 0.45)
            }
            run(runner, from: mesh, at: meshTime, taken: [qb, runner], path: [through])
        }

        mutating func kneel() {
            guard let qb = at(.quarterback) else { return }
            let inHand = snapBall(to: qb)
            carry(qb, from: inHand, until: .infinity)
            let spot = CGPoint(x: ballX, y: Gridiron.y(scene?.to ?? line / 3) - 1)
            move(qb, to: [spot], from: snap + 0.05, to: snap + 0.35, ease: .out)
            script.players[qb].holds.append(Hold(kind: .kneel, from: snap + 0.4))
            over = snap + 0.6
            script.end = FieldPoint(spot)
            script.stamp = snap + 0.7
        }

        mutating func spike() {
            guard let qb = at(.quarterback) else { return }
            let inHand = snapBall(to: qb)
            let throwAt = inHand + 0.18
            carry(qb, from: inHand, until: throwAt)
            script.players[qb].act(.spike, at: throwAt, toward: CGPoint(x: ballX, y: line))
            let p = position(qb, throwAt)
            fly(from: FieldPoint(p, z: 6), to: FieldPoint(x: p.x + 1, y: p.y + 3, z: 0), start: throwAt, time: 0.14, arc: .straight)
            fly(from: FieldPoint(x: p.x + 1, y: p.y + 3, z: 0), to: FieldPoint(x: p.x + 4, y: p.y + 12), start: throwAt + 0.14, time: 0.5,
                arc: .bounce(3), ease: .out)
            over = throwAt + 0.6
            script.end = FieldPoint(CGPoint(x: ballX, y: line))
            script.stamp = throwAt + 0.2
        }

        /// The pocket collapses: the men ESPN credits (two on a split sack),
        /// each from his own slot, round the edge or up the middle, take the
        /// quarterback down where the sack was spotted. A strip-sack: the
        /// stripper punches it out as they get there, and the scramble for
        /// the ball follows.
        mutating func sack() {
            guard let scene, let qb = at(.quarterback) else { return }
            let inHand = snapBall(to: qb)
            let pocket = CGPoint(x: ballX, y: line - 21)
            move(qb, to: [pocket], from: snap + 0.08, to: snap + (shotgun ? 0.55 : 0.8), ease: .out)
            let stripped = scene.loose != nil && (scene.stripper != nil || scene.kind == .fumble)
            let down = CGPoint(x: ballX + (scene.lane == .left ? -6 : 6), y: Gridiron.y(scene.stopped ?? scene.loose ?? scene.to))
            let hit = snap + 1.6
            move(qb, to: [down], from: snap + 0.95, to: hit, ease: .inOut)
            carry(qb, from: inHand, until: stripped ? hit : .infinity)
            decoys(except: [qb], release: snap + 1.35)
            protect(rush: snap + 0.85)
            var sackers: [Int] = []
            for credit in scene.sackers.isEmpty ? [nil] : scene.sackers.prefix(2).map(Optional.some) {
                if let i = man(credit, .defense, near: CGPoint(x: ballX + 15, y: line), at: 0, excluding: Set(sackers), fallback: [.front]) {
                    sackers.append(i)
                }
            }
            for (k, sacker) in sackers.enumerated() {
                let start = position(sacker, 0), side: Double = start.x >= ballX ? 1 : -1
                let contact = CGPoint(x: down.x + side * 3, y: down.y + 2 - Double(k) * 1.5)
                let edge = CGPoint(x: ballX + side * max(abs(start.x - ballX) + 6, 18), y: line - 8)
                move(sacker, to: abs(start.x - ballX) > 12 ? [edge, contact] : [contact], from: snap + 0.04, to: hit + Double(k) * 0.06, ease: .inOut)
                script.players[sacker].act(.tackle, at: hit + Double(k) * 0.06, toward: down)
            }
            script.players[qb].holds.append(Hold(kind: .down, from: hit + 0.12))
            script.flashes.append(Flash(beat: .hit, at: hit, point: FieldPoint(down, z: 3)))
            stop = (hit, down)
            if stripped, let loose = scene.loose {
                // The punch at the ball as they arrive: one of the sackers, or a man of his own from his slot.
                var busy = Set(sackers).union([qb])
                if let stripper = man(scene.stripper, .defense, near: down, at: 0, excluding: [qb]) {
                    if !sackers.contains(stripper) {
                        move(stripper, to: [CGPoint(x: down.x - 3, y: down.y + 3)], from: snap + 0.04, to: hit, ease: .inOut)
                    }
                    script.players[stripper].actions.removeAll { $0.kind == .tackle }
                    script.players[stripper].act(.strip, at: hit, toward: down)
                    busy.insert(stripper)
                }
                fumbled(from: qb, at: hit, loose: CGPoint(x: down.x, y: Gridiron.y(loose)), taken: busy)
                return
            }
            over = hit + 0.2
            script.end = FieldPoint(down)
            script.stamp = hit + 0.15
        }

        // MARK: Kicks

        /// The long snap, the punt's arc to where it came down, and what
        /// became of it: a fair catch, a return, downed, out of bounds, a touchback.
        mutating func punt() {
            guard let scene else { return }
            let landingY = Gridiron.y(scene.turn ?? scene.from + 40)
            let outside = scene.kick == .outOfBounds
            let landing = CGPoint(x: outside ? 74 : ballX * 0.5 + 8, y: scene.kick == .downed ? landingY - 14 : landingY)
            puntFormation(returner: CGPoint(x: landing.x * 0.5, y: landingY + 18))
            guard let punter = at(.punter), let returner = at(.returner) else { return }
            let inHand = snapBall(to: punter, height: 3.2)
            let kickAt = inHand + 0.55
            carry(punter, from: inHand, until: kickAt)
            script.players[punter].act(.kick, at: kickAt, toward: CGPoint(x: ballX, y: line + 60))
            let foot = FieldPoint(x: ballX, y: line - 42, z: 2.5)
            script.flashes.append(Flash(beat: .kick, at: kickAt, point: foot))
            let d = hypot(landing.x - foot.x, landing.y - foot.y)
            let caught = scene.kick == .fairCatch || scene.kick == .returned
            let hang = min(max(d / 88, 1.3), 2.3)
            fly(from: foot, to: FieldPoint(landing, z: caught ? 5 : 0), start: kickAt, time: hang, arc: .arc(40 + d * 0.08))
            let land = kickAt + hang
            kickCoverage(kickAt: kickAt, land: land, landing: landing, gunners: [at(.gunner(0)), at(.gunner(1))].compactMap { $0 })
            receive(returner: returner, landing: landing, land: land, kickAt: kickAt)
        }

        /// The kicker's run-up and kick from the tee, the ball's flight to where
        /// it came down (in the end zone for a touchback), and the return.
        mutating func kickoff() {
            guard let scene else { return }
            let landingY = Gridiron.y(scene.turn ?? scene.from + 60)
            let landing = CGPoint(x: -6, y: landingY)
            kickoffFormation(returner: CGPoint(x: landing.x + 4, y: landingY + 9))
            guard let kicker = at(.kicker), let returner = at(.returner) else { return }
            let tee = CGPoint(x: 0, y: line)
            let kickAt = snap + 0.2
            move(kicker, to: [CGPoint(x: -1.5, y: line - 2)], from: 0.1, to: kickAt, ease: .inOut)
            script.players[kicker].act(.kick, at: kickAt, toward: CGPoint(x: 0, y: line + 60))
            script.legs.append(Leg(from: 0, until: kickAt, hand: .spot(FieldPoint(tee, z: 0.9))))
            script.flashes.append(Flash(beat: .kick, at: kickAt, point: FieldPoint(tee, z: 1)))
            let d = landing.y - tee.y
            let caught = scene.kick == .returned || scene.kick == .fairCatch
            let hang = min(max(d / 95, 1.5), 2.5)
            fly(from: FieldPoint(tee, z: 0.9), to: FieldPoint(landing, z: caught ? 5 : 0), start: kickAt, time: hang, arc: .arc(52 + d * 0.05))
            let land = kickAt + hang
            // Nobody moves until the ball comes down (the rule), then they go.
            for k in 0..<10 {
                guard let i = at(.cover(k)) else { continue }
                drift(i, toward: landing, by: 0.45, max: 70, from: land - 0.15, to: land + 1.2)
            }
            for k in 0..<9 {
                guard let i = at(.setup(k)) else { continue }
                let p = position(i, 0)
                move(i, to: [CGPoint(x: p.x * 0.75, y: p.y + 6)], from: land - 0.1, to: land + 0.8, ease: .out)
            }
            receive(returner: returner, landing: landing, land: land, kickAt: kickAt)
        }

        /// The coverage on a punt: the gunners sprint down at the snap, the
        /// line releases once it's kicked.
        mutating func kickCoverage(kickAt: Double, land: Double, landing: CGPoint, gunners: [Int]) {
            for i in gunners {
                let p = position(i, 0)
                move(i, to: [CGPoint(x: landing.x + (p.x > 0 ? 9 : -9), y: landing.y - 16)], from: snap + 0.05, to: land + 0.1, ease: .inOut)
            }
            for k in 0..<6 {
                guard let i = at(.lineman(k)) else { continue }
                drift(i, toward: landing, by: 0.45, max: 90, from: kickAt + 0.1, to: land + 0.6)
            }
            for k in 0..<6 {
                guard let i = at(.rusher(k)) else { continue }
                let p = position(i, 0)
                move(i, to: [CGPoint(x: ballX + (p.x - ballX) * 0.8, y: line - 14)], from: snap + 0.04, to: kickAt + 0.1, ease: .out)
            }
            for slot in [Slot.corner(0), .corner(1)] {
                guard let i = at(slot), let g = gunners.first(where: { (position($0, 0).x > 0) == (position(i, 0).x > 0) }) else { continue }
                move(i, to: [CGPoint(x: landing.x + (position(g, 0).x > 0 ? 16 : -16), y: landing.y - 6)], from: snap + 0.1, to: land + 0.2)
            }
        }

        /// The returner under the kick: a hand up and a fair catch, a catch and
        /// a return, or he lets it go (downed, out of bounds, a touchback).
        mutating func receive(returner: Int, landing: CGPoint, land: Double, kickAt: Double) {
            guard let scene else { return }
            switch scene.kick {
            case .fairCatch?:
                move(returner, to: [CGPoint(x: landing.x, y: landing.y + 1)], from: kickAt + 0.3, to: land - 0.1, ease: .out)
                script.players[returner].holds.append(Hold(kind: .fairCatch, from: land - 0.7, until: land - 0.08))
                script.players[returner].act(.catchHigh, at: land, toward: CGPoint(x: 0, y: line))
                script.flashes.append(Flash(beat: .catchBall, at: land, point: FieldPoint(landing, z: 5)))
                carry(returner, from: land, until: .infinity)
                over = land + 0.3
                script.end = FieldPoint(landing)
                script.stamp = land + 0.25
            case .returned?, nil:
                move(returner, to: [CGPoint(x: landing.x, y: landing.y + 1)], from: kickAt + 0.3, to: land - 0.05, ease: .out)
                script.players[returner].act(.catchHigh, at: land, toward: CGPoint(x: 0, y: line))
                script.flashes.append(Flash(beat: .catchBall, at: land, point: FieldPoint(landing, z: 5)))
                run(returner, from: landing, at: land + 0.06, taken: [returner], returning: true)
            case .downed?:
                // It lands short of him and rolls on until the coverage downs it.
                let stop = CGPoint(x: landing.x - 3, y: Gridiron.y(scene.stopped ?? scene.to))
                fly(from: FieldPoint(landing), to: FieldPoint(stop, z: 0.6), start: land, time: 0.8, arc: .bounce(3), ease: .out)
                move(returner, to: [CGPoint(x: landing.x + 18, y: landing.y + 24)], from: land - 0.6, to: land + 0.6, ease: .out)
                if let downer = nearest(.offense, to: stop, at: land, roles: [.cover]) {
                    move(downer, to: [CGPoint(x: stop.x + 2, y: stop.y - 2)], from: land - 0.2, to: land + 0.85)
                    script.players[downer].act(.scoop, at: land + 0.9, toward: stop)
                }
                over = land + 0.95
                script.end = FieldPoint(stop)
                script.stamp = land + 0.95
            case .outOfBounds?:
                let out = CGPoint(x: Gridiron.half + 6, y: landing.y + 6)
                fly(from: FieldPoint(landing), to: FieldPoint(out, z: 0.6), start: land, time: 0.5, arc: .bounce(2), ease: .out)
                over = land + 0.5
                script.end = FieldPoint(out)
                script.stamp = land + 0.5
            case .touchback?:
                let back = CGPoint(x: landing.x + 2, y: max(landing.y + 14, 314))
                fly(from: FieldPoint(landing), to: FieldPoint(back, z: 0.6), start: land, time: 0.55, arc: .bounce(2), ease: .out)
                move(returner, to: [CGPoint(x: landing.x - 6, y: landing.y + 4)], from: kickAt + 0.3, to: land, ease: .out)
                script.players[returner].holds.append(Hold(kind: .kneel, from: land + 0.1))
                over = land + 0.55
                script.end = FieldPoint(back)
                script.stamp = land + 0.45
            }
        }

        /// The snap to the holder, the kicker's approach and kick, and the
        /// ball's flight through (or past) the uprights from the real spot.
        mutating func fieldGoal() {
            guard let scene else { return }
            kickFormation()
            guard let holder = at(.holder), let kicker = at(.kicker) else { return }
            let inHand = snapBall(to: holder, height: 1.2)
            script.players[holder].holds.append(Hold(kind: .kneel, from: 0))
            let ballSpot = CGPoint(x: ballX, y: line - 21)
            let kickAt = inHand + 0.42
            carry(holder, from: inHand, until: kickAt)
            move(kicker, to: [CGPoint(x: ballX - 3, y: ballSpot.y - 4), CGPoint(x: ballX - 1.2, y: ballSpot.y - 1)], from: inHand - 0.15, to: kickAt,
                 ease: .inOut)
            script.players[kicker].act(.kick, at: kickAt, toward: CGPoint(x: 0, y: Gridiron.backLine))
            let foot = FieldPoint(ballSpot, z: 0.8)
            script.flashes.append(Flash(beat: .kick, at: kickAt, point: foot))
            // Past the posts and on: between the uprights over the bar when it's
            // good; outside an upright, or short of the bar, when it isn't.
            let miss = scene.miss
            let past = Gridiron.backLine + 22
            let target: FieldPoint = switch miss {
            case .wideRight?: FieldPoint(x: Gridiron.upright + 7, y: past, z: 12)
            case .wideLeft?: FieldPoint(x: -Gridiron.upright - 7, y: past, z: 12)
            case .short?: FieldPoint(x: 1, y: Gridiron.backLine - 12, z: 0)
            case .blocked?: FieldPoint(x: ballX + 6, y: line - 6, z: 0)
            default: FieldPoint(x: 1.2, y: past, z: 14)
            }
            if miss == .blocked {
                block(kickAt: kickAt, foot: foot)
                return
            }
            let d = hypot(target.x - foot.x, target.y - foot.y)
            let time = min(max(0.5 + d / 190, 0.8), 1.65)
            let peak = miss == .short ? 10 + d * 0.06 : max(12, d * 0.1)
            let flight = fly(from: foot, to: target, start: kickAt, time: time, arc: .arc(peak))
            if miss != .short {
                // On into the net behind the posts, and put away.
                fly(from: target, to: FieldPoint(x: target.x * 1.2, y: target.y + 14, z: 0), start: kickAt + time, time: 0.35, arc: .straight)
                script.ballGone = kickAt + time + 0.3
            }
            if miss != .short {
                // Crossing the end line: the crossbar's moment.
                let f = script.flights[flight]
                let u = (Gridiron.backLine - foot.y) / max(target.y - foot.y, 1)
                let at = kickAt + time * min(max(u, 0), 1)
                script.score = at
                script.scorePoint = f.point(at: at)
            }
            // The rush: the line surges, the middle leaps.
            for k in 0..<9 {
                guard let i = at(.rusher(k)) else { continue }
                let p = position(i, 0)
                move(i, to: [CGPoint(x: ballX + (p.x - ballX) * 0.9, y: line - 3)], from: snap + 0.03, to: snap + 0.6, ease: .out)
            }
            over = kickAt + time
            script.end = FieldPoint(target.ground)
            script.stamp = (script.score ?? kickAt + time) + 0.1
        }

        /// A kick blocked at the line: the man ESPN credits (the rusher on
        /// his slot's side) comes through and goes up, both arms high, the
        /// ball off his hands a beat after it's kicked, and away behind the
        /// line, bouncing.
        mutating func block(kickAt: Double, foot: FieldPoint) {
            guard let scene else { return }
            let rushers = players(.defense, .front)
            let lane = scene.blocker?.slot.flatMap { FootballDepthChart.Slot(key: $0, athletes: [], defense: true).lane }
            let side = Self.sign(lane)
            let sided = side == 0 ? rushers : rushers.filter { (position($0, 0).x - ballX) * side > 0 }
            let aim = CGPoint(x: ballX + side * 6, y: line)
            guard let blocker = (sided.isEmpty ? rushers : sided).min(by: { hypot(position($0, 0).x - aim.x, position($0, 0).y - aim.y)
                < hypot(position($1, 0).x - aim.x, position($1, 0).y - aim.y) }) else { return }
            let from = position(blocker, 0)
            let through = CGPoint(x: ballX + min(max(from.x - ballX, -7), 7), y: line - 2)
            let hands = FieldPoint(x: through.x, y: through.y - 1, z: 8.5)
            let meets = kickAt + 0.14
            move(blocker, to: [through], from: snap + 0.03, to: meets - 0.04, ease: .out)
            script.players[blocker].act(.leap, at: meets, toward: foot.ground)
            fly(from: foot, to: hands, start: kickAt, time: meets - kickAt, arc: .arc(1.2))
            script.flashes.append(Flash(beat: .deflect, at: meets, point: hands))
            let away: Double = through.x >= ballX ? 1 : -1
            let landing = CGPoint(x: through.x + away * 12, y: line - 16)
            fly(from: hands, to: FieldPoint(landing, z: 0.6), start: meets, time: 0.85, arc: .bounce(2), ease: .out)
            for k in 0..<9 {
                guard let i = at(.rusher(k)), i != blocker else { continue }
                let p = position(i, 0)
                move(i, to: [CGPoint(x: ballX + (p.x - ballX) * 0.9, y: line - 3)], from: snap + 0.03, to: snap + 0.6, ease: .out)
            }
            over = meets + 0.85
            script.end = FieldPoint(landing)
            script.stamp = meets + 0.5
        }

        // MARK: Flags

        /// A flag that stopped the snap: the man flagged moves early, the
        /// nearest official's flag comes in on him, the players straighten
        /// up, and the yards are walked off; the ball is never snapped.
        mutating func penalty() {
            guard let scene, let ruling else { return }
            script.legs.append(Leg(from: 0, until: 0, hand: .spot(spot)))
            let onDefense = scene.to >= scene.from
            let lands = 1.0
            let thrown = ruling.flags.filter { $0.timing == .beforeSnap || ruling.flags.allSatisfy { $0.timing != .beforeSnap } }
            for (k, flag) in (thrown.isEmpty ? [nil] : thrown.map(Optional.some)).enumerated() {
                let team: Team = flag?.side.map { $0 == ruling.offense ? .offense : .defense } ?? (onDefense ? .defense : .offense)
                var at = CGPoint(x: ballX + (team == .defense ? 9 : -9), y: line + (team == .defense ? 4 : -4))
                if let fouler = man(flag?.player, team, near: spot.ground, at: 0), flag?.player != nil {
                    // Out of his stance a beat early, a lurch, and back.
                    let here = position(fouler, 0), way: Double = team == .offense ? 1 : -1
                    move(fouler, to: [CGPoint(x: here.x, y: here.y + 1.6 * way)], from: 0.42, to: 0.55, ease: .out)
                    move(fouler, to: [here], from: 0.75, to: 1.2)
                    script.players[fouler].set = min(script.players[fouler].set ?? 0.42, 0.42)
                    at = CGPoint(x: here.x + 2, y: here.y + 1.6 * way)
                }
                throwFlag(at: at, lands: lands + Double(k) * 0.2, declined: flag?.status == .declined, wing: true)
            }
            for i in script.players.indices { script.players[i].set = min(script.players[i].set ?? lands, lands + 0.15) }
            walk(from: line, to: Gridiron.y(scene.to), start: lands + 0.45, moving: true)
        }

        /// The flags on a play that ran, each when and where its foul
        /// happened, on the man flagged (from the nearest official, the play
        /// going on round it): a hold mid-play, interference as the ball
        /// arrives, roughing the passer just after the throw, a horse collar
        /// or a face mask at the tackle, an offside at the snap, one after the
        /// whistle once it's over. Then the yards walked off, from where it
        /// was enforced to where it put the ball; a declined flag only says
        /// so, offsetting ones walk nothing off.
        mutating func flags() {
            guard let ruling, !ruling.flags.isEmpty else { return }
            var walked: FootballScene.Flag?
            for flag in ruling.flags {
                let foul = moment(of: flag)
                let team: Team = flag.side == ruling.offense ? .offense : .defense
                let fouler = flag.player.flatMap { man($0, team, near: foul.near, at: foul.at) }
                var place = fouler.map { position($0, foul.at) } ?? foul.near
                if foul.fixed {
                    // Where it happened (the catch point, the passer, the tackle), and the man flagged in on it.
                    place = foul.near
                    if let f = fouler, hypot(position(f, foul.at).x - place.x, position(f, foul.at).y - place.y) > 4 {
                        let from = max(foul.at - 0.9, snap + 0.04)
                        move(f, to: [CGPoint(x: place.x + 2.5, y: place.y + 2)], from: from, to: foul.at, ease: .inOut)
                    }
                    if let f = fouler, foul.late, let qb = at(.quarterback) {
                        // Roughing the passer: the hit after the ball's gone.
                        script.players[f].act(.tackle, at: foul.at + 0.04, toward: place)
                        if !script.players[qb].holds.contains(where: { $0.kind == .knocked }) {
                            script.players[qb].holds.append(Hold(kind: .knocked, from: foul.at + 0.12))
                        }
                        script.flashes.append(Flash(beat: .hit, at: foul.at + 0.04, point: FieldPoint(place, z: 4)))
                    }
                }
                throwFlag(at: CGPoint(x: place.x + 2.5, y: place.y - 2), lands: foul.at + 0.5, declined: flag.status == .declined,
                          wing: abs(foul.at - snap - 0.25) < 0.01)
                if flag.status == .accepted, walked == nil { walked = flag }
            }
            let end = Gridiron.y(ruling.to), ended = script.end?.y ?? end
            guard let walked, abs(end - ended) > 0.5 else { return }
            let from = walked.from.map(Gridiron.y) ?? ended
            let lands = max(script.flags.map(\.lands).max() ?? over, over)
            // The ball goes to the official's spot, then walks.
            if let ball = script.ball(at: lands), abs(ball.y - from) > 1 || abs(ball.x - ballX) > 1 {
                fly(from: ball, to: FieldPoint(x: ballX, y: from, z: 0.6), start: lands + 0.25, time: 0.45, arc: .arc(5))
            }
            walk(from: from, to: end, start: lands + 0.85, moving: false)
        }

        /// When and near where a foul happened, by what it was (its slug, or
        /// its name); `fixed` when it happened at a place of its own (the
        /// catch point, the passer, the tackle), not wherever the man flagged
        /// is; `late` for a hit on the passer after the throw.
        func moment(of flag: FootballScene.Flag) -> (at: Double, near: CGPoint, fixed: Bool, late: Bool) {
            let key = (flag.slug ?? flag.name).lowercased().replacingOccurrences(of: " ", with: "-")
            let end = stop ?? (over, script.end?.ground ?? spot.ground)
            func ball(_ t: Double) -> CGPoint { script.ball(at: t)?.ground ?? spot.ground }
            if flag.timing == .afterPlay { return (over + 0.35, end.point, true, false) }
            if key.contains("interference"), let arrival { return (arrival.at - 0.05, arrival.point, true, false) }
            if key.contains("roughing-the-passer"), let release, let qb = at(.quarterback) { return (release + 0.15, position(qb, release + 0.15), true, true) }
            if ["grounding", "illegal-forward"].contains(where: key.contains), let release, let qb = at(.quarterback) {
                return (release + 0.1, position(qb, release + 0.1), true, false)
            }
            let atTheStop = ["horse-collar", "face-mask", "facemask", "unnecessary-roughness", "targeting", "tripping", "personal-foul", "roughing",
                             "unsportsmanlike", "late-hit", "leverage", "lowering"]
            if atTheStop.contains(where: key.contains) { return (end.at, end.point, true, false) }
            let atTheSnap = ["offside", "encroachment", "neutral-zone", "illegal-shift", "illegal-motion", "illegal-formation", "false-start",
                             "too-many", "substitution", "delay"]
            if atTheSnap.contains(where: key.contains) { return (snap + 0.25, spot.ground, false, false) }
            // A hold, a block in the back, illegal hands: while the play goes on, at the point of attack (in the pocket before a
            // throw, as the back hits the hole, as the returner sets off).
            let carried = script.legs.last { if case .carry = $0.hand { return $0.until.isInfinite }; return false }?.from
            let mid = release.map { snap + ($0 - snap) * 0.6 } ?? carried.map { $0 + min(max((end.at - $0) * 0.25, 0.1), 0.5) } ?? snap + 0.9
            return (min(mid, end.at), ball(mid), false, false)
        }

        /// An official's flag, thrown at the foul: from the official nearest
        /// it (at his post since the snap), end over end to the spot.
        mutating func throwFlag(at spot: CGPoint, lands: Double, declined: Bool = false, wing: Bool = false) {
            let thrown = lands - 0.45
            let thrower = official(near: spot, wing: wing)
            let hand = position(thrower, thrown)
            script.players[thrower].act(.flagThrow, at: thrown, toward: spot)
            script.flags.append(Flag(thrown: thrown, lands: lands, from: FieldPoint(hand, z: 6.5), to: spot, declined: declined))
            script.flashes.append(Flash(beat: .flag, at: lands, point: FieldPoint(spot)))
        }

        /// The official nearest a spot, at his post: the referee behind the
        /// backfield, the umpire (the NFL's, in it), the line judge and the
        /// head linesman on the sidelines at the line, the back judge deep;
        /// a foul at the line (`wing`) is the sideline officials'. Added the
        /// first time one throws.
        mutating func official(near p: CGPoint, wing: Bool = false) -> Int {
            let sides = [CGPoint(x: -Gridiron.half - 3, y: line), CGPoint(x: Gridiron.half + 3, y: line)]
            let posts = wing ? sides : [CGPoint(x: ballX + 16, y: line - 40), CGPoint(x: ballX - 12, y: line - 33)] + sides + [CGPoint(x: ballX + 6, y: line + 75)]
            let post = posts.min { hypot($0.x - p.x, $0.y - p.y) < hypot($1.x - p.x, $1.y - p.y) }!
            if let i = script.players.indices.first(where: { script.players[$0].team == .official && script.players[$0].at == post }) { return i }
            script.players.append(Player(team: .official, at: post, role: .official))
            return script.players.count - 1
        }

        /// The ball slides from one spot to the other; with `moving`, the
        /// players walk with it.
        mutating func walk(from: Double, to: Double, start: Double, moving: Bool) {
            // At a walk.
            let time = min(max(abs(to - from) / 16, 0.8), 1.8)
            script.march = March(from: from, to: to, start: start, end: start + time)
            script.legs.append(Leg(from: start, until: start + time, hand: .slide(from: FieldPoint(x: ballX, y: from, z: 0.6),
                                                                                  to: FieldPoint(x: ballX, y: to, z: 0.6))))
            if moving {
                for i in script.players.indices {
                    let p = position(i, start)
                    move(i, to: [CGPoint(x: p.x, y: p.y + to - from)], from: start, to: start + time)
                }
            }
            over = start + time
            script.end = FieldPoint(x: ballX, y: to, z: 0)
            script.stamp = start + time + 0.05
        }

        // MARK: End and settle

        /// The action ends when the last thing stops; the stamp lands as it
        /// resolves; the lines move to the new spot with it.
        mutating func finish() {
            guard let scene = ruling else { return }
            script.legs.sort { $0.from < $1.from }
            if !script.stamp.isFinite { script.stamp = max(over, snap + 0.6) }
            // The stamp holds a beat on the play before the field settles (a try's beat is shorter).
            let hold = scene.pointAfter == nil ? 0.35 : 0.3
            let ends = [script.stamp + hold, over, (script.flashes.map(\.at).max() ?? 0) + 0.4,
                        script.flights.map(\.end).max() ?? 0]
            script.settle = max(ends.max() ?? 0, 1.2) + hold
            // No lines on a kickoff: there's no line of scrimmage yet.
            script.lines = scene.kind == .kickoff ? Lines() : Lines(scrimmage: line, gain: scene.gainBefore.map(Gridiron.y))
            script.next = Lines(scrimmage: scene.scoring == nil && !isKick ? Gridiron.y(scene.to) : nil, gain: scene.gainAfter.map(Gridiron.y))
            if isKick, scene.scoring == nil, scene.kind == .punt || scene.kind == .kickoff {
                script.next = Lines(scrimmage: Gridiron.y(scene.to), gain: scene.gainAfter.map(Gridiron.y))
            }
            // After a try, the next snap is the kickoff's: no lines.
            if scene.pointAfter != nil { script.next = Lines() }
            script.linesMove = script.stamp - 0.05
        }

        var isKick: Bool {
            switch scene?.kind {
            case .punt?, .kickoff?, .fieldGoal?, .extraPoint?: true
            default: false
            }
        }

        /// The headline for a marquee play, landing with its payoff: the ball
        /// crossing the goal line, the kick over the bar, the pick, the
        /// recovery. A gain, an incompletion and a punt keep to the stamp.
        mutating func headline() {
            // A try keeps to its stamp: the touchdown had the headline.
            guard let scene = ruling, scene.pointAfter == nil else { return }
            func banner(_ text: String, _ tone: Banner.Tone, at time: Double, confetti: Bool = false) {
                script.banner = Banner(text: text, tone: tone, at: time, until: max(script.settle, time + 1.4), confetti: confetti)
            }
            let catchAt = script.flashes.last { $0.beat == .catchBall }?.at
            switch (scene.scoring, scene.kind) {
            case (.touchdown?, .interception):
                banner("PICK SIX", .side(scene.scorer), at: script.score ?? script.stamp, confetti: true)
            case (.touchdown?, _):
                banner("TOUCHDOWN", .side(scene.scorer), at: script.score ?? script.stamp, confetti: true)
            case (.safety?, _):
                banner("SAFETY", .side(scene.scorer), at: script.stamp)
            case (_, .fieldGoal(true)):
                banner("FIELD GOAL", .side(scene.offense), at: script.score ?? script.stamp)
            case (_, .fieldGoal(false)):
                banner(scene.miss == .blocked ? "BLOCKED" : "NO GOOD", .neutral, at: script.score ?? script.stamp)
            case (_, .interception):
                banner("INTERCEPTION", .neutral, at: (catchAt ?? script.stamp) + 0.05)
            case (_, .fumble):
                banner("FUMBLE", .neutral, at: recoveredAt ?? script.stamp - 0.1)
            default:
                if scene.onDowns { banner("TURNOVER ON DOWNS", .neutral, at: script.stamp) }
            }
        }

        /// The stamp's corner, measured from its type: the code at a fifth of
        /// the view's height, the title under it at about an eighteenth, in a
        /// view twice as wide as tall.
        mutating func measureStamp() {
            guard let scene = ruling else { return }
            let stamp = FootballStamp(scene)
            guard !stamp.parts.isEmpty else { return }
            // Each part's glyphs (the tag at 0.42 of the number's size) and the space after it.
            var code = 0.0
            for part in stamp.parts {
                code += part.text.reduce(0.0) { width, c in width + (c.isNumber ? 0.6 : c == "+" || c == "−" ? 0.62 : 0.7) }
                    * (part.heavy ? 1 : 0.42) + 0.16
            }
            let title = min(Double(stamp.title.count) * 0.72 * 0.28, 3.4)
            let width = 0.055 + max(code, title) * 0.2
            script.corner = CGSize(width: width / CameraFrame.aspect + 0.03, height: 0.3)
        }

        /// After the hold: on a new down both teams jog back to the new line
        /// and the ball is spotted there; after a score, a kick or a change of
        /// possession they stay where it ended.
        mutating func settle() {
            guard let scene = ruling else { return }
            let s = script.settle, back = s + 0.75
            let reform = scene.scoring == nil && !scene.flips && !isKick && scene.pointAfter == nil
            if reform {
                let to = Gridiron.y(scene.to), dy = to - line
                for i in script.players.indices {
                    let home = script.players[i].at
                    script.players[i].move(to: [CGPoint(x: home.x, y: home.y + dy)], from: s, to: back)
                    script.players[i].holds = script.players[i].holds.map { var h = $0; h.until = min(h.until, s); return h }
                    if script.players[i].set != nil { script.players[i].resets = back }
                }
                if let ball = script.ball(at: s) {
                    fly(from: ball, to: FieldPoint(x: ballX, y: to, z: 0.6), start: s + 0.1, time: 0.6, arc: .arc(6))
                }
                script.legs.sort { $0.from < $1.from }
            }
            script.duration = reform ? back : s + (scene.pointAfter == nil ? 0.3 : 0.1)
        }

        // MARK: Camera

        /// Cuts the play into shots: the formation from behind the offense for
        /// the snap; the ball in the air with the man going for it; the ball
        /// carrier with the men closing on him; then the end spot and the new
        /// line to gain, where it rests.
        mutating func shoot() {
            guard let scene = ruling else { return }
            let everyone = script.players.indices.filter { script.players[$0].team != .official }
            let opening: [Int] = switch scene.kind {
            case .punt: everyone.filter { $0 != at(.returner) }
            case .kickoff: everyone.filter { $0 != at(.returner) && $0 != at(.deep) }
            default: everyone
            }
            var points: [FieldPoint] = [spot]
            if let gain = scene.gainBefore.map(Gridiron.y), gain - line < 45 { points.append(FieldPoint(x: ballX, y: gain)) }
            var shots = [Shot(from: 0, actors: opening, points: points, closest: 60, at: 0)]
            // The ball's flights (the snap's aside): each followed with whoever's going for it.
            for (i, f) in script.flights.enumerated() where f.end - f.start > 0.3 && f.start > snap + 0.1 && f.start < over {
                let near = everyone.min { a, b in
                    hypot(position(a, f.end).x - f.to.x, position(a, f.end).y - f.to.y)
                        < hypot(position(b, f.end).x - f.to.x, position(b, f.end).y - f.to.y)
                }
                let kept: [FieldPoint] = script.yaw == 0 ? Self.posts : []
                shots.append(Shot(from: max(f.start - 0.3, (shots.last?.from ?? 0) + 0.25), flight: i, actors: near.map { [$0] } ?? [],
                                  points: kept, closest: f.to.y - f.from.y > 90 ? 80 : 55))
            }
            // The ball carrier, from when he has it, with the men closing on him.
            if let carry = script.legs.last(where: { if case .carry = $0.hand { return $0.until.isInfinite }; return false }),
               case let .carry(runner) = carry.hand, carry.from < over {
                let closing = script.players.indices.filter { i in
                    script.players[i].actions.contains { $0.kind == .tackle }
                }
                shots.append(Shot(from: max(carry.from, (shots.last?.from ?? 0) + 0.25), actors: [runner] + closing,
                                  points: script.end.map { [$0] } ?? [], closest: 75))
            }
            // A flag thrown while the play goes on: where it lands is in frame as it comes down.
            for flag in script.flags where flag.lands < over {
                guard let k = shots.lastIndex(where: { $0.from <= flag.thrown - 0.2 }) else { continue }
                var flagged = shots[k]
                flagged.from = flag.thrown - 0.2
                flagged.points.append(FieldPoint(flag.to))
                var resumed = shots[k]
                resumed.from = flag.lands + 0.5
                let next = k + 1 < shots.count ? shots[k + 1].from : .infinity
                shots.insert(flagged, at: k + 1)
                if resumed.from < next { shots.insert(resumed, at: k + 2) }
            }
            // A flag's walk: both spots.
            if let march = script.march {
                shots.append(Shot(from: max(march.start - 0.3, (shots.last?.from ?? 0) + 0.25),
                                  points: [FieldPoint(x: ballX - 24, y: march.from), FieldPoint(x: ballX + 24, y: march.from),
                                           FieldPoint(x: ballX - 24, y: march.to), FieldPoint(x: ballX + 24, y: march.to)], closest: 60))
            }
            // The end: the spot and the new line to gain.
            var ending: [FieldPoint] = script.end.map { [$0] } ?? []
            // The lines where they cross the field by the spot.
            let across = min(max(script.end?.x ?? 0, -Gridiron.half), Gridiron.half)
            if let line = script.next.scrimmage { ending += [FieldPoint(x: across - 18, y: line), FieldPoint(x: across + 18, y: line)] }
            if let gain = script.next.gain, abs(gain - (script.next.scrimmage ?? gain)) < 45 { ending.append(FieldPoint(x: across, y: gain)) }
            if scene.scoring == .fieldGoal || isKick, scene.kind != .punt, scene.kind != .kickoff { ending = Self.posts + ending }
            if scene.scoring == .touchdown, scene.pointAfter == nil, let p = script.scorePoint {
                // Room above the goal line for the fireworks.
                ending += [FieldPoint(x: p.x - 30, y: p.y, z: 30), FieldPoint(x: p.x + 30, y: p.y, z: 30)]
            }
            let carrier = script.legs.last.flatMap { leg -> Int? in if case let .carry(i) = leg.hand { return i }; return nil }
            let endFrom = min(max(script.stamp - 0.4, (shots.last?.from ?? 0) + 0.3), script.settle - 0.2)
            shots.append(Shot(from: endFrom, actors: carrier.map { [$0] } ?? [], points: ending, closest: 60))
            script.shots = shots

            let restRegion = restRegion()
            let banner = script.banner.map { $0.at...$0.until }
            // The camera keeps a little more than the stamp's corner clear: a man running into it is out of it again
            // before the camera, a beat behind, has caught up.
            let corner = CGSize(width: script.corner.width + 0.03, height: script.corner.height + 0.04), stamp = script.stamp
            let script = self.script
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
                guard stamp.isFinite, t >= stamp - 0.3 else { return CameraFrame.fitting(region, headroom: headroom, closest: closest) }
                // The stamp never sits on anyone in view, in the play or not (a pile trailing it, a man
                // jogging back to the line).
                let others = visible(t)
                guard t > script.settle else {
                    return CameraFrame.clearing(region, items: items, others: others, headroom: headroom, closest: closest, corner: corner)
                }
                // Settled: on to where it rests, keeping the corner clear of everyone on the way.
                return CameraFrame.clearing(restRegion, items: others.filter { restRegion.intersects($0) }, others: others, headroom: headroom,
                                            closest: 60, corner: corner)
            }
            /// Everyone in view, now and a beat ahead (the camera is a beat behind).
            func visible(_ t: Double) -> [CGRect] {
                script.players.indices.filter { script.players[$0].opacity(at: t) > 0.5 }
                    .flatMap { i in [t, t + 0.4].map { script.room(FieldPoint(script.players[i].position(at: $0)), figure: true) } }
            }
            let rest = restFrame()
            // Followed until everyone is back in place, then an eased move the last of the way to the rest
            // framing, as long as the camera's caps need (an eased move peaks at one and a half times its
            // average speed).
            let followed = script.duration
            let samples = CameraRig.follow(until: followed, goal: goal)
            let last = samples.last ?? rest
            let pan = hypot(last.x - rest.x, last.y - rest.y) / min(last.span, rest.span), zoom = log(rest.span / last.span)
            let glide = max(0.4, 1.5 * pan / 1.25, 1.5 * abs(zoom) / (zoom > 0 ? 2 : 1))
            self.script.duration = max(followed + glide, (script.banner?.until ?? 0) + 0.3)
            self.script.camera = CameraPath(samples: samples, settle: followed, back: followed + glide, rest: rest)
        }

        /// The goalposts at the far end: the base, the crossbar, the tops of the uprights.
        static let posts: [FieldPoint] = [FieldPoint(x: 0, y: Gridiron.backLine), FieldPoint(x: -Gridiron.upright, y: Gridiron.backLine, z: 30),
                                          FieldPoint(x: Gridiron.upright, y: Gridiron.backLine, z: 30)]

        /// What the camera rests on: everyone where they stand at the end, and the lines.
        func restRegion() -> CGRect {
            let t = script.duration + 1
            var items = script.players.indices.filter { script.players[$0].opacity(at: t) > 0.5 }
                .map { script.room(FieldPoint(script.players[$0].position(at: t)), figure: true) }
            let reform = ruling.map { $0.scoring == nil && !$0.flips && !isKick } ?? true
            if !reform {
                // After a score, a kick or a turnover: the end of it, not the whole field.
                let end = script.end ?? spot
                items = items.filter { abs($0.midX - end.x) < 70 && abs($0.minY + 3 - end.y * 0.5) < 45 }
                items.append(script.room(end, figure: true))
                if ruling?.scoring == .fieldGoal || ruling.map({ if case .fieldGoal = $0.kind { return true }; return false }) == true {
                    items += Self.posts.map { script.room($0, figure: false) }
                }
            }
            for line in [script.next.scrimmage, script.next.gain].compactMap({ $0 }) {
                items.append(script.room(FieldPoint(x: ballX, y: line), figure: false))
            }
            guard let first = items.first else { return script.room(spot, figure: true) }
            return items.dropFirst().reduce(first) { $0.union($1) }
        }

        func restFrame() -> CameraFrame {
            let t = script.duration + 1
            let region = restRegion()
            let items = script.players.indices.filter { script.players[$0].opacity(at: t) > 0.5 }
                .map { script.room(FieldPoint(script.players[$0].position(at: t)), figure: true) }
            // The stamp sits on nobody at rest.
            return CameraFrame.clearing(region, items: items.filter { region.intersects($0) }, others: items, headroom: CameraFrame.headroom,
                                        closest: 60, corner: script.corner)
        }
    }
}

// MARK: - Shots

extension FootballScript {
    /// One shot of the broadcast: from when, and what it keeps in frame.
    struct Shot: Equatable {
        var from: Double
        /// A flight's ball, now and a beat ahead, and its shadow.
        var flight: Int? = nil
        /// Players by index, now and a beat ahead.
        var actors: [Int] = []
        /// Fixed spots: the goalposts, a line.
        var points: [FieldPoint] = []
        /// No closer than this (feet top to bottom).
        var closest = 60.0
        /// A cut, not a move.
        var cut = false
        /// Players framed where they stood at this moment (the formation), not as they move.
        var at: Double? = nil

        /// What it keeps in frame at t: each figure's or ball's room.
        func region(in script: FootballScript, at t: Double) -> [CGRect] {
            var items = points.map { script.room($0, figure: $0.z == 0) }
            if let flight, flight < script.flights.count {
                let f = script.flights[flight]
                for dt in [0, 0.2, 0.45] {
                    let p = f.point(at: min(max(t + dt, f.start), f.end))
                    items.append(script.room(p, figure: false))
                    items.append(script.room(FieldPoint(p.ground), figure: false))
                }
            }
            for index in actors where index < script.players.count {
                let player = script.players[index]
                if let fixed = at {
                    items.append(script.room(FieldPoint(player.position(at: fixed)), figure: true))
                    continue
                }
                for dt in [0, 0.25] where player.opacity(at: t + dt) > 0.5 {
                    items.append(script.room(FieldPoint(player.position(at: t + dt)), figure: true))
                }
            }
            return items
        }
    }
}

// MARK: - Stamp

/// The stamp for a play, low on the left as it resolves: the number big and
/// heavy in the play's color ("+12", "−7", "INC", "FG 47 ✓"), a tag lighter
/// beside it ("1ST DOWN", "SACK", "TD"), the play in small capitals under it.
/// (pure; tested)
struct FootballStamp: Equatable {
    struct Part: Equatable {
        var text: String
        var heavy: Bool
    }

    enum Tone: Equatable {
        /// The offense's color: a gain.
        case gain
        /// The scoring team's color.
        case score
        /// The app's red: a sack, a turnover.
        case loss
        /// A flag's yellow.
        case flag
        case neutral
    }

    var parts: [Part] = []
    var title = ""
    var tone = Tone.neutral
    /// A miss's ✗ in red, beside its kick.
    var missed = false

    init(_ scene: FootballScene) {
        func yards(_ n: Int) -> String { n > 0 ? "+\(n)" : n < 0 ? "−\(-n)" : "0" }
        let names = scene.names
        func titled(_ words: String?...) -> String { words.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ") }
        let way: String? = switch (scene.depth, scene.lane) {
        case let (depth?, lane?): "\(depth == .deep ? "Deep" : "Short") \(Self.word(lane))"
        case let (nil, lane?): scene.gap.map { gap in gap == .middle ? "up the middle" : "\(Self.word(lane)) \(Self.word(gap))" }
        default: nil
        }
        let thrown = [way, names["target"].map { "to \($0)" }].compactMap { $0 }.joined(separator: " ")
        let td = scene.scoring == .touchdown
        // A try: "XP ✓" by the kicker, "2-PT ✓" by whoever ran or caught it (the NFL's terms).
        if let tried = scene.pointAfter {
            let good = tried == .kick ? scene.kind == .extraPoint(good: true) : td
            parts = [Part(text: tried == .kick ? "XP" : "2-PT", heavy: false), Part(text: good ? "✓" : "✗", heavy: true)]
            let how = tried == .pass ? names["target"].map { "to \($0)" }
                : scene.gap.map { gap in gap == .middle ? "up the middle" : "\(Self.word(scene.lane ?? .middle)) \(Self.word(gap))" }
            title = tried == .kick ? names["lead"] ?? "" : [names["lead"], how].compactMap { $0 }.joined(separator: tried == .pass ? " " : ", ")
            tone = good ? .score : .neutral
            missed = !good
            return
        }
        switch scene.kind {
        case _ where scene.flags.count > 1 && scene.flags.allSatisfy({ $0.status == .offsetting }):
            // Offsetting fouls: the down is played again.
            parts = [Part(text: "NO PLAY", heavy: true)]
            title = "Offsetting penalties"
            tone = .flag
        case .pass:
            parts = [Part(text: yards(scene.yards), heavy: true)]
            title = thrown
            tone = td ? .score : scene.yards > 0 ? .gain : .neutral
        case .rush, .other:
            parts = scene.kind == .other && scene.yards == 0 ? [] : [Part(text: yards(scene.yards), heavy: true)]
            title = [names["lead"], way].compactMap { $0 }.joined(separator: ", ")
            tone = td ? .score : scene.yards > 0 ? .gain : .neutral
        case .incomplete:
            parts = [Part(text: "INC", heavy: true)]
            title = thrown
        case .sack:
            parts = [Part(text: yards(scene.yards), heavy: true), Part(text: "SACK", heavy: false)]
            title = names["stop"].map { "By \($0)" } ?? ""
            tone = .loss
        case .kneel:
            parts = [Part(text: yards(scene.yards), heavy: true), Part(text: "KNEEL", heavy: false)]
        case .spike:
            parts = [Part(text: "INC", heavy: true), Part(text: "SPIKE", heavy: false)]
        case .interception:
            parts = [Part(text: "INT", heavy: true)]
            title = titled(names["taker"], scene.yards > 0 && !td ? "\(scene.yards) yd return" : nil)
            tone = td ? .score : .loss
        case .fumble:
            parts = [Part(text: "FUMBLE", heavy: true)]
            title = titled(names["taker"].map { "Recovered by \($0)" })
            tone = td ? .score : .loss
        case .punt:
            parts = [Part(text: "PUNT", heavy: false), Part(text: "\(scene.kickYards ?? abs(Int(scene.to - scene.from)))", heavy: true)]
            title = Self.kick(scene)
        case .kickoff:
            if let back = scene.returnYards, back != 0 || td {
                parts = [Part(text: yards(back), heavy: true), Part(text: "RETURN", heavy: false)]
                tone = td ? .score : .neutral
                title = names["returner"] ?? ""
            } else {
                parts = [Part(text: "KICK", heavy: false), Part(text: "\(scene.kickYards ?? 0)", heavy: true)]
                title = Self.kick(scene)
            }
        case let .fieldGoal(good):
            parts = [Part(text: "FG", heavy: false), Part(text: "\(scene.kickYards ?? Int(117 - scene.from))", heavy: true),
                     Part(text: good ? "✓" : "✗", heavy: true)]
            title = titled(names["lead"], good ? nil : Self.miss(scene.miss))
            tone = good ? .score : .neutral
            missed = !good
        case let .extraPoint(good):
            parts = [Part(text: "XP", heavy: false), Part(text: good ? "✓" : "✗", heavy: true)]
            tone = good ? .score : .neutral
            missed = !good
        case .penalty:
            let gained = Int((scene.to - scene.from).rounded())
            parts = [Part(text: yards(gained == 0 ? scene.yards : gained), heavy: true), Part(text: "FLAG", heavy: false)]
            let flag = scene.flags.first { $0.status == .accepted } ?? scene.flags.first
            title = titled(scene.penalty?.name.map { Self.announced($0, side: flag?.side, offense: scene.offense) }, scene.penalty?.noPlay == true ? "No play" : nil)
            tone = .flag
        }
        if td {
            parts.append(Part(text: "TD", heavy: false))
        } else if scene.firstDown, scene.kind != .penalty || parts.count < 3 {
            parts.append(Part(text: "1ST DOWN", heavy: false))
        } else if scene.onDowns {
            title = titled("Turnover on downs")
        }
    }

    /// A foul as the referee announces it: the foul, then the side ("Holding, Offense", "Pass Interference, Defense").
    static func announced(_ name: String, side: GameDetail.Side?, offense: GameDetail.Side?) -> String {
        for (prefix, team) in [("Offensive ", "Offense"), ("Defensive ", "Defense")] where name.hasPrefix(prefix) {
            return "\(name.dropFirst(prefix.count)), \(team)"
        }
        guard let side, let offense else { return name }
        return "\(name), \(side == offense ? "Offense" : "Defense")"
    }

    private static func word(_ lane: FootballScene.Lane) -> String { lane == .left ? "left" : lane == .right ? "right" : "middle" }
    private static func word(_ gap: FootballScene.Gap) -> String {
        switch gap {
        case .middle: "middle"
        case .guard: "guard"
        case .tackle: "tackle"
        case .end: "end"
        }
    }

    private static func miss(_ miss: FootballScene.Miss?) -> String {
        switch miss {
        case .wideLeft?: "Wide left"
        case .wideRight?: "Wide right"
        case .short?: "Short"
        case .blocked?: "Blocked"
        case nil: "No good"
        }
    }

    private static func kick(_ scene: FootballScene) -> String {
        switch scene.kick {
        case .touchback?: return "Touchback"
        case .fairCatch?: return "Fair catch"
        case .downed?: return "Downed"
        case .outOfBounds?: return "Out of bounds"
        case .returned?, nil:
            if scene.scoring == .touchdown { return scene.names["returner"].map { "\($0) returns it" } ?? "Returned" }
            let back = scene.returnYards ?? scene.yards
            return scene.names["returner"].map { back == 0 ? "\($0), no return" : "\($0), \(back) yd return" } ?? "Returned"
        }
    }
}
