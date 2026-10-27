import Foundation

/// Everything the detail page can show. Each source fills what it has; the view
/// renders only the parts that are present. "Top"/"bottom" always follow the
/// event's competitor order, so the detail lines up with the row it came from.
struct GameDetail {
    struct Stat: Identifiable {
        let label: String
        let top: String
        let bottom: String
        /// Share of the bar belonging to the top competitor (0…1).
        let topShare: Double
        var id: String { label }
    }

    struct Linescore {
        let headers: [String]
        let top: [String]
        let bottom: [String]
    }

    enum Side { case top, bottom }

    struct Moment: Identifiable {
        enum Kind { case goal, ownGoal, yellow, red, score, other }
        let id: String
        let kind: Kind
        let clock: String
        let text: String
        let side: Side?
        /// Match minute, for placing it on the soccer timeline.
        var minute: Double? = nil
        /// Score after this play, top–bottom.
        var score: String? = nil
        /// Inning or quarter, for linking to the line score.
        var period: Int? = nil
    }

    struct Football {
        let downDistance: String?
        /// Ball position, 0 = left (top team's) goal line, 100 = right goal line.
        let ballX: Double
        /// First-down marker in the same coordinates.
        let lineToGainX: Double?
        let possession: Side?
        let redZone: Bool
        let topTimeouts: Int?
        let bottomTimeouts: Int?
        let lastPlay: String?
    }

    struct Baseball {
        let balls: Int
        let strikes: Int
        let outs: Int
        let onFirst: Bool
        let onSecond: Bool
        let onThird: Bool
        let batter: String?
        let pitcher: String?
        let lastPlay: String?
        /// Who's on first, second and third, by short name, where ESPN says.
        var runners: [String?] = [nil, nil, nil]

        /// ESPN situations name each runner by `playerId` (the box score has the names).
        static func runners(_ s: JSON, names: [String: String]) -> [String?] {
            ["onFirst", "onSecond", "onThird"].map { s[$0]["playerId"].int.map(String.init).flatMap { names[$0] } }
        }
    }

    struct MapResult: Identifiable {
        let number: Int
        let name: String
        let topScore: Int?
        let bottomScore: Int?
        let winner: Side?
        let live: Bool
        var id: Int { number }
    }

    /// bo3.gg's live feed for the map being played. It exists only while
    /// bo3.gg's parser covers the match; otherwise rounds arrive after each map.
    struct CSLive: Hashable {
        let mapName: String?
        let mapNumber: Int?
        let round: Int?
        let topScore: Int
        let bottomScore: Int
        /// "CT" or "T".
        let topSide: String?
        let bottomSide: String?
        let mapEnded: Bool
    }

    struct Stream: Identifiable {
        let id: Int
        let name: String
        let url: URL
        let viewers: Int
        let official: Bool
        let language: String?
    }

    struct Player: Identifiable {
        let id: Int
        let nickname: String
        let realName: String?
        let flag: String?
        let photo: URL?
        /// bo3.gg's player slug, for the player page.
        var slug: String? = nil
    }

    /// The five active players and the coach (bench and former players excluded).
    struct Roster {
        var players: [Player] = []
        var coach: Player?
        /// The team's own short name on bo3.gg ("VIT", "MGZ").
        var acronym: String?
        var isEmpty: Bool { players.isEmpty && coach == nil }
    }

    /// One CS2 round: who won, from which side, how, and what each team spent.
    struct CSRound: Identifiable {
        enum Reason { case elimination, bombed, defused, time }
        let number: Int
        let winner: Side?
        /// "CT" or "T".
        let winnerSide: String?
        let reason: Reason
        let topEquipment: Int?
        let bottomEquipment: Int?
        var id: Int { number }
    }

    /// A pitch of the current at-bat, in ESPN's pitch coordinates (strike zone
    /// ≈ x 91…141, y 148…192 — inferred from where called strikes land).
    struct Pitch: Identifiable {
        enum Result { case ball, strike, inPlay }
        /// How a strike came.
        enum Strike { case called, swinging, foul, foulTip }
        let id: String
        let number: Int
        let x: Double
        let y: Double
        let result: Result
        /// ESPN abbreviation ("FF").
        let type: String?
        /// Full name ("Four-seam fastball").
        let typeName: String?
        let mph: Int?
        /// Nil for a ball, a ball in play, or a strike ESPN doesn't explain (an automatic one).
        var strike: Strike? = nil

        /// MLB pitch codes, for when ESPN sends only the abbreviation.
        static let names: [String: String] = [
            "FF": "Four-seam", "FA": "Fastball", "FT": "Two-seam", "SI": "Sinker", "FC": "Cutter", "SL": "Slider",
            "ST": "Sweeper", "SV": "Slurve", "CU": "Curveball", "KC": "Knuckle curve", "CS": "Slow curve",
            "CH": "Changeup", "FS": "Splitter", "FO": "Forkball", "SC": "Screwball", "KN": "Knuckleball",
            "EP": "Eephus", "PO": "Pitchout", "IN": "Intentional ball", "UN": "Unknown",
        ]
    }

    /// A ball in play, in ESPN's hit coordinates (home plate ≈ (125, 205),
    /// fence ≈ 165 units out — calibrated from home runs and ground outs).
    struct BattedBall: Identifiable {
        enum Outcome { case single, extraBases, homeRun, out }
        let id: String
        let x: Double
        let y: Double
        let outcome: Outcome
        let side: Side?
        let text: String
        var period: Int? = nil
    }

    /// A lead route: each climber's high point ("47+" → hold 47 and moving).
    struct WallRoute: Identifiable {
        struct Climber: Identifiable, Equatable {
            let id: Int
            let name: String
            /// IOC code ("USA").
            let country: String?
            let flag: String?
            /// Hold number, +0.5 when moving to the next ("47+").
            let height: Double
            let top: Bool
            let label: String
            let rank: Int?
            /// Climbing right now.
            var onWall = false
            var holds: Int { Int(height) }
            var moving: Bool { height > Double(Int(height)) }
        }
        let name: String
        let climbers: [Climber]
        /// Everyone on this route's startlist, climbed or not.
        let total: Int
        var id: String { name }
    }

    struct UpNext: Equatable {
        let name: String
        let flag: String?
        /// Starting position, of `total`.
        let position: Int
        let total: Int
    }

