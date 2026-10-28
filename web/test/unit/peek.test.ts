/**
 * The chart peek's decisions (data/peek.ts, LinkedPeek.swift): which chart a
 * row lights from afar, per sport; what the pill says; when it shows, where
 * it docks and when it goes; its sizes; a climber's excerpt.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_PEEK_INPUT,
  peekChartCap,
  peekCompactWidth,
  PeekController,
  peekHeight,
  peekMode,
  peekReadout,
  peekTarget,
  wallExcerpt,
  type PeekClock,
  type PeekInput,
  type PeekInputs,
} from "../../src/data/peek";
import type { Section } from "../../src/data/sections";

const shown = (...s: Section[]) => new Set<Section>(s);

describe("peekTarget", () => {
  it("soccer: a key event lights its shot on the pitch, else its mark on the timeline", () => {
    const inputs: PeekInputs = { shown: shown("pitch", "timeline", "moments"), pitch: [{ id: "g1" }], timeline: [{ id: "g1" }, { id: "y2" }] };
    expect(peekTarget({ play: "g1" }, "soccer", inputs, "moments")).toBe("pitch");
    expect(peekTarget({ play: "y2" }, "soccer", inputs, "moments")).toBe("timeline");
    expect(peekTarget({ play: "zz" }, "soccer", inputs, "moments")).toBeNull();
    // Never a guess: no play, nothing to light.
    expect(peekTarget({ period: 1 }, "soccer", inputs, "moments")).toBeNull();
  });

  it("never peeks from a chart's own marks (its footer reads them out)", () => {
    const inputs: PeekInputs = { shown: shown("pitch", "timeline"), pitch: [{ id: "g1" }], timeline: [{ id: "g1" }] };
    expect(peekTarget({ play: "g1" }, "soccer", inputs, "timeline")).toBeNull();
    expect(peekTarget({ play: "g1" }, "soccer", inputs, "pitch")).toBeNull();
  });

  it("a pin (no source) routes like a row", () => {
    const inputs: PeekInputs = { shown: shown("pitch"), pitch: [{ id: "g1" }] };
    expect(peekTarget({ play: "g1" }, "soccer", inputs, null)).toBe("pitch");
  });

  it("baseball: a play or an inning lights its balls in play, else the inning in the line score", () => {
    const inputs: PeekInputs = { shown: shown("battedBalls", "linescore", "moments"), balls: [{ id: "b1", period: 3, side: "top" }] };
    expect(peekTarget({ play: "b1", period: 3, side: "top" }, "baseball", inputs, "moments")).toBe("battedBalls");
    expect(peekTarget({ period: 3, side: "top" }, "baseball", inputs, "linescore")).toBe("battedBalls");
    expect(peekTarget({ play: "walk", period: 5, side: "bottom" }, "baseball", inputs, "moments")).toBe("linescore");
    // The line score is the source: it doesn't peek at itself.
    expect(peekTarget({ period: 5, side: "bottom" }, "baseball", inputs, "linescore")).toBeNull();
  });

  it("NBA: a play, a player or a quarter lights its shots on the court, else the game flow", () => {
    const inputs: PeekInputs = { shown: shown("court", "flow", "box", "moments"), shots: [{ id: "s1", period: 2, side: "top", player: "p9" }], flow: [{ id: "f1", period: 4 }] };
    expect(peekTarget({ player: "p9" }, "nba", inputs, "box")).toBe("court");
    expect(peekTarget({ period: 2 }, "nba", inputs, "linescore")).toBe("court");
    expect(peekTarget({ play: "f1", period: 4 }, "nba", inputs, "moments")).toBe("flow");
    expect(peekTarget({ player: "nobody" }, "nba", inputs, "box")).toBeNull();
  });

  it("football: a scoring play lights its quarter", () => {
    const inputs: PeekInputs = { shown: shown("linescore", "moments", "field") };
    expect(peekTarget({ play: "td", period: 2, side: "top" }, "football", inputs, "moments")).toBe("linescore");
    expect(peekTarget({ play: "snap" }, "football", inputs, "moments")).toBeNull();
    // The drive list isn't a source: its bars are on the same field.
    expect(peekTarget({ play: "td", period: 2 }, "football", inputs, "field")).toBeNull();
  });

  it("climbing: a result lights the climber on the wall, the high points, then the scorecards", () => {
    const inputs: PeekInputs = { shown: shown("ascent", "wall", "scorecard", "results"), ascent: [{ id: "7" }], wall: [{ id: "7" }, { id: "8" }], cards: [{ id: "9" }] };
    expect(peekTarget({ athlete: 7 }, "climbing", inputs, "results")).toBe("ascent");
    expect(peekTarget({ athlete: 8 }, "climbing", inputs, "startlist")).toBe("wall");
    expect(peekTarget({ athlete: 9 }, "climbing", inputs, "results")).toBe("scorecard");
  });

  it("CS2 and the rest don't peek, as on the Mac", () => {
    expect(peekTarget({ round: 3 }, "counterStrike", { shown: shown("rounds") }, null)).toBeNull();
  });
});

describe("peekReadout", () => {
  it("says what's lit, value first", () => {
    const inputs: PeekInputs = {
      shown: shown(),
      pitch: [{ id: "g1", lead: "52'", detail: "Haaland header" }],
      balls: [{ id: "b1", period: 3, side: "top", lead: "Home run", detail: "Yandy Díaz homered" }, { id: "b2", period: 3, side: "top", lead: "Out" }],
      shots: [{ id: "s1", player: "p9", lead: "Made 3" }, { id: "s2", player: "p9", lead: "Missed 2" }],
      names: { p9: "Anthony Edwards" },
      linescore: { headers: ["1", "2", "3", "R", "H", "E"], top: ["0", "2", "1"], bottom: ["1", "0", "0"], names: { top: "MIL", bottom: "TB" } },
    };
    expect(peekReadout({ play: "g1" }, "pitch", inputs)).toEqual({ lead: "52'", detail: "Haaland header" });
    expect(peekReadout({ period: 3, side: "top" }, "battedBalls", inputs)).toEqual({ lead: "3rd inning", detail: "2 in play" });
    expect(peekReadout({ player: "p9" }, "court", inputs)).toEqual({ lead: "Anthony Edwards", detail: "1 of 2 shots" });
    expect(peekReadout({ period: 2 }, "linescore", inputs)).toEqual({ lead: "2nd inning", detail: "MIL 2 · TB 0" });
  });
});

/** A clock moved by hand. */
function handClock() {
  let now = 0;
  let timers: { at: number; action: () => void; id: number }[] = [];
  let next = 0;
  const clock: PeekClock = {
    now: () => now,
    after: (ms, action) => {
      const id = next++;
      timers.push({ at: now + ms, action, id });
      return () => {
        timers = timers.filter((t) => t.id !== id);
      };
    },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      now = due.at;
      due.action();
    }
    now = end;
  };
  return { clock, advance };
}

