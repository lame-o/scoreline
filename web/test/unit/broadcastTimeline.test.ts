/**
 * The game as one broadcast (BROADCAST.md "How it's proven"; Tests/
 * BroadcastTests.swift, ported check by check with the Mac's numbers): the
 * timeline's ingest (duplicates, out-of-order arrival, revisions, removals,
 * missing event times), the watermark, the presentation clock (slewing bounds,
 * stall, catch-up, jump, skip), the presented state at chosen times, the
 * lanes, the recording loader and replay on a real NBA slice
 * (Tests/Fixtures/broadcast), what the theater plans from, VAR, jumps, the
 * behind-live readout and our own outages. The page's model is
 * broadcastPage.test.ts.
 */
import { mkdirSync, copyFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { behindFromClock, behindSpoken, behindText, behindLive } from "../../src/data/broadcast/behindLive";
import { BroadcastEngine, mapSnapshot, type TimelineSnapshot } from "../../src/data/broadcast/engine";
import { basketball, entries, football, isInterval, policy as sportPolicy, readingFromEvent, readingFromStatus, soccer } from "../../src/data/broadcast/lanes";
import { PresentationClock, sameClockEvent, type ClockEvent } from "../../src/data/broadcast/presentationClock";
import { NOTHING_PRESENTED, presentedAt, presentedClock, presentedStatus, nextChange, type PresentedGame } from "../../src/data/broadcast/presentedGame";
import { GameTimeline, parseEventTime, playKind, quantile, type ScoreCorrection, type RawPlay, type TellReason, type TimelineRecord } from "../../src/data/broadcast/timeline";
import { NBA_PATH } from "../../src/data/basketball";
import type { ScoreEvent } from "../../src/data/models";
import { arr, at, bool, str } from "../../src/data/json";
import { look, play, S, testPolicy } from "./broadcastHelpers";
import { appCadence, FIXTURES, Recording, RecordingReplay } from "./broadcastReplay";
import { sharedFixture } from "./fixtures";

const hasEvent = (events: readonly ClockEvent[], e: ClockEvent) => events.some((x) => sameClockEvent(x, e));
const ids = <P>(records: readonly TimelineRecord<P>[]) => records.map((r) => r.entry.id);

describe("Broadcast: timeline", () => {
  it("ingest: duplicates, out-of-order arrival, revisions, removals, late insertions", () => {
    // Duplicates: the same look twice changes nothing.
    const t = new GameTimeline<RawPlay>(testPolicy());
    const a = play("a", 100, { elapsed: 10 });
    const b = play("b", 110, { elapsed: 20, score: S(2, 0) });
    const first = t.ingest(look([a, b], "summary", 140));
    const revision = t.revision;
    const again = t.ingest(look([a, b], "summary", 145));
    expect(first.added, "a duplicate look changes nothing").toEqual(["a", "b"]);
    expect(again.added.length + again.revised.length + again.removed.length + again.lateInsertions.length).toBe(0);
    expect(t.revision).toBe(revision);

    // Out of order: a stale summary (older content, later arrival) never undoes a fresher core read.
    const o = new GameTimeline<RawPlay>(testPolicy());
    const c = play("c", 120, { elapsed: 30 });
    const d = play("d", 125, { elapsed: 35 });
    o.ingest(look([b, c, d], "core", 150, "tail"));
    o.ingest(look([a, b], "summary", 160));
    expect(ids(o.records), "a stale full look fills in behind a fresher window, removes nothing").toEqual(["a", "b", "c", "d"]);
    // Arriving the other way round: the same game.
    const r = new GameTimeline<RawPlay>(testPolicy());
    r.ingest(look([a, b], "summary", 140));
    r.ingest(look([b, c, d], "core", 150, "tail"));
    expect(ids(r.records), "a window merges after the summary it extends").toEqual(["a", "b", "c", "d"]);
    // A stale copy of a lane (its newest play older than the lane's last look) is ignored.
    const stale = r.ingest(look([b, c], "core", 155, "tail"));
    expect(stale.added.length + stale.revised.length + stale.removed.length, "an older copy of a lane changes nothing").toBe(0);
    expect(ids(r.records)).toEqual(["a", "b", "c", "d"]);

    // Revisions: by ID, newest content wins; a version seen before never comes back.
    const v = new GameTimeline<RawPlay>(testPolicy());
    v.ingest(look([a, play("b", 110, { elapsed: 20, text: "misses shot" })], "summary", 140));
    const revised = v.ingest(look([a, play("b", 110, { elapsed: 20, text: "misses 26-foot three", version: 1 })], "summary", 150));
    expect(revised.revised, "a revision replaces the play by ID").toEqual(["b"]);
    expect(v.record("b")?.entry.text).toBe("misses 26-foot three");
    expect(v.record("b")?.revisions).toBe(1);
    const regress = v.ingest(look([a, play("b", 110, { elapsed: 20, text: "misses shot" })], "summary", 151));
    expect(regress.revised, "a stale cache's older version never wins").toEqual([]);
    expect(v.record("b")?.entry.text).toBe("misses 26-foot three");
    // A revision to a told play is a quiet correction.
    v.tell(115);
    const told = v.ingest(look([a, play("b", 110, { elapsed: 20, text: "makes 26-foot three", version: 2 })], "summary", 160));
    expect(told.correctedTold, "a revision to a told play is a correction; it stays told").toEqual(["b"]);
    expect(v.isTold("b")).toBe(true);

    // Removals: gone from a newer full look; the score falls back; never once the lane can't have caught up.
    const m = new GameTimeline<RawPlay>(testPolicy());
    const s1 = S(2, 0);
    const s2 = S(2, 3);
    m.ingest(look([a, play("b", 110, { elapsed: 20, score: s1 }), play("c", 120, { elapsed: 30, score: s2 })], "summary", 150));
    m.tell(125);
    // The newest play gone looks like a stale cache at first: believed once the lane says so for 12 s.
    const pending = m.ingest(look([a, play("b", 110, { elapsed: 20, score: s1 })], "summary", 170));
    const removed = m.ingest(look([a, play("b", 110, { elapsed: 20, score: s1 })], "summary", 185));
    expect(pending.removed.length + pending.added.length, "a told play removed: a quiet correction, the score falls back").toBe(0);
    expect(m.knows("c")).toBe(false);
    expect(removed.removed).toEqual(["c"]);
    expect(removed.removedTold).toEqual(["c"]);
    expect(m.presentedScore(200)).toEqual(s1);
    // A play the core lane brought 3 s ago, absent from a summary whose content is up to 12 s old: kept.
    const k = new GameTimeline<RawPlay>(testPolicy());
    k.ingest(look([a, b], "summary", 140));
    k.ingest(look([b, c], "core", 150, "tail"));
    const fresh = k.ingest(look([a, b, play("e", 126, { elapsed: 36 })], "summary", 153));
    expect(fresh.removed, "a lane that hasn't caught up with a play doesn't remove it").toEqual([]);
    expect(k.knows("c")).toBe(true);
    // Flickering back: a told play removed and restored isn't told again.
    const f = new GameTimeline<RawPlay>(testPolicy());
    f.ingest(look([a, b], "summary", 140));
    f.tell(115);
    f.ingest(look([a], "summary", 170));
    f.ingest(look([a, b], "summary", 180));
    expect(f.isTold("b"), "a told play that flickers back stays told").toBe(true);
    expect(f.tell(200)).toEqual([]);

    // Late insertion behind told plays: told at once, late (a backdated substitution).
    const l = new GameTimeline<RawPlay>(testPolicy());
    l.ingest(look([a, c], "summary", 140));
    l.tell(125);
    const late = l.ingest(look([a, play("sub", 101, { elapsed: 10, live: false, label: "substitution" }), c], "summary", 300));
    expect(late.lateInsertions, "a play inserted behind told ones attaches quietly (a correction); told stays a prefix").toEqual(["sub"]);
    expect(l.record("sub")?.told).toBe("correction");
    expect(l.toldCount).toBe(3);
    // Told: on time at its moment; late once the clock had passed it before it arrived.
    // (The opening look is history; the plays after it are news.)
    const o0 = play("o", 60, { elapsed: 1 });
    const n = new GameTimeline<RawPlay>(testPolicy());
    n.ingest(look([o0], "summary", 70));
    n.ingest(look([o0, a, b], "summary", 150));
    expect(
      n.tell(110.5).map((x) => x.told),
      "the opening look is history; a play the clock passed by more than 1.5 s is late",
    ).toEqual(["history", "late", "onTime"] satisfies TellReason[]);
    const q = new GameTimeline<RawPlay>(testPolicy());
    q.ingest(look([o0], "summary", 70));
    q.ingest(look([o0, a, b], "summary", 140));
    expect(q.tell(100).map((x) => x.told), "a play told at its moment is on time").toEqual(["history", "onTime"]);
    expect(q.tell(110).map((x) => x.told)).toEqual(["onTime"]);
  });

  it("event times: estimated, monotone, batches spread back, wallclocks parsed", () => {
    const t = new GameTimeline<RawPlay>(testPolicy());
    // Missing wallclock: between its neighbors by the game clock (10 of 20 game seconds → halfway).
    t.ingest(look([play("a", 100, { elapsed: 10 }), play("b", null, { elapsed: 20 }), play("c", 120, { elapsed: 30 })], "summary", 150));
    expect(Math.abs((t.record("b")?.eventTime ?? 0) - 110), "a missing event time is estimated from the game clock between neighbors").toBeLessThan(0.01);
    expect(t.record("b")?.estimated).toBe(true);
    // Wallclock going backwards (a dead-ball cluster): presented right after the play before, never back in time.
    const b = new GameTimeline<RawPlay>(testPolicy());
    b.ingest(look([play("ft", 200, { elapsed: 400, live: false }), play("sub", 180, { elapsed: 400, live: false }), play("ft2", 215, { elapsed: 400, live: false })], "summary", 300));
    expect(b.records.map((r) => r.presentAt), "presentation times are event times made monotone").toEqual([200, 200, 215]);
    // A batch logged at one wallclock across a long stretch of game clock (college football): spread back.
    const c = new GameTimeline<RawPlay>(testPolicy());
    c.ingest(
      look(
        [play("p0", 1000, { elapsed: 100 }), play("p1", 1200, { elapsed: 140 }), play("p2", 1200, { elapsed: 180 }), play("p3", 1200, { elapsed: 220 })],
        "summary",
        1300,
      ),
    );
    const spread = c.records.map((r) => r.eventTime);
    expect(spread[1]! < spread[2]! && spread[2]! < spread[3]!, "a batched logging time is spread back by the game clock").toBe(true);
    expect(Math.abs(spread[1]! - 1066.7)).toBeLessThan(1);
    // EventTime parses ESPN's wallclock (and offsets) without a formatter.
    expect(parseEventTime("2026-10-31T04:49:18Z"), "wallclock parses to epoch seconds").toBe(1_793_422_158);
    expect(parseEventTime("2026-10-31T04:49:18Z")).toBe(Date.parse("2026-10-31T04:49:18Z") / 1000);
    expect(parseEventTime("2026-10-31T04:49:18.250Z"), "fractional seconds and offsets parse").toBe(1_793_422_158.25);
    expect(parseEventTime("2026-10-30T21:49:18-07:00")).toBe(1_793_422_158);
  });
});

describe("Broadcast: watermark", () => {
  it("freshness, quiet, the fast lane's stopped clock, the floor", () => {
    // Freshness: the last read less the lag quantile; it moves while reads succeed and freezes when they stop.
    const t = new GameTimeline<RawPlay>(testPolicy());
    t.ingest(look([play("a", 100, { elapsed: 10 })], "summary", 100)); // opening look: says nothing about lag
    t.ingest(look([play("a", 100, { elapsed: 10 }), play("b", 110, { elapsed: 20 })], "summary", 135)); // lag 25
    expect(Math.abs(t.lagQuantile - 25), "the lag quantile is measured from live plays at the frontier").toBeLessThan(0.01);
    // The network guard: the last read plus three read intervals (5 s), less the lag quantile.
    let k = t.knowledge(135);
    expect(k.bound, "the network guard: the last read, plus three reads, less the lag").toBe("freshness");
    expect(Math.abs(k.frontier - 125)).toBeLessThan(0.01);
    t.noteRead("summary", 140);
    t.noteRead("summary", 145);
    k = t.knowledge(145);
    expect(Math.abs(k.frontier - 135), "reads with nothing new still move it").toBeLessThan(0.01);
    k = t.knowledge(400);
    expect(Math.abs(k.frontier - 135), "no reads: it stands still (the clock will stall rather than guess)").toBeLessThan(0.01);
    // Quiet: a running game can't go silent past the sport's allowance.
    t.noteRead("summary", 300);
    k = t.knowledge(300);
    expect(k.bound, "silence past the quiet allowance caps it").toBe("quiet");
    expect(Math.abs(k.frontier - 170)).toBeLessThan(0.01);
    // A stopped clock at the newest play's clock (a timeout) confirms the quiet.
    t.observe({ arrived: 200, state: { kind: "live" }, period: 1, elapsed: 20, running: false, score: null, source: "status" });
    t.observe({ arrived: 260, state: { kind: "live" }, period: 1, elapsed: 20, running: false, score: null, source: "status" });
    t.noteRead("summary", 400);
    k = t.knowledge(400);
    expect(Math.abs(k.frontier - (260 - t.fastLag + 60)), "the fast lane's stopped clock confirms quiet; the allowance runs from it").toBeLessThan(0.01);
    // The floor: the newest live play less the insertion allowance.
    const f = new GameTimeline<RawPlay>(testPolicy());
    f.ingest(look([play("a", 100, { elapsed: 10 })], "summary", 101));
    f.ingest(look([play("a", 100, { elapsed: 10 }), play("b", 150, { elapsed: 60 })], "summary", 152));
    expect(f.knowledge(152).frontier, "the newest live play less the allowance is always known").toBeGreaterThanOrEqual(146 - 1e-9);
  });

  it("an unexplained fast-lane score: the order guard, the hold, free throws, the safety net", () => {
    // An unexplained fast-lane score: the order guard at the tell, at the last reading the plays explain
    // (with the hold on, the watermark itself stops there).
    const holding = testPolicy();
    holding.holdForUnexplainedScores = true;
    const u = new GameTimeline<RawPlay>(holding);
    const s0 = S(10, 10);
    const s1 = S(12, 10);
    u.ingest(look([play("a", 100, { elapsed: 10, score: s0 })], "summary", 101));
    u.observe({ arrived: 120, state: { kind: "live" }, period: 1, elapsed: 40, running: true, score: s0, source: "scoreboard" });
    u.observe({ arrived: 150, state: { kind: "live" }, period: 1, elapsed: 70, running: true, score: s1, source: "scoreboard" });
    u.noteRead("summary", 200);
    let k = u.knowledge(200);
    expect(k.bound, "a score no play explains holds the watermark before it (after the last play with the old score)").toBe("unexplainedScore");
    expect(Math.abs(k.frontier - 100)).toBeLessThan(0.01);
    // The play arrives: released.
    u.ingest(look([play("a", 100, { elapsed: 10, score: s0 }), play("b", 130, { elapsed: 40, score: s1 })], "summary", 205));
    expect(u.knowledge(205).bound, "the scoring play's arrival releases it").not.toBe("unexplainedScore");
    const guarded = new GameTimeline<RawPlay>(testPolicy());
    guarded.ingest(look([play("a", 100, { elapsed: 10, score: s0 })], "summary", 101));
    guarded.observe({ arrived: 120, state: { kind: "live" }, period: 1, elapsed: 40, running: true, score: s0, source: "scoreboard" });
    guarded.observe({ arrived: 150, state: { kind: "live" }, period: 1, elapsed: 70, running: true, score: s1, source: "scoreboard" });
    guarded.noteRead("summary", 200);
    expect(guarded.knowledge(200).bound, "by default the clock keeps time and the tell waits at the guard instead").not.toBe("unexplainedScore");
    expect(Math.abs((guarded.tellBarrier ?? 0) - 100)).toBeLessThan(0.01);
    // Plays that still carry the old score precede the basket; one without a score after them waits.
    guarded.ingest(
      look(
        [play("a", 100, { elapsed: 10, score: s0 }), play("c", 110, { elapsed: 20, score: s0 }), play("d", 140, { elapsed: 50, score: s0 }), play("e", 146, { elapsed: 56 })],
        "summary",
        205,
      ),
    );
    const barred = guarded.tell(150, { barrier: guarded.tellBarrier ?? Infinity });
    expect(ids(barred), "nothing past the guard is told before the score's play").toEqual(["a", "c", "d"]);
    expect(guarded.isTold("e")).toBe(false);
    // Free throws while the clock is stopped at the foul: through the stoppage, not past the restart.
    const ft = new GameTimeline<RawPlay>(holding);
    ft.ingest(look([play("foul", 100, { elapsed: 400, live: false, stops: true, score: s0 })], "summary", 101));
    ft.observe({ arrived: 120, state: { kind: "live" }, period: 1, elapsed: 400, running: false, score: s0, source: "scoreboard" });
    ft.observe({ arrived: 150, state: { kind: "live" }, period: 1, elapsed: 400, running: false, score: s1, source: "scoreboard" });
    ft.noteRead("summary", 160);
    expect(ft.knowledge(160).bound, "free throws during a stoppage don't hold the clock while it's stopped").not.toBe("unexplainedScore");
    ft.observe({ arrived: 165, state: { kind: "live" }, period: 1, elapsed: 403, running: true, score: s1, source: "scoreboard" });
    k = ft.knowledge(170);
    expect(k.bound, "…but they do once the clock runs again").toBe("unexplainedScore");
    expect(Math.abs(k.frontier - (150 - ft.fastLag))).toBeLessThan(0.01);

    // The safety net: applied once p is the grace past the score's latest moment, retired by the play.
    const e = new BroadcastEngine<RawPlay>("basketball", testPolicy());
    e.ingest(look([play("a", 100, { elapsed: 10, score: s0 })], "summary", 140));
    e.observe({ arrived: 140, state: { kind: "live" }, period: 1, elapsed: 40, running: true, score: s0, source: "scoreboard" });
    e.advance(140);
    e.observe({ arrived: 145, state: { kind: "live" }, period: 1, elapsed: 45, running: true, score: s1, source: "scoreboard" });
    let applied: ScoreCorrection | null = null;
    let now = 145;
    while (now < 260 && applied == null) {
      e.noteRead("summary", now);
      applied = e.advance(now).correction;
      now += 5;
    }
    expect(applied?.score, "the safety net applies the fast lane's score after the grace").toEqual(s1);
    expect(e.timeline.safetyNetApplied).toBe(1);
    const shown = e.presented(now + 30).score;
    expect(shown?.home === s1.home || e.timeline.presentedScore(Infinity)?.home === s1.home, "and the presented score has it").toBe(true);
    e.ingest(look([play("a", 100, { elapsed: 10, score: s0 }), play("b", 120, { elapsed: 30, score: s1 })], "summary", now));
    expect(e.timeline.corrections, "the play's arrival retires the correction").toEqual([]);
  });
});

describe("Broadcast: presentation clock", () => {
  it("opens at the live edge, slews within 0.92–1.08×, stalls, catches up, jumps, skips, stretches, wakes, inverts", () => {
    // Starts at the live edge.
    const c = new PresentationClock();
    c.update(1000, { target: 50, cap: 990 });
    expect(Math.abs(c.p(1000) - 950), "opens at the live edge (now − D)").toBeLessThan(1e-9);
    expect(sameClockEvent(c.events[0]!, { kind: "start", at: 1000, p: 950 })).toBe(true);
    const capped = new PresentationClock();
    capped.update(1000, { target: 50, cap: 900 });
    expect(Math.abs(capped.p(1000) - 900), "…or at the watermark, if that's earlier").toBeLessThan(1e-9);

    // Slewing: the target moves; the rate stays within 0.92–1.08; p is continuous and never goes back.
    const s = new PresentationClock();
    s.update(0, { target: 50, cap: Infinity });
    let minRate = 2;
    let maxRate = 0;
    let last = s.p(0);
    let continuous = true;
    const targets = [50, 58, 58, 44, 44, 52, 52, 52];
    for (let step = 1; step <= 300; step++) {
      const now = step * 2.5;
      const before = s.p(now);
      s.update(now, { target: targets[Math.min(Math.trunc(step / 20), targets.length - 1)]!, cap: now - 5 });
      if (Math.abs(s.p(now) - before) > 1e-6) continuous = false;
      for (let sub = 0; sub < 5; sub++) {
        const t = now + sub * 0.5;
        const r = s.rate(t);
        minRate = Math.min(minRate, r);
        maxRate = Math.max(maxRate, r);
        if (s.p(t) < last - 1e-9) continuous = false;
        last = s.p(t);
      }
    }
    expect(minRate, "the slew stays within 0.92–1.08×").toBeGreaterThanOrEqual(0.92 - 1e-9);
    expect(maxRate).toBeLessThanOrEqual(1.08 + 1e-9);
    expect(continuous && !s.events.some((e) => e.kind === "jump"), "p never jumps or goes back while slewing").toBe(true);
    expect(Math.abs(s.delay(750) - 52), "D settles on the target").toBeLessThan(0.5);

    // Stall: approaching the watermark it eases to a stop there, holds, and eases back up when it moves.
    const h = new PresentationClock();
    h.update(0, { target: 50, cap: -45 });
    h.update(1, { target: 50, cap: -40 });
    const approach = Array.from({ length: 40 }, (_, i) => h.p(1 + i * 0.25));
    expect(approach.every((p) => p <= -40 + 1e-9) && Math.abs(h.p(30) - -40) < 1e-9, "p never passes the watermark: it eases to it and holds").toBe(true);
    const rates = Array.from({ length: 40 }, (_, i) => h.rate(1 + i * 0.25));
    expect(rates.slice(1).every((r, i) => Math.abs(r - rates[i]!) < 0.3), "the approach decelerates smoothly").toBe(true);
    h.update(30, { target: 50, cap: -40 });
    expect(h.regime, "held at the watermark is a stall, timed").toBe("stalled");
    expect(h.stalled(40)).toBe(10);
    h.update(40, { target: 50, cap: 0 });
    expect(h.rate(40) === 0 && h.rate(40.5) > 0 && h.rate(40.5) < 1, "it eases back up when the watermark moves").toBe(true);
    expect(hasEvent(h.events, { kind: "resume", at: 40, held: 10 }), "the stall's end is logged with its length").toBe(true);

    // Catch-up: behind the target, 1.08× until it's reached, then 1×.
    const u = new PresentationClock();
    u.update(0, { target: 60, cap: Infinity });
    u.update(1, { target: 50, cap: Infinity });
    expect(
      Math.abs(u.rate(2) - 1.08) < 1e-9 && Math.abs(u.rate(200) - 1) < 1e-9 && Math.abs(u.delay(200) - 50) < 1e-6,
      "behind the target it catches up at 1.08×, then runs at 1×",
    ).toBe(true);

    // Jump: more than jumpMax behind, a declared jump to the live edge.
    const j = new PresentationClock();
    j.update(0, { target: 50, cap: -50 });
    for (let now = 10; now <= 90; now += 10) j.update(now, { target: 50, cap: -45 });
    j.update(100, { target: 50, cap: 60 });
    expect(hasEvent(j.events, { kind: "jump", at: 100, from: -45, to: 50 }) && Math.abs(j.p(100) - 50) < 1e-9, "far behind: a declared jump to the live edge").toBe(true);

    // Skip: behind, inside a stoppage with nothing to tell, the clock moves where nothing on screen changes.
    const k = new PresentationClock();
    k.update(0, { target: 50, cap: -50 });
    k.update(10, { target: 50, cap: 10, quietUntil: -42 });
    expect(hasEvent(k.events, { kind: "skip", at: 10, from: -50, to: -42 }), "behind in a stoppage, it skips across it").toBe(true);
    // Stretch: ahead of the target inside a stoppage, it holds still until D has grown to it.
    const st = new PresentationClock();
    st.update(0, { target: 40, cap: Infinity });
    st.update(5, { target: 50, cap: Infinity, quietUntil: 100 });
    expect(st.regime === "stretching" && st.rate(6) === 0 && Math.abs(st.delay(15) - 50) < 1e-9 && st.rate(16) === 1, "ahead in a stoppage, it holds until D reaches the target").toBe(true);
    // Wake: updates far apart (asleep, another page) go to the live edge.
    const w = new PresentationClock();
    w.update(0, { target: 50, cap: Infinity });
    w.update(500, { target: 50, cap: Infinity });
    expect(w.events.some((e) => e.kind === "wake"), "a long gap between updates is a wake").toBe(true);
    // The plan inverts: when p reaches a moment.
    const inv = new PresentationClock();
    inv.update(0, { target: 50, cap: Infinity });
    inv.update(1, { target: 45, cap: 30 });
    const reached = inv.wallReaching(0, 1);
    expect(reached != null && Math.abs(inv.p(reached) - 0) < 1e-6, "wall(reaching:) finds when p gets there").toBe(true);
    expect(inv.wallReaching(31, 1), "…and nil past where it holds").toBeNull();
  });
});

describe("Broadcast: presented state", () => {
  it("the score, the clock and the words at p", () => {
    const e = new BroadcastEngine<RawPlay>("basketball", testPolicy());
    const s1 = S(2, 0);
    const s2 = S(2, 3);
    // A shot at 1000 (clock 100 s played), a foul at 1020 (120, stops the clock), the inbound play at 1060 (125), a three at 1070 (135).
    const plays = [
      play("shot", 1000, { elapsed: 100, score: s1 }),
      play("foul", 1020, { elapsed: 120, live: false, stops: true, score: s1 }),
      play("drive", 1060, { elapsed: 125, score: s1 }),
      play("three", 1070, { elapsed: 135, score: s2 }),
    ];
    // The page opens on the first three; the three arrives right after (30 s after it happened).
    e.ingest(look(plays.slice(0, 3), "summary", 1100));
    e.ingest(look(plays, "summary", 1100));
    e.advance(1100);
    // Opened with D = (lag 30 + horizon 2) + margin 1 = 33: p = 1067, everything before told as history.
    const open = e.presented(1100);
    expect(Math.abs(e.p(1100) - 1067), "opens at the live edge with the past as history").toBeLessThan(1e-6);
    expect(open.told).toBe(3);
    expect(open.score).toEqual(s1);
    expect(e.timeline.records.slice(0, 3).every((r) => r.told === "history"), "plays before the open are history, never news").toBe(true);
    // The three is presented at its moment, with its score, not before.
    expect(e.nextWake(1100), "the next wake is the three's moment on p").toBe(1103);
    expect(e.presented(1102.9).score, "not told until the engine reaches it (the score waits for the play)").toEqual(s1);
    e.noteRead("summary", 1103);
    const step = e.advance(1103);
    expect(ids(step.told), "told at its moment: the score changes with it").toEqual(["three"]);
    expect(step.told[0]?.told).toBe("onTime");
    expect(e.presented(1103).score).toEqual(s2);
    // The clock: running between plays from the last, never past the next play's clock.
    const g = new GameTimeline<RawPlay>(testPolicy());
    g.ingest(look(plays, "summary", 1100));
    g.tell(1000);
    const running = presentedAt(1010, g).clock;
    expect(running?.running === true && Math.abs((running?.elapsed ?? 0) - 110) < 1e-9, "the game clock runs from the last play").toBe(true);
    expect(Math.abs((presentedAt(1030, g).clock?.elapsed ?? 0) - 120) < 1e-9 && presentedAt(1030, g).clock?.running === false, "…and stops at the next known play's clock").toBe(true);
    g.tell(1020);
    // Stopped after the foul; restarts 5 s before the inbound play so it reads 125 when that play comes.
    const stopped = presentedAt(1050, g).clock;
    const restarted = presentedAt(1057, g).clock;
    expect(stopped?.running === false && Math.abs((stopped?.elapsed ?? 0) - 120) < 1e-9, "a foul stops the clock").toBe(true);
    expect(restarted?.running === true && Math.abs((restarted?.elapsed ?? 0) - 122) < 1e-9, "it restarts in time to reach the next play's clock").toBe(true);
    expect(nextChange(1050, g), "the next change is the restart (scheduled, not polled)").toBe(1055);
    // Words.
    let word: PresentedGame = { ...NOTHING_PRESENTED, phase: { kind: "live" }, period: 3, clock: { period: 3, elapsed: 720 - 252, running: true, countsDown: true, length: 720 } };
    expect(presentedStatus(word, "basketball", 4), 'status: "4:12 - 3rd"').toBe("4:12 - 3rd");
    word = { ...word, clock: { ...word.clock!, elapsed: 720 - 33.8 } };
    expect(presentedStatus(word, "basketball", 4), "under a minute: tenths").toBe("33.8 - 3rd");
    word = { ...word, phase: { kind: "interval", period: 2 } };
    expect(presentedStatus(word, "basketball", 4), "intervals: Halftime, End of …").toBe("Halftime");
    expect(presentedStatus(word, "soccer", 2)).toBe("End of regular time");
    word = { ...word, phase: { kind: "live" }, period: 13 };
    expect(presentedStatus(word, "baseball", 18), "baseball: the half-inning").toBe("Top 7th");
    word = { ...word, period: 2, clock: { period: 2, elapsed: 5400 + 125, running: true, countsDown: false, length: 2700 } };
    expect(presentedStatus(word, "soccer", 2), "soccer: added time").toBe("90'+3'");
  });
});

describe("Broadcast: lanes", () => {
  it("each sport's plays read as kinds, clocks, scores and event times; the scoreboard as evidence", () => {
    const nba = sportPolicy("basketball", NBA_PATH);
    const shot = {
      id: "1",
      period: { number: 4 },
      clock: { displayValue: "4:12" },
      type: { id: "131", text: "Pullup Jump Shot" },
      shootingPlay: true,
      scoringPlay: true,
      homeScore: 100,
      awayScore: 98,
      wallclock: "2026-10-31T04:49:18Z",
      participants: [{ athlete: { id: "9" } }],
      text: "makes pullup",
    };
    const e = basketball(shot, nba);
    expect(
      e?.kind.phase === "live" && e.kind.label === "shot" && e.clock.elapsed === 720 - 252 && e.score?.home === 100 && e.score.away === 98 && e.wallclock === 1_793_422_158,
      "NBA: a shot is live, with its clock, score and event time",
    ).toBe(true);
    const late = { id: "2", period: { number: 4 }, clock: { displayValue: "1:12" }, type: { id: "92" }, shootingPlay: true, scoringPlay: true };
    expect(basketball(late, nba)?.kind.stopsClock, "a make in the last two minutes stops the clock").toBe(true);
    const ft = { id: "3", period: { number: 2 }, clock: { displayValue: "5:00" }, type: { id: "98", text: "Free Throw - 1 of 2" }, shootingPlay: true, text: "makes free throw 1 of 2" };
    expect(basketball(ft, nba)?.kind.phase, "free throws are dead-ball (they attach to the stoppage)").toBe("dead");
    const team = { id: "4", period: { number: 2 }, type: { id: "156" }, participants: [] };
    expect(basketball(team, nba)?.kind.label, "a team rebound (no player) is dead-ball").toBe("team rebound");
    const steal = { id: "5", period: { number: 2 }, type: { id: "63" }, participants: [{ athlete: { id: "1" } }, { athlete: { id: "2" } }] };
    const lost = { id: "6", period: { number: 2 }, type: { id: "87" }, participants: [{ athlete: { id: "1" } }] };
    expect(basketball(steal, nba)?.kind.stopsClock === false && basketball(lost, nba)?.kind.stopsClock === true, "a steal keeps the clock running; an out-of-bounds turnover stops it").toBe(true);
    const end = { id: "7", period: { number: 3 }, type: { id: "412", text: "End Period" } };
    expect(basketball(end, nba)?.kind.endsPeriod, "an end of period ends the period").toBe(3);
    // Football: snaps are live; admin dead; the clock stops after an incompletion.
    const fb = sportPolicy("football");
    const incomplete = {
      id: "10",
      sequenceNumber: "14500",
      period: { number: 1 },
      clock: { value: 804.0, displayValue: "13:24" },
      type: { id: "3", text: "Pass Incompletion" },
      start: { yardLine: 39 },
      end: { yardLine: 39 },
      text: "pass incomplete",
    };
    const timeout = { id: "11", sequenceNumber: "14600", period: { number: 1 }, type: { id: "21", text: "Timeout" } };
    const snaps = entries([timeout, incomplete], "football", fb);
    expect(
      snaps.map((x) => x.id).join() === "10,11" && snaps[0]!.kind.phase === "live" && snaps[0]!.kind.stopsClock && snaps[1]!.kind.phase === "dead" && snaps[0]!.clock.elapsed === 96,
      "football: ordered by sequence; an incompletion stops the clock; a timeout is dead-ball",
    ).toBe(true);
    // The fast lane: the scoreboard as evidence (a running clock from two readings).
    const event: ScoreEvent = {
      id: "espn-1",
      content: { kind: "match", top: comp("a", "A", "98"), bottom: comp("h", "H", "100") },
      state: "live",
      start: Date.now(),
      detail: "4:12 - 4th",
      caption: null,
      link: null,
      ref: null,
      stage: null,
      clock: { seconds: 252, sampledAt: Date.now(), period: 4, direction: "down", display: "4:12 - 4th", running: true },
      possession: null,
      liveLine: null,
      liveLineRoutine: false,
      broadcast: null,
      venue: null,
      snapshot: null,
    };
    const r1 = readingFromEvent(event, false, nba, null, 100);
    const r2 = readingFromEvent({ ...event, clock: { ...event.clock!, seconds: 240, display: "4:00 - 4th" } }, false, nba, r1, 130);
    expect(r1?.score, "the scoreboard reads as home/away score and a running clock").toEqual(S(100, 98));
    expect(r2?.running).toBe(true);
    expect(r2?.elapsed).toBe(480);
    expect(isInterval("End of 3rd") && isInterval("Halftime") && isInterval("Mid 7th") && !isInterval("4:12 - 3rd"), "intervals are recognized from the status text").toBe(true);
  });
});

describe("Broadcast: recordings", () => {
  it("the loader skips files still being written and a half-written last line", () => {
    const scratch = join(tmpdir(), `broadcast-${Math.random().toString(36).slice(2)}`);
    const game = join(scratch, "basketball_nba", "1");
    mkdirSync(game, { recursive: true });
    writeFileSync(join(scratch, "basketball_nba", "scores.jsonl"), '{"at": 1, "event": "1", "state": "in"}\n{"at": 2, "event": "1", "sta');
    const fixture = readdirSync(join(FIXTURES, "basketball_nba", "401909285")).sort()[0]!;
    const copy = join(game, "1000.json.gz");
    copyFileSync(join(FIXTURES, "basketball_nba", "401909285", fixture), copy);
    const now = new Date();
    utimesSync(copy, now, now);
    try {
      const settling = Recording.load(scratch, "basketball_nba", "1");
      const settled = Recording.load(scratch, "basketball_nba", "1", 10, Date.now() + 60_000);
      expect(settling.snapshots.length === 0 && settled.snapshots.length === 1 && settled.rows.length === 1, "the loader skips files written in the last 10 s and a half-written last line").toBe(true);
      expect(arr(at(settled.summary(settled.snapshots[0]!), "plays")).length > 0, "a gzip snapshot decompresses to its summary").toBe(true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("the real slice: 401909285's fourth quarter, 7:35 to about 4:00, at the app's cadence", () => {
    const recording = Recording.load(FIXTURES, "basketball_nba", "401909285", 0);
    expect(recording.snapshots.length === 35 && recording.sport === "basketball" && recording.path === "basketball/nba", "the fixture loads (35 snapshots)").toBe(true);
    const replayed = () => {
      const replay = RecordingReplay.make(recording)!;
      const told: string[] = [];
      const scores: (string | null)[] = [];
      const delays: number[] = [];
      const inOrder: string[] = [];
      let late = 0;
      let steps = 0;
      let known = 0;
      let total = 0;
      const leadIn = replay.policy.horizons.live;
      let ordered = true;
      replay.run(appCadence(replay.policy), (r, t, step) => {
        steps += 1;
        for (const record of step.told) {
          told.push(record.entry.id);
          if (record.told !== "late") inOrder.push(record.entry.id);
          if (record.told === "late" && record.entry.kind.phase === "live") late += 1;
          if (record.told === "onTime" && record.entry.kind.phase === "live" && !record.backfill) {
            total += 1;
            if (record.firstSeen <= t - leadIn + 1e-6) known += 1;
          }
        }
        const p = r.engine.p(t);
        // The presented score is always the score after the last told play.
        const shown = r.engine.presented(t).score;
        const toldRecords = r.engine.timeline.records.slice(0, r.engine.timeline.toldCount);
        const lastTold = [...toldRecords].reverse().find((x) => x.entry.score != null)?.entry.score ?? null;
        if (JSON.stringify(shown) !== JSON.stringify(lastTold) && r.engine.timeline.corrections.length === 0) ordered = false;
        scores.push(shown ? `${shown.home}-${shown.away}` : null);
        delays.push(t - p);
      });
      if (!ordered) told.push("disorder");
      return { told, scores, delays, late, steps, known: [known, total] as const, inOrder };
    };
    const a = replayed();
    const b = replayed();
    expect(a.told, "the replay is deterministic").toEqual(b.told);
    expect(a.scores).toEqual(b.scores);
    expect(a.delays).toEqual(b.delays);
    expect(a.steps).toBeGreaterThan(100);
    expect(a.told.includes("disorder"), "the presented score is always the last told play's").toBe(false);
    const last = recording.snapshots.at(-1)!;
    const order = arr(at(recording.summary(last), "plays")).flatMap((p) => str(at(p, "id")) ?? []);
    // Everything but late insertions (told at once behind what's told, by definition) in the game's order.
    const toldOrder = a.inOrder.filter((id) => order.includes(id));
    expect(toldOrder, "plays are told in the game's order").toEqual(order.filter((id) => toldOrder.includes(id)));
    const delays = a.delays.slice(10);
    expect(delays.every((d) => d > 40 && d < 90), `D stays between 40 and 90 s on the slice (${Math.min(...delays).toFixed(1)}…${Math.max(...delays).toFixed(1)})`).toBe(true);
    const share = a.known[1] > 0 ? a.known[0] / a.known[1] : 0;
    // Late binding at q 0.95: most are known before their binding horizon; the rest are compressed or micro catch-ups.
    expect(share, `most live-ball plays are known before their binding horizon (${a.known[0]}/${a.known[1]})`).toBeGreaterThanOrEqual(0.75);
    expect(a.late, "late live-ball tellings (past a micro catch-up) are rare").toBeLessThanOrEqual(1);
    // The theater's view: plays up to the watermark, told ones marked, in order.
    const replay = RecordingReplay.make(recording)!;
    let snapshot: TimelineSnapshot<RawPlay> | null = null;
    replay.run(appCadence(replay.policy), (r, t) => {
      snapshot = r.engine.snapshot(t);
    });
    const snap = snapshot as TimelineSnapshot<RawPlay> | null;
    expect(snap, "the theater's snapshot").not.toBeNull();
    const orders = snap!.plays.map((p) => p.order);
    expect(
      orders.join() === [...orders].sort((x, y) => x - y).join() && snap!.plays.every((p) => (p.eventTime ?? 0) <= snap!.watermark || snap!.told.has(p.id)),
      "the theater's snapshot: in order, up to the watermark (§10)",
    ).toBe(true);
    const typeID = (raw: RawPlay) => {
      const v = at(raw.json, "type", "id");
      const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
      return Number.isFinite(n) ? Math.trunc(n) : null;
    };
    const mapped = mapSnapshot(snap!, typeID);
    expect(mapped.plays.length, "a snapshot maps to a sport's plays").toBe(snap!.plays.filter((p) => typeID(p.play) != null).length);
  });
});

describe("Broadcast: football, soccer and baseball lanes", () => {
  /**
   * A fixture's plays arriving `lag` seconds after their own time, read as
   * the core lane every 5 s, through the engine (synthetic arrival: these
   * test the lanes and the timeline, not the feed's lag).
   */
  function synthetic(items: readonly unknown[], sport: "football" | "soccer" | "baseball", path = "", lag = 40) {
    const p = sportPolicy(sport, path);
    const engine = new BroadcastEngine<RawPlay>(sport, p);
    const list = entries(items, sport, p);
    const times = list.flatMap((e) => (e.wallclock != null ? [e.wallclock] : []));
    if (times.length === 0) return { told: [] as TimelineRecord<RawPlay>[], engine, order: [] as string[] };
    const first = Math.min(...times);
    const last = Math.max(...times);
    const told: TimelineRecord<RawPlay>[] = [];
    let t = first + lag;
    while (t <= last + lag + 60) {
      // The lane's tail as of t: every play up to the newest that has arrived (in game order).
      let newest = -1;
      for (let k = list.length - 1; k >= 0; k--) {
        if ((list[k]!.wallclock ?? Infinity) + lag <= t) {
          newest = k;
          break;
        }
      }
      if (newest >= 0) engine.ingest({ lane: "core", entries: list.slice(0, newest + 1), coverage: "tail", arrived: t });
      else engine.noteRead("core", t);
      told.push(...engine.advance(t).told);
      let w = t;
      for (;;) {
        const next = engine.nextWake(w);
        if (next == null || !(next < t + 5)) break;
        w = next;
        told.push(...engine.advance(w).told);
      }
      t += 5;
    }
    return { told, engine, order: list.map((e) => e.id) };
  }

  it("football: snaps told in sequence order; the score is the last told snap's; an incompletion stops the clock", () => {
    const items = arr(at(sharedFixture("mnf-dal-phi-plays.json"), "items"));
    const fb = synthetic(items.slice(0, 60), "football", "football/nfl");
    const fbOrder = fb.told.filter((r) => r.told !== "history" && r.told !== "correction").map((r) => r.entry.id);
    expect(fbOrder.length > 0, "football: snaps are told in sequence order").toBe(true);
    expect(fbOrder).toEqual(fb.order.filter((id) => fbOrder.includes(id)));
    const fbLast = [...fb.engine.timeline.records].reverse().find((r) => r.entry.score != null)?.entry.score ?? null;
    const shown = fb.engine.presented(Infinity).score;
    expect(JSON.stringify(shown) === JSON.stringify(fbLast) || JSON.stringify(fb.engine.timeline.presentedScore(Infinity)) === JSON.stringify(fbLast), "football: the presented score is the last told snap's").toBe(true);
    const incomplete = fb.engine.timeline.records.find((r) => str(at(r.entry.payload.json, "type", "id")) === "3" && r.told != null);
    const i = incomplete ? fb.engine.timeline.position(incomplete.entry.id) : null;
    expect(incomplete != null && i != null && i + 1 < fb.engine.timeline.records.length, "football: the clock stops after an incompletion (an incompletion told)").toBe(true);
    const clock = presentedAtClock(fb.engine.timeline, incomplete!);
    expect(clock?.running, "football: the clock stops after an incompletion").toBe(false);
  });

  it("soccer: entries told in the feed's order; the presented clock reads as a minute", () => {
    const pages = ["1bbb58f9c1945678542dc53d", "8e8f4e473432cfae635da5d1"];
    const items = pages.flatMap((p) => arr(at(sharedFixture(`${p}.bin`), "items")));
    const sc = synthetic(items.slice(0, 300), "soccer", "soccer/eng.1");
    const scOrder = sc.told.filter((r) => r.told !== "history" && r.told !== "correction").map((r) => r.entry.id);
    expect(scOrder.length, "soccer: entries are told in the feed's order").toBeGreaterThan(100);
    expect(scOrder).toEqual(sc.order.filter((id) => scOrder.includes(id)));
    const lastWall = parseEventTime(str(at(items.slice(0, 300).at(-1), "wallclock"))) ?? 0;
    const minute = sc.engine.presented(lastWall + 40);
    expect(presentedStatus(minute, "soccer", 2).endsWith("'"), "soccer: the presented clock reads as a minute").toBe(true);
  });

  it("baseball: pitches and results told in order; MLB's pitch times join ESPN's plays", async () => {
    const items = arr(at(sharedFixture("ws-g4-plays.json"), "items"));
    const bb = synthetic(items.slice(0, 120), "baseball", "baseball/mlb");
    const bbOrder = bb.told.filter((r) => r.told !== "history" && r.told !== "correction").map((r) => r.entry.id);
    expect(bbOrder.length > 0, "baseball: pitches and results are told in order").toBe(true);
    expect(bbOrder).toEqual(bb.order.filter((id) => bbOrder.includes(id)));
    const inning = bb.engine.presented(Infinity);
    // MLB's own times joined to ESPN's plays (World Series Game 5: ESPN's plays and MLB's feed of the same game).
    const { timed, plateTimesFromFeed } = await import("../../src/data/broadcast/lanes");
    const g5 = arr(at(sharedFixture("ws-g5-plays.json"), "items"));
    const espn = entries(g5, "baseball", sportPolicy("baseball"));
    const plates = plateTimesFromFeed(sharedFixture("statcast-849799.json"));
    const joined = timed(espn, plates);
    const gaps: number[] = [];
    espn.forEach((before, k) => {
      const after = joined[k]!;
      if (after.reportedSource === "statsapi" && before.wallclock != null && after.wallclock != null) gaps.push(before.wallclock - after.wallclock);
    });
    expect(
      gaps.length > 100 && Math.abs(quantile(gaps, 0.5)) < 3 && gaps.every((g) => Math.abs(g) < 60),
      `baseball: MLB's pitch times join ESPN's plays by half-inning and at-bat (ESPN trails by a second or so): ${gaps.length} joined, p50 ${quantile(gaps, 0.5)}`,
    ).toBe(true);
    expect(timed(espn, new Map()), "baseball: without MLB's feed, ESPN's times stand").toEqual(espn);
    const status = presentedStatus(inning, "baseball", 18);
    expect(["Top", "Bot", "Mid", "End"].some((w) => status.startsWith(w)), `baseball: the status is the half-inning (${status})`).toBe(true);
  });
});

/** PresentedGame.clock half a second past a told play, the play read as the last told (as the Swift test reads it). */
function presentedAtClock(timeline: GameTimeline<RawPlay>, record: TimelineRecord<RawPlay>) {
  return presentedClock(record.presentAt + 0.5, record, timeline, timeline.policy);
}

describe("Broadcast: the recorder's status and core lanes", () => {
  it("status.jsonl reads as the core status; soccer's core looks replay in order", () => {
    // A status row reads as the app reads the core status.
    const row = { at: 100, clock: 252.0, displayClock: "4:12", period: 3, state: "in", detail: "4:12 - 3rd Quarter" };
    const nba = sportPolicy("basketball", NBA_PATH);
    const reading = readingFromStatus(Recording.status(row), nba, null, 100);
    expect(reading?.elapsed === 720 - 252 && reading.period === 3 && reading.state.kind === "live" && reading.source === "status", "a status.jsonl row reads as the core status (clock, period, state)").toBe(true);
    const end = { at: 200, clock: 0.0, displayClock: "0.0", period: 3, state: "in", detail: "End of 3rd Quarter" };
    expect(readingFromStatus(Recording.status(end), nba, reading, 200)?.state.kind, "…and an end of period reads as an interval").toBe("interval");

    const recording = Recording.load(FIXTURES, "soccer_eng.1", "401879256", 0);
    expect(recording.core.length > 40 && recording.status.length > 40 && recording.snapshots.length === 0, "the loader reads soccer's core looks and status rows").toBe(true);
    const lookJSON = recording.coreLook(recording.core[0]!);
    expect(typeof at(lookJSON, "count") === "number" && typeof at(lookJSON, "offset") === "number" && arr(at(lookJSON, "items")).length > 0, "a core look is {count, offset, items}").toBe(true);
    const replay = RecordingReplay.make(recording)!;
    const told: TimelineRecord<RawPlay>[] = [];
    let statusReadings = 0;
    replay.run(appCadence(replay.policy), (r, _t, step) => {
      told.push(...step.told);
      statusReadings = r.engine.timeline.fast.readings.filter((x) => x.source === "status").length;
    });
    const timeline = replay.engine.timeline;
    const onTime = told.filter((r) => r.told === "onTime" || r.told === "late").map((r) => r.entry.id);
    const order = ids(timeline.records);
    expect(onTime.length, "soccer's core lane: entries told in the feed's order").toBeGreaterThan(30);
    expect(onTime).toEqual(order.filter((id) => onTime.includes(id)));
    const goal = timeline.records.some((r) => bool(at(r.entry.payload.json, "scoringPlay")) === true && r.told != null);
    const score = timeline.presentedScore(Infinity);
    expect(goal && score != null && score.home + score.away >= 1, "the goal is told, with its score").toBe(true);
    expect(statusReadings, "the status lane comes from status.jsonl").toBeGreaterThan(20);
    // Revisions and removals across looks merge by ID, the newest version winning.
    expect(timeline.records.every((r) => r.entry.wallclock != null), "every entry keeps its wallclock across looks").toBe(true);
  });
});

describe("Broadcast: what the theater plans from", () => {
  it("a skip leaves the next play's horizon; pending arrivals and re-bounded clusters bump the revision; the replay passes horizons and anchors", () => {
    const s0 = S(0, 0);
    const p = testPolicy();
    p.horizons = { live: 2, byKind: { shot: 3.5 } };
    // A skip across a stoppage stops the next live-ball play's horizon short of it.
    const t = new GameTimeline<RawPlay>(p);
    t.ingest(look([play("foul", 100, { elapsed: 400, live: false, stops: true, score: s0 }), play("shot", 130, { elapsed: 401, score: s0, label: "shot" })], "summary", 140));
    t.tell(100);
    const shot = t.nextUntold?.presentAt ?? 0;
    const end = t.quietSpan(101, 1000);
    expect(end != null && Math.abs(end - (shot - 3.5)) < 1e-9, "a skip stops the shot's 3.5 s horizon short of it").toBe(true);
    // …and a dead-ball play next (horizon 0): unchanged, the skip lands on it.
    const d = new GameTimeline<RawPlay>(p);
    d.ingest(look([play("foul", 100, { elapsed: 400, live: false, stops: true, score: s0 }), play("ft", 130, { elapsed: 400, live: false, score: s0, label: "ft" })], "summary", 140));
    d.tell(100);
    const ft = d.nextUntold?.presentAt ?? 0;
    const q = d.quietSpan(101, 1000);
    expect(q != null && Math.abs(q - ft) < 1e-9, "a dead-ball play next: the skip lands on it, as before").toBe(true);

    // A play arriving past the watermark (pending) is a new revision. (The prior
    // lag holds the network guard back until ten lags are measured.)
    const trusting = { ...p, lagTrust: 10 };
    const e = new BroadcastEngine<RawPlay>("basketball", trusting);
    e.ingest(look([play("a", 100, { elapsed: 10, score: s0 })], "summary", 140));
    e.advance(140);
    const r0 = e.snapshot(140).revision;
    e.ingest(look([play("a", 100, { elapsed: 10, score: s0 }), play("b", 139, { elapsed: 49, score: s0 })], "summary", 141));
    const snap = e.snapshot(141);
    expect(snap.pending.map((x) => x.id), "a pending arrival bumps the revision").toEqual(["b"]);
    expect(snap.revision).not.toBe(r0);
    // A fast-lane restart that moves a stopped-clock cluster's bounds is a new revision too.
    const c = new GameTimeline<RawPlay>(p);
    c.ingest(
      look(
        [
          play("foul", 100, { elapsed: 400, live: false, stops: true, score: s0 }),
          play("ft1", 100, { elapsed: 400, live: false, score: s0, label: "ft" }),
          play("ft2", 100, { elapsed: 400, live: false, score: s0, label: "ft" }),
        ],
        "summary",
        130,
      ),
    );
    c.observe({ arrived: 131, state: { kind: "live" }, period: 1, elapsed: 400, running: false, score: s0, source: "status" });
    const bounded = c.record("ft2")?.bounds ?? null;
    const r1 = c.revision;
    c.observe({ arrived: 136, state: { kind: "live" }, period: 1, elapsed: 400, running: false, score: s0, source: "status" });
    const unchanged = c.revision === r1;
    // Running again by 140: the restart (~114 with the prior fast lag) is tighter than the firstSeen bound (120).
    c.observe({ arrived: 140, state: { kind: "live" }, period: 1, elapsed: 403, running: true, score: s0, source: "status" });
    const moved = c.record("ft2")?.bounds ?? null;
    expect(bounded != null && JSON.stringify(moved) !== JSON.stringify(bounded) && c.revision !== r1, "a restart that re-bounds the cluster bumps the revision").toBe(true);
    expect(unchanged, "a reading that moves nothing doesn't").toBe(true);

    // The replay takes the theater's horizons and anchors as the page does (the theater bench).
    const replay = RecordingReplay.make(Recording.load(FIXTURES, "soccer_eng.1", "401879256", 0))!;
    const r = replay.engine.timeline.revision;
    replay.setHorizons({ live: 3, byKind: { shot: 4 } });
    const horizons = replay.engine.timeline.horizons;
    replay.setAnchors(new Map([["x", 1]]));
    expect(horizons.live === 3 && horizons.byKind.shot === 4 && replay.engine.timeline.revision !== r, "the replay passes the theater's horizons and anchors through").toBe(true);
  });
});

describe("Broadcast: a VAR decision is told, never a quiet correction", () => {
  const kind = (type: string, located = false) => {
    const item: Record<string, unknown> = { id: "1", type: { type }, period: { number: 1 }, clock: { value: 600.0 }, wallclock: "2026-10-31T13:00:00Z" };
    if (located) item.fieldPositionX = 0.5;
    return soccer(item, sportPolicy("soccer", "soccer/eng.1"))?.kind;
  };

  it("soccer's kinds: the temporary attempt, the goal kick, VAR, delays", () => {
    expect(kind("temp-attempt")?.label === "shot" && kind("temp-attempt")?.phase === "live", "a temporary attempt is the shot (ESPN revises it in place later)").toBe(true);
    expect(kind("goal-kick", true)?.label, "a goal kick is a restart, not a shot").toBe("entry");
    expect(kind("var---referee-decision-cancelled")?.announced === true && kind("deleted-after-review")?.announced === true, "VAR decisions are announced kinds").toBe(true);
    expect(kind("start-delay")?.delay === "opens" && kind("end-delay")?.delay === "closes", "a delay's start and end").toBe(true);
  });

  it("the real Chelsea v Manchester United window, at D 70 and 40", () => {
    // The real Chelsea v Manchester United window (Tests/Fixtures/broadcast/soccer_eng.1/401879248):
    // a 34th-minute goal at 06:04:37, a VAR check from 06:04:40, the decision
    // logged with the check's start time but arriving 132 s later, the check's
    // end at 06:06:04, the free kick at 06:06:12. The goal entry itself is
    // revised in place to "Deleted After Review" (score back to 0–0).
    const recording = Recording.load(FIXTURES, "soccer_eng.1", "401879248", 0);
    expect(recording.core.length > 15 && recording.status.length > 0 && recording.rows.length > 0, "the real VAR window loads: core looks, status and scoreboard rows").toBe(true);
    const goal = "54531150";
    const review = "54531246";
    const start = "54531185";
    const end = "54531247";
    const restart = "54531248";
    const before = S(0, 1);
    const after = S(0, 0);
    for (const d of [70, 40]) {
      const p = sportPolicy("soccer", recording.path);
      p.minDelay = d;
      p.maxDelay = d;
      const replay = RecordingReplay.make(recording, p)!;
      const steps: { t: number; score: string | null; told: string[]; held: boolean }[] = [];
      replay.run(appCadence(replay.policy), (r, t, step) => {
        const timeline = r.engine.timeline;
        const s = timeline.presentedScore(r.engine.p(t));
        steps.push({ t, score: s ? `${s.home}-${s.away}` : null, told: ids(step.told), held: timeline.heldScore != null });
      });
      const timeline = replay.engine.timeline;
      const v = timeline.record(review);
      const s = timeline.record(start);
      const e = timeline.record(end);
      const goalStep = steps.findIndex((x) => x.told.includes(goal));
      const reviewStep = steps.findIndex((x) => x.told.includes(review));
      const restartStep = steps.findIndex((x) => x.told.includes(restart));
      const tag = `D ${d} s:`;
      expect(v && s && e && goalStep >= 0 && reviewStep >= 0 && restartStep >= 0, `${tag} the goal, the decision and the restart are told`).toBeTruthy();
      expect(
        v!.bounds?.lower === s!.eventTime && v!.bounds?.upper === e!.eventTime && v!.timeSource === "bounded" && Math.abs(v!.presentAt - (e!.eventTime - 1)) < 1e-6,
        `${tag} the decision is placed at the end of the check (bounded by its start and end), not at its stamp`,
      ).toBe(true);
      // (At 40 s the network guard holds p ~50 s back, so it's on time here too; telling an announced
      // play that comes >30 s late as an event rather than a correction is Phase 0's tell path.)
      expect(v!.told === "onTime" || v!.told === "late", `${tag} the decision is told as an event, not a quiet correction`).toBe(true);
      const key = (sc: { home: number; away: number }) => `${sc.home}-${sc.away}`;
      expect(steps[goalStep]!.score, `${tag} the goal is told with its score (0–1)`).toBe(key(before));
      expect(
        steps.slice(goalStep, reviewStep).every((x) => x.score === key(before)),
        `${tag} the score stays 0–1 until the decision is told (the goal's revision doesn't revert it early)`,
      ).toBe(true);
      expect(steps[reviewStep]!.score, `${tag} …and reverts to 0–0 with the decision`).toBe(key(after));
      expect(restartStep, `${tag} the free kick after the decision`).toBeGreaterThanOrEqual(reviewStep);
      if (d >= 60) expect(steps.some((x) => x.held), `${tag} the told score was held while the decision waited its turn`).toBe(true);
    }
  });

  it("an announced play inserted behind told plays is told late, as an event", () => {
    const behind = new GameTimeline<RawPlay>(testPolicy());
    behind.ingest(look([play("g", 100, { elapsed: 10, score: S(0, 1) }), play("k", 130, { elapsed: 40, score: S(0, 1) })], "summary", 140));
    behind.tell(135);
    const decision = { ...play("v", 103, { elapsed: 13, live: false, score: S(0, 0) }), kind: playKind("dead", "review", { announced: true }) };
    const fix = { ...play("f", 104, { elapsed: 14, live: false, score: S(0, 1) }), kind: playKind("dead", "other") };
    const inserted = behind.ingest(look([behind.record("g")!.entry, decision, fix, behind.record("k")!.entry], "summary", 300));
    expect(inserted.lateInsertions, "inserted behind told plays: an announced play is told late (an event), anything else a quiet correction").toEqual(["v", "f"]);
    expect(behind.record("v")?.told).toBe("late");
    expect(behind.record("f")?.told).toBe("correction");
  });
});

describe("Broadcast: a jump never skips a play that must be told live", () => {
  it("the clock lands short of the limit; the timeline says where; the flow goes by as history, the score live", () => {
    // The clock: a jump lands at its limit, not the edge; with no room before the limit, no jump.
    const j = new PresentationClock();
    j.update(0, { target: 50, cap: -50 });
    for (let now = 10; now <= 90; now += 10) j.update(now, { target: 50, cap: -45 });
    j.update(100, { target: 50, cap: 60, jumpLimit: 10 });
    expect(hasEvent(j.events, { kind: "jump", at: 100, from: -45, to: 10 }) && Math.abs(j.p(100) - 10) < 1e-9, "a jump lands short of the first play that must be told live, not at the edge").toBe(true);
    const n = new PresentationClock();
    n.update(0, { target: 50, cap: -50 });
    for (let now = 10; now <= 90; now += 10) n.update(now, { target: 50, cap: -45 });
    n.update(100, { target: 50, cap: 60, jumpLimit: -44.9 });
    expect(!n.events.some((e) => e.kind === "jump") && n.regime === "catchingUp", "no room before that play: no jump, it catches up instead").toBe(true);

    // The timeline: where a jump may land.
    const s0 = S(0, 0);
    const s1 = S(1, 0);
    const p = testPolicy();
    p.toldLive = new Set(["card"]);
    const t = new GameTimeline<RawPlay>(p);
    t.ingest(
      look([play("a", 100, { elapsed: 10, score: s0 }), play("b", 120, { elapsed: 30, score: s0 }), play("c", 130, { elapsed: 40, score: s1 }), play("d", 140, { elapsed: 50, score: s1 })], "summary", 145),
    );
    t.tell(100);
    expect(t.jumpLimit != null && Math.abs(t.jumpLimit - (130 - 2 - 1)) < 1e-9, "the limit: a score's lead-in short of it").toBe(true);
    const u = new GameTimeline<RawPlay>(p);
    u.ingest(look([play("a", 100, { elapsed: 10, score: s0 }), play("b", 120, { elapsed: 30, live: false, score: s0, label: "card" }), play("c", 130, { elapsed: 40, score: s0 })], "summary", 145));
    u.tell(100);
    const v = new GameTimeline<RawPlay>(p);
    const review = { ...play("r", 125, { elapsed: 35, live: false, score: s0 }), kind: playKind("dead", "review", { announced: true }) };
    v.ingest(look([play("a", 100, { elapsed: 10, score: s0 }), play("b", 120, { elapsed: 30, score: s0 }), review], "summary", 145));
    v.tell(100);
    expect(
      u.jumpLimit != null && Math.abs(u.jumpLimit - (120 - 1)) < 1e-9 && v.jumpLimit != null && Math.abs(v.jumpLimit - (125 - 1)) < 1e-9,
      "…a kind the sport keeps live (a card), and an announced play (VAR)",
    ).toBe(true);

    // Soccer's dead ball: the clock runs, but the ball is out until the restart; nothing moves on screen.
    const soccerPolicy = { ...testPolicy(), clockCountsDown: false };
    const w = new GameTimeline<RawPlay>(soccerPolicy);
    const out = { ...play("o", 100, { elapsed: 10, live: false, score: s0 }), kind: playKind("dead", "other", { stopsPlay: true }) };
    w.ingest(look([out, play("throw", 118, { elapsed: 28, score: s0 })], "summary", 140));
    w.tell(100);
    const x = new GameTimeline<RawPlay>(soccerPolicy);
    x.ingest(look([play("pass", 100, { elapsed: 10, score: s0 }), play("next", 118, { elapsed: 28, score: s0 })], "summary", 140));
    x.tell(100);
    const span = w.quietSpan(101, 1000);
    expect(span != null && Math.abs(span - (118 - 2)) < 1e-9 && x.quietSpan(101, 1000) == null, "the ball out of play is a quiet span (skip to the restart's lead-in); in play, none").toBe(true);

    // End to end: a long stall, then the late batch: the flow before the score goes by as history,
    // the score is told live, in order.
    const e = { ...testPolicy(), maxDelay: 40 };
    const engine = new BroadcastEngine<RawPlay>("basketball", e);
    engine.ingest(look([play("a", 100, { elapsed: 10, score: s0 })], "summary", 130));
    engine.advance(130);
    for (let now = 135; now <= 295; now += 5) engine.advance(now);
    const stalledAt = engine.p(295);
    engine.ingest(
      look(
        [
          play("a", 100, { elapsed: 10, score: s0 }),
          play("b", 120, { elapsed: 30, score: s0 }),
          play("c", 130, { elapsed: 40, score: s0 }),
          play("d", 140, { elapsed: 50, score: s0 }),
          play("goal", 150, { elapsed: 60, score: s1 }),
          play("f", 160, { elapsed: 70, score: s1 }),
        ],
        "summary",
        300,
      ),
    );
    const told: Record<string, TellReason> = {};
    const jumps: [number, number][] = [];
    let now = 300;
    while (now < 330) {
      const step = engine.advance(now);
      for (const r of step.told) told[r.entry.id] = r.told!;
      for (const ev of step.events) if (ev.kind === "jump") jumps.push([ev.from, ev.to]);
      const next = engine.nextWake(now);
      if (next == null) break;
      now = Math.min(next, now + 5);
    }
    expect(stalledAt < 120 && jumps[0] != null && Math.abs(jumps[0][1] - (150 - 2 - 1)) < 1e-6, `after the stall, the jump lands short of the score (stalled at ${stalledAt}, jumps ${JSON.stringify(jumps)})`).toBe(true);
    expect(told.b === "history" && told.c === "history" && told.d === "history" && told.goal != null && told.goal !== "history", "the flow before it goes by as history; the score is told live").toBe(true);

    // Held at the watermark far behind, the watermark creeping a read at a time: no crossfade per read.
    const creep = new PresentationClock();
    creep.update(0, { target: 50, cap: -50 });
    for (let t2 = 10; t2 <= 90; t2 += 10) creep.update(t2, { target: 50, cap: -45 });
    creep.update(100, { target: 50, cap: -40 });
    expect(creep.events.some((ev) => ev.kind === "jump"), "a watermark 5 s ahead isn't worth a jump: the clock runs to it").toBe(false);

    // The heartbeat: while the game goes on, the clock is updated at least every 5 s,
    // so a stretch with nothing read is never taken for a wake.
    const quiet = new BroadcastEngine<RawPlay>("basketball", testPolicy());
    quiet.ingest(look([play("a", 100, { elapsed: 10, score: s0 })], "summary", 130));
    quiet.advance(130);
    let t2 = 130;
    let wakes = 0;
    for (;;) {
      const next = quiet.nextWake(t2);
      if (!(t2 < 400) || next == null || !(next - t2 <= BroadcastEngine.heartbeat + 1e-6)) break;
      t2 = next;
      wakes += quiet.advance(t2).events.filter((ev) => ev.kind === "wake").length;
    }
    expect(t2 >= 400 && wakes === 0, "nothing read for minutes: the heartbeat keeps the clock awake (no wake, no history)").toBe(true);

    // College football's summary gives the clock only as "11:35": it still makes elapsed seconds (clusters need them).
    const cfb = { id: "p1", period: { number: 1 }, clock: { displayValue: "11:35" }, type: { id: "53", text: "Kickoff" }, text: "kickoff", sequenceNumber: "9", wallclock: "2026-10-31T16:11:58Z" };
    expect(football(cfb, sportPolicy("football", "football/college-football"))?.entry.clock.elapsed, "a college play's clock from its display value").toBe(900 - 695);
  });
});

describe("Broadcast: how far behind live, on hover only", () => {
  it("the readout's numbers and words", () => {
    expect(behindFromClock(53.4, "tracking"), "the delay rounds to 5 s, never under 5").toEqual(behindLive(55));
    expect(behindFromClock(52.4, "tracking")?.seconds).toBe(50);
    expect(behindFromClock(1.2, "tracking")?.seconds).toBe(5);
    expect(behindText(behindLive(55)), "the hover's words").toBe("About 55 s behind live");
    expect(behindText(behindLive(100))).toBe("About 1 min 40 s behind live");
    expect(behindText(behindLive(120))).toBe("About 2 min behind live");
    expect(behindSpoken(behindLive(55)), "VoiceOver's: the same, in words").toBe("About 55 seconds behind live");
    expect(behindSpoken(behindLive(65, "Catching up"))).toBe("About 1 minute 5 seconds behind live, catching up");
    expect(
      behindFromClock(80, "catchingUp")?.note === "Catching up" &&
        behindFromClock(80, "stalled")?.note === "Waiting for the feed" &&
        behindFromClock(80, "tracking")?.note == null &&
        behindFromClock(80, "stretching")?.note == null,
      "a quieter note while catching up or waiting on the feed; none otherwise",
    ).toBe(true);
    // Web: a delay that isn't a number has no readout (Swift's Int() would trap on it).
    expect(behindFromClock(Infinity, "tracking")).toBeNull();
    expect(behindFromClock(NaN, "tracking")).toBeNull();
  });
});

describe("Broadcast: our own outages aren't the feed's lag", () => {
  it("a look after our outage sizes nothing; the recorder's holes, logged and inferred; the replay reads nothing inside one", () => {
    const s0 = S(0, 0);
    // The engine: a lane unread for longer than it should be; what it brings sizes nothing.
    const t = new GameTimeline<RawPlay>(testPolicy());
    t.ingest(look([play("a", 90, { elapsed: 10, score: s0 })], "summary", 100));
    for (let now = 105; now <= 130; now += 5) t.noteRead("summary", now);
    t.ingest(look([play("a", 90, { elapsed: 10, score: s0 }), play("b", 128, { elapsed: 48, score: s0 })], "summary", 135));
    t.ingest(look([play("a", 90, { elapsed: 10, score: s0 }), play("b", 128, { elapsed: 48, score: s0 }), play("c", 150, { elapsed: 70, score: s0 })], "summary", 230));
    expect(
      t.record("b")?.afterOutage === false && t.record("b")?.arrivalLag != null && t.record("c")?.afterOutage === true && t.record("c")?.arrivalLag == null && !t.lags.some((l) => l.lag > 60),
      "a look after 95 s unread: its new play waited on us, so its lag sizes nothing",
    ).toBe(true);

    // The recorder's holes: from gaps.jsonl, per lane, failures in a row chained.
    const explicit = new Recording("soccer_eng.1", "x", []);
    explicit.gaps = [
      { at: 100, what: "summary" },
      { at: 105, what: "summary" },
      { at: 300, what: "core" },
    ];
    const soccerP = sportPolicy("soccer", "soccer/eng.1");
    const holes = explicit.holes(soccerP).map((h) => ({ lower: h.lower, upper: h.upper, lanes: h.lanes ? [...h.lanes] : null }));
    expect(holes, "gaps.jsonl: each failed fetch leaves its lane unread until the next try").toEqual([
      { lower: 99.9, upper: 110, lanes: ["summary"] },
      { lower: 299.9, upper: 305, lanes: ["core"] },
    ]);
    // Older recordings: every lane silent over 60 s while the clock ran is a hole; a halftime isn't.
    const row = (a: number, clock: number) => ({ json: { at: a, period: 1, clock }, index: 0 });
    const inferred = new Recording(
      "soccer_eng.1",
      "y",
      Array.from({ length: 11 }, (_, k) => ({ arrived: k * 10, path: "/dev/null" })),
    );
    // The recorder silent from 100 to 300 while the clock ran 200 s (a hole); then polling every
    // 10 s to 400; then 15 min with the clock standing at 1400 (a halftime: no hole).
    inferred.status = [
      ...Array.from({ length: 11 }, (_, k) => row(k * 10, 1000 + k * 10)),
      ...Array.from({ length: 11 }, (_, k) => row(300 + k * 10, 1300 + k * 10)),
      row(1300, 1400),
    ];
    const found = inferred.holes(soccerP).map((h) => ({ lower: h.lower, upper: h.upper, lanes: h.lanes }));
    inferred.gapLogged = true;
    const logged = inferred.holes(soccerP);
    expect(found, "recorded before gap logging: lane silence while the clock ran is a hole (not the 15 min the clock stood still)").toEqual([{ lower: 100, upper: 300, lanes: null }]);
    expect(logged, "…with logging, it's the feed's").toEqual([]);

    // The replay reads nothing inside a hole.
    const fixture = Recording.load(FIXTURES, "soccer_eng.1", "401879248", 0);
    const first = fixture.core[0]!.arrived;
    fixture.gaps = [
      { at: first + 40, what: "core" },
      { at: first + 45, what: "core" },
    ];
    fixture.gapLogged = true;
    const replay = RecordingReplay.make(fixture)!;
    const inside = replay.schedule(appCadence(replay.policy)).filter((x) => x.input.kind === "core" && x.t >= first + 40 && x.t <= first + 50);
    expect(replay.holes.length === 1 && inside.length === 0, "the replay withholds a lane's reads inside its hole").toBe(true);
  });
});

function comp(id: string, name: string, score: string) {
  return { id, name, abbreviation: name, score, logo: null, isWinner: false, color: null, rank: null, record: null, conferenceRecord: null, alternateColor: null };
}
