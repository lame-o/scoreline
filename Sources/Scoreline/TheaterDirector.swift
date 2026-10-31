import Foundation
import Observation

// The game as one broadcast, part 14: the director (CHOREOGRAPHY §4.2, §4.5).
//
// The only stateful part of the engine. It holds the plan chain, decides when
// to re-plan (new plays, a revision, the clock holding, resuming or skipping,
// the viewer turning the court), plans and bakes off the main actor, and
// splices the result in. It never re-plans on a timer; the one wake it
// schedules is the plan's own horizon running out (the court between plays
// goes on round by round while nothing new comes).
//
// The theater's time. The chain is indexed by the theater's own time `T`, not
// by p. While p runs (its gentle slews included), T is p plus a fixed shift,
// so every play's decisive moment lands as p reaches it. While p holds (a
// stall at the watermark, a stretch inside a stoppage) or eases into or out of
// a hold, T runs on wall time: the field never freezes, and what plays there
// is the court between plays, never a play the clock hasn't reached (plays
// past the hold wait for it to let go). A skip moves p across a stoppage and
// T not at all. Only a declared jump (opening, waking, a Jmax catch-up) moves T
// with p. The shift changes only in those holds and skips, and each change
// re-plans, so anchors are always placed at `τ + shift`.

/// The theater's own time (see above): pure, advanced by the clock's pieces.
struct TheaterTime: Equatable, Sendable {
    /// T at `wall` (the last time it was advanced).
    private(set) var t: PTime = 0
    private(set) var wall: PTime?
    /// T − p at `wall`.
    private(set) var shift: Double = 0

    var started: Bool { wall != nil }

    /// How T runs on a piece of the clock: with p while p runs at a pace (a slew is a pace), on wall time otherwise.
    static func follows(_ piece: PresentationClock.Piece) -> Bool { piece.a == 0 && piece.v0 >= 0.85 && piece.v0 <= 1.15 }

    /// T at wall time `now`, from the last advance, on `clock`'s pieces (valid since then).
    func at(_ now: PTime, clock: PresentationClock) -> PTime {
        guard let wall else { return clock.p(at: now) }
        guard now > wall else { return t - (wall - now) }
        var t = self.t, from = wall
        for piece in clock.pieces where piece.t1 > from && piece.t0 < now {
            let a = max(piece.t0, from), b = min(piece.t1, now)
            guard b > a else { continue }
            t += Self.follows(piece) ? piece.p(at: b) - piece.p(at: a) : b - a
            from = b
        }
        if now > from { t += now - from }
        return t
    }

    /// The wall time T reaches `target` on `clock`'s pieces (T never runs backward: a bisection), from `now` on;
    /// nil if it's already past or beyond a day.
    func wall(reaching target: PTime, clock: PresentationClock, after now: PTime) -> PTime? {
        guard at(now, clock: clock) < target else { return nil }
        var lo = now, hi = now + max(target - at(now, clock: clock), 0.5)
        var guardSteps = 0
        while at(hi, clock: clock) < target, guardSteps < 40 {
            hi = now + (hi - now) * 2
            guardSteps += 1
            if hi - now > 86_400 { return nil }
        }
        for _ in 0..<60 {
            let mid = (lo + hi) / 2
            if at(mid, clock: clock) < target { lo = mid } else { hi = mid }
        }
        return hi
    }

    /// Advances to `now` on the clock that ran until then, then applies what the clock did at `now`.
    mutating func advance(to now: PTime, ran clock: PresentationClock, then events: [PresentationClock.Event], now updated: PresentationClock) {
        if wall == nil {
            t = updated.p(at: now)
            wall = now
            shift = 0
            return
        }
        t = at(now, clock: clock)
        wall = now
        for event in events {
            switch event {
            case .start, .wake, .jump:
                // Declared: T moves with p, the shift kept.
                t = updated.p(at: now) + shift
            case .skip, .stall, .resume:
                break
            }
        }
        shift = t - updated.p(at: now)
    }
}

// MARK: - A sport, as the director runs it (Phase 0)

protocol TheaterSport: Sendable {
    associatedtype Clip: TheaterClip
    associatedtype Play: Equatable & Sendable
    associatedtype Facts: Equatable & Sendable

    /// The timeline's plays as this sport's scenes, in order.
    static func plays(_ snapshot: TimelineSnapshot<RawPlay>, facts: Facts) -> [TimelinePlay<Play>]
    /// The plan from the splice at `c` (on the theater's time): each play's anchor at `τ + shift`; plays at or past
    /// `deferFrom` (on p) wait (the clock holds short of them).
    static func plan(_ plays: [TimelinePlay<Play>], history: Set<String>, facts: Facts, chain: PlanChain<Clip>, at c: PTime, shift: Double,
                     deferFrom: PTime?, revision: UInt32, nextID: inout UInt16) -> Plan<Clip>
    /// The binding horizons by the timeline's kind label (BROADCAST's late binding).
    static var horizons: [String: Double] { get }
}

