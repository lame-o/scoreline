/**
 * The hand-off from the field between plays to a replay (TheaterBridge.swift),
 * the same way in all four theaters. ESPN posts a play 15–45 s after it
 * happens, so it lands whenever it lands, often midway through one of the
 * idle's beats (a huddle breaking, a man in motion, the half-court set
 * swinging the ball, the ball going round, a runner stretching his lead).
 * The replay still starts at once, but from wherever the figures are on
 * screen: over a short bridge each one goes from his live idle spot and pose
 * to his place in the play's opening formation, and the camera eases from
 * the idle's framing to the replay's, on the strong ease-in-out the
 * theaters' name glide uses (it's on-screen movement); then the replay runs
 * as written. A figure in only one of the two scenes (a trainer out to a man
 * hurt, a coach with his red flag) fades out or in over the bridge.
 *
 * The bridge runs inside the replay's own lead-in (the half second on the
 * formation before the snap, the set before anyone moves) when it fits, so
 * the action isn't delayed; only when it doesn't is the difference added in
 * front, and the replay's clock starts that much later. An idle beat a
 * moment from its natural end (0.3 s or less) finishes first. When the play
 * starts far from where the idle stands (the idle has moved on to the next
 * down's spot, or to the other end), men sprinting backwards would look
 * wrong: a quick crossfade instead (0.25 s, ease-out) into the play's set
 * formation. With Reduce Motion, always that crossfade, nothing travels.
 *
 * Replay to replay (a queue of plays back to back) is unchanged: this is the
 * idle's hand-off alone. Pure values: a sport describes its two scenes'
 * figures (`BridgeFigure`), the plan says how they meet, and each frame
 * blends by the plan's weight at t.
 *
 *     const plan = bridgePlan(idleFigures, replayFigures, { room: script.leadIn, far: TheaterBridge.far.football });
 *     plan.weight(s); plan.replayTime(s);
 */
import { houseCurve, sweepCurve } from "../celebrations";
import type { Point } from "../mlb/theaterField";
import { gait, mix, type RigPose, RigTrack } from "./rig";

export const TheaterBridge = {
  /** The bridge's length: half a second for a short settle, up to 0.7 s for the longest one it takes. */
  shortest: 0.5,
  longest: 0.7,
  /** The crossfade when the play starts far off (and with Reduce Motion). */
  crossfade: 0.25,
  /** An idle beat this close to its end plays out before the bridge. */
  finishing: 0.3,

  /** On-screen movement eases in and out: the name glide's curve, cubic-bezier(0.77, 0, 0.175, 1). */
  ease(u: number): number {
    return sweepCurve(Math.min(Math.max(u, 0), 1));
  },

  /** A crossfade eases out (the house curve). */
  fade(u: number): number {
    return houseCurve(Math.min(Math.max(u, 0), 1));
  },

  /**
   * The far rule, per sport: how far (the median of the men's moves, in the
   * sport's own units) the idle can stand from the play's opening and still
   * settle into it. Beyond it most of them would be sprinting there,
   * backwards as often as not; the replay crossfades in.
   */
  far: {
    /**
     * Football, in feet: four yards. Lined up at the snap's spot, or still
     * jogging to it from the huddle's break, everyone settles (a formation
     * re-set moves a few men, not most); the next down's spot after a
     * five-yard gain (fifteen feet for everyone), a huddle seven yards back,
     * the other end, crossfade.
     */
    football: 12,
    /** Basketball, in feet: about three strides. A half-court set that has swung the ball round settles into the replay's set; a play at the other end (a break, the ball the other way) crossfades. */
    basketball: 10,
    /** Soccer, in metres: a sprint's ten metres a second over the longest bridge. The shape shifting with the ball settles; a move that starts away from where the ball was going round crossfades. */
    soccer: 7,
    /** Baseball, in feet: everyone's set between pitches and the idle's moves are a step (a lead, the catcher up, a practice swing); a man that far out of place means another field: crossfade. */
    baseball: 8,
  },
} as const;

/**
 * A figure as the bridge matches it: whose he is (a team, the staff: never
 * matched across), what he is (his slot or role: matched first), who (his
 * athlete, when the data names him: matched before anything), and where he
 * stands, in the replay's frame.
 */
export interface BridgeFigure {
  readonly group: number;
  readonly kind: string;
  readonly athlete: string | null;
  readonly at: Point;
}

/** `bridge`: each man travels from his idle spot and pose to the replay's. `crossfade`: the idle fades out over the replay's set formation. */
export type BridgeMode = "bridge" | "crossfade";

