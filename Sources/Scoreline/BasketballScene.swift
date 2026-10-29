import Foundation

// The basketball theater's model: one play from ESPN's core play-by-play (as
// the live lane keeps it, `BasketballFeed.normalized`) parsed into what the
// theater replays: the kind of shot and how it was taken, where (ESPN's own
// spot), who shot it, who passed it, who blocked it, the miss a putback came
// from and the steal a fast break came from, the result and the points, and
// what made it more than a basket (an and-one, the buzzer, a dunk through a
// defender who fouled him). Pure values: the parser is tested against real
// games, and the replay is a function of the scene and time.
//
// Structured fields decide the play (its type, the participants and their
// parts, the coordinate, the scores, the clock); the text adds only the
// names a stamp shows ("Mikel Brown Jr. makes 23-foot three point jumper
// (Keon Ellis assists)": Brown Jr., Ellis) and ESPN's own distance.
//
// What replays in full (the marquee): every made field goal, every block,
// and a shot to tie or take the lead in the last 30 seconds of the fourth or
// overtime that missed (or a free throw that tied it or won the lead).
// Everything else ESPN logs is a lighter beat between them (BasketballBeats.swift):
// each miss and its rebound, each free throw, each whistle (its call and who),
// each turnover by its kind, the jump balls, substitutions, timeouts, reviews
// and the ends of periods. A steal is the lead-in to the basket it led to, an
// offensive rebound the lead-in to its putback: a replay that shows them
// says so (`leadIn`), as a miss says which rebound it ends in (`follows`).

struct BasketballScene: Equatable, Identifiable {
    enum Kind: Equatable {
        case jumper, three, layup, dunk, alleyOop, putback, freeThrow
        /// A shot swatted away (`shot` says what was tried).
        case block
        /// The ball taken by a defender; lost without one.
        case steal, turnover
        case offensiveRebound, defensiveRebound
        /// A whistle that isn't a turnover: a foul (offensive ones too), a
        /// technical; a violation the ball stays with the offense on (a kicked
        /// ball, goaltending, a delay). `call` says which.
        case foul, violation
        case jumpBall, substitution, timeout, periodEnd
        /// A coach's challenge or a referee's review, and how it came out.
        case challenge
    }

    /// What a whistle (or a turnover) was for, as the play-by-play names it.
    enum Call: Equatable {
        case shooting, personal, looseBall, take, flagrant, technical, offensive, charge
        case badPass, lostBall, outOfBounds, traveling, shotClock, offensiveGoaltending
        case kickedBall, goaltending, delay
        /// Anything else ESPN calls (a double dribble, three seconds, a
        /// backcourt), in its words ("DOUBLE DRIBBLE").
        case other(String)

        /// The call as a broadcast tag says it.
        var words: String {
            switch self {
            case .shooting: "SHOOTING FOUL"
            case .personal: "FOUL"
            case .looseBall: "LOOSE BALL FOUL"
            case .take: "TAKE FOUL"
            case .flagrant: "FLAGRANT FOUL"
            case .technical: "TECHNICAL"
            case .offensive: "OFFENSIVE FOUL"
            case .charge: "CHARGE"
            case .badPass: "BAD PASS"
            case .lostBall: "LOST BALL"
            case .outOfBounds: "OUT OF BOUNDS"
            case .traveling: "TRAVELING"
            case .shotClock: "SHOT CLOCK"
            case .offensiveGoaltending: "OFFENSIVE GOALTENDING"
            case .kickedBall: "KICKED BALL"
            case .goaltending: "GOALTENDING"
            case .delay: "DELAY OF GAME"
            case let .other(words): words
            }
        }

        /// A foul by the team without the ball: the other team keeps it (and may shoot).
        var defensive: Bool { [.shooting, .personal, .looseBall, .take, .flagrant, .kickedBall, .goaltending].contains(self) }
    }

    /// How a player plays, from ESPN's position: who stands on the arc, who
    /// on the block (a guard rebounds long, a big under the rim).
    enum Role: Equatable { case guardRole, wing, big }

    /// How the shooter got the shot off, from ESPN's type: off a pass, off
    /// the dribble, going away from the defender, with his back to the
    /// basket, floating it over the help, at the rim.
    enum Move: Equatable {
        case catchAndShoot, pullUp, stepBack, fadeaway, turnaround, floater, hook
        /// Down the lane off the dribble, or cutting to the rim off a pass.
        case drive, cut
        /// Back up off the rim: a tip or a putback.
        case tip
        /// Set at the line.
        case set
    }

    enum Result: Equatable { case make, miss, blocked }

    /// Someone in on it: ESPN's athlete ID and the name the stamp gives him
    /// ("Brown Jr."), and how he plays (ESPN's position for him on the play).
    struct Person: Equatable {
        var id: String?
        var name: String
        var role: Role? = nil
    }

    /// The missed shot a putback (or a rebound) came off: where, by whom, for how many.
    struct Miss: Equatable {
        var spot: CGPoint
        var shooter: Person?
        var value: Int
        /// It was a layup or a dunk (it goes up from the rim, not the arc).
        var close: Bool
        /// The miss and the offensive rebound after it, by ID (a putback's replay shows both).
        var id: String? = nil
        var board: String? = nil
        /// Swatted (it falls by the shooter), or a free throw (off the front of the rim).
        var blocked = false
        var freeThrow = false
        /// ESPN's distance in feet.
        var distance: Double? = nil
    }

