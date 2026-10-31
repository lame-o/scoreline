import Foundation

// The game as one broadcast (BROADCAST.md "How it's proven"): the timeline's
// ingest (duplicates, out-of-order arrival, revisions, removals, missing event
// times), the watermark, the presentation clock (slewing bounds, stall,
// catch-up, jump, skip), the presented state at chosen times, the lanes, and
// the recording loader and replay on a real NBA slice (Tests/Fixtures/broadcast).

extension ScorelineTests {
    static func broadcast() {
        print("\nBroadcast: timeline")
        broadcastIngest()
        broadcastEventTimes()
        print("\nBroadcast: watermark")
        broadcastWatermark()
        print("\nBroadcast: presentation clock")
        broadcastClock()
        print("\nBroadcast: presented state")
        broadcastPresented()
        print("\nBroadcast: lanes")
        broadcastLanes()
        print("\nBroadcast: recordings")
        broadcastRecording()
    }

    // MARK: Helpers

    static let testPolicy: BroadcastPolicy = {
        var p = BroadcastPolicy()
        p.priorLag = 30
        p.horizons = BindingHorizons(live: 2)
        p.margin = 1
        p.slowPoll = 5
        p.quietRunning = 60
        p.insertionAllowance = 4
        p.safetyGrace = 20
        p.lagTrust = 1
        p.periodLength = 720
        return p
    }()

    static func play(_ id: String, at w: PTime?, elapsed: Double? = nil, period: Int = 1, live: Bool = true, stops: Bool = false,
                     score: ScoreLine? = nil, text: String = "", version: Int = 0, label: String? = nil,
                     endsPeriod: Int? = nil) -> TimelineEntry<RawPlay> {
        var h = Hasher()
        h.combine(id)
        h.combine(text)
        h.combine(version)
        let digest = h.finalize()
        let kind = PlayKind(live ? .live : .dead, label ?? (live ? "shot" : "foul"), stopsClock: stops, endsPeriod: endsPeriod)
        return TimelineEntry(id: id, wallclock: w, period: period, progress: elapsed ?? 0,
                             clock: GameClockReading(elapsed: elapsed), kind: kind, score: score, text: text, digest: digest,
                             payload: RawPlay(json: JSON(nil), digest: digest))
    }

    static func look(_ entries: [TimelineEntry<RawPlay>], _ lane: LaneID = .summary, at t: PTime,
                     _ coverage: LaneSnapshot<RawPlay>.Coverage = .full) -> LaneSnapshot<RawPlay> {
        LaneSnapshot(lane: lane, entries: entries, coverage: coverage, arrived: t)
    }

    // MARK: Ingest

