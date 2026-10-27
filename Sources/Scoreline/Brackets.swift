import AppKit
import SwiftUI

// Playoff brackets and tournament stages: the MLB postseason from ESPN's daily
// scoreboards, CS2 tournaments (Swiss stage and playoffs) from bo3.gg.

// MARK: - Model

struct BracketTeam: Hashable {
    let id: String
    let name: String
    let abbreviation: String
    let logo: URL?
}

/// One matchup: a single match (CS2) or a whole series (MLB).
struct BracketMatch: Identifiable, Hashable {
    let id: String
    var top: BracketTeam?
    var bottom: BracketTeam?
    /// Maps or games won.
    var topScore: Int?
    var bottomScore: Int?
    var winner: GameDetail.Side?
    var live = false
    /// "MIL leads 2–1", "Best of 3 · Oct 29".
    var note: String?
    /// Matchups whose winners play in this one, top first.
    var feeders: [String] = []

    func has(team id: String) -> Bool { top?.id == id || bottom?.id == id }
}

/// A knockout tree, drawn from its first round to the final.
struct Bracket {
    /// Round names, first round to final ("Wild Card" … "World Series").
    let rounds: [String]
    let matches: [String: BracketMatch]
    let finalID: String
    /// Played outside the tree (a 3rd-place match).
    var extra: [(title: String, match: BracketMatch)] = []
}

/// A Swiss stage: every team's result each round, toward a set number of wins.
struct SwissStage {
    struct Row: Identifiable {
        let team: BracketTeam
        /// Per round: won, lost, or not played (yet).
        let results: [Bool?]
        /// Per round: who they played (or play next, once drawn).
        var opponents: [BracketTeam?] = []
        var wins: Int { results.filter { $0 == true }.count }
        var losses: Int { results.filter { $0 == false }.count }
        var id: String { team.id }
    }
    let rounds: Int
    let rows: [Row]
    let winsToAdvance: Int
}

struct TournamentBrackets {
    let title: String
    var swiss: SwissStage?
    var bracket: Bracket?
}

enum BracketSource: Hashable {
    /// A postseason on ESPN (MLB).
    case espnPostseason(path: String, year: Int)
    case csTournament(slug: String, name: String)

    var title: String {
        switch self {
        case let .espnPostseason(_, year): "\(year) Postseason"
        case let .csTournament(_, name): name
        }
    }
}

// MARK: - Loading

enum BracketProvider {
    static func load(_ source: BracketSource) async throws -> TournamentBrackets {
        if let cached = await BracketCache.shared.value(for: source) { return cached }
        let result: TournamentBrackets = switch source {
        case let .espnPostseason(path, year): try await MLBPostseason.load(path: path, year: year)
        case let .csTournament(slug, _): try await CSTournament.load(slug: slug)
        }
        await BracketCache.shared.store(result, for: source)
        return result
    }
}

/// Brackets change a few times a day; reopening within a minute reuses them.
private actor BracketCache {
    static let shared = BracketCache()
    private var entries: [BracketSource: (date: Date, value: TournamentBrackets)] = [:]

    func value(for source: BracketSource) -> TournamentBrackets? {
        guard let entry = entries[source], Date().timeIntervalSince(entry.date) < 60 else { return nil }
        return entry.value
    }

    func store(_ value: TournamentBrackets, for source: BracketSource) {
        entries[source] = (.now, value)
    }
}

// MARK: - MLB postseason