    /// The steal a fast break came from, at its spot (in ESPN's feet toward
    /// the basket of the team that lost it: the far end).
    struct Steal: Equatable {
        var spot: CGPoint?
        var loser: Person?
        var stealer: Person?
        var id: String? = nil
    }

    /// Who got the ball after a miss or a block, from the next play: nil
    /// person for a team rebound.
    struct Rebound: Equatable {
        var person: Person?
        var offensive: Bool
        /// The rebound's own play.
        var id: String? = nil
    }

    let id: String
    var kind: Kind
    /// The shot taken (a block's: the layup it stopped); nil when no shot was.
    var shot: Kind?
    var move: Move
    var result: Result
    /// Points scored, and what the shot was for (2 or 3; 1 at the line).
    var points = 0
    var value = 2
    /// The team that shot it (or lost the ball).
    var offense: GameDetail.Side?
    /// ESPN's spot in half-court feet toward the offense's basket: x 0…50
    /// across (0 the shooter's left facing it), y out from the backboard
    /// (the rim at about (25, 1.25)).
    var spot: CGPoint?
    /// Feet from the rim, as ESPN's text gives it (else from the spot).
    var distance: Double?
    var shooter: Person?
    var assister: Person?
    var blocker: Person?
    /// The defender a made basket's and-one foul was on.
    var fouler: Person?
    var rebound: Rebound?
    var miss: Miss?
    var steal: Steal?
    /// A make with a shooting foul by the other team at the same clock.
    var andOne = false
    /// Made with a second or less on the clock (`NBADetail.buzzer`).
    var buzzer = false
    /// A buzzer-beater that tied it or won it at the end of the fourth or overtime.
    var decisive = false
    /// The last five minutes, within five (`NBADetail.clutch`).
    var clutch = false
    /// A shot to tie or take the lead in the last 30 seconds of the fourth or overtime.
    var lastShot = false
    /// Finished at the rim with a dunk (an alley-oop's, a putback's too).
    var dunk = false
    /// A reverse finish: under the rim and up the other side.
    var reverse = false
    var period: Int?
    var clock = ""
    /// The score after it.
    var top = 0
    var bottom = 0
    var typeID: Int?
    var typeText = ""
    var text = ""
    var wallclock: Date?

    // The lighter beats' facts.
    /// What the whistle (or the turnover) was for.
    var call: Call?
    /// A free throw's place in its trip ("1 of 2"): nil when ESPN doesn't say.
    var attempt: Int?
    var attempts: Int?
    /// Who drew a foul: the shooter of the free throws it gave, when they're in.
    var drew: Person?
    /// How many free throws a foul gave (nil: none, or not in yet).
    var trip: Int?
    /// Who came in, who went out.
    var subIn: Person?
    var subOut: Person?
    /// The two men in a jump ball, and who came up with it.
    var jumpers: [Person] = []
    var winner: Person?
    /// The game's last play ("End of Game").
    var final = false
    /// A challenge's outcome: overturned, or the call stands (nil: under way).
    var overturned: Bool?
    /// A review the referees started (no coach's challenge).
    var review = false
    /// "Official timeout", or a media one, as ESPN's text calls it.
    var stoppage: String?
    /// Plays its choreography also shows: earlier ones (the steal before a
    /// break, the miss and the board before a putback), later ones (the
    /// rebound a miss ends in, an and-one's foul, an offensive foul's turnover).
    var leadIn: [String] = []
    var follows: [String] = []

    /// A dunk through the defender who fouled him: the data credits him.
    var posterized: Bool { dunk && andOne && fouler != nil && result == .make }

    var made: Bool { result == .make }

    /// The team without the ball.
    var defense: GameDetail.Side? { offense?.opponent }

    /// A field goal attempt or a free throw.
    var isShot: Bool { shot != nil }

    /// The team the play happens to with the ball (its frame: the basket it
    /// attacks is the one in front): the shooter's, the team that lost it,
    /// the team a foul was on; a defensive rebound's comes off the other
    /// team's miss. Nil when the play doesn't say (a substitution, a timeout).
    var ball: GameDetail.Side? {
        switch kind {
        case .defensiveRebound:
            return offense?.opponent
        case .foul, .violation:
            guard let call, call != .technical, call != .delay else { return nil }
            return call.defensive ? offense?.opponent : offense
        case .substitution, .timeout, .periodEnd, .challenge:
            return nil
        default:
            return offense
        }
    }

    /// Who has the ball once it's over (nil: nobody can say, or a stoppage
    /// keeps whatever was): a make or a defensive board turns it over, an
    /// offensive board keeps it, a whistle gives it to the team it was for.
    var after: GameDetail.Side? {
        switch kind {
        case .jumper, .three, .layup, .dunk, .alleyOop, .putback, .block:
            if made { return andOne ? offense : offense?.opponent }
            return rebound.flatMap { $0.offensive ? offense : offense?.opponent }
        case .freeThrow:
            let last = (attempt ?? 1) >= (attempts ?? 1)
            if made { return last ? offense?.opponent : offense }
            return last ? rebound.flatMap { $0.offensive ? offense : offense?.opponent } : offense
        case .steal, .turnover:
            return offense?.opponent
        case .offensiveRebound, .defensiveRebound, .jumpBall:
            return offense
        case .foul, .violation:
            guard let call, call != .technical, call != .delay else { return nil }
            // Goaltending's basket counts: the team that committed it takes it out.
            return call == .goaltending ? offense : offense?.opponent
        case .substitution, .timeout, .periodEnd, .challenge:
            return nil
        }
    }