    static func broadcastIngest() {
        // Duplicates: the same look twice changes nothing.
        var t = GameTimeline<RawPlay>(policy: testPolicy)
        let a = play("a", at: 100, elapsed: 10), b = play("b", at: 110, elapsed: 20, score: ScoreLine(home: 2, away: 0))
        let first = t.ingest(look([a, b], at: 140))
        let revision = t.revision
        let again = t.ingest(look([a, b], at: 145))
        check(first.added == ["a", "b"] && again.isEmpty && t.revision == revision, "a duplicate look changes nothing",
              "\(again)")

        // Out of order: a stale summary (older content, later arrival) never undoes a fresher core read.
        var o = GameTimeline<RawPlay>(policy: testPolicy)
        let c = play("c", at: 120, elapsed: 30), d = play("d", at: 125, elapsed: 35)
        o.ingest(look([b, c, d], .core, at: 150, .tail))
        o.ingest(look([a, b], .summary, at: 160))
        check(o.records.map(\.id) == ["a", "b", "c", "d"], "a stale full look fills in behind a fresher window, removes nothing",
              "\(o.records.map(\.id))")
        // Arriving the other way round: the same game.
        var r = GameTimeline<RawPlay>(policy: testPolicy)
        r.ingest(look([a, b], .summary, at: 140))
        r.ingest(look([b, c, d], .core, at: 150, .tail))
        check(r.records.map(\.id) == ["a", "b", "c", "d"], "a window merges after the summary it extends")
        // A stale copy of a lane (its newest play older than the lane's last look) is ignored.
        let stale = r.ingest(look([b, c], .core, at: 155, .tail))
        check(stale.isEmpty && r.records.map(\.id) == ["a", "b", "c", "d"], "an older copy of a lane changes nothing")

        // Revisions: by ID, newest content wins; a version seen before never comes back.
        var v = GameTimeline<RawPlay>(policy: testPolicy)
        v.ingest(look([a, play("b", at: 110, elapsed: 20, text: "misses shot")], at: 140))
        let revised = v.ingest(look([a, play("b", at: 110, elapsed: 20, text: "misses 26-foot three", version: 1)], at: 150))
        check(revised.revised == ["b"] && v.record("b")?.entry.text == "misses 26-foot three" && v.record("b")?.revisions == 1,
              "a revision replaces the play by ID")
        let regress = v.ingest(look([a, play("b", at: 110, elapsed: 20, text: "misses shot")], .summary, at: 151))
        check(regress.revised.isEmpty && v.record("b")?.entry.text == "misses 26-foot three", "a stale cache's older version never wins")
        // A revision to a told play is a quiet correction.
        v.tell(through: 115)
        let told = v.ingest(look([a, play("b", at: 110, elapsed: 20, text: "makes 26-foot three", version: 2)], at: 160))
        check(told.correctedTold == ["b"] && v.isTold("b"), "a revision to a told play is a correction; it stays told")

        // Removals: gone from a newer full look; the score falls back; never once the lane can't have caught up.
        var m = GameTimeline<RawPlay>(policy: testPolicy)
        let s1 = ScoreLine(home: 2, away: 0), s2 = ScoreLine(home: 2, away: 3)
        m.ingest(look([a, play("b", at: 110, elapsed: 20, score: s1), play("c", at: 120, elapsed: 30, score: s2)], at: 150))
        m.tell(through: 125)
        // The newest play gone looks like a stale cache at first: believed once the lane says so for 12 s.
        let pending = m.ingest(look([a, play("b", at: 110, elapsed: 20, score: s1)], at: 170))
        let removed = m.ingest(look([a, play("b", at: 110, elapsed: 20, score: s1)], at: 185))
        check(pending.isEmpty && m.knows("c") == false && removed.removed == ["c"] && removed.removedTold == ["c"] && m.presentedScore(at: 200) == s1,
              "a told play removed: a quiet correction, the score falls back", "\(removed) \(String(describing: m.presentedScore(at: 200)))")
        // A play the core lane brought 3 s ago, absent from a summary whose content is up to 12 s old: kept.
        var k = GameTimeline<RawPlay>(policy: testPolicy)
        k.ingest(look([a, b], .summary, at: 140))
        k.ingest(look([b, c], .core, at: 150, .tail))
        let fresh = k.ingest(look([a, b, play("e", at: 126, elapsed: 36)], .summary, at: 153))
        check(fresh.removed.isEmpty && k.knows("c"), "a lane that hasn't caught up with a play doesn't remove it", "\(fresh)")
        // Flickering back: a told play removed and restored isn't told again.
        var f = GameTimeline<RawPlay>(policy: testPolicy)
        f.ingest(look([a, b], at: 140))
        f.tell(through: 115)
        f.ingest(look([a], at: 170))
        f.ingest(look([a, b], at: 180))
        check(f.isTold("b") && f.tell(through: 200).isEmpty, "a told play that flickers back stays told")

        // Late insertion behind told plays: told at once, late (a backdated substitution).
        var l = GameTimeline<RawPlay>(policy: testPolicy)
        l.ingest(look([a, c], at: 140))
        l.tell(through: 125)
        let late = l.ingest(look([a, play("sub", at: 101, elapsed: 10, live: false, label: "substitution"), c], at: 300))
        check(late.lateInsertions == ["sub"] && l.record("sub")?.told == .correction && l.toldCount == 3,
              "a play inserted behind told ones attaches quietly (a correction); told stays a prefix")
        // Told: on time at its moment; late once the clock had passed it before it arrived.
        // (The opening look is history; the plays after it are news.)
        let o0 = play("o", at: 60, elapsed: 1)
        var n = GameTimeline<RawPlay>(policy: testPolicy)
        n.ingest(look([o0], at: 70))
        n.ingest(look([o0, a, b], at: 150))
        let onTime = n.tell(through: 110.5)
        check(onTime.map(\.told) == [.history, .late, .onTime], "the opening look is history; a play the clock passed by more than 1.5 s is late",
              "\(onTime.map(\.told))")
        var q = GameTimeline<RawPlay>(policy: testPolicy)
        q.ingest(look([o0], at: 70))
        q.ingest(look([o0, a, b], at: 140))
        check(q.tell(through: 100).map(\.told) == [.history, .onTime] && q.tell(through: 110).map(\.told) == [.onTime],
              "a play told at its moment is on time")
    }

    // MARK: Event times

    static func broadcastEventTimes() {
        var t = GameTimeline<RawPlay>(policy: testPolicy)
        // Missing wallclock: between its neighbors by the game clock (10 of 20 game seconds → halfway).
        t.ingest(look([play("a", at: 100, elapsed: 10), play("b", at: nil, elapsed: 20), play("c", at: 120, elapsed: 30)], at: 150))
        check(abs((t.record("b")?.eventTime ?? 0) - 110) < 0.01 && t.record("b")?.estimated == true,
              "a missing event time is estimated from the game clock between neighbors", "\(t.record("b")?.eventTime ?? 0)")
        // Wallclock going backwards (a dead-ball cluster): presented right after the play before, never back in time.
        var b = GameTimeline<RawPlay>(policy: testPolicy)
        b.ingest(look([play("ft", at: 200, elapsed: 400, live: false), play("sub", at: 180, elapsed: 400, live: false),
                       play("ft2", at: 215, elapsed: 400, live: false)], at: 300))
        let times = b.records.map(\.presentAt)
        check(times == [200, 200, 215], "presentation times are event times made monotone", "\(times)")
        // A batch logged at one wallclock across a long stretch of game clock (college football): spread back.
        var c = GameTimeline<RawPlay>(policy: testPolicy)
        c.ingest(look([play("p0", at: 1000, elapsed: 100), play("p1", at: 1200, elapsed: 140), play("p2", at: 1200, elapsed: 180),
                       play("p3", at: 1200, elapsed: 220)], at: 1300))
        let spread = c.records.map(\.eventTime)
        check(spread[1] < spread[2] && spread[2] < spread[3] && abs(spread[1] - 1066.7) < 1,
              "a batched logging time is spread back by the game clock", "\(spread)")
        // EventTime parses ESPN's wallclock (and offsets) without a formatter.
        let parsed = EventTime.parse("2026-10-31T04:49:18Z")
        check(parsed == DateParser.parse("2026-10-31T04:49:18Z")?.timeIntervalSince1970 && parsed == 1_793_422_158,
              "wallclock parses to epoch seconds", "\(String(describing: parsed))")
        check(EventTime.parse("2026-10-31T04:49:18.250Z") == 1_793_422_158.25 && EventTime.parse("2026-10-30T21:49:18-07:00") == 1_793_422_158,
              "fractional seconds and offsets parse")
    }

