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
// ESPN writes the text two ways: the NFL's gamebook ("(Shotgun) P.Mahomes pass
// short left to C.Allen to SEA 49 for 18 yards (T.Okada).") and college's
// ("(14:31) Shotgun #4 D.Hill rush middle for 2 yards gain to the ALA43 (#10
// M.Jones)"), each read in its own grammar.

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
        /// A defensive back ESPN doesn't call a corner or a safety: most
        /// college credits, and the nickel back.
        case defensiveBack
        case kicker, punter, snapper

        var defense: Bool { [.defensiveLine, .linebacker, .corner, .safety, .defensiveBack].contains(self) }

        /// ESPN's position IDs ("…/positions/8"), as its `/positions/{id}`
        /// names them. Plays credit groups: WR 1, C 4, TE 7, QB 8, RB 9, FB 10,
        /// PK 22, P 23, CB 29, LB 30, DE 31, DT 32, DB 35, S 36, DL 37, OL 45,
        /// OT 46, G 73, LS 78. Depth charts use slots: LT 2, LG 3, RG 5, RT 6,
        /// LDE 11, NT 12, RDE 13, LOLB 14, LILB 15, RILB 16, ROLB 17, LCB 18,
        /// RCB 19, SS 20, FS 21, LDT 24, RDT 25, WLB 26, MLB 27, SLB 28, UT 33,
        /// NB 34, LS 39, OG 47, T 74, NG 75.
        init?(espn id: Int) {
            switch id {
            case 8: self = .quarterback
            case 9: self = .back
            case 10: self = .fullback
            case 1: self = .receiver
            case 7: self = .tightEnd
            case 2...6, 45...47, 73, 74: self = .lineman
            case 11...13, 24, 25, 31...33, 37, 75: self = .defensiveLine
            case 14...17, 26...28, 30: self = .linebacker
            case 18, 19, 29: self = .corner
            case 20, 21, 36: self = .safety
            case 34, 35: self = .defensiveBack
            case 22: self = .kicker
            case 23: self = .punter
            case 39, 78: self = .snapper
            default: return nil
            }
        }
    }

    /// Someone in on the play: their part ("rusher", "tackler", "sackedBy"),
    /// athlete ID and position; the name and shirt the text gives ("#3
    /// M.Ratcliffe"), and the depth-chart slot he starts in ("lde", "rcb"),
    /// once the feed has the chart.
    struct Participant: Equatable {
        var role: String
        var id: String?
        var position: Position?
        var name: String? = nil
        var jersey: String? = nil
        var slot: String? = nil
    }

    /// The rush getting home as the quarterback threw: a hit (the NFL credits
    /// the hitter as `other`, in [brackets] in the text) or a hurry (college's
    /// "QB hurried by").
    struct Pressure: Equatable {
        var by: [Participant]
        var hit: Bool
    }

    /// A flag on the play, every one the text names (ESPN's `penalty` object
    /// holds only the main one): the foul, who, the yards, where they were
    /// walked from and to, whether it counted, and when it happened.
    struct Flag: Equatable {
        enum Status: Equatable { case accepted, declined, offsetting }
        /// Before the snap (the ball never snapped: a false start, a delay),
        /// during the play, or after the whistle (unsportsmanlike conduct,
        /// unnecessary roughness, enforced between downs).
        enum Timing: Equatable { case beforeSnap, duringPlay, afterPlay }
        /// "Offensive Holding".
        var name: String
        /// ESPN's ("offensive-holding"); nil where only the text names it (college).
        var slug: String?
        var status: Status
        var timing: Timing
        /// The team flagged.
        var side: GameDetail.Side?
        /// Who was flagged (the `penalized` participant), when the flag names someone.
        var player: Participant?
        var yards: Int?
        /// Where it was enforced from ("enforced at SEA 46", college's "from
        /// TAM14") and where that put the ball (college's "to TAM29"; else the
        /// yards walked off).
        var from: Double?
        var to: Double?
        var noPlay = false
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
    /// Where the ball was put on the ground or popped loose (a fumble, lost or not).
    var loose: Double?
    /// Where a fumble was recovered, by either side (a lost one's is also `turn`).
    var recovered: Double?
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
    /// The flag whose yards were walked off (declined ones aren't).
    var penalty: Penalty?
    /// Every flag on the play, in the order thrown, declined and offsetting ones too.
    var flags: [Flag] = []
    /// Who got to the quarterback as he threw.
    var pressure: Pressure?
    /// Who knocked the ball loose (`forcedBy`).
    var stripper: Participant?
    /// Who sacked him: two on a split sack.
    var sackers: [Participant] = []
    /// Who blocked the kick (the `other` credited on a blocked one).
    var blocker: Participant?
    /// The defense's base front, from its depth chart (NFL; once the feed has it).
    var front: FootballDepthChart.Front?
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
    /// Both teams' depth charts (NFL), once fetched: who starts where.
    var charts: [GameDetail.Side: FootballDepthChart] = [:]
}

/// A team's NFL depth chart (ESPN core `seasons/{year}/teams/{id}/depthcharts`):
/// each slot's players, the starter first, and the defense's base front. It
/// makes each credited man a specific player on a specific side, not "the
/// nearest linebacker". College has none (ESPN answers 400).
struct FootballDepthChart: Equatable {
    /// A base 4-3 (four down linemen, three backers) or 3-4 (a nose tackle
    /// and two ends, four backers).
    enum Front: Equatable { case fourThree, threeFour }

