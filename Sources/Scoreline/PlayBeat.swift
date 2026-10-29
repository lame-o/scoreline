import Foundation

// Everything the ballpark theater shows between balls in play, so a live
// game never looks frozen: every pitch (its call, and its real flight where
// MLB tracked it), a throw over, a mound visit, a pitching change, a pinch
// hitter, the teams changing sides, a challenge, a delay. Each is a beat in
// the game's timeline, between the replays of its plays.
//
// ESPN's play-by-play sets the order, as the rest of the page has it: each
// pitch as it posts, a runner's play, the at-bat's result, the end of a half.
// MLB's feed fills in what ESPN doesn't carry, matched by half-inning, batter
// and pitch number: a pitch's measured flight and its exact call (a foul tip,
// a ball in the dirt), and what came between pitches (a mound visit, a throw
// over, who came in, a challenge and how it came out, an injury delay), each
// placed where it happened among ESPN's pitches. The pitch that ends an
// at-bat is its play's (the replay throws it), and a runner's play is ESPN's
// result too, so nothing is shown twice. Pure values, parsed from real games;
// the choreography is PlayBeatScript.swift's.

struct PlayBeat: Equatable, Identifiable {
    /// A pitch that didn't end the at-bat.
    struct Pitch: Equatable {
        enum Call: Equatable {
            case ball, calledStrike, swingingStrike, foul, foulTip, foulBunt, missedBunt
            /// A ball in the dirt the catcher blocks; a swinging strike in it.
            case ballInDirt, swingingBlocked
            /// A pitch-clock violation: no pitch thrown.
            case automaticBall, automaticStrike
        }
        var call: Call
        /// Which pitch of the at-bat.
        var number: Int
        /// The count after it.
        var balls: Int
        var strikes: Int
        /// "FF", and its speed (mph).
        var code: String?
        var mph: Double?
        /// ESPN's pitch coordinates (the strike zone chart's: zone ≈ x 91…141, y 148…192).
        var x: Double?
        var y: Double?
        /// The flight as MLB tracked it.
        var flight: Statcast.Pitch?
        /// A challenge of its call (the automated zone).
        var review: Statcast.Review?

        /// He swung.
        var swung: Bool { [.swingingStrike, .swingingBlocked, .foul, .foulTip].contains(call) }
        var bunted: Bool { call == .foulBunt || call == .missedBunt }
        var thrown: Bool { call != .automaticBall && call != .automaticStrike }
    }

    /// Who came in, or moved.
    struct Change: Equatable {
        enum Role: Equatable { case pinchHitter, pinchRunner, defensive, moves }
        var role: Role
        /// "Mesa Jr." (the surname, as the tag has it).
        var name: String?
        /// The position he takes, by scorer's number (1: pitcher … 9: right field).
        var position: Int?
        /// A pinch runner's base.
        var base: Int?
    }

    /// Who's hurt: where the trainer goes.
    enum Hurt: Equatable { case batter, pitcher, elsewhere }

    enum Delay: Equatable {
        case injury(Hurt)
        case onField
        /// "Rain", "Inclement Weather".
        case weather(String)
        /// A delay that's ending, and the end of one.
        case resuming
        case over
    }

    enum Kind: Equatable {
        /// A play replayed from its scene (the at-bat's result, a runner's play): `TheaterState.play` when it's the newest.
        case play
        case pitch(Pitch)
        /// The batter steps in (a pinch hitter, said so).
        case batterUp(name: String?, pinch: Bool)
        /// A throw over to a base, the pitcher's (or the catcher's after a pitch).
        case pickoff(base: Int, catcher: Bool)
        case stepOff
        /// The batter steps out.
        case timeout
        /// The catcher, or the pitching coach (or the manager, come to make a change).
        case moundVisit(coach: Bool)
        case pitchingChange(reliever: String?)
        case substitution(Change)
        /// The end of a half: the middle of the inning or its end.
        case inningBreak(middle: Bool, inning: Int)
        case review(Statcast.Review)
        case delay(Delay)
    }

