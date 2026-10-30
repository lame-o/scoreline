import SwiftUI

// The basketball theater's lighter beats: every play ESPN logs that isn't a
// marquee replay, told in a second or three from its real data, so the
// isometric view never sits on a frozen court while the game goes on. A miss
// leaves the shooter's hand where ESPN put him and comes off the rim the way
// a shot from there does (a long three kicks out long, often to the weak
// side; a floater stays at the rim; a free throw comes off the front), to the
// man the data credits, who goes where a player of his position would come
// from (a center from the block, a guard from the arc). Each free throw is
// its own beat (the shooter's routine is his own, every trip), each whistle
// is called at ESPN's spot by a referee who runs in to make it (and goes once
// he has: a referee is on the floor only while he's doing something), each turnover
// is told by its kind (picked off, poked loose, out of bounds, a travel, a
// charge with the defender on the floor), and the stoppages (substitutions,
// timeouts, reviews, the ends of periods) take the floor where it stood.
//
// Every beat starts where the last one left everyone (`Lineup`, turned half
// a turn when the ball changes hands), so the court plays on like a video
// game; a marquee replay still cuts to its own set, as a replay does. Where
// the data is silent (who drew a personal foul, which way a pass went), the
// choice is plausible and seeded from the play's ID: the same play always
// looks the same, and no two look alike.
//
// Between plays the court rests possession-aware (`Rest`): the team with the
// ball pushes up the floor or inbounds and sets up in the half court, then
// every few seconds something small happens (a jab, a swing pass, a cut, a
// screen), the defense shading with it, still in between; at a timeout both
// teams are at their benches until play resumes; at the half the floor is
// empty. Pure values: a frame is a function of the script and t.

// MARK: - Lineup

/// Where everyone stood when one beat handed over to the next: in its
/// frame (the team at the basket in front first), who had the ball, the
/// shape the floor was in, and the camera's framing then.
struct Lineup: Equatable {
    enum Formation: Hashable { case play, lane, benches, offCourt, center }

    var offense: GameDetail.Side?
    var at: [CGPoint]
    var holder: Int?
    var ball: CGPoint?
    var formation: Formation
    var camera: CameraFrame? = nil
    var yaw: Double? = nil

    /// The same floor in `side`'s frame: half a turn round, and the fives
    /// swapped, when the other team is the one at the basket in front.
    func seen(by side: GameDetail.Side?) -> Lineup {
        guard at.count == 10, let side, let offense, side != offense else { return self }
        func turn(_ p: CGPoint) -> CGPoint { CGPoint(x: Hoops.length - p.x, y: Hoops.width - p.y) }
        return Lineup(offense: side, at: (Array(at[5..<10]) + Array(at[0..<5])).map(turn), holder: holder.map { ($0 + 5) % 10 },
                      ball: ball.map(turn), formation: formation, camera: nil, yaw: nil)
    }
}

// MARK: - Ends

/// Which basket each team attacks, as the theater draws it. ESPN folds its
/// coordinates onto one half court, so the data can't say which end a team
/// is at on TV: the default is the broadcast's on the night this was built
/// (the visitors at the right basket in the first half: the Spurs were going
/// right to left in overtime at Utah), the ends swapped at halftime and kept
/// for overtime, and the viewer's turn (`TheaterFlipButton`) on top of it. A
/// team's bench is by the basket it defends in the first half. (pure; tested)
struct HoopsEnds: Equatable {
    /// The top team attacks the right basket now…
    var topRight: Bool
    /// …and did in the first half.
    var topOpensRight: Bool

    init(topRight: Bool, topOpensRight: Bool) {
        self.topRight = topRight
        self.topOpensRight = topOpensRight
    }

    /// The ends in `period` (1–4, 5 on for overtime) for a game whose top
    /// team is the home team or not, turned round when the viewer `flipped` it.
    init(period: Int?, topIsHome: Bool, flipped: Bool) {
        let opens = !topIsHome != flipped
        topOpensRight = opens
        topRight = (period ?? 1) >= 3 ? !opens : opens
    }

    /// Whether `side` attacks the right basket (nil: the top team's end).
    func right(_ side: GameDetail.Side?) -> Bool { side == .bottom ? !topRight : topRight }

    /// Whether `side`'s bench is at the right end (by the basket it defends in the first half).
    func benchRight(_ side: GameDetail.Side) -> Bool { side == .top ? !topOpensRight : topOpensRight }
}

// MARK: - Between plays

extension BasketballScript {
    /// The court between plays: who has the ball, which way everyone faces,
    /// how the floor got this way (and so what it does first), where it
    /// starts from, and a seed for its variety.
    struct Rest: Equatable {
        enum Phase: Equatable {
            /// Play on: set up in the half court (pushed up the floor first when they're far from it).
            case live
            /// The ball taken out (under the basket after a score, at the sideline after a whistle), then up the floor.
            case inbound(baseline: Bool)
            /// Free throws to come: lined up on the lane, the shooter at the line.
            case lane
            /// A timeout, the end of a quarter: both teams at their benches.
            case benches
            /// Halftime, the final: the court empty.
            case offCourt
            /// Before a tip: both teams round the center circle.
            case tip
            /// A miss nobody has yet: the ball where it lies.
            case loose
        }

        var offense: GameDetail.Side?
        var ends: HoopsEnds
        var phase: Phase
        var from: Lineup?
        var seed: String
        /// The rest before this one ran out (a long stoppage goes on as a new one): no opening.
        var round = 0
        /// A big's defensive board: he looks up the floor and outlets it rather than bring it up himself.
        var outlet = false

        init(offense: GameDetail.Side?, ends: HoopsEnds = HoopsEnds(topRight: true, topOpensRight: true), phase: Phase = .live,
             from: Lineup? = nil, seed: String = "rest", round: Int = 0, outlet: Bool = false) {
            self.offense = offense
            self.ends = ends
            self.phase = offense == nil && phase == .live ? .tip : phase
            self.from = from
            self.seed = seed
            self.round = round
            self.outlet = outlet
        }
    }

    init(rest: Rest) {
        // Nobody's ball (the end of a period): the floor stays turned the way it was.
        let side = rest.offense ?? rest.from?.offense ?? .top
        var b = Builder(scene: nil, offense: side, right: rest.ends.right(side), seed: "\(rest.seed)·\(rest.round)")
        b.ends = rest.ends
        b.rest(rest)
        self = b.script
        measureBodies()
    }

    /// A lighter beat: the play `scene` (and, for substitutions, the rest of
    /// its stoppage's), from where `from` left everyone; `fallback` is who
    /// has the ball when the play doesn't say.
    init(beat scene: BasketballScene, group: [BasketballScene] = [], ends: HoopsEnds, from: Lineup?, fallback: GameDetail.Side? = nil) {
        let side = Self.side(of: scene, from: from, fallback: fallback)
        var b = Builder(scene: scene, offense: side, right: ends.right(side))
        b.ends = ends
        b.beat(from: from, group: group)
        self = b.script
        measureBodies()
    }

    /// The frame a beat is told in: the team with the ball on it (a whistle's
    /// stays with the floor as it was).
    static func side(of scene: BasketballScene, from: Lineup?, fallback: GameDetail.Side?) -> GameDetail.Side {
        if scene.kind == .defensiveRebound, from?.formation == .play, let off = from?.offense { return off }
        return scene.ball ?? from?.offense ?? fallback ?? .top
    }
}

// MARK: - Building the beats

extension BasketballScript.Builder {
    typealias Player = BasketballScript.Player
    typealias Flash = BasketballScript.Flash
    typealias Action = BasketballScript.Action

    var right: Bool { ends.right(offense) }

    /// A point as drawn (x left to right, y out from the near sideline, the camera's) in this frame.
    func framed(_ drawn: CGPoint) -> CGPoint { right ? drawn : CGPoint(x: Hoops.length - drawn.x, y: Hoops.width - drawn.y) }

    /// The near sideline's y in this frame.
    var near: Double { right ? 0 : Hoops.width }

    /// Off the near sideline by `d` feet, in this frame.
    func offNear(_ d: Double) -> Double { right ? -d : Hoops.width + d }

    /// The side a team is (0–4 the team at the basket in front).
    func side(_ team: BasketballScript.Team) -> GameDetail.Side {
        let own = offense ?? .top
        return team == .defense ? own.opponent : own
    }

    /// A team's huddle at its bench: five round a spot just off the near
    /// sideline, by the basket it defended in the first half.
    func huddle(_ team: BasketballScript.Team) -> [CGPoint] {
        let x = ends.benchRight(side(team)) ? 66.0 : 28.0
        return [(-3.0, -0.7), (-1.5, 0.8), (0, 1.3), (1.5, 0.8), (3.0, -0.7)].map { framed(CGPoint(x: x + $0.0, y: -4.4 + $0.1)) }
    }

    /// Starts from where the last beat left everyone, turned into this frame:
    /// true when the floor was in one of `allowed` (live play, by default);
    /// false sets up fresh.
    mutating func place(_ lineup: Lineup?, allowed: Set<Lineup.Formation> = [.play]) -> Bool {
        guard let lineup, lineup.at.count == 10, allowed.contains(lineup.formation) else { return false }
        let seen = lineup.seen(by: offense ?? .top)
        script.players = seen.at.enumerated().map { Player(team: $0.offset < 5 ? .offense : .defense, at: $0.element) }
        start = seen
        return true
    }

    /// Five on five set up fresh round `fixed` (the first of them with the ball), when there's no floor to start from.
    mutating func setUp(_ fixed: [CGPoint]) {
        lineUp(fixed, ball: 0)
        start = Lineup(offense: offense ?? .top, at: script.players.map(\.at), holder: 0, ball: nil, formation: .play)
    }

    /// Starts from the floor as it stood, unless the man with the ball is
    /// nowhere near where ESPN puts the play (the floor had moved on, a beat
    /// was passed over): then set up there fresh, as a cut.
    mutating func place(_ lineup: Lineup?, near spot: CGPoint, within reach: Double = 32) {
        if place(lineup), Self.distance(position(holder(), 0), spot) <= reach { return }
        setUp([Self.inbounds(Self.along(spot, out(spot), 3))])
    }

    /// Players `a` and `b` trade places in the list (before anyone moves): the
    /// one a beat is about becomes 0, as the replays have it.
    mutating func trade(_ a: Int, _ b: Int) {
        guard a != b, a < script.players.count, b < script.players.count else { return }
        script.players.swapAt(a, b)
        if let h = start?.holder { start?.holder = h == a ? b : h == b ? a : h }
    }

    /// Who had the ball at the start (or the man of `team` nearest where it lay).
    func holder(_ team: ClosedRange<Int> = 0...4) -> Int {
        if let h = start?.holder, team.contains(h) { return h }
        let ball = start?.ball ?? CGPoint(x: 62, y: 25)
        return team.min { Self.distance(position($0, 0), ball) < Self.distance(position($1, 0), ball) } ?? team.lowerBound
    }

    /// The nearest of `pool` to `p` at t.
    func nearest(_ pool: [Int], to p: CGPoint, at t: Double = 0) -> Int {
        pool.min { Self.distance(position($0, t), p) < Self.distance(position($1, t), p) } ?? pool.first ?? 0
    }

    /// A move that isn't kept on the floor (to a bench, off the court).
    mutating func walk(_ i: Int, to path: [CGPoint], from start: Double, to end: Double, ease: PlayScript.Ease = .inOut) {
        script.players[i].move(to: path, from: start, to: end, ease: ease)
    }