    // MARK: Watermark

    static func broadcastWatermark() {
        // Freshness: the last read less the lag quantile; it moves while reads succeed and freezes when they stop.
        var t = GameTimeline<RawPlay>(policy: testPolicy)
        t.ingest(look([play("a", at: 100, elapsed: 10)], at: 100))   // opening look: says nothing about lag
        t.ingest(look([play("a", at: 100, elapsed: 10), play("b", at: 110, elapsed: 20)], at: 135))  // lag 25
        check(abs(t.lagQuantile - 25) < 0.01, "the lag quantile is measured from live plays at the frontier", "\(t.lagQuantile)")
        // The network guard: the last read plus three read intervals (5 s), less the lag quantile.
        var k = t.knowledge(at: 135)
        check(k.bound == .freshness && abs(k.frontier - 125) < 0.01, "the network guard: the last read, plus three reads, less the lag", "\(k)")
        t.noteRead(.summary, at: 140)
        t.noteRead(.summary, at: 145)
        k = t.knowledge(at: 145)
        check(abs(k.frontier - 135) < 0.01, "reads with nothing new still move it", "\(k)")
        k = t.knowledge(at: 400)
        check(abs(k.frontier - 135) < 0.01, "no reads: it stands still (the clock will stall rather than guess)")
        // Quiet: a running game can't go silent past the sport's allowance.
        t.noteRead(.summary, at: 300)
        k = t.knowledge(at: 300)
        check(k.bound == .quiet && abs(k.frontier - 170) < 0.01, "silence past the quiet allowance caps it", "\(k)")
        // A stopped clock at the newest play's clock (a timeout) confirms the quiet.
        t.observe(FastReading(arrived: 200, state: .live, period: 1, elapsed: 20, running: false, score: nil, source: "status"))
        t.observe(FastReading(arrived: 260, state: .live, period: 1, elapsed: 20, running: false, score: nil, source: "status"))
        t.noteRead(.summary, at: 400)
        k = t.knowledge(at: 400)
        check(abs(k.frontier - (260 - t.fastLag + 60)) < 0.01, "the fast lane's stopped clock confirms quiet; the allowance runs from it",
              "\(k) lag \(t.fastLag)")
        // The floor: the newest live play less the insertion allowance.
        var f = GameTimeline<RawPlay>(policy: testPolicy)
        f.ingest(look([play("a", at: 100, elapsed: 10)], at: 101))
        f.ingest(look([play("a", at: 100, elapsed: 10), play("b", at: 150, elapsed: 60)], at: 152))
        k = f.knowledge(at: 152)
        check(k.frontier >= 146 - 1e-9, "the newest live play less the allowance is always known", "\(k)")

        // An unexplained fast-lane score: the order guard at the tell, at the last reading the plays explain
        // (with the hold on, the watermark itself stops there).
        var holding = testPolicy
        holding.holdForUnexplainedScores = true
        var u = GameTimeline<RawPlay>(policy: holding)
        let s0 = ScoreLine(home: 10, away: 10), s1 = ScoreLine(home: 12, away: 10)
        u.ingest(look([play("a", at: 100, elapsed: 10, score: s0)], at: 101))
        u.observe(FastReading(arrived: 120, state: .live, period: 1, elapsed: 40, running: true, score: s0, source: "scoreboard"))
        u.observe(FastReading(arrived: 150, state: .live, period: 1, elapsed: 70, running: true, score: s1, source: "scoreboard"))
        u.noteRead(.summary, at: 200)
        k = u.knowledge(at: 200)
        check(k.bound == .unexplainedScore && abs(k.frontier - 100) < 0.01,
              "a score no play explains holds the watermark before it (after the last play with the old score)", "\(k)")
        // The play arrives: released.
        u.ingest(look([play("a", at: 100, elapsed: 10, score: s0), play("b", at: 130, elapsed: 40, score: s1)], at: 205))
        check(u.knowledge(at: 205).bound != .unexplainedScore, "the scoring play's arrival releases it")
        var guarded = GameTimeline<RawPlay>(policy: testPolicy)
        guarded.ingest(look([play("a", at: 100, elapsed: 10, score: s0)], at: 101))
        guarded.observe(FastReading(arrived: 120, state: .live, period: 1, elapsed: 40, running: true, score: s0, source: "scoreboard"))
        guarded.observe(FastReading(arrived: 150, state: .live, period: 1, elapsed: 70, running: true, score: s1, source: "scoreboard"))
        guarded.noteRead(.summary, at: 200)
        check(guarded.knowledge(at: 200).bound != .unexplainedScore && abs((guarded.tellBarrier ?? 0) - 100) < 0.01,
              "by default the clock keeps time and the tell waits at the guard instead")
        // Plays that still carry the old score precede the basket; one without a score after them waits.
        guarded.ingest(look([play("a", at: 100, elapsed: 10, score: s0), play("c", at: 110, elapsed: 20, score: s0),
                             play("d", at: 140, elapsed: 50, score: s0), play("e", at: 146, elapsed: 56)], at: 205))
        let barred = guarded.tell(through: 150, barrier: guarded.tellBarrier ?? .infinity)
        check(barred.map(\.id) == ["a", "c", "d"] && !guarded.isTold("e"), "nothing past the guard is told before the score's play",
              "\(barred.map(\.id))")
        // Free throws while the clock is stopped at the foul: through the stoppage, not past the restart.
        var ft = GameTimeline<RawPlay>(policy: holding)
        ft.ingest(look([play("foul", at: 100, elapsed: 400, live: false, stops: true, score: s0)], at: 101))
        ft.observe(FastReading(arrived: 120, state: .live, period: 1, elapsed: 400, running: false, score: s0, source: "scoreboard"))
        ft.observe(FastReading(arrived: 150, state: .live, period: 1, elapsed: 400, running: false, score: s1, source: "scoreboard"))
        ft.noteRead(.summary, at: 160)
        check(ft.knowledge(at: 160).bound != .unexplainedScore, "free throws during a stoppage don't hold the clock while it's stopped")
        ft.observe(FastReading(arrived: 165, state: .live, period: 1, elapsed: 403, running: true, score: s1, source: "scoreboard"))
        k = ft.knowledge(at: 170)
        check(k.bound == .unexplainedScore && abs(k.frontier - (150 - ft.fastLag)) < 0.01, "…but they do once the clock runs again", "\(k)")

        // The safety net: applied once p is the grace past the score's latest moment, retired by the play.
        var e = BroadcastEngine<RawPlay>(sport: .basketball, policy: testPolicy)
        e.ingest(look([play("a", at: 100, elapsed: 10, score: s0)], at: 140))
        e.observe(FastReading(arrived: 140, state: .live, period: 1, elapsed: 40, running: true, score: s0, source: "scoreboard"))
        e.advance(now: 140)
        e.observe(FastReading(arrived: 145, state: .live, period: 1, elapsed: 45, running: true, score: s1, source: "scoreboard"))
        var applied: ScoreCorrection?
        var now = 145.0
        while now < 260, applied == nil {
            e.noteRead(.summary, at: now)
            applied = e.advance(now: now).correction
            now += 5
        }
        check(applied?.score == s1 && e.timeline.safetyNetApplied == 1, "the safety net applies the fast lane's score after the grace",
              "\(String(describing: applied)) at \(now)")
        check(e.presented(at: now + 30).score == s1 || e.timeline.presentedScore(at: .infinity) == s1, "and the presented score has it")
        e.ingest(look([play("a", at: 100, elapsed: 10, score: s0), play("b", at: 120, elapsed: 30, score: s1)], at: now))
        check(e.timeline.corrections.isEmpty, "the play's arrival retires the correction")
    }