    /// Whether the theater replays it (see the file's note). (pure; tested)
    var replays: Bool {
        switch kind {
        case .jumper, .three, .layup, .dunk, .alleyOop, .putback:
            return spot != nil && (made || lastShot)
        case .block:
            return spot != nil
        case .freeThrow:
            return made && lastShot
        case .steal, .turnover, .offensiveRebound, .defensiveRebound, .foul, .violation, .jumpBall, .substitution, .timeout,
             .periodEnd, .challenge:
            return false
        }
    }
}

/// What the basketball theater tells: the newest plays, every kind, in game
/// order, and which of them are news (arrived while the page was open, or
/// only just happened); history is never told, only the court it left.
struct BasketballTheaterState: Equatable {
    var plays: [BasketballScene] = []
    var news: Set<String> = []
    /// When the lane last brought a new play: the heartbeat counts from here.
    var heard: Date?

    /// The newest play worth a full replay (the marquee), news or not.
    var marquee: BasketballScene? { plays.last { $0.replays } }
}

// MARK: - Parsing

extension BasketballScene {
    /// Substitutions, timeouts, reviews and challenges: nothing moves on the court.
    static let admin: Set<Int> = [584, 16, 17, 10, 18, 213, 214, 215, 216, 277, 278, 279, 280, 281]
    /// Tips and putbacks of every kind.
    static let putbackTypes: Set<Int> = [94, 125, 138, 150]
    /// Layups of every kind, alley-oops' too.
    static let layupTypes: Set<Int> = [95, 109, 110, 111, 112, 126, 127, 128, 129, 141, 142]
    /// Reverse finishes.
    static let reverseTypes: Set<Int> = [112, 117, 126, 127]

    /// The newest play worth replaying among the last `reach` of `plays`
    /// (only the newest are ever looked at).
    static func newest(in plays: [JSON], teams: BasketballFeed.Teams, reach: Int = 12) -> BasketballScene? {
        for index in plays.indices.reversed().prefix(reach) {
            if let scene = parse(plays, at: index, teams: teams), scene.replays { return scene }
        }
        return nil
    }

    /// The newest `count` plays of `plays` as scenes, every kind the theater
    /// tells, in ESPN's order.
    static func recent(in plays: [JSON], teams: BasketballFeed.Teams, count: Int = 40) -> [BasketballScene] {
        plays.indices.suffix(count).compactMap { parse(plays, at: $0, teams: teams) }
    }

