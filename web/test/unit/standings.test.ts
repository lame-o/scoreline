/**
 * League tables (LiveFeeds.swift `Standings`, LiveViews.swift
 * `StandingsTable`, Basketball.swift `NBAStandings`, College.swift
 * `ConferenceTable`/`ConferenceLeaderLine`, ListLayout.swift
 * `GroupPlacement`), the same checks the Mac's ChartsTests, ListsTests,
 * OutlineTests and ScorelineTests make, against trimmed recordings.
 */
import { describe, expect, it } from "vitest";
import { leagueWithID } from "../../src/data/leagues";
import type { Competitor, ScoreEvent } from "../../src/data/models";
import {
  collegeOrder,
  columnValue,
  conferenceColumns,
  fetchStandings,
  gamesBehindText,
  groupColumns,
  leaderKind,
  leaderRecords,
  leaderSpoken,
  liveScores,
  liveTable,
  makeStandingsRow,
  nbaWindow,
  nbaZone,
  parseCollege,
  parseNBA,
  parseSoccer,
  projectNBA,
  showsZones,
  standingsURL,
  tableColumns,
  tableGroups,
  tableKind,
  widthClassOf,
  zoneBoundary,
  type StandingsRow,
} from "../../src/data/standings";
import { fixture, replay } from "./fixtures";

function comp(id: string, score: string): Competitor {
  return { id, name: id, abbreviation: id, score, logo: null, isWinner: false, color: null, rank: null, record: null, conferenceRecord: null, alternateColor: null };
}

function live(top: string, ts: number, bottom: string, bs: number, extra: Partial<ScoreEvent> = {}): ScoreEvent {
  return {
    id: `${top}${bottom}`,
    content: { kind: "match", top: comp(top, `${ts}`), bottom: comp(bottom, `${bs}`) },
    state: "live",
    start: 0,
    detail: "70'",
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
    ...extra,
  };
}

function row(id: string, rank: number, p: number, w: number, d: number, l: number, gf: number, ga: number, zone: string | null = null, group: string | null = null): StandingsRow {
  return makeStandingsRow({ id, name: id, abbreviation: id, rank, played: p, wins: w, draws: d, losses: l, goalDifference: gf - ga, goalsFor: gf, points: 3 * w + d, zone, group });
}

const table = [
  row("a", 1, 8, 6, 1, 1, 18, 6, "Champions League"),
  row("b", 2, 8, 5, 2, 1, 14, 7, "Champions League"),
  row("c", 3, 8, 4, 3, 1, 12, 8, "Europa League"),
  row("d", 4, 8, 4, 1, 3, 11, 10),
  row("e", 5, 8, 1, 2, 5, 5, 15, "Relegation"),
];

describe("which leagues have a table", () => {
  it("soccer, college football and the NBA; nothing else (as on the Mac)", () => {
    expect(tableKind(leagueWithID("eng.1")!)).toBe("soccer");
    expect(tableKind(leagueWithID("college-football")!)).toBe("college");
    expect(tableKind(leagueWithID("nba")!)).toBe("nba");
    expect(tableKind(leagueWithID("nfl")!)).toBe("none");
    expect(tableKind(leagueWithID("cs2")!)).toBe("none");
    expect(standingsURL(leagueWithID("nba")!)).toBe("https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?sort=playoffseed:asc");
    expect(standingsURL(leagueWithID("mlb")!)).toBeNull();
  });
});

