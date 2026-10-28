import AppKit
import Darwin
import Network
import Observation
import ServiceManagement
import os

struct FollowedTeam: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let logo: URL?
}

@MainActor
@Observable
final class ScoreStore {
    // MARK: Preferences

    var enabledIDs: [String] {
        didSet { defaults.set(enabledIDs, forKey: Keys.leagues); startPolling(); version += 1 }
    }
    var showFinished: Bool {
        didSet { defaults.set(showFinished, forKey: Keys.finished); version += 1 }
    }
    var showLiveCount: Bool {
        didSet { defaults.set(showLiveCount, forKey: Keys.liveCount) }
    }
    var scoreInMenuBar: Bool {
        didSet { defaults.set(scoreInMenuBar, forKey: Keys.scoreInMenuBar) }
    }
    var notifyFollowed: Bool {
        didSet {
            defaults.set(notifyFollowed, forKey: Keys.notify)
            if notifyFollowed { Notifier.shared.requestAuthorization() }
        }
    }
    var showCoStream: Bool {
        didSet { defaults.set(showCoStream, forKey: Keys.coStream); if !showCoStream { coStreamingIDs = [] } }
    }
    /// Twitch channel watched for CS2 co-streams.
    var coStreamer: String {
        didSet {
            defaults.set(coStreamer, forKey: Keys.coStreamer)
            coStreamerAvatar = nil
            coStreamingIDs = []
            confirmedCoStreams = []
            lastCoStreamCheck = nil
        }
    }