    /// The play at `index` of `plays` (in ESPN's order) as a scene; nil for
    /// one the theater has nothing to tell of (a placeholder, a type it
    /// doesn't know).
    static func parse(_ plays: [JSON], at index: Int, teams: BasketballFeed.Teams) -> BasketballScene? {
        guard plays.indices.contains(index) else { return nil }
        let play = plays[index]
        guard let id = play["id"].string else { return nil }
        let type = play["type"]["id"].int
        let typeText = (play["type"]["text"].string ?? "").replacingOccurrences(of: "\n", with: " ")
        let text = NBADetail.plain(play["text"].string ?? "").replacingOccurrences(of: " 's ", with: "'s ")
        let raw = play["text"].string ?? ""
        let roles = Self.roles(play)
        let kind: Kind, move: Move
        var shot: Kind?
        var result = Result.miss
        var call: Call?
        if play["shootingPlay"].bool == true {
            let made = play["scoringPlay"].bool == true && (play["scoreValue"].int ?? 1) > 0
            let blocked = !made && roles.contains { $0.role == "blocker" }
            result = made ? .make : blocked ? .blocked : .miss
            if NBADetail.isFreeThrow(play) {
                (kind, move) = (.freeThrow, .set)
                shot = .freeThrow
            } else {
                let assisted = roles.contains { $0.role == "assister" }
                let form = Self.form(type: type, typeText: play["type"]["text"].string ?? "", assisted: assisted,
                                     distance: Self.distance(play))
                (kind, move) = (blocked ? .block : form.kind, form.move)
                shot = form.kind
            }
        } else if type == 156 || type == 155 {
            (kind, move) = (type == 156 ? .offensiveRebound : .defensiveRebound, .tip)
        } else if let type, NBADetail.turnoverTypes.contains(type), type != 61 {
            (kind, move) = (roles.contains { $0.role == "defender" } || NBADetail.participants(play).count > 1 ? .steal : .turnover, .drive)
            call = Self.loss(type: type, words: typeText)
        } else if let foul = Self.foul(type: type, words: typeText) {
            (kind, move) = (.foul, .drive)
            call = foul
        } else if let violation = Self.violation(type: type, words: typeText) {
            (kind, move) = (.violation, .drive)
            call = violation
        } else if type == 615 {
            (kind, move) = (.jumpBall, .set)
        } else if type == 584 {
            (kind, move) = (.substitution, .set)
        } else if NBADetail.periodEnd(play) != nil {
            (kind, move) = (.periodEnd, .set)
        } else if Self.isReview(type: type, text: raw) {
            (kind, move) = (.challenge, .set)
        } else if [16, 17, 10, 18].contains(type ?? 0) || typeText.lowercased().contains("timeout") {
            (kind, move) = (.timeout, .set)
        } else {
            return nil
        }

        var scene = BasketballScene(id: id, kind: kind, shot: shot, move: move, result: result)
        scene.offense = teams.side(play["team"]["id"].string)
        scene.typeID = type
        scene.typeText = typeText
        scene.call = call
        scene.text = text
        scene.period = play["period"]["number"].int
        scene.clock = play["clock"]["displayValue"].string ?? ""
        scene.wallclock = play["wallclock"].string.flatMap(parseDate)
        if let score = LiveScore(play) {
            (scene.top, scene.bottom) = teams.topIsHome ? (score.home, score.away) : (score.away, score.home)
        }
        if let x = play["coordinate"]["x"].double, let y = play["coordinate"]["y"].double, x > -1000, y > -1000 {
            scene.spot = CGPoint(x: x, y: y)
        }
        if kind == .freeThrow { scene.spot = CGPoint(x: 25, y: 15) }
        scene.distance = Self.distance(play) ?? scene.spot.map { Double(hypot($0.x - 25, $0.y - 1.25)).rounded() }
        if shot != nil {
            scene.value = kind == .freeThrow ? 1
                : NBADetail.shotValue(play, x: Double(scene.spot?.x ?? 25), y: Double(scene.spot?.y ?? 1))
            scene.points = scene.made ? play["scoreValue"].int ?? scene.value : 0
            // A jump shot from beyond the arc is a three.
            if scene.value == 3, scene.shot == .jumper {
                scene.shot = .three
                if scene.kind == .jumper { scene.kind = .three }
            }
        }
        scene.reverse = type.map(reverseTypes.contains) ?? false
        scene.dunk = scene.made || result == .blocked ? type.map(NBADetail.dunkTypes.contains) ?? false : false

        // Who: the credited parts, named from the text.
        func person(_ role: String, _ fallback: Int?, named: String?) -> Person? {
            let entry = roles.first { $0.role == role } ?? fallback.flatMap { i in i < roles.count && roles[i].role == nil ? roles[i] : nil }
            guard entry?.id != nil || named != nil else { return nil }
            return Person(id: entry?.id, name: named.map(surname) ?? "", role: entry?.position.flatMap(Self.role))
        }
        let names = Self.names(raw)
        switch kind {
        case .steal, .turnover:
            scene.shooter = person("offense", 0, named: names.loser ?? leadingName(raw))
            scene.steal = Steal(spot: scene.spot, loser: scene.shooter, stealer: kind == .steal ? person("defender", 1, named: names.stealer) : nil, id: id)
        case .offensiveRebound, .defensiveRebound:
            scene.shooter = person("rebounder", 0, named: names.rebounder)
            scene.miss = Self.shotBefore(index, in: plays)
        case .foul, .violation:
            scene.shooter = person("fouler", 0, named: leadingName(raw))
            // Who drew it, and how many shots it gave: the free throws at its clock, by the other team.
            let trip = Self.freeThrows(after: index, in: plays)
            scene.trip = trip.attempts ?? (trip.shooter != nil ? 1 : nil)
            scene.drew = trip.shooter
            if call == .offensive || call == .charge {
                // ESPN logs the turnover again, at the same clock.
                scene.follows = Self.sameClock(after: index, in: plays, limit: 3) { $0["type"]["id"].int == 84 }.map { [$0] } ?? []
            }
        case .jumpBall:
            // "A vs. B (C gains possession)": both jumpers, then who came up with it.
            let m = raw.firstMatch(of: #/^(.+?) vs\. (.+?) \((.+?) gains possession\)/#)
            let named = [m.map { String($0.1) }, m.map { String($0.2) }, m.map { String($0.3) }]
            let people = (0..<3).map { i -> Person? in
                let entry = i < roles.count ? roles[i] : nil
                guard entry?.id != nil || named[i] != nil else { return nil }
                return Person(id: entry?.id, name: named[i].map(surname) ?? "", role: entry?.position.flatMap(Self.role))
            }
            scene.jumpers = people.prefix(2).compactMap { $0 }
            scene.winner = people[2]
        case .substitution:
            let m = raw.firstMatch(of: #/^(.+?) enters the game for (.+)$/#)
            scene.subIn = person("subin", 0, named: m.map { String($0.1) })
            scene.subOut = person("subout", 1, named: m.map { String($0.2).trimmingCharacters(in: .whitespaces) })
        case .periodEnd:
            scene.final = NBADetail.periodEnd(play)?.final ?? false
        case .challenge:
            let words = raw.uppercased()
            scene.review = words.contains("REF-INITIATED") || (278...281).contains(type ?? 0)
            scene.overturned = words.contains("OVERTURNED") || type == 215 ? true
                : words.contains("STANDS") || words.contains("SUPPORTS") || words.contains("CONFIRMED") || type == 214 || type == 216 ? false : nil
            if scene.offense == nil, let team = raw.firstMatch(of: #/\[(.+?)\]/#) {
                scene.offense = [GameDetail.Side.top, .bottom].first { teams.name($0).caseInsensitiveCompare(String(team.1)) == .orderedSame }
            }
        case .timeout:
            let words = raw.lowercased()
            scene.stoppage = words.contains("media") || words.contains("tv timeout") ? "MEDIA TIMEOUT"
                : words.contains("official") ? "OFFICIAL TIMEOUT" : nil
        default:
            scene.shooter = person("shooter", 0, named: names.shooter)
            scene.assister = scene.made ? person("assister", 1, named: names.assister) : nil
            scene.blocker = result == .blocked ? person("blocker", 1, named: names.blocker) : nil
        }
        guard shot != nil else { return scene }
        if kind == .freeThrow {
            (scene.attempt, scene.attempts) = Self.trip(type: type, text: raw)
        }

        // The moment around it: the margin before and after, the clock.
        let before = index > 0 ? (plays[..<index].last(where: { LiveScore($0) != nil }).flatMap(LiveScore.init)) : LiveScore(home: 0, away: 0)
        let after = LiveScore(play)
        let sign = scene.offense == .bottom ? -1 : 1
        let marginBefore = (before ?? after).map { teams.margin($0) * sign }
        let marginAfter = after.map { teams.margin($0) * sign }
        let period = scene.period ?? 0
        let left = NBADetail.seconds(scene.clock)
        if let left, let margin = marginBefore {
            scene.clutch = NBADetail.clutch(period: period, secondsLeft: left, margin: margin)
            // A shot to tie or take the lead, late: a miss that matters, or a free throw that ties it or goes ahead.
            let late = period >= 4 && left <= 30
            scene.lastShot = late && (kind == .freeThrow ? (margin == -1 || margin == 0) && scene.made && isLastFreeThrowOfTrip(play)
                : margin >= -scene.value && margin <= 0)
        }
        if scene.made, kind != .freeThrow {
            scene.buzzer = NBADetail.buzzer(clock: scene.clock)
            if scene.buzzer, period >= 4, let b = marginBefore, let a = marginAfter, b <= 0, a >= 0 { scene.decisive = true }
            if BasketballFeed.andOne(at: index, in: plays, teams: teams) {
                scene.andOne = true
                scene.fouler = Self.andOneFouler(at: index, in: plays, teams: teams)
            }
            scene.miss = Self.missBefore(index, in: plays, teams: teams, shooter: scene.shooter, kind: scene.kind)
            if kind == .putback || (scene.miss != nil && (scene.distance ?? 99) <= 5) {
                // Up off the rim: a tip or a putback, whatever ESPN calls the finish.
                if scene.miss != nil || putbackTypes.contains(type ?? 0) {
                    if kind != .putback { scene.kind = .putback; scene.shot = .putback }
                    scene.move = .tip
                }
            } else {
                scene.miss = nil
            }
            scene.steal = Self.stealBefore(index, in: plays, teams: teams)
            // What its replay shows besides: the steal before a break, the miss and the board before a putback, the and-one's foul.
            scene.leadIn = [scene.steal?.id, scene.miss?.id, scene.miss?.board].compactMap { $0 }
            if scene.andOne {
                scene.follows = Self.sameClock(after: index, in: plays, limit: 8) { $0["type"]["id"].int == 44 }.map { [$0] } ?? []
            }
        }
        if !scene.made {
            // A miss ends in its rebound (a free throw's only when it's live: a trip's earlier misses are dead, the bookkeeping rebound after them too).
            let last = (scene.attempt ?? 1) >= (scene.attempts ?? 1)
            if kind != .freeThrow || last {
                scene.rebound = Self.reboundAfter(index, in: plays, teams: teams)
            } else if let dead = Self.sameClock(after: index, in: plays, limit: 2, where: { $0["type"]["id"].int == 155 || $0["type"]["id"].int == 156 }) {
                scene.follows = [dead]
            }
            if let id = scene.rebound?.id { scene.follows = [id] }
        }
        return scene
    }

    /// The kind and the move of a field-goal attempt, from ESPN's type (its
    /// words where the number is one it doesn't list, a live placeholder's
    /// distance last).
    static func form(type: Int?, typeText: String, assisted: Bool, distance: Double?) -> (kind: Kind, move: Move) {
        let words = typeText.lowercased()
        switch type {
        case 118?: return (.alleyOop, .cut)
        case 111?: return (.alleyOop, .cut)
        case 138?, 150?, 94?, 125?: return (.putback, .tip)
        case 151?: return (.dunk, .cut)
        case 96?: return (.dunk, assisted ? .cut : .drive)
        case let t? where NBADetail.dunkTypes.contains(t): return (.dunk, .drive)
        case 141?, 142?: return (.layup, .cut)
        case 95?: return (.layup, assisted ? .cut : .drive)
        case let t? where layupTypes.contains(t): return (.layup, .drive)
        case 131?, 133?, 146?, 113?, 134?: return (.jumper, .pullUp)
        case 132?: return (.jumper, .stepBack)
        case 121?, 137?: return (.jumper, .fadeaway)
        case 114?: return (.jumper, .turnaround)
        case 130?, 144?, 145?: return (.jumper, .floater)
        case 93?, 119?, 120?: return (.jumper, .hook)
        case 282?: return (.jumper, .pullUp)
        default:
            if words.contains("alley oop") { return (.alleyOop, .cut) }
            if words.contains("tip") || words.contains("putback") { return (.putback, .tip) }
            if words.contains("dunk") { return (.dunk, assisted ? .cut : .drive) }
            if words.contains("layup") || words.contains("finger roll") { return (.layup, assisted ? .cut : .drive) }
            if words.contains("step back") { return (.jumper, .stepBack) }
            if words.contains("pullup") || words.contains("pull-up") { return (.jumper, .pullUp) }
            if words.contains("fade") { return (.jumper, .fadeaway) }
            if words.contains("float") { return (.jumper, .floater) }
            if words.contains("hook") { return (.jumper, .hook) }
            // A live placeholder ("makes shot"): at the rim, a layup.
            if let distance, distance <= 3 { return (.layup, assisted ? .cut : .drive) }
            return (.jumper, assisted ? .catchAndShoot : .pullUp)
        }
    }

    /// Each participant's part ("shooter", "assister", "blocker", "defender",
    /// "rebounder", "fouler"), in ESPN's order.
    static func roles(_ play: JSON) -> [(id: String?, role: String?, position: String?)] {
        play["participants"].array.map { ($0["athlete"]["id"].string, $0["type"].string, $0["position"]["id"].string) }
    }

    /// ESPN's position (by its ID) as how he plays: point guard, shooting
    /// guard and guard on the arc; the forwards on the wing; the power
    /// forward, the forward-center and the center inside.
    static func role(_ position: String) -> Role? {
        switch position {
        case "1", "2", "3": .guardRole
        case "4", "5", "7": .wing
        case "6", "8", "9": .big
        default: nil
        }
    }

    /// ESPN's distance ("23-foot") as feet; a dunk or a tip at the rim is 1.
    static func distance(_ play: JSON) -> Double? {
        guard let m = (play["text"].string ?? "").firstMatch(of: #/(\d+)-foot/#) else { return nil }
        return Double(m.1)
    }

    /// The names the text gives each part (full names: "Mikel Brown Jr.").
    static func names(_ text: String) -> (shooter: String?, assister: String?, blocker: String?, stealer: String?, loser: String?,
                                          rebounder: String?, fouler: String?) {
        let text = text.replacingOccurrences(of: "\n", with: " ")
        var shooter = text.firstMatch(of: #/^(.+?) (?:makes|misses) /#).map { String($0.1) }
        var blocker: String?
        if let m = text.firstMatch(of: #/^(.+?) blocks (.+?) ?'s /#) {
            blocker = String(m.1)
            shooter = String(m.2)
        }
        let assister = text.firstMatch(of: #/\((.+?) assists\)/#).map { String($0.1) }
        let stealer = text.firstMatch(of: #/\((.+?) steals\)/#).map { String($0.1) }
        let loser = text.firstMatch(of: #/^(.+?) (?:bad pass|lost ball|out of bounds|traveling|offensive|shot clock|3-second|step out|palming|double dribble|discontinued|kicked|backcourt|inbound|turnover|lane violation)/#)
            .map { String($0.1) }
        let rebounder = text.contains("team rebound") ? nil : text.firstMatch(of: #/^(.+?) (?:offensive|defensive) rebound/#).map { String($0.1) }
        let fouler = text.firstMatch(of: #/^(.+?) (?:shooting|personal|loose ball|flagrant)/#).map { String($0.1) }
        return (shooter, assister, blocker, stealer, loser, rebounder, fouler)
    }

    /// The surname a stamp gives a player, his suffix kept: "Mikel Brown Jr."
    /// → "Brown Jr.", "Karl-Anthony Towns" → "Towns", "Ronald Holland II" →
    /// "Holland II". (pure; tested)
    static func surname(_ full: String) -> String {
        let words = full.split(separator: " ").map(String.init)
        guard let last = words.last else { return full }
        if ["Jr.", "Sr.", "Jr", "Sr", "II", "III", "IV", "V"].contains(last), words.count >= 2 { return words[words.count - 2] + " " + last }
        return last
    }

    /// Plays that move something on the court, back from `index` (not including it).
    private static func courtIndices(before index: Int, in plays: [JSON], limit: Int) -> [Int] {
        var out: [Int] = []
        var j = index - 1
        while j >= 0, out.count < limit {
            if !admin.contains(plays[j]["type"]["id"].int ?? 0) { out.append(j) }
            j -= 1
        }
        return out
    }

    private static func elapsed(_ play: JSON) -> Double? {
        guard let period = play["period"]["number"].int else { return nil }
        return NBADetail.elapsed(period: period, clock: play["clock"]["displayValue"].string ?? "")
    }

    /// The miss a make came off: the offensive rebound right before it by the
    /// shooter's team, and the miss before that, within six seconds.
    static func missBefore(_ index: Int, in plays: [JSON], teams: BasketballFeed.Teams, shooter: Person?, kind: Kind) -> Miss? {
        let back = courtIndices(before: index, in: plays, limit: 2)
        guard back.count == 2 else { return nil }
        let play = plays[index], board = plays[back[0]], missed = plays[back[1]]
        let team = play["team"]["id"].string
        guard board["type"]["id"].int == 156, board["team"]["id"].string == team,
              missed["shootingPlay"].bool == true, missed["scoringPlay"].bool != true, !NBADetail.isFreeThrow(missed),
              missed["team"]["id"].string == team, let x = missed["coordinate"]["x"].double, let y = missed["coordinate"]["y"].double,
              x > -1000, y > -1000, let a = elapsed(missed), let b = elapsed(play), b - a <= 6 else { return nil }
        // The putback is the rebounder's: someone else's rebound and a long shot is a kick-out, not a putback.
        let rebounder = roles(board).first?.id
        guard rebounder == nil || rebounder == shooter?.id || kind == .putback else { return nil }
        let form = Self.form(type: missed["type"]["id"].int, typeText: missed["type"]["text"].string ?? "", assisted: false,
                             distance: distance(missed))
        let who = roles(missed).first { $0.role == "shooter" }?.id ?? roles(missed).first?.id
        return Miss(spot: CGPoint(x: x, y: y),
                    shooter: Person(id: who, name: names(missed["text"].string ?? "").shooter.map(surname) ?? ""),
                    value: NBADetail.shotValue(missed, x: x, y: y), close: [.layup, .dunk, .alleyOop, .putback].contains(form.kind),
                    id: missed["id"].string, board: board["id"].string, distance: distance(missed))
    }

    /// The steal a basket came from: the play right before it, a turnover the
    /// scoring team took, within nine seconds.
    static func stealBefore(_ index: Int, in plays: [JSON], teams: BasketballFeed.Teams) -> Steal? {
        guard let j = courtIndices(before: index, in: plays, limit: 1).first,
              let scene = parse(plays, at: j, teams: teams), scene.kind == .steal,
              let side = teams.side(plays[index]["team"]["id"].string), scene.offense == side.opponent,
              let a = elapsed(plays[j]), let b = elapsed(plays[index]), b - a <= 9 else { return nil }
        return scene.steal
    }

    /// The defender on a made basket's and-one: the shooting foul at its clock.
    static func andOneFouler(at index: Int, in plays: [JSON], teams: BasketballFeed.Teams) -> Person? {
        let play = plays[index]
        for next in plays[(index + 1)...].prefix(8) {
            guard next["period"]["number"].int == play["period"]["number"].int,
                  next["clock"]["displayValue"].string == play["clock"]["displayValue"].string else { break }
            guard next["type"]["id"].int == 44 else { continue }
            let id = roles(next).first { $0.role == "fouler" }?.id ?? roles(next).first?.id
            let name = names(next["text"].string ?? "").fouler.map(surname)
            return id == nil && name == nil ? nil : Person(id: id, name: name ?? "")
        }
        return nil
    }

    /// Who got a miss: the first rebound among the next plays, unless the ball went another way first.
    static func reboundAfter(_ index: Int, in plays: [JSON], teams: BasketballFeed.Teams) -> Rebound? {
        var j = index + 1
        var looked = 0
        while j < plays.count, looked < 4 {
            let next = plays[j]
            j += 1
            guard !admin.contains(next["type"]["id"].int ?? 0) else { continue }
            looked += 1
            switch next["type"]["id"].int {
            case 155?, 156?:
                let name = names(next["text"].string ?? "").rebounder
                let entry = roles(next).first
                return Rebound(person: entry?.id == nil && name == nil ? nil
                                   : Person(id: entry?.id, name: name.map(surname) ?? "", role: entry?.position.flatMap(role)),
                               offensive: next["type"]["id"].int == 156, id: next["id"].string)
            case let t? where NBADetail.turnoverTypes.contains(t) || NBADetail.offensiveFoulTypes.contains(t):
                return nil
            default:
                // A foul on the shot, a loose-ball foul: keep looking.
                if next["shootingPlay"].bool == true { return nil }
            }
        }
        return nil
    }

    // MARK: The lighter beats

    /// A turnover's kind, from ESPN's type (its words for the rest).
    static func loss(type: Int, words: String) -> Call {
        switch type {
        case 62: .badPass
        case 63: .lostBall
        case 87, 90: .outOfBounds
        case 64: .traveling
        case 70: .shotClock
        case 73: .offensiveGoaltending
        case 84: .offensive
        default: .other(callWords(words))
        }
    }

    /// A foul's kind, from its type (its words for one it doesn't list);
    /// nil for a play that isn't a foul.
    static func foul(type: Int?, words: String) -> Call? {
        switch type {
        case 44?: return .shooting
        case 45?, 40?: return .personal
        case 43?: return .looseBall
        case 22?: return .take
        case 31?, 32?: return .flagrant
        // Technicals: a defensive three seconds, a double, a flop.
        case 35?, 29?, 30?, 48?: return .technical
        case 42?: return .offensive
        case 24?: return .charge
        default:
            let w = words.lowercased()
            guard w.contains("foul"), !w.contains("turnover") else { return nil }
            return w.contains("offensive") ? .offensive : w.contains("shooting") ? .shooting : w.contains("technical") ? .technical
                : w.contains("flagrant") ? .flagrant : w.contains("loose") ? .looseBall : .personal
        }
    }

    /// A violation the ball stays with the offense on (a kicked ball,
    /// goaltending, a delay); nil for a play that isn't one.
    static func violation(type: Int?, words: String) -> Call? {
        switch type {
        case 12?: return .kickedBall
        case 9?: return .goaltending
        case 8?: return .delay
        default:
            let w = words.lowercased()
            guard w.contains("violation") else { return nil }
            return w.contains("kicked") ? .kickedBall : w.contains("goaltending") ? .goaltending : w.contains("delay") ? .delay
                : .other(callWords(words))
        }
    }

    /// ESPN's type in a tag's words: "Double Dribble Turnover" → "DOUBLE DRIBBLE".
    static func callWords(_ typeText: String) -> String {
        var w = typeText.uppercased().replacingOccurrences(of: "\n", with: " ")
        for tail in [" TURNOVER", " VIOLATION"] where w.hasSuffix(tail) { w.removeLast(tail.count) }
        return w.trimmingCharacters(in: .whitespaces)
    }

    /// A coach's challenge or a referees' review: types 213–216 and
    /// 277–281, the words for any other.
    static func isReview(type: Int?, text: String) -> Bool {
        if let type, (213...216).contains(type) || (277...281).contains(type) { return true }
        let w = text.uppercased()
        return w.contains("CHALLENGE") || w.contains("REVIEW")
    }

    /// The name a play's text leads with: its words up to the first in lower
    /// case ("De'Aaron Fox traveling turnover" → "De'Aaron Fox"); nil when it
    /// leads with none ("shot clock turnover").
    static func leadingName(_ text: String) -> String? {
        var words: [Substring] = []
        for word in text.replacingOccurrences(of: "\n", with: " ").split(separator: " ") {
            guard word.first?.isUppercase == true else { break }
            words.append(word)
        }
        guard let first = words.first, first != "Double" else { return nil }
        return words.joined(separator: " ")
    }

    /// The shot a rebound came off: the newest attempt before it (a field
    /// goal or a free throw; a foul between them aside), where ESPN put it.
    static func shotBefore(_ index: Int, in plays: [JSON]) -> Miss? {
        for j in courtIndices(before: index, in: plays, limit: 3) {
            let shot = plays[j]
            guard shot["shootingPlay"].bool == true else {
                if NBADetail.defensiveFoulTypes.contains(shot["type"]["id"].int ?? 0) { continue }
                return nil
            }
            guard shot["scoringPlay"].bool != true || (shot["scoreValue"].int ?? 1) == 0 else { return nil }
            let free = NBADetail.isFreeThrow(shot)
            let x = shot["coordinate"]["x"].double ?? -1e9, y = shot["coordinate"]["y"].double ?? -1e9
            let spot = free || x < -1000 || y < -1000 ? CGPoint(x: 25, y: 15) : CGPoint(x: x, y: y)
            let close = !free && [.layup, .dunk, .alleyOop, .putback].contains(form(type: shot["type"]["id"].int, typeText: shot["type"]["text"].string ?? "",
                                                                                  assisted: false, distance: distance(shot)).kind)
            let r = roles(shot)
            let who = r.first { $0.role == "shooter" } ?? r.first
            return Miss(spot: spot, shooter: Person(id: who?.id, name: names(shot["text"].string ?? "").shooter.map(surname) ?? "",
                                                    role: who?.position.flatMap(role)),
                        value: free ? 1 : NBADetail.shotValue(shot, x: spot.x, y: spot.y), close: close, id: shot["id"].string,
                        blocked: r.contains { $0.role == "blocker" }, freeThrow: free,
                        distance: free ? 14 : distance(shot) ?? Double(hypot(spot.x - 25, spot.y - 1.25)).rounded())
        }
        return nil
    }

    /// The free throws a whistle gave, at its clock, by the other team: who
    /// shot them, and how many the trip is.
    static func freeThrows(after index: Int, in plays: [JSON]) -> (shooter: Person?, attempts: Int?) {
        let play = plays[index]
        for next in plays[(index + 1)...].prefix(12) {
            guard next["period"]["number"].int == play["period"]["number"].int,
                  next["clock"]["displayValue"].string == play["clock"]["displayValue"].string else { break }
            guard next["shootingPlay"].bool == true, NBADetail.isFreeThrow(next),
                  next["team"]["id"].string != play["team"]["id"].string else { continue }
            let r = roles(next).first
            let person = Person(id: r?.id, name: names(next["text"].string ?? "").shooter.map(surname) ?? "", role: r?.position.flatMap(role))
            return (person, trip(type: next["type"]["id"].int, text: next["text"].string ?? "").1)
        }
        return (nil, nil)
    }

    /// The first play after `index` at its period and clock (within `limit`) that `match`es: its ID.
    static func sameClock(after index: Int, in plays: [JSON], limit: Int, where match: (JSON) -> Bool) -> String? {
        let play = plays[index]
        for next in plays[(index + 1)...].prefix(limit) {
            guard next["period"]["number"].int == play["period"]["number"].int,
                  next["clock"]["displayValue"].string == play["clock"]["displayValue"].string else { break }
            if match(next) { return next["id"].string }
        }
        return nil
    }

    /// A free throw's place in its trip: by its type (98 is 1 of 2), else its
    /// words ("flagrant 1 of 2"); a technical stands alone.
    static func trip(type: Int?, text: String) -> (Int?, Int?) {
        switch type {
        case 97?: return (1, 1)
        case 98?: return (1, 2)
        case 99?: return (2, 2)
        case 100?: return (1, 3)
        case 101?: return (2, 3)
        case 102?: return (3, 3)
        default:
            if let m = text.firstMatch(of: #/(\d) of (\d)/#) { return (Int(m.1), Int(m.2)) }
            return type == 103 || text.lowercased().contains("technical") ? (1, 1) : (nil, nil)
        }
    }

    /// The trip's last free throw ("2 of 2"), not a technical.
    private static func isLastFreeThrowOfTrip(_ play: JSON) -> Bool {
        play["type"]["id"].int != 103 && NBADetail.isLastFreeThrow(play)
    }

    /// "2026-10-27T23:41:17Z". (Formatters are costly to make: one, reused.)
    private static func parseDate(_ s: String) -> Date? { wallclock.date(from: s) }

    nonisolated(unsafe) private static let wallclock = ISO8601DateFormatter()
}
