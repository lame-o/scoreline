/**
 * College football's team and player pages against a recorded team and its
 * players (test/fixtures/profiles/espn-cfb-*, `pnpm fixtures college`): what
 * college answers differently from the NFL. No depth chart and no ranked
 * summary; a roster ESPN pages at 100; the bio from the core athlete (class
 * year, hometown, no age); tiles from the season line by position, kickers and
 * punters included; the log's strip by the bio's position when a link has none.
 * Recordings change with every re-record, so these assert rules and structure.
 */
import { describe, expect, it } from "vitest";
import * as espn from "../../src/data/profiles/espn";
import { aboutFacts, careerColumns, factsLine, gameLogColumns, seasonColumns, tableColumnIndices } from "../../src/data/profiles/display";
import { emptyBio, EMPTY_PROFILE, teamRef } from "../../src/data/profiles/models";
import { profileGameLeague } from "../../src/data/profiles/routes";
import { fixture } from "./fixtures";

const f = (name: string) => fixture(`profiles/${name}`);
const PATH = "football/college-football";
const TEAM = teamRef({ id: "espn-ncaaf-2390", name: "Miami", league: "college-football" });

describe("a college team", () => {
  it("reads the header: record, conference standing and the next game, with no venue", () => {
    const h = espn.parseHeader(f("espn-cfb-team.json"), "football", PATH, "2390")!;
    expect(h.name).toBe("Miami Hurricanes");
    expect(h.record).toMatch(/^\d+-\d+$/);
    expect(h.standing).toMatch(/^\d+(st|nd|rd|th) in /);
    // College headers carry no venue (no franchise).
    expect(h.venue).toBeNull();
    expect(h.link).toContain("espn.com/college-football/team");
    if (h.next) expect(h.next.opponent?.id).toMatch(/^espn-ncaaf-\d+$/);
  });

  it("asks for the whole roster: ESPN's first page stops at 100, by surname", () => {
    expect(espn.rosterURL(PATH, "2390")).toBe("https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/2390/roster?limit=200");
    // The NFL's is under 80 a team, asked for as the Mac asks.
    expect(espn.rosterURL("football/nfl", "12")).toBe("https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/12/roster");
    const recorded = f("espn-cfb-roster.json") as { _athletes: number; _source: string };
    expect(recorded._source).toBe(espn.rosterURL(PATH, "2390"));
    expect(recorded._athletes).toBeGreaterThan(100);
  });

  it("groups the roster by unit with the class year, by position then number (no depth chart)", () => {
    expect(espn.depthURL(PATH, "2390")).toBeNull();
    const roster = espn.parseRoster(f("espn-cfb-roster.json"), "football", PATH, TEAM);
    expect(roster.coach).toBeTruthy();
    const groups = espn.groupRoster("football", roster.players, {}, {});
    expect(groups.map((g) => g.kind)).toEqual(["offense", "defense", "specialTeams"]);
    for (const p of roster.players) {
      // The class says where he is in college; the roster's "college" is the team itself.
      expect(p.detail).toMatch(/^(Freshman|Sophomore|Junior|Senior|Graduate Student)$/);
      expect(p.college).toBeNull();
      expect(p.ref.team?.id).toBe("espn-ncaaf-2390");
      expect(p.ref.photo).toContain("/headshots/college-football/players/full/");
    }
    const order = ["QB", "RB", "FB", "WR", "TE", "OT", "OL", "G", "C", "DE", "DL", "DT", "NT", "LB", "OLB", "ILB", "CB", "DB", "S", "PK", "K", "P", "LS"];
    for (const g of groups) {
      const keys = g.players.map((p) => [order.indexOf(p.position ?? ""), Number(p.jersey ?? 999)] as const);
      const sorted = [...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      expect(keys).toEqual(sorted);
    }
  });

  it("names all four leaders from the whole roster, and fills the stat lines", () => {
    const roster = espn.parseRoster(f("espn-cfb-roster.json"), "football", PATH, TEAM);
    const leaders = espn.parseLeaders(f("espn-cfb-team-leaders.json"));
    const top = espn.teamLeaders("football", leaders, roster.players);
    // On ESPN's first page alone, the leaders past it (a receiver, a tackler) went missing.
    expect(top.map((l) => l.label)).toEqual(["PASS YDS", "RUSH YDS", "REC YDS", "TACKLES"]);
    const groups = espn.groupRoster("football", roster.players, leaders, {});
    const passer = groups[0]!.players.find((p) => p.ref.id === leaders.passingYards![0]!.id)!;
    expect(passer.stats.PYDS).toBe(leaders.passingYards![0]!.value);
  });
});

describe("a college player", () => {
  it("reads the bio from the core athlete: class, hometown, size, no age", () => {
    const core = f("espn-cfb-qb-core.json");
    const bio = espn.mergeCoreAthlete(core, emptyBio(""));
    expect(bio.name).toBeTruthy();
    expect(bio.positionAbbreviation).toBe("QB");
    expect(bio.classYear).toMatch(/^(Freshman|Sophomore|Junior|Senior)/);
    expect(bio.birthPlace).toMatch(/^[^,]+, [A-Z]{2}$/);
    expect(bio.age).toBeNull();
    // A page opened from its URL learns the team from the core athlete.
    expect(espn.coreAthleteTeamID(core)).toBe("2390");
    expect(aboutFacts(bio, "football", true, EMPTY_PROFILE).map(([label]) => label)).toEqual(["Class", "Hometown", "Size", "Position"]);
    expect(factsLine(bio, "football", true, () => null)?.text.startsWith(bio.classYear!)).toBe(true);
  });

  it("builds this season's tiles from the season line, by position", () => {
    const tiles = (role: string, position: string) => espn.collegeTiles(espn.parseOverview(f(`espn-cfb-${role}-overview.json`), "football").season, position)!;
    expect(tiles("qb", "QB").tiles.map((t) => t.label)).toEqual(["YDS", "TD", "INT", "RTG"]);
    expect(tiles("wr", "WR").tiles.map((t) => t.label)).toEqual(["REC", "YDS", "TD", "AVG"]);
    expect(tiles("defender", "LB").tiles.map((t) => t.label)).toEqual(["TOT", "SACK", "INT", "PD"]);
    // Kickers and punters by their own lines: the defense's keys gave them none.
    expect(tiles("pk", "PK").tiles.map((t) => t.label)).toEqual(["FG", "FG%", "LNG", "PTS"]);
    expect(tiles("pk", "PK").tiles[0]!.value).toMatch(/^\d+-\d+$/);
    expect(tiles("p", "P").tiles.map((t) => t.label)).toEqual(["PUNTS", "AVG", "NET", "IN20"]);
    // The season line's row is the year: the caption says what it is.
    expect(tiles("qb", "QB").caption).toMatch(/^\d{4} season stats$/);
    for (const t of tiles("qb", "QB").tiles) expect(t.rank).toBeNull();
  });

  it("chooses the log's strip by the bio's position when the link knows none", () => {
    const core = f("espn-cfb-wr-core.json");
    const json = f("espn-cfb-wr-gamelog.json");
    expect(espn.logPosition(null, null, core)).toBe("WR");
    // The link's position wins (the Mac's); the core's only fills in.
    expect(espn.logPosition("TE", null, core)).toBe("TE");
    const log = espn.parseGameLog(json, PATH, espn.logPosition(null, null, core))!;
    expect(log.stripKey).toBe("receivingYards");
    // A receiver's log carries his rushing too, which a log chosen by no position drew.
    expect(espn.parseGameLog(json, PATH, null)!.stripKey).toBe("rushingYards");
    expect(log.entries.every((e) => e.opponent?.id.startsWith("espn-ncaaf-"))).toBe(true);
    expect(gameLogColumns("football", "WR", false).filter((c) => log.columns.some((x) => x.key === c.key)).map((c) => c.label)).toEqual(["REC", "YDS", "TD"]);
  });

  it("gives kickers and punters their own log and table columns", () => {
    const kick = espn.parseGameLog(f("espn-cfb-pk-gamelog.json"), PATH, "PK")!;
    expect(kick.stripKey).toBe("totalKickingPoints");
    const punt = espn.parseGameLog(f("espn-cfb-p-gamelog.json"), PATH, "P")!;
    const keys = new Set(punt.columns.map((c) => c.key));
    // The defense's columns (all a punter had) found nothing in his log.
    expect(gameLogColumns("football", "P", false).every((c) => keys.has(c.key))).toBe(true);
    const shown = (role: string, position: string) => {
      const season = espn.parseOverview(f(`espn-cfb-${role}-overview.json`), "football").season!;
      return tableColumnIndices(season.keys, season.columns.length, seasonColumns("football", position), "large").map((k) => season.columns[k]);
    };
    expect(shown("pk", "PK")).toEqual(["FG", "FG%", "LNG", "PTS"]);
    expect(shown("p", "P")).toEqual(["PUNTS", "AVG", "NET", "IN20", "LNG"]);
    // Career by season splits FG into made and attempted.
    expect(tableColumnIndices(["fieldGoalsMade", "fieldGoalAttempts", "fieldGoalPct", "longFieldGoalMade", "totalKickingPoints"], 5, careerColumns("football", "PK"), "large")).toEqual([0, 1, 2, 3, 4]);
  });

  it("reads career by season with each season's school", () => {
    const career = espn.parseCareer(f("espn-cfb-qb-career.json"))!;
    expect(career.rows.length).toBeGreaterThan(0);
    for (const row of career.rows) expect(row.title).toMatch(/^\d{4} · [A-Z&]+$/);
    // Newest first.
    const years = career.rows.map((r) => Number(r.title.slice(0, 4)));
    expect([...years].sort((a, b) => b - a)).toEqual(years);
  });
});

describe("games opened from a profile", () => {
  it("open under the page's league, so the game page asks that league alone", () => {
    expect(profileGameLeague(PATH)).toBe("college-football");
    expect(profileGameLeague("football/nfl")).toBe("nfl");
    expect(profileGameLeague("baseball/mlb")).toBe("mlb");
    // Soccer's games span competitions: a club's next game says its own; a player's log, none.
    expect(profileGameLeague("soccer/all", "uefa.champions")).toBe("soccer/uefa.champions");
    expect(profileGameLeague("soccer/eng.1")).toBeNull();
    expect(profileGameLeague(null)).toBeNull();
  });
});
