import Foundation
import Network
import Observation

/// Loads and holds team and player pages. One observable state object per
/// team and per player, so a page re-renders only when its own data changes,
/// not when another profile loads. Every request goes through `ProfileCache`;
/// parsing runs off the main actor; each part of a page fills in as it lands
/// and fails on its own (the page shows the rest plus a footnote).
@MainActor
@Observable
final class ProfileStore {
    static let shared = ProfileStore()

    @ObservationIgnored let cache: ProfileCache
    @ObservationIgnored private var teams: [String: TeamState] = [:]
    @ObservationIgnored private var players: [String: PlayerState] = [:]
    /// League top 25 by category (rank context for NBA and soccer), by ESPN path.
    @ObservationIgnored private var leagueLeaders: [String: [String: [String]]] = [:]
    /// Per-page choices that should survive Back (depth chart, expansions, MLB category).
    var session: [String: PageSession] = [:]

    struct PageSession: Equatable {
        var depthChart = false
        var allGames = false
        var pitching = false
        var expanded: Set<String> = []
    }

    init(cache: ProfileCache = .shared) {
        self.cache = cache
    }

    func state(for ref: Profile.TeamRef) -> TeamState {
        if let state = teams[ref.id] { return state }
        let state = TeamState(ref: ref)
        teams[ref.id] = state
        return state
    }

    func state(for ref: Profile.PlayerRef) -> PlayerState {
        if let state = players[ref.key] { return state }
        let state = PlayerState(ref: ref)
        players[ref.key] = state
        return state
    }

    // MARK: TTLs

    enum TTL {
        static let header: TimeInterval = 30 * 60
        static let roster: TimeInterval = 6 * 3600
        static let leaders: TimeInterval = 3600
        static let athlete: TimeInterval = 3600
        static let career: TimeInterval = 24 * 3600
        static let leagueLeaders: TimeInterval = 6 * 3600
        static let forever: TimeInterval = 30 * 24 * 3600
        static let short: TimeInterval = 10 * 60
    }

    // MARK: Teams

    enum TeamPiece: Sendable {
        case header(Profile.TeamHeader)
        case roster(ESPNProfiles.RosterData)
        case depthChart(Profile.DepthChart)
        case coreDepth([String: [String]])
        case leaders([String: [(id: String, value: String)]])
        case stats([Profile.TeamStat])
        case transactions([Profile.Transaction])
        case counterStrike(BO3Profiles.TeamData)
        case career([Profile.StatTile])
        case next(Profile.GameRef)
        case failed(TeamState.Part)
    }

    func load(_ ref: Profile.TeamRef, force: Bool = false) async {
        let state = state(for: ref)
        guard !state.loading else { return }
        if !force, let updated = state.updated, Date().timeIntervalSince(updated) < 60 { return }
        state.loading = true
        defer {
            state.loading = false
            state.loaded = true
            state.updated = .now
        }
        let cache = self.cache
        switch ref.source {
        case let .espn(sport, path, team)?:
            await withTaskGroup(of: [TeamPiece].self) { group in
                group.addTask { await Self.espnTeam(cache: cache, ref: ref, sport: sport, path: path, team: team, force: force) }
                if let path {
                    group.addTask { await Self.espnRosterSide(cache: cache, ref: ref, sport: sport, path: path, team: team, force: force) }
                }
                for await pieces in group { pieces.forEach { state.apply($0) } }
            }
            // Soccer: FotMob's photos, injuries and coach, after the page has ESPN's (never blocks it).
            if sport == .soccer {
                let name = state.header?.name ?? ref.name, league = state.header?.leagueSlug ?? ref.league
                Task { [weak state] in
                    guard let squad = await Self.fotMobSquad(cache: cache, team: name, league: league) else { return }
                    state?.applyFotMob(squad)
                }
            }
        case let .counterStrike(id)?:
            for piece in await Self.counterStrikeTeam(cache: cache, ref: ref, id: id, force: force) { state.apply(piece) }
        case nil:
            state.apply(.failed(.header))
        }
    }

