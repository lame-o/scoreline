import Foundation

// NBA: the shot chart, game flow, leaders, box score and injury report, parsed
// from ESPN's game summary (and kept current by the live lane), plus the
// conference standings. WNBA games don't come through here.

extension GameDetail {
    struct Basketball {
        var shots: [Shot] = []
        /// The score after every scoring play, from tip-off.
        var flow: [FlowPoint] = []
        var leaders: [LeaderLine] = []
        /// Before tip-off ESPN's leaders are season averages (PPG), not this game's.
        var seasonLeaders = false
        var topBox: [BoxPlayer] = []
        var bottomBox: [BoxPlayer] = []
        /// Each team's totals line, keyed like a player's (no MIN or +/-).
        var topTotals: [String: String] = [:]
        var bottomTotals: [String: String] = [:]
        var injuries: [Injury] = []
        /// Every play the court and the replay use, in game order.
        var plays: [CourtPlay] = []
        /// Seconds in a quarter (overtime is five minutes).
        var quarterLength: Double = 720
        /// The summary's newest play's game time: the live lane adds only what's after it.
        var newestElapsed: Double?

        /// Box score lines by athlete ID, both teams.
        var players: [String: BoxPlayer] {
            Dictionary((topBox + bottomBox).map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        }
    }

    /// A field-goal attempt in ESPN's half-court feet: x 0…50 across the court
    /// (rim at 25), y out from the backboard (rim ≈ 1, baseline −4). Every shot
    /// is measured toward the shooter's own basket.
    struct Shot: Identifiable, Equatable {
        let id: String
        let x: Double
        let y: Double
        let made: Bool
        /// 2 or 3 (free throws have no position, so they aren't shots here).
        let value: Int
        let side: Side?
        /// ESPN athlete ID of the shooter.
        let player: String?
        let period: Int?
        let clock: String
        let text: String
        /// Game seconds elapsed, for the game flow.
        let elapsed: Double?
        /// ESPN's play type (a dunk, a layup; 91 is a live placeholder that's refined later).
        var typeID: Int? = nil
        /// Who blocked it (a miss with a second participant).
        var blocker: String? = nil

        var dunk: Bool { typeID.map(NBADetail.dunkTypes.contains) ?? false }
    }

    struct FlowPoint: Identifiable, Equatable {
        let id: String
        let elapsed: Double
        let top: Int
        let bottom: Int
        let period: Int
        let clock: String
        /// Who scored to make it this score.
        var scorer: Side? = nil
        var margin: Int { top - bottom }
    }

    struct Leader: Equatable {
        let name: String
        let value: String
        let headshot: URL?
        let player: String?
        /// The line behind the number ("9/16 FG"), when ESPN gives one.
        var detail: String? = nil
    }

    /// One category (points, rebounds, assists): each team's leader.
    struct LeaderLine: Identifiable, Equatable {
        let category: String
        let top: Leader?
        let bottom: Leader?
        var id: String { category }
    }

    struct BoxPlayer: Identifiable, Equatable {
        let id: String
        let name: String
        let starter: Bool
        /// On the floor right now (live).
        let onCourt: Bool
        /// ESPN's full line, keyed by its labels: MIN, PTS, FG, 3PT, FT, REB,
        /// AST, TO, STL, BLK, OREB, DREB, PF, +/-. Wider layouts read more columns.
        let stats: [String: String]
        /// Why they haven't played ("Coach's decision", "Right calf"), if they
        /// haven't. Live, it also means "not in yet".
        let didNotPlay: String?
        var played: Bool { didNotPlay == nil }

        var minutes: String { stats["MIN"] ?? "" }
        var points: Int { Int(stats["PTS"] ?? "") ?? 0 }
        var rebounds: Int { Int(stats["REB"] ?? "") ?? 0 }
        var assists: Int { Int(stats["AST"] ?? "") ?? 0 }
        var plusMinus: String { stats["+/-"] ?? "" }
        /// "9-16".
        var fieldGoals: String { stats["FG"] ?? "" }
        var threes: String { stats["3PT"] ?? "" }
    }

    struct Injury: Identifiable, Equatable {
        let id: String
        let name: String
        /// "Out", "Day-to-day", "Out for season".
        let status: String
        /// "Left ankle sprain".
        let detail: String?
        let side: Side?
        /// ESPN's estimated return, when there is one.
        var returnDate: Date? = nil
    }

    /// A play as the court and the replay use it: what happened, who did it,
    /// where, and the score after it. Substitutions, timeouts and reviews
    /// move nothing on the court, so they aren't kept.
    struct CourtPlay: Identifiable, Equatable {
        enum Kind: Equatable {
            /// A field-goal attempt (2 or 3, by `pointsAttempted`).
            case shot(made: Bool, value: Int)
            /// `last`: the trip's last free throw. A technical stands alone.
            case freeThrow(made: Bool, last: Bool, technical: Bool)
            case rebound(offensive: Bool)
            /// `steal`: a defender took it (the second participant).
            case turnover(steal: Bool)
            case foul(offensive: Bool)
            case jumpBall
            case periodEnd
        }

        let id: String
        let kind: Kind
        /// The team that did it: the shooter's, rebounder's, the team that lost
        /// the ball, the fouling team, the team that won the jump ball.
        let side: Side?
        /// Who did it: shooter, rebounder, the player who lost the ball, the fouler.
        let player: String?
        /// The assister, blocker or stealer.
        var other: String? = nil
        /// ESPN's spot in half-court feet (x 0…50 across, rim at (25, 1)),
        /// measured toward the attacking team's basket. Nil when ESPN has none
        /// (free throws, jump balls, team rebounds).
        var x: Double? = nil
        var y: Double? = nil
        let period: Int?
        let clock: String
        /// Game seconds elapsed.
        let elapsed: Double?
        let text: String
        /// The score after the play.
        let top: Int
        let bottom: Int
        /// ESPN's play type, for the shot's story (a dunk slams, a jumper swishes).
        var typeID: Int? = nil

        /// The team on offense, whose basket `x`/`y` are measured toward. A
        /// defensive rebound or foul belongs to the defense, but its spot is
        /// the offense's end.
        var attacking: Side? {
            switch kind {
            case .shot, .freeThrow, .turnover: side
            case let .rebound(offensive), let .foul(offensive): offensive ? side : side?.opponent
            case .jumpBall, .periodEnd: nil
            }
        }

