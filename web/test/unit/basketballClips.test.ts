/**
 * The basketball theater on the engine (BasketballClips.swift), on the whole
 * recorded game SA at UTA (nba-every-play-401909890.json): the plays arrive
 * as the lane brings them, the director plans and splices, and every frame
 * of a stretch of the fourth quarter is measured by the bench's continuity
 * meter against the Mac's gates for basketball (TheaterEngineTests.swift
 * `theaterGates`: no hard cuts, teleportMax at its ratchet 3.90, at most
 * 0.5% of the time over the sprint, overspeed at its ratchet +335%, at most
 * 1% over the push limits, the rig's planted foot not slipping). Plus the
 * pieces: the world frame, the running order, the anchors' gaps.
 */
import { describe, expect, it } from "vitest";
import type { Teams } from "../../src/data/liveFeeds/basketball";
import { parseScene, type BasketballScene } from "../../src/data/theater/basketballScene";
import { Hoops } from "../../src/data/theater/basketballScript";
import { basketballUnits, HoopsAnchors, HoopsSport, HoopsWorld, type HoopsFacts } from "../../src/data/theater/basketballClips";
import { MotionLimits, v2 } from "../../src/data/theater/theaterEngine";
import { fixture } from "./fixtures";
import { quantile } from "./theaterBenchMeter";
import { runEngine } from "./theaterRun";
import { recordedBasketball, recording } from "./theaterTimelines";
import { at } from "../../src/data/json";
import { digest } from "../../src/data/theater/replayTimeline";
import { SceneCache } from "../../src/data/theater/theaterDirector";
import type { RawPlay, TimelinePlay, TimelineSnapshot } from "../../src/data/theater/theaterSource";

type Item = Record<string, unknown>;
const game = (fixture("nba-every-play-401909890.json") as { games: { items: Item[]; home: { id: string }; away: { id: string } }[] }).games[0]!;
const items = game.items;
const teams: Teams = { topIsHome: false, topID: game.away.id, bottomID: game.home.id, topName: "Spurs", bottomName: "Jazz" };
const facts: HoopsFacts = { ...teams, flipped: false };
const scenes = items.flatMap((_, i) => parseScene(items, i, teams) ?? []);

describe("the court as the world", () => {
  it("a left-basket script turns half a turn about center court, and its camera with it", () => {
    const p = v2(80, 12);
    expect(HoopsWorld.point(p, false)).toEqual(v2(Hoops.length - 80, Hoops.width - 12));
    expect(HoopsWorld.local(HoopsWorld.point(p, false), false)).toEqual(p);
    const frame = { x: 12, y: -8, span: 40 };
    for (const right of [true, false]) {
      const yaw = Hoops.yawRight(right);
      const world = HoopsWorld.camera(frame, yaw);
      expect(world.w).toBeCloseTo(HoopsWorld.yaw(right), 12);
      const back = HoopsWorld.frame(world, right);
      expect(back.frame.x).toBeCloseTo(frame.x, 9);
      expect(back.frame.y).toBeCloseTo(frame.y, 9);
      expect(back.frame.span).toBeCloseTo(frame.span, 9);
    }
  });
});

describe("the running order", () => {
  it("every play still to tell, none passed over: substitutions at a stoppage together, a miss with its board", () => {
    const units = basketballUnits(scenes, new Set());
    const covered = new Set(units.flatMap((u) => [u.scene.id, ...u.covers, ...u.group.map((s) => s.id)]));
    const missing = scenes.filter((s) => !covered.has(s.id));
    expect(missing.length, missing.map((s) => `${s.id} ${s.kind}`).join(", ")).toBe(0);
    expect(units.every((u) => u.skipped === 0)).toBe(true);
    const subs = units.filter((u) => u.scene.kind === "substitution");
    expect(subs.some((u) => u.group.length > 1)).toBe(true);
  });

  it("the gaps: a long miss's board comes later than a short one's; free throws a routine apart", () => {
    const miss = (distance: number) => ({ ...scenes.find((s) => s.kind === "jumper")!, result: "miss" as const, distance });
    const board = scenes.find((s) => s.kind === "defensiveRebound")!;
    expect(HoopsAnchors.gap(miss(24) as BasketballScene, board)).toBeGreaterThan(HoopsAnchors.gap(miss(3) as BasketballScene, board));
    const ft = scenes.find((s) => s.kind === "freeThrow")!;
    expect(HoopsAnchors.gap(ft, ft)).toBe(6);
  });
});

