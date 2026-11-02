import AppKit
import SwiftUI

/// Results deeper than a row: a climbing category's full ranking, or a CS2
/// tournament's placings and matches. Opened from the season pages in results
/// mode and the league page (`Page.eventResults`).
struct EventResultsPage: View {
    let ref: EventResultsRef
    let backTitle: String
    let onBack: () -> Void
    let onOpen: (Event) -> Void
    let onOpenBracket: (BracketSource, Set<String>) -> Void

    init(ref: EventResultsRef, backTitle: String, onBack: @escaping () -> Void,
         onOpen: @escaping (Event) -> Void, onOpenBracket: @escaping (BracketSource, Set<String>) -> Void) {
        self.ref = ref
        self.backTitle = backTitle
        self.onBack = onBack
        self.onOpen = onOpen
        self.onOpenBracket = onOpenBracket
    }

    var body: some View {
        switch ref {
        case let .climbing(eventID, dcatID, category, eventName):
            ClimbingCategoryPage(eventID: eventID, dcatID: dcatID, category: category, eventName: eventName,
                                 backTitle: backTitle, onBack: onBack, onOpen: onOpen)
        case let .tournament(slug, name):
            TournamentResultsDetailPage(slug: slug, name: name, backTitle: backTitle, onBack: onBack,
                                        onOpen: onOpen, onOpenBracket: onOpenBracket)
        }
    }
}

// MARK: - Climbing: a category's full results

