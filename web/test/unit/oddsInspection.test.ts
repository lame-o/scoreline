/**
 * Reading the odds at a moment (OddsChart.swift `OddsChartData`,
 * `OddsReading`), ported check by check from Tests/OddsInspectionTests.swift:
 * never a price from the future, no reading across a stretch nobody
 * observed, the crosshair's dots on the drawn lines, the readout in plain
 * words, the final's rounding policy, and one timeline beside Win
 * Probability in every sport's plan. Times are epoch ms.
 */
import { describe, expect, it } from "vitest";
import { drawnAt, observedPoint, percents, readingAt, readingLead, usesFinalPercentages, type OddsChartData } from "../../src/data/odds/chart";
import { GAP, percent, type OddsSplit, type OddsSplitPoint } from "../../src/data/odds/polymarket";
import type { PlayMark } from "../../src/data/odds/espn";
import type { TimelineMark } from "../../src/data/odds/marks";
import type { EventRef, EventState, Sport } from "../../src/data/models";
import { NBA_PATH } from "../../src/data/providers/espn";
import { sectionOrder, widePlan } from "../../src/data/sections";

const S = 1000;
const start = 1_800_000_000_000;
const split = (top: number, bottom = 1 - top, draw: number | null = null): OddsSplit => ({ top, draw, bottom });
const point = (t: number, s: OddsSplit, unobserved = false): OddsSplitPoint => ({ t, split: s, unobserved });

function chart(o: Partial<OddsChartData> & Pick<OddsChartData, "points" | "domain">): OddsChartData {
  return { revision: 1, threeWay: false, espn: [], periods: [], live: true, final: false, now: null, zoomed: false, endVisible: true, ...o };
}

