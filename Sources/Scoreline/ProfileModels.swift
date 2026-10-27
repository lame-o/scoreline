import Foundation

// Team and player pages: what a link carries (a reference that's enough to
// paint the hero before anything loads) and what the pages load. Everything
// lives under `Profile` so these names never collide with other features'
// (Schedules has its own `TeamRef`).

enum Profile {}

// MARK: - References

extension Profile {
    /// A team as a link knows it. `id` uses the `Competitor.id` format
    /// (`espn-basketball-13`, `espn-ncaaf-130`, `espn-soccer-359`, `cs-667`),
    /// so follows and highlights match it directly.
    struct TeamRef: Hashable, Sendable {
        let id: String
        var name: String
        var logo: URL? = nil
        /// `League.id` when known ("eng.1", "nfl"). Soccer pages need it for
        /// the roster; without it they ask ESPN for the team's league.
        var league: String? = nil
        var color: String? = nil
        var alternateColor: String? = nil
        var abbreviation: String? = nil

        static func == (a: Self, b: Self) -> Bool { a.id == b.id }
        func hash(into hasher: inout Hasher) { hasher.combine(id) }

        init(id: String, name: String, logo: URL? = nil, league: String? = nil, color: String? = nil,
             alternateColor: String? = nil, abbreviation: String? = nil) {
            self.id = id
            self.name = name
            self.logo = logo
            self.league = league
            self.color = color
            self.alternateColor = alternateColor
            self.abbreviation = abbreviation
        }

        /// A team from a match row or hero.
        init(_ competitor: Competitor, league: String?) {
            self.init(id: competitor.id ?? competitor.name, name: competitor.name, logo: competitor.logo, league: league,
                      color: competitor.color, alternateColor: competitor.alternateColor,
                      abbreviation: competitor.abbreviation)
        }

        /// Where the team's data lives.
        enum Source: Equatable, Sendable {
            /// `path` is the ESPN sport/league ("basketball/nba"); nil for a
            /// soccer team whose domestic league isn't known yet.
            case espn(sport: Sport, path: String?, team: String)
            case counterStrike(id: Int)
        }

        var source: Source? {
            if id.hasPrefix("cs-"), let n = Int(id.dropFirst(3)) { return .counterStrike(id: n) }
            guard id.hasPrefix("espn-"), let team = id.split(separator: "-").last.map(String.init) else { return nil }
            if id.hasPrefix("espn-ncaaf-") { return .espn(sport: .football, path: "football/college-football", team: team) }
            if id.hasPrefix("espn-football-") { return .espn(sport: .football, path: "football/nfl", team: team) }
            if id.hasPrefix("espn-baseball-") { return .espn(sport: .baseball, path: "baseball/mlb", team: team) }
            if id.hasPrefix("espn-basketball-") {
                // The WNBA stays untouched: its teams get no pages.
                return league == "wnba" ? nil : .espn(sport: .basketball, path: "basketball/nba", team: team)
            }
            if id.hasPrefix("espn-soccer-") {
                return .espn(sport: .soccer, path: Self.domesticSoccerPath(league), team: team)
            }
            return nil
        }

        /// Whether a link should appear for this team at all.
        var isSupported: Bool { source != nil }

        var sport: Sport? {
            switch source {
            case let .espn(sport, _, _)?: sport
            case .counterStrike?: .esports
            case nil: nil
            }
        }

        /// The page's name in the scroll memory.
        var memoryKey: String { "team:\(id)" }

        /// Soccer rosters exist per domestic league only (`soccer/all/…/roster` is a 400).
        static let domesticSoccerLeagues: Set<String> = ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1", "eng.2", "usa.1"]

        static func domesticSoccerPath(_ league: String?) -> String? {
            guard let league, domesticSoccerLeagues.contains(league) else { return nil }
            return "soccer/\(league)"
        }
    }

    /// A person as a link knows them: a player, a CS2 player or a climber.
    struct PlayerRef: Hashable, Sendable {
        enum Source: Hashable, Sendable {
            /// ESPN sport/league path: "basketball/nba", "football/college-football", "soccer/eng.1".
            case espn(path: String)
            /// bo3.gg only accepts slugs ("zywoo"), never numeric IDs.
            case counterStrike(slug: String)
            case ifsc
        }

