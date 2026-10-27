import SwiftUI

// A sport's page leads with what's next at the level the sport is followed:
// a daily league's coming games, a football week, CS2's matches and
// tournaments, climbing's competitions. "Full Schedule" opens the season view
// (the list of game days, the week picker, the tournaments, the climbing
// season), so nobody has to click through days to find the next thing.

struct LeagueUpcomingSection: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.scheduleStore) private var injected
    @Environment(\.panelLayout) private var layout
    @Environment(\.stackArrival) private var page
    let league: League
    var onOpen: (Event) -> Void = { _ in }
    /// The league's full schedule, or (climbing, CS2) its season page with one item open.
    var onOpenSchedule: (ScheduleScope) -> Void = { _ in }
    /// The hovered or arrow-keyed row. A reference, so a change updates only
    /// the rows whose highlight flips (`HighlightGate`), not this page.
    @State private var highlight = HighlightState()
    private var highlightedID: String? {
        get { highlight.id }
        nonmutating set { highlight.id = newValue }
    }
    @State private var arrival: StackArrival?

    private var schedule: ScheduleStore { injected ?? .shared }
    private var scope: ScheduleScope { .for(league: league) }
    private var rowWidth: WidthClass { layout.split ? layout.column : layout.page }
    private var today: DayKey { .today() }
    /// Games shown: enough to see the next round, few enough to stay a preview.
    static let limit = 8
    private static let contentSpace = "hub.content"

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header.stackIn()
            content
        }
        .coordinateSpace(name: Self.contentSpace)
        .environment(\.stackArrival, arrival ?? page)
        .task(id: league.id) {
            let first = !loaded
            await load()
            // What lands after the page's entrance arrives as data.
            if first { arrival = .data(in: Self.contentSpace, page: page) }
        }
    }

    // MARK: Header

    /// The house section anatomy: title, caption, and the way to the full schedule.
    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            SectionTitle("Upcoming") {
                SectionLink("Full Schedule", help: fullScheduleHelp) { onOpenSchedule(scope) }
            }
            if let caption {
                Text(caption)
                    .font(Viz.note.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 10)
        .padding(.bottom, 4)
    }

    private var fullScheduleHelp: String {
        switch league.source {
        case .ifsc: "The season: every competition by month"
        case .counterStrike: "Every upcoming tournament"
        case .espn(_, true): "Week by week"
        case .espn: "Every coming game day"
        }
    }

    // MARK: Content

    private var loaded: Bool {
        switch league.source {
        case .ifsc: schedule.climbing.updated != nil || schedule.climbing.failed
        case .counterStrike: schedule.tournaments.updated != nil || schedule.tournaments.failed
        case .espn: schedule.agendas[scope]?.updated != nil || schedule.agendas[scope]?.failed == true
        }
    }

    @ViewBuilder
    private var content: some View {
        if !loaded {
            ScheduleSkeleton(days: 1, rows: 3)
        } else {
            switch league.source {
            case .ifsc: competitions
            case .counterStrike: counterStrike
            case .espn: games
            }
        }
    }

    // MARK: ESPN leagues

    /// Games still to play in what's loaded (football: this week, then next
    /// week when this one is nearly done).
    private var toPlay: [ScheduleItem] {
        let agenda = schedule.agenda(scope, store: store)
        let open: (ScheduleItem) -> Bool = { $0.status == .scheduled || $0.status == .live || $0.status == .postponed }
        let current = agenda.upcoming.flatMap(\.items).filter(open)
        guard current.count < Self.thinWeek, let next = schedule.weekAhead[league.id] else { return current }
        return current + next.items.filter(open)
    }

    /// The next games, a followed team's next two first, then in order by day.
    private var upcomingGames: [ScheduleItem] {
        let ahead = toPlay
        let followed = Set(store.followed.map(\.id))
        let isMine: (ScheduleItem) -> Bool = { $0.teams.contains { $0.id.map(followed.contains) ?? false } }
        // A followed team's next game beyond the loaded days still makes the cut.
        let later = schedule.nextGames.values.filter { $0.league == league.id && !ahead.contains($0) }
        let mine = Array((ahead.filter(isMine) + later).prefix(2))
        let picked = (mine + ahead.filter { !mine.contains($0) }).prefix(Self.limit)
        return Agenda.sorted(Array(picked)).sorted { $0.day < $1.day }
    }

    /// Fewer games than this left in a football week: show the next week too.
    private static let thinWeek = 3

    @ViewBuilder
    private var games: some View {
        let items = upcomingGames
        if items.isEmpty, schedule.agendas[scope]?.failed == true {
            failure("the schedule").stackIn()
        } else if items.isEmpty {
            ScheduleNote(text: "No games scheduled.").stackIn()
        } else {
            let days = Dictionary(grouping: items, by: \.day)
            ForEach(days.keys.sorted(), id: \.self) { day in
                let rows = Agenda.sorted(days[day] ?? [])
                dayLabel(day).stackIn()
                RowGrid(columns: layout.columns) {
                    ForEach(rows) { item in
                        row(item).stackIn()
                    }
                }
                .environment(\.statusColumnWidth, ScheduleRow.statusWidth(rows, store: store, width: rowWidth))
            }
        }
    }

    private func dayLabel(_ day: DayKey) -> some View {
        Text(day.relative(to: today).map { "\($0) · \(day.mediumLabel)" } ?? day.mediumLabel)
            .font(.system(size: 10.5, weight: .semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, 8)
            .padding(.bottom, 1)
            .accessibilityAddTraits(.isHeader)
            .accessibilityHeading(.h3)
    }

    private func row(_ item: ScheduleItem, showsCompetition: Bool = false) -> some View {
        HighlightGate(state: highlight, id: item.id) { lit in
            ScheduleRow(item: item, highlighted: lit, width: rowWidth, showsCompetition: showsCompetition,
                        onHover: { inside in
                            if inside { highlightedID = item.id } else if highlightedID == item.id { highlightedID = nil }
                        },
                        onSelect: { onOpen(store.current($0.event())) })
                .equatable()
        }
    }

    // MARK: CS2

    @ViewBuilder
    private var counterStrike: some View {
        let matches = Array(schedule.followedMatches.prefix(4))
        let events = nextTournaments
        if !matches.isEmpty {
            GroupLabel(title: "Your Teams", symbol: "star.fill")
                .padding(.horizontal, Metrics.gutter).padding(.top, 8).padding(.bottom, 2)
                .stackIn()
            RowGrid(columns: layout.columns) {
                ForEach(matches) { item in row(item, showsCompetition: true).stackIn() }
            }
            .environment(\.statusColumnWidth, ScheduleRow.statusWidth(matches, store: store, width: rowWidth))
        }
        if !events.isEmpty {
            if !matches.isEmpty {
                GroupLabel(title: "Tournaments", symbol: "trophy")
                    .padding(.horizontal, Metrics.gutter).padding(.top, 10).padding(.bottom, 2)
                    .stackIn()
            }
            RowGrid(columns: layout.columns) {
                let followed = schedule.followedCS(store)
                ForEach(events) { event in
                    HighlightGate(state: highlight, id: event.id) { lit in
                        TournamentRow(event: event, followed: followed, open: false, chevron: false,
                                      highlighted: lit, relative: Self.relative(event, today: today)) {
                            schedule.expanded.insert(event.id)
                            schedule.selectedEvent[.tournaments] = event.id
                            onOpenSchedule(.tournaments)
                        }
                        .equatable()
                    }
                    .onHover { inside in
                        if inside { highlightedID = event.id } else if highlightedID == event.id { highlightedID = nil }
                    }
                    .stackIn()
                }
            }
        } else if matches.isEmpty, schedule.tournaments.failed {
            failure("tournaments").stackIn()
        } else if matches.isEmpty {
            ScheduleNote(text: "No tournaments announced.").stackIn()
        }
    }

    private var nextTournaments: [SeasonEvent] {
        let all = schedule.tournaments.events["upcoming"] ?? []
        return Array(all.filter { $0.status == .live || $0.status == .upcoming }
            .sorted { ($0.status == .live ? 0 : 1, $0.startDay) < ($1.status == .live ? 0 : 1, $1.startDay) }
            .prefix(4))
    }

    // MARK: Climbing

    private var nextCompetitions: [SeasonEvent] {
        let all = store.tracked(schedule.climbing.seasons.flatMap { schedule.climbing.events[$0] ?? [] })
        return Array(all.filter { $0.status == .live || $0.status == .upcoming }.sorted { $0.startDay < $1.startDay }.prefix(4))
    }

    @ViewBuilder
    private var competitions: some View {
        let events = nextCompetitions
        if events.isEmpty, schedule.climbing.failed {
            failure("the calendar").stackIn()
        } else if events.isEmpty {
            ScheduleNote(text: "The next season's calendar isn't published yet.").stackIn()
        } else {
            RowGrid(columns: layout.columns) {
                ForEach(events) { event in
                    HighlightGate(state: highlight, id: event.id) { lit in
                        ClimbingEventRow(event: event, open: false, highlighted: lit, chevron: false,
                                         relative: Self.relative(event, today: today)) {
                            schedule.expanded.insert(event.id)
                            schedule.selectedEvent[.climbing] = event.id
                            schedule.climbingSeason = String(event.startDay.year)
                            onOpenSchedule(.climbing)
                        }
                        .equatable()
                    }
                    .onHover { inside in
                        if inside { highlightedID = event.id } else if highlightedID == event.id { highlightedID = nil }
                    }
                    .stackIn()
                }
            }
        }
    }

    // MARK: Caption

    /// One line that answers "when's the next one?" without a click.
    private var caption: String? {
        guard loaded else { return nil }
        switch league.source {
        case .ifsc:
            guard let next = nextCompetitions.first else { return nil }
            let name = [next.flag, next.shortName].compactMap { $0 }.joined(separator: " ")
            if next.status == .live { return "Live now: \(name) · \(DayKey.range(next.startDay, next.endDay))" }
            return "Next: \(name) · \(DayKey.range(next.startDay, next.endDay)) · \(Self.relative(next, today: today).lowercased())"
        case .counterStrike:
            if let match = schedule.followedMatches.first {
                return "Next for your teams: " + When.dayAndTime(match.sortDate, now: .now)
            }
            guard let next = nextTournaments.first else { return nil }
            if next.status == .live { return "Live now: \(next.shortName)" }
            return "Next: \(next.shortName) · \(DayKey.range(next.startDay, next.endDay))"
        case .espn(_, true):
            guard let week = schedule.selectedWeek[scope] else { return nil }
            let left = schedule.agenda(scope, store: store).upcoming.flatMap(\.items).filter { $0.status != .final }.count
            var parts = [week.label, week.detail, left > 0 ? "\(plural(left, "game")) to play" : "All played"]
            if left < Self.thinWeek, let next = schedule.weekAhead[league.id] { parts.append("then \(next.week.label)") }
            return parts.filter { !$0.isEmpty }.joined(separator: " · ")
        case .espn:
            let upcoming = schedule.agenda(scope, store: store).upcoming
            guard let first = upcoming.first(where: { $0.items.contains { $0.status != .final } }) else { return nil }
            let when = first.day.relative(to: today) ?? "\(first.day.mediumLabel) · in \(plural(today.days(to: first.day), "day"))"
            return "\(when) · \(plural(first.items.count, "game"))"
        }
    }

    // MARK: Loading

    /// What didn't load, said honestly (nothing retries on its own here), with
    /// the way to try again.
    private func failure(_ subject: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("Couldn't load \(subject). Check your internet connection.")
                .font(.system(size: 10.5))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            SectionLink(ErrorCopy.retry, symbol: "arrow.clockwise") { Task { await load(force: true) } }
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 3)
    }

    private func load(force: Bool = false) async {
        switch league.source {
        case .ifsc:
            await schedule.load(.climbing, store: store, force: force)
        case .counterStrike:
            async let tournaments: Void = schedule.load(.tournaments, store: store, force: force)
            async let matches: Void = schedule.loadFollowedMatches(store)
            _ = await (tournaments, matches)
        case .espn(_, true):
            await schedule.load(scope, store: store, force: force)
            let left = schedule.agenda(scope, store: store).upcoming.flatMap(\.items).filter { $0.status != .final }.count
            if left < Self.thinWeek { await schedule.loadWeekAhead(league, store: store) }
        case .espn:
            await schedule.load(scope, store: store, force: force)
        }
    }

    // MARK: Relative time

    /// "Now", "This weekend", "Thursday", "Next week", "In 12 days", "In 5 months".
    static func relative(_ event: SeasonEvent, today: DayKey) -> String {
        relative(start: event.startDay, end: event.endDay, today: today)
    }

    static func relative(start: DayKey, end: DayKey, today: DayKey) -> String {
        if start <= today && today <= end { return "Now" }
        let days = today.days(to: start)
        switch days {
        case ..<0: return "Finished"
        case 0: return "Today"
        case 1: return "Tomorrow"
        case 2...6:
            // Friday to Sunday this week reads as the weekend.
            return start.weekday >= 6 || start.weekday == 1 ? "This weekend" : start.displayDate.formatted(.dateTime.weekday(.wide))
        case 7...13: return "Next week"
        case 14...59: return "In \(days) days"
        default:
            let months = max(2, Int((Double(days) / 30.4).rounded()))
            return "In \(months) months"
        }
    }
}
