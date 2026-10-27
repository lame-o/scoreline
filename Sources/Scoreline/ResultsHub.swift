import SwiftUI

// "What just happened" beside "what's next": a league page's Results section
// (its latest round, your teams first) under Upcoming, and a team page's
// Results section (form and the last five) after Last Game / Next. Both lead
// to the full Results page. Same anatomy as Upcoming: `SectionTitle` with a
// `SectionLink`, a caption, rows.

// MARK: - League page

struct LeagueResultsSection: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.resultsStore) private var injected
    @Environment(\.panelLayout) private var layout
    @Environment(\.stackArrival) private var page
    let league: League
    var onOpen: (Event) -> Void = { _ in }
    /// The league's Results page.
    var onOpenResults: () -> Void = {}
    /// A climbing category's or a CS2 tournament's results page.
    var onOpenEvent: (EventResultsRef) -> Void = { _ in }
    @State private var highlight = HighlightState()
    @State private var latest: (round: ResultRound, items: [ScheduleItem])?
    @State private var loaded = false
    @State private var arrival: StackArrival?

    private var results: ResultsStore { injected ?? .shared }
    private var rowWidth: WidthClass { layout.split ? layout.column : layout.page }
    private static let contentSpace = "hub.results"

    var body: some View {
        switch league.source {
        case .ifsc, .counterStrike:
            // The last finished competitions or tournaments, with their winners.
            VStack(alignment: .leading, spacing: 0) {
                header
                SeasonResultsPreview(league: league, onOpen: onOpen, onOpenResults: onOpenResults, onOpenEvent: onOpenEvent)
            }
        case .espn:
            VStack(alignment: .leading, spacing: 0) {
                header.stackIn()
                content
            }
            .coordinateSpace(name: Self.contentSpace)
            .environment(\.stackArrival, arrival ?? page)
            .task(id: league.id) { await load() }
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            SectionTitle("Results") {
                SectionLink("All Results", help: linkHelp) {
                    onOpenResults()
                }
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
        .padding(.top, 14)
        .padding(.bottom, 4)
    }

    private var weekly: Bool { if case .espn(_, true) = league.source { true } else { false } }

    private var linkHelp: String {
        switch league.source {
        case .ifsc: "Every competition"
        case .counterStrike: "Every tournament"
        case .espn: weekly ? "Week by week" : "Round by round"
        }
    }

    /// "Matchweek 8 · Oct 23–25 · 8 of 10 shown"
    private var caption: String? {
        guard let latest else { return nil }
        let played = Self.played(latest.items)
        let shown = min(played.count, LeagueUpcomingSection.limit)
        let count = shown < played.count ? "\(shown) of \(played.count) shown" : plural(played.count, "result")
        let detail = latest.round.title.contains(latest.round.detail) ? nil : latest.round.detail
        return [latest.round.title, detail, count].compactMap { $0 }.joined(separator: " · ")
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if !loaded {
            ScheduleSkeleton(days: 1, rows: 3)
        } else if let latest {
            let rows = Self.pick(latest.items, followed: Set(store.followed.map(\.id)))
            if rows.isEmpty {
                ScheduleNote(text: "No results yet this season.").stackIn()
            } else {
                let days = Dictionary(grouping: rows, by: \.day)
                ForEach(days.keys.sorted(), id: \.self) { day in
                    let dayRows = days[day] ?? []
                    dayLabel(day).stackIn()
                    RowGrid(columns: layout.columns) {
                        ForEach(dayRows) { item in row(item).stackIn() }
                    }
                    .environment(\.statusColumnWidth, ScheduleRow.statusWidth(dayRows, store: store, width: rowWidth))
                }
            }
        } else {
            failure.stackIn()
        }
    }

    /// Played games of the round (Upcoming has the rest).
    static func played(_ items: [ScheduleItem]) -> [ScheduleItem] {
        items.filter { $0.status == .final || $0.status == .postponed || $0.status == .canceled }
    }

    /// Up to eight: your teams' games first (two at most), then kickoff
    /// order; shown by day, in kickoff order. Pure: tested.
    static func pick(_ items: [ScheduleItem], followed: Set<String>, limit: Int = LeagueUpcomingSection.limit) -> [ScheduleItem] {
        let played = Agenda.sorted(Self.played(items))
        let isMine: (ScheduleItem) -> Bool = { $0.teams.contains { $0.id.map(followed.contains) ?? false } }
        let mine = Array(played.filter(isMine).prefix(2))
        let picked = Array((mine + played.filter { !mine.contains($0) }).prefix(limit))
        // By day; within a day, your teams' first, then kickoff order.
        let ordered = Agenda.sorted(picked)
        let rank = Dictionary(ordered.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { a, _ in a })
        return ordered.sorted { a, b in
            (a.day, mine.contains(a) ? 0 : 1, rank[a.id] ?? 0) < (b.day, mine.contains(b) ? 0 : 1, rank[b.id] ?? 0)
        }
    }

    private func dayLabel(_ day: DayKey) -> some View {
        Text(day.relative(to: .today()).map { "\($0) · \(day.mediumLabel)" } ?? day.mediumLabel)
            .font(.system(size: 10.5, weight: .semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, 8)
            .padding(.bottom, 1)
            .accessibilityAddTraits(.isHeader)
            .accessibilityHeading(.h3)
    }

    private func row(_ item: ScheduleItem) -> some View {
        HighlightGate(state: highlight, id: item.id) { lit in
            ScheduleRow(item: item, highlighted: lit, width: rowWidth, showsCompetition: false,
                        onHover: { inside in
                            if inside { highlight.id = item.id } else if highlight.id == item.id { highlight.id = nil }
                        },
                        onSelect: { onOpen(store.current($0.event())) },
                        details: results.showsDetails)
                .equatable()
        }
    }

    private var failure: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("Couldn't load the results. Check your internet connection.")
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
        let first = !loaded
        if force { await results.open(.league(league.id), store: store, force: true) }
        latest = await results.latest(league, store: store)
        loaded = true
        // What lands after the page's entrance arrives as data.
        if first { arrival = .data(in: Self.contentSpace, page: page) }
    }
}

// MARK: - Team page

/// The team page's Results: the form strip, the last five from the team's
/// side, and the way to the whole season.
struct TeamResultsSection: View {
    let season: TeamSeason
    let sport: Sport?
    var details = true
    let onOpen: (ScheduleItem) -> Void
    let onOpenAll: () -> Void
    @State private var highlight = HighlightState()

    private var caption: String {
        switch sport {
        case .soccer?: "All competitions, newest first."
        case .esports?: "From bo3.gg."
        default: "This season, newest first."
        }
    }

    var body: some View {
        DetailSection(title: "Results", caption: caption) {
            if !season.form.isEmpty {
                let marks = Array(season.form.suffix(5))
                HStack(alignment: .center, spacing: 10) {
                    FormStrip(marks: marks, hover: highlight, onOpen: { id in
                        if let item = season.results.first(where: { $0.id == id }) { onOpen(item) }
                    })
                    // The rows below already lead with the latest: the line names a pointed-at mark only.
                    FormReadout(marks: marks, hover: highlight, fallsBackToLatest: false)
                    Spacer(minLength: 0)
                }
            }
            VStack(alignment: .leading, spacing: 0) {
                ForEach(season.results.prefix(5)) { item in
                    HighlightGate(state: highlight, id: item.id) { lit in
                        TeamResultRow(item: item, team: season.team.id, details: details, highlighted: lit,
                                      onHover: { inside in
                                          if inside { highlight.id = item.id } else if highlight.id == item.id { highlight.id = nil }
                                      },
                                      onSelect: onOpen)
                            .equatable()
                    }
                }
            }
            // The rows' own inset sits on the section's gutter.
            .padding(.horizontal, -14)
            SectionLink("All Results", help: "Every result this season") { onOpenAll() }
        }
    }
}
