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

    /// What every play's scene may read (soccer's keepers): when it changes, every scene is read again.
    associatedtype SceneContext: Equatable & Sendable = Int
    static func sceneContext(_ json: [JSON], facts: Facts) -> SceneContext
    /// How many plays either side a play's scene reads (one this near a change is read again).
    static var sceneReach: Int { get }
    /// The scene of the timeline's play at `i` of `raw` (its plays, then the pending ones past the watermark); nil:
    /// none. `prior`: this snapshot's scenes before it.
    static func scene(_ raw: [RawPlay], _ json: [JSON], at i: Int, pending: Bool, facts: Facts, context: SceneContext,
                      prior: [Play?]) -> Play?
    /// The plan from the splice at `c` (on the theater's time): each play's anchor at `τ + shift`; plays at or past
    /// `deferFrom` (on p) wait (the clock holds short of them).
    static func plan(_ plays: [TimelinePlay<Play>], history: Set<String>, facts: Facts, chain: PlanChain<Clip>, at c: PTime, shift: Double,
                     deferFrom: PTime?, revision: UInt32, nextID: inout UInt16) -> Plan<Clip>
    /// The binding horizons by the timeline's kind label (BROADCAST's late binding).
    static var horizons: [String: Double] { get }
}

extension TheaterSport where SceneContext == Int {
    static func sceneContext(_ json: [JSON], facts: Facts) -> Int { 0 }
}

extension TheaterSport {
    static var sceneReach: Int { 24 }

    /// The timeline's plays as this sport's scenes, in order (every play read: the tests' and a first look's way).
    static func plays(_ snapshot: TimelineSnapshot<RawPlay>, facts: Facts) -> [TimelinePlay<Play>] {
        var cache = SceneCache<Self>()
        return cache.read(snapshot, facts: facts)
    }
}

/// The timeline's plays read as a sport's scenes, incrementally (off the main actor): each scene is kept until its
/// play, or a play within the sport's reach of it, changes, so an ingest reads the few new plays, not the game.
struct SceneCache<Sport: TheaterSport>: Sendable {
    struct Key: Equatable, Sendable {
        var id: String
        var digest: Int
        var pending: Bool
    }
    private var keys: [Key] = []
    private var scenes: [Sport.Play?] = []
    private var context: Sport.SceneContext?
    private var facts: Sport.Facts?
    /// How many plays the last read parsed (the bench reports it).
    private(set) var parsed = 0

    mutating func read(_ snapshot: TimelineSnapshot<RawPlay>, facts: Sport.Facts) -> [TimelinePlay<Sport.Play>] {
        let all = snapshot.plays + snapshot.pending
        let split = snapshot.plays.count
        let fresh = all.indices.map { Key(id: all[$0].id, digest: all[$0].play.digest, pending: $0 >= split) }
        let raw = all.map(\.play)
        let json = raw.map(\.json)
        let context = Sport.sceneContext(json, facts: facts)
        var first = (0..<min(keys.count, fresh.count)).first { keys[$0] != fresh[$0] } ?? min(keys.count, fresh.count)
        if context != self.context || facts != self.facts { first = 0 }
        let from = max(first - Sport.sceneReach, 0)
        var out = Array(scenes.prefix(from))
        out.reserveCapacity(all.count)
        for i in from..<all.count {
            out.append(Sport.scene(raw, json, at: i, pending: i >= split, facts: facts, context: context, prior: out))
        }
        parsed = all.count - from
        keys = fresh
        scenes = out
        self.context = context
        self.facts = facts
        return all.indices.compactMap { i in out[i].flatMap { scene in all[i].map { _ in scene } } }
    }
}

