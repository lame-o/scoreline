import SwiftUI

// The ballpark theater's beats between balls in play (PlayBeat.swift) as
// choreography, in the same terms as a play's (PlayScript.swift): every
// figure's path, the ball's flights, what each figure does, the captions
// (what the tag says from when) and where the camera looks. Built once per
// beat; a frame is a pure function of the script and t. Each starts and ends
// on the field as it stands between pitches (`PlayScript.Rest`), so beats
// play one after another, and after a play's replay, without a jump.
//
// Every beat takes its shape from its own data. A pitch flies MLB's tracked
// path (a sinker runs and sinks, a sweeper sweeps) to its real plate
// location, from the pitcher's real side and arm slot, to a batter on his
// real side; without tracking, a path shaped like its type to ESPN's plate
// location. The call decides the swing: a take, a full swing through it, a
// foul off to the side or back, a tip into the mitt, a bunt squared; a
// ball in the dirt the catcher blocks. A throw over goes to the base MLB
// names, from the pitcher (or the catcher); the reliever jogs in from his
// team's bullpen. Where the data is silent (which way a foul went, who went
// out to the mound, how far a fielder shifts) it varies by the beat's own
// ID: no two look canned, and a replay is always the same.
//
// Replay time, as a play's: the delivery and the pitch in real time, the
// rest of the beat brisker. A pitch takes about 2.5 s with the ball coming
// back to the mound; a visit or a change about 5. Between beats, the idle
// life (`IdleBeat`): a move every few seconds, a second or so long.

// MARK: - Beats

extension PlayScript {
    /// A beat's choreography on the field as it stands. The camera starts at
    /// `from` and comes to rest at `to` (a pitch with another to follow stays
    /// on the battery).
    init(beat: PlayBeat, rest: Rest, from: CameraFrame = .rest, to: CameraFrame = .rest) {
        var b = BeatBuilder(beat: beat, rest: rest)
        b.build()
        b.shoot(from: from, to: to)
        self = b.script
        measureBodies()
    }

    /// The battery for a pitch, and a runner leading off first or third
    /// (one off second is out of the shot, as the broadcast's center-field
    /// camera has it): what a pitch's camera holds.
    static func battery(_ rest: Rest) -> CameraFrame {
        CameraFrame.fitting(Shot.region(batteryPoints(rest)), headroom: CameraFrame.headroom)
    }

    static func batteryPoints(_ rest: Rest) -> [FieldPoint] {
        var points = Shot.battery
        for base in [1, 3] where rest.bases[base - 1] { points.append(FieldPoint(Ballpark.lead(base))) }
        return points
    }
}

/// A run of numbers from a seed (SplitMix64): the same every time.
struct BeatRandom {
    private var state: UInt64

    init(_ seed: UInt64) { state = seed }

    /// 0 ..< 1.
    mutating func next() -> Double {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return Double((z ^ (z >> 31)) >> 11) / Double(1 << 53)
    }

    mutating func between(_ a: Double, _ b: Double) -> Double { a + (b - a) * next() }
}

/// Assembles a beat's script.
struct BeatBuilder {
    let beat: PlayBeat
    let rest: PlayScript.Rest
    var script = PlayScript()
    var batter: Int?
    /// Actor index by the base a runner leads off.
    var runner: [Int: Int] = [:]
    var random: BeatRandom
    /// Where the camera looks, from when (each eases in over half a second).
    var looks: [(at: Double, frame: CameraFrame)] = []

    typealias Actor = PlayScript.Actor
    typealias Flight = PlayScript.Flight

    init(beat: PlayBeat, rest: PlayScript.Rest) {
        self.beat = beat
        self.rest = rest
        random = BeatRandom(beat.seed)
        script = Self.field(rest, arm: beat.arm)
        batter = script.actors.firstIndex { $0.role == .batter }
        for (i, a) in script.actors.enumerated() where a.role == .runner {
            if let base = (1...3).first(where: { Ballpark.lead($0) == a.at }) { runner[base] = i }
        }
    }

    /// The field between pitches, as `PlayScript(rest:)` stands it, the
    /// pitcher's hand set: the cast of every beat and idle move.
    static func field(_ rest: PlayScript.Rest, arm: PlayScene.Hand?) -> PlayScript {
        var script = PlayScript(rest: rest)
        if !script.actors.isEmpty { script.actors[0].arm = arm }
        script.rig = []
        return script
    }

    func fielder(_ n: Int) -> Int { min(max(n, 1), 9) - 1 }

    /// The team in the field's dugout, and the team at bat's.
    var fieldingDugout: CGPoint { Ballpark.dugout(home: rest.fieldingHome) }
    var battingDugout: CGPoint { Ballpark.dugout(home: !rest.fieldingHome) }

    mutating func caption(_ line: PlayScript.Caption.Line, at t: Double) {
        script.captions.append(PlayScript.Caption(at: t, line: line))
    }

    mutating func build() {
        switch beat.kind {
        case let .pitch(p): pitch(p)
        case .batterUp: batterUp()
        case let .pickoff(base, catcher): pickoff(base, catcher: catcher)
        case .stepOff: stepOff()
        case .timeout: timeout()
        case let .moundVisit(coach): visit(coach: coach)
        case .pitchingChange: pitchingChange()
        case let .substitution(change): substitution(change)
        case .inningBreak: inningBreak()
        case .review: huddle()
        case let .delay(d): delay(d)
        case .play: script.duration = 0.1
        }
        script.flights.sort { $0.start < $1.start }
        script.settle = script.duration
    }

    // MARK: The pitch

