/**
 * The football theater, drawn (FootballTheater.swift `GridironLayer`,
 * `GridPose`, `FootballFrame`; FootballScript.swift `GridProjection`): the
 * field from behind the offense through the broadcast camera, turned a
 * third of the way round, then one frame of the play: the lines of
 * scrimmage and to gain, the flag, the shadows, the players far to near,
 * the football, the beats, the headline and the stamp. Everything is
 * projected through the camera, so lines stay crisp at any zoom; nothing is
 * a scaled bitmap. Type is laid out once per play and size (`layoutLabels`).
 */
import type { CameraFrame } from "../../../../data/mlb/playCamera";
import { easeValue, houseCurve, type FieldPoint, type Point } from "../../../../data/mlb/theaterField";
import type { Uniform } from "../../../../data/mlb/theaterTeams";
import type { Side } from "../../../../data/models";
import type { FootballScene } from "../../../../data/theater/footballScene";
import { FootballScript, footballStamp, Gridiron, type Flag, type Player } from "../../../../data/theater/footballScript";
import { gait, keyed, mix, over, Rig, rigArm, rigPose, RigPoses, RigTrack, vec, withPose, type RigPose } from "../../../../data/theater/rig";
import { FieldProjection } from "../../core/theater/fieldProjection";
import { drawFigure, figureInks, grip, RigLens, rigFigure, type RigFigure } from "../../core/theater/rigFigure";
import { hsb, rgba, type TheaterInk } from "../../mlb/theater/theaterInk";
import {
  accentOf,
  ASCENT,
  bannerBlock,
  chalk,
  chalkEdge,
  drawGlow,
  drawRuns,
  drawShadow,
  drawTrail,
  ellipse,
  FONT,
  fillTracked,
  glow,
  LINE,
  measureTracked,
  primary,
  run,
  runsWidth,
  shadow,
  TheaterType,
  turf,
  type Block,
  type Ctx,
  type Size,
} from "../../core/theater/theaterKit";

/** The two teams on the field, always told apart at a glance. */
export interface FootballTeams {
  readonly offense: Uniform;
  readonly defense: Uniform;
}

export interface EndZone {
  /** A hex color. */
  readonly color: string;
  readonly name: string;
}

// MARK: - Projection

/** The field's projection through the camera at a yaw (GridProjection): the ground turned, then FieldProjection's dimetric view. */
export class GridProjection {
  readonly f: FieldProjection;
  readonly yaw: number;
  private readonly c: number;
  private readonly s: number;

