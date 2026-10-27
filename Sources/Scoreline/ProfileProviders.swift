import Foundation

// Where team and player pages get their data, and how it's read. URL builders
// plus pure parse functions over `Data`, so tests decode recorded samples
// directly. Parsing is lenient (`JSON`): a reshaped field drops that detail,
// never the page.

// MARK: - Photos

enum PhotoURL {
    enum Size { case small, hero }

    /// ESPN's resized headshot: 96×70 (7 KB) for lists, 260×190 for the hero,
    /// instead of the 600×436 original (200 KB). Missing photos are a 404,
    /// which `ImageCache` remembers, so the monogram shows.
    static func espn(path: String, id: String, size: Size) -> URL? {
        let league = path.hasPrefix("soccer") ? "soccer" : String(path.split(separator: "/").last ?? "")
        let (w, h) = size == .small ? (96, 70) : (260, 190)
        return URL(string: "https://a.espncdn.com/combiner/i?img=/i/headshots/\(league)/players/full/\(id).png&w=\(w)&h=\(h)&scale=crop&cquality=40&location=origin")
    }

    /// bo3.gg's image proxy: a 2 KB thumbnail of a 15 KB portrait.
    static func bo3(_ url: URL?, size: Size) -> URL? {
        guard let url, url.host() == "files.bo3.gg" else { return url }
        let px = size == .small ? 96 : 240
        return URL(string: "https://image-proxy.bo3.gg\(url.path())?w=\(px)&h=\(px)")
    }

    /// The hero's size of a bo3.gg photo, from the original or a list's thumbnail.
    static func bo3(hero url: URL?) -> URL? {
        guard let url, url.host() == "image-proxy.bo3.gg" else { return bo3(url, size: .hero) }
        return URL(string: "https://image-proxy.bo3.gg\(url.path())?w=240&h=240")
    }
}

// MARK: - Shared readers

enum ProfileParse {
    private static let day: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    private static let rotowire: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "EEE MMM d HH:mm:ss zzz yyyy"
        return f
    }()

    /// ISO timestamps, or plain dates ("1999-03-12").
    static func date(_ s: String?) -> Date? {
        guard let s else { return nil }
        return DateParser.parse(s) ?? day.date(from: String(s.prefix(10)))
    }

    /// RotoWire's "Sun Oct 25 10:06:18 PDT 2026".
    static func rotowireDate(_ s: String?) -> Date? { s.flatMap { rotowire.date(from: $0) } }

    /// The athlete ID in a core `$ref` ("…/athletes/3945274?lang=en").
    static func refID(_ ref: String?, _ kind: String = "athletes") -> String? {
        guard let ref, let range = ref.range(of: "/\(kind)/") else { return nil }
        let id = ref[range.upperBound...].prefix { $0.isNumber }
        return id.isEmpty ? nil : String(id)
    }

    /// Labels lose stray whitespace (kicker labels carry tabs).
    static func label(_ s: String?) -> String { (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }

    static func url(_ s: String?) -> URL? { s.flatMap(URL.init(string:)) }
}

// MARK: - ESPN

enum ESPNProfiles {
    static let site = "https://site.api.espn.com/apis/site/v2/sports"
    static let web = "https://site.web.api.espn.com/apis/common/v3/sports"
    static let core = "https://sports.core.api.espn.com/v2/sports"

    /// "basketball/nba" → "…/basketball/leagues/nba".
    static func corePrefix(_ path: String) -> String {
        let parts = path.split(separator: "/")
        guard parts.count == 2 else { return "\(core)/\(path)" }
        return "\(core)/\(parts[0])/leagues/\(parts[1])"
    }

    /// The season year and type core URLs need, from the calendar (no waterfall).
    /// NBA seasons are named by their ending year; soccer by the starting one.
    static func season(for path: String, now: Date = .now) -> (year: Int, type: Int) {
        let cal = Calendar(identifier: .gregorian)
        let y = cal.component(.year, from: now), m = cal.component(.month, from: now)
        if path.hasPrefix("basketball") { return (m >= 8 ? y + 1 : y, 2) }
        if path.hasPrefix("soccer") { return (m >= 7 ? y : y - 1, 1) }
        return (m <= 2 ? y - 1 : y, 2)
    }

    static func teamURL(path: String?, team: String) -> URL? {
        URL(string: "\(site)/\(path ?? "soccer/all")/teams/\(team)")
    }

    static func rosterURL(path: String, team: String) -> URL? { URL(string: "\(site)/\(path)/teams/\(team)/roster") }

    /// NFL's site chart has names inline; NBA and MLB have core charts; college has none (400).
    static func depthURL(path: String, team: String, now: Date = .now) -> URL? {
        switch path {
        case "football/nfl": return URL(string: "\(site)/\(path)/teams/\(team)/depthcharts")
        case "basketball/nba", "baseball/mlb":
            return URL(string: "\(corePrefix(path))/seasons/\(season(for: path, now: now).year)/teams/\(team)/depthcharts")
        default: return nil
        }
    }

    static func leadersURL(path: String, team: String, now: Date = .now) -> URL? {
        let s = season(for: path, now: now)
        return URL(string: "\(corePrefix(path))/seasons/\(s.year)/types/\(s.type)/teams/\(team)/leaders")
    }

    /// Team stats with league ranks: not soccer (no ranks) or college (ranks among 260 teams).
    static func teamStatsURL(path: String, team: String, now: Date = .now) -> URL? {
        guard ["basketball/nba", "football/nfl", "baseball/mlb"].contains(path) else { return nil }
        let s = season(for: path, now: now)
        return URL(string: "\(corePrefix(path))/seasons/\(s.year)/types/\(s.type)/teams/\(team)/statistics")
    }

    static func transactionsURL(path: String, team: String) -> URL? {
        guard ["basketball/nba", "football/nfl", "baseball/mlb"].contains(path) else { return nil }
        return URL(string: "\(site)/\(path)/transactions?team=\(team)&limit=20")
    }

    static func athleteURL(path: String, id: String) -> URL? { URL(string: "\(web)/\(path)/athletes/\(id)") }
    static func overviewURL(path: String, id: String) -> URL? { URL(string: "\(web)/\(path)/athletes/\(id)/overview") }
    static func careerURL(path: String, id: String) -> URL? { URL(string: "\(web)/\(path)/athletes/\(id)/stats") }
    static func coreAthleteURL(path: String, id: String) -> URL? { URL(string: "\(corePrefix(path))/athletes/\(id)") }

    static func gamelogURL(path: String, id: String, category: String? = nil) -> URL? {
        URL(string: "\(web)/\(path)/athletes/\(id)/gamelog" + (category.map { "?category=\($0)" } ?? ""))
    }

    /// League top 25 per category: the rank source where ESPN's summary has none (NBA, soccer).
    static func leagueLeadersURL(path: String, now: Date = .now) -> URL? {
        let s = season(for: path, now: now)
        return URL(string: "\(corePrefix(path))/seasons/\(s.year)/types/\(s.type)/leaders?limit=25")
    }

    // MARK: Team

