import CoreGraphics
import Foundation

// The soccer theater's model: one big moment (a goal, a save, a shot off the
// woodwork, a block, a big chance, a penalty), parsed from ESPN's core plays
// into what the theater replays: the attacking team's chain of touches that
// led to the shot, each where it happened; the shot from its spot to the
// exact point in the goal mouth it was heading for; how it ended, and who
// was in it. Pure values: the parser is tested against real plays, and the
// replay is a function of the scene and time.
//
// ESPN (Opta) logs every touch with where it happened (`fieldPositionX/Y`)
// and, for a pass or a shot, where it went (`fieldPosition2X/Y`), each in the
// acting team's own frame: it attacks toward x = 100, and y runs from its
// right touchline (0) to its left (100). A shot also says where it crossed
// the goal line (`goalPositionY`: the posts at 45.2 and 54.8) and how high
// (`goalPositionZ`: the bar at 38). The scene puts all of it on one pitch in
// metres, home attacking right as the Live Pitch draws it, through Opta's
// pitch markings, so a touch on the edge of the box is on its line.

/// The pitch in metres: x from the left goal line (105 long), y from the near
/// touchline, the camera's side (68 wide), z up. Home attacks right.
enum Pitch {
    static let length = 105.0
    static let width = 68.0
    static let goalWidth = 7.32
    static let goalHeight = 2.44
    /// Distances from the goal line.
    static let spot = 11.0
    static let boxDepth = 16.5
    static let boxWidth = 40.32
    static let sixDepth = 5.5
    static let sixWidth = 18.32
    static let circle = 9.15

    static var center: CGPoint { CGPoint(x: length / 2, y: width / 2) }

    /// The middle of the goal a team attacks: the right one for home.
    static func goal(right: Bool) -> CGPoint { CGPoint(x: right ? length : 0, y: width / 2) }

    /// Its posts, near (the camera's side) then far.
    static var posts: (near: Double, far: Double) { (width / 2 - goalWidth / 2, width / 2 + goalWidth / 2) }

    /// Opta's pitch (0…100 each way) to metres, piecewise through the
    /// markings its coordinates are drawn to: the box 17 deep and 21.1 to
    /// 78.9 across, the six-yard box 5.8 and 36.8 to 63.2, the spot 11.5, the
    /// posts 45.2 and 54.8.
    static func metres(x: Double, y: Double) -> CGPoint {
        CGPoint(x: piecewise(x, along), y: piecewise(y, across))
    }

    /// Across only: where a shot crossed the goal line.
    static func across(_ y: Double) -> Double { piecewise(y, across) }

    /// A goal-mouth height (the bar at 38) in metres.
    static func height(_ z: Double) -> Double { max(z, 0) / 38 * goalHeight }

    private static let along: [(Double, Double)] = [(0, 0), (5.8, 5.5), (11.5, 11), (17, 16.5), (50, 52.5), (83, 88.5), (88.5, 94),
                                                    (94.2, 99.5), (100, 105)]
    private static let across: [(Double, Double)] = [(0, 0), (21.1, 13.84), (36.8, 24.84), (45.2, 30.34), (50, 34), (54.8, 37.66),
                                                     (63.2, 43.16), (78.9, 54.16), (100, 68)]

    /// Between knots, linear; past the ends (a ball over the line), the end segment carried on.
    private static func piecewise(_ v: Double, _ knots: [(Double, Double)]) -> Double {
        var i = 1
        while i < knots.count - 1, v > knots[i].0 { i += 1 }
        let a = knots[i - 1], b = knots[i]
        return a.1 + (v - a.0) * (b.1 - a.1) / (b.0 - a.0)
    }
}

struct SoccerScene: Equatable, Identifiable {
    enum Outcome: Equatable {
        case goal, ownGoal, saved, blocked, woodwork, wide
    }

    /// How the move began.
    enum Start: Equatable {
        case openPlay, corner, freeKick, throwIn, goalKick, kickoff, penalty
    }

    enum Technique: Equatable {
        case foot, header, volley
    }

