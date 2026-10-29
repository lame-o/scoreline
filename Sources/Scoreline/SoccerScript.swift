import SwiftUI

// The soccer theater's choreography: a `SoccerScene` turned into every
// player's path, the ball's flights and the beats (the strike, the net, the
// save, the headline, the stamp), in metres and seconds. Built once per
// moment; any frame is a pure function of the script and t, so the harness
// can draw t = 4.2 without playing 0…4.2, and the tests can check that the
// keeper's hands are where the ball is when he saves it.
//
// Time is the match clock's: each touch comes when ESPN logged it, the gaps
// between them squeezed by one factor so a move fits about five seconds (a
// long one picks up a few touches in), never quicker than the ball and the
// man on it can go, and a ball through the air takes as long as it hangs and
// arrives as it's met; the shot at its own pace, seen again from behind the
// net when it's on target; then the payoff holds: the net ripples and the
// scorer wheels away, or the keeper comes up with it (or punches it to where
// it landed). The replay ends on the frame the theater holds until the next
// moment.
//
// The men who touched the ball are where they touched it, struck with the
// foot or the head Opta logs; with the lineups, everyone else in both
// elevens stands in his team's shape and moves with the ball. The script
// also says what each one does (a strike, a header, a dive, arms up), when
// the headline lands, and where the broadcast camera looks.

struct SoccerScript: Equatable {
    /// The team on the ball and the other; between moments, the officials
    /// and the physios too (SoccerIdle.swift).
    enum Team { case attacking, defending, official, staff }

    /// A pose held for a while between moments: a man down, a physio on a
    /// knee, the referee's card or the assistant's flag up, a hand to the
    /// ear for VAR, the sign for the screen, the board held up.
    struct Hold: Equatable {
        enum Kind: Equatable { case down, kneel, cardUp, ear, screen, boardUp }
        var kind: Kind
        var from: Double
        var until = Double.infinity
    }

    /// Where a man looks from a moment on when he's standing.
    struct Look: Equatable {
        var from: Double
        var point: CGPoint
    }

    /// The loop the pitch's beats settle into between moments.
    struct Loop: Equatable {
        var start: Double
        var period: Double
    }

    struct Actor: Equatable {
        enum Role: Equatable { case outfield, keeper }

        /// A moment of the play in his feet, head or hands.
        struct Action: Equatable {
            enum Kind: Equatable {
                /// A pass, a cross or a shot struck.
                case kick
                case header
                /// Takes it down.
                case control
                /// Both hands over his head: a throw-in.
                case throwIn
                /// Turns into a shot: a block.
                case block
                /// The keeper takes it in his hands, standing.
                case gather
                /// Arms up, held.
                case celebrate
                /// Hands on his head, held.
                case dejected
                /// A header won in the air: up off the ground for it, then through it.
                case aerial
                /// The keeper's fists to it, over his head.
                case punch
                /// The keeper takes it high, in both hands, and holds it.
                case claim
            }
            var kind: Kind
            var at: Double
            /// Where it's aimed: he faces it.
            var toward: CGPoint
            /// Struck with his left foot (the strike mirrored).
            var left = false
        }

        /// The keeper at full stretch: from `start` his hands go to `target`,
        /// reaching it at `reach`; then he's down.
        struct Dive: Equatable {
            var start: Double
            var reach: Double
            var target: FieldPoint
            /// Where he lands, on the grass.
            var landing: CGPoint
        }

        var team: Team
        var role = Role.outfield
        var name: String
        var at: CGPoint
        /// ESPN's athlete ID, when it credits him.
        var athlete: String? = nil
        /// In his team's shape: a man from the lineup who didn't touch the ball.
        var shaped = false
        var moves: [PlayScript.Move] = []
        var actions: [Action] = []
        var dive: Dive?
        var holds: [Hold] = []
        var looks: [Look] = []
        /// On the pitch from, and off it from (a substitution, a red card, the half).
        var appear = -Double.infinity
        var vanish = Double.infinity

        static let fade = 0.3

        func opacity(at t: Double) -> Double {
            let fadeIn = appear.isFinite ? min(max((t - appear) / Self.fade, 0), 1) : 1
            let fadeOut = vanish.isFinite ? 1 - min(max((t - vanish) / Self.fade, 0), 1) : 1
            return fadeIn * fadeOut
        }

        func hold(at t: Double) -> Hold? { holds.last { t >= $0.from && t < $0.until } }

        /// The newest move that has begun wins: a later move starts from
        /// wherever the one before had got to.
        func position(at t: Double) -> CGPoint {
            guard let move = moves.last(where: { t >= $0.start }) else { return at }
            return t < move.end ? move.point(at: t) : move.path.last ?? at
        }

        /// Metres a second along the ground at t, and which way (nil: standing).
        func motion(at t: Double) -> (speed: Double, heading: CGPoint)? {
            guard let move = moves.last(where: { t >= $0.start }), t < move.end, move.length > 0.2 else { return nil }
            let a = move.point(at: max(t - 0.02, move.start)), b = move.point(at: min(t + 0.02, move.end))
            let d = hypot(b.x - a.x, b.y - a.y), dt = min(t + 0.02, move.end) - max(t - 0.02, move.start)
            guard d > 0.002, dt > 0 else { return nil }
            return (d / dt, CGPoint(x: (b.x - a.x) / d, y: (b.y - a.y) / d))
        }

        mutating func act(_ kind: Action.Kind, at time: Double, toward point: CGPoint, left: Bool = false) {
            actions.append(Action(kind: kind, at: time, toward: point, left: left))
        }

        mutating func move(to path: [CGPoint], from start: Double, to end: Double, ease: PlayScript.Ease = .inOut) {
            moves.removeAll { $0.start >= start }
            let origin = position(at: start)
            guard let last = path.last, hypot(last.x - origin.x, last.y - origin.y) > 0.05 || path.count > 1 else { return }
            moves.append(PlayScript.Move(start: start, end: max(end, start + 0.05), path: [origin] + path, ease: ease))
        }
    }

    struct Flight: Equatable {
        enum Kind: Equatable {
            /// At a player's feet as he runs with it.
            case carry
            case pass
            case shot
            /// Off a save, a block, the woodwork; on into the net.
            case loose
        }
        enum Arc: Equatable {
            case straight
            /// Up to `peak` metres over the line between its ends.
            case lofted(Double)
        }
        var kind: Kind
        var start: Double
        var end: Double
        var from: FieldPoint
        var to: FieldPoint
        var arc = Arc.straight
        var ease = PlayScript.Ease.linear

        func point(at t: Double) -> FieldPoint {
            let raw = end > start ? min(max((t - start) / (end - start), 0), 1) : 1
            let u = ease.value(raw)
            var p = FieldPoint(x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u, z: from.z + (to.z - from.z) * u)
            if case let .lofted(peak) = arc { p.z += 4 * peak * u * (1 - u) }
            return p
        }
    }

    /// What the ball hits: the net (it ripples), a post or the bar (it
    /// rings), the keeper's hands, a body in the way.
    struct Impact: Equatable {
        enum Kind: Equatable { case net, woodwork, save, block }
        var kind: Kind
        var at: Double
        var point: FieldPoint
    }

    /// The headline across the top for a marquee moment: GOAL, SAVE, OFF THE
    /// POST, PENALTY, OWN GOAL. It lands with the payoff and clears before
    /// the replay ends; a penalty's comes as the kick is set and gives way to
    /// the outcome's.
    struct Banner: Equatable {
        enum Tone: Equatable {
            /// The scoring team's color.
            case team
            /// A late winner or equalizer.
            case gold
            /// Neutral ink: a save, the woodwork, a miss.
            case neutral
        }
        var text: String
        var tone: Tone
        var at: Double
        var until: Double
        /// It brings its own confetti (a goal).
        var confetti: Bool
    }

    var actors: [Actor] = []
    var flights: [Flight] = []
    var impacts: [Impact] = []
    /// The shot's flight: traced brighter than the passes before it.
    var shot: Int?
    /// When it's struck, and when it gets where it was going.
    var strike = 0.0
    var arrive = 0.0
    var banners: [Banner] = []
    /// When the stamp lands.
    var stamp = Double.infinity
    /// The stamp's corner of the view (bottom left; bottom right when the
    /// goal is on the left), as fractions of its width and height: the
    /// camera keeps the play out of it.
    var corner = CGSize.zero
    var cornerRight = false
    /// The ball fades from here (a miss gone into the crowd).
    var ballGone = Double.infinity
    /// The keeper who held on to it, and from when: the ball is in his hands.
    var heldBy: Int?
    var heldFrom = Double.infinity
    /// When the action has stopped: the frame it holds from here is the
    /// one shown until the next moment.
    var settle = 0.0
    var duration = 0.0
    var shots: [Shot] = []
    /// The main camera's track.
    var camera: [CameraFrame] = []
    /// The cut behind the goal for a shot on target.
    var reverse: Reverse?
    /// Each player's motion through the replay (his heading, stride and
    /// footfalls), measured once: by actor.
    var rig: [RigTrack] = []
    /// Between moments: the loop the beats come round in, when anything
    /// moves, and the props in men's hands (cards, a flag, the board).
    var loop: Loop?
    var beats: [ClosedRange<Double>] = []
    var props: [SoccerProp] = []

    /// From just after the strike until the finish has been seen, the
    /// replay cuts to a camera behind the net the shot is going at, held
    /// still, as broadcasts show it; then back to the main camera.
    struct Reverse: Equatable {
        var from: Double
        var until: Double
        /// Behind the goal on the right (the home team's attack).
        var right: Bool
        var frame = CameraFrame(x: Pitch.length / 2, y: Pitch.width / 2, span: 12)
    }

    /// The ball at t: in flight, held where its last flight ended, or gone.
    func ball(at t: Double) -> FieldPoint? {
        guard let first = flights.first, ballGone.isInfinite || t < ballGone + 0.3 else { return nil }
        var held = first.from
        for flight in flights {
            if t < flight.start { return held }
            if t <= flight.end { return flight.point(at: t) }
            held = flight.to
        }
        return held
    }