    static func header(_ data: Data, sport: Sport, path: String?, teamID: String) -> Profile.TeamHeader? {
        let t = JSON(data: data)["team"]
        guard let name = t["displayName"].string else { return nil }
        let venue = t["franchise"]["venue"].exists ? t["franchise"]["venue"] : t["venue"]
        var header = Profile.TeamHeader(
            name: name, shortName: t["shortDisplayName"].string ?? name, abbreviation: t["abbreviation"].string,
            logo: ProfileParse.url(t["logos"][0]["href"].string ?? t["logo"].string),
            color: t["color"].string, alternateColor: t["alternateColor"].string,
            record: t["record"]["items"].array.first { $0["type"].string == "total" }?["summary"].string,
            standing: t["standingSummary"].string.map(standing), coach: nil,
            venue: venue["fullName"].string, city: venue["address"]["city"].string,
            rank: nil, rankChange: nil, leagueSlug: t["leagueAbbrev"].string,
            link: t["links"].array.first { $0["rel"].array.contains { $0.string == "clubhouse" } }.flatMap { ProfileParse.url($0["href"].string) },
            next: nil)
        let event = t["nextEvent"][0]
        // ESPN's standing is wrong in the MLB postseason ("5th in NL West" for a 100-62 division winner).
        if sport == .baseball, event["seasonType"]["type"].int == 3 { header.standing = nil }
        header.next = game(event, sport: sport, path: path ?? "soccer/\(header.leagueSlug ?? "all")", teamID: teamID)
        return header
    }

    /// "2nd in English Premier League" → "2nd in Premier League".
    static func standing(_ s: String) -> String {
        var t = s
        for nation in ["English ", "Spanish ", "German ", "Italian ", "French "] { t = t.replacingOccurrences(of: "in \(nation)", with: "in ") }
        // ESPN files some NBA teams under their conference as if it were a division.
        return t.replacingOccurrences(of: "in LALIGA", with: "in LaLiga")
            .replacingOccurrences(of: " Conference Division", with: " Conference")
    }

    /// A scoreboard-shaped event, from the team's side.
    static func game(_ e: JSON, sport: Sport, path: String, teamID: String) -> Profile.GameRef? {
        let c = e["competitions"][0]
        guard let id = e["id"].string, let date = ProfileParse.date(e["date"].string) else { return nil }
        let comps = c["competitors"].array
        guard let us = comps.first(where: { $0["team"]["id"].string == teamID }) ?? comps.first,
              let them = comps.first(where: { $0["team"]["id"].string != us["team"]["id"].string }) else { return nil }
        func score(_ j: JSON) -> String? { j["score"]["displayValue"].string ?? j["score"].string }
        let state: EventState = switch c["status"]["type"]["state"].string ?? e["status"]["type"]["state"].string {
        case "in": .live
        case "post": .final
        default: .scheduled
        }
        let ot = them["team"]
        let opponent = ot["id"].string.map {
            Profile.TeamRef(id: ESPNTeamID.make(path: path, sport: sport, team: $0),
                            name: ot["shortDisplayName"].string ?? ot["displayName"].string ?? ot["abbreviation"].string ?? "",
                            logo: ProfileParse.url(ot["logos"][0]["href"].string ?? ot["logo"].string),
                            league: nil, color: ot["color"].string, abbreviation: ot["abbreviation"].string)
        }
        let network = c["broadcasts"].array.compactMap { $0["media"]["shortName"].string ?? $0["names"][0].string }.first
        let won = us["winner"].bool
        return Profile.GameRef(
            id: id, date: date, opponent: opponent, home: us["homeAway"].string == "home", network: network, state: state,
            teamScore: state == .scheduled ? nil : score(us), opponentScore: state == .scheduled ? nil : score(them),
            result: state == .final ? (won == true ? "W" : them["winner"].bool == true ? "L" : "D") : nil,
            competition: e["league"]["abbreviation"].string)
    }

    struct RosterData: Sendable {
        var players: [Profile.RosterPlayer]
        var coach: String?
        var seasonYear: Int?
    }

    static func roster(_ data: Data, sport: Sport, path: String, team: Profile.TeamRef) -> RosterData {
        let j = JSON(data: data)
        var players: [Profile.RosterPlayer] = []
        func add(_ a: JSON, group: String?) {
            guard let id = a["id"].string, let name = a["displayName"].string ?? a["fullName"].string else { return }
            let position = a["position"]["abbreviation"].string
            let hasHeadshot = a["headshot"]["href"].string != nil
            // Soccer headshots are rare (≈5%): only ask for the ones ESPN lists.
            let photo = sport == .soccer && !hasHeadshot ? nil : PhotoURL.espn(path: path, id: id, size: .small)
            var p = Profile.RosterPlayer(
                ref: Profile.PlayerRef(source: .espn(path: path), id: id, name: name, photo: photo, team: team,
                                       jersey: a["jersey"].string, position: position),
                jersey: a["jersey"].string, position: position, positionName: a["position"]["displayName"].string,
                age: a["age"].int, birthDate: ProfileParse.date(a["dateOfBirth"].string),
                height: a["displayHeight"].string, weight: a["displayWeight"].string,
                detail: nil, college: a["college"]["name"].string,
                injury: a["injuries"][0]["status"].string, sourceGroup: group)
            switch sport {
            case .football where path.hasSuffix("college-football"):
                p.detail = a["experience"]["displayValue"].string
                p.college = nil
            case .soccer:
                p.detail = a["citizenship"].string
                for category in a["statistics"]["splits"]["categories"].array {
                    for s in category["stats"].array {
                        if let key = s["name"].string, let value = s["displayValue"].string { p.stats[key] = value }
                    }
                }
            default: break
            }
            players.append(p)
        }
        for entry in j["athletes"].array {
            if entry["items"].exists {
                for a in entry["items"].array { add(a, group: entry["position"].string) }
            } else {
                add(entry, group: nil)
            }
        }
        // ESPN's soccer "coach" is a list of past managers: never shown.
        let c = j["coach"][0]
        let coach = sport == .soccer ? nil
            : [c["firstName"].string, c["lastName"].string].compactMap { $0 }.joined(separator: " ").nilIfEmpty
        return RosterData(players: players, coach: coach, seasonYear: j["season"]["year"].int)
    }

    /// NFL's site chart: offense, defense, special teams, slots in depth order.
    static func depthChart(_ data: Data) -> Profile.DepthChart? {
        let units = JSON(data: data)["depthchart"].array.compactMap { u -> Profile.DepthChart.Unit? in
            guard let positions = u["positions"].raw as? [String: Any] else { return nil }
            let name = u["name"].string ?? ""
            let keys = Array(positions.keys)
            let kind: Profile.DepthChart.Unit.Kind = name.localizedCaseInsensitiveContains("special") ? .specialTeams
                : keys.contains("qb") ? .offense : .defense
            let order = slotOrder[kind] ?? []
            let sorted = keys.sorted { a, b in
                let ia = order.firstIndex(of: a) ?? Int.max, ib = order.firstIndex(of: b) ?? Int.max
                return ia != ib ? ia < ib : a < b
            }
            let slots = sorted.compactMap { key -> Profile.DepthChart.Slot? in
                let p = JSON(positions[key])
                let players = p["athletes"].array.compactMap { a -> (id: String, name: String)? in
                    guard let id = a["id"].string, let name = a["displayName"].string ?? a["shortName"].string else { return nil }
                    return (id, name)
                }
                guard !players.isEmpty else { return nil }
                return Profile.DepthChart.Slot(key: key, label: p["position"]["abbreviation"].string ?? key.uppercased(),
                                               players: players)
            }
            return Profile.DepthChart.Unit(kind: kind, name: name, slots: slots)
        }
        guard !units.isEmpty else { return nil }
        return Profile.DepthChart(units: units.sorted { $0.kind < $1.kind })
    }