    /// Somebody on the ball (or at it) on the way to the shot.
    struct Touch: Equatable {
        enum Kind: Equatable {
            case pass, cross, takeOn, touch
            /// A set piece taken: a corner, a free kick, a throw-in, a goal kick.
            case restart
            /// The ball won back: where the move began.
            case regain
            /// An earlier shot in the same move (saved, and the rebound went in).
            case shot
        }
        var kind: Kind
        var player: String
        /// Where it happened, in metres.
        var at: CGPoint
        /// Where a pass, a cross or an earlier shot went.
        var to: CGPoint?
        /// In the air: a cross, a corner, a long ball.
        var lofted = false
        /// Match clock, in seconds.
        var clock: Double
        /// The other team's: a deflection, a header won, a save.
        var defending = false
        /// The defending keeper's own: a save, a punch, coming off his line
        /// (whether or not the feed has learned his name yet).
        var keeper = false
    }

    /// Where a shot crossed (or would have crossed) the goal line: metres
    /// from the near touchline, and up.
    struct Mouth: Equatable {
        var y: Double
        var z: Double
    }

    struct Shot: Equatable {
        var from: CGPoint
        var mouth: Mouth?
        /// Where it was stopped: the keeper's hands, the block.
        var stopped: CGPoint?
        var technique = Technique.foot
        var penalty = false
        /// Opta's expected goals.
        var xg: Double?
    }

    /// A player the moment names, and where he was (if ESPN placed him).
    struct Person: Equatable {
        var name: String?
        var at: CGPoint?
    }

    let id: String
    var outcome: Outcome
    var start = Start.openPlay
    /// The attacking team (the one credited, for an own goal). Top is home, attacking right.
    var side: GameDetail.Side
    /// The build-up, oldest first, the defending team's touches among them.
    var touches: [Touch] = []
    var shot: Shot
    /// Who struck it (an own goal's defender).
    var shooter: String
    var assist: String?
    var keeper = Person()
    var blocker: Person?
    /// Where the ball went after a save, a block or the woodwork, if it's
    /// known; nil when the keeper held it.
    var rebound: CGPoint?
    /// "37'", "90+3'".
    var minute = ""
    /// Match clock, in seconds.
    var clock = 0.0
    /// "Goal! Arsenal 2, Everton 0. Gabriel Magalhães (Arsenal) header from very close range…"
    var text = ""
    /// Goals after it, home (top) first.
    var topScore: Int?
    var bottomScore: Int?
    /// A late goal that changes the result: an equalizer or a winner from 85'.
    var decisive = false
    var wallclock: Date?

    var attacksRight: Bool { side == .top }
    var goal: CGPoint { Pitch.goal(right: attacksRight) }
    var scored: Bool { outcome == .goal || outcome == .ownGoal }
    /// The touches that led to the shot by the team that took it.
    var buildUp: [Touch] { touches.filter { !$0.defending } }

    /// From the spot to the middle of the goal, in yards (penalty spots
    /// included: 12).
    var distance: Int {
        let d = hypot(goal.x - shot.from.x, goal.y - shot.from.y) / 0.9144
        return Int(d.rounded())
    }

    /// Off the bar rather than a post: crossed between the posts, high.
    var crossbar: Bool {
        guard outcome == .woodwork, let mouth = shot.mouth else { return false }
        return mouth.z >= Pitch.goalHeight * 0.88 && mouth.y > Pitch.posts.near && mouth.y < Pitch.posts.far
    }

    /// "Magalhães" from "Gabriel Magalhães"; "van Dijk" from "Virgil van
    /// Dijk"; a single name stays whole.
    static func surname(_ name: String) -> String {
        let words = name.split(separator: " ").map(String.init)
        guard words.count > 1 else { return name }
        let particles: Set<String> = ["van", "von", "de", "da", "di", "der", "den", "dos", "du", "le", "la", "del", "ter", "ten"]
        if let i = words.indices.dropFirst().first(where: { particles.contains(words[$0]) }) {
            return words[i...].joined(separator: " ")
        }
        return words.dropFirst().joined(separator: " ")
    }
}