    /// The team header; for a soccer team whose league isn't known, then the
    /// league-dependent parts (one serial step).
    nonisolated private static func espnTeam(cache: ProfileCache, ref: Profile.TeamRef, sport: Sport, path: String?,
                                             team: String, force: Bool) async -> [TeamPiece] {
        guard let url = ESPNProfiles.teamURL(path: path, team: team),
              let data = try? await cache.data(url, ttl: TTL.header, force: force),
              let header = ESPNProfiles.header(data, sport: sport, path: path, teamID: team)
        else { return [.failed(.header)] }
        var pieces: [TeamPiece] = [.header(header)]
        if path == nil, let league = header.leagueSlug, let resolved = Profile.TeamRef.domesticSoccerPath(league) {
            pieces += await espnRosterSide(cache: cache, ref: ref, sport: sport, path: resolved, team: team, force: force)
        } else if path == nil {
            pieces.append(.failed(.roster))
        }
        return pieces
    }

    /// Roster, depth chart, leaders, stats and transactions, in parallel.
    nonisolated private static func espnRosterSide(cache: ProfileCache, ref: Profile.TeamRef, sport: Sport, path: String,
                                                   team: String, force: Bool) async -> [TeamPiece] {
        await withTaskGroup(of: TeamPiece?.self) { group in
            group.addTask {
                guard let url = ESPNProfiles.rosterURL(path: path, team: team),
                      let data = try? await cache.data(url, ttl: TTL.roster, force: force) else { return .failed(.roster) }
                let roster = ESPNProfiles.roster(data, sport: sport, path: path, team: ref)
                return roster.players.isEmpty ? .failed(.roster) : .roster(roster)
            }
            if let url = ESPNProfiles.depthURL(path: path, team: team) {
                group.addTask {
                    guard let data = try? await cache.data(url, ttl: TTL.roster, force: force) else { return nil }
                    if path == "football/nfl" { return ESPNProfiles.depthChart(data).map(TeamPiece.depthChart) }
                    return .coreDepth(ESPNProfiles.coreDepth(data))
                }
            }
            if let url = ESPNProfiles.leadersURL(path: path, team: team) {
                group.addTask {
                    guard let data = try? await cache.data(url, ttl: TTL.leaders, force: force) else { return .failed(.leaders) }
                    return .leaders(ESPNProfiles.leaders(data))
                }
            }
            if let url = ESPNProfiles.teamStatsURL(path: path, team: team) {
                group.addTask {
                    guard let data = try? await cache.data(url, ttl: TTL.leaders, force: force) else { return .failed(.stats) }
                    return .stats(ESPNProfiles.teamStats(data, sport: sport))
                }
            }
            if let url = ESPNProfiles.transactionsURL(path: path, team: team) {
                group.addTask {
                    guard let data = try? await cache.data(url, ttl: TTL.leaders, force: force) else { return nil }
                    return .transactions(ESPNProfiles.transactions(data))
                }
            }
            var out: [TeamPiece] = []
            for await piece in group { if let piece { out.append(piece) } }
            return out
        }
    }

    /// A soccer team's FotMob squad: search (30 days) then the team page (12 hours). Nil on any failure.
    nonisolated static func fotMobSquad(cache: ProfileCache, team: String, league: String?) async -> FotMob.Squad? {
        guard let search = FotMob.searchURL(team), let found = try? await cache.data(search, ttl: TTL.forever),
              let id = FotMob.teamID(found, name: team, league: league), let url = FotMob.teamURL(id),
              let data = try? await cache.data(url, ttl: 12 * 3600) else { return nil }
        return FotMob.squad(data)
    }

    nonisolated private static func counterStrikeTeam(cache: ProfileCache, ref: Profile.TeamRef, id: Int,
                                                      force: Bool) async -> [TeamPiece] {
        guard let lookup = BO3Profiles.teamLookupURL(id: id),
              let slugData = try? await cache.data(lookup, ttl: TTL.forever),
              let slug = BO3Profiles.slug(slugData) else { return [.failed(.header)] }
        async let team: TeamPiece = {
            guard let url = BO3Profiles.teamURL(slug: slug), let data = try? await cache.data(url, ttl: TTL.leaders, force: force),
                  let parsed = BO3Profiles.team(data, ref: ref) else { return .failed(.header) }
            return .counterStrike(parsed)
        }()
        async let career: TeamPiece? = {
            guard let url = BO3Profiles.teamStatsURL(slug: slug),
                  let data = try? await cache.data(url, ttl: TTL.roster, force: force) else { return nil }
            return .career(BO3Profiles.teamCareer(data))
        }()
        async let next: TeamPiece? = {
            guard let url = BO3Profiles.upcomingURL(teamID: id), let data = try? await cache.data(url, ttl: TTL.short, force: force),
                  let game = BO3Profiles.nextMatch(data, teamID: id) else { return nil }
            return .next(game)
        }()
        return [await team, await career, await next].compactMap { $0 }
    }

