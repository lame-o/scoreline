import { describe, expect, it } from "vitest";
import { arr, at } from "../../src/data/json";
import { bracketLayout } from "../../src/data/brackets";
import { leagueResolving } from "../../src/data/leagues";
import { pitchAction, pitchScale } from "../../src/data/liveFeeds/soccer";
import {
  buildCompetition, competitionLine, competitionPath, competitionTitle, hasKnockoutRounds, isPlaceholder, loadSoccerCompetition,
  parseCompetitionBoard, parseCompetitionInfo, parseCompetitionSeason, parseMatchCompetition, type SoccerCompetition,
} from "../../src/data/soccerCompetition";
import type { Bracket, BracketMatch } from "../../src/data/brackets";
import type { JSONValue } from "../../src/data/json";
import { clientRequest } from "../../shared/upstreams";
import { replay, sharedFixture } from "./fixtures";

const TODAY = { year: 2026, month: 11, day: 2 };
const file = (name: string) => sharedFixture(`competitions/${name}.json`) as JSONValue;

/** A recorded season as the page gets it, on the day it was recorded. */
function season(name: string, slug: string): SoccerCompetition {
  const json = file(name);
  return buildCompetition(slug, parseCompetitionInfo(at(json, "info")), parseCompetitionSeason(at(json, "season"))!, parseCompetitionBoard(at(json, "board"), slug), TODAY);
}

const winner = (m?: BracketMatch) => (m?.winner === "top" ? m.top?.name : m?.winner === "bottom" ? m.bottom?.name : undefined);
const tie = (b: Bracket, round: string, team: string) => b.columns?.[b.rounds.indexOf(round)]?.map((id) => b.matches[id]!).find((m) => m.top?.name === team || m.bottom?.name === team);
const fullyConnected = (b: Bracket) => b.columns!.slice(1).every((ids) => ids.every((id) => b.matches[id]!.feeders.length === 2));

