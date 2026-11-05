/**
 * The game as one broadcast, part 12: plans, the bake and the chain
 * (TheaterPlanChain.swift; CHOREOGRAPHY §4.2, §4.5, §8.2).
 *
 * A plan is what happens from a splice on: clips placed on p, how the world
 * gets to each, the cues. It's baked once into dense tracks: every man's
 * position and presence every 1/60 s, his stride (RigTrack, carried on from
 * the plan before), which clip poses him and when the next takes over, the
 * ball, the camera's state, and the frame tiers. A frame only samples: a
 * cached index, a lerp, a binary search; nothing allocates. The chain holds
 * the plans spliced end to end; each new one starts exactly from the state the
 * one before had at its splice.
 */
import type { FieldPoint, Point } from "../mlb/theaterField";
import { RigTrack, type RigFacing } from "./rig";
import { CAMERA_TUNING, CameraOperator, YawRule, type CameraTuning, type YawTarget } from "./theaterCamera";
import { clipFlying, finish, type BallFlight, type ClipFigure, type ClipPlacement, type TheaterClip } from "./theaterClips";
import {
  remainder,
  TheaterCurve,
  TheaterTiming,
  v2,
  vec4,
  WorldState,
  ZERO2,
  type ActorID,
  type ActorState,
  type BallState,
  type CameraState,
  type Cue,
  type PlanNote,
  type PTime,
  type Vec4,
} from "./theaterEngine";
import type { FrameScratch } from "./theaterFrameScratch";

/** A man's motion at an instant in a plan: where, how fast, and how present. */
export interface PlanMotion {
  readonly position: Point;
  readonly velocity: Point;
  readonly acceleration: Point;
  readonly opacity: number;
}

/** A plan (Phase 0): clips placed on p from a splice. */
export class Plan<Clip extends TheaterClip> {
  /** Each man's path just behind the splice (oldest first, 1/60 s apart): his stride's smoothing reads it. */
  history = new Map<ActorID, Point[]>();
  cues: Cue[] = [];
  notes: PlanNote[] = [];
  /** The camera's yaw: the rule (basketball's ball end), the target at the splice and since when. */
  yawRule: YawRule | null = null;
  yaw: { target: number; since: PTime } | null = null;
  /** The camera at an opening (no state): where it starts. */
  openingCamera: Vec4 | null = null;
  /** Opening, waking, a Jmax catch-up: the frame fades in over 0.25 s (the only discontinuity). */
  declared = false;
  /** Plays told by placements this plan no longer carries. */
  toldBefore = new Set<string>();
  /** Where each play this plan tells is presented on p (its decisive moment): the timeline presents it there too. */
  published = new Map<string, PTime>();
  /** Each placed play's decisive moment on the theater's time (the director maps it to p through the clock). */
  decisive = new Map<string, PTime>();
  /** The timeline's plays this plan was made from: one it hasn't seen waits for the next plan's anchor, never told by the timeline's fallback first. */
  known = new Set<string>();
  /** Plays past the hold, left for the plan after it (the timeline waits for their anchors too). */
  deferred = new Set<string>();
  /** How many of its first placements it carried on from the plan before (what's on screen at its splice). */
  kept = 0;

  constructor(
    readonly revision: number,
    /** The splice: where it takes over from the plan before. */
    readonly start: PTime,
    public horizon: PTime,
    /** The world at `start` (null: opening, a declared jump). */
    readonly state: WorldState | null,
    public placements: ClipPlacement<Clip>[],
    /** Who every man is (the splice matches by it). */
    public actors: Map<ActorID, ClipFigure>,
  ) {}

  placement(t: PTime): number | null {
    const first = this.placements[0];
    if (!first) return null;
    if (t < first.start) return 0;
    for (let i = this.placements.length - 1; i >= 0; i--) if (this.placements[i]!.start <= t) return i;
    return null;
  }

  /** Where the man is at t, how fast, and how present; null before he's on and after he's gone. */
  motion(id: ActorID, t: PTime): PlanMotion | null {
    const k = this.placement(t);
    if (k == null) return null;
    const p = this.placements[k]!;
    const i = p.figure(id);
    if (i >= 0) {
      const path = p.travel.get(id);
      const join = p.join.get(id);
      if (path && join != null && t < join) {
        const o = p.clip.opacity(i, Math.max(p.time(t), 0));
        return { position: path.position(t), velocity: path.velocity(t), acceleration: path.acceleration(t), opacity: o };
      }
      const local = p.time(t);
      const clamped = Math.min(Math.max(local, 0), p.clip.length);
      // At its very last moment a clip can still have a man on his way: the next one carries on from that.
      const moving = local > 0 && local <= p.clip.length + 1e-6;
      const measured = Math.min(clamped, p.clip.length - 1 / 120);
      // A man entering fades in where the clip has him.
      const enters = p.entering.includes(id) ? Math.min(Math.max((t - p.start) / 0.4, 0), 1) : 1;
      return {
        position: p.clip.position(i, clamped),
        velocity: moving ? velocityOf(p.clip, i, measured) : ZERO2,
        acceleration: moving ? accelerationOf(p.clip, i, measured) : ZERO2,
        opacity: p.clip.opacity(i, clamped) * enters,
      };
    }
    if (p.leaving.includes(id)) {
      // He stands where the splice found him and fades.
      const here = this.standing(id, p.start, k);
      if (!here) return null;
      const fade = 1 - Math.min(Math.max((t - p.start) / 0.4, 0), 1);
      return fade > 0 ? { position: here, velocity: ZERO2, acceleration: ZERO2, opacity: fade * (this.state?.actor(id)?.opacity ?? 1) } : null;
    }
    return null;
  }

