import SwiftUI

// The soccer theater's choreography: a `SoccerScene` turned into every
// player's path, the ball's flights and the beats (the strike, the net, the
// save, the headline, the stamp), in metres and seconds. Built once per
// moment; any frame is a pure function of the script and t, so the harness
// can draw t = 4.2 without playing 0…4.2, and the tests can check that the
// keeper's hands are where the ball is when he saves it.
//
// Time is a broadcast replay's: the build-up a little quicker than the
// game's (passes at 24 m/s, the man on the ball at 8.5), so eight passes take
// about five seconds, not twenty; the shot at its own pace; then the payoff
// holds: the net ripples and the scorer wheels away, or the keeper comes up
// with it. The replay ends on the frame the theater holds until the next
// moment.
//
// Every figure is a player who touched the ball, standing where he touched
// it, and the keeper; nobody is invented. The script also says what each one
// does (a strike, a header, a dive, arms up), when the headline lands, and
// where the broadcast camera looks.

struct SoccerScript: Equatable {
    enum Team { case attacking, defending }

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
            }
            var kind: Kind
            var at: Double
            /// Where it's aimed: he faces it.
            var toward: CGPoint
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
        var moves: [PlayScript.Move] = []
        var actions: [Action] = []
        var dive: Dive?

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

        mutating func act(_ kind: Action.Kind, at time: Double, toward point: CGPoint) {
            actions.append(Action(kind: kind, at: time, toward: point))
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
    var camera: [CameraFrame] = []

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

    /// The framing at t: the camera's track, held on its last frame once the play has settled.
    func frame(at t: Double) -> CameraFrame { CameraFollow.frame(camera, at: t) ?? PitchCamera.rest }
}

// MARK: - Building

