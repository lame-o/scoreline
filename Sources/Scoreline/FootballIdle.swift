import SwiftUI

// What the football theater shows between snaps, so a live game never looks
// frozen: the time between plays as it really goes. The offense huddles a
// few yards behind the ball while the defense gathers across from it, then
// breaks, jogs to the real line of scrimmage and lines up in the set it uses
// (the last snap's, else what the down and distance call for), and every few
// seconds something happens before the snap: a man in motion, a safety
// creeping down, the quarterback's audible. The game's own stoppages, as
// ESPN posts them, have their own: a timeout sends the team that called it
// to its bench; a TV timeout (ESPN's "Official Timeout") or the two-minute
// warning empties the field to both sidelines; the end of a quarter turns the
// field round as the teams change ends; at halftime they leave; a man hurt on
// the play stays down while the trainers come out; a challenge's red flag
// comes in from the bench while the teams wait. Then they come back, huddle
// and line up again. No officials: nothing in the data has them doing
// anything on the field, and standing there they only got in the way.
//
// Each is a script like a snap's (FootballScript.swift), a pure function of
// what the feed said and t, so the harness can draw any moment of it. They
// move in sparse beats (a second or two of motion, then still for several):
// the stage animates only through a beat and draws a still frame between
// them, and past the opening the pre-snap beats loop. Where the data is
// silent (who goes in motion, where a man stands on the sideline), the
// choices are seeded from the entry's ID: never canned, the same every time.

// MARK: - Stoppages

/// A stop in play as ESPN's play-by-play posts it (entries that aren't
/// snaps): a team's timeout ("Timeout #1 by PHI at 13:55.", college's
/// "Timeout Alabama, clock 11:24"), a TV timeout ("Official Timeout at
/// 12:30."), the two-minute warning, the end of a quarter or the half, the end
/// of the game.
struct FootballStoppage: Equatable, Identifiable {
    enum Kind: Equatable {
        case timeout, official, twoMinuteWarning, endOfPeriod, halftime, endOfGame
    }

    let id: String
    var kind: Kind
    /// The team that called a timeout (its letters or name in the text; the entry's own team is the one with the ball).
    var side: GameDetail.Side?
    /// "Timeout #2": the team's second of the half.
    var number: Int?
    var period: Int?
    /// "13:55".
    var clock: String?
    var sequence = 0.0
    var wallclock: Date?
    var text = ""

    /// A stoppage entry; nil for a snap, a kick, the coin toss. (pure; tested)
    static func parse(_ item: JSON, teams: FootballFeed.Teams) -> FootballStoppage? {
        guard let id = item["id"].string else { return nil }
        let text = item["text"].string ?? ""
        let period = item["period"]["number"].int
        var kind: Kind
        switch (item["type"]["text"].string ?? "").lowercased() {
        case "timeout": kind = .timeout
        case "official timeout": kind = .official
        case "two-minute warning": kind = .twoMinuteWarning
        case "end period", "end of regulation": kind = .endOfPeriod
        case "end of half": kind = .halftime
        case "end of game": kind = .endOfGame
        default: return nil
        }
        // College ends its second quarter as an "End Period".
        if kind == .endOfPeriod, period == 2 { kind = .halftime }
        var stoppage = FootballStoppage(id: id, kind: kind, period: period, clock: item["clock"]["displayValue"].string,
                                        sequence: Double(item["sequenceNumber"].string ?? "") ?? item["sequenceNumber"].double ?? 0,
                                        wallclock: item["wallclock"].string.flatMap(FootballScene.date), text: text)
        if kind == .timeout {
            if let m = text.firstMatch(of: #/Timeout #(\d+) by ([A-Z]{2,4})/#) {
                stoppage.number = Int(m.1)
                stoppage.side = teams.isHome(String(m.2)).map { $0 == teams.topIsHome ? .top : .bottom }
            } else if let m = text.firstMatch(of: #/^Timeout ([^,]+?),/#) {
                stoppage.side = teams.side(named: String(m.1))
            }
        }
        return stoppage
    }
}

extension FootballScene {
    /// An entry's wallclock.
    static func date(_ s: String) -> Date? { stamp.date(from: s) }
    nonisolated(unsafe) private static let stamp = ISO8601DateFormatter()
}

// MARK: - Which way the field faces

/// Which end each team attacks on the viewer's screen, as a TV broadcast
/// shows it from the press box. ESPN doesn't say which physical end zone is
/// whose; the default has the top team attacking the right end zone (as the
/// drive chart under the theater draws it) in the first and third quarters
/// and overtime, the left one in the second and fourth, the teams changing
/// ends every quarter. The viewer's flip turns it round for the game, and the
/// quarters still turn it after that. The theater stands behind the offense
/// either way: attacking the screen's right it looks up the field to the
/// right, attacking its left, up the field to the left. (pure; tested)
enum FieldFacing {
    static func topAttacksRight(period: Int?, flipped: Bool) -> Bool {
        ((period ?? 1) % 2 == 1) != flipped
    }

    static func attacksRight(_ offense: GameDetail.Side?, period: Int?, flipped: Bool) -> Bool {
        ((offense ?? .top) == .top) == topAttacksRight(period: period, flipped: flipped)
    }

    /// The camera's yaw for an offense: the field turned a third of the way
    /// round toward the end it attacks.
    static func yaw(_ offense: GameDetail.Side?, period: Int?, flipped: Bool) -> Double {
        attacksRight(offense, period: period, flipped: flipped) ? Gridiron.yaw : -Gridiron.yaw
    }