    func ballOpacity(at t: Double) -> Double {
        ballGone.isFinite ? 1 - min(max((t - ballGone) / 0.3, 0), 1) : 1
    }

    /// The framing at t: the main camera's track (held on its last frame once
    /// the play has settled), or the cut behind the goal.
    func frame(at t: Double) -> PitchFrame {
        if let reverse, t >= reverse.from, t < reverse.until { return PitchFrame(camera: reverse.frame, angle: .behind(right: reverse.right)) }
        return PitchFrame(camera: CameraFollow.frame(camera, at: t) ?? PitchCamera.rest)
    }
}

// MARK: - Building

extension SoccerScript {
    /// The moment's replay, with everyone in both starting elevens when
    /// the lineups are known. (`SoccerScript()` is the pitch with nobody on
    /// it: no moment yet.)
    init(_ scene: SoccerScene, lineups: [GameDetail.Side: SoccerLineup] = [:]) {
        var b = Builder(scene: scene, lineups: lineups)
        b.buildUp()
        b.strike()
        b.payoff()
        b.level()
        b.cut()
        b.squads()
        b.finish()
        b.headline()
        b.measureStamp()
        b.shoot()
        self = b.script
        measureBodies()
    }

    /// Each player's motion, measured once (`RigTrack`, a 2.5 m figure), and
    /// what each faces when he isn't running somewhere: what he's striking,
    /// heading, throwing or taking, and from his moment on whoever he's
    /// celebrating toward or the goal he turned it into; else the ball.
    mutating func measureBodies() {
        let script = self
        rig = actors.map { actor in
            RigTrack(from: 0, through: duration, height: 2.5, position: actor.position(at:)) { t in
                let held: [Actor.Action.Kind] = [.gather, .celebrate, .dejected]
                if let a = actor.actions.last(where: { t > $0.at - 0.45 && (t < $0.at + 0.2 || held.contains($0.kind)) }) {
                    return RigFacing(point: a.toward)
                }
                if let look = actor.looks.last(where: { t >= $0.from }) { return RigFacing(point: look.point) }
                return script.ball(at: t).map { RigFacing(point: $0.ground) }
            }
        }
    }

    // Replay pace: metres a second, and the shortest and longest beats.
    /// A pass along the grass.
    static let passSpeed = 24.0
    /// Through the air: slower, and it hangs.
    static let loftSpeed = 19.0
    /// The man on the ball.
    static let carrySpeed = 8.5
    /// Off-the-ball runs never look faster than a sprint.
    static let runSpeed = 9.0
    /// The shape moves no faster than a jog.
    static let jogSpeed = 6.5
    /// The build-up runs no longer than this, if it can help it: a longer
    /// move plays its early passes faster.
    static let buildUpLimit = 5.0

    /// Assembles a script beat by beat.
    struct Builder {
        let scene: SoccerScene
        var script = SoccerScript()
        /// Actor index by team and name.
        var index: [String: Int] = [:]
        /// Where and when each actor has to be: on the ball, or meeting it.
        /// A mark with an ease is reached by a move that starts exactly at
        /// the mark before (running with the ball, a dive); otherwise he
        /// sets off in time to get there at a run.
        var marks: [Int: [Mark]] = [:]
        /// When the man on the ball has it, and where it's going next, for the camera.
        var possession: [(from: Double, to: Double, actors: [Int], flight: Int)] = []
        var shooter = 0
        var keeper = 0
        /// The shot's end: where it crosses the line, meets the keeper or the block.
        var end = FieldPoint(x: 0, y: 0)
        var payoffAt = 0.0
        let right: Bool
        let goal: CGPoint
        /// Both starting elevens (empty: only the men who touched the ball, and the keeper).
        let lineups: [GameDetail.Side: SoccerLineup]

        init(scene: SoccerScene, lineups: [GameDetail.Side: SoccerLineup] = [:]) {
            self.scene = scene
            self.lineups = lineups
            right = scene.attacksRight
            goal = scene.goal
            // The keeper first: always there, on his line.
            let start = scene.touches.first?.at ?? scene.shot.from
            keeper = actor(.defending, scene.keeper.name ?? "keeper", at: keeperSpot(for: FieldPoint(start), distance: nil), role: .keeper,
                           athlete: scene.keeper.credit?.athlete ?? lineups[scene.side == .top ? .bottom : .top]?.players.first { $0.place == 1 }?.athlete)
        }

        /// The actor for a player, made the first time he's needed: by
        /// ESPN's athlete ID when it credits him, else by name. The keeper
        /// is one man, whatever the feed calls him.
        mutating func actor(_ team: Team, _ name: String, at: CGPoint, role: Actor.Role = .outfield, keeper: Bool = false,
                            athlete: String? = nil) -> Int {
            if keeper, team == .defending, index.values.contains(self.keeper) { return self.keeper }
            let side = team == .attacking ? "A" : "D"
            func known(_ i: Int) -> Int {
                if let athlete {
                    index["\(side)#\(athlete)"] = i
                    if script.actors[i].athlete == nil { script.actors[i].athlete = athlete }
                }
                return i
            }
            if let athlete, let i = index["\(side)#\(athlete)"] { return i }
            let key = "\(side):\(name)"
            if !name.isEmpty, let i = index[key] { return known(i) }
            // The keeper by name: his touches are his.
            if team == .defending, role == .outfield, let keeperName = scene.keeper.name, name == keeperName, let i = index["D:\(keeperName)"] {
                return known(i)
            }
            script.actors.append(Actor(team: team, role: role, name: name, at: at, athlete: athlete))
            index[key] = script.actors.count - 1
            return known(script.actors.count - 1)
        }

        struct Mark {
            var t: Double
            var at: CGPoint
            var ease: PlayScript.Ease? = nil
            /// Where he'd like to be (the keeper tracking the ball), not where he must:
            /// if he can't get there at a run, he gets as far as he can.
            var soft = false
        }

        mutating func mark(_ actor: Int, _ t: Double, _ at: CGPoint, ease: PlayScript.Ease? = nil, soft: Bool = false) {
            marks[actor, default: []].append(Mark(t: t, at: at, ease: ease, soft: soft))
        }

        /// The keeper's spot for the ball where it is: on the line between
        /// it and the middle of his goal, a stride or two off it, further out
        /// when the ball's far away; at a penalty, on the line.
        func keeperSpot(for ball: FieldPoint, distance override: Double?) -> CGPoint {
            let dx = ball.x - goal.x, dy = ball.y - goal.y, d = max(hypot(dx, dy), 0.1)
            let out = override ?? min(1.0 + d * 0.06, 4.2)
            var p = CGPoint(x: goal.x + dx / d * out, y: goal.y + dy / d * out)
            p.y = min(max(p.y, Pitch.posts.near - 0.6), Pitch.posts.far + 0.6)
            p.x = right ? min(p.x, Pitch.length - 0.4) : max(p.x, 0.4)
            return p
        }

        func distance(_ a: CGPoint, _ b: CGPoint) -> Double { hypot(b.x - a.x, b.y - a.y) }

        func passTime(_ d: Double, lofted: Bool) -> Double {
            lofted ? min(max(d / SoccerScript.loftSpeed + 0.25, 0.6), 1.5) : min(max(d / SoccerScript.passSpeed, 0.28), 1.1)
        }


        /// A lofted ball's height over the line: higher the longer it goes.
        func peak(_ d: Double, cross: Bool) -> Double { cross ? min(2.2 + d * 0.09, 7) : min(2.5 + d * 0.11, 11) }

        // MARK: Build-up