    /// A boulder scorecard row: how far the athlete got on each problem.
    struct BoulderCard: Identifiable, Equatable {
        enum Reach { case none, lowZone, zone, top }
        struct Problem: Equatable {
            let reach: Reach
            /// Attempts so far (IFSC counts them with or without a top).
            let tries: Int?
            /// Being climbed right now.
            var active = false
        }
        let id: Int
        let rank: Int?
        let name: String
        /// IOC code ("USA").
        let country: String?
        let flag: String?
        let problems: [Problem]
        let score: String?
        /// On a boulder right now.
        var onWall = false
    }

    struct Athlete: Identifiable {
        let id: Int
        let rank: Int?
        let name: String
        let country: String?
        let score: String?
    }

    var stats: [Stat] = []
    var linescore: Linescore?
    var moments: [Moment] = []
    var recentPlays: [String] = []
    /// Win probability for the top competitor.
    var topWinProbability: Double?
    /// Chance of a draw (soccer), so it isn't folded into either side.
    var drawProbability: Double?
    var football: Football?
    var baseball: Baseball?
    /// NBA: shot chart, game flow, leaders, box score, injuries.
    var basketball: Basketball?
    var maps: [MapResult] = []
    var streams: [Stream] = []
    var ranking: [Athlete] = []
    /// CS2 rosters, in top/bottom order.
    var topRoster = Roster()
    var bottomRoster = Roster()
    /// CS2 round history per map number.
    var rounds: [Int: [CSRound]] = [:]
    var atBat: [Pitch] = []
    var battedBalls: [BattedBall] = []
    var wall: [WallRoute] = []
    /// Live round score of the current CS2 map, when bo3.gg's live feed has it.
    var csLive: CSLive?
    /// Whether the top (first listed) team is at home; ESPN sports only.
    var topIsHome: Bool?
    /// The tournament a CS2 match belongs to, for its bracket.
    struct Tournament: Equatable {
        let slug: String
        let name: String
        /// "Group Stage · Round 2", "Playoffs · Quarterfinal".
        let stage: String?
    }
    var tournament: Tournament?
    /// Player ID → short name ("Y. Diaz"), from the box score, so the live
    /// lane can name the batter and pitcher without another request.
    var athleteNames: [String: String] = [:]
    /// Climbing order for a round with no results yet (rank = start position):
    /// the current round before anyone finishes, or the next round.
    var startlist: [Athlete] = []
    var startlistRound: String?
    /// Lead, live: who climbs next, from the starting order.
    var upNext: UpNext?
    var boulders: [BoulderCard] = []
    var boulderProblems: [String] = []
    var roundName: String?
    /// IFSC round status: "active", "finished", "pending".
    var roundStatus: String?
    var venue: String?
    /// ESPN's `header.season.current`: false for a game from a past season,
    /// whose table (today's) would say nothing about it. Nil when unknown.
    var seasonIsCurrent: Bool?
    var broadcast: String?
    /// Official broadcasters (US market, as ESPN reports them).
    var broadcasters: [Broadcaster] = []

    var isEmpty: Bool {
        stats.isEmpty && linescore == nil && moments.isEmpty && recentPlays.isEmpty && football == nil
            && baseball == nil && maps.isEmpty && streams.isEmpty && ranking.isEmpty && topRoster.isEmpty
            && wall.isEmpty && startlist.isEmpty && boulders.isEmpty && battedBalls.isEmpty && basketball == nil
    }
}

// MARK: - Lenient JSON

/// Minimal dynamic JSON accessor: every lookup is optional, so missing or
/// reshaped fields degrade to "not shown" instead of failing the whole page.
struct JSON {
    let raw: Any?

    init(_ raw: Any?) { self.raw = raw }
    init(data: Data) { raw = try? JSONSerialization.jsonObject(with: data) }

    // Foundation lookups: `raw as? [String: Any]` bridges (copies and
    // type-checks) the whole dictionary on every subscript.
    subscript(key: String) -> JSON {
        guard let dictionary = raw as? NSDictionary else { return JSON(nil) }
        return JSON(dictionary.object(forKey: key))
    }
    subscript(index: Int) -> JSON {
        guard let array = raw as? NSArray, index >= 0, index < array.count else { return JSON(nil) }
        return JSON(array.object(at: index))
    }

    var array: [JSON] {
        guard let array = raw as? NSArray else { return [] }
        var out: [JSON] = []
        out.reserveCapacity(array.count)
        for element in array { out.append(JSON(element)) }
        return out
    }
    var string: String? {
        if let s = raw as? String { return s }
        if let n = raw as? NSNumber { return n.stringValue }
        return nil
    }
    var double: Double? {
        if let n = raw as? NSNumber { return n.doubleValue }
        return (raw as? String).flatMap(Double.init)
    }
    /// Never traps: NaN, infinity and out-of-range values come back nil.
    var int: Int? { double.flatMap { $0.isFinite ? Int(exactly: $0.rounded(.towardZero)) : nil } }
    var bool: Bool? { (raw as? NSNumber)?.boolValue }
    var exists: Bool { raw != nil && !(raw is NSNull) }

    static func fetch(_ url: URL, headers: [String: String] = [:]) async throws -> JSON {
        var request = URLRequest(url: url)
        headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        let (data, response) = try await HTTP.session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            Log.network.error("HTTP \(status) from \(url.host() ?? "", privacy: .public)\(url.path(), privacy: .public)")
            throw URLError(.badServerResponse)
        }
        return JSON(data: data)
    }
}

// MARK: - Fetching

enum DetailProvider {
    static func detail(for event: Event) async throws -> GameDetail {
        switch event.ref {
        case let .espn(path, id, sport): try await ESPNDetail.load(path: path, id: id, sport: sport, event: event)
        case let .counterStrike(slug, _): try await CSDetail.load(slug: slug, event: event)
        case let .climbing(_, _, resultURL, _, _, nextURL): try await ClimbingDetail.load(resultURL: resultURL, nextURL: nextURL)
        case nil: GameDetail()
        }
    }
}