        let source: Source
        /// ESPN athlete ID, bo3 player ID, IFSC athlete ID.
        let id: String
        var name: String
        var photo: URL? = nil
        /// The current team, for the wash and the hero's team link.
        var team: TeamRef? = nil
        var jersey: String? = nil
        var position: String? = nil
        /// IOC (climbing) or ISO 3166 alpha-2 (CS2) country code.
        var country: String? = nil

        static func == (a: Self, b: Self) -> Bool { a.source == b.source && a.id == b.id }
        func hash(into hasher: inout Hasher) {
            hasher.combine(source)
            hasher.combine(id)
        }

        init(source: Source, id: String, name: String, photo: URL? = nil, team: TeamRef? = nil, jersey: String? = nil,
             position: String? = nil, country: String? = nil) {
            self.source = source
            self.id = id
            self.name = name
            self.photo = photo
            self.team = team
            self.jersey = jersey
            self.position = position
            self.country = country
        }

        var key: String {
            switch source {
            case let .espn(path): "espn:\(path):\(id)"
            case let .counterStrike(slug): "bo3:\(slug)"
            case .ifsc: "ifsc:\(id)"
            }
        }

        var memoryKey: String { "player:\(key)" }

        var sport: Sport {
            switch source {
            case let .espn(path):
                path.hasPrefix("basketball") ? .basketball : path.hasPrefix("football") ? .football
                    : path.hasPrefix("baseball") ? .baseball : .soccer
            case .counterStrike: .esports
            case .ifsc: .climbing
            }
        }

        var isCollege: Bool { if case let .espn(path) = source { return path.hasSuffix("college-football") }; return false }
    }
}

// MARK: - Team data

extension Profile {
    struct TeamHeader: Equatable, Sendable {
        var name: String
        var shortName: String
        var abbreviation: String?
        var logo: URL?
        var color: String?
        var alternateColor: String?
        /// "5-1"; soccer "7-0-1" (wins–draws–losses).
        var record: String?
        /// "1st in AFC West". Nil when the source's is unreliable (MLB after the regular season).
        var standing: String?
        /// "Andy Reid". Nil for soccer, whose source lists past managers.
        var coach: String?
        var venue: String?
        var city: String?
        /// CS2 world rank and its change.
        var rank: Int?
        var rankChange: Int?
        /// Soccer: the domestic league ESPN files the team under ("eng.1").
        var leagueSlug: String?
        var link: URL?
        var next: GameRef?
    }

    /// A game as the team and player pages show it: date, opponent, result.
    struct GameRef: Equatable, Sendable, Identifiable {
        let id: String
        let date: Date
        var opponent: TeamRef?
        var home: Bool
        var network: String?
        var state: EventState
        var teamScore: String?
        var opponentScore: String?
        /// "W", "L", "D" once final.
        var result: String?
        var competition: String?
        /// CS2: the match slug (bo3.gg's match pages are addressed by it).
        var slug: String? = nil
    }

    struct RosterPlayer: Equatable, Sendable, Identifiable {
        var ref: PlayerRef
        var jersey: String?
        /// "G", "QB", "SP", "D".
        var position: String?
        var positionName: String?
        var age: Int?
        var birthDate: Date?
        var height: String?
        var weight: String?
        /// College class ("Sophomore"), hometown or nationality, by sport.
        var detail: String?
        var college: String?
        /// "Out", "Questionable", "Injured Reserve", "Day-To-Day".
        var injury: String?
        /// When they're expected back ("late Nov"), when the source says (FotMob, soccer).
        var injuryReturn: String? = nil
        /// Column key → display value (team leaders, or soccer's inline stats).
        var stats: [String: String] = [:]
        /// The source's group ("offense", "Pitchers"); grouping is decided later.
        var sourceGroup: String?
        /// CS2: the coach and benched players.
        var isCoach = false
        var benched = false
        var id: String { ref.key }
    }

    struct RosterGroup: Equatable, Sendable, Identifiable {
        enum Kind: String, Sendable {
            case starters, bench, out
            case offense, defense, specialTeams, injuredReserve, practiceSquad
            case rotation, bullpen, catchers, infielders, outfielders, designatedHitters
            case goalkeepers, defenders, midfielders, forwards
            case players, coach, benched
        }
        let kind: Kind
        var players: [RosterPlayer]
        var collapsedByDefault: Bool { kind == .practiceSquad || kind == .benched }
        var id: Kind { kind }

