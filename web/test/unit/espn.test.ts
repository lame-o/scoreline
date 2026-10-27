import { describe, expect, it } from "vitest";
import {
  footballSpot,
  makeEvent,
  nbaIsNotable,
  nbaListLine,
  parseBoards,
  parseDate,
  scoreboardURLs,
  shortSeriesSummary,
} from "../../src/data/providers/espn";
import { fetchLeagueEvents } from "../../src/data/providers";
import { leagueWithID } from "../../src/data/leagues";
import type { ScoreEvent } from "../../src/data/models";
import { events, fixture, replay } from "./fixtures";

const NOW = Date.parse("2026-10-27T12:00:00Z");

function match(e: ScoreEvent) {
  if (e.content.kind !== "match") throw new Error("not a match");
  return e.content;
}

describe("ESPN scoreboard URLs", () => {
  it("reads daily leagues as the undated board plus yesterday, today and tomorrow", () => {
    expect(scoreboardURLs("soccer/eng.1", false, NOW)).toEqual([
      "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard",
      "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20261026",
      "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20261027",
      "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20261028",
    ]);
  });

  it("reads weekly leagues as the current week, and every FBS game in college", () => {
    expect(scoreboardURLs("football/nfl", true, NOW)).toEqual(["https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"]);
    expect(scoreboardURLs("football/college-football", true, NOW)).toEqual([
      "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80",
    ]);
  });
});

