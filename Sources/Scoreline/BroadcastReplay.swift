#if DEBUG || BENCH
import Foundation

// The game as one broadcast, part 6: the recording loader and replay (the bench's front end).
//
// Reads what the feed recorder saved (`~/Developer/scoreline-recordings`):
// `<sport>/<event>/<arrival-ms>.json.gz` (each changed summary, as it arrived)
// and `<sport>/scores.jsonl` (the scoreboard's score and clock per event, each
// change). The recorder is still writing there, so it's read only: files
// changed in the last few seconds are skipped, and a half-written last line of
// `scores.jsonl` is ignored.
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
        let fm = FileManager.default
        let dir = root.appendingPathComponent(sport).appendingPathComponent(event)
        let names = (try? fm.contentsOfDirectory(atPath: dir.path)) ?? []
        var snapshots: [Snapshot] = []
        for name in names where name.hasSuffix(".json.gz") {
            guard let ms = Double(name.dropLast(".json.gz".count)) else { continue }
            let url = dir.appendingPathComponent(name)
            if let modified = (try? fm.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date,
               now.timeIntervalSince(modified) < settle { continue }
            snapshots.append(Snapshot(arrived: ms / 1000, url: url))
        }
        snapshots.sort { $0.arrived < $1.arrived }
        return Recording(sportDirectory: sport, event: event, snapshots: snapshots,
                         rows: scoreRows(root.appendingPathComponent(sport).appendingPathComponent("scores.jsonl"), event: event))
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
        case scoreboard(RawPlay)
        case status(RawPlay, running: Bool?)
    }

    let recording: Recording
    let sport: BroadcastSport
    let policy: BroadcastPolicy
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
        engine = BroadcastEngine(sport: sport, policy: self.policy)
    }

    /// The inputs at the cadence, in time order (ties: slow lane first).
    func schedule(_ cadence: Cadence, from start: PTime? = nil, through end: PTime? = nil) -> [(t: PTime, input: Input)] {
        guard let first = recording.snapshots.first, let last = recording.snapshots.last else { return [] }
        let begin = start ?? first.arrived
        // Past the last snapshot the recording knows nothing: replaying on would only stall.
        let finish = end ?? (last.arrived + cadence.slow)
        var out: [(t: PTime, input: Input)] = []
        // The slow lane: each poll gets the newest snapshot that had arrived by then.
        var t = begin, s = 0
        while t <= finish {
            while s + 1 < recording.snapshots.count, recording.snapshots[s + 1].arrived <= t { s += 1 }
            out.append((t, .slow(recording.snapshots[s].arrived <= t ? recording.snapshots[s] : nil)))
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
        if let status = cadence.status {
            // The status from the scoreboard's rows (the recorder didn't save the core status):
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
        return out.enumerated().sorted { a, b in
            if a.element.t != b.element.t { return a.element.t < b.element.t }
            return a.offset < b.offset
        }.map(\.element)
    }

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
