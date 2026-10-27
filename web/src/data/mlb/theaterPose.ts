/**
 * The play theater's figures (PlayTheater.swift `Pose`, `Figure`): each
 * limb's angle in radians from straight down, positive toward screen right
 * (a shin or forearm absolute, not from its joint), and the torso's lean from
 * upright. "Near" limbs draw in front of the body, "far" ones behind. Poses
 * are written facing right; `facing` mirrors them. Simple and few:
 * pictograms, not clip art. Pure geometry, so the renderer only strokes.
 */
import type { Point } from "./theaterField";

export interface Pose {
  readonly lean: number;
  readonly nearThigh: number;
  readonly nearShin: number;
  readonly farThigh: number;
  readonly farShin: number;
  readonly nearUpper: number;
  readonly nearFore: number;
  readonly farUpper: number;
  readonly farFore: number;
  /** Off the ground (a stride's bob), in figure heights. */
  readonly lift: number;
}

const DEFAULT: Pose = { lean: 0, nearThigh: 0.1, nearShin: 0.05, farThigh: -0.1, farShin: -0.05, nearUpper: 0.18, nearFore: 0.1, farUpper: -0.18, farFore: -0.1, lift: 0 };

const pose = (p: Partial<Pose>): Pose => ({ ...DEFAULT, ...p });

const JOINTS = ["lean", "nearThigh", "nearShin", "farThigh", "farShin", "nearUpper", "nearFore", "farUpper", "farFore"] as const;

export function facing(p: Pose, f: number): Pose {
  if (!(f < 0)) return p;
  return {
    lean: -p.lean,
    nearThigh: -p.nearThigh,
    nearShin: -p.nearShin,
    farThigh: -p.farThigh,
    farShin: -p.farShin,
    nearUpper: -p.nearUpper,
    nearFore: -p.nearFore,
    farUpper: -p.farUpper,
    farFore: -p.farFore,
    lift: p.lift,
  };
}

/** Part way to another pose, each joint the short way round. */
export function mixPose(a: Pose, b: Pose, u: number): Pose {
  if (!(u > 0)) return a;
  if (!(u < 1)) return b;
  const m = (x: number, y: number) => {
    let d = (y - x) % (2 * Math.PI);
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    return x + d * u;
  };
  const out: Record<string, number> = { lift: a.lift + (b.lift - a.lift) * u };
  for (const j of JOINTS) out[j] = m(a[j], b[j]);
  return out as unknown as Pose;
}

export const samePose = (a: Pose, b: Pose) => JOINTS.every((j) => a[j] === b[j]) && a.lift === b.lift;