/// The postseason, rebuilt from ESPN's scoreboard one day at a time (the
/// scoreboard has no bracket of its own). Days that are over never change and
/// are kept for the session; only the last couple are fetched again.
enum MLBPostseason {
    private static let dayFormat: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "America/New_York")
        f.dateFormat = "yyyyMMdd"
        return f
    }()

    /// One game, as much as the bracket needs.
    struct Game: Sendable {
        let round: String          // "ALWC", "NLCS", "World Series"
        let teams: [BracketTeam]   // as listed
        let wins: [String: Int]    // series wins by team ID
        let summary: String?       // "MIL leads series 2-0"
        let completed: Bool        // the series
        let live: Bool
        let date: String
    }

    static func load(path: String, year: Int) async throws -> TournamentBrackets {
        let type = try await JSON.fetch(URL.api("https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/seasons/\(year)/types/3"))
        guard let start = type["startDate"].string.flatMap(DateParser.parse) else { throw URLError(.cannotParseResponse) }
        let end = min(type["endDate"].string.flatMap(DateParser.parse) ?? .now, Date().addingTimeInterval(86_400))
        var days: [String] = []
        var day = start
        while day <= end {
            days.append(dayFormat.string(from: day))
            day = day.addingTimeInterval(86_400)
        }
        let games = try await games(on: days, path: path)
        return TournamentBrackets(title: "\(year) Postseason", bracket: bracket(from: games))
    }

    private static func games(on days: [String], path: String) async throws -> [Game] {
        let recent = Set(days.suffix(3))
        var all: [Game] = []
        // A few at a time: a polite burst, not thirty at once.
        for chunk in stride(from: 0, to: days.count, by: 6).map({ Array(days[$0..<min($0 + 6, days.count)]) }) {
            let results = await withTaskGroup(of: [Game]?.self) { group in
                for day in chunk {
                    group.addTask {
                        if !recent.contains(day), let cached = await DayCache.shared.games(on: day) { return cached }
                        guard let url = try? URL.api("https://site.api.espn.com/apis/site/v2/sports/\(path)/scoreboard?dates=\(day)"),
                              let json = try? await JSON.fetch(url) else { return nil }
                        let games = json["events"].array.compactMap { game($0, day: day) }
                        if !recent.contains(day) { await DayCache.shared.store(games, on: day) }
                        return games
                    }
                }
                var games: [Game] = []
                for await result in group { games += result ?? [] }
                return games
            }
            all += results
        }
        return all.sorted { $0.date < $1.date }
    }

    static func game(_ e: JSON, day: String) -> Game? {
        let c = e["competitions"][0]
        guard let headline = c["notes"][0]["headline"].string else { return nil }
        // "NLWC - Game 1" → "NLWC"; "World Series - Game 2" → "World Series".
        let round = headline.components(separatedBy: " - ").first ?? headline
        let teams = c["competitors"].array.compactMap { comp -> BracketTeam? in
            let t = comp["team"]
            guard let id = t["id"].string else { return nil }
            return BracketTeam(id: id, name: t["shortDisplayName"].string ?? t["displayName"].string ?? "",
                               abbreviation: t["abbreviation"].string ?? "", logo: t["logo"].string.flatMap(URL.init(string:)))
        }
        guard teams.count == 2 else { return nil }
        var wins: [String: Int] = [:]
        for s in c["series"]["competitors"].array {
            if let id = s["id"].string { wins[id] = s["wins"].int ?? 0 }
        }
        return Game(round: round, teams: teams, wins: wins, summary: c["series"]["summary"].string,
                    completed: c["series"]["completed"].bool ?? false,
                    live: e["status"]["type"]["state"].string == "in", date: day)
    }

    /// Wild Card → Division Series → Championship Series in each league, then the World Series.
    static func bracket(from games: [Game]) -> Bracket? {
        guard !games.isEmpty else { return nil }
        // One matchup per series: the latest game has its standing.
        var series: [String: BracketMatch] = [:]
        var order: [String] = []
        for game in games {
            let key = game.round + ":" + game.teams.map(\.id).sorted().joined(separator: "-")
            if series[key] == nil { order.append(key) }
            var match = BracketMatch(id: key, top: game.teams[0], bottom: game.teams[1])
            match.topScore = game.wins[game.teams[0].id]
            match.bottomScore = game.wins[game.teams[1].id]
            if game.completed, let t = match.topScore, let b = match.bottomScore, t != b { match.winner = t > b ? .top : .bottom }
            match.live = game.live
            match.note = game.summary.map(shortSummary)
            series[key] = match
        }
        func list(_ round: String) -> [BracketMatch] { order.filter { $0.hasPrefix(round + ":") }.compactMap { series[$0] } }

        var matches: [String: BracketMatch] = [:]
        func winner(_ m: BracketMatch) -> BracketTeam? { m.winner == .top ? m.top : m.winner == .bottom ? m.bottom : nil }

        var championships: [String] = []
        for league in ["AL", "NL"] {
            let wildCards = list(league + "WC")
            var divisions = list(league + "DS")
            var divisionIDs: [String] = []
            // Each Division Series is fed by the Wild Card series its newcomer came from.
            for (index, wc) in wildCards.enumerated() {
                let teams = [wc.top?.id, wc.bottom?.id].compactMap { $0 }
                if let i = divisions.firstIndex(where: { ds in teams.contains { ds.has(team: $0) } }) {
                    var ds = divisions.remove(at: i)
                    ds.feeders = [wc.id]
                    matches[ds.id] = ds
                    divisionIDs.append(ds.id)
                } else {
                    let placeholder = BracketMatch(id: "\(league)DS-\(index)", top: nil, bottom: winner(wc), feeders: [wc.id])
                    matches[placeholder.id] = placeholder
                    divisionIDs.append(placeholder.id)
                }
                matches[wc.id] = wc
            }
            for ds in divisions {
                matches[ds.id] = ds
                divisionIDs.append(ds.id)
            }
            var cs = list(league + "CS").first ?? BracketMatch(id: "\(league)CS", top: nil, bottom: nil)
            cs.feeders = divisionIDs
            matches[cs.id] = cs
            championships.append(cs.id)
        }
        var final = list("World Series").first ?? BracketMatch(id: "WS", top: nil, bottom: nil)
        final.feeders = championships
        matches[final.id] = final
        return Bracket(rounds: ["Wild Card", "Division Series", "Championship", "World Series"],
                       matches: matches, finalID: final.id)
    }

    /// "MIL leads series 2-1" → "MIL leads 2–1".
    static func shortSummary(_ summary: String) -> String {
        summary.replacingOccurrences(of: " series", with: "").replacingOccurrences(of: "-", with: "–")
    }
}

private actor DayCache {
    static let shared = DayCache()
    private var days: [String: [MLBPostseason.Game]] = [:]
    func games(on day: String) -> [MLBPostseason.Game]? { days[day] }
    func store(_ games: [MLBPostseason.Game], on day: String) { days[day] = games }
}

// MARK: - CS2 tournaments

