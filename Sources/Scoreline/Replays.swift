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
struct PlayReplay: Equatable {
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
    static func football(_ items: [JSON], ids: Set<String>, teams: FootballFeed.Teams,
                         charts: [GameDetail.Side: FootballDepthChart]) -> [String: PlayReplay] {
        func sequence(_ item: JSON) -> Double { Double(item["sequenceNumber"].string ?? "") ?? item["sequenceNumber"].double ?? 0 }
        // The feed isn't always in play order; sequence numbers are (ties keep the feed's order).
        let ordered = items.enumerated().sorted { (sequence($0.element), $0.offset) < (sequence($1.element), $1.offset) }.map(\.element)
        let drives = ordered.compactMap { FootballFeed.play($0, teams: teams) }
        let snaps = FootballFeed.spot(ordered.compactMap { FootballScene.parse($0, teams: teams) }, after: nil)
        var out: [String: PlayReplay] = [:]
        for scene in snaps where ids.contains(scene.id) {
            let moment = drives.first { $0.id == scene.id }.flatMap { play in
                FootballFeed.moment(play, before: FootballFeed.score(before: play, in: drives), topIsHome: teams.topIsHome)
            }
            out[scene.id] = PlayReplay(scene: .football(scene.slotted(by: charts)), moment: moment)
        }
        return out
    }

    /// Basketball, from ESPN's core plays in game order (normalized as the
    /// live lane reads them): each play among `ids` that the theater replays
    /// in full; its moment as it was when new.
    static func basketball(_ items: [JSON], ids: Set<String>, teams: BasketballFeed.Teams) -> [String: PlayReplay] {
        var out: [String: PlayReplay] = [:]
        for (i, item) in items.enumerated() {
            guard let id = item["id"].string, ids.contains(id),
                  let scene = BasketballScene.parse(items, at: i, teams: teams), scene.replays else { continue }
            out[id] = PlayReplay(scene: .basketball(scene),
                                 moment: BasketballFeed.moment(at: i, in: items, teams: teams, fromTipOff: items.first.map(Self.tipOff) ?? false))
        }
        return out
    }

    /// Soccer, from ESPN's core plays: the moment at `index` (a shot, a
    /// goal) with its build-up and what followed, as the theater parses it.
    static func soccer(_ plays: [JSON], at index: Int, homeTeamID: String?, keepers: [String: SoccerScene.Person]) -> PlayReplay? {
        guard let scene = SoccerScene.parse(plays, at: index, homeTeamID: homeTeamID, keepers: keepers) else { return nil }
        return PlayReplay(scene: .soccer(scene), moment: SoccerFeed.action(plays[index], index: 0, homeTeamID: homeTeamID)?.moment)
    }

    /// Whether a run of NBA plays starts at the opening tip (the game's first entry).
    static func tipOff(_ first: JSON) -> Bool {
        first["period"]["number"].int == 1 && first["clock"]["value"].double.map { $0 >= 719 } != false
    }

    /// An archive and the live lane's newest entries as one run in game
    /// order: the lane's version of an entry both have (an edit), and what
    /// only the lane has after it. (pure; tested)
    static func merged(_ archive: [JSON], _ lane: [JSON]) -> [JSON] {
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

    var kits: TheaterKits { TheaterKits(top: top, bottom: bottom) }
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
    }

