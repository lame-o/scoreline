import CoreGraphics
import Foundation

// The play theater's model: one play on the field (a plate appearance's
// result, or a runner's play between pitches), parsed from ESPN's
// play-by-play into what the theater replays: the kind of play and the
// ball's flight, who handled it in scorer's numbers (6-4-3), where every
// runner went, the outs and runs, the pitch and the batter's side. Pure
// values: the parser is tested against real plays, and the replay is a
// function of the scene and time.
//
// ESPN gives each at-bat a run of entries sharing an `atBatId`: pitches
// (`summaryType` "P"; their participants are the runners as the pitch is
// thrown) and a result (`play-result`; its participants are the runners
// after it). Runners are matched by athlete ID across the two, so the
// movements never depend on reading names; the text only settles who scored
// and who was out when both happened on one play.
//
// A plate appearance can also carry what MLB's Statcast measured of it (the
// ball's launch and distance, the deciding pitch's flight), matched by
// half-inning, batter and trip to the plate. The parse never needs it: the
// theater replays ESPN's account alone until it's there.

struct PlayScene: Equatable, Identifiable {
    enum Kind: Equatable {
        case single, double, triple, homeRun
        case groundOut, flyOut, lineOut, popOut, foulOut
        case fieldersChoice, doublePlay, triplePlay
        case sacrificeFly, sacrificeBunt, error
        case strikeout(looking: Bool)
        case walk(intentional: Bool), hitByPitch
        /// Runners only, between pitches.
        case stolenBase, caughtStealing, pickoff, wildPitch, passedBall, balk, indifference
        /// A play we can't name: the ball goes to its spot, the runners to theirs.
        case other
    }

    /// ESPN's `trajectory`.
    enum Trajectory: String {
        case ground = "G", line = "L", fly = "F", popUp = "P"
    }

    enum Hand: String {
        case left = "L", right = "R"
    }

    /// The pitch that decided it.
    struct Pitch: Equatable {
        /// "FF".
        var code: String?
        /// "Four-seam FB".
        var name: String?
        var mph: Int?
        /// ESPN pitch coordinates (zone ≈ x 91…141, y 148…192).
        var x: Double?
        var y: Double?
    }

    /// What MLB's Statcast measured of a plate appearance: the ball off the
    /// bat (exit velocity, launch angle, distance, spot) and the pitch that
    /// decided it, as tracked; and how its official scorer recorded the
    /// play: every runner's legs and every fielder's part.
    struct Measured: Equatable {
        var batted: Statcast.Batted?
        var pitch: Statcast.Pitch?
        var movements: [Statcast.Movement] = []
    }

    /// A plate appearance as MLB's feed has it: the half-inning, the batter's
    /// surname, and which of his trips to the plate in that half it is (a
    /// team that bats around sends him up twice).
    struct Appearance: Equatable {
        var inning: Int
        var top: Bool
        var surname: String
        var occurrence = 0
        /// A runner's play during it: which of the at-bat's it was (nil: its result).
        var runnerPlay: Int? = nil
    }

    /// Where the play took a runner (or the batter, from base 0).
    struct Runner: Equatable {
        enum End: Equatable {
            case base(Int)
            case scored
            /// Out at a base (0: home), or where the ball was caught (nil).
            case out(at: Int?)
        }
        var id: String?
        var from: Int
        var end: End
        /// Which out of the inning he was (MLB's official account only).
        var outNumber: Int?
        /// The base he waited at until a throw got away or went elsewhere,
        /// then went on (MLB's official account only).
        var waits: Int?

        var isOut: Bool { if case .out = end { return true }; return false }
    }

    /// A catch made at full stretch, as the scorer's text tells it.
    enum Effort: Equatable {
        case diving, leaping
    }

    /// The scorer's mark for the play: "6-3", "F8", "6-4-3 DP". A called
    /// third strike is a K drawn backwards.
    struct Notation: Equatable, CustomStringConvertible {
        var code: String
        var backwards = false
        var description: String { backwards ? "ꓘ" : code }
    }

    let id: String
    var kind: Kind
    var trajectory: Trajectory?
    /// Where the ball was fielded or landed, in ESPN hit coordinates (home
    /// plate ≈ (125, 205), the fence ≈ 165 out: the spray chart's calibration).
    var spot: CGPoint?
    /// Feet, when ESPN says ("homered to center (408 feet)").
    var distance: Int?
    /// Who handled the ball, in order, by scorer's number (6-4-3).
    var fielders: [Int] = []
    /// The fielder charged with an error.
    var error: Int?
    /// Diving or leaping for it, when the text says so.
    var effort: Effort?
    /// Every runner on the play, the batter first (from 0).
    var runners: [Runner] = []
    var outsBefore = 0
    var outsAfter = 0
    var runs = 0
    var bats: Hand?
    var pitch: Pitch?
    /// Who batted, to find the play in Statcast (nil: a runner's play).
    var appearance: Appearance?
    /// A runner's play: the plate appearance it came during, to find its legs in MLB's feed.
    var during: Appearance?
    /// What Statcast measured, once it's been found.
    var measured: Measured?
    var batting: GameDetail.Side?
    /// "Turang grounded out to shortstop."
    var text = ""
    var wallclock: Date?
    /// The home team went ahead in the bottom of the 9th or later: the game ends on it.
    var walkOff = false

    var batter: Runner? { runners.first { $0.from == 0 } }
    /// Bases taken before the play (first, second, third).
    var basesBefore: [Bool] { (1...3).map { base in runners.contains { $0.from == base } } }
    /// Bases taken after it.
    var basesAfter: [Bool] { (1...3).map { base in runners.contains { $0.end == .base(base) } } }
    /// The half-inning ended on this play: the teams change sides.
    var endsInning: Bool { outsAfter >= 3 }

    /// A play the batter put in play: the ball leaves the bat.
    var inPlay: Bool {
        switch kind {
        case .single, .double, .triple, .homeRun, .groundOut, .flyOut, .lineOut, .popOut, .foulOut,
             .fieldersChoice, .doublePlay, .triplePlay, .sacrificeFly, .sacrificeBunt, .error:
            true
        case .other:
            spot != nil
        default:
            false
        }
    }

