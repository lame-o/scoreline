import AppKit
import SwiftUI

// The Schedule page facing back in time: what happened, one round at a time
// for a league (a matchweek, a football week, a day), newest first for a
// team or your teams. Same header, scopes and rows as Upcoming; the round
// picker or week strip moves through rounds, which swap in place from cache
// and never animate. See specs/results.md §3.

// MARK: - Environment

private struct ResultsStoreKey: EnvironmentKey {
    static let defaultValue: ResultsStore? = nil
}

extension EnvironmentValues {
    /// The render harness and tests may inject one; pages use the shared store.
    var resultsStore: ResultsStore? {
        get { self[ResultsStoreKey.self] }
        set { self[ResultsStoreKey.self] = newValue }
    }
}

// MARK: - Navigation (pure)

/// How a results scope moves through time.
enum ResultsNavigation: Equatable {
    /// A matchweek, a cup's stage block, a football week: "‹ Matchweek 8 · Oct 23–25 ⌄ ›".
    case rounds
    /// A daily league or everything: the week strip, one game day selected.
    case days
    /// A team, your teams: a list, newest first.
    case list

    static func of(_ scope: ScheduleScope) -> ResultsNavigation {
        switch scope {
        case .all: .days
        case let .league(id):
            switch League.with(id: id)?.source {
            case .espn(_, true)?: .rounds
            case .espn?: League.with(id: id)?.sport == .soccer ? .rounds : .days
            default: .days
            }
        default: .list
        }
    }

    /// The strip's first day: the selected day's week (Sunday first), except
    /// that this week ends today (results face back: no row of empty days ahead).
    static func stripStart(_ day: DayKey, today: DayKey) -> DayKey {
        day.weekStart.adding(days: 6) > today ? min(day.weekStart, today.adding(days: -6)) : day.weekStart
    }

    /// The strip's ‹ › : a week back or on, landing on the game day nearest
    /// the same weekday; past an empty week, the next game day that way.
    /// `rounds` oldest first, as the store keeps them.
    static func weekStep(_ direction: Int, from current: DayKey, rounds days: [ResultRound]) -> ResultRound? {
        let target = current.adding(days: 7 * direction)
        let start = target.weekStart, end = start.adding(days: 6)
        let inWeek = days.filter { start <= $0.first && $0.first <= end }
        if let best = inWeek.min(by: { abs($0.first.days(to: target)) < abs($1.first.days(to: target)) }) { return best }
        return direction < 0 ? days.last { $0.first < start } : days.first { $0.first > end }
    }
}

// MARK: - Page

