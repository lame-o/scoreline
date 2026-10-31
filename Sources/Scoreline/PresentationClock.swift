import Foundation

// The game as one broadcast, part 2: the presentation clock (BROADCAST.md §2).
//
// p = now − D: the moment of the game being presented. D is per game and
// adaptive (the timeline's `targetDelay`: the live-ball lag quantile, the
// lead-in, a margin) and never jumps; the clock slews toward it at 0.92–1.08×,
// which nobody can see. The only discontinuities are declared:
//
// - **Start and wake**: the live edge, without telling what came before.
// - **Jump**: more than `jumpMax` behind the target (a long stall): to the live
//   edge, a crossfade, the plays in between told as history.
// - **Skip**: across a stoppage the clock may move instantly, forward to catch
//   up or by holding still to fall back, because nothing on screen changes
//   there (no play to tell, the game clock stopped). That's where TV puts its
//   catch-ups too, and it's why a stall rarely costs anything once play stops.
//
// And the rule over all of them: **p never passes the watermark less the
// binding horizon.** The watermark moves on hard evidence only (BROADCAST §1),
// so it rarely binds; approaching it, the clock first slews down (0.92×), then
// eases to a stop there and holds (a stall); the presented game clock holds
// with it, and the page goes on living (the theater keeps its ambient motion
// on wall time, the heartbeat keeps beating).
//
// The clock is a plan: a few pieces of constant acceleration (p(t) is C¹
// everywhere except the declared jumps and the slew's 8% rate steps), re-made
// from the current p and rate whenever the inputs change. Pure and
// deterministic: callers pass `now`.

struct PresentationClock: Equatable, Sendable {
    /// What the clock did, for the page (a jump crossfades) and the bench (it counts them).
    enum Event: Equatable, Sendable {
        /// Opened at the live edge.
        case start(at: PTime, p: PTime)
        /// Woke (or came back to the page) and went to the live edge.
        case wake(at: PTime, from: PTime, to: PTime)
        /// More than `jumpMax` behind: a declared jump to the live edge.
        case jump(at: PTime, from: PTime, to: PTime)
        /// Across a stoppage, where nothing on screen changes.
        case skip(at: PTime, from: PTime, to: PTime)
        /// Began holding at the watermark (`p`), and when it let go.
        case stall(at: PTime, p: PTime)
        case resume(at: PTime, held: Double)
    }

    /// What the clock is doing now.
    enum Regime: Hashable, Sendable {
        case off
        /// At the target delay, rate 1.
        case tracking
        /// Slewing toward the target: faster (catching up) or slower (falling back).
        case catchingUp
        case fallingBack
        /// Held still inside a stoppage while the delay grows to its target.
        case stretching
        /// Held at the watermark: nothing more is known yet.
        case stalled
    }

    struct Tuning: Equatable, Sendable {
        /// The slew's bounds: nobody sees an 8% change of pace.
        var slow = 0.92
        var fast = 1.08
        /// Within this of the target, run at 1×.
        var deadband = 0.25
        /// More than this behind the target: a declared jump.
        var jumpMax: Double = 40
        /// Skip and stretch inside stoppages.
        var stoppages = true
        /// A skip shorter than this isn't worth one.
        var minSkip: Double = 0.75
        /// Easing into a hold, and out of one.
        var ease: Double = 1.0
        /// Within this much p of the cap, slew down before the ease.
        var approach: Double = 5
        /// Updates further apart than this (sleep, another page) are a wake.
        var wakeGap: Double = 30

        init(policy: BroadcastPolicy) {
            jumpMax = policy.jumpMax
            stoppages = policy.skipStoppages
            approach = policy.approach
        }

        init() {}
    }

    /// What the timeline says now.
    struct Inputs: Equatable, Sendable {
        /// The delay to aim for.
        var target: Double
        /// The latest p may present: the watermark less the lead-in.
        var cap: PTime
        /// p may move instantly up to here (a stoppage with nothing to tell); nil: nowhere.
        var quietUntil: PTime?
    }

    /// One piece of the plan: p(t) = p0 + v0·(t − t0) + a·(t − t0)²/2, for t in [t0, t1).
    struct Piece: Equatable, Sendable {
        var t0: PTime
        var p0: PTime
        var v0: Double
        var a: Double = 0
        var t1: PTime = .infinity

        func p(at t: PTime) -> PTime {
            let dt = t - t0
            return p0 + v0 * dt + 0.5 * a * dt * dt
        }

