import Foundation
import Observation

/// ESPN's real-time NBA lane while a game page is open: the clock every few
/// seconds (two requests of a few hundred bytes), and the newest plays only
/// when the situation points at one we haven't read. The game summary
/// (refreshed every 30 seconds) stays the full record; this lane adds the
/// shots, scores and moments that came after it.
@MainActor
@Observable
final class BasketballFeed {
    /// Field-goal attempts among the newest plays.
    private(set) var shots: [GameDetail.Shot] = []
    /// The score after each scoring play among the newest plays.
    private(set) var flow: [GameDetail.FlowPoint] = []
    /// The newest plays as the court uses them (the live trail, possession),
    /// edits and deletions included: splice over the summary's with `NBADetail.plays`.
    private(set) var plays: [GameDetail.CourtPlay] = []
    /// The last few plays, newest first ("Q3 4:12  …").
    private(set) var recentPlays: [String] = []
    private(set) var score: LiveScore?
    /// The period of the newest play, the one `score` is read from (the
    /// linescore puts the points since the summary in this period's cell).
    private(set) var period: Int?
    /// "4:12 - 3rd", "Halftime", "End of 3rd".
    private(set) var clock: String?
    /// The game clock from 5-second readings, so it ticks only while really running.
    private(set) var gameClock: GameClock?
    /// Game seconds played at the last reading (the game flow runs to here).
    private(set) var elapsed: Double?
    /// True once the play feed has been read.
    private(set) var loaded = false
    /// The status says the game is on (halftime included). Everything below
    /// is live information, cleared when it isn't.
    private(set) var playing = false
    /// Who has the ball (the data spec's rule, right 97.7% of the times it
    /// decides); while a shot is in the air, the team that shot it. Nil
    /// before a play decides it, after a period ends, and once the game isn't on.
    /// The hero and the docked scorebar read this, `ballInAir` (the glyph
    /// dims while a shot is up) and `clutch`.
    private(set) var possession: GameDetail.Side?
    /// A missed shot or last free throw waiting for its rebound.
    private(set) var ballInAir = false
    /// The last five minutes of the fourth or overtime, within five.
    private(set) var clutch = false
    /// Players on fire: straight makes (`NBADetail.fireStreak` or more) by athlete ID.
    private(set) var streaks: [String: Int] = [:]
    /// ESPN's scoring run while one is on (8+ points of margin): the game
    /// flow's band. Empty between runs and in finished games (the summary
    /// carries no runs).
    private(set) var runs: [Run] = []
    /// The basketball theater's newest play worth replaying, and whether it's
    /// news. Assigned only when it changes, so a clock reading doesn't redraw
    /// the theater (and the page never reads it: the theater does).
    private(set) var theater = BasketballTheaterState()
    /// The newest plays, in ESPN's order (game order).
    @ObservationIgnored private var window: [JSON] = []
    /// Index in ESPN's full play list of `window[0]`.
    @ObservationIgnored private var windowStart = 0
    @ObservationIgnored private var fetched: Int?
    @ObservationIgnored private var lastPlayRef: String?
    @ObservationIgnored private var newestID: String?
    /// Plays that arrived since the page opened, as moments for the page to take.
    @ObservationIgnored private var moments: [LiveMoment] = []
    /// Each play announced as a moment, as it was announced: an edit can take
    /// it back or make it bigger.
    @ObservationIgnored private var announced: [String: LiveMoment] = [:]
    /// Moments whose play was deleted or edited into less, since the last call.
    @ObservationIgnored private var retracted: [String] = []
    @ObservationIgnored private var primed = false
    @ObservationIgnored private var updating = false
    /// Looks at the play list so far, and the look each play was first seen
    /// in: ESPN adds blocks and refines dunks about 30 s late, and those only
    /// celebrate while the play is still news.
    @ObservationIgnored private var looks = 0
    @ObservationIgnored private var firstSeen: [String: Int] = [:]
    @ObservationIgnored private var teams: Teams?
    /// The status endpoint's word on whether the game is on (nil: no reading yet).
    @ObservationIgnored private var statusLive: Bool?

