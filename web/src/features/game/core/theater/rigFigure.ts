/**
 * The rig on screen (TheaterRig.swift § Projection and § Figure; TheaterKit.swift
 * `FigureInks` and `TheaterDraw.figure`): how each theater's projection
 * sees a figure where it stands (`RigLens`: the ballpark's and the
 * gridiron's dimetric view, the pitch in perspective), a posed skeleton
 * projected with its limbs sorted by depth (`RigFigure`), and the pictogram
 * drawn rim first, the limbs behind the body shaded by how far behind, those
 * in front over an inner rim of their own. Shared by all three theaters, and
 * small, so the baseball theater's chunk takes it without the football and
 * soccer kit (theaterKit.ts). The pose math is data/theater/rig.ts.
 *
 * Called per frame, per figure: plain arithmetic, no allocation beyond the
 * figure's own points; inks are resolved once per uniform and scheme.
 */
import type { Point } from "../../../../data/mlb/theaterField";
import type { Uniform } from "../../../../data/mlb/theaterTeams";
import { Rig, skeleton, type RigPose, type RigSkeleton, type RigVector } from "../../../../data/theater/rig";
import type { PitchProjection } from "../../../../data/theater/soccerTheater";
import type { FieldProjection } from "./fieldProjection";
import { hexRGB, mixHex, rgba, type TheaterInk } from "../../mlb/theater/theaterInk";

type Ctx = CanvasRenderingContext2D;

// MARK: - Projection

/** The gridiron's projection (drawFootball.ts `GridProjection`): FieldProjection's view of the ground turned by a yaw. */
interface Turned {
  readonly f: FieldProjection;
  readonly yaw: number;
}

/**
 * How a theater sees a figure where it stands: the screen point under it,
 * the screen offset of a body unit along the field's x, y and up, body units
 * to the field's (so a planted foot lands exactly on its spot), and which way
 * the camera looks (what's further along it is drawn first).
 */
export class RigLens {
  constructor(
    readonly origin: Point,
    readonly x: Point,
    readonly y: Point,
    readonly z: Point,
    readonly unit: number,
    readonly view: RigVector,
    /** The figure standing, in points. */
    readonly height: number,
  ) {}

  point(p: RigVector): Point {
    return { x: this.origin.x + this.x.x * p.x + this.y.x * p.y + this.z.x * p.z, y: this.origin.y + this.x.y * p.x + this.y.y * p.y + this.z.y * p.z };
  }

  /** The ballpark's and the gridiron's dimetric view: the ground squashed to half height (turned by `yaw` first), the figure upright at its full height. */
  static field(f: FieldProjection, p: Point, yaw = 0): RigLens {
    const s = f.figure / 1.1;
    const c = Math.cos(yaw);
    const n = Math.sin(yaw);
    // Gridiron.view: the ground as the camera's projection takes it.
    const origin = f.point({ x: p.x * c + p.y * n, y: -p.x * n + p.y * c });
    // From behind and above (the half-height ground is a 30° look down): further is up the field and lower.
    return new RigLens(origin, { x: c * s, y: 0.5 * n * s }, { x: n * s, y: -0.5 * c * s }, { x: 0, y: -s }, f.scale / s, { x: -n * 0.866, y: c * 0.866, z: -0.5 }, f.figure);
  }

  static grid(f: Turned, p: Point): RigLens {
    return RigLens.field(f.f, p, f.yaw);
  }

