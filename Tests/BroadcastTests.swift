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
        print("\nBroadcast: the page")
        broadcastPage()
        broadcastPolicies()
        print("\nBroadcast: football, soccer and baseball lanes")
        broadcastSports()
        print("\nBroadcast: a shown score never steps back")
        broadcastFloor()
        print("\nBroadcast: the recorder's status and core lanes")
        broadcastRecorderLanes()
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


// MARK: - The page

extension ScorelineTests {
    /// An NBA play as ESPN's summary has it.
    static func nbaPlay(_ id: String, at wall: PTime, clock: String, type: Int, text: String, home: Int, away: Int,
                        shooting: Bool = false, scoring: Bool = false, team: String = "1", people: [String] = ["9"]) -> JSON {
        let iso = ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: wall))
        return JSON(["id": id, "period": ["number": 1], "clock": ["displayValue": clock], "type": ["id": "\(type)", "text": text],
                     "text": text, "homeScore": home, "awayScore": away, "shootingPlay": shooting, "scoringPlay": scoring,
                     "scoreValue": scoring ? 3 : 0, "wallclock": iso, "team": ["id": team],
                     "participants": people.map { ["athlete": ["id": $0]] }] as [String: Any])
    }

    /// The real page model on a virtual clock: the hero's score, the Latest
    /// list, Win Probability and the moments change at the play's moment on p,
    /// not when it arrives; the tables wait for their summary's watermark.
    static func broadcastPage() {
        var now: PTime = 1100
        let b = Broadcast()
        b.automatic = false
        b.time = BroadcastTime(now: { now })
        let event = Event(id: "espn-1", content: .match(top: comp("espn-basketball-1", "Away", "0"), bottom: comp("espn-basketball-2", "Home", "2")),
                          state: .live, start: .now, detail: "8:00 - 1st", caption: nil, link: nil,
                          ref: .espn(path: NBADetail.path, id: "1", sport: .basketball))
        b.begin(event, topIsHome: false)
        check(b.active, "a live NBA game broadcasts")
        let policy = BroadcastLanes.policy(.basketball, path: NBADetail.path)
        let shot1 = nbaPlay("p1", at: 1000, clock: "11:20", type: 92, text: "Home makes jumper", home: 2, away: 0, shooting: true, scoring: true, team: "2")
        let board = nbaPlay("p2", at: 1010, clock: "11:10", type: 155, text: "Away defensive rebound", home: 2, away: 0)
        let three = nbaPlay("p3", at: 1080, clock: "10:00", type: 92, text: "Away makes 26-foot three", home: 2, away: 3, shooting: true, scoring: true)
        func summary(_ plays: [JSON], stat: String) -> GameDetail {
            var d = GameDetail()
            d.topIsHome = false
            d.broadcastPlays = BroadcastLanes.entries(plays, sport: .basketball, policy: policy)
            d.recentPlays = NBADetail.recentPlays(plays)
            d.moments = plays.map { GameDetail.Moment(id: $0["id"].string ?? "", kind: .score, clock: "", text: $0["text"].string ?? "", side: nil) }
            d.winByPlay = ["p2": GameDetail.WinChance(home: 0.45, tie: 0), "p3": GameDetail.WinChance(home: 0.30, tie: 0)]
            d.stats = [GameDetail.Stat(label: "Field Goal %", top: stat, bottom: stat, topShare: 0.5)]
            d.linescore = GameDetail.Linescore(headers: ["1", "2", "3", "4", "T"], top: ["3", "", "", "", "3"], bottom: ["2", "", "", "", "2"])
            return d
        }
        // The page opens on the first two plays (history); the three comes 40 s after it happened.
        b.ingest(summary: summary([shot1, board], stat: "40"))
        var shown = b.present(event)
        check(shown.competitors.map(\.score) == ["0", "2"], "the hero shows the score after the last told play", "\(shown.competitors.map(\.score))")
        now = 1120
        b.ingest(core: [shot1, board, three])
        b.ingest(summary: summary([shot1, board, three], stat: "45"))
        let moment = LiveMoment(id: "p3", chart: .court, tier: .swing, kind: .made(value: 3), lead: "Three", detail: "Away makes 26-foot three", side: .top)
        check(b.gate([moment]).isEmpty, "a moment waits for its play's moment on p")
        guard let p3 = b.engine?.timeline.record("p3") else { return check(false, "the three is on the timeline") }
        // When p reaches it, as the clock plans (it may be slewing toward a new target).
        guard let moment3 = b.engine?.clock.wall(reaching: p3.presentAt, after: now) else { return check(false, "the clock reaches the three") }
        now = moment3 - 1
        b.step()
        var d = b.present(summary([shot1, board, three], stat: "45"), revision: 1, side: { _ in nil })
        shown = b.present(event)
        check(shown.competitors.map(\.score) == ["0", "2"] && d?.recentPlays.first?.id == "p2" && b.takeReleased().isEmpty,
              "a second before its moment: not on the hero, not in Latest, no moment", "\(shown.competitors.map(\.score))")
        check(abs((d?.topWinProbability ?? 0) - 0.55) < 1e-9, "Win Probability is the last told play's (ESPN's per play)")
        check(d?.stats.first?.top == "40", "the box score and stats are the summary p has passed (the newer waits for its watermark)",
              d?.stats.first?.top ?? "")
        now = moment3 + 0.01
        b.step()
        d = b.present(summary([shot1, board, three], stat: "45"), revision: 1, side: { _ in nil })
        shown = b.present(event)
        check(shown.competitors.map(\.score) == ["3", "2"], "at its moment the score changes", "\(shown.competitors.map(\.score))")
        check(d?.recentPlays.first?.id == "p3" && d?.moments.map(\.id) == ["p1", "p2", "p3"], "…and Latest and the key plays have it, together")
        check(abs((d?.topWinProbability ?? 0) - 0.70) < 1e-9 && d?.stats.first?.top == "45", "…and Win Probability and the tables")
        check(b.takeReleased().map(\.id) == ["p3"], "…and its moment is released")
        check(d?.linescore?.top.first == "3" && d?.linescore?.bottom.first == "2" && d?.linescore?.top.last == "3",
              "the line score comes from the told plays", "\(String(describing: d?.linescore))")
        check(shown.state == .live && shown.detail?.contains("1st") == true && shown.clock?.period == 1, "status and clock are p's",
              shown.detail ?? "")
        // A retraction: a waiting moment goes quietly; an offered one comes back down.
        now += 1
        let late = LiveMoment(id: "p9", chart: .court, tier: .swing, kind: .missed, lead: "Miss", detail: "", side: .top)
        _ = b.gate([late])
        check(b.retract(["p9", "p3"]) == ["p3"], "retracting: only what was offered comes back down")
        b.end()
        check(!b.active && b.present(event) == event, "closing the page: everything shows as the scoreboard has it again")
        // A final never broadcasts (the page shows it as today).
        let final = Event(id: "espn-2", content: event.content, state: .final, start: .now, detail: "Final", caption: nil, link: nil,
                          ref: event.ref)
        let f = Broadcast()
        f.begin(final, topIsHome: false)
        check(!f.active, "a final game doesn't broadcast")
    }

    /// The menu bar and the alerts follow the page's presentation for its game
    /// only; Polymarket's ticks are shown at their own time on p.
    static func broadcastPolicies() {
        let a = Event(id: "espn-1", content: .match(top: comp("t", "A", "98"), bottom: comp("b", "B", "100")), state: .live, start: .now,
                      detail: "4:00 - 4th", caption: nil, link: nil)
        let presented = a.with(content: .match(top: comp("t", "A", "95"), bottom: comp("b", "B", "100")), detail: .some("4:31 - 4th"))
        let other = Event(id: "espn-9", content: a.content, state: .live, start: .now, detail: nil, caption: nil, link: nil)
        check(ScoreStore.menuBar(a, presented: presented)?.competitors.first?.score == "95", "the menu bar shows the open page's presented game")
        check(ScoreStore.menuBar(other, presented: presented)?.id == "espn-9" && ScoreStore.menuBar(a, presented: nil)?.competitors.first?.score == "98",
              "…and the scoreboard's for any other game, or once the page closes")
        check(ScoreStore.alertsFollowPage("espn-1", presented: presented) && !ScoreStore.alertsFollowPage("espn-9", presented: presented),
              "the scoreboard's alerts wait for the page only for its own game")
        check(Notifier.body(from: a.with(content: .match(top: comp("t", "A", "95"), bottom: comp("b", "B", "100"))), to: a) != nil,
              "the presented score rising is an alert, as the scoreboard's would be")

        // The page re-renders only when what it shows changes: not while a running clock just ticks.
        var a0 = PresentedGame()
        a0.phase = .live
        a0.period = 1
        a0.told = 3
        a0.clock = PresentedGame.Clock(period: 1, elapsed: 100, running: true, countsDown: true, length: 720)
        var a1 = a0
        a1.clock?.elapsed = 105.2
        check(!Broadcast.differs(a1, from: a0, after: 5), "a running clock ticking on its own doesn't republish")
        a1.clock?.elapsed = 106
        check(Broadcast.differs(a1, from: a0, after: 5), "…drifting past 0.75 s (the slew) does")
        var a2 = a0
        a2.told = 4
        check(Broadcast.differs(a2, from: a0, after: 0), "a play told does")
        var a3 = a0
        a3.clock?.running = false
        check(Broadcast.differs(a3, from: a0, after: 0), "the clock stopping (a stall, a whistle) does")

        // Polymarket: a tick at its own time shows once p reaches it, and the chart is scheduled to redraw then.
        var clock = PresentationClock()
        clock.update(now: 1000, inputs: .init(target: 50, cap: .infinity, quietUntil: nil))
        let ticks = [Date(timeIntervalSince1970: 940), Date(timeIntervalSince1970: 955), Date(timeIntervalSince1970: 990)]
        let points = ticks.enumerated().map { OddsPoint(t: $0.element, p: 0.5 + Double($0.offset) / 10) }
        let p = Date(timeIntervalSince1970: clock.p(at: 1000))
        check(OddsChartData.shown(points, until: p).map(\.p) == [0.5], "at p (950) only the tick from before it shows")
        let schedule = OddsSection.schedule(ticks, clock: clock, now: Date(timeIntervalSince1970: 1000))
        check(schedule.count == 3 && abs(schedule[1].timeIntervalSince1970 - 1005.01) < 1e-6 && abs(schedule[2].timeIntervalSince1970 - 1040.01) < 1e-6,
              "the chart redraws when p reaches each tick (scheduled, not polled)", "\(schedule.map(\.timeIntervalSince1970))")
    }
}

