/**
 * The soccer theater, drawn (SoccerTheater.swift `PitchLayer`, the soccer
 * `Pose`s, `SoccerFrame`): the pitch in perspective from high in the main
 * stand through the broadcast camera (the stands, the boards, the mowing,
 * every line), then one frame of the moment: the move's trail on the grass
 * and the shot's path, the shadows, the goals and the players far to near
 * (a man in front of the post covers it), the ball, what it hits, the
 * headlines and the stamp. Everything is projected through the camera, so
 * lines stay crisp at any zoom. Type is laid out once per moment and size
 * (`layoutLabels`).
 */
import { fieldPoint, houseCurve, smooth, type FieldPoint, type Point } from "../../../../data/mlb/theaterField";
import { gait, keyed, mirrored, mix, over, Rig, rigArm, rigPose, RigPoses, RigTrack, vec, withPose, type RigArm, type RigPose, type RigVector } from "../../../../data/theater/rig";
import { referee, type Uniform } from "../../../../data/mlb/theaterTeams";
import { Pitch, stampDetail, surname, type SoccerScene } from "../../../../data/theater/soccerScene";
import type { Actor, SoccerProp, SoccerScript } from "../../../../data/theater/soccerScript";
import type { PitchProjection } from "../../../../data/theater/soccerTheater";
import type { Rect } from "../../../../data/mlb/playCamera";
import { TheaterTagLayout, type TagFrame } from "../../../../data/theater/theaterNames";
import { drawFigure, figureInks, grip, RigLens, rigFigure, shift, type RigFigure } from "../../core/theater/rigFigure";
import { drawTags, ringBall, ringFigure, type PlacedTags, type TagFigure } from "../../core/theater/theaterTags";
import { hexRGB, rgba, type RGB, type TheaterInk } from "../../mlb/theater/theaterInk";
import {
  accentOf,
  ASCENT,
  bannerBlock,
  chalk,
  chalkEdge,
  drawBall,
  ellipse,
  FONT,
  fillTracked,
  glow,
  LINE,
  measureTracked,
  primary,
  run,
  drawRuns,
  runsWidth,
  shadow,
  TheaterType,
  turf,
  type Block,
  type Ctx,
  type Size,
} from "../../core/theater/theaterKit";

/** The two teams on the pitch, always told apart at a glance (dressed by the baseball theater's rule: `dress`). */
export interface SoccerTeams {
  readonly attacking: Uniform;
  readonly defending: Uniform;
}

/** The goal frame: white, as it is. The net: a fine mesh, just there. (TheaterInk.goal, .net) */
const goalInk = (ink: TheaterInk) => (ink.dark ? "rgb(255 255 255 / 0.9)" : "#ffffff");
const netInk = (ink: TheaterInk, a = 1) => (ink.dark ? rgba([255, 255, 255], 0.22 * a) : rgba([0, 0, 0], 0.16 * a));
/** Round the posts: the figures' halo in the dark; in the light a soft shade, so white posts read on pale grass. (TheaterInk.postRim) */
const postRim = (ink: TheaterInk) => (ink.dark ? ink.halo : "rgb(0 0 0 / 0.22)");

/** A team's color (hex or the page's ink) at an alpha. */
function teamAlpha(u: Uniform, ink: TheaterInk, a: number): string {
  const rgb: RGB = u.accent ? hexRGB(u.accent) : ink.primary;
  return rgba(rgb, (u.accent ? 1 : ink.primaryAlpha) * a);
}

// MARK: - Pitch

/**
 * The pitch itself (PitchLayer): the grass and its mowing, the lines, the
 * boards and the stands beyond them. (The goals stand with the players, who
 * can be in front of them or behind.)
 */
