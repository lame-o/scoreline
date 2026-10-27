/**
 * The profile pages' pure rules: references and routes, the hero photo's
 * no-flash rule, display columns and facts, the docked bar's progress, and
 * the charts' geometry.
 */
import { describe, expect, it } from "vitest";
import { drawsStrip, entryContext, mapDomain, monthTicks, nearestBar, rankPosition, stripLayout } from "../../src/data/profiles/charts";
import { aboutFacts, seasonColumns, dockDetail, dockMotion, dockStep, footballStatLine, gameLogColumns, heroTuck, rosterSubtitle, spokenHeight, tableColumnIndices, widthClassOf, height } from "../../src/data/profiles/display";
import { emptyBio, EMPTY_PROFILE, initials, isSupportedTeam, lastName, playerKey, playerRef, profileRank, properCase, teamRef, teamSource, type GameLog, type RosterPlayer } from "../../src/data/profiles/models";
import { espnPhoto, heroPhotoURL, initialHeroPhoto, nextHeroPhoto } from "../../src/data/profiles/photos";
import { playerFromRoute, playerHref, teamFromRoute, teamHref } from "../../src/data/profiles/routes";

describe("references", () => {
  it("knows where each team's data lives", () => {
    expect(teamSource(teamRef({ id: "espn-ncaaf-130", name: "Michigan" }))).toEqual({ kind: "espn", sport: "football", path: "football/college-football", team: "130" });
    expect(teamSource(teamRef({ id: "espn-soccer-359", name: "Arsenal", league: "eng.1" }))).toMatchObject({ path: "soccer/eng.1" });
    // A club in a league without rosters (the Champions League) asks ESPN for its domestic league.
    expect(teamSource(teamRef({ id: "espn-soccer-359", name: "Arsenal", league: "uefa.champions" }))).toMatchObject({ path: null });
    expect(teamSource(teamRef({ id: "cs-667", name: "Vitality" }))).toEqual({ kind: "counterStrike", id: 667 });
    // The WNBA's teams get no pages.
    expect(isSupportedTeam(teamRef({ id: "espn-basketball-14", name: "Liberty", league: "wnba" }))).toBe(false);
    expect(isSupportedTeam(teamRef({ id: "ifsc-1", name: "x" }))).toBe(false);
  });

  it("makes initials, proper case, last names and ranks", () => {
    expect(initials("LeBron James")).toBe("LJ");
    expect(initials("Kenneth Walker III")).toBe("KW");
    expect(initials("ZywOo")).toBe("Z");
    expect(properCase("TRI RAMADANI")).toBe("Tri Ramadani");
    expect(properCase("ANNE-SOPHIE")).toBe("Anne-Sophie");
    expect(lastName("Kenneth Walker III")).toBe("Walker III");
    expect(lastName("Patrick Mahomes")).toBe("Mahomes");
    expect(profileRank("Tied-13th")).toEqual({ rank: 13, text: "T-13th" });
    expect(profileRank("26th")).toBeNull();
    expect(profileRank("31st", 32)).toEqual({ rank: 31, text: "31st" });
  });
});

describe("routes", () => {
  it("round-trips teams and players through their paths", () => {
    expect(teamHref(teamRef({ id: "espn-soccer-359", name: "Arsenal", league: "eng.1" }))).toBe("/team/espn-soccer-359?league=eng.1");
    expect(teamHref(teamRef({ id: "espn-football-12", name: "Chiefs", league: "nfl" }))).toBe("/team/espn-football-12");
    expect(teamFromRoute("espn-soccer-359", "eng.1")?.league).toBe("eng.1");
    expect(teamFromRoute("nonsense", null)).toBeNull();
    const cases = [
      playerRef({ source: { kind: "espn", path: "basketball/nba" }, id: "1966", name: "LeBron James" }),
      playerRef({ source: { kind: "espn", path: "football/college-football" }, id: "4430807", name: "A" }),
      playerRef({ source: { kind: "espn", path: "soccer/eng.1" }, id: "280555", name: "Bukayo Saka" }),
      playerRef({ source: { kind: "espn", path: "soccer/uefa.champions" }, id: "1", name: "B" }),
      playerRef({ source: { kind: "counterStrike", slug: "jl-cs-go" }, id: "26564", name: "jL" }),
      playerRef({ source: { kind: "ifsc" }, id: "1147", name: "Janja Garnbret" }),
    ];
    for (const ref of cases) {
      const back = playerFromRoute(decodeURIComponent(playerHref(ref).slice("/player/".length)))!;
      expect(back.source).toEqual(ref.source);
      if (ref.source.kind !== "counterStrike") expect(back.id).toBe(ref.id);
      expect(playerKey(back)).toBe(playerKey(ref));
    }
    expect(playerHref(cases[0]!)).toBe("/player/nba-1966");
    expect(playerHref(cases[4]!)).toBe("/player/cs2-jl-cs-go");
    expect(playerFromRoute("nba-abc")).toBeNull();
    expect(playerFromRoute("wnba-1")).toBeNull();
  });
});