        /// The move, touch by touch, at its real pace: the ball goes from
        /// each man to the next (to where a pass was aimed, a punch to where
        /// it landed, then at the receiver's feet to where he next played it),
        /// every player where ESPN says he was when he played it, each touch
        /// when the match clock says, squeezed to the replay's length.
        mutating func buildUp() {
            let touches = shown(scene.touches)
            // A set piece opens on the taker standing over it.
            var t = scene.start == .openPlay || touches.count < scene.touches.count ? 0.5 : 0.8
            if scene.shot.penalty { t = 1.3 }
            let plan = beats(touches)
            let assist = assistIndex(touches)
            for (i, touch) in touches.enumerated() {
                let beat = plan.beats[i], ends = t + beat
                let team: Team = touch.defending ? .defending : .attacking
                let who = actor(team, touch.player, at: touch.at, keeper: touch.keeper, athlete: touch.credit?.athlete)
                let played = t
                mark(who, t, touch.at)
                let next = upcoming(touches, i)
                let way = route(touches, i)
                // Played from the height it came to him at (off a defender's body, a keeper's fists, a head).
                let arrived = script.flights.last.flatMap { distance($0.to.ground, touch.at) < 0.5 ? $0.to.z : nil } ?? height(touches, i, assist: assist)
                let ball = FieldPoint(touch.at, z: arrived)
                let keeping = keeperAction(for: touch)
                let headed = touch.aerial || (i == assist && scene.assistKind == .headedPass)
                // Met where it was going at the height he takes it (his head, a keeper's fists); else along the grass.
                let met = distance(way.aim, next.at) < 1.5 ? (i + 1 < touches.count ? height(touches, i + 1, assist: assist) : strikeHeight)
                    : next.defending ? 0.9 : 0.11
                var acted = false
                if way.flies {
                    let d = distance(touch.at, way.aim)
                    var flightTime = flight(d, lofted: way.lofted, compression: plan.compression, within: beat - way.onward)
                    // Nothing waits in the air: a ball met there (a head, a keeper's fists) arrives as it's met, so the man
                    // delivering it takes his time on the ground first (a corner's run-up, a touch before the cross); one
                    // played on in the air (a flick-on, a punch) to a man who meets it in the air flies the whole beat.
                    var kick = t
                    if met > 1 {
                        if arrived > 1 { flightTime = beat } else { kick = max(t, ends - flightTime) }
                        flightTime = ends - kick
                    }
                    let t = kick
                    // (Over the ball until he plays it.)
                    if kick > played { mark(who, kick, touch.at) }
                    let from = scene.start == .throwIn && touch.kind == .restart ? FieldPoint(touch.at, z: 2.1) : ball
                    script.flights.append(Flight(kind: touch.kind == .shot ? .shot : .pass, start: t, end: t + flightTime, from: from,
                                                 to: FieldPoint(way.aim, z: met),
                                                 arc: way.lofted ? .lofted(peak(d, cross: touch.kind == .cross || touch.kind == .restart)) : .straight))
                    let kind: Actor.Action.Kind? = scene.start == .throwIn && touch.kind == .restart ? .throwIn
                        : keeping?.kind == .punch ? .punch : keeping?.kind == .claim ? .claim
                        : touch.aerial ? .aerial : headed ? .header : touch.defending ? nil : .kick
                    if let kind {
                        script.actors[who].act(kind, at: t, toward: way.aim)
                        acted = true
                    }
                    let arrives = t + flightTime
                    let receiver = actor(next.defending ? .defending : .attacking, next.player, at: way.aim, keeper: next.keeper, athlete: next.athlete)
                    possession.append((t, arrives, [who, receiver], script.flights.count - 1))
                    let runner = way.sameMan && !next.defending ? who : receiver
                    mark(runner, arrives, way.aim)
                    // A through ball: played into the space ahead of him, and he runs onto it.
                    if i == assist, scene.assistKind == .throughBall, !next.defending {
                        let p = CGPoint(x: way.aim.x - touch.at.x, y: way.aim.y - touch.at.y), g = CGPoint(x: goal.x - way.aim.x, y: goal.y - way.aim.y)
                        let lp = max(hypot(p.x, p.y), 0.1), lg = max(hypot(g.x, g.y), 0.1)
                        let u = CGPoint(x: p.x / lp + g.x / lg, y: p.y / lp + g.y / lg), lu = max(hypot(u.x, u.y), 0.1)
                        let back = min(7.5 * flightTime, 9)
                        mark(runner, t, CGPoint(x: way.aim.x - u.x / lu * back, y: way.aim.y - u.y / lu * back), soft: true)
                    }
                    // Then on with it to where he played it next, in what's left of the beat.
                    if !next.defending, met <= 1, distance(way.aim, next.at) > 1.2 {
                        carry(runner, from: way.aim, to: next.at, from: arrives + 0.06, until: ends)
                    }
                } else {
                    carry(who, from: touch.at, to: next.at, from: t + 0.1, until: ends)
                }
                if touch.defending, !acted { script.actors[who].act(.block, at: played, toward: touch.at) }
                t = ends
            }
            if scene.start == .penalty || touches.isEmpty {
                // No move: the taker stands over it (a penalty's run-up comes with the strike).
                script.flights.append(Flight(kind: .carry, start: 0, end: 0.01, from: FieldPoint(scene.shot.from, z: 0.11),
                                             to: FieldPoint(scene.shot.from, z: 0.11)))
            }
            shooter = actor(scene.outcome == .ownGoal ? .defending : .attacking, scene.shooter, at: scene.shot.from, athlete: scene.shooterCredit?.athlete)
            script.strike = max(t, 0.6)
            mark(shooter, script.strike, scene.shot.from)
        }

        /// Who has the ball after touch `i`: the next touch's man, or the shooter.
        func upcoming(_ touches: [SoccerScene.Touch], _ i: Int) -> (player: String, athlete: String?, at: CGPoint, defending: Bool, keeper: Bool) {
            guard i + 1 < touches.count else {
                return (scene.shooter, scene.shooterCredit?.athlete, scene.shot.from, scene.outcome == .ownGoal, false)
            }
            let n = touches[i + 1]
            return (n.player, n.credit?.athlete, n.at, n.defending, n.keeper)
        }

        /// Where touch `i` sends the ball: a pass where it was aimed (to the
        /// next man, when he's the other team's), a punch where it landed, a
        /// touch on to the next man; whether it goes there in the air;
        /// whether the same man plays it next (he runs on with it); and the
        /// least time the man who gets it needs to take it on to his next touch.
        func route(_ touches: [SoccerScene.Touch], _ i: Int) -> (aim: CGPoint, lofted: Bool, flies: Bool, sameMan: Bool, onward: Double) {
            let touch = touches[i], next = upcoming(touches, i)
            let sameMan = next.defending == touch.defending
                && (next.athlete != nil && touch.credit?.athlete != nil ? next.athlete == touch.credit?.athlete : next.player == touch.player)
            let passing = [SoccerScene.Touch.Kind.pass, .cross, .restart, .shot].contains(touch.kind)
            var aim = passing && !next.defending ? touch.to ?? next.at : next.at
            var lofted = passing ? touch.lofted || (touch.kind == .restart && scene.start == .throwIn) : distance(touch.at, next.at) > 30
            if let punch = keeperAction(for: touch), punch.kind == .punch, let to = punch.to {
                aim = to
                lofted = true
            }
            let flies = passing || !sameMan
            let onward = distance(aim, next.at) > 1.2 && !next.defending ? 0.06 + distance(aim, next.at) / SoccerScript.carrySpeed : 0.1
            return (aim, lofted, flies, sameMan, flies ? onward : 0.1 + distance(touch.at, next.at) / SoccerScript.carrySpeed)
        }

        /// How high the ball is when touch `i` meets it: at head height in
        /// the air, a keeper's fists over his head for a punch, his hands for
        /// a claim, off a defender's body; else along the grass.
        func height(_ touches: [SoccerScene.Touch], _ i: Int, assist: Int?) -> Double {
            let touch = touches[i]
            switch keeperAction(for: touch)?.kind {
            case .punch?: return 2.5
            case .claim?: return 2.2
            default: break
            }
            if touch.aerial || (i == assist && scene.assistKind == .headedPass) { return 1.9 }
            return touch.defending ? 0.9 : 0.11
        }

        /// The defending keeper's logged action for one of his touches: same second, same spot.
        func keeperAction(for touch: SoccerScene.Touch) -> SoccerScene.KeeperAction? {
            guard touch.keeper else { return nil }
            return scene.keeperActions.first { abs($0.clock - touch.clock) <= 1 && distance($0.at, touch.at) < 2 }
        }

        /// The assister's touch: the last one by the man credited with the assist.
        func assistIndex(_ touches: [SoccerScene.Touch]) -> Int? {
            touches.lastIndex { t in
                !t.defending && (scene.assistCredit.map { $0.athlete == t.credit?.athlete } ?? (scene.assist != nil && t.player == scene.assist))
            }
        }

        /// No pass, however hurried, is quicker than this: it would read as a jump.
        let minimumFlight = 0.2

        /// A ball through the air takes as long as it hangs; one along the
        /// grass is squeezed with the rest of the move, never past 30 m/s,
        /// and leaves the man who gets it the time he needs.
        func flight(_ d: Double, lofted: Bool, compression c: Double, within room: Double) -> Double {
            if lofted { return passTime(d, lofted: true) }
            let fastest = max(d / 30, minimumFlight)
            return max(min(d / SoccerScript.passSpeed * c, room), fastest)
        }

        /// The least a touch's beat can be: the ball at its fastest to where it went, and the man on to his next touch.
        func least(_ touches: [SoccerScene.Touch], _ i: Int) -> Double {
            let way = route(touches, i)
            guard way.flies else { return way.onward }
            let d = distance(touches[i].at, way.aim)
            return (way.lofted ? passTime(d, lofted: true) : max(d / 30, minimumFlight)) + way.onward
        }

        /// The real gap after each touch on the match clock (whole seconds: a
        /// first-time touch's 0 counts as half of one), to the next or to the shot.
        func gaps(_ touches: [SoccerScene.Touch]) -> [Double] {
            touches.indices.map { i in max((i + 1 < touches.count ? touches[i + 1].clock : scene.clock) - touches[i].clock, 0.5) }
        }

        /// Each touch's beat, from when it's played to when the next one is:
        /// its real gap, all of them squeezed by one factor (`compression`)
        /// so the move fits the replay's five seconds, a quick one-two staying
        /// quick and a patient spell slower; never quicker than the ball and
        /// the man on it can go. A move that fits plays in real time.
        func beats(_ touches: [SoccerScene.Touch]) -> (beats: [Double], compression: Double) {
            let real = gaps(touches), floors = touches.indices.map { least(touches, $0) }
            func total(_ c: Double) -> Double { zip(real, floors).reduce(0) { $0 + max($1.1, $1.0 * c) } }
            var c = 1.0
            if total(1) > SoccerScript.buildUpLimit {
                var lo = 0.0, hi = 1.0
                for _ in 0..<24 {
                    let mid = (lo + hi) / 2
                    if total(mid) > SoccerScript.buildUpLimit { hi = mid } else { lo = mid }
                }
                c = lo
            }
            return (zip(real, floors).map { max($0.1, $0.0 * c) }, c)
        }

        /// The move as the replay shows it: a long one picks up a few touches
        /// in, as a broadcast replay does, rather than race through them all
        /// (squeezed more than about twice); it keeps its last three touches at least.
        func shown(_ touches: [SoccerScene.Touch]) -> [SoccerScene.Touch] {
            var shown = Self.headers(touches)
            func fits() -> Bool {
                shown.indices.reduce(0) { $0 + least(shown, $1) } <= SoccerScript.buildUpLimit + 0.01
                    && gaps(shown).reduce(0, +) <= SoccerScript.buildUpLimit * 2.2
            }
            while shown.filter({ !$0.defending }).count > 3, !fits() {
                shown.removeFirst()
                // A move never opens on the other team's touch.
                while shown.first?.defending == true { shown.removeFirst() }
            }
            return shown
        }

        /// A header won in the air and the pass it was, logged as two touches
        /// a second apart ("aerial", then "pass"), as one: the header.
        static func headers(_ touches: [SoccerScene.Touch]) -> [SoccerScene.Touch] {
            var out: [SoccerScene.Touch] = []
            for touch in touches {
                if let last = out.last, last.aerial, !last.defending, !touch.defending, touch.clock - last.clock <= 1,
                   last.credit?.athlete != nil ? last.credit?.athlete == touch.credit?.athlete : last.player == touch.player,
                   hypot(touch.at.x - last.at.x, touch.at.y - last.at.y) < 1.5 {
                    var header = touch
                    header.aerial = true
                    header.at = last.at
                    header.clock = last.clock
                    out[out.count - 1] = header
                    continue
                }
                out.append(touch)
            }
            return out
        }

