import Foundation
import os

/// Structured logging: one subsystem, one category per concern. In
/// Console.app, filter on subsystem io.github.lame-o.Scoreline.
enum Log {
    static let subsystem = "io.github.lame-o.Scoreline"
    /// Requests that failed (status, host, path).
    static let network = Logger(subsystem: subsystem, category: "network")
    /// The refresh loop.
    static let poll = Logger(subsystem: subsystem, category: "poll")
    /// Responses that didn't decode.
    static let parse = Logger(subsystem: subsystem, category: "parse")
    /// The panel's lifecycle (`PanelLog`).
    static let panel = Logger(subsystem: subsystem, category: "panel")
}

/// Fetches events for a league from its upstream source.
/// All sources are public, keyless JSON endpoints; decoding is deliberately lenient
/// (everything optional) so a schema tweak upstream drops a field, not the whole feed.
enum Providers {
    static func events(for league: League, countries: [String] = []) async throws -> [Event] {
        switch league.source {
        case let .espn(path, weekly):
            try await ESPN.events(path: path, weekly: weekly, sport: league.sport)
        case .counterStrike:
            try await CounterStrike.events()
        case .ifsc:
            try await IFSC.events(countries: countries)
        }
    }
}

extension Providers {
    /// Events from an ESPN scoreboard response already in hand, through the
    /// same parser as a fetch (the tests and the tile gallery replay recorded boards).
    static func espnEvents(scoreboard data: Data, path: String, sport: Sport) throws -> [Event] {
        let board = try JSONDecoder().decode(ESPN.Board.self, from: data)
        return (board.events ?? []).compactMap { ESPN.makeEvent($0, sport: sport, path: path) }
    }
}

// MARK: - Networking

enum HTTP {
    /// Set before the first request to route traffic through a stub (the
    /// offline test suite replays recorded responses this way).
    nonisolated(unsafe) static var stubProtocol: AnyClass?

    static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        // Scores are always fetched fresh; don't hold old responses in memory.
        config.urlCache = nil
        config.httpAdditionalHeaders = ["Accept": "application/json", "User-Agent": "Scoreline/1.0 (macOS)"]
        if let stubProtocol { config.protocolClasses = [stubProtocol] }
        return URLSession(configuration: config)
    }()

    static func get<T: Decodable>(_ type: T.Type, _ url: URL, headers: [String: String] = [:]) async throws -> T {
        var request = URLRequest(url: url)
        headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        let (data, response) = try await session.data(for: request)
        try checked(response, from: url)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            Log.parse.error("Couldn't decode \(url.path(), privacy: .public): \(error.localizedDescription, privacy: .public)")
            throw error
        }
    }
}

extension HTTP {
    /// Throws (and logs the status, host and path) unless the response is a
    /// 2xx. Every fetch goes through this one check.
    static func checked(_ response: URLResponse, from url: URL) throws {
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            Log.network.error("HTTP \(status) from \(url.host() ?? "", privacy: .public)\(url.path(), privacy: .public)")
            throw URLError(.badServerResponse)
        }
    }
}

/// Immutable after parsing (`raw` is a `let` holding JSONSerialization's
/// Foundation objects, never mutated), so it can cross into task groups.
extension JSON: @unchecked Sendable {}

extension URL {
    /// A request URL from pieces that may come from server data: throws
    /// instead of crashing on malformed input, and resolves paths that turn
    /// out to be absolute.
    static func api(_ string: String, relativeTo base: String? = nil) throws -> URL {
        let resolved = base.flatMap(URL.init(string:)).flatMap { URL(string: string, relativeTo: $0)?.absoluteURL }
            ?? URL(string: string)
        guard let url = resolved else { throw URLError(.badURL) }
        return url
    }
}

enum DateParser {
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain = ISO8601DateFormatter()
    private static let patterns: [DateFormatter] = ["yyyy-MM-dd'T'HH:mmX", "yyyy-MM-dd HH:mm:ss 'UTC'"].map {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = $0
        return f
    }

    static func parse(_ string: String?) -> Date? {
        guard let string else { return nil }
        if let d = iso.date(from: string) ?? isoPlain.date(from: string) { return d }
        for f in patterns { if let d = f.date(from: string) { return d } }
        return nil
    }
}

// MARK: - ESPN (soccer, football, MLB, basketball)

private enum ESPN {
    struct Board: Decodable { let events: [E]? }
    struct Season: Decodable { let slug: String? }
    struct E: Decodable {
        let id: String
        let date: String?
        let season: Season?
        let status: Status?
        let competitions: [Competition]?
        let links: [Link]?
    }
    struct Status: Decodable { let type: StatusType?; let clock: Double?; let period: Int? }
    struct StatusType: Decodable {
        let state: String?
        let completed: Bool?
        let shortDetail: String?
        /// "STATUS_SUSPENDED", "STATUS_DELAYED", "STATUS_POSTPONED"…
        let name: String?
    }
    struct Competition: Decodable {
        let competitors: [Comp]?
        let notes: [Note]?
        let series: Series?
        let situation: Situation?
        /// Soccer: goals and cards so far (each entry decodes on its own).
        let details: [Detail]?
        let venue: Venue?
        let broadcasts: [Broadcast]?