        /// Where it happened on the attacking team's half, in ESPN's feet. A
        /// rebound's coordinates are a copy of the missed shot's, so it sits
        /// just off the rim toward that shot instead; free throws are at the
        /// line. Jump balls (center court) are the view's to place.
        var spot: (x: Double, y: Double)? {
            switch kind {
            case .shot, .turnover, .foul:
                guard let x, let y else { return nil }
                return (x, y)
            case .freeThrow:
                return (25, 15)
            case .rebound:
                // 3 ft off the rim, on the side the shot came from (straight out without one).
                let dx = (x ?? 25) - 25, dy = (y ?? 4) - 1
                let length = hypot(dx, dy)
                guard length > 0.5 else { return (25, 4) }
                let reach = min(3, length)
                return (25 + dx / length * reach, 1 + dy / length * reach)
            case .jumpBall, .periodEnd:
                return nil
            }
        }

        /// It has a place on the court (the trail draws it).
        var positioned: Bool { kind == .jumpBall || spot != nil }

        var isShot: Bool { if case .shot = kind { true } else { false } }

        /// Who has the ball once this play is done, given who had it before.
        /// The data spec's rule (§5), right 97.7% of the times it decides: a
        /// make, last free throw, turnover or offensive foul hands the ball
        /// over; a defensive foul gives it to the fouled team; a rebound or
        /// jump ball goes to that team; a miss leaves it in the air (nil).
        func possession(after current: Side?) -> Side? {
            if kind == .periodEnd { return nil }
            guard let side else { return current }
            switch kind {
            case let .shot(made, _):
                return made ? side.opponent : nil
            case let .freeThrow(made, last, technical):
                if technical { return current }
                if !last { return side }
                return made ? side.opponent : nil
            case .rebound, .jumpBall:
                return side
            case .turnover, .foul:
                return side.opponent
            case .periodEnd:
                return nil
            }
        }

        /// What it was, as a readout's lead ("Made 3", "Steal", "Defensive rebound").
        var label: String {
            switch kind {
            case let .shot(made, value): "\(made ? "Made" : "Missed") \(value)"
            case let .freeThrow(made, _, _): made ? "Free throw" : "Missed free throw"
            case let .rebound(offensive): offensive ? "Offensive rebound" : "Defensive rebound"
            case let .turnover(steal): steal ? "Steal" : "Turnover"
            case let .foul(offensive): offensive ? "Offensive foul" : "Foul"
            case .jumpBall: "Jump ball"
            case .periodEnd: "End of period"
            }
        }
    }
}

extension GameDetail.Side {
    /// The other team.
    var opponent: GameDetail.Side { self == .top ? .bottom : .top }
}

enum NBADetail {
    static let path = "basketball/nba"

    /// The page's NBA parts from a game summary. `side` maps an ESPN team ID to
    /// top/bottom; the home team is listed by `topIsHome`.
    static func parse(_ summary: JSON, side: (String?) -> GameDetail.Side?, topIsHome: Bool) -> GameDetail.Basketball {
        var nba = GameDetail.Basketball()
        // ESPN lists plays in game order; sequence numbers aren't (late and
        // corrected plays get higher ones but sit where they happened).
        let plays = summary["plays"].array
        nba.shots = plays.compactMap { shot($0, side: side, quarter: nba.quarterLength) }
        nba.flow = flow(plays, topIsHome: topIsHome, quarter: nba.quarterLength)
        nba.plays = courtPlays(plays, side: side, topIsHome: topIsHome, quarter: nba.quarterLength)
        let leaderTeams = summary["leaders"].array
        nba.leaders = leaders(leaderTeams, side: side)
        nba.seasonLeaders = leaderTeams.contains { $0["leaders"].array.contains { ($0["name"].string ?? "").hasSuffix("PerGame") } }
        for team in summary["boxscore"]["players"].array {
            let players = box(team)
            let totals = boxTotals(team)
            switch side(team["team"]["id"].string) {
            case .top?: (nba.topBox, nba.topTotals) = (players, totals)
            case .bottom?: (nba.bottomBox, nba.bottomTotals) = (players, totals)
            case nil: break
            }
        }
        nba.injuries = summary["injuries"].array.flatMap { team in
            team["injuries"].array.compactMap { injury($0, side: side(team["team"]["id"].string)) }
        }
        if let last = plays.last {
            nba.newestElapsed = last["period"]["number"].int.flatMap {
                elapsed(period: $0, clock: last["clock"]["displayValue"].string ?? "", quarter: nba.quarterLength)
            }
        }
        return nba
    }

    // MARK: Time

    /// "4:12" or, under a minute, "33.8" → seconds left in the period.
    static func seconds(_ clock: String) -> Double? {
        let parts = clock.split(separator: ":")
        if parts.count == 2, let m = Double(parts[0]), let s = Double(parts[1]) { return m * 60 + s }
        return Double(clock)
    }

    /// Game seconds elapsed at a period and clock (overtime periods are five minutes).
    static func elapsed(period: Int, clock: String, quarter: Double = 720) -> Double? {
        guard period >= 1, let left = seconds(clock) else { return nil }
        if period <= 4 { return Double(period - 1) * quarter + (quarter - left) }
        return 4 * quarter + Double(period - 5) * 300 + (300 - left)
    }

    /// Game seconds at the start of a period.
    static func periodStart(_ period: Int, quarter: Double = 720) -> Double {
        period <= 4 ? Double(period - 1) * quarter : 4 * quarter + Double(period - 5) * 300
    }

    /// "Q2", "OT", "2OT" (`Period.label`, the one rule for every surface).
    static func periodName(_ period: Int) -> String {
        Period.label(period, sport: .basketball)
    }

    /// "Q2 4:12", "OT 0:31".
    static func clockLabel(period: Int?, clock: String) -> String {
        guard let period else { return clock }
        return [periodName(period), clock].filter { !$0.isEmpty }.joined(separator: " ")
    }

    // MARK: Shots

    /// Free throws: types 97–106 (text as a fallback, for placeholders).
    static func isFreeThrow(_ play: JSON) -> Bool {
        if let type = play["type"]["id"].int, (97...106).contains(type) { return true }
        return (play["text"].string ?? "").lowercased().contains("free throw")
    }

