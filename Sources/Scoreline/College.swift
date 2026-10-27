import SwiftUI

// College football: the AP Top 25 (and Coaches Poll), and conference tables.

// MARK: - Polls

struct Poll: Identifiable, Equatable {
    struct Entry: Identifiable, Equatable {
        let rank: Int
        /// Last week's rank; nil when the team wasn't ranked.
        let previous: Int?
        let teamID: String
        let name: String
        let logo: URL?
        let record: String?
        let points: Int?
        let firstPlaceVotes: Int?
        var id: String { teamID }
        /// Places gained since last week (negative: lost).
        var movement: Int? { previous.map { $0 - rank } }
    }
    let name: String          // "AP Top 25"
    let headline: String?     // "AP Poll: Week 9"
    let entries: [Entry]
    var id: String { name }
}

enum Rankings {
    static func fetch(path: String) async throws -> [Poll] {
        if let cached = await RankingsCache.shared.polls(for: path) { return cached }
        let json = try await JSON.fetch(URL.api("https://site.api.espn.com/apis/site/v2/sports/\(path)/rankings"))
        let polls = parse(json, path: path)
        await RankingsCache.shared.store(polls, for: path)
        return polls
    }

    static func parse(_ json: JSON, path: String) -> [Poll] {
        json["rankings"].array.compactMap { poll -> Poll? in
            guard let name = poll["name"].string else { return nil }
            let entries = poll["ranks"].array.compactMap { r -> Poll.Entry? in
                guard let rank = r["current"].int, let id = r["team"]["id"].string else { return nil }
                let previous = r["previous"].int.flatMap { $0 > 0 ? $0 : nil }
                return Poll.Entry(rank: rank, previous: previous, teamID: ESPNTeamID.make(path: path, sport: .football, team: id),
                                  name: r["team"]["location"].string ?? r["team"]["name"].string ?? "",
                                  logo: r["team"]["logos"][0]["href"].string.flatMap(URL.init(string:))
                                      ?? r["team"]["logo"].string.flatMap(URL.init(string:)),
                                  record: r["recordSummary"].string,
                                  points: r["points"].double.map { Int($0) }, firstPlaceVotes: r["firstPlaceVotes"].int)
            }
            return entries.isEmpty ? nil : Poll(name: name, headline: poll["shortHeadline"].string, entries: entries)
        }
    }
}

/// Polls come out once a week; ten minutes of reuse is plenty fresh.
private actor RankingsCache {
    static let shared = RankingsCache()
    private var entries: [String: (date: Date, polls: [Poll])] = [:]

    func polls(for path: String) -> [Poll]? {
        guard let entry = entries[path], Date().timeIntervalSince(entry.date) < 600 else { return nil }
        return entry.polls
    }

    func store(_ polls: [Poll], for path: String) { entries[path] = (.now, polls) }
}

// MARK: - Conferences

enum CollegeConferences {
    /// The Power Four, in the order they're usually listed. ESPN's short names.
    static let power = ["SEC", "Big Ten", "ACC", "Big 12"]

    /// Conferences in the order a list shows them: the Power Four first, in
    /// their usual order, then the rest as the standings give them.
    static func order(_ names: [String]) -> [String] {
        var seen = Set<String>()
        let unique = names.filter { seen.insert($0).inserted }
        return power.filter(unique.contains) + unique.filter { !power.contains($0) }
    }

    /// Teams by conference (in `order`), alphabetical within each; teams
    /// with no conference last.
    static func byConference(_ options: [TeamOption]) -> [TeamOption] {
        let rank = Dictionary(uniqueKeysWithValues: order(options.compactMap(\.group)).enumerated().map { ($1, $0) })
        return options.enumerated().sorted { a, b in
            let (ra, rb) = (a.element.group.flatMap { rank[$0] } ?? .max, b.element.group.flatMap { rank[$0] } ?? .max)
            if ra != rb { return ra < rb }
            let byName = a.element.name.localizedCaseInsensitiveCompare(b.element.name)
            return byName == .orderedSame ? a.offset < b.offset : byName == .orderedAscending
        }
        .map(\.element)
    }
}

