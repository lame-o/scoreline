/**
 * The theaters' players (TheaterRig.swift): one pictogram rig for every
 * sport. A figure is a skeleton in its own space (forward, left, up, in body
 * units: it stands 1.1 tall), posed in 3D, turned to its heading and drawn
 * through the theater's own projection, so a man running at the camera
 * strides toward the lens and one seen side-on scissors across it. The
 * proportions are the old flat figure's (legs half its height, a round head,
 * the same strokes); only the hips and shoulders gain a little width, so
 * each limb hangs from its own joint.
 *
 * How it moves comes from where the script sends it, measured once per
 * script (`RigTrack`): its heading turns toward where it's going, or what it
 * watches, at a limited rate; its stride follows the ground it covers, so
 * cadence and stride grow together through a walk, a jog and a sprint, each
 * foot planted where it lands until it lifts (the leg reaches it by two-bone
 * IK), and a stop finishes its step. What it does (a delivery, a catch, a
 * throw, a kick) is a pose over that, authored relative to the heading and
 * blended joint by joint: feet as IK targets, arms by their joints, knees and
 * elbows only ever bending their own way.
 *
 * Pure numbers: the projection and the drawing (`RigLens`, `RigFigure`,
 * `drawFigure`) are features/game/core/theater/rigFigure.ts. Ported diff for
 * diff, the same types and function boundaries, so the Mac's tuning ports as
 * deltas. Swift's `Float` samples are a `Float32Array` here, rounded alike.
 */
import type { Point } from "../mlb/theaterField";

// MARK: - Vectors

/** A point or direction in a figure's space, in body units: forward, left, up. */
export interface RigVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const vec = (x: number, y: number, z: number): RigVector => ({ x, y, z });
export const ZERO: RigVector = vec(0, 0, 0);
export const plus = (a: RigVector, b: RigVector): RigVector => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const minus = (a: RigVector, b: RigVector): RigVector => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const times = (a: RigVector, k: number): RigVector => vec(a.x * k, a.y * k, a.z * k);
export const dot = (a: RigVector, b: RigVector): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const norm = (a: RigVector): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);