/// The director's state as a pure value: the bench runs it synchronously, the app's director off the main actor.
struct TheaterSession<Sport: TheaterSport>: Sendable {
    /// What a plan is made from (everything the off-main work reads).
    struct Request: Sendable {
        /// The timeline as it stands, read as scenes off the main actor (`scenes` keeps what's already read).
        var snapshot: TimelineSnapshot<RawPlay>
        var scenes: SceneCache<Sport>
        /// Plays known when the page opened (nil until the first plan reads `opening`, the first snapshot).
        var history: Set<String>?
        var opening: TimelineSnapshot<RawPlay>?
        var facts: Sport.Facts
        var chain: PlanChain<Sport.Clip>
        var at: PTime
        var shift: Double
        var deferFrom: PTime?
        var revision: UInt32
        var nextID: UInt16
        /// Not seen: planned (its anchors are the tell times) but not baked for frames.
        var light = false
        /// The theater's time jumped with p (a declared jump, a wake): this plan's start is a declared cut.
        var declared = false
    }

    /// A plan made and baked, with what it read.
    struct Made: Sendable {
        var baked: BakedPlan<Sport.Clip>
        var nextID: UInt16
        var scenes: SceneCache<Sport>
        var history: Set<String>
    }

    private(set) var chain = PlanChain<Sport.Clip>()
    private(set) var time = TheaterTime()
    /// Plays known when the page opened: shown as the court they left, never told.
    private(set) var history: Set<String>?
    /// The timeline as of the last change that matters to a plan, the first one, and the scenes read so far.
    private var snapshot: TimelineSnapshot<RawPlay>?
    private var opening: TimelineSnapshot<RawPlay>?
    private var scenes = SceneCache<Sport>()
    var facts: Sport.Facts
    private var nextID: UInt16 = 1
    private var revision: UInt32 = 0
    /// The clock's last state: T advances on it until the next update.
    private var clock: PresentationClock?
    /// p holds (a stall or a stretch): plays past it wait.
    private(set) var holding: PTime?
    /// A declared jump happened since the last plan: the next one declares its cut.
    private var declareNext = false

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
        // T moved with p (declared): the plan made next starts with a declared cut.
        if events.contains(where: { if case .jump = $0 { true } else if case .wake = $0 { true } else { false } }) { declareNext = true }
        return held != wasHolding || abs(time.shift - shiftBefore) > 0.05 || events.contains { if case .skip = $0 { true } else { false } }
    }

    /// New plays (or revised, or removed). Cheap (the main actor's part): true when it matters to a plan. What's told
    /// and where it's presented don't (the plan sets those); the scenes are read off the main actor, in `make`.
    mutating func timelineDidChange(_ snapshot: TimelineSnapshot<RawPlay>) -> Bool {
        if opening == nil { opening = snapshot }
        if let last = self.snapshot, Self.samePlays(last, snapshot) { return false }
        self.snapshot = snapshot
        return true
    }

    /// Whether two snapshots hold the same plays as a plan reads them (everything but what's told and `presentAt`).
    static func samePlays(_ a: TimelineSnapshot<RawPlay>, _ b: TimelineSnapshot<RawPlay>) -> Bool {
        guard a.plays.count == b.plays.count, a.pending.count == b.pending.count else { return false }
        func same(_ x: TimelinePlay<RawPlay>, _ y: TimelinePlay<RawPlay>) -> Bool {
            x.id == y.id && x.play.digest == y.play.digest && x.revision == y.revision && x.eventTime == y.eventTime
                && x.eventBounds == y.eventBounds && x.estimated == y.estimated && x.timeSource == y.timeSource && x.kind == y.kind
                && x.period == y.period && x.clock == y.clock && x.score == y.score && x.order == y.order
        }
        return zip(a.plays, b.plays).allSatisfy(same) && zip(a.pending, b.pending).allSatisfy(same)
    }

    /// What a plan made now would be made from: the splice a quarter second ahead of T, on the chain's grid.
    /// `lead`: how far ahead of T the splice goes (the time the bake gets; more after a plan came back too late).
    mutating func request(now: PTime, lead: Double = TheaterTiming.commitLead) -> Request? {
        guard let T = theaterTime(at: now), let snapshot else { return nil }
        let c = chain.isEmpty ? T : chain.commit(after: T, lead: lead)
        revision &+= 1
        // While T runs on wall time (a hold) its shift from p grows: anchors go with the shift as it is now.
        let shift = clock.map { T - $0.p(at: now) } ?? time.shift
        var request = Request(snapshot: snapshot, scenes: scenes, history: history, opening: history == nil ? opening : nil, facts: facts,
                              chain: chain, at: c, shift: shift, deferFrom: holding, revision: revision, nextID: nextID)
        request.declared = declareNext
        return request
    }

    /// Reads the scenes, plans and bakes (pure; off the main actor in the app).
    static func make(_ request: Request) -> Made {
        var scenes = request.scenes
        let plays = scenes.read(request.snapshot, facts: request.facts)
        // Plays known when the page opened: its first snapshot's (the court they left, never told).
        let history = request.history ?? request.opening.map { opening in
            opening == request.snapshot ? Set(plays.map(\.id)) : Set(Sport.plays(opening, facts: request.facts).map(\.id))
        } ?? Set(plays.map(\.id))
        var nextID = request.nextID
        var plan = Sport.plan(plays, history: history, facts: request.facts, chain: request.chain, at: request.at,
                              shift: request.shift, deferFrom: request.deferFrom, revision: request.revision, nextID: &nextID)
        if request.declared { plan.declared = true }
        plan.known = Set(request.snapshot.plays.map(\.id)).subtracting(plan.deferred)
        let baked = TheaterBake.bake(plan, light: request.light, previous: request.chain.plan(at: request.at))
        return Made(baked: baked, nextID: nextID, scenes: scenes, history: history)
    }

    /// Takes in a baked plan if it's still in time (its splice not yet passed); else it must be made again. What it
    /// read is kept either way.
    mutating func accept(_ made: Made, now: PTime) -> Bool {
        scenes = made.scenes
        if history == nil { history = made.history }
        let baked = made.baked
        if let T = theaterTime(at: now), !chain.isEmpty, baked.start < T - 1e-6 { return false }
        if baked.plan.declared { declareNext = false }
        chain.splice(baked, now: theaterTime(at: now) ?? baked.start)
        self.nextID = max(self.nextID, made.nextID)
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

    /// The plays the newest plan was made from: the timeline waits for the anchor of one past them (nil: no plan yet).
    var covering: Set<String>? { chain.plans.last?.plan.known }

    /// When the plan runs out (the court between plays needs its next rounds): a wall time to re-plan by.
    func horizonWake(now: PTime) -> PTime? {
        guard let last = chain.plans.last, let T = theaterTime(at: now) else { return nil }
        return now + max(last.horizon - 15 - T, 0.5)
    }
}

