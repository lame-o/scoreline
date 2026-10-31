import Foundation

// The replay bench (BROADCAST.md "How it's proven"; CHOREOGRAPHY §9): a
// recorded game through the real lanes, the timeline and the presentation
// clock on a virtual clock, deterministic and faster than real time.
//
//   ./test.sh --bench                          every recorded game, the app's cadence
//   ./test.sh --bench basketball_nba           one sport
//   ./test.sh --bench basketball_nba/401909285 one game
//   ./test.sh --bench --recorder …             the recorder's own cadence (summary every 3 s)
//   ./test.sh --bench --root <dir> …           another recordings folder (Tests/Fixtures/broadcast)
//   ./test.sh --bench --grid …                 the trade curve: q × binding horizon
//
// Per game it prints D over the game and what it's made of, the delay it adds
// to today's scoreboard and page, how each live-ball play met its binding
// horizon (known before it; inside it, with the lead-in compressed; past its
// moment by up to 1.5 s, a declared micro catch-up; or beyond), late
// tellings, corrections after presentation, stalls, skips and jumps, and the
// safety net's applications.

enum BroadcastBench {
    struct Report {
        var label = ""
        var snapshots = 0
        var lanes = ""
        var minutes = 0.0
        var delays: [(t: PTime, actual: Double, target: Double)] = []
        var lags: [String: [Double]] = [:]
        var insertion: [Double] = []
        /// Each scoring play told: wall time told, and when the scoreboard first had that score.
        var added: [Double] = []
        var addedApp: [Double] = []
        var knownBeforeLeadIn: [String: (known: Int, total: Int)] = [:]
        /// Each live-ball play's arrival against its binding horizon, by kind.
        var binding: [String: [Binding: Int]] = [:]
        /// The target's terms at the end: lag quantile, horizon, margin, samples.
        var terms = (lag: 0.0, horizon: 0.0, margin: 0.0, samples: 0, quantile: 0.0)
        var late: [String: Int] = [:]
        var corrected = 0
        var removedTold = 0
        var revisions = 0
        var removals = 0
        var stalls: [Double] = []
        var skips: [Double] = []
        var jumps = 0
        var wakes = 0
        var safetyNet = 0
        var bounds: [Knowledge.Bound: Int] = [:]
        var fastLag: Double?
        var told = 0
        var history = 0
        /// The engine's cost per step (ingest + advance), on this (unoptimized) build: for the report only.
        var stepTime: [Double] = []
        /// The kinds the theater must bind (nil: every live-ball kind); the rest is flow.
        var decisive: Set<String>?
        /// Each new score told, behind its play's real moment: as the broadcast told it,
        /// as today's page showed it, as the scoreboard had it, and as the slow lane first had the play.
        var behindReal = (broadcast: [Double](), page: [Double](), board: [Double](), lane: [Double]())
        /// Announced plays (VAR decisions) told, by how: "onTime", "late", "correction".
        var reviews: [String: Int] = [:]
        /// Told scores revised down and held until the next play told (VAR overturns).
        var holds = 0
        /// Plays that change the score, told: by how ("history (jump)" is what the jump rule forbids).
        var scoring: [String: Int] = [:]
        /// Each jump's length (p moved), and each long stall's recovery: from the
        /// resume until D is back within 5 s of its target, with the deficit at the resume.
        var jumpLengths: [Double] = []
        var recoveries: [(deficit: Double, took: Double)] = []
        /// The recorder's holes (nothing read inside them), and the live-ball plays that
        /// landed in the look after one (their lag is ours: left out of the lags and binding).
        var holes = 0
        var holeMinutes = 0.0
        var afterOutage = 0
        /// Inside a hole and the 300 s after it (our own outage and its recovery): the jumps
        /// and stalls there, kept apart from the feed's (D samples and score delays there are left out).
        var outageJumps: [Double] = []
        var outageStalls = 0
    }

