import SwiftUI

// Sports: every sport, and one search across its competitions and teams. A
// sport's page lists its leagues, cups and tournaments, then its teams. Opening
// a row never follows anything; the star does.

// MARK: - The teams

/// Every team list a sport's page or the search has asked for, kept for the session.
@MainActor
@Observable
final class SportsDirectory {
    static let shared = SportsDirectory()
    private(set) var teams: [String: [TeamOption]] = [:]
    private(set) var failed: Set<String> = []
    @ObservationIgnored private var loading: Set<String> = []
    private(set) var indexing = false

    /// The leagues whose teams make up the search: a cup's teams are a league's.
    private var indexed: [League] { League.catalog.filter { $0.source != .ifsc && $0.kind != .cup && $0.kind != .tournament } }

    func load(_ league: League) async {
        guard teams[league.id] == nil, loading.insert(league.id).inserted else { return }
        defer { loading.remove(league.id) }
        do {
            teams[league.id] = try await TeamCatalog.options(for: league)
            failed.remove(league.id)
        } catch {
            failed.insert(league.id)
        }
    }

    /// The whole search index, a few lists at a time.
    func loadAll() async {
        let missing = indexed.filter { teams[$0.id] == nil }
        guard !missing.isEmpty, !indexing else { return }
        indexing = true
        defer { indexing = false }
        for start in stride(from: 0, to: missing.count, by: 4) {
            await withTaskGroup(of: Void.self) { group in
                for league in missing[start..<min(start + 4, missing.count)] { group.addTask { await self.load(league) } }
            }
        }
    }

}

/// What a search finds. (pure; tested)
enum SportsSearch {
    struct Team: Identifiable, Equatable {
        let option: TeamOption
        let league: League
        var id: String { option.id }
    }

    struct Results: Equatable {
        var competitions: [League] = []
        var editions: [SeasonEvent] = []
        var teams: [Team] = []
        var isEmpty: Bool { competitions.isEmpty && editions.isEmpty && teams.isEmpty }
    }

    private static func matches(_ text: String, _ query: String) -> Bool {
        text.range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) != nil
    }

    static func results(_ query: String, directory: [String: [TeamOption]], editions: [SeasonEvent], limit: Int = 40) -> Results {
        let query = query.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return Results() }
        var results = Results()
        results.competitions = League.catalog.filter { matches("\($0.name) \($0.sport.name)", query) }
        results.editions = editions.filter { matches($0.name, query) }
        var seen = Set<String>()
        // A team plays in several competitions: it's listed once, under its league.
        for league in League.catalog {
            for option in directory[league.id] ?? [] where matches(option.name, query) && seen.insert(option.id).inserted {
                results.teams.append(Team(option: option, league: league))
            }
        }
        results.teams = Array(results.teams.sorted { rank($0.option.name, query) < rank($1.option.name, query) }.prefix(limit))
        return results
    }

    /// Names that start with what's typed come first.
    private static func rank(_ name: String, _ query: String) -> (Int, String) {
        (name.range(of: query, options: [.caseInsensitive, .diacriticInsensitive, .anchored]) == nil ? 1 : 0, name)
    }
}

// MARK: - Sports