  /** Where a man is at `t` and how much of him shows (the bake's read: no derivatives). */
  sample(id: ActorID, t: PTime): { position: Point; opacity: number } | null {
    const k = this.placement(t);
    if (k == null) return null;
    const p = this.placements[k]!;
    const i = p.figure(id);
    if (i >= 0) {
      const path = p.travel.get(id);
      const join = p.join.get(id);
      if (path && join != null && t < join) return { position: path.position(t), opacity: p.clip.opacity(i, Math.max(p.time(t), 0)) };
      const clamped = Math.min(Math.max(p.time(t), 0), p.clip.length);
      const enters = p.entering.includes(id) ? Math.min(Math.max((t - p.start) / 0.4, 0), 1) : 1;
      return { position: p.clip.position(i, clamped), opacity: p.clip.opacity(i, clamped) * enters };
    }
    if (p.leaving.includes(id)) {
      const here = this.standing(id, p.start, k);
      if (!here) return null;
      const fade = 1 - Math.min(Math.max((t - p.start) / 0.4, 0), 1);
      return fade > 0 ? { position: here, opacity: fade * (this.state?.actor(id)?.opacity ?? 1) } : null;
    }
    return null;
  }

  /** Where a man stood at `t` in the placements before `k` (or the splice's state). */
  standing(id: ActorID, t: PTime, k: number): Point | null {
    for (let j = k - 1; j >= 0; j--) {
      const p = this.placements[j]!;
      const i = p.figure(id);
      if (i >= 0) {
        const path = p.travel.get(id);
        const join = p.join.get(id);
        if (path && join != null && t < join) return path.position(t);
        return p.clip.position(i, Math.min(Math.max(p.time(t), 0), p.clip.length));
      }
      if (p.leaving.includes(id)) break;
    }
    return this.state?.actor(id)?.position ?? null;
  }

  /** Every man the plan has, sorted. */
  get everyone(): ActorID[] {
    return [...this.actors.keys()].sort((a, b) => a - b);
  }
}

function velocityOf(clip: TheaterClip, i: number, t: number): Point {
  const h = 1 / 240;
  const a = clip.position(i, t + h);
  const b = clip.position(i, t - h);
  return v2((a.x - b.x) / (2 * h), (a.y - b.y) / (2 * h));
}

function accelerationOf(clip: TheaterClip, i: number, t: number): Point {
  const h = 1 / 120;
  const a = clip.position(i, t + h);
  const b = clip.position(i, t);
  const c = clip.position(i, t - h);
  return v2((a.x - 2 * b.x + c.x) / (h * h), (a.y - 2 * b.y + c.y) / (h * h));
}

/** Who poses a man from when: a clip figure; while he travels to it, blended from the one before. */
export interface PoseSpan {
  readonly from: PTime;
  readonly placement: number;
  readonly figure: number;
  /** The clip he leaves (−1: none), blended out by `blendUntil`. */
  readonly previousPlacement: number;
  readonly previousFigure: number;
  readonly blendUntil: PTime;
}

/** One man through a baked plan. */
export class ActorTrack {
  constructor(
    readonly id: ActorID,
    readonly figure: ClipFigure,
    readonly start: PTime,
    /** x, y every 1/60 s from `start`, in Float as Swift's `SIMD2<Float>` are. */
    readonly xy: Float32Array,
    readonly opacity: Float32Array,
    readonly rig: RigTrack,
    readonly poses: readonly PoseSpan[],
  ) {}

  get count(): number {
    return this.opacity.length;
  }

  /** Where he is at t, into `out` (the sampler's read: no allocation). */
  positionInto(t: PTime, out: { x: number; y: number }): void {
    const n = this.count;
    if (n <= 1) {
      out.x = n === 1 ? this.xy[0]! : 0;
      out.y = n === 1 ? this.xy[1]! : 0;
      return;
    }
    const x = Math.max((t - this.start) * TheaterTiming.rate, 0);
    const i = Math.min(Math.floor(x), n - 2);
    const u = Math.fround(Math.min(x - i, 1));
    const f = Math.fround;
    const ax = this.xy[2 * i]!;
    const ay = this.xy[2 * i + 1]!;
    out.x = f(ax + f(f(this.xy[2 * i + 2]! - ax) * u));
    out.y = f(ay + f(f(this.xy[2 * i + 3]! - ay) * u));
  }

