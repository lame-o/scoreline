/**
 * The football theater on the engine (FootballClips.swift): the world frame,
 * the summary's drives read for the directed field (TheaterEngineTests.swift
 * `summaryDrives`), the running order, and the Mac's football gate fixture
 * (Tests/Fixtures/theater/football_nfl/401873009-synthetic: DAL at PHI with
 * synthetic arrivals) through the director, every frame measured by the
 * bench's continuity meter against the Mac's gates for football
 * (TheaterEngineTests.swift `theaterGates`: no hard cuts, teleportMax at its
 * ratchet 1.27, at most 0.5% of the time over the sprint, overspeed at its
 * ratchet +38%, at most 1% over the push limits, the rig's planted foot not
 * slipping).
 */
import { describe, expect, it } from "vitest";
import { at, type JSONValue } from "../../src/data/json";
import type { FootballTeams } from "../../src/data/liveFeeds/football";
import { GridPlanner, GridSequencer, GridSport, GridWorld, gridFacts, type GridFacts, type GridPlay } from "../../src/data/theater/footballClips";
import { parse } from "../../src/data/theater/footballScene";
import { FOOTBALL_AHEAD as AHEAD, footballArrivals, summaryPlays } from "../../src/data/theater/replayFootball";
import { MotionLimits, v2 } from "../../src/data/theater/theaterEngine";
import type { TimelinePlay } from "../../src/data/theater/theaterSource";
import { quantile } from "./theaterBenchMeter";
import { runEngine } from "./theaterRun";
import { firstLooks, recording } from "./theaterTimelines";

describe("the field as the world", () => {
  it("a script attacking the screen's left turns half a turn about midfield, and its camera with it (a 120° orbit)", () => {
    const p = v2(12, 80);
    expect(GridWorld.point(p, false)).toEqual(v2(-12, 220));
    expect(GridWorld.local(GridWorld.point(p, false), false)).toEqual(p);
    expect(GridWorld.point(p, true)).toEqual(p);
    const frame = { x: 14, y: 60, span: 90 };
    for (const yaw of [Math.PI / 6, -Math.PI / 6]) {
      const right = GridWorld.right(yaw);
      const world = GridWorld.camera(frame, yaw, right);
      expect(world.w).toBeCloseTo(right ? Math.PI / 6 : (5 * Math.PI) / 6, 12);
      const back = GridWorld.frame(world, right);
      expect(back.yaw).toBeCloseTo(yaw, 12);
      expect(back.frame.x).toBeCloseTo(frame.x, 9);
      expect(back.frame.y).toBeCloseTo(frame.y, 9);
      expect(back.frame.span).toBeCloseTo(frame.span, 9);
    }
  });
});

describe("the summary's drives", () => {
  it("a summary drive's play (teams by id) parses for the directed field", () => {
    // The broadcast's football plays come from the summary's drives, which name teams by id (the core lane by reference).
    const raw = {
      id: "401858278835",
      type: { id: "5", text: "Rush" },
      text: "(00:09) No Huddle-Shotgun #7 K.Jennings rush middle for 0 yards to the SMU31",
      start: { down: 2, distance: 10, yardLine: 69, team: { id: "2567" } },
      end: { down: 3, distance: 10, yardLine: 69, team: { id: "2567" } },
      statYardage: 0,
      period: { number: 4 },
      clock: { displayValue: "0:02" },
      wallclock: "2026-10-31T19:34:49Z",
    };
    const teams: FootballTeams = { topIsHome: false, topID: "183", bottomID: "2567", homeAbbreviation: "SMU", awayAbbreviation: "SYR", homeName: "Mustangs", awayName: "Orange" };
    const scene = parse(raw, teams);
    expect(scene?.offense).toBe("bottom");
    expect(scene?.flips).toBe(false);
  });
});

// The Mac's gate fixture, every look as the synthetic recorder saw it; the visitors on top, as the bench has them.
const looks = recording("football_nfl", "401873009-synthetic");
const first = firstLooks(looks, summaryPlays);
const when = new Map(first.map((f) => [at(f.play, "id") as string, f.at]));
const arrivals = footballArrivals(
  first.map((f) => f.play),
  0,
  (id) => when.get(id) ?? null,
);
const competitors = at(looks[looks.length - 1]!.json, "header", "competitions", 0, "competitors") as { homeAway: string; team: { id: string; abbreviation: string } }[];
const home = competitors.find((c) => c.homeAway === "home")!.team;
const away = competitors.find((c) => c.homeAway === "away")!.team;
const facts: GridFacts = gridFacts({ topIsHome: false, topID: away.id, bottomID: home.id, homeAbbreviation: home.abbreviation, awayAbbreviation: away.abbreviation });