describe("ESPN events", () => {
  it("lists away first in North American sports and keeps the score, records and colors", () => {
    const [e] = parseBoards([fixture("espn-nfl-scoreboard.json")], "football/nfl", "football", NOW);
    expect(e).toBeDefined();
    const { top, bottom } = match(e!);
    expect(e!.id).toBe("espn-401873010");
    expect(e!.state).toBe("final");
    expect(top).toMatchObject({ id: "espn-football-17", name: "Patriots", abbreviation: "NE", score: "24", isWinner: false, record: "4–3", color: "002a5c" });
    expect(bottom).toMatchObject({ id: "espn-football-3", name: "Bears", score: "30", isWinner: true, record: "5–2" });
    expect(e!.detail).toBe("Final");
    expect(e!.broadcast).toBe("Prime Video");
    expect(e!.venue).toBe("Soldier Field");
    expect(e!.link).toContain("/nfl/game/");
    expect(e!.ref).toEqual({ kind: "espn", path: "football/nfl", id: "401873010", sport: "football" });
    expect(e!.snapshot).toBeNull();
  });

  it("lists the home side first in soccer", () => {
    const list = parseBoards([fixture("espn-eng1-scoreboard.json")], "soccer/eng.1", "soccer", NOW);
    const crystalPalace = list.find((e) => match(e).top.abbreviation === "CRY");
    expect(crystalPalace).toBeDefined();
    expect(match(crystalPalace!).bottom.abbreviation).toBe("NEW");
    expect(match(crystalPalace!).bottom.isWinner).toBe(true);
    expect(crystalPalace!.detail).toBe("FT");
  });

  it("deduplicates a game that's on the undated board and its day's board", () => {
    const board = fixture("espn-nba-scoreboard.json");
    expect(parseBoards([board, board], "basketball/nba", "basketball", NOW)).toHaveLength(events("espn-nba-scoreboard.json").length);
  });

  it("captions postseason games with the round and a short series line", () => {
    const [e] = parseBoards([fixture("espn-mlb-scoreboard.json")], "baseball/mlb", "baseball", NOW);
    expect(e!.stage).toBe("post-season");
    expect(e!.caption).toBe("World Series · Game 3 · MIL leads 3–0");
    expect(shortSeriesSummary("MIL leads series 2-0")).toBe("MIL leads 2–0");
  });

  it("keeps AP ranks 1–25 in college and drops ESPN's 99 for unranked", () => {
    const list = parseBoards([fixture("espn-college-football-scoreboard.json")], "football/college-football", "football", NOW);
    // Notre Dame (away, so listed first) at Navy.
    const navyND = list.find((e) => match(e).bottom.abbreviation === "NAVY");
    expect(match(navyND!).bottom.rank).toBeNull();
    expect(match(navyND!).top.rank).toBe(5);
    expect(match(navyND!).top.id).toBe("espn-ncaaf-87");
    // Scheduled: no scores yet, even though ESPN sends "0".
    expect(match(navyND!).top.score).toBeNull();
    expect(navyND!.state).toBe("scheduled");
  });

  it("follows the score on the pitch for the winner, not ESPN's flag", () => {
    const e = structuredClone(events("espn-eng1-scoreboard.json")[0]) as { competitions: { competitors: { winner?: boolean }[] }[] };
    // ESPN says the losing side won (a two-legged tie): the score decides.
    for (const c of e.competitions[0]!.competitors) c.winner = !c.winner;
    const parsed = makeEvent(e, "soccer", "soccer/eng.1", NOW)!;
    expect(match(parsed).bottom.isWinner).toBe(true);
    expect(match(parsed).top.isWinner).toBe(false);
  });

  it("shows postponed games without their placeholder score", () => {
    const e = structuredClone(events("espn-nfl-scoreboard.json")[0]) as { status: { type: Record<string, unknown> } };
    e.status.type = { state: "post", completed: false, shortDetail: "Postponed", name: "STATUS_POSTPONED" };
    const parsed = makeEvent(e, "football", "football/nfl", NOW)!;
    expect(match(parsed).top.score).toBeNull();
    expect(parsed.detail).toBe("Postponed");
  });

  it("says Delayed for a delayed start, and Pens for a shootout", () => {
    const delayed = structuredClone(events("espn-college-football-scoreboard.json")[0]) as { status: { type: Record<string, unknown> } };
    delayed.status.type = { state: "pre", completed: false, shortDetail: "10/31 - 12:00 PM EDT", name: "STATUS_DELAYED" };
    expect(makeEvent(delayed, "football", "football/college-football", NOW)!.detail).toBe("Delayed");
    const pens = structuredClone(events("espn-eng1-scoreboard.json")[0]) as { status: { type: Record<string, unknown> } };
    pens.status.type = { state: "post", completed: true, shortDetail: "FT-Pens", name: "STATUS_FINAL_PEN" };
    expect(makeEvent(pens, "soccer", "soccer/eng.1", NOW)!.detail).toBe("Pens");
  });

  it("skips an event without a date or a side", () => {
    expect(makeEvent({ id: "1", date: "2026-10-26T17:00Z", competitions: [{ competitors: [] }] }, "soccer", "soccer/eng.1", NOW)).toBeNull();
    expect(makeEvent({ id: "1", competitions: [] }, "soccer", "soccer/eng.1", NOW)).toBeNull();
  });

  it("parses ESPN's minute-precision dates", () => {
    expect(parseDate("2026-10-23T00:15Z")).toBe(Date.parse("2026-10-23T00:15:00Z"));
    expect(parseDate("2026-12-09 03:00:00 UTC")).toBe(Date.parse("2026-12-09T03:00:00Z"));
    expect(parseDate("nonsense")).toBeNull();
  });
});

