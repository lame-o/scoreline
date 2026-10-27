import AppKit
import SwiftUI

// The season pages in results mode (climbing, CS2 tournaments), their rows,
// and the league page's preview. Rows are the Upcoming pages' rows, finished:
// a climbing competition says its winners, a tournament its champion. Depth
// lives one level down (a category's full results, a tournament's page).

// MARK: - Climbing: the season, finished

/// The climbing season page in results mode: finished competitions newest
/// first, past seasons in the title menu, each competition's podiums and
/// rounds in place.
struct ClimbingResultsPage: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.seasonResultsStore) private var injected
    @Environment(\.stackArrival) private var page
    @Environment(\.panelLayout) private var layout
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(PanelCommands.self) private var commands: PanelCommands?
    let backTitle: String
    let onBack: () -> Void
    let onOpen: (Event) -> Void
    let onMode: (ScheduleMode) -> Void
    let onOpenResults: (EventResultsRef) -> Void
    @State private var arrival: StackArrival?
    /// The competition under the pointer or the arrow keys, in the list or on
    /// the timeline (a reference: a move redraws the timeline and two rows, not the page).
    @State private var hover = HighlightState()
    @State private var keyboardDriven = false
    @FocusState private var focused: Bool
    /// How far the season card has docked (read by the docked bar, never by this page).
    @State private var geometry = PageGeometry()
    @State private var actions = SeasonDockActions()
    #if DEBUG
    /// Harness counter: body runs (scrolling must add none).
    static var bodyRuns = 0
    #endif

    private var results: SeasonResultsStore { injected ?? .shared }
    private var box: SeasonResultsStore.Climbing { results.climbing }
    private var season: [SeasonEvent] { store.tracked(box.current.filter { $0.status != .canceled }) }
    private var finished: [SeasonEvent] { SeasonResults.finished(store.tracked(box.current)) }
    private static let contentSpace = "climbing.results"
    static let lanes = [SeasonTimeline.Lane(id: "boulder", label: "Boulder"),
                        SeasonTimeline.Lane(id: "lead", label: "Lead"),
                        SeasonTimeline.Lane(id: "speed", label: "Speed")]

    var body: some View {
        #if DEBUG
        let _ = Self.bodyRuns += 1
        #endif
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                header
                ScheduleModeSwitch(mode: .results, onChange: onMode)
            }
            .stackIn()
            .pageChrome()
            content.frame(maxHeight: .infinity, alignment: .top)
            SeasonFooter(updated: box.updated, stale: box.stale, loading: box.loading, subject: "results").pageChrome()
        }
        // Keys never animate: ↑ ↓ move between competitions, → opens one, ← closes it.
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .keyFocusWhenLive($focused)
        .onKeyPress(.downArrow) { move(1); return .handled }
        .onKeyPress(.upArrow) { move(-1); return .handled }
        .onKeyPress(.rightArrow) { setOpen(true) }
        .onKeyPress(.leftArrow) { setOpen(false) }
        .onKeyPress(.return) { toggleHighlighted() }
        .onKeyPress(.space) { toggleHighlighted() }
        .pageLoading(box.updated == nil && !box.failed)
        .task {
            let first = box.updated == nil
            await results.loadClimbing(disciplines: store.climbingDisciplines)
            // The league page may have loaded the season with only its newest winners.
            if let season = box.season {
                await results.loadDetails(season: season, limit: nil, force: false, disciplines: store.climbingDisciplines)
            }
            if first { arrival = .data(in: Self.contentSpace, page: page) }
        }
        // ⌘R (the panel's one binding) reloads the results too.
        .onChange(of: commands?.refreshToken) { reload() }
    }

    private func reload() {
        Task { await results.loadClimbing(force: true, disciplines: store.climbingDisciplines) }
    }

    // MARK: Header

    private var header: some View {
        TitleBarLayout {
            HStack(spacing: 6) { BackButton(title: backTitle, action: onBack) }
            PageTitleMenu(title: box.season.map { "\($0) Season" } ?? "Climbing Results", enabled: box.menu.count > 1,
                          help: "Choose a season") {
                ForEach(box.menu, id: \.self) { name in
                    Button {
                        Task { await results.selectSeason(name) }
                    } label: {
                        if name == box.season { Label("\(name) Season", systemImage: "checkmark") } else { Text("\(name) Season") }
                    }
                }
            }
            HStack(spacing: 6) {}
        }
        .pageHeader()
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if (box.updated == nil && !box.failed) || (box.loading && box.current.isEmpty) {
            SeasonSkeleton()
        } else if box.current.isEmpty, box.failed {
            ErrorState("Results", retry: reload)
        } else if finished.isEmpty {
            EmptyState(symbol: "flag.checkered", title: "No Results Yet",
                       message: "No finished competitions in \(box.season ?? "this season") yet.") {
                Button("Show Upcoming") { onMode(.upcoming) }.controlSize(.small)
            }
        } else {
            let summary = SeasonSummary.results(season: box.season, finished: finished.count, total: season.count), axis = self.axis
            PageScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    SeasonCard(summary: summary, axis: axis, hover: hover, onSelect: { select($0) }) { EmptyView() }
                        .padding(.horizontal, 10)
                        .padding(.top, 4)
                        .stackIn()
                    if layout.split {
                        HStack(alignment: .top, spacing: 0) {
                            list(expandable: false).frame(maxWidth: .infinity, alignment: .top)
                            if let selected = selectedEvent {
                                ClimbingResultsDetail(event: selected, yours: yours(selected), countries: Set(store.climbingCountries),
                                                      showsHeader: true, onOpen: onOpen, onOpenResults: onOpenResults)
                                    .padding(.top, 18)
                                    .frame(maxWidth: .infinity, alignment: .top)
                                    .environment(\.widthClass, layout.column)
                                    .stackIn()
                            }
                        }
                    } else {
                        list(expandable: true)
                    }
                }
                .padding(.bottom, 12)
                .coordinateSpace(name: Self.contentSpace)
                .environment(\.stackArrival, arrival ?? page)
            }
            // As the card tucks under the header, its docked bar settles in:
            // an overlay, so it never changes the page's measured height.
            .overlay(alignment: .top) {
                DockedBarHost { dockBar(summary, axis).equatable() }
            }
            .modifier(DockedHighlightScroll(state: hover, geometry: geometry, keyboardDriven: { keyboardDriven }))
            .environment(\.pageGeometry, geometry)
        }
    }

    /// Hovered, else the one open beside the list, else the latest result.
    private var axis: SeasonAxis {
        let present = Set(season.flatMap(\.lanes))
        return SeasonAxis(events: season, lanes: Self.lanes.filter { present.contains($0.id) }, today: .today(), next: nil,
                          selected: layout.split ? selectedEvent?.id : nil,
                          readouts: Dictionary(season.map { ($0.id, readoutText($0)) }, uniquingKeysWith: { a, _ in a }),
                          resting: layout.split ? selectedEvent?.id : finished.first?.id)
    }

    private func dockBar(_ summary: SeasonSummary, _ axis: SeasonAxis) -> SeasonDockBar {
        // Refreshed every render: a click acts on the page as it is now.
        actions.reveal = { reveal($0) }
        return SeasonDockBar(summary: summary, axis: axis, hover: hover, actions: actions)
    }

    /// A mark clicked in the docked bar: the competition opens (or shows
    /// beside the list) and its row scrolls up to just under the bar.
    private func reveal(_ id: String) {
        guard finished.contains(where: { $0.id == id }) else { return }
        if layout.split || !box.expanded.contains(id) { select(id) }
        geometry.scroll(toAnchor: id, topInset: SeasonDock.reserve, animated: !reduceMotion)
    }

    /// Months newest first, each keeping the list's order: what's on screen, top to bottom.
    static func byMonth<T>(_ items: [T], day: (T) -> DayKey) -> [(DayKey, [T])] {
        let grouped = Dictionary(grouping: items) { DayKey(year: day($0).year, month: day($0).month, day: 1) }
        return grouped.keys.sorted(by: >).map { ($0, grouped[$0] ?? []) }
    }

    // MARK: Keys

    private func move(_ delta: Int) {
        let rows = Self.byMonth(finished) { $0.startDay }.flatMap(\.1).map(\.id)
        guard !rows.isEmpty else { return }
        keyboardDriven = true
        hover.keyboard = true
        let current = rows.firstIndex { $0 == hover.id }
        let next = current.map { min(max($0 + delta, 0), rows.count - 1) } ?? (delta > 0 ? 0 : rows.count - 1)
        hover.id = rows[next]
        // Split: the arrows walk the list and the detail follows.
        if layout.split { box.selected = rows[next] }
        DispatchQueue.main.async { keyboardDriven = false }
    }

    private func setOpen(_ open: Bool) -> KeyPress.Result {
        guard !layout.split, let id = hover.id, finished.contains(where: { $0.id == id }) else { return .ignored }
        if box.expanded.contains(id) != open { openOrClose(id, animated: false) }
        return .handled
    }

    private func toggleHighlighted() -> KeyPress.Result {
        guard let id = hover.id, finished.contains(where: { $0.id == id }) else { return .ignored }
        if layout.split { box.selected = id } else { openOrClose(id, animated: false) }
        return .handled
    }

    private var selectedEvent: SeasonEvent? {
        finished.first { $0.id == box.selected } ?? finished.first
    }

    private func yours(_ event: SeasonEvent) -> [String: [CountryBest]] {
        guard case let .climbing(id) = event.kind, !box.yours.isEmpty else { return [:] }
        return box.yours.filter { $0.key.hasPrefix("\(id)-") }
    }

    /// "Santiago · Oct 23–25 · 🥇 Zhao, Deng, Utelli, Garnbret"
    private func readoutText(_ e: SeasonEvent) -> String {
        let winners = SeasonResults.winnerNames(e)
        return [e.shortName, DayKey.range(e.startDay, e.endDay),
                e.status == .finished ? (winners.isEmpty ? "Finished" : "🥇 " + winners.joined(separator: ", ")) : "Upcoming"]
            .joined(separator: " · ")
    }

    private func list(expandable: Bool) -> some View {
        let months = Self.byMonth(finished) { $0.startDay }
        let countries = Set(store.climbingCountries)
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(months, id: \.0) { month, events in
                MonthLabel(month: month).stackIn()
                ForEach(events) { event in
                    let open = expandable ? box.expanded.contains(event.id) : selectedEvent?.id == event.id
                    HighlightGate(state: hover, id: event.id) { lit in
                        ClimbingEventRow(event: event, open: open, highlighted: lit, chevron: expandable) { select(event.id) }
                            .equatable()
                    }
                    .onHover { inside in
                        if inside {
                            hover.keyboard = false
                            hover.id = event.id
                        } else if hover.id == event.id, !hover.keyboard {
                            hover.id = nil
                        }
                    }
                    .pageAnchor(event.id)
                    .stackIn()
                    if expandable && open {
                        ClimbingResultsDetail(event: event, yours: yours(event), countries: countries,
                                              onOpen: onOpen, onOpenResults: onOpenResults)
                            .padding(.leading, 28)
                            .padding(.bottom, 8)
                            .transition(.opacity.animation(reduceMotion ? Motion.fade : Motion.reveal))
                    }
                }
            }
        }
    }

    private func select(_ id: String) {
        guard finished.contains(where: { $0.id == id }) else { return }
        if layout.split {
            box.selected = id
            load(id)
        } else {
            openOrClose(id, animated: true)
        }
    }

    /// Opens or closes a competition in place: the disclosure's one motion by
    /// pointer, none by keyboard.
    private func openOrClose(_ id: String, animated: Bool) {
        let opening = !box.expanded.contains(id)
        if animated {
            withAnimation(opening ? (reduceMotion ? Motion.fade : Motion.standard) : Motion.exit) { results.toggle(id) }
        } else {
            var instant = Transaction()
            instant.disablesAnimations = true
            withTransaction(instant) { results.toggle(id) }
        }
        if opening { load(id) }
    }

    /// Its podiums (if the batch hasn't brought them) and your countries' athletes.
    private func load(_ id: String) {
        guard let event = finished.first(where: { $0.id == id }) else { return }
        let countries = Set(store.climbingCountries), disciplines = store.climbingDisciplines
        Task {
            if !event.detailed { await results.loadDetail(id) }
            await results.loadYours(event, countries: countries, disciplines: disciplines)
        }
    }
}

