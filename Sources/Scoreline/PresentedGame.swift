import Foundation

// The game as one broadcast, part 4: what's presented at p (BROADCAST.md §3).
//
// The score after the last told play, its period, the game clock as it read at
// p, and the game's phase. The clock is derived, never extrapolated past what's
// known: it runs from the last told play (unless that play stopped it, or the
// fast lane says it was stopped then), restarts in time to reach the next
// known play's clock exactly when that play is presented, and never runs below
// it. So the scoreboard, the play lists and the theater can't disagree about
// the time either. Pure: the page re-derives it at each change it schedules
// (`nextChange`), never per frame.

struct PresentedGame: Equatable, Sendable {
    enum Phase: Hashable, Sendable {
        /// Nothing told yet.
        case pregame
        case live
        /// Between periods (`period` just ended), halftime, between innings.
        case interval(period: Int)
        case final
    }

    /// The game clock at p.
    struct Clock: Hashable, Sendable {
        var period: Int
        /// Seconds played in the period.
        var elapsed: Double
        var running: Bool
        /// Counting down (basketball, football) or up (soccer).
        var countsDown: Bool
        /// Seconds in the period (0: untimed).
        var length: Double

        /// Seconds left, for a countdown.
        var remaining: Double { max(length - elapsed, 0) }
    }

    var phase = Phase.pregame
    var score: ScoreLine?
    var period: Int?
    var clock: Clock?
    /// The last told play, and how many are told.
    var lastID: String?
    var told = 0
    /// The timeline's revision this was derived from (a correction to a told play changes it).
    var revision: UInt64 = 0

    var isFinal: Bool { phase == .final }
    var isInterval: Bool { if case .interval = phase { true } else { false } }

    /// What's presented at `p`.
    static func at<P>(_ p: PTime, timeline: GameTimeline<P>) -> PresentedGame {
        var game = PresentedGame()
        game.revision = timeline.revision
        game.told = timeline.toldCount
        game.score = timeline.presentedScore(at: p)
        guard let last = timeline.lastTold else { return game }
        game.lastID = last.id
        let kind = last.entry.kind
        let period = last.entry.period
        game.period = period
        let policy = timeline.policy
        if kind.endsGame {
            game.phase = .final
        } else if let ended = kind.endsPeriod {
            game.phase = .interval(period: ended)
        } else {
            game.phase = .live
        }
        game.clock = clock(at: p, last: last, timeline: timeline, policy: policy)
        return game
    }

    /// The game clock at `p` from the last told play, the next known one, and the fast lane's word.
    static func clock<P>(at p: PTime, last: GameTimeline<P>.Record, timeline: GameTimeline<P>, policy: BroadcastPolicy) -> Clock? {
        guard let countsDown = policy.clockCountsDown, let g0 = last.entry.clock.elapsed else { return nil }
        let period = last.entry.period
        let length = policy.length(of: period)
        if last.entry.kind.endsPeriod != nil {
            return Clock(period: period, elapsed: countsDown ? length : g0, running: false, countsDown: countsDown, length: length)
        }
        let next = timeline.nextUntold.flatMap { $0.entry.period == period ? $0 : nil }
        let g1 = next?.entry.clock.elapsed
        // When it started running after the last play, if it has.
        var runningFrom: PTime?
        if countsDown {
            let hint = latestHint(timeline.hints, at: p, period: period)
            switch hint {
            case let .clockRunning(_, _, seen)?: runningFrom = max(seen, last.presentAt)
            case .clockStopped?: runningFrom = nil
            case nil: runningFrom = last.entry.kind.stopsClock ? nil : last.presentAt
            }
            // A stopped clock restarts in time to read the next play's clock when it's presented.
            if runningFrom == nil, let next, let g1, g1 > g0 {
                let restart = next.presentAt - (g1 - g0)
                if restart <= p { runningFrom = max(restart, last.presentAt) }
            }
        } else {
            // Soccer's clock runs through the half.
            runningFrom = last.presentAt
        }
        var ceiling = countsDown ? (length > 0 ? length : .infinity) : .infinity
        if let g1, g1 >= g0 { ceiling = min(ceiling, g1) }
        var elapsed = g0
        if let from = runningFrom { elapsed = min(g0 + max(p - from, 0), ceiling) }
        return Clock(period: period, elapsed: elapsed, running: runningFrom != nil && elapsed < ceiling,
                     countsDown: countsDown, length: length)
    }