/// The director's state as a pure value: the bench runs it synchronously, the app's director off the main actor.
struct TheaterSession<Sport: TheaterSport>: Sendable {
    /// What a plan is made from (everything the off-main work reads).
    struct Request: Sendable {
        var plays: [TimelinePlay<Sport.Play>]
        var history: Set<String>
        var facts: Sport.Facts
        var chain: PlanChain<Sport.Clip>
        var at: PTime
        var shift: Double
        var deferFrom: PTime?
        var revision: UInt32
        var nextID: UInt16
        /// Not seen: planned (its anchors are the tell times) but not baked for frames.
        var light = false
    }

    private(set) var chain = PlanChain<Sport.Clip>()
    private(set) var time = TheaterTime()
    /// Plays known when the page opened: shown as the court they left, never told.
    private(set) var history: Set<String>?
    private(set) var plays: [TimelinePlay<Sport.Play>] = []
    var facts: Sport.Facts
    private var nextID: UInt16 = 1
    private var revision: UInt32 = 0
    /// The clock's last state: T advances on it until the next update.
    private var clock: PresentationClock?
    /// p holds (a stall or a stretch): plays past it wait.
    private(set) var holding: PTime?

    init(facts: Sport.Facts) { self.facts = facts }

    /// The theater's time and the clock it runs on (the view's schedule maps tiers through them).
    var timing: (time: TheaterTime, clock: PresentationClock)? { clock.map { (time, $0) } }

    /// p at a wall time, on the clock the theater runs on (the bench measures decisive moments against it).
    func presentation(at now: PTime) -> PTime? { clock?.p(at: now) }

    /// The theater's time at `now`.
    func theaterTime(at now: PTime) -> PTime? {
        guard let clock, time.started else { return nil }
        return time.at(now, clock: clock)
    }

    /// The clock was updated at `now` (its events since): T follows it. True when that calls for a new plan
    /// (a hold began or ended, a skip, a jump).
    mutating func clockDidUpdate(_ updated: PresentationClock, events: [PresentationClock.Event], now: PTime) -> Bool {
        guard updated.started else { return false }
        let shiftBefore = time.shift
        time.advance(to: now, ran: clock ?? updated, then: events, now: updated)
        clock = updated
        let held = updated.regime == .stalled || updated.regime == .stretching
        let wasHolding = holding != nil
        holding = held ? updated.p(at: now) : nil
        return held != wasHolding || abs(time.shift - shiftBefore) > 0.05 || events.contains { if case .skip = $0 { true } else { false } }
    }

    /// New plays (or revised, or removed).
    mutating func timelineDidChange(_ snapshot: TimelineSnapshot<RawPlay>) {
        plays = Sport.plays(snapshot, facts: facts)
        if history == nil { history = Set(plays.map(\.id)) }
    }

    /// What a plan made now would be made from: the splice a quarter second ahead of T, on the chain's grid.
    /// `lead`: how far ahead of T the splice goes (the time the bake gets; more after a plan came back too late).
    mutating func request(now: PTime, lead: Double = TheaterTiming.commitLead) -> Request? {
        guard let T = theaterTime(at: now), let history else { return nil }
        let c = chain.isEmpty ? T : chain.commit(after: T, lead: lead)
        revision &+= 1
        // While T runs on wall time (a hold) its shift from p grows: anchors go with the shift as it is now.
        let shift = clock.map { T - $0.p(at: now) } ?? time.shift
        return Request(plays: plays, history: history, facts: facts, chain: chain, at: c, shift: shift, deferFrom: holding, revision: revision,
                       nextID: nextID)
    }

    /// Plans and bakes (pure; off the main actor in the app).
    static func make(_ request: Request) -> (BakedPlan<Sport.Clip>, nextID: UInt16) {
        var nextID = request.nextID
        let plan = Sport.plan(request.plays, history: request.history, facts: request.facts, chain: request.chain, at: request.at,
                              shift: request.shift, deferFrom: request.deferFrom, revision: request.revision, nextID: &nextID)
        return (TheaterBake.bake(plan, light: request.light), nextID)
    }

    /// Takes in a baked plan if it's still in time (its splice not yet passed); else it must be made again.
    mutating func accept(_ baked: BakedPlan<Sport.Clip>, nextID: UInt16, now: PTime) -> Bool {
        if let T = theaterTime(at: now), !chain.isEmpty, baked.start < T - 1e-6 { return false }
        chain.splice(baked, now: theaterTime(at: now) ?? baked.start)
        self.nextID = max(self.nextID, nextID)
        return true
    }