// MARK: - Conference table

/// College standings: each conference (or division) as its own table, ranked
/// by conference record with the season record alongside; AP ranks before
/// names; a live score beside any team playing now.
///
/// Wider tables add columns, never bigger type: the streak from medium, home
/// and away records from large, points for and against from xlarge. Home,
/// away and points show only when the rows carry them (`details`).
struct ConferenceTable: View {
    let rows: [StandingsRow]
    var highlight: Set<String> = []
    /// Team ID → AP rank.
    var ranks: [String: Int] = [:]
    /// Team ID → "21–14", from its side, while its game is live.
    var live: [String: String] = [:]
    /// Just opened from its collapsed header: rows arrive top to bottom
    /// (the scores list's stagger) instead of all at once.
    var revealing = false
    @Environment(\.widthClass) private var width

    /// The columns this table shows at its width, given the data it has.
    struct Columns: Equatable {
        var streak = false
        var homeAway = false
        var points = false

        static func of(_ width: WidthClass, rows: [StandingsRow]) -> Columns {
            Columns(streak: width >= .medium && rows.contains { $0.streak != nil },
                    homeAway: width >= .large && rows.contains { $0.details[Key.home] != nil },
                    points: width >= .xlarge && rows.contains { $0.details[Key.pointsFor] != nil })
        }
    }

    /// ESPN's stat types, as the college standings parser keys them.
    enum Key {
        static let home = "homerecord", away = "awayrecord", pointsFor = "pointsfor", pointsAgainst = "pointsagainst"
    }