    // MARK: Clock

    static func broadcastClock() {
        // Starts at the live edge.
        var c = PresentationClock()
        c.update(now: 1000, inputs: .init(target: 50, cap: 990, quietUntil: nil))
        check(abs(c.p(at: 1000) - 950) < 1e-9 && c.events.first == .start(at: 1000, p: 950), "opens at the live edge (now − D)")
        var capped = PresentationClock()
        capped.update(now: 1000, inputs: .init(target: 50, cap: 900, quietUntil: nil))
        check(abs(capped.p(at: 1000) - 900) < 1e-9, "…or at the watermark, if that's earlier")

        // Slewing: the target moves; the rate stays within 0.92–1.08; p is continuous and never goes back.
        var s = PresentationClock()
        s.update(now: 0, inputs: .init(target: 50, cap: .infinity, quietUntil: nil))
        var minRate = 2.0, maxRate = 0.0, last = s.p(at: 0), continuous = true
        let targets: [Double] = [50, 58, 58, 44, 44, 52, 52, 52]
        for step in 1...300 {
            let now = Double(step) * 2.5
            let before = s.p(at: now)
            s.update(now: now, inputs: .init(target: targets[min(step / 20, targets.count - 1)], cap: now - 5, quietUntil: nil))
            if abs(s.p(at: now) - before) > 1e-6 { continuous = false }
            for sub in 0..<5 {
                let t = now + Double(sub) * 0.5
                let r = s.rate(at: t)
                minRate = min(minRate, r)
                maxRate = max(maxRate, r)
                if s.p(at: t) < last - 1e-9 { continuous = false }
                last = s.p(at: t)
            }
        }
        check(minRate >= 0.92 - 1e-9 && maxRate <= 1.08 + 1e-9, "the slew stays within 0.92–1.08×",
              String(format: "%.3f…%.3f", minRate, maxRate))
        check(continuous && !s.events.contains { if case .jump = $0 { true } else { false } }, "p never jumps or goes back while slewing")
        check(abs(s.delay(at: 750) - 52) < 0.5, "D settles on the target", "\(s.delay(at: 750))")

        // Stall: approaching the watermark it eases to a stop there, holds, and eases back up when it moves.
        var h = PresentationClock()
        h.update(now: 0, inputs: .init(target: 50, cap: -45, quietUntil: nil))
        h.update(now: 1, inputs: .init(target: 50, cap: -40, quietUntil: nil))
        let approach = (0..<40).map { h.p(at: 1 + Double($0) * 0.25) }
        check(approach.allSatisfy { $0 <= -40 + 1e-9 } && abs(h.p(at: 30) - -40) < 1e-9, "p never passes the watermark: it eases to it and holds")
        let rates = (0..<40).map { h.rate(at: 1 + Double($0) * 0.25) }
        check(zip(rates, rates.dropFirst()).allSatisfy { abs($0 - $1) < 0.3 }, "the approach decelerates smoothly", "\(rates)")
        h.update(now: 30, inputs: .init(target: 50, cap: -40, quietUntil: nil))
        check(h.regime == .stalled && h.stalled(at: 40) == 10, "held at the watermark is a stall, timed", "\(h.regime) \(String(describing: h.stalled(at: 40)))")
        h.update(now: 40, inputs: .init(target: 50, cap: 0, quietUntil: nil))
        check(h.rate(at: 40) == 0 && h.rate(at: 40.5) > 0 && h.rate(at: 40.5) < 1, "it eases back up when the watermark moves")
        check(h.events.contains(.resume(at: 40, held: 10)), "the stall's end is logged with its length")

        // Catch-up: behind the target, 1.08× until it's reached, then 1×.
        var u = PresentationClock()
        u.update(now: 0, inputs: .init(target: 60, cap: .infinity, quietUntil: nil))
        u.update(now: 1, inputs: .init(target: 50, cap: .infinity, quietUntil: nil))
        check(abs(u.rate(at: 2) - 1.08) < 1e-9 && abs(u.rate(at: 200) - 1) < 1e-9 && abs(u.delay(at: 200) - 50) < 1e-6,
              "behind the target it catches up at 1.08×, then runs at 1×")

        // Jump: more than jumpMax behind, a declared jump to the live edge.
        var j = PresentationClock()
        j.update(now: 0, inputs: .init(target: 50, cap: -50, quietUntil: nil))
        for now in stride(from: 10.0, through: 90, by: 10) { j.update(now: now, inputs: .init(target: 50, cap: -45, quietUntil: nil)) }
        j.update(now: 100, inputs: .init(target: 50, cap: 60, quietUntil: nil))
        check(j.events.contains(.jump(at: 100, from: -45, to: 50)) && abs(j.p(at: 100) - 50) < 1e-9, "far behind: a declared jump to the live edge",
              "\(j.events)")

        // Skip: behind, inside a stoppage with nothing to tell, the clock moves where nothing on screen changes.
        var k = PresentationClock()
        k.update(now: 0, inputs: .init(target: 50, cap: -50, quietUntil: nil))
        k.update(now: 10, inputs: .init(target: 50, cap: 10, quietUntil: -42))
        check(k.events.contains(.skip(at: 10, from: -50, to: -42)), "behind in a stoppage, it skips across it", "\(k.events)")
        // Stretch: ahead of the target inside a stoppage, it holds still until D has grown to it.
        var st = PresentationClock()
        st.update(now: 0, inputs: .init(target: 40, cap: .infinity, quietUntil: nil))
        st.update(now: 5, inputs: .init(target: 50, cap: .infinity, quietUntil: 100))
        check(st.regime == .stretching && st.rate(at: 6) == 0 && abs(st.delay(at: 15) - 50) < 1e-9 && st.rate(at: 16) == 1,
              "ahead in a stoppage, it holds until D reaches the target")
        // Wake: updates far apart (asleep, another page) go to the live edge.
        var w = PresentationClock()
        w.update(now: 0, inputs: .init(target: 50, cap: .infinity, quietUntil: nil))
        w.update(now: 500, inputs: .init(target: 50, cap: .infinity, quietUntil: nil))
        check(w.events.contains { if case .wake = $0 { true } else { false } }, "a long gap between updates is a wake")
        // The plan inverts: when p reaches a moment.
        var inv = PresentationClock()
        inv.update(now: 0, inputs: .init(target: 50, cap: .infinity, quietUntil: nil))
        inv.update(now: 1, inputs: .init(target: 45, cap: 30, quietUntil: nil))
        if let t = inv.wall(reaching: 0, after: 1) {
            check(abs(inv.p(at: t) - 0) < 1e-6, "wall(reaching:) finds when p gets there")
        } else {
            check(false, "wall(reaching:) finds when p gets there")
        }
        check(inv.wall(reaching: 31, after: 1) == nil, "…and nil past where it holds")
    }

