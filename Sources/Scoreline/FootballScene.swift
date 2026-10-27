import Foundation

// The football theater's model: one snap (or kick) parsed from ESPN's core
// play-by-play into what the theater replays: the kind of play, where the
// ball was snapped and where it ended up, the hole a run went through or the
// depth and side of a pass, where the ball changed hands or came down, the
// downs before and after, the flag and its yards, and who was in on it by
// position. Pure values: the parser is tested against a real game, and the
// replay is a function of the scene and time.
//
// Spots are yards from the offense's own goal line (0…100; the end zones
// beyond), whoever has the ball after. ESPN counts its `yardLine` from the
// home team's goal line (as the drive chart reads it, through
// `FootballGeometry`); the text's spots ("to DAL 32") are read the same way.
// Structured fields decide the play (its type, the spots, the scoring and
// turnover flags); the text adds what only it says: the direction, the
// depth, out of bounds, a touchback or a fair catch, and the spots in between.

struct FootballScene: Equatable, Identifiable {
    enum Kind: Equatable {
        case pass, incomplete, rush, sack, kneel, spike
        case interception
        /// Lost: the other team recovered (a fumble the offense keeps is its run or sack).
        case fumble
        case punt, kickoff
        case fieldGoal(good: Bool)
        case extraPoint(good: Bool)
        /// A flag that wiped out the snap, or stopped it: yards walked off.
        case penalty
        /// A play we can't name: the ball goes from its spot to where it ended.
        case other
    }

    /// The offense's left and right (the theater stands behind it).
    enum Lane: Equatable { case left, middle, right }

    /// Where a run went in: "left guard", "right tackle", "left end", "up the middle".
    enum Gap: Equatable { case middle, `guard`, tackle, end }

    enum Depth: Equatable { case short, deep }

    enum Scoring: Equatable { case touchdown, fieldGoal, safety }

    /// How a kick ended for the team receiving it.
    enum Kick: Equatable { case returned, fairCatch, downed, outOfBounds, touchback }

    enum Miss: Equatable { case wideLeft, wideRight, short, blocked }

    /// How the offense lined up, as far as the play says (in the gun or
    /// under center is `shotgun`).
    enum Formation: Equatable {
        /// Three wide and a tight end; under center on a run, a fullback and two wide.
        case base
        /// An extra lineman reported in as eligible: two tight ends, a fullback, one wide.
        case heavy
        /// Nobody behind the quarterback: five out wide.
        case empty
        /// Three receivers bunched tight on one side.
        case bunch
        /// The kneel: a back at each of the quarterback's hips, one deep.
        case victory
    }

    /// The try after a touchdown, as the touchdown's entry tells it (ESPN
    /// adds it once it's taken): a kick, or a pass or a run from the 2.
    struct Attempt: Equatable {
        enum Kind: Equatable { case kick, pass, rush }
        var kind: Kind
        var good: Bool
        /// Its own words ("B.Aubrey extra point is GOOD, Center-T.Sieg, Holder-B.Anger.").
        var text: String
    }

    /// ESPN's positions, as the theater stands them up.
    enum Position: Equatable {
        case quarterback, back, fullback, receiver, tightEnd, lineman
        case defensiveLine, linebacker, corner, safety
        case kicker, punter, snapper

        var defense: Bool { [.defensiveLine, .linebacker, .corner, .safety].contains(self) }

        /// ESPN's position IDs ("…/positions/8"): QB 8, RB 9, FB 10, WR 1, TE 7, PK 22, P 23, LS 78; the line and the defense by group.
        init?(espn id: Int) {
            switch id {
            case 8: self = .quarterback
            case 9: self = .back
            case 10: self = .fullback
            case 1: self = .receiver
            case 7: self = .tightEnd
            case 2...6, 46, 70...77, 79: self = .lineman
            case 11...13, 31, 32: self = .defensiveLine
            case 14...16, 30, 33...35: self = .linebacker
            case 17, 18, 29: self = .corner
            case 19, 20, 36...38: self = .safety
            case 22: self = .kicker
            case 23: self = .punter
            case 78: self = .snapper
            default: return nil
            }
        }
    }

