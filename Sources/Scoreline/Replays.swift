import SwiftUI

// Click a play, watch it: the game page's plays (the plays list, key moments,
// the scoring list) replayed in the isometric view under the row clicked,
// live or after the game (ReplayWell.swift draws it).
//
// Each play's scene is built the way the sport's live theater builds it, by
// the same builders, from what the page already has: the summary's plays
// (baseball), the soccer feed's moments, the live lanes' entries. What a
// finished game is missing (football's and basketball's core plays, MLB's
// account) is fetched once, when the page opens, and kept for the game;
// nothing polls. A play replays only when the live theater would replay it
// in full: a baseball play on the field, a football snap or kick, a
// basketball shot worth its own replay (`BasketballScene.replays`), a soccer
// shot or goal. Beats between them (a pitch, a card, a timeout) aren't
// replays, and their rows stay as they are.
//
// The replay is its own instance: the theater above, on a live game, never
// hears of it (its queue, what it has played, its turn of the field).

/// A play a row can replay: its scene, ready for the sport's script, and its
/// moment as the live lane would have offered it (what its celebration answers).
struct PlayReplay: Equatable, @unchecked Sendable {
    enum Scene: Equatable {
        /// The play, and the field it leaves.
        case baseball(PlayScene, rest: PlayScript.Rest)
        /// A snap or kick (a touchdown's try follows it, as live).
        case football(FootballScene)
        case basketball(BasketballScene)
        case soccer(SoccerScene)
    }

    var scene: Scene
    var moment: LiveMoment?
}

/// A row on the page: its list, and the play it's about (a play can be in two lists).
struct ReplayRow: Hashable {
    let section: DetailView.Section
    let play: String
}

/// Which row is open: one at a time. Opening another closes the first; the
/// open one, clicked again (or Esc), closes; a row whose play can't replay
/// any more (edited away) closes. (pure; tested)
struct ReplayOpening: Equatable {
    private(set) var row: ReplayRow?

    mutating func toggle(_ next: ReplayRow) {
        row = row == next ? nil : next
    }

    /// Whether there was a row to close.
    @discardableResult
    mutating func close() -> Bool {
        defer { row = nil }
        return row != nil
    }

    mutating func keep(_ replayable: (String) -> Bool) {
        if let row, !replayable(row.play) { self.row = nil }
    }
}

/// A replay's running order: each take after the one before (a touchdown,
/// then its try a breath after, as the live theater follows it), then the
/// last one held as it ended. (pure; tested)
struct ReplayClock: Equatable {
    /// Each take's script length.
    let lengths: [Double]
    /// The live theater's breath before a touchdown's try.
    static let breath = 0.3

    /// When the last take ends.
    var end: Double { lengths.reduce(0, +) + Double(max(lengths.count - 1, 0)) * Self.breath }

    /// The take on screen `elapsed` seconds in, and its time (a take's
    /// formation stands through the breath before it, at a time below zero);
    /// from the end, the last take as it ended (infinity).
    func position(_ elapsed: Double) -> (take: Int, t: Double) {
        guard !lengths.isEmpty, elapsed < end else { return (max(lengths.count - 1, 0), .infinity) }
        var start = 0.0
        for i in lengths.indices {
            // Past this take's end, the next one's formation stands through the breath.
            if i == lengths.count - 1 || elapsed < start + lengths[i] { return (i, elapsed - start) }
            start += lengths[i] + Self.breath
        }
        return (lengths.count - 1, .infinity)
    }
}

// MARK: - Building

/// Each sport's replays from its plays, by the live theaters' own builders
/// (the live lanes', on the main actor). (pure; tested)
@MainActor
enum Replays {
    /// The plays a page's rows are about: its key moments (an NBA run's last
    /// basket) and its plays list.
    nonisolated static func ids(_ detail: GameDetail, recent: [GameDetail.RecentPlay]) -> Set<String> {
        Set(detail.moments.map { play(of: $0.id) } + recent.compactMap(\.id))
    }

    /// A moment's play: an NBA run is its last basket ("…-run" when that basket also changed the lead).
    nonisolated static func play(of momentID: String) -> String {
        momentID.hasSuffix("-run") ? String(momentID.dropLast(4)) : momentID
    }