    /// The referee nearest the call comes in to see it (the lead on the
    /// baseline for one near the basket, else the trail on the near
    /// sideline), whistles at `t` and signals; then he's gone (fading out
    /// as his signal comes down: standing there he'd only be in the way).
    @discardableResult
    mutating func whistle(at t: Double, spot: CGPoint, signal: Action.Kind = .signal, toward: CGPoint? = nil) -> Int {
        let deep = spot.x > 79
        let stand = deep ? CGPoint(x: 95.4, y: spot.y >= 25 ? 31 : 19) : CGPoint(x: min(max(spot.x - 5, 50), 82), y: offNear(1.6))
        let from = deep ? CGPoint(x: 95.6, y: stand.y + (spot.y >= 25 ? 4 : -4)) : CGPoint(x: stand.x - 6, y: stand.y)
        var ref = Player(team: .official, at: from)
        ref.enters = max(t - 0.9, -0.3)
        ref.leaves = t + Self.signalled
        ref.move(to: [stand], from: max(t - 0.7, 0), to: t, ease: .out)
        ref.act(signal, at: t + 0.06, toward: toward ?? spot)
        script.players.append(ref)
        script.flashes.append(Flash(beat: .whistle, at: t, point: FieldPoint(stand, z: 6.2)))
        return script.players.count - 1
    }

    /// How long a referee stays after his whistle: his signal held and
    /// lowered, then he fades.
    static let signalled = 1.5

    /// Play stops at the whistle: everyone eases to a stop just past where
    /// he was going (`except` aside).
    mutating func freeze(at t: Double, except: Set<Int> = []) {
        for i in 0..<min(script.players.count, 10) where !except.contains(i) {
            let here = position(i, t), ahead = position(i, t + 0.3)
            let stop = CGPoint(x: here.x + (ahead.x - here.x) * 0.5, y: here.y + (ahead.y - here.y) * 0.5)
            script.players[i].move(to: [stop], from: t, to: t + 0.45, ease: .out)
        }
    }

    /// A tag over the beat, in `side`'s color, from `t`.
    mutating func tag(_ text: String, _ side: GameDetail.Side?, at t: Double) {
        script.tag = BasketballScript.Tag(text: text, side: side, at: t)
    }

    /// A man's name for a tag: "HAYES".
    static func called(_ person: BasketballScene.Person?) -> String? {
        guard let name = person?.name, !name.isEmpty else { return nil }
        return name.uppercased()
    }

    // MARK: Where a miss comes down

    /// Off the rim the way a shot from there comes off (ESPN logs the
    /// rebound at the miss's own spot, not where it was taken): where it hits
    /// the ring, where it comes down, whether it's taken up in traffic or
    /// after a bounce. A three kicks out long, two times in three to the weak
    /// side; a mid-range shot comes off six to ten feet; a floater or a hook
    /// stays at the rim; a layup goes out the far side or back the way it
    /// came; a free throw comes off the front, to the lane. Seeded by the
    /// miss itself, so its beat and its rebound's agree. In the shooter's
    /// frame. (pure; tested)
    struct Carom: Equatable {
        /// Where it leaves the ring.
        var hit: FieldPoint
        var spot: CGPoint
        /// Taken over the rim's height, among bodies.
        var high: Bool
        /// A long one, taken on its first bounce.
        var bounce: Bool
    }

    static func carom(_ miss: BasketballScene.Miss) -> Carom {
        var r = SplitMix64(seed: Celebration.seed("carom·" + (miss.id ?? "\(miss.spot.x),\(miss.spot.y)")))
        let from = miss.freeThrow ? CGPoint(x: Hoops.freeThrow, y: 25) : inbounds(Hoops.court(miss.spot))
        let rim = Self.rim
        let o = distance(from, rim) > 1.5 ? unit(CGPoint(x: from.x - rim.x, y: from.y - rim.y)) : CGPoint(x: -1, y: 0)
        let weak = CGPoint(x: o.x, y: -o.y)
        let d = miss.distance ?? distance(from, rim)
        var dir: CGPoint, reach: Double
        if miss.freeThrow {
            dir = rotate(o, r.in(-1.1...1.1))
            reach = r.in(4...7.5)
        } else if miss.close {
            let approach = o.x > -0.3 ? CGPoint(x: -0.3, y: o.y >= 0 ? 0.954 : -0.954) : o
            dir = r.in(0...1) < 0.55 ? rotate(CGPoint(x: -approach.x, y: -approach.y), r.in(-0.8...0.8)) : rotate(approach, r.in(-0.9...0.9))
            reach = r.in(2.5...5.5)
        } else if d >= 22 {
            dir = r.in(0...1) < 0.65 ? rotate(weak, r.in(-0.45...0.45)) : rotate(o, r.in(-0.5...0.5))
            reach = r.in(10...16)
        } else if d >= 10 {
            dir = r.in(0...1) < 0.5 ? rotate(weak, r.in(-0.5...0.5)) : rotate(o, r.in(-0.75...0.75))
            reach = r.in(6...10.5)
        } else {
            dir = rotate(r.in(0...1) < 0.5 ? weak : o, r.in(-0.9...0.9))
            reach = r.in(3...6.5)
        }
        var spot = along(rim, dir, reach)
        // Nothing comes down behind the backboard: off the baseline, back in front of it.
        if spot.x > 87.5 { spot.x = 87.5 - (spot.x - 87.5) * 0.6 }
        spot = CGPoint(x: min(max(spot.x, 45), 92), y: min(max(spot.y, 1.6), 48.4))
        let out = unit(CGPoint(x: spot.x - rim.x, y: spot.y - rim.y))
        let hit = FieldPoint(along(rim, out, Hoops.rimRadius), z: Hoops.rimHeight + 0.15)
        let high = reach < 8.5 && r.in(0...1) < 0.8
        return Carom(hit: hit, spot: spot, high: high, bounce: !high && reach > 10.5 && r.in(0...1) < 0.5)
    }

    /// The man the data credits with a rebound, from where he'd come: of his
    /// team (`pool`), the nearest the ball weighted by how he plays (a big
    /// from near the rim, a guard from out on the floor).
    func rebounder(_ pool: [Int], toward spot: CGPoint, role: BasketballScene.Role?, at t: Double) -> Int? {
        func cost(_ i: Int) -> Double {
            let p = position(i, t)
            let lean = role == .big ? 0.5 : role == .guardRole ? -0.3 : 0.1
            return Self.distance(p, spot) + lean * Self.distance(p, rim)
        }
        return pool.min { cost($0) < cost($1) }
    }

    /// The ball off the rim at `t` (leaving the ring at the carom's point),
    /// and down to `r` (nil: the floor) where it's going: a man in traffic
    /// takes it high, one out on the floor on the bounce. When it's taken.
    @discardableResult
    mutating func comeOff(_ c: Carom, at t: Double, to r: Int?, from: Double, team: Set<Int> = []) -> Double {
        script.rimHit = t
        script.rimStrength = 0.3
        script.flashes.append(Flash(beat: .rim, at: t, point: c.hit))
        guard let r else {
            // Nobody's: up off the rim and down, bouncing to rest.
            let peak = 1.6 + Self.distance(c.hit.ground, c.spot) * 0.1
            let time = (8 * peak / Self.g).squareRoot() * 0.75 + 0.12
            fly(from: c.hit, to: FieldPoint(c.spot, z: 4), start: t, time: time, arc: .arc(peak))
            let o = Self.unit(CGPoint(x: c.spot.x - rim.x, y: c.spot.y - rim.y))
            dropToFloor(from: FieldPoint(c.spot, z: 4), at: t + time, drift: CGPoint(x: o.x * 3.5, y: o.y * 3.5), downward: 9)
            return t + time
        }
        let land = reach(r, toward: c.spot, from: from, by: t + (c.high ? 0.7 : 1.0))
        if c.high {
            let peak = 1.8 + Self.distance(c.hit.ground, land) * 0.1
            let time = (8 * peak / Self.g).squareRoot() * 0.8 + 0.1
            fly(from: c.hit, to: FieldPoint(land, z: 8.6), start: t, time: time, arc: .arc(peak))
            takeRebound(r, at: land, arrives: t + time, from: from)
            return t + time
        }
        // Long: down once short of him, up into his hands at the chest.
        let toward = Self.unit(CGPoint(x: land.x - rim.x, y: land.y - rim.y))
        let bounceAt = Self.along(land, toward, c.bounce ? -3.2 : -0.1)
        let peak = 2.4 + Self.distance(c.hit.ground, bounceAt) * 0.12
        let first = (8 * peak / Self.g).squareRoot() * 0.85 + 0.12
        if c.bounce {
            fly(from: c.hit, to: FieldPoint(bounceAt, z: 0.4), start: t, time: first, arc: .arc(peak))
            fly(from: FieldPoint(bounceAt, z: 0.4), to: FieldPoint(land, z: 4.2), start: t + first, time: 0.34, arc: .arc(1.1))
        } else {
            fly(from: c.hit, to: FieldPoint(land, z: 5.2), start: t, time: first, arc: .arc(peak))
        }
        let caught = t + first + (c.bounce ? 0.34 : 0)
        move(r, to: [Self.along(land, toward, 0.6)], from: from, to: max(caught - 0.05, from + 0.2), ease: .out)
        act(r, .catchBall, at: caught, toward: land)
        hold(r, from: caught, until: .infinity)
        script.flashes.append(Flash(beat: .catchBall, at: caught, point: FieldPoint(land, z: 4.6)))
        over = max(over, caught + 0.3)
        return caught
    }

    // MARK: Dispatch

    mutating func beat(from lineup: Lineup?, group: [BasketballScene]) {
        guard let scene else { return }
        script.formation = .play
        switch scene.kind {
        case .jumper, .three, .layup, .dunk, .alleyOop, .putback, .block:
            missBeat(lineup)
        case .freeThrow:
            freeThrowBeat(lineup)
        case .offensiveRebound, .defensiveRebound:
            reboundBeat(lineup)
        case .steal, .turnover:
            turnoverBeat(lineup)
        case .foul, .violation:
            whistleBeat(lineup)
        case .jumpBall:
            jumpBallBeat()
        case .substitution:
            substitutionBeat(lineup, group: group.isEmpty ? [scene] : group)
        case .timeout:
            stoppageBeat(lineup, to: .benches)
        case .periodEnd:
            stoppageBeat(lineup, to: scene.final || scene.period == 2 ? .offCourt : .benches)
        case .challenge:
            reviewBeat(lineup)
        }
        sortLegs()
        // A whistle's tag says it; a ball play's stamp does (a free throw has both: its place in the trip, its result).
        let shows = !BasketballStamp(scene).parts.isEmpty
        if shows, script.stamp == .infinity, script.tag == nil { script.stamp = max(arrive + 0.3, over - 0.2, 0.9) }
        if !shows { script.stamp = .infinity }
        // A ball still bouncing after the shot doesn't hold the beat: the next one takes it from where it lies.
        if scene.isShot { over = min(over, arrive + (scene.kind == .freeThrow ? 0.8 : 1.4)) }
        let ends = [script.stamp.isFinite ? script.stamp + 0.9 : 0, over + 0.4, (script.flashes.map(\.at).max() ?? 0) + 0.7,
                    (script.tag?.at ?? 0) + 1.4]
        script.settle = max(ends.max() ?? 0, 1.2)
        if shows { measureStamp() }
        script.duration = script.settle + 0.2
        // The referee goes once it's called.
        for i in script.players.indices where script.players[i].team == .official {
            script.players[i].leaves = min(script.players[i].leaves, script.duration)
        }
        beatCamera()
    }

    // MARK: A miss

