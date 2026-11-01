#if DEBUG || BENCH
import Foundation

// The game as one broadcast, part 6: the recording loader and replay (the bench's front end).
//
// Reads what the feed recorder saved (`~/Developer/scoreline-recordings`):
// - `<sport>/<event>/<arrival-ms>.json.gz`: each changed summary, as it arrived;
// - `<sport>/scores.jsonl`: the scoreboard's score and clock per event, each change;
// - `<sport>/<event>/status.jsonl`: the core status the app polls every 5 s,
//   each change (`{at, clock, displayClock, period, state, detail}`), since
//   2026-10-31 01:50 PT; without it, the status comes from the scoreboard's rows;
// - soccer: `<sport>/<event>/core/<arrival-ms>.json.gz` (`{count, offset,
//   items}`: the newest one or two pages of core plays, each change), soccer's
//   real slow lane (the app's theater and timeline read the core plays).
// The recorder is still writing there, so it's read only: files changed in
// the last few seconds are skipped, and a half-written last line of a
// `.jsonl` is ignored.
//
// `RecordingReplay` feeds a recording through the real lanes (`BroadcastLanes`)
// into a `BroadcastEngine` on a virtual clock: the slow lane polled at the
// app's cadence (or the recorder's), each poll delivering the newest snapshot
// that had arrived by then; the scoreboard and the status at theirs; and the
// engine's own wakes in between. Event-driven, so a game replays in a second
// or two, and deterministic. The bench (Tests/BroadcastBench.swift), the unit
// tests (Tests/Fixtures/broadcast) and the offscreen page check all drive it.

enum Gzip {
    /// A gzip member's contents (RFC 1952: header, raw DEFLATE, trailer).
    static func decompress(_ data: Data) -> Data? {
        let bytes = [UInt8](data)
        guard bytes.count > 18, bytes[0] == 0x1f, bytes[1] == 0x8b, bytes[2] == 8 else { return nil }
        let flags = bytes[3]
        var i = 10
        if flags & 4 != 0, i + 2 <= bytes.count { i += 2 + (Int(bytes[i]) | Int(bytes[i + 1]) << 8) }
        if flags & 8 != 0 { while i < bytes.count, bytes[i] != 0 { i += 1 }; i += 1 }
        if flags & 16 != 0 { while i < bytes.count, bytes[i] != 0 { i += 1 }; i += 1 }
        if flags & 2 != 0 { i += 2 }
        guard i < bytes.count - 8 else { return nil }
        let body = Data(bytes[i..<(bytes.count - 8)])
        return try? (body as NSData).decompressed(using: .zlib) as Data
    }
}

/// One recorded game.
struct Recording: Sendable {
    struct Snapshot: Sendable, Equatable {
        let arrived: PTime
        let url: URL
    }

    /// The sport's directory ("basketball_nba") and the event ID.
    let sportDirectory: String
    let event: String
    let snapshots: [Snapshot]
    /// This event's scoreboard rows, oldest first.
    let rows: [RawPlay]
    /// The core status as the app polls it, each change, oldest first (empty: not recorded).
    var status: [RawPlay] = []
    /// Soccer's core plays, each changed look (empty: not recorded).
    var core: [Snapshot] = []
    /// The recorder's own failed fetches (`gaps.jsonl`, the event's and the sport's
    /// scoreboard's; since 2026-10-31 12:22 PT): when and which lane ("summary",
    /// "status", "core", "scoreboard"). Our holes, not the feed's.
    var gaps: [(at: PTime, what: String)] = []
    /// Whether the recorder logged its failed fetches while this game was recorded
    /// (the event has a gaps.jsonl, or the sport's began before the game): then its
    /// holes are explicit, and a silence in every lane is the feed's, not ours.
    var gapLogged = false

    /// The first and last arrivals of anything recorded.
    var span: ClosedRange<PTime>? {
        let times = (snapshots + core).map(\.arrived)
        guard let first = times.min(), let last = times.max() else { return nil }
        return first...last
    }