    /// Baseball, from ESPN's plays (the summary's, or the live lane's): each
    /// play-result among `ids` as the theater's state would have it right
    /// after (the play, and the batter up next), and the field it leaves, its
    /// own runners on base. A result that isn't a play on the field (or
    /// doesn't parse) isn't a replay.
    nonisolated static func baseball(_ plays: [JSON], ids: Set<String>, side: (String?) -> GameDetail.Side?,
                         names: [String: String]) -> [String: PlayReplay] {
        let results = plays.indices.filter { plays[$0]["type"]["type"].string == "play-result" }
        var out: [String: PlayReplay] = [:]
        for (k, index) in results.enumerated() {
            guard let id = plays[index]["id"].string, ids.contains(id) else { continue }
            // Up to the next play: what follows it (the next batter's first pitch) says who's up.
            let end = k + 1 < results.count ? results[k + 1] : plays.count
            let state = PlayScene.theater(Array(plays[..<end]), side: side, names: names)
            guard let play = state.play, play.id == id else { continue }
            out[id] = PlayReplay(scene: .baseball(play, rest: PlayTheater.rest(after: play, bases: nil, bats: state.bats, batting: nil)),
                                 moment: BaseballFeed.moment(plays[index], side: side))
        }
        return out
    }

    /// Football, from ESPN's core plays: each snap among `ids`, every snap
    /// of the game in play order spotted on its hash from the one before (as
    /// the live lane spots each from the last, watched from the kickoff),
    /// placed on the depth charts; its moment with the score going in.
    nonisolated static func football(_ items: [JSON], ids: Set<String>, teams: FootballFeed.Teams,
                                     charts: [GameDetail.Side: FootballDepthChart]) -> [String: PlayReplay] {
        var reader = FootballReplays()
        return (reader.read(items, teams: teams, charts: charts) ?? [:]).filter { ids.contains($0.key) }
    }

    /// Basketball, from ESPN's core plays in game order (normalized as the
    /// live lane reads them): each play among `ids` that the theater replays
    /// in full; its moment as it was when new.
    nonisolated static func basketball(_ items: [JSON], ids: Set<String>, teams: BasketballFeed.Teams) -> [String: PlayReplay] {
        var reader = BasketballReplays()
        return (reader.read(items, teams: teams) ?? [:]).filter { ids.contains($0.key) }
    }

    /// Soccer, from ESPN's core plays: the moment at `index` (a shot, a
    /// goal) with its build-up and what followed, as the theater parses it.
    nonisolated static func soccer(_ plays: [JSON], at index: Int, homeTeamID: String?, keepers: [String: SoccerScene.Person]) -> PlayReplay? {
        guard let scene = SoccerScene.parse(plays, at: index, homeTeamID: homeTeamID, keepers: keepers) else { return nil }
        return PlayReplay(scene: .soccer(scene), moment: SoccerFeed.action(plays[index], index: 0, homeTeamID: homeTeamID)?.moment)
    }

    /// Whether a run of NBA plays starts at the opening tip (the game's first entry).
    nonisolated static func tipOff(_ first: JSON) -> Bool {
        first["period"]["number"].int == 1 && first["clock"]["value"].double.map { $0 >= 719 } != false
    }

    /// An archive and the live lane's newest entries as one run in game
    /// order: the lane's version of an entry both have (an edit), and what
    /// only the lane has after it. (pure; tested)
    nonisolated static func merged(_ archive: [JSON], _ lane: [JSON]) -> [JSON] {
        guard !lane.isEmpty else { return archive }
        let fresh = Dictionary(lane.compactMap { item in item["id"].string.map { ($0, item) } }, uniquingKeysWith: { _, newer in newer })
        var seen = Set<String>()
        var out = archive.map { item -> JSON in
            guard let id = item["id"].string else { return item }
            seen.insert(id)
            return fresh[id] ?? item
        }
        out += lane.filter { $0["id"].string.map { !seen.contains($0) } ?? false }
        return out
    }
}

// MARK: - Reading plays once