/// An open competition, finished: each category's podium, your countries'
/// best athletes, and its rounds (each opens the match page).
struct ClimbingResultsDetail: View {
    let event: SeasonEvent
    /// "1489-5" → your countries' best athletes off the podium.
    let yours: [String: [CountryBest]]
    let countries: Set<String>
    /// Beside the list (split panel): name, place and dates on top.
    var showsHeader = false
    let onOpen: (Event) -> Void
    let onOpenResults: (EventResultsRef) -> Void
    @Environment(\.widthClass) private var widthClass

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if showsHeader { header }
            if !event.detailed {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.mini)
                    Text("Loading results…").font(.system(size: 11)).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
            } else if event.categories.isEmpty {
                Text("No results published.").font(.system(size: 11)).foregroundStyle(.secondary)
            } else {
                RowGrid(columns: widthClass >= .large ? 2 : 1, spacing: 12) {
                    ForEach(event.categories, id: \.name) { category in
                        ClimbingCategoryBlock(event: event, category: category,
                                              best: category.dcatID.flatMap { yours[key($0)] } ?? [],
                                              countries: countries, onOpen: onOpen, onOpenResults: onOpenResults)
                    }
                }
            }
            if let link = event.link { LinkButton(title: "ifsc.results.info", url: link) }
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func key(_ dcat: Int) -> String {
        guard case let .climbing(id) = event.kind else { return "" }
        return "\(id)-\(dcat)"
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                Text(event.flag ?? "").font(.system(size: 18))
                Text(event.shortName).font(.system(size: 15, weight: .semibold)).lineLimit(1)
            }
            Text([event.place, DayKey.range(event.startDay, event.endDay)].compactMap { $0 }.joined(separator: " · "))
                .font(.system(size: 11.5).monospacedDigit())
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}