/** How the idle on screen meets a replay, from the moment the play came in. */
export class BridgePlan {
  constructor(
    readonly mode: BridgeMode,
    /** The bridge's (or the crossfade's) length. */
    readonly length: number,
    /** Replay figure → idle figure: the men who travel. The rest fade. */
    readonly pairs: ReadonlyMap<number, number> = new Map(),
    /** What the bridge didn't fit in the replay's own lead-in: its clock starts this much later. */
    readonly lead = 0,
    /** The idle beat's last moment, played out first. */
    readonly wait = 0,
    /** How far the men travel (the median), in the sport's units. */
    readonly moved = 0,
  ) {}

  /** The replay's clock `s` seconds after the play came in. */
  replayTime(s: number): number {
    return s - this.wait - this.lead;
  }

  /** How far the hand-off is `s` seconds after the play came in: 0 the idle, 1 the replay. */
  weight(s: number): number {
    const u = (s - this.wait) / Math.max(this.length, 0.01);
    return this.mode === "bridge" ? TheaterBridge.ease(u) : TheaterBridge.fade(u);
  }

  /** Seconds after the play came in when it's all the replay's. */
  get end(): number {
    return this.wait + this.length;
  }

  /** From the play coming in to the replay's clock at 0. */
  get delay(): number {
    return this.wait + this.lead;
  }
}

export interface PlanOptions {
  /** The replay's own lead-in: seconds before anyone moves. */
  readonly room: number;
  /** The sport's far rule (`TheaterBridge.far`). */
  readonly far: number;
  /** The two are on the same end, facing the same way (else a crossfade). */
  readonly together?: boolean;
  readonly reduceMotion?: boolean;
  /** What's left of the idle beat on screen (null: it's still). */
  readonly beatLeft?: number | null;
}

/** How the idle's figures meet the replay's (TheaterBridge.plan). (pure; tested) */
export function bridgePlan(idle: readonly BridgeFigure[], replay: readonly BridgeFigure[], { room, far, together = true, reduceMotion = false, beatLeft = null }: PlanOptions): BridgePlan {
  const { crossfade, finishing, shortest, longest } = TheaterBridge;
  if (reduceMotion) return new BridgePlan("crossfade", crossfade);
  const wait = beatLeft != null && beatLeft > 0 && beatLeft <= finishing ? beatLeft : 0;
  if (!together) return new BridgePlan("crossfade", crossfade, new Map(), 0, wait, Infinity);
  const pairs = bridgeMatch(idle, replay);
  const moved = bridgeMoved(pairs, idle, replay);
  if (!(moved <= far)) return new BridgePlan("crossfade", crossfade, new Map(), 0, wait, moved);
  const length = shortest + (longest - shortest) * Math.min(Math.max(moved / far, 0), 1);
  return new BridgePlan("bridge", length, pairs, Math.max(length - Math.max(room, 0), 0), wait, moved);
}

/**
 * Who becomes whom (TheaterBridge.match): the same man first (his athlete),
 * then each of a group with the nearest of his kind, then with the nearest
 * at all; a final pass swaps any two whose swap shortens their moves.
 * Replay figure → idle figure. (pure; tested)
 */
export function bridgeMatch(idle: readonly BridgeFigure[], replay: readonly BridgeFigure[]): Map<number, number> {
  // A different kind costs as much as a long run; a different man (both named) more.
  const cost = (r: number, i: number): number => {
    const a = replay[r]!;
    const b = idle[i]!;
    if (a.athlete != null && b.athlete != null && a.athlete === b.athlete) return -1;
    let c = Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y);
    if (a.kind !== b.kind) c += 1000;
    if (a.athlete != null && b.athlete != null && a.athlete !== b.athlete) c += 500;
    return c;
  };
  const options: { cost: number; r: number; i: number }[] = [];
  replay.forEach((a, r) => {
    idle.forEach((b, i) => {
      if (b.group === a.group) options.push({ cost: cost(r, i), r, i });
    });
  });
  options.sort((x, y) => x.cost - y.cost || x.r - y.r || x.i - y.i);
  const pairs = new Map<number, number>();
  const taken = new Set<number>();
  for (const o of options) {
    if (pairs.has(o.r) || taken.has(o.i)) continue;
    pairs.set(o.r, o.i);
    taken.add(o.i);
  }
  // Untangle: two men who'd cross over swap places.
  const keys = [...pairs.keys()].sort((x, y) => x - y);
  for (let pass = 0; pass < 3; pass++) {
    let swapped = false;
    keys.forEach((a, n) => {
      for (const b of keys.slice(n + 1)) {
        if (replay[a]!.group !== replay[b]!.group) continue;
        const ia = pairs.get(a);
        const ib = pairs.get(b);
        if (ia == null || ib == null) continue;
        if (cost(a, ib) + cost(b, ia) < cost(a, ia) + cost(b, ib) - 0.01) {
          pairs.set(a, ib);
          pairs.set(b, ia);
          swapped = true;
        }
      }
    });
    if (!swapped) break;
  }
  return pairs;
}