    let id: String
    var kind: Kind
    var bats: PlayScene.Hand?
    var arm: PlayScene.Hand?
    /// The half-inning, and the team at bat in it.
    var inning: Int?
    var top: Bool?
    /// The game after it: the count and the outs.
    var balls = 0
    var strikes = 0
    var outs = 0
    var wallclock: Date?
    /// Who's on (first, second, third) as it happens (nil: ESPN didn't say).
    var bases: [Bool]?
    /// Arrived while the page was open: shown as it comes. Otherwise it's history.
    var news = false

    init(id: String, kind: Kind, bats: PlayScene.Hand? = nil, arm: PlayScene.Hand? = nil, inning: Int? = nil, top: Bool? = nil,
         balls: Int = 0, strikes: Int = 0, outs: Int = 0, wallclock: Date? = nil, bases: [Bool]? = nil, news: Bool = false) {
        self.id = id
        self.bases = bases
        self.kind = kind
        self.bats = bats
        self.arm = arm
        self.inning = inning
        self.top = top
        self.balls = balls
        self.strikes = strikes
        self.outs = outs
        self.wallclock = wallclock
        self.news = news
    }

    /// The team at bat (MLB's visitors bat in the top).
    var batting: GameDetail.Side? { top.map { $0 ? .top : .bottom } }

    var isPlay: Bool { kind == .play }

    /// A stoppage: it stands until the next thing happens, and the tag says so.
    var stands: Bool {
        switch kind {
        case .moundVisit, .pitchingChange, .substitution, .inningBreak, .review: true
        case let .delay(d): d != .over
        default: false
        }
    }

    /// A number from its ID, the same every time: what varies where the data is silent.
    var seed: UInt64 { Self.seed(id) }

    /// What's still to come, caught up: a play goes first (its replay is
    /// what a scoring slide keeps time with: what came before it is passed
    /// over); a backlog of pitches (the feed was slow) plays only its last
    /// few; everything else plays, in order. (pure; tested)
    static func catchUp(_ pending: [PlayBeat]) -> [PlayBeat] {
        if let play = pending.lastIndex(where: \.isPlay), play > 0 { return catchUp(Array(pending[play...])) }
        let pitches = pending.filter { if case .pitch = $0.kind { return true }; return false }
        guard pitches.count > 5 else { return pending }
        let keep = Set(pitches.suffix(4).map(\.id))
        return pending.filter { b in if case .pitch = b.kind { return keep.contains(b.id) }; return true }
    }

    /// FNV-1a: stable across launches (Swift's own hash isn't).
    static func seed(_ s: String) -> UInt64 {
        var h: UInt64 = 0xcbf29ce484222325
        for b in s.utf8 { h = (h ^ UInt64(b)) &* 0x100000001b3 }
        return h
    }
}

// MARK: - The timeline

