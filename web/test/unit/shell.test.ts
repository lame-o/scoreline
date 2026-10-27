/**
 * The app shell's pure rules: CS2 live rounds (bo3.gg's last snapshot), the
 * Notifier's words, My Teams' fallback to a team's schedule, the pinned
 * game's place in the Live tier, the tab's title and favicon, the keyboard
 * commands and the detail pane's scroll memory.
 */
import { describe, expect, it } from "vitest";
import type { Competitor, FollowedTeam, LeagueResult, ScoreEvent } from "../../src/data/models";
import { makeMatchEvent } from "../../src/data/providers/counterStrike";
import { csLiveLine, csLiveWatch, mapName, parseLive, withLiveRounds } from "../../src/data/providers/csLive";
import { alertFor, notificationBody, pollAlerts } from "../../src/data/notifier";
import { backgroundInterval, board, keepIdentity, myTeamsEvents, type ListPreferences, type NextGame } from "../../src/data/scoreboard";
import { faviconScore, pinExpired, tabEvent, tabTitle } from "../../src/data/tabScore";
import { composeTitle } from "../../src/app/useDocumentTitle";
import { commandFor } from "../../src/app/commands";
import { landingOffset } from "../../src/app/scrollMemory";
import { raceOf } from "../../src/features/scores/TileStrips";
import { pickOutline, pickSections } from "../../src/data/pickOutline";
import { stops, stopKey } from "../../src/data/outline";
import { nextDayAfterWindow, parseCalendar } from "../../src/data/providers/schedule";
import type { TeamOption } from "../../src/data/providers/teams";
import { fixture, replay } from "./fixtures";

const NOW = Date.parse("2026-10-27T18:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function team(id: string, extra: Partial<Competitor> = {}): Competitor {
  return { id, name: id.toUpperCase(), abbreviation: id.slice(0, 3).toUpperCase(), score: null, logo: null, isWinner: false, color: null, rank: null, record: null, conferenceRecord: null, alternateColor: null, ...extra };
}