    /// How a live-ball play's arrival met its binding horizon (late binding, CHOREOGRAPHY §4.6).
    enum Binding: Hashable, CaseIterable {
        /// Known before p reached its binding horizon: planned at leisure.
        case beforeBind
        /// Inside the horizon, before its moment: the lead-in compressed to what's left.
        case compressed
        /// Past its moment by up to 1.5 s: a declared micro catch-up.
        case microCatchUp
        /// Later still, at the frontier: told late (CATCHING UP); the delay slews up to absorb it.
        case beyond
        /// Far behind what's told (more than 30 s), or inserted behind told plays:
        /// a scorer's correction, attached quietly, never re-told.
        case correction
    }

    static func main(_ arguments: [String]) -> Int32 {
        var root = Recording.defaultRoot
        var recorder = false
        var targets: [String] = []
        var trace = false
        var grid = false
        var overrides: [String] = []
        var i = 0
        while i < arguments.count {
            switch arguments[i] {
            case "--root":
                i += 1
                if i < arguments.count { root = URL(fileURLWithPath: arguments[i]) }
            case "--recorder": recorder = true
            case "--trace": trace = true
            case "--grid": grid = true
            case "--set":
                // --set key=value: a policy override for experiments (quantile, horizon, margin, quiet, unexplained, approach, jump).
                i += 1
                if i < arguments.count { overrides.append(arguments[i]) }
            default: targets.append(arguments[i])
            }
            i += 1
        }
        var games: [(String, String)] = []
        let sports = targets.isEmpty ? Recording.sports(root: root) : targets.map { String($0.split(separator: "/").first ?? "") }
        for (n, sport) in sports.enumerated() {
            let wanted = targets.isEmpty ? nil : targets[n].split(separator: "/").dropFirst().first.map(String.init)
            for event in Recording.events(root: root, sport: sport) where wanted == nil || wanted == event {
                games.append((sport, event))
            }
        }
        if games.isEmpty {
            print("No recorded games under \(root.path)")
            return 1
        }
        Self.overrides = overrides
        if grid { return trade(games, root: root, recorder: recorder) }
        var all: [String: [Report]] = [:]
        for (sport, event) in games {
            let recording = Recording.load(root: root, sport: sport, event: event)
            guard recording.snapshots.count + recording.core.count >= 3, let report = run(recording, recorder: recorder, trace: trace) else {
                print("\n== \(sport) \(event): too little recorded (\(recording.snapshots.count) snapshots)")
                continue
            }
            print(render(report))
            all[sport, default: []].append(report)
        }
        for (sport, reports) in all.sorted(by: { $0.key < $1.key }) where reports.count > 1 {
            print(render(combined(reports, label: "\(sport): all games")))
        }
        return 0
    }

    /// Policy overrides from `--set key=value`, applied to every run.
    nonisolated(unsafe) static var overrides: [String] = []

    static func overridden(_ base: BroadcastPolicy) -> BroadcastPolicy {
        var p = base
        for item in overrides {
            let parts = item.split(separator: "=", maxSplits: 1).map(String.init)
            guard parts.count == 2, let v = Double(parts[1]) else { continue }
            switch parts[0] {
            case "quantile": p.quantile = v
            case "horizon": p.horizons.live = v
            case "margin": p.margin = v
            case "quiet": p.quietRunning = v
            case "unexplained": p.holdForUnexplainedScores = v != 0
            case "approach": p.approach = v
            case "jump": p.jumpMax = v
            case "sizing": p.sizeOnDecisive = v != 0   // --set sizing=1: size D on the decisive kinds only
            default: print("unknown override \(parts[0])")
            }
        }
        return p
    }

