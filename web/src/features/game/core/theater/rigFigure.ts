/**
 * The rig on screen (TheaterRig.swift § Projection and § Figure; TheaterKit.swift
 * `FigureInks` and `TheaterDraw.figure`): how each theater's projection
 * sees a figure where it stands (`RigLens`: the ballpark's and the
 * gridiron's dimetric view, the pitch in perspective), a posed skeleton
 * projected with its limbs sorted by depth (`RigFigure`), and the pictogram
 * drawn as one solid figure: one outline round all of it, the limbs behind
 * the body shaded by how far behind, those in front crossing it with a fine
 * line of their own. Shared by every theater, and small, so the baseball
 * theater's chunk takes it without the football and soccer kit
 * (theaterKit.ts). The pose math is data/theater/rig.ts.
 *
 * Called per frame, per figure: plain arithmetic, a few small temporaries
 * beyond the figure's own points; inks are resolved once per uniform and
 * scheme.
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
  /**
   * Where it crosses the head on screen, the head is in front of it (hands
   * cocked behind it, an arm raised past it): it's drawn before the head.
   * Clear of the head, or across its face, it's drawn after.
   */
  readonly underHead: boolean;
  /** An arm (the jersey's sleeve), not a leg. */
  readonly arm: boolean;
}

/** Steps of shade for a limb behind the body. */
export const SHADES = 5;

/**
 * How far in front of the head's middle a limb must pass to cross its face,
 * in body units (about half the head's radius): an arm raised beside it
 * stays behind it.
 */
export const FACE = 0.06;