        private enum Keys: String, CodingKey { case competitors, notes, series, situation, details, venue, broadcasts }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            competitors = try c.decodeIfPresent([Comp].self, forKey: .competitors)
            notes = try c.decodeIfPresent([Note].self, forKey: .notes)
            series = try c.decodeIfPresent(Series.self, forKey: .series)
            situation = try c.decodeIfPresent(Situation.self, forKey: .situation)
            // Added for tiles: a reshaped list costs the goal track, never the game.
            details = (try? c.decodeIfPresent([Detail].self, forKey: .details)) ?? nil
            // Extras for wide rows: a reshape drops just these.
            venue = (try? c.decodeIfPresent(Venue.self, forKey: .venue)) ?? nil
            broadcasts = (try? c.decodeIfPresent([Broadcast].self, forKey: .broadcasts)) ?? nil
        }
    }
    struct Venue: Decodable { let fullName: String? }
    struct Broadcast: Decodable { let market: String?; let names: [String]? }
    /// A soccer key event on the scoreboard ("Goal", "Red Card", "Own Goal").
    struct Detail: Decodable {
        struct DetailType: Decodable { let text: String? }
        struct Clock: Decodable { let value: Double?; let displayValue: String? }
        struct TeamRef: Decodable { let id: String? }
        struct Athlete: Decodable { let shortName: String?; let displayName: String? }
        let type: DetailType?
        let clock: Clock?
        let team: TeamRef?
        let scoringPlay: Bool?
        let ownGoal: Bool?
        let penaltyKick: Bool?
        let redCard: Bool?
        let athletesInvolved: [Athlete]?

        private enum Keys: String, CodingKey {
            case type, clock, team, scoringPlay, ownGoal, penaltyKick, redCard, athletesInvolved
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            type = (try? c.decodeIfPresent(DetailType.self, forKey: .type)) ?? nil
            clock = (try? c.decodeIfPresent(Clock.self, forKey: .clock)) ?? nil
            team = (try? c.decodeIfPresent(TeamRef.self, forKey: .team)) ?? nil
            scoringPlay = (try? c.decodeIfPresent(Bool.self, forKey: .scoringPlay)) ?? nil
            ownGoal = (try? c.decodeIfPresent(Bool.self, forKey: .ownGoal)) ?? nil
            penaltyKick = (try? c.decodeIfPresent(Bool.self, forKey: .penaltyKick)) ?? nil
            redCard = (try? c.decodeIfPresent(Bool.self, forKey: .redCard)) ?? nil
            athletesInvolved = (try? c.decodeIfPresent([Athlete].self, forKey: .athletesInvolved)) ?? nil
        }

        /// As a timeline mark, or nil for anything that isn't a goal or a red card.
        func mark(homeID: String?, awayID: String?, topIsHome: Bool) -> MatchMark? {
            let kind: MatchMark.Kind
            if redCard == true { kind = .redCard }
            else if scoringPlay == true { kind = ownGoal == true ? .ownGoal : penaltyKick == true ? .penalty : .goal }
            else { return nil }
            let display = clock?.displayValue ?? ""
            guard let minute = MatchMark.minute(from: display) ?? clock?.value.map({ $0 / 60 }) else { return nil }
            let isHome = team?.id != nil && team?.id == homeID
            let isAway = team?.id != nil && team?.id == awayID
            let side: GameDetail.Side? = isHome ? (topIsHome ? .top : .bottom) : isAway ? (topIsHome ? .bottom : .top) : nil
            // A goal or card for neither team can't be placed in a lane.
            guard side != nil || kind == .ownGoal else { return nil }
            return MatchMark(minute: minute, side: side, kind: kind,
                             player: athletesInvolved?.first.flatMap { $0.shortName ?? $0.displayName }, clock: display)
        }
    }
    /// The live situation. Each field decodes on its own, so one that changes
    /// shape drops just that detail, never the game.
    struct Situation: Decodable {
        let possession: String?
        let downDistanceText: String?
        let balls: Int?
        let strikes: Int?
        let outs: Int?
        let onFirst: Bool?
        let onSecond: Bool?
        let onThird: Bool?
        /// Football: ESPN's yard line (from the home goal line), down, distance, red zone.
        let yardLine: Double?
        let down: Int?
        let distance: Int?
        let isRedZone: Bool?
        /// Baseball: who's batting and pitching (short names), when ESPN says.
        let batter: String?
        let pitcher: String?
        /// The last play's type ("Field Goal Good"), for between snaps.
        let lastPlayType: String?
        /// NBA: the last play as ESPN tells it, its type number, and the players in it (full and short names).
        let lastPlayText: String?
        let lastPlayTypeID: String?
        let lastPlayScore: Int?
        let lastPlayNames: [(full: String, short: String)]

        private struct LastPlay: Decodable {
            struct PlayType: Decodable {
                let id: String?
                let text: String?
                private enum Keys: String, CodingKey { case id, text }
                // Each field on its own: an id that changes shape never costs the text.
                init(from decoder: Decoder) throws {
                    let c = try decoder.container(keyedBy: Keys.self)
                    id = (try? c.decodeIfPresent(String.self, forKey: .id)) ?? nil
                    text = (try? c.decodeIfPresent(String.self, forKey: .text)) ?? nil
                }
            }
            struct Athlete: Decodable { let fullName: String?; let displayName: String?; let shortName: String? }
            let type: PlayType?
            let text: String?
            let scoreValue: Int?
            let athletesInvolved: [Athlete]?
            private enum Keys: String, CodingKey { case type, text, scoreValue, athletesInvolved }
            // Each field on its own, like the situation itself.
            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: Keys.self)
                type = (try? c.decodeIfPresent(PlayType.self, forKey: .type)) ?? nil
                text = (try? c.decodeIfPresent(String.self, forKey: .text)) ?? nil
                scoreValue = (try? c.decodeIfPresent(Int.self, forKey: .scoreValue)) ?? nil
                athletesInvolved = (try? c.decodeIfPresent([Athlete].self, forKey: .athletesInvolved)) ?? nil
            }
        }

        private struct Participant: Decodable {
            struct Athlete: Decodable { let shortName: String?; let displayName: String? }
            let athlete: Athlete?
            var name: String? { athlete?.shortName ?? athlete?.displayName }
        }

        private enum Keys: String, CodingKey {
            case possession, downDistanceText, balls, strikes, outs, onFirst, onSecond, onThird, lastPlay
            case yardLine, down, distance, isRedZone, batter, pitcher
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            possession = (try? c.decodeIfPresent(String.self, forKey: .possession)) ?? nil
            downDistanceText = (try? c.decodeIfPresent(String.self, forKey: .downDistanceText)) ?? nil
            balls = (try? c.decodeIfPresent(Int.self, forKey: .balls)) ?? nil
            strikes = (try? c.decodeIfPresent(Int.self, forKey: .strikes)) ?? nil
            outs = (try? c.decodeIfPresent(Int.self, forKey: .outs)) ?? nil
            onFirst = (try? c.decodeIfPresent(Bool.self, forKey: .onFirst)) ?? nil
            onSecond = (try? c.decodeIfPresent(Bool.self, forKey: .onSecond)) ?? nil
            onThird = (try? c.decodeIfPresent(Bool.self, forKey: .onThird)) ?? nil
            yardLine = (try? c.decodeIfPresent(Double.self, forKey: .yardLine)) ?? nil
            down = (try? c.decodeIfPresent(Int.self, forKey: .down)) ?? nil
            distance = (try? c.decodeIfPresent(Int.self, forKey: .distance)) ?? nil
            isRedZone = (try? c.decodeIfPresent(Bool.self, forKey: .isRedZone)) ?? nil
            batter = ((try? c.decodeIfPresent(Participant.self, forKey: .batter)) ?? nil)?.name
            pitcher = ((try? c.decodeIfPresent(Participant.self, forKey: .pitcher)) ?? nil)?.name
            let lastPlay = (try? c.decodeIfPresent(LastPlay.self, forKey: .lastPlay)) ?? nil
            lastPlayType = lastPlay?.type?.text
            lastPlayText = lastPlay?.text
            lastPlayTypeID = lastPlay?.type?.id
            lastPlayScore = lastPlay?.scoreValue
            lastPlayNames = (lastPlay?.athletesInvolved ?? []).compactMap { a in
                guard let full = a.fullName ?? a.displayName, let short = a.shortName else { return nil }
                return (full, short)
            }
        }

        /// Between snaps there's no down: say what just happened instead, so
        /// the line (and the row's height) holds steady.
        private static let betweenSnaps: [String: String] = [
            "Field Goal Good": "Field goal", "Field Goal Missed": "Field goal missed", "Kickoff": "Kickoff",
            "Extra Point Good": "Extra point", "Official Timeout": "Timeout", "Timeout": "Timeout",
            "Two-minute warning": "Two-minute warning", "Punt": "Punt", "Safety": "Safety",
        ]
        /// Breaks the status already says ("Halftime", "End of 3rd"): no line,
        /// rather than the same words twice.
        private static let breaks: Set<String> = ["End Period", "End of Half"]

        /// NBA plays that say little on their own (rebounds, timeouts,
        /// substitutions, reviews, period ends): the row keeps the line before.
        var routine: Bool { !NBADetail.isNotable(type: lastPlayTypeID.flatMap { Int($0) }, scoreValue: lastPlayScore) }

        /// The situation in a line, for the list row.
        func line(sport: Sport, path: String = "") -> String? {
            switch sport {
            case .basketball:
                // NBA only: the last play, shortened ("L. Doncic makes 26-ft three point jumper").
                guard path == NBADetail.path, let text = lastPlayText, !text.isEmpty else { return nil }
                return NBADetail.listLine(text, names: lastPlayNames)
            case .football:
                if let text = downDistanceText, !text.isEmpty { return text }
                guard let type = lastPlayType, !type.isEmpty, !Self.breaks.contains(type) else { return nil }
                return Self.betweenSnaps[type] ?? (type.localizedCaseInsensitiveContains("touchdown") ? "Touchdown" : type)
            case .baseball:
                guard let outs else { return nil }
                var parts = [outs == 1 ? "1 out" : "\(outs) outs"]
                if let balls, let strikes { parts.append("\(balls)–\(strikes)") }
                let bases = [(onFirst, "1st"), (onSecond, "2nd"), (onThird, "3rd")].filter { $0.0 == true }.map(\.1)
                switch bases.count {
                case 3: parts.append("Bases loaded")
                case 2: parts.append("Runners on \(bases[0]) & \(bases[1])")
                case 1: parts.append("Runner on \(bases[0])")
                default: break
                }
                return parts.joined(separator: " · ")
            default:
                return nil
            }
        }
    }
    struct Note: Decodable { let headline: String? }
    struct Series: Decodable { let summary: String? }
    struct Comp: Decodable {
        let homeAway: String?
        let score: String?
        let winner: Bool?
        let team: Team?
        let curatedRank: Rank?
        let records: [Record]?
    }
    struct Rank: Decodable { let current: Int? }
    struct Record: Decodable { let type: String?; let summary: String? }
    struct Team: Decodable {
        let id: String?
        let abbreviation: String?
        let shortDisplayName: String?
        let displayName: String?
        let logo: String?
        let color: String?
        let alternateColor: String?
    }
    struct Link: Decodable { let href: String?; let rel: [String]? }

    static let dayFormat: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyyMMdd"
        return f
    }()

    static func events(path: String, weekly: Bool, sport: Sport) async throws -> [Event] {
        let base = "https://site.api.espn.com/apis/site/v2/sports/\(path)/scoreboard"
        // ESPN rejects date ranges intermittently, so daily leagues are fetched one day at a time.
        let urls: [URL]
        if weekly {
            // College: every FBS game (the default board is just the Top 25,
            // which would hide an unranked team you follow).
            urls = [try URL.api(path.hasSuffix("college-football") ? "\(base)?groups=80" : base)]
        } else {
            let today = Date()
            // Yesterday through tomorrow, plus the undated board: ESPN fills it
            // with the current or next matchday, so the next fixture is known
            // even midweek.
            urls = try [try URL.api(base)] + [-1, 0, 1].map { offset in
                let day = Calendar.current.date(byAdding: .day, value: offset, to: today) ?? today
                return try URL.api("\(base)?dates=\(dayFormat.string(from: day))")
            }
        }

        let boards = try await withThrowingTaskGroup(of: Board?.self) { group in
            for url in urls {
                // A single failing day shouldn't blank the league.
                group.addTask { try? await HTTP.get(Board.self, url) }
            }
            return try await group.reduce(into: [Board]()) { if let b = $1 { $0.append(b) } }
        }
        if boards.isEmpty { throw URLError(.cannotLoadFromNetwork) }

        var seen = Set<String>()
        return boards.flatMap { $0.events ?? [] }.compactMap { e in
            guard seen.insert(e.id).inserted else { return nil }
            return makeEvent(e, sport: sport, path: path)
        }
    }

    static func makeEvent(_ e: E, sport: Sport, path: String) -> Event? {
        guard let start = DateParser.parse(e.date),
              let comps = e.competitions?.first?.competitors,
              let home = comps.first(where: { $0.homeAway == "home" }),
              let away = comps.first(where: { $0.homeAway == "away" })
        else { return nil }

        let state: EventState = switch e.status?.type?.state {
        case "in": .live
        case "post": .final
        default: .scheduled
        }

        // Postponed and cancelled games come back "post" but not completed, with
        // 0–0 placeholder scores: show them without a score. A suspended game
        // is "post" and not completed too, but its score is real: it resumes
        // from there.
        let status = e.status?.type
        let played = state != .final || status?.completed != false || status?.name == "STATUS_SUSPENDED"

        // The winner follows the score on the pitch: ESPN's `winner` follows a
        // two-legged tie or a friendly's bonus shootout (specs/results.md §1.1).
        func won(_ c: Comp) -> Bool {
            guard state == .final, status?.completed != false, let h = home.score.flatMap({ Int($0) }),
                  let a = away.score.flatMap({ Int($0) }), h != a
            else { return c.winner ?? false }
            return c.homeAway == "home" ? h > a : a > h
        }

        func competitor(_ c: Comp) -> Competitor {
            let name = c.team?.shortDisplayName ?? c.team?.displayName ?? "TBD"
            return Competitor(
                id: c.team?.id.map { ESPNTeamID.make(path: path, sport: sport, team: $0) },
                name: name,
                abbreviation: c.team?.abbreviation ?? String(name.prefix(3)).uppercased(),
                score: state == .scheduled || !played ? nil : c.score,
                logo: c.team?.logo.flatMap(URL.init(string:)),
                isWinner: won(c),
                color: c.team?.color,
                // ESPN uses 99 for unranked.
                rank: c.curatedRank?.current.flatMap { (1...25).contains($0) ? $0 : nil },
                // One dash style everywhere: "7–1", as team pages and schedules show it.
                record: c.records?.first { $0.type == "total" }?.summary?.replacingOccurrences(of: "-", with: "–"),
                conferenceRecord: c.records?.first { $0.type == "vsconf" }?.summary?.replacingOccurrences(of: "-", with: "–"),
                alternateColor: c.team?.alternateColor
            )
        }

        // Soccer lists the home side first; North American sports list away first.
        let content: Event.Content = sport == .soccer
            ? .match(top: competitor(home), bottom: competitor(away))
            : .match(top: competitor(away), bottom: competitor(home))

        let link = e.links?.first(where: { $0.rel?.contains("summary") ?? false })?.href ?? e.links?.first?.href

        let snapshot = state == .live
            ? liveSnapshot(e.competitions?.first, sport: sport, home: home, away: away, content: content) : nil

        // Sports whose clock means something to read: soccer counts up, the
        // rest count down. Baseball has innings, not a clock.
        var clock: GameClock?
        if state == .live, let seconds = e.status?.clock, let period = e.status?.period,
           let display = e.status?.type?.shortDetail, [.soccer, .football, .basketball].contains(sport) {
            clock = GameClock(seconds: seconds, sampledAt: .now, period: period,
                              direction: sport == .soccer ? .up : .down, display: display,
                              running: sport == .soccer && display.contains("'"))
        }

        // Postseason games say where they are: "World Series · Game 2 · MIL leads 2–0";
        // college games carry their bowl, title game or rivalry name; NBA games
        // their NBA Cup or play-in round ("NBA Cup · Group Play").
        var caption: String?
        let postseason = e.season?.slug == "post-season"
        if postseason || path.hasSuffix("college-football") || path == NBADetail.path,
           let headline = e.competitions?.first?.notes?.first?.headline, !headline.isEmpty {
            // ESPN attaches a later playoff series to regular-season meetings of the
            // same teams: a series line belongs to the postseason only.
            caption = ([headline.replacingOccurrences(of: " - ", with: " · ")]
                + [postseason ? e.competitions?.first?.series?.summary.map(MLBPostseason.shortSummary) : nil].compactMap { $0 })
                .joined(separator: " · ")
        }

        return Event(
            id: "espn-\(e.id)",
            content: content,
            state: state,
            start: start,
            // A delayed start stays "pre" for hours: say so, rather than a
            // start time that has passed.
            detail: state == .scheduled && status?.name == "STATUS_DELAYED" ? "Delayed"
                : status?.shortDetail == "FT-Pens" ? "Pens" : status?.shortDetail,
            caption: caption,
            link: link.flatMap(URL.init(string:)),
            ref: .espn(path: path, id: e.id, sport: sport),
            stage: e.season?.slug,
            clock: clock,
            possession: state == .live
                ? e.competitions?.first?.situation?.possession.map { ESPNTeamID.make(path: path, sport: sport, team: $0) } : nil,
            liveLine: state == .live ? e.competitions?.first?.situation?.line(sport: sport, path: path) : nil,
            liveLineRoutine: state == .live && path == NBADetail.path && e.competitions?.first?.situation?.routine == true,
            // National networks (up to two); without one, just the first listed
            // (usually the league's own pass), never a string of regional feeds.
            broadcast: e.competitions?.first?.broadcasts.map { list in
                let national = list.filter { $0.market == "national" }.flatMap { $0.names ?? [] }
                let names = national.isEmpty ? Array(list.flatMap { $0.names ?? [] }.prefix(1)) : Array(national.prefix(2))
                return names.map { Broadcaster(name: $0, type: nil).name }.joined(separator: " · ")
            }.flatMap { $0.isEmpty ? nil : $0 },
            venue: e.competitions?.first?.venue?.fullName,
            snapshot: snapshot
        )
    }

    /// What a live tile draws, from the parts of the scoreboard the list
    /// doesn't use. Nil when the scoreboard doesn't carry it.
    static func liveSnapshot(_ competition: Competition?, sport: Sport, home: Comp, away: Comp,
                             content: Event.Content) -> LiveSnapshot? {
        guard let competition else { return nil }
        // Soccer lists home first (top); the other sports list away first.
        let topIsHome = sport == .soccer
        let situation = competition.situation
        switch sport {
        case .football:
            guard let s = situation, let yardLine = s.yardLine else { return nil }
            let possession: GameDetail.Side? = s.possession.flatMap { id in
                id == home.team?.id ? (topIsHome ? .top : .bottom) : id == away.team?.id ? (topIsHome ? .bottom : .top) : nil
            }
            return .football(FootballGeometry.spot(yardLine: yardLine, down: s.down, distance: s.distance,
                                                   possession: possession, topIsHome: topIsHome, redZone: s.isRedZone ?? false))
        case .baseball:
            guard let s = situation, let outs = s.outs else { return nil }
            return .baseball(BaseState(onFirst: s.onFirst ?? false, onSecond: s.onSecond ?? false, onThird: s.onThird ?? false,
                                       balls: s.balls ?? 0, strikes: s.strikes ?? 0, outs: outs,
                                       batter: s.batter, pitcher: s.pitcher))
        case .soccer:
            guard let details = competition.details else { return nil }
            let marks = details.compactMap { $0.mark(homeID: home.team?.id, awayID: away.team?.id, topIsHome: topIsHome) }
                .sorted { $0.minute < $1.minute }
            guard case let .match(top, bottom) = content else { return .soccer(marks) }
            return .soccer(MatchMark.reconcile(marks, topScore: top.score.flatMap { Int($0) },
                                               bottomScore: bottom.score.flatMap { Int($0) }))
        case .basketball:
            return .basketball(lastPlay: situation?.lastPlayText)
        default:
            return nil
        }
    }
}