    struct Slot: Equatable {
        /// ESPN's key: "lde", "nt", "lilb", "rcb", "ss", "lt", "wr", "pk".
        var key: String
        /// Athlete IDs by rank, the starter first.
        var athletes: [String]
        var defense: Bool
        var position: FootballScene.Position?

        /// Which side he lines up on in the offense's frame, the one the
        /// theater stands in (behind the offense): the offense's left tackle
        /// on its left, the defense's left end (or corner) on the offense's right.
        var lane: FootballScene.Lane? {
            guard let first = key.first, first == "l" || first == "r", key != "ls" else { return nil }
            return (first == "l") != defense ? .left : .right
        }
    }

    var front: Front?
    var slots: [Slot]

    /// The slot an athlete starts in: where he ranks highest.
    func slot(of athlete: String) -> Slot? {
        slots.lazy.compactMap { slot in slot.athletes.firstIndex(of: athlete).map { (slot, $0) } }.min { $0.1 < $1.1 }?.0
    }

    /// The core response: offense ("3WR 1TE"), defense ("Base 4-3 D", "Base
    /// 3-4 D") and special teams, each a map of slots to ranked athletes.
    init?(_ json: JSON) {
        var slots: [Slot] = []
        var front: Front?
        for group in json["items"].array {
            let name = group["name"].string ?? ""
            let defense = name.contains(" D") || name.lowercased().contains("defense")
            if defense { front = name.contains("3-4") ? .threeFour : name.contains("4-3") ? .fourThree : front }
            guard let positions = group["positions"].raw as? NSDictionary else { continue }
            for case let (key as String, value) in positions {
                let entry = JSON(value)
                let ranked = entry["athletes"].array.sorted { ($0["rank"].int ?? 99) < ($1["rank"].int ?? 99) }
                let athletes = ranked.compactMap { a in a["athlete"]["$ref"].string.flatMap { FootballScene.athleteID($0) } }
                slots.append(Slot(key: key, athletes: athletes, defense: defense,
                                  position: entry["position"]["id"].int.flatMap { FootballScene.Position(espn: $0) }))
            }
        }
        guard !slots.isEmpty else { return nil }
        self.front = front
        // Dictionary order isn't stable: by key, so two loads compare equal.
        self.slots = slots.sorted { ($0.defense ? 0 : 1, $0.key) < ($1.defense ? 0 : 1, $1.key) }
    }
}