        /// He runs with it, the ball at his feet, from `start` to `end`.
        mutating func carry(_ who: Int, from: CGPoint, to: CGPoint, from start: Double, until end: Double) {
            let time = max(end - start, 0.14)
            mark(who, start, from)
            mark(who, start + time, to, ease: .linear)
            script.flights.append(Flight(kind: .carry, start: start, end: start + time, from: FieldPoint(from, z: 0.11), to: FieldPoint(to, z: 0.11)))
            possession.append((start, start + time, [who], script.flights.count - 1))
        }

        // MARK: Shot

        /// Where the ball is when it's struck: at his head for a header, in the air for a volley.
        var strikeHeight: Double {
            switch scene.shot.technique {
            case .header: 1.95
            case .volley: 0.6
            case .foot: 0.11
            }
        }

        /// The strike: from its spot to the exact point in the goal mouth
        /// (or the hands, or the block). A header leaves from head height.
        mutating func strike() {
            let s = scene.shot
            let t0 = script.strike
            let from = FieldPoint(s.from, z: strikeHeight)
            let mouthY = s.mouth?.y ?? Pitch.width / 2, mouthZ = s.mouth?.z ?? 0.5
            var target = FieldPoint(x: goal.x, y: mouthY, z: mouthZ)
            if scene.outcome == .woodwork {
                // The post it hit, or the bar.
                if scene.crossbar {
                    target.z = Pitch.goalHeight
                } else {
                    target.y = abs(mouthY - Pitch.posts.near) < abs(mouthY - Pitch.posts.far) ? Pitch.posts.near : Pitch.posts.far
                    target.z = min(max(mouthZ, 0.2), Pitch.goalHeight)
                }
            }
            switch scene.outcome {
            case .saved:
                if let stop = s.stopped, s.mouth != nil {
                    // On the shot's line, where the keeper got to it.
                    let u = min(max((stop.x - from.x) / (target.x - from.x), 0.55), 0.98)
                    end = FieldPoint(x: from.x + (target.x - from.x) * u, y: from.y + (target.y - from.y) * u,
                                     z: max(from.z + (target.z - from.z) * u, 0.25))
                } else {
                    end = s.stopped.map { FieldPoint($0, z: min(mouthZ, 1.2)) } ?? target
                }
            case .blocked:
                end = FieldPoint(s.stopped ?? CGPoint(x: from.x + (target.x - from.x) * 0.4, y: from.y + (target.y - from.y) * 0.4), z: 0.8)
            default:
                end = target
            }
            let d = hypot(end.x - from.x, end.y - from.y)
            let speed: Double = s.penalty ? 25 : s.technique == .header ? 14 : s.technique == .volley ? 25 : 27
            let time = min(max(d / speed, 0.3), 1.25)
            script.arrive = t0 + time
            // A long shot carries a little height in the middle; a header loops down.
            let arc: Flight.Arc = s.technique == .header ? .lofted(min(0.3 + d * 0.03, 0.8)) : d > 18 ? .lofted(min((d - 18) * 0.04, 0.9)) : .straight
            script.shot = script.flights.count
            script.flights.append(Flight(kind: .shot, start: t0, end: script.arrive, from: from, to: end, arc: arc))

            // The shooter strikes it (a header, he's up for it); a penalty taker runs up from the edge of the D.
            if s.penalty {
                script.actors[shooter].at = CGPoint(x: s.from.x - (right ? 1 : -1) * 3.2, y: s.from.y - 1.8)
            }
            // (An own goal's defender only gets something on it.)
            // With the foot (or the head) Opta logs: a left-footer's strike is the right-footer's mirrored.
            let struck: Actor.Action.Kind = scene.outcome == .ownGoal ? .block : s.technique == .header ? .header : .kick
            script.actors[shooter].act(struck, at: t0, toward: CGPoint(x: target.x, y: target.y), left: s.contact == .leftFoot)

            // The keeper: set as it's struck, then at full stretch, standing, or beaten (unless it's his own touch that turned it in).
            guard shooter != keeper else { return }
            let set = keeperSpot(for: FieldPoint(s.from), distance: s.penalty ? 0.2 : nil)
            // A keeper who came out for it in the move (a sweep, a header won) gets back as fast as he can run,
            // and has no dive to make.
            let stranded: Bool
            if let out = marks[keeper]?.filter({ $0.t < t0 }).max(by: { $0.t < $1.t }),
               distance(out.at, set) > SoccerScript.runSpeed * (t0 - out.t) + 1.5 {
                stranded = true
                let back = min(SoccerScript.runSpeed * (script.arrive + 0.6 - out.t) / distance(out.at, set), 1)
                mark(keeper, script.arrive + 0.6, CGPoint(x: out.at.x + (set.x - out.at.x) * back, y: out.at.y + (set.y - out.at.y) * back), soft: true)
            } else {
                stranded = false
                mark(keeper, t0, set)
            }
            // He reads it, then goes: a dive takes about half a second, whatever the shot's flight.
            let react = max(s.penalty ? t0 + 0.02 : t0 + 0.1, script.arrive - 0.55)
            let reachAt = script.arrive
            let side = (right ? 1.0 : -1.0)
            switch scene.outcome {
            case _ where stranded:
                if scene.outcome == .saved { script.impacts.append(Impact(kind: .save, at: reachAt, point: end)) }
                if scene.outcome == .blocked { script.impacts.append(Impact(kind: .block, at: reachAt, point: end)) }
            case .saved:
                let lateral = abs(end.y - set.y)
                // What he did with it, as the feed logs it after the shot: punched it away, claimed it high, or held it.
                let after = scene.keeperActions.first { $0.clock >= scene.clock && $0.kind != .save && $0.kind != .sweep }
                if lateral < 1.0, end.z < 1.9 || after?.kind == .punch || after?.kind == .claim {
                    // Straight at him: he takes it in, or punches it clear.
                    mark(keeper, reachAt, CGPoint(x: end.x - side * 0.35, y: end.y))
                    let kind: Actor.Action.Kind = after?.kind == .punch ? .punch : after?.kind == .claim || end.z > 1.5 ? .claim : .gather
                    script.actors[keeper].act(kind, at: reachAt, toward: s.from)
                } else {
                    dive(to: end, from: set, start: react, reach: reachAt)
                }
                script.impacts.append(Impact(kind: .save, at: reachAt, point: end))
            case .goal, .ownGoal, .woodwork, .wide:
                // He goes for it and doesn't get there: a shot in off the post beats him by inches, one into the
                // stands he only watches.
                let lateral = abs(target.y - set.y)
                if scene.outcome == .wide && lateral > 3.2 {
                    mark(keeper, reachAt, CGPoint(x: set.x, y: set.y + (target.y - set.y) * 0.15))
                } else if lateral < 0.8, target.z < 1.6 {
                    // Through him (or under him).
                    let past = FieldPoint(x: target.x - side * 0.5, y: target.y + (target.y >= set.y ? 0.45 : -0.45), z: max(target.z, 0.3))
                    dive(to: past, from: set, start: react + 0.04, reach: reachAt + 0.04)
                } else {
                    let short = 0.62 + (scene.outcome == .woodwork ? 0.2 : 0)
                    let hands = FieldPoint(x: set.x + (target.x - set.x) * 0.5, y: set.y + (target.y - set.y) * short,
                                           z: max(target.z * 0.85, 0.35))
                    dive(to: hands, from: set, start: react, reach: reachAt + 0.05)
                }
            case .blocked:
                mark(keeper, reachAt, keeperSpot(for: end, distance: nil))
                script.impacts.append(Impact(kind: .block, at: reachAt, point: end))
            }
        }

        /// His hands go to `target` (the renderer puts them exactly there),
        /// his body a stride short of it; he lands on the grass under it.
        mutating func dive(to target: FieldPoint, from set: CGPoint, start: Double, reach: Double) {
            let dy = target.y - set.y
            let landing = CGPoint(x: (set.x + target.x) / 2, y: target.y - (dy >= 0 ? 1 : -1) * min(abs(dy) * 0.35, 1.1))
            script.actors[keeper].dive = Actor.Dive(start: start, reach: max(reach, start + 0.12), target: target, landing: landing)
            mark(keeper, start, set)
            mark(keeper, reach + 0.32, landing, ease: .out)
        }

        // MARK: Payoff

