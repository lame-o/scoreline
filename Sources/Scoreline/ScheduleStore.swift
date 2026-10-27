import Foundation
import Observation

/// Schedules for every scope: loads through `ScheduleCache`, filters the way
/// the scores list does, and remembers per-page state (week, expansions) for
/// the session so Back lands where you were. Nothing here polls: live state
/// comes from `ScoreStore` (same event IDs), read by the rows themselves.
@MainActor
@Observable
final class ScheduleStore {
    static let shared = ScheduleStore()

    struct AgendaState {
        var items: [ScheduleItem] = []
        /// Results before the visible window, loaded when "Earlier" opens.
        var earlier: [ScheduleItem]?
        var loading = false
        var failed = false
        /// Showing saved data the network couldn't refresh.
        var stale = false
        var updated: Date?
        var calendar: ScheduleCalendar?
        /// Week ID → teams on a bye.
        var byes: [String: [String]] = [:]
        /// Team scope: "5–0 · 1st in AFC West".
        var summary: String?
        /// Enabled leagues with nothing in the window.
        var quiet: [String] = []
        /// The next game day of each quiet league, when its calendar knows.
        var nextDay: [String: DayKey] = [:]
        /// List scopes: more game days after the ones loaded.
        var more = false
        /// Bumped with every change to what the page shows (see `agenda`).
        var revision = 0
    }

    struct SeasonsState {
        /// Climbing: season names in order ("2026", "2027"); CS2: ["upcoming"].
        var seasons: [String] = []
        var events: [String: [SeasonEvent]] = [:]
        var loading = false
        var failed = false
        var stale = false
        var updated: Date?
        /// Climbing: the season with the next unfinished event.
        var defaultSeason: String?
    }

    /// One observable box per page, so a write to one schedule re-renders only
    /// the views reading that schedule (a shared dictionary re-rendered all).
    @MainActor @Observable final class AgendaBox {
        var state: AgendaState?
    }

    @MainActor struct Agendas {
        let store: ScheduleStore
        subscript(scope: ScheduleScope) -> AgendaState? {
            get { store.box(scope).state }
            nonmutating set { store.box(scope).state = newValue }
        }
    }

    @ObservationIgnored private var boxes: [ScheduleScope: AgendaBox] = [:]
    /// Each page's state, read and written one page at a time.
    var agendas: Agendas { Agendas(store: self) }

    fileprivate func box(_ scope: ScheduleScope) -> AgendaBox {
        if let box = boxes[scope] { return box }
        let box = AgendaBox()
        boxes[scope] = box
        return box
    }
    /// The latest load of each page (an older one finishing late is dropped).
    @ObservationIgnored private var generation: [ScheduleScope: Int] = [:]
    /// `agenda(_:store:)` built once per change, not on every redraw.
    @ObservationIgnored private var built: [ScheduleScope: (key: AgendaKey, value: (earlier: [AgendaDay], upcoming: [AgendaDay]))] = [:]
    private(set) var climbing = SeasonsState()
    private(set) var tournaments = SeasonsState()
    /// Followed team ID → its next game (feeds My Teams beyond the scoreboard's window).
    private(set) var nextGames: [String: ScheduleItem] = [:]

    // MARK: Session state (per page, for Back)

    /// Strip scopes: the first day of the window shown.
    var windowStart: [ScheduleScope: DayKey] = [:]
    /// NFL/college: the week shown.
    var selectedWeek: [ScheduleScope: ScheduleCalendar.Week] = [:]
    var earlierExpanded: Set<ScheduleScope> = []
    /// Expanded climbing events and tournaments.
    var expanded: Set<String> = []
    /// Climbing: the season picked in the title menu.
    var climbingSeason: String?
    /// Split mode: the event shown beside the list.
    var selectedEvent: [ScheduleScope: String] = [:]
    /// Lifts team picks and the Top 25 filter for one page.
    var showAllGames: Set<ScheduleScope> = []
    /// List scopes: how many game days are loaded (a page at a time).
    var listDays: [ScheduleScope: Int] = [:]
    static let listPage = 7
    /// Days unfolded or folded by hand; the rest follow `Agenda.defaultOpen`.
    var openedDays: [ScheduleScope: Set<DayKey>] = [:]
    var closedDays: [ScheduleScope: Set<DayKey>] = [:]

    /// A schedule to open from somewhere without a navigation callback (the
    /// game menu shared by rows and tiles). The panel's root opens it and clears it.
    var openRequest: ScheduleScope?

    let cache: ScheduleCache

    init(cache: ScheduleCache = .shared) {
        self.cache = cache
    }

    // MARK: Freshness

    /// How long data about `day` stays fresh: results more than 48 hours old
    /// are final (30 days), the coming week changes, the far future rarely.
    static func ttl(for day: DayKey, today: DayKey = .today()) -> TimeInterval {
        let ahead = today.days(to: day)
        if ahead < -2 { return 30 * 86_400 }
        if ahead <= 7 { return 30 * 60 }
        return 6 * 3600
    }

    static let calendarTTL: TimeInterval = 12 * 3600
    static let teamTTL: TimeInterval = 6 * 3600

    // MARK: Loading

    func load(_ scope: ScheduleScope, store: ScoreStore, force: Bool = false) async {
        switch scope {
        case .climbing: await loadClimbing(countries: Set(store.climbingCountries), force: force)
        case .tournaments: await loadTournaments(followed: followedCS(store), force: force)
        default:
            // First visit this session: paint what's saved on disk (however
            // old) at once, then replace it with what's fresh as it lands.
            if agendas[scope]?.updated == nil { await loadAgenda(scope, store: store, cacheOnly: true) }
            await loadAgenda(scope, store: store, force: force)
        }
    }