struct SportsPage: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.scheduleStore) private var injected
    @Environment(\.stackArrival) private var page
    var backTitle = "Scores"
    let onBack: () -> Void
    let onOpenSport: (Sport) -> Void
    let onFollowing: () -> Void
    let onOpenLeague: (League) -> Void
    var onEdition: (EditionFollow) -> Void = { _ in }
    var onOpenTeam: (Profile.TeamRef) -> Void = { _ in }
    @State private var query = ""
    @FocusState private var searchFocused: Bool

    private var directory: SportsDirectory { .shared }
    private var schedule: ScheduleStore { injected ?? .shared }
    private var searching: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        VStack(spacing: 0) {
            PageHeader("Sports") { BackButton(title: backTitle, action: back) }
                .stackIn()
                .pageChrome()
            PageSearchField(prompt: "Search teams and competitions", text: $query, focused: $searchFocused)
                .onSubmit(openFirst)
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
                .frame(maxWidth: Metrics.formWidth)
                .frame(maxWidth: .infinity)
                .stackIn()
                .pageChrome()
            PageScrollView(keyboardScrolls: !searching) {
                StackColumn {
                    if searching { results } else { sports }
                }
                .formColumn()
                .padding(.bottom, 12)
            }
        }
        // Typing searches straight away.
        .onAppear { searchFocused = true }
        .onChange(of: searching) { _, on in
            if on { Task { await directory.loadAll() } }
        }
        .task {
            await schedule.load(.tournaments, store: store)
        }
    }

    private func back() {
        // Esc first clears a search, like any macOS search field.
        if !query.isEmpty { query = ""; return }
        onBack()
    }

    @ViewBuilder
    private var sports: some View {
        GroupBox {
            NavigationFormRow(title: "Following", symbol: "star", value: followingSummary, action: onFollowing)
        }
        .padding(.top, 4)
        SportsGroupLabel(title: "Sports", symbol: "sportscourt")
        GroupBox {
            ForEach(Sport.allCases) { sport in
                NavigationFormRow(title: sport.name, symbol: sport.symbol, value: followed(in: sport)) { onOpenSport(sport) }
            }
        }
    }

    /// "3 competitions · 1 team"
    private var followingSummary: String? {
        let parts = [store.enabledIDs.isEmpty ? nil : plural(store.enabledIDs.count, "competition"),
                     store.followed.isEmpty ? nil : plural(store.followed.count, "team")].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func followed(in sport: Sport) -> String? {
        let count = store.enabledLeagues.filter { $0.sport == sport }.count
        return count == 0 ? nil : "\(count) followed"
    }

    private var found: SportsSearch.Results {
        SportsSearch.results(query, directory: directory.teams, editions: schedule.tournaments.events["upcoming"] ?? [])
    }

    /// Return: the first thing found.
    private func openFirst() {
        let found = self.found
        if let league = found.competitions.first {
            onOpenLeague(league)
        } else if let team = found.teams.first {
            let ref = Profile.TeamRef(id: team.option.id, name: team.option.name, logo: team.option.logo, league: team.league.id)
            if ref.isSupported { onOpenTeam(ref) }
        }
    }

    @ViewBuilder
    private var results: some View {
        let found = self.found
        if !found.competitions.isEmpty {
            SportsGroupLabel(title: "Competitions", symbol: "trophy")
            GroupBox {
                ForEach(found.competitions) { league in
                    CompetitionRow(league: league, detail: league.sport.name) { onOpenLeague(league) }
                }
            }
        }
        if !found.editions.isEmpty {
            SportsGroupLabel(title: "Tournaments", symbol: "gamecontroller")
            GroupBox {
                ForEach(found.editions) { event in
                    TournamentFollowRow(event: event, onOpen: onEdition)
                }
            }
        }
        if !found.teams.isEmpty {
            SportsGroupLabel(title: "Teams", symbol: "person.3")
            GroupBox {
                ForEach(found.teams) { team in
                    TeamFollowRow(option: team.option, detail: team.league.name, league: team.league, onOpen: onOpenTeam)
                }
            }
        }
        if directory.indexing {
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini)
                Text("Looking through every team…").font(.system(size: 11)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .accessibilityElement(children: .combine)
        } else if found.isEmpty {
            EmptyState(symbol: "magnifyingglass", title: "No Results", message: "Nothing matches “\(query)”.")
        }
    }
}