    static func shot(_ play: JSON, side: (String?) -> GameDetail.Side?, quarter: Double = 720) -> GameDetail.Shot? {
        guard play["shootingPlay"].bool == true,
              let x = play["coordinate"]["x"].double, let y = play["coordinate"]["y"].double,
              // No position comes as a huge negative sentinel.
              x > -1000, y > -1000, let id = play["id"].string, !isFreeThrow(play) else { return nil }
        let text = play["text"].string ?? ""
        let made = play["scoringPlay"].bool == true
        let value = shotValue(play, x: x, y: y)
        // The shooter comes first, blocked shots included ("A blocks B's jumper": B, then A).
        let people = participants(play)
        let period = play["period"]["number"].int
        let clock = play["clock"]["displayValue"].string ?? ""
        return GameDetail.Shot(id: id, x: x, y: y, made: made, value: value,
                               side: side(play["team"]["id"].string), player: people.first, period: period, clock: clock,
                               text: text, elapsed: period.flatMap { elapsed(period: $0, clock: clock, quarter: quarter) },
                               typeID: play["type"]["id"].int, blocker: !made && people.count > 1 ? people[1] : nil)
    }

    /// Dunks of every kind (alley-oop, putback, tip, reverse, driving…).
    static let dunkTypes: Set<Int> = [96, 115, 116, 117, 118, 138, 149, 150, 151, 152, 153]

    static func participants(_ play: JSON) -> [String] {
        play["participants"].array.compactMap { $0["athlete"]["id"].string }
    }

    /// Beyond the arc: 23.75 ft from the rim, or 22 ft along the corners.
    static func isThree(x: Double, y: Double) -> Bool {
        let rim = (x: 25.0, y: 1.0)
        if y <= 10, abs(x - rim.x) >= 21.8 { return true }
        return hypot(x - rim.x, y - rim.y) >= 23.6
    }

    // MARK: Flow and key moments

    static func flow(_ plays: [JSON], topIsHome: Bool, quarter: Double = 720) -> [GameDetail.FlowPoint] {
        var points = [GameDetail.FlowPoint(id: "tip", elapsed: 0, top: 0, bottom: 0, period: 1, clock: "12:00")]
        for play in plays where play["scoringPlay"].bool == true {
            guard let point = flowPoint(play, after: points.last, topIsHome: topIsHome, quarter: quarter) else { continue }
            points.append(point)
        }
        return points
    }

    /// A scoring play as a point on the game flow (nil if the score didn't change).
    static func flowPoint(_ play: JSON, after last: GameDetail.FlowPoint?, topIsHome: Bool,
                          quarter: Double = 720) -> GameDetail.FlowPoint? {
        guard let home = play["homeScore"].int, let away = play["awayScore"].int,
              let period = play["period"]["number"].int else { return nil }
        let clock = play["clock"]["displayValue"].string ?? ""
        guard let t = elapsed(period: period, clock: clock, quarter: quarter) else { return nil }
        let (top, bottom) = topIsHome ? (home, away) : (away, home)
        if let last, last.top == top, last.bottom == bottom { return nil }
        let scorer: GameDetail.Side? = last.map { top > $0.top ? .top : bottom > $0.bottom ? .bottom : nil } ?? nil
        return GameDetail.FlowPoint(id: play["id"].string ?? "\(t)", elapsed: max(t, last?.elapsed ?? 0),
                                    top: top, bottom: bottom, period: period, clock: clock, scorer: scorer)
    }

    /// The game's story for the key-plays list: every run of 8+ unanswered
    /// points, lead changes in the fourth quarter and overtime, and the score at
    /// the end of each period. Oldest first.
    static func keyMoments(_ summary: JSON, side: (String?) -> GameDetail.Side?, topIsHome: Bool) -> [GameDetail.Moment] {
        let plays = summary["plays"].array
        var moments: [GameDetail.Moment] = []
        var top = 0, bottom = 0
        /// The team ahead most recently (a tie doesn't end a lead; the other team going ahead does).
        var leader: GameDetail.Side?
        var run: (side: GameDetail.Side, points: Int, last: JSON)?
        func close() {
            guard let r = run, r.points >= 8 else { return }
            let score = score(r.last, topIsHome)
            let id = r.last["id"].string ?? UUID().uuidString
            // A run's last basket can also be a lead change: keep IDs unique.
            let unique = moments.contains { $0.id == id } ? "\(id)-run" : id
            moments.append(moment(r.last, id: unique, text: "\(r.points)–0 run", side: r.side, top: score.top, bottom: score.bottom))
        }
        for (index, play) in plays.enumerated() {
            if let end = periodEnd(play) {
                // "End of the 4th Quarter" then "End of Game": one row, "Final".
                if !end.final, index + 1 < plays.count, periodEnd(plays[index + 1])?.final == true { continue }
                let name = end.final ? "Final" : end.period == 2 ? "Halftime"
                    : end.period == 4 ? "End of regulation" : "End of \(periodName(end.period))"
                moments.append(moment(play, text: name, side: nil, top: top, bottom: bottom, clock: "0:00"))
                continue
            }
            guard play["scoringPlay"].bool == true else { continue }
            let (newTop, newBottom) = score(play, topIsHome)
            let scorer: GameDetail.Side? = newTop > top ? .top : newBottom > bottom ? .bottom : nil
            let gained = max(newTop - top, newBottom - bottom)
            guard let scorer, gained > 0 else { continue }
            // Runs: unanswered points. A free throw by the other side ends one.
            if run?.side == scorer {
                run?.points += gained
                run?.last = play
            } else {
                close()
                run = (scorer, gained, play)
            }
            let now: GameDetail.Side? = newTop > newBottom ? .top : newBottom > newTop ? .bottom : nil
            // Lead changes that decide games: fourth quarter and overtime.
            if let now, let before = leader, now != before, (play["period"]["number"].int ?? 0) >= 4 {
                moments.append(moment(play, text: "Lead change · \(short(play["text"].string ?? ""))", side: now,
                                      top: newTop, bottom: newBottom))
            }
            if let now { leader = now }
            top = newTop
            bottom = newBottom
        }
        close()
        return moments
    }

    /// An "End Period" or "End Game" entry.
    static func periodEnd(_ play: JSON) -> (period: Int, final: Bool)? {
        let type = play["type"]["id"].string
        let text = play["type"]["text"].string?.lowercased() ?? ""
        let final = type == "402" || text == "end game"
        guard final || type == "412" || text == "end period", let period = play["period"]["number"].int else { return nil }
        return (period, final)
    }

    private static func score(_ play: JSON, _ topIsHome: Bool) -> (top: Int, bottom: Int) {
        let home = play["homeScore"].int ?? 0, away = play["awayScore"].int ?? 0
        return topIsHome ? (home, away) : (away, home)
    }

    private static func moment(_ play: JSON, id: String? = nil, text: String, side: GameDetail.Side?, top: Int, bottom: Int,
                               clock: String? = nil) -> GameDetail.Moment {
        let period = play["period"]["number"].int
        return GameDetail.Moment(id: id ?? play["id"].string ?? UUID().uuidString, kind: side == nil ? .other : .score,
                                 clock: clockLabel(period: period, clock: clock ?? play["clock"]["displayValue"].string ?? ""),
                                 text: text, side: side, score: "\(top)–\(bottom)", period: period)
    }

