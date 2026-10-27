import SwiftUI

/// A league's full table, re-ranked live from games in progress. College's
/// dozen conference tables read as an outline: each collapsed to its header
/// and its leader, open where a team is yours (followed, or in the match it
/// was opened from).
struct StandingsView: View {
    @Environment(ScoreStore.self) private var store
    /// How this page was entered: decides whether the table stacks or fades in.
    @Environment(\.stackArrival) private var page
    /// Split panel: grouped tables (conferences, groups) sit in two columns.
    @Environment(\.panelLayout) private var layout
    @Environment(\.panelResizing) private var resizing
    let league: League
    let backTitle: String
    /// The teams of the match this was opened from: their conferences come
    /// first, open, with the teams highlighted.
    var focus: Set<String> = []
    let onBack: () -> Void
    @State private var rows: [StandingsRow] = []
    @State private var loading = true
    /// The table couldn't be fetched (as opposed to a league with no table yet).
    @State private var failed = false
    @State private var showSpinner = false
    @State private var arrival: StackArrival?
    /// College: AP ranks by team ID, shown before names.
    @State private var ranks: [String: Int] = [:]
    /// College: each conference's open state, remembered for the session.
    @State private var disclosure = DisclosureGroups()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var isCollege: Bool { league.id == "college-football" }

    /// College conferences of the match first, then those with a followed
    /// team; the rest keep ESPN's order.
    private var collegeRows: [StandingsRow] {
        let mine = Set(store.followed.map(\.id))
        let match = Set(rows.filter { focus.contains($0.id) }.compactMap(\.group))
        let followed = Set(rows.filter { mine.contains($0.id) }.compactMap(\.group)).subtracting(match)
        func among(_ groups: Set<String>) -> [StandingsRow] { rows.filter { groups.contains($0.group ?? "") } }
        return among(match) + among(followed) + rows.filter { !match.contains($0.group ?? "") && !followed.contains($0.group ?? "") }
    }

    private static let contentSpace = "standings.content"

    var body: some View {
        VStack(spacing: 0) {
            // A long league name moves into the room beside Back and truncates.
            PageHeader(league.name) {
                BackButton(title: backTitle, action: onBack)
            }
            .stackIn()
            .pageChrome()

            // Arrows, Page Up/Down, Space, Home and End scroll the table.
            PageScrollView(keyboardScrolls: true) {
                StackColumn {
                    if loading && rows.isEmpty {
                        if showSpinner { PageSpinner("Loading table") }
                    } else if failed {
                        ErrorState("Table") { Task { await load() } }
                    } else if rows.isEmpty {
                        EmptyState(symbol: "list.number", title: "No Table Yet",
                                   message: "\(league.name) hasn't published a table yet.")
                    } else if isCollege {
                        let live = ConferenceTable.liveScores(store.liveEvents(in: league))
                        let groups = TableGroup.make(collegeRows) { $0.group }
                        let highlight = followedIDs.union(focus)
                        if layout.split && groups.count > 1 {
                            GroupColumns(groups: groups, titles: false) { group in
                                conference(group, highlight: highlight, live: live)
                            }
                            .environment(\.widthClass, layout.column)
                        } else {
                            ForEach(groups) { group in
                                conference(group, highlight: highlight, live: live)
                            }
                        }
                    } else if league.id == "nba" {
                        // Both conferences by seed, re-ranked if live scores held.
                        let live = NBAStandings.project(rows, liveEvents: store.liveEvents(in: league))
                        if live.contains(where: { $0.liveScore != nil }) {
                            projectedNote("Projected if live scores hold. Arrows show moves from the official seeding.")
                        }
                        let groups = TableGroup.make(live) { $0.row.group }
                        if layout.split && groups.count > 1 {
                            GroupColumns(groups: groups) { group in
                                NBAStandingsTable(rows: group.rows, highlight: followedIDs)
                            }
                            .environment(\.widthClass, layout.column)
                        } else {
                            NBAStandingsTable(rows: live, highlight: followedIDs)
                                .padding(.horizontal, 10)
                                .padding(.top, 8)
                        }
                    } else {
                        let live = Standings.live(rows, liveEvents: store.liveEvents(in: league))
                        if live.contains(where: { $0.liveScore != nil }) {
                            projectedNote("Projected if live scores hold. Arrows show moves from the official table.")
                        }
                        let groups = TableGroup.make(live) { $0.row.group }
                        if layout.split && groups.count > 1 {
                            GroupColumns(groups: groups) { group in
                                StandingsTable(rows: group.rows, highlight: followedIDs)
                            }
                            .environment(\.widthClass, layout.column)
                        } else {
                            // A single table spans the panel and adds columns as it widens.
                            StandingsTable(rows: live, highlight: followedIDs)
                                .padding(.horizontal, 10)
                                .padding(.top, 8)
                        }
                    }
                }
                .coordinateSpace(name: Self.contentSpace)
                // Tables rebuilt mid-drag (crossing the split) appear in place, never stack in.
                .environment(\.stackArrival, resizing ? nil : (arrival ?? page))
                .padding(.bottom, 12)
            }
        }
        .pageLoading(loading)
        // Only a load that takes long enough to notice shows a spinner.
        .delayedSpinner(while: loading && rows.isEmpty, show: $showSpinner)
        // Rows open their teams' pages.
        .environment(\.profileLeague, league.id)
        .task(id: league.id) { await load() }
        #if DEBUG
        // Render harness only: open or close a conference ("outline" id) as a click does.
        .onReceive(NotificationCenter.default.publisher(for: .scorelineHarness)) { note in
            guard let id = note.userInfo?["outline"] as? String else { return }
            disclosure.toggle(id, style: .click, reduceMotion: reduceMotion)
        }
        #endif
    }