/// "Lead Women · Santiago": the rounds (each opens the match page), then
/// every athlete. Compact: the score from the last round each climbed, the
/// field dropping to the round before under a label. Wider: one column per round.
private struct ClimbingCategoryPage: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.seasonResultsStore) private var injected
    @Environment(\.stackArrival) private var page
    @Environment(\.panelLayout) private var layout
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(PanelCommands.self) private var commands: PanelCommands?
    let eventID: Int
    let category: String
    let eventName: String
    let backTitle: String
    let onBack: () -> Void
    let onOpen: (Event) -> Void
    /// The category shown. Seeded once from the page's reference (the page is
    /// rebuilt for another reference); the title menu switches it in place.
    @State private var dcat: Int
    @State private var showAll = false
    @State private var arrival: StackArrival?

    /// A ranking shows 40 rows, then all (a few more never hide behind a button).
    static let limit = 40
    private static let contentSpace = "results.category"

    init(eventID: Int, dcatID: Int, category: String, eventName: String, backTitle: String,
         onBack: @escaping () -> Void, onOpen: @escaping (Event) -> Void) {
        self.eventID = eventID
        self.category = category
        self.eventName = eventName
        self.backTitle = backTitle
        self.onBack = onBack
        self.onOpen = onOpen
        _dcat = State(initialValue: dcatID)
    }

    private var results: SeasonResultsStore { injected ?? .shared }
    private var wide: Bool { layout.page >= .large }

    var body: some View {
        let box = results.category(eventID, dcat)
        VStack(spacing: 0) {
            header(box).stackIn().pageChrome()
            content(box).frame(maxHeight: .infinity, alignment: .top)
            SeasonFooter(updated: box.updated, stale: box.stale, loading: box.loading, subject: "results").pageChrome()
        }
        .pageLoading(box.results == nil && !box.failed)
        .task(id: dcat) {
            let first = box.results == nil
            await results.loadCategory(eventID: eventID, dcatID: dcat)
            if first { arrival = .data(in: Self.contentSpace, page: page) }
        }
        .onChange(of: commands?.refreshToken) { reload() }
    }

    private func reload() {
        let dcat = dcat
        Task { await results.loadCategory(eventID: eventID, dcatID: dcat, force: true) }
    }

    // MARK: Header

    private func header(_ box: SeasonResultsStore.Category) -> some View {
        let categories = (box.event.flatMap { $0.tracking(store.climbingDisciplines) }?.categories ?? []).filter { $0.dcatID != nil }
        let name = box.results?.category ?? categories.first { $0.dcatID == dcat }?.name ?? category
        return TitleBarLayout {
            HStack(spacing: 6) { BackButton(title: backTitle, action: onBack) }
            PageTitleMenu(title: "\(name) · \(box.event?.shortName ?? eventName)", enabled: categories.count > 1,
                          help: "Choose a category") {
                ForEach(categories, id: \.name) { c in
                    Button {
                        guard let id = c.dcatID, id != dcat else { return }
                        // Another category of the same competition, in place: no Back step.
                        var instant = Transaction()
                        instant.disablesAnimations = true
                        withTransaction(instant) {
                            dcat = id
                            showAll = false
                        }
                    } label: {
                        if c.dcatID == dcat { Label(c.name, systemImage: "checkmark") } else { Text(c.name) }
                    }
                }
            }
            HStack(spacing: 6) {}
        }
        .pageHeader()
    }

    // MARK: Content

    @ViewBuilder
    private func content(_ box: SeasonResultsStore.Category) -> some View {
        if let results = box.results {
            PageScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(summary(results, event: box.event))
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .padding(.horizontal, Metrics.gutter)
                        .padding(.top, 4)
                        .stackIn()
                    rounds(results, event: box.event)
                    ranking(results)
                    if results.discipline == "speed" {
                        ProfileFootnote(text: "Final times in seconds. In brackets, the qualification time, which orders athletes out in the same round.")
                    }
                }
                .padding(.bottom, 14)
                .coordinateSpace(name: Self.contentSpace)
                .environment(\.stackArrival, arrival ?? page)
            }
        } else if box.failed {
            ErrorState("Results", retry: reload)
        } else {
            RankingSkeleton()
        }
    }

    /// "Oct 23–25 · 48 athletes" (the title already names the competition).
    private func summary(_ r: CategoryResults, event: SeasonEvent?) -> String {
        var parts: [String] = []
        if let event { parts.append(DayKey.range(event.startDay, event.endDay)) }
        parts.append(plural(r.rows.count, "athlete"))
        if r.status != "finished", !r.status.isEmpty { parts.append("In progress") }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private func rounds(_ r: CategoryResults, event: SeasonEvent?) -> some View {
        let open = r.rounds.filter { $0.status != "pending" && $0.status != "not_started" && $0.resultPath != nil }
        if let event, !open.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                SectionTitle("Rounds")
                // The latest round first: what most people open.
                HStack(spacing: 14) {
                    ForEach(open.reversed()) { round in
                        SectionLink(round.name, help: "Open the \(round.name.lowercased()): ranking, wall and scorecards") {
                            let link = SeasonEvent.RoundLink(id: round.id, name: round.name, status: round.status, resultPath: round.resultPath)
                            if let e = SeasonResults.roundEvent(event, category: r.category, round: link, winner: winner(r, round: round.id)) {
                                onOpen(e)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, 14)
            .stackIn()
        }
    }

    /// The round's winner, short ("🇸🇮 J. Garnbret").
    private func winner(_ r: CategoryResults, round: Int) -> String? {
        guard let row = r.rows.first(where: { $0.score(in: round)?.rank == 1 }) else { return nil }
        let parts = row.name.split(separator: " ", maxSplits: 1).map(String.init)
        return SeasonResults.shortName(parts.count == 2 ? parts[0] : "", parts.last ?? row.name, country: row.country)
    }

    // MARK: Ranking

    private enum Entry: Identifiable {
        case row(CategoryResults.Row, yours: Bool)
        /// The field drops to an earlier round from here ("Semi-final").
        case boundary(String, at: Int)
        case yoursBelow

        var id: String {
            switch self {
            case let .row(row, _): "a\(row.athleteID)"
            case let .boundary(label, index): "b\(index)-\(label)"
            case .yoursBelow: "yours"
            }
        }
    }

    private func entries(_ r: CategoryResults) -> [Entry] {
        let countries = Set(store.climbingCountries)
        let all = showAll || r.rows.count <= Self.limit + 5
        let shown = all ? r.rows[...] : r.rows.prefix(Self.limit)
        var out: [Entry] = []
        var stage = shown.first?.stage
        for (index, row) in shown.enumerated() {
            if !wide, index > 0, row.stage != stage {
                out.append(.boundary(row.stage, at: index))
                stage = row.stage
            }
            out.append(.row(row, yours: row.country.map(countries.contains) ?? false))
        }
        if !all {
            // Your countries' athletes further down stay in view.
            let below = r.rows.dropFirst(Self.limit).filter { $0.country.map(countries.contains) ?? false }
            if !below.isEmpty {
                out.append(.yoursBelow)
                out += below.map { .row($0, yours: true) }
            }
        }
        return out
    }

    private func column(_ r: CategoryResults) -> CGFloat { r.discipline == "speed" ? 78 : 58 }

    @ViewBuilder
    private func ranking(_ r: CategoryResults) -> some View {
        let columns = wide ? r.rounds : nil
        let width = column(r)
        VStack(alignment: .leading, spacing: 0) {
            ProfileGroupHeader(title: "Ranking",
                               columns: wide ? r.rounds.map { ($0.short, width) } : [(r.rows.first?.stage ?? "", 110)])
                .padding(.top, 10)
            ForEach(entries(r)) { entry in
                switch entry {
                case let .row(row, yours):
                    RankingResultRow(row: row, yours: yours, rounds: columns, column: width)
                        .equatable()
                case let .boundary(label, _):
                    HStack(spacing: 8) {
                        Rectangle().fill(Viz.grid).frame(height: 0.5)
                        SubLabel(label).fixedSize()
                    }
                    .padding(.top, 8)
                    .padding(.bottom, 2)
                    .accessibilityElement(children: .combine)
                case .yoursBelow:
                    HStack(spacing: 6) {
                        Text("Your countries").font(.system(size: 9.5, weight: .semibold)).foregroundStyle(.secondary)
                        Rectangle().fill(Viz.grid).frame(height: 0.5)
                    }
                    .padding(.vertical, 5)
                }
            }
            if !showAll, r.rows.count > Self.limit + 5 {
                ProfileMoreButton(title: "Show All \(r.rows.count)") {
                    withAnimation(reduceMotion ? Motion.fade : Motion.standard) { showAll = true }
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 6)
            }
        }
        // Wide: one table the eye can cross, not names at one edge and scores at the other.
        .frame(maxWidth: wide ? Metrics.readableWidth : nil, alignment: .leading)
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 6)
        .stackIn()
    }
}

/// One athlete: rank, flag, name (opens their page), and the score from the
/// last round they climbed, or every round's at large widths.
private struct RankingResultRow: View, Equatable {
    let row: CategoryResults.Row
    let yours: Bool
    /// One cell per round (large widths); nil for the last round's score only.
    let rounds: [CategoryResults.Round]?
    let column: CGFloat

    var body: some View {
        let athlete = Profile.PlayerRef(source: .ifsc, id: String(row.athleteID), name: row.name, country: row.country)
        HStack(spacing: 8) {
            Text(row.rankText)
                .font(.system(size: 11, weight: .semibold).monospacedDigit())
                .foregroundStyle(row.rank.map { $0 <= 3 } == true ? .primary : .secondary)
                .frame(width: 24, alignment: .trailing)
            // Flags carry the color on climbing pages; a missing one keeps its slot.
            Text(Flag.emoji(ioc: row.country) ?? "")
                .font(.system(size: 13))
                .frame(width: 18)
                .help(row.country.map(TeamCatalog.countryName) ?? "")
            PlayerNameLink(player: athlete) {
                Text(row.name)
                    .font(.system(size: 12, weight: yours ? .semibold : .regular))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .help(row.name)
            .layoutPriority(1)
            Spacer(minLength: 6)
            if let rounds {
                ForEach(rounds) { round in cell(row.score(in: round.id)) }
            } else {
                Text(row.last?.score ?? "–")
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .fixedSize()
            }
        }
        .padding(.vertical, rounds == nil ? 3 : 2)
        .padding(.horizontal, 6)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(yours ? Viz.highlight : .clear))
        .padding(.horizontal, -6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.spoken + (yours ? ", your country" : ""))
        .accessibilityAddTraits(.isLink)
        // A double click anywhere (or the menu) opens the climber's page too.
        .playerPageLink(athlete)
    }

    /// The round's score over the athlete's rank in it.
    private func cell(_ score: CategoryResults.Score?) -> some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text(score?.score ?? " ")
                .font(.system(size: 11).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.85)
            Text(score.flatMap { s in s.placing.flatMap { $0.first?.isNumber == false ? $0 : nil } ?? s.rank.map(Ordinal.string) } ?? " ")
                .font(.system(size: 10).monospacedDigit())
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(width: column, alignment: .trailing)
    }
}