        var title: String {
            switch kind {
            case .starters: "Starting Five"
            case .bench: "Bench"
            case .out: "Out"
            case .offense: "Offense"
            case .defense: "Defense"
            case .specialTeams: "Special Teams"
            case .injuredReserve: "Injured Reserve"
            case .practiceSquad: "Practice Squad"
            case .rotation: "Rotation"
            case .bullpen: "Bullpen"
            case .catchers: "Catchers"
            case .infielders: "Infielders"
            case .outfielders: "Outfielders"
            case .designatedHitters: "Designated Hitters"
            case .goalkeepers: "Goalkeepers"
            case .defenders: "Defenders"
            case .midfielders: "Midfielders"
            case .forwards: "Forwards"
            case .players: "Active"
            case .coach: "Coach"
            case .benched: "Benched"
            }
        }
    }

    /// NFL: three units, each a list of slots in depth order.
    struct DepthChart: Equatable, Sendable {
        struct Unit: Equatable, Sendable, Identifiable {
            enum Kind: Int, Sendable, Comparable {
                case offense, defense, specialTeams
                static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }
            }
            let kind: Kind
            /// The formation ("3WR 1TE", "Base 4-3 D").
            let name: String
            var slots: [Slot]
            var id: Int { kind.rawValue }
        }
        struct Slot: Equatable, Sendable, Identifiable {
            let key: String
            /// "QB", "LT", "WR".
            let label: String
            var players: [(id: String, name: String)]
            var id: String { key }
            static func == (a: Self, b: Self) -> Bool {
                a.key == b.key && a.players.map(\.id) == b.players.map(\.id)
            }
        }
        var units: [Unit]
    }

    struct TeamLeader: Equatable, Sendable, Identifiable {
        let category: String
        /// "PTS", "PASS YDS".
        let label: String
        let value: String
        let player: PlayerRef
        var id: String { category }
    }

    struct TeamStat: Equatable, Sendable, Identifiable {
        let key: String
        let label: String
        let value: String
        let rank: Int?
        /// "1st", "T-3rd".
        let rankText: String?
        var id: String { key }
    }

    struct Transaction: Equatable, Sendable, Identifiable {
        let date: Date?
        let text: String
        var id: String { "\(date?.timeIntervalSince1970 ?? 0)|\(text)" }
    }

    struct Title: Equatable, Sendable, Identifiable {
        let name: String
        let date: Date?
        var id: String { name }
    }
}

// MARK: - Player data

extension Profile {
    struct Bio: Equatable, Sendable {
        var name: String
        var jersey: String?
        var position: String?
        var positionAbbreviation: String?
        var team: TeamRef?
        var photo: URL?
        var active = true
        var age: Int?
        var birthDate: Date?
        var birthPlace: String?
        var height: String?
        var weight: String?
        var college: String?
        /// "2003 · Round 1, Pick 1 · CLE".
        var draft: String?
        /// "24th Season".
        var experience: String?
        var batsThrows: String?
        var debutYear: Int?
        var nationality: String?
        /// College: "Sophomore".
        var classYear: String?
        var hometown: String?
        /// CS2: real name under the nickname.
        var realName: String?
        /// CS2: "With team since Oct 2018"; climbing: federation.
        var since: Date?
        var federation: String?
        var prizeMoney: Double?
        var armSpan: Int?
        var country: String?
        var link: URL?
    }

    struct StatTile: Equatable, Sendable, Identifiable {
        let label: String
        let value: String
        /// Shown only when meaningful (≤ 25th).
        var rank: String?
        var id: String { label }
    }

    struct InjuryNote: Equatable, Sendable {
        let status: String
        var detail: String?
        var returnDate: Date?
    }

    /// RotoWire's status note (US sports).
    struct Note: Equatable, Sendable {
        let headline: String
        var story: String?
        var published: Date?
    }

    /// A small table: the season, career or per-competition lines.
    struct StatTable: Equatable, Sendable {
        struct Row: Equatable, Sendable, Identifiable {
            let title: String
            let values: [String]
            var id: String { title }
        }
        var columns: [String]
        /// The source's stat names, parallel to `columns` ("avgPoints").
        var keys: [String] = []
        var rows: [Row]

        /// Indices of the preferred keys that exist, in that order.
        func indices(_ preferred: [String]) -> [Int] { preferred.compactMap { keys.firstIndex(of: $0) } }
    }