    // MARK: Players

    enum PlayerPiece: Sendable {
        case athlete(ESPNProfiles.AthleteData)
        case coreBio(Data)
        case overview(ESPNProfiles.OverviewData)
        case gameLog(Profile.GameLog)
        case leagueLeaders(path: String, [String: [String]])
        case counterStrike(BO3Profiles.PlayerData)
        case csGeneral(kd: Double?, adr: Double?)
        case csHeadshots(Double?)
        case csMatches(Profile.GameLog)
        case csMaps([Profile.MapStat])
        case csRoles([String])
        case climber(IFSCProfiles.AthleteData)
        case failed(PlayerState.Part)
    }

    func load(_ ref: Profile.PlayerRef, force: Bool = false) async {
        let state = state(for: ref)
        guard !state.loading else { return }
        if !force, let updated = state.updated, Date().timeIntervalSince(updated) < 60 { return }
        state.loading = true
        defer {
            state.loading = false
            state.loaded = true
            state.updated = .now
        }
        let cache = self.cache
        let knownLeaders = Set(leagueLeaders.keys)
        await withTaskGroup(of: [PlayerPiece].self) { group in
            switch ref.source {
            case let .espn(path):
                group.addTask { await Self.espnPlayer(cache: cache, ref: ref, path: path, force: force,
                                                      needsLeaders: !knownLeaders.contains(path)) }
            case let .counterStrike(slug):
                group.addTask { await Self.counterStrikePlayer(cache: cache, slug: slug, force: force) }
            case .ifsc:
                group.addTask {
                    guard let url = IFSCProfiles.athleteURL(id: ref.id),
                          let data = try? await cache.data(url, headers: IFSCProfiles.headers, ttl: 6 * 3600, force: force),
                          let athlete = IFSCProfiles.athlete(data) else { return [.failed(.bio)] }
                    return [.climber(athlete)]
                }
            }
            for await pieces in group { pieces.forEach { apply($0, to: state) } }
        }
        // Soccer: FotMob's photo, and its injury when ESPN has none (never blocks the page).
        if ref.sport == .soccer, let team = state.profile.bio?.team ?? ref.team {
            let name = state.profile.bio?.name ?? ref.name, jersey = state.profile.bio?.jersey ?? ref.jersey
            Task { [weak state] in
                guard let squad = await Self.fotMobSquad(cache: cache, team: team.name, league: team.league),
                      let member = FotMob.match(name: name, jersey: jersey, in: squad.members) else { return }
                state?.applyFotMob(member)
            }
        }
    }

    nonisolated private static func espnPlayer(cache: ProfileCache, ref: Profile.PlayerRef, path: String, force: Bool,
                                               needsLeaders: Bool) async -> [PlayerPiece] {
        await withTaskGroup(of: PlayerPiece?.self) { group in
            let college = path.hasSuffix("college-football")
            // College's v3 athlete embeds every conference's standings (428 KB): the core athlete covers the bio.
            if !college, let url = ESPNProfiles.athleteURL(path: path, id: ref.id) {
                group.addTask {
                    guard let data = try? await cache.data(url, ttl: TTL.athlete, force: force),
                          let athlete = ESPNProfiles.athlete(data, path: path) else { return .failed(.bio) }
                    return .athlete(athlete)
                }
            }
            if let url = ESPNProfiles.coreAthleteURL(path: path, id: ref.id) {
                group.addTask {
                    guard let data = try? await cache.data(url, ttl: TTL.career, force: force) else { return college ? .failed(.bio) : nil }
                    return .coreBio(data)
                }
            }
            if let url = ESPNProfiles.overviewURL(path: path, id: ref.id) {
                group.addTask {
                    guard let data = try? await cache.data(url, ttl: TTL.athlete, force: force) else { return .failed(.season) }
                    return .overview(ESPNProfiles.overview(data, sport: ref.sport))
                }
            }
            if let url = ESPNProfiles.gamelogURL(path: path, id: ref.id) {
                group.addTask {
                    guard let data = try? await cache.data(url, ttl: TTL.athlete, force: force),
                          let log = ESPNProfiles.gamelog(data, path: path, position: ref.position) else { return .failed(.gameLog) }
                    return .gameLog(log)
                }
            }
            if needsLeaders, path == "basketball/nba" || path.hasPrefix("soccer/"),
               let url = ESPNProfiles.leagueLeadersURL(path: path) {
                group.addTask {
                    guard let data = try? await cache.data(url, ttl: TTL.leagueLeaders) else { return nil }
                    return .leagueLeaders(path: path, ESPNProfiles.leaders(data).mapValues { $0.map(\.id) })
                }
            }
            var out: [PlayerPiece] = []
            for await piece in group { if let piece { out.append(piece) } }
            return out
        }
    }

