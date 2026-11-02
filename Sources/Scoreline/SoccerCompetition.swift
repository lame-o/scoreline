import Foundation

// A soccer competition's season from ESPN: its rounds, their ties and the tree
// they make. The rounds come from ESPN's season metadata, never a format written
// down here, and the tree is worked out once from what's actually drawn: a round
// nobody has drawn stays undrawn, and a season with no clean run to its final has
// no tree at all.

// MARK: - What ESPN publishes

/// A competition as its scoreboard describes it: its name, its logo, its current season.
struct CompetitionInfo: Hashable, Codable, Sendable {
    /// "Carabao Cup"
    var name: String?
    var logo: URL?
    var darkLogo: URL?
    var year: Int?

    init(_ json: JSON) {
        let league = json["leagues"][0]
        name = league["abbreviation"].string ?? league["name"].string
        let logos = league["logos"].array
        logo = logos.first { !$0["rel"].array.contains { $0.string == "dark" } }?["href"].string.flatMap(URL.init(string:))
        darkLogo = logos.first { $0["rel"].array.contains { $0.string == "dark" } }?["href"].string.flatMap(URL.init(string:))
        year = league["season"]["year"].int
    }
}

/// A season's stages, as ESPN's core API lists them.
struct CompetitionSeason: Hashable, Codable, Sendable {
    struct Stage: Hashable, Codable, Sendable {
        let id: String
        let name: String
        var hasLegs = false
        var hasStandings = false
        var isFinal = false
        var isThirdPlace = false
        var start: DayKey?
        var end: DayKey?
    }

    let year: Int
    /// "2026-27 English Carabao Cup"
    let displayName: String
    /// The stage ESPN says is on.
    let current: String?
    let stages: [Stage]

    init?(_ json: JSON) {
        guard let year = json["year"].int else { return nil }
        self.year = year
        displayName = json["displayName"].string ?? ""
        current = json["type"]["type"].string
        stages = json["types"]["items"].array.compactMap { item in
            guard let id = item["type"].string, let name = item["name"].string else { return nil }
            return Stage(id: id, name: name.trimmingCharacters(in: .whitespaces), hasLegs: item["hasLegs"].bool == true,
                         hasStandings: item["hasStandings"].bool == true || item["hasGroups"].bool == true,
                         isFinal: item["isFinal"].bool == true, isThirdPlace: item["isThirdPlace"].bool == true,
                         start: Self.day(item["startDate"].string), end: Self.day(item["endDate"].string))
        }
        guard !stages.isEmpty else { return nil }
    }

    private static func day(_ text: String?) -> DayKey? {
        text.flatMap(DateParser.parse).map { DayKey.of($0, in: DayKey.utc) }
    }
}

/// One game on a competition's board, with what the tree needs to know about it.
struct CompetitionGame: Hashable, Codable, Sendable {
    /// A tie's running state, on each of its games.
    struct Series: Hashable, Codable, Sendable {
        var completed = false
        /// ESPN's flag: usually the tie's winner, sometimes only the last leg's (Libertadores 2026).
        var winner: String?
        /// Each team's total over the legs, once ESPN has one.
        var aggregate: [String: Int] = [:]
        /// How many games it can run to.
        var total: Int?
    }

    var item: ScheduleItem
    let stage: String
    let year: Int
    /// Nil for a placeholder ("TBD Away", "Winner Match 73").
    let home: BracketTeam?
    let away: BracketTeam?
    /// Goals by team ID.
    let goals: [String: Int]
    /// ESPN's winner: on penalties too, where the goals are level.
    let winner: String?
    let series: Series?