export function drawPitch(ctx: Ctx, f: PitchProjection, ink: TheaterInk): void {
  const camera = f.camera.camera;
  const L = Pitch.length;
  const W = Pitch.width;
  const quad = (a: FieldPoint, b: FieldPoint, c: FieldPoint, d: FieldPoint) => {
    const pa = f.point(a);
    const pb = f.point(b);
    const pc = f.point(c);
    const pd = f.point(d);
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.lineTo(pc.x, pc.y);
    ctx.lineTo(pd.x, pd.y);
    ctx.closePath();
  };
  const fp = (x: number, y: number, z = 0): FieldPoint => ({ x, y, z });
  const ground = (x0: number, y0: number, x1: number, y1: number) => quad(fp(x0, y0), fp(x1, y0), fp(x1, y1), fp(x0, y1));
  // Chalk thickens a little as the camera closes in.
  const ppm = f.scale(fp(camera.x, camera.y));
  const line = Math.min(Math.max(0.75, ppm * 0.09), 1.7);

  // The bowl: the stands behind the boards on the far side and at each end, rising out of sight
  // (one shape, so where they meet isn't darker), their tiers just there. From behind a goal,
  // the stand at the camera's back is out of view and the near side's stand comes into it;
  // nothing is drawn behind the lens.
  const behind = f.behind;
  const x0 = behind === false ? -8 : -70;
  const x1 = behind === true ? L + 8 : L + 70;
  ctx.beginPath();
  if (behind == null) ground(-70, -60, L + 70, W + 5);
  else ctx.rect(0, 0, f.size.width, f.size.height);
  quad(fp(x0, W + 5), fp(x1, W + 5), fp(x1, W + 60, 34), fp(x0, W + 60, 34));
  if (behind != null) quad(fp(x0, -5), fp(x1, -5), fp(x1, -60, 34), fp(x0, -60, 34));
  for (const [x, out, right] of [
    [-6, -40, false],
    [L + 6, 40, true],
  ] as const) {
    if (behind === right) continue;
    quad(fp(x, -60), fp(x, W + 5), fp(x + out, W + 5, 25), fp(x + out, -60, 25));
  }
  ctx.fillStyle = ink.stands;
  ctx.fill();
  ctx.beginPath();
  for (let k = 1; k <= 5; k++) {
    const y = W + 5 + k * 9;
    const z = (k * 9 * 34) / 55;
    const a = f.point(fp(x0, y, z));
    const b = f.point(fp(x1, y, z));
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    if (behind != null) {
      const c = f.point(fp(x0, -y + W, z));
      const d = f.point(fp(x1, -y + W, z));
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
    }
  }
  ctx.strokeStyle = ink.stands;
  ctx.lineWidth = 0.5;
  ctx.stroke();
  // The grass, with its run-off, mowed in bands across the pitch.
  ctx.beginPath();
  ground(-4, -3.5, L + 4, W + 3.5);
  ctx.fillStyle = turf(ink);
  ctx.fill();
  ctx.beginPath();
  const band = L / 18;
  for (let i = 0; i < 18; i += 2) ground(i * band, -3.5, (i + 1) * band, W + 3.5);
  ctx.fillStyle = ink.mow;
  ctx.fill();
  // The boards along the far touchline and behind the goals.
  const boards: [Point, Point][] = [
    [
      { x: -4, y: W + 4.2 },
      { x: L + 4, y: W + 4.2 },
    ],
    [
      { x: -4.6, y: -2 },
      { x: -4.6, y: W + 4.2 },
    ],
    [
      { x: L + 4.6, y: -2 },
      { x: L + 4.6, y: W + 4.2 },
    ],
  ];
  ctx.beginPath();
  for (const [a, b] of boards) quad(fp(a.x, a.y), fp(b.x, b.y), fp(b.x, b.y, 0.9), fp(a.x, a.y, 0.9));
  ctx.fillStyle = ink.wall;
  ctx.fill();
  ctx.beginPath();
  for (const [a, b] of boards) {
    const pa = f.point(fp(a.x, a.y, 0.9));
    const pb = f.point(fp(b.x, b.y, 0.9));
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
  }
  ctx.strokeStyle = ink.wallTop;
  ctx.lineWidth = line * 0.7;
  ctx.lineCap = "butt";
  ctx.stroke();

  // The lines.
  ctx.beginPath();
  const segment = (ax: number, ay: number, bx: number, by: number) => {
    const a = f.point(fp(ax, ay));
    const b = f.point(fp(bx, by));
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  };
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    segment(x0, y0, x1, y0);
    segment(x1, y0, x1, y1);
    segment(x1, y1, x0, y1);
    segment(x0, y1, x0, y0);
  };
  const arc = (c: Point, r: number, a0: number, a1: number, steps: number) => {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      const p = f.point(fp(c.x + r * Math.cos(a), c.y + r * Math.sin(a)));
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
  };
  rect(0, 0, L, W);
  segment(L / 2, 0, L / 2, W);
  arc(Pitch.center, Pitch.circle, 0, 2 * Math.PI, 48);
  for (const right of [false, true]) {
    const x = right ? L : 0;
    const s = right ? -1 : 1;
    rect(x, (W - Pitch.boxWidth) / 2, x + s * Pitch.boxDepth, (W + Pitch.boxWidth) / 2);
    rect(x, (W - Pitch.sixWidth) / 2, x + s * Pitch.sixDepth, (W + Pitch.sixWidth) / 2);
    // The D: the penalty arc outside the box.
    const spot = { x: x + s * Pitch.spot, y: W / 2 };
    const half = Math.acos((Pitch.boxDepth - Pitch.spot) / Pitch.circle);
    arc(spot, Pitch.circle, (right ? Math.PI : 0) - half, (right ? Math.PI : 0) + half, 16);
    // The corner arcs.
    arc({ x, y: 0 }, 1, right ? Math.PI / 2 : 0, right ? Math.PI : Math.PI / 2, 5);
    arc({ x, y: W }, 1, right ? Math.PI : -Math.PI / 2, right ? 1.5 * Math.PI : 0, 5);
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const edge = chalkEdge(ink);
  if (edge) {
    // On pale grass, each line sits in a soft edge of its own.
    ctx.strokeStyle = edge;
    ctx.lineWidth = line + 1.2;
    ctx.stroke();
  }
  ctx.strokeStyle = chalk(ink);
  ctx.lineWidth = line;
  ctx.stroke();
  // The spots.
  ctx.fillStyle = chalk(ink);
  for (const p of [Pitch.center, { x: Pitch.spot, y: W / 2 }, { x: L - Pitch.spot, y: W / 2 }]) {
    const c = f.point(fp(p.x, p.y));
    const r = Math.max(0.22 * f.scale(fp(p.x, p.y)), 1.1);
    ellipse(ctx, c.x, c.y, r, r * 0.5);
    ctx.fill();
  }
}

// MARK: - Poses