    /// The pitch: the delivery from the set, the ball along its flight to the
    /// plate and into the mitt (or off the bat), the batter's take or swing,
    /// the runners' secondary leads, the infield's creep, and the ball back
    /// to the mound. The call lands as it pops the mitt.
    mutating func pitch(_ p: PlayBeat.Pitch) {
        let hand = beat.arm ?? .right
        let bats = rest.bats ?? beat.bats ?? .right
        guard p.thrown else { return automatic(p) }
        let flight = p.flight ?? Self.shaped(p, arm: hand, seed: beat.seed)
        script.actors[0].arm = hand
        script.actors[0].slot = Self.slot(flight)
        let release = 0.8
        let releaseT = flight.time(at: Ballpark.release) ?? 0
        let plateT = flight.plateTime ?? releaseT + 0.42
        // Into the mitt behind the plate, or the dirt before it.
        var endT = flight.time(at: -6.5) ?? plateT + 0.05
        let dirt = flight.time(atHeight: 0.25, after: releaseT + 0.1).flatMap { $0 < endT ? $0 : nil }
        if let dirt { endT = dirt }
        func at(_ tt: Double) -> Double { release + tt - releaseT }
        let contact = at(plateT)
        let plate = flight.point(at: plateT)
        script.release = release
        script.ballFrom = release - 0.04
        // The pitcher sets, comes to the plate; the batter in his stance.
        script.actors[0].sets = [0.08...(release - 0.55)]
        let fouled = p.call == .foul || p.call == .foulBunt
        let pop = fouled ? contact : at(endT)
        script.flights.append(Flight(start: release, end: fouled ? contact : pop, from: flight.point(at: releaseT),
                                     to: flight.point(at: fouled ? plateT : endT), arc: .pitch(flight, from: releaseT, to: fouled ? plateT : endT)))

        if let batter {
            if p.swung { script.actors[batter].swing = contact }
            if p.bunted { script.actors[batter].bunt = release - 0.4 }
            // A ball near the edge with two strikes: he starts and holds up (a check swing the umpire called a ball).
            if p.call == .ball, p.strikes == 2, Self.borderline(plate, zone: flight.zone), random.next() < 0.6 {
                script.actors[batter].check = contact - 0.02
            }
        }

        let catcher = fielder(2)
        if fouled {
            foul(from: plate, at: contact, bats: bats, bunt: p.call == .foulBunt)
        } else {
            // A tip: off the bat, on into the mitt.
            if p.call == .foulTip { script.flashes.append(PlayScript.Flash(beat: .contact, at: contact, point: plate)) }
            let mitt = flight.point(at: endT)
            if dirt != nil {
                // In the dirt: he drops to block it, and it kicks out in front of him.
                script.actors[catcher].act(.scoop, at: pop, toward: Ballpark.rubber)
                let kick = CGPoint(x: mitt.x + random.between(-4, 4), y: mitt.y + random.between(1.5, 5))
                script.flights.append(Flight(start: pop, end: pop + 0.4, from: mitt, to: FieldPoint(kick), arc: .bounce(2), ease: .out))
                script.actors[catcher].move(to: [CGPoint(x: kick.x, y: kick.y - 1.5)], from: pop + 0.25, to: pop + 0.75, ease: .out)
                script.actors[catcher].act(.scoop, at: pop + 0.75, toward: kick)
                script.actors[catcher].rise = [(pop + 0.1)...(pop + 1.6)]
                script.actors[catcher].move(to: [rest.spot(2)], from: pop + 1.5, to: pop + 2.1)
                returnThrow(from: CGPoint(x: kick.x, y: kick.y - 1.5), at: pop + 1.0)
            } else {
                script.actors[catcher].act(.glove, at: pop, toward: Ballpark.rubber)
                script.flashes.append(PlayScript.Flash(beat: .catchBall, at: pop, point: mitt))
                returnThrow(from: rest.spot(2), at: pop + 0.5)
            }
        }

        runnersOnThePitch(release: release, pop: pop, contact: contact, fouled: fouled, full: p.balls == 3 && p.strikes == 2 && beat.outs == 2)
        creep(release: release, pop: pop)

        // The zone at the plate as the pitch comes, and where it crossed.
        let zone = flight.zone ?? 1.6...3.4
        script.zone = PlayScript.Zone(bottom: zone.lowerBound, top: zone.upperBound, at: contact, crossing: CGPoint(x: plate.x, y: plate.z),
                                      from: release - 0.1, until: (fouled ? contact : pop) + 0.9)

        // The call as it pops (a foul as it's hit); a challenge, then how it came out.
        let called = fouled ? contact + 0.12 : pop + 0.02
        caption(.call(asCalled: p.review != nil), at: called)
        umpire(p, release: release, done: fouled ? contact : pop, called: called)
        var end = max(script.flights.map(\.end).max() ?? 0, called + 1.3) + 0.35
        if p.review != nil {
            caption(.challenge, at: called + 1.2)
            caption(.outcome, at: called + 2.4)
            end = max(end, called + 3.6)
        }
        script.duration = max(end, script.actors.flatMap { $0.moves.map(\.end) }.max() ?? 0)
        // In on the battery from the start: there by the release.
        let battery = PlayScript.battery(rest)
        looks = [(0, .rest), (0, battery)]
        // A foul down the line or back over the screen: the camera opens up to see where it went, a
        // beat before contact, as an operator reads the swing.
        if fouled, let i = script.watch, i < script.flights.count {
            let f = script.flights[i]
            var box = PlayScript.Box()
            for p in PlayScript.batteryPoints(rest) { box.add(p, figure: true) }
            box.add(f.point(at: f.start + (f.end - f.start) * 0.7), figure: false)
            looks.append((contact - 0.1, CameraFrame.fitting(box.rect, headroom: CameraFrame.headroom)))
        }
        looks.append((script.duration - 0.75, .rest))
    }

    /// The plate umpire through a pitch: down in his set behind the catcher
    /// as it comes, up as it's in; his call as he made it (a called strike's
    /// punch, a swinging strike's point, both arms up for a foul; a ball
    /// gets nothing); a challenge's tap on the cap, and the strike he signals
    /// if the zone gave it.
    mutating func umpire(_ p: PlayBeat.Pitch, release: Double, done: Double, called: Double) {
        guard let u = script.umpire else { return }
        script.actors[u].sets.append((release - 0.45)...(done + 0.3))
        // The call he made: the other one, when the zone overturned it.
        var made = p.call
        if p.review?.overturned == true { made = p.call == .calledStrike ? .ball : p.call == .ball ? .calledStrike : p.call }
        let call: Actor.Signal.Kind? = switch made {
        case .calledStrike: .strike
        case .swingingStrike, .swingingBlocked, .missedBunt, .foulTip: .swinging
        case .foul, .foulBunt: .foul
        default: nil
        }
        if let call { script.actors[u].signals.append(Actor.Signal(kind: call, at: call == .foul ? called + 0.1 : called + 0.04)) }
        guard let review = p.review else { return }
        script.actors[u].signals.append(Actor.Signal(kind: .challenge, at: called + 1.15))
        if review.overturned, p.call == .calledStrike { script.actors[u].signals.append(Actor.Signal(kind: .strike, at: called + 2.45)) }
    }