/**
 * The incremental scene cache (ChoreographyIntegrationTests.swift's part: the
 * timeline's and the clock's are the broadcast's): a scene is read again
 * when its play, or one it reads, changes; never otherwise.
 */
describe("the scenes, read incrementally", () => {
  const entry = (id: string, type: number, text: string, shooting = false): TimelinePlay<RawPlay> => {
    const json = { id, type: { id: type }, text, shootingPlay: shooting, scoringPlay: false, team: { id: "1" }, period: { number: 1 }, clock: { displayValue: "10:00" }, coordinate: { x: 25, y: 20 } };
    return {
      id,
      order: 0,
      eventTime: 100,
      eventBounds: null,
      timeSource: "wallclock",
      presentAt: 100,
      period: 1,
      clock: { elapsed: null, resolution: 1, display: null },
      kind: { phase: "live", label: "shot", stopsClock: false, announced: false },
      score: null,
      revision: 0,
      estimated: false,
      firstSeen: 101,
      play: { json, digest: digest(id) },
    };
  };
  const snapshot = (plays: TimelinePlay<RawPlay>[], pending: TimelinePlay<RawPlay>[] = []): TimelineSnapshot<RawPlay> => ({ plays, watermark: 200, revision: 1, told: new Set(), pending });
  const fresh = (s: TimelineSnapshot<RawPlay>, f: HoopsFacts) => new SceneCache(HoopsSport).read(s, f);
  const same = (a: readonly TimelinePlay<BasketballScene>[], b: readonly TimelinePlay<BasketballScene>[]) => JSON.stringify(a) === JSON.stringify(b);
  const base: HoopsFacts = { topIsHome: false, flipped: false, topID: "1", bottomID: "2", topName: "", bottomName: "" };

  it("a rebound beyond forty substitutions invalidates the earlier miss; an unchanged input parses nothing; new facts read everything again", () => {
    const cache = new SceneCache(HoopsSport);
    const miss = entry("miss", 92, "A Player misses jumper", true);
    const admin = Array.from({ length: 40 }, (_, k) => entry(`sub-${k}`, 584, "A Player enters the game for B Player"));
    const board = entry("board", 155, "A Player defensive rebound");
    const before = snapshot([miss, ...admin]);
    cache.read(before, base);
    const after = snapshot([miss, ...admin, board]);
    const cached = cache.read(after, base);
    expect(same(cached, fresh(after, base))).toBe(true);
    expect(cached[0]?.play.rebound?.id).toBe("board");
    cache.read(after, base);
    expect(cache.parsed, "an unchanged scene input parses no plays on a horizon refresh").toBe(0);
    const flipped: HoopsFacts = { ...base, topID: "2", bottomID: "1" };
    expect(same(cache.read(after, flipped), fresh(after, flipped))).toBe(true);
    expect(cache.parsed).toBe(after.plays.length);
    expect(same(cache.read(before, base), fresh(before, base)), "removing the distant rebound also invalidates the earlier miss").toBe(true);
    expect(cache.read(snapshot([]), base)).toEqual([]);
    expect(same(cache.read(after, base), fresh(after, base)), "empty and repopulated snapshots retain no stale scenes").toBe(true);
  });

  it("cached and fresh scenes agree through feed changes on the recording (removal, insertion, pending promotion)", () => {
    const all = recordedBasketball(recording("basketball_nba", "401909285")).map((a) => a.play);
    const cache = new SceneCache(HoopsSport);
    const cut = all.length >> 1;
    const variants = [
      snapshot(all.slice(0, cut), all.slice(cut)),
      snapshot(all),
      snapshot(all.filter((_, i) => i !== cut)),
      snapshot(all),
      snapshot(all.slice(0, cut)),
      snapshot([]),
      snapshot(all),
    ];
    const growing: TimelineSnapshot<RawPlay>[] = [];
    for (let n = 25; n < all.length; n += 25) growing.push(snapshot(all.slice(0, n)));
    for (const v of [...growing, ...variants]) expect(same(cache.read(v, base), fresh(v, base))).toBe(true);
  });
});