/** Soccer's poses beyond the shared ones (SoccerTheater.swift's `RigPose` extension), for a right-footer, relative to his heading (at the ball, or where he's playing it). */
export const PitchPose = {
  // A strike: the plant foot beside the ball, the swing leg drawn back, through the ball, and on; the arms out for balance.
  backswing: rigPose({
    hip: vec(-0.02, 0, 0.46),
    lean: -0.1,
    twist: -0.25,
    left: vec(0.06, 0.11, 0),
    right: vec(-0.3, -0.07, 0.22),
    leftArm: rigArm({ swing: 0.75, spread: 0.95, turn: 0.1, bend: 0.3 }),
    rightArm: rigArm({ swing: -0.45, spread: 0.6, bend: 0.35 }),
  }),
  strike: rigPose({
    hip: vec(0.02, 0, 0.45),
    lean: 0.08,
    twist: 0.1,
    left: vec(0.06, 0.12, 0),
    right: vec(0.2, -0.04, 0.05),
    leftArm: rigArm({ swing: 0.9, spread: 0.9, turn: 0.1, bend: 0.25 }),
    rightArm: rigArm({ swing: -0.65, spread: 0.6, bend: 0.3 }),
  }),
  followThrough: rigPose({
    hip: vec(0.05, 0, 0.47),
    lean: 0.2,
    twist: 0.3,
    left: vec(0.06, 0.12, 0),
    right: vec(0.4, -0.02, 0.3),
    leftArm: rigArm({ swing: 0.6, spread: 0.85, turn: 0.2, bend: 0.3 }),
    rightArm: rigArm({ swing: -0.3, spread: 0.5, bend: 0.35 }),
  }),
  /** Up for a header: off the ground, legs tucked, arms out, the head cocked back; then snapped through it. */
  rise: rigPose({
    hip: vec(0, 0, 0.6),
    lean: -0.05,
    nod: -0.4,
    left: vec(-0.05, 0.07, 0.18),
    right: vec(-0.12, -0.07, 0.13),
    leftArm: rigArm({ swing: 0.9, spread: 1.0, bend: 0.6 }),
    rightArm: rigArm({ swing: 0.9, spread: 1.0, bend: 0.6 }),
  }),
  header: rigPose({
    hip: vec(0.02, 0, 0.62),
    lean: 0.42,
    nod: 0.55,
    left: vec(-0.06, 0.07, 0.2),
    right: vec(-0.12, -0.07, 0.15),
    leftArm: rigArm({ swing: 0.4, spread: 1.15, bend: 0.5 }),
    rightArm: rigArm({ swing: 0.4, spread: 1.15, bend: 0.5 }),
  }),
  /** Both hands over his head, then through: a throw-in. */
  throwBack: rigPose({
    hip: vec(-0.03, 0, 0.47),
    lean: -0.28,
    nod: -0.15,
    left: vec(0.14, 0.07, 0),
    right: vec(-0.14, -0.08, 0),
    leftArm: rigArm({ swing: 2.85, spread: 0.12, bend: 1.45 }),
    rightArm: rigArm({ swing: 2.85, spread: 0.12, bend: 1.45 }),
  }),
  throwThrough: rigPose({
    hip: vec(0.03, 0, 0.46),
    lean: 0.3,
    left: vec(0.14, 0.07, 0),
    right: vec(-0.14, -0.08, 0.02),
    leftArm: rigArm({ swing: 1.85, spread: 0.1, bend: 0.25 }),
    rightArm: rigArm({ swing: 1.85, spread: 0.1, bend: 0.25 }),
  }),
  /** Up for a header contested in the air: higher than a header's rise, knees tucked, arms out for leverage, the head cocked. */
  leap: rigPose({
    hip: vec(-0.02, 0, 0.68),
    lean: -0.1,
    nod: -0.45,
    left: vec(-0.08, 0.07, 0.24),
    right: vec(-0.16, -0.07, 0.18),
    leftArm: rigArm({ swing: 1.6, spread: 0.9, bend: 0.7 }),
    rightArm: rigArm({ swing: 1.6, spread: 0.9, bend: 0.7 }),
  }),
  /** The keeper's punch: fists drawn in at his chest, then both thrust up through the ball, off his feet. */
  punchCock: rigPose({
    hip: vec(-0.02, 0, 0.44),
    lean: 0.1,
    left: vec(0.04, 0.12, 0),
    right: vec(-0.04, -0.12, 0),
    knees: 0.3,
    leftArm: rigArm({ swing: 1.6, spread: 0.1, turn: -0.5, bend: 2.0 }),
    rightArm: rigArm({ swing: 1.6, spread: 0.1, turn: -0.5, bend: 2.0 }),
  }),
  punch: rigPose({
    hip: vec(0, 0, 0.56),
    lean: -0.05,
    nod: -0.3,
    left: vec(0, 0.08, 0.06),
    right: vec(-0.05, -0.08, 0.04),
    leftArm: rigArm({ swing: 2.9, spread: 0.05, turn: -0.25, bend: 0.1 }),
    rightArm: rigArm({ swing: 2.9, spread: 0.05, turn: -0.25, bend: 0.1 }),
  }),
  /** Square to the shot, arms in, a stride wide: a block. */
  block: rigPose({
    hip: vec(0, 0, 0.42),
    lean: -0.12,
    left: vec(0, 0.17, 0),
    right: vec(0, -0.17, 0),
    knees: 0.3,
    leftArm: rigArm({ swing: 0.3, spread: 0.0, turn: -0.7, bend: 1.7 }),
    rightArm: rigArm({ swing: 0.3, spread: 0.0, turn: -0.7, bend: 1.7 }),
  }),
  /** The keeper takes it into his chest. */
  gather: rigPose({
    hip: vec(-0.02, 0, 0.44),
    lean: 0.25,
    left: vec(0.05, 0.1, 0),
    right: vec(-0.05, -0.1, 0),
    leftArm: rigArm({ swing: 0.95, spread: 0.1, turn: -0.55, bend: 1.55 }),
    rightArm: rigArm({ swing: 0.95, spread: 0.1, turn: -0.55, bend: 1.55 }),
  }),
  /** Arms up, chest out. */
  celebrate: rigPose({ lean: -0.15, nod: -0.25, leftArm: rigArm({ swing: 2.45, spread: 0, turn: 1.25, bend: 0.15 }), rightArm: rigArm({ swing: 2.45, spread: 0, turn: 1.25, bend: 0.15 }) }),
  /** Hands on his head. */
  dejected: rigPose({
    lean: 0.08,
    nod: 0.25,
    leftArm: rigArm({ swing: 2.2, spread: 0, turn: 1.15, bend: 2.3 }),
    rightArm: rigArm({ swing: 2.2, spread: 0, turn: 1.15, bend: 2.3 }),
  }),

  /**
   * The keeper at full stretch toward `d` (from his hips, in his heading's
   * frame, body units): his body on the line to it, a top corner leaning him
   * over and a ball along the grass laying him flat; one line from the
   * trailing foot through him to the leading hand (the top one), the other
   * just behind it, the push-off leg folded under.
   */
  stretch(d: RigVector): RigPose {
    const side = d.y >= 0 ? 1 : -1;
    const across = Math.max(Math.hypot(d.x, d.y), 1e-6);
    // From upright toward the ball: a lean for a top corner, just past flat for one along the grass.
    const overUp = Math.min(Math.max(Math.atan2(across, d.z), 0.55), 1.8);
    const line = vec((Math.sin(overUp) * d.x) / across, (Math.sin(overUp) * d.y) / across, Math.cos(overUp));
    // Leaning forward with the ball's forward part, then over toward it: his chest to the shooter all the way down.
    const p = rigPose({ hip: vec(0, 0, 0.45), pitch: Math.asin(line.x), bank: Math.atan2(line.y, line.z), left: vec(0, 0.06, -0.04), right: vec(0, -0.06, -0.04), knees: 0 });
    const top: RigArm = rigArm({ swing: 3.08, spread: 0.15, bend: 0.03 });
    const under: RigArm = rigArm({ swing: 2.8, spread: 0.18, bend: 0.15 });
    const push = vec(-0.1, side * 0.07, 0.15);
    return side > 0 ? withPose(p, { rightArm: top, leftArm: under, left: push }) : withPose(p, { leftArm: top, rightArm: under, right: push });
  },

  /** Down on the grass after it, on his side. */
  /** On a knee (football's `GridPose.kneel`): a physio at a man down. */
  kneel: rigPose({
    hip: vec(-0.02, 0, 0.26),
    lean: 0.08,
    left: vec(0.22, 0.08, 0),
    right: vec(-0.26, -0.07, 0.01),
    knees: 0.05,
    leftArm: rigArm({ swing: 0.55, spread: 0.15, turn: -0.2, bend: 0.9 }),
    rightArm: rigArm({ swing: 0.2, spread: 0.2, bend: 0.4 }),
  }),
  /** The referee's card (or the assistant's flag, a kicker's signal): one arm straight up. */
  cardUp: rigPose({ lean: -0.05, rightArm: rigArm({ swing: 3.0, spread: 0.12, turn: 0.3, bend: 0.05 }) }),
  /** A hand to his ear: the referee listening to VAR. */
  ear: rigPose({ nod: 0.1, rightArm: rigArm({ swing: 2.5, spread: 0.45, turn: 1.0, bend: 2.2 }) }),
  /** The sign for the screen: both hands up and out, drawing it. */
  screen: rigPose({ leftArm: rigArm({ swing: 2.0, spread: 0.6, turn: 0.4, bend: 0.5 }), rightArm: rigArm({ swing: 2.0, spread: 0.6, turn: 0.4, bend: 0.5 }) }),
  /** The board held up in both hands. */
  boardUp: rigPose({ lean: -0.08, leftArm: rigArm({ swing: 2.8, spread: 0.1, turn: 0.3, bend: 0.25 }), rightArm: rigArm({ swing: 2.8, spread: 0.1, turn: 0.3, bend: 0.25 }) }),
  down(side: number): RigPose {
    return rigPose({
      hip: vec(0, 0, 0.1),
      bank: side * 1.45,
      left: vec(0, 0.06, -0.36),
      right: vec(-0.06, -0.07, -0.3),
      leftArm: rigArm({ swing: 2.6, spread: 0.3, bend: 0.5 }),
      rightArm: rigArm({ swing: 2.4, spread: 0.2, bend: 0.6 }),
    });
  },
};