// MARK: - The other sports' lanes, end to end

extension ScorelineTests {
    /// A fixture's plays arriving `lag` seconds after their own time, read as
    /// the core lane every 5 s, through the engine (synthetic arrival: these
    /// test the lanes and the timeline, not the feed's lag, which the weekend's
    /// recordings measure).
    static func synthetic(_ items: [JSON], sport: BroadcastSport, path: String = "", lag: Double = 40)
        -> (told: [GameTimeline<RawPlay>.Record], engine: BroadcastEngine<RawPlay>, order: [String]) {
        let policy = BroadcastLanes.policy(sport, path: path)
        var engine = BroadcastEngine<RawPlay>(sport: sport, policy: policy)
        let entries = BroadcastLanes.entries(items, sport: sport, policy: policy)
        let times = entries.compactMap(\.wallclock)
        guard let first = times.min(), let last = times.max() else { return ([], engine, []) }
        var told: [GameTimeline<RawPlay>.Record] = []
        var t = first + lag
        while t <= last + lag + 60 {
            // The lane's tail as of t: every play up to the newest that has arrived (in game order).
            if let newest = entries.lastIndex(where: { ($0.wallclock ?? .infinity) + lag <= t }) {
                engine.ingest(LaneSnapshot(lane: .core, entries: Array(entries[...newest]), coverage: .tail, arrived: t))
            } else {
                engine.noteRead(.core, at: t)
            }
            told += engine.advance(now: t).told
            var w = t
            while let next = engine.nextWake(after: w), next < t + 5 {
                w = next
                told += engine.advance(now: w).told
            }
            t += 5
        }
        return (told, engine, entries.map(\.id))
    }