    /// Slot order within each unit (JSON objects arrive unordered).
    static let slotOrder: [Profile.DepthChart.Unit.Kind: [String]] = [
        .offense: ["qb", "rb", "fb", "wr1", "wr2", "wr3", "wr", "te", "lt", "lg", "c", "rg", "rt"],
        .defense: ["lde", "ldt", "nt", "rdt", "rde", "wlb", "lilb", "mlb", "rilb", "slb", "lolb", "rolb",
                   "lcb", "ss", "fs", "rcb", "nb"],
        .specialTeams: ["pk", "p", "h", "ls", "kr", "pr"],
    ]

    /// NBA/MLB core charts: slot key → athlete IDs in depth order.
    static func coreDepth(_ data: Data) -> [String: [String]] {
        guard let positions = JSON(data: data)["items"][0]["positions"].raw as? [String: Any] else { return [:] }
        var out: [String: [String]] = [:]
        for (key, value) in positions {
            out[key] = JSON(value)["athletes"].array.compactMap { ProfileParse.refID($0["athlete"]["$ref"].string) }
        }
        return out
    }

    /// Core team (or league) leaders: category → (athlete ID, display value), ranked.
    static func leaders(_ data: Data) -> [String: [(id: String, value: String)]] {
        var out: [String: [(id: String, value: String)]] = [:]
        for c in JSON(data: data)["categories"].array {
            guard let name = c["name"].string else { continue }
            out[name] = c["leaders"].array.compactMap { l in
                guard let id = ProfileParse.refID(l["athlete"]["$ref"].string),
                      let value = l["displayValue"].string else { return nil }
                return (id, value)
            }
        }
        return out
    }

    /// Team stats with league ranks, chosen for meaning (ranks past the
    /// league's size are ESPN noise and dropped).
    static func teamStats(_ data: Data, sport: Sport) -> [Profile.TeamStat] {
        var all: [String: (value: String, rank: String?)] = [:]
        for c in JSON(data: data)["splits"]["categories"].array {
            let cat = c["name"].string ?? ""
            for s in c["stats"].array {
                guard let name = s["name"].string, let value = s["displayValue"].string else { continue }
                all["\(cat).\(name)"] = (value, s["rankDisplayValue"].string)
            }
        }
        let (picks, field): ([(String, String)], Int) = switch sport {
        case .basketball: ([("offensive.fieldGoalPct", "Field goal %"), ("offensive.threePointPct", "3-point %"),
                            ("offensive.trueShootingPct", "True shooting %"), ("offensive.assists", "Assists"),
                            ("general.reboundRate", "Rebound rate"), ("defensive.steals", "Steals"),
                            ("defensive.blocks", "Blocks"), ("offensive.turnovers", "Turnovers")], 30)
        case .football: ([("passing.totalPointsPerGame", "Points per game"), ("passing.yardsPerGame", "Yards per game"),
                          ("passing.passingYardsPerGame", "Passing yards per game"),
                          ("rushing.rushingYardsPerGame", "Rushing yards per game"),
                          ("miscellaneous.thirdDownConvPct", "Third-down %"), ("miscellaneous.totalTakeaways", "Takeaways"),
                          ("defensive.sacks", "Sacks"), ("miscellaneous.turnOverDifferential", "Turnover margin")], 32)
        case .baseball: ([("batting.runs", "Runs scored"), ("batting.avg", "Batting average"), ("batting.OPS", "OPS"),
                          ("batting.homeRuns", "Home runs"), ("pitching.ERA", "ERA"), ("pitching.WHIP", "WHIP"),
                          ("pitching.strikeouts", "Strikeouts"), ("pitching.runs", "Runs allowed")], 30)
        default: ([], 0)
        }
        return picks.compactMap { key, label in
            guard let entry = all[key] else { return nil }
            let rank = Profile.rank(entry.rank, limit: field)
            return Profile.TeamStat(key: key, label: label, value: entry.value, rank: rank?.rank, rankText: rank?.text)
        }
    }

    static func transactions(_ data: Data) -> [Profile.Transaction] {
        JSON(data: data)["transactions"].array.compactMap { t in
            guard var text = t["description"].string else { return nil }
            // ESPN clips some at a fixed length ("…to a contrac."); finish the one word that's always clipped.
            if text.hasSuffix(" contrac.") { text = String(text.dropLast(9)) + " contract." }
            return Profile.Transaction(date: ProfileParse.date(t["date"].string), text: text)
        }
    }

    // MARK: Roster assembly

    /// Which leader categories fill which roster columns.
    static let leaderColumns: [Sport: [String: String]] = [
        .basketball: ["PTS": "pointsPerGame", "REB": "reboundsPerGame", "AST": "assistsPerGame",
                      "MIN": "minutesPerGame", "FG%": "fieldGoalPercentage"],
        .football: ["PYDS": "passingYards", "PTD": "passingTouchdowns", "RYDS": "rushingYards", "RTD": "rushingTouchdowns",
                    "REC": "receptions", "RECYDS": "receivingYards", "RECTD": "receivingTouchdowns",
                    "TOT": "totalTackles", "SACK": "sacks", "INT": "interceptions"],
        .baseball: ["AVG": "avg", "HR": "homeRuns", "RBI": "RBIs", "OPS": "OPS",
                    "ERA": "ERA", "K": "strikeouts", "W": "wins", "SV": "saves", "WHIP": "WHIP"],
    ]

