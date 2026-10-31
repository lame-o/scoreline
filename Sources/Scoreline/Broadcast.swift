import AppKit
import Foundation
import Observation
import SwiftUI

// The game as one broadcast, part 7: the game page's model (BROADCAST.md §3).
//
// One per game page. It runs the engine (BroadcastEngine.swift) on what the
// page's lanes bring: the summary as it loads, the core plays and status as
// the fast lane reads them, the scoreboard as the store polls it. It sleeps
// until the next thing that changes on its own (a play's moment on p, the
// game clock stopping, a hold beginning) and publishes what's presented then.
// Nothing polls; nothing ticks per frame.
//
// Everything on the page that isn't a theater reads the presented state
// through it:
// - `present(event)`: the hero's and the docked bar's score, clock, period
//   and state, the menu bar's line for this game, the notifications;
// - `present(detail)`: the play lists (rows appear when their play is
//   told), the charts' plays, Win Probability (ESPN's per play, by event
//   time), the line score (from the told plays), the box score and team
//   stats (each summary's tables held until p passes that summary's
//   watermark);
// - `shows(id)`, `toldPlays`, `presentedNBA`…: the lanes' own lists, cut the same way;
// - `gate(_:)`: live moments wait for their play's moment (the moment slot,
//   the celebrations and the scoring slides take them then).
//
// The theaters read today's inputs until CHOREOGRAPHY Phase 0; the director
// reads this model through `BroadcastTheaterSource` (the timeline up to the
// watermark, the clock, the hints) and hands back its binding horizons and
// solved anchors.

/// What the theater director reads (CHOREOGRAPHY §10) and hands back.
@MainActor
protocol BroadcastTheaterSource: AnyObject {
    /// Bumps when the plays or what's told change: re-plan (observed).
    var revision: UInt64 { get }
    /// The presentation clock: `p(at:)` per frame; changes only on a re-plan (observed).
    var clock: PresentationClock { get }
    /// The plays up to the watermark, in order, with what's told; `pending`: known past it.
    func snapshot() -> TimelineSnapshot<RawPlay>
    /// The fast lane's word on the clock, on the event-time axis.
    var hints: [Hint] { get }
    /// Late binding: each kind's binding horizon (the delay re-sizes from them).
    func setBindingHorizons(_ horizons: BindingHorizons)
    /// The solved decisive moments: untold plays are presented there (one truth for score, lists and theater).
    func setAnchors(_ anchors: [String: PTime])
}

/// Wall time for the broadcast: the real clock, or the harness's virtual one.
struct BroadcastTime {
    var now: @MainActor () -> PTime
    static let live = BroadcastTime(now: { Date().timeIntervalSince1970 })
}

@MainActor
@Observable
final class Broadcast: BroadcastTheaterSource {
    /// What's presented now. Re-derived only at the moments it schedules.
    private(set) var presented = PresentedGame()
    /// The clock as planned; republished only when the plan changes what it presents.
    private(set) var clock = PresentationClock()
    /// Bumps when the plays or what's told change.
    private(set) var revision: UInt64 = 0
    /// This page is broadcasting (a live ESPN game with a play-by-play).
    private(set) var active = false
    /// The game's last play is told: the page may say Final.
    private(set) var ended = false
    /// Bumps when moments are released (their play just told): the page takes them (`takeReleased`).
    private(set) var releasedRevision = 0
    /// The score the user could already see when the page opened (or the Mac
    /// woke): the scoreboard's, and the scores list's. A shown score never
    /// steps back below it: each side shows max(p's score, the floor) until
    /// p's score reaches it on both sides; then it's gone for good. It goes
    /// too when the fast lane itself corrects below it (a genuine overturn), when
    /// a told play takes a score back (a VAR decision), and after `floorTimeout`.
    /// Only the score: the court and the lists still tell those plays at p, so
    /// the score leads them once, and only by what the user had already seen.
    private(set) var floor: ScoreLine?