/** The strike's keys, mirrored for a left foot. */
const MIRRORED_STRIKE = [mirrored(PitchPose.backswing), mirrored(PitchPose.strike), mirrored(PitchPose.followThrough)] as const;

const envelope = (x: number, attack: number, release: number) => (x < 0 ? Math.max(1 + x / attack, 0) : Math.max(1 - x / release, 0));

/**
 * The body at t, and its heading (SoccerFrame.pose): at full stretch for the
 * ball; else what he's doing (a strike, a header, a block, arms up) over how
 * he's moving (striding to his planted feet), else how he stands: watching
 * the ball. `unit`: body units to the metre where he stands. (tested)
 */
export function actorPose(script: SoccerScript, actor: Actor, index: number, t: number, here: Point, unit: number): [RigPose, number] {
  const track = script.rig[index] ?? RigTrack.standing(here, 0, 2.5);
  const m = track.motion(t);
  const dive = actor.dive;
  if (dive && t >= dive.start) {
    const set = actor.position(dive.start);
    const u = Math.min(Math.max((t - dive.start) / Math.max(dive.reach - dive.start, 0.01), 0), 1);
    const fall = Math.min(Math.max((t - dive.reach) / 0.32, 0), 1);
    // Toward the ball from his hips, as he set: along and across his heading, and up.
    const toward = Rig.yaw(vec((dive.target.x - set.x) * unit, (dive.target.y - set.y) * unit, 0), -m.heading);
    const d = vec(toward.x, toward.y, dive.target.z * unit - 0.45);
    const body = mix(mix(RigPoses.ready, PitchPose.stretch(d), smooth(u * 1.3)), PitchPose.down(d.y >= 0 ? 1 : -1), smooth(fall));
    // Off the ground on the way: daylight under him, gone as his hands reach the ball.
    const lift = fall > 0 ? 0 : 4 * u * (1 - u) * 0.17;
    return [withPose(body, { hip: vec(body.hip.x, body.hip.y, body.hip.z + lift) }), m.heading];
  }
  const still = actor.role === "keeper" ? RigPoses.ready : RigPoses.stand;
  const feet = track.feet(t, here, m.heading, unit, m.speed, { left: still.left, right: still.right });
  let base = mix(still, gait(m, feet), m.weight);
  // Between moments: a man down, a physio on a knee, an arm (or two) up.
  const hold = actor.hold(t);
  if (hold) {
    const into = smooth((t - hold.from) / 0.3);
    switch (hold.kind) {
      case "down":
        return [mix(base, PitchPose.down(1), into), m.heading];
      case "kneel":
        return [mix(base, PitchPose.kneel, into), m.heading];
      case "cardUp":
        base = over(base, PitchPose.cardUp, into, m.weight);
        break;
      case "ear":
        base = over(base, PitchPose.ear, into, m.weight);
        break;
      case "screen":
        base = over(base, PitchPose.screen, into, m.weight);
        break;
      case "boardUp":
        base = over(base, PitchPose.boardUp, into, m.weight);
        break;
    }
  }
  for (const action of actor.actions) {
    const x = t - action.at;
    switch (action.kind) {
      case "kick": {
        // A left-footer's strike is the right-footer's, mirrored.
        const [back, strike, through] = action.left ? MIRRORED_STRIKE : [PitchPose.backswing, PitchPose.strike, PitchPose.followThrough];
        base =
          keyed(
            [
              [-0.24, base],
              [-0.09, back],
              [0, strike],
              [0.13, through],
              [0.45, base],
            ],
            x,
          ) ?? base;
        break;
      }
      case "header":
        base =
          keyed(
            [
              [-0.32, base],
              [-0.12, PitchPose.rise],
              [0.02, PitchPose.header],
              [0.12, PitchPose.header],
              [0.42, base],
            ],
            x,
          ) ?? base;
        break;
      case "aerial":
        base =
          keyed(
            [
              [-0.36, base],
              [-0.14, PitchPose.leap],
              [0.02, PitchPose.header],
              [0.14, PitchPose.header],
              [0.45, base],
            ],
            x,
          ) ?? base;
        break;
      case "punch":
        base =
          keyed(
            [
              [-0.3, base],
              [-0.1, PitchPose.punchCock],
              [0.02, PitchPose.punch],
              [0.16, PitchPose.punch],
              [0.5, base],
            ],
            x,
          ) ?? base;
        break;
      case "claim":
        // Takes it high in both hands, and holds it there.
        base = over(base, RigPoses.catchHigh, x < 0 ? Math.max(1 + x / 0.22, 0) : 1 - 0.6 * smooth((x - 0.4) / 0.4), m.weight);
        break;
      case "throwIn":
        base =
          keyed(
            [
              [-0.5, base],
              [-0.15, PitchPose.throwBack],
              [0.04, PitchPose.throwThrough],
              [0.45, base],
            ],
            x,
          ) ?? base;
        break;
      case "control":
        base = over(base, PitchPose.gather, envelope(x, 0.12, 0.2) * 0.4, m.weight);
        break;
      case "block":
        base = over(base, PitchPose.block, envelope(x, 0.18, 0.5), m.weight);
        break;
      case "gather":
        // Takes it in and holds it there.
        base = over(base, PitchPose.gather, x < 0 ? Math.max(1 + x / 0.2, 0) : 1, m.weight);
        break;
      case "celebrate":
        base = over(base, PitchPose.celebrate, smooth((x + 0.25) / 0.35), m.weight);
        break;
      case "dejected":
        base = over(base, PitchPose.dejected, smooth(x / 0.35), m.weight);
        break;
    }
  }
  return [base, m.heading];
}