    /// Every write of a page's state goes through here, so `agenda` knows when to rebuild.
    private func publish(_ scope: ScheduleScope, _ state: AgendaState) {
        var state = state
        state.revision = (agendas[scope]?.revision ?? 0) + 1
        agendas[scope] = state
    }

    /// List scopes: one more page of game days.
    func loadMore(_ scope: ScheduleScope, store: ScoreStore) async {
        listDays[scope] = (listDays[scope] ?? Self.listPage) + Self.listPage
        await loadAgenda(scope, store: store)
    }

    // MARK: Folded days

    func isOpen(_ day: DayKey, in scope: ScheduleScope, defaults: Set<DayKey>) -> Bool {
        if openedDays[scope]?.contains(day) == true { return true }
        if closedDays[scope]?.contains(day) == true { return false }
        return defaults.contains(day)
    }

    func setOpen(_ open: Bool, day: DayKey, in scope: ScheduleScope) {
        if open {
            openedDays[scope, default: []].insert(day)
            closedDays[scope]?.remove(day)
        } else {
            closedDays[scope, default: []].insert(day)
            openedDays[scope]?.remove(day)
        }
    }

    /// The days a strip scope shows: a week from its window start.
    func window(_ scope: ScheduleScope) -> (from: DayKey, to: DayKey) {
        let start = windowStart[scope] ?? .today()
        return (start, start.adding(days: 6))
    }

    func moveWindow(_ scope: ScheduleScope, by days: Int, store: ScoreStore) async {
        windowStart[scope] = window(scope).from.adding(days: days)
        await loadAgenda(scope, store: store)
    }

    func showToday(_ scope: ScheduleScope, store: ScoreStore) async {
        windowStart[scope] = nil
        selectedWeek[scope] = nil
        await loadAgenda(scope, store: store)
    }

    func selectWeek(_ week: ScheduleCalendar.Week, for scope: ScheduleScope, store: ScoreStore) async {
        selectedWeek[scope] = week
        await loadAgenda(scope, store: store)
    }

    /// Loads a page's items. With `cacheOnly`, only what's saved (no network):
    /// the first paint, written only if something was found.
    private func loadAgenda(_ scope: ScheduleScope, store: ScoreStore, force: Bool = false, cacheOnly: Bool = false) async {
        var state = agendas[scope] ?? AgendaState()
        if !cacheOnly {
            state.loading = true
            agendas[scope] = state
        }
        generation[scope, default: 0] += 1
        let token = generation[scope] ?? 0
        let today = DayKey.today()
        var items: [ScheduleItem] = []
        var outcomes: [Bool] = []
        var calendar: ScheduleCalendar?
        var byes = state.byes
        var summary: String?
        var quiet: [String] = []
        var nextDay: [String: DayKey] = [:]
        var more = false
        var fetchedAt: [Date] = []

        switch scope {
        case .all:
            let (from, to) = window(scope)
            let leagues = store.enabledLeagues
            // What's showing stays until its league's fresh copy replaces it.
            var shown = Dictionary(grouping: state.items, by: \.league)
            var fetches: [String: LeagueFetch] = [:]
            await withTaskGroup(of: (String, LeagueFetch).self) { group in
                for league in leagues {
                    group.addTask { (league.id, await self.fetch(league, from: from, to: to, store: store, force: force, cacheOnly: cacheOnly)) }
                }
                for await (id, fetch) in group {
                    fetches[id] = fetch
                    guard fetch.ok, let league = League.with(id: id) else { continue }
                    shown[id] = filter(fetch.items, league: league, store: store, showAll: false)
                        .filter { from <= $0.day && $0.day <= to }
                    // Stream: each league shows as it lands, without waiting
                    // for the slowest (only while this is still the latest load).
                    guard !cacheOnly, generation[scope] == token else { continue }
                    let partial = leagues.flatMap { shown[$0.id] ?? [] }
                    var current = agendas[scope] ?? AgendaState()
                    guard !partial.isEmpty, partial != current.items else { continue }
                    current.items = partial
                    current.updated = current.updated ?? .now
                    publish(scope, current)
                }
            }
            for league in leagues {
                guard let fetch = fetches[league.id] else { continue }
                outcomes.append(fetch.ok)
                fetchedAt += fetch.fetchedAt.map { [$0] } ?? []
                let mine = fetch.ok ? (shown[league.id] ?? []) : []
                if mine.isEmpty, fetch.ok {
                    quiet.append(league.id)
                    if let next = fetch.calendar?.nextDay(onOrAfter: to.adding(days: 1)) { nextDay[league.id] = next }
                }
                items += mine
                byes.merge(fetch.byes) { _, b in b }
            }

        case let .league(id):
            guard let league = League.with(id: id) else { break }
            let showAll = showAllGames.contains(scope)
            let fetch: LeagueFetch
            if case .espn(_, true) = league.source {
                fetch = await fetchWeek(league, scope: scope, store: store, force: force, cacheOnly: cacheOnly)
                byes.merge(fetch.byes) { _, b in b }
            } else {
                fetch = await fetchList(league, days: listDays[scope] ?? Self.listPage, force: force, cacheOnly: cacheOnly)
                more = fetch.more
            }
            outcomes.append(fetch.ok)
            fetchedAt += fetch.fetchedAt.map { [$0] } ?? []
            calendar = fetch.calendar
            items = filter(fetch.items, league: league, store: store, showAll: showAll)

        case let .team(team):
            let fetch = await fetchTeam(team, force: force, cacheOnly: cacheOnly)
            outcomes.append(fetch.ok)
            items = fetch.items
            summary = fetch.summary

        case .yourTeams:
            let teams = store.followed.map { ScheduleTeamRef(id: $0.id, name: $0.name, logo: $0.logo) }
            let fetched = await withTaskGroup(of: TeamFetch.self) { group in
                for team in teams { group.addTask { await self.fetchTeam(team, force: force, cacheOnly: cacheOnly) } }
                var out: [TeamFetch] = []
                for await fetch in group { out.append(fetch) }
                return out
            }
            outcomes = fetched.map(\.ok)
            let horizon = today.adding(days: 60), back = today.adding(days: -14)
            items = fetched.flatMap(\.items).filter { back <= $0.day && $0.day <= horizon }

        case .climbing, .tournaments:
            break
        }

        // A newer load (the window moved, more was asked for) owns the page now.
        guard generation[scope] == token else { return }
        state = agendas[scope] ?? AgendaState()
        if cacheOnly {
            // Nothing saved: keep the skeleton until the network answers.
            guard outcomes.contains(true) else { return }
            state.items = items
            state.updated = fetchedAt.min() ?? .now
            state.stale = true
            state.calendar = calendar ?? state.calendar
            state.byes = byes
            state.summary = summary ?? state.summary
            state.more = more
            publish(scope, state)
            return
        }
        state.loading = false
        state.failed = !outcomes.isEmpty && !outcomes.contains(true)
        state.stale = outcomes.contains(false)
        if !state.failed {
            state.items = items
            state.updated = .now
            state.calendar = calendar ?? state.calendar
            state.byes = byes
            state.summary = summary ?? state.summary
            state.quiet = quiet
            state.nextDay = nextDay
            state.more = more
        }
        publish(scope, state)
        if earlierExpanded.contains(scope), scope.navigator == .weekStrip { await loadEarlier(scope, store: store) }
    }