function game(id: string, state: ScoreEvent["state"], start: number, scores: [string | null, string | null] = [null, null], extra: Partial<ScoreEvent> = {}, teams: [string, string] = ["ars", "che"]): ScoreEvent {
  return {
    id,
    content: { kind: "match", top: team(teams[0], { score: scores[0], name: teams[0] === "ars" ? "Arsenal" : teams[0].toUpperCase() }), bottom: team(teams[1], { score: scores[1], name: teams[1] === "che" ? "Chelsea" : teams[1].toUpperCase() }) },
    state,
    start,
    detail: null,
    caption: null,
    link: null,
    ref: { kind: "espn", path: "soccer/eng.1", id, sport: "soccer" },
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

const prefs = (overrides: Partial<ListPreferences> = {}): ListPreferences => ({
  enabledLeagues: ["eng.1", "nfl"],
  followed: [],
  teamFilters: {},
  filteredLeagues: [],
  collegeTop25Only: true,
  climbingDisciplines: ["boulder", "lead", "speed"],
  showFinished: true,
  liveFirst: false,
  ...overrides,
});
const follow = (...ids: string[]): FollowedTeam[] => ids.map((id) => ({ id, name: id.toUpperCase(), logo: null }));

// MARK: - CS2 live

describe("CS2 live rounds", () => {
  const snapshot = fixture("bo3-live-snapshot.synthetic.json");

  it("orients the snapshot to the match's teams by fixture ID", () => {
    // team_one is Aurora (3598), the match's bottom team.
    const live = parseLive(snapshot, 790, 3598)!;
    expect(live).toEqual({ mapName: "Mirage", mapNumber: 2, round: 14, topScore: 5, bottomScore: 8, topSide: "T", bottomSide: "CT", mapEnded: false });
    expect(csLiveLine(live)).toBe("Mirage 5–8");
    // Listed the other way round, no swap.
    expect(parseLive(snapshot, 3598, 790)!.topScore).toBe(8);
  });

  it("needs both scores, and names maps as the Mac does", () => {
    expect(parseLive({ team_one: { score: 3 } }, 1, 2)).toBeNull();
    expect(mapName("de_dust2")).toBe("Dust II");
    expect(mapName("de_thera")).toBe("Thera");
    expect(mapName(null)).toBe("TBD");
  });

  it("watches followed and pinned matches, and in Tiles the first four live", () => {
    const live = (id: string, start: number) => game(id, "live", start, ["0", "0"], {}, [`cs-${id}`, `cs-x${id}`]);
    const events = [live("1", 5), live("2", 4), live("3", 3), live("4", 2), live("5", 1), game("6", "scheduled", 9)];
    const followed = (e: ScoreEvent) => e.id === "5";
    const list = csLiveWatch(events, followed, "1", false);
    expect([...list.listed].sort()).toEqual(["1", "5"]);
    expect([...list.watched].sort()).toEqual(["1", "5"]);
    const tiles = csLiveWatch(events, followed, "1", true);
    // Followed, then pinned, then by start: 5, 1, 4, 3.
    expect([...tiles.watched].sort()).toEqual(["1", "3", "4", "5"]);
  });

  it("puts the round on listed rows and the race on every watched tile; a miss leaves no race", async () => {
    const match = makeMatchEvent((fixture("bo3-matches-current.synthetic.json") as { results: unknown[] }).results[0])!;
    const fetcher = replay([[/live\/matches\/132240\/last_snapshot/, snapshot]]);
    const [listed] = await withLiveRounds([match], { listed: new Set([match.id]), watched: new Set([match.id]) }, fetcher);
    expect(fetcher.calls[0]).toBe("https://api.bo3.gg/api/v1/live/matches/132240/last_snapshot?discipline_id=1");
    expect(listed!.detail).toBe("Mirage 5–8");
    expect(listed!.snapshot).toMatchObject({ kind: "counterStrike", live: { topScore: 5, bottomScore: 8 } });
    const [tileOnly] = await withLiveRounds([match], { listed: new Set(), watched: new Set([match.id]) }, fetcher);
    expect(tileOnly!.detail).toBe("Map 2 of 3");
    const [missed] = await withLiveRounds([{ ...match, snapshot: listed!.snapshot }], { listed: new Set([match.id]), watched: new Set([match.id]) }, replay([]));
    expect(missed!.snapshot).toBeNull();
    expect(missed!.detail).toBe("Map 2 of 3");
  });

  it("keeps an unchanged event's identity across polls", () => {
    const a = game("1", "live", NOW, ["1", "0"]);
    const same = { ...a };
    const moved = { ...a, detail: "68'" };
    const kept = keepIdentity([a], [same, moved]);
    expect(kept[0]).toBe(a);
    expect(kept[1]).toBe(moved);
  });
});

// MARK: - Notifier

describe("Notifier", () => {
  const minute = (m: number) => ({ seconds: m * 60, sampledAt: NOW, period: 2, direction: "up" as const, display: `${m}'`, running: false });

  it("says a game started, and how it ended", () => {
    const scheduled = game("1", "scheduled", NOW);
    const live = game("1", "live", NOW, ["0", "0"], { detail: "1'" });
    expect(notificationBody(scheduled, live, NOW)).toBe("Started");
    const final = game("1", "final", NOW, ["2", "1"], { detail: "FT" });
    expect(notificationBody(live, final, NOW)).toBe("Full time");
    // A final without scores is a postponement, not a result.
    expect(notificationBody(scheduled, game("1", "final", NOW, [null, null], { detail: "Postponed" }), NOW)).toBeNull();
  });

  it("says who scored: a goal by the minute, other sports by team and clock", () => {
    const before = game("1", "live", NOW, ["0", "0"], { clock: minute(22) });
    const after = game("1", "live", NOW, ["1", "0"], { clock: minute(23) });
    expect(notificationBody(before, after, NOW)).toBe("Goal · 23rd minute");
    const nfl = (scores: [string, string]) =>
      game("2", "live", NOW, scores, { ref: { kind: "espn", path: "football/nfl", id: "2", sport: "football" }, detail: "3:10 - 2nd" }, ["kc", "buf"]);
    expect(notificationBody(nfl(["7", "3"]), nfl(["7", "10"]), NOW)).toBe("BUF scored · 3:10 left in the 2nd");
  });

  it("calls a correction or a double change an update, and ignores the rest", () => {
    const a = game("1", "live", NOW, ["1", "0"], { detail: "60'" });
    expect(notificationBody(a, game("1", "live", NOW, ["0", "0"], { detail: "61'" }), NOW)).toBe("Score updated · 61st minute");
    expect(notificationBody(a, game("1", "live", NOW, ["2", "1"], { detail: "61'" }), NOW)).toBe("Score updated · 61st minute");
    expect(notificationBody(a, game("1", "live", NOW, ["1", "0"], { detail: "61'" }), NOW)).toBeNull();
  });

  it("titles an alert with the score line and tags it with the game", () => {
    const alert = alertFor(game("1", "scheduled", NOW), game("1", "live", NOW, ["0", "0"]), NOW);
    expect(alert).toEqual({ tag: "1", title: "Arsenal 0–0 Chelsea", body: "Started" });
  });

  it("alerts only for followed teams' games already seen", () => {
    const before = new Map([["1", game("1", "scheduled", NOW)]]);
    const next = [game("1", "live", NOW, ["0", "0"]), game("2", "live", NOW, ["0", "0"], {}, ["liv", "eve"])];
    const followed = (e: ScoreEvent) => e.content.kind === "match" && e.content.top.id === "ars";
    expect(pollAlerts(before, next, followed, NOW).map((a) => a.tag)).toEqual(["1"]);
    expect(pollAlerts(before, next, () => false, NOW)).toEqual([]);
  });
});

// MARK: - My Teams fallback

describe("My Teams falls back to a team's schedule", () => {
  const results = (events: ScoreEvent[]): Record<string, LeagueResult> => ({ "eng.1": { events, failed: false } });
  const next = (id: string, start: number, extra: Partial<ScoreEvent> = {}): NextGame => ({ event: game(id, "scheduled", start, [null, null], extra), league: "eng.league_cup" });

  it("shows the next game within three weeks when the scoreboards have none", () => {
    const p = prefs({ followed: follow("ars") });
    const games = new Map([["ars", [next("cup", NOW + 10 * DAY)]]]);
    const mine = myTeamsEvents(results([]), p, NOW, games);
    expect(mine.map((e) => e.id)).toEqual(["cup"]);
    // Out past three weeks: nothing.
    expect(myTeamsEvents(results([]), p, NOW, new Map([["ars", [next("far", NOW + 22 * DAY)]]]))).toEqual([]);
  });

  it("stands aside when the scoreboards already have the team's next game", () => {
    const p = prefs({ followed: follow("ars") });
    const games = new Map([["ars", [next("cup", NOW + 10 * DAY)]]]);
    const mine = myTeamsEvents(results([game("lg", "scheduled", NOW + 2 * DAY)]), p, NOW, games);
    expect(mine.map((e) => e.id)).toEqual(["lg"]);
  });

  it("steps past a game the scoreboard says has ended, though the schedule still calls it scheduled", () => {
    const p = prefs({ followed: follow("ars") });
    const games = new Map([["ars", [next("lg", NOW - 2 * HOUR), next("cup", NOW + 5 * DAY)]]]);
    const mine = myTeamsEvents(results([game("lg", "final", NOW - 2 * HOUR, ["2", "0"])]), p, NOW, games);
    expect(mine.map((e) => e.id)).toEqual(["cup", "lg"]);
  });

  it("captions a schedule game with its competition, else its league", () => {
    const p = prefs({ followed: follow("ars") });
    const withCaption = new Map([["ars", [next("cup", NOW + DAY, { caption: "Carabao Cup · Fourth Round" })]]]);
    expect(myTeamsEvents(results([]), p, NOW, withCaption)[0]!.caption).toBe("Carabao Cup · Fourth Round");
    const league = new Map([["ars", [{ event: game("x", "scheduled", NOW + DAY), league: "eng.1" }]]]);
    expect(myTeamsEvents(results([]), p, NOW, league)[0]!.caption).toBe("Premier League");
  });
});

// MARK: - The pinned game

describe("the pinned game", () => {
  const sections = (events: ScoreEvent[]) => [{ id: "eng.1", title: "Premier League", sport: "soccer" as const, events, failed: false, liveCount: events.length }];
  const live = (id: string, start: number, teams: [string, string]) => game(id, "live", NOW - start, ["0", "0"], {}, teams);

  it("leads the Live tier after your teams", () => {
    const events = [live("a", 3 * HOUR, ["liv", "eve"]), live("b", 2 * HOUR, ["new", "tot"]), live("c", HOUR, ["ars", "che"])];
    const order = (pinned: string | null, followed: FollowedTeam[] = []) =>
      board(sections(events), prefs({ followed }), () => "eng.1", undefined, pinned).tiers[0]!.events.map((e) => e.id);
    expect(order(null)).toEqual(["a", "b", "c"]);
    expect(order("c")).toEqual(["c", "a", "b"]);
    expect(order("c", follow("new"))).toEqual(["b", "c", "a"]);
  });

  it("is what the tab shows; else a followed live game; else a final for ten minutes", () => {
    const a = game("a", "live", NOW, ["1", "0"], { detail: "67'" });
    const b = game("b", "live", NOW, ["0", "0"], { detail: "12'" }, ["liv", "eve"]);
    const f = game("f", "final", NOW - 2 * HOUR, ["2", "2"], { detail: "FT" }, ["new", "tot"]);
    const followed = (ids: string[]) => (e: ScoreEvent) => e.content.kind === "match" && ids.includes(e.content.top.id ?? "");
    const context = { pinnedID: null, isFollowed: followed(["liv"]), recentFinals: new Map<string, number>(), scoreInTitle: true, now: NOW };
    expect(tabEvent([a, b, f], context)?.id).toBe("b");
    expect(tabEvent([a, b, f], { ...context, pinnedID: "a" })?.id).toBe("a");
    expect(tabEvent([a, b, f], { ...context, scoreInTitle: false })).toBeNull();
    expect(tabEvent([a, b, f], { ...context, pinnedID: "a", scoreInTitle: false })?.id).toBe("a");
    const finals = { ...context, isFollowed: followed(["new"]), recentFinals: new Map([["f", NOW - 5 * 60_000]]) };
    expect(tabEvent([a, b, f], finals)?.id).toBe("f");
    expect(tabEvent([a, b, f], { ...finals, now: NOW + 6 * 60_000 })).toBeNull();
  });

  it("lets go four hours after its game, once it's over", () => {
    expect(pinExpired(game("a", "final", NOW - 5 * HOUR, ["1", "0"]), NOW)).toBe(true);
    expect(pinExpired(game("a", "final", NOW - 3 * HOUR, ["1", "0"]), NOW)).toBe(false);
    expect(pinExpired(game("a", "live", NOW - 5 * HOUR, ["1", "0"]), NOW)).toBe(false);
  });
});

// MARK: - The tab

describe("the tab's title and favicon", () => {
  it("reads like the menu bar item", () => {
    expect(tabTitle(game("a", "live", NOW, ["2", "1"], { detail: "67'" }))).toBe("ARS 2–1 CHE · 67'");
    expect(tabTitle(game("a", "live", NOW, ["7", "3"], { detail: "3:10 - 2nd" }))).toBe("ARS 7–3 CHE · 3:10 2nd");
    expect(tabTitle(game("a", "final", NOW, ["2", "1"]))).toBe("ARS 2–1 CHE · Final");
    expect(tabTitle(game("a", "scheduled", Date.parse("2026-10-27T19:00:00Z")))).toBe("ARS v CHE · 3:00 PM");
  });

  it("draws one line when it reads at 16px, else the scores stacked", () => {
    expect(faviconScore(game("a", "live", NOW, ["2", "1"]))).toEqual({ lines: ["2–1"], live: true });
    expect(faviconScore(game("a", "live", NOW, ["10", "7"]))).toEqual({ lines: ["10–7"], live: true });
    expect(faviconScore(game("a", "final", NOW, ["24", "17"]))).toEqual({ lines: ["24", "17"], live: false });
    expect(faviconScore(game("a", "live", NOW, ["148", "150"]))!.lines).toEqual(["148", "150"]);
    expect(faviconScore(game("a", "scheduled", NOW))).toBeNull();
  });

  it("leads the page's title with the score, unless the page is that game", () => {
    const live = { text: "ARS 2–1 CHE · 67'", line: "ARS 2–1 CHE" };
    expect(composeTitle("Settings", live)).toBe("ARS 2–1 CHE · 67' · Settings");
    expect(composeTitle(null, live)).toBe("ARS 2–1 CHE · 67' · Scoreline");
    expect(composeTitle("ARS 2–1 CHE (67')", live)).toBe("ARS 2–1 CHE (67') · Scoreline");
    expect(composeTitle("Settings", null)).toBe("Settings · Scoreline");
    expect(composeTitle(null, null)).toBe("Scoreline");
  });
});

// MARK: - Polling a hidden tab

describe("polling a hidden tab", () => {
  it("follows only the games the tab or alerts need", () => {
    const r = (events: ScoreEvent[]): Record<string, LeagueResult> => ({ "eng.1": { events, failed: false } });
    const mine = (e: ScoreEvent) => e.id === "m";
    expect(backgroundInterval(r([game("x", "live", NOW, ["0", "0"])]), mine, NOW)).toBe(300);
    expect(backgroundInterval(r([game("m", "live", NOW, ["0", "0"])]), mine, NOW)).toBe(30);
    expect(backgroundInterval(r([game("m", "scheduled", NOW + 10 * 60_000)]), mine, NOW)).toBe(60);
  });
});

// MARK: - Keys and scroll memory

describe("keyboard commands", () => {
  const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, repeat: false, defaultPrevented: false, ...extra });
  it("map bare keys, and stand aside for modifiers and typing", () => {
    expect(commandFor(key("r"), false)).toBe("refresh");
    expect(commandFor(key(","), false)).toBe("settings");
    expect(commandFor(key("s"), false)).toBe("schedule");
    expect(commandFor(key("r", { metaKey: true }), false)).toBeNull();
    expect(commandFor(key("r"), true)).toBeNull();
    expect(commandFor(key("x"), false)).toBeNull();
  });
});