/// Static rank rows while a ranking loads.
private struct RankingSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            RoundedRectangle(cornerRadius: 3).frame(width: 170, height: 8).padding(.top, 8)
            RoundedRectangle(cornerRadius: 3).frame(width: 60, height: 7).padding(.top, 20)
            ForEach(0..<8, id: \.self) { row in
                HStack(spacing: 10) {
                    RoundedRectangle(cornerRadius: 3).frame(width: 14, height: 8)
                    Circle().frame(width: 12, height: 12)
                    RoundedRectangle(cornerRadius: 3).frame(width: CGFloat(110 + (row * 37) % 60), height: 8)
                    Spacer()
                    RoundedRectangle(cornerRadius: 3).frame(width: 30, height: 8)
                }
                .padding(.top, 13)
            }
        }
        .padding(.horizontal, Metrics.gutter)
        .foregroundStyle(Color.primary.opacity(0.07))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading results")
    }
}

// MARK: - CS2: a tournament's results

/// "ESL Pro League Season 24": the champion, the placings with prize money,
/// and every match by round, newest round first. Bracket › opens the tree.
private struct TournamentResultsDetailPage: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.seasonResultsStore) private var injected
    @Environment(\.stackArrival) private var page
    @Environment(\.panelLayout) private var layout
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(PanelCommands.self) private var commands: PanelCommands?
    let slug: String
    let name: String
    let backTitle: String
    let onBack: () -> Void
    let onOpen: (Event) -> Void
    let onOpenBracket: (BracketSource, Set<String>) -> Void
    @State private var showAllPlacements = false
    @State private var showAllMatches = false
    /// The hovered match row (a reference: a hover redraws two rows).
    @State private var hover = HighlightState()
    @State private var arrival: StackArrival?

    /// Placings shown before "Show All"; matches shown (whole rounds) before "Show All".
    static let placings = 8
    static let matches = 16
    private static let contentSpace = "results.tournament"

    private var results: SeasonResultsStore { injected ?? .shared }
    private var followed: Set<String> { Set(store.followed.map(\.id).filter { $0.hasPrefix("cs-") }) }
    private var rowWidth: WidthClass { layout.split ? layout.column : layout.page }

    var body: some View {
        let box = results.tournament(slug)
        VStack(spacing: 0) {
            PageHeader(SeasonResults.displayName(name)) {
                BackButton(title: backTitle, action: onBack)
            } trailing: {
                moreMenu(box)
            }
            .stackIn()
            .pageChrome()
            content(box).frame(maxHeight: .infinity, alignment: .top)
            SeasonFooter(updated: box.updated, stale: box.stale, loading: box.loading, subject: "results").pageChrome()
        }
        .pageLoading(box.tournament == nil && !box.failed)
        .task {
            let first = box.groups.isEmpty
            await results.loadTournament(slug: slug)
            if first { arrival = .data(in: Self.contentSpace, page: page) }
        }
        .onChange(of: commands?.refreshToken) { reload() }
    }

    private func reload() {
        Task { await results.loadTournament(slug: slug, force: true) }
    }

    private func openBracket() {
        // The bracket knows teams by bo3.gg's bare ID ("667"), as the match page passes them.
        onOpenBracket(.csTournament(slug: slug, name: name), Set(followed.map { String($0.dropFirst(3)) }))
    }

    private func moreMenu(_ box: SeasonResultsStore.Tournament) -> some View {
        Menu {
            Button("Bracket", systemImage: "trophy") { openBracket() }
            if let link = box.tournament?.event.link {
                Button("Open in Browser", systemImage: "safari") { NSWorkspace.shared.open(link) }
            }
            Divider()
            // Shows ⌘R; whichever binding takes the key, it's the panel's refresh.
            Button("Refresh") { if let commands { commands.refresh(store) } else { reload() } }.keyboardShortcut("r")
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

    @ViewBuilder
    private func content(_ box: SeasonResultsStore.Tournament) -> some View {
        if let tournament = box.tournament {
            PageScrollView {
                Group {
                    if layout.split {
                        // Split: who placed where on the left, how they got there on the right.
                        HStack(alignment: .top, spacing: 0) {
                            VStack(alignment: .leading, spacing: 0) {
                                ChampionCard(tournament: tournament, final: box.final)
                                    .padding(.horizontal, 10)
                                    .padding(.top, 4)
                                    .stackIn()
                                placements(tournament, box: box)
                            }
                            .frame(maxWidth: .infinity, alignment: .top)
                            matches(box)
                                .padding(.top, -14)
                                .frame(maxWidth: .infinity, alignment: .top)
                        }
                        .environment(\.widthClass, layout.column)
                    } else {
                        VStack(alignment: .leading, spacing: 0) {
                            ChampionCard(tournament: tournament, final: box.final)
                                .padding(.horizontal, 10)
                                .padding(.top, 4)
                                .stackIn()
                            placements(tournament, box: box)
                            matches(box)
                        }
                    }
                }
                .padding(.bottom, 14)
                .coordinateSpace(name: Self.contentSpace)
                .environment(\.stackArrival, arrival ?? page)
            }
        } else if box.failed {
            ErrorState("Results", retry: reload)
        } else {
            SeasonSkeleton()
        }
    }

    // MARK: Placements

    @ViewBuilder
    private func placements(_ tournament: FinishedTournament, box: SeasonResultsStore.Tournament) -> some View {
        let all = tournament.placements
        // Beside the matches there's room for a 16-team field.
        let limit = layout.split ? 16 : Self.placings
        let cut = showAllPlacements || all.count <= limit + 2 ? all.count : limit
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle("Placements") {
                if box.matches > 0 { SectionLink("Bracket", help: "Open the bracket", action: openBracket) }
            }
            .padding(.bottom, 4)
            if all.isEmpty {
                Text("Placings aren't published for this tournament.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 4)
            } else {
                PlacementsTable(placements: Array(all.prefix(cut)), followed: followed)
                if cut < all.count {
                    ProfileMoreButton(title: "Show All \(all.count)") {
                        withAnimation(reduceMotion ? Motion.fade : Motion.standard) { showAllPlacements = true }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)
                }
            }
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 18)
        .stackIn()
    }

    // MARK: Matches

    @ViewBuilder
    private func matches(_ box: SeasonResultsStore.Tournament) -> some View {
        let groups = shownGroups(box.groups)
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle("Matches")
                .padding(.horizontal, Metrics.gutter)
                .padding(.bottom, 2)
            if box.groups.isEmpty, box.loading {
                ScheduleSkeleton(days: 1, rows: 3)
            } else if box.groups.isEmpty {
                ProfileFootnote(text: box.failed ? "Couldn't load the matches." : "No matches listed for this tournament.",
                                retry: box.failed ? reload : nil)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(groups) { group in
                        SubLabel(group.title)
                            .padding(.horizontal, Metrics.gutter)
                            .padding(.top, 10)
                            .padding(.bottom, 2)
                        ForEach(group.items) { item in
                            HighlightGate(state: hover, id: item.id) { lit in
                                ScheduleRow(item: item, highlighted: lit, width: rowWidth, showsCompetition: false,
                                            onHover: { inside in
                                                if inside { hover.id = item.id } else if hover.id == item.id { hover.id = nil }
                                            },
                                            onSelect: { onOpen($0.event()) })
                                    .equatable()
                            }
                        }
                    }
                }
                .environment(\.statusColumnWidth, ScheduleRow.statusWidth(groups.flatMap(\.items), store: store, width: rowWidth))
                if groups.count < box.groups.count {
                    ProfileMoreButton(title: "Show All \(box.matches) Matches") {
                        withAnimation(reduceMotion ? Motion.fade : Motion.standard) { showAllMatches = true }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 6)
                }
            }
        }
        .padding(.top, 18)
        .stackIn()
    }

    /// Whole rounds, newest first, until about 16 matches are on screen.
    private func shownGroups(_ groups: [MatchGroup]) -> [MatchGroup] {
        guard !showAllMatches else { return groups }
        var shown: [MatchGroup] = []
        var count = 0
        for group in groups {
            if count >= Self.matches, !shown.isEmpty { break }
            shown.append(group)
            count += group.items.count
        }
        return shown
    }
}