    /// The sideline nearest the camera, in the offense's frame (its right is
    /// +x): its right when it attacks the screen's right.
    static func near(yaw: Double) -> Double { yaw >= 0 ? 1 : -1 }
}

// MARK: - Idle

/// What the field does now, between snaps.
struct FootballIdle: Equatable {
    enum Phase: Equatable {
        /// Huddle, break, line up, and the looks before the snap.
        case between
        /// After a score: the kickoff team lined up across the field at its spot.
        case kickoff
        /// A team's timeout (nil: ESPN didn't say whose).
        case timeout(GameDetail.Side?)
        /// A TV timeout or the two-minute warning: both teams to their sidelines.
        case commercial
        /// The end of a quarter: the teams change ends, the field turning to this yaw.
        case quarter(turnTo: Double)
        /// The half, or the game, over: off the field.
        case off
        case injury(FootballScene.Injury)
        case review(FootballScene.Review)
    }

    var phase: Phase
    /// The team with the ball (on a kickoff, the team kicking).
    var offense: GameDetail.Side
    /// The spot, in the offense's yards, and the line to gain.
    var yard: Double
    var gain: Double?
    var hash = FootballScene.Lane.middle
    var formation = FootballScene.Formation.base
    var shotgun = true
    /// The play's strong side: where the tight end lines up.
    var strong = FootballScene.Lane.right
    var front: FootballDepthChart.Front?
    var yaw = Gridiron.yaw
    /// The offense's bench, by its sideline's sign in its frame: the home
    /// team's across the field from the camera, the visitors' on its side.
    var bench = 1.0
    var seed: UInt64 = 0

    /// What the field does after the last snap and whatever ESPN posted
    /// since: the stoppage if there is one (a timeout, a TV timeout, the
    /// quarter's end), else the snap's own aftermath (a challenge, a man
    /// down), else the next snap's huddle, or the kickoff after a score. The
    /// set comes from the offense's own last snap where it has one; else the
    /// down and distance (the gun on a long third down, heavy at the goal line).
    /// (pure; tested)
    static func make(play: FootballScene?, stoppage: FootballStoppage?, rest: FootballScript.Rest, offense: GameDetail.Side,
                     down: FootballScene.Down?, kickoff: Bool, flipped: Bool) -> FootballIdle {
        let period = stoppage?.period ?? play?.period
        let seedID = stoppage?.id ?? play.map { $0.id + "-after" } ?? "rest-\(Int(rest.yard))"
        var random = SplitMix64(seed: Celebration.seed(seedID))
        var offense = offense, yard = rest.yard
        if kickoff, let play, let scorer = play.scorer {
            // After a score the team that scored kicks off from its 35 (after a safety, the team scored on).
            offense = play.scoring == .safety ? FootballScene.opponent(scorer) : scorer
            yard = 35
        }
        var idle = FootballIdle(phase: kickoff ? .kickoff : .between, offense: offense, yard: yard, gain: kickoff ? nil : rest.gain)
        idle.seed = Celebration.seed(seedID)
        idle.yaw = FieldFacing.yaw(offense, period: period, flipped: flipped)
        // American football lists the visitors first: the bottom team is at home, its bench across the field.
        let far = -FieldFacing.near(yaw: idle.yaw)
        idle.bench = offense == .bottom ? far : -far
        idle.hash = play?.nextHash ?? .middle
        // The set: the offense's own last one, else the situation's.
        let goalLine = rest.yard >= 97
        if let play, play.offense == offense, play.pointAfter == nil, ![.punt, .kickoff, .kneel].contains(play.kind),
           !(play.kind == .fieldGoal(good: true) || play.kind == .fieldGoal(good: false)) {
            idle.formation = play.formation == .victory ? .base : play.formation
            idle.shotgun = play.shotgun
        } else if let down, down.distance <= 2 || goalLine {
            idle.formation = .heavy
            idle.shotgun = false
        } else if let down, down.down >= 3, down.distance >= 6 {
            idle.formation = random.in(0...1) < 0.3 ? .empty : .base
            idle.shotgun = true
        } else {
            idle.formation = random.in(0...1) < 0.2 ? .bunch : .base
            idle.shotgun = random.in(0...1) < 0.65
        }
        if goalLine, idle.formation != .heavy { idle.shotgun = false }
        idle.strong = random.in(0...1) < 0.5 ? .left : .right
        if let play, play.offense == offense { idle.front = play.front }
        else if let play, play.defense == offense, let other = play.front { idle.front = other }

        if let stoppage {
            switch stoppage.kind {
            case .timeout: idle.phase = .timeout(stoppage.side)
            case .official, .twoMinuteWarning: idle.phase = .commercial
            case .endOfPeriod:
                idle.phase = .quarter(turnTo: FieldFacing.yaw(offense, period: (stoppage.period ?? 1) + 1, flipped: flipped))
            case .halftime, .endOfGame: idle.phase = .off
            }
        } else if let play, let review = play.review {
            idle.phase = .review(review)
        } else if let play, let hurt = play.injuries.first {
            idle.phase = .injury(hurt)
        }
        return idle
    }

    /// The snap the formation is laid out from: in the gun or under center,
    /// the set, its strength, its hash.
    var lineup: FootballScene {
        var scene = FootballScene(id: "idle", kind: formation == .heavy && !shotgun ? .rush : .pass, offense: offense, from: yard, to: yard)
        scene.formation = formation
        scene.shotgun = shotgun
        scene.hash = hash
        scene.lane = strong
        scene.front = front
        return scene
    }
}