    /// Where each placed play is presented on p: the p the clock will show as T reaches its decisive frame (so the
    /// score, the lists and the court land together however T and p run between now and then); a play whose frame
    /// is already drawn keeps what was published.
    func anchors(now: PTime) -> [String: PTime] {
        guard let plan = chain.plans.last?.plan else { return [:] }
        var out = plan.published
        guard let clock, time.started else { return out }
        for (id, at) in plan.decisive {
            if let w = time.wall(reaching: at, clock: clock, after: now) { out[id] = clock.p(at: w) }
        }
        return out
    }

    /// When the plan runs out (the court between plays needs its next rounds): a wall time to re-plan by.
    func horizonWake(now: PTime) -> PTime? {
        guard let last = chain.plans.last, let T = theaterTime(at: now) else { return nil }
        return now + max(last.horizon - 15 - T, 0.5)
    }
}

// MARK: - The director

/// The game page's theater director (one per page, main actor, event-driven):
/// only `chain` is observed, and it changes only on a splice.
@MainActor @Observable
final class TheaterDirector<Sport: TheaterSport> {
    private(set) var chain = PlanChain<Sport.Clip>()
    @ObservationIgnored private var session: TheaterSession<Sport>
    @ObservationIgnored private var baking: Task<Void, Never>?
    @ObservationIgnored private var waking: Task<Void, Never>?
    @ObservationIgnored private(set) var visible = true
    @ObservationIgnored private var pending = false
    @ObservationIgnored private var clock: PresentationClock?
    /// How far ahead the next splice goes: the commit lead, doubled after a plan comes back past its splice (a slow
    /// machine, a busy moment) and easing back as plans land in time.
    @ObservationIgnored private var lead = TheaterTiming.commitLead
    /// Wall time now (the app passes `Date()`'s; tests and the bench a virtual clock).
    @ObservationIgnored var now: () -> PTime = { Date().timeIntervalSince1970 }

    init(facts: Sport.Facts) { session = TheaterSession(facts: facts) }

    /// The theater's time at a wall time: what the view samples the chain at.
    func time(at wall: PTime) -> PTime? { session.theaterTime(at: wall) }

    /// What the plan is made from (the teams, the viewer's turn).
    var facts: Sport.Facts { session.facts }

    /// A plan is being made (the offscreen check waits for it on its virtual clock).
    var busy: Bool { baking != nil }

    /// The theater's time and its clock, for the view's frame schedule.
    var timing: (time: TheaterTime, clock: PresentationClock)? { session.timing }

    /// Where each play is presented on p (as T reaches its decisive frame): the timeline presents it there too.
    var anchors: [String: PTime] { session.anchors(now: now()) }

    /// The plays changed (an ingest, a revision, a removal): re-plan from a quarter second ahead.
    func timelineDidChange(_ snapshot: TimelineSnapshot<RawPlay>) {
        session.timelineDidChange(snapshot)
        replan()
    }

    /// The presentation clock re-planned (its events since the last time): T follows; a hold, a resume, a skip or a jump re-plans.
    func clockDidChange(_ clock: PresentationClock, events: [PresentationClock.Event]) {
        self.clock = clock
        if session.clockDidUpdate(clock, events: events, now: now()) || chain.isEmpty { replan() }
    }

    /// The viewer turned the court (the facts changed): re-plan.
    func factsDidChange(_ facts: Sport.Facts) {
        guard facts != session.facts else { return }
        session.facts = facts
        replan()
    }

    /// Plan always, bake when seen (§8.4): off screen the plans are still made (their anchors are every consumer's
    /// tell times), only not baked for frames; on return, a full plan from where T is.
    func setVisible(_ seen: Bool) {
        guard seen != visible else { return }
        visible = seen
        if seen { replan() }
    }

    private func replan() {
        if baking != nil {
            pending = true
            return
        }
        guard var request = session.request(now: now(), lead: lead) else { return }
        request.light = !visible
        baking = Task { [weak self] in
            let made = await Self.make(request)
            guard let self, !Task.isCancelled else { return }
            self.baking = nil
            if self.session.accept(made.0, nextID: made.nextID, now: self.now()) {
                self.chain = self.session.chain
                self.lead = max(TheaterTiming.commitLead, self.lead * 0.75)
                self.scheduleHorizon()
            } else {
                // Too late for its splice: again, from now, with more room.
                self.lead = min(self.lead * 2, 4)
                self.pending = true
            }
            if self.pending {
                self.pending = false
                self.replan()
            }
        }
    }

    nonisolated private static func make(_ request: TheaterSession<Sport>.Request) async -> (BakedPlan<Sport.Clip>, nextID: UInt16) {
        TheaterSession<Sport>.make(request)
    }

    /// The one wake: before the plan runs out, the next rounds of the court between plays.
    private func scheduleHorizon() {
        waking?.cancel()
        guard let at = session.horizonWake(now: now()) else { return }
        let delay = max(at - now(), 0.5)
        waking = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.replan()
        }
    }
}