/// A bo3.gg tournament: its stages (a Swiss group stage, a playoff tree, a
/// 3rd-place decider), with teams from its match list. About four requests.
enum CSTournament {
    static func load(slug: String) async throws -> TournamentBrackets {
        let tournament = try await JSON.fetch(URL.api("https://api.bo3.gg/api/v1/tournaments/\(slug)"))
        guard let id = tournament["id"].int else { throw URLError(.cannotParseResponse) }
        let name = tournament["name"].string ?? slug
        let stageInfo = tournament["stages"].array.compactMap { s -> (Int, String)? in
            guard let id = s["id"].int else { return nil }
            return (id, s["format_type"].string ?? "")
        }
        async let listCall = matchList(tournament: id)
        let stages = await withTaskGroup(of: (Int, JSON?).self) { group in
            for (stageID, _) in stageInfo {
                group.addTask { (stageID, try? await JSON.fetch(URL.api("https://api.bo3.gg/api/v1/stages/\(stageID)"))) }
            }
            var stages: [Int: JSON] = [:]
            for await (stageID, json) in group { if let json { stages[stageID] = json } }
            return stages
        }
        let list = try await listCall
        return build(name: name, stageInfo: stageInfo, stages: stages, matches: list)
    }

    /// One page of a tournament's matches. bo3.gg caps `page[limit]` at 100
    /// (asking for 200 silently returns 100), so long tournaments page.
    static func matchesURL(tournament id: Int, offset: Int) throws -> URL {
        try URL.api("https://api.bo3.gg/api/v1/matches?filter%5Bmatches.tournament_id%5D%5Beq%5D=\(id)"
            + "&page%5Blimit%5D=100&page%5Boffset%5D=\(offset)&with=teams")
    }

    /// Every match of a tournament, a page of 100 at a time (a 32-team Major passes 100).
    static func matchList(tournament id: Int) async throws -> [JSON] {
        var all: [JSON] = []
        var offset = 0
        while offset < 1000 {
            let page = try await JSON.fetch(matchesURL(tournament: id, offset: offset))
            let results = page["results"].array
            all += results
            offset += 100
            if results.isEmpty || offset >= (page["total"]["count"].int ?? 0) { break }
        }
        return all
    }

    /// A Swiss stage is typed "swiss" (ESL Pro League) or "group" (IEM).
    static func isSwiss(_ format: String) -> Bool { format == "swiss" || format == "group" }

    /// The stages and the match list made into a Swiss table and a playoff tree (pure).
    static func build(name: String, stageInfo: [(Int, String)], stages: [Int: JSON], matches list: [JSON]) -> TournamentBrackets {
        // Teams and live state from the match list (stages only carry IDs).
        var teams: [Int: BracketTeam] = [:]
        var live: Set<Int> = []
        for m in list {
            for key in ["team1", "team2"] {
                let t = m[key]
                if let tid = t["id"].int, let tname = t["name"].string {
                    teams[tid] = BracketTeam(id: String(tid), name: tname, abbreviation: CounterStrike.abbreviate(tname),
                                             logo: t["image_url"].string.flatMap(URL.init(string:)))
                }
            }
            if m["status"].string == "current", let mid = m["id"].int { live.insert(mid) }
        }

        var result = TournamentBrackets(title: name)
        var playoffs: [JSON] = []
        for (stageID, format) in stageInfo {
            guard let stage = stages[stageID] else { continue }
            if isSwiss(format), result.swiss == nil {
                result.swiss = swiss(stage, teams: teams)
            } else if format == "playoff" {
                playoffs.append(stage)
            }
        }
        // The biggest playoff stage is the tree; one-match stages (3rd place) sit under it.
        let sorted = playoffs.sorted { matchCount($0) > matchCount($1) }
        if let main = sorted.first {
            result.bracket = tree(main, teams: teams, live: live)
            for decider in sorted.dropFirst() {
                for round in decider["rounds"].array {
                    for m in round["matches"].array {
                        if let match = match(m, teams: teams, live: live) {
                            result.bracket?.extra.append((round["name"].string ?? "Decider", match))
                        }
                    }
                }
            }
        }
        return result
    }

    private static func matchCount(_ stage: JSON) -> Int {
        stage["rounds"].array.reduce(0) { $0 + $1["matches"].array.count }
    }

    static func match(_ m: JSON, teams: [Int: BracketTeam], live: Set<Int>) -> BracketMatch? {
        guard let id = m["id"].int else { return nil }
        var match = BracketMatch(id: String(id), top: m["team1_id"].int.flatMap { teams[$0] },
                                 bottom: m["team2_id"].int.flatMap { teams[$0] })
        let status = m["status"].string
        // Canceled and postponed matches weren't played: no score, no winner, say so.
        let called: String? = status == "canceled" ? "Canceled" : status == "postponed" ? "Postponed" : nil
        let started = status != "upcoming" && called == nil
        match.topScore = started ? m["team1_score"].int : nil
        match.bottomScore = started ? m["team2_score"].int : nil
        if called == nil, let w = m["winner_team_id"].int {
            match.winner = w == m["team1_id"].int ? .top : w == m["team2_id"].int ? .bottom : nil
        }
        match.live = called == nil && (live.contains(id) || status == "current")
        let bestOf = m["bo_type"].int.map { "Best of \($0)" }
        let date = m["start_date"].string.flatMap(DateParser.parse).map { When.dayAndTime($0) }
        match.note = [bestOf, called ?? (match.winner == nil ? date : nil)].compactMap { $0 }.joined(separator: " · ")
        return match
    }

