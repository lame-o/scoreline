/**
 * The other profile sources (bo3.gg, IFSC, FotMob), team results and the
 * table window, against trimmed recordings.
 */
import { describe, expect, it } from "vitest";
import * as bo3 from "../../src/data/profiles/bo3";
import * as fotmob from "../../src/data/profiles/fotmob";
import * as ifsc from "../../src/data/profiles/ifsc";
import { teamRef, type RosterPlayer } from "../../src/data/profiles/models";
import { formMarks, parseStandings, parseTeamResults, standingsPath, standingsWindow } from "../../src/data/profiles/results";
import { fixture } from "./fixtures";

const f = (name: string) => fixture(`profiles/${name}`);
const items = (name: string) => (f(name) as { items: unknown }).items;

describe("CS2 teams (bo3.gg)", () => {
  const ref = teamRef({ id: "cs-667", name: "Vitality", league: "cs2" });

  it("finds a team's slug from its ID", () => {
    expect(bo3.parseSlug(f("bo3-team-lookup.json"))).toBe("vitality");
  });

  it("reads the roster with countries, the coach, the benched and the world rank", () => {
    const team = bo3.parseTeam(f("bo3-team.json"), ref, Date.UTC(2026, 9, 27))!;
    expect(team.header.name).toBe("Vitality");
    expect(team.header.rank).toBeGreaterThan(0);
    expect(team.header.link).toBe("https://bo3.gg/teams/vitality");
    expect(team.header.coach).toBe(team.players.find((p) => p.isCoach)?.ref.name);
    const zywoo = team.players.find((p) => p.ref.name === "ZywOo")!;
    expect(zywoo.ref.source).toEqual({ kind: "counterStrike", slug: "zywoo" });
    expect(zywoo.ref.country).toBe("FR");
    expect(zywoo.detail).toBe("Mathieu Herbaut");
    expect(zywoo.stats.RATING).toMatch(/^\d\.\d\d$/);
    expect(zywoo.age).toBe(25);
    // Photos through bo3's image proxy, list-sized.
    expect(zywoo.ref.photo).toMatch(/^https:\/\/image-proxy\.bo3\.gg\/.*\?w=96&h=96$/);
    expect(team.players.some((p) => p.benched)).toBe(true);
  });

  it("keeps S-tier titles only, newest first", () => {
    const team = bo3.parseTeam(f("bo3-team.json"), ref)!;
    expect(team.titles.length).toBeGreaterThan(0);
    const dates = team.titles.map((t) => t.date ?? 0);
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it("reads career tiles, the next match and recent results", () => {
    const tiles = bo3.parseTeamCareer(f("bo3-team-stats.json"));
    expect(tiles.map((t) => t.label)).toEqual(["MATCHES", "MAPS", "EVENTS", "ROUNDS"]);
    expect(tiles[0]!.value).toMatch(/^\d+%$/);
    expect(tiles[2]!.rank).toMatch(/^won of \d+$/);
    const next = bo3.parseNextMatch(f("bo3-team-upcoming.json"), 667);
    if (next) {
      expect(next.opponent?.id).toMatch(/^cs-\d+$/);
      expect(next.network).toMatch(/^Best of \d$/);
      expect(next.slug).toBeTruthy();
    }
    const history = bo3.parseHistory(f("bo3-team-history.json"), 667);
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((g) => g.state === "final" && ["W", "L", "D"].includes(g.result!))).toBe(true);
    expect(history.every((g) => g.opponent?.id !== "cs-667")).toBe(true);
  });
});

describe("CS2 players (bo3.gg)", () => {
  it("reads the bio: real name, country, team, prize money", () => {
    const p = bo3.parsePlayer(f("bo3-player.json"))!;
    expect(p.bio.name).toBe("ZywOo");
    expect(p.bio.realName).toBe("Mathieu Herbaut");
    expect(p.bio.country).toBe("FR");
    expect(p.bio.team?.id).toMatch(/^cs-\d+$/);
    expect(p.bio.photo).toMatch(/\?w=240&h=240$/);
    expect(p.rating).toBeGreaterThan(0);
  });

  it("makes the form tiles from rating, K/D, ADR and headshots", () => {
    const g = bo3.parseGeneral(f("bo3-player-general.json"));
    const hs = bo3.parseHeadshotShare(items("bo3-player-accuracy.json"));
    expect(g.kd).toBeGreaterThan(0.5);
    expect(g.adr).toBeGreaterThan(40);
    expect(hs).toBeGreaterThan(0);
    expect(hs).toBeLessThan(1);
    const tiles = bo3.csTiles(7.1, g.kd, g.adr, hs);
    expect(tiles.map((t) => t.label)).toEqual(["RATING", "K/D", "ADR", "HS%"]);
    expect(tiles[3]!.value).toMatch(/^\d+%$/);
  });

  it("reads the last matches as a log with maps in game order", () => {
    const log = bo3.parseMatches(items("bo3-player-matches.json"))!;
    expect(log.stripKey).toBe("rating");
    const dates = log.entries.map((e) => e.date);
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
    const e = log.entries[0]!;
    expect(e.stats.kd).toMatch(/^\d+–\d+$/);
    expect(e.stats.maps?.split(", ").every((m) => !m.startsWith("de_"))).toBe(true);
    expect(["W", "L", "D"]).toContain(e.result);
  });

  it("reads the map pool best first, and the top two roles", () => {
    const maps = bo3.parseMaps(items("bo3-player-maps.json"));
    expect(maps.length).toBeGreaterThan(0);
    expect(maps.every((m) => !m.name.startsWith("de_"))).toBe(true);
    const ratings = maps.map((m) => m.rating);
    expect([...ratings].sort((a, b) => b - a)).toEqual(ratings);
    const roles = bo3.parseRoles(items("bo3-player-roles.json"));
    expect(roles.length).toBeLessThanOrEqual(2);
    expect(bo3.mapName("de_dust2")).toBe("Dust II");
    expect(bo3.mapName("de_thera")).toBe("Thera");
  });
});

describe("climbers (IFSC)", () => {
  it("reads the bio, podiums, results and World Cup ranks", () => {
    const c = ifsc.parseAthlete(f("ifsc-athlete.json"), Date.UTC(2026, 9, 27))!;
    expect(c.bio.name).toBe("Janja Garnbret");
    expect(c.bio.country).toBe("SLO");
    expect(c.bio.nationality).toBe("Slovenia");
    expect(c.bio.height).toBe("164 cm");
    expect(c.bio.link).toBe("https://ifsc.results.info/athlete/1147");
    expect(c.profile.podiums.every((p) => p.gold + p.silver + p.bronze > 0)).toBe(true);
    expect(c.profile.podiums.map((p) => p.discipline)).toContain("Boulder & Lead");
    expect(c.profile.worldChampionships.length).toBeGreaterThan(0);
    expect(c.profile.results.length).toBeGreaterThan(0);
    expect(c.profile.results.every((r) => !r.event.startsWith("World Climbing Series"))).toBe(true);
    expect(c.profile.tiles.some((t) => t.rank?.startsWith("World Cup"))).toBe(true);
    expect(c.profile.speedBest).toMatch(/ s · /);
  });

  it("shortens event names", () => {
    expect(ifsc.shortEvent("World Climbing Series Santiago 2026")).toBe("Santiago 2026");
    expect(ifsc.shortEvent("IFSC Climbing World Championships Seoul 2025")).toBe("Worlds Seoul 2025");
    expect(ifsc.shortEvent("Europe - Continental Championships Munich 2022")).toBe("Europeans Munich 2022");
    expect(ifsc.shortEvent("IFSC Climbing World Cup Kranj (SLO) 2021")).toBe("Kranj 2021");
  });
});

describe("FotMob (soccer photos, injuries, the coach)", () => {
  it("finds the club in its league, then reads the squad", () => {
    expect(fotmob.parseTeamID(items("fotmob-search.json"), "Arsenal", "eng.1")).toBe(9825);
    const squad = fotmob.parseSquad(f("fotmob-team.json"))!;
    expect(squad.coach).toBeTruthy();
    expect(squad.members.length).toBeGreaterThan(5);
    expect(squad.members.some((m) => m.injury != null)).toBe(true);
    // Fit players have `injury: null`: not injured.
    expect(squad.members.some((m) => m.injury == null)).toBe(true);
  });

  it("matches only when it's unambiguous", () => {
    const members = [
      { id: 1, name: "Martin Ødegaard", shirt: 8, injury: null },
      { id: 2, name: "Gabriel Magalhães", shirt: 6, injury: null },
      { id: 3, name: "Gabriel Jesus", shirt: 9, injury: null },
      { id: 4, name: "Ben White", shirt: 4, injury: null },
      { id: 5, name: "Kieran White", shirt: 40, injury: null },
    ];
    expect(fotmob.matchMember("Martin Odegaard", "8", members)?.id).toBe(1);
    expect(fotmob.matchMember("Gabriel", "6", members)?.id).toBe(2);
    expect(fotmob.matchMember("B. White", null, members)?.id).toBe(4);
    // Two Gabriels and no shirt to tell them apart: nobody.
    expect(fotmob.matchMember("Gabriel", null, members)).toBeNull();
    expect(fotmob.matchMember("Someone Else", "99", members)).toBeNull();
  });

  it("says injuries the pages' way and applies them to a squad", () => {
    expect(fotmob.memberInjury({ id: 1, name: "A", shirt: null, injury: "Late November 2026" })).toEqual({ status: "Out", detail: "Expected back late November" });
    expect(fotmob.memberInjury({ id: 1, name: "A", shirt: null, injury: "Doubtful" })).toEqual({ status: "Doubtful", detail: null });
    expect(fotmob.memberInjury({ id: 1, name: "A", shirt: null, injury: "Injured" })).toEqual({ status: "Out", detail: null });
    const player = (name: string, jersey: string): RosterPlayer => ({
      ref: { source: { kind: "espn", path: "soccer/eng.1" }, id: name, name, photo: null, team: null, jersey, position: "D", country: null },
      jersey, position: "D", positionName: null, age: null, birthDate: null, height: null, weight: null, detail: null, college: null,
      injury: null, injuryReturn: null, stats: {}, sourceGroup: null, isCoach: false, benched: false,
    });
    const squad = { members: [{ id: 955406, name: "William Saliba", shirt: 2, injury: "Late November 2026" }], coach: "Mikel Arteta" };
    const [saliba, nobody] = fotmob.applySquad([player("William Saliba", "2"), player("No Match", "77")], squad);
    expect(saliba!.ref.photo).toBe("https://images.fotmob.com/image_resources/playerimages/955406.png");
    expect(saliba!.injury).toBe("Out");
    expect(saliba!.injuryReturn).toBe("late November");
    expect(nobody!.ref.photo).toBeNull();
  });
});

describe("results, form and the table window", () => {
  it("reads a club's results across competitions, friendlies aside, newest first", () => {
    const results = parseTeamResults(f("espn-soccer-schedule.json"), "soccer", "soccer/eng.1", "359");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((g) => g.state === "final" && !/friendly/i.test(g.competition ?? ""))).toBe(true);
    const dates = results.map((g) => g.date);
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
    const marks = formMarks(results);
    expect(marks.length).toBeLessThanOrEqual(5);
    // Oldest first, read out in words.
    expect(marks.at(-1)?.id).toBe(results[0]!.id);
    expect(marks[0]!.spoken).toMatch(/^[A-Z][a-z]+ \d+, (won|lost|drew)/);
  });

  it("reads NBA results", () => {
    const results = parseTeamResults(f("espn-nba-schedule.json"), "basketball", "basketball/nba", "13");
    expect(results.every((g) => g.opponent?.id.startsWith("espn-basketball-"))).toBe(true);
  });

  it("takes seven rows of the team's own table around it", () => {
    const rows = parseStandings(f("espn-eng1-standings.json"), "soccer/eng.1", "soccer");
    expect(rows.length).toBe(20);
    const top = standingsWindow(rows, rows[0]!.id);
    expect(top.rows.length).toBe(7);
    expect(top.first).toBe(0);
    const mid = standingsWindow(rows, rows[10]!.id);
    expect(mid.rows[3]!.id).toBe(rows[10]!.id);
    const bottom = standingsWindow(rows, rows[19]!.id);
    expect(bottom.rows.at(-1)!.id).toBe(rows[19]!.id);
    expect(bottom.first).toBe(13);
    expect(rows[0]!.stats.points).toMatch(/^\d+$/);

    const nba = parseStandings(f("espn-nba-standings.json"), "basketball/nba", "basketball");
    const conferences = new Set(nba.map((r) => r.group));
    expect(conferences.size).toBe(2);
    const lakers = standingsWindow(nba, "espn-basketball-13", { bySeed: true });
    expect(lakers.rows.every((r) => r.group === nba.find((x) => x.id === "espn-basketball-13")!.group)).toBe(true);
    const seeds = lakers.rows.map((r) => Number(r.stats.playoffSeed));
    expect([...seeds].sort((a, b) => a - b)).toEqual(seeds);
  });

  it("shows the table for soccer, the NBA and college football only", () => {
    expect(standingsPath("basketball", "espn-basketball-13", null)).toBe("basketball/nba");
    expect(standingsPath("football", "espn-football-12", null)).toBeNull();
    expect(standingsPath("football", "espn-ncaaf-130", null)).toBe("football/college-football");
    expect(standingsPath("baseball", "espn-baseball-19", null)).toBeNull();
    expect(standingsPath("soccer", "espn-soccer-359", "soccer/eng.1")).toBe("soccer/eng.1");
  });
});