extension SoccerScript {
    /// The moment's replay. (`SoccerScript()` is the pitch with nobody on it: no moment yet.)
    init(_ scene: SoccerScene) {
        var b = Builder(scene: scene)
        b.buildUp()
        b.strike()
        b.payoff()
        b.finish()
        b.headline()
        b.measureStamp()
        b.shoot()
        self = b.script
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
    /// The build-up never runs longer than this: a longer move plays faster.
    static let buildUpLimit = 5.6

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

        init(scene: SoccerScene) {
            self.scene = scene
            right = scene.attacksRight
            goal = scene.goal
            // The keeper first: always there, on his line.
            let start = scene.touches.first?.at ?? scene.shot.from
            keeper = actor(.defending, scene.keeper.name ?? "keeper", at: keeperSpot(for: FieldPoint(start), distance: nil), role: .keeper)
        }

        /// The actor for a player, made the first time he's needed.
        mutating func actor(_ team: Team, _ name: String, at: CGPoint, role: Actor.Role = .outfield) -> Int {
            let key = "\(team == .attacking ? "A" : "D"):\(name)"
            if let i = index[key] { return i }
            // The keeper by name: his touches are his.
            if team == .defending, role == .outfield, let keeperName = scene.keeper.name, name == keeperName, let i = index["D:\(keeperName)"] {
                return i
            }
            script.actors.append(Actor(team: team, role: role, name: name, at: at))
            index[key] = script.actors.count - 1
            return script.actors.count - 1
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

        func carryTime(_ d: Double) -> Double { d < 1.2 ? 0.14 : min(max(d / SoccerScript.carrySpeed, 0.2), 1.3) }

        /// A lofted ball's height over the line: higher the longer it goes.
        func peak(_ d: Double, cross: Bool) -> Double { cross ? min(2.2 + d * 0.09, 7) : min(2.5 + d * 0.11, 11) }

        // MARK: Build-up

        /// The move, touch by touch: the ball goes from each man to the
        /// next (to where a pass was aimed, then at the receiver's feet to
        /// where he next played it), and every player is where ESPN says he
        /// was when he played it.
        mutating func buildUp() {
            let touches = scene.touches
            // A set piece opens on the taker standing over it.
            var t = scene.start == .openPlay ? 0.5 : 0.8
            if scene.shot.penalty { t = 1.3 }
            // Planned at full pace first; a long move is then played faster to fit.
            let plan = plannedLength(touches)
            let pace = plan > SoccerScript.buildUpLimit ? SoccerScript.buildUpLimit / plan : 1
            for (i, touch) in touches.enumerated() {
                let team: Team = touch.defending ? .defending : .attacking
                let who = actor(team, touch.player, at: touch.at)
                let played = t
                mark(who, t, touch.at)
                let next: (player: String, at: CGPoint, defending: Bool) = i + 1 < touches.count
                    ? (touches[i + 1].player, touches[i + 1].at, touches[i + 1].defending)
                    : (scene.shooter, scene.shot.from, scene.outcome == .ownGoal)
                // Played on from where it came to him: at the height it arrived (off a defender's body, a keeper's hands).
                let arrived = script.flights.last.flatMap { distance($0.to.ground, touch.at) < 0.5 ? $0.to.z : nil } ?? 0.11
                let ball = FieldPoint(touch.at, z: arrived)
                let aim: CGPoint = next.defending || touch.to == nil ? next.at : touch.to!
                let sameMan = next.player == touch.player && next.defending == touch.defending
                switch touch.kind {
                case .pass, .cross, .restart, .shot:
                    // Struck toward where it was aimed; the receiver meets it there.
                    let lofted = touch.lofted || (touch.kind == .restart && scene.start == .throwIn)
                    let d = distance(touch.at, aim)
                    let flightTime = passTime(d, lofted: lofted) * pace
                    let from = scene.start == .throwIn && touch.kind == .restart ? FieldPoint(touch.at, z: 2.1) : ball
                    // A cross met first time arrives where it's met: at his head, or a volley's height.
                    let met = i + 1 == touches.count && distance(aim, scene.shot.from) < 1.5 ? strikeHeight : 0.11
                    let to = FieldPoint(aim, z: next.defending ? 0.9 : met)
                    script.flights.append(Flight(kind: touch.kind == .shot ? .shot : .pass, start: t, end: t + flightTime, from: from, to: to,
                                                 arc: lofted ? .lofted(peak(d, cross: touch.kind == .cross)) : .straight))
                    script.actors[who].act(scene.start == .throwIn && touch.kind == .restart ? .throwIn : .kick, at: t, toward: aim)
                    let arrives = t + flightTime
                    let receiver = actor(next.defending ? .defending : .attacking, next.player, at: aim)
                    possession.append((t, arrives, [who, receiver], script.flights.count - 1))
                    if sameMan && !next.defending {
                        // Played into space and run onto: he gets there as it does.
                        mark(who, arrives, aim)
                    } else {
                        mark(receiver, arrives, aim)
                    }
                    t = arrives
                    // Then he takes it on to where he played it next.
                    let onward = distance(aim, next.at)
                    if !next.defending, onward > 1.2 {
                        t = carry(receiver, from: aim, to: next.at, at: t, pace: pace)
                    } else if i + 1 < touches.count || scene.shot.technique == .foot {
                        t += 0.12 * pace
                    }
                case .takeOn, .touch, .regain:
                    if sameMan {
                        t = carry(who, from: touch.at, to: next.at, at: t + 0.1 * pace, pace: pace)
                    } else {
                        // Knocked on to the next man (or off a defender).
                        let d = distance(touch.at, next.at)
                        let lofted = d > 30
                        let flightTime = passTime(d, lofted: lofted) * pace
                        script.flights.append(Flight(kind: .pass, start: t, end: t + flightTime, from: ball,
                                                     to: FieldPoint(next.at, z: next.defending ? 0.9 : 0.11),
                                                     arc: lofted ? .lofted(peak(d, cross: false)) : .straight))
                        if !touch.defending { script.actors[who].act(.kick, at: t, toward: next.at) }
                        let receiver = actor(next.defending ? .defending : .attacking, next.player, at: next.at)
                        possession.append((t, t + flightTime, [who, receiver], script.flights.count - 1))
                        t += flightTime
                        mark(receiver, t, next.at)
                        if i + 1 < touches.count { t += 0.1 * pace }
                    }
                }
                if touch.defending { script.actors[who].act(.block, at: played, toward: touch.at) }
            }
            if scene.start == .penalty || touches.isEmpty {
                // No move: the taker stands over it (a penalty's run-up comes with the strike).
                script.flights.append(Flight(kind: .carry, start: 0, end: 0.01, from: FieldPoint(scene.shot.from, z: 0.11),
                                             to: FieldPoint(scene.shot.from, z: 0.11)))
            }
            shooter = actor(scene.outcome == .ownGoal ? .defending : .attacking, scene.shooter, at: scene.shot.from)
            script.strike = max(t, 0.6)
            mark(shooter, script.strike, scene.shot.from)
        }

        /// The move's length at full pace.
        func plannedLength(_ touches: [SoccerScene.Touch]) -> Double {
            var total = 0.0
            for (i, touch) in touches.enumerated() {
                let next = i + 1 < touches.count ? touches[i + 1].at : scene.shot.from
                if let to = touch.to, touch.kind != .touch, touch.kind != .takeOn, touch.kind != .regain {
                    total += passTime(distance(touch.at, to), lofted: touch.lofted) + carryTime(distance(to, next))
                } else {
                    total += carryTime(distance(touch.at, next)) + 0.1
                }
            }
            return total
        }

        /// He runs with it: the ball at his feet.
        mutating func carry(_ who: Int, from: CGPoint, to: CGPoint, at t: Double, pace: Double) -> Double {
            let time = carryTime(distance(from, to)) * pace
            mark(who, t, from)
            mark(who, t + time, to, ease: .linear)
            script.flights.append(Flight(kind: .carry, start: t, end: t + time, from: FieldPoint(from, z: 0.11), to: FieldPoint(to, z: 0.11)))
            possession.append((t, t + time, [who], script.flights.count - 1))
            return t + time
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
            let struck: Actor.Action.Kind = scene.outcome == .ownGoal ? .block : s.technique == .header ? .header : .kick
            script.actors[shooter].act(struck, at: t0, toward: CGPoint(x: target.x, y: target.y))

            // The keeper: set as it's struck, then at full stretch, standing, or beaten.
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
            let react = s.penalty ? t0 + 0.02 : t0 + 0.1
            let reachAt = script.arrive
            let side = (right ? 1.0 : -1.0)
            switch scene.outcome {
            case _ where stranded:
                if scene.outcome == .saved { script.impacts.append(Impact(kind: .save, at: reachAt, point: end)) }
                if scene.outcome == .blocked { script.impacts.append(Impact(kind: .block, at: reachAt, point: end)) }
            case .saved:
                let lateral = abs(end.y - set.y)
                if lateral < 1.0, end.z < 1.9 {
                    // Straight at him: he takes it in.
                    mark(keeper, reachAt, CGPoint(x: end.x - side * 0.35, y: end.y))
                    script.actors[keeper].act(.gather, at: reachAt, toward: s.from)
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
            let flag = CGPoint(x: goal.x - (right ? 1 : -1) * 12, y: 0)
            let dx = flag.x - from.x, dy = flag.y - from.y, d = max(hypot(dx, dy), 1)
            let run = min(17.0, d - 3)
            let spot = CGPoint(x: min(max(from.x + dx / d * run, 1.5), Pitch.length - 1.5), y: max(from.y + dy / d * run, 2.5))
            mark(shooter, t + 0.2, from)
            mark(shooter, t + 2.2, spot, ease: .out)
            script.actors[shooter].act(.celebrate, at: t + 1.85, toward: CGPoint(x: Pitch.length / 2, y: 0))
            // The assist first to him, then whoever else is near.
            let teammates = script.actors.indices.filter { $0 != shooter && script.actors[$0].team == .attacking }
            let near = teammates.filter { i in
                let p = lastMark(i) ?? script.actors[i].at
                return distance(p, spot) < 20
            }.sorted { a, b in (script.actors[a].name == scene.assist ? 0 : 1) < (script.actors[b].name == scene.assist ? 0 : 1) }
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
                if actor.role == Actor.Role.keeper {
                    actor.at = first.at
                } else if !(scene.shot.penalty && i == shooter) {
                    // Into his first touch from a couple of strides off it, so he's moving when it comes.
                    let lead = min(first.t * 2.5, 3.0)
                    actor.at = CGPoint(x: first.at.x - side * lead * 0.7, y: first.at.y - lead * 0.7)
                }
                var previous = Mark(t: 0, at: actor.at)
                for var m in list {
                    // Back to his line after coming out, the keeper arrives when he can.
                    if m.soft, m.t > previous.t {
                        let d = distance(previous.at, m.at), reach = SoccerScript.runSpeed * (m.t - previous.t)
                        if d > reach { m.at = CGPoint(x: previous.at.x + (m.at.x - previous.at.x) * reach / d, y: previous.at.y + (m.at.y - previous.at.y) * reach / d) }
                    }
                    let d = distance(previous.at, m.at)
                    if let ease = m.ease {
                        // On the ball (or a dive): exactly from the mark before.
                        if d > 0.02 { actor.move(to: [m.at], from: previous.t, to: m.t, ease: ease) }
                    } else if d > 0.05 {
                        // Off it: sets off in time to get there at a run, never before the mark before.
                        let need = d / SoccerScript.runSpeed
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

    static func eye(_ frame: CameraFrame) -> SIMD3<Double> {
        SIMD3(Pitch.length / 2 + (frame.x - Pitch.length / 2) * travel, -back, height)
    }

    static func basis(_ frame: CameraFrame) -> Basis {
        let eye = eye(frame)
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
    static func fitting(_ items: [Room], headroom: Double, closest: Double, corner: CGSize = .zero, cornerRight: Bool = false) -> CameraFrame {
        guard !items.isEmpty else { return rest }
        let xs = items.map(\.point.x), ys = items.map(\.point.y)
        var frame = CameraFrame(x: (xs.min()! + xs.max()!) / 2, y: (ys.min()! + ys.max()!) / 2, span: closest)
        let aspect = CameraFrame.aspect, margin = CameraFrame.margin
        for _ in 0..<6 {
            let b = basis(frame)
            var boxes: [(u0: Double, u1: Double, v0: Double, v1: Double)] = []
            boxes.reserveCapacity(items.count)
            for item in items {
                let p = item.point
                let below = item.figure ? 0.3 : 0.5, above = item.figure ? 2.9 : 0.5, half = item.figure ? 0.9 : 0.5
                var u0 = Double.infinity, u1 = -Double.infinity, v0 = Double.infinity, v1 = -Double.infinity
                for q in [FieldPoint(x: p.x, y: p.y, z: p.z - below), FieldPoint(x: p.x, y: p.y, z: p.z + above),
                          FieldPoint(x: p.x - half, y: p.y, z: p.z), FieldPoint(x: p.x + half, y: p.y, z: p.z),
                          FieldPoint(x: p.x, y: p.y - half, z: p.z), FieldPoint(x: p.x, y: p.y + half, z: p.z)] {
                    let t = b.tangent(q)
                    u0 = min(u0, t.u); u1 = max(u1, t.u); v0 = min(v0, t.v); v1 = max(v1, t.v)
                }
                boxes.append((u0, u1, v0, v1))
            }
            let u0 = boxes.map { $0.u0 }.min()!, u1 = boxes.map { $0.u1 }.max()!
            let v0 = boxes.map { $0.v0 }.min()!, v1 = boxes.map { $0.v1 }.max()!
            // Half the view's height, in the tangent plane.
            var h = max((v1 - v0) / (1 - headroom - margin), (u1 - u0) / (aspect * (1 - 2 * margin))) / 2
            h = min(max(h, max(closest, tightest) / 2 / b.distance), widest / 2 / b.distance)
            var cu = (u0 + u1) / 2, cv = (v0 + v1) / 2 + (headroom - margin) * h
            if corner.width > 0, corner.height > 0 {
                for _ in 0..<4 {
                    func across(_ u: Double) -> Double { 0.5 + (u - cu) / (2 * h * aspect) }
                    func upward(_ v: Double) -> Double { 0.5 + (v - cv) / (2 * h) }
                    // In the corner: the stamp's side of the view, low down.
                    let inside = boxes.filter { box in
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
            let distance = ((SIMD3(ground.x, ground.y, 0) - eye(next)) * (SIMD3(ground.x, ground.y, 0) - eye(next))).sum().squareRoot()
            frame = CameraFrame(x: ground.x, y: ground.y, span: min(max(2 * h * distance, closest, tightest), widest))
        }
        return frame
    }
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
        let banners = script.banners
        let stamp = script.stamp, corner = script.corner, cornerRight = script.cornerRight
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
        let script = self.script
        self.script.camera = CameraFollow.samples(until: script.settle) { t in
            let k = shots.lastIndex { $0.from <= t } ?? 0
            let shot = shots[k]
            let rooms = shot.rooms(in: script, at: t, goal: goal)
            let stamped = t >= stamp - 0.3
            return PitchCamera.fitting(rooms, headroom: band(t), closest: shot.closest, corner: stamped ? corner : .zero, cornerRight: cornerRight)
        }
    }
}