// MARK: - Counter-Strike 2 (bo3.gg)

enum CounterStrike {
    /// S-tier only, everywhere: scores, schedules, tournaments, results,
    /// team pages. bo3.gg's `tier` filter value.
    static let tier = "s"

    struct Page: Decodable { let results: [Match]? }
    struct Match: Decodable {
        let id: Int
        let slug: String?
        let status: String?
        let bo_type: Int?
        let start_date: String?
        let team1_score: Int?
        let team2_score: Int?
        let winner_team_id: Int?
        let team1: Team?
        let team2: Team?
        let tournament: Tournament?
    }
    struct Team: Decodable { let id: Int; let name: String?; let image_url: String? }
    struct Tournament: Decodable { let name: String? }

    static func events() async throws -> [Event] {
        // Postponed matches stay with the upcoming ones and canceled ones with
        // the results, each saying so, instead of silently vanishing.
        let now = Date()
        async let live = HTTP.get(Page.self, listURL(status: "current", sort: "start_date", limit: 20))
        async let upcoming = HTTP.get(Page.self, listURL(status: "upcoming,postponed", sort: "start_date", limit: 12,
                                                         after: now - 2 * 86_400))
        async let finished = HTTP.get(Page.self, listURL(status: "finished,defwin,canceled", sort: "-start_date",
                                                         limit: 12, before: now + 2 * 86_400))
        let pages = try await [live, upcoming, finished]

        // A match changing state can be cached in two lists at once; keep one,
        // preferring the live copy.
        var byID: [Int: Match] = [:]
        for match in pages.flatMap({ $0.results ?? [] }) where byID[match.id] == nil || match.status == "current" {
            byID[match.id] = match
        }
        return byID.values.compactMap(makeEvent)
    }

