/**
 * Brackets (Brackets.swift): the MLB postseason from daily boards, CS2
 * tournaments from bo3.gg, the tree's layout and reading. The same checks
 * the Mac's ScorelineTests, SeasonResultsTests, ChartsTests and
 * MatchPolishTests make.
 */
import { describe, expect, it } from "vitest";
import {
  BRACKET,
  bracketLayout,
  bracketMatch,
  buildTournament,
  cellWidth,
  csMatch,
  focusColumn,
  hasTeam,
  isRinged,
  isSwiss,
  loadPostseason,
  loadTournament,
  maxTreeWidth,
  postseasonBracket,
  postseasonDays,
  readingOrder,
  ringIDs,
  shortSummary,
  spokenMatch,
  swissLosses,
  swissOrder,
  swissOutcome,
  swissStage,
  swissWins,
  tournamentMatchesURL,
  tree,
  type Bracket,
  type BracketMatch,
  type BracketTeam,
  type PostseasonGame,
} from "../../src/data/brackets";
import { fixture, replay } from "./fixtures";

const team = (id: string): BracketTeam => ({ id, name: id, abbreviation: id, logo: null });
const game = (round: string, a: string, b: string, wa: number, wb: number, done: boolean): PostseasonGame => ({
  round,
  teams: [team(a), team(b)],
  wins: { [a]: wa, [b]: wb },
  summary: null,
  completed: done,
  live: false,
  date: "20261001",
});

describe("the MLB postseason", () => {
  const post = postseasonBracket([
    game("ALWC", "HOU", "CHW", 0, 2, true),
    game("ALWC", "NYY", "BOS", 2, 0, true),
    game("ALDS", "CLE", "CHW", 3, 2, true),
    game("ALDS", "NYY", "TB", 0, 3, true),
    game("ALCS", "TB", "CLE", 4, 2, true),
    game("NLWC", "ATL", "PHI", 2, 1, true),
    game("World Series", "TB", "MIL", 0, 2, false),
  ])!;

  it("the World Series is the final, in progress", () => {
    const ws = post.matches[post.finalID]!;
    expect(ws.top?.id).toBe("TB");
    expect(ws.bottomScore).toBe(2);
    expect(ws.winner).toBeNull();
  });

  it("each Championship Series is fed by both Division Series; a DS by the Wild Card its newcomer won", () => {
    const alcs = post.matches[post.matches[post.finalID]!.feeders[0]!]!;
    expect(alcs.winner).toBe("top");
    expect(alcs.feeders).toHaveLength(2);
    const clePath = alcs.feeders.map((f) => post.matches[f]!).find((m) => hasTeam(m, "CLE"))!;
    expect(hasTeam(post.matches[clePath.feeders[0]!]!, "CHW")).toBe(true);
    expect(post.matches.NLCS?.top).toBeNull();
    expect(shortSummary("MIL leads series 2-1")).toBe("MIL leads 2–1");
  });

  it("rebuilds 2026 from its recorded day boards", async () => {
    const data = fixture("bracket-mlb-2026.json") as { type: unknown; days: Record<string, unknown> };
    const fetcher = replay([
      [/types\/3$/, data.type],
      ...Object.entries(data.days).map(([day, board]): [RegExp, unknown] => [new RegExp(`dates=${day}$`), board]),
      [/dates=\d+$/, { events: [] }],
    ]);
    const now = Date.parse("2026-10-27T18:00:00Z");
    const result = await loadPostseason("baseball/mlb", 2026, fetcher, now);
    expect(result.title).toBe("2026 Postseason");
    const b = result.bracket!;
    expect(b.rounds).toEqual(["Wild Card", "Division Series", "Championship", "World Series"]);
    const ws = b.matches[b.finalID]!;
    expect(ws.id.startsWith("World Series:")).toBe(true);
    expect(ws.feeders).toEqual(["ALCS:" + ws.feeders[0]!.split(":")[1], "NLCS:" + ws.feeders[1]!.split(":")[1]]);
    // Every Championship Series is decided, and each is fed by two Division Series.
    for (const cs of ws.feeders.map((f) => b.matches[f]!)) {
      expect(cs.winner).not.toBeNull();
      expect(cs.feeders).toHaveLength(2);
    }
    // The World Series' teams are the Championship Series winners.
    const champs = ws.feeders.map((f) => b.matches[f]!).map((m) => (m.winner === "top" ? m.top : m.bottom)!.id);
    expect([ws.top!.id, ws.bottom!.id].sort()).toEqual(champs.sort());
    expect(ws.note).toMatch(/leads|tied|wins/);
    // Days through tomorrow only.
    expect(fetcher.calls.some((u) => u.endsWith("dates=20261028"))).toBe(true);
    expect(fetcher.calls.some((u) => u.endsWith("dates=20261029"))).toBe(false);
  });

  it("the postseason's days run from its start to tomorrow", () => {
    const days = postseasonDays(Date.parse("2026-09-29T07:00Z"), Date.parse("2026-11-12T07:59Z"), Date.parse("2026-10-01T18:00Z"));
    expect(days).toEqual(["20260929", "20260930", "20261001", "20261002"]);
  });
});