/// "🏆 Vitality · Champions", how the final went, and the tournament's facts.
struct ChampionCard: View {
    let tournament: FinishedTournament
    let final: String?

    var body: some View {
        let event = tournament.event
        let top = tournament.placements.first
        let shared = top.map { first in tournament.placements.filter { $0.order == first.order } } ?? []
        HStack(alignment: .top, spacing: 10) {
            if let top, shared.count == 1 {
                TeamCrest(team: ref(top.team), size: 28)
            } else {
                TournamentLogo(url: event.logo, size: 28)
            }
            VStack(alignment: .leading, spacing: 3) {
                if let top, shared.count == 1, top.place == "1st" {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("🏆").font(.system(size: 13)).accessibilityHidden(true)
                        TeamNameLink(team: ref(top.team)) {
                            Text(top.team.name).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                        }
                        Spacer(minLength: 4)
                        Text("Champions").font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                    if let final {
                        Text(final).font(.system(size: 11.5).monospacedDigit()).lineLimit(2)
                    }
                } else if let top {
                    // A qualification stage: its top places go through together.
                    Text("\(top.place): " + shared.map(\.team.name).joined(separator: ", "))
                        .font(.system(size: 13, weight: .semibold))
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text(event.name).font(.system(size: 13, weight: .semibold)).lineLimit(2)
                    Text("Results not published yet.").font(.system(size: 11.5)).foregroundStyle(.secondary)
                }
                Text(facts(event))
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .padding(.top, 1)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.primary.opacity(0.045)))
        .accessibilityElement(children: .combine)
    }