    /// The flight, from ESPN when it says, else from the kind.
    var flight: Trajectory {
        if let trajectory { return trajectory }
        switch kind {
        case .groundOut, .fieldersChoice, .doublePlay, .sacrificeBunt, .error: return .ground
        case .flyOut, .sacrificeFly, .triple, .homeRun, .foulOut: return .fly
        case .popOut: return .popUp
        default: return .line
        }
    }

    var notation: Notation {
        // ESPN's chain, else (for a mark that prints one) the one MLB credits: a pickoff into a rundown, "CS 1-3-6-4".
        let charted: [Kind] = [.groundOut, .fieldersChoice, .doublePlay, .triplePlay, .sacrificeBunt, .caughtStealing, .pickoff]
        let fielders = self.fielders.isEmpty && charted.contains(kind) ? handling?.credited ?? [] : self.fielders
        let chain = fielders.map(String.init).joined(separator: "-")
        let first = fielders.first.map(String.init) ?? ""
        func tagged(_ tag: String) -> String { chain.isEmpty ? tag : "\(tag) \(chain)" }
        switch kind {
        // A hit the batter stretched on an error carries it: "1B E5".
        case .single: return Notation(code: error.map { "1B E\($0)" } ?? "1B")
        case .double: return Notation(code: error.map { "2B E\($0)" } ?? "2B")
        case .triple: return Notation(code: error.map { "3B E\($0)" } ?? "3B")
        case .homeRun: return Notation(code: "HR")
        case .groundOut: return Notation(code: fielders.count == 1 ? "\(first)U" : chain.isEmpty ? "GO" : chain)
        case .flyOut: return Notation(code: "F\(first)")
        case .lineOut: return Notation(code: "L\(first)")
        case .popOut: return Notation(code: "P\(first)")
        case .foulOut: return Notation(code: (trajectory == .popUp ? "P" : "F") + first)
        case .fieldersChoice: return Notation(code: tagged("FC"))
        case .doublePlay, .triplePlay:
            // A ball caught in the air leads with its catch: "L6-3 DP".
            let air: String = switch flight { case .line: "L"; case .fly: "F"; case .popUp: "P"; case .ground: "" }
            return Notation(code: "\(air)\(chain.isEmpty ? "" : chain + " ")\(kind == .doublePlay ? "DP" : "TP")")
        case .sacrificeFly: return Notation(code: "SF\(first)")
        case .sacrificeBunt: return Notation(code: tagged("SAC"))
        case .error: return Notation(code: "E\(error.map(String.init) ?? first)")
        // Strike three dropped and thrown to first: "K 2-3" (the backwards K stays a K alone: it's drawn mirrored).
        case let .strikeout(looking): return Notation(code: !looking && fielders == [2, 3] ? "K 2-3" : "K", backwards: looking)
        case let .walk(intentional): return Notation(code: intentional ? "IBB" : "BB")
        case .hitByPitch: return Notation(code: "HBP")
        // A steal the catcher's wild throw let go on: "SB E2".
        case .stolenBase: return Notation(code: error.map { "SB E\($0)" } ?? "SB")
        case .caughtStealing: return Notation(code: tagged("CS"))
        case .pickoff: return Notation(code: tagged("PO"))
        case .wildPitch: return Notation(code: "WP")
        case .passedBall: return Notation(code: "PB")
        case .balk: return Notation(code: "BK")
        case .indifference: return Notation(code: "DI")
        case .other: return Notation(code: "")
        }
    }

    /// What Statcast measured of the ball in play, as the stamp's third
    /// line has it: "104.4 MPH · 12° · 273 FT" (a grounder's distance is
    /// only its first hop, so it's left off). Nil unless it was measured.
    var readout: String? {
        guard inPlay, let batted = measured?.batted, batted.launchSpeed != nil else { return nil }
        return batted.line(distance: batted.trajectory != "ground_ball" && flight != .ground)
    }

    /// The play in two or three words, for the stamp's second line.
    var title: String {
        switch kind {
        case .single: "Single"
        case .double: "Double"
        case .triple: "Triple"
        case .homeRun: runs == 4 ? "Grand slam" : "Home run"
        case .groundOut: "Groundout"
        case .flyOut: "Flyout"
        case .lineOut: "Lineout"
        case .popOut: "Pop out"
        case .foulOut: "Foul out"
        case .fieldersChoice: runners.contains(where: \.isOut) ? "Force out" : "Fielder's choice"
        case .doublePlay: "Double play"
        case .triplePlay: "Triple play"
        case .sacrificeFly: "Sacrifice fly"
        case .sacrificeBunt: "Sacrifice bunt"
        case .error: "Error"
        case let .strikeout(looking): looking ? "Strikeout looking" : "Strikeout swinging"
        case let .walk(intentional): intentional ? "Intentional walk" : "Walk"
        case .hitByPitch: "Hit by pitch"
        case .stolenBase: "Stolen base"
        case .caughtStealing: text.contains("picked off") ? "Picked off" : "Caught stealing"
        case .pickoff: "Picked off"
        case .wildPitch: "Wild pitch"
        case .passedBall: "Passed ball"
        case .balk: "Balk"
        case .indifference: "Defensive indifference"
        case .other: ""
        }
    }
}

/// What the play theater shows: the last play on the field and who's up now.
struct TheaterState: Equatable {
    var play: PlayScene?
    /// Arrived while the page was open, or only just happened: replay it.
    /// Otherwise it's history, and shows as it ended.
    var news = false
    /// The batter at the plate by the side he stands on; nil between innings.
    var bats: PlayScene.Hand?
    /// A pitch since the play: the next at-bat is under way, so the field
    /// shows the live scene, not how the play ended.
    var cleared = false
    /// The game in order, the newest last: every pitch, the plays (by ID),
    /// what happened between (PlayBeat.swift). Empty until the live lane has spoken.
    var timeline: [PlayBeat] = []
    /// When the feeds last brought anything: the heartbeat counts from here.
    var updated: Date?
    /// The game is held up as the feeds have it now (MLB's status, ESPN's): a rain delay's tarp.
    var delay: PlayBeat.Delay?

    init(play: PlayScene? = nil, news: Bool = false, bats: PlayScene.Hand? = nil, cleared: Bool = false, timeline: [PlayBeat] = [],
         updated: Date? = nil, delay: PlayBeat.Delay? = nil) {
        self.play = play
        self.news = news
        self.bats = bats
        self.cleared = cleared
        self.timeline = timeline
        self.updated = updated
        self.delay = delay
    }
}