    /// The fast lane's latest word on the clock at `p`, in this period.
    static func latestHint(_ hints: [Hint], at p: PTime, period: Int) -> Hint? {
        hints.last { hint in
            switch hint {
            case let .clockRunning(hp, _, seen), let .clockStopped(hp, _, seen): hp == period && seen <= p
            }
        }
    }

    /// The next p after `p` at which what's presented changes on its own: the
    /// next play's presentation, the running clock reaching where it stops, a
    /// stopped clock restarting, or the fast lane's next stop or start.
    static func nextChange<P>(after p: PTime, timeline: GameTimeline<P>) -> PTime? {
        var candidates: [PTime] = []
        if let next = timeline.nextPresentAt { candidates.append(next) }
        for c in timeline.corrections where c.at > p { candidates.append(c.at) }
        if let last = timeline.lastTold, let clock = clock(at: p, last: last, timeline: timeline, policy: timeline.policy) {
            let next = timeline.nextUntold.flatMap { $0.entry.period == last.entry.period ? $0 : nil }
            if clock.running {
                let ceiling = min(next?.entry.clock.elapsed ?? .infinity, clock.countsDown && clock.length > 0 ? clock.length : .infinity)
                if ceiling.isFinite { candidates.append(p + (ceiling - clock.elapsed)) }
            } else if clock.countsDown, let next, let g1 = next.entry.clock.elapsed, let g0 = last.entry.clock.elapsed, g1 > g0 {
                let restart = next.presentAt - (g1 - g0)
                if restart > p { candidates.append(restart) }
            }
            for hint in timeline.hints {
                switch hint {
                case let .clockRunning(hp, _, seen), let .clockStopped(hp, _, seen):
                    if hp == last.entry.period, seen > p { candidates.append(seen) }
                }
            }
        }
        return candidates.filter { $0 > p + 1e-6 }.min()
    }
}

// MARK: - Words

extension PresentedGame {
    /// The game's status as ESPN words it ("4:12 - 3rd", "End of 3rd",
    /// "Halftime", "67'", "HT", "Top 7th", "Final"), for the presented event.
    func status(_ sport: BroadcastSport, regulationPeriods: Int) -> String {
        switch phase {
        case .pregame:
            return "Live"
        case .final:
            let extra = (period ?? 0) > regulationPeriods
            switch sport {
            case .soccer: return extra ? "AET" : "FT"
            case .baseball: return (period ?? 0) > regulationPeriods ? "Final/\(((period ?? 0) + 1) / 2)" : "Final"
            default: return extra ? "Final/OT" : "Final"
            }
        case let .interval(ended):
            switch sport {
            case .soccer: return ended == 1 ? "HT" : "End of \(Ordinal.string(ended)) Half"
            case .baseball:
                let inning = (ended + 1) / 2
                return ended % 2 == 1 ? "Mid \(Ordinal.string(inning))" : "End \(Ordinal.string(inning))"
            default:
                if ended == regulationPeriods / 2 { return "Halftime" }
                return "End of \(Self.periodName(ended, regulation: regulationPeriods))"
            }
        case .live:
            guard let period else { return "Live" }
            switch sport {
            case .baseball:
                let inning = (period + 1) / 2
                return "\(period % 2 == 1 ? "Top" : "Bot") \(Ordinal.string(inning))"
            case .soccer:
                return clock.map { Self.minute($0, period: period) } ?? "Live"
            default:
                guard let clock else { return Self.periodName(period, regulation: regulationPeriods) }
                return "\(Self.countdown(clock.remaining)) - \(Self.periodName(period, regulation: regulationPeriods))"
            }
        }
    }

    /// "3rd", "OT", "2OT".
    static func periodName(_ period: Int, regulation: Int) -> String {
        if period <= regulation { return Ordinal.string(period) }
        let n = period - regulation
        return n == 1 ? "OT" : "\(n)OT"
    }

    /// "4:12", or under a minute "33.8" (ESPN's basketball clock).
    static func countdown(_ seconds: Double) -> String {
        if seconds < 60 { return String(format: "%.1f", (seconds * 10 + 1e-6).rounded(.down) / 10) }
        let whole = Int(seconds.rounded(.up))
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }

    /// Soccer's minute: "67'", "45'+2'" in added time.
    static func minute(_ clock: Clock, period: Int) -> String {
        let minute = Int(clock.elapsed / 60) + 1
        let base = [45, 90, 105, 120][min(max(period, 1), 4) - 1]
        return minute > base ? "\(base)'+\(minute - base)'" : "\(minute)'"
    }
}