    /// A scoreboard's events. (pure; tested)
    static func board(_ json: JSON, slug: String, now: Date = .now, zone: TimeZone = .current) -> [CompetitionGame] {
        json["events"].array.compactMap { event in
            guard let year = event["season"]["year"].int, let stage = event["season"]["type"].string,
                  let item = ScheduleProvider.ESPN.item(event, path: "soccer/\(slug)", league: slug, sport: .soccer,
                                                        week: nil, now: now, zone: zone) else { return nil }
            let c = event["competitions"][0]
            let competitors = c["competitors"].array
            func team(_ side: String) -> BracketTeam? {
                let t = competitors.first { $0["homeAway"].string == side }?["team"] ?? JSON(nil)
                guard let id = t["id"].string, !isPlaceholder(t["displayName"].string ?? "") else { return nil }
                return BracketTeam(id: id, name: t["shortDisplayName"].string ?? t["displayName"].string ?? "",
                                   abbreviation: t["abbreviation"].string ?? "", logo: t["logo"].string.flatMap(URL.init(string:)))
            }
            var goals: [String: Int] = [:]
            for competitor in competitors {
                if let id = competitor["team"]["id"].string, let score = competitor["score"].int { goals[id] = score }
            }
            let winner = competitors.first { $0["winner"].bool == true }?["team"]["id"].string
            var series: Series?
            if c["series"].exists {
                let entries = c["series"]["competitors"].array
                series = Series(completed: c["series"]["completed"].bool == true,
                                winner: entries.first { $0["winner"].bool == true }?["id"].string,
                                aggregate: Dictionary(entries.compactMap { entry in
                                    entry["id"].string.flatMap { id in entry["aggregateScore"].int.map { (id, $0) } }
                                }, uniquingKeysWith: { a, _ in a }),
                                total: c["series"]["totalCompetitions"].int)
            }
            return CompetitionGame(item: item, stage: stage, year: year, home: team("home"), away: team("away"),
                                   goals: goals, winner: winner, series: series)
        }
    }

    /// ESPN names a side it doesn't know yet instead of leaving it out.
    static func isPlaceholder(_ name: String) -> Bool {
        name.range(of: #"^TBD\b|\b(Winner|Loser)\b"#, options: .regularExpression) != nil
    }
}

// MARK: - The season

/// One season of a competition, ready to show: the rounds in order, with each
/// knockout round's ties, and the tree if the season has one.
struct SoccerCompetition: Sendable {
    /// A round or phase. ESPN's conference playoffs read as one round here, and
    /// what isn't part of the competition (an All-Star game) doesn't appear.
    struct Stage: Identifiable, Sendable {
        let id: String
        let name: String
        var hasStandings = false
        var isFinal = false
        var isThirdPlace = false
        /// Its window, as ESPN has it, for a round with no fixtures yet.
        var start: DayKey?
        var games: [ScheduleItem] = []
        /// Knockout rounds: each pair of teams, however many games they play.
        var ties: [Tie] = []

        var live: Bool { games.contains { $0.status == .live } }
        var finished: Bool { !games.isEmpty && games.allSatisfy { $0.status != .scheduled && $0.status != .live } }
    }

    struct Tie: Identifiable, Sendable {
        let id: String
        var match: BracketMatch
        var games: [ScheduleItem]

        /// The game a click on the tie opens: the one on now, else the one just played, else the next.
        var game: ScheduleItem? {
            games.first { $0.status == .live }
                ?? games.last { $0.status == .final }
                ?? games.first { $0.status == .scheduled } ?? games.first
        }
    }

    let slug: String
    let title: String
    let year: Int
    /// "2026–27", "2026"
    let seasonLabel: String
    let isCurrentSeason: Bool
    var logo: URL?
    var darkLogo: URL?
    /// The stage on now.
    let current: String?
    let stages: [Stage]
    /// The run to the final, when there's a clean one with something drawn in it.
    let bracket: Bracket?
    /// Where the tree will start, while nothing in it is drawn ("Round of 16").
    let undrawnFrom: String?

    /// Whether the season has anything to show on a Bracket tab, drawn or not.
    var hasKnockout: Bool { bracket != nil || undrawnFrom != nil }
    var hasTable: Bool { stages.contains(where: \.hasStandings) }
    var isEmpty: Bool { stages.allSatisfy(\.games.isEmpty) }