/// One category of a finished competition: "LEAD WOMEN · All Results ›",
/// the podium (names open the climbers' pages), your countries, the rounds.
private struct ClimbingCategoryBlock: View {
    let event: SeasonEvent
    let category: SeasonEvent.Category
    let best: [CountryBest]
    let countries: Set<String>
    let onOpen: (Event) -> Void
    let onOpenResults: (EventResultsRef) -> Void

    private static let medals = [1: "🥇", 2: "🥈", 3: "🥉"]

    /// Every round called off (weather, a wall that failed): nothing to rank.
    private var canceled: Bool {
        !category.rounds.isEmpty && category.rounds.allSatisfy { ["canceled", "cancelled"].contains($0.status) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                SubLabel(category.name)
                Spacer(minLength: 4)
                if !canceled, let dcat = category.dcatID, case let .climbing(eventID) = event.kind {
                    SectionLink("All Results", help: "Every athlete in \(category.name)") {
                        onOpenResults(.climbing(eventID: eventID, dcatID: dcat, category: category.name, eventName: event.shortName))
                    }
                }
            }
            if !category.podiumAthletes.isEmpty {
                ForEach(category.podiumAthletes, id: \.athleteID) { a in
                    athleteLine(rank: a.rank, name: [a.first, a.last].filter { !$0.isEmpty }.joined(separator: " "),
                                country: a.country, id: a.athleteID)
                }
            } else if !category.podium.isEmpty {
                Text(category.podium.joined(separator: ", ")).font(.system(size: 11.5)).foregroundStyle(.secondary).lineLimit(2)
            } else {
                Text(canceled ? "Canceled." : "No podium published.").font(.system(size: 11)).foregroundStyle(.secondary)
            }
            // Your countries' best below the podium, in the podium's grammar ("8th 🇺🇸 Ella Fisher").
            ForEach(best, id: \.athleteID) { b in
                athleteLine(rank: b.rank, name: b.name, country: b.country, id: b.athleteID)
            }
            let rounds = category.rounds.filter { $0.status == "finished" && $0.resultPath != nil }
            if !rounds.isEmpty {
                // Wraps rather than truncating when a category has four rounds.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) { roundLinks(rounds) }
                    VStack(alignment: .leading, spacing: 2) { roundLinks(rounds) }
                }
                .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    /// "🥇 🇸🇮 Janja Garnbret"; off the podium the place in words ("8th").
    private func athleteLine(rank: Int, name: String, country: String?, id: Int) -> some View {
        let ref = Profile.PlayerRef(source: .ifsc, id: String(id), name: name, country: country)
        let mine = country.map(countries.contains) ?? false
        return HStack(spacing: 6) {
            Group {
                if let medal = Self.medals[rank] {
                    Text(medal).font(.system(size: 11.5))
                } else {
                    Text(Ordinal.string(rank)).font(.system(size: 10.5, weight: .semibold).monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            .frame(width: 26, alignment: .leading)
            .accessibilityHidden(true)
            Text(Flag.emoji(ioc: country) ?? "")
                .font(.system(size: 12))
                .frame(width: 18)
                .help(country.map(TeamCatalog.countryName) ?? "")
            PlayerNameLink(player: ref) {
                Text(name).font(.system(size: 12, weight: mine ? .semibold : .regular)).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([Ordinal.string(rank), name, country.map(TeamCatalog.countryName), mine ? "Your country" : nil]
            .compactMap { $0 }.joined(separator: ", "))
        .accessibilityAddTraits(.isLink)
        .playerPageLink(ref)
    }

    @ViewBuilder
    private func roundLinks(_ rounds: [SeasonEvent.RoundLink]) -> some View {
        ForEach(rounds, id: \.id) { round in
            SectionLink(round.name, help: "Open the \(category.name) \(round.name.lowercased())") {
                if let e = SeasonResults.roundEvent(event, category: category.name, round: round, winner: winner(of: round)) { onOpen(e) }
            }
        }
    }

    /// The final's winner, from the podium ("🇸🇮 J. Garnbret").
    private func winner(of round: SeasonEvent.RoundLink) -> String? {
        guard round.id == category.rounds.last?.id, let a = category.podiumAthletes.first(where: { $0.rank == 1 }) else { return nil }
        return SeasonResults.shortName(a.first, a.last, country: a.country)
    }
}

// MARK: - CS2: tournaments, finished

/// The tournaments page in results mode: finished tournaments newest first,
/// six at a time, each with its champion; a tournament opens its results page.
struct TournamentResultsPage: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.seasonResultsStore) private var injected
    @Environment(\.stackArrival) private var page
    @Environment(\.panelLayout) private var layout
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(PanelCommands.self) private var commands: PanelCommands?
    let backTitle: String
    let onBack: () -> Void
    let onMode: (ScheduleMode) -> Void
    let onOpenResults: (EventResultsRef) -> Void
    @State private var hover = HighlightState()
    @State private var arrival: StackArrival?
    @State private var keyboardDriven = false
    @FocusState private var focused: Bool
    /// How far the season card has docked (read by the docked bar, never by this page).
    @State private var geometry = PageGeometry()
    @State private var actions = SeasonDockActions()
    #if DEBUG
    /// Harness counter: body runs (scrolling must add none).
    static var bodyRuns = 0
    #endif

    private var results: SeasonResultsStore { injected ?? .shared }
    private var box: SeasonResultsStore.Tournaments { results.tournaments }
    private var followed: Set<String> { Set(store.followed.map(\.id).filter { $0.hasPrefix("cs-") }) }
    private static let contentSpace = "tournaments.results"

    var body: some View {
        #if DEBUG
        let _ = Self.bodyRuns += 1
        #endif
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                PageHeader("Tournaments", symbol: Sport.esports.symbol) { BackButton(title: backTitle, action: onBack) }
                ScheduleModeSwitch(mode: .results, onChange: onMode)
            }
            .stackIn()
            .pageChrome()
            content.frame(maxHeight: .infinity, alignment: .top)
            SeasonFooter(updated: box.updated, stale: box.stale, loading: box.loading && box.items.isEmpty, subject: "results")
                .pageChrome()
        }
        // ↑ ↓ move between tournaments; Return or Space opens one (split: shows it beside).
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .keyFocusWhenLive($focused)
        .onKeyPress(.downArrow) { move(1); return .handled }
        .onKeyPress(.upArrow) { move(-1); return .handled }
        .onKeyPress(.return) { openHighlighted() }
        .onKeyPress(.space) { openHighlighted() }
        .pageLoading(box.updated == nil && !box.failed)
        .task {
            let first = box.updated == nil
            await results.loadTournaments()
            if first { arrival = .data(in: Self.contentSpace, page: page) }
        }
        .onChange(of: commands?.refreshToken) { reload() }
    }

    private func reload() {
        Task { await results.loadTournaments(force: true) }
    }

    @ViewBuilder
    private var content: some View {
        if box.updated == nil && !box.failed {
            SeasonSkeleton()
        } else if box.items.isEmpty, box.failed {
            ErrorState("Results", retry: reload)
        } else if box.items.isEmpty {
            EmptyState(symbol: "trophy", title: "No Results", message: "No finished S-tier tournaments yet.")
        } else {
            let summary = SeasonSummary.tournamentResults(box.items.map(\.event)), axis = self.axis
            PageScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    SeasonCard(summary: summary, axis: axis, hover: hover, onSelect: { open($0) }) { EmptyView() }
                        .padding(.horizontal, 10)
                        .padding(.top, 4)
                        .stackIn()
                    if layout.split {
                        HStack(alignment: .top, spacing: 0) {
                            list.frame(maxWidth: .infinity, alignment: .top)
                            if let selected = selectedTournament {
                                TournamentResultsSummary(tournament: selected, followed: followed) {
                                    onOpenResults(.tournament(slug: selected.slug, name: selected.event.name))
                                }
                                .padding(.top, 18)
                                .frame(maxWidth: .infinity, alignment: .top)
                                .environment(\.widthClass, layout.column)
                                .stackIn()
                            }
                        }
                    } else {
                        list
                    }
                    if box.more {
                        HStack(spacing: 8) {
                            ProfileMoreButton(title: "Show Earlier") {
                                Task { await results.loadMoreTournaments() }
                            }
                            if box.loading { ProgressView().controlSize(.mini) }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 10)
                    }
                }
                .padding(.bottom, 12)
                .coordinateSpace(name: Self.contentSpace)
                .environment(\.stackArrival, arrival ?? page)
            }
            // As the card tucks under the header, its docked bar settles in:
            // an overlay, so it never changes the page's measured height.
            .overlay(alignment: .top) {
                DockedBarHost { dockBar(summary, axis).equatable() }
            }
            .modifier(DockedHighlightScroll(state: hover, geometry: geometry, keyboardDriven: { keyboardDriven }))
            .environment(\.pageGeometry, geometry)
        }
    }