    // MARK: Presented state

    static func broadcastPresented() {
        var e = BroadcastEngine<RawPlay>(sport: .basketball, policy: testPolicy)
        let s1 = ScoreLine(home: 2, away: 0), s2 = ScoreLine(home: 2, away: 3)
        // A shot at 1000 (clock 100 s played), a foul at 1020 (120, stops the clock), the inbound play at 1060 (125), a three at 1070 (135).
        let plays = [play("shot", at: 1000, elapsed: 100, score: s1), play("foul", at: 1020, elapsed: 120, live: false, stops: true, score: s1),
                     play("drive", at: 1060, elapsed: 125, score: s1), play("three", at: 1070, elapsed: 135, score: s2)]
        // The page opens on the first three; the three arrives right after (30 s after it happened).
        e.ingest(look(Array(plays.prefix(3)), at: 1100))
        e.ingest(look(plays, at: 1100))
        e.advance(now: 1100)
        // Opened with D = (lag 30 + horizon 2) + margin 1 = 33: p = 1067, everything before told as history.
        let open = e.presented(at: 1100)
        check(abs(e.p(at: 1100) - 1067) < 1e-6 && open.told == 3 && open.score == s1, "opens at the live edge with the past as history",
              "p \(e.p(at: 1100)) told \(open.told)")
        check(e.timeline.records.prefix(3).allSatisfy { $0.told == .history }, "plays before the open are history, never news")
        // The three is presented at its moment, with its score, not before.
        check(e.nextWake(after: 1100) == 1103, "the next wake is the three's moment on p", "\(String(describing: e.nextWake(after: 1100)))")
        check(e.presented(at: 1102.9).score == s1, "not told until the engine reaches it (the score waits for the play)")
        e.noteRead(.summary, at: 1103)
        let step = e.advance(now: 1103)
        check(step.told.map(\.id) == ["three"] && step.told.first?.told == .onTime && e.presented(at: 1103).score == s2,
              "told at its moment: the score changes with it")
        // The clock: running between plays from the last, never past the next play's clock.
        var g = GameTimeline<RawPlay>(policy: testPolicy)
        g.ingest(look(plays, at: 1100))
        g.tell(through: 1000)
        let running = PresentedGame.at(1010, timeline: g).clock
        check(running?.running == true && abs((running?.elapsed ?? 0) - 110) < 1e-9, "the game clock runs from the last play", "\(String(describing: running))")
        check(abs((PresentedGame.at(1030, timeline: g).clock?.elapsed ?? 0) - 120) < 1e-9 && PresentedGame.at(1030, timeline: g).clock?.running == false,
              "…and stops at the next known play's clock")
        g.tell(through: 1020)
        // Stopped after the foul; restarts 5 s before the inbound play so it reads 125 when that play comes.
        let stopped = PresentedGame.at(1050, timeline: g).clock, restarted = PresentedGame.at(1057, timeline: g).clock
        check(stopped?.running == false && abs((stopped?.elapsed ?? 0) - 120) < 1e-9, "a foul stops the clock")
        check(restarted?.running == true && abs((restarted?.elapsed ?? 0) - 122) < 1e-9, "it restarts in time to reach the next play's clock",
              "\(String(describing: restarted))")
        check(PresentedGame.nextChange(after: 1050, timeline: g) == 1055, "the next change is the restart (scheduled, not polled)")
        // Words.
        var word = PresentedGame()
        word.phase = .live
        word.period = 3
        word.clock = PresentedGame.Clock(period: 3, elapsed: 720 - 252, running: true, countsDown: true, length: 720)
        check(word.status(.basketball, regulationPeriods: 4) == "4:12 - 3rd", "status: \"4:12 - 3rd\"", word.status(.basketball, regulationPeriods: 4))
        word.clock?.elapsed = 720 - 33.8
        check(word.status(.basketball, regulationPeriods: 4) == "33.8 - 3rd", "under a minute: tenths")
        word.phase = .interval(period: 2)
        check(word.status(.basketball, regulationPeriods: 4) == "Halftime" && word.status(.soccer, regulationPeriods: 2) == "End of 2nd Half",
              "intervals: Halftime, End of …")
        word.phase = .live
        word.period = 13
        check(word.status(.baseball, regulationPeriods: 18) == "Top 7th", "baseball: the half-inning", word.status(.baseball, regulationPeriods: 18))
        word.period = 2
        word.clock = PresentedGame.Clock(period: 2, elapsed: 5400 + 125, running: true, countsDown: false, length: 2700)
        check(word.status(.soccer, regulationPeriods: 2) == "90'+3'", "soccer: added time", word.status(.soccer, regulationPeriods: 2))
    }