// MARK: - Parsing

extension PlayScene {
    /// The newest play on the field in a run of plays (lineup changes and
    /// the inning's bookkeeping aren't plays).
    static func latest(in plays: [JSON], side: (String?) -> GameDetail.Side?, names: [String: String] = [:]) -> PlayScene? {
        for index in plays.indices.reversed() where plays[index]["type"]["type"].string == "play-result" {
            if let scene = parse(plays, at: index, side: side, names: names) { return scene }
        }
        return nil
    }

    /// The theater's state after these plays: the newest play, and the batter
    /// up after it (the same batter when it was a runner's play mid-at-bat).
    static func theater(_ plays: [JSON], side: (String?) -> GameDetail.Side?, names: [String: String] = [:]) -> TheaterState {
        guard let play = latest(in: plays, side: side, names: names),
              let index = plays.lastIndex(where: { $0["id"].string == play.id }) else {
            return TheaterState(bats: plays.last { $0["bats"].exists }.flatMap(hand))
        }
        let after = plays[(index + 1)...]
        let next = after.last { $0["type"]["type"].string == "start-batterpitcher" || $0["summaryType"].string == "P" }
        let bats = next.flatMap(hand) ?? (play.batter == nil && !play.endsInning ? play.bats : nil)
        let pitched = after.contains { $0["pitchCoordinate"].exists && ($0["summaryType"].string == "P" || ($0["text"].string ?? "").hasPrefix("Pitch")) }
        return TheaterState(play: play, bats: bats, cleared: pitched)
    }

