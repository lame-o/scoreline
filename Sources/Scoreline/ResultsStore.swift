import Foundation
import Observation

/// Results for every agenda scope: rounds (a matchweek, a football week, a
/// day), the selected round's games, a team's season and Your Teams' recent
/// results. It composes `ScheduleStore` (boards, calendars, team schedules)
/// and its `ScheduleCache`, so one fetch serves Upcoming and Results; it never
/// owns HTTP and nothing here polls or prefetches. Each scope has its own
/// observable box, so a round landing re-renders only the page reading that
/// scope. See specs/results.md §3.2, §7, §8.3.
@MainActor
@Observable
final class ResultsStore {
    static let shared = ResultsStore()

    struct PageState: Equatable {
        /// Oldest first; the picker's menu lists them newest first.
        var rounds: [ResultRound] = []
        var selected: ResultRound.ID?
        /// The selected round's games in kickoff order (unfiltered: `groups`
        /// applies the scores list's filters), or a list scope's page, newest first.
        var items: [ScheduleItem] = []
        /// Team scope.
        var season: TeamSeason?
        var loading = false
        var failed = false
        var stale = false
        /// When the data shown was fetched.
        var updated: Date?
        /// List scopes: older rows exist.
        var more = false
        var limit = 20
        var revision = 0
        /// "10 results · 19 goals", "8 of 10 played · next: Mon 12:00 PM", "All 3 games postponed".
        var summary: String?
        /// NFL/college: the selected week's byes ("Bills").
        var byes: [String] = []
        /// Team scope: the season shown (ESPN's `season=`), nil for the current one.
        var seasonYear: Int?

        var round: ResultRound? { selected.flatMap { id in rounds.last { $0.id == id } } }
    }

    /// One observable box per scope (the `AgendaBox` pattern).
    @MainActor @Observable final class Box {
        var state: PageState?
    }

    /// What results read from the scores list: its leagues and their order,
    /// its filters and followed teams. Pages pass the `ScoreStore`; tests and
    /// the harness build one directly.
    struct Context {
        var leagues: [League]
        /// League ID → picked teams, for leagues whose filter is on.
        var picks: [String: Set<String>] = [:]
        var collegeTop25Only = true
        var followed: [ScheduleTeamRef] = []
        /// The scores list's store, for CS2 and climbing in the All scope.
        weak var store: ScoreStore?

        @MainActor static func of(_ store: ScoreStore) -> Context {
            let leagues = store.enabledLeagues
            var picks: [String: Set<String>] = [:]
            for league in leagues where store.isFilterOn(league) {
                let set = store.picks(for: league)
                if !set.isEmpty { picks[league.id] = set }
            }
            return Context(leagues: leagues, picks: picks, collegeTop25Only: store.collegeTop25Only,
                           followed: store.followed.map { ScheduleTeamRef(id: $0.id, name: $0.name, logo: $0.logo) }, store: store)
        }

        struct Key: Equatable {
            let order: [String]
            let picks: [String: Set<String>]
            let top25: Bool
            let followed: [String]
        }

        var key: Key { Key(order: leagues.map(\.id), picks: picks, top25: collegeTop25Only, followed: followed.map(\.id)) }

        /// The scores list's filters (`ScheduleStore.filter`): picked teams,
        /// then college's Top 25 (and your teams).
        func filter(_ items: [ScheduleItem], league: League?, showAll: Bool) -> [ScheduleItem] {
            guard let league, league.source != .ifsc, !showAll else { return items }
            if let picks = picks[league.id], !picks.isEmpty {
                return items.filter { item in item.isField || item.teams.contains { $0.id.map(picks.contains) ?? false } }
            }
            if league.id == "college-football", collegeTop25Only {
                let mine = Set(followed.map(\.id))
                return items.filter { item in item.teams.contains { $0.rank != nil || $0.id.map(mine.contains) ?? false } }
            }
            return items
        }
    }

    let schedule: ScheduleStore
    var cache: ScheduleCache { schedule.cache }
    /// The clock (tests inject one).
    @ObservationIgnored var clock: () -> Date = { .now }

    init(schedule: ScheduleStore? = nil) {
        self.schedule = schedule ?? .shared
        detailsFlag = UserDefaults.standard.object(forKey: Self.detailsKey) as? Bool ?? true
    }

    // MARK: Preferences

    static let detailsKey = "resultsDetails"
    private var detailsFlag: Bool
    private var friendlies: Set<String> = []