        /// What it ends in: the net rippling and the scorer wheeling away;
        /// the keeper up with it, or palming it away; the post ringing; a
        /// block; a miss into the crowd.
        mutating func payoff() {
            let t = script.arrive
            let side = right ? 1.0 : -1.0
            payoffAt = t
            switch scene.outcome {
            case .goal, .ownGoal:
                // Over the line, into the roof or the side netting, and down.
                let net = FieldPoint(x: goal.x + side * 1.5, y: end.y + (end.y - scene.shot.from.y) * 0.08, z: max(end.z * 0.7, 0.35))
                script.flights.append(Flight(kind: .loose, start: t, end: t + 0.14, from: end, to: net))
                script.flights.append(Flight(kind: .loose, start: t + 0.14, end: t + 0.6, from: net,
                                             to: FieldPoint(x: goal.x + side * 1.25, y: net.y, z: 0.11), ease: .out))
                script.impacts.append(Impact(kind: .net, at: t + 0.1, point: net))
                celebrate()
            case .saved:
                if let rebound = scene.rebound {
                    // Palmed away: toward whoever got to it, or behind for a corner.
                    let d = distance(CGPoint(x: end.x, y: end.y), rebound)
                    script.flights.append(Flight(kind: .loose, start: t, end: t + min(max(d / 16, 0.35), 0.9), from: end, to: FieldPoint(rebound, z: 0.11),
                                                 arc: .lofted(min(0.6 + d * 0.06, 2.5)), ease: .out))
                    if rebound.x > Pitch.length || rebound.x < 0 { script.ballGone = t + 0.9 }
                } else {
                    // Held: the ball comes down with him, in his hands (the renderer keeps it there).
                    let landing = script.actors[keeper].dive?.landing ?? script.actors[keeper].position(at: t + 0.3)
                    script.flights.append(Flight(kind: .loose, start: t, end: t + 0.37, from: end,
                                                 to: FieldPoint(x: landing.x - side * 0.3, y: landing.y, z: 0.3), ease: .out))
                    script.heldBy = keeper
                    script.heldFrom = t
                }
                regret()
            case .woodwork:
                script.impacts.append(Impact(kind: .woodwork, at: t, point: end))
                let away = scene.rebound ?? CGPoint(x: end.x + side * 3, y: end.y + (end.y < Pitch.width / 2 ? -5 : 5))
                let d = distance(CGPoint(x: end.x, y: end.y), away)
                script.flights.append(Flight(kind: .loose, start: t, end: t + min(max(d / 15, 0.4), 1.0), from: end, to: FieldPoint(away, z: 0.11),
                                             arc: .lofted(min(0.5 + d * 0.05, 2)), ease: .out))
                if away.x > Pitch.length + 0.5 || away.x < -0.5 { script.ballGone = t + 0.85 }
                regret()
            case .blocked:
                let blocker = actor(.defending, scene.blocker?.name ?? "blocker", at: CGPoint(x: end.x, y: end.y))
                script.actors[blocker].at = CGPoint(x: end.x + side * 0.35, y: end.y)
                mark(blocker, t, CGPoint(x: end.x + side * 0.35, y: end.y))
                script.actors[blocker].act(.block, at: t, toward: scene.shot.from)
                let away = scene.rebound ?? CGPoint(x: end.x - side * 6, y: end.y + (end.y < Pitch.width / 2 ? -3 : 3))
                let d = distance(CGPoint(x: end.x, y: end.y), away)
                script.flights.append(Flight(kind: .loose, start: t, end: t + min(max(d / 14, 0.35), 1.0), from: end, to: FieldPoint(away, z: 0.11),
                                             arc: .lofted(min(0.4 + d * 0.04, 1.5)), ease: .out))
                regret()
            case .wide:
                // Past the post and into the crowd.
                let beyond = FieldPoint(x: goal.x + side * 6, y: end.y + (end.y - scene.shot.from.y) * 6 / max(abs(goal.x - scene.shot.from.x), 1),
                                        z: end.z + 0.8)
                script.flights.append(Flight(kind: .loose, start: t, end: t + 0.25, from: end, to: beyond))
                script.ballGone = t + 0.2
                regret()
            }
        }

        /// The scorer wheels away toward the near touchline by the corner of
        /// the box (out from the goalmouth, where the camera can hold him and
        /// the goal together), arms going up; the man who made it runs to
        /// him; the rest of the move follows.
        mutating func celebrate() {
            let t = script.arrive
            guard scene.outcome == .goal else {
                // An own goal: the defender who turned it in, head in hands.
                script.actors[shooter].act(.dejected, at: t + 0.4, toward: goal)
                return
            }
            let from = scene.shot.from
            if scene.review == .overturned {
                // Struck off by VAR: he wheels away, and it's taken back.
                mark(shooter, t + 0.2, from)
                mark(shooter, t + 1.4, CGPoint(x: from.x - (right ? 1 : -1) * 5, y: max(from.y - 4, 2.5)), ease: .out)
                script.actors[shooter].act(.dejected, at: t + 1.35, toward: goal)
                payoffAt = t + 1.6
                return
            }
            let flag = CGPoint(x: goal.x - (right ? 1 : -1) * 12, y: 0)
            let dx = flag.x - from.x, dy = flag.y - from.y, d = max(hypot(dx, dy), 1)
            let run = min(17.0, d - 3)
            let spot = CGPoint(x: min(max(from.x + dx / d * run, 1.5), Pitch.length - 1.5), y: max(from.y + dy / d * run, 2.5))
            mark(shooter, t + 0.2, from)
            mark(shooter, t + 2.2, spot, ease: .out)
            script.actors[shooter].act(.celebrate, at: t + 1.85, toward: CGPoint(x: Pitch.length / 2, y: 0))
            // The assist first to him, then whoever else is near.
            let teammates = script.actors.indices.filter { $0 != shooter && script.actors[$0].team == .attacking }
            func away(_ i: Int) -> Double { distance(lastMark(i) ?? script.actors[i].at, spot) }
            let near = teammates.filter { away($0) < 20 }.sorted { a, b in
                (script.actors[a].name == scene.assist ? 0 : 1, away(a)) < (script.actors[b].name == scene.assist ? 0 : 1, away(b))
            }
            for (n, i) in near.prefix(3).enumerated() {
                // Either side of him and a little behind, across the camera's view so they don't hide him.
                let across = (n % 2 == 0 ? -1.0 : 1.0) * (1.9 + Double(n / 2) * 1.6)
                let p = CGPoint(x: spot.x + across, y: spot.y + 1.1 + Double(n) * 0.5)
                mark(i, t + 0.45 + Double(n) * 0.12, lastMark(i) ?? script.actors[i].at)
                mark(i, t + 2.1 + Double(n) * 0.15, p, ease: .inOut)
            }
            payoffAt = t + 2.2
        }

        /// So close: the shooter's hands go to his head.
        mutating func regret() {
            guard scene.outcome != .goal else { return }
            let big = (scene.shot.xg ?? 0) >= PitchAction.bigChanceXG || scene.outcome == .woodwork
            if big { script.actors[shooter].act(.dejected, at: script.arrive + 0.45, toward: goal) }
            payoffAt = script.arrive + 0.9
        }

        func lastMark(_ i: Int) -> CGPoint? { marks[i]?.max { $0.t < $1.t }?.at }

        /// A shot on target (in, or saved) gets the angle from behind the net:
        /// cut to it a beat after the strike, held until the finish has been
        /// seen (the net bulging, the keeper down with it), then back.
        mutating func cut() {
            guard scene.outcome == .goal || scene.outcome == .saved else { return }
            let from = script.strike + 0.1
            let until = script.arrive + (scene.scored ? 0.95 : 0.8)
            guard until - from > 0.6 else { return }
            script.reverse = SoccerScript.Reverse(from: from, until: until, right: right)
        }

        /// The ball never jumps: each flight leaves from where, and as high
        /// as, the one before came down (a header's flick-on from his head, a
        /// punch from the keeper's fists); a shot struck at head height or on
        /// the volley is met there by the ball that came to it.
        mutating func level() {
            for k in script.flights.indices.dropFirst() {
                let a = script.flights[k - 1], b = script.flights[k]
                guard b.start <= a.end + 0.2, distance(b.from.ground, a.to.ground) < 1.5, abs(b.from.z - a.to.z) > 0.001 else { continue }
                if b.kind == .shot { script.flights[k - 1].to.z = b.from.z } else { script.flights[k].from.z = a.to.z }
            }
        }

        // MARK: Shape

        /// Everyone in both starting elevens who didn't touch the ball, in
        /// his team's shape (the lineup's formation) as the ball moves: the
        /// attack pushed up behind the ball and drawn across to it, the
        /// defense between the ball and its goal, tighter the nearer it
        /// comes; at a corner or a free kick both packed into the box until
        /// the delivery's in; on a counter the defense caught upfield,
        /// getting back. A substitute who touched it stands in for a man who
        /// came off. A man in the move comes into his first touch from his
        /// place in the shape. Two lines and a front, at a jog.
        mutating func squads() {
            let other: GameDetail.Side = scene.side == .top ? .bottom : .top
            guard let attack = lineups[scene.side], let defence = lineups[other], attack.players.count >= 10, defence.players.count >= 10 else { return }
            let times = Array(stride(from: 0.0, to: script.strike, by: 0.6)) + [script.strike, script.arrive + 0.8]
            let balls = times.map { script.ball(at: min($0, script.strike))?.ground ?? scene.shot.from }
            for (team, lineup, facing) in [(Team.attacking, attack, right), (.defending, defence, !right)] {
                var players = lineup.players
                let figures = script.actors.indices.filter { script.actors[$0].team == team }
                let athletes = Set(figures.compactMap { script.actors[$0].athlete })
                // A substitute in the move takes the place of a man who went off (else of the nearest who didn't touch it).
                for i in figures where script.actors[i].athlete.map({ a in !players.contains { $0.athlete == a } }) ?? false {
                    guard script.actors[i].role != .keeper || team == .attacking else { continue }
                    let first = marks[i]?.min { $0.t < $1.t }?.at ?? script.actors[i].at
                    func gap(_ k: Int) -> Double { distance(home(players[k], facing: facing), first) }
                    let open = players.indices.filter { !athletes.contains(players[$0].athlete) && players[$0].place != 1 }
                    if let k = open.filter({ players[$0].subbedOut }).min(by: { gap($0) < gap($1) }) ?? open.min(by: { gap($0) < gap($1) }) {
                        players.remove(at: k)
                    }
                }
                let lines = players.map(\.line).max() ?? 4
                for p in players {
                    // The defending keeper is the keeper already on his line.
                    if team == .defending, p.place == 1 { continue }
                    let places = times.indices.map { k in shape(p, team: team, facing: facing, lines: lines, ball: balls[k], at: times[k]) }
                    if let i = figures.first(where: { script.actors[$0].athlete == p.athlete }) {
                        // In the move: from his place in the shape into his first touch, if he can get there.
                        if let first = marks[i]?.min(by: { $0.t < $1.t }), first.t > 0.3,
                           distance(places[0], first.at) <= SoccerScript.runSpeed * 0.8 * first.t {
                            mark(i, 0, places[0], soft: true)
                        }
                        continue
                    }
                    let i = actor(team, p.name ?? p.athlete, at: places[0], role: p.place == 1 ? .keeper : .outfield, athlete: p.athlete)
                    script.actors[i].shaped = true
                    for (k, t) in times.enumerated() { mark(i, t, places[k], soft: true) }
                }
            }
        }