describe("the live projection", () => {
  it("nothing live: the official table, as ESPN has it", () => {
    const quiet = liveTable(table, []);
    expect(quiet.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(quiet.every((r) => r.movement === 0 && r.liveScore == null)).toBe(true);
    quiet.forEach((lr, i) => {
      const r = table[i]!;
      expect([lr.wins, lr.draws, lr.losses, lr.goalsFor, lr.goalsAgainst, lr.played, lr.points]).toEqual([r.wins, r.draws, r.losses, r.goalsFor, r.goalsFor - r.goalDifference, r.played, r.points]);
    });
  });

  // d leads c 3–1; e and a draw 2–2.
  const projected = liveTable(table, [live("d", 3, "c", 1), live("e", 2, "a", 2)]);
  const get = (id: string) => projected.find((r) => r.id === id)!;

  it("a live lead moves every count together", () => {
    const d = get("d");
    expect([d.played, d.wins, d.draws, d.losses, d.points]).toEqual([9, 5, 1, 3, 16]);
    expect([d.goalsFor, d.goalsAgainst, d.goalDifference]).toEqual([14, 11, 3]);
    const c = get("c");
    expect([c.played, c.wins, c.losses, c.points, c.goalsFor, c.goalsAgainst]).toEqual([9, 4, 2, 15, 13, 11]);
    expect([get("e").draws, get("e").points, get("e").goalsFor, get("e").goalsAgainst]).toEqual([3, 6, 7, 17]);
    expect([get("a").draws, get("a").points, get("a").goalsAgainst]).toEqual([2, 20, 8]);
  });

  it("every projected row adds up", () => {
    for (const r of projected) {
      expect(r.points).toBe(3 * r.wins + r.draws);
      expect(r.played).toBe(r.wins + r.draws + r.losses);
      expect(r.goalDifference).toBe(r.goalsFor - r.goalsAgainst);
    }
  });

  it("re-ranks, and zones belong to places", () => {
    expect(get("d").liveRank).toBe(3);
    expect(get("d").movement).toBe(1);
    expect(get("c").liveRank).toBe(4);
    expect(get("d").zone).toBe("Europa League");
    expect(get("c").zone).toBeNull();
    expect(get("a").zone).toBe("Champions League");
    expect(get("d").liveScore).toBe("3–1");
    expect(get("c").liveScore).toBe("1–3");
  });

  it("knockout ties don't count toward a table", () => {
    const cup = liveTable(table, [live("d", 3, "c", 1, { stage: "round-of-16" })]);
    expect(cup.every((r) => r.liveScore == null && r.movement === 0)).toBe(true);
  });

  it("zones are per group", () => {
    const groups = liveTable([row("x", 1, 1, 1, 0, 0, 2, 0, "Playoffs", "East"), row("y", 1, 1, 0, 1, 0, 1, 1, null, "West")], []);
    expect(groups[0]!.zone).toBe("Playoffs");
    expect(groups[1]!.zone).toBeNull();
  });

  it("columns by width, signed GD, zone lines", () => {
    expect(tableColumns("compact")).toEqual(["played", "goalDifference", "points"]);
    expect(tableColumns("medium")).toEqual(["played", "won", "drawn", "lost", "goalDifference", "points"]);
    expect(tableColumns("large")).toHaveLength(8);
    expect(tableColumns("xlarge")).toHaveLength(8);
    const shown = [...projected].sort((a, b) => a.liveRank - b.liveRank);
    expect(columnValue("goalDifference", shown[0]!)).toBe("+12");
    expect(columnValue("goalsAgainst", shown[2]!)).toBe("11");
    expect(zoneBoundary(0, shown)).toEqual({ label: "Champions League" });
    expect(zoneBoundary(1, shown)).toBeNull();
    expect(zoneBoundary(2, shown)).toEqual({ label: "Europa League" });
    expect(zoneBoundary(3, shown)).toEqual({ label: null });
    expect(zoneBoundary(4, shown)).toEqual({ label: "Relegation" });
    expect(zoneBoundary(1, [shown[1]!, shown[4]!])).toEqual({ label: "Relegation" });
    expect(showsZones("xlarge", shown)).toBe(true);
    expect(showsZones("large", shown)).toBe(false);
  });

  it("width classes at the Mac's thresholds", () => {
    expect([widthClassOf(379), widthClassOf(380), widthClassOf(460), widthClassOf(560)]).toEqual(["compact", "medium", "large", "xlarge"]);
  });
});

describe("parsing", () => {
  it("a soccer table: stats, ranks, zones from ESPN's notes", () => {
    const rows = parseSoccer(fixture("standings-eng1.json"));
    expect(rows).toHaveLength(20);
    expect(rows.map((r) => r.rank)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const first = rows[0]!;
    expect(first.id).toMatch(/^espn-soccer-\d+$/);
    expect(first.zone).toBe("Champions League");
    expect(first.points).toBe(3 * first.wins + first.draws);
    expect(first.played).toBe(first.wins + first.draws + first.losses);
    expect(rows.some((r) => r.zone === "Relegation")).toBe(true);
    expect(rows.find((r) => r.rank === 6)!.zone).toBeNull();
    expect(rows.every((r) => r.group == null)).toBe(true);
  });

  it("a grouped soccer table keeps each group (MLS conferences)", () => {
    const rows = parseSoccer(fixture("standings-usa1.json"));
    const groups = tableGroups(rows, (r) => r.group);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.rows.length === 5)).toBe(true);
  });

  it("college: conferences and divisions become groups, ranked by conference record", () => {
    const rows = parseCollege(fixture("standings-college.json"), "football/college-football");
    const groups = tableGroups(rows, (r) => r.group).map((g) => g.title);
    expect(groups).toContain("Sun Belt · East");
    expect(groups).toContain("SEC");
    const sec = rows.filter((r) => r.group === "SEC");
    expect(sec).toHaveLength(16);
    expect(sec.map((r) => r.rank)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    // Conference win rate first: 5–1 (.833) ahead of 4–1 (.800).
    const pct = (r: StandingsRow) => {
      const [w, l] = (r.conference ?? "0-0").split("-").map(Number);
      return w! + l! > 0 ? w! / (w! + l!) : 0;
    };
    for (let i = 1; i < sec.length; i++) expect(pct(sec[i - 1]!)).toBeGreaterThanOrEqual(pct(sec[i]!));
    expect(sec[0]!.id).toMatch(/^espn-ncaaf-/);
    expect(rows.find((r) => r.group === "Sun Belt · East")!.parentGroup).toBe("Sun Belt");
    expect(sec[0]!.details.homerecord).toBeDefined();
  });

  it("NBA: sorted by seed, every stat kept", () => {
    const rows = parseNBA(fixture("standings-nba.json"));
    const east = rows.filter((r) => r.group === "Eastern Conference");
    expect(east).toHaveLength(15);
    expect(east.map((r) => r.rank)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(east[0]!.id).toMatch(/^espn-basketball-\d+$/);
    expect(east[0]!.details.Home).toBeDefined();
    expect(east[0]!.lastTen).toMatch(/^\d+-\d+$/);
  });

  it("fetches through a Fetcher", async () => {
    const fetcher = replay([[/eng\.1\/standings$/, fixture("standings-eng1.json")]]);
    const rows = await fetchStandings(leagueWithID("eng.1")!, fetcher);
    expect(rows).toHaveLength(20);
    expect(fetcher.calls).toEqual(["https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings"]);
    expect(await fetchStandings(leagueWithID("nfl")!, fetcher)).toEqual([]);
  });
});

describe("the NBA's seeds", () => {
  const entry = (id: string, rank: number, w: number, l: number, gb: string) =>
    makeStandingsRow({ id: `espn-basketball-${id}`, name: `T${id}`, rank, wins: w, losses: l, played: w + l, group: "Eastern Conference", gamesBehind: gb });
  const rows = [entry("1", 1, 3, 0, "-"), entry("2", 2, 2, 1, "1"), entry("3", 3, 2, 1, "1"), entry("4", 4, 1, 2, "2")];

  it("nothing live: ESPN's seeding and games behind", () => {
    const quiet = projectNBA(rows, []);
    expect(quiet.every((r) => r.movement === 0)).toBe(true);
    expect(quiet[0]!.gamesBehind).toBe("–");
    expect(quiet[1]!.gamesBehind).toBe("1");
    expect(quiet[0]!.percentText).toBe("1.000");
    expect(quiet[1]!.percentText).toBe(".667");
  });

  it("the team ahead gets the win and climbs; the team behind takes the loss", () => {
    const projected = projectNBA(rows, [live("espn-basketball-3", 50, "espn-basketball-1", 40)]);
    const climber = projected.find((r) => r.id === "espn-basketball-3")!;
    expect([climber.liveRank, climber.movement, climber.wins, climber.liveScore]).toEqual([2, 1, 3, "50–40"]);
    expect(projected[0]!.id).toBe("espn-basketball-1");
    expect(projected[0]!.losses).toBe(1);
    expect(projected.find((r) => r.id === "espn-basketball-2")!.gamesBehind).toBe("0.5");
    expect(nbaWindow(projected, new Set(["espn-basketball-4"]), 1).map((r) => r.id)).toEqual(["espn-basketball-2", "espn-basketball-4"]);
  });

  it("play-in after the 6th seed, lottery after the 10th", () => {
    expect(nbaZone(6)?.label).toBe("Play-in");
    expect(nbaZone(10)?.label).toBe("Lottery");
    expect(nbaZone(7)).toBeNull();
    expect(gamesBehindText(0)).toBe("–");
    expect(gamesBehindText(2.5)).toBe("2.5");
    expect(gamesBehindText(3)).toBe("3");
  });
});

describe("college: the outline's pieces", () => {
  const rows = parseCollege(fixture("standings-college.json"), "football/college-football");

  it("columns by width, given the data", () => {
    const sec = rows.filter((r) => r.group === "SEC");
    expect(conferenceColumns("compact", sec)).toEqual({ streak: false, homeAway: false, points: false });
    expect(conferenceColumns("medium", sec)).toEqual({ streak: true, homeAway: false, points: false });
    expect(conferenceColumns("large", sec)).toEqual({ streak: true, homeAway: true, points: false });
    expect(conferenceColumns("xlarge", sec)).toEqual({ streak: true, homeAway: true, points: true });
    const plain = [makeStandingsRow({ id: "a", name: "A", rank: 1, streak: "W1" })];
    expect(conferenceColumns("xlarge", plain)).toEqual({ streak: true, homeAway: false, points: false });
  });

  it("the leader line: a leader, independents' best record, no games yet", () => {
    const sec = rows.filter((r) => r.group === "SEC");
    expect(leaderKind(sec[0]!)).toBe("leader");
    const indie = rows.filter((r) => r.group === "FBS Indep.");
    expect(leaderKind(indie[0]!)).toBe("bestRecord");
    expect(leaderKind(makeStandingsRow({ id: "x", name: "X", rank: 1, overall: "0-0", conference: "0-0" }))).toBe("none");
    const texas = makeStandingsRow({ id: "t", name: "Texas", rank: 1, overall: "7-0", conference: "4-0" });
    expect(leaderSpoken(texas, 3)).toBe("leader Texas, ranked 3, 7 wins, 0 losses, 4 wins, 0 losses in conference");
    expect(leaderRecords(texas, "leader")).toBe("7–0 · 4–0 Conf");
  });

  it("the match's conferences first, then followed teams', then ESPN's order", () => {
    const acc = rows.find((r) => r.group === "ACC")!;
    const big = rows.find((r) => r.group === "Big Ten")!;
    const ordered = collegeOrder(rows, new Set([big.id]), new Set([acc.id]));
    const groups = tableGroups(ordered, (r) => r.group).map((g) => g.title);
    expect(groups.slice(0, 2)).toEqual(["Big Ten", "ACC"]);
  });

  it("live scores from each side", () => {
    expect(liveScores([live("a", 21, "b", 14)])).toEqual({ a: "21–14", b: "14–21" });
  });
});

describe("grouped tables in two columns", () => {
  it("by row counts alone: never measured, never split", () => {
    expect(groupColumns([15, 15])).toEqual([[0], [1]]);
    expect(groupColumns([14, 17, 16, 18, 10])).toEqual([
      [0, 2, 4],
      [1, 3],
    ]);
    expect(groupColumns([8, 4, 4])).toEqual([[0], [1, 2]]);
    expect(groupColumns([5])).toEqual([[0], []]);
  });
});