/// One sport: its leagues, cups and tournaments, then its teams.
struct SportPage: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.scheduleStore) private var injected
    let sport: Sport
    var backTitle = "Sports"
    let onBack: () -> Void
    let onOpenLeague: (League) -> Void
    var onEdition: (EditionFollow) -> Void = { _ in }
    var onOpenTeam: (Profile.TeamRef) -> Void = { _ in }

    private var schedule: ScheduleStore { injected ?? .shared }
    private var leagues: [League] { League.catalog.filter { $0.sport == sport } }

    /// A league's teams belong to it; a cup's or a tournament's are its leagues'.
    private var teamLeagues: [League] { leagues.filter { $0.source != .ifsc && $0.kind != .cup && $0.kind != .tournament } }

    private var tournaments: [SeasonEvent] {
        let state = sport == .esports ? schedule.tournaments : sport == .climbing ? schedule.climbing : nil
        guard let state else { return [] }
        return state.seasons.flatMap { state.events[$0] ?? [] }.filter { $0.status == .live || $0.status == .upcoming }
    }

    var body: some View {
        VStack(spacing: 0) {
            PageHeader(sport.name, symbol: sport.symbol) { BackButton(title: backTitle, action: onBack) }
                .stackIn()
                .pageChrome()
            PageScrollView(keyboardScrolls: true) {
                StackColumn {
                    section("Leagues", "list.number", kind: .league)
                    section("Cups", "trophy", kind: .cup)
                    section("Tournaments", "trophy.fill", kind: .tournament)
                    circuit
                    if !teamLeagues.isEmpty {
                        SportsGroupLabel(title: "Teams", symbol: "person.3")
                        ForEach(teamLeagues) { league in
                            TeamDirectory(league: league, collapses: teamLeagues.count > 1, onOpen: onOpenTeam)
                        }
                    }
                }
                .formColumn()
                .padding(.bottom, 12)
            }
        }
        .task {
            if sport == .esports { await schedule.load(.tournaments, store: store) }
            if sport == .climbing { await schedule.load(.climbing, store: store) }
        }
    }

    @ViewBuilder
    private func section(_ title: String, _ symbol: String, kind: League.Kind) -> some View {
        let list = leagues.filter { $0.kind == kind }
        if !list.isEmpty {
            SportsGroupLabel(title: title, symbol: symbol)
            GroupBox {
                ForEach(list) { league in
                    CompetitionRow(league: league) { onOpenLeague(league) }
                }
            }
        }
    }

    /// A circuit (CS2's S-tier, climbing's series) is followed whole, or one event at a time.
    @ViewBuilder
    private var circuit: some View {
        if let league = leagues.first(where: { $0.kind == .circuit }) {
            SportsGroupLabel(title: sport == .climbing ? "Competitions" : "Tournaments", symbol: "trophy")
            GroupBox {
                CompetitionRow(league: league, detail: sport == .climbing ? "Every competition" : "Every S-tier tournament") { onOpenLeague(league) }
                ForEach(tournaments) { event in
                    TournamentFollowRow(event: event, onOpen: onEdition)
                }
            }
        }
    }
}

// MARK: - Rows

struct SportsGroupLabel: View {
    let title: String
    let symbol: String

    var body: some View {
        GroupLabel(title: title, symbol: symbol)
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 5)
    }
}

/// A competition: the row opens it, the star on it follows it.
private struct CompetitionRow: View {
    @Environment(ScoreStore.self) private var store
    let league: League
    var detail: String? = nil
    let onOpen: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(league.name).font(.system(size: 13)).lineLimit(1)
                    if let detail { Text(detail).font(.system(size: 10.5)).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer(minLength: 6)
                Color.clear.frame(width: 22, height: 1)  // room for the star
                Image(systemName: "chevron.right").font(Glyph.row).foregroundStyle(.tertiary).accessibilityHidden(true)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, detail == nil ? 7 : 5)
        }
        .buttonStyle(ListRowStyle(hovering: hovering))
        .onHover { hovering = $0 }
        .overlay(alignment: .trailing) {
            FollowStar(following: store.isEnabled(league), name: league.name, help: "Follow \(league.name): its games on the scores list") {
                store.setEnabled(league, !store.isEnabled(league))
            }
            .padding(.trailing, 12 + 7 + 8)
        }
    }
}

/// A team: the row opens its page where it has one, the star follows it everywhere it plays.
private struct TeamFollowRow: View {
    @Environment(ScoreStore.self) private var store
    let option: TeamOption
    var detail: String? = nil
    let league: League
    let onOpen: (Profile.TeamRef) -> Void
    var divider = false
    @State private var hovering = false

    private var page: Profile.TeamRef? {
        let ref = Profile.TeamRef(id: option.id, name: option.name, logo: option.logo, league: league.id)
        return ref.isSupported ? ref : nil
    }
    private var competitor: Competitor {
        Competitor(id: option.id, name: option.name, abbreviation: option.name, score: nil, logo: option.logo, isWinner: false)
    }

    var body: some View {
        Group {
            if let page {
                Button { onOpen(page) } label: { label(chevron: true) }
                    .buttonStyle(ListRowStyle(hovering: hovering))
                    .onHover { hovering = $0 }
            } else {
                label(chevron: false)
            }
        }
        .overlay(alignment: .trailing) {
            FollowStar(following: store.isFollowing(competitor), name: option.name, help: "Follow \(option.name): first on the scores list, in every competition, with alerts") {
                store.toggleFollow(competitor)
            }
            .padding(.trailing, page == nil ? 8 : 12 + 7 + 8)
        }
        .overlay(alignment: .top) {
            if divider { Divider().padding(.leading, 40) }
        }
    }