    /// Rounds in order; match positions are a depth-first numbering of the
    /// tree (final 1, its first semi 2 with quarters 3 and 4, …).
    static func tree(_ stage: JSON, teams: [Int: BracketTeam], live: Set<Int>) -> Bracket? {
        let rounds = stage["rounds"].array.sorted { ($0["round_index"].int ?? 0) < ($1["round_index"].int ?? 0) }
        guard !rounds.isEmpty else { return nil }
        var matches: [String: BracketMatch] = [:]
        var depth: [String: Int] = [:]
        var positions: [String: Int] = [:]
        var byRound: [[String]] = []
        for (index, round) in rounds.enumerated() {
            var ids: [String] = []
            for m in round["matches"].array {
                guard let match = match(m, teams: teams, live: live) else { continue }
                matches[match.id] = match
                depth[match.id] = rounds.count - 1 - index
                if let p = m["position"].int { positions[match.id] = p }
                ids.append(match.id)
            }
            byRound.append(ids)
        }
        guard let finalID = byRound.last?.first else { return nil }

        if positions.count == matches.count {
            // Depth-first: each match is followed by its upper feeder's subtree, then the lower's.
            let order = matches.keys.sorted { positions[$0]! < positions[$1]! }
            var cursor = 0
            func parse(_ level: Int) -> String? {
                guard cursor < order.count, depth[order[cursor]] == level else { return nil }
                let id = order[cursor]
                cursor += 1
                if level < rounds.count - 1 {
                    // Parse both subtrees first: they write to `matches` too.
                    let upper = parse(level + 1)
                    let lower = parse(level + 1)
                    matches[id]?.feeders = [upper, lower].compactMap { $0 }
                }
                return id
            }
            _ = parse(0)
        } else {
            // No positions: pair matches in listed order.
            for r in 1..<byRound.count {
                for (k, id) in byRound[r].enumerated() {
                    matches[id]?.feeders = Array(byRound[r - 1].dropFirst(2 * k).prefix(2))
                }
            }
        }
        return Bracket(rounds: rounds.map { $0["name"].string ?? "" }, matches: matches, finalID: finalID)
    }

    /// Every team's result each round, from the stage's matches.
    static func swiss(_ stage: JSON, teams: [Int: BracketTeam]) -> SwissStage? {
        let rounds = stage["rounds"].array.sorted { ($0["round_index"].int ?? 0) < ($1["round_index"].int ?? 0) }
        guard !rounds.isEmpty else { return nil }
        var results: [Int: [Bool?]] = [:]
        var opponents: [Int: [BracketTeam?]] = [:]
        for (index, round) in rounds.enumerated() {
            for m in round["matches"].array {
                for (key, other) in [("team1_id", "team2_id"), ("team2_id", "team1_id")] {
                    guard let team = m[key].int else { continue }
                    var row = results[team] ?? Array(repeating: nil, count: rounds.count)
                    if let w = m["winner_team_id"].int { row[index] = w == team }
                    results[team] = row
                    var faced = opponents[team] ?? Array(repeating: nil, count: rounds.count)
                    faced[index] = m[other].int.flatMap { teams[$0] }
                    opponents[team] = faced
                }
            }
        }
        let rows = results.compactMap { id, r in
            teams[id].map { SwissStage.Row(team: $0, results: r, opponents: opponents[id] ?? []) }
        }
        guard !rows.isEmpty else { return nil }
        return SwissStage(rounds: rounds.count, rows: rows, winsToAdvance: (rounds.count + 1) / 2)
    }
}

// MARK: - Layout

/// Where each matchup sits: columns by round, final at the right; first-round
/// matchups evenly spaced, every later one centered on the matchups feeding it.
struct BracketLayout {
    struct Slot { let column: Int; let center: CGFloat }
    let slots: [String: Slot]
    let height: CGFloat

    static let cellHeight: CGFloat = 38
    static let spacing: CGFloat = 10

    init(_ bracket: Bracket) {
        var slots: [String: Slot] = [:]
        var nextLeaf: CGFloat = 0
        let columns = bracket.rounds.count
        func place(_ id: String, column: Int) -> CGFloat {
            let feeders = bracket.matches[id]?.feeders ?? []
            let center: CGFloat
            if feeders.isEmpty || column == 0 {
                center = nextLeaf * (Self.cellHeight + Self.spacing) + Self.cellHeight / 2
                nextLeaf += 1
            } else {
                let centers = feeders.map { place($0, column: column - 1) }
                center = (centers.first! + centers.last!) / 2
            }
            slots[id] = Slot(column: column, center: center)
            return center
        }
        _ = place(bracket.finalID, column: columns - 1)
        self.slots = slots
        height = max(nextLeaf * (Self.cellHeight + Self.spacing) - Self.spacing, Self.cellHeight)
    }
}

// MARK: - Bracket view

