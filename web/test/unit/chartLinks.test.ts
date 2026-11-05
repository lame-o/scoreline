/**
 * "Show on {chart}" (ChartLinks.swift): which section lights a row's focus,
 * by sport, and never a guess. Ported check by check from
 * Tests/ChartLinksTests.swift.
 */
import { describe, expect, it } from "vitest";
import { chartTarget, type ChartLinkInputs } from "../../src/data/chartLinks";
import type { EventRef } from "../../src/data/models";
import { NBA_PATH } from "../../src/data/providers/espn";
import type { Section } from "../../src/data/sections";

const soccerRef: EventRef = { kind: "espn", path: "soccer/eng.1", id: "1", sport: "soccer" };
const nbaRef: EventRef = { kind: "espn", path: NBA_PATH, id: "2", sport: "basketball" };
const mlbRef: EventRef = { kind: "espn", path: "baseball/mlb", id: "3", sport: "baseball" };
const nflRef: EventRef = { kind: "espn", path: "football/nfl", id: "4", sport: "football" };
const climbRef = { kind: "climbing", eventID: 1, category: "Lead Women", resultURL: null, round: "Final", eventName: "", nextURL: null } as unknown as EventRef;
const csRef = { kind: "counterStrike", slug: "s", tournament: null } as unknown as EventRef;
const shown = (...s: Section[]) => new Set<Section>(s);

describe("show on chart", () => {
  it("soccer: key events → the pitch if the play is on it, else the timeline", () => {
    let soccer: ChartLinkInputs = { shown: shown("pitch", "timeline", "moments"), pitch: [{ id: "goal1" }], timeline: [{ id: "goal1" }, { id: "card9" }] };
    expect(chartTarget({ play: "goal1", period: 1, side: "top" }, soccerRef, soccer), "soccer: a goal row shows on the pitch").toBe("pitch");
    expect(chartTarget({ play: "card9" }, soccerRef, soccer), "soccer: a card with no foul position shows on the timeline").toBe("timeline");
    expect(chartTarget({ play: "nope" }, soccerRef, soccer), "soccer: a play on neither chart: no action").toBeNull();
    soccer = { ...soccer, shown: shown("timeline", "moments") };
    expect(chartTarget({ play: "goal1" }, soccerRef, soccer), "no pitch on the page: the timeline").toBe("timeline");
  });

  it("baseball: the spray chart if a ball joins, else the linescore", () => {
    const mlb: ChartLinkInputs = { shown: shown("linescore", "moments", "battedBalls"), balls: [{ id: "ab7", period: 7, side: "top" }] };
    expect(chartTarget({ play: "ab7", period: 7, side: "top" }, mlbRef, mlb), "baseball: a scoring play with its ball in play shows on Balls in Play").toBe("battedBalls");
    expect(chartTarget({ play: "walk", period: 3, side: "bottom" }, mlbRef, mlb), "baseball: a play with no ball shows on the linescore").toBe("linescore");
  });

  it("NBA: players and shots → the court; other key plays → the game flow", () => {
    const nba: ChartLinkInputs = {
      shown: shown("court", "flow", "linescore", "leaders", "moments", "box"),
      shots: [
        { id: "s1", period: 3, side: "top", player: "lebron" },
        { id: "s2", period: 3, side: "bottom", player: "kd" },
      ],
      flow: [{ id: "f1", period: 2 }],
    };
    expect(chartTarget({ player: "lebron" }, nbaRef, nba), "NBA: a player row shows on the court").toBe("court");
    expect(chartTarget({ player: "bench" }, nbaRef, nba), "NBA: a player with no shots: nothing to light, no action").toBeNull();
    expect(chartTarget({ play: "s1", period: 3, side: "top" }, nbaRef, nba), "NBA: a key play that's a shot shows on the court").toBe("court");
    expect(chartTarget({ play: "f1", period: 2, side: "top" }, nbaRef, nba), "NBA: a key play that isn't a shot shows on the game flow").toBe("flow");
  });

  it("football: a scoring row → its quarter in the linescore", () => {
    expect(chartTarget({ play: "td", period: 2, side: "top" }, nflRef, { shown: shown("field", "linescore", "moments") })).toBe("linescore");
  });

  it("climbing: the ascent while a final is live, else the wall, else the scorecard; CS2 has no linked charts", () => {
    let climb: ChartLinkInputs = { shown: shown("ascent", "wall", "results", "startlist"), ascent: [{ id: "7" }], wall: [{ id: "7" }, { id: "8" }] };
    expect(chartTarget({ athlete: 7 }, climbRef, climb), "climbing: a live final shows on the ascent first").toBe("ascent");
    expect(chartTarget({ athlete: 8 }, climbRef, climb), "climbing: off the ascent, the wall's lane").toBe("wall");
    climb = { ...climb, shown: shown("scorecard", "results"), cards: [{ id: "9" }] };
    expect(chartTarget({ athlete: 9 }, climbRef, climb), "boulder: the scorecard row").toBe("scorecard");
    expect(chartTarget({ play: "4" }, csRef, { shown: shown() }), "CS2 has no linked charts").toBeNull();
  });

  it("every sport's key plays reach the timeline when nothing else lights them (fdae434)", () => {
    const timelineOnly = (play: string): ChartLinkInputs => ({ shown: shown("timeline"), timeline: [{ id: play }] });
    expect(chartTarget({ play: "run" }, mlbRef, timelineOnly("run"))).toBe("timeline");
    expect(chartTarget({ play: "kp" }, nbaRef, timelineOnly("kp"))).toBe("timeline");
    expect(chartTarget({ play: "int" }, nflRef, timelineOnly("int"))).toBe("timeline");
  });
});