extension FootballScene {
    /// The scene with its credited men placed on the depth charts (the slot
    /// each starts in) and the defense's base front. (pure; tested)
    func slotted(by charts: [GameDetail.Side: FootballDepthChart]) -> FootballScene {
        guard !charts.isEmpty else { return self }
        var scene = self
        func place(_ p: Participant) -> Participant {
            var placed = p
            placed.slot = p.id.flatMap { id in charts.values.lazy.compactMap { $0.slot(of: id)?.key }.first } ?? p.slot
            return placed
        }
        scene.participants = participants.map(place)
        scene.pressure?.by = pressure?.by.map(place) ?? []
        scene.stripper = stripper.map(place)
        scene.sackers = sackers.map(place)
        scene.blocker = blocker.map(place)
        scene.flags = flags.map { flag in
            var placed = flag
            placed.player = flag.player.map(place)
            return placed
        }
        if let defense { scene.front = charts[defense]?.front ?? front }
        return scene
    }
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
        let ruling = Self.ruling(text)
        let college = isCollege(text)
        let kicking = type.contains("kickoff") || type.contains("punt")
        // The team that snapped or kicked: the start's (the play's own team is the receiving one on a kick or a return).
        let startTeam = idFrom(item["start"]["team"]["$ref"].string, "/teams/")
        let offense = teams.side(startTeam ?? (kicking ? nil : idFrom(item["team"]["$ref"].string, "/teams/")))
        guard let offense else { return nil }
        let home = (offense == .top) == teams.topIsHome
        func yard(_ line: Double) -> Double { home ? line : 100 - line }
        // A spot in the text ("SEA 49", "KC -9" in the end zone, college's "ALA43"), at the end its letters name.
        let ends = Self.ends(in: text, teams: teams, lines: [fromLine, toLine])
        func spot(_ token: Substring?) -> Double? {
            guard let token else { return nil }
            if token == "50" { return 50 }
            guard let m = token.wholeMatch(of: #/([A-Za-z&]{2,12}) ?(-?\d{1,2})/#), let n = Double(m.2),
                  let homeEnd = ends[String(m.1)] else { return nil }
            return yard(homeEnd ? n : 100 - n)
        }
        // The team a flag's letters name ("KC" in "PENALTY on KC-T.Kelce", college's "ALA").
        func team(_ letters: Substring) -> GameDetail.Side? {
            (teams.isHome(String(letters)) ?? ends[String(letters)]).map { homeEnd -> GameDetail.Side in homeEnd == teams.topIsHome ? .top : .bottom }
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
            // Recovered by its own side: the run, sack or catch it was.
            scene.kind = play.contains("sacked") ? .sack : play.contains(" pass ") ? .pass : .rush
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
        scene.flags = flags(ruling, college: college, played: !play.isEmpty, main: item["penalty"],
                            penalized: scene.participants.filter { $0.role == "penalized" }, offense: offense, team: team, spot: spot)
        let flag = item["penalty"]
        if flag.exists, flag["status"]["slug"].string != "declined" {
            scene.penalty = Penalty(name: flag["type"]["text"].string, yards: flag["yards"].int ?? abs(scene.yards),
                                    noPlay: text.contains("No Play"))
        } else if scene.kind == .penalty || college, let walked = scene.flags.first(where: { $0.status == .accepted }) {
            // No object (college never has one): the flag that counted, as the text has it.
            scene.penalty = Penalty(name: walked.name, yards: walked.yards ?? abs(scene.yards), noPlay: walked.noPlay)
        } else if scene.kind == .penalty {
            scene.penalty = Penalty(name: nil, yards: abs(scene.yards), noPlay: text.range(of: "no play", options: .caseInsensitive) != nil)
        }
        scene.names = college ? collegeNames(play) : names(play)

        // What only the text says.
        let lower = play.lowercased()
        scene.shotgun = text.contains("Shotgun")
        scene.formation = formation(text, kind: scene.kind)
        scene.outOfBounds = lower.contains(" ob ") || lower.contains(" ob at") || lower.contains("out of bounds")
        if college { readCollege(&scene, play: play, spot: spot) } else { readGamebook(&scene, item: item, play: play, spot: spot) }
        credit(&scene, play: play, college: college)
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

    /// What the NFL's gamebook text says: the depth and side, the hole, where
    /// he was stopped, where a pass was picked off, where a kick came down,
    /// where a fumble came loose and who fell on it.
    private static func readGamebook(_ scene: inout FootballScene, item: JSON, play: String, spot: (Substring?) -> Double?) {
        let lower = play.lowercased()
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
        scene.stopped = play.firstMatch(of: #/(?:to|at) ([A-Z]{2,4} -?\d{1,2}|50) for (?:-?\d+ yards?|no gain)/#).flatMap { spot($0.1) }
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
            // The pick, past whoever hit the passer or broke it up: "INTERCEPTED by T.Okada [N.Emmanwori]
            // at SEA 34", "by T.Smith (K.Scott) at CAR 32"; in the end zone, "at KC -9".
            scene.turn = play.firstMatch(of: #/INTERCEPTED by [^\[(]+?(?: \[[^\]]*\]| \([^)]*\))* at ([A-Z]{2,4} -?\d{1,2}|50)/#)
                .flatMap { spot($0.1) }
            if let turn = scene.turn { scene.air = turn - scene.from }
            scene.stopped = nil
        case .sack:
            scene.stopped = play.firstMatch(of: #/sacked (?:ob )?at ([A-Z]{2,4} -?\d{1,2}|50)/#).flatMap { spot($0.1) }
        case .kickoff, .punt:
            let landing = play.firstMatch(of: #/(?:kicks|punts) (\d+) yards?(?: from [A-Z]{2,4} \d{1,2}| from 50)? to (?:the )?([A-Z]{2,4} -?\d{1,2}|50|end zone)/#)
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
            scene.stopped = play.firstMatch(of: #/(?:to|at) ([A-Z]{2,4} -?\d{1,2}|50) for (?:-?\d+ yards?|no gain)/#).flatMap { spot($0.1) }
                ?? ([.downed, .fairCatch, .outOfBounds].contains(scene.kick) ? scene.turn : nil)
        case .fieldGoal, .extraPoint:
            scene.kickYards = lower.firstMatch(of: #/(\d+) yard field goal/#).flatMap { Int($0.1) }
            miss(&scene, lower: lower)
        default:
            break
        }
        // A fumble, lost or kept: where it came loose ("FUMBLES (Aborted) at DET 41"; else where he was,
        // the sack's or the run's spot; else where the ball was first touched) and where it was recovered
        // ("RECOVERED by TB-C.Kancey at CAR 32", "recovered by KC-P.Mahomes at KC 49", "and recovers at SEA 32").
        if let fumbles = play.range(of: "FUMBLES") {
            let carrier = play[..<fumbles.lowerBound].matches(of: #/(?:to|at) ([A-Z]{2,4} -?\d{1,2}|50)\b/#).last.flatMap { spot($0.1) }
            let after = play[fumbles.lowerBound...]
            scene.loose = after.firstMatch(of: #/^FUMBLES(?: \([^)]*\))* at ([A-Z]{2,4} -?\d{1,2}|50)/#).flatMap { spot($0.1) } ?? carrier
                ?? after.firstMatch(of: #/touched at ([A-Z]{2,4} -?\d{1,2}|50)/#).flatMap { spot($0.1) }
            if let m = after.firstMatch(of: #/(?i:recovered by) .+? at ([A-Z]{2,4} -?\d{1,2}|50)|and recovers at ([A-Z]{2,4} -?\d{1,2}|50)/#) {
                scene.recovered = spot(m.1 ?? m.2)
            }
            if scene.kind == .fumble { scene.turn = scene.recovered ?? scene.loose }
        }
    }

    /// What college's text says ("(11:05) Shotgun #12 K.Russell pass
    /// complete short left to #7 R.Scott caught at TAM24, for 17 yards to the
    /// TAM24"), richer than the NFL's on a pass: where it was caught, or
    /// where an incompletion was thrown to.
    private static func readCollege(_ scene: inout FootballScene, play: String, spot: (Substring?) -> Double?) {
        let lower = play.lowercased()
        if let m = lower.firstMatch(of: #/pass (?:complete|incomplete)(?: (short|deep))?(?: (left|middle|right))?/#) {
            scene.depth = m.1.map { $0 == "deep" ? Depth.deep : .short }
            scene.lane = m.2.map { lane($0) }
        } else if let m = lower.firstMatch(of: #/rush (left|middle|right)/#) {
            // A run's direction only (no gap): left or right is off tackle.
            scene.lane = lane(m.1)
            scene.gap = m.1 == "middle" ? .middle : .tackle
        }
        // Where he was stopped: "for 2 yards gain to the ALA43", "sacked for loss of 7 yards to the TAM25",
        // "Kneel down by #10 M.Reed at TAM09".
        scene.stopped = play.firstMatch(of: #/for (?:no gain|(?:loss of )?\d+ yards?(?: gain| loss)?) to the ([A-Za-z&]{2,12}\d{1,2})|Kneel down by .+? at ([A-Za-z&]{2,12}\d{1,2})/#)
            .flatMap { spot($0.1 ?? $0.2) }
        switch scene.kind {
        case .pass, .incomplete:
            // Exactly where it was caught, or thrown to.
            let point = play.firstMatch(of: #/(?:caught at|thrown to) ([A-Za-z&]{2,12}\d{1,2})/#).flatMap { spot($0.1) }
            if let point {
                scene.air = point - scene.from
            } else if let depth = scene.depth {
                scene.air = scene.kind == .pass ? Double(min(scene.yards, depth == .deep ? max(scene.yards - 4, 20) : 7))
                    : depth == .deep ? 24 : 7
            }
        case .interception:
            scene.turn = play.firstMatch(of: #/intercepted by #\d+ .+? at ([A-Za-z&]{2,12}\d{1,2})/#).flatMap { spot($0.1) }
            if let turn = scene.turn { scene.air = turn - scene.from }
            scene.stopped = nil
        case .kickoff, .punt:
            // "kickoff 41 yards to the ALA24 #81 K.Edwards return 9 yards to the ALA33", "punt 42 yards to
            // the Akron09 fair catch by #13 S.Patrick at Akron09", "punt 46 yards to the TAM00, Touchback".
            let landing = play.firstMatch(of: #/(?:kickoff|punt) (\d+) yards? to the ([A-Za-z&]{2,12}\d{1,2})/#)
            scene.kickYards = landing.flatMap { Int($0.1) }
            scene.turn = landing.flatMap { spot($0.2) }
            if scene.turn == nil, let yards = scene.kickYards { scene.turn = scene.from + Double(yards) }
            let returned = play.firstMatch(of: #/return -?\d+ yards? to the ([A-Za-z&]{2,12}\d{1,2})/#)
            scene.kick = lower.contains("touchback") ? .touchback
                : lower.contains("fair catch") ? .fairCatch
                : returned != nil || lower.contains("muffed") ? .returned
                : lower.contains("out of bounds") ? .outOfBounds
                : .downed
            // Into the end zone: the NFL's spot for it.
            if scene.kick == .touchback, let landed = scene.turn, landed >= 99.5 { scene.turn = 105 }
            scene.stopped = returned.flatMap { spot($0.1) }
                ?? play.firstMatch(of: #/recovered by \S+ #\d+ .+? at ([A-Za-z&]{2,12}\d{1,2})/#).flatMap { spot($0.1) }
                ?? ([.downed, .fairCatch, .outOfBounds].contains(scene.kick) ? scene.turn : nil)
        case .fieldGoal, .extraPoint:
            scene.kickYards = lower.firstMatch(of: #/field goal attempt from (\d+) yards?/#).flatMap { Int($0.1) }
            miss(&scene, lower: lower)
        default:
            break
        }
        // A fumble: "fumbled by #10 M.Reed at TAM18 forced by #90 L.Simmons recovered by TAM #4 R.Owens II
        // at TAM22"; with no spot of its own ("fumble by #12 D.DeShields recovered by …"), where he was.
        if let fumbled = play.range(of: "fumble", options: .caseInsensitive) {
            let carrier = play[..<fumbled.lowerBound].matches(of: #/to the ([A-Za-z&]{2,12}\d{1,2})/#).last.flatMap { spot($0.1) }
            scene.loose = play.firstMatch(of: #/fumbled by #\d+ .+? at ([A-Za-z&]{2,12}\d{1,2})/#).flatMap { spot($0.1) } ?? carrier
            scene.recovered = play.firstMatch(of: #/recovered by \S+ #\d+ .+? at ([A-Za-z&]{2,12}\d{1,2})/#).flatMap { spot($0.1) }
            if scene.kind == .fumble { scene.turn = scene.recovered ?? scene.loose }
        }
    }

    /// A missed kick's way: blocked, wide left or right, short.
    private static func miss(_ scene: inout FootballScene, lower: String) {
        if case .fieldGoal(false) = scene.kind {
            scene.miss = lower.contains("blocked") ? .blocked : lower.contains("wide right") ? .wideRight
                : lower.contains("wide left") ? .wideLeft : lower.contains("short") ? .short : .wideRight
        } else if case .extraPoint(false) = scene.kind {
            scene.miss = lower.contains("blocked") ? .blocked : lower.contains("wide left") ? .wideLeft : .wideRight
        }
    }

    /// Who did what beyond the carrier and the tacklers, from the credits
    /// (with the text's names where it gives them): who hit or hurried the
    /// passer, who knocked the ball out, who sacked him, who blocked the kick.
    private static func credit(_ scene: inout FootballScene, play: String, college: Bool) {
        func named(_ role: String, _ names: [(name: String, jersey: String?)]) -> [Participant] {
            var credited = scene.participants.filter { $0.role == role }
            // Names in the text's order go to the credits in theirs; a name with no credit stands alone.
            for (i, n) in names.enumerated() {
                if i < credited.count { (credited[i].name, credited[i].jersey) = (n.name, n.jersey) }
                else { credited.append(Participant(role: role, id: nil, position: nil, name: n.name, jersey: n.jersey)) }
            }
            return credited
        }
        switch scene.kind {
        case .pass, .incomplete, .interception, .spike:
            if college, let m = play.firstMatch(of: #/QB hurried by (#\d+ .+?)(?=,| TOUCHDOWN|$| (?!and #)[a-z(])/#) {
                scene.pressure = Pressure(by: named("hurriedBy", people(m.1)), hit: false)
            } else if !college {
                // A hit on the passer is in [brackets] ("… to X.Worthy [D.Hall].") and credited to a defender
                // as `other`. An `other` with no bracket isn't one: its per-play stats show a second
                // tackler, or nothing. The credit goes with the name when there's one of each.
                let bracketed = play.matches(of: #/\[([^\]]+)\]/#).map { shortName($0.1) }
                let credited = scene.participants.filter { $0.role == "other" && $0.position?.defense == true }
                let by = bracketed.enumerated().map { i, name in
                    var hitter = credited.count == bracketed.count ? credited[i] : Participant(role: "other", id: nil, position: nil)
                    hitter.name = name
                    return hitter
                }
                if !by.isEmpty { scene.pressure = Pressure(by: by, hit: true) }
            }
            if college, let m = play.firstMatch(of: #/broken up by #(\d+) (\S+(?: (?:Jr\.|Sr\.|III|II|IV))?)/#) {
                if let i = scene.participants.firstIndex(where: { $0.role == "passDefender" }) {
                    (scene.participants[i].name, scene.participants[i].jersey) = (shortName(m.2), String(m.1))
                } else {
                    scene.participants.append(Participant(role: "passDefender", id: nil, position: nil, name: shortName(m.2), jersey: String(m.1)))
                }
            }
        case .fieldGoal(false), .extraPoint(false), .punt:
            guard scene.miss == .blocked || play.lowercased().contains("blocked") else { break }
            let named = play.firstMatch(of: #/BLOCKED \(([^)]+)\)|blocked by (#\d+ [^ ,.]+)/#).flatMap { people($0.1 ?? $0.2 ?? "").first }
            if var blocker = scene.participants.first(where: { $0.role == "other" }) ?? named.map({ _ in Participant(role: "other", id: nil, position: nil) }) {
                if let named { (blocker.name, blocker.jersey) = (named.name, named.jersey) }
                scene.blocker = blocker
            }
        default:
            break
        }
        // The sack: "(sack split by D.Alexander and A.Reese)", "sacked at CAR 31 for -9 yards (A.Muhammad)",
        // college's "sacked for loss of 5 yards to the TAM15 (#3 M.Ratcliffe, #10 M.Jones)".
        if let sacked = play.range(of: "sacked") {
            let after = play[sacked.upperBound...]
            let names = after.firstMatch(of: #/sack split by ([^)]+)\)/#).map { people($0.1) }
                ?? after.firstMatch(of: #/^[^(.]*?\(([^)]+)\)/#).map { people($0.1) } ?? []
            scene.sackers = named("sackedBy", names)
        }
        // Who knocked it out: "FUMBLES (A.Muhammad)", "forced by #90 L.Simmons".
        let stripped = play.firstMatch(of: #/FUMBLES \((?!Aborted)([^)]+)\)|forced by (#\d+ \S+(?: (?:Jr\.|Sr\.|III|II|IV))?)/#)
            .flatMap { people($0.1 ?? $0.2 ?? "").first }
        if var stripper = scene.participants.first(where: { $0.role == "forcedBy" }) ?? stripped.map({ _ in Participant(role: "forcedBy", id: nil, position: nil) }) {
            if let stripped { (stripper.name, stripper.jersey) = (stripped.name, stripped.jersey) }
            scene.stripper = stripper
        }
    }

    /// People as the text lists them: "D.Alexander and A.Reese", college's
    /// "#3 M.Ratcliffe, #10 M.Jones", "#7 C.Woodson; #6 R.Morgan" (short names).
    static func people(_ list: some StringProtocol) -> [(name: String, jersey: String?)] {
        String(list).split(separator: #/, | and |; /#).compactMap { part in
            let s = part.trimmingCharacters(in: .whitespaces)
            if let m = s.wholeMatch(of: #/#(\d+) (.+)/#) { return (shortName(m.2), String(m.1)) }
            return s.isEmpty ? nil : (shortName(s[...]), nil)
        }
    }

    /// "Barkley" from "S.Barkley", "Lee Jr." from "D.Lee Jr.".
    static func shortName(_ s: some StringProtocol) -> String {
        String(s.split(separator: ".", maxSplits: 1).last ?? s[...]).trimmingCharacters(in: .whitespaces)
    }

    // MARK: Flags

    /// Every flag the text names, in order; the one ESPN's `penalty` object
    /// describes gets its slug, yards and status from it. The NFL: "PENALTY
    /// on KC-T.Kelce, Illegal Shift, 5 yards, enforced at SEA 46 - No Play.",
    /// "Penalty on GB-K.Brooks, Defensive Offside, declined.", "…, offsetting,
    /// enforced at SEA 30 - No Play.". College: "PENALTY ALA Targeting (#6
    /// R.Morgan) 15 yards from ALA29 to ALA14, 1ST DOWN. NO PLAY", "PENALTY ALA
    /// Offside declined", "PENALTY Kent UNS: Unsportsmanlike Conduct offsetting
    /// Akron UNS: Unsportsmanlike Conduct offsetting". (pure; tested)
    static func flags(_ text: String, college: Bool, played: Bool, main: JSON, penalized: [Participant], offense: GameDetail.Side,
                      team: (Substring) -> GameDetail.Side?, spot: (Substring?) -> Double?) -> [Flag] {
        let marks = college ? text.ranges(of: "PENALTY ") : text.ranges(of: #/(?:PENALTY|Penalty) on /#)
        var clauses: [Substring] = []
        for (i, mark) in marks.enumerated() {
            let clause = text[mark.upperBound..<(i + 1 < marks.count ? marks[i + 1].lowerBound : text.endIndex)]
            // College runs two offsetting fouls into one: "Kent UNS: … offsetting Akron UNS: … offsetting".
            if college, clause.contains(" offsetting") {
                clauses += clause.components(separatedBy: "offsetting").map { $0.trimmingCharacters(in: .whitespaces) }
                    .filter { $0.first?.isLetter == true }.map { ($0 + " offsetting")[...] }
            } else {
                clauses.append(clause)
            }
        }
        var flags: [Flag] = []
        for clause in clauses {
            var flag: Flag
            var player: (name: String, jersey: String?)?
            if college {
                guard let m = clause.firstMatch(of: #/^([A-Za-z&]+) (?:[A-Z]{2,4}: )?(.+?)(?= \(#\d| declined| offsetting| \d+ yards? from|[.,]|$)/#)
                else { continue }
                flag = Flag(name: String(m.2), status: .accepted, timing: .duringPlay, side: team(m.1))
                if let p = clause.firstMatch(of: #/\((#\d+ [^)]+)\)/#) { player = people(p.1).first }
                if let walk = clause.firstMatch(of: #/(\d+) yards? from ([A-Za-z&]{2,12}\d{1,2}) to ([A-Za-z&]{2,12}\d{1,2})/#) {
                    (flag.yards, flag.from, flag.to) = (Int(walk.1), spot(walk.2), spot(walk.3))
                }
                flag.noPlay = clause.contains("NO PLAY")
            } else {
                guard let m = clause.firstMatch(of: #/^([A-Z]{2,4})(?:-([^,]+))?, ([^,]+), ?(.*)/#) else { continue }
                flag = Flag(name: String(m.3), status: .accepted, timing: .duringPlay, side: team(m.1))
                player = m.2.map { (shortName($0), nil) }
                flag.yards = m.4.firstMatch(of: #/^(\d+) yards?/#).flatMap { Int($0.1) }
                flag.from = m.4.firstMatch(of: #/enforced at ([A-Z]{2,4} -?\d{1,2}|50)/#).flatMap { spot($0.1) }
                flag.noPlay = m.4.contains("No Play")
            }
            let rest = clause.lowercased()
            flag.status = rest.contains("declined") ? .declined : rest.contains("offsetting") ? .offsetting : .accepted
            // The main flag, as ESPN's object describes it.
            if main.exists, main["type"]["text"].string?.lowercased() == flag.name.lowercased(), !flags.contains(where: { $0.slug != nil }) {
                flag.slug = main["type"]["slug"].string
                flag.yards = flag.yards ?? main["yards"].int
                switch main["status"]["slug"].string {
                case "declined"?: flag.status = .declined
                case "offsetting"?: flag.status = .offsetting
                default: break
                }
            }
            flag.timing = timing(flag, played: played, between: rest.contains("between downs"))
            if flag.to == nil, flag.status == .accepted, let from = flag.from, let yards = flag.yards, let side = flag.side {
                flag.to = side == offense ? from - Double(yards) : from + Double(yards)
            }
            if let player { flag.player = Participant(role: "penalized", id: nil, position: nil, name: player.name, jersey: player.jersey) }
            // College repeats a flag (once with the yards, once without): one flag, all it says.
            if let i = flags.firstIndex(where: { $0.name == flag.name && $0.side == flag.side && $0.player?.name == flag.player?.name }) {
                flags[i].yards = flags[i].yards ?? flag.yards
                flags[i].from = flags[i].from ?? flag.from
                flags[i].to = flags[i].to ?? flag.to
                flags[i].noPlay = flags[i].noPlay || flag.noPlay
                continue
            }
            flags.append(flag)
        }
        // The credited fouler (`penalized`, with his ID and position) to the flags that name one, those that counted first.
        var credits = penalized[...]
        for i in flags.indices.sorted(by: { (flags[$0].status == .declined ? 1 : 0) < (flags[$1].status == .declined ? 1 : 0) })
            where flags[i].player != nil && !credits.isEmpty {
            var credit = credits.removeFirst()
            (credit.name, credit.jersey) = (flags[i].player?.name, flags[i].player?.jersey)
            flags[i].player = credit
        }
        return flags
    }

    /// When a foul happened: before the snap when no play ran, or for a
    /// dead-ball foul (a false start, encroachment, a neutral zone
    /// infraction, a delay of game: college logs the play it stopped anyway);
    /// after the whistle for unsportsmanlike conduct, taunting, unnecessary
    /// roughness and personal fouls, or one enforced between downs; otherwise
    /// during the play.
    static func timing(_ flag: Flag, played: Bool, between: Bool) -> Flag.Timing {
        let key = flag.slug ?? flag.name.lowercased().replacingOccurrences(of: " ", with: "-")
        let early = ["false-start", "encroachment", "neutral-zone", "delay-of-game"]
        let late = ["unsportsmanlike", "taunting", "unnecessary-roughness", "personal-foul"]
        if !played || early.contains(where: { key.contains($0) }) { return .beforeSnap }
        return between || late.contains { key.contains($0) } ? .afterPlay : .duringPlay
    }

    // MARK: Text

    /// Which end each spot's letters in the text name, home (true) or away:
    /// the team's own letters (`Teams.isHome`), else by elimination: the
    /// other team's, when the rest of the play's spots name one; or the end
    /// that puts the spot nearest ESPN's own yard lines. (pure; tested)
    static func ends(in text: String, teams: FootballFeed.Teams, lines: [Double]) -> [String: Bool] {
        var ends: [String: Bool] = [:]
        var unknown: [String: Double] = [:]
        for m in text.matches(of: #/\b(?:to|at|from)(?: the)? ([A-Za-z&]{2,12}) ?(-?\d{1,2})\b/#) {
            let letters = String(m.1)
            if let home = teams.isHome(letters) { ends[letters] = home } else if unknown[letters] == nil { unknown[letters] = Double(m.2) }
        }
        guard unknown.count == 1, let first = unknown.first else { return ends }
        let (letters, n) = (first.key, first.value)
        if Set(ends.values).count == 1, let known = ends.values.first {
            ends[letters] = !known
        } else if ends.isEmpty, n != 50, !lines.isEmpty {
            let home = lines.map { abs($0 - n) }.min() ?? 0, away = lines.map { abs($0 - (100 - n)) }.min() ?? 0
            if home != away { ends[letters] = home < away }
        }
        return ends
    }

    /// College's text: a shirt number on every name ("#4 D.Hill"), spots
    /// written without a space ("to the ALA43"; the NFL's "to SEA 49").
    static func isCollege(_ text: String) -> Bool {
        text.firstMatch(of: #/#\d{1,2} [A-Z][A-Za-z'\-]*\.|\b(?:to|at|from)(?: the)? [A-Za-z&]{2,12}\d{2}\b/#) != nil
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
            return play.contains("kneels") || play.contains("takes a knee") || play.contains("kneel down") ? .kneel : .rush
        }
        if type.contains("safety") { return play.contains("sacked") ? .sack : .rush }
        return .other
    }

    private static func lane(_ word: Substring) -> Lane { word == "left" ? .left : word == "right" ? .right : .middle }

    /// The play as it stood: after a review's reversal (college puts the
    /// ruling first, the review after it), before a penalty, without the
    /// clock, the formation or a lineman reporting in.
    static func playText(_ text: String) -> String {
        var play = ruling(text)
        if let flag = play.firstRange(of: #/PENALTY|Penalty on /#) { play = String(play[..<flag.lowerBound]) }
        play = play.replacing(#/\((?:\d+:\d+|[^)]*(?:Shotgun|Huddle|formation)[^)]*)\)/#, with: "")
        play = play.replacing(#/[A-Z]\.[\w'\-]+ reported in as eligible\.?/#, with: "")
        // College's set, unbracketed: "No Huddle-Shotgun #10 M.Reed …".
        play = play.replacing(#/^\s*(?:No Huddle-?)?(?:Shotgun)?\s*(?=#\d)/#, with: "")
        return play.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The ruling that stood: the NFL's after a reversal ("… the play was
    /// REVERSED.W.Marks left tackle …"), college's before its review ("… The
    /// previous play is under automatic review … (Original Play: …)").
    static func ruling(_ text: String) -> String {
        var ruling = text[...]
        if let reversed = ruling.range(of: "REVERSED.", options: .backwards) { ruling = ruling[reversed.upperBound...] }
        if let review = ruling.range(of: "The previous play is under") { ruling = ruling[..<review.lowerBound] }
        return String(ruling)
    }

    /// Short names by part: who ran, threw, caught, kicked, made the stop.
    static func names(_ play: String) -> [String: String] {
        var out: [String: String] = [:]
        if let m = play.firstMatch(of: #/^([A-Z][A-Za-z]{0,2}\.\s?[A-Z][A-Za-z'\-]+)/#) { out["lead"] = shortName(m.1) }
        if let m = play.firstMatch(of: #/(?:to|for) ([A-Z][A-Za-z]{0,2}\.\s?[A-Z][A-Za-z'\-]+)/#) { out["target"] = shortName(m.1) }
        if let m = play.firstMatch(of: #/\(([A-Z][A-Za-z]{0,2}\.\s?[A-Z][A-Za-z'\-]+)/#) { out["stop"] = shortName(m.1) }
        if let m = play.firstMatch(of: #/(?:INTERCEPTED|RECOVERED) by (?:[A-Z]{2,4}-)?([A-Z][A-Za-z]{0,2}\.\s?[A-Z][A-Za-z'\-]+)/#) {
            out["taker"] = shortName(m.1)
        }
        if let m = play.firstMatch(of: #/\. ([A-Z][A-Za-z]{0,2}\.\s?[A-Z][A-Za-z'\-]+) (?:to|for|pushed|ran|MUFFS|fair)/#) { out["returner"] = shortName(m.1) }
        return out
    }

    /// The same parts in college's words: "#12 K.Russell pass complete … to
    /// #7 R.Scott … (#5 D.Lee Jr.)", "intercepted by #5 D.Lee Jr.",
    /// "recovered by ALA #36 Q.Reese", "#81 K.Edwards return 9 yards".
    static func collegeNames(_ play: String) -> [String: String] {
        var out: [String: String] = [:]
        if let m = play.firstMatch(of: #/^(?:Kneel down by )?#\d+ ([A-Z][A-Za-z'\-]*\.\s?[A-Z][A-Za-z'\-]+(?: (?:Jr\.|Sr\.|III|II|IV))?)/#) { out["lead"] = shortName(m.1) }
        if let m = play.firstMatch(of: #/ to #\d+ ([A-Z][A-Za-z'\-]*\.\s?[A-Z][A-Za-z'\-]+(?: (?:Jr\.|Sr\.|III|II|IV))?)/#) { out["target"] = shortName(m.1) }
        if let m = play.firstMatch(of: #/\(#\d+ ([A-Z][A-Za-z'\-]*\.\s?[A-Z][A-Za-z'\-]+(?: (?:Jr\.|Sr\.|III|II|IV))?)/#) { out["stop"] = shortName(m.1) }
        if let m = play.firstMatch(of: #/(?:intercepted|recovered) by (?:\S+ )?#\d+ ([A-Z][A-Za-z'\-]*\.\s?[A-Z][A-Za-z'\-]+(?: (?:Jr\.|Sr\.|III|II|IV))?)/#) {
            out["taker"] = shortName(m.1)
        }
        if let m = play.firstMatch(of: #/#\d+ ([A-Z][A-Za-z'\-]*\.\s?[A-Z][A-Za-z'\-]+(?: (?:Jr\.|Sr\.|III|II|IV))?) return|(?:fair catch|muffed) by #\d+ ([A-Z][A-Za-z'\-]*\.\s?[A-Z][A-Za-z'\-]+)/#) {
            out["returner"] = shortName(m.1 ?? m.2 ?? "")
        }
        return out
    }

    /// "…/athletes/3139477?lang=en" → "3139477".
    static func athleteID(_ ref: String) -> String? { idFrom(ref, "/athletes/") }

    private static func idFrom(_ ref: String?, _ marker: String) -> String? {
        guard let ref, let range = ref.range(of: marker) else { return nil }
        let id = ref[range.upperBound...].prefix { $0.isNumber }
        return id.isEmpty ? nil : String(id)
    }

    /// "2026-10-27T00:19:09Z". (Formatters are costly to make: one, reused.)
    private static func parseDate(_ s: String) -> Date? { wallclock.date(from: s) }

    nonisolated(unsafe) private static let wallclock = ISO8601DateFormatter()
}

extension FootballFeed.Teams {
    /// Whether a spot's letters name the home team's end (nil: neither, or
    /// both): its abbreviation ("ALA"; "TA&M" written "TAM"), the NFL
    /// gamebook's own code for it ("HST" for HOU), or the first word of its
    /// name ("Kent" for Kent State, "Akron").
    func isHome(_ letters: String) -> Bool? {
        let key = Self.key(letters)
        let home = Self.keys(homeAbbreviation, homeName).contains(key), away = Self.keys(awayAbbreviation, awayName).contains(key)
        return home == away ? nil : home
    }

    /// The gamebook's codes where they aren't ESPN's abbreviations.
    static let gamebook = ["ARI": "ARZ", "BAL": "BLT", "CLE": "CLV", "HOU": "HST", "LAR": "LA", "WSH": "WAS"]

    private static func key(_ s: some StringProtocol) -> String { s.uppercased().filter(\.isLetter) }

    private static func keys(_ abbreviation: String, _ name: String) -> Set<String> {
        var keys: Set<String> = [key(abbreviation)]
        if let code = gamebook[abbreviation] { keys.insert(code) }
        if let first = name.split(separator: " ").first, first.count >= 3 { keys.insert(key(first)) }
        keys.remove("")
        return keys
    }
}