    private func label(chevron: Bool) -> some View {
        HStack(spacing: 8) {
            LogoView(url: option.logo, darkURL: option.darkLogo, size: 18)
            VStack(alignment: .leading, spacing: 1) {
                Text(option.name).font(.system(size: 13)).lineLimit(1)
                if let detail { Text(detail).font(.system(size: 10.5)).foregroundStyle(.secondary).lineLimit(1) }
            }
            Spacer(minLength: 6)
            Color.clear.frame(width: 22, height: 1)  // room for the star
            if chevron {
                Image(systemName: "chevron.right").font(Glyph.row).foregroundStyle(.tertiary).accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }
}

/// One CS2 tournament or climbing competition, followed on its own.
private struct TournamentFollowRow: View {
    @Environment(ScoreStore.self) private var store
    let event: SeasonEvent
    let onOpen: (EditionFollow) -> Void
    @State private var hovering = false

    private var edition: EditionFollow? {
        switch event.kind {
        case let .tournament(slug): EditionFollow(source: "cs2", key: slug, name: event.name)
        case let .climbing(id): EditionFollow(source: "ifsc", key: String(id), name: event.name)
        case .round: nil
        }
    }

    var body: some View {
        if let edition {
            Button { onOpen(edition) } label: {
                HStack(spacing: 8) {
                    if case .tournament = event.kind { TournamentLogo(url: event.logo, size: 18) }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(event.name).font(.system(size: 13)).lineLimit(1)
                        Text(DayKey.range(event.startDay, event.endDay)).font(.system(size: 10.5).monospacedDigit()).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 6)
                    if event.status == .live { LiveDot() }
                    Color.clear.frame(width: 22, height: 1)  // room for the star
                    Image(systemName: "chevron.right").font(Glyph.row).foregroundStyle(.tertiary).accessibilityHidden(true)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
            }
            .buttonStyle(ListRowStyle(hovering: hovering))
            .onHover { hovering = $0 }
            .overlay(alignment: .trailing) {
                FollowStar(following: store.editions.contains(edition), name: event.name, help: "Follow \(event.name) only") {
                    store.toggleEdition(edition)
                }
                .padding(.trailing, 12 + 7 + 8)
            }
        }
    }
}

/// A league's teams under a sport: a group that opens with a line of crests
/// where the sport has several leagues, the list itself where it has one.
private struct TeamDirectory: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.panelLayout) private var layout
    let league: League
    let collapses: Bool
    let onOpen: (Profile.TeamRef) -> Void
    @State private var groups = DisclosureGroups()
    @Namespace private var crestSpace

    private var directory: SportsDirectory { .shared }
    private var options: [TeamOption] { directory.teams[league.id] ?? [] }

    var body: some View {
        let flag = groups.flag(league.id)
        Group {
            if collapses {
                let open = flag.open
                let linked = flag.animating ? crestSpace : nil
                DisclosureHeader(title: league.name, count: options.count, noun: "team", open: open,
                                 highlighted: false, spokenPreview: nil, toggle: { toggle() }) {
                    CrestStrip(group: league.id,
                               crests: options.prefix(CollapsedPreview.maxLogos(for: min(layout.page, .medium)))
                                .map { CrestStrip.Crest(id: $0.id, name: $0.name, logo: $0.logo, darkLogo: $0.darkLogo) },
                               note: nil, revealNote: flag.collapsing)
                }
                .environment(\.logoNamespace, linked)
                if open { rows.environment(\.logoNamespace, linked) }
            } else {
                rows
            }
        }
        .task(id: league.id) {
            await directory.load(league)
            if collapses, !options.isEmpty {
                groups.prepare(scope: "sports.\(league.id)", [(id: league.id, members: [])], mine: [])
            }
        }
    }

    private func toggle() {
        groups.toggle(league.id, style: .click, reduceMotion: reduceMotion)
    }

    @ViewBuilder
    private var rows: some View {
        if directory.failed.contains(league.id) {
            VStack(spacing: 8) {
                Text("Couldn't load \(league.name)'s teams. \(ErrorCopy.message)")
                    .font(.system(size: 11.5)).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Button(ErrorCopy.retry) { Task { await directory.load(league) } }.controlSize(.small)
            }
            .frame(maxWidth: .infinity)
            .padding(16)
        } else if options.isEmpty {
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini)
                Text("Loading teams…").font(.system(size: 11)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .accessibilityElement(children: .combine)
        } else {
            OutlineBox(fadesIn: false) {
                LazyVStack(spacing: 0) {
                    ForEach(Array(options.enumerated()), id: \.element.id) { index, option in
                        TeamFollowRow(option: option, league: league, onOpen: onOpen, divider: index > 0)
                    }
                }
            }
        }
    }
}
