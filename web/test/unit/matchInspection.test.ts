/**
 * The shared moment (OddsChart.swift `OddsPointer`, MatchTimeline.swift
 * `MatchInspectionActions`), ported check by check from
 * Tests/MatchInspectionTests.swift: hover, pin, keys and zoom as state, what
 * a move makes readers re-render, and a row's focus to the moment. The
 * Swift's hosted checks (real key events in an offscreen window) are the
 * page's e2e here (odds.spec.ts: keys and rows on the real section).
 */
import { describe, expect, it } from "vitest";
import { GAME, periodWindow, timeOf, emptyHistory } from "../../src/data/odds/history";
import type { TimelineMark } from "../../src/data/odds/marks";
import { OddsPointer, selectKeyPlay, type PinTarget } from "../../src/data/odds/pointer";
import { destination } from "../../src/data/odds/timeline";

const S = 1000;
const start = 1_800_000_000_000;
const range = { from: start, to: start + 1000 * S };

/** The page's linked focus, as far as a pin goes. */
class Linked implements PinTarget {
  pinned: { play: string } | null = null;
  pinFocus(focus: { play: string }) {
    this.pinned = focus;
  }
  unpin() {
    const had = this.pinned != null;
    this.pinned = null;
    return had;
  }
}

describe("the pointer's states", () => {
  it("hovers as its own state; leaving ends it whatever else is going on", () => {
    const pointer = new OddsPointer();
    pointer.hover(start + 10 * S);
    expect([pointer.moment, pointer.active], "the pointer over a chart reads it").toEqual([start + 10 * S, true]);
    pointer.hover(null);
    expect([pointer.moment, pointer.active], "leaving clears it").toEqual([null, false]);
    pointer.key(start + 20 * S);
    pointer.hover(start + 30 * S);
    expect(pointer.moment, "the pointer reads over the keyboard's reading").toBe(start + 30 * S);
    pointer.hover(null);
    expect(pointer.moment, "leaving ends only the pointer's reading: focus doesn't hold it, and the keyboard's stays").toBe(start + 20 * S);
    pointer.key(null);
    expect([pointer.moment, pointer.active], "and losing focus ends the keyboard's").toEqual([null, false]);
  });

  it("holds a pin, hover reading over it, and lets go on the same spot; elsewhere, the pin moves", () => {
    const pointer = new OddsPointer();
    pointer.toggle(start + 100 * S, null, range, null);
    expect([pointer.pinned, pointer.moment, pointer.heldPlay], "a click holds the moment").toEqual([true, start + 100 * S, null]);
    pointer.hover(start + 200 * S);
    expect([pointer.moment, pointer.held], "hover reads over the pin").toEqual([start + 200 * S, start + 100 * S]);
    pointer.hover(null);
    expect(pointer.moment, "and returns to it").toBe(start + 100 * S);
    pointer.toggle(start + 105 * S, null, range, null);
    expect([pointer.pinned, pointer.moment], "again on the same spot lets go").toEqual([false, null]);
    pointer.toggle(start + 100 * S, null, range, null);
    pointer.toggle(start + 500 * S, null, range, null);
    expect(pointer.held, "elsewhere, the pin moves").toBe(start + 500 * S);
  });

  it("makes a play's pin the page's pin", () => {
    const linked = new Linked();
    const pointer = new OddsPointer();
    pointer.toggle(start + 100 * S, "goal", range, linked);
    expect([pointer.heldPlay, linked.pinned?.play], "a click on a key play pins it, the same pin as its row").toEqual(["goal", "goal"]);
    pointer.toggle(start + 100 * S, "goal", range, linked);
    expect([pointer.pinned, linked.pinned], "again lets go of both").toEqual([false, null]);
    pointer.toggle(start + 100 * S, "goal", range, linked);
    pointer.toggle(start + 400 * S, null, range, linked);
    expect([pointer.heldPlay, pointer.held, linked.pinned], "a pin on open time replaces it").toEqual([null, start + 400 * S, null]);
  });

  it("steps a fraction of what's shown; the pin moves if there is one", () => {
    const pointer = new OddsPointer();
    pointer.step(-0.01, range, null);
    expect([pointer.moment, pointer.pinned], "← from the latest: 1% back, the keyboard's reading").toEqual([start + 990 * S, false]);
    pointer.step(0.5, range, null);
    expect(pointer.moment, "held to the range").toBe(start + 1000 * S);
    pointer.toggle(start + 100 * S, null, range, null);
    pointer.step(0.01, range, null);
    expect(pointer.held, "with a pin, it moves the pin").toBe(start + 110 * S);
    pointer.clear();
    expect([pointer.moment, pointer.pinned], "back to the latest").toEqual([null, false]);
  });

  it("Esc: the reading first, then the zoom, then it's the page's", () => {
    const pointer = new OddsPointer();
    pointer.setWindow(periodWindow(3));
    pointer.pin(start);
    expect([pointer.back(null), pointer.pinned, pointer.window], "Esc lets go of the pin first").toEqual([true, false, periodWindow(3)]);
    expect([pointer.back(null), pointer.window], "then the zoom").toEqual([true, GAME]);
    expect(pointer.back(null), "then there's nothing to undo here: the page goes back").toBe(false);
  });

  it("zooms, keeping a pin it still shows and letting go of one it doesn't", () => {
    const pointer = new OddsPointer();
    pointer.pin(start + 100 * S);
    pointer.zoom(2, { from: start + 50 * S, to: start + 200 * S });
    expect([pointer.window, pointer.pinned], "zooming keeps a pin it still shows").toEqual([periodWindow(2), true]);
    pointer.zoom(3, { from: start + 500 * S, to: start + 700 * S });
    expect([pointer.window, pointer.pinned], "and lets go of one it doesn't").toEqual([periodWindow(3), false]);
    pointer.zoom(null, null);
    expect(pointer.window, "the whole game again").toEqual(GAME);
  });

  it("walks the key plays with ⌥←/→, bringing the game back to show one outside the zoom", () => {
    const mark = (id: string, offset: number): TimelineMark => ({ moment: { id, kind: "score", clock: "", text: id, side: "top", minute: null, score: null, period: null }, t: start + offset * S });
    const marks = [mark("a", 100), mark("b", 200), mark("c", 300)];
    expect(
      [destination(false, marks, null)?.moment.id, destination(true, marks, null)?.moment.id, destination(true, marks, start + 200 * S)?.moment.id, destination(false, marks, start + 100 * S)],
      "the key plays either side of the reading",
    ).toEqual(["c", "a", "c", null]);
    const linked = new Linked();
    const pointer = new OddsPointer();
    pointer.setWindow(periodWindow(1));
    selectKeyPlay(true, marks, { from: start, to: start + 50 * S }, pointer, linked);
    expect([pointer.heldPlay, pointer.window, linked.pinned?.play], "stepping to a play outside the zoom brings the game back to show it").toEqual(["a", GAME, "a"]);
  });
});