const hover = (play: string, extra: Partial<PeekInput> = {}): PeekInput => ({ ...EMPTY_PEEK_INPUT, focus: { play }, target: "pitch", visibility: "hiddenAbove", ...extra });

describe("PeekController", () => {
  it("waits 260 ms of intent, not restarted as the pointer crosses rows", () => {
    const { clock, advance } = handClock();
    const c = new PeekController(clock);
    c.update(hover("a"));
    advance(150);
    c.update(hover("b"));
    expect(c.presented()).toBeNull();
    advance(110);
    expect(c.presented()).toEqual({ section: "pitch", dock: "top", points: "above" });
  });

  it("follows at once after the first, and a pin shows at once", () => {
    const { clock, advance } = handClock();
    const c = new PeekController(clock);
    c.update(hover("a"));
    advance(260);
    c.update(hover("b", { visibility: "hiddenBelow", target: "timeline" }));
    expect(c.presented()).toEqual({ section: "timeline", dock: "bottom", points: "below" });

    const d = new PeekController(clock);
    d.update(hover("a", { pinned: true }));
    expect(d.presented()).not.toBeNull();
  });

  it("goes 220 ms after the focus, but holds while the pointer is on it", () => {
    const { clock, advance } = handClock();
    const c = new PeekController(clock);
    c.update(hover("a", { pinned: true }));
    c.update({ ...EMPTY_PEEK_INPUT });
    advance(200);
    expect(c.presented()).not.toBeNull();
    c.update({ ...EMPTY_PEEK_INPUT, held: true });
    advance(1000);
    expect(c.presented()).not.toBeNull();
    c.update({ ...EMPTY_PEEK_INPUT });
    advance(220);
    expect(c.presented()).toBeNull();
    // A fresh hover waits again.
    c.update(hover("b"));
    expect(c.presented()).toBeNull();
  });

  it("hides when the chart comes into view, keeps doing what it did while partly in view, and nothing shows while blocked", () => {
    const { clock } = handClock();
    const c = new PeekController(clock);
    c.update(hover("a", { pinned: true }));
    c.update(hover("a", { pinned: true, visibility: "partialAbove" }));
    expect(c.presented()).not.toBeNull();
    c.update(hover("a", { pinned: true, visibility: "visible" }));
    expect(c.presented()).toBeNull();
    c.update(hover("a", { pinned: true, blocked: true }));
    expect(c.presented()).toBeNull();
  });

  it("takes the other edge when the pointer is in the chart's band, its chevron still pointing at the chart", () => {
    const { clock } = handClock();
    const c = new PeekController(clock);
    c.pointerInBand = (dock) => dock === "top";
    c.update(hover("a", { pinned: true }));
    expect(c.presented()).toEqual({ section: "pitch", dock: "bottom", points: "above" });
  });

  it("flashes the chart once a clicked peek's chart arrives", () => {
    const { clock } = handClock();
    const c = new PeekController(clock);
    const arrived: Section[] = [];
    c.onArrival = (s) => arrived.push(s);
    c.update(hover("a", { pinned: true }));
    c.expectArrival("pitch");
    c.update(hover("a", { pinned: true, visibility: "visible" }));
    expect(arrived).toEqual(["pitch"]);
    expect(c.arrivals("pitch")).toBe(1);
  });
});

