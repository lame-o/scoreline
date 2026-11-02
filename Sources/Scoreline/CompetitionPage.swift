import AppKit
import SwiftUI

/// A link to a competition's page: which competition, which season (nil: the
/// current one), and the teams of the match it was opened from.
struct CompetitionRef: Hashable {
    let slug: String
    let name: String
    var year: Int? = nil
    var highlight: Set<String> = []
}

/// A soccer competition's season, the way a CS2 tournament reads: a glass card
/// with the competition and its rounds on one axis, then its bracket, its
/// fixtures round by round, and its table.
struct CompetitionPage: View {
    enum Tab: String, CaseIterable, Identifiable {
        case bracket = "Bracket", fixtures = "Fixtures", table = "Table"
        var id: String { rawValue }
    }

    @Environment(ScoreStore.self) private var store
    @Environment(\.scheduleStore) private var injected
    @Environment(\.stackArrival) private var page
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(PanelCommands.self) private var commands: PanelCommands?
    let ref: CompetitionRef
    let backTitle: String
    let onBack: () -> Void
    let onOpen: (Event) -> Void
    /// A catalog competition's teams and scope (`LeagueSettingsView`).
    var onOpenSettings: (League) -> Void = { _ in }

    @State private var data: SoccerCompetition?
    @State private var axis: SeasonAxis?
    @State private var failed = false
    @State private var showSpinner = false
    /// The season asked for: the link's at first, then the season menu's.
    @State private var year: Int?
    @State private var seasons: [Int] = []
    @State private var tab: Tab = .fixtures
    @State private var stageID: String?
    @State private var arrival: StackArrival?
    @State private var linked = LinkedFocus()
    /// The round under the pointer, on the axis (a reference: hovering updates the axis, not this page).
    @State private var hover = HighlightState()
    /// How far the card has docked: the docked bar reads it; this page never does.
    @State private var geometry = PageGeometry()
    @State private var actions = SeasonDockActions()

    private static let contentSpace = "competition.content"

    init(ref: CompetitionRef, backTitle: String, onBack: @escaping () -> Void, onOpen: @escaping (Event) -> Void,
         onOpenSettings: @escaping (League) -> Void = { _ in }) {
        self.ref = ref
        self.backTitle = backTitle
        self.onBack = onBack
        self.onOpen = onOpen
        self.onOpenSettings = onOpenSettings
        _year = State(initialValue: ref.year)
    }

    private var league: League? { League.with(id: ref.slug) }
    private var cache: ScheduleCache { (injected ?? .shared).cache }

    /// The tabs this season has: a league has no bracket, a cup no table.
    static func tabs(_ data: SoccerCompetition) -> [Tab] {
        Tab.allCases.filter { tab in
            switch tab {
            case .bracket: data.hasKnockout
            case .fixtures: true
            case .table: data.hasTable
            }
        }
    }