    static let defaultRoot = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Developer/scoreline-recordings")

    /// "basketball_nba" → "basketball/nba".
    var path: String { sportDirectory.replacingOccurrences(of: "_", with: "/") }

    var sport: BroadcastSport? {
        switch sportDirectory.split(separator: "_").first {
        case "basketball"?: .basketball
        case "football"?: .football
        case "soccer"?: .soccer
        case "baseball"?: .baseball
        default: nil
        }
    }

    /// The events recorded for a sport (directories with snapshots).
    static func events(root: URL = defaultRoot, sport: String) -> [String] {
        let dir = root.appendingPathComponent(sport)
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        return names.filter { name in
            var isDirectory: ObjCBool = false
            return FileManager.default.fileExists(atPath: dir.appendingPathComponent(name).path, isDirectory: &isDirectory) && isDirectory.boolValue
        }.sorted()
    }

    /// The sports recorded.
    static func sports(root: URL = defaultRoot) -> [String] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []
        return names.filter { !events(root: root, sport: $0).isEmpty }.sorted()
    }

    /// A recorded game, read only. Files modified in the last `settle` seconds
    /// (the recorder may still be writing them) are left out.
    static func load(root: URL = defaultRoot, sport: String, event: String, settle: TimeInterval = 10, now: Date = Date()) -> Recording {
        let dir = root.appendingPathComponent(sport).appendingPathComponent(event)
        var recording = Recording(sportDirectory: sport, event: event, snapshots: gzips(in: dir, settle: settle, now: now),
                                  rows: scoreRows(root.appendingPathComponent(sport).appendingPathComponent("scores.jsonl"), event: event))
        recording.status = lines(dir.appendingPathComponent("status.jsonl"))
        recording.core = gzips(in: dir.appendingPathComponent("core"), settle: settle, now: now)
        let eventGaps = dir.appendingPathComponent("gaps.jsonl")
        let sportGaps = lines(root.appendingPathComponent(sport).appendingPathComponent("gaps.jsonl"))
            .compactMap { row in row.json["at"].double.map { ($0, row.json["what"].string ?? "") } }
        let mine = lines(eventGaps).compactMap { row in row.json["at"].double.map { ($0, row.json["what"].string ?? "") } }
        if let span = recording.span {
            // Only the failures while this game was recorded.
            recording.gaps = (mine + sportGaps).filter { span.contains($0.0) }.sorted { $0.0 < $1.0 }
            recording.gapLogged = FileManager.default.fileExists(atPath: eventGaps.path)
                || (sportGaps.map(\.0).min().map { $0 <= span.lowerBound } ?? false)
        }
        return recording
    }

    /// `<arrival-ms>.json.gz` files in a directory, oldest first, settled ones only.
    static func gzips(in dir: URL, settle: TimeInterval, now: Date) -> [Snapshot] {
        let fm = FileManager.default
        var out: [Snapshot] = []
        for name in (try? fm.contentsOfDirectory(atPath: dir.path)) ?? [] where name.hasSuffix(".json.gz") {
            guard let ms = Double(name.dropLast(".json.gz".count)) else { continue }
            let url = dir.appendingPathComponent(name)
            if let modified = (try? fm.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date,
               now.timeIntervalSince(modified) < settle { continue }
            out.append(Snapshot(arrived: ms / 1000, url: url))
        }
        return out.sorted { $0.arrived < $1.arrived }
    }

    /// A `.jsonl` file's rows, oldest first; a half-written last line is ignored.
    static func lines(_ url: URL) -> [RawPlay] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        var rows: [RawPlay] = []
        for line in data.split(separator: UInt8(ascii: "\n")) where !line.isEmpty {
            let json = JSON(data: Data(line))
            guard json.raw != nil else { continue }
            rows.append(RawPlay(json: json, digest: rows.count))
        }
        return rows
    }

    /// A status row in the core status's own shape, for the app's reader (`BroadcastLanes.reading(status:)`).
    static func status(_ row: JSON) -> JSON {
        JSON(["clock": row["clock"].raw ?? NSNull(), "displayClock": row["displayClock"].raw ?? NSNull(),
              "period": row["period"].raw ?? NSNull(),
              "type": ["state": row["state"].raw ?? NSNull(), "shortDetail": row["detail"].raw ?? NSNull(),
                       "detail": row["detail"].raw ?? NSNull()]] as [String: Any])
    }

    /// The scoreboard rows for one event; a half-written last line is ignored.
    static func scoreRows(_ url: URL, event: String) -> [RawPlay] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        var rows: [RawPlay] = []
        for line in data.split(separator: UInt8(ascii: "\n")) where !line.isEmpty {
            let json = JSON(data: Data(line))
            guard json.raw != nil, json["event"].string == event else { continue }
            rows.append(RawPlay(json: json, digest: rows.count))
        }
        return rows
    }

    /// A stretch the recorder wasn't reading this game: `lanes` (nil: every lane).
    struct Hole: Equatable, Sendable {
        var range: ClosedRange<PTime>
        var lanes: Set<String>?
    }

    /// The recorder's holes, so a replay doesn't take them for the feed's lag.
    /// From `gaps.jsonl` when it was recorded: each failed fetch leaves its lane
    /// unread until the next try (~5 s; failures in a row chain). Before that,
    /// inferred: every lane silent for over 60 s while the game clock ran more
    /// than 20 s across it (plays went by unread; a break or a halftime moves
    /// it 0–7 s), from the status lane's clock, else the scoreboard's.
    func holes(policy: BroadcastPolicy) -> [Hole] {
        var out: [Hole] = []
        if !gaps.isEmpty {
            for lane in Set(gaps.map(\.what)) {
                var current: ClosedRange<PTime>?
                for g in gaps where g.what == lane {
                    let r = g.at - 0.1...g.at + 5
                    if let c = current, r.lowerBound <= c.upperBound + 1 {
                        current = c.lowerBound...max(c.upperBound, r.upperBound)
                    } else {
                        if let c = current { out.append(Hole(range: c, lanes: [lane])) }
                        current = r
                    }
                }
                if let c = current { out.append(Hole(range: c, lanes: [lane])) }
            }
        }
        if gapLogged { return out.sorted { $0.range.lowerBound < $1.range.lowerBound } }
        // Recorded before the recorder logged its failures: lane silence while the clock ran.
        var activity = (snapshots + core).map(\.arrived) + status.compactMap { $0.json["at"].double } + rows.compactMap { $0.json["at"].double }
        activity.sort()
        let clocks = clockReadings(policy: policy)
        func elapsed(atOrBefore t: PTime) -> Double? { clocks.last { $0.at <= t + 0.5 }?.elapsed }
        func elapsed(atOrAfter t: PTime) -> Double? { clocks.first { $0.at >= t - 0.5 }?.elapsed }
        for (a, b) in zip(activity, activity.dropFirst()) where b - a > 60 {
            guard let e0 = elapsed(atOrBefore: a), let e1 = elapsed(atOrAfter: b), e1 - e0 > 20 else { continue }
            out.append(Hole(range: a...b, lanes: nil))
        }
        return out.sorted { $0.range.lowerBound < $1.range.lowerBound }
    }

    /// The game clock as the recording saw it, as game time elapsed: the status lane's, else the scoreboard's.
    func clockReadings(policy: BroadcastPolicy) -> [(at: PTime, elapsed: Double)] {
        func total(period: Int, seconds: Double) -> Double {
            guard policy.clockCountsDown != false else { return seconds }
            let length = period > policy.regulationPeriods && policy.overtimeLength > 0 ? policy.overtimeLength : policy.periodLength
            let before = Double(min(period - 1, policy.regulationPeriods)) * policy.periodLength
                + Double(max(period - 1 - policy.regulationPeriods, 0)) * policy.overtimeLength
            return before + length - seconds
        }
        if !status.isEmpty {
            return status.compactMap { row in
                guard let at = row.json["at"].double, let period = row.json["period"].int, let clock = row.json["clock"].double else { return nil }
                return (at, total(period: period, seconds: clock))
            }
        }
        return rows.compactMap { row in
            guard let at = row.json["at"].double, let period = row.json["period"].int, let display = row.json["clock"].string else { return nil }
            if policy.clockCountsDown == false {
                // "68'", "45'+2'": minutes.
                let minutes = display.split(separator: "+").compactMap { Double($0.filter(\.isNumber)) }.reduce(0, +)
                return minutes > 0 ? (at, minutes * 60) : nil
            }
            guard let seconds = NBADetail.seconds(display) else { return nil }
            return (at, total(period: period, seconds: seconds))
        }
    }

    /// A recorded look at soccer's core plays: `{count, offset, items}`.
    func coreLook(_ snapshot: Snapshot) -> JSON? { summary(snapshot) }

    /// A snapshot's summary.
    func summary(_ snapshot: Snapshot) -> JSON? {
        guard let data = try? Data(contentsOf: snapshot.url), let raw = Gzip.decompress(data) else { return nil }
        let json = JSON(data: raw)
        return json.raw == nil ? nil : json
    }

    /// Which side the summary lists as home: (home team ID, away team ID).
    func teams() -> (home: String?, away: String?) {
        guard let first = snapshots.last, let summary = summary(first) else { return (nil, nil) }
        let competitors = summary["header"]["competitions"][0]["competitors"].array
        return (competitors.first { $0["homeAway"].string == "home" }?["team"]["id"].string,
                competitors.first { $0["homeAway"].string == "away" }?["team"]["id"].string)
    }
}

