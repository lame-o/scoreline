import { describe, expect, it } from "vitest";
import type { Baseball } from "../../src/data/gameDetail";
import { BaseballFeed, baseballMoment, baseballSituation, normalized, playIDFromRef, settledSituation, theaterAfter, walkOff, type TheaterLike } from "../../src/data/liveFeeds/baseball";
import { Tier } from "../../src/data/moments";
import { fixture } from "./fixtures";

interface CorePlays {
  count: number;
  pages: { page: number; pageCount: number; items: { id: string; type: { type: string }; team?: { $ref?: string } }[] }[];
}

const core = fixture("espn-mlb-core-plays.json") as CorePlays;
const side = (id: string | null | undefined) => (id === "8" ? ("top" as const) : id === "30" ? ("bottom" as const) : null);
const names = { "4917865": "A. Uribe" };

/** The core API, live: a situation mid-at-bat, the status, and the plays' last two pages. */
function lane(lastPlay: string) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    if (url.endsWith("/situation"))
      return {
        lastPlay: { $ref: `http://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/events/1/competitions/1/plays/${lastPlay}?lang=en` },
        balls: 2,
        strikes: 1,
        outs: 1,
        onFirst: { playerId: 4917865 },
        batter: { playerId: 4917865 },
        pitcher: { playerId: 99 },
      };
    if (url.endsWith("/status")) return { type: { state: "in", shortDetail: "Bot 7th" } };
    if (url.includes("plays?limit=1")) return { count: core.count };
    const page = Number(/page=(\d+)/.exec(url)?.[1]);
    const found = core.pages.find((p) => p.page === page);
    if (!found) return { items: [], pageCount: core.pages.at(-1)!.pageCount };
    return { items: found.items, pageCount: core.pages.at(-1)!.page };
  };
  return { fetcher, calls };
}

describe("the baseball fast lane", () => {
  const newest = core.pages.at(-1)!.items.at(-1)!.id;

  it("starts two pages from the end, reads the count, runners and inning", async () => {
    const { fetcher, calls } = lane(newest);
    const feed = new BaseballFeed();
    let renders = 0;
    feed.subscribe(() => renders++);
    await feed.update(fetcher, { path: "baseball/mlb", eventID: "1", names, side });
    expect(feed.loaded).toBe(true);
    expect(feed.inning).toBe("Bot 7th");
    expect(feed.situation).toMatchObject({ balls: 2, strikes: 1, outs: 1, onFirst: true, onSecond: false, batter: "A. Uribe", batterID: "4917865", pitcherID: "99" });
    expect(feed.situation?.runners[0]).toBe("A. Uribe");
    expect(calls.some((c) => c.includes("plays?limit=1"))).toBe(true);
    const pages = calls.filter((c) => /page=\d+/.test(c)).map((c) => Number(/page=(\d+)/.exec(c)![1]));
    expect(Math.min(...pages)).toBe(core.pages[0]!.page);
    expect(renders).toBe(1);
    // History, not news: the first complete look offers no moments.
    expect(feed.takeMoments()).toEqual([]);
  });

  it("asks for plays again only when the last play changed", async () => {
    const { fetcher, calls } = lane(newest);
    const feed = new BaseballFeed();
    await feed.update(fetcher, { path: "baseball/mlb", eventID: "1", names, side });
    const before = calls.length;
    await feed.update(fetcher, { path: "baseball/mlb", eventID: "1", names, side });
    // Just the situation and the status.
    expect(calls.length - before).toBe(2);
  });

  it("hands the theater its plays and keeps a play's news while it shows", async () => {
    const { fetcher } = lane(newest);
    const theaterOf = (plays: readonly unknown[]): TheaterLike => {
      const last = plays.findLast((p) => (p as { type: { type: string } }).type.type === "play-result") as { id: string } | undefined;
      return { play: last ? { id: last.id, wallclock: null } : null, news: false };
    };
    const feed = new BaseballFeed(theaterOf);
    await feed.update(fetcher, { path: "baseball/mlb", eventID: "1", names, side });
    expect(feed.theater?.play).not.toBeNull();
    expect(feed.theater?.news).toBe(false);
  });
});