extension PlayBeat {
    /// The game in order from ESPN's plays: each pitch, the batter stepping
    /// in, each play (a marker: its scene is the theater's), the end of each
    /// half; and MLB's events placed among them, matched by half-inning,
    /// batter and pitch number. Without MLB (or before it has the at-bat),
    /// ESPN's alone: its pitches, a new pitcher from who's pitching, the
    /// challenge in a pitch's type. (pure; tested)
    static func timeline(_ window: [JSON], mlb: [Statcast.AtBat], names: [String: String]) -> [PlayBeat] {
        var out: [PlayBeat] = []
        var emitted = Set<String>()
        func emit(_ beat: PlayBeat) {
            guard !emitted.contains(beat.id) else { return }
            emitted.insert(beat.id)
            out.append(beat)
        }
        // Each half's pitcher, as ESPN names him: a new one is a change (when MLB hasn't said).
        var pitchers: [Bool: String] = [:]
        // The at-bat under way: ESPN's, MLB's, how far its pitches have come.
        var atBat: String?, matched: Statcast.AtBat?, lastPitch = 0
        var balls = 0, strikes = 0
        // The outs as the half stands (ESPN's own field on a pitch is the outs after the at-bat).
        var outs = 0
        // Who's on, as ESPN's entries list the runners (each pitch's as it's thrown, a result's after it).
        var bases: [Bool]?
        let occurrences = Self.occurrences(window, names: names)

        func top(_ e: JSON) -> Bool? { e["period"]["type"].string.map { $0.lowercased().hasPrefix("top") } }
        func base(_ e: JSON, _ id: String, _ kind: Kind) -> PlayBeat {
            PlayBeat(id: id, kind: kind, bats: PlayScene.hand(e), arm: e["pitches"]["abbreviation"].string.flatMap(PlayScene.Hand.init(rawValue:)),
                     inning: e["period"]["number"].int, top: top(e), balls: balls, strikes: strikes, outs: outs,
                     wallclock: e["wallclock"].string.flatMap(Statcast.time), bases: kind == .play ? nil : bases)
        }
        /// MLB's events in the at-bat up to (not including) its pitch `number`: every one when nil.
        func mlbEvents(before number: Int?) {
            guard let m = matched else { return }
            let cut = number.flatMap { n in m.events.first { $0.isPitch && $0.pitchNumber == n }?.index }
            for e in m.events where !e.isPitch && cut.map({ e.index < $0 }) ?? true {
                guard var beat = Self.beat(e, in: m) else { continue }
                if case .batterUp = beat.kind { continue }
                beat.bases = bases
                emit(beat)
            }
        }

        for e in window {
            let type = e["type"]["type"].string ?? ""
            let id = e["id"].string ?? ""
            let entryAtBat = e["atBatId"].string
            if PlayScene.participant(e, "pitcher") != nil {
                let on = PlayScene.bases(e)
                bases = (1...3).map { on[$0] != nil }
            }
            if type == "end-inning" || type == "start-inning" { (bases, outs) = ([false, false, false], 0) }
            // A play's outs are the outs after it.
            if type == "play-result", let after = e["outs"].int { outs = after }
            switch type {
            case "start-batterpitcher":
                let pitcher = PlayScene.participant(e, "pitcher")
                let half = top(e) ?? true
                if entryAtBat != atBat {
                    atBat = entryAtBat
                    lastPitch = 0
                    (balls, strikes) = (0, 0)
                    matched = Self.match(e, names: names, occurrences: occurrences, in: mlb)
                }
                // ESPN's own word on a new pitcher, when MLB hasn't said.
                if let pitcher, let before = pitchers[half], before != pitcher,
                   matched?.events.contains(where: { $0.kind == .action("pitching_substitution") }) != true {
                    emit(base(e, id + ".change", .pitchingChange(reliever: names[pitcher].map(PlayScene.surname))))
                }
                if let pitcher { pitchers[half] = pitcher }
                let pinch = matched?.events.contains { $0.kind == .action("offensive_substitution") && $0.position == "PH"
                    && $0.index < (matched?.events.first(where: \.isPitch)?.index ?? .max) } ?? false
                mlbEvents(before: 1)
                let batter = PlayScene.participant(e, "batter").flatMap { names[$0] }.map(PlayScene.surname)
                emit(base(e, id, .batterUp(name: batter, pinch: pinch)))
            case "play-result":
                // An at-bat's result: the next starts from nothing (a runner's play leaves the count as it was).
                let result = PlayScene.participant(e, "batter") != nil
                if result { (balls, strikes) = (0, 0) }
                emit(base(e, id, .play))
                if result {
                    // A manager's challenge of the result, and how it came out.
                    if let m = matched, let review = m.review, !review.pitch {
                        emit(base(e, id + ".review", .review(review)))
                    }
                }
            case "end-inning":
                // ESPN's half here is "Mid" (the top's over) or "End".
                guard let inning = e["period"]["number"].int else { continue }
                let half = e["period"]["type"].string?.lowercased() ?? ""
                var end = base(e, id, .inningBreak(middle: half.hasPrefix("mid") || half.hasPrefix("top"), inning: inning))
                end.outs = 3
                emit(end)
            default:
                guard e["summaryType"].string == "P" || (e["text"].string ?? "").hasPrefix("Pitch") else { continue }
                if entryAtBat != atBat {
                    // Pitches with no start in the window: the at-bat's still this one.
                    atBat = entryAtBat
                    lastPitch = 0
                    matched = Self.match(e, names: names, occurrences: occurrences, in: mlb)
                }
                let number = e["atBatPitchNumber"].int ?? lastPitch + 1
                mlbEvents(before: number)
                // A new pitcher mid-at-bat, by ESPN's word.
                let half = top(e) ?? true
                if let pitcher = PlayScene.participant(e, "pitcher") {
                    if let before = pitchers[half], before != pitcher,
                       matched?.events.contains(where: { $0.kind == .action("pitching_substitution") }) != true {
                        emit(base(e, id + ".change", .pitchingChange(reliever: names[pitcher].map(PlayScene.surname))))
                    }
                    pitchers[half] = pitcher
                }
                lastPitch = number
                // ESPN's count after the pitch (its `pitchCount` is the count it was thrown on).
                let count = e["resultCount"]
                if let b = count["balls"].int, let s = count["strikes"].int { (balls, strikes) = (b, s) }
                guard let pitch = Self.pitch(e, number: number, mlb: matched) else { continue }
                var beat = base(e, id, .pitch(pitch))
                beat.balls = pitch.balls
                beat.strikes = pitch.strikes
                (balls, strikes) = (pitch.balls, pitch.strikes)
                emit(beat)
            }
        }
        // The at-bat under way: what MLB has after ESPN's last pitch, up to its next one (still in order).
        if matched != nil { mlbEvents(before: lastPitch + 1) }
        return out
    }