/// A recording fed through the real lanes into an engine on a virtual clock.
struct RecordingReplay {
    /// How often each lane is read, in seconds.
    struct Cadence: Equatable, Sendable {
        var slow: Double
        var scoreboard: Double
        var status: Double?

        /// The app's: the slow lane every few seconds (the sport's), the scoreboard every 30 s, the core status every 5 s.
        static func app(_ policy: BroadcastPolicy) -> Cadence {
            Cadence(slow: policy.slowPoll, scoreboard: policy.scoreboardPoll, status: policy.statusPoll)
        }

        /// The recorder's own: the summary every 3 s, the scoreboard every ~10 s.
        static let recorder = Cadence(slow: 3, scoreboard: 10, status: nil)
    }

    /// Something the replay does at a virtual time.
    enum Input: Sendable {
        case slow(Recording.Snapshot?)
        /// Soccer's core plays: the recorded look as of the poll.
        case core(Recording.Snapshot?)
        case scoreboard(RawPlay)
        /// The status from the scoreboard's rows (before `status.jsonl` was recorded).
        case status(RawPlay, running: Bool?)
        /// The recorded core status.
        case statusRow(RawPlay)
    }

    let recording: Recording
    let sport: BroadcastSport
    let policy: BroadcastPolicy
    /// The recorder's holes: nothing is read inside them (the app's own outage, not the feed's lag).
    let holes: [Recording.Hole]
    private(set) var engine: BroadcastEngine<RawPlay>
    private(set) var now: PTime = 0
    private var lastSnapshot: Recording.Snapshot?
    private var lastScoreboard: FastReading?
    private var lastStatus: FastReading?
    /// Each snapshot's parsed entries, by arrival (a game's 200 snapshots parse once).
    private var parsed: [PTime: [TimelineEntry<RawPlay>]] = [:]