    @ObservationIgnored private(set) var engine: BroadcastEngine<RawPlay>?
    /// This game's feed turned out to have no event times (a league that doesn't log wallclocks):
    /// presenting it behind live would only add delay, so it shows as today.
    @ObservationIgnored private(set) var unsupported = false
    @ObservationIgnored private(set) var sport: BroadcastSport?
    @ObservationIgnored private(set) var path = ""
    /// ESPN's event ID (MLB's feed is looked up by it).
    @ObservationIgnored private var espnID = ""
    @ObservationIgnored private(set) var topIsHome = false
    @ObservationIgnored private var eventID: String?
    @ObservationIgnored private var rawState = EventState.scheduled
    @ObservationIgnored private var lastScoreboard: FastReading?
    @ObservationIgnored private var lastStatus: FastReading?
    @ObservationIgnored private var wake: Task<Void, Never>?
    /// The real clock, or the harness's virtual one (and then it doesn't schedule itself: the harness steps it).
    @ObservationIgnored var time = BroadcastTime.live
    @ObservationIgnored var automatic = true
    /// Each summary's tables (box score, stats, leaders), held until p passes its watermark.
    @ObservationIgnored private var tables: [(watermark: PTime, detail: GameDetail)] = []
    /// Moments waiting for their play's moment, and those already offered.
    @ObservationIgnored private var pending: [String: (moment: LiveMoment, since: PTime)] = [:]
    @ObservationIgnored private var offered: Set<String> = []
    /// Fast-lane situations (baseball) by the play they follow: the diamond at p.
    @ObservationIgnored private var situations: [(play: String, situation: GameDetail.Baseball)] = []
    @ObservationIgnored private var memo: (key: [Int], detail: GameDetail)?
    @ObservationIgnored private var payloadMemo: (key: Int, plays: [JSON])?
    @ObservationIgnored private var nbaMemo: (key: [Int], live: NBALive)?
    /// Moments released since the page last took them.
    @ObservationIgnored private var released: [LiveMoment] = []
    /// When `presented` was published (its game clock ticks on from then).
    @ObservationIgnored private var presentedWall: PTime = 0
    /// When the floor was set (it lapses `floorTimeout` later).
    @ObservationIgnored private var floorSince: PTime = 0
    static let floorTimeout: Double = 120
    /// p's score when the floor was last settled (a drop since then is a told reversal).
    @ObservationIgnored private var settledScore: ScoreLine?

    /// The moments released since the last call (their play's moment came).
    func takeReleased() -> [LiveMoment] {
        defer { released = [] }
        return released
    }

    private func release(_ moments: [LiveMoment]) {
        guard !moments.isEmpty else { return }
        released += moments
        releasedRevision += 1
    }

    // MARK: Lifecycle

    /// The sport this event broadcasts as, if any: ESPN head-to-head games with a play-by-play.
    nonisolated static func sport(of event: Event) -> BroadcastSport? {
        guard case let .espn(_, _, sport)? = event.ref, case .match = event.content else { return nil }
        switch sport {
        case .basketball: return .basketball
        case .football: return .football
        case .soccer: return .soccer
        case .baseball: return .baseball
        default: return nil
        }
    }

    /// The page has its first load of a live game: start broadcasting it. A
    /// final, or a sport without a play-by-play, never starts (everything shows
    /// as today). `seen`: other copies of the game the user could already see
    /// (the scores list's, a lane's): with the event's own, they set the floor.
    func begin(_ event: Event, topIsHome: Bool, seen: [Event] = []) {
        guard !active, !unsupported, event.state == .live, let sport = Self.sport(of: event), case let .espn(path, id, _)? = event.ref else { return }
        self.sport = sport
        self.path = path
        espnID = id
        self.topIsHome = topIsHome
        eventID = event.id
        rawState = event.state
        engine = BroadcastEngine(sport: sport, policy: BroadcastLanes.policy(sport, path: path))
        active = true
        raiseFloor(to: ([event] + seen).compactMap(score(of:)), at: time.now())
    }

    /// A copy of the game's score, home and away.
    private func score(of event: Event) -> ScoreLine? {
        guard case let .match(top, bottom) = event.content, let t = top.score.flatMap({ Int($0) }),
              let b = bottom.score.flatMap({ Int($0) }) else { return nil }
        return topIsHome ? ScoreLine(home: t, away: b) : ScoreLine(home: b, away: t)
    }

    /// The floor: per side, the most the user could have seen.
    private func raiseFloor(to scores: [ScoreLine], at now: PTime) {
        guard let first = scores.first else { return }
        let seen = scores.dropFirst().reduce(first) { ScoreLine(home: max($0.home, $1.home), away: max($0.away, $1.away)) }
        let current = floor ?? seen
        floor = ScoreLine(home: max(current.home, seen.home), away: max(current.away, seen.away))
        floorSince = now
    }

    /// The score as shown: p's, held up per side by the floor while it stands. (pure; tested)
    static func shown(_ score: ScoreLine?, floor: ScoreLine?) -> ScoreLine? {
        guard let floor else { return score }
        guard let score else { return floor }
        return ScoreLine(home: max(score.home, floor.home), away: max(score.away, floor.away))
    }