describe("the theater's news", () => {
  const theaterOf = (id: string, wallclock: number | null) => () => ({ play: { id, wallclock }, news: false });
  it("is news after the first complete look, or when it only just happened", () => {
    expect(theaterAfter([], null, true, 0, {}, side, theaterOf("a", null)).news).toBe(true);
    expect(theaterAfter([], null, false, 100_000, {}, side, theaterOf("a", 80_000)).news).toBe(true);
    expect(theaterAfter([], null, false, 200_000, {}, side, theaterOf("a", 80_000)).news).toBe(false);
  });
  it("keeps what a play already showing was", () => {
    const previous = { play: { id: "a", wallclock: null }, news: true };
    expect(theaterAfter([], previous, false, 0, {}, side, theaterOf("a", null)).news).toBe(true);
  });
});

describe("at-bat results as moments", () => {
  const result = (alt: string, extra: Record<string, unknown> = {}) => ({ id: alt, type: { type: "play-result" }, alternativeType: { type: alt }, text: alt, team: { id: "8" }, ...extra });

  it("reads the structured result, never the text", () => {
    expect(baseballMoment(result("single"), side)).toMatchObject({ kind: "hit", lead: "Single", tier: Tier.swing, side: "top", chart: "plate" });
    expect(baseballMoment(result("strike-swinging"), side)).toMatchObject({ kind: "strikeout", lead: "Strikeout" });
    expect(baseballMoment(result("ball-four"), side)).toMatchObject({ kind: "walk", lead: "Walk" });
    expect(baseballMoment(result("hit-by-pitch"), side)).toMatchObject({ kind: "walk", lead: "Hit by pitch" });
    expect(baseballMoment(result("fly-out"), side)).toMatchObject({ kind: "outInPlay", tier: Tier.routine });
    expect(baseballMoment(result("ground-out", { doublePlay: true }), side)).toMatchObject({ kind: "doublePlay" });
    expect(baseballMoment({ id: "x", type: { type: "pitch" } }, side)).toBeNull();
  });

  it("scores: home runs, grand slams, runs, walk-offs, and the triple's accent", () => {
    expect(baseballMoment(result("home-run", { scoringPlay: true, scoreValue: 1 }), side)).toMatchObject({ kind: "homeRun", lead: "Home run", tier: Tier.score });
    const slam = baseballMoment(result("home-run", { scoringPlay: true, scoreValue: 4 }), side)!;
    expect(slam.lead).toBe("Grand slam");
    expect(slam.accents.has("grandSlam")).toBe(true);
    expect(baseballMoment(result("double", { scoringPlay: true, scoreValue: 2 }), side)).toMatchObject({ kind: "runScored", lead: "2 runs score" });
    const triple = baseballMoment(result("triple"), side)!;
    expect(triple.accents.has("triple")).toBe(true);
    const off = baseballMoment(result("single", { scoringPlay: true, scoreValue: 1, period: { type: "Bottom", number: 9 }, homeScore: 4, awayScore: 3 }), side)!;
    expect(off.lead).toBe("Walk-off");
    expect(off.accents.has("decisive")).toBe(true);
  });

  it("calls a walk-off only when the home team goes ahead in the 9th or later", () => {
    expect(walkOff({ period: { type: "Bottom", number: 9 }, homeScore: 4, awayScore: 3, scoreValue: 1 })).toBe(true);
    expect(walkOff({ period: { type: "Bottom", number: 9 }, homeScore: 5, awayScore: 3, scoreValue: 1 })).toBe(false);
    expect(walkOff({ period: { type: "Top", number: 10 }, homeScore: 4, awayScore: 3, scoreValue: 1 })).toBe(false);
    expect(walkOff({ period: { type: "Bottom", number: 8 }, homeScore: 4, awayScore: 3, scoreValue: 1 })).toBe(false);
  });
});