    /// One recorded game through the engine.
    static func run(_ recording: Recording, recorder: Bool, trace: Bool = false, policy: BroadcastPolicy? = nil) -> Report? {
        guard let sport = recording.sport else { return nil }
        let base = policy ?? BroadcastLanes.policy(sport, path: recording.path)
        guard var replay = RecordingReplay(recording, policy: overridden(base)) else { return nil }
        let policy = replay.policy
        let cadence = recorder ? RecordingReplay.Cadence.recorder : .app(policy)
        var report = Report()
        report.label = "\(recording.sportDirectory) \(recording.event)"
        report.snapshots = recording.snapshots.count + recording.core.count
        report.lanes = [recording.snapshots.isEmpty ? nil : "\(recording.snapshots.count) summaries",
                        recording.core.isEmpty ? nil : "\(recording.core.count) core looks",
                        recording.status.isEmpty ? "status from the scoreboard" : "\(recording.status.count) status rows"].compactMap { $0 }.joined(separator: ", ")
        if let span = recording.span { report.minutes = (span.upperBound - span.lowerBound) / 60 }
        report.decisive = policy.decisive
        // Our own outages and their recovery: the feed's numbers leave them out.
        let outageWindows = replay.holes.map { $0.range.lowerBound...($0.range.upperBound + 300) }
        func ours(_ t: PTime) -> Bool { outageWindows.contains { $0.contains(t) } }
        report.holes = replay.holes.count
        report.holeMinutes = replay.holes.reduce(0) { $0 + ($1.range.upperBound - $1.range.lowerBound) } / 60
        // Today's page shows a lane's score while it's ahead (football, baseball, basketball);
        // soccer's page has no lane score: its hero is the scoreboard's.
        let laneScore = sport != .soccer
        // The scoreboard's first sighting of each score, and when the app (polling it every 30 s) would have shown it.
        var boardFirst: [ScoreLine: PTime] = [:]
        for row in recording.rows {
            guard row.json["state"].string == "in", let home = row.json["score"]["home"].int, let away = row.json["score"]["away"].int,
                  let at = row.json["at"].double else { continue }
            let score = ScoreLine(home: home, away: away)
            if boardFirst[score] == nil { boardFirst[score] = at }
        }
        let start = recording.span?.lowerBound ?? 0
        var nextSample = start
        var lastScore: ScoreLine?
        var newestLiveBefore: PTime?
        var stallSince: PTime?
        var recovering: (since: PTime, deficit: Double)?
        var stepStarted = DispatchTime.now()
        replay.run(cadence) { replay, t, step, change in
            report.stepTime.append(Double(DispatchTime.now().uptimeNanoseconds - stepStarted.uptimeNanoseconds) / 1e6)
            defer { stepStarted = DispatchTime.now() }
            let engine = replay.engine
            let timeline = engine.timeline
            if let change {
                report.revisions += change.revised.count
                report.removals += change.removed.count
                report.corrected += change.correctedTold.count
                report.removedTold += change.removedTold.count
                for id in change.lateInsertions {
                    guard let r = timeline.record(id), let why = r.told else { continue }
                    if r.entry.kind.announced { report.reviews["\(why) (inserted)", default: 0] += 1 }
                    if changesScore(timeline, id) { report.scoring["\(why) (inserted)", default: 0] += 1 }
                }
                if timeline.heldScore != nil, timeline.heldSince == t { report.holds += 1 }
                let p = engine.p(at: t)
                for id in change.added {
                    guard let r = timeline.record(id), !r.backfill, r.entry.kind.phase == .live, let w = r.entry.wallclock else { continue }
                    if r.afterOutage {
                        report.afterOutage += 1
                        continue
                    }
                    report.lags[r.trusted ? r.entry.kind.label : "\(r.entry.kind.label) (\(r.timeSource))", default: []].append(r.firstSeen - w)
                    if let newest = newestLiveBefore { report.insertion.append(max(newest - r.eventTime, 0)) }
                    // Where p was when it arrived, against its binding horizon and its moment.
                    let horizon = timeline.horizons.horizon(for: r.entry.kind)
                    let behindTold = change.lateInsertions.contains(id)
                    let binding: Binding = behindTold || p > r.presentAt + 30 ? .correction
                        : p <= r.presentAt - horizon + 1e-6 ? .beforeBind : p <= r.presentAt + 1e-6 ? .compressed
                        : p <= r.presentAt + 1.5 ? .microCatchUp : .beyond
                    report.binding[r.entry.kind.label, default: [:]][binding, default: 0] += 1
                }
                newestLiveBefore = timeline.newestLive
            }
            if let k = step.knowledge { report.bounds[k.bound, default: 0] += 1 }
            for event in step.events {
                switch event {
                case .stall(let at, _): stallSince = at
                case .resume(let at, let held) where ours(at - held):
                    report.outageStalls += 1
                    stallSince = nil
                case .resume(let at, let held):
                    report.stalls.append(held)
                    if stallSince == nil { stallSince = at - held }
                    stallSince = nil
                    if held >= 30 { recovering = (at, engine.clock.delay(at: at) - engine.clock.target) }
                case let .skip(_, from, to): report.skips.append(to - from)
                case let .jump(at, from, to) where ours(at):
                    report.outageJumps.append(to - from)
                case let .jump(_, from, to):
                    report.jumps += 1
                    report.jumpLengths.append(to - from)
                case .wake: report.wakes += 1
                case .start: break
                }
            }
            if step.correction != nil { report.safetyNet += 1 }
            if let r = recovering, engine.clock.delay(at: t) <= engine.clock.target + 5 {
                report.recoveries.append((r.deficit, t - r.since))
                recovering = nil
            }
            let jumped = step.events.contains { if case .jump = $0 { true } else { false } }
            for record in step.told {
                if let why = record.told {
                    let how = why == .history && jumped ? "history (jump)" : "\(why)"
                    if record.entry.kind.announced { report.reviews[how, default: 0] += 1 }
                    if changesScore(timeline, record.id) { report.scoring[how, default: 0] += 1 }
                }
                report.told += 1
                let label = record.entry.kind.label
                switch record.told {
                case .history?:
                    report.history += 1
                    continue
                case .late?:
                    report.late[label, default: 0] += 1
                case .correction?:
                    report.late["\(label) (correction)", default: 0] += 1
                default: break
                }
                if record.entry.kind.phase == .live, !record.backfill {
                    var cell = report.knownBeforeLeadIn[label] ?? (0, 0)
                    cell.total += 1
                    if record.firstSeen <= t - timeline.horizons.horizon(for: record.entry.kind) + 1e-6 { cell.known += 1 }
                    report.knownBeforeLeadIn[label] = cell
                }
                if let score = record.entry.score, score != lastScore {
                    // A new score (not a reversal): against the scoreboard, today's page and the real moment.
                    if let last = lastScore, score.home + score.away > last.home + last.away, let board = boardFirst[score], !ours(t) {
                        report.added.append(t - board)
                        // Today's app: the scoreboard at its next 30-s poll, or the play's own lane, whichever came first.
                        let appBoard = start + ((board - start) / policy.scoreboardPoll).rounded(.up) * policy.scoreboardPoll
                        let page = laneScore ? min(appBoard, record.firstSeen) : appBoard
                        report.addedApp.append(t - page)
                        if record.timeSource == .wallclock || record.timeSource == .statsapi {
                            report.behindReal.broadcast.append(t - record.eventTime)
                            report.behindReal.page.append(page - record.eventTime)
                            report.behindReal.board.append(board - record.eventTime)
                            report.behindReal.lane.append(record.firstSeen - record.eventTime)
                        }
                    }
                    lastScore = score
                }
            }
            while nextSample <= t {
                if !ours(nextSample) { report.delays.append((nextSample, engine.clock.delay(at: nextSample), engine.clock.target)) }
                nextSample += 60
            }
            report.fastLag = timeline.fast.lag
            if trace {
                let p = engine.p(at: t)
                let k = step.knowledge
                var line = String(format: "%7.1f p=%+.1f D=%.1f T=%.1f cap=%+.1f %@ %@", t - start, p - start, t - p, engine.clock.target,
                                  (k?.frontier ?? 0) - timeline.horizons.live - start, "\(k?.bound ?? .empty)", "\(engine.clock.regime)")
                if let change, !change.isEmpty { line += " +\(change.added.count) ~\(change.revised.count) -\(change.removed.count)" }
                for e in step.events { line += " [" + describe(e, start: start) + "]" }
                for r in step.told where r.told != .history {
                    line += String(format: " told(%@ %@ @%+.1f %@)", r.entry.kind.label, "\(r.told!)", r.presentAt - start,
                                   r.entry.score.map { "\($0)" } ?? "")
                }
                print(line)
            }
        }
        if let since = stallSince { report.stalls.append(replay.now - since) }
        let final = replay.engine.timeline
        report.safetyNet = final.safetyNetApplied
        report.terms = (final.lagQuantile, final.horizons.live, policy.margin, min(final.lags.count, policy.lagWindow), policy.quantile)
        return report
    }