  position(t: PTime): Point {
    const out = { x: 0, y: 0 };
    this.positionInto(t, out);
    return out;
  }

  presence(t: PTime): number {
    const n = this.count;
    if (n <= 1) return this.opacity[0] ?? 0;
    const x = Math.max((t - this.start) * TheaterTiming.rate, 0);
    const i = Math.min(Math.floor(x), n - 2);
    const u = Math.fround(Math.min(x - i, 1));
    const f = Math.fround;
    return f(this.opacity[i]! + f(f(this.opacity[i + 1]! - this.opacity[i]!) * u));
  }

  pose(t: PTime): PoseSpan | null {
    const poses = this.poses;
    if (poses.length === 0) return null;
    if (!(t >= poses[0]!.from)) return poses[0]!;
    let lo = 0;
    let hi = poses.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (poses[mid]!.from <= t) lo = mid;
      else hi = mid - 1;
    }
    return poses[lo]!;
  }
}

/** The ball through a baked plan: in a clip, in a man's hands across a splice, or passed between them. */
export type BallSpan =
  | { readonly kind: "clip"; readonly placement: number; readonly from: PTime }
  | { readonly kind: "held"; readonly actor: ActorID; readonly from: PTime }
  | { readonly kind: "flight"; readonly flight: BallFlight; readonly from: PTime };

/** A run of frames (§5.6.7): at the display's rate while anything on screen moves, none while nothing does. */
export interface FrameTier {
  from: PTime;
  until: PTime;
  readonly moves: boolean;
}

export class BakedPlan<Clip extends TheaterClip> {
  constructor(
    readonly plan: Plan<Clip>,
    /** Sorted by id. */
    readonly tracks: readonly ActorTrack[],
    /** The camera operator's state every 1/60 s from `plan.start`: x, y, log span, yaw (four floats a sample); and its velocity. */
    readonly camera: Float32Array,
    readonly cameraVelocity: Float32Array,
    readonly ball: readonly BallSpan[],
    readonly tiers: readonly FrameTier[],
    /** The yaw's targets (changes and when), carried to the next plan. */
    readonly yawTargets: readonly YawTarget[],
  ) {}

  get start(): PTime {
    return this.plan.start;
  }

  get horizon(): PTime {
    return this.plan.horizon;
  }

  track(id: ActorID): ActorTrack | null {
    let lo = 0;
    let hi = this.tracks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.tracks[mid]!.id < id) lo = mid + 1;
      else hi = mid;
    }
    const t = this.tracks[lo];
    return t && t.id === id ? t : null;
  }

  /** The camera at t into `out`: x, y, log span, yaw (no allocation). */
  cameraInto(t: PTime, out: { x: number; y: number; z: number; w: number }): void {
    const c = this.camera;
    const n = c.length / 4;
    if (n <= 1) {
      out.x = c[0] ?? 0;
      out.y = c[1] ?? 0;
      out.z = c[2] ?? 0;
      out.w = c[3] ?? 0;
      return;
    }
    const x = Math.max((t - this.plan.start) * TheaterTiming.rate, 0);
    const i = Math.min(Math.floor(x), n - 2);
    const u = Math.min(x - i, 1);
    const ax = c[4 * i]!;
    const ay = c[4 * i + 1]!;
    const az = c[4 * i + 2]!;
    const aw = c[4 * i + 3]!;
    const bw = aw + remainder(c[4 * i + 7]! - aw, 2 * Math.PI);
    out.x = ax + (c[4 * i + 4]! - ax) * u;
    out.y = ay + (c[4 * i + 5]! - ay) * u;
    out.z = az + (c[4 * i + 6]! - az) * u;
    out.w = aw + (bw - aw) * u;
  }

  /** The camera at t: x, y, log span, yaw. */
  cameraValue(t: PTime): Vec4 {
    const out = { x: 0, y: 0, z: 0, w: 0 };
    this.cameraInto(t, out);
    return out;
  }

  cameraState(t: PTime): CameraState {
    const x = Math.max((t - this.plan.start) * TheaterTiming.rate, 0);
    const n = this.cameraVelocity.length / 4;
    const i = Math.min(Math.round(x), Math.max(n - 1, 0));
    const v = this.cameraVelocity;
    const velocity = n === 0 ? vec4(0, 0, 0, 0) : vec4(v[4 * i]!, v[4 * i + 1]!, v[4 * i + 2]!, v[4 * i + 3]!);
    return { value: this.cameraValue(t), velocity };
  }
}

// MARK: - The bake