    nonisolated private static func counterStrikePlayer(cache: ProfileCache, slug: String, force: Bool) async -> [PlayerPiece] {
        await withTaskGroup(of: PlayerPiece?.self) { group in
            func fetch(_ url: URL?, ttl: TimeInterval = TTL.leaders) async -> Data? {
                guard let url else { return nil }
                return try? await cache.data(url, ttl: ttl, force: force)
            }
            group.addTask {
                guard let data = await fetch(BO3Profiles.playerURL(slug: slug)), let p = BO3Profiles.player(data) else { return .failed(.bio) }
                return .counterStrike(p)
            }
            group.addTask {
                guard let data = await fetch(BO3Profiles.generalURL(slug: slug), ttl: TTL.roster) else { return nil }
                let g = BO3Profiles.general(data)
                return .csGeneral(kd: g.kd, adr: g.adr)
            }
            group.addTask {
                guard let data = await fetch(BO3Profiles.accuracyURL(slug: slug), ttl: TTL.roster) else { return nil }
                return .csHeadshots(BO3Profiles.headshotShare(data))
            }
            group.addTask {
                guard let data = await fetch(BO3Profiles.matchesURL(slug: slug), ttl: 15 * 60),
                      let log = BO3Profiles.matches(data) else { return .failed(.gameLog) }
                return .csMatches(log)
            }
            group.addTask {
                guard let data = await fetch(BO3Profiles.mapsURL(slug: slug), ttl: TTL.roster) else { return nil }
                return .csMaps(BO3Profiles.maps(data))
            }
            group.addTask {
                guard let data = await fetch(BO3Profiles.rolesURL(slug: slug), ttl: TTL.roster) else { return nil }
                return .csRoles(BO3Profiles.roles(data))
            }
            var out: [PlayerPiece] = []
            for await piece in group { if let piece { out.append(piece) } }
            return out
        }
    }

    private func apply(_ piece: PlayerPiece, to state: PlayerState) {
        if case let .leagueLeaders(path, map) = piece { leagueLeaders[path] = map }
        state.apply(piece)
        if case let .espn(path) = state.ref.source, let map = leagueLeaders[path] { state.applyLeagueRanks(map, path: path) }
    }

    /// MLB two-way players: the pitching log, on first switch.
    func loadPitching(_ ref: Profile.PlayerRef) async {
        let state = state(for: ref)
        guard state.profile.pitchingLog == nil, case let .espn(path) = ref.source,
              let url = ESPNProfiles.gamelogURL(path: path, id: ref.id, category: "pitching") else { return }
        let cache = self.cache
        let log: Profile.GameLog? = await Task.detached {
            guard let data = try? await cache.data(url, ttl: TTL.athlete) else { return nil }
            return ESPNProfiles.gamelog(data, path: path, position: "SP", pitching: true)
        }.value
        state.profile.pitchingLog = log
    }

    /// Career by season, when its section is opened.
    func loadCareer(_ ref: Profile.PlayerRef) async {
        let state = state(for: ref)
        guard state.profile.career == nil, case let .espn(path) = ref.source, !path.hasPrefix("soccer"),
              let url = ESPNProfiles.careerURL(path: path, id: ref.id) else { return }
        state.careerLoading = true
        let cache = self.cache
        let table: Profile.StatTable? = await Task.detached {
            guard let data = try? await cache.data(url, ttl: TTL.career) else { return nil }
            return ESPNProfiles.career(data)
        }.value
        state.careerLoading = false
        state.profile.career = table
    }

    // MARK: Prefetch