    /// ESPN's play text tidied: one line, no assist, no stray space before "'s".
    static func plain(_ text: String) -> String {
        var s = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        if let open = s.range(of: " (", options: .backwards), s.hasSuffix(")"),
           s[open.upperBound...].contains("assist") {
            s = String(s[..<open.lowerBound])
        }
        return s.replacingOccurrences(of: " 's ", with: "'s ")
    }

    /// For a caption: tidied, and a made shot is just the shot
    /// ("… makes 26-foot jumper (Reaves assists)" → "… 26-ft jumper").
    static func short(_ text: String) -> String {
        plain(text).replacingOccurrences(of: " makes ", with: " ").replacingOccurrences(of: "-foot ", with: "-ft ")
    }

    /// A shot after a "Made 3" / "Missed 2" lead: the shooter's short name and
    /// the shot ("Mario Hezonja makes 25-foot three point jumper" → "M. Hezonja 25-ft three point jumper").
    static func shotText(_ text: String, shooter: String?) -> String {
        var s = plain(text)
        for verb in [" makes ", " misses "] {
            guard let range = s.range(of: verb) else { continue }
            s = (shooter ?? String(s[..<range.lowerBound])) + " " + s[range.upperBound...]
            break
        }
        return s.replacingOccurrences(of: "-foot ", with: "-ft ")
    }

    /// The scores list's live line: the last play, with short names
    /// ("Ace Bailey blocks Luka Doncic 's 25-foot …" → "A. Bailey blocks L. Doncic's 25-ft …").
    static func listLine(_ text: String, names: [(full: String, short: String)] = []) -> String {
        var s = plain(text)
        // "End of the 2nd Quarter" → "End of Q2"; "End of the 1st  Overtime" → "End of OT".
        if s.hasPrefix("End of the ") {
            let words = s.dropFirst("End of the ".count).split(separator: " ")
            if let number = words.first.flatMap({ Int($0.prefix { $0.isNumber }) }), let kind = words.last {
                return kind.lowercased().hasPrefix("quarter") ? "End of Q\(number)"
                    : "End of \(periodName(number + 4))"
            }
        }
        for name in names where !name.full.isEmpty && !name.short.isEmpty {
            s = s.replacingOccurrences(of: name.full, with: name.short)
        }
        return s.replacingOccurrences(of: "-foot ", with: "-ft ").replacingOccurrences(of: " enters the game for ", with: " in for ")
    }

    /// The last few plays, newest first, with their clock ("Q3 4:12  …").
    static func recentPlays(_ plays: [JSON], count: Int = 4) -> [String] {
        plays.filter { !($0["text"].string ?? "").isEmpty }.suffix(count).reversed().map { p in
            let clock = clockLabel(period: p["period"]["number"].int, clock: p["clock"]["displayValue"].string ?? "")
            return "\(clock)  \(plain(p["text"].string ?? ""))"
        }
    }

    /// The home team's win probability after the newest play that has one.
    /// ESPN lists `winprobability` by sequence number, not game order, so it's
    /// joined to the plays by ID (the last entry isn't necessarily the latest play).
    static func homeWinProbability(_ summary: JSON) -> Double? {
        var byPlay: [String: Double] = [:]
        for entry in summary["winprobability"].array {
            if let id = entry["playId"].string, let home = entry["homeWinPercentage"].double { byPlay[id] = home }
        }
        guard !byPlay.isEmpty else { return nil }
        for play in summary["plays"].array.reversed() {
            if let id = play["id"].string, let home = byPlay[id] { return home }
        }
        return summary["winprobability"].array.last?["homeWinPercentage"].double
    }

    /// Plays worth a line in the scores list on their own: shots and free
    /// throws, turnovers, fouls, goaltending, ejections, and anything that
    /// scored. Rebounds, timeouts, substitutions, reviews and period ends aren't.
    static func isNotable(type: Int?, scoreValue: Int?) -> Bool {
        if (scoreValue ?? 0) > 0 { return true }
        guard let type else { return true }
        let fouls: Set<Int> = [22, 24, 29, 30, 31, 32, 33, 35, 40, 42, 43, 44, 45, 48]
        return (91...153).contains(type) || type == 282 || (61...90).contains(type) || fouls.contains(type)
            || type == 9 || type == 517
    }

    /// ESPN's pregame matchup predictor, for the top team (0…1).
    static func predictor(_ summary: JSON, topIsHome: Bool) -> Double? {
        let team = summary["predictor"][topIsHome ? "homeTeam" : "awayTeam"]
        return team["gameProjection"].double.map { min(max($0 / 100, 0), 1) }
    }

    // MARK: Leaders, box score, injuries

    static func leaders(_ teams: [JSON], side: (String?) -> GameDetail.Side?) -> [GameDetail.LeaderLine] {
        var byCategory: [String: (top: GameDetail.Leader?, bottom: GameDetail.Leader?)] = [:]
        var order: [String] = []
        // Game stats live; season averages before tip-off.
        let labels = ["points": "PTS", "rebounds": "REB", "assists": "AST",
                      "pointsPerGame": "PTS", "reboundsPerGame": "REB", "assistsPerGame": "AST"]
        for team in teams {
            let s = side(team["team"]["id"].string)
            for category in team["leaders"].array {
                guard let name = category["name"].string, let label = labels[name],
                      let first = category["leaders"].array.first else { continue }
                if !order.contains(label) { order.append(label) }
                let athlete = first["athlete"]
                // A scorer's shooting ("9/16 FG, 4/4 FT" → "9/16 FG"; "68.2 FG%" before tip-off).
                // Rebounds and assists say it all in the number.
                let detail = label != "PTS" ? nil : first["summary"].string?.split(separator: ",").first
                    .map { $0.trimmingCharacters(in: .whitespaces) }.flatMap { $0.isEmpty ? nil : $0 }
                let leader = GameDetail.Leader(
                    name: athlete["shortName"].string ?? athlete["displayName"].string ?? "",
                    value: first["displayValue"].string ?? first["value"].int.map(String.init) ?? "",
                    headshot: (athlete["headshot"]["href"].string ?? athlete["headshot"].string).flatMap(URL.init(string:)),
                    player: athlete["id"].string, detail: detail)
                if s == .top { byCategory[label, default: (nil, nil)].top = leader }
                if s == .bottom { byCategory[label, default: (nil, nil)].bottom = leader }
            }
        }
        return ["PTS", "REB", "AST"].filter(order.contains)
            .map { GameDetail.LeaderLine(category: $0, top: byCategory[$0]?.top, bottom: byCategory[$0]?.bottom) }
    }