    /// The tournaments on one S-tier lane; hovered, else the one beside the list, else the latest.
    private var axis: SeasonAxis {
        let events = box.items.map(\.event)
        let readouts = box.items.map { t in
            (t.id, [t.title, DayKey.range(t.event.startDay, t.event.endDay),
                    t.summary?.components(separatedBy: " · ").first].compactMap { $0 }.joined(separator: " · "))
        }
        return SeasonAxis(events: events, lanes: [SeasonTimeline.Lane(id: CounterStrike.tier, label: "S-Tier")], today: .today(),
                          next: nil, selected: layout.split ? selectedTournament?.id : nil,
                          readouts: Dictionary(readouts, uniquingKeysWith: { a, _ in a }),
                          resting: layout.split ? selectedTournament?.id : box.items.first?.id)
    }

    private func dockBar(_ summary: SeasonSummary, _ axis: SeasonAxis) -> SeasonDockBar {
        // Refreshed every render: a click acts on the page as it is now.
        actions.reveal = { reveal($0) }
        return SeasonDockBar(summary: summary, axis: axis, hover: hover, actions: actions)
    }

    /// A tournament on the timeline: beside the list (split), else its results page.
    private func open(_ id: String) {
        guard let tournament = box.items.first(where: { $0.id == id }) else { return }
        if layout.split {
            box.selected = id
        } else {
            onOpenResults(.tournament(slug: tournament.slug, name: tournament.event.name))
        }
    }