/// What the soccer theater shows: the latest big moment.
struct SoccerTheaterState: Equatable {
    var scene: SoccerScene?
    /// Arrived while the page was open, or only just happened: replay it.
    /// Otherwise it's history, and shows as it ended.
    var news = false
}

// MARK: - Parsing

extension SoccerScene {
    /// The plays the theater replays: goals (own goals and penalties too),
    /// saves, shots off the woodwork, blocks, big chances, penalties.
    static func isMoment(_ item: JSON) -> Bool {
        let type = item["type"]["type"].string ?? ""
        if item["scoringPlay"].bool == true || type == "goal" || type.hasPrefix("goal---") || type == "own-goal" { return true }
        if item["penaltyKick"].bool == true || type.hasPrefix("penalty---") { return true }
        switch type {
        case "shot-on-target", "shot-blocked", "shot-hit-woodwork": return true
        case "shot-off-target": return (item["expectedGoals"].double ?? 0) >= PitchAction.bigChanceXG
        default: return false
        }
    }

    /// The newest moment in a run of plays, with its build-up.
    static func latest(in plays: [JSON], homeTeamID: String?, keepers: [String: String] = [:]) -> SoccerScene? {
        for index in plays.indices.reversed() where isMoment(plays[index]) {
            if let scene = parse(plays, at: index, homeTeamID: homeTeamID, keepers: keepers) { return scene }
        }
        return nil
    }

    /// Goalkeepers by team ID, from what only a keeper does (a claim, a
    /// punch, a smother) and who saves are credited to.
    static func keepers(in plays: [JSON]) -> [String: String] {
        var found: [String: String] = [:]
        var saved = false
        for item in plays {
            let type = item["type"]["type"].string ?? ""
            if keeperOnly(type) || (type == "save" && saved), let team = teamID(item), let name = name(item) {
                found[team] = name
            }
            // A save after a shot on target is the keeper's (after a block, the blocker's).
            if type.hasPrefix("shot-") { saved = type == "shot-on-target" || item["text"].string?.contains(" saved ") == true }
            else if !["assist", "assists-shot", "save"].contains(type) { saved = false }
        }
        return found
    }