    /// A missed shot, from ESPN's spot: the ball to the shooter the way the
    /// floor gives it (off the dribble when he has it, else a pass as he
    /// gets there), the shot (a three's a three's arc), off the rim, and the
    /// rebound into the hands of the man the data credits.
    mutating func missBeat(_ lineup: Lineup?) {
        guard let scene else { return }
        // A live placeholder can come without a spot: a jumper from the top of the key, until ESPN says.
        let spot = Self.inbounds(Hoops.court(scene.spot ?? CGPoint(x: 25, y: 14)))
        let kind = scene.shot ?? scene.kind
        let close = [.layup, .dunk, .alleyOop, .putback].contains(kind) || Self.distance(spot, rim) < 3.5
        let offDribble = close || [.pullUp, .stepBack, .floater, .drive, .fadeaway, .turnaround, .hook].contains(scene.move)
        var passer: Int?
        if place(lineup) {
            let h = holder()
            let catcher = nearest(Array(0..<5).filter { $0 != h }, to: spot)
            // ESPN's plain "jump shot" misses say nothing of the pass: off one when he's far from the ball, off the dribble when it's his.
            let pull = Self.distance(position(h, 0), spot) < 10 || (offDribble && scene.typeID != 92 && scene.typeID != 282)
            let shooter = pull ? h : catcher
            trade(0, shooter)
            if !pull { passer = start?.holder ?? holder() }
            if passer == 0 { passer = nil }
        }
        if script.players.count >= 10, start != nil, Self.distance(position(0, 0), spot) > 30 {
            // Nobody near where ESPN says he shot (the floor had moved on): set up there fresh, as a cut.
            passer = nil
            script.players = []
        }
        if script.players.isEmpty {
            let o = out(spot), lateral = Self.unit(CGPoint(x: -o.y, y: o.x))
            let from = close ? Self.along(rim, approach(spot), 20) : offDribble ? Self.along(Self.along(spot, o, 6), lateral, 7 * random.sign()) : spot
            setUp([Self.inbounds(from)])
        }
        script.shooter = 0
        credit(0, scene.shooter)
        var t = 0.2
        if let p = passer {
            // Off the catch: the pass reaches him as he gets to his spot.
            hold(p, from: 0, until: t)
            let time = passTime(p, at: t, to: spot, style: .chest)
            move(0, to: [spot], from: max(t - 0.3, 0), to: t + time, ease: .out)
            t = pass(p, to: 0, at: t, point: spot, style: .chest)
            hold(0, from: t, until: .infinity)
            t += 0.2
        } else if close {
            // At the rim: downhill from where he is, up, off the rim.
            hold(0, from: 0, until: t)
            bounce(0, from: t, until: .infinity)
            let a = approach(Self.distance(position(0, t), rim) > 6 ? position(0, t) : spot)
            let takeoff = Self.along(rim, a, kind == .dunk ? 5.2 : 4.4)
            t = drive(0, to: takeoff, from: t, speed: 20, ease: .linear)
            script.legs[script.legs.count - 1].until = t
            hold(0, from: t, until: t + 0.3)
            move(0, to: [Self.along(rim, a, 1.2)], from: t, to: t + 0.62, ease: .linear)
            jump(0, from: t, peak: t + 0.31, until: t + 0.62, height: kind == .dunk ? 3.0 : 2.2)
            act(0, kind == .dunk ? .dunk : .layup, at: t + 0.31, toward: rim)
            script.release = t + 0.3
            let hand = FieldPoint(Self.along(rim, a, 1.6), z: kind == .dunk ? Hoops.rimHeight + 0.9 : 9.3)
            let c = Self.carom(missOf(scene))
            fly(from: hand, to: c.hit, start: t + 0.3, time: kind == .dunk ? 0.08 : 0.32, arc: kind == .dunk ? .straight : .arc(1.2))
            arrive = t + (kind == .dunk ? 0.38 : 0.62)
            helpAtRim(at: t + 0.31, approach: a)
            reboundOff(c, at: arrive, after: t + 0.3)
            // A dunk off the back iron shakes it.
            if kind == .dunk { script.rimStrength = 0.85 }
            boxOut(after: t + 0.3)
            stamp(at: arrive + 0.35)
            return
        } else {
            hold(0, from: 0, until: t)
            if Self.distance(position(0, t), spot) > 2 {
                bounce(0, from: t, until: .infinity)
                t = drive(0, to: spot, from: t, speed: Self.distance(position(0, t), spot) > 25 ? 21 : 15)
                script.legs[script.legs.count - 1].until = t
            }
            hold(0, from: t, until: .infinity)
            t += 0.1
        }
        // Up: the dip, the rise, the release just before the top.
        let three = scene.value == 3
        var lift = three ? 1.3 : 1.5, angle = Self.distance(spot, rim) > 18 ? 0.84 : 0.88
        var drift = 0.0
        switch scene.move {
        case .floater: (lift, angle) = (1.1, 1.02)
        case .hook: (lift, angle) = (0.9, 1.0)
        case .fadeaway: (lift, drift) = (1.6, 2.0)
        case .stepBack: drift = 0.6
        case .turnaround: (lift, drift) = (1.6, 0.8)
        default: break
        }
        if scene.typeID == 282 { (lift, angle) = (1.0, 0.7) }
        let takeoff = t + 0.1, airtime = 2 * (2 * lift / Self.g).squareRoot(), releaseAt = takeoff + airtime / 2 - 0.03
        if drift > 0 { move(0, to: [Self.along(position(0, takeoff), out(spot), drift)], from: takeoff, to: takeoff + airtime, ease: .linear) }
        jump(0, from: takeoff, peak: takeoff + airtime / 2, until: takeoff + airtime, height: lift)
        act(0, scene.move == .hook ? .hook : .shoot, at: releaseAt, toward: rim)
        if let last = script.legs.lastIndex(where: { $0.hand == .held(0) }) { script.legs[last].until = releaseAt }
        script.release = releaseAt
        let hand = release(position(0, releaseAt), lift: lift * 0.97)
        let c = Self.carom(missOf(scene))
        let flight = shoot(from: hand, to: c.hit, at: releaseAt, angle: angle)
        arrive = flight.end
        // His man closes out, a hand up as it goes.
        shadow(from: 0, to: arrive + 0.2, except: [5])
        let at = position(0, releaseAt)
        let contestAt = Self.along(at, Self.unit(CGPoint(x: rim.x - at.x, y: rim.y - at.y)), scene.move == .stepBack ? 4.4 : 3.0)
        move(5, to: [contestAt], from: max(releaseAt - 0.65, 0), to: releaseAt - 0.02, ease: .out)
        contest(5, at: releaseAt, toward: hand.ground, height: 1.0)
        reboundOff(c, at: arrive, after: releaseAt)
        boxOut(after: releaseAt)
        stamp(at: arrive + 0.35)
    }

    /// The scene's shot as the miss a rebound comes off (the rebound beat's carom is this one's).
    func missOf(_ scene: BasketballScene) -> BasketballScene.Miss {
        let kind = scene.shot ?? scene.kind
        return BasketballScene.Miss(spot: scene.spot ?? CGPoint(x: 25, y: 15), shooter: scene.shooter, value: scene.value,
                                    close: [.layup, .dunk, .alleyOop, .putback].contains(kind), id: scene.id, blocked: scene.result == .blocked,
                                    freeThrow: scene.kind == .freeThrow, distance: scene.kind == .freeThrow ? 14 : scene.distance)
    }

    /// The help comes over at the rim, a beat late.
    mutating func helpAtRim(at t: Double, approach: CGPoint) {
        let helper = nearest([6, 7, 8, 9], to: rim, at: t)
        move(helper, to: [Self.along(rim, Self.rotate(approach, approach.y >= 0 ? -0.5 : 0.5), 2.8)], from: max(t - 0.8, 0), to: t - 0.05)
        contestAtRim(helper, at: t, blocker: false)
        shadow(from: 0, to: t + 0.8, except: [helper, 5])
        trail(5, behind: 0, from: 0.2, to: t + 0.3, way: approach.negatedPoint)
    }

    /// Off the rim to the credited rebounder (his team's, by where he'd come
    /// from), or to the floor when nobody has it yet; a team rebound rolls
    /// out of bounds. The offense's guards get back; its bigs crash.
    mutating func reboundOff(_ c: Carom, at t: Double, after release: Double) {
        guard let scene else { return }
        let rebound = scene.rebound
        var r: Int?
        if let rebound, rebound.person != nil {
            let own = rebound.offensive && rebound.person?.id != nil && rebound.person?.id == scene.shooter?.id
            r = own ? 0 : rebounder(rebound.offensive ? [1, 2, 3, 4] : [5, 6, 7, 8, 9], toward: c.spot, role: rebound.person?.role, at: release)
            credit(r, rebound.person)
        }
        let caught = comeOff(c, at: t, to: r, from: release + 0.15)
        if let rebound, rebound.person == nil {
            // A team rebound: it went out (or the clock ran): out over the nearest line.
            outOfBounds(from: c.spot, at: caught + 0.3)
        }
        // Back on defense, or in for it.
        for k in 1..<5 where k != r {
            let here = position(k, release)
            if Self.distance(here, rim) > 18 {
                move(k, to: [CGPoint(x: here.x - 7, y: here.y + (25 - here.y) * 0.2)], from: release + 0.2, to: release + 1.4)
            } else if k != r {
                move(k, to: [Self.along(here, Self.unit(CGPoint(x: rim.x - here.x, y: rim.y - here.y)), 3)], from: release + 0.1, to: release + 0.8)
            }
        }
        _ = caught
    }

    /// The ball bouncing along the floor from `from` to `to` in `hops`
    /// bounces, each lower, never through the floor (the ball's center
    /// stays a radius up).
    mutating func hop(from: FieldPoint, to: FieldPoint, start: Double, time: Double, hops: Int) {
        let n = 30
        let high = from.z > 1
        let points = (0...n).map { k -> FieldPoint in
            let u = Double(k) / Double(n)
            let g = CGPoint(x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u)
            // Down from where it starts (or up off the floor), then each hop a little lower; into where it ends.
            let phase = u * Double(max(hops, 1))
            let hop = min(Int(phase), max(hops, 1) - 1), f = phase - Double(hop)
            let top = max(from.z, 1.2) * pow(0.45, Double(hop))
            let z = hop == 0 && high ? 0.4 + (from.z - 0.4) * (1 - f * f) : 0.4 + (top - 0.4) * 4 * f * (1 - f)
            return FieldPoint(g, z: max(z, 0.4) + (to.z - 0.4) * u)
        }
        fly(from: from, to: to, start: start, time: time, arc: .samples(points))
    }

    /// The ball rolls from `p` out over the nearest line, at `t`.
    mutating func outOfBounds(from p: CGPoint, at t: Double) {
        let lines: [(Double, CGPoint)] = [(p.y, CGPoint(x: p.x, y: -2)), (Hoops.width - p.y, CGPoint(x: p.x, y: Hoops.width + 2)),
                                           (Hoops.length - p.x, CGPoint(x: Hoops.length + 2, y: p.y))]
        let out = lines.min { $0.0 < $1.0 }!.1
        script.legs.removeAll { $0.from >= t }
        hop(from: FieldPoint(p, z: 0.4), to: FieldPoint(out, z: 0.4), start: t, time: min(max(Self.distance(p, out) / 9, 0.5), 1.4), hops: 2)
        script.legs.append(BasketballScript.Leg(from: t + min(max(Self.distance(p, out) / 9, 0.5), 1.4), until: .infinity,
                                                hand: .spot(FieldPoint(out, z: 0.4))))
        over = max(over, t + 1)
    }

    /// The stamp lands at `t` (MISS, REB, STL), unless a whistle's tag says it instead.
    mutating func stamp(at t: Double) { script.stamp = t }

    // MARK: A free throw

