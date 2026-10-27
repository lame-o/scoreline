import Foundation

// Results data: what a finished game adds to its row (`ResultParse`,
// `ResultLine`), the rounds a league's results page steps through
// (`Rounds`), a team's season (`TeamSeasons`) and a CS2 team's history
// (`CSHistory`). Pure functions over response bytes and parsed items. The
// ESPN parser runs inside `ScheduleProvider.ESPN.item`, so it runs in the
// cache's detached parse task, and every string a row shows is made here,
// once. Findings behind each rule: specs/results.md §1, §3.2, §3.3, §11.

// MARK: - Parsing

enum ResultParse {
    /// One side of an ESPN competition, as a result needs it (boards and
    /// team schedules: `score` is a string on one, `{value, displayValue}`
    /// on the other).
    struct Side {
        /// ESPN's own team ID ("367"), which `details[].team.id` refers to.
        let id: String?
        /// "Spurs"
        let name: String
        /// "Tottenham Hotspur"
        let fullName: String
        /// "Milwaukee"
        let location: String?
        let abbreviation: String
        let score: Int?
        let espnWinner: Bool
        let shootout: Int?
        let aggregate: Int?
        /// W+D+L of the record after this game (soccer).
        let gamesPlayed: Int?

        init(_ comp: JSON) {
            let t = comp["team"]
            id = t["id"].string
            name = t["shortDisplayName"].string ?? t["displayName"].string ?? "TBD"
            fullName = t["displayName"].string ?? name
            // Boards don't carry `location`: "Milwaukee Brewers" less "Brewers".
            location = t["location"].string ?? (fullName.hasSuffix(" " + name) ? String(fullName.dropLast(name.count + 1)) : nil)
            abbreviation = t["abbreviation"].string ?? String(name.prefix(3)).uppercased()
            score = (comp["score"].string ?? comp["score"]["displayValue"].string).flatMap { Int($0) }
            espnWinner = comp["winner"].bool ?? false
            shootout = comp["shootoutScore"].int
            aggregate = comp["aggregateScore"].int
            let record = comp["records"].array.first { $0["type"].string == "total" }?["summary"].string
                ?? comp["record"].array.first { $0["type"].string == "total" }?["displayValue"].string
            gamesPlayed = record.flatMap(Self.played)
        }

        /// "7-0-1" → 8; nil unless every part is a number.
        static func played(_ record: String) -> Int? {
            let parts = record.split(whereSeparator: { $0 == "-" || $0 == "–" }).map { Int($0) }
            guard !parts.isEmpty, parts.allSatisfy({ $0 != nil }) else { return nil }
            return parts.reduce(0) { $0 + ($1 ?? 0) }
        }
    }

    /// What a finished, postponed or canceled ESPN game adds to its row:
    /// label, scorers, decisions, performers, context, and every string a row
    /// shows. `top`/`bottom` are the competitors in house order; `notes` are
    /// the item's rewritten notes (`ESPN.caption`, with a postseason series).
    /// Nil for games not yet played.
    static func espn(_ e: JSON, competition c: JSON, sport: Sport, top topJSON: JSON, bottom bottomJSON: JSON,
                     status: ScheduleStatus, notes: [String] = []) -> ResultDetail? {
        guard status == .final || status == .postponed || status == .canceled else { return nil }
        let type = c["status"]["type"].exists ? c["status"]["type"] : e["status"]["type"]
        let name = type["name"].string ?? ""
        let short = type["shortDetail"].string ?? type["detail"].string
        let top = Side(topJSON), bottom = Side(bottomJSON)
        var r = ResultDetail(label: status == .canceled ? "Canceled" : "Postponed")
        let headlines = c["notes"].array.compactMap { $0["headline"].string }.filter { !$0.isEmpty }

        guard status == .final else {
            r.context = notes.isEmpty ? nil : notes.joined(separator: " · ")
            r.spoken = ResultLine.spoken(r, sport: sport, top: top, bottom: bottom, status: status, notes: notes)
            return r
        }

        switch name {
        case "STATUS_FINAL_PEN": (r.kind, r.label) = (.penalties, "Pens")
        case "STATUS_FINAL_AET": (r.kind, r.label) = (.extraTime, "AET")
        case "STATUS_SUSPENDED": (r.kind, r.label) = (.suspended, "Suspended")
        case "STATUS_ABANDONED": (r.kind, r.label) = (.abandoned, "Abandoned")
        case let n where isAwarded(n): (r.kind, r.label) = (.forfeit, "Forfeit")
        default:
            let label = short ?? (sport == .soccer ? "FT" : "Final")
            switch label {
            case "FT-Pens", "Pens": (r.kind, r.label) = (.penalties, "Pens")
            case "AET": (r.kind, r.label) = (.extraTime, "AET")
            default:
                r.label = label
                if label.hasPrefix("Final/") || label.hasPrefix("F/") { r.kind = .overtime }
            }
        }
        r.periods = c["status"]["period"].int ?? e["status"]["period"].int

        // Shootout: the scoreboard says it; team schedules only say it in a
        // note ("Arsenal win 5-4 on penalties"), whose first number is the winner's.
        if r.kind == .penalties {
            if let a = top.shootout, let b = bottom.shootout {
                r.shootout = .init(top: a, bottom: b)
            } else if let (w, l) = penaltyNote(headlines) {
                let topWon = top.espnWinner || (!bottom.espnWinner && names(headlines, top))
                r.shootout = topWon ? .init(top: w, bottom: l) : .init(top: l, bottom: w)
            }
            if let s = r.shootout, s.top != s.bottom { r.advances = s.top > s.bottom ? top.fullName : bottom.fullName }
        }

        // Two legs: aggregate, leg, and who went through (ESPN's `winner`
        // follows the tie, not this match).
        let series = c["series"]
        if let a = top.aggregate ?? aggregate(series, top.id), let b = bottom.aggregate ?? aggregate(series, bottom.id) {
            r.aggregate = .init(top: a, bottom: b)
        }
        r.leg = c["leg"]["value"].int
        if r.aggregate != nil, r.leg == 2 || series["completed"].bool == true {
            let tieWinner = series["competitors"].array.first { $0["winner"].bool == true }?["id"].string
            if let tieWinner {
                r.advances = tieWinner == top.id ? top.fullName : tieWinner == bottom.id ? bottom.fullName : r.advances
            } else if let agg = r.aggregate, agg.top != agg.bottom {
                r.advances = agg.top > agg.bottom ? top.fullName : bottom.fullName
            }
        }

        if sport == .soccer {
            let slug = e["season"]["slug"].string
            // A season's own slug ("2026-27-english-premier-league") isn't a stage.
            r.stage = slug.flatMap { $0.prefix(4).allSatisfy(\.isNumber) ? nil : $0 }
            r.gamesPlayed = [top.gamesPlayed, bottom.gamesPlayed].compactMap { $0 }.max()
            r.scorers = scorers(c, top: top, bottom: bottom)
        }
        if r.kind != .forfeit {
            switch sport {
            case .football: r.performers = footballLeaders(c, top: top)
            case .basketball: r.performers = basketballLeaders(topJSON, top: true) + basketballLeaders(bottomJSON, top: false)
            case .baseball: r.decisions = decisions(c["status"]["featuredAthletes"].exists ? c["status"] : e["status"])
            default: break
            }
        }
        let postseason = e["season"]["slug"].string == "post-season" || e["seasonType"]["type"].int == 3
        if postseason, let summary = series["summary"].string { r.series = MLBPostseason.shortSummary(summary) }
        r.headline = c["headlines"][0]["shortLinkText"].string ?? c["headlines"][0]["description"].string
        r.attendance = c["attendance"].int.flatMap { $0 > 0 ? $0 : nil }

        let verb = headlines.contains { $0.localizedCaseInsensitiveContains(" advance") } ? "advance" : "win"
        ResultLine.fill(&r, sport: sport, top: top, bottom: bottom, notes: postseason ? notes : [], shootoutVerb: verb)
        return r
    }