    /// A match list. `after`/`before` bound the start date, so a match
    /// postponed months ago (or canceled far ahead) can't take a slot.
    static func listURL(status: String, sort: String, limit: Int, after: Date? = nil, before: Date? = nil) -> URL {
        var c = URLComponents(string: "https://api.bo3.gg/api/v1/matches")!
        let iso = ISO8601DateFormatter()
        c.queryItems = [
            .init(name: "filter[matches.discipline_id][eq]", value: "1"),
            .init(name: "filter[matches.status][in]", value: status),
            .init(name: "filter[matches.tier][in]", value: tier),
            .init(name: "sort", value: sort),
            .init(name: "page[limit]", value: String(limit)),
            .init(name: "with", value: "teams,tournament"),
        ]
        if let after { c.queryItems?.append(.init(name: "filter[matches.start_date][gte]", value: iso.string(from: after))) }
        if let before { c.queryItems?.append(.init(name: "filter[matches.start_date][lte]", value: iso.string(from: before))) }
        return c.url!
    }

    /// A short name for tight spaces when bo3.gg's acronym isn't in the match
    /// list: "G2", "FaZe" and "MOUZ" stay; "Natus Vincere" → "NV";
    /// "The MongolZ" → "MON"; "Team Spirit" → "SPI".
    static func abbreviate(_ name: String) -> String {
        let filler: Set<String> = ["the", "team", "esports", "gaming", "club", "cs", "cs2", "academy"]
        // Words, not decoration: "🐺 Wolves Esports" is "WOL", never "🐺W".
        let words = name.split { $0 == " " || $0 == "." }.map(String.init)
            .filter { $0.first.map { $0.isLetter || $0.isNumber } ?? false }
        let core = words.filter { !filler.contains($0.lowercased()) }
        let kept = core.isEmpty ? words : core
        if kept.count >= 2 { return kept.prefix(3).compactMap(\.first).map(String.init).joined().uppercased() }
        let word = kept.first ?? name
        return word.count <= 5 ? word : String(word.prefix(3)).uppercased()
    }