export const TheaterBake = {
  /**
   * Bakes a plan (pure). `light`: no strides (the theater isn't seen: the
   * plan is made, its anchors published, but nobody's feet are measured; the
   * plan made when it's seen again carries on from where everyone stands).
   */
  bake<Clip extends TheaterClip>(plan: Plan<Clip>, tuning: CameraTuning = CAMERA_TUNING, light = false, previous: BakedPlan<Clip> | null = null): BakedPlan<Clip> {
    return finish(TheaterBake.bakeSteps(plan, tuning, light, previous));
  },

  /** The same bake a man at a time (a web addition: the director bakes in short slices between frames). */
  *bakeSteps<Clip extends TheaterClip>(plan: Plan<Clip>, tuning: CameraTuning = CAMERA_TUNING, light = false, previous: BakedPlan<Clip> | null = null): Generator<void, BakedPlan<Clip>, void> {
    const dt = 1 / TheaterTiming.rate;
    const n = Math.max(Math.ceil((plan.horizon - plan.start) * TheaterTiming.rate), 1) + 1;
    const time = (i: number) => plan.start + i * dt;
    const reuse = TheaterBake.reusable(plan, previous);
    const tracks: ActorTrack[] = [];
    for (const id of plan.everyone) {
      const figure = plan.actors.get(id);
      if (!figure) continue;
      const xy = new Float32Array(2 * n);
      const opacity = new Float32Array(n);
      let last: Point = plan.state?.actor(id)?.position ?? firstPosition(plan, id) ?? ZERO2;
      // Up to the first change this plan makes, a man moves as the plan before had him: its samples, as they were.
      let before: { track: ActorTrack; offset: number; until: PTime } | null = null;
      if (reuse && !reuse.leaving.has(id)) {
        const track = reuse.from.tracks.find((tr) => tr.id === id);
        if (track) before = { track, offset: reuse.offset, until: reuse.until };
      }
      let kept = 0;
      for (let i = 0; i < n; i++) {
        if (before && time(i) < before.until && before.offset + i < before.track.count) {
          kept += 1;
          const j = before.offset + i;
          xy[2 * i] = before.track.xy[2 * j]!;
          xy[2 * i + 1] = before.track.xy[2 * j + 1]!;
          opacity[i] = before.track.opacity[j]!;
          last = v2(xy[2 * i]!, xy[2 * i + 1]!);
          continue;
        }
        const m = plan.sample(id, time(i));
        if (m) {
          last = m.position;
          xy[2 * i] = m.position.x;
          xy[2 * i + 1] = m.position.y;
          opacity[i] = m.opacity;
        } else {
          xy[2 * i] = last.x;
          xy[2 * i + 1] = last.y;
          opacity[i] = 0;
        }
      }
      const history = plan.history.get(id) ?? [];
      const position = (t: PTime): Point => {
        if (t < plan.start) {
          const back = (plan.start - t) * TheaterTiming.rate;
          if (history.length === 0) return v2(xy[0]!, xy[1]!);
          const k = history.length - back;
          if (k <= 0) return history[0]!;
          const lo = Math.min(Math.trunc(k), history.length - 1);
          const u = k - lo;
          const a = history[lo]!;
          const b = lo + 1 < history.length ? history[lo + 1]! : v2(xy[0]!, xy[1]!);
          return v2(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
        }
        const x = (t - plan.start) * TheaterTiming.rate;
        const i = Math.min(Math.trunc(x), n - 2);
        const u = Math.fround(Math.min(x - i, 1));
        const f = Math.fround;
        return v2(f(xy[2 * i]! + f(f(xy[2 * i + 2]! - xy[2 * i]!) * u)), f(xy[2 * i + 1]! + f(f(xy[2 * i + 3]! - xy[2 * i + 1]!) * u)));
      };
      const poses = TheaterBake.poseSpans(plan, id);
      const facing = (t: PTime) => TheaterBake.facing(plan, id, t);
      // The stride too, where the samples were kept (short of the change by its smoothing's reach): the plan
      // before's, then measured on from there, carrying its stride (as at any splice).
      const reach = 12;
      let rig: RigTrack;
      if (light) {
        rig = RigTrack.standing(position(plan.start), 0, figure.height);
      } else if (before && kept - reach >= Math.trunc(TheaterTiming.rate / 2) && before.track.rig.count > 0 && Math.abs(before.track.rig.start - before.track.start) < 1e-9) {
        const from = time(kept - reach);
        const tail = RigTrack.measure(from, plan.horizon, figure.height, position, facing, history.length * dt + (from - plan.start), before.track.rig.carry(from));
        rig = before.track.rig.keeping(plan.start, from, tail);
      } else {
        rig = RigTrack.measure(plan.start, plan.horizon, figure.height, position, facing, history.length * dt, plan.state?.actor(id)?.rig ?? null);
      }
      tracks.push(new ActorTrack(id, figure, plan.start, xy, opacity, rig, poses));
      yield;
    }
    const ball = TheaterBake.ballSpans(plan);
    // The yaw: the rule's targets from the ball's end (basketball), else each clip's own.
    let yawTargets: YawTarget[] = [];
    const rule = plan.yawRule;
    if (rule) {
      const firstPlacement = plan.placements[0];
      const first = plan.yaw ?? (firstPlacement ? { target: firstPlacement.clip.camera(0).w, since: plan.start - rule.dwell } : { target: rule.high, since: plan.start });
      yawTargets = rule.targets(first.target, first.since, plan.start, plan.horizon, (t) => TheaterBake.ballPoint(plan, ball, t)?.x ?? null);
    }
    const initial: CameraState = plan.state?.camera ?? { value: plan.openingCamera ?? TheaterBake.goal(plan, plan.start, yawTargets), velocity: vec4(0, 0, 0, 0) };
    const baked = CameraOperator.bake(initial, plan.start, plan.start + (n - 1) * dt, tuning, (t) => TheaterBake.goal(plan, t, yawTargets));
    // The operator's velocity at each sample, for an exact splice on the grid.
    const samples = baked.samples;
    const count = samples.length / 4;
    const velocity = new Float32Array(samples.length);
    for (let i = 0; i < count; i++) {
      const lo = Math.max(i - 1, 0);
      const hi = Math.min(i + 1, count - 1);
      const span = (hi - lo) * dt;
      if (i === 0 && plan.state) {
        const v = plan.state.camera.velocity;
        velocity[0] = v.x;
        velocity[1] = v.y;
        velocity[2] = v.z;
        velocity[3] = v.w;
        continue;
      }
      velocity[4 * i] = (samples[4 * hi]! - samples[4 * lo]!) / span;
      velocity[4 * i + 1] = (samples[4 * hi + 1]! - samples[4 * lo + 1]!) / span;
      velocity[4 * i + 2] = (samples[4 * hi + 2]! - samples[4 * lo + 2]!) / span;
      velocity[4 * i + 3] = remainder(samples[4 * hi + 3]! - samples[4 * lo + 3]!, 2 * Math.PI) / span;
    }
    const tiers = TheaterBake.frameTiers(plan, tracks, ball, samples);
    return new BakedPlan(plan, tracks, samples, velocity, ball, tiers, yawTargets);
  },

  /**
   * What of the plan before this one's samples can keep: up to the first
   * placement this plan changes (or the plan before would have moved on to),
   * on the same 60 Hz grid; not the men fading out where the splice found
   * them (their fade reads the splice's state).
   */
  reusable<Clip extends TheaterClip>(
    plan: Plan<Clip>,
    previous: BakedPlan<Clip> | null,
  ): { from: BakedPlan<Clip>; offset: number; until: PTime; leaving: Set<ActorID> } | null {
    if (!previous || !(plan.kept > 0) || plan.kept > plan.placements.length) return null;
    let k = -1;
    for (let i = previous.plan.placements.length - 1; i >= 0; i--) {
      if (previous.plan.placements[i]!.start <= plan.start) {
        k = i;
        break;
      }
    }
    if (k < 0) return null;
    const offset = Math.round((plan.start - previous.start) * TheaterTiming.rate);
    if (!(offset >= 0) || !(Math.abs(previous.start + offset / TheaterTiming.rate - plan.start) < 1e-6)) return null;
    let changed = Infinity;
    for (const p of plan.placements.slice(plan.kept)) changed = Math.min(changed, p.start);
    if (!Number.isFinite(changed)) changed = plan.horizon;
    let moved = Infinity;
    for (const p of previous.plan.placements.slice(k + 1)) moved = Math.min(moved, p.start);
    if (!Number.isFinite(moved)) moved = previous.plan.horizon;
    const until = Math.min(changed, moved, previous.plan.horizon) - 2 / TheaterTiming.rate;
    if (!(until > plan.start)) return null;
    const leaving = new Set<ActorID>();
    for (const p of plan.placements.slice(0, plan.kept)) for (const id of p.leaving) leaving.add(id);
    return { from: previous, offset, until, leaving };
  },

  /** Who poses a man and from when. */
  poseSpans<Clip extends TheaterClip>(plan: Plan<Clip>, id: ActorID): PoseSpan[] {
    const spans: PoseSpan[] = [];
    let previous: { placement: number; figure: number } | null = null;
    plan.placements.forEach((p, k) => {
      const i = p.figure(id);
      if (i < 0) {
        if (p.leaving.includes(id)) previous = null;
        return;
      }
      const from = k === 0 ? -Infinity : p.start;
      if (previous && k > 0) {
        spans.push({ from, placement: k, figure: i, previousPlacement: previous.placement, previousFigure: previous.figure, blendUntil: p.join.get(id) ?? p.start });
      } else {
        spans.push({ from, placement: k, figure: i, previousPlacement: -1, previousFigure: -1, blendUntil: -Infinity });
      }
      previous = { placement: k, figure: i };
    });
    return spans;
  },

  /**
   * What a man faces at t: his clip's heading while he's on it (he turns as
   * it turns him); while he travels to it, where he's going, and the clip's
   * heading once he's there.
   */
  facing<Clip extends TheaterClip>(plan: Plan<Clip>, id: ActorID, t: PTime): RigFacing | null {
    const k = plan.placement(t);
    if (k == null) return null;
    const p = plan.placements[k]!;
    const i = p.figure(id);
    if (i < 0) return null;
    const here = p.clip.position(i, Math.min(Math.max(p.time(t), 0), p.clip.length));
    const local = Math.max(p.time(t), 0);
    const heading = p.clip.heading(i, Math.min(local, p.clip.length));
    const join = p.join.get(id);
    const path = p.travel.get(id);
    if (join != null && t < join && path) {
      const at = path.position(t);
      const goal = p.clip.heading(i, p.clip.still);
      return { point: v2(at.x + Math.cos(goal) * 10, at.y + Math.sin(goal) * 10), always: false };
    }
    return { point: v2(here.x + Math.cos(heading) * 10, here.y + Math.sin(heading) * 10), always: true };
  },

  /** The ball through the plan. */
  ballSpans<Clip extends TheaterClip>(plan: Plan<Clip>): BallSpan[] {
    const spans: BallSpan[] = [];
    plan.placements.forEach((p, k) => {
      const from = k === 0 ? -Infinity : p.start;
      if (p.ball) {
        if (p.holder != null && p.ball.t0 > from) spans.push({ kind: "held", actor: p.holder, from });
        spans.push({ kind: "flight", flight: p.ball, from: p.ball.t0 });
        spans.push({ kind: "clip", placement: k, from: p.ball.t1 });
        return;
      }
      let join = -Infinity;
      for (const j of p.join.values()) join = Math.max(join, j);
      if (p.holder != null && p.join.size > 0 && join > from) {
        spans.push({ kind: "held", actor: p.holder, from });
        spans.push({ kind: "clip", placement: k, from: join });
      } else {
        spans.push({ kind: "clip", placement: k, from });
      }
    });
    return spans;
  },

  ballSpan(spans: readonly BallSpan[], t: PTime): BallSpan | null {
    if (spans.length === 0) return null;
    let lo = 0;
    let hi = spans.length - 1;
    if (t < spans[0]!.from) return spans[0]!;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (spans[mid]!.from <= t) lo = mid;
      else hi = mid - 1;
    }
    return spans[lo]!;
  },

  /** The ball's ground point at t (for the yaw rule), from the plan's evaluation. */
  ballPoint<Clip extends TheaterClip>(plan: Plan<Clip>, spans: readonly BallSpan[], t: PTime): Point | null {
    const span = TheaterBake.ballSpan(spans, t);
    if (!span) return null;
    switch (span.kind) {
      case "clip": {
        const p = plan.placements[span.placement]!;
        const b = p.clip.ball(Math.min(Math.max(p.time(t), 0), p.clip.length));
        if (b?.kind === "held") return plan.motion(p.cast[b.figure]!, t)?.position ?? null;
        if (b?.kind === "free") return v2(b.at.x, b.at.y);
        return null;
      }
      case "held":
        return plan.motion(span.actor, t)?.position ?? null;
      case "flight": {
        const p = span.flight.point(t);
        return v2(p.x, p.y);
      }
    }
  },

  /**
   * The camera's goal at t: the clip's own framing; while men travel to a
   * clip, eased from the one before's to its opening one (the operator bends
   * from wherever it is); the yaw from the rule when there is one.
   */
  goal<Clip extends TheaterClip>(plan: Plan<Clip>, t: PTime, targets: readonly YawTarget[]): Vec4 {
    const k = plan.placement(t);
    if (k == null) return plan.openingCamera ?? vec4(0, 0, 0, 0);
    const p = plan.placements[k]!;
    let g = p.clip.camera(Math.min(Math.max(p.time(t), 0), p.clip.length));
    const joined = p.joined;
    if (k > 0 && t < joined && joined > p.start) {
      const q = plan.placements[k - 1]!;
      const from = q.clip.camera(Math.min(Math.max(q.time(t), 0), q.clip.length));
      const u = TheaterCurve.inOut((t - p.start) / (joined - p.start));
      g = vec4(from.x + (g.x - from.x) * u, from.y + (g.y - from.y) * u, from.z + (g.z - from.z) * u, from.w + remainder(g.w - from.w, 2 * Math.PI) * u);
    }
    if (targets.length > 0) g = vec4(g.x, g.y, g.z, YawRule.target(targets, t));
    return g;
  },

  /** The frame tiers (§5.6.7). */
  frameTiers<Clip extends TheaterClip>(plan: Plan<Clip>, tracks: readonly ActorTrack[], ball: readonly BallSpan[], camera: Float32Array): FrameTier[] {
    const n = camera.length / 4;
    if (n <= 1) return [];
    const dt = 1 / TheaterTiming.rate;
    const decisive: number[] = [];
    for (const p of plan.placements) if (p.clip.decisive != null) decisive.push(p.offset + p.clip.decisive);
    const tiers: FrameTier[] = [];
    for (let i = 0; i < n; i++) {
      const t = plan.start + i * dt;
      let moves = false;
      const j = Math.min(i + 1, n - 1);
      const h = Math.max(j - i, 1) * dt;
      for (const track of tracks) {
        if (!(i < track.count)) continue;
        const b = Math.min(i + 1, track.count - 1);
        const d = Math.hypot(Math.fround(track.xy[2 * b]! - track.xy[2 * i]!), Math.fround(track.xy[2 * b + 1]! - track.xy[2 * i + 1]!));
        if (track.opacity[i]! > 0.01 && d / h > 0.01 * track.figure.height) {
          moves = true;
          break;
        }
        if (i + 1 < track.count && Math.abs(track.opacity[i + 1]! - track.opacity[i]!) > 1e-4) {
          moves = true;
          break;
        }
      }
      if (!moves) {
        const span = TheaterBake.ballSpan(ball, t);
        if (span?.kind === "flight") moves = true;
        else if (span?.kind === "clip") {
          const p = plan.placements[span.placement]!;
          if (clipFlying(p.clip, p.time(t))) moves = true;
        }
      }
      if (!moves && decisive.some((d) => Math.abs(d - t) <= 1.5)) moves = true;
      if (!moves) {
        const ax = camera[4 * i]!;
        const ay = camera[4 * i + 1]!;
        const az = camera[4 * i + 2]!;
        const aw = camera[4 * i + 3]!;
        const pan = Math.hypot(camera[4 * j]! - ax, camera[4 * j + 1]! - ay) / h / Math.exp(az);
        moves = pan > 0.002 || Math.abs(remainder(camera[4 * j + 3]! - aw, 2 * Math.PI)) / h > 0.02 || Math.abs(camera[4 * j + 2]! - az) / h > 0.002;
      }
      if (!moves) {
        const k = plan.placement(t);
        if (k != null) {
          const p = plan.placements[k]!;
          if (p.clip.moving(p.time(t))) moves = true;
        }
      }
      const last = tiers[tiers.length - 1];
      if (last && last.moves === moves) last.until = t + dt;
      else tiers.push({ from: t, until: t + dt, moves });
    }
    return tiers;
  },
};