    /// Show Details (⋯ menu): scorers, decisions and performers under rows.
    var showsDetails: Bool {
        get { detailsFlag }
        set {
            detailsFlag = newValue
            UserDefaults.standard.set(newValue, forKey: Self.detailsKey)
        }
    }

    /// Team IDs whose results include friendlies (this session).
    var includeFriendlies: Set<String> {
        get { friendlies }
        set {
            let changed = friendlies.symmetricDifference(newValue)
            friendlies = newValue
            for scope in boxes.keys {
                switch scope {
                case let .team(team) where changed.contains(team.id): republishTeam(scope, team: team)
                case .yourTeams: republishYourTeams()
                default: break
                }
            }
        }
    }

    // MARK: Boxes

    @ObservationIgnored private var boxes: [ScheduleScope: Box] = [:]
    @ObservationIgnored private var generation: [ScheduleScope: Int] = [:]
    @ObservationIgnored private var built: [ScheduleScope: (key: GroupsKey, value: [AgendaDay])] = [:]
    /// How many times `groups` built (tests: memoization).
    @ObservationIgnored private(set) var groupBuilds = 0

    private func box(_ scope: ScheduleScope) -> Box {
        if let box = boxes[scope] { return box }
        let box = Box()
        boxes[scope] = box
        return box
    }

    func state(_ scope: ScheduleScope) -> PageState? { box(scope).state }

    /// Writes a page's state when it changed (an unchanged write re-renders nothing).
    private func publish(_ scope: ScheduleScope, _ change: (inout PageState) -> Void) {
        let b = box(scope)
        var next = b.state ?? PageState()
        change(&next)
        next.revision = b.state?.revision ?? 0
        guard next != b.state else { return }
        next.revision += 1
        b.state = next
    }

    private func begin(_ scope: ScheduleScope) -> Int {
        generation[scope, default: 0] += 1
        return generation[scope] ?? 0
    }

    private var todayEastern: DayKey { DayKey.of(clock(), in: DayKey.eastern) }

    // MARK: Public API (§8.3)

    /// Rounds and the latest round (or, coming back, the round shown).
    func open(_ scope: ScheduleScope, store: ScoreStore, force: Bool = false) async {
        await open(scope, context: .of(store), force: force)
    }

    func select(_ round: ResultRound.ID, in scope: ScheduleScope, store: ScoreStore) async {
        await show(scope, context: .of(store), target: .round(round), force: false)
    }

    /// -1: the round before (older); +1 the one after.
    func step(_ delta: Int, in scope: ScheduleScope, store: ScoreStore) async {
        await show(scope, context: .of(store), target: .step(delta), force: false)
    }

    /// ⌘T: the newest round with a result.
    func showLatest(_ scope: ScheduleScope, store: ScoreStore) async {
        await show(scope, context: .of(store), target: .latest, force: false)
    }

    /// List scopes: 20 more rows (a CS2 team loads its next page).
    func showMore(_ scope: ScheduleScope) async {
        guard let current = state(scope) else { return }
        publish(scope) { $0.limit = current.limit + CSHistory.pageSize }
        switch scope {
        case let .team(team):
            if team.id.hasPrefix("cs-"), let id = Int(team.id.dropFirst(3)), var data = teamData[teamKey(team, nil)],
               !data.exhausted, data.items.count < current.limit + CSHistory.pageSize {
                let url = CSHistory.url(teamIDs: [id], page: data.pages)
                if let page = try? await cache.get(url, ttl: Self.finalTTL, parse: { CSHistory.parse($0) }) {
                    var seen = Set(data.items.map(\.id))
                    data.items += page.value.filter { seen.insert($0.id).inserted }
                    data.pages += 1
                    data.exhausted = page.value.count < CSHistory.pageSize
                    teamData[teamKey(team, nil)] = data
                }
            }
            republishTeam(scope, team: team)
        case .yourTeams:
            republishYourTeams()
        default:
            break
        }
    }

    /// Day sections for the page, built once per change (pages read this on
    /// every redraw). Rounds read Friday → Monday, finals first within a day;
    /// lists read newest first.
    func groups(_ scope: ScheduleScope, store: ScoreStore) -> [AgendaDay] {
        groups(scope, context: .of(store))
    }

    /// The hub's latest round of a league, filtered as the scores list is.
    func latest(_ league: League, store: ScoreStore) async -> (round: ResultRound, items: [ScheduleItem])? {
        await latest(league, context: .of(store))
    }

    /// A team's season: this one (`year` nil) or a past one (ESPN's `season=`).
    func season(_ team: ScheduleTeamRef, year: Int? = nil, store: ScoreStore) async -> TeamSeason? {
        await season(team, year: year)
    }

