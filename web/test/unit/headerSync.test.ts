/**
 * The game core's sections kept no older than its header (data/headerSync.ts,
 * state/laneScores.ts; the live check of Oct 27): the line score brought up
 * to what the header said period by period (the NBA page's Q1 went back to
 * 12–9 while the total said 12–12), and the scores list given the page's
 * newer lane score until the scoreboard catches up.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { HeaderLedger, headerReading, periodIn, reconcileLinescore, withLaneScore, LANE_SCORE_MS } from "../../src/data/headerSync";
import type { ScoreEvent } from "../../src/data/models";
import { laneScoresVersion, publishLaneScore, resetLaneScores, withLaneScores } from "../../src/state/laneScores";

const nba = (q: [string, string][], t: [string, string]) => ({
  headers: [...q.map((_, i) => String(i + 1)), "T"],
  top: [...q.map((c) => c[0]), t[0]],
  bottom: [...q.map((c) => c[1]), t[1]],
});

describe("the line score against the header", () => {
  it("the NBA's Q1, read 12–12 by the lane, never goes back to the summary's 12–9 once the lane is in Q2", () => {
    const ledger = new HeaderLedger();
    ledger.observe({ period: 1, top: 12, bottom: 9 });
    ledger.observe({ period: 1, top: 12, bottom: 12 });
    // Q2 under way; the summary still has Q1 at 12–9 and no Q2 column (its T the lane's, from the NBA page).
    ledger.observe({ period: 2, top: 12, bottom: 12 });
    const line = reconcileLinescore(nba([["12", "9"]], ["12", "12"]), ledger);
    expect(line.top).toEqual(["12", "12"]);
    expect(line.bottom).toEqual(["12", "12"]);
    // A basket in Q2 before the summary has its column: in the total only, never made up in Q1.
    ledger.observe({ period: 2, top: 14, bottom: 12 });
    const later = reconcileLinescore(nba([["12", "9"]], ["12", "9"]), ledger);
    expect(later.top).toEqual(["12", "14"]);
    expect(later.bottom).toEqual(["12", "12"]);
    // …and in Q2's own cell once the summary has one.
    const withQ2 = reconcileLinescore(nba([["12", "9"], ["0", "0"]], ["12", "9"]), ledger);
    expect(withQ2.top).toEqual(["12", "2", "14"]);
    expect(withQ2.bottom).toEqual(["12", "0", "12"]);
  });
  it("a summary that has caught up (or is ahead: a correction) shows as ESPN has it", () => {
    const ledger = new HeaderLedger();
    ledger.observe({ period: 2, top: 20, bottom: 18 });
    const caught = nba([["12", "12"], ["8", "6"]], ["20", "18"]);
    expect(reconcileLinescore(caught, ledger)).toBe(caught);
    const ahead = nba([["12", "12"], ["10", "6"]], ["22", "18"]);
    expect(reconcileLinescore(ahead, ledger)).toBe(ahead);
    expect(reconcileLinescore(caught, new HeaderLedger())).toBe(caught);
  });
  it("baseball: a run in the top of the 7th lands in the 7th and in R; the bottom's empty cell stays empty; H and E untouched", () => {
    const ledger = new HeaderLedger();
    ledger.observe(headerReading("2", "1", periodIn("Top 7th")));
    ledger.observe(headerReading("3", "1", periodIn("Top 7th")));
    const line = {
      headers: ["1", "2", "3", "4", "5", "6", "7", "R", "H", "E"],
      top: ["0", "1", "0", "0", "1", "0", "0", "2", "6", "0"],
      bottom: ["0", "0", "1", "0", "0", "0", "", "1", "4", "1"],
    };
    const next = reconcileLinescore(line, ledger);
    expect(next.top).toEqual(["0", "1", "0", "0", "1", "0", "1", "3", "6", "0"]);
    expect(next.bottom).toEqual(line.bottom);
  });
  it("the header's period from its text: an inning, a quarter; its score as numbers only when both are", () => {
    expect(periodIn("Mid 7th")).toBe(7);
    expect(periodIn("End 12th")).toBe(12);
    expect(periodIn("Live")).toBeNull();
    expect(headerReading("3", "", 2)).toBeNull();
    expect(headerReading("3", "1", 2)).toEqual({ period: 2, top: 3, bottom: 1 });
  });
  it("the ledger says a new reading once", () => {
    const ledger = new HeaderLedger();
    let said = 0;
    ledger.subscribe(() => said++);
    ledger.observe({ period: 1, top: 1, bottom: 0 });
    ledger.observe({ period: 1, top: 1, bottom: 0 });
    ledger.observe(null);
    expect(said).toBe(1);
    expect(ledger.end(1)).toEqual({ period: 1, top: 1, bottom: 0 });
  });
});

const live = (top: string, bottom: string, state: ScoreEvent["state"] = "live"): ScoreEvent =>
  ({
    id: "espn-1",
    state,
    content: { kind: "match", top: { score: top, name: "A" }, bottom: { score: bottom, name: "B" } },
  }) as unknown as ScoreEvent;
const scoreOf = (e: ScoreEvent) => (e.content.kind === "match" ? `${e.content.top.score}–${e.content.bottom.score}` : "");

describe("the scores list beside the page", () => {
  beforeEach(() => resetLaneScores());
  it("shows the page's lane score while it's ahead of the scoreboard's, never behind it, for a live game, for a few minutes", () => {
    const lane = { top: "12", bottom: "12", at: 0 };
    expect(scoreOf(withLaneScore(live("12", "9"), lane, 1000))).toBe("12–12");
    expect(scoreOf(withLaneScore(live("12", "12"), lane, 1000))).toBe("12–12");
    expect(scoreOf(withLaneScore(live("14", "12"), lane, 1000))).toBe("14–12");
    expect(scoreOf(withLaneScore(live("12", "9", "final"), lane, 1000))).toBe("12–9");
    expect(scoreOf(withLaneScore(live("12", "9"), lane, LANE_SCORE_MS + 1))).toBe("12–9");
  });
  it("one copy per event and reading, so a memoized row renders only when its score does", () => {
    const events = [live("12", "9")];
    expect(withLaneScores(events)).toBe(events);
    const before = laneScoresVersion();
    publishLaneScore("espn-1", { top: "12", bottom: "12" });
    expect(laneScoresVersion()).toBe(before + 1);
    const shown = withLaneScores(events);
    expect(scoreOf(shown[0]!)).toBe("12–12");
    expect(withLaneScores(events)[0]).toBe(shown[0]);
    publishLaneScore("espn-1", { top: "12", bottom: "12" });
    expect(laneScoresVersion()).toBe(before + 1);
  });
});

