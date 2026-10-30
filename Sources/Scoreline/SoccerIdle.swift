import SwiftUI

// What the soccer theater shows between its big moments, so a live match
// never looks frozen: every event ESPN logs gets its beat, and between them
// the ball goes round. A corner: the taker jogs to the flag on the side it
// went out, the box fills, each man picked up. A foul: the man fouled down,
// then the free kick set up at the real spot (a wall when it's in range).
// Offside: the assistant's flag up level with the man. A booking: the
// referee's card up to the real player where his foul was; a red, and he
// walks. A substitution: the man coming off to the halfway line, the board
// up, the man coming on. A man hurt: down, the physios on.
// A VAR check, its decision; half time and full time, off to the tunnel; the
// second half's kick-off with the ends changed. Otherwise the team on the
// ball (the last event's) passes it round in its formation from the
// lineups, the other team shifting with it, a pass every few seconds.
//
// The officials are on the pitch only for what the data has them do: the
// referee for a booking (in to the man, the card, away), the assistant for an
// offside (up the touchline to him, the flag), the fourth official for a
// substitution (the board). Each fades in as he comes and out as he goes;
// otherwise there are only the players, nobody standing about in their way.
//
// Each is a script like a moment's (SoccerScript.swift), a pure function of
// what the feed said and t, in sparse beats: a second or two of motion, then
// still, round a loop. Where the data is silent (who takes the corner, who
// the ball goes to), the choices are seeded from the event's ID: never the
// same twice, the same every time.

// MARK: - Events

/// An event that isn't a shot: a corner, a foul, an offside, a booking, a
/// substitution, a stoppage, the halves; from ESPN's core plays (each with
/// its team, its man and, mostly, where it happened).
struct SoccerEvent: Equatable, Identifiable {
    enum Kind: Equatable {
        case corner, foul, handball, offside
        /// A booking; `second`: a second yellow.
        case card(red: Bool, second: Bool)
        case substitution
        /// Play stopped for a man hurt; or for no reason given.
        case injury, delay
        case varCheck
        /// VAR's word ("Penalty Valencia", "No Goal", "Card upgraded").
        case varDecision(String)
        /// Play on again after a delay.
        case resume
        case kickoff, halftime, secondHalf, fullTime
    }

    let id: String
    var kind: Kind
    /// Whose it is: the team awarded the corner, the team that fouled, the man's team.
    var side: GameDetail.Side?
    /// The man: the fouler, the man booked or offside, the man coming on, the man hurt.
    var player: String?
    var athlete: String?
    /// The other man: the one fouled, the one going off.
    var other: String?
    var otherAthlete: String?
    /// Where, in metres on the pitch (home attacking right, as a scene's).
    var at: CGPoint?
    /// A foul in the box: a penalty.
    var penalty = false
    var minute = ""
    var clock = 0.0
    var period: Int?
    var text = ""
    var wallclock: Date?
    /// The feed's order: later is newer.
    var order = 0