    /// Team scope: show another season (the ⋯ Season menu; nil is the current one).
    func selectSeason(_ year: Int?, in scope: ScheduleScope, store: ScoreStore) async {
        guard case .team = scope else { return }
        publish(scope) {
            $0.seasonYear = year
            $0.limit = CSHistory.pageSize
        }
        await open(scope, context: .of(store))
    }

    // MARK: Context-driven (pages go through the API above)

    func open(_ scope: ScheduleScope, context: Context, force: Bool = false) async {
        let keep = state(scope)?.selected != nil
        await show(scope, context: context, target: keep ? .keep : .latest, force: force)
    }

    enum Target: Equatable { case keep, latest, round(String), step(Int) }

    func show(_ scope: ScheduleScope, context: Context, target: Target, force: Bool) async {
        switch scope {
        case let .league(id):
            guard let league = League.with(id: id) else { return }
            await showLeague(league, scope: scope, target: target, force: force)
        case .all:
            await showAll(scope, context: context, target: target, force: force)
        case let .team(team):
            await showTeam(team, scope: scope, force: force)
        case .yourTeams:
            await showYourTeams(context: context, force: force)
        case .climbing, .tournaments:
            break
        }
    }

    func groups(_ scope: ScheduleScope, context: Context) -> [AgendaDay] {
        guard let state = state(scope) else { return [] }
        let key = GroupsKey(revision: state.revision, filters: context.key, showAll: schedule.showAllGames.contains(scope))
        if let hit = built[scope], hit.key == key { return hit.value }
        let value = buildGroups(scope, state: state, context: context, showAll: key.showAll)
        built[scope] = (key, value)
        groupBuilds += 1
        return value
    }

    struct GroupsKey: Equatable {
        let revision: Int
        let filters: Context.Key
        let showAll: Bool
    }

    private func buildGroups(_ scope: ScheduleScope, state: PageState, context: Context, showAll: Bool) -> [AgendaDay] {
        switch scope {
        case .team, .yourTeams:
            return Agenda.build(state.items, leagueOrder: [], grouped: false).reversed().map { day in
                var day = day
                day.groups = day.groups.map { g in AgendaGroup(league: g.league, title: g.title, symbol: g.symbol, items: g.items.reversed()) }
                return day
            }
        default:
            let scoped = scope.league
            let byLeague = Dictionary(grouping: state.items) { $0.league }
            let filtered = byLeague.flatMap { id, items in context.filter(items, league: scoped ?? League.with(id: id), showAll: showAll) }
            var days = Agenda.build(filtered, leagueOrder: context.leagues.map(\.id), grouped: scope == .all)
            // Finals first within a day, then what's still to play, by time.
            for d in days.indices {
                days[d].groups = days[d].groups.map { g in
                    AgendaGroup(league: g.league, title: g.title, symbol: g.symbol,
                                items: g.items.filter { $0.status != .scheduled } + g.items.filter { $0.status == .scheduled })
                }
            }
            if let last = days.indices.last, !state.byes.isEmpty { days[last].byes = state.byes }
            return days
        }
    }

    // MARK: Leagues

    static let finalTTL = ScheduleStore.finalTTL

    private struct LeagueData {
        struct Loaded {
            var items: [ScheduleItem]
            var byes: [String]
            var fetchedAt: Date
            var stale: Bool
        }
        var calendar: ScheduleCalendar?
        /// Window key ("m:2026-10", "w:2-7", "d:2026-10-25") → its board.
        var windows: [String: Loaded] = [:]
    }

    @ObservationIgnored private var leagueData: [String: LeagueData] = [:] {
        didSet { dataRevision += 1 }
    }
    @ObservationIgnored private var dataRevision = 0
    /// `layout` once per change of what's loaded (it formats dates).
    @ObservationIgnored private var layouts: [String: (key: String, rounds: [ResultRound], members: [String: [ScheduleItem]])] = [:]
    /// Day rounds, titled once ("Sunday, Oct 25").
    @ObservationIgnored private var dayRounds: [DayKey: ResultRound] = [:]

    private func dayRound(_ day: DayKey) -> ResultRound {
        if let round = dayRounds[day] { return round }
        let round = Rounds.day(day)
        dayRounds[day] = round
        return round
    }

    nonisolated static func key(_ window: ScheduleProvider.ESPN.Window) -> String {
        switch window {
        case let .day(day): "d:\(day)"
        case let .month(year, month): String(format: "m:%04d-%02d", year, month)
        case let .week(n, type): "w:\(type)-\(n)"
        case .undated: "u"
        }
    }

