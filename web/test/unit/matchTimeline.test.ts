/**
 * One timeline for every sport (MatchTimeline.swift), ported check by check
 * from Tests/MatchTimelineTests.swift on its recorded games: what's plotted
 * (soccer's goals and cards, the NBA's Key Plays, football's scoring plays
 * and turnovers, baseball's runs), soccer's clock against the wall, the
 * minutes and wall-clock axes per sport, zooms and live, and alignment with
 * Win Probability. The Swift's pixel test renders both modules and measures
 * the two rules' columns; here the two modules' geometry is compared at the
 * same widths (the page's e2e measures the drawn rules: odds.spec.ts).
 */
import { describe, expect, it } from "vitest";
import { OddsLayout, plotHeight } from "../../src/data/odds/chart";
import { GAME, historyDomain, historyStart, periodWindow, shownUntil, type OddsWindow } from "../../src/data/odds/history";
import { SoccerClock, timelineMarks, type TimelineMark } from "../../src/data/odds/marks";
import { axisX, minutesAxis, TIMELINE_PLOT_HEIGHT, timelineSpans, wallAxis, type TimelineAxis } from "../../src/data/odds/timeline";
import type { DetailMoment } from "../../src/data/gameDetail";
import { gameNamed, historyOf, liveAt, timelineGames, type TimelineGame } from "./timelineGames";

/** A 9pt medium label's width, near enough: the axis only asks whether a name fits its span. */
const measure = (text: string) => text.length * 5.6;
const labels = (axis: TimelineAxis) => axis.labels.map((l) => l.text);
const moment = (o: Partial<DetailMoment> & Pick<DetailMoment, "id" | "kind">): DetailMoment => ({ clock: "", text: "", side: "top", minute: null, score: null, period: null, ...o });

describe("what's plotted", () => {
  const soccer = gameNamed("soccer");
  const nfl = gameNamed("NFL");
  const nba = gameNamed("NBA");
  const mlb = gameNamed("MLB");

  it("soccer plots its goals and cards, by the same IDs as Key Events, on the wall clock", () => {
    const marks = timelineMarks(soccer.detail);
    expect(marks.filter((m) => m.moment.kind === "goal")).toHaveLength(3);
    expect(marks).toHaveLength(soccer.detail.moments.length);
    expect(marks.every((m) => m.t != null)).toBe(true);
  });

  it("the NBA plots the curated Key Plays, never every basket; a period's end is a landmark", () => {
    const marks = timelineMarks(nba.detail);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.length).toBeLessThan(40);
    expect(marks.every((m) => m.moment.kind === "score" && m.t != null && m.moment.side != null)).toBe(true);
    expect(new Set(marks.map((m) => m.moment.id))).toEqual(new Set(nba.detail.moments.filter((m) => m.kind !== "other").map((m) => m.id)));
  });

  it("football plots its scoring plays and turnovers, a turnover in the lane of the team that gave it away, in time order", () => {
    const marks = timelineMarks(nfl.detail);
    const kinds = marks.map((m) => m.moment.kind);
    expect(kinds.filter((k) => k === "score")).toHaveLength(13);
    expect(kinds.filter((k) => k === "turnover")).toHaveLength(1);
    expect(marks.find((m) => m.moment.kind === "turnover")!.moment.side).toBe("bottom");
    const times = marks.flatMap((m) => (m.t != null ? [m.t] : []));
    expect(times.every((t, k) => k === 0 || times[k - 1]! <= t), "marks in time order, what ⌥←/→ walks").toBe(true);
  });

  it("baseball plots its runs, each in the batting team's lane", () => {
    const marks = timelineMarks(mlb.detail);
    expect(marks).toHaveLength(5);
    expect(marks.every((m) => m.moment.kind === "score" && m.moment.side != null)).toBe(true);
  });

  it("without timestamps keeps soccer's marks on their minutes; a goal missing only its wall time lands by its minute", () => {
    const untimed = timelineMarks({
      history: { ...historyOf(soccer), events: [], periods: [] },
      moments: [moment({ id: "g", kind: "goal", clock: "38'", text: "A Goal", minute: 38 }), moment({ id: "n", kind: "goal", text: "No minute" })],
    });
    expect(untimed.map((m) => m.moment.id), "no timestamps: soccer's marks stay on their minutes").toEqual(["g"]);
    expect(untimed[0]!.t).toBeNull();
    const partial = timelineMarks({ history: historyOf(soccer), moments: [moment({ id: "untimed", kind: "goal", clock: "38'", text: "A Goal", minute: 38 })] });
    expect(partial[0]!.t, "a goal without a wall time is placed by its minute, from its half's kickoff").toBe(historyStart(historyOf(soccer))! + 38 * 60_000);
  });

  it("runs soccer's clock against the wall: each half 1:1 from its own kickoff, the break and second half projected", () => {
    const h = historyOf(soccer);
    const start = historyStart(h)!;
    const second = h.periods[1]!.start;
    const clock = new SoccerClock(start, h.periods, null);
    expect([clock.wall(38), clock.wall(45), clock.wall(70)]).toEqual([start + 38 * 60_000, start + 45 * 60_000, second + 25 * 60_000]);
    expect([clock.breakStart, clock.secondHalf]).toEqual([h.periods[0]!.end, second]);
    expect(Math.abs(clock.minute(start + 38 * 60_000) - 38)).toBeLessThan(1e-9);
    expect(Math.abs(clock.minute(second + 60_000) - 46), "and back").toBeLessThan(1e-9);
    const early = new SoccerClock(start, [{ number: 1, label: "1st", start, end: start + 600_000 }], start + 600_000);
    expect([early.secondHalf, early.breakStart, early.wall(90)], "in the first half, the break and the second half are projected").toEqual([start + 63 * 60_000, start + 48 * 60_000, start + 108 * 60_000]);
    const longBreak = new SoccerClock(start, [{ number: 1, label: "1st", start, end: start + 49 * 60_000 }], start + 70 * 60_000);
    expect([longBreak.secondHalf, longBreak.breakStart], "a long break pushes the second half along").toEqual([start + 70 * 60_000, start + 49 * 60_000]);
  });
});