    /// The channel handle as typed, normalized ("ohnepixel").
    private var coStreamHandle: String { coStreamer.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
    /// Climbing disciplines shown ("speed", "lead", "boulder").
    var climbingDisciplines: Set<String> {
        didSet { defaults.set(Array(climbingDisciplines), forKey: Keys.climbingDisciplines); version += 1 }
    }

    /// Competitions as far as the disciplines shown go (the others don't appear at all).
    func tracked(_ events: [SeasonEvent]) -> [SeasonEvent] {
        events.compactMap { $0.tracking(climbingDisciplines) }
    }
    /// College football: only games with a ranked team (plus teams you follow).
    var collegeTop25Only: Bool {
        didSet { defaults.set(collegeTop25Only, forKey: Keys.collegeTop25); version += 1 }
    }
    var launchAtLogin: Bool {
        get { _ = loginItemRevision; return SMAppService.mainApp.status == .enabled }
        set {
            try? newValue ? SMAppService.mainApp.register() : SMAppService.mainApp.unregister()
            loginItemRevision += 1
        }
    }
    var loginItemNeedsApproval: Bool {
        _ = loginItemRevision
        return SMAppService.mainApp.status == .requiresApproval
    }
    /// SMAppService isn't observable; bump this so views re-read `launchAtLogin`.
    private var loginItemRevision = 0

    private(set) var followed: [FollowedTeam] {
        didSet { defaults.set(try? JSONEncoder().encode(followed), forKey: Keys.followed); version += 1 }
    }
    /// Leagues filtered down to picked teams (climbing: highlighted countries).
    private(set) var teamFilters: [String: Set<String>] {
        didSet { defaults.set(teamFilters.mapValues { Array($0) }, forKey: Keys.teamFilters); version += 1 }
    }
    /// Leagues where the filter is switched on (the picks are kept when it's off).
    private(set) var filteredLeagues: Set<String> {
        didSet { defaults.set(Array(filteredLeagues), forKey: Keys.filteredLeagues); version += 1 }
    }
    var liveFirst: Bool {
        didSet { defaults.set(liveFirst, forKey: Keys.liveFirst); version += 1 }
    }
    /// How much live pages celebrate big plays (Settings, Live Games). Default Full.
    var celebrationLevel: CelebrationLevel {
        didSet { defaults.set(celebrationLevel.rawValue, forKey: Keys.celebrationLevel) }
    }
    /// A soft sound when the open game scores. Off by default; MomentCenter
    /// reads the same key from UserDefaults when it plays.
    var celebrationSounds: Bool {
        didSet { defaults.set(celebrationSounds, forKey: Keys.celebrationSounds) }
    }
    /// The broadcast banner across the open game when a team scores. On by default.
    var scoringSlides: Bool {
        didSet { defaults.set(scoringSlides, forKey: Keys.scoringSlides) }
    }
    private(set) var collapsed: Set<String> {
        didSet { defaults.set(Array(collapsed), forKey: Keys.collapsed) }
    }
    /// The landing page's arrangement: the league list or the tile board.
    /// Same games either way, so it doesn't bump `version`.
    var landingView: LandingView {
        didSet {
            guard landingView != oldValue else { return }
            defaults.set(landingView.rawValue, forKey: Keys.landingView)
            // Tiles draw CS2's round race: fetch it now rather than at the next poll.
            if landingView == .tiles { Task { await updateCSLive() } }
        }
    }

    // MARK: State

    private(set) var results: [String: LeagueResult] = [:] {
        didSet {
            eventIndex = Dictionary(results.values.flatMap(\.events).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            leagueByEvent = Dictionary(results.flatMap { id, result in result.events.map { ($0.id, id) } },
                                       uniquingKeysWith: { a, _ in a })
            version += 1
        }
    }
    /// Bumped whenever anything the list is derived from changes; views reading
    /// derived lists depend on it, and the derivation is memoized against it.
    private var version = 0
    @ObservationIgnored private var eventIndex: [String: Event] = [:]
    @ObservationIgnored private var derivedCache: (version: Int, minute: Int, value: Derived)?
    /// Event ID → league ID, from the result each event came in. "My Teams"
    /// rewrites captions, so a tile's league can't come from the caption.
    @ObservationIgnored private(set) var leagueByEvent: [String: String] = [:]
    @ObservationIgnored private var boardCache: (version: Int, minute: Int, pinned: String?, lanes: Int, value: Board)?
    /// The game pages' lane scores ahead of the scoreboard's, for the list's
    /// rows and tiles only (`LaneScores`). A new reading bumps `laneRevision`,
    /// which only `sections` and `board` read: the live count, the menu bar
    /// and alerts keep to the polls, and never redraw for a lane.
    @ObservationIgnored private var lanes = LaneScores()
    private var laneRevision = 0
    @ObservationIgnored private var shownCache: (version: Int, minute: Int, lanes: Int, value: [Section])?
    /// Refreshes are numbered; one superseded by a newer refresh is dropped.
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var consecutiveFailures = 0
    @ObservationIgnored private let pathMonitor = NWPathMonitor()
    private(set) var lastUpdated: Date?
    /// When each live event's score last changed, for the row highlight.
    private(set) var scoreChanges: [String: ScoreChange] = [:]
    private(set) var pinnedID: String?
    /// Live CS2 matches the co-streamer is currently showing.
    private(set) var coStreamingIDs: Set<String> = []
    private(set) var coStreamerAvatar: URL?
    // Bookkeeping below is never shown, so it isn't observed: writing it
    // re-renders nothing.
    @ObservationIgnored private var confirmedCoStreams: Set<String> = []
    /// World Climbing's current or next YouTube stream.
    private(set) var climbingBroadcast: ClimbingBroadcast?
    @ObservationIgnored private var lastBroadcastCheck: Date?
    /// Climbing rows as the results service reports them, before the broadcast
    /// overlays live state and start times.
    @ObservationIgnored private var rawClimbing: [Event] = []
    @ObservationIgnored private var lastCoStreamCheck: Date?
    /// Followed games that just ended, so the final lingers briefly in the menu
    /// bar. Observed: the menu bar item reads it.
    private var recentFinals: [String: Date] = [:]

    @ObservationIgnored private let defaults = UserDefaults.standard
    @ObservationIgnored private var pollTask: Task<Void, Never>?

    private enum Keys {
        static let leagues = "enabledLeagues"
        static let finished = "showFinished"
        static let liveCount = "showLiveCount"
        static let scoreInMenuBar = "scoreInMenuBar"
        static let notify = "notifyFollowed"
        static let collegeTop25 = "collegeTop25Only"
        static let climbingDisciplines = "climbingDisciplines"
        static let followed = "followedTeams"
        static let collapsed = "collapsedSections"
        static let teamFilters = "teamFilters"
        static let filteredLeagues = "filteredLeagues"
        static let liveFirst = "liveLeaguesFirst"
        static let coStream = "showCoStream"
        static let coStreamer = "coStreamer"
        static let landingView = "landingView"
        static let celebrationLevel = CelebrationLevel.defaultsKey
        static let celebrationSounds = CelebrationSound.defaultsKey
        static let scoringSlides = "scoringSlides"
    }

    init() {
        defaults.register(defaults: [
            Keys.finished: true, Keys.liveCount: true, Keys.scoreInMenuBar: true,
            Keys.notify: true, Keys.coStream: true, Keys.coStreamer: "ohnepixel", Keys.scoringSlides: true,
        ])
        let saved = defaults.stringArray(forKey: Keys.leagues) ?? League.defaultIDs
        enabledIDs = saved.filter { League.with(id: $0) != nil }
        showFinished = defaults.bool(forKey: Keys.finished)
        showLiveCount = defaults.bool(forKey: Keys.liveCount)
        scoreInMenuBar = defaults.bool(forKey: Keys.scoreInMenuBar)
        notifyFollowed = defaults.bool(forKey: Keys.notify)
        collegeTop25Only = defaults.object(forKey: Keys.collegeTop25) as? Bool ?? true
        climbingDisciplines = Set(defaults.stringArray(forKey: Keys.climbingDisciplines) ?? ClimbingDiscipline.all)
        celebrationLevel = defaults.string(forKey: Keys.celebrationLevel).flatMap(CelebrationLevel.init(rawValue:)) ?? .full
        celebrationSounds = defaults.bool(forKey: Keys.celebrationSounds)
        scoringSlides = defaults.bool(forKey: Keys.scoringSlides)
        showCoStream = defaults.bool(forKey: Keys.coStream)
        coStreamer = defaults.string(forKey: Keys.coStreamer) ?? "ohnepixel"
        // Teams from sports that are no longer offered (hockey) drop out.
        followed = (defaults.data(forKey: Keys.followed).flatMap { try? JSONDecoder().decode([FollowedTeam].self, from: $0) } ?? [])
            .filter { !$0.id.hasPrefix("espn-hockey-") }
        collapsed = Set(defaults.stringArray(forKey: Keys.collapsed) ?? [])
        teamFilters = ((defaults.dictionary(forKey: Keys.teamFilters) as? [String: [String]]) ?? [:]).mapValues(Set.init)
        filteredLeagues = Set(defaults.stringArray(forKey: Keys.filteredLeagues) ?? [])
        liveFirst = defaults.bool(forKey: Keys.liveFirst)
        landingView = defaults.string(forKey: Keys.landingView).flatMap(LandingView.init(rawValue:)) ?? .list

        Notifier.shared.activate()
        // Logos read for the first time repaint their teams in place.
        TeamColors.shared.onChange = { [weak self] in self?.recolor() }
        pathMonitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in self?.networkBecameAvailable() }
        }
        pathMonitor.start(queue: DispatchQueue(label: "Scoreline.network"))
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.startPolling() }
        }
        startPolling()
    }

    // MARK: Leagues

    var enabledLeagues: [League] { enabledIDs.compactMap(League.with(id:)) }

    func isEnabled(_ league: League) -> Bool { enabledIDs.contains(league.id) }

    func setEnabled(_ league: League, _ on: Bool) {
        if on, !isEnabled(league) {
            enabledIDs.append(league.id)
        } else if !on {
            enabledIDs.removeAll { $0 == league.id }
            results[league.id] = nil
        }
    }

    // MARK: Teams

    func isFollowing(_ competitor: Competitor) -> Bool {
        competitor.id.map { id in followed.contains { $0.id == id } } ?? false
    }

    func toggleFollow(_ competitor: Competitor) {
        guard let id = competitor.id else { return }
        if let index = followed.firstIndex(where: { $0.id == id }) {
            followed.remove(at: index)
        } else {
            followed.append(FollowedTeam(id: id, name: competitor.name, logo: competitor.logo))
            if notifyFollowed && followed.count == 1 { Notifier.shared.requestAuthorization() }
        }
        refreshNextGames()
    }

    /// Each followed team's next game from its schedule, so My Teams can show
    /// it even when it's beyond the scoreboards' window (specs/schedules.md H6).
    @ObservationIgnored private var nextGamesCheckedAt: Date?

    func refreshNextGames(force: Bool = false) {
        nextGamesCheckedAt = .now
        let teams = followed
        Task {
            await ScheduleStore.shared.refreshNextGames(for: teams, force: force)
            version += 1
        }
    }

    func unfollow(_ team: FollowedTeam) {
        followed.removeAll { $0.id == team.id }
    }

    private func involvesFollowed(_ event: Event) -> Bool {
        event.competitors.contains(where: isFollowing)
    }

    // MARK: Menu bar

    func togglePin(_ event: Event) {
        pinnedID = pinnedID == event.id ? nil : event.id
    }

    /// The game whose score is shown in the menu bar: a pinned game, otherwise a
    /// followed team that's live or just finished.
    var menuBarEvent: Event? {
        let all = results.values.flatMap(\.events)
        if let pinnedID, let pinned = all.first(where: { $0.id == pinnedID }) { return pinned }
        guard scoreInMenuBar else { return nil }
        let mine = all.filter(involvesFollowed)
        return mine.first { $0.state == .live } ?? mine.first { recentFinals[$0.id] != nil }
    }

    // MARK: Presentation

    struct Section: Identifiable {
        let id: String
        let title: String
        let symbol: String
        let events: [Event]
        let failed: Bool
        var liveCount: Int { events.filter { $0.state == .live }.count }
    }

    /// The list as shown, plus what's derived alongside it. Memoized against
    /// `version` (any input changed) and the minute (time windows move).
    private struct Derived {
        let sections: [Section]
        let quietLeagues: [League]
        let liveCount: Int
    }

    private var derived: Derived {
        let minute = Int(Date().timeIntervalSince1970 / 60)
        if let cache = derivedCache, cache.version == version, cache.minute == minute { return cache.value }
        let value = Derived(sections: computeSections(now: .now), quietLeagues: computeQuietLeagues(now: .now),
                            liveCount: computeLiveCount())
        derivedCache = (version, minute, value)
        return value
    }

    /// The list as shown: each game with its page's newer lane score while
    /// the scoreboard trails it. Memoized like `derived`, plus the lanes.
    var sections: [Section] {
        let sections = derived.sections
        let revision = laneRevision
        guard !lanes.isEmpty else { return sections }
        let minute = Int(Date().timeIntervalSince1970 / 60)
        if let cache = shownCache, cache.version == version, cache.minute == minute, cache.lanes == revision { return cache.value }
        let now = Date()
        let value = sections.map { s in
            Section(id: s.id, title: s.title, symbol: s.symbol, events: lanes.shown(s.events, now: now), failed: s.failed)
        }
        shownCache = (version, minute, revision, value)
        return value
    }
    /// Enabled leagues that loaded fine but have nothing to show.
    var quietLeagues: [League] { derived.quietLeagues }
    /// Live games the user would see: their filtered leagues plus followed teams.
    var liveCount: Int { derived.liveCount }

    private func computeSections(now: Date) -> [Section] {
        var output: [Section] = []

        let mine = myTeamsEvents(now: now)
        if !mine.isEmpty {
            output.append(Section(id: "my-teams", title: "My Teams", symbol: "star.fill", events: mine, failed: false))
        }
        let mineIDs = Set(mine.map(\.id))

        let leagues = enabledLeagues.compactMap { league -> Section? in
            guard let result = results[league.id] else { return nil }
            let events = visible(filtered(result.events, league: league), now: now).filter { !mineIDs.contains($0.id) }
            guard !events.isEmpty || result.failed else { return nil }
            return Section(id: league.id, title: league.name, symbol: league.sport.symbol,
                           events: events, failed: result.failed && events.isEmpty)
        }
        guard liveFirst else { return output + leagues }
        // Optionally, leagues with something live float up; the rest keep the user's order.
        output += leagues.enumerated().sorted { a, b in
            let al = a.element.liveCount > 0, bl = b.element.liveCount > 0
            return al != bl ? al : a.offset < b.offset
        }.map(\.element)
        return output
    }

    /// Rows reachable with the keyboard, in on-screen order.
    var navigableEvents: [Event] {
        sections.filter { !collapsed.contains($0.id) }.flatMap(\.events)
    }

    private func computeQuietLeagues(now: Date) -> [League] {
        enabledLeagues.filter { league in
            guard let result = results[league.id], !result.failed else { return false }
            return visible(filtered(result.events, league: league), now: now).isEmpty
        }
    }

    private func computeLiveCount() -> Int {
        enabledLeagues.reduce(0) { total, league in
            let events = results[league.id]?.events ?? []
            let shown = Set(filtered(events, league: league).map(\.id))
            return total + events.filter { $0.state == .live && (shown.contains($0.id) || involvesFollowed($0)) }.count
        }
    }

    // MARK: Tiles

    /// The tile board: exactly the list's games, regrouped by state instead
    /// of league. Each game appears once, in the first tier it qualifies for.
    struct Board: Equatable {
        struct Tier: Identifiable, Equatable {
            enum Kind: String, CaseIterable, Sendable { case live, mine, next, final }
            let kind: Kind
            /// Ordered for the tier (see `ScoreStore.board(from:)`).
            let events: [Event]
            var id: String { "tiles.\(kind.rawValue)" }

            var title: String {
                switch kind {
                case .live: "Live"
                case .mine: "Your Teams"
                case .next: "Up Next"
                case .final: "Final"
                }
            }

            var symbol: String {
                switch kind {
                case .live: "dot.radiowaves.left.and.right"
                case .mine: "star.fill"
                case .next: "clock"
                case .final: "flag.checkered"
                }
            }
        }

        var tiers: [Tier] = []
        /// Event ID → league, for tile labels.
        var league: [String: League] = [:]

        var events: [Event] { tiers.flatMap(\.events) }

        /// Each game and its tier, in board order. Width never changes it, so
        /// it can drive position animations without firing during a resize.
        var signature: [String] { tiers.flatMap { tier in tier.events.map { "\($0.id)|\(tier.kind.rawValue)" } } }
    }

    /// Memoized like the list, plus the pin (it orders the Live tier).
    var board: Board {
        let minute = Int(Date().timeIntervalSince1970 / 60)
        if let cache = boardCache, cache.version == version, cache.minute == minute, cache.pinned == pinnedID,
           cache.lanes == laneRevision {
            return cache.value
        }
        let value = computeBoard(sections: sections)
        boardCache = (version, minute, pinnedID, laneRevision, value)
        return value
    }

    func computeBoard(sections: [Section]) -> Board {
        // A followed team's next game from its schedule isn't in any result: its league comes from the schedule.
        let scheduled = Dictionary(ScheduleStore.shared.nextGames.values.map { ($0.id, $0.league) }, uniquingKeysWith: { a, _ in a })
        let now = Date()
        // Each game's own copy, with its lane score as the list shows it.
        return Self.board(from: sections, source: { self.eventIndex[$0].map { self.lanes.shown($0, now: now) } },
                          leagueOf: { self.leagueByEvent[$0] ?? scheduled[$0] },
                          enabledIDs: enabledIDs, isFollowed: involvesFollowed, pinnedID: pinnedID)
    }

    /// Tiers from the list's sections (so the two views show the same games):
    /// - Live: followed → pinned → league order → start → ID.
    /// - Your Teams: not live, involves a followed team; upcoming by start, then results newest first.
    /// - Up Next: scheduled (including "starting soon"), by start then league order.
    /// - Final: newest first, then league order.
    /// `source` gives an event's own copy ("My Teams" rewrites captions to the league name).
    static func board(from sections: [Section], source: (String) -> Event? = { _ in nil }, leagueOf: (String) -> String?,
                      enabledIDs: [String], isFollowed: (Event) -> Bool, pinnedID: String?) -> Board {
        var seen = Set<String>()
        var events: [Event] = []
        for section in sections {
            for event in section.events where seen.insert(event.id).inserted { events.append(source(event.id) ?? event) }
        }
        let position = Dictionary(enabledIDs.enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
        func leagueRank(_ e: Event) -> Int { leagueOf(e.id).flatMap { position[$0] } ?? .max }
        let mine = Set(events.filter(isFollowed).map(\.id))

        let live = events.filter { $0.state == .live }.sorted { a, b in
            let af = mine.contains(a.id), bf = mine.contains(b.id)
            if af != bf { return af }
            let ap = a.id == pinnedID, bp = b.id == pinnedID
            if ap != bp { return ap }
            if leagueRank(a) != leagueRank(b) { return leagueRank(a) < leagueRank(b) }
            if a.start != b.start { return a.start < b.start }
            return a.id < b.id
        }
        let yours = events.filter { $0.state != .live && mine.contains($0.id) }.sorted(by: Self.order)
        let next = events.filter { $0.state == .scheduled && !mine.contains($0.id) }.sorted { a, b in
            if a.start != b.start { return a.start < b.start }
            if leagueRank(a) != leagueRank(b) { return leagueRank(a) < leagueRank(b) }
            return a.id < b.id
        }
        let finals = events.filter { $0.state == .final && !mine.contains($0.id) }.sorted { a, b in
            if a.start != b.start { return a.start > b.start }
            if leagueRank(a) != leagueRank(b) { return leagueRank(a) < leagueRank(b) }
            return a.id < b.id
        }
        let tiers = [(Board.Tier.Kind.live, live), (.mine, yours), (.next, next), (.final, finals)]
            .filter { !$0.1.isEmpty }
            .map { Board.Tier(kind: $0.0, events: $0.1) }
        let league = Dictionary(events.compactMap { e in leagueOf(e.id).flatMap(League.with(id:)).map { (e.id, $0) } },
                                uniquingKeysWith: { a, _ in a })
        return Board(tiers: tiers, league: league)
    }

    // MARK: Ordering & filters

    /// Moves a league to just before another in the user's order.
    func move(_ id: String, before target: String) {
        guard id != target, let from = enabledIDs.firstIndex(of: id) else { return }
        var ids = enabledIDs
        ids.remove(at: from)
        let to = ids.firstIndex(of: target) ?? ids.endIndex
        ids.insert(id, at: to)
        enabledIDs = ids
    }

    func move(_ id: String, by offset: Int) {
        guard let from = enabledIDs.firstIndex(of: id) else { return }
        let to = min(max(from + offset, 0), enabledIDs.count - 1)
        guard to != from else { return }
        var ids = enabledIDs
        ids.swapAt(from, to)
        enabledIDs = ids
    }

    func isFilterOn(_ league: League) -> Bool { filteredLeagues.contains(league.id) }

    func setFilterOn(_ league: League, _ on: Bool) {
        if on { filteredLeagues.insert(league.id) } else { filteredLeagues.remove(league.id) }
        if league.source == .ifsc { startPolling() }
    }

    func picks(for league: League) -> Set<String> { teamFilters[league.id] ?? [] }

    func togglePick(_ teamID: String, in league: League) {
        var set = teamFilters[league.id] ?? []
        if set.contains(teamID) { set.remove(teamID) } else { set.insert(teamID) }
        teamFilters[league.id] = set
        // Picking a team implies wanting the filter.
        if !set.isEmpty { filteredLeagues.insert(league.id) }
        if league.source == .ifsc { startPolling() }
    }

    /// Climbing countries whose athletes get called out (IOC codes).
    var climbingCountries: [String] {
        guard filteredLeagues.contains("ifsc") else { return [] }
        return (teamFilters["ifsc"] ?? []).map { $0.replacingOccurrences(of: "country-", with: "") }.sorted()
    }

    /// Head-to-head events limited to the picked teams. Climbing rounds aren't
    /// filtered by country (countries highlight athletes instead), only by
    /// the disciplines shown.
    private func filtered(_ events: [Event], league: League) -> [Event] {
        if league.source == .ifsc {
            return events.filter { ClimbingDiscipline.of($0).map { !climbingDisciplines.isDisjoint(with: $0) } ?? true }
        }
        if filteredLeagues.contains(league.id), league.source != .ifsc,
           let picks = teamFilters[league.id], !picks.isEmpty {
            return events.filter { e in e.competitors.contains { $0.id.map(picks.contains) ?? false } }
        }
        // College: the Top 25's games and your teams', not all sixty-odd FBS games.
        if league.id == "college-football", collegeTop25Only {
            return events.filter { e in e.competitors.contains { $0.rank != nil || isFollowing($0) } }
        }
        return events
    }

    var allFailed: Bool {
        !enabledIDs.isEmpty && enabledIDs.allSatisfy { results[$0]?.failed == true }
    }

    func toggleCollapsed(_ section: Section) {
        toggleCollapsed(id: section.id)
    }

    /// Sections and tile tiers ("tiles.live") share one collapsed set.
    func toggleCollapsed(id: String) {
        if collapsed.contains(id) { collapsed.remove(id) } else { collapsed.insert(id) }
    }

    /// Each followed team's live game, latest result (past day) and next fixture (next week).
    private func myTeamsEvents(now: Date) -> [Event] {
        guard !followed.isEmpty else { return [] }
        var picked: [String: Event] = [:]
        for league in enabledLeagues {
            let events = (results[league.id]?.events ?? []).filter(involvesFollowed)
            for team in followed {
                let theirs = events.filter { $0.competitors.contains { $0.id == team.id } }
                let live = theirs.filter { $0.state == .live }
                let last = theirs.filter { $0.state == .final && $0.start > now - 24 * 3600 }.max { $0.start < $1.start }
                let next = theirs.filter { $0.state == .scheduled && $0.start < now + 7 * 86400 }.min { $0.start < $1.start }
                for e in live + [last, next].compactMap({ $0 }) where picked[e.id] == nil {
                    picked[e.id] = e.with(caption: .some(e.caption ?? league.name))
                }
            }
        }
        // A team with nothing coming up on the scoreboards (a quiet week, a cup
        // tie in a league you don't show): its next game from its schedule,
        // when that's within three weeks.
        let schedule = ScheduleStore.shared.nextGames
        for team in followed {
            let covered = picked.values.contains { e in e.state != .final && e.competitors.contains { $0.id == team.id } }
            guard !covered, let item = schedule[team.id], item.sortDate < now + 21 * 86400, picked[item.id] == nil else { continue }
            let event = current(item.event())
            let league = League.with(id: item.league)?.name
            picked[item.id] = event.with(caption: .some(event.caption ?? league))
        }
        return Array(picked.values).sorted(by: Self.order)
    }

    private func visible(_ events: [Event], now: Date) -> [Event] {
        let hour: TimeInterval = 3600
        var shown = events.filter { e in
            // Climbing rounds belong to a multi-day competition the provider has
            // already scoped to "underway"; its start date says nothing about recency.
            if case .field = e.content { return true }
            return switch e.state {
            case .live: true
            case .final: showFinished && e.start > now - 18 * hour
            case .scheduled: e.start > now - 6 * hour && e.start < now + 36 * hour
            }
        }
        // Nothing in the window: show the next fixture so the league isn't silent.
        if shown.isEmpty, let next = events.filter({ $0.state == .scheduled && $0.start > now }).min(by: { $0.start < $1.start }) {
            shown = events.filter { $0.state == .scheduled && $0.start == next.start }
        }
        shown.sort(by: Self.order)
        // Keep the menu glanceable: every live game, then a few on either side of now.
        let live = shown.filter { $0.state == .live }
        let upcoming = shown.filter { $0.state == .scheduled }.prefix(Self.perStateLimit)
        let finals = shown.filter { $0.state == .final }.prefix(Self.perStateLimit)
        return live + upcoming + finals
    }

    private static let perStateLimit = 3

    private static func order(_ a: Event, _ b: Event) -> Bool {
        if a.state != b.state { return a.state < b.state }
        return a.state == .final ? a.start > b.start : a.start < b.start
    }

    // MARK: Refreshing

    /// (Re)starts the refresh loop with an immediate refresh. Failures retry
    /// sooner (5, 15, 30, 60s) instead of waiting out the normal interval.
    func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let ok = await self.refresh()
                let delay = ok ? self.pollInterval : self.retryDelay
                try? await Task.sleep(for: .seconds(delay))
            }
        }
    }

    private var retryDelay: TimeInterval {
        [5, 15, 30, 60][min(max(consecutiveFailures - 1, 0), 3)]
    }

    /// Back online (after sleep, or Wi-Fi returning): refresh right away if
    /// the last attempt failed or the data has gone stale.
    private func networkBecameAvailable() {
        let stale = lastUpdated.map { Date().timeIntervalSince($0) > 60 } ?? true
        if consecutiveFailures > 0 || stale { startPolling() }
    }

    /// Called when the menu opens: refresh only if the data is getting stale.
    func refreshIfStale() {
        guard let last = lastUpdated else { return }
        if Date().timeIntervalSince(last) > 30 { startPolling() }
    }

    private var pollInterval: TimeInterval {
        if liveCount > 0 { return 30 }
        let now = Date()
        // Starting within 15 minutes. Events past their listed start (climbing
        // rounds without a time, late CS matches) don't count.
        let startingSoon = results.values.contains { result in
            result.events.contains { $0.state == .scheduled && $0.start < now + 15 * 60 && $0.start > now - 3600 }
        }
        return startingSoon ? 60 : 300
    }

    /// Returns false when every league failed (offline). A refresh superseded
    /// by a newer one (a setting changed mid-flight) is dropped, not counted
    /// as a failure.
    @discardableResult
    func refresh() async -> Bool {
        generation += 1
        let current = generation

        let leagues = enabledLeagues
        let countries = climbingCountries
        let fetched = await withTaskGroup(of: (String, [Event]?).self) { group in
            for league in leagues {
                group.addTask { (league.id, try? await Providers.events(for: league, countries: countries)) }
            }
            var fetched: [String: [Event]?] = [:]
            for await (id, events) in group { fetched[id] = events }
            return fetched
        }
        guard current == generation, !Task.isCancelled else { return true }

        let now = Date()
        let anySucceeded = fetched.values.contains { $0 != nil } || fetched.isEmpty
        consecutiveFailures = anySucceeded ? 0 : consecutiveFailures + 1
        if !anySucceeded { Log.poll.error("Refresh failed for every league (attempt \(self.consecutiveFailures))") }
        for (id, fresh) in fetched where enabledIDs.contains(id) {
            guard var events = fresh else {
                // Keep the last good data on a transient failure.
                results[id, default: LeagueResult()].failed = true
                continue
            }
            if let previous = results[id]?.events {
                let old = Dictionary(previous.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
                for index in events.indices {
                    guard let before = old[events[index].id] else { continue }
                    // A clock that moved since the last reading is running.
                    if let clock = events[index].clock {
                        events[index].clock = clock.reading(after: before.clock)
                    }
                    // NBA: a rebound or timeout doesn't replace the last line worth reading.
                    if events[index].liveLineRoutine, before.state == .live, let line = before.liveLine {
                        events[index].liveLine = line
                        events[index].liveLineRoutine = before.liveLineRoutine
                    }
                    // CS2's round score comes from a second request (after this
                    // refresh): keep the last one meanwhile, so a tile's race
                    // doesn't blink out and back on every poll.
                    if case .counterStrike? = before.snapshot, events[index].snapshot == nil, events[index].state == .live,
                       landingView == .tiles || involvesFollowed(events[index]) || events[index].id == pinnedID {
                        events[index].snapshot = before.snapshot
                    }
                    detectChanges(from: before, to: events[index], now: now)
                }
            }
            if id == "ifsc" { rawClimbing = events }
            let result = LeagueResult(events: id == "ifsc" ? applyBroadcast(events) : TeamColors.shared.apply(events), failed: false)
            // A poll that changed nothing writes nothing: every write re-derives
            // the lists and re-renders the pages that read them.
            if results[id] != result { results[id] = result }
        }

        // Expire transient state.
        scoreChanges = scoreChanges.filter { now.timeIntervalSince($0.value.date) < 10 }
        recentFinals = recentFinals.filter { now.timeIntervalSince($0.value) < 10 * 60 }
        if let pinnedID, let pinned = results.values.flatMap(\.events).first(where: { $0.id == pinnedID }),
           pinned.state == .final, pinned.start < now - 4 * 3600 {
            self.pinnedID = nil
        }
        lastUpdated = now
        if !followed.isEmpty, nextGamesCheckedAt.map({ now.timeIntervalSince($0) > 6 * 3600 }) ?? true { refreshNextGames() }
        await updateCSLive()
        await updateCoStream(now: now)
        await updateBroadcast(now: now)
        // Parsing large responses (ESPN JSON, the ~1 MB YouTube page) leaves freed
        // pages the allocator would otherwise hold on to between refreshes.
        malloc_zone_pressure_relief(nil, 0)
        return anySucceeded
    }

    // MARK: CS2 live rounds

    /// At most this many live CS2 matches get round data for tiles.
    static let tileCSLimit = 4

    /// Live CS2 matches whose round score is fetched: the ones the user
    /// follows or pinned (their list row shows it), plus, while Tiles is the
    /// landing view, the first few on the board (their tiles race to 13).
    private func csLiveWatch() -> (listed: Set<String>, all: Set<String>) {
        let live = (results["cs2"]?.events ?? []).filter { $0.state == .live }
        let listed = Set(live.filter { involvesFollowed($0) || $0.id == pinnedID }.map(\.id))
        guard landingView == .tiles else { return (listed, listed) }
        let onBoard = board.tiers.first { $0.kind == .live }?.events
            .filter { leagueByEvent[$0.id] == "cs2" }.prefix(Self.tileCSLimit).map(\.id) ?? []
        return (listed, listed.union(onBoard))
    }

    /// Round scores from bo3.gg's live feed: one small request per watched
    /// match. Rows that show it get the "Mirage 5–8" line as before; every
    /// watched match keeps the structured score for its tile.
    private func updateCSLive() async {
        let (listed, watched) = csLiveWatch()
        guard let events = results["cs2"]?.events, !watched.isEmpty else { return }
        let targets = events.filter { $0.state == .live && watched.contains($0.id) }
        guard !targets.isEmpty else { return }
        let states = await withTaskGroup(of: (String, GameDetail.CSLive?).self) { group in
            for event in targets { group.addTask { (event.id, await CSDetail.liveState(for: event)) } }
            var states: [String: GameDetail.CSLive?] = [:]
            for await (id, state) in group { states[id] = state }
            return states
        }
        guard var current = results["cs2"]?.events else { return }
        var changed = false
        for index in current.indices {
            let id = current[index].id
            guard let fetched = states[id], current[index].state == .live else { continue }
            if let live = fetched, listed.contains(id), !live.mapEnded {
                current[index] = current[index].with(detail: .some(CSDetail.line(live)))
                changed = true
            }
            // Not covered live (or the request failed): no race, rather than a stale one.
            let snapshot = fetched.map(LiveSnapshot.counterStrike)
            if current[index].snapshot != snapshot {
                current[index].snapshot = snapshot
                changed = true
            }
        }
        if changed { results["cs2"]?.events = current }
    }

    // MARK: Climbing broadcast

    /// The stream for a climbing row, if World Climbing's current/next stream covers it.
    func broadcast(for event: Event) -> ClimbingBroadcast? {
        guard case let .climbing(_, category, _, round, eventName, _)? = event.ref,
              let b = climbingBroadcast, b.covers(category: category, round: round, eventName: eventName) else { return nil }
        return b
    }

    /// The page is ~1 MB, so it's checked every 10 minutes normally, every
    /// minute around a scheduled start, and every 2 minutes while live.
    private func updateBroadcast(now: Date) async {
        // The page is ~1.26 MB: only look while a competition is underway or
        // starts within two days (the season has a dozen events).
        let competitionNear = rawClimbing.contains { $0.state != .final && $0.start < now + 2 * 86400 }
        guard enabledIDs.contains("ifsc"), competitionNear else { climbingBroadcast = nil; return }
        let interval: TimeInterval
        if climbingBroadcast?.isLive == true {
            interval = 120
        } else if let start = climbingBroadcast?.start, abs(start.timeIntervalSince(now)) < 15 * 60 {
            interval = 60
        } else {
            interval = 600
        }
        if let last = lastBroadcastCheck, now.timeIntervalSince(last) < interval { return }
        // A failed fetch keeps what we knew; only a successful answer changes it.
        let fetched: ClimbingBroadcast?
        do {
            fetched = try await ClimbingBroadcast.fetch()
        } catch {
            Log.network.notice("World Climbing live page unavailable: \(error.localizedDescription)")
            return
        }
        lastBroadcastCheck = now
        guard fetched != climbingBroadcast else { return }
        climbingBroadcast = fetched
        if results["ifsc"] != nil { results["ifsc"]?.events = applyBroadcast(rawClimbing) }
    }

    /// A live stream marks its rounds live (IFSC's own flags lag); an upcoming
    /// one gives them a real start time to count down to.
    /// Newly read logo colors, applied to what's already on screen (one change, not one per league).
    private func recolor() {
        var recolored = results
        for (id, result) in results where id != "ifsc" {
            recolored[id]?.events = TeamColors.shared.apply(result.events)
        }
        if recolored.mapValues(\.events) != results.mapValues(\.events) { results = recolored }
    }

    private func applyBroadcast(_ events: [Event]) -> [Event] {
        events.map { event in
            guard event.state != .final, let b = broadcast(for: event) else { return event }
            // IFSC opens a round hours before the first climber. Until someone
            // has finished (no leader yet), the stream's start is the real one.
            if !b.isLive, let start = b.start, start > .now + 15 * 60, event.state == .live,
               case let .field(title, summary) = event.content, !summary.contains("Leader"),
               case let .climbing(_, _, _, round, _, _)? = event.ref {
                return event.with(state: .scheduled, start: start,
                                  content: .field(title: title, summary: "\(round ?? "Next round") next"), detail: .some(nil))
            }
            if b.isLive {
                guard case let .field(title, _) = event.content, case let .climbing(_, _, _, round, _, _)? = event.ref else { return event }
                return event.with(state: .live, content: .field(title: title, summary: round ?? "Live"), detail: .some("Live"))
            }
            if let start = b.start, start > .now - 3600, event.state == .scheduled {
                return event.with(start: start)
            }
            return event
        }
    }

    // MARK: Soccer feeds

    /// Play-by-play feeds for the last few matches opened, so going to the
    /// table and back doesn't download ~1,400 plays again.
    @ObservationIgnored private var soccerFeeds: [String: SoccerFeed] = [:]
    @ObservationIgnored private var soccerFeedOrder: [String] = []

    func soccerFeed(for eventID: String) -> SoccerFeed {
        if let feed = soccerFeeds[eventID] {
            soccerFeedOrder.removeAll { $0 == eventID }
            soccerFeedOrder.append(eventID)
            return feed
        }
        let feed = SoccerFeed()
        soccerFeeds[eventID] = feed
        soccerFeedOrder.append(eventID)
        if soccerFeedOrder.count > 4 { soccerFeeds[soccerFeedOrder.removeFirst()] = nil }
        return feed
    }

    // MARK: Standings

    @ObservationIgnored private var standingsCache: [String: (rows: [StandingsRow], at: Date)] = [:]

    /// League table, cached for 10 minutes (it only changes when games end;
    /// live movement is projected from live scores on top of it).
    func standings(for league: League) async -> [StandingsRow] {
        if let cached = standingsCache[league.id], Date().timeIntervalSince(cached.at) < 600 { return cached.rows }
        guard let rows = try? await Standings.fetch(league: league), !rows.isEmpty else {
            return standingsCache[league.id]?.rows ?? []
        }
        standingsCache[league.id] = (rows, .now)
        return rows
    }

    func liveEvents(in league: League) -> [Event] {
        results[league.id]?.events.filter { $0.state == .live } ?? []
    }

    // MARK: Co-streams

    var coStreamerName: String { coStreamer.lowercased() == "ohnepixel" ? "ohnePixel" : coStreamer }
    var coStreamerURL: URL? { coStreamHandle.isEmpty ? nil : URL(string: "https://www.twitch.tv/\(coStreamHandle)") }

    /// Twitch status is checked at most every two minutes, and only while a CS2 match is live.
    private func updateCoStream(now: Date) async {
        let live = (results["cs2"]?.events ?? []).filter { $0.state == .live }
        guard showCoStream, !coStreamHandle.isEmpty, !live.isEmpty else {
            coStreamingIDs = []
            return
        }
        let liveIDs = Set(live.map(\.id))
        confirmedCoStreams.formIntersection(liveIDs)
        if let last = lastCoStreamCheck, now.timeIntervalSince(last) < 120 {
            coStreamingIDs = coStreamingIDs.intersection(liveIDs).union(confirmedCoStreams)
            return
        }
        lastCoStreamCheck = now
        // The channel can change while these are in flight; a stale answer is dropped.
        let handle = coStreamHandle
        if coStreamerAvatar == nil {
            let avatar = await CoStream.avatar(of: handle)
            if handle == coStreamHandle { coStreamerAvatar = avatar }
        }
        guard let status = await CoStream.status(of: handle), handle == coStreamHandle else { return }
        coStreamingIDs = CoStream.matches(status, in: live).union(confirmedCoStreams)
    }

    /// Called by the detail page when bo3.gg lists the channel among a match's streams.
    func noteStreams(_ streams: [GameDetail.Stream], for event: Event) {
        let handle = coStreamHandle
        guard showCoStream, event.state == .live, !handle.isEmpty else { return }
        // Exact channel on Twitch: "99damage" must not match "99damage2".
        let listed = streams.contains { stream in
            (stream.url.host()?.hasSuffix("twitch.tv") ?? false)
                && stream.url.pathComponents.dropFirst().first?.lowercased() == handle
        }
        if listed {
            confirmedCoStreams.insert(event.id)
            coStreamingIDs.insert(event.id)
        }
    }

    /// An event on the scoreboards by ID (a clicked notification's game), or
    /// nil once it has left them.
    func event(id: String) -> Event? { eventIndex[id] }

    /// The freshest copy of an event (the detail page holds an older snapshot).
    func current(_ event: Event) -> Event {
        _ = version  // observe changes to the underlying results
        return eventIndex[event.id] ?? event
    }

    /// A game page's lane score for its event, top first (DetailView's
    /// `HeaderSync`): the list's row and tile show it until the scoreboard
    /// catches up. Only a new reading redraws the list, and only that game's
    /// row and tile change (the others are equal and skip).
    func publishLaneScore(_ eventID: String, top: String, bottom: String) {
        if lanes.publish(eventID, top: top, bottom: bottom, now: .now) { laneRevision += 1 }
    }

    private func detectChanges(from before: Event, to after: Event, now: Date) {
        let scoreChanged = before.competitors.map(\.score) != after.competitors.map(\.score)
        if after.state == .live && before.state == .live && scoreChanged {
            scoreChanges[after.id] = ScoreChange(date: now, scorers: ScoreChange.scorers(from: before, to: after))
        }
        // A finished game changes its teams' records, logs and stats: their pages refetch next visit.
        if before.state != .final && after.state == .final {
            after.competitors.compactMap(\.id).forEach { ProfileStore.shared.invalidate(teamID: $0) }
        }
        guard involvesFollowed(after) || after.id == pinnedID else { return }
        if before.state == .live && after.state == .final {
            recentFinals[after.id] = now
            // That team's next game is news now.
            if involvesFollowed(after) { refreshNextGames(force: true) }
        }
        if notifyFollowed && involvesFollowed(after) {
            Notifier.shared.notifyChanges(from: before, to: after)
        }
    }
}