describe("the running order", () => {
  const snapshot = { plays: arrivals.map((a) => a.play), pending: [], watermark: Infinity, revision: 1, told: new Set<string>() };
  const plays: TimelinePlay<GridPlay>[] = GridPlanner.plays(snapshot, facts as unknown as FootballTeams);

  it("every snap and stoppage read, each snap spotted after the one before, a touchdown's try told after it", () => {
    expect(plays.length).toBeGreaterThan(20);
    const sequencer = new GridSequencer(plays, new Set(), facts);
    const units = sequencer.units(new Set());
    const snaps = plays.filter((p) => p.play.kind === "snap");
    expect(units.filter((u) => u.scene.kind === "snap" && !u.id.endsWith("-try")).length).toBe(snaps.length);
    // Every touchdown's try right after it, from its own set.
    units.forEach((u, i) => {
      if (u.scene.kind !== "snap" || u.scene.scene.scoring !== "touchdown" || u.scene.scene.pointAfter != null) return;
      if (u.scene.scene.conversion == null) return;
      expect(units[i + 1]?.id).toBe(`${u.id}-try`);
      expect(units[i + 1]?.fromWorld).toBe(false);
    });
    // The stoppages attach to the field on screen (admin), from the world as it stands.
    for (const u of units.filter((x) => x.scene.kind === "stoppage")) expect(u.admin && u.fromWorld).toBe(true);
    // The scenes the director reads are the planner's.
    const read = GridSport.scene([], snapshot.plays.map((p) => p.play.json) as JSONValue[], 3, false, facts, 0, []);
    expect(read).not.toBeNull();
  });

  it("a snap's dead balls at least 8 s apart; a stoppage a second; an estimated time believed less", () => {
    const inputs = GridPlanner.inputs(plays);
    plays.forEach((p, i) => {
      expect(inputs[i]!.gapAfter).toBe(p.play.kind === "snap" ? 8 : 1);
      expect(inputs[i]!.live).toBe(p.play.kind === "snap");
      expect(inputs[i]!.weight).toBe(p.play.kind === "snap" ? 1 : 0.25);
    });
  });
});

describe("the director on the recording", () => {
  // The broadcast's football delay (BROADCAST §2's football table: D ≈ 74 s), past every synthetic arrival (25–50 s).
  const from = looks[0]!.at;
  const until = looks[looks.length - 1]!.at + 80;
  const run = runEngine(GridSport, facts, arrivals, from, until, 74, MotionLimits.football, "football 401873009-synthetic", null, { ahead: AHEAD, rereads: true });
  const r = run.report;
  let fades = 0;
  for (const baked of run.chain.plans) for (const p of baked.plan.placements) fades += p.clip.fades.count;
  if (process.env.THEATER_BENCH) {
    console.log(
      `${r.label}: frames ${r.frames}, plans ${run.plans}, hard cuts ${r.hardCuts} (${[...r.hardCutReasons].join(", ")}), teleportMax ${r.teleportMax.toFixed(2)}, ` +
        `over the sprint ${(r.speedShare * 100).toFixed(2)}% max +${(r.maxOverspeed * 100).toFixed(0)}%, accel ${(r.accelShare * 100).toFixed(2)}%, rig slip ${r.rigSlipMax.toFixed(2)} mm, ` +
        `decisive p95 ${quantile(r.decisiveErrors.map(Math.abs), 0.95).toFixed(3)} s max ${Math.max(...r.decisiveErrors.map(Math.abs)).toFixed(3)} s (${r.decisiveErrors.length}), catch-ups ${r.catchUps.length}, ` +
        `fades in the last plans ${fades}, plan ms p50 ${quantile(run.planMs, 0.5).toFixed(1)} p99 ${quantile(run.planMs, 0.99).toFixed(1)}\n` +
        `overspeed by source: ${[...r.maxOverspeedBySource].map(([k, v]) => `${k} +${(v * 100).toFixed(0)}%`).join(", ")}\n${r.jumpLog.join("\n")}`,
    );
  }

  it("plans and tells every snap that came in", () => {
    expect(run.plans).toBeGreaterThan(3);
    expect(run.decisive.size).toBeGreaterThan(10);
  });

  it("the gates: no hard cuts, nobody outruns his legs for long, the planted foot holds", () => {
    expect(r.hardCuts, [...r.hardCutReasons].join(", ") + r.jumpLog.join("\n")).toBe(0);
    expect(r.teleportMax, "teleportMax holds its ratchet (1.27 on the Mac; gate 1.15)").toBeLessThanOrEqual(1.27);
    expect(r.speedShare, "at most 0.5% of the time over the sprint").toBeLessThanOrEqual(0.005);
    expect(r.maxOverspeed, "overspeed holds its ratchet (+38% on the Mac; gate +12%)").toBeLessThanOrEqual(0.38);
    expect(r.accelShare, "at most 1% of the time over the push limits").toBeLessThanOrEqual(0.01);
    expect(r.rigSlipMax, "the rig's planted foot doesn't slip").toBeLessThanOrEqual(0.5);
  });

  it("decisive moments land on their anchors (p95 ≤ 0.05 s, max ≤ 0.25 s), catch-ups apart", () => {
    const abs = r.decisiveErrors.map(Math.abs);
    expect(abs.length).toBeGreaterThan(5);
    expect(quantile(abs, 0.95), `p95 ${quantile(abs, 0.95)}`).toBeLessThanOrEqual(0.05);
    expect(Math.max(...abs), `max ${Math.max(...abs)}`).toBeLessThanOrEqual(0.25);
  });
});