    private static let pageSize = 50
    /// Plays re-read behind the newest, so recent rewrites are always seen.
    private static let lookBack = 20
    /// Enough history to see where a run started.
    private static let windowSize = 150
    /// A run (by margin: 10–2 is 8) is news when it reaches each of these.
    static let runMilestones = [8, 12, 16, 20, 24, 28]

    /// A scoring run: who's on it, from its first play to its newest, and
    /// its points against the other team's ("12–0", "10–2").
    struct Run: Equatable {
        let team: GameDetail.Side
        /// Game seconds at its first play, and at its newest.
        let start: Double
        let end: Double
        let larger: Int
        let smaller: Int
        var label: String { "\(larger)–\(smaller) run" }
        var span: ClosedRange<Double> { start...max(start, end) }
    }

    struct Teams {
        let topIsHome: Bool
        let topID: String?
        let bottomID: String?
        let topName: String
        let bottomName: String
        func side(_ id: String?) -> GameDetail.Side? {
            guard let id else { return nil }
            return id == topID ? .top : id == bottomID ? .bottom : nil
        }
        func name(_ side: GameDetail.Side) -> String { side == .top ? topName : bottomName }
        /// Top − bottom.
        func margin(_ score: LiveScore) -> Int { topIsHome ? score.home - score.away : score.away - score.home }
        /// "LAL 74–71", leader first; "Tied 74–74".
        func line(_ score: LiveScore) -> String {
            let (top, bottom) = topIsHome ? (score.home, score.away) : (score.away, score.home)
            if top == bottom { return "Tied \(top)–\(bottom)" }
            return top > bottom ? "\(topName) \(top)–\(bottom)" : "\(bottomName) \(bottom)–\(top)"
        }
    }

    func update(eventID: String, teams: Teams) async {
        guard !updating else { return }
        updating = true
        defer { updating = false }
        self.teams = teams
        let base = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/\(eventID)/competitions/\(eventID)"
        guard let situationURL = URL(string: "\(base)/situation"), let statusURL = URL(string: "\(base)/status") else { return }
        async let situationCall = try? JSON.fetch(situationURL)
        async let statusCall = try? JSON.fetch(statusURL)
        let (situation, status) = await (situationCall, statusCall)
        if let status { read(status) }
        guard let situation else { return }
        // New plays only when the last one changed.
        let lastRef = situation["lastPlay"]["$ref"].string
        if lastRef != lastPlayRef || !loaded {
            await loadPlays(base: base, teams: teams)
            // The play feed can trail the situation by a few seconds: keep
            // asking until it has the play the situation points to.
            if !Task.isCancelled, lastRef.flatMap(Self.playID) == nil || lastRef.flatMap(Self.playID) == newestID {
                lastPlayRef = lastRef
            }
        }
    }

    /// The summary's linescore with this lane's score in it, while the game
    /// is on (`NBADetail.linescore`): T matches the hero instead of trailing
    /// it by up to 30 seconds.
    func linescore(_ summary: GameDetail.Linescore, topIsHome: Bool) -> GameDetail.Linescore {
        guard playing, let score else { return summary }
        let lane = topIsHome ? (top: score.home, bottom: score.away) : (top: score.away, bottom: score.home)
        return NBADetail.linescore(summary, lane: lane, period: period)
    }

    /// The moments since the last call.
    func takeMoments() -> [LiveMoment] {
        defer { moments = [] }
        return moments
    }

    /// Plays whose moment was taken back (deleted, or edited into less) since the last call.
    func takeRetractions() -> [String] {
        defer { retracted = [] }
        return retracted
    }