    /// Soccer leagues whose calendar has no game days (cups list stages): their
    /// rounds come from the months loaded, so stepping back loads another month.
    private func growsBack(_ league: League) -> Bool {
        league.sport == .soccer && (leagueData[league.id]?.calendar?.days.isEmpty ?? true)
    }

    /// Rounds from the calendar and whatever is loaded, with each round's games.
    private func layout(_ league: League) -> (rounds: [ResultRound], members: [String: [ScheduleItem]]) {
        let today = todayEastern
        let key = "\(dataRevision)|\(today)|\(Int(clock().timeIntervalSince1970 / 3600))"
        if let hit = layouts[league.id], hit.key == key { return (hit.rounds, hit.members) }
        let value = buildLayout(league, today: today)
        layouts[league.id] = (key, value.rounds, value.members)
        return value
    }

    private func buildLayout(_ league: League, today: DayKey) -> (rounds: [ResultRound], members: [String: [ScheduleItem]]) {
        guard case let .espn(_, weekly) = league.source else { return ([], [:]) }
        let data = leagueData[league.id] ?? LeagueData()
        if league.sport == .soccer {
            var seen = Set<String>()
            let items = data.windows.keys.sorted().flatMap { data.windows[$0]?.items ?? [] }.filter { seen.insert($0.id).inserted }
            let layout = Rounds.layout(days: data.calendar?.days ?? [], items: items, calendar: data.calendar, league: league, today: today)
            return (layout.rounds, layout.members)
        }
        var rounds = weekly ? Rounds.weeks(data.calendar, now: clock())
            : Rounds.gameDays(data.calendar, through: today).map(dayRound)
        var members: [String: [ScheduleItem]] = [:]
        for i in rounds.indices {
            guard let window = windows(for: rounds[i]).first, let loaded = data.windows[Self.key(window.0)] else { continue }
            let games = Agenda.sorted(loaded.items)
            members[rounds[i].id] = games
            rounds[i].played = games.filter { $0.status == .final }.count
            rounds[i].total = games.count
        }
        return (rounds, members)
    }

    /// The boards a round needs, each with the freshness it deserves.
    private func windows(for round: ResultRound) -> [(ScheduleProvider.ESPN.Window, TimeInterval?)] {
        let over = round.last < todayEastern.adding(days: -2)
        switch round.kind {
        case .week: return [(.week(round.week ?? 0, seasonType: round.seasonType ?? 2), over ? Self.finalTTL : nil)]
        case .day: return [(.day(round.first), nil)]
        default: return ScheduleProvider.ESPN.months(from: round.first, to: round.last).map { ($0, nil) }
        }
    }

    private func isLoaded(_ round: ResultRound, _ league: League) -> Bool {
        let windows = leagueData[league.id]?.windows ?? [:]
        return self.windows(for: round).allSatisfy { windows[Self.key($0.0)] != nil }
    }

    /// Loads a round's boards (through the cache: a fresh entry costs nothing).
    @discardableResult
    private func load(_ round: ResultRound, league: League, force: Bool) async -> Bool {
        await load(windows(for: round), league: league, force: force)
    }

    private func load(_ windows: [(ScheduleProvider.ESPN.Window, TimeInterval?)], league: League, force: Bool) async -> Bool {
        guard case let .espn(path, _) = league.source else { return false }
        let schedule = self.schedule
        let fetched = await withTaskGroup(of: (String, ScheduleCache.Fetched<ScheduleStore.Board>?).self) { group in
            for (window, floor) in windows {
                group.addTask {
                    (Self.key(window), await schedule.board(path: path, league: league.id, sport: league.sport, window: window,
                                                            force: force, minimumTTL: floor))
                }
            }
            var out: [(String, ScheduleCache.Fetched<ScheduleStore.Board>?)] = []
            for await result in group { out.append(result) }
            return out
        }
        var data = leagueData[league.id] ?? LeagueData()
        var changed = false
        for (key, board) in fetched {
            // A cache hit hands back the same entry: nothing to rebuild.
            guard let board, data.windows[key]?.fetchedAt != board.fetchedAt || data.windows[key]?.stale != board.stale else { continue }
            data.windows[key] = .init(items: board.value.items, byes: board.value.byes, fetchedAt: board.fetchedAt, stale: board.stale)
            changed = true
        }
        if changed { leagueData[league.id] = data }
        return fetched.allSatisfy { $0.1 != nil }
    }

    private func ensureCalendar(_ league: League, force: Bool) async {
        guard case let .espn(path, _) = league.source, leagueData[league.id]?.calendar == nil || force else { return }
        if let calendar = await schedule.calendar(path: path) { leagueData[league.id, default: LeagueData()].calendar = calendar }
    }