describe("odds inspection", () => {
  const sample = point(start + 30 * S, split(0.6));
  const data = chart({ points: [sample], domain: { from: start, to: start + 100 * S } });

  it("never borrows a future sample; reports the last observed probability, its own at an exact sample", () => {
    expect(observedPoint(data, start + 29 * S), "an inspection never borrows a future market sample").toBeNull();
    expect(observedPoint(data, start + 30 * S)?.split, "inspection reports the last observed probability").toEqual(sample.split);
    expect(observedPoint(data, start + 60 * S)?.split, "including a quiet market").toEqual(sample.split);
    const swing = chart({ ...data, points: [sample, point(start + 90 * S, split(0.8))] });
    expect(observedPoint(swing, start + 60 * S), "between samples, the reading keeps the earlier sample's real value").toEqual(sample);
    expect(observedPoint(swing, start + 29 * S)).toBeNull();
    expect(observedPoint(swing, start + 90 * S), "an exact sample inspection uses its own timestamp").toEqual(swing.points.at(-1));
    const middle = drawnAt(swing, start + 60 * S)!;
    expect(Math.abs(middle.top - 0.7) < 1e-9 && Math.abs(middle.bottom - 0.3) < 1e-9, "the crosshair's dots sit on the drawn lines at the rule, between samples too").toBe(true);
    expect(drawnAt(swing, start + 29 * S), "nothing before the first").toBeNull();
  });

  it("has no reading and no line across a stretch nobody observed", () => {
    const broken = chart({ ...data, points: [sample, point(start + 30 * S + GAP + 60 * S, split(0.2))] });
    const inGap = start + 30 * S + GAP + 30 * S;
    expect([observedPoint(broken, inGap), drawnAt(broken, inGap), drawnAt(broken, start + 60 * S)], "inside a gap there's no reading and nothing to put a dot on").toEqual([null, null, null]);
    const stale = chart({ ...data, points: [sample, point(start + 90 * S, split(0.2), true)] });
    expect([observedPoint(stale, start + 91 * S), drawnAt(stale, start + 91 * S)], "a moment one outcome wasn't observed isn't a reading").toEqual([null, null]);
  });

  it("names where in the game and each source's chance, never an upcoming play", () => {
    let plays: PlayMark[] = [
      { t: start + 40 * S, period: 1, clock: "Q1 10:00", text: "First score" },
      { t: start + 80 * S, period: 1, clock: "Q1 9:45", text: "Second score" },
    ];
    const basis = () => ({ start: plays[0]?.t ?? null, plays });
    const before = readingAt(start + 20 * S, data, basis());
    expect([before.split, before.play], "a gap has an inspectable time without a fabricated quote or play").toEqual([null, null]);
    const between = readingAt(start + 79 * S, data, basis());
    expect(between.play?.text, "a near-future score cannot appear in the historical readout").toBe("First score");
    expect(between.t, "the reading keeps the moment asked for").toBe(start + 79 * S);
    expect(readingLead(between, "GSW", false), "the footer says it in plain words: where in the game, and the top team's chance").toBe("Q1 10:00 · GSW 60%");
    const withModel = chart({ ...data, espn: [{ t: start, top: 0.58, draw: 0 }] });
    plays = [{ t: start, period: 1, clock: "Q1 12:00", text: "Tip" }, ...plays];
    expect(readingLead(readingAt(start + 41 * S, withModel, basis()), "GSW", false), "with ESPN's model: Q1 10:00 · GSW 60% · ESPN 58%").toBe("Q1 10:00 · GSW 60% · ESPN 58%");
    plays = plays.slice(1);
    const goal: TimelineMark = { moment: { id: "g", kind: "goal", clock: "38'", text: "Marcus Tavernier Goal", side: "bottom", minute: null, score: null, period: null }, t: start + 60 * S };
    expect(readingAt(start + 60 * S, data, basis(), [goal]).play?.text, "exactly on a key play, the reading names it").toBe("Marcus Tavernier");
  });

  it("keeps in-game caps on an inspected quote after the game; only Latest and the exact final endpoint show 0/100", () => {
    const plays: PlayMark[] = [
      { t: start + 40 * S, period: 1, clock: "Q1 10:00", text: "First score" },
      { t: start + 80 * S, period: 1, clock: "Q1 9:45", text: "Second score" },
    ];
    const basis = { start: plays[0]!.t, plays };
    const nearCertain = point(start + 90 * S, split(0.998, 0.002));
    const finished = chart({ points: [nearCertain], espn: [{ t: nearCertain.t, top: 0.998, draw: 0 }], domain: { from: start, to: start + 100 * S }, live: false, final: true });
    const historical = readingAt(start + 99 * S, finished, basis);
    const endpoint = readingAt(start + 100 * S, finished, basis);
    const historicalFinal = usesFinalPercentages(finished, historical.t);
    const endpointFinal = usesFinalPercentages(finished, endpoint.t);
    expect([historicalFinal, endpointFinal, usesFinalPercentages(finished, null)], "only Latest and the exact final endpoint allow final percentages").toEqual([false, true, true]);
    expect(percents(historical.split!, historicalFinal), "historical header and AX retain in-game caps after the event finishes").toEqual({ top: 99, bottom: 1 });
    expect(percents(endpoint.split!, endpointFinal), "inspecting the exact final endpoint matches Latest market percentages").toEqual(percents(nearCertain.split, usesFinalPercentages(finished, null)));
    expect(percents(endpoint.split!, endpointFinal)).toEqual({ top: 100, bottom: 0 });
    expect([percent(historical.espn!, historicalFinal), percent(endpoint.espn!, endpointFinal)], "ESPN source-line rounding follows the same historical and final policy").toEqual([99, 100]);
    expect([historical.split, endpoint.split, finished.points], "final presentation preserves the observed market price").toEqual([nearCertain.split, nearCertain.split, [nearCertain]]);
    expect(percents(split(0.6), endpointFinal), "final formatting never fabricates a resolved winner from an unsettled quote").toEqual({ top: 60, bottom: 40 });
    const threeWay = split(0.998, 0.001, 0.001);
    expect([percents(threeWay, historicalFinal), percents(threeWay, endpointFinal)], "three-way history and final readings share the same percentage policy").toEqual([
      { top: 98, draw: 1, bottom: 1 },
      { top: 100, draw: 0, bottom: 0 },
    ]);
    const live = { ...finished, final: false };
    expect([usesFinalPercentages(live, null), usesFinalPercentages(live, live.domain.to)], "a live chart endpoint never enables final percentages").toEqual([false, false]);
  });

  it("gives every sport one timeline, beside Win Probability in the same column, live and final", () => {
    for (const sport of ["soccer", "football", "basketball", "baseball"] as Sport[]) {
      const ref: EventRef = { kind: "espn", path: sport === "basketball" ? NBA_PATH : "test", id: "1", sport };
      for (const state of ["live", "final"] as EventState[]) {
        const order = sectionOrder(ref, state);
        const wide = widePlan(ref, state);
        const sections = wide.flatMap((p) => (p.kind === "columns" ? [...p.left, ...p.right] : [p.section]));
        expect(order.filter((s) => s === "timeline").length + sections.filter((s) => s === "timeline").length, `${sport} ${state} has one timeline in narrow and wide layouts`).toBe(2);
        const column = wide.flatMap((p) => (p.kind === "columns" ? [p.left.includes("winProbability") ? p.left : p.right.includes("winProbability") ? p.right : null] : [])).find((c) => c != null);
        expect(column?.includes("timeline"), `${sport} ${state} odds and timeline share the same column width`).toBe(true);
      }
    }
  });
});
