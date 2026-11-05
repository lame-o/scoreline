/**
 * The scores list as it widens (ListLayout.swift, Responsive.swift):
 * ResponsiveTests.swift's width classes and panel layout, and ListsTests.swift
 * `rowDetail` (the row texts) and `gridKeyboard`, check by check.
 */
import { describe, expect, it } from "vitest";
import { contextLine, laneLines } from "../../src/data/format";
import { COMPACT_LAYOUT, gridRevealDelay, resolvePanel, rowDetailOf, rowWidth, scoresGridNext, widthClassOf, type GridMove, type PanelLayout } from "../../src/data/listLayout";
import type { ScoreEvent } from "../../src/data/models";

describe("width classes and the panel layout (Responsive.swift)", () => {
  it("steps up at 380, 460, 560, and down only 12pt below", () => {
    expect([widthClassOf(312), widthClassOf(380), widthClassOf(460), widthClassOf(560)]).toEqual(["compact", "medium", "large", "xlarge"]);
    expect(widthClassOf(372, "medium")).toBe("medium");
    expect(widthClassOf(367, "medium")).toBe("compact");
  });

  const layout = (widths: number[]): PanelLayout => widths.reduce((old, w) => resolvePanel(w, old), COMPACT_LAYOUT);

  it("maps list widths to the classes, splitting into two compact columns at 680", () => {
    expect(layout([340])).toBe(COMPACT_LAYOUT);
    expect([layout([407]).page, layout([408]).page, layout([488]).page, layout([588]).page]).toEqual(["compact", "medium", "large", "xlarge"]);
    expect(layout([680])).toEqual({ columns: 2, column: "compact", page: "xlarge" });
    expect(layout([680, 670]).columns).toBe(2);
    expect(layout([680, 667]).columns).toBe(1);
    expect(layout([760]).column).toBe("compact");
  });

  it("keeps its object while nothing crosses a threshold (no re-render)", () => {
    const at = layout([500]);
    expect(resolvePanel(510, at)).toBe(at);
  });
});

describe("rows (ListLayout.swift RowDetail, RowText)", () => {
  const game = (state: ScoreEvent["state"], over: Partial<ScoreEvent> = {}): ScoreEvent => ({
    id: "g",
    content: { kind: "match", top: comp("A"), bottom: comp("B") },
    state,
    start: 0,
    detail: null,
    caption: null,
    link: null,
    ref: null,
    stage: null,
    clock: null,
    possession: null,
    liveLine: null,
    liveLineRoutine: false,
    broadcast: null,
    venue: null,
    snapshot: null,
    ...over,
  });
  function comp(name: string) {
    return { id: name, name, abbreviation: name, score: "0", logo: null, isWinner: false, color: null, rank: null, record: null, conferenceRecord: null, alternateColor: null };
  }

  it("is compact as today, records from medium, a detail lane from large", () => {
    expect((["compact", "medium", "large", "xlarge"] as const).map(rowDetailOf)).toEqual(["base", "records", "lane", "lane"]);
    expect(rowWidth({ columns: 2, page: "xlarge", column: "compact" })).toBe("compact");
    expect(rowWidth({ columns: 1, page: "large", column: "large" })).toBe("large");
  });

  it("puts the situation in the compact row's line, the caption otherwise", () => {
    const live = game("live", { liveLine: "2nd & 7 at KC 34", caption: "Week 8" });
    expect(contextLine(live)).toEqual({ text: "2nd & 7 at KC 34", situation: true });
    expect(contextLine(game("live", { caption: "Week 8" }))).toEqual({ text: "Week 8", situation: false });
    expect(contextLine(game("scheduled", { liveLine: "stale", caption: "" }))).toBeNull();
  });

  it("gives the lane the situation over the context, where to watch, the venue", () => {
    expect(laneLines(game("live", { liveLine: "2nd & 7 at KC 34", caption: "Week 8" }))).toEqual({ primary: "2nd & 7 at KC 34", secondary: "Week 8" });
    expect(laneLines(game("live", { liveLine: "End of Q2", broadcast: "TNT" }))).toEqual({ primary: "End of Q2", secondary: "TNT" });
    expect(laneLines(game("live", { broadcast: "TNT" }))).toEqual({ primary: "TNT", secondary: null });
    expect(laneLines(game("scheduled", { broadcast: "Peacock", venue: "Anfield" }))).toEqual({ primary: "Peacock", secondary: "Anfield" });
    expect(laneLines(game("scheduled", { caption: "World Series · Game 3", broadcast: "FOX", venue: "Tropicana Field" }))).toEqual({ primary: "FOX", secondary: "World Series · Game 3" });
    expect(laneLines(game("final", { caption: "Final Four", broadcast: "CBS", venue: "Arena" }))).toEqual({ primary: null, secondary: "Final Four" });
    const field = game("final", { content: { kind: "field", title: "Lead Men", summary: "Winner J. Utelli" }, caption: "Santiago 2026" });
    expect(laneLines(field)).toEqual({ primary: "Winner J. Utelli", secondary: "Santiago 2026" });
  });
});

describe("the arrow keys in the scores grid (ScoresGrid)", () => {
  // Three sections, two columns:  a b / c    d    e f / g h
  const sections = [["a", "b", "c"], ["d"], ["e", "f", "g", "h"]];
  const go = (from: string | null, move: GridMove, columns = 2) => scoresGridNext(from, move, sections, columns);

  it("starts at the top going forward, at the bottom going back", () => {
    expect([go(null, "down"), go(null, "right"), go(null, "up")]).toEqual(["a", "a", "h"]);
  });

  it("moves within a visual row with ←/→ and stops at its ends", () => {
    expect([go("a", "right"), go("b", "right"), go("b", "left"), go("a", "left")]).toEqual(["b", "b", "a", "a"]);
    expect(go("c", "right")).toBe("c");
  });

  it("moves a visual row with ↓, into the next section, keeping the column", () => {
    expect([go("a", "down"), go("b", "down")]).toEqual(["c", "c"]);
    expect([go("c", "down"), go("d", "down")]).toEqual(["d", "e"]);
    expect([go("f", "down"), go("h", "down")]).toEqual(["h", "h"]);
  });

  it("moves up keeping the column where the section above has it", () => {
    expect([go("e", "up"), go("f", "up")]).toEqual(["d", "d"]);
    expect([go("d", "up"), go("h", "up"), go("a", "up")]).toEqual(["c", "f", "a"]);
  });

  it("steps through every row in one column, where ←/→ pass on", () => {
    expect([go("c", "down", 1), go("a", "up", 1)]).toEqual(["d", "a"]);
    expect([go("a", "left", 1), go("a", "right", 1)]).toEqual([null, null]);
  });

  it("skips empty sections, starts over for a row that left, ignores an empty list", () => {
    expect(scoresGridNext("a", "down", [["a"], [], ["b"]], 2)).toBe("b");
    expect(scoresGridNext("gone", "down", sections, 2)).toBe("a");
    expect(scoresGridNext(null, "down", [[], []], 2)).toBeNull();
  });

  it("reveals an expanded section by visual row, the right column 20ms behind, capped at 4 rows", () => {
    const delays = [0, 1, 2, 3].map((i) => gridRevealDelay(i, 2));
    [0.04, 0.06, 0.08, 0.1].forEach((d, i) => expect(delays[i]).toBeCloseTo(d, 9));
    expect(gridRevealDelay(3, 1)).toBeCloseTo(0.16, 9);
    expect(gridRevealDelay(40, 2)).toBeCloseTo(0.2, 9);
  });
});