/// Football's plays as replays, each read once: a play is parsed again only
/// when its digest changes, and only what follows the first change is spotted
/// and scored again (a snap's hash comes from the one before it, its moment's
/// score from the plays before it). Every snap is kept, whether or not a row
/// shows it yet, so a row that appears finds its replay waiting. (pure)
struct FootballReplays {
    private struct Parsed {
        var digest: Int
        var scene: FootballScene?
        var drive: DrivePlay?
    }
    private struct Read: Equatable {
        var id: String
        var digest: Int
    }

    private var parsed: [String: Parsed] = [:]
    private var order: [Read] = []
    private var spotted: [FootballScene] = []
    private var built: [String: PlayReplay] = [:]
    private var teams: (top: String?, bottom: String?, topIsHome: Bool)?
    private var charts: [GameDetail.Side: FootballDepthChart] = [:]
    /// How many plays the last read parsed (the tests' and the bench's).
    private(set) var parsedCount = 0

    /// The replays now, or nil when nothing a replay reads has changed.
    mutating func read(_ items: [JSON], teams: FootballFeed.Teams, charts: [GameDetail.Side: FootballDepthChart]) -> [String: PlayReplay]? {
        func sequence(_ item: JSON) -> Double { Double(item["sequenceNumber"].string ?? "") ?? item["sequenceNumber"].double ?? 0 }
        // The feed isn't always in play order; sequence numbers are (ties keep the feed's order).
        let ordered = items.enumerated().map { (sequence($0.element), $0.offset, $0.element) }.sorted { ($0.0, $0.1) < ($1.0, $1.1) }.map(\.2)
        parsedCount = 0
        let fresh = ordered.enumerated().map { offset, item -> Read in
            // An entry without an ID can't be kept: its place in the game is all it has.
            let id = item["id"].string ?? "#\(offset)"
            let digest = BroadcastLanes.digest(football: item)
            if parsed[id]?.digest != digest {
                parsed[id] = Parsed(digest: digest, scene: FootballScene.parse(item, teams: teams), drive: FootballFeed.play(item, teams: teams))
                parsedCount += 1
            }
            return Read(id: id, digest: digest)
        }
        let same = self.teams.map { $0.top == teams.topID && $0.bottom == teams.bottomID && $0.topIsHome == teams.topIsHome } ?? false
        let first = same && charts == self.charts ? (zip(order, fresh).enumerated().first { $1.0 != $1.1 }?.offset ?? min(order.count, fresh.count)) : 0
        if first == fresh.count, order.count == fresh.count { return nil }
        // What came before the first change stays exactly as it was read.
        let before = Set(fresh[..<first].compactMap { parsed[$0.id]?.scene?.id })
        let kept = spotted.prefix { before.contains($0.id) }
        var running = Array(kept)
        running += FootballFeed.spot(fresh[first...].compactMap { parsed[$0.id]?.scene }, after: kept.last)
        let drives = fresh.compactMap { parsed[$0.id]?.drive }
        let places = Dictionary(drives.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
        var next = built.filter { before.contains($0.key) }
        for scene in running[kept.count...] {
            let moment = places[scene.id].flatMap { at in
                FootballFeed.moment(drives[at], before: drives[..<at].last { $0.homeScore != nil && $0.awayScore != nil }.map { ($0.homeScore!, $0.awayScore!) },
                                    topIsHome: teams.topIsHome)
            }
            next[scene.id] = PlayReplay(scene: .football(scene.slotted(by: charts)), moment: moment)
        }
        order = fresh
        spotted = running
        built = next
        self.teams = (teams.topID, teams.bottomID, teams.topIsHome)
        self.charts = charts
        return next
    }
}

/// Basketball's plays as replays, each read once: a play's scene reads the
/// plays around it, so a change is read again from the sport's own reach
/// before it (`HoopsSport.sceneStart`), and nothing earlier is. (pure)
struct BasketballReplays {
    private struct Read: Equatable {
        var id: String?
        var digest: Int
    }

    private var order: [Read] = []
    private var built: [Int: (id: String, replay: PlayReplay)] = [:]
    private var teams: (top: String?, bottom: String?, topIsHome: Bool)?
    /// How many plays the last read parsed (the tests' and the bench's).
    private(set) var parsedCount = 0