    /// Where a season opens: at what's going on, or at the match it was opened from. (pure; tested)
    static func openingTab(_ data: SoccerCompetition, highlight: Set<String>) -> Tab {
        let focus = data.stage(meeting: highlight) ?? data.focusStage
        if focus?.hasStandings == true { return .table }
        if let focus, data.bracket?.rounds.contains(focus.name) == true { return .bracket }
        return .fixtures
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                header
                if let data, Self.tabs(data).count > 1 { tabSwitch(Self.tabs(data)) }
            }
            .stackIn()
            .pageChrome()
            content.frame(maxHeight: .infinity, alignment: .top)
        }
        .pageLoading(data == nil && !failed)
        // Only a load that takes long enough to notice shows a spinner.
        .delayedSpinner(while: data == nil && !failed, show: $showSpinner)
        .task(id: year) { await load() }
        .task(id: ref.slug) { seasons = await SoccerCompetitionProvider.seasons(slug: ref.slug, cache: cache) }
        .onKeyPress(.leftArrow) { stepRound(-1) }
        .onKeyPress(.rightArrow) { stepRound(1) }
        // ⌘R (the panel's one binding) reloads the season too.
        .onChange(of: commands?.refreshToken) { Task { await load(force: true) } }
    }

    // MARK: Header

    /// No title: the card below is the page's heading.
    private var header: some View {
        HStack(spacing: 6) {
            BackButton(title: backTitle, action: onBack)
            Spacer(minLength: 6)
            if let data, seasons.count > 1 { seasonMenu(data) }
            if let league {
                let following = store.isEnabled(league)
                IconButton(symbol: following ? "star.fill" : "star", label: following ? "Unfollow \(league.name)" : "Follow \(league.name)",
                           active: following) {
                    store.setEnabled(league, !following)
                }
                IconButton(symbol: "slider.horizontal.3", label: "Choose Teams") { onOpenSettings(league) }
            }
        }
        .pageHeader()
    }

    private func seasonMenu(_ data: SoccerCompetition) -> some View {
        Menu {
            Picker("Season", selection: Binding(get: { data.year }, set: { year = $0 })) {
                ForEach(seasons, id: \.self) { Text(Self.seasonLabel($0, like: data.seasonLabel)).tag($0) }
            }
            .pickerStyle(.inline)
            .labelsHidden()
        } label: {
            HStack(spacing: 4) {
                Text(data.seasonLabel).monospacedDigit()
                Image(systemName: "chevron.down").font(.system(size: 8, weight: .bold)).accessibilityHidden(true)
            }
            .font(.system(size: 11.5, weight: .medium))
            .padding(.horizontal, 10)
            .frame(height: 28)
            .contentShape(Capsule())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .foregroundStyle(.primary.opacity(0.75))
        .glass(in: Capsule(), interactive: true)
        .fixedSize()
        .help("Choose a season")
        .accessibilityLabel("Season, \(data.seasonLabel)")
    }

    /// A season in the same style as the one showing: "2025–26" beside "2026–27", "2025" beside "2026".
    static func seasonLabel(_ year: Int, like shown: String) -> String {
        shown.contains("–") ? String(format: "%d–%02d", year, (year + 1) % 100) : String(year)
    }

    /// The house switch, as under a schedule's title: ⌘1, ⌘2, ⌘3.
    private func tabSwitch(_ tabs: [Tab]) -> some View {
        Picker("Show", selection: Binding(get: { tab }, set: { show($0) })) {
            ForEach(tabs) { Text($0.rawValue).tag($0) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .controlSize(.small)
        .frame(width: CGFloat(tabs.count) * 84)
        .frame(maxWidth: .infinity)
        .padding(.top, 2)
        .padding(.bottom, 8)
        .background {
            ForEach(Array(tabs.enumerated()), id: \.element) { index, tab in
                ShortcutButton(key: KeyEquivalent(Character("\(index + 1)"))) { show(tab) }
            }
        }
        .help(tabs.enumerated().map { "\($1.rawValue) (⌘\($0 + 1))" }.joined(separator: " · "))
    }

    /// A key press changes at once; a click crossfades in place (it's the same page, facing another way).
    private func show(_ next: Tab) {
        guard next != tab else { return }
        if NSApp.currentEvent?.type == .keyDown {
            arrival = nil
            var instant = Transaction()
            instant.disablesAnimations = true
            withTransaction(instant) { tab = next }
        } else {
            arrival = StackArrival(style: .fade, space: Self.contentSpace)
            withAnimation(Motion.exit) { tab = next }
        }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if let data, let axis {
            // Arrows, Page Up/Down, Space, Home and End scroll the page.
            PageScrollView(keyboardScrolls: true) {
                VStack(alignment: .leading, spacing: 0) {
                    SeasonCard(summary: data.summary, axis: axis, hover: hover, onSelect: { open(round: $0) }) { EmptyView() }
                        .padding(.horizontal, 10)
                        .padding(.top, 4)
                        .stackIn()
                    if data.isEmpty {
                        EmptyState(symbol: "calendar", title: "No Fixtures Yet",
                                   message: "\(data.title) hasn't published any for \(data.seasonLabel).")
                    } else {
                        switch tab {
                        case .bracket: bracket(data)
                        case .fixtures: fixtures(data)
                        case .table: CompetitionTable(competition: data, highlight: ref.highlight)
                        }
                    }
                }
                .coordinateSpace(name: Self.contentSpace)
                .environment(\.stackArrival, arrival ?? page)
                .environment(linked)
                .onHover { inside in if !inside { linked.clear() } }
                .padding(.bottom, 14)
            }
            // As the card tucks under the header, its docked bar settles in:
            // an overlay, so it never changes the page's measured height.
            .overlay(alignment: .top) {
                DockedBarHost { dockBar(data.summary, axis).equatable() }
            }
            .environment(\.pageGeometry, geometry)
        } else if failed {
            ErrorState(ref.name) { Task { await load(force: true) } }
        } else if showSpinner {
            PageSpinner("Loading \(ref.name)")
        }
    }

    private func dockBar(_ summary: SeasonSummary, _ axis: SeasonAxis) -> SeasonDockBar {
        // Refreshed every render: a click acts on the page as it is now.
        actions.reveal = { open(round: $0) }
        return SeasonDockBar(summary: summary, axis: axis, hover: hover, actions: actions)
    }

    @ViewBuilder
    private func bracket(_ data: SoccerCompetition) -> some View {
        if let bracket = data.bracket {
            StackColumn {
                DetailSection(title: "Bracket", caption: "The score in each tie, over both legs or a whole series where there's more than one game. Lines carry each winner to the next round.") {
                    BracketView(bracket: bracket, highlight: ref.highlight) { id in
                        if let game = data.tie(id)?.game { onOpen(ScheduleRow.event(for: game, store: store)) }
                    }
                }
            }
        } else if let first = data.undrawnFrom {
            EmptyState(symbol: "trophy", title: "No Bracket Yet",
                       message: "It starts at the \(first), once that's drawn. Until then, see the fixtures.")
        }
    }

    private func fixtures(_ data: SoccerCompetition) -> some View {
        let shown = data.stages.first { $0.id == stageID } ?? data.stages.first { $0.id == data.focusStage?.id } ?? data.stages.first
        return VStack(alignment: .leading, spacing: 0) {
            if data.stages.count > 1, let shown {
                RoundChips(stages: data.stages, selected: shown.id) { pick(round: $0) }.stackIn()
            }
            if let shown {
                CompetitionFixtures(stage: shown, onOpen: onOpen)
                    // Another round starts from its own today.
                    .id(shown.id)
            }
        }
    }

    // MARK: Rounds

    private func pick(round id: String) {
        guard id != stageID else { return }
        arrival = NSApp.currentEvent?.type == .keyDown ? nil : StackArrival(style: .fade, space: Self.contentSpace)
        stageID = id
    }

    /// A round chosen on the axis: its fixtures.
    private func open(round id: String) {
        show(.fixtures)
        pick(round: id)
        geometry.scroll(toY: 0, animated: !reduceMotion)
    }

    /// ← and → step through the rounds on Fixtures.
    private func stepRound(_ delta: Int) -> KeyPress.Result {
        guard tab == .fixtures, let data else { return .ignored }
        let ids = data.stages.map(\.id)
        let current = stageID ?? data.focusStage?.id
        guard let index = current.flatMap(ids.firstIndex), ids.indices.contains(index + delta) else { return .ignored }
        pick(round: ids[index + delta])
        return .handled
    }

    // MARK: Loading

    private func load(force: Bool = false) async {
        do {
            let next = try await SoccerCompetitionProvider.load(slug: ref.slug, year: year, force: force, cache: cache)
            guard !Task.isCancelled else { return }
            let first = data == nil || data?.year != next.year
            if first {
                // The season assembles like a page entrance.
                arrival = .data(in: Self.contentSpace, page: page)
                stageID = next.stage(meeting: ref.highlight)?.id
                tab = Self.openingTab(next, highlight: ref.highlight)
            } else if !Self.tabs(next).contains(tab) {
                tab = .fixtures
            }
            data = next
            axis = next.axis()
            failed = false
        } catch {
            guard !Task.isCancelled else { return }
            // A season that won't load leaves the one on screen, and the menu says so.
            if let data { year = data.year } else { failed = true }
        }
    }
}

// MARK: - Rounds

/// One chip per round, the selected one kept in view.
private struct RoundChips: View {
    let stages: [SoccerCompetition.Stage]
    let selected: String
    let onSelect: (String) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(stages) { stage in
                        ChipButton(title: stage.name, selected: stage.id == selected) { onSelect(stage.id) }
                            .id(stage.id)
                    }
                }
                .padding(.horizontal, Metrics.gutter)
            }
            .scrollIndicators(.never)
            .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
            .padding(.top, 10)
            .padding(.bottom, 2)
            .onAppear { proxy.scrollTo(selected, anchor: .center) }
            .onChange(of: selected) { _, id in proxy.scrollTo(id, anchor: .center) }
        }
    }
}

