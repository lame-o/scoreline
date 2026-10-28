import SwiftUI

// The scoring slide: a team scores on the open game page and a broadcast bar
// in its colors wipes in from its side of the hero (the left team's from the
// left), says what happened in type that reads across a room (HOME RUN,
// TOUCHDOWN, GOAL), what it was worth, who did it and the new score, holds,
// and wipes back out the way it came. Information first: only scores that
// arrive while the page is open (never history), one at a time in the order
// they happened, timed to the play theater's climax when the theater is on
// screen replaying the play, and one celebration per moment (the confetti
// stays a single burst, played wherever it's seen).
//
// This file is the pure part (tested): which moments slide and their words
// per sport, the side, the tier, the paint, the theater's timing, who bursts,
// and the line they wait in. ScoringSlideView.swift plays them.

// MARK: - Facts

/// What a feed knows about a score beyond its moment's caption: the score
/// after it, what it was worth, the feed's full account and its own kind of
/// play, and when. The feeds set it on scores; only the slide reads it.
struct ScoringFacts: Equatable {
    /// The score after the play, top team first.
    var top: Int?
    var bottom: Int?
    /// What it was worth as the feed counts it (runs, a touchdown and its try, a basket).
    var value: Int?
    /// The feed's full account ("Hicks homered to right center (411 feet), Caminero scored.").
    var text: String?
    /// The feed's own kind of play ("home-run", "goal---header", "Passing Touchdown").
    var type: String?
    /// The clock as the feed shows it ("52'", "13:25", "0.0").
    var clock: String?
    /// The inning, quarter or half.
    var period: Int?

    init(top: Int? = nil, bottom: Int? = nil, value: Int? = nil, text: String? = nil, type: String? = nil,
         clock: String? = nil, period: Int? = nil) {
        self.top = top
        self.bottom = bottom
        self.value = value
        self.text = text
        self.type = type
        self.clock = clock
        self.period = period
    }

    /// A baseball play-result. ESPN's score fields are the score after it,
    /// home and away; the visitors bat in the top of an inning.
    init(baseball item: JSON, batting: GameDetail.Side?) {
        if let batting, let home = item["homeScore"].int, let away = item["awayScore"].int {
            let visitorsBat = item["period"]["type"].string?.lowercased() != "bottom"
            let (bats, fields) = visitorsBat ? (away, home) : (home, away)
            (top, bottom) = batting == .top ? (bats, fields) : (fields, bats)
        }
        value = item["scoreValue"].int
        text = item["text"].string
        type = item["alternativeType"]["type"].string
        period = item["period"]["number"].int
    }

    /// A football scoring play: the score after it (its try included, once
    /// ESPN has added it) and what it added, from the score going in.
    init(football play: DrivePlay, before: (home: Int, away: Int)?, topIsHome: Bool) {
        if let home = play.homeScore, let away = play.awayScore {
            (top, bottom) = topIsHome ? (home, away) : (away, home)
            if let before { value = max(home - before.home, away - before.away) }
        }
        text = play.text
        type = play.type
        clock = play.clock
        period = play.period
    }

    /// A soccer goal: the score after it, the commentary line and the minute.
    init(soccer action: PitchAction) {
        top = action.topScore
        bottom = action.bottomScore
        value = 1
        text = action.account
        type = action.playType
        clock = action.minute
    }

    /// An NBA play.
    init(nba play: JSON, topIsHome: Bool) {
        if let score = LiveScore(play) {
            (top, bottom) = topIsHome ? (score.home, score.away) : (score.away, score.home)
        }
        value = play["scoreValue"].int
        text = play["text"].string
        clock = play["clock"]["displayValue"].string
        period = play["period"]["number"].int
    }
}

// MARK: - Teams and context

/// A side of the page, as a slide wears it.
struct SlideTeam: Equatable {
    /// "Brewers".
    var name: String
    /// "MIL".
    var abbreviation: String
    var logo: URL? = nil
    var darkLogo: URL? = nil
    /// Its own color and its second (hex).
    var color: String? = nil
    var alternate: String? = nil

    init(name: String, abbreviation: String, logo: URL? = nil, darkLogo: URL? = nil, color: String? = nil,
         alternate: String? = nil) {
        self.name = name
        self.abbreviation = abbreviation
        self.logo = logo
        self.darkLogo = darkLogo
        self.color = color
        self.alternate = alternate
    }

    init(_ c: Competitor) {
        self.init(name: c.name, abbreviation: c.abbreviation, logo: c.logo, darkLogo: c.darkLogo, color: c.color,
                  alternate: c.alternateColor)
    }
}

/// What the page knows that its moments don't: who's who, the round, the series.
struct SlideContext {
    var top: SlideTeam?
    var bottom: SlideTeam?
    /// Climbing: the round is a final (tops and new leaders slide only there).
    var final = false
    /// Climbing: everyone on the route, by ID.
    var climbers: [Int: GameDetail.WallRoute.Climber] = [:]
    /// CS2: the series' maps, for the maps score after one is won.
    var maps: [GameDetail.MapResult] = []

    func team(_ side: GameDetail.Side?) -> SlideTeam? {
        switch side {
        case .top?: top
        case .bottom?: bottom
        case nil: nil
        }
    }
}

// MARK: - Slide