    /// A mark clicked in the docked bar: as on the timeline, and beside the
    /// list its row scrolls up to just under the bar.
    private func reveal(_ id: String) {
        open(id)
        if layout.split { geometry.scroll(toAnchor: id, topInset: SeasonDock.reserve, animated: !reduceMotion) }
    }

    private func move(_ delta: Int) {
        let rows = ClimbingResultsPage.byMonth(box.items) { $0.event.startDay }.flatMap(\.1).map(\.id)
        guard !rows.isEmpty else { return }
        keyboardDriven = true
        hover.keyboard = true
        let current = rows.firstIndex { $0 == hover.id }
        let next = current.map { min(max($0 + delta, 0), rows.count - 1) } ?? (delta > 0 ? 0 : rows.count - 1)
        hover.id = rows[next]
        if layout.split { box.selected = rows[next] }
        DispatchQueue.main.async { keyboardDriven = false }
    }

    private func openHighlighted() -> KeyPress.Result {
        guard let tournament = box.items.first(where: { $0.id == hover.id }) else { return .ignored }
        if layout.split {
            box.selected = tournament.id
        } else {
            onOpenResults(.tournament(slug: tournament.slug, name: tournament.event.name))
        }
        return .handled
    }

    private var selectedTournament: FinishedTournament? {
        box.items.first { $0.id == box.selected } ?? box.items.first
    }