    /// The replays now, or nil when nothing a replay reads has changed.
    mutating func read(_ items: [JSON], teams: BasketballFeed.Teams) -> [String: PlayReplay]? {
        let fresh = items.map { Read(id: $0["id"].string, digest: BroadcastLanes.digest(basketball: $0)) }
        let same = self.teams.map { $0.top == teams.topID && $0.bottom == teams.bottomID && $0.topIsHome == teams.topIsHome } ?? false
        var first = same ? (zip(order, fresh).enumerated().first { $1.0 != $1.1 }?.offset ?? min(order.count, fresh.count)) : 0
        parsedCount = 0
        if first == fresh.count, order.count == fresh.count { return nil }
        first = HoopsSport.sceneStart(before: first, in: items)
        built = built.filter { $0.key < first }
        let tip = items.first.map(Replays.tipOff) ?? false
        for i in first..<items.count {
            parsedCount += 1
            guard let id = items[i]["id"].string, let scene = BasketballScene.parse(items, at: i, teams: teams), scene.replays else { continue }
            built[i] = (id, PlayReplay(scene: .basketball(scene), moment: BasketballFeed.moment(at: i, in: items, teams: teams, fromTipOff: tip)))
        }
        order = fresh
        self.teams = (teams.topID, teams.bottomID, teams.topIsHome)
        return Dictionary(built.values.map { ($0.id, $0.replay) }, uniquingKeysWith: { _, newer in newer })
    }
}

/// A run of plays handed across to the builder (the parsed JSON is never written to).
struct JSONRun: @unchecked Sendable {
    let items: [JSON]
    init(_ items: [JSON]) { self.items = items }
}

/// Where a page's replays are built: off the main actor, one sport's reader at
/// a time. A row opening never waits for a parse: everything's read as it comes.
actor ReplayBuilder {
    private var football = FootballReplays()
    private var basketball = BasketballReplays()
    private var baseball: (from: [String: PlayReplay], atBats: Int, built: [String: PlayReplay])?
    private var soccer: [String: PlayReplay]?

    func football(_ run: JSONRun, teams: FootballFeed.Teams, charts: [GameDetail.Side: FootballDepthChart]) -> [String: PlayReplay]? {
        football.read(run.items, teams: teams, charts: charts)
    }

    func basketball(_ run: JSONRun, lane: JSONRun, teams: BasketballFeed.Teams) -> [String: PlayReplay]? {
        basketball.read(Replays.merged(run.items, lane.items), teams: teams)
    }

    /// Baseball's come built, with the page's summary: what's added here is MLB's account of each.
    func baseball(_ plays: [String: PlayReplay], atBats: [Statcast.AtBat]) -> [String: PlayReplay]? {
        if let baseball, baseball.atBats == atBats.count, baseball.from == plays { return nil }
        var next = plays
        for (key, replay) in next {
            guard case .baseball(var play, let rest) = replay.scene, play.measured == nil else { continue }
            play.measured = play.measurement(in: atBats) ?? play.runnerMeasurement(in: atBats)
            next[key]?.scene = .baseball(play, rest: rest)
        }
        let changed = baseball?.built != next
        baseball = (plays, atBats.count, next)
        return changed ? next : nil
    }

    func soccer(_ plays: [String: PlayReplay]) -> [String: PlayReplay]? {
        guard soccer != plays else { return nil }
        soccer = plays
        return plays
    }
}

// MARK: - The page's replays

/// Who's who and how they're dressed, for a replay on this page.
struct ReplayContext: Equatable {
    var eventID = ""
    var top: Competitor?
    var bottom: Competitor?
    /// The NBA's palette (its own clash rules).
    var nba = false
    var topIsHome = false
    var people: [String: TheaterPerson] = [:]
    var fielders = BaseballFielders()
    var lineups: [GameDetail.Side: SoccerLineup] = [:]
    /// Baseball: MLB's numbers by name, for the tags.
    var numbers: [String: String] = [:]