    /// Each at-bat's trip number in its half, counted back from the half's
    /// last in the window (MLB's feed has them all): the newest is his
    /// latest, whatever the window has cut off before it.
    static func occurrences(_ window: [JSON], names: [String: String]) -> [String: Int] {
        var seen: [String: Int] = [:], out: [String: Int] = [:]
        for e in window.reversed() where e["type"]["type"].string == "start-batterpitcher" {
            guard let id = e["atBatId"].string, out[id] == nil, let batter = PlayScene.participant(e, "batter") else { continue }
            let key = PlayScene.halfInning(e) + batter
            out[id] = -(seen[key] ?? 0) - 1
            seen[key, default: 0] += 1
        }
        return out
    }

    /// MLB's at-bat for ESPN's: the same half, the batter by surname, his
    /// nth trip counted back from his latest.
    static func match(_ e: JSON, names: [String: String], occurrences: [String: Int], in mlb: [Statcast.AtBat]) -> Statcast.AtBat? {
        guard let inning = e["period"]["number"].int, let batter = PlayScene.participant(e, "batter"),
              let name = names[batter].map(PlayScene.surname) else { return nil }
        let top = e["period"]["type"].string?.lowercased().hasPrefix("top") ?? true
        let theirs = mlb.filter { $0.inning == inning && $0.top == top && fold($0.batter).hasSuffix(fold(name)) }
        let back = e["atBatId"].string.flatMap { occurrences[$0] } ?? -1
        let i = theirs.count + back
        return theirs.indices.contains(i) ? theirs[i] : nil
    }