describe("the hero photo: hero size from the first frame, never swapped while shown", () => {
  const ref = playerRef({ source: { kind: "espn", path: "basketball/nba" }, id: "1966", name: "LeBron James", photo: espnPhoto("basketball/nba", "1966", "small") });

  it("asks for the hero crop from the athlete ID, not the list's thumbnail", () => {
    expect(heroPhotoURL(ref)).toBe(espnPhoto("basketball/nba", "1966", "hero"));
    expect(heroPhotoURL(ref)).toContain("w=260&h=190");
    // A soccer link without a photo has no headshot: wait for the bio.
    expect(heroPhotoURL(playerRef({ source: { kind: "espn", path: "soccer/eng.1" }, id: "1", name: "A" }))).toBeNull();
    // FotMob's face crop is one size: kept.
    const fot = "https://images.fotmob.com/image_resources/playerimages/9.png";
    expect(heroPhotoURL(playerRef({ source: { kind: "espn", path: "soccer/eng.1" }, id: "1", name: "A", photo: fot }))).toBe(fot);
    // bo3: the 240px proxy, from a list's 96px thumbnail.
    expect(heroPhotoURL(playerRef({ source: { kind: "counterStrike", slug: "zywoo" }, id: "1", name: "ZywOo", photo: "https://image-proxy.bo3.gg/uploads/p.webp?w=96&h=96" }))).toBe("https://image-proxy.bo3.gg/uploads/p.webp?w=240&h=240");
  });

  it("opens with a photo already decoded, else the link's", () => {
    const hero = heroPhotoURL(ref)!;
    expect(initialHeroPhoto(ref, "https://bio/photo.png", (u) => u === "https://bio/photo.png")).toBe("https://bio/photo.png");
    expect(initialHeroPhoto(ref, "https://bio/photo.png", () => false)).toBe(hero);
  });

  it("keeps the photo on screen when the bio's arrives", () => {
    expect(nextHeroPhoto("a", "b", (u) => u === "a")).toBe("a");
    // Only the monogram showing: take the bio's.
    expect(nextHeroPhoto("a", "b", () => false)).toBe("b");
    expect(nextHeroPhoto(null, "b", () => false)).toBe("b");
    expect(nextHeroPhoto("a", null, () => false)).toBe("a");
  });
});