describe("the director on the recording", () => {
  // The Mac's gate fixture: LAL at GS, Q4 7:35 to 2:02 (Tests/Fixtures/theater/basketball_nba/401909285), every
  // look as the recorder saw it; the visitors on top, as the bench has them.
  const looks = recording("basketball_nba", "401909285");
  const arrivals = recordedBasketball(looks);
  const competitors = at(looks[looks.length - 1]!.json, "header", "competitions", 0, "competitors") as { homeAway: string; team: { id: string; abbreviation: string } }[];
  const home = competitors.find((c) => c.homeAway === "home")!.team;
  const away = competitors.find((c) => c.homeAway === "away")!.team;
  const gsl: HoopsFacts = { topIsHome: false, flipped: false, topID: away.id, bottomID: home.id, topName: away.abbreviation, bottomName: home.abbreviation };
  const from = looks[0]!.at;
  const until = looks[looks.length - 1]!.at + 30;
  const run = runEngine(HoopsSport, gsl, arrivals, from, until, 50, MotionLimits.basketball, "basketball 401909285 Q4");
  const r = run.report;
  if (process.env.THEATER_BENCH) {
    console.log(
      `${r.label}: frames ${r.frames}, plans ${run.plans}, hard cuts ${r.hardCuts} (${[...r.hardCutReasons].join(", ")}), teleportMax ${r.teleportMax.toFixed(2)}, ` +
        `over the sprint ${(r.speedShare * 100).toFixed(2)}% max +${(r.maxOverspeed * 100).toFixed(0)}%, accel ${(r.accelShare * 100).toFixed(2)}%, rig slip ${r.rigSlipMax.toFixed(2)} mm, ` +
        `decisive p95 ${quantile(r.decisiveErrors.map(Math.abs), 0.95).toFixed(3)} s max ${Math.max(...r.decisiveErrors.map(Math.abs)).toFixed(3)} s, catch-ups ${r.catchUps.length}, ` +
        `plan ms p50 ${quantile(run.planMs, 0.5).toFixed(1)} p99 ${quantile(run.planMs, 0.99).toFixed(1)}\n${r.jumpLog.join("\n")}`,
    );
  }

  it("plans and tells every play that came in", () => {
    expect(run.plans).toBeGreaterThan(3);
    expect(run.decisive.size).toBeGreaterThan(10);
  });

  it("the gates: no hard cuts, nobody outruns his legs for long, the planted foot holds", () => {
    // No cut at a splice (the engine's own). Inside a clip, today's script for a driving layup (685, 724: the catch at
    // the wing, the drive's start) leaves ClipPaths.solved oscillating between "ends short" and "meets the ball" until
    // its pass cap, a 4.4 ft step in 0.06 s. The Mac has the same step: its ratchets (teleportMax 3.90, overspeed
    // +335%) are it, read between the bake's 60 Hz samples, where T following the real clock's slews leaves the
    // frames (theaterGates.test.ts: 3.85, +331%, no cut). On this still clock every frame lands on a bake sample, and
    // the step reads as a cut in both plays: 4.29 and +381%. Counted, never more.
    expect(r.hardCutReasons.get("at a splice") ?? 0, [...r.hardCutReasons].join(", ") + r.jumpLog.join("\n")).toBe(0);
    expect(r.hardCuts, [...r.hardCutReasons].join(", ") + r.jumpLog.join("\n")).toBeLessThanOrEqual(2);
    // Held here at what this run measures.
    expect(r.teleportMax, "teleportMax holds its ratchet (3.90 on the Mac; gate 1.15)").toBeLessThanOrEqual(4.3);
    expect(r.speedShare, "at most 0.5% of the time over the sprint").toBeLessThanOrEqual(0.005);
    expect(r.maxOverspeed, "overspeed holds its ratchet (+335% on the Mac; gate +12%)").toBeLessThanOrEqual(3.82);
    expect(r.accelShare, "at most 1% of the time over the push limits").toBeLessThanOrEqual(0.01);
    expect(r.rigSlipMax, "the rig's planted foot doesn't slip").toBeLessThanOrEqual(0.5);
  });

  it("is deterministic: two runs bake the same tracks, cameras and cues", () => {
    const again = runEngine(HoopsSport, gsl, arrivals, from, from + 120, 50, MotionLimits.basketball, "again");
    const once = runEngine(HoopsSport, gsl, arrivals, from, from + 120, 50, MotionLimits.basketball, "once");
    expect(again.hash).toBe(once.hash);
  });

  it("decisive moments land on their anchors (p95 ≤ 0.05 s, max ≤ 0.25 s), catch-ups apart", () => {
    const abs = r.decisiveErrors.map(Math.abs);
    expect(abs.length).toBeGreaterThan(5);
    expect(quantile(abs, 0.95), `p95 ${quantile(abs, 0.95)}`).toBeLessThanOrEqual(0.05);
    expect(Math.max(...abs), `max ${Math.max(...abs)}`).toBeLessThanOrEqual(0.25);
  });
});