struct ResultsAgendaPage: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.resultsStore) private var injected
    @Environment(\.scheduleStore) private var injectedSchedule
    @Environment(\.stackArrival) private var page
    @Environment(\.panelLayout) private var layout
    @Environment(PanelCommands.self) private var commands: PanelCommands?
    let scope: ScheduleScope
    let backTitle: String
    let onBack: () -> Void
    let onOpen: (Event) -> Void
    let onScope: (ScheduleScope) -> Void
    let onMode: (ScheduleMode) -> Void
    var onDrill: (ScheduleScope) -> Void = { _ in }

    /// The hovered or arrow-keyed row: a reference, so a change redraws only
    /// the rows whose highlight flips.
    @State private var highlight = HighlightState()
    @State private var keyboardDriven = false
    @State private var arrival: StackArrival?
    /// A round had to load: its skeleton showed, so its rows arrive as data.
    /// (A round from cache swaps in place; nothing moves.)
    @State private var skeletonShown = false
    /// Split, rounds: your teams' seasons in this league (inline results, form).
    @State private var yourSeasons: [TeamSeason] = []
    @FocusState private var focused: Bool

    private var results: ResultsStore { injected ?? .shared }
    private var schedule: ScheduleStore { injectedSchedule ?? .shared }
    private var navigation: ResultsNavigation { .of(scope) }
    private var rowWidth: WidthClass { layout.split ? layout.column : layout.page }
    private var today: DayKey { .today() }
    private static let contentSpace = "results.content"

    var body: some View {
        let state = results.state(scope)
        let days = results.groups(scope, store: store)
        VStack(spacing: 0) {
            chrome(state, days: days).stackIn().pageChrome()
            content(state, days: days).frame(maxHeight: .infinity, alignment: .top)
            footer(state).pageChrome()
        }
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .keyFocusWhenLive($focused)
        .onKeyPress(.downArrow) { move(by: 1, days); return .handled }
        .onKeyPress(.upArrow) { move(by: -1, days); return .handled }
        .onKeyPress(.leftArrow) { step(-1); return .handled }
        .onKeyPress(.rightArrow) { step(1); return .handled }
        .onKeyPress(.return) { openHighlighted(days) }
        .onKeyPress(.space) { openHighlighted(days) }
        .pageLoading(state?.updated == nil || state?.loading == true)
        .task(id: scope) {
            let first = results.state(scope)?.updated == nil
            await results.open(scope, store: store)
            // The first data cascades in like a page entrance (fades by keyboard).
            if first { arrival = .data(in: Self.contentSpace, page: page) }
        }
        .task(id: yourTeamsKey(state)) { await loadYourSeasons(state) }
        .onChange(of: commands?.refreshToken) { refresh() }
    }

    // MARK: Chrome

    private func chrome(_ state: ResultsStore.PageState?, days: [AgendaDay]) -> some View {
        VStack(spacing: 0) {
            ScheduleHeader(scope: scope, mode: .results, backTitle: backTitle, onBack: onBack, onScope: onScope,
                           onMode: onMode) { moreItems(state) }
            navigator(state)
            // From the split, the round's column carries its own summary.
            if navigation != .list, !(layout.split && navigation == .rounds), let summary = roundSummary(state) {
                summaryLine(summary).padding(.bottom, 6)
            }
            ShortcutButton(key: "t") { latest() }
        }
    }

    private func selectedRound(_ state: ResultsStore.PageState?) -> ResultRound? { state?.round }

    @ViewBuilder
    private func navigator(_ state: ResultsStore.PageState?) -> some View {
        switch navigation {
        case .rounds:
            // From the split the rounds list on the left is the picker.
            if !layout.split, let state, !state.rounds.isEmpty {
                RoundPicker(rounds: state.rounds, selected: state.selected, onSelect: { select($0) }, onStep: { step($0) })
            }
        case .days:
            if let state, !state.rounds.isEmpty {
                let round = selectedRound(state)
                let start = ResultsNavigation.stripStart(round?.first ?? today, today: today)
                let byDay = Dictionary(state.rounds.map { ($0.first, $0.id) }, uniquingKeysWith: { a, _ in a })
                WeekStrip(days: (0..<7).map { start.adding(days: $0) }, today: today, selected: round?.first,
                          dots: dots(state, byDay: byDay),
                          onSelect: { day in if let id = byDay[day] { select(id) } },
                          onPrevious: { weekStep(-1, state) }, onNext: { weekStep(1, state) },
                          enabled: { byDay[$0] != nil })
            }
        case .list:
            EmptyView()
        }
    }

    /// Dots under the strip: a game day with results; a followed team's day.
    private func dots(_ state: ResultsStore.PageState, byDay: [DayKey: String]) -> [DayKey: WeekStrip.Dot] {
        var dots: [DayKey: WeekStrip.Dot] = [:]
        for day in byDay.keys { dots[day] = .games }
        let followed = Set(store.followed.map(\.id))
        if let day = selectedRound(state)?.first,
           state.items.contains(where: { $0.teams.contains { $0.id.map(followed.contains) ?? false } }) {
            dots[day] = .followed
        }
        return dots
    }

    /// The round in one line, 11pt secondary; the round's heading for
    /// VoiceOver (the picker above it is a control).
    private func summaryLine(_ summary: (text: String, spoken: String)) -> some View {
        Text(summary.text)
            .font(.system(size: 11).monospacedDigit())
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .padding(.horizontal, Metrics.gutter)
            .accessibilityLabel(summary.spoken)
            .accessibilityAddTraits(.isHeader)
            .accessibilityHeading(.h2)
    }

    /// "10 results · 19 goals" (the store's), and what VoiceOver hears as the round's heading.
    private func roundSummary(_ state: ResultsStore.PageState?) -> (text: String, spoken: String)? {
        guard let state, let round = state.round, let line = state.summary, !state.items.isEmpty else { return nil }
        let spoken = [round.title, round.detail == round.title ? nil : round.detail, line].compactMap { $0 }.joined(separator: ", ")
        return (line, spoken)
    }

    // MARK: More

    @ViewBuilder
    private func moreItems(_ state: ResultsStore.PageState?) -> some View {
        if navigation != .list {
            Button("Latest") { latest() }.keyboardShortcut("t")
        }
        // Shows ⌘R; whichever binding takes the key, it's the panel's refresh.
        Button("Refresh") { if let commands { commands.refresh(store) } else { refresh() } }.keyboardShortcut("r")
        Divider()
        Toggle("Show Details", isOn: Binding(get: { results.showsDetails }, set: { results.showsDetails = $0 }))
        if case let .league(id) = scope, let league = League.with(id: id), filterable(league) {
            // The store regroups by itself: nothing reloads.
            let all = schedule.showAllGames.contains(scope)
            Button(all ? "Show Your Picks" : "Show All Games") {
                if all { schedule.showAllGames.remove(scope) } else { schedule.showAllGames.insert(scope) }
            }
        }
        if case let .team(team) = scope {
            let choices = TeamSeasons.choices(for: team)
            if !choices.isEmpty {
                Picker("Season", selection: Binding(get: { state?.seasonYear }, set: { year in
                    Task { await results.selectSeason(year, in: scope, store: store) }
                })) {
                    ForEach(choices, id: \.self) { choice in Text(choice.label).tag(choice.year) }
                }
            }
            if ScheduleProvider.ESPN.teamSource(team.id)?.sport == .soccer {
                Toggle("Include Friendlies", isOn: Binding(get: { results.includeFriendlies.contains(team.id) }, set: { on in
                    if on { results.includeFriendlies.insert(team.id) } else { results.includeFriendlies.remove(team.id) }
                }))
            }
        }
    }

    /// The scope chips, as on Upcoming: a league opens its own Results.
    private var chips: ScheduleChips? { .scopes(scope, store: store, onScope: onScope, onDrill: onDrill) }

    private func filterable(_ league: League) -> Bool {
        store.isFilterOn(league) && !store.picks(for: league).isEmpty || league.id == "college-football"
    }

    // MARK: Content

    @ViewBuilder
    private func content(_ state: ResultsStore.PageState?, days: [AgendaDay]) -> some View {
        if state == nil || state?.updated == nil && state?.failed != true {
            ScheduleSkeleton(days: 1, rows: 4)
        } else if let state, state.failed, state.items.isEmpty, state.season == nil {
            // Results load when asked: nothing retries on its own.
            ErrorState("Results") { refresh() }
        } else if let state {
            switch navigation {
            case .rounds, .days: roundContent(state, days: days)
            case .list: listContent(state, days: days)
            }
        }
    }

    // MARK: Rounds

    @ViewBuilder
    private func roundContent(_ state: ResultsStore.PageState, days: [AgendaDay]) -> some View {
        if state.rounds.isEmpty {
            EmptyState(symbol: "flag.checkered", title: "No Results Yet",
                       message: "Nothing's been played this season yet.") {
                Button("Show Upcoming") { onMode(.upcoming) }.controlSize(.small)
            }
        } else {
            ScrollViewReader { proxy in
            PageScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if let chips { chips.stackIn() }
                    if layout.split && navigation == .rounds {
                        HStack(alignment: .top, spacing: 0) {
                            ResultsRoundList(rounds: state.rounds, selected: state.selected, seasons: yourSeasons,
                                             onSelect: { select($0) }, onOpen: open)
                                .frame(maxWidth: .infinity, alignment: .top)
                                .environment(\.widthClass, layout.column)
                            roundDays(state, days: days, columns: 1)
                                .frame(maxWidth: .infinity, alignment: .top)
                        }
                    } else {
                        roundDays(state, days: days, columns: layout.columns)
                    }
                }
                .padding(.bottom, 10)
                .coordinateSpace(name: Self.contentSpace)
                .environment(\.stackArrival, arrival ?? page)
            }
            .accessibilityRotor("Your Teams") { rotor(state.items) }
            .modifier(RowScroll(state: highlight, proxy: proxy, keyboardDriven: { keyboardDriven },
                                position: Self.positions(days)))
            }
        }
    }

    /// Each game's place in the round ("0.1.3": day, group, row). Rows are
    /// identified by place, not by game: stepping to another round reuses
    /// them (new values, no new views), which is most of a step's cost.
    static func positions(_ days: [AgendaDay]) -> [String: String] {
        var out: [String: String] = [:]
        for (d, day) in days.enumerated() {
            for (g, group) in day.groups.enumerated() {
                for (r, item) in group.items.enumerated() { out[item.id] = "row-\(d).\(g).\(r)" }
            }
        }
        return out
    }

    /// The round, day by day in kickoff order (a matchweek reads Friday to
    /// Monday); within a day its finals first, then what's still to play.
    @ViewBuilder
    private func roundDays(_ state: ResultsStore.PageState, days: [AgendaDay], columns: Int) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if layout.split && navigation == .rounds, let round = selectedRound(state) {
                // The round's name tops its column (the picker left the chrome).
                VStack(alignment: .leading, spacing: 2) {
                    SectionTitle([round.title, round.detail == round.title ? nil : round.detail].compactMap { $0 }.joined(separator: " · "))
                        .padding(.horizontal, Metrics.gutter)
                    if let summary = roundSummary(state) { summaryLine(summary) }
                }
                .padding(.top, 10)
                .stackIn()
            }
            if state.loading && state.items.isEmpty {
                ScheduleSkeleton(days: 1, rows: 4)
                    .onAppear { skeletonShown = true }
            } else if state.items.isEmpty {
                ScheduleNote(text: "No results in this round.").padding(.top, 12).stackIn()
            } else {
                // By place (see `positions`): a step reuses the views it already has.
                ForEach(Array(days.enumerated()), id: \.offset) { d, day in
                    ScheduleDayHeader(day: day.day, today: today)
                        .stackIn()
                    ForEach(Array(day.groups.enumerated()), id: \.offset) { g, group in
                        if scope == .all {
                            ScheduleGroupLabel(title: group.title, symbol: group.symbol,
                                               onOpen: League.with(id: group.league).map { league in { onDrill(.for(league: league)) } })
                                .stackIn()
                        }
                        // The store's order: finals first within a day, then what's still to play.
                        rows(group.items, columns: columns, place: "\(d).\(g)")
                    }
                }
                if !state.byes.isEmpty {
                    ScheduleNote(text: "Bye: " + state.byes.joined(separator: ", ")).stackIn()
                }
            }
        }
    }

    /// `place`: rows identified by position in the round (a step reuses them);
    /// nil for lists, by game.
    private func rows(_ items: [ScheduleItem], columns: Int, place: String? = nil) -> some View {
        let details = results.showsDetails
        return RowGrid(columns: columns) {
            ForEach(Array(items.enumerated()), id: \.offset) { r, item in
                HighlightGate(state: highlight, id: item.id) { lit in
                    ScheduleRow(item: item, highlighted: lit, keyboard: lit && highlight.keyboard, width: rowWidth,
                                showsCompetition: showsCompetition(item),
                                onHover: { inside in hover(item.id, inside) },
                                onSelect: { open($0) },
                                onTeamSchedule: { team in
                                    if let id = team.id { onScope(.team(ScheduleTeamRef(id: id, name: team.name, logo: team.logo))) }
                                },
                                details: details)
                        .equatable()
                }
                .id(place.map { "row-\($0).\(r)" } ?? item.id)
                .stackIn()
            }
        }
        // One status width for the group: every score in it sits in one column.
        .environment(\.statusColumnWidth, ScheduleRow.statusWidth(items, store: store, width: rowWidth))
    }

    private func showsCompetition(_ item: ScheduleItem) -> Bool {
        if case .league = scope { return false }
        return item.children == nil
    }

    // MARK: Lists (team, your teams)

    @ViewBuilder
    private func listContent(_ state: ResultsStore.PageState, days: [AgendaDay]) -> some View {
        if scope == .yourTeams, store.followed.isEmpty {
            EmptyState(symbol: "star", title: "No Teams",
                       message: "Follow a team from any game's menu to see its results here.")
        } else {
            ScrollViewReader { proxy in
                PageScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        if let chips { chips.stackIn() }
                        if case let .team(team) = scope {
                            teamContent(state, team: team)
                        } else {
                            yourTeamsContent(state, days: days)
                        }
                    }
                    .padding(.bottom, 10)
                    .coordinateSpace(name: Self.contentSpace)
                    .environment(\.stackArrival, arrival ?? page)
                }
                .accessibilityRotor("Your Teams") { rotor(state.items) }
                .modifier(RowScroll(state: highlight, proxy: proxy, keyboardDriven: { keyboardDriven }, position: [:]))
            }
        }
    }

    /// The season card, then the season's results newest first by month.
    @ViewBuilder
    private func teamContent(_ state: ResultsStore.PageState, team: ScheduleTeamRef) -> some View {
        let season = state.season
        let items = state.items
        let more = state.more
        let card = season.map { s in
            TeamSeasonCard(season: s, sport: ScheduleProvider.ESPN.teamSource(team.id)?.sport, onOpen: { id in
                if let item = s.results.first(where: { $0.id == id }) { open(item) }
            })
            .padding(.horizontal, 10)
            .padding(.top, 6)
            .stackIn()
        }
        if layout.split {
            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 0) { card }
                    .frame(maxWidth: .infinity, alignment: .top)
                VStack(alignment: .leading, spacing: 0) { teamRows(items, team: team, more: more, season: season) }
                    .frame(maxWidth: .infinity, alignment: .top)
            }
        } else {
            card
            teamRows(items, team: team, more: more, season: season)
        }
    }

    @ViewBuilder
    private func teamRows(_ items: [ScheduleItem], team: ScheduleTeamRef, more: Bool, season: TeamSeason?) -> some View {
        let state = results.state(scope)
        if items.isEmpty {
            ScheduleNote(text: state?.seasonYear == nil ? "No results for \(team.name) yet this season."
                         : "No results for \(team.name) in \(season?.season ?? "that season").")
                .padding(.top, 12)
                .stackIn()
        } else {
            let details = results.showsDetails
            ForEach(Self.months(items), id: \.first?.id) { month in
                if let first = month.first { MonthLabel(month: first.day).stackIn() }
                ForEach(month) { item in
                    HighlightGate(state: highlight, id: item.id) { lit in
                        TeamResultRow(item: item, team: team.id, details: details, highlighted: lit,
                                      keyboard: lit && highlight.keyboard,
                                      onHover: { inside in hover(item.id, inside) }, onSelect: { open($0) })
                            .equatable()
                    }
                    .id(item.id)
                    .stackIn()
                }
            }
            if more {
                moreButton("Show 20 More") { Task { await results.showMore(scope) } }
            }
        }
    }

    /// Newest first, split where the month changes.
    static func months(_ items: [ScheduleItem]) -> [[ScheduleItem]] {
        var out: [[ScheduleItem]] = []
        for item in items {
            if let last = out.last?.last, last.day.year == item.day.year, last.day.month == item.day.month {
                out[out.count - 1].append(item)
            } else {
                out.append([item])
            }
        }
        return out
    }

    /// Every followed team's results of the last month, newest first, head to head.
    @ViewBuilder
    private func yourTeamsContent(_ state: ResultsStore.PageState, days: [AgendaDay]) -> some View {
        if state.items.isEmpty {
            ScheduleNote(text: "No results for your teams in the last 30 days.").padding(.top, 12).stackIn()
        } else {
            // The store's order: newest day first, newest game first.
            ForEach(days) { day in
                ScheduleDayHeader(day: day.day, today: today).stackIn()
                rows(day.items, columns: layout.columns)
            }
            if state.more {
                moreButton("Show 20 More") { Task { await results.showMore(scope) } }
            }
        }
    }

    private func moreButton(_ title: String, action: @escaping () -> Void) -> some View {
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

    @AccessibilityRotorContentBuilder
    private func rotor(_ items: [ScheduleItem]) -> some AccessibilityRotorContent {
        let followed = Set(store.followed.map(\.id))
        ForEach(items.filter { $0.teams.contains { $0.id.map(followed.contains) ?? false } }) { item in
            AccessibilityRotorEntry(ResultText.copy(item), id: item.id)
        }
    }

    // MARK: Footer

    private func footer(_ state: ResultsStore.PageState?) -> some View {
        HStack {
            UpdatedLabel(text: { updatedText(state, now: $0) }, offline: { state?.stale == true && state?.updated != nil })
            Spacer()
            if navigation != .list {
                Button("Latest") { latest() }
                    .buttonStyle(.plain)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .help("Latest (⌘T)")
            }
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 8)
    }

    private func updatedText(_ state: ResultsStore.PageState?, now: Date) -> String {
        let zone = TimeZone.current.abbreviation() ?? ""
        guard let updated = state?.updated else { return state?.loading == true ? "Updating…" : "Times in \(zone)" }
        if state?.stale == true { return "Can't connect · Showing results from \(updated.formatted(date: .omitted, time: .shortened))" }
        if state?.loading == true { return "Updating…" }
        return "\(UpdatedLabel.ago(updated, now: now)) · Times in \(zone)"
    }

    // MARK: Your teams beside the rounds (split)

    /// Followed teams playing in this round's league, once per round set.
    private func yourTeamsKey(_ state: ResultsStore.PageState?) -> String {
        guard layout.split, navigation == .rounds, let state else { return "" }
        let followed = Set(store.followed.map(\.id))
        return state.items.flatMap(\.teams).compactMap(\.id).filter(followed.contains).sorted().joined(separator: ",")
    }

    private func loadYourSeasons(_ state: ResultsStore.PageState?) async {
        let key = yourTeamsKey(state)
        guard !key.isEmpty, let state else { return yourSeasons = [] }
        var seasons: [TeamSeason] = []
        for id in key.split(separator: ",").map(String.init).prefix(3) {
            guard let team = state.items.flatMap(\.teams).first(where: { $0.id == id }) else { continue }
            let ref = ScheduleTeamRef(id: id, name: team.name, logo: team.logo, league: scope.league?.id)
            if let season = await results.season(ref, store: store) { seasons.append(season) }
        }
        yourSeasons = seasons
    }

    // MARK: Actions

    private func open(_ item: ScheduleItem) {
        onOpen(store.current(item.event()))
    }

    private func hover(_ id: String, _ inside: Bool) {
        if inside {
            highlight.keyboard = false
            highlight.id = id
        } else if highlight.id == id {
            highlight.id = nil
        }
    }

    private var isKeyboard: Bool { NSApp.currentEvent?.type == .keyDown }

    /// A round swaps in place: from cache at once, with nothing moving. One
    /// that had to load (a skeleton showed) arrives as data does: a cascade
    /// by click, a fade by keyboard.
    private func select(_ id: ResultRound.ID) {
        go { await results.select(id, in: scope, store: store) }
    }

    private func go(_ change: @escaping () async -> Void) {
        let keyboard = isKeyboard
        highlight.id = nil
        skeletonShown = false
        Task {
            await change()
            if skeletonShown {
                skeletonShown = false
                arrival = StackArrival(style: keyboard ? .fade : .stack, space: Self.contentSpace)
            }
        }
    }

    private func step(_ direction: Int) {
        guard navigation != .list, let state = results.state(scope),
              let i = state.rounds.firstIndex(where: { $0.id == state.selected }), state.rounds.indices.contains(i + direction) else { return }
        go { await results.step(direction, in: scope, store: store) }
    }

    private func weekStep(_ direction: Int, _ state: ResultsStore.PageState) {
        let current = selectedRound(state)?.first ?? today
        if let target = ResultsNavigation.weekStep(direction, from: current, rounds: state.rounds) { select(target.id) }
    }

    /// ⌘T: the newest round with a result.
    private func latest() {
        guard navigation != .list else { return }
        go { await results.showLatest(scope, store: store) }
    }

    private func refresh() {
        Task { await results.open(scope, store: store, force: true) }
    }

    // MARK: Keyboard

    private func navigable(_ days: [AgendaDay]) -> [ScheduleItem] {
        guard let state = results.state(scope) else { return [] }
        switch navigation {
        case .rounds, .days:
            return days.flatMap { day in day.groups.flatMap(\.items) }
        case .list:
            if case .team = scope { return state.items }
            return days.flatMap(\.items)
        }
    }

    private func move(by delta: Int, _ days: [AgendaDay]) {
        let rows = navigable(days)
        guard !rows.isEmpty else { return }
        keyboardDriven = true
        highlight.keyboard = true
        let current = rows.firstIndex { $0.id == highlight.id }
        let next = current.map { min(max($0 + delta, 0), rows.count - 1) } ?? (delta > 0 ? 0 : rows.count - 1)
        highlight.id = rows[next].id
        DispatchQueue.main.async { keyboardDriven = false }
    }

    private func openHighlighted(_ days: [AgendaDay]) -> KeyPress.Result {
        guard let id = highlight.id, let item = navigable(days).first(where: { $0.id == id }) else { return .ignored }
        open(item)
        return .handled
    }
}

