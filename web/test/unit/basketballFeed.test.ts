/**
 * The NBA fast lane (data/liveFeeds/basketball.ts, BasketballFeed.swift)
 * against the core API's last 160 plays of a recorded overtime game: the
 * first look is history, later plays are moments, edits are reconciled, and
 * the live state (possession, clutch, runs, streaks) comes from the window.
 */
import { describe, expect, it } from "vitest";
import { activeRun, andOne, BasketballFeed, makes, momentAt, normalized, reconcile, scoringRun, type Teams } from "../../src/data/liveFeeds/basketball";
import { Tier } from "../../src/data/moments";
import { BasketballTheaterWatch } from "../../src/data/theater/basketballTheater";
import { fixture } from "./fixtures";

interface Core {
  count: number;
  first: number;
  items: Record<string, unknown>[];
  status: Record<string, unknown>;
}
const core = fixture("espn-nba-core-plays.json") as Core;
const teams: Teams = { topIsHome: false, topID: "16", bottomID: "5", topName: "MIN", bottomName: "CLE" };
const items = core.items.map(normalized);

/** The core API with `served` plays out so far, the game in progress. */
function lane(served: number, status: Record<string, unknown> = { clock: 150, displayClock: "2:30", period: 5, type: { state: "in", shortDetail: "2:30 - OT" } }) {
  const calls: string[] = [];
  const list = core.items.slice(0, served);
  const fetcher = async (url: string) => {
    calls.push(url);
    if (url.endsWith("/situation")) return { lastPlay: { $ref: `x/plays/${String(list.at(-1)?.id)}?lang=en` } };
    if (url.endsWith("/status")) return status;
    const limit = Number(/limit=(\d+)/.exec(url)?.[1] ?? 50);
    const page = Number(/page=(\d+)/.exec(url)?.[1] ?? 1);
    // Indices in the full game: the fixture starts `first` plays in.
    const count = core.first + list.length;
    if (limit === 1) return { count, items: [] };
    const from = (page - 1) * limit - core.first;
    const slice = from + limit <= 0 ? [] : list.slice(Math.max(from, 0), from + limit);
    // Pages before the fixture's first play come back padded with placeholders (never read as news).
    const pad = from < 0 ? Array.from({ length: Math.min(-from, limit) }, (_, i) => ({ id: `old-${page}-${i}` })) : [];
    return { count, pageCount: Math.ceil(count / limit), items: [...pad, ...slice].slice(0, limit) };
  };
  return { fetcher, calls };
}