    private func read(_ status: JSON) {
        guard status["type"]["state"].string == "in", let text = status["type"]["shortDetail"].string else {
            clock = nil
            gameClock = nil
            statusLive = false
            set(\.playing, false)
            set(\.possession, nil)
            set(\.ballInAir, false)
            set(\.clutch, false)
            set(\.streaks, [:])
            set(\.runs, [])
            return
        }
        statusLive = true
        set(\.playing, true)
        clock = text
        if let seconds = status["clock"].double, let period = status["period"].int {
            gameClock = GameClock(seconds: seconds, sampledAt: .now, period: period, direction: .down,
                                  display: text, running: false).reading(after: gameClock)
            elapsed = NBADetail.elapsed(period: period, clock: status["displayClock"].string ?? "")
            if let teams, let score {
                set(\.clutch, NBADetail.clutch(period: period, secondsLeft: seconds, margin: teams.margin(score)))
            }
        }
    }

    /// Writes only real changes, so views reading a value don't redraw for nothing.
    private func set<Value: Equatable>(_ key: ReferenceWritableKeyPath<BasketballFeed, Value>, _ value: Value) {
        if self[keyPath: key] != value { self[keyPath: key] = value }
    }

    private func loadPlays(base: String, teams: Teams) async {
        // First look: start a couple of pages from the end, not at tip-off
        // (the summary already has the game so far).
        if fetched == nil {
            guard let url = URL(string: "\(base)/plays?limit=1"), let head = try? await JSON.fetch(url) else { return }
            fetched = max((head["count"].int ?? 0) - 2 * Self.pageSize, 0)
        }
        guard let known = fetched else { return }
        // Re-read from a little before the newest known play, whole pages:
        // ESPN rewrites a third of shots under the same ID (a placeholder
        // becomes a jumper, a block is added), median 30 s later, and deletes
        // or splices in a few.
        var page = max(known - Self.lookBack, 0) / Self.pageSize + 1
        let start = (page - 1) * Self.pageSize
        var fresh: [JSON] = []
        var total = known
        var complete = false
        while !Task.isCancelled, let url = URL(string: "\(base)/plays?limit=\(Self.pageSize)&page=\(page)"),
              let json = try? await JSON.fetch(url) {
            let items = json["items"].array
            fresh += items.map(Self.normalized)
            total = (page - 1) * Self.pageSize + items.count
            if page >= (json["pageCount"].int ?? page) || items.isEmpty {
                complete = true
                break
            }
            page += 1
        }
        // A partial read would drop plays we have; the next look tries again.
        guard complete, !Task.isCancelled else { return }

        let freshIDs = Set(fresh.compactMap { $0["id"].string })
        // Keep what came before the re-read; it replaces everything from there on.
        let firstLook = window.isEmpty
        let keep = firstLook ? 0 : max(0, min(start - windowStart, window.count))
        var next = window.prefix(keep).filter { !freshIDs.contains($0["id"].string ?? "") } + fresh
        var nextStart = firstLook ? start : windowStart
        if next.count > Self.windowSize {
            let drop = next.count - Self.windowSize
            next.removeFirst(drop)
            nextStart += drop
        }
        fetched = total
        ingest(next, start: nextStart, teams: teams)
    }

