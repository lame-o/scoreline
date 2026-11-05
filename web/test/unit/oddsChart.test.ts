/**
 * The odds chart following Polymarket (OddsChart.swift, 5364680 onward),
 * ported check by check from the parts of Tests/OddsTests.swift that changed
 * after Oct 29, on its recorded GSW @ MIN (Tests/Fixtures/odds): one fixed
 * 0–100% scale with the end labels' column, labels that dodge as a cluster,
 * chances that sum to 100, the draw's and the team lines' colors, live and
 * still ends, the glide, and readings. Times are epoch ms.
 */
import { describe, expect, it } from "vitest";
import {
  beatAfter,
  drawColor,
  endsLive,
  glideProgress,
  hourLabels,
  labelWidth,
  LABEL_HEIGHT,
  lineColor,
  mover,
  OddsLayout,
  percents,
  periodLabels,
  pregameDomain,
  PULSE_PERIOD_MS,
  readingAt,
  readingLead,
  splitAt,
  displaced,
  GLIDE_MS,
  type OddsChartData,
} from "../../src/data/odds/chart";
import { parseOddsBasis, playAtOrBefore } from "../../src/data/odds/espn";
import { normalized, parseHistory, type OddsSplit, type Outcome } from "../../src/data/odds/polymarket";
import { chroma, hue, oklabFromHex, teamPalette } from "../../src/data/teamColors";
import { sharedFixture } from "./fixtures";

const date = (s: string) => Date.parse(s);
const measureLabel = (text: string) => text.length * 6.2;
const measurePeriod = (text: string) => text.length * 5.6;
const nba = parseOddsBasis(sharedFixture("odds/espn-nba-401909888.json"), "basketball", false);
const history = parseHistory(sharedFixture("odds/pm-nba-gsw-min-history.json"));
const domain = { from: date("2026-10-29T00:10:41Z"), to: date("2026-10-29T02:43:59Z") };
const width = labelWidth(["GSW", "MIN", "Draw"], measureLabel);
const split = (top: number, bottom: number, draw: number | null = null): OddsSplit => ({ top, draw, bottom });

describe("ESPN's plays at a moment", () => {
  it("names the last play at a moment, with its clock", () => {
    const somePlay = nba.plays[200]!;
    const found = playAtOrBefore(nba, somePlay.t + 4000)!;
    expect(found.t === somePlay.t || found.t > somePlay.t).toBe(true);
    expect(somePlay.clock).toMatch(/^Q/);
    expect(somePlay.text).not.toContain("assists)");
  });
});

describe("the chart's geometry", () => {
  for (const w of [296, 620]) {
    it(`${w}pt: one fixed 0–100% scale, labels kept whole, every quarter named, inspection's exact endpoints`, () => {
      const layout = new OddsLayout(w, 124, domain, width);
      expect([layout.y(1), layout.y(0), layout.y(0.5)]).toEqual([layout.plot.y, layout.plot.y + layout.plot.height, layout.plot.y + layout.plot.height / 2]);
      expect(layout.labelX + width, "the end labels' column inside the well").toBeLessThanOrEqual(w);
      const whole = [0, 0.001, 0.5, 0.999, 1].every((p) => layout.endLabels(split(p, 1 - p), ["top", "bottom"]).every((l) => l.y - LABEL_HEIGHT / 2 >= 0 && l.y + LABEL_HEIGHT / 2 <= 124));
      expect(whole, "the end labels never clip, at 0%, 50% and 100%").toBe(true);
      expect(periodLabels(nba.periods, layout, measurePeriod).map((l) => l.label), "every quarter named under its own span").toEqual(["Q1", "Q2", "Q3", "Q4"]);
      const minute = date("2026-10-29T01:41:00Z");
      const fractional = { from: domain.from + 800, to: domain.to + 200 };
      const precise = new OddsLayout(w, 124, fractional, width);
      const right = precise.plot.x + precise.plot.width;
      expect([precise.inspectionTime(precise.plot.x), precise.inspectionTime(right)], "inspection preserves fractional start and final endpoint before rounding").toEqual([fractional.from, fractional.to]);
      expect([precise.inspectionTime(precise.plot.x - 20), precise.inspectionTime(right + 20)], "inspection outside the plot clamps to the exact fractional bounds").toEqual([fractional.from, fractional.to]);
      expect([precise.inspectionTime(precise.x(minute + 300)), precise.inspectionTime(precise.x(minute + 700))], "interior inspection retains whole-second precision").toEqual([minute, minute + 1000]);
    });
  }

  it("before the game: whole hours under the axis, 56pt apart at least", () => {
    const pregame = new OddsLayout(296, 124, { from: date("2026-10-28T20:00Z"), to: date("2026-10-29T00:10Z") }, width);
    const hours = hourLabels(pregame, (t) => new Intl.DateTimeFormat("en-US", { hour: "numeric" }).format(t));
    expect(hours.length).toBeGreaterThan(0);
    expect(hours.every((h, k) => k === 0 || h.x - hours[k - 1]!.x >= 56)).toBe(true);
    expect(hours.every((h) => h.x >= pregame.plot.x + 14 && h.x <= pregame.plot.x + pregame.plot.width - 14)).toBe(true);
  });
});