    private var list: some View {
        let months = ClimbingResultsPage.byMonth(box.items) { $0.event.startDay }
        let followed = followed
        let split = layout.split
        let selected = split ? selectedTournament?.id : nil
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(months, id: \.0) { month, tournaments in
                MonthLabel(month: month).stackIn()
                ForEach(tournaments) { tournament in
                    HighlightGate(state: hover, id: tournament.id) { lit in
                        TournamentResultRow(tournament: tournament, followed: followed, highlighted: lit || selected == tournament.id,
                                            chevron: !split) {
                            // Split: beside the list; otherwise its own page.
                            if split {
                                box.selected = tournament.id
                            } else {
                                onOpenResults(.tournament(slug: tournament.slug, name: tournament.event.name))
                            }
                        }
                        .equatable()
                    }
                    .onHover { inside in
                        if inside {
                            hover.keyboard = false
                            hover.id = tournament.id
                        } else if hover.id == tournament.id, !hover.keyboard {
                            hover.id = nil
                        }
                    }
                    .pageAnchor(tournament.id)
                    .stackIn()
                }
            }
        }
    }
}

/// A finished tournament: its name, "🏆 Vitality · 2nd MOUZ · $1M", and
/// where your teams placed.
struct TournamentResultRow: View {
    let tournament: FinishedTournament
    let followed: Set<String>
    let highlighted: Bool
    /// Off when the row selects (split panel) rather than opens a page.
    var chevron = true
    let action: () -> Void