    /// Strip scopes: the week before the window, as results.
    func loadEarlier(_ scope: ScheduleScope, store: ScoreStore) async {
        guard scope.navigator == .weekStrip else { return }
        let (from, _) = window(scope)
        let start = from.adding(days: -7), end = from.adding(days: -1)
        let leagues: [League] = switch scope {
        case .all: store.enabledLeagues
        case let .league(id): League.with(id: id).map { [$0] } ?? []
        default: []
        }
        var items: [ScheduleItem] = []
        for league in leagues {
            let fetch = await self.fetch(league, from: start, to: end, store: store, force: false)
            items += filter(fetch.items, league: league, store: store, showAll: showAllGames.contains(scope))
                .filter { start <= $0.day && $0.day <= end }
        }
        var state = agendas[scope] ?? AgendaState()
        state.earlier = items
        publish(scope, state)
    }

    func setEarlier(_ scope: ScheduleScope, expanded: Bool, store: ScoreStore) async {
        if expanded { earlierExpanded.insert(scope) } else { earlierExpanded.remove(scope) }
        if expanded, agendas[scope]?.earlier == nil { await loadEarlier(scope, store: store) }
    }

    // MARK: Fetching a league

    struct LeagueFetch: Sendable {
        var items: [ScheduleItem] = []
        var ok = true
        var calendar: ScheduleCalendar?
        var byes: [String: [String]] = [:]
        /// List scopes: more game days after these.
        var more = false
        /// The oldest response used (a cached first paint says how old it is).
        var fetchedAt: Date?
    }

    struct TeamFetch: Sendable {
        var items: [ScheduleItem] = []
        var ok = true
        var summary: String?
    }

    /// One league's items for the days `from…to`, with the fewest requests the
    /// source allows: months (soccer), days (MLB, NBA), weeks (NFL, college).
    /// `minimumTTL` raises every board's freshness (results whose window is long over).
    func fetch(_ league: League, from: DayKey, to: DayKey, store: ScoreStore, force: Bool,
               cacheOnly: Bool = false, minimumTTL: TimeInterval? = nil) async -> LeagueFetch {
        var out = LeagueFetch()
        switch league.source {
        case let .espn(path, weekly):
            let sport = league.sport
            out.calendar = await calendar(path: path, cacheOnly: cacheOnly)
            var windows: [ScheduleProvider.ESPN.Window]
            var floors: [ScheduleProvider.ESPN.Window: TimeInterval] = [:]
            if weekly {
                let weeks = (out.calendar?.weeks ?? []).filter { week in
                    DayKey.of(week.start) <= to && DayKey.of(week.end) >= from
                }
                windows = weeks.map { .week($0.number, seasonType: $0.seasonType) }
                // A week over more than 48 hours ago is all results.
                for week in weeks where week.end < .now - 2 * 86_400 {
                    floors[.week(week.number, seasonType: week.seasonType)] = Self.finalTTL
                }
                if windows.isEmpty { windows = [.undated] }
            } else if sport == .soccer {
                windows = ScheduleProvider.ESPN.months(from: from.adding(days: -1), to: to.adding(days: 1))
            } else {
                // Only the days the league plays, plus the edge day the viewer's zone needs.
                windows = ScheduleProvider.ESPN.boardDays(from: from, to: to, calendar: out.calendar).map { .day($0) }
            }
            if let minimumTTL { for window in windows { floors[window] = max(floors[window] ?? 0, minimumTTL) } }
            let boards = await self.boards(windows, path: path, league: league.id, sport: sport, force: force, cacheOnly: cacheOnly,
                                           floors: floors)
            out.ok = !boards.isEmpty || windows.isEmpty && (cacheOnly ? out.calendar != nil : true)
            out.fetchedAt = boards.map(\.fetched).min()
            var seen = Set<String>()
            for (window, board, _) in boards {
                out.items += board.items.filter { seen.insert($0.id).inserted }
                if case let .week(n, type) = window, !board.byes.isEmpty { out.byes["\(type)-\(n)"] = board.byes }
            }

        case .counterStrike:
            let url = ScheduleProvider.CS.matchesURL(from: from.start(), to: to.adding(days: 1).start())
            if let fetched = await cached(url, ttl: Self.ttl(for: from), cacheOnly: cacheOnly, parse: { ScheduleProvider.CS.parseMatches($0) }) {
                out.items = collapseTournamentDays(fetched.value, followed: followedCS(store))
                out.fetchedAt = fetched.fetchedAt
            } else {
                out.ok = false
            }

        case .ifsc:
            // A first paint uses the season already in memory; the network pass loads it.
            if !cacheOnly { await loadClimbing(countries: Set(store.climbingCountries), force: force) }
            let events = store.tracked(climbing.events.values.flatMap { $0 })
            out.items = events.filter { $0.startDay <= to && $0.endDay >= from && $0.status != .canceled }
                .flatMap { climbingItems($0, from: from, to: to) }
            out.ok = cacheOnly ? climbing.updated != nil : !climbing.failed
        }
        return out
    }