describe("CS2 tournaments", () => {
  const data = fixture("bracket-cs2-epl24.json") as {
    tournament: { stages: { id: number; format_type: string }[] };
    stages: Record<string, unknown>;
    matches: { results: unknown[] };
  };
  const stageInfo: [number, string][] = [
    [10850, "playoff"],
    [10851, "swiss"],
    [10897, "playoff"],
  ];
  const stages = Object.fromEntries(Object.entries(data.stages).map(([k, v]) => [Number(k), v]));
  const now = Date.parse("2026-10-27T18:00:00Z");
  const built = buildTournament("ESL Pro League Season 24", stageInfo, stages, data.matches.results, now);

  it("a stage typed swiss is the Swiss table: 16 teams, 5 rounds, 3 wins to go through", () => {
    expect(built.swiss?.rows).toHaveLength(16);
    expect(built.swiss?.rounds).toBe(5);
    expect(built.swiss?.winsToAdvance).toBe(3);
    const vitality = built.swiss!.rows.find((r) => r.team.name === "Vitality")!;
    expect([swissWins(vitality), swissLosses(vitality)]).toEqual([3, 0]);
    expect(swissOutcome(vitality, built.swiss!)).toBe("Through");
    const order = swissOrder(built.swiss!);
    expect(swissWins(order[0]!)).toBe(3);
    expect(order.filter((r) => swissOutcome(r, built.swiss!) === "Through")).toHaveLength(8);
  });

  it("the playoffs are the tree, the 3rd-place match under it", () => {
    expect(built.bracket?.rounds).toEqual(["Quarterfinal", "Semifinal", "Grand final"]);
    expect(built.bracket?.extra[0]?.title).toBe("3rd place");
    const final = built.bracket!.matches[built.bracket!.finalID]!;
    expect(final.feeders).toHaveLength(2);
    expect(final.winner).not.toBeNull();
    expect(isSwiss("group") && isSwiss("swiss") && !isSwiss("playoff")).toBe(true);
  });

  it("pages its matches at 100", () => {
    const url = decodeURIComponent(tournamentMatchesURL(5110, 100));
    expect(url).toContain("page[limit]=100");
    expect(url).toContain("page[offset]=100");
    expect(url).toContain("filter[matches.tournament_id][eq]=5110");
  });

  it("loads a tournament end to end", async () => {
    const fetcher = replay([
      [/tournaments\/esl-pro-league-season-24$/, { id: 5110, name: "ESL Pro League Season 24", stages: data.tournament.stages }],
      [/stages\/10850$/, data.stages["10850"]],
      [/stages\/10851$/, data.stages["10851"]],
      [/stages\/10897$/, data.stages["10897"]],
      [/matches\?/, data.matches],
    ]);
    const loaded = await loadTournament("esl-pro-league-season-24", fetcher, now);
    expect(loaded.swiss?.rows).toHaveLength(16);
    expect(loaded.bracket?.rounds).toHaveLength(3);
  });

  it("positions number the tree depth-first", () => {
    const m = (id: number, position: number) => ({ id, position, status: "upcoming" });
    const stage = {
      rounds: [
        { name: "Quarterfinal", round_index: 1, matches: [m(13, 3), m(14, 4), m(16, 6), m(17, 7)] },
        { name: "Semifinal", round_index: 2, matches: [m(12, 2), m(15, 5)] },
        { name: "Grand final", round_index: 3, matches: [m(11, 1)] },
      ],
    };
    const t = tree(stage, new Map(), new Set(), now)!;
    expect(t.finalID).toBe("11");
    expect(t.matches["11"]!.feeders).toEqual(["12", "15"]);
    expect(t.matches["12"]!.feeders).toEqual(["13", "14"]);
    expect(t.matches["15"]!.feeders).toEqual(["16", "17"]);
    const layout = bracketLayout(t);
    expect(layout.slots["11"]!.column).toBe(2);
    expect(layout.slots["13"]!.column).toBe(0);
    // The final sits centered on its semis, each semi on its quarters.
    expect(layout.slots["12"]!.center).toBe((layout.slots["13"]!.center + layout.slots["14"]!.center) / 2);
    expect(layout.height).toBe(4 * (BRACKET.cellHeight + BRACKET.spacing) - BRACKET.spacing);
    expect(readingOrder(layout)).toEqual(["13", "14", "16", "17", "12", "15", "11"]);
  });

  it("a canceled or postponed match has no score and says so", () => {
    const teams = new Map([
      [793, team("793")],
      [791, team("791")],
    ]);
    const match = (status: string) =>
      csMatch({ id: 1, team1_id: 793, team2_id: 791, winner_team_id: 793, team1_score: 2, team2_score: 0, status, bo_type: 3, start_date: "2026-10-29T12:00:00Z" }, teams, new Set(), now)!;
    const canceled = match("canceled");
    expect([canceled.topScore, canceled.winner, canceled.note]).toEqual([null, null, "Best of 3 · Canceled"]);
    expect(match("postponed").note).toBe("Best of 3 · Postponed");
    expect(match("finished").winner).toBe("top");
    expect(match("finished").topScore).toBe(2);
  });

  it("Swiss: each round's opponent, the next one once drawn", () => {
    const stage = swissStage(
      { rounds: [{ round_index: 1, matches: [{ team1_id: 1, team2_id: 2, winner_team_id: 1 }] }, { round_index: 2, matches: [{ team1_id: 2, team2_id: 1 }] }] },
      new Map([
        [1, team("1")],
        [2, team("2")],
      ]),
    )!;
    const one = stage.rows.find((r) => r.team.id === "1")!;
    expect(one.results).toEqual([true, null]);
    expect(one.opponents.map((t) => t?.id)).toEqual(["2", "2"]);
  });
});