    static func makeEvent(_ m: Match) -> Event? {
        // Unseeded bracket slots ("TBD vs TBD") are noise.
        guard let start = DateParser.parse(m.start_date), m.team1 != nil || m.team2 != nil else { return nil }
        // Canceled and postponed matches aren't upcoming: like ESPN's postponed
        // games they're over for now, without a score (so no "Final" alert).
        let called = m.status == "canceled" || m.status == "postponed"
        let state: EventState = switch m.status {
        case "current": .live
        case "finished", "defwin", "canceled", "postponed": .final
        default: .scheduled
        }

        func competitor(_ t: Team?, _ score: Int?) -> Competitor {
            let name = t?.name ?? "TBD"
            return Competitor(
                id: t.map { "cs-\($0.id)" },
                name: name,
                abbreviation: abbreviate(name),
                score: state == .scheduled || called ? nil : String(score ?? 0),
                logo: t?.image_url.flatMap(URL.init(string:)),
                isWinner: !called && t != nil && t?.id == m.winner_team_id
            )
        }

        let bestOf = m.bo_type.map { "Best of \($0)" }
        let detail: String? = switch (state, m.status) {
        case (.live, _):
            "Map \((m.team1_score ?? 0) + (m.team2_score ?? 0) + 1)" + (m.bo_type.map { " of \($0)" } ?? "")
        case (_, "canceled"): "Canceled"
        case (_, "postponed"): "Postponed"
        case (_, "defwin"): "Forfeit"
        case (.final, _): "Final"
        case (.scheduled, _): nil
        }

        return Event(
            id: "cs-\(m.id)",
            content: .match(top: competitor(m.team1, m.team1_score), bottom: competitor(m.team2, m.team2_score)),
            state: state,
            start: start,
            detail: detail,
            caption: [m.tournament?.name, bestOf].compactMap { $0 }.joined(separator: " · "),
            link: m.slug.flatMap { URL(string: "https://bo3.gg/matches/\($0)") },
            ref: m.slug.map { .counterStrike(slug: $0, tournament: m.tournament?.name) }
        )
    }
}