// MARK: - Rounds list (split)

/// Beside the round (from 680pt): the season's rounds newest first, each
/// with your teams' result in it ("ARS W 2–0"), the selected one lit; then
/// your teams' form. Clicking a round selects it in place.
struct ResultsRoundList: View {
    let rounds: [ResultRound]
    let selected: ResultRound.ID?
    let seasons: [TeamSeason]
    let onSelect: (ResultRound.ID) -> Void
    let onOpen: (ScheduleItem) -> Void
    @State private var hover = HighlightState()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            let sections = RoundPicker.sections(rounds)
            ForEach(sections.indices, id: \.self) { i in
                if !sections[i].title.isEmpty {
                    SectionTitle(sections[i].title)
                        .padding(.horizontal, Metrics.gutter)
                        .padding(.top, i == 0 ? 10 : 14)
                        .padding(.bottom, 3)
                        .stackIn()
                }
                ForEach(sections[i].options) { option in
                    HighlightGate(state: hover, id: option.id) { lit in
                        RoundRow(option: option, mine: inline(option.id), selected: option.id == selected, hovering: lit) {
                            onSelect(option.id)
                        }
                    }
                    .onHover { inside in
                        if inside { hover.id = option.id } else if hover.id == option.id { hover.id = nil }
                    }
                    .stackIn()
                }
            }
            if !seasons.isEmpty {
                GroupLabel(title: "Your Teams · Form", symbol: "star.fill")
                    .padding(.horizontal, Metrics.gutter)
                    .padding(.top, 16)
                    .padding(.bottom, 4)
                    .stackIn()
                ForEach(seasons, id: \.team.id) { season in
                    YourTeamForm(season: season, onOpen: { id in
                        if let item = season.results.first(where: { $0.id == id }) { onOpen(item) }
                    })
                    .stackIn()
                }
            }
        }
    }

    /// "ARS W 2–0": your teams' results inside a round's dates.
    private func inline(_ id: ResultRound.ID) -> String? {
        guard let round = rounds.first(where: { $0.id == id }) else { return nil }
        let parts = seasons.compactMap { season -> String? in
            guard let item = season.results.first(where: { round.first <= $0.day && $0.day <= round.last }) else { return nil }
            let r = TeamResult(item, team: season.team.id)
            guard let letter = r.letter else { return nil }
            let code = item.teams.first { $0.id == season.team.id }?.abbreviation ?? ""
            return [code, letter, r.score].compactMap { $0 }.joined(separator: " ")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

private struct RoundRow: View {
    let option: PeriodPicker.Option
    let mine: String?
    let selected: Bool
    let hovering: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(option.title)
                    .font(.system(size: 12, weight: selected ? .semibold : .regular))
                    .lineLimit(1)
                if option.detail != option.title {
                    Text(option.detail)
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 6)
                if let mine {
                    Text(mine)
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Color.primary.opacity(selected ? 0.10 : 0))
                .padding(.vertical, 1))
            .contentShape(Rectangle())
        }
        // The list's hover and press; the selection sits underneath.
        .buttonStyle(ListRowStyle(hovering: hovering && !selected, inset: 0))
        .padding(.horizontal, 6)
        .accessibilityLabel([option.title, option.detail == option.title ? nil : option.detail, mine].compactMap { $0 }.joined(separator: ", "))
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

/// A followed team's line under the rounds: crest, name, the last ten as a
/// form strip, its standing.
private struct YourTeamForm: View {
    let season: TeamSeason
    let onOpen: (String) -> Void
    @State private var hover = HighlightState()

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                LogoView(url: season.team.logo, size: 14)
                Text(season.team.name).font(.system(size: 12)).lineLimit(1)
                Spacer(minLength: 6)
                if let standing = season.standing {
                    Text(standing.components(separatedBy: " in ").first ?? standing)
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            FormStrip(marks: Array(season.form.suffix(10)), hover: hover, onOpen: onOpen)
            FormReadout(marks: Array(season.form.suffix(10)), hover: hover)
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 5)
    }
}

/// The arrow keys scroll the highlighted row into view (hover doesn't). It
/// reads the highlight in its own body, so a hover re-runs this, not the page.
private struct RowScroll: ViewModifier {
    let state: HighlightState
    let proxy: ScrollViewProxy
    let keyboardDriven: () -> Bool
    /// Game ID → the row's scroll ID.
    let position: [String: String]

    func body(content: Content) -> some View {
        content.onChange(of: state.id) { _, id in
            guard let id, keyboardDriven() else { return }
            proxy.scrollTo(position[id] ?? id)
        }
    }
}
