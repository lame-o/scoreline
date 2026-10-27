/**
 * ESPN team and player parsers (src/data/profiles/espn.ts) against trimmed
 * recordings (test/fixtures/profiles). Recorded data changes with every
 * re-record, so these assert structure and rules; numbers are checked against
 * the fixture itself where they can be.
 */
import { describe, expect, it } from "vitest";
import * as espn from "../../src/data/profiles/espn";
import { hasPlay, teamRef, type RosterPlayer } from "../../src/data/profiles/models";
import { fixture } from "./fixtures";

const f = (name: string) => fixture(`profiles/${name}`);

describe("the athlete overview", () => {
  it("reads the bio, the team and the ranked season summary", () => {
    const a = espn.parseAthlete(f("espn-nba-athlete.json"), "basketball/nba")!;
    expect(a.bio.name).toBe("LeBron James");
    expect(a.bio.team?.id).toMatch(/^espn-basketball-\d+$/);
    expect(a.bio.team?.league).toBe("nba");
    expect(a.bio.draft).toBe("2003 · Round 1, Pick 1 · CLE");
    // The hero asks for the hero-size crop, never the list's thumbnail.
    expect(a.bio.photo).toContain("w=260&h=190");
    expect(a.bio.link).toContain("espn.com/nba/player");
    expect(a.tiles.length).toBeGreaterThan(0);
    expect(a.tiles[0]!.label).toBe("PTS");
    // Ranks past 25th aren't context; "Tied-" reads "T-".
    for (const tile of a.tiles) if (tile.rank) expect(Number(tile.rank.replace(/\D/g, ""))).toBeLessThanOrEqual(25);
    expect(a.tiles.some((t) => t.rank?.includes("Tied"))).toBe(false);
    expect(a.tilesCaption).toMatch(/season stats/);
  });

  it("merges the core athlete: the ISO birth date and the draft", () => {
    const a = espn.parseAthlete(f("espn-nba-athlete.json"), "basketball/nba")!;
    const bio = espn.mergeCoreAthlete(f("espn-nba-core-athlete.json"), a.bio);
    expect(new Date(bio.birthDate!).toISOString().slice(0, 10)).toBe("1984-12-30");
    expect(bio.birthPlace).toBe("Akron, OH");
  });

  it("turns soccer's START (SUB) into starts with the bench said in words", () => {
    const a = espn.parseAthlete(f("espn-soccer-athlete.json"), "soccer/eng.1")!;
    const starts = a.tiles.find((t) => t.label === "STARTS")!;
    expect(starts.value).toMatch(/^\d+$/);
    expect(starts.rank == null || /^\+\d+ off the bench$/.test(starts.rank)).toBe(true);
  });

  it("formats drafts and cleans standings", () => {
    expect(espn.formatDraft("2017: Rd 1, Pk 10 (KC)")).toBe("2017 · Round 1, Pick 10 · KC");
    expect(espn.formatDraft("Undrafted")).toBe("Undrafted");
    expect(espn.cleanStanding("2nd in English Premier League")).toBe("2nd in Premier League");
    expect(espn.cleanStanding("1st in Eastern Conference Division")).toBe("1st in Eastern Conference");
  });

  it("reads the season table, RotoWire's note and awards", () => {
    const o = espn.parseOverview(f("espn-nba-overview.json"), "basketball");
    expect(o.season?.columns).toContain("PTS");
    expect(o.season?.keys).toContain("avgPoints");
    expect(o.season?.rows.map((r) => r.title)).toContain("Career");
    expect(o.note?.headline.length).toBeGreaterThan(10);
    expect(o.awards.every((a) => !/\dx /.test(a))).toBe(true);
    expect(o.awards.some((a) => /^\d+× /.test(a))).toBe(true);
  });

  it("orders soccer competitions domestic first, international last, and names them short", () => {
    const o = espn.parseOverview(f("espn-soccer-overview.json"), "soccer");
    expect(o.season).toBeNull();
    const titles = o.competitions!.rows.map((r) => r.title);
    expect(titles[0]).toBe("Premier League");
    expect(titles).toContain("Champions League");
    expect(titles.at(-1)).toMatch(/World Cup|Nations League|International/);
    expect(espn.competitionName("2026-27 English Premier League")).toBe("Premier League");
    expect(espn.competitionName("2026-27 UEFA Europa League")).toBe("Europa League");
  });

  it("parses RotoWire's dates", async () => {
    const { rotowireDate } = await import("../../src/data/profiles/read");
    expect(new Date(rotowireDate("Sun Oct 25 10:06:18 PDT 2026")!).toISOString()).toBe("2026-10-25T17:06:18.000Z");
    expect(rotowireDate("not a date")).toBeNull();
  });
});