/** How far a point is from a segment, and how far along it the nearest point is (0 at `a`, 1 at `b`). */
export function nearest(p: Point, a: Point, b: Point): [gap: number, along: number] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const u = length > 1e-12 ? Math.min(Math.max(((p.x - a.x) * dx + (p.y - a.y) * dy) / length, 0), 1) : 0;
  return [Math.hypot(p.x - a.x - dx * u, p.y - a.y - dy * u), u];
}

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
  const depth = (p: RigVector): number => (p.x * c - p.y * s) * v.x + (p.x * s + p.y * c) * v.y + p.z * v.z;
  const scale = lens.height / 1.1;
  const head = screen(k.head);
  const headRadius = Math.max(Rig.head * scale, 1.5);
  const limb = Math.max(0.085 * scale, 1.1);
  // And against the head: at the point of it nearest the head's middle on screen, the further from the lens.
  const reach = headRadius + limb / 2;
  const behind = depth(k.head) - FACE;
  // Each limb against the body: which side of the spine it's on, toward the camera or away.
  let sx = k.neck.x - k.hip.x;
  let sy = k.neck.y - k.hip.y;
  let sz = k.neck.z - k.hip.z;
  const length = Math.max(Math.sqrt(sx * sx + sy * sy + sz * sz), 1e-9);
  sx /= length;
  sy /= length;
  sz /= length;
  const part = (a: RigVector, b: RigVector, e: RigVector, arm: boolean): RigLimb => {
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
    const root = screen(a);
    const joint = screen(b);
    const end = screen(e);
    const [upper, alongUpper] = nearest(head, root, joint);
    const [lower, alongLower] = nearest(head, joint, end);
    const near = upper <= lower ? depth(a) + (depth(b) - depth(a)) * alongUpper : depth(b) + (depth(e) - depth(b)) * alongLower;
    return { root, joint, end, shade, front: d < 0, depth: d, underHead: Math.min(upper, lower) < reach && near > behind, arm };
  };
  const limbs = [
    part(k.hips[0], k.knees[0], k.feet[0], false),
    part(k.hips[1], k.knees[1], k.feet[1], false),
    part(k.shoulders[0], k.elbows[0], k.hands[0], true),
    part(k.shoulders[1], k.elbows[1], k.hands[1], true),
  ].sort((p, q) => q.depth - p.depth);
  return {
    hip: screen(k.hip),
    neck: screen(k.neck),
    head,
    headRadius,
    torso: Math.max(0.19 * scale, 2),
    limb,
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
 * the body is the jersey (or an official's slacks) shaded by how far behind
 * it is (a few steps, from the jersey to its deepest shade).
 */
export interface FigureInks {
  readonly rim: string;
  readonly inner: string;
  readonly jersey: string;
  readonly cap: string;
  readonly shades: readonly string[];
  /** The legs, and their shades: the jersey's, or an official's shorts or slacks. */
  readonly legs: string;
  readonly legShades: readonly string[];
  /** An official's stripes, if the uniform has them. */
  readonly stripes: string | null;
  /** Whether anything differs from a plain jersey (stripes, other legs): then each limb is drawn on its own. */
  readonly dressed: boolean;
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
  const shaded = (color: string) => Array.from({ length: SHADES }, (_, k) => (k === 0 ? color : mixHex(color, "#000000", (deepest * k) / steps)));
  const shades = shaded(u.jersey);
  const legs = u.legs ?? u.jersey;
  const made: FigureInks = {
    rim,
    inner,
    jersey: u.jersey,
    cap: u.cap,
    shades,
    legs,
    legShades: u.legs ? shaded(legs) : shades,
    stripes: u.stripes ?? null,
    dressed: u.stripes != null || u.legs != null,
  };
  byScheme.set(key, made);
  return made;
}

function limbPath(ctx: Ctx, l: RigLimb): void {
  ctx.moveTo(l.root.x, l.root.y);
  ctx.lineTo(l.joint.x, l.joint.y);
  ctx.lineTo(l.end.x, l.end.y);
}

/**
 * A capsule round a segment (a disc where its ends meet; square at `a` if
 * `flat`), always wound the same way, so any number of them fill as their
 * union (TheaterDraw.capsule).
 */
function capsule(ctx: Ctx, a: Point, b: Point, r: number, flat = false): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const angle = dx * dx + dy * dy > 1e-12 ? Math.atan2(dy, dx) : 0;
  const nx = -Math.sin(angle) * r;
  const ny = Math.cos(angle) * r;
  ctx.moveTo(b.x + nx, b.y + ny);
  ctx.arc(b.x, b.y, r, angle + Math.PI / 2, angle - Math.PI / 2, true);
  if (flat) {
    ctx.lineTo(a.x - nx, a.y - ny);
    ctx.lineTo(a.x + nx, a.y + ny);
  } else {
    ctx.arc(a.x, a.y, r, angle - Math.PI / 2, angle - (3 * Math.PI) / 2, true);
  }
  ctx.closePath();
}

function disc(ctx: Ctx, p: Point, r: number, color: string): void {
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, Math.max(r, 0), Math.max(r, 0), 0, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
}

/** The line where a limb in front crosses: this far out either side of it. */
const LINE = 0.6;
/** The smallest figure that carries those lines. */
const LINED = 15;

/**
 * The parts of a figure drawn so far (TheaterDraw.Bone), five numbers each: a
 * segment (ax, ay, bx, by) and how far round it. Reused: a figure has at most
 * four limbs' eight bones, the body and the head.
 */
const bones = new Float64Array(5 * 10);
let boneCount = 0;
/** Which bone is the body itself (hip to neck). */
let bodyBone = -1;

function addBone(a: Point, b: Point, r: number): void {
  const k = 5 * boneCount++;
  bones[k] = a.x;
  bones[k + 1] = a.y;
  bones[k + 2] = b.x;
  bones[k + 3] = b.y;
  bones[k + 4] = r;
}

function addLimb(l: RigLimb, r: number): void {
  addBone(l.root, l.joint, r);
  addBone(l.joint, l.end, r);
}

/** How far (px, py) is from the segment (ax, ay)–(bx, by): `nearest`, in plain numbers. */
function gap(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const u = length > 1e-12 ? Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / length, 0), 1) : 0;
  return Math.hypot(px - ax - dx * u, py - ay - dy * u);
}