describe("pieces", () => {
  it("reads a play's ID from its link and a core play's team", () => {
    expect(playIDFromRef("http://x/plays/4019080441799990058?lang=en")).toBe("4019080441799990058");
    expect(normalized({ id: "1", team: { $ref: "http://x/teams/8?lang=en" } })).toMatchObject({ team: { id: "8" } });
  });

  it("clamps the count and needs outs or balls", () => {
    expect(baseballSituation({ balls: 4, strikes: 3, outs: 3 }, {}, null)).toMatchObject({ balls: 3, strikes: 2, outs: 3 });
    expect(baseballSituation({ lastPlay: {} }, {}, null)).toBeNull();
  });
});

/**
 * At the Plate after the third out (the live check, Game 4: 0 outs with the old
 * batter for about 25 s, and once no batter at all), on Game 4's own entries:
 * Turang grounds out to end the top of the 1st; then "Middle of the 1st", the
 * bottom's start, and "Dustin May pitches to Yandy Diaz".
 */
describe("At the Plate between halves", () => {
  const g4 = fixture("ws-g4-plays.json") as { items: unknown[]; names: Record<string, string> };
  const third = g4.items.findIndex((p) => (p as { id?: string }).id === "4019080450005990057");
  const upTo = (n: number) => g4.items.slice(0, third + 1 + n);
  const espn = (over: Partial<Baseball>): Baseball => ({
    balls: 0,
    strikes: 0,
    outs: 0,
    onFirst: false,
    onSecond: false,
    onThird: false,
    batter: "B. Turang",
    pitcher: "G. Jax",
    lastPlay: "Turang grounded out to shortstop.",
    runners: [null, null, null],
    batterID: "41179",
    pitcherID: "42604",
    runnerIDs: [null, null, null],
    ...over,
  });

  it("the half as it ended until the next half's batter: 3 outs, the count and bases cleared, the last matchup", () => {
    // ESPN's situation: outs reset to 0, still naming Turang (runners left on first and third).
    for (const n of [0, 1, 2, 3]) {
      const s = settledSituation(espn({ onFirst: true, onThird: true, balls: 1 }), upTo(n), g4.names)!;
      expect(s).toMatchObject({ outs: 3, balls: 0, strikes: 0, onFirst: false, onThird: false, batter: "B. Turang", pitcher: "G. Jax" });
    }
    // …and when it names nobody, the batter's row stays.
    expect(settledSituation(espn({ batter: null, batterID: null, pitcher: null, pitcherID: null }), upTo(2), g4.names)).toMatchObject({ outs: 3, batter: "B. Turang", batterID: "41179", pitcher: "G. Jax" });
  });
  it("the break as ESPN has it once it names the next half's batter", () => {
    const next = espn({ batter: "Y. Diaz", batterID: "33481", pitcher: "D. May", pitcherID: "40937" });
    expect(settledSituation(next, upTo(2), g4.names)).toBe(next);
  });
  it("a situation still naming the batter the plays have retired takes the at-bat under way; a name the box score lacks comes from its words", () => {
    // Bottom of the 1st under way in the plays; ESPN's situation still on Turang.
    const s = settledSituation(espn({}), upTo(4), g4.names)!;
    expect(s).toMatchObject({ outs: 0, batter: "Y. Diaz", batterID: "33481", pitcher: "D. May", pitcherID: "40937" });
    const unnamed = { ...g4.names };
    delete unnamed["33481"];
    expect(settledSituation(espn({}), upTo(4), unnamed)).toMatchObject({ batter: "Yandy Diaz", batterID: "33481" });
    expect(settledSituation(espn({ batter: null, batterID: "33481", pitcher: "D. May", pitcherID: "40937" }), upTo(4), unnamed)?.batter).toBe("Yandy Diaz");
    // An at-bat the situation already has: unchanged.
    const current = espn({ batter: "Y. Diaz", batterID: "33481", pitcher: "D. May", pitcherID: "40937" });
    expect(settledSituation(current, upTo(4), g4.names)).toBe(current);
  });
});