    /// Someone in on the play: their part ("rusher", "tackler", "sackedBy"),
    /// athlete ID and position.
    struct Participant: Equatable {
        var role: String
        var id: String?
        var position: Position?
    }

    /// The down and distance at a spot ("3rd & 7").
    struct Down: Equatable {
        var down: Int
        var distance: Int
    }

    struct Penalty: Equatable {
        /// "Offensive Holding".
        var name: String?
        var yards: Int
        /// The snap didn't count ("… - No Play").
        var noPlay: Bool
    }

    let id: String
    var kind: Kind
    /// The team that snapped or kicked.
    var offense: GameDetail.Side?
    /// Where the ball was snapped (or kicked from) and where it ended up.
    var from: Double
    var to: Double
    var before: Down?
    /// The downs after, for whoever has the ball (nil after a score or a kick).
    var after: Down?
    /// ESPN's yards: the gain, a kick's return, a penalty's.
    var yards = 0
    var lane: Lane?
    var gap: Gap?
    var depth: Depth?
    var shotgun = false
    var formation = Formation.base
    /// Where the ball was spotted across the field, in the offense's frame:
    /// on the left or right hash, or between them. The text never says: the
    /// feed works it out from the plays before (`FootballFeed.spot`).
    var hash = Lane.middle
    var outOfBounds = false
    /// A pass: yards past the line where it was caught or thrown to (ESPN's
    /// yards after the catch, else the text's depth).
    var air: Double?
    /// Where the ball changed hands or came down: the interception, the
    /// fumble's recovery, a kick's landing.
    var turn: Double?
    /// Where the ball was put on the ground or popped loose (a fumble).
    var loose: Double?
    /// Where the ball carrier was stopped before a flag's yards were walked off.
    var stopped: Double?
    var kick: Kick?
    /// A kick's length ("kicks 59 yards", "55 yard field goal").
    var kickYards: Int?
    var miss: Miss?
    var scoring: Scoring?
    /// The ball changed hands on the play (a turnover, a kick, fourth down).
    var flips = false
    var onDowns = false
    var penalty: Penalty?
    /// A touchdown's try, once its entry has it.
    var attempt: Attempt?
    /// On a try's own scene: how the point (or two) after was tried.
    var pointAfter: Attempt.Kind?
    var participants: [Participant] = []
    /// Short names by part, from the text ("Barkley").
    var names: [String: String] = [:]
    var text = ""
    var wallclock: Date?

    /// The line to gain before the snap; nil on goal to go.
    var gainBefore: Double? {
        guard let before, before.down > 0, from + Double(before.distance) < 100 else { return nil }
        return from + Double(before.distance)
    }

    /// The line to gain after it, for whoever has the ball (the other team
    /// goes the other way); nil on goal to go, after a score or a kick off.
    var gainAfter: Double? {
        guard let after, after.down > 0, scoring == nil else { return nil }
        let line = flips ? to - Double(after.distance) : to + Double(after.distance)
        return line > 0 && line < 100 ? line : nil
    }

    /// A new set of downs for the same team: past the line to gain, or a
    /// flag's first down (the distance reset rather than walked off).
    var firstDown: Bool {
        guard !flips, scoring == nil, let after, after.down == 1, let before, before.down > 0 else { return false }
        return before.down > 1 || to >= from + Double(before.distance) - 0.01
            || Double(after.distance) > Double(before.distance) - (to - from) + 0.5
    }

    /// A kick's return, from where it was caught to where he was stopped.
    var returnYards: Int? {
        guard let turn, kind == .kickoff || kind == .punt, kick == .returned else { return nil }
        return Int((turn - (stopped ?? to)).rounded())
    }

    /// The team whose points they are.
    var scorer: GameDetail.Side? {
        guard let scoring, let offense else { return nil }
        switch scoring {
        case .fieldGoal: return offense
        case .safety: return Self.opponent(offense)
        case .touchdown: return to <= 0.5 ? Self.opponent(offense) : offense
        }
    }