    private static func fold(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).replacingOccurrences(of: ".", with: "")
            .trimmingCharacters(in: .whitespaces)
    }

    /// ESPN's pitch with MLB's (by number), when it didn't end the at-bat:
    /// the call (MLB's exact code over ESPN's type), the count after it, the
    /// type and speed, the plate location, the measured flight, a challenge.
    /// Nil for the at-bat's last pitch (its play throws it). (pure; tested)
    static func pitch(_ e: JSON, number: Int, mlb: Statcast.AtBat?) -> Pitch? {
        let type = e["type"]["type"].string ?? ""
        let m = mlb?.events.first { $0.isPitch && $0.pitchNumber == number }
        let espnCall: Pitch.Call? = switch type.components(separatedBy: "---").first ?? type {
        case "ball", "intentional-ball", "pitchout": .ball
        case "strike-looking": .calledStrike
        case "strike-swinging": .swingingStrike
        case "foul-ball": .foul
        case "foul-tip": .foulTip
        case "bunted-foul", "foul-bunt": .foulBunt
        case "missed-bunt": .missedBunt
        default: nil
        }
        var call = espnCall
        if let m {
            switch m.kind {
            case let .pitch(code):
                switch code {
                case "B", "P", "I": call = .ball
                case "*B": call = .ballInDirt
                case "C": call = .calledStrike
                case "S", "Q": call = .swingingStrike
                case "W": call = .swingingBlocked
                case "F", "R": call = .foul
                case "T": call = .foulTip
                case "L": call = .foulBunt
                case "M": call = .missedBunt
                // In play or a hit batter: the play's.
                default: return nil
                }
            case let .automatic(ball):
                call = ball ? .automaticBall : .automaticStrike
            default:
                break
            }
        }
        guard let call else { return nil }
        let count = e["resultCount"]
        let balls = count["balls"].int ?? m?.balls ?? 0, strikes = count["strikes"].int ?? m?.strikes ?? 0
        // Ball four or strike three ends it: the play's.
        guard balls < 4, strikes < 3 else { return nil }
        var review = m?.review
        if review == nil, type.hasSuffix("---overturned") || type.hasSuffix("---confirmed") {
            review = Statcast.Review(overturned: type.hasSuffix("---overturned"), type: "MJ")
        }
        return Pitch(call: call, number: number, balls: balls, strikes: strikes,
                     code: m?.type ?? e["pitchType"]["abbreviation"].string, mph: m?.mph ?? e["pitchVelocity"].double,
                     x: e["pitchCoordinate"]["x"].double, y: e["pitchCoordinate"]["y"].double, flight: m?.flight, review: review)
    }

    /// One of MLB's events between pitches as a beat, by its structured
    /// type; names from its description. Nil for what isn't one: a pitch,
    /// a runner's play (ESPN's result replays it), the game's bookkeeping.
    /// (pure; tested)
    static func beat(_ e: Statcast.PlayEvent, in m: Statcast.AtBat) -> PlayBeat? {
        let kind: Kind
        switch e.kind {
        case .pitch, .automatic:
            return nil
        case let .pickoff(base, catcher):
            // An attempt (a throw that got away, or the out, is the runner's play: ESPN's).
            guard let base, e.description?.lowercased().contains("attempt") ?? true else { return nil }
            kind = .pickoff(base: base, catcher: catcher)
        case .stepOff:
            kind = .stepOff
        case let .action(type):
            switch type {
            case "mound_visit":
                kind = .moundVisit(coach: visitByCoach(e, in: m))
            case "pitching_substitution":
                kind = .pitchingChange(reliever: name(in: e.description).map(tagName))
            case "offensive_substitution":
                let runner = e.position == "PR"
                kind = runner ? .substitution(Change(role: .pinchRunner, name: name(in: e.description).map(tagName), position: nil,
                                                     base: base(of: e.replaced, in: m)))
                    : .batterUp(name: name(in: e.description).map(tagName), pinch: true)
            case "defensive_substitution", "defensive_switch":
                // The designated hitter's bookkeeping: nobody moves on the field.
                guard e.position != "DH" else { return nil }
                kind = .substitution(Change(role: type == "defensive_switch" ? .moves : .defensive, name: name(in: e.description).map(tagName),
                                            position: e.position.flatMap(position)))
            case "batter_timeout":
                kind = .timeout
            case "game_advisory":
                guard let delay = delay(e.description, player: e.player, in: m) else { return nil }
                kind = .delay(delay)
            default:
                return nil
            }
        }
        return PlayBeat(id: "mlb.\(m.index).\(e.index)", kind: kind, bats: m.batSide, arm: m.pitchHand, inning: m.inning, top: m.top,
                        balls: e.balls ?? 0, strikes: e.strikes ?? 0, outs: e.outs ?? 0, wallclock: e.start)
    }

    /// Who went out: a visit just before a change is the manager's (he's
    /// come to make it); one just after, or mid-count, the catcher's (a word
    /// with the new man, or about this hitter); at the start of an at-bat,
    /// the pitching coach's or the catcher's (MLB doesn't say: one or the
    /// other, the same every time).
    static func visitByCoach(_ e: Statcast.PlayEvent, in m: Statcast.AtBat) -> Bool {
        let after = m.events.first { $0.index > e.index && $0.kind != .action("batter_timeout") }
        if after?.kind == .action("pitching_substitution") { return true }
        let before = m.events.last { $0.index < e.index && $0.kind != .action("batter_timeout") }
        if before?.kind == .action("pitching_substitution") { return false }
        if (e.balls ?? 0) + (e.strikes ?? 0) > 0 { return false }
        return seed("\(m.index).\(e.index)") % 5 < 3
    }

    /// A delay from MLB's advisory: an injury (the batter's, the pitcher's,
    /// someone else's), the field, the weather, and play resuming.
    static func delay(_ description: String?, player: Int?, in m: Statcast.AtBat) -> Delay? {
        guard let d = description else { return nil }
        if d.hasPrefix("Injury Delay") {
            return .injury(player == nil ? .elsewhere : player == m.batterID ? .batter : player == m.pitcherID ? .pitcher : .elsewhere)
        }
        if d.hasPrefix("On-field Delay") { return .onField }
        guard d.hasPrefix("Status Change - ") else { return nil }
        let status = d.dropFirst("Status Change - ".count)
        if status.hasPrefix("Delayed: About to Resume") { return .resuming }
        if status.hasPrefix("Delayed: ") || status.hasPrefix("Delayed Start: ") {
            return .weather(String(status.split(separator: ":", maxSplits: 1).last ?? "").trimmingCharacters(in: .whitespaces))
        }
        if status.hasPrefix("In Progress"), m.events.contains(where: { $0.description?.hasPrefix("Status Change - Delayed") == true }) {
            return .over
        }
        return nil
    }

    /// The name a substitution's description gives: "Pitching Change: JoJo
    /// Romero replaces Dustin May." → "JoJo Romero"; "Victor Mesa Jr.
    /// remains in the game as the right fielder." → "Victor Mesa Jr.".
    static func name(in description: String?) -> String? {
        guard var d = description else { return nil }
        // "Defensive switch from second base to shortstop for Ben Williamson."
        if d.hasPrefix("Defensive switch from "), let r = d.range(of: " for ") { d = String(d[r.upperBound...]) }
        for prefix in ["Pitching Change: ", "Offensive Substitution: ", "Defensive Substitution: "] where d.hasPrefix(prefix) {
            d = String(d.dropFirst(prefix.count))
        }
        for prefix in ["Pinch-hitter ", "Pinch-runner ", "Pinch hitter ", "Pinch runner "] where d.hasPrefix(prefix) {
            d = String(d.dropFirst(prefix.count))
        }
        for stop in [" replaces ", " remains ", " moves ", " is now ", " in as ", ","] {
            if let r = d.range(of: stop) { d = String(d[..<r.lowerBound]) }
        }
        let name = d.trimmingCharacters(in: CharacterSet(charactersIn: " ."))
        return name.isEmpty ? nil : name
    }

    /// A full name's surname for a tag: "JoJo Romero" → "Romero"; "Victor
    /// Mesa Jr." → "Mesa Jr."; a short name ("E. Uribe") its surname.
    static func tagName(_ name: String) -> String {
        let parts = name.split(separator: " ").map(String.init)
        guard parts.count > 1 else { return name }
        let suffixes: Set<String> = ["Jr.", "Jr", "Sr.", "Sr", "II", "III", "IV"]
        if let last = parts.last, suffixes.contains(last), parts.count > 2 {
            return parts[parts.count - 2] + " " + (last.hasSuffix(".") || last.hasPrefix("I") ? last : last + ".")
        }
        return parts.last ?? name
    }

    /// A position's abbreviation as a scorer's number ("RF" → 9).
    static func position(_ abbreviation: String) -> Int? {
        ["P": 1, "C": 2, "1B": 3, "2B": 4, "3B": 5, "SS": 6, "LF": 7, "CF": 8, "RF": 9][abbreviation]
    }

    /// The base a replaced runner stood on: where his last leg in the at-bat ended.
    static func base(of runner: Int?, in m: Statcast.AtBat) -> Int? {
        guard let runner else { return nil }
        return m.runners.last { $0.runner == runner && ($0.to ?? 0) < 4 }?.to
    }
}