describe("the axes", () => {
  const mark = (minute: number): TimelineMark => ({ moment: moment({ id: String(minute), kind: "goal", minute }), t: null });

  it("match minutes: soccer as it always was", () => {
    const compact = minutesAxis(312, [mark(38)], null, false);
    expect(labels(compact), "minutes, compact: 0', HT, 90', no ticks").toEqual(["0'", "HT", "90'"]);
    expect([compact.ticks.length, compact.tinted.length, compact.now]).toEqual([0, 0, null]);
    const large = minutesAxis(500, [mark(38)], 67, true);
    expect(labels(large), "minutes, large: a tick every 15', the now dot and the time played").toEqual(["0'", "HT", "90'", "15'", "30'", "60'", "75'"]);
    expect([large.ticks.length, large.now != null, large.played.length]).toEqual([4, true, 1]);
    const stoppage = minutesAxis(500, [mark(93)], null, true);
    expect(labels(stoppage), "stoppage: the end is the last minute").toContain("93'");
    expect(labels(stoppage), "90' keeps its line and not its label").not.toContain("90'");
    expect([stoppage.tinted.length, stoppage.ticks.length], "tinted past 90'").toEqual([1, 5]);
    expect(axisX(large, mark(45)), "half-time at 45'").toBe(large.landmarks[0]);
  });

  it("never builds a backwards track when narrower than its gutter (where the Swift's range would trap)", () => {
    const tiny = minutesAxis(0, [mark(38)], 67, false);
    expect(tiny.track.to).toBeGreaterThanOrEqual(tiny.track.from);
    expect(tiny.played.every((s) => s.to >= s.from) && tiny.tinted.every((s) => s.to >= s.from)).toBe(true);
  });

  /** As the Swift's helper: a final unless `now`, the history as presented, the domain both modules share. */
  function wall(game: TimelineGame, o: { window?: OddsWindow; now?: number; width?: number; large?: boolean } = {}): TimelineAxis {
    const window = o.window ?? GAME;
    const now = o.now ?? null;
    const state = now == null ? "final" : "live";
    const history = now != null ? shownUntil(historyOf(game), now) : historyOf(game);
    const domain = historyDomain(history, state, window, game.event.start, now, now);
    return wallAxis({ history, domain, now, labelWidth: 40, window }, o.width ?? 500, o.large ?? true, measure);
  }

  it("soccer on the wall clock keeps 0', HT and the last minute, its quarter hours, and the break at its real width", () => {
    const soccer = gameNamed("soccer");
    const h = historyOf(soccer);
    const final = wall(soccer);
    expect(labels(final).slice(0, 3)).toEqual(["0'", "HT", "96'"]);
    expect(labels(final)).toContain("15'");
    expect(labels(final)).toContain("75'");
    const layout = final.layout!;
    expect(final.landmarks, "half-time sits in the break, which keeps its real width").toHaveLength(1);
    expect(final.landmarks[0]! > layout.x(h.periods[0]!.end) && final.landmarks[0]! < layout.x(h.periods[1]!.start)).toBe(true);
    expect(final.tinted, "the break and second-half stoppage tinted").toHaveLength(2);
    expect(final.tinted[1]!.to).toBe(final.track.to);
    expect([final.now, final.played.length], "a final has no fill and no now").toEqual([null, 0]);
    expect(wall(soccer, { large: false }).ticks, "compact: no quarter hours, as ever").toEqual([]);
  });

  it("a live first half: the second half pencilled in, the time played filled; ten minutes on, only the now dot has moved", () => {
    const soccer = gameNamed("soccer");
    const start = historyStart(historyOf(soccer))!;
    const live = wall(soccer, { now: start + 30 * 60_000 });
    const later = wall(soccer, { now: start + 40 * 60_000 });
    expect(labels(live).slice(0, 3)).toEqual(["0'", "HT", "90'"]);
    expect([live.now != null, live.played.length]).toEqual([true, 1]);
    expect(live.layout!.domain).toEqual(later.layout!.domain);
    expect(live.now!).toBeLessThan(later.now!);
    expect(live.labels.find((l) => l.text === "90'")!.x).toBe(later.labels.find((l) => l.text === "90'")!.x);
  });

  it("zoomed to a half: its minutes every 15', a tick every 5'; the second half from 45', stoppage tinted", () => {
    const soccer = gameNamed("soccer");
    const half = wall(soccer, { window: periodWindow(1) });
    expect(labels(half)).toContain("15'");
    expect(labels(half)).toContain("30'");
    expect(labels(half)[0]).toBe("0'");
    expect(half.ticks.length).toBeGreaterThanOrEqual(8);
    const second = wall(soccer, { window: periodWindow(2) });
    expect(labels(second)[0]).toBe("45'");
    expect(labels(second)).toContain("60'");
    expect(second.tinted).toHaveLength(1);
  });

  it("names quarters and innings; marks each break at its real width; zooms show the clock or the halves", () => {
    const nfl = gameNamed("NFL");
    const nba = gameNamed("NBA");
    const mlb = gameNamed("MLB");
    expect(labels(wall(nfl)), "quarters, by name").toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(labels(wall(nba))).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect([wall(nba).landmarks.length, wall(nba).tinted.length], "each break marked at its real width").toEqual([3, 3]);
    expect(labels(wall(mlb)), "innings, by number: baseball has no clock").toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    const quarter = wall(nba, { window: periodWindow(3) });
    expect(labels(quarter)[0], "zoomed to a quarter: what the game clock said, from the plays reported").toBe("Q3");
    expect(labels(quarter)).toContain("9:00");
    expect(labels(quarter)).toContain("6:00");
    expect(quarter.ticks.length).toBeGreaterThan(0);
    const inning = wall(mlb, { window: periodWindow(6) });
    expect(labels(inning), "zoomed to an inning: its two halves").toEqual(["Top 6", "Bot 6"]);
    expect(inning.landmarks).toHaveLength(1);
    const liveNBA = wall(nba, { now: historyStart(historyOf(nba))! + 1_800_000 });
    expect(labels(liveNBA).every((l) => l === "Q1" || l === "Q2"), "live: only the periods reached are named, nothing about the future").toBe(true);
    expect(liveNBA.now).not.toBeNull();
    const spans = timelineSpans(historyOf(nba).periods, wall(nba).layout!, false);
    expect(spans.map((s) => s.label), "the labels' row: every period clickable, edge to edge").toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(spans.every((s, k) => k === 0 || spans[k - 1]!.x.to === s.x.from)).toBe(true);
    expect(timelineSpans(historyOf(nba).periods, wall(nba, { window: periodWindow(2) }).layout!, false).map((s) => s.number), "zoomed: the one period").toEqual([2]);
  });
});