    /// The tie a click on the tree's cell stands for.
    func tie(_ id: String) -> Tie? {
        for stage in stages {
            if let tie = stage.ties.first(where: { $0.id == id }) { return tie }
        }
        return nil
    }

    /// The latest stage these teams met in: where a page opened from their match starts.
    func stage(meeting teams: Set<String>) -> Stage? {
        guard !teams.isEmpty else { return nil }
        return stages.last { stage in
            stage.games.contains { game in teams.isSubset(of: Set(game.teams.compactMap { $0.id?.split(separator: "-").last.map(String.init) })) }
        }
    }

    /// (pure; tested)
    init(slug: String, info: CompetitionInfo, season: CompetitionSeason, games: [CompetitionGame], today: DayKey = .today()) {
        self.slug = slug
        title = League.with(id: slug)?.name ?? info.name ?? Self.title(displayName: season.displayName)
        year = season.year
        seasonLabel = Self.label(displayName: season.displayName, year: season.year)
        isCurrentSeason = info.year == season.year
        logo = info.logo
        darkLogo = info.darkLogo
        var seen = Set<String>()
        let own = games.filter { $0.year == season.year && seen.insert($0.item.id).inserted }
            .sorted { $0.item.sortDate < $1.item.sortDate }
        stages = Self.stages(season, games: own, competition: title, today: today)
        let on = season.stages.first { $0.id == season.current }.map { Self.stageName(Self.roundName($0.name)) }
        current = stages.first { $0.name == on }?.id
        (bracket, undrawnFrom) = Self.tree(stages)
    }

    // MARK: Names

