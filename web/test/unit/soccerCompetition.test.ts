import { describe, expect, it } from "vitest";
import { at, arr } from "../../src/data/json";
import { competitionPath, loadSoccerCompetition, parseSoccerCompetition } from "../../src/data/soccerCompetition";
import { leagueForGame } from "../../src/data/leagues";
import { clientRequest } from "../../shared/upstreams";
import { fixture, replay } from "./fixtures";

const boards = fixture("competitions/boards.json");
const current = fixture("competitions/current-season.json");
const previous = fixture("competitions/previous-season.json");
const parse = (season: unknown, input = [boards]) => parseSoccerCompetition(season, input, "eng.league_cup");

describe("soccer competition seasons", () => {
  it("resolves known and uncataloged soccer game paths without guessing other sports", () => {
    expect(leagueForGame("eng.league_cup")?.id).toBe("eng.league_cup");
    expect(leagueForGame("soccer/sco.cis")?.source).toEqual({ kind: "espn", path: "soccer/sco.cis", weekly: false });
    expect(leagueForGame("basketball/nba")?.id).toBe("nba");
    expect(leagueForGame("soccer/../nba")).toBeUndefined();
  });
  it("reads every provider round, deduplicates fixtures and excludes another season", () => {
    const data = parse(current, [boards, boards]);
    expect(data.stages).toHaveLength(8);
    expect(data.stages.find((s) => s.slug === "fourth-round")?.ties).toHaveLength(8);
    expect(data.stages.flatMap((s) => s.ties).flatMap((t) => t.games).every((g) => g.day.year === 2026)).toBe(true);
    expect(data.stages.at(-1)?.ties).toEqual([]);
    expect(data.bracket).toBeNull();
  });

  it("uses the shootout winner despite a drawn score", () => {
    const tie = parse(current).stages.flatMap((s) => s.ties).find((t) => t.games.some((g) => g.id === "espn-401921842"))!;
    expect(tie.match.top?.id).toBe("364");
    expect(tie.match.winner).toBe("top");
    expect([tie.match.topScore, tie.match.bottomScore]).toEqual([1, 1]);
  });

  it("groups two legs, keeps team identity and connects actual advancing teams", () => {
    const data = parse(previous);
    const semi = data.stages.find((s) => s.slug === "semifinals")!;
    expect(semi.ties).toHaveLength(2);
    expect(semi.ties.map((t) => t.games.length)).toEqual([2, 2]);
    const arsenal = semi.ties.find((t) => t.match.bottom?.id === "359")!;
    expect(arsenal.match.winner).toBe("bottom");
    expect(arsenal.match.bottomScore).toBe(4);
    expect(data.bracket?.rounds).toEqual(["Semifinals", "Final"]);
    expect(data.bracket?.matches[data.bracket.finalID]?.feeders).toHaveLength(2);
  });

  it("does not advance a leg winner before the aggregate tie finishes", () => {
    // Select by metadata rather than depending on a provider event ID.
    const semi = structuredClone(arr(at(boards, "events")).find((e) => at(e, "season", "type") === 13538)) as any;
    expect(semi).toBeDefined();
    semi.competitions[0].series.completed = false;
    const data = parse(previous, [{ events: [semi] }]);
    expect(data.stages.flatMap((s) => s.ties)[0]?.match.winner).toBeNull();
    expect(data.bracket).toBeNull();
  });

  it("keeps league phases out of knockout trees", () => {
    const data = parseSoccerCompetition(fixture("competitions/champions-season.json"), [], "uefa.champions");
    expect(data.stages[0]?.hasStandings).toBe(true);
    expect(data.bracket).toBeNull();
  });

  it("fetches both calendar years through the configured upstream routes", async () => {
    const season = { ...(current as object), endDate: "2027-06-01T03:59Z" };
    const fetcher = replay([[/\/seasons\/2026$/, season], [/dates=2026/, boards], [/dates=2027/, { events: [] }]]);
    const data = await loadSoccerCompetition("eng.league_cup", 2026, fetcher);
    expect(data.stages).toHaveLength(8);
    expect(fetcher.calls).toHaveLength(3);
    for (const url of fetcher.calls) {
      const href = clientRequest(url).href;
      expect(href).toBe(url.includes("sports.core.api") ? url : `/api/${url.slice(8)}`);
    }
    expect(competitionPath("eng.league_cup", 2026)).toBe("/competition/eng.league_cup/2026");
  });

  it("discovers the current season for a league page", async () => {
    const fetcher = replay([[/\/scoreboard$/, { leagues: [{ season: { year: 2026 } }] }], [/\/seasons\//, current], [/dates=/, boards]]);
    expect((await loadSoccerCompetition("eng.league_cup", null, fetcher)).year).toBe(2026);
  });

  it("fails rather than publishing a partial season when a year is unavailable", async () => {
    const fetcher = replay([[/\/seasons\//, { ...(current as object), endDate: "2027-06-01" }], [/dates=2026/, boards]]);
    await expect(loadSoccerCompetition("eng.league_cup", 2026, fetcher)).rejects.toThrow("No fixture");
  });

  it("splits capped year responses into months and rejects still-capped results", async () => {
    const capped = { events: Array(1000).fill({}) };
    const fetcher = replay([[/\/seasons\//, current], [/dates=2026&/, capped], [/dates=2026\d\d&/, { events: [] }]]);
    await loadSoccerCompetition("eng.league_cup", 2026, fetcher);
    expect(fetcher.calls).toHaveLength(14);
    const incomplete = replay([[/\/seasons\//, current], [/dates=/, capped]]);
    await expect(loadSoccerCompetition("eng.league_cup", 2026, incomplete)).rejects.toThrow("incomplete");
  });
});