enum ESPNDetail {
    static func load(path: String, id: String, sport: Sport, event: Event) async throws -> GameDetail {
        let base = "https://site.api.espn.com/apis/site/v2/sports/\(path)"
        let summaryURL = try URL.api("\(base)/summary?event=\(id)")
        async let summaryCall = JSON.fetch(summaryURL)
        // The live situation (down & distance, count, bases) only lives on the scoreboard.
        // The live situation (down & distance, count and bases) only exists for
        // football and baseball, and only on the scoreboard.
        let needsSituation = event.state == .live && (sport == .football || sport == .baseball)
        let boardURL = needsSituation ? try? URL.api("\(base)/scoreboard") : nil
        async let boardCall: JSON? = Self.optionalFetch(boardURL)
        let summary = try await summaryCall
        let board = await boardCall

        // Map ESPN team ids to our top/bottom order.
        let ids = event.competitors.map { $0.id?.split(separator: "-").last.map(String.init) }
        func side(_ teamID: String?) -> GameDetail.Side? {
            guard let teamID else { return nil }
            if teamID == ids.first ?? nil { return .top }
            if teamID == ids.last ?? nil { return .bottom }
            return nil
        }

        var detail = GameDetail()
        detail.venue = summary["gameInfo"]["venue"]["fullName"].string
        detail.seasonIsCurrent = summary["header"]["season"]["current"].bool
        detail.broadcast = summary["header"]["competitions"][0]["broadcasts"][0]["media"]["shortName"].string
        var seen = Set<String>()
        detail.broadcasters = summary["header"]["competitions"][0]["broadcasts"].array.compactMap { b in
            guard let name = b["media"]["shortName"].string ?? b["media"]["callLetters"].string,
                  seen.insert(name).inserted else { return nil }
            return Broadcaster(name: name, type: b["type"]["shortName"].string)
        }
        // Radio last: most people are looking for a picture.
        .sorted { ($0.kind == .radio ? 1 : 0) < ($1.kind == .radio ? 1 : 0) }

        let competitors = summary["header"]["competitions"][0]["competitors"].array
        let topComp = competitors.first { $0["team"]["id"].string == ids.first ?? nil }
        let bottomComp = competitors.first { $0["team"]["id"].string == ids.last ?? nil }

        detail.topIsHome = topComp.map { $0["homeAway"].string == "home" }
        detail.stats = stats(summary, sport: sport, topID: ids.first ?? nil, bottomID: ids.last ?? nil, path: path)
        if sport != .soccer, let topComp, let bottomComp {
            detail.linescore = linescore(top: topComp, bottom: bottomComp, sport: sport)
        }

        // Win probability is reported for the home side.
        if let latest = summary["winprobability"].array.last, let home = latest["homeWinPercentage"].double {
            let tie = latest["tiePercentage"].double ?? 0
            let homeIsTop = topComp?["homeAway"].string == "home"
            detail.topWinProbability = homeIsTop ? home : max(1 - home - tie, 0)
            detail.drawProbability = tie > 0 ? tie : nil
        }

        switch sport {
        case .soccer:
            detail.moments = summary["keyEvents"].array.compactMap { soccerMoment($0, side: side) }
            detail.recentPlays = summary["commentary"].array.suffix(4).reversed().compactMap { c in
                guard let text = c["text"].string else { return nil }
                let time = c["time"]["displayValue"].string ?? ""
                return time.isEmpty ? text : "\(time)  \(text)"
            }
        case .baseball:
            let plays = summary["plays"].array
            detail.moments = plays.filter { $0["scoringPlay"].bool == true }.map { p in
                GameDetail.Moment(
                    id: p["id"].string ?? UUID().uuidString, kind: .score,
                    clock: p["period"]["displayValue"].string ?? "", text: p["text"].string ?? "",
                    side: side(p["team"]["id"].string),
                    score: scoreAfter(p, topIsHome: topComp?["homeAway"].string == "home"),
                    period: p["period"]["number"].int)
            }
            detail.recentPlays = plays.filter { $0["type"]["type"].string == "play-result" }
                .suffix(4).reversed().compactMap { $0["text"].string }
            detail.atBat = currentAtBat(plays)
            detail.battedBalls = battedBalls(plays, side: side)
            for team in summary["boxscore"]["players"].array {
                for group in team["statistics"].array {
                    for entry in group["athletes"].array {
                        let athlete = entry["athlete"]
                        if let id = athlete["id"].string, let name = athlete["shortName"].string ?? athlete["displayName"].string {
                            detail.athleteNames[id] = name
                        }
                    }
                }
            }
        case .basketball where path == NBADetail.path:
            let topIsHome = topComp?["homeAway"].string == "home"
            detail.basketball = NBADetail.parse(summary, side: side, topIsHome: topIsHome)
            detail.moments = NBADetail.keyMoments(summary, side: side, topIsHome: topIsHome)
            // Game order is array order (sequence numbers aren't).
            detail.recentPlays = NBADetail.recentPlays(summary["plays"].array)
            // Joined to the plays by ID; before tip-off, ESPN's matchup predictor stands in.
            if let home = NBADetail.homeWinProbability(summary) { detail.topWinProbability = topIsHome ? home : 1 - home }
            if detail.topWinProbability == nil { detail.topWinProbability = NBADetail.predictor(summary, topIsHome: topIsHome) }
        default:
            detail.moments = summary["scoringPlays"].array.map { p in
                let period = p["period"]["number"].int.map { periodName($0, sport: sport) } ?? ""
                let clock = p["clock"]["displayValue"].string ?? ""
                return GameDetail.Moment(
                    id: p["id"].string ?? UUID().uuidString, kind: .score,
                    clock: [period, clock].filter { !$0.isEmpty }.joined(separator: " "),
                    text: p["text"].string ?? p["type"]["text"].string ?? "",
                    side: side(p["team"]["id"].string),
                    score: scoreAfter(p, topIsHome: topComp?["homeAway"].string == "home"),
                    period: p["period"]["number"].int)
            }
            detail.recentPlays = summary["plays"].array.suffix(4).reversed().compactMap { $0["text"].string }
        }

        if let situation = board?["events"].array.first(where: { $0["id"].string == id })?["competitions"][0]["situation"],
           situation.exists {
            if sport == .football { detail.football = football(situation, topComp: topComp, side: side) }
            if sport == .baseball {
                detail.baseball = baseball(situation)
                // The scoreboard only says a base is taken; the summary says by whom.
                detail.baseball?.runners = GameDetail.Baseball.runners(summary["situation"], names: detail.athleteNames)
            }
            if detail.recentPlays.isEmpty, let last = situation["lastPlay"]["text"].string { detail.recentPlays = [last] }
        }
        return detail
    }

    static func optionalFetch(_ url: URL?) async -> JSON? {
        guard let url else { return nil }
        return try? await JSON.fetch(url)
    }

    // MARK: Baseball

