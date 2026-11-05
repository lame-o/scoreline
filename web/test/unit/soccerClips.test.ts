/**
 * The soccer theater on the engine (SoccerClips.swift): the Mac's soccer gate
 * fixture (Tests/Fixtures/broadcast/soccer_eng.1/401879256, Villa v City's
 * core plays, each arriving 28–40 s after its wallclock as the recorder
 * writes the core lane) through the director, every frame measured by the
 * bench's continuity meter against the Mac's gates for soccer
 * (TheaterEngineTests.swift `theaterGates`: no hard cuts, teleportMax at its
 * ratchet 2.90, at most 0.5% of the time over the sprint, overspeed at its
 * ratchet +220%, at most 1% over the push limits, the rig's planted foot not
 * slipping). Plus the pieces: the clip, its loop, the running order, the
 * scene cache against fresh reads (ChoreographyIntegrationTests.swift), the
 * painter, and every break's quiet (GamePresentationRegressionTests.swift
 * `breakScenes`).
 *
 * The run's ratchets are one man's: in a corner's beat (the big men into the
 * box) one centre-back's run up is more than his legs can make, and the
 * re-made path (ClipPaths, the loop's seams held) runs him at 3.15× his
 * sprint just past the loop's start, every time round (+215%, 2.87; the
 * Mac's ratchets are +220% and 2.90).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { at, type JSONValue } from "../../src/data/json";
import { soccerArrivals, soccerKind } from "../../src/data/theater/replaySoccer";
import { PitchClip, PitchIdleClips, PitchPlanner, PitchSequencer, PitchSport, type PitchFacts, type PitchPlay } from "../../src/data/theater/soccerClips";
import { soccerIdle, soccerIdleScript, SoccerStatus, type SoccerEvent, type SoccerEventKind, type SoccerTouch } from "../../src/data/theater/soccerIdle";
import { isMoment } from "../../src/data/theater/soccerScene";
import { MotionLimits } from "../../src/data/theater/theaterEngine";
import { FrameScratch } from "../../src/data/theater/theaterFrameScratch";
import { pitchFrame } from "../../src/features/game/soccer/theater/directedPitch";
import type { RawPlay, TimelinePlay, TimelineSnapshot } from "../../src/data/theater/theaterSource";
import { SceneCache } from "../../src/data/theater/theaterDirector";
import { DelayClock, snapshotAt } from "../../src/data/theater/replayTimeline";
import { quantile } from "./theaterBenchMeter";
import { runEngine } from "./theaterRun";
import { firstLooks } from "./theaterTimelines";

/** The broadcast fixture's core looks (Tests/Fixtures/broadcast/<dir>/<event>/core/<arrival ms>.json.gz), in order. */
function coreLooks(dir: string, event: string): { at: number; json: JSONValue }[] {
  const root = join(import.meta.dirname, "..", "..", "..", "Tests", "Fixtures", "broadcast", dir, event, "core");
  return readdirSync(root)
    .filter((f) => f.endsWith(".json.gz"))
    .map((f) => ({ at: Number(f.split(".")[0]) / 1000, json: JSON.parse(gunzipSync(readFileSync(join(root, f))).toString("utf8")) as JSONValue }))
    .sort((a, b) => a.at - b.at);
}

const event = (id: string, kind: SoccerEventKind, text: string, period: number | null = 1): SoccerEvent => ({
  id,
  kind,
  side: null,
  player: null,
  athlete: null,
  other: null,
  otherAthlete: null,
  at: null,
  penalty: false,
  minute: "",
  clock: 0,
  period,
  text,
  wallclock: null,
  order: 1,
});

/** The longest stretch with nothing moving in a loop (GamePresentationRegressionTests.longestStill). */
function longestStill(beats: readonly (readonly [number, number])[], start: number, period: number): number {
  const inside = beats
    .filter(([, b]) => b > start)
    .map(([a, b]) => [Math.max(a, start), Math.min(b, start + period)] as const)
    .sort((x, y) => x[0] - y[0]);
  const first = inside[0];
  const last = inside[inside.length - 1];
  if (!first || !last) return period;
  let longest = first[0] - start + (start + period - last[1]);
  let end = first[1];
  for (const beat of inside.slice(1)) {
    longest = Math.max(longest, beat[0] - end);
    end = Math.max(end, beat[1]);
  }
  return longest;
}