/// The tree: round names over their columns, connector lines from each
/// matchup to the one its winner plays in (the winner's path drawn stronger),
/// and a readout of the pointed-at matchup underneath. Columns share the
/// width up to `maxCell` each; past that the tree and its footer center as a
/// unit. Cells wide enough show team names instead of abbreviations. Below
/// `minCell` (a 32-team bracket at 340) the tree keeps that width and scrolls
/// sideways, opening on the round being played.
///
/// Each matchup is its own VoiceOver element, in round order, and the
/// "Rounds" rotor jumps between rounds.
struct BracketView: View {
    let bracket: Bracket
    /// Team IDs of the match the page was opened from; their matchups are ringed.
    var highlight: Set<String> = []
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?
    @State private var localHover: String?
    /// Whether the tree's cells show names; the extra matchups follow it.
    @State private var extraNames = false
    @Namespace private var rotor
    /// Where every matchup sits: worked out once, never on a hover.
    private let layout: BracketLayout

    init(bracket: Bracket, highlight: Set<String> = []) {
        self.bracket = bracket
        self.highlight = highlight
        layout = BracketLayout(bracket)
    }

    nonisolated static let gap: CGFloat = 12
    private static let header: CGFloat = 16
    /// Widest a matchup gets: wider only spreads two short rows apart.
    nonisolated static let maxCell: CGFloat = 180
    /// Narrowest a matchup gets: a crest, a four-letter code and a score.
    /// Below it the tree scrolls rather than squeezing names to "…".
    nonisolated static let minCell: CGFloat = 96
    /// From here a cell has room for "White Sox" or "Natus Vincere".
    nonisolated static let namesFrom: CGFloat = 120

    /// Each round's column width in `width` of room.
    nonisolated static func cellWidth(in width: CGFloat, rounds: Int) -> CGFloat {
        let n = CGFloat(max(rounds, 1))
        return min((width - gap * (n - 1)) / n, maxCell)
    }

    /// The tree at its widest: `maxCell` columns and their gaps.
    nonisolated static func maxWidth(rounds: Int) -> CGFloat {
        treeWidth(cell: maxCell, rounds: rounds)
    }

    nonisolated static func treeWidth(cell: CGFloat, rounds: Int) -> CGFloat {
        let n = CGFloat(max(rounds, 1))
        return cell * n + gap * (n - 1)
    }

    /// The round a scrolled tree opens on: the one being played, else the
    /// latest with a result, else the first. (pure; tested)
    static func focusColumn(_ bracket: Bracket, layout: BracketLayout) -> Int {
        let live = bracket.matches.values.filter(\.live).compactMap { layout.slots[$0.id]?.column }.max()
        let decided = bracket.matches.values.filter { $0.winner != nil }.compactMap { layout.slots[$0.id]?.column }.max()
        return live ?? decided ?? 0
    }

    /// A matchup between the teams of the match the page was opened from.
    private func ringed(_ match: BracketMatch) -> Bool {
        guard !highlight.isEmpty else { return false }
        return [match.top?.id, match.bottom?.id].compactMap { $0 }.filter(highlight.contains).count == min(2, highlight.count)
    }

    /// Matchups in reading order: round by round, top to bottom.
    private var ordered: [(id: String, slot: BracketLayout.Slot)] {
        layout.slots.map { (id: $0.key, slot: $0.value) }
            .sorted { ($0.slot.column, $0.slot.center) < ($1.slot.column, $1.slot.center) }
    }