    /// Pitches of the at-bat in progress, or the last completed one between batters.
    static func currentAtBat(_ plays: [JSON]) -> [GameDetail.Pitch] {
        let ends = plays.indices.filter { plays[$0]["type"]["type"].string == "end-batterpitcher" }
        let slice: ArraySlice<JSON>
        if let last = ends.last, last == plays.count - 1 {
            let previous = ends.dropLast().last.map { $0 + 1 } ?? 0
            slice = plays[previous..<last]
        } else {
            slice = plays[(ends.last.map { $0 + 1 } ?? 0)...]
        }
        // Pitch events only ("Pitch 3 : Ball"), not the result line that repeats the location.
        let pitches = slice.filter { p in
            p["pitchCoordinate"].exists && (p["summaryType"].string == "P" || (p["text"].string ?? "").hasPrefix("Pitch"))
        }
        return pitches.enumerated().compactMap { index, p in
            guard let x = p["pitchCoordinate"]["x"].double, let y = p["pitchCoordinate"]["y"].double else { return nil }
            let type = p["type"]["type"].string ?? ""
            // A caught foul ("foul-out") is a ball in play, not a strike.
            let strike: GameDetail.Pitch.Strike? =
                type.hasPrefix("foul-out") ? nil
                : type.hasPrefix("foul") ? (type.contains("tip") ? .foulTip : .foul)
                : type.hasPrefix("strike-swinging") || type.contains("missed-bunt") ? .swinging
                : type.hasPrefix("strike-looking") ? .called
                : nil
            let result: GameDetail.Pitch.Result =
                strike != nil || type.contains("strike") ? .strike
                : type.contains("ball") || type.contains("hit-by-pitch") ? .ball
                : .inPlay
            let code = p["pitchType"]["abbreviation"].string
            return GameDetail.Pitch(id: p["id"].string ?? "\(index)", number: index + 1, x: x, y: y, result: result,
                                    type: code, typeName: p["pitchType"]["text"].string ?? code.flatMap { GameDetail.Pitch.names[$0] },
                                    mph: p["pitchVelocity"].int, strike: strike)
        }
    }

    static func battedBalls(_ plays: [JSON], side: (String?) -> GameDetail.Side?) -> [GameDetail.BattedBall] {
        let hits: [String: GameDetail.BattedBall.Outcome] = ["single": .single, "double": .extraBases, "triple": .extraBases,
                                                             "home-run": .homeRun]
        let outs: Set<String> = ["ground-out", "fly-out", "line-out", "pop-out", "foul-out", "sacrifice",
                                 "bunt-ground-out", "batters-fielders-choice---runner-out", "batter-reached-on-error---batter-to-first"]
        // The ball in play is the pitch; the scoring play is the at-bat's
        // result entry. Keyed by the result's ID, a ball matches its scoring play.
        var results: [String: String] = [:]
        for p in plays where p["type"]["type"].string == "play-result" {
            if let atBat = p["atBatId"].string, let id = p["id"].string { results[atBat] = id }
        }
        return plays.compactMap { p in
            let type = p["type"]["type"].string ?? ""
            guard let outcome = hits[type] ?? (outs.contains(type) ? .out : nil),
                  let x = p["hitCoordinate"]["x"].double, let y = p["hitCoordinate"]["y"].double else { return nil }
            // Wait for the at-bat's result, so a ball keeps one ID from the start.
            let id: String
            if let atBat = p["atBatId"].string {
                guard let result = results[atBat] else { return nil }
                id = result
            } else {
                id = p["id"].string ?? UUID().uuidString
            }
            return GameDetail.BattedBall(id: id, x: x, y: y, outcome: outcome,
                                         side: side(p["team"]["id"].string), text: p["type"]["text"].string ?? "",
                                         period: p["period"]["number"].int)
        }
    }

    // MARK: Pieces

    static let preferredStats: [Sport: [(String, String)]] = [
        .soccer: [("possessionPct", "Possession"), ("totalShots", "Shots"), ("shotsOnTarget", "Shots on Target"),
                  ("wonCorners", "Corners"), ("saves", "Saves"), ("foulsCommitted", "Fouls"),
                  ("yellowCards", "Yellow Cards"), ("redCards", "Red Cards")],
        .football: [("totalYards", "Total Yards"), ("netPassingYards", "Passing Yards"), ("rushingYards", "Rushing Yards"),
                    ("firstDowns", "First Downs"), ("thirdDownEff", "Third-Down Conversions"), ("turnovers", "Turnovers"),
                    ("totalPenaltiesYards", "Penalties–Yards"), ("possessionTime", "Time of Possession")],
        .basketball: [("fieldGoalPct", "Field Goal %"), ("threePointFieldGoalPct", "3-Point %"), ("freeThrowPct", "Free Throw %"),
                      ("totalRebounds", "Rebounds"), ("assists", "Assists"), ("turnovers", "Turnovers"),
                      ("steals", "Steals"), ("blocks", "Blocks")],
    ]

    /// NBA (not WNBA): shooting, the hustle numbers and how the game was won.
    static let nbaStats: [(String, String)] = [
        ("fieldGoalPct", "Field Goal %"), ("threePointFieldGoalPct", "3-Point %"), ("freeThrowPct", "Free Throw %"),
        ("totalRebounds", "Rebounds"), ("assists", "Assists"), ("totalTurnovers", "Turnovers"),
        ("steals", "Steals"), ("blocks", "Blocks"), ("pointsInPaint", "Points in the Paint"),
        ("fastBreakPoints", "Fast Break Points"), ("largestLead", "Largest Lead"),
    ]

    static func stats(_ summary: JSON, sport: Sport, topID: String?, bottomID: String?, path: String = "") -> [GameDetail.Stat] {
        let teams = summary["boxscore"]["teams"].array
        guard let top = teams.first(where: { $0["team"]["id"].string == topID }),
              let bottom = teams.first(where: { $0["team"]["id"].string == bottomID }) else { return [] }
        func values(_ team: JSON) -> [String: (label: String, value: String)] {
            var map: [String: (String, String)] = [:]
            for s in team["statistics"].array {
                guard let name = s["name"].string, let value = s["displayValue"].string else { continue }
                map[name] = (s["label"].string ?? name, value)
            }
            return map
        }
        let t = values(top), b = values(bottom)

        let nba = path == NBADetail.path
        let wanted: [(String, String)] = (nba ? nbaStats : nil) ?? preferredStats[sport]
            ?? top["statistics"].array.compactMap { s in s["name"].string.map { ($0, s["label"].string ?? $0) } }
        return wanted.prefix(nba ? nbaStats.count : 8).compactMap { key, label in
            guard let tv = t[key]?.value, let bv = b[key]?.value else { return nil }
            let tn = magnitude(tv), bn = magnitude(bv)
            guard tn != nil || bn != nil else { return nil }
            let total = (tn ?? 0) + (bn ?? 0)
            // ESPN's NBA percentages are bare numbers ("45").
            let suffix = key == "possessionPct" || (nba && key.hasSuffix("Pct")) ? "%" : ""
            return GameDetail.Stat(label: label, top: tv + suffix, bottom: bv + suffix,
                                   topShare: total > 0 ? min(max((tn ?? 0) / total, 0), 1) : 0.5)
        }
    }