describe("the game log", () => {
  it("joins stats with events, in date order, preseason excluded", () => {
    const raw = f("espn-nba-gamelog.json") as { seasonTypes: { displayName: string }[] };
    const log = espn.parseGameLog(raw, "basketball/nba", "F")!;
    expect(log.stripKey).toBe("points");
    expect(log.entries.length).toBeGreaterThan(0);
    const dates = log.entries.map((e) => e.date);
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
    // The fixture includes a preseason; none of its games are kept.
    expect(raw.seasonTypes.some((t) => t.displayName.includes("Preseason"))).toBe(true);
    const e = log.entries[0]!;
    expect(e.opponent?.id).toMatch(/^espn-basketball-/);
    expect(["W", "L"]).toContain(e.result);
    expect(e.stats.points).toMatch(/^\d+$/);
    // Home is the side that isn't the opponent.
    expect(typeof e.home).toBe("boolean");
  });

  it("strips football by position", () => {
    const qb = espn.parseGameLog(f("espn-nfl-gamelog.json"), "football/nfl", "QB")!;
    expect(qb.stripKey).toBe("passingYards");
    expect(qb.columns.find((c) => c.key === "passingYards")?.label).toBe("YDS");
    // Names repeat labels ("YDS" twice); keys stay unique.
    expect(new Set(qb.columns.map((c) => c.key)).size).toBe(qb.columns.length);
  });

  it("reads soccer as a match strip of goals and assists", () => {
    const log = espn.parseGameLog(f("espn-soccer-gamelog.json"), "soccer/eng.1", "F")!;
    expect(log.matchStrip).toBe(true);
    expect(log.stripKey).toBe("totalGoals");
    expect(log.markKey).toBe("goalAssists");
    expect(log.entries.every((e) => e.competition === "Premier League")).toBe(true);
  });

  describe("MLB: the player's role, and Pitching only for two-way players", () => {
    it("opens a starter on pitching, with Game Score against a fixed 50", () => {
      const log = espn.parseGameLog(f("espn-mlb-pitcher-gamelog.json"), "baseball/mlb", null)!;
      expect(log.category).toBe("pitching");
      expect(log.stripKey).toBe("avgGameScore");
      expect(log.reference).toBe(50);
      expect(log.referenceLabel).toBe("50 avg start");
      expect(hasPlay(log)).toBe(true);
    });

    it("drops a pitcher's batting log: every appearance is zeros", () => {
      const batting = espn.parseGameLog(f("espn-mlb-pitcher-batting.json"), "baseball/mlb", null, false)!;
      expect(batting.category).toBe("batting");
      expect(batting.entries.length).toBeGreaterThan(0);
      // ".000", "0": nothing in any game, so there's no Batting/Pitching toggle.
      expect(hasPlay(batting)).toBe(false);
    });

    it("keeps a two-way player's other log", () => {
      const main = espn.parseGameLog(f("espn-mlb-twoway-gamelog.json"), "baseball/mlb", "DH")!;
      expect(main.category).toBe("batting");
      expect(main.stripKey).toBe("hits");
      expect(main.markKey).toBe("homeRuns");
      const other = espn.parseGameLog(f("espn-mlb-twoway-pitching.json"), "baseball/mlb", "SP", true)!;
      expect(other.category).toBe("pitching");
      expect(other.stripKey).toBe("avgGameScore");
      expect(hasPlay(other)).toBe(true);
    });

    it("treats decisions and dashes as no play", () => {
      const log = espn.parseGameLog(f("espn-mlb-pitcher-batting.json"), "baseball/mlb", null)!;
      const fake = { ...log, entries: log.entries.map((e) => ({ ...e, stats: { ...e.stats, "wins-losses": "1-0", ERA: "-" } })) };
      expect(hasPlay(fake)).toBe(false);
      const real = { ...log, entries: [{ ...log.entries[0]!, stats: { ...log.entries[0]!.stats, hits: "1" } }] };
      expect(hasPlay(real)).toBe(true);
    });
  });
});

describe("career by season", () => {
  it("reads the averages newest first, with the team's code", () => {
    const career = espn.parseCareer(f("espn-nba-career.json"))!;
    expect(career.columns).toContain("PTS");
    expect(career.rows.length).toBeGreaterThan(0);
    const first = career.rows[0]!.title;
    expect(first).toMatch(/^\d{4}-\d{2}( · [A-Z]{2,4})?$/);
    const years = career.rows.map((r) => Number(r.title.slice(0, 4)));
    expect([...years].sort((a, b) => b - a)).toEqual(years);
  });
});