    /// A pitch-clock violation: nothing thrown. The pitcher's (an automatic
    /// ball) comes as he's set too long; the batter's (a strike) as he's out
    /// of the box.
    mutating func automatic(_ p: PlayBeat.Pitch) {
        if p.call == .automaticBall {
            script.actors[0].sets = [0.2...1.3]
            script.actors[0].move(to: [CGPoint(x: 0, y: 59)], from: 1.3, to: 1.6)
            script.actors[0].move(to: [rest.spot(1)], from: 1.9, to: 2.3)
        } else if let batter, let bats = rest.bats {
            let box = Ballpark.box(bats), out = CGPoint(x: box.x * 1.45, y: box.y - 2)
            script.actors[batter].move(to: [out], from: 0.1, to: 0.6)
            script.actors[batter].move(to: [box], from: 1.6, to: 2.2)
        }
        caption(.call(asCalled: false), at: 0.6)
        script.duration = 2.6
        looks = [(0, .rest), (0.2, PlayScript.battery(rest)), (1.8, .rest)]
    }

    /// The ball back to the pitcher: a soft toss from the catcher, up out of his crouch.
    mutating func returnThrow(from: CGPoint, at start: Double) {
        let catcher = fielder(2)
        let to = FieldPoint(x: rest.spot(1).x, y: rest.spot(1).y + 1, z: 5.2)
        let length = 0.62
        script.flights.append(Flight(start: start, end: start + length, from: FieldPoint(from, z: 4.5), to: to, arc: .arc(4)))
        script.actors[catcher].rise.append((start - 0.3)...(start + 0.45))
        script.actors[catcher].act(.throwBall, at: start, toward: rest.spot(1))
        script.actors[0].act(.glove, at: start + length, toward: .zero)
        script.ballGone = start + length + 0.05
    }

    /// A foul off the bat. Which way, as the pitch's location and his side
    /// make likely (an inside pitch pulled down the line, an outside one
    /// sliced the other way, one up in the zone back into the screen, one
    /// down chopped into the dirt), the beat's seed choosing among them.
    mutating func foul(from plate: FieldPoint, at contact: Double, bats: PlayScene.Hand, bunt: Bool) {
        script.flashes.append(PlayScript.Flash(beat: .contact, at: contact, point: plate))
        // A right-handed batter pulls toward third (x < 0).
        let pull: Double = bats == .left ? 1 : -1
        let inside = bats == .left ? plate.x : -plate.x
        let flight: Flight
        if bunt {
            // Bunted foul: off the bat and dribbling over the line.
            let side = random.next() < 0.5 ? 1.0 : -1.0
            let to = Ballpark.polar(random.between(18, 34), side * random.between(50, 70))
            flight = Flight(start: contact, end: contact + 0.75, from: plate, to: FieldPoint(to), arc: .bounce(3), ease: .out)
        } else {
            let high = plate.z > 3.3, low = plate.z < 1.75
            let weights = [0.3 + (high ? 0.4 : 0), 0.3 + min(max(inside * 0.5, -0.25), 0.4), 0.3 + min(max(-inside * 0.5, -0.25), 0.4),
                           low ? 0.4 : 0.06]
            var pick = random.next() * weights.reduce(0, +), way = 0
            for (i, w) in weights.enumerated() {
                if pick < w { way = i; break }
                pick -= w
                way = i
            }
            switch way {
            case 0:
                // Straight back, over the catcher into the screen.
                let to = FieldPoint(x: random.between(-12, 12), y: -58, z: random.between(16, 34))
                flight = Flight(start: contact, end: contact + 0.5, from: plate, to: to, arc: .arc(random.between(4, 12)))
                script.actors[fielder(2)].rise = [(contact + 0.05)...(contact + 1.2)]
            case 1, 2:
                // Down the line, into the seats: pulled, or sliced the other way (shorter).
                let side = way == 1 ? pull : -pull
                let distance = way == 1 ? random.between(120, 270) : random.between(90, 210)
                let to = Ballpark.polar(distance, side * random.between(50, 76))
                let peak = random.between(24, way == 1 ? 80 : 60)
                // At a replay's pace, quicker than life but slow enough to follow into the seats.
                flight = Flight(start: contact, end: contact + 0.8 + distance / 260, from: plate, to: FieldPoint(to, z: 6), arc: .arc(peak))
                // The man nearest it drifts over to watch it go.
                let near = [3, 5].min { hypot(Ballpark.position($0).x - to.x, Ballpark.position($0).y - to.y)
                    < hypot(Ballpark.position($1).x - to.x, Ballpark.position($1).y - to.y) } ?? 5
                let spot = rest.spot(near), d = max(hypot(to.x - spot.x, to.y - spot.y), 1), step = min(d * 0.12, 14)
                script.actors[fielder(near)].move(to: [CGPoint(x: spot.x + (to.x - spot.x) / d * step, y: spot.y + (to.y - spot.y) / d * step)],
                                                 from: contact + 0.1, to: contact + 0.7, ease: .out)
                script.actors[fielder(near)].move(to: [spot], from: contact + 1.3, to: contact + 2.0)
            default:
                // Chopped into the dirt, bouncing foul.
                let side = inside >= 0 ? pull : -pull
                let to = Ballpark.polar(random.between(22, 48), side * random.between(52, 80))
                flight = Flight(start: contact, end: contact + 0.6, from: plate, to: FieldPoint(to), arc: .bounce(2), ease: .out)
            }
        }
        script.watch = script.flights.count
        script.flights.append(flight)
        script.ballGone = flight.end
    }

    /// A pitch near the zone's edge (the call could have gone either way).
    static func borderline(_ p: FieldPoint, zone: ClosedRange<Double>?) -> Bool {
        let zone = zone ?? 1.6...3.4
        let wide = abs(p.x) - 0.83
        let tall = max(zone.lowerBound - p.z, p.z - zone.upperBound)
        return max(wide, tall) < 0.45
    }

    /// Each runner's secondary lead: two shuffles off as the pitch is
    /// thrown, back once it's caught. Two out on a full count, they're off
    /// with the pitch (a foul sends them back).
    mutating func runnersOnThePitch(release: Double, pop: Double, contact: Double, fouled: Bool, full: Bool) {
        for (base, index) in runner {
            let lead = Ballpark.lead(base), next = Ballpark.base(base + 1)
            let d = max(hypot(next.x - lead.x, next.y - lead.y), 1)
            func along(_ feet: Double) -> CGPoint { CGPoint(x: lead.x + (next.x - lead.x) / d * feet, y: lead.y + (next.y - lead.y) / d * feet) }
            if full && fouled {
                script.actors[index].move(to: [along(min(80 * (contact + 0.25 - release + 0.2), 62))], from: release - 0.2, to: contact + 0.25,
                                          ease: .linear)
                script.actors[index].move(to: [lead], from: contact + 0.7, to: contact + 2.0)
            } else {
                script.actors[index].move(to: [along(random.between(4, 7))], from: release - 0.15, to: release + 0.35, ease: .out)
                script.actors[index].move(to: [lead], from: pop + 0.3, to: pop + 1.0)
            }
        }
    }