// MARK: - Climbing (IFSC results service)

private enum IFSC {
    static let base = "https://ifsc.results.info"
    static let headers = ["Referer": "https://ifsc.results.info/"]

    struct Root: Decodable { let current: Season? }
    struct Season: Decodable { let url: String?; let leagues: [SeasonLeague]? }
    struct SeasonLeague: Decodable { let id: Int; let league_id: Int? }
    struct SeasonDetail: Decodable { let events: [EventSummary]? }
    struct EventSummary: Decodable {
        let event_id: Int
        let event: String?
        let location: String?
        let league_season_id: Int?
        let starts_at: String?
        let ends_at: String?
    }
    struct EventDetail: Decodable { let d_cats: [Category]? }
    struct Category: Decodable { let dcat_name: String?; let category_rounds: [Round]? }
    struct Round: Decodable { let name: String?; let status: String?; let status_as_of: String?; let result_url: String? }
    struct Athlete { let rank: Int?; let firstname: String?; let lastname: String?; let country: String? }

    /// World Cups & World Championships.
    static let worldCupLeague = 1

    static func get<T: Decodable>(_ type: T.Type, _ path: String) async throws -> T {
        try await HTTP.get(type, URL.api(path, relativeTo: base), headers: headers)
    }

    static func events(countries: [String]) async throws -> [Event] {
        let root = try await get(Root.self, "/api/v1/")
        guard let seasonURL = root.current?.url,
              let leagueSeason = root.current?.leagues?.first(where: { $0.league_id == worldCupLeague })?.id
        else { return [] }

        let season = try await get(SeasonDetail.self, seasonURL)
        let now = Date()
        let comps = (season.events ?? []).filter {
            $0.league_season_id == leagueSeason && !($0.event ?? "").localizedCaseInsensitiveContains("cancelled")
        }

        var output: [Event] = []

        // Events underway, or finished within the last day, are shown round by round.
        let active = comps.filter {
            guard let s = DateParser.parse($0.starts_at), let e = DateParser.parse($0.ends_at) else { return false }
            return s <= now && now <= e.addingTimeInterval(24 * 3600)
        }
        for comp in active {
            output += try await categoryEvents(for: comp, countries: countries)
        }

        // Otherwise surface the next competition so the section isn't empty.
        // Once the season is over, that's the next season's opener: the
        // 2026 season ended in late October and 2027 starts in April.
        if output.isEmpty, comps.allSatisfy({ (DateParser.parse($0.starts_at) ?? .distantPast) <= now }),
           let opener = await ScheduleProvider.IFSC.nextSeasonOpener(now: now) {
            output.append(opener)
        } else if output.isEmpty, let next = comps
            .compactMap({ c in DateParser.parse(c.starts_at).map { (c, $0) } })
            .filter({ $0.1 > now })
            .min(by: { $0.1 < $1.1 }) {
            output.append(Event(
                id: "ifsc-\(next.0.event_id)",
                content: .field(title: shortName(next.0.event), summary: next.0.location ?? ""),
                state: .scheduled,
                start: next.1,
                detail: nil,
                caption: nil,
                link: URL(string: "\(base)/event/\(next.0.event_id)"),
                ref: .climbing(eventID: next.0.event_id, category: "", resultURL: nil, round: nil, eventName: shortName(next.0.event),
                               nextURL: nil)
            ))
        }
        return output
    }

