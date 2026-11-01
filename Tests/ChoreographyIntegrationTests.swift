import Foundation

extension ScorelineTests {
    static func choreographyIntegration() {
        print("\nChoreography integration: incremental scenes")
        var longClock = PresentationClock()
        var delivered = 0
        for i in 0..<450 {
            let before = longClock.eventRevision
            longClock.update(now: Double(i) * 60, inputs: .init(target: 50, cap: .infinity))
            delivered += longClock.events(since: before).count
        }
        check(delivered == 450 && longClock.events.count == 400,
              "clock events keep reaching consumers after the bounded history fills (450 updates)")
        var timeline = GameTimeline<RawPlay>(policy: testPolicy)
        timeline.ingest(look([play("foul", at: 100, elapsed: 400, live: false, stops: true, score: ScoreLine(home: 0, away: 0)),
                              play("shot", at: 130, elapsed: 401, score: ScoreLine(home: 2, away: 0))], at: 140))
        timeline.tell(through: 100)
        let anchor = timeline.nextUntold?.presentAt ?? 130
        timeline.setAnchors(["shot": anchor], leadIns: ["shot": 8])
        check(timeline.quietSpan(from: 101, knowledge: 1000) == anchor - 8
              && timeline.quietSpan(from: anchor - 7, knowledge: 1000) == nil,
              "a catch-up stops before the actual eight-second approach and cannot skip once it starts")
        check(timeline.jumpLimit == anchor - 9, "a declared jump also preserves the actual approach")
        var interrupted = GameTimeline<RawPlay>(policy: testPolicy)
        interrupted.ingest(look([play("foul", at: 100, elapsed: 400, live: false, stops: true, score: ScoreLine(home: 0, away: 0)),
                                 play("admin", at: 125, elapsed: 400, live: false, stops: true),
                                 play("shot", at: 130, elapsed: 401, score: ScoreLine(home: 2, away: 0))], at: 140))
        interrupted.setAnchors(["foul": 100, "admin": 125, "shot": 130], leadIns: ["shot": 8])
        interrupted.tell(through: 100)
        check(interrupted.quietSpan(from: 121, knowledge: 1000) == 122
              && interrupted.quietSpan(from: 123, knowledge: 1000) == nil,
              "an intervening administrative entry cannot expose a later shot's approach to a skip")
        func entry(_ id: String, _ type: Int, _ text: String, shooting: Bool = false) -> TimelinePlay<RawPlay> {
            let json = JSON(["id": id, "type": ["id": type], "text": text, "shootingPlay": shooting,
                             "scoringPlay": false, "team": ["id": "1"], "period": ["number": 1],
                             "clock": ["displayValue": "10:00"], "coordinate": ["x": 25, "y": 20]] as [String: Any])
            return TimelinePlay(id: id, order: 0, eventTime: 100, eventBounds: nil, timeSource: .wallclock,
                                presentAt: 100, period: 1, clock: .none, kind: PlayKind(.live, "shot"), score: nil,
                                revision: 0, estimated: false, firstSeen: 101, play: RawPlay(json: json, digest: id.hashValue))
        }
        func snapshot(_ plays: [TimelinePlay<RawPlay>], pending: [TimelinePlay<RawPlay>] = []) -> TimelineSnapshot<RawPlay> {
            TimelineSnapshot(plays: plays, watermark: 200, revision: 1, told: [], pending: pending)
        }
        let facts = HoopsFacts(topID: "1", bottomID: "2")
        var cache = SceneCache<HoopsSport>()
        let miss = entry("miss", 92, "A Player misses jumper", shooting: true)
        let admin = (0..<40).map { entry("sub-\($0)", 584, "A Player enters the game for B Player") }
        let board = entry("board", 155, "A Player defensive rebound")
        let before = snapshot([miss] + admin)
        _ = cache.read(before, facts: facts)
        let after = snapshot([miss] + admin + [board])
        let cached = cache.read(after, facts: facts), fresh = HoopsSport.plays(after, facts: facts)
        check(cached == fresh && cached.first?.play.rebound?.id == "board",
              "a rebound beyond forty substitutions invalidates the earlier miss")
        _ = cache.read(after, facts: facts)
        check(cache.parsed == 0, "an unchanged scene input parses no plays on a horizon refresh")
        var flipped = facts
        flipped.topID = "2"
        flipped.bottomID = "1"
        check(cache.read(after, facts: flipped) == HoopsSport.plays(after, facts: flipped) && cache.parsed == after.plays.count,
              "changed team facts invalidate every cached scene")
        check(cache.read(before, facts: facts) == HoopsSport.plays(before, facts: facts),
              "removing the distant rebound also invalidates the earlier miss")
        let empty = snapshot([])
        check(cache.read(empty, facts: facts).isEmpty && cache.read(after, facts: facts) == fresh,
              "empty and repopulated snapshots retain no stale scenes")

        // Exercise each real adapter against full fresh parsing, including removal, insertion and pending promotion.
        func recorded<B: BenchSport>(_ sport: B.Type, name: String) {
            let recordings = TheaterBench.recordings(name)
            guard let recording = recordings.first?.0, var replay = RecordingReplay(recording) else {
                return check(false, "\(name) has a recorded cache regression fixture")
            }
            let summary = recording.snapshots.last.flatMap(recording.summary) ?? JSON([String: Any]())
            let facts = B.facts(summary, recording: recording)
            var cache = SceneCache<B.Sport>()
            var matched = true, samples = 0, lastCount = -1, populated = false
            var last: TimelineSnapshot<RawPlay>?
            replay.run(.app(replay.policy)) { replay, now, _, _ in
                let current = replay.engine.snapshot(at: now)
                let count = current.plays.count + current.pending.count
                guard count >= lastCount + 25 else { last = current; return }
                lastCount = count
                matched = matched && cache.read(current, facts: facts) == B.Sport.plays(current, facts: facts)
                samples += 1
                last = current
            }
            if let last {
                let all = last.plays + last.pending
                populated = !all.isEmpty
                let cut = all.count / 2
                let variants = [snapshot(Array(all.prefix(cut)), pending: Array(all.suffix(from: cut))),
                                snapshot(all), snapshot(Array(all.enumerated().filter { $0.offset != cut }.map(\.element))),
                                snapshot(all), snapshot(Array(all.prefix(cut))), snapshot([]), snapshot(all)]
                for current in variants {
                    matched = matched && cache.read(current, facts: facts) == B.Sport.plays(current, facts: facts)
                    samples += 1
                }
            }
            check(matched && populated && samples >= 7, "\(name): cached and fresh scenes agree through feed changes (\(samples) snapshots)")
        }
        recorded(HoopsBench.self, name: "basketball")
        recorded(GridBench.self, name: "football")
        recorded(PitchBench.self, name: "soccer")
        recorded(DiamondBench.self, name: "baseball")
    }
}