    /// The trade curve: q × binding horizon, per sport over its recorded games.
    static func trade(_ games: [(String, String)], root: URL, recorder: Bool) -> Int32 {
        let quantiles = [0.80, 0.85, 0.90, 0.95], horizons = [2.0, 3.0, 4.0, 6.0]
        let bySport = Dictionary(grouping: games, by: \.0)
        for (sport, list) in bySport.sorted(by: { $0.key < $1.key }) {
            let recordings = list.map { Recording.load(root: root, sport: $0.0, event: $0.1) }.filter { $0.snapshots.count + $0.core.count >= 3 }
            guard let first = recordings.first, let kind = first.sport else { continue }
            let base = overridden(BroadcastLanes.policy(kind, path: first.path))
            // A sport with flow kinds (soccer): D sized on every live-ball kind (a), then on the decisive ones (b).
            for sizing in base.decisive == nil ? [base.sizeOnDecisive] : [false, true] {
                let how = base.decisive == nil ? "" : sizing ? " — (b) D sized on decisive kinds only" : " — (a) D sized on every live-ball kind"
                print("\n== \(sport): \(recordings.count) games, the app's cadence; margin \(base.margin) s\(how)")
                let over = base.decisive == nil ? "" : " (decisive kinds)"
                print("   q   horizon |  D p50  D p90 | added vs page p50  p90 | behind real p50 | after bind  micro≤1.5s  beyond  corrections\(over)"
                    + (base.decisive == nil ? "" : " | flow late") + " | stalls/h")
                for q in quantiles {
                    for h in horizons {
                        var policy = base
                        policy.sizeOnDecisive = sizing
                        policy.quantile = q
                        policy.horizons = BindingHorizons(live: h)
                        let reports = recordings.compactMap { run($0, recorder: recorder, policy: policy) }
                        let r = combined(reports, label: sport)
                        let actual = r.delays.map(\.actual).filter(\.isFinite)
                        let split = bindingSplit(r)
                        let bound = split[0].1
                        let all = Double(max(bound.reduce(0, +), 1))
                        func pct(_ v: [Double], _ p: Double) -> Double { v.isEmpty ? .nan : Stats.quantile(v, p) }
                        var line = String(format: "  %.2f  %4.1f s  | %6.1f %6.1f | %13.1f %5.1f | %15.1f | %8.1f%% %9.1f%% %6.1f%% %10.1f%%",
                                          q, h, pct(actual, 0.5), pct(actual, 0.9), pct(r.addedApp, 0.5), pct(r.addedApp, 0.9),
                                          pct(r.behindReal.broadcast, 0.5),
                                          Double(bound[1] + bound[2] + bound[3]) / all * 100, Double(bound[2]) / all * 100, Double(bound[3]) / all * 100,
                                          Double(bound[4]) / all * 100)
                        if split.count > 1 {
                            let flow = split[1].1
                            line += String(format: " | %8.1f%%", Double(flow[3] + flow[4]) / Double(max(flow.reduce(0, +), 1)) * 100)
                        }
                        line += String(format: " | %6.1f", r.minutes > 0 ? Double(r.stalls.count) / (r.minutes / 60) : 0)
                        print(line)
                    }
                }
            }
        }
        return 0
    }