// MARK: - The director

#if DEBUG
/// Plans in flight across every director (the offscreen check waits on it: folded, the court draws no frames to say so),
/// and the most there ever were at once (a gate: one).
@MainActor enum TheaterDebug {
    static var planning = 0 { didSet { most = max(most, planning) } }
    static private(set) var most = 0
}
#endif

/// Where every page's plans are made: one at a time (an actor: a serial executor off the main actor), at the planning
/// task's priority (utility). Never a task per data change, never in parallel.
actor TheaterBakery {
    static let shared = TheaterBakery()

    func make<Sport: TheaterSport>(_ request: TheaterSession<Sport>.Request) -> TheaterSession<Sport>.Made {
        TheaterSession<Sport>.make(request)
    }
}

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

    /// The plays the newest plan has seen: a newer one waits for its anchor (the court and the score land together).
    var covering: Set<String>? { session.covering }

    /// The plays changed (an ingest, a revision, a removal): re-plan from a quarter second ahead.
    func timelineDidChange(_ snapshot: TimelineSnapshot<RawPlay>) {
        if session.timelineDidChange(snapshot) || chain.isEmpty { replan() }
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
        #if DEBUG
        TheaterDebug.planning += 1
        #endif
        baking = Task(priority: .utility) { [weak self] in
            let made = await TheaterBakery.shared.make(request)
            #if DEBUG
            TheaterDebug.planning -= 1
            #endif
            guard let self, !Task.isCancelled else { return }
            self.baking = nil
            if self.session.accept(made, now: self.now()) {
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