    /// The infielders' creep: a step in as the pitch is thrown, back after.
    mutating func creep(release: Double, pop: Double) {
        for n in 3...6 {
            let spot = rest.spot(n), d = max(Ballpark.distance(spot), 1), step = random.between(1.5, 3.5)
            script.actors[fielder(n)].move(to: [CGPoint(x: spot.x - spot.x / d * step, y: spot.y - spot.y / d * step)],
                                           from: release - 0.25, to: release + 0.25, ease: .out)
            script.actors[fielder(n)].move(to: [spot], from: pop + 0.4 + random.between(0, 0.3), to: pop + 1.2)
        }
    }

    /// A pitch's flight shaped like its type, where MLB didn't track it: from
    /// his side of the rubber (a right-hander's release on the third-base
    /// side), at its speed, breaking as its type does (arm-side run and sink
    /// for a sinker, glove-side sweep for a sweeper, drop for a curve), to
    /// ESPN's plate location; with none, a spot its call allows (a ball off
    /// the plate, a strike over it). (pure; tested)
    static func shaped(_ p: PlayBeat.Pitch, arm: PlayScene.Hand, seed: UInt64) -> Statcast.Pitch {
        var r = BeatRandom(seed ^ 0x5eed)
        let mph = p.mph ?? 91, speed = mph * 5280 / 3600
        let side: Double = arm == .left ? 1 : -1
        // Break (ft/s², x toward his arm side, z with gravity) by type.
        let (run, drop): (Double, Double) = switch p.code ?? "FF" {
        case "SI", "FT": (17, -24)
        case "FC": (-4, -24)
        case "SL": (-8, -30)
        case "ST", "SV": (-15, -30)
        case "CU", "KC", "CS": (-7, -42)
        case "CH": (15, -27)
        case "FS", "FO": (9, -34)
        case "KN", "EP": (0, -33)
        default: (9, -15)
        }
        let a = SIMD3<Double>(run * side, 28, drop)
        let release = SIMD3<Double>(side * r.between(1.3, 2.4), Ballpark.release, r.between(5.4, 6.3))
        let spot = plateLocation(p, seed: seed)
        let target = SIMD2<Double>(Double(spot.x), Double(spot.y))
        // Time to the front of the plate, under the deceleration.
        let y = 17.0 / 12, vy = -speed
        let root: Double = (vy * vy - 2 * a.y * (release.y - y)).squareRoot()
        let t: Double = (-vy - root) / a.y
        let vx: Double = (target.x - release.x - a.x * t * t / 2) / t
        let vz: Double = (target.y - release.z - a.z * t * t / 2) / t
        return Statcast.Pitch(release: release, velocity: SIMD3(vx, vy, vz), acceleration: a, plate: target, zone: nil, mph: mph, spin: nil,
                              type: p.code)
    }

    /// Where a pitch crossed the plate (feet across from its center, and
    /// height): ESPN's coordinates, as the strike zone chart has them, else a
    /// spot its call allows.
    static func plateLocation(_ p: PlayBeat.Pitch, seed: UInt64) -> CGPoint {
        if let x = p.x, let y = p.y {
            return CGPoint(x: min(max((x - 116) * 0.085, -3), 3), y: min(max(3.4 - (y - 148) * 0.045, 0.3), 5.2))
        }
        var r = BeatRandom(seed ^ 0x91a7e)
        switch p.call {
        case .ball, .automaticBall:
            let side = r.next() < 0.5 ? -1.0 : 1.0
            return CGPoint(x: side * r.between(1.05, 1.6), y: r.between(1.4, 3.6))
        case .ballInDirt, .swingingBlocked:
            return CGPoint(x: r.between(-0.8, 0.8), y: r.between(0.1, 0.5))
        default:
            return CGPoint(x: r.between(-0.75, 0.75), y: r.between(1.8, 3.2))
        }
    }

    /// His arm slot from where the ball left his hand: high and in line with
    /// him is over the top, low and wide sidearm. 1 over the top, 0 sidearm.
    static func slot(_ p: Statcast.Pitch) -> Double {
        let angle = atan2(p.release.z - 4.9, max(abs(p.release.x) - 0.3, 0.05)) * 180 / .pi
        return min(max(angle / 75, 0), 1)
    }

    // MARK: Between pitches

    /// The batter steps in: a practice swing as he settles.
    mutating func batterUp() {
        if let batter { script.actors[batter].practice = 0.4 }
        caption(.tag, at: 0)
        script.duration = 2.2
        looks = [(0, .rest)]
    }

    /// A throw over: the pitcher set, spinning to throw to the base MLB
    /// names (or the catcher up and snapping it there), the man covering it
    /// taking the throw and putting down the tag, the runner diving back;
    /// then the ball back to the mound.
    mutating func pickoff(_ base: Int, catcher: Bool) {
        let b = min(max(base, 1), 3)
        let cover = b == 1 ? 3 : b == 2 ? (random.next() < 0.5 ? 6 : 4) : 5
        let bag = Ballpark.bag(b)
        let thrower = catcher ? 2 : 1
        let from = catcher ? CGPoint(x: 0, y: -7) : rest.spot(1)
        let start: Double
        if catcher {
            script.actors[fielder(2)].rise = [0.2...1.4]
            start = 0.55
        } else {
            script.actors[0].sets = [0.1...0.62]
            start = 0.78
        }
        script.actors[fielder(cover)].move(to: [bag], from: 0.25, to: start + 0.1, ease: .out)
        let d = hypot(bag.x - from.x, bag.y - from.y), length = min(max(d / 165 + 0.08, 0.24), 0.7)
        let arrive = start + length
        script.ballFrom = 0
        script.flights.append(Flight(start: start, end: arrive, from: FieldPoint(from, z: 5.5), to: FieldPoint(bag, z: 2.5), arc: .arc(1.5 + d * 0.02)))
        script.actors[fielder(thrower)].act(.throwBall, at: start, toward: bag)
        script.actors[fielder(cover)].act(.glove, at: arrive, toward: from)
        script.actors[fielder(cover)].act(.scoop, at: arrive + 0.14, toward: Ballpark.lead(b))
        if let index = runner[b] {
            // Back, head first.
            script.actors[index].move(to: [Ballpark.base(b)], from: start + 0.05, to: start + 0.42, ease: .out)
            script.actors[index].diveBack = start + 0.05
            script.actors[index].move(to: [Ballpark.lead(b)], from: arrive + 1.0, to: arrive + 1.7)
        }
        // Back to the mound, and everyone back to his spot.
        let toss = arrive + 0.75
        script.flights.append(Flight(start: toss, end: toss + 0.5, from: FieldPoint(bag, z: 4.5),
                                     to: FieldPoint(x: rest.spot(1).x, y: rest.spot(1).y, z: 5), arc: .arc(4)))
        script.actors[fielder(cover)].act(.throwBall, at: toss, toward: rest.spot(1))
        script.actors[0].act(.glove, at: toss + 0.5, toward: bag)
        script.actors[fielder(cover)].move(to: [rest.spot(cover)], from: toss + 0.4, to: toss + 1.2)
        script.ballGone = toss + 0.55
        caption(.tag, at: 0.2)
        script.duration = toss + 1.4
        var region = [FieldPoint(from), FieldPoint(bag), FieldPoint(Ballpark.lead(b))]
        if catcher { region.append(FieldPoint(x: 0, y: 0)) }
        looks = [(0, .rest), (0.1, CameraFrame.fitting(PlayScript.Shot.region(region), headroom: CameraFrame.headroom)),
                 (toss + 0.3, .rest)]
    }