    var body: some View {
        let grouped = Set(rows.compactMap(\.group)).count > 1
        let columns = Columns.of(width, rows: rows)
        StackColumn {
            header(columns)
                .revealOnAppear(after: revealing ? ScoresGrid.revealDelay(index: 0, columns: 1) : nil)
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, r in
                if grouped, r.group != (index > 0 ? rows[index - 1].group : nil), let group = r.group {
                    Text(group)
                        .font(.system(size: 10.5, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 6)
                        .padding(.top, index == 0 ? 2 : 12)
                        .padding(.bottom, 3)
                        .accessibilityAddTraits(.isHeader)
                } else if index > 0, rows[index - 1].group == r.group, rows[index - 1].rank + 1 < r.rank {
                    // Rows skipped (a window around two teams): mark the gap.
                    Image(systemName: "ellipsis")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 10)
                        .help("Teams in between hidden")
                        .accessibilityHidden(true)
                }
                row(r, columns: columns)
                    .revealOnAppear(after: revealing ? ScoresGrid.revealDelay(index: index + 1, columns: 1) : nil)
            }
        }
    }

    private func header(_ columns: Columns) -> some View {
        HStack(spacing: 6) {
            Text("#").frame(width: 22, alignment: .leading).help("Place in the conference")
            Text("Team")
            Spacer()
            Text("Conf").frame(width: 40, alignment: .trailing).help("Conference record")
            Text("Overall").frame(width: 48, alignment: .trailing).help("Season record")
            if columns.homeAway {
                Text("Home").frame(width: 36, alignment: .trailing).help("Home record").widthDetail()
                Text("Away").frame(width: 36, alignment: .trailing).help("Away record").widthDetail()
            }
            if columns.points {
                Text("PF").frame(width: 30, alignment: .trailing).help("Points for").widthDetail()
                Text("PA").frame(width: 30, alignment: .trailing).help("Points against").widthDetail()
            }
            if columns.streak {
                Text("Strk").frame(width: 30, alignment: .trailing).help("Current streak").widthDetail()
            }
        }
        .font(.system(size: 9.5, weight: .semibold))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 6)
        .padding(.bottom, 4)
        .accessibilityHidden(true)
    }

    private func row(_ r: StandingsRow, columns: Columns) -> some View {
        let mine = highlight.contains(r.id)
        return HStack(spacing: 6) {
            Text("\(r.rank)")
                .font(.system(size: 11, weight: .semibold).monospacedDigit())
                .frame(width: 22, alignment: .leading)
            LogoView(url: r.logo, size: 15)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                if let rank = ranks[r.id] {
                    Text("\(rank)").font(.system(size: 9.5, weight: .semibold).monospacedDigit()).foregroundStyle(.secondary)
                        .help("No. \(rank) in the AP Top 25")
                }
                Text(r.name).font(.system(size: 12, weight: mine ? .semibold : .regular)).lineLimit(1)
            }
            if let score = live[r.id] {
                HStack(spacing: 3) {
                    LiveDot()
                    Text(score).font(.system(size: 9.5, weight: .semibold).monospacedDigit()).foregroundStyle(.red)
                }
                .help("Playing now")
            }
            Spacer(minLength: 4)
            Text(r.conference ?? "–").fontWeight(.semibold).frame(width: 40, alignment: .trailing)
            Text(r.overall ?? "–").foregroundStyle(.secondary).frame(width: 48, alignment: .trailing)
            Group {
                if columns.homeAway {
                    Text(r.details[Key.home] ?? "–").frame(width: 36, alignment: .trailing).widthDetail()
                    Text(r.details[Key.away] ?? "–").frame(width: 36, alignment: .trailing).widthDetail()
                }
                if columns.points {
                    Text(r.details[Key.pointsFor] ?? "–").frame(width: 30, alignment: .trailing).widthDetail()
                    Text(r.details[Key.pointsAgainst] ?? "–").frame(width: 30, alignment: .trailing).widthDetail()
                }
                // A streak is a fact, not a verdict: never coloured.
                if columns.streak {
                    Text(r.streak ?? "–").frame(width: 30, alignment: .trailing).widthDetail()
                }
            }
            .foregroundStyle(.secondary)
        }
        .font(.system(size: 11.5).monospacedDigit())
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(mine ? Viz.highlight : .clear))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText(r, columns: columns))
        // The row opens the team's page (hover fill, click, "Go to …").
        .teamRowLink(id: r.id, name: r.name, logo: r.logo, abbreviation: r.abbreviation)
    }

    private func accessibilityText(_ r: StandingsRow, columns: Columns) -> String {
        var parts = [Ordinal.string(r.rank) + ", " + r.name, ranks[r.id].map { "ranked \($0)" },
                     r.conference.map { "\($0) in conference" }, r.overall.map { "\($0) overall" }]
        if columns.homeAway {
            parts += [r.details[Key.home].map { "\($0) at home" }, r.details[Key.away].map { "\($0) away" }]
        }
        if columns.points {
            parts += [r.details[Key.pointsFor].map { "\($0) points for" }, r.details[Key.pointsAgainst].map { "\($0) against" }]
        }
        if columns.streak { parts.append(r.streak.map(RowText.spokenStreak)) }
        parts.append(live[r.id].map { "playing now, \($0)" })
        return parts.compactMap { $0 }.joined(separator: ", ")
    }

    /// Live scores by team, from each team's side ("21–14"), for the table.
    static func liveScores(_ events: [Event]) -> [String: String] {
        var scores: [String: String] = [:]
        for event in events where event.state == .live {
            guard case let .match(top, bottom) = event.content, let a = top.score, let b = bottom.score else { continue }
            if let id = top.id { scores[id] = "\(a)–\(b)" }
            if let id = bottom.id { scores[id] = "\(b)–\(a)" }
        }
        return scores
    }
}

// MARK: - Conference leader

/// A collapsed conference's one line: who leads it, with the season and
/// conference records ("Leader  UCLA  7–0 · 5–0 Conf"). The table ranks by
/// conference record, so the leader is its first row. Independents (no
/// conference games, ever) show the best record instead.
struct ConferenceLeaderLine: View {
    let row: StandingsRow
    /// AP rank, shown before the name as in the table.
    var rank: Int? = nil

    enum Kind: Equatable {
        /// Conference games played: the first row leads.
        case leader
        /// None (independents): the first row has the best season record.
        case bestRecord
        /// No games at all yet.
        case none
    }

