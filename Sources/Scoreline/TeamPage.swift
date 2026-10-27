import SwiftUI

/// A team: who they are, their next game, the roster the way the sport thinks
/// of it, leaders, where they rank, injuries and moves. The match page's
/// grammar: the team-color wash behind a clear glass card, `DetailSection`s in
/// one column, or two from 680pt with the long roster on the right.
///
/// Standalone: it takes a reference and a back action, reads the navigator
/// and the score store from the environment when present (the render harness
/// passes neither), and loads through `ProfileStore`.
struct TeamPage: View {
    let ref: Profile.TeamRef
    var backTitle: String = "Scores"
    /// The team's schedule, either way in time (Results' "All Results").
    var onOpenSchedule: (ScheduleScope, ScheduleMode) -> Void = { _, _ in }
    let onBack: () -> Void

    @State private var state: TeamState
    /// The season's results (all competitions for a club), for the Results section.
    @State private var season: TeamSeason?
    @State private var arrival: StackArrival?
    @State private var standings: [StandingsRow] = []
    /// Bumped when the logo's colors arrive, so the wash takes them.
    @State private var colorsVersion = 0
    private let store: ProfileStore

    @Environment(ScoreStore.self) private var scores: ScoreStore?
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?
    @Environment(\.panelLayout) private var layout
    @Environment(\.stackArrival) private var page
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let contentSpace = "team.content"

    init(ref: Profile.TeamRef, backTitle: String = "Scores", store: ProfileStore? = nil,
         onOpenSchedule: @escaping (ScheduleScope, ScheduleMode) -> Void = { _, _ in }, onBack: @escaping () -> Void) {
        self.ref = ref
        self.backTitle = backTitle
        self.onOpenSchedule = onOpenSchedule
        self.onBack = onBack
        let store = store ?? .shared
        self.store = store
        _state = State(initialValue: store.state(for: ref))
    }

    enum Section: Hashable {
        case next, results, roster, leaders, stats, standings, injuries, transactions, titles, career
    }