describe("the NBA fast lane", () => {
  it("reads the clock, then the plays; the first look is history", async () => {
    const feed = new BasketballFeed(() => 1000);
    const { fetcher, calls } = lane(120);
    let renders = 0;
    feed.subscribe(() => renders++);
    await feed.update(fetcher, { path: "basketball/nba", eventID: "1", teams });
    expect(feed.loaded).toBe(true);
    expect(feed.playing).toBe(true);
    expect(feed.clock).toBe("2:30 - OT");
    expect(feed.gameClock).toMatchObject({ seconds: 150, period: 5, direction: "down" });
    expect(feed.elapsed).toBe(2880 + 150);
    expect(feed.score).toEqual(expect.objectContaining({ home: expect.any(Number), away: expect.any(Number) }));
    expect(feed.shots.length).toBeGreaterThan(10);
    expect(feed.recentPlays).toHaveLength(4);
    expect(feed.takeMoments()).toEqual([]);
    expect(renders).toBe(1);
    expect(calls.some((c) => c.includes("plays?limit=1"))).toBe(true);
  });

  it("offers each new play's moment, the buzzer-beater as a decisive score", async () => {
    const feed = new BasketballFeed(() => 1000);
    await feed.update(lane(150).fetcher, { path: "basketball/nba", eventID: "1", teams });
    feed.takeMoments();
    await feed.update(lane(160).fetcher, { path: "basketball/nba", eventID: "1", teams });
    const moments = feed.takeMoments();
    const winner = moments.find((m) => m.lead === "Buzzer-beater");
    expect(winner).toMatchObject({ tier: Tier.score, kind: "made", value: 3, side: "top" });
    expect([...winner!.accents]).toEqual(expect.arrayContaining(["buzzer", "decisive"]));
    expect(moments.map((m) => m.lead)).toContain("Final");
    // Nothing is news twice.
    await feed.update(lane(160).fetcher, { path: "basketball/nba", eventID: "1", teams });
    expect(feed.takeMoments()).toEqual([]);
  });

  it("the look that catches up after the tab was hidden is history for the theater, as the first is (its moments still come); the next look's plays are news", async () => {
    let t = 1000;
    const feed = new BasketballFeed(() => t);
    const options = { path: "basketball/nba", eventID: "1", teams };
    await feed.update(lane(140).fetcher, options);
    t += 5_000;
    await feed.update(lane(145).fetcher, options);
    expect(feed.history).toBe(1);
    feed.takeMoments();
    t += 120_000;
    await feed.update(lane(155).fetcher, options);
    expect(feed.history).toBe(feed.looks);
    expect(feed.takeMoments().length).toBeGreaterThan(0);
    const watch = new BasketballTheaterWatch();
    const later = Date.now() + 3_600_000;
    watch.update(feed.items, teams, feed.looks, (id) => feed.seenIn(id), later, feed.history);
    expect(watch.state.news.size).toBe(0);
    t += 5_000;
    await feed.update(lane(160).fetcher, options);
    expect(feed.history).toBe(feed.looks - 1);
    watch.update(feed.items, teams, feed.looks, (id) => feed.seenIn(id), later, feed.history);
    expect(watch.state.news.size).toBeGreaterThan(0);
    expect([...watch.state.news].every((id) => feed.seenIn(id) === feed.looks)).toBe(true);
  });

  it("stops being live with the status, clearing what only matters while it's on", async () => {
    const feed = new BasketballFeed();
    await feed.update(lane(150).fetcher, { path: "basketball/nba", eventID: "1", teams });
    await feed.update(lane(160, { type: { state: "post", shortDetail: "Final/OT" } }).fetcher, { path: "basketball/nba", eventID: "1", teams });
    expect(feed.playing).toBe(false);
    expect(feed.possession).toBeNull();
    expect(feed.clutch).toBe(false);
    expect(feed.runs).toEqual([]);
  });

  it("knows who has the ball, clutch time and the run while it's on", () => {
    const feed = new BasketballFeed();
    feed.ingest(items.slice(0, 80), core.first, teams);
    expect(feed.playing).toBe(true);
    expect(feed.possession).toBe("bottom");
    expect(feed.ballInAir).toBe(true);
    expect(feed.clutch).toBe(true);
    const run = items.findIndex((p) => scoringRun(p) != null);
    expect(run).toBeGreaterThan(-1);
    expect(activeRun(items.slice(0, run + 1), teams)).toMatchObject({ team: expect.stringMatching(/top|bottom/) });
  });
});

describe("moments from structured fields", () => {
  it("names blocks, steals, period ends, lead changes and makes", () => {
    const leads = new Set<string>();
    for (let i = 1; i < items.length; i++) {
      const m = momentAt(i, items, teams);
      if (m) leads.add(m.lead);
    }
    for (const lead of ["Block", "Steal", "Three", "Two", "Miss", "End of Q4", "Lead change", "Buzzer-beater", "Final"]) expect(leads.has(lead)).toBe(true);
  });

  it("lets a block or steal celebrate only while it's news", () => {
    const block = items.findIndex((p, i) => momentAt(i, items, teams)?.kind === "block");
    expect(momentAt(block, items, teams, false, 5)?.kind).toBe("missed");
  });

  it("finds an and-one's foul at the same clock, and a shooter's straight makes", () => {
    const shot = (id: string, made: boolean, shooter: string, clock = "5:00") => ({ id, shootingPlay: true, scoringPlay: made, scoreValue: made ? 2 : 0, team: { id: "16" }, period: { number: 4 }, clock: { displayValue: clock }, participants: [{ athlete: { id: shooter } }] });
    const foul = { id: "f", type: { id: 44 }, team: { id: "5" }, period: { number: 4 }, clock: { displayValue: "5:00" } };
    expect(andOne(0, [shot("a", true, "x"), foul], teams)).toBe(true);
    expect(andOne(0, [shot("a", true, "x"), { ...foul, clock: { displayValue: "4:58" } }], teams)).toBe(false);
    expect(makes(3, [shot("1", true, "x"), shot("2", false, "x"), shot("3", true, "x"), shot("4", true, "x")])).toBe(2);
  });

  it("takes back a basket that's gone, and upgrades one edited into more", () => {
    const winner = items.length - 3;
    const m = momentAt(winner, items, teams)!;
    const announced = new Map([[m.id, m]]);
    expect(reconcile(announced, items.filter((_, i) => i !== winner), teams).retracted).toEqual([m.id]);
    const routine = { ...m, tier: Tier.routine };
    expect(reconcile(new Map([[m.id, routine]]), items, teams).upgraded.map((x) => x.id)).toEqual([m.id]);
  });
});