/// One slide: everything it says and wears, decided from its moment.
struct ScoringSlide: Equatable, Identifiable {
    /// How big it plays. A normal score slides; a big one (a home run, a
    /// touchdown, a goal) adds the sheen and a spark at the logo; the top tier
    /// (a grand slam, a walk-off, a pick six, a late winner, a buzzer-beater,
    /// a match won) adds the confetti, when the page's one burst is the
    /// slide's, and holds longer.
    enum Tier: Int, Comparable {
        case normal, big, top
        static func < (a: Tier, b: Tier) -> Bool { a.rawValue < b.rawValue }
    }

    let id: String
    /// The scorer's side of the hero: it enters from there (nil, climbing: from the leading edge).
    var side: GameDetail.Side?
    var tier: Tier
    /// "HOME RUN", in heavy condensed caps.
    var headline: String
    /// A shorter headline for a narrow panel ("2-RUN HOMER").
    var short: String? = nil
    /// The chip: what it was worth ("+2"), or a place ("1ST"); nil without one.
    var chip: String? = nil
    /// Who and how: "Hicks · 411 ft · 108.6 mph · Caminero scores".
    var subline: String
    /// The new score, the scorer's first: "MIL 5–2".
    var score: String? = nil
    /// Its one VoiceOver announcement: "Brewers home run, Yelich, 2 runs, Brewers lead 5 to 2".
    var spoken: String
    /// Whose colors and logo it wears.
    var team: SlideTeam? = nil
    /// Climbing: the climber's flag, and the country whose colors it wears.
    var flag: String? = nil
    var country: String? = nil
    /// The moment it tells (its celebration's cue reads it).
    var moment: LiveMoment
    /// It plays the page's confetti for its moment (decided as it's queued).
    var confetti = false

    /// Seconds on screen once the wipe has landed, before it leaves.
    var hold: Double { tier == .top ? 6 : 4.5 }
    /// The edge it comes in from and leaves by.
    var edge: HorizontalEdge { side == .bottom ? .trailing : .leading }

    var paint: SlidePaint {
        if let country { return .flag(country) }
        return .team(team?.color, alternate: team?.alternate)
    }
}

// MARK: - Which moments slide, and what they say

extension ScoringSlide {
    /// The slide for a moment, or nil when the moment isn't one of its
    /// sport's scores. Baseball: any run. Football: a touchdown, field goal
    /// or safety (the try in the touchdown's line). Soccer: a goal. NBA: only
    /// what the page already ranks highest (a buzzer-beater, a clutch
    /// go-ahead, a run of 12 or more), never every basket. CS2: a map or the
    /// match won. Climbing, in a final: a top, a new leader, the final won.
    /// `batted` is Statcast's measurement of a home run, once it's in. (pure; tested)
    static func make(_ m: LiveMoment, context: SlideContext, batted: Statcast.Batted? = nil) -> ScoringSlide? {
        switch m.chart {
        case .plate: baseball(m, context, batted: batted)
        case .field: football(m, context)
        case .pitch: soccer(m, context)
        case .court: basketball(m, context)
        case .rounds: counterStrike(m, context)
        case .ascent: climbing(m, context)
        default: nil
        }
    }

    /// "MIL 5–2" (the scorer's number first) and how VoiceOver says where the
    /// game stands ("Brewers lead 5 to 2", "tied 1 to 1").
    static func standing(_ side: GameDetail.Side?, _ facts: ScoringFacts?, _ c: SlideContext) -> (line: String?, spoken: String?) {
        guard let side, let top = facts?.top, let bottom = facts?.bottom else { return (nil, nil) }
        let (mine, theirs) = side == .top ? (top, bottom) : (bottom, top)
        let me = c.team(side), them = c.team(MatchRules.opposite(side))
        let line = me.map { "\($0.abbreviation) \(mine)–\(theirs)" } ?? "\(mine)–\(theirs)"
        let spoken = mine == theirs ? "tied \(mine) to \(theirs)"
            : mine > theirs ? "\(me?.name ?? "they") lead \(mine) to \(theirs)" : "\(them?.name ?? "they") lead \(theirs) to \(mine)"
        return (line, spoken)
    }

    private static func spoken(_ parts: [String?]) -> String {
        parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }

    // MARK: Baseball

