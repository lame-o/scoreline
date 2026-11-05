/**
 * The engine on a bench (TheaterBenchEngine.swift's `EngineRun`, its
 * session loop): a timeline's plays arriving on a virtual clock, the theater
 * session run exactly as the page's director runs it (plans made and baked at
 * each change, spliced in on the theater's time, the horizon's wake), sampled
 * every 1/60 s of wall time into the continuity meter. The timeline here is
 * the recording's plays as they arrived; the broadcast's own timeline and
 * clock take over the arrivals once they're on the web.
 */
import { RigTrack } from "../../src/data/theater/rig";
import type { TheaterClip } from "../../src/data/theater/theaterClips";
import { TheaterSession, type TheaterSport } from "../../src/data/theater/theaterDirector";
import { MotionLimits, type PTime } from "../../src/data/theater/theaterEngine";
import { FrameScratch } from "../../src/data/theater/theaterFrameScratch";
import type { PlanChain } from "../../src/data/theater/theaterPlanChain";
import { DelayClock, snapshotAt, type Arrival } from "../../src/data/theater/replayTimeline";
import { ContinuityMeter, type ContinuityReport, type MeterFigure } from "./theaterBenchMeter";

export { DelayClock, type Arrival };

export interface RunResult<Clip extends TheaterClip> {
  readonly report: ContinuityReport;
  readonly plans: number;
  readonly chain: PlanChain<Clip>;
  /** Each told play's decisive moment as drawn, against its anchor on p (seconds late). */
  readonly errors: Map<string, number>;
  readonly slipped: Set<string>;
  readonly decisive: Map<string, PTime>;
  readonly planMs: number[];
}

/**
 * Runs `sport` over the arrivals from `from` to `until` (wall seconds) with a
 * clock `delay` behind: the plays that arrived before `from` are the page's
 * history; the rest come in as they arrived. `bands`: each figure's motion
 * band by his clip figure's band name.
 */