    /// Groups the roster the way each sport thinks of it, filling stat columns from the leaders.
    static func groups(sport: Sport, college: Bool, players: [Profile.RosterPlayer],
                       leaders: [String: [(id: String, value: String)]], depth: [String: [String]]) -> [Profile.RosterGroup] {
        var players = players
        if let columns = leaderColumns[sport] {
            var lookup: [String: [String: String]] = [:]
            for (column, category) in columns {
                for entry in leaders[category] ?? [] { lookup[entry.id, default: [:]][column] = entry.value }
            }
            for i in players.indices { players[i].stats.merge(lookup[players[i].ref.id] ?? [:]) { a, _ in a } }
        }
        func number(_ p: Profile.RosterPlayer) -> Int { Int(p.jersey ?? "") ?? 999 }
        switch sport {
        case .basketball:
            let out = players.filter { $0.injury == "Out" }
            var used = Set<String>()
            var starters: [Profile.RosterPlayer] = []
            for slot in ["pg", "sg", "sf", "pf", "c"] {
                if let id = (depth[slot] ?? []).first(where: { !used.contains($0) && !out.map(\.ref.id).contains($0) }),
                   let p = players.first(where: { $0.ref.id == id }) {
                    used.insert(id)
                    starters.append(p)
                }
            }
            let bench = players.filter { !used.contains($0.ref.id) && $0.injury != "Out" }
                .sorted { (Double($0.stats["MIN"] ?? "") ?? -1, -number($0)) > (Double($1.stats["MIN"] ?? "") ?? -1, -number($1)) }
            return [Profile.RosterGroup(kind: .starters, players: starters), Profile.RosterGroup(kind: .bench, players: bench),
                    Profile.RosterGroup(kind: .out, players: out)].filter { !$0.players.isEmpty }
        case .football:
            let order = ["QB", "RB", "FB", "WR", "TE", "OT", "OL", "G", "C", "DE", "DL", "DT", "NT", "LB", "OLB", "ILB",
                         "CB", "DB", "S", "PK", "K", "P", "LS"]
            // Within a position: depth-chart rank (starters first), then jersey.
            var rank: [String: Int] = [:]
            for ids in depth.values { for (i, id) in ids.enumerated() { rank[id] = min(rank[id] ?? i, i) } }
            func sorted(_ list: [Profile.RosterPlayer]) -> [Profile.RosterPlayer] {
                list.sorted {
                    let a = order.firstIndex(of: $0.position ?? "") ?? 99, b = order.firstIndex(of: $1.position ?? "") ?? 99
                    if a != b { return a < b }
                    let ra = rank[$0.ref.id] ?? 50, rb = rank[$1.ref.id] ?? 50
                    return ra != rb ? ra < rb : number($0) < number($1)
                }
            }
            let map: [(String, Profile.RosterGroup.Kind)] = [("offense", .offense), ("defense", .defense),
                ("specialTeam", .specialTeams), ("injuredReserveOrOut", .injuredReserve), ("practiceSquad", .practiceSquad)]
            return map.map { group, kind in
                Profile.RosterGroup(kind: kind, players: sorted(players.filter { $0.sourceGroup == group }))
            }.filter { !$0.players.isEmpty }
        case .baseball:
            let rotationIDs = depth["p"] ?? []
            let closer = depth["cl"] ?? []
            let pitchers = players.filter { $0.sourceGroup == "Pitchers" || ["SP", "RP", "P"].contains($0.position ?? "") }
            let rotation = pitchers.filter { $0.position == "SP" }
                .sorted { (rotationIDs.firstIndex(of: $0.ref.id) ?? 99) < (rotationIDs.firstIndex(of: $1.ref.id) ?? 99) }
            let bullpen = pitchers.filter { $0.position != "SP" }
                .sorted { (closer.contains($0.ref.id) ? 0 : 1, number($0)) < (closer.contains($1.ref.id) ? 0 : 1, number($1)) }
            let pitcherIDs = Set(pitchers.map(\.ref.id))
            let rest = players.filter { !pitcherIDs.contains($0.ref.id) }
            func group(_ name: String, _ kind: Profile.RosterGroup.Kind) -> Profile.RosterGroup {
                Profile.RosterGroup(kind: kind, players: rest.filter { $0.sourceGroup == name }.sorted { number($0) < number($1) })
            }
            return [Profile.RosterGroup(kind: .rotation, players: rotation), Profile.RosterGroup(kind: .bullpen, players: bullpen),
                    group("Catchers", .catchers), group("Infielders", .infielders), group("Outfielders", .outfielders),
                    group("Designated Hitter", .designatedHitters)].filter { !$0.players.isEmpty }
        case .soccer:
            func apps(_ p: Profile.RosterPlayer) -> Int { Int(p.stats["appearances"] ?? "") ?? -1 }
            let kinds: [(String, Profile.RosterGroup.Kind)] = [("G", .goalkeepers), ("D", .defenders), ("M", .midfielders),
                                                               ("F", .forwards)]
            return kinds.map { code, kind in
                Profile.RosterGroup(kind: kind, players: players.filter { $0.position == code }
                    .sorted { (apps($0), -number($0)) > (apps($1), -number($1)) })
            }.filter { !$0.players.isEmpty }
        default:
            return [Profile.RosterGroup(kind: .players, players: players)]
        }
    }

    /// The team's leaders by category, named from the roster.
    static func teamLeaders(sport: Sport, leaders: [String: [(id: String, value: String)]],
                            roster: [Profile.RosterPlayer]) -> [Profile.TeamLeader] {
        let picks: [(String, String)] = switch sport {
        case .basketball: [("pointsPerGame", "PTS"), ("reboundsPerGame", "REB"), ("assistsPerGame", "AST"), ("blocksPerGame", "BLK")]
        case .football: [("passingYards", "PASS YDS"), ("rushingYards", "RUSH YDS"), ("receivingYards", "REC YDS"),
                         ("totalTackles", "TACKLES")]
        case .baseball: [("avg", "AVG"), ("homeRuns", "HR"), ("ERA", "ERA"), ("strikeouts", "K")]
        case .soccer: [("goals", "GOALS"), ("assists", "ASSISTS")]
        default: []
        }
        let byID = Dictionary(roster.map { ($0.ref.id, $0) }, uniquingKeysWith: { a, _ in a })
        return picks.compactMap { category, label in
            guard let top = leaders[category]?.first, let player = byID[top.id] else { return nil }
            return Profile.TeamLeader(category: category, label: label, value: top.value, player: player.ref)
        }
    }

    // MARK: Player

    struct AthleteData: Sendable {
        var bio: Profile.Bio
        var tiles: [Profile.StatTile]
        var tilesCaption: String?
        var injury: Profile.InjuryNote?
    }

    /// The v3 athlete: bio display strings, the team, injuries and the ranked season summary.
    static func athlete(_ data: Data, path: String) -> AthleteData? {
        let a = JSON(data: data)["athlete"]
        guard let name = a["displayName"].string, let id = a["id"].string else { return nil }
        let t = a["team"]
        let sport = Profile.PlayerRef(source: .espn(path: path), id: id, name: name).sport
        let team = t["id"].string.map {
            Profile.TeamRef(id: ESPNTeamID.make(path: path, sport: sport, team: $0),
                            name: t["shortDisplayName"].string ?? t["displayName"].string ?? "",
                            logo: ProfileParse.url(t["logos"][0]["href"].string), league: league(for: path),
                            color: t["color"].string, alternateColor: t["alternateColor"].string,
                            abbreviation: t["abbreviation"].string)
        }
        var bio = Profile.Bio(name: name)
        bio.jersey = a["jersey"].string
        bio.position = a["position"]["displayName"].string
        bio.positionAbbreviation = a["position"]["abbreviation"].string
        bio.team = team
        bio.photo = a["headshot"]["href"].string != nil || sport != .soccer ? PhotoURL.espn(path: path, id: id, size: .hero) : nil
        bio.active = a["active"].bool ?? true
        bio.age = a["age"].int
        bio.birthPlace = a["displayBirthPlace"].string
        bio.height = a["displayHeight"].string
        bio.weight = a["displayWeight"].string
        bio.college = a["college"]["name"].string
        bio.draft = draft(a["displayDraft"].string)
        bio.experience = a["displayExperience"].string
        bio.batsThrows = a["displayBatsThrows"].string
        bio.debutYear = a["debutYear"].int
        bio.nationality = a["citizenship"].string
        bio.link = a["links"].array.first { $0["rel"].array.contains { $0.string == "playercard" } }
            .flatMap { ProfileParse.url($0["href"].string) }
        let tiles = a["statsSummary"]["statistics"].array.compactMap { s -> Profile.StatTile? in
            guard let value = s["displayValue"].string else { return nil }
            let label = s["abbreviation"].string ?? s["shortDisplayName"].string ?? ""
            // Soccer's "7 (2)": 7 starts, the 2 off the bench said in words below.
            if label == "START (SUB)" {
                let numbers = value.split { !$0.isNumber }.compactMap { Int($0) }
                let subs = numbers.count == 2 && numbers[1] > 0 ? "+\(numbers[1]) off the bench" : nil
                return Profile.StatTile(label: "STARTS", value: numbers.first.map(String.init) ?? value, rank: subs)
            }
            return Profile.StatTile(label: label, value: value, rank: Profile.rank(s["rankDisplayValue"].string)?.text)
        }
        let i = a["injuries"][0]
        var injury: Profile.InjuryNote?
        if let status = i["status"].string, status.lowercased() != "active" {
            let d = i["details"]
            let detail = [d["side"].string.flatMap { ["Not Specified", ""].contains($0) ? nil : $0 },
                          d["type"].string].compactMap { $0 }.joined(separator: " ")
            injury = Profile.InjuryNote(status: status, detail: detail.isEmpty ? nil : detail.capitalizedFirst,
                                        returnDate: ProfileParse.date(d["returnDate"].string))
        }
        return AthleteData(bio: bio, tiles: tiles, tilesCaption: a["statsSummary"]["displayName"].string, injury: injury)
    }

