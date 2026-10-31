import Foundation

// The game as one broadcast, part 1: the timeline (BROADCAST.md §1).
//
// One event-time-ordered list of plays per game, merged from every lane that
// carries plays (ESPN's summary, ESPN's core plays, MLB's live feed), with the
// fast lane (the scoreboard, the core status) kept beside it as evidence, never
// as state. Everything here is a pure value type: no clock of its own, no
// SwiftUI, no network. Callers pass `now` (seconds since 1970, the same axis as
// ESPN's `wallclock`), so the recording bench replays it exactly.
//
// The parts:
// - **Ingest.** Each look at a lane is a `LaneSnapshot`: its plays in the
//   lane's order, and whether they cover the whole game or a tail of it. The
//   freshest lane wins each region of the game (a stale summary never undoes a
//   fresher core read), so revisions, removals and order all follow the newest
//   content, not the newest arrival.
// - **Event time.** `wallclock` (ESPN) or MLB's `startTime`; batched logging
//   times and missing ones are estimated from the game clock against their
//   neighbors. A play at a stopped game clock after a stoppage (free throws
//   and their rebounds after a foul, a timeout and a challenge) carries the
//   stoppage's stamp, not its own moment: its event time is a bound, [the
//   stoppage's start, the clock's restart], from the fast lane and the next
//   running-clock play, and such plays never size the delay. Plays are
//   presented at `presentAt`: event times made monotone in timeline order, a
//   bounded cluster placed backward from its restart (or the theater's
//   solved anchors, once it supplies them).
// - **Told.** What's been presented is recorded and always a prefix of the
//   timeline: a play inserted behind told plays is told at once ("late"), a
//   revision to a told play is a quiet correction, and a told play is never
//   untold.
// - **Knowledge.** The watermark is how far the timeline is known complete
//   for certain (`knowledge(at:)`): the late-insertion floor, a running game's
//   quiet allowance (confirmed or extended by the fast lane), a score the fast
//   lane has and no play explains, and a network guard. The clock never
//   presents past it less the binding horizon. How far behind live the page
//   runs is a separate, statistical matter: `targetDelay`, sized so almost
//   every live-ball play is known by its binding horizon (late binding).
// - **Score.** The presented score is the score after the last told play, so
//   score and plays can't disagree. The fast lane's score is a hint: one no
//   play explains holds the watermark, and after a grace period it's applied
//   quietly (the safety net), logged, and retired by the play when it comes.

/// Seconds since 1970 on the event-time axis (ESPN `wallclock`, MLB `startTime`).
/// The presentation clock presents it 1:1 (`p = now − D`).
typealias PTime = Double

// MARK: - Plays

/// A score after a play, by home and away (the feeds' own terms).
struct ScoreLine: Hashable, Sendable, CustomStringConvertible {
    var home: Int
    var away: Int

    var description: String { "\(away)–\(home)" }
}

/// The game clock as a play has it.
struct GameClockReading: Hashable, Sendable {
    /// Seconds played in the period (nil: a sport without a clock, or not given).
    var elapsed: Double?
    /// The source's resolution: 1 s, or 0.1 s under a minute (basketball).
    var resolution: Double = 1
    /// The source's text ("4:12", "33.8", "67'").
    var display: String?

    static let none = GameClockReading(elapsed: nil)
}

/// Where a play's event time comes from (CHOREOGRAPHY §10 `timeSource`).
enum EventTimeSource: Hashable, Sendable {
    /// ESPN's `wallclock`, trusted: the game clock had moved since the last stoppage.
    case wallclock
    /// MLB's `startTime` (the pitch's own moment, to the millisecond).
    case statsapi
    /// Estimated from the game clock between neighbors (missing, or batched logging).
    case estimated
    /// At a stopped clock after a stoppage: the stamp is the stoppage's; the
    /// moment lies within `eventBounds` (the stoppage's start to the clock's restart).
    case bounded
}

/// What kind of play it is, as far as the clock and the watermark care.
struct PlayKind: Hashable, Sendable {
    enum Phase: Hashable, Sendable {
        /// Shots, rebounds, turnovers, snaps, located soccer entries, pitches: they
        /// size the delay and the watermark (BROADCAST §2, CHOREOGRAPHY §3.5 law 3).
        case live
        /// Fouls, substitutions, timeouts, reviews, admin: routinely 50–230 s late,
        /// they attach to the stoppage they belong to and size nothing.
        case dead
    }

    var phase: Phase
    /// A word for the bench's breakdowns ("shot", "rebound", "free throw", "substitution").
    var label: String
    /// The game clock stops after it (a foul, a timeout, an incompletion, a period end).
    var stopsClock = false
    /// The period it ends, if it ends one; `endsGame`: the game's last.
    var endsPeriod: Int?
    var endsGame = false

    init(_ phase: Phase, _ label: String, stopsClock: Bool = false, endsPeriod: Int? = nil, endsGame: Bool = false) {
        self.phase = phase
        self.label = label
        self.stopsClock = stopsClock || endsPeriod != nil
        self.endsPeriod = endsPeriod
        self.endsGame = endsGame
    }
}

/// A lane: where a look at the game came from.
struct LaneID: Hashable, Sendable, CustomStringConvertible {
    let raw: String
    init(_ raw: String) { self.raw = raw }
    var description: String { raw }

    /// ESPN's game summary (`site.api…/summary`): the whole game, every ~10–30 s.
    static let summary = LaneID("summary")
    /// ESPN's core plays (`sports.core.api…/plays`): the newest plays, every ~5 s.
    static let core = LaneID("core")
    /// MLB's live feed (statsapi): the whole game, with millisecond event times.
    static let statsapi = LaneID("statsapi")

    /// How old a look's content can be when it lands (its cache's max-age):
    /// a play this lane lacks but another lane has had for less than this isn't
    /// gone, the lane just hasn't caught up.
    var contentAge: Double { self == .summary ? 12 : 4 }
}

/// One play as a lane reported it, parsed by the sport's adapter (BroadcastLanes.swift).
struct TimelineEntry<Payload: Sendable & Equatable>: Equatable, Sendable {
    var id: String
    /// The reported event time (ESPN `wallclock`, MLB `startTime`); nil when the feed has none.
    var wallclock: PTime?
    var period: Int
    /// Game progress within the period, increasing with play (elapsed game
    /// seconds; for baseball, an at-bat and pitch ordinal). Orders lanes by recency.
    var progress: Double
    var clock: GameClockReading
    var kind: PlayKind
    /// The score after it, when the feed says.
    var score: ScoreLine?
    /// The feed's line, for logs and the bench.
    var text: String
    /// Where `wallclock` came from (MLB's feed sets `.statsapi`).
    var reportedSource: EventTimeSource = .wallclock
    /// What changed between versions, by the adapter's own fields (a revision is a new digest).
    var digest: Int
    /// The sport's parsed play (Phase A: the feed's own entry, as JSON).
    var payload: Payload

