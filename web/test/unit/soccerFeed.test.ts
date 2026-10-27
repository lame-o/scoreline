/**
 * The soccer lane (data/liveFeeds/soccer.ts, LiveFeeds.swift `SoccerFeed`)
 * on a recorded Premier League match (MCI @ AVL, Oct 24 2026: Jackson 6',
 * Haaland 52', Jackson 60'), and the soccer summary's key events.
 */
import { describe, expect, it } from "vitest";
import { actionMoment, cardMoment, decidesMatch, pitchAction, placedCard, shotSummary, SoccerFeed, soccerMinute, woodwork, woodworkY, type PitchAction } from "../../src/data/liveFeeds/soccer";
import { parseESPNDetail } from "../../src/data/gameDetail";
import { Tier } from "../../src/data/moments";
import type { ScoreEvent } from "../../src/data/models";
import { fixture } from "./fixtures";

const core = fixture("espn-soccer-core-plays.json") as { items: Record<string, unknown>[] };
const HOME = "362"; // Aston Villa, listed first (top)

describe("pitch actions", () => {
  it("orients every action so the home side attacks right", () => {
    const actions = core.items.flatMap((p, i) => pitchAction(p, i, HOME) ?? []);
    expect(actions.length).toBeGreaterThan(150);
    expect(actions.every((a) => a.x >= 0 && a.x <= 100 && a.y >= 0 && a.y <= 100)).toBe(true);
    const goals = actions.filter((a) => a.kind === "goal");
    expect(goals.map((g) => [g.side, g.minute])).toEqual([
      ["top", "6'"],
      ["bottom", "52'"],
      ["top", "60'"],
    ]);
    // Shots end at the goal they attack: home at x 100, away flipped to x 0.
    expect(goals[0]!.endX).toBe(100);
    expect(goals[1]!.endX).toBe(0);
    expect(goals[0]).toMatchObject({ xg: 0.128, topScore: 1, bottomScore: 0, clockSeconds: 354 });
  });

  it("reads shot outcomes by exact type, and goals by the scoring flag", () => {
    const shot = (type: string, extra: Record<string, unknown> = {}) => pitchAction({ id: "1", type: { type }, team: { $ref: "/teams/362" }, fieldPositionX: 80, fieldPositionY: 50, ...extra }, 0, HOME)!;
    expect(shot("shot-on-target").shot).toBe("saved");
    expect(shot("shot-blocked").shot).toBe("blocked");
    expect(shot("shot-hit-woodwork").shot).toBe("woodwork");
    expect(shot("shot-off-target").shot).toBe("wide");
    expect(shot("goal-kick").kind).toBe("other");
    expect(shot("assists-shot").kind).toBe("other");
    expect(shot("goal---header").kind).toBe("goal");
    expect(pitchAction({ type: { type: "pass" }, team: { $ref: "/teams/362" }, fieldPositionX: 0, fieldPositionY: 0 }, 0, HOME)).toBeNull();
  });

  it("says where the woodwork was struck", () => {
    const base = pitchAction({ id: "1", type: { type: "shot-hit-woodwork" }, team: { $ref: "/teams/362" }, fieldPositionX: 80, fieldPositionY: 50, fieldPosition2X: 100, fieldPosition2Y: 46 }, 0, HOME)!;
    expect(woodworkY({ ...base, goalY: 46, goalZ: 10 })).toBe(45.2);
    expect(woodworkY({ ...base, goalY: 50, goalZ: 36 })).toBe(50);
    expect(woodwork({ ...base, goalY: 54, goalZ: 5 })).toEqual({ x: 100, y: 54.8 });
  });

  it("puts a card at the foul that drew it", () => {
    const recent = core.items.flatMap((p, i) => pitchAction(p, i, HOME) ?? []);
    const index = core.items.findIndex((p) => String((p.type as { type: string }).type).endsWith("card"));
    const card = placedCard(core.items[index], index, recent.filter((a) => a.id < index));
    expect(card).toMatchObject({ kind: "yellow", playID: core.items[index]!.id });
    expect(cardMoment(core.items[index], HOME)).toMatchObject({ kind: "yellowCard", lead: "Yellow card", side: expect.any(String) });
  });
});

describe("moments", () => {
  const action = (fields: Partial<PitchAction>): PitchAction => ({ id: 1, kind: "shot", side: "top", x: 80, y: 50, endX: 100, endY: 50, minute: "70'", text: "Ollie Watkins Shot On Target", playID: "9", shot: "saved", xg: 0.1, goalY: 50, goalZ: 10, topScore: 0, bottomScore: 0, clockSeconds: 4200, ...fields });

  it("leads a big chance with the chance", () => {
    expect(actionMoment(action({ xg: 0.39 }))).toMatchObject({ lead: "Big chance", detail: "0.39 xG · saved · Ollie Watkins Shot On Target", tier: Tier.swing });
    expect([...actionMoment(action({ xg: 0.39 }))!.accents]).toEqual(["bigChance"]);
    expect(actionMoment(action({ shot: "woodwork" }))).toMatchObject({ kind: "shotWide", lead: "Off the woodwork" });
  });

  it("marks a late equalizer or winner decisive", () => {
    const goal = action({ kind: "goal", shot: null, text: "Ollie Watkins Goal", clockSeconds: 88 * 60, topScore: 2, bottomScore: 1 });
    expect(decidesMatch(goal)).toBe(true);
    expect(actionMoment(goal)).toMatchObject({ lead: "Goal", detail: "Ollie Watkins", tier: Tier.score });
    expect(decidesMatch({ ...goal, topScore: 3, bottomScore: 1 })).toBe(false);
    expect(decidesMatch({ ...goal, clockSeconds: 60 * 60 })).toBe(false);
  });
});