// MARK: - What the tag says

extension PlayBeat {
    /// A caption's words as this beat plays (PlayBeatScript.swift times them). (pure; tested)
    func caption(_ line: PlayScript.Caption.Line, wide: Bool) -> String? {
        switch line {
        case .tag: return tag(wide: wide)
        case let .call(asCalled):
            guard case let .pitch(p) = kind else { return tag(wide: wide) }
            return Self.call(p, wide: wide, asCalled: asCalled)
        case .challenge:
            guard case let .pitch(p) = kind else { return nil }
            return Self.challenge(p)?.asked
        case .outcome:
            guard case let .pitch(p) = kind else { return nil }
            return Self.challenge(p)?.result
        }
    }

    /// "TOP 7TH", "BOT 7TH".
    static func half(_ inning: Int?, top: Bool?) -> String? {
        guard let inning, let top else { return nil }
        return "\(top ? "TOP" : "BOT") \(Ordinal.string(inning).uppercased())"
    }

    /// The game as it stands after this beat, for the tag between pitches:
    /// "TOP 7TH · 1-2 · 2 OUTS" (and the end of a half, a stoppage, while
    /// it stands). (pure; tested)
    var standing: String? {
        if stands, let tag = tag(wide: true) { return tag }
        let outs = min(self.outs, 3)
        let parts = [Self.half(inning, top: top), outs >= 3 ? nil : "\(balls)-\(strikes)", "\(outs) OUT\(outs == 1 ? "" : "S")"]
        let text = parts.compactMap { $0 }.joined(separator: " · ")
        return text.isEmpty ? nil : text
    }