    static func kind(_ row: StandingsRow) -> Kind {
        func games(_ record: String?) -> Int {
            (record ?? "").split(whereSeparator: { $0 == "-" || $0 == "–" }).compactMap { Int($0) }.reduce(0, +)
        }
        if games(row.conference) > 0 { return .leader }
        return games(row.overall) > 0 ? .bestRecord : .none
    }

    var body: some View {
        let kind = Self.kind(row)
        HStack(spacing: 5) {
            if kind == .none {
                Text("No games yet").foregroundStyle(.secondary)
            } else {
                Text(kind == .leader ? "Leader" : "Best Record").foregroundStyle(.secondary)
                LogoView(url: row.logo, size: 15)
                    .scaleEffect(14 / 15)
                    .frame(width: 14, height: 14)
                    .padding(.leading, 2)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    if let rank {
                        Text("\(rank)").font(.system(size: 9.5, weight: .semibold).monospacedDigit()).foregroundStyle(.secondary)
                    }
                    Text(row.name).lineLimit(1)
                }
                Text(records(kind)).foregroundStyle(.secondary).lineLimit(1).fixedSize()
            }
            Spacer(minLength: 0)
        }
        .font(.system(size: 11).monospacedDigit())
        .frame(minHeight: 16)
    }

    private func records(_ kind: Kind) -> String {
        [row.overall.map(RowText.record), kind == .leader ? row.conference.map { RowText.record($0) + " Conf" } : nil]
            .compactMap { $0 }.joined(separator: " · ")
    }

    /// "leader UCLA, ranked 4, 7 wins, 0 losses, 5 wins, 0 losses in conference".
    static func spoken(_ row: StandingsRow, rank: Int? = nil) -> String {
        let kind = kind(row)
        guard kind != .none else { return "no games yet" }
        return [kind == .leader ? "leader \(row.name)" : "best record \(row.name)", rank.map { "ranked \($0)" },
                row.overall.map { RowText.spokenRecord($0, soccer: false) },
                kind == .leader ? row.conference.map { RowText.spokenRecord($0, soccer: false) + " in conference" } : nil]
            .compactMap { $0 }.joined(separator: ", ")
    }
}

// MARK: - Poll list

/// The poll as a ranked list: movement since last week, crest, record, points
/// (first-place votes in parentheses).
struct PollList: View {
    let poll: Poll
    var highlight: Set<String> = []
    /// Two on a split panel: the poll reads down each column, as in print
    /// (1–13, then 14–25). The same rows either way, so none is rebuilt.
    var columns = 1

