import { describe, expect, it } from "vitest";
import { CATALOG, LIVE, SCHEDULE, TABLES, proxyPath, resolveProxyPath } from "../../shared/upstreams";
import { teamPalette, teamTone, NEUTRAL } from "../../src/data/teamColors";

describe("the upstream allowlist", () => {
  it("maps an upstream URL onto the proxy transparently", () => {
    expect(proxyPath("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261027")).toBe(
      "/api/site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261027",
    );
    expect(proxyPath("https://ifsc.results.info/api/v1/")).toBe("/api/ifsc.results.info/api/v1/");
  });

  it("accepts only the allowlisted hosts and prefixes", () => {
    const ok = [
      "/api/site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard",
      "/api/site.api.espn.com/apis/v2/sports/soccer/eng.1/standings",
      "/api/sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/1/competitions/1/plays",
      "/api/site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/1",
      "/api/api.bo3.gg/api/v1/matches",
      "/api/ifsc.results.info/api/v1/events/1489",
      "/api/statsapi.mlb.com/api/v1/schedule",
    ];
    for (const path of ok) expect(resolveProxyPath(path, ""), path).not.toBeNull();
    const refused = [
      "/api/evil.example/x",
      "/api/site.api.espn.com/other/path",
      "/api/site.api.espn.com/apis/site/v2/sports/../../../etc",
      "/api/site.api.espn.com/apis/site/v2/sports/%2e%2e/x",
      "/api/site.api.espn.com/apis/site/v2/sports//x",
      "/api/a.espncdn.com/i/teamlogos/nfl/500/chi.png",
      "/api/www.youtube.com/@WorldClimbing/live",
      "/api/",
      "/not-api/site.api.espn.com/apis/site/v2/sports/nfl/scoreboard",
    ];
    for (const path of refused) expect(resolveProxyPath(path, ""), path).toBeNull();
    expect(() => proxyPath("https://example.com/")).toThrow();
    expect(() => proxyPath("http://site.api.espn.com/apis/site/v2/sports/nfl/scoreboard")).toThrow();
  });

  it("caches each kind of data for as long as it stays true", () => {
    expect(resolveProxyPath("/api/site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard", "")?.policy).toBe(LIVE);
    expect(resolveProxyPath("/api/site.api.espn.com/apis/v2/sports/soccer/eng.1/standings", "")?.policy).toBe(TABLES);
    expect(resolveProxyPath("/api/site.api.espn.com/apis/site/v2/sports/football/nfl/teams/3/schedule", "")?.policy).toBe(SCHEDULE);
    expect(resolveProxyPath("/api/site.api.espn.com/apis/site/v2/sports/football/nfl/teams", "")?.policy).toBe(CATALOG);
    expect(resolveProxyPath("/api/ifsc.results.info/api/v1/category_rounds/1/results", "")?.policy).toBe(LIVE);
    expect(resolveProxyPath("/api/ifsc.results.info/api/v1/", "")?.upstream.headers?.Referer).toBe("https://ifsc.results.info/");
  });
});

describe("team colors", () => {
  it("lifts dark colors on dark and deepens pale ones on light, keeping the hue", () => {
    const navyOnDark = teamTone("0b1c3a", "dark")!;
    const navyOnLight = teamTone("0b1c3a", "light")!;
    expect(navyOnLight).toBe("#0b1c3a");
    expect(navyOnDark).not.toBe("#0b1c3a");
    // Black has nothing to lift into; white nothing to deepen.
    expect(teamTone("000000", "dark")).toBeNull();
    expect(teamTone("ffffff", "light")).toBeNull();
  });

  it("sends the second of two near-identical teams to neutral", () => {
    expect(teamPalette("c8102e", "c60c30", "light").bottom).toBe(NEUTRAL);
    expect(teamPalette("c8102e", "0b1c3a", "light").bottom).not.toBe(NEUTRAL);
  });
});