// MARK: Blending

export function bridgeMix(a: Point, b: Point, w: number): Point {
  return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
}

/** A heading part way to another, the short way round. */
export function bridgeTurn(a: number, b: number, w: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * w;
}

/** A figure's spot and heading at a moment of one scene. */
export interface BridgeSpot {
  readonly at: Point;
  readonly heading: number;
}

/**
 * Each traveller's path over the bridge (`s`: seconds since the play came
 * in), from where the idle has him to where the replay does, by the plan's
 * weight, and his motion along it measured once (`RigTrack`: his stride, so
 * he steps rather than glides), facing the way the two scenes have him
 * facing, blended. `idle` and `replay`: a figure's spot and heading at `s`
 * in each scene. Replay figure → track.
 */
export function bridgeTracks(plan: BridgePlan, height: number, idle: (i: number, s: number) => BridgeSpot, replay: (r: number, s: number) => BridgeSpot): Map<number, RigTrack> {
  const tracks = new Map<number, RigTrack>();
  if (plan.mode !== "bridge") return tracks;
  for (const [r, i] of plan.pairs) {
    const spot = (s: number): BridgeSpot => {
      const a = idle(i, s);
      const b = replay(r, s);
      const w = plan.weight(s);
      return { at: bridgeMix(a.at, b.at, w), heading: bridgeTurn(a.heading, b.heading, w) };
    };
    tracks.set(
      r,
      RigTrack.measure(0, plan.end, height, (s) => spot(s).at, (s) => {
        const p = spot(s);
        return { point: { x: p.at.x + Math.cos(p.heading) * height, y: p.at.y + Math.sin(p.heading) * height }, always: true };
      }),
    );
  }
  return tracks;
}

/**
 * A traveller posed mid-bridge (pure): his idle pose and his replay pose
 * (each as its own scene has him, where he stands in it) blended by `w`,
 * striding along the bridge's path while he covers ground (`track` at `s`),
 * the way he faces blended too.
 */
export function bridgePose(from: readonly [RigPose, number], to: readonly [RigPose, number], w: number, track: RigTrack | null | undefined, s: number, at: Point, unit: number): [RigPose, number] {
  let body = mix(from[0], to[0], w);
  const heading = bridgeTurn(from[1], to[1], w);
  if (track) {
    const m = track.motion(s);
    if (m.weight > 0.01) {
      const feet = track.feet(s, at, heading, unit, m.speed, { left: body.left, right: body.right });
      body = mix(body, gait(m, feet), m.weight);
    }
  }
  return [body, heading];
}

/**
 * How far the paired men travel, as the far rule measures it: the median
 * move (a few men re-forming a set travel further; when the whole scene has
 * moved on, most of them do). `share`: another percentile.
 */
export function bridgeMoved(pairs: ReadonlyMap<number, number>, idle: readonly BridgeFigure[], replay: readonly BridgeFigure[], share = 0.5): number {
  const moves = [...pairs].map(([r, i]) => Math.hypot(replay[r]!.at.x - idle[i]!.at.x, replay[r]!.at.y - idle[i]!.at.y)).sort((a, b) => a - b);
  if (moves.length === 0) return Infinity;
  return moves[Math.min(Math.max(Math.ceil(moves.length * share) - 1, 0), moves.length - 1)]!;
}

/**
 * Mid-bridge, the idle as it stands (a sport's frame draws from it): its
 * script and its time now (it plays on under the hand-off), how far the
 * hand-off is (0 the idle, 1 the replay), seconds since the play came in
 * (where each traveller is along his track), who becomes whom, and each
 * traveller's stride. The idle's figures the replay doesn't have fade out
 * (`bridgeGhosts`).
 */
export interface FrameBridge<Script> {
  readonly script: Script;
  readonly t: number;
  readonly w: number;
  readonly s: number;
  /** Replay figure → idle figure. */
  readonly pairs: ReadonlyMap<number, number>;
  readonly tracks: ReadonlyMap<number, RigTrack>;
}

/** What's left of the idle beat on screen at t (its beats: when anything moves); null: it's still between beats. */
export function beatLeft(beats: readonly (readonly [number, number])[], t: number): number | null {
  const beat = beats.find(([a, b]) => t >= a && t < b);
  return beat ? beat[1] - t : null;
}

/** The idle's figures (of `count`) the replay doesn't have: they fade out. */
export function bridgeGhosts(pairs: ReadonlyMap<number, number>, count: number): number[] {
  const paired = new Set(pairs.values());
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (!paired.has(i)) out.push(i);
  return out;
}
