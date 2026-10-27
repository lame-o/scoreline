/**
 * The NBA and soccer pages' remaining rules: the section plan (the soccer
 * theater's slot, the WNBA on the NBA page), a knockout tie's line, the
 * table window around a match, and the NBA page's replay stage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { arrangement, pageKind, sectionOrder, wideArrangement, widePlan } from "../../src/data/sections";
import { soccerTie, tieLine } from "../../src/data/soccer";
import { soccerTableWindow } from "../../src/features/game/tables/GameTables";
import { NBAStage, playbackTime, REPLAY_RATE } from "../../src/features/game/nba/stage";
import { parseSoccer } from "../../src/data/standings";
import type { EventRef, ScoreEvent } from "../../src/data/models";
import { fixture } from "./fixtures";

const espn = (path: string, sport: "soccer" | "basketball"): EventRef => ({ kind: "espn", path, id: "1", sport });

describe("the section plan", () => {
  it("plans the soccer play theater's slot beside the pitch, leaving no hole until it lands", () => {
    const soccer = espn("soccer/eng.1", "soccer");
    expect(sectionOrder(soccer, "live").slice(0, 3)).toEqual(["pitch", "theater", "timeline"]);
    expect(sectionOrder(soccer, "final")).toContain("theater");
    const left = widePlan(soccer, "live")[0];
    expect(left?.kind === "columns" && left.left.slice(0, 2)).toEqual(["pitch", "theater"]);
    // Without a theater, the pitch is followed by what's there.
    const placed = wideArrangement(["pitch", "stats", "timeline"], widePlan(soccer, "live"));
    expect(placed.map((p) => [p.section, p.column])).toEqual([
      ["pitch", "left"],
      ["stats", "left"],
      ["timeline", "right"],
    ]);
  });

  it("gives the WNBA the NBA page, and every soccer league the soccer page", () => {
    expect(pageKind(espn("basketball/wnba", "basketball"))).toBe("nba");
    expect(pageKind(espn("basketball/nba", "basketball"))).toBe("nba");
    expect(pageKind(espn("basketball/mens-college-basketball", "basketball"))).toBe("espn");
    for (const league of ["eng.1", "uefa.champions", "uefa.europa", "esp.1", "ita.1", "ger.1", "fra.1", "eng.2", "usa.1", "fifa.world"]) expect(pageKind(espn(`soccer/${league}`, "soccer"))).toBe("soccer");
  });

  it("puts the NBA's box score beside the court, the story on the left", () => {
    const nba = espn("basketball/nba", "basketball");
    const placed = arrangement(sectionOrder(nba, "live"), nba, "live", true);
    expect(placed.find((p) => p.section === "court")?.column).toBe("left");
    expect(placed.find((p) => p.section === "box")?.column).toBe("right");
  });
});

describe("a knockout tie", () => {
  const competition = { leg: { value: 2, displayValue: "2nd Leg" } };
  it("reads the leg, the aggregate and the shootout, top first", () => {
    const tie = soccerTie(competition, { aggregateScore: 3.0 }, { aggregateScore: 1.0 });
    expect(tie).toEqual({ leg: "2nd Leg", aggregate: [3, 1], shootout: null });
    expect(tieLine(tie)).toBe("2nd Leg · Agg 3–1");
    expect(tieLine(soccerTie({}, { shootoutScore: 2 }, { shootoutScore: 4 }))).toBe("Pens 2–4");
    // A first leg says which; its aggregate is just the score.
    expect(tieLine(soccerTie({ leg: { displayValue: "1st Leg" } }, { aggregateScore: 1 }, { aggregateScore: 0 }))).toBe("1st Leg");
    expect(soccerTie({}, { score: "2" }, { score: "1" })).toBeNull();
    expect(tieLine(null)).toBeNull();
  });
});

describe("the table window", () => {
  const rows = parseSoccer(fixture("standings-eng1.json"));
  const ids = (n: number) => rows[n]!.id;
  it("shows each team with a place either side, in the order the ranks read", () => {
    const window = soccerTableWindow(rows, [], new Set([ids(0), ids(8)]), 1);
    expect(window.map((r) => r.liveRank)).toEqual([1, 2, 8, 9, 10]);
    expect(soccerTableWindow(rows, [], new Set([ids(8)]), 2).map((r) => r.liveRank)).toEqual([7, 8, 9, 10, 11]);
  });

  it("re-ranks with a live game, and falls back to the top five for teams it doesn't list", () => {
    const [a, b] = [rows[9]!, rows[2]!];
    const live = {
      state: "live",
      stage: "2026-27-english-premier-league",
      content: { kind: "match", top: { id: a.id, score: "5" }, bottom: { id: b.id, score: "0" } },
    } as unknown as ScoreEvent;
    const window = soccerTableWindow(rows, [live], new Set([a.id]), 1);
    const mine = window.find((r) => r.id === a.id)!;
    expect(mine.liveScore).toBe("5–0");
    expect(mine.liveRank).toBeLessThan(a.rank);
    expect(soccerTableWindow(rows, [], new Set(["nobody"]), 1)).toHaveLength(5);
  });
});

describe("the replay stage", () => {
  let now = 0;
  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("plays regulation in 24 seconds, pauses where it is, and holds or lets go on a seek", () => {
    const stage = new NBAStage();
    let changes = 0;
    stage.subscribe(() => changes++);
    expect(stage.time()).toBeNull();
    stage.play(0, 2880);
    expect(stage.replaying).toBe(true);
    now += 12_000;
    expect(stage.time()).toBeCloseTo(1440);
    expect(playbackTime(stage.get().playback!, now + 60_000)).toBe(2880);
    stage.pause();
    expect(stage.get()).toMatchObject({ playback: null, paused: 1440 });
    // A seek past the end is the whole game again.
    stage.seek(5000, 2880);
    expect(stage.replaying).toBe(false);
    stage.seek(-5, 2880);
    expect(stage.get().paused).toBe(0);
    stage.exit();
    expect(stage.time()).toBeNull();
    expect(changes).toBe(5);
    expect(REPLAY_RATE).toBe(120);
  });

  it("picks a player, again to clear; Esc's unpin says whether there was one", () => {
    const stage = new NBAStage();
    stage.togglePin("1");
    expect(stage.get().pinned).toBe("1");
    stage.togglePin("1");
    expect(stage.get().pinned).toBeNull();
    stage.togglePin("2");
    expect(stage.unpin()).toBe(true);
    expect(stage.unpin()).toBe(false);
  });
});