    /// "2003: Rd 1, Pk 1 (CLE)" → "2003 · Round 1, Pick 1 · CLE".
    static func draft(_ s: String?) -> String? {
        guard let s, let colon = s.firstIndex(of: ":") else { return s }
        let year = s[..<colon]
        let rest = s[s.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        var team: String?
        var pick = rest
        if let open = rest.firstIndex(of: "("), let close = rest.firstIndex(of: ")") {
            team = String(rest[rest.index(after: open)..<close])
            pick = rest[..<open].trimmingCharacters(in: .whitespaces)
        }
        pick = pick.replacingOccurrences(of: "Rd ", with: "Round ").replacingOccurrences(of: "Pk ", with: "Pick ")
        return ([String(year), pick] + [team].compactMap { $0 }).joined(separator: " · ")
    }

    /// The core athlete: ISO birth date (the v3 `displayDOB` is day-first) and the cheap bio college uses.
    static func coreAthlete(_ data: Data, into bio: inout Profile.Bio) {
        let a = JSON(data: data)
        if let date = ProfileParse.date(a["dateOfBirth"].string) { bio.birthDate = date }
        if bio.birthPlace == nil {
            let b = a["birthPlace"]
            bio.birthPlace = [b["city"].string, b["state"].string ?? b["country"].string].compactMap { $0 }
                .joined(separator: ", ").nilIfEmpty
        }
        bio.age = bio.age ?? a["age"].int
        bio.height = bio.height ?? a["displayHeight"].string
        bio.weight = bio.weight ?? a["displayWeight"].string
        if bio.jersey == nil { bio.jersey = a["jersey"].string }
        if bio.position == nil { bio.position = a["position"]["displayName"].string }
        if bio.positionAbbreviation == nil { bio.positionAbbreviation = a["position"]["abbreviation"].string }
        if bio.classYear == nil, let years = a["experience"]["displayValue"].string { bio.classYear = years }
        if bio.draft == nil, let year = a["draft"]["year"].int, let round = a["draft"]["round"].int,
           let pick = a["draft"]["selection"].int {
            bio.draft = "\(year) · Round \(round), Pick \(pick)"
        }
    }

    struct OverviewData: Sendable {
        var season: Profile.StatTable?
        var competitions: Profile.StatTable?
        var note: Profile.Note?
        var awards: [String] = []
    }

    static func overview(_ data: Data, sport: Sport) -> OverviewData {
        let o = JSON(data: data)
        let st = o["statistics"]
        let labels = st["labels"].array.map { ProfileParse.label($0.string) }
        let names = st["names"].array.compactMap(\.string)
        var rows = st["splits"].array.compactMap { s -> Profile.StatTable.Row? in
            guard let title = s["displayName"].string, title != "Projected" else { return nil }
            return Profile.StatTable.Row(title: title, values: s["stats"].array.map { $0.string ?? "" })
        }
        var out = OverviewData()
        if sport == .soccer {
            // One row per competition, domestic league first, international last.
            func weight(_ title: String) -> Int {
                let t = title.lowercased()
                if t.contains("world cup") || t.contains("nations") || t.contains("international") || t.contains("qualif")
                    || t.contains("euro ") || t.contains("copa am") { return 4 }
                if t.contains("champions") || t.contains("europa") || t.contains("conference league") { return 1 }
                if t.contains("cup") || t.contains("shield") || t.contains("copa") || t.contains("pokal")
                    || t.contains("coupe") || t.contains("supercup") || t.contains("super cup") { return 2 }
                return 0
            }
            rows = rows.enumerated().sorted { (weight($0.element.title), $0.offset) < (weight($1.element.title), $1.offset) }
                .map(\.element)
                .map { Profile.StatTable.Row(title: competitionName($0.title), values: $0.values) }
            out.competitions = rows.isEmpty ? nil : Profile.StatTable(columns: labels, keys: names, rows: rows)
        } else if !rows.isEmpty {
            out.season = Profile.StatTable(columns: labels, keys: names, rows: rows)
        }
        let r = o["rotowire"]
        if let headline = r["headline"].string {
            out.note = Profile.Note(headline: headline, story: r["story"].string,
                                    published: ProfileParse.rotowireDate(r["published"].string))
        }
        out.awards = o["awards"].array.compactMap { a in
            guard let name = a["name"].string else { return nil }
            return [a["displayCount"].string?.replacingOccurrences(of: "x", with: "×"), name].compactMap { $0 }.joined(separator: " ")
        }
        return out
    }

    /// "2026-27 English Premier League" → "Premier League".
    static func competitionName(_ s: String) -> String {
        var t = s
        if let space = t.firstIndex(of: " "), t[..<space].allSatisfy({ $0.isNumber || $0 == "-" }) {
            t = String(t[t.index(after: space)...])
        }
        for prefix in ["English ", "Spanish ", "German ", "Italian ", "French ", "UEFA "] where t.hasPrefix(prefix) {
            t = String(t.dropFirst(prefix.count))
        }
        return t
    }

    /// The game log, joined with its events map, in date order, preseason excluded.
    static func gamelog(_ data: Data, path: String, position: String?, pitching: Bool = false) -> Profile.GameLog? {
        let sport = Profile.PlayerRef(source: .espn(path: path), id: "", name: "").sport
        let g = JSON(data: data)
        let names = g["names"].array.compactMap(\.string)
        let labels = g["labels"].array.map { ProfileParse.label($0.string) }
        guard !names.isEmpty else { return nil }
        let events = g["events"]
        var entries: [Profile.GameLog.Entry] = []
        for type in g["seasonTypes"].array {
            let typeName = type["displayName"].string ?? ""
            if typeName.localizedCaseInsensitiveContains("preseason") { continue }
            let postseason = typeName.localizedCaseInsensitiveContains("postseason")
            for category in type["categories"].array {
                for e in category["events"].array {
                    guard let id = e["eventId"].string else { continue }
                    let ev = events[id]
                    guard let date = ProfileParse.date(ev["gameDate"].string) else { continue }
                    var stats: [String: String] = [:]
                    for (i, value) in e["stats"].array.enumerated() where i < names.count {
                        if stats[names[i]] == nil, let v = value.string { stats[names[i]] = v }
                    }
                    let o = ev["opponent"]
                    let oppID = o["id"].string
                    let home = ev["homeTeamId"].string != nil && ev["homeTeamId"].string != oppID
                    let teamScore = home ? ev["homeTeamScore"].string : ev["awayTeamScore"].string
                    let oppScore = home ? ev["awayTeamScore"].string : ev["homeTeamScore"].string
                    let opponent = oppID.map {
                        Profile.TeamRef(id: ESPNTeamID.make(path: path, sport: sport, team: $0), name: o["displayName"].string ?? o["abbreviation"].string ?? "",
                                        logo: ProfileParse.url(o["logo"].string ?? o["logos"][0]["href"].string),
                                        abbreviation: o["abbreviation"].string)
                    }
                    entries.append(Profile.GameLog.Entry(
                        eventID: id, date: date, opponent: opponent, home: home, result: ev["gameResult"].string,
                        teamScore: teamScore, opponentScore: oppScore, stats: stats, postseason: postseason,
                        competition: ev["leagueShortName"].string ?? ev["leagueName"].string))
                }
            }
        }
        var seen = Set<String>()
        entries = entries.sorted { $0.date < $1.date }.filter { seen.insert($0.eventID).inserted }
        var columns: [Profile.GameLog.Column] = []
        var used = Set<String>()
        for (name, label) in zip(names, labels) where used.insert(name).inserted {
            columns.append(.init(key: name, label: label))
        }
        var log = Profile.GameLog(columns: columns, entries: entries, stripKey: nil, stripLabel: "")
        let pos = (position ?? "").uppercased()
        switch sport {
        case .basketball:
            (log.stripKey, log.stripLabel) = ("points", "Points")
        case .football:
            let preferred: [(String, String)] = switch pos {
            case "QB": [("passingYards", "Passing yards")]
            case "RB", "FB": [("rushingYards", "Rushing yards")]
            case "WR", "TE": [("receivingYards", "Receiving yards")]
            case "PK", "K": [("totalKickingPoints", "Points")]
            default: [("totalTackles", "Tackles")]
            }
            let fallback: [(String, String)] = [("passingYards", "Passing yards"), ("rushingYards", "Rushing yards"),
                                                ("receivingYards", "Receiving yards"), ("totalTackles", "Tackles")]
            if let pick = (preferred + fallback).first(where: { names.contains($0.0) }) { (log.stripKey, log.stripLabel) = pick }
        case .baseball:
            if pitching || names.contains("innings") {
                if pos == "SP" || entries.contains(where: { (Double($0.stats["innings"] ?? "") ?? 0) >= 4 }) {
                    (log.stripKey, log.stripLabel) = ("avgGameScore", "Game Score")
                    log.reference = 50
                    log.referenceLabel = "50 avg start"
                }
            } else {
                (log.stripKey, log.stripLabel) = ("hits", "Hits")
                log.markKey = "homeRuns"
            }
        case .soccer:
            log.matchStrip = true
            if names.contains("cleanSheet") {
                (log.stripKey, log.stripLabel) = ("cleanSheet", "Clean sheets")
            } else {
                (log.stripKey, log.stripLabel) = ("totalGoals", "Goals")
                log.markKey = "goalAssists"
            }
        default: break
        }
        log.season = g["filters"].array.first { $0["name"].string == "season" }?["value"].string
        log.category = g["filters"].array.first { $0["name"].string == "category" }?["value"].string
        return log
    }

    /// Career by season (US sports): the averages category.
    static func career(_ data: Data) -> Profile.StatTable? {
        let j = JSON(data: data)
        let c = j["categories"][0]
        let labels = c["labels"].array.map { ProfileParse.label($0.string) }
        let names = c["names"].array.compactMap(\.string)
        guard !labels.isEmpty else { return nil }
        var abbreviations: [String: String] = [:]
        if let teams = j["teams"].raw as? [String: Any] {
            for (_, value) in teams {
                let t = JSON(value)
                if let id = t["id"].string, let abbr = t["abbreviation"].string { abbreviations[id] = abbr }
            }
        }
        let rows = c["statistics"].array.reversed().compactMap { s -> Profile.StatTable.Row? in
            guard let season = s["season"]["displayName"].string else { return nil }
            let team = s["teamId"].string.flatMap { abbreviations[$0] }
            return Profile.StatTable.Row(title: [season, team].compactMap { $0 }.joined(separator: " · "),
                                         values: s["stats"].array.map { $0.string ?? "" })
        }
        return Profile.StatTable(columns: labels, keys: names, rows: rows)
    }

    /// The league slug for a player's ESPN path ("basketball/nba" → "nba").
    static func league(for path: String) -> String? {
        switch path {
        case "basketball/nba": "nba"
        case "football/nfl": "nfl"
        case "football/college-football": "college-football"
        case "baseball/mlb": "mlb"
        default: path.hasPrefix("soccer/") ? String(path.dropFirst(7)) : nil
        }
    }
}

// MARK: - bo3.gg (CS2)

enum BO3Profiles {
    static let base = "https://api.bo3.gg/api/v1"