describe("ESPN live situations", () => {
  it("reads football's clock, possession, down and distance, and ball spot", () => {
    const [live, between] = parseBoards([fixture("espn-nfl-live.synthetic.json")], "football/nfl", "football", NOW);
    expect(live!.state).toBe("live");
    expect(live!.clock).toEqual({ seconds: 190, sampledAt: NOW, period: 2, direction: "down", display: "3:10 - 2nd", running: false });
    expect(live!.possession).toBe("espn-football-17");
    expect(live!.liveLine).toBe("3rd & 7 at CHI 25");
    // NE (away, top) has the ball at the CHI 25, attacking right: x = 100 − 25.
    expect(live!.snapshot).toEqual({
      kind: "football",
      spot: { ballX: 75, lineToGainX: 82, possession: "top", redZone: false, down: 3, distance: 7, goalToGo: false },
    });
    // Between snaps, what just happened holds the line.
    expect(between!.liveLine).toBe("Field goal");
  });

  it("says goal to go when the line to gain is past the goal line", () => {
    const spot = footballSpot(5, 1, 5, "top", false, true);
    expect(spot.goalToGo).toBe(true);
    expect(spot.lineToGainX).toBeNull();
    expect(footballSpot(70, 2, 4, "bottom", false, false).lineToGainX).toBe(26);
  });

  it("reads baseball's outs, count, runners and matchup", () => {
    const [e] = parseBoards([fixture("espn-mlb-live.synthetic.json")], "baseball/mlb", "baseball", NOW);
    expect(e!.liveLine).toBe("1 out · 2–1 · Runner on 2nd");
    expect(e!.clock).toBeNull();
    expect(e!.detail).toBe("Top 5th");
    expect(e!.snapshot).toEqual({
      kind: "baseball",
      bases: { onFirst: false, onSecond: true, onThird: false, balls: 2, strikes: 1, outs: 1, batter: "J. Caminero", pitcher: "F. Peralta" },
    });
  });

  it("reads soccer's running clock and goals, placing the own goal", () => {
    const [e] = parseBoards([fixture("espn-eng1-live.synthetic.json")], "soccer/eng.1", "soccer", NOW);
    expect(e!.clock?.direction).toBe("up");
    expect(e!.clock?.running).toBe(true);
    expect(e!.snapshot?.kind).toBe("soccer");
    if (e!.snapshot?.kind !== "soccer") return;
    const goals = e!.snapshot.marks;
    expect(goals.map((m) => [m.kind, m.minute, m.side])).toEqual([
      ["ownGoal", 17, "top"],
      ["goal", 21, "top"],
    ]);
  });

  it("shortens the NBA's last play and flags routine ones", () => {
    const [made, rebound] = parseBoards([fixture("espn-nba-live.synthetic.json")], "basketball/nba", "basketball", NOW);
    expect(made!.liveLine).toBe("L. Ball makes 26-ft three point jumper");
    expect(made!.liveLineRoutine).toBe(false);
    expect(rebound!.liveLineRoutine).toBe(true);
    expect(nbaListLine("End of the 2nd Quarter")).toBe("End of Q2");
    expect(nbaListLine("End of the 1st Overtime")).toBe("End of OT");
    expect(nbaListLine("Josh Hart enters the game for Mitchell Robinson")).toBe("Josh Hart in for Mitchell Robinson");
    expect(nbaIsNotable(155, 0)).toBe(false);
    expect(nbaIsNotable(155, 2)).toBe(true);
    expect(nbaIsNotable(null, null)).toBe(true);
  });

  it("gives the WNBA no play-by-play line (NBA only)", () => {
    const [e] = parseBoards([fixture("espn-nba-live.synthetic.json")], "basketball/wnba", "basketball", NOW);
    expect(e!.liveLine).toBeNull();
    expect(e!.caption).toBeNull();
  });
});

describe("fetching a league", () => {
  it("survives one failing day and fails only when every board does", async () => {
    const league = leagueWithID("nba")!;
    let first = true;
    const flaky = async (url: string) => {
      if (first) {
        first = false;
        throw new Error(`offline: ${url}`);
      }
      return fixture("espn-nba-scoreboard.json");
    };
    await expect(fetchLeagueEvents(league, { fetcher: flaky })).resolves.toHaveLength(3);
    await expect(fetchLeagueEvents(league, { fetcher: async () => Promise.reject(new Error("offline")) })).rejects.toThrow();
  });

  it("asks for each board through one fetcher", async () => {
    const fetcher = replay([[/scoreboard/, fixture("espn-eng1-scoreboard.json")]]);
    await fetchLeagueEvents(leagueWithID("eng.1")!, { fetcher });
    expect(fetcher.calls).toHaveLength(4);
  });
});