    /// Forfeits and walkovers (ESPN vocabulary, not yet seen in a sample):
    /// awarded results, whose score (if any) is a formality.
    static func isAwarded(_ statusName: String) -> Bool {
        statusName.contains("FORFEIT") || statusName.contains("WALKOVER")
    }

    /// The score rule (§1.1): the side that won the match is the winner,
    /// whatever ESPN's `winner` says about the tie; level scores keep ESPN's
    /// (a shootout). A forfeit hides its score; an abandoned or suspended
    /// game has no winner.
    static func settle(_ top: inout ScheduleTeam, _ bottom: inout ScheduleTeam, result: ResultDetail?) {
        guard let result else { return }
        switch result.kind {
        case .forfeit:
            top.score = nil
            bottom.score = nil
        case .abandoned, .suspended:
            top.winner = false
            bottom.winner = false
        default:
            if let a = top.score.flatMap({ Int($0) }), let b = bottom.score.flatMap({ Int($0) }), a != b {
                top.winner = a > b
                bottom.winner = b > a
            }
        }
    }

    /// A CS2 match from bo3.gg, finished or forfeited (`defwin`, whose 1–0
    /// is fake): the label, and for a forfeit no score and who it went to.
    static func counterStrike(_ item: ScheduleItem) -> ScheduleItem {
        guard item.status == .final, var top = item.top, var bottom = item.bottom else { return item }
        var item = item
        var r = ResultDetail(label: "Final")
        if item.statusDetail == "Forfeit" {
            r.kind = .forfeit
            r.label = "Forfeit"
            top.score = nil
            bottom.score = nil
            let winner = top.winner ? top : bottom.winner ? bottom : nil
            r.context = winner.map { "Awarded to \($0.name)" }
            r.spoken = "\(top.name) versus \(bottom.name), forfeit" + (winner.map { ", awarded to \($0.name)." } ?? ".")
        } else if let a = top.score, let b = bottom.score {
            let winner = top.winner ? top.name : bottom.winner ? bottom.name : nil
            r.spoken = "\(top.name) \(a), \(bottom.name) \(b), final" + (winner.map { ", \($0) won." } ?? ".")
        }
        item.top = top
        item.bottom = bottom
        item.result = r
        return item
    }

    // MARK: Pieces

    /// "Egypt advance 4-2 on penalties" → (4, 2).
    static func penaltyNote(_ headlines: [String]) -> (Int, Int)? {
        for h in headlines {
            guard let range = h.range(of: #"(\d+)-(\d+) on penalties"#, options: .regularExpression) else { continue }
            let numbers = h[range].split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }
            if numbers.count >= 2 { return (numbers[0], numbers[1]) }
        }
        return nil
    }

    /// Whether a note names this side ("Arsenal win …").
    private static func names(_ headlines: [String], _ side: Side) -> Bool {
        headlines.contains { h in [side.fullName, side.name, side.location].compactMap { $0 }.contains { h.hasPrefix($0) } }
    }

    private static func aggregate(_ series: JSON, _ id: String?) -> Int? {
        guard let id else { return nil }
        return series["competitors"].array.first { $0["id"].string == id }?["aggregateScore"].int
    }

    /// Goals (not shootout kicks; own goals under the side they counted for)
    /// and red cards, in match order.
    static func scorers(_ c: JSON, top: Side, bottom: Side) -> [ResultDetail.Scorer] {
        c["details"].array.compactMap { d -> ResultDetail.Scorer? in
            let red = d["redCard"].bool == true
            let goal = d["scoringPlay"].bool == true && d["shootout"].bool != true
            guard red || goal else { return nil }
            let athlete = d["athletesInvolved"][0]
            let team = d["team"]["id"].string ?? athlete["team"]["id"].string
            guard let short = athlete["shortName"].string ?? athlete["displayName"].string else { return nil }
            let mark: ResultDetail.Scorer.Mark = red ? .red
                : d["ownGoal"].bool == true ? .ownGoal : d["penaltyKick"].bool == true ? .penalty : .goal
            return .init(top: team != nil && team == top.id, name: short, minute: d["clock"]["displayValue"].string ?? "",
                         mark: mark, athleteID: athlete["id"].string)
        }
    }

    /// The game's passing, rushing and receiving leaders (finals only: before
    /// kickoff the same key holds season leaders).
    static func footballLeaders(_ c: JSON, top: Side) -> [ResultDetail.Performer] {
        c["leaders"].array.compactMap { category -> ResultDetail.Performer? in
            guard let key = category["name"].string, ["passingYards", "rushingYards", "receivingYards"].contains(key),
                  let leader = category["leaders"].array.first,
                  let short = leader["athlete"]["shortName"].string ?? leader["athlete"]["displayName"].string,
                  let value = leader["displayValue"].string else { return nil }
            let team = leader["team"]["id"].string ?? leader["athlete"]["team"]["id"].string
            return .init(top: team != nil && team == top.id, name: short, line: value, category: key,
                         athleteID: leader["athlete"]["id"].string)
        }
    }