    /// The floor goes once p's score has reached it on both sides, when a told
    /// play takes a score back (a VAR decision: the score the user saw is
    /// overturned on screen, so the floor goes with it), or after `floorTimeout`.
    private func settleFloor(now: PTime) {
        defer { settledScore = presented.score }
        guard let f = floor else { return }
        let reached = presented.score.map { $0.home >= f.home && $0.away >= f.away } ?? false
        let reversed = settledScore.flatMap { was in presented.score.map { $0.home < was.home || $0.away < was.away } } ?? false
        if reached || reversed || now - floorSince >= Self.floorTimeout { floor = nil }
    }

    /// The page closed (or another game took it): everything shows as today again.
    func end() {
        wake?.cancel()
        wake = nil
        engine = nil
        active = false
        ended = false
        presented = PresentedGame()
        tables = []
        pending = [:]
        offered = []
        floor = nil
        situations = []
        memo = nil
        payloadMemo = nil
        nbaMemo = nil
        released = []
    }

    // MARK: Lanes

    /// A summary arrived: its plays (parsed off the main actor as it loaded) and its tables.
    func ingest(summary detail: GameDetail, at arrived: PTime? = nil) {
        guard active, var engine else { return }
        let now = arrived ?? time.now()
        if let entries = detail.broadcastPlays {
            // A feed with plays but no event times can't be presented at p.
            if engine.timeline.isEmpty, entries.count >= 5, entries.allSatisfy({ $0.wallclock == nil }) {
                unsupported = true
                end()
                return
            }
            engine.ingest(LaneSnapshot(lane: .summary, entries: mlbTimed(entries), coverage: .full, arrived: now))
            // The tables are as of the summary's newest play.
            let watermark = entries.compactMap(\.wallclock).max() ?? now
            tables.append((watermark, detail))
            if tables.count > 8 { tables.removeFirst(tables.count - 8) }
        }
        self.engine = engine
        step(now: now)
    }

    /// A look at the core plays (a tail of the game, in order): NBA, football, soccer, baseball's fast lanes.
    func ingest(core items: [JSON], at arrived: PTime? = nil) {
        guard active, var engine, let sport else { return }
        let now = arrived ?? time.now()
        let entries = mlbTimed(BroadcastLanes.entries(items, sport: sport, policy: engine.policy))
        engine.ingest(LaneSnapshot(lane: .core, entries: entries, coverage: .tail, arrived: now))
        self.engine = engine
        step(now: now)
    }

    /// Baseball: ESPN's plays with MLB's own times, from the at-bats the page's Statcast store has.
    private func mlbTimed(_ entries: [TimelineEntry<RawPlay>]) -> [TimelineEntry<RawPlay>] {
        guard sport == .baseball, path == "baseball/mlb" else { return entries }
        let atBats = StatcastStore.shared.cached(espnEvent: espnID)
        return atBats.isEmpty ? entries : BroadcastLanes.timed(entries, with: BroadcastLanes.plateTimes(atBats))
    }

    /// A slow lane was read and had nothing new (the situation's last play hadn't changed).
    func noteRead(_ lane: LaneID = .core) {
        guard active, var engine else { return }
        let now = time.now()
        engine.noteRead(lane, at: now)
        self.engine = engine
        step(now: now)
    }

    /// The store's scoreboard copy of this game changed (a poll).
    func observe(scoreboard event: Event) {
        rawState = event.state
        guard active, var engine else { return }
        let now = time.now()
        if let reading = BroadcastLanes.reading(event, topIsHome: topIsHome, policy: engine.policy, previous: lastScoreboard, at: now) {
            // The fast lane correcting its own score downward is a genuine overturn: the floor goes.
            if let was = lastScoreboard?.score, let score = reading.score, score.home < was.home || score.away < was.away { floor = nil }
            lastScoreboard = reading
            engine.observe(reading)
        }
        settleFloor(now: now)
        self.engine = engine
        step(now: now)
    }

    /// The core status (NBA, football, baseball's fast lanes): the clock every few seconds.
    func observe(status: JSON?) {
        guard active, var engine, let status else { return }
        let now = time.now()
        if let reading = BroadcastLanes.reading(status: status, policy: engine.policy, previous: lastStatus, at: now) {
            lastStatus = reading
            engine.observe(reading)
        }
        self.engine = engine
        step(now: now)
    }

    /// Baseball: the fast lane's situation (count, outs, runners) after a play.
    func observe(situation: GameDetail.Baseball, after play: String?) {
        guard active, let play else { return }
        if situations.last?.play == play { situations[situations.count - 1].situation = situation } else { situations.append((play, situation)) }
        if situations.count > 200 { situations.removeFirst(situations.count - 200) }
    }

    // MARK: Stepping