        func v(at t: PTime) -> Double { v0 + a * (t - t0) }

        /// When p reaches `target` in this piece, if it does.
        func time(reaching target: PTime) -> PTime? {
            let d = target - p0
            if d <= 0 { return t0 }
            var dt: Double?
            if abs(a) < 1e-12 {
                if v0 > 1e-9 { dt = d / v0 }
            } else {
                let disc = v0 * v0 + 2 * a * d
                if disc >= 0 {
                    let root = (-v0 + disc.squareRoot()) / a
                    if root >= 0 { dt = root } else {
                        let other = (-v0 - disc.squareRoot()) / a
                        if other >= 0 { dt = other }
                    }
                }
            }
            guard let dt, t0 + dt < t1 else { return nil }
            return t0 + dt
        }
    }

    let tuning: Tuning
    private(set) var pieces: [Piece] = []
    private(set) var target: Double = 0
    private(set) var cap: PTime = -.infinity
    private(set) var regime = Regime.off
    private(set) var lastUpdate: PTime?
    /// Since when the clock has been held at the watermark (nil: not stalled).
    private(set) var stalledSince: PTime?
    /// What it did, newest last (bounded).
    private(set) var events: [Event] = []

    init(tuning: Tuning = Tuning()) {
        self.tuning = tuning
    }

    var started: Bool { !pieces.isEmpty }

    // MARK: Reading

    /// The moment of the game presented at wall time `t`.
    func p(at t: PTime) -> PTime {
        guard let piece = piece(at: t) else { return -.infinity }
        return piece.p(at: t)
    }

    /// The clock's rate at `t` (1: real time, 0: holding).
    func rate(at t: PTime) -> Double { piece(at: t)?.v(at: t) ?? 0 }

    /// How far behind the game the page is at `t`: D.
    func delay(at t: PTime) -> Double { t - p(at: t) }

    /// The wall time at which p reaches `target`: nil if the plan never gets
    /// there (it holds short of it). Past targets are now (`after`).
    func wall(reaching target: PTime, after now: PTime) -> PTime? {
        guard started else { return nil }
        if p(at: now) >= target { return now }
        for piece in pieces where piece.t1 > now {
            let start = max(piece.t0, now)
            guard piece.p(at: start) < target || piece.t0 >= now else { return start }
            if let t = piece.time(reaching: target), t >= start { return t }
        }
        return nil
    }

    /// Whether the clock is held at the watermark at `t`, and for how long.
    func stalled(at t: PTime) -> Double? {
        guard regime == .stalled, let since = stalledSince, t >= since else { return nil }
        return t - since
    }

    private func piece(at t: PTime) -> Piece? {
        guard let first = pieces.first else { return nil }
        if t < first.t0 { return first }
        return pieces.last { $0.t0 <= t } ?? first
    }

    // MARK: Planning

    /// Re-plans from `now` with what the timeline says. Continuous in p (and in
    /// rate, but for the slew's small steps), except the declared jumps.
    mutating func update(now: PTime, inputs: Inputs) {
        target = inputs.target
        cap = inputs.cap
        defer { lastUpdate = now }
        let edge = min(now - inputs.target, inputs.cap)
        guard started, let last = lastUpdate else {
            pieces = [Piece(t0: now, p0: edge, v0: 1)]
            note(.start(at: now, p: edge))
            plan(now: now, p: edge, v: 1, inputs: inputs)
            return
        }
        var p = p(at: now)
        var v = rate(at: now)
        // Asleep, or away on another page: the live edge, as on opening.
        if now - last > tuning.wakeGap {
            let to = max(p, edge)
            note(.wake(at: now, from: p, to: to))
            p = to
            v = 1
        } else if now - p - inputs.target > tuning.jumpMax, edge > p {
            // Far behind (a long stall): a declared jump.
            note(.jump(at: now, from: p, to: edge))
            p = edge
            v = 1
        } else if tuning.stoppages, now - p - inputs.target > tuning.minSkip, let quiet = inputs.quietUntil, quiet > p {
            // Behind, inside a stoppage: catch up where nothing on screen changes.
            let to = min(now - inputs.target, quiet, inputs.cap)
            if to - p >= tuning.minSkip {
                note(.skip(at: now, from: p, to: to))
                p = to
            }
        }
        plan(now: now, p: p, v: v, inputs: inputs)
    }