/// A round's games by day, from today in a long season (Show Earlier reveals
/// what's gone), a page at a time.
private struct CompetitionFixtures: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.panelLayout) private var layout
    let stage: SoccerCompetition.Stage
    let onOpen: (Event) -> Void
    /// The hovered row. A reference: a change updates the two rows it lights, not this list.
    @State private var highlight = HighlightState()
    @State private var earlierLimit = 0
    @State private var laterLimit = Self.page

    /// Rows per page of a long season.
    private static let page = 40
    private var today: DayKey { .today() }
    private var rowWidth: WidthClass { layout.split ? layout.column : layout.page }

    /// (earlier, later): a season underway starts at today; one that's over shows its end.
    private var days: (earlier: [AgendaDay], later: [AgendaDay]) {
        let all = Agenda.build(stage.games, leagueOrder: [], grouped: false)
        return (all.filter { $0.day < today }, all.filter { $0.day >= today })
    }

    var body: some View {
        if stage.games.isEmpty {
            EmptyState(symbol: "calendar", title: "Not Drawn Yet",
                       message: "\(stage.name) fixtures appear once the draw is made.")
        } else {
            list
        }
    }

    private var list: some View {
        let days = self.days
        // Nothing left to come: open on how it ended.
        let earlierShown = days.later.isEmpty ? max(earlierLimit, Self.page) : earlierLimit
        let earlier = AgendaPage.cap(days.earlier, items: earlierShown, fromEnd: true)
        let later = AgendaPage.cap(days.later, items: laterLimit, fromEnd: false)
        return VStack(alignment: .leading, spacing: 0) {
            if earlier.hidden > 0 {
                more("Show Earlier") { earlierLimit = earlierShown + Self.page }
            }
            ForEach(earlier.days + later.days) { day in
                ScheduleDayHeader(day: day.day, today: today).stackIn()
                rows(day.items)
            }
            if later.hidden > 0 {
                more("Show \(min(later.hidden, Self.page)) More") { laterLimit += Self.page }
            }
        }
    }

    private func rows(_ items: [ScheduleItem]) -> some View {
        RowGrid(columns: layout.columns) {
            ForEach(items) { item in
                HighlightGate(state: highlight, id: item.id) { lit in
                    ScheduleRow(item: item, highlighted: lit, width: rowWidth, showsCompetition: false,
                                onHover: { inside in
                                    if inside { highlight.id = item.id } else if highlight.id == item.id { highlight.id = nil }
                                },
                                onSelect: { onOpen(ScheduleRow.event(for: $0, store: store)) })
                        .equatable()
                }
                .stackIn()
            }
        }
        // One status width for the day: every score in it sits in one column.
        .environment(\.statusColumnWidth, ScheduleRow.statusWidth(items, store: store, width: rowWidth))
    }

    private func more(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(Color.accentColor)
                .padding(.horizontal, Metrics.gutter)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Table

/// A season's table: this season's re-ranks live; another's is as it finished.
private struct CompetitionTable: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.stackArrival) private var page
    let competition: SoccerCompetition
    /// The teams of the match the page was opened from (bare IDs).
    let highlight: Set<String>
    @State private var rows: [StandingsRow] = []
    @State private var loading = true
    @State private var failed = false
    @State private var showSpinner = false
    @State private var arrival: StackArrival?

    private static let contentSpace = "competition.table"
    private var league: League? { League.resolving(id: competition.slug) }
    /// The current season reads through the store's table, shared with the match pages.
    private var isCurrent: Bool { competition.isCurrentSeason }

    var body: some View {
        StackColumn {
            if loading && rows.isEmpty {
                if showSpinner { PageSpinner("Loading table") }
            } else if failed {
                ErrorState("Table") { Task { await load() } }
            } else if rows.isEmpty {
                EmptyState(symbol: "list.number", title: "No Table Yet",
                           message: "\(competition.title) hasn't published a table for \(competition.seasonLabel).")
            } else if let league {
                SoccerTables(rows: rows, league: league, isLive: isCurrent,
                             highlight: Set(store.followed.map(\.id)).union(highlight.map { "espn-soccer-\($0)" }))
            }
        }
        .coordinateSpace(name: Self.contentSpace)
        .environment(\.stackArrival, arrival ?? page)
        .environment(\.profileLeague, competition.slug)
        .delayedSpinner(while: loading && rows.isEmpty, show: $showSpinner)
        .task(id: competition.year) { await load() }
    }

    private func load() async {
        guard let league else { return }
        loading = true
        failed = false
        var loaded: [StandingsRow] = []
        var couldNotLoad = false
        if isCurrent { loaded = await store.standings(for: league) }
        if loaded.isEmpty {
            do { loaded = try await Standings.fetch(league: league, season: isCurrent ? nil : competition.year) } catch { couldNotLoad = true }
        }
        guard !Task.isCancelled else { return }
        arrival = .data(in: Self.contentSpace, page: page)
        rows = loaded
        failed = couldNotLoad && loaded.isEmpty
        loading = false
    }
}