    /// Cups: one more month of the past (the newest month first). False when
    /// there's nothing earlier to load (before the season, a year back).
    private func growBack(_ league: League, force: Bool) async -> Bool {
        let data = leagueData[league.id] ?? LeagueData()
        let loaded = data.windows.keys.filter { $0.hasPrefix("m:") }.sorted()
        let today = todayEastern
        var target: (year: Int, month: Int)
        if let first = loaded.first {
            let parts = first.dropFirst(2).split(separator: "-").compactMap { Int($0) }
            guard parts.count == 2 else { return false }
            target = parts[1] == 1 ? (parts[0] - 1, 12) : (parts[0], parts[1] - 1)
        } else {
            // The newest month that can hold a result: today's, or the season's last.
            let end = data.calendar?.weeks.map { DayKey.of($0.end, in: DayKey.eastern) }.max().map { min($0, today) } ?? today
            target = (end.year, end.month)
        }
        let start = data.calendar?.weeks.map { DayKey.of($0.start, in: DayKey.eastern) }.min()
        let floor: (y: Int, m: Int) = start.map { ($0.year, $0.month) } ?? (today.year - 1, today.month)
        guard (target.year, target.month) >= (floor.y, floor.m), (target.year, target.month) >= (today.year - 1, today.month) else { return false }
        return await load([(.month(year: target.year, month: target.month), nil)], league: league, force: force)
    }

    /// The newest round with a result, loading as little as it can to know.
    private func latestRound(_ league: League, force: Bool) async -> (ResultRound?, Bool) {
        var visited = Set<String>()
        var ok = true
        for _ in 0..<8 {
            let (rounds, members) = layout(league)
            let candidate = Rounds.latest(rounds) { r in
                isLoaded(r, league) ? (members[r.id] ?? []).contains { $0.status == .final } : nil
            }
            guard let candidate else {
                if growsBack(league), await growBack(league, force: force) { continue }
                return (nil, ok)
            }
            if !visited.contains(candidate.id) {
                visited.insert(candidate.id)
                ok = await load(candidate, league: league, force: force) && ok
                continue
            }
            if (members[candidate.id] ?? []).contains(where: { $0.status == .final }) { return (candidate, ok) }
            // Nothing finished anywhere loaded: a cup looks a month further back.
            if growsBack(league), await growBack(league, force: force) { continue }
            return (candidate, ok)
        }
        return (layout(league).rounds.last, ok)
    }

    private func showLeague(_ league: League, scope: ScheduleScope, target: Target, force: Bool) async {
        let token = begin(scope)
        // What's in memory paints at once: a cached round steps instantly.
        let current = state(scope)?.selected
        var (rounds, members) = layout(league)
        func requested(_ rounds: [ResultRound]) -> ResultRound? {
            switch target {
            case let .round(id): return rounds.first { $0.id == id }
            case .keep: return current.flatMap { id in rounds.first { $0.id == id } }
            case let .step(delta):
                guard let current, let i = rounds.firstIndex(where: { $0.id == current }), rounds.indices.contains(i + delta)
                else { return nil }
                return rounds[i + delta]
            case .latest: return nil
            }
        }
        var round = requested(rounds)
        if let round, isLoaded(round, league) {
            finish(scope, league: league, round: round, ok: true, rounds: rounds, members: members)
        } else {
            publish(scope) { s in
                s.loading = true
                if let round {
                    s.rounds = rounds
                    s.selected = round.id
                    s.items = []
                    s.summary = nil
                    s.byes = []
                }
            }
        }

        await ensureCalendar(league, force: force)
        var ok = true
        if round == nil, case let .step(delta) = target, delta < 0, growsBack(league), current != nil {
            // Older than the oldest round loaded (a cup): load a month further back.
            _ = await growBack(league, force: force)
            round = requested(layout(league).rounds)
        }
        if round == nil, case .round = target { round = requested(layout(league).rounds) }
        if round == nil, case .keep = target { round = requested(layout(league).rounds) }
        if let round {
            ok = await load(round, league: league, force: force)
        } else if case .step = target {
            round = current.flatMap { id in layout(league).rounds.first { $0.id == id } }
        } else {
            (round, ok) = await latestRound(league, force: force)
        }
        guard generation[scope] == token else { return }
        (rounds, members) = layout(league)
        finish(scope, league: league, round: round, ok: ok, rounds: rounds, members: members)
    }