    static func categoryEvents(for comp: EventSummary, countries: [String]) async throws -> [Event] {
        let detail = try await get(EventDetail.self, "/api/v1/events/\(comp.event_id)")
        let start = DateParser.parse(comp.starts_at) ?? .now

        return try await withThrowingTaskGroup(of: (Int, Event?).self) { group in
            for (index, cat) in (detail.d_cats ?? []).enumerated() {
                group.addTask { (index, try? await event(for: cat, comp: comp, start: start, index: index, countries: countries)) }
            }
            let pairs = try await group.reduce(into: [(Int, Event?)]()) { $0.append($1) }
            return pairs.sorted { $0.0 < $1.0 }.compactMap(\.1)
        }
    }

    static func event(for cat: Category, comp: EventSummary, start: Date, index: Int, countries: [String]) async throws -> Event? {
        let rounds = cat.category_rounds ?? []
        guard !rounds.isEmpty else { return nil }

        // A round counts as live only if upstream touched it recently; stale "active"
        // flags linger for days after some rounds finish.
        let live = rounds.first { round in
            guard round.status == "active" else { return false }
            return DateParser.parse(round.status_as_of).map { $0 > .now - 12 * 3600 } ?? true
        }
        let lastFinished = rounds.last { $0.status == "finished" }
        let next = rounds.first { $0.status != "finished" && $0.name != live?.name }

        // Upstream occasionally leaves a round "active" after the event wraps up.
        let ended = DateParser.parse(comp.ends_at).map { $0 < .now } ?? false
        let state: EventState = live != nil && !ended ? .live : (next == nil || ended ? .final : .scheduled)
        let focus = live ?? lastFinished

        func short(_ a: Athlete) -> String {
            (a.firstname?.first.map { "\($0). " } ?? "") + (a.lastname?.capitalized ?? "")
        }
        var leader: String?
        var yours: String?
        var snapshot: LiveSnapshot?
        // Read leniently: the same response also says who's on the wall, for tiles.
        if let url = focus?.result_url {
            let results = try await JSON.fetch(URL.api(url, relativeTo: base), headers: headers)
            if state == .live { snapshot = WallState.from(results: results).map(LiveSnapshot.climbing) }
            // No ranking yet (a round not underway): no leader, as before.
            let ranking = results["ranking"].array.map {
                Athlete(rank: $0["rank"].int, firstname: $0["firstname"].string, lastname: $0["lastname"].string,
                        country: $0["country"].string)
            }
            if let first = ranking.first(where: { $0.rank == 1 }) {
                leader = [Flag.emoji(ioc: first.country), short(first)].compactMap { $0 }.joined(separator: " ")
            }
            // Best-placed athlete from the user's countries, e.g. "USA: N. Grossman 3rd".
            if let index = ranking.firstIndex(where: { $0.country.map(countries.contains) ?? false }) {
                let athlete = ranking[index]
                let place = athlete.rank ?? (index + 1)
                // "🇺🇸 J. Grupper 7th in qualification": say which round the place is from.
                let round = focus?.name.map { " in \($0.lowercased())" } ?? ""
                yours = [Flag.emoji(ioc: athlete.country) ?? athlete.country, short(athlete), Ordinal.string(place) + round]
                    .compactMap { $0 }.joined(separator: " ")
            }
        }

        let round = focus?.name ?? next?.name ?? ""
        let summary: String = switch state {
        case .live: [round, leader.map { "Leader \($0)" }].compactMap { $0 }.joined(separator: " · ")
        case .final: leader.map { "Winner \($0)" } ?? "Finished"
        // Standings for the finished round are one click away on the detail page.
        case .scheduled: next.map { "\($0.name ?? "Next round") next" } ?? ""
        }

        return Event(
            id: "ifsc-\(comp.event_id)-\(index)",
            content: .field(title: (cat.dcat_name ?? "").capitalized, summary: summary),
            state: state,
            start: start,
            detail: state == .final ? "Final" : nil,
            caption: [shortName(comp.event), yours].compactMap { $0 }.joined(separator: " · "),
            link: URL(string: "\(base)/event/\(comp.event_id)"),
            ref: .climbing(eventID: comp.event_id, category: (cat.dcat_name ?? "").capitalized, resultURL: focus?.result_url,
                           round: (live ?? next)?.name, eventName: shortName(comp.event),
                           nextURL: live == nil ? next?.result_url : nil),
            snapshot: snapshot
        )
    }

    /// "World Climbing Series Santiago 2026" → "Santiago 2026"
    static func shortName(_ name: String?) -> String {
        guard let name else { return "" }
        for prefix in ["IFSC World Cup ", "World Climbing Series ", "IFSC "] where name.hasPrefix(prefix) {
            return String(name.dropFirst(prefix.count))
        }
        return name
    }
}
