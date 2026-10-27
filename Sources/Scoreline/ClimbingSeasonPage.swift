import AppKit
import SwiftUI

/// The climbing season: what's live or next, the season on one axis by
/// discipline, then every competition by month. Competitions open in place
/// (rounds, stream times, your countries' athletes); in a split panel the
/// list and the open competition sit side by side.
struct ClimbingSeasonPage: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.scheduleStore) private var injected
    @Environment(\.stackArrival) private var page
    @Environment(\.panelLayout) private var layout
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(PanelCommands.self) private var commands: PanelCommands?
    let backTitle: String
    let onBack: () -> Void
    var onOpen: (Event) -> Void = { _ in }
    var onScope: (ScheduleScope) -> Void = { _ in }
    /// Upcoming or Results (⌘1 / ⌘2); the page swaps in place.
    var mode: ScheduleMode = .upcoming
    var onMode: (ScheduleMode) -> Void = { _ in }
    /// A category's full results (results mode).
    var onOpenResults: (EventResultsRef) -> Void = { _ in }
    @State private var arrival: StackArrival?
    /// The competition under the pointer, in the list or on the timeline. A
    /// reference, so hovering updates the timeline and the two rows involved,
    /// not this page.
    @State private var hover = HighlightState()

    private var schedule: ScheduleStore { injected ?? .shared }
    private var state: ScheduleStore.SeasonsState { schedule.climbing }
    private var season: String? { schedule.climbingSeason ?? state.defaultSeason ?? state.seasons.last }
    private var events: [SeasonEvent] { season.flatMap { state.events[$0] } ?? [] }
    private var allEvents: [SeasonEvent] { state.seasons.flatMap { state.events[$0] ?? [] } }
    private var live: SeasonEvent? { allEvents.first { $0.status == .live } }
    private var next: SeasonEvent? { ScheduleProvider.IFSC.next(in: allEvents.filter { $0.status == .upcoming }) }
    private static let contentSpace = "climbing.content"
    private static let lanes = [SeasonTimeline.Lane(id: "boulder", label: "Boulder"),
                                SeasonTimeline.Lane(id: "lead", label: "Lead"),
                                SeasonTimeline.Lane(id: "speed", label: "Speed")]

    var body: some View {
        if mode == .results {
            ClimbingResultsPage(backTitle: backTitle, onBack: onBack, onOpen: onOpen, onMode: onMode, onOpenResults: onOpenResults)
        } else {
            upcoming
        }
    }

    private var upcoming: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                header
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
            await schedule.load(.climbing, store: store)
            if first { arrival = .data(in: Self.contentSpace, page: page) }
        }
        // ⌘R (the panel's one binding) reloads the calendar too.
        .onChange(of: commands?.refreshToken) { reload() }
    }

    private func reload() {
        Task { await schedule.load(.climbing, store: store, force: true) }
    }

    // MARK: Header

    private var header: some View {
        TitleBarLayout {
            HStack(spacing: 6) { BackButton(title: backTitle, action: onBack) }
            PageTitleMenu(title: season.map { "\($0) Season" } ?? "Climbing Season", enabled: state.seasons.count > 1,
                          help: "Choose a season") {
                ForEach(state.seasons, id: \.self) { name in
                    Button {
                        schedule.climbingSeason = name
                    } label: {
                        if name == season { Label("\(name) Season", systemImage: "checkmark") } else { Text("\(name) Season") }
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
        if state.updated == nil && !state.failed {
            SeasonSkeleton()
        } else if events.isEmpty, state.failed {
            // Nothing retries on its own here: say so, and offer it.
            ErrorState("Calendar", retry: reload)
        } else if events.isEmpty {
            EmptyState(symbol: "figure.climbing", title: "No Competitions",
                       message: "The next season's calendar isn't published yet.")
        } else {
            PageScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    StatusCard(live: live, next: next, previousSeasonOver: previousSeasonOver,
                               broadcast: store.climbingBroadcast, store: store)
                        .padding(.horizontal, 10)
                        .padding(.top, 4)
                        .stackIn()
                    HoverReader(state: hover) { hovered in timeline(hovered: hovered) }
                        .padding(.horizontal, Metrics.gutter)
                        .padding(.top, 14)
                        .stackIn()
                    if layout.split {
                        HStack(alignment: .top, spacing: 0) {
                            list(expandable: false).frame(maxWidth: .infinity, alignment: .top)
                            if let selected = selectedEvent {
                                ClimbingEventDetail(event: selected, countries: store.climbingCountries, broadcast: store.climbingBroadcast,
                                                    showsHeader: true)
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

    /// The season before this one is finished and this one hasn't started.
    private var previousSeasonOver: String? {
        guard live == nil, let next, let previous = state.seasons.first(where: { $0 < String(next.startDay.year) }),
              (state.events[previous] ?? []).allSatisfy({ $0.status != .upcoming }) else { return nil }
        return previous
    }

    private var selectedEvent: SeasonEvent? {
        let id = schedule.selectedEvent[.climbing] ?? live?.id ?? next?.id
        return events.first { $0.id == id } ?? events.first
    }

    private func timeline(hovered: String?) -> some View {
        let present = Set(events.flatMap(\.lanes))
        let lanes = Self.lanes.filter { present.contains($0.id) }
        // Hovered, else what's live or next in this season, else the one open beside the list.
        let current = events.first { $0.status == .live } ?? events.first { $0.id == next?.id }
        let readout = events.first { $0.id == hovered } ?? current ?? (layout.split ? selectedEvent : nil)
        return VStack(alignment: .leading, spacing: 6) {
            SeasonTimeline(events: events, lanes: lanes, today: .today(), next: live == nil ? next?.id : nil, selected: layout.split ? selectedEvent?.id : nil,
                           dimmedLanes: Set(lanes.map(\.id)).subtracting(store.climbingDisciplines),
                           hovered: Binding(get: { hover.id }, set: { if hover.id != $0 { hover.id = $0 } })) { id in select(id) }
            if let readout {
                Text(readoutText(readout))
                    .font(.system(size: 10.5).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .padding(.leading, SeasonTimeline.labelWidth)
            }
        }
    }

    private func readoutText(_ e: SeasonEvent) -> String {
        [e.shortName, DayKey.range(e.startDay, e.endDay), e.lanes.map(\.capitalized).joined(separator: ", "), e.badge]
            .compactMap { $0 }.joined(separator: " · ")
    }

    private func list(expandable: Bool) -> some View {
        let months = Dictionary(grouping: events) { DayKey(year: $0.startDay.year, month: $0.startDay.month, day: 1) }
        let disciplines = store.climbingDisciplines
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(months.keys.sorted(), id: \.self) { month in
                MonthLabel(month: month).stackIn()
                ForEach(months[month] ?? []) { event in
                    let open = expandable ? schedule.expanded.contains(event.id) : selectedEvent?.id == event.id
                    HighlightGate(state: hover, id: event.id) { lit in
                        ClimbingEventRow(event: event, open: open, highlighted: lit,
                                         disciplines: disciplines, chevron: expandable) { select(event.id) }
                            .equatable()
                    }
                    .onHover { inside in
                        if inside { hover.id = event.id } else if hover.id == event.id { hover.id = nil }
                    }
                    .stackIn()
                    if expandable && open {
                        ClimbingEventDetail(event: event, countries: store.climbingCountries, broadcast: store.climbingBroadcast)
                            .padding(.leading, 28)
                            .padding(.bottom, 6)
                            .transition(.opacity.animation(reduceMotion ? Motion.fade : Motion.reveal))
                    }
                }
            }
        }
    }

    private func select(_ id: String) {
        if layout.split {
            schedule.selectedEvent[.climbing] = id
        } else {
            let opening = !schedule.expanded.contains(id)
            withAnimation(opening ? (reduceMotion ? Motion.fade : Motion.standard) : Motion.exit) {
                if opening { schedule.expanded.insert(id) } else { schedule.expanded.remove(id) }
            }
        }
        if let event = allEvents.first(where: { $0.id == id }), !event.detailed {
            Task { await schedule.loadClimbingDetail(id, countries: Set(store.climbingCountries)) }
        }
    }
}

// MARK: - Status card

private struct StatusCard: View {
    let live: SeasonEvent?
    let next: SeasonEvent?
    let previousSeasonOver: String?
    let broadcast: ClimbingBroadcast?
    let store: ScoreStore

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                if let live {
                    HStack(spacing: 6) {
                        LiveDot()
                        Text("Live now · \(live.flag.map { "\($0) " } ?? "")\(live.shortName)")
                            .font(.system(size: 13, weight: .semibold))
                    }
                    Text(liveLine(live))
                        .font(.system(size: 11.5))
                        .foregroundStyle(.secondary)
                } else if let next {
                    Text(headline(next))
                        .font(.system(size: 13, weight: .semibold))
                    Text(subline(next))
                        .font(.system(size: 11.5).monospacedDigit())
                        .foregroundStyle(.secondary)
                } else {
                    Text("Season complete")
                        .font(.system(size: 13, weight: .semibold))
                    Text("The next calendar isn't published yet.")
                        .font(.system(size: 11.5))
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            if live != nil, let broadcast {
                Button {
                    NSWorkspace.shared.open(broadcast.url)
                } label: {
                    Label(broadcast.isLive ? "Watch" : "Stream", systemImage: "play.rectangle.fill")
                        .font(.system(size: 11.5, weight: .semibold))
                        .padding(.horizontal, 10)
                        .frame(height: 26)
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .foregroundStyle(broadcast.isLive ? .red : .primary)
                .glassCapsule(interactive: true)
                .help("Open the World Climbing stream on YouTube")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.primary.opacity(0.045)))
        .accessibilityElement(children: .combine)
    }

    private func liveLine(_ e: SeasonEvent) -> String {
        if let round = e.rounds.first(where: { $0.status == "active" }) { return round.label.capitalizedFirst + " underway" }
        return [DayKey.range(e.startDay, e.endDay), e.lanes.map(\.capitalized).joined(separator: " · ")].joined(separator: " · ")
    }

    private func headline(_ e: SeasonEvent) -> String {
        if let previous = previousSeasonOver { return "\(previous) season complete" }
        return "Next: \(e.flag.map { "\($0) " } ?? "")\(e.shortName)"
    }

    private func subline(_ e: SeasonEvent) -> String {
        let days = DayKey.today().days(to: e.startDay)
        let when = days <= 0 ? "starts today" : days == 1 ? "starts tomorrow" : days <= 6
            ? "starts \(e.startDay.displayDate.formatted(.dateTime.weekday(.wide)))" : "in \(days) days"
        if previousSeasonOver != nil {
            return "\(e.startDay.year) starts \(e.startDay.shortLabel) in \(e.shortName) · \(days) days"
        }
        return [DayKey.range(e.startDay, e.endDay), when].joined(separator: " · ")
    }
}

// MARK: - Rows

struct MonthLabel: View {
    let month: DayKey

    var body: some View {
        SectionTitle(month.displayDate.formatted(.dateTime.month(.wide).year()))
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, 16)
            .padding(.bottom, 3)
    }
}

struct ClimbingEventRow: View {
    let event: SeasonEvent
    let open: Bool
    let highlighted: Bool
    let disciplines: Set<String>
    var chevron = true
    /// "This weekend", "In 5 months" (a sport's page, where the season isn't on screen).
    var relative: String? = nil
    let action: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var outside: Bool { !event.lanes.isEmpty && Set(event.lanes).isDisjoint(with: disciplines) }

    var body: some View {
        Button(action: action) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(event.flag ?? "🏳️")
                    .font(.system(size: 15))
                    .frame(width: 20)
                VStack(alignment: .leading, spacing: 3) {
                    // The badge never truncates: beside the name when both
                    // fit, else under it ("WORLD CHAMPIONSHIPS" at 340).
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 6) {
                            title.fixedSize()
                            badge
                        }
                        VStack(alignment: .leading, spacing: 3) {
                            title.lineLimit(1)
                            badge
                        }
                    }
                    detail
                        .font(.system(size: 11))
                        .foregroundStyle(event.status == .live ? AnyShapeStyle(Color.red) : AnyShapeStyle(.secondary))
                        .lineLimit(1)
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(DayKey.range(event.startDay, event.endDay))
                        .font(.system(size: 11, weight: .medium).monospacedDigit())
                        .foregroundStyle(event.status == .finished ? .secondary : .primary)
                    if let relative {
                        Text(relative)
                            .font(.system(size: 10))
                            .foregroundStyle(event.status == .live ? AnyShapeStyle(Color.red) : AnyShapeStyle(.secondary))
                    }
                }
                if chevron {
                    Image(systemName: "chevron.right")
                        .font(Glyph.disclosure)
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(open ? 90 : 0))
                        .animation(reduceMotion ? nil : Motion.quick, value: open)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .opacity(outside || event.status == .canceled ? 0.5 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(ListRowStyle(hovering: highlighted || (!chevron && open), inset: 0))
        .padding(.horizontal, 6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([event.shortName, event.badge, DayKey.range(event.startDay, event.endDay), relative, detailLine]
            .compactMap { $0 }.joined(separator: ", "))
        .accessibilityValue(chevron ? (open ? "Expanded" : "Collapsed") : "")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { action() }
    }

    private var title: some View {
        HStack(spacing: 6) {
            if event.status == .live { LiveDot() }
            Text(event.shortName)
                .font(.system(size: 13, weight: .medium))
                .strikethrough(event.status == .canceled)
        }
    }

    @ViewBuilder
    private var badge: some View {
        if let badge = event.badge {
            Text(badge)
                .textCase(.uppercase)
                .font(.system(size: 9, weight: .semibold))
                .tracking(0.3)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 5)
                .frame(height: 15)
                .background(Capsule().fill(Color.primary.opacity(0.08)))
                .fixedSize()
        }
    }

    private var detailLine: String {
        if event.status == .live {
            return "Live" + (event.rounds.first { $0.status == "active" }.map { " · \($0.label)" } ?? "")
        }
        if event.status == .finished, let winners = winners { return winners }
        var parts = [event.lanes.map(\.capitalized).joined(separator: " · ")]
        let regs = event.registered.sorted { $0.key < $1.key }.map { "\(Flag.emoji(ioc: $0.key) ?? $0.key) \($0.value)" }
        if !regs.isEmpty { parts.append(regs.joined(separator: " ") + " registered") }
        if let place = event.place, !place.hasPrefix(event.shortName) { parts.insert(place, at: 0) }
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// A finished competition names every category's winner when they fit
    /// on the line, else the first two.
    @ViewBuilder
    private var detail: some View {
        if event.status == .finished, let all = SeasonResults.winners(event), let two = SeasonResults.winners(event, limit: 2), all != two {
            ViewThatFits(in: .horizontal) {
                Text(all).fixedSize()
                Text(two)
            }
        } else {
            Text(detailLine)
        }
    }

    /// "🥇 🇸🇮 Garnbret · 🇨🇭 Utelli" from the podiums, when loaded.
    private var winners: String? {
        SeasonResults.winners(event, limit: 2) ?? "Finished"
    }
}

/// A row redraws when what it shows changes, not on every hover elsewhere.
extension ClimbingEventRow: @MainActor Equatable {
    static func == (a: ClimbingEventRow, b: ClimbingEventRow) -> Bool {
        a.event == b.event && a.open == b.open && a.highlighted == b.highlighted && a.disciplines == b.disciplines
            && a.chevron == b.chevron && a.relative == b.relative
    }
}

/// An open competition: rounds by day with times in your zone (and the
/// venue's, when there's room), streams, your countries, links.
struct ClimbingEventDetail: View {
    let event: SeasonEvent
    let countries: [String]
    let broadcast: ClimbingBroadcast?
    /// Beside the list (split panel): name, place and dates on top.
    var showsHeader = false
    @Environment(\.widthClass) private var widthClass

    private var zone: TimeZone? { event.timeZone.flatMap(TimeZone.init(identifier:)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if showsHeader { header }
            if !event.detailed {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.mini)
                    Text("Loading rounds…").font(.system(size: 11)).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
            } else if event.rounds.allSatisfy({ $0.status == "pending" && !$0.start.isKnown }) && event.status == .upcoming {
                Text(categoriesLine)
                    .font(.system(size: 11.5))
                Text("Programme not published yet. Rounds and stream times appear about a week before.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                rounds
            }
            if !podiums.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    SubLabel("Podiums").padding(.top, 4)
                    ForEach(podiums, id: \.0) { category, line in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(category).font(.system(size: 11.5)).frame(width: 96, alignment: .leading)
                            Text(line).font(.system(size: 11.5)).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
            }
            if !event.registered.isEmpty {
                Text("Your countries: " + event.registered.sorted { $0.value > $1.value }
                    .map { "\(Flag.emoji(ioc: $0.key) ?? $0.key) \($0.value)" }.joined(separator: " · ") + " registered")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 12) {
                if let link = event.link { LinkButton(title: "ifsc.results.info", url: link) }
                if let sheet = event.infoSheet, event.status != .finished { LinkButton(title: "Info sheet", url: sheet) }
            }
            .padding(.top, 2)
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                Text(event.flag ?? "").font(.system(size: 18))
                Text(event.shortName).font(.system(size: 15, weight: .semibold))
                if let badge = event.badge {
                    Text(badge.uppercased())
                        .font(.system(size: 9, weight: .semibold)).tracking(0.3).foregroundStyle(.secondary)
                        .padding(.horizontal, 5).frame(height: 15)
                        .background(Capsule().fill(Color.primary.opacity(0.08)))
                }
            }
            Text([event.place, DayKey.range(event.startDay, event.endDay), event.lanes.map(\.capitalized).joined(separator: " · ")]
                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.system(size: 11.5).monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .padding(.bottom, 6)
    }

    /// "Lead Women: 🇸🇮 Garnbret, 🇮🇹 Rogora, 🇸🇮 Rekar"
    private var podiums: [(String, String)] {
        event.categories.filter { !$0.podium.isEmpty }.map { category in
            (category.name, category.podium.map { entry -> String in
                let parts = entry.split(separator: " ", maxSplits: 1).map(String.init)
                return parts.count == 2 ? "\(Flag.emoji(ioc: parts[0]) ?? parts[0]) \(parts[1])" : entry
            }.joined(separator: ", "))
        }
    }

    private var categoriesLine: String {
        let byDiscipline = Dictionary(grouping: event.categories) { String($0.name.split(separator: " ").first ?? "") }
        return byDiscipline.keys.sorted().map { discipline in
            let genders = (byDiscipline[discipline] ?? []).compactMap { $0.name.split(separator: " ").dropFirst().first.map(String.init) }
            return "\(discipline) · \(genders.joined(separator: ", "))"
        }.joined(separator: "   ")
    }

    @ViewBuilder
    private var rounds: some View {
        let timed = event.rounds.filter(\.start.isKnown).sorted { ($0.start.date ?? .distantFuture) < ($1.start.date ?? .distantFuture) }
        let untimed = event.rounds.filter { !$0.start.isKnown }
        let days = Dictionary(grouping: timed) { DayKey.of($0.start.date ?? .now) }
        ForEach(days.keys.sorted(), id: \.self) { day in
            SubLabel(day.mediumLabel).padding(.top, 2)
            ForEach(days[day] ?? []) { round in roundLine(round) }
        }
        if !untimed.isEmpty {
            if !timed.isEmpty {
                SubLabel("Time TBA").padding(.top, 2)
            }
            ForEach(untimed) { round in roundLine(round) }
        }
    }

    private func roundLine(_ round: ClimbingRound) -> some View {
        HStack(spacing: 8) {
            if round.status == "active" { LiveDot() }
            Text(round.label.capitalizedFirst)
                .font(.system(size: 12))
                .foregroundStyle(round.status == "finished" ? .secondary : .primary)
            if !round.categories.isEmpty {
                Text(round.categories.joined(separator: ", "))
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 6)
            if let date = round.start.date {
                Text(date.formatted(date: .omitted, time: .shortened))
                    .font(.system(size: 11, weight: .medium).monospacedDigit())
                if widthClass >= .large, let zone, zone.identifier != TimeZone.current.identifier {
                    Text(venueTime(date, zone))
                        .font(.system(size: 10.5).monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            } else {
                Text(round.status == "finished" ? "Finished" : "Time TBA")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
            if let stream = round.stream {
                Button { NSWorkspace.shared.open(stream) } label: {
                    Image(systemName: "play.rectangle").font(.system(size: 11))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Open the stream on YouTube")
                .accessibilityLabel("Watch \(round.label) on YouTube")
            }
        }
        .lineLimit(1)
    }

    private func venueTime(_ date: Date, _ zone: TimeZone) -> String {
        var style = Date.FormatStyle(date: .omitted, time: .shortened)
        style.timeZone = zone
        return "\(date.formatted(style)) in \(event.shortName)"
    }
}

/// "ifsc.results.info ↗"
struct LinkButton: View {
    let title: String
    let url: URL
    @State private var hovering = false

    var body: some View {
        Button { NSWorkspace.shared.open(url) } label: {
            HStack(spacing: 2) {
                Text(title)
                Image(systemName: "arrow.up.right").font(.system(size: 8, weight: .semibold))
            }
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(hovering ? Color.accentColor : .secondary)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(url.absoluteString)
    }
}

/// "Updated 2 minutes ago", or that the data is saved, not fresh.
struct SeasonFooter: View {
    let updated: Date?
    let stale: Bool
    let loading: Bool
    /// What the page shows, for the offline line ("calendar", "results").
    var subject = "calendar"

    var body: some View {
        HStack {
            UpdatedLabel(text: text, offline: { stale && updated != nil })
            Spacer()
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 8)
    }

    private func text(now: Date) -> String {
        guard let updated else { return loading ? "Updating…" : "" }
        if stale { return "Can't connect · Showing \(subject) from \(updated.formatted(date: .omitted, time: .shortened))" }
        return UpdatedLabel.ago(updated, now: now)
    }
}

/// A page footer's freshness line: "Updated 5 minutes ago", re-read every
/// 30 seconds (only while the page is on screen); offline, it leads with
/// the `wifi.slash` glyph. Secondary ink: it's information, not decoration.
/// Both are read here, in its own body, so a poll re-runs this line, not the page.
struct UpdatedLabel: View {
    let text: (Date) -> String
    var offline: () -> Bool = { false }
    @Environment(\.pageLive) private var live

    var body: some View {
        Group {
            if live {
                TimelineView(.periodic(from: .now, by: 30)) { context in line(context.date) }
            } else {
                line(.now)
            }
        }
        .font(.system(size: 11))
        .foregroundStyle(.secondary)
    }

    private func line(_ now: Date) -> some View {
        HStack(spacing: 4) {
            if offline() { Image(systemName: "wifi.slash").font(.system(size: 9.5, weight: .semibold)).accessibilityHidden(true) }
            Text(text(now)).lineLimit(1)
        }
    }

    /// "Updated just now", "Updated 5 minutes ago" (spelled out, never "5 min. ago").
    static func ago(_ date: Date, now: Date) -> String {
        if now.timeIntervalSince(date) < 60 { return "Updated just now" }
        return "Updated " + date.formatted(.relative(presentation: .named, unitsStyle: .wide))
    }
}

/// A static timeline frame and event rows while the calendar loads.
struct SeasonSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            RoundedRectangle(cornerRadius: 10).frame(height: 52).padding(.horizontal, 10).padding(.top, 4)
            ForEach(0..<3, id: \.self) { row in
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 3).frame(width: 36, height: 7)
                    RoundedRectangle(cornerRadius: 3).frame(width: CGFloat(60 + row * 40), height: 6).padding(.leading, CGFloat(row * 30))
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.top, row == 0 ? 18 : 9)
            }
            ForEach(0..<4, id: \.self) { _ in
                HStack(spacing: 10) {
                    Circle().frame(width: 16, height: 16)
                    VStack(alignment: .leading, spacing: 6) {
                        RoundedRectangle(cornerRadius: 3).frame(width: 90, height: 9)
                        RoundedRectangle(cornerRadius: 3).frame(width: 150, height: 7)
                    }
                    Spacer()
                    RoundedRectangle(cornerRadius: 3).frame(width: 50, height: 9)
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.top, 16)
            }
        }
        .foregroundStyle(Color.primary.opacity(0.07))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading calendar")
    }
}

extension String {
    /// "lead semi-final" → "Lead semi-final"
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