    static func == (a: Self, b: Self) -> Bool {
        a.id == b.id && a.digest == b.digest && a.wallclock == b.wallclock && a.period == b.period && a.kind == b.kind
            && a.score == b.score && a.clock == b.clock
    }
}

/// A look at one lane: its plays in game order, and how much of the game they are.
struct LaneSnapshot<Payload: Sendable & Equatable>: Sendable {
    enum Coverage: Sendable {
        /// The whole game so far (the summary, MLB's feed): a play it lacks is gone.
        case full
        /// A contiguous tail of the game, from its first play on (core plays' window).
        case tail
    }

    var lane: LaneID
    var entries: [TimelineEntry<Payload>]
    var coverage: Coverage
    /// When it arrived (wall time on the event-time axis).
    var arrived: PTime
}

/// The feed's own entry for a play, carried through the timeline so the page's
/// real parsers (NBADetail, FootballScene, SoccerScene…) can read the presented
/// prefix. JSONSerialization's containers are immutable, so sharing one across
/// isolation domains is safe; equality is by the adapter's digest.
struct RawPlay: @unchecked Sendable, Equatable {
    let json: JSON
    let digest: Int

    static func == (a: RawPlay, b: RawPlay) -> Bool { a.digest == b.digest }
}

// MARK: - Event time

enum EventTime {
    /// ISO 8601 UTC ("2026-10-31T04:49:18Z", with optional fractional seconds or
    /// a numeric offset) to seconds since 1970, without a formatter: the summary
    /// carries ~500 of these per look. Nil for anything else.
    static func parse(_ text: String?) -> PTime? {
        guard let text else { return nil }
        let u = Array(text.utf8)
        guard u.count >= 19, u[4] == 45, u[7] == 45, u[10] == 84 || u[10] == 32, u[13] == 58, u[16] == 58 else {
            return DateParser.parse(text)?.timeIntervalSince1970
        }
        func number(_ from: Int, _ count: Int) -> Int? {
            var value = 0
            for i in from..<(from + count) {
                let c = u[i]
                guard c >= 48, c <= 57 else { return nil }
                value = value * 10 + Int(c - 48)
            }
            return value
        }
        guard let year = number(0, 4), let month = number(5, 2), let day = number(8, 2),
              let hour = number(11, 2), let minute = number(14, 2), let second = number(17, 2),
              (1...12).contains(month), (1...31).contains(day) else { return nil }
        var fraction = 0.0
        var i = 19
        if i < u.count, u[i] == 46 {
            i += 1
            var scale = 0.1
            while i < u.count, u[i] >= 48, u[i] <= 57 {
                fraction += Double(u[i] - 48) * scale
                scale /= 10
                i += 1
            }
        }
        var offset = 0
        if i < u.count, u[i] == 43 || u[i] == 45, i + 2 < u.count, let h = number(i + 1, 2) {
            var m = 0
            if i + 5 < u.count, u[i + 3] == 58 { m = number(i + 4, 2) ?? 0 } else if i + 4 < u.count { m = number(i + 3, 2) ?? 0 }
            offset = (h * 3600 + m * 60) * (u[i] == 43 ? 1 : -1)
        }
        // Days from the civil date (Howard Hinnant's algorithm).
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let mp = (month + 9) % 12
        let doy = (153 * mp + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        let days = era * 146_097 + doe - 719_468
        return Double(days * 86_400 + hour * 3600 + minute * 60 + second - offset) + fraction
    }
}

// MARK: - The timeline

/// Why a play was told.
enum TellReason: Hashable, Sendable {
    /// The clock reached it.
    case onTime
    /// It arrived (or was inserted) after the clock had passed where it belongs.
    case late
    /// Before the page opened, or skipped by a declared jump: shown, never told as news.
    case history
    /// Far behind what's told (more than 30 s past its moment), or inserted behind
    /// told plays: a scorer's correction, attached quietly, never told as news.
    case correction
}

/// One ingest's effect, for the page (what to re-derive) and the bench (what to count).
struct TimelineChange: Sendable, Equatable {
    var added: [String] = []
    var revised: [String] = []
    var removed: [String] = []
    /// Revised or removed after being told: quiet corrections, never re-told (BROADCAST §1).
    var correctedTold: [String] = []
    var removedTold: [String] = []
    /// Inserted behind the told prefix: told at once, late.
    var lateInsertions: [String] = []
    var isEmpty: Bool { added.isEmpty && revised.isEmpty && removed.isEmpty && lateInsertions.isEmpty }
}

/// The knowledge frontier (the watermark): up to `frontier` the timeline is believed complete.
struct Knowledge: Equatable, Sendable {
    enum Bound: Hashable, Sendable {
        /// The newest live-ball play less the late-insertion allowance: the floor, when nothing better holds.
        case insertion
        /// The network guard: the slow lane hasn't been read for a few read intervals.
        case freshness
        /// The game clock runs and nothing's come for longer than the sport allows.
        case quiet
        /// The fast lane shows a score no play explains yet.
        case unexplainedScore
        /// No plays yet.
        case empty
    }

    var frontier: PTime
    var bound: Bound
}

/// One reading of the fast lane (the scoreboard, the core status), kept as evidence.
struct FastReading: Equatable, Sendable {
    enum State: Hashable, Sendable {
        /// In play (the clock may be running or stopped).
        case live
        /// Between periods, halftime, between innings: nothing will be logged for a while.
        case interval
        case final
    }

    var arrived: PTime
    var state: State
    var period: Int?
    /// Seconds played in the period, if the lane has a clock.
    var elapsed: Double?
    /// Whether the clock moved since the lane's previous reading (nil: can't tell).
    var running: Bool?
    var score: ScoreLine?
    /// Which lane, for logs: "scoreboard", "status".
    var source: String
}

/// The fast lane's word on the clock, on the event-time axis (CHOREOGRAPHY §10).
enum Hint: Equatable, Sendable {
    case clockStopped(period: Int, at: Double, seen: PTime)
    case clockRunning(period: Int, from: Double, seen: PTime)
}

/// A score the fast lane had that no play explained, applied after its grace (the safety net).
struct ScoreCorrection: Equatable, Sendable {
    /// The newest play when it was applied: it sits right after it.
    var after: String?
    /// Where it's presented on p.
    var at: PTime
    var score: ScoreLine
    /// When it was applied (wall time).
    var applied: PTime
}

/// Late binding (BROADCAST §2): how long before a play's decisive moment the
/// director must know the play's details. Before that horizon the lead-in is
/// generic flow it can steer at bind time; inside it (the shooter's catch or
/// gather, the snap, the strike) it needs the play. Supplied per kind by the
/// theater side (`Broadcast.bindingHorizons`); live-ball 2.5 s by default
/// (*tune*); dead-ball kinds attach late to their stoppage and need none.
struct BindingHorizons: Equatable, Sendable {
    var live: Double = 2.5
    /// By the kind's label ("shot", "snap", "pitch").
    var byKind: [String: Double] = [:]