  /** The pitch in perspective: the ground as the lens sees it round the figure's feet (smaller further off), the figure upright. */
  static pitch(f: PitchProjection, p: Point): RigLens {
    const ground = { x: p.x, y: p.y, z: 0 };
    const height = f.figure(p);
    const s = height / 1.1;
    const b = f.basis;
    const dx = ground.x - b.eye.x;
    const dy = ground.y - b.eye.y;
    const dz = ground.z - b.eye.z;
    const d = { x: dx, y: dy, z: dz };
    const dotv = (a: RigVector, e: RigVector) => a.x * e.x + a.y * e.y + a.z * e.z;
    const depth = Math.max(dotv(d, b.forward), 0.5);
    const u = dotv(d, b.right) / depth;
    const v = dotv(d, b.up) / depth;
    const unit = f.scale(ground) / s;
    // The lens's rate of change along each axis, per metre, in points; then per body unit.
    const along = (e: RigVector): Point => {
      const forward = dotv(e, b.forward);
      return { x: (f.focal * (dotv(e, b.right) - u * forward)) / depth / unit, y: (-f.focal * (dotv(e, b.up) - v * forward)) / depth / unit };
    };
    return new RigLens(f.point(ground), along({ x: 1, y: 0, z: 0 }), along({ x: 0, y: 1, z: 0 }), { x: 0, y: -s }, unit, b.forward, height);
  }
}

// MARK: - Figure

/** A limb on screen, root to joint to end. */
export interface RigLimb {
  root: Point;
  joint: Point;
  end: Point;
  /** 0: level with the body or in front; up to `SHADES − 1`, well behind it. */
  readonly shade: number;
  readonly front: boolean;
  readonly depth: number;
}

/** Steps of shade for a limb behind the body. */
export const SHADES = 5;

/**
 * A pose on screen: its joints projected, its limbs in the order they're
 * drawn (behind the body first, shaded by how far behind; then those in
 * front), the stroke widths, and its shadow's place.
 */
export interface RigFigure {
  hip: Point;
  neck: Point;
  head: Point;
  readonly headRadius: number;
  /** Behind to in front: legs then arms by depth. */
  readonly limbs: RigLimb[];
  hands: readonly [Point, Point];
  /** Stroke widths. */
  readonly torso: number;
  readonly limb: number;
  /** The ground under the hips, and how far the lower foot is off it (body units). */
  readonly ground: Point;
  readonly air: number;
}

/** A pose (or a skeleton already put together) turned to `heading` and seen through `lens`. */
export function rigFigure(pose: RigPose | RigSkeleton, heading: number, lens: RigLens): RigFigure {
  const k = "kneeForward" in pose ? pose : skeleton(pose);
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const v = lens.view;
  const screen = (p: RigVector): Point => {
    const wx = p.x * c - p.y * s;
    const wy = p.x * s + p.y * c;
    return { x: lens.origin.x + lens.x.x * wx + lens.y.x * wy + lens.z.x * p.z, y: lens.origin.y + lens.x.y * wx + lens.y.y * wy + lens.z.y * p.z };
  };
  const scale = lens.height / 1.1;
  // Each limb against the body: which side of the spine it's on, toward the camera or away.
  let sx = k.neck.x - k.hip.x;
  let sy = k.neck.y - k.hip.y;
  let sz = k.neck.z - k.hip.z;
  const length = Math.max(Math.sqrt(sx * sx + sy * sy + sz * sz), 1e-9);
  sx /= length;
  sy /= length;
  sz /= length;
  const part = (a: RigVector, b: RigVector, e: RigVector): RigLimb => {
    const px = (a.x + 2 * b.x + e.x) / 4 - k.hip.x;
    const py = (a.y + 2 * b.y + e.y) / 4 - k.hip.y;
    const pz = (a.z + 2 * b.z + e.z) / 4 - k.hip.z;
    const along = px * sx + py * sy + pz * sz;
    const qx = px - sx * along;
    const qy = py - sy * along;
    const qz = pz - sz * along;
    // Its depth along the camera's look, the limb turned to the heading.
    const d = (qx * c - qy * s) * v.x + (qx * s + qy * c) * v.y + qz * v.z;
    // Swift's `.rounded()`: half away from zero (never negative here).
    const shade = Math.round(Math.min(Math.max(d / 0.05, 0), 1) * (SHADES - 1));
    return { root: screen(a), joint: screen(b), end: screen(e), shade, front: d < 0, depth: d };
  };
  const limbs = [
    part(k.hips[0], k.knees[0], k.feet[0]),
    part(k.hips[1], k.knees[1], k.feet[1]),
    part(k.shoulders[0], k.elbows[0], k.hands[0]),
    part(k.shoulders[1], k.elbows[1], k.hands[1]),
  ].sort((p, q) => q.depth - p.depth);
  return {
    hip: screen(k.hip),
    neck: screen(k.neck),
    head: screen(k.head),
    headRadius: Math.max(Rig.head * scale, 1.5),
    torso: Math.max(0.19 * scale, 2),
    limb: Math.max(0.085 * scale, 1.1),
    hands: [screen(k.hands[0]), screen(k.hands[1])],
    ground: screen({ x: k.hip.x, y: k.hip.y, z: 0 }),
    air: Math.max(Math.min(k.feet[0].z, k.feet[1].z), 0),
    limbs,
  };
}