    /// A side's points and overall (rating) leaders.
    static func basketballLeaders(_ comp: JSON, top: Bool) -> [ResultDetail.Performer] {
        comp["leaders"].array.compactMap { category -> ResultDetail.Performer? in
            guard let key = category["name"].string, key == "points" || key == "rating",
                  let leader = category["leaders"].array.first,
                  let short = leader["athlete"]["shortName"].string ?? leader["athlete"]["displayName"].string,
                  let value = leader["displayValue"].string else { return nil }
            return .init(top: top, name: short, line: key == "points" ? "\(value) PTS" : value, category: key,
                         athleteID: leader["athlete"]["id"].string)
        }
    }

    /// MLB: winning, losing and saving pitchers (`competitions[0].status.featuredAthletes`).
    static func decisions(_ status: JSON) -> ResultDetail.Decisions? {
        var out = ResultDetail.Decisions()
        for a in status["featuredAthletes"].array {
            guard let short = a["athlete"]["shortName"].string ?? a["athlete"]["displayName"].string else { continue }
            func stat(_ abbreviation: String) -> String? {
                a["statistics"].array.first { $0["abbreviation"].string == abbreviation }?["displayValue"].string
            }
            let id = a["athlete"]["id"].string
            switch a["name"].string {
            case "winningPitcher": out.win = .init(name: short, record: "\(stat("W") ?? "0")–\(stat("L") ?? "0")", athleteID: id)
            case "losingPitcher": out.loss = .init(name: short, record: "\(stat("W") ?? "0")–\(stat("L") ?? "0")", athleteID: id)
            case "savingPitcher": out.save = .init(name: short, record: stat("SV") ?? "", athleteID: id)
            default: break
            }
        }
        return out.win == nil && out.loss == nil && out.save == nil ? nil : out
    }
}

// MARK: - Display strings

/// The strings a result row shows and says, made once at parse time.
enum ResultLine {
    /// Marks a red card in `details` ("▮ Palmer 80'"); a row may draw it as
    /// the `rectangle.portrait.fill` symbol in red.
    static let redCard = "▮"

    /// ESPN's stat shorthand in the app's voice.
    static func rewrite(_ text: String) -> String {
        text.split(separator: " ", omittingEmptySubsequences: false).map { word -> String in
            let comma = word.hasSuffix(",")
            guard let lower = shorthand[String(comma ? word.dropLast() : word)] else { return String(word) }
            return comma ? lower + "," : lower
        }.joined(separator: " ")
    }

    private static let shorthand = ["YDS": "yds", "CAR": "car", "REC": "rec", "PTS": "pts", "REB": "reb", "AST": "ast"]

    /// "N. Jackson" → "Jackson"; "J.J. McCarthy" → "McCarthy"; "M. van de Ven" → "van de Ven".
    static func surname(_ short: String) -> String {
        let tokens = short.split(separator: " ")
        guard tokens.count > 1, let first = tokens.first, first.hasSuffix("."), first.count <= 4,
              first.allSatisfy({ $0.isLetter || $0 == "." }) else { return short }
        return tokens.dropFirst().joined(separator: " ")
    }

    /// Surnames, except where two people in one game share one: they keep
    /// their initials ("N. Jackson · B. Jackson").
    struct Names {
        private var people: [String: Set<String>] = [:]

        init(_ entries: [(short: String, id: String?)]) {
            for e in entries { people[surname(e.short), default: []].insert(e.id ?? e.short) }
        }

        func callName(_ short: String) -> String {
            let s = surname(short)
            return (people[s]?.count ?? 0) > 1 ? short : s
        }
    }

    /// Fills `details`, `detailsWide`, `context` and `spoken` of a final.
    static func fill(_ r: inout ResultDetail, sport: Sport, top: ResultParse.Side, bottom: ResultParse.Side,
                     notes: [String], shootoutVerb: String) {
        let pitchers = [r.decisions?.win, r.decisions?.loss, r.decisions?.save].compactMap { $0 }
        let names = Names(r.scorers.map { (short: $0.name, id: $0.athleteID) } + r.performers.map { (short: $0.name, id: $0.athleteID) }
            + pitchers.map { (short: $0.name, id: $0.athleteID) })
        let topWon = winner(r, top: top, bottom: bottom)

        // Details
        switch sport {
        case .soccer:
            r.details = soccerDetails(r.scorers, names: names)
            r.detailsWide = r.details
        case .baseball:
            r.details = r.decisions.flatMap { decisionsLine($0, names: names) }
            r.detailsWide = r.details
        case .basketball:
            let order = topWon == false ? [false, true] : [true, false]
            func line(_ category: String, _ text: (ResultDetail.Performer) -> String) -> String? {
                let parts = order.compactMap { side in r.performers.first { $0.top == side && $0.category == category } }
                    .map { "\(names.callName($0.name)) \(text($0))" }
                return parts.isEmpty ? nil : parts.joined(separator: " · ")
            }
            r.details = line("points") { rewrite($0.line) }
            r.detailsWide = line("rating") { rewrite($0.line) } ?? r.details
        case .football:
            r.details = footballLine(r.performers, names: names, wide: false)
            r.detailsWide = footballLine(r.performers, names: names, wide: true)
        default:
            break
        }

        // Context: what the match itself doesn't say (legs, aggregate,
        // shootout, the postseason series, a forfeit).
        var context: [String] = []
        if r.kind == .forfeit {
            if let w = topWon { context.append("Awarded to \(w ? top.name : bottom.name)") }
        } else if r.kind == .abandoned {
            context.append("Abandoned · score at the time")
        } else if !notes.isEmpty {
            context.append(notes.joined(separator: " · "))
        } else if sport == .soccer {
            var knockout: [String] = []
            if let leg = r.leg { knockout.append("\(Ordinal.string(leg)) leg") }
            if let s = r.shootout, s.top != s.bottom {
                let (w, l, side) = s.top > s.bottom ? (s.top, s.bottom, top) : (s.bottom, s.top, bottom)
                knockout.append("\(side.name) \(shootoutVerb) \(w)–\(l) on pens.")
            } else if let agg = r.aggregate, r.leg == 2 || r.advances != nil, let advances = r.advances {
                let side = advances == top.fullName ? top : bottom
                let (a, b) = side.fullName == top.fullName ? (agg.top, agg.bottom) : (agg.bottom, agg.top)
                knockout.append("\(side.name) advance \(a)–\(b) on agg.")
            }
            if !knockout.isEmpty {
                if let stage = r.stage.flatMap(stageTitle), isKnockout(r.stage) { context.append(stage) }
                context += knockout
            }
        }
        r.context = context.isEmpty ? nil : context.joined(separator: " · ")
        r.spoken = spoken(r, sport: sport, top: top, bottom: bottom, status: .final, notes: notes, names: names, topWon: topWon)
    }