extension FootballScript {
    /// The loop the beats settle into: from `start`, every `period` seconds.
    struct Loop: Equatable {
        var start: Double
        var period: Double
    }

    /// The field turning: the yaw from one end to the other.
    struct Turn: Equatable {
        var from: Double
        var to: Double
        var start: Double
        var end: Double
    }

    /// The camera's yaw at t: the script's own, or partway through a turn.
    func yaw(at t: Double) -> Double {
        guard let turn else { return yaw }
        let u = PlayScript.Ease.inOut.value((t - turn.start) / max(turn.end - turn.start, 0.01))
        return turn.from + (turn.to - turn.from) * u
    }

    /// The script's time for `elapsed` seconds of idle: straight through,
    /// then round the loop. (pure; tested)
    func idleTime(_ elapsed: Double) -> Double {
        guard let loop, loop.period > 0, elapsed > loop.start + loop.period else { return min(max(elapsed, 0), max(duration, 0)) }
        return loop.start + (elapsed - loop.start).truncatingRemainder(dividingBy: loop.period)
    }

    /// Whether anything moves at t (a beat), and when the next beat begins
    /// after t (script time, past the loop's end coming round again).
    func moving(at t: Double) -> Bool { beats.contains { t >= $0.lowerBound && t < $0.upperBound } }

    func nextBeat(after t: Double) -> Double? {
        if let next = beats.first(where: { $0.lowerBound > t })?.lowerBound { return next }
        guard let loop, let first = beats.first(where: { $0.lowerBound >= loop.start }) else { return nil }
        return first.lowerBound + loop.period
    }

    /// Between snaps, or through a stoppage: the field alive (FootballIdle).
    init(idle: FootballIdle) {
        var b = Builder(scene: idle.lineup, line: Gridiron.y(idle.yard), shotgun: idle.shotgun)
        b.script.yaw = idle.yaw
        if idle.phase == .kickoff {
            b.kickoffFormation(returner: CGPoint(x: 6, y: Gridiron.y(idle.yard + 62)))
        } else {
            b.scrimmage()
        }
        b.idle(idle)
        self = b.script
        measureBodies()
    }
}

/// What the idle's camera keeps in frame for a while: these men and spots.
struct IdleFocus {
    var from: Double
    var until: Double
    var players: [Int]
    var points: [FieldPoint] = []
    /// No closer than this (feet top to bottom).
    var closest = 60.0
}

extension FootballScript.Builder {
    typealias Player = FootballScript.Player
    typealias Hold = FootballScript.Hold

    /// The idle's beats (see FootballIdle).
    mutating func idle(_ idle: FootballIdle) {
        var random = SplitMix64(seed: idle.seed)
        let kickoff = idle.phase == .kickoff
        script.legs = [FootballScript.Leg(from: 0, until: 0, hand: .spot(kickoff ? FieldPoint(x: ballX, y: line, z: 0.9) : spot))]
        script.lines = FootballScript.Lines(scrimmage: kickoff ? nil : line, gain: kickoff ? nil : idle.gain.map(Gridiron.y))
        script.next = script.lines
        // Everyone set as the last snap left them; out of their stances as they turn away.
        for i in script.players.indices where script.players[i].set != nil { script.players[i].set = 0.35 }

        var t = 0.0
        var back = true
        var focus: [IdleFocus] = []
        switch idle.phase {
        case .between:
            break
        case .kickoff:
            // The kicker sets the ball on the tee and walks back to his run-up before the loop.
            back = false
            t = 4.6
        case let .timeout(side):
            t = sidelines(idle, teams: side.map { [$0 == idle.offense ? .offense : .defense] } ?? [], random: &random, hold: 34)
        case .commercial:
            t = sidelines(idle, teams: [.offense, .defense], random: &random, hold: 44)
        case let .quarter(turnTo):
            // They gather while the field turns: the teams have changed ends.
            huddles(from: 0.4, random: &random)
            script.turn = FootballScript.Turn(from: idle.yaw, to: turnTo, start: 1.0, end: 4.2)
            t = 7
            back = false
            lineUp(from: t, random: &random)
            t += 3.2
        case .off:
            leave(idle, random: &random)
            script.ballGone = 4.6
            script.duration = 6
            script.settle = 6
            finishIdle()
            return
        case let .injury(hurt):
            t = injury(hurt, idle: idle, random: &random, focus: &focus)
        case let .review(review):
            t = self.review(review, idle: idle, random: &random, focus: &focus)
        }
        if back {
            // Back to the huddle, a breath, the break, and the line-up.
            huddles(from: t + 0.4, random: &random)
            t += 7
            lineUp(from: t, random: &random)
            t += 3.2
        }
        // The looks before the snap, round and round.
        let start = t + 1.5
        let period = kickoff ? kickoffLooks(from: start, random: &random) : preSnap(from: start, random: &random)
        script.loop = FootballScript.Loop(start: start, period: period)
        script.duration = start + period
        script.settle = script.duration
        finishIdle(focus: focus)
    }

    /// The players of a team in the formation (not the staff).
    func team(_ team: FootballScript.Team) -> [Int] { script.players.indices.filter { script.players[$0].team == team } }

    /// Where a man stands in the formation: his place at the line.
    func home(_ i: Int) -> CGPoint { script.players[i].at }