    /// Comparable number from display values like "8-12", "31:22", "45.5", "5-45".
    /// Never negative: bars compare sizes, and "-2" rushing yards draws as none.
    static func magnitude(_ value: String) -> Double? {
        if value.contains(":") {
            let parts = value.split(separator: ":").compactMap { Double($0) }
            return parts.count == 2 ? parts[0] * 60 + parts[1] : nil
        }
        if let n = Double(value) { return max(n, 0) }
        return value.split(separator: "-").first.flatMap { Double($0) }.map { max($0, 0) }
    }

    static func linescore(top: JSON, bottom: JSON, sport: Sport) -> GameDetail.Linescore? {
        let tl = top["linescores"].array, bl = bottom["linescores"].array
        let periods = max(tl.count, bl.count)
        guard periods > 0 else { return nil }
        func cell(_ lines: [JSON], _ i: Int) -> String { i < lines.count ? (lines[i]["displayValue"].string ?? "–") : "" }

        var headers = (0..<periods).map { periodHeader($0 + 1, sport: sport) }
        var topRow = (0..<periods).map { cell(tl, $0) }
        var bottomRow = (0..<periods).map { cell(bl, $0) }
        headers.append(sport == .baseball ? "R" : "T")
        topRow.append(top["score"].string ?? "")
        bottomRow.append(bottom["score"].string ?? "")
        if sport == .baseball {
            headers += ["H", "E"]
            topRow += [top["hits"].string ?? "", top["errors"].string ?? ""]
            bottomRow += [bottom["hits"].string ?? "", bottom["errors"].string ?? ""]
        }
        return GameDetail.Linescore(headers: headers, top: topRow, bottom: bottomRow)
    }

    /// A linescore column: "3", "OT", "2OT"; an inning's number.
    static func periodHeader(_ n: Int, sport: Sport) -> String {
        Period.label(n, sport: sport, style: .header)
    }

    /// A scoring play's period: "Q3", "OT", "2OT", "7OT" (never "OT" for every overtime).
    static func periodName(_ n: Int, sport: Sport) -> String {
        Period.label(n, sport: sport)
    }

    static func scoreAfter(_ play: JSON, topIsHome: Bool) -> String? {
        guard let away = play["awayScore"].int, let home = play["homeScore"].int else { return nil }
        return topIsHome ? "\(home)–\(away)" : "\(away)–\(home)"
    }

    static func soccerMoment(_ e: JSON, side: (String?) -> GameDetail.Side?) -> GameDetail.Moment? {
        let type = e["type"]["type"].string ?? ""
        let kind: GameDetail.Moment.Kind
        switch type {
        case "goal", "penalty---scored", "goal---header", "goal---free-kick": kind = .goal
        case "own-goal": kind = .ownGoal
        case "yellow-card": kind = .yellow
        case "red-card", "yellow-red-card": kind = .red
        default:
            // Any other scoring play ESPN tags (e.g. new goal subtypes) still counts.
            guard e["scoringPlay"].bool == true else { return nil }
            kind = .goal
        }
        let seconds = e["clock"]["value"].double
        return GameDetail.Moment(
            id: e["id"].string ?? UUID().uuidString, kind: kind,
            clock: e["clock"]["displayValue"].string ?? "",
            text: e["shortText"].string ?? e["text"].string ?? e["type"]["text"].string ?? "",
            side: side(e["team"]["id"].string),
            minute: seconds.map { $0 / 60 })
    }

    static func football(_ s: JSON, topComp: JSON?, side: (String?) -> GameDetail.Side?) -> GameDetail.Football? {
        guard let yardLine = s["yardLine"].double else { return nil }
        let possession = side(s["possession"].string)
        let topIsHome = topComp?["homeAway"].string == "home"
        // `yardLine` counts from the home team's goal line ("PIT 1" with the
        // Saints at home is 99). The top team defends the left end zone and
        // attacks right, so x runs from the top team's goal line.
        let ballX = topIsHome ? yardLine : 100 - yardLine
        let distance = s["distance"].double
        let lineToGain = distance.map { possession == .bottom ? max(ballX - $0, 0) : min(ballX + $0, 100) }
        return GameDetail.Football(
            downDistance: s["downDistanceText"].string ?? s["shortDownDistanceText"].string,
            ballX: ballX,
            lineToGainX: possession == nil ? nil : lineToGain,
            possession: possession,
            redZone: s["isRedZone"].bool ?? false,
            topTimeouts: (topIsHome ? s["homeTimeouts"] : s["awayTimeouts"]).int,
            bottomTimeouts: (topIsHome ? s["awayTimeouts"] : s["homeTimeouts"]).int,
            lastPlay: s["lastPlay"]["text"].string)
    }

    static func baseball(_ s: JSON) -> GameDetail.Baseball? {
        guard s["outs"].exists || s["balls"].exists else { return nil }
        return GameDetail.Baseball(
            balls: s["balls"].int ?? 0, strikes: s["strikes"].int ?? 0, outs: s["outs"].int ?? 0,
            onFirst: s["onFirst"].bool ?? false, onSecond: s["onSecond"].bool ?? false, onThird: s["onThird"].bool ?? false,
            batter: s["batter"]["athlete"]["shortName"].string ?? s["batter"]["athlete"]["displayName"].string,
            pitcher: s["pitcher"]["athlete"]["shortName"].string ?? s["pitcher"]["athlete"]["displayName"].string,
            lastPlay: s["lastPlay"]["text"].string)
    }
}