/// A live score that just moved: when, and which side's number rose (the
/// list row's scorer dot, the tile's digit pop). A correction downward has
/// no scorer.
struct ScoreChange: Equatable {
    let date: Date
    /// Competitor keys (`Competitor.key`).
    let scorers: Set<String>

    static func scorers(from before: Event, to after: Event) -> Set<String> {
        let old = Dictionary(before.competitors.map { ($0.key, $0.score) }, uniquingKeysWith: { a, _ in a })
        return Set(after.competitors.compactMap { c in
            guard let now = c.score.flatMap(Double.init), let was = old[c.key].flatMap({ $0 }).flatMap(Double.init),
                  now > was else { return nil }
            return c.key
        })
    }
}

/// The game pages' lane scores, for the scores list (the live check: the
/// list trailed the game's hero by a minute or two). A game page whose fast
/// lane reads a score ahead of the scoreboard's publishes it here; the list
/// shows it on that game's row and tile until the scoreboard catches up.
/// Only what's shown: alerts and the menu bar keep to the scoreboard's own
/// polls (web/src/state/laneScores.ts).
struct LaneScores {
    /// A lane's score for an event, top first, and when it was read.
    struct Reading: Equatable {
        let top: String
        let bottom: String
        let at: Date
    }

    /// How long a lane's score stands in for the scoreboard's before the scoreboard is trusted again.
    static let lapse: TimeInterval = 3 * 60