describe("the detail pane's scroll memory", () => {
  const memory = { entry: new Map([["k1", 420]]), page: new Map([["/schedule/nfl?mode=results", 300]]) };
  it("starts fresh visits at the top and lands Back where it was", () => {
    expect(landingOffset("PUSH", { pathname: "/" }, { pathname: "/settings", search: "", key: "k9" }, memory)).toBe(0);
    expect(landingOffset("POP", { pathname: "/settings" }, { pathname: "/schedule", search: "", key: "k1" }, memory)).toBe(420);
  });
  it("keeps each way of a page its own place, and starts a new scope at the top", () => {
    expect(landingOffset("REPLACE", { pathname: "/schedule/nfl" }, { pathname: "/schedule/nfl", search: "?mode=results", key: "k2" }, memory)).toBe(300);
    expect(landingOffset("REPLACE", { pathname: "/schedule" }, { pathname: "/schedule/nfl", search: "?mode=results", key: "k3" }, memory)).toBe(0);
  });
});

// MARK: - The race, the pick list, quiet leagues

describe("the CS2 race", () => {
  const live = (top: number, bottom: number, round: number | null = null) => ({ mapName: "Mirage", mapNumber: 1, round, topScore: top, bottomScore: bottom, topSide: null, bottomSide: null, mapEnded: false });
  it("races to 13, then to 4 in each overtime block", () => {
    expect(raceOf(live(5, 8, 14))).toEqual({ cells: 13, top: 5, bottom: 8, label: "Round 14" });
    expect(raceOf(live(12, 12))).toEqual({ cells: 4, top: 0, bottom: 0, label: "Overtime" });
    expect(raceOf(live(15, 14))).toEqual({ cells: 4, top: 3, bottom: 2, label: "Overtime" });
    expect(raceOf(live(16, 15))).toEqual({ cells: 4, top: 1, bottom: 0, label: "Overtime 2" });
  });
});