    /// One free throw, as it comes: both teams on the lane (or still on it
    /// from the last), the shooter at the line with his own routine (how
    /// many dribbles, how long he holds it: his, every trip), the shot, and
    /// through the net (a swish, or in off the rim) or off it; a trip's last
    /// miss is live, the lane crashing as it leaves his hand, and comes down
    /// to the man the data credits.
    mutating func freeThrowBeat(_ lineup: Lineup?) {
        guard let scene else { return }
        script.formation = .lane
        let line = CGPoint(x: Hoops.freeThrow - 0.6, y: 25)
        let last = (scene.attempt ?? 1) >= (scene.attempts ?? 1)
        if !place(lineup, allowed: [.lane]) {
            laneUp()
        }
        // The shooter is the one at the line.
        trade(0, nearest(Array(0..<5), to: line))
        // His routine: seeded by him, so it's the same every trip.
        var routine = SplitMix64(seed: Celebration.seed("routine·" + (scene.shooter?.id ?? scene.shooter?.name ?? scene.id)))
        let dribbles = Int(routine.in(1...3.99))
        let breath = routine.in(0.1...0.4)
        let spin = routine.next() % 3 == 0
        var t = 0.3
        hold(0, from: 0, until: t)
        bounce(0, from: t, until: t + Double(dribbles) * 0.42)
        t += Double(dribbles) * 0.42
        hold(0, from: t, until: .infinity)
        if spin { t += 0.25 }
        t += breath
        let releaseAt = t + 0.35
        jump(0, from: releaseAt - 0.15, peak: releaseAt + 0.03, until: releaseAt + 0.2, height: 0.25)
        act(0, .shoot, at: releaseAt, toward: rim)
        if let i = script.legs.lastIndex(where: { $0.hand == .held(0) }) { script.legs[i].until = releaseAt }
        script.release = releaseAt
        script.shooter = 0
        credit(0, scene.shooter)
        let hand = release(line, lift: 0.2)
        tag("FREE THROW \(scene.attempt ?? 1) OF \(scene.attempts ?? 1)", scene.offense, at: 0)
        let lane = Array(1..<10)
        if scene.made {
            // A swish, or in off the front of the rim.
            let rattle = Celebration.seed(scene.id) % 4 == 0
            if rattle {
                let kiss = FieldPoint(Self.along(rim, CGPoint(x: -1, y: 0), 0.55), z: Hoops.rimHeight + 0.1)
                let f = shoot(from: hand, to: kiss, at: releaseAt, angle: 0.9)
                script.rimHit = f.end
                script.rimStrength = 0.2
                script.flashes.append(Flash(beat: .rim, at: f.end, point: kiss))
                fly(from: kiss, to: Self.rimPoint, start: f.end, time: 0.22, arc: .arc(0.5))
                throughNet(at: f.end + 0.22, way: CGPoint(x: 1, y: 0), strength: 0.35)
                arrive = f.end + 0.22
            } else {
                let f = shoot(from: hand, to: Self.rimPoint, at: releaseAt, angle: 0.92)
                throughNet(at: f.end, way: CGPoint(x: 1, y: 0), strength: 0.5)
                arrive = f.end
            }
            if !last {
                // The referee in under the basket to take it for the next one, and gone with it.
                let official = laneOfficial(from: arrive - 0.6)
                walk(official, to: [CGPoint(x: 93.2, y: 25 + (position(official, 0).y > 25 ? 2.5 : -2.5))], from: arrive, to: arrive + 0.7, ease: .out)
                script.players[official].leaves = arrive + 1.2
            }
        } else {
            let c = Self.carom(missOf(scene))
            let f = shoot(from: hand, to: c.hit, at: releaseAt, angle: 0.9)
            arrive = f.end
            if last {
                var r: Int?
                if let rebound = scene.rebound, rebound.person != nil {
                    r = rebounder(rebound.offensive ? [1, 2, 3, 4] : [5, 6, 7, 8, 9], toward: c.spot, role: rebound.person?.role, at: releaseAt)
                    credit(r, rebound.person)
                }
                comeOff(c, at: f.end, to: r, from: releaseAt + 0.05)
            } else {
                comeOff(c, at: f.end, to: nil, from: releaseAt)
            }
        }
        if last {
            // In as it leaves his hand: the defense boxes out, the offense goes for it.
            for k in lane where k < 10 && script.players[k].actions.allSatisfy({ $0.kind != .rebound && $0.kind != .catchBall }) {
                let here = position(k, releaseAt)
                guard Self.distance(here, rim) < 20 else { continue }
                let inward = Self.unit(CGPoint(x: rim.x - here.x, y: rim.y - here.y))
                move(k, to: [Self.along(here, inward, k >= 5 ? 1.6 : 2.6)], from: releaseAt + 0.02, to: releaseAt + 0.5, ease: .out)
                if k >= 5 { act(k, .boxOut, at: releaseAt + 0.3, toward: rim) }
            }
        } else {
            // Nothing's live: hands on hips, waiting.
            for k in lane where k < 10 { act(k, .hips, at: 0, toward: line) }
        }
        script.look = BasketballScript.Look(point: line, from: 0)
        stamp(at: arrive + 0.3)
    }

    /// Both teams on the lane for free throws: the defense in the spaces
    /// nearest the basket and the third, the offense in the second, the rest
    /// behind the arc; the shooter at the line.
    mutating func laneUp() {
        let line = CGPoint(x: Hoops.freeThrow - 0.6, y: 25)
        let ours = [line, CGPoint(x: 81.5, y: 33.8), CGPoint(x: 81.5, y: 16.2), CGPoint(x: 66, y: 39), CGPoint(x: 66, y: 11)]
        let theirs = [CGPoint(x: 63.5, y: 26), CGPoint(x: 84.5, y: 33.8), CGPoint(x: 84.5, y: 16.2), CGPoint(x: 78.5, y: 33.8), CGPoint(x: 78.5, y: 16.2)]
        script.players = ours.map { Player(team: .offense, at: $0) } + theirs.map { Player(team: .defense, at: $0) }
        start = Lineup(offense: offense, at: ours + theirs, holder: 0, ball: nil, formation: .lane)
    }

    /// The lead referee under the basket for free throws, on the floor from `from`.
    mutating func laneOfficial(from: Double = -1) -> Int {
        var ref = Player(team: .official, at: CGPoint(x: 95.2, y: 21))
        ref.enters = from
        script.players.append(ref)
        return script.players.count - 1
    }

    // MARK: A rebound