    /// The side that won the match (score rule), or the shootout or ESPN's
    /// pick when the score is level; nil for none (draws, abandoned games).
    static func winner(_ r: ResultDetail, top: ResultParse.Side, bottom: ResultParse.Side) -> Bool? {
        if r.kind == .abandoned || r.kind == .suspended { return nil }
        if r.kind != .forfeit, let a = top.score, let b = bottom.score, a != b { return a > b }
        if top.espnWinner != bottom.espnWinner { return top.espnWinner }
        return nil
    }

    /// "Jackson 6', 60' · Haaland 52'": goals by player, home side first,
    /// "(P)" and "(OG)" after a minute, red cards last.
    static func soccerDetails(_ scorers: [ResultDetail.Scorer], names: Names) -> String? {
        var parts: [String] = []
        for side in [true, false] {
            var order: [String] = []
            var minutes: [String: [String]] = [:]
            var shown: [String: String] = [:]
            for s in scorers where s.top == side && s.mark != .red {
                let key = s.athleteID ?? s.name
                if minutes[key] == nil { order.append(key) }
                shown[key] = names.callName(s.name)
                minutes[key, default: []].append(s.minute + (s.mark == .penalty ? " (P)" : s.mark == .ownGoal ? " (OG)" : ""))
            }
            parts += order.map { "\(shown[$0] ?? $0) \((minutes[$0] ?? []).joined(separator: ", "))" }
        }
        parts += scorers.filter { $0.mark == .red }.map { "\(redCard) \(names.callName($0.name)) \($0.minute)" }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// "W Uribe (1–0) · L Wells (0–2) · S Ashby (3)"
    static func decisionsLine(_ d: ResultDetail.Decisions, names: Names) -> String? {
        let parts = [("W", d.win), ("L", d.loss), ("S", d.save)].compactMap { letter, p in
            p.map { "\(letter) \(names.callName($0.name))" + ($0.record.isEmpty ? "" : " (\($0.record))") }
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// The parts of "20/28, 257 YDS, 1 TD, 1 INT".
    private struct StatLine {
        var yards: String?, touchdowns: String?, count: String?
        init(_ text: String) {
            for part in text.components(separatedBy: ", ") {
                let p = part.trimmingCharacters(in: .whitespaces)
                if p.hasSuffix(" YDS") { yards = String(p.dropLast(4)) }
                else if p.hasSuffix(" TD") { touchdowns = String(p.dropLast(3)) }
                else if p.hasSuffix(" REC") { count = String(p.dropLast(4)) }
            }
        }
        var td: String { touchdowns.map { ", \($0) TD" } ?? "" }
    }

    /// Compact: the passer (yards, TDs) and the bigger of the rushing and
    /// receiving leaders. Wide: all three.
    static func footballLine(_ performers: [ResultDetail.Performer], names: Names, wide: Bool) -> String? {
        func find(_ key: String) -> ResultDetail.Performer? { performers.first { $0.category == key } }
        func text(_ p: ResultDetail.Performer) -> String {
            let s = StatLine(p.line)
            switch p.category {
            case "passingYards": return wide ? rewrite(p.line) : "\(s.yards ?? "0") yds\(s.td)"
            case "rushingYards": return "\(s.yards ?? "0") rush yds\(s.td)"
            default: return wide ? "\(s.count.map { "\($0) rec, " } ?? "")\(s.yards ?? "0") yds\(s.td)" : "\(s.yards ?? "0") rec yds\(s.td)"
            }
        }
        var shown: [ResultDetail.Performer] = []
        if let pass = find("passingYards") { shown.append(pass) }
        let rush = find("rushingYards"), rec = find("receivingYards")
        if wide {
            shown += [rush, rec].compactMap { $0 }
        } else {
            let yards = { (p: ResultDetail.Performer?) in p.flatMap { Int(StatLine($0.line).yards ?? "") } ?? -1 }
            if let bigger = yards(rush) >= yards(rec) ? rush : rec { shown.append(bigger) }
        }
        guard !shown.isEmpty else { return nil }
        return shown.map { "\(names.callName($0.name)) \(text($0))" }.joined(separator: " · ")
    }

    // MARK: Spoken

    /// The row's VoiceOver sentence for a result: score, status, outcome,
    /// then the context and details in words.
    static func spoken(_ r: ResultDetail, sport: Sport, top: ResultParse.Side, bottom: ResultParse.Side,
                       status: ScheduleStatus, notes: [String], names: Names? = nil, topWon: Bool? = nil) -> String {
        let versus = "\(top.name) versus \(bottom.name)"
        var sentences: [String] = []
        switch status {
        case .postponed, .canceled:
            sentences.append("\(versus), \(status == .canceled ? "canceled" : "postponed").")
            if !notes.isEmpty { sentences.append(say(notes.joined(separator: " · ")) + ".") }
            return sentences.joined(separator: " ")
        default:
            break
        }
        let words = Spoken.status(r.label)
        let statusWords = words.prefix(1).lowercased() + words.dropFirst()
        let scores = top.score.flatMap { a in bottom.score.map { b in "\(top.name) \(a), \(bottom.name) \(b)" } } ?? versus
        switch r.kind {
        case .forfeit:
            let awarded = topWon.map { ", awarded to \($0 ? top.name : bottom.name)" } ?? ""
            sentences.append("\(versus), forfeit\(awarded).")
        case .abandoned:
            sentences.append("\(scores), abandoned, score at the time.")
        case .suspended:
            sentences.append("\(scores), suspended.")
        default:
            var outcome: String
            if let topWon { outcome = "\(topWon ? top.name : bottom.name) won" } else { outcome = sport == .soccer ? "draw" : "tie" }
            var shootoutSaid = false
            if let s = r.shootout, s.top != s.bottom {
                let (w, l, side) = s.top > s.bottom ? (s.top, s.bottom, top) : (s.bottom, s.top, bottom)
                let level = top.score == bottom.score
                if level { outcome = "\(side.fullName) won \(w) to \(l) on penalties" } else {
                    sentences.append("\(scores), \(statusWords), \(outcome).")
                    sentences.append("\(side.fullName) won \(w) to \(l) on penalties.")
                    shootoutSaid = true
                }
            }
            if !shootoutSaid { sentences.append("\(scores), \(statusWords), \(outcome).") }
        }

        // Context
        if !notes.isEmpty {
            sentences.append(sayNotes(notes.joined(separator: " · "), top: top, bottom: bottom) + ".")
        } else if sport == .soccer {
            let stage = isKnockout(r.stage) ? r.stage.flatMap(stageTitle) : nil
            if let agg = r.aggregate, let advances = r.advances, r.shootout == nil || r.shootout?.top == r.shootout?.bottom {
                let topAdvances = advances == top.fullName
                let (a, b) = topAdvances ? (agg.top, agg.bottom) : (agg.bottom, agg.top)
                let leg = r.leg.map { "\(["first", "second"][min(max($0, 1), 2) - 1]) leg" }
                let lead = [stage, leg].compactMap { $0 }.joined(separator: ", ")
                let sentence = "\(advances) advance \(a) to \(b) on aggregate."
                sentences.append(lead.isEmpty ? sentence : (lead.prefix(1).uppercased() + lead.dropFirst()) + ": " + sentence)
            } else if r.leg != nil || r.shootout != nil, let stage {
                sentences.append(stage + (r.leg.map { ", \(["first", "second"][min(max($0, 1), 2) - 1]) leg" } ?? "") + ".")
            }
        }

        // Details
        let names = names ?? Names([])
        switch sport {
        case .soccer:
            let goals = spokenGoals(r.scorers.filter { $0.mark != .red }, names: names)
            if !goals.isEmpty { sentences.append("Goals: " + goals + ".") }
            let reds = r.scorers.filter { $0.mark == .red }
            if !reds.isEmpty {
                sentences.append((reds.count == 1 ? "Red card: " : "Red cards: ")
                    + reds.map { "\(names.callName($0.name)), \(minutes([$0.minute]))" }.joined(separator: "; ") + ".")
            }
        case .baseball:
            if let d = r.decisions {
                let parts = [("Winning pitcher", d.win), ("losing pitcher", d.loss), ("save", d.save)]
                    .compactMap { label, p in p.map { "\(label) \(names.callName($0.name))" } }
                let said = parts.joined(separator: ", ")
                if !said.isEmpty { sentences.append(said.prefix(1).uppercased() + said.dropFirst() + ".") }
            }
        case .basketball:
            let order = topWon == false ? [false, true] : [true, false]
            let parts = order.compactMap { side in r.performers.first { $0.top == side && $0.category == "points" } }
                .map { "\(names.callName($0.name)) \(say(rewrite($0.line)))" }
            if !parts.isEmpty { sentences.append(parts.joined(separator: "; ") + ".") }
        case .football:
            let wanted = footballLine(r.performers, names: names, wide: false) != nil
            if wanted {
                let keys = ["passingYards", "rushingYards", "receivingYards"]
                let parts = keys.compactMap { key in r.performers.first { $0.category == key } }.map { p -> String in
                    let s = StatLine(p.line)
                    let kind = ["passingYards": "passing", "rushingYards": "rushing", "receivingYards": "receiving"][p.category] ?? ""
                    let tds = s.touchdowns.map { ", \($0) \($0 == "1" ? "touchdown" : "touchdowns")" } ?? ""
                    return "\(names.callName(p.name)) \(s.yards ?? "0") \(kind) yards\(tds)"
                }
                sentences.append(parts.joined(separator: "; ") + ".")
            }
        default:
            break
        }
        return sentences.joined(separator: " ")
    }

    /// "Jackson, 6th and 60th minute; Haaland, 52nd minute"
    static func spokenGoals(_ goals: [ResultDetail.Scorer], names: Names) -> String {
        var order: [String] = []
        var byKey: [String: [ResultDetail.Scorer]] = [:]
        for g in goals.filter(\.top) + goals.filter({ !$0.top }) {
            let key = (g.top ? "t" : "b") + (g.athleteID ?? g.name)
            if byKey[key] == nil { order.append(key) }
            byKey[key, default: []].append(g)
        }
        return order.compactMap { byKey[$0] }.map { list in
            let plain = list.allSatisfy { $0.mark == .goal }
            let said = plain ? minutes(list.map(\.minute))
                : list.map { minutes([$0.minute]) + ($0.mark == .penalty ? ", penalty" : $0.mark == .ownGoal ? ", own goal" : "") }
                    .joined(separator: " and ")
            return "\(names.callName(list[0].name)), \(said)"
        }.joined(separator: "; ")
    }

    /// ["6'", "60'"] → "6th and 60th minute"; ["90'+5'"] → "90th minute plus 5".
    static func minutes(_ list: [String]) -> String {
        let said = list.map { Spoken.status($0) }
        if said.count > 1, said.allSatisfy({ $0.hasSuffix(" minute") }) {
            let ordinals = said.map { String($0.dropLast(" minute".count)) }
            let head = ordinals.dropLast().joined(separator: ", ")
            return "\(head) and \(ordinals.last ?? "") minute"
        }
        return said.joined(separator: " and ")
    }

    /// Shorthand read aloud: "·" pauses, "–" reads "to", "pts" reads "points".
    static func say(_ text: String) -> String {
        text.replacingOccurrences(of: " · ", with: ", ").replacingOccurrences(of: "–", with: " to ")
            .replacingOccurrences(of: " pts", with: " points").replacingOccurrences(of: " reb", with: " rebounds")
            .replacingOccurrences(of: " ast", with: " assists")
    }

    /// Notes read aloud, with a series' team code as its city ("MIL leads
    /// 2–0" → "Milwaukee leads 2 to 0").
    private static func sayNotes(_ text: String, top: ResultParse.Side, bottom: ResultParse.Side) -> String {
        var out = text
        for side in [top, bottom] {
            guard let place = side.location ?? Optional(side.name) else { continue }
            for verb in [" leads ", " wins ", " lead ", " win "] {
                out = out.replacingOccurrences(of: side.abbreviation + verb, with: place + verb)
            }
        }
        return say(out)
    }

    // MARK: Stages

    /// Cup stages a tie is decided in ("round-of-16", "quarterfinals", "final").
    static func isKnockout(_ slug: String?) -> Bool {
        guard let s = slug?.lowercased() else { return false }
        return s.contains("knockout") || s.contains("playoff") || s.hasPrefix("round-of") || s.contains("final")
    }

    /// "round-of-16" → "Round of 16"; "quarterfinals" → "Quarterfinals".
    static func stageTitle(_ slug: String) -> String? {
        let words = slug.split(separator: "-").map(String.init)
        guard !words.isEmpty else { return nil }
        return words.enumerated().map { i, w in i > 0 && ["of", "and"].contains(w) ? w : w.prefix(1).uppercased() + w.dropFirst() }
            .joined(separator: " ")
    }
}

extension ResultDetail {
    /// The status column's second line: the shootout ("2–4"), else the
    /// aggregate ("Agg 5–7"), top–bottom.
    var secondLine: String? {
        if let s = shootout { return "\(s.top)–\(s.bottom)" }
        if let a = aggregate, leg == 2 || advances != nil { return "Agg \(a.top)–\(a.bottom)" }
        return nil
    }
}

extension ResultRound {
    /// "Matchweek 8 · Oct 23–25", "Week 7 · Oct 21–27", "Sep 12–14".
    var label: String { detail.isEmpty || detail == title ? title : "\(title) · \(detail)" }
}

// MARK: - Rounds

/// The rounds a league's results page steps through (§3.2): matchweeks and
/// cup stage blocks (soccer), calendar weeks (NFL, college), game days
/// (MLB, NBA, WNBA). Oldest first; the page shows the newest by default.
enum Rounds {
    /// The Eastern day a game's board lists it on (calendars and boards are Eastern).
    static func boardDay(_ item: ScheduleItem) -> DayKey {
        item.start.date.map { DayKey.of($0, in: DayKey.eastern) } ?? item.day
    }

    /// Rounds for `league`: `days` are the calendar's game days (soccer
    /// leagues, daily leagues), `items` whatever of the league is loaded,
    /// `calendar` gives cup stages and football weeks. Rounds starting after
    /// `today` (Eastern) are left out.
    static func build(days: [DayKey], items: [ScheduleItem], calendar: ScheduleCalendar?, league: League,
                      today: DayKey, now: Date = .now) -> [ResultRound] {
        guard case let .espn(_, weekly) = league.source else { return [] }
        if weekly { return weeks(calendar, now: now) }
        if league.sport != .soccer { return Array(Set(days.filter { $0 <= today })).sorted().map(day) }
        return layout(days: days, items: items, calendar: calendar, league: league, today: today).rounds
    }

    // MARK: Soccer

    struct Layout {
        var rounds: [ResultRound] = []
        /// Round ID → its games, in kickoff order.
        var members: [String: [ScheduleItem]] = [:]
    }

    /// Matchweeks (leagues) and stage blocks (cups) with the games in each (§3.2.1).
    static func layout(days: [DayKey], items: [ScheduleItem], calendar: ScheduleCalendar?, league: League,
                       today: DayKey) -> Layout {
        // Cups list stages, not days: their blocks come from the games loaded.
        let stages = (calendar?.weeks ?? []).map { w in
            (name: stageName(w.label), first: DayKey.of(w.start, in: DayKey.eastern), end: DayKey.of(w.end, in: DayKey.eastern))
        }
        func stage(_ d: DayKey) -> String? {
            stages.filter { $0.first <= d && d < $0.end }.max { $0.first < $1.first }?.name
        }
        let byDay = Dictionary(grouping: items, by: boardDay)
        var all = Set(days)
        all.formUnion(byDay.keys)
        var blocks: [[DayKey]] = []
        for d in all.sorted() {
            if let previous = blocks.last?.last, previous.days(to: d) == 1, stage(previous) == stage(d) {
                blocks[blocks.count - 1].append(d)
            } else {
                blocks.append([d])
            }
        }
        var out = Layout()
        for block in blocks where block[0] <= today {
            let members = Agenda.sorted(block.flatMap { byDay[$0] ?? [] })
            for (round, games) in rounds(block: block, members: members, stage: stage(block[0]), league: league) {
                out.rounds.append(round)
                out.members[round.id] = games
            }
        }
        return out
    }

    private static func rounds(block: [DayKey], members: [ScheduleItem], stage: String?,
                               league: League) -> [(ResultRound, [ScheduleItem])] {
        let first = block[0], last = block[block.count - 1]
        let finals = members.filter { $0.status == .final }
        func make(_ id: String, _ kind: ResultRound.Kind, _ title: String, _ games: [ScheduleItem]) -> (ResultRound, [ScheduleItem]) {
            let days = games.map(boardDay)
            let a = days.min() ?? first, b = days.max() ?? last
            var round = ResultRound(id: id, kind: kind, title: title, detail: DayKey.range(a, b), first: a, last: b,
                                    section: stage ?? season(of: a, league: league))
            if !games.isEmpty {
                round.played = games.filter { $0.status == .final }.count
                round.total = games.count
            }
            return (round, games)
        }
        let id = "b:\(first)"
        let dates = make(id, .dates, DayKey.range(first, last), members)
        guard !members.isEmpty else { return [dates] }

        if let stage, isKnockoutStage(stage) {
            let legs = members.map { $0.result?.leg }
            var title = stage
            if let leg = legs.first ?? nil, legs.allSatisfy({ $0 == leg }) { title += " · \(Ordinal.string(leg)) legs" }
            return [make(id, .stage, title, members)]
        }
        let played = finals.compactMap { $0.result?.gamesPlayed }
        guard !played.isEmpty else { return [dates] }
        let counts = Dictionary(played.map { ($0, 1) }, uniquingKeysWith: +)
            .sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
        let kind: ResultRound.Kind = stage == nil ? .matchweek : .stage
        func title(_ g: Int) -> String { stage.map { "\($0) · Matchday \(g)" } ?? "Matchweek \(g)" }
        let total = Double(played.count)
        if Double(counts[0].value) >= 0.7 * total { return [make(id, kind, title(counts[0].key), members)] }
        if counts.count >= 2, Double(counts[1].value) >= 0.3 * total {
            // A holiday run holding two matchweeks: split by games played. A
            // game still to play goes with the round its day belongs to.
            let a = min(counts[0].key, counts[1].key), b = max(counts[0].key, counts[1].key)
            var groupA: [ScheduleItem] = [], groupB: [ScheduleItem] = []
            let lastA = finals.filter { $0.result?.gamesPlayed == a }.map(boardDay).max() ?? first
            for game in members {
                if let g = game.result?.gamesPlayed, game.status == .final {
                    if abs(g - a) <= abs(g - b) { groupA.append(game) } else { groupB.append(game) }
                } else if boardDay(game) <= lastA {
                    groupA.append(game)
                } else {
                    groupB.append(game)
                }
            }
            return [make("\(id):\(a)", kind, title(a), groupA), make("\(id):\(b)", kind, title(b), groupB)]
        }
        return [dates]
    }

    /// Calendar stage labels as shown: "Rd of 16" → "Round of 16", "Group" → "Group Stage".
    static func stageName(_ label: String) -> String {
        switch label {
        case "Rd of 16": "Round of 16"
        case "Rd of 32": "Round of 32"
        case "Group": "Group Stage"
        default: label
        }
    }

    static func isKnockoutStage(_ name: String) -> Bool {
        let s = name.lowercased()
        return !(s.contains("league") || s.contains("group"))
    }

    /// "2026–27" for a European league's round; "2026" for MLS.
    static func season(of day: DayKey, league: League) -> String {
        if league.id == "usa.1" { return String(day.year) }
        return TeamSeasons.label(year: day.month >= 7 ? day.year : day.year - 1, sport: .soccer, league: league.id)
    }

    // MARK: Weeks and days

    /// NFL and college weeks that have started (preseason left out).
    static func weeks(_ calendar: ScheduleCalendar?, now: Date) -> [ResultRound] {
        (calendar?.weeks ?? []).filter { $0.seasonType >= 2 && $0.start <= now }.map { w in
            ResultRound(id: "w:\(w.seasonType)-\(w.number)", kind: .week, title: w.label,
                        detail: w.detail.replacingOccurrences(of: "-", with: "–"),
                        first: DayKey.of(w.start, in: DayKey.eastern), last: DayKey.of(w.end.addingTimeInterval(-1), in: DayKey.eastern),
                        section: w.seasonType == 3 ? "Postseason" : "Regular Season", week: w.number, seasonType: w.seasonType)
        }
    }

    static func day(_ d: DayKey) -> ResultRound {
        ResultRound(id: "d:\(d)", kind: .day, title: d.longLabel, detail: "", first: d, last: d)
    }

    /// A daily league's game days up to `today`, newest `limit` (MLB's
    /// calendar lists the days off instead).
    static func gameDays(_ calendar: ScheduleCalendar?, through today: DayKey, limit: Int = 240) -> [DayKey] {
        guard let calendar else { return (0..<14).map { today.adding(days: -$0) }.reversed() }
        if calendar.offDays != nil, let start = calendar.seasonStart, let end = calendar.seasonEnd {
            let off = Set(calendar.offDays ?? [])
            var out: [DayKey] = []
            var d = min(today, end)
            while d >= start && out.count < limit {
                if !off.contains(d) { out.append(d) }
                d = d.adding(days: -1)
            }
            return out.reversed()
        }
        return Array(calendar.days.filter { $0 <= today }.suffix(limit))
    }

    /// The newest round with a result: rounds are skipped only when known to
    /// have none (`hasFinal` false: loaded, nothing finished yet); an
    /// unloaded round (nil) is a candidate the caller loads to find out.
    static func latest(_ rounds: [ResultRound], hasFinal: (ResultRound) -> Bool?) -> ResultRound? {
        rounds.last { hasFinal($0) != false } ?? rounds.last
    }

    /// The round summary line: "10 results · 19 goals", "13 results · 1
    /// overtime", "8 of 10 played · next: Mon 12:00 PM", "All 3 games postponed".
    static func summary(_ items: [ScheduleItem], sport: Sport?, now: Date = .now) -> String? {
        let games = items.filter { !$0.isField }
        guard !games.isEmpty else { return nil }
        let finals = games.filter { $0.status == .final && $0.result?.kind != .abandoned }
        let pending = games.filter { $0.status == .scheduled || $0.status == .live }
        if finals.isEmpty, pending.isEmpty {
            return games.count == 1 ? "Postponed" : "All \(games.count) games postponed"
        }
        if !pending.isEmpty {
            let next = pending.filter { $0.status == .scheduled }.min { $0.sortDate < $1.sortDate }
            let when = next?.start.date.map { "next: " + $0.formatted(.dateTime.weekday(.abbreviated).hour().minute()) }
            return (["\(finals.count) of \(finals.count + pending.count) played"] + [when].compactMap { $0 }).joined(separator: " · ")
        }
        var parts = [plural(finals.count, "result")]
        switch sport {
        case .soccer?:
            let goals = finals.reduce(0) { $0 + ($1.teams.compactMap { $0.score.flatMap { Int($0) } }.reduce(0, +)) }
            parts.append(plural(goals, "goal"))
        case .football?, .basketball?:
            let extra = finals.filter { $0.result?.kind == .overtime }.count
            if extra > 0 { parts.append(plural(extra, "overtime")) }
        default:
            break
        }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Team seasons

enum TeamSeasons {
    /// Club friendlies and invitationals (`club.friendly`, `friendly.emirates_cup`):
    /// hidden from results unless asked for.
    static func isFriendly(_ item: ScheduleItem) -> Bool { item.league.contains("friendly") }

    /// A result from one team's side: its letter, its side and the other.
    static func outcome(_ item: ScheduleItem, team id: String) -> (letter: String, mine: ScheduleTeam, other: ScheduleTeam)? {
        guard item.status == .final, let mine = item.teams.first(where: { $0.id == id }),
              let other = item.teams.first(where: { $0.id != id }) else { return nil }
        if let kind = item.result?.kind, kind == .abandoned || kind == .suspended { return nil }
        let letter = mine.winner ? "W" : other.winner ? "L" : item.sport == .soccer ? "D" : "T"
        return (letter, mine, other)
    }

    /// A team's season from its schedule: record, W/D/L, goals (or points,
    /// runs), the last ten results as form, and the results newest first.
    /// `summary` is the team schedule's "7–0–1 · 2nd in English Premier
    /// League", trusted only for the current season (ESPN's record is always
    /// the current one).
    static func summarize(items: [ScheduleItem], team: ScheduleTeamRef, season: String, isCurrent: Bool, summary: String?,
                          includeFriendlies: Bool = false) -> TeamSeason {
        var out = TeamSeason(team: team, season: season, isCurrent: isCurrent, record: nil, standing: nil)
        var seen = Set<String>()
        let results = items.filter { item in
            item.status == .final && (includeFriendlies || !isFriendly(item)) && seen.insert(item.id).inserted
                && item.teams.contains { $0.id == team.id }
        }.sorted { $0.sortDate > $1.sortDate }
        out.results = results
        var scoredFor = 0, scoredAgainst = 0, scored = false, ties = 0
        var marks: [FormMark] = []
        for item in results {
            guard let (letter, mine, other) = outcome(item, team: team.id) else { continue }
            out.played += 1
            switch letter {
            case "W": out.won += 1
            case "L": out.lost += 1
            default: out.drawn += 1; ties += 1
            }
            if let a = mine.score.flatMap({ Int($0) }), let b = other.score.flatMap({ Int($0) }) {
                scoredFor += a
                scoredAgainst += b
                scored = true
            }
            if marks.count < 10 { marks.append(mark(item, letter: letter, mine: mine, other: other)) }
        }
        out.form = marks.reversed()
        if scored {
            out.scoredFor = scoredFor
            out.scoredAgainst = scoredAgainst
        }
        let soccer = results.first?.sport == .soccer || team.id.hasPrefix("espn-soccer-")
        let computed = soccer ? "\(out.won)–\(out.drawn)–\(out.lost)"
            : "\(out.won)–\(out.lost)" + (ties > 0 ? "–\(ties)" : "")
        let parts = (summary ?? "").components(separatedBy: " · ").filter { !$0.isEmpty }
        let espnRecord = parts.first.flatMap { ResultParse.Side.played($0) != nil ? RowText.record($0) : nil }
        if isCurrent {
            out.record = espnRecord ?? (out.played > 0 ? computed : nil)
            out.standing = parts.dropFirst(espnRecord == nil ? 0 : 1).first.map(standing)
        } else {
            out.record = out.played > 0 ? computed : nil
        }
        return out
    }

    /// "2nd in English Premier League" → "2nd in Premier League".
    static func standing(_ text: String) -> String {
        text.replacingOccurrences(of: "English Premier League", with: "Premier League")
    }

    /// One form letter's readout and words: "Sat, Oct 24 · W 2–0 vs Everton ·
    /// Premier League"; a shootout: "Sun, Aug 9 · L 2–3 · won 5–4 on pens · vs Dortmund · …".
    static func mark(_ item: ScheduleItem, letter: String, mine: ScheduleTeam, other: ScheduleTeam) -> FormMark {
        let home = item.sport == .soccer ? item.top?.id == mine.id : item.bottom?.id == mine.id
        let score = [mine.score, other.score].compactMap { $0 }
        let scoreText = score.count == 2 ? " \(score[0])–\(score[1])" : ""
        var shootout: (text: String, spoken: String)?
        if let s = item.result?.shootout {
            let mineFirst = item.top?.id == mine.id
            let (a, b) = mineFirst ? (s.top, s.bottom) : (s.bottom, s.top)
            let verb = a > b ? "won" : "lost"
            shootout = ("\(verb) \(a)–\(b) on pens", "\(verb) \(a) to \(b) on penalties")
        }
        let competition = item.competition ?? League.with(id: item.league)?.name
        let opponent = "\(home ? "vs" : "at") \(other.name)"
        let result = "\(letter)\(scoreText)"
        let readout = (shootout.map { [item.day.mediumLabel, result, $0.text, opponent] } ?? [item.day.mediumLabel, "\(result) \(opponent)"])
            .appending(competition).joined(separator: " · ")
        let verb = ["W": "won", "L": "lost", "D": "drew", "T": "tied"][letter] ?? "played"
        let date = item.day.displayDate.formatted(.dateTime.month(.wide).day())
        let spokenScore = score.count == 2 ? " \(score[0]) to \(score[1])" : ""
        let spoken = "\(date), \(verb)\(spokenScore) against \(other.name)" + (shootout.map { ", \($0.spoken)" } ?? "")
        return FormMark(letter: letter, itemID: item.id, readout: readout, spoken: spoken)
    }

    // MARK: Seasons

    /// ESPN's `season=` for the season under way: soccer counts from the
    /// start year (2026 is 2026–27), basketball from the end year (2027 is
    /// 2026–27), football from the September it starts.
    static func currentYear(sport: Sport, league: String?, today: DayKey = .today()) -> Int {
        switch sport {
        case .soccer: league == "usa.1" ? today.year : (today.month >= 7 ? today.year : today.year - 1)
        case .basketball: league == "wnba" ? today.year : (today.month >= 10 ? today.year + 1 : today.year)
        case .football: today.month >= 3 ? today.year : today.year - 1
        default: today.year
        }
    }

    /// "2026–27" (soccer `season=2026`, NBA `season=2027`), "2024" (NFL, MLB).
    static func label(year: Int, sport: Sport, league: String?) -> String {
        switch sport {
        case .soccer where league != "usa.1": String(format: "%d–%02d", year, (year + 1) % 100)
        case .basketball where league != "wnba": String(format: "%d–%02d", year - 1, year % 100)
        default: String(year)
        }
    }

    struct Choice: Hashable, Sendable {
        /// ESPN's `season=`; nil for the current season (the default request).
        let year: Int?
        let label: String
    }

    /// The team scope's Season menu: this season and the two before it.
    static func choices(for team: ScheduleTeamRef, today: DayKey = .today()) -> [Choice] {
        guard let source = ScheduleProvider.ESPN.teamSource(team.id) else { return [] }
        let league = team.league ?? (source.sport == .soccer ? nil : source.league)
        let year = currentYear(sport: source.sport, league: league, today: today)
        return [Choice(year: nil, label: label(year: year, sport: source.sport, league: league))]
            + (1...2).map { Choice(year: year - $0, label: label(year: year - $0, sport: source.sport, league: league)) }
    }

    /// A team's schedule: `season` alone for soccer (`?season=2023`), with a
    /// season type elsewhere; neither for the current season.
    static func url(path: String, team: String, season: Int?, seasonType: Int?) throws -> URL {
        var items: [String] = []
        if let season { items.append("season=\(season)") }
        if let seasonType { items.append("seasontype=\(seasonType)") }
        let query = items.isEmpty ? "" : "?" + items.joined(separator: "&")
        return try URL.api("\(ScheduleProvider.ESPN.base)/\(path)/teams/\(team)/schedule\(query)")
    }
}

// MARK: - CS2 team history

enum CSHistory {
    static let pageSize = 20

    /// A team's finished matches (and forfeits), newest first, 20 a page.
    static func url(teamIDs: [Int], page: Int) -> URL {
        var c = URLComponents(string: "\(ScheduleProvider.CS.api)/matches")!
        c.queryItems = [
            .init(name: "filter[matches.team_ids][overlap]", value: teamIDs.map(String.init).joined(separator: ",")),
            .init(name: "filter[matches.status][in]", value: "finished,defwin"),
            .init(name: "filter[matches.tier][in]", value: CounterStrike.tier),
            .init(name: "sort", value: "-start_date"),
            .init(name: "page[limit]", value: String(pageSize)),
            .init(name: "page[offset]", value: String(max(page, 0) * pageSize)),
            .init(name: "with", value: "teams,tournament"),
        ]
        return c.url!
    }

    /// A page of history as result rows (forfeits without their fake score).
    static func parse(_ data: Data) -> [ScheduleItem] {
        ScheduleProvider.CS.parseMatches(data).map(ResultParse.counterStrike).sorted { $0.sortDate > $1.sortDate }
    }
}

private extension Array where Element == String {
    func appending(_ element: String?) -> [String] { element.map { self + [$0] } ?? self }
}