    private static func baseball(_ m: LiveMoment, _ c: SlideContext, batted: Statcast.Batted?) -> ScoringSlide? {
        guard m.tier == .score, m.kind == .homeRun || m.kind == .runScored else { return nil }
        let text = m.facts?.text ?? m.detail
        let play = BaseballPlay(text)
        let homer = m.kind == .homeRun
        let runs = max(m.facts?.value ?? play.scorers.count + (homer ? 1 : 0), 1)
        // BaseballFeed marks a walk-off decisive.
        let walkOff = m.decisive
        var headline: String, short: String? = nil, said: String
        if homer {
            switch (runs, walkOff) {
            // Baseball's own words: HOME RUN, 2-RUN HOMER, GRAND SLAM, WALK-OFF HOME RUN (HR, as the box score has it, when narrow).
            case (4, true): (headline, said) = ("WALK-OFF GRAND SLAM", "walk-off grand slam")
            case (4, false): (headline, said) = ("GRAND SLAM", "grand slam")
            case (_, true): (headline, short, said) = ("WALK-OFF HOME RUN", "WALK-OFF HR", "walk-off home run")
            case (1, false): (headline, said) = ("HOME RUN", "home run")
            default: (headline, said) = ("\(runs)-RUN HOMER", "\(runs)-run homer")
            }
        } else {
            let hit = BaseballPlay.hit(type: m.facts?.type, text: text)
            if walkOff {
                headline = hit.map { "WALK-OFF \($0)" } ?? "WALK-OFF"
            } else if let hit, hit == "SAC FLY" {
                headline = runs > 1 ? "\(runs)-RUN SAC FLY" : "SAC FLY"
            } else if let hit {
                headline = runs > 1 ? "\(runs)-RUN \(hit)" : "RBI \(hit)"
            } else {
                headline = runs > 1 ? "\(runs) RUNS SCORE" : "RUN SCORES"
            }
            said = headline.lowercased().replacingOccurrences(of: "rbi", with: "RBI")
        }
        var parts: [String] = []
        if homer {
            parts.append(play.batter ?? play.action)
            if let feet = batted?.distance.map({ Int($0.rounded()) }) ?? play.feet { parts.append("\(feet) ft") }
            // Statcast's exit velocity, labeled as Statcast labels it.
            if let speed = batted?.launchSpeed { parts.append(String(format: "EV %.1f mph", speed)) }
        } else {
            parts.append(play.action)
        }
        if let scored = BaseballPlay.scored(play.scorers) { parts.append(scored) }
        let side = m.side, team = c.team(side)
        let stands = standing(side, m.facts, c)
        return ScoringSlide(
            id: m.id, side: side,
            tier: walkOff || (homer && runs == 4) ? .top : homer ? .big : .normal,
            headline: headline, short: short, chip: "+\(runs)", subline: parts.joined(separator: " · "), score: stands.line,
            spoken: spoken([[team?.name, said].compactMap { $0 }.joined(separator: " "), play.batter,
                            runs == 1 ? "1 run" : "\(runs) runs", stands.spoken]),
            team: team, moment: m)
    }

    // MARK: Football

    private static func football(_ m: LiveMoment, _ c: SlideContext) -> ScoringSlide? {
        guard m.tier == .score, [.touchdown, .fieldGoal, .safety].contains(m.kind) else { return nil }
        // A safety's moment is the offense's; its points are the defense's.
        let side = MatchRules.scorer(of: m), team = c.team(side)
        let play = FootballPlay(m.facts?.text ?? m.detail)
        let pickSix = m.kind == .touchdown && play.how == .interception
        var headline: String, short: String? = nil, said: String
        switch m.kind {
        case .touchdown where pickSix:
            (headline, said) = ("PICK SIX", "pick six")
        case .touchdown:
            (headline, short, said) = m.decisive ? ("GO-AHEAD TOUCHDOWN", "GO-AHEAD TD", "go-ahead touchdown")
                : ("TOUCHDOWN", nil, "touchdown")
        case .fieldGoal:
            (headline, short, said) = m.decisive ? ("GO-AHEAD FIELD GOAL", "GO-AHEAD FG", "go-ahead field goal")
                : ("FIELD GOAL", nil, "field goal")
        default:
            (headline, said) = ("SAFETY", "safety")
        }
        let points = m.facts?.value.flatMap { $0 > 0 ? $0 : nil } ?? play.points(m.kind)
        let line = play.line ?? m.detail
        let stands = standing(side, m.facts, c)
        return ScoringSlide(
            id: m.id, side: side, tier: pickSix || m.decisive ? .top : m.kind == .touchdown ? .big : .normal,
            headline: headline, short: short, chip: "+\(points)",
            subline: [line, play.tryLine].compactMap { $0 }.joined(separator: " · "), score: stands.line,
            spoken: spoken([[team?.name, said].compactMap { $0 }.joined(separator: " "),
                            line.replacingOccurrences(of: "-yd ", with: "-yard "), play.trySpoken, stands.spoken]),
            team: team, moment: m)
    }

    // MARK: Soccer

    private static func soccer(_ m: LiveMoment, _ c: SlideContext) -> ScoringSlide? {
        guard m.kind == .goal else { return nil }
        let goal = SoccerGoal(caption: m.detail, text: m.facts?.text, type: m.facts?.type)
        // ESPN's team on an own goal is sometimes the scorer's: the line's own words say whose it is.
        let side = goal.beneficiary ?? m.side, team = c.team(side)
        var headline: String, short: String? = nil, said: String
        if m.decisive, let top = m.facts?.top, let bottom = m.facts?.bottom {
            // A late goal that changes the result: level is an equalizer, ahead a winner.
            (headline, short, said) = top == bottom ? ("LATE EQUALIZER", "EQUALIZER", "late equalizer") : ("LATE WINNER", "WINNER", "late winner")
        } else if goal.ownGoal {
            (headline, said) = ("OWN GOAL", "own goal")
        } else if goal.penalty {
            (headline, said) = ("PENALTY", "penalty")
        } else {
            (headline, said) = ("GOAL", "goal")
        }
        let minute = SlideWords.minuteMark(m.facts?.clock)
        let stands = standing(side, m.facts, c)
        let scorer = goal.team.map { "\(goal.scorer), \($0)" } ?? goal.scorer
        return ScoringSlide(
            id: m.id, side: side, tier: m.decisive ? .top : .big, headline: headline, short: short, chip: "+1",
            subline: [scorer, goal.how, goal.assist.map { "assisted by \($0)" }, minute].compactMap { $0 }.joined(separator: " · "),
            score: stands.line,
            spoken: spoken([[team?.name, said].compactMap { $0 }.joined(separator: " "), scorer, goal.how,
                            goal.assist.map { "assisted by \($0)" }, SlideWords.minute(minute), stands.spoken]),
            team: team, moment: m)
    }