describe("a competition's tree", () => {
  it("in progress: the last 16 played, the quarterfinals drawn, the rest empty places with no lines", () => {
    const carabao = season("carabao-2026", "eng.league_cup");
    expect(carabao.title).toBe("Carabao Cup");
    expect(carabao.seasonLabel).toBe("2026–27");
    const tree = carabao.bracket!;
    expect(tree.rounds).toEqual(["Fourth Round", "Quarterfinals", "Semifinals", "Final"]);
    expect(tree.columns!.map((c) => c.length)).toEqual([8, 4, 2, 1]);
    const pending = Object.values(tree.matches).filter((m) => m.pending);
    expect(pending).toHaveLength(3);
    expect(pending.every((m) => m.top == null && m.bottom == null && m.feeders.length === 0)).toBe(true);
    expect(tree.matches[tree.finalID]!.pending).toBe(true);
    const liverpool = tie(tree, "Fourth Round", "Liverpool")!;
    expect(winner(liverpool)).toBe("Liverpool");
    expect([liverpool.topScore, liverpool.bottomScore]).toEqual([1, 1]);
    const next = tie(tree, "Quarterfinals", "Liverpool")!;
    expect(next.feeders).toContain(liverpool.id);
    expect(next.topScore).toBeNull();
    const layout = bracketLayout(tree);
    expect(Object.keys(layout.slots)).toHaveLength(15);
    expect(layout.height).toBeLessThan(400);
  });

  it("finished: the same size, with every round's ties still in Fixtures", () => {
    const finished = season("carabao-2025", "eng.league_cup");
    expect(finished.stages.flatMap((s) => s.ties).length).toBeGreaterThan(80);
    const tree = finished.bracket!;
    expect(tree.rounds[0]).toBe("Fourth Round");
    expect(Object.keys(tree.matches)).toHaveLength(15);
    expect(fullyConnected(tree)).toBe(true);
    const semis = finished.stages.find((s) => s.name === "Semifinals")!;
    expect(semis.ties.map((t) => t.games.length)).toEqual([2, 2]);
    const arsenal = semis.ties.find((t) => t.match.bottom?.id === "359" || t.match.top?.id === "359")!;
    expect(winner(arsenal.match)).toBe("Arsenal");
    expect(arsenal.match.bottomScore).toBe(4);
  });

  it("no fake tree before the last 16 is drawn, and none for a league", () => {
    const early = season("fa-cup-2026", "eng.fa");
    expect(early.bracket).toBeNull();
    expect(early.undrawnFrom).toBe("Fifth Round");
    expect(season("fa-cup-2025", "eng.fa").bracket!.rounds[0]).toBe("Fifth Round");
    const league = season("premier-league-2026", "eng.1");
    expect(league.bracket).toBeNull();
    expect(league.undrawnFrom).toBeNull();
    expect(league.stages[0]!.hasStandings).toBe(true);
  });

  it("nothing crosses a group stage, and the knockout playoffs stay in Fixtures", () => {
    const ucl = season("champions-2026", "uefa.champions");
    expect(ucl.bracket).toBeNull();
    expect(ucl.undrawnFrom).toBe("Round of 16");
    expect(season("champions-2025", "uefa.champions").bracket!.rounds[0]).toBe("Round of 16");
    expect(season("libertadores-2026", "conmebol.libertadores").bracket!.rounds[0]).toBe("Round of 16");
  });

  it("the aggregate names the winner over ESPN's flag", () => {
    const tree = season("libertadores-2026", "conmebol.libertadores").bracket!;
    const quarter = tie(tree, "Quarterfinals", "Platense")!;
    expect(winner(quarter)).toBe("Fluminense");
    expect([quarter.topScore, quarter.bottomScore]).toEqual([3, 2]);
    expect(fullyConnected(tree)).toBe(true);
  });

  it("MLS: conferences across eighteen stages make one tree, a series scores games won", () => {
    const mls = season("mls-2025", "usa.1");
    expect(mls.stages.some((s) => s.name.includes("All-Star") || s.name === "Combined")).toBe(false);
    expect(mls.stages.filter((s) => s.name === "Round One")).toHaveLength(1);
    const roundOne = mls.stages.find((s) => s.name === "Round One")!;
    expect(roundOne.ties.map((t) => t.games.length)).toEqual(Array(8).fill(3));
    const tree = mls.bracket!;
    expect(tree.rounds).toEqual(["Round One", "Conference Semifinals", "Conference Finals", "MLS Cup"]);
    expect(fullyConnected(tree)).toBe(true);
    const philadelphia = roundOne.ties.find((t) => t.match.top?.id === "10739")!;
    expect([philadelphia.match.topScore, philadelphia.match.bottomScore]).toEqual([2, 0]);
    expect(philadelphia.match.winner).toBe("top");
  });

  it("a knockout phase opening wide after groups is all one tree, its third-place match beneath", () => {
    const tree = season("world-cup-2026", "fifa.world").bracket!;
    expect(tree.rounds[0]).toBe("Round of 32");
    expect(tree.columns![0]).toHaveLength(16);
    expect(tree.extra[0]?.title).toBe("3rd-Place Match");
  });

  it("two tournaments in a season: the tree is the latest one's", () => {
    expect(season("liga-mx-2025", "mex.1").bracket!.rounds[0]).toMatch(/^Clausura/);
  });

  it("names and placeholders", () => {
    expect(isPlaceholder("TBD Away")).toBe(true);
    expect(isPlaceholder("Winner Match 73")).toBe(true);
    expect(isPlaceholder("Bolton Wanderers")).toBe(false);
    expect(competitionTitle("2026-27 Spanish Copa del Rey")).toBe("Copa del Rey");
  });
});

