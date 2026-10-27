import AppKit
import SwiftUI

/// CS2's calendar (S-tier): the tournament underway, the coming months on one axis,
/// then every tournament by month. A drawn tournament opens its
/// bracket; one that isn't drawn yet opens in place (field, prize money).
struct TournamentsPage: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.scheduleStore) private var injected
    @Environment(\.stackArrival) private var page
    @Environment(\.panelLayout) private var layout
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(PanelCommands.self) private var commands: PanelCommands?
    let backTitle: String
    let onBack: () -> Void
    var onOpen: (Event) -> Void = { _ in }
    var onOpenBracket: (BracketSource, Set<String>) -> Void = { _, _ in }
    /// Upcoming or Results (⌘1 / ⌘2); the page swaps in place.
    var mode: ScheduleMode = .upcoming
    var onMode: (ScheduleMode) -> Void = { _ in }
    /// A finished tournament's results page (results mode).
    var onOpenResults: (EventResultsRef) -> Void = { _ in }
    /// The tournament under the pointer, in the list or on the timeline (a
    /// reference: hovering updates the timeline and two rows, not this page).
    @State private var hover = HighlightState()
    @State private var arrival: StackArrival?

    private var schedule: ScheduleStore { injected ?? .shared }
    private var state: ScheduleStore.SeasonsState { schedule.tournaments }
    private var events: [SeasonEvent] { (state.events["upcoming"] ?? []).filter { $0.status != .canceled } }
    private var current: [SeasonEvent] { events.filter { $0.status == .live } }
    private var upcoming: [SeasonEvent] { events.filter { $0.status == .upcoming } }
    private var followed: Set<String> { schedule.followedCS(store) }
    private static let contentSpace = "tournaments.content"

    var body: some View {
        if mode == .results {
            TournamentResultsPage(backTitle: backTitle, onBack: onBack, onMode: onMode, onOpenResults: onOpenResults)
        } else {
            upcomingPage
        }
    }

    private var upcomingPage: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                PageHeader("Tournaments", symbol: Sport.esports.symbol) { BackButton(title: backTitle, action: onBack) }
                ScheduleModeSwitch(mode: .upcoming, onChange: onMode)
            }
            .stackIn()
            .pageChrome()
            content.frame(maxHeight: .infinity, alignment: .top)
            SeasonFooter(updated: state.updated, stale: state.stale, loading: state.loading).pageChrome()
        }
        .pageLoading(state.updated == nil && !state.failed)
        .task {
            let first = state.updated == nil
            await schedule.load(.tournaments, store: store)
            if first { arrival = .data(in: Self.contentSpace, page: page) }
        }
        // ⌘R (the panel's one binding) reloads the calendar too.
        .onChange(of: commands?.refreshToken) { reload() }
    }

    private func reload() {
        Task { await schedule.load(.tournaments, store: store, force: true) }
    }

    @ViewBuilder
    private var content: some View {
        if state.updated == nil && !state.failed {
            SeasonSkeleton()
        } else if events.isEmpty, state.failed {
            // Nothing retries on its own here: say so, and offer it.
            ErrorState("Tournaments", retry: reload)
        } else if events.isEmpty {
            EmptyState(symbol: "gamecontroller", title: "No Tournaments", message: "No S-tier tournaments are scheduled.")
        } else {
            PageScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(current) { event in
                        CurrentTournamentCard(event: event, next: nextMatch(in: event)) { openBracket(event) }
                            .padding(.horizontal, 10)
                            .padding(.top, 4)
                            .padding(.bottom, 6)
                            .stackIn()
                    }
                    HoverReader(state: hover) { hovered in timeline(hovered: hovered) }
                        .padding(.horizontal, Metrics.gutter)
                        .padding(.top, 10)
                        .stackIn()
                    if layout.split {
                        HStack(alignment: .top, spacing: 0) {
                            list(expandable: false).frame(maxWidth: .infinity, alignment: .top)
                            if let selected = selectedEvent {
                                TournamentDetail(event: selected, followed: followed, showsHeader: true) { openBracket(selected) }
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
        }
    }

    private var selectedEvent: SeasonEvent? {
        let id = schedule.selectedEvent[.tournaments] ?? upcoming.first?.id
        return events.first { $0.id == id } ?? events.first
    }

    /// The live tournament's next (or live) match, from the scores list's CS2 games.
    private func nextMatch(in event: SeasonEvent) -> Event? {
        let matches = (store.results["cs2"]?.events ?? []).filter { $0.caption?.hasPrefix(event.name) == true }
        let mine = matches.filter { $0.competitors.contains { $0.id.map(followed.contains) ?? false } }
        let pick = { (list: [Event]) in list.first { $0.state == .live } ?? list.filter { $0.state == .scheduled }.min { $0.start < $1.start } }
        return pick(mine) ?? pick(matches)
    }

    private func timeline(hovered: String?) -> some View {
        // The next twelve months at most; later tournaments are in the list.
        let horizon = DayKey.today().adding(days: 365)
        let shown = events.filter { $0.startDay <= horizon }
        let lanes = [SeasonTimeline.Lane(id: CounterStrike.tier, label: "S-Tier")]
        let readout = events.first { $0.id == hovered } ?? upcoming.first
        return VStack(alignment: .leading, spacing: 6) {
            SeasonTimeline(events: shown, lanes: lanes, today: .today(), next: upcoming.first?.id,
                           hovered: Binding(get: { hover.id }, set: { if hover.id != $0 { hover.id = $0 } })) { select($0) }
            if let readout {
                Text([readout.shortName, DayKey.range(readout.startDay, readout.endDay), ScheduleProvider.CS.prize(readout.prize)]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 10.5).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .padding(.leading, SeasonTimeline.labelWidth)
            }
        }
    }

    private func list(expandable: Bool) -> some View {
        let months = Dictionary(grouping: upcoming) { DayKey(year: $0.startDay.year, month: $0.startDay.month, day: 1) }
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(months.keys.sorted(), id: \.self) { month in
                MonthLabel(month: month).stackIn()
                ForEach(months[month] ?? []) { event in
                    let open = expandable ? schedule.expanded.contains(event.id) : selectedEvent?.id == event.id
                    HighlightGate(state: hover, id: event.id) { lit in
                        TournamentRow(event: event, followed: followed, open: open, chevron: expandable, highlighted: lit) { select(event.id) }
                            .equatable()
                    }
                    .onHover { inside in
                        if inside { hover.id = event.id } else if hover.id == event.id { hover.id = nil }
                    }
                    .stackIn()
                    if expandable && open {
                        TournamentDetail(event: event, followed: followed) { openBracket(event) }
                            .padding(.leading, 34)
                            .padding(.bottom, 6)
                            .transition(.opacity.animation(reduceMotion ? Motion.fade : Motion.reveal))
                    }
                }
            }
        }
    }

    private func select(_ id: String) {
        guard let event = events.first(where: { $0.id == id }) else { return }
        // Drawn: straight to the bracket. Not yet: open in place.
        if event.status != .upcoming || event.stages > 0 {
            openBracket(event)
            return
        }
        if layout.split {
            schedule.selectedEvent[.tournaments] = id
        } else {
            let opening = !schedule.expanded.contains(id)
            withAnimation(opening ? (reduceMotion ? Motion.fade : Motion.standard) : Motion.exit) {
                if opening { schedule.expanded.insert(id) } else { schedule.expanded.remove(id) }
            }
        }
        if !event.detailed { Task { await schedule.loadTournamentDetail(id) } }
    }

    private func openBracket(_ event: SeasonEvent) {
        guard case let .tournament(slug) = event.kind else { return }
        // The bracket knows teams by bo3.gg's bare ID ("667"), as the match page passes them.
        onOpenBracket(.csTournament(slug: slug, name: event.name), Set(followed.map { String($0.dropFirst(3)) }))
    }
}

// MARK: - Pieces

private struct CurrentTournamentCard: View {
    let event: SeasonEvent
    let next: Event?
    let onBracket: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            TournamentLogo(url: event.logo, size: 28)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    LiveDot()
                    Text(event.shortName).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                    Spacer(minLength: 4)
                    SectionLink("Bracket", help: "Open the bracket", action: onBracket)
                }
                Text(DayKey.range(event.startDay, event.endDay) + (ScheduleProvider.CS.prize(event.prize).map { " · \($0)" } ?? ""))
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(.secondary)
                if let line = nextLine {
                    Text(line)
                        .font(.system(size: 11.5).monospacedDigit())
                        .foregroundStyle(next?.state == .live ? AnyShapeStyle(Color.red) : AnyShapeStyle(.primary))
                        .lineLimit(1)
                        .padding(.top, 2)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.primary.opacity(0.045)))
        .accessibilityElement(children: .combine)
        .accessibilityAction(named: "Open Bracket", onBracket)
    }

    private var nextLine: String? {
        guard let next else { return nil }
        let teams = next.competitors.map(\.name).joined(separator: " v ")
        switch next.state {
        case .live: return "Live: \(teams)"
        case .scheduled: return "Next: \(teams) · \(When.dayAndTime(next.start))"
        case .final: return nil
        }
    }
}