describe("teams", () => {
  it("reads the header: record, standing, venue and the next game", () => {
    const h = espn.parseHeader(f("espn-nfl-team.json"), "football", "football/nfl", "12")!;
    expect(h.name).toBe("Kansas City Chiefs");
    expect(h.shortName).toBe("Chiefs");
    expect(h.record).toMatch(/^\d+-\d+/);
    expect(h.standing).toMatch(/AFC West/);
    expect(h.venue).toBeTruthy();
    expect(h.link).toContain("espn.com/nfl/team");
    expect(h.next?.opponent?.id).toMatch(/^espn-football-/);
    if (h.next?.state === "final") expect(["W", "L", "D"]).toContain(h.next.result);
  });

  it("reads a club's domestic league from its header", () => {
    const h = espn.parseHeader(f("espn-soccer-team.json"), "soccer", null, "359")!;
    expect(h.leagueSlug).toBe("eng.1");
    expect(h.standing).toBe("2nd in Premier League".replace("2nd", h.standing!.split(" ")[0]!));
  });

  it("groups an NFL roster by unit, depth-chart starters first", () => {
    const team = teamRef({ id: "espn-football-12", name: "Chiefs" });
    const roster = espn.parseRoster(f("espn-nfl-roster.json"), "football", "football/nfl", team);
    expect(roster.coach).toBe("Andy Reid");
    const chart = espn.parseDepthChart(f("espn-nfl-depthchart.json"))!;
    expect(chart.units.map((u) => u.kind)).toEqual(["offense", "defense", "specialTeams"]);
    // Slots in football order, not JSON order.
    expect(chart.units[0]!.slots.map((s) => s.key)).toEqual(["qb", "rb", "wr1", "lt"]);
    expect(chart.units[0]!.slots[0]!.label).toBe("QB");
    const order: Record<string, string[]> = {};
    for (const slot of chart.units.flatMap((u) => u.slots)) order[slot.key] = slot.players.map((p) => p.id);
    const groups = espn.groupRoster("football", roster.players, {}, order);
    expect(groups.map((g) => g.kind)).toEqual(["offense", "defense", "specialTeams", "injuredReserve", "practiceSquad"]);
    expect(groups[0]!.players[0]!.ref.name).toBe("Patrick Mahomes");
    // Players link to their pages with the team they play for and a small headshot.
    expect(groups[0]!.players[0]!.ref.team?.id).toBe("espn-football-12");
    expect(groups[0]!.players[0]!.ref.photo).toContain("w=96&h=70");
  });

  it("names the NBA's starting five from the depth chart and fills columns from the leaders", () => {
    const team = teamRef({ id: "espn-basketball-13", name: "Lakers" });
    const roster = espn.parseRoster(f("espn-nba-roster.json"), "basketball", "basketball/nba", team);
    const depth = espn.parseCoreDepth(f("espn-nba-depth.json"));
    expect(Object.keys(depth)).toEqual(expect.arrayContaining(["pg", "sg", "sf", "pf", "c"]));
    const leaders = espn.parseLeaders(f("espn-nba-team-leaders.json"));
    const groups = espn.groupRoster("basketball", roster.players, leaders, depth);
    expect(groups[0]!.kind).toBe("starters");
    expect(groups[0]!.players.length).toBeLessThanOrEqual(5);
    // No one starts while out.
    expect(groups[0]!.players.every((p) => p.injury !== "Out")).toBe(true);
    const withPoints = groups.flatMap((g) => g.players).filter((p) => p.stats.PTS != null);
    expect(withPoints.length).toBeGreaterThan(0);
    // The bench by minutes, most first.
    const bench = groups.find((g) => g.kind === "bench")?.players ?? [];
    const minutes = bench.map((p) => Number(p.stats.MIN ?? -1));
    expect([...minutes].sort((a, b) => b - a)).toEqual(minutes);
    const top = espn.teamLeaders("basketball", leaders, roster.players);
    expect(top.map((l) => l.label)).toEqual(expect.arrayContaining(["PTS", "REB", "AST"]));
  });

  it("groups baseball by role and soccer by line, most used first", () => {
    const pitcher = (id: string, position: string, jersey: string): RosterPlayer => ({
      ref: { source: { kind: "espn", path: "baseball/mlb" }, id, name: id, photo: null, team: null, jersey, position, country: null },
      jersey, position, positionName: null, age: null, birthDate: null, height: null, weight: null, detail: null, college: null,
      injury: null, injuryReturn: null, stats: {}, sourceGroup: position === "C" ? "Catchers" : "Pitchers", isCoach: false, benched: false,
    });
    const groups = espn.groupRoster("baseball", [pitcher("a", "SP", "40"), pitcher("b", "SP", "12"), pitcher("c", "RP", "50"), pitcher("d", "RP", "10"), pitcher("e", "C", "16")], {}, { p: ["b", "a"], cl: ["c"] });
    expect(groups.map((g) => g.kind)).toEqual(["rotation", "bullpen", "catchers"]);
    expect(groups[0]!.players.map((p) => p.ref.id)).toEqual(["b", "a"]);
    // The closer leads the bullpen.
    expect(groups[1]!.players.map((p) => p.ref.id)).toEqual(["c", "d"]);

    const club = teamRef({ id: "espn-soccer-359", name: "Arsenal", league: "eng.1" });
    const squad = espn.parseRoster(f("espn-soccer-roster.json"), "soccer", "soccer/eng.1", club);
    expect(squad.coach).toBeNull();
    const lines = espn.groupRoster("soccer", squad.players, {}, {});
    expect(lines.map((g) => g.kind)).toEqual(expect.arrayContaining(["goalkeepers", "defenders", "midfielders", "forwards"]));
    for (const g of lines) {
      const apps = g.players.map((p) => Number(p.stats.appearances ?? -1));
      expect([...apps].sort((a, b) => b - a)).toEqual(apps);
    }
    // Soccer headshots are rare: only the ones ESPN lists are asked for.
    expect(squad.players.filter((p) => p.ref.photo == null).length).toBeGreaterThan(0);
    expect(squad.players.find((p) => p.ref.name === "Bukayo Saka")?.detail).toBe("England");
  });

  it("reads team stats with ranks, dropping ranks past the league's size", () => {
    const stats = espn.parseTeamStats(f("espn-nba-team-stats.json"), "basketball");
    expect(stats.length).toBeGreaterThan(0);
    for (const s of stats) if (s.rank != null) expect(s.rank).toBeLessThanOrEqual(30);
    expect(stats.map((s) => s.label)).toContain("Blocks");
  });

  it("reads transactions and finishes the clipped word", () => {
    const tx = espn.parseTransactions(f("espn-nba-transactions.json"));
    expect(tx.length).toBeGreaterThan(0);
    expect(espn.parseTransactions({ transactions: [{ date: "2026-10-01T07:00Z", description: "Signed G Jane Doe to a contrac." }] })[0]!.text).toBe("Signed G Jane Doe to a contract.");
  });

  it("ranks NBA tiles from the league leaders where the summary has none", () => {
    const leaders = espn.parseLeaders(f("espn-nba-league-leaders.json"));
    const top = leaders.pointsPerGame![0]!.id;
    const tiles = espn.applyLeagueRanks([{ label: "PTS", value: "40.1", rank: null }, { label: "REB", value: "9.0", rank: "3rd" }], leaders, "basketball/nba", top);
    expect(tiles[0]!.rank).toBe("1st");
    expect(tiles[1]!.rank).toBe("3rd");
  });

  it("builds college tiles from the season line", () => {
    const fill = espn.collegeTiles({ columns: ["YDS", "TD", "INT", "RTG"], keys: ["passingYards", "passingTouchdowns", "interceptions", "QBRating"], rows: [{ title: "2026", values: ["2,100", "18", "4", "160.2"] }] }, "QB")!;
    expect(fill.tiles.map((t) => t.label)).toEqual(["YDS", "TD", "INT", "RTG"]);
    expect(fill.caption).toBe("2026 season stats");
  });

  it("knows which ESPN players have pages", () => {
    expect(espn.espnPlayerRef("basketball/wnba", "1", "A")).toBeNull();
    expect(espn.espnPlayerRef("soccer/uefa.champions", "1", "A")?.source).toEqual({ kind: "espn", path: "soccer/uefa.champions" });
  });

  it("asks for the season ESPN files the date under", () => {
    const oct = new Date(2026, 9, 27).getTime();
    expect(espn.espnSeason("basketball/nba", oct)).toEqual({ year: 2027, type: 2 });
    expect(espn.espnSeason("soccer/eng.1", oct)).toEqual({ year: 2026, type: 1 });
    expect(espn.espnSeason("football/nfl", new Date(2027, 0, 20).getTime())).toEqual({ year: 2026, type: 2 });
    expect(espn.depthURL("football/college-football", "130")).toBeNull();
    expect(espn.teamStatsURL("soccer/eng.1", "359")).toBeNull();
  });
});