    /// What the tag says as this beat plays (a pitch's, its call: see
    /// `call(wide:)`). `wide`: room for MLB's full pitch names. (pure; tested)
    func tag(wide: Bool) -> String? {
        switch kind {
        case .play: return nil
        case let .pitch(p): return Self.call(p, wide: wide)
        case let .batterUp(name, pinch): return name.map { "\(pinch ? "PINCH HITTER" : "NOW BATTING") · \($0.uppercased())" }
        case let .pickoff(base, catcher):
            return "\(catcher ? "SNAP THROW" : "PICKOFF ATTEMPT") · \(["", "FIRST", "SECOND", "THIRD"][min(max(base, 1), 3)])"
        case .stepOff: return "STEP OFF"
        case .timeout: return nil
        case .moundVisit: return "MOUND VISIT"
        case let .pitchingChange(name): return ["PITCHING CHANGE", name?.uppercased()].compactMap { $0 }.joined(separator: " · ")
        case let .substitution(c):
            let what: String = switch c.role {
            case .pinchHitter: "PINCH HITTER"
            case .pinchRunner: "PINCH RUNNER"
            case .defensive: "DEFENSIVE SUB"
            case .moves: "DEFENSIVE SWITCH"
            }
            let position = c.position.map { ["", "P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"][min(max($0, 1), 9)] }
            return [what, c.name?.uppercased(), position].compactMap { $0 }.joined(separator: " · ")
        case let .inningBreak(middle, inning): return "\(middle ? "MIDDLE" : "END") \(Ordinal.string(inning).uppercased())"
        case let .review(r):
            if r.inProgress { return "REVIEW · UNDER WAY" }
            return "REVIEW · \(r.overturned ? "OVERTURNED" : "CALL STANDS")"
        case let .delay(d):
            switch d {
            case .injury: return "INJURY DELAY"
            case .onField: return "ON-FIELD DELAY"
            case let .weather(why): return why.lowercased().contains("rain") ? "RAIN DELAY" : "WEATHER DELAY"
            case .resuming: return "DELAY · ABOUT TO RESUME"
            case .over: return "PLAY RESUMES"
            }
        }
    }