    /// ESPN's stat keys and the labels the box score keeps them under.
    static let boxLabels: [String: String] = [
        "minutes": "MIN", "points": "PTS", "fieldGoalsMade-fieldGoalsAttempted": "FG",
        "threePointFieldGoalsMade-threePointFieldGoalsAttempted": "3PT", "freeThrowsMade-freeThrowsAttempted": "FT",
        "rebounds": "REB", "assists": "AST", "turnovers": "TO", "steals": "STL", "blocks": "BLK",
        "offensiveRebounds": "OREB", "defensiveRebounds": "DREB", "fouls": "PF", "plusMinus": "+/-",
    ]

    /// Column labels in ESPN's order: by key, in case the order or wording changes; ESPN's label as a fallback.
    private static func boxColumns(_ group: JSON) -> [String] {
        let keys = group["keys"].array.map { $0.string ?? "" }
        let labels = group["labels"].array.map { $0.string ?? "" }
        return (0..<max(keys.count, labels.count)).map { i in
            (i < keys.count ? boxLabels[keys[i]] : nil) ?? (i < labels.count ? labels[i] : "")
        }
    }

    /// One row of values as a label-keyed line (empty values left out).
    private static func line(_ values: [JSON], columns: [String]) -> [String: String] {
        var line: [String: String] = [:]
        for (column, value) in zip(columns, values) {
            if let text = value.string, !text.isEmpty, !column.isEmpty { line[column] = text }
        }
        return line
    }

    /// A team's totals line ("40-88" FG, 112 PTS), keyed like a player's.
    static func boxTotals(_ team: JSON) -> [String: String] {
        guard let group = team["statistics"].array.first else { return [:] }
        return line(group["totals"].array, columns: boxColumns(group))
    }

    /// One team's box score: starters as ESPN lists them, then the bench by
    /// minutes, then whoever hasn't played.
    static func box(_ team: JSON) -> [GameDetail.BoxPlayer] {
        guard let group = team["statistics"].array.first else { return [] }
        let columns = boxColumns(group)
        let players = group["athletes"].array.compactMap { entry -> GameDetail.BoxPlayer? in
            let athlete = entry["athlete"]
            guard let id = athlete["id"].string else { return nil }
            let stats = entry["stats"].array.compactMap(\.string)
            // ESPN puts "COACH'S DECISION" on every row; only a real reason is worth showing.
            var dnp: String?
            if entry["didNotPlay"].bool == true || (stats.isEmpty && entry["starter"].bool != true) {
                let reason = entry["reason"].string ?? ""
                dnp = reason.isEmpty || reason.uppercased() == "COACH'S DECISION" ? "Coach's decision"
                    : reason.prefix(1).uppercased() + reason.dropFirst().lowercased()
            }
            return GameDetail.BoxPlayer(
                id: id, name: athlete["shortName"].string ?? athlete["displayName"].string ?? "",
                starter: entry["starter"].bool == true, onCourt: entry["active"].bool == true,
                stats: line(entry["stats"].array, columns: columns), didNotPlay: dnp)
        }
        let starters = players.filter { $0.starter && $0.played }
        let bench = players.filter { !$0.starter && $0.played }
            .enumerated().sorted { a, b in
                let (ma, mb) = (Int(a.element.minutes) ?? 0, Int(b.element.minutes) ?? 0)
                return ma != mb ? ma > mb : a.offset < b.offset
            }.map(\.element)
        return starters + bench + players.filter { !$0.played }
    }

    static func injury(_ item: JSON, side: GameDetail.Side?) -> GameDetail.Injury? {
        let athlete = item["athlete"]
        guard let name = athlete["shortName"].string ?? athlete["displayName"].string,
              let raw = item["status"].string else { return nil }
        let details = item["details"]
        let fantasy = details["fantasyStatus"]["abbreviation"].string
        let status = fantasy == "OFS" ? "Out for season" : raw.lowercased() == "day-to-day" ? "Day-to-day" : raw
        // "Left" + "Ankle" + "Sprain" → "Left ankle sprain".
        let place = [details["side"].string.flatMap { ["left", "right"].contains($0.lowercased()) ? $0 : nil },
                     details["type"].string].compactMap { $0 }.joined(separator: " ")
        let what = details["detail"].string.flatMap { $0.lowercased() == "not specified" ? nil : $0.lowercased() }
        let text = [place, what].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        let detail = text.isEmpty ? nil : text.prefix(1).uppercased() + text.dropFirst().lowercased()
        let returnDate = details["returnDate"].string.flatMap { Self.day.date(from: String($0.prefix(10))) }
        return GameDetail.Injury(id: athlete["id"].string ?? name, name: name, status: status, detail: detail, side: side,
                                 returnDate: returnDate)
    }

    private static let day: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    // MARK: Court plays (the live trail and the replay)

    /// Turnovers, the live placeholder 61 ("No Turnover") included.
    static let turnoverTypes: Set<Int> = [61, 62, 63, 64, 65, 67, 68, 69, 70, 71, 72, 73, 78, 84, 86, 87, 90]
    /// Offensive foul, charge.
    static let offensiveFoulTypes: Set<Int> = [42, 24]
    /// Shooting, personal, take, loose ball, flagrant 1 and 2, away from the play.
    static let defensiveFoulTypes: Set<Int> = [44, 45, 22, 43, 32, 31, 40]

    /// The plays the court and the replay use, in ESPN's order (game order).
    /// The bookkeeping team rebound between two free throws is left out.
    static func courtPlays(_ plays: [JSON], side: (String?) -> GameDetail.Side?, topIsHome: Bool,
                           quarter: Double = 720) -> [GameDetail.CourtPlay] {
        var result: [GameDetail.CourtPlay] = []
        var score = (top: 0, bottom: 0)
        for play in plays {
            if let home = play["homeScore"].int, let away = play["awayScore"].int {
                score = topIsHome ? (home, away) : (away, home)
            }
            guard let next = courtPlay(play, side: side, score: score, quarter: quarter) else { continue }
            if case .rebound = next.kind, next.player == nil,
               case .freeThrow(made: false, last: false, technical: false)? = result.last?.kind { continue }
            result.append(next)
        }
        return result
    }