    static func broadcastSports() {
        // Football: Monday night's DAL at PHI, a quarter of snaps.
        let football = broadcastFixture("mnf-dal-phi-plays.json")["items"].array
        let fb = synthetic(Array(football.prefix(60)), sport: .football, path: "football/nfl")
        let fbOrder = fb.told.filter { $0.told != .history && $0.told != .correction }.map(\.id)
        check(!fbOrder.isEmpty && fbOrder == fb.order.filter { fbOrder.contains($0) }, "football: snaps are told in sequence order",
              "\(fbOrder.count) told")
        let fbLast = fb.engine.timeline.records.last { $0.entry.score != nil }?.entry.score
        check(fb.engine.presented(at: fb.engine.clock.p(at: .infinity)).score == fbLast || fb.engine.timeline.presentedScore(at: .infinity) == fbLast,
              "football: the presented score is the last told snap's")
        let incomplete = fb.engine.timeline.records.first { $0.entry.payload.json["type"]["id"].string == "3" && $0.isTold }
        if let incomplete, let i = fb.engine.timeline.position(of: incomplete.id), i + 1 < fb.engine.timeline.records.count {
            let clock = PresentedGame.clock(at: incomplete.presentAt + 0.5, last: incomplete, timeline: fb.engine.timeline, policy: fb.engine.policy)
            check(clock?.running == false, "football: the clock stops after an incompletion")
        } else {
            check(false, "football: the clock stops after an incompletion", "no incompletion told")
        }

        // Soccer: Villa v City's core plays (every touch, with its wallclock).
        let pages = ["1bbb58f9c1945678542dc53d", "8e8f4e473432cfae635da5d1"]
        let soccer = pages.flatMap { broadcastFixture("\($0).bin")["items"].array }
        let sc = synthetic(Array(soccer.prefix(300)), sport: .soccer, path: "soccer/eng.1")
        let scOrder = sc.told.filter { $0.told != .history && $0.told != .correction }.map(\.id)
        check(scOrder.count > 100 && scOrder == sc.order.filter { scOrder.contains($0) }, "soccer: entries are told in the feed's order",
              "\(scOrder.count)")
        let minute = sc.engine.presented(at: sc.engine.p(at: (soccer.prefix(300).last.flatMap { EventTime.parse($0["wallclock"].string) } ?? 0) + 40))
        check(minute.status(.soccer, regulationPeriods: 2).hasSuffix("'"), "soccer: the presented clock reads as a minute",
              minute.status(.soccer, regulationPeriods: 2))

        // Baseball: World Series Game 4's ESPN plays (half-innings as periods, no game clock).
        let baseball = broadcastFixture("ws-g4-plays.json")["items"].array
        let bb = synthetic(Array(baseball.prefix(120)), sport: .baseball, path: "baseball/mlb")
        let bbOrder = bb.told.filter { $0.told != .history && $0.told != .correction }.map(\.id)
        check(!bbOrder.isEmpty && bbOrder == bb.order.filter { bbOrder.contains($0) }, "baseball: pitches and results are told in order")
        let inning = bb.engine.presented(at: bb.engine.p(at: .infinity))
        // MLB's own times joined to ESPN's plays (World Series Game 5: ESPN's plays and MLB's feed of the same game).
        let g5 = broadcastFixture("ws-g5-plays.json")["items"].array
        let espn = BroadcastLanes.entries(g5, sport: .baseball, policy: BroadcastLanes.policy(.baseball))
        let plates = BroadcastLanes.plateTimes(statsapi: broadcastFixture("statcast-849799.json"))
        let joined = BroadcastLanes.timed(espn, with: plates)
        var gaps: [Double] = []
        for (before, after) in zip(espn, joined) where after.reportedSource == .statsapi {
            if let w = before.wallclock, let t = after.wallclock { gaps.append(w - t) }
        }
        check(gaps.count > 100 && abs(Stats.quantile(gaps, 0.5)) < 3 && gaps.allSatisfy { abs($0) < 60 },
              "baseball: MLB's pitch times join ESPN's plays by half-inning and at-bat (ESPN trails by a second or so)",
              "\(gaps.count) joined, p50 \(Stats.quantile(gaps, 0.5)), max \(gaps.map(abs).max() ?? 0)")
        check(BroadcastLanes.timed(espn, with: [:]) == espn, "baseball: without MLB's feed, ESPN's times stand")
        check(inning.status(.baseball, regulationPeriods: 18).hasPrefix("Top") || inning.status(.baseball, regulationPeriods: 18).hasPrefix("Bot")
              || inning.status(.baseball, regulationPeriods: 18).hasPrefix("Mid") || inning.status(.baseball, regulationPeriods: 18).hasPrefix("End"),
              "baseball: the status is the half-inning", inning.status(.baseball, regulationPeriods: 18))
    }