function firstPosition<Clip extends TheaterClip>(plan: Plan<Clip>, id: ActorID): Point | null {
  const p = plan.placements[0];
  if (!p) return null;
  const i = p.figure(id);
  return i >= 0 ? p.clip.position(i, 0) : null;
}

// MARK: - The chain

/** The plans spliced end to end: what the stage samples (CHOREOGRAPHY §10). */
export class PlanChain<Clip extends TheaterClip> {
  /** Replaced on every splice, never mutated in place: a copy of the chain keeps the plans it had. */
  private _plans: readonly BakedPlan<Clip>[] = [];
  /** Bumps on every splice: a frame compares it, never the plans. */
  private _revision = 0;

  get plans(): readonly BakedPlan<Clip>[] {
    return this._plans;
  }

  get revision(): number {
    return this._revision;
  }

  get isEmpty(): boolean {
    return this._plans.length === 0;
  }

  /** A copy (Swift's value semantics: a request reads the chain as it was). */
  copy(): PlanChain<Clip> {
    const c = new PlanChain<Clip>();
    c._plans = this._plans;
    c._revision = this._revision;
    return c;
  }

  /** The plan covering p (the last that has begun). */
  index(p: PTime): number | null {
    const plans = this._plans;
    if (plans.length === 0) return null;
    let lo = 0;
    let hi = plans.length - 1;
    if (p < plans[0]!.start) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (plans[mid]!.start <= p) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  plan(p: PTime): BakedPlan<Clip> | null {
    const i = this.index(p);
    return i == null ? null : this._plans[i]!;
  }

  /** Takes in a plan from its splice on: anything at or after its start is superseded; plans long behind are let go. */
  splice(next: BakedPlan<Clip>, p: PTime): void {
    const plans = this._plans.filter((x) => x.start < next.start - 1e-9);
    plans.push(next);
    // Wholly behind p (the next one already began more than a moment ago): gone.
    while (plans.length > 1 && plans[1]!.start <= p - TheaterTiming.keepBehind) plans.shift();
    this._plans = plans;
    this._revision += 1;
  }

  /** The frame tiers end to end: each plan's until the next one takes over. */
  get tiers(): FrameTier[] {
    const out: FrameTier[] = [];
    this._plans.forEach((plan, i) => {
      const until = i + 1 < this._plans.length ? this._plans[i + 1]!.start : Infinity;
      for (const tier of plan.tiers) {
        if (!(tier.from < until)) continue;
        out.push({ from: tier.from, until: Math.min(tier.until, until), moves: tier.moves });
      }
    });
    return out;
  }

  /** The splice's commit point: at least `lead` past p, on the covering plan's 1/60 s grid (so its state there is exact). */
  commit(p: PTime, lead: number = TheaterTiming.commitLead): PTime {
    const plan = this.plan(p + lead);
    if (!plan) return p + lead;
    const k = Math.ceil((p + lead - plan.start) * TheaterTiming.rate);
    return plan.start + Math.max(k, 0) / TheaterTiming.rate;
  }

  /** The world exactly at t (the splice source). */
  state(t: PTime): WorldState | null {
    const baked = this.plan(t);
    if (!baked) return null;
    const plan = baked.plan;
    const actors: ActorState[] = [];
    for (const track of baked.tracks) {
      const m = plan.motion(track.id, t);
      if (!m) continue;
      actors.push({ id: track.id, position: m.position, velocity: m.velocity, acceleration: m.acceleration, rig: track.rig.carry(t), opacity: m.opacity });
    }
    let ball: BallState | null = null;
    const span = TheaterBake.ballSpan(baked.ball, t);
    const held = (id: ActorID) => {
      const m = plan.motion(id, t);
      return m ? { position: { x: m.position.x, y: m.position.y, z: 4.4 }, velocity: { x: 0, y: 0, z: 0 }, holder: id } : null;
    };
    if (span?.kind === "clip") {
      const p = plan.placements[span.placement]!;
      const b = p.clip.ball(Math.min(Math.max(p.time(t), 0), p.clip.length));
      if (b?.kind === "held") ball = held(p.cast[b.figure]!);
      else if (b?.kind === "free") ball = { position: b.at, velocity: { x: 0, y: 0, z: 0 }, holder: null };
    } else if (span?.kind === "held") ball = held(span.actor);
    else if (span?.kind === "flight") ball = { position: span.flight.point(t), velocity: { x: 0, y: 0, z: 0 }, holder: null };
    const cues = plan.cues.filter((c) => c.at <= t && c.until > t);
    return new WorldState(t, actors, ball, baked.cameraState(t), cues);
  }

  /** Each man's path over the `count` frames before t (the next plan's history). */
  history(t: PTime, count = 12): Map<ActorID, Point[]> {
    const out = new Map<ActorID, Point[]>();
    const baked = this.plan(t);
    if (!baked) return out;
    for (const track of baked.tracks) {
      const path: Point[] = [];
      for (let k = count - 1; k >= 0; k--) {
        const at = t - (k + 1) / TheaterTiming.rate;
        path.push((this.plan(at)?.track(track.id) ?? track).position(at));
      }
      out.set(track.id, path);
    }
    return out;
  }

  // MARK: Sampling (allocation-free)

  /** Everything a frame needs at p, into the scratch (its buffers reused): which plan, the camera, each man. */
  sample(p: PTime, scratch: FrameScratch): void {
    scratch.p = p;
    scratch.count = 0;
    scratch.ballKind = "none";
    const k = this.index(p);
    if (k == null) {
      scratch.plan = -1;
      return;
    }
    scratch.plan = k;
    const baked = this._plans[k]!;
    baked.cameraInto(p, scratch.camera);
    scratch.placement = baked.plan.placement(p) ?? -1;
    const tracks = baked.tracks;
    for (let n = 0; n < tracks.length; n++) {
      const track = tracks[n]!;
      const o = track.presence(p);
      if (!(o > 0.004)) continue;
      const span = track.pose(p);
      if (!span) continue;
      const placement = baked.plan.placements[span.placement]!;
      const actor = scratch.take();
      actor.id = track.id;
      actor.track = n;
      track.positionInto(p, actor);
      actor.opacity = o;
      track.rig.motionInto(p, actor.motion);
      actor.placement = span.placement;
      actor.figure = span.figure;
      actor.clipTime = placement.time(p);
      if (span.previousPlacement >= 0 && p < span.blendUntil) {
        const from = baked.plan.placements[span.placement]!.start;
        const u = (p - from) / Math.max(span.blendUntil - from, 1e-6);
        actor.previousPlacement = span.previousPlacement;
        actor.previousFigure = span.previousFigure;
        actor.previousTime = baked.plan.placements[span.previousPlacement]!.time(p);
        actor.blend = TheaterCurve.inOut(u);
      }
    }
    const span = TheaterBake.ballSpan(baked.ball, p);
    if (!span) return;
    if (span.kind === "clip") {
      scratch.ballKind = "clip";
      scratch.ballPlacement = span.placement;
    } else if (span.kind === "held") {
      scratch.ballKind = "held";
      scratch.ballActor = span.actor;
    } else {
      scratch.ballKind = "free";
      const f = span.flight;
      const u = Math.min(Math.max((p - f.t0) / Math.max(f.t1 - f.t0, 1e-6), 0), 1);
      scratch.ball.x = f.from.x + (f.to.x - f.from.x) * u;
      scratch.ball.y = f.from.y + (f.to.y - f.from.y) * u;
      scratch.ball.z = f.from.z + (f.to.z - f.from.z) * u + 4 * f.apex * u * (1 - u);
    }
  }
}

/** A ball flight's point at t (the painters' read of `FieldPoint`). */
export type { FieldPoint };