    /// A rebound that came in after its miss had been told: the ball off
    /// the rim where the miss sent it (still bouncing where it lay, when it
    /// had come down), into the hands of the man the data credits.
    mutating func reboundBeat(_ lineup: Lineup?) {
        guard let scene else { return }
        let miss = scene.miss ?? BasketballScene.Miss(spot: scene.spot ?? CGPoint(x: 25, y: 12), shooter: nil, value: 2, close: false, id: scene.id)
        let c = Self.carom(miss)
        let shooterSide = scene.kind == .offensiveRebound
        if !place(lineup) {
            setUp([Self.inbounds(Hoops.court(miss.freeThrow ? CGPoint(x: 25, y: 15) : miss.spot))])
        }
        script.formation = .play
        let pool = shooterSide ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9]
        let r = scene.shooter == nil ? nil : rebounder(pool, toward: c.spot, role: scene.shooter?.role, at: 0)
        credit(r, scene.shooter)
        if let lying = start?.ball, start?.holder == nil, let r, Self.distance(position(r, 0), lying) < 24 {
            // Where it came down: he gets to it and takes it up.
            script.legs = [BasketballScript.Leg(from: 0, until: .infinity, hand: .spot(FieldPoint(lying, z: 0.4)))]
            let at = position(r, 0), time = max(Self.distance(at, lying) / 16, 0.35)
            move(r, to: [Self.along(lying, Self.unit(CGPoint(x: at.x - lying.x, y: at.y - lying.y)), 0.8)], from: 0.1, to: 0.1 + time, ease: .out)
            let caught = 0.1 + time
            fly(from: FieldPoint(lying, z: 0.4), to: FieldPoint(position(r, caught), z: 4.2), start: caught - 0.05, time: 0.18, arc: .straight)
            act(r, .catchBall, at: caught + 0.1, toward: lying)
            hold(r, from: caught + 0.13, until: .infinity)
            script.flashes.append(Flash(beat: .catchBall, at: caught + 0.13, point: FieldPoint(lying, z: 4.2)))
            over = caught + 0.5
            arrive = caught
        } else {
            arrive = comeOff(c, at: 0.25, to: r, from: 0.1)
            if r == nil { outOfBounds(from: c.spot, at: arrive + 0.4) }
        }
        boxOut(after: 0)
        stamp(at: arrive + 0.15)
    }

    // MARK: A turnover

    /// A turnover by its kind, at ESPN's spot: a pass picked off by the man
    /// who stole it, a ball poked loose, a pass or a dribble gone out of
    /// bounds, a travel (a whistle), an offensive foul's contact.
    mutating func turnoverBeat(_ lineup: Lineup?) {
        guard let scene else { return }
        let spot = scene.spot.map { Self.inbounds(Hoops.court($0)) } ?? CGPoint(x: 66, y: 25)
        place(lineup, near: spot)
        let h = holder()
        trade(0, h)
        let call = scene.call ?? .other("TURNOVER")
        var stealer: Int?
        if scene.kind == .steal {
            trade(5, nearest(Array(5..<10), to: spot))
            stealer = 5
        }
        credit(0, scene.shooter)
        credit(stealer, scene.steal?.stealer)
        let name = Self.called(scene.shooter)
        switch call {
        case .badPass where stealer != nil:
            // A pass into the lane he jumps: picked off where ESPN put it.
            let target = Self.along(spot, Self.unit(CGPoint(x: spot.x - position(0, 0).x, y: spot.y - position(0, 0).y)), 9)
            let receiver = nearest([1, 2, 3, 4], to: target)
            move(receiver, to: [Self.inbounds(target)], from: 0, to: 0.8)
            hold(0, from: 0, until: 0.35)
            let d = Self.distance(position(0, 0.35), spot), time = min(max(d / 38, 0.2), 0.6)
            fly(from: FieldPoint(Self.along(position(0, 0.35), Self.unit(CGPoint(x: spot.x - position(0, 0.35).x, y: spot.y - position(0, 0.35).y)), 0.8), z: 4.6),
                to: FieldPoint(spot, z: 4.4), start: 0.35, time: time, arc: .arc(0.6))
            act(0, .pass, at: 0.35, toward: spot)
            let takeAt = 0.35 + time
            move(5, to: [Self.along(spot, out(spot), -0.6)], from: 0.15, to: takeAt, ease: .out)
            act(5, .steal, at: takeAt, toward: spot)
            script.flashes.append(Flash(beat: .steal, at: takeAt, point: FieldPoint(spot, z: 3)))
            pickOff(5, at: takeAt)
            arrive = takeAt
            stamp(at: takeAt + 0.3)
        case .lostBall, .badPass:
            // Poked loose (or off his knee), a few feet, and gathered.
            hold(0, from: 0, until: 0.15)
            bounce(0, from: 0.15, until: 0.75)
            let way = Self.unit(CGPoint(x: spot.x - position(0, 0).x + 0.01, y: spot.y - position(0, 0).y))
            move(0, to: [spot], from: 0.15, to: 0.75, ease: .inOut)
            let taker = stealer ?? nearest(Array(5..<10), to: spot, at: 0.75)
            move(taker, to: [Self.along(spot, Self.rotate(way, 0.9), 2.2)], from: 0.2, to: 0.75, ease: .out)
            if stealer != nil { act(taker, .steal, at: 0.75, toward: spot) }
            let loose = Self.inbounds(Self.along(spot, Self.rotate(way, random.in(-1.2...1.2)), random.in(4...7)))
            hop(from: FieldPoint(spot, z: 1.2), to: FieldPoint(loose, z: 1.0), start: 0.75, time: 0.5, hops: 2)
            script.flashes.append(Flash(beat: .steal, at: 0.75, point: FieldPoint(spot, z: 1.5)))
            move(taker, to: [Self.along(loose, Self.rotate(way, 0.6), 0.7)], from: 0.8, to: 1.25, ease: .out)
            move(0, to: [Self.along(spot, way, 1.5)], from: 0.75, to: 1.2, ease: .out)
            fly(from: FieldPoint(loose, z: 1.0), to: FieldPoint(position(taker, 1.3), z: 4.2), start: 1.25, time: 0.12, arc: .straight)
            act(taker, .catchBall, at: 1.37, toward: loose)
            hold(taker, from: 1.37, until: .infinity)
            pickOff(taker, at: 1.37)
            arrive = 1.37
            stamp(at: 1.6)
        case .outOfBounds:
            // Out over the nearest line: a pass that sails, a dribble that gets away.
            let lines: [(Double, CGPoint)] = [(spot.y, CGPoint(x: spot.x, y: -2.5)), (Hoops.width - spot.y, CGPoint(x: spot.x, y: Hoops.width + 2.5)),
                                               (Hoops.length - spot.x, CGPoint(x: Hoops.length + 2.5, y: spot.y))]
            let out = lines.min { $0.0 < $1.0 }!.1
            hold(0, from: 0, until: 0.3)
            let passed = scene.typeID == 90
            if passed {
                act(0, .pass, at: 0.3, toward: out)
                fly(from: FieldPoint(position(0, 0.3), z: 4.6), to: FieldPoint(out, z: 2.5), start: 0.3,
                    time: min(max(Self.distance(position(0, 0.3), out) / 34, 0.35), 0.9), arc: .arc(1.2))
            } else {
                bounce(0, from: 0.3, until: 0.8)
                move(0, to: [spot], from: 0.3, to: 0.8)
                hop(from: FieldPoint(spot, z: 1.0), to: FieldPoint(out, z: 0.4), start: 0.8, time: 0.6, hops: 2)
            }
            let gone = script.legs.last.map(\.until) ?? 1
            script.legs.append(BasketballScript.Leg(from: gone, until: .infinity, hand: .spot(FieldPoint(out, z: 0.4))))
            let ref = whistle(at: gone + 0.05, spot: spot, signal: .point, toward: CGPoint(x: 0, y: 25))
            _ = ref
            freeze(at: gone + 0.1)
            tag(["OUT OF BOUNDS", name].compactMap { $0 }.joined(separator: " · "), scene.offense, at: gone + 0.05)
            arrive = gone
        case .offensive:
            chargeBeat(spot: spot, charge: false, tagged: name, side: scene.offense)
        case .offensiveGoaltending:
            // A shot up from the arc, touched on its way down by his own man at the rim.
            let shooter = nearest([1, 2, 3, 4], to: CGPoint(x: 68, y: 25))
            hold(0, from: 0, until: 0.25)
            let p = pass(0, to: shooter, at: 0.25, point: position(shooter, 0.6), style: .chest)
            hold(shooter, from: p, until: p + 0.3)
            act(shooter, .shoot, at: p + 0.3, toward: rim)
            let f = shoot(from: release(position(shooter, p + 0.3), lift: 1.4), to: FieldPoint(Self.along(rim, out(position(shooter, p)), -0.2), z: Hoops.rimHeight + 0.8),
                          at: p + 0.3, angle: 0.85)
            move(0, to: [Self.along(rim, CGPoint(x: -0.6, y: 0.8), 2.2)], from: 0.3, to: f.end - 0.4)
            jump(0, from: f.end - 0.35, peak: f.end, until: f.end + 0.35, height: 2.8)
            act(0, .tip, at: f.end, toward: rim)
            fly(from: script.flights[f.flight].to, to: FieldPoint(Self.along(rim, CGPoint(x: -1, y: 0.3), 6), z: 0.4), start: f.end, time: 0.6, arc: .arc(1))
            whistle(at: f.end + 0.15, spot: rim)
            freeze(at: f.end + 0.2)
            tag(["OFFENSIVE GOALTENDING", name].compactMap { $0 }.joined(separator: " · "), scene.offense, at: f.end + 0.15)
            arrive = f.end
        default:
            // A travel, a double dribble, three seconds, the shot clock: on the move at the spot, the whistle, the ball set down.
            hold(0, from: 0, until: 0.2)
            bounce(0, from: 0.2, until: 0.95)
            move(0, to: [spot], from: 0.2, to: 0.95)
            let at = 0.95
            hold(0, from: at, until: at + 0.6)
            whistle(at: at, spot: spot, signal: call == .traveling ? .signal : .point, toward: CGPoint(x: 0, y: 25))
            freeze(at: at + 0.05, except: [0])
            move(0, to: [Self.along(spot, out(spot), 1.2)], from: at, to: at + 0.5, ease: .out)
            hop(from: FieldPoint(spot, z: 4.4), to: FieldPoint(Self.along(spot, CGPoint(x: -1, y: 0), 3), z: 0.4), start: at + 0.6, time: 0.5, hops: 2)
            script.legs.append(BasketballScript.Leg(from: at + 1.1, until: .infinity, hand: .spot(FieldPoint(Self.along(spot, CGPoint(x: -1, y: 0), 3), z: 0.4))))
            let words = call.words
            tag([words, call == .shotClock ? nil : name].compactMap { $0 }.joined(separator: " · "), scene.offense, at: at)
            arrive = at
        }
        if script.tag == nil, script.stamp == .infinity { stamp(at: arrive + 0.3) }
        if script.tag != nil { script.stamp = .infinity }
    }

    /// He has it, and turns up the floor the other way: the start of the break.
    mutating func pickOff(_ i: Int, at t: Double) {
        hold(i, from: t, until: .infinity)
        let here = position(i, t)
        move(i, to: [CGPoint(x: here.x - 5, y: here.y + (25 - here.y) * 0.25)], from: t + 0.15, to: t + 0.75, ease: .inOut)
        over = max(over, t + 0.75)
        // The man who lost it turns to chase.
        let loser = position(0, t)
        move(0, to: [CGPoint(x: loser.x - 2.5, y: loser.y)], from: t + 0.1, to: t + 0.7, ease: .out)
    }

    /// An offensive foul: the man with the ball drives into a defender set
    /// at ESPN's spot (a charge puts him on the floor; a push-off shoves him
    /// back), the whistle, the call.
    mutating func chargeBeat(spot: CGPoint, charge: Bool, tagged name: String?, side: GameDetail.Side?) {
        let d = nearest(Array(5..<10), to: spot)
        trade(5, d)
        credit(0, scene?.shooter)
        credit(5, scene?.drew)
        hold(0, from: 0, until: 0.2)
        bounce(0, from: 0.2, until: .infinity)
        let way = Self.unit(CGPoint(x: spot.x - position(0, 0).x + 0.01, y: spot.y - position(0, 0).y))
        let meet = Self.along(spot, way, -1.4)
        let hit = drive(0, to: meet, from: 0.2, speed: 17, ease: .linear)
        script.legs[script.legs.count - 1].until = hit
        hold(0, from: hit, until: .infinity)
        // The defender beats him there and sets.
        move(5, to: [Self.along(spot, way, 0.3)], from: 0.1, to: max(hit - 0.3, 0.3), ease: .out)
        act(0, .reach, at: hit, toward: spot)
        let knocked = Self.along(spot, way, charge ? 2.4 : 2.0)
        move(5, to: [knocked], from: hit, to: hit + 0.35, ease: .out)
        act(5, charge ? .fall : .reach, at: hit + 0.1, toward: position(0, hit))
        move(0, to: [Self.along(meet, way, 0.8)], from: hit, to: hit + 0.3, ease: .out)
        whistle(at: hit + 0.12, spot: spot, signal: charge ? .fall : .signal, toward: CGPoint(x: 0, y: 25))
        freeze(at: hit + 0.2, except: [0, 5])
        tag([charge ? "CHARGE" : "OFFENSIVE FOUL", name].compactMap { $0 }.joined(separator: " · "), side, at: hit + 0.12)
        arrive = hit
        over = max(over, hit + 1.4)
    }

    // MARK: A whistle

    /// A foul or a violation at ESPN's spot: the man it was on (the one with
    /// the ball, or nearest it) and the man who did it, the contact the call
    /// says (a hand on a shooter, a reach on the dribble, both diving for a
    /// loose ball, a hard foul that puts him down), the referee's whistle,
    /// and the tag (SHOOTING FOUL · HAYES).
    mutating func whistleBeat(_ lineup: Lineup?) {
        guard let scene, let call = scene.call else { return }
        let name = Self.called(scene.shooter)
        let words = [call.words, name].compactMap { $0 }.joined(separator: " · ")
        var spot = scene.spot.map { Self.inbounds(Hoops.court($0)) } ?? CGPoint(x: 68, y: 25)
        if scene.spot == nil, place(lineup) {
            // No spot from ESPN (a kicked ball, goaltending): where the ball is.
            spot = position(holder(), 0)
        } else {
            place(lineup, near: spot)
        }
        if call == .offensive || call == .charge {
            trade(0, holder())
            chargeBeat(spot: spot, charge: call == .charge, tagged: name, side: scene.offense)
            return
        }
        if call == .technical || call == .delay || scene.ball == nil {
            // Nothing on the floor: the whistle, a T.
            let h = holder()
            hold(h, from: 0, until: .infinity)
            let at = 0.4
            whistle(at: at, spot: spot == CGPoint(x: 68, y: 25) ? position(h, 0) : spot, signal: .signal)
            tag(words, scene.offense, at: at)
            over = at + 1
            return
        }
        // The man it was on: the one with the ball (or nearest the spot), there by the contact.
        let h = holder()
        let fouled = Self.distance(position(h, 0), spot) < 14 || call == .shooting ? h : nearest(Array(0..<5), to: spot)
        trade(0, fouled)
        let fouler = nearest(Array(5..<10), to: spot, at: 0.6)
        trade(5, fouler)
        credit(0, scene.drew)
        credit(5, scene.shooter)
        let carrying = start?.holder == 0
        let contact = max(0.75, min(Self.distance(position(0, 0), spot) / 15 + 0.35, 1.3))
        if carrying {
            hold(0, from: 0, until: 0.15)
            bounce(0, from: 0.15, until: contact)
        } else {
            hold(holder(), from: 0, until: .infinity)
        }
        move(0, to: [spot], from: 0.1, to: contact, ease: .inOut)
        let at = position(0, contact)
        let toward = Self.unit(CGPoint(x: rim.x - at.x, y: rim.y - at.y))
        move(5, to: [Self.along(spot, toward, 1.9)], from: 0.1, to: contact - 0.05, ease: .out)
        switch call {
        case .shooting:
            // Up into the shot, hit on the arm: it comes off short, no basket.
            if carrying { hold(0, from: contact, until: contact + 0.32) }
            let close = Self.distance(spot, rim) < 7
            jump(0, from: contact, peak: contact + 0.3, until: contact + 0.6, height: close ? 2.0 : 1.4)
            act(0, close ? .layup : .shoot, at: contact + 0.3, toward: rim)
            contest(5, at: contact + 0.3, toward: at, height: 1.3)
            act(5, .reach, at: contact + 0.32, toward: at)
            if carrying {
                let hand = release(at, lift: close ? 2.0 : 1.4)
                fly(from: hand, to: FieldPoint(Self.along(rim, toward, -2.2), z: 7.5), start: contact + 0.32, time: 0.6, arc: .arc(2))
                dropToFloor(from: FieldPoint(Self.along(rim, toward, -2.2), z: 7.5), at: contact + 0.92, drift: CGPoint(x: -toward.x * 3, y: -toward.y * 3), downward: 6, hops: 1)
            }
            whistle(at: contact + 0.38, spot: spot)
            freeze(at: contact + 0.7, except: [0])
        case .looseBall:
            // The ball gets away from him; both go for it.
            let loose = Self.inbounds(Self.along(spot, toward, -3))
            if carrying {
                hop(from: FieldPoint(at, z: 1.4), to: FieldPoint(loose, z: 0.4), start: contact, time: 0.45, hops: 2)
                script.legs.append(BasketballScript.Leg(from: contact + 0.45, until: .infinity, hand: .spot(FieldPoint(loose, z: 0.4))))
            }
            move(0, to: [Self.along(loose, toward, 1)], from: contact, to: contact + 0.45, ease: .out)
            move(5, to: [Self.along(loose, toward, -1)], from: contact, to: contact + 0.45, ease: .out)
            act(0, .steal, at: contact + 0.4, toward: loose)
            act(5, .reach, at: contact + 0.45, toward: position(0, contact + 0.45))
            whistle(at: contact + 0.55, spot: loose)
            freeze(at: contact + 0.7, except: [0, 5])
        case .goaltending:
            // A shot from the spot, swatted on its way down over the rim: the basket counts.
            if carrying { hold(0, from: contact, until: contact + 0.3) }
            act(0, .shoot, at: contact + 0.3, toward: rim)
            jump(0, from: contact, peak: contact + 0.3, until: contact + 0.6, height: 1.4)
            let f = carrying ? shoot(from: release(at, lift: 1.4), to: FieldPoint(Self.along(rim, toward, -0.6), z: Hoops.rimHeight + 0.9),
                                     at: contact + 0.32, angle: 0.95) : nil
            let up = f?.end ?? contact + 1.1
            move(5, to: [Self.along(rim, toward, -1.6)], from: contact + 0.2, to: up - 0.35)
            jump(5, from: up - 0.35, peak: up, until: up + 0.4, height: 3.0)
            act(5, .block, at: up, toward: rim)
            if let f {
                fly(from: script.flights[f.flight].to, to: FieldPoint(Self.along(rim, toward, -9), z: 2), start: up, time: 0.5, arc: .arc(0.8))
                dropToFloor(from: FieldPoint(Self.along(rim, toward, -9), z: 2), at: up + 0.5, drift: CGPoint(x: -toward.x * 5, y: -toward.y * 5), downward: 8, hops: 1)
            }
            script.flashes.append(Flash(beat: .block, at: up, point: FieldPoint(Self.along(rim, toward, -0.6), z: Hoops.rimHeight + 0.9)))
            whistle(at: up + 0.12, spot: rim)
            freeze(at: up + 0.4, except: [5])
            spot = rim
        case .kickedBall:
            // A pass that hits his foot.
            let mate = nearest(Array(1..<5), to: Self.along(spot, toward, -6))
            if carrying { hold(0, from: contact, until: contact + 0.15) }
            act(0, .pass, at: contact + 0.15, toward: position(mate, contact))
            let foot = Self.along(position(5, contact + 0.3), toward, -0.4)
            if carrying {
                fly(from: FieldPoint(at, z: 4.4), to: FieldPoint(foot, z: 0.8), start: contact + 0.15, time: 0.2, arc: .straight)
                hop(from: FieldPoint(foot, z: 0.8), to: FieldPoint(Self.along(foot, toward, -4), z: 0.4), start: contact + 0.35, time: 0.4, hops: 1)
                script.legs.append(BasketballScript.Leg(from: contact + 0.75, until: .infinity, hand: .spot(FieldPoint(Self.along(foot, toward, -4), z: 0.4))))
            }
            whistle(at: contact + 0.4, spot: foot)
            freeze(at: contact + 0.5)
        default:
            // A reach on the dribble, a hold, a hard foul.
            if carrying { hold(0, from: contact, until: .infinity) }
            act(5, .reach, at: contact, toward: at)
            let hard = call == .flagrant
            move(0, to: [Self.along(at, toward, hard ? 1.6 : 0.9)], from: contact, to: contact + 0.35, ease: .out)
            if hard { act(0, .fall, at: contact + 0.12, toward: position(5, contact)) }
            whistle(at: contact + 0.15, spot: spot)
            freeze(at: contact + 0.4, except: hard ? [0] : [])
        }
        tag(words, scene.offense, at: (script.flashes.last { $0.beat == .whistle }?.at ?? contact))
        arrive = contact
        over = max(over, contact + 1.1)
    }

    // MARK: A jump ball

    /// The tip at center court: the two men ESPN names in the circle (the
    /// team that came up with it at the near side of it), the rest round it,
    /// the referee's toss, both up, and the tip to the man who gained it.
    mutating func jumpBallBeat() {
        guard let scene else { return }
        let c = CGPoint(x: Hoops.length / 2, y: Hoops.width / 2)
        func round(_ a: Double, _ r: Double) -> CGPoint { CGPoint(x: c.x + r * cos(a), y: c.y + r * sin(a)) }
        let ours = [round(.pi, 1.5), round(0.35 * .pi, 8.5), round(-0.35 * .pi, 8.5), round(0.8 * .pi, 9), CGPoint(x: 31, y: 25)]
        let theirs = [round(0, 1.5), round(0.62 * .pi, 8.5), round(-0.62 * .pi, 8.5), round(-0.8 * .pi, 9), CGPoint(x: 64, y: 25)]
        script.players = ours.map { Player(team: .offense, at: $0) } + theirs.map { Player(team: .defense, at: $0) }
        script.formation = .center
        var ref = Player(team: .official, at: CGPoint(x: c.x, y: c.y - 2.4))
        ref.enters = -1
        script.players.append(ref)
        let official = script.players.count - 1
        // The toss: up from his hands to a little over their reach, the tip on the way down.
        let toss = 0.55, top = toss + 0.62, tip = top + 0.12
        script.legs.append(BasketballScript.Leg(from: 0, until: toss, hand: .held(official)))
        fly(from: FieldPoint(c, z: 5), to: FieldPoint(c, z: 13.2), start: toss, time: top - toss, arc: .straight)
        fly(from: FieldPoint(c, z: 13.2), to: FieldPoint(c, z: 12.4), start: top, time: tip - top, arc: .straight)
        act(official, .toss, at: toss, toward: c)
        walk(official, to: [CGPoint(x: c.x, y: c.y - 6)], from: toss + 0.1, to: toss + 0.9)
        // Out of the circle, and gone.
        script.players[official].leaves = toss + 1.2
        for j in [0, 5] {
            jump(j, from: tip - 0.36, peak: tip, until: tip + 0.4, height: 2.6)
            act(j, .tip, at: tip, toward: c)
        }
        // To the man who gained it: the teammate ahead of the circle.
        let gainer = nearest([1, 2], to: CGPoint(x: c.x + 9, y: c.y))
        let catchAt = Self.along(position(gainer, tip), CGPoint(x: -1, y: 0), 1)
        fly(from: FieldPoint(c, z: 12.4), to: FieldPoint(catchAt, z: 4.6), start: tip, time: 0.55, arc: .arc(1.2))
        move(gainer, to: [catchAt], from: tip, to: tip + 0.5, ease: .out)
        act(gainer, .catchBall, at: tip + 0.55, toward: c)
        credit(gainer, scene.winner)
        hold(gainer, from: tip + 0.55, until: .infinity)
        script.flashes.append(Flash(beat: .catchBall, at: tip + 0.55, point: FieldPoint(catchAt, z: 4.6)))
        script.look = BasketballScript.Look(point: c, from: 0)
        let opening = scene.clock == "12:00" || scene.clock == "5:00"
        tag([opening ? "TIP-OFF" : "JUMP BALL", Self.called(scene.winner)].compactMap { $0 }.joined(separator: " · "), scene.offense, at: 0)
        arrive = tip + 0.55
        over = tip + 1.1
    }

    // MARK: Substitutions

    /// A quick tag (SUB · HARPER IN), and the change on the floor: for each,
    /// the man of that team nearest his bench jogs off and fades as he goes,
    /// the man coming in jogs on from the bench to where he stood.
    mutating func substitutionBeat(_ lineup: Lineup?, group: [BasketballScene]) {
        let placed = place(lineup, allowed: [.play, .lane, .center])
        if !placed {
            if let lineup, lineup.at.count == 10 {
                // At the benches (or off the floor): the floor stays as it was; the tag says it.
                _ = place(lineup, allowed: [.benches, .offCourt])
                script.formation = lineup.formation
                hideAll(lineup.formation == .offCourt)
            } else {
                setUp([CGPoint(x: 62, y: 25)])
            }
        } else {
            script.formation = start?.formation ?? .play
        }
        if let h = start?.holder ?? (placed ? nil : 0) { hold(h, from: 0, until: .infinity) } else if let ball = start?.ball {
            script.legs = [BasketballScript.Leg(from: 0, until: .infinity, hand: .spot(FieldPoint(ball, z: 0.4)))]
        }
        var used = Set<Int>()
        if placed {
            for (k, sub) in group.prefix(3).enumerated() {
                guard let team = sub.offense else { continue }
                let pool = team == side(.offense) ? Array(0..<5) : Array(5..<10)
                let bench = huddle(team == side(.offense) ? .offense : .defense)[2]
                let candidates = pool.filter { !used.contains($0) && $0 != start?.holder }
                guard let off = candidates.min(by: { Self.distance(position($0, 0), bench) < Self.distance(position($1, 0), bench) }) else { continue }
                used.insert(off)
                let at = position(off, 0)
                let lag = Double(k) * 0.18
                let toward = Self.unit(CGPoint(x: bench.x - at.x, y: bench.y - at.y))
                walk(off, to: [Self.along(at, toward, min(9, Self.distance(at, bench)))], from: 0.15 + lag, to: 1.15 + lag)
                script.players[off].leaves = 1.15 + lag
                var on = Player(team: script.players[off].team, at: Self.along(at, toward, min(12, Self.distance(at, bench))))
                on.enters = 0.45 + lag
                on.move(to: [at], from: 0.55 + lag, to: 1.55 + lag, ease: .out)
                script.players.append(on)
                script.stand[off] = script.players.count - 1
                credit(off, sub.subOut)
                credit(script.players.count - 1, sub.subIn)
            }
        }
        let names = group.compactMap { Self.called($0.subIn) }
        let teams = Set(group.compactMap(\.offense))
        let who = names.count > 2 ? names.prefix(2).joined(separator: ", ") + " +\(names.count - 2)" : names.joined(separator: ", ")
        tag("\(group.count > 1 ? "SUBS" : "SUB")\(who.isEmpty ? "" : " · \(who) IN")", teams.count == 1 ? teams.first : nil, at: 0)
        over = used.isEmpty ? 1.0 : 1.7 + Double(min(group.count, 3) - 1) * 0.18
    }

    /// Nobody to see (the floor empty at the half).
    mutating func hideAll(_ hidden: Bool) {
        guard hidden else { return }
        for i in script.players.indices { script.players[i].leaves = -1 }
        script.legs = []
    }

    // MARK: Stoppages

    /// A timeout or the end of a period: the whistle (the horn and the
    /// backboards' red at the end of a period), the tag, and everyone
    /// starting for the benches (or, at the half and at the end, off the
    /// floor); the court between plays walks them the rest of the way.
    mutating func stoppageBeat(_ lineup: Lineup?, to formation: Lineup.Formation) {
        guard let scene else { return }
        let placed = place(lineup, allowed: [.play, .lane, .center, .benches])
        if !placed { setUp([CGPoint(x: 62, y: 25)]) }
        let h = start?.holder ?? 0
        let ball = start?.holder == nil ? start?.ball : nil
        if let ball { script.legs = [BasketballScript.Leg(from: 0, until: .infinity, hand: .spot(FieldPoint(ball, z: 0.4)))] }
        else { hold(h, from: 0, until: .infinity) }
        let call = 0.3
        if scene.kind == .timeout {
            whistle(at: call, spot: position(h, 0), signal: .signal)
        } else {
            script.flashes.append(Flash(beat: .horn, at: call, point: Self.rimPoint))
        }
        tag(Self.stoppageWords(scene), scene.kind == .timeout ? scene.offense : nil, at: call)
        script.formation = formation
        headOff(from: call + 0.35, formation: formation)
        over = call + 1.6
    }

    /// Everyone sets off for his bench (or the tunnel), walking.
    mutating func headOff(from t: Double, formation: Lineup.Formation) {
        let ours = huddle(.offense), theirs = huddle(.defense)
        for i in 0..<min(script.players.count, 10) where script.players[i].team != .official {
            let goal = formation == .offCourt ? framed(CGPoint(x: 47 + Double(i % 5 - 2) * 1.5, y: -9)) : (i < 5 ? ours[i] : theirs[i - 5])
            let here = position(i, t)
            let d = Self.distance(here, goal)
            walk(i, to: [goal], from: t + Double(i % 5) * 0.06, to: t + max(d / 9, 0.6), ease: .inOut)
        }
    }

    /// A stoppage's words: TIMEOUT · JAZZ, END OF 3RD, HALFTIME, END OF REGULATION, FINAL.
    static func stoppageWords(_ scene: BasketballScene, team: String? = nil) -> String {
        switch scene.kind {
        case .timeout:
            if let stoppage = scene.stoppage { return stoppage }
            let who = team ?? scene.text.firstMatch(of: #/^(.+?) (?:Full|Short|full|short|20 Sec\.?|Official)? ?timeout/#).map { String($0.1).uppercased() }
            return ["TIMEOUT", who].compactMap { $0 }.joined(separator: " · ")
        case .periodEnd:
            return BasketballStatus.periodWords(scene.period ?? 1, final: scene.final, tied: scene.top == scene.bottom)
        default:
            return ""
        }
    }

    /// A coach's challenge or a review: the referee to the table, the
    /// monitor, the ruling (overturned: waved off; the call stands: as it was).
    mutating func reviewBeat(_ lineup: Lineup?) {
        guard let scene else { return }
        let placed = place(lineup, allowed: [.play, .lane, .center, .benches])
        if !placed { setUp([CGPoint(x: 62, y: 25)]) }
        script.formation = start?.formation ?? .play
        if let h = start?.holder { hold(h, from: 0, until: .infinity) }
        let table = CGPoint(x: Hoops.length / 2, y: offNear(2.2))
        var ref = Player(team: .official, at: CGPoint(x: table.x + 7, y: offNear(0.8)))
        ref.enters = -0.5
        ref.move(to: [table], from: 0.1, to: 1.0, ease: .out)
        if let out = scene.overturned { ref.act(out ? .point : .signal, at: 1.5, toward: CGPoint(x: table.x, y: 25)) }
        script.players.append(ref)
        script.look = BasketballScript.Look(point: table, from: 0.4)
        tag(BasketballStatus.reviewWords(scene, team: nil), scene.offense, at: 0)
        over = 2.2
    }

    // MARK: The beat's camera

    /// The ball and everyone near it, the rim while the ball's at it, the
    /// referee once he's in; picked up from where the camera was when the
    /// last beat handed over (when it looked the same way), and the stamp's
    /// corner kept clear while it's up.
    mutating func beatCamera() {
        let script = self.script
        let rimRoom = script.room(Self.rimPoint, figure: false)
        let corner = script.stamp.isFinite ? CGSize(width: script.corner.width + 0.03, height: script.corner.height + 0.04) : .zero
        let end = script.settle
        func rooms(_ t: Double, all: Bool) -> [CGRect] {
            var items: [CGRect] = []
            let ball = script.ball(at: t)
            for (i, p) in script.players.enumerated() where p.opacity(at: t) > 0.4 {
                let at = p.position(at: t)
                let close = ball.map { Self.distance($0.ground, at) < 17 } ?? true
                guard all || close || p.team == .official || i == script.shooter else { continue }
                items.append(script.room(FieldPoint(at, z: p.lift(at: t)), figure: true))
            }
            if let ball {
                items.append(script.room(ball, figure: false))
                if Self.distance(ball.ground, rim) < 30 { items.append(rimRoom) }
            }
            return items.isEmpty ? [rimRoom] : items
        }
        let first = start?.camera
        let same = start?.yaw == script.yaw && start?.formation == script.formation
        func goal(_ t: Double) -> CameraFrame {
            let list = rooms(min(t, end), all: false) + rooms(min(t + 0.35, end), all: false)
            let region = list.dropFirst().reduce(list[0]) { $0.union($1) }
            var frame: CameraFrame
            if script.stamp.isFinite, t >= script.stamp - 0.3 {
                let others = script.players.map { script.room(FieldPoint($0.position(at: t)), figure: true) }
                frame = CameraFrame.clearing(region, items: list, others: others, headroom: CameraFrame.headroom, closest: 31, corner: corner,
                                             tightest: Hoops.tightest)
            } else {
                frame = CameraFrame.fitting(region, headroom: CameraFrame.headroom, closest: 31, tightest: Hoops.tightest)
            }
            if same, let first, t < 0.7 { frame = first.mix(frame, CameraRig.smooth(t / 0.7)) }
            return frame
        }
        let samples = CameraRig.follow(until: script.duration, goal: goal)
        self.script.camera = CameraPath(samples: samples, settle: script.duration, back: script.duration, rest: samples.last ?? goal(end))
    }
}