    /// The kind's own entry, else `live` for live-ball kinds and none for dead-ball (they attach late).
    func horizon(for kind: PlayKind) -> Double {
        byKind[kind.label] ?? (kind.phase == .dead ? 0 : live)
    }
}

/// The numbers the timeline and the clock run on, per sport (BroadcastLanes.swift sets them).
struct BroadcastPolicy: Equatable, Sendable {
    /// The quantile of live-ball (lag + binding horizon) the delay is sized from (tuned on the bench).
    var quantile = 0.95
    /// The binding horizons, until the theater supplies its own.
    var horizons = BindingHorizons()
    /// A little room on top.
    var margin: Double = 1.0
    /// The live-ball lag assumed before enough plays have arrived (measured per sport).
    var priorLag: Double = 45
    /// The lag window: this many of the newest live-ball arrivals.
    var lagWindow = 40
    /// Samples before the window is trusted alone (until then it's blended with the prior, never below what it's seen).
    var lagTrust = 10
    /// The delay's bounds.
    var minDelay: Double = 8
    var maxDelay: Double = 150
    /// How far behind the newest live-ball play another may still be inserted (measured).
    var insertionAllowance: Double = 4
    /// No play reaches the feed sooner than this after it happens (measured p10 ≈ 23 s for the NBA): an upper bound
    /// for a stopped-clock play's moment until the clock's restart is known.
    var minimumLag: Double = 10
    /// The longest a running game goes without logging a live-ball play, in wall seconds.
    var quietRunning: Double = 60
    /// The fast lane's lag behind event time, until it's measured.
    var priorFastLag: Double = 24
    /// Hold the clock before a score the fast lane has and no play explains. Off (the default, measured
    /// on the bench: it cost ~10 s of delay to tell such baskets on time rather than as micro catch-ups):
    /// the clock keeps time, and the order guard is at the tell (nothing after the score is told before it).
    var holdForUnexplainedScores = false
    /// A score the fast lane has and no play explains is applied once it's held the clock this long.
    var safetyGrace: Double = 20
    /// More than this far behind the target delay: a declared jump.
    var jumpMax: Double = 40
    /// Catch up (or fall back) inside stoppages, where moving the clock changes nothing on screen.
    var skipStoppages = true
    /// Whether the game clock counts down (basketball, football) or up (soccer); nil: none (baseball).
    var clockCountsDown: Bool? = true
    /// Seconds in a regulation period and in an overtime one (0: untimed).
    var periodLength: Double = 720
    var overtimeLength: Double = 300
    var regulationPeriods = 4
    /// Approaching a hard cap, the clock slews down (0.92×) from this far ahead of it, then eases to a hold.
    var approach: Double = 5
    /// The app's cadence for the slow lane (the bench replays it).
    var slowPoll: Double = 5
    /// And for the fast lane's score (the scoreboard) and clock (the core status).
    var scoreboardPoll: Double = 30
    var statusPoll: Double = 5

    func length(of period: Int) -> Double { period <= regulationPeriods ? periodLength : overtimeLength }
}

enum Stats {
    /// The q-quantile, linearly interpolated (q in 0…1).
    static func quantile(_ values: [Double], _ q: Double) -> Double {
        guard !values.isEmpty else { return 0 }
        let sorted = values.sorted()
        let rank = min(max(q, 0), 1) * Double(sorted.count - 1)
        let lo = Int(rank.rounded(.down)), hi = min(lo + 1, sorted.count - 1)
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - Double(lo))
    }
}

/// One game's plays, merged from every lane, in game order. A value type: the
/// page keeps one (Broadcast.swift), the bench replays one.
struct GameTimeline<Payload: Sendable & Equatable>: Sendable {
    struct Record: Sendable {
        var entry: TimelineEntry<Payload>
        /// When the play first arrived, from any lane (wall time).
        var firstSeen: PTime
        /// When its current version arrived.
        var changed: PTime
        /// Versions after the first.
        var revisions = 0
        /// The event time used: the reported one, or an estimate (`estimated`).
        var eventTime: PTime = 0
        var estimated = false
        /// Where the event time comes from; for a stopped-clock play after a stoppage, the bound it lies in.
        var timeSource = EventTimeSource.wallclock
        var bounds: ClosedRange<PTime>?
        /// Its arrival lag, if it arrived at the frontier (it may still turn out to be untrustworthy).
        var arrivalLag: Double?
        /// When it's presented on p: event times made monotone in timeline order.
        var presentAt: PTime = 0
        var told: TellReason?
        /// p when it was told, and the version it was told in (a later one is a correction).
        var toldAt: PTime?
        var toldDigest: Int?
        /// The lane its current version came from.
        var lane: LaneID
        /// Known before it could be news: in the opening look, or filled in behind the frontier.
        var backfill = false

        var id: String { entry.id }
        var isTold: Bool { told != nil }
        /// A live-ball play whose event time is its own (the clock had moved since the
        /// last stoppage): only these size the delay and calibrate the fast lane.
        var trusted: Bool {
            entry.kind.phase == .live && (timeSource == .wallclock || timeSource == .statsapi) && bounds == nil
        }
    }

    let policy: BroadcastPolicy
    private(set) var records: [Record] = []
    private var index: [String: Int] = [:]
    /// Bumps on any change to the plays or to what's told.
    private(set) var revision: UInt64 = 0
    /// Each lane's latest look.
    private var lanes: [LaneID: LaneView] = [:]
    /// When the first look arrived.
    private(set) var opened: PTime?
    /// The binding horizons (the theater's, once it supplies them).
    var horizons: BindingHorizons {
        didSet { if horizons != oldValue { revision &+= 1 } }
    }
    /// The theater's solved decisive moments (Phase 0's anchor solver), by play:
    /// untold plays are presented there, so the score and the slide agree with the theater.
    private(set) var anchors: [String: PTime] = [:]
    /// When each slow lane was last read successfully, changed or not.
    private var lastRead: [LaneID: PTime] = [:]
    /// The gaps between the slow lane's reads (any lane), newest last.
    private var readGaps: [Double] = []
    /// Told plays since removed: one that flickers back isn't told again.
    private var toldTombstones: [String: TellReason] = [:]
    /// Every version each play has had: a stale cache's older version never wins again.
    private var digests: [String: Set<Int>] = [:]
    /// When each lane first answered with less than it had before (a stale cache,
    /// or its newest play removed): believed once it says so for its content age.
    private var regressions: [LaneID: PTime] = [:]
    /// The fast lane, as evidence.
    private(set) var fast = FastLane()
    private(set) var corrections: [ScoreCorrection] = []
    /// How often the safety net has applied a score (it should be rare).
    private(set) var safetyNetApplied = 0

    private struct LaneView: Sendable {
        var entries: [TimelineEntry<Payload>]
        var coverage: LaneSnapshot<Payload>.Coverage
        var arrived: PTime
        var recency: Recency
    }