    struct GameLog: Equatable, Sendable {
        struct Column: Equatable, Sendable {
            let key: String
            let label: String
        }
        struct Entry: Equatable, Sendable, Identifiable {
            let eventID: String
            let date: Date
            var opponent: TeamRef?
            var home: Bool
            /// "W", "L", "D".
            var result: String?
            var teamScore: String?
            var opponentScore: String?
            var stats: [String: String]
            var postseason = false
            var competition: String?
            var played = true
            var id: String { eventID }

            func value(_ key: String) -> Double? {
                guard let raw = stats[key] else { return nil }
                return Double(raw.replacingOccurrences(of: ",", with: ""))
            }
        }
        var columns: [Column]
        /// Date order, preseason excluded.
        var entries: [Entry]
        /// The stat the strip draws ("points", "passingYards").
        var stripKey: String?
        var stripLabel: String
        /// MLB: the stat drawn as a ring on top of a bar (home runs).
        var markKey: String? = nil
        /// A fixed reference instead of the mean (Game Score: 50).
        var reference: Double? = nil
        var referenceLabel: String? = nil
        /// Soccer: a result strip instead of bars.
        var matchStrip = false
        var season: String?
        /// MLB: "batting" or "pitching". ESPN offers both to every player; a log
        /// asked for without one is in the player's role (pitching for a pitcher).
        var category: String?

        /// Any game with something in it. A hitter's pitching log is empty, but a
        /// pitcher's batting log lists every appearance, all zeros.
        var hasPlay: Bool { entries.contains { $0.stats.values.contains { (Double($0) ?? 0) > 0 } } }
    }

    struct MapStat: Equatable, Sendable, Identifiable {
        let name: String
        let maps: Int
        let rating: Double
        let adr: Double
        var id: String { name }
    }

    struct Podium: Equatable, Sendable, Identifiable {
        let discipline: String
        let gold: Int, silver: Int, bronze: Int
        var total: Int { gold + silver + bronze }
        var id: String { discipline }
    }

    struct ClimbResult: Equatable, Sendable, Identifiable {
        let season: String
        let rank: Int?
        let discipline: String
        let event: String
        let date: Date?
        let category: String?
        var id: String { "\(season)|\(event)|\(discipline)|\(category ?? "")" }
    }

    struct PlayerProfile: Equatable, Sendable {
        var bio: Bio?
        var tiles: [StatTile] = []
        var tilesCaption: String?
        var injury: InjuryNote?
        var note: Note?
        var season: StatTable?
        /// Soccer: one row per competition.
        var competitions: StatTable?
        var gameLog: GameLog?
        var awards: [String] = []
        var career: StatTable?
        /// MLB: the log in the player's other role (a hitter's pitching, a pitcher's
        /// batting), only when they have games in it this season (two-way players).
        var otherLog: GameLog?
        var otherLogChecked = false
        // CS2
        var mapPool: [MapStat] = []
        var roles: [String] = []
        var titles: [Title] = []
        // Climbing
        var podiums: [Podium] = []
        var worldChampionships: [Podium] = []
        var results: [ClimbResult] = []
        var resultCount = 0
        var speedBest: String?
    }
}

// MARK: - Display helpers

extension Profile {
    /// "Tied-13th" → "T-13th"; nil past 25th (a rank that far down isn't context).
    static func rank(_ text: String?, limit: Int = 25) -> (rank: Int, text: String)? {
        guard let text, !text.isEmpty else { return nil }
        let digits = text.filter(\.isNumber)
        guard let n = Int(digits), n >= 1, n <= limit else { return nil }
        return (n, text.replacingOccurrences(of: "Tied-", with: "T-"))
    }

    /// Initials for a monogram: first and last word ("LJ"); one-word names
    /// and nicknames give one letter. Suffixes (Jr., III) don't count.
    static func initials(_ name: String) -> String {
        let suffixes: Set<String> = ["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]
        let words = name.split(separator: " ")
            .map(String.init)
            .filter { !suffixes.contains($0.lowercased()) && !$0.isEmpty }
        guard let first = words.first?.first else { return "" }
        guard words.count > 1, let last = words.last?.first else { return String(first).uppercased() }
        return (String(first) + String(last)).uppercased()
    }

    /// "GARNBRET" → "Garnbret"; "TRI RAMADANI" → "Tri Ramadani".
    static func properCase(_ s: String) -> String {
        s.split(separator: " ").map { word in
            word.split(separator: "-").map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }.joined(separator: "-")
        }.joined(separator: " ")
    }
}