    /// One play for the court, from its structured fields (type, team,
    /// participants, coordinates), never its text; nil for plays that move nothing.
    static func courtPlay(_ play: JSON, side: (String?) -> GameDetail.Side?, score: (top: Int, bottom: Int),
                          quarter: Double = 720) -> GameDetail.CourtPlay? {
        guard let id = play["id"].string else { return nil }
        let type = play["type"]["id"].int
        let made = play["scoringPlay"].bool == true
        let x = play["coordinate"]["x"].double.flatMap { $0 > -1000 ? $0 : nil }
        let y = play["coordinate"]["y"].double.flatMap { $0 > -1000 ? $0 : nil }
        let kind: GameDetail.CourtPlay.Kind
        if periodEnd(play) != nil {
            kind = .periodEnd
        } else if play["shootingPlay"].bool == true, isFreeThrow(play) {
            kind = .freeThrow(made: made, last: isLastFreeThrow(play), technical: type == 103)
        } else if play["shootingPlay"].bool == true {
            guard let x, let y else { return nil }
            kind = .shot(made: made, value: shotValue(play, x: x, y: y))
        } else if type == 155 || type == 156 {
            kind = .rebound(offensive: type == 156)
        } else if let type, turnoverTypes.contains(type) {
            kind = .turnover(steal: participants(play).count > 1)
        } else if let type, offensiveFoulTypes.contains(type) {
            kind = .foul(offensive: true)
        } else if let type, defensiveFoulTypes.contains(type) {
            kind = .foul(offensive: false)
        } else if type == 615 {
            kind = .jumpBall
        } else {
            return nil
        }
        let people = participants(play)
        let period = play["period"]["number"].int
        let clock = play["clock"]["displayValue"].string ?? ""
        // A jump ball lists both jumpers, then who gained it.
        let player = kind == .jumpBall ? people.last : people.first
        return GameDetail.CourtPlay(
            id: id, kind: kind, side: side(play["team"]["id"].string), player: player,
            other: kind == .jumpBall || people.count < 2 ? nil : people[1], x: x, y: y, period: period, clock: clock,
            elapsed: period.flatMap { elapsed(period: $0, clock: clock, quarter: quarter) },
            text: play["text"].string ?? "", top: score.top, bottom: score.bottom, typeID: type)
    }

    /// The last free throw of a trip: "1 of 1", "2 of 2", "3 of 3" (types 97,
    /// 99, 102, 105, 106), or the text's "n of n" for anything else.
    static func isLastFreeThrow(_ play: JSON) -> Bool {
        if let type = play["type"]["id"].int, (97...106).contains(type), type != 103 {
            return [97, 99, 102, 105, 106].contains(type)
        }
        let words = (play["text"].string ?? "").lowercased().split(separator: " ")
        guard let of = words.lastIndex(of: "of"), of > 0, of + 1 < words.count else { return true }
        return words[of - 1] == words[of + 1]
    }

    /// 2 or 3: `pointsAttempted` (it says so on misses too); geometry only as a fallback.
    static func shotValue(_ play: JSON, x: Double, y: Double) -> Int {
        if let attempted = play["pointsAttempted"].int, attempted >= 2 { return attempted }
        if play["scoringPlay"].bool == true, let points = play["scoreValue"].int, points >= 2 { return points }
        return (play["text"].string ?? "").lowercased().contains("three point") || isThree(x: x, y: y) ? 3 : 2
    }