    var body: some View {
        VStack(spacing: 0) {
            header.stackIn().pageChrome()
            PageScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    hero.stackIn()
                    if let live = liveEvent { liveStrip(live).stackIn() }
                    StackContainer(layout: AnyLayout(MatchColumnsLayout(columns: layout.columns))) { content }
                        .accessibilityElement(children: .contain)
                        .coordinateSpace(name: Self.contentSpace)
                        .environment(\.stackArrival, arrival ?? page)
                    footer
                }
                .padding(.bottom, 14)
            }
        }
        .background(alignment: .top) {
            // The logo's colors arrive as a change of light: the new wash
            // crossfades in over the old.
            ZStack { wash.id(colorsVersion).transition(.opacity) }
                .animation(reduceMotion ? Motion.fade : Motion.light, value: colorsVersion)
                .frame(height: 250)
                .ignoresSafeArea()
                .stackIn(slides: false)
        }
        .pageLoading(state.header == nil && !state.loaded)
        .task(id: ref.id) {
            await store.load(ref)
            async let results: Void = loadResults()
            async let standings: Void = loadStandings()
            await ProfileColors.awaitLogoColors(state.header?.logo ?? ref.logo) { colorsVersion += 1 }
            await standings
            await results
        }
        .onChange(of: shown) { old, new in
            // Sections that land later assemble like a page entrance; ones already shown stay put.
            if new.count > old.count { arrival = .data(in: Self.contentSpace, page: page) }
        }
    }

    // MARK: Header

    /// No title: the hero below is the page's heading.
    private var header: some View {
        HStack(spacing: 6) {
            BackButton(title: backTitle, action: onBack)
            Spacer()
            GlassGroup(spacing: 6) {
                HStack(spacing: 6) {
                    if let scores, ref.isSupported {
                        let following = scores.isFollowing(competitor)
                        IconButton(symbol: following ? "star.fill" : "star",
                                   label: following ? "Unfollow \(shortName)" : "Follow \(shortName)", active: following) {
                            scores.toggleFollow(competitor)
                        }
                    }
                    if let link = state.header?.link {
                        IconButton(symbol: "safari", label: "Open in Browser") { NSWorkspace.shared.open(link) }
                    }
                }
            }
        }
        .pageHeader()
    }

    private var competitor: Competitor {
        Competitor(id: ref.id, name: shortName, abbreviation: state.header?.abbreviation ?? ref.abbreviation ?? "",
                   score: nil, logo: state.header?.logo ?? ref.logo, isWinner: false, color: state.header?.color ?? ref.color)
    }

    private var shortName: String { state.header?.shortName ?? ref.name }

    // MARK: Hero

    private var colors: (Color, Color)? {
        _ = colorsVersion
        return ProfileColors.team(ref, header: state.header, scheme: scheme)
    }
    private var tint: Color { colors?.0 ?? .accentColor }

    /// The match page's wash, at the match page's strength.
    private var wash: some View {
        let c = colors
        return HeroWash(left: c?.0 ?? .accentColor, right: c?.1 ?? .accentColor, intensity: c == nil ? 0.6 : 1)
    }

    private var hero: some View {
        let h = state.header
        var crestRef = ref
        crestRef.logo = h?.logo ?? ref.logo
        // Without a logo the crest shows the team's code, never three letters of its name.
        crestRef.abbreviation = h?.abbreviation ?? ref.abbreviation
        return HStack(spacing: 14) {
            TeamCrest(team: crestRef, size: 46)
                .background(HeroGlow(color: tint, diameter: 60))
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    Text(h?.name ?? ref.name)
                        .font(.system(size: 17, weight: .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    if scores?.isFollowing(competitor) == true {
                        Image(systemName: "star.fill").font(.system(size: 8)).foregroundStyle(.yellow)
                            .accessibilityLabel("Following")
                    }
                }
                if let line = summaryLine {
                    line.font(.system(size: 12).monospacedDigit()).foregroundStyle(.secondary).lineLimit(1)
                        .accessibilityLabel(summaryAccessibility.map { Text($0) } ?? line)
                } else if h == nil, !state.loaded {
                    // Loading; a failed load says so below instead.
                    RoundedRectangle(cornerRadius: 3).fill(Color.primary.opacity(0.08)).frame(width: 130, height: 9).padding(.vertical, 3)
                }
                if let coach = coachLine {
                    Text(coach).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(cornerRadius: Metrics.heroRadius, clear: true)
        .padding(.horizontal, 10)
        .padding(.top, 6)
        .padding(.bottom, 4)
        .pageHero()
    }

    /// "3–0 · 1st in Pacific Division"; CS2 "World #3 · ▲ 2", the arrow green or red as in the standings.
    private var summaryLine: Text? {
        guard let h = state.header else { return nil }
        if let rank = h.rank {
            var line = Text("World #\(rank)")
            if let change = h.rankChange, change != 0 {
                let arrow = Text(Image(systemName: change > 0 ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill"))
                    .font(.system(size: 7)).foregroundStyle(change > 0 ? Color.green : Color.red)
                line = line + Text(" · ") + arrow + Text(" \(abs(change))")
            }
            return line
        }
        let record = h.record.map(RowText.record)
        return [record, h.standing].compactMap { $0 }.joined(separator: " · ").nilIfEmpty.map { Text($0) }
    }

    private var summaryAccessibility: String? {
        guard let h = state.header, let rank = h.rank else { return nil }
        guard let change = h.rankChange, change != 0 else { return "World number \(rank)" }
        return "World number \(rank), \(change > 0 ? "up" : "down") \(abs(change))"
    }

    private var coachLine: String? {
        guard let coach = state.header?.coach else { return nil }
        return (ref.sport == .baseball ? "Manager " : "Coach ") + coach
    }

    // MARK: Live

    private var liveEvent: Event? {
        scores?.sections.lazy.flatMap(\.events).first { $0.state == .live && $0.competitors.contains { $0.id == ref.id } }
    }

    private func liveStrip(_ event: Event) -> some View {
        LiveStrip(event: event) { navigator?.open(event) }
    }

    // MARK: Sections

    /// What a fan wants first: the next game, then the people.
    private var order: [Section] {
        ref.sport == .esports ? [.next, .results, .roster, .career, .titles]
            : [.next, .results, .roster, .leaders, .stats, .standings, .injuries, .transactions]
    }

    private var shown: [Section] { order.filter(has) }

    private func has(_ s: Section) -> Bool {
        switch s {
        case .next: state.next != nil
        case .results: season?.results.contains { $0.status == .final } == true
        case .roster: !state.groups.isEmpty || !state.loaded
        case .leaders: state.leaders.count >= 2
        case .stats: !state.stats.isEmpty
        case .standings: !standingsWindow.isEmpty
        case .injuries: !injured.isEmpty
        case .transactions: !state.transactions.isEmpty
        case .titles: !state.titles.isEmpty
        case .career: !state.career.isEmpty
        }
    }

    /// From 680pt: the long roster (and injuries) on the right, the short
    /// sections stacked on the left. A football roster (NFL, college: 50 to
    /// 120 players) would run thousands of points down one column, so it
    /// spans both instead, its groups two-up, below the short sections.
    private func slot(_ s: Section, rank: Int) -> MatchSlot {
        guard layout.split else { return MatchSlot() }
        if s == .roster, rosterSpans { return MatchSlot(column: .span, rank: rank) }
        let right: Set<Section> = rosterSpans ? [.injuries, .transactions] : [.roster, .injuries]
        return MatchSlot(column: right.contains(s) ? .right : .left, rank: rank)
    }

    /// The roster spans the split panel (football's are the long ones).
    private var rosterSpans: Bool { layout.split && ref.sport == .football }

    @ViewBuilder
    private var content: some View {
        // A spanning roster closes the two columns, so it comes last.
        let sections = rosterSpans ? shown.filter { $0 != .roster } + shown.filter { $0 == .roster } : shown
        ForEach(Array(sections.enumerated()), id: \.element) { index, s in
            let slot = slot(s, rank: index)
            section(s)
                .environment(\.widthClass, layout.split && slot.column != .span ? layout.column : layout.page)
                .matchSlot(slot.column, rank: slot.rank)
        }
    }

    @ViewBuilder
    private func section(_ s: Section) -> some View {
        switch s {
        case .next:
            if let game = state.next {
                DetailSection(title: game.state == .final ? "Last Game" : game.state == .live ? "Now" : "Next",
                              accessory: game.state == .live ? .live : nil) {
                    NextGameRow(game: game, team: teamForEvents, path: espnPath)
                }
            }
        case .results:
            if let season {
                TeamResultsSection(season: season, sport: ref.sport, details: ResultsStore.shared.showsDetails,
                                   onOpen: { item in navigator?.open(scores?.current(item.event()) ?? item.event()) },
                                   onOpenAll: { onOpenSchedule(.team(scheduleRef), .results) })
            }
        case .roster:
            DetailSection(title: ref.sport == .soccer ? "Squad" : ref.sport == .esports ? "Players" : "Roster",
                          caption: rosterCaption) {
                if state.groups.isEmpty {
                    RosterSkeleton()
                } else {
                    RosterSection(groups: state.groups, sport: ref.sport ?? .football, depthChart: state.depthChart,
                                  tint: tint, sessionKey: ref.memoryKey, store: store, columns: rosterSpans ? 2 : 1)
                }
            }
        case .leaders:
            DetailSection(title: "Leaders", caption: leadersCaption) {
                LeadersGrid(leaders: state.leaders, tint: tint)
            }
        case .stats:
            DetailSection(title: "Team Stats", caption: "Where they rank in the league this season.") {
                StackColumn(spacing: 2) {
                    ForEach(statsShown) { stat in RankTrack(stat: stat, field: field, tint: tint) }
                }
            }
        case .standings:
            DetailSection(title: ref.sport == .soccer ? "Table" : ref.id.hasPrefix("espn-ncaaf-") ? "Conference" : "Standings",
                          caption: "Official table from ESPN. New results can take a few minutes.") {
                standingsTable
            }
        case .injuries:
            DetailSection(title: "Injury Report", caption: "Game-week statuses from ESPN.") {
                InjuryRows(players: injured)
            }
        case .transactions:
            DetailSection(title: "Transactions", caption: "Signings, trades and releases from ESPN.") {
                TransactionRows(transactions: state.transactions, sessionKey: ref.memoryKey, store: store)
            }
        case .titles:
            DetailSection(title: "Titles", caption: "\(plural(state.titles.count, "tournament win")) on record.") {
                TitleRows(titles: state.titles)
            }
        case .career:
            DetailSection(title: "Record", caption: "Every match bo3.gg has tracked.") {
                StatTiles(tiles: state.career)
            }
        }
    }

    private var rosterCaption: String? {
        switch ref.sport {
        case .basketball: "Per-game averages this season."
        case .football: "Season totals. Starters first at each position."
        case .baseball: "Regular-season stats."
        case .soccer: "League appearances, goals and assists."
        case .esports: "Each player's bo3.gg rating over six months."
        default: nil
        }
    }

    private var leadersCaption: String? {
        switch ref.sport {
        case .basketball: "Per game."
        case .baseball: "Regular season."
        default: "This season."
        }
    }

    private var statsShown: [Profile.TeamStat] {
        let ranked = state.stats.filter { $0.rank != nil }
        return Array(ranked.prefix((layout.split ? layout.column : layout.page) >= .large ? 8 : 6))
    }

    private var field: Int { ref.sport == .football ? 32 : 30 }

    private var injured: [Profile.RosterPlayer] {
        guard ref.sport == .football || ref.sport == .basketball else { return [] }
        let statuses: Set<String> = ["Out", "Questionable", "Doubtful", "Day-To-Day"]
        // NBA's Out group already lists who's out; football's IR group its long-term injuries.
        return state.groups.filter { ![.out, .injuredReserve, .practiceSquad].contains($0.kind) }
            .flatMap(\.players).filter { statuses.contains($0.injury ?? "") }
    }

    /// The team as the scores list knows it, for building match pages.
    private var teamForEvents: Profile.TeamRef {
        var r = ref
        r.name = shortName
        r.logo = state.header?.logo ?? ref.logo
        r.abbreviation = state.header?.abbreviation ?? ref.abbreviation
        return r
    }

    private var espnPath: String? {
        if case let .espn(_, path, _)? = ref.source { return path ?? state.header?.leagueSlug.flatMap(Profile.TeamRef.domesticSoccerPath) }
        return nil
    }

    // MARK: Results

    /// This team as a schedule knows it.
    private var scheduleRef: ScheduleTeamRef {
        ScheduleTeamRef(id: ref.id, name: shortName, logo: state.header?.logo ?? ref.logo, league: ref.league)
    }

    private func loadResults() async {
        guard let scores else { return }
        season = await ResultsStore.shared.season(scheduleRef, store: scores)
    }

    // MARK: Standings

    private var standingsLeague: League? {
        switch ref.sport {
        case .soccer:
            let id = Profile.TeamRef.domesticSoccerLeagues.contains(ref.league ?? "") ? ref.league : state.header?.leagueSlug
            return id.flatMap(League.with(id:))
        case .basketball: return League.with(id: "nba")
        case .football where ref.id.hasPrefix("espn-ncaaf-"): return League.with(id: "college-football")
        default: return nil
        }
    }

    private func loadStandings() async {
        guard let scores else { return }
        if standingsLeague == nil, ref.sport == .soccer {
            // The league comes with the header.
            for _ in 0..<20 where state.header == nil { try? await Task.sleep(for: .milliseconds(150)) }
        }
        guard let league = standingsLeague else { return }
        standings = await scores.standings(for: league)
    }

    private var standingsWindow: [StandingsRow] {
        guard let i = standings.firstIndex(where: { $0.id == ref.id }) else { return [] }
        let group = standings[i].group
        let peers = standings.filter { $0.group == group }
        guard let j = peers.firstIndex(where: { $0.id == ref.id }) else { return [] }
        let lo = max(0, min(j - 3, peers.count - 7)), hi = min(peers.count, lo + 7)
        return Array(peers[lo..<hi])
    }

    /// Neighbours' rows open their pages (with the table patches merged); this team's own row does nothing.
    private var standingsTable: some View {
        Group {
            let ids: Set<String> = [ref.id]
            switch ref.sport {
            case .basketball:
                NBAStandingsTable(rows: NBAStandings.window(NBAStandings.project(standings, liveEvents: []), around: ids, reach: 3),
                                  highlight: ids)
            case .football:
                ConferenceTable(rows: standingsWindow, highlight: ids)
            default:
                StandingsTable(rows: Standings.live(standingsWindow, liveEvents: []), highlight: ids)
            }
        }
        .environment(\.profileLeague, ref.league)
    }

    // MARK: Footer

    @ViewBuilder
    private var footer: some View {
        if let failures = failureNote {
            ProfileFootnote(text: failures) { reload() }
        }
        if let venue = state.header?.venue {
            Text([venue, state.header?.city].compactMap { $0 }.joined(separator: " · "))
                .font(Viz.note)
                .foregroundStyle(.secondary)
                .padding(.horizontal, Metrics.gutter)
                .padding(.top, 16)
        }
        if state.loaded, state.header == nil, state.groups.isEmpty {
            // Profiles load once per visit: nothing retries on its own, so say so.
            ErrorState("Team", retry: reload)
        }
    }

    private func reload() {
        Task { await store.load(ref, force: true) }
    }

    /// "Couldn't load the roster, leaders or team stats."
    private var failureNote: String? {
        guard state.header != nil else { return nil }
        let parts = [state.failed.contains(.roster) ? "the roster" : nil, state.failed.contains(.leaders) ? "leaders" : nil,
                     state.failed.contains(.stats) ? "team stats" : nil].compactMap { $0 }
        return parts.isEmpty ? nil : "Couldn't load \(parts.formatted(.list(type: .or)))."
    }
}