    private var readings: [String: Reading] = [:]

    var isEmpty: Bool { readings.isEmpty }

    /// A page's reading for its event; false when it's the one already held
    /// (nothing to redraw). A page closing leaves its last reading to stand
    /// until the scoreboard catches up (or it lapses).
    mutating func publish(_ eventID: String, top: String, bottom: String, now: Date) -> Bool {
        if let was = readings[eventID], was.top == top, was.bottom == bottom { return false }
        readings = readings.filter { now.timeIntervalSince($0.value.at) <= Self.lapse }
        readings[eventID] = Reading(top: top, bottom: bottom, at: now)
        return true
    }

    /// The event with its page's lane score while that's ahead of the
    /// scoreboard's (both sides at least as high, one higher), for a live
    /// game, within `lapse`; the event itself otherwise. (pure; tested)
    static func withLaneScore(_ event: Event, _ lane: Reading?, now: Date) -> Event {
        func number(_ score: String?) -> Int? { score.flatMap { Int($0.trimmingCharacters(in: .whitespaces)) } }
        guard let lane, event.state == .live, case let .match(top, bottom) = event.content,
              now.timeIntervalSince(lane.at) <= lapse, let laneTop = number(lane.top), let laneBottom = number(lane.bottom) else { return event }
        if let wasTop = number(top.score), let wasBottom = number(bottom.score),
           laneTop < wasTop || laneBottom < wasBottom || (laneTop == wasTop && laneBottom == wasBottom) {
            return event
        }
        var shownTop = top, shownBottom = bottom
        shownTop.score = lane.top
        shownBottom.score = lane.bottom
        return event.with(content: .match(top: shownTop, bottom: shownBottom))
    }