describe("display rules", () => {
  const rosterPlayer = (fields: Partial<RosterPlayer>): RosterPlayer => ({
    ref: playerRef({ source: { kind: "espn", path: "football/nfl" }, id: "1", name: "A B" }),
    jersey: "15", position: "QB", positionName: "Quarterback", age: 31, birthDate: null, height: null, weight: null, detail: null, college: null,
    injury: null, injuryReturn: null, stats: {}, sourceGroup: "offense", isCoach: false, benched: false, ...fields,
  });

  it("says football rosters as a stat line by position", () => {
    expect(footballStatLine(rosterPlayer({ stats: { PYDS: "1,474", PTD: "9" } }))).toBe("1,474 yds · 9 TD");
    expect(footballStatLine(rosterPlayer({ stats: { PYDS: "200", PTD: "0" } }))).toBe("200 yds");
    expect(footballStatLine(rosterPlayer({ position: "OT", stats: { TOT: "3" } }))).toBeNull();
    expect(footballStatLine(rosterPlayer({ position: "LB", stats: { TOT: "41", SACK: "2" } }))).toBe("41 tkl · 2 sk");
  });

  it("leads a roster row's subtitle with an injury, but not in its own group", () => {
    const p = rosterPlayer({ injury: "Out", injuryReturn: "late November" });
    expect(rosterSubtitle(p, "football", "offense")).toEqual({ status: "Out until late Nov", rest: "#15 · QB" });
    expect(rosterSubtitle(p, "football", "injuredReserve").status).toBeNull();
    expect(rosterSubtitle(rosterPlayer({ injury: "Day-To-Day" }), "basketball", "bench")).toEqual({ status: "Day-to-day", rest: "#15 · Quarterback" });
    // CS2: the country's flag, then the real name.
    const zywoo = rosterPlayer({ jersey: null, detail: "Mathieu Herbaut", ref: playerRef({ source: { kind: "counterStrike", slug: "zywoo" }, id: "1", name: "ZywOo", country: "FR" }) });
    expect(rosterSubtitle(zywoo, "esports", "players").rest).toBe("🇫🇷 Mathieu Herbaut");
  });

  it("adds game-log columns as the block widens, and only ones the log has", () => {
    expect(widthClassOf(300)).toBe("compact");
    expect(widthClassOf(400)).toBe("medium");
    expect(widthClassOf(500)).toBe("large");
    expect(widthClassOf(600)).toBe("xlarge");
    const pitching = gameLogColumns("baseball", "SP", true).map((c) => c.key);
    expect(pitching.slice(0, 3)).toEqual(["innings", "earnedRuns", "strikeouts"]);
    expect(gameLogColumns("baseball", "DH", false)[0]!.key).toBe("hits");
    // A pitcher's season line: innings and strikeouts, not hits allowed.
    expect(seasonColumns("baseball", "SP").map(([k]) => k).slice(0, 3)).toEqual(["gamesPlayed", "innings", "strikeouts"]);
    expect(seasonColumns("baseball", "1B").map(([k]) => k).slice(0, 3)).toEqual(["gamesPlayed", "hits", "homeRuns"]);
    expect(tableColumnIndices(["a", "gamesPlayed", "avgPoints"], 3, [["gamesPlayed", "compact"], ["avgPoints", "compact"], ["fieldGoalPct", "medium"]], "compact")).toEqual([1, 2]);
    // Nothing preferred exists: the first few columns.
    expect(tableColumnIndices(["x", "y", "z", "w", "v"], 5, [["q", "compact"]], "compact")).toEqual([0, 1, 2, 3]);
  });

  it("lists the facts each sport cares about, skipping what's missing", () => {
    const bio = { ...emptyBio("A"), birthDate: Date.UTC(1999, 2, 12), birthPlace: "Akron, OH", height: "6' 9\"", weight: "250 lbs", batsThrows: "Left/Right", debutYear: 2018 };
    expect(aboutFacts(bio, "baseball", false, EMPTY_PROFILE)).toEqual([
      ["Born", "Mar 12, 1999 · Akron, OH"],
      ["Bats / Throws", "Left/Right"],
      ["Debut", "2018"],
      ["Size", "6′9″ · 250 lb"],
    ]);
    expect(aboutFacts(emptyBio("B"), "basketball", false, EMPTY_PROFILE)).toEqual([]);
    expect(height("6' 2\"")).toBe("6′2″");
    expect(spokenHeight("6' 2\"")).toBe("6 feet 2 inches");
    expect(spokenHeight("164 cm")).toBe("164 cm");
  });

  it("says the docked bar's detail", () => {
    const team = teamRef({ id: "espn-basketball-13", name: "Lakers", abbreviation: "LAL" });
    expect(dockDetail("basketball", { ...emptyBio("A"), positionAbbreviation: "SF" }, team, true, () => null)).toBe("LAL · SF");
    expect(dockDetail("basketball", emptyBio("A"), null, true, () => null)).toBe("Free agent");
    expect(dockDetail("basketball", { ...emptyBio("A"), active: false }, null, true, () => null)).toBe("Retired");
    expect(dockDetail("basketball", emptyBio("A"), null, false, () => null)).toBeNull();
    expect(dockDetail("climbing", { ...emptyBio("J"), country: "SLO", nationality: "Slovenia" }, null, true, () => "🇸🇮")).toBe("🇸🇮 Slovenia");
  });
});

