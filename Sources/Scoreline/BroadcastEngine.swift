import Foundation

// The game as one broadcast, part 5: the engine (timeline + clock, one step at a time).
//
// The one code path the game page (Broadcast.swift) and the recording bench
// both run: lanes in, `advance(now:)`, plays told, the next wake scheduled.
// Pure and deterministic; nothing here reads a clock or sleeps.
//
// Also here: the shapes the theater director reads (CHOREOGRAPHY §10:
// `TimelinePlay`, `TimelineSnapshot`; `Hint` and `PTime` live with the timeline).

struct BroadcastEngine<Payload: Sendable & Equatable>: Sendable {
    /// One step's effect: what was told, what the clock did, a safety-net score applied.
    struct Step: Sendable {
        var told: [GameTimeline<Payload>.Record] = []
        var events: [PresentationClock.Event] = []
        var correction: ScoreCorrection?
        var knowledge: Knowledge?
    }

    private(set) var timeline: GameTimeline<Payload>
    private(set) var clock: PresentationClock
    let sport: BroadcastSport

    init(sport: BroadcastSport, policy: BroadcastPolicy) {
        self.sport = sport
        timeline = GameTimeline(policy: policy)
        clock = PresentationClock(tuning: PresentationClock.Tuning(policy: policy))
    }

    var policy: BroadcastPolicy { timeline.policy }
    var started: Bool { clock.started }

    // MARK: Inputs

    @discardableResult
    mutating func ingest(_ snapshot: LaneSnapshot<Payload>) -> TimelineChange { timeline.ingest(snapshot) }

    mutating func noteRead(_ lane: LaneID, at now: PTime) { timeline.noteRead(lane, at: now) }

    mutating func observe(_ reading: FastReading) { timeline.observe(reading) }

    // MARK: Stepping

    /// Re-plans the clock with what the timeline knows at `now`, then tells
    /// every play p has reached: as history on opening, waking or a declared
    /// jump; on time (or late) otherwise. A score the fast lane has held the
    /// clock with for longer than the grace is applied (the safety net).
    @discardableResult
    mutating func advance(now: PTime) -> Step {
        var step = Step()
        guard !timeline.isEmpty else { return step }
        replan(now: now, into: &step)
        // The safety net: held at the watermark by a score no play explains.
        if let knowledge = step.knowledge, knowledge.bound == .unexplainedScore, let held = clock.stalled(at: now),
           let correction = timeline.applySafetyNet(now: now, held: held) {
            step.correction = correction
            replan(now: now, into: &step)
        }
        return step
    }

    private mutating func replan(now: PTime, into step: inout Step) {
        let knowledge = timeline.knowledge(at: now)
        step.knowledge = knowledge
        let cap = knowledge.frontier - policy.leadIn
        let before = clock.events.count
        let pBefore = clock.started ? clock.p(at: now) : cap
        let quiet = timeline.quietSpan(from: pBefore, knowledge: cap)
        clock.update(now: now, inputs: PresentationClock.Inputs(target: timeline.targetDelay, cap: cap, quietUntil: quiet))
        let events = Array(clock.events[before...])
        step.events += events
        let p = clock.p(at: now) + 1e-6
        // The live edge (opening, waking) and a declared jump: what's passed is history, not news.
        let history = events.contains { event in
            switch event {
            case .start, .wake, .jump: true
            default: false
            }
        }
        step.told += history ? timeline.tellHistory(through: p) : timeline.tell(through: p)
    }

    // MARK: Reading

    /// The moment presented at `now`.
    func p(at now: PTime) -> PTime { clock.p(at: now) }

    /// What's presented at `now`.
    func presented(at now: PTime) -> PresentedGame { PresentedGame.at(clock.p(at: now), timeline: timeline) }

