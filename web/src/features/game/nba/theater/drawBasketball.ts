/**
 * The basketball theater, drawn (BasketballTheater.swift `HoopsCourtLayer`,
 * `HoopPose`, `BasketballFrame`; BasketballScript.swift `HoopProjection` and
 * the court's `RigLens`): the court from a high sideline through the
 * broadcast camera, turned a third of the way round, then one frame of the
 * play: the shadows, the baskets' backs, the players far to near, the ball,
 * the nets and the rims' fronts, the beats, the headline and the stamp.
 * Everything is projected through the camera, so lines stay crisp at any
 * zoom; nothing is a scaled bitmap. Type is laid out once per play and size
 * (`layoutLabels`).
 */
import type { CameraFrame } from "../../../../data/mlb/playCamera";
import { houseCurve, type FieldPoint, type Point } from "../../../../data/mlb/theaterField";
import type { Uniform } from "../../../../data/mlb/theaterTeams";
import type { Side } from "../../../../data/models";
import { defense, type BasketballScene } from "../../../../data/theater/basketballScene";
import { BasketballScript, basketballStamp, Hoops, view, type Player } from "../../../../data/theater/basketballScript";
import { gait, keyed, mix, over, Rig, rigArm, rigPose, RigPoses, RigTrack, skeleton, vec, type RigPose, type RigVector } from "../../../../data/theater/rig";
import { FieldProjection } from "../../core/theater/fieldProjection";
import { drawFigure, figureInks, grip, RigLens, rigFigure, type RigFigure } from "../../core/theater/rigFigure";
import { hsb, rgba, type RGB, type TheaterInk } from "../../mlb/theater/theaterInk";
import {
  accentOf,
  ASCENT,
  bannerBlock,
  chalk,
  drawGlow,
  drawRuns,
  drawShadow,
  drawTrail,
  ellipse,
  FONT,
  fillTracked,
  LINE,
  measureTracked,
  primary,
  run,
  runsWidth,
  shadow,
  TheaterType,
  type Block,
  type Ctx,
  type Size,
} from "../../core/theater/theaterKit";

/** The two teams on the court, always told apart at a glance. */
export interface BasketballTeams {
  readonly offense: Uniform;
  readonly defense: Uniform;
}

// MARK: - Projection

/** The court through the camera (HoopProjection): the ballpark's dimetric projection, turned by the yaw, with figures true to the rim. */
export class HoopProjection {
  readonly f: FieldProjection;
  readonly yaw: number;
  /** A player standing, in points. */
  readonly figure: number;
  private readonly c: number;
  private readonly s: number;

  constructor(size: Size, camera: CameraFrame, yaw: number) {
    this.f = new FieldProjection(size, camera);
    this.yaw = yaw;
    this.figure = Math.max(Hoops.ground * this.f.scale, 7);
    this.c = Math.cos(yaw);
    this.s = Math.sin(yaw);
  }

  point(p: Point, z = 0): Point {
    const { f, c, s } = this;
    const vx = p.x * c + p.y * s;
    const vy = -p.x * s + p.y * c;
    return { x: f.size.width / 2 + (vx - f.camera.x) * f.scale, y: f.size.height / 2 - (vy * 0.5 + z * 0.82 - f.camera.y) * f.scale };
  }

  at(p: FieldPoint): Point {
    return this.point(p, p.z);
  }

  /** Depth into the view (further is larger): what's drawn first. */
  depth(p: Point): number {
    return view(p, this.yaw).y;
  }

  get size(): Size {
    return this.f.size;
  }
  get scale(): number {
    return this.f.scale;
  }

  /** The court's lens (RigLens.init(_: HoopProjection, at:)): the gridiron's dimetric view at the hoops' figure height. */
  lens(p: Point): RigLens {
    const s = this.figure / 1.1;
    const c = this.c;
    const n = this.s;
    return new RigLens(this.point(p), { x: c * s, y: 0.5 * n * s }, { x: n * s, y: -0.5 * c * s }, { x: 0, y: -s }, this.scale / s, { x: -n * 0.866, y: c * 0.866, z: -0.5 }, this.figure);
  }
}

// MARK: - Inks

/** BasketballTheater.swift's `TheaterInk` extension, resolved once per scheme. */
export interface HoopsInk {
  /** The hardwood: a warm tint, as the grass is tinted, not painted. */
  readonly hardwood: string;
  /** Past the lines: the same floor, a shade quieter. */
  readonly apron: string;
  readonly plank: string;
  /** Under the lines in the light: a soft wood-toned edge that keeps white paint crisp on a pale floor. */
  readonly courtEdge: string | null;
  readonly glass: string;
  readonly stanchion: RGB;
  readonly stanchionAlpha: number;
  /** The rim's orange, a little deeper on a light panel. */
  readonly hoop: RGB;
  readonly netting: RGB;
  readonly nettingAlpha: number;
  /** The ball's leather. */
  readonly leather: RGB;
}

const hoopsInks = new WeakMap<TheaterInk, HoopsInk>();

export function hoopsInk(ink: TheaterInk): HoopsInk {
  const cached = hoopsInks.get(ink);
  if (cached) return cached;
  const dark = ink.dark;
  const made: HoopsInk = {
    hardwood: dark ? rgba(hsb(0.085, 0.42, 0.8), 0.17) : rgba(hsb(0.085, 0.5, 0.74), 0.3),
    apron: rgba(hsb(0.085, 0.3, 0.6), dark ? 0.09 : 0.12),
    plank: dark ? "rgb(255 255 255 / 0.025)" : "rgb(0 0 0 / 0.03)",
    courtEdge: dark ? null : rgba(hsb(0.08, 0.5, 0.3), 0.18),
    glass: dark ? "rgb(255 255 255 / 0.07)" : rgba([140, 140, 140], 0.1),
    stanchion: ink.primary,
    stanchionAlpha: ink.primaryAlpha * (dark ? 0.26 : 0.2),
    hoop: hsb(0.055, 0.85, dark ? 0.98 : 0.82),
    netting: dark ? [255, 255, 255] : [115, 115, 115],
    nettingAlpha: dark ? 0.75 : 0.85,
    leather: hsb(0.065, 0.78, dark ? 0.95 : 0.82),
  };
  hoopsInks.set(ink, made);
  return made;
}

// MARK: - Court

/** The paint in the home team's color, its name at center court, and the three-point arc's radius (the WNBA's is shorter). */
export interface Paint {
  /** A hex color. */
  readonly color: string;
  readonly name: string;
  readonly three: number;
}

type Polyline = readonly Point[];