// MARK: - The court between plays

extension BasketballScript.Builder {
    /// How long a court between plays runs before it goes on as a new one
    /// (a long stoppage, a long possession): its sparse beats are in here.
    static let restLength = 30.0

    /// The court between plays (see the file's note): what the floor does
    /// first (up the floor, the ball in, to the lane, to the benches, off),
    /// then a beat every few seconds, still in between.
    mutating func rest(_ rest: BasketballScript.Rest) {
        var opening = 0.0
        switch rest.phase {
        case .tip:
            tipSet()
        case .offCourt:
            opening = offCourt(rest)
        case .benches:
            opening = benches(rest)
        case .lane:
            opening = laneRest(rest)
        case .loose:
            if !place(rest.from, allowed: [.play]) { setUp([CGPoint(x: 62, y: 25)]) }
            if let ball = start?.ball, start?.holder == nil {
                script.legs = [BasketballScript.Leg(from: 0, until: .infinity, hand: .spot(FieldPoint(ball, z: 0.4)))]
            } else {
                hold(start?.holder ?? 0, from: 0, until: .infinity)
            }
        case .live, .inbound:
            opening = liveRest(rest)
        }
        sortLegs()
        script.duration = script.formation == .offCourt || rest.phase == .loose || rest.phase == .tip ? max(opening + 0.5, 1) : Self.restLength
        script.settle = 0
        restCamera(opening: opening)
    }