    /// The replays for the page's rows now: built from what the page has,
    /// fetching what a game is missing once.
    func update(event: Event, detail: GameDetail, soccer: SoccerFeed?, football: FootballFeed, basketball: BasketballFeed) async {
        guard case let .espn(path, id, sport)? = event.ref else { return }
        let live = event.state == .live
        let nba = sport == .basketball && path == NBADetail.path
        let supported = [.baseball, .football, .soccer].contains(sport) || nba
        if supported != self.supported { self.supported = supported }
        guard supported else { return }
        let recent = nba && live && !basketball.recentPlays.isEmpty ? basketball.recentPlays : detail.recentPlays
        let ids = Replays.ids(detail, recent: recent)
        var context = ReplayContext(eventID: event.id, top: event.competitors.first, bottom: event.competitors.last, nba: nba,
                                    topIsHome: detail.topIsHome ?? false, people: detail.people, fielders: detail.fielders,
                                    lineups: detail.lineups)
        var next: [String: PlayReplay]
        switch sport {
        case .baseball:
            next = detail.replays.filter { ids.contains($0.key) }
            // MLB's account of each play: its feed fetched once for the game (the live lane keeps it current).
            if let lookup = Statcast.Lookup(event), !next.isEmpty {
                let atBats = await StatcastStore.shared.atBats(espnEvent: lookup.espnEvent, start: lookup.start, teams: lookup.teams)
                guard !Task.isCancelled else { return }
                context.numbers = StatcastStore.shared.numbers(espnEvent: lookup.espnEvent)
                for (key, replay) in next {
                    guard case .baseball(var play, let rest) = replay.scene, play.measured == nil else { continue }
                    play.measured = play.measurement(in: atBats) ?? play.runnerMeasurement(in: atBats)
                    next[key]?.scene = .baseball(play, rest: rest)
                }
            }
        case .soccer:
            next = soccer?.replays.filter { ids.contains($0.key) } ?? [:]
        case .football:
            guard let homeIsTop = detail.topIsHome else { return }
            let teams = FootballFeed.Teams(event, topIsHome: homeIsTop)
            let league = path.split(separator: "/").last.map(String.init) ?? path
            let items = live && !football.entries.isEmpty ? football.entries
                : await archived(event, url: "https://sports.core.api.espn.com/v2/sports/football/leagues/\(league)/events/\(id)/competitions/\(id)/plays",
                                 normalize: { $0 })
            let found = league == "nfl" ? await depthCharts(event, teams: teams) : [:]
            guard !Task.isCancelled else { return }
            next = Replays.football(items, ids: ids, teams: teams, charts: found)
        case .basketball:
            guard let topIsHome = detail.topIsHome else { return }
            let items = await archived(event, url: "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/\(id)/competitions/\(id)/plays",
                                       normalize: BasketballFeed.normalized)
            guard !Task.isCancelled else { return }
            next = Replays.basketball(Replays.merged(items, live ? basketball.window : []), ids: ids, teams: BasketballFeed.Teams(event, topIsHome: topIsHome))
        default:
            return
        }
        if context != self.context { self.context = context }
        if next != plays { plays = next }
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
/// they're built from: the page's rows (the summary, the NBA lane's latest
/// plays) and the live lanes. Only this modifier follows the lanes, so a new
/// entry never runs the page again.
struct ReplaySync: ViewModifier {
    let replays: PageReplays
    let detail: GameDetail?
    let event: Event
    let soccer: SoccerFeed?
    let football: FootballFeed
    let basketball: BasketballFeed

    private struct Key: Equatable {
        var event: String
        var state: EventState
        var rows: Set<String>
        var baseball: [String: PlayReplay]
        var people: Int
        /// What each lane last brought.
        var soccer: Int
        var football: Date?
        var basketball: Date?
        var latest: [GameDetail.RecentPlay]
    }

    func body(content: Content) -> some View {
        content.environment(replays).task(id: key) {
            guard let detail else { return }
            await replays.update(event: event, detail: detail, soccer: soccer, football: football, basketball: basketball)
        }
    }

    private var key: Key? {
        guard let detail else { return nil }
        let live = event.state == .live
        return Key(event: event.id, state: event.state, rows: Replays.ids(detail, recent: detail.recentPlays), baseball: detail.replays,
                   people: detail.people.count, soccer: soccer?.replays.count ?? 0, football: live ? football.theater.heard : nil,
                   basketball: live ? basketball.theater.heard : nil, latest: live ? basketball.recentPlays : [])
    }
}