    /// How far into the game a look is: its newest play, then when it came.
    struct Recency: Comparable, Sendable {
        var period: Int
        var progress: Double
        var arrived: PTime
        static func < (a: Self, b: Self) -> Bool { (a.period, a.progress, a.arrived) < (b.period, b.progress, b.arrived) }
    }

    init(policy: BroadcastPolicy) {
        self.policy = policy
        horizons = policy.horizons
    }

    // MARK: Reading

    var isEmpty: Bool { records.isEmpty }
    var count: Int { records.count }
    func record(_ id: String) -> Record? { index[id].map { records[$0] } }
    func position(of id: String) -> Int? { index[id] }
    func knows(_ id: String) -> Bool { index[id] != nil }
    func isTold(_ id: String) -> Bool { index[id].map { records[$0].isTold } ?? false }

    /// How many plays are told (always the first ones).
    var toldCount: Int {
        var lo = 0, hi = records.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if records[mid].isTold { lo = mid + 1 } else { hi = mid }
        }
        return lo
    }

    var lastTold: Record? {
        let n = toldCount
        return n > 0 ? records[n - 1] : nil
    }

    /// The next play to tell, if one is known.
    var nextUntold: Record? {
        let n = toldCount
        return n < records.count ? records[n] : nil
    }

    /// The newest live-ball event time known.
    var newestLive: PTime? { records.last { $0.entry.kind.phase == .live }?.eventTime }

    /// The newest event time of anything known.
    var newest: PTime? { records.lazy.map(\.eventTime).max() }

    /// Every score the plays have, in order.
    var scores: [ScoreLine] { records.compactMap(\.entry.score) }

    /// The score after the told plays, at `p` (a safety-net correction counts once p reaches it).
    func presentedScore(at p: PTime) -> ScoreLine? { score(through: toldCount, at: p) }

    /// The score after the first `count` plays, and any correction due by `p` placed after them.
    func score(through count: Int, at p: PTime = .infinity) -> ScoreLine? {
        var line: ScoreLine?
        var anchor = -1
        for i in stride(from: min(count, records.count) - 1, through: 0, by: -1) where records[i].entry.score != nil {
            line = records[i].entry.score
            anchor = i
            break
        }
        // A correction stands from where it's placed until a play after it carries a score.
        if let c = corrections.last(where: { c in
            let after = c.after.flatMap { index[$0] } ?? -1
            return after >= anchor && after < count && c.at <= p
        }) {
            line = c.score
        }
        return line
    }

    /// Live-ball arrivals at the frontier with trusted event times, by arrival: lag and kind.
    var lags: [(lag: Double, kind: PlayKind)] {
        records.filter { $0.trusted && $0.arrivalLag != nil }.sorted { $0.firstSeen < $1.firstSeen }
            .suffix(policy.lagWindow).map { ($0.arrivalLag!, $0.entry.kind) }
    }

    /// The live-ball lag quantile (the network guard's freshness allowance).
    var lagQuantile: Double { quantile(of: lags.map(\.lag), prior: policy.priorLag) }

    /// How often the slow lane is read.
    var readInterval: Double {
        readGaps.count < 3 ? policy.slowPoll : Stats.quantile(Array(readGaps.suffix(12)), 0.5)
    }

    /// The delay the clock aims for (BROADCAST §2, late binding): the
    /// quantile of each live-ball play's lag plus its binding horizon (the
    /// smallest delay at which the director almost always has a play by the
    /// time it must bind it), plus a margin. Plays later than that are
    /// recoverable: a compressed lead-in, a declared micro catch-up of up to
    /// 1.5 s, else the clock slews down (CHOREOGRAPHY §4.6).
    var targetDelay: Double {
        let need = lags.map { $0.lag + horizons.horizon(for: $0.kind) }
        let delay = quantile(of: need, prior: policy.priorLag + horizons.live) + policy.margin
        return min(max(delay, policy.minDelay), policy.maxDelay)
    }

    /// The quantile over the newest window, leaning on the prior until the
    /// window is trusted (never below what it's seen).
    private func quantile(of values: [Double], prior: Double) -> Double {
        let window = Array(values.suffix(policy.lagWindow))
        guard !window.isEmpty else { return prior }
        let measured = Stats.quantile(window, policy.quantile)
        guard window.count < policy.lagTrust else { return measured }
        let w = Double(window.count) / Double(policy.lagTrust)
        return max(measured, w * measured + (1 - w) * prior)
    }

    // MARK: Ingest

    /// A slow lane was read and had nothing new: it's fresh as of `now`.
    mutating func noteRead(_ lane: LaneID, at now: PTime) {
        if let last = lastRead.values.max(), now > last + 0.05 {
            readGaps.append(now - last)
            if readGaps.count > 24 { readGaps.removeFirst(readGaps.count - 24) }
        }
        lastRead[lane] = max(lastRead[lane] ?? -.infinity, now)
    }

    /// When a slow lane was last read.
    var lastReadAt: PTime? { lastRead.values.max() }

    /// A look at a lane. The freshest lane wins each region of the game; what
    /// it has is diffed against what was known: new plays, revisions (by ID; a
    /// version seen before never comes back), removals (only once the lane
    /// lacking a play has had time to catch up with it), and late insertions
    /// behind what's told.
    @discardableResult
    mutating func ingest(_ snapshot: LaneSnapshot<Payload>) -> TimelineChange {
        noteRead(snapshot.lane, at: snapshot.arrived)
        let opening = opened == nil
        if opening { opened = snapshot.arrived }
        guard !snapshot.entries.isEmpty || snapshot.coverage == .full else { return TimelineChange() }
        let last = snapshot.entries.last
        let view = LaneView(entries: snapshot.entries, coverage: snapshot.coverage, arrived: snapshot.arrived,
                            recency: Recency(period: last?.period ?? 0, progress: last?.progress ?? 0, arrived: snapshot.arrived))
        // Less than the lane had before: an older cache answering after a newer one, or
        // its newest play really removed. Believed only once the lane has said so for
        // longer than its content can be old.
        if let was = lanes[snapshot.lane],
           (view.recency.period, view.recency.progress + 0.001) < (was.recency.period, was.recency.progress) {
            guard let since = regressions[snapshot.lane], snapshot.arrived - since >= snapshot.lane.contentAge else {
                if regressions[snapshot.lane] == nil { regressions[snapshot.lane] = snapshot.arrived }
                return TimelineChange()
            }
        }
        regressions[snapshot.lane] = nil
        lanes[snapshot.lane] = view
        return apply(mergedEntries(), arrived: snapshot.arrived, opening: opening)
    }

    /// The game as the lanes have it: the freshest lane for its region, then each
    /// staler lane only for what comes before the region already covered; then
    /// plays the region's lane lacks but can't have caught up with yet.
    private func mergedEntries() -> [(entry: TimelineEntry<Payload>, lane: LaneID)] {
        let ordered = lanes.sorted { $0.value.recency > $1.value.recency }
        var merged: [(entry: TimelineEntry<Payload>, lane: LaneID)] = []
        var covered = Set<String>()
        var boundary: TimelineEntry<Payload>?
        var complete = false
        for (lane, view) in ordered where !view.entries.isEmpty {
            let part: [TimelineEntry<Payload>]
            if let boundary {
                if let cut = view.entries.firstIndex(where: { $0.id == boundary.id }) {
                    part = Array(view.entries[..<cut])
                } else {
                    // The fresher region starts at a play this lane hasn't got: keep what's before it in the game.
                    part = view.entries.filter { ($0.period, $0.progress) < (boundary.period, boundary.progress) }
                }
            } else {
                part = view.entries
            }
            var fresh: [(entry: TimelineEntry<Payload>, lane: LaneID)] = []
            for e in part where covered.insert(e.id).inserted { fresh.append((e, lane)) }
            merged.insert(contentsOf: fresh, at: 0)
            if view.coverage == .full {
                complete = true
                break
            }
            if let first = view.entries.first { boundary = first }
        }
        // Before every lane's reach (a window that has moved on): what was known stays.
        if !complete, let earliest = merged.first?.entry {
            let cut = index[earliest.id] ?? records.firstIndex {
                ($0.entry.period, $0.entry.progress) >= (earliest.period, earliest.progress)
            } ?? records.count
            var kept: [(entry: TimelineEntry<Payload>, lane: LaneID)] = []
            for r in records[..<cut] where covered.insert(r.id).inserted { kept.append((r.entry, r.lane)) }
            merged.insert(contentsOf: kept, at: 0)
        }
        // A play the region's lane lacks, but which arrived from another lane
        // too recently for this one to have it: kept, right after the play before it.
        var after: [String: [(entry: TimelineEntry<Payload>, lane: LaneID)]] = [:]
        var leading: [(entry: TimelineEntry<Payload>, lane: LaneID)] = []
        var laneOf: [String: LaneID] = [:]
        for m in merged { laneOf[m.entry.id] = m.lane }
        var anchor: String?
        var winner = merged.first?.lane ?? ordered.first?.key
        for r in records {
            if let lane = laneOf[r.id] {
                anchor = r.id
                winner = lane
                continue
            }
            guard !covered.contains(r.id), let lane = winner, let view = lanes[lane],
                  r.firstSeen > view.arrived - lane.contentAge else { continue }
            covered.insert(r.id)
            if let anchor { after[anchor, default: []].append((r.entry, r.lane)) } else { leading.append((r.entry, r.lane)) }
        }
        guard !after.isEmpty || !leading.isEmpty else { return merged }
        var out = leading
        out.reserveCapacity(merged.count + after.values.reduce(0) { $0 + $1.count })
        for m in merged {
            out.append(m)
            if let extra = after[m.entry.id] { out += extra }
        }
        return out
    }

    private mutating func apply(_ merged: [(entry: TimelineEntry<Payload>, lane: LaneID)], arrived: PTime,
                                opening: Bool) -> TimelineChange {
        var change = TimelineChange()
        let previous = records
        let previousIndex = index
        let frontier = newest
        var next: [Record] = []
        next.reserveCapacity(merged.count)
        var seen = Set<String>()
        for (entry, source) in merged where seen.insert(entry.id).inserted {
            if let i = previousIndex[entry.id] {
                var record = previous[i]
                if record.entry != entry {
                    // A version this play had before is a stale cache talking: keep the newer one.
                    if digests[entry.id]?.contains(entry.digest) == true, record.entry.digest != entry.digest {
                        next.append(record)
                        continue
                    }
                    digests[entry.id, default: []].insert(entry.digest)
                    record.revisions += 1
                    record.changed = arrived
                    change.revised.append(entry.id)
                    if record.isTold { change.correctedTold.append(entry.id) }
                }
                record.entry = entry
                record.lane = source
                next.append(record)
            } else {
                var record = Record(entry: entry, firstSeen: arrived, changed: arrived, lane: source)
                digests[entry.id, default: []].insert(entry.digest)
                let behind = frontier.map { (entry.wallclock ?? .infinity) < $0 - 60 } ?? false
                record.backfill = opening || behind
                if let reason = toldTombstones.removeValue(forKey: entry.id) { record.told = reason }
                // A live-ball play at the frontier: its lag sizes the delay (if its time turns out trustworthy).
                if !record.backfill, entry.kind.phase == .live, let w = entry.wallclock { record.arrivalLag = arrived - w }
                next.append(record)
                change.added.append(entry.id)
            }
        }
        for old in previous where !seen.contains(old.id) {
            change.removed.append(old.id)
            if let reason = old.told {
                change.removedTold.append(old.id)
                toldTombstones[old.id] = reason
            }
        }
        records = next
        reindex()
        estimateEventTimes()
        // Told is a prefix: anything behind a told play is told now, late.
        if let lastTold = records.lastIndex(where: \.isTold) {
            let toldP = records[lastTold].toldAt ?? records[lastTold].presentAt
            for i in 0..<lastTold where !records[i].isTold {
                records[i].told = records[i].backfill ? .history : .correction
                records[i].toldAt = toldP
                records[i].toldDigest = records[i].entry.digest
                records[i].presentAt = toldP
                change.lateInsertions.append(records[i].id)
            }
        }
        schedule()
        retireCorrections()
        fast.match(self)
        if !change.isEmpty { revision &+= 1 }
        return change
    }

    private mutating func reindex() {
        index.removeAll(keepingCapacity: true)
        for (i, r) in records.enumerated() { index[r.id] = i }
    }

    /// Event times: the reported one where it's believable; batched logging
    /// times and missing ones estimated from the game clock against neighbors.
    private mutating func estimateEventTimes() {
        let n = records.count
        guard n > 0 else { return }
        var times = records.map(\.entry.wallclock)
        var estimated = [Bool](repeating: false, count: n)
        // A batch: plays logged together (one wallclock) across a long stretch of
        // game clock (college football logs that way). All but the last are
        // spread back by the game clock from the play before the batch.
        var i = 0
        while i < n {
            guard let w = times[i] else { i += 1; continue }
            var j = i
            while j + 1 < n, times[j + 1] == w, records[j + 1].entry.period == records[i].entry.period { j += 1 }
            if j > i, let g0 = records[i].entry.clock.elapsed, let g1 = records[j].entry.clock.elapsed, g1 - g0 > 15,
               let b = (0..<i).last(where: { times[$0] != nil && times[$0]! < w }), let tb = times[b],
               let gb = records[b].entry.clock.elapsed, records[b].entry.period == records[i].entry.period, g1 > gb {
                for k in i..<j {
                    guard let gk = records[k].entry.clock.elapsed else { continue }
                    times[k] = tb + (w - tb) * min(max((gk - gb) / (g1 - gb), 0), 1)
                    estimated[k] = true
                }
            }
            i = j + 1
        }
        // Missing: between the neighbors that have one, by game clock where the period allows.
        for k in 0..<n where times[k] == nil {
            let prev = (0..<k).last { times[$0] != nil }
            let next = ((k + 1)..<n).first { records[$0].entry.wallclock != nil }
            let gk = records[k].entry.clock.elapsed
            switch (prev, next) {
            case let (p?, q?):
                let tp = times[p]!, tq = times[q]!
                var share = Double(k - p) / Double(q - p)
                if let gp = records[p].entry.clock.elapsed, let gq = records[q].entry.clock.elapsed, let gk,
                   records[p].entry.period == records[k].entry.period, records[q].entry.period == records[k].entry.period, gq > gp {
                    share = min(max((gk - gp) / (gq - gp), 0), 1)
                }
                times[k] = tp + (tq - tp) * share
            case let (p?, nil):
                var t = times[p]!
                if let gp = records[p].entry.clock.elapsed, let gk, records[p].entry.period == records[k].entry.period, gk > gp {
                    t += gk - gp
                }
                times[k] = t
            case let (nil, q?):
                times[k] = times[q]!
            case (nil, nil):
                times[k] = records[k].firstSeen
            }
            estimated[k] = true
        }
        for k in 0..<n {
            records[k].eventTime = times[k] ?? records[k].firstSeen
            records[k].estimated = estimated[k]
            records[k].timeSource = estimated[k] ? .estimated : records[k].entry.reportedSource
            records[k].bounds = nil
        }
        boundStoppedClusters()
    }

    /// Plays at a stopped game clock after a stoppage: ESPN stamps them with
    /// the stoppage's time (a timeout's, a challenge's), sometimes minutes
    /// before they happen. Each such play lies between the stoppage's start
    /// and the clock's restart: the restart as the fast lane saw it, or as the
    /// next running-clock play implies (its clock ran that long before it),
    /// or, until either is known, its own arrival less the feed's minimum lag.
    /// Every play of one cluster shares one bound (the theater groups clusters by it):
    /// the union of its plays' bounds, which is the restart for all once that's known.
    private mutating func boundStoppedClusters() {
        guard policy.clockCountsDown == true else { return }
        var stoppage: (period: Int, elapsed: Double, at: PTime, from: Int)?
        var cluster: [Int] = []
        func close() {
            guard let s = stoppage, !cluster.isEmpty else { return }
            var upper = cluster.map { records[$0].firstSeen - policy.minimumLag }.max() ?? s.at
            if let restart = restart(after: (s.period, s.elapsed, s.at), from: cluster[0]) { upper = min(upper, restart) }
            let bound = s.at...max(s.at, upper)
            for k in cluster {
                records[k].bounds = bound
                records[k].timeSource = .bounded
            }
            cluster = []
        }
        for k in records.indices {
            let e = records[k].entry
            guard let g = e.clock.elapsed else {
                close()
                stoppage = nil
                continue
            }
            if let s = stoppage, s.period == e.period, abs(g - s.elapsed) < 0.05 {
                cluster.append(k)
                continue
            }
            close()
            stoppage = e.kind.stopsClock ? (e.period, g, records[k].eventTime, k) : nil
        }
        close()
    }

    /// When the clock restarted after a stoppage at `s`: the fast lane's first
    /// moving reading after it (between it and the last stopped one, less the
    /// lane's lag), or the next running-clock play's moment less the time it ran.
    private func restart(after s: (period: Int, elapsed: Double, at: PTime), from k: Int) -> PTime? {
        var best: PTime?
        let lag = fastLag
        var previous: FastReading?
        for r in fast.readings where r.period == s.period {
            defer { previous = r }
            guard r.arrived - lag > s.at, let e = r.elapsed, e > s.elapsed + 0.5 else { continue }
            let before = previous.map { $0.arrived } ?? r.arrived
            best = (before + r.arrived) / 2 - lag
            break
        }
        for j in records.indices.dropFirst(k + 1) where records[j].entry.period == s.period {
            guard let g = records[j].entry.clock.elapsed, g > s.elapsed + 0.05 else { continue }
            if records[j].timeSource == .wallclock || records[j].timeSource == .statsapi {
                let implied = records[j].eventTime - (g - s.elapsed)
                best = min(best ?? implied, implied)
            }
            break
        }
        return best
    }

    /// `presentAt`: event times made monotone in timeline order; a bounded
    /// cluster placed backward from its restart, a second apart (or at the
    /// theater's anchors). Told plays keep theirs.
    private mutating func schedule() {
        var floor = -Double.infinity
        var i = 0
        while i < records.count {
            // A run of plays sharing one bound: placed backward from its upper end.
            var j = i
            if let b = records[i].bounds {
                while j + 1 < records.count, records[j + 1].bounds == b { j += 1 }
            }
            for k in i...j {
                if records[k].isTold {
                    if records[k].toldAt == nil { records[k].presentAt = max(records[k].eventTime, floor) }
                    floor = max(floor, records[k].presentAt)
                    continue
                }
                var at = records[k].eventTime
                if let b = records[k].bounds { at = max(b.lowerBound, b.upperBound - Self.backoff(records, from: k, to: j)) }
                if let anchor = anchors[records[k].id] { at = anchor }
                records[k].presentAt = max(at, floor)
                floor = records[k].presentAt
            }
            i = j + 1
        }
    }

    /// The order guard: while the fast lane has a score no play explains, nothing
    /// after the last reading the plays explain is told (the clock keeps time).
    var tellBarrier: PTime? {
        guard !policy.holdForUnexplainedScores else { return nil }
        return fast.unexplainedFrom(timeline: self, lag: fastLag)
    }

    /// How far before a bounded cluster's restart its `k`th play goes, placed
    /// backward from the last (`j`): the last a second before the restart, free
    /// throws the routine's ~14 s apart (CHOREOGRAPHY §3.1), the rest 2 s.
    /// Provisional: the theater's anchor solver places the cluster precisely.
    static func backoff(_ records: [Record], from k: Int, to j: Int) -> Double {
        var t = 1.0
        var i = j
        while i > k {
            let both = records[i].entry.kind.label == "free throw" && records[i - 1].entry.kind.label == "free throw"
            t += both ? 14 : 2
            i -= 1
        }
        return t
    }

    /// The theater's solved decisive moments (CHOREOGRAPHY §5.1): untold plays
    /// are presented at them, so the score, the lists and the theater agree to the frame.
    mutating func setAnchors(_ solved: [String: PTime]) {
        guard solved != anchors else { return }
        anchors = solved
        schedule()
        revision &+= 1
    }

    // MARK: Telling

    /// Tells every play the clock has reached (`presentAt ≤ p`), in order, and
    /// returns them; none past `barrier` (a score no play explains yet: the
    /// order guard). One the clock passed by up to `lateAfter` is on time (a
    /// micro catch-up, CHOREOGRAPHY §4.6); by more, late; by more than 30 s, a
    /// quiet correction.
    @discardableResult
    mutating func tell(through p: PTime, reason: TellReason = .onTime, lateAfter: Double = 1.5, barrier: PTime = .infinity) -> [Record] {
        var told: [Record] = []
        var i = toldCount
        while i < records.count, records[i].presentAt <= p, records[i].presentAt <= barrier || reason == .history {
            var why = reason
            if why == .onTime, records[i].backfill { why = .history }
            if why == .onTime, p - records[i].presentAt > 30 { why = .correction }
            if why == .onTime, p - records[i].presentAt > lateAfter { why = .late }
            records[i].told = why
            records[i].toldAt = p
            records[i].toldDigest = records[i].entry.digest
            told.append(records[i])
            i += 1
        }
        if !told.isEmpty { revision &+= 1 }
        return told
    }

    /// Tells everything up to `p` as history (opening the page, waking, a declared jump).
    @discardableResult
    mutating func tellHistory(through p: PTime) -> [Record] { tell(through: p, reason: .history) }

    /// The `presentAt` of the next play to tell, if one is known.
    var nextPresentAt: PTime? { nextUntold?.presentAt }

    // MARK: Fast lane

    /// A fast-lane reading (the scoreboard every poll, the core status every few seconds).
    mutating func observe(_ reading: FastReading) {
        var lane = fast
        lane.observe(reading, timeline: self)
        fast = lane
        // A restart seen: the stopped-clock plays before it are bounded by it now.
        if records.contains(where: { $0.bounds != nil && !$0.isTold }) {
            for k in records.indices {
                records[k].bounds = nil
                records[k].timeSource = records[k].estimated ? .estimated : records[k].entry.reportedSource
            }
            boundStoppedClusters()
            schedule()
        }
    }

    /// The fast lane's lag behind event time: measured where its score changes
    /// meet scoring plays, else the sport's prior.
    var fastLag: Double { fast.lag ?? policy.priorFastLag }

    /// The clock's stops and starts as the fast lane saw them, on the event-time axis.
    var hints: [Hint] { fast.hints(lag: fastLag) }

    // MARK: Knowledge (the watermark)

    /// How far the timeline is known complete at `now`, for certain (the
    /// watermark: the clock never presents past it less the binding horizon).
    /// Hard evidence only; how far behind live to run is `targetDelay`'s job.
    /// - insertion: everything older than the newest live-ball play less the
    ///   late-insertion allowance is in (the floor);
    /// - quiet: a game whose clock may be running doesn't go silent for
    ///   longer than the sport allows (`quietRunning`) after the newest play:
    ///   past that, plays are missing (ESPN's play-by-play has stalled). The
    ///   fast lane's stopped clock at the newest play's, or an interval,
    ///   confirms a stoppage and restarts the allowance from that reading;
    /// - unexplained score: not past the last fast reading whose score the
    ///   timeline explains, while a newer one has a score no play does (a
    ///   free throw during a stoppage holds only once the clock runs again);
    /// - network: not past the last successful read plus a few read intervals,
    ///   less the lag quantile: when reads fail the clock stalls rather than
    ///   present a game it hasn't heard.
    func knowledge(at now: PTime) -> Knowledge {
        guard let newestAny = newest else { return Knowledge(frontier: -.infinity, bound: .empty) }
        let floor = (newestLive ?? newestAny) - policy.insertionAllowance
        var cap = (lastReadAt ?? now) + 3 * readInterval - lagQuantile
        var bound = Knowledge.Bound.freshness
        let quietFrom = max(newestAny, fast.quietConfirmed(through: self, lag: fastLag) ?? -.infinity)
        if quietFrom + policy.quietRunning < cap {
            cap = quietFrom + policy.quietRunning
            bound = .quiet
        }
        if policy.holdForUnexplainedScores, let unexplained = fast.unexplainedFrom(timeline: self, lag: fastLag), unexplained < cap {
            cap = unexplained
            bound = .unexplainedScore
        }
        if cap < floor { return Knowledge(frontier: floor, bound: .insertion) }
        return Knowledge(frontier: cap, bound: bound)
    }

    /// How far past `p` nothing on screen would change: no play to tell before
    /// it, and the game clock stopped all the way (the last told play stopped
    /// it, or the fast lane says so for that stretch). The clock may skip or
    /// hold anywhere inside it. Nil when there's no such span.
    func quietSpan(from p: PTime, knowledge: PTime) -> PTime? {
        guard let last = lastTold, last.presentAt <= p else { return nil }
        let end = min(nextUntold?.presentAt ?? .infinity, knowledge)
        guard end > p else { return nil }
        let stopped = last.entry.kind.stopsClock || policy.clockCountsDown == nil && last.entry.kind.endsPeriod != nil
            || fast.stopped(over: p...min(end, p + 600), lag: fastLag, period: last.entry.period)
        guard stopped, policy.clockCountsDown != false || last.entry.kind.endsPeriod != nil else { return nil }
        // A stopped clock restarts before the next play: its run stays in view.
        if let upcoming = nextUntold, policy.clockCountsDown == true, let g1 = upcoming.entry.clock.elapsed,
           let g0 = last.entry.clock.elapsed, upcoming.entry.period == last.entry.period, g1 > g0 {
            let restart = upcoming.presentAt - (g1 - g0)
            return restart > p ? min(end, restart) : nil
        }
        return end
    }

    // MARK: Safety net

    /// A score the fast lane has, that no play explains, applied once the
    /// grace has run out: quietly, right after the newest play (BROADCAST §1).
    /// The grace runs from the latest moment the score could have happened (its
    /// reading, less the fast lane's lag) on p, or, with the clock held for it,
    /// from the hold (`held`).
    @discardableResult
    mutating func applySafetyNet(now: PTime, p: PTime, held: Double?) -> ScoreCorrection? {
        guard let reading = fast.unexplainedReading(timeline: self), let score = reading.score else { return nil }
        let overdue = policy.holdForUnexplainedScores ? (held ?? 0) : p - (reading.arrived - fastLag)
        guard overdue >= policy.safetyGrace else { return nil }
        let at = max(reading.arrived - fastLag, records.last?.presentAt ?? -.infinity)
        let correction = ScoreCorrection(after: records.last?.id, at: at, score: score, applied: now)
        corrections.append(correction)
        safetyNetApplied += 1
        revision &+= 1
        return correction
    }

    /// A correction retires once a play after it carries its score.
    private mutating func retireCorrections() {
        corrections.removeAll { c in
            guard let id = c.after, let after = index[id] else { return c.after != nil }
            return records[(after + 1)...].contains { $0.entry.score == c.score }
        }
    }
}

