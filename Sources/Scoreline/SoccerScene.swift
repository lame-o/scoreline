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

    /// What struck it, as Opta logs it (`contactType`).
    enum Contact: Equatable {
        case leftFoot, rightFoot, head
    }

    /// How the move that made the chance began, as Opta tags the shot
    /// (`shotInfo`), even when the build-up doesn't reach back that far.
    enum Situation: Equatable {
        case openPlay, corner, setPiece, freeKick, throwIn, fastBreak, penalty, ownGoal
    }

    /// The assist's kind, from the text ("Assisted by Ben White with a cross").
    enum AssistKind: Equatable {
        case cross, throughBall, headedPass
    }

    /// VAR's word on a goal: confirmed ("Goal confirmed following VAR
    /// Review."), or struck off (`SoccerFeed` takes it off the stage).
    enum Review: Equatable {
        case confirmed, overturned
    }

    /// A player exactly as ESPN credits him: athlete ID, shirt number and
    /// lineup role (ESPN's soccer position: 1 the keeper, 4 CD-L, 5 CD-R, 8 LB,
    /// 9 RB, 14 AM, 16 LM, 17 RM, 19 F, 27 a substitute, 32 AM-L, 33 AM-R).
    struct Credit: Equatable {
        var athlete: String
        var jersey: String?
        var role: Int?
        var keeper: Bool { role == 1 }
    }

    /// What the defending keeper did, and where, as the feed logs it (it has
    /// no save type: diving, catching): a save at his spot, a punch and
    /// where it landed, a claim in the air, a smother at a forward's feet, a
    /// rush off his line, the ball spilled.
    struct KeeperAction: Equatable {
        enum Kind: Equatable { case save, punch, claim, smother, sweep, spill }
        var kind: Kind
        var at: CGPoint
        /// Where a punch landed.
        var to: CGPoint?
        /// Match clock, in seconds.
        var clock: Double
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
        /// Who, exactly (athlete, shirt, lineup role).
        var credit: Credit?
        /// Where it happened, in metres.
        var at: CGPoint
        /// Where a pass, a cross or an earlier shot went.
        var to: CGPoint?
        /// In the air: a cross, a corner, a long ball.
        var lofted = false
        /// Match clock, in seconds (1 s resolution): the real gaps between
        /// touches, for pacing.
        var clock: Double
        /// The other team's: a deflection, a header won, a save.
        var defending = false
        /// The defending keeper's own: a save, a punch, coming off his line
        /// (credited to lineup role 1, or something only a keeper does).
        var keeper = false
        /// Won or contested in the air (Opta's "aerial"): a header, at head height.
        var aerial = false
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
        var contact: Contact?
        var situation: Situation?
        var penalty = false
        /// Opta's expected goals.
        var xg: Double?
        /// Expected goals on target: how hard it was to keep out (0 off target).
        var xgot: Double?
    }

    /// A player the moment names, and where he was (if ESPN placed him).
    struct Person: Equatable {
        var name: String?
        var at: CGPoint?
        var credit: Credit?
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
    var shooterCredit: Credit?
    var assist: String?
    var assistCredit: Credit?
    var assistKind: AssistKind?
    var keeper = Person()
    var blocker: Person?
    /// The defending keeper's actions in the move and just after the shot, oldest first.
    var keeperActions: [KeeperAction] = []
    var review: Review?
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

    /// The quarter-hour's half (1, 2; 3 and 4 in extra time): which end each team attacks.
    var period: Int?
    /// Drawn with the ends changed (`turned()`): the second half, or the viewer's turn of the pitch.
    var turnedRound = false

    /// Whether its team attacks the right-hand goal as drawn: home does in
    /// the data (as the Live Pitch draws it), unless the scene was turned round.
    var attacksRight: Bool { (side == .top) != turnedRound }
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
    /// A goal VAR struck off after it showed (`review` overturned): no longer
    /// the scene, so it never replays or celebrates; kept for a "no goal" beat.
    var overturned: SoccerScene?
    /// Both starting elevens and their nominal spots, from the match summary.
    var lineups: [GameDetail.Side: SoccerLineup] = [:]
    /// The events since (a corner, a foul, a booking, a substitution, a
    /// stoppage, the halves), oldest first: each gets its beat between moments.
    var events: [SoccerEvent] = []
    /// From this order on, events are news (they arrived with the page open) and play their beats.
    var newsFrom: Int?
    /// The moment's order in the feed: the events after it are the ones that follow it.
    var sceneOrder: Int?
    /// The ball's whereabouts now: the team on it and where.
    var touch: SoccerTouch?
    /// The half being played: the ends change at half time.
    var period: Int?
    /// When the feed last brought anything: the heartbeat counts from it.
    var heard: Date?
}

