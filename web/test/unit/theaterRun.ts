/**
 * The engine on a bench (TheaterBenchEngine.swift's `EngineRun`): the theater
 * session run exactly as the page's director runs it (plans made and baked at
 * each change, spliced in on the theater's time, the horizon's wake), sampled
 * every 1/60 s of wall time into the continuity meter.
 *
 * `runReplay` is the Mac's bench: a recording through the real lanes, the
 * timeline and the presentation clock (broadcastReplay.ts `RecordingReplay`),
 * the director handing back its anchors as the page does. `runEngine` is the
 * same session on a recording's plays as they arrived and a clock a fixed
 * delay behind (`DelayClock`), for the checks that want a still clock.
 */
import { policy as lanePolicy } from "../../src/data/broadcast/lanes";
import { bindingHorizons, isEmptyChange } from "../../src/data/broadcast/timeline";
import { RigTrack } from "../../src/data/theater/rig";
import type { TheaterClip } from "../../src/data/theater/theaterClips";
import { TheaterSession, type TheaterSport } from "../../src/data/theater/theaterDirector";
import { MotionLimits, type PTime } from "../../src/data/theater/theaterEngine";
import { FrameScratch } from "../../src/data/theater/theaterFrameScratch";
import type { BakedPlan, PlanChain } from "../../src/data/theater/theaterPlanChain";
import { DelayClock, snapshotAt, type Arrival } from "../../src/data/theater/replayTimeline";
import { appCadence, RecordingReplay, type Recording } from "./broadcastReplay";
import { ContinuityMeter, type ContinuityReport, type MeterChange, type MeterFigure } from "./theaterBenchMeter";

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
  /** FNV-1a over every baked track, camera sample and cue (EngineRun.mix): two runs must agree. */
  readonly hash: number;
}

type FrameHook<Clip extends TheaterClip> = (T: PTime, chain: PlanChain<Clip>, scratch: FrameScratch) => void;

/** The session, its plans and its frames into the meter: EngineRun.run's `replan` and `frames(through:)`. */
class EngineLoop<Clip extends TheaterClip, Play, Facts, Context> {
  readonly session: TheaterSession<Clip, Play, Facts, Context>;
  readonly meter: ContinuityMeter;
  readonly scratch = new FrameScratch();
  plans = 0;
  hash = 0x811c9dc5;
  readonly planMs: number[] = [];
  readonly slipped = new Set<string>();
  readonly errors = new Map<string, number>();
  readonly decisive = new Map<string, PTime>();
  /** The wall time of the last frame sampled (null: none yet). */
  lastWall: PTime | null = null;
  private declaredUntil = -Infinity;
  private lastT = -Infinity;
  private readonly lastFigures = new Map<number, MeterFigure>();
  private readonly lastStep = new Map<number, number>();

  constructor(
    readonly sport: TheaterSport<Clip, Play, Facts, Context>,
    facts: Facts,
    readonly limits: MotionLimits,
    label: string,
    private readonly trace: ((line: string) => void) | null,
    private readonly frame: FrameHook<Clip> | null,
  ) {
    this.session = new TheaterSession(sport, facts);
    this.meter = new ContinuityMeter(label);
  }

  replan(now: PTime): void {
    const request = this.session.request(now);
    if (!request) return;
    const began = performance.now();
    const made = TheaterSession.make(this.sport, request);
    this.planMs.push(performance.now() - began);
    if (!this.session.accept(made, now)) return;
    this.plans += 1;
    this.hash = mixBaked(this.hash, made.baked);
    if (made.baked.plan.declared) this.declaredUntil = made.baked.start + 0.25;
    for (const p of made.baked.plan.placements) {
      if (p.start < made.baked.start - 1e-9 || p.play == null || p.anchor == null || p.clip.decisive == null) continue;
      this.decisive.set(p.play, p.offset + p.clip.decisive);
      if (p.slip > 1e-3) this.slipped.add(p.play);
      else this.slipped.delete(p.play);
    }
  }

  /** Every 1/60 s from the last frame through `t`. */
  frames(t: PTime): void {
    if (this.lastWall == null) return;
    let w = this.lastWall;
    while (w + 1 / 60 <= t + 1e-9) {
      w += 1 / 60;
      this.frameAt(w);
    }
    this.lastWall = w;
  }