        /// A man's nominal spot, in metres on the pitch.
        func home(_ p: SoccerLineup.Player, facing right: Bool) -> CGPoint {
            let n = Pitch.metres(x: p.spot.x, y: p.spot.y)
            return right ? n : CGPoint(x: Pitch.length - n.x, y: Pitch.width - n.y)
        }

        /// Where a man stands in his team's shape with the ball at `ball`, at
        /// t: worked in his team's own frame (attacking toward x = 105), then
        /// turned onto the pitch.
        func shape(_ p: SoccerLineup.Player, team: Team, facing right: Bool, lines: Int, ball: CGPoint, at t: Double) -> CGPoint {
            func turned(_ q: CGPoint) -> CGPoint { right ? q : CGPoint(x: Pitch.length - q.x, y: Pitch.width - q.y) }
            let n = Pitch.metres(x: p.spot.x, y: p.spot.y), b = turned(ball)
            // The defense's back line, in its own frame: deeper and tighter the nearer the ball (at x from its goal).
            func backLine(_ bx: Double) -> Double { min(max(bx * 0.45 + 2, 6), 34) }
            var q: CGPoint
            if team == .attacking {
                if p.place == 1 {
                    q = CGPoint(x: n.x + max(b.x - 52.5, 0) * 0.3, y: 34 + (b.y - 34) * 0.15)
                } else {
                    q = CGPoint(x: n.x + (b.x - 52.5) * 0.6, y: 34 + (n.y - 34) * 0.9 + (b.y - 34) * 0.3)
                    // Onside: no further than the defense's back line, or the ball.
                    q.x = min(q.x, max(Pitch.length - backLine(Pitch.length - b.x) + 0.5, b.x))
                }
            } else {
                let k = min(max(b.x / 55, 0.35), 1)
                var back = backLine(b.x)
                // On the counter: caught upfield at first, getting back as the move goes.
                if scene.shot.situation == .fastBreak { back += (max(back, 40) - back) * (1 - Rig.smooth(t / max(script.strike, 0.1))) }
                q = CGPoint(x: back + (n.x - 21) * k, y: 34 + (n.y - 34) * (0.7 + 0.25 * k) + (b.y - 34) * 0.35)
            }
            // A corner or a free kick into the box: packed in until the delivery's in, then back out to the shape.
            let restart = scene.start == .corner || scene.start == .freeKick
            let secondPhase = scene.start == .openPlay && scene.shot.situation.map { [.corner, .setPiece, .freeKick].contains($0) } == true
            if restart || secondPhase {
                let until = restart ? script.flights.first.map { $0.end } ?? 0 : 0
                let w = 1 - Rig.smooth((t - until) / 1.8)
                if w > 0 {
                    let across = Double(p.place % 5) / 4
                    let packed: CGPoint
                    if team == .attacking {
                        let central = SoccerLineup.lateral(p.position) != 2 && SoccerLineup.lateral(p.position) != -2
                        packed = p.place == 1 ? q : (p.line == 1 && central) || p.line >= 3
                            ? CGPoint(x: 93 + Double(p.place % 3) * 2.5, y: 27 + 14 * across) : CGPoint(x: 60 + Double(p.line) * 5, y: n.y)
                    } else {
                        packed = p.line == lines ? CGPoint(x: 26, y: 34 + (n.y - 34) * 0.4)
                            : CGPoint(x: 3.5 + Double(p.line - 1) * 3, y: 34 + (n.y - 34) * 0.42)
                    }
                    q = CGPoint(x: q.x + (packed.x - q.x) * w, y: q.y + (packed.y - q.y) * w)
                }
            }
            q.x = min(max(q.x, 1), Pitch.length - 1)
            q.y = min(max(q.y, 1.5), Pitch.width - 1.5)
            return turned(q)
        }

        // MARK: Paths and end

        /// Turns the marks into runs: each man gets to every mark on time,
        /// coming into the first from a few strides off it, and drifts on a
        /// little after his last; the keeper shuffles across his line with
        /// the ball. Then the stamp lands and the replay settles.
        mutating func finish() {
            // The keeper tracks the ball through the move.
            // (Not while he's playing it himself.)
            let own = marks[keeper]?.map(\.t) ?? []
            for flight in script.flights where flight.end < script.strike && flight.kind != .shot && !own.contains(where: { abs($0 - flight.end) < 0.6 }) {
                mark(keeper, flight.end, keeperSpot(for: flight.to, distance: nil), soft: true)
            }
            let side = right ? 1.0 : -1.0
            for i in script.actors.indices {
                guard var list = marks[i]?.sorted(by: { $0.t < $1.t }), let first = list.first else { continue }
                // A mark repeated (he's still there) is one mark, reached as exactly as either asks.
                list = list.reduce(into: []) { out, m in
                    if let last = out.last, abs(last.t - m.t) < 0.02 {
                        // A mark he must reach beats one he'd like to.
                        let keep = m.soft && !last.soft ? last : m
                        out[out.count - 1] = Mark(t: keep.t, at: keep.at, ease: m.ease ?? last.ease, soft: m.soft && last.soft)
                    } else {
                        out.append(m)
                    }
                }
                var actor = script.actors[i]
                if actor.role == Actor.Role.keeper || actor.shaped || first.t == 0 {
                    actor.at = first.at
                } else if !(scene.shot.penalty && i == shooter) {
                    // Into his first touch from a couple of strides off it, so he's moving when it comes.
                    let lead = min(first.t * 2.5, 3.0)
                    actor.at = CGPoint(x: first.at.x - side * lead * 0.7, y: first.at.y - lead * 0.7)
                }
                var previous = Mark(t: 0, at: actor.at)
                // The shape jogs; the men in the move run.
                let pace = actor.shaped ? SoccerScript.jogSpeed : SoccerScript.runSpeed
                for var m in list {
                    // Back to his line after coming out, the keeper arrives when he can; the shape gets as far as a jog takes it.
                    if m.soft, m.t > previous.t {
                        let d = distance(previous.at, m.at), reach = pace * (m.t - previous.t)
                        if d > reach { m.at = CGPoint(x: previous.at.x + (m.at.x - previous.at.x) * reach / d, y: previous.at.y + (m.at.y - previous.at.y) * reach / d) }
                    }
                    let d = distance(previous.at, m.at)
                    if let ease = m.ease {
                        // On the ball (or a dive): exactly from the mark before.
                        if d > 0.02 { actor.move(to: [m.at], from: previous.t, to: m.t, ease: ease) }
                    } else if d > 0.05, actor.shaped {
                        // The shape drifts steadily from one place to the next.
                        actor.move(to: [m.at], from: previous.t, to: m.t, ease: .linear)
                    } else if d > 0.05 {
                        // Off it: sets off in time to get there at a run, never before the mark before.
                        let need = d / pace
                        let leave = max(previous.t + 0.05, m.t - max(need * 1.5, 0.3))
                        actor.move(to: [m.at], from: min(leave, m.t - 0.05), to: m.t, ease: m.t - leave > 0.6 ? .inOut : .linear)
                    }
                    previous = m
                }
                script.actors[i] = actor
            }
            // A man who passed it on keeps going a few strides, toward goal.
            for i in script.actors.indices where script.actors[i].team == .attacking && i != shooter {
                guard let last = marks[i]?.max(by: { $0.t < $1.t }), last.t < script.strike else { continue }
                let toward = CGPoint(x: goal.x - last.at.x, y: goal.y - last.at.y), d = max(hypot(toward.x, toward.y), 1)
                let step = min(4.0, d * 0.25)
                script.actors[i].move(to: [CGPoint(x: last.at.x + toward.x / d * step, y: last.at.y + toward.y / d * step)],
                                      from: last.t + 0.05, to: last.t + 1.0, ease: .out)
            }
            script.shot = script.flights.firstIndex { $0.kind == .shot && $0.start == script.strike }
            let lastMove = script.actors.flatMap { actor in actor.moves.map { $0.end } }.max() ?? 0
            let lastFlight = script.flights.map { $0.end }.max() ?? 0
            script.stamp = script.arrive + (scene.scored ? 0.35 : 0.25)
            // After the angle from behind the goal: the stamp lands back on the main camera.
            if let reverse = script.reverse { script.stamp = max(script.stamp, reverse.until + 0.12) }
            script.settle = max(lastMove, lastFlight, payoffAt + 0.6, script.stamp + 0.6) + 0.5
            script.duration = script.settle + 0.3
        }

        /// The headline for a marquee moment, landing with its payoff: GOAL
        /// (gold for a late winner or equalizer), OWN GOAL, SAVE, OFF THE
        /// POST or OFF THE BAR; a penalty announces itself as it's set. A
        /// block or a miss keeps to the stamp.
        mutating func headline() {
            let t = script.arrive
            let until = script.settle - 1.3
            func banner(_ text: String, _ tone: Banner.Tone, at: Double, until end: Double = until, confetti: Bool = false) {
                script.banners.append(Banner(text: text, tone: tone, at: at, until: max(end, at + 1.6), confetti: confetti))
            }
            if scene.shot.penalty { banner("PENALTY", .team, at: 0.25, until: script.strike - 0.15) }
            switch scene.outcome {
            case _ where scene.review == .overturned: banner("NO GOAL", .neutral, at: t + 1.1)
            case .goal: banner("GOAL", scene.decisive ? .gold : .team, at: t + 0.08, confetti: true)
            case .ownGoal: banner("OWN GOAL", scene.decisive ? .gold : .team, at: t + 0.08, confetti: true)
            case .saved: banner("SAVE", .neutral, at: t + 0.05)
            case .woodwork: banner(scene.crossbar ? "OFF THE BAR" : "OFF THE POST", .neutral, at: t + 0.05)
            case .wide where scene.shot.penalty: banner("MISSED", .neutral, at: t + 0.1)
            default: break
            }
            // Only one up at a time: an earlier one leaves as the next lands.
            for i in script.banners.indices.dropLast() where script.banners[i].until > script.banners[i + 1].at - 0.3 {
                script.banners[i].until = script.banners[i + 1].at - 0.3
            }
            // The camera gives the headline's room back as it leaves, and has come to rest well before the replay ends.
            if let last = script.banners.last {
                script.settle = max(script.settle, last.until + 1.3)
                script.duration = script.settle + 0.3
            }
        }