describe("every break, once set (breakScenes)", () => {
  const ball: SoccerTouch = { side: "top", at: { x: 50, y: 34 }, order: 1, period: null, clock: 0 };
  const cases: [string, SoccerEventKind, string][] = [
    ["a man down", { type: "injury" }, "Delay in match because of an injury to A."],
    ["a delay", { type: "delay" }, "Delay in match."],
    ["a VAR check", { type: "varCheck" }, "Delay in match for a VAR check."],
    ["half-time", { type: "halftime" }, ""],
  ];
  for (const [name, kind, text] of cases) {
    it(`soccer, ${name}: holds a quiet loop, never still past about 8 s, and comes back to where it began`, () => {
      const idle = soccerIdle({ event: event(`e-${name}`, kind, text), touch: ball, scene: null, period: 1, lineups: {}, flipped: false });
      const script = soccerIdleScript(idle, false);
      const clip = new PitchClip(script, null, idle, "top");
      const loop = script.loop;
      expect(loop, "holds a quiet loop").not.toBeNull();
      expect(longestStill(script.beats, loop!.start, loop!.period)).toBeLessThanOrEqual(8.2);
      const start = loop!.start;
      const end = loop!.start + loop!.period;
      for (let i = 0; i < clip.figures.length; i++) {
        const a = clip.position(i, end - 0.01);
        const b = clip.position(i, start + 0.01);
        expect(Math.hypot(a.x - b.x, a.y - b.y), `figure ${i}`).toBeLessThan(0.3);
      }
    });
  }

  it("soccer: one spelling (the hero's Half-time)", () => {
    const idle = soccerIdle({ event: event("ht", { type: "halftime" }, ""), touch: ball, scene: null, period: 1, lineups: {}, flipped: false });
    expect(SoccerStatus.idle(idle, 300, { top: "A", bottom: "B", topColor: null, bottomColor: null }, null).tag).toBe("Half-time");
    const extra = soccerIdle({ event: event("ht3", { type: "halftime" }, "", 3), touch: ball, scene: null, period: 3, lineups: {}, flipped: false });
    expect(SoccerStatus.idle(extra, 300, { top: "A", bottom: "B", topColor: null, bottomColor: null }, null).tag).toBe("Half-time, extra time");
  });

  it("at the break the teams go and a couple of the ground staff come out, a quiet of their own", () => {
    const idle = soccerIdle({ event: event("ht", { type: "halftime" }, ""), touch: ball, scene: null, period: 1, lineups: {}, flipped: false });
    const script = soccerIdleScript(idle, false);
    const crew = script.actors.filter((a) => a.team === "staff");
    expect(crew.map((a) => a.name)).toEqual(["groundsman", "groundsman"]);
    const loop = script.loop!;
    expect(script.actors.filter((a) => a.team !== "staff").every((a) => a.opacity(loop.start + 1) < 0.01)).toBe(true);
    expect(crew.every((a) => a.opacity(loop.start + 1) > 0.99)).toBe(true);
  });
});

// The Mac's gate fixture: Villa v City, the first eleven minutes (one goal, corners, a foul and its free kick).
const looks = coreLooks("soccer_eng.1", "401879256");
const first = firstLooks(looks, (j) => (at(j, "items") as JSONValue[] | undefined) ?? []);
const when = new Map(first.map((f) => [at(f.play, "id") as string, f.at]));
const items = first.map((f) => f.play);
const arrivals = soccerArrivals(items, 0, (id) => when.get(id) ?? null);

describe("the core lane's kinds (BroadcastLanes.soccer)", () => {
  it("shots, goals and saves live; located entries live; cards and the half's admin dead", () => {
    const kinds = new Map(items.map((p) => [at(p, "type", "type") as string, soccerKind(p).label]));
    expect(kinds.get("goal")).toBe("shot");
    expect(kinds.get("corner-awarded")).toBe("corner");
    expect(kinds.get("free-kick")).toBe("free kick");
    expect(kinds.get("pass")).toBe("entry");
    expect(kinds.get("kickoff")).toBe("kickoff");
    expect(soccerKind({ type: { type: "halftime" } }).stopsClock).toBe(true);
    expect(soccerKind({ type: { type: "var-decision" } }).announced).toBe(true);
    expect(arrivals.length).toBe(items.length);
  });
});