// MARK: - Parsing

extension SoccerScene {
    /// The plays the theater replays: goals (own goals and penalties too),
    /// saves, shots off the woodwork, blocks, big chances, penalties.
    static func isMoment(_ item: JSON) -> Bool {
        let type = item["type"]["type"].string ?? ""
        if item["scoringPlay"].bool == true || type == "goal" || type.hasPrefix("goal---") || type == "own-goal" { return true }
        if item["penaltyKick"].bool == true || type.hasPrefix("penalty---") { return true }
        // Every shot: a speculative one from distance is its own short beat.
        return type.hasPrefix("shot-")
    }

    /// A goal, as the entry stands (VAR may retype it later).
    static func isGoal(_ item: JSON) -> Bool {
        let type = item["type"]["type"].string ?? ""
        return item["scoringPlay"].bool == true || type == "goal" || type.hasPrefix("goal---") || type == "own-goal" || type == "penalty---scored"
    }

    /// The newest moment in a run of plays, with its build-up.
    static func latest(in plays: [JSON], homeTeamID: String?, keepers: [String: Person] = [:]) -> SoccerScene? {
        for index in plays.indices.reversed() where isMoment(plays[index]) {
            if let scene = parse(plays, at: index, homeTeamID: homeTeamID, keepers: keepers) { return scene }
        }
        return nil
    }

    /// Goalkeepers by team ID: whoever ESPN credits in lineup role 1, or with
    /// what only a keeper does (a substitute keeper's role is 27).
    static func keepers(in plays: [JSON]) -> [String: Person] {
        var found: [String: Person] = [:]
        for item in plays {
            guard let team = teamID(item), let credit = credit(item),
                  credit.keeper || keeperOnly(item["type"]["type"].string ?? "") else { continue }
            found[team] = Person(name: name(item), credit: credit)
        }
        return found
    }