    var body: some View {
        let rounds = bracket.rounds.count
        // Only without a page focus (no `LinkedFocus`) does the view keep its own hover.
        let local = linked == nil ? localHover : nil
        let ordered = ordered
        VStack(alignment: .leading, spacing: 0) {
            GeometryReader { geo in
                let fitted = Self.cellWidth(in: geo.size.width, rounds: rounds)
                if fitted >= Self.minCell {
                    tree(cell: fitted, local: local, ordered: ordered)
                } else {
                    let column = Self.focusColumn(bracket, layout: layout)
                    ScrollView(.horizontal) {
                        tree(cell: Self.minCell, local: local, ordered: ordered)
                    }
                    .defaultScrollAnchor(UnitPoint(x: rounds > 1 ? CGFloat(column) / CGFloat(rounds - 1) : 0, y: 0))
                }
            }
            .frame(height: Self.header + layout.height)
            // The readout reads the focus, not the tree: a hover redraws the footer only.
            FocusReader { focus in
                ChartFooter(readout: (linked == nil ? local : focus?.play).flatMap { bracket.matches[$0] }.map(readout)) {
                    VizLegend {
                        if bracket.matches.values.contains(where: ringed) {
                            LegendItem(label: "This matchup") {
                                RoundedRectangle(cornerRadius: 3).strokeBorder(Color.accentColor, lineWidth: 1.5).frame(width: 12, height: 9)
                            }
                        }
                        LegendItem(label: "Winner's path") { Rectangle().fill(Viz.reference).frame(width: 12, height: 1.25) }
                    }
                }
            }
            ForEach(Array(bracket.extra.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title).font(Viz.tick).foregroundStyle(.secondary)
                    // Names when the tree shows them, so the two read alike.
                    BracketCell(match: item.match, ringed: false, hovered: false, names: extraNames)
                        .frame(width: 150, height: BracketLayout.cellHeight)
                }
                .padding(.top, 12)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Self.spoken(item.match, round: item.title))
            }
        }
        // Coarse (a Bool), so this writes only when the cells cross `namesFrom`.
        .onGeometryChange(for: Bool.self) { proxy in
            Self.cellWidth(in: proxy.size.width, rounds: rounds) >= Self.namesFrom
        } action: { extraNames = $0 }
        // Capped, the tree and its footer center together (the chart-unit rule).
        .frame(maxWidth: Self.maxWidth(rounds: rounds))
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(accessibilityText)
        .accessibilityRotor("Rounds") {
            ForEach(Array(bracket.rounds.enumerated()), id: \.offset) { column, name in
                if let first = ordered.first(where: { $0.slot.column == column }) {
                    AccessibilityRotorEntry(Text(name), id: first.id, in: rotor)
                }
            }
        }
    }

    /// The round names, the connectors and the cells, at one cell width.
    private func tree(cell: CGFloat, local: String?, ordered: [(id: String, slot: BracketLayout.Slot)]) -> some View {
        let names = cell >= Self.namesFrom
        let x = { (column: Int) in CGFloat(column) * (cell + Self.gap) }
        let rounds = bracket.rounds.count
        return ZStack(alignment: .topLeading) {
            ForEach(Array(bracket.rounds.enumerated()), id: \.offset) { index, name in
                Text(name)
                    .font(Viz.tick)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .frame(width: cell, alignment: .leading)
                    .offset(x: x(index))
                    .accessibilityHidden(true)
            }
            Canvas { context, _ in
                for (id, slot) in layout.slots {
                    guard let match = bracket.matches[id] else { continue }
                    for feeder in match.feeders {
                        guard let from = layout.slots[feeder], let feederMatch = bracket.matches[feeder] else { continue }
                        let start = CGPoint(x: x(from.column) + cell, y: Self.header + from.center)
                        let end = CGPoint(x: x(slot.column), y: Self.header + slot.center)
                        var path = Path()
                        path.move(to: start)
                        path.addLine(to: CGPoint(x: start.x + Self.gap / 2, y: start.y))
                        path.addLine(to: CGPoint(x: start.x + Self.gap / 2, y: end.y))
                        path.addLine(to: end)
                        // A decided matchup's line carries its winner forward.
                        let decided = feederMatch.winner != nil
                        context.stroke(path, with: .color(decided ? Viz.reference : Viz.markings), lineWidth: decided ? 1.25 : 1)
                    }
                }
            }
            .accessibilityHidden(true)
            ForEach(Array(ordered.enumerated()), id: \.element.id) { index, item in
                if let match = bracket.matches[item.id] {
                    // Each cell reads the focus itself: a hover re-runs the two
                    // cells it lights, never the tree, its lines or its footer.
                    FocusReader { focus in
                        BracketCell(match: match, ringed: ringed(match), hovered: (linked == nil ? local : focus?.play) == item.id,
                                    names: names)
                    }
                    .frame(width: cell, height: BracketLayout.cellHeight)
                    .contentShape(Rectangle())
                    .onHover { hover(item.id, $0) }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Self.spoken(match, round: bracket.rounds.indices.contains(item.slot.column)
                                                    ? bracket.rounds[item.slot.column] : ""))
                    .accessibilityRotorEntry(id: item.id, in: rotor)
                    // Round by round, top to bottom.
                    .accessibilitySortPriority(Double(ordered.count - index))
                    .offset(x: x(item.slot.column), y: Self.header + item.slot.center - BracketLayout.cellHeight / 2)
                }
            }
        }
        .frame(width: Self.treeWidth(cell: cell, rounds: rounds), height: Self.header + layout.height, alignment: .topLeading)
    }

    private func hover(_ id: String, _ inside: Bool) {
        if let linked {
            linked.hover(Focus(play: id), inside)
        } else if inside {
            // Hover is instant (the house rule).
            localHover = id
        } else if localHover == id {
            localHover = nil
        }
    }

    private func readout(_ match: BracketMatch) -> (lead: String, detail: String) {
        let names = [match.top?.name ?? "TBD", match.bottom?.name ?? "TBD"].joined(separator: " v ")
        let score = match.topScore.flatMap { t in match.bottomScore.map { "\(t)–\($0)" } }
        return (score ?? names, [score == nil ? nil : names, match.note].compactMap { $0 }.joined(separator: " · "))
    }

    /// "Quarterfinals: Yankees 3, Guardians 1. Yankees won." / "…, live." /
    /// "Semifinals: to be decided." (pure; tested)
    static func spoken(_ match: BracketMatch, round: String) -> String {
        let prefix = round.isEmpty ? "" : "\(round): "
        guard let top = match.top, let bottom = match.bottom else {
            let known = [match.top?.name, match.bottom?.name].compactMap { $0 }
            return prefix + (known.isEmpty ? "to be decided." : "\(known[0]) versus to be decided.")
        }
        var line = prefix
        if let t = match.topScore, let b = match.bottomScore {
            line += "\(top.name) \(t), \(bottom.name) \(b)."
        } else {
            line += "\(top.name) versus \(bottom.name)."
        }
        if let winner = match.winner {
            line += " \((winner == .top ? top : bottom).name) won."
        } else if match.live {
            line += " Live."
        }
        if let note = match.note { line += " \(note)." }
        return line
    }

    private var accessibilityText: String {
        let final = bracket.matches[bracket.finalID]
        let teams = [final?.top?.name, final?.bottom?.name].compactMap { $0 }
        return "Bracket, \(plural(bracket.rounds.count, "round")). Final: " + (teams.isEmpty ? "to be decided" : teams.joined(separator: " versus "))
    }
}