  /** One frame at wall time `w`. */
  frameAt(w: PTime): void {
    const { session, scratch, limits, trace } = this;
    const T = session.theaterTime(w);
    if (T == null) return;
    // The plan running out (nothing new for a while): the director's one wake.
    const last = session.chain.plans[session.chain.plans.length - 1];
    if (last && T > last.horizon - 15) this.replan(w);
    const chain = session.chain;
    chain.sample(T, scratch);
    this.frame?.(T, chain, scratch);
    let change: MeterChange = "same";
    if (T <= this.declaredUntil) change = "declared";
    // The theater's time itself jumped (a declared jump or a wake: T moves with p): a declared cut, not a glide.
    if (Number.isFinite(this.lastT) && T - this.lastT > 2 / 60) change = "declared";
    // Each decisive moment as it's drawn, against its anchor on p (the clock the theater ran on then).
    const plan = chain.plan(T)?.plan;
    if (plan) {
      for (const p of plan.placements) {
        if (p.play == null || p.anchor == null || p.clip.decisive == null || this.errors.has(p.play)) continue;
        const at = p.offset + p.clip.decisive;
        if (at > this.lastT && at <= T) {
          const pAt = session.presentation(w - (T - at));
          if (pAt != null) this.errors.set(p.play, pAt - p.anchor);
        }
      }
    }
    const lastT = this.lastT;
    this.lastT = T;
    if (scratch.plan < 0) return;
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
        const q = this.lastFigures.get(f.key);
        if (!q) continue;
        const d = Math.hypot(f.position.x - q.position.x, f.position.y - q.position.y);
        const was = this.lastStep.get(f.key) ?? 0;
        if (d > (1.5 * f.band.sprint * 1.12) / 60 && d > 2.5 * Math.max(was, (f.band.sprint / 60) * 0.25)) {
          trace(`jump T=${T.toFixed(3)} actor ${f.key} d=${d.toFixed(2)} was ${was.toFixed(2)} ${describe(chain, f.key, T)} | before: ${describe(chain, f.key, lastT)}`);
        }
      }
      this.lastStep.clear();
      for (const f of figures) {
        const q = this.lastFigures.get(f.key);
        if (q) this.lastStep.set(f.key, Math.hypot(f.position.x - q.position.x, f.position.y - q.position.y));
      }
      this.lastFigures.clear();
      for (const f of figures) this.lastFigures.set(f.key, f);
    }
    this.meter.add({ t: T, figures, camera: { ...scratch.camera }, change, reason: splicing(chain, T) ? "at a splice" : "inside a clip" });
  }

  result(): RunResult<Clip> {
    const report = this.meter.report;
    report.decisiveErrors = [...this.errors].filter(([id]) => !this.slipped.has(id)).map(([, e]) => e);
    report.catchUps = [...this.errors].filter(([id]) => this.slipped.has(id)).map(([, e]) => e);
    const { plans, errors, slipped, decisive, planMs, hash } = this;
    return { report, plans, chain: this.session.chain, errors, slipped, decisive, planMs, hash };
  }
}

/**
 * Runs `sport` over the arrivals from `from` to `until` (wall seconds) with a
 * clock `delay` behind: the plays that arrived before `from` are the page's
 * history; the rest come in as they arrived.
 */
export function runEngine<Clip extends TheaterClip, Play, Facts, Context = number>(
  sport: TheaterSport<Clip, Play, Facts, Context>,
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
   * `rereads`: the snapshot is read again as the watermark moves, not only
   * when a play arrives: a sport that plans from the plays up to the
   * watermark alone (football) learns of each as it crosses. `frame`: called
   * with each sampled frame (EngineRun's `frame`: the painter's checks).
   */
  { ahead = 4, rereads = false, frame = null }: { ahead?: number; rereads?: boolean; frame?: FrameHook<Clip> | null } = {},
): RunResult<Clip> {
  const loop = new EngineLoop(sport, facts, limits, label, trace, frame);
  const { session } = loop;
  const clock = new DelayClock(delay, from);
  session.clockDidUpdate(clock, clock.events, from);
  const snapshot = (now: PTime) => snapshotAt(arrivals, clock, now, ahead);
  let arrived = arrivals.filter((a) => a.at <= from).length;
  session.timelineDidChange(snapshot(from));
  loop.replan(from);
  for (let w = from; w <= until; w += 1 / 60) {
    const now = arrivals.filter((a) => a.at <= w).length;
    if (now !== arrived) {
      arrived = now;
      if (session.timelineDidChange(snapshot(w))) loop.replan(w);
    } else if (rereads) {
      if (session.timelineDidChange(snapshot(w))) loop.replan(w);
    }
    loop.frameAt(w);
  }
  return loop.result();
}