        /// The stamp's corner, measured from its type: the name at about a
        /// seventh of the view's height, the detail under it at about an
        /// eighteenth, in a view twice as wide as tall. It goes on the side
        /// away from the goal, where the scorer won't run.
        mutating func measureStamp() {
            let name = SoccerScene.surname(scene.shooter)
            let line = Double(name.count) * 0.6 * 0.105 + Double(scene.minute.count) * 0.4 * 0.105
            let detail = Double(SoccerFrame.detail(scene).count) * 0.68 * 0.05
            let width = 0.05 + max(line, detail) * 0.5
            script.corner = CGSize(width: min(width + 0.03, 0.62), height: 0.27)
            script.cornerRight = !right
        }
    }
}

// MARK: - Camera

/// The broadcast camera: high in the main stand on the near side, panning
/// and zooming to keep the play in frame, and travelling a little along its
/// gantry toward the end the ball's at, so a goal is seen from in front of
/// the corner flag, its mouth and net open to the lens, never edge-on.
/// A framing (`CameraFrame`) is the ground point at the middle of the view,
/// in metres, and the metres from the bottom of the view to the top at that
/// point's distance.
enum PitchCamera {
    /// Behind the near touchline, and up.
    static let back = 24.0
    static let height = 23.0
    /// How far along the gantry it follows the play (0: fixed on halfway).
    static let travel = 0.3
    /// The tightest framing (metres top to bottom) and the widest (the whole pitch).
    static let tightest = 8.0
    static let widest = 80.0
    /// The camera behind a goal: back from the goal line, and up (over the bar).
    static let behindBack = 13.0
    static let behindHeight = 6.5

    /// Which camera: the main one, high in the stand on the near side; or
    /// the one behind a goal, low over the net, looking out at the shot.
    enum Angle: Equatable {
        case stand
        case behind(right: Bool)
    }

    /// The camera's axes, looking at a framing's ground point.
    struct Basis {
        let eye: SIMD3<Double>
        let right: SIMD3<Double>
        let up: SIMD3<Double>
        let forward: SIMD3<Double>
        /// To the ground point.
        let distance: Double

        /// A point in the view's tangent plane: across and up, as fractions of its distance.
        func tangent(_ p: FieldPoint) -> (u: Double, v: Double) {
            let d = SIMD3(p.x, p.y, p.z) - eye
            let z = max((d * forward).sum(), 0.5)
            return ((d * right).sum() / z, (d * up).sum() / z)
        }
    }

    static func eye(_ frame: CameraFrame, _ angle: Angle = .stand) -> SIMD3<Double> {
        switch angle {
        case .stand:
            return SIMD3(Pitch.length / 2 + (frame.x - Pitch.length / 2) * travel, -back, height)
        case let .behind(right):
            // In the stand behind the goal, a little toward the side the play is on.
            return SIMD3(right ? Pitch.length + behindBack : -behindBack, Pitch.width / 2 + (frame.y - Pitch.width / 2) * 0.35, behindHeight)
        }
    }

    static func basis(_ frame: CameraFrame, _ angle: Angle = .stand) -> Basis {
        let eye = eye(frame, angle)
        let target = SIMD3(frame.x, frame.y, 0)
        let look = target - eye
        let distance = (look * look).sum().squareRoot()
        let forward = look / distance
        let side = SIMD3(forward.y, -forward.x, 0)
        let right = side / max((side * side).sum().squareRoot(), 1e-9)
        let up = SIMD3(right.y * forward.z - right.z * forward.y, right.z * forward.x - right.x * forward.z,
                       right.x * forward.y - right.y * forward.x)
        return Basis(eye: eye, right: right, up: up, forward: forward, distance: distance)
    }

    /// Between moments: the whole pitch from the halfway line.
    static let rest: CameraFrame = {
        let corners = [CGPoint(x: -1, y: -1), CGPoint(x: Pitch.length + 1, y: -1), CGPoint(x: -1, y: Pitch.width + 1),
                       CGPoint(x: Pitch.length + 1, y: Pitch.width + 1)]
        return fitting(corners.map { Room(FieldPoint($0), figure: false) }, headroom: CameraFrame.headroom, closest: tightest)
    }()

    /// Something that must stay in frame: a figure (with room for his height
    /// above his feet) or a ball or a goal's corner.
    struct Room {
        var point: FieldPoint
        var figure: Bool

        init(_ point: FieldPoint, figure: Bool) {
            self.point = point
            self.figure = figure
        }
    }

    /// The framing that fits `items` in a view twice as wide as tall, under
    /// `headroom`, no tighter than `closest` metres top to bottom, and (with
    /// a `corner`) keeping them out of the stamp's corner: it slides the
    /// least it can, or widens.
    static func fitting(_ items: [Room], others: [Room] = [], headroom: Double, closest: Double, corner: CGSize = .zero, reach: Double = 0,
                        cornerRight: Bool = false, angle: Angle = .stand) -> CameraFrame {
        guard !items.isEmpty else { return rest }
        let xs = items.map(\.point.x), ys = items.map(\.point.y)
        var frame = CameraFrame(x: (xs.min()! + xs.max()!) / 2, y: (ys.min()! + ys.max()!) / 2, span: closest)
        let aspect = CameraFrame.aspect, margin = CameraFrame.margin
        for _ in 0..<6 {
            let b = basis(frame, angle)
            func box(_ item: Room) -> (u0: Double, u1: Double, v0: Double, v1: Double) {
                let p = item.point
                let below = item.figure ? 0.3 : 0.5, above = item.figure ? 2.9 : 0.5, half = item.figure ? 0.9 : 0.5
                var u0 = Double.infinity, u1 = -Double.infinity, v0 = Double.infinity, v1 = -Double.infinity
                for q in [FieldPoint(x: p.x, y: p.y, z: p.z - below), FieldPoint(x: p.x, y: p.y, z: p.z + above),
                          FieldPoint(x: p.x - half, y: p.y, z: p.z), FieldPoint(x: p.x + half, y: p.y, z: p.z),
                          FieldPoint(x: p.x, y: p.y - half, z: p.z), FieldPoint(x: p.x, y: p.y + half, z: p.z)] {
                    let t = b.tangent(q)
                    u0 = min(u0, t.u); u1 = max(u1, t.u); v0 = min(v0, t.v); v1 = max(v1, t.v)
                }
                return (u0, u1, v0, v1)
            }
            let boxes = items.map(box)
            let u0 = boxes.map { $0.u0 }.min()!, u1 = boxes.map { $0.u1 }.max()!
            let v0 = boxes.map { $0.v0 }.min()!, v1 = boxes.map { $0.v1 }.max()!
            // Half the view's height, in the tangent plane.
            var h = max((v1 - v0) / (1 - headroom - margin), (u1 - u0) / (aspect * (1 - 2 * margin))) / 2
            h = min(max(h, max(closest, tightest) / 2 / b.distance), widest / 2 / b.distance)
            var cu = (u0 + u1) / 2, cv = (v0 + v1) / 2 + (headroom - margin) * h
            if corner.width > 0, corner.height > 0 {
                // Bystanders needn't be in frame, but none may stand in the stamp's corner.
                let bystanders = others.map(box)
                // (Clearing one man can bring the next in: a few more goes than there are usually men to clear.)
                for _ in 0..<10 {
                    func across(_ u: Double) -> Double { 0.5 + (u - cu) / (2 * h * aspect) }
                    func upward(_ v: Double) -> Double { 0.5 + (v - cv) / (2 * h) }
                    // In the corner: the stamp's side of the view, low down (with `reach`, a bystander just past the edge
                    // counts: a camera still easing in from wider shows him).
                    func shown(_ box: (u0: Double, u1: Double, v0: Double, v1: Double)) -> Bool {
                        across(box.u1) > -reach && across(box.u0) < 1 + reach && upward(box.v1) > -reach && upward(box.v0) < 1
                    }
                    let inside = (boxes + bystanders.filter(shown)).filter { box in
                        upward(box.v0) < corner.height && (cornerRight ? across(box.u1) > 1 - corner.width : across(box.u0) < corner.width)
                    }
                    guard !inside.isEmpty else { break }
                    let slide = cornerRight ? inside.map { across($0.u1) - (1 - corner.width) }.max()! : inside.map { corner.width - across($0.u0) }.max()!
                    let raise = inside.map { corner.height - upward($0.v0) }.max()!
                    let roomSide = cornerRight ? boxes.map { across($0.u0) }.min()! - margin : 1 - margin - boxes.map { across($0.u1) }.max()!
                    let roomUp = 1 - headroom - boxes.map { upward($0.v1) }.max()!
                    if slide <= roomSide, slide * aspect <= raise || raise > roomUp {
                        cu += (cornerRight ? 1 : -1) * slide * 2 * h * aspect
                    } else if raise <= roomUp {
                        cv -= raise * 2 * h
                    } else {
                        h = min(h * 1.15, widest / 2 / b.distance)
                    }
                }
            }
            // The ground point under the view's new middle.
            let ray = b.forward + b.right * cu + b.up * cv
            guard ray.z < -0.02 else { break }
            let ground = b.eye + ray * (-b.eye.z / ray.z)
            let next = CameraFrame(x: ground.x, y: ground.y, span: 1)
            let distance = ((SIMD3(ground.x, ground.y, 0) - eye(next, angle)) * (SIMD3(ground.x, ground.y, 0) - eye(next, angle))).sum().squareRoot()
            frame = CameraFrame(x: ground.x, y: ground.y, span: min(max(2 * h * distance, closest, tightest), widest))
        }
        return frame
    }
}