/** A player posed and placed at t: his figure, its height, and where his hands are (a keeper holding the ball has it there). */
interface Posed {
  readonly figure: RigFigure;
  readonly height: number;
  readonly hands: Point;
}

/** Everyone at t, by actor. */
function posed(f: PitchProjection, { script, t }: FrameInputs): Posed[] {
  return script.actors.map((actor, index) => place(script, actor, index, f, t));
}

function place(script: SoccerScript, actor: Actor, index: number, f: PitchProjection, t: number): Posed {
  const at = actor.position(t);
  const lens = RigLens.pitch(f, at);
  const [body, heading] = actorPose(script, actor, index, t, at, lens.unit);
  const figure = rigFigure(body, heading, lens);
  // At full stretch, his leading hand goes exactly to the ball.
  const dive = actor.dive;
  if (dive && t >= dive.start) {
    const target = f.point(dive.target);
    const side = body.bank >= 0 ? 1 : -1;
    const u = Math.min(Math.max((t - dive.start) / Math.max(dive.reach - dive.start, 0.01), 0), 1);
    const fall = Math.min(Math.max((t - dive.reach) / 0.32, 0), 1);
    const lead = side > 0 ? figure.hands[1] : figure.hands[0];
    const pull = fall > 0 ? 1 - smooth(fall) : smooth(u);
    shift(figure, (target.x - lead.x) * pull, (target.y - lead.y) * pull);
    return { figure, height: lens.height, hands: side > 0 ? figure.hands[1] : figure.hands[0] };
  }
  return { figure, height: lens.height, hands: grip(figure) };
}

// MARK: - Labels (laid out once per moment and size)

export interface Labels {
  readonly stamp: Block | null;
  readonly banners: readonly (Block | null)[];
}

/**
 * The stamp, low on the side away from the goal: the scorer's name big and
 * heavy (in his team's color for a goal, gold for a late winner), the
 * minute beside it, and under it in small capitals the assist, how it was
 * struck and from how far (anchored at its bottom corner on its side). The
 * headlines, each anchored at its center.
 */
export function layoutLabels(ctx: Ctx, scene: SoccerScene | null, script: SoccerScript, teams: SoccerTeams, ink: TheaterInk, size: Size, pt: number): Labels {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const typeHeight = Math.max(size.height, 120);
  let stamp: Block | null = null;
  if (scene) {
    const s = Math.min(Math.max(typeHeight * 0.105, 15 * pt), 30 * pt);
    const tone = scene.outcome === "goal" && scene.review !== "overturned" ? (scene.decisive ? ink.gold : accentOf(teams.attacking, ink)) : primary(ink);
    const runs = [run(ctx, surname(scene.shooter), `800 ${s}px ${FONT}`, s, tone, -0.3 * pt), run(ctx, scene.minute, `600 ${s * 0.6}px ${FONT}`, s * 0.6, ink.secondary)];
    const spacing = s * 0.28;
    const detail = stampDetail(scene);
    const df = Math.min(Math.min(Math.max(typeHeight * 0.05, 8 * pt), 13 * pt), (size.width * 0.44) / Math.max([...detail].length * 0.7, 1));
    const detailFont = `700 ${df}px ${FONT}`;
    ctx.font = detailFont;
    const detailWidth = detail ? measureTracked(ctx, detail, 1 * pt) : 0;
    const lineWidth = runsWidth(runs, spacing);
    const width = Math.max(lineWidth, detailWidth);
    const gap = s * 0.06;
    const height = s * LINE + (detail ? gap + df * LINE : 0);
    const right = script.cornerRight;
    const secondary = ink.secondary;
    stamp = {
      width,
      height,
      draw: (c) => {
        const top = -height;
        // Leading on the left, trailing on the right: the block's anchor is its bottom corner on its side.
        const x0 = right ? -width : 0;
        drawRuns(c, runs, right ? x0 + width - lineWidth : x0, top + s * ASCENT, spacing);
        if (detail) {
          c.font = detailFont;
          c.fillStyle = secondary;
          fillTracked(c, detail, right ? x0 + width - detailWidth : x0, top + s * LINE + gap + df * ASCENT, 1 * pt);
        }
      },
    };
  }
  const color = (tone: "team" | "gold" | "neutral") => (tone === "team" ? accentOf(teams.attacking, ink) : tone === "gold" ? ink.gold : primary(ink));
  const banners = script.banners.map((b) => bannerBlock(ctx, b.text, color(b.tone), TheaterType.banner(size, pt)));
  ctx.restore();
  return { stamp, banners };
}

// MARK: - A frame of the moment

export interface FrameInputs {
  readonly scene: SoccerScene | null;
  readonly script: SoccerScript;
  readonly t: number;
  readonly teams: SoccerTeams;
  readonly ink: TheaterInk;
  readonly labels: Labels;
  /** The names over the players: the pointer's, the key man's. */
  readonly tags?: TagFrame | null;
}

/**
 * One frame of a moment through the camera (SoccerFrame): the passes' lines
 * on the grass and the shadows, the names on the pitch under everything that
 * plays (the shot's flight, the players and the goals, the ball), then the
 * type.
 */
export function drawSoccerFrame(ctx: Ctx, f: PitchProjection, input: FrameInputs): void {
  drawTrails(ctx, f, input, "ground");
  const figures = posed(f, input);
  drawShadows(ctx, f, input, figures);
  const named = drawNames(ctx, f, input, figures);
  drawTrails(ctx, f, input, "air");
  const hands = drawStage(ctx, f, input, figures, named);
  drawTheBall(ctx, f, input, hands, named);
  drawImpacts(ctx, f, input);
  drawLabels(ctx, f, input);
}

/**
 * The names over the players (SoccerFrame.drawTags), on the pitch under
 * everything that plays, clear of the headline and the stamp while they're
 * up; each over his man as he's drawn (his own height in the perspective),
 * fading with him as he comes on or goes off.
 */