describe("the docked bar", () => {
  it("docks in 64 steps over three quarters of the hero, after a quarter has tucked", () => {
    expect(dockStep(0, 100, 0)).toBe(0);
    expect(dockStep(0, 100, 25)).toBe(0);
    expect(dockStep(0, 100, 25 + 71)).toBe(64);
    expect(dockStep(0, 100, 25 + 35.5)).toBe(32);
    // Every step is a whole 1/64.
    for (let y = 0; y < 120; y += 3.7) expect(Number.isInteger(dockStep(10, 100, y))).toBe(true);
  });

  it("settles in from 96% and 6pt up, clickable from half docked", () => {
    expect(dockMotion(0)).toEqual({ opacity: 0, scale: 0.96, offset: -6, interactive: false });
    const full = dockMotion(1);
    expect(full.opacity).toBe(1);
    expect(full.scale).toBe(1);
    expect(full.offset).toBeCloseTo(0);
    expect(full.interactive).toBe(true);
    expect(dockMotion(0.3).opacity).toBe(0);
    expect(dockMotion(0.5).interactive).toBe(true);
  });

  it("tucks the hero: shrinks 6% and fades as it slides under", () => {
    expect(heroTuck(0, 100)).toEqual({ scale: 1, opacity: 1 });
    const gone = heroTuck(-75, 100);
    expect(gone.scale).toBeCloseTo(0.94);
    expect(gone.opacity).toBeCloseTo(0);
  });
});

describe("chart geometry", () => {
  it("packs a season's bars from the left and spreads a fixed window", () => {
    const bars = stripLayout([10, 0, null, 20], 200, 50);
    expect(bars.map((b) => b.width)).toEqual([10, 10, 10, 10]);
    expect(bars[0]!.x).toBe(0);
    expect(bars[1]!.x).toBe(12);
    // A played zero is a sliver; a game not played is a stub.
    expect(bars[1]!.height).toBe(1);
    expect(bars[2]!.played).toBe(false);
    expect(bars[3]!.height).toBe(50);
    const spread = stripLayout([1, 2], 100, 50, null, true);
    expect(spread[0]!.width).toBe(14);
    expect(spread[1]!.x).toBeGreaterThan(50);
    // A long season in a narrow strip stays inside the plot.
    const season = stripLayout(Array.from({ length: 151 }, () => 1), 258, 50);
    const last = season.at(-1)!;
    expect(last.x + last.width).toBeCloseTo(258);
    expect(season[1]!.x).toBeGreaterThan(season[0]!.x + season[0]!.width);
    // A fixed reference raises the ceiling (Game Score's 50 × 1.15).
    expect(stripLayout([40], 100, 50, 57.5)[0]!.height).toBeCloseTo((40 / 57.5) * 50);
  });

  it("finds the bar under the pointer, and nothing between bars", () => {
    const bars = stripLayout([1, 2, 3], 300, 50);
    expect(nearestBar(bars, 5)).toBe(0);
    expect(nearestBar(bars, 17)).toBe(1);
    expect(nearestBar(bars, 200)).toBeNull();
  });

  it("draws a strip only from five games", () => {
    const log = (n: number): GameLog => ({ columns: [], entries: Array.from({ length: n }, (_, i) => ({ eventID: String(i), date: i, opponent: null, home: true, result: null, teamScore: null, opponentScore: null, stats: {}, postseason: false, competition: null, played: true })), stripKey: "points", stripLabel: "Points", markKey: null, reference: null, referenceLabel: null, matchStrip: false, season: null, category: null });
    expect(drawsStrip(log(4))).toBe(false);
    expect(drawsStrip(log(5))).toBe(true);
  });

  it("labels months and reads a game's context", () => {
    const day = (m: number, d: number) => new Date(2026, m, d).getTime();
    const entries = [day(8, 28), day(8, 30), day(9, 2), day(9, 5)].map((date, i) => ({ eventID: String(i), date, opponent: { id: "x", name: "Seattle", logo: null, league: null, color: null, alternateColor: null, abbreviation: "SEA" }, home: false, result: "L", teamScore: "3", opponentScore: "20", stats: {}, postseason: false, competition: null, played: true }));
    const bars = stripLayout(entries.map(() => 1), 400, 50);
    expect(monthTicks(entries, bars).map((t) => t.label)).toEqual(["Sep"]);
    const wide = stripLayout(entries.map(() => 1), 4000, 50, null, true);
    expect(monthTicks(entries, wide).map((t) => t.label)).toEqual(["Sep", "Oct"]);
    expect(entryContext(entries[0]!)).toBe("Mon, Sep 28 at SEA · L 3–20");
  });

  it("puts ratings on a padded shared scale and ranks on a track", () => {
    const [lo, hi] = mapDomain([{ name: "A", maps: 10, rating: 7, adr: 0 }, { name: "B", maps: 10, rating: 7.1, adr: 0 }]);
    expect(lo).toBeCloseTo(6.85);
    expect(hi).toBeCloseTo(7.25);
    expect(rankPosition(1, 30)).toBe(0);
    expect(rankPosition(30, 30)).toBe(1);
    expect(rankPosition(40, 30)).toBe(1);
  });
});