describe("end labels dodge as a cluster", () => {
  const compact = new OddsLayout(296, 124, domain, width);
  const three: Outcome[] = ["top", "draw", "bottom"];
  const apart = (ys: number[]) => [...ys].sort((a, b) => a - b).every((y, k, all) => k === 0 || y - all[k - 1]! >= LABEL_HEIGHT - 0.001);
  const mean = (ys: number[]) => ys.reduce((a, b) => a + b, 0) / ys.length;

  it("a near-tie (MUN 32 · Draw 32 · BOU 37): one cluster centered on its lines, in their order; leaders for the two moved off", () => {
    const close = compact.endLabels(split(0.32, 0.37, 0.32), three);
    expect(apart(close.map((l) => l.y))).toBe(true);
    expect(Math.abs(mean(close.map((l) => l.y)) - mean(close.map((l) => l.dot.y)))).toBeLessThan(0.01);
    expect([...close].sort((a, b) => a.y - b.y).map((l) => l.outcome)).toEqual(["bottom", "top", "draw"]);
    expect(close.map(displaced)).toEqual([false, true, true]);
  });

  it("a 98/2 blowout: each label on its own line; two outcomes at 0% stacked inside, led back to the line", () => {
    const blowout = compact.endLabels(split(0.98, 0.02), ["top", "bottom"]);
    expect(blowout.every((l) => !displaced(l) && l.y === l.dot.y)).toBe(true);
    const zeros = compact.endLabels(split(0, 1, 0), three);
    expect(apart(zeros.map((l) => l.y))).toBe(true);
    expect(zeros.every((l) => l.y - LABEL_HEIGHT / 2 >= 0 && l.y + LABEL_HEIGHT / 2 <= 124)).toBe(true);
    expect([zeros[0]!.y < zeros[1]!.y, displaced(zeros[0]!), displaced(zeros[1]!), displaced(zeros[2]!)]).toEqual([true, true, true, false]);
  });

  it("labels that fit stay put; three that collide share their mean; a cluster at the edge is held inside", () => {
    const range = { from: 6.5, to: 117.5 };
    expect(OddsLayout.dodge([20, 60, 100], 13, range)).toEqual([20, 60, 100]);
    expect(OddsLayout.dodge([50, 52, 54], 13, range)).toEqual([39, 52, 65]);
    expect(OddsLayout.dodge([10, 12, 30], 13, range).every((y) => y >= 6.5)).toBe(true);
  });
});

describe("rounding: the shown chances sum to 100", () => {
  const shown = (s: OddsSplit, final = false) => {
    const p = percents(s, final);
    return (s.draw == null ? (["top", "bottom"] as const) : (["top", "draw", "bottom"] as const)).map((o) => p[o] ?? -1);
  };

  it("two-way: the trailing side is 100 minus the leader (52.5/47.5 → 53/47; 97.5/2.5 → 98/2)", () => {
    expect(shown(split(0.525, 0.475))).toEqual([53, 47]);
    expect(shown(split(0.475, 0.525))).toEqual([47, 53]);
    expect(shown(split(0.975, 0.025))).toEqual([98, 2]);
  });

  it("every split, two-way or three-way, shows chances summing to exactly 100", () => {
    for (let p = 0; p <= 1.0000001; p += 0.0005) {
      const two = percents(split(p, 1 - p));
      const n = normalized(p, 0.3 * (1 - p), 0.7 * (1 - p) + 0.01);
      const sum = (x: Partial<Record<Outcome, number>>) => Object.values(x).reduce((a, b) => a + (b ?? 0), 0);
      expect((two.top ?? 0) + (two.bottom ?? 0)).toBe(100);
      expect(sum(percents(n))).toBe(100);
      expect(sum(percents(n, true))).toBe(100);
    }
  });

  it("three-way by largest remainder; never 0 or 100 until it's final", () => {
    expect(shown(split(0.3249, 0.3502, 0.3249))).toEqual([33, 32, 35]);
    expect(shown(split(0.996, 0.002, 0.002))).toEqual([98, 1, 1]);
    expect(shown(split(0, 1, 0), true)).toEqual([0, 0, 100]);
    expect(shown(split(0.999, 0.001))).toEqual([99, 1]);
    expect(shown(split(1, 0), true)).toEqual([100, 0]);
  });
});