    init?(_ recording: Recording, policy: BroadcastPolicy? = nil) {
        guard let sport = recording.sport else { return nil }
        self.recording = recording
        self.sport = sport
        self.policy = policy ?? BroadcastLanes.policy(sport, path: recording.path)
        holes = recording.holes(policy: self.policy)
        engine = BroadcastEngine(sport: sport, policy: self.policy)
    }

    /// The lane an input reads.
    static func lane(of input: Input) -> String {
        switch input {
        case .slow: "summary"
        case .core: "core"
        case .scoreboard, .status: "scoreboard"
        case .statusRow: "status"
        }
    }

    /// Whether a read at `t` falls in one of the recorder's holes for that lane.
    func inHole(_ input: Input, at t: PTime) -> Bool {
        let lane = Self.lane(of: input)
        return holes.contains { $0.range.contains(t) && ($0.lanes?.contains(lane) ?? true) }
    }

    /// The inputs at the cadence, in time order (ties: slow lane first).
    func schedule(_ cadence: Cadence, from start: PTime? = nil, through end: PTime? = nil) -> [(t: PTime, input: Input)] {
        guard let span = recording.span else { return [] }
        let begin = start ?? span.lowerBound
        // Past the last look the recording knows nothing: replaying on would only stall.
        let finish = end ?? (span.upperBound + cadence.slow)
        var out: [(t: PTime, input: Input)] = []
        // The slow lane: each poll gets the newest look that had arrived by then. Soccer's
        // is its core plays when they were recorded (its summary has only the key events).
        let soccerCore = sport == .soccer && !recording.core.isEmpty
        let looks = soccerCore ? recording.core : recording.snapshots
        var t = begin, s = 0
        while t <= finish, !looks.isEmpty {
            while s + 1 < looks.count, looks[s + 1].arrived <= t { s += 1 }
            let look = looks[s].arrived <= t ? looks[s] : nil
            out.append((t, soccerCore ? .core(look) : .slow(look)))
            t += cadence.slow
        }
        let rows = recording.rows
        func row(at t: PTime) -> (row: RawPlay, index: Int)? {
            var lo = 0, hi = rows.count
            while lo < hi {
                let mid = (lo + hi) / 2
                if (rows[mid].json["at"].double ?? 0) <= t { lo = mid + 1 } else { hi = mid }
            }
            return lo > 0 ? (rows[lo - 1], lo - 1) : nil
        }
        t = begin
        while t <= finish {
            if let r = row(at: t) { out.append((t, .scoreboard(r.row))) }
            t += cadence.scoreboard
        }
        if !recording.status.isEmpty {
            // The recorded core status, at the app's cadence (5 s; the recorder's own when it has none).
            let statuses = recording.status
            t = begin
            var k = -1
            while t <= finish {
                while k + 1 < statuses.count, (statuses[k + 1].json["at"].double ?? .infinity) <= t { k += 1 }
                if k >= 0 { out.append((t, .statusRow(statuses[k]))) }
                t += cadence.status ?? 5
            }
        } else if let status = cadence.status {
            // The status from the scoreboard's rows (before the recorder saved the core status):
            // running while the rows' clock keeps changing, stopped once they stop.
            t = begin
            while t <= finish {
                if let r = row(at: t) {
                    let at = r.row.json["at"].double ?? t
                    let previous = r.index > 0 ? rows[r.index - 1].json["clock"].string : nil
                    let moving = previous != nil && previous != r.row.json["clock"].string && t - at < 12
                    out.append((t, .status(r.row, running: moving)))
                }
                t += status
            }
        }
        return out.enumerated().filter { !inHole($0.element.input, at: $0.element.t) }.sorted { a, b in
            if a.element.t != b.element.t { return a.element.t < b.element.t }
            return a.offset < b.offset
        }.map(\.element)
    }