    /// "Oct 3–11 · LAN · $1M · 16 teams"
    private func facts(_ event: SeasonEvent) -> String {
        var parts = [DayKey.range(event.startDay, event.endDay)]
        if let place = event.place { parts.append([event.flag, place].compactMap { $0 }.joined(separator: " ")) }
        if let format = event.format { parts.append(format) }
        if let prize = ScheduleProvider.CS.prize(event.prize) { parts.append(prize) }
        // The field's size, when the placings account for all of it ("15th–16th" of 16).
        if let last = tournament.placements.last, Self.lastPlace(last) == tournament.placements.count {
            parts.append(plural(tournament.placements.count, "team"))
        }
        return parts.joined(separator: " · ")
    }

    private func ref(_ team: ScheduleTeam) -> Profile.TeamRef {
        Profile.TeamRef(id: team.id ?? team.name, name: team.name, logo: team.logo, league: "cs2", abbreviation: team.abbreviation)
    }

    /// "15th–16th" → 16; "4th" → 4.
    static func lastPlace(_ p: Placement) -> Int {
        let end = p.place.split(separator: "–").last.map { String($0.prefix { $0.isNumber }) }
        return end.flatMap(Int.init) ?? p.order
    }
}

/// Placings: place (on a tie group's first row only), team (opens its page),
/// prize money. Followed teams are starred and highlighted, as in the list.
struct PlacementsTable: View {
    let placements: [Placement]
    let followed: Set<String>