    /// A daily league's next `days` game days (from its calendar), as one
    /// list: day boards, or the months holding them (soccer).
    func fetchList(_ league: League, days count: Int, force: Bool, cacheOnly: Bool = false) async -> LeagueFetch {
        guard case let .espn(path, _) = league.source else { return LeagueFetch(ok: false) }
        var out = LeagueFetch()
        out.calendar = await calendar(path: path, cacheOnly: cacheOnly)
        // Boards are Eastern days; what's shown is the viewer's.
        let boardToday = DayKey.today(in: DayKey.eastern), today = DayKey.today()
        // One more than shown, to know whether there's a next page.
        let listed = out.calendar?.gameDays(from: boardToday, limit: count + 1)
        let days = listed.map { Array($0.prefix(count)) } ?? (0..<count).map { boardToday.adding(days: $0) }
        guard let first = days.first, let last = days.last else {
            // The calendar lists nothing ahead: the season is over (or not yet scheduled).
            out.ok = cacheOnly ? out.calendar != nil : true
            return out
        }
        let windows: [ScheduleProvider.ESPN.Window] = league.sport == .soccer
            ? ScheduleProvider.ESPN.months(from: first, to: last)
            : days.map { .day($0) }
        let boards = await self.boards(windows, path: path, league: league.id, sport: league.sport, force: force, cacheOnly: cacheOnly)
        out.ok = !boards.isEmpty
        out.fetchedAt = boards.map(\.fetched).min()
        var seen = Set<String>()
        let upcoming = boards.flatMap(\.board.items).filter { $0.day >= today && seen.insert($0.id).inserted }
        // A month brings more than was asked for: keep the first `count` game days.
        let shownDays = Set(upcoming.map(\.day)).sorted().prefix(count)
        out.items = upcoming.filter { shownDays.contains($0.day) }
        out.more = (listed?.count ?? 0) > count || Set(upcoming.map(\.day)).count > count
        return out
    }

    struct Board: Codable, Sendable {
        var items: [ScheduleItem]
        var byes: [String]
    }

    /// Boards for each window, in parallel; the ones that answered (or were saved).
    private func boards(_ windows: [ScheduleProvider.ESPN.Window], path: String, league: String, sport: Sport, force: Bool,
                        cacheOnly: Bool, floors: [ScheduleProvider.ESPN.Window: TimeInterval] = [:])
        async -> [(window: ScheduleProvider.ESPN.Window, board: Board, fetched: Date)] {
        await withTaskGroup(of: (ScheduleProvider.ESPN.Window, ScheduleCache.Fetched<Board>?).self) { group in
            for window in windows {
                group.addTask {
                    (window, await self.board(path: path, league: league, sport: sport, window: window, force: force, cacheOnly: cacheOnly,
                                              minimumTTL: floors[window]))
                }
            }
            var all: [(window: ScheduleProvider.ESPN.Window, board: Board, fetched: Date)] = []
            for await (window, fetched) in group {
                if let fetched { all.append((window, fetched.value, fetched.fetchedAt)) }
            }
            return all
        }
    }

    /// Results that can no longer change (over more than 48 hours ago).
    static let finalTTL: TimeInterval = 30 * 86_400

    /// One scoreboard through the cache. `minimumTTL` raises its freshness
    /// (Results: a week that ended more than 48 hours ago).
    func board(path: String, league: String, sport: Sport, window: ScheduleProvider.ESPN.Window,
               force: Bool, cacheOnly: Bool = false, minimumTTL: TimeInterval? = nil) async -> ScheduleCache.Fetched<Board>? {
        let url = ScheduleProvider.ESPN.scoreboardURL(path: path, window: window)
        let today = DayKey.today()
        var ttl: TimeInterval = switch window {
        case let .day(day): Self.ttl(for: day, today: today)
        case let .month(year, month):
            // A month over more than 48 hours ago is all results.
            DayKey(year: month == 12 ? year + 1 : year, month: month % 12 + 1, day: 1).adding(days: -1) < today.adding(days: -2)
                ? Self.finalTTL : Self.ttl(for: max(DayKey(year: year, month: month, day: 28), today), today: today)
        case .week, .undated: 30 * 60
        }
        ttl = max(ttl, minimumTTL ?? 0)
        return await cached(url, ttl: force ? 0 : ttl, cacheOnly: cacheOnly) { data in
            Board(items: ScheduleProvider.ESPN.parseScoreboard(data, path: path, league: league, sport: sport),
                  byes: ScheduleProvider.ESPN.parseByes(data))
        }
    }

    /// Through the cache, or (a first paint) only what it has saved.
    private func cached<T: Codable & Sendable>(_ url: URL, headers: [String: String] = [:], ttl: TimeInterval, cacheOnly: Bool,
                                               parse: @escaping @Sendable (Data) throws -> T) async -> ScheduleCache.Fetched<T>? {
        if cacheOnly { return await cache.peek(url, as: T.self) }
        return try? await cache.get(url, headers: headers, ttl: ttl, parse: parse)
    }

