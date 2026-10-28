import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkedFocusStore, matches, nearest } from "../../src/features/game/core/linked";
import { spokenLinescore } from "../../src/features/game/core/CommonSections";
import { summary } from "../../src/features/game/mlb/SprayChart";
import type { BattedBall } from "../../src/data/gameDetail";

describe("linked focus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows a hover once the pointer settles (80 ms), then follows at once", () => {
    const store = new LinkedFocusStore();
    let changes = 0;
    store.subscribe(() => changes++);
    store.hover({ play: "a" }, true);
    expect(store.focus()).toBeNull();
    // Moving on during the wait retargets it rather than starting over.
    vi.advanceTimersByTime(50);
    store.hover({ play: "b" }, true);
    vi.advanceTimersByTime(30);
    expect(store.focus()).toEqual({ play: "b" });
    store.hover({ play: "c" }, true);
    expect(store.focus()).toEqual({ play: "c" });
    expect(changes).toBe(2);
  });

  it("clears after a short grace, so crossing to a neighbor doesn't flash", () => {
    const store = new LinkedFocusStore();
    store.hover({ play: "a" }, true);
    vi.advanceTimersByTime(80);
    store.hover({ play: "a" }, false);
    expect(store.focus()).toEqual({ play: "a" });
    store.hover({ period: 5, side: "top" }, true);
    expect(store.focus()).toEqual({ period: 5, side: "top" });
    store.hover({ period: 5, side: "top" }, false);
    vi.advanceTimersByTime(80);
    expect(store.focus()).toBeNull();
  });

  it("leaving before it ever showed shows nothing", () => {
    const store = new LinkedFocusStore();
    store.hover({ play: "a" }, true);
    store.hover({ play: "a" }, false);
    vi.advanceTimersByTime(200);
    expect(store.focus()).toBeNull();
  });

  it("pins on a click, shows the pin when nothing is hovered, and Esc unpins", () => {
    const store = new LinkedFocusStore();
    store.togglePin({ play: "a" });
    expect(store.focus()).toEqual({ play: "a" });
    store.hover({ play: "b" }, true);
    vi.advanceTimersByTime(80);
    expect(store.focus()).toEqual({ play: "b" });
    store.clear();
    expect(store.focus()).toEqual({ play: "a" });
    expect(store.unpin()).toBe(true);
    expect(store.unpin()).toBe(false);
    expect(store.focus()).toBeNull();
  });

  it("holds the hover while the pointer rests on the chart peek, and lets go with the usual grace", () => {
    const store = new LinkedFocusStore();
    store.hover({ play: "a" }, true);
    vi.advanceTimersByTime(80);
    // Off the row and onto the peek within the grace: the hover stays.
    store.hover({ play: "a" }, false);
    store.hold(true);
    vi.advanceTimersByTime(500);
    expect(store.focus()).toEqual({ play: "a" });
    expect(store.hovering()).toEqual({ play: "a" });
    // Leaving the page while held clears nothing.
    store.clear();
    expect(store.focus()).toEqual({ play: "a" });
    store.hold(false);
    vi.advanceTimersByTime(80);
    expect(store.focus()).toBeNull();
  });

  it("pins a hovered focus for the peek's click, and the pin outlives the hover", () => {
    const store = new LinkedFocusStore();
    store.hover({ play: "a" }, true);
    vi.advanceTimersByTime(80);
    store.pinFocus({ play: "a" });
    store.clear();
    expect(store.hovering()).toBeNull();
    expect(store.focus()).toEqual({ play: "a" });
  });

  it("matches a play, or everything in a period (for one team, if given)", () => {
    expect(matches({ play: "a", period: 5 }, { play: "a" })).toBe(true);
    expect(matches({ play: "a", period: 5 }, { play: "b", period: 5 })).toBe(false);
    expect(matches({ period: 5, side: "top" }, { play: "x", period: 5, side: "top" })).toBe(true);
    expect(matches({ period: 5, side: "top" }, { play: "x", period: 5, side: "bottom" })).toBe(false);
    expect(matches({ period: 5 }, { play: "x", period: 5, side: "bottom" })).toBe(true);
    expect(matches(null, { play: "a" })).toBe(false);
  });

  it("finds the nearest mark within reach; lines take a tighter reach", () => {
    const marks = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 40, x2: 100, y2: 40 }];
    expect(nearest(marks, 3, 0)).toBe(0);
    expect(nearest(marks, 15, 0)).toBe(1);
    expect(nearest(marks, 50, 52)).toBeNull();
    expect(nearest(marks, 50, 46)).toBe(2);
  });
});

describe("chart words", () => {
  it("reads a line score totals first", () => {
    const line = { headers: ["1", "2", "R", "H", "E"], top: ["0", "2", "2", "5", "1"], bottom: ["1", "0", "1", "3", "0"] };
    expect(spokenLinescore(line, 3, "Brewers", "Rays")).toBe(
      "Brewers: 2 runs, 5 hits, 1 error. By inning: 0, 2. Rays: 1 run, 3 hits, 0 errors. By inning: 1, 0.",
    );
  });

  it("sums the balls in play per team", () => {
    const ball = (side: "top" | "bottom", outcome: BattedBall["outcome"]): BattedBall => ({ id: `${side}${outcome}${Math.random()}`, x: 0, y: 0, outcome, side, text: "", period: 1 });
    const balls = [ball("top", "single"), ball("top", "homeRun"), ball("top", "out"), ball("bottom", "extraBases")];
    expect(summary(balls, "MIL", "TB")).toBe("MIL 2 hits, 1 HR · TB 1 hit");
  });
});