enum CSDetail {
    static func load(slug: String, event: Event) async throws -> GameDetail {
        let match = try await JSON.fetch(URL.api("https://api.bo3.gg/api/v1/matches/\(slug)?with=games,streams"))
        let topID = match["team1"]["id"].int, bottomID = match["team2"]["id"].int
        async let live = event.state == .live
            ? liveState(matchID: match["id"].int, topTeamID: topID, bottomTeamID: bottomID) : nil
        func side(_ teamID: Int?) -> GameDetail.Side? {
            teamID == topID ? .top : teamID == bottomID ? .bottom : nil
        }

        var detail = GameDetail()
        detail.roundName = match["stage"]["name"].string
        if let slug = match["tournament"]["slug"].string {
            let name = match["tournament"]["name"].string ?? slug
            // "PGL Masters Bucharest 2026 Group Stage" → "Group Stage".
            let stage = match["stage"]["title"].string.map { $0.replacingOccurrences(of: name, with: "").trimmingCharacters(in: .whitespaces) }
            let parts = [stage, match["round"]["name"].string].compactMap { $0 }.filter { !$0.isEmpty }
            detail.tournament = GameDetail.Tournament(slug: slug, name: name, stage: parts.isEmpty ? nil : parts.joined(separator: " · "))
        }
        detail.maps = match["games"].array.compactMap { game -> GameDetail.MapResult? in
            guard let number = game["number"].int else { return nil }
            let winnerSide = side(game["winner_team_clan"]["team_id"].int)
            let w = game["winner_clan_score"].int, l = game["loser_clan_score"].int
            let status = game["status"].string ?? ""
            let finished = status == "finished" || game["state"].string == "done"
            return GameDetail.MapResult(
                number: number,
                name: mapName(game["map_name"].string),
                topScore: winnerSide == .bottom ? l : w,
                bottomScore: winnerSide == .bottom ? w : l,
                winner: finished ? winnerSide : nil,
                live: !finished && status != "upcoming" && status != "defwin")
        }.sorted { $0.number < $1.number }

        detail.streams = match["streams"].array.compactMap { s -> GameDetail.Stream? in
            guard let id = s["id"].int, let raw = s["raw_url"].string, let url = URL(string: raw) else { return nil }
            return GameDetail.Stream(id: id, name: s["name"].string ?? url.lastPathComponent, url: url,
                                     viewers: s["viewers_number"].int ?? 0, official: s["official"].bool ?? false,
                                     language: s["language"].string)
        }.sorted { a, b in
            // Official broadcasts first, then English, then most watched.
            if a.official != b.official { return a.official }
            let ae = a.language == "en", be = b.language == "en"
            return ae != be ? ae : a.viewers > b.viewers
        }

        async let top = roster(slug: match["team1"]["slug"].string)
        async let bottom = roster(slug: match["team2"]["slug"].string)
        async let rounds = rounds(games: match["games"].array,
                                  topTeam: (topID, match["team1"]["name"].string ?? ""),
                                  bottomTeam: (bottomID, match["team2"]["name"].string ?? ""))
        (detail.topRoster, detail.bottomRoster, detail.rounds, detail.csLive) = await (top, bottom, rounds, live)
        return detail
    }

    // MARK: Live feed

    /// The current map's live state, the same snapshot bo3.gg's match page
    /// loads. Nil when bo3.gg isn't covering the match live (a 404).
    static func liveState(matchID: Int?, topTeamID: Int?, bottomTeamID: Int?) async -> GameDetail.CSLive? {
        guard let matchID,
              let url = URL(string: "https://api.bo3.gg/api/v1/live/matches/\(matchID)/last_snapshot?discipline_id=1"),
              let json = try? await JSON.fetch(url) else { return nil }
        return parseLive(json, topTeamID: topTeamID, bottomTeamID: bottomTeamID)
    }

    static func parseLive(_ json: JSON, topTeamID: Int?, bottomTeamID: Int?) -> GameDetail.CSLive? {
        let one = json["team_one"], two = json["team_two"]
        guard let oneScore = one["score"].int, let twoScore = two["score"].int else { return nil }
        // team_one is whoever bo3.gg's feed lists first, not necessarily team1.
        let swapped = (one["fixture"]["team_id"].int).map { $0 == bottomTeamID } ?? false
            || (two["fixture"]["team_id"].int).map { $0 == topTeamID } ?? false
        let (top, bottom) = swapped ? (two, one) : (one, two)
        func side(_ team: JSON) -> String? {
            guard let raw = team["side"].string?.lowercased() else { return nil }
            return raw.hasPrefix("c") ? "CT" : raw.hasPrefix("t") ? "T" : nil
        }
        return GameDetail.CSLive(
            mapName: json["map_name"].string.map(mapName),
            mapNumber: json["game_number"].int,
            round: json["round_number"].int,
            topScore: swapped ? twoScore : oneScore,
            bottomScore: swapped ? oneScore : twoScore,
            topSide: side(top), bottomSide: side(bottom),
            mapEnded: json["game_ended"].bool ?? false)
    }

    /// "Mirage 5–8" for a live row in the scores list, top team first.
    static func liveLine(for event: Event) async -> String? {
        guard event.state == .live, let matchID = Int(event.id.dropFirst(3)) else { return nil }
        let ids = event.competitors.map { $0.id.flatMap { Int($0.dropFirst(3)) } }
        guard let live = await liveState(matchID: matchID, topTeamID: ids.first ?? nil, bottomTeamID: ids.last ?? nil),
              !live.mapEnded else { return nil }
        return [live.mapName, "\(live.topScore)–\(live.bottomScore)"].compactMap { $0 }.joined(separator: " ")
    }

    /// A team's active five and its coach. bo3.gg marks benched/former members
    /// with `status` 2 and coaches with `is_coach`. Failures leave it empty.
    static func roster(slug: String?) async -> GameDetail.Roster {
        guard let slug, let url = URL(string: "https://api.bo3.gg/api/v1/teams/\(slug)?with=players.country"),
              let team = try? await JSON.fetch(url) else { return GameDetail.Roster() }
        var roster = GameDetail.Roster()
        roster.acronym = team["acronym"].string.flatMap { $0.isEmpty ? nil : $0 }
        for p in team["players"].array where p["status"].int == 1 {
            guard let id = p["id"].int, let nickname = p["nickname"].string else { continue }
            let name = [p["first_name"].string, p["last_name"].string].compactMap { $0 }.joined(separator: " ")
            let player = GameDetail.Player(id: id, nickname: nickname, realName: name.isEmpty ? nil : name,
                                           flag: Flag.emoji(iso2: p["country"]["code"].string),
                                           photo: p["image_url"].string.flatMap(URL.init(string:)),
                                           slug: p["slug"].string)
            if p["is_coach"].bool == true {
                if roster.coach == nil { roster.coach = player }
            } else if roster.players.count < 5 {
                roster.players.append(player)
            }
        }
        return roster
    }