// MARK: - The fast lane, as evidence

/// The fast lane's readings, kept as evidence about the event-time axis: its
/// lag (where its score changes meet scoring plays), the stretches it confirms
/// nothing happened, and the scores the timeline can't explain yet.
struct FastLane: Equatable, Sendable {
    private(set) var readings: [FastReading] = []
    /// Matched lags: the lane's first sighting of a score − the scoring play's event time.
    private(set) var samples: [Double] = []
    private var matched: Set<ScoreLine> = []
    /// Each score's first sighting (wall time).
    private var firstSeen: [ScoreLine: PTime] = [:]

    private static let keep = 160

    /// The matched lags' median, less half the lane's interval between score
    /// readings: each sighting is late by up to one poll (half, on average).
    var lag: Double? {
        guard samples.count >= 3 else { return nil }
        let scored = readings.filter { $0.score != nil }.map(\.arrived)
        let gaps = zip(scored.dropFirst(), scored).map { $0 - $1 }.filter { $0 > 0.5 }
        let interval = gaps.isEmpty ? 0 : Stats.quantile(gaps, 0.5)
        return max(Stats.quantile(Array(samples.suffix(20)), 0.5) - interval / 2, 3)
    }

    mutating func observe<P>(_ reading: FastReading, timeline: GameTimeline<P>) {
        readings.append(reading)
        if readings.count > Self.keep { readings.removeFirst(readings.count - Self.keep) }
        if let score = reading.score, firstSeen[score] == nil { firstSeen[score] = reading.arrived }
        match(timeline)
    }