describe("peek layout", () => {
  it("is a pill under 360pt tall, a column on two columns, else compact", () => {
    expect(peekMode({ width: 800, height: 340 }, true)).toBe("pill");
    expect(peekMode({ width: 800, height: 700 }, true)).toBe("column");
    expect(peekMode({ width: 400, height: 700 }, false)).toBe("compact");
  });

  it("sizes a compact peek from the chart's aspect at a plot 150pt tall at most", () => {
    const vp = { width: 400, height: 800 };
    expect(peekCompactWidth(vp, 105 / 68)).toBeCloseTo(150 * (105 / 68) + 20);
    expect(peekCompactWidth(vp, null)).toBe(380);
    expect(peekCompactWidth({ width: 200, height: 800 }, 3)).toBe(180);
    expect(peekHeight({ width: 400, height: 300 }, "compact")).toBeCloseTo(0.32 * 300 + 32);
    expect(peekChartCap({ height: 800 })).toBeCloseTo(0.42 * 800);
  });
});

describe("wallExcerpt", () => {
  const routes = [
    { name: "Final", total: 8, climbers: [1, 2, 3, 4, 5].map((id) => ({ id })) },
    { name: "Other", total: 8, climbers: [6, 7].map((id) => ({ id })) },
  ];
  it("keeps a climber and their neighbors, on the routes they're on", () => {
    expect(wallExcerpt(routes, 3)).toEqual([{ name: "Final", total: 8, climbers: [{ id: 2 }, { id: 3 }, { id: 4 }] }]);
    expect(wallExcerpt(routes, 1)[0]!.climbers.map((c) => c.id)).toEqual([1, 2]);
    expect(wallExcerpt(routes, 7)[0]!.climbers.map((c) => c.id)).toEqual([6, 7]);
  });
  it("shows every route for a climber on none", () => {
    expect(wallExcerpt(routes, 99)).toBe(routes);
  });
});