    /// An event as the list shows it.
    func shown(_ event: Event, now: Date) -> Event { Self.withLaneScore(event, readings[event.id], now: now) }

    /// The events as the list shows them. The same reading gives an equal
    /// copy, so an equatable row or tile redraws only when its score does.
    func shown(_ events: [Event], now: Date) -> [Event] { events.map { shown($0, now: now) } }
}

/// Climbing's three disciplines, as the settings toggle them.
enum ClimbingDiscipline {
    static let all = ["boulder", "lead", "speed"]

    /// The disciplines a round belongs to, from its category ("Lead Men",
    /// "Boulder & Lead Women"); nil when it can't tell.
    static func of(_ event: Event) -> Set<String>? {
        guard case let .climbing(_, category, _, _, _, _)? = event.ref else { return nil }
        return of(category)
    }

    /// The disciplines a category or round name mentions ("Boulder & Lead Women"); nil for none.
    static func of(_ name: String) -> Set<String>? {
        let found = Set(all.filter { name.lowercased().contains($0) })
        return found.isEmpty ? nil : found
    }
}

extension SeasonEvent {
    /// A climbing competition cut to the disciplines you follow: their lanes,
    /// categories and rounds only, or nil when it has none of them. One that
    /// doesn't list its disciplines (a CS2 event, a bare calendar entry) stays as it is.
    func tracking(_ disciplines: Set<String>) -> SeasonEvent? {
        guard case .climbing = kind, !lanes.isEmpty else { return self }
        let kept = lanes.filter(disciplines.contains)
        guard !kept.isEmpty else { return nil }
        var event = self
        event.lanes = kept
        event.categories = categories.filter { ClimbingDiscipline.of($0.name).map { !$0.isDisjoint(with: disciplines) } ?? true }
        event.rounds = rounds.filter { ClimbingDiscipline.of($0.discipline).map { !$0.isDisjoint(with: disciplines) } ?? true }
        return event
    }
}