    /// A league's season calendar (from its undated scoreboard).
    func calendar(path: String, cacheOnly: Bool = false) async -> ScheduleCalendar? {
        let url = ScheduleProvider.ESPN.scoreboardURL(path: path, window: .undated)
        return await cached(url, ttl: Self.calendarTTL, cacheOnly: cacheOnly) { ScheduleProvider.ESPN.parseCalendar($0) }?.value
    }

    /// NFL/college: the selected week, defaulting to the current one, or the
    /// next once every game of the current week is over (on a Sunday the
    /// college board still shows the finished week).
    private func fetchWeek(_ league: League, scope: ScheduleScope, store: ScoreStore, force: Bool,
                           cacheOnly: Bool = false) async -> LeagueFetch {
        guard case let .espn(path, _) = league.source else { return LeagueFetch(ok: false) }
        var out = LeagueFetch()
        out.calendar = await calendar(path: path, cacheOnly: cacheOnly)
        var week = selectedWeek[scope] ?? out.calendar?.week(at: .now)
        func get(_ window: ScheduleProvider.ESPN.Window) async -> ScheduleCache.Fetched<Board>? {
            await self.board(path: path, league: league.id, sport: league.sport, window: window, force: force, cacheOnly: cacheOnly)
        }
        guard let current = week else {
            let undated = await get(.undated)
            return LeagueFetch(items: undated?.value.items ?? [], ok: undated != nil, calendar: out.calendar, fetchedAt: undated?.fetchedAt)
        }
        var shown = await get(.week(current.number, seasonType: current.seasonType))
        if selectedWeek[scope] == nil, let items = shown?.value.items, !items.isEmpty, items.allSatisfy({ $0.status == .final }),
           let next = out.calendar?.week(after: current) {
            week = next
            shown = await get(.week(next.number, seasonType: next.seasonType))
        }
        if let week, selectedWeek[scope] == nil, !cacheOnly { selectedWeek[scope] = week }
        out.ok = shown != nil
        out.items = shown?.value.items ?? []
        out.fetchedAt = shown?.fetchedAt
        if let week, let byes = shown?.value.byes, !byes.isEmpty { out.byes[week.id] = byes }
        return out
    }

    /// A team's season (ESPN) or upcoming matches (CS2). `seasonTypes`
    /// (US sports) asks for those season types and merges them: in the
    /// postseason the default schedule is the postseason alone.
    func fetchTeam(_ team: ScheduleTeamRef, force: Bool, cacheOnly: Bool = false, minimumTTL: TimeInterval? = nil,
                   seasonTypes: [Int]? = nil) async -> TeamFetch {
        if team.id.hasPrefix("cs-"), let id = Int(team.id.dropFirst(3)) {
            let url = ScheduleProvider.CS.teamMatchesURL(teamIDs: [id])
            guard let fetched = await cached(url, ttl: force ? 0 : 10 * 60, cacheOnly: cacheOnly, parse: { ScheduleProvider.CS.parseMatches($0) })
            else { return TeamFetch(ok: false) }
            return TeamFetch(items: fetched.value)
        }
        guard let source = ScheduleProvider.ESPN.teamSource(team.id) else { return TeamFetch(ok: false) }
        let ttl = force ? 0 : max(Self.teamTTL, minimumTTL ?? 0)
        let cache = self.cache
        @Sendable func get(_ url: URL?) async -> ScheduleProvider.ESPN.TeamSchedule? {
            guard let url else { return nil }
            if cacheOnly { return await cache.peek(url, as: ScheduleProvider.ESPN.TeamSchedule.self)?.value }
            return try? await cache.get(url, ttl: ttl) {
                ScheduleProvider.ESPN.parseTeamSchedule($0, path: source.path, league: source.league, sport: source.sport)
            }.value
        }
        if source.sport == .soccer {
            // Soccer: fixtures and results are separate lists.
            async let upcoming = get(try? ScheduleProvider.ESPN.teamURL(path: source.path, team: source.team, fixtures: true))
            async let played = get(try? ScheduleProvider.ESPN.teamURL(path: source.path, team: source.team))
            let (u, p) = await (upcoming, played)
            guard u != nil || p != nil else { return TeamFetch(ok: false) }
            let items = (p?.items ?? []) + (u?.items ?? [])
            // The record from the latest league game (cup ties carry none).
            let record = items.filter { $0.status == .final && League.with(id: $0.league) != nil }
                .max { $0.sortDate < $1.sortDate }?.teams.first { $0.id == team.id }?.record
            return TeamFetch(items: items, summary: record.map(RowText.record))
        }
        if let seasonTypes, !seasonTypes.isEmpty {
            let schedules = await withTaskGroup(of: (Int, ScheduleProvider.ESPN.TeamSchedule?).self) { group in
                for type in seasonTypes {
                    group.addTask { (type, await get(try? TeamSeasons.url(path: source.path, team: source.team, season: nil, seasonType: type))) }
                }
                var out: [Int: ScheduleProvider.ESPN.TeamSchedule] = [:]
                for await (type, schedule) in group { out[type] = schedule }
                return out
            }
            guard !schedules.isEmpty else { return TeamFetch(ok: false) }
            var seen = Set<String>()
            let items = seasonTypes.compactMap { schedules[$0] }.flatMap(\.items).filter { seen.insert($0.id).inserted }
            return TeamFetch(items: items, summary: seasonTypes.compactMap { schedules[$0]?.summary }.first)
        }
        guard let schedule = await get(try? ScheduleProvider.ESPN.teamURL(path: source.path, team: source.team)) else {
            return TeamFetch(ok: false)
        }
        return TeamFetch(items: schedule.items, summary: schedule.summary)
    }