export const Poses = {
  // Standing, front on: an outfielder, a runner at rest.
  stand: DEFAULT,
  /** Front on, knees bent, hands low: an infielder as the pitch comes. */
  ready: pose({ lean: 0, nearThigh: 0.55, nearShin: -0.1, farThigh: -0.55, farShin: 0.1, nearUpper: 0.45, nearFore: 0.05, farUpper: -0.45, farFore: -0.05 }),
  /** The catcher's squat, the mitt up as a target. */
  squat: pose({ lean: 0, nearThigh: 1.3, nearShin: 0.12, farThigh: -1.3, farShin: -0.12, nearUpper: 1.15, nearFore: 2.3, farUpper: -0.7, farFore: -0.3 }),
  /** Leading off a base: low, facing the next one. */
  lead: pose({ lean: 0.25, nearThigh: 0.6, nearShin: 0.1, farThigh: -0.55, farShin: -0.1, nearUpper: 0.5, nearFore: 0.3, farUpper: -0.35, farFore: -0.2 }),
  /** Feet first: leaning back, the lead leg out to the bag, the other folded under. */
  slide: pose({ lean: -1.05, nearThigh: 1.38, nearShin: 1.52, farThigh: 0.95, farShin: -1.5, nearUpper: -2.5, nearFore: -2.9, farUpper: 0.7, farFore: 1.0 }),
  // Fielding.
  scoop: pose({ lean: 0.95, nearThigh: 0.95, nearShin: 0.15, farThigh: -0.7, farShin: -0.25, nearUpper: 0.4, nearFore: 0.3, farUpper: 0.2, farFore: 0.05 }),
  catchHigh: pose({ lean: -0.05, nearThigh: 0.12, nearShin: 0.05, farThigh: -0.12, farShin: -0.05, nearUpper: 2.85, nearFore: 3.0, farUpper: 2.55, farFore: 2.85 }),
  glove: pose({ lean: 0.2, nearThigh: 0.75, nearShin: 0.5, farThigh: -0.25, farShin: -0.15, nearUpper: 1.45, nearFore: 1.65, farUpper: 0.35, farFore: 0.6 }),
  cock: pose({ lean: -0.12, nearThigh: 0.55, nearShin: 0.25, farThigh: -0.45, farShin: -0.35, nearUpper: 1.35, nearFore: 1.5, farUpper: -2.05, farFore: -2.85 }),
  release: pose({ lean: 0.5, nearThigh: 0.45, nearShin: 0.1, farThigh: -1.0, farShin: -1.6, nearUpper: -0.35, nearFore: -0.15, farUpper: 0.9, farFore: 0.55 }),
  // The pitcher's delivery: set, the leg kick, the stride with the arm cocked, the release over the top, the follow-through.
  set: pose({ lean: 0, nearThigh: 0.06, nearShin: 0.03, farThigh: -0.06, farShin: -0.03, nearUpper: 0.3, nearFore: 1.85, farUpper: 0.2, farFore: 1.9 }),
  kick: pose({ lean: -0.1, nearThigh: 1.6, nearShin: 0.2, farThigh: 0, farShin: 0, nearUpper: 0.35, nearFore: 1.9, farUpper: 0.25, farFore: 1.95 }),
  stride: pose({ lean: 0.15, nearThigh: 0.9, nearShin: 0.4, farThigh: -0.6, farShin: -0.7, nearUpper: 1.45, nearFore: 1.3, farUpper: -2.0, farFore: -2.9 }),
  deliver: pose({ lean: 0.45, nearThigh: 0.75, nearShin: 0.2, farThigh: -0.8, farShin: -1.3, nearUpper: 0.6, nearFore: 0.9, farUpper: -3.85, farFore: -4.05 }),
  follow: pose({ lean: 0.75, nearThigh: 0.55, nearShin: 0.1, farThigh: -1.25, farShin: -1.95, nearUpper: -0.3, nearFore: 0.2, farUpper: 0.55, farFore: 0.25 }),
  // The batter: the stance, the bat through the zone, the finish over the front shoulder.
  stance: pose({ lean: 0.15, nearThigh: 0.42, nearShin: 0.12, farThigh: -0.38, farShin: -0.1, nearUpper: -0.35, nearFore: -2.45, farUpper: -0.15, farFore: -2.25 }),
  contact: pose({ lean: 0.05, nearThigh: 0.38, nearShin: 0.3, farThigh: -0.45, farShin: -0.8, nearUpper: 1.3, nearFore: 1.45, farUpper: 1.1, farFore: 1.35 }),
  finish: pose({ lean: -0.1, nearThigh: 0.32, nearShin: 0.26, farThigh: -0.4, farShin: -1.05, nearUpper: 2.6, nearFore: -2.6, farUpper: 2.4, farFore: -2.4 }),

  /** A running stride at phase φ (radians): legs scissor, arms pump opposite, a bob. */
  run(phase: number): Pose {
    const leg = (p: number): [number, number] => {
      const thigh = 0.1 + 0.72 * Math.sin(p);
      // The trailing leg folds up behind; the leading one reaches.
      return [thigh, thigh - 0.25 - 1.15 * Math.max(0, -Math.cos(p - 0.5))];
    };
    const near = leg(phase);
    const far = leg(phase + Math.PI);
    const s = Math.sin(phase);
    return {
      lean: 0.32,
      nearThigh: near[0],
      nearShin: near[1],
      farThigh: far[0],
      farShin: far[1],
      nearUpper: -0.8 * s,
      nearFore: -0.8 * s + 1.55,
      farUpper: 0.8 * s,
      farFore: 0.8 * s + 1.55,
      lift: 0.04 * Math.abs(Math.cos(phase)),
    };
  },

  walk(phase: number): Pose {
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    return {
      lean: 0.05,
      nearThigh: 0.32 * s,
      nearShin: 0.32 * s - 0.2 * Math.max(0, -c),
      farThigh: -0.32 * s,
      farShin: -0.32 * s - 0.2 * Math.max(0, c),
      nearUpper: -0.28 * s,
      nearFore: -0.28 * s + 0.35,
      farUpper: 0.28 * s,
      farFore: 0.28 * s + 0.35,
      lift: 0,
    };
  },
};

/** A pose put on a figure: where its joints are, in points (y down, as drawn). */
export interface Figure {
  readonly head: Point;
  readonly headRadius: number;
  readonly neck: Point;
  readonly hip: Point;
  readonly near: { readonly knee: Point; readonly foot: Point; readonly elbow: Point; readonly hand: Point };
  readonly far: { readonly knee: Point; readonly foot: Point; readonly elbow: Point; readonly hand: Point };
  /** Stroke widths. */
  readonly torso: number;
  readonly limb: number;
}

/** The pose standing on `foot` (the ground point), `height` points tall. */
export function figure(p: Pose, foot: Point, height: number): Figure {
  const s = height / 1.1;
  const down = (from: Point, angle: number, length: number): Point => ({ x: from.x + Math.sin(angle) * length, y: from.y - Math.cos(angle) * length });
  // Built in units from the hip (y up), then stood on the lower foot.
  const origin = { x: 0, y: 0 };
  const nearKnee = down(origin, p.nearThigh, 0.25);
  const nearFoot = down(nearKnee, p.nearShin, 0.25);
  const farKnee = down(origin, p.farThigh, 0.25);
  const farFoot = down(farKnee, p.farShin, 0.25);
  const shoulder = { x: Math.sin(p.lean) * 0.3, y: Math.cos(p.lean) * 0.3 };
  const headCenter = { x: shoulder.x + Math.sin(p.lean) * 0.2, y: shoulder.y + Math.cos(p.lean) * 0.2 };
  const nearElbow = down(shoulder, p.nearUpper, 0.18);
  const nearHand = down(nearElbow, p.nearFore, 0.17);
  const farElbow = down(shoulder, p.farUpper, 0.18);
  const farHand = down(farElbow, p.farFore, 0.17);
  const groundY = Math.min(nearFoot.y, farFoot.y) - p.lift;
  const pt = (q: Point): Point => ({ x: foot.x + q.x * s, y: foot.y - (q.y - groundY) * s });
  return {
    head: pt(headCenter),
    headRadius: Math.max(0.115 * s, 1.5),
    neck: pt(shoulder),
    hip: pt(origin),
    near: { knee: pt(nearKnee), foot: pt(nearFoot), elbow: pt(nearElbow), hand: pt(nearHand) },
    far: { knee: pt(farKnee), foot: pt(farFoot), elbow: pt(farElbow), hand: pt(farHand) },
    torso: Math.max(0.19 * s, 2),
    limb: Math.max(0.085 * s, 1.1),
  };
}