    /// One complete look at the newest plays (in ESPN's order; `start` is the
    /// index of the first in the full list): new plays become moments, edits
    /// to announced ones are reconciled, and everything derived (shots, flow,
    /// possession, streaks, the run) is recomputed from the whole window.
    /// The first look is history: nothing in it is news.
    func ingest(_ next: [JSON], start: Int, teams: Teams) {
        self.teams = teams
        looks += 1
        let previous = Set(window.compactMap { $0["id"].string })
        window = next
        windowStart = start
        newestID = window.last?["id"].string
        if let latest = window.last.flatMap(LiveScore.init) {
            score = latest
            set(\.period, window.last?["period"]["number"].int)
        }
        let ids = window.compactMap { $0["id"].string }
        for id in ids where firstSeen[id] == nil { firstSeen[id] = looks }
        if firstSeen.count > ids.count + 40 {
            let current = Set(ids)
            firstSeen = firstSeen.filter { current.contains($0.key) }
        }

        // Until a complete look it's history; after, new plays are news. A play
        // spliced in before one already seen (entered late) isn't "now".
        if primed {
            // How many looks ago each play first appeared.
            var ages: [String: Int] = [:]
            for id in ids { ages[id] = looks - (firstSeen[id] ?? looks) }
            // Announced plays ESPN has since deleted or rewritten.
            let edits = Self.reconcile(announced, in: window, teams: teams, fromTipOff: windowStart == 0, ages: ages)
            moments += edits.upgraded
            retracted += edits.retracted
            announced = edits.announced
            let lastSeen = window.lastIndex { previous.contains($0["id"].string ?? "") } ?? -1
            for index in window.indices where index > lastSeen {
                if var moment = Self.moment(at: index, in: window, teams: teams, fromTipOff: windowStart == 0) {
                    moment.facts = ScoringFacts(nba: window[index], topIsHome: teams.topIsHome)
                    moments.append(moment)
                    announced[moment.id] = moment
                }
            }
            // Only recent plays can still change what's on screen.
            if announced.count > 40 {
                let recent = Set(window.suffix(40).compactMap { $0["id"].string })
                announced = announced.filter { recent.contains($0.key) }
            }
        }
        primed = true
        loaded = true

        let newShots = window.compactMap { NBADetail.shot($0, side: teams.side) }
        if newShots != shots { shots = newShots }
        let court = NBADetail.courtPlays(window, side: teams.side, topIsHome: teams.topIsHome)
        if court != plays { plays = court }
        var points: [GameDetail.FlowPoint] = []
        for play in window where play["scoringPlay"].bool == true {
            if let point = NBADetail.flowPoint(play, after: points.last, topIsHome: teams.topIsHome) { points.append(point) }
        }
        if points != flow { flow = points }
        let recent = NBADetail.recentPlays(window)
        if recent != recentPlays { recentPlays = recent }
        derive(court, teams: teams)
        updateTheater(teams: teams)
    }

    /// The theater's play: the newest worth replaying among the newest plays
    /// (only those are read). It's news if it arrived after the first
    /// complete look and is still recent (a block or an assist ESPN adds a
    /// few looks late still counts), or if it only just happened.
    private func updateTheater(teams: Teams) {
        guard let scene = BasketballScene.newest(in: window, teams: teams) else { return }
        // The first look is history: a play is news only from a later look it first appeared in.
        let seen = firstSeen[scene.id] ?? looks
        let fresh = seen > 1 && looks - seen <= 3
        let next = Self.theater(scene, after: theater, fresh: fresh, now: .now)
        if next != theater { theater = next }
    }

    /// The theater after a look at the plays. A play already showing keeps
    /// what it was (news or not), edits and all. (pure; tested)
    static func theater(_ scene: BasketballScene, after previous: BasketballTheaterState, fresh: Bool, now: Date) -> BasketballTheaterState {
        var next = previous
        next.news = scene.id == previous.scene?.id ? previous.news
            : fresh || scene.wallclock.map { now.timeIntervalSince($0) < BaseballFeed.recent } == true
        next.scene = scene
        return next
    }