    // MARK: Quiet leagues (the scores list's footnote)

    /// League ID → season calendar, for "Bundesliga: next Sat, Nov 7".
    private(set) var calendars: [String: ScheduleCalendar] = [:]

    /// Loads (from cache, 12 h) the calendars of leagues the list says are quiet.
    func loadCalendars(_ leagues: [League]) async {
        for league in leagues where calendars[league.id] == nil {
            guard case let .espn(path, _) = league.source, let calendar = await calendar(path: path) else { continue }
            calendars[league.id] = calendar
        }
    }

    /// The league's next game day after the scores list's window (today and tomorrow, or this week).
    func nextDay(for league: League) -> DayKey? {
        guard let calendar = calendars[league.id] else { return nil }
        if case .espn(_, true) = league.source {
            guard let current = calendar.week(at: .now) else { return nil }
            return calendar.week(after: current).map { DayKey.of($0.start) }
        }
        return calendar.nextDay(onOrAfter: DayKey.today().adding(days: 2))
    }

    // MARK: Next games (My Teams)

    /// Each followed team's next game. Runs at launch, every 6 hours, and when
    /// a followed team's game ends (ScoreStore hook, specs/schedules.md H6).
    func refreshNextGames(for teams: [FollowedTeam], force: Bool = false) async {
        let now = Date()
        var next: [String: ScheduleItem] = [:]
        for team in teams {
            let fetch = await fetchTeam(ScheduleTeamRef(id: team.id, name: team.name, logo: team.logo), force: force)
            if let item = fetch.items.filter({ ($0.status == .scheduled || $0.status == .live) && $0.sortDate > now - 3 * 3600 })
                .min(by: { $0.sortDate < $1.sortDate }) {
                next[team.id] = item
            }
        }
        nextGames = next
    }

    // MARK: Climbing

    struct SeasonList: Codable, Sendable {
        var current: ScheduleProvider.IFSC.SeasonRef?
        var all: [ScheduleProvider.IFSC.SeasonRef]
    }

    func loadClimbing(countries: Set<String>, force: Bool = false) async {
        typealias IFSC = ScheduleProvider.IFSC
        if climbing.loading { return }
        climbing.loading = true
        defer { climbing.loading = false }
        let ttl: TimeInterval = force ? 0 : Self.calendarTTL
        guard let list = try? await cache.get(IFSC.rootURL, headers: IFSC.headers, ttl: ttl, parse: { data in
            let s = IFSC.seasons(root: data)
            return SeasonList(current: s.current, all: s.all)
        }) else {
            climbing.failed = climbing.events.isEmpty
            return
        }
        let seasons = IFSC.currentAndNext((list.value.current, list.value.all))
        var events: [String: [SeasonEvent]] = [:]
        var stale = list.stale
        for season in seasons {
            guard let fetched = try? await cache.get(IFSC.seasonURL(season.id), headers: IFSC.headers, ttl: ttl,
                                                     parse: { IFSC.parseSeason($0) }) else { stale = true; continue }
            stale = stale || fetched.stale
            // Statuses move with the clock, not the cache.
            events[season.name] = fetched.value.map { event in
                var event = event
                event.status = IFSC.status(startsAt: event.startsAt, endsAt: event.endsAt, now: .now)
                if let old = climbing.events[season.name]?.first(where: { $0.id == event.id }), old.detailed {
                    event.rounds = old.rounds
                    event.categories = old.categories
                    event.registered = old.registered
                    event.detailed = true
                }
                return event
            }
        }
        climbing.seasons = seasons.map(\.name).filter { events[$0]?.isEmpty == false }
        climbing.events = events
        climbing.failed = events.isEmpty
        climbing.stale = stale
        climbing.updated = .now
        let all = events.values.flatMap { $0 }
        if let next = IFSC.next(in: all) {
            climbing.defaultSeason = String(next.startDay.year)
        } else {
            climbing.defaultSeason = climbing.seasons.last
        }
        // Details for what's live or close: rounds, registrations, stream times.
        for event in all where event.status == .live || (event.status == .upcoming && DayKey.today().days(to: event.startDay) <= 14) {
            await loadClimbingDetail(event.id, countries: countries)
        }
    }

    /// Rounds and podiums, your countries' registrations, and stream times.
    func loadClimbingDetail(_ id: String, countries: Set<String>) async {
        typealias IFSC = ScheduleProvider.IFSC
        guard let at = locate(id), case let .climbing(eventID) = climbing.events[at.0]![at.1].kind else { return }
        var event = climbing.events[at.0]![at.1]
        let ttl: TimeInterval = event.status == .live ? 600 : 6 * 3600
        // Parsed in the cache's task, off the main thread; only the detail is copied here.
        let base = event
        if let detail = try? await cache.get(IFSC.eventURL(eventID), headers: IFSC.headers, ttl: ttl,
                                             parse: { IFSC.parseEvent($0, into: base) }) {
            event = IFSC.withDetail(detail.value, into: event)
        }
        if !countries.isEmpty, event.status != .finished,
           let regs = try? await cache.get(IFSC.registrationsURL(eventID), headers: IFSC.headers, ttl: 12 * 3600,
                                           parse: { IFSC.parseRegistrations($0, countries: countries) }) {
            event.registered = regs.value
        }
        let soon = DayKey.today().days(to: event.startDay) <= 7 && event.status != .finished
        if soon, let slots = try? await cache.get(ScheduleProvider.Streams.url, headers: ScheduleProvider.Streams.headers,
                                                  ttl: 30 * 60, parse: { data in
                                                      ScheduleProvider.Streams.parse(html: String(decoding: data, as: UTF8.self))
                                                  }) {
            event = ScheduleProvider.Streams.attach(slots.value, to: event)
        }
        if let at = locate(id) { climbing.events[at.0]![at.1] = event }
    }

