import AppKit
import SwiftUI

/// The Schedule page for any scope, facing either way in time: Upcoming or
/// Results (`mode`, the segmented control under the title, ⌘1 / ⌘2). Agenda
/// scopes (everything, a league, a team, your teams) share one layout per
/// mode; climbing and CS2 have season pages.
struct SchedulePage: View {
    let scope: ScheduleScope
    var mode: ScheduleMode = .upcoming
    let backTitle: String
    let onBack: () -> Void
    var onOpen: (Event) -> Void = { _ in }
    /// Another scope in place (chips, the title menu, a team's schedule).
    var onScope: (ScheduleScope) -> Void = { _ in }
    /// The same scope facing the other way, in place (no Back step).
    var onMode: (ScheduleMode) -> Void = { _ in }
    var onOpenBracket: (BracketSource, Set<String>) -> Void = { _, _ in }
    /// A climbing category's or a tournament's results page.
    var onOpenResults: (EventResultsRef) -> Void = { _ in }
    /// A deeper schedule, with a way back here (a league's own page from the
    /// calendar: its chip or its label in a day).
    var onDrill: (ScheduleScope) -> Void = { _ in }

    var body: some View {
        switch scope {
        case .climbing:
            ClimbingSeasonPage(backTitle: backTitle, onBack: onBack, onOpen: onOpen, onScope: onScope,
                               mode: mode, onMode: onMode, onOpenResults: onOpenResults)
        case .tournaments:
            TournamentsPage(backTitle: backTitle, onBack: onBack, onOpen: onOpen, onOpenBracket: onOpenBracket,
                            mode: mode, onMode: onMode, onOpenResults: onOpenResults)
        default:
            if mode == .results {
                ResultsAgendaPage(scope: scope, backTitle: backTitle, onBack: onBack, onOpen: onOpen, onScope: onScope,
                                  onMode: onMode, onDrill: onDrill)
                    .id(scope)
            } else {
                AgendaPage(scope: scope, backTitle: backTitle, onBack: onBack, onOpen: onOpen, onScope: onScope,
                           onMode: onMode, onDrill: onDrill)
                    // A different scope is a new page: no highlight or spy state carried over.
                    .id(scope)
            }
        }
    }
}

// MARK: - Scope chips

extension ScheduleChips {
    /// All, your teams, then (on the calendar) each league: a league chip
    /// opens its own schedule, climbing's season and CS2's tournaments included.
    /// The same row on Upcoming and Results; a league opens facing the same way.
    @MainActor
    static func scopes(_ scope: ScheduleScope, store: ScoreStore, onScope: @escaping (ScheduleScope) -> Void,
                       onDrill: @escaping (ScheduleScope) -> Void) -> ScheduleChips? {
        guard scope == .all || scope == .yourTeams || { if case .team = scope { true } else { false } }() else { return nil }
        var list = [Chip(scope: .all, title: "All")]
        if !store.followed.isEmpty {
            list.append(Chip(scope: .yourTeams, title: "Your Teams", symbol: "star.fill"))
            list += store.followed.prefix(6).map {
                Chip(scope: .team(ScheduleTeamRef(id: $0.id, name: $0.name, logo: $0.logo)), title: $0.name)
            }
        }
        var leagues: [Chip] = []
        if scope == .all {
            leagues = store.enabledLeagues.map { Chip(scope: .for(league: $0), title: $0.shortName, drills: true) }
        }
        guard list.count > 1 || !leagues.isEmpty else { return nil }
        let drills = Set(leagues.map(\.scope))
        return ScheduleChips(chips: list + leagues, selected: scope) { chosen in
            if drills.contains(chosen) { onDrill(chosen) } else { onScope(chosen) }
        }
    }
}

// MARK: - Header

/// Every agenda schedule's header, in either mode: Back, the scope as a
/// title menu, More (the mode's own items), and the Upcoming | Results
/// control under them.
struct ScheduleHeader<MoreItems: View>: View {
    @Environment(ScoreStore.self) private var store
    let scope: ScheduleScope
    let mode: ScheduleMode
    let backTitle: String
    let onBack: () -> Void
    let onScope: (ScheduleScope) -> Void
    let onMode: (ScheduleMode) -> Void
    @ViewBuilder let more: MoreItems

    var body: some View {
        VStack(spacing: 0) {
            TitleBarLayout {
                HStack(spacing: 6) { BackButton(title: backTitle, action: onBack) }
                titleMenu
                HStack(spacing: 6) { moreMenu }
            }
            .pageHeader()
            ScheduleModeSwitch(mode: mode, onChange: onMode)
        }
    }