    /// Both teams into their huddles: the offense in a ring a few yards
    /// behind the ball, its quarterback facing them; the defense gathered
    /// across the line, looking in at its caller.
    mutating func huddles(from start: Double, random: inout SplitMix64) {
        let gun = CGPoint(x: ballX + random.in(-4...4), y: line - random.in(21...27))
        let offense = team(.offense), defense = team(.defense)
        let qb = at(.quarterback)
        ring(offense, around: gun, radius: 7.5, first: qb, from: start, random: &random)
        let gather = CGPoint(x: ballX + random.in(-8...8), y: line + random.in(18...26))
        ring(defense, around: gather, radius: 8.5, first: nil, from: start, random: &random)
    }

    /// Men into a ring round a point, each facing in; `first` at the near
    /// side (toward the line), facing the rest.
    mutating func ring(_ men: [Int], around c: CGPoint, radius: Double, first: Int?, from start: Double, random: inout SplitMix64) {
        let ordered = (first.map { [$0] } ?? []) + men.filter { $0 != first }.sorted { home($0).x < home($1).x }
        for (k, i) in ordered.enumerated() {
            let a = .pi / 2 + Double(k) / Double(max(ordered.count, 1)) * 2 * .pi
            let r = radius * (k == 0 && first != nil ? 0.7 : 1) + random.in(-0.8...0.8)
            let p = CGPoint(x: c.x + cos(a) * r * 1.25, y: c.y + sin(a) * r)
            let here = position(i, start), d = hypot(p.x - here.x, p.y - here.y)
            let leave = start + random.in(0...0.35)
            move(i, to: [p], from: leave, to: leave + min(max(d / 11, 0.8), 3.2), ease: .inOut)
            script.players[i].looks.append(FootballScript.Look(from: leave + 0.2, point: c))
        }
    }

    /// The break: from wherever they are to their places at the line (the
    /// linemen first, the men out wide last), and into their stances.
    mutating func lineUp(from start: Double, random: inout SplitMix64) {
        var latest = start
        for i in team(.offense) + team(.defense) {
            let p = home(i), here = position(i, start), d = hypot(p.x - here.x, p.y - here.y)
            let wide = abs(p.x - ballX) > 30
            let leave = start + (wide ? random.in(0.2...0.5) : random.in(0...0.25))
            let arrive = leave + min(max(d / 13, 0.9), 3.4)
            move(i, to: [p], from: leave, to: arrive, ease: .inOut)
            let way: Double = script.players[i].team == .offense ? 1 : -1
            script.players[i].looks.append(FootballScript.Look(from: arrive - 0.3, point: CGPoint(x: p.x, y: p.y + 60 * way)))
            if script.players[i].set != nil { script.players[i].resets = arrive + 0.35 }
            latest = max(latest, arrive)
        }
    }

    /// The looks before the snap, a loop that comes back to where it began: a
    /// man in motion across the formation and his man going with him, a
    /// safety walking down into the box, the quarterback's hand up for the
    /// audible as the motion comes back, the safety back out. Returns its period.
    mutating func preSnap(from start: Double, random: inout SplitMix64) -> Double {
        let period = 24.0
        let motionAt = start + random.in(2.4...3.6), audibleAt = start + random.in(13.5...14.5)
        let motion = (players(.offense, .receiver) + players(.offense, .tightEnd))
            .filter { script.players[$0].set == nil && abs(home($0).x - ballX) > 12 }
        if !motion.isEmpty {
            let man = motion[Int(random.in(0...0.999) * Double(motion.count))]
            let p = home(man), side: Double = p.x > ballX ? 1 : -1
            let across = CGPoint(x: ballX - side * (abs(p.x - ballX) * 0.35 + 7), y: p.y - 1.5)
            move(man, to: [across], from: motionAt, to: motionAt + 1.7, ease: .inOut)
            move(man, to: [p], from: audibleAt + 1.2, to: audibleAt + 2.9, ease: .inOut)
            // His man goes with him.
            if let cover = nearest(.defense, to: p, at: 0, roles: [.corner, .backer, .safety]) {
                let q = home(cover), shift = CGPoint(x: q.x + (across.x - p.x) * 0.55, y: q.y)
                move(cover, to: [shift], from: motionAt + 0.15, to: motionAt + 1.8, ease: .inOut)
                move(cover, to: [q], from: audibleAt + 1.3, to: audibleAt + 3.0, ease: .inOut)
            }
        }
        // A safety creeps down, then back.
        let safeties = players(.defense, .safety)
        if !safeties.isEmpty {
            let s = safeties[Int(random.in(0...0.999) * Double(safeties.count))]
            let q = home(s), downAt = start + random.in(8.5...9.5), upAt = start + random.in(19.5...20.5)
            let box = CGPoint(x: ballX + (q.x - ballX) * 0.55, y: line + random.in(18...26))
            move(s, to: [box], from: downAt, to: downAt + 1.5, ease: .inOut)
            move(s, to: [q], from: upAt, to: upAt + 1.6, ease: .inOut)
        }
        if let qb = at(.quarterback) {
            script.players[qb].holds.append(Hold(kind: .fairCatch, from: audibleAt, until: audibleAt + 0.9))
        }
        return period
    }