    /// Off the rubber: set, then a step back off it; the runners lean back toward their bags.
    mutating func stepOff() {
        script.actors[0].sets = [0.1...0.7]
        let spot = rest.spot(1)
        script.actors[0].move(to: [CGPoint(x: spot.x, y: spot.y + 3.5)], from: 0.72, to: 1.05, ease: .out)
        script.actors[0].move(to: [spot], from: 1.5, to: 2.0)
        for (base, index) in runner {
            let lead = Ballpark.lead(base), bag = Ballpark.base(base)
            script.actors[index].move(to: [CGPoint(x: (lead.x + bag.x) / 2, y: (lead.y + bag.y) / 2)], from: 0.75, to: 1.05, ease: .out)
            script.actors[index].move(to: [lead], from: 1.5, to: 2.0)
        }
        caption(.tag, at: 0.7)
        script.duration = 2.2
        looks = [(0, .rest)]
    }

    /// Time: the batter steps out, takes a swing, steps back in.
    mutating func timeout() {
        guard let batter, let bats = rest.bats else { script.duration = 0.4; return }
        let box = Ballpark.box(bats), out = CGPoint(x: box.x * 1.5, y: box.y - 3)
        script.actors[batter].move(to: [out], from: 0.15, to: 0.75)
        script.actors[batter].practice = 1.0
        script.actors[batter].move(to: [box], from: 1.9, to: 2.5)
        script.duration = 2.7
        looks = [(0, .rest)]
    }

    /// A mound visit: the catcher jogs out (the infielders gather round), or
    /// the pitching coach walks out of the dugout with him, a word, and back.
    mutating func visit(coach: Bool) {
        let mound = rest.spot(1)
        let catcher = fielder(2)
        script.actors[catcher].move(to: [CGPoint(x: mound.x - 3, y: mound.y - 4)], from: 0.2, to: 1.5)
        script.actors[catcher].move(to: [rest.spot(2)], from: 3.6, to: 4.9)
        for (k, n) in [3, 4, 5, 6].enumerated() where random.next() < 0.75 || !coach {
            let a = Double(k) * .pi / 2 + 0.6 + random.between(-0.2, 0.2)
            let spot = CGPoint(x: mound.x + cos(a) * 10, y: mound.y + sin(a) * 7)
            script.actors[fielder(n)].move(to: [spot], from: 0.6 + random.between(0, 0.3), to: 2.2)
            script.actors[fielder(n)].move(to: [rest.spot(n)], from: 3.6 + random.between(0, 0.3), to: 5.0)
        }
        if coach {
            var walker = Actor(team: .fielding, at: fieldingDugout, role: .coach, appear: 0)
            walker.move(to: [CGPoint(x: mound.x + (fieldingDugout.x > 0 ? 4 : -4), y: mound.y - 3)], from: 0.1, to: 2.0)
            walker.move(to: [fieldingDugout], from: 3.6, to: 5.4)
            walker.vanish = 5.1
            script.actors.append(walker)
        }
        caption(.tag, at: 0.1)
        script.duration = 5.6
        var region = [FieldPoint(mound), FieldPoint(x: 0, y: -6), FieldPoint(Ballpark.position(4)), FieldPoint(Ballpark.position(6))]
        if coach { region.append(FieldPoint(fieldingDugout)) }
        looks = [(0, .rest), (0.3, CameraFrame.fitting(PlayScript.Shot.region(region), headroom: CameraFrame.headroom)), (4.0, .rest)]
    }

    /// A pitching change: the manager walks out, the pitcher walks off to his
    /// dugout, and the reliever jogs in from his team's bullpen to the mound.
    mutating func pitchingChange() {
        let mound = rest.spot(1)
        let gate = Ballpark.bullpen(home: rest.fieldingHome)
        var manager = Actor(team: .fielding, at: fieldingDugout, role: .coach, appear: 0)
        manager.move(to: [CGPoint(x: mound.x + (fieldingDugout.x > 0 ? 5 : -5), y: mound.y - 3)], from: 0.1, to: 1.7)
        manager.move(to: [fieldingDugout], from: 4.6, to: 6.4)
        manager.vanish = 6.1
        script.actors.append(manager)
        // The pitcher he's taking out.
        script.actors[0].move(to: [fieldingDugout], from: 1.9, to: 4.0)
        script.actors[0].vanish = 3.7
        // The reliever, seen from part way in: a jog across the outfield.
        let entry = CGPoint(x: gate.x + (mound.x - gate.x) * 0.5, y: gate.y + (mound.y - gate.y) * 0.5)
        var reliever = Actor(team: .fielding, at: entry, role: .fielder(1), appear: 0.5)
        reliever.arm = beat.arm
        reliever.move(to: [mound], from: 0.7, to: 4.4, ease: .linear)
        script.actors.append(reliever)
        caption(.tag, at: 0.1)
        script.duration = 6.6
        let wide = CameraFrame.fitting(PlayScript.Shot.region([FieldPoint(entry), FieldPoint(mound), FieldPoint(x: 0, y: -6),
                                                               FieldPoint(fieldingDugout)]), headroom: CameraFrame.headroom)
        let mid = CGPoint(x: (entry.x + mound.x) / 2, y: (entry.y + mound.y) / 2)
        let close = CameraFrame.fitting(PlayScript.Shot.region([FieldPoint(mid), FieldPoint(mound), FieldPoint(x: 0, y: -6),
                                                                FieldPoint(fieldingDugout)]), headroom: CameraFrame.headroom)
        looks = [(0, .rest), (0.3, wide), (2.6, close), (4.6, .rest)]
    }