    /// "2026-27 English Carabao Cup" → "Carabao Cup", for a competition ESPN gives no short name.
    static func title(displayName: String) -> String {
        var name = displayName.replacingOccurrences(of: #"^\d{4}(-\d{2,4})?\s+"#, with: "", options: .regularExpression)
        for nation in ["English ", "Spanish ", "German ", "Italian ", "French ", "Dutch ", "Scottish ", "Portuguese "] where name.hasPrefix(nation) {
            name.removeFirst(nation.count)
        }
        return name
    }

    /// "2026-27 English Carabao Cup" → "2026–27"; "2026 MLS" → "2026".
    static func label(displayName: String, year: Int) -> String {
        guard let range = displayName.range(of: #"^\d{4}-\d{2}\b"#, options: .regularExpression) else { return String(year) }
        return displayName[range].replacingOccurrences(of: "-", with: "–")
    }

    /// The season's own name is no round's: a league's only stage reads "Season".
    private static func stageName(_ name: String) -> String {
        name.range(of: #"^\d{4}"#, options: .regularExpression) == nil ? name : "Season"
    }

    /// ESPN splits MLS's playoffs by conference, then by series: the same round for this page.
    /// "Eastern Conference Playoffs - Semifinals" → "Conference Semifinals".
    static func roundName(_ name: String) -> String {
        guard let match = name.firstMatch(of: #/^(?:Eastern|Western) Conference Playoffs - (.+)$/#) else { return name }
        switch String(match.1) {
        case "Semifinals": return "Conference Semifinals"
        case "Final": return "Conference Finals"
        case let round: return round
        }
    }

    private static func isExhibition(_ name: String) -> Bool {
        name.localizedCaseInsensitiveContains("all-star") || name == "Combined"
    }

    // MARK: Stages and ties

    private static func stages(_ season: CompetitionSeason, games: [CompetitionGame], competition: String, today: DayKey) -> [Stage] {
        let byStage = Dictionary(grouping: games, by: \.stage)
        // Same-named stages are one round, where its first one falls.
        var order: [String] = []
        var merged: [String: [CompetitionSeason.Stage]] = [:]
        for stage in season.stages where !isExhibition(stage.name) {
            let name = roundName(stage.name)
            if merged[name] == nil { order.append(name) }
            merged[name, default: []].append(stage)
        }
        return order.compactMap { name in
            guard let parts = merged[name], let first = parts.first else { return nil }
            let own = parts.flatMap { byStage[$0.id] ?? [] }.sorted { $0.item.sortDate < $1.item.sortDate }
            // A window that's over with nothing in it never happened (MLS's "Combined").
            if own.isEmpty, let end = parts.compactMap(\.end).max(), end < today { return nil }
            let title = stageName(name)
            let round = title == "Season" ? competition : "\(competition) · \(title)"
            let named = own.map { game in
                var game = game
                game.item.competition = round
                return game
            }
            var stage = Stage(id: first.id, name: title, hasStandings: parts.contains(where: \.hasStandings),
                              isFinal: parts.contains(where: \.isFinal), isThirdPlace: parts.contains(where: \.isThirdPlace),
                              start: parts.compactMap(\.start).min(), games: named.map(\.item))
            if !stage.hasStandings {
                // A placeholder pairs with nobody: its own tie until the side is known.
                let pair = { (game: CompetitionGame) in
                    game.home.flatMap { home in game.away.map { [home.id, $0.id].sorted().joined(separator: ":") } } ?? game.item.id
                }
                let pairs = Dictionary(grouping: named, by: pair)
                var seen = Set<String>()
                let legs = parts.contains(where: \.hasLegs)
                stage.ties = named.map(pair).filter { seen.insert($0).inserted }.map { key in
                    tie(id: "\(first.id):\(key)", games: pairs[key] ?? [], legs: legs)
                }
            }
            return stage
        }
    }

    /// A pair of teams' games as one tie: goals when it's one game, the aggregate
    /// over two legs, games won over a series. The aggregate names the winner
    /// whenever it can: ESPN's flag sometimes follows the last leg instead.
    static func tie(id: String, games: [CompetitionGame], legs: Bool) -> Tie {
        let first = games[0]
        var match = BracketMatch(id: id, top: first.home, bottom: first.away)
        let played = games.filter { $0.item.status == .live || $0.item.status == .final }
        let series = games.last { $0.series != nil }?.series
        let bestOf = !legs && (series?.total ?? 0) > 2
        match.live = games.contains { $0.item.status == .live }
        match.note = played.last?.item.notes.last ?? played.last?.item.statusDetail
            ?? first.item.start.date.map { When.dayAndTime($0) }
        func score(_ team: BracketTeam?) -> Int? {
            guard let team, !played.isEmpty else { return nil }
            if legs { return series?.aggregate[team.id] ?? played.reduce(0) { $0 + ($1.goals[team.id] ?? 0) } }
            if bestOf { return played.filter { $0.winner == team.id }.count }
            return played.last?.goals[team.id]
        }
        match.topScore = score(first.home)
        match.bottomScore = score(first.away)
        let winner: String? = {
            if legs || bestOf {
                guard series?.completed == true, let top = match.topScore, let bottom = match.bottomScore else { return nil }
                if top != bottom { return top > bottom ? first.home?.id : first.away?.id }
                return series?.winner
            }
            return played.last { $0.item.status == .final }?.winner
        }()
        match.winner = winner == nil ? nil : winner == first.home?.id ? .top : winner == first.away?.id ? .bottom : nil
        return Tie(id: id, match: match, games: games.map(\.item))
    }

    // MARK: The tree

    /// A tree's widest round, after which earlier rounds stay in Fixtures: the last 16.
    static let treeEntry = 8

    /// The run into a final: rounds halving exactly back from it, connected team
    /// by team, as far as the last 16. A knockout phase that opens wider right
    /// after a group stage (a World Cup's Round of 32) is all one tree. A round
    /// not drawn yet stays in the run only after the last one that is.
    private static func run(to index: Int, in stages: [Stage]) -> [Stage] {
        var rounds = [stages[index]]
        var expected = 2
        var position = index - 1
        while position >= 0 {
            let stage = stages[position]
            position -= 1
            if stage.isThirdPlace { continue }
            guard !stage.hasStandings else { break }
            if expected > treeEntry {
                let opensAfterGroups = position < 0 || stages[position].hasStandings
                guard expected == treeEntry * 2, stage.ties.count == expected, opensAfterGroups else { break }
            }
            let later = rounds[0]
            if stage.ties.isEmpty {
                guard later.ties.isEmpty else { break }
            } else {
                let here = Set(stage.ties.flatMap { [$0.match.top?.id, $0.match.bottom?.id] }.compactMap { $0 })
                let there = Set(later.ties.flatMap { [$0.match.top?.id, $0.match.bottom?.id] }.compactMap { $0 })
                guard stage.ties.count == expected, there.isSubset(of: here) else { break }
            }
            rounds.insert(stage, at: 0)
            expected *= 2
        }
        return rounds
    }

    /// The season's tree: the latest final with something drawn in its run. (pure; tested)
    private static func tree(_ stages: [Stage]) -> (Bracket?, undrawnFrom: String?) {
        let finals = stages.indices.filter { stages[$0].isFinal && stages[$0].ties.count <= 1 }
        let runs = finals.map { run(to: $0, in: stages) }.filter { $0.count > 1 }
        guard let run = runs.last(where: { $0.contains { !$0.ties.isEmpty } }) else {
            return (nil, runs.first?.first?.name)
        }
        var matches: [String: BracketMatch] = [:]
        var columns: [[String]] = []
        for (index, round) in run.enumerated() {
            let next = index + 1 < run.count
                ? Set(run[index + 1].ties.flatMap { [$0.match.top?.id, $0.match.bottom?.id] }.compactMap { $0 }) : []
            var column: [String] = []
            for tie in round.ties {
                var match = tie.match
                if index > 0 {
                    match.feeders = [match.top, match.bottom].compactMap { team in
                        team.flatMap { team in run[index - 1].ties.first { $0.match.has(team: team.id) }?.id }
                    }
                }
                // Who's in the next round settles it, whatever the flags said.
                switch (match.top.map { next.contains($0.id) } ?? false, match.bottom.map { next.contains($0.id) } ?? false) {
                case (true, false): match.winner = .top
                case (false, true): match.winner = .bottom
                default: break
                }
                matches[match.id] = match
                column.append(match.id)
            }
            for slot in round.ties.count..<max(1 << (run.count - 1 - index), round.ties.count) {
                let id = "pending:\(round.id):\(slot)"
                matches[id] = BracketMatch(id: id, top: nil, bottom: nil, pending: true)
                column.append(id)
            }
            columns.append(column)
        }
        guard let finalID = columns.last?.first else { return (nil, nil) }
        var bracket = Bracket(rounds: run.map(\.name), matches: matches, finalID: finalID, columns: columns)
        bracket.extra = stages.filter(\.isThirdPlace).flatMap { stage in stage.ties.map { (title: stage.name, match: $0.match) } }
        return (bracket, nil)
    }
}

// MARK: - Loading

enum SoccerCompetitionProvider {
    private static let site = "https://site.api.espn.com/apis/site/v2/sports/soccer"
    private static let core = "https://sports.core.api.espn.com/v2/sports/soccer/leagues"
    /// A busy competition's calendar year can pass this: it's then read month by month.
    private static let boardLimit = 1000

    /// A competition's season, through the schedule cache: reopening one costs
    /// nothing until its data goes stale, and a season that's over never does.
    /// With no season asked for, the current one, or the one just finished
    /// while ESPN's next has nothing in it yet.
    static func load(slug: String, year requested: Int?, force: Bool = false, cache: ScheduleCache = .shared) async throws -> SoccerCompetition {
        let info = try await cache.get(URL.api("\(site)/\(slug)/scoreboard"), ttl: force ? 0 : 6 * 3600) { CompetitionInfo(JSON(data: $0)) }.value
        guard let year = requested ?? info.year else { throw URLError(.cannotParseResponse) }
        let competition = try await season(slug: slug, year: year, info: info, force: force, cache: cache)
        if requested == nil, competition.isEmpty,
           let previous = try? await season(slug: slug, year: year - 1, info: info, force: force, cache: cache), !previous.isEmpty {
            return previous
        }
        return competition
    }

    private static func season(slug: String, year: Int, info: CompetitionInfo, force: Bool, cache: ScheduleCache) async throws -> SoccerCompetition {
        let past = info.year.map { year < $0 } ?? false
        let metadata = try await cache.get(URL.api("\(core)/\(slug)/seasons/\(year)"), ttl: force ? 0 : past ? 30 * 86_400 : 6 * 3600) { data -> CompetitionSeason in
            guard let season = CompetitionSeason(JSON(data: data)) else { throw URLError(.cannotParseResponse) }
            return season
        }.value
        let ttl: TimeInterval = force ? 0 : past ? 30 * 86_400 : 300
        // A European season spans two calendar years; ESPN's window says which.
        let end = metadata.stages.compactMap(\.end).max()?.year ?? year
        guard end >= year, end <= year + 1 else { throw URLError(.cannotParseResponse) }
        var games: [CompetitionGame] = []
        for calendarYear in year...end {
            games += try await board(slug: slug, dates: "\(calendarYear)", ttl: ttl, cache: cache)
        }
        return SoccerCompetition(slug: slug, info: info, season: metadata, games: games)
    }

    private static func board(slug: String, dates: String, ttl: TimeInterval, cache: ScheduleCache) async throws -> [CompetitionGame] {
        let url = try URL.api("\(site)/\(slug)/scoreboard?dates=\(dates)&limit=\(boardLimit)")
        let games = try await cache.get(url, ttl: ttl) { CompetitionGame.board(JSON(data: $0), slug: slug) }.value
        guard games.count >= boardLimit, dates.count == 4 else {
            // Never silently a truncated season.
            if games.count >= boardLimit { throw URLError(.dataLengthExceedsMaximum) }
            return games
        }
        var months: [CompetitionGame] = []
        for month in 1...12 {
            months += try await board(slug: slug, dates: String(format: "%@%02d", dates, month), ttl: ttl, cache: cache)
        }
        return months
    }

    /// The seasons ESPN has for a competition, newest first.
    static func seasons(slug: String, cache: ScheduleCache = .shared) async -> [Int] {
        guard let url = try? URL.api("\(core)/\(slug)/seasons?limit=8"),
              let years = try? await cache.get(url, ttl: 86_400, parse: { parseSeasons(JSON(data: $0)) }) else { return [] }
        return years.value
    }

    /// (pure; tested)
    static func parseSeasons(_ json: JSON) -> [Int] {
        json["items"].array.compactMap { item in
            item["$ref"].string?.firstMatch(of: #/\/seasons\/(\d{4})/#).flatMap { Int($0.1) }
        }
    }
}

// MARK: - The season at a glance

extension SoccerCompetition {
    /// The round that's the story now: one on, else the next with fixtures, else
    /// the one ESPN says it's in, else the next at all, else the last that's done.
    var focusStage: Stage? {
        stages.first(where: \.live)
            ?? stages.first { !$0.finished && !$0.games.isEmpty && !$0.isThirdPlace }
            ?? stages.first { $0.id == current }
            ?? stages.first { !$0.finished && !$0.isThirdPlace }
            ?? stages.last { !$0.isThirdPlace }
    }

    private var days: (first: DayKey, last: DayKey)? {
        let known = stages.flatMap(\.games).map(\.day) + stages.compactMap(\.start)
        guard let first = stages.flatMap(\.games).map(\.day).min() ?? known.min(), let last = known.max() else { return nil }
        return (first, last)
    }

    /// "Aug 2026 – Feb 2027"
    var dateRange: String? {
        guard let days else { return nil }
        let month = { (day: DayKey) in day.displayDate.formatted(.dateTime.month(.abbreviated).year()) }
        return days.first.year == days.last.year && days.first.month == days.last.month ? month(days.first) : "\(month(days.first)) – \(month(days.last))"
    }

    /// The hero's two lines: the competition, then its round and its dates.
    var summary: SeasonSummary {
        let stage = focusStage
        let over = !isEmpty && stages.allSatisfy { $0.finished || $0.games.isEmpty }
        let line = over ? bracket.flatMap(champion).map { "\($0) won" } : stage.flatMap { $0.name == "Season" ? nil : $0.name }
        return SeasonSummary(headline: title, subline: [line, dateRange].compactMap { $0 }.joined(separator: " · "),
                             live: stages.contains(where: \.live), logo: logo, darkLogo: darkLogo)
    }

    private func champion(_ bracket: Bracket) -> String? {
        guard let final = bracket.matches[bracket.finalID] else { return nil }
        return final.winner == .top ? final.top?.name : final.winner == .bottom ? final.bottom?.name : nil
    }

    /// The rounds on one axis, as the season pages draw their competitions.
    func axis(today: DayKey = .today()) -> SeasonAxis {
        var readouts: [String: String] = [:]
        let events = stages.compactMap { stage -> SeasonEvent? in
            let days = stage.games.map(\.day)
            guard let start = days.min() ?? stage.start else { return nil }
            let end = days.max() ?? start
            let count = stage.hasStandings || stage.ties.isEmpty ? plural(stage.games.count, "game") : plural(stage.ties.count, "tie")
            readouts[stage.id] = [stage.name, DayKey.range(start, end), stage.games.isEmpty ? "To be drawn" : count].joined(separator: " · ")
            let status: SeasonEvent.Status = stage.live ? .live : stage.finished ? .finished : .upcoming
            return SeasonEvent(id: stage.id, kind: .round, name: stage.name, shortName: stage.name, startDay: start, endDay: end,
                               lanes: ["rounds"], status: status)
        }
        let focus = focusStage?.id
        return SeasonAxis(events: events, lanes: [SeasonTimeline.Lane(id: "rounds", label: stages.count == 1 ? "Season" : "Rounds")], today: today,
                          next: events.first { $0.status == .upcoming && $0.id == focus }?.id, readouts: readouts, resting: focus)
    }
}

// MARK: - A match's competition

/// The competition a match belongs to, from its summary: wherever the match was
/// opened from, this is what it was played in.
struct MatchCompetition: Hashable {
    /// "uefa.champions"
    let slug: String
    /// "UEFA Champions League"
    let name: String
    /// The season the match was played in.
    let year: Int?
    /// "League Phase", "Fourth Round"; nil for a season with no rounds.
    let stage: String?
    /// ESPN's note on the match: "Liverpool win 6-5 on penalties", "1st Leg".
    let note: String?

    init?(_ summary: JSON) {
        guard let slug = summary["header"]["league"]["slug"].string else { return nil }
        self.slug = slug
        name = League.with(id: slug)?.name ?? summary["header"]["league"]["abbreviation"].string ?? summary["header"]["league"]["name"].string ?? slug
        year = summary["header"]["season"]["year"].int
        // "2026-27 English Carabao Cup, Fourth Round"
        stage = summary["header"]["season"]["name"].string?.components(separatedBy: ", ").dropFirst().last
        note = summary["header"]["competitions"][0]["notes"][0]["headline"].string.flatMap { $0.isEmpty ? nil : $0.replacingOccurrences(of: " - ", with: " · ") }
    }

    /// Whether it has a path through rounds to show: a cup or tournament, or a
    /// league's own playoffs. (pure; tested)
    var hasKnockout: Bool {
        if let kind = League.with(id: slug)?.kind, kind != .league { return true }
        guard let stage else { return false }
        return stage.range(of: #"Regular Season|League Phase|Group|Torneo"#, options: .regularExpression) == nil
    }

    /// The hero's line: "Carabao Cup · Fourth Round".
    var line: String {
        [name, stage == "Regular Season" ? nil : stage].compactMap { $0 }.joined(separator: " · ")
    }
}