    /// After a score: the kicker sets the ball on the tee, walks back to his
    /// run-up, and his hand goes up when he's ready; the coverage shuffles.
    mutating func kickoffLooks(from start: Double, random: inout SplitMix64) -> Double {
        let period = 18.0
        guard let kicker = at(.kicker) else { return period }
        let p = home(kicker)
        move(kicker, to: [CGPoint(x: ballX + 1, y: line - 1.5)], from: 0.6, to: 1.8, ease: .inOut)
        move(kicker, to: [p], from: 2.6, to: 4.2, ease: .inOut)
        let ready = start + random.in(5.5...6.5)
        script.players[kicker].holds.append(Hold(kind: .fairCatch, from: ready, until: ready + 1))
        let cover = (0..<10).compactMap { at(.cover($0)) }
        for k in 0..<min(2, cover.count) {
            let i = cover[Int(random.in(0...0.999) * Double(cover.count))], q = home(i), at = start + random.in(10...12) + Double(k) * 0.4
            move(i, to: [CGPoint(x: q.x + random.in(-4...4), y: q.y - random.in(1...3))], from: at, to: at + 0.8, ease: .inOut)
            move(i, to: [q], from: at + 3.5, to: at + 4.3, ease: .inOut)
        }
        return period
    }

    /// A team to its bench (or both): it jogs off to its sideline and stands
    /// in a loose knot there; a team that stays gathers on the field. A man
    /// or two moves every several seconds. Returns when they come back.
    mutating func sidelines(_ idle: FootballIdle, teams: [FootballScript.Team], random: inout SplitMix64, hold: Double) -> Double {
        for side in [FootballScript.Team.offense, .defense] {
            let men = team(side)
            if teams.contains(side) {
                let bench = (side == .offense ? idle.bench : -idle.bench) * (Gridiron.half + random.in(2...8))
                let c = CGPoint(x: bench, y: line + random.in(-20...20))
                for i in men {
                    let p = CGPoint(x: c.x - (bench > 0 ? 1 : -1) * random.in(0...22), y: c.y + random.in(-24...24))
                    let here = position(i, 0.4), d = hypot(p.x - here.x, p.y - here.y)
                    let leave = 0.4 + random.in(0...0.6)
                    move(i, to: [p], from: leave, to: leave + min(max(d / 14, 1), 6), ease: .inOut)
                    script.players[i].looks.append(FootballScript.Look(from: leave + 6, point: CGPoint(x: 0, y: c.y)))
                }
            } else {
                let c = CGPoint(x: ballX + random.in(-6...6), y: line + (side == .offense ? -1 : 1) * random.in(16...24))
                ring(men, around: c, radius: 9, first: side == .offense ? at(.quarterback) : nil, from: 0.4, random: &random)
            }
        }
        shuffles(team(.offense) + team(.defense), from: 9, until: hold, random: &random)
        return hold
    }

    /// Every several seconds a man or two takes a few steps.
    mutating func shuffles(_ men: [Int], from start: Double, until end: Double, random: inout SplitMix64) {
        guard !men.isEmpty else { return }
        var t = start + random.in(0...2)
        while t < end - 2 {
            for _ in 0..<2 {
                let i = men[Int(random.in(0...0.999) * Double(men.count))], here = position(i, t)
                move(i, to: [CGPoint(x: here.x + random.in(-9...9), y: here.y + random.in(-7...7))], from: t, to: t + random.in(0.8...1.3), ease: .inOut)
            }
            t += random.in(6.5...9.5)
        }
    }

    /// The half (or the game) over: both teams jog off to their benches and
    /// out of sight; the field stands empty.
    mutating func leave(_ idle: FootballIdle, random: inout SplitMix64) {
        for i in script.players.indices {
            let side: Double = switch script.players[i].team {
            case .offense: idle.bench
            case .defense: -idle.bench
            default: random.sign()
            }
            let here = position(i, 0.4)
            let p = CGPoint(x: side * (Gridiron.half + random.in(10...20)), y: here.y + random.in(-30...30))
            let leave = 0.4 + random.in(0...0.8), arrive = leave + min(max(hypot(p.x - here.x, p.y - here.y) / 15, 2), 4)
            move(i, to: [p], from: leave, to: arrive, ease: .inOut)
            script.players[i].vanish = arrive - 0.6
        }
    }