    var kits: TheaterKits { TheaterKits(top: top, bottom: bottom, topIsHome: topIsHome) }
    /// Short names ("PHI"), and the teams' full names ("Philadelphia Eagles").
    var codes: (top: String, bottom: String) { (top?.abbreviation ?? "", bottom?.abbreviation ?? "") }
    var teams: (top: String, bottom: String) { (top?.name ?? codes.top, bottom?.name ?? codes.bottom) }
}

/// The match page's replays: which row is open, each replayable play by ID,
/// and who's who. Rows read it; the page writes it (`update`) as its
/// sources change. Observed only by the rows and the open replay.
@MainActor
@Observable
final class PageReplays {
    private(set) var opening = ReplayOpening()
    private(set) var plays: [String: PlayReplay] = [:]
    private(set) var context = ReplayContext()
    /// The sport has an isometric view: its lists keep a place for the play glyph.
    private(set) var supported = false

    /// The game's core plays (football, basketball), fetched once.
    @ObservationIgnored private var archive: (event: String, items: [JSON])?
    @ObservationIgnored private var charts: (event: String, found: [GameDetail.Side: FootballDepthChart])?
    /// Where this page's replays are read (off the main actor), and what it has read so far.
    @ObservationIgnored private var builder = ReplayBuilder()
    /// Finished games' core plays, the last few, kept across visits: a final doesn't change.
    private static var finals: [(event: String, items: [JSON])] = []

    var open: ReplayRow? { opening.row }

    /// `event`: the page's game, whose sport says whether its lists keep a place for the play glyph from the start.
    init(_ event: Event? = nil) {
        if case let .espn(path, _, sport)? = event?.ref {
            supported = [.baseball, .football, .soccer].contains(sport) || (sport == .basketball && path == NBADetail.path)
        }
    }

    func toggle(_ row: ReplayRow) { opening.toggle(row) }

    @discardableResult
    func close() -> Bool { opening.close() }

    /// Another game on the same page.
    func reset() {
        opening = ReplayOpening()
        plays = [:]
        archive = nil
        charts = nil
        builder = ReplayBuilder()
    }

    /// The page's replays now: built from what the page has, off the main
    /// actor, fetching what a game is missing once. Every replayable play is
    /// kept (the rows look theirs up), so a play told is already here: nothing
    /// is read when one is told, and a row opens from what's built.
    func update(event: Event, detail: GameDetail, soccer: SoccerFeed?, football: FootballFeed, basketball: BasketballFeed) async {
        guard case let .espn(path, id, sport)? = event.ref else { return }
        let live = event.state == .live
        let nba = sport == .basketball && path == NBADetail.path
        let supported = [.baseball, .football, .soccer].contains(sport) || nba
        if supported != self.supported { self.supported = supported }
        guard supported else { return }
        var context = ReplayContext(eventID: event.id, top: event.competitors.first, bottom: event.competitors.last, nba: nba,
                                    topIsHome: detail.topIsHome ?? false, people: detail.people, fielders: detail.fielders,
                                    lineups: detail.lineups)
        let builder = builder
        let next: [String: PlayReplay]?
        switch sport {
        case .baseball:
            // MLB's account of each play: its feed fetched once for the game (the live lane keeps it current).
            var atBats: [Statcast.AtBat] = []
            if let lookup = Statcast.Lookup(event), !detail.replays.isEmpty {
                atBats = await StatcastStore.shared.atBats(espnEvent: lookup.espnEvent, start: lookup.start, teams: lookup.teams)
                guard !Task.isCancelled else { return }
                context.numbers = StatcastStore.shared.numbers(espnEvent: lookup.espnEvent)
            }
            let plays = detail.replays, found = atBats
            next = await Task.detached(priority: .utility) { await builder.baseball(plays, atBats: found) }.value
        case .soccer:
            let plays = soccer?.replays ?? [:]
            next = await Task.detached(priority: .utility) { await builder.soccer(plays) }.value
        case .football:
            guard let homeIsTop = detail.topIsHome else { return }
            let teams = FootballFeed.Teams(event, topIsHome: homeIsTop)
            let league = path.split(separator: "/").last.map(String.init) ?? path
            let items = live && !football.entries.isEmpty ? football.entries
                : await archived(event, url: "https://sports.core.api.espn.com/v2/sports/football/leagues/\(league)/events/\(id)/competitions/\(id)/plays",
                                 normalize: { $0 })
            let found = league == "nfl" ? await depthCharts(event, teams: teams) : [:]
            guard !Task.isCancelled else { return }
            let run = JSONRun(items)
            next = await Task.detached(priority: .utility) { await builder.football(run, teams: teams, charts: found) }.value
        case .basketball:
            guard let topIsHome = detail.topIsHome else { return }
            let items = await archived(event, url: "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/\(id)/competitions/\(id)/plays",
                                       normalize: BasketballFeed.normalized)
            guard !Task.isCancelled else { return }
            let teams = BasketballFeed.Teams(event, topIsHome: topIsHome)
            let run = JSONRun(items), lane = JSONRun(live ? basketball.window : [])
            next = await Task.detached(priority: .utility) { await builder.basketball(run, lane: lane, teams: teams) }.value
        default:
            return
        }
        guard !Task.isCancelled else { return }
        if context != self.context { self.context = context }
        guard let next else { return }
        plays = next
        var opening = opening
        opening.keep { next[$0] != nil }
        if opening != self.opening { self.opening = opening }
    }

