/**
 * Sports and Following at 34ba1dd (FollowingTests.swift's new checks, and
 * SoccerCompetitionTests.swift's SportsSearch ones): a soccer team has no
 * one board; a user's picks survive, parked or in use; unfollowing a
 * competition keeps its picks; a new follow alerts until its bell says
 * otherwise; a cup can be followed; one search finds competitions, ignores
 * accents and lists a team once.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { pollingIDs } from "../../src/data/following";
import { CATALOG, leagueResolving, leagueWithID } from "../../src/data/leagues";
import type { ScoreEvent } from "../../src/data/models";
import { filtered, screened } from "../../src/data/scoreboard";
import { followingSummary, indexedLeagues, sportLeagues, sportsSearch, teamLeagues } from "../../src/data/sportsSearch";
import { DEFAULTS, getSettings, sanitize, settings } from "../../src/state/settings";

const option = (id: string, name: string) => ({ id, name, logo: null, flag: null, group: null });

describe("Sports' one search", () => {
  it("finds competitions", () => {
    const ids = sportsSearch("cup", {}, []).competitions.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(["eng.fa", "fifa.world"]));
  });
  it("ignores accents, and finds a team in two lists once", () => {
    const liverpool = option("espn-soccer-364", "Liverpool");
    const atletico = option("espn-soccer-99", "Atlético Madrid");
    expect(sportsSearch("atletico", { "eng.1": [liverpool], "esp.1": [atletico] }, []).teams.map((t) => t.option.name)).toEqual(["Atlético Madrid"]);
    expect(sportsSearch("liverpool", { "eng.1": [liverpool], "eng.2": [liverpool] }, []).teams).toHaveLength(1);
  });
  it("puts names that start with what's typed first, and says nothing for an empty query", () => {
    const teams = sportsSearch("man", { "eng.1": [option("a", "Newcastle Man Utd"), option("b", "Manchester City")] }, []).teams.map((t) => t.option.name);
    expect(teams).toEqual(["Manchester City", "Newcastle Man Utd"]);
    expect(sportsSearch("  ", { "eng.1": [option("a", "Arsenal")] }, [])).toEqual({ competitions: [], editions: [], teams: [] });
  });
  it("indexes leagues' teams, not cups', tournaments' or climbing's; a sport lists its own", () => {
    const indexed = indexedLeagues();
    expect(indexed.every((l) => l.kind !== "cup" && l.kind !== "tournament" && l.source.kind !== "ifsc")).toBe(true);
    expect(teamLeagues("soccer").map((l) => l.id)).toContain("eng.1");
    expect(teamLeagues("soccer").map((l) => l.id)).not.toContain("eng.league_cup");
    expect(sportLeagues("soccer", "cup").map((l) => l.id)).toContain("eng.league_cup");
    expect(teamLeagues("climbing")).toEqual([]);
    expect(CATALOG.filter((l) => l.kind === "circuit").map((l) => l.id)).toEqual(["cs2", "ifsc"]);
  });
  it("sums up what's followed on its Following row", () => {
    expect([followingSummary(3, 1), followingSummary(1, 0), followingSummary(0, 2), followingSummary(0, 0)]).toEqual(["3 competitions · 1 team", "1 competition", "2 teams", null]);
  });
});

describe("Following (FollowingTests.swift)", () => {
  beforeEach(() => settings.reset());

  it("a football team's board is its league's; a soccer team has no one board: its next game says which", () => {
    const polled = (id: string) => pollingIDs({ ...DEFAULTS, enabledLeagues: [], followed: [{ id, name: "x", logo: null }] });
    expect([polled("espn-wnba-3"), polled("espn-basketball-3")]).toEqual([["wnba"], ["nba"]]);
    expect([polled("espn-ncaaf-3"), polled("espn-football-3")]).toEqual([["college-football"], ["nfl"]]);
    expect([polled("espn-soccer-364"), polled("cs-9")]).toEqual([[], ["cs2"]]);
  });

  it("a user's own settings: every pick survives, and which leagues use them; parked picks don't filter; turning Selected Teams on brings them back; off keeps them", () => {
    const saved = sanitize({
      schemaVersion: 2,
      enabledLeagues: ["ifsc", "eng.1", "uefa.champions", "mlb", "cs2", "nfl", "nba", "usa.1"],
      filteredLeagues: ["mlb", "uefa.champions", "ifsc"],
      teamFilters: {
        "eng.1": ["espn-soccer-382", "espn-soccer-363", "espn-soccer-364", "espn-soccer-360", "espn-soccer-359"],
        mlb: ["espn-baseball-8", "espn-baseball-25", "espn-baseball-19"],
        "uefa.champions": ["espn-soccer-132", "espn-soccer-360", "espn-soccer-382", "espn-soccer-364", "espn-soccer-359", "espn-soccer-86", "espn-soccer-83", "espn-soccer-160"],
        ifsc: ["country-USA"],
      },
      collapsed: ["cs2", "ifsc", "uefa.champions"],
      followed: [{ id: "espn-baseball-25", name: "San Diego Padres", logo: null }],
    });
    expect([saved.teamFilters["uefa.champions"]?.length, saved.teamFilters.mlb?.length, saved.teamFilters["eng.1"]?.length]).toEqual([8, 3, 5]);
    expect(saved.filteredLeagues).toEqual(["mlb", "uefa.champions", "ifsc"]);
    expect(saved.collapsed).toContain("uefa.champions");
    expect(saved.followed.map((t) => t.id)).toEqual(["espn-baseball-25"]);
    expect(saved.mutedTeams).toEqual([]);
    const epl = leagueWithID("eng.1")!;
    const game = (a: string, b: string) => ({ id: `${a}-${b}`, content: { kind: "match", top: { id: a }, bottom: { id: b } } }) as unknown as ScoreEvent;
    const games = [game("espn-soccer-364", "espn-soccer-1"), game("espn-soccer-2", "espn-soccer-3")];
    expect(filtered(games, epl, saved)).toHaveLength(2);
    const on = { ...saved, filteredLeagues: [...saved.filteredLeagues, "eng.1"] };
    expect(filtered(games, epl, on).map((g) => g.id)).toEqual(["espn-soccer-364-espn-soccer-1"]);
    settings.set("teamFilters", saved.teamFilters);
    settings.setFilterOn("eng.1", true);
    settings.setFilterOn("eng.1", false);
    expect(getSettings().teamFilters["eng.1"]).toHaveLength(5);
  });

  it("unfollowing a competition keeps its picks", () => {
    settings.togglePick("uefa.champions", "espn-soccer-364");
    settings.setEnabled("uefa.champions", false);
    expect(getSettings().teamFilters["uefa.champions"]).toEqual(["espn-soccer-364"]);
  });

  it("a new follow alerts by default; its bell turns them off; unfollowing forgets the bell", () => {
    const liverpool = { id: "espn-soccer-364", name: "Liverpool", logo: null };
    settings.toggleFollow(liverpool);
    expect(getSettings().followed.map((t) => t.id)).toEqual(["espn-soccer-364"]);
    expect(getSettings().mutedTeams).toEqual([]);
    settings.setTeamAlerts("espn-soccer-364", false);
    expect(getSettings().mutedTeams).toEqual(["espn-soccer-364"]);
    settings.toggleFollow(liverpool);
    expect(getSettings().mutedTeams).toEqual([]);
  });

  it("only real boards are polled; a cup can be followed", () => {
    expect(leagueResolving("esp.copa_catalunya")?.source).toEqual({ kind: "espn", path: "soccer/esp.copa_catalunya", weekly: false });
    expect(leagueResolving("../nba")).toBeUndefined();
    settings.setEnabled("eng.league_cup", true);
    expect(getSettings().enabledLeagues).toContain("eng.league_cup");
  });
});

describe("a team filter that empties a league (ListsTests.swift, af33b2b)", () => {
  // Your Premier League filter picks two teams; Spurs v Palace is live. The league isn't "no games": it's none of yours, with the live game offered.
  const now = Date.parse("2026-11-01T15:00:00Z");
  const match = (id: string, state: ScoreEvent["state"], start: number) =>
    ({ id, state, start, detail: state === "live" ? "42'" : null, content: { kind: "match", top: { id: `${id}-a`, name: "A", score: null }, bottom: { id: `${id}-b`, name: "B", score: null } } }) as unknown as ScoreEvent;
  const epl = leagueWithID("eng.1")!;
  const events = [match("final", "final", now - 5 * 3_600_000), match("live", "live", now - 2_400_000), match("later", "scheduled", now + 9_000_000), match("weekAway", "scheduled", now + 6 * 86_400_000)];
  const results = { "eng.1": { events, failed: false } };
  const prefs = { filteredLeagues: ["eng.1"], teamFilters: { "eng.1": ["ars", "liv"] } };
  it("today's hidden games, live first, not the fixture a week away", () => {
    expect(screened([epl], results, prefs, now)["eng.1"]?.map((e) => e.id)).toEqual(["live", "later", "final"]);
  });
  it("with the filter off, or no team picked, a quiet league is just quiet; nothing today or tomorrow, it's idle", () => {
    expect(screened([epl], results, { ...prefs, filteredLeagues: [] }, now)).toEqual({});
    expect(screened([epl], results, { ...prefs, teamFilters: {} }, now)).toEqual({});
    expect(screened([epl], { "eng.1": { events: [events[3]!], failed: false } }, prefs, now)).toEqual({});
  });
});