/// What the soccer theater shows at an instant: a framing, through the main
/// camera or the one behind a goal.
struct PitchFrame: Equatable {
    var camera: CameraFrame
    var angle = PitchCamera.Angle.stand

    var x: Double { camera.x }
    var y: Double { camera.y }
    var span: Double { camera.span }

    /// Between moments: the whole pitch from the halfway line.
    static let rest = PitchFrame(camera: PitchCamera.rest)
}

extension SoccerScript {
    /// One shot of the broadcast: from when, and what it keeps in frame.
    struct Shot: Equatable {
        var from: Double
        /// A flight's ball, now and a beat ahead.
        var flight: Int? = nil
        /// Figures by index, now and a beat ahead.
        var actors: [Int] = []
        /// Fixed spots: the goal's frame, the ball at rest.
        var points: [FieldPoint] = []
        /// Room ahead of the ball, toward the goal it's going at (metres).
        var lead = 0.0
        /// No closer than this (metres top to bottom).
        var closest = 16.0
        /// Frames the figures where they finish, not where they are: the
        /// payoff, held on the goal and where the scorer ends up.
        var settled = false

        func rooms(in script: SoccerScript, at t: Double, goal: CGPoint) -> [PitchCamera.Room] {
            var rooms = points.map { PitchCamera.Room($0, figure: false) }
            if let flight, flight < script.flights.count {
                let f = script.flights[flight]
                for dt in [0, 0.25, 0.5] {
                    let p = f.point(at: min(max(t + dt, f.start), f.end))
                    rooms.append(PitchCamera.Room(p, figure: false))
                    rooms.append(PitchCamera.Room(FieldPoint(p.ground), figure: false))
                }
                if lead > 0 {
                    let p = f.point(at: min(max(t, f.start), f.end))
                    let dx = goal.x - p.x, dy = goal.y - p.y, d = max(hypot(dx, dy), 1)
                    rooms.append(PitchCamera.Room(FieldPoint(x: p.x + dx / d * min(lead, d), y: p.y + dy / d * min(lead, d) * 0.5), figure: false))
                }
            }
            for index in actors where index < script.actors.count {
                for dt in settled ? [Double.infinity] : [0, 0.3] {
                    rooms.append(PitchCamera.Room(FieldPoint(script.actors[index].position(at: t + dt)), figure: true))
                }
            }
            return rooms
        }
    }

    /// The goal's frame, for a shot that keeps it in view.
    static func goalFrame(right: Bool) -> [FieldPoint] {
        let x = right ? Pitch.length : 0, back = right ? Pitch.length + 1.6 : -1.6
        return [FieldPoint(x: x, y: Pitch.posts.near, z: 0), FieldPoint(x: x, y: Pitch.posts.far, z: 0),
                FieldPoint(x: x, y: Pitch.posts.near, z: Pitch.goalHeight + 0.4), FieldPoint(x: x, y: Pitch.posts.far, z: Pitch.goalHeight + 0.4),
                FieldPoint(x: back, y: Pitch.width / 2, z: 0)]
    }
}

extension SoccerScript.Builder {
    /// Cuts the moment into shots: riding the ball through the build-up,
    /// each pass with the man it's going to and room ahead toward goal;
    /// pushing in as it's struck, on the shooter, the keeper and the goal
    /// mouth; then the payoff: the goal and the scorer wheeling away, the
    /// keeper with the ball, the block.
    mutating func shoot() {
        typealias Shot = SoccerScript.Shot
        let goalFrame = SoccerScript.goalFrame(right: right)
        var shots: [Shot] = []
        for p in possession where p.from < script.strike {
            shots.append(Shot(from: max(p.from - 0.15, 0), flight: p.flight, actors: p.actors, lead: 9, closest: 16))
        }
        if shots.isEmpty {
            // A penalty: the taker, the keeper and the goal.
            shots.append(Shot(from: 0, actors: [shooter, keeper], points: goalFrame, closest: 13))
        }
        let s = script.strike
        // The push-in: from a beat before the strike (an operator reads the shape of it).
        shots.append(Shot(from: max(s - 0.4, (shots.last?.from ?? 0) + 0.2), flight: script.shot, actors: [shooter, keeper],
                          points: goalFrame, closest: 11))
        let rest = script.ball(at: .infinity) ?? FieldPoint(goal)
        switch scene.outcome {
        case .goal:
            shots.append(Shot(from: script.arrive + 0.45, actors: [shooter], points: goalFrame + [rest], closest: 13, settled: true))
        case .ownGoal, .saved, .woodwork, .wide:
            shots.append(Shot(from: script.arrive + 0.4, actors: [keeper, shooter], points: goalFrame + (script.ballGone.isFinite ? [] : [rest]),
                              closest: 12, settled: true))
        case .blocked:
            let blocker = script.actors.indices.last { script.actors[$0].actions.contains { $0.kind == .block && $0.at >= script.arrive - 0.01 } }
            shots.append(Shot(from: script.arrive + 0.35, actors: [shooter] + (blocker.map { [$0] } ?? []), points: [rest], closest: 12,
                              settled: true))
        }
        script.shots = shots
        // The angle from behind the net: the goal, the keeper where he set and where he went, the
        // shooter when he's close enough to share it (from distance the ball arrives into it), held still.
        if let reverse = script.reverse {
            let goalFrame = SoccerScript.goalFrame(right: right).prefix(4).map { PitchCamera.Room($0, figure: false) }
            var rooms = Array(goalFrame)
            rooms.append(PitchCamera.Room(FieldPoint(script.actors[keeper].position(at: script.strike)), figure: true))
            if let dive = script.actors[keeper].dive { rooms.append(PitchCamera.Room(dive.target, figure: false)) }
            if let shot = script.shot { rooms.append(PitchCamera.Room(script.flights[shot].to, figure: false)) }
            let near = distance(scene.shot.from, goal) < 20
            let from = near ? FieldPoint(scene.shot.from) : script.ball(at: reverse.from + 0.25) ?? FieldPoint(scene.shot.from)
            rooms.append(PitchCamera.Room(from, figure: near))
            let frame = PitchCamera.fitting(rooms, headroom: CameraFrame.bannerRoom, closest: 9, angle: .behind(right: right))
            script.reverse?.frame = frame
        }
        let banners = script.banners
        let stamp = script.stamp, corner = script.corner, cornerRight = script.cornerRight, reverse = script.reverse
        let goal = self.goal
        func band(_ t: Double) -> Double {
            func smooth(_ x: Double) -> Double { let u = min(max(x, 0), 1); return u * u * (3 - 2 * u) }
            var up = 0.0
            for b in banners {
                let rise: Double = smooth((t - b.at + 0.5) / 0.4), fall: Double = smooth((t - b.until) / 0.4)
                up = max(up, rise * (1 - fall))
            }
            return CameraFrame.headroom + (CameraFrame.bannerRoom - CameraFrame.headroom) * up
        }
        let script = self.script, arrive = script.arrive
        let principals = script.actors.filter { !$0.shaped }
        /// The track, making room for the stamp from `early` before it lands, with `margin` more than its corner (someone
        /// walking into it is out again before the camera catches up), looking `ahead` at where everyone's going, and
        /// minding (by `reach`) men just past the edge of the view.
        func track(early: Double, margin: Double, ahead: Double, reach: Double) -> [CameraFrame] {
            CameraFollow.samples(until: script.settle) { t in
                let k = shots.lastIndex { $0.from <= t } ?? 0
                let shot = shots[k]
                let rooms = shot.rooms(in: script, at: t, goal: goal)
                // (Behind the cut from behind the goal, the main camera makes room for the stamp unseen; on it, never before
                // the shot's there: it pushes in for the shot, it doesn't widen for a stamp to come.)
                guard t >= min(max(stamp - early, arrive + 0.05), reverse?.from ?? .infinity) else {
                    return PitchCamera.fitting(rooms, headroom: band(t), closest: shot.closest)
                }
                // The stamp never sits on anyone in the play, in view or not (a teammate running to the scorer).
                let everyone = principals.flatMap { a in
                    stride(from: t, through: t + ahead, by: 0.3).map { PitchCamera.Room(FieldPoint(a.position(at: $0)), figure: true) }
                }
                return PitchCamera.fitting(rooms, others: everyone, headroom: band(t), closest: shot.closest,
                                           corner: CGSize(width: corner.width + margin, height: corner.height + margin + 0.01), reach: reach,
                                           cornerRight: cornerRight)
            }
        }
        /// How many frames once the stamp is down have a man in the play standing in its corner, as the camera (a beat
        /// behind its goal) actually frames them.
        func crowded(_ samples: [CameraFrame]) -> Int {
            let view = CGSize(width: 2, height: 1)
            return stride(from: stamp + 0.2, through: script.duration, by: 1.0 / 30).filter { t in
                let frame = reverse.map { t >= $0.from && t < $0.until } == true ? nil : CameraFollow.frame(samples, at: t)
                guard let frame else { return false }
                let f = PitchProjection(size: view, camera: PitchFrame(camera: frame))
                return principals.contains { a in
                    let foot = f.point(FieldPoint(a.position(at: t)))
                    let x = foot.x / view.width, y = foot.y / view.height
                    return (cornerRight ? x > 1 - corner.width : x < corner.width) && x > 0 && x < 1 && y > 1 - corner.height && y < 1
                }
            }.count
        }
        // The plainest track that keeps the corner clear; failing that, more care, a step at a time.
        var best: (samples: [CameraFrame], crowded: Int)?
        let care = [(0.3, 0.03, 0.3, 0.0), (0.6, 0.05, 0.9, 0.0), (0.9, 0.05, 0.9, 0.1), (1.2, 0.08, 1.2, 0.2), (1.6, 0.08, 1.5, 0.4), (2.0, 0.1, 1.8, 0.8)]
        for (early, margin, ahead, reach) in care {
            let samples = track(early: early, margin: margin, ahead: ahead, reach: reach)
            let count = crowded(samples)
            if best.map({ count < $0.crowded }) ?? true { best = (samples, count) }
            if count == 0 { break }
        }
        self.script.camera = best?.samples ?? []
    }
}