    /// Before the tip: both teams round the center circle, the ball at center court.
    mutating func tipSet() {
        let center = CGPoint(x: Hoops.length / 2, y: Hoops.width / 2)
        let ours = [CGPoint(x: -1.6, y: 0), CGPoint(x: -7, y: 6), CGPoint(x: -7, y: -6), CGPoint(x: -14, y: 10), CGPoint(x: -14, y: -10)]
        script.players = ours.map { Player(team: .offense, at: CGPoint(x: center.x + $0.x, y: center.y + $0.y)) }
            + ours.map { Player(team: .defense, at: CGPoint(x: center.x - $0.x, y: center.y - $0.y * 0.9)) }
        script.legs = [BasketballScript.Leg(from: 0, until: .infinity, hand: .spot(FieldPoint(center, z: 0.4)))]
        script.formation = .center
    }

    // MARK: Play on

    /// The half-court sets the offense sits in between plays: five out, the
    /// big at the elbow (horns), four out and one in. The holder at the top.
    static let sets: [[CGPoint]] = [
        [CGPoint(x: 63, y: 25), CGPoint(x: 70, y: 7.5), CGPoint(x: 70, y: 42.5), CGPoint(x: 88.5, y: 3.6), CGPoint(x: 88.5, y: 46.4)],
        [CGPoint(x: 64, y: 25), CGPoint(x: 76.5, y: 17.5), CGPoint(x: 76.5, y: 32.5), CGPoint(x: 88.5, y: 3.6), CGPoint(x: 88.5, y: 46.4)],
        [CGPoint(x: 63, y: 21), CGPoint(x: 70, y: 43), CGPoint(x: 84, y: 5), CGPoint(x: 68, y: 7), CGPoint(x: 84.5, y: 32)],
    ]

    /// Play on: from where the last beat left everyone, up the floor (the
    /// ball in first after a score or a whistle) and into a half-court set,
    /// the defense back on its men; then the sparse beats. When the opening's done.
    mutating func liveRest(_ rest: BasketballScript.Rest) -> Double {
        script.formation = .play
        var spots = Self.sets[Int(random.next() % UInt64(Self.sets.count))].map { CGPoint(x: $0.x + random.in(-1...1), y: $0.y + random.in(-1...1)) }
        var t = 0.0
        var ball: Int
        if place(rest.from, allowed: [.play, .center]) {
            ball = start?.holder.flatMap { $0 < 5 ? $0 : nil } ?? -1
            if ball < 0 {
                // A loose ball, or the other team's hands: the nearest of ours picks it up.
                let lying = start?.ball ?? start?.holder.map { position($0, 0) } ?? CGPoint(x: 47, y: 25)
                ball = nearest(Array(0..<5), to: lying)
                let d = Self.distance(position(ball, 0), lying)
                if d > 1.5 {
                    script.legs.append(BasketballScript.Leg(from: 0, until: d / 14 + 0.2, hand: .spot(FieldPoint(lying, z: 0.4))))
                    move(ball, to: [lying], from: 0, to: d / 14 + 0.2, ease: .out)
                    t = d / 14 + 0.2
                }
            }
            if rest.round == 0 {
                switch rest.phase {
                case .inbound(baseline: true):
                    t = inbound(&ball, at: t, from: CGPoint(x: -1.5, y: 25 + (position(ball, t).y >= 25 ? 3.5 : -3.5)))
                case .inbound(baseline: false):
                    let here = position(ball, t)
                    let line = here.y < 25 ? -1.4 : Hoops.width + 1.4
                    t = inbound(&ball, at: t, from: CGPoint(x: min(max(here.x, 30), 80), y: line))
                default:
                    // A big off the defensive glass: the outlet up the sideline, as he would.
                    let deep = CGPoint(x: Hoops.length - rim.x, y: rim.y)
                    let here = position(ball, t)
                    if rest.outlet, Self.distance(here, deep) < 22 {
                        let wing = CGPoint(x: min(here.x + 18, 40), y: here.y < 25 ? 9 : 41)
                        let mate = nearest(Array(0..<5).filter { $0 != ball }, to: wing, at: t)
                        let meet = Self.inbounds(CGPoint(x: max(position(mate, t).x, wing.x - 4), y: wing.y))
                        move(mate, to: [meet], from: t, to: t + 0.35 + passTime(ball, at: t + 0.35, to: meet, style: .outlet), ease: .out)
                        hold(ball, from: t, until: t + 0.35)
                        let caught = pass(ball, to: mate, at: t + 0.35, point: meet, style: .outlet)
                        ball = mate
                        t = caught
                    }
                }
            }
        } else {
            setUp([spots[0]])
            ball = 0
            spots = script.players.prefix(5).map(\.at)
        }
        hold(ball, from: t, until: .infinity)
        // Into the set: each man to the nearest open spot (the holder to the top), the defense back on them.
        var open = Array(spots.indices)
        var goal = [Int: CGPoint]()
        goal[ball] = spots[0]
        open.removeAll { $0 == 0 }
        for k in (0..<5).filter({ $0 != ball }).sorted(by: { position($0, t).x > position($1, t).x }) {
            guard let j = open.min(by: { Self.distance(position(k, t), spots[$0]) < Self.distance(position(k, t), spots[$1]) }) else { break }
            goal[k] = spots[j]
            open.removeAll { $0 == j }
        }
        var end = t
        for k in 0..<5 {
            guard let g = goal[k] else { continue }
            let d = Self.distance(position(k, t), g)
            guard d > 1.2 else { continue }
            let speed = d > 30 ? (k == ball ? 15.0 : 16.0) : 9
            if k == ball {
                letGo(ball, at: t)
                bounce(ball, from: t, until: t + d / speed + 0.35)
                hold(ball, from: t + d / speed + 0.35, until: .infinity)
            }
            move(k, to: [g], from: t + (k == ball ? 0 : 0.1), to: t + d / speed + 0.35, ease: .inOut)
            end = max(end, t + d / speed + 0.35)
        }
        shadow(from: 0, to: end + 0.3)
        script.active = end > 0.05 ? [0...(end + 0.3)] : []
        ambient(from: end, holder: ball)
        return end
    }

    /// The ball in from out of bounds at `from`: the nearest man takes it
    /// out, a teammate comes to it, the pass in. When it's in.
    mutating func inbound(_ ball: inout Int, at t: Double, from out: CGPoint) -> Double {
        let taker = ball
        let d = Self.distance(position(taker, t), out)
        walk(taker, to: [out], from: t, to: t + max(d / 10, 0.4), ease: .inOut)
        var at = t + max(d / 10, 0.4)
        hold(taker, from: t, until: at + 0.5)
        let inward = Self.unit(CGPoint(x: (out.x < 0 ? 12 : out.x + 4) - out.x, y: 25 - out.y))
        let meet = Self.inbounds(Self.along(out, inward, 9))
        let receiver = nearest(Array(0..<5).filter { $0 != taker }, to: meet, at: at)
        move(receiver, to: [meet], from: max(at - 0.6, t), to: at + 0.4, ease: .out)
        at = pass(taker, to: receiver, at: at + 0.5, point: meet, style: .chest)
        walk(taker, to: [Self.inbounds(Self.along(out, inward, 4))], from: at, to: at + 0.6)
        ball = receiver
        return at
    }

    /// The ball leaves his hands at `t` (his open-ended hold ends there).
    mutating func letGo(_ i: Int, at t: Double) {
        if let k = script.legs.lastIndex(where: { $0.hand == .held(i) && $0.until == .infinity }) { script.legs[k].until = t }
    }