    /// Someone in, someone out: a pinch runner swapped at his base; a
    /// defensive change, the man at that position off to the dugout and his
    /// replacement out (an outfielder's long way seen in part).
    mutating func substitution(_ c: PlayBeat.Change) {
        caption(.tag, at: 0.1)
        script.duration = 3.4
        looks = [(0, .rest)]
        switch c.role {
        case .pinchRunner, .pinchHitter:
            guard c.role == .pinchRunner, let base = c.base ?? (1...3).last(where: { runner[$0] != nil }), let index = runner[base] else { return }
            swap(index, at: Ballpark.lead(base), dugout: battingDugout, team: .batting, role: .runner)
        case .defensive, .moves:
            guard let n = c.position, (2...9).contains(n) else { return }
            swap(fielder(n), at: rest.spot(n), dugout: fieldingDugout, team: .fielding, role: .fielder(n))
        }
    }

    /// One man jogs off to `dugout`, another comes out of it to `spot`.
    mutating func swap(_ index: Int, at spot: CGPoint, dugout: CGPoint, team: PlayScript.Team, role: Actor.Role) {
        let pace = 36.0
        let d = max(hypot(dugout.x - spot.x, dugout.y - spot.y), 1), jog = min(d / pace, 1.9), f = min(jog * pace / d, 1)
        script.actors[index].move(to: [CGPoint(x: spot.x + (dugout.x - spot.x) * f, y: spot.y + (dugout.y - spot.y) * f)], from: 0.2,
                                  to: 0.2 + jog, ease: .linear)
        script.actors[index].vanish = 0.2 + jog - Actor.fade
        let g = max(1 - jog * pace / d, 0)
        var new = Actor(team: team, at: CGPoint(x: dugout.x + (spot.x - dugout.x) * g, y: dugout.y + (spot.y - dugout.y) * g), role: role,
                        appear: 0.5, crouch: role == .fielder(2))
        new.move(to: [spot], from: 0.6, to: 0.6 + jog, ease: .out)
        script.actors.append(new)
        script.duration = max(script.duration, 0.6 + jog + 0.6)
        looks = [(0, .rest), (0.2, CameraFrame.fitting(PlayScript.Shot.region([FieldPoint(spot), FieldPoint(dugout), FieldPoint(x: 0, y: 30)]),
                                                         headroom: CameraFrame.headroom)), (script.duration - 0.9, .rest)]
    }

    /// Between halves, the team just out there warms up: the pitcher's
    /// warm-up toss to the catcher and back, then the first baseman's
    /// grounder to an infielder, thrown back to him.
    mutating func inningBreak() {
        warmUp(at: 0.5)
        groundBall(at: 2.9)
        caption(.tag, at: 0.05)
        script.duration = max(script.flights.map(\.end).max() ?? 0, 4) + 0.5
        looks = [(0, .rest)]
    }

    /// A warm-up pitch: an easy fastball down the middle, and back.
    mutating func warmUp(at start: Double) {
        let hand = beat.arm ?? .right
        let p = PlayBeat.Pitch(call: .calledStrike, number: 0, balls: 0, strikes: 0, code: "FF", mph: random.between(84, 90), x: nil, y: nil)
        let flight = Self.shaped(p, arm: hand, seed: beat.seed ^ 0xa11)
        let releaseT = flight.time(at: Ballpark.release) ?? 0, endT = flight.time(at: -6.5) ?? 0.5
        let release = start + 0.55
        script.release = release
        script.actors[0].arm = hand
        script.flights.append(Flight(start: release, end: release + endT - releaseT, from: flight.point(at: releaseT), to: flight.point(at: endT),
                                     arc: .pitch(flight, from: releaseT, to: endT)))
        let pop = release + endT - releaseT
        script.actors[fielder(2)].act(.glove, at: pop, toward: Ballpark.rubber)
        returnThrow(from: rest.spot(2), at: pop + 0.55)
    }

    /// The first baseman rolls a grounder to an infielder, who throws it back.
    mutating func groundBall(at start: Double) {
        let to = [4, 5, 6][Int(random.next() * 3) % 3]
        let a = rest.spot(3), b = rest.spot(to)
        var roll = Flight(start: start, end: start + 0.95, from: FieldPoint(a, z: 2), to: FieldPoint(b, z: 0.4), arc: .bounce(3), ease: .out)
        roll.fresh = true
        script.flights.append(roll)
        script.actors[fielder(3)].act(.throwBall, at: start, toward: b)
        script.actors[fielder(to)].act(.scoop, at: start + 0.95, toward: a)
        let d = hypot(a.x - b.x, a.y - b.y), length = min(max(d / 160 + 0.08, 0.3), 0.75)
        script.flights.append(Flight(start: start + 1.3, end: start + 1.3 + length, from: FieldPoint(b, z: 5), to: FieldPoint(a, z: 4.5),
                                     arc: .arc(2 + d * 0.03)))
        script.actors[fielder(to)].act(.throwBall, at: start + 1.3, toward: a)
        script.actors[fielder(3)].act(.glove, at: start + 1.3 + length, toward: b)
        script.ballGone = start + 1.3 + length + 0.05
    }

    /// A review (or a hold-up on the field): the infielders drift in toward
    /// the mound and wait, the catcher up out of his crouch; back after.
    mutating func huddle() {
        for n in 3...6 {
            let spot = rest.spot(n), toward = rest.spot(1)
            let d = max(hypot(toward.x - spot.x, toward.y - spot.y), 1), step = random.between(6, 16)
            script.actors[fielder(n)].move(to: [CGPoint(x: spot.x + (toward.x - spot.x) / d * step, y: spot.y + (toward.y - spot.y) / d * step)],
                                           from: 0.3 + random.between(0, 0.4), to: 1.6)
            script.actors[fielder(n)].move(to: [spot], from: 2.6 + random.between(0, 0.3), to: 3.6)
        }
        script.actors[fielder(2)].rise = [0.2...3.4]
        caption(.tag, at: 0.1)
        script.duration = 3.8
        looks = [(0, .rest)]
    }

