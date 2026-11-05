/**
 * The replay bench over the repository's recordings (Tests/BroadcastBench.swift
 * over Tests/Fixtures/broadcast, `./test.sh --bench --root Tests/Fixtures/broadcast`
 * and `--breaks`), with the Mac's gates asserted: the presented game's delay,
 * late binding, scores and VAR decisions told live (never as history across a
 * jump, never a quiet correction), no wakes while the game goes on, every
 * break read as a break.
 *
 * Ad hoc, over the recorder's own folder (never committed):
 *
 *     SCORELINE_RECORDINGS=<folder> pnpm vitest run test/unit/broadcastBench.test.ts
 *     SCORELINE_BENCH=grid|breaks|trace SCORELINE_BENCH_ONLY=basketball_nba[/401909285] …
 *
 * prints every game's report (and each sport's combined), the trade curve, or
 * every break, as the Mac's bench does.
 */
import { describe, expect, it } from "vitest";
import { breaks, combined, recordings, render, run, trade, type Report } from "./broadcastBench";
import { FIXTURES, Recording } from "./broadcastReplay";

const reportFor = (sport: string, event: string): Report => {
  const report = run(Recording.load(FIXTURES, sport, event, 0));
  if (!report) throw new Error(`${sport}/${event} doesn't replay`);
  return report;
};

const p = (values: readonly number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = q * (sorted.length - 1);
  const lo = Math.floor(rank);
  return sorted[lo]! + (sorted[Math.min(lo + 1, sorted.length - 1)]! - sorted[lo]!) * (rank - lo);
};

describe("the broadcast bench, over Tests/Fixtures/broadcast", () => {
  it("NBA 401909285's fourth quarter: D, late binding, every score told live", () => {
    const r = reportFor("basketball_nba", "401909285");
    if (process.env.SCORELINE_BENCH) console.log(render(r));
    const actual = r.delays.map((d) => d.actual);
    expect(actual.length, "D sampled each minute").toBeGreaterThan(5);
    expect(actual.every((d) => d > 40 && d < 90), `D stays between 40 and 90 s (${Math.min(...actual).toFixed(1)}…${Math.max(...actual).toFixed(1)})`).toBe(true);
    // D's terms at the end: lag q95 + horizon 2.5 + margin 1 (BROADCAST §2's NBA choice).
    expect(r.terms.quantile === 0.95 && r.terms.horizon === 2.5 && r.terms.margin === 1, "the NBA's policy: q 0.95, horizon 2.5 s, margin 1 s").toBe(true);
    const known = Object.values(r.knownBeforeLeadIn).reduce((a, c) => [a[0]! + c.known, a[1]! + c.total], [0, 0]);
    expect(known[0]! / known[1]!, `most live-ball plays known before their binding horizon (${known[0]}/${known[1]})`).toBeGreaterThanOrEqual(0.75);
    const lateLive = Object.entries(r.late).filter(([k]) => ["shot", "rebound", "turnover", "jump ball"].includes(k)).reduce((a, [, v]) => a + v, 0);
    expect(lateLive, "late live-ball tellings (past a micro catch-up) are rare").toBeLessThanOrEqual(1);
    expect(r.scoring["history (jump)"] ?? 0, "no score told as history across a jump").toBe(0);
    expect(r.wakes, "the heartbeat: no wakes while the game goes on").toBe(0);
    expect(r.safetyNet, "the safety net: 0 on the NBA recordings").toBe(0);
  });

  it("Chelsea v Manchester United's VAR window: the goal and the decisions told live, as events", () => {
    const r = reportFor("soccer_eng.1", "401879248");
    if (process.env.SCORELINE_BENCH) console.log(render(r));
    expect(r.terms.quantile === 0.95 && r.terms.horizon === 3 && r.terms.margin === 13, "soccer's policy: q 0.95, horizon 3 s, margin 13 s").toBe(true);
    const reviews = Object.entries(r.reviews);
    expect(reviews.length, "the VAR decisions are told").toBeGreaterThan(0);
    expect(
      reviews.every(([how]) => how === "onTime" || how === "late" || how === "late (inserted)"),
      `VAR decisions told as events, never as history or a quiet correction (${JSON.stringify(r.reviews)})`,
    ).toBe(true);
    expect(Object.keys(r.scoring).every((how) => how === "onTime" || how === "late"), `the goal told live (${JSON.stringify(r.scoring)})`).toBe(true);
    expect(r.wakes).toBe(0);
  });

  it("every fixture: no score across a jump, no wakes; the combined report renders", () => {
    const all = recordings(FIXTURES).filter((g) => g.snapshots.length + g.core.length >= 3);
    expect(all.map((g) => `${g.sportDirectory}/${g.event}`).sort()).toEqual(["basketball_nba/401909285", "soccer_eng.1/401879248", "soccer_eng.1/401879256", "soccer_usa.1/761921"]);
    const reports = all.flatMap((g) => run(Recording.load(FIXTURES, g.sportDirectory, g.event, 0)) ?? []);
    for (const r of reports) {
      expect(r.scoring["history (jump)"] ?? 0, `${r.label}: no score told as history across a jump`).toBe(0);
      expect(r.wakes, `${r.label}: no wakes`).toBe(0);
    }
    const soccer = combined(
      reports.filter((r) => r.label.startsWith("soccer")),
      "soccer: all games",
    );
    expect(render(soccer)).toContain("== soccer: all games");
  });

  it("every recorded break reads as a break throughout (--breaks)", () => {
    const result = breaks(recordings(FIXTURES).map((g) => Recording.load(FIXTURES, g.sportDirectory, g.event, 0)));
    if (process.env.SCORELINE_BENCH) console.log(result.lines.join("\n"));
    expect(result.total, "the MLS recording's half-time is in the fixtures").toBeGreaterThan(0);
    expect(result.failed, result.lines.join("\n")).toBe(0);
  });
});

/** The recorder's own folder, ad hoc: every game's report, as `./test.sh --bench` prints it. */
const root = process.env.SCORELINE_RECORDINGS;
describe.runIf(root != null)("the broadcast bench, over SCORELINE_RECORDINGS", () => {
  it("reports every recorded game", () => {
    const mode = process.env.SCORELINE_BENCH;
    const games = recordings(root!, process.env.SCORELINE_BENCH_ONLY).filter((g) => g.snapshots.length + g.core.length >= 3);
    if (mode === "grid") {
      console.log(trade(games));
      return;
    }
    if (mode === "breaks") {
      console.log(breaks(games).lines.join("\n"));
      return;
    }
    const bySport = new Map<string, Report[]>();
    for (const g of games) {
      const r = run(g, { trace: mode === "trace" });
      if (!r) continue;
      console.log(render(r));
      (bySport.get(g.sportDirectory) ?? bySport.set(g.sportDirectory, []).get(g.sportDirectory)!).push(r);
    }
    for (const [sport, reports] of [...bySport].sort(([a], [b]) => a.localeCompare(b))) {
      if (reports.length > 1) console.log(render(combined(reports, `${sport}: all games`)));
      const delays = reports.flatMap((r) => r.delays.map((d) => d.actual));
      if (delays.length > 0) console.log(`  ${sport}: D p50 ${p(delays, 0.5).toFixed(1)} s over ${reports.length} games`);
    }
    expect(games.length).toBeGreaterThan(0);
  }, 3_600_000);
});