    /// The live state recomputed from the whole window each look (never
    /// incrementally: ESPN edits, deletes and splices plays).
    private func derive(_ court: [GameDetail.CourtPlay], teams: Teams) {
        // The status decides when it has spoken; until then, the plays (on until "End of Game").
        let ended = window.last.flatMap(NBADetail.periodEnd)?.final == true
        set(\.playing, statusLive ?? !ended)
        let ball = playing ? NBADetail.ball(court) : NBADetail.Ball()
        set(\.possession, ball.side)
        set(\.ballInAir, ball.inAir)
        guard playing else {
            set(\.streaks, [:])
            set(\.runs, [])
            set(\.clutch, false)
            return
        }
        set(\.streaks, NBADetail.streaks(court).filter { $0.value >= NBADetail.fireStreak })
        set(\.runs, Self.activeRun(in: window, teams: teams).map { [$0] } ?? [])
        // Clutch from the newest play until the status has a fresher clock.
        if gameClock == nil, let last = window.last, let period = last["period"]["number"].int,
           let left = NBADetail.seconds(last["clock"]["displayValue"].string ?? ""), let score {
            set(\.clutch, NBADetail.clutch(period: period, secondsLeft: left, margin: teams.margin(score)))
        } else if let reading = gameClock, let score {
            set(\.clutch, NBADetail.clutch(period: reading.period, secondsLeft: reading.seconds, margin: teams.margin(score)))
        }
    }

    /// ESPN's scoring run, while it's on: the newest play carries it. It
    /// starts at the play ESPN names (or the earliest we have that carries it).
    static func activeRun(in plays: [JSON], teams: Teams) -> Run? {
        guard let last = plays.last, let run = scoringRun(last), let team = teams.side(run.team) else { return nil }
        let first = plays.first { $0["id"].string == run.start } ?? plays.first { scoringRun($0)?.start == run.start }
        func elapsed(_ play: JSON?) -> Double? {
            guard let play, let period = play["period"]["number"].int else { return nil }
            return NBADetail.elapsed(period: period, clock: play["clock"]["displayValue"].string ?? "")
        }
        guard let start = elapsed(first), let end = elapsed(last) else { return nil }
        return Run(team: team, start: start, end: max(start, end), larger: run.larger, smaller: run.smaller)
    }

    // MARK: Moments

    /// Announced plays against ESPN's current list: a play that's gone, or
    /// edited into less (a basket overturned), is taken back; one edited into
    /// more (a placeholder that turns out to be a three) is news again.
    /// `ages`: how many looks ago each play first appeared (missing: this look).
    static func reconcile(_ announced: [String: LiveMoment], in window: [JSON], teams: Teams, fromTipOff: Bool = false,
                          ages: [String: Int] = [:])
        -> (upgraded: [LiveMoment], retracted: [String], announced: [String: LiveMoment]) {
        let indices = Dictionary(window.enumerated().compactMap { i, p in p["id"].string.map { ($0, i) } },
                                 uniquingKeysWith: { _, last in last })
        var upgraded: [LiveMoment] = [], retracted: [String] = [], kept = announced
        for (id, was) in announced {
            guard let index = indices[id] else {
                retracted.append(id)
                kept[id] = nil
                continue
            }
            let now = moment(at: index, in: window, teams: teams, fromTipOff: fromTipOff, age: ages[id] ?? 0, was: was)
            if let now, now.tier > was.tier {
                upgraded.append(now)
                kept[id] = now
            } else if now.map({ $0.tier < was.tier }) ?? true || basketTakenBack(was, now) {
                retracted.append(id)
                kept[id] = now
            }
        }
        return (upgraded, retracted, kept)
    }

    /// A made basket that's now a miss (or gone).
    private static func basketTakenBack(_ was: LiveMoment, _ now: LiveMoment?) -> Bool {
        guard case .made = was.kind else { return false }
        if case .made? = now?.kind { return false }
        return now?.kind != .run && now?.kind != .leadChange
    }