    /// Brings the presentation to `now`: the engine's step, the moments told,
    /// what's presented published if it changed, and the next wake scheduled.
    func step(now: PTime? = nil) {
        guard active, var engine else { return }
        let now = now ?? time.now()
        let overridden = engine.timeline.guardOverrides.count
        let shownBefore = Self.shown(presented.score, floor: floor)
        let result = engine.advance(now: now)
        self.engine = engine
        // The order guard would have held a play the theater anchored: told at the anchor (one scheduler), and noted.
        for id in engine.timeline.guardOverrides.dropFirst(min(overridden, engine.timeline.guardOverrides.count)) {
            Log.theater.notice("order guard overridden by the theater's anchor for play \(id, privacy: .public)")
        }
        // Woke (or came back to the page): what the user could see then is the floor again.
        if result.events.contains(where: { if case .wake = $0 { true } else { false } }) {
            raiseFloor(to: [shownBefore, lastScoreboard?.score].compactMap { $0 }, at: now)
        }
        if !result.told.isEmpty { releaseMoments(result.told, now: now) }
        expireMoments(now: now)
        publish(now: now)
        settleFloor(now: now)
        if automatic { schedule(after: now) }
    }

    private func publish(now: PTime) {
        guard let engine else { return }
        var next = engine.presented(at: now)
        // A final with nothing left to tell ends a moment after its last play, even
        // if ESPN never logs the end.
        if !next.isFinal, rawState == .final, engine.timeline.nextUntold == nil,
           let last = engine.timeline.lastTold, engine.p(at: now) >= last.presentAt + 5 {
            next.phase = .final
        }
        // The game clock holds while the presentation clock does (a stall).
        if engine.clock.rate(at: now) == 0 { next.clock?.running = false }
        if Self.differs(next, from: presented, after: now - presentedWall) {
            presentedWall = now
            // New rows arrive as a page's do (stacked in, or a fade with Reduce Motion); the clock just ticks on.
            if next.told != presented.told {
                let reduce = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
                withAnimation(reduce ? Motion.fade : Motion.standard) { presented = next }
            } else {
                presented = next
            }
        }
        if next.isFinal != ended { ended = next.isFinal }
        if engine.timeline.revision != revision { revision = engine.timeline.revision }
        if !clock.presentsSame(as: engine.clock, from: now) { clock = engine.clock }
    }

    /// Whether the presented game changed in a way the page shows: a play
    /// told, a revision, the score, the phase, the period, the clock starting
    /// or stopping, or a running clock drifting more than 0.75 s from where the
    /// published one has ticked to (`elapsed` seconds later). A running clock
    /// alone never republishes: the page's clock text ticks itself. (pure)
    static func differs(_ next: PresentedGame, from old: PresentedGame, after elapsed: Double) -> Bool {
        guard next.told == old.told, next.revision == old.revision, next.score == old.score, next.phase == old.phase,
              next.period == old.period, next.lastID == old.lastID else { return true }
        switch (next.clock, old.clock) {
        case (nil, nil): return false
        case let (n?, o?):
            guard n.running == o.running, n.period == o.period else { return true }
            let expected = o.running ? o.elapsed + elapsed : o.elapsed
            return abs(n.elapsed - expected) > (o.running ? 0.75 : 0.05)
        default: return true
        }
    }