    /// Finished maps never change, so their rounds are fetched once.
    /// Parsed rounds of finished maps (they never change), capped, with
    /// concurrent loads of the same map sharing one request.
    private actor RoundCache {
        private var finished: [Int: [GameDetail.CSRound]] = [:]
        private var order: [Int] = []
        private var inFlight: [Int: Task<[GameDetail.CSRound]?, Never>] = [:]
        private let capacity = 64

        func rounds(game id: Int, finished isFinished: Bool,
                    load: @escaping @Sendable () async -> [GameDetail.CSRound]?) async -> [GameDetail.CSRound]? {
            if let cached = finished[id] { return cached }
            if let task = inFlight[id] { return await task.value }
            let task = Task { await load() }
            inFlight[id] = task
            let result = await task.value
            inFlight[id] = nil
            if isFinished, let result {
                finished[id] = result
                order.append(id)
                if order.count > capacity { finished[order.removeFirst()] = nil }
            }
            return result
        }
    }
    private static let roundCache = RoundCache()

    /// Round-by-round history for every map that has started.
    static func rounds(games: [JSON], topTeam: (id: Int?, name: String),
                       bottomTeam: (id: Int?, name: String)) async -> [Int: [GameDetail.CSRound]] {
        let started = games.compactMap { game -> (id: Int, number: Int, finished: Bool)? in
            guard let id = game["id"].int, let number = game["number"].int,
                  let status = game["status"].string, status != "upcoming", status != "defwin" else { return nil }
            return (id, number, status == "finished")
        }
        return await withTaskGroup(of: (Int, [GameDetail.CSRound])?.self) { group in
            for game in started {
                group.addTask {
                    let rounds = await roundCache.rounds(game: game.id, finished: game.finished) {
                        guard let url = try? URL.api("https://api.bo3.gg/api/v1/games/\(game.id)"),
                              let json = try? await JSON.fetch(url) else { return nil }
                        return parseRounds(json, topTeam: topTeam, bottomTeam: bottomTeam)
                    }
                    return rounds.map { (game.number, $0) }
                }
            }
            var result: [Int: [GameDetail.CSRound]] = [:]
            for await entry in group { if let (number, rounds) = entry { result[number] = rounds } }
            return result
        }
    }

    static func parseRounds(_ game: JSON, topTeam: (id: Int?, name: String),
                            bottomTeam: (id: Int?, name: String)) -> [GameDetail.CSRound] {
        // Clan names ("G2 Esports") can differ from team names ("G2"); the game's
        // winner/loser clans carry team ids, with a name match as fallback.
        var clans: [String: GameDetail.Side] = [:]
        for key in ["winner_team_clan", "loser_team_clan"] {
            let clan = game[key]
            guard let name = clan["clan_name"].string else { continue }
            if clan["team_id"].int == topTeam.id { clans[name] = .top }
            if clan["team_id"].int == bottomTeam.id { clans[name] = .bottom }
        }
        func side(_ clan: String?) -> GameDetail.Side? {
            guard let clan else { return nil }
            if let known = clans[clan] { return known }
            let c = clan.lowercased(), t = topTeam.name.lowercased(), b = bottomTeam.name.lowercased()
            if c.contains(t) || t.contains(c) { return .top }
            if c.contains(b) || b.contains(c) { return .bottom }
            return nil
        }
        return game["game_rounds"].array.compactMap { r -> GameDetail.CSRound? in
            guard let number = r["round_number"].int else { return nil }
            var equipment: [GameDetail.Side: Int] = [:]
            for clan in r["game_round_team_clans"].array {
                if let s = side(clan["clan_name"].string) { equipment[s] = clan["equipment_value"].int }
            }
            let reason: GameDetail.CSRound.Reason = switch r["end_reason"].string {
            case "TargetBombed": .bombed
            case "BombDefused": .defused
            case "TargetSaved": .time
            default: .elimination
            }
            return GameDetail.CSRound(number: number, winner: side(r["winner_clan_name"].string),
                                      winnerSide: r["winner_clan_side"].string, reason: reason,
                                      topEquipment: equipment[.top], bottomEquipment: equipment[.bottom])
        }.sorted { $0.number < $1.number }
    }

    static func mapName(_ raw: String?) -> String {
        guard let raw else { return "TBD" }
        let known = ["de_dust2": "Dust II", "de_mirage": "Mirage", "de_inferno": "Inferno", "de_nuke": "Nuke",
                     "de_ancient": "Ancient", "de_anubis": "Anubis", "de_vertigo": "Vertigo", "de_train": "Train",
                     "de_overpass": "Overpass", "de_cache": "Cache"]
        return known[raw] ?? raw.replacingOccurrences(of: "de_", with: "").capitalized
    }
}

enum ClimbingDetail {
    static func load(resultURL: String?, nextURL: String?) async throws -> GameDetail {
        var detail = GameDetail()
        if let resultURL { detail = try await load(resultURL) }
        // The next round publishes its starting order before it begins.
        if let nextURL, nextURL != resultURL, let next = try? await fetch(nextURL) {
            let order = startlist(next)
            if !order.isEmpty {
                detail.startlist = order
                detail.startlistRound = next["round"].string
            }
        }
        return detail
    }

    private static func fetch(_ path: String) async throws -> JSON {
        try await JSON.fetch(URL.api(path, relativeTo: "https://ifsc.results.info"),
                             headers: ["Referer": "https://ifsc.results.info/"])
    }

    private static func startlist(_ results: JSON) -> [GameDetail.Athlete] {
        results["startlist"].array.compactMap { a -> GameDetail.Athlete? in
            guard let id = a["athlete_id"].int else { return nil }
            let last = (a["lastname"].string ?? "").capitalized
            return GameDetail.Athlete(id: id, rank: a["route_start_positions"].array.first?["position"].int,
                                      name: [a["firstname"].string, last].compactMap { $0 }.joined(separator: " "),
                                      country: a["country"].string, score: nil)
        }
        .sorted { ($0.rank ?? .max) < ($1.rank ?? .max) }
    }