    private func locate(_ id: String) -> (String, Int)? {
        for (season, events) in climbing.events {
            if let index = events.firstIndex(where: { $0.id == id }) { return (season, index) }
        }
        return nil
    }

    /// A climbing competition in a day agenda: its rounds with known days,
    /// otherwise one line per competition day.
    func climbingItems(_ event: SeasonEvent, from: DayKey, to: DayKey) -> [ScheduleItem] {
        guard case let .climbing(eventID) = event.kind else { return [] }
        let zone = event.timeZone.flatMap(TimeZone.init(identifier:)) ?? .current
        var items: [ScheduleItem] = []
        var covered = Set<DayKey>()
        for round in event.rounds {
            guard let date = round.start.date else { continue }
            let day = DayKey.of(date)
            guard from <= day && day <= to else { continue }
            covered.insert(DayKey.of(date, in: zone))
            items.append(ScheduleItem(
                id: "\(event.id)-\(round.id)", sportRaw: Sport.climbing.rawValue, league: "ifsc", day: day, start: round.start,
                status: round.status == "finished" ? .final : round.status == "active" ? .live : .scheduled,
                title: round.label.prefix(1).uppercased() + round.label.dropFirst(),
                subtitle: [event.flag, event.shortName].compactMap { $0 }.joined(separator: " ")
                    + (round.categories.isEmpty ? "" : " · " + round.categories.joined(separator: " & ")),
                networks: round.stream == nil ? [] : ["YouTube"], link: round.stream ?? event.link, ref: .climbing(eventID: eventID)))
        }
        for offset in 0..<event.dayCount {
            let day = event.startDay.adding(days: offset)
            guard from <= day && day <= to, !covered.contains(day) else { continue }
            items.append(ScheduleItem(
                id: "\(event.id)-day\(offset + 1)", sportRaw: Sport.climbing.rawValue, league: "ifsc", day: day, start: .tba,
                status: event.status == .finished ? .final : .scheduled,
                title: "\(event.shortName) · Day \(offset + 1) of \(event.dayCount)",
                subtitle: [event.flag, event.lanes.map(\.capitalized).joined(separator: " · ")].compactMap { $0 }.joined(separator: " "),
                link: event.link, ref: .climbing(eventID: eventID)))
        }
        return items
    }

    // MARK: Tournaments