    /// A man hurt on the play: down where he was, his teammates on a knee
    /// round him, the other team giving them room, two trainers jogging out
    /// from his bench to him; then he's helped up and off with them, and the
    /// teams come back. Returns when they're back.
    mutating func injury(_ hurt: FootballScene.Injury, idle: FootballIdle, random: inout SplitMix64, focus: inout [IdleFocus]) -> Double {
        let side: FootballScript.Team = hurt.side == idle.offense ? .offense : .defense
        // Who's hurt: a man of his team off the line (ESPN names him, but not where he stood).
        let candidates = team(side).filter { ![.line, .front].contains(script.players[$0].role) }
        let pool = candidates.isEmpty ? team(side) : candidates
        guard !pool.isEmpty else { return 6 }
        let man = pool[Int(random.in(0...0.999) * Double(pool.count))]
        let down = home(man)
        script.players[man].holds.append(Hold(kind: .down, from: 0.5, until: 26))
        var near: [Int] = [man]
        for i in team(.offense) + team(.defense) where i != man {
            let here = home(i), d = hypot(here.x - down.x, here.y - down.y)
            if script.players[i].team == side, d < 45 {
                // His teammates on a knee round him, giving him room.
                let a = atan2(here.y - down.y, here.x - down.x)
                let r = d < 20 ? random.in(13...17) : random.in(22...30)
                let p = CGPoint(x: down.x + cos(a) * r, y: down.y + sin(a) * r)
                if d < 20 { near.append(i) }
                move(i, to: [p], from: 0.6 + random.in(0...0.6), to: 2.4 + random.in(0...0.8), ease: .inOut)
                script.players[i].holds.append(Hold(kind: .kneel, from: 3.4 + random.in(0...1.2), until: 26))
                script.players[i].looks.append(FootballScript.Look(from: 2.5, point: down))
            } else {
                // Back a few yards, out of the way.
                let d = max(hypot(here.x - down.x, here.y - down.y), 1)
                let push = max(36 - d, 6)
                let away = CGPoint(x: here.x + (here.x - down.x) / d * push, y: here.y + (here.y - down.y) / d * push)
                move(i, to: [away], from: 0.8 + random.in(0...0.8), to: 2.8 + random.in(0...1), ease: .inOut)
                if random.in(0...1) < 0.5 { script.players[i].holds.append(Hold(kind: .kneel, from: 4 + random.in(0...2), until: 26)) }
            }
        }
        let bench = (side == .offense ? idle.bench : -idle.bench) * (Gridiron.half + 6)
        for k in 0..<2 {
            let from = CGPoint(x: bench, y: down.y + Double(k) * 8 - 4)
            script.players.append(Player(team: .staff, at: from, role: .staff))
            let trainer = script.players.count - 1
            near.append(trainer)
            let by = CGPoint(x: down.x + (k == 0 ? -4.5 : 4.5), y: down.y + (k == 0 ? 2.5 : -2.5))
            move(trainer, to: [by], from: 1.6 + Double(k) * 0.3, to: 1.6 + Double(k) * 0.3 + min(max(abs(by.x - bench) / 15, 2), 5), ease: .inOut)
            script.players[trainer].holds.append(Hold(kind: .kneel, from: 6.8, until: 24))
            script.players[trainer].looks.append(FootballScript.Look(from: 5, point: down))
            // Up and off with him.
            let off = CGPoint(x: bench * 1.12, y: down.y + Double(k) * 4)
            move(trainer, to: [off], from: 26.2, to: 26.2 + min(max(abs(off.x - by.x) / 9, 3), 8), ease: .inOut)
            script.players[trainer].vanish = 26.2 + min(max(abs(off.x - by.x) / 9, 3), 8) - 0.5
        }
        let off = CGPoint(x: bench * 1.1, y: down.y)
        let walk = min(max(abs(off.x - down.x) / 8, 3), 9)
        move(man, to: [off], from: 26.4, to: 26.4 + walk, ease: .inOut)
        script.players[man].vanish = 26.4 + walk - 0.5
        // The camera on him and the men round him while he's down.
        focus.append(IdleFocus(from: 1.2, until: 26, players: near, points: [FieldPoint(down)], closest: 40))
        return 28
    }

    /// A second look: on a challenge, the red flag in from the bench of the
    /// team that threw it; the teams in loose knots while it's looked at
    /// (the tag says what's under review, then the call). The referee isn't
    /// drawn walking to the monitor: the data has him doing nothing on the
    /// field. Returns when they're back.
    mutating func review(_ review: FootballScene.Review, idle: FootballIdle, random: inout SplitMix64, focus: inout [IdleFocus]) -> Double {
        if review.kind == .challenge {
            let side: Double = review.side.map { $0 == idle.offense ? idle.bench : -idle.bench } ?? -FieldFacing.near(yaw: idle.yaw)
            let from = FieldPoint(x: side * (Gridiron.half + 8), y: line + random.in(-25...25), z: 6)
            let to = CGPoint(x: side * (Gridiron.half - random.in(8...16)), y: from.y + random.in(-6...6))
            script.flags.append(FootballScript.Flag(thrown: 0.7, lands: 1.5, from: from, to: to, red: true))
            script.flashes.append(FootballScript.Flash(beat: .flag, at: 1.5, point: FieldPoint(to)))
            // Thrown by the head coach, at his bench.
            script.players.append(Player(team: .staff, at: CGPoint(x: from.x + side * 2, y: from.y - 2), role: .staff))
            let coach = script.players.count - 1
            script.players[coach].act(.flagThrow, at: 0.7, toward: to)
            script.players[coach].looks.append(FootballScript.Look(from: 0, point: to))
            script.players[coach].vanish = 6
            // The flag coming in, and the field it lands on.
            focus.append(IdleFocus(from: 0, until: 3.4, players: [], points: [FieldPoint(to), from, spot, FieldPoint(x: to.x * 0.4, y: to.y)]))
        }
        // The teams wait in knots on the field.
        let offense = team(.offense), defense = team(.defense)
        ring(offense, around: CGPoint(x: ballX + random.in(-6...6), y: line - random.in(20...26)), radius: 9, first: at(.quarterback), from: 0.8,
             random: &random)
        ring(defense, around: CGPoint(x: ballX + random.in(-8...8), y: line + random.in(18...26)), radius: 10, first: nil, from: 0.8, random: &random)
        shuffles(offense + defense, from: 8, until: 20, random: &random)
        return 21
    }