    private static func load(_ resultURL: String) async throws -> GameDetail {
        let results = try await fetch(resultURL)
        var detail = GameDetail()
        detail.roundName = results["round"].string
        detail.ranking = results["ranking"].array.compactMap { a in
            guard let id = a["athlete_id"].int ?? a["id"].int else { return nil }
            let first = a["firstname"].string ?? ""
            let last = (a["lastname"].string ?? "").capitalized
            let score = a["score"].string.flatMap { $0.isEmpty ? nil : $0 }
            return GameDetail.Athlete(id: id, rank: a["rank"].int, name: "\(first) \(last)", country: a["country"].string, score: score)
        }

        let athletes = results["ranking"].array
        let routeNames = results["routes"].array.compactMap { $0["name"].string }
        let ascents = athletes.flatMap { $0["ascents"].array }
        // IFSC names the discipline. (Lead ascents carry a time too, so a time
        // alone doesn't mean speed.)
        let discipline = results["discipline"].string?.lowercased()
        let isBoulder = discipline == "boulder" || (discipline == nil && ascents.contains { $0["zone"].exists })
        // Speed ascents are times, not heights: they don't belong on the wall.
        let isSpeed = discipline == "speed" || (discipline == nil && ascents.contains { $0["time_ms"].exists && !$0["plus"].exists })
        if isBoulder {
            detail.boulderProblems = routeNames
            // The top 12, plus whoever is climbing if they aren't placed yet.
            let cards = athletes.compactMap { boulderCard($0, routes: routeNames) }
            detail.boulders = Array(cards.prefix(12)) + cards.dropFirst(12).filter(\.onWall)
        } else if !isSpeed, !ascents.isEmpty {
            detail.wall = routeNames.map { wallRoute(named: $0, athletes: athletes) }.filter { !$0.climbers.isEmpty }
            detail.upNext = upNext(results, route: routeNames.first)
        }
        detail.roundStatus = results["status"].string
        if detail.ranking.isEmpty {
            detail.startlist = startlist(results)
            detail.startlistRound = detail.roundName
        }
        return detail
    }

    /// The first climber in the starting order who hasn't climbed yet (and
    /// isn't on the wall now).
    static func upNext(_ results: JSON, route: String?) -> GameDetail.UpNext? {
        guard let route else { return nil }
        let athletes = results["ranking"].array
        func ascent(_ a: JSON) -> JSON? { a["ascents"].array.first { $0["route_name"].string == route } }
        let waiting = Set(athletes.filter { a in
            a["active"].bool != true && ascent(a)?["status"].string == "pending"
        }.compactMap { $0["athlete_id"].int })
        let order = results["startlist"].array.compactMap { s -> (id: Int, position: Int, entry: JSON)? in
            guard let id = s["athlete_id"].int,
                  let position = s["route_start_positions"].array.first(where: { $0["route_name"].string == route })?["position"].int
            else { return nil }
            return (id, position, s)
        }
        .sorted { $0.position < $1.position }
        guard let next = order.first(where: { waiting.contains($0.id) }) else { return nil }
        return GameDetail.UpNext(name: shortName(next.entry), flag: Flag.emoji(ioc: next.entry["country"].string),
                                 position: next.position, total: order.count)
    }

    private static func shortName(_ a: JSON) -> String {
        let initial = a["firstname"].string?.first.map { "\($0). " } ?? ""
        return initial + (a["lastname"].string ?? "").capitalized
    }

    /// Lead: "47+" means the climber held hold 47 and was moving to 48.
    static func wallRoute(named name: String, athletes: [JSON]) -> GameDetail.WallRoute {
        let climbers = athletes.compactMap { a -> GameDetail.WallRoute.Climber? in
            guard let id = a["athlete_id"].int,
                  let ascent = a["ascents"].array.first(where: { $0["route_name"].string == name }) else { return nil }
            let score = ascent["score"].string ?? ""
            // On the wall: IFSC flags the climber (and their ascent) as active.
            let onWall = a["active"].bool == true || ascent["status"].string == "active"
            guard !score.isEmpty || onWall else { return nil }
            let top = ascent["top"].bool == true || score.uppercased().contains("TOP")
            let holds = Double(score.prefix { $0.isNumber || $0 == "." }) ?? 0
            let height = holds + (ascent["plus"].bool == true || score.hasSuffix("+") ? 0.5 : 0)
            var climber = GameDetail.WallRoute.Climber(id: id, name: shortName(a), country: a["country"].string,
                                                       flag: Flag.emoji(ioc: a["country"].string),
                                                       height: height, top: top, label: top ? "Top" : (score.isEmpty ? "0" : score),
                                                       rank: ascent["rank"].int ?? a["rank"].int)
            climber.onWall = onWall && !top
            return climber
        }
        // IFSC scores a top as "TOP", with no hold number: place it one hold
        // above the best non-topped height, so heights stay ordered and
        // nothing reads as zero.
        let best = climbers.filter { !$0.top }.map(\.height).max() ?? 0
        let topHeight = max(best.rounded(.down) + 1, climbers.filter(\.top).map(\.height).max() ?? 0)
        let normalized = climbers.map { c in
            guard c.top else { return c }
            var topped = GameDetail.WallRoute.Climber(id: c.id, name: c.name, country: c.country, flag: c.flag,
                                                      height: max(c.height, topHeight).rounded(.down), top: true,
                                                      label: c.label, rank: c.rank)
            topped.onWall = false
            return topped
        }
        // Highest first; topped climbers above everyone; ties by route rank.
        let ordered = normalized.sorted { a, b in
            if a.top != b.top { return a.top }
            if a.height != b.height { return a.height > b.height }
            return (a.rank ?? .max) < (b.rank ?? .max)
        }
        return GameDetail.WallRoute(name: name, climbers: ordered, total: athletes.count)
    }

    static func boulderCard(_ a: JSON, routes: [String]) -> GameDetail.BoulderCard? {
        guard let id = a["athlete_id"].int else { return nil }
        let ascents = a["ascents"].array
        let problems = routes.map { route -> GameDetail.BoulderCard.Problem in
            guard let s = ascents.first(where: { $0["route_name"].string == route }) else { return .init(reach: .none, tries: nil) }
            let active = s["status"].string == "active"
            // Attempts: IFSC counts them in top_tries whether or not there's a top.
            let attempts = s["top_tries"].int ?? s["zone_tries"].int
            if s["top"].bool == true { return .init(reach: .top, tries: s["top_tries"].int, active: active) }
            if s["zone"].bool == true { return .init(reach: .zone, tries: attempts, active: active) }
            if s["low_zone"].bool == true { return .init(reach: .lowZone, tries: attempts ?? s["low_zone_tries"].int, active: active) }
            return .init(reach: .none, tries: attempts.flatMap { $0 > 0 ? $0 : nil }, active: active)
        }
        var card = GameDetail.BoulderCard(id: id, rank: a["rank"].int, name: shortName(a), country: a["country"].string,
                                          flag: Flag.emoji(ioc: a["country"].string), problems: problems,
                                          score: a["score"].string.flatMap { $0.isEmpty ? nil : $0 })
        card.onWall = a["active"].bool == true || problems.contains(where: \.active)
        return card
    }
}