function drawNames(ctx: Ctx, f: PitchProjection, { script, t, labels, tags, ink }: FrameInputs, figures: readonly Posed[]): PlacedTags | null {
  if (!tags) return null;
  const clear: Rect[] = [];
  script.banners.forEach((banner, i) => {
    const block = labels.banners[i];
    if (block && t >= banner.at && t < banner.until + 0.3) clear.push(TheaterTagLayout.banner(block, f.size));
  });
  if (labels.stamp && t >= script.stamp) clear.push(TheaterTagLayout.stamp(labels.stamp, f.size, TheaterType.inset(f.size), script.cornerRight));
  const shown: TagFigure[] = [];
  figures.forEach((p, index) => {
    const opacity = script.actors[index]!.opacity(t);
    if (opacity > 0.01) shown.push({ index, figure: p.figure, height: p.height, opacity });
  });
  return drawTags(ctx, tags, shown, t, f.size, clear, ink.dark);
}

/**
 * Each pass draws its line on the grass as the ball travels it, a run with
 * the ball a dotted one, then settles to a faint record of the move
 * (`ground`); the shot's path, in the air, brighter (`air`: it plays over
 * the names, as the ball does).
 */
function drawTrails(ctx: Ctx, f: PitchProjection, { script, t, teams, ink }: FrameInputs, layer: "ground" | "air"): void {
  const width = Math.min(Math.max(f.size.height * 0.0065, 0.9), 1.8);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  script.flights.forEach((flight, i) => {
    if (!(t > flight.start)) return;
    const end = Math.min(t, flight.end);
    const after = t - flight.end;
    const fade = after <= 0 ? 1 : Math.max(1 - after / 0.6, 0);
    if (flight.kind === "pass" || flight.kind === "carry") {
      if (layer !== "ground") return;
      if (flight.from.x === flight.to.x && flight.from.y === flight.to.y) return;
      const a = f.pointGround(flight.from);
      const b = f.pointGround(flight.point(end));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      // Between moments a pass's line goes as the ball arrives; in a replay a faint record of the move stays.
      const strength = script.loop != null ? 0.45 * fade : 0.24 + 0.36 * fade;
      if (!(strength > 0.005)) return;
      ctx.strokeStyle = teamAlpha(teams.attacking, ink, strength);
      ctx.lineWidth = width;
      ctx.setLineDash(flight.kind === "carry" ? [width * 0.1, width * 2.6] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (flight.kind === "shot" && i === script.shot && layer === "air") {
      const samples = 24;
      ctx.beginPath();
      for (let k = 0; k <= samples; k++) {
        const p = f.point(flight.point(flight.start + ((end - flight.start) * k) / samples));
        if (k === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = rgba(ink.trace, 0.45 + 0.4 * fade);
      ctx.lineWidth = width * 1.3;
      ctx.stroke();
    }
  });
}

function drawShadows(ctx: Ctx, f: PitchProjection, { script, t, ink }: FrameInputs, figures: readonly Posed[]): void {
  // Under the hips; smaller and fainter as he leaves the ground (and gone with him, when he's off).
  figures.forEach((p, i) => {
    const shown = script.actors[i]!.opacity(t);
    if (!(shown > 0.01)) return;
    const air = Math.min(p.figure.air / 0.4, 1);
    const w = p.height * 0.3 * (1 - 0.35 * air);
    const g = p.figure.ground;
    ellipse(ctx, g.x, g.y, w, w * 0.3);
    ctx.fillStyle = shadow(ink, (1 - 0.45 * air) * shown);
    ctx.fill();
  });
  // The ball's: under it on the grass, larger and softer the higher it flies, a hairline up to it once it's well up.
  const ball = script.heldBy == null || t < script.heldFrom ? script.ball(t) : null;
  if (ball && ball.z > 0.25) {
    const o = script.ballOpacity(t);
    const g = f.pointGround(ball);
    const spread = 1 + Math.min(ball.z / 12, 1.4);
    const r = Math.max(0.25 * f.scale({ x: ball.x, y: ball.y, z: 0 }), 1.5) * spread;
    ellipse(ctx, g.x, g.y, r, r / 2);
    ctx.fillStyle = shadow(ink, Math.min(1.6 / (1 + ball.z / 8), 1) * o);
    ctx.fill();
    if (ball.z > 1.6) {
      const top = f.point(ball);
      ctx.beginPath();
      ctx.moveTo(g.x, g.y);
      ctx.lineTo(top.x, top.y);
      ctx.strokeStyle = rgba(ink.trace, 0.16 * Math.min((ball.z - 1.6) / 2.5, 1) * o);
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }
}

type Item =
  | { readonly depth: number; readonly kind: "actor"; readonly index: number }
  /** From behind a goal: all of it at once, at its goal line. */
  | { readonly depth: number; readonly kind: "goalBack" | "nearPost" | "goal"; readonly right: boolean };

/**
 * A man off the ball standing where the stamp lands steps back for it:
 * faint under it once it's down (the camera keeps the men in the move out
 * of its corner; with both elevens on, there isn't always room).
 */
function receding(script: SoccerScript, t: number, foot: Point, size: { readonly width: number; readonly height: number }): number {
  if (!(t >= script.stamp)) return 1;
  const x = foot.x / size.width;
  const y = foot.y / size.height;
  const under = (script.cornerRight ? x > 1 - script.corner.width : x < script.corner.width) && y > 1 - script.corner.height;
  return under ? 1 - 0.75 * Math.min((t - script.stamp) / 0.25, 1) : 1;
}

/** A goal's parts, drawn in the order the camera needs them. */
type GoalPart = "net" | "frame" | "nearPost";

/**
 * The goals and the players, far to near (a man in front of the post covers
 * it); a man crossing a name gets its ring over it. Returns where the keeper
 * holding the ball has his hands.
 */
function drawStage(ctx: Ctx, f: PitchProjection, input: FrameInputs, figures: readonly Posed[], named: PlacedTags | null): Point | null {
  const { script, t, teams, ink } = input;
  const attacking = figureInks(teams.attacking, ink);
  const defending = figureInks(teams.defending, ink);
  // Between moments, the officials in the referee's kit (FIFA yellow, else the first that reads apart from both teams) and the physios in the staff's slate.
  const officials = script.actors.some((a) => a.team === "official") ? figureInks(referee([teams.attacking.jersey, teams.defending.jersey], ink.dark ? "dark" : "light"), ink) : defending;
  const staff = script.actors.some((a) => a.team === "staff") ? figureInks(STAFF, ink) : defending;
  let items: Item[];
  const behind = f.behind;
  if (behind != null) {
    items = script.actors.map((a, index) => ({ depth: f.depth(fieldPoint(a.position(t))), kind: "actor", index }));
    for (const right of [false, true]) {
      // The goal in front of the lens covers everyone beyond its line.
      const line: FieldPoint = { x: right ? Pitch.length : 0, y: Pitch.width / 2, z: 0 };
      items.push({ depth: f.depth(line) + (right === behind ? -0.01 : 0.01), kind: "goal", right });
    }
  } else {
    items = script.actors.map((a, index) => ({ depth: a.position(t).y, kind: "actor", index }));
    for (const right of [false, true]) {
      items.push({ depth: Pitch.posts.far + 0.01, kind: "goalBack", right });
      items.push({ depth: Pitch.posts.near - 0.01, kind: "nearPost", right });
    }
  }
  // Stable, as Swift's sort keeps equal depths in order.
  const order = items.map((item, i) => ({ item, i })).sort((a, b) => b.item.depth - a.item.depth || a.i - b.i);
  let hands: Point | null = null;
  for (const { item } of order) {
    if (item.kind === "actor") {
      const actor = script.actors[item.index]!;
      const placed = figures[item.index]!;
      const shown = actor.opacity(t);
      if (!(shown > 0.01)) continue;
      const inks = actor.team === "attacking" ? attacking : actor.team === "defending" ? defending : actor.team === "official" ? officials : staff;
      const opacity = shown * (actor.shaped ? receding(script, t, placed.figure.ground, f.size) : 1);
      ringFigure(ctx, named, placed.figure, placed.height, opacity);
      drawFigure(ctx, placed.figure, inks, placed.height, opacity);
      if (script.heldBy === item.index && t >= script.heldFrom) hands = placed.hands;
      for (const prop of script.props) {
        if (prop.actor === item.index && t >= prop.from && t < prop.until) drawProp(ctx, prop, placed.figure, placed.height, shown * Math.min((t - prop.from) / 0.2, 1));
      }
    } else if (item.kind === "goalBack") {
      drawGoal(ctx, f, input, item.right, ["net", "frame"]);
    } else if (item.kind === "nearPost") {
      drawGoal(ctx, f, input, item.right, ["nearPost"]);
    } else {
      // Seen from behind, the net is nearest the lens; from the far end, furthest.
      drawGoal(ctx, f, input, item.right, item.right === f.behind ? ["nearPost", "frame", "net"] : ["net", "frame", "nearPost"]);
    }
  }
  return hands;
}

/** A team's physios (FootballFrame.staff): slate, a pale cap. */
const STAFF: Uniform = { jersey: "#6b7887", cap: "#cccccc", piping: null, accent: "#808080" };

/** What a man holds up (SoccerFrame.drawProp): the referee's card, the assistant's flag, the fourth official's board; in his raised hand (the board in both). */
function drawProp(ctx: Ctx, prop: SoccerProp, figure: RigFigure, height: number, opacity: number): void {
  const [a, b] = figure.hands;
  const hand = a.y < b.y ? a : b;
  const u = height / 10;
  ctx.save();
  ctx.globalAlpha *= opacity;
  switch (prop.kind) {
    case "yellowCard":
    case "redCard":
      ctx.beginPath();
      ctx.roundRect(hand.x - u * 0.8, hand.y - u * 2.3, u * 1.6, u * 2.2, u * 0.15);
      ctx.fillStyle = prop.kind === "redCard" ? "rgb(219 31 26)" : "rgb(255 214 26)";
      ctx.fill();
      ctx.strokeStyle = "rgb(0 0 0 / 0.35)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
      break;
    case "flag": {
      ctx.beginPath();
      ctx.moveTo(hand.x, hand.y);
      ctx.lineTo(hand.x, hand.y - u * 2.2);
      ctx.strokeStyle = "rgb(0 0 0 / 0.7)";
      ctx.lineWidth = Math.max(u * 0.12, 0.7);
      ctx.stroke();
      const x = hand.x;
      const y = hand.y - u * 2.2;
      ctx.fillStyle = "rgb(255 214 26)";
      ctx.fillRect(x, y, u * 1.4, u * 1.0);
      ctx.fillStyle = "rgb(219 31 26)";
      ctx.fillRect(x, y, u * 0.7, u * 0.5);
      break;
    }
    case "board": {
      const mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) };
      const x = mid.x - u * 1.6;
      const y = mid.y - u * 1.9;
      ctx.beginPath();
      ctx.roundRect(x, y, u * 3.2, u * 1.9, u * 0.2);
      ctx.fillStyle = "rgb(20 20 20)";
      ctx.fill();
      // The numbers lit: one red, one green.
      ctx.fillStyle = "rgb(242 64 51)";
      ctx.fillRect(x + u * 0.35, y + u * 0.45, u * 1.0, u * 1.0);
      ctx.fillStyle = "rgb(77 230 89)";
      ctx.fillRect(x + u * 3.2 - u * 1.35, y + u * 0.45, u * 1.0, u * 1.0);
      break;
    }
  }
  ctx.restore();
}

/**
 * The goal on one end: the net (its back, roof and sides), the far post and
 * the bar, the near post, in the order asked. The net ripples where a goal
 * went in; the woodwork shivers where a shot struck it.
 */
function drawGoal(ctx: Ctx, f: PitchProjection, input: FrameInputs, right: boolean, parts: readonly GoalPart[]): void {
  const { script, t, ink } = input;
  const x = right ? Pitch.length : 0;
  const posts = Pitch.posts;
  const H = Pitch.goalHeight;
  const post = Math.min(Math.max(0.12 * f.scale({ x, y: Pitch.width / 2, z: 0 }), 1.1), 3.2);
  // The woodwork shivers after a hit.
  let shiver = 0;
  const struck = script.impacts.find((i) => i.kind === "woodwork" && i.point.x > Pitch.length / 2 === right);
  if (struck && t >= struck.at && t < struck.at + 0.6) {
    const u = t - struck.at;
    shiver = 0.05 * Math.exp(-u * 7) * Math.sin(u * 2 * Math.PI * 16);
  }
  const wood = (points: readonly FieldPoint[]) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach((q, i) => {
      const p = f.point(q);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = postRim(ink);
    ctx.lineWidth = post + 1.4;
    ctx.stroke();
    ctx.strokeStyle = goalInk(ink);
    ctx.lineWidth = post;
    ctx.stroke();
  };
  for (const part of parts) {
    switch (part) {
      case "nearPost":
        wood([
          { x, y: posts.near + shiver, z: 0 },
          { x, y: posts.near + shiver, z: H },
        ]);
        break;
      case "frame":
        // The far post and the bar.
        wood([
          { x, y: posts.far + shiver, z: 0 },
          { x, y: posts.far + shiver, z: H + shiver },
          { x, y: posts.near + shiver, z: H + shiver },
        ]);
        break;
      case "net":
        drawNet(ctx, f, input, right, x, right ? 1 : -1, 2, 0.9);
        break;
    }
  }
}

function drawNet(ctx: Ctx, f: PitchProjection, { script, t, ink }: FrameInputs, right: boolean, x: number, s: number, depthLow: number, depthHigh: number): void {
  const posts = Pitch.posts;
  const H = Pitch.goalHeight;
  // The net: bellied out round where the ball hit it, swaying back.
  const hit = script.impacts.find((i) => i.kind === "net" && i.point.x > Pitch.length / 2 === right);
  const bulge = (y: number, z: number) => {
    if (!hit || !(t >= hit.at)) return 0;
    const u = t - hit.at;
    if (!(u < 1.6)) return 0;
    const reach = Math.exp(-((y - hit.point.y) ** 2 + (z - hit.point.z) ** 2) / 1.8);
    return 0.75 * reach * Math.exp(-u * 3.4) * Math.cos(u * 2 * Math.PI * 1.4) * Math.min(u / 0.06, 1);
  };
  const back = (y: number, z: number): Point => f.point({ x: x + s * (depthLow + ((depthHigh - depthLow) * z) / H + bulge(y, z)), y, z });
  // From behind it, the net is the nearest thing to the lens: a veil, its mesh heavier.
  const close = f.behind === right;
  if (close) {
    const across = Array.from({ length: 13 }, (_, i) => posts.near + ((posts.far - posts.near) * i) / 12);
    ctx.beginPath();
    [...across.map((y) => back(y, 0)), ...[...across].reverse().map((y) => back(y, H))].forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = netInk(ink, 0.3);
    ctx.fill();
  }
  ctx.beginPath();
  const columns = 12;
  const rows = 5;
  for (let i = 0; i <= columns; i++) {
    const y = posts.near + ((posts.far - posts.near) * i) / columns;
    let p = back(y, 0);
    ctx.moveTo(p.x, p.y);
    for (let j = 1; j <= rows; j++) {
      p = back(y, (H * j) / rows);
      ctx.lineTo(p.x, p.y);
    }
    // On over the roof to the bar.
    p = f.point({ x, y, z: H });
    ctx.lineTo(p.x, p.y);
  }
  for (let j = 0; j <= rows; j++) {
    const z = (H * j) / rows;
    let p = back(posts.near, z);
    ctx.moveTo(p.x, p.y);
    for (let i = 1; i <= columns; i++) {
      p = back(posts.near + ((posts.far - posts.near) * i) / columns, z);
      ctx.lineTo(p.x, p.y);
    }
  }
  // The sides, from the posts back.
  for (const y of [posts.near, posts.far]) {
    for (let j = 0; j <= 3; j++) {
      const z = (H * j) / 3;
      const a = f.point({ x, y, z });
      const b = back(y, z);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    const a = f.point({ x, y, z: 0 });
    const b = back(y, 0);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.strokeStyle = netInk(ink);
  ctx.lineWidth = close ? Math.min(Math.max(f.scale({ x, y: Pitch.width / 2, z: 0 }) * 0.02, 0.6), 1.1) : 0.5;
  ctx.stroke();
}

function drawTheBall(ctx: Ctx, f: PitchProjection, { script, t, ink }: FrameInputs, hands: Point | null, named: PlacedTags | null): void {
  const ball = script.ball(t);
  if (!ball) return;
  const o = script.ballOpacity(t);
  const p = hands ?? f.point(ball);
  const ppm = f.scale(ball);
  const r = Math.min(Math.max(0.3 * ppm, 1.7), Math.max(f.figure(ball) * 0.11, 1.7));
  const trail: Point[] = [];
  if (hands == null) {
    let flight = null;
    for (let i = script.flights.length - 1; i >= 0; i--) {
      const fl = script.flights[i]!;
      if (fl.start < t && t <= fl.end) {
        flight = fl;
        break;
      }
    }
    if (flight && flight.kind !== "carry") for (let i = 1; i <= 6; i++) trail.push(f.point(flight.point(Math.max(t - i * 0.014, flight.start))));
  }
  ringBall(ctx, named, p, r, o);
  drawBall(ctx, p, r, trail, ink, o);
}

/** What the ball hits: a flash in the keeper's hands, the post ringing, a thud off a body; the net's own ripple is drawn with the goal. */
function drawImpacts(ctx: Ctx, f: PitchProjection, { script, t, ink }: FrameInputs): void {
  for (const impact of script.impacts) {
    const age = t - impact.at;
    if (!(age >= 0)) continue;
    const c = f.point(impact.point);
    const unit = f.figure(impact.point) / 10;
    switch (impact.kind) {
      case "save": {
        if (!(age < 0.34)) continue;
        const u = age / 0.34;
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
      case "woodwork":
        // The post rings: two rings out from where it struck.
        if (!(age < 0.7)) continue;
        for (let k = 0; k < 2; k++) {
          const a = age - k * 0.12;
          if (!(a >= 0)) continue;
          const u = a / 0.58;
          if (!(u < 1)) continue;
          const r = (1.5 + 6 * houseCurve(u)) * unit;
          ellipse(ctx, c.x, c.y, r, r);
          ctx.strokeStyle = rgba(ink.trace, 0.9 * (1 - u));
          ctx.lineWidth = Math.max(unit * 0.18, 1);
          ctx.stroke();
        }
        break;
      case "block": {
        if (!(age < 0.4)) continue;
        const u = age / 0.4;
        const r = (1.4 + 4.5 * houseCurve(u)) * unit;
        ellipse(ctx, c.x, c.y, r, r * 0.8);
        ctx.strokeStyle = rgba(ink.trace, 0.7 * (1 - u));
        ctx.lineWidth = Math.max(unit * 0.18, 1);
        ctx.stroke();
        break;
      }
      case "net":
        continue;
    }
  }
}

function drawLabels(ctx: Ctx, f: PitchProjection, { script, t, labels }: FrameInputs): void {
  script.banners.forEach((banner, i) => {
    const block = labels.banners[i];
    if (block) TheaterType.drawBanner(ctx, block, banner.at, banner.until, t, f.size);
  });
  // The stamp, as the moment resolves: in from larger on a quick spring that never bounces.
  if (labels.stamp) TheaterType.drawStamp(ctx, labels.stamp, script.stamp, t, f.size, 0.22, script.cornerRight);
}