describe("alignment with Win Probability", () => {
  /** Where each module draws `t` at a width: the timeline's wall axis and the odds plot's layout, the same labels' column. */
  function columns(game: TimelineGame, width: number, t: number, window: OddsWindow = GAME, now: number | null = null): [number, number] {
    const state = now == null ? "final" : "live";
    const history = now != null ? shownUntil(historyOf(game), now) : historyOf(game);
    const domain = historyDomain(history, state, window, game.event.start, now, now);
    const axis = wallAxis({ history, domain, now, labelWidth: 52, window }, width, width >= 460, measure);
    const odds = new OddsLayout(width, plotHeight(width), domain, 52, now);
    return [axis.layout!.x(t), odds.x(t)];
  }

  for (const g of timelineGames()) {
    it(`${g.name}: the timeline and the odds draw the same moment in the same column, at every width, live and zoomed`, () => {
      const h = historyOf(g);
      for (const width of [312, 380, 470, 620]) {
        const domain = historyDomain(h, "final", GAME, g.event.start);
        for (const fraction of [0, 0.37, 1]) {
          const [a, b] = columns(g, width, domain.from + (domain.to - domain.from) * fraction);
          expect(Math.abs(a - b)).toBeLessThan(0.25);
        }
      }
      const { game: live, now } = liveAt(g, 0.6);
      const [a, b] = columns(live, 470, now - 600_000, GAME, now);
      expect(Math.abs(a - b), `${g.name} live: aligned on the stable axis`).toBeLessThan(0.25);
      const period = h.periods[1];
      if (period) {
        const [c, d] = columns(g, 470, period.start + (period.end - period.start) / 2, periodWindow(period.number));
        expect(Math.abs(c - d), `${g.name} zoomed to ${period.label}: aligned`).toBeLessThan(0.25);
      }
      // Both plots stop at the same right edge and share their height's top inset.
      const domain = historyDomain(h, "final", GAME, g.event.start);
      const timeline = new OddsLayout(470, TIMELINE_PLOT_HEIGHT, domain, 52);
      const odds = new OddsLayout(470, plotHeight(470), domain, 52);
      expect([timeline.plot.x, timeline.plot.width]).toEqual([odds.plot.x, odds.plot.width]);
    });
  }
});