    mutating func delay(_ d: PlayBeat.Delay) {
        caption(.tag, at: 0.1)
        looks = [(0, .rest)]
        switch d {
        case let .injury(hurt):
            // The trainer and the manager out to him, from his team's dugout.
            let spot = PlayScript.hurt(hurt)
            let dugout = hurt == .batter ? battingDugout : fieldingDugout
            let team: PlayScript.Team = hurt == .batter ? .batting : .fielding
            for (k, end) in [CGPoint(x: spot.x + 4, y: spot.y - 2), CGPoint(x: spot.x - 4, y: spot.y + 1)].enumerated() {
                var a = Actor(team: team, at: dugout, role: .coach, appear: 0.1 + Double(k) * 0.35)
                a.move(to: [end], from: 0.2 + Double(k) * 0.35, to: 2.0 + Double(k) * 0.35)
                script.actors.append(a)
            }
            script.duration = 2.9
            looks = [(0, .rest), (0.3, CameraFrame.fitting(PlayScript.Shot.region([FieldPoint(spot), FieldPoint(dugout), FieldPoint(x: 0, y: 30)]),
                                                             headroom: CameraFrame.headroom)), (2.0, .rest)]
        case .onField:
            huddle()
        case .weather:
            guard rest.standing != .tarp else {
                // Already under the tarp (MLB's status said so first).
                script.duration = 1.2
                return
            }
            // Everyone off, and the tarp out over the infield.
            for i in script.actors.indices {
                let a = script.actors[i]
                // (The umpires off behind the plate.)
                let dugout = a.team == .official ? CGPoint(x: 0, y: -70) : a.team == .fielding ? fieldingDugout : battingDugout
                let from = a.position(at: 0), dd = max(hypot(dugout.x - from.x, dugout.y - from.y), 1), jog = min(dd / 38, 1.8)
                let f = min(jog * 38 / dd, 1), start = 0.2 + random.between(0, 0.4)
                script.actors[i].move(to: [CGPoint(x: from.x + (dugout.x - from.x) * f, y: from.y + (dugout.y - from.y) * f)], from: start,
                                      to: start + jog, ease: .linear)
                script.actors[i].vanish = start + jog - Actor.fade
            }
            script.tarp = PlayScript.Tarp(at: 1.0, out: true)
            script.duration = 1.0 + PlayScript.Tarp.roll + 0.3
        case .resuming:
            script = Self.field(PlayScript.Rest(standing: .tarp), arm: nil)
            caption(.tag, at: 0.1)
            script.duration = 1.2
        case .over:
            // The tarp comes off and the team in the field takes it again.
            var after = rest
            after.standing = nil
            script = Self.field(PlayScript.Rest(standing: .tarp), arm: nil)
            script.tarp = PlayScript.Tarp(at: 0.1, out: false)
            caption(.tag, at: 0.1)
            var arrived = PlayScript.Tarp.roll
            for n in 1...9 {
                let spot = after.spot(n), dd = max(hypot(spot.x - fieldingDugout.x, spot.y - fieldingDugout.y), 1), jog = min(dd / 38, 2.0)
                let f = max(1 - jog * 38 / dd, 0), start = PlayScript.Tarp.roll * 0.6 + random.between(0, 0.4)
                var a = Actor(team: .fielding, at: CGPoint(x: fieldingDugout.x + (spot.x - fieldingDugout.x) * f,
                                                           y: fieldingDugout.y + (spot.y - fieldingDugout.y) * f),
                              role: .fielder(n), appear: start - 0.1, crouch: n == 2)
                a.move(to: [spot], from: start, to: start + jog, ease: .out)
                script.actors.append(a)
                arrived = max(arrived, start + jog)
            }
            if let bats = after.bats {
                script.actors.append(Actor(team: .batting, at: Ballpark.box(bats), role: .batter, appear: arrived, bats: bats))
            }
            for base in 1...3 where after.bases[base - 1] {
                script.actors.append(Actor(team: .batting, at: Ballpark.lead(base), appear: arrived))
            }
            // The plate umpire, back out from behind it.
            var umpire = Actor(team: .official, at: CGPoint(x: 0, y: -40), role: .umpire, appear: PlayScript.Tarp.roll * 0.5)
            umpire.move(to: [Ballpark.umpire(after.bats)], from: PlayScript.Tarp.roll * 0.5 + 0.1, to: PlayScript.Tarp.roll * 0.5 + 1.8)
            script.actors.append(umpire)
            script.duration = arrived + 0.4
        }
    }

    // MARK: Camera

    /// The camera through the beat: each look eased in over half a second,
    /// followed on the broadcast spring, resting at `to`.
    mutating func shoot(from: CameraFrame, to: CameraFrame) {
        let duration = script.duration
        guard looks.count > 1 || from != .rest || to != .rest else {
            script.camera = CameraTrack()
            return
        }
        var keys = looks.isEmpty ? [(at: 0.0, frame: from)] : looks
        keys[0].frame = from
        if keys.count > 1, keys[keys.count - 1].frame == .rest { keys[keys.count - 1].frame = to } else { keys.append((max(duration - 0.8, 0), to)) }
        func goal(_ t: Double) -> CameraFrame {
            let k = keys.lastIndex { $0.at <= t } ?? 0
            guard k > 0 else { return keys[0].frame }
            let u = min(max((t - keys[k].at) / 0.5, 0), 1)
            return keys[k - 1].frame.mix(keys[k].frame, u * u * (3 - 2 * u))
        }
        var samples = CameraFollow.samples(until: duration, goal: goal)
        // Landed exactly where it rests: the last few frames close the gap.
        let tail = Int(0.35 * CameraTrack.rate)
        for i in max(samples.count - tail, 0)..<samples.count {
            let u = Double(i - (samples.count - tail)) / Double(max(tail - 1, 1))
            samples[i] = samples[i].mix(to, u * u * (3 - 2 * u))
        }
        script.camera = CameraTrack(samples: samples, rest: to)
    }
}

// MARK: - Idle

/// The field's life between pitches, so it never looks frozen: a move every
/// few seconds, a second or two long, then still. Which moves fit what's on
/// the field (a lead off only with a runner on, the warm-up throws only
/// between halves), and which comes next is the seed's, never the same one
/// twice running.
enum IdleBeat: Equatable, CaseIterable {
    /// The pitcher leans in for the sign.
    case sign
    case practiceSwing
    /// A couple of fielders shift their weight.
    case weight
    /// A runner stretches his lead and comes back.
    case lead
    /// The catcher up out of his crouch, and down again.
    case catcher
    /// Between halves: a warm-up pitch, a grounder round the infield, the outfielders' toss.
    case warmup, infield, outfield
    /// An injury delay: the trainer and the manager shift where they stand.
    case trainer
    /// Between halves: the plate umpire round the catcher to dust off the plate, and back.
    case brush