    /// A pitch's call as the tag says it: the call and the count it makes,
    /// then the speed and MLB's name for it: "STRIKE 2 · 97 MPH FOUR-SEAM
    /// FASTBALL", "BALL 3 · 88 MPH SLIDER", "FOUL · 99 MPH SINKER". In a
    /// narrow well the name is the short one ("FOUR-SEAM"). A challenged
    /// call, as it was made: `challenge` says the rest.
    static func call(_ p: Pitch, wide: Bool, asCalled: Bool = false) -> String {
        var call = p.call
        var balls = p.balls, strikes = p.strikes
        if asCalled, let r = p.review, r.overturned {
            // The umpire's call before the zone overturned it.
            switch call {
            case .calledStrike: call = .ball; balls += 1; strikes -= 1
            case .ball: call = .calledStrike; strikes += 1; balls -= 1
            default: break
            }
        }
        let head: String = switch call {
        case .ball, .ballInDirt: "BALL \(balls)"
        case .calledStrike: "STRIKE \(strikes)"
        case .swingingStrike, .swingingBlocked: "STRIKE \(strikes) SWINGING"
        case .foul: "FOUL"
        case .foulTip: "FOUL TIP · STRIKE \(strikes)"
        case .foulBunt: "FOUL BUNT · STRIKE \(strikes)"
        case .missedBunt: "MISSED BUNT · STRIKE \(strikes)"
        case .automaticBall: "AUTOMATIC BALL \(balls) · PITCH CLOCK"
        case .automaticStrike: "AUTOMATIC STRIKE \(strikes) · PITCH CLOCK"
        }
        guard p.thrown else { return head }
        let names = wide ? GameDetail.Pitch.official : GameDetail.Pitch.names
        let name = p.code.flatMap { names[$0] }?.uppercased()
        let speed = p.mph.map { "\(Int($0.rounded())) MPH" }
        let tail = [speed, name].compactMap { $0 }.joined(separator: " ")
        return tail.isEmpty ? head : "\(head) · \(tail)"
    }

    /// A challenged pitch's second and third words: who challenged, then
    /// how it came out ("CHALLENGE · HICKS", "OVERTURNED · STRIKE 1").
    static func challenge(_ p: Pitch) -> (asked: String, result: String)? {
        guard let r = p.review else { return nil }
        let asked = ["ABS CHALLENGE", r.challenger.map { tagName($0).uppercased() }].compactMap { $0 }.joined(separator: " · ")
        let now: String = switch p.call {
        case .ball, .ballInDirt: "BALL \(p.balls)"
        default: "STRIKE \(p.strikes)"
        }
        return (asked, r.overturned ? "OVERTURNED · \(now)" : "CALL STANDS · \(now)")
    }
}