    /// The team without the ball.
    var defense: GameDetail.Side? { offense.map(Self.opponent) }

    static func opponent(_ side: GameDetail.Side) -> GameDetail.Side { side == .top ? .bottom : .top }

    var pickSix: Bool { kind == .interception && scoring == .touchdown }

    /// The first participant in a part.
    func position(_ role: String) -> Position? { participants.first { $0.role == role }?.position }

    /// Everyone credited with the stop, by position.
    var tacklers: [Position?] { participants.filter { $0.role == "tackler" || $0.role == "assistedBy" }.map(\.position) }

    /// A touchdown's try as a scene of its own, replayed as a short beat
    /// after it: the kick from the 15, or the pass or run from the 2, by the
    /// team that scored, from the middle of the field.
    var conversion: FootballScene? {
        guard let attempt, scoring == .touchdown, let side = scorer else { return nil }
        let kick = attempt.kind == .kick
        let from: Double = kick ? 85 : 98
        let kind: Kind = switch attempt.kind {
        case .kick: .extraPoint(good: attempt.good)
        case .pass: attempt.good ? .pass : .incomplete
        case .rush: .rush
        }
        var scene = FootballScene(id: id + "-try", kind: kind, offense: side, from: from,
                                  to: kick ? from : attempt.good ? 100 : attempt.kind == .rush ? 99 : from)
        scene.pointAfter = attempt.kind
        scene.text = attempt.text
        scene.wallclock = wallclock
        scene.scoring = attempt.good && !kick ? .touchdown : nil
        scene.yards = attempt.good && !kick ? 2 : 0
        scene.shotgun = attempt.kind == .pass
        let lower = attempt.text.lowercased()
        if let m = lower.firstMatch(of: #/(left|right) (end|tackle|guard)/#) {
            scene.lane = Self.lane(m.1)
            scene.gap = m.2 == "end" ? .end : m.2 == "tackle" ? .tackle : .guard
        } else if let m = lower.firstMatch(of: #/pass (?:short |deep )?(left|middle|right)/#) {
            scene.lane = Self.lane(m.1)
            scene.depth = .short
        } else if lower.contains("middle") {
            scene.lane = .middle
            scene.gap = .middle
        }
        scene.names = Self.names(attempt.text)
        // The quarterback who threw the touchdown keeps it himself.
        if attempt.kind == .rush, kind == .rush, self.kind == .pass, let passer = names["lead"], scene.names["lead"] == passer {
            scene.participants = [Participant(role: "rusher", id: nil, position: .quarterback)]
        }
        return scene
    }

    /// Where the next snap is spotted across the field, in the next
    /// offense's frame: on the hash nearest where this play ended (between
    /// the hashes, where it lay; over the side it went out of bounds); back
    /// where it was after an incompletion or a flag; in the middle after a
    /// score, a kick off or a return. The other way round when the ball
    /// changed hands. (pure; tested)
    var nextHash: Lane {
        if scoring != nil { return .middle }
        let side: Lane
        switch kind {
        case .kickoff, .extraPoint: return .middle
        case .punt:
            // Out of bounds where the punter aimed it (his right); else the return's end isn't known.
            side = kick == .outOfBounds ? .right : .middle
        case .fieldGoal:
            // A miss: the spot of the kick, the holder's.
            side = hash
        case .incomplete, .spike, .penalty, .kneel, .sack:
            side = hash
        case .pass, .rush, .other, .fumble, .interception:
            side = lane ?? hash
        }
        guard flips else { return side }
        return side == .left ? .right : side == .right ? .left : .middle
    }
}

/// What the football theater shows: the last snap, and whether to replay it.
struct FootballTheaterState: Equatable {
    var play: FootballScene?
    /// Arrived while the page was open, or only just happened: replay it.
    var news = false
}


// MARK: - Parsing

