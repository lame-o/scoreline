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
//
// Per game it prints D over the game, the delay it adds to today's
// scoreboard, the share of live-ball plays known before their lead-in, late
// tellings, corrections after presentation, stalls, skips and jumps, and the
// safety net's applications.

enum BroadcastBench {
    struct Report {
        var label = ""
        var snapshots = 0
        var minutes = 0.0
        var delays: [(t: PTime, actual: Double, target: Double)] = []
        var lags: [String: [Double]] = [:]
        var insertion: [Double] = []
        /// Each scoring play told: wall time told, and when the scoreboard first had that score.
        var added: [Double] = []
        var addedApp: [Double] = []
        var knownBeforeLeadIn: [String: (known: Int, total: Int)] = [:]
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
    }

    static func main(_ arguments: [String]) -> Int32 {
        var root = Recording.defaultRoot
        var recorder = false
        var targets: [String] = []
        var trace = false
        var i = 0
        while i < arguments.count {
            switch arguments[i] {
            case "--root":
                i += 1
                if i < arguments.count { root = URL(fileURLWithPath: arguments[i]) }
            case "--recorder": recorder = true
            case "--trace": trace = true
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
        var all: [String: [Report]] = [:]
        for (sport, event) in games {
            let recording = Recording.load(root: root, sport: sport, event: event)
            guard recording.snapshots.count >= 3, let report = run(recording, recorder: recorder, trace: trace) else {
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

    /// One recorded game through the engine.
    static func run(_ recording: Recording, recorder: Bool, trace: Bool = false, policy: BroadcastPolicy? = nil) -> Report? {
        guard var replay = RecordingReplay(recording, policy: policy) else { return nil }
        let policy = replay.policy
        let cadence = recorder ? RecordingReplay.Cadence.recorder : .app(policy)
        var report = Report()
        report.label = "\(recording.sportDirectory) \(recording.event)"
        report.snapshots = recording.snapshots.count
        if let first = recording.snapshots.first, let last = recording.snapshots.last {
            report.minutes = (last.arrived - first.arrived) / 60
        }
        // The scoreboard's first sighting of each score, and when the app (polling it every 30 s) would have shown it.
        var boardFirst: [ScoreLine: PTime] = [:]
        for row in recording.rows {
            guard row.json["state"].string == "in", let home = row.json["score"]["home"].int, let away = row.json["score"]["away"].int,
                  let at = row.json["at"].double else { continue }
            let score = ScoreLine(home: home, away: away)
            if boardFirst[score] == nil { boardFirst[score] = at }
        }
        let start = recording.snapshots.first?.arrived ?? 0
        var nextSample = start
        var lastScore: ScoreLine?
        var newestLiveBefore: PTime?
        var stallSince: PTime?
        replay.run(cadence) { replay, t, step, change in
            let engine = replay.engine
            let timeline = engine.timeline
            if let change {
                report.revisions += change.revised.count
                report.removals += change.removed.count
                report.corrected += change.correctedTold.count
                report.removedTold += change.removedTold.count
                for id in change.added {
                    guard let r = timeline.record(id), !r.backfill, r.entry.kind.phase == .live, let w = r.entry.wallclock else { continue }
                    report.lags[r.entry.kind.label, default: []].append(r.firstSeen - w)
                    if let newest = newestLiveBefore { report.insertion.append(max(newest - r.eventTime, 0)) }
                }
                newestLiveBefore = timeline.newestLive
            }
            if let k = step.knowledge { report.bounds[k.bound, default: 0] += 1 }
            for event in step.events {
                switch event {
                case .stall(let at, _): stallSince = at
                case .resume(let at, let held):
                    report.stalls.append(held)
                    if stallSince == nil { stallSince = at - held }
                    stallSince = nil
                case let .skip(_, from, to): report.skips.append(to - from)
                case .jump: report.jumps += 1
                case .wake: report.wakes += 1
                case .start: break
                }
            }
            if step.correction != nil { report.safetyNet += 1 }
            for record in step.told {
                report.told += 1
                let label = record.entry.kind.label
                switch record.told {
                case .history?:
                    report.history += 1
                    continue
                case .late?:
                    report.late[label, default: 0] += 1
                default: break
                }
                if record.entry.kind.phase == .live, !record.backfill {
                    var cell = report.knownBeforeLeadIn[label] ?? (0, 0)
                    cell.total += 1
                    if record.firstSeen <= t - policy.leadIn + 1e-6 { cell.known += 1 }
                    report.knownBeforeLeadIn[label] = cell
                }
                if let score = record.entry.score, score != lastScore {
                    if lastScore != nil, let board = boardFirst[score] {
                        report.added.append(t - board)
                        // Today's app: the scoreboard at its next 30-s poll, or the play's own lane, whichever came first.
                        let appBoard = start + ((board - start) / policy.scoreboardPoll).rounded(.up) * policy.scoreboardPoll
                        report.addedApp.append(t - min(appBoard, record.firstSeen))
                    }
                    lastScore = score
                }
            }
            while nextSample <= t {
                report.delays.append((nextSample, engine.clock.delay(at: nextSample), engine.clock.target))
                nextSample += 60
            }
            report.fastLag = timeline.fast.lag
            if trace {
                let p = engine.p(at: t)
                let k = step.knowledge
                var line = String(format: "%7.1f p=%+.1f D=%.1f T=%.1f cap=%+.1f %@ %@", t - start, p - start, t - p, engine.clock.target,
                                  (k?.frontier ?? 0) - policy.leadIn - start, "\(k?.bound ?? .empty)", "\(engine.clock.regime)")
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
        report.safetyNet = replay.engine.timeline.safetyNetApplied
        return report
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
        }
        return r
    }

    static func summary(_ values: [Double]) -> String {
        guard !values.isEmpty else { return "none" }
        func q(_ p: Double) -> String { String(format: "%.1f", Stats.quantile(values, p)) }
        return "n=\(values.count) p50=\(q(0.5)) p90=\(q(0.9)) p95=\(q(0.95)) max=\(String(format: "%.1f", values.max() ?? 0))"
    }

    static func render(_ r: Report) -> String {
        var lines = ["", "== \(r.label): \(r.snapshots) snapshots over \(Int(r.minutes.rounded())) min"]
        let actual = r.delays.map(\.actual).filter(\.isFinite), target = r.delays.map(\.target)
        lines.append("  D actual: \(summary(actual))")
        lines.append("  D target: \(summary(target))")
        if !r.delays.isEmpty {
            let start = r.delays[0].t
            let samples = stride(from: 0, to: r.delays.count, by: max(r.delays.count / 12, 1)).map { r.delays[$0] }
            lines.append("  D over the game (min: actual/target): "
                + samples.map { String(format: "%d:%.0f/%.0f", Int(($0.t - start) / 60), $0.actual, $0.target) }.joined(separator: "  "))
        }
        let liveLags = r.lags.values.flatMap { $0 }
        lines.append("  live-ball lag (first seen − wallclock): \(summary(liveLags))")
        for (label, values) in r.lags.sorted(by: { $0.key < $1.key }) { lines.append("    \(label): \(summary(values))") }
        lines.append("  late insertion behind the newest live play: \(summary(r.insertion))")
        lines.append("  added delay vs the scoreboard (recorded, ~10 s polls): \(summary(r.added))")
        lines.append("  added delay vs today's page (scoreboard every 30 s, or the play's lane): \(summary(r.addedApp))")
        let known = r.knownBeforeLeadIn.values.reduce((0, 0)) { ($0.0 + $1.known, $0.1 + $1.total) }
        let share = known.1 > 0 ? Double(known.0) / Double(known.1) * 100 : 0
        lines.append(String(format: "  live-ball plays known before their lead-in: %d/%d (%.1f%%)", known.0, known.1, share)
            + "  " + r.knownBeforeLeadIn.sorted { $0.key < $1.key }.map { "\($0.key) \($0.value.known)/\($0.value.total)" }.joined(separator: ", "))
        lines.append("  told: \(r.told) (\(r.history) as history); late: "
            + (r.late.isEmpty ? "none" : r.late.sorted { $0.key < $1.key }.map { "\($0.key) \($0.value)" }.joined(separator: ", ")))
        lines.append("  revisions: \(r.revisions) (\(r.corrected) after told), removals: \(r.removals) (\(r.removedTold) after told)")
        lines.append("  stalls: \(r.stalls.count) (\(summary(r.stalls))); skips: \(r.skips.count) (total \(String(format: "%.0f", r.skips.reduce(0, +))) s); jumps: \(r.jumps); wakes: \(r.wakes)")
        lines.append("  safety net applied: \(r.safetyNet)" + (r.fastLag.map { String(format: "; fast-lane lag %.1f s", $0) } ?? ""))
        lines.append("  watermark bound (per step): " + r.bounds.sorted { "\($0.key)" < "\($1.key)" }.map { "\($0.key) \($0.value)" }.joined(separator: ", "))
        return lines.joined(separator: "\n")
    }
}