/** IEEE 754 remainder (Swift's `remainder`): x less the nearest whole multiple of y, ties to even. */
export function remainder(x: number, y: number): number {
  const n = x / y;
  let k = Math.round(n);
  if (Math.abs(n % 1) === 0.5) k = 2 * Math.round(n / 2);
  return x - k * y;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export const Rig = {
  thigh: 0.25,
  shin: 0.25,
  upperArm: 0.18,
  forearm: 0.17,
  /** Pelvis to neck, neck to the head's center, and the head. */
  spine: 0.3,
  neck: 0.2,
  head: 0.115,
  /** Each hip and shoulder off the body's midline. */
  hips: 0.045,
  shoulders: 0.06,
  /** The pelvis of a man standing, and each foot off his midline. */
  stand: 0.488,
  stance: 0.06,
  /** Knees and elbows bend no further than this. */
  fold: 2.7,

  smooth(x: number): number {
    const u = Math.min(Math.max(x, 0), 1);
    return u * u * (3 - 2 * u);
  },

  /** Round the vertical, to the left. */
  yaw(v: RigVector, a: number): RigVector {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return vec(v.x * c - v.y * s, v.x * s + v.y * c, v.z);
  },

  /** Tipped forward (up toward forward). */
  pitch(v: RigVector, a: number): RigVector {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return vec(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
  },

  /** Tipped to the left (up toward left). */
  roll(v: RigVector, a: number): RigVector {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return vec(v.x, v.y * c + v.z * s, -v.y * s + v.z * c);
  },

  /**
   * Two bones from `root` toward `target`, the joint between them bending
   * toward `pole`: the joint, and where the chain ends (the target, or as
   * near as it reaches). The joint is always on the pole's side: a knee never
   * bends backward.
   */
  reach(root: RigVector, target: RigVector, pole: RigVector, a: number, b: number): { joint: RigVector; end: RigVector } {
    let dx = target.x - root.x;
    let dy = target.y - root.y;
    let dz = target.z - root.z;
    let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const longest = (a + b) * 0.9995;
    const shortest = Math.abs(a - b) + 0.02;
    if (dist < 1e-9) {
      dx = 0;
      dy = 0;
      dz = -1;
      dist = 1;
    }
    const clamped = Math.min(Math.max(dist, shortest), longest);
    const lx = dx / dist;
    const ly = dy / dist;
    const lz = dz / dist;
    const along0 = pole.x * lx + pole.y * ly + pole.z * lz;
    let ax = pole.x - lx * along0;
    let ay = pole.y - ly * along0;
    let az = pole.z - lz * along0;
    let size = Math.sqrt(ax * ax + ay * ay + az * az);
    if (size < 1e-9) {
      ax = 1 - lx * lx;
      ay = -ly * lx;
      az = -lz * lx;
      size = Math.max(Math.sqrt(ax * ax + ay * ay + az * az), 1e-9);
    }
    ax /= size;
    ay /= size;
    az /= size;
    const along = (a * a - b * b + clamped * clamped) / (2 * clamped);
    const out = Math.sqrt(Math.max(a * a - along * along, 0));
    return {
      joint: vec(root.x + lx * along + ax * out, root.y + ly * along + ay * out, root.z + lz * along + az * out),
      end: vec(root.x + lx * clamped, root.y + ly * clamped, root.z + lz * clamped),
    };
  },
};

// MARK: - Poses

/** An arm, at the shoulder and the elbow, in the torso's frame. */
export interface RigArm {
  /** Forward from hanging (back below zero), out to the side, round the vertical (outward), and the elbow (forward, never past straight). */
  readonly swing: number;
  readonly spread: number;
  readonly turn: number;
  readonly bend: number;
}

export const rigArm = ({ swing = 0, spread = 0.12, turn = 0, bend = 0.18 }: Partial<RigArm> = {}): RigArm => ({ swing, spread, turn, bend });

const ARM = rigArm();

/** The upper arm's and the forearm's directions, for the arm on side `side` (1 left, −1 right). */
export function armBones(a: RigArm, side: number): { upper: RigVector; fore: RigVector } {
  const k = clamp(a.bend, 0, Rig.fold);
  const upper = vec(Math.sin(a.swing), 0, -Math.cos(a.swing));
  const fore = vec(Math.sin(a.swing + k), 0, -Math.cos(a.swing + k));
  return {
    upper: Rig.yaw(Rig.roll(upper, -side * a.spread), side * a.turn),
    fore: Rig.yaw(Rig.roll(fore, -side * a.spread), side * a.turn),
  };
}

/**
 * A body's pose relative to its heading: where the pelvis and the feet are
 * (the legs reach the feet), how the body turns and tips, how the torso
 * leans and twists over the pelvis, and the arms. Poses blend joint by joint,
 * so a blend between two poses is a pose.
 */
export interface RigPose {
  /** The body turned off the heading (to the left): a thrower side-on to his target. */
  readonly turn: number;
  /** The pelvis: forward, left and up from the ground point it's placed at. */
  readonly hip: RigVector;
  /** The whole body tipped round the pelvis: forward (flat out), then over to the left round forward (a keeper's dive). */
  readonly pitch: number;
  readonly bank: number;
  /** The torso over the pelvis: forward, to the left, and the shoulders twisted (to the left). */
  readonly lean: number;
  readonly roll: number;
  readonly twist: number;
  /** The head, forward off the spine (a header's snap). */
  readonly nod: number;
  /** Where the feet are, from the ground point, before any tip. */
  readonly left: RigVector;
  readonly right: RigVector;
  /** The knees turned out from forward. */
  readonly knees: number;
  readonly leftArm: RigArm;
  readonly rightArm: RigArm;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** A pose being summed: every part writable. */
interface Sum extends Omit<Mutable<RigPose>, "hip" | "left" | "right" | "leftArm" | "rightArm"> {
  hip: Mutable<RigVector>;
  left: Mutable<RigVector>;
  right: Mutable<RigVector>;
  leftArm: Mutable<RigArm>;
  rightArm: Mutable<RigArm>;
}

/** A pose from its parts, the rest as a man standing (Swift's memberwise `RigPose(...)`). */
export const rigPose = (p: Partial<RigPose> = {}): RigPose => ({
  turn: p.turn ?? 0,
  hip: p.hip ?? vec(0, 0, Rig.stand),
  pitch: p.pitch ?? 0,
  bank: p.bank ?? 0,
  lean: p.lean ?? 0,
  roll: p.roll ?? 0,
  twist: p.twist ?? 0,
  nod: p.nod ?? 0,
  left: p.left ?? vec(0, Rig.stance, 0),
  right: p.right ?? vec(0, -Rig.stance, 0),
  knees: p.knees ?? 0.1,
  leftArm: p.leftArm ?? ARM,
  rightArm: p.rightArm ?? ARM,
});

/** A pose with these parts changed (Swift's `var p = pose; p.x = …`). */
export const withPose = (p: RigPose, changes: Partial<RigPose>): RigPose => ({ ...p, ...changes });

/** Every part zero: the start of a weighted sum. */
function zeroPose(): Sum {
  return {
    turn: 0,
    hip: { x: 0, y: 0, z: 0 },
    pitch: 0,
    bank: 0,
    lean: 0,
    roll: 0,
    twist: 0,
    nod: 0,
    left: { x: 0, y: 0, z: 0 },
    right: { x: 0, y: 0, z: 0 },
    knees: 0,
    leftArm: { swing: 0, spread: 0, turn: 0, bend: 0 },
    rightArm: { swing: 0, spread: 0, turn: 0, bend: 0 },
  };
}

function addPose(p: Sum, q: RigPose, w: number): void {
  p.turn += q.turn * w;
  p.hip.x += q.hip.x * w;
  p.hip.y += q.hip.y * w;
  p.hip.z += q.hip.z * w;
  p.pitch += q.pitch * w;
  p.bank += q.bank * w;
  p.lean += q.lean * w;
  p.roll += q.roll * w;
  p.twist += q.twist * w;
  p.nod += q.nod * w;
  p.left.x += q.left.x * w;
  p.left.y += q.left.y * w;
  p.left.z += q.left.z * w;
  p.right.x += q.right.x * w;
  p.right.y += q.right.y * w;
  p.right.z += q.right.z * w;
  p.knees += q.knees * w;
  p.leftArm.swing += q.leftArm.swing * w;
  p.leftArm.spread += q.leftArm.spread * w;
  p.leftArm.turn += q.leftArm.turn * w;
  p.leftArm.bend += q.leftArm.bend * w;
  p.rightArm.swing += q.rightArm.swing * w;
  p.rightArm.spread += q.rightArm.spread * w;
  p.rightArm.turn += q.rightArm.turn * w;
  p.rightArm.bend += q.rightArm.bend * w;
}

/** Left for right: a left-hander's delivery, a lefty's swing. */
export function mirrored(p: RigPose): RigPose {
  const flip = (v: RigVector) => vec(v.x, -v.y, v.z);
  return {
    ...p,
    turn: -p.turn,
    hip: flip(p.hip),
    bank: -p.bank,
    roll: -p.roll,
    twist: -p.twist,
    left: flip(p.right),
    right: flip(p.left),
    leftArm: p.rightArm,
    rightArm: p.leftArm,
  };
}

/** Part way to another pose. */
export function mix(a: RigPose, o: RigPose, u: number): RigPose {
  if (!(u > 0)) return a;
  if (!(u < 1)) return o;
  const p = zeroPose();
  addPose(p, a, 1 - u);
  addPose(p, o, u);
  return p;
}

/**
 * Another pose over this one by `u`: all of it standing still, only above
 * the hips on the move (`moving` 1), where the legs keep their stride and the
 * shoulders take the turn the hips don't (a catch, a throw on the run).
 */
export function over(a: RigPose, o: RigPose, u: number, moving: number): RigPose {
  if (!(u > 0)) return a;
  const p = mix(a, o, u * (1 - clamp(moving, 0, 1)));
  const m = mix(a, o, u);
  return { ...p, lean: m.lean, roll: m.roll, twist: m.twist + m.turn - p.turn, nod: m.nod, leftArm: m.leftArm, rightArm: m.rightArm };
}

/** A weighted sum of poses (the weights summing to one): a blend, or a spline through keys. Elbows stay between straight and folded. */
export function sum(terms: readonly (readonly [RigPose, number])[]): RigPose {
  const p = zeroPose();
  for (const [q, w] of terms) if (w !== 0) addPose(p, q, w);
  p.leftArm.bend = clamp(p.leftArm.bend, 0, Rig.fold);
  p.rightArm.bend = clamp(p.rightArm.bend, 0, Rig.fold);
  return p;
}

/**
 * Through key poses at their times: a spline that eases through each (a
 * little past it, as a body overshoots and settles) and out of the first and
 * into the last, never a stop at every key. Null outside them.
 */
export function keyed(keys: readonly (readonly [number, RigPose])[], x: number): RigPose | null {
  const first = keys[0]?.[0];
  const last = keys[keys.length - 1]?.[0];
  if (first == null || last == null || !(x > first) || !(x < last)) return null;
  let i = -1;
  for (let k = keys.length - 1; k >= 0; k--) {
    if (keys[k]![0] <= x) {
      i = k;
      break;
    }
  }
  if (i < 0 || i + 1 >= keys.length) return null;
  const [t1, p1] = keys[i]!;
  const [t2, p2] = keys[i + 1]!;
  const u = (x - t1) / (t2 - t1);
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  // Catmull-Rom tangents through the neighbours; flat at the ends.
  const terms: (readonly [RigPose, number])[] = [
    [p1, h00],
    [p2, h01],
  ];
  if (i > 0) {
    const s = (t2 - t1) / (t2 - keys[i - 1]![0]);
    terms.push([p2, h10 * s], [keys[i - 1]![1], -h10 * s]);
  }
  if (i + 2 < keys.length) {
    const s = (t2 - t1) / (keys[i + 2]![0] - t1);
    terms.push([keys[i + 2]![1], h11 * s], [p1, -h11 * s]);
  }
  return sum(terms);
}

/** The poses every sport shares. */
export const RigPoses = {
  /** Standing at ease: an outfielder, a runner at rest. */
  stand: rigPose(),
  /** Knees bent, weight forward, hands low in front: an infielder as the pitch comes. */
  ready: rigPose({
    hip: vec(-0.06, 0, 0.41),
    lean: 0.6,
    left: vec(0.03, 0.17, 0),
    right: vec(0.03, -0.17, 0),
    knees: 0.4,
    leftArm: rigArm({ swing: 0.35, spread: 0.3, turn: -0.35, bend: 0.6 }),
    rightArm: rigArm({ swing: 0.35, spread: 0.3, turn: -0.35, bend: 0.6 }),
  }),
  /** Arms up for a ball over his head, reaching. */
  catchHigh: rigPose({
    hip: vec(0, 0, 0.5),
    lean: -0.12,
    nod: -0.25,
    left: vec(0.02, 0.06, 0),
    right: vec(-0.04, -0.06, 0),
    leftArm: rigArm({ swing: 2.75, spread: 0.18, turn: -0.1, bend: 0.25 }),
    rightArm: rigArm({ swing: 2.6, spread: 0.12, turn: -0.15, bend: 0.4 }),
  }),
  /** The ball taken at the chest: both hands out in front. */
  glove: rigPose({
    hip: vec(-0.01, 0, 0.45),
    lean: 0.12,
    left: vec(0.08, 0.08, 0),
    right: vec(-0.06, -0.08, 0),
    leftArm: rigArm({ swing: 1.2, spread: 0.12, turn: -0.3, bend: 0.5 }),
    rightArm: rigArm({ swing: 1.0, spread: 0.1, turn: -0.35, bend: 0.75 }),
  }),
  /** A ground ball: down low, the glove at the grass in front of him. */
  scoop: rigPose({
    hip: vec(-0.05, 0, 0.3),
    lean: 0.95,
    nod: -0.4,
    left: vec(0.1, 0.17, 0),
    right: vec(-0.08, -0.15, 0),
    knees: 0.5,
    leftArm: rigArm({ swing: 0.55, spread: 0.12, turn: -0.15, bend: 0.25 }),
    rightArm: rigArm({ swing: 0.35, spread: 0.1, turn: -0.2, bend: 0.4 }),
  }),
  /** The throw: side-on to the target, the arm cocked back and up, the glove pointing. */
  cock: rigPose({
    turn: -1.25,
    hip: vec(0, 0, 0.45),
    lean: -0.08,
    twist: -0.35,
    left: vec(0.08, 0.17, 0),
    right: vec(-0.04, -0.12, 0),
    knees: 0.2,
    leftArm: rigArm({ swing: 1.45, spread: 0.1, turn: 0.15, bend: 0.25 }),
    rightArm: rigArm({ swing: 1.2, spread: 0.2, turn: 1.75, bend: 1.55 }),
  }),
  /** …over the top and through: square to it, the arm coming down across him. */
  release: rigPose({
    turn: 0.25,
    hip: vec(0.04, 0, 0.43),
    lean: 0.42,
    twist: 0.4,
    left: vec(0.1, 0.16, 0),
    right: vec(-0.18, -0.06, 0.06),
    knees: 0.2,
    leftArm: rigArm({ swing: 0.15, spread: 0.3, turn: 0.4, bend: 1.3 }),
    rightArm: rigArm({ swing: 1.65, spread: 0.0, turn: -0.35, bend: 0.25 }),
  }),
};

// MARK: - Motion

/** What a figure faces when it isn't going anywhere: a point it watches; `always`, and it keeps facing it on the move (a backpedal, a drop). */
export interface RigFacing {
  readonly point: Point;
  readonly always?: boolean;
}

/**
 * A foot down: from when it lands to when it lifts, where (the ground under
 * the hips at the middle of it), and which way the body faced then. On a
 * step he comes to rest on (`still`), the ground under him as he stops, and
 * the foot goes where his standing pose puts it: the last stride lands in his
 * stance, the next leaves from it.
 */
export interface RigStep {
  land: number;
  lift: number;
  at: Point;
  heading: number;
  still: boolean;
}

/** A figure's motion at an instant (see `RigTrack`). */
export interface RigMotion {
  readonly heading: number;
  readonly phase: number;
  /** Heights a second. */
  readonly speed: number;
  /** Heights a second, a second. */
  readonly push: number;
  /** Moving at all: 0 standing, 1 on the move. */
  readonly weight: number;
}

/** Feet, both: where each is (see `RigTrack.feet`). */
export interface RigFeet {
  readonly left: RigVector;
  readonly right: RigVector;
}

const F32 = (n: number) => new Float32Array(n);

/**
 * A script's ball, looked up once per instant while its figures are
 * measured (a web addition): every track samples the same 1/60 s grid, so
 * each figure that watches the ball asks for it at the same times.
 */
export function ballMemo<B>(script: { ball(t: number): B }): (t: number) => B {
  const seen = new Map<number, B>();
  return (t) => {
    if (seen.has(t)) return seen.get(t) as B;
    const b = script.ball(t);
    seen.set(t, b);
    return b;
  };
}
const STILL_WEIGHT = Math.fround(0.04);

/**
 * A figure's motion through a script, measured once: every 1/60 s its
 * heading (turning at a limited rate toward where it's going, or what it
 * watches), its speed (in its own heights a second) and push (speeding up,
 * slowing), how far through its stride it is, and how much it's moving at
 * all; and where each foot lands, when it lifts, and where it lands next. Any
 * frame reads it at t.
 */
export class RigTrack {
  static readonly rate = 60;

  start = 0;
  end = 0;
  /** Each sample's heading, phase, speed, push and weight (Swift's `Sample`, in `Float`). */
  heading: Float32Array = F32(0);
  phase: Float32Array = F32(0);
  speed: Float32Array = F32(0);
  push: Float32Array = F32(0);
  weight: Float32Array = F32(0);
  left: RigStep[] = [];
  right: RigStep[] = [];
  /** A standing figure's height in the field's units (feet, metres): a speed in heights a second is a stride's. */
  height = 1;

  get count(): number {
    return this.heading.length;
  }

  /** Standing there, facing `heading`. */
  static standing(at: Point = { x: 0, y: 0 }, heading = 0, height = 1): RigTrack {
    const track = new RigTrack();
    track.heading = Float32Array.of(heading);
    track.phase = F32(1);
    track.speed = F32(1);
    track.push = F32(1);
    track.weight = F32(1);
    track.left = [{ land: -Infinity, lift: Infinity, at, heading, still: true }];
    track.right = [{ ...track.left[0]! }];
    track.height = height;
    return track;
  }

  /**
   * Measured from `start` through `end` (where it holds), for a figure
   * `height` tall at `position`, facing what `facing` says when it isn't
   * moving (or always).
   */
  static measure(start: number, end: number, height: number, position: (t: number) => Point, facing: (t: number) => RigFacing | null): RigTrack {
    const track = new RigTrack();
    track.start = start;
    track.end = end;
    track.height = height;
    const dt = 1 / RigTrack.rate;
    const n = Math.max(Math.ceil((end - start) * RigTrack.rate), 0);
    const time = (i: number) => (i >= n ? end : start + i * dt);
    // Speed and direction from the path, then smoothed both ways (it's all known): a new move's jump in pace eases.
    const raw = new Float64Array(n + 1);
    const ways = new Float64Array(n + 1);
    const spots: Point[] = [];
    let way = 0;
    for (let i = 0; i <= n; i++) {
      const t = time(i);
      const a = position(t - dt / 2);
      const b = position(t + dt / 2);
      spots.push(position(t));
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      raw[i] = d / dt / height;
      if (d / dt > 0.04 * height) way = Math.atan2(b.y - a.y, b.x - a.x);
      ways[i] = way;
    }
    const smoothed = (x: Float64Array, r: number): Float64Array => {
      if (!(r > 0) || x.length <= 2) return x;
      const out = new Float64Array(x.length);
      for (let i = 0; i < x.length; i++) {
        let s = 0;
        let w = 0;
        for (let k = Math.max(i - r, 0); k <= Math.min(i + r, x.length - 1); k++) {
          const c = r + 1 - Math.abs(k - i);
          s += x[k]! * c;
          w += c;
        }
        out[i] = s / w;
      }
      return out;
    };
    const speeds = smoothed(raw, 5);
    const slopes = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const hi = Math.min(i + 1, n);
      const lo = Math.max(i - 1, 0);
      slopes[i] = (speeds[hi]! - speeds[lo]!) / ((hi - lo) * dt);
    }
    const pushes = smoothed(slopes, 6);
    // Their first look at what they face.
    const first = facing(start);
    let heading: number;
    if (speeds[0]! > 0.3 && !(first?.always ?? false)) heading = ways[0]!;
    else if (first) {
      const p = first.point;
      const s0 = spots[0]!;
      heading = Math.hypot(p.x - s0.x, p.y - s0.y) > 1e-6 ? Math.atan2(p.y - s0.y, p.x - s0.x) : ways[0]!;
    } else heading = ways[0]!;
    let phase = 0;
    track.heading = F32(n + 1);
    track.phase = F32(n + 1);
    track.speed = F32(n + 1);
    track.push = F32(n + 1);
    track.weight = F32(n + 1);
    for (let i = 0; i <= n; i++) {
      const t = time(i);
      const v = speeds[i]!;
      if (i > 0) {
        // Turning: toward where it's going, else what it watches; quickly standing, wider at a sprint.
        const face = facing(t);
        let goal: number | null = null;
        if (v > 0.3 && face?.always !== true) goal = ways[i]!;
        else if (face) {
          const p = face.point;
          const s = spots[i]!;
          if (Math.hypot(p.x - s.x, p.y - s.y) > 0.05 * height) goal = Math.atan2(p.y - s.y, p.x - s.x);
        }
        if (goal != null) {
          const gap = remainder(goal - heading, 2 * Math.PI);
          const fastest = 11 - 5 * RigGait.run(v);
          heading += clamp(gap * 16, -fastest, fastest) * dt;
        }
        // The stride: as far as the ground covered asks; stopped, it finishes its step (both feet down).
        let cadence = RigGait.cadence(v) * Rig.smooth(v / 0.12);
        const duty = RigGait.duty(v);
        const a = phase - Math.floor(phase);
        const down = a < duty - 0.5 || (a >= 0.5 && a < duty);
        if (v < 0.15 && !down) cadence = Math.max(cadence, 1.8);
        phase += cadence * dt;
      }
      // At the end it's still: the frame it holds.
      const weight = Rig.smooth(speeds[i]! / 0.35) * Rig.smooth((end - t) / 0.2);
      track.heading[i] = heading;
      track.phase[i] = phase;
      track.speed[i] = v;
      track.push[i] = pushes[i]!;
      track.weight[i] = weight;
    }
    // The steps: each foot lands as its part of the stride comes round, and lifts after its share.
    for (const [side, offset] of [
      [0, 0],
      [1, 0.5],
    ] as const) {
      const steps: RigStep[] = [{ land: -Infinity, lift: Infinity, at: spots[0]!, heading: track.heading[0]!, still: false }];
      let count = Math.floor(offset);
      let down = true;
      for (let i = 1; i <= n; i++) {
        const a = track.phase[i - 1]! + offset;
        const b = track.phase[i]! + offset;
        if (!(b > a)) continue;
        const when = (x: number) => time(i - 1) + ((time(i) - time(i - 1)) * (x - a)) / (b - a);
        const duty = RigGait.duty(speeds[i]!);
        if (down && b - count >= duty) {
          steps[steps.length - 1]!.lift = when(Math.max(count + duty, a));
          down = false;
        }
        if (!down && Math.floor(b) > count) {
          count = Math.floor(b);
          steps.push({ land: when(count), lift: Infinity, at: { x: 0, y: 0 }, heading: 0, still: false });
          down = true;
        }
      }
      // Each foot lands under where the hips will be halfway through its time down; or where he stands, if he stops on it.
      for (let k = 0; k < steps.length; k++) {
        const s = steps[k]!;
        const from = Math.ceil((Math.max(s.land, start) - start) * RigTrack.rate);
        const to = Math.floor((Math.min(s.lift, end) - start) * RigTrack.rate);
        let still = -1;
        if (from <= to) {
          for (let i = Math.max(from, 0); i <= Math.max(Math.min(to, n), 0); i++) {
            if (track.weight[i]! < STILL_WEIGHT) {
              still = i;
              break;
            }
          }
        }
        if (still >= 0) {
          s.still = true;
          s.at = spots[still]!;
          s.heading = track.heading[still]!;
        } else if (k > 0) {
          const middle = Number.isFinite(s.lift) ? (s.land + s.lift) / 2 : s.land + (0.5 * RigGait.duty(0)) / RigGait.cadence(0);
          const m = clamp(middle, start, end);
          s.at = position(m);
          s.heading = track.sample(m).heading;
        }
      }
      if (side === 0) track.left = steps;
      else track.right = steps;
    }
    return track;
  }

  private sample(t: number): RigMotion {
    const count = this.count;
    if (count === 0) return { heading: 0, phase: 0, speed: 0, push: 0, weight: 0 };
    const at = (i: number): RigMotion => ({ heading: this.heading[i]!, phase: this.phase[i]!, speed: this.speed[i]!, push: this.push[i]!, weight: this.weight[i]! });
    if (!(t > this.start)) return at(0);
    if (!(t < this.end) || count <= 1) return at(count - 1);
    // Every 1/60 s, the last at the end.
    const i = Math.min(Math.floor((t - this.start) * RigTrack.rate), count - 2);
    const t0 = this.start + i / RigTrack.rate;
    const t1 = i + 2 === count ? this.end : t0 + 1 / RigTrack.rate;
    // In Float, as Swift's samples are.
    const f = Math.fround;
    const u = f(clamp((t - t0) / Math.max(t1 - t0, 1e-9), 0, 1));
    const h = this.heading[i]!;
    const turn = f(remainder(f(this.heading[i + 1]! - h), 2 * Math.PI));
    const lerp = (x: Float32Array) => f(x[i]! + f(f(x[i + 1]! - x[i]!) * u));
    return { heading: f(h + f(turn * u)), phase: lerp(this.phase), speed: lerp(this.speed), push: lerp(this.push), weight: lerp(this.weight) };
  }

  /** The motion at t (t = ∞: how it ends). */
  motion(t: number): RigMotion {
    return this.sample(t);
  }

  /**
   * Where each foot is at t, in the frame of `heading` from `anchor` (the
   * ground under the hips), `unit` body units to the field's: planted, or on
   * its way from one plant to the next, lifting as it goes; where he stands
   * still, where `stand` (his standing pose's feet) puts them.
   */
  feet(t: number, anchor: Point, heading: number, unit: number, speed: number, stand: RigFeet): RigFeet {
    const run = RigGait.run(speed);
    // A walk barely lifts its foot; a run folds the heel up behind early in its swing.
    const lift = 0.05 + 0.17 * run + 0.06 * RigGait.sprint(speed);
    const peak = 0.48 - 0.13 * run;
    const curve = Math.log(0.5) / Math.log(peak);
    const c = Math.cos(-heading);
    const sn = Math.sin(-heading);
    const foot = (steps: readonly RigStep[], side: number, standing: RigVector): RigVector => {
      if (steps.length === 0) return standing;
      // Where a step puts the foot, from the anchor, along the field's axes.
      const place = (s: RigStep): [number, number] => {
        const fx = s.still ? standing.x : 0;
        const fy = s.still ? standing.y : side * Rig.stance;
        const hc = Math.cos(s.heading);
        const hs = Math.sin(s.heading);
        return [(s.at.x - anchor.x) * unit + (fx * hc - fy * hs), (s.at.y - anchor.y) * unit + (fx * hs + fy * hc)];
      };
      let lo = 0;
      let hi = steps.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (steps[mid]!.land <= t) lo = mid;
        else hi = mid - 1;
      }
      const s = steps[lo]!;
      let [x, y] = place(s);
      let z = 0;
      if (t >= s.lift && lo + 1 < steps.length) {
        const next = steps[lo + 1]!;
        const w = clamp((t - s.lift) / Math.max(next.land - s.lift, 1e-6), 0, 1);
        // Smootherstep: still as it lifts and as it lands, so neither slides.
        const e = w * w * w * (w * (w * 6 - 15) + 10);
        const [nx, ny] = place(next);
        x += (nx - x) * e;
        y += (ny - y) * e;
        z = lift * Math.sin(Math.PI * Math.pow(w, curve));
        // Never further from the hips than a leg swings: a replay's fast-forward run strides long, not into the splits.
        const r = Math.hypot(x, y);
        const knee = 0.24;
        const most = 0.36;
        if (r > knee) {
          const k = (knee + (most - knee) * Math.tanh((r - knee) / (most - knee))) / r;
          x *= k;
          y *= k;
        }
      }
      return vec(x * c - y * sn, x * sn + y * c, z);
    };
    return { left: foot(this.left, 1, stand.left), right: foot(this.right, -1, stand.right) };
  }
}

/** The stride by speed (in heights a second): one smooth curve from a walk to a sprint. */
export const RigGait = {
  /** Strides a second (each foot once): a brisk walk's two, a sprint's three and a half, the replay's fastest no more than four and a half. */
  cadence(v: number): number {
    return 1.0 + (4.2 * v) / (v + 5.5);
  },

  /** How much of its stride each foot is down: most of a walk, a fifth of a sprint, and never more ground than a leg can reach under the hips. */
  duty(v: number): number {
    const walking = 0.64 - 0.4 * Rig.smooth((v - 0.8) / 4.2);
    return Math.max(Math.min(walking, (0.36 * RigGait.cadence(v)) / Math.max(v * 1.1, 1e-6)), 0.08);
  },

  /** How much of a run it is (0 a walk), and of a sprint. */
  run(v: number): number {
    return Rig.smooth((v - 1.2) / 2.2);
  },
  sprint(v: number): number {
    return Rig.smooth((v - 4) / 4.5);
  },
};

/**
 * On the move: the legs reaching for their planted feet (the hips as high as
 * both can reach, bobbing with the stride), the arms swinging against the
 * legs, leaning into the run and into a push.
 */
export function gait(m: RigMotion, feet: RigFeet): RigPose {
  const v = m.speed;
  const run = RigGait.run(v);
  const sprint = RigGait.sprint(v);
  const duty = RigGait.duty(v);
  // Each leg through its stride: 0 landing, π lifting, 2π landing again; cos, how far forward it is.
  const cycle = (x: number) => {
    const a = x - Math.floor(x);
    return a < duty ? (Math.PI * a) / duty : Math.PI + (Math.PI * (a - duty)) / (1 - duty);
  };
  const l = cycle(m.phase);
  const r = cycle(m.phase + 0.5);
  // The pelvis turns with the leg going forward; the shoulders against it.
  const turn = (0.09 * run * (Math.cos(r) - Math.cos(l))) / 2;
  const twist = -2.2 * turn;
  const lean = 0.05 + 0.2 * run + 0.1 * sprint + clamp(m.push * 0.02, -0.12, 0.18);
  // Lowest as a foot takes the weight in a run, highest over it in a walk.
  const bob = (0.022 * run - 0.012 * (1 - run)) * Math.cos(2 * l);
  let height = Rig.stand - 0.02 * run - 0.01 * sprint + bob;
  const leg = (Rig.thigh + Rig.shin) * 0.995;
  for (const [foot, side] of [
    [feet.left, 1],
    [feet.right, -1],
  ] as const) {
    const joint = Rig.yaw(vec(0, side * Rig.hips, 0), turn);
    const across = Math.hypot(foot.x - joint.x, foot.y - joint.y);
    const reach = foot.z + Math.sqrt(Math.max(leg * leg - across * across, 0.0004));
    // A soft minimum: the hips settle into the reach, never kink at it.
    height = (height + reach - Math.sqrt((height - reach) * (height - reach) + 0.0004)) / 2;
  }
  // The arms: against the legs, a touch behind them; bent more the faster he goes, most on the way forward.
  const swing = 0.3 + 0.42 * run + 0.25 * sprint;
  const arm = (phase: number): RigArm => {
    const a = -swing * Math.cos(phase - 0.3);
    return { swing: a, spread: 0.1 + 0.06 * run, turn: -0.15 * run, bend: 0.25 + 1.1 * run + 0.15 * sprint + (0.35 * run * Math.max(a, 0)) / swing };
  };
  return rigPose({
    turn,
    twist,
    lean,
    left: feet.left,
    right: feet.right,
    // Never a crouch: past its reach, a foot trails.
    hip: vec(0, 0, Math.max(height, Rig.stand - 0.12)),
    leftArm: arm(l),
    rightArm: arm(r),
  });
}

// MARK: - Skeleton

/** A pose put together: each joint in the frame of the heading, from the ground point under the figure. Pairs are left then right. */
export interface RigSkeleton {
  readonly hip: RigVector;
  readonly neck: RigVector;
  readonly head: RigVector;
  readonly hips: readonly [RigVector, RigVector];
  readonly knees: readonly [RigVector, RigVector];
  readonly feet: readonly [RigVector, RigVector];
  readonly shoulders: readonly [RigVector, RigVector];
  readonly elbows: readonly [RigVector, RigVector];
  readonly hands: readonly [RigVector, RigVector];
  /** Each knee's forward and each elbow's hinge: the joint limits (tested). */
  readonly kneeForward: readonly [RigVector, RigVector];
  readonly elbowAxis: readonly [RigVector, RigVector];
}

const X = vec(1, 0, 0);
const Y = vec(0, 1, 0);
const Z = vec(0, 0, 1);

export function skeleton(p: RigPose): RigSkeleton {
  const hip = p.hip;
  // The legs: from each hip to its foot, the knees forward (turned out a little).
  const leg = (foot: RigVector, side: number) => {
    const joint = plus(hip, Rig.yaw(vec(0, side * Rig.hips, 0), p.turn));
    const target = Math.abs(p.pitch) < 0.3 && Math.abs(p.bank) < 0.3 ? vec(foot.x, foot.y, Math.max(foot.z, 0)) : foot;
    // Forward, turned out, and a touch up: a thigh out in front still bends its knee up, not down.
    const f = Rig.yaw(X, p.turn + side * p.knees);
    const forward = vec(f.x, f.y, f.z + 0.15);
    const { joint: knee, end } = Rig.reach(joint, target, forward, Rig.thigh, Rig.shin);
    return { hip: joint, knee, foot: end, forward };
  };
  const l = leg(p.left, 1);
  const r = leg(p.right, -1);
  // The torso over the pelvis, the shoulders twisted on it, the head on the spine (its axes found once).
  const rotated = (v: RigVector) => Rig.yaw(Rig.pitch(Rig.roll(Rig.yaw(v, p.twist), p.roll), p.lean), p.turn);
  const tx = rotated(X);
  const ty = rotated(Y);
  const tz = rotated(Z);
  const torso = (v: RigVector) => vec(tx.x * v.x + ty.x * v.y + tz.x * v.z, tx.y * v.x + ty.y * v.y + tz.y * v.z, tx.z * v.x + ty.z * v.y + tz.z * v.z);
  const neck = plus(hip, torso(vec(0, 0, Rig.spine)));
  const head = plus(neck, torso(Rig.pitch(vec(0, 0, Rig.neck), p.nod)));
  const arm = (a: RigArm, side: number) => {
    const shoulder = plus(neck, torso(vec(0, side * Rig.shoulders, -0.025)));
    const bones = armBones(a, side);
    const elbow = plus(shoulder, times(torso(bones.upper), Rig.upperArm));
    const axis = Rig.yaw(Rig.roll(Y, -side * a.spread), side * a.turn);
    return { shoulder, elbow, hand: plus(elbow, times(torso(bones.fore), Rig.forearm)), axis: torso(axis) };
  };
  const la = arm(p.leftArm, 1);
  const ra = arm(p.rightArm, -1);
  // Tipped whole round the pelvis.
  const tipped = p.pitch !== 0 || p.bank !== 0;
  const tilt = (v: RigVector) => Rig.yaw(Rig.roll(Rig.pitch(Rig.yaw(v, -p.turn), p.pitch), p.bank), p.turn);
  const ux = tipped ? tilt(X) : X;
  const uy = tipped ? tilt(Y) : Y;
  const uz = tipped ? tilt(Z) : Z;
  const turned = (v: RigVector) => (tipped ? vec(ux.x * v.x + uy.x * v.y + uz.x * v.z, ux.y * v.x + uy.y * v.y + uz.y * v.z, ux.z * v.x + uy.z * v.y + uz.z * v.z) : v);
  const tip = (v: RigVector) => (tipped ? plus(hip, turned(minus(v, hip))) : v);
  return {
    hip,
    neck: tip(neck),
    head: tip(head),
    hips: [tip(l.hip), tip(r.hip)],
    knees: [tip(l.knee), tip(r.knee)],
    feet: [tip(l.foot), tip(r.foot)],
    shoulders: [tip(la.shoulder), tip(ra.shoulder)],
    elbows: [tip(la.elbow), tip(ra.elbow)],
    hands: [tip(la.hand), tip(ra.hand)],
    kneeForward: [turned(l.forward), turned(r.forward)],
    elbowAxis: [turned(la.axis), turned(ra.axis)],
  };
}