    // MARK: Basketball

    private static func basketball(_ m: LiveMoment, _ c: SlideContext) -> ScoringSlide? {
        let side = m.side, team = c.team(side)
        // "Paul George 26-ft three point jumper", without the lead change's or run's score.
        let parts = m.detail.components(separatedBy: " · ")
        var shot = parts.first ?? m.detail
        var headline: String, short: String? = nil, chip: String?, tier: Tier, when: String?
        switch m.kind {
        case let .made(value) where m.accents.contains(.buzzer):
            headline = "BUZZER-BEATER"
            chip = "+\(m.facts?.value ?? value)"
            tier = .top
            when = m.facts?.period.map { "end of \(Period.label($0, sport: .basketball))" }
        case .leadChange where m.accents.contains(.clutch):
            let value = m.facts?.value ?? 2
            headline = value >= 3 ? "GO-AHEAD 3-POINTER" : value == 1 ? "GO-AHEAD FREE THROW" : "GO-AHEAD BASKET"
            short = value == 1 ? "GO-AHEAD FT" : nil
            chip = "+\(value)"
            tier = .big
            when = m.facts.flatMap { f in f.period.map { NBADetail.clockLabel(period: $0, clock: f.clock ?? "") } }
        case .run:
            // "12–0 run": only the big ones (the page's milestones from 12 on).
            guard let match = m.lead.firstMatch(of: #/^(\d+)–(\d+)/#), let larger = Int(match.1), let smaller = Int(match.2),
                  larger - smaller >= 12 else { return nil }
            headline = "\(larger)–\(smaller) RUN"
            chip = nil
            tier = .normal
            when = nil
            // "NY · Josh Hart layup": the team, then the basket that made it.
            shot = parts.count > 1 ? parts[1] : shot
        default:
            return nil
        }
        let stands = standing(side, m.facts, c)
        let said = headline.lowercased()
        return ScoringSlide(
            id: m.id, side: side, tier: tier, headline: headline, short: short, chip: chip,
            subline: [shot, when].compactMap { $0 }.joined(separator: " · "), score: stands.line,
            spoken: spoken([[team?.name, said].compactMap { $0 }.joined(separator: " "), shot, stands.spoken]),
            team: team, moment: m)
    }

    // MARK: CS2

    private static func counterStrike(_ m: LiveMoment, _ c: SlideContext) -> ScoringSlide? {
        guard m.kind == .mapWon, let side = m.side else { return nil }
        let team = c.team(side)
        // "NAVI take Mirage 13–9 and the series 2–0" (the map's score top team first).
        let map = m.detail.firstMatch(of: #/ take (.+?) (\d+)–(\d+)/#)
        let rounds = map.map { side == .top ? (String($0.2), String($0.3)) : (String($0.3), String($0.2)) }
        let number = m.id.split(separator: ":").dropFirst().first.flatMap { Int($0) }
        let series = number.flatMap { MatchRules.series(after: $0, winner: side, maps: c.maps) }
        let mapLine = map.flatMap { m in rounds.map { "\(m.1) \($0.0)–\($0.1)" } }
        return ScoringSlide(
            id: m.id, side: side, tier: m.decisive ? .top : .big, headline: m.decisive ? "MATCH WON" : "MAP WON", chip: "+1",
            subline: [mapLine, series.map { "maps \($0.wins)–\($0.losses)" }].compactMap { $0 }.joined(separator: " · "),
            score: series.map { [team?.abbreviation, "\($0.wins)–\($0.losses)"].compactMap { $0 }.joined(separator: " ") },
            spoken: spoken([team.map { "\($0.name) win \(map.map { String($0.1) } ?? "the map")" }, rounds.map { "\($0.0) to \($0.1)" },
                            m.decisive ? "and the match" : nil, series.map { "\($0.wins) maps to \($0.losses)" }]),
            team: team, moment: m)
    }

    // MARK: Climbing

    private static func climbing(_ m: LiveMoment, _ c: SlideContext) -> ScoringSlide? {
        guard c.final, m.tier == .score else { return nil }
        // "climb:12:1" (a top), "pass:12:7" (a pass), "decided:1" (its winner in targets).
        let fields = m.id.split(separator: ":")
        let id = m.kind == .finished ? m.targets.first.flatMap { Int($0) } : fields.count > 1 ? Int(fields[1]) : nil
        let climber = id.flatMap { c.climbers[$0] }
        let name = climber?.name ?? m.detail.components(separatedBy: " · ").first ?? m.detail
        var headline: String, tier = Tier.big, chip: String? = nil, note: String?
        switch m.kind {
        case .top:
            headline = "TOP"
            if m.decisive {
                tier = .top
                chip = "1ST"
                note = "wins the final"
            } else if m.accents.contains(.newLeader) {
                chip = "1ST"
                note = "new leader"
            } else {
                note = m.accents.contains(.podium) ? "into the medals" : nil
            }
        case .passed where m.accents.contains(.newLeader):
            headline = "NEW LEADER"
            chip = "1ST"
            let passed = m.targets.compactMap { Int($0).flatMap { c.climbers[$0]?.name } }
            note = passed.last.map { "passes \(MatchMark.surname($0))" }
        case .finished where m.decisive:
            headline = "GOLD"
            tier = .top
            chip = "1ST"
            note = climber?.label
        default:
            return nil
        }
        return ScoringSlide(
            id: m.id, side: nil, tier: tier, headline: headline, chip: chip,
            subline: [name, note].compactMap { $0 }.joined(separator: " · "),
            spoken: spoken([headline.prefix(1) + headline.dropFirst().lowercased(), name, note]),
            flag: climber?.flag ?? Flag.emoji(ioc: climber?.country), country: climber?.country ?? "", moment: m)
    }
}

// MARK: - Reading the feeds' words

/// ESPN's account of a run-scoring play, read for the slide: the batter and
/// what he did (in the present tense, as a broadcast says it), how far a home
/// run went, and who scored. (pure; tested)
struct BaseballPlay: Equatable {
    var batter: String?
    /// "Yelich singles to left"; the clause as written when it can't be read.
    var action: String
    /// A home run's distance, as ESPN gives it ("(411 feet)").
    var feet: Int?
    /// Who crossed the plate, in order (the batter's own run on a home run isn't listed).
    var scorers: [String] = []

    private static let present = [
        "homered": "homers", "singled": "singles", "doubled": "doubles", "tripled": "triples", "walked": "walks",
        "reached": "reaches", "grounded": "grounds", "flied": "flies", "lined": "lines", "popped": "pops",
        "hit": "hits", "struck": "strikes", "was": "is", "sacrificed": "sacrifices", "bunted": "bunts",
        "fouled": "fouls", "safe": "safe", "intentionally": "intentionally",
    ]

    init(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        let sentence = trimmed.hasSuffix(".") ? String(trimmed.dropLast()) : trimmed
        var main: String?
        for clause in sentence.components(separatedBy: ", ") {
            if clause.contains(" scored") {
                // "Chourio scored and Yelich scored", "Pratt scored on error".
                for part in clause.components(separatedBy: " and ") {
                    if let r = part.range(of: " scored") { scorers.append(String(part[..<r.lowerBound])) }
                }
            } else if main == nil {
                main = clause
            }
        }
        var clause = main ?? sentence
        if let match = clause.firstMatch(of: #/ ?\((\d+) feet\)/#) {
            feet = Int(match.1)
            clause.removeSubrange(match.range)
        }
        let words = clause.split(separator: " ").map(String.init)
        if let i = words.firstIndex(where: { Self.present[$0.lowercased()] != nil }), i > 0 {
            batter = words[..<i].joined(separator: " ")
            action = (words[..<i] + [Self.present[words[i].lowercased()]!] + words[(i + 1)...]).joined(separator: " ")
        } else {
            action = clause
        }
    }

    /// "Caminero scores", "Chourio and Yelich score", "Chourio, Yelich and Turang score".
    static func scored(_ names: [String]) -> String? {
        guard let last = names.last else { return nil }
        if names.count == 1 { return "\(last) scores" }
        return names.dropLast().joined(separator: ", ") + " and \(last) score"
    }

    /// The hit in a headline ("SINGLE", "SAC FLY"), from the play's own kind
    /// (or, on a trimmed feed, its verb); nil for a run scored any other way.
    static func hit(type: String?, text: String) -> String? {
        switch type {
        case "single"?, "bunt-single"?: return "SINGLE"
        case "double"?, "ground-rule-double"?: return "DOUBLE"
        case "triple"?: return "TRIPLE"
        case "sacrifice-fly"?: return "SAC FLY"
        case nil: break
        default: return nil
        }
        let lower = text.lowercased()
        if lower.contains("sacrifice fly") { return "SAC FLY" }
        for (verb, hit) in [("singled", "SINGLE"), ("infield single", "SINGLE"), ("doubled", "DOUBLE"), ("tripled", "TRIPLE")]
        where lower.contains(verb) {
            return hit
        }
        return nil
    }
}

/// ESPN's short line for a football score, read for the slide ("Dameon Pierce
/// 5 Yd Rush (Jake Elliott Kick)"): who, how far, how, the passer, and the
/// try after a touchdown. (pure; tested)
struct FootballPlay: Equatable {
    enum How: Equatable { case run, pass, interception, fumble, puntReturn, kickoffReturn, fieldGoal, other(String) }
    enum Try: Equatable {
        case kick(good: Bool)
        /// A two-point try by pass or by run.
        case twoPoint(good: Bool, pass: Bool)
    }

    var who: String?
    var yards: Int?
    var how: How?
    var passer: String?
    /// The try, once ESPN has added it.
    var attempt: Try?

    init(_ short: String) {
        var main = short.trimmingCharacters(in: .whitespaces)
        if main.hasSuffix(")"), let open = main.lastIndex(of: "(") {
            attempt = Self.attempt(String(main[main.index(after: open)..<main.index(before: main.endIndex)]))
            main = String(main[..<open]).trimmingCharacters(in: .whitespaces)
        }
        guard let match = main.firstMatch(of: #/^(.+?) (\d+) Yd (.+)$/#) else { return }
        who = String(match.1)
        yards = Int(match.2)
        let rest = String(match.3), lower = rest.lowercased()
        if lower.hasPrefix("pass from ") {
            how = .pass
            passer = String(rest.dropFirst("pass from ".count))
        } else if lower == "rush" || lower == "run" {
            how = .run
        } else if lower.contains("interception") {
            how = .interception
        } else if lower.contains("fumble") {
            how = .fumble
        } else if lower.contains("punt return") {
            how = .puntReturn
        } else if lower.contains("kickoff return") || lower.contains("kick return") {
            how = .kickoffReturn
        } else if lower.contains("field goal") {
            how = .fieldGoal
        } else {
            how = .other(lower)
        }
    }

    /// "(Jake Elliott Kick)", "(Kick Failed)", "(Dak Prescott Run for Two-Point Conversion)",
    /// "(Two-Point Pass Conversion Failed)".
    static func attempt(_ text: String) -> Try? {
        let lower = text.lowercased()
        let failed = lower.contains("fail") || lower.contains("no good") || lower.contains("blocked") || lower.contains("missed")
        if lower.contains("two-point") || lower.contains("two point") || lower.contains("2-pt") {
            return .twoPoint(good: !failed, pass: lower.contains("pass"))
        }
        if lower.contains("kick") || lower.contains("pat") || lower.contains("extra point") { return .kick(good: !failed) }
        return nil
    }

    /// "D. Pierce 5-yd run", "C. Lamb 16-yd pass from D. Prescott", "B. Aubrey from 55 yards".
    var line: String? {
        guard let who, let yards, let how else { return nil }
        let name = SlideWords.initialed(who)
        switch how {
        case .run: return "\(name) \(yards)-yd run"
        case .pass: return "\(name) \(yards)-yd pass" + (passer.map { " from \(SlideWords.initialed($0))" } ?? "")
        case .interception: return "\(name) \(yards)-yd interception return"
        case .fumble: return "\(name) \(yards)-yd fumble return"
        case .puntReturn: return "\(name) \(yards)-yd punt return"
        case .kickoffReturn: return "\(name) \(yards)-yd kickoff return"
        case .fieldGoal: return "\(name) from \(yards) yards"
        case let .other(words): return "\(name) \(yards)-yd \(words)"
        }
    }

    /// The try in the NFL's words: "PAT good", "PAT no good", "2-pt conversion
    /// good" (or no good); nil until the try is in.
    var tryLine: String? {
        switch attempt {
        case .kick(true)?: "PAT good"
        case .kick(false)?: "PAT no good"
        case .twoPoint(true, _)?: "2-pt conversion good"
        case .twoPoint(false, _)?: "2-pt conversion no good"
        case nil: nil
        }
    }

    var trySpoken: String? {
        switch attempt {
        case .kick(true)?: "extra point good"
        case .kick(false)?: "extra point no good"
        case let .twoPoint(true, pass)?: "two-point conversion good, by \(pass ? "pass" : "run")"
        case .twoPoint(false, _)?: "two-point conversion no good"
        case nil: nil
        }
    }

    /// What the play was worth when the feed doesn't say: a touchdown and its try, a field goal, a safety.
    func points(_ kind: LiveMoment.Kind) -> Int {
        switch kind {
        case .touchdown:
            switch attempt {
            case .kick(true)?: 7
            case .twoPoint(true, _)?: 8
            default: 6
            }
        case .fieldGoal: 3
        default: 2
        }
    }
}

/// A goal as the slide tells it: the scorer (and, for an own goal, his
/// team), how it went in, and the assist, from the moment's caption and
/// ESPN's commentary line. (pure; tested)
struct SoccerGoal: Equatable {
    var scorer: String
    /// An own goal's scorer's own team.
    var team: String?
    /// "header", "right foot", "volley", "penalty"; nil when the line doesn't say.
    var how: String?
    var assist: String?
    var ownGoal = false
    var penalty = false
    /// An own goal's beneficiary, when the line names the scorer's team and
    /// the score ("Own Goal by Mike Penders, Chelsea. Chelsea 0, Tottenham Hotspur 1."):
    /// the home team is named first.
    var beneficiary: GameDetail.Side?

    /// `caption`: the moment's ("Erling Haaland (header)", "Mike Penders (OG)",
    /// "Oliver McBurnie (pen)"). `text`: "Goal! Aston Villa 1, Manchester City 1.
    /// Erling Haaland (Manchester City) header from very close range … Assisted by Iliman Ndiaye with a cross …".
    init(caption: String, text: String?, type: String?) {
        scorer = caption.components(separatedBy: " (").first ?? caption
        let line = text ?? "", lower = line.lowercased()
        ownGoal = type == "own-goal" || caption.hasSuffix("(OG)") || lower.hasPrefix("own goal")
        penalty = type == "penalty---scored" || caption.hasSuffix("(pen)") || lower.contains("converts the penalty")
        if ownGoal, let match = line.firstMatch(of: #/Own Goal by (.+?), (.+?)\. (.+?) \d+, (.+?) \d+\./#) {
            scorer = String(match.1)
            team = String(match.2)
            beneficiary = match.2 == match.3 ? .bottom : match.2 == match.4 ? .top : nil
        } else if ownGoal, let match = line.firstMatch(of: #/Own Goal by (.+?), (.+?)\./#) {
            scorer = String(match.1)
            team = String(match.2)
        }
        if penalty {
            how = "penalty"
        } else if !ownGoal {
            switch type {
            case "goal---header"?: how = "header"
            case "goal---volley"?: how = "volley"
            case "goal---free-kick"?: how = "free kick"
            default:
                how = lower.contains(") header") ? "header" : lower.contains("left footed") ? "left foot"
                    : lower.contains("right footed") ? "right foot" : nil
            }
        }
        if let match = line.firstMatch(of: #/Assisted by (.+?)(?: with | following |\.|$)/#) { assist = String(match.1) }
    }
}

/// Small words the slides share.
enum SlideWords {
    /// "Dameon Pierce" → "D. Pierce"; a single name stays as it is.
    static func initialed(_ name: String) -> String {
        let words = name.split(separator: " ")
        guard words.count > 1, let first = words.first?.first else { return name }
        return "\(first). " + words.dropFirst().joined(separator: " ")
    }

    /// The minute as soccer writes it: "37'", stoppage time "90+3'" (ESPN sends "90'+3'").
    static func minuteMark(_ clock: String?) -> String? {
        guard let clock, !clock.isEmpty else { return nil }
        let mark = clock.replacingOccurrences(of: "'+", with: "+")
        return mark.hasSuffix("'") || !mark.contains(where: \.isNumber) ? mark : mark + "'"
    }

    /// "52'" → "52nd minute"; stoppage time ("90+3'") as the minute it is (93rd).
    static func minute(_ clock: String?) -> String? {
        guard let clock else { return nil }
        let numbers = clock.split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }
        guard !numbers.isEmpty else { return nil }
        return "\(Ordinal.string(numbers.reduce(0, +))) minute"
    }
}

// MARK: - Paint

/// The slab's paint: the team's own color (its second when the first is too
/// dark or too light to read as a color), white or black type on it,
/// whichever reads, and the wipe's stripe in the other color. Colors are
/// moved in OKLab, so only lightness changes and the team stays itself. (pure; tested)
struct SlidePaint: Equatable {
    var slab: OKLab
    var stripe: OKLab
    /// White type: the slab is dark (and logos take their dark-background variant).
    var lightInk: Bool

    var slabColor: Color { Color(nsColor: slab.nsColor) }
    var stripeColor: Color { Color(nsColor: stripe.nsColor) }
    var ink: Color { lightInk ? .white : Color(white: 0.08) }

    /// Near black or near white, with no hue to speak of.
    private static func neutral(_ lab: OKLab) -> Bool { lab.chroma < 0.04 && (lab.l < 0.25 || lab.l > 0.93) }
    /// A color with a hue (not white, black or gray).
    private static func real(_ lab: OKLab) -> Bool { lab.chroma >= 0.05 }

    static func team(_ hex: String?, alternate: String?) -> SlidePaint {
        let own = hex.flatMap(OKLab.init(hex:)), second = alternate.flatMap(OKLab.init(hex:))
        var slab = own ?? OKLab(l: 0.56, chroma: 0.16, hue: 255)
        var stripe = second
        if neutral(slab), let second, real(second) {
            // Black or white with a real second color: wear the second, keep the first as the stripe.
            stripe = slab
            slab = second
        }
        if neutral(slab) {
            // Still black or white: charcoal, or white with dark type.
            slab = slab.l < 0.5 ? OKLab(l: 0.27, a: 0, b: 0) : OKLab(l: 0.97, a: 0, b: 0)
        } else {
            // Dark enough to read as the color on a dark panel, never past pale.
            slab = OKLab(l: min(max(slab.l, 0.32), 0.92), chroma: slab.chroma, hue: slab.hue)
        }
        let ink = lightInk(on: slab)
        if stripe.map({ $0.distance(to: slab) < 0.12 }) ?? true {
            stripe = ink ? OKLab(l: 0.98, a: 0, b: 0) : OKLab(l: 0.18, a: 0, b: 0)
        }
        return SlidePaint(slab: slab, stripe: stripe!, lightInk: ink)
    }

    /// A climber's: the flag's two colors (white for a one-color flag's stripe).
    static func flag(_ ioc: String?) -> SlidePaint {
        guard let (a, b) = FlagPalette.colors(ioc: ioc),
              let first = NSColor(a).usingColorSpace(.sRGB).flatMap(OKLab.init),
              let second = NSColor(b).usingColorSpace(.sRGB).flatMap(OKLab.init) else {
            return team(nil, alternate: nil)
        }
        let ink = lightInk(on: first)
        return SlidePaint(slab: first, stripe: second.distance(to: first) < 0.12 ? OKLab(l: 0.98, a: 0, b: 0) : second, lightInk: ink)
    }

    /// WCAG contrast of white and of near-black type on the slab: white when
    /// it reaches 4:1 (the headline is large type) or beats black.
    static func lightInk(on slab: OKLab) -> Bool {
        let c = slab.rgb
        func linear(_ v: Double) -> Double { v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
        let luminance = 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b)
        let white = 1.05 / (luminance + 0.05), black = (luminance + 0.05) / 0.05
        return white >= 4 || white > black
    }
}

// MARK: - Timing

/// A play theater a slide follows: the news play it holds (replaying it, or
/// about to) and that replay's climax in seconds, read from the theater's
/// own script.
struct SlideTheater {
    let playing: @MainActor () -> String?
    let climax: @MainActor () -> Double?
}

extension SlideTheater {
    /// Baseball: the play is published once Statcast has measured it (or
    /// after a short hold), and replays from its pitch.
    @MainActor static func baseball(_ feed: BaseballFeed) -> SlideTheater {
        SlideTheater(playing: { feed.theater.news ? feed.theater.play?.id : nil }, climax: {
            guard let play = feed.theater.play else { return nil }
            let rest = PlayScript.Rest(bases: play.endsInning ? [false, false, false] : play.basesAfter, bats: feed.theater.bats,
                                       swapped: play.endsInning)
            return ScoringSlide.climax(PlayScript(play, rest: rest))
        })
    }

    @MainActor static func football(_ feed: FootballFeed) -> SlideTheater {
        SlideTheater(playing: { feed.theater.news ? feed.theater.play?.id : nil },
                     climax: { feed.theater.play.flatMap { ScoringSlide.climax(FootballScript($0)) } })
    }

    @MainActor static func soccer(_ feed: SoccerFeed) -> SlideTheater {
        SlideTheater(playing: { feed.theater.news ? feed.theater.scene?.id : nil },
                     climax: { feed.theater.scene.flatMap { ScoringSlide.climax(SoccerScript($0, lineups: feed.theater.lineups)) } })
    }

    /// The NBA: the basket the court's theater replays (published with its moment).
    @MainActor static func basketball(_ feed: BasketballFeed) -> SlideTheater {
        SlideTheater(playing: { feed.theater.news ? feed.theater.scene?.id : nil },
                     climax: { feed.theater.scene.flatMap { ScoringSlide.climax(BasketballScript($0)) } })
    }
}

extension ScoringSlide {
    /// The wipe starts this long before the theater's climax, so it lands with it.
    static let climaxLead = 0.2

    /// A baseball replay's climax: the ball clearing the fence, else the first runner home.
    static func climax(_ script: PlayScript) -> Double? {
        script.fence?.at ?? script.flashes.first { $0.beat == .run }?.at
    }

    /// Football: the ball crossing the goal line (or over the crossbar).
    static func climax(_ script: FootballScript) -> Double? { script.score }

    /// Soccer: the ball hitting the net.
    static func climax(_ script: SoccerScript) -> Double? {
        script.impacts.first { $0.kind == .net }?.at
    }

    /// Basketball: the ball through the net.
    static func climax(_ script: BasketballScript) -> Double? { script.score }
}

/// How a queued slide meets the page.
struct SlidePlan {
    /// The theater or chart that celebrates this moment is on screen.
    var ownerVisible = false
    /// The theater that replays the play, when the page has one.
    var theater: SlideTheater? = nil
    /// Land with the theater's climax (it's on screen and replays the play);
    /// otherwise only wait for it to take the play (Statcast), then show.
    var follow = false
    /// The longest to wait for the theater to take the play, in seconds.
    var patience: Double = 0
    /// Statcast's measurement of the play, once it's in.
    var batted: (@MainActor () -> Statcast.Batted?)? = nil
}

// MARK: - Who bursts

extension ScoringSlide {
    /// Whether a top-tier slide plays the page's confetti for its moment. One
    /// burst per moment, where it's seen: the theater or chart that owns the
    /// moment plays the burst the page granted it when it's on screen;
    /// otherwise the slide does. A moment no chart bursts for (a CS2 match
    /// won) claims the page's cooldown for the slide. (pure; tested)
    static func playsConfetti(tier: Tier, granted: Bool, pageBursts: Bool, ownerVisible: Bool, claim: () -> Bool) -> Bool {
        guard tier == .top else { return false }
        if granted { return !ownerVisible }
        return !pageBursts && claim()
    }
}

// MARK: - The line

/// The slides waiting their turn, in the order their scores happened: one on
/// screen at a time, a catch-up only its newest (old news by the time it
/// lands), at most three waiting, and never the same play twice. (pure; tested)
struct SlideLine: Equatable {
    private(set) var waiting: [ScoringSlide] = []
    /// Every ID offered, so an edited play offered again never slides twice.
    private(set) var taken: Set<String> = []

    static let capacity = 3

    /// One update's slides, in play order. Returns those that joined.
    @discardableResult
    mutating func offer(_ slides: [ScoringSlide], catchUp: Bool) -> [ScoringSlide] {
        let fresh = slides.filter { !taken.contains($0.id) }
        taken.formUnion(fresh.map(\.id))
        let joining = catchUp ? (fresh.last { $0.tier == .top } ?? fresh.last).map { [$0] } ?? [] : fresh
        waiting += joining
        // Too many: the oldest that isn't top tier gives way.
        while waiting.count > Self.capacity {
            waiting.remove(at: waiting.firstIndex { $0.tier < .top } ?? 0)
        }
        return joining.filter { s in waiting.contains { $0.id == s.id } }
    }

    var first: ScoringSlide? { waiting.first }

    mutating func next() -> ScoringSlide? {
        waiting.isEmpty ? nil : waiting.removeFirst()
    }

    mutating func retract(_ ids: Set<String>) {
        waiting.removeAll { ids.contains($0.id) }
    }

    /// Nobody's waiting any more (the page went away); what was offered stays offered.
    mutating func drain() { waiting = [] }

    func carries(_ id: String) -> Bool { taken.contains(id) }
}