    private func schedule(after now: PTime) {
        wake?.cancel()
        guard let engine else { return }
        var at = engine.nextWake(after: now)
        // A final the feed never ends: check once its last play has had its moment.
        if rawState == .final, engine.timeline.nextUntold == nil, let last = engine.timeline.lastTold,
           let t = engine.clock.wall(reaching: last.presentAt + 5.01, after: now) {
            at = min(at ?? t, t)
        }
        // The floor lapses on its own.
        if floor != nil { at = min(at ?? .infinity, floorSince + Self.floorTimeout + 0.01) }
        // Moments for plays the timeline doesn't know expire after a minute.
        if let oldest = pending.values.map(\.since).min() { at = min(at ?? .infinity, oldest + 60.01) }
        guard let at, at.isFinite else { return }
        let delay = max(at - now, 0.001)
        wake = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.step()
        }
    }

    // MARK: Moments

    /// Live moments from the lanes, as the page takes them. Returns those to
    /// offer now (their play is already told, or it isn't a broadcast play);
    /// the rest wait for their play's moment (`release`). A moment for a play
    /// told as history or a correction is dropped (never news); an upgrade to
    /// a told play's moment is a quiet correction (dropped too).
    func gate(_ moments: [LiveMoment]) -> [LiveMoment] {
        guard active, let timeline = engine?.timeline else { return moments }
        let now = time.now()
        var out: [LiveMoment] = []
        for m in moments {
            if offered.contains(m.id) { continue }
            if let record = timeline.record(m.id), let reason = record.told {
                if reason == .onTime || reason == .late {
                    offered.insert(m.id)
                    out.append(m)
                }
                continue
            }
            pending[m.id] = (m, pending[m.id]?.since ?? now)
        }
        return out
    }

    /// Moments taken back (a basket overturned): those waiting are dropped
    /// silently; returns the IDs already offered (the page takes them back).
    func retract(_ ids: [String]) -> [String] {
        guard active else { return ids }
        for id in ids { pending[id] = nil }
        return ids.filter { offered.remove($0) != nil }
    }

    private func releaseMoments(_ told: [GameTimeline<RawPlay>.Record], now: PTime) {
        var out: [LiveMoment] = []
        for record in told {
            guard let waiting = pending.removeValue(forKey: record.id) else { continue }
            if record.told == .onTime || record.told == .late {
                offered.insert(record.id)
                out.append(waiting.moment)
            }
        }
        release(out)
    }

    /// A moment whose play never reached the timeline (a lane it doesn't read) goes after a minute rather than never.
    private func expireMoments(now: PTime) {
        guard let timeline = engine?.timeline else { return }
        let stale = pending.filter { !timeline.knows($0.key) && now - $0.value.since > 60 }
        guard !stale.isEmpty else { return }
        for id in stale.keys {
            pending[id] = nil
            offered.insert(id)
        }
        release(stale.values.map(\.moment))
    }

    // MARK: Presenting

    /// Whether a play-keyed item shows: told plays do, untold ones wait.
    /// Items the timeline doesn't know (a synthesized ID) show as today.
    func shows(_ id: String?) -> Bool {
        guard active, let id, let timeline = engine?.timeline else { return true }
        _ = presented
        return timeline.isTold(id) || !timeline.knows(id)
    }

    /// The presentation time now (nil while not broadcasting).
    var p: PTime? {
        guard active, let engine, engine.started else { return nil }
        return engine.p(at: time.now())
    }

    /// The told plays' entries, in order (the lanes' parsers read them: recent plays, the at-bat, runs).
    var toldPlays: [JSON] {
        guard active, let timeline = engine?.timeline else { return [] }
        _ = presented
        let key = Int(truncatingIfNeeded: timeline.revision) &* 31 &+ timeline.toldCount
        if let memo = payloadMemo, memo.key == key { return memo.plays }
        let plays = timeline.records.prefix(timeline.toldCount).compactMap { $0.entry.payload.json.raw == nil ? nil : $0.entry.payload.json }
        payloadMemo = (key, plays)
        return plays
    }

    /// The event as presented: score, state, status and clock at p.
    func present(_ event: Event) -> Event {
        guard active, case let .match(top, bottom) = event.content, let sport, let engine else { return event }
        let game = presented
        guard game.phase != .pregame || game.score != nil else { return event }
        var t = top, b = bottom
        if let score = Self.shown(game.score, floor: floor) {
            t.score = "\(topIsHome ? score.home : score.away)"
            b.score = "\(topIsHome ? score.away : score.home)"
        }
        let state: EventState = game.isFinal ? .final : event.state == .scheduled ? .scheduled : .live
        let status = game.status(sport, regulationPeriods: engine.policy.regulationPeriods)
        var shown = event.with(state: state, content: .match(top: t, bottom: b), detail: .some(game.isFinal ? (event.state == .final ? event.detail ?? status : status) : status))
        shown.clock = game.clock.map { clock in
            let seconds = clock.countsDown ? clock.remaining : clock.elapsed
            return GameClock(seconds: seconds, sampledAt: Date(timeIntervalSince1970: presentedWall), period: clock.period,
                             direction: clock.countsDown ? .down : .up, display: status, running: clock.running)
        }
        if game.isFinal { shown.clock = nil }
        shown.possession = nil
        shown.liveLine = nil
        shown.snapshot = nil
        return shown
    }

    /// The detail as presented: play-keyed lists cut to what's told, the
    /// line score from the told plays, Win Probability at the last told play,
    /// the tables of the newest summary p has passed. `revision`: the page's
    /// count of loads (the memo's key).
    func present(_ detail: GameDetail?, revision loaded: Int, side: (String?) -> GameDetail.Side?) -> GameDetail? {
        guard active, let d = detail, let engine, engine.started else { return detail }
        let game = presented
        let p = engine.p(at: time.now())
        let held = heldTables(at: p)
        let key = [loaded, Int(truncatingIfNeeded: game.revision), game.told, held.index]
        if let memo, memo.key == key { return memo.detail }
        var out = d
        // Tables: as of the newest summary p has passed.
        if let tables = held.detail {
            out.stats = tables.stats
            if var nba = out.basketball, let old = tables.basketball {
                nba.topBox = old.topBox
                nba.bottomBox = old.bottomBox
                nba.topTotals = old.topTotals
                nba.bottomTotals = old.bottomTotals
                nba.leaders = old.leaders
                out.basketball = nba
            }
        }
        out.moments = d.moments.filter { shows($0.id) }
        out.recentPlays = recentPlays(d)
        if var nba = out.basketball {
            nba.shots = nba.shots.filter { shows($0.id) }
            nba.flow = nba.flow.filter { shows($0.id) }
            nba.plays = nba.plays.filter { shows($0.id) }
            out.basketball = nba
        }
        out.battedBalls = d.battedBalls.filter { shows($0.id) }
        if sport == .baseball {
            out.atBat = ESPNDetail.currentAtBat(toldPlays)
            out.battedBalls = ESPNDetail.battedBalls(toldPlays, side: side)
            out.baseball = presentedBaseball(d.baseball)
        }
        (out.topWinProbability, out.drawProbability) = win(d)
        out.odds = d.odds.map(presentedOdds)
        if let line = d.linescore { out.linescore = linescore(line, held: held.detail?.linescore) }
        memo = (key, out)
        return out
    }

    /// The tables to show at `p`: the newest summary whose watermark p has
    /// passed (before any has, the first: opening on a game in progress).
    private func heldTables(at p: PTime) -> (index: Int, detail: GameDetail?) {
        guard !tables.isEmpty else { return (-1, nil) }
        if let i = tables.lastIndex(where: { $0.watermark <= p }) { return (i, tables[i].detail) }
        return (0, tables[0].detail)
    }

    /// The last plays, newest first, as each sport's page lists them, from the told plays.
    private func recentPlays(_ d: GameDetail) -> [GameDetail.RecentPlay] {
        let told = toldPlays
        switch sport {
        case .basketball?:
            return told.isEmpty ? d.recentPlays.filter { shows($0.id) } : NBADetail.recentPlays(told)
        case .baseball?:
            return told.filter { $0["type"]["type"].string == "play-result" }.suffix(4).reversed()
                .compactMap { p in p["text"].string.map { GameDetail.RecentPlay(id: p["id"].string, text: $0) } }
        case .football?:
            return told.suffix(4).reversed().compactMap { p in p["text"].string.map { GameDetail.RecentPlay(id: p["id"].string, text: $0) } }
        case .soccer?:
            // Commentary: rows with a play show once it's told; a line without one ("Match ends") once the game has ended.
            let all = d.allRecentPlays.isEmpty ? d.recentPlays.reversed() : d.allRecentPlays
            let shown = all.filter { $0.id.map(shows) ?? presented.isFinal }
            return Array(shown.suffix(4).reversed())
        case nil:
            return d.recentPlays
        }
    }

    /// ESPN's win probability after the last told play that has one (soccer: and the draw).
    private func win(_ d: GameDetail) -> (Double?, Double?) {
        guard !d.winByPlay.isEmpty, let timeline = engine?.timeline else { return (d.topWinProbability, d.drawProbability) }
        for record in timeline.records.prefix(timeline.toldCount).reversed() {
            if let chance = d.winByPlay[record.id] {
                let top = topIsHome ? chance.home : max(1 - chance.home - chance.tie, 0)
                return (top, chance.tie > 0 ? chance.tie : nil)
            }
        }
        return (d.topWinProbability, d.drawProbability)
    }

    /// The odds chart's ESPN side up to p: its model's points and the plays, by event time.
    private func presentedOdds(_ baseline: OddsBaseline) -> OddsBaseline {
        guard let p else { return baseline }
        let until = Date(timeIntervalSince1970: p)
        var b = baseline
        b.espn = baseline.espn.filter { $0.t <= until }
        b.plays = baseline.plays.filter { $0.t <= until }
        b.periods = baseline.periods.filter { $0.start <= until }
        return b
    }

    /// The line score from the told plays, period by period (each cell the
    /// points scored in it, blank until it starts); a timeline that doesn't
    /// start at the game's start keeps the held summary's. Baseball's periods
    /// are half-innings: the top half's runs are the visitors', the bottom's the
    /// home side's; its hits and errors come with the held summary.
    private func linescore(_ line: GameDetail.Linescore, held: GameDetail.Linescore?) -> GameDetail.Linescore {
        guard let timeline = engine?.timeline, let first = timeline.records.first, first.entry.period <= 1,
              let total = line.headers.firstIndex(where: { $0 == "T" || $0 == "R" }), let score = presented.score else { return held ?? line }
        var at: [Int: ScoreLine] = [:]
        for record in timeline.records.prefix(timeline.toldCount) {
            if let s = record.entry.score { at[record.entry.period] = s }
        }
        let current = presented.period ?? 0
        func end(_ period: Int) -> ScoreLine {
            stride(from: period, through: 1, by: -1).lazy.compactMap { at[$0] }.first ?? ScoreLine(home: 0, away: 0)
        }
        let baseball = sport == .baseball
        var top = line.top, bottom = line.bottom
        for column in 0..<total where column < top.count && column < bottom.count {
            var home = "", away = ""
            if baseball {
                let topHalf = 2 * (column + 1) - 1, bottomHalf = topHalf + 1
                if topHalf <= current { away = "\(end(topHalf).away - end(topHalf - 1).away)" }
                if bottomHalf <= current { home = "\(end(bottomHalf).home - end(bottomHalf - 1).home)" }
            } else if column + 1 <= current {
                home = "\(end(column + 1).home - end(column).home)"
                away = "\(end(column + 1).away - end(column).away)"
            }
            top[column] = topIsHome ? home : away
            bottom[column] = topIsHome ? away : home
        }
        if total < top.count, total < bottom.count {
            top[total] = "\(topIsHome ? score.home : score.away)"
            bottom[total] = "\(topIsHome ? score.away : score.home)"
        }
        if baseball, let held, held.headers == line.headers {
            for i in (total + 1)..<line.headers.count where i < held.top.count && i < held.bottom.count && i < top.count {
                top[i] = held.top[i]
                bottom[i] = held.bottom[i]
            }
        }
        return GameDetail.Linescore(headers: line.headers, top: top, bottom: bottom)
    }

    /// The diamond as it stood after the last told play: the fast lane's
    /// situation recorded after it (or the nearest before it); else the count
    /// and outs from the told pitches.
    private func presentedBaseball(_ fallback: GameDetail.Baseball?) -> GameDetail.Baseball? {
        guard let timeline = engine?.timeline, let last = timeline.lastTold else { return fallback }
        let toldIDs = Set(timeline.records.prefix(timeline.toldCount).map(\.id))
        if let match = situations.last(where: { toldIDs.contains($0.play) }) { return match.situation }
        let pitches = ESPNDetail.currentAtBat(toldPlays)
        var balls = 0, strikes = 0
        for pitch in pitches {
            switch pitch.result {
            case .ball: balls = min(balls + 1, 3)
            case .strike: if pitch.strike != .foul || strikes < 2 { strikes = min(strikes + 1, 2) }
            case .inPlay: break
            }
        }
        let outs = last.entry.payload.json["outs"].int ?? fallback?.outs ?? 0
        return GameDetail.Baseball(balls: balls, strikes: strikes, outs: outs, onFirst: fallback?.onFirst ?? false,
                                   onSecond: fallback?.onSecond ?? false, onThird: fallback?.onThird ?? false,
                                   batter: fallback?.batter, pitcher: fallback?.pitcher, lastPlay: last.entry.text,
                                   runners: fallback?.runners ?? [nil, nil, nil], batterID: fallback?.batterID,
                                   pitcherID: fallback?.pitcherID, runnerIDs: fallback?.runnerIDs ?? [nil, nil, nil])
    }

    // MARK: Lanes' derived state, at p

    /// The NBA's live state from the told plays: who has the ball, a shot in
    /// the air, clutch time, the run on, players on fire.
    struct NBALive: Equatable {
        var possession: GameDetail.Side?
        var inAir = false
        var clutch = false
        var run: BasketballFeed.Run?
        var streaks: [String: Int] = [:]
        /// Game seconds played at p (the court's trail and the flow run to here).
        var elapsed: Double?
    }

    func presentedNBA(_ court: [GameDetail.CourtPlay], teams: BasketballFeed.Teams) -> NBALive {
        var live = NBALive()
        guard active, !presented.isFinal else { return live }
        let key = [court.count, court.last?.id.hashValue ?? 0, presented.told, Int(truncatingIfNeeded: presented.revision),
                   presented.clock.map { Int($0.elapsed * 10) } ?? -1]
        if let nbaMemo, nbaMemo.key == key { return nbaMemo.live }
        defer { nbaMemo = (key, live) }
        let ball = NBADetail.ball(court)
        live.possession = ball.side
        live.inAir = ball.inAir
        live.streaks = NBADetail.streaks(court).filter { $0.value >= NBADetail.fireStreak }
        live.run = BasketballFeed.activeRun(in: toldPlays, teams: teams)
        if let clock = presented.clock {
            let quarter = engine?.policy.periodLength ?? 720
            live.elapsed = NBADetail.periodStart(clock.period, quarter: quarter) + clock.elapsed
            if let score = presented.score {
                let margin = topIsHome ? score.home - score.away : score.away - score.home
                live.clutch = NBADetail.clutch(period: clock.period, secondsLeft: clock.remaining, margin: margin)
            }
        }
        return live
    }

    /// The last told play's entry (football reads its end spot and possession from it).
    var lastTold: JSON? {
        _ = presented
        return engine?.timeline.lastTold?.entry.payload.json
    }

    /// Football: the team with the ball after the last told play.
    func footballPossession(_ teams: FootballFeed.Teams) -> GameDetail.Side? {
        guard active, let play = lastTold else { return nil }
        return teams.side(FootballFeed.teamID(play["end"]["team"]["$ref"].string) ?? play["end"]["team"]["id"].string
                          ?? FootballFeed.teamID(play["team"]["$ref"].string) ?? play["team"]["id"].string)
    }

    /// Football: the down, distance and spot after the last told play (its end).
    func footballSituation(_ teams: FootballFeed.Teams, fallback: GameDetail.Football?) -> GameDetail.Football? {
        guard active, let play = lastTold, let raw = play["end"].raw as? [String: Any] else { return fallback }
        var situation = raw
        situation["homeTimeouts"] = fallback.map { teams.topIsHome ? $0.topTimeouts : $0.bottomTimeouts } ?? nil
        situation["awayTimeouts"] = fallback.map { teams.topIsHome ? $0.bottomTimeouts : $0.topTimeouts } ?? nil
        let team = FootballFeed.teamID(play["end"]["team"]["$ref"].string) ?? play["end"]["team"]["id"].string
        let scored = play["scoringPlay"].bool == true
        return FootballFeed.situation(JSON(situation), possessionTeam: team, teams: teams, lastPlay: play["text"].string,
                                      afterScore: scored) ?? fallback
    }

    /// The presented game minute (soccer's timeline), from the presented clock.
    var minute: Double? {
        _ = presented
        return presented.clock.map { $0.elapsed / 60 }
    }

    // MARK: The theater's side

    func snapshot() -> TimelineSnapshot<RawPlay> {
        engine?.snapshot(at: time.now()) ?? TimelineSnapshot(plays: [], watermark: -.infinity, revision: 0, told: [])
    }

    var hints: [Hint] { engine?.timeline.hints ?? [] }

    func setBindingHorizons(_ horizons: BindingHorizons) {
        guard var engine else { return }
        engine.setHorizons(horizons)
        self.engine = engine
        step()
    }

    func setAnchors(_ anchors: [String: PTime]) {
        guard var engine else { return }
        engine.setAnchors(anchors)
        self.engine = engine
        step()
    }
}