    /// The summary's plays with the live lane's spliced over them. The lane is
    /// fresher for everything from its first play the summary also has: its
    /// version replaces the summary's from there (edits, deletions and late
    /// inserts included). Without an overlap it adds only what's newer.
    static func plays(summary: [GameDetail.CourtPlay], lane: [GameDetail.CourtPlay]) -> [GameDetail.CourtPlay] {
        guard !lane.isEmpty else { return summary }
        let index = Dictionary(summary.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
        if let cut = lane.lazy.compactMap({ index[$0.id] }).first {
            let fresh = Set(lane.map(\.id))
            return summary[..<cut].filter { !fresh.contains($0.id) } + lane
        }
        let after = summary.last?.elapsed ?? -1
        return summary + lane.filter { index[$0.id] == nil && ($0.elapsed ?? 0) >= after }
    }

    /// How many of `plays` (in game order) had happened by game second `t`:
    /// every play at or before it (free throws share their foul's clock).
    static func count(_ plays: [GameDetail.CourtPlay], through t: Double) -> Int {
        var low = 0, high = plays.count
        while low < high {
            let mid = (low + high) / 2
            if (plays[mid].elapsed ?? 0) <= t { low = mid + 1 } else { high = mid }
        }
        return low
    }

    /// Who has the ball after the first `count` plays (nil: nobody can say, e.g. a shot in the air).
    static func possession(_ plays: some Collection<GameDetail.CourtPlay>) -> GameDetail.Side? {
        plays.reduce(nil) { $1.possession(after: $0) }
    }

    /// Who has the ball, for the possession arrow: the data spec's rule, plus
    /// what it can't decide. After a miss (or a missed last free throw) the
    /// ball is in the air: it's still the shooting team's trip until the
    /// rebound, so the arrow keeps pointing their way, dimmed. Nil before the
    /// first play that decides, and after a period ends.
    struct Ball: Equatable {
        var side: GameDetail.Side?
        var inAir = false
    }

    static func ball(_ plays: some Collection<GameDetail.CourtPlay>) -> Ball {
        plays.reduce(Ball()) { state, play in
            if play.kind == .periodEnd { return Ball() }
            if let decided = play.possession(after: state.inAir ? nil : state.side) { return Ball(side: decided) }
            switch play.kind {
            case .shot(made: false, _), .freeThrow(made: false, last: true, technical: false):
                return Ball(side: play.side ?? state.side, inAir: (play.side ?? state.side) != nil)
            default:
                // A technical, or a play with no team: nothing changes.
                return state
            }
        }
    }

    /// Clutch time: the last five minutes of the fourth or any overtime, within five.
    static func clutch(period: Int, secondsLeft: Double, margin: Int) -> Bool {
        period >= 4 && secondsLeft <= 300 && abs(margin) <= 5
    }

    /// A make with the clock at a second or less ("0.6", "0:01", "0.0").
    static func buzzer(clock: String) -> Bool {
        (seconds(clock) ?? .infinity) <= 1.0
    }

    /// Each shooter's straight makes, counting back from their latest field-goal
    /// attempt (free throws don't count; a blocked shot is a miss). Players
    /// whose latest attempt missed are left out.
    static func streaks(_ plays: some Collection<GameDetail.CourtPlay>) -> [String: Int] {
        var run: [String: Int] = [:]
        for play in plays {
            guard case let .shot(made, _) = play.kind, let player = play.player else { continue }
            run[player] = made ? (run[player] ?? 0) + 1 : 0
        }
        return run.filter { $0.value > 0 }
    }

    /// The streak that sets a player on fire: four straight field goals.
    ///
    /// Tuned on the data spec's 41 recorded games. At three, 7.7 players a
    /// game caught fire and 12.9 makes a game carried the accent, so the
    /// flame was always lit somewhere. At four it's about 3 players a game
    /// (2 of 41 games had none); at five, 1 (17 of 41 had none, too rare to
    /// learn). The flame shows while a streak is 4 or more.
    static let fireStreak = 4

    /// A make that's news for its streak: the one that sets the shooter on
    /// fire, then every second one after (4, 6, 8…), the way a run is news
    /// at its milestones. The makes between keep the flame, quietly. That's
    /// 3.8 celebrated makes a game across the recorded games (median 3).
    static func isFireMilestone(_ streak: Int) -> Bool {
        streak >= fireStreak && (streak - fireStreak) % 2 == 0
    }

    /// A stretch of game time as the clock showed it: "Q3 6:40–3:15", or
    /// "Q2 1:10–Q3 10:30" across a break.
    static func spanLabel(_ span: ClosedRange<Double>, quarter: Double = 720) -> String {
        let from = clockLabel(at: span.lowerBound, quarter: quarter), to = clockLabel(at: span.upperBound, quarter: quarter)
        let a = from.split(separator: " "), b = to.split(separator: " ")
        if a.count == 2, b.count == 2, a[0] == b[0] { return "\(from)–\(b[1])" }
        return "\(from)–\(to)"
    }

    /// A player's shooting and points from the plays: field goals, threes,
    /// points (makes and free throws). For the line at a moment of a replay.
    static func line(for player: String, in plays: some Collection<GameDetail.CourtPlay>)
        -> (fg: (made: Int, attempts: Int), threes: (made: Int, attempts: Int), points: Int) {
        var fg = (0, 0), threes = (0, 0), points = 0
        for play in plays where play.player == player {
            switch play.kind {
            case let .shot(made, value):
                fg.1 += 1
                if value == 3 { threes.1 += 1 }
                if made {
                    fg.0 += 1
                    points += value
                    if value == 3 { threes.0 += 1 }
                }
            case let .freeThrow(made, _, _):
                if made { points += 1 }
            default:
                break
            }
        }
        return (fg, threes, points)
    }

    /// "C. Cunningham" → "Cunningham", for a narrow column: a player stays
    /// recognizable by surname before anything truncates. A name without an
    /// initial ("Nikola Jokić") stays whole.
    static func lastName(_ name: String) -> String {
        guard let space = name.firstIndex(of: " "), name[..<space].hasSuffix(".") else { return name }
        return String(name[name.index(after: space)...])
    }

    /// The summary's linescore with the live lane's score in it. The summary
    /// is refreshed every 30 seconds and the lane every few, so without this
    /// T trails the hero by up to half a minute. T takes the lane's score
    /// (top first); the points since the summary go to the current period's
    /// cell while the lane is still in the summary's last period (across a
    /// break it can't say which period they belong to, so only T moves).
    /// Never behind: a lane that trails the summary changes nothing.
    static func linescore(_ summary: GameDetail.Linescore, lane: (top: Int, bottom: Int), period: Int?) -> GameDetail.Linescore {
        let t = summary.headers.count - 1
        guard t >= 0, summary.headers[t] == "T", summary.top.count == summary.headers.count,
              summary.bottom.count == summary.headers.count else { return summary }
        let was = (top: Int(summary.top[t]), bottom: Int(summary.bottom[t]))
        if let top = was.top, let bottom = was.bottom, lane.top + lane.bottom < top + bottom { return summary }
        var top = summary.top, bottom = summary.bottom
        top[t] = "\(lane.top)"
        bottom[t] = "\(lane.bottom)"
        if let period, period == t, t > 0, let wasTop = was.top, let wasBottom = was.bottom,
           let cellTop = Int(top[t - 1]), let cellBottom = Int(bottom[t - 1]) {
            top[t - 1] = "\(max(0, cellTop + lane.top - wasTop))"
            bottom[t - 1] = "\(max(0, cellBottom + lane.bottom - wasBottom))"
        }
        return GameDetail.Linescore(headers: summary.headers, top: top, bottom: bottom)
    }

    /// "LAL 78–71", leader first; "Tied 74–74".
    static func scoreLine(top: Int, bottom: Int, topName: String, bottomName: String) -> String {
        if top == bottom { return "Tied \(top)–\(bottom)" }
        return top > bottom ? "\(topName) \(top)–\(bottom)" : "\(bottomName) \(bottom)–\(top)"
    }

    /// A game second as the clock showed it: "Q3 4:12", "OT 0:31".
    static func clockLabel(at t: Double, quarter: Double = 720) -> String {
        let t = max(t, 0)
        var period = 1
        // At a boundary it's the end of the period before (48:00 is "Q4 0:00").
        while NBADetail.periodStart(period + 1, quarter: quarter) < t, period < 14 { period += 1 }
        let length = period <= 4 ? quarter : 300
        let left = Int(max(0, NBADetail.periodStart(period, quarter: quarter) + length - t).rounded(.up))
        return clockLabel(period: period, clock: String(format: "%d:%02d", left / 60, left % 60))
    }

    // MARK: Merging the live lane

    /// The summary's shots, plus the live lane's newer ones (no duplicates).
    /// The summary is the record up to its newest play; the lane only adds
    /// what came after it.
    static func shots(summary: [GameDetail.Shot], newestElapsed: Double?, lane: [GameDetail.Shot]) -> [GameDetail.Shot] {
        guard !lane.isEmpty else { return summary }
        let known = Set(summary.map(\.id))
        let after = newestElapsed ?? -1
        return summary + lane.filter { !known.contains($0.id) && ($0.elapsed ?? 0) >= after }
    }

    static func flow(summary: [GameDetail.FlowPoint], lane: [GameDetail.FlowPoint]) -> [GameDetail.FlowPoint] {
        guard let last = summary.last else { return lane }
        let known = Set(summary.map(\.id))
        var merged = summary
        for var point in lane where !known.contains(point.id) && point.elapsed >= last.elapsed {
            // The lane's first point may repeat the summary's last score under another play.
            guard let tail = merged.last, tail.top != point.top || tail.bottom != point.bottom else { continue }
            point.scorer = point.top > tail.top ? .top : point.bottom > tail.bottom ? .bottom : nil
            merged.append(point)
        }
        return merged
    }
}

// MARK: - Standings

/// NBA conference standings, seeded 1–15, with a projection from live scores.
enum NBAStandings {
    static func fetch() async throws -> [StandingsRow] {
        parse(try await JSON.fetch(URL.api("https://site.api.espn.com/apis/v2/sports/\(NBADetail.path)/standings?sort=playoffseed:asc")))
    }