extension FootballScene {
    /// Clock stoppages and admin entries: not snaps.
    static let notPlays: Set<String> = ["timeout", "official timeout", "end period", "end of half", "end of game",
                                        "two-minute warning", "coin toss", "end of regulation"]

    /// A core play as a scene; nil for an entry that isn't a snap or a kick.
    static func parse(_ item: JSON, teams: FootballFeed.Teams) -> FootballScene? {
        let type = (item["type"]["text"].string ?? "").lowercased()
        guard let id = item["id"].string, !notPlays.contains(type), !type.hasPrefix("end "),
              let fromLine = item["start"]["yardLine"].double, let toLine = item["end"]["yardLine"].double else { return nil }
        let text = item["text"].string ?? ""
        let play = playText(text)
        let kicking = type.contains("kickoff") || type.contains("punt")
        // The team that snapped or kicked: the start's (the play's own team is the receiving one on a kick or a return).
        let startTeam = idFrom(item["start"]["team"]["$ref"].string, "/teams/")
        let offense = teams.side(startTeam ?? (kicking ? nil : idFrom(item["team"]["$ref"].string, "/teams/")))
        guard let offense else { return nil }
        let home = (offense == .top) == teams.topIsHome
        func yard(_ line: Double) -> Double { home ? line : 100 - line }
        func spot(_ token: Substring?) -> Double? {
            guard let token else { return nil }
            if token == "50" { return 50 }
            let parts = token.split(separator: " ")
            guard parts.count == 2, let n = Double(parts[1]) else { return nil }
            if parts[0] == teams.homeAbbreviation { return yard(n) }
            if parts[0] == teams.awayAbbreviation { return yard(100 - n) }
            return nil
        }

        var scene = FootballScene(id: id, kind: kind(type, play: play.lowercased()), offense: offense, from: yard(fromLine), to: yard(toLine))
        scene.text = text
        scene.wallclock = item["wallclock"].string.flatMap(parseDate)
        scene.yards = item["statYardage"].int ?? 0
        if let down = item["start"]["down"].int, (1...4).contains(down) {
            scene.before = Down(down: down, distance: item["start"]["distance"].int ?? 10)
        }
        if let down = item["end"]["down"].int, (1...4).contains(down) {
            scene.after = Down(down: down, distance: item["end"]["distance"].int ?? 10)
        }
        let endTeam = idFrom(item["end"]["team"]["$ref"].string, "/teams/")
        scene.flips = startTeam != nil && endTeam != nil && startTeam != endTeam
        if item["scoringPlay"].bool == true {
            switch item["scoringType"]["name"].string {
            case "field-goal"?: scene.scoring = .fieldGoal
            case "safety"?: scene.scoring = .safety
            default: scene.scoring = .touchdown
            }
        }
        if type.contains("safety") { scene.scoring = .safety }
        if scene.kind == .fumble, item["isTurnover"].bool != true, !scene.flips {
            // Recovered by its own side: the run (or sack) it was.
            scene.kind = play.contains("sacked") ? .sack : .rush
        }
        switch scene.kind {
        case .pass, .incomplete, .rush, .sack, .kneel, .spike, .other:
            scene.onDowns = scene.flips && scene.before?.down == 4 && scene.scoring == nil
        default:
            break
        }
        scene.participants = item["participants"].array.map { p in
            Participant(role: p["type"].string ?? "", id: idFrom(p["athlete"]["$ref"].string, "/athletes/"),
                        position: idFrom(p["position"]["$ref"].string, "/positions/").flatMap(Int.init).flatMap { Position(espn: $0) })
        }
        let flag = item["penalty"]
        if flag.exists, flag["status"]["slug"].string != "declined" {
            scene.penalty = Penalty(name: flag["type"]["text"].string, yards: flag["yards"].int ?? abs(scene.yards),
                                    noPlay: text.contains("No Play"))
        } else if scene.kind == .penalty {
            scene.penalty = Penalty(name: text.firstMatch(of: #/PENALTY on [^,]+, ([^,]+),/#).map { String($0.1) },
                                    yards: abs(scene.yards), noPlay: text.contains("No Play"))
        }
        scene.names = names(play)

        // What only the text says.
        let lower = play.lowercased()
        scene.shotgun = text.contains("Shotgun")
        scene.formation = formation(text, kind: scene.kind)
        scene.outOfBounds = lower.contains(" ob ") || lower.contains(" ob at") || lower.contains("out of bounds")
        if let m = lower.firstMatch(of: #/pass (?:incomplete )?(short|deep) (left|middle|right)/#) {
            scene.depth = m.1 == "deep" ? .deep : .short
            scene.lane = lane(m.2)
        }
        if scene.lane == nil, let m = lower.firstMatch(of: #/(left|right) (end|tackle|guard)/#) {
            scene.lane = lane(m.1)
            scene.gap = m.2 == "end" ? .end : m.2 == "tackle" ? .tackle : .guard
        } else if scene.lane == nil, lower.contains("up the middle") || lower.contains("middle") {
            scene.lane = .middle
            scene.gap = .middle
        }
        // Where the ball carrier was stopped ("to DAL 41 for 6 yards", "pushed ob at PHI 37").
        scene.stopped = play.firstMatch(of: #/(?:to|at) ([A-Z]{2,4} \d{1,2}|50) for (?:-?\d+ yards?|no gain)/#).flatMap { spot($0.1) }
        switch scene.kind {
        case .pass, .incomplete:
            if let afterCatch = item["yardsAfterCatch"].int, scene.kind == .pass {
                scene.air = Double(scene.yards - afterCatch)
            } else if let depth = scene.depth {
                // Short is about 5–10 yards past the line; deep, 20 and more.
                scene.air = scene.kind == .pass ? Double(min(scene.yards, depth == .deep ? max(scene.yards - 4, 20) : 7))
                    : depth == .deep ? 24 : 7
            }
        case .interception:
            scene.turn = play.firstMatch(of: #/INTERCEPTED by \S+ at ([A-Z]{2,4} \d{1,2}|50)/#).flatMap { spot($0.1) }
            if let turn = scene.turn { scene.air = turn - scene.from }
            scene.stopped = nil
        case .fumble:
            scene.loose = play.firstMatch(of: #/FUMBLES[^,.]*? at ([A-Z]{2,4} \d{1,2}|50)/#).flatMap { spot($0.1) }
            scene.turn = play.firstMatch(of: #/RECOVERED by \S+ at ([A-Z]{2,4} \d{1,2}|50)/#).flatMap { spot($0.1) } ?? scene.loose
        case .sack:
            scene.stopped = play.firstMatch(of: #/sacked at ([A-Z]{2,4} \d{1,2}|50)/#).flatMap { spot($0.1) }
        case .kickoff, .punt:
            let landing = play.firstMatch(of: #/(?:kicks|punts) (\d+) yards?(?: from [A-Z]{2,4} \d{1,2}| from 50)? to (?:the )?([A-Z]{2,4} \d{1,2}|50|end zone)/#)
            scene.kickYards = landing.flatMap { Int($0.1) }
            if let landing {
                scene.turn = landing.2 == "end zone" ? 105 : spot(landing.2)
            }
            if scene.turn == nil, let yards = scene.kickYards { scene.turn = scene.from + Double(yards) }
            scene.kick = lower.contains("touchback") ? .touchback
                : lower.contains("fair catch") ? .fairCatch
                : lower.contains("downed") ? .downed
                : lower.contains("out of bounds") && !play.contains(" for ") ? .outOfBounds
                : .returned
            // A return's end: the returner stopped ("J.Mingo to DAL 35 for 25 yards"); else where it was downed or caught.
            scene.stopped = play.firstMatch(of: #/(?:to|at) ([A-Z]{2,4} \d{1,2}|50) for (?:-?\d+ yards?|no gain)/#).flatMap { spot($0.1) }
                ?? ([.downed, .fairCatch, .outOfBounds].contains(scene.kick) ? scene.turn : nil)
        case .fieldGoal, .extraPoint:
            scene.kickYards = lower.firstMatch(of: #/(\d+) yard field goal/#).flatMap { Int($0.1) }
            if case .fieldGoal(false) = scene.kind {
                scene.miss = lower.contains("blocked") ? .blocked : lower.contains("wide right") ? .wideRight
                    : lower.contains("wide left") ? .wideLeft : lower.contains("short") ? .short : .wideRight
            } else if case .extraPoint(false) = scene.kind {
                scene.miss = lower.contains("blocked") ? .blocked : lower.contains("wide left") ? .wideLeft : .wideRight
            }
        default:
            break
        }
        if scene.scoring == .touchdown { scene.attempt = attempt(item, text: text) }
        // A try logged as its own entry: from the 15 or the 2, whatever the spot says.
        if case .extraPoint = scene.kind {
            scene.pointAfter = .kick
            if !(80...99).contains(scene.from) { (scene.from, scene.to) = (85, 85) }
        } else if type.contains("two point") || type.contains("two-point") || type.contains("2pt") {
            let good = type.contains("good") || type.contains("succeed") || lower.contains("succeeds") || lower.contains("is good")
            let pass = type.contains("pass") || lower.contains(" pass ")
            scene.pointAfter = pass ? .pass : .rush
            scene.kind = pass ? (good ? .pass : .incomplete) : .rush
            scene.scoring = good ? .touchdown : nil
            if !(95...99).contains(scene.from) { scene.from = 98 }
            scene.to = good ? 100 : min(scene.from + 1, 99)
            scene.before = nil
            scene.after = nil
        }
        return scene
    }

    /// The set the text implies: an extra lineman reported in (a heavy
    /// set), an empty backfield, a bunch; the kneel's victory formation.
    static func formation(_ text: String, kind: Kind) -> Formation {
        if kind == .kneel { return .victory }
        let lower = text.lowercased()
        if lower.contains("reported in as eligible") || lower.contains("jumbo") { return .heavy }
        // The formation's own words, in its parentheses ("(Shotgun, Empty)").
        let hints = text.matches(of: #/\(([^)]*)\)/#).map { $0.1.lowercased() }.joined(separator: " ")
        if hints.contains("empty") { return .empty }
        if hints.contains("bunch") || hints.contains("trips") { return .bunch }
        return .base
    }

    /// The try in a touchdown's entry: "J.Elliott extra point is GOOD, …",
    /// "TWO-POINT CONVERSION ATTEMPT. D.Prescott rushes left guard. ATTEMPT
    /// SUCCEEDS."; else as `pointAfterAttempt` names it ("Extra Point Good").
    static func attempt(_ item: JSON, text: String) -> Attempt? {
        let named = (item["pointAfterAttempt"]["text"].string ?? "").lowercased()
        if let r = text.range(of: "TWO-POINT CONVERSION ATTEMPT", options: .caseInsensitive) {
            let words = text[r.upperBound...].trimmingCharacters(in: CharacterSet(charactersIn: ". "))
            let lower = words.lowercased()
            let good = lower.contains("succeeds") || (!lower.contains("fails") && (item["pointAfterAttempt"]["value"].int ?? 0) == 2)
            let pass = lower.contains(" pass") || named.contains("pass")
            return Attempt(kind: pass ? .pass : .rush, good: good, text: words)
        }
        if let r = text.range(of: #"[A-Z]\.[\w'\-]+ extra point is"#, options: .regularExpression) {
            let words = String(text[r.lowerBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
            return Attempt(kind: .kick, good: words.lowercased().contains("is good"), text: words)
        }
        guard !named.isEmpty else { return nil }
        let kind: Attempt.Kind = named.contains("pass") ? .pass : named.contains("rush") ? .rush : .kick
        let good = !(named.contains("miss") || named.contains("block") || named.contains("fail") || named.contains("no good"))
        return Attempt(kind: kind, good: good, text: item["pointAfterAttempt"]["text"].string ?? "")
    }

    /// The type of play, from ESPN's type (the text only for kneels and
    /// spikes, which share a type with runs and incompletions).
    static func kind(_ type: String, play: String) -> Kind {
        if type.contains("kickoff") { return .kickoff }
        if type.contains("punt") { return .punt }
        if type.contains("field goal") {
            return .fieldGoal(good: type.contains("good") && !type.contains("blocked"))
        }
        if type.contains("extra point") || type.contains("pat") {
            return .extraPoint(good: type.contains("good") || play.contains("is good"))
        }
        if type.contains("interception") { return .interception }
        if type.contains("fumble") { return .fumble }
        if type.contains("sack") { return .sack }
        if type.contains("penalty") { return .penalty }
        if type.contains("incompletion") || type.contains("incomplete") { return play.contains("spike") ? .spike : .incomplete }
        if type.contains("pass") || type.contains("reception") { return .pass }
        if type.contains("rush") {
            return play.contains("kneels") || play.contains("takes a knee") ? .kneel : .rush
        }
        if type.contains("safety") { return play.contains("sacked") ? .sack : .rush }
        return .other
    }

    private static func lane(_ word: Substring) -> Lane { word == "left" ? .left : word == "right" ? .right : .middle }

    /// The play as it stood: after a review's reversal, before a penalty,
    /// without the clock, the formation or a lineman reporting in.
    static func playText(_ text: String) -> String {
        var play = text
        if let reversed = play.range(of: "REVERSED.", options: .backwards) { play = String(play[reversed.upperBound...]) }
        if let flag = play.range(of: "PENALTY") { play = String(play[..<flag.lowerBound]) }
        play = play.replacing(#/\((?:\d+:\d+|[^)]*(?:Shotgun|Huddle|formation)[^)]*)\)/#, with: "")
        play = play.replacing(#/[A-Z]\.[\w'\-]+ reported in as eligible\.?/#, with: "")
        return play.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Short names by part: who ran, threw, caught, kicked, made the stop.
    static func names(_ play: String) -> [String: String] {
        var out: [String: String] = [:]
        func short(_ s: Substring) -> String {
            String(s.split(separator: ".", maxSplits: 1).last ?? s).trimmingCharacters(in: .whitespaces)
        }
        if let m = play.firstMatch(of: #/^([A-Z][A-Za-z]{0,2}\.\s?[A-Z][A-Za-z'\-]+)/#) { out["lead"] = short(m.1) }
        if let m = play.firstMatch(of: #/(?:to|for) ([A-Z][A-Za-z]{0,2}\.\s?[A-Z][A-Za-z'\-]+)/#) { out["target"] = short(m.1) }
        if let m = play.firstMatch(of: #/\(([A-Z][A-Za-z]{0,2}\.\s?[A-Z][A-Za-z'\-]+)/#) { out["stop"] = short(m.1) }
        if let m = play.firstMatch(of: #/(?:INTERCEPTED|RECOVERED) by (?:[A-Z]{2,4}-)?([A-Z][A-Za-z]{0,2}\.\s?[A-Z][A-Za-z'\-]+)/#) {
            out["taker"] = short(m.1)
        }
        if let m = play.firstMatch(of: #/\. ([A-Z][A-Za-z]{0,2}\.\s?[A-Z][A-Za-z'\-]+) (?:to|for|pushed|ran|MUFFS|fair)/#) { out["returner"] = short(m.1) }
        return out
    }

    private static func idFrom(_ ref: String?, _ marker: String) -> String? {
        guard let ref, let range = ref.range(of: marker) else { return nil }
        let id = ref[range.upperBound...].prefix { $0.isNumber }
        return id.isEmpty ? nil : String(id)
    }

    /// "2026-10-27T00:19:09Z". (Formatters are costly to make: one, reused.)
    private static func parseDate(_ s: String) -> Date? { wallclock.date(from: s) }

    nonisolated(unsafe) private static let wallclock = ISO8601DateFormatter()
}