    private func finish(_ scope: ScheduleScope, league: League, round: ResultRound?, ok: Bool,
                        rounds: [ResultRound], members: [String: [ScheduleItem]]) {
        // A round's ID can change once its month loads and it splits (a holiday run).
        let resolved = round.flatMap { r in rounds.first { $0.id == r.id } ?? rounds.first { $0.first <= r.first && r.first <= $0.last } }
        let items = resolved.flatMap { members[$0.id] } ?? []
        let data = leagueData[league.id]
        let boards = resolved.map { windows(for: $0).compactMap { data?.windows[Self.key($0.0)] } } ?? []
        let loaded = resolved.map { isLoaded($0, league) } ?? false
        publish(scope) { s in
            s.rounds = rounds
            s.selected = resolved?.id
            s.items = items
            s.loading = false
            s.failed = !ok && !loaded
            s.stale = !ok || boards.contains { $0.stale }
            s.updated = boards.map(\.fetchedAt).min() ?? s.updated
            s.summary = Rounds.summary(items, sport: league.sport, now: clock())
            s.byes = resolved?.kind == .week ? boards.first?.byes ?? [] : []
        }
    }

    func latest(_ league: League, context: Context) async -> (round: ResultRound, items: [ScheduleItem])? {
        guard case .espn = league.source else { return nil }
        await ensureCalendar(league, force: false)
        let (found, _) = await latestRound(league, force: false)
        guard let found else { return nil }
        let (rounds, members) = layout(league)
        let round = rounds.first { $0.id == found.id } ?? found
        return (round, context.filter(members[round.id] ?? [], league: league, showAll: false))
    }

    // MARK: All (a day of every enabled league)

    /// How far back the All scope's days reach (grows as you step back).
    @ObservationIgnored private var allBack = 60
    /// Day → league ID → that league's games on the day.
    @ObservationIgnored private var allDays: [DayKey: [String: [ScheduleItem]]] = [:]
    @ObservationIgnored private var allFetched: [DayKey: (at: Date, ok: Bool)] = [:]

    private func allRounds() -> [ResultRound] {
        let today = DayKey.of(clock())
        return (0...allBack).map { today.adding(days: -$0) }.reversed().map(dayRound)
    }

    private func allItems(_ day: DayKey, context: Context) -> [ScheduleItem]? {
        guard let byLeague = allDays[day] else { return nil }
        return Agenda.sorted(context.leagues.flatMap { byLeague[$0.id] ?? [] })
    }

    private func loadDay(_ day: DayKey, context: Context, force: Bool) async -> Bool {
        guard let store = context.store else { return false }
        let schedule = self.schedule
        let fetched = await withTaskGroup(of: (String, ScheduleStore.LeagueFetch).self) { group in
            for league in context.leagues {
                group.addTask { (league.id, await schedule.fetch(league, from: day, to: day, store: store, force: force)) }
            }
            var out: [String: ScheduleStore.LeagueFetch] = [:]
            for await (id, fetch) in group { out[id] = fetch }
            return out
        }
        var byLeague = allDays[day] ?? [:]
        for (id, fetch) in fetched where fetch.ok { byLeague[id] = fetch.items.filter { $0.day == day } }
        allDays[day] = byLeague
        let ok = fetched.values.contains { $0.ok }
        allFetched[day] = (fetched.values.compactMap(\.fetchedAt).min() ?? clock(), ok)
        return ok
    }

    private func showAll(_ scope: ScheduleScope, context: Context, target: Target, force: Bool) async {
        let token = begin(scope)
        let current = state(scope)?.selected
        var rounds = allRounds()
        var round: ResultRound?
        switch target {
        case let .round(id): round = rounds.first { $0.id == id }
        case .keep: round = current.flatMap { id in rounds.first { $0.id == id } }
        case let .step(delta):
            if let current, var i = rounds.firstIndex(where: { $0.id == current }) {
                if i + delta < 0 {
                    allBack += 60
                    rounds = allRounds()
                    i = rounds.firstIndex { $0.id == current } ?? i
                }
                if rounds.indices.contains(i + delta) { round = rounds[i + delta] }
            }
        case .latest: break
        }
        if let round, let items = allItems(round.first, context: context) {
            publishAll(scope, rounds: rounds, round: round, items: items, ok: allFetched[round.first]?.ok ?? true)
        } else {
            publish(scope) { s in
                s.loading = true
                if let round {
                    s.rounds = rounds
                    s.selected = round.id
                    s.items = []
                }
            }
        }
        var ok = true
        if let round {
            ok = await loadDay(round.first, context: context, force: force)
        } else {
            // Today when something has finished, else yesterday.
            let today = DayKey.of(clock())
            ok = await loadDay(today, context: context, force: force)
            let finished = allItems(today, context: context)?.contains { $0.status == .final } ?? false
            round = rounds.first { $0.first == (finished ? today : today.adding(days: -1)) }
            if !finished { ok = await loadDay(today.adding(days: -1), context: context, force: force) || ok }
        }
        guard generation[scope] == token, let round else { return }
        publishAll(scope, rounds: rounds, round: round, items: allItems(round.first, context: context) ?? [], ok: ok)
    }

