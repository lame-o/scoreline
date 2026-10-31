import Foundation

// The game as one broadcast, part 8: anchors (CHOREOGRAPHY §5.1). Where each
// known play's decisive moment lands on p, to well under a second.
//
// Neither field the feeds give places it alone. Wallclocks are whole seconds
// and tie (a miss and its rebound share one every time), and in a stoppage
// they're the stoppage's stamp, not the play's: free throws, substitutions and
// the rebound that restarts the clock all carry the moment the whistle blew,
// though they happened up to minutes later, just before play resumed. The game
// clock reads whole seconds above a minute. So the anchors are solved:
//
// 1. **Stretches.** While the clock runs, a play's time is the stretch's
//    offset plus its game clock: the median of (wallclock − game clock) over
//    the stretch's live-ball plays, which keeps the clock's relative timing
//    and the wallclocks' absolute placement and absorbs the quantization.
// 2. **Stoppages.** Plays at a stopped clock happened before the restart,
//    not at the stamp: each is placed back from the restart (the timeline's
//    bound, or where the next stretch says the clock started again) by the
//    sport's gaps; the rebound that restarts it, at the restart.
// 3. **Gaps.** Consecutive decisive moments keep the sport's physical
//    minimum apart (a rebound after the rim, free throws a routine apart).
// 4. **Solve.** Least squares to the targets subject to the gaps: with
//    `u = τ − Σgaps` the gaps become `u` nondecreasing, which is weighted
//    isotonic regression, solved exactly by pool-adjacent-violators. Plays
//    whose own times mean nothing (admin) are placed between their neighbors.
// 5. **Frozen.** Anchors already presented never move: the solve runs on what
//    follows them, starting no earlier than the last one's gap.
//
// Pure arithmetic, O(n), deterministic: it ports to the web exactly.

/// One play as the anchor solver reads it, in the timeline's order.
struct AnchorInput: Equatable, Sendable {
    var id: String
    var period: Int
    /// The reported event time (wallclock, MLB's startTime); nil: none.
    var eventTime: PTime?
    /// Where the moment must lie, when the timeline knows (a play stamped at a
    /// stoppage's start lies between the stamp and the clock's restart).
    var bounds: ClosedRange<PTime>?
    /// Game clock elapsed in the period (nil: no clock, or not given).
    var elapsed: Double?
    /// The clock's resolution (1 s; 0.1 s under a minute in basketball).
    var resolution: Double = 1
    var live: Bool
    var stopsClock: Bool
    /// How much its own time is believed: 1 a live-ball play's wallclock, 0 placed by its neighbors.
    var weight: Double
    /// The least time from this play's decisive moment to the next play's (the sport's physics table).
    var gapAfter: Double
    /// After its stoppage's plays, the clock restarts this long after it (the inbound after the last
    /// free throw); 0 for a play that restarts the clock itself (the rebound off a missed last free throw).
    var restartAfter: Double = 1
}

enum AnchorSolver {
    /// The least gap between two decisive moments of any kind: never two in one instant.
    static let least = 0.15

    /// Anchors for every play, in order; those in `frozen` keep theirs and the
    /// rest start no earlier than the last frozen one allows.
    static func solve(_ plays: [AnchorInput], frozen: [String: PTime] = [:]) -> [String: PlayAnchor] {
        guard !plays.isEmpty else { return [:] }
        let n = plays.count
        var out: [String: PlayAnchor] = [:]
        // The frozen prefix: up to the last play with a frozen anchor.
        let last = plays.lastIndex { frozen[$0.id] != nil }
        var floor = -Double.infinity
        if let last {
            var previous = -Double.infinity
            for i in 0...last {
                // A play behind the last frozen one without an anchor of its own sits just after the one before it.
                let at = frozen[plays[i].id] ?? (previous.isFinite ? previous + gap(plays[max(i - 1, 0)]) : frozen[plays[last].id]!)
                out[plays[i].id] = PlayAnchor(at: at)
                previous = at
            }
            floor = previous + gap(plays[last])
        }
        let start = (last ?? -1) + 1
        guard start < n else { return out }
        let suffix = Array(plays[start...])
        let (targets, weights) = targets(suffix)
        let solved = place(targets: targets, weights: weights, gaps: suffix.map(gap), bounds: suffix.map(\.bounds), floor: floor)
        for (k, play) in suffix.enumerated() { out[play.id] = PlayAnchor(at: solved[k]) }
        return out
    }