/** Between the hands: where a bat or a held ball is. */
export const grip = (f: RigFigure): Point => ({ x: (f.hands[0].x + f.hands[1].x) / 2, y: (f.hands[0].y + f.hands[1].y) / 2 });

/** Moved on screen (a keeper's hands taken to the ball). */
export function shift(f: RigFigure, dx: number, dy: number): void {
  const moved = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  f.hip = moved(f.hip);
  f.neck = moved(f.neck);
  f.head = moved(f.head);
  f.hands = [moved(f.hands[0]), moved(f.hands[1])];
  for (const l of f.limbs) {
    l.root = moved(l.root);
    l.joint = moved(l.joint);
    l.end = moved(l.end);
  }
}

// MARK: - Drawn

/**
 * A team's inks, resolved once per uniform and scheme (FigureInks):
 * resolving a team color per stroke was most of a frame's cost. A limb behind
 * the body is the jersey shaded by how far behind it is (a few steps, from
 * the jersey to its deepest shade).
 */
export interface FigureInks {
  readonly rim: string;
  readonly inner: string;
  readonly jersey: string;
  readonly cap: string;
  readonly shades: readonly string[];
}

const inkCache = new WeakMap<Uniform, Map<string, FigureInks>>();

export function figureInks(u: Uniform, ink: TheaterInk): FigureInks {
  const key = ink.dark ? "dark" : "light";
  let byScheme = inkCache.get(u);
  if (!byScheme) {
    byScheme = new Map();
    inkCache.set(u, byScheme);
  }
  const cached = byScheme.get(key);
  if (cached) return cached;
  const rim = u.piping ?? ink.halo;
  const inner = u.piping ? rgba(hexRGB(u.piping), 0.7 * (u.piping.length > 7 ? Number.parseInt(u.piping.slice(7, 9), 16) / 255 : 1)) : ink.dark ? "rgb(0 0 0 / 0.35)" : "rgb(255 255 255 / 0.63)";
  const deepest = ink.dark ? 0.32 : 0.22;
  const steps = SHADES - 1;
  const shades = Array.from({ length: SHADES }, (_, k) => (k === 0 ? u.jersey : mixHex(u.jersey, "#000000", (deepest * k) / steps)));
  const made: FigureInks = { rim, inner, jersey: u.jersey, cap: u.cap, shades };
  byScheme.set(key, made);
  return made;
}

function limbPath(ctx: Ctx, l: RigLimb): void {
  ctx.moveTo(l.root.x, l.root.y);
  ctx.lineTo(l.joint.x, l.joint.y);
  ctx.lineTo(l.end.x, l.end.y);
}