/** Bone `i` within `r` of the segment from `p` to `q`, beyond its own reach. */
function near(i: number, p: Point, q: Point, r: number): boolean {
  const k = 5 * i;
  const ax = bones[k]!;
  const ay = bones[k + 1]!;
  const bx = bones[k + 2]!;
  const by = bones[k + 3]!;
  const side = (ox: number, oy: number, ux: number, uy: number, vx: number, vy: number) => (ux - ox) * (vy - oy) - (uy - oy) * (vx - ox) > 0;
  if (side(ax, ay, bx, by, p.x, p.y) !== side(ax, ay, bx, by, q.x, q.y) && side(p.x, p.y, q.x, q.y, ax, ay) !== side(p.x, p.y, q.x, q.y, bx, by)) return true;
  const g = Math.min(gap(p.x, p.y, ax, ay, bx, by), gap(q.x, q.y, ax, ay, bx, by), gap(ax, ay, p.x, p.y, q.x, q.y), gap(bx, by, p.x, p.y, q.x, q.y));
  return g < r + bones[k + 4]!;
}

/**
 * Which of the bones drawn so far a limb crosses (a bit each; none: 0), its
 * line `r` either side of it. A leg's top always overlaps the body's round
 * bottom: it crosses the body only with its knee across it (a knee drive, a
 * high step).
 */
function crossed(l: RigLimb, r: number): number {
  let hits = 0;
  for (let i = 0; i < boneCount; i++) {
    if (!near(i, l.root, l.joint, r) && !near(i, l.joint, l.end, r)) continue;
    if (!l.arm && i === bodyBone && !near(i, l.joint, l.joint, r)) continue;
    hits |= 1 << i;
  }
  return hits;
}

/** Those bones, as the current path's union. */
function bonesPath(ctx: Ctx, hits: number): void {
  ctx.beginPath();
  for (let i = 0; i < boneCount; i++) {
    if (!(hits & (1 << i))) continue;
    const k = 5 * i;
    capsule(ctx, { x: bones[k]!, y: bones[k + 1]! }, { x: bones[k + 2]!, y: bones[k + 3]! }, bones[k + 4]!);
  }
}

/**
 * A pictogram, as one solid figure (TheaterDraw.figure). Its outline first,
 * round all of it at once (so the lines and figures behind stop short of
 * it, and where its parts meet it never doubles up); the limbs behind the
 * body (shaded by how far behind) and the body; then the head and the limbs
 * in front, far to near, the head over a limb it's in front of and under one
 * across its face. A limb in front crosses what's drawn already with one
 * fine line in the outline's ink, only there: never over the outline, never
 * round its own root (it grows out of the body), fading in as it comes round
 * in front. The head takes the same line where it covers a limb. Small
 * figures keep the outline alone: the lines would only blur them. Fading in
 * or out, it's drawn as one layer, so it never shows through itself.
 */
export function drawFigure(ctx: Ctx, f: RigFigure, inks: FigureInks, height: number, opacity: number): void {
  if (opacity < 1 && layered(ctx, f, inks, height, opacity)) return;
  ctx.globalAlpha = opacity;
  draw(ctx, f, inks, height);
  ctx.globalAlpha = 1;
}