    /// Both conferences, each by playoff seed (ESPN's entries aren't in seed order).
    static func parse(_ json: JSON) -> [StandingsRow] {
        json["children"].array.flatMap { conference -> [StandingsRow] in
            let group = conference["name"].string
            return conference["standings"]["entries"].array.compactMap { e -> StandingsRow? in
                guard let teamID = e["team"]["id"].string else { return nil }
                var values: [String: Double] = [:]
                var text: [String: String] = [:]
                for s in e["stats"].array {
                    guard let name = s["name"].string ?? s["type"].string else { continue }
                    if let value = s["value"].double { values[name] = value }
                    if let display = s["displayValue"].string ?? s["summary"].string { text[name] = display }
                }
                let wins = Int(values["wins"] ?? 0), losses = Int(values["losses"] ?? 0)
                return StandingsRow(
                    id: ESPNTeamID.make(path: NBADetail.path, sport: .basketball, team: teamID), group: group,
                    name: e["team"]["shortDisplayName"].string ?? e["team"]["displayName"].string ?? "",
                    abbreviation: e["team"]["abbreviation"].string ?? "",
                    logo: e["team"]["logos"][0]["href"].string.flatMap(URL.init(string:)),
                    rank: Int(values["playoffSeed"] ?? 0), played: wins + losses,
                    wins: wins, draws: 0, losses: losses,
                    goalDifference: Int(values["pointDifferential"] ?? 0), goalsFor: Int(values["pointsFor"] ?? 0), points: 0,
                    overall: text["overall"], streak: text["streak"],
                    gamesBehind: text["gamesBehind"], winPercent: values["winPercent"], lastTen: text["Last Ten Games"],
                    details: text)
            }
            .sorted { ($0.rank == 0 ? Int.max : $0.rank) < ($1.rank == 0 ? Int.max : $1.rank) }
        }
    }

    /// A row as it would stand if live games ended now.
    struct LiveRow: Identifiable, Equatable {
        let row: StandingsRow
        let liveRank: Int
        let wins: Int
        let losses: Int
        /// "88–84" from this team's side, while its game is live.
        let liveScore: String?
        /// Games behind the conference leader ("–" for the leader).
        let gamesBehind: String
        var id: String { row.id }
        /// Positive = climbing (official seed − projected place).
        var movement: Int { row.rank - liveRank }
        var percent: Double { wins + losses == 0 ? 0 : Double(wins) / Double(wins + losses) }
        /// ".732", "1.000".
        var percentText: String {
            let text = String(format: "%.3f", percent)
            return text.hasPrefix("0") ? String(text.dropFirst()) : text
        }
    }

    /// Each conference re-ranked by win percentage if live games ended now:
    /// the team ahead gets the win, the team behind the loss (a tie changes
    /// nothing). Equal percentages go by games over .500 (3-0 is half a game
    /// up on 2-0), then ESPN's seeding. With nothing live, ESPN's own order
    /// and games behind stand.
    static func project(_ rows: [StandingsRow], liveEvents: [Event]) -> [LiveRow] {
        var result: [String: (win: Bool?, score: String)] = [:]
        for event in liveEvents where event.state == .live {
            guard case let .match(top, bottom) = event.content, let a = top.id, let b = bottom.id,
                  let sa = top.score.flatMap(Int.init), let sb = bottom.score.flatMap(Int.init) else { continue }
            result[a] = (sa == sb ? nil : sa > sb, "\(sa)–\(sb)")
            result[b] = (sa == sb ? nil : sb > sa, "\(sb)–\(sa)")
        }
        let groups = rows.reduce(into: [String?]()) { if !$0.contains($1.group) { $0.append($1.group) } }
        return groups.flatMap { group -> [LiveRow] in
            let table = rows.filter { $0.group == group }
            let changed = table.contains { result[$0.id]?.win != nil }
            let projected = table.map { row -> (row: StandingsRow, wins: Int, losses: Int, score: String?) in
                let r = result[row.id]
                return (row, row.wins + (r?.win == true ? 1 : 0), row.losses + (r?.win == false ? 1 : 0), r?.score)
            }
            func pct(_ w: Int, _ l: Int) -> Double { w + l == 0 ? 0 : Double(w) / Double(w + l) }
            let ordered = changed
                ? projected.sorted { a, b in
                    let (pa, pb) = (pct(a.wins, a.losses), pct(b.wins, b.losses))
                    if pa != pb { return pa > pb }
                    if a.wins - a.losses != b.wins - b.losses { return a.wins - a.losses > b.wins - b.losses }
                    return a.row.rank < b.row.rank
                }
                : projected
            let leader = ordered.first
            return ordered.enumerated().map { index, p in
                let behind = leader.map { Double(($0.wins - p.wins) + (p.losses - $0.losses)) / 2 } ?? 0
                let official = p.row.gamesBehind.map { $0 == "-" || $0 == "0" ? "–" : $0 }
                return LiveRow(row: p.row, liveRank: changed ? index + 1 : p.row.rank, wins: p.wins, losses: p.losses,
                               liveScore: p.score, gamesBehind: changed ? gamesBehind(behind) : official ?? gamesBehind(behind))
            }
        }
    }

    /// Each team's conference around it: `reach` places either side (both
    /// conferences for an East–West game), in order.
    static func window(_ rows: [LiveRow], around ids: Set<String>, reach: Int = 2) -> [LiveRow] {
        let groups = Set(rows.filter { ids.contains($0.id) }.map(\.row.group))
        guard !groups.isEmpty else { return [] }
        let table = rows.filter { groups.contains($0.row.group) }
        let positions = table.indices.filter { ids.contains(table[$0].id) }
        let keep = Set(positions.flatMap { p in
            (p - reach...p + reach).filter { table.indices.contains($0) && table[$0].row.group == table[p].row.group }
        })
        return table.indices.filter(keep.contains).map { table[$0] }
    }

    /// 0 → "–", 2.5 → "2.5", 3 → "3".
    static func gamesBehind(_ value: Double) -> String {
        guard value > 0 else { return "–" }
        return value == value.rounded() ? "\(Int(value))" : String(format: "%.1f", value)
    }
}