    #if DEBUG
    /// The render harness: replays, who's who, and the row open, as given.
    func preview(plays: [String: PlayReplay], context: ReplayContext, open: ReplayRow?) {
        self.plays = plays
        self.context = context
        supported = true
        opening = ReplayOpening()
        if let open { opening.toggle(open) }
    }
    #endif

    /// The game's core plays, every page, fetched once (a final's kept for later visits).
    private func archived(_ event: Event, url base: String, normalize: (JSON) -> JSON) async -> [JSON] {
        if let archive, archive.event == event.id { return archive.items }
        if let kept = Self.finals.first(where: { $0.event == event.id }) { return kept.items }
        var items: [JSON] = []
        var page = 1
        while !Task.isCancelled, let url = URL(string: "\(base)?limit=400&page=\(page)"), let json = try? await JSON.fetch(url) {
            items += json["items"].array.map(normalize)
            if page >= (json["pageCount"].int ?? page) { break }
            page += 1
        }
        guard !Task.isCancelled, !items.isEmpty else { return items }
        archive = (event.id, items)
        if event.state == .final {
            Self.finals = Array((Self.finals.filter { $0.event != event.id } + [(event.id, items)]).suffix(4))
        }
        return items
    }

    /// Both NFL depth charts (the live lane's, cached for the day).
    private func depthCharts(_ event: Event, teams: FootballFeed.Teams) async -> [GameDetail.Side: FootballDepthChart] {
        if let charts, charts.event == event.id { return charts.found }
        let season = FootballFeed.season(event.start)
        async let top = FootballFeed.depthChart(team: teams.topID, season: season)
        async let bottom = FootballFeed.depthChart(team: teams.bottomID, season: season)
        var found: [GameDetail.Side: FootballDepthChart] = [:]
        (found[.top], found[.bottom]) = await (top, bottom)
        if !Task.isCancelled { charts = (event.id, found) }
        return found
    }
}

/// Hands the page's replays to its rows, and keeps them in step with what
/// they're built from: the page's summary and the live lanes, as they arrive.
/// What's told doesn't move it: the rows look up plays already read. Only this
/// modifier follows the lanes, so a new entry never runs the page again.
struct ReplaySync: ViewModifier {
    let replays: PageReplays
    let detail: GameDetail?
    /// The page's count of loads: a new summary.
    let loads: Int
    let event: Event
    let soccer: SoccerFeed?
    let football: FootballFeed
    let basketball: BasketballFeed

    private struct Key: Equatable {
        var event: String
        var state: EventState
        var loads: Int
        /// What each lane last brought.
        var soccer: Int
        var football: Date?
        var basketball: Date?
    }

    func body(content: Content) -> some View {
        content.environment(replays).task(id: key) {
            guard let detail else { return }
            await replays.update(event: event, detail: detail, soccer: soccer, football: football, basketball: basketball)
        }
    }

    private var key: Key? {
        guard detail != nil else { return nil }
        let live = event.state == .live
        return Key(event: event.id, state: event.state, loads: loads, soccer: soccer?.replays.count ?? 0,
                   football: live ? football.theater.heard : nil, basketball: live ? basketball.theater.heard : nil)
    }
}