describe("colors", () => {
  it("the draw recedes toward the surface: #aeaeae light, #5d5d5d dark (validated)", () => {
    expect([drawColor("light"), drawColor("dark")]).toEqual(["#aeaeae", "#5d5d5d"]);
  });

  it("team lines keep 0.10 chroma (City's sky blue on light lifts to it, same lightness and hue); vivid colors and gray stay", () => {
    const sky = teamPalette("99c5ea", null, "light").top;
    const before = oklabFromHex(sky)!;
    const after = oklabFromHex(lineColor(sky))!;
    expect(chroma(before)).toBeLessThan(0.1);
    expect(chroma(after)).toBeGreaterThanOrEqual(0.099);
    expect(Math.abs(after.l - before.l)).toBeLessThan(0.01);
    expect(Math.abs(hue(after) - hue(before))).toBeLessThan(2);
    expect(lineColor("#da020e")).toBe("#da020e");
    expect(lineColor("var(--viz-neutral)")).toBe("var(--viz-neutral)");
  });
});

describe("live and still", () => {
  it("every end is live while the market streams and the chart is seen; final, not streaming, off screen or Reduce Motion: still dots", () => {
    expect(endsLive(false, true, true, false)).toBe(true);
    expect([endsLive(true, true, true, false), endsLive(false, false, true, false), endsLive(false, true, false, false), endsLive(false, true, true, true)]).toEqual([false, false, false, false]);
  });

  it("the bright beat goes to the outcome that moved most (two-way, the side gaining); no move, no beat", () => {
    const level = split(0.3, 0.38, 0.32);
    expect(mover(split(0.55, 0.45), split(0.53, 0.47))).toBe("bottom");
    expect(mover(level, split(0.29, 0.41, 0.3))).toBe("bottom");
    expect(mover(level, split(0.27, 0.4, 0.33))).toBe("top");
    expect(mover(level, level)).toBeNull();
  });

  it("a beat lands on the next beat of the shared pulse, never out of step", () => {
    for (const t of [100_000, 101_700, 103_300, 250_050]) {
      const b = beatAfter(t, 100_000);
      const cycles = (b - 100_000) / PULSE_PERIOD_MS;
      expect(b).toBeGreaterThanOrEqual(t);
      expect(b).toBeLessThan(t + PULSE_PERIOD_MS);
      expect(Math.abs(cycles - Math.round(cycles))).toBeLessThan(1e-9);
    }
  });

  it("the glide eases out (8% a frame) and lands at exactly 0.5 s", () => {
    expect([glideProgress(0), glideProgress(GLIDE_MS), glideProgress(1000)]).toEqual([0, 1, 1]);
    expect(glideProgress(100)).toBeLessThan(glideProgress(200));
    expect(glideProgress(100)).toBeGreaterThan(0.4);
  });
});

describe("data and readings", () => {
  it("before the game: the market's last day, from its first point", () => {
    expect(pregameDomain(domain.from, domain.to, domain.to)).toEqual(domain);
  });

  it("a reading has Polymarket, ESPN, the clock, and the last play; the split at a minute is the point in effect then", () => {
    const points = history.map((h) => ({ t: h.t, split: split(h.p, 1 - h.p), unobserved: false }));
    const data: OddsChartData = { revision: 1, threeWay: false, points, espn: nba.win, periods: nba.periods, domain, live: false, final: true, now: null, zoomed: false, endVisible: true };
    const reading = readingAt(nba.plays[200]!.t + 10_000, data, nba);
    expect(reading.split).not.toBeNull();
    expect(reading.espn).not.toBeNull();
    expect(reading.play).not.toBeNull();
    expect(readingLead(reading, "GSW", false)).toContain("ESPN");
    expect(splitAt(data, -Infinity)).toEqual(points[0]!.split);
    expect(splitAt(data, Infinity)).toEqual(points.at(-1)!.split);
    expect(splitAt(data, points[10]!.t + 1000)).toEqual(points[10]!.split);
  });
});