/** Every line, in the play's frame, as polylines: drawn the same through any camera. */
function lines(three: number): { solid: Polyline[]; dashed: Polyline[] } {
  const solid: Polyline[] = [];
  const dashed: Polyline[] = [];
  const arc = (c: Point, r: number, a: number, b: number, steps = 28): Point[] => {
    const out: Point[] = [];
    for (let k = 0; k <= steps; k++) {
      const t = a + ((b - a) * k) / steps;
      out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
    }
    return out;
  };
  const L = Hoops.length;
  const W = Hoops.width;
  solid.push([
    { x: 0, y: 0 },
    { x: L, y: 0 },
    { x: L, y: W },
    { x: 0, y: W },
    { x: 0, y: 0 },
  ]);
  solid.push([
    { x: L / 2, y: 0 },
    { x: L / 2, y: W },
  ]);
  solid.push(arc({ x: L / 2, y: W / 2 }, 6, 0, 2 * Math.PI, 40));
  solid.push(arc({ x: L / 2, y: W / 2 }, 2, 0, 2 * Math.PI, 20));
  for (const end of [1, -1]) {
    // In from the baseline at x = 94 (end 1) or x = 0 (end −1).
    const base = end > 0 ? L : 0;
    const x = (fromBase: number) => base - end * fromBase;
    const rim = { x: x(L - Hoops.rim.x), y: W / 2 };
    const ft = x(L - Hoops.freeThrow);
    solid.push([
      { x: base, y: W / 2 - Hoops.lane },
      { x: ft, y: W / 2 - Hoops.lane },
      { x: ft, y: W / 2 + Hoops.lane },
      { x: base, y: W / 2 + Hoops.lane },
    ]);
    // The free-throw circle: solid outside the lane, dashed inside it.
    const facing = end > 0 ? Math.PI : 0;
    solid.push(arc({ x: ft, y: W / 2 }, 6, facing - Math.PI / 2, facing + Math.PI / 2));
    const inside = arc({ x: ft, y: W / 2 }, 6, facing + Math.PI / 2, facing + (3 * Math.PI) / 2, 16);
    for (let k = 0; k < inside.length - 1; k += 2) dashed.push([inside[k]!, inside[k + 1]!]);
    // The restricted area, out to the backboard.
    const board = x(L - Hoops.board);
    solid.push([{ x: board, y: W / 2 - 4 }, ...arc(rim, 4, facing + (end * Math.PI) / 2, facing - (end * Math.PI) / 2, 20), { x: board, y: W / 2 + 4 }]);
    // The three: the corners straight, then the arc round the rim.
    const reach = Math.sqrt(three * three - Hoops.corner * Hoops.corner);
    const meet = Math.asin(Hoops.corner / three);
    solid.push([
      { x: base, y: W / 2 - Hoops.corner },
      { x: rim.x - end * reach, y: W / 2 - Hoops.corner },
      ...arc(rim, three, facing + end * meet, facing - end * meet, 40),
      { x: base, y: W / 2 + Hoops.corner },
    ]);
    // The lane's marks: the block, then every 3 ft.
    for (const d of [7, 8, 11, 14]) {
      for (const side of [-1, 1]) {
        const y = W / 2 + side * Hoops.lane;
        solid.push([
          { x: x(d), y },
          { x: x(d), y: y + side * (d === 8 ? 0.7 : 0.5) },
        ]);
      }
    }
  }
  return { solid, dashed };
}

const STANDARD = lines(Hoops.three);
const WNBA = lines(22.15);