    var body: some View {
        StackContainer(layout: AnyLayout(ColumnFlow(columns: columns, spacing: 2, gap: 2 * Metrics.gutter))) {
            ForEach(poll.entries) { entry in
                let mine = highlight.contains(entry.teamID)
                HStack(spacing: 6) {
                    Text("\(entry.rank)")
                        .font(.system(size: 11, weight: .semibold).monospacedDigit())
                        .frame(width: 20, alignment: .trailing)
                    movement(entry).frame(width: 28, alignment: .leading)
                    LogoView(url: entry.logo, size: 15)
                    Text(entry.name).font(.system(size: 12, weight: mine ? .semibold : .regular)).lineLimit(1)
                    if let record = entry.record {
                        Text(record).font(.system(size: 10.5).monospacedDigit()).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 4)
                    if let points = entry.points {
                        Text(points.formatted() + (entry.firstPlaceVotes.flatMap { $0 > 0 ? " (\($0))" : nil } ?? ""))
                            .font(.system(size: 10.5).monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(mine ? Viz.highlight : .clear))
                .padding(.horizontal, -6)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(accessibilityText(entry))
            }
        }
    }

    @ViewBuilder
    private func movement(_ entry: Poll.Entry) -> some View {
        if let move = entry.movement, move != 0 {
            HStack(spacing: 2) {
                Image(systemName: move > 0 ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill").font(.system(size: 6))
                Text("\(abs(move))")
            }
            .font(.system(size: 9.5, weight: .semibold).monospacedDigit())
            .foregroundStyle(move > 0 ? .green : .red)
            .help(move > 0 ? "Up \(move) from last week" : "Down \(-move) from last week")
        } else if entry.previous == nil {
            Text("NEW").font(.system(size: 8.5, weight: .bold)).tracking(0.3).foregroundStyle(Color.accentColor)
                .help("Not ranked last week")
        } else {
            Text("–").font(.system(size: 10)).foregroundStyle(.secondary).help("Same as last week")
        }
    }

    private func accessibilityText(_ e: Poll.Entry) -> String {
        let move: String = e.previous == nil ? "new this week"
            : e.movement.map { $0 > 0 ? "up \($0)" : $0 < 0 ? "down \(-$0)" : "unchanged" } ?? ""
        return ["Number \(e.rank)", e.name, e.record, move, e.points.map { "\($0) points" }].compactMap { $0 }.joined(separator: ", ")
    }
}

// MARK: - Rankings page

/// The polls, one level below the scores or a match: AP Top 25 and the
/// Coaches Poll, switchable.
struct RankingsView: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.stackArrival) private var page
    @Environment(\.panelLayout) private var layout
    let league: League
    let backTitle: String
    /// Team IDs to highlight (the match this was opened from).
    var highlight: Set<String> = []
    let onBack: () -> Void
    @State private var polls: [Poll] = []
    @State private var selected: String?
    @State private var loading = true
    /// The polls couldn't be fetched (as opposed to none published yet).
    @State private var failed = false
    @State private var showSpinner = false
    @State private var arrival: StackArrival?

    private static let contentSpace = "rankings.content"

    private var poll: Poll? { polls.first { $0.name == selected } ?? polls.first }

    var body: some View {
        VStack(spacing: 0) {
            PageHeader("Top 25") {
                BackButton(title: backTitle, action: onBack)
            }
            .stackIn()
            .pageChrome()

            // Arrows, Page Up/Down, Space, Home and End scroll the polls.
            PageScrollView(keyboardScrolls: true) {
                StackColumn {
                    if let poll {
                        if polls.count > 1 {
                            Picker("Poll", selection: Binding(get: { poll.name }, set: { selected = $0 })) {
                                ForEach(polls) { poll in
                                    // "AP Top 25" → "AP", "AFCA Coaches Poll" → "Coaches".
                                    Text(poll.name.contains("Coaches") ? "Coaches" : poll.name.replacingOccurrences(of: " Top 25", with: ""))
                                        .tag(poll.name)
                                }
                            }
                            .pickerStyle(.segmented)
                            .controlSize(.small)
                            .labelsHidden()
                            .fixedSize()
                            .padding(.horizontal, Metrics.gutter)
                            .padding(.top, 6)
                        }
                        DetailSection(title: poll.headline ?? poll.name,
                                      caption: "Arrows show moves since last week. Points, first-place votes in parentheses.") {
                            PollList(poll: poll, highlight: highlight.union(store.followed.map(\.id)), columns: layout.columns)
                        }
                    } else if failed {
                        ErrorState("Rankings") { Task { await load() } }
                    } else if !loading {
                        EmptyState(symbol: "list.number", title: "No Rankings Yet",
                                   message: "This week's polls haven't been published yet.")
                    } else if showSpinner {
                        PageSpinner("Loading rankings")
                    }
                }
                .coordinateSpace(name: Self.contentSpace)
                .environment(\.stackArrival, arrival ?? page)
                .padding(.bottom, 14)
            }
        }
        .pageLoading(loading)
        // Only a load that takes long enough to notice shows a spinner.
        .delayedSpinner(while: loading, show: $showSpinner)
        .task(id: league.id) { await load() }
    }

    /// The polls (again, from Try Again).
    private func load() async {
        loading = true
        failed = false
        guard case let .espn(path, _) = league.source else { loading = false; return }
        let loaded: [Poll]?
        do { loaded = try await Rankings.fetch(path: path) } catch { loaded = nil }
        guard !Task.isCancelled else { return }
        arrival = .data(in: Self.contentSpace, page: page)
        polls = loaded ?? []
        failed = loaded == nil
        loading = false
    }
}