    /// A beat every few seconds, small and brief, still in between: a jab,
    /// a swing pass, a man relocating on the arc, a screen, a cut; the
    /// defense shading with each.
    mutating func ambient(from t0: Double, holder: Int) {
        var ball = holder
        var at = t0 + random.in(2.5...4)
        while at < Self.restLength - 3 {
            let roll = random.in(0...1)
            var length = 1.2
            let h = position(ball, at)
            let others = (0..<5).filter { $0 != ball }
            if roll < 0.28 {
                // A jab and back: two dribbles one way, one back.
                let side = Self.rotate(Self.unit(CGPoint(x: rim.x - h.x, y: rim.y - h.y)), .pi / 2 * random.sign())
                letGo(ball, at: at)
                bounce(ball, from: at, until: at + 1.0)
                move(ball, to: [Self.along(h, side, 3.5), Self.along(h, side, 1.2)], from: at, to: at + 1.0)
                hold(ball, from: at + 1.0, until: .infinity)
                length = 1.0
            } else if roll < 0.55 {
                // A swing pass to the man on the arc nearest him.
                let mate = others.filter { Self.distance(position($0, at), rim) > 18 }.min { Self.distance(position($0, at), h) < Self.distance(position($1, at), h) }
                    ?? others[0]
                let here = position(mate, at), meet = Self.along(here, Self.unit(CGPoint(x: h.x - here.x, y: h.y - here.y)), 1.5)
                letGo(ball, at: at + 0.25)
                move(mate, to: [meet], from: at, to: at + 0.25 + passTime(ball, at: at + 0.25, to: meet, style: .chest), ease: .out)
                let caught = pass(ball, to: mate, at: at + 0.25, point: meet, style: .chest)
                hold(mate, from: caught, until: .infinity)
                ball = mate
                length = caught - at + 0.3
            } else if roll < 0.75 {
                // A man off the ball slides round the arc.
                let k = others[Int(random.next() % UInt64(others.count))]
                let p = position(k, at), d = Self.distance(p, rim)
                let a = atan2(p.y - rim.y, p.x - rim.x) + random.in(0.22...0.4) * random.sign()
                var to = CGPoint(x: rim.x + d * cos(a), y: rim.y + d * sin(a))
                to = CGPoint(x: min(to.x, 89), y: min(max(to.y, 3), 47))
                move(k, to: [to], from: at, to: at + 1.3)
                length = 1.3
            } else if roll < 0.9 {
                // The big up to screen for him, then rolling back down.
                let big = others.min { Self.distance(position($0, at), rim) < Self.distance(position($1, at), rim) } ?? others[0]
                let guardAt = guardSpot(h, ball: h, onBall: true)
                let side = Self.rotate(Self.unit(CGPoint(x: rim.x - h.x, y: rim.y - h.y)), .pi / 2)
                let screen = Self.along(guardAt, side, 1.8)
                let back = position(big, at)
                move(big, to: [screen], from: at, to: at + 0.9)
                move(big, to: [Self.along(back, Self.unit(CGPoint(x: rim.x - back.x, y: rim.y - back.y)), 2)], from: at + 1.5, to: at + 2.3)
                letGo(ball, at: at + 0.9)
                bounce(ball, from: at + 0.9, until: at + 1.7)
                move(ball, to: [Self.along(h, side, -4)], from: at + 0.9, to: at + 1.7)
                hold(ball, from: at + 1.7, until: .infinity)
                length = 2.3
            } else {
                // A cut to the rim and back out.
                let k = others.max { Self.distance(position($0, at), rim) < Self.distance(position($1, at), rim) } ?? others[0]
                let p = position(k, at)
                move(k, to: [Self.along(rim, out(p), 6), Self.along(rim, Self.rotate(out(p), random.sign() * 0.9), Self.distance(p, rim))],
                     from: at, to: at + 2.0)
                length = 2.0
            }
            sortLegs()
            shadow(from: at, to: at + length + 0.2)
            script.active.append((at - 0.05)...(at + length + 0.3))
            at += length + random.in(3.5...6)
        }
    }

    // MARK: Free throws to come

    /// Free throws to come: everyone walks to the lane (the man fouled to the
    /// line), the referee under the basket bounces him the ball and goes;
    /// then a shuffle now and then. (Already on the lane, the shooter has
    /// the ball: no referee.)
    mutating func laneRest(_ rest: BasketballScript.Rest) -> Double {
        script.formation = .lane
        let line = CGPoint(x: Hoops.freeThrow - 0.6, y: 25)
        var t = 0.0
        if place(rest.from, allowed: [.lane]) {
            hold(start?.holder ?? 0, from: 0, until: .infinity)
        } else {
            let from = rest.from
            laneUp()
            let lane = script.players.prefix(10).map(\.at)
            let placed = place(from, allowed: [.play, .center])
            let ref = laneOfficial()
            if placed {
                // The man fouled (0, the beat's) to the line; the rest to the nearest open place.
                var open = Array(1..<5), theirs = Array(5..<10)
                var goal: [Int: CGPoint] = [0: lane[0]]
                for k in 1..<5 {
                    let j = open.min { Self.distance(position(k, 0), lane[$0]) < Self.distance(position(k, 0), lane[$1]) }!
                    goal[k] = lane[j]
                    open.removeAll { $0 == j }
                }
                for k in 5..<10 {
                    let j = theirs.min { Self.distance(position(k, 0), lane[$0]) < Self.distance(position(k, 0), lane[$1]) }!
                    goal[k] = lane[j]
                    theirs.removeAll { $0 == j }
                }
                for (k, g) in goal {
                    let d = Self.distance(position(k, 0), g)
                    move(k, to: [g], from: 0.2 + Double(k % 5) * 0.08, to: 0.2 + max(d / 7, 0.6))
                    t = max(t, 0.2 + max(d / 7, 0.6))
                }
            }
            // The ball from the referee to the man at the line.
            script.legs = [BasketballScript.Leg(from: 0, until: t + 0.4, hand: .held(ref))]
            let caught = pass(ref, to: 0, at: t + 0.4, point: line, style: .bounce)
            script.players[ref].leaves = caught + 0.8
            hold(0, from: caught, until: .infinity)
            t = caught + 0.2
        }
        for k in 1..<10 where random.in(0...1) < 0.5 { act(k, .hips, at: t + random.in(0...1.5), toward: line) }
        script.look = BasketballScript.Look(point: line, from: t)
        script.active = t > 0 ? [0...(t + 0.3)] : []
        // Now and then one shifts his feet.
        var at = t + random.in(3...5)
        while at < Self.restLength - 2 {
            let k = Int(random.in(1...9.99))
            let p = position(k, at)
            move(k, to: [CGPoint(x: p.x + random.in(-0.8...0.8), y: p.y + random.in(-0.5...0.5))], from: at, to: at + 0.7)
            script.active.append((at - 0.05)...(at + 0.95))
            at += random.in(4.5...7)
        }
        return t
    }

    // MARK: Stoppages

    /// A timeout, the end of a quarter: both teams walk to their benches
    /// (from wherever they stopped) and huddle; one shifts now and then.
    mutating func benches(_ rest: BasketballScript.Rest) -> Double {
        script.formation = .benches
        let ours = huddle(.offense), theirs = huddle(.defense)
        var t = 0.0
        if place(rest.from, allowed: [.play, .lane, .center, .benches]) {
            for i in 0..<10 {
                let goal = i < 5 ? ours[i] : theirs[i - 5]
                let d = Self.distance(position(i, 0), goal)
                guard d > 0.6 else { continue }
                walk(i, to: [goal], from: Double(i % 5) * 0.06, to: max(d / 9, 0.5))
                t = max(t, max(d / 9, 0.5))
            }
        } else {
            script.players = ours.map { Player(team: .offense, at: $0) } + theirs.map { Player(team: .defense, at: $0) }
        }
        script.look = nil
        script.active = t > 0 ? [0...(t + 0.3)] : []
        var at = t + random.in(4...6)
        while at < Self.restLength - 2 {
            let k = Int(random.in(0...9.99))
            let p = position(k, at)
            walk(k, to: [CGPoint(x: p.x + random.in(-0.6...0.6), y: p.y + random.in(-0.4...0.4))], from: at, to: at + 0.8)
            script.active.append((at - 0.05)...(at + 1.05))
            at += random.in(6...9)
        }
        return t
    }

    /// Halftime, the final: off the floor by the tunnel, fading as they go; then the court empty.
    mutating func offCourt(_ rest: BasketballScript.Rest) -> Double {
        script.formation = .offCourt
        guard place(rest.from, allowed: [.play, .lane, .center, .benches, .offCourt]) else {
            tipSet()
            script.formation = .offCourt
            hideAll(true)
            return 0
        }
        var t = 0.0
        for i in 0..<10 {
            let goal = framed(CGPoint(x: 47 + Double(i % 5 - 2) * 1.6 + (i < 5 ? -2 : 2), y: -9))
            let d = Self.distance(position(i, 0), goal)
            let end = max(d / 8, 0.8) + Double(i % 5) * 0.1
            walk(i, to: [goal], from: Double(i % 5) * 0.1, to: end)
            script.players[i].leaves = end
            t = max(t, end)
        }
        script.legs = []
        script.active = [0...(t + 0.4)]
        return t
    }

    // MARK: Its camera

    /// The court between plays through the camera: following the opening
    /// (up the floor, to the lane, to the benches), picked up from where the
    /// last beat's camera was when it looks the same way; then still on the
    /// floor as it set, with room for the small beats.
    mutating func restCamera(opening: Double) {
        let script = self.script
        let rimRoom = script.room(Self.rimPoint, figure: false)
        let formation = script.formation
        func region(_ t: Double) -> CGRect {
            var items: [CGRect] = []
            for p in script.players where p.opacity(at: t) > 0.3 {
                items.append(script.room(FieldPoint(p.position(at: t)), figure: true))
                items.append(script.room(FieldPoint(p.position(at: t + 0.4)), figure: true))
            }
            if let ball = script.ball(at: t) { items.append(script.room(ball, figure: false)) }
            if formation == .play || formation == .lane, script.players.prefix(5).contains(where: { Self.distance($0.position(at: t), rim) < 40 }) {
                items.append(rimRoom)
            }
            if items.isEmpty {
                // The empty court: center court and both lanes.
                let c = CGPoint(x: Hoops.length / 2, y: Hoops.width / 2)
                items = [script.room(FieldPoint(c), figure: false), script.room(FieldPoint(CGPoint(x: c.x - 22, y: c.y)), figure: false),
                         script.room(FieldPoint(CGPoint(x: c.x + 22, y: c.y)), figure: false)]
            }
            return items.dropFirst().reduce(items[0]) { $0.union($1) }
        }
        let closest = formation == .benches ? 30.0 : 36
        func frame(_ t: Double) -> CameraFrame {
            CameraFrame.fitting(region(t).insetBy(dx: t >= opening ? -3 : 0, dy: t >= opening ? -1.5 : 0), headroom: CameraFrame.headroom,
                                closest: closest, tightest: Hoops.tightest)
        }
        let settled = frame(opening + 0.6)
        let first = start?.camera
        let same = start?.yaw == script.yaw && first != nil
        guard opening > 0.05 || same else {
            self.script.camera = CameraPath(rest: settled)
            return
        }
        func goal(_ t: Double) -> CameraFrame {
            var g = t >= opening ? settled : frame(t)
            if same, let first, t < 0.7 { g = first.mix(g, CameraRig.smooth(t / 0.7)) }
            return g
        }
        let until = opening + 1.2
        let samples = CameraRig.follow(until: until, goal: goal)
        self.script.camera = CameraPath(samples: samples, settle: until, back: until + 0.6, rest: settled)
        if !self.script.active.isEmpty { self.script.active[0] = 0...max(self.script.active[0].upperBound, until + 0.6) }
        else { self.script.active = [0...(until + 0.6)] }
    }
}

private extension CGPoint {
    var negatedPoint: CGPoint { CGPoint(x: -x, y: -y) }
}