/** Two maps the same (Swift's `==` on dictionaries). */
function sameMap<V>(a: ReadonlyMap<string, V>, b: ReadonlyMap<string, V>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (!b.has(k) || b.get(k) !== v) return false;
  return true;
}

/**
 * The Mac's bench (EngineRun.run): `recording` through the real lanes, the
 * timeline and the presentation clock at the app's cadence, the page's
 * binding horizons the sport's; at each change of the timeline's revision
 * the director gets the snapshot, and a change to the plays as a plan reads
 * them, or to the clock, re-plans; the anchors go back to the timeline as
 * the page hands them. Frames every 1/60 s through 30 s past the last input.
 * Null: a recording the lanes can't read.
 */
export function runReplay<Clip extends TheaterClip, Play, Facts, Context = number>(
  sport: TheaterSport<Clip, Play, Facts, Context>,
  facts: Facts,
  recording: Recording,
  limits: MotionLimits,
  label: string,
  { trace = null, frame = null, start, end }: { trace?: ((line: string) => void) | null; frame?: FrameHook<Clip> | null; start?: PTime; end?: PTime } = {},
): RunResult<Clip> | null {
  const kind = recording.sport;
  if (!kind) return null;
  // The page hands the timeline the theater's binding horizons (late binding): the replay starts with them.
  const base = lanePolicy(kind, recording.path);
  const replay = RecordingReplay.make(recording, { ...base, horizons: bindingHorizons(base.horizons.live, sport.horizons) });
  if (!replay) return null;
  const loop = new EngineLoop(sport, facts, limits, label, trace, frame);
  const { session } = loop;
  let seenRevision: number | null = null;
  let published: ReadonlyMap<string, PTime> = new Map();
  let publishedLeads: ReadonlyMap<string, number> = new Map();
  replay.run(
    appCadence(replay.policy),
    (replay, t, step, change) => {
      const engine = replay.engine;
      if (!engine.started) return;
      loop.frames(t);
      // A copy, as the Mac's struct is and the page publishes (broadcast.ts): the engine re-plans its own clock in
      // place, and the session's T must run the frames up to t on the pieces that ran (a slew), not the next plan's.
      const clockChanged = session.clockDidUpdate(engine.clock.clone(), step.events, t);
      // As the page does: at every change of the timeline's revision (an ingest, a tell, new anchors), the director
      // gets the snapshot; only a change to the plays as a plan reads them re-plans.
      let data = false;
      if (seenRevision !== engine.timeline.revision || (change != null && !isEmptyChange(change))) {
        seenRevision = engine.timeline.revision;
        data = session.timelineDidChange(engine.snapshot(t));
      }
      if (data || clockChanged || session.chain.isEmpty) loop.replan(t);
      // One truth on p, as the page has it: the timeline presents each play where the theater's plan puts it.
      const anchors = session.anchors(t);
      const leads = session.leadIns;
      if (!sameMap(anchors, published) || !sameMap(leads, publishedLeads)) {
        published = anchors;
        publishedLeads = leads;
        replay.setAnchors(anchors, leads);
      }
      if (loop.lastWall == null) loop.lastWall = t;
    },
    start,
    end,
  );
  if (loop.lastWall != null) loop.frames(loop.lastWall + 30);
  return loop.result();
}

const bits = new Uint32Array(new Float64Array(1).buffer);
const F64 = new Float64Array(bits.buffer);

/** One 32-bit word into a running FNV-1a. */
function mixWord(hash: number, word: number): number {
  let h = hash;
  for (let k = 0; k < 4; k++) {
    h ^= (word >>> (8 * k)) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Every baked number into the determinism hash (EngineRun.mix). */
export function mixBaked<Clip extends TheaterClip>(hash: number, baked: BakedPlan<Clip>): number {
  let h = hash;
  const f64 = (x: number) => {
    F64[0] = x;
    h = mixWord(h, bits[0]!);
    h = mixWord(h, bits[1]!);
  };
  const f32s = (xs: Float32Array) => {
    const words = new Uint32Array(xs.buffer, xs.byteOffset, xs.length);
    for (const w of words) h = mixWord(h, w);
  };
  f64(baked.start);
  f64(baked.horizon);
  for (const track of baked.tracks) {
    h = mixWord(h, track.id);
    f32s(track.xy);
    f32s(track.opacity);
    f32s(track.rig.heading);
    f32s(track.rig.phase);
    for (const s of [...track.rig.left, ...track.rig.right]) {
      f64(s.land);
      f64(s.at.x);
      f64(s.at.y);
    }
  }
  f32s(baked.camera);
  for (const cue of baked.plan.cues) f64(cue.at);
  return h;
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