    /// The theater's binding horizons, as the page passes them to `Broadcast` (the theater bench drives the replay this way).
    mutating func setHorizons(_ horizons: BindingHorizons) { engine.setHorizons(horizons) }

    /// The theater's solved decisive moments, as the page passes them to `Broadcast`.
    mutating func setAnchors(_ anchors: [String: PTime], leadIns: [String: Double] = [:]) { engine.setAnchors(anchors, leadIns: leadIns) }

    /// Applies one input at its time (without advancing the clock).
    mutating func apply(_ input: Input, at t: PTime) -> TimelineChange? {
        now = t
        switch input {
        case let .slow(snapshot):
            guard let snapshot else { return nil }
            guard snapshot != lastSnapshot else {
                engine.noteRead(.summary, at: t)
                return nil
            }
            lastSnapshot = snapshot
            let entries: [TimelineEntry<RawPlay>]
            if let cached = parsed[snapshot.arrived] {
                entries = cached
            } else {
                guard let summary = recording.summary(snapshot) else { return nil }
                if let plays = BroadcastLanes.summaryPlays(summary, sport: sport) {
                    entries = BroadcastLanes.entries(plays, sport: sport, policy: policy)
                } else {
                    // Soccer's summary has no play list: its key events and commentary stand in.
                    entries = BroadcastLanes.entries(summary["keyEvents"].array, sport: sport, policy: policy)
                }
                parsed[snapshot.arrived] = entries
            }
            return engine.ingest(LaneSnapshot(lane: .summary, entries: entries, coverage: .full, arrived: t))
        case let .core(look):
            guard let look else { return nil }
            guard look != lastSnapshot else {
                engine.noteRead(.core, at: t)
                return nil
            }
            lastSnapshot = look
            let entries: [TimelineEntry<RawPlay>]
            if let cached = parsed[look.arrived] {
                entries = cached
            } else {
                guard let json = recording.coreLook(look) else { return nil }
                entries = BroadcastLanes.entries(json["items"].array, sport: sport, policy: policy)
                parsed[look.arrived] = entries
            }
            return engine.ingest(LaneSnapshot(lane: .core, entries: entries, coverage: .tail, arrived: t))
        case let .statusRow(row):
            if let reading = BroadcastLanes.reading(status: Recording.status(row.json), policy: policy, previous: lastStatus, at: t) {
                lastStatus = reading
                engine.observe(reading)
            }
            return nil
        case let .scoreboard(row):
            if let reading = BroadcastLanes.reading(row: row.json, policy: policy, previous: lastScoreboard, at: t) {
                lastScoreboard = reading
                engine.observe(reading)
            }
            return nil
        case let .status(row, running):
            if var reading = BroadcastLanes.reading(row: row.json, policy: policy, previous: lastStatus, at: t) {
                reading.score = nil
                reading.running = running
                reading.source = "status"
                lastStatus = reading
                engine.observe(reading)
            }
            return nil
        }
    }

