import { describe, expect, it } from "vitest";
import type { Competitor, LeagueResult, ScoreEvent } from "../../src/data/models";
import {
  board,
  computeSections,
  filtered,
  liveCount,
  mergePoll,
  myTeamsEvents,
  planTiles,
  pollInterval,
  quietLeagues,
  retryDelay,
  scorers,
  visible,
  type ListPreferences,
} from "../../src/data/scoreboard";
import { leagueWithID } from "../../src/data/leagues";

const NOW = Date.parse("2026-10-27T18:00:00Z");
const HOUR = 3_600_000;

function team(id: string, extra: Partial<Competitor> = {}): Competitor {
  return { id, name: id.toUpperCase(), abbreviation: id.slice(0, 3).toUpperCase(), score: null, logo: null, isWinner: false, color: null, rank: null, record: null, conferenceRecord: null, alternateColor: null, ...extra };
}

function game(id: string, state: ScoreEvent["state"], start: number, top = "a", bottom = "b", extra: Partial<ScoreEvent> = {}): ScoreEvent {
  const scored = state !== "scheduled";
  return {
    id,
    content: { kind: "match", top: team(top, { score: scored ? "1" : null }), bottom: team(bottom, { score: scored ? "0" : null }) },
    state,
    start,
    detail: null,
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

const ok = (events: ScoreEvent[]): LeagueResult => ({ events, failed: false });

describe("the visibility window", () => {
  it("keeps live games, finals from the last 18 hours and games from 6 hours ago to 36 ahead", () => {
    const events = [
      game("live", "live", NOW - HOUR),
      game("recent-final", "final", NOW - 17 * HOUR),
      game("old-final", "final", NOW - 19 * HOUR),
      game("soon", "scheduled", NOW + 35 * HOUR),
      game("far", "scheduled", NOW + 37 * HOUR),
    ];
    expect(visible(events, NOW, true).map((e) => e.id)).toEqual(["live", "soon", "recent-final"]);
    expect(visible(events, NOW, false).map((e) => e.id)).toEqual(["live", "soon"]);
  });

  it("shows the next fixture (and any at the same time) when nothing is in the window", () => {
    const events = [game("next-1", "scheduled", NOW + 3 * 24 * HOUR), game("next-2", "scheduled", NOW + 3 * 24 * HOUR), game("later", "scheduled", NOW + 4 * 24 * HOUR)];
    expect(visible(events, NOW, true).map((e) => e.id)).toEqual(["next-1", "next-2"]);
  });

  it("caps each side of now at three, newest finals first, after every live game", () => {
    const events = [
      ...[1, 2, 3, 4].map((i) => game(`f${i}`, "final", NOW - i * HOUR)),
      ...[1, 2, 3, 4].map((i) => game(`s${i}`, "scheduled", NOW + i * HOUR)),
      ...[1, 2, 3, 4, 5].map((i) => game(`l${i}`, "live", NOW - i * 60_000)),
    ];
    const ids = visible(events, NOW, true).map((e) => e.id);
    expect(ids.slice(0, 5)).toEqual(["l5", "l4", "l3", "l2", "l1"]);
    expect(ids.slice(5)).toEqual(["s1", "s2", "s3", "f1", "f2", "f3"]);
  });
});

describe("filters", () => {
  it("limits a league to its picked teams when the filter is on, and keeps picks when it's off", () => {
    const league = leagueWithID("eng.1")!;
    const events = [game("mine", "live", NOW, "ars", "che"), game("other", "live", NOW, "liv", "mci")];
    const on = prefs({ teamFilters: { "eng.1": ["ars"] }, filteredLeagues: ["eng.1"] });
    expect(filtered(events, league, on).map((e) => e.id)).toEqual(["mine"]);
    expect(filtered(events, league, { ...on, filteredLeagues: [] })).toHaveLength(2);
  });

  it("shows college Top 25 games plus followed teams", () => {
    const league = leagueWithID("college-football")!;
    const events = [
      game("ranked", "scheduled", NOW, "a", "b", { content: { kind: "match", top: team("a", { rank: 5 }), bottom: team("b") } }),
      game("followed", "scheduled", NOW, "c", "d"),
      game("neither", "scheduled", NOW, "e", "f"),
    ];
    const p = prefs({ followed: [{ id: "d", name: "D", logo: null }] });
    expect(filtered(events, league, p).map((e) => e.id)).toEqual(["ranked", "followed"]);
    expect(filtered(events, league, { ...p, collegeTop25Only: false })).toHaveLength(3);
  });

  it("filters climbing rounds by discipline, never by country", () => {
    const league = leagueWithID("ifsc")!;
    const round = (id: string, category: string) =>
      game(id, "live", NOW, "x", "y", {
        content: { kind: "field", title: category, summary: "" },
        ref: { kind: "climbing", eventID: 1, category, resultURL: null, round: null, eventName: "", nextURL: null },
      });
    const events = [round("lead", "Lead Men"), round("speed", "Speed Women"), round("combined", "Boulder & Lead Women")];
    const p = prefs({ climbingDisciplines: ["lead"], filteredLeagues: ["ifsc"], teamFilters: { ifsc: ["country-SLO"] } });
    expect(filtered(events, league, p).map((e) => e.id)).toEqual(["lead", "combined"]);
  });
});

describe("sections", () => {
  it("lists leagues in the user's order with My Teams first, without repeating its games", () => {
    const results = {
      nfl: ok([game("nfl-1", "scheduled", NOW + HOUR, "kc", "buf")]),
      "eng.1": ok([game("epl-1", "live", NOW, "ars", "che"), game("epl-2", "final", NOW - HOUR, "liv", "mci")]),
    };
    const p = prefs({ enabledLeagues: ["nfl", "eng.1"], followed: [{ id: "ars", name: "Arsenal", logo: null }] });
    const sections = computeSections(results, p, NOW);
    expect(sections.map((s) => s.id)).toEqual(["my-teams", "nfl", "eng.1"]);
    expect(sections[0]!.events.map((e) => e.id)).toEqual(["epl-1"]);
    // My Teams says which league a game is from.
    expect(sections[0]!.events[0]!.caption).toBe("Premier League");
    expect(sections[2]!.events.map((e) => e.id)).toEqual(["epl-2"]);
  });

  it("floats leagues with live games up when Live First is on", () => {
    const results = { nfl: ok([game("n", "scheduled", NOW + HOUR)]), "eng.1": ok([game("e", "live", NOW)]) };
    const p = prefs({ enabledLeagues: ["nfl", "eng.1"], liveFirst: true });
    expect(computeSections(results, p, NOW).map((s) => s.id)).toEqual(["eng.1", "nfl"]);
  });

  it("keeps a failed league with an error, and names quiet ones for the footnotes", () => {
    const results = { nfl: { events: [], failed: true }, "eng.1": ok([game("far", "final", NOW - 48 * HOUR)]) };
    const sections = computeSections(results, prefs(), NOW);
    expect(sections.map((s) => [s.id, s.failed])).toEqual([["nfl", true]]);
    expect(quietLeagues(results, prefs(), NOW).map((l) => l.id)).toEqual(["eng.1"]);
  });

  it("gives each followed team its live game, last result and next fixture", () => {
    const results = {
      "eng.1": ok([
        game("yesterday", "final", NOW - 20 * HOUR, "ars", "che"),
        game("last-week", "final", NOW - 6 * 24 * HOUR, "ars", "tot"),
        game("next", "scheduled", NOW + 3 * 24 * HOUR, "liv", "ars"),
        game("later", "scheduled", NOW + 10 * 24 * HOUR, "ars", "new"),
      ]),
    };
    const p = prefs({ followed: [{ id: "ars", name: "Arsenal", logo: null }] });
    expect(myTeamsEvents(results, p, NOW).map((e) => e.id)).toEqual(["next", "yesterday"]);
  });
});

describe("live count and polling", () => {
  it("counts live games the user would see (filtered, plus followed teams)", () => {
    const results = { "eng.1": ok([game("picked", "live", NOW, "ars", "che"), game("hidden", "live", NOW, "liv", "mci"), game("followed", "live", NOW, "new", "bha")]) };
    const p = prefs({ teamFilters: { "eng.1": ["ars"] }, filteredLeagues: ["eng.1"], followed: [{ id: "new", name: "Newcastle", logo: null }] });
    expect(liveCount(results, p)).toBe(2);
  });

  it("polls every 30s while live, 60s before a start, else every 5 minutes; failures retry sooner", () => {
    expect(pollInterval({ "eng.1": ok([game("l", "live", NOW)]) }, prefs(), NOW)).toBe(30);
    expect(pollInterval({ "eng.1": ok([game("s", "scheduled", NOW + 10 * 60_000)]) }, prefs(), NOW)).toBe(60);
    expect(pollInterval({ "eng.1": ok([game("late", "scheduled", NOW - 2 * HOUR)]) }, prefs(), NOW)).toBe(300);
    expect([1, 2, 3, 4, 9].map(retryDelay)).toEqual([5, 15, 30, 60, 60]);
  });
});

describe("between polls", () => {
  it("marks a countdown clock running when it moved, and keeps an unchanged game identical", () => {
    const clock = { seconds: 200, sampledAt: NOW, period: 2, direction: "down" as const, display: "3:20 - 2nd", running: false };
    const before = game("g", "live", NOW, "a", "b", { clock });
    const moved = mergePoll([before], [game("g", "live", NOW, "a", "b", { clock: { ...clock, seconds: 190, display: "3:10 - 2nd", sampledAt: NOW + 30_000 } })]);
    expect(moved[0]!.clock?.running).toBe(true);
    const same = mergePoll([before], [game("g", "live", NOW, "a", "b", { clock: { ...clock, sampledAt: NOW + 30_000 } })]);
    expect(same[0]).toBe(before);
  });

  it("keeps the NBA's last line worth reading over a routine play", () => {
    const before = game("g", "live", NOW, "a", "b", { liveLine: "L. Ball makes three", liveLineRoutine: false });
    const after = mergePoll([before], [game("g", "live", NOW, "a", "b", { liveLine: "B. Miller defensive rebound", liveLineRoutine: true })]);
    expect(after[0]!.liveLine).toBe("L. Ball makes three");
  });

  it("names who scored, and nobody on a correction", () => {
    const before = game("g", "live", NOW, "a", "b");
    const up = game("g", "live", NOW, "a", "b", { content: { kind: "match", top: team("a", { score: "1" }), bottom: team("b", { score: "1" }) } });
    expect([...scorers(before, up)]).toEqual(["b"]);
    expect([...scorers(up, before)]).toEqual([]);
  });
});

describe("the tile board", () => {
  it("regroups the list's games into Live, Your Teams, Up Next and Final", () => {
    const results = {
      nfl: ok([game("n-live", "live", NOW, "kc", "buf"), game("n-next", "scheduled", NOW + HOUR, "dal", "phi")]),
      "eng.1": ok([game("e-live", "live", NOW - HOUR, "ars", "che"), game("e-final", "final", NOW - 2 * HOUR, "liv", "mci"), game("e-mine", "scheduled", NOW + 2 * HOUR, "new", "bha")]),
    };
    const p = prefs({ enabledLeagues: ["nfl", "eng.1"], followed: [{ id: "che", name: "Chelsea", logo: null }, { id: "new", name: "Newcastle", logo: null }] });
    const sections = computeSections(results, p, NOW);
    const leagueOf = (id: string) => (id.startsWith("n-") ? "nfl" : "eng.1");
    const b = board(sections, p, leagueOf);
    expect(b.tiers.map((t) => [t.kind, t.events.map((e) => e.id)])).toEqual([
      ["live", ["e-live", "n-live"]],
      ["mine", ["e-mine"]],
      ["next", ["n-next"]],
      ["final", ["e-final"]],
    ]);
    expect(b.league.get("n-next")?.id).toBe("nfl");
  });

  it("makes live tiles large up to the budget, else the next game within a day", () => {
    const live = Array.from({ length: 6 }, (_, i) => game(`l${i}`, "live", NOW));
    const withLive = planTiles({ tiers: [{ kind: "live", events: live }], league: new Map() }, 1, NOW);
    expect(withLive[0]!.tiles.map((t) => t.size)).toEqual(["large", "large", "large", "large", "small", "small"]);
    const quiet = planTiles({ tiers: [{ kind: "next", events: [game("a", "scheduled", NOW + HOUR), game("b", "scheduled", NOW + 2 * HOUR)] }], league: new Map() }, 2, NOW);
    expect(quiet[0]!.tiles.map((t) => [t.event.id, t.size])).toEqual([
      ["a", "large"],
      ["b", "small"],
    ]);
    expect(quiet[0]!.heroFirst).toBe(true);
  });
});