    static func gap(_ play: AnchorInput) -> Double { max(play.gapAfter, least) }

    // MARK: Targets

    /// Each play's target time and how much it's believed (§5.1 steps 1–2).
    static func targets(_ plays: [AnchorInput]) -> (targets: [Double?], weights: [Double]) {
        let n = plays.count
        var targets: [Double?] = plays.map { p in p.bounds.map { b in min(max(p.eventTime ?? b.lowerBound, b.lowerBound), b.upperBound) } ?? p.eventTime }
        var weights = plays.map { $0.eventTime == nil && $0.bounds == nil ? 0 : $0.weight }
        // Running-clock stretches: from a play after the clock restarted through the play that stops it.
        var stretches: [Range<Int>] = []
        var i = 0
        while i < n {
            guard plays[i].elapsed != nil else { i += 1; continue }
            var j = i
            while j + 1 < n, !plays[j].stopsClock, plays[j + 1].period == plays[i].period, let a = plays[j].elapsed, let b = plays[j + 1].elapsed,
                  b >= a - 1e-9 {
                j += 1
            }
            stretches.append(i..<(j + 1))
            i = j + 1
            // The plays at the clock it stopped at: the stoppage, placed below.
            if let stop = plays[j].elapsed, plays[j].stopsClock {
                while i < n, plays[i].period == plays[j].period, let g = plays[i].elapsed, abs(g - stop) <= max(plays[i].resolution, 1e-9) * 0.51 {
                    i += 1
                }
            }
        }
        // Each stretch's offset (wallclock − game clock) over its live-ball plays.
        var offsets: [Range<Int>: Double] = [:]
        for s in stretches {
            let samples = s.compactMap { k -> Double? in
                guard plays[k].live, plays[k].weight > 0, plays[k].bounds == nil, let w = plays[k].eventTime, let g = plays[k].elapsed else { return nil }
                return w - g
            }
            guard !samples.isEmpty else { continue }
            let offset = median(samples)
            offsets[s] = offset
            for k in s {
                guard let g = plays[k].elapsed else { continue }
                targets[k] = offset + g
                if plays[k].bounds == nil { weights[k] = max(weights[k], plays[k].live ? 1 : 0.75) }
            }
        }
        // Stoppages: the plays after a clock-stopping play at its clock, placed back from the restart.
        for (n, s) in stretches.enumerated() {
            let stopper = s.upperBound - 1
            guard plays[stopper].stopsClock, let stop = plays[stopper].elapsed else { continue }
            let next = n + 1 < stretches.count ? stretches[n + 1] : nil
            let cluster = (stopper + 1)..<(next?.lowerBound ?? plays.count)
            let members = cluster.filter { k in
                guard plays[k].period == plays[stopper].period, let g = plays[k].elapsed else { return false }
                return abs(g - stop) <= 0.51 * max(plays[k].resolution, 1e-9)
            }
            guard let lastMember = members.last else { continue }
            // The restart: the timeline's bound; else where the next stretch's clock reads the stop again.
            var restart = plays[lastMember].bounds?.upperBound
            if restart == nil, let next, plays[next.lowerBound].period == plays[stopper].period, let offset = offsets[next] {
                restart = offset + stop
            }
            guard let restart else { continue }
            let low = targets[stopper] ?? plays[stopper].eventTime ?? -Double.infinity
            // Backward from the restart by the gaps (the last one restarts it, or a moment before it).
            var at = restart - plays[lastMember].restartAfter
            for k in members.reversed() {
                if k != lastMember { at -= gap(plays[k]) }
                targets[k] = max(at, low + gap(plays[stopper]))
                weights[k] = 1
            }
        }
        return (targets, weights)
    }