    @ObservationIgnored private var prefetchLog: [Date] = []
    @ObservationIgnored private var prefetched: [URL: Date] = [:]
    @ObservationIgnored private lazy var pathMonitor: NWPathMonitor = {
        let monitor = NWPathMonitor()
        monitor.start(queue: DispatchQueue(label: "ProfileStore.path"))
        return monitor
    }()

    /// The first request of a page, after a hover dwell: never on a metered or
    /// constrained network, at most six a minute.
    func prefetch(_ team: Profile.TeamRef) {
        guard case let .espn(_, path, id)? = team.source, let url = ESPNProfiles.teamURL(path: path, team: id) else { return }
        prefetch(url, headers: [:], ttl: TTL.header)
    }

    func prefetch(_ player: Profile.PlayerRef) {
        switch player.source {
        case let .espn(path): if let url = ESPNProfiles.coreAthleteURL(path: path, id: player.id) { prefetch(url, headers: [:], ttl: TTL.career) }
        case let .counterStrike(slug): if let url = BO3Profiles.playerURL(slug: slug) { prefetch(url, headers: [:], ttl: TTL.leaders) }
        case .ifsc: if let url = IFSCProfiles.athleteURL(id: player.id) { prefetch(url, headers: IFSCProfiles.headers, ttl: 6 * 3600) }
        }
    }

    private func prefetch(_ url: URL, headers: [String: String], ttl: TimeInterval) {
        // At most once per URL while its data would still be fresh.
        if let asked = prefetched[url], Date().timeIntervalSince(asked) < ttl { return }
        let path = pathMonitor.currentPath
        guard !path.isExpensive, !path.isConstrained else { return }
        prefetched[url] = .now
        prefetchLog = prefetchLog.filter { $0 > Date().addingTimeInterval(-60) }
        guard prefetchLog.count < 6 else { return }
        prefetchLog.append(.now)
        let cache = self.cache
        Task.detached(priority: .utility) {
            guard await !cache.isFresh(url, ttl: ttl) else { return }
            _ = try? await cache.data(url, headers: headers, ttl: ttl)
        }
    }

    /// A team's game went final: its leaders, stats and players' logs are stale.
    func invalidate(teamID: String) {
        teams[teamID]?.updated = nil
        for state in players.values where state.ref.team?.id == teamID || state.profile.bio?.team?.id == teamID {
            state.updated = nil
        }
    }
}

// MARK: - Team state

@MainActor
@Observable
final class TeamState {
    enum Part: String, Sendable { case header, roster, leaders, stats }

    let ref: Profile.TeamRef
    var header: Profile.TeamHeader?
    var groups: [Profile.RosterGroup] = []
    var depthChart: Profile.DepthChart?
    var leaders: [Profile.TeamLeader] = []
    var stats: [Profile.TeamStat] = []
    var transactions: [Profile.Transaction] = []
    var titles: [Profile.Title] = []
    var career: [Profile.StatTile] = []
    var next: Profile.GameRef?
    var loading = false
    /// The first load finished (whatever came back).
    var loaded = false
    var failed: Set<Part> = []
    var updated: Date?

    @ObservationIgnored private var players: [Profile.RosterPlayer] = []
    @ObservationIgnored private var coach: String?
    @ObservationIgnored private var leaderValues: [String: [(id: String, value: String)]] = [:]
    @ObservationIgnored private var coreDepth: [String: [String]] = [:]

    init(ref: Profile.TeamRef) { self.ref = ref }

    var allPlayers: [Profile.RosterPlayer] { groups.flatMap(\.players) }

    func apply(_ piece: ProfileStore.TeamPiece) {
        switch piece {
        case let .header(h):
            var h = h
            h.coach = h.coach ?? coach
            header = h
            failed.remove(.header)
            if next == nil { next = h.next }
        case let .roster(r):
            players = r.players
            coach = r.coach
            if header != nil, header?.coach == nil { header?.coach = r.coach }
            regroup()
        case let .depthChart(d):
            depthChart = d
            // The chart also orders the roster within each position (starters first).
            coreDepth = Dictionary(d.units.flatMap(\.slots).map { ("\($0.key)", $0.players.map(\.id)) },
                                   uniquingKeysWith: { a, _ in a })
            regroup()
        case let .coreDepth(d):
            coreDepth = d
            regroup()
        case let .leaders(l):
            leaderValues = l
            regroup()
        case let .stats(s): stats = s
        case let .transactions(t): transactions = t
        case let .counterStrike(cs):
            header = cs.header
            players = cs.players
            titles = cs.titles
            let active = cs.players.filter { !$0.isCoach && !$0.benched }
            groups = [Profile.RosterGroup(kind: .players, players: active),
                      Profile.RosterGroup(kind: .coach, players: cs.players.filter(\.isCoach)),
                      Profile.RosterGroup(kind: .benched, players: cs.players.filter { $0.benched && !$0.isCoach })]
                .filter { !$0.players.isEmpty }
        case let .career(tiles): career = tiles
        case let .next(game): next = game
        case let .failed(part): failed.insert(part)
        }
    }