    /// The moment at `index`, with what led to it. Nil for anything that isn't one.
    static func parse(_ plays: [JSON], at index: Int, homeTeamID: String?, keepers: [String: Person] = [:]) -> SoccerScene? {
        let item = plays[index]
        let text = item["text"].string ?? ""
        guard isMoment(item), let id = playID(item), let team = teamID(item) else { return nil }
        let side: GameDetail.Side = team == homeTeamID ? .top : .bottom
        // Where it was struck from: where ESPN placed it, else where its words say.
        func ours(_ p: (x: Double, y: Double)) -> CGPoint { Pitch.metres(x: side == .top ? p.x : 100 - p.x, y: side == .top ? p.y : 100 - p.y) }
        guard let from = place(item, "fieldPositionX", "fieldPositionY", home: homeTeamID)
                ?? spot(words: text, seed: Celebration.seed(id)).map(ours) else { return nil }
        let type = item["type"]["type"].string ?? ""
        let lower = text.lowercased()

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
        shot.contact = contact(item["contactType"]["text"].string)
        shot.situation = situation(item["shotInfo"]["text"].string)
        let header = shot.contact.map { $0 == .head } ?? (lower.contains("header") || type == "goal---header")
        shot.technique = header ? .header : type == "goal---volley" || lower.contains("volley") ? .volley : .foot
        shot.xg = item["expectedGoals"].double
        shot.xgot = item["expectedGoalsOnTarget"].double
        // Where it was going: ESPN's point in the goal mouth, else its words ("the bottom left corner").
        if let aim = item["goalPositionY"].double.map({ (y: $0, z: item["goalPositionZ"].double ?? 0) }) ?? Self.aim(words: text) {
            // In the shooter's frame like everything else: the away team's mouth turns round.
            shot.mouth = Mouth(y: Pitch.across(side == .top ? aim.y : 100 - aim.y), z: Pitch.height(aim.z))
        }
        if outcome == .saved || outcome == .blocked {
            shot.stopped = place(item, "fieldPosition2X", "fieldPosition2Y", home: homeTeamID)
        }

        let shooter = name(item) ?? (outcome == .ownGoal ? text.firstMatch(of: #/Own Goal by ([^,]+),/#).map { String($0.1) } : nil) ?? ""
        var scene = SoccerScene(id: id, outcome: outcome, side: side, shot: shot, shooter: shooter)
        scene.shooterCredit = credit(item)
        scene.assist = text.firstMatch(of: #/Assisted by (.+?)(?: with | following |\.|$)/#).map { String($0.1) }
        // The assister: credited by role, else second (the shooter is first).
        let credits = item["participants"].array
        scene.assistCredit = credits.firstIndex { $0["type"].string == "assister" }.map { credit(item, at: $0) }
            ?? (credits.count > 1 && credits[1]["type"].string == nil ? credit(item, at: 1) : nil)
        scene.assistKind = lower.contains("with a cross") ? .cross : lower.contains("with a through ball") ? .throughBall
            : lower.contains("with a headed pass") ? .headedPass : nil
        if lower.contains("goal confirmed following var review") { scene.review = .confirmed }
        scene.text = text
        scene.clock = item["clock"]["value"].double ?? 0
        scene.minute = minute(item["clock"]["displayValue"].string ?? "")
        scene.topScore = item["homeScore"].int
        scene.bottomScore = item["awayScore"].int
        scene.wallclock = item["wallclock"].string.flatMap(parseDate)
        scene.period = item["period"]["number"].int
        scene.decisive = scene.scored && decides(scene)
        if shot.penalty { scene.start = .penalty }

        // After the shot: the keeper's save or the block (an entry credited
        // to the defending team, where it was made, sometimes after the
        // header that made it), and where the ball went.
        let defending = plays.lazy.compactMap(teamID).first { $0 != team }
        if let defending, let known = keepers[defending] { scene.keeper = known }
        // The text names him before any entry of his has ("saved … by Zion Suzuki").
        if scene.keeper.name == nil { scene.keeper.name = savedBy(text) }
        var i = index + 1
        var settled = false
        while i < plays.count, i <= index + 6 {
            let next = plays[i]
            let nextType = next["type"]["type"].string ?? ""
            defer { i += 1 }
            guard abs((next["clock"]["value"].double ?? scene.clock) - scene.clock) <= 4 else { break }
            if ["assist", "assists-shot"].contains(nextType) { continue }
            // Another attempt: what follows is its own.
            if nextType.hasPrefix("shot-") || isGoal(next) { break }
            let at = place(next, "fieldPositionX", "fieldPositionY", home: homeTeamID)
            let theirs = teamID(next) != team
            let keeper = theirs && (credit(next)?.keeper == true || keeperOnly(nextType))
            if keeper, let action = keeperAction(next, home: homeTeamID) { scene.keeperActions.append(action) }
            if keeper {
                scene.keeper.credit = credit(next) ?? scene.keeper.credit
                scene.keeper.name = scene.keeper.name ?? name(next)
            }
            if nextType == "save", theirs {
                if keeper || (credit(next) == nil && outcome == .saved) {
                    scene.keeper.at = at
                    scene.keeper.name = name(next) ?? scene.keeper.name
                } else {
                    scene.blocker = Person(name: name(next), at: at, credit: credit(next))
                }
                continue
            }
            if settled { continue }
            guard !scene.scored, let at else { break }
            settled = true
            if nextType == "corner-awarded" {
                // Turned behind: past the post on the side it was going.
                let mouthY = shot.mouth?.y ?? Pitch.width / 2
                let beyond = side == .top ? Pitch.length + 2.5 : -2.5
                scene.rebound = CGPoint(x: beyond, y: mouthY < Pitch.width / 2 ? Pitch.posts.near - 3 : Pitch.posts.far + 3)
            } else if keeper {
                // The keeper's: a punch flies to where it landed, a spill drops at his feet; anything else he held.
                scene.rebound = nextType == "punch" ? place(next, "fieldPosition2X", "fieldPosition2Y", home: homeTeamID) ?? at
                    : nextType == "drop-of-ball" ? at : nil
            } else {
                scene.rebound = at
            }
        }

        if !shot.penalty {
            let chain = buildUp(plays, before: index, team: team, shooter: shooter, shotAt: from, clock: scene.clock, home: homeTeamID,
                                lofting: shot.technique != .foot)
            scene.touches = chain.touches
            scene.start = chain.start
            if scene.keeper.credit == nil, let his = scene.touches.last(where: \.keeper) {
                scene.keeper.credit = his.credit
                if scene.keeper.name == nil, !his.player.isEmpty { scene.keeper.name = his.player }
            }
            // The keeper's actions in the moment's window (a corner punched out before the move), then after the shot.
            let first = min(scene.touches.first?.clock ?? scene.clock, scene.clock - window)
            let before = plays[max(index - 30, 0)..<index].filter { item in
                teamID(item) != team && (item["clock"]["value"].double ?? 0) >= first
                    && (credit(item)?.keeper == true || keeperOnly(item["type"]["type"].string ?? ""))
            }
            scene.keeperActions = before.compactMap { keeperAction($0, home: homeTeamID) } + scene.keeperActions
        }
        return scene
    }

    /// Where a shot was struck from by its words, when ESPN didn't place it
    /// (in its team's frame, on Opta's 0…100): "from very close range",
    /// "from the left side of the six yard box", "from the centre of the
    /// box", "from outside the box", "from long range", "from a difficult
    /// angle on the right". Across the box or outside it, where the words
    /// don't say, seeded. (pure; tested)
    static func spot(words text: String, seed: UInt64) -> (x: Double, y: Double)? {
        let lower = text.lowercased()
        var random = SplitMix64(seed: seed)
        func side(_ centre: Double, _ spread: Double) -> Double {
            lower.contains("on the left") || lower.contains("left side") ? centre + spread
                : lower.contains("on the right") || lower.contains("right side") ? centre - spread : centre
        }
        if lower.contains("difficult angle") { return (lower.contains("long range") ? 84 : 93, side(50, 31)) }
        if lower.contains("very close range") { return (95, 50 + random.in(-3...3)) }
        if lower.contains("six yard box") { return (95.5, side(50, 7)) }
        if lower.contains("more than 35 yards") { return (64, 50 + random.in(-12...12)) }
        if lower.contains("long range") { return (72, 50 + random.in(-12...12)) }
        if lower.contains("outside the box") { return (79, 50 + random.in(-14...14)) }
        if lower.contains("side of the box") || lower.contains("centre of the box") { return (88, side(50 + random.in(-3...3), 14)) }
        if lower.contains("penalty") { return (88.5, 50) }
        return nil
    }

    /// Where a shot was going by its words, on the goal-line scale (the
    /// posts at 45.2 and 54.8, the bar at 38; the shooter's left is up the
    /// scale): "the bottom left corner", "the top right corner", "the centre
    /// of the goal", "high and wide to the left", "too high", "misses to the
    /// right", "close, but misses to the left". Nil when they don't say. (pure; tested)
    static func aim(words text: String) -> (y: Double, z: Double)? {
        let lower = text.lowercased()
        let left = lower.contains("left corner") || lower.contains("to the left") || lower.contains("left post")
        let right = lower.contains("right corner") || lower.contains("to the right") || lower.contains("right post")
        let wide = lower.contains("wide") || lower.contains("misses")
        let high = lower.contains("high") || lower.contains("over the bar") || lower.contains("crossbar")
        let top = lower.contains("top ") || lower.contains("top centre")
        guard left || right || high || lower.contains("centre of the goal") || lower.contains("bottom") || top else { return nil }
        let close = lower.contains("close")
        let y: Double = left ? (wide ? (close ? 56.5 : 60) : 53.3) : right ? (wide ? (close ? 43.5 : 40) : 46.7) : 50
        let z: Double = high ? (lower.contains("too high") || lower.contains("over") ? 52 : 46) : top ? 31 : lower.contains("bottom") ? 4 : wide ? 8 : 15
        return (y, z)
    }

    /// A keeper's entry as an action: a save, a punch (and where it landed),
    /// a claim, a smother, a rush off his line, a spill.
    static func keeperAction(_ item: JSON, home: String?) -> KeeperAction? {
        let kind: KeeperAction.Kind
        switch item["type"]["type"].string ?? "" {
        case "save": kind = .save
        case "punch": kind = .punch
        case "claim", "keeper-pick-up": kind = .claim
        case "smother": kind = .smother
        case "keeper-sweeper": kind = .sweep
        case "drop-of-ball": kind = .spill
        default: return nil
        }
        guard let at = place(item, "fieldPositionX", "fieldPositionY", home: home) else { return nil }
        return KeeperAction(kind: kind, at: at, to: kind == .punch ? place(item, "fieldPosition2X", "fieldPosition2Y", home: home) : nil,
                            clock: item["clock"]["value"].double ?? 0)
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
            var touch = Touch(kind: .touch, player: player, credit: credit(item), at: at, clock: time, defending: !ours)
            touch.to = place(item, "fieldPosition2X", "fieldPosition2Y", home: home)
            touch.aerial = type == "aerial"
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
                    touch.keeper = touch.credit?.keeper == true || keeperOnly(type) || (type == "save" && keeperSave(plays, at: i))
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

    /// A save entry is the keeper's when ESPN credits it to lineup role 1.
    /// Without a credit: when the shot just before it was on target (after a
    /// block it's the blocker's).
    static func keeperSave(_ plays: [JSON], at index: Int) -> Bool {
        if let credit = credit(plays[index]) { return credit.keeper }
        for item in plays[max(index - 3, 0)..<index].reversed() {
            let type = item["type"]["type"].string ?? ""
            guard type.hasPrefix("shot-") || type.hasPrefix("goal") || type.hasPrefix("penalty") else { continue }
            return type != "shot-blocked" || item["text"].string?.contains(" saved ") == true
        }
        return false
    }

    /// Who an entry credits, exactly: its first participant by default
    /// (the shooter, the passer), the assister second.
    static func credit(_ item: JSON, at index: Int = 0) -> Credit? {
        let p = item["participants"][index]
        guard let ref = p["athlete"]["$ref"].string, let range = ref.range(of: "/athletes/") else { return nil }
        let athlete = ref[range.upperBound...].prefix { $0.isNumber }
        guard !athlete.isEmpty else { return nil }
        let role = p["position"]["$ref"].string.flatMap { ref in
            ref.range(of: "/positions/").flatMap { Int(ref[$0.upperBound...].prefix { $0.isNumber }) }
        }
        return Credit(athlete: String(athlete), jersey: p["jersey"].string, role: role)
    }

    /// "Left Foot", "Right Foot", "Header".
    static func contact(_ text: String?) -> Contact? {
        switch text?.lowercased() {
        case "left foot"?: .leftFoot
        case "right foot"?: .rightFoot
        case "header"?, "head"?: .head
        default: nil
        }
    }

    /// "Regular Play", "From Corner", "Set Piece", "Free Kick", "Throw-in Set Piece", "Fast Break", "Penalty", "Own Goal".
    static func situation(_ text: String?) -> Situation? {
        guard let text = text?.lowercased() else { return nil }
        if text.contains("corner") { return .corner }
        if text.contains("throw") { return .throwIn }
        if text.contains("free kick") { return .freeKick }
        if text.contains("set piece") { return .setPiece }
        if text.contains("fast break") { return .fastBreak }
        if text.contains("penalty") { return .penalty }
        if text.contains("own goal") { return .ownGoal }
        if text.contains("regular") { return .openPlay }
        return nil
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

// MARK: - Lineups

/// A team's starting eleven as the match summary lists it (`rosters[]`,
/// which `ESPNDetail.load` already fetches): the formation, and each
/// starter's place in it, so every player has a nominal spot on the pitch,
/// not only those who touch the ball.
struct SoccerLineup: Equatable {
    struct Player: Equatable {
        var athlete: String
        /// "Zion Suzuki".
        var name: String?
        var jersey: String?
        /// ESPN's abbreviation: "G", "CD-L", "AM-R", "LM"… Ambiguous alone:
        /// LM and RM are the holding pair in a 4-2-3-1 but the wing-backs in a
        /// 3-4-2-1, so the formation decides where he stands.
        var position: String
        /// Opta's formation place: 1 the keeper, 2 to 11 by the formation's numbering.
        var place: Int
        /// His line: 0 the keeper, 1 the back line, and so on up the pitch.
        var line = 0
        /// Where the shape puts him, in his team's own frame on Opta's
        /// pitch: x toward the goal it attacks (0…100), y from its right
        /// touchline (0) to its left (100).
        var spot = CGPoint(x: 50, y: 50)
        var subbedOut = false
    }

    /// The team's ID.
    var team: String
    /// "4-2-3-1", "3-4-2-1", "5-4-1".
    var formation: String?
    /// The starting eleven, by formation place.
    var players: [Player]

    /// A player's nominal spot on the pitch, in metres (home attacks right, as the scene draws it).
    func spot(of athlete: String, attacksRight: Bool) -> CGPoint? {
        guard let p = players.first(where: { $0.athlete == athlete }) else { return nil }
        return Pitch.metres(x: attacksRight ? p.spot.x : 100 - p.spot.x, y: attacksRight ? p.spot.y : 100 - p.spot.y)
    }

    /// One roster from the summary; nil without a starting eleven.
    init?(_ roster: JSON) {
        guard let team = roster["team"]["id"].string else { return nil }
        let starters = roster["roster"].array.filter { $0["starter"].bool == true }
        let players = starters.compactMap { r -> Player? in
            guard let athlete = r["athlete"]["id"].string else { return nil }
            return Player(athlete: athlete, name: r["athlete"]["displayName"].string, jersey: r["jersey"].string,
                          position: r["position"]["abbreviation"].string ?? "", place: r["formationPlace"].int ?? 0,
                          subbedOut: r["subbedOut"].bool ?? false)
        }
        guard !players.isEmpty else { return nil }
        self.team = team
        formation = roster["formation"].string
        self.players = Self.shaped(players.sorted { $0.place < $1.place }, formation: formation)
    }

    /// Both teams' lineups from a summary's `rosters`, by side.
    static func lineups(_ rosters: JSON, side: (String?) -> GameDetail.Side?) -> [GameDetail.Side: SoccerLineup] {
        var out: [GameDetail.Side: SoccerLineup] = [:]
        for roster in rosters.array {
            if let lineup = SoccerLineup(roster), let s = side(lineup.team) { out[s] = lineup }
        }
        return out
    }

    /// Lays the eleven out from the formation string: the keeper, then one
    /// line per number, filled from the back by each position's depth (a
    /// back, a holding or wide midfielder, an attacking midfielder, a second
    /// striker, the striker), each line ordered across by its side (right,
    /// centre, left) and spread evenly. Without a usable formation, a line
    /// per depth. (pure; tested)
    static func shaped(_ players: [Player], formation: String?) -> [Player] {
        var out = players
        let keeper = out.firstIndex { $0.place == 1 || $0.position == "G" }
        let outfield = out.indices.filter { $0 != keeper }.sorted { (depth(out[$0].position), out[$0].place) < (depth(out[$1].position), out[$1].place) }
        let counts = (formation ?? "").split(separator: "-").compactMap { Int($0) }
        var lines: [[Int]] = []
        if counts.reduce(0, +) == outfield.count, !counts.isEmpty {
            var rest = outfield[...]
            for n in counts {
                lines.append(Array(rest.prefix(n)))
                rest = rest.dropFirst(n)
            }
        } else {
            for i in outfield {
                if let last = lines.last?.last, depth(out[last].position) == depth(out[i].position) { lines[lines.count - 1].append(i) }
                else { lines.append([i]) }
            }
        }
        if let keeper {
            out[keeper].line = 0
            out[keeper].spot = CGPoint(x: 5, y: 50)
        }
        for (n, line) in lines.enumerated() {
            // The back line about a fifth of the way up, the striker past halfway.
            let x = lines.count > 1 ? 22 + 40 * Double(n) / Double(lines.count - 1) : 40
            let across = line.sorted { (lateral(out[$0].position), out[$0].place) < (lateral(out[$1].position), out[$1].place) }
            let width = min(76, 22 * Double(across.count - 1))
            for (k, i) in across.enumerated() {
                out[i].line = n + 1
                out[i].spot = CGPoint(x: x, y: across.count > 1 ? 50 - width / 2 + width * Double(k) / Double(across.count - 1) : 50)
            }
        }
        return out
    }

    /// How far up the pitch a position plays: the backs, a holding
    /// midfielder, the midfield line (wing-backs and wide men in it), the
    /// attacking midfielders, a second striker, the striker.
    static func depth(_ position: String) -> Double {
        let p = position.uppercased()
        if ["RB", "LB", "CB", "D", "SW"].contains(p) || p.hasPrefix("CD") { return 1 }
        if p.hasPrefix("DM") || p == "CDM" { return 1.8 }
        if ["LM", "RM", "M", "LWB", "RWB"].contains(p) || p.hasPrefix("CM") { return 2 }
        if p.hasPrefix("AM") || p == "CAM" { return 3 }
        if p.hasPrefix("CF-") || ["SS", "RW", "LW", "RF", "LF"].contains(p) { return 3.5 }
        if ["F", "CF", "ST", "FW"].contains(p) { return 4 }
        return 2.5
    }

    /// Across the pitch from the team's right: a wide right player, right
    /// of centre ("-R"), central, left of centre ("-L"), wide left.
    static func lateral(_ position: String) -> Int {
        let p = position.uppercased()
        if ["RB", "RM", "RW", "RWB", "RF"].contains(p) { return -2 }
        if ["LB", "LM", "LW", "LWB", "LF"].contains(p) { return 2 }
        if p.hasSuffix("-R") { return -1 }
        if p.hasSuffix("-L") { return 1 }
        return 0
    }
}