/// One matchup: two rows, crest, short name and maps or games won; the winner
/// in full weight, the loser stepping back; a live matchup marked.
private struct BracketCell: View {
    let match: BracketMatch
    let ringed: Bool
    let hovered: Bool
    /// Team names rather than abbreviations (the cell is wide enough).
    var names = false

    var body: some View {
        VStack(spacing: 0) {
            row(match.top, match.topScore, side: .top)
            Rectangle().fill(Viz.grid).frame(height: 0.5)
            row(match.bottom, match.bottomScore, side: .bottom)
        }
        .padding(.horizontal, 6)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous)
            .fill(Color.primary.opacity(hovered ? 0.09 : 0.045)))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous)
            .strokeBorder(ringed ? Color.accentColor : Color.primary.opacity(0.08), lineWidth: ringed ? 1.5 : 0.5))
        .overlay(alignment: .topTrailing) {
            if match.live { LiveDot().offset(x: 3, y: -3) }
        }
    }

    private func row(_ team: BracketTeam?, _ score: Int?, side: GameDetail.Side) -> some View {
        let lost = match.winner != nil && match.winner != side
        return HStack(spacing: 4) {
            if let team {
                LogoView(url: team.logo, size: 12)
            } else {
                Circle().fill(Viz.track).frame(width: 12, height: 12)
            }
            Text((names ? team?.name : team?.abbreviation) ?? "TBD")
                .font(.system(size: 10.5, weight: match.winner == side ? .semibold : .regular))
                .foregroundStyle(team == nil || lost ? .secondary : .primary)
                .lineLimit(1)
                // Abbreviations may shrink a little; names keep their size and truncate.
                .minimumScaleFactor(names ? 1 : 0.8)
                .truncationMode(.tail)
            Spacer(minLength: 2)
            if let score {
                Text("\(score)")
                    .font(.system(size: 10.5, weight: match.winner == side ? .semibold : .regular).monospacedDigit())
                    .foregroundStyle(lost ? .secondary : .primary)
            }
        }
        .frame(height: (BracketLayout.cellHeight - 0.5) / 2)
        .help(team?.name ?? "")
    }
}

// MARK: - Swiss stage

/// The Swiss stage as a ladder: each team's result every round (filled won,
/// outlined lost, faint still to play), record, and whether it went through.
/// From large, each round also shows who it was against.
struct SwissLadder: View {
    let stage: SwissStage
    var highlight: Set<String> = []
    @Environment(\.widthClass) private var widthClass

    private var showsOpponents: Bool { widthClass >= .large && stage.rows.contains { !$0.opponents.isEmpty } }
    /// A round's column: the chip, plus the opponent's crest when shown.
    private var roundWidth: CGFloat { showsOpponents ? 34 : 16 }

    private var rows: [SwissStage.Row] {
        stage.rows.sorted { a, b in
            if a.wins != b.wins { return a.wins > b.wins }
            if a.losses != b.losses { return a.losses < b.losses }
            return a.team.name < b.team.name
        }
    }