    func loadTournaments(followed: Set<String>, force: Bool = false) async {
        typealias CS = ScheduleProvider.CS
        if tournaments.loading { return }
        tournaments.loading = true
        defer { tournaments.loading = false }
        async let current = try? cache.get(CS.tournamentsURL(status: "current"), ttl: force ? 0 : 10 * 60,
                                           parse: { CS.parseTournaments($0) })
        async let upcoming = try? cache.get(CS.tournamentsURL(status: "upcoming"), ttl: force ? 0 : 6 * 3600,
                                            parse: { CS.parseTournaments($0) })
        let (c, u) = await (current, upcoming)
        guard c != nil || u != nil else {
            tournaments.failed = tournaments.events.isEmpty
            return
        }
        var events = (c?.value ?? []) + (u?.value ?? [])
        // Keep details already loaded.
        let old = Dictionary((tournaments.events["upcoming"] ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for i in events.indices where old[events[i].id]?.detailed == true {
            events[i].teams = old[events[i].id]!.teams
            events[i].place = old[events[i].id]!.place
            events[i].stages = old[events[i].id]!.stages
            events[i].detailed = true
        }
        tournaments.events["upcoming"] = events
        tournaments.seasons = ["upcoming"]
        tournaments.failed = false
        tournaments.stale = (c?.stale ?? true) && (u?.stale ?? true)
        tournaments.updated = .now
        // Fields for the next two months (teams, place).
        for event in events where !event.detailed && DayKey.today().days(to: event.startDay) <= 60 {
            await loadTournamentDetail(event.id)
        }
    }

    func loadTournamentDetail(_ id: String) async {
        guard var events = tournaments.events["upcoming"], let i = events.firstIndex(where: { $0.id == id }),
              case let .tournament(slug) = events[i].kind else { return }
        let ttl: TimeInterval = events[i].status == .live ? 600 : 6 * 3600
        // Parsed in the cache's task, off the main thread; only the detail is copied here.
        let base = events[i]
        guard let detail = try? await cache.get(ScheduleProvider.CS.tournamentURL(slug: slug), ttl: ttl,
                                                parse: { ScheduleProvider.CS.parseTournament($0, into: base) }) else { return }
        events = tournaments.events["upcoming"] ?? events
        guard let j = events.firstIndex(where: { $0.id == id }) else { return }
        events[j] = ScheduleProvider.CS.withDetail(detail.value, into: events[j])
        tournaments.events["upcoming"] = events
    }

    /// CS2 in the All scope: followed teams' matches stay rows; every other
    /// match folds into one row per tournament day.
    func collapseTournamentDays(_ matches: [ScheduleItem], followed: Set<String>) -> [ScheduleItem] {
        var rows: [ScheduleItem] = []
        var groups: [String: [ScheduleItem]] = [:]
        for match in matches {
            if match.teams.contains(where: { $0.id.map(followed.contains) ?? false }) {
                rows.append(match)
            } else {
                groups["\(match.competition ?? "")|\(match.day)", default: []].append(match)
            }
        }
        for (key, group) in groups {
            let sorted = Agenda.sorted(group)
            guard let first = sorted.first else { continue }
            let tournament = first.competition ?? "Tournament"
            let live = sorted.contains { $0.status == .live }
            let allFinal = sorted.allSatisfy { $0.status == .final || $0.status == .canceled }
            let count = sorted.count
            let names = sorted.prefix(2).map { m in m.teams.map(\.abbreviation).joined(separator: " v ") }
            let subtitle = ["\(count) match\(count == 1 ? "" : "es")", names.joined(separator: ", ") + (count > 2 ? " …" : "")]
                .filter { !$0.isEmpty }.joined(separator: " · ")
            rows.append(ScheduleItem(
                id: "cs-day-\(key)", sportRaw: Sport.esports.rawValue, league: "cs2", day: first.day, start: first.start,
                status: live ? .live : allFinal ? .final : .scheduled, title: tournament, subtitle: subtitle,
                ref: first.ref, children: sorted))
        }
        return rows
    }

    // MARK: League page (Upcoming)

    struct WeekAhead {
        let week: ScheduleCalendar.Week
        let items: [ScheduleItem]
    }

    /// NFL/college: the week after the current one, for a league page whose
    /// current week is nearly played out (Monday night leaves one game).
    private(set) var weekAhead: [String: WeekAhead] = [:]

    func loadWeekAhead(_ league: League, store: ScoreStore) async {
        let scope = ScheduleScope.league(league.id)
        guard case let .espn(path, true) = league.source else { return }
        var known = agendas[scope]?.calendar
        if known == nil { known = await calendar(path: path) }
        guard let calendar = known, let current = selectedWeek[scope] ?? calendar.week(at: .now),
              let next = calendar.week(after: current),
              let fetched = await board(path: path, league: league.id, sport: league.sport,
                                        window: .week(next.number, seasonType: next.seasonType), force: false) else { return }
        weekAhead[league.id] = WeekAhead(week: next, items: filter(fetched.value.items, league: league, store: store, showAll: false))
    }

    /// CS2: the followed teams' next matches, for the league page.
    private(set) var followedMatches: [ScheduleItem] = []

    func loadFollowedMatches(_ store: ScoreStore, force: Bool = false) async {
        let ids = followedCS(store).compactMap { Int($0.dropFirst(3)) }.sorted()
        guard !ids.isEmpty else {
            followedMatches = []
            return
        }
        let url = ScheduleProvider.CS.teamMatchesURL(teamIDs: ids)
        guard let fetched = await cached(url, ttl: force ? 0 : 10 * 60, cacheOnly: false,
                                         parse: { ScheduleProvider.CS.parseMatches($0) }) else { return }
        let now = Date()
        followedMatches = Agenda.sorted(fetched.value.filter {
            $0.status == .live || $0.status == .scheduled && $0.sortDate > now - 3 * 3600
        })
    }

    // MARK: Filters (the scores list's, so the two agree)

    func filter(_ items: [ScheduleItem], league: League, store: ScoreStore, showAll: Bool) -> [ScheduleItem] {
        if league.source == .ifsc { return items }
        if !showAll, store.isFilterOn(league) {
            let picks = store.picks(for: league)
            if !picks.isEmpty {
                return items.filter { item in item.isField || item.teams.contains { $0.id.map(picks.contains) ?? false } }
            }
        }
        if !showAll, league.id == "college-football", store.collegeTop25Only {
            return items.filter { item in item.teams.contains { $0.rank != nil || $0.id.map(isFollowed(store)) ?? false } }
        }
        return items
    }

    private func isFollowed(_ store: ScoreStore) -> (String) -> Bool {
        let ids = Set(store.followed.map(\.id))
        return { ids.contains($0) }
    }

    func followedCS(_ store: ScoreStore) -> Set<String> {
        Set(store.followed.map(\.id).filter { $0.hasPrefix("cs-") })
    }

    // MARK: Reading

    /// What `agenda` was built from: when none of it changes, neither does the agenda.
    struct AgendaKey: Equatable {
        let revision: Int
        let order: [String]
        let today: DayKey
        let window: DayKey?
        let week: String?
    }

    /// Day sections for a scope (upcoming and, separately, earlier). Built
    /// once per change: pages read this on every redraw (a hover, a toggle).
    func agenda(_ scope: ScheduleScope, store: ScoreStore) -> (earlier: [AgendaDay], upcoming: [AgendaDay]) {
        guard let state = agendas[scope] else { return ([], []) }
        let key = AgendaKey(revision: state.revision, order: store.enabledIDs, today: .today(),
                            window: scope.navigator == .weekStrip ? window(scope).from : nil, week: selectedWeek[scope]?.id)
        if let hit = built[scope], hit.key == key { return hit.value }
        let value = buildAgenda(scope, state: state, order: key.order, today: key.today)
        built[scope] = (key, value)
        return value
    }

    private func buildAgenda(_ scope: ScheduleScope, state: AgendaState, order: [String],
                             today: DayKey) -> (earlier: [AgendaDay], upcoming: [AgendaDay]) {
        let grouped = scope == .all
        switch scope.navigator {
        case .weekStrip:
            let days = Agenda.build(state.items, leagueOrder: order, grouped: grouped)
            let earlier = Agenda.build(state.earlier ?? [], leagueOrder: order, grouped: grouped)
            // A window moved into the past is all results; no separate Earlier.
            return (window(scope).from < today ? [] : earlier, days)
        case .weekPicker, .list, .monthBar, .none:
            var days = Agenda.build(state.items, leagueOrder: order, grouped: grouped)
            if let week = selectedWeek[scope], let byes = state.byes[week.id], !byes.isEmpty, !days.isEmpty {
                days[days.count - 1].byes = byes
            }
            let split = Agenda.split(days, today: today)
            return split
        }
    }

    // MARK: Seeding (render harness, previews)

    #if DEBUG
    func seed(_ scope: ScheduleScope, _ state: AgendaState) { publish(scope, state) }
    func seedClimbing(_ state: SeasonsState) { climbing = state }
    func seedTournaments(_ state: SeasonsState) { tournaments = state }
    #endif
}