    static func teamURL(slug: String) -> URL? { URL(string: "\(base)/teams/\(slug)?with=players.country") }
    static func teamLookupURL(id: Int) -> URL? { URL(string: "\(base)/teams?filter%5Bteams.id%5D%5Beq%5D=\(id)") }
    static func teamStatsURL(slug: String) -> URL? { URL(string: "\(base)/teams/\(slug)/general_stats") }
    static func upcomingURL(teamID: Int) -> URL? {
        var c = URLComponents(string: "\(base)/matches")!
        c.queryItems = [.init(name: "filter[matches.team_ids][overlap]", value: String(teamID)),
                        .init(name: "filter[matches.status][in]", value: "upcoming,current"),
                        .init(name: "filter[matches.tier][in]", value: CounterStrike.tier),
                        .init(name: "sort", value: "start_date"), .init(name: "page[limit]", value: "3"),
                        .init(name: "with", value: "teams,tournament")]
        return c.url
    }
    static func playerURL(slug: String) -> URL? { URL(string: "\(base)/players/\(slug)") }
    static func generalURL(slug: String) -> URL? { URL(string: "\(base)/players/\(slug)/general_stats") }
    static func matchesURL(slug: String) -> URL? { URL(string: "\(base)/players/\(slug)/matches_list_stats/general?limit=10") }
    static func mapsURL(slug: String) -> URL? { URL(string: "\(base)/players/\(slug)/map_stats") }
    static func rolesURL(slug: String) -> URL? { URL(string: "\(base)/players/\(slug)/player_roles") }
    static func accuracyURL(slug: String) -> URL? { URL(string: "\(base)/players/\(slug)/accuracy_stats") }

    static func slug(_ data: Data) -> String? { JSON(data: data)["results"][0]["slug"].string }

    struct TeamData: Sendable {
        var header: Profile.TeamHeader
        var players: [Profile.RosterPlayer]
        var titles: [Profile.Title]
    }

    static func team(_ data: Data, ref: Profile.TeamRef) -> TeamData? {
        let t = JSON(data: data)
        guard let name = t["name"].string else { return nil }
        var teamRef = ref
        teamRef.logo = teamRef.logo ?? ProfileParse.url(t["image_url"].string)
        var players: [Profile.RosterPlayer] = []
        for p in t["players"].array {
            guard let slug = p["slug"].string, let nickname = p["nickname"].string, let id = p["id"].int else { continue }
            let status = p["status"].int ?? 1
            let real = [p["first_name"].string, p["last_name"].string].compactMap { $0 }.joined(separator: " ")
            let country = p["country"]["code"].string
            var row = Profile.RosterPlayer(
                ref: Profile.PlayerRef(source: .counterStrike(slug: slug), id: String(id), name: nickname,
                                       photo: PhotoURL.bo3(ProfileParse.url(p["image_url"].string), size: .small),
                                       team: teamRef, country: country),
                jersey: nil, position: nil, positionName: nil,
                age: age(ProfileParse.date(p["birthday"].string)), birthDate: ProfileParse.date(p["birthday"].string),
                height: nil, weight: nil, detail: real.isEmpty ? nil : real, college: nil, injury: nil)
            row.isCoach = p["is_coach"].bool == true
            row.benched = status == 2
            if let rating = p["six_month_avg_rating"].double, rating > 0 { row.stats["RATING"] = String(format: "%.2f", rating) }
            players.append(row)
        }
        let coach = players.first(where: \.isCoach)?.ref.name
        let header = Profile.TeamHeader(
            name: name, shortName: name, abbreviation: t["acronym"].string, logo: ProfileParse.url(t["image_url"].string),
            color: nil, alternateColor: nil, record: nil, standing: nil, coach: coach, venue: nil, city: nil,
            rank: t["rank"].int, rankChange: t["rank_diff"].int, leagueSlug: nil,
            link: t["slug"].string.flatMap { URL(string: "https://bo3.gg/teams/\($0)") }, next: nil)
        // S-tier wins only, as everywhere else in CS2.
        let titles = t["achievements"].array.filter {
            $0["title"].string == "winner" && $0["tournament"]["tier"].string == CounterStrike.tier
        }.compactMap { a -> Profile.Title? in
            guard let name = a["tournament"]["name"].string else { return nil }
            return Profile.Title(name: name, date: ProfileParse.date(a["date"].string))
        }.sorted { ($0.date ?? .distantPast) > ($1.date ?? .distantPast) }
        return TeamData(header: header, players: players, titles: titles)
    }