    /// The play at `index` as a moment, from its structured fields (never its
    /// text): the end of a period; a lead changing hands in the fourth or
    /// overtime; ESPN's scoring run (8+ points of margin) appearing or growing
    /// by another 4; a shot's story (make, miss, block); a steal. One moment
    /// per play, the biggest thing it did.
    ///
    /// A make's tier: a two is routine and a three a swing; a dunk, an and-one
    /// and the pressure of clutch time or a hot hand each raise it one (to
    /// score at most); a buzzer-beater is a score, decisive when it ties or
    /// wins at the end of the fourth or overtime.
    ///
    /// ESPN adds blocks and steals, refines placeholder shots into dunks and
    /// logs and-one fouls after the fact. Those celebrate only while the play
    /// is still news (`age`: looks since it first appeared; a block or steal
    /// within 2, an and-one within 1, a dunk on first sight or while among the
    /// newest 3 plays). Later, the court just updates. Whatever `was`
    /// announced stays: an edit never takes back an accent.
    /// `fromTipOff`: `plays` starts at the opening tip.
    static func moment(at index: Int, in plays: [JSON], teams: Teams, fromTipOff: Bool = false,
                       age: Int = 0, was: LiveMoment? = nil) -> LiveMoment? {
        let play = plays[index]
        guard let id = play["id"].string else { return nil }
        let text = NBADetail.short(play["text"].string ?? "")
        let side = teams.side(play["team"]["id"].string)

        if let end = NBADetail.periodEnd(play) {
            guard let score = LiveScore(play) else { return nil }
            return LiveMoment(id: id, chart: .court, tier: .swing, kind: .periodEnd,
                              lead: end.final ? "Final" : "End of \(NBADetail.periodName(end.period))", detail: teams.line(score))
        }
        let shot = play["shootingPlay"].bool == true && !NBADetail.isFreeThrow(play)
        let scored = play["scoringPlay"].bool == true && (play["scoreValue"].int ?? 1) > 0
        let basket = shot ? shotMoment(at: index, in: plays, teams: teams, fromTipOff: fromTipOff, age: age, was: was) : nil

        if scored, index > 0 || fromTipOff, let after = LiveScore(play) {
            let before = index > 0 ? LiveScore(plays[index - 1]) : LiveScore(home: 0, away: 0)
            // A buzzer-beater (or a pressure basket raised to a score) outranks the story it's part of.
            if let basket, basket.tier == .score { return basket }
            if let before {
                let marginBefore = teams.margin(before), marginAfter = teams.margin(after)
                let scorer: GameDetail.Side? = marginAfter > marginBefore ? .top : marginAfter < marginBefore ? .bottom : side
                // Lead changes: the last team ahead (ties don't count) loses it, late.
                if (play["period"]["number"].int ?? 0) >= 4, marginAfter != 0,
                   let earlier = lastLeader(before: index, in: plays, teams: teams),
                   earlier != marginAfter.signum() {
                    var change = LiveMoment(id: id, chart: .court, tier: .swing, kind: .leadChange, lead: "Lead change",
                                            detail: "\(text) · \(teams.line(after))", side: scorer)
                    change.accents = basket?.accents ?? []
                    return change
                }
                // Runs: ESPN's own (core plays carry `scoringRun` while one of 8+
                // points' margin is on), news when it starts or grows past a milestone.
                if let run = scoringRun(plays[index]) {
                    let earlier = index > 0 ? scoringRun(plays[index - 1]).flatMap { $0.start == run.start ? $0 : nil } : nil
                    let before = earlier.map { $0.larger - $0.smaller } ?? 0, now = run.larger - run.smaller
                    if runMilestones.contains(where: { before < $0 && now >= $0 }) {
                        let team = teams.side(run.team) ?? scorer
                        var moment = LiveMoment(id: id, chart: .court, tier: .swing, kind: .run, lead: "\(run.larger)–\(run.smaller) run",
                                                detail: [team.map(teams.name), text].compactMap { $0 }.joined(separator: " · "), side: team)
                        moment.accents = basket?.accents ?? []
                        moment.span = activeRun(in: Array(plays[...index]), teams: teams)?.span
                        return moment
                    }
                }
            }
        }
        if let basket { return basket }
        // A steal: a turnover with a second participant (the defender who took it).
        if let type = play["type"]["id"].int, NBADetail.turnoverTypes.contains(type) {
            let people = NBADetail.participants(play)
            guard people.count > 1, age <= 2 || was?.kind == .steal else { return nil }
            return LiveMoment(id: id, chart: .court, tier: .swing, kind: .steal, lead: "Steal", detail: text,
                              side: side?.opponent, targets: [people[1]])
        }
        return nil
    }