function body(ctx: Ctx, f: RigFigure, color: string): void {
  ctx.beginPath();
  ctx.moveTo(f.hip.x, f.hip.y);
  ctx.lineTo(f.neck.x, f.neck.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = f.torso;
  ctx.stroke();
}

function disc(ctx: Ctx, p: Point, r: number, color: string): void {
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, Math.max(r, 0), Math.max(r, 0), 0, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
}

/** A limb's screen box, grown by a stroke's width. */
function box(l: RigLimb, grow: number): [number, number, number, number] {
  return [
    Math.min(l.root.x, l.joint.x, l.end.x) - grow,
    Math.min(l.root.y, l.joint.y, l.end.y) - grow,
    Math.max(l.root.x, l.joint.x, l.end.x) + grow,
    Math.max(l.root.y, l.joint.y, l.end.y) + grow,
  ];
}

/**
 * A pictogram (TheaterDraw.figure): its rim first (so the lines and figures
 * behind stop short of it), the limbs behind the body (shaded by how far
 * behind), the body, the limbs in front over an inner rim when it's big
 * enough to carry one (each over its own where they cross, so crossing limbs
 * read as layered), the head in the team's own color. Limbs that don't need
 * their own stroke share one: the cost of a figure is its strokes.
 */
export function drawFigure(ctx: Ctx, f: RigFigure, inks: FigureInks, height: number, opacity: number): void {
  const halo = Math.max(height * 0.045, 0.8);
  const limbs = f.limbs;
  ctx.globalAlpha = opacity;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = inks.rim;
  ctx.beginPath();
  for (const l of limbs) limbPath(ctx, l);
  ctx.lineWidth = f.limb + 2 * halo;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(f.hip.x, f.hip.y);
  ctx.lineTo(f.neck.x, f.neck.y);
  ctx.lineWidth = f.torso + 2 * halo;
  ctx.stroke();
  disc(ctx, f.head, f.headRadius + halo, inks.rim);
  // Behind the body, far to near: a run of the same shade in one stroke.
  ctx.lineWidth = f.limb;
  let i = 0;
  while (i < limbs.length && !limbs[i]!.front) {
    const shade = limbs[i]!.shade;
    ctx.beginPath();
    while (i < limbs.length && !limbs[i]!.front && limbs[i]!.shade === shade) limbPath(ctx, limbs[i++]!);
    ctx.strokeStyle = inks.shades[Math.min(Math.max(shade, 0), inks.shades.length - 1)]!;
    ctx.stroke();
  }
  body(ctx, f, inks.jersey);
  // In front: together, unless two cross on screen; then far to near, each over its own inner rim.
  // Small figures lose their inner rim: it would only blur them.
  const rimmed = height >= 15;
  let crossing = false;
  if (rimmed) {
    for (let a = i; a < limbs.length && !crossing; a++) {
      const p = box(limbs[a]!, f.limb);
      for (let b = a + 1; b < limbs.length; b++) {
        const q = box(limbs[b]!, f.limb);
        if (p[0] <= q[2] && q[0] <= p[2] && p[1] <= q[3] && q[1] <= p[3]) {
          crossing = true;
          break;
        }
      }
    }
  }
  if (crossing) {
    for (let k = i; k < limbs.length; k++) {
      ctx.beginPath();
      limbPath(ctx, limbs[k]!);
      ctx.strokeStyle = inks.inner;
      ctx.lineWidth = f.limb + 1.2;
      ctx.stroke();
      ctx.strokeStyle = inks.jersey;
      ctx.lineWidth = f.limb;
      ctx.stroke();
    }
  } else if (i < limbs.length) {
    ctx.beginPath();
    for (let k = i; k < limbs.length; k++) limbPath(ctx, limbs[k]!);
    if (rimmed) {
      ctx.strokeStyle = inks.inner;
      ctx.lineWidth = f.limb + 1.2;
      ctx.stroke();
    }
    ctx.strokeStyle = inks.jersey;
    ctx.lineWidth = f.limb;
    ctx.stroke();
  }
  disc(ctx, f.head, f.headRadius, inks.cap);
  ctx.globalAlpha = 1;
}