describe("the feed", () => {
  const pages = (items: readonly unknown[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => ({ page: i + 1, items: items.slice(i * size, (i + 1) * size) }));

  it("keeps the trail and every shot; the first complete load is history", () => {
    const feed = new SoccerFeed();
    const half = core.items.findIndex((p) => (p.clock as { value: number }).value >= 59 * 60 && (p.period as { number: number }).number === 2);
    feed.read(pages(core.items.slice(0, half), 200), 200, true, HOME);
    expect(feed.loaded).toBe(true);
    expect(feed.trail).toHaveLength(10);
    expect(feed.plays).toHaveLength(80);
    expect(feed.shots.filter((s) => s.kind === "goal")).toHaveLength(2);
    expect(feed.takeMoments()).toEqual([]);
    // The next look reads only what's new: the 60' goal is news.
    feed.read(pages(core.items, 200), 200, true, HOME);
    const moments = feed.takeMoments();
    expect(moments.find((m) => m.kind === "goal")).toMatchObject({ lead: "Goal", detail: "Nicolas Jackson", side: "top" });
    expect(feed.shots.filter((s) => s.kind === "goal")).toHaveLength(3);
    expect(Object.keys(feed.cards).length).toBeGreaterThan(0);
  });

  it("summarizes shots, and reads the match minute", () => {
    const feed = new SoccerFeed();
    feed.read(pages(core.items, 200), 200, true, HOME);
    expect(shotSummary(feed.shots, "AVL", "MCI")).toMatch(/^AVL \d+ shots, 2 goals · MCI \d+ shots?, 1 goal$/);
    expect(soccerMinute("67'")).toBe(67);
    expect(soccerMinute("90'+5'")).toBe(95);
    expect(soccerMinute("HT")).toBe(45);
    expect(soccerMinute(null)).toBeNull();
  });

  it("asks only for what's new after the first load", async () => {
    const feed = new SoccerFeed();
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      const limit = Number(/limit=(\d+)/.exec(url)![1]);
      const page = Number(/page=(\d+)/.exec(url)![1]);
      return { pageCount: Math.ceil(core.items.length / limit), items: core.items.slice((page - 1) * limit, page * limit) };
    };
    await feed.update(fetcher, { league: "eng.1", eventID: "1", homeTeamID: HOME });
    expect(calls[0]).toContain("limit=200&page=1");
    calls.length = 0;
    await feed.update(fetcher, { league: "eng.1", eventID: "1", homeTeamID: HOME });
    expect(calls[0]).toContain(`limit=25&page=${Math.floor(core.items.length / 25) + 1}`);
  });
});

describe("the summary's key events", () => {
  it("reads goals and cards with their minute and side, commentary newest first", () => {
    const summary = fixture("espn-soccer-summary.json");
    const event = { content: { kind: "match", top: { id: "espn-soccer-362" }, bottom: { id: "espn-soccer-382" } }, state: "final" } as unknown as ScoreEvent;
    const detail = parseESPNDetail(summary, { event, path: "soccer/eng.1", id: "401879256", sport: "soccer" });
    const goals = detail.moments.filter((m) => m.kind === "goal");
    expect(goals.map((g) => [g.side, g.clock])).toEqual([
      ["top", "6'"],
      ["bottom", "52'"],
      ["top", "60'"],
    ]);
    expect(goals[1]!.text).toBe("Erling Haaland Goal - Header");
    expect(detail.moments.filter((m) => m.kind === "yellow")).toHaveLength(8);
    expect(detail.linescore).toBeNull();
    expect(detail.stats.find((s) => s.label === "Possession")?.top).toMatch(/%$/);
    expect(detail.recentPlays[0]).toContain("Match ends");
  });
});

describe("an archived match's unit-scale feed", () => {
  // As ESPN serves a March 2026 Champions League match: 0…1, each team attacking toward x = 0.
  const items = [
    { id: "1", type: { type: "shot-on-target" }, team: { $ref: "/teams/359" }, fieldPositionX: 0.19, fieldPositionY: 0.462, fieldPosition2X: 0.01, fieldPosition2Y: 0.496, clock: { value: 600, displayValue: "10'" } },
    { id: "2", type: { type: "goal" }, scoringPlay: true, team: { $ref: "/teams/131" }, fieldPositionX: 0.376, fieldPositionY: 0.507, fieldPosition2X: 0, fieldPosition2Y: 0.542, clock: { value: 900, displayValue: "15'" } },
  ];

  it("is turned round onto the usual scale, each team attacking its own way", async () => {
    const { pitchScale } = await import("../../src/data/liveFeeds/soccer");
    expect(pitchScale(items)).toBe("unit");
    expect(pitchScale(core.items)).toBe("percent");
    const feed = new SoccerFeed();
    feed.read([{ page: 1, items }], 200, true, "359");
    const [shot, goal] = feed.shots;
    expect(shot).toMatchObject({ side: "top", x: 81, endX: 99 });
    expect(shot!.y).toBeCloseTo(53.8);
    // The away side's goal, flipped to attack left: it ends on the line at 0.
    expect(goal).toMatchObject({ side: "bottom", endX: 0 });
    expect(goal!.x).toBeCloseTo(37.6);
  });
});

describe("the lane's score", () => {
  it("is the newest play's, home first", () => {
    const feed = new SoccerFeed();
    const upTo = core.items.findIndex((p) => (p.type as { type: string }).type === "goal---header");
    feed.read([{ page: 1, items: core.items.slice(0, upTo + 1) }], 200, true, HOME);
    expect(feed.score).toEqual({ top: 1, bottom: 1 });
  });
});