    /// FotMob's photos (where ESPN has none), injuries (ESPN lists none for soccer)
    /// and current coach, matched player by player; unmatched players keep their monograms.
    func applyFotMob(_ squad: FotMob.Squad) {
        var changed = false
        for i in players.indices {
            guard let m = FotMob.match(name: players[i].ref.name, jersey: players[i].jersey, in: squad.members) else { continue }
            // FotMob's face crops for everyone matched, so the squad reads as one set (ESPN has a few, framed differently).
            players[i].ref.photo = FotMob.photoURL(m.id)
            changed = true
            if players[i].injury == nil, let injury = FotMob.injury(m) {
                players[i].injury = injury.status
                players[i].injuryReturn = injury.detail.map { $0.replacingOccurrences(of: "Expected back ", with: "") }
                changed = true
            }
        }
        if let coach = squad.coach, header?.coach == nil { header?.coach = coach; self.coach = coach }
        if changed { regroup() }
    }

    private func regroup() {
        guard let sport = ref.sport, !players.isEmpty else { return }
        groups = ESPNProfiles.groups(sport: sport, college: ref.id.hasPrefix("espn-ncaaf-"), players: players,
                                     leaders: leaderValues, depth: coreDepth)
        leaders = ESPNProfiles.teamLeaders(sport: sport, leaders: leaderValues, roster: players)
    }
}

// MARK: - Player state

@MainActor
@Observable
final class PlayerState {
    enum Part: String, Sendable { case bio, season, gameLog }

    let ref: Profile.PlayerRef
    var profile = Profile.PlayerProfile()
    var loading = false
    var loaded = false
    var careerLoading = false
    var failed: Set<Part> = []
    var updated: Date?

    @ObservationIgnored private var coreBio: Data?
    @ObservationIgnored private var csRating: Double?
    @ObservationIgnored private var csKD: Double?
    @ObservationIgnored private var csADR: Double?
    @ObservationIgnored private var csHS: Double?

    init(ref: Profile.PlayerRef) { self.ref = ref }

    /// The bio, or what the link knew while it loads.
    var bio: Profile.Bio {
        if let bio = profile.bio { return bio }
        var b = Profile.Bio(name: ref.name)
        b.photo = ref.photo
        b.team = ref.team
        b.jersey = ref.jersey
        b.positionAbbreviation = ref.position
        b.country = ref.country
        return b
    }

    func apply(_ piece: ProfileStore.PlayerPiece) {
        switch piece {
        case let .athlete(a):
            var bio = a.bio
            if let core = coreBio { ESPNProfiles.coreAthlete(core, into: &bio) }
            if bio.team == nil { bio.team = ref.team }
            profile.bio = bio
            profile.tiles = a.tiles
            profile.tilesCaption = a.tilesCaption
            profile.injury = a.injury
        case let .coreBio(data):
            coreBio = data
            if var bio = profile.bio {
                ESPNProfiles.coreAthlete(data, into: &bio)
                profile.bio = bio
            } else if ref.isCollege {
                var bio = Profile.Bio(name: ref.name)
                bio.photo = { if case let .espn(path) = ref.source { return PhotoURL.espn(path: path, id: ref.id, size: .hero) }; return nil }()
                bio.team = ref.team
                // A link without the team's colors still gets them, from its logo (ESPN files college logos by ID).
                if bio.team?.logo == nil, case let .espn(_, _, team)? = ref.team?.source {
                    bio.team?.logo = URL(string: "https://a.espncdn.com/i/teamlogos/ncaa/500/\(team).png")
                }
                ESPNProfiles.coreAthlete(data, into: &bio)
                profile.bio = bio
                collegeTiles()
            }
        case let .overview(o):
            profile.season = o.season
            profile.competitions = o.competitions
            profile.note = o.note
            profile.awards = o.awards
            collegeTiles()
        case let .gameLog(log):
            profile.gameLog = log
            profile.canPitch = log.categories.contains("pitching")
            profile.canBat = log.categories.isEmpty || log.categories.contains("batting")
        case .leagueLeaders: break
        case let .counterStrike(p):
            profile.bio = p.bio
            csRating = p.rating
            csTiles()
        case let .csGeneral(kd, adr):
            csKD = kd
            csADR = adr
            csTiles()
        case let .csHeadshots(hs):
            csHS = hs
            csTiles()
        case let .csMatches(log): profile.gameLog = log
        case let .csMaps(maps): profile.mapPool = maps
        case let .csRoles(roles): profile.roles = roles
        case let .climber(c):
            var p = c.profile
            p.bio = c.bio
            profile = p
        case let .failed(part): failed.insert(part)
        }
    }