struct TournamentRow: View {
    let event: SeasonEvent
    let followed: Set<String>
    let open: Bool
    var chevron = true
    let highlighted: Bool
    /// "Next week", "In 3 weeks" (a sport's page).
    var relative: String? = nil
    let action: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 10) {
                TournamentLogo(url: event.logo, size: 20)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(event.shortName).font(.system(size: 13, weight: .medium)).lineLimit(1)
                        // "PGL Major Singapore" says it already.
                        if let badge = event.badge, !event.shortName.contains(badge) {
                            Text(badge.uppercased())
                                .font(.system(size: 9, weight: .semibold))
                                .tracking(0.3)
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, 5)
                                .frame(height: 15)
                                .background(Capsule().fill(Color.primary.opacity(0.08)))
                        }
                    }
                    // What tells tournaments apart leads (prize, field size,
                    // format); the city gives way first, keeping its flag.
                    ViewThatFits(in: .horizontal) {
                        Text(placeLine(city: true)).fixedSize()
                        Text(placeLine(city: false)).lineLimit(1)
                    }
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    if let field = fieldLine {
                        Text(field).font(.system(size: 10.5)).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 6)
                dates
                if chevron {
                    Image(systemName: event.stages > 0 ? "arrow.right" : "chevron.right")
                        .font(Glyph.disclosure)
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(open && event.stages == 0 ? 90 : 0))
                        .animation(reduceMotion ? nil : Motion.quick, value: open)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(ListRowStyle(hovering: highlighted || (!chevron && open), inset: 0))
        .padding(.horizontal, 6)
        .help(event.stages > 0 ? "Open the bracket" : "Show the field")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([event.shortName, DayKey.range(event.startDay, event.endDay), relative, placeLine(city: true), fieldLine]
            .compactMap { $0 }.joined(separator: ", "))
        .accessibilityHint(event.stages > 0 ? "Opens the bracket" : "Shows the field")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { action() }
    }

    private var dates: some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(DayKey.range(event.startDay, event.endDay))
                .font(.system(size: 11, weight: .medium).monospacedDigit())
            if let relative {
                Text(relative)
                    .font(.system(size: 10))
                    .foregroundStyle(event.status == .live ? AnyShapeStyle(Color.red) : AnyShapeStyle(.secondary))
            }
        }
    }

    /// "$1.25M · 16 teams · LAN · 🇵🇱 Katowice, Poland"; without the city,
    /// the flag alone places it.
    private func placeLine(city: Bool) -> String {
        var parts: [String] = []
        if let prize = ScheduleProvider.CS.prize(event.prize) { parts.append(prize) }
        if !event.teams.isEmpty { parts.append(plural(event.teams.count, "team")) }
        if let format = event.format { parts.append(format) }
        if let place = event.place {
            if city {
                parts.append([event.flag, place].compactMap { $0 }.joined(separator: " "))
            } else if let flag = event.flag {
                parts.append(flag)
            }
        }
        return parts.joined(separator: " · ")
    }

    /// Your teams in the field, and how many of the world's top 10.
    private var fieldLine: String? {
        guard !event.teams.isEmpty else { return nil }
        let yours = event.teams.filter { $0.id.map(followed.contains) ?? false }.map { "\($0.name) ★" }
        let top = ScheduleProvider.CS.topTen(event.teams)
        let parts = yours + (top > 0 ? ["\(top) of the top 10"] : [])
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// A row redraws when what it shows changes, not on every hover elsewhere.
extension TournamentRow: @MainActor Equatable {
    static func == (a: TournamentRow, b: TournamentRow) -> Bool {
        a.event == b.event && a.followed == b.followed && a.open == b.open && a.chevron == b.chevron
            && a.highlighted == b.highlighted && a.relative == b.relative
    }
}

/// A tournament not drawn yet: the field (top-ranked first) and the prize money.
private struct TournamentDetail: View {
    let event: SeasonEvent
    let followed: Set<String>
    /// Beside the list (split panel): name, place, dates and prize on top.
    var showsHeader = false
    let onBracket: () -> Void
    @Environment(\.widthClass) private var widthClass

    private var columns: Int { widthClass >= .large ? 4 : 3 }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if showsHeader {
                HStack(spacing: 10) {
                    TournamentLogo(url: event.logo, size: 28)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(event.name).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                        Text([DayKey.range(event.startDay, event.endDay), event.place.map { [event.flag, $0].compactMap { $0 }.joined(separator: " ") },
                              event.format, ScheduleProvider.CS.prize(event.prize)].compactMap { $0 }.joined(separator: " · "))
                            .font(.system(size: 11.5).monospacedDigit())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                .padding(.bottom, 4)
            }
            if !event.detailed {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.mini)
                    Text("Loading the field…").font(.system(size: 11)).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
            } else if event.teams.isEmpty {
                ScheduleNote(text: "Teams and format not announced yet.").padding(.horizontal, -Metrics.gutter)
            } else {
                RowGrid(columns: columns, spacing: 6) {
                    ForEach(event.teams, id: \.self) { team in
                        HStack(spacing: 6) {
                            LogoView(url: team.logo, size: 14)
                            Text(team.name).font(.system(size: 11.5)).lineLimit(1)
                            if team.id.map(followed.contains) ?? false {
                                Image(systemName: "star.fill").font(.system(size: 7)).foregroundStyle(.yellow)
                                    .accessibilityLabel("Following")
                            }
                            Spacer(minLength: 0)
                        }
                        .help(team.rank.map { "\(team.name) · No. \($0) on bo3.gg" } ?? team.name)
                    }
                }
            }
            HStack(spacing: 12) {
                if event.stages > 0 {
                    Button("Open Bracket", action: onBracket).buttonStyle(.plain)
                        .font(.system(size: 11, weight: .medium)).foregroundStyle(Color.accentColor)
                }
                if let link = event.link { LinkButton(title: "bo3.gg", url: link) }
            }
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}


/// A tournament's logo, or a trophy when bo3.gg has none. bo3.gg's logos
/// are drawn for dark pages (many are white), so in light mode they sit on a
/// small dark tile.
struct TournamentLogo: View {
    let url: URL?
    let size: CGFloat
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        if url != nil {
            LogoView(url: url, size: size * (colorScheme == .light ? 0.78 : 1))
                .frame(width: size, height: size)
                .background {
                    if colorScheme == .light {
                        RoundedRectangle(cornerRadius: size * 0.24, style: .continuous).fill(Color(white: 0.17))
                    }
                }
        } else {
            Image(systemName: "trophy")
                .font(.system(size: size * 0.6, weight: .medium))
                .foregroundStyle(.tertiary)
                .frame(width: size, height: size)
        }
    }
}