    /// When something next changes on its own (a play's moment, the clock
    /// stopping or restarting, the hold beginning, the safety net's grace
    /// running out): the page sleeps until then; nothing polls.
    func nextWake(after now: PTime) -> PTime? {
        guard clock.started else { return nil }
        var candidates: [PTime] = []
        let p = clock.p(at: now)
        if let change = PresentedGame.nextChange(after: p, timeline: timeline), let t = clock.wall(reaching: change, after: now) {
            candidates.append(t)
        }
        // The hold's start (it's when a stall begins) and the safety net's deadline.
        if let hold = clock.pieces.last, hold.v0 == 0, hold.a == 0, hold.t0 > now { candidates.append(hold.t0) }
        if let since = clock.stalledSince, clock.regime == .stalled { candidates.append(since + policy.safetyGrace + 0.01) }
        // Slew pieces end: the regime changes (the bench logs D).
        for piece in clock.pieces where piece.t0 > now + 1e-3 { candidates.append(piece.t0) }
        return candidates.filter { $0 > now + 1e-3 }.min()
    }

    /// The theater's view (CHOREOGRAPHY §10): the plays up to the watermark, in
    /// order, with what's told; `pending`: known plays past it (provisional).
    func snapshot(at now: PTime) -> TimelineSnapshot<Payload> {
        let watermark = timeline.knowledge(at: now).frontier
        var plays: [TimelinePlay<Payload>] = []
        var pending: [TimelinePlay<Payload>] = []
        var told = Set<String>()
        for (order, r) in timeline.records.enumerated() {
            let play = TimelinePlay(id: r.id, order: order, eventTime: r.eventTime, presentAt: r.presentAt, period: r.entry.period,
                                    clock: r.entry.clock, kind: r.entry.kind, score: r.entry.score, revision: r.revisions,
                                    estimated: r.estimated, firstSeen: r.firstSeen, play: r.entry.payload)
            if r.isTold { told.insert(r.id) }
            if r.eventTime <= watermark || r.isTold { plays.append(play) } else { pending.append(play) }
        }
        return TimelineSnapshot(plays: plays, watermark: watermark, revision: timeline.revision, told: told, pending: pending)
    }
}

// MARK: - What the theater director reads (CHOREOGRAPHY §10)

/// One play on the timeline, as the engine reads it.
struct TimelinePlay<Play: Equatable & Sendable>: Equatable, Sendable {
    let id: String
    /// The timeline's order (position): ESPN's list order, football's sequence, MLB's at-bat and pitch.
    let order: Int
    /// The event time: wallclock, MLB's startTime, or an estimate (`estimated`).
    let eventTime: PTime?
    /// Phase A's presentation time: event times made monotone in order. Phase
    /// 0's anchor solver supersedes it with decisive moments.
    let presentAt: PTime
    let period: Int
    /// Game clock elapsed in the period and its resolution.
    let clock: GameClockReading
    let kind: PlayKind
    let score: ScoreLine?
    let revision: Int
    let estimated: Bool
    let firstSeen: PTime
    /// The sport's play: Phase A carries the feed's own entry (`RawPlay`); map it
    /// to BasketballScene, FootballScene… with `TimelineSnapshot.map`.
    let play: Play

    func map<T>(_ transform: (Play) -> T?) -> TimelinePlay<T>? {
        transform(play).map {
            TimelinePlay<T>(id: id, order: order, eventTime: eventTime, presentAt: presentAt, period: period, clock: clock,
                            kind: kind, score: score, revision: revision, estimated: estimated, firstSeen: firstSeen, play: $0)
        }
    }
}

struct TimelineSnapshot<Play: Equatable & Sendable>: Equatable, Sendable {
    /// Up to the watermark (and everything told), in order.
    let plays: [TimelinePlay<Play>]
    let watermark: PTime
    /// Bumps on any ingest that changes plays, or anything told.
    let revision: UInt64
    /// Plays already presented: told plays never re-animate (BROADCAST §1).
    let told: Set<String>
    /// Known plays past the watermark: provisional (something may still be inserted before them).
    var pending: [TimelinePlay<Play>] = []

    func map<T>(_ transform: (Play) -> T?) -> TimelineSnapshot<T> {
        TimelineSnapshot<T>(plays: plays.compactMap { $0.map(transform) }, watermark: watermark, revision: revision, told: told,
                            pending: pending.compactMap { $0.map(transform) })
    }
}