  constructor(size: Size, camera: CameraFrame, yaw: number) {
    this.f = new FieldProjection(size, camera);
    this.yaw = yaw;
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

  get size(): Size {
    return this.f.size;
  }
  get camera(): CameraFrame {
    return this.f.camera;
  }
  get scale(): number {
    return this.f.scale;
  }
  get figure(): number {
    return this.f.figure;
  }
}

// MARK: - Field

/** The broadcast's lines: the line of scrimmage blue, the line to gain yellow. */
const SCRIMMAGE_BLUE = [64, 133, 255] as const;
const GAIN_YELLOW = [255, 214, 26] as const;

/** How far down the field the view reaches, near edge to far (on the grass): the view's corners taken back through the camera. */
export function visible(f: GridProjection): [number, number] {
  const { size, camera, scale, yaw } = f;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [sx, sy] of [
    [0, 0],
    [size.width, 0],
    [0, size.height],
    [size.width, size.height],
  ] as const) {
    const x = camera.x + (sx - size.width / 2) / scale;
    const y = (camera.y - (sy - size.height / 2) / scale) / 0.5;
    const v = x * Math.sin(yaw) + y * Math.cos(yaw);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return Number.isFinite(lo) ? [lo, hi] : [0, 300];
}

/**
 * The field (GridironLayer): the turf mowed in five-yard bands, the end
 * zones in the colors of the teams defending them with their names, the
 * yard lines, hash marks and numbers, the sidelines, and the goalposts.
 */
export function drawGridiron(ctx: Ctx, f: GridProjection, ink: TheaterInk, near: EndZone, far: EndZone): void {
  const h = Gridiron.half;
  const yaw = f.yaw;
  const quad = (x0: number, y0: number, x1: number, y1: number) => {
    const a = f.point({ x: x0, y: y0 });
    const b = f.point({ x: x1, y: y0 });
    const c = f.point({ x: x1, y: y1 });
    const d = f.point({ x: x0, y: y1 });
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
  };
  // What's in view, down the field (with a margin for the posts): lines outside it aren't drawn.
  const [lo, hi] = visible(f);
  const shown = (y: number) => y >= lo - 12 && y <= hi + 40;
  // Chalk thickens a little as the camera closes in.
  const line = Math.min(Math.max(0.75, f.scale * 0.3), 1.6);
  /** Type painted flat on the grass: a glyph's right and down along these ground directions. */
  const flat = (u: Point, v: Point, at: Point, k: number) => {
    const c = f.point(at);
    const s = f.scale;
    const gx = { x: Math.cos(yaw) * s, y: 0.5 * Math.sin(yaw) * s };
    const gy = { x: Math.sin(yaw) * s, y: -0.5 * Math.cos(yaw) * s };
    ctx.transform((u.x * gx.x + u.y * gy.x) * k, (u.x * gx.y + u.y * gy.y) * k, (v.x * gx.x + v.y * gy.x) * k, (v.x * gx.y + v.y * gy.y) * k, c.x, c.y);
  };

  // The turf runs on past the sidelines (a chase to the sideline never looks into a void); the field is mowed.
  ctx.beginPath();
  quad(-h - 110, -Gridiron.endZone - 110, h + 110, Gridiron.backLine + 130);
  ctx.fillStyle = turf(ink);
  ctx.fill();
  // Mowed in five-yard bands, every other one lighter.
  ctx.beginPath();
  for (let k = 0; k < 20; k += 2) if (shown(k * 15) || shown((k + 1) * 15)) quad(-h, k * 15, h, (k + 1) * 15);
  ctx.fillStyle = ink.mow;
  ctx.fill();
  // The end zones, in their teams' colors, with their names.
  const zoneAlpha = ink.dark ? 0.34 : 0.28;
  ctx.beginPath();
  quad(-h, -Gridiron.endZone, h, 0);
  ctx.fillStyle = withAlpha(near.color, zoneAlpha);
  ctx.fill();
  ctx.beginPath();
  quad(-h, 300, h, Gridiron.backLine);
  ctx.fillStyle = withAlpha(far.color, zoneAlpha);
  ctx.fill();
  // Type anchored at its line box's center, as SwiftUI draws a symbol: the baseline sits ascent − line/2 below it.
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (const [zone, y] of [
    [near, -15],
    [far, 315],
  ] as const) {
    if (!shown(y) || zone.name === "") continue;
    // 14 ft letters, read from behind the offense.
    ctx.save();
    ctx.font = `900 60px ${FONT}`;
    const expanded = "fontStretch" in ctx;
    if (expanded) ctx.fontStretch = "expanded";
    const width = measureTracked(ctx, zone.name, 0);
    const k = Math.min(14 / (60 * LINE), 140 / Math.max(width, 1));
    ctx.globalAlpha = 0.42;
    flat({ x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y }, k);
    ctx.fillStyle = chalk(ink);
    ctx.fillText(zone.name, 0, 60 * (ASCENT - LINE / 2));
    if (expanded) ctx.fontStretch = "normal";
    ctx.restore();
  }

  // Yard lines every five, the goal lines heavier.
  const yardLines = (goals: boolean) => {
    ctx.beginPath();
    for (let k = 0; k <= 20; k++) {
      if ((k === 0 || k === 20) !== goals || !shown(k * 15)) continue;
      const a = f.point({ x: -h, y: k * 15 });
      const b = f.point({ x: h, y: k * 15 });
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
  };
  ctx.lineCap = "butt";
  const edge = chalkEdge(ink);
  if (edge) {
    // On pale grass, each line sits in a soft edge of its own.
    ctx.beginPath();
    for (let k = 0; k <= 20; k++) {
      if (!shown(k * 15)) continue;
      const a = f.point({ x: -h, y: k * 15 });
      const b = f.point({ x: h, y: k * 15 });
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.strokeStyle = edge;
    ctx.lineWidth = line * 1.3 + 1.2;
    ctx.stroke();
    ctx.beginPath();
    quad(-h, -Gridiron.endZone, h, Gridiron.backLine);
    ctx.lineWidth = line * 1.8 + 1.2;
    ctx.lineJoin = "miter";
    ctx.stroke();
  }
  yardLines(false);
  ctx.strokeStyle = chalk(ink, ink.dark ? 0.75 : 1);
  ctx.lineWidth = line;
  ctx.stroke();
  yardLines(true);
  ctx.strokeStyle = chalk(ink);
  ctx.lineWidth = line * 1.6;
  ctx.stroke();
  // Hash marks every yard, where there's room to see them.
  if (f.scale >= 1.1) {
    ctx.beginPath();
    for (let yard = 1; yard < 100; yard++) {
      if (yard % 5 === 0 || !shown(yard * 3)) continue;
      const y = yard * 3;
      for (const x of [-Gridiron.hash, Gridiron.hash - 2, -h + 0.7, h - 2.7]) {
        const a = f.point({ x, y });
        const b = f.point({ x: x + 2, y });
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
    ctx.strokeStyle = chalk(ink, 0.6);
    ctx.lineWidth = line * 0.8;
    ctx.stroke();
  }
  // The numbers, read from the sidelines: 6 ft tall, their tops toward the middle.
  if (f.scale >= 0.9) {
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.font = `700 40px ${FONT}`;
    ctx.fillStyle = chalk(ink);
    const s = 6 / (40 * LINE);
    for (let k = 1; k <= 9; k++) {
      if (!shown(k * 30)) continue;
      const text = String(k <= 5 ? k * 10 : 100 - k * 10);
      for (const side of [-1, 1]) {
        ctx.save();
        flat({ x: 0, y: -side }, { x: side, y: 0 }, { x: side * Gridiron.numbers, y: k * 30 }, s);
        ctx.fillText(text, 0, 40 * (ASCENT - LINE / 2));
        ctx.restore();
      }
    }
    ctx.restore();
  }
  ctx.textAlign = "left";
  // The sidelines and end lines.
  ctx.beginPath();
  quad(-h, -Gridiron.endZone, h, Gridiron.backLine);
  ctx.strokeStyle = chalk(ink);
  ctx.lineWidth = line * 1.8;
  ctx.lineJoin = "miter";
  ctx.stroke();

  // The goalposts on the end lines: the post, the crossbar, the uprights.
  ctx.beginPath();
  for (const y of [-Gridiron.endZone, Gridiron.backLine]) {
    if (!shown(y)) continue;
    const base = f.point({ x: 0, y }, 0);
    const bar = f.point({ x: 0, y }, Gridiron.crossbar);
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(bar.x, bar.y);
    const lt = f.point({ x: -Gridiron.upright, y }, Gridiron.uprightTop);
    const lb = f.point({ x: -Gridiron.upright, y }, Gridiron.crossbar);
    const rb = f.point({ x: Gridiron.upright, y }, Gridiron.crossbar);
    const rt = f.point({ x: Gridiron.upright, y }, Gridiron.uprightTop);
    ctx.moveTo(lt.x, lt.y);
    ctx.lineTo(lb.x, lb.y);
    ctx.lineTo(rb.x, rb.y);
    ctx.lineTo(rt.x, rt.y);
  }
  ctx.strokeStyle = ink.dark ? `${ink.yellow}d9` : ink.gold;
  ctx.lineWidth = line + 0.35;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
}

/** A hex color at an alpha. */
function withAlpha(hex: string, a: number): string {
  if (!hex.startsWith("#") || hex.length < 7) return hex;
  const v = Number.parseInt(hex.slice(1, 7), 16);
  return rgba([(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff], a);
}

// MARK: - Poses

/** Football's poses beyond the shared ones, relative to his heading (up the field for the offense, down it for the defense). */
export const GridPose = {
  /** Down in a three-point stance: wide, hips up, a hand on the grass. */
  stance: rigPose({
    hip: vec(-0.08, 0, 0.33),
    lean: 1.1,
    left: vec(0.02, 0.15, 0),
    right: vec(-0.08, -0.15, 0),
    knees: 0.35,
    leftArm: rigArm({ swing: 0.55, spread: 0.2, turn: -0.3, bend: 1.2 }),
    rightArm: rigArm({ swing: 1.05, spread: 0.12, turn: -0.1, bend: 0.05 }),
  }),
  /** The quarterback under center, hands under him. */
  center: rigPose({
    hip: vec(-0.06, 0, 0.38),
    lean: 0.5,
    left: vec(0, 0.13, 0),
    right: vec(0, -0.13, 0),
    knees: 0.3,
    leftArm: rigArm({ swing: 0.85, spread: 0.05, turn: -0.35, bend: 0.4 }),
    rightArm: rigArm({ swing: 0.85, spread: 0.05, turn: -0.35, bend: 0.4 }),
  }),
  /** Engaged: low, arms up and out in front. */
  block: rigPose({
    hip: vec(-0.03, 0, 0.42),
    lean: 0.4,
    left: vec(0.1, 0.13, 0),
    right: vec(-0.1, -0.13, 0),
    knees: 0.3,
    leftArm: rigArm({ swing: 1.45, spread: 0.2, turn: -0.25, bend: 0.65 }),
    rightArm: rigArm({ swing: 1.45, spread: 0.2, turn: -0.25, bend: 0.65 }),
  }),
  /** On a knee: the quarterback's kneel, a returner's touchback. */
  kneel: rigPose({
    hip: vec(-0.02, 0, 0.26),
    lean: 0.08,
    left: vec(0.22, 0.08, 0),
    right: vec(-0.26, -0.07, 0.01),
    knees: 0.05,
    leftArm: rigArm({ swing: 0.55, spread: 0.15, turn: -0.2, bend: 0.9 }),
    rightArm: rigArm({ swing: 0.2, spread: 0.2, bend: 0.4 }),
  }),
  /** Brought down: flat on the grass. */
  down: rigPose({
    hip: vec(0.1, 0, 0.1),
    pitch: 1.5,
    lean: 0.05,
    nod: -0.4,
    left: vec(-0.02, 0.08, -0.39),
    right: vec(0.02, -0.09, -0.36),
    leftArm: rigArm({ swing: 2.6, spread: 0.35, bend: 0.4 }),
    rightArm: rigArm({ swing: 2.2, spread: 0.3, bend: 0.6 }),
  }),
  /** The touchdown signal: both arms straight up. */
  touchdown: rigPose({ lean: -0.08, leftArm: rigArm({ swing: 3.05, spread: 0, turn: 0.4, bend: 0.05 }), rightArm: rigArm({ swing: 3.05, spread: 0, turn: 0.4, bend: 0.05 }) }),
  /** A hand up for the fair catch. */
  fairCatch: rigPose({ leftArm: rigArm({ swing: 2.85, spread: 0, turn: 0.6, bend: 0.1 }), rightArm: rigArm({ swing: 0.1, spread: 0.15, bend: 0.3 }) }),
  /** Launched at a man: laid out forward, arms reaching. */
  dive: rigPose({
    hip: vec(0.12, 0, 0.36),
    pitch: 1.1,
    lean: 0.1,
    left: vec(-0.04, 0.08, 0.02),
    right: vec(-0.24, -0.08, 0.14),
    leftArm: rigArm({ swing: 2.85, spread: 0.2, turn: -0.1, bend: 0.25 }),
    rightArm: rigArm({ swing: 2.7, spread: 0.25, turn: -0.1, bend: 0.3 }),
  }),
  /** The ball in both hands at the chest: a quarterback in the pocket. */
  pocket: rigPose({ leftArm: rigArm({ swing: 0.7, spread: 0.05, turn: -0.6, bend: 2.0 }), rightArm: rigArm({ swing: 0.75, spread: 0.08, turn: -0.55, bend: 2.05 }) }),
  /** The ball tucked under his arm, the forearm across it. */
  tuck: rigArm({ swing: 0.35, spread: 0.08, turn: -0.75, bend: 2.0 }),
  /** The kick: the plant foot down, the leg cocked back, then through and high. */
  windup: rigPose({
    hip: vec(0, 0, 0.46),
    lean: -0.1,
    left: vec(0.06, 0.09, 0),
    right: vec(-0.27, -0.07, 0.22),
    leftArm: rigArm({ swing: 0.9, spread: 0.8, turn: 0.2, bend: 0.3 }),
    rightArm: rigArm({ swing: -0.6, spread: 0.35, bend: 0.4 }),
  }),
  through: rigPose({
    hip: vec(0.04, 0, 0.47),
    lean: -0.3,
    left: vec(0.06, 0.09, 0),
    right: vec(0.44, -0.05, 0.6),
    leftArm: rigArm({ swing: 1.4, spread: 0.85, turn: 0.2, bend: 0.25 }),
    rightArm: rigArm({ swing: -0.85, spread: 0.45, bend: 0.3 }),
  }),
  /** The strip: lunging in low, one arm wrapping, the other punching down across at the ball. */
  strip: rigPose({
    hip: vec(0.02, 0, 0.4),
    lean: 0.75,
    twist: 0.35,
    left: vec(0.16, 0.12, 0),
    right: vec(-0.16, -0.12, 0),
    knees: 0.3,
    leftArm: rigArm({ swing: 1.35, spread: 0.2, turn: -0.3, bend: 0.7 }),
    rightArm: rigArm({ swing: 0.95, spread: 0.05, turn: -0.55, bend: 0.25 }),
  }),
  /** Laid out on the grass for a loose ball, both arms reaching for it. */
  scramble: rigPose({
    hip: vec(0.15, 0, 0.2),
    pitch: 1.4,
    lean: 0.1,
    nod: -0.5,
    left: vec(-0.1, 0.1, 0.05),
    right: vec(-0.3, -0.08, 0.1),
    leftArm: rigArm({ swing: 2.7, spread: 0.3, turn: -0.2, bend: 0.5 }),
    rightArm: rigArm({ swing: 2.9, spread: 0.2, turn: -0.2, bend: 0.35 }),
  }),
  /** Up off the line to block a kick: feet tucked, both arms straight up. */
  leap: rigPose({
    hip: vec(0, 0, 0.62),
    lean: -0.05,
    nod: -0.3,
    left: vec(0, 0.07, 0.14),
    right: vec(-0.05, -0.07, 0.12),
    leftArm: rigArm({ swing: 3.0, spread: 0.12, turn: 0.2, bend: 0.05 }),
    rightArm: rigArm({ swing: 3.0, spread: 0.12, turn: 0.2, bend: 0.05 }),
  }),
  /** On his back after a hit as he threw, arms flung out. */
  knocked: rigPose({
    hip: vec(-0.1, 0, 0.12),
    pitch: -1.45,
    nod: 0.35,
    left: vec(0.02, 0.1, -0.36),
    right: vec(0.06, -0.1, -0.3),
    knees: 0.3,
    leftArm: rigArm({ swing: 2.5, spread: 0.55, bend: 0.4 }),
    rightArm: rigArm({ swing: 2.3, spread: 0.6, bend: 0.5 }),
  }),
  /** An official's flag: drawn back and up beside his head, then whipped through and down at the spot. */
  flagBack: rigPose({
    turn: -0.35,
    twist: -0.3,
    left: vec(0.08, 0.1, 0),
    right: vec(-0.08, -0.1, 0),
    leftArm: rigArm({ swing: 0.6, spread: 0.3, bend: 0.4 }),
    rightArm: rigArm({ swing: 2.5, spread: 0.45, turn: 0.9, bend: 1.3 }),
  }),
  flagThrow: rigPose({
    turn: 0.15,
    lean: 0.25,
    twist: 0.3,
    left: vec(0.14, 0.1, 0),
    right: vec(-0.12, -0.1, 0.02),
    leftArm: rigArm({ swing: 0.3, spread: 0.35, bend: 0.4 }),
    rightArm: rigArm({ swing: 1.35, spread: 0.15, turn: -0.3, bend: 0.2 }),
  }),
};

/** An official's stripes, as near as a pictogram gets: white, a black cap. */
export const OFFICIAL: Uniform = { jersey: "#ededed", cap: "#1a1a1a", piping: null, accent: "#ffffff" };

/**
 * How far the ball has gone from both hands into the throwing hand (his
 * right) as he cocks to throw: none until the windup, all of it from then
 * until it's away (FootballFrame.cocked). (pure; tested)
 */
export function cocked(player: Player, t: number): number {
  const pass = player.actions.find((a) => (a.kind === "throwBall" || a.kind === "spike") && t > a.at - 0.34 && t < a.at + 0.05);
  return pass ? smooth((t - pass.at + 0.34) / 0.14) : 0;
}

const THROW_KEYS: readonly (readonly [number, RigPose])[] = [
  [-0.3, RigPoses.cock],
  [-0.04, RigPoses.cock],
  [0.1, RigPoses.release],
  [0.4, RigPoses.release],
];

const envelope = (x: number, attack: number, release: number) => (x < 0 ? Math.max(1 + x / attack, 0) : Math.max(1 - x / release, 0));
const smooth = Rig.smooth;

/**
 * The body at t, and its heading (FootballFrame.pose): a pose he holds (on a
 * knee, down, a signal), else what he's doing with the ball (a catch, a
 * throw, a kick, a tackle, a block) over how he's moving (striding to his
 * planted feet), else how he stands (down in his stance before the snap and
 * once he's set at the new line). `unit`: body units to the foot where he
 * stands. (tested)
 */
export function playerPose(script: FootballScript, player: Player, index: number, t: number, here: Point, unit: number): [RigPose, number] {
  const track = script.rig[index] ?? RigTrack.standing(here);
  const m = track.motion(t);

  // How he stands: in his stance (out of it as the ball's snapped, into it as he sets at the new line), else ready or upright.
  let upright: RigPose;
  switch (player.role) {
    case "line":
    case "front":
    case "backer":
    case "corner":
    case "safety":
    case "tightEnd":
      upright = RigPoses.ready;
      break;
    default:
      upright = RigPoses.stand;
  }
  let set = player.set != null ? 1 - smooth((t - player.set) / 0.15) : 0;
  if (player.resets != null) set = Math.max(set, smooth((t - player.resets + 0.3) / 0.3));
  const still = mix(upright, player.role === "quarterback" ? GridPose.center : GridPose.stance, set);
  const feet = track.feet(t, here, m.heading, unit, m.speed, { left: still.left, right: still.right });
  let body = mix(still, gait(m, feet), m.weight);

  const hold = player.hold(t);
  if (hold) {
    const into = smooth((t - hold.from) / 0.16);
    switch (hold.kind) {
      case "down":
        return [mix(GridPose.dive, GridPose.down, into), m.heading];
      case "kneel":
        return [mix(body, GridPose.kneel, into), m.heading];
      case "touchdown":
        return [over(body, GridPose.touchdown, into, m.weight), m.heading];
      case "fairCatch":
        return [over(body, GridPose.fairCatch, smooth((t - hold.from) / 0.2), m.weight), m.heading];
      case "knocked":
        return [mix(body, GridPose.knocked, smooth((t - hold.from) / 0.3)), m.heading];
    }
  }

  // With the ball: held at the chest in the pocket, tucked away on the run (the other arm still pumping).
  const carry = script.carrier(t);
  if (carry && carry.player === index) {
    const held = smooth((t - carry.from) / 0.15) * (Number.isFinite(carry.until) ? smooth((carry.until - t) / 0.15) : 1);
    const running = smooth((m.speed - 1.5) / 1);
    if (player.role === "quarterback" && m.speed < 2.5) body = over(body, GridPose.pocket, held * (1 - running), 1);
    body = over(body, withPose(body, { leftArm: GridPose.tuck }), held * (player.role === "quarterback" ? running : 1), 1);
  }

  for (const action of player.actions) {
    const x = t - action.at;
    switch (action.kind) {
      case "catchHigh":
        body = over(body, RigPoses.catchHigh, envelope(x, 0.25, 0.3), m.weight);
        break;
      case "catchChest":
      case "handoff":
        body = over(body, RigPoses.glove, envelope(x, 0.2, 0.25), m.weight);
        break;
      case "scoop":
        body = over(body, RigPoses.scoop, envelope(x, 0.2, 0.3), m.weight * 0.5);
        break;
      case "throwBall":
      case "spike": {
        if (!(x > -0.24 && x < 0.4)) break;
        const throwing = keyed(THROW_KEYS, x);
        if (throwing) body = over(body, throwing, Math.min(envelope(x, 0.2, 0.36) * 1.6, 1), m.weight);
        break;
      }
      case "kick": {
        const kicking = keyed(
          [
            [-0.3, body],
            [-0.08, GridPose.windup],
            [0.1, GridPose.through],
            [0.25, GridPose.through],
            [0.6, body],
          ],
          x,
        );
        if (kicking) body = kicking;
        break;
      }
      case "tackle":
        body = mix(body, GridPose.dive, envelope(x, 0.16, 0.5));
        break;
      case "strip":
        body = mix(body, GridPose.strip, envelope(x, 0.18, 0.45));
        break;
      case "scramble":
        body = mix(body, GridPose.scramble, envelope(x, 0.2, 0.6));
        break;
      case "leap":
        body = mix(body, GridPose.leap, envelope(x, 0.22, 0.5));
        break;
      case "flagThrow": {
        const throwing = keyed(
          [
            [-0.35, body],
            [-0.12, GridPose.flagBack],
            [0.04, GridPose.flagThrow],
            [0.18, GridPose.flagThrow],
            [0.55, body],
          ],
          x,
        );
        if (throwing) body = over(body, throwing, 1, m.weight);
        break;
      }
      case "block":
        // Held once engaged, while he's set.
        if (!(x > -0.2 && t < script.settle)) break;
        body = over(body, GridPose.block, smooth((x + 0.2) / 0.2), m.weight * 0.7);
        break;
    }
  }
  return [body, m.heading];
}

// MARK: - Labels (laid out once per play and size)

export interface Labels {
  readonly stamp: Block | null;
  readonly banner: Block | null;
  /** "DECLINED", beside a declined flag (anchored at its bottom center). */
  readonly declined: Block | null;
}

/** The team whose type it is: the offense's or the defense's accent, else the page's ink. */
function sideColor(side: Side | null, scene: FootballScene | null, teams: FootballTeams, ink: TheaterInk): string {
  if (!side || !scene?.offense) return primary(ink);
  return side === scene.offense ? accentOf(teams.offense, ink) : accentOf(teams.defense, ink);
}

/**
 * The stamp: the number heavy in the play's color, the tag lighter beside
 * it, the play in small capitals under it (anchored bottom-leading); and the
 * headline in its tone (anchored at its center).
 */
export function layoutLabels(ctx: Ctx, scene: FootballScene | null, script: FootballScript, teams: FootballTeams, ink: TheaterInk, size: Size, pt: number): Labels {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  let stamp: Block | null = null;
  if (scene) {
    const s = footballStamp(scene);
    const fs = TheaterType.stamp(size, pt);
    const tone = s.tone === "gain" ? accentOf(teams.offense, ink) : s.tone === "score" ? sideColor(scene.scorer, scene, teams, ink) : s.tone === "loss" ? rgba(ink.red, 1) : s.tone === "flag" ? ink.gold : primary(ink);
    if (s.parts.length > 0) {
      const runs = s.parts.map((part) => {
        // A first down in the yellow of the line it crossed.
        const color = part.text === "✗" ? rgba(ink.red, 1) : part.heavy ? tone : part.text === "1ST DOWN" ? ink.gold : ink.secondary;
        return part.heavy ? run(ctx, part.text, `800 ${fs}px ${FONT}`, fs, color, -0.5 * pt) : run(ctx, part.text, `700 ${fs * 0.42}px ${FONT}`, fs * 0.42, color, 0.6 * pt);
      });
      const spacing = fs * 0.16;
      const title = s.title.toUpperCase();
      const tf = Math.min(TheaterType.title(size, pt), (size.width * 0.34) / Math.max([...title].length * 0.72, 1));
      const titleFont = `700 ${tf}px ${FONT}`;
      ctx.font = titleFont;
      const titleWidth = title ? measureTracked(ctx, title, 1 * pt) : 0;
      const row = fs * LINE;
      const height = row + (title ? tf * LINE : 0);
      const width = Math.max(runsWidth(runs, spacing), titleWidth);
      const secondary = ink.secondary;
      stamp = {
        width,
        height,
        draw: (c) => {
          const top = -height;
          drawRuns(c, runs, 0, top + fs * ASCENT, spacing);
          if (title) {
            c.font = titleFont;
            c.fillStyle = secondary;
            fillTracked(c, title, 0, top + row + tf * ASCENT, 1 * pt);
          }
        },
      };
    }
  }
  let banner: Block | null = null;
  const b = script.banner;
  if (b) {
    const color = b.tone.kind === "side" ? sideColor(b.tone.side, scene, teams, ink) : b.tone.kind === "gold" ? ink.gold : primary(ink);
    banner = bannerBlock(ctx, b.text, color, TheaterType.bannerFitting(size, pt, b.text));
  }
  let declined: Block | null = null;
  if (script.flags.some((f) => f.declined)) {
    const fs = TheaterType.title(size, pt) * 0.9;
    const font = `800 ${fs}px ${FONT}`;
    ctx.font = font;
    const text = "DECLINED";
    const width = measureTracked(ctx, text, 0.8 * pt);
    const height = fs * LINE;
    declined = {
      width,
      height,
      draw: (c) => {
        c.font = font;
        c.fillStyle = rgba(GAIN_YELLOW, 1);
        c.textAlign = "left";
        fillTracked(c, text, -width / 2, -height + fs * ASCENT, 0.8 * pt);
      },
    };
  }
  ctx.restore();
  return { stamp, banner, declined };
}

// MARK: - A frame of the play

export interface FrameInputs {
  readonly script: FootballScript;
  readonly t: number;
  readonly teams: FootballTeams;
  readonly ink: TheaterInk;
  readonly labels: Labels;
}

/** One frame of a play through the camera (FootballFrame): the lines, the flag, the shadows, the players far to near, the ball, the beats, the headline and the stamp. */
export function drawFootballFrame(ctx: Ctx, f: GridProjection, input: FrameInputs): void {
  drawLines(ctx, f, input);
  drawFlags(ctx, f, input);
  const figures = posed(f, input);
  drawShadows(ctx, f, input, figures);
  drawPlayers(ctx, f, input, figures);
  let held: Point | null = null;
  for (const p of figures) if (p.ball) held ??= p.ball;
  drawFootball(ctx, f, input, held);
  drawFlashes(ctx, f, input);
  drawLabels(ctx, f, input);
}

function band(ctx: Ctx, f: GridProjection, y0: number, y1: number): void {
  const h = Gridiron.half;
  const a = f.point({ x: -h, y: y0 });
  const b = f.point({ x: h, y: y0 });
  const c = f.point({ x: h, y: y1 });
  const d = f.point({ x: -h, y: y1 });
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
}

function drawLines(ctx: Ctx, f: GridProjection, { script, t }: FrameInputs): void {
  const u = script.linesProgress(t);
  // After a score or a kick they fade with the play's end.
  const width = Math.max(1.4, 1.6 / Math.max(f.scale, 0.1));
  const gain = FootballScript.line(script.lines.gain, script.next.gain, u);
  if (gain) {
    band(ctx, f, gain.y - width / 2, gain.y + width / 2);
    ctx.fillStyle = rgba(GAIN_YELLOW, 0.85 * gain.opacity);
    ctx.fill();
  }
  const line = FootballScript.line(script.lines.scrimmage, script.next.scrimmage, u);
  if (line) {
    band(ctx, f, line.y - width / 2, line.y + width / 2);
    ctx.fillStyle = rgba(SCRIMMAGE_BLUE, 0.85 * line.opacity);
    ctx.fill();
  }
  // A flag's yards, while they're walked off: a band between the spots.
  const march = script.march;
  if (march && t >= march.start - 0.2 && t < script.settle + 0.4) {
    const grow = easeValue("inOut", (t - march.start) / Math.max(march.end - march.start, 0.01));
    const fade = 1 - Math.min(Math.max((t - script.settle) / 0.4, 0), 1);
    band(ctx, f, march.from, march.from + (march.to - march.from) * grow);
    ctx.fillStyle = rgba(GAIN_YELLOW, 0.14 * fade);
    ctx.fill();
  }
}

/** The flags: each tossed in end over end, then lying where it landed until the field settles; a declined one says so beside it once the play is over. */
function drawFlags(ctx: Ctx, f: GridProjection, input: FrameInputs): void {
  const { script, t } = input;
  for (const flag of script.flags) if (t >= flag.thrown && t < script.settle + 0.3) drawFlag(ctx, f, flag, input);
}

function drawFlag(ctx: Ctx, f: GridProjection, flag: Flag, { script, t, labels }: FrameInputs): void {
  const u = Math.min(Math.max((t - flag.thrown) / (flag.lands - flag.thrown), 0), 1);
  const x = flag.from.x + (flag.to.x - flag.from.x) * u;
  const y = flag.from.y + (flag.to.y - flag.from.y) * u;
  const z = flag.from.z * (1 - u) + 10 * 4 * u * (1 - u);
  const p = f.point({ x, y }, z);
  const s = Math.max(f.scale * 1.4, 2.2);
  ctx.save();
  ctx.globalAlpha = 1 - Math.min(Math.max((t - script.settle) / 0.3, 0), 1);
  ctx.translate(p.x, p.y);
  ctx.rotate(u < 1 ? u * 9 : 0.4);
  const h = s * (u < 1 ? 1.4 : 0.7);
  ctx.beginPath();
  ctx.roundRect(-s, -h / 2, 2 * s, h, s * 0.2);
  ctx.fillStyle = rgba(GAIN_YELLOW, 1);
  ctx.fill();
  ctx.strokeStyle = "rgb(0 0 0 / 0.3)";
  ctx.lineWidth = 0.5;
  ctx.stroke();
  ctx.restore();
  const declared = Math.max(flag.lands, script.stamp - 0.2);
  if (flag.declined && t >= declared && labels.declined) {
    ctx.save();
    ctx.globalAlpha = Math.min((t - declared) / 0.2, 1) * (1 - Math.min(Math.max((t - script.settle) / 0.3, 0), 1));
    ctx.translate(p.x, p.y - s * 1.2);
    labels.declined.draw(ctx);
    ctx.restore();
  }
}

function drawShadows(ctx: Ctx, f: GridProjection, { script, t, ink }: FrameInputs, figures: readonly Posed[]): void {
  // Under the hips (longer for a man down); smaller and fainter as he leaves the ground.
  const w = f.figure * 0.3;
  for (const p of figures) {
    const held = script.players[p.index]!.hold(t)?.kind;
    const down = held === "down" || held === "knocked";
    const air = Math.min(p.figure.air / 0.4, 1);
    drawShadow(ctx, p.figure.ground, (down ? w * 1.6 : w) * (1 - 0.35 * air), shadow(ink, p.opacity * (1 - 0.45 * air)));
  }
  // The ball's: larger and softer the higher it flies, with a hairline up to it once it's well off the grass.
  const ball = script.ball(t);
  if (ball && ball.z > 0.3 && script.flight(t) != null) {
    const g = f.point(ball);
    const spread = 1 + Math.min(ball.z / 50, 1.4);
    const r = Math.max(0.55 * f.scale, 1.6) * spread;
    ellipse(ctx, g.x, g.y, r, r / 2);
    ctx.fillStyle = shadow(ink, Math.min(1.6 / (1 + ball.z / 40), 1));
    ctx.fill();
    if (ball.z > 6) {
      const top = f.at(ball);
      ctx.beginPath();
      ctx.moveTo(g.x, g.y);
      ctx.lineTo(top.x, top.y);
      ctx.strokeStyle = rgba(ink.trace, 0.16 * Math.min((ball.z - 6) / 10, 1));
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }
}

/** A player posed and placed at t; with the ball, where it is in his hands. */
interface Posed {
  readonly index: number;
  readonly figure: RigFigure;
  readonly opacity: number;
  readonly ball: Point | null;
}

/** Everyone on the field at t, far to near: a player in front covers the one behind. */
function posed(f: GridProjection, { script, t }: FrameInputs): Posed[] {
  const c = Math.cos(script.yaw);
  const s = Math.sin(script.yaw);
  const order = script.players.map((player, index) => {
    const at = player.position(t);
    return { player, index, at, depth: -at.x * s + at.y * c };
  });
  order.sort((a, b) => b.depth - a.depth);
  const carry = script.carrier(t);
  const out: Posed[] = [];
  for (const { player, index, at } of order) {
    const o = player.opacity(t);
    if (!(o > 0.01)) continue;
    const lens = RigLens.grid(f, at);
    const [body, heading] = playerPose(script, player, index, t, at, lens.unit);
    const figure = rigFigure(body, heading, lens);
    // Carried: in both hands at the chest, or the tucking hand; from where it came, into them.
    let ball: Point | null = null;
    const spot = carry && carry.player === index ? script.ball(t) : null;
    if (carry && spot) {
      const held = smooth((t - carry.from) / 0.15) * (Number.isFinite(carry.until) ? smooth((carry.until - t) / 0.15) : 1);
      const tucked = player.role === "quarterback" ? smooth(((script.rig[index]?.motion(t).speed ?? 0) - 1.5) / 1) : 1;
      const g = grip(figure);
      const tuck = figure.hands[0];
      const throwing = figure.hands[1];
      // Leaving his hands: toward where it goes next (the throw's first inch, the back's hands), not his middle.
      const next = Number.isFinite(carry.until) && carry.until - t < 0.15 ? (script.ball(carry.until + 1e-4) ?? spot) : spot;
      const loose = f.at(next);
      let hold = { x: g.x + (tuck.x - g.x) * tucked, y: g.y + (tuck.y - g.y) * tucked };
      // Cocked to throw: in the throwing hand, back by his ear.
      const k = cocked(player, t);
      hold = { x: hold.x + (throwing.x - hold.x) * k, y: hold.y + (throwing.y - hold.y) * k };
      ball = { x: loose.x + (hold.x - loose.x) * held, y: loose.y + (hold.y - loose.y) * held };
    }
    out.push({ index, figure, opacity: o, ball });
  }
  return out;
}

function drawPlayers(ctx: Ctx, f: GridProjection, { script, teams, ink }: FrameInputs, figures: readonly Posed[]): void {
  const offense = figureInks(teams.offense, ink);
  const defense = figureInks(teams.defense, ink);
  // An official, only when one throws a flag: white, a black cap.
  const official = script.players.some((p) => p.team === "official") ? figureInks(OFFICIAL, ink) : offense;
  for (const p of figures) {
    const team = script.players[p.index]!.team;
    drawFigure(ctx, p.figure, team === "offense" ? offense : team === "defense" ? defense : official, f.figure, p.opacity);
  }
}

/** A football: a brown oval along its flight in a soft glow, a comet tail while it's in the air, in his hands while he has it, its shadow on the grass (with the shadows). */
function drawFootball(ctx: Ctx, f: GridProjection, { script, t, ink }: FrameInputs, held: Point | null): void {
  const ball = script.ball(t);
  if (!ball) return;
  const p = held ?? f.at(ball);
  // A touch larger than life, as the baseball is: it's what the eye follows.
  const r = Math.min(Math.max(0.55 * f.scale, 2.2), Math.max(f.figure * 0.13, 2.2));
  const flight = script.flight(t);
  let angle = 0;
  if (flight) {
    const trail: Point[] = [];
    for (let i = 1; i <= 6; i++) trail.push(f.at(flight.point(Math.max(t - i * 0.014, flight.start))));
    drawTrail(ctx, trail, p, r * 0.8, ink.ball);
    const last = trail[0]!;
    if (Math.hypot(last.x - p.x, last.y - p.y) > 0.3) angle = Math.atan2(p.y - last.y, p.x - last.x);
    drawGlow(ctx, p, r, ink);
  } else if (t < script.settle) {
    drawGlow(ctx, p, r * 0.8, ink, 0.7);
  }
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  ellipse(ctx, 0, 0, r * 1.45 + 0.6, r * 0.92 + 0.6);
  ctx.fillStyle = ink.ballEdge;
  ctx.fill();
  ellipse(ctx, 0, 0, r * 1.45, r * 0.92);
  ctx.fillStyle = rgba(hsb(0.06, 0.62, ink.dark ? 0.72 : 0.55), 1);
  ctx.fill();
  if (r > 2.6) {
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, 0);
    ctx.lineTo(r * 0.5, 0);
    ctx.strokeStyle = "rgb(255 255 255 / 0.85)";
    ctx.lineWidth = Math.max(r * 0.18, 0.6);
    ctx.lineCap = "butt";
    ctx.stroke();
  }
  ctx.restore();
}

function drawFlashes(ctx: Ctx, f: GridProjection, { script, t, ink }: FrameInputs): void {
  const unit = f.figure / 10;
  for (const flash of script.flashes) {
    const age = t - flash.at;
    const c = f.at(flash.point);
    switch (flash.beat) {
      case "snap":
        continue;
      case "kick": {
        // Short rays off the foot.
        if (!(age >= 0 && age < 0.24)) continue;
        const u = age / 0.24;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * 2 * Math.PI + 0.3;
          const inner = (1.2 + 3 * u) * unit;
          const outer = (2.6 + 6 * u) * unit;
          ctx.moveTo(c.x + Math.cos(a) * inner, c.y + Math.sin(a) * inner * 0.8);
          ctx.lineTo(c.x + Math.cos(a) * outer, c.y + Math.sin(a) * outer * 0.8);
        }
        ctx.strokeStyle = rgba(ink.trace, 0.95 * (1 - u));
        ctx.lineWidth = Math.max(unit * 0.22, 1);
        ctx.lineCap = "round";
        ctx.stroke();
        break;
      }
      case "catchBall": {
        // The pop in his hands: a flash and a ring.
        if (!(age >= 0 && age < 0.32)) continue;
        const u = age / 0.32;
        const r = (1.2 + 3.6 * (1 - (1 - u) ** 3)) * unit;
        ellipse(ctx, c.x, c.y, r, r);
        ctx.strokeStyle = rgba(ink.trace, 0.85 * (1 - u));
        ctx.lineWidth = Math.max(unit * 0.2, 1);
        ctx.stroke();
        if (age < 0.1) {
          const d = (1.8 - age * 6) * unit;
          ellipse(ctx, c.x, c.y, d, d);
          ctx.fillStyle = glow(ink, 0.45);
          ctx.fill();
        }
        break;
      }
      case "hit": {
        // The stop: a ring on the grass where they met.
        if (!(age >= 0 && age < 0.55)) continue;
        const u = age / 0.55;
        const g = f.point(flash.point);
        const r = (2.5 + 8 * houseCurve(u)) * unit;
        ellipse(ctx, g.x, g.y, r, r / 2);
        ctx.strokeStyle = rgba(ink.trace, 0.8 * (1 - u));
        ctx.lineWidth = 1.4;
        ctx.stroke();
        break;
      }
      case "deflect": {
        // Knocked away: sparks off his hands.
        if (!(age >= 0 && age < 0.3)) continue;
        const u = age / 0.3;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * 2 * Math.PI - 0.4;
          ctx.moveTo(c.x + Math.cos(a) * (1 + 2 * u) * unit, c.y + Math.sin(a) * (1 + 2 * u) * unit);
          ctx.lineTo(c.x + Math.cos(a) * (2.4 + 4.5 * u) * unit, c.y + Math.sin(a) * (2.4 + 4.5 * u) * unit);
        }
        ctx.strokeStyle = rgba(ink.trace, 0.9 * (1 - u));
        ctx.lineWidth = Math.max(unit * 0.2, 1);
        ctx.lineCap = "round";
        ctx.stroke();
        break;
      }
      case "flag": {
        if (!(age >= 0 && age < 0.45)) continue;
        const u = age / 0.45;
        const r = (1.5 + 5 * houseCurve(u)) * unit;
        ellipse(ctx, c.x, c.y, r, r / 2);
        ctx.strokeStyle = rgba(GAIN_YELLOW, 0.9 * (1 - u));
        ctx.lineWidth = 1.2;
        ctx.stroke();
        break;
      }
    }
  }
}

function drawLabels(ctx: Ctx, f: GridProjection, { script, t, labels }: FrameInputs): void {
  const banner = script.banner;
  if (banner && labels.banner) TheaterType.drawBanner(ctx, labels.banner, banner.at, banner.until, t, f.size);
  if (labels.stamp) TheaterType.drawStamp(ctx, labels.stamp, script.stamp, t, f.size);
}