    /// The moment at `index`, with what led to it. Nil for anything that isn't one.
    static func parse(_ plays: [JSON], at index: Int, homeTeamID: String?, keepers: [String: String] = [:]) -> SoccerScene? {
        let item = plays[index]
        guard isMoment(item), let id = playID(item), let team = teamID(item),
              let from = place(item, "fieldPositionX", "fieldPositionY", home: homeTeamID) else { return nil }
        let type = item["type"]["type"].string ?? ""
        let text = item["text"].string ?? ""
        let lower = text.lowercased()
        let side: GameDetail.Side = team == homeTeamID ? .top : .bottom

        let outcome: Outcome
        if item["ownGoal"].bool == true || type == "own-goal" {
            outcome = .ownGoal
        } else if item["scoringPlay"].bool == true || type == "goal" || type.hasPrefix("goal---") || type == "penalty---scored" {
            outcome = .goal
        } else if type == "shot-on-target" || type == "penalty---saved" || (type == "shot-blocked" && lower.contains(" saved ")) {
            outcome = .saved
        } else if type == "shot-blocked" {
            outcome = .blocked
        } else if type == "shot-hit-woodwork" || lower.contains("hits the") && (lower.contains("post") || lower.contains("bar")) {
            outcome = .woodwork
        } else {
            outcome = .wide
        }

        var shot = Shot(from: from)
        shot.penalty = item["penaltyKick"].bool == true || type.hasPrefix("penalty---")
        shot.technique = lower.contains("header") || type == "goal---header" ? .header
            : type == "goal---volley" || lower.contains("volley") ? .volley : .foot
        shot.xg = item["expectedGoals"].double
        if let gy = item["goalPositionY"].double {
            // In the shooter's frame like everything else: the away team's mouth turns round.
            shot.mouth = Mouth(y: Pitch.across(side == .top ? gy : 100 - gy), z: Pitch.height(item["goalPositionZ"].double ?? 0))
        }
        if outcome == .saved || outcome == .blocked {
            shot.stopped = place(item, "fieldPosition2X", "fieldPosition2Y", home: homeTeamID)
        }

        let shooter = name(item) ?? (outcome == .ownGoal ? text.firstMatch(of: #/Own Goal by ([^,]+),/#).map { String($0.1) } : nil) ?? ""
        var scene = SoccerScene(id: id, outcome: outcome, side: side, shot: shot, shooter: shooter)
        scene.assist = text.firstMatch(of: #/Assisted by (.+?)(?: with | following |\.|$)/#).map { String($0.1) }
        scene.text = text
        scene.clock = item["clock"]["value"].double ?? 0
        scene.minute = minute(item["clock"]["displayValue"].string ?? "")
        scene.topScore = item["homeScore"].int
        scene.bottomScore = item["awayScore"].int
        scene.wallclock = item["wallclock"].string.flatMap(parseDate)
        scene.decisive = scene.scored && decides(scene)
        if shot.penalty { scene.start = .penalty }

        // After the shot: the keeper's save or the block (an entry credited
        // to the defending team, where it was made), and where the ball went.
        let defending = plays.lazy.compactMap(teamID).first { $0 != team }
        var keeperNames = keepers
        if let saver = savedBy(text), let defending { keeperNames[defending] = saver }
        scene.keeper.name = defending.flatMap { keeperNames[$0] }
        var i = index + 1
        while i < plays.count, i <= index + 6 {
            let next = plays[i]
            let nextType = next["type"]["type"].string ?? ""
            defer { i += 1 }
            guard abs((next["clock"]["value"].double ?? scene.clock) - scene.clock) <= 4 else { break }
            if ["assist", "assists-shot"].contains(nextType) { continue }
            let at = place(next, "fieldPositionX", "fieldPositionY", home: homeTeamID)
            if nextType == "save", teamID(next) != team {
                if outcome == .blocked {
                    scene.blocker = Person(name: name(next), at: at)
                } else if outcome == .saved || name(next) == scene.keeper.name {
                    scene.keeper.at = at
                    if scene.keeper.name == nil { scene.keeper.name = name(next) }
                }
                continue
            }
            guard !scene.scored, let at else { break }
            if nextType == "corner-awarded" {
                // Turned behind: past the post on the side it was going.
                let mouthY = shot.mouth?.y ?? Pitch.width / 2
                let beyond = side == .top ? Pitch.length + 2.5 : -2.5
                scene.rebound = CGPoint(x: beyond, y: mouthY < Pitch.width / 2 ? Pitch.posts.near - 3 : Pitch.posts.far + 3)
            } else if teamID(next) != team, let keeper = scene.keeper.name, name(next) == keeper || keeperOnly(nextType) {
                // The keeper has it: held.
                scene.rebound = nil
            } else {
                scene.rebound = at
            }
            break
        }

        if !shot.penalty {
            let chain = buildUp(plays, before: index, team: team, shooter: shooter, shotAt: from, clock: scene.clock, home: homeTeamID,
                                lofting: shot.technique != .foot)
            scene.touches = chain.touches
            scene.start = chain.start
            // His touches are the keeper's, by name or by what only a keeper does; one the feed
            // hasn't learned yet is named by them.
            for i in scene.touches.indices where scene.touches[i].defending && scene.touches[i].player == scene.keeper.name {
                scene.touches[i].keeper = true
            }
            if scene.keeper.name == nil, let his = scene.touches.last(where: \.keeper), !his.player.isEmpty {
                scene.keeper.name = his.player
            }
        }
        return scene
    }

    /// The move before the shot: back through the plays while the attacking
    /// team keeps the ball, for up to 20 seconds and its last eight touches.
    /// The other team's touches that didn't win it (a header contested, a
    /// deflection, a parry) are part of the move; one that did (a tackle, an
    /// interception, a clearance), or a stoppage, ends it. A set piece
    /// begins it.
    static func buildUp(_ plays: [JSON], before index: Int, team: String, shooter: String, shotAt: CGPoint, clock: Double,
                        home: String?, lofting: Bool) -> (touches: [Touch], start: Start) {
        var touches: [Touch] = []
        var start = Start.openPlay
        var last = clock
        var i = index - 1
        scan: while i >= 0 {
            let item = plays[i]
            defer { i -= 1 }
            let type = item["type"]["type"].string ?? ""
            let at = place(item, "fieldPositionX", "fieldPositionY", home: home)
            let time = item["clock"]["value"].double ?? last
            // Bookkeeping: an assist credit, a card, a substitution.
            guard let at else {
                if ["halftime", "kickoff", "start-2nd-half", "end-regular-time"].contains(type) { break }
                continue
            }
            if clock - time > window || last - time > lull { break }
            if touches.filter({ !$0.defending }).count >= touchLimit { break }
            let ours = teamID(item) == team
            let player = name(item) ?? ""
            var touch = Touch(kind: .touch, player: player, at: at, clock: time, defending: !ours)
            touch.to = place(item, "fieldPosition2X", "fieldPosition2Y", home: home)
            let length = touch.to.map { hypot($0.x - at.x, $0.y - at.y) } ?? 0
            if ours {
                switch type {
                case "pass", "cross":
                    let raw = (item["fieldPositionX"].double ?? 0, item["fieldPositionY"].double ?? 50)
                    if raw.0 >= 98.5, raw.1 <= 1.5 || raw.1 >= 98.5 {
                        touch.kind = .restart
                        touch.lofted = true
                        touches.append(touch)
                        start = .corner
                        break scan
                    }
                    touch.kind = type == "cross" ? .cross : .pass
                    touch.lofted = type == "cross" || length > 30
                case "take-on":
                    touch.kind = .takeOn
                case "ball-touch", "aerial", "shield-ball-opp":
                    touch.kind = .touch
                case "shot-on-target", "shot-blocked", "shot-off-target", "shot-hit-woodwork":
                    touch.kind = .shot
                case "free-kick", "throw-in", "goal-kick", "kickoff":
                    touch.kind = .restart
                    touch.lofted = type == "free-kick" ? length > 25 : type == "goal-kick" && length > 30
                    touches.append(touch)
                    start = type == "free-kick" ? .freeKick : type == "throw-in" ? .throwIn : type == "goal-kick" ? .goalKick : .kickoff
                    break scan
                case "tackle", "interception", "blocked-pass", "clear", "save", "claim", "punch", "smother", "keeper-sweeper":
                    touch.kind = .regain
                    touches.append(touch)
                    break scan
                case "assist", "assists-shot":
                    continue
                default:
                    // Out of play, offside, a foul: the move starts after it.
                    break scan
                }
                // The header's own duel (logged as an aerial on the shot's spot) isn't a touch before it.
                if touches.isEmpty, player == shooter, hypot(at.x - shotAt.x, at.y - shotAt.y) < 1.5, touch.kind != .pass, touch.kind != .cross {
                    last = time
                    continue
                }
                // A take-on logged twice.
                if let newer = touches.last, !newer.defending, newer.player == player, newer.kind == touch.kind, newer.at == touch.at {
                    continue
                }
                touches.append(touch)
                last = time
            } else {
                switch type {
                case "aerial", "ball-touch", "blocked-pass", "attempted-tackle", "save", "punch", "keeper-sweeper", "challenge",
                     "shield-ball-opp":
                    touch.keeper = keeperOnly(type) || (type == "save" && keeperSave(plays, at: i))
                    touches.append(touch)
                case "pass" where length < 6 && last - time <= 4:
                    // A pass of a few yards straight back to the attack: a header won and lost, really.
                    touch.to = nil
                    touches.append(touch)
                default:
                    break scan
                }
            }
        }
        // The other team's touches before the attack's first don't belong to it.
        while touches.last?.defending == true { touches.removeLast() }
        touches.reverse()
        // The ball into a header (or a volley) came through the air.
        if lofting, let i = touches.lastIndex(where: { !$0.defending && ($0.kind == .pass || $0.kind == .restart) }),
           let to = touches[i].to, hypot(to.x - shotAt.x, to.y - shotAt.y) < 8 {
            touches[i].lofted = true
        }
        return (touches, start)
    }

    /// How far back a move reaches: seconds before the shot, the longest pause in it, its touches.
    static let window = 20.0
    static let lull = 8.0
    static let touchLimit = 8

    // MARK: Fields

    /// A position in metres, from the entry's own team's frame onto the
    /// pitch where home attacks right. Nil for an entry ESPN didn't place.
    static func place(_ item: JSON, _ xKey: String, _ yKey: String, home: String?) -> CGPoint? {
        guard let x = item[xKey].double, let y = item[yKey].double, x != 0 || y != 0 else { return nil }
        let isHome = teamID(item) == home
        return Pitch.metres(x: isHome ? x : 100 - x, y: isHome ? y : 100 - y)
    }

    /// ".../teams/362?lang=en" → "362".
    static func teamID(_ item: JSON) -> String? {
        guard let ref = item["team"]["$ref"].string, let range = ref.range(of: "/teams/") else { return nil }
        let id = ref[range.upperBound...].prefix { $0.isNumber }
        return id.isEmpty ? nil : String(id)
    }

    static func playID(_ item: JSON) -> String? {
        item["id"].string ?? item["id"].int.map(String.init)
    }

    /// "Martin Ødegaard Pass" less its type: "Martin Ødegaard".
    static func name(_ item: JSON) -> String? {
        if let short = item["shortText"].string, let type = item["type"]["text"].string, short.hasSuffix(" " + type) {
            let name = short.dropLast(type.count + 1)
            return name.isEmpty ? nil : String(name)
        }
        return item["text"].string?.firstMatch(of: #/^([^.!()]+?) \(/#).map { String($0.1) }
    }

    /// "…is saved in the bottom left corner by Zion Suzuki (Aston Villa)." → "Zion Suzuki".
    static func savedBy(_ text: String) -> String? {
        text.firstMatch(of: #/saved [^.]*? by ([^(.]+?) \(/#).map { String($0.1) }
    }

    /// A save entry is the keeper's when the shot just before it was on
    /// target; after a block it's the blocker's.
    static func keeperSave(_ plays: [JSON], at index: Int) -> Bool {
        for item in plays[max(index - 3, 0)..<index].reversed() {
            let type = item["type"]["type"].string ?? ""
            guard type.hasPrefix("shot-") || type.hasPrefix("goal") || type.hasPrefix("penalty") else { continue }
            return type != "shot-blocked" || item["text"].string?.contains(" saved ") == true
        }
        return false
    }

    static func keeperOnly(_ type: String) -> Bool {
        ["claim", "punch", "smother", "keeper-sweeper", "keeper-pick-up", "drop-of-ball"].contains(type)
    }

    /// "90'+3'" → "90+3'".
    static func minute(_ display: String) -> String {
        let bare = display.replacingOccurrences(of: "'", with: "")
        return bare.isEmpty ? "" : bare + "'"
    }

    /// From 85': the scorers now level, or one ahead.
    static func decides(_ scene: SoccerScene) -> Bool {
        guard scene.clock >= PitchAction.lateSeconds, let top = scene.topScore, let bottom = scene.bottomScore else { return false }
        let (mine, theirs) = scene.side == .top ? (top, bottom) : (bottom, top)
        return mine == theirs || mine == theirs + 1
    }

    /// "2026-10-24T11:32:05Z". (Formatters are costly to make: one, reused.)
    private static func parseDate(_ s: String) -> Date? { wallclockFormat.date(from: s) }
    nonisolated(unsafe) private static let wallclockFormat = ISO8601DateFormatter()
}