    static func median(_ values: [Double]) -> Double {
        let s = values.sorted()
        return s.count % 2 == 1 ? s[s.count / 2] : (s[s.count / 2 - 1] + s[s.count / 2]) / 2
    }

    // MARK: Solving

    /// The times nearest the targets (weighted least squares) with each gap
    /// kept, none before `floor`; unweighted plays between their neighbors;
    /// bounds held where the gaps allow.
    static func place(targets: [Double?], weights: [Double], gaps: [Double], bounds: [ClosedRange<PTime>?], floor: Double) -> [Double] {
        let n = targets.count
        var before = [Double](repeating: 0, count: n)
        for i in 1..<max(n, 1) { before[i] = before[i - 1] + gaps[i - 1] }
        // Isotonic regression of (target − gaps before) over the plays that have a target.
        let fitted = (0..<n).filter { targets[$0] != nil && weights[$0] > 0 }
        var u = [Double](repeating: .nan, count: n)
        if !fitted.isEmpty {
            let y = fitted.map { targets[$0]! - before[$0] }
            let w = fitted.map { weights[$0] }
            let solved = isotonic(y, w)
            for (k, i) in fitted.enumerated() { u[i] = solved[k] }
        }
        // The rest: between their neighbors (u is nondecreasing, so anything between theirs keeps the gaps).
        let known = (0..<n).filter { !u[$0].isNaN }
        if known.isEmpty {
            // Nothing believed: the first time anyone gives, else the floor, then the gaps.
            let base = targets.compactMap { $0 }.first ?? (floor.isFinite ? floor : 0)
            for i in 0..<n { u[i] = base - before[0] }
        } else {
            for i in 0..<n where u[i].isNaN {
                let left = known.last { $0 < i }, right = known.first { $0 > i }
                switch (left, right) {
                case let (l?, r?): u[i] = u[l] + (u[r] - u[l]) * Double(i - l) / Double(r - l)
                case let (l?, nil): u[i] = u[l]
                case let (nil, r?): u[i] = u[r]
                default: break
                }
            }
        }
        // The floor (a frozen anchor's gap): clamping a nondecreasing sequence keeps it so, and is the projection.
        var tau = (0..<n).map { max(u[$0], floor - before[0]) + before[$0] }
        // Bounds: below, raised and the gaps carried forward; above, lowered where the gaps behind allow.
        for i in 0..<n {
            if let b = bounds[i], tau[i] > b.upperBound { tau[i] = max(b.upperBound, i > 0 ? tau[i - 1] + gaps[i - 1] : -.infinity) }
            if let b = bounds[i] { tau[i] = max(tau[i], b.lowerBound) }
            if i > 0 { tau[i] = max(tau[i], tau[i - 1] + gaps[i - 1]) }
            if i == 0, floor.isFinite { tau[0] = max(tau[0], floor) }
        }
        return tau
    }

    /// Weighted isotonic regression by pool-adjacent-violators: the
    /// nondecreasing sequence nearest `y` in Σ w·(u − y)².
    static func isotonic(_ y: [Double], _ w: [Double]) -> [Double] {
        var blocks: [(sum: Double, weight: Double, count: Int)] = []
        blocks.reserveCapacity(y.count)
        for i in y.indices {
            let wi = max(w[i], 1e-12)
            blocks.append((y[i] * wi, wi, 1))
            while blocks.count > 1 {
                let b = blocks[blocks.count - 1], a = blocks[blocks.count - 2]
                guard a.sum / a.weight > b.sum / b.weight else { break }
                blocks.removeLast(2)
                blocks.append((a.sum + b.sum, a.weight + b.weight, a.count + b.count))
            }
        }
        var out: [Double] = []
        out.reserveCapacity(y.count)
        for b in blocks { out += [Double](repeating: b.sum / b.weight, count: b.count) }
        return out
    }
}