    /// The idle's camera (following the beats, then still) and its beats:
    /// everyone on the field and the lines, or what a moment is about (a
    /// man down and the trainers with him, a flag coming in) while it lasts. Through a turn of the field it frames
    /// each instant exactly, as the field swings under it.
    mutating func finishIdle(focus: [IdleFocus] = []) {
        script.legs.sort { $0.from < $1.from }
        let end = script.duration, script = self.script, spot = self.spot, ballX = self.ballX
        func goal(_ t: Double) -> CameraFrame {
            let yaw = script.yaw(at: t)
            var items: [CGRect]
            if let f = focus.last(where: { t >= $0.from && t < $0.until }) {
                items = f.players.filter { script.players[$0].opacity(at: t) > 0.5 }
                    .map { Gridiron.room(FieldPoint(script.players[$0].position(at: t)), figure: true, yaw: yaw) }
                items += f.points.map { Gridiron.room($0, figure: false, yaw: yaw) }
            } else {
                items = script.players.indices.filter { script.players[$0].opacity(at: t) > 0.5 }
                    .map { Gridiron.room(FieldPoint(script.players[$0].position(at: t)), figure: true, yaw: yaw) }
                if let gain = script.lines.gain { items.append(Gridiron.room(FieldPoint(x: ballX, y: gain), figure: false, yaw: yaw)) }
            }
            items.append(Gridiron.room(spot, figure: false, yaw: yaw))
            let region = items.dropFirst().reduce(items[0]) { $0.union($1) }
            let closest = focus.last(where: { t >= $0.from && t < $0.until })?.closest ?? 60
            return CameraFrame.fitting(region, headroom: CameraFrame.headroom + 0.06, closest: closest, tightest: 36)
        }
        var samples = CameraRig.follow(until: end, goal: goal)
        if let loop = script.loop, let held = samples.indices.last(where: { Double($0) / CameraRig.rate <= loop.start }) {
            // Still through the looks before the snap: the formation's framing holds them all.
            for k in samples.indices where k > held { samples[k] = samples[held] }
        }
        if let turn = script.turn {
            // Exactly framed through the turn, eased into and out of it.
            for k in samples.indices {
                let t = Double(k) / CameraRig.rate
                let w = Rig.smooth((t - turn.start + 0.6) / 0.6) * (1 - Rig.smooth((t - turn.end - 0.2) / 0.8))
                if w > 0 { samples[k] = samples[k].mix(goal(t), w) }
            }
        }
        self.script.camera = CameraPath(samples: samples, settle: end, back: end, rest: samples.last ?? goal(end))
        // The beats: whenever anyone moves, a flag flies, a pose changes, the field turns or the camera travels.
        var beats: [ClosedRange<Double>] = []
        for p in script.players {
            beats += p.moves.map { $0.start...($0.end + 0.3) }
            beats += p.holds.flatMap { h in [(h.from - 0.1)...(h.from + 0.45)] + (h.until.isFinite ? [(h.until - 0.1)...(h.until + 0.45)] : []) }
            beats += p.actions.map { ($0.at - 0.5)...($0.at + 0.6) }
            if p.vanish.isFinite { beats.append(p.vanish...(p.vanish + FootballScript.Player.fade + 0.05)) }
            if p.set.map({ $0 > 0 }) == true, let set = p.set { beats.append((set - 0.05)...(set + 0.3)) }
            if let resets = p.resets { beats.append((resets - 0.35)...(resets + 0.05)) }
        }
        beats += script.flags.map { $0.thrown...($0.lands + 0.5) }
        beats += script.flights.map { $0.start...$0.end }
        if let turn = script.turn { beats.append(turn.start...turn.end) }
        if script.ballGone.isFinite { beats.append(script.ballGone...(script.ballGone + 0.1)) }
        // The camera, while it travels.
        var travelling: Double?
        for (k, pair) in zip(samples, samples.dropFirst()).enumerated() {
            let t = Double(k + 1) / CameraRig.rate
            let moved = abs(pair.1.x - pair.0.x) + abs(pair.1.y - pair.0.y) > pair.0.span * 0.0004 || abs(pair.1.span - pair.0.span) > pair.0.span * 0.0004
            if moved, travelling == nil { travelling = t }
            if !moved, let from = travelling { beats.append(from...t); travelling = nil }
        }
        if let from = travelling { beats.append(from...end) }
        self.script.beats = Self.merged(beats.map { max($0.lowerBound, 0)...min(max($0.upperBound, 0), end) })
    }

    /// Windows sorted and joined where they touch.
    static func merged(_ windows: [ClosedRange<Double>]) -> [ClosedRange<Double>] {
        var out: [ClosedRange<Double>] = []
        for w in windows.sorted(by: { $0.lowerBound < $1.lowerBound }) where w.upperBound > w.lowerBound {
            if let last = out.last, w.lowerBound <= last.upperBound + 0.05 {
                out[out.count - 1] = last.lowerBound...max(last.upperBound, w.upperBound)
            } else {
                out.append(w)
            }
        }
        return out
    }
}

// MARK: - Status

/// The broadcast tag over the field, from what the feed says: whose ball
/// and the down during a snap and between them, the flag once it's down
/// ("FLAG · HOLDING, OFFENSE · 10 YDS"), and each stoppage in turn
/// ("TIMEOUT · EAGLES · 2 LEFT", "COMMERCIAL BREAK", "END OF 1ST",
/// "CHALLENGE · FALCONS", then "UNDER REVIEW", then "REVERSED"). (pure; tested)
enum FootballStatus {
    /// The teams' names for the tags ("Eagles") and their colors (hex).
    struct Names: Equatable {
        var top: String
        var bottom: String
        var topColor: String?
        var bottomColor: String?

        func name(_ side: GameDetail.Side?) -> String? { side.map { $0 == .top ? top : bottom }.flatMap { $0.isEmpty ? nil : $0 } }
        func color(_ side: GameDetail.Side?) -> String? { side.flatMap { $0 == .top ? topColor : bottomColor } }
    }

