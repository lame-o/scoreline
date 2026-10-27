import { describe, expect, it } from "vitest";
import {
  baseballFromBoard,
  battedBalls,
  currentAtBat,
  eventFromSummary,
  fetchDetail,
  magnitude,
  parseESPNDetail,
  pitchCode,
  pitchNames,
  pitchResultWord,
  scoreAfter,
  sideMapper,
} from "../../src/data/gameDetail";
import { parseBoards } from "../../src/data/providers/espn";
import { fixture, replay } from "./fixtures";

const summary = fixture("espn-mlb-summary.json");
const NOW = Date.parse("2026-10-27T08:00:00Z");

function ws3() {
  const event = eventFromSummary(summary, "baseball/mlb", "baseball", NOW);
  if (!event) throw new Error("no event");
  return event;
}

describe("a game from its summary", () => {
  it("reads the header like a scoreboard event", () => {
    const event = ws3();
    expect(event.id).toBe("espn-401908044");
    expect(event.state).toBe("final");
    expect(event.ref).toEqual({ kind: "espn", path: "baseball/mlb", id: "401908044", sport: "baseball" });
    expect(event.content.kind).toBe("match");
    if (event.content.kind !== "match") return;
    // North American order: away on top.
    expect(event.content.top.abbreviation).toBe("MIL");
    expect(event.content.bottom.abbreviation).toBe("TB");
    expect(event.content.top.score).toBe("10");
    expect(event.content.top.isWinner).toBe(true);
    expect(event.content.top.logo).toMatch(/^https:\/\/a\.espncdn\.com\//);
    expect(event.content.top.id).toBe("espn-baseball-8");
    // The postseason caption: the game note and the series, as the scoreboard writes them.
    expect(event.caption).toContain("World Series · Game 3");
    expect(event.caption).toContain("MIL leads 3–0");
    expect(event.stage).toBe("post-season");
    expect(event.venue).toBeTruthy();
  });

  it("matches the scoreboard's own event for the same game", () => {
    const board = parseBoards([fixture("espn-mlb-scoreboard.json")], "baseball/mlb", "baseball", NOW).find((e) => e.id === "espn-401908044");
    const event = ws3();
    expect(board).toBeDefined();
    if (!board || board.content.kind !== "match" || event.content.kind !== "match") return;
    expect(event.content.top.id).toBe(board.content.top.id);
    expect(event.content.bottom.id).toBe(board.content.bottom.id);
    expect(event.start).toBe(board.start);
  });
});

describe("the ESPN summary, baseball", () => {
  const event = ws3();
  const detail = parseESPNDetail(summary, { event, path: "baseball/mlb", id: "401908044", sport: "baseball" });

  it("knows who's home", () => {
    expect(detail.topIsHome).toBe(false);
  });

  it("reads the line score with R, H and E", () => {
    const line = detail.linescore!;
    expect(line.headers.slice(-3)).toEqual(["R", "H", "E"]);
    expect(line.headers.slice(0, 9)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(line.top.slice(-3)).toEqual(["10", "16", "0"]);
    expect(line.bottom.slice(-3)).toEqual(["1", "3", "1"]);
    expect(line.top[4]).toBe("8");
  });

  it("lists every scoring play with the score after it, top first, and its inning", () => {
    expect(detail.moments.length).toBe(9);
    const first = detail.moments[0]!;
    expect(first.side).toBe("top");
    expect(first.score).toBe("1–0");
    expect(first.period).toBe(3);
    expect(first.clock).toBe("3rd Inning");
    const last = detail.moments.at(-1)!;
    expect(last.side).toBe("bottom");
    expect(last.score).toBe("10–1");
  });

  it("colors each ball in play by the batting team, keyed by its result", () => {
    const balls = detail.battedBalls;
    expect(balls.length).toBeGreaterThan(20);
    // Every ball's ID is its at-bat's result entry, so it links to its scoring play.
    const scoring = new Set(detail.moments.map((m) => m.id));
    const linked = balls.filter((b) => scoring.has(b.id));
    expect(linked.length).toBeGreaterThan(0);
    for (const b of linked) {
      const moment = detail.moments.find((m) => m.id === b.id)!;
      expect(b.side).toBe(moment.side);
    }
    // The 9th-inning double was the Rays' (bottom): the result entry names the batting team.
    const rays = balls.filter((b) => b.side === "bottom");
    expect(rays.length).toBeGreaterThan(0);
    expect(new Set(balls.map((b) => b.outcome))).toEqual(new Set(["single", "extraBases", "out"]));
  });

  it("names the box score's athletes for the live lane", () => {
    expect(Object.keys(detail.athleteNames).length).toBeGreaterThan(20);
  });

  it("keeps the last plays newest first", () => {
    expect(detail.recentPlays.length).toBe(4);
  });

  it("keeps no plays for the theater once the game is over", () => {
    expect(detail.plays).toEqual([]);
  });

  it("reads the venue and broadcasters, radio last", () => {
    expect(detail.venue).toBeTruthy();
    const kinds = detail.broadcasters.map((b) => b.kind);
    const radio = kinds.indexOf("radio");
    if (radio >= 0) expect(kinds.slice(radio).every((k) => k === "radio")).toBe(true);
  });

  it("reads the at-bat in progress, or the last one between batters", () => {
    const all = (summary as { plays: { type: { type: string } }[] }).plays;
    // Between batters: the feed ends on the last at-bat's end entry.
    const end = all.findLastIndex((p) => p.type.type === "end-batterpitcher");
    const pitches = currentAtBat(all.slice(0, end + 1));
    // After the game's closing entries, there's no at-bat in progress.
    expect(currentAtBat([...all, { type: { type: "end-game" } }]).length).toBe(0);
    expect(pitches.length).toBeGreaterThan(0);
    expect(pitches.map((p) => p.number)).toEqual(pitches.map((_, i) => i + 1));
    for (const p of pitches) {
      expect(["ball", "strike", "inPlay"]).toContain(p.result);
      expect(pitchNames(p)[2]).not.toBe("FF");
    }
  });
});

describe("pitches", () => {
  const pitch = (type: string, extra: Record<string, unknown> = {}) => ({
    id: type,
    type: { type },
    summaryType: "P",
    text: "Pitch 1 : x",
    pitchCoordinate: { x: 110, y: 170 },
    pitchType: { abbreviation: "FF", text: "Four-seam FB" },
    pitchVelocity: 97.4,
    ...extra,
  });

  it("tells called, swinging, foul and foul tip apart, and a caught foul is in play", () => {
    const at = currentAtBat([
      pitch("strike-looking"),
      pitch("strike-swinging"),
      pitch("foul-ball"),
      pitch("foul-tip"),
      pitch("ball"),
      pitch("foul-out"),
      pitch("missed-bunt"),
      pitch("hit-by-pitch"),
      pitch("single"),
    ]);
    expect(at.map((p) => [p.result, p.strike])).toEqual([
      ["strike", "called"],
      ["strike", "swinging"],
      ["strike", "foul"],
      ["strike", "foulTip"],
      ["ball", null],
      ["inPlay", null],
      ["strike", "swinging"],
      ["ball", null],
      ["inPlay", null],
    ]);
  });

  it("writes the four-seamer as FB, with its speed", () => {
    const [p] = currentAtBat([pitch("ball")]);
    expect(p!.type).toBe("FF");
    expect(pitchNames(p!)).toEqual(["Four-seam FB", "Four-seam", "FB"]);
    expect(pitchResultWord(p!)).toBe("Ball");
    expect(p!.typeName).toBe("Four-seam FB");
    expect(p!.mph).toBe(97);
    expect(pitchCode("SL")).toBe("SL");
    expect(pitchCode("FF")).toBe("FB");
  });

  it("only counts the pitches after the last completed at-bat", () => {
    const at = currentAtBat([pitch("ball"), { id: "end", type: { type: "end-batterpitcher" } }, pitch("strike-looking")]);
    expect(at.map((p) => p.id)).toEqual(["strike-looking"]);
    const between = currentAtBat([pitch("ball"), pitch("single"), { id: "end", type: { type: "end-batterpitcher" } }]);
    expect(between.map((p) => p.id)).toEqual(["ball", "single"]);
  });
});

describe("balls in play", () => {
  it("waits for the at-bat's result and takes the batting team from it, not the pitch", () => {
    const side = (id: string | null | undefined) => (id === "8" ? ("top" as const) : id === "30" ? ("bottom" as const) : null);
    // The pitch entry names the pitching team (30); the result names the batting team (8).
    const pitchEntry = { id: "p1", atBatId: "ab1", type: { type: "single", text: "Single" }, team: { id: "30" }, hitCoordinate: { x: 100, y: 120 }, period: { number: 3 } };
    expect(battedBalls([pitchEntry], side)).toEqual([]);
    const result = { id: "r1", atBatId: "ab1", type: { type: "play-result" }, team: { id: "8" } };
    const [ball] = battedBalls([pitchEntry, result], side);
    expect(ball).toMatchObject({ id: "r1", side: "top", outcome: "single", period: 3 });
  });
});

describe("pieces", () => {
  it("reads magnitudes from display values", () => {
    expect(magnitude("8-12")).toBe(8);
    expect(magnitude("31:22")).toBe(31 * 60 + 22);
    expect(magnitude("45.5")).toBe(45.5);
    expect(magnitude("-2")).toBe(0);
    expect(magnitude("abc")).toBeNull();
  });

  it("writes the score after a play top first", () => {
    expect(scoreAfter({ awayScore: 3, homeScore: 1 }, false)).toBe("3–1");
    expect(scoreAfter({ awayScore: 3, homeScore: 1 }, true)).toBe("1–3");
  });

  it("reads the scoreboard's live situation", () => {
    const b = baseballFromBoard({ balls: 2, strikes: 1, outs: 1, onFirst: true, onSecond: false, onThird: true, batter: { athlete: { id: "1", shortName: "C. Yelich" } }, pitcher: { playerId: 2 } });
    expect(b).toMatchObject({ balls: 2, strikes: 1, outs: 1, onFirst: true, onThird: true, batter: "C. Yelich", batterID: "1", pitcherID: "2" });
    expect(baseballFromBoard({})).toBeNull();
  });
});

describe("fetching by ID", () => {
  it("asks for the summary and, live, the scoreboard's situation", async () => {
    const event = { ...ws3(), state: "live" as const };
    const fetcher = replay([
      [/summary\?event=401908044/, summary],
      [/scoreboard$/, { events: [{ id: "401908044", competitions: [{ situation: { balls: 1, strikes: 2, outs: 2, onFirst: true } }] }] }],
    ]);
    const detail = await fetchDetail(event, fetcher);
    expect(fetcher.calls.length).toBe(2);
    expect(detail.baseball).toMatchObject({ balls: 1, strikes: 2, outs: 2, onFirst: true });
    // Live, the plays stay for the theater (the last 80).
    expect(detail.plays.length).toBeGreaterThan(0);
    expect(detail.plays.length).toBeLessThanOrEqual(80);
  });

  it("maps team IDs onto top and bottom", () => {
    const side = sideMapper(ws3());
    expect(side("8")).toBe("top");
    expect(side("30")).toBe("bottom");
    expect(side("1")).toBeNull();
  });
});