    /// The entry at `index` as an event, with the plays before it (a
    /// booking's foul); nil for anything else (a pass, a shot). (pure; tested)
    static func parse(_ plays: [JSON], at index: Int, homeTeamID: String?, order: Int = 0) -> SoccerEvent? {
        let item = plays[index]
        guard let id = SoccerScene.playID(item) else { return nil }
        let type = item["type"]["type"].string ?? ""
        let text = item["text"].string ?? ""
        let kind: Kind
        switch type {
        case "corner-awarded": kind = .corner
        case "foul": kind = .foul
        case "handball": kind = .handball
        case "offside": kind = .offside
        case "yellow-card": kind = .card(red: false, second: false)
        case "red-card": kind = .card(red: true, second: text.lowercased().contains("second yellow"))
        case "substitution": kind = .substitution
        case "start-delay":
            // ESPN logs a delay twice; only one says why.
            guard !text.isEmpty else { return nil }
            kind = text.contains("VAR") ? .varCheck : text.contains("injury") ? .injury : .delay
        case "end-delay":
            guard !text.isEmpty else { return nil }
            kind = .resume
        case "kickoff": kind = .kickoff
        case "halftime": kind = .halftime
        case "start-2nd-half": kind = .secondHalf
        case "end-regular-time": kind = .fullTime
        default:
            guard type.hasPrefix("var---"), let words = decision(text) else { return nil }
            kind = .varDecision(words)
        }
        var event = SoccerEvent(id: id, kind: kind, text: text, order: order)
        let team = SoccerScene.teamID(item)
        event.side = team.map { $0 == homeTeamID ? .top : .bottom }
        event.at = SoccerScene.place(item, "fieldPositionX", "fieldPositionY", home: homeTeamID)
        event.minute = SoccerScene.minute(item["clock"]["displayValue"].string ?? "")
        event.clock = item["clock"]["value"].double ?? 0
        event.period = item["period"]["number"].int
        event.wallclock = DateParser.parse(item["wallclock"].string)
        let credit = SoccerScene.credit(item)
        event.athlete = credit?.athlete
        switch kind {
        case .foul:
            event.player = SoccerScene.name(item)
            // "Johan Manzambi (Aston Villa) wins a free kick on the left wing.": the man fouled.
            if let m = text.firstMatch(of: #/^([^(]+?) \([^)]*\) (?:wins|draws)/#) { event.other = String(m.1) }
            if let m = text.firstMatch(of: #/^Foul by ([^(]+?) \(/#) { event.player = String(m.1) }
            event.penalty = text.contains("penalty area")
            // "Penalty Hull City. Tim Iroegbunam draws a foul in the penalty area.": the man fouled.
            if let m = text.firstMatch(of: #/^Penalty .+?\. ([^.]+?) draws a foul/#) { event.other = String(m.1) }
        case .handball:
            event.player = text.firstMatch(of: #/^Handball by ([^(]+?) \(/#).map { String($0.1) } ?? SoccerScene.name(item)
        case .offside:
            event.player = text.firstMatch(of: #/\. (.+?) is caught offside/#).map { String($0.1) } ?? SoccerScene.name(item)
        case .card:
            event.player = text.firstMatch(of: #/^(?:Second yellow card to )?([^(]+?) \(/#).map { String($0.1) } ?? SoccerScene.name(item)
            // Booked where his foul was: the foul (or handball) just before by the same man.
            for i in stride(from: index - 1, through: max(index - 12, 0), by: -1) {
                let foul = plays[i]
                guard ["foul", "handball"].contains(foul["type"]["type"].string ?? "") else { continue }
                let same = credit.map { c in SoccerScene.credit(foul)?.athlete == c.athlete } ?? false
                let named = event.player.map { name in (foul["text"].string ?? "").contains(name) || (foul["shortText"].string ?? "").hasPrefix(name) } ?? false
                if same || named {
                    event.at = SoccerScene.place(foul, "fieldPositionX", "fieldPositionY", home: homeTeamID)
                    break
                }
            }
        case .substitution:
            // "Substitution, Manchester City. Rico Lewis replaces Marc Guéhi."
            if let m = text.firstMatch(of: #/\. (.+?) replaces (.+?)(?: because of an injury)?\.$/#) {
                event.player = String(m.1)
                event.other = String(m.2)
            }
            event.otherAthlete = SoccerScene.credit(item, at: 1)?.athlete
        case .injury:
            event.player = text.firstMatch(of: #/injury (.+?) \(/#).map { String($0.1) }
        default:
            break
        }
        return event
    }

    /// VAR's decision in a few words: "Penalty Valencia", "No Goal", "Card upgraded".
    static func decision(_ text: String) -> String? {
        guard let r = text.range(of: "VAR Decision: ") else { return nil }
        let words = text[r.upperBound...].trimmingCharacters(in: CharacterSet(charactersIn: ". "))
        for phrase in ["No Goal", "Goal", "No Penalty", "Penalty", "Card upgraded", "Card downgraded", "No Red Card", "Red Card", "No Offside", "Offside"]
            where words.lowercased().hasPrefix(phrase.lowercased()) {
            // A penalty says for whom ("Penalty Valencia"); the rest are the call alone.
            if phrase == "Penalty" { return words.split(separator: " ").prefix(3).joined(separator: " ") }
            return phrase
        }
        return words.split(separator: " ").prefix(3).joined(separator: " ")
    }

    /// The man as the tag names him: his surname.
    var surname: String? { player.map(SoccerScene.surname) }
}

/// The last thing that happened on the ball: whose it is now, and where.
struct SoccerTouch: Equatable {
    var side: GameDetail.Side
    var at: CGPoint
    var order: Int
    var period: Int?
    /// Match clock, in seconds: whether the half's added time is being played.
    var clock = 0.0
}

extension SoccerTouch {
    /// A located entry as the ball's whereabouts: the team on it (after a
    /// foul, the ball out, an offside: the other one). (pure; tested)
    static func parse(_ item: JSON, homeTeamID: String?, order: Int) -> SoccerTouch? {
        guard let team = SoccerScene.teamID(item), let at = SoccerScene.place(item, "fieldPositionX", "fieldPositionY", home: homeTeamID) else { return nil }
        let side: GameDetail.Side = team == homeTeamID ? .top : .bottom
        let lost = ["out", "foul", "offside", "handball", "foul-throw-in", "dispossessed"].contains(item["type"]["type"].string ?? "")
        return SoccerTouch(side: lost ? (side == .top ? .bottom : .top) : side,
                           at: CGPoint(x: min(max(at.x, 0.5), Pitch.length - 0.5), y: min(max(at.y, 0.5), Pitch.width - 0.5)),
                           order: order, period: item["period"]["number"].int, clock: item["clock"]["value"].double ?? 0)
    }
}

/// The added time the fourth official announced, and for which half: the
/// commentary has it ("Fourth official has announced 4 minutes of added
/// time."); the core plays don't.
struct SoccerAddedTime: Equatable {
    var minutes: Int
    /// 1 or 2 (extra time's 3 and 4).
    var half: Int

    /// The latest announcement in a summary's commentary. (pure; tested)
    static func latest(_ commentary: JSON) -> SoccerAddedTime? {
        commentary.array.reversed().lazy.compactMap { c -> SoccerAddedTime? in
            guard let text = c["text"].string, let m = text.firstMatch(of: #/announced (\d+) minutes? of added time/#), let minutes = Int(m.1) else { return nil }
            let minute = Int((c["time"]["displayValue"].string ?? "").prefix { $0.isNumber }) ?? 90
            return SoccerAddedTime(minutes: minutes, half: minute <= 45 ? 1 : minute <= 90 ? 2 : minute <= 105 ? 3 : 4)
        }.first
    }

    /// Shown while its half's added time is being played: from the 45th
    /// (90th, 105th, 120th) minute of that half on.
    func showing(period: Int?, clock: Double) -> Int? {
        guard period == half, minutes > 0 else { return nil }
        return clock >= Double([45, 90, 105, 120][min(max(half, 1), 4) - 1] * 60) ? minutes : nil
    }
}

// MARK: - Which way the pitch faces

/// Which end each team attacks on the viewer's screen: home to the right in
/// the first half, as the Live Pitch draws it, the teams changing ends at
/// half time (extra time's halves as the match's); the viewer's turn swaps
/// them for the game. (pure; tested)
enum PitchFacing {
    static func homeAttacksRight(period: Int?, flipped: Bool) -> Bool {
        ((period ?? 1) % 2 == 1) != flipped
    }

    /// A point on the pitch turned round (the other end, the other touchline).
    static func turned(_ p: CGPoint) -> CGPoint { CGPoint(x: Pitch.length - p.x, y: Pitch.width - p.y) }
}

extension SoccerScene {
    /// The moment as drawn with the ends changed: every place turned round,
    /// its team attacking the other way. (pure; tested)
    func turned() -> SoccerScene {
        var s = self
        func t(_ p: CGPoint) -> CGPoint { PitchFacing.turned(p) }
        s.touches = touches.map { var touch = $0; touch.at = t($0.at); touch.to = $0.to.map(t); return touch }
        s.shot.from = t(shot.from)
        s.shot.stopped = shot.stopped.map(t)
        s.shot.mouth = shot.mouth.map { Mouth(y: Pitch.width - $0.y, z: $0.z) }
        s.keeper.at = keeper.at.map(t)
        s.blocker?.at = blocker?.at.map(t)
        s.keeperActions = keeperActions.map { var a = $0; a.at = t($0.at); a.to = $0.to.map(t); return a }
        s.rebound = rebound.map(t)
        s.turnedRound = !turnedRound
        return s
    }
}

// MARK: - Idle

/// What the pitch does now, between big moments.
struct SoccerIdle: Equatable {
    enum Phase: Equatable {
        /// The team on the ball passes it round.
        case play
        /// An event's beat.
        case event(SoccerEvent)
    }

    var phase: Phase
    /// The team on the ball (`attacking` in the script).
    var possession: GameDetail.Side
    /// Where the ball is, as drawn.
    var ball: CGPoint
    /// Whether home attacks right, as drawn (the half, the viewer's turn).
    var homeRight: Bool
    var lineups: [GameDetail.Side: SoccerLineup] = [:]
    var seed: UInt64 = 0

    /// Whether the team on the ball attacks right, as drawn.
    var right: Bool { (possession == .top) == homeRight }

    /// What the pitch does after the last moment and what came since: the
    /// event showing (or the newest that still holds play up: a corner
    /// waiting to be taken, a man down, a check, the half), else the ball
    /// going round for the team that had it last. (pure; tested)
    static func make(event: SoccerEvent?, touch: SoccerTouch?, scene: SoccerScene?, period: Int?, lineups: [GameDetail.Side: SoccerLineup],
                     flipped: Bool) -> SoccerIdle {
        let period = event?.period ?? touch?.period ?? scene?.period ?? period
        let homeRight = PitchFacing.homeAttacksRight(period: event?.kind == .secondHalf ? 2 : period, flipped: flipped)
        func drawn(_ p: CGPoint) -> CGPoint { homeRight ? p : PitchFacing.turned(p) }
        var possession = touch?.side ?? scene?.side ?? .top
        var ball = touch.map { drawn($0.at) } ?? scene.map { drawn($0.shot.from) } ?? Pitch.center
        if let event {
            switch event.kind {
            // The team awarded it: a foul's, a handball's, an offside's other team.
            case .foul, .handball, .offside: possession = event.side.map { $0 == .top ? .bottom : .top } ?? possession
            case .corner, .substitution: possession = event.side ?? possession
            case .kickoff, .secondHalf, .halftime, .fullTime: ball = Pitch.center
            default: break
            }
            if let at = event.at { ball = drawn(at) }
        }
        let seed = Celebration.seed(event?.id ?? "play-\(touch?.order ?? 0)-\(scene?.id ?? "")")
        // The elevens as they stand: each change made by the event's minute (or the ball's).
        let on = lineups.mapValues { $0.on(at: event?.clock ?? touch?.clock) }
        return SoccerIdle(phase: event.map { .event($0) } ?? .play, possession: possession, ball: ball, homeRight: homeRight, lineups: on,
                          seed: seed)
    }

    /// How long an event holds the stage before the next one waiting takes it.
    static func beat(_ kind: SoccerEvent.Kind) -> Double {
        switch kind {
        case .substitution: 10
        case .card(let red, _): red ? 11 : 7
        case .foul, .handball, .offside: 8
        case .corner: 7
        default: 6
        }
    }

    /// Whether an event still holds play up after its beat: a corner till
    /// it's taken, a man down till play's on again, a check, the break.
    static func holds(_ kind: SoccerEvent.Kind) -> Bool {
        switch kind {
        case .corner, .injury, .delay, .varCheck, .halftime, .fullTime, .kickoff, .secondHalf, .foul, .handball, .offside: true
        default: false
        }
    }
}

extension SoccerLineup {
    /// A lineup laid out already (the idle's stand-in when the summary has none).
    init(team: String, formation: String?, players: [Player]) {
        self.team = team
        self.formation = formation
        self.players = players
    }
}

/// A prop in a man's raised hand: the referee's card, the assistant's flag, the fourth official's board.
struct SoccerProp: Equatable {
    enum Kind: Equatable { case yellowCard, redCard, flag, board }
    var kind: Kind
    var actor: Int
    var from: Double
    var until: Double
}

extension SoccerScript {
    /// The pitch between moments (SoccerIdle): both elevens, an official
    /// for his act, and the beat.
    init(idle: SoccerIdle) {
        var b = IdleBuilder(idle: idle)
        b.build()
        self = b.script
        measureBodies()
    }

    /// The script's time for `elapsed` seconds of idle: straight through, then round the loop.
    func idleTime(_ elapsed: Double) -> Double {
        guard let loop, loop.period > 0, elapsed > loop.start + loop.period else { return min(max(elapsed, 0), max(duration, 0)) }
        return loop.start + (elapsed - loop.start).truncatingRemainder(dividingBy: loop.period)
    }

    func moving(at t: Double) -> Bool { beats.contains { t >= $0.lowerBound && t < $0.upperBound } }

    func nextBeat(after t: Double) -> Double? {
        if let next = beats.first(where: { $0.lowerBound > t })?.lowerBound { return next }
        guard let loop, let first = beats.first(where: { $0.lowerBound >= loop.start }) else { return nil }
        return first.lowerBound + loop.period
    }

    /// Assembles the pitch between moments.
    struct IdleBuilder {
        let idle: SoccerIdle
        var script = SoccerScript()
        var random: SplitMix64
        /// Each man of the team on the ball (attacking) and the other, by athlete.
        var men: [Team: [(player: SoccerLineup.Player, actor: Int)]] = [:]
        /// What the camera keeps in frame, by when.
        var focus: [(from: Double, until: Double, actors: [Int], points: [CGPoint], closest: Double)] = []

        init(idle: SoccerIdle) {
            self.idle = idle
            random = SplitMix64(seed: idle.seed)
        }

        var right: Bool { idle.right }
        /// The goal the team on the ball attacks, as drawn.
        var goal: CGPoint { Pitch.goal(right: right) }

        func lineup(_ team: Team) -> SoccerLineup {
            let side: GameDetail.Side = team == .attacking ? idle.possession : idle.possession == .top ? .bottom : .top
            if let real = idle.lineups[side], real.players.count >= 10 { return real }
            return Self.standard(side == .top ? "home" : "away")
        }

        /// Without the lineups: a plain 4-4-2.
        static func standard(_ team: String) -> SoccerLineup {
            let positions = ["G", "RB", "CD-R", "CD-L", "LB", "RM", "CM-R", "CM-L", "LM", "CF-R", "CF-L"]
            let players = positions.enumerated().map { k, p in
                SoccerLineup.Player(athlete: "\(team)-\(k + 1)", name: nil, jersey: "\(k + 1)", position: p, place: k + 1)
            }
            return SoccerLineup(team: team, formation: "4-4-2", players: SoccerLineup.shaped(players, formation: "4-4-2"))
        }

        /// Where a man stands in his team's shape with the ball at `ball`
        /// (as drawn): the side on the ball pushed up behind it and drawn
        /// across to it, the other between it and its goal, deeper and
        /// tighter the nearer it comes; the keepers on their lines.
        func shape(_ p: SoccerLineup.Player, team: Team, ball: CGPoint) -> CGPoint {
            let facing = team == .attacking ? right : !right
            func own(_ q: CGPoint) -> CGPoint { facing ? q : PitchFacing.turned(q) }
            let n = Pitch.metres(x: p.spot.x, y: p.spot.y), b = own(ball)
            var q: CGPoint
            if p.place == 1 || p.position == "G" {
                q = team == .attacking ? CGPoint(x: 5 + max(b.x - 52.5, 0) * 0.3, y: 34 + (b.y - 34) * 0.15)
                    : CGPoint(x: 1.6 + min(b.x * 0.03, 3), y: 34 + (b.y - 34) * 0.12)
            } else if team == .attacking {
                q = CGPoint(x: n.x + (b.x - 45) * 0.6, y: 34 + (n.y - 34) * 0.95 + (b.y - 34) * 0.3)
                q.x = min(q.x, max(b.x + 22, 60))
            } else {
                let k = min(max(b.x / 55, 0.35), 1), back = min(max(b.x * 0.45 + 2, 6), 34)
                q = CGPoint(x: back + (n.x - 21) * k, y: 34 + (n.y - 34) * (0.7 + 0.25 * k) + (b.y - 34) * 0.35)
            }
            q.x = min(max(q.x, 1), Pitch.length - 1)
            q.y = min(max(q.y, 1.5), Pitch.width - 1.5)
            return own(q)
        }

        mutating func add(_ team: Team, _ name: String, at: CGPoint, role: Actor.Role = .outfield, athlete: String? = nil) -> Int {
            script.actors.append(Actor(team: team, role: role, name: name, at: at, athlete: athlete))
            return script.actors.count - 1
        }

        func position(_ i: Int, _ t: Double) -> CGPoint { script.actors[i].position(at: t) }

        mutating func move(_ i: Int, to p: CGPoint, from start: Double, to end: Double, ease: PlayScript.Ease = .inOut) {
            script.actors[i].move(to: [p], from: start, to: end, ease: ease)
        }

        /// An official on the pitch for his act alone: fading in as the beat
        /// opens, gone (faded out) from `until`.
        mutating func official(_ name: String, at p: CGPoint, until: Double) -> Int {
            let i = add(.official, name, at: p)
            script.actors[i].appear = 0.05
            script.actors[i].vanish = until
            return i
        }

        /// Everyone into the shape for a ball at `ball`, from `start`, at a jog.
        mutating func reshape(ball: CGPoint, from start: Double, except: Set<Int> = []) {
            for team in [Team.attacking, .defending] {
                for (p, i) in men[team] ?? [] where !except.contains(i) && script.actors[i].opacity(at: start) > 0.5 {
                    let to = shape(p, team: team, ball: ball), here = position(i, start), d = hypot(to.x - here.x, to.y - here.y)
                    guard d > 0.3 else { continue }
                    move(i, to: to, from: start + random.in(0...0.25), to: start + min(max(d / 6, 0.9), 2.2), ease: .inOut)
                }
            }
        }

        /// The man of a team named by the event (by athlete, else by name),
        /// else the one of its men nearest a spot.
        func man(_ team: Team, athlete: String?, name: String?, near spot: CGPoint, outfield: Bool = true) -> Int? {
            let pool = (men[team] ?? []).filter { !outfield || $0.player.place != 1 }
            if let athlete, let hit = pool.first(where: { $0.player.athlete == athlete }) { return hit.actor }
            if let name, let hit = pool.first(where: { $0.player.name == name || $0.player.name.map(SoccerScene.surname) == SoccerScene.surname(name) }) {
                return hit.actor
            }
            return pool.min { hypot(position($0.actor, 0).x - spot.x, position($0.actor, 0).y - spot.y)
                < hypot(position($1.actor, 0).x - spot.x, position($1.actor, 0).y - spot.y) }?.actor
        }

        mutating func choose<T>(_ items: [T]) -> T? {
            guard !items.isEmpty else { return nil }
            return items[Int(random.in(0...0.999) * Double(items.count))]
        }

        mutating func build() {
            let ball = idle.ball
            for team in [Team.attacking, .defending] {
                let lineup = lineup(team)
                men[team] = lineup.players.map { p in
                    let i = add(team, p.name ?? p.athlete, at: shape(p, team: team, ball: ball), role: p.place == 1 ? .keeper : .outfield, athlete: p.athlete)
                    script.actors[i].shaped = true
                    return (p, i)
                }
            }
            script.flights = [Flight(kind: .carry, start: 0, end: 0.01, from: FieldPoint(ball, z: 0.11), to: FieldPoint(ball, z: 0.11))]
            var loopStart = 0.6
            var period = 0.0
            switch idle.phase {
            case .play:
                (loopStart, period) = circulate(from: ball)
            case let .event(event):
                (loopStart, period) = beat(event)
            }
            script.loop = loopStart < .infinity && period > 0 ? Loop(start: loopStart, period: period) : nil
            script.duration = period > 0 ? loopStart + period : max(loopStart, 1)
            script.settle = script.duration
            script.stamp = .infinity
            finish()
        }

        // MARK: The ball going round

        /// Passes round the team on the ball, one every few seconds: to a
        /// man in its shape 8 to 30 metres off (sideways and back more than
        /// forward, as a side keeping it does), met with a step toward it,
        /// sometimes carried on a few strides; both shapes shift with it. The
        /// last goes back to where it began, so it loops.
        mutating func circulate(from start: CGPoint) -> (Double, Double) {
            let team = men[.attacking] ?? []
            let outfield = team.filter { $0.player.place != 1 }
            guard let first = outfield.min(by: { hypot(position($0.actor, 0).x - start.x, position($0.actor, 0).y - start.y)
                < hypot(position($1.actor, 0).x - start.x, position($1.actor, 0).y - start.y) }) else { return (0.6, 0) }
            // He has it where it is.
            script.actors[first.actor].at = start
            var ball = start, holder = first
            var t = random.in(1.2...2.2)
            let passes = 5 + Int(random.in(0...2.99))
            for k in 0...passes {
                let last = k == passes
                let options = outfield.filter { $0.actor != holder.actor }.filter { o in
                    let p = shape(o.player, team: .attacking, ball: ball), d = hypot(p.x - ball.x, p.y - ball.y)
                    return d > 8 && d < 32
                }
                // Back and across more often than forward.
                let weighted = options.flatMap { o -> [(player: SoccerLineup.Player, actor: Int)] in
                    let p = shape(o.player, team: .attacking, ball: ball), forward = (p.x - ball.x) * (right ? 1 : -1)
                    return Array(repeating: o, count: forward > 6 ? 1 : 3)
                }
                guard let receiver = last ? first : choose(weighted.isEmpty ? outfield.filter { $0.actor != holder.actor } : weighted) else { break }
                let target = last ? start : shape(receiver.player, team: .attacking, ball: ball)
                // Met with a step toward it (the last one back where it all began, so it loops).
                let meet = last ? start : CGPoint(x: target.x + (ball.x - target.x) * 0.06, y: target.y + (ball.y - target.y) * 0.06)
                let d = hypot(meet.x - ball.x, meet.y - ball.y), time = min(max(d / 15, 0.6), 2)
                script.actors[holder.actor].act(.kick, at: t, toward: meet, left: random.in(0...1) < 0.3)
                script.flights.append(Flight(kind: .pass, start: t, end: t + time, from: FieldPoint(ball, z: 0.11), to: FieldPoint(meet, z: 0.11),
                                             arc: d > 26 ? .lofted(min(1.5 + d * 0.06, 3.5)) : .straight))
                move(receiver.actor, to: meet, from: t + 0.1, to: t + time, ease: .inOut)
                script.actors[receiver.actor].act(.control, at: t + time, toward: ball)
                reshape(ball: meet, from: t + 0.35, except: [receiver.actor])
                ball = meet
                holder = receiver
                t += time
                // Sometimes on a few strides with it.
                if !last, random.in(0...1) < 0.45 {
                    let on = CGPoint(x: min(max(ball.x + (right ? 1 : -1) * random.in(2...6), 2), Pitch.length - 2),
                                     y: min(max(ball.y + random.in(-3...3), 2), Pitch.width - 2))
                    let carry = random.in(0.9...1.4)
                    move(holder.actor, to: on, from: t + 0.4, to: t + 0.4 + carry, ease: .linear)
                    script.flights.append(Flight(kind: .carry, start: t + 0.4, end: t + 0.4 + carry, from: FieldPoint(ball, z: 0.11), to: FieldPoint(on, z: 0.11)))
                    ball = on
                    t += 0.4 + carry
                }
                t += random.in(4.2...6.2)
            }
            return (0.4, t - 0.4)
        }

        // MARK: Events

        /// An event's beat: the stage it sets, at its real spot, with its real men.
        mutating func beat(_ e: SoccerEvent) -> (Double, Double) {
            let ball = idle.ball
            switch e.kind {
            case .corner:
                return corner(e)
            case .foul, .handball:
                return freeKick(e, foul: true)
            case .offside:
                // The assistant up the near touchline from the last defender's line, level with him, his flag up, and gone;
                // then the free kick back.
                let man = self.man(.defending, athlete: e.athlete, name: e.player, near: ball) ?? 0
                let lastMan = (men[.defending] ?? []).filter { $0.player.place != 1 }.map { position($0.actor, 0).x }
                let line = right ? lastMan.max() ?? 70 : lastMan.min() ?? 35
                let assistant = official("assistant", at: CGPoint(x: line, y: -1.2), until: 5.7)
                move(man, to: ball, from: 0.2, to: 1.2)
                move(assistant, to: CGPoint(x: ball.x, y: -1.2), from: 0.2, to: 1.6)
                script.props.append(SoccerProp(kind: .flag, actor: assistant, from: 1.4, until: 5.5))
                script.actors[assistant].holds.append(Hold(kind: .cardUp, from: 1.4, until: 5.5))
                focus.append((0, 5.5, [man, assistant], [ball], 26))
                return freeKickSetup(at: ball, from: 6, foul: false)
            case .card(let red, _):
                return card(e, red: red)
            case .substitution:
                return substitution(e)
            case .injury, .delay:
                return injury(e)
            case .varCheck, .varDecision:
                // Everyone waits on it, a few drifting about; the tag says the check and the decision.
                for (_, i) in (men[.attacking] ?? []) + (men[.defending] ?? []) where random.in(0...1) < 0.25 {
                    let here = position(i, 0)
                    move(i, to: CGPoint(x: here.x + random.in(-3...3), y: here.y + random.in(-3...3)), from: random.in(3...8), to: random.in(9...10))
                }
                return (16, 12)
            case .resume:
                return circulate(from: ball)
            case .kickoff, .secondHalf:
                return kickoff(e)
            case .halftime, .fullTime:
                // Off to the tunnel at the halfway line.
                let tunnel = CGPoint(x: Pitch.length / 2, y: -5)
                for i in script.actors.indices {
                    let here = position(i, 0.3), d = hypot(tunnel.x - here.x, tunnel.y - here.y)
                    let leave = 0.3 + random.in(0...1.2)
                    let arrive = leave + min(max(d / 5, 3), 9)
                    move(i, to: CGPoint(x: tunnel.x + random.in(-3...3), y: tunnel.y), from: leave, to: arrive)
                    script.actors[i].vanish = arrive - 0.8
                }
                script.ballGone = 2
                let end = script.actors.map(\.vanish).filter(\.isFinite).max() ?? 8
                return (end + 1, 0)
            }
        }

        /// A corner: the taker to the flag on the side it went out, the
        /// attack's big men into the box and each picked up by a man, a man
        /// on the near post, the keeper on his line; then the men in the box
        /// jostling for position till it's taken.
        mutating func corner(_ e: SoccerEvent) -> (Double, Double) {
            let goalX = right ? Pitch.length : 0
            let flag = CGPoint(x: goalX, y: (e.at.map { idle.homeRight ? $0.y : Pitch.width - $0.y } ?? (random.in(0...1) < 0.5 ? 0 : 68)) > Pitch.width / 2 ? Pitch.width : 0)
            let spot = CGPoint(x: goalX + (right ? -0.6 : 0.6), y: flag.y == 0 ? 0.6 : Pitch.width - 0.6)
            script.flights = [Flight(kind: .carry, start: 0, end: 0.01, from: FieldPoint(spot, z: 0.11), to: FieldPoint(spot, z: 0.11))]
            let attack = (men[.attacking] ?? []).filter { $0.player.place != 1 }, defence = (men[.defending] ?? []).filter { $0.player.place != 1 }
            // The taker: a wide man on that side, else whoever's nearest.
            let side = flag.y > Pitch.width / 2 ? 2 : -2
            let wide = attack.filter { SoccerLineup.lateral($0.player.position) == (right == (side > 0) ? 2 : -2) }
            let taker = choose(wide)?.actor ?? attack.min { hypot(position($0.actor, 0).x - flag.x, position($0.actor, 0).y - flag.y)
                < hypot(position($1.actor, 0).x - flag.x, position($1.actor, 0).y - flag.y) }?.actor ?? 0
            let s: Double = right ? -1 : 1
            move(taker, to: CGPoint(x: spot.x + s * 1.2, y: spot.y + (flag.y == 0 ? 1.3 : -1.3)), from: 0.3, to: 3.2)
            script.actors[taker].looks.append(Look(from: 3.2, point: CGPoint(x: goalX + s * 11, y: Pitch.width / 2)))
            // The box: the centre-backs and the front men.
            let big = attack.filter { $0.actor != taker && ($0.player.line >= 3 || ($0.player.line == 1 && abs(SoccerLineup.lateral($0.player.position)) <= 1)) }
            var inBox: [Int] = []
            for (k, a) in big.prefix(6).enumerated() {
                let p = CGPoint(x: goalX + s * random.in(5.5...13), y: 34 + (Double(k) - 2.5) * random.in(2.4...3.4))
                move(a.actor, to: p, from: 0.4 + random.in(0...0.8), to: 3.6 + random.in(0...0.8))
                script.actors[a.actor].looks.append(Look(from: 4, point: spot))
                inBox.append(a.actor)
            }
            // Each picked up, goal-side; a man on the near post.
            var markers = defence.sorted { $0.player.line < $1.player.line }.map(\.actor)
            for a in inBox {
                guard !markers.isEmpty else { break }
                let m = markers.removeFirst(), p = position(a, 4.6)
                move(m, to: CGPoint(x: p.x + s * 1.1, y: p.y + random.in(-0.6...0.6)), from: 0.5 + random.in(0...0.6), to: 4.0 + random.in(0...0.6))
                script.actors[m].looks.append(Look(from: 4.2, point: spot))
            }
            if let post = markers.first {
                move(post, to: CGPoint(x: goalX + s * 0.6, y: flag.y == 0 ? Pitch.posts.near - 0.4 : Pitch.posts.far + 0.4), from: 0.6, to: 3.8)
                markers.removeFirst()
            }
            // The keeper on his line; everyone else back toward the edge of the box and beyond.
            for (p, i) in (men[.attacking] ?? []) + (men[.defending] ?? []) where i != taker && !inBox.contains(i) && script.actors[i].moves.isEmpty {
                let team: Team = script.actors[i].team
                let at = shape(p, team: team, ball: CGPoint(x: goalX + s * 18, y: 34))
                move(i, to: at, from: 0.5 + random.in(0...0.6), to: 3.6 + random.in(0...1))
            }
            if let keeper = (men[.defending] ?? []).first(where: { $0.player.place == 1 })?.actor {
                move(keeper, to: CGPoint(x: goalX + s * 0.7, y: 34 + (flag.y == 0 ? -1 : 1)), from: 0.4, to: 2.4)
                script.actors[keeper].looks.append(Look(from: 2.4, point: spot))
            }
            // The jostling: a man in the box steps off his marker and back, round and round.
            var t = 6.5
            for _ in 0..<2 {
                guard let a = choose(inBox) else { break }
                let here = position(a, t)
                move(a, to: CGPoint(x: here.x + s * random.in(-2...2), y: here.y + random.in(-2.5...2.5)), from: t, to: t + 0.9)
                move(a, to: here, from: t + 3.4, to: t + 4.3)
                t += 5.5
            }
            script.actors[taker].holds.append(Hold(kind: .cardUp, from: 11.2, until: 12))
            focus.append((0, 20, inBox + [taker], [spot, CGPoint(x: goalX, y: 34)], 30))
            return (6.0, 12.0)
        }

        /// A foul: the man fouled down, the fouler over him, then the free kick.
        mutating func freeKick(_ e: SoccerEvent, foul: Bool) -> (Double, Double) {
            let spot = idle.ball
            let fouler = man(.defending, athlete: e.athlete, name: e.player, near: spot)
            let fouled = man(.attacking, athlete: nil, name: e.other, near: spot)
            if let fouled {
                move(fouled, to: spot, from: 0.1, to: 0.6)
                script.actors[fouled].holds.append(Hold(kind: .down, from: 0.6, until: 3.6))
            }
            if let fouler {
                move(fouler, to: CGPoint(x: spot.x + random.in(-2...2), y: spot.y + random.sign() * random.in(1.5...2.5)), from: 0.1, to: 0.7)
                script.actors[fouler].looks.append(Look(from: 0.8, point: spot))
            }
            focus.append((0, 4.2, [fouler, fouled].compactMap { $0 }, [spot], 20))
            return freeKickSetup(at: spot, from: 4.2, foul: true, penalty: e.penalty)
        }

        /// The free kick set up at a spot: the taker over it, a wall the
        /// distance off on the line to goal when it's in range, the box
        /// filling when it's in the attacking third; a penalty on the spot
        /// with everyone else outside the box.
        mutating func freeKickSetup(at spot: CGPoint, from start: Double, foul: Bool, penalty: Bool = false) -> (Double, Double) {
            let s: Double = right ? 1 : -1
            let ball = penalty ? CGPoint(x: goal.x - s * Pitch.spot, y: Pitch.width / 2) : spot
            script.flights.append(Flight(kind: .carry, start: start, end: start + 0.6, from: FieldPoint(script.ball(at: start)?.ground ?? spot, z: 0.11),
                                         to: FieldPoint(ball, z: 0.11)))
            let attack = (men[.attacking] ?? []).filter { $0.player.place != 1 }
            guard let taker = attack.min(by: { hypot(position($0.actor, start).x - ball.x, position($0.actor, start).y - ball.y)
                < hypot(position($1.actor, start).x - ball.x, position($1.actor, start).y - ball.y) })?.actor else { return (start, 0) }
            let toGoal = CGPoint(x: goal.x - ball.x, y: goal.y - ball.y), d = max(hypot(toGoal.x, toGoal.y), 1)
            let u = CGPoint(x: toGoal.x / d, y: toGoal.y / d)
            move(taker, to: CGPoint(x: ball.x - u.x * 1.3, y: ball.y - u.y * 1.3), from: start, to: start + 1.6)
            script.actors[taker].looks.append(Look(from: start + 1.6, point: goal))
            reshape(ball: ball, from: start + 0.2, except: [taker])
            if penalty {
                // Everyone out of the box but the taker and the keeper.
                for (_, i) in (men[.attacking] ?? []) + (men[.defending] ?? []) where i != taker && script.actors[i].role != .keeper {
                    let p = position(i, start + 3.5)
                    if abs(p.x - goal.x) < Pitch.boxDepth + 1 {
                        move(i, to: CGPoint(x: goal.x - s * (Pitch.boxDepth + random.in(1...4)), y: p.y), from: start + 0.3, to: start + 2.6)
                    }
                }
            } else if d < 32, abs(ball.x - goal.x) < 40 {
                // The wall: three to five, 9.15 m off on the line to goal.
                let wall = (men[.defending] ?? []).filter { $0.player.place != 1 }.sorted { $0.player.line > $1.player.line }.prefix(d < 22 ? 5 : 3)
                let c = CGPoint(x: ball.x + u.x * Pitch.circle, y: ball.y + u.y * Pitch.circle), across = CGPoint(x: -u.y, y: u.x)
                for (k, w) in wall.enumerated() {
                    let off = (Double(k) - Double(wall.count - 1) / 2) * 0.75
                    move(w.actor, to: CGPoint(x: c.x + across.x * off, y: c.y + across.y * off), from: start + 0.4, to: start + 2.6 + random.in(0...0.4))
                    script.actors[w.actor].looks.append(Look(from: start + 2.8, point: ball))
                }
            }
            // Round the loop: the taker steps back, then up again.
            let t = start + 5
            let back = CGPoint(x: ball.x - u.x * random.in(3...5), y: ball.y - u.y * random.in(3...5) + random.in(-1...1))
            move(taker, to: back, from: t, to: t + 1.1)
            move(taker, to: CGPoint(x: ball.x - u.x * 1.3, y: ball.y - u.y * 1.3), from: t + 5, to: t + 6.1)
            focus.append((start, .infinity, [taker], [ball, CGPoint(x: ball.x + u.x * 14, y: ball.y + u.y * 14)], 26))
            return (t - 1, 11)
        }

        /// A booking: the referee in from a few strides off to where the foul
        /// was, the man to him, the card up; then the referee away and gone
        /// (he's on the pitch only for this). A red, and the man walks off.
        mutating func card(_ e: SoccerEvent, red: Bool) -> (Double, Double) {
            let spot = idle.ball
            let team: Team = (e.side == idle.possession) ? .attacking : .defending
            let booked = man(team, athlete: e.athlete, name: e.player, near: spot) ?? 0
            let side = random.sign()
            func onPitch(_ p: CGPoint) -> CGPoint { CGPoint(x: min(max(p.x, 3), Pitch.length - 3), y: min(max(p.y, 3), Pitch.width - 3)) }
            let referee = official("referee", at: onPitch(CGPoint(x: spot.x - side * 9, y: spot.y + random.sign() * 5)), until: 6.4)
            move(referee, to: spot, from: 0.2, to: 1.6)
            move(referee, to: onPitch(CGPoint(x: spot.x + side * 9, y: spot.y + random.sign() * 4)), from: 4.9, to: 6.9)
            move(booked, to: CGPoint(x: spot.x + 1.6, y: spot.y + random.sign() * 0.8), from: 0.3, to: 1.9)
            script.actors[booked].looks.append(Look(from: 1.9, point: spot))
            script.actors[referee].looks.append(Look(from: 1.7, point: CGPoint(x: spot.x + 1.6, y: spot.y)))
            script.actors[referee].holds.append(Hold(kind: .cardUp, from: 2.2, until: 4.6))
            script.props.append(SoccerProp(kind: red ? .redCard : .yellowCard, actor: referee, from: 2.2, until: 4.6))
            // The rest stand off a few yards.
            for (_, i) in (men[.attacking] ?? []) + (men[.defending] ?? []) where i != booked {
                let here = position(i, 0), d = hypot(here.x - spot.x, here.y - spot.y)
                guard d < 9 else { continue }
                let away = max(9 - d, 2)
                move(i, to: CGPoint(x: here.x + (here.x - spot.x) / max(d, 0.5) * away, y: here.y + (here.y - spot.y) / max(d, 0.5) * away), from: 0.4, to: 1.8)
            }
            var end = 7.5
            if red {
                let off = CGPoint(x: min(max(spot.x + random.in(-8...8), 10), Pitch.length - 10), y: -3)
                let walk = min(max(hypot(off.x - spot.x, off.y - spot.y) / 2.6, 3), 9)
                move(booked, to: off, from: 5.2, to: 5.2 + walk)
                script.actors[booked].vanish = 5.2 + walk - 0.6
                end = 5.2 + walk + 0.5
            }
            focus.append((0, red ? end : 6, [booked, referee], [spot], 16))
            return (end, 0)
        }

        /// A substitution at the halfway line: the man coming off walks to
        /// the touchline, the fourth official's board up, the man coming on
        /// runs to his place.
        mutating func substitution(_ e: SoccerEvent) -> (Double, Double) {
            let line = CGPoint(x: Pitch.length / 2, y: -1.2)
            let fourth = official("fourth official", at: CGPoint(x: line.x + 2.2, y: -3), until: 8.7)
            script.actors[fourth].holds.append(Hold(kind: .boardUp, from: 0.4, until: 8.5))
            script.props.append(SoccerProp(kind: .board, actor: fourth, from: 0.4, until: 8.5))
            script.actors[fourth].looks.append(Look(from: 0, point: Pitch.center))
            let off = man(.attacking, athlete: e.otherAthlete, name: e.other, near: Pitch.center) ?? 0
            let place = position(off, 0)
            let walk = min(max(hypot(place.x - line.x, place.y - line.y) / 2.4, 3), 9)
            move(off, to: CGPoint(x: line.x - 1.5, y: line.y), from: 0.6, to: 0.6 + walk)
            script.actors[off].vanish = 0.6 + walk - 0.4
            let on = add(.attacking, e.player ?? "substitute", at: CGPoint(x: line.x + 1, y: -3), athlete: e.athlete)
            script.actors[on].appear = 0.6 + walk - 0.6
            move(on, to: place, from: 0.6 + walk, to: 0.6 + walk + min(max(hypot(place.x - line.x, place.y - line.y) / 6, 2), 6))
            focus.append((0, 0.6 + walk + 1.5, [off, on, fourth], [line], 18))
            return (0.6 + walk + 6, 0)
        }

        /// A man down: on the grass where he is, the players round him, the
        /// physios running on from the bench side.
        mutating func injury(_ e: SoccerEvent) -> (Double, Double) {
            let team: Team = e.side == idle.possession ? .attacking : .defending
            let hurt = man(team, athlete: e.athlete, name: e.player, near: idle.ball) ?? (men[team]?.first?.actor ?? 0)
            let down = position(hurt, 0)
            script.actors[hurt].holds.append(Hold(kind: .down, from: 0.4, until: .infinity))
            for (_, i) in (men[.attacking] ?? []) + (men[.defending] ?? []) where i != hurt {
                let here = position(i, 0), d = hypot(here.x - down.x, here.y - down.y)
                guard d < 14 else { continue }
                let r = random.in(3.5...6.5), a = atan2(here.y - down.y, here.x - down.x)
                move(i, to: CGPoint(x: down.x + cos(a) * r, y: down.y + sin(a) * r), from: 0.6 + random.in(0...0.8), to: 2.8 + random.in(0...1))
                script.actors[i].looks.append(Look(from: 3, point: down))
            }
            var physios: [Int] = []
            for k in 0..<2 {
                let from = CGPoint(x: down.x + Double(k) * 3 - 1.5, y: -3)
                let p = add(.staff, "physio", at: from)
                script.actors[p].appear = 2.4
                let by = CGPoint(x: down.x + (k == 0 ? -1.1 : 1.1), y: down.y + (k == 0 ? -0.5 : 0.5))
                move(p, to: by, from: 2.8 + Double(k) * 0.3, to: 2.8 + Double(k) * 0.3 + min(max(hypot(by.x - from.x, by.y - from.y) / 6, 2), 7))
                script.actors[p].holds.append(Hold(kind: .kneel, from: 2.9 + Double(k) * 0.3 + min(max(hypot(by.x - from.x, by.y - from.y) / 6, 2), 7), until: .infinity))
                script.actors[p].looks.append(Look(from: 3, point: down))
                physios.append(p)
            }
            focus.append((0, .infinity, [hurt] + physios, [down], 14))
            let arrive = physios.compactMap { script.actors[$0].moves.last?.end }.max() ?? 9
            return (arrive + 1, 10)
        }

        /// The kick-off: each team in its own half, the ball on the spot, two
        /// of the side kicking off at it; the second half's with the ends changed.
        mutating func kickoff(_ e: SoccerEvent) -> (Double, Double) {
            let c = Pitch.center
            script.flights = [Flight(kind: .carry, start: 0, end: 0.01, from: FieldPoint(c, z: 0.11), to: FieldPoint(c, z: 0.11))]
            for team in [Team.attacking, .defending] {
                let own: Double = (team == .attacking ? right : !right) ? -1 : 1
                for (p, i) in men[team] ?? [] {
                    var q = shape(p, team: team, ball: c)
                    // In its own half, outside the circle (the kickers aside).
                    q.x = own < 0 ? min(q.x, c.x - 1.2) : max(q.x, c.x + 1.2)
                    if hypot(q.x - c.x, q.y - c.y) < Pitch.circle + 0.5, team == .defending {
                        q.x = c.x - own * -(Pitch.circle + 1)
                    }
                    script.actors[i].at = q
                    script.actors[i].looks.append(Look(from: 0, point: c))
                }
            }
            let forwards = (men[.attacking] ?? []).filter { $0.player.line >= 3 }.map(\.actor)
            let s: Double = right ? -1 : 1
            for (k, i) in forwards.prefix(2).enumerated() {
                script.actors[i].at = CGPoint(x: c.x + s * (k == 0 ? 0.4 : 1.6), y: c.y + (k == 0 ? -0.6 : 7))
            }
            // Loop: the kicker's foot on the ball, a man bouncing on his toes.
            if let kicker = forwards.first {
                script.actors[kicker].holds.append(Hold(kind: .cardUp, from: 4, until: 4.8))
            }
            if let fidget = choose((men[.defending] ?? []).map(\.actor)) {
                let here = script.actors[fidget].at
                move(fidget, to: CGPoint(x: here.x, y: here.y + 1.5), from: 6, to: 6.7)
                move(fidget, to: here, from: 9, to: 9.7)
            }
            focus.append((0, .infinity, forwards, [c], 40))
            return (1, 10)
        }

        // MARK: Camera and beats

        /// The camera on what the beat is about (the ball and the men near
        /// it, else the event's men), following through a beat and still
        /// between; the beats: whenever anyone or the ball moves, or a pose
        /// or prop changes.
        mutating func finish() {
            let script = self.script, focus = self.focus
            let end = max(script.duration, 1)
            func goal(_ t: Double) -> CameraFrame {
                let ball = script.ball(at: t)?.ground ?? idle.ball
                let f = focus.last { t >= $0.from && t < $0.until }
                // What the beat is about; else the ball and the men round it.
                var rooms: [PitchCamera.Room] = f == nil ? [PitchCamera.Room(FieldPoint(ball), figure: false)] : []
                if let f {
                    rooms += f.actors.filter { script.actors[$0].opacity(at: t) > 0.5 }.map { PitchCamera.Room(FieldPoint(script.actors[$0].position(at: t)), figure: true) }
                    rooms += f.points.map { PitchCamera.Room(FieldPoint($0), figure: false) }
                } else {
                    rooms += script.actors.indices.filter { i in
                        let p = script.actors[i].position(at: t)
                        return script.actors[i].opacity(at: t) > 0.5 && script.actors[i].team != .official && hypot(p.x - ball.x, p.y - ball.y) < 22
                    }.map { PitchCamera.Room(FieldPoint(script.actors[$0].position(at: t)), figure: true) }
                }
                return PitchCamera.fitting(rooms, headroom: CameraFrame.headroom + 0.07, closest: f?.closest ?? 30)
            }
            let samples = CameraFollow.samples(until: end, goal: goal)
            self.script.camera = samples
            var beats: [ClosedRange<Double>] = []
            for a in script.actors {
                beats += a.moves.map { $0.start...($0.end + 0.3) }
                beats += a.actions.map { ($0.at - 0.4)...($0.at + 0.5) }
                beats += a.holds.flatMap { h in [(h.from - 0.1)...(h.from + 0.45)] + (h.until.isFinite ? [(h.until - 0.1)...(h.until + 0.45)] : []) }
                if a.vanish.isFinite { beats.append(a.vanish...(a.vanish + Actor.fade + 0.05)) }
                if a.appear.isFinite, a.appear > 0 { beats.append(a.appear...(a.appear + Actor.fade + 0.05)) }
            }
            beats += script.flights.filter { $0.end - $0.start > 0.02 }.map { $0.start...($0.end + 0.1) }
            beats += script.props.flatMap { [($0.from - 0.1)...($0.from + 0.3), ($0.until - 0.1)...($0.until + 0.3)] }
            if script.ballGone.isFinite { beats.append(script.ballGone...(script.ballGone + 0.35)) }
            var travelling: Double?
            for (k, pair) in zip(samples, samples.dropFirst()).enumerated() {
                let t = Double(k + 1) / CameraFollow.rate
                let moved = abs(pair.1.x - pair.0.x) + abs(pair.1.y - pair.0.y) > pair.0.span * 0.0004 || abs(pair.1.span - pair.0.span) > pair.0.span * 0.0004
                if moved, travelling == nil { travelling = t }
                if !moved, let from = travelling { beats.append(from...t); travelling = nil }
            }
            if let from = travelling { beats.append(from...end) }
            self.script.beats = FootballScript.Builder.merged(beats.map { max($0.lowerBound, 0)...min(max($0.upperBound, 0), end) })
        }
    }
}

// MARK: - Poses

extension RigPose {
    /// The referee's card (or the assistant's flag, a kicker's signal): one arm straight up.
    static let cardUp = RigPose(lean: -0.05, rightArm: RigArm(swing: 3.0, spread: 0.12, turn: 0.3, bend: 0.05))
    /// The board held up in both hands.
    static let boardUp = RigPose(lean: -0.08, leftArm: RigArm(swing: 2.8, spread: 0.1, turn: 0.3, bend: 0.25),
                                 rightArm: RigArm(swing: 2.8, spread: 0.1, turn: 0.3, bend: 0.25))
}

// MARK: - Status

/// The broadcast tag over the pitch: the team on the ball, each event as it
/// comes ("CORNER · ARSENAL", "FOUL · RICE", "YELLOW CARD · GUÉHI", "VAR
/// CHECK"), the break ("HALF TIME"), and the added time once it's announced
/// ("+4 ADDED"). (pure; tested)
enum SoccerStatus {
    struct Names: Equatable {
        var top: String
        var bottom: String
        var topColor: String?
        var bottomColor: String?

        func name(_ side: GameDetail.Side?) -> String? { side.map { $0 == .top ? top : bottom }.flatMap { $0.isEmpty ? nil : $0 } }
        func color(_ side: GameDetail.Side?) -> String? { side.flatMap { $0 == .top ? topColor : bottomColor } }
    }

    static let yellow = "FFD61A"
    static let red = "D7261E"

    /// "Arsenal ball".
    static func ball(_ side: GameDetail.Side?, names: Names) -> TheaterStatus {
        TheaterStatus(tag: names.name(side).map { "\($0) ball" }, tint: names.color(side))
    }

    /// Between moments, t into the idle; `added`: the minutes announced, while they're being played.
    static func idle(_ idle: SoccerIdle, t: Double, names: Names, added: Int?) -> TheaterStatus {
        switch idle.phase {
        case .play:
            if let added, t.truncatingRemainder(dividingBy: 20) < 8 { return TheaterStatus(tag: "+\(added) added") }
            return ball(idle.possession, names: names)
        case let .event(e):
            let who = e.surname
            switch e.kind {
            case .corner: return TheaterStatus(tag: ["Corner", names.name(e.side)].compactMap { $0 }.joined(separator: " · "), tint: names.color(e.side))
            case .foul, .handball:
                if e.penalty { return TheaterStatus(tag: ["Penalty", names.name(idle.possession)].compactMap { $0 }.joined(separator: " · "),
                                                   tint: names.color(idle.possession)) }
                if t < 4.2 { return TheaterStatus(tag: [e.kind == .handball ? "Handball" : "Foul", who].compactMap { $0 }.joined(separator: " · "), tint: names.color(e.side)) }
                return TheaterStatus(tag: ["Free kick", names.name(idle.possession)].compactMap { $0 }.joined(separator: " · "), tint: names.color(idle.possession))
            case .offside:
                if t < 6 { return TheaterStatus(tag: ["Offside", who].compactMap { $0 }.joined(separator: " · "), tint: names.color(e.side)) }
                return TheaterStatus(tag: ["Free kick", names.name(idle.possession)].compactMap { $0 }.joined(separator: " · "), tint: names.color(idle.possession))
            case let .card(red, second):
                let kind = second ? "Second yellow" : red ? "Red card" : "Yellow card"
                return TheaterStatus(tag: [kind, who].compactMap { $0 }.joined(separator: " · "), tint: red ? self.red : yellow)
            case .substitution:
                let on = e.surname, off = e.other.map(SoccerScene.surname)
                let tag = on != nil && off != nil ? "\(on!) on · \(off!) off" : ["Substitution", names.name(e.side)].compactMap { $0 }.joined(separator: " · ")
                return TheaterStatus(tag: tag, tint: names.color(e.side))
            case .injury: return TheaterStatus(tag: ["Injury", who].compactMap { $0 }.joined(separator: " · "), tint: names.color(e.side))
            case .delay: return TheaterStatus(tag: "Delay in match")
            case .varCheck: return TheaterStatus(tag: "VAR check")
            case let .varDecision(words): return TheaterStatus(tag: "VAR · \(words)")
            case .resume: return ball(idle.possession, names: names)
            case .kickoff: return TheaterStatus(tag: "Kick-off")
            case .secondHalf: return TheaterStatus(tag: "Second half")
            case .halftime: return TheaterStatus(tag: "Half time")
            case .fullTime: return TheaterStatus(tag: "Full time")
            }
        }
    }

    /// During a moment's replay: how the move began, the team on the ball.
    static func replay(_ scene: SoccerScene, names: Names) -> TheaterStatus {
        let team = names.name(scene.side)
        let tag: String? = switch scene.start {
        case .corner: ["Corner", team].compactMap { $0 }.joined(separator: " · ")
        case .freeKick: ["Free kick", team].compactMap { $0 }.joined(separator: " · ")
        case .penalty: ["Penalty", team].compactMap { $0 }.joined(separator: " · ")
        default: team.map { "\($0) ball" }
        }
        return TheaterStatus(tag: tag, tint: names.color(scene.side))
    }

    /// When the idle's tag changes (script time), for the stage to wake.
    static func changes(_ idle: SoccerIdle, added: Int?) -> [Double] {
        switch idle.phase {
        case .play: added == nil ? [] : [8, 20, 28]
        case let .event(e):
            switch e.kind {
            case .foul, .handball: [4.2]
            case .offside: [6]
            default: []
            }
        }
    }
}
