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
import { easeValue, houseCurve, smooth, type FieldPoint, type Point } from "../../../../data/mlb/theaterField";
import { facing, figure, mixPose, Poses, type Pose } from "../../../../data/mlb/theaterPose";
import type { Uniform } from "../../../../data/mlb/theaterTeams";
import type { Side } from "../../../../data/models";
import type { FootballScene } from "../../../../data/theater/footballScene";
import { FootballScript, footballStamp, Gridiron, type Player } from "../../../../data/theater/footballScript";
import { FieldProjection } from "../../mlb/theater/drawTheater";
import { hsb, rgba, type TheaterInk } from "../../mlb/theater/theaterInk";
import {
  accentOf,
  ASCENT,
  bannerBlock,
  chalk,
  drawFigure,
  drawGlow,
  drawRuns,
  drawShadow,
  drawTrail,
  ellipse,
  figureInks,
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
  ctx.fillStyle = ink.grass;
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
  ctx.beginPath();
  for (let k = 1; k < 20; k++) {
    if (!shown(k * 15)) continue;
    const a = f.point({ x: -h, y: k * 15 });
    const b = f.point({ x: h, y: k * 15 });
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.strokeStyle = chalk(ink, 0.75);
  ctx.lineWidth = line;
  ctx.lineCap = "butt";
  ctx.stroke();
  ctx.beginPath();
  for (const k of [0, 20]) {
    if (!shown(k * 15)) continue;
    const a = f.point({ x: -h, y: k * 15 });
    const b = f.point({ x: h, y: k * 15 });
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
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
  ctx.strokeStyle = `${ink.yellow}d9`;
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

const pose = (lean: number, nearThigh: number, nearShin: number, farThigh: number, farShin: number, nearUpper: number, nearFore: number, farUpper: number, farFore: number): Pose => ({
  lean,
  nearThigh,
  nearShin,
  farThigh,
  farShin,
  nearUpper,
  nearFore,
  farUpper,
  farFore,
  lift: 0,
});

/** Football's poses beyond baseball's: front on (or from behind) for the stances and the signals, in profile for the kick and the dive. */
export const GridPose = {
  /** Down in a stance: knees bent wide, hands low. */
  stance: pose(0, 1.05, -0.3, -1.05, 0.3, 0.3, 0.12, -0.3, -0.12),
  /** The quarterback under center. */
  center: pose(0, 0.7, -0.15, -0.7, 0.15, 0.6, 0.2, -0.6, -0.2),
  /** Engaged: arms up and out in front. */
  block: pose(0, 0.6, -0.15, -0.6, 0.15, 1.15, 1.85, -1.15, -1.85),
  kneel: pose(0, 1.45, 0.05, 0.25, -1.4, 0.3, 0.8, -0.1, 0.5),
  /** Brought down: flat on the grass. */
  down: pose(1.45, -1.35, -1.45, -1.5, -1.6, 2.0, 2.2, 1.6, 1.9),
  /** The touchdown signal: both arms straight up. */
  touchdown: pose(0, 0.12, 0.05, -0.12, -0.05, 2.9, 3.08, -2.9, -3.08),
  /** A hand up for the fair catch. */
  fairCatch: pose(0, 0.1, 0.05, -0.1, -0.05, 2.95, 3.1, -0.25, -0.1),
  dive: pose(1.15, 0.1, -0.7, -0.7, -1.5, 1.75, 1.65, 1.55, 1.45),
  /** The kick: the leg cocked back, then through and high. */
  windup: pose(-0.1, -0.9, -1.6, 0.05, 0, -0.6, -0.3, 0.9, 0.7),
  through: pose(-0.25, 1.7, 1.9, -0.05, -0.05, -0.9, -0.7, 1.4, 1.5),
};

const envelope = (x: number, attack: number, release: number) => (x < 0 ? Math.max(1 + x / attack, 0) : Math.max(1 - x / release, 0));

/**
 * The pose at t: a pose he holds (on a knee, down, a signal), else what he's
 * doing with the ball (a catch, a throw, a kick, a tackle), over how he's
 * moving (running, jogging), else how he stands (down in his stance before
 * the snap).
 */
export function playerPose(script: FootballScript, player: Player, index: number, t: number): Pose {
  const here = player.position(t);
  // Offense faces up the field, the defense down it: in profile, right and left.
  const home = player.team === "offense" ? 1 : -1;
  const facingToward = (p: Point) => (Math.abs(p.x - here.x) < 2 ? home : p.x - here.x >= 0 ? 1 : -1);

  const hold = player.hold(t);
  if (hold) {
    const into = smooth((t - hold.from) / 0.16);
    switch (hold.kind) {
      case "down": {
        const heading = player.motion(hold.from - 0.05)?.heading.x ?? home;
        const f = Math.abs(heading) < 0.15 ? home : heading > 0 ? 1 : -1;
        return mixPose(facing(GridPose.dive, f), facing(GridPose.down, f), into);
      }
      case "kneel":
        return mixPose(Poses.stand, facing(GridPose.kneel, home), into);
      case "touchdown":
        return mixPose(Poses.stand, GridPose.touchdown, into);
      case "fairCatch":
        return facing(GridPose.fairCatch, home);
    }
  }

  let base: Pose;
  const motion = player.motion(t);
  if (motion && motion.speed > 3) {
    const f = Math.abs(motion.heading.x) < 0.2 ? home : motion.heading.x > 0 ? 1 : -1;
    base = motion.speed > 28 ? facing(Poses.run(2 * Math.PI * 3.4 * t + index), f) : facing(Poses.walk(2 * Math.PI * 2.2 * t + index), f);
  } else if (player.inStance(t)) {
    base = player.role === "quarterback" ? GridPose.center : GridPose.stance;
  } else {
    switch (player.role) {
      case "line":
      case "front":
      case "backer":
      case "corner":
      case "safety":
      case "tightEnd":
        base = Poses.ready;
        break;
      default:
        base = Poses.stand;
    }
  }

  for (const action of player.actions) {
    const x = t - action.at;
    const f = facingToward(action.toward);
    switch (action.kind) {
      case "catchHigh":
        base = mixPose(base, facing(Poses.catchHigh, f), envelope(x, 0.25, 0.3));
        break;
      case "catchChest":
      case "handoff":
        base = mixPose(base, facing(Poses.glove, f), envelope(x, 0.2, 0.25));
        break;
      case "scoop":
        base = mixPose(base, facing(Poses.scoop, f), envelope(x, 0.2, 0.3));
        break;
      case "throwBall":
      case "spike": {
        if (!(x > -0.24 && x < 0.4)) break;
        const throwing = x < -0.04 ? Poses.cock : mixPose(Poses.cock, Poses.release, smooth((x + 0.04) / 0.14));
        base = mixPose(base, facing(throwing, action.kind === "spike" ? home : f), Math.min(envelope(x, 0.2, 0.36) * 1.6, 1));
        break;
      }
      case "kick": {
        if (!(x > -0.3 && x < 0.6)) break;
        const kicking = x < 0 ? mixPose(Poses.stand, GridPose.windup, smooth((x + 0.3) / 0.22)) : mixPose(GridPose.windup, GridPose.through, smooth(x / 0.1));
        base = x < 0.25 ? facing(kicking, home) : mixPose(facing(kicking, home), base, smooth((x - 0.25) / 0.35));
        break;
      }
      case "tackle":
        base = mixPose(base, facing(GridPose.dive, f), envelope(x, 0.16, 0.5));
        break;
      case "block": {
        // Held once engaged, while he's set.
        if (!(x > -0.2 && t < script.settle)) break;
        const moving = player.motion(t);
        base = mixPose(base, facing(GridPose.block, f), smooth((x + 0.2) / 0.2) * (moving ? (moving.speed > 28 ? 0.3 : 1) : 1));
        break;
      }
    }
  }
  return base;
}

// MARK: - Labels (laid out once per play and size)

export interface Labels {
  readonly stamp: Block | null;
  readonly banner: Block | null;
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
    banner = bannerBlock(ctx, b.text, color, TheaterType.banner(size, pt));
  }
  ctx.restore();
  return { stamp, banner };
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
  drawFlag(ctx, f, input);
  drawShadows(ctx, f, input);
  drawPlayers(ctx, f, input);
  drawFootball(ctx, f, input);
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

/** The flag: tossed in end over end, then lying where it landed until the field settles. */
function drawFlag(ctx: Ctx, f: GridProjection, { script, t }: FrameInputs): void {
  const flag = script.flag;
  if (!flag || !(t >= flag.thrown && t < script.settle + 0.3)) return;
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
}

function drawShadows(ctx: Ctx, f: GridProjection, { script, t, ink }: FrameInputs): void {
  const w = f.figure * 0.3;
  for (const player of script.players) {
    const o = player.opacity(t);
    if (!(o > 0.01)) continue;
    const down = player.hold(t)?.kind === "down";
    drawShadow(ctx, f.point(player.position(t)), down ? w * 1.6 : w, shadow(ink, o));
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

function drawPlayers(ctx: Ctx, f: GridProjection, { script, t, teams, ink }: FrameInputs): void {
  const height = f.figure;
  const offense = figureInks(teams.offense, ink);
  const defense = figureInks(teams.defense, ink);
  const c = Math.cos(script.yaw);
  const s = Math.sin(script.yaw);
  // Far to near: a player in front covers the one behind.
  const order = script.players.map((player, index) => {
    const at = player.position(t);
    return { player, index, at, depth: -at.x * s + at.y * c };
  });
  order.sort((a, b) => b.depth - a.depth);
  for (const { player, index, at } of order) {
    const o = player.opacity(t);
    if (!(o > 0.01)) continue;
    const fig = figure(playerPose(script, player, index, t), f.point(at), height);
    drawFigure(ctx, fig, player.team === "offense" ? offense : defense, height, o);
  }
}

/** A football: a brown oval along its flight in a soft glow, a comet tail while it's in the air, its shadow on the grass (with the shadows). */
function drawFootball(ctx: Ctx, f: GridProjection, { script, t, ink }: FrameInputs): void {
  const ball = script.ball(t);
  if (!ball) return;
  const p = f.at(ball);
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