    private var event: SeasonEvent { tournament.event }

    /// "★ G2 12th–14th"
    private var yours: String? {
        guard !followed.isEmpty else { return nil }
        let mine = tournament.placements.filter { $0.team.id.map(followed.contains) ?? false }
        return mine.isEmpty ? nil : mine.map { "★ \($0.team.name) \($0.place)" }.joined(separator: " · ")
    }

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 10) {
                TournamentLogo(url: event.logo, size: 20)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(tournament.title).font(.system(size: 13, weight: .medium)).lineLimit(1)
                        if let badge = event.badge, !tournament.title.contains(badge) {
                            Text(badge.uppercased())
                                .font(.system(size: 9, weight: .semibold))
                                .tracking(0.3)
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, 5)
                                .frame(height: 15)
                                .background(Capsule().fill(Color.primary.opacity(0.08)))
                                .fixedSize()
                        }
                    }
                    Text(tournament.summary ?? "Results not published")
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    if let yours {
                        Text(yours).font(.system(size: 10.5)).foregroundStyle(.secondary).lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 6)
                Text(DayKey.range(event.startDay, event.endDay))
                    .font(.system(size: 11, weight: .medium).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .fixedSize()
                if chevron {
                    Image(systemName: "chevron.right")
                        .font(Glyph.disclosure)
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(ListRowStyle(hovering: highlighted, inset: 0))
        .padding(.horizontal, 6)
        .help(event.name)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([event.name, DayKey.range(event.startDay, event.endDay), spokenSummary, yours?.replacingOccurrences(of: "★ ", with: "")]
            .compactMap { $0 }.joined(separator: ", "))
        .accessibilityHint("Opens the tournament's results")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { action() }
    }

    private var spokenSummary: String? {
        tournament.summary?.replacingOccurrences(of: "🏆 ", with: "Won by ").replacingOccurrences(of: "–", with: " to ")
    }
}

/// A row redraws when what it shows changes, not on every hover elsewhere.
extension TournamentResultRow: @MainActor Equatable {
    static func == (a: TournamentResultRow, b: TournamentResultRow) -> Bool {
        a.tournament == b.tournament && a.followed == b.followed && a.highlighted == b.highlighted && a.chevron == b.chevron
    }
}

/// Beside the list (split panel): the champion, the placings, and the way
/// to the full results (matches by round, the bracket).
struct TournamentResultsSummary: View {
    let tournament: FinishedTournament
    let followed: Set<String>
    let onOpen: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(tournament.title)
                .font(.system(size: 15, weight: .semibold))
                .lineLimit(2)
                .padding(.horizontal, Metrics.gutter)
                .padding(.bottom, 8)
            ChampionCard(tournament: tournament, final: nil)
                .padding(.horizontal, 10)
            VStack(alignment: .leading, spacing: 0) {
                SectionTitle("Placements") { SectionLink("Full Results", help: "Matches by round and the bracket", action: onOpen) }
                    .padding(.bottom, 4)
                if tournament.placements.isEmpty {
                    Text("Placings aren't published for this tournament.").font(.system(size: 11)).foregroundStyle(.secondary)
                } else {
                    PlacementsTable(placements: Array(tournament.placements.prefix(12)), followed: followed)
                    if tournament.placements.count > 12 {
                        SectionLink("All \(tournament.placements.count) Placings", action: onOpen)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 6)
                    }
                }
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, 16)
        }
    }
}

// MARK: - League page preview

/// The league page's Results section body for climbing and CS2. Climbing:
/// the last two finished competitions with their winners. CS2: your teams'
/// last results, then the last two finished tournaments.
struct SeasonResultsPreview: View {
    let league: League
    let onOpen: (Event) -> Void
    /// The season page in results mode.
    let onOpenResults: () -> Void
    let onOpenEvent: (EventResultsRef) -> Void
    @Environment(ScoreStore.self) private var store
    @Environment(\.seasonResultsStore) private var injected
    @Environment(\.widthClass) private var widthClass
    @State private var hover = HighlightState()

    init(league: League, onOpen: @escaping (Event) -> Void,
         onOpenResults: @escaping () -> Void, onOpenEvent: @escaping (EventResultsRef) -> Void) {
        self.league = league
        self.onOpen = onOpen
        self.onOpenResults = onOpenResults
        self.onOpenEvent = onOpenEvent
    }