describe("reading a tree", () => {
  const a = team("Yankees");
  const b = team("Guardians");
  const matches: Record<string, BracketMatch> = {
    q1: bracketMatch({ id: "q1", top: a, bottom: b, topScore: 3, bottomScore: 1, winner: "top" }),
    q2: bracketMatch({ id: "q2", top: b, bottom: a, live: true }),
    f: bracketMatch({ id: "f", feeders: ["q1", "q2"] }),
  };
  const bracket: Bracket = { rounds: ["Semifinals", "Final"], matches, finalID: "f", extra: [] };

  it("opens a scrolled tree on the live round", () => {
    expect(focusColumn(bracket, bracketLayout(bracket))).toBe(0);
  });

  it("cell widths: shared up to 180, names from 120, scrolling under 96", () => {
    expect(cellWidth(312, 4)).toBe(69);
    expect(cellWidth(732, 4)).toBe(174);
    expect(cellWidth(732, 3)).toBe(180);
    expect(maxTreeWidth(3)).toBe(564);
    expect(cellWidth(312, 5)).toBeLessThan(BRACKET.minCell);
    expect(cellWidth(560, 4)).toBeGreaterThanOrEqual(BRACKET.namesFrom);
  });

  it("speaks each matchup", () => {
    expect(spokenMatch(matches.q1!, "Semifinals")).toBe("Semifinals: Yankees 3, Guardians 1. Yankees won.");
    expect(spokenMatch(matches.q2!, "Semifinals")).toBe("Semifinals: Guardians versus Yankees. Live.");
    expect(spokenMatch(matches.f!, "Final")).toBe("Final: to be decided.");
  });

  it("rings the originating match's teams", () => {
    const ring = ringIDs(["espn-baseball-Yankees", "espn-baseball-Guardians"]);
    expect(isRinged(matches.q1!, ring)).toBe(true);
    expect(isRinged(matches.f!, ring)).toBe(false);
    expect(isRinged(matches.q1!, new Set())).toBe(false);
    expect([...ringIDs(["cs-793", "10"])]).toEqual(["793", "10"]);
  });
});

describe("where a scrolled tree opens", () => {
  it("on a series under way between games, ahead of the last decided round", () => {
    const a = team("TB");
    const b = team("MIL");
    const matches: Record<string, BracketMatch> = {
      s1: bracketMatch({ id: "s1", top: a, bottom: team("CLE"), topScore: 4, bottomScore: 2, winner: "top" }),
      s2: bracketMatch({ id: "s2", top: team("LAD"), bottom: b, topScore: 0, bottomScore: 4, winner: "bottom" }),
      ws: bracketMatch({ id: "ws", top: a, bottom: b, topScore: 0, bottomScore: 3, feeders: ["s1", "s2"] }),
    };
    const bracket: Bracket = { rounds: ["Championship", "World Series"], matches, finalID: "ws", extra: [] };
    expect(focusColumn(bracket, bracketLayout(bracket))).toBe(1);
  });
});