    static func broadcastFixture(_ name: String) -> JSON {
        JSON(data: (try? Data(contentsOf: URL(fileURLWithPath: "Tests/Fixtures/\(name)"))) ?? Data())
    }
}


// MARK: - The floor

extension ScorelineTests {
    /// Opening a page on a game whose scoreboard is ahead of p: the hero never
    /// shows less than the user had already seen; p's own score takes over once
    /// it gets there; an overturn or the timeout lets it go.
    static func broadcastFloor() {
        check(Broadcast.shown(ScoreLine(home: 2, away: 3), floor: ScoreLine(home: 4, away: 1)) == ScoreLine(home: 4, away: 3)
              && Broadcast.shown(ScoreLine(home: 2, away: 3), floor: nil) == ScoreLine(home: 2, away: 3),
              "shown per side: max(p's score, the floor)")
        let plays = [
            nbaPlay("f1", at: 1000, clock: "11:00", type: 92, text: "Home makes layup", home: 2, away: 0, shooting: true, scoring: true, team: "2"),
            nbaPlay("f2", at: 1010, clock: "10:50", type: 92, text: "Away makes three", home: 2, away: 3, shooting: true, scoring: true),
            nbaPlay("f3", at: 1050, clock: "10:10", type: 92, text: "Home makes jumper", home: 4, away: 3, shooting: true, scoring: true, team: "2"),
            nbaPlay("f4", at: 1080, clock: "9:40", type: 92, text: "Away makes jumper", home: 4, away: 5, shooting: true, scoring: true),
            nbaPlay("f5", at: 1095, clock: "9:25", type: 92, text: "Home makes dunk", home: 6, away: 5, shooting: true, scoring: true, team: "2"),
        ]
        let policy = BroadcastLanes.policy(.basketball, path: NBADetail.path)
        func page(scoreboard away: String, _ home: String) -> (Broadcast, Event, () -> PTime, (PTime) -> Void) {
            var now: PTime = 1100
            let b = Broadcast()
            b.automatic = false
            b.time = BroadcastTime(now: { now })
            let event = Event(id: "espn-f", content: .match(top: comp("espn-basketball-1", "Away", away), bottom: comp("espn-basketball-2", "Home", home)),
                              state: .live, start: .now, detail: "9:40 - 1st", caption: nil, link: nil,
                              ref: .espn(path: NBADetail.path, id: "f", sport: .basketball))
            return (b, event, { now }, { now = $0 })
        }
        func summary(_ upTo: Int) -> GameDetail {
            var d = GameDetail()
            d.topIsHome = false
            d.broadcastPlays = BroadcastLanes.entries(Array(plays.prefix(upTo)), sport: .basketball, policy: policy)
            return d
        }
        func scores(_ b: Broadcast, _ e: Event) -> [String?] { b.present(e).competitors.map(\.score) }

        // The scoreboard (and the menu bar, the list) showed Away 5, Home 4 when the page opened; p is at 3–2.
        let (b, event, now, setNow) = page(scoreboard: "5", "4")
        b.begin(event, topIsHome: false)
        b.ingest(summary: summary(2))
        check(b.presented.score == ScoreLine(home: 2, away: 3) && scores(b, event) == ["5", "4"],
              "opening behind the scoreboard: the hero keeps what the user saw (5–4), not p's 3–2", "\(scores(b, event))")
        var shown: [[String?]] = [scores(b, event)]
        setNow(1101)
        b.ingest(core: plays)
        // The lane read every 5 s (as the app does), the model stepped at its own wakes between.
        var t = now()
        while t < 1200 {
            let read = (t / 5).rounded(.down) * 5 + 5
            let next = min(b.engine?.nextWake(after: t) ?? .infinity, read)
            t = next
            setNow(t)
            if t == read { b.noteRead() } else { b.step() }
            shown.append(scores(b, event))
        }
        _ = now()
        let away = shown.compactMap { $0.first ?? nil }.compactMap(Int.init), home = shown.compactMap { $0.last ?? nil }.compactMap(Int.init)
        check(zip(away, away.dropFirst()).allSatisfy { $0 <= $1 } && zip(home, home.dropFirst()).allSatisfy { $0 <= $1 },
              "the shown score never steps back, side by side", "\(shown)")
        check(b.floor == nil && scores(b, event) == ["5", "6"], "p's score reached the floor: it's gone, and p's own scores show from then",
              "\(scores(b, event)) floor \(String(describing: b.floor))")
        check(shown.contains { $0 == ["5", "4"] } && !shown.contains { $0 == ["3", "4"] || $0 == ["3", "2"] },
              "while it stood, nothing below it showed")

        // A genuine overturn: the scoreboard takes its own score back; the floor goes with it.
        let (o, oEvent, _, setO) = page(scoreboard: "5", "4")
        o.begin(oEvent, topIsHome: false)
        o.ingest(summary: summary(2))
        setO(1102)
        o.observe(scoreboard: oEvent)
        setO(1132)
        o.observe(scoreboard: oEvent.with(content: .match(top: comp("espn-basketball-1", "Away", "3"), bottom: comp("espn-basketball-2", "Home", "4"))))
        check(o.floor == nil && scores(o, oEvent) == ["3", "2"], "the scoreboard correcting downward lets the floor go (p's score shows)",
              "\(scores(o, oEvent))")

        // The timeout: a floor p never reaches lapses after two minutes.
        let (q, qEvent, _, setQ) = page(scoreboard: "9", "9")
        q.begin(qEvent, topIsHome: false)
        q.ingest(summary: summary(2))
        var held = true
        for t in stride(from: 1105.0, through: 1100 + Broadcast.floorTimeout + 1, by: 5) {
            setQ(t)
            q.noteRead()
            if t < 1100 + Broadcast.floorTimeout - 1 { held = held && q.floor != nil }
        }
        setQ(1100 + Broadcast.floorTimeout + 1)
        q.noteRead()
        check(held && q.floor == nil, "a floor that p never reaches lapses after \(Int(Broadcast.floorTimeout)) s")
    }
}