function draw(ctx: Ctx, f: RigFigure, inks: FigureInks, height: number): void {
  const halo = Math.max(height * 0.045, 0.8);
  const w = f.limb / 2;
  const limbs = f.limbs;
  const base = ctx.globalAlpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // The outline: every part's, grown by the halo, filled as one shape.
  ctx.beginPath();
  for (const l of limbs) {
    capsule(ctx, l.root, l.joint, w + halo);
    capsule(ctx, l.joint, l.end, w + halo);
  }
  capsule(ctx, f.hip, f.neck, f.torso / 2 + halo);
  capsule(ctx, f.head, f.head, f.headRadius + halo);
  ctx.fillStyle = inks.rim;
  ctx.fill();
  // An official's stripes: as many as read at this size (four across the body at a theater's), the sleeves' as wide.
  const bands = inks.stripes === null ? 0 : Math.min(Math.max(Math.trunc((f.torso / 0.5 - 1) / 2), 1), 4) * 2 + 1;
  const shadeOf = (l: RigLimb, k: number) => {
    const list = l.arm ? inks.shades : inks.legShades;
    return list[Math.min(Math.max(k, 0), list.length - 1)]!;
  };
  const paint = (l: RigLimb, shade: number) => {
    ctx.beginPath();
    limbPath(ctx, l);
    ctx.strokeStyle = shadeOf(l, shade);
    ctx.lineWidth = f.limb;
    ctx.stroke();
    if (l.arm && inks.stripes !== null) {
      const wide = f.torso / bands;
      const across = Math.max(Math.trunc((f.limb / wide - 1) / 2), 1) * 2 + 1;
      if (f.limb / across >= 0.4) stripes(ctx, [l.root, l.joint, l.end], w, across, inks.stripes);
    }
  };
  // Behind the body, far to near: a run of the same shade in one stroke (one at a time in an official's kit).
  boneCount = 0;
  ctx.lineWidth = f.limb;
  let i = 0;
  while (i < limbs.length && !limbs[i]!.front) {
    const shade = limbs[i]!.shade;
    if (inks.dressed) {
      paint(limbs[i]!, shade);
      addLimb(limbs[i++]!, w);
      continue;
    }
    ctx.beginPath();
    while (i < limbs.length && !limbs[i]!.front && limbs[i]!.shade === shade) {
      limbPath(ctx, limbs[i]!);
      addLimb(limbs[i++]!, w);
    }
    ctx.strokeStyle = inks.shades[Math.min(Math.max(shade, 0), inks.shades.length - 1)]!;
    ctx.lineWidth = f.limb;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(f.hip.x, f.hip.y);
  ctx.lineTo(f.neck.x, f.neck.y);
  ctx.strokeStyle = inks.jersey;
  ctx.lineWidth = f.torso;
  ctx.stroke();
  if (inks.stripes !== null) stripes(ctx, [f.hip, f.neck], f.torso / 2, bands, inks.stripes);
  bodyBone = boneCount;
  addBone(f.hip, f.neck, f.torso / 2);
  ctx.lineWidth = f.limb;
  const first = i;
  // Small: the limbs in front in a stroke either side of the head.
  if (height < LINED) {
    for (const under of [true, false]) {
      if (inks.dressed) {
        for (let k = first; k < limbs.length; k++) if (limbs[k]!.underHead === under) paint(limbs[k]!, 0);
      } else {
        ctx.beginPath();
        for (let k = first; k < limbs.length; k++) if (limbs[k]!.underHead === under) limbPath(ctx, limbs[k]!);
        ctx.strokeStyle = inks.jersey;
        ctx.lineWidth = f.limb;
        ctx.stroke();
      }
      if (under) disc(ctx, f.head, f.headRadius, inks.cap);
    }
    return;
  }
  const cross = (l: RigLimb) => {
    const r = w + LINE;
    const fade = Rig.smooth(-l.depth / 0.015);
    const hits = fade > 0.01 ? crossed(l, r) : 0;
    if (hits) {
      // Its line: square at the root, round at the joint and the end; kept to what it crosses.
      ctx.save();
      bonesPath(ctx, hits);
      ctx.clip();
      ctx.globalAlpha = base * fade;
      ctx.beginPath();
      capsule(ctx, l.root, l.joint, r, true);
      capsule(ctx, l.joint, l.end, r);
      ctx.fillStyle = inks.inner;
      ctx.fill();
      ctx.restore();
    }
    paint(l, 0);
    addLimb(l, w);
  };
  let covers = false;
  for (let k = first; k < limbs.length; k++) {
    if (!limbs[k]!.underHead) continue;
    cross(limbs[k]!);
    covers = true;
  }
  if (covers) {
    ctx.save();
    ctx.beginPath();
    for (let k = first; k < limbs.length; k++) {
      const l = limbs[k]!;
      if (!l.underHead) continue;
      capsule(ctx, l.root, l.joint, w);
      capsule(ctx, l.joint, l.end, w);
    }
    ctx.clip();
    disc(ctx, f.head, f.headRadius + LINE, inks.inner);
    ctx.restore();
  }
  disc(ctx, f.head, f.headRadius, inks.cap);
  addBone(f.head, f.head, f.headRadius);
  for (let k = first; k < limbs.length; k++) if (!limbs[k]!.underHead) cross(limbs[k]!);
}

/**
 * Stripes along a part (the body, a sleeve) `r` either side of its line
 * (TheaterDraw.stripes): `bands` across it, light and dark by turns, light at
 * its edges; kept to the part, so they never leave the figure.
 */
function stripes(ctx: Ctx, line: readonly Point[], r: number, bands: number, ink: string): void {
  // Each segment's way; a segment with no length takes its neighbour's.
  const ways = line.slice(1).map((b, j) => {
    const a = line[j]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    return d > 1e-6 ? { x: (b.x - a.x) / d, y: (b.y - a.y) / d } : null;
  });
  const way = ways.find((d) => d !== null);
  if (!way) return;
  const dirs = ways.map((d) => d ?? way);
  const band = (2 * r) / bands;
  ctx.save();
  ctx.beginPath();
  for (let j = 0; j + 1 < line.length; j++) capsule(ctx, line[j]!, line[j + 1]!, r);
  ctx.clip();
  ctx.beginPath();
  for (let k = 1; k < bands; k += 2) {
    const off = -r + (k + 0.5) * band;
    dirs.forEach((d, j) => {
      const nx = -d.y * off;
      const ny = d.x * off;
      // Run past the ends: the part's round ends trim them.
      let a = line[j]!;
      let b = line[j + 1]!;
      if (j === 0) a = { x: a.x - d.x * r, y: a.y - d.y * r };
      if (j === dirs.length - 1) b = { x: b.x + d.x * r, y: b.y + d.y * r };
      if (j === 0) ctx.moveTo(a.x + nx, a.y + ny);
      else ctx.lineTo(a.x + nx, a.y + ny);
      ctx.lineTo(b.x + nx, b.y + ny);
    });
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = band;
  ctx.lineCap = "butt";
  ctx.stroke();
  ctx.restore();
}

/** A canvas a fading figure is drawn on first, then laid down at its opacity. */
let scratch: HTMLCanvasElement | null = null;

/** Drawn as one layer at `opacity`; false where there's no canvas to draw it on. */
function layered(ctx: Ctx, f: RigFigure, inks: FigureInks, height: number, opacity: number): boolean {
  if (typeof document === "undefined") return false;
  // The figure's box, outline and all, in the canvas's pixels.
  const grow = Math.max(height * 0.045, 0.8) + Math.max(f.torso / 2, f.limb / 2) + 1;
  let x0 = Math.min(f.hip.x, f.neck.x, f.head.x - f.headRadius);
  let y0 = Math.min(f.hip.y, f.neck.y, f.head.y - f.headRadius);
  let x1 = Math.max(f.hip.x, f.neck.x, f.head.x + f.headRadius);
  let y1 = Math.max(f.hip.y, f.neck.y, f.head.y + f.headRadius);
  for (const l of f.limbs) {
    for (const p of [l.root, l.joint, l.end]) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  const m = ctx.getTransform();
  const xs = [x0 - grow, x1 + grow];
  const ys = [y0 - grow, y1 + grow];
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const x of xs) {
    for (const y of ys) {
      const px = m.a * x + m.c * y + m.e;
      const py = m.b * x + m.d * y + m.f;
      left = Math.min(left, px);
      top = Math.min(top, py);
      right = Math.max(right, px);
      bottom = Math.max(bottom, py);
    }
  }
  left = Math.floor(left);
  top = Math.floor(top);
  const width = Math.ceil(right) - left;
  const tall = Math.ceil(bottom) - top;
  if (!(width > 0 && tall > 0 && width < 4096 && tall < 4096)) return false;
  scratch ??= document.createElement("canvas");
  if (scratch.width < width || scratch.height < tall) {
    scratch.width = Math.max(scratch.width, width);
    scratch.height = Math.max(scratch.height, tall);
  }
  const s = scratch.getContext("2d");
  if (!s) return false;
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.clearRect(0, 0, width, tall);
  s.globalAlpha = 1;
  s.setTransform(m.a, m.b, m.c, m.d, m.e - left, m.f - top);
  draw(s, f, inks, height);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = opacity;
  ctx.drawImage(scratch, 0, 0, width, tall, left, top, width, tall);
  ctx.restore();
  return true;
}