    /// A FotMob photo and injury for a soccer player ESPN has neither for.
    func applyFotMob(_ member: FotMob.Member) {
        guard var bio = profile.bio else { return }
        // The same face crop as on the squad list.
        bio.photo = FotMob.photoURL(member.id)
        profile.bio = bio
        if profile.injury == nil, let injury = FotMob.injury(member) {
            profile.injury = Profile.InjuryNote(status: injury.status, detail: injury.detail)
        }
    }

    /// College has no ranked summary: the season line's headline stats, by position.
    private func collegeTiles() {
        guard ref.isCollege, profile.tiles.isEmpty, let season = profile.season, let row = season.rows.first else { return }
        let pos = (profile.bio?.positionAbbreviation ?? ref.position ?? "").uppercased()
        let keys: [(String, String)] = switch pos {
        case "QB": [("passingYards", "YDS"), ("passingTouchdowns", "TD"), ("interceptions", "INT"), ("QBRating", "RTG")]
        case "RB", "FB": [("rushingYards", "YDS"), ("rushingTouchdowns", "TD"), ("rushingAttempts", "CAR"), ("yardsPerRushAttempt", "AVG")]
        case "WR", "TE": [("receptions", "REC"), ("receivingYards", "YDS"), ("receivingTouchdowns", "TD"), ("yardsPerReception", "AVG")]
        default: [("totalTackles", "TOT"), ("sacks", "SACK"), ("interceptions", "INT"), ("passesDefended", "PD")]
        }
        profile.tiles = keys.compactMap { key, label in
            guard let i = season.keys.firstIndex(of: key), i < row.values.count else { return nil }
            return Profile.StatTile(label: label, value: row.values[i])
        }
        // The career table's row is just the year ("2026"): say what it is.
        profile.tilesCaption = row.title.allSatisfy(\.isNumber) ? "\(row.title) season stats" : row.title
    }

    private func csTiles() {
        var tiles: [Profile.StatTile] = []
        if let r = csRating, r > 0 { tiles.append(.init(label: "RATING", value: String(format: "%.2f", r), rank: "6 months")) }
        if let kd = csKD { tiles.append(.init(label: "K/D", value: String(format: "%.2f", kd), rank: "Career")) }
        if let adr = csADR { tiles.append(.init(label: "ADR", value: String(format: "%.1f", adr), rank: "Career")) }
        if let hs = csHS { tiles.append(.init(label: "HS%", value: "\(Int((hs * 100).rounded()))%", rank: "Career")) }
        profile.tiles = tiles
    }

    /// NBA and soccer: ESPN's summary has no ranks, so a top-25 place in the league leaders stands in.
    func applyLeagueRanks(_ map: [String: [String]], path: String) {
        let categories: [String: String] = path == "basketball/nba"
            ? ["PTS": "pointsPerGame", "REB": "reboundsPerGame", "AST": "assistsPerGame", "FG%": "fieldGoalPercentage",
               "STL": "stealsPerGame", "BLK": "blocksPerGame"]
            : ["G": "goals", "A": "assists"]
        var changed = false
        let tiles = profile.tiles.map { tile -> Profile.StatTile in
            guard tile.rank == nil, let category = categories[tile.label],
                  let index = map[category]?.firstIndex(of: ref.id) else { return tile }
            changed = true
            return Profile.StatTile(label: tile.label, value: tile.value, rank: Ordinal.string(index + 1))
        }
        if changed { profile.tiles = tiles }
    }
}