    /// A field-goal attempt's moment: a make with its accents, a block, or a miss.
    private static func shotMoment(at index: Int, in plays: [JSON], teams: Teams, fromTipOff: Bool, age: Int,
                                   was: LiveMoment?) -> LiveMoment? {
        let play = plays[index]
        guard let id = play["id"].string else { return nil }
        let text = NBADetail.short(play["text"].string ?? "")
        let side = teams.side(play["team"]["id"].string)
        let people = NBADetail.participants(play)
        let period = play["period"]["number"].int ?? 0
        let clock = play["clock"]["displayValue"].string ?? ""
        guard play["scoringPlay"].bool == true, (play["scoreValue"].int ?? 1) > 0 else {
            // A block: a miss with a second participant (the blocker).
            if people.count > 1, age <= 2 || was?.kind == .block {
                return LiveMoment(id: id, chart: .court, tier: .swing, kind: .block, lead: "Block", detail: text,
                                  side: side?.opponent, targets: [people[1]])
            }
            return LiveMoment(id: id, chart: .court, tier: .routine, kind: .missed, lead: "Miss", detail: text, side: side)
        }
        let value = play["pointsAttempted"].int ?? play["scoreValue"].int ?? 2
        let after = LiveScore(play)
        let before = index > 0 ? LiveScore(plays[index - 1]) : fromTipOff ? LiveScore(home: 0, away: 0) : nil
        // The shooter's margin before and after (top's margin, from the shooter's side).
        let sign = side == .bottom ? -1 : 1
        let marginBefore = (before ?? after).map { teams.margin($0) * sign }
        let marginAfter = after.map { teams.margin($0) * sign }

        var accents: LiveMoment.Accents = []
        if let type = play["type"]["id"].int, NBADetail.dunkTypes.contains(type),
           age == 0 || index >= plays.count - 3 || was?.accents.contains(.dunk) == true {
            accents.insert(.dunk)
        }
        if andOne(at: index, in: plays, teams: teams), age <= 1 || was?.accents.contains(.andOne) == true {
            accents.insert(.andOne)
        }
        if NBADetail.buzzer(clock: clock) {
            accents.insert(.buzzer)
            if period >= 4, let b = marginBefore, let a = marginAfter, b <= 0, a >= 0 { accents.insert(.decisive) }
        }
        let streak = makes(endingAt: index, in: plays)
        if NBADetail.isFireMilestone(streak) { accents.insert(.onFire) }
        if let left = NBADetail.seconds(clock), let margin = marginBefore,
           NBADetail.clutch(period: period, secondsLeft: left, margin: margin) {
            accents.insert(.clutch)
        }
        // An edit never takes an accent back.
        if let was, case .made = was.kind { accents.formUnion(was.accents) }

        let tier: LiveMoment.Tier
        if accents.contains(.buzzer) {
            tier = .score
        } else {
            var rank = value >= 3 ? 1 : 0
            if accents.contains(.dunk) { rank += 1 }
            if accents.contains(.andOne) { rank += 1 }
            if !accents.isDisjoint(with: [.clutch, .onFire]) { rank += 1 }
            tier = LiveMoment.Tier(rawValue: LiveMoment.Tier.routine.rawValue + min(rank, 2)) ?? .score
        }
        let lead = accents.contains(.buzzer) ? "Buzzer-beater"
            : accents.contains(.andOne) ? (value >= 3 ? "Four-point play" : "And-one")
            : accents.contains(.dunk) ? "Dunk"
            : value >= 3 ? "Three" : "Two"
        var moment = LiveMoment(id: id, chart: .court, tier: tier, kind: .made(value: value), lead: lead,
                                detail: accents.contains(.onFire) ? "\(text) · \(max(streak, was?.streak ?? 0)) straight" : text,
                                side: side)
        moment.accents = accents
        if accents.contains(.onFire) { moment.streak = max(streak, was?.streak ?? 0) }
        return moment
    }