    /// Team career totals as tiles: maps, matches, events, rounds won.
    static func teamCareer(_ data: Data) -> [Profile.StatTile] {
        let s = JSON(data: data)
        func pct(_ won: String, _ all: String) -> String? {
            guard let w = s[won].double, let a = s[all].double, a > 0 else { return nil }
            return "\(Int((w / a * 100).rounded()))%"
        }
        var tiles: [Profile.StatTile] = []
        if let v = pct("matches_won_count", "matches_count") { tiles.append(.init(label: "MATCHES", value: v, rank: "won")) }
        if let v = pct("games_won_count", "games_count") { tiles.append(.init(label: "MAPS", value: v, rank: "won")) }
        if let won = s["events_won_count"].int, let all = s["events_count"].int {
            tiles.append(.init(label: "EVENTS", value: "\(won)", rank: "won of \(all)"))
        }
        if let v = pct("rounds_won_count", "rounds_count") { tiles.append(.init(label: "ROUNDS", value: v, rank: "won")) }
        return tiles
    }

    static func nextMatch(_ data: Data, teamID: Int) -> Profile.GameRef? {
        guard let m = JSON(data: data)["results"].array.first, let id = m["id"].int,
              let date = ProfileParse.date(m["start_date"].string) else { return nil }
        let us = m["team1"]["id"].int == teamID ? m["team1"] : m["team2"]
        let them = m["team1"]["id"].int == teamID ? m["team2"] : m["team1"]
        let opponent = them["id"].int.map {
            Profile.TeamRef(id: "cs-\($0)", name: them["name"].string ?? "TBD", logo: ProfileParse.url(them["image_url"].string))
        }
        _ = us
        let live = m["status"].string == "current"
        return Profile.GameRef(id: "cs-\(id)", date: date, opponent: opponent, home: true,
                               network: m["bo_type"].int.map { "Best of \($0)" }, state: live ? .live : .scheduled,
                               teamScore: nil, opponentScore: nil, result: nil, competition: m["tournament"]["name"].string,
                               slug: m["slug"].string)
    }

    struct PlayerData: Sendable {
        var bio: Profile.Bio
        var rating: Double?
    }

    static func player(_ data: Data) -> PlayerData? {
        let p = JSON(data: data)
        guard let nickname = p["nickname"].string else { return nil }
        let t = p["team"]
        var bio = Profile.Bio(name: nickname)
        bio.realName = [p["first_name"].string, p["last_name"].string].compactMap { $0 }.joined(separator: " ").nilIfEmpty
        bio.photo = PhotoURL.bo3(ProfileParse.url(p["image_url"].string), size: .hero)
        bio.birthDate = ProfileParse.date(p["birthday"].string)
        bio.age = age(bio.birthDate)
        bio.nationality = p["country"]["name"].string
        bio.country = p["country"]["code"].string
        bio.since = ProfileParse.date(p["joined_team_at"].string)
        bio.prizeMoney = p["total_prize"].double
        bio.position = p["is_coach"].bool == true ? "Coach" : nil
        bio.team = t["id"].int.map {
            Profile.TeamRef(id: "cs-\($0)", name: t["name"].string ?? "", logo: ProfileParse.url(t["image_url"].string),
                            league: "cs2", abbreviation: t["acronym"].string)
        }
        bio.link = p["slug"].string.flatMap { URL(string: "https://bo3.gg/players/\($0)") }
        return PlayerData(bio: bio, rating: p["six_month_avg_rating"].double)
    }

    /// Career K/D and ADR (bo3 ignores date filters, so these are career figures).
    static func general(_ data: Data) -> (kd: Double?, adr: Double?, kills: Int?) {
        let s = JSON(data: data)
        let kills = s["kills_sum"].double, deaths = s["deaths_sum"].double
        let damage = s["damage_sum"].double, rounds = s["rounds_count"].double
        return (kills.flatMap { k in deaths.flatMap { $0 > 0 ? k / $0 : nil } },
                damage.flatMap { d in rounds.flatMap { $0 > 0 ? d / $0 : nil } }, s["kills_sum"].int)
    }

    /// Headshot share of kills, from hit groups.
    static func headshotShare(_ data: Data) -> Double? {
        let groups = JSON(data: data).array
        let kills = groups.compactMap { $0["kills_sum"].double }.reduce(0, +)
        guard kills > 0, let head = groups.first(where: { $0["hit_group"].string == "Head" })?["kills_sum"].double else { return nil }
        return head / kills
    }

    /// The last matches as a game log: rating, kills–deaths, ADR, HS%.
    static func matches(_ data: Data) -> Profile.GameLog? {
        let list = JSON(data: data).array
        let entries = list.compactMap { m -> Profile.GameLog.Entry? in
            guard let id = m["match_id"].int, let date = ProfileParse.date(m["match_start_date"].string) else { return nil }
            let s = m["stats"][0]
            let wins = m["game_wins"].array.compactMap(\.int)
            let won = wins.filter { $0 == 1 }.count, lost = wins.filter { $0 == 0 }.count
            // Maps arrive in `game_numbers` order, which isn't sorted.
            let numbers = m["game_numbers"].array.compactMap(\.int)
            let maps = m["for_game_map_name"].array.compactMap(\.string)
            let ordered = zip(numbers, maps).sorted { $0.0 < $1.0 }.map { CSDetail.mapName($0.1) }
            var stats: [String: String] = [:]
            if let r = s["player_rating"].double { stats["rating"] = String(format: "%.2f", r) }
            if let k = s["kills"].int, let d = s["death"].int { stats["kd"] = "\(k)–\(d)"; stats["kills"] = "\(k)" }
            if let dmg = s["damage"].double, let rounds = m["rounds_count"].double, rounds > 0 {
                stats["adr"] = String(format: "%.0f", dmg / rounds)
            }
            if let hs = s["headshots"].double, let k = s["kills"].double, k > 0 { stats["hs"] = "\(Int((hs / k * 100).rounded()))%" }
            stats["maps"] = ordered.joined(separator: ", ")
            let opponent = m["enemy_team_id"].int.map {
                Profile.TeamRef(id: "cs-\($0)", name: m["enemy_team_name"].string ?? "",
                                logo: ProfileParse.url(m["enemy_team_image_url"].string))
            }
            return Profile.GameLog.Entry(eventID: m["match_slug"].string ?? "cs-\(id)", date: date, opponent: opponent, home: true,
                                         result: won > lost ? "W" : won < lost ? "L" : "D", teamScore: "\(won)",
                                         opponentScore: "\(lost)", stats: stats, competition: m["tournament_slug"].string)
        }.sorted { $0.date < $1.date }
        guard !entries.isEmpty else { return nil }
        return Profile.GameLog(columns: [.init(key: "maps", label: "MAPS"), .init(key: "rating", label: "RATING"),
                                         .init(key: "kd", label: "K–D"), .init(key: "adr", label: "ADR"),
                                         .init(key: "hs", label: "HS%")],
                               entries: entries, stripKey: "rating", stripLabel: "Rating")
    }