    /// The play-result at `index`, with what led to it. Nil for anything that
    /// isn't a play on the field.
    static func parse(_ plays: [JSON], at index: Int, side: (String?) -> GameDetail.Side?,
                      names: [String: String] = [:]) -> PlayScene? {
        let result = plays[index]
        guard result["type"]["type"].string == "play-result", let id = result["id"].string,
              let kind = kind(result["alternativeType"]["type"].string ?? "", text: result["text"].string ?? "",
                              doublePlay: result["doublePlay"].bool == true, triplePlay: result["triplePlay"].bool == true)
        else { return nil }
        let atBat = result["atBatId"].string
        let half = halfInning(result)

        // Back through the plays: the at-bat's entries (newest first), and the
        // play before this one in the half-inning, for the outs before it.
        var earlier: [JSON] = []
        var previous: JSON?
        var previousKnown = false
        for i in stride(from: index - 1, through: 0, by: -1) {
            let entry = plays[i]
            let sameAtBat = atBat != nil && entry["atBatId"].string == atBat
            if sameAtBat { earlier.append(entry) }
            if !previousKnown {
                if isPlay(entry) {
                    if halfInning(entry) == half { previous = entry }
                    previousKnown = true
                } else if entry["type"]["type"].string == "start-inning" {
                    previousKnown = true
                }
            }
            if previousKnown, !sameAtBat { break }
        }
        let pitchEntry = earlier.first { $0["summaryType"].string == "P" }

        var scene = PlayScene(id: id, kind: kind)
        scene.text = result["text"].string ?? ""
        scene.batting = side(result["team"]["id"].string)
        scene.trajectory = (result["trajectory"].string ?? pitchEntry?["trajectory"].string).flatMap(Trajectory.init(rawValue:))
        let hit = result["hitCoordinate"].exists ? result["hitCoordinate"] : pitchEntry?["hitCoordinate"] ?? JSON(nil)
        if scene.inPlay || kind == .other, let x = hit["x"].double, let y = hit["y"].double {
            scene.spot = CGPoint(x: x, y: y)
        }
        if !scene.inPlay { scene.trajectory = nil }
        scene.distance = scene.text.firstMatch(of: #/\((\d+) feet\)/#).flatMap { Int($0.1) }
        scene.bats = hand(result) ?? pitchEntry.flatMap(hand)
        if let p = pitchEntry {
            let code = p["pitchType"]["abbreviation"].string
            scene.pitch = Pitch(code: code, name: p["pitchType"]["text"].string ?? code.flatMap { GameDetail.Pitch.names[$0] },
                                mph: p["pitchVelocity"].int, x: p["pitchCoordinate"]["x"].double, y: p["pitchCoordinate"]["y"].double)
        }
        scene.appearance = appearance(plays, at: index, text: scene.text, names: names)
        if scene.appearance == nil { scene.during = during(plays, at: index, earlier: earlier, names: names) }
        scene.wallclock = result["wallclock"].string.flatMap(parseDate)
        scene.runs = max(result["scoreValue"].int ?? 0, 0)
        scene.walkOff = scene.runs > 0 && walkOff(result)
        scene.outsAfter = min(max(result["outs"].int ?? 0, 0), 3)

        // Fielders: the scorer's version names every one in order; the short
        // text (all the summary carries) names the first, and a relay.
        let scorer = result["shortAlternativeText"].string.map(fieldersFromScorer) ?? ([], nil)
        let short = fieldersFromText(scene.text)
        scene.fielders = scorer.0.isEmpty ? short.0 : scorer.0
        scene.error = scorer.1 ?? short.1
        if scene.inPlay { scene.effort = effort(scene.text + " " + (result["shortAlternativeText"].string ?? "")) }
        // A ground ball (or a bunt) the text credits to one infielder went on to first.
        if [.groundOut, .doublePlay, .sacrificeBunt].contains(kind), scene.flight == .ground, scene.fielders.count == 1,
           scene.fielders[0] != 3, !scene.text.contains("unassisted") {
            scene.fielders.append(3)
        }

        // Runners: before from the entry nearest the result (a pitch's
        // participants, or a runner's play earlier in the at-bat), after from
        // the result itself.
        let before = earlier.first { e in
            e["summaryType"].string == "P" || e["type"]["type"].string == "start-batterpitcher" || isPlay(e)
        }.map(bases) ?? previous.map(bases) ?? [:]
        let made = expectedOuts(kind)
        scene.outsBefore = previous.map { min(max($0["outs"].int ?? 0, 0), 2) } ?? max(scene.outsAfter - made, 0)
        // A count that doesn't add up (a rewritten entry): trust the kind.
        if made > 0, scene.outsBefore >= scene.outsAfter { scene.outsBefore = max(scene.outsAfter - made, 0) }
        scene.runners = movements(kind: kind, air: scene.inPlay && scene.flight != .ground, before: before, after: bases(result),
                                  batter: participant(result, "batter"), outs: scene.outsAfter - scene.outsBefore,
                                  runs: scene.runs, text: scene.text, names: names)
        // A force the text credits to one fielder: whoever covered the base took the throw.
        if kind == .fieldersChoice, scene.fielders.count == 1,
           let base = scene.runners.lazy.compactMap({ r -> Int? in if case let .out(at?) = r.end, r.from > 0 { return at }; return nil }).first {
            scene.fielders.append(coverer(of: base, after: scene.fielders[0]))
        }
        return scene
    }

    /// The plate appearance a result closes: its half-inning, the batter's
    /// surname (from the box score's names, else the text's opening words),
    /// and how many trips he'd already made in that half. Nil for a runner's
    /// play: nobody batted.
    static func appearance(_ plays: [JSON], at index: Int, text: String, names: [String: String], batter: String? = nil) -> Appearance? {
        let result = plays[index]
        guard let batter = batter ?? participant(result, "batter"), let inning = result["period"]["number"].int,
              let name = names[batter].map(surname) ?? leadingName(text) else { return nil }
        let half = halfInning(result)
        // His earlier at-bats in the half-inning, by ID (a result ESPN rewrote is still one).
        var earlier = Set<String>()
        for entry in plays[..<index].reversed() {
            guard halfInning(entry) == half, entry["type"]["type"].string != "start-inning" else { break }
            if entry["type"]["type"].string == "play-result", participant(entry, "batter") == batter,
               let id = entry["atBatId"].string ?? entry["id"].string, id != result["atBatId"].string {
                earlier.insert(id)
            }
        }
        return Appearance(inning: inning, top: result["period"]["type"].string?.lowercased().hasPrefix("top") ?? true,
                          surname: name, occurrence: earlier.count)
    }

    /// A runner's play (a steal, a wild pitch): the plate appearance it came
    /// during (its batter from the at-bat's pitches, his name from the box
    /// score's), and which of the at-bat's runner's plays it is.
    static func during(_ plays: [JSON], at index: Int, earlier: [JSON], names: [String: String]) -> Appearance? {
        guard let batter = earlier.lazy.compactMap({ participant($0, "batter") }).first, names[batter] != nil,
              var appearance = appearance(plays, at: index, text: "", names: names, batter: batter) else { return nil }
        appearance.runnerPlay = earlier.filter { isPlay($0) && participant($0, "batter") == nil }.count
        return appearance
    }

    /// A short name's surname: "J. Chourio" → "Chourio"; "V. Mesa Jr." → "Mesa Jr".
    static func surname(_ name: String) -> String {
        let rest = name.split(separator: " ").drop { $0.hasSuffix(".") && $0.count <= 3 }
        return (rest.isEmpty ? name : rest.joined(separator: " ")).trimmingCharacters(in: CharacterSet(charactersIn: "."))
    }

    /// The name a result's text opens with: "Mesa Jr. lined out to center." → "Mesa Jr".
    static func leadingName(_ text: String) -> String? {
        let words = text.split(separator: " ").prefix { $0.first?.isUppercase == true }
        return words.isEmpty ? nil : surname(words.joined(separator: " "))
    }

    /// Who takes a throw at a base (0: home) from a fielder: the first
    /// baseman at first, the middle infielder not fielding it at second, the
    /// third baseman at third, the catcher at home; the pitcher when the
    /// usual man threw it.
    static func coverer(of base: Int, after fielder: Int) -> Int {
        switch base {
        case 1: fielder == 3 ? 1 : 3
        case 2: [4, 3, 9].contains(fielder) ? 6 : 4
        case 3: fielder == 5 ? 6 : 5
        default: fielder == 2 ? 1 : 2
        }
    }

    /// A result that's a play on the field (not a lineup change).
    static func isPlay(_ entry: JSON) -> Bool {
        entry["type"]["type"].string == "play-result" && kind(entry["alternativeType"]["type"].string ?? "", text: "",
                                                               doublePlay: false, triplePlay: false) != nil
    }

    /// The result's kind, from ESPN's structured type; nil for a play that
    /// isn't one on the field (a substitution).
    static func kind(_ type: String, text: String, doublePlay: Bool, triplePlay: Bool) -> Kind? {
        let t = type.lowercased()
        if t.isEmpty || ["lineup", "substitut", "pitching-change", "defensive-switch", "start-", "end-"].contains(where: t.contains) {
            return nil
        }
        if triplePlay || t.contains("triple-play") { return .triplePlay }
        // A strikeout with a runner thrown out is still the batter's strikeout.
        if t.hasPrefix("strike") || t.contains("missed-bunt") || t.contains("strikeout") {
            return .strikeout(looking: t.contains("looking") || text.contains("called out on strikes") || text.contains("struck out looking"))
        }
        if doublePlay || t.contains("double-play") { return .doublePlay }
        if t.contains("intent") { return .walk(intentional: true) }
        if t.hasPrefix("ball") || t.contains("walk") { return .walk(intentional: false) }
        if t.contains("hit-by-pitch") { return .hitByPitch }
        if t.contains("home-run") { return .homeRun }
        if t.contains("triple") { return .triple }
        if t.contains("double") { return .double }
        if t.contains("single") { return .single }
        if t.contains("sacrifice-fly") || t.contains("sac-fly") { return .sacrificeFly }
        if t.contains("sacrifice") || t.contains("sac-bunt") { return .sacrificeBunt }
        if t.contains("fielders-choice") { return .fieldersChoice }
        if t.contains("caught-stealing") { return .caughtStealing }
        if t.contains("error") { return .error }
        if t.contains("ground-out") || t.contains("groundout") { return .groundOut }
        if t.contains("fly-out") || t.contains("flyout") { return .flyOut }
        if t.contains("line-out") || t.contains("lineout") { return .lineOut }
        if t.contains("pop-out") || t.contains("popout") { return .popOut }
        if t.contains("foul-out") { return .foulOut }
        if t.contains("stolen-base") || t.contains("steal") { return .stolenBase }
        if t.contains("pickoff") || t.contains("picked-off") { return .pickoff }
        if t.contains("wild-pitch") { return .wildPitch }
        if t.contains("passed-ball") { return .passedBall }
        if t.contains("balk") { return .balk }
        if t.contains("indifference") { return .indifference }
        return .other
    }

    /// Outs a play of this kind makes, when the play before isn't at hand.
    static func expectedOuts(_ kind: Kind) -> Int {
        switch kind {
        case .groundOut, .flyOut, .lineOut, .popOut, .foulOut, .fieldersChoice, .sacrificeFly, .sacrificeBunt,
             .strikeout, .caughtStealing, .pickoff:
            1
        case .doublePlay: 2
        case .triplePlay: 3
        default: 0
        }
    }

    /// Scorer's numbers by the scorer's names for the positions.
    static let positions: [(String, Int)] = [
        ("pitcher", 1), ("catcher", 2), ("first baseman", 3), ("second baseman", 4), ("third baseman", 5),
        ("shortstop", 6), ("left fielder", 7), ("center fielder", 8), ("right fielder", 9),
    ]

    /// "grounds out, shortstop Taylor Walls to first baseman Ryan Vilade" → [6, 3].
    /// A deflection isn't a fielding credit; the fielder named for an error
    /// is the error, not the chain.
    static func fieldersFromScorer(_ text: String) -> ([Int], Int?) {
        var found: [(at: String.Index, number: Int)] = []
        for (name, number) in positions {
            var search = text.startIndex..<text.endIndex
            while let range = text.range(of: name, range: search) {
                found.append((range.lowerBound, number))
                search = range.upperBound..<text.endIndex
            }
        }
        var chain: [Int] = []
        var error: Int?
        for (at, number) in found.sorted(by: { $0.at < $1.at }) {
            let lead = text[text.index(at, offsetBy: -min(text.distance(from: text.startIndex, to: at), 14))..<at]
            if lead.hasSuffix("error by ") { error = error ?? number; continue }
            if lead.hasSuffix("deflected by ") { continue }
            if chain.last != number { chain.append(number) }
        }
        return (chain, error)
    }

    /// "…on a diving catch", "leaping catch at the wall": the fielder at full stretch.
    static func effort(_ text: String) -> Effort? {
        let t = text.lowercased()
        if ["diving", "dives", "sliding catch"].contains(where: t.contains) { return .diving }
        if ["leaping", "leaps", "jumping"].contains(where: t.contains) { return .leaping }
        return nil
    }

    /// The short text's positions: "Turang grounded out to shortstop." → [6];
    /// a relay clause, "…, second to shortstop to first, …" → [4, 6, 3].
    static func fieldersFromText(_ text: String) -> ([Int], Int?) {
        let words: [String: Int] = ["pitcher": 1, "catcher": 2, "first": 3, "second": 4, "third": 5, "shortstop": 6,
                                    "left": 7, "center": 8, "right": 9, "left center": 8, "right center": 8]
        let parts = clauses(text)
        var error: Int?
        if let m = text.firstMatch(of: #/error by (pitcher|catcher|first baseman|second baseman|third baseman|shortstop|left fielder|center fielder|right fielder)/#) {
            error = positions.first { $0.0 == String(m.1) }?.1
        }
        for clause in parts.dropFirst() {
            let steps = clause.components(separatedBy: " to ")
            let numbers = steps.compactMap { words[$0] }
            if steps.count >= 2, numbers.count == steps.count { return (numbers, error) }
        }
        guard let first = parts.first,
              let m = first.firstMatch(of: #/(?:to|by) (left center|right center|pitcher|catcher|first|second|third|shortstop|left|center|right)$/#)
        else { return ([], error) }
        return (words[String(m.1)].map { [$0] } ?? [], error)
    }

    /// A play's text in clauses: at commas, and at sentence ends (not after
    /// "Jr." mid-sentence).
    static func clauses(_ text: String) -> [String] {
        text.split(separator: #/,\s*|\.(?=\s+[A-Z]|\s*$)/#).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    /// Bases by athlete ID, from an entry's participants.
    static func bases(_ entry: JSON) -> [Int: String] {
        var out: [Int: String] = [:]
        for (base, role) in [(1, "onFirst"), (2, "onSecond"), (3, "onThird")] {
            if let id = participant(entry, role) { out[base] = id }
        }
        return out
    }

    /// A participant's athlete ID: the summary's `athlete.id`, or the core
    /// feed's link (".../athletes/4917869?lang=en").
    static func participant(_ entry: JSON, _ role: String) -> String? {
        guard let p = entry["participants"].array.first(where: { $0["type"].string == role }) else { return nil }
        if let id = p["athlete"]["id"].string { return id }
        guard let ref = p["athlete"]["$ref"].string, let range = ref.range(of: "/athletes/") else { return nil }
        let id = ref[range.upperBound...].prefix { $0.isNumber }
        return id.isEmpty ? nil : String(id)
    }

    /// The home team takes the lead in the bottom of the 9th or later: the
    /// game is over. A scoring result's score fields are the score after it.
    static func walkOff(_ entry: JSON) -> Bool {
        guard entry["period"]["type"].string?.lowercased().hasPrefix("bot") == true,
              let inning = entry["period"]["number"].int, inning >= 9,
              let home = entry["homeScore"].int, let away = entry["awayScore"].int else { return false }
        let runs = entry["scoreValue"].int ?? 1
        return home > away && home - runs <= away
    }

    static func hand(_ entry: JSON) -> Hand? {
        entry["bats"]["abbreviation"].string.flatMap(Hand.init(rawValue:))
    }

    static func halfInning(_ entry: JSON) -> String {
        "\(entry["period"]["type"].string ?? "")\(entry["period"]["number"].int ?? 0)"
    }

    /// "2026-10-27T00:14:14Z". (Formatters are costly to make: one, reused.)
    private static func parseDate(_ s: String) -> Date? {
        wallclock.date(from: s) ?? wallclockFractional.date(from: s)
    }

    nonisolated(unsafe) private static let wallclock = ISO8601DateFormatter()
    nonisolated(unsafe) private static let wallclockFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// Where each runner went. A runner on a base after the play went there;
    /// one who isn't scored or was put out. Runs and outs say how many of
    /// each; the text says which ("Bauers scored", "Díaz out at second"), by
    /// surname. When it can't, the batter makes his own out, runs go to the
    /// lead runners and outs to the trailing (forced) ones.
    static func movements(kind: Kind, air: Bool, before: [Int: String], after: [Int: String], batter: String?,
                          outs: Int, runs: Int, text: String, names: [String: String]) -> [Runner] {
        // A runner's play mid-at-bat has no batter on it.
        let starts = (batter.map { [(id: Optional($0), from: 0)] } ?? [])
            + before.sorted { $0.key > $1.key }.map { (id: Optional($0.value), from: $0.key) }
        if kind == .homeRun { return starts.map { Runner(id: $0.id, from: $0.from, end: .scored) } }
        let landed = Dictionary(after.map { ($0.value, $0.key) }, uniquingKeysWith: max)
        let parts = clauses(text)
        func surname(_ id: String?) -> String? {
            guard let id, let name = names[id] else { return nil }
            return Self.surname(name)
        }
        // A runner the text puts further on than the result's bases do (they can lag a throwing error):
        // "Yelich safe at third on throwing error by catcher".
        func safeAt(_ id: String) -> Int? {
            guard let name = surname(id), let clause = parts.first(where: { $0.contains("\(name) safe at") }),
                  let m = clause.firstMatch(of: #/safe at (first|second|third)/#) else { return nil }
            return ["first": 1, "second": 2, "third": 3][String(m.1)]
        }
        var runners: [Runner] = []
        var gone: [(id: String?, from: Int)] = []
        for start in starts {
            if let id = start.id, let base = landed[id], base >= start.from {
                runners.append(Runner(id: id, from: start.from, end: .base(start.from > 0 ? max(base, safeAt(id) ?? 0) : base)))
            } else {
                gone.append(start)
            }
        }
        var runsLeft = max(runs, 0), outsLeft = max(outs, 0)
        func base(in clause: String) -> Int? {
            guard let m = clause.firstMatch(of: #/(?:at|stealing|off) (first|1st|second|2nd|third|3rd|home)/#) else { return nil }
            return ["first": 1, "1st": 1, "second": 2, "2nd": 2, "third": 3, "3rd": 3, "home": 0][String(m.1)]
        }
        func outBase(_ from: Int) -> Int? {
            if from == 0 {
                switch kind {
                case .strikeout: return 0
                case .flyOut, .lineOut, .popOut, .foulOut, .sacrificeFly: return nil
                // Lined (or flied) into a double play: his out is the catch.
                case .doublePlay, .triplePlay: return air ? nil : 1
                default: return 1
                }
            }
            switch kind {
            case .pickoff: return from
            // Doubled off on a catch: back at the base he left; else forced at the next.
            case .doublePlay, .triplePlay, .flyOut, .lineOut, .popOut: return air ? from : (from + 1) % 4
            default: return (from + 1) % 4
            }
        }
        // By the text first.
        var unresolved: [(id: String?, from: Int)] = []
        for runner in gone {
            let name = surname(runner.id)
            let scored = name.map { n in parts.contains { $0.contains(n) && $0.contains("scor") } } ?? false
            let out = name.flatMap { n in
                parts.first { $0.contains(n) && [" out", "caught stealing", "picked off", "doubled off"].contains(where: $0.contains) }
            }
            if scored, runsLeft > 0 {
                runners.append(Runner(id: runner.id, from: runner.from, end: .scored))
                runsLeft -= 1
            } else if let out, outsLeft > 0 {
                runners.append(Runner(id: runner.id, from: runner.from, end: .out(at: base(in: out) ?? outBase(runner.from))))
                outsLeft -= 1
            } else {
                unresolved.append(runner)
            }
        }
        // Then by rule.
        if batterOut(kind), outsLeft > 0, let i = unresolved.firstIndex(where: { $0.from == 0 }) {
            runners.append(Runner(id: unresolved[i].id, from: 0, end: .out(at: outBase(0))))
            unresolved.remove(at: i)
            outsLeft -= 1
        }
        for runner in unresolved.filter({ $0.from > 0 }).sorted(by: { $0.from > $1.from }) where runsLeft > 0 {
            runners.append(Runner(id: runner.id, from: runner.from, end: .scored))
            unresolved.removeAll { $0.from == runner.from }
            runsLeft -= 1
        }
        for runner in unresolved.sorted(by: { $0.from < $1.from }) {
            if outsLeft > 0 {
                runners.append(Runner(id: runner.id, from: runner.from, end: .out(at: outBase(runner.from))))
                outsLeft -= 1
            } else if runner.from > 0 {
                // Unaccounted for (the inning ended around him): he stays.
                runners.append(Runner(id: runner.id, from: runner.from, end: .base(runner.from)))
            } else if let reached = reachedBase(kind) {
                // A batter the result left off the bases (ESPN drops him at the third out).
                runners.append(Runner(id: runner.id, from: 0, end: .base(reached)))
            } else {
                runners.append(Runner(id: runner.id, from: 0, end: .out(at: outBase(0))))
            }
        }
        // The batter first, then from the lead runner back.
        return runners.sorted { a, b in a.from == 0 ? b.from != 0 : b.from == 0 ? false : a.from > b.from }
    }

    /// The batter's own out: a strikeout, or a ball caught or thrown to first.
    private static func batterOut(_ kind: Kind) -> Bool {
        switch kind {
        case .groundOut, .flyOut, .lineOut, .popOut, .foulOut, .doublePlay, .triplePlay, .sacrificeFly, .sacrificeBunt, .strikeout:
            true
        default:
            false
        }
    }

    private static func reachedBase(_ kind: Kind) -> Int? {
        switch kind {
        case .single, .walk, .hitByPitch, .fieldersChoice, .error, .other: 1
        case .double: 2
        case .triple: 3
        default: nil
        }
    }
}

// MARK: - Statcast

extension PlayScene {
    /// Statcast's at-bat for this plate appearance: the same half-inning,
    /// the batter by surname, his nth trip to the plate in it.
    func atBat(in atBats: [Statcast.AtBat]) -> Statcast.AtBat? {
        guard let a = appearance else { return nil }
        return Statcast.match(inning: a.inning, top: a.top, surname: a.surname, occurrence: a.occurrence, in: atBats)
    }

    /// What Statcast measured of this plate appearance, once its at-bat is
    /// over and agrees with ESPN's account: the same result, a ball in play
    /// only for a play in play, fielded at the same spot (ESPN's spot is
    /// MLB's, truncated). Nil otherwise: the theater keeps to ESPN's. (pure; tested)
    func measurement(in atBats: [Statcast.AtBat]) -> Measured? {
        guard let atBat = atBat(in: atBats), atBat.complete, let event = atBat.event, agrees(with: event) else { return nil }
        // A ball in play waits for its hitData (it can post seconds after the result): asked again.
        if inPlay, atBat.batted == nil { return nil }
        let batted = inPlay ? atBat.batted : nil
        if let spot, let measured = batted?.spot, hypot(measured.x - spot.x, measured.y - spot.y) > 3 { return nil }
        // (An intentional walk has nothing to measure, and that's found too: nobody asks again.)
        return Measured(batted: batted, pitch: atBat.pitches.last, movements: atBat.result)
    }

    /// Whether Statcast's name for a result could be this play: a hit the
    /// same hit, a strikeout, walk or hit batter the same, an out any out.
    func agrees(with event: String) -> Bool {
        let e = event.lowercased()
        let reached: Set<String> = ["single", "double", "triple", "home run", "walk", "intent walk", "hit by pitch"]
        switch kind {
        case .single: return e == "single"
        case .double: return e == "double"
        case .triple: return e == "triple"
        case .homeRun: return e == "home run"
        case .strikeout: return e.hasPrefix("strikeout")
        case .walk: return e.hasSuffix("walk")
        case .hitByPitch: return e == "hit by pitch"
        default: return !reached.contains(e) && !e.hasPrefix("strikeout")
        }
    }

    /// Looks the plate appearance up in MLB's feed: what's cached, else the
    /// feed again (Statcast posts a few seconds after ESPN). Nil until it's
    /// there, for a runner's play, or for a game MLB's feed doesn't have.
    @MainActor
    func measure(_ lookup: Statcast.Lookup) async -> Measured? {
        guard appearance != nil || during != nil else { return nil }
        let store = StatcastStore.shared
        let cached = await store.atBats(espnEvent: lookup.espnEvent, start: lookup.start, teams: lookup.teams)
        if let found = measurement(in: cached) ?? runnerMeasurement(in: cached) { return found }
        let next = (atBat(in: cached) ?? duringAtBat(in: cached))?.index ?? (cached.map(\.index).max() ?? -1) + 1
        let fresh = await store.atBats(espnEvent: lookup.espnEvent, start: lookup.start, teams: lookup.teams, through: next)
        return measurement(in: fresh) ?? runnerMeasurement(in: fresh)
    }

    /// A runner's play's at-bat in MLB's feed: the one it came during.
    func duringAtBat(in atBats: [Statcast.AtBat]) -> Statcast.AtBat? {
        guard let d = during else { return nil }
        return Statcast.match(inning: d.inning, top: d.top, surname: d.surname, occurrence: d.occurrence, in: atBats)
    }

    /// MLB's legs for a runner's play (a steal, a pickoff, a wild pitch):
    /// the at-bat it came during, and that at-bat's runner's events in turn
    /// (the ones no leg of the batter's is on), when they're the runners
    /// ESPN has on it. Nil otherwise. (pure; tested)
    func runnerMeasurement(in atBats: [Statcast.AtBat]) -> Measured? {
        guard let k = during?.runnerPlay, let atBat = duringAtBat(in: atBats) else { return nil }
        let batters = Set(atBat.runners.filter { $0.from == 0 }.compactMap(\.event))
        let events = Set(atBat.runners.compactMap(\.event)).subtracting(batters).sorted()
        guard events.indices.contains(k) else { return nil }
        let legs = atBat.runners.filter { $0.event == events[k] }
        // Each runner by the base he started from (his first leg's).
        var starts: [Int: Int] = [:]
        for leg in legs where starts[leg.runner] == nil { starts[leg.runner] = leg.from }
        guard Set(starts.values).isSubset(of: Set(runners.map(\.from))) else { return nil }
        return Measured(movements: legs)
    }

    /// The same, waiting no longer than `limit` (the full load can't hold
    /// the page up); the lookup runs on either way, so what it fetches is
    /// cached for the live lane.
    @MainActor
    func measure(_ lookup: Statcast.Lookup, within limit: Duration) async -> Measured? {
        let work = Task { await measure(lookup) }
        return await withCheckedContinuation { (result: CheckedContinuation<Measured?, Never>) in
            let once = Once(result)
            Task { once.resume(await work.value) }
            Task {
                try? await Task.sleep(for: limit)
                once.resume(nil)
            }
        }
    }
}

// MARK: - The official account

// MLB's feed carries its official scorer's account of every play: each
// runner's legs (base to base, out where and in what order) and each
// fielder's part (who fielded it, who threw to whom, who erred). Where it's
// been found for a plate appearance, the choreography follows it instead of
// reading ESPN's text and inferring the rest.

extension PlayScene {
    /// Who handled the ball, as MLB's official scorer credited it: who
    /// fielded it (and who it glanced off first), whether he booted it, then
    /// each throw in the order of the outs they made, to the man who took it
    /// and the base where it made one (0: home; nil: a relay to a cutoff
    /// man), and a throw that got away.
    struct Handling: Equatable {
        struct Throw: Equatable {
            var to: Int
            var base: Int?
            /// A throwing error: it sails past him at `base`, and nobody's out.
            var wild = false
        }
        var fielder: Int
        var deflection: Int?
        /// A fielding error: it gets away from him.
        var fumble: Int?
        var chain: [Throw] = []

        /// The scorer's chain: who fielded it and each man who took a throw (not one that got away, nor his own carry).
        var credited: [Int] {
            var out = [fielder]
            for t in chain where !t.wild && t.to != out.last { out.append(t.to) }
            return out
        }
    }

    /// The batter's out is the catch itself (or strike three): no throw,
    /// unless MLB credits one (a third strike dropped, and thrown to first).
    var caughtOut: Bool {
        switch kind {
        case .flyOut, .lineOut, .popOut, .foulOut, .sacrificeFly, .strikeout: true
        case .doublePlay, .triplePlay: inPlay && flight != .ground
        default: false
        }
    }

    /// MLB's legs for this play, when they tell all of it: the batter on
    /// them (MLB lists every man who moved, and him always, but for a
    /// runner's play) and as many runs as ESPN counted. Nil until then (not
    /// found yet, or still being posted).
    var legs: [Statcast.Movement]? {
        guard let movements = measured?.movements, !movements.isEmpty, batter == nil || movements.contains(where: { $0.from == 0 }),
              movements.filter({ $0.to == 4 }).count == runs else { return nil }
        return movements
    }

    /// The ball's handling as MLB credited it; nil without MLB's account, or
    /// when it credited nobody (a walk, a home run). (pure; tested)
    var handling: Handling? {
        guard let movements = legs else { return nil }
        let credits = movements.flatMap(\.credits)
        func first(_ kinds: Set<Statcast.Credit.Kind>) -> Int? { credits.first { kinds.contains($0.kind) }?.position }
        // Each out's chain, in the order they were made: the assists, then the putout.
        let outs = movements.filter { $0.out != nil && !($0.from == 0 && caughtOut && !$0.assisted) }
            .sorted { ($0.outNumber ?? 0) < ($1.outNumber ?? 0) }
        func chain(_ m: Statcast.Movement) -> [Int] { m.credits.filter { [.assist, .outfieldAssist, .putout].contains($0.kind) }.map(\.position) }
        guard let fielder = first([.fielded]) ?? outs.lazy.compactMap({ chain($0).first }).first
                ?? first([.putout, .assist, .fieldingError, .throwingError]) else { return nil }
        var handling = Handling(fielder: fielder, deflection: first([.deflection]), fumble: first([.fieldingError]))
        var holder = fielder
        for out in outs {
            let positions = chain(out)
            for (i, p) in positions.enumerated() {
                let putout = i == positions.count - 1
                // His own assist: he has it already. His own putout: he takes it there himself.
                guard p != holder || putout else { continue }
                handling.chain.append(Handling.Throw(to: p, base: putout ? out.out.map { $0 % 4 } : nil))
                holder = p
            }
        }
        // A throw that got away: to the base its runner had just reached on the play (the batter's, first),
        // else to the one he was going for.
        for (i, m) in movements.enumerated() {
            guard let thrower = m.credits.first(where: { $0.kind == .throwingError })?.position else { continue }
            if thrower != holder { handling.chain.append(Handling.Throw(to: thrower, base: nil)) }
            let reached = m.from == 0 || movements[..<i].contains { $0.runner == m.runner && $0.to == m.from }
            let base = m.from == 0 ? 1 : reached ? m.from : (m.from + 1) % 4
            handling.chain.append(Handling.Throw(to: Self.coverer(of: base, after: thrower), base: base, wild: true))
            holder = thrower
        }
        return handling
    }

    /// The play with MLB's official account of its runners in place of
    /// ESPN's (which reads who scored and who was out from the text, and
    /// infers the rest). ESPN's as it is without MLB's.
    var official: PlayScene {
        guard let movements = legs else { return self }
        var scene = self
        let struckOut = if case .strikeout = kind { true } else { false }
        scene.runners = Self.runners(runners, after: movements, caughtOut: caughtOut, struckOut: struckOut)
        return scene
    }

    /// ESPN's runners (by the base each started from) where MLB's legs took
    /// them: to a base, home, or out at a base (the batter's at the catch, or
    /// at the plate on strike three), in the order of the outs, and waiting
    /// at a base for a throw that got away or went elsewhere. One MLB doesn't
    /// list stayed put; one only MLB has joins them. (pure; tested)
    static func runners(_ espn: [Runner], after movements: [Statcast.Movement], caughtOut: Bool, struckOut: Bool) -> [Runner] {
        var legs: [Int: [Statcast.Movement]] = [:]
        var order: [Int] = []
        for m in movements {
            if legs[m.runner] == nil { order.append(m.runner) }
            legs[m.runner, default: []].append(m)
        }
        func runner(_ moves: [Statcast.Movement], id: String?) -> Runner {
            let from = moves[0].from
            var r = Runner(id: id, from: from, end: .base(from))
            if let out = moves.first(where: { $0.out != nil }) {
                // (The batter's out where MLB credits a throw, a dropped third strike's, is at its base.)
                let caught = from == 0 && !out.assisted
                r.end = .out(at: caught && struckOut ? 0 : caught && caughtOut ? nil : out.out.map { $0 % 4 })
                r.outNumber = out.outNumber
            } else if let to = moves.last?.to {
                r.end = to == 4 ? .scored : .base(to)
            }
            if let i = moves.firstIndex(where: { $0.reason == "r_adv_throw" || $0.credits.contains { $0.kind == .throwingError } }) {
                // Where the ball got past (as `handling` throws it): first for the batter, the base he'd just
                // reached on the play, else the one he was going for. He goes on from there.
                let leg = moves[i], at = leg.from == 0 ? 1 : i > 0 ? leg.from : leg.from + 1
                let end = if case let .base(b) = r.end { b } else if r.end == .scored { 4 } else { at }
                r.waits = at < end ? at : nil
            }
            return r
        }
        var claimed = Set<Int>()
        var out: [Runner] = espn.map { r in
            guard let id = order.first(where: { !claimed.contains($0) && legs[$0]?.first?.from == r.from }) else {
                // Not on MLB's account: he didn't move.
                return r.from == 0 ? r : Runner(id: r.id, from: r.from, end: .base(r.from))
            }
            claimed.insert(id)
            return runner(legs[id] ?? [], id: r.id)
        }
        for id in order where !claimed.contains(id) {
            if let moves = legs[id], !out.contains(where: { $0.from == moves[0].from }) { out.append(runner(moves, id: nil)) }
        }
        // The batter first, then from the lead runner back.
        return out.sorted { a, b in a.from == 0 ? b.from != 0 : b.from == 0 ? false : a.from > b.from }
    }
}

/// A continuation resumed by whichever finishes first.
@MainActor
private final class Once<T> {
    private var continuation: CheckedContinuation<T, Never>?

    init(_ continuation: CheckedContinuation<T, Never>) { self.continuation = continuation }

    func resume(_ value: T) {
        continuation?.resume(returning: value)
        continuation = nil
    }
}