    // MARK: Lanes

    static func broadcastLanes() {
        let nba = BroadcastLanes.policy(.basketball, path: NBADetail.path)
        func json(_ object: [String: Any]) -> JSON { JSON(object) }
        let shot = json(["id": "1", "period": ["number": 4], "clock": ["displayValue": "4:12"], "type": ["id": "131", "text": "Pullup Jump Shot"],
                         "shootingPlay": true, "scoringPlay": true, "homeScore": 100, "awayScore": 98, "wallclock": "2026-10-31T04:49:18Z",
                         "participants": [["athlete": ["id": "9"]]], "text": "makes pullup"])
        let e = BroadcastLanes.basketball(shot, policy: nba)
        check(e?.kind.phase == .live && e?.kind.label == "shot" && e?.clock.elapsed == 720 - 252 && e?.score == ScoreLine(home: 100, away: 98)
              && e?.wallclock == 1_793_422_158, "NBA: a shot is live, with its clock, score and event time")
        let late = json(["id": "2", "period": ["number": 4], "clock": ["displayValue": "1:12"], "type": ["id": "92"], "shootingPlay": true,
                         "scoringPlay": true])
        check(BroadcastLanes.basketball(late, policy: nba)?.kind.stopsClock == true, "a make in the last two minutes stops the clock")
        let ft = json(["id": "3", "period": ["number": 2], "clock": ["displayValue": "5:00"], "type": ["id": "98", "text": "Free Throw - 1 of 2"],
                       "shootingPlay": true, "text": "makes free throw 1 of 2"])
        check(BroadcastLanes.basketball(ft, policy: nba)?.kind.phase == .dead, "free throws are dead-ball (they attach to the stoppage)")
        let team = json(["id": "4", "period": ["number": 2], "type": ["id": "156"], "participants": [Any]()])
        check(BroadcastLanes.basketball(team, policy: nba)?.kind.label == "team rebound", "a team rebound (no player) is dead-ball")
        let steal = json(["id": "5", "period": ["number": 2], "type": ["id": "63"], "participants": [["athlete": ["id": "1"]], ["athlete": ["id": "2"]]]])
        let lost = json(["id": "6", "period": ["number": 2], "type": ["id": "87"], "participants": [["athlete": ["id": "1"]]]])
        check(BroadcastLanes.basketball(steal, policy: nba)?.kind.stopsClock == false && BroadcastLanes.basketball(lost, policy: nba)?.kind.stopsClock == true,
              "a steal keeps the clock running; an out-of-bounds turnover stops it")
        let end = json(["id": "7", "period": ["number": 3], "type": ["id": "412", "text": "End Period"]])
        check(BroadcastLanes.basketball(end, policy: nba)?.kind.endsPeriod == 3, "an end of period ends the period")
        // Football: snaps are live; admin dead; the clock stops after an incompletion.
        let fb = BroadcastLanes.policy(.football)
        let incomplete = json(["id": "10", "sequenceNumber": "14500", "period": ["number": 1], "clock": ["value": 804.0, "displayValue": "13:24"],
                               "type": ["id": "3", "text": "Pass Incompletion"], "start": ["yardLine": 39], "end": ["yardLine": 39], "text": "pass incomplete"])
        let timeout = json(["id": "11", "sequenceNumber": "14600", "period": ["number": 1], "type": ["id": "21", "text": "Timeout"]])
        let snaps = BroadcastLanes.entries([timeout, incomplete], sport: .football, policy: fb)
        check(snaps.map(\.id) == ["10", "11"] && snaps[0].kind.phase == .live && snaps[0].kind.stopsClock && snaps[1].kind.phase == .dead
              && snaps[0].clock.elapsed == 96, "football: ordered by sequence; an incompletion stops the clock; a timeout is dead-ball")
        // The fast lane: the scoreboard as evidence (a running clock from two readings).
        var event = Event(id: "espn-1", content: .match(top: comp("a", "A", "98"), bottom: comp("h", "H", "100")), state: .live, start: .now,
                          detail: "4:12 - 4th", caption: nil, link: nil)
        event.clock = GameClock(seconds: 252, sampledAt: .now, period: 4, direction: .down, display: "4:12 - 4th", running: true)
        let r1 = BroadcastLanes.reading(event, topIsHome: false, policy: nba, previous: nil, at: 100)
        event.clock = GameClock(seconds: 240, sampledAt: .now, period: 4, direction: .down, display: "4:00 - 4th", running: true)
        let r2 = BroadcastLanes.reading(event, topIsHome: false, policy: nba, previous: r1, at: 130)
        check(r1?.score == ScoreLine(home: 100, away: 98) && r2?.running == true && r2?.elapsed == 480, "the scoreboard reads as home/away score and a running clock")
        check(BroadcastLanes.isInterval("End of 3rd") && BroadcastLanes.isInterval("Halftime") && BroadcastLanes.isInterval("Mid 7th")
              && !BroadcastLanes.isInterval("4:12 - 3rd"), "intervals are recognized from the status text")
    }