export function runEngine<Clip extends TheaterClip, Play, Facts>(
  sport: TheaterSport<Clip, Play, Facts>,
  facts: Facts,
  arrivals: readonly Arrival[],
  from: PTime,
  until: PTime,
  delay: number,
  limits: MotionLimits,
  label: string,
  trace: ((line: string) => void) | null = null,
  /**
   * `ahead`: how far the timeline's watermark runs ahead of p (snapshotAt).
   * `rereads`: as the page does (and the Mac's bench), the snapshot is read
   * again as the watermark moves, not only when a play arrives: a sport that
   * plans from the plays up to the watermark alone (football) learns of each
   * as it crosses.
   */
  { ahead = 4, rereads = false }: { ahead?: number; rereads?: boolean } = {},
): RunResult<Clip> {
  const session = new TheaterSession(sport, facts);
  const clock = new DelayClock(delay, from);
  session.clockDidUpdate(clock, clock.events, from);
  const meter = new ContinuityMeter(label);
  const scratch = new FrameScratch();
  let plans = 0;
  const planMs: number[] = [];
  const slipped = new Set<string>();
  const errors = new Map<string, number>();
  const decisive = new Map<string, PTime>();
  const snapshot = (now: PTime) => snapshotAt(arrivals, clock, now, ahead);
  const replan = (now: PTime) => {
    const request = session.request(now);
    if (!request) return;
    const began = performance.now();
    const made = TheaterSession.make(sport, request);
    planMs.push(performance.now() - began);
    if (!session.accept(made, now)) return;
    plans += 1;
    for (const p of made.baked.plan.placements) {
      if (p.start < made.baked.start - 1e-9 || p.play == null || p.anchor == null || p.clip.decisive == null) continue;
      decisive.set(p.play, p.offset + p.clip.decisive);
      if (p.slip > 1e-3) slipped.add(p.play);
      else slipped.delete(p.play);
    }
  };
  let arrived = arrivals.filter((a) => a.at <= from).length;
  session.timelineDidChange(snapshot(from));
  replan(from);
  let lastT = -Infinity;
  const lastFigures = new Map<number, MeterFigure>();
  const lastStep = new Map<number, number>();
  let lastFrameT = -Infinity;
  for (let w = from; w <= until; w += 1 / 60) {
    const now = arrivals.filter((a) => a.at <= w).length;
    if (now !== arrived) {
      arrived = now;
      if (session.timelineDidChange(snapshot(w))) replan(w);
    } else if (rereads) {
      if (session.timelineDidChange(snapshot(w))) replan(w);
    }
    const T = session.theaterTime(w);
    if (T == null) continue;
    const last = session.chain.plans[session.chain.plans.length - 1];
    if (last && T > last.horizon - 15) replan(w);
    const chain = session.chain;
    chain.sample(T, scratch);
    // Each decisive moment as it's drawn, against its anchor on p.
    const plan = chain.plan(T)?.plan;
    if (plan) {
      for (const p of plan.placements) {
        if (p.play == null || p.anchor == null || p.clip.decisive == null || errors.has(p.play)) continue;
        const at = p.offset + p.clip.decisive;
        if (at > lastT && at <= T) errors.set(p.play, clock.p(w - (T - at)) - p.anchor);
      }
    }
    lastT = T;
    if (scratch.plan < 0) continue;
    const baked = chain.plans[scratch.plan]!;
    const figures: MeterFigure[] = [];
    for (let i = 0; i < scratch.count; i++) {
      const a = scratch.actors[i]!;
      const track = baked.tracks[a.track]!;
      const rig: RigTrack = track.rig;
      const m = a.motion;
      const planted = rig.planted(T);
      const feet = rig.feet(T, { x: a.x, y: a.y }, m.heading, 1, m.speed, { left: { x: 0, y: 0.1, z: 0 }, right: { x: 0, y: -0.1, z: 0 } });
      const world = (v: { x: number; y: number }) => ({ x: a.x + v.x * Math.cos(m.heading) - v.y * Math.sin(m.heading), y: a.y + v.x * Math.sin(m.heading) + v.y * Math.cos(m.heading) });
      const placement = baked.plan.placements[a.placement]!;
      const join = placement.join.get(a.id);
      figures.push({
        key: a.id,
        position: { x: a.x, y: a.y },
        heading: m.heading,
        band: limits.band(track.figure.band),
        weight: m.weight,
        height: track.figure.height,
        opacity: a.opacity,
        planted,
        rigFeet: { left: world(feet.left), right: world(feet.right) },
        source: join != null && T < join ? "travel" : placement.play == null ? "rest" : "clip",
      });
    }
    if (trace) {
      for (const f of figures) {
        const q = lastFigures.get(f.key);
        if (!q) continue;
        const d = Math.hypot(f.position.x - q.position.x, f.position.y - q.position.y);
        const was = lastStep.get(f.key) ?? 0;
        if (d > (1.5 * f.band.sprint * 1.12) / 60 && d > 2.5 * Math.max(was, (f.band.sprint / 60) * 0.25)) {
          trace(`jump T=${T.toFixed(3)} actor ${f.key} d=${d.toFixed(2)} was ${was.toFixed(2)} ${describe(chain, f.key, T)} | before: ${describe(chain, f.key, lastFrameT)}`);
        }
      }
      lastStep.clear();
      for (const f of figures) {
        const q = lastFigures.get(f.key);
        if (q) lastStep.set(f.key, Math.hypot(f.position.x - q.position.x, f.position.y - q.position.y));
      }
      lastFigures.clear();
      for (const f of figures) lastFigures.set(f.key, f);
      lastFrameT = T;
    }
    meter.add({ t: T, figures, camera: { ...scratch.camera }, change: "same", reason: splicing(chain, T) ? "at a splice" : "inside a clip" });
  }
  const report = meter.report;
  report.decisiveErrors = [...errors].filter(([id]) => !slipped.has(id)).map(([, e]) => e);
  report.catchUps = [...errors].filter(([id]) => slipped.has(id)).map(([, e]) => e);
  return { report, plans, chain: session.chain, errors, slipped, decisive, planMs };
}

/** Whether T is at a hand-off (a splice's start, a man joining a clip): a jump there is a splice cut, elsewhere a step inside a clip. */
export function splicing<Clip extends TheaterClip>(chain: PlanChain<Clip>, T: PTime): boolean {
  const plan = chain.plan(T)?.plan;
  if (!plan) return false;
  const near = 2.5 / 60;
  return (
    plan.placements.some((p) => Math.abs(p.start - T) < near || [...p.join.values()].some((j) => Math.abs(j - T) < near) || Math.abs(p.offset - T) < near) ||
    Math.abs(plan.start - T) < near
  );
}

/** Where a man is in the plan at T: which placement moves him, and how (EngineRun.describe). */
export function describe<Clip extends TheaterClip>(chain: PlanChain<Clip>, id: number, T: PTime): string {
  const baked = chain.plan(T);
  if (!baked) return "no plan";
  const plan = baked.plan;
  const k = plan.placement(T);
  if (k == null) return "no placement";
  const p = plan.placements[k]!;
  let s = `plan@${baked.start.toFixed(2)} k=${k}/${plan.placements.length} ${p.play ?? "rest"} ${(p.clip as unknown as { kind?: string }).kind ?? ""} start=${(p.start - T).toFixed(2)} offset=${(p.offset - T).toFixed(2)}`;
  const i = p.figure(id);
  if (i >= 0) {
    s += ` fig ${i}`;
    const j = p.join.get(id);
    if (j != null) s += ` join=${(j - T).toFixed(2)}${p.travel.has(id) ? "" : " (no travel)"}`;
  } else if (p.leaving.includes(id)) s += " leaving";
  else s += " absent";
  return s;
}

export { MotionLimits };