    /// The flags' yellow, for the flag's tag.
    static let flagYellow = "FFD61A"

    /// During a snap's replay at t: the down until the flag lands, then the flag.
    static func replay(_ scene: FootballScene, script: FootballScript, t: Double, names: Names) -> TheaterStatus {
        if let flag = script.flags.first(where: { !$0.red }), t >= flag.lands, let tag = flagTag(scene) {
            return TheaterStatus(tag: tag, tint: flagYellow)
        }
        let team = names.name(scene.offense)
        let tag: String?
        if let tried = scene.pointAfter {
            tag = [tried == .kick ? "Extra point" : "Two-point try", team].compactMap { $0 }.joined(separator: " · ")
        } else if scene.kind == .kickoff {
            tag = ["Kickoff", team].compactMap { $0 }.joined(separator: " · ")
        } else {
            tag = ball(team, down: scene.before.map { downText($0, goal: scene.gainBefore == nil) })
        }
        return TheaterStatus(tag: tag, tint: names.color(scene.offense))
    }

    /// "Holding, Offense · 10 yds", "Offside, Defense · declined", "Offsetting penalties".
    static func flagTag(_ scene: FootballScene) -> String? {
        guard !scene.flags.isEmpty else { return nil }
        if scene.flags.count > 1, scene.flags.allSatisfy({ $0.status == .offsetting }) { return "Flag · offsetting penalties" }
        let flag = scene.flags.first { $0.status == .accepted } ?? scene.flags[0]
        let named = FootballStamp.announced(flag.name, side: flag.side, offense: scene.offense)
        let detail: String? = switch flag.status {
        case .declined: "declined"
        case .offsetting: "offsetting"
        case .accepted: flag.yards.map { "\($0) yds" }
        }
        return ["Flag", named, detail].compactMap { $0 }.joined(separator: " · ")
    }

    /// "Eagles ball · 3rd & 7".
    static func ball(_ team: String?, down: String?) -> String? {
        let parts = [team.map { "\($0) ball" }, down].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    static func downText(_ down: FootballScene.Down, goal: Bool) -> String {
        "\(Ordinal.string(down.down)) & \(goal ? "Goal" : "\(down.distance)")"
    }

    /// Between snaps at t into the idle: the stoppage, or the situation.
    /// `situation`: the live down and distance ("2nd & 7 at MIN 38", "Kickoff").
    static func idle(_ idle: FootballIdle, stoppage: FootballStoppage?, script: FootballScript, t: Double, names: Names,
                     situation: String?, timeoutsLeft: (top: Int?, bottom: Int?)) -> TheaterStatus {
        let down = situation.map { $0.components(separatedBy: " at ").first ?? $0 }
        let ballTag = TheaterStatus(tag: idle.phase == .kickoff ? ["Kickoff", names.name(idle.offense)].compactMap { $0 }.joined(separator: " · ")
                                        : ball(names.name(idle.offense), down: down == "Kickoff" ? nil : down),
                                    tint: names.color(idle.offense))
        // Back on the field: the ball again.
        let back = script.loop.map { t >= $0.start - 4.5 } ?? false
        switch idle.phase {
        case .between, .kickoff:
            return ballTag
        case let .timeout(side):
            if back { return ballTag }
            let left = side.flatMap { $0 == .top ? timeoutsLeft.top : timeoutsLeft.bottom }
            let tag = ["Timeout", names.name(side), left.map { "\($0) left" }].compactMap { $0 }.joined(separator: " · ")
            return TheaterStatus(tag: tag, tint: names.color(side))
        case .commercial:
            if back { return ballTag }
            return TheaterStatus(tag: stoppage?.kind == .twoMinuteWarning ? "Two-minute warning" : "Commercial break")
        case .quarter:
            if t >= 9 { return ballTag }
            let period = stoppage?.period ?? 1
            return TheaterStatus(tag: period >= 4 ? "End of regulation" : "End of \(Ordinal.string(period))")
        case .off:
            return TheaterStatus(tag: stoppage?.kind == .endOfGame ? "Final" : "Halftime")
        case let .injury(hurt):
            if back { return ballTag }
            return TheaterStatus(tag: "Injury · \(hurt.name)", tint: names.color(hurt.side))
        case let .review(review):
            if back { return ballTag }
            let words = review.ruling.count <= 26 ? review.ruling : nil
            if t < 7, review.kind == .challenge {
                return TheaterStatus(tag: ["Challenge", names.name(review.side)].compactMap { $0 }.joined(separator: " · "),
                                     tint: names.color(review.side))
            }
            if t < (review.kind == .challenge ? 16 : 13) {
                return TheaterStatus(tag: ["Under review", words].compactMap { $0 }.joined(separator: " · "))
            }
            return TheaterStatus(tag: review.reversed ? "Reversed" : "Ruling stands")
        }
    }

    /// When the idle's tag next changes after t (script time), for the stage to wake.
    static func changes(_ idle: FootballIdle, script: FootballScript) -> [Double] {
        let back = script.loop.map { $0.start - 4.5 }
        switch idle.phase {
        case .between, .kickoff, .off: return []
        case .quarter: return [9]
        case .review(let r): return ([r.kind == .challenge ? 7 : nil, r.kind == .challenge ? 16 : 13, back] as [Double?]).compactMap { $0 }
        default: return back.map { [$0] } ?? []
        }
    }
}