    static func describe(_ event: PresentationClock.Event, start: PTime) -> String {
        func f(_ x: PTime) -> String { String(format: "%+.1f", x - start) }
        switch event {
        case let .start(_, p): return "start p=\(f(p))"
        case let .wake(_, from, to): return "wake \(f(from))→\(f(to))"
        case let .jump(_, from, to): return "jump \(f(from))→\(f(to))"
        case let .skip(_, from, to): return "skip \(f(from))→\(f(to))"
        case let .stall(_, p): return "stall at p=\(f(p))"
        case let .resume(_, held): return String(format: "resume after %.1f s", held)
        }
    }

    static func combined(_ reports: [Report], label: String) -> Report {
        var r = Report()
        r.label = label
        for x in reports {
            r.snapshots += x.snapshots
            r.minutes += x.minutes
            r.delays += x.delays
            for (k, v) in x.lags { r.lags[k, default: []] += v }
            r.insertion += x.insertion
            r.added += x.added
            r.addedApp += x.addedApp
            for (k, v) in x.binding { r.binding[k, default: [:]].merge(v, uniquingKeysWith: +) }
            r.terms = x.terms
            for (k, v) in x.knownBeforeLeadIn {
                var cell = r.knownBeforeLeadIn[k] ?? (0, 0)
                cell.known += v.known
                cell.total += v.total
                r.knownBeforeLeadIn[k] = cell
            }
            for (k, v) in x.late { r.late[k, default: 0] += v }
            r.corrected += x.corrected
            r.removedTold += x.removedTold
            r.revisions += x.revisions
            r.removals += x.removals
            r.stalls += x.stalls
            r.skips += x.skips
            r.jumps += x.jumps
            r.wakes += x.wakes
            r.safetyNet += x.safetyNet
            for (k, v) in x.bounds { r.bounds[k, default: 0] += v }
            r.told += x.told
            r.history += x.history
            r.stepTime += x.stepTime
            r.decisive = x.decisive
            r.behindReal.broadcast += x.behindReal.broadcast
            r.behindReal.page += x.behindReal.page
            r.behindReal.board += x.behindReal.board
            r.behindReal.lane += x.behindReal.lane
            for (k, v) in x.reviews { r.reviews[k, default: 0] += v }
            r.holds += x.holds
            for (k, v) in x.scoring { r.scoring[k, default: 0] += v }
            r.jumpLengths += x.jumpLengths
            r.holes += x.holes
            r.holeMinutes += x.holeMinutes
            r.afterOutage += x.afterOutage
            r.outageJumps += x.outageJumps
            r.outageStalls += x.outageStalls
            r.recoveries += x.recoveries
        }
        return r
    }