    /// Runs the replay: every input at its time, the engine's wakes between,
    /// `step` after each advance (with the time and any ingest's change).
    mutating func run(_ cadence: Cadence, from start: PTime? = nil, through end: PTime? = nil,
                      step: (inout RecordingReplay, PTime, BroadcastEngine<RawPlay>.Step, TimelineChange?) -> Void) {
        let inputs = schedule(cadence, from: start, through: end)
        guard let finish = inputs.last?.t else { return }
        var i = 0
        var t = inputs.first?.t ?? 0
        while i < inputs.count || (engine.nextWake(after: t).map { $0 <= finish } ?? false) {
            let nextInput = i < inputs.count ? inputs[i].t : .infinity
            let wake = engine.nextWake(after: t) ?? .infinity
            let at = min(nextInput, wake)
            guard at.isFinite, at <= finish else { break }
            t = at
            var change: TimelineChange?
            while i < inputs.count, inputs[i].t <= t {
                if let c = apply(inputs[i].input, at: inputs[i].t) {
                    change = change.map { merged($0, c) } ?? c
                }
                i += 1
            }
            now = t
            let result = engine.advance(now: t)
            step(&self, t, result, change)
        }
    }

    private func merged(_ a: TimelineChange, _ b: TimelineChange) -> TimelineChange {
        TimelineChange(added: a.added + b.added, revised: a.revised + b.revised, removed: a.removed + b.removed,
                       correctedTold: a.correctedTold + b.correctedTold, removedTold: a.removedTold + b.removedTold,
                       lateInsertions: a.lateInsertions + b.lateInsertions)
    }
}
#endif