describe("the profile pages' upstreams", () => {
  it("allows every URL the pages ask for, cached for as long as it stays true", async () => {
    const { proxyPath, resolveProxyPath, SCHEDULE, CATALOG } = await import("../../shared/upstreams");
    const espn = await import("../../src/data/profiles/espn");
    const bo3 = await import("../../src/data/profiles/bo3");
    const fotmob = await import("../../src/data/profiles/fotmob");
    const ifsc = await import("../../src/data/profiles/ifsc");
    const results = await import("../../src/data/profiles/results");
    const urls = [
      espn.teamURL("football/nfl", "12"), espn.teamURL(null, "359"), espn.rosterURL("soccer/eng.1", "359"), espn.depthURL("football/nfl", "12")!,
      espn.depthURL("basketball/nba", "13")!, espn.leadersURL("basketball/nba", "13"), espn.teamStatsURL("baseball/mlb", "19")!,
      espn.transactionsURL("football/nfl", "12")!, espn.athleteURL("basketball/nba", "1966"), espn.overviewURL("basketball/nba", "1966"),
      espn.careerURL("basketball/nba", "1966"), espn.coreAthleteURL("basketball/nba", "1966"), espn.gamelogURL("baseball/mlb", "39832", "pitching"),
      espn.leagueLeadersURL("soccer/eng.1"), results.teamScheduleURL("soccer", "soccer/eng.1", "359"), results.standingsURL("soccer/eng.1"),
      bo3.teamURL("vitality"), bo3.teamLookupURL(667), bo3.teamStatsURL("vitality"), bo3.upcomingURL(667), bo3.historyURL(667), bo3.playerURL("zywoo"),
      bo3.generalURL("zywoo"), bo3.matchesURL("zywoo"), bo3.mapsURL("zywoo"), bo3.rolesURL("zywoo"), bo3.accuracyURL("zywoo"),
      fotmob.searchURL("Arsenal"), fotmob.fotMobTeamURL(9825), ifsc.athleteURL("1147"),
    ];
    for (const url of urls) expect(() => proxyPath(url), url).not.toThrow();
    const policy = (url: string) => {
      const u = new URL(url);
      return resolveProxyPath(`/api/${u.host}${u.pathname}`, u.search)?.policy;
    };
    // The header says the record and the next game: half an hour, not the team list's six.
    expect(policy(espn.teamURL("football/nfl", "12"))).toBe(SCHEDULE);
    expect(policy("https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams")).toBe(CATALOG);
    expect(policy(espn.coreAthleteURL("basketball/nba", "1966"))).toBe(SCHEDULE);
    expect(policy(bo3.playerURL("zywoo"))).toBe(SCHEDULE);
    expect(policy(fotmob.fotMobTeamURL(9825))?.edge).toBe(43_200);
    // FotMob's other paths stay closed.
    expect(resolveProxyPath("/api/www.fotmob.com/api/matchDetails", "")).toBeNull();
  });
});