describe("loading a competition", () => {
  const carabao = file("carabao-2026");
  it("reads the season's calendar years through the configured routes, keeping only this season's games", async () => {
    const fetcher = replay([[/\/scoreboard$/, at(carabao, "info")], [/\/seasons\/2026$/, at(carabao, "season")], [/dates=2026/, { events: [...arr(at(carabao, "board", "events")), ...arr(at(file("carabao-2025"), "board", "events"))] }], [/dates=2027/, { events: [] }]]);
    const data = await loadSoccerCompetition("eng.league_cup", null, fetcher);
    expect(data.year).toBe(2026);
    expect(data.stages.flatMap((s) => s.games).length).toBe(arr(at(carabao, "board", "events")).length);
    for (const url of fetcher.calls) expect(clientRequest(url).href).toBe(url.includes("sports.core.api") ? url : `/api/${url.slice(8)}`);
  });

  it("a season ESPN has rolled over to with nothing in it yet falls back on the one just finished", async () => {
    const last = file("carabao-2025");
    const fetcher = replay([[/\/scoreboard$/, at(carabao, "info")], [/\/seasons\/2026$/, at(carabao, "season")], [/\/seasons\/2025$/, at(last, "season")], [/dates=2025/, at(last, "board")], [/dates=2026/, { events: [] }], [/dates=2027/, { events: [] }]]);
    expect((await loadSoccerCompetition("eng.league_cup", null, fetcher)).year).toBe(2025);
  });

  it("fails rather than publishing a partial season when a year is unavailable", async () => {
    const fetcher = replay([[/\/seasons\//, at(carabao, "season")], [/dates=2026/, at(carabao, "board")]]);
    await expect(loadSoccerCompetition("eng.league_cup", 2026, fetcher)).rejects.toThrow("No fixture");
  });

  it("carries the teams to ring in its link", () => {
    expect(competitionPath("eng.league_cup", 2026, ["364", null, "363"])).toBe("/competition/eng.league_cup/2026?ring=364,363");
    expect(competitionPath("eng.1")).toBe("/competition/eng.1");
  });
});

describe("a match's competition", () => {
  it("is the summary's, whatever path opened it", () => {
    const ucl = parseMatchCompetition(file("summary-ucl"))!;
    expect(ucl.slug).toBe("uefa.champions");
    expect(competitionLine(ucl)).toBe("Champions League · League Phase");
    expect(hasKnockoutRounds(ucl)).toBe(true);
    const cup = parseMatchCompetition(file("summary-cup"))!;
    expect(competitionLine(cup)).toBe("Carabao Cup · Fourth Round");
    expect(cup.note).toBe("Liverpool win 6-5 on penalties");
    const league = parseMatchCompetition(file("summary-league"))!;
    expect(competitionLine(league)).toBe("Premier League");
    expect(hasKnockoutRounds(league)).toBe(false);
  });

  it("never reads as a provider's slug", () => {
    expect(leagueResolving("soccer/esp.copa_catalunya")?.source).toEqual({ kind: "espn", path: "soccer/esp.copa_catalunya", weekly: false });
    expect(leagueResolving("basketball/nba")?.id).toBe("nba");
    expect(leagueResolving("soccer/../nba")).toBeUndefined();
    const unlisted = parseMatchCompetition({ header: { league: { slug: "esp.copa_catalunya", abbreviation: "Copa Catalunya" }, season: { year: 2026, name: "2026 Copa Catalunya, Final" } } } as unknown as JSONValue)!;
    expect(competitionLine(unlisted)).toBe("Copa Catalunya · Final");
    expect(hasKnockoutRounds(unlisted)).toBe(true);
  });
});

describe("older plays", () => {
  const legacy = file("legacy-plays");
  const far = arr(at(legacy, "farFromGoal")), penalty = arr(at(legacy, "penalty"));
  const goal = (plays: readonly JSONValue[]) => plays.find((p) => at(p, "scoringPlay") === true);

  it("are told by their 0…1 coordinates", () => {
    expect(pitchScale(far)).toBe("unit");
    expect(pitchScale(arr(at(file("cup-goals"), "items")))).toBe("percent");
    expect(pitchScale(arr(at(file("unlocated-plays"), "items")))).toBeNull();
  });

  it("start where they were struck: a long-range goal outside the box, a penalty on the spot", () => {
    const long = pitchAction(goal(far), 0, "364", "unit")!;
    expect(long.x).toBeGreaterThan(50);
    expect(long.x).toBeLessThan(83);
    const spot = pitchAction(goal(penalty), 0, "379", "unit")!;
    expect(100 - spot.x).toBeCloseTo(88.5, 0);
    expect(spot.y).toBeCloseTo(50, 0);
    expect(long.goalY).toBeGreaterThan(44);
    expect(long.goalY).toBeLessThan(56);
  });

  it("a goal ESPN placed nowhere isn't placed", () => {
    const unlocated = arr(at(file("unlocated-plays"), "items"));
    expect(pitchAction(goal(unlocated), 0, "364", "percent")).toBeNull();
  });
});