    /// The table (and, in college, the AP ranks). An empty answer is asked
    /// once more directly, to tell a league with no table from a failed fetch.
    private func load() async {
        loading = true
        failed = false
        var loaded = await store.standings(for: league)
        var couldNotLoad = false
        if loaded.isEmpty {
            do { loaded = try await Standings.fetch(league: league) } catch { couldNotLoad = true }
        }
        if isCollege, case let .espn(path, _) = league.source,
           let ap = try? await Rankings.fetch(path: path).first {
            ranks = Dictionary(ap.entries.map { ($0.teamID, $0.rank) }, uniquingKeysWith: { a, _ in a })
        }
        guard !Task.isCancelled else { return }
        if isCollege {
            // Conferences holding a followed team, or one from the match, start
            // open; the rest start closed (or as left this session).
            disclosure.prepare(scope: "standings.\(league.id)",
                               TableGroup.make(loaded) { $0.group }.map { (id: $0.id, members: $0.rows.map(\.id)) },
                               mine: followedIDs.union(focus))
        }
        // The table assembles like a page entrance: rows cascade top to bottom.
        arrival = .data(in: Self.contentSpace, page: page)
        rows = loaded
        failed = couldNotLoad && loaded.isEmpty
        loading = false
    }

    private var followedIDs: Set<String> { Set(store.followed.map(\.id)) }

    private func conference(_ group: TableGroup<StandingsRow>, highlight: Set<String>, live: [String: String]) -> some View {
        ConferenceSection(group: group, flag: disclosure.flag(group.id), highlight: highlight, ranks: ranks, live: live) {
            disclosure.toggle(group.id, style: .click, reduceMotion: reduceMotion)
        }
        .equatable()
    }

    /// Spans the page above the tables, capped at a readable line.
    private func projectedNote(_ text: String) -> some View {
        HStack(spacing: 5) {
            LiveDot()
            Text(text)
        }
        .font(Viz.note)
        .foregroundStyle(.secondary)
        .readableWidth()
        .padding(.horizontal, 16)
        .padding(.top, 4)
    }
}

/// Grouped tables on a split panel: each group (its title over its own
/// table, header included) goes in whichever column has fewer rows so far.
/// Placement comes from row counts alone, so live re-ranking never moves a
/// group, and each column keeps the source's order (followed conferences
/// first, at the top of the left column).
struct GroupColumns<Row, Table: View>: View {
    let groups: [TableGroup<Row>]
    /// False when each group draws its own title (college's collapsible headers).
    var titles = true
    @ViewBuilder let table: (TableGroup<Row>) -> Table

    init(groups: [TableGroup<Row>], titles: Bool = true, @ViewBuilder table: @escaping (TableGroup<Row>) -> Table) {
        self.groups = groups
        self.titles = titles
        self.table = table
    }

    var body: some View {
        let columns = GroupPlacement.columns(for: groups.map(\.rows.count))
        HStack(alignment: .top, spacing: 0) {
            column(columns[0].map { groups[$0] })
            column(columns.count > 1 ? columns[1].map { groups[$0] } : [])
        }
        // The page's entrance treats each column's rows as its units.
        .containerValue(\.stacksOwnRows, true)
    }

    private func column(_ groups: [TableGroup<Row>]) -> some View {
        StackColumn {
            ForEach(groups) { group in
                if titles {
                    // The section-title style the match page uses, as a heading.
                    SectionTitle(group.title)
                        .lineLimit(1)
                        .padding(.horizontal, 16)
                        .padding(.top, group.id == groups.first?.id ? 6 : 18)
                        .padding(.bottom, 5)
                    table(group)
                        .padding(.horizontal, 10)
                } else {
                    table(group)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

/// One college conference (or division) as an outline group: its header
/// (the scores list's, with the chevron) and, collapsed, who leads it; open,
/// its table. Equatable on what it shows, and it observes only its own
/// flag, so opening one conference re-runs that conference alone. A closed
/// conference never builds its table.
private struct ConferenceSection: View {
    let group: TableGroup<StandingsRow>
    let flag: DisclosureFlag
    let highlight: Set<String>
    let ranks: [String: Int]
    let live: [String: String]
    let toggle: () -> Void

    var body: some View {
        let open = flag.open
        let leader = group.rows.first
        DisclosureHeader(title: group.title, count: group.rows.count, showsCount: false, open: open,
                         spokenPreview: leader.map { ConferenceLeaderLine.spoken($0, rank: ranks[$0.id]) }, edge: 10, toggle: toggle) {
            if let leader {
                ConferenceLeaderLine(row: leader, rank: ranks[leader.id])
                    .revealOnAppear(after: flag.collapsing ? 0.12 : nil)
            }
        }
        if open {
            ConferenceTable(rows: group.rows, highlight: highlight, ranks: ranks, live: live, revealing: flag.revealing)
                .padding(.horizontal, 10)
                .padding(.top, 2)
                // Rows arrive in place, staggered; they leave quickly, faster than they came.
                .transition(.asymmetric(insertion: .identity, removal: .opacity.animation(Motion.exit)))
        }
    }
}

extension ConferenceSection: @MainActor Equatable {
    static func == (a: ConferenceSection, b: ConferenceSection) -> Bool {
        a.group.id == b.group.id && a.group.rows == b.group.rows && a.flag === b.flag && a.highlight == b.highlight
            && a.ranks == b.ranks && a.live == b.live
    }
}