    // MARK: Recordings

    static func broadcastRecording() {
        let root = URL(fileURLWithPath: "Tests/Fixtures/broadcast")
        // A half-written last line in scores.jsonl is ignored; a file still being written is skipped.
        let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("broadcast-\(UUID().uuidString)")
        let game = scratch.appendingPathComponent("basketball_nba/1")
        try? FileManager.default.createDirectory(at: game, withIntermediateDirectories: true)
        let rows = "{\"at\": 1, \"event\": \"1\", \"state\": \"in\"}\n{\"at\": 2, \"event\": \"1\", \"sta"
        try? rows.write(to: scratch.appendingPathComponent("basketball_nba/scores.jsonl"), atomically: true, encoding: .utf8)
        if let fixture = try? FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("basketball_nba/401909285").path).sorted().first {
            let copy = game.appendingPathComponent("1000.json.gz")
            try? FileManager.default.copyItem(at: root.appendingPathComponent("basketball_nba/401909285/\(fixture)"), to: copy)
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: copy.path)
        }
        let settling = Recording.load(root: scratch, sport: "basketball_nba", event: "1")
        let settled = Recording.load(root: scratch, sport: "basketball_nba", event: "1", settle: 10, now: Date() + 60)
        check(settling.snapshots.isEmpty && settled.snapshots.count == 1 && settled.rows.count == 1,
              "the loader skips files written in the last 10 s and a half-written last line", "\(settling.snapshots.count) \(settled.snapshots.count) \(settled.rows.count)")
        check(settled.summary(settled.snapshots[0])?["plays"].array.isEmpty == false, "a gzip snapshot decompresses to its summary")
        try? FileManager.default.removeItem(at: scratch)

        // The real slice: 401909285's fourth quarter, 7:35 to about 4:00, at the app's cadence.
        let recording = Recording.load(root: root, sport: "basketball_nba", event: "401909285", settle: 0)
        check(recording.snapshots.count == 35 && recording.sport == .basketball && recording.path == "basketball/nba",
              "the fixture loads (35 snapshots)", "\(recording.snapshots.count)")
        func replayed() -> (told: [String], scores: [ScoreLine?], delays: [Double], late: Int, stalls: Int, steps: Int, known: (Int, Int),
                            inOrder: [String]) {
            guard var replay = RecordingReplay(recording) else { return ([], [], [], 0, 0, 0, (0, 0), []) }
            var told: [String] = [], scores: [ScoreLine?] = [], delays: [Double] = [], inOrder: [String] = []
            var late = 0, stalls = 0, steps = 0, known = 0, total = 0
            let leadIn = replay.policy.horizons.live
            var ordered = true
            replay.run(.app(replay.policy)) { replay, t, step, _ in
                steps += 1
                for r in step.told {
                    told.append(r.id)
                    if r.told != .late { inOrder.append(r.id) }
                    if r.told == .late && r.entry.kind.phase == .live { late += 1 }
                    if r.told == .onTime, r.entry.kind.phase == .live, !r.backfill {
                        total += 1
                        if r.firstSeen <= t - leadIn + 1e-6 { known += 1 }
                    }
                }
                stalls += step.events.filter { if case .stall = $0 { true } else { false } }.count
                let p = replay.engine.p(at: t)
                // The presented score is always the score after the last told play.
                let shown = replay.engine.presented(at: t).score
                let lastTold = replay.engine.timeline.records.prefix(replay.engine.timeline.toldCount).last { $0.entry.score != nil }?.entry.score
                if shown != lastTold && replay.engine.timeline.corrections.isEmpty { ordered = false }
                scores.append(shown)
                delays.append(t - p)
            }
            if !ordered { told.append("disorder") }
            return (told, scores, delays, late, stalls, steps, (known, total), inOrder)
        }
        let a = replayed(), b = replayed()
        check(a.told == b.told && a.scores == b.scores && a.delays == b.delays && a.steps > 100, "the replay is deterministic", "\(a.steps) steps")
        check(!a.told.contains("disorder"), "the presented score is always the last told play's")
        let order = recording.snapshots.last.flatMap { recording.summary($0) }?["plays"].array.compactMap { $0["id"].string } ?? []
        // Everything but late insertions (told at once behind what's told, by definition) in the game's order.
        let toldOrder = a.inOrder.filter { order.contains($0) }
        check(toldOrder == order.filter { toldOrder.contains($0) }, "plays are told in the game's order")
        let delays = a.delays.dropFirst(10)
        check(delays.allSatisfy { $0 > 40 && $0 < 90 }, "D stays between 40 and 90 s on the slice",
              String(format: "%.1f…%.1f", delays.min() ?? 0, delays.max() ?? 0))
        let share = a.known.1 > 0 ? Double(a.known.0) / Double(a.known.1) : 0
        // Late binding at q 0.95: most are known before their binding horizon; the rest are compressed or micro catch-ups.
        check(share >= 0.75, "most live-ball plays are known before their binding horizon", "\(a.known.0)/\(a.known.1)")
        check(a.late <= 1, "late live-ball tellings (past a micro catch-up) are rare", "\(a.late)")
        // The theater's view: plays up to the watermark, told ones marked, in order.
        guard var replay = RecordingReplay(recording) else { return }
        var snapshot: TimelineSnapshot<RawPlay>?
        replay.run(.app(replay.policy)) { replay, t, _, _ in snapshot = replay.engine.snapshot(at: t) }
        if let snapshot {
            check(snapshot.plays.map(\.order) == snapshot.plays.map(\.order).sorted() && snapshot.plays.allSatisfy { ($0.eventTime ?? 0) <= snapshot.watermark || snapshot.told.contains($0.id) },
                  "the theater's snapshot: in order, up to the watermark (§10)")
            let mapped = snapshot.map { raw in raw.json["type"]["id"].int }
            check(mapped.plays.count == snapshot.plays.filter { $0.play.json["type"]["id"].int != nil }.count, "a snapshot maps to a sport's plays")
        } else {
            check(false, "the theater's snapshot")
        }
    }
}
