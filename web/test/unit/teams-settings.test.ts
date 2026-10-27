import { beforeEach, describe, expect, it } from "vitest";
import { climbingOptions, collegeOptions, counterStrikeOptions, espnOptions } from "../../src/data/providers/teams";
import { leagueWithID } from "../../src/data/leagues";
import { DEFAULTS, getSettings, sanitize, settings } from "../../src/state/settings";
import { fixture } from "./fixtures";

describe("team lists", () => {
  it("lists an ESPN league's teams alphabetically, with IDs that match events", () => {
    const options = espnOptions(fixture("espn-nfl-teams.json"), "football/nfl", leagueWithID("nfl")!);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => /^espn-football-\d+$/.test(o.id))).toBe(true);
    expect(options.map((o) => o.name)).toEqual([...options.map((o) => o.name)].sort((a, b) => a.localeCompare(b)));
  });

  it("lists college teams by conference, Power Four first", () => {
    const options = collegeOptions(fixture("espn-college-standings.json"), "football/college-football");
    const groups = [...new Set(options.map((o) => o.group))];
    expect(groups.slice(0, 2)).toEqual(["SEC", "Big Ten"]);
    expect(options.every((o) => o.id.startsWith("espn-ncaaf-"))).toBe(true);
  });

  it("lists CS2 teams by world ranking and climbing nations by name", () => {
    expect(counterStrikeOptions(fixture("bo3-teams.json")).every((o) => o.id.startsWith("cs-"))).toBe(true);
    const nations = climbingOptions();
    expect(nations.find((n) => n.id === "country-SLO")).toMatchObject({ name: "Slovenia", flag: "🇸🇮" });
    expect(nations.map((n) => n.name)).toEqual([...nations.map((n) => n.name)].sort((a, b) => a.localeCompare(b)));
  });
});

describe("settings", () => {
  beforeEach(() => settings.reset());

  it("never trusts storage: unknown leagues, malformed teams and hockey drop out", () => {
    const s = sanitize({
      enabledLeagues: ["nfl", "nhl", "nfl", 7],
      followed: [{ id: "espn-hockey-1", name: "Bruins" }, { id: "espn-football-3", name: "Bears", logo: 5 }, "junk"],
      teamFilters: { nfl: ["espn-football-3"], nhl: ["x"], mlb: "nope" },
      theme: "neon",
      showFinished: "yes",
    });
    expect(s.enabledLeagues).toEqual(DEFAULTS.enabledLeagues);
    expect(sanitize({ enabledLeagues: ["nfl", "nhl", "nfl"] }).enabledLeagues).toEqual(["nfl"]);
    expect(s.followed).toEqual([{ id: "espn-football-3", name: "Bears", logo: null }]);
    expect(s.teamFilters).toEqual({ nfl: ["espn-football-3"] });
    expect(s.theme).toBe("system");
    expect(s.showFinished).toBe(true);
    expect(sanitize(null)).toEqual(DEFAULTS);
  });

  it("adds a league at the end, and reorders by drop or by one step", () => {
    settings.setEnabled("nba", true);
    expect(getSettings().enabledLeagues.at(-1)).toBe("nba");
    settings.moveBefore("nba", "eng.1");
    expect(getSettings().enabledLeagues[0]).toBe("nba");
    settings.move("nba", 1);
    expect(getSettings().enabledLeagues.slice(0, 2)).toEqual(["eng.1", "nba"]);
    settings.setEnabled("nba", false);
    expect(getSettings().enabledLeagues).not.toContain("nba");
  });

  it("turns a league's filter on when a team is picked, and keeps picks when it's off", () => {
    settings.togglePick("nfl", "espn-football-3");
    expect(getSettings().filteredLeagues).toContain("nfl");
    settings.setFilterOn("nfl", false);
    expect(getSettings().teamFilters["nfl"]).toEqual(["espn-football-3"]);
  });

  it("follows and unfollows teams", () => {
    settings.toggleFollow({ id: "espn-football-3", name: "Bears", logo: null });
    expect(getSettings().followed.map((t) => t.id)).toEqual(["espn-football-3"]);
    settings.toggleFollow({ id: "espn-football-3", name: "Bears", logo: null });
    expect(getSettings().followed).toEqual([]);
  });
});
