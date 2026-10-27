import { describe, expect, it } from "vitest";
import { BaseballFeed, baseballMoment, baseballSituation, normalized, playIDFromRef, theaterAfter, walkOff, type TheaterLike } from "../../src/data/liveFeeds/baseball";
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