describe("what a move re-renders", () => {
  it("flips `active` only as reading starts and ends; fifty moves change neither it nor the pin", () => {
    const pointer = new OddsPointer();
    let active = pointer.active;
    let held = pointer.held;
    let activeChanges = 0;
    let heldChanges = 0;
    // As useSyncExternalStore with a selector: a reader re-renders only when its value changes.
    pointer.subscribe(() => {
      if (pointer.active !== active) {
        active = pointer.active;
        activeChanges++;
      }
      if (pointer.held !== held) {
        held = pointer.held;
        heldChanges++;
      }
    });
    pointer.hover(start);
    expect(activeChanges, "reading starts: `active` flips").toBe(1);
    for (let k = 1; k <= 50; k++) pointer.hover(start + k * S);
    expect([activeChanges, heldChanges], "fifty moves: `active` and the pin don't change, so nothing reading them re-renders").toEqual([1, 0]);
    pointer.hover(null);
    expect(activeChanges, "reading ends: it flips back").toBe(2);
  });
});

describe("rows", () => {
  it("finds a run's mark by its last basket", () => {
    const history = emptyHistory("basketball", null, [{ id: "basket", t: start + 90 * S, period: 1, clock: "Q1 9:00", text: "Basket", side: "top", turnover: false }]);
    expect(timeOf(history, "basket-run")).toBe(start + 90 * S);
  });
});