describe("the running order", () => {
  // As the Mac's bench has it: a core-lane recording has no summary, so no home team, no lineups.
  const facts: PitchFacts = { homeTeamID: null, flipped: false, lineups: {}, atBreak: false };
  const snapshot = { plays: arrivals.map((a) => a.play), pending: [], watermark: Infinity, revision: 1, told: new Set<string>() };
  const plays: TimelinePlay<PitchPlay>[] = PitchPlanner.plays(snapshot, facts);

  it("each moment its replay, each event with a beat its beat, the ball going round only as it changes cell; nothing passed over", () => {
    const s = new PitchSequencer(plays, new Set(), facts);
    s.opening();
    const units = s.units(new Set());
    const moments = plays.filter((p) => p.play.kind === "moment");
    expect(moments.length).toBeGreaterThan(0);
    for (const m of moments) expect(units.some((u) => u.id === m.id && !u.fromWorld && u.lead === 1.2), m.id).toBe(true);
    const events = units.filter((u) => u.scene.kind === "event");
    expect(events.every((u) => u.admin && u.fromWorld)).toBe(true);
    // A touch is told only where the ball moves to another cell (or side, or half).
    const touches = units.filter((u) => u.scene.kind === "touch").map((u) => (u.scene as Extract<PitchPlay, { kind: "touch" }>).touch);
    for (let i = 1; i < touches.length; i++) expect(PitchSequencer.cell(touches[i]!)).not.toBe(PitchSequencer.cell(touches[i - 1]!));
    expect(touches.length).toBeLessThan(plays.filter((p) => p.play.kind === "touch").length);
  });

  it("cached and fresh scenes agree through feed changes: arrivals, removal, insertion, pending promotion (ChoreographyIntegrationTests `recorded`)", () => {
    const cache = new SceneCache(PitchSport);
    const fresh = (s: TimelineSnapshot<RawPlay>) => new SceneCache(PitchSport).read(s, facts);
    const same = (s: TimelineSnapshot<RawPlay>) => expect(JSON.stringify(cache.read(s, facts))).toBe(JSON.stringify(fresh(s)));
    const clock = new DelayClock(60, arrivals[0]!.at);
    let samples = 0;
    let lastCount = -1;
    let last: TimelineSnapshot<RawPlay> | null = null;
    for (const a of arrivals) {
      const current = snapshotAt(arrivals, clock, a.at);
      last = current;
      const count = current.plays.length + current.pending.length;
      if (count < lastCount + 25) continue;
      lastCount = count;
      same(current);
      samples += 1;
    }
    const all = [...last!.plays, ...last!.pending];
    const cut = Math.trunc(all.length / 2);
    const snap = (plays: TimelinePlay<RawPlay>[], pending: TimelinePlay<RawPlay>[] = []): TimelineSnapshot<RawPlay> => ({ plays, pending, watermark: 0, revision: 1, told: new Set() });
    for (const current of [snap(all.slice(0, cut), all.slice(cut)), snap(all), snap(all.filter((_, i) => i !== cut)), snap(all), snap(all.slice(0, cut)), snap([]), snap(all)]) {
      same(current);
      samples += 1;
    }
    expect(samples).toBeGreaterThanOrEqual(7);
    expect(all.length).toBeGreaterThan(100);
  });

  it("the break the status says it is, before ESPN logs it: told once, and not again at the entry", () => {
    const s = new PitchSequencer(plays, new Set(), { ...facts, atBreak: true });
    s.opening();
    const units = s.units(new Set());
    expect(units[units.length - 1]!.id).toBe(PitchSequencer.breakID);
    expect(s.units(new Set([PitchSequencer.breakID])).some((u) => u.id === PitchSequencer.breakID)).toBe(false);
  });

  it("a goal's cue lands on its decisive moment; the ball going round loops its script and is kept, not built again", () => {
    const s = new PitchSequencer(plays, new Set(), facts);
    s.opening();
    const goal = s.units(new Set()).find((u) => u.scene.kind === "moment" && u.scene.scene.outcome === "goal")!;
    expect(goal).toBeDefined();
    const clip = s.clip(goal);
    expect(clip.kind).toBe("moment");
    expect(clip.decisive).toBe(clip.script.impacts.find((i) => i.kind === "net")!.at);
    expect(s.cues(goal, clip, 100)).toEqual([{ at: 100, until: 103, kind: { kind: "scored", play: goal.id }, source: { kind: "known", play: goal.id } }]);
    const idle = s.idle();
    expect(idle.length).toBe(Infinity);
    const loop = idle.script.loop!;
    expect(idle.local(loop.start + loop.period + 1.25)).toBeCloseTo(loop.start + 1.25, 9);
    const misses = PitchIdleClips.misses;
    expect(s.idle()).toBe(idle);
    expect(PitchIdleClips.misses).toBe(misses);
  });
});