function polylines(ctx: Ctx, h: HoopProjection, list: readonly Polyline[]): void {
  ctx.beginPath();
  for (const line of list) {
    line.forEach((p, i) => {
      const q = h.point(p);
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
  }
}

/** A hex color at an alpha. */
function withAlpha(hex: string, a: number): string {
  if (!hex.startsWith("#") || hex.length < 7) return hex;
  const v = Number.parseInt(hex.slice(1, 7), 16);
  return rgba([(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff], a);
}

/**
 * The court (HoopsCourtLayer.draw): the hardwood, the paint and the center
 * circle in the home team's color, the lines (the lanes, the free-throw
 * circles, the arcs and the restricted areas, the half-court line), and its
 * name at center court. The baskets are drawn in two parts round the
 * figures (`drawBasket`), so a ball dropping through the net passes behind
 * its front.
 */
export function drawCourt(ctx: Ctx, h: HoopProjection, ink: TheaterInk, paint: Paint): void {
  const hi = hoopsInk(ink);
  const quad = (x0: number, y0: number, x1: number, y1: number) => {
    const a = h.point({ x: x0, y: y0 });
    const b = h.point({ x: x1, y: y0 });
    const c = h.point({ x: x1, y: y1 });
    const d = h.point({ x: x0, y: y1 });
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
  };
  // The floor runs on past the lines (the apron), the court on it.
  quad(-12, -12, Hoops.length + 12, Hoops.width + 12);
  ctx.fillStyle = hi.apron;
  ctx.fill();
  quad(0, 0, Hoops.length, Hoops.width);
  ctx.fillStyle = hi.hardwood;
  ctx.fill();
  // The planks: faint lines along the court, where there's room to see them.
  if (h.scale >= 3) {
    ctx.beginPath();
    for (let y = 2.5; y < Hoops.width; y += 2.5) {
      const a = h.point({ x: 0, y });
      const b = h.point({ x: Hoops.length, y });
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.strokeStyle = hi.plank;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  // The paint and the center circle in the home team's color.
  const tint = withAlpha(paint.color, ink.dark ? 0.3 : 0.24);
  ctx.fillStyle = tint;
  quad(Hoops.length - (Hoops.length - Hoops.freeThrow), Hoops.width / 2 - Hoops.lane, Hoops.length, Hoops.width / 2 + Hoops.lane);
  ctx.fill();
  quad(0, Hoops.width / 2 - Hoops.lane, Hoops.length - Hoops.freeThrow, Hoops.width / 2 + Hoops.lane);
  ctx.fill();
  ctx.beginPath();
  for (let k = 0; k <= 40; k++) {
    const a = (k / 40) * 2 * Math.PI;
    const q = h.point({ x: Hoops.length / 2 + 6 * Math.cos(a), y: Hoops.width / 2 + 6 * Math.sin(a) });
    if (k === 0) ctx.moveTo(q.x, q.y);
    else ctx.lineTo(q.x, q.y);
  }
  ctx.fill();
  // Its name at center court, flat on the floor, read from the camera's sideline.
  if (paint.name !== "" && h.scale >= 1.2) {
    ctx.save();
    ctx.font = `900 60px ${FONT}`;
    const expanded = "fontStretch" in ctx;
    if (expanded) ctx.fontStretch = "expanded";
    const width = measureTracked(ctx, paint.name, 0);
    const k = Math.min(5 / (60 * LINE), 11 / Math.max(width, 1));
    ctx.globalAlpha = 0.4;
    const yaw = h.yaw;
    const s = h.scale;
    // Right and down along the floor as the camera sees it: left to right across the view.
    const flip = Math.cos(yaw) >= 0 ? 1 : -1;
    const gx = { x: Math.cos(yaw) * s * flip, y: 0.5 * Math.sin(yaw) * s * flip };
    const gy = { x: Math.sin(yaw) * s * flip, y: -0.5 * Math.cos(yaw) * s * flip };
    const c = h.point({ x: Hoops.length / 2, y: Hoops.width / 2 });
    ctx.transform(gx.x * k, gx.y * k, -gy.x * k, -gy.y * k, c.x, c.y);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = chalk(ink);
    ctx.fillText(paint.name, 0, 60 * (ASCENT - LINE / 2));
    if (expanded) ctx.fontStretch = "normal";
    ctx.restore();
  }
  // The lines: chalk-white paint, thickening a little as the camera closes in.
  const width = Math.min(Math.max(0.7, h.scale * 0.11), 1.5);
  const geometry = paint.three < 23 ? WNBA : STANDARD;
  ctx.lineCap = "butt";
  if (hi.courtEdge) {
    polylines(ctx, h, geometry.solid);
    ctx.strokeStyle = hi.courtEdge;
    ctx.lineWidth = width + 1.1;
    ctx.lineJoin = "miter";
    ctx.stroke();
  }
  polylines(ctx, h, geometry.solid);
  ctx.strokeStyle = chalk(ink, ink.dark ? 0.7 : 1);
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.stroke();
  polylines(ctx, h, geometry.dashed);
  ctx.strokeStyle = chalk(ink, ink.dark ? 0.5 : 0.8);
  ctx.lineJoin = "miter";
  ctx.stroke();
}

/** What moves at a basket at t: the net's stretch and swing, the rim's give. */
export interface BasketMotion {
  readonly net: BasketballScript["net"];
  readonly rimHit: number | null;
  readonly rimStrength: number;
  readonly t: number;
}

/**
 * One basket in the play's frame (`end` 1: the one the offense attacks)
 * (HoopsCourtLayer.basket): its back (the stanchion, the backboard, the far
 * half of the rim) or its front (the near half of the rim and the net).
 */
export function drawBasket(ctx: Ctx, h: HoopProjection, ink: TheaterInk, end: number, front: boolean, motion: BasketMotion): void {
  const hi = hoopsInk(ink);
  const L = Hoops.length;
  const W = Hoops.width;
  const rim = end > 0 ? Hoops.rim : { x: L - Hoops.rim.x, y: W / 2 };
  const board = end > 0 ? Hoops.board : L - Hoops.board;
  const behind = end > 0 ? L + 3.5 : -3.5;
  const line = Math.min(Math.max(0.8, h.scale * 0.16), 2);
  const attacked = end > 0;
  const center = h.depth(rim);
  // The rim: a ring, its front pulled down by a dunk and let go.
  let give = 0;
  if (attacked && motion.rimHit != null && motion.t >= motion.rimHit) {
    const x = motion.t - motion.rimHit;
    give = x < 1.2 ? motion.rimStrength * 0.55 * Math.exp(-6 * x) * Math.cos(22 * x) : 0;
  }
  const ring: { p: Point; depth: number }[] = [];
  for (let k = 0; k <= 32; k++) {
    const a = (k / 32) * 2 * Math.PI;
    const g = { x: rim.x + Hoops.rimRadius * Math.cos(a), y: rim.y + Hoops.rimRadius * Math.sin(a) };
    // The front of it (toward midcourt) gives most.
    const near = Math.max(0, -Math.cos(a) * end);
    ring.push({ p: h.point(g, Hoops.rimHeight - give * near), depth: h.depth(g) });
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (!front) {
    // The stanchion behind the baseline, the arm out to the board.
    const a = h.point({ x: behind, y: W / 2 });
    const b = h.point({ x: behind, y: W / 2 }, 11.6);
    const c = h.point({ x: board + end * 0.3, y: W / 2 }, 11.6);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.strokeStyle = rgba(hi.stanchion, hi.stanchionAlpha);
    ctx.lineWidth = line * 1.6;
    ctx.stroke();
    const pad = [
      h.point({ x: behind - end * 1.2, y: W / 2 - 2 }),
      h.point({ x: behind + end * 2, y: W / 2 - 2 }),
      h.point({ x: behind + end * 2, y: W / 2 + 2 }),
      h.point({ x: behind - end * 1.2, y: W / 2 + 2 }),
    ];
    ctx.beginPath();
    pad.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = rgba(hi.stanchion, hi.stanchionAlpha * 0.6);
    ctx.fill();
    // The backboard: glass with its edge and the shooter's square.
    const pane = (y0: number, y1: number, z0: number, z1: number) => {
      const corners = [h.point({ x: board, y: y0 }, z0), h.point({ x: board, y: y1 }, z0), h.point({ x: board, y: y1 }, z1), h.point({ x: board, y: y0 }, z1)];
      ctx.beginPath();
      corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
    };
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    pane(W / 2 - 3, W / 2 + 3, Hoops.boardBottom, Hoops.boardTop);
    ctx.fillStyle = hi.glass;
    ctx.fill();
    ctx.strokeStyle = chalk(ink, ink.dark ? 0.75 : 0.95);
    ctx.lineWidth = line;
    ctx.stroke();
    pane(W / 2 - 1, W / 2 + 1, Hoops.rimHeight, Hoops.rimHeight + 1.5);
    ctx.strokeStyle = chalk(ink, 0.7);
    ctx.lineWidth = line * 0.8;
    ctx.stroke();
    // The far half of the rim, and the bracket to the board.
    ctx.beginPath();
    for (let k = 0; k < 32; k++) {
      if (!(ring[k]!.depth >= center && ring[k + 1]!.depth >= center)) continue;
      ctx.moveTo(ring[k]!.p.x, ring[k]!.p.y);
      ctx.lineTo(ring[k + 1]!.p.x, ring[k + 1]!.p.y);
    }
    const from = h.point({ x: rim.x + end * Hoops.rimRadius, y: rim.y }, Hoops.rimHeight);
    const to = h.point({ x: board, y: rim.y }, Hoops.rimHeight);
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = rgba(hi.hoop, 1);
    ctx.lineWidth = line * 1.3;
    ctx.lineCap = "round";
    ctx.stroke();
    return;
  }
  // The net: strands from the ring down to a narrower one, stretched and swung as the ball goes through.
  let stretch = 0;
  let swing = { x: 0, y: 0 };
  const net = motion.net;
  if (attacked && net && motion.t >= net.at) {
    const x = motion.t - net.at;
    if (x < 1.6) {
      stretch = net.strength * 0.85 * Math.exp(-5 * x) * Math.sin((Math.min(x / 0.07, 1) * Math.PI) / 2) * Math.cos(14 * Math.max(x - 0.07, 0));
      const w = net.strength * 0.4 * Math.exp(-3.2 * x) * Math.sin(9 * x + 0.4);
      swing = { x: net.way.x * w, y: net.way.y * w };
    }
  }
  const depthNet = 1.55 + Math.max(stretch, -0.3);
  const n = 12;
  const bottom: Point[] = [];
  const middle: Point[] = [];
  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 2 * Math.PI;
    const top = { x: rim.x + Hoops.rimRadius * Math.cos(a), y: rim.y + Hoops.rimRadius * Math.sin(a) };
    const low = { x: rim.x + swing.x + 0.42 * Math.cos(a), y: rim.y + swing.y + 0.42 * Math.sin(a) };
    const mid = { x: rim.x + swing.x * 0.45 + 0.6 * Math.cos(a), y: rim.y + swing.y * 0.45 + 0.6 * Math.sin(a) };
    const near = Math.max(0, -Math.cos(a) * end);
    const p0 = h.point(top, Hoops.rimHeight - give * near);
    const p1 = h.point(mid, Hoops.rimHeight - depthNet * 0.5);
    const p2 = h.point(low, Hoops.rimHeight - depthNet);
    ctx.moveTo(p0.x, p0.y);
    ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
    middle.push(p1);
    bottom.push(p2);
  }
  ctx.strokeStyle = rgba(hi.netting, hi.nettingAlpha);
  ctx.lineWidth = Math.max(line * 0.5, 0.5);
  ctx.lineCap = "butt";
  ctx.stroke();
  ctx.beginPath();
  for (const ringOf of [middle, bottom]) {
    [...ringOf, ringOf[0]!].forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  }
  ctx.strokeStyle = rgba(hi.netting, hi.nettingAlpha * 0.7);
  ctx.lineWidth = Math.max(line * 0.45, 0.5);
  ctx.lineJoin = "miter";
  ctx.stroke();
  // The near half of the rim, over the net.
  ctx.beginPath();
  for (let k = 0; k < 32; k++) {
    if (!(ring[k]!.depth < center || ring[k + 1]!.depth < center)) continue;
    ctx.moveTo(ring[k]!.p.x, ring[k]!.p.y);
    ctx.lineTo(ring[k + 1]!.p.x, ring[k + 1]!.p.y);
  }
  ctx.strokeStyle = rgba(hi.hoop, 1);
  ctx.lineWidth = line * 1.4;
  ctx.lineCap = "round";
  ctx.stroke();
}

// MARK: - Poses

/**
 * Basketball's poses (HoopPose), relative to his heading (where he faces).
 * Arms swing forward from hanging (straight up past 3), spread out, turn
 * outward, and bend only their own way.
 */
export const HoopPose = {
  /** Off the ball, ready to catch: knees a little bent, hands up. */
  ready: rigPose({
    hip: vec(-0.02, 0, 0.45),
    lean: 0.2,
    left: vec(0.02, 0.1, 0),
    right: vec(-0.02, -0.1, 0),
    knees: 0.25,
    leftArm: rigArm({ swing: 0.55, spread: 0.22, turn: -0.2, bend: 1.0 }),
    rightArm: rigArm({ swing: 0.55, spread: 0.22, turn: -0.2, bend: 1.0 }),
  }),
  /** On defense: low and wide, the arms out. */
  guarding: rigPose({
    hip: vec(-0.06, 0, 0.39),
    lean: 0.42,
    left: vec(0.03, 0.18, 0),
    right: vec(0, -0.18, 0),
    knees: 0.45,
    leftArm: rigArm({ swing: 0.55, spread: 1.05, turn: -0.3, bend: 0.45 }),
    rightArm: rigArm({ swing: 0.8, spread: 0.85, turn: -0.2, bend: 0.5 }),
  }),
  /** The ball in both hands at the chest. */
  hold: rigPose({ lean: 0.08, leftArm: rigArm({ swing: 0.75, spread: 0.06, turn: -0.55, bend: 1.9 }), rightArm: rigArm({ swing: 0.8, spread: 0.08, turn: -0.5, bend: 1.95 }) }),
  /** On the dribble: the right hand pushing it down at his side (`up`: the ball's height, 0 the floor), the left arm out to keep his man off. */
  dribble(up: number): RigPose {
    return rigPose({
      hip: vec(-0.02, 0, 0.45),
      lean: 0.24,
      knees: 0.25,
      leftArm: rigArm({ swing: 0.95, spread: 0.55, turn: -0.4, bend: 0.95 }),
      rightArm: rigArm({ swing: 0.3 + 0.3 * up, spread: 0.3, turn: -0.1, bend: 0.35 + 0.55 * up }),
    });
  },
  /** Into the shot: the dip, the ball at his chin, knees bent. */
  dip: rigPose({
    hip: vec(-0.03, 0, 0.42),
    lean: 0.12,
    left: vec(0.03, 0.09, 0),
    right: vec(-0.02, -0.09, 0),
    knees: 0.3,
    leftArm: rigArm({ swing: 1.2, spread: 0.25, turn: -0.5, bend: 1.7 }),
    rightArm: rigArm({ swing: 1.35, spread: 0.12, turn: -0.2, bend: 1.9 }),
  }),
  /** The set: the ball over his forehead, the elbow under it. */
  set: rigPose({
    hip: vec(0, 0, 0.48),
    lean: -0.04,
    left: vec(0.02, 0.07, 0),
    right: vec(-0.01, -0.07, 0),
    knees: 0.12,
    leftArm: rigArm({ swing: 2.25, spread: 0.4, turn: -0.75, bend: 1.3 }),
    rightArm: rigArm({ swing: 2.35, spread: 0.12, turn: -0.15, bend: 1.75 }),
  }),
  /** The release: the shooting arm up and out, the guide hand off it. */
  release: rigPose({
    hip: vec(0, 0, 0.49),
    lean: -0.06,
    left: vec(0, 0.06, 0),
    right: vec(-0.03, -0.06, 0),
    knees: 0.08,
    leftArm: rigArm({ swing: 2.3, spread: 0.45, turn: -0.6, bend: 0.75 }),
    rightArm: rigArm({ swing: 2.85, spread: 0.08, turn: -0.1, bend: 0.1 }),
  }),
  /** The follow-through, held as he comes down. */
  follow: rigPose({
    hip: vec(0, 0, 0.47),
    lean: 0.02,
    left: vec(0.02, 0.08, 0),
    right: vec(-0.02, -0.08, 0),
    knees: 0.15,
    leftArm: rigArm({ swing: 1.6, spread: 0.4, turn: -0.4, bend: 0.6 }),
    rightArm: rigArm({ swing: 2.55, spread: 0.08, turn: -0.1, bend: 0.3 }),
  }),
  /** The gather for a layup: the ball up at his chest, the right knee coming up. */
  gather: rigPose({
    hip: vec(0, 0, 0.46),
    lean: 0.1,
    left: vec(-0.04, 0.07, 0),
    right: vec(0.1, -0.06, 0.14),
    knees: 0.12,
    leftArm: rigArm({ swing: 1.1, spread: 0.2, turn: -0.5, bend: 1.6 }),
    rightArm: rigArm({ swing: 1.3, spread: 0.12, turn: -0.3, bend: 1.5 }),
  }),
  /** The layup: off his left foot, the right knee driven up, the ball laid in from the top of his reach. */
  layup: rigPose({
    hip: vec(0.02, 0, 0.5),
    lean: -0.04,
    twist: 0.15,
    left: vec(-0.06, 0.06, 0),
    right: vec(0.16, -0.05, 0.28),
    knees: 0.1,
    leftArm: rigArm({ swing: 1.55, spread: 0.45, turn: -0.3, bend: 1.0 }),
    rightArm: rigArm({ swing: 2.95, spread: 0.1, turn: -0.1, bend: 0.12 }),
  }),
  /** The dunk: the ball cocked back over his head in both hands, knees tucked. */
  cock: rigPose({
    hip: vec(0, 0, 0.5),
    lean: -0.18,
    left: vec(-0.1, 0.07, 0.1),
    right: vec(-0.12, -0.07, 0.12),
    knees: 0.15,
    leftArm: rigArm({ swing: 3.0, spread: 0.18, turn: -0.2, bend: 0.8 }),
    rightArm: rigArm({ swing: 3.0, spread: 0.18, turn: -0.2, bend: 0.8 }),
  }),
  /** …hammered down through the rim. */
  slam: rigPose({
    hip: vec(0.02, 0, 0.5),
    lean: 0.22,
    left: vec(0.06, 0.08, 0.04),
    right: vec(0.04, -0.08, 0.06),
    knees: 0.12,
    leftArm: rigArm({ swing: 2.35, spread: 0.2, turn: -0.2, bend: 0.25 }),
    rightArm: rigArm({ swing: 2.35, spread: 0.2, turn: -0.2, bend: 0.25 }),
  }),
  /** Hanging on the rim, legs down. */
  hang: rigPose({
    hip: vec(-0.02, 0, 0.5),
    lean: 0.05,
    left: vec(0.07, 0.08, 0.02),
    right: vec(0.05, -0.08, 0),
    knees: 0.1,
    leftArm: rigArm({ swing: 3.0, spread: 0.12, turn: -0.15, bend: 0.12 }),
    rightArm: rigArm({ swing: 3.0, spread: 0.12, turn: -0.15, bend: 0.12 }),
  }),
  /** Off the floor: legs a little bent under him. */
  air: rigPose({ hip: vec(0, 0, 0.5), left: vec(0.02, 0.07, 0.05), right: vec(-0.05, -0.07, 0.07), knees: 0.15 }),
  /** A hand up at the shooter. */
  contest: rigPose({
    hip: vec(0, 0, 0.47),
    lean: 0.02,
    left: vec(0.03, 0.12, 0),
    right: vec(-0.03, -0.12, 0),
    knees: 0.15,
    leftArm: rigArm({ swing: 0.9, spread: 0.85, turn: -0.2, bend: 0.4 }),
    rightArm: rigArm({ swing: 3.0, spread: 0.06, turn: -0.1, bend: 0.06 }),
  }),
  /** Up at the rim, both arms straight up: the help's wall. */
  wall: rigPose({ hip: vec(0, 0, 0.49), lean: -0.02, leftArm: rigArm({ swing: 3.05, spread: 0.1, turn: -0.1, bend: 0.06 }), rightArm: rigArm({ swing: 3.05, spread: 0.1, turn: -0.1, bend: 0.06 }) }),
  /** The block: reaching up and out for it… */
  block: rigPose({ hip: vec(0.02, 0, 0.49), lean: 0.1, leftArm: rigArm({ swing: 1.7, spread: 0.6, turn: -0.2, bend: 0.4 }), rightArm: rigArm({ swing: 2.85, spread: 0.15, turn: -0.1, bend: 0.05 }) }),
  /** …and the swat through it. */
  swat: rigPose({ hip: vec(0.02, 0, 0.48), lean: 0.25, leftArm: rigArm({ swing: 1.2, spread: 0.6, bend: 0.5 }), rightArm: rigArm({ swing: 1.9, spread: 0.55, turn: 0.5, bend: 0.2 }) }),
  /** Boxing out: low and wide, arms out, his back into his man. */
  boxOut: rigPose({
    hip: vec(-0.07, 0, 0.38),
    lean: 0.3,
    left: vec(0, 0.2, 0),
    right: vec(0, -0.2, 0),
    knees: 0.5,
    leftArm: rigArm({ swing: 0.8, spread: 1.15, turn: -0.2, bend: 0.85 }),
    rightArm: rigArm({ swing: 0.8, spread: 1.15, turn: -0.2, bend: 0.85 }),
  }),
  /** The chest pass: both arms out at it. */
  pass: rigPose({ lean: 0.14, leftArm: rigArm({ swing: 1.5, spread: 0.08, turn: -0.25, bend: 0.12 }), rightArm: rigArm({ swing: 1.5, spread: 0.08, turn: -0.25, bend: 0.12 }) }),
  /** The lob, from over his head. */
  lob: rigPose({ lean: -0.04, leftArm: rigArm({ swing: 2.55, spread: 0.12, turn: -0.3, bend: 0.3 }), rightArm: rigArm({ swing: 2.55, spread: 0.12, turn: -0.3, bend: 0.3 }) }),
  /** Hands up and out as a target for the pass. */
  target: rigPose({ lean: 0.1, leftArm: rigArm({ swing: 1.25, spread: 0.2, turn: -0.4, bend: 0.75 }), rightArm: rigArm({ swing: 1.25, spread: 0.2, turn: -0.4, bend: 0.75 }) }),
  /** The hook: side-on, the far arm sweeping over his head. */
  hookSet: rigPose({
    turn: -1.1,
    hip: vec(0, 0, 0.47),
    lean: 0.05,
    knees: 0.15,
    leftArm: rigArm({ swing: 1.3, spread: 0.6, turn: -0.3, bend: 0.9 }),
    rightArm: rigArm({ swing: 1.9, spread: 1.1, turn: 0.5, bend: 0.9 }),
  }),
  hook: rigPose({
    turn: -1.1,
    hip: vec(0, 0, 0.49),
    lean: -0.05,
    knees: 0.1,
    leftArm: rigArm({ swing: 1.4, spread: 0.7, turn: -0.2, bend: 0.8 }),
    rightArm: rigArm({ swing: 2.95, spread: 0.85, turn: 0.3, bend: 0.15 }),
  }),
  /** The tip: one hand straight up at it. */
  tip: rigPose({ hip: vec(0, 0, 0.49), leftArm: rigArm({ swing: 2.6, spread: 0.2, bend: 0.3 }), rightArm: rigArm({ swing: 3.05, spread: 0.08, bend: 0.06 }) }),
  /** The steal: lunging, a hand out low at the ball. */
  steal: rigPose({
    hip: vec(0.04, 0, 0.38),
    lean: 0.65,
    left: vec(0.24, 0.1, 0),
    right: vec(-0.22, -0.12, 0),
    knees: 0.3,
    leftArm: rigArm({ swing: 0.4, spread: 0.6, bend: 0.4 }),
    rightArm: rigArm({ swing: 1.35, spread: 0.18, turn: -0.2, bend: 0.1 }),
  }),
};

const SHOT_KEYS = (still: RigPose): readonly (readonly [number, RigPose])[] => [
  [-0.55, HoopPose.hold],
  [-0.26, HoopPose.dip],
  [-0.08, HoopPose.set],
  [0.04, HoopPose.release],
  [0.45, HoopPose.follow],
  [0.75, HoopPose.follow],
  [1.1, still],
];

const envelope = (x: number, attack: number, release: number) => (x < 0 ? Math.max(1 + x / attack, 0) : Math.max(1 - x / release, 0));
const smooth = Rig.smooth;
const toward = (a: RigVector, b: RigVector, u: number): RigVector => vec(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u);

/**
 * The body at t, and its heading (BasketballFrame.pose): what he's doing
 * with the ball (a pass, the shot, the layup, the dunk, a block, a box-out)
 * over how he's moving (striding to his planted feet), over how he stands
 * (ready off the ball, low on defense, at ease once the ball's through); and
 * off the floor when he jumps. `unit`: body units to the foot. (tested)
 */
export function playerPose(script: BasketballScript, player: Player, index: number, t: number, here: Point, unit: number): [RigPose, number] {
  const track = script.rig[index] ?? RigTrack.standing(here);
  const m = track.motion(t);
  // How he stands: ready, or down in his stance on defense; at ease a beat after the ball's through.
  const ease = script.score != null ? smooth((t - script.score - 0.7) / 0.5) : 0;
  const stance = player.team === "defense" ? HoopPose.guarding : HoopPose.ready;
  const still = mix(stance, RigPoses.stand, ease);
  const feet = track.feet(t, here, m.heading, unit, m.speed, { left: still.left, right: still.right });
  let body = mix(still, gait(m, feet), m.weight);

  // With the ball: in both hands at the chest, or on the dribble.
  const carry = script.carrier(t);
  if (carry && carry.player === index) {
    const held = smooth((t - carry.from) / 0.12) * (Number.isFinite(carry.until) ? smooth((carry.until - t) / 0.1) : 1);
    if (carry.dribbling) {
      const leg = lastLeg(script, t);
      body = over(body, HoopPose.dribble(BasketballScript.bounce(t - (leg?.from ?? 0))), held, 1);
    } else {
      body = over(body, HoopPose.hold, held, 1);
    }
  }

  for (const action of player.actions) {
    const x = t - action.at;
    switch (action.kind) {
      case "shoot": {
        if (!(x > -0.5 && x < 1.1)) break;
        const shot = keyed(SHOT_KEYS(still), x);
        if (shot) body = over(body, shot, smooth((x + 0.55) / 0.12), m.weight);
        break;
      }
      case "layup": {
        if (!(x > -0.45 && x < 0.8)) break;
        const shot = keyed(
          [
            [-0.5, HoopPose.hold],
            [-0.2, HoopPose.gather],
            [0, HoopPose.layup],
            [0.3, HoopPose.layup],
            [0.8, still],
          ],
          x,
        );
        if (shot) body = over(body, shot, smooth((x + 0.5) / 0.12), m.weight);
        break;
      }
      case "dunk": {
        if (!(x > -0.5 && x < 0.9)) break;
        const shot = keyed(
          [
            [-0.55, HoopPose.hold],
            [-0.22, HoopPose.cock],
            [0, HoopPose.slam],
            [0.2, HoopPose.hang],
            [0.45, HoopPose.hang],
            [0.9, still],
          ],
          x,
        );
        if (shot) body = over(body, shot, smooth((x + 0.55) / 0.12), m.weight);
        break;
      }
      case "hook": {
        if (!(x > -0.5 && x < 0.9)) break;
        const shot = keyed(
          [
            [-0.55, HoopPose.hold],
            [-0.15, HoopPose.hookSet],
            [0.03, HoopPose.hook],
            [0.4, HoopPose.hook],
            [0.9, still],
          ],
          x,
        );
        if (shot) body = over(body, shot, smooth((x + 0.55) / 0.12), m.weight);
        break;
      }
      case "tip":
        body = over(body, HoopPose.tip, envelope(x, 0.3, 0.4), m.weight);
        break;
      case "pass": {
        if (!(x > -0.3 && x < 0.4)) break;
        const throwing = keyed(
          [
            [-0.32, HoopPose.hold],
            [-0.06, HoopPose.hold],
            [0.07, HoopPose.pass],
            [0.4, HoopPose.pass],
          ],
          x,
        );
        if (throwing) body = over(body, throwing, envelope(x, 0.3, 0.4), m.weight);
        break;
      }
      case "lob": {
        if (!(x > -0.35 && x < 0.45)) break;
        const throwing = keyed(
          [
            [-0.36, HoopPose.hold],
            [-0.1, HoopPose.set],
            [0.08, HoopPose.lob],
            [0.45, HoopPose.lob],
          ],
          x,
        );
        if (throwing) body = over(body, throwing, envelope(x, 0.35, 0.45), m.weight);
        break;
      }
      case "catchBall":
        body = over(body, HoopPose.target, envelope(x, 0.28, 0.16), m.weight);
        break;
      case "contest": {
        const up = player.jumps.some((j) => Math.abs(j.peak - action.at) < 0.3 && j.height > 1.5);
        body = over(body, up ? HoopPose.wall : HoopPose.contest, envelope(x, 0.3, 0.45), m.weight);
        break;
      }
      case "block": {
        if (!(x > -0.35 && x < 0.5)) break;
        const reach = keyed(
          [
            [-0.36, still],
            [-0.04, HoopPose.block],
            [0.1, HoopPose.swat],
            [0.5, still],
          ],
          x,
        );
        if (reach) body = over(body, reach, envelope(x, 0.35, 0.5) > 0 ? 1 : 0, m.weight);
        break;
      }
      case "steal":
        body = over(body, HoopPose.steal, envelope(x, 0.22, 0.3), m.weight * 0.5);
        break;
      case "rebound":
        body = over(body, RigPoses.catchHigh, envelope(x, 0.25, 0.35), m.weight);
        break;
      case "boxOut":
        if (!(x > -0.2 && t < script.settle)) break;
        body = over(body, HoopPose.boxOut, smooth((x + 0.2) / 0.25) * (1 - ease), m.weight * 0.6);
        break;
    }
  }

  // Off the floor: a crouch into it, the legs under him in the air (a
  // layup's knee up, a dunk's tuck: the action's pose keeps its legs), the
  // landing taken in the knees.
  const jump = player.jump(t);
  if (jump) {
    const lift = jump.lift(t);
    const crouch = 0.07 * Math.max(envelope(t - jump.from, 0.18, 0.03), envelope(t - jump.until, 0.01, 0.22));
    const up = smooth(lift / 0.35);
    const action = player.actions.some((a) => (a.kind === "layup" || a.kind === "dunk") && t > a.at - 0.6 && t < a.at + 0.6);
    let left = body.left;
    let right = body.right;
    if (!action) {
      left = toward(left, HoopPose.air.left, up);
      right = toward(right, HoopPose.air.right, up);
    }
    const raise = lift * Hoops.lift;
    body = {
      ...body,
      hip: vec(body.hip.x, body.hip.y, body.hip.z + raise - crouch),
      left: vec(left.x, left.y, left.z + raise),
      right: vec(right.x, right.y, right.z + raise),
    };
  }
  return [body, m.heading];
}

function lastLeg(script: BasketballScript, t: number) {
  for (let i = script.legs.length - 1; i >= 0; i--) if (t >= script.legs[i]!.from) return script.legs[i]!;
  return null;
}

// MARK: - Labels (laid out once per play and size)

export interface Labels {
  readonly stamp: Block | null;
  readonly banner: Block | null;
}

/** The team whose type it is: the offense's or the defense's accent, else the page's ink. */
function sideColor(side: Side | null, scene: BasketballScene | null, teams: BasketballTeams, ink: TheaterInk): string {
  if (!side || !scene?.offense) return primary(ink);
  return side === scene.offense ? accentOf(teams.offense, ink) : accentOf(teams.defense, ink);
}

/**
 * The stamp: the points heavy in the scoring team's color (BLK in the
 * blocker's), the tag lighter beside it, the shot and the credits in small
 * capitals under it (anchored bottom-leading); and the headline in its tone
 * (anchored at its center).
 */
export function layoutLabels(ctx: Ctx, scene: BasketballScene | null, script: BasketballScript, teams: BasketballTeams, ink: TheaterInk, size: Size, pt: number): Labels {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  let stamp: Block | null = null;
  if (scene) {
    const s = basketballStamp(scene);
    const fs = TheaterType.stamp(size, pt);
    const tone = s.tone === "score" ? sideColor(scene.offense, scene, teams, ink) : s.tone === "block" ? sideColor(defense(scene), scene, teams, ink) : primary(ink);
    const runs = s.parts.map((part) => (part.heavy ? run(ctx, part.text, `800 ${fs}px ${FONT}`, fs, tone, -0.5 * pt) : run(ctx, part.text, `700 ${fs * 0.42}px ${FONT}`, fs * 0.42, ink.secondary, 0.6 * pt)));
    const spacing = fs * 0.16;
    const longest = Math.max(s.lines.reduce((m, l) => Math.max(m, [...l].length), 0), 1);
    const tf = Math.max(Math.min(TheaterType.title(size, pt), (size.width * 0.44) / (longest * 0.66)), 6.5 * pt);
    const lineFont = `700 ${tf}px ${FONT}`;
    ctx.font = lineFont;
    const widths = s.lines.map((l) => measureTracked(ctx, l, 0.8 * pt));
    const gap = 1 * pt;
    const row = fs * LINE;
    const lineRow = tf * LINE;
    const height = row + s.lines.length * (lineRow + gap);
    const width = Math.max(runsWidth(runs, spacing), ...widths);
    const secondary = ink.secondary;
    const lines = s.lines;
    stamp = {
      width,
      height,
      draw: (c) => {
        const top = -height;
        drawRuns(c, runs, 0, top + fs * ASCENT, spacing);
        c.font = lineFont;
        c.fillStyle = secondary;
        lines.forEach((l, i) => fillTracked(c, l, 0, top + row + gap + i * (lineRow + gap) + tf * ASCENT, 0.8 * pt));
      },
    };
  }
  let banner: Block | null = null;
  const b = script.banner;
  if (b) {
    const color = b.tone.kind === "side" ? sideColor(b.tone.side, scene, teams, ink) : ink.gold;
    banner = bannerBlock(ctx, b.text, color, TheaterType.bannerFitting(size, pt, b.text));
  }
  ctx.restore();
  return { stamp, banner };
}

// MARK: - A frame of the play

export interface FrameInputs {
  readonly script: BasketballScript;
  readonly t: number;
  readonly teams: BasketballTeams;
  readonly ink: TheaterInk;
  readonly labels: Labels;
}

/** A player posed and placed at t; with the ball, where it is in his hands. */
interface Posed {
  readonly index: number;
  readonly figure: RigFigure;
  readonly ball: Point | null;
}

/**
 * One frame of a play through the camera, after the court (BasketballFrame):
 * the shadows, the baskets' backs, the players far to near, the ball, the
 * nets and the rims' fronts, the beats, the headline and the stamp.
 */
export function drawBasketballFrame(ctx: Ctx, h: HoopProjection, input: FrameInputs): void {
  const { script, t, ink } = input;
  const figures = posed(h, input);
  drawShadows(ctx, h, input, figures);
  const motion: BasketMotion = { net: script.net, rimHit: script.rimHit, rimStrength: script.rimStrength, t };
  for (const end of [-1, 1]) drawBasket(ctx, h, ink, end, false, motion);
  drawPlayers(ctx, h, input, figures);
  const ball = ballPoint(h, input, figures);
  if (ball?.inHoop) drawBall(ctx, h, input, ball.point);
  for (const end of [-1, 1]) drawBasket(ctx, h, ink, end, true, motion);
  if (ball && !ball.inHoop) drawBall(ctx, h, input, ball.point);
  drawFlashes(ctx, h, input);
  drawLabels(ctx, h, input);
}

/** Everyone at t, far to near: a player in front covers the one behind. */
function posed(h: HoopProjection, { script, t }: FrameInputs): Posed[] {
  const carrier = script.carrier(t);
  const order = script.players.map((player, index) => {
    const at = player.position(t);
    return { player, index, at, depth: h.depth(at) };
  });
  order.sort((a, b) => b.depth - a.depth);
  return order.map(({ player, index, at }) => {
    const lens = h.lens(at);
    const [body, heading] = playerPose(script, player, index, t, at, lens.unit);
    const skel = skeleton(body);
    const figure = rigFigure(skel, heading, lens);
    let ball: Point | null = null;
    const spot = carrier && carrier.player === index ? script.ball(t) : null;
    if (carrier && spot) {
      const held = smooth((t - carrier.from) / 0.12) * (Number.isFinite(carrier.until) ? smooth((carrier.until - t) / 0.08) : 1);
      let hand: Point;
      if (carrier.dribbling) {
        // At his right hand at the top of the bounce, on the floor under it at the bottom.
        const leg = lastLeg(script, t);
        const up = BasketballScript.bounce(t - (leg?.from ?? 0));
        const c = Math.cos(heading);
        const s = Math.sin(heading);
        const k = skel.hands[1];
        const top = lens.point(vec(k.x * c - k.y * s, k.x * s + k.y * c, k.z));
        const floor = lens.point(vec(k.x * c - k.y * s, k.x * s + k.y * c, 0.06));
        hand = { x: floor.x + (top.x - floor.x) * up, y: floor.y + (top.y - floor.y) * up };
      } else {
        // Both hands; the right alone through a layup or a tip.
        const one = player.actions.some((a) => (a.kind === "layup" || a.kind === "hook") && Math.abs(t - a.at) < 0.4) ? 1 : 0;
        const g = grip(figure);
        const right = figure.hands[1];
        hand = { x: g.x + (right.x - g.x) * one, y: g.y + (right.y - g.y) * one };
      }
      const loose = h.at(spot);
      ball = { x: loose.x + (hand.x - loose.x) * held, y: loose.y + (hand.y - loose.y) * held };
    }
    return { index, figure, ball };
  });
}

function drawShadows(ctx: Ctx, h: HoopProjection, { script, t, ink }: FrameInputs, figures: readonly Posed[]): void {
  // Under the hips; smaller and fainter as he leaves the floor.
  const w = h.figure * 0.26;
  for (const p of figures) {
    const air = Math.min(p.figure.air / 0.35, 1);
    drawShadow(ctx, p.figure.ground, w * (1 - 0.35 * air), shadow(ink, 1 - 0.5 * air));
  }
  // The ball's: larger and softer the higher it flies.
  const ball = script.ball(t);
  if (ball && ball.z > 0.6 && script.flight(t) != null) {
    const g = h.point(ball);
    const spread = 1 + Math.min(ball.z / 30, 0.9);
    const r = Math.max(0.45 * h.scale, 1.4) * spread;
    ellipse(ctx, g.x, g.y, r, r / 2);
    ctx.fillStyle = shadow(ink, Math.min(1.4 / (1 + ball.z / 14), 0.9));
    ctx.fill();
  }
}

function drawPlayers(ctx: Ctx, h: HoopProjection, { script, teams, ink }: FrameInputs, figures: readonly Posed[]): void {
  const offense = figureInks(teams.offense, ink);
  const defenseInks = figureInks(teams.defense, ink);
  for (const p of figures) drawFigure(ctx, p.figure, script.players[p.index]!.team === "offense" ? offense : defenseInks, h.figure, 1);
}

/** Where the ball is drawn: in his hands, or along its flight; and whether it's inside the hoop (then the rim's front and the net go over it). */
function ballPoint(h: HoopProjection, { script, t }: FrameInputs, figures: readonly Posed[]): { point: Point; inHoop: boolean } | null {
  const ball = script.ball(t);
  if (!ball) return null;
  for (const p of figures) if (p.ball) return { point: p.ball, inHoop: false };
  const inHoop = Math.hypot(ball.x - Hoops.rim.x, ball.y - Hoops.rim.y) < 1.1 && ball.z < Hoops.rimHeight + 0.25 && ball.z > Hoops.rimHeight - 2.6;
  return { point: h.at(ball), inHoop };
}

/** The basketball: a glowing core with its comet tail while it flies. */
function drawBall(ctx: Ctx, h: HoopProjection, { script, t, ink }: FrameInputs, p: Point): void {
  const leather = hoopsInk(ink).leather;
  // A touch larger than life: it's what the eye follows.
  const r = Math.min(Math.max(0.5 * h.scale, 2.1), Math.max(h.figure * 0.09, 2.1));
  const flight = script.flight(t);
  if (flight) {
    const trail: Point[] = [];
    for (let i = 1; i <= 6; i++) trail.push(h.at(flight.point(Math.max(t - i * 0.014, flight.start))));
    drawTrail(ctx, trail, p, r * 0.8, leather);
    drawGlow(ctx, p, r, ink);
  } else if (t < script.settle) {
    drawGlow(ctx, p, r * 0.8, ink, 0.6);
  }
  ellipse(ctx, p.x, p.y, r + 0.6, r + 0.6);
  ctx.fillStyle = ink.ballEdge;
  ctx.fill();
  ellipse(ctx, p.x, p.y, r, r);
  ctx.fillStyle = rgba(leather, 1);
  ctx.fill();
  if (r > 2.8) {
    // The seams.
    ctx.beginPath();
    ctx.moveTo(p.x - r, p.y);
    ctx.lineTo(p.x + r, p.y);
    ctx.moveTo(p.x + r * 0.58, p.y);
    ctx.ellipse(p.x, p.y, r * 0.58, r, 0, 0, 2 * Math.PI);
    ctx.strokeStyle = "rgb(0 0 0 / 0.4)";
    ctx.lineWidth = Math.max(r * 0.12, 0.5);
    ctx.lineCap = "butt";
    ctx.stroke();
  }
}

function drawFlashes(ctx: Ctx, h: HoopProjection, { script, t, ink }: FrameInputs): void {
  const unit = h.figure / 10;
  const hoop = hoopsInk(ink).hoop;
  for (const flash of script.flashes) {
    const age = t - flash.at;
    const c = h.at(flash.point);
    switch (flash.beat) {
      case "catchBall": {
        if (!(age >= 0 && age < 0.28)) continue;
        const u = age / 0.28;
        const r = (1 + 2.8 * (1 - (1 - u) ** 3)) * unit;
        ellipse(ctx, c.x, c.y, r, r);
        ctx.strokeStyle = rgba(ink.trace, 0.7 * (1 - u));
        ctx.lineWidth = Math.max(unit * 0.18, 0.8);
        ctx.stroke();
        break;
      }
      case "block": {
        // Swatted: sparks off his hand.
        if (!(age >= 0 && age < 0.32)) continue;
        const u = age / 0.32;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * 2 * Math.PI - 0.3;
          ctx.moveTo(c.x + Math.cos(a) * (1 + 2 * u) * unit, c.y + Math.sin(a) * (1 + 2 * u) * unit);
          ctx.lineTo(c.x + Math.cos(a) * (2.4 + 5 * u) * unit, c.y + Math.sin(a) * (2.4 + 5 * u) * unit);
        }
        ctx.strokeStyle = rgba(ink.trace, 0.9 * (1 - u));
        ctx.lineWidth = Math.max(unit * 0.22, 1);
        ctx.lineCap = "round";
        ctx.stroke();
        break;
      }
      case "steal": {
        if (!(age >= 0 && age < 0.5)) continue;
        const u = age / 0.5;
        const g = h.point(flash.point);
        const r = (2 + 7 * houseCurve(u)) * unit;
        ellipse(ctx, g.x, g.y, r, r / 2);
        ctx.strokeStyle = rgba(ink.trace, 0.75 * (1 - u));
        ctx.lineWidth = 1.2;
        ctx.stroke();
        break;
      }
      case "rim": {
        if (!(age >= 0 && age < 0.25)) continue;
        const u = age / 0.25;
        const r = (0.8 + 2 * u) * unit;
        ellipse(ctx, c.x, c.y, r, r * 0.6);
        ctx.strokeStyle = rgba(hoop, 0.8 * (1 - u));
        ctx.lineWidth = 1;
        ctx.stroke();
        break;
      }
    }
  }
}

function drawLabels(ctx: Ctx, h: HoopProjection, { script, t, labels }: FrameInputs): void {
  const banner = script.banner;
  if (banner && labels.banner) TheaterType.drawBanner(ctx, labels.banner, banner.at, banner.until, t, h.size);
  if (labels.stamp) TheaterType.drawStamp(ctx, labels.stamp, script.stamp, t, h.size);
}