// MARK: - The recorder's newer lanes

extension ScorelineTests {
    /// `status.jsonl` (the core status, each change) and soccer's `core/`
    /// looks (`{count, offset, items}`), on the synthetic Villa v City fixture
    /// (real entries, synthetic arrival; Tests/Fixtures/broadcast/soccer_eng.1).
    static func broadcastRecorderLanes() {
        // A status row reads as the app reads the core status.
        let row = JSON(["at": 100, "clock": 252.0, "displayClock": "4:12", "period": 3, "state": "in", "detail": "4:12 - 3rd Quarter"] as [String: Any])
        let nba = BroadcastLanes.policy(.basketball, path: NBADetail.path)
        let reading = BroadcastLanes.reading(status: Recording.status(row), policy: nba, previous: nil, at: 100)
        check(reading?.elapsed == 720 - 252 && reading?.period == 3 && reading?.state == .live && reading?.source == "status",
              "a status.jsonl row reads as the core status (clock, period, state)")
        let end = JSON(["at": 200, "clock": 0.0, "displayClock": "0.0", "period": 3, "state": "in", "detail": "End of 3rd Quarter"] as [String: Any])
        check(BroadcastLanes.reading(status: Recording.status(end), policy: nba, previous: reading, at: 200)?.state == .interval,
              "…and an end of period reads as an interval")

        let root = URL(fileURLWithPath: "Tests/Fixtures/broadcast")
        let recording = Recording.load(root: root, sport: "soccer_eng.1", event: "401879256", settle: 0)
        check(recording.core.count > 40 && recording.status.count > 40 && recording.snapshots.isEmpty,
              "the loader reads soccer's core looks and status rows", "\(recording.core.count) core, \(recording.status.count) status")
        guard let first = recording.core.first, let look = recording.coreLook(first) else { return check(false, "a core look decompresses") }
        check(look["count"].int != nil && look["offset"].int != nil && !look["items"].array.isEmpty, "a core look is {count, offset, items}")
        guard var replay = RecordingReplay(recording) else { return check(false, "the soccer recording replays") }
        var told: [GameTimeline<RawPlay>.Record] = []
        var statusReadings = 0
        replay.run(.app(replay.policy)) { replay, _, step, _ in
            told += step.told
            statusReadings = replay.engine.timeline.fast.readings.filter { $0.source == "status" }.count
        }
        let timeline = replay.engine.timeline
        let onTime = told.filter { $0.told == .onTime || $0.told == .late }.map(\.id)
        let order = timeline.records.map(\.id)
        check(onTime.count > 30 && onTime == order.filter { onTime.contains($0) }, "soccer's core lane: entries told in the feed's order",
              "\(onTime.count) told")
        check(timeline.records.contains { $0.entry.payload.json["scoringPlay"].bool == true && $0.isTold }
              && timeline.presentedScore(at: .infinity).map { $0.home + $0.away >= 1 } == true, "the goal is told, with its score")
        check(statusReadings > 20, "the status lane comes from status.jsonl", "\(statusReadings)")
        // Revisions and removals across looks merge by ID, the newest version winning.
        check(timeline.records.allSatisfy { r in r.entry.wallclock != nil }, "every entry keeps its wallclock across looks")
    }
}