/** ESPN's rewrites on the lane itself (the live check: a challenged pitch replaced under a new ID stayed in This At-Bat). */
describe("the lane reads ESPN's rewrites again", () => {
  const pitch = (id: string, type: string, n: number) => ({
    id,
    type: { type },
    atBatId: "4019080450605",
    summaryType: "P",
    text: `Pitch ${n} : ${type}`,
    pitchCoordinate: { x: 110 + n, y: 170 },
    period: { type: "Top", number: 6 },
    team: { $ref: "http://x/teams/30?lang=en" },
    participants: [{ type: "batter", athlete: { $ref: "/athletes/1" } }],
  });
  const start = { id: "s", type: { type: "start-batterpitcher" }, atBatId: "4019080450605", text: "A pitches to B", period: { type: "Top", number: 6 } };
  function feed(pages: () => unknown[]) {
    let last = "";
    const fetcher = async (url: string) => {
      const items = pages();
      if (url.endsWith("/situation")) return { lastPlay: { $ref: `http://x/plays/${last}` }, balls: 1, strikes: 1, outs: 1 };
      if (url.endsWith("/status")) return { type: { state: "in", shortDetail: "Top 6th" } };
      if (url.includes("plays?limit=1")) return { count: items.length };
      last = (items.at(-1) as { id: string }).id;
      return { items, pageCount: 1 };
    };
    return fetcher;
  }

  it("a pitch replaced by a new ID leaves This At-Bat; a result rewritten is taken back", async () => {
    let items: unknown[] = [start, pitch("4019080450605030090", "ball---confirmed", 1)];
    let now = 0;
    const lane = new BaseballFeed(null, () => now);
    const fetcher = feed(() => items);
    await lane.update(fetcher, { path: "baseball/mlb", eventID: "1", names: {}, side });
    expect(lane.atBat.map((p) => p.id)).toEqual(["4019080450605030090"]);
    // ESPN replaces it, ball confirmed → strike overturned, under a new ID; a quiet look 20 s on reads the at-bat again.
    items = [start, pitch("4019080450605030091", "strike-looking---overturned", 1)];
    now = 21_000;
    await lane.update(fetcher, { path: "baseball/mlb", eventID: "1", names: {}, side });
    expect(lane.atBat.map((p) => p.id)).toEqual(["4019080450605030091"]);
    expect(lane.takeRetractions()).toEqual(["4019080450605030090"]);
  });

  it("the look that catches up after the tab was hidden (FeedLooks) is history for the theater, as the first is; the next look's result is news", async () => {
    const result = (id: string, n: number) => ({ id, type: { type: "play-result" }, atBatId: `40190804506${n}`, text: `Result ${n}`, period: { type: "Top", number: 6 }, team: { $ref: "http://x/teams/30?lang=en" } });
    const theaterOf = (plays: readonly unknown[]): TheaterLike => {
      const last = plays.findLast((p) => (p as { type: { type: string } }).type.type === "play-result") as { id: string } | undefined;
      return { play: last ? { id: last.id, wallclock: null } : null, news: false };
    };
    let items: unknown[] = [start, pitch("4019080450605030090", "ball---confirmed", 1)];
    let now = 0;
    const lane = new BaseballFeed(theaterOf, () => now);
    const fetcher = feed(() => items);
    const look = async (at: number, next: unknown) => {
      items = [...items, next];
      now = at;
      await lane.update(fetcher, { path: "baseball/mlb", eventID: "1", names: {}, side });
      return lane.theater;
    };
    await lane.update(fetcher, { path: "baseball/mlb", eventID: "1", names: {}, side });
    expect(await look(5_000, result("1001", 1))).toMatchObject({ play: { id: "1001" }, news: true });
    expect(await look(125_000, result("1002", 2))).toMatchObject({ play: { id: "1002" }, news: false });
    expect(lane.following).toBe(false);
    expect(await look(130_000, result("1003", 3))).toMatchObject({ play: { id: "1003" }, news: true });
    expect(lane.following).toBe(true);
  });
});