describe("the pick list's outline", () => {
  const team = (id: string, group: string | null = null): TeamOption => ({ id, name: id, logo: null, flag: null, group });
  const college = Array.from({ length: 30 }, (_, i) => team(`t${String(i).padStart(2, "0")}`, i < 15 ? "SEC" : "Big Ten"));

  it("groups a long list by conference, with the picks as of opening first", () => {
    const sections = pickSections(college, "", new Set(["t20"]), "Teams");
    expect(sections.map((s) => [s.id, s.kind])).toEqual([["selected", "plain"], ["conf:SEC", "disclosure"], ["conf:Big Ten", "disclosure"]]);
  });

  it("caps a long flat list, lists a short one whole, and searches flat", () => {
    const flat = Array.from({ length: 30 }, (_, i) => team(`c${i}`));
    expect(pickSections(flat, "", new Set(), "Countries").map((s) => [s.title, s.kind])).toEqual([["Countries", "capped"]]);
    expect(pickSections(flat.slice(0, 20), "", new Set(["c1"]), "Teams").map((s) => [s.title, s.kind])).toEqual([["Selected", "plain"], ["All Teams", "plain"]]);
    expect(pickSections(college, "t2", new Set(), "Teams")[0]!.options.map((o) => o.id)).toEqual(["t20", "t21", "t22", "t23", "t24", "t25", "t26", "t27", "t28", "t29"]);
    expect(pickSections(college, "zzz", new Set(), "Teams")).toEqual([]);
  });

  it("gives the arrow keys headers, open rows and Show All", () => {
    const sections = pickSections(college, "", new Set(), "Teams");
    const keys = stops(pickOutline(sections), new Set(["conf:SEC"])).map(stopKey);
    expect(keys[0]).toBe("h|conf:SEC");
    expect(keys[1]).toBe("r|conf:SEC|t00");
    expect(keys.at(-1)).toBe("h|conf:Big Ten");
  });
});

describe("a quiet league's next game day", () => {
  it("is the next game day from the day after tomorrow, or a weekly league's next week", () => {
    const daily = parseCalendar(fixture("sched-eng1-undated.json"));
    const now = Date.parse("2026-10-27T18:00:00Z");
    const next = nextDayAfterWindow(daily, false, now);
    expect(next).not.toBeNull();
    expect(Date.UTC(next!.year, next!.month - 1, next!.day)).toBeGreaterThanOrEqual(Date.UTC(2026, 9, 29));
    const weekly = parseCalendar(fixture("sched-nfl-undated.json"));
    const week = nextDayAfterWindow(weekly, true, now);
    expect(week).not.toBeNull();
  });
});