    static func maps(_ data: Data) -> [Profile.MapStat] {
        JSON(data: data).array.compactMap { m -> Profile.MapStat? in
            guard let raw = m["map_name"].string, let count = m["maps_count"].int, count > 0,
                  let rating = m["avg_player_rating"].double else { return nil }
            return Profile.MapStat(name: CSDetail.mapName(raw), maps: count, rating: rating, adr: m["avg_damage"].double ?? 0)
        }.sorted { $0.rating > $1.rating }
    }

    /// The two roles a player fills most, by side: "AWPer", "Anchor (CT)".
    static func roles(_ data: Data) -> [String] {
        let names = ["awper": "AWPer", "anchor": "Anchor", "rotator": "Rotator", "play_maker": "Playmaker",
                     "entry_fragger": "Entry", "lurker": "Lurker", "trader": "Trader", "support": "Support"]
        let rows = JSON(data: data).array.compactMap { r -> (side: String?, role: String, count: Int)? in
            guard let role = r["role"].string, let count = r["count"].int, count > 0 else { return nil }
            return (r["team_side"].string, role, count)
        }
        var totals: [String: Int] = [:]
        for r in rows { totals[r.role, default: 0] += r.count }
        return totals.sorted { $0.value > $1.value }.prefix(2).map { names[$0.key] ?? $0.key.capitalized }
    }

    static func age(_ birth: Date?, now: Date = .now) -> Int? {
        birth.flatMap { Calendar(identifier: .gregorian).dateComponents([.year], from: $0, to: now).year }
    }
}

// MARK: - IFSC (climbing)

enum IFSCProfiles {
    static let base = "https://ifsc.results.info/api/v1"
    /// Required: without it the API answers 401. (`IFSC` in Providers is private, so this is its own copy.)
    static let headers = ["Referer": "https://ifsc.results.info/"]

    static func athleteURL(id: String) -> URL? { URL(string: "\(base)/athletes/\(id)") }

    struct AthleteData: Sendable {
        var bio: Profile.Bio
        var profile: Profile.PlayerProfile
    }

    static func athlete(_ data: Data, now: Date = .now) -> AthleteData? {
        let a = JSON(data: data)
        guard let first = a["firstname"].string, let last = a["lastname"].string else { return nil }
        var bio = Profile.Bio(name: "\(first) \(Profile.properCase(last))")
        bio.photo = ProfileParse.url(a["photo_url"].string)
        bio.birthDate = ProfileParse.date(a["birthday"].string)
        bio.age = a["age"].int
        bio.height = a["height"].int.map { "\($0) cm" }
        bio.armSpan = a["arm_span"].int
        bio.hometown = a["city"].string
        bio.country = a["country"].string
        bio.nationality = a["country"].string.map { TeamCatalog.countryName($0) }
        bio.federation = a["federation"]["name"].string
        bio.link = a["id"].int.flatMap { URL(string: "https://ifsc.results.info/athlete/\($0)") }
        var profile = Profile.PlayerProfile()
        func podiums(_ j: JSON) -> [Profile.Podium] {
            j.array.compactMap { p -> Profile.Podium? in
                guard let kind = p["discipline_kind"].string else { return nil }
                let pod = Profile.Podium(discipline: discipline(kind), gold: p["1"].int ?? 0, silver: p["2"].int ?? 0,
                                         bronze: p["3"].int ?? 0)
                return pod.total > 0 ? pod : nil
            }
        }
        profile.podiums = podiums(a["discipline_podiums"])
        profile.worldChampionships = podiums(a["world_championships_discipline_podiums"])
        let results = a["all_results"].array
        profile.resultCount = results.count
        profile.results = results.compactMap { r -> Profile.ClimbResult? in
            guard let season = r["season"].string, let event = r["event_name"].string else { return nil }
            return Profile.ClimbResult(season: season, rank: r["rank"].int, discipline: discipline(r["discipline"].string ?? ""),
                                       event: shortEvent(event), date: ProfileParse.date(r["date"].string),
                                       category: r["category_name"].string)
        }
        // This season's World Cup ranks (never follow their result URLs: stale category IDs).
        let latest = a["cup_rankings"].array.last
        let season = latest?["season"].string
        let currentYear = Calendar(identifier: .gregorian).component(.year, from: now)
        if let latest, let season, Int(season) ?? 0 >= currentYear - 1 {
            for kind in ["lead", "boulder", "speed", "combined", "boulder&lead"] {
                if let rank = latest[kind]["rank"].int {
                    profile.tiles.append(.init(label: discipline(kind).uppercased(), value: Ordinal.string(rank),
                                               rank: "World Cup \(season)"))
                }
            }
        }
        let pb = a["speed_personal_best"]
        if let time = pb["time"].string {
            profile.speedBest = [time + " s", pb["event_name"].string.map(shortEvent), pb["round_name"].string]
                .compactMap { $0 }.joined(separator: " · ")
            profile.tiles.append(.init(label: "SPEED PB", value: time, rank: nil))
        }
        return AthleteData(bio: bio, profile: profile)
    }

    static func discipline(_ kind: String) -> String {
        switch kind {
        case "boulder&lead": "Boulder & Lead"
        case "speed_relay": "Speed Relay"
        default: kind.capitalized
        }
    }

    /// "World Climbing Series Santiago 2026" → "Santiago 2026"; "IFSC Climbing World Championships Seoul 2025"
    /// → "Worlds Seoul 2025"; "Europe - Continental Championships Munich 2022" → "Europeans Munich 2022".
    static func shortEvent(_ name: String) -> String {
        var t = name.trimmingCharacters(in: .whitespaces)
        while t.hasPrefix("-") { t = String(t.dropFirst()).trimmingCharacters(in: .whitespaces) }
        let renames = [("IFSC Climbing World Championships ", "Worlds "), ("Climbing World Championships ", "Worlds "),
                       ("World Climbing Championships ", "Worlds "), ("World Climbing Championship ", "Worlds "),
                       ("IFSC World Championships ", "Worlds "), ("Europe - Continental Championships ", "Europeans "),
                       ("IFSC European Championships ", "Europeans ")]
        for (from, to) in renames where t.hasPrefix(from) { t = to + t.dropFirst(from.count) }
        for prefix in ["IFSC Climbing World Cup ", "IFSC World Cup ", "World Climbing Series ", "Climbing World Cup (L) - ",
                       "Climbing World Cup (B) - ", "Climbing World Cup (S) - ", "Climbing World Cup ", "IFSC "] where t.hasPrefix(prefix) {
            t = String(t.dropFirst(prefix.count))
        }
        // "Kranj (SLO) 2021" → "Kranj 2021".
        if let open = t.range(of: " ("), let close = t.range(of: ")", range: open.upperBound..<t.endIndex),
           t[open.upperBound..<close.lowerBound].count == 3 {
            t.removeSubrange(open.lowerBound..<close.upperBound)
        }
        return t
    }
}

// MARK: - Small helpers

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
    // `capitalizedFirst` lives with the schedules (ClimbingSeasonPage.swift).
}