extension PresentationClock {
    /// Whether another plan presents the same p over the next minute (within
    /// a millisecond): a re-plan that changes nothing isn't republished, so
    /// nothing reading the clock re-renders for it.
    func presentsSame(as other: PresentationClock, from now: PTime) -> Bool {
        guard started == other.started, regime == other.regime else { return false }
        for dt in stride(from: 0.0, through: 60, by: 2.5) where abs(p(at: now + dt) - other.p(at: now + dt)) > 0.001 { return false }
        return true
    }
}

#if DEBUG
/// The offscreen check's handle on a game page (DetailView): it delivers a
/// recording's summaries, core plays and scoreboard at virtual times, steps
/// the page's clock, and reads its broadcast.
@MainActor
@Observable
final class BroadcastHarness {
    var now: PTime
    private(set) var loads = 0
    private(set) var load: GameDetail?
    private(set) var cores = 0
    private(set) var core: [JSON] = []
    private(set) var boards = 0
    private(set) var board: Event?
    private(set) var ticks = 0
    /// The page's broadcast, once the page appears.
    @ObservationIgnored var broadcast: Broadcast?

    init(now: PTime) { self.now = now }

    func deliver(_ detail: GameDetail) { load = detail; loads += 1 }
    func deliver(core items: [JSON]) { core = items; cores += 1 }
    func deliver(board event: Event) { board = event; boards += 1 }
    func tick() { ticks += 1 }
}

private struct BroadcastHarnessKey: EnvironmentKey {
    static let defaultValue: BroadcastHarness? = nil
}

extension EnvironmentValues {
    var broadcastHarness: BroadcastHarness? {
        get { self[BroadcastHarnessKey.self] }
        set { self[BroadcastHarnessKey.self] = newValue }
    }
}
#endif