    static func summary(_ values: [Double]) -> String {
        guard !values.isEmpty else { return "none" }
        func q(_ p: Double) -> String { String(format: "%.1f", Stats.quantile(values, p)) }
        return "n=\(values.count) p50=\(q(0.5)) p90=\(q(0.9)) p95=\(q(0.95)) max=\(String(format: "%.1f", values.max() ?? 0))"
    }

    /// Whether a play raises the score over the play before it (a goal, a basket, a run).
    static func changesScore<P>(_ timeline: GameTimeline<P>, _ id: String) -> Bool {
        guard let k = timeline.records.firstIndex(where: { $0.id == id }), let score = timeline.records[k].entry.score else { return false }
        guard let before = timeline.records[..<k].last(where: { $0.entry.score != nil })?.entry.score else { return false }
        return score.home + score.away > before.home + before.away
    }

    /// Binding counts (Binding.allCases order): every live-ball kind, or decisive and flow apart.
    static func bindingSplit(_ r: Report) -> [(String, [Int])] {
        func counts(_ keep: (String) -> Bool) -> [Int] {
            Binding.allCases.map { b in r.binding.filter { keep($0.key) }.values.reduce(0) { $0 + ($1[b] ?? 0) } }
        }
        guard let decisive = r.decisive else { return [("live-ball plays", counts { _ in true })] }
        return [("decisive plays (\(decisive.sorted().joined(separator: ", ")))", counts(decisive.contains)),
                ("flow (the rest live-ball)", counts { !decisive.contains($0) })]
    }