    private func publishAll(_ scope: ScheduleScope, rounds: [ResultRound], round: ResultRound, items: [ScheduleItem], ok: Bool) {
        publish(scope) { s in
            s.rounds = rounds
            s.selected = round.id
            s.items = items
            s.loading = false
            s.failed = !ok && items.isEmpty
            s.stale = !ok
            s.updated = allFetched[round.first]?.at ?? s.updated
            s.summary = Rounds.summary(items, sport: nil, now: clock())
            s.byes = []
        }
    }

    // MARK: Teams

    private struct TeamData {
        var items: [ScheduleItem]
        var summary: String?
        var isCurrent: Bool
        var label: String
        var fetchedAt: Date
        var stale: Bool
        /// CS2: pages of history loaded, and whether there are more.
        var pages = 1
        var exhausted = false
    }

    @ObservationIgnored private var teamData: [String: TeamData] = [:]

    private func teamKey(_ team: ScheduleTeamRef, _ year: Int?) -> String { "\(team.id)|\(year.map(String.init) ?? "current")" }

    /// A team's season (summarized with the friendlies setting).
    func season(_ team: ScheduleTeamRef, year: Int?, force: Bool = false) async -> TeamSeason? {
        guard let data = await loadTeam(team, year: year, force: force) else { return nil }
        return summarize(team, data)
    }

    private func summarize(_ team: ScheduleTeamRef, _ data: TeamData) -> TeamSeason {
        TeamSeasons.summarize(items: data.items, team: team, season: data.label, isCurrent: data.isCurrent, summary: data.summary,
                              includeFriendlies: friendlies.contains(team.id))
    }

    /// The team's schedule through the cache: the same URL and parsed type as
    /// `ScheduleStore.fetchTeam`, so the team page and its results share one fetch.
    private func loadTeam(_ team: ScheduleTeamRef, year: Int?, force: Bool) async -> TeamData? {
        let key = teamKey(team, year)
        if team.id.hasPrefix("cs-"), let id = Int(team.id.dropFirst(3)) {
            guard let page = try? await cache.get(CSHistory.url(teamIDs: [id], page: 0), ttl: force ? 0 : 30 * 60,
                                                  parse: { CSHistory.parse($0) }) else { return teamData[key] }
            var data = teamData[key] ?? TeamData(items: [], isCurrent: true, label: "Recent", fetchedAt: page.fetchedAt, stale: page.stale)
            // Page one refreshes; later pages stay.
            var seen = Set(page.value.map(\.id))
            data.items = page.value + data.items.filter { seen.insert($0.id).inserted }
            data.fetchedAt = page.fetchedAt
            data.stale = page.stale
            data.exhausted = data.exhausted || page.value.count < CSHistory.pageSize
            teamData[key] = data
            return data
        }
        guard let source = ScheduleProvider.ESPN.teamSource(team.id) else { return nil }
        let leagueID = team.league.flatMap { League.with(id: $0) }?.id
        // Soccer's past seasons come from the team's league (verified); soccer/all is the fallback.
        let byLeague = year != nil && source.sport == .soccer && leagueID.flatMap { League.with(id: $0) }?.sport == .soccer
        let path = byLeague ? "soccer/\(leagueID ?? "")" : source.path
        let parseLeague = byLeague ? leagueID ?? source.league : source.league
        let ttl: TimeInterval = force ? 0 : year == nil ? ScheduleStore.teamTTL : Self.finalTTL
        let cache = self.cache
        let sport = source.sport
        @Sendable func get(_ url: URL?) async -> ScheduleCache.Fetched<ScheduleProvider.ESPN.TeamSchedule>? {
            guard let url else { return nil }
            return try? await cache.get(url, ttl: ttl) {
                ScheduleProvider.ESPN.parseTeamSchedule($0, path: path, league: parseLeague, sport: sport)
            }
        }
        var fetched: [ScheduleCache.Fetched<ScheduleProvider.ESPN.TeamSchedule>] = []
        if let year {
            let types: [Int?] = sport == .soccer ? [nil] : [2, 3]
            for type in types {
                if let f = await get(try? TeamSeasons.url(path: path, team: source.team, season: year, seasonType: type)) { fetched.append(f) }
            }
        } else if let main = await get(try? ScheduleProvider.ESPN.teamURL(path: path, team: source.team)) {
            fetched.append(main)
            // In the postseason the default schedule is the postseason alone: add the regular season.
            if sport != .soccer, main.value.seasonType == 3,
               let regular = await get(try? TeamSeasons.url(path: path, team: source.team, season: nil, seasonType: 2)) {
                fetched.append(regular)
            }
        }
        guard !fetched.isEmpty else { return teamData[key] }
        var seen = Set<String>()
        let items = fetched.flatMap(\.value.items).filter { seen.insert($0.id).inserted }
        let league = team.league ?? (sport == .soccer ? nil : source.league)
        let seasonYear = year ?? TeamSeasons.currentYear(sport: sport, league: league, today: todayEastern)
        let data = TeamData(items: items, summary: year == nil ? fetched.first?.value.summary : nil, isCurrent: year == nil,
                            label: TeamSeasons.label(year: seasonYear, sport: sport, league: league),
                            fetchedAt: fetched.map(\.fetchedAt).min() ?? clock(), stale: fetched.contains { $0.stale })
        teamData[key] = data
        return data
    }