    /// A make with a shooting foul by the other team at the same period and
    /// clock (the free throw may not be in yet): 204 of 204 in the data spec.
    nonisolated static func andOne(at index: Int, in plays: [JSON], teams: Teams) -> Bool {
        let play = plays[index]
        let period = play["period"]["number"].int, clock = play["clock"]["displayValue"].string
        let shooter = teams.side(play["team"]["id"].string)
        for next in plays[(index + 1)...].prefix(8) {
            guard next["period"]["number"].int == period, next["clock"]["displayValue"].string == clock else { break }
            if next["type"]["id"].int == 44 {
                let fouler = teams.side(next["team"]["id"].string)
                if fouler == nil || shooter == nil || fouler != shooter { return true }
            }
        }
        return false
    }

    /// The shooter's straight makes through `index` (field goals only, by game order).
    static func makes(endingAt index: Int, in plays: [JSON]) -> Int {
        guard let shooter = NBADetail.participants(plays[index]).first else { return 0 }
        var count = 0
        for play in plays[...index].reversed() {
            guard play["shootingPlay"].bool == true, !NBADetail.isFreeThrow(play),
                  NBADetail.participants(play).first == shooter else { continue }
            guard play["scoringPlay"].bool == true else { break }
            count += 1
        }
        return count
    }

    /// The sign of the margin the last time a team was ahead before `index`
    /// (nil if nobody led within the plays we have).
    private static func lastLeader(before index: Int, in plays: [JSON], teams: Teams) -> Int? {
        for j in stride(from: index - 1, through: 0, by: -1) {
            if let score = LiveScore(plays[j]), teams.margin(score) != 0 { return teams.margin(score).signum() }
        }
        return nil
    }

    /// A core play's `scoringRun`: the team on it, its points against the
    /// other team's, and the play it started with (its identity).
    static func scoringRun(_ play: JSON) -> (team: String?, larger: Int, smaller: Int, start: String?)? {
        let run = play["scoringRun"]
        guard let larger = run["larger"].int, let smaller = run["smaller"].int else { return nil }
        let start = run["play"]["$ref"].string.flatMap(playID) ?? run["play"]["id"].string
        return (FootballFeed.teamID(run["team"]["$ref"].string) ?? run["team"]["id"].string, larger, smaller, start)
    }

    // MARK: Parsing

    static func playID(_ ref: String) -> String? {
        ref.range(of: "/plays/").map { String(ref[$0.upperBound...].prefix { $0.isNumber }) }
    }

    /// Core plays name teams and players by link; the summary parsers expect
    /// `team.id` and `participants[].athlete.id` (shooter first). Each keeps
    /// its part ("shooter", "assister", "blocker"): the theater reads it.
    static func normalized(_ item: JSON) -> JSON {
        guard var raw = item.raw as? [String: Any] else { return item }
        if let id = FootballFeed.teamID(item["team"]["$ref"].string) { raw["team"] = ["id": id] }
        let people = item["participants"].array.enumerated()
            .sorted { ($0.element["order"].int ?? $0.offset, $0.offset) < ($1.element["order"].int ?? $1.offset, $1.offset) }
        raw["participants"] = people.compactMap { entry -> [String: Any]? in
            var person: [String: Any]
            if let id = entry.element["athlete"]["id"].string {
                person = ["athlete": ["id": id]]
            } else {
                guard let ref = entry.element["athlete"]["$ref"].string, let range = ref.range(of: "/athletes/") else { return nil }
                person = ["athlete": ["id": String(ref[range.upperBound...].prefix { $0.isNumber })]]
            }
            if let part = entry.element["type"].string { person["type"] = part }
            return person
        }
        return JSON(raw)
    }
}

extension LiveScore {
    init(home: Int, away: Int) {
        self.home = home
        self.away = away
    }
}