    /// The pieces from (now, p, v): the slew (or a stretch inside a stoppage),
    /// then real time, eased to a hold short of the cap.
    private mutating func plan(now: PTime, p: PTime, v: Double, inputs: Inputs) {
        let d = now - p
        var plan: [Piece] = []
        let wasStalled = regime == .stalled
        if p >= inputs.cap - 1e-6 {
            // At the watermark: hold.
            plan = [Piece(t0: now, p0: p, v0: 0)]
            regime = d < inputs.target - tuning.deadband && inputs.quietUntil.map({ $0 > p }) == true ? .stretching : .stalled
        } else if tuning.stoppages, d < inputs.target - tuning.deadband, let quiet = inputs.quietUntil, quiet > p {
            // Ahead of the target, inside a stoppage: hold still until the delay has grown to it.
            let until = p + inputs.target
            plan = Self.capped([Piece(t0: now, p0: p, v0: 0, t1: until), Piece(t0: until, p0: p, v0: 1)], at: inputs.cap, ease: tuning.ease,
                               approach: tuning.approach, slow: tuning.slow)
            regime = .stretching
        } else {
            let r = d > inputs.target + tuning.deadband ? tuning.fast : d < inputs.target - tuning.deadband ? tuning.slow : 1
            regime = r > 1 ? .catchingUp : r < 1 ? .fallingBack : .tracking
            var t = now, pAt = p
            // Out of a hold: ease up to pace rather than lurch.
            if v < r - 0.01 {
                let a = (r - v) / tuning.ease
                plan.append(Piece(t0: t, p0: pAt, v0: v, a: a, t1: t + tuning.ease))
                pAt = plan[0].p(at: t + tuning.ease)
                t += tuning.ease
            }
            if r != 1 {
                // Until D reaches the target: D(t) = d' + (1 − r)(t − t').
                let dNow = t - pAt
                let reach = t + max((inputs.target - dNow) / (1 - r), 0)
                plan.append(Piece(t0: t, p0: pAt, v0: r, t1: reach))
                pAt += r * (reach - t)
                t = reach
            }
            plan.append(Piece(t0: t, p0: pAt, v0: 1))
            plan = Self.capped(plan, at: inputs.cap, ease: tuning.ease, approach: tuning.approach, slow: tuning.slow)
        }
        // Seal the pieces' ends.
        for i in plan.indices.dropLast() { plan[i].t1 = plan[i + 1].t0 }
        pieces = plan
        if regime == .stalled {
            if !wasStalled || stalledSince == nil {
                stalledSince = now
                note(.stall(at: now, p: p))
            }
        } else if wasStalled, let since = stalledSince {
            note(.resume(at: now, held: now - since))
            stalledSince = nil
        } else if regime != .stalled {
            stalledSince = nil
        }
    }

    /// The plan, approaching `cap`: within `approach` of it, no faster than
    /// `slow` (the slew's low bound); then, the first time p comes within its
    /// braking distance (`ease`·v/2), a uniform deceleration to rest exactly
    /// at the cap, and a hold.
    static func capped(_ plan: [Piece], at cap: PTime, ease: Double, approach: Double = 0, slow: Double = 1) -> [Piece] {
        guard cap.isFinite else { return plan }
        var out: [Piece] = []
        for piece in plan {
            if approach > 0, let t = piece.time(reaching: cap - approach), piece.v(at: t) > slow + 1e-9 {
                var head = piece
                head.t1 = t
                if t > piece.t0 { out.append(head) }
                return out + capped([Piece(t0: t, p0: piece.p(at: t), v0: slow)], at: cap, ease: ease)
            }
            let v = max(piece.v0, piece.v(at: min(piece.t1, piece.t0 + 3600)))
            let brake = 0.5 * max(v, 0.01) * ease
            if let t = piece.time(reaching: cap - brake) {
                var head = piece
                head.t1 = t
                if t > piece.t0 { out.append(head) }
                let vEase = max(piece.v(at: t), 0.01)
                let pEase = piece.p(at: t)
                let distance = max(cap - pEase, 0)
                let duration = distance > 0 ? 2 * distance / vEase : 0
                if duration > 0 {
                    out.append(Piece(t0: t, p0: pEase, v0: vEase, a: -vEase / duration, t1: t + duration))
                }
                out.append(Piece(t0: t + duration, p0: cap, v0: 0))
                return out
            }
            out.append(piece)
        }
        return out
    }

    private mutating func note(_ event: Event) {
        events.append(event)
        if events.count > 400 { events.removeFirst(events.count - 400) }
    }
}