    /// The moves that fit the field as it stands.
    static func fitting(_ rest: PlayScript.Rest, between: Bool) -> [IdleBeat] {
        switch rest.standing {
        case .tarp: return []
        case .injury: return [.trainer, .weight]
        case nil: break
        }
        if between { return [.warmup, .infield, .outfield, .weight, .brush] }
        var out: [IdleBeat] = [.sign, .weight, .catcher]
        if rest.bats != nil { out.append(.practiceSwing) }
        if rest.bases.contains(true) { out.append(.lead) }
        return out
    }

    /// The `n`th move after the field came to rest, and how long before it
    /// (4.5–8 s of stillness): nil when nothing fits (a tarp, Reduce Motion
    /// is the stage's). (pure; tested)
    static func next(_ n: Int, rest: PlayScript.Rest, between: Bool, seed: UInt64) -> (beat: IdleBeat, wait: Double)? {
        let options = fitting(rest, between: between)
        guard !options.isEmpty else { return nil }
        // Each pick in turn from the first: never the same move twice running.
        var pick = -1, wait = 0.0
        for k in 0...max(n, 0) {
            var r = BeatRandom(seed &+ UInt64(k) &* 7919)
            wait = r.between(4.5, 8)
            var next = Int(r.next() * Double(options.count)) % options.count
            if next == pick, options.count > 1 { next = (next + 1) % options.count }
            pick = next
        }
        return (options[pick], wait)
    }
}

extension PlayScript {
    /// One idle move on the field as it stands: it starts and ends there.
    init(idle: IdleBeat, rest: Rest, seed: UInt64, arm: PlayScene.Hand? = nil) {
        let beat = PlayBeat(id: "idle.\(seed)", kind: .timeout, arm: arm)
        var b = BeatBuilder(beat: beat, rest: rest)
        b.idle(idle)
        b.script.flights.sort { $0.start < $1.start }
        b.script.settle = b.script.duration
        self = b.script
        measureBodies()
    }
}

extension BeatBuilder {
    mutating func idle(_ kind: IdleBeat) {
        script.duration = 1.4
        switch kind {
        case .sign:
            script.actors[0].sign = 0.1...1.05
            script.duration = 1.3
        case .practiceSwing:
            if let batter { script.actors[batter].practice = 0.1 }
            script.duration = 1.4
        case .weight:
            let pool = [3, 4, 5, 6, 7, 8, 9]
            let i = Int(random.next() * 7) % 7, j = (i + 1 + Int(random.next() * 5)) % 7
            for n in [pool[i], pool[j]] {
                let spot = rest.spot(n), side = random.next() < 0.5 ? -1.0 : 1.0, d = max(Ballpark.distance(spot), 1)
                // Across his line to the plate, a step and back.
                let across = CGPoint(x: spot.x + spot.y / d * side * random.between(1.2, 2.4), y: spot.y - spot.x / d * side * random.between(1.2, 2.4))
                let start = random.between(0, 0.25)
                script.actors[fielder(n)].move(to: [across], from: start, to: start + 0.45, ease: .inOut)
                script.actors[fielder(n)].move(to: [spot], from: start + 0.75, to: start + 1.2, ease: .inOut)
            }
            script.duration = 1.5
        case .lead:
            let on = runner.sorted { $0.key < $1.key }
            guard !on.isEmpty else { return }
            let (base, index) = on[Int(random.next() * Double(on.count)) % on.count]
            let lead = Ballpark.lead(base), next = Ballpark.base(base + 1)
            let d = max(hypot(next.x - lead.x, next.y - lead.y), 1), step = random.between(2.5, 4.5)
            script.actors[index].move(to: [CGPoint(x: lead.x + (next.x - lead.x) / d * step, y: lead.y + (next.y - lead.y) / d * step)],
                                      from: 0.1, to: 0.55, ease: .out)
            script.actors[index].move(to: [lead], from: 0.95, to: 1.45)
            script.duration = 1.6
        case .catcher:
            script.actors[fielder(2)].rise = [0.1...1.1]
            script.duration = 1.4
        case .warmup:
            warmUp(at: 0.1)
        case .infield:
            groundBall(at: 0.15)
            script.duration = (script.flights.map(\.end).max() ?? 1) + 0.3
        case .outfield:
            let a = rest.spot(7), b = rest.spot(8)
            let d = hypot(a.x - b.x, a.y - b.y)
            var toss = Flight(start: 0.25, end: 1.15, from: FieldPoint(a, z: 5.5), to: FieldPoint(b, z: 5), arc: .arc(10 + d * 0.06))
            toss.fresh = true
            script.flights.append(toss)
            script.actors[fielder(7)].act(.throwBall, at: 0.25, toward: b)
            script.actors[fielder(8)].act(.glove, at: 1.15, toward: a)
            script.flights.append(Flight(start: 1.45, end: 2.35, from: FieldPoint(b, z: 5.5), to: FieldPoint(a, z: 5), arc: .arc(10 + d * 0.06)))
            script.actors[fielder(8)].act(.throwBall, at: 1.45, toward: a)
            script.actors[fielder(7)].act(.glove, at: 2.35, toward: b)
            script.ballGone = 2.4
            script.duration = 2.6
        case .brush:
            guard let u = script.umpire else { return }
            let spot = script.actors[u].at, side = spot.x < 0 ? -1.0 : 1.0
            // Round the catcher on his own side, a bend over the plate, and back.
            script.actors[u].move(to: [CGPoint(x: side * 3.6, y: -6), CGPoint(x: side * 1.2, y: 2.4)], from: 0.1, to: 1.0)
            script.actors[u].act(.scoop, at: 1.25, toward: .zero)
            script.actors[u].move(to: [CGPoint(x: side * 3.6, y: -6), spot], from: 1.75, to: 2.65)
            script.duration = 2.8
        case .trainer:
            for (i, a) in script.actors.enumerated() where a.role == .coach {
                let p = a.at
                script.actors[i].move(to: [CGPoint(x: p.x + random.between(-1.5, 1.5), y: p.y + random.between(-1, 1))], from: 0.1, to: 0.6)
                script.actors[i].move(to: [p], from: 0.9, to: 1.4)
            }
            script.duration = 1.5
        }
        if case .warmup = kind { script.duration = max(script.flights.map(\.end).max() ?? 1, 1) + 0.3 }
    }
}