    /// Each score the lane showed after the page opened, against the play that first had it.
    mutating func match<P>(_ timeline: GameTimeline<P>) {
        guard let opened = readings.first?.arrived else { return }
        var earlier = Set<ScoreLine>()
        for record in timeline.records {
            guard let score = record.entry.score else { continue }
            defer { earlier.insert(score) }
            guard !earlier.contains(score), !matched.contains(score), let seen = firstSeen[score] else { continue }
            matched.insert(score)
            let sample = seen - record.eventTime
            // Only plays whose time is their own (a running-clock basket, not a free throw stamped at the stoppage).
            guard seen > opened, record.trusted || (record.timeSource == .wallclock && record.bounds == nil),
                  sample > 0, sample < 180 else { continue }
            samples.append(sample)
            if samples.count > 40 { samples.removeFirst(samples.count - 40) }
        }
    }

    /// The newest event time the lane confirms nothing happened through: the
    /// latest reading in an interval, or with the clock stopped at the newest
    /// play's clock (same period), and the score the plays have. Readings
    /// after it (the clock running again) don't undo it: the quiet allowance
    /// simply runs from there.
    func quietConfirmed<P>(through timeline: GameTimeline<P>, lag: Double) -> PTime? {
        guard let newest = timeline.records.last else { return nil }
        let score = timeline.score(through: timeline.records.count)
        for r in readings.reversed() {
            // Only evidence from after the newest play speaks about the time since it.
            guard r.arrived - lag >= newest.eventTime else { return nil }
            guard r.score == nil || score == nil || r.score == score else { continue }
            if r.state == .interval { return r.arrived - lag }
            if r.state == .live, r.running == false, let e = r.elapsed, let g = newest.entry.clock.elapsed,
               r.period == newest.entry.period, abs(e - g) < 1.5 {
                return r.arrived - lag
            }
        }
        return nil
    }