describe("the director on the recording", () => {
  // As the Mac's bench runs it (TheaterBenchSports.swift `PitchBench`): no summary, so no home team and no lineups.
  const facts: PitchFacts = { homeTeamID: null, flipped: false, lineups: {}, atBreak: false };
  const from = looks[0]!.at;
  const until = looks[looks.length - 1]!.at + 30;
  // The clock a minute behind (the entries arrive 28–40 s after their wallclocks; the page's sizes itself on them).
  const run = runEngine(PitchSport, facts, arrivals, from, until, 60, MotionLimits.soccer, "soccer 401879256");
  const r = run.report;
  if (process.env.THEATER_BENCH) {
    console.log(
      `${r.label}: frames ${r.frames}, plans ${run.plans}, hard cuts ${r.hardCuts} (${[...r.hardCutReasons].join(", ")}), teleportMax ${r.teleportMax.toFixed(2)}, ` +
        `over the sprint ${(r.speedShare * 100).toFixed(2)}% max +${(r.maxOverspeed * 100).toFixed(0)}%, accel ${(r.accelShare * 100).toFixed(2)}%, rig slip ${r.rigSlipMax.toFixed(2)} mm, ` +
        `decisive p95 ${quantile(r.decisiveErrors.map(Math.abs), 0.95).toFixed(3)} s max ${Math.max(...r.decisiveErrors.map(Math.abs)).toFixed(3)} s, catch-ups ${r.catchUps.length}, ` +
        `idle clips ${PitchIdleClips.hits} kept ${PitchIdleClips.misses} built, plan ms p50 ${quantile(run.planMs, 0.5).toFixed(1)} p99 ${quantile(run.planMs, 0.99).toFixed(1)}, ` +
        `overspeed by cause ${[...r.maxOverspeedBySource].map(([k, v]) => `${k} +${(v * 100).toFixed(0)}%`).join(", ")}\n${r.jumpLog.join("\n")}`,
    );
  }

  it("plans and tells every moment that came in, each on its anchor (the declared catch-ups apart)", () => {
    expect(run.plans).toBeGreaterThan(3);
    const moments = items.filter((p) => isMoment(p)).map((p) => at(p, "id") as string);
    expect(moments.length).toBeGreaterThan(1);
    expect([...run.decisive.keys()].sort()).toEqual([...moments].sort());
    const abs = r.decisiveErrors.map(Math.abs);
    expect(Math.max(0, ...abs), `max ${Math.max(0, ...abs)}`).toBeLessThanOrEqual(0.25);
  });

  it("the painter: the clip in charge's men where the engine has them, posed on its stride; the others in their own side's kit; the ball the world's", () => {
    const chain = run.chain;
    const scratch = new FrameScratch();
    let drawnFrames = 0;
    const T0 = chain.plans[0]!.start;
    for (let T = T0; T < T0 + 25; T += 0.25) {
      chain.sample(T, scratch);
      const drawn = pitchFrame(chain, scratch, { width: 540, height: 270 });
      if (!drawn) continue;
      drawnFrames += 1;
      const placement = chain.plans[scratch.plan]!.plan.placements[drawn.placement]!;
      for (const [figure, w] of drawn.world.figures) {
        expect(placement.cast[figure]).toBe(w.index);
        const a = [...scratch.actors.slice(0, scratch.count)].find((x) => x.id === w.index)!;
        expect(w.at).toEqual({ x: a.x, y: a.y });
        expect(Number.isFinite(w.heading) && Number.isFinite(w.body.hip.z)).toBe(true);
      }
      for (const e of drawn.world.extras) expect(["attacking", "defending", "official", "staff"]).toContain(e.team);
      expect(drawn.world.figures.size + drawn.world.extras.length).toBe(scratch.count);
      if (scratch.ballKind === "none") expect(drawn.world.ball).toBeNull();
    }
    expect(drawnFrames).toBeGreaterThan(50);
  });

  it("the gates: no hard cuts, nobody outruns his legs for long, the planted foot holds", () => {
    expect(r.hardCuts, [...r.hardCutReasons].join(", ") + r.jumpLog.join("\n")).toBe(0);
    expect(r.teleportMax, "teleportMax holds its ratchet (2.90; gate 1.15)").toBeLessThanOrEqual(2.9);
    expect(r.speedShare, "at most 0.5% of the time over the sprint").toBeLessThanOrEqual(0.005);
    expect(r.maxOverspeed, "overspeed holds its ratchet (+220%; gate +12%)").toBeLessThanOrEqual(2.2);
    expect(r.accelShare, "at most 1% of the time over the push limits").toBeLessThanOrEqual(0.01);
    expect(r.rigSlipMax, "the rig's planted foot doesn't slip").toBeLessThanOrEqual(0.5);
  });
});