    /// The record-and-outcome column: as wide as its widest entry ("3–1
    /// Through"), the same in every row, so the round chips line up. The
    /// team names give way, never the outcome.
    private var statusWidth: CGFloat {
        let record = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .semibold), word = NSFont.systemFont(ofSize: 10)
        let widest = rows.map { row -> CGFloat in
            let r = ("\(row.wins)–\(row.losses)" as NSString).size(withAttributes: [.font: record]).width
            let outcome = outcome(row).map { ($0 as NSString).size(withAttributes: [.font: word]).width + 4 } ?? 0
            return r + outcome
        }.max() ?? 0
        return max(62, widest.rounded(.up) + 2)
    }

    /// "Through", "Out", or nothing yet.
    private func outcome(_ row: SwissStage.Row) -> String? {
        row.wins >= stage.winsToAdvance ? "Through" : row.losses >= stage.winsToAdvance ? "Out" : nil
    }

    var body: some View {
        let statusWidth = statusWidth
        StackColumn(spacing: 5) {
            HStack(spacing: 6) {
                Text("Team").frame(maxWidth: .infinity, alignment: .leading)
                ForEach(1...stage.rounds, id: \.self) { Text("R\($0)").frame(width: roundWidth) }
                Text("").frame(width: statusWidth)
            }
            .accessibilityHidden(true)
            .font(Viz.tick)
            .foregroundStyle(.secondary)
            ForEach(rows) { row in
                let mine = highlight.contains(row.team.id)
                HStack(spacing: 6) {
                    HStack(spacing: 6) {
                        LogoView(url: row.team.logo, size: 14)
                        Text(row.team.name).font(.system(size: 11.5, weight: mine ? .semibold : .regular)).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    ForEach(Array(row.results.enumerated()), id: \.offset) { index, result in
                        if showsOpponents {
                            roundCell(result, against: row.opponents.indices.contains(index) ? row.opponents[index] : nil, index: index)
                        } else {
                            chip(result)
                        }
                    }
                    status(row).fixedSize().frame(width: statusWidth, alignment: .trailing)
                }
                .padding(.vertical, 2)
                .padding(.horizontal, 6)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(mine ? Viz.highlight : .clear))
                .padding(.horizontal, -6)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(accessibilityText(row))
            }
            VizLegend {
                LegendItem(label: "Won") { chip(true) }
                LegendItem(label: "Lost") { chip(false) }
                LegendItem(label: "To play") { chip(nil) }
            }
        }
    }

    private func accessibilityText(_ row: SwissStage.Row) -> String {
        var parts = ["\(row.team.name), \(plural(row.wins, "win")), \(plural(row.losses, "loss"))"]
        if let outcome = outcome(row) { parts.append(outcome == "Through" ? "through" : "out") }
        if showsOpponents {
            for (result, team) in zip(row.results, row.opponents) {
                guard let team else { continue }
                parts.append(result == true ? "beat \(team.name)" : result == false ? "lost to \(team.name)" : "plays \(team.name) next")
            }
        }
        return parts.joined(separator: ", ")
    }

    /// The result chip and the opponent's crest, faint until it's played.
    private func roundCell(_ result: Bool?, against team: BracketTeam?, index: Int) -> some View {
        HStack(spacing: 2) {
            chip(result)
            Group {
                if let team { LogoView(url: team.logo, size: 14) } else { Color.clear }
            }
            .frame(width: 14, height: 14)
            .opacity(result == nil ? Viz.receded : 1)
        }
        .frame(width: roundWidth)
        .help(team.map { t in
            "Round \(index + 1): " + (result == true ? "beat \(t.name)" : result == false ? "lost to \(t.name)" : "plays \(t.name)")
        } ?? "Round \(index + 1)")
    }

    private func chip(_ result: Bool?) -> some View {
        RoundedRectangle(cornerRadius: 3, style: .continuous)
            .fill(result == true ? Viz.neutral : Color.clear)
            .overlay(RoundedRectangle(cornerRadius: 3, style: .continuous)
                .strokeBorder(result == nil ? Viz.track : Viz.neutral, lineWidth: result == true ? 0 : 1))
            .frame(width: 12, height: 12)
            .frame(width: 16)
    }

    @ViewBuilder
    private func status(_ row: SwissStage.Row) -> some View {
        let record = Text("\(row.wins)–\(row.losses)").font(.system(size: 11, weight: .semibold).monospacedDigit())
        if row.wins >= stage.winsToAdvance {
            HStack(spacing: 4) { record; Text("Through").font(.system(size: 10)).foregroundStyle(Color.accentColor) }
        } else if row.losses >= stage.winsToAdvance {
            HStack(spacing: 4) { record.foregroundStyle(.secondary); Text("Out").font(.system(size: 10)).foregroundStyle(.secondary) }
        } else {
            record
        }
    }
}

// MARK: - Page

/// A tournament's full picture, one level below a match: the Swiss stage if
/// there is one, then the playoff tree.
struct BracketPage: View {
    @Environment(\.stackArrival) private var page
    let source: BracketSource
    let backTitle: String
    /// Team IDs of the match this was opened from.
    var highlight: Set<String> = []
    let onBack: () -> Void
    @State private var data: TournamentBrackets?
    @State private var failed = false
    @State private var showSpinner = false
    @State private var arrival: StackArrival?
    @State private var linked = LinkedFocus()

    private static let contentSpace = "bracket.content"

    var body: some View {
        VStack(spacing: 0) {
            PageHeader(data?.title ?? source.title) {
                BackButton(title: backTitle, action: onBack)
            }
            .stackIn()
            .pageChrome()

            PageScrollView(keyboardScrolls: true) {
                StackColumn {
                    if let data {
                        if let swiss = data.swiss {
                            DetailSection(title: "Swiss Stage",
                                          caption: "\(swiss.winsToAdvance) wins go through, \(swiss.winsToAdvance) losses go home.") {
                                SwissLadder(stage: swiss, highlight: highlight)
                            }
                        }
                        if let bracket = data.bracket {
                            DetailSection(title: data.swiss == nil ? "Bracket" : "Playoffs",
                                          caption: caption(for: bracket)) {
                                BracketView(bracket: bracket, highlight: highlight)
                            }
                        }
                        if data.swiss == nil && data.bracket == nil {
                            EmptyState(symbol: "trophy", title: "No Bracket Yet",
                                       message: "The bracket appears once the matchups are set.")
                        }
                    } else if failed {
                        ErrorState("Bracket") { Task { await load() } }
                    } else if showSpinner {
                        PageSpinner("Loading bracket")
                    }
                }
                .coordinateSpace(name: Self.contentSpace)
                .environment(\.stackArrival, arrival ?? page)
                .environment(linked)
                .onHover { inside in if !inside { linked.clear() } }
                .padding(.bottom, 14)
            }
        }
        .pageLoading(data == nil && !failed)
        // Only a load that takes long enough to notice shows a spinner.
        .delayedSpinner(while: data == nil && !failed, show: $showSpinner)
        .task(id: source) { await load() }
    }

    /// Loads the brackets (again, from Try Again).
    private func load() async {
        if failed { failed = false }
        let loaded = try? await BracketProvider.load(source)
        guard !Task.isCancelled else { return }
        // The bracket assembles like a page entrance.
        arrival = .data(in: Self.contentSpace, page: page)
        data = loaded
        failed = loaded == nil
    }

    private func caption(for bracket: Bracket) -> String {
        switch source {
        case .espnPostseason: "Series wins in each matchup. Lines carry each winner to the next round."
        case .csTournament: "Maps won in each match. Lines carry each winner to the next round."
        }
    }
}