    static func render(_ r: Report) -> String {
        var lines = ["", "== \(r.label): \(r.snapshots) looks over \(Int(r.minutes.rounded())) min" + (r.lanes.isEmpty ? "" : " (\(r.lanes))")]
        let actual = r.delays.map(\.actual).filter(\.isFinite), target = r.delays.map(\.target)
        lines.append("  D actual: \(summary(actual))")
        lines.append("  D target: \(summary(target))")
        lines.append(String(format: "  D's terms (at the end): live-ball lag q%.0f %.1f s (window of %d plays) + binding horizon %.1f s + margin %.1f s = %.1f s",
                            r.terms.quantile * 100, r.terms.lag, r.terms.samples, r.terms.horizon, r.terms.margin,
                            r.terms.lag + r.terms.horizon + r.terms.margin))
        if !r.delays.isEmpty {
            let start = r.delays[0].t
            let samples = stride(from: 0, to: r.delays.count, by: max(r.delays.count / 12, 1)).map { r.delays[$0] }
            lines.append("  D over the game (min: actual/target): "
                + samples.map { String(format: "%d:%.0f/%.0f", Int(($0.t - start) / 60), $0.actual, $0.target) }.joined(separator: "  "))
        }
        let liveLags = r.lags.values.flatMap { $0 }
        let trustedLags = r.lags.filter { !$0.key.contains("(") }.values.flatMap { $0 }
        lines.append("  live-ball lag (first seen − wallclock): \(summary(liveLags)); trusted event times only: \(summary(trustedLags))")
        for (label, values) in r.lags.sorted(by: { $0.key < $1.key }) { lines.append("    \(label): \(summary(values))") }
        lines.append("  late insertion behind the newest live play: \(summary(r.insertion))")
        lines.append("  added delay vs the scoreboard (recorded, ~10 s polls): \(summary(r.added))")
        lines.append("  added delay vs today's page (scoreboard every 30 s, or the play's lane): \(summary(r.addedApp))")
        let real = r.behindReal
        if !real.broadcast.isEmpty {
            func p50(_ v: [Double]) -> String { String(format: "%.0f", Stats.quantile(v, 0.5)) }
            lines.append("  each new score behind its real moment (p50, s; n=\(real.broadcast.count)): the broadcast \(p50(real.broadcast)), "
                + "today's page \(p50(real.page)), the scoreboard \(p50(real.board)), the slow lane's first sight \(p50(real.lane))")
            lines.append("    the broadcast: \(summary(real.broadcast)); today's page: \(summary(real.page)); the scoreboard: \(summary(real.board)); slow lane: \(summary(real.lane))")
        }
        if r.holes > 0 {
            lines.append(String(format: "  the recorder's holes: %d, %.0f min in all (nothing read in them); live-ball plays landing after one, left out of lag and binding: %d",
                                r.holes, r.holeMinutes, r.afterOutage))
            lines.append("    inside them and 300 s after (left out of D, stalls, jumps and score delays): "
                + "jumps " + (r.outageJumps.isEmpty ? "none" : r.outageJumps.map { String(format: "%.0f s", $0) }.joined(separator: ", "))
                + ", stalls \(r.outageStalls)")
        }
        if !r.scoring.isEmpty {
            lines.append("  scoring plays told: " + r.scoring.sorted { $0.key < $1.key }.map { "\($0.key) \($0.value)" }.joined(separator: ", "))
        }
        if !r.jumpLengths.isEmpty || !r.recoveries.isEmpty {
            lines.append("  jumps (p moved, s): " + r.jumpLengths.map { String(format: "%.0f", $0) }.joined(separator: ", ")
                + "; long stalls' recovery (deficit at resume → back within 5 s of target): "
                + r.recoveries.map { String(format: "%.0f s → %.0f s", $0.deficit, $0.took) }.joined(separator: ", "))
        }
        if !r.reviews.isEmpty || r.holds > 0 {
            lines.append("  announced (VAR decisions) told: " + r.reviews.sorted { $0.key < $1.key }.map { "\($0.key) \($0.value)" }.joined(separator: ", ")
                + "; told scores held for a reversal: \(r.holds)")
        }
        let known = r.knownBeforeLeadIn.values.reduce((0, 0)) { ($0.0 + $1.known, $0.1 + $1.total) }
        let share = known.1 > 0 ? Double(known.0) / Double(known.1) * 100 : 0
        lines.append(String(format: "  live-ball plays known before their lead-in: %d/%d (%.1f%%)", known.0, known.1, share)
            + "  " + r.knownBeforeLeadIn.sorted { $0.key < $1.key }.map { "\($0.key) \($0.value.known)/\($0.value.total)" }.joined(separator: ", "))
        for (name, bound) in bindingSplit(r) {
            let all = max(bound.reduce(0, +), 1)
            lines.append(String(format: "  %@ vs their binding horizon (n=%d): known before %.1f%%, lead-in compressed %.1f%%, micro catch-up ≤1.5 s %.1f%%, beyond %.1f%%, corrections %.1f%%",
                                name, bound.reduce(0, +), Double(bound[0]) / Double(all) * 100, Double(bound[1]) / Double(all) * 100,
                                Double(bound[2]) / Double(all) * 100, Double(bound[3]) / Double(all) * 100, Double(bound[4]) / Double(all) * 100))
        }
        lines.append("  told: \(r.told) (\(r.history) as history); late: "
            + (r.late.isEmpty ? "none" : r.late.sorted { $0.key < $1.key }.map { "\($0.key) \($0.value)" }.joined(separator: ", ")))
        lines.append("  revisions: \(r.revisions) (\(r.corrected) after told), removals: \(r.removals) (\(r.removedTold) after told)")
        lines.append(String(format: "  stalls per hour: %.1f", r.minutes > 0 ? Double(r.stalls.count) / (r.minutes / 60) : 0))
        lines.append("  stalls: \(r.stalls.count) (\(summary(r.stalls))); skips: \(r.skips.count) (total \(String(format: "%.0f", r.skips.reduce(0, +))) s); jumps: \(r.jumps); wakes: \(r.wakes)")
        lines.append("  safety net applied: \(r.safetyNet)" + (r.fastLag.map { String(format: "; fast-lane lag %.1f s", $0) } ?? ""))
        if !r.stepTime.isEmpty {
            lines.append(String(format: "  engine per step (ingest + advance, unoptimized test build): p50 %.2f ms, p99 %.2f ms over %d steps",
                                Stats.quantile(r.stepTime, 0.5), Stats.quantile(r.stepTime, 0.99), r.stepTime.count))
        }
        lines.append("  watermark bound (per step): " + r.bounds.sorted { "\($0.key)" < "\($1.key)" }.map { "\($0.key) \($0.value)" }.joined(separator: ", "))
        return lines.joined(separator: "\n")
    }
}