    private func showTeam(_ team: ScheduleTeamRef, scope: ScheduleScope, force: Bool) async {
        let token = begin(scope)
        let year = state(scope)?.seasonYear
        if teamData[teamKey(team, year)] != nil { republishTeam(scope, team: team) } else { publish(scope) { $0.loading = true } }
        let data = await loadTeam(team, year: year, force: force)
        guard generation[scope] == token else { return }
        guard data != nil else {
            publish(scope) { s in
                s.loading = false
                s.failed = s.season == nil
                s.stale = s.season != nil
            }
            return
        }
        republishTeam(scope, team: team)
    }

    private func republishTeam(_ scope: ScheduleScope, team: ScheduleTeamRef) {
        let year = state(scope)?.seasonYear
        guard let data = teamData[teamKey(team, year)] else { return }
        let season = summarize(team, data)
        publish(scope) { s in
            s.season = season
            s.items = Array(season.results.prefix(s.limit))
            s.more = season.results.count > s.limit || (team.id.hasPrefix("cs-") && !data.exhausted)
            s.loading = false
            s.failed = false
            s.stale = data.stale
            s.updated = data.fetchedAt
            s.rounds = []
            s.selected = nil
            s.summary = nil
        }
    }

    // MARK: Your Teams (last 30 days)

    @ObservationIgnored private var yourTeams: [ScheduleTeamRef] = []

    private func showYourTeams(context: Context, force: Bool) async {
        let scope = ScheduleScope.yourTeams
        let token = begin(scope)
        yourTeams = context.followed
        if state(scope)?.updated != nil { republishYourTeams() } else { publish(scope) { $0.loading = true } }
        let teams = context.followed
        let results = await withTaskGroup(of: Bool.self) { group in
            for team in teams { group.addTask { await self.loadTeam(team, year: nil, force: force) != nil } }
            var out: [Bool] = []
            for await ok in group { out.append(ok) }
            return out
        }
        guard generation[scope] == token else { return }
        republishYourTeams()
        if !teams.isEmpty, !results.contains(true) { publish(scope) { $0.failed = $0.items.isEmpty } }
    }

    private func republishYourTeams() {
        let from = todayEastern.adding(days: -30)
        var seen = Set<String>()
        var all: [ScheduleItem] = []
        var fetched: [Date] = []
        var stale = false
        for team in yourTeams {
            guard let data = teamData[teamKey(team, nil)] else { continue }
            fetched.append(data.fetchedAt)
            stale = stale || data.stale
            let include = friendlies.contains(team.id)
            all += data.items.filter { item in
                item.status == .final && item.day >= from && (include || !TeamSeasons.isFriendly(item)) && seen.insert(item.id).inserted
            }
        }
        all.sort { $0.sortDate > $1.sortDate }
        publish(.yourTeams) { s in
            s.items = Array(all.prefix(s.limit))
            s.more = all.count > s.limit
            s.loading = false
            s.failed = false
            s.stale = stale
            s.updated = fetched.min() ?? s.updated
        }
    }

    // MARK: Seeding (render harness, tests)

    #if DEBUG
    func seed(_ scope: ScheduleScope, _ state: PageState) { publish(scope) { $0 = state } }
    #endif
}