    private var titleMenu: some View {
        PageTitleMenu(title: scope.title, help: "Choose a schedule") {
            Button("Schedule") { onScope(.all) }
            if !store.followed.isEmpty { Button("Your Teams") { onScope(.yourTeams) } }
            Section("Leagues") {
                ForEach(store.enabledLeagues) { league in
                    Button(league.name) { onScope(.for(league: league)) }
                }
            }
            if !store.followed.isEmpty {
                Section("Teams") {
                    ForEach(store.followed) { team in
                        Button(team.name) { onScope(.team(ScheduleTeamRef(id: team.id, name: team.name, logo: team.logo))) }
                    }
                }
            }
        }
    }

    private var moreMenu: some View {
        Menu {
            more
        } label: {
            Label("More", systemImage: "ellipsis")
                .labelStyle(.iconOnly)
                .font(.system(size: 12, weight: .medium))
                .frame(width: 28, height: 28)
                .contentShape(Circle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .foregroundStyle(.primary.opacity(0.75))
        .glass(in: Circle(), interactive: true)
        .fixedSize()
        .help("More")
    }
}

// MARK: - Title menu

/// A page title that's also a menu (Schedule's scope, climbing's season):
/// centered like `PageHeader`'s title (inside a `TitleBarLayout`), truncating
/// before it reaches a button, and the page's top heading, which VoiceOver
/// moves to when the page comes on screen.
struct PageTitleMenu<Items: View>: View {
    let title: String
    var enabled = true
    let help: String
    @ViewBuilder let items: Items
    @AccessibilityFocusState private var voiceOverFocus: Bool
    @Environment(\.pageLive) private var live

    var body: some View {
        Group {
            if enabled {
                Menu { items } label: {
                    HStack(spacing: 4) {
                        text
                        Image(systemName: "chevron.down").font(Glyph.link).foregroundStyle(.tertiary).accessibilityHidden(true)
                    }
                    .contentShape(Rectangle())
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .menuIndicator(.hidden)
                .help(help)
            } else {
                // Nothing to choose: a plain title, never a dimmed control.
                text.allowsHitTesting(false)
            }
        }
        .accessibilityLabel(title)
        .accessibilityHint(enabled ? help : "")
        .accessibilityAddTraits(.isHeader)
        .accessibilityHeading(.h1)
        .accessibilityFocused($voiceOverFocus)
        .task(id: live) {
            guard live else { return }
            try? await Task.sleep(for: .milliseconds(100))
            voiceOverFocus = true
        }
    }

    private var text: some View {
        Text(title).font(.system(size: 13, weight: .semibold)).lineLimit(1).truncationMode(.tail)
    }
}

// MARK: - Agenda

struct AgendaPage: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.scheduleStore) private var injected
    @Environment(\.stackArrival) private var page
    @Environment(\.panelLayout) private var layout
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(PanelCommands.self) private var commands: PanelCommands?
    let scope: ScheduleScope
    let backTitle: String
    let onBack: () -> Void
    let onOpen: (Event) -> Void
    let onScope: (ScheduleScope) -> Void
    var onMode: (ScheduleMode) -> Void = { _ in }
    var onDrill: (ScheduleScope) -> Void = { _ in }

    @State private var spy = ScrollSpy()
    @State private var topDay: DayKey?
    /// The hovered or arrow-keyed row. A reference, so a change updates only
    /// the rows whose highlight flips (`HighlightGate`), not this page.
    @State private var highlight = HighlightState()
    private var highlightedID: String? {
        get { highlight.id }
        nonmutating set { highlight.id = newValue }
    }
    @State private var keyboardDriven = false
    @State private var scrollTarget: (day: DayKey, animated: Bool)?
    @State private var arrival: StackArrival?
    @State private var upcomingLimit = AgendaPage.page
    // Folding days: the scores list's section choreography (see `toggle`).
    @State private var justToggled: DayKey?
    @State private var linking: DayKey?
    @State private var lastToggle = Date.distantPast
    @State private var toggleGeneration = 0
    @Namespace private var logoSpace
    @FocusState private var focused: Bool

    @Environment(\.resultsStore) private var injectedResults
    private var schedule: ScheduleStore { injected ?? .shared }
    private var results: ResultsStore { injectedResults ?? .shared }
    private var state: ScheduleStore.AgendaState? { schedule.agendas[scope] }
    private var today: DayKey { .today() }
    private var rowWidth: WidthClass { layout.split ? layout.column : layout.page }
    private static let contentSpace = "schedule.content"

    var body: some View {
        let agenda = schedule.agenda(scope, store: store)
        VStack(spacing: 0) {
            header(agenda).stackIn().pageChrome()
            content(agenda).frame(maxHeight: .infinity, alignment: .top)
            footer.pageChrome()
        }
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        // On appear, and again when the page comes back on screen.
        .keyFocusWhenLive($focused)
        .onKeyPress(.downArrow) { move(by: 1, agenda); return .handled }
        .onKeyPress(.upArrow) { move(by: -1, agenda); return .handled }
        .onKeyPress(.leftArrow) { step(-1, agenda); return .handled }
        .onKeyPress(.rightArrow) { step(1, agenda); return .handled }
        .onKeyPress(.return) { openHighlighted(agenda) }
        .onKeyPress(.space) { openHighlighted(agenda) }
        // While leagues are still streaming in, the panel grows with them but
        // doesn't shrink until the last has landed (no dip and bounce).
        .pageLoading(state?.updated == nil || state?.loading == true)
        .task(id: scope) {
            let first = state?.updated == nil
            await schedule.load(scope, store: store)
            // The first data cascades in like a page entrance (fades by keyboard).
            if first { arrival = .data(in: Self.contentSpace, page: page) }
        }
        // ⌘R is the panel's (one binding for every page): it refreshes the
        // scores and bumps the token, and the schedule follows.
        .onChange(of: commands?.refreshToken) { refresh() }
    }

    // MARK: Header and navigator

    private func header(_ agenda: (earlier: [AgendaDay], upcoming: [AgendaDay])) -> some View {
        VStack(spacing: 0) {
            ScheduleHeader(scope: scope, mode: .upcoming, backTitle: backTitle, onBack: onBack, onScope: onScope,
                           onMode: onMode) { moreItems }
            navigator(agenda)
            ShortcutButton(key: "t") { goToday(agenda) }
        }
    }

    private var filterable: Bool {
        switch scope {
        case .all: true
        case let .league(id): League.with(id: id).map { store.isFilterOn($0) && !store.picks(for: $0).isEmpty || $0.id == "college-football" } ?? false
        default: false
        }
    }

    @ViewBuilder
    private var moreItems: some View {
        Button("Today") { goToday(schedule.agenda(scope, store: store)) }.keyboardShortcut("t")
        // Shows ⌘R; whichever binding takes the key, it's the panel's refresh.
        Button("Refresh") { if let commands { commands.refresh(store) } else { refresh() } }.keyboardShortcut("r")
        if case .league = scope, filterable {
            let all = schedule.showAllGames.contains(scope)
            Divider()
            Button(all ? "Show Your Picks" : "Show All Games") {
                if all { schedule.showAllGames.remove(scope) } else { schedule.showAllGames.insert(scope) }
                refresh(force: false)
            }
        }
    }

    @ViewBuilder
    private func navigator(_ agenda: (earlier: [AgendaDay], upcoming: [AgendaDay])) -> some View {
        switch scope.navigator {
        case .weekStrip:
            let (from, _) = schedule.window(scope)
            let days = (0..<7).map { from.adding(days: $0) }
            WeekStrip(days: days, today: today, selected: topDay ?? agenda.upcoming.first?.day ?? from, dots: dots(agenda),
                      onSelect: { jump(to: $0, agenda) },
                      onPrevious: { moveWindow(-7) }, onNext: { moveWindow(7) })
        case .weekPicker:
            WeekPicker(week: schedule.selectedWeek[scope], weeks: state?.calendar?.weeks ?? []) { week in
                Task { await schedule.selectWeek(week, for: scope, store: store) }
            }
        case .monthBar:
            MonthBar(month: topDay ?? agenda.upcoming.first?.day ?? agenda.earlier.last?.day, summary: teamSummary,
                     onPrevious: { jumpMonth(-1, agenda) }, onNext: { jumpMonth(1, agenda) })
        case .list, .none:
            // A list of game days needs no control: it starts at the next one.
            EmptyView()
        }
    }

    private var teamSummary: String? {
        guard case let .team(team) = scope else { return nil }
        return [team.name, state?.summary].compactMap { $0 }.joined(separator: " · ")
    }

    /// Dots under the strip: games (from the league's calendar or the
    /// loaded items), a followed team (accent), live now (red).
    private func dots(_ agenda: (earlier: [AgendaDay], upcoming: [AgendaDay])) -> [DayKey: WeekStrip.Dot] {
        var dots: [DayKey: WeekStrip.Dot] = [:]
        if let calendar = state?.calendar {
            let (from, _) = schedule.window(scope)
            for day in (0..<7).map({ from.adding(days: $0) }) where calendar.plays(on: day) == true { dots[day] = .games }
        }
        for day in agenda.earlier + agenda.upcoming {
            for item in day.items {
                var dot = WeekStrip.Dot.games
                if item.teams.contains(where: { $0.id.map { id in store.followed.contains { $0.id == id } } ?? false }) { dot = .followed }
                // Only games around today can be live: don't look the rest up.
                if item.status == .live || abs(today.days(to: day.day)) <= 1 && store.current(item.event()).state == .live { dot = .live }
                dots[day.day] = max(dots[day.day] ?? .games, dot)
            }
        }
        return dots
    }

    // MARK: Content

    @ViewBuilder
    private func content(_ agenda: (earlier: [AgendaDay], upcoming: [AgendaDay])) -> some View {
        if state?.updated == nil, state?.failed != true {
            ScheduleSkeleton()
        } else if state?.failed == true, agenda.upcoming.isEmpty, agenda.earlier.isEmpty {
            // The schedule loads when asked: nothing retries on its own.
            ErrorState("Schedule") { refresh() }
        } else {
            ScrollViewReader { proxy in
                PageScrollView {
                    // Not lazy, like the scores list: days fold instead (a folded
                    // day builds no rows), and a team's season is capped.
                    let defaults = Agenda.defaultOpen(agenda.upcoming, today: today)
                    VStack(alignment: .leading, spacing: 0) {
                        if let chips { chips.stackIn() }
                        resultsLink(agenda)
                        if agenda.upcoming.isEmpty { emptyWeek.stackIn() }
                        nextJump(agenda)
                        // Folded days build no rows, so a long week stays light;
                        // pages that don't fold (a team's) are capped instead.
                        let upcoming = scope.foldsDays ? (days: agenda.upcoming, hidden: 0)
                            : Self.cap(agenda.upcoming, items: upcomingLimit, fromEnd: false)
                        days(upcoming.days) { _ in defaults }
                        if upcoming.hidden > 0 {
                            moreButton("Show \(min(upcoming.hidden, Self.page)) More") { upcomingLimit += Self.page }
                        }
                        if scope.navigator == .list, state?.more == true {
                            moreButton(state?.loading == true ? "Loading…" : "Show Next \(ScheduleStore.listPage) Game Days") {
                                Task { await schedule.loadMore(scope, store: store) }
                            }
                            .disabled(state?.loading == true)
                        }
                        footnotes.stackIn()
                    }
                    .padding(.bottom, 10)
                    .coordinateSpace(name: Self.contentSpace)
                    .environment(\.stackArrival, arrival ?? page)
                }
                .coordinateSpace(name: ScrollSpy.space)
                .modifier(HighlightScroll(state: highlight, proxy: proxy, keyboardDriven: { keyboardDriven }))
                .onChange(of: scrollTarget?.day) { _, day in
                    guard let day, let animated = scrollTarget?.animated else { return }
                    if animated, !reduceMotion {
                        withAnimation(Motion.standard) { proxy.scrollTo("day-\(day)", anchor: .top) }
                    } else {
                        proxy.scrollTo("day-\(day)", anchor: .top)
                    }
                    scrollTarget = nil
                }
            }
        }
    }

    /// Rows per page of a long season.
    private static let page = 40

    /// The first (or last) `items` rows of the days, and how many more there are.
    static func cap(_ days: [AgendaDay], items: Int, fromEnd: Bool) -> (days: [AgendaDay], hidden: Int) {
        let total = days.reduce(0) { $0 + $1.items.count }
        guard total > items else { return (days, 0) }
        var kept: [AgendaDay] = []
        var count = 0
        for day in fromEnd ? days.reversed() : days {
            guard count < items else { break }
            kept.append(day)
            count += day.items.count
        }
        return (fromEnd ? kept.reversed() : kept, max(total - count, 0))
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

    private var chips: ScheduleChips? { .scopes(scope, store: store, onScope: onScope, onDrill: onDrill) }

    /// Days in order. A team's schedule (a game a day, days that don't fold)
    /// goes two-up across a split panel, day by day, instead of leaving the
    /// right half empty all season.
    @ViewBuilder
    private func days(_ days: [AgendaDay], defaults: @escaping (AgendaDay) -> Set<DayKey>) -> some View {
        if twoUpDays {
            RowGrid(columns: layout.columns) {
                ForEach(days) { day in
                    VStack(alignment: .leading, spacing: 0) { dayView(day, defaults: defaults(day), rowColumns: 1) }
                }
            }
        } else {
            ForEach(days) { day in dayView(day, defaults: defaults(day)) }
        }
    }

    private var twoUpDays: Bool { !scope.foldsDays && layout.split }

    @ViewBuilder
    private func dayView(_ day: AgendaDay, defaults: Set<DayKey>, rowColumns: Int? = nil) -> some View {
        let folds = scope.foldsDays
        let open = !folds || schedule.isOpen(day.day, in: scope, defaults: defaults)
        let maxLogos = CollapsedPreview.maxLogos(for: layout.page)
        let linked = linking == day.day ? logoSpace : nil
        Group {
            if folds {
                ScheduleFoldingDayHeader(day: day, today: today, open: open, count: Agenda.count(day),
                                         leagues: scope == .all ? Agenda.leagues(day) : nil,
                                         justToggled: justToggled == day.day, maxLogos: maxLogos) {
                    toggle(day.day, defaults: defaults)
                }
                .environment(\.logoNamespace, linked)
            } else {
                ScheduleDayHeader(day: day.day, today: today)
            }
        }
        .id("day-\(day.day)")
        .onGeometryChange(for: Bool.self) { $0.frame(in: .named(ScrollSpy.space)).minY <= 8 } action: { above in
            let current = spy.report(day.day, above: above)
            if current != topDay { topDay = current }
        }
        .stackIn()
        if open {
            let staggered = justToggled == day.day
            let handOffs = staggered || linking == day.day ? ScheduleDayPreview.handOffs(day, limit: maxLogos) : [:]
            let order = staggered ? Dictionary(day.items.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { a, _ in a }) : [:]
            // Labels and notes reveal with the rows they head, so nothing new
            // shows over the days still sliding down.
            let delay = { (id: String?) in id.flatMap { order[$0] }.map { ScoresGrid.revealDelay(index: $0, columns: layout.columns) } }
            VStack(alignment: .leading, spacing: 0) {
                ForEach(day.groups) { group in
                    if scope == .all {
                        ScheduleGroupLabel(title: group.title, symbol: group.symbol,
                                           onOpen: League.with(id: group.league).map { league in { onDrill(.for(league: league)) } })
                            .revealOnAppear(after: delay(group.items.first?.id))
                            .stackIn()
                    }
                    let timed = group.items.filter(\.start.isKnown), untimed = group.items.filter { !$0.start.isKnown }
                    rows(timed, handOffs: handOffs, order: order, columns: rowColumns)
                    if !untimed.isEmpty {
                        if !timed.isEmpty {
                            ScheduleNote(text: "Time TBA").revealOnAppear(after: delay(untimed.first?.id)).stackIn()
                        }
                        rows(untimed, handOffs: handOffs, order: order, columns: rowColumns)
                    }
                }
                if !day.byes.isEmpty {
                    ScheduleNote(text: "Bye: " + day.byes.joined(separator: ", ")).revealOnAppear(after: delay(day.items.last?.id)).stackIn()
                }
            }
            // Rows arrive in place (crests travel, text reveals) and leave
            // quickly, faster than they came.
            .transition(.asymmetric(insertion: .identity, removal: .opacity.animation(Motion.exit)))
            .environment(\.logoNamespace, linked)
        }
    }

    /// Rows in one column, or two from the split (the scores list's grid);
    /// an open tournament day lists its matches right after it.
    private func rows(_ items: [ScheduleItem], handOffs: [String: Set<String>] = [:], order: [String: Int] = [:],
                      columns: Int? = nil) -> some View {
        let shown = items.flatMap { item -> [ScheduleItem] in
            schedule.expanded.contains(item.id) ? [item] + (item.children ?? []) : [item]
        }
        return RowGrid(columns: columns ?? layout.columns) {
            ForEach(shown) { item in
                HighlightGate(state: highlight, id: item.id) { lit in
                    ScheduleRow(item: item, highlighted: lit, keyboard: lit && highlight.keyboard, width: rowWidth,
                                showsCompetition: showsCompetition(item), expanded: schedule.expanded.contains(item.id),
                                onHover: { inside in
                                    if inside {
                                        highlight.keyboard = false
                                        highlightedID = item.id
                                    } else if highlightedID == item.id { highlightedID = nil }
                                },
                                onSelect: select,
                                onTeamSchedule: { team in
                                    if let id = team.id { onScope(.team(ScheduleTeamRef(id: id, name: team.name, logo: team.logo))) }
                                },
                                logoMatches: handOffs[item.id] ?? [],
                                revealDelay: order[item.id].map { ScoresGrid.revealDelay(index: $0, columns: layout.columns) })
                        .equatable()
                }
                .id(item.id)
                .stackIn()
            }
        }
        // One status width for the group: every score in it sits in one column.
        .environment(\.statusColumnWidth, ScheduleRow.statusWidth(shown, store: store, width: rowWidth))
    }

    // MARK: Folding

    /// The scores list's section toggle, for a day. A deliberate click links
    /// the preview's crests to the rows', then unfolds on the next pass so the
    /// crests travel while the text staggers in. Clicks faster than that
    /// choreography (or Reduce Motion) skip it for a quick plain change; a key
    /// press changes instantly.
    private func toggle(_ day: DayKey, defaults: Set<DayKey>) {
        let flip = { schedule.setOpen(!schedule.isOpen(day, in: scope, defaults: defaults), day: day, in: scope) }
        let now = Date()
        let rapid = now.timeIntervalSince(lastToggle) < 0.45
        lastToggle = now
        toggleGeneration += 1
        let generation = toggleGeneration
        var instant = Transaction()
        instant.disablesAnimations = true
        if rapid || reduceMotion || isKeyboard {
            withTransaction(instant) {
                justToggled = nil
                linking = nil
            }
            if isKeyboard { withTransaction(instant, flip) } else { withAnimation(reduceMotion ? Motion.fade : Motion.exit, flip) }
            return
        }
        let run = {
            // Overtaken by a faster click before it began: still count it.
            guard generation == toggleGeneration else {
                withTransaction(instant, flip)
                return
            }
            justToggled = day
            // One transaction, so preview crests and row crests trade places
            // together; the travel starts just after the rows are built.
            withAnimation(Motion.travel.delay(0.04), flip)
            Task {
                try? await Task.sleep(for: .seconds(0.8))
                // A newer toggle owns the state now.
                guard generation == toggleGeneration else { return }
                justToggled = nil
                linking = nil
            }
        }
        // Link the crests first, so the frame before the toggle registers
        // where they start, and toggle on the next pass.
        linking = day
        DispatchQueue.main.async(execute: run)
    }

    /// Unfolds a day being jumped to (the strip, the arrow keys, "Next"), instantly.
    private func unfold(_ day: DayKey) {
        guard scope.foldsDays else { return }
        let defaults = Agenda.defaultOpen(schedule.agenda(scope, store: store).upcoming, today: today)
        guard !schedule.isOpen(day, in: scope, defaults: defaults) else { return }
        var instant = Transaction()
        instant.disablesAnimations = true
        withTransaction(instant) { schedule.setOpen(true, day: day, in: scope) }
    }

    /// List pages: when the next game day is more than a day off, say so at the top.
    @ViewBuilder
    private func nextJump(_ agenda: (earlier: [AgendaDay], upcoming: [AgendaDay])) -> some View {
        if scope.navigator == .list, let next = agenda.upcoming.first?.day, today.days(to: next) > 1 {
            Button {
                unfold(next)
                scrollTarget = (next, !isKeyboard)
            } label: {
                HStack(spacing: 4) {
                    Text("Next: \(next.mediumLabel)")
                    Text("in \(plural(today.days(to: next), "day"))").foregroundStyle(.secondary)
                    Image(systemName: "chevron.right").font(Glyph.row).accessibilityHidden(true)
                }
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.accentColor)
                .padding(.horizontal, Metrics.gutter)
                .padding(.top, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .stackIn()
        }
    }

    private func showsCompetition(_ item: ScheduleItem) -> Bool {
        if case .league = scope { return false }
        return item.children == nil
    }

    // MARK: Results

    /// Where Earlier's expansion was: one line that switches to Results.
    /// "Latest: Matchweek 8 · 10 results ›"; a team's "Last: ARS 2–0 EVE · W W W D W ›".
    private func resultsLink(_ agenda: (earlier: [AgendaDay], upcoming: [AgendaDay])) -> some View {
        ResultsLinkRow(title: resultsTitle(agenda)) { onMode(.results) }
            .stackIn()
    }

    private func resultsTitle(_ agenda: (earlier: [AgendaDay], upcoming: [AgendaDay])) -> String {
        if case let .team(team) = scope {
            let items = agenda.earlier.flatMap(\.items).filter { $0.status == .final }
            if let last = items.max(by: { $0.sortDate < $1.sortDate }) {
                let form = Agenda.form(items, teamID: team.id).joined(separator: " ")
                return ["Last: " + ScheduleSpeech.result(last), form].filter { !$0.isEmpty }.joined(separator: " · ")
            }
            return "Results"
        }
        // What Results already knows (nothing loads for a link).
        if let state = results.state(scope), let round = state.round {
            let finals = state.items.filter { $0.status == .final }.count
            // The round Results shows: the newest, unless one further back was picked.
            let lead = round.id == state.rounds.last?.id ? "Latest" : "Results"
            return "\(lead): \(round.title)" + (finals > 0 ? " · \(plural(finals, "result"))" : "")
        }
        return "Results"
    }

    // MARK: Empty and footnotes

    @ViewBuilder
    private var emptyWeek: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(emptyText)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
            if let next = nextGameDay {
                Button {
                    jumpWindow(to: next)
                } label: {
                    HStack(spacing: 3) {
                        Text("Next: \(next.mediumLabel)")
                        Image(systemName: "chevron.right").font(Glyph.row).accessibilityHidden(true)
                    }
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.accentColor)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 18)
    }

    private var emptyText: String {
        switch scope.navigator {
        case .monthBar: "Nothing coming up."
        case .list: "No games scheduled."
        case .weekPicker: "No games this week."
        default: scope == .all ? "Nothing on this week in your leagues." : "No games this week."
        }
    }

    private var nextGameDay: DayKey? {
        guard scope.navigator == .weekStrip else { return nil }
        return state?.calendar?.nextDay(onOrAfter: schedule.window(scope).to.adding(days: 1))
    }

    @ViewBuilder
    private var footnotes: some View {
        let quiet = (state?.quiet ?? []).compactMap(League.with(id:))
        if scope == .all, !quiet.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                let withNext = quiet.filter { state?.nextDay[$0.id] != nil }
                let without = quiet.filter { state?.nextDay[$0.id] == nil }
                ForEach(withNext) { league in
                    Button {
                        onScope(.for(league: league))
                    } label: {
                        Text("\(league.name): next \(state?.nextDay[league.id]?.mediumLabel ?? "")")
                            .underline(false)
                    }
                    .buttonStyle(.plain)
                    .help("\(league.name) schedule")
                    .accessibilityLabel("\(league.name) schedule, next games \(state?.nextDay[league.id]?.longLabel ?? "")")
                }
                if !without.isEmpty {
                    Text("No games this week: " + without.map(\.name).joined(separator: ", "))
                }
            }
            .font(.system(size: 11))
            // Information, not decoration: secondary ink.
            .foregroundStyle(.secondary)
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, 16)
            .readableWidth()
        }
    }

    // MARK: Footer

    private var footer: some View {
        HStack {
            UpdatedLabel(text: updatedText, offline: { state?.stale == true && state?.updated != nil })
            Spacer()
            Button("Today") { goToday(schedule.agenda(scope, store: store)) }
                .buttonStyle(.plain)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .help("Today (⌘T)")
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 8)
    }

    private func updatedText(now: Date) -> String {
        let zone = TimeZone.current.abbreviation() ?? ""
        guard let updated = state?.updated else { return state?.loading == true ? "Updating…" : "Times in \(zone)" }
        if state?.stale == true { return "Can't connect · Showing schedule from \(updated.formatted(date: .omitted, time: .shortened))" }
        return "\(UpdatedLabel.ago(updated, now: now)) · Times in \(zone)"
    }

    // MARK: Actions

    private func select(_ item: ScheduleItem) {
        if item.children != nil {
            // A tournament day opens in place: a key press changes it at once;
            // a click opens on the standard spring and closes faster, on `exit`.
            let opening = !schedule.expanded.contains(item.id)
            let flip = { if opening { schedule.expanded.insert(item.id) } else { schedule.expanded.remove(item.id) } }
            if isKeyboard {
                var instant = Transaction()
                instant.disablesAnimations = true
                withTransaction(instant, flip)
            } else {
                withAnimation(opening ? (reduceMotion ? Motion.fade : Motion.standard) : Motion.exit, flip)
            }
            return
        }
        if case .climbing = item.ref { onScope(.climbing); return }
        onOpen(store.current(item.event()))
    }

    private func refresh(force: Bool = true) {
        Task { await schedule.load(scope, store: store, force: force) }
    }

    private var isKeyboard: Bool { NSApp.currentEvent?.type == .keyDown }

    private func jump(to day: DayKey, _ agenda: (earlier: [AgendaDay], upcoming: [AgendaDay])) {
        // A day without games scrolls to the next one that has some.
        let target = agenda.upcoming.first { $0.day >= day }?.day ?? agenda.upcoming.last?.day
        guard let target else { return }
        unfold(target)
        scrollTarget = (target, !isKeyboard)
    }

    private func moveWindow(_ days: Int) {
        spy.reset()
        topDay = nil
        Task { await schedule.moveWindow(scope, by: days, store: store) }
    }

    private func jumpWindow(to day: DayKey) {
        spy.reset()
        topDay = nil
        schedule.windowStart[scope] = day
        Task { await schedule.moveWindow(scope, by: 0, store: store) }
    }

    private func jumpMonth(_ direction: Int, _ agenda: (earlier: [AgendaDay], upcoming: [AgendaDay])) {
        let current = topDay ?? agenda.upcoming.first?.day ?? today
        let days = agenda.upcoming.map(\.day)
        let target: DayKey? = direction > 0
            ? days.first { ($0.year, $0.month) > (current.year, current.month) }
            : days.last { ($0.year, $0.month) < (current.year, current.month) }.map { d in days.first { $0.year == d.year && $0.month == d.month } ?? d }
        if let target { scrollTarget = (target, !isKeyboard) }
    }

    private func goToday(_ agenda: (earlier: [AgendaDay], upcoming: [AgendaDay])) {
        switch scope.navigator {
        case .weekStrip:
            if schedule.window(scope).from != today {
                spy.reset()
                topDay = nil
                Task { await schedule.showToday(scope, store: store) }
            } else if let first = agenda.upcoming.first?.day {
                unfold(first)
                scrollTarget = (first, !isKeyboard)
            }
        case .weekPicker:
            schedule.selectedWeek[scope] = nil
            Task { await schedule.load(scope, store: store) }
        default:
            if let first = agenda.upcoming.first?.day { scrollTarget = (first, !isKeyboard) }
        }
    }

    // MARK: Keyboard

    private func navigable(_ agenda: (earlier: [AgendaDay], upcoming: [AgendaDay])) -> [ScheduleItem] {
        // Only rows on screen: a folded day's rows aren't built.
        let defaults = Agenda.defaultOpen(agenda.upcoming, today: today)
        let upcoming = scope.foldsDays
            ? agenda.upcoming.filter { schedule.isOpen($0.day, in: scope, defaults: defaults) }
            : Self.cap(agenda.upcoming, items: upcomingLimit, fromEnd: false).days
        let days = upcoming
        return days.flatMap { day in
            day.groups.flatMap { group in
                group.items.flatMap { item in schedule.expanded.contains(item.id) ? [item] + (item.children ?? []) : [item] }
            }
        }
    }

    private func move(by delta: Int, _ agenda: (earlier: [AgendaDay], upcoming: [AgendaDay])) {
        let rows = navigable(agenda)
        guard !rows.isEmpty else { return }
        keyboardDriven = true
        highlight.keyboard = true
        let current = rows.firstIndex { $0.id == highlightedID }
        let next = current.map { min(max($0 + delta, 0), rows.count - 1) } ?? (delta > 0 ? 0 : rows.count - 1)
        highlightedID = rows[next].id
        DispatchQueue.main.async { keyboardDriven = false }
    }

    private func step(_ direction: Int, _ agenda: (earlier: [AgendaDay], upcoming: [AgendaDay])) {
        switch scope.navigator {
        case .weekStrip:
            let days = agenda.upcoming.map(\.day)
            let current = topDay ?? days.first ?? today
            let target = direction > 0 ? days.first { $0 > current } : days.last { $0 < current }
            if let target {
                unfold(target)
                scrollTarget = (target, false)
            } else {
                moveWindow(7 * direction)
            }
        case .weekPicker:
            let weeks = state?.calendar?.weeks ?? []
            guard let week = schedule.selectedWeek[scope], let i = weeks.firstIndex(of: week),
                  weeks.indices.contains(i + direction) else { return }
            Task { await schedule.selectWeek(weeks[i + direction], for: scope, store: store) }
        case .monthBar:
            jumpMonth(direction, agenda)
        case .list:
            let days = agenda.upcoming.map(\.day)
            let current = topDay ?? days.first ?? today
            if let target = direction > 0 ? days.first(where: { $0 > current }) : days.last(where: { $0 < current }) {
                unfold(target)
                scrollTarget = (target, false)
            }
        case .none:
            break
        }
    }

    private func openHighlighted(_ agenda: (earlier: [AgendaDay], upcoming: [AgendaDay])) -> KeyPress.Result {
        guard let id = highlightedID, let item = navigable(agenda).first(where: { $0.id == id }) else { return .ignored }
        select(item)
        return .handled
    }
}

/// A link's press: it dims while held (the quiet links' feedback).
private struct LinkPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.6 : 1)
            .animation(Motion.press, value: configuration.isPressed)
    }
}

/// Upcoming's one line to Results (it replaced Earlier's expansion): quiet
/// text, a chevron, brighter under the pointer. Switches the mode in place.
struct ResultsLinkRow: View {
    let title: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(title)
                    .font(.system(size: 11.5).monospacedDigit())
                    .lineLimit(1)
                    .truncationMode(.tail)
                Image(systemName: "chevron.right").font(Glyph.row).accessibilityHidden(true)
                Spacer(minLength: 0)
            }
            .foregroundStyle(hovering ? .primary : .secondary)
            .padding(.horizontal, Metrics.gutter)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(LinkPressStyle())
        .onHover { hovering = $0 }
        .help("Results (⌘2)")
        .accessibilityLabel("\(title). Show results")
    }
}
