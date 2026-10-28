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
// What replays: every made field goal, every block, and a shot to tie or take
// the lead in the last 30 seconds of the fourth or overtime that missed (or
// a free throw that tied it or won the lead). A steal is the lead-in to the
// basket it led to, an offensive rebound the lead-in to its putback: neither
// replays alone. Free throws otherwise don't: a basket every 20–30 seconds is
// enough to watch.

struct BasketballScene: Equatable, Identifiable {
    enum Kind: Equatable {
        case jumper, three, layup, dunk, alleyOop, putback, freeThrow
        /// A shot swatted away (`shot` says what was tried).
        case block
        /// The ball taken by a defender; lost without one.
        case steal, turnover
        case offensiveRebound
    }

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

    /// Someone in on it: ESPN's athlete ID and the name the stamp gives him ("Brown Jr.").
    struct Person: Equatable {
        var id: String?
        var name: String
    }

    /// The missed shot a putback came off: where, by whom, for how many.
    struct Miss: Equatable {
        var spot: CGPoint
        var shooter: Person?
        var value: Int
        /// It was a layup or a dunk (it goes up from the rim, not the arc).
        var close: Bool
    }

    /// The steal a fast break came from, at its spot (in ESPN's feet toward
    /// the basket of the team that lost it: the far end).
    struct Steal: Equatable {
        var spot: CGPoint?
        var loser: Person?
        var stealer: Person?
    }

    /// Who got the ball after a miss or a block, from the next play: nil
    /// person for a team rebound.
    struct Rebound: Equatable {
        var person: Person?
        var offensive: Bool
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

    /// A dunk through the defender who fouled him: the data credits him.
    var posterized: Bool { dunk && andOne && fouler != nil && result == .make }

    var made: Bool { result == .make }

    /// The team without the ball.
    var defense: GameDetail.Side? { offense?.opponent }

    /// Whether the theater replays it (see the file's note). (pure; tested)
    var replays: Bool {
        switch kind {
        case .jumper, .three, .layup, .dunk, .alleyOop, .putback:
            return spot != nil && (made || lastShot)
        case .block:
            return spot != nil
        case .freeThrow:
            return made && lastShot
        case .steal, .turnover, .offensiveRebound:
            return false
        }
    }
}

/// What the basketball theater shows: the newest play worth replaying, and
/// whether to replay it.
struct BasketballTheaterState: Equatable {
    var scene: BasketballScene?
    /// Arrived while the page was open, or only just happened: replay it.
    var news = false
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

    /// The play at `index` of `plays` (in ESPN's order) as a scene; nil for a
    /// play that moves nothing on the court (a foul, a substitution, a
    /// defensive rebound, a period's end).
    static func parse(_ plays: [JSON], at index: Int, teams: BasketballFeed.Teams) -> BasketballScene? {
        guard plays.indices.contains(index) else { return nil }
        let play = plays[index]
        guard let id = play["id"].string else { return nil }
        let type = play["type"]["id"].int
        let text = NBADetail.plain(play["text"].string ?? "").replacingOccurrences(of: " 's ", with: "'s ")
        let raw = play["text"].string ?? ""
        let roles = Self.roles(play)
        let kind: Kind, move: Move
        var shot: Kind?
        var result = Result.miss
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
        } else if type == 156 {
            (kind, move) = (.offensiveRebound, .tip)
        } else if let type, NBADetail.turnoverTypes.contains(type) {
            (kind, move) = (roles.contains { $0.role == "defender" } || NBADetail.participants(play).count > 1 ? .steal : .turnover, .drive)
        } else {
            return nil
        }

        var scene = BasketballScene(id: id, kind: kind, shot: shot, move: move, result: result)
        scene.offense = teams.side(play["team"]["id"].string)
        scene.typeID = type
        scene.typeText = (play["type"]["text"].string ?? "").replacingOccurrences(of: "\n", with: " ")
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
            let id = roles.first { $0.role == role }?.id ?? fallback.flatMap { i in i < roles.count && roles[i].role == nil ? roles[i].id : nil }
            guard id != nil || named != nil else { return nil }
            return Person(id: id, name: named.map(surname) ?? "")
        }
        let names = Self.names(raw)
        switch kind {
        case .steal, .turnover:
            scene.shooter = person("offense", 0, named: names.loser)
            scene.steal = Steal(spot: scene.spot, loser: scene.shooter, stealer: kind == .steal ? person("defender", 1, named: names.stealer) : nil)
        case .offensiveRebound:
            scene.shooter = person("rebounder", 0, named: names.rebounder)
        default:
            scene.shooter = person("shooter", 0, named: names.shooter)
            scene.assister = scene.made ? person("assister", 1, named: names.assister) : nil
            scene.blocker = result == .blocked ? person("blocker", 1, named: names.blocker) : nil
        }
        guard shot != nil else { return scene }

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
        }
        if !scene.made, kind != .freeThrow { scene.rebound = Self.reboundAfter(index, in: plays, teams: teams) }
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
    static func roles(_ play: JSON) -> [(id: String?, role: String?)] {
        play["participants"].array.map { ($0["athlete"]["id"].string, $0["type"].string) }
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
                    value: NBADetail.shotValue(missed, x: x, y: y), close: [.layup, .dunk, .alleyOop, .putback].contains(form.kind))
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
                let id = roles(next).first?.id
                return Rebound(person: id == nil && name == nil ? nil : Person(id: id, name: name.map(surname) ?? ""),
                               offensive: next["type"]["id"].int == 156)
            case let t? where NBADetail.turnoverTypes.contains(t) || NBADetail.offensiveFoulTypes.contains(t):
                return nil
            default:
                // A foul on the shot, a loose-ball foul: keep looking.
                if next["shootingPlay"].bool == true { return nil }
            }
        }
        return nil
    }

    /// The trip's last free throw ("2 of 2"), not a technical.
    private static func isLastFreeThrowOfTrip(_ play: JSON) -> Bool {
        play["type"]["id"].int != 103 && NBADetail.isLastFreeThrow(play)
    }

    /// "2026-10-27T23:41:17Z". (Formatters are costly to make: one, reused.)
    private static func parseDate(_ s: String) -> Date? { wallclock.date(from: s) }

    nonisolated(unsafe) private static let wallclock = ISO8601DateFormatter()
}