    private var results: SeasonResultsStore { injected ?? .shared }

    var body: some View {
        switch league.source {
        case .ifsc: climbing
        case .counterStrike: counterStrike
        case .espn: EmptyView()
        }
    }

    // MARK: Climbing

    @ViewBuilder
    private var climbing: some View {
        let box = results.climbing
        let shown = results.latestFinished(2, disciplines: store.climbingDisciplines)
        Group {
            if box.updated == nil && !box.failed {
                ScheduleSkeleton(days: 1, rows: 2)
            } else if shown.isEmpty, box.failed {
                failure { Task { await results.loadClimbing(force: true, details: 2, disciplines: store.climbingDisciplines) } }
            } else if shown.isEmpty {
                ScheduleNote(text: "No finished competitions this season yet.")
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(shown) { event in
                        HighlightGate(state: hover, id: event.id) { lit in
                            ClimbingEventRow(event: event, open: false, highlighted: lit, chevron: false) {
                                results.reveal(event.id)
                                onOpenResults()
                            }
                            .equatable()
                        }
                        .onHover { inside in
                            if inside { hover.id = event.id } else if hover.id == event.id { hover.id = nil }
                        }
                    }
                }
            }
        }
        .task { await results.loadClimbing(details: 2, disciplines: store.climbingDisciplines) }
    }

    // MARK: CS2

    @ViewBuilder
    private var counterStrike: some View {
        let box = results.tournaments
        let mine = Array(results.followed.items.prefix(4))
        let followed = Set(store.followed.map(\.id).filter { $0.hasPrefix("cs-") })
        let shown = Array(box.items.prefix(2))
        Group {
            if box.updated == nil && !box.failed {
                ScheduleSkeleton(days: 1, rows: 3)
            } else if shown.isEmpty && mine.isEmpty, box.failed {
                failure { Task { await results.loadTournaments(force: true) } }
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    if !mine.isEmpty {
                        VStack(spacing: 0) {
                            ForEach(mine) { item in
                                HighlightGate(state: hover, id: item.id) { lit in
                                    ScheduleRow(item: item, highlighted: lit, width: widthClass,
                                                onHover: { inside in
                                                    if inside { hover.id = item.id } else if hover.id == item.id { hover.id = nil }
                                                },
                                                onSelect: { onOpen($0.event()) })
                                        .equatable()
                                }
                            }
                        }
                        .environment(\.statusColumnWidth, ScheduleRow.statusWidth(mine, store: store, width: widthClass))
                        .padding(.bottom, 4)
                    }
                    ForEach(shown) { tournament in
                        HighlightGate(state: hover, id: tournament.id) { lit in
                            TournamentResultRow(tournament: tournament, followed: followed, highlighted: lit) {
                                onOpenEvent(.tournament(slug: tournament.slug, name: tournament.event.name))
                            }
                            .equatable()
                        }
                        .onHover { inside in
                            if inside { hover.id = tournament.id } else if hover.id == tournament.id { hover.id = nil }
                        }
                    }
                }
            }
        }
        .task {
            let ids = followed.compactMap { Int($0.dropFirst(3)) }
            async let list: Void = results.loadTournaments()
            async let teams: Void = results.loadFollowed(teamIDs: ids)
            _ = await (list, teams)
        }
    }

    private func failure(_ retry: @escaping () -> Void) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("Couldn't load the results. Check your internet connection.")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            SectionLink(ErrorCopy.retry, symbol: "arrow.clockwise", action: retry)
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 6)
    }
}

extension SeasonSummary {
    /// Climbing's Results card: "2026 season complete · 10 competitions";
    /// mid-season, how far along. (pure; tested)
    static func results(season: String?, finished: Int, total: Int) -> SeasonSummary {
        let name = season ?? ""
        if finished == total { return SeasonSummary(headline: "\(name) season complete", subline: plural(total, "competition")) }
        return SeasonSummary(headline: "\(name) season", subline: "\(finished) of \(plural(total, "competition")) finished")
    }

    /// CS2's Results card: how many S-tier tournaments are listed, and since
    /// when ("12 S-tier tournaments", "Since Apr 2026"). Grows with Show Earlier.
    static func tournamentResults(_ events: [SeasonEvent]) -> SeasonSummary {
        guard let first = events.map(\.startDay).min() else { return SeasonSummary(headline: "No S-tier results yet") }
        return SeasonSummary(headline: "\(events.count) S-tier \(events.count == 1 ? "tournament" : "tournaments")",
                             subline: "Since \(first.displayDate.formatted(.dateTime.month(.abbreviated).year()))")
    }
}