    var body: some View {
        let showsMoney = placements.contains { ScheduleProvider.CS.prize($0.money) != nil }
        let placeWidth = Self.placeWidth(placements)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(placements.enumerated()), id: \.offset) { index, p in
                let first = index == 0 || placements[index - 1].place != p.place
                PlacementRow(placement: p, showsPlace: first, placeWidth: placeWidth, showsMoney: showsMoney,
                             followed: p.team.id.map(followed.contains) ?? false)
                    .padding(.top, first && index > 0 ? 3 : 0)
            }
        }
    }

    /// The widest place label ("17th–24th"), measured once per table.
    static func placeWidth(_ placements: [Placement]) -> CGFloat {
        let font = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .semibold)
        let widest = Set(placements.map(\.place)).reduce(CGFloat(0)) { widest, place in
            max(widest, (place as NSString).size(withAttributes: [.font: font]).width)
        }
        return min(max(widest.rounded(.up) + 4, 30), 80)
    }
}

private struct PlacementRow: View, Equatable {
    let placement: Placement
    let showsPlace: Bool
    let placeWidth: CGFloat
    let showsMoney: Bool
    let followed: Bool

    var body: some View {
        let team = Profile.TeamRef(id: placement.team.id ?? placement.team.name, name: placement.team.name, logo: placement.team.logo,
                                   league: "cs2", abbreviation: placement.team.abbreviation)
        let money = ScheduleProvider.CS.prize(placement.money)
        HStack(spacing: 8) {
            Text(showsPlace ? placement.place : "")
                .font(.system(size: 11, weight: .semibold).monospacedDigit())
                .foregroundStyle(placement.order <= 3 ? .primary : .secondary)
                .frame(width: placeWidth, alignment: .leading)
            TeamCrest(team: team, size: 16)
            TeamNameLink(team: team) {
                Text(placement.team.name).font(.system(size: 12, weight: followed ? .semibold : .regular)).lineLimit(1)
            }
            if followed {
                Image(systemName: "star.fill").font(.system(size: 7)).foregroundStyle(.yellow).accessibilityLabel("Following")
            }
            Spacer(minLength: 6)
            if showsMoney, let money {
                Text(money)
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .help(clubPrize ?? "Prize money")
            }
        }
        .padding(.vertical, 3)
        .padding(.horizontal, 6)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(followed ? Viz.highlight : .clear))
        .padding(.horizontal, -6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([placement.place.replacingOccurrences(of: "–", with: " to "), placement.team.name, money,
                             followed ? "Following" : nil].compactMap { $0 }.joined(separator: ", "))
    }

    /// "Club prize $170K" (bo3.gg's separate club share), when there is one.
    private var clubPrize: String? {
        ScheduleProvider.CS.prize(placement.clubMoney).map { "Club prize \($0)" }
    }
}