    /// Whether the lane had the clock stopped (or an interval) over a stretch of event time.
    func stopped(over span: ClosedRange<PTime>, lag: Double, period: Int) -> Bool {
        func quiet(_ r: FastReading) -> Bool {
            r.state == .interval || (r.running == false && (r.period == nil || r.period == period))
        }
        guard let before = readings.last(where: { $0.arrived - lag <= span.lowerBound }), quiet(before) else { return false }
        return readings.allSatisfy { r in
            let t = r.arrived - lag
            return t <= span.lowerBound || t > span.upperBound || quiet(r)
        }
    }

    /// The newest reading whose score no play (or correction) explains, if it's ahead of the plays.
    func unexplainedReading<P>(timeline: GameTimeline<P>) -> FastReading? {
        guard let r = readings.last(where: { $0.score != nil }), let score = r.score else { return nil }
        let known = Set(timeline.scores).union(timeline.corrections.map(\.score))
        guard !known.contains(score) else { return nil }
        // A lower score than the plays already have is the lane lagging, not news.
        if let newest = timeline.scores.last, score.home <= newest.home, score.away <= newest.away { return nil }
        return r
    }

    /// While a reading shows a score no play explains, how far p may go:
    /// - the score came with play (a basket, a touchdown, a goal): not past the
    ///   last reading before it whose score the timeline explains (it changed after);
    /// - the score came while the clock was already stopped at the same reading
    ///   (free throws after the foul stopped it, an extra point): nothing live can
    ///   happen until the clock runs again, so p goes on through the stoppage and
    ///   the play attaches late (CHOREOGRAPHY §4.6); not past the restart, though.
    func unexplainedFrom<P>(timeline: GameTimeline<P>, lag: Double) -> PTime? {
        guard let bad = unexplainedReading(timeline: timeline), let score = bad.score else { return nil }
        let known = Set(timeline.scores).union(timeline.corrections.map(\.score))
        let first = readings.firstIndex { $0.score == score } ?? readings.count - 1
        let consistent = readings[..<first].last { $0.score.map(known.contains) ?? false }
        // The score changed after the last reading that had the old one, and after the last
        // play that still carries the old one (every play carries the score after it).
        let lastOld = timeline.scores.last.flatMap { old in timeline.records.last { $0.entry.score == old }?.eventTime }
        let changedAfter = max((consistent?.arrived ?? readings[first].arrived - 30) - lag, lastOld ?? -.infinity)
        // The clock as the lanes read it just before the score, and with it.
        let before = readings[..<first].last { $0.elapsed != nil && $0.running != nil }
        let with = readings[first...].first { $0.elapsed != nil }
        if let before, let with, before.running == false, before.period == with.period,
           let a = before.elapsed, let b = with.elapsed, abs(a - b) < 1.5 {
            // Stopped since before the score: the cap is where it ran again (nil while it hasn't).
            guard let restart = readings[first...].firstIndex(where: { $0.running == true }) else { return nil }
            let lastStopped = readings[first..<restart].last { $0.running == false } ?? readings[first]
            return max(lastStopped.arrived - lag, changedAfter)
        }
        return changedAfter
    }

    /// The clock's stops and starts, on the event-time axis.
    func hints(lag: Double) -> [Hint] {
        var out: [Hint] = []
        var was: Bool?
        for r in readings {
            guard let running = r.running, let period = r.period, let e = r.elapsed else { continue }
            if running != was {
                out.append(running ? .clockRunning(period: period, from: e, seen: r.arrived - lag)
                                   : .clockStopped(period: period, at: e, seen: r.arrived - lag))
                was = running
            }
        }
        return out
    }

    static func == (a: FastLane, b: FastLane) -> Bool { a.readings == b.readings && a.samples == b.samples }
}
