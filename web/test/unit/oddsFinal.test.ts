/**
 * A final reads the settled market (a production bug, 2026-11-05): MIA @ LAC
 * went to OT and MIA won 117–116 on Klay Thompson's three with 1.0 s left.
 * ESPN's End of Game is stamped 06:21:06Z; Polymarket swung to MIA at
 * 06:21:32Z (0.205 → 0.995) and settled at 0.9995. Cutting the market at the
 * last play (as the Mac's OddsChartData.make does) read "MIA 20% · LAC 80%".
 * On the real, trimmed recordings (test/fixtures/odds/*mia-lac*).
 */
import { describe, expect, it } from "vitest";
import { chartHead, finalPoints, makeChartData, percents, readingAt, usesFinalPercentages } from "../../src/data/odds/chart";
import { parseOddsBasis } from "../../src/data/odds/espn";
import { GAME, historyEnd, parseHistory as parseMatchHistory, shownUntil } from "../../src/data/odds/history";
import { compact, parseHistory } from "../../src/data/odds/polymarket";
import { fixture } from "./fixtures";

const summary = fixture("odds/espn-nba-mia-lac-summary.json");
const recorded = parseHistory(fixture("odds/pm-nba-mia-lac-history.json"));
const at = (s: string) => Date.parse(`2026-11-05T${s}Z`);
const opened = at("06:30:00");
// As the feed keeps it, the page opened nine minutes after the end.
const series = { top: compact(recorded, opened) };
const feed = { market: { kind: "two-way" as const }, series, version: 1 };
// MIA is away: the top team.
const history = parseMatchHistory(summary, "basketball", "14", "12");
const basis = parseOddsBasis(summary, "basketball", false);
const eventStart = at("03:30:00");
const buzzer = at("06:21:06");
const split = (top: number) => ({ top, draw: null, bottom: 1 - top });

describe("a final reads the settled market", () => {
  it("ends the line on the market's own end, held at the buzzer: MIA 100% · LAC 0%, never the winner as the underdog", () => {
    expect(historyEnd(history), "ESPN's End of Game").toBe(buzzer);
    expect(recorded.some((p) => p.t > buzzer && p.p > 0.99), "the market answered after it").toBe(true);
    const data = makeChartData({ feed, basis, history, state: "final", window: GAME, eventStart, now: opened })!;
    expect(data.domain.to, "the axis stays the game's (the timeline beside it doesn't move)").toBe(buzzer);
    expect(data.points.every((p) => p.t <= data.domain.to), "nothing drawn past the buzzer").toBe(true);
    const head = chartHead(data)!;
    expect(head.t).toBe(buzzer);
    expect(head.split.top).toBe(0.9995);
    expect(percents(head.split, usesFinalPercentages(data, null)), "the header: MIA 100% · LAC 0%").toEqual({ top: 100, bottom: 0 });
    const end = readingAt(data.domain.to, data, basis);
    expect(percents(end.split!, usesFinalPercentages(data, end.t)), "the reading at the exact final moment agrees with Latest").toEqual({ top: 100, bottom: 0 });
    // The game as it went: the in-game price stays where it was, and the line climbs to the result at the buzzer.
    expect(data.points.at(-2)).toEqual({ t: at("06:20:13"), split: split(0.205), unobserved: false });
    expect(readingAt(at("06:21:00"), data, basis).split?.top, "before the buzzer, the in-game price").toBe(0.205);
  });

  it("leaves a final whose market settled in time, the live path and the broadcast's ticks at p as they were", () => {
    // Settled before the last play (as MIN @ CLE did): nothing to move.
    const early = [
      { t: at("06:00:00"), split: split(0.5), unobserved: false },
      { t: at("06:20:00"), split: split(0.999), unobserved: false },
    ];
    expect(finalPoints(early, buzzer)).toEqual(early);
    // Live and broadcasting, before the shot: only the ticks ≤ p, the newest of them the end.
    const p = at("06:20:30");
    const live = makeChartData({ feed, basis, history: shownUntil(history, p), state: "live", window: GAME, eventStart, now: opened, until: p })!;
    expect(chartHead(live)).toEqual({ t: at("06:20:13"), split: split(0.205), unobserved: false });
    expect(live.points.every((x) => x.t <= p)).toBe(true);
    // Live without a broadcast: every point as it came, none synthesized, the newest the end.
    const after = makeChartData({ feed, basis, history, state: "live", window: GAME, eventStart, now: opened })!;
    expect(chartHead(after)!.t).toBe(series.top.at(-1)!.t);
    expect(after.points).toHaveLength(series.top.length);
  });
});
