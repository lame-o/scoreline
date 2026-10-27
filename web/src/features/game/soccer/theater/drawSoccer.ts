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
import { houseCurve, smooth, type FieldPoint, type Point } from "../../../../data/mlb/theaterField";
import { facing, figure, mixPose, Poses, samePose, type Figure, type Pose } from "../../../../data/mlb/theaterPose";
import type { Uniform } from "../../../../data/mlb/theaterTeams";
import { goalOf, Pitch, stampDetail, surname, type SoccerScene } from "../../../../data/theater/soccerScene";
import type { Actor, SoccerScript } from "../../../../data/theater/soccerScript";
import type { PitchProjection } from "../../../../data/theater/soccerTheater";
import { hexRGB, rgba, type RGB, type TheaterInk } from "../../mlb/theater/theaterInk";
import {
  accentOf,
  ASCENT,
  bannerBlock,
  chalk,
  drawBall,
  drawFigure,
  ellipse,
  figureInks,
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
const netInk = (ink: TheaterInk) => (ink.dark ? "rgb(255 255 255 / 0.22)" : "rgb(0 0 0 / 0.16)");

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
  const camera = f.camera;
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
  // (one shape, so where they meet isn't darker), their tiers just there.
  ctx.beginPath();
  ground(-70, -60, L + 70, W + 5);
  quad(fp(-70, W + 5), fp(L + 70, W + 5), fp(L + 70, W + 60, 34), fp(-70, W + 60, 34));
  for (const [x, out] of [
    [-6, -40],
    [L + 6, 40],
  ] as const) {
    quad(fp(x, -60), fp(x, W + 5), fp(x + out, W + 5, 25), fp(x + out, -60, 25));
  }
  ctx.fillStyle = ink.stands;
  ctx.fill();
  ctx.beginPath();
  for (let k = 1; k <= 5; k++) {
    const y = W + 5 + k * 9;
    const z = (k * 9 * 34) / 55;
    const a = f.point(fp(-70, y, z));
    const b = f.point(fp(L + 70, y, z));
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.strokeStyle = ink.stands;
  ctx.lineWidth = 0.5;
  ctx.stroke();
  // The grass, with its run-off, mowed in bands across the pitch.
  ctx.beginPath();
  ground(-4, -3.5, L + 4, W + 3.5);
  ctx.fillStyle = ink.grass;
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
  ctx.strokeStyle = chalk(ink);
  ctx.lineWidth = line;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
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

const pose = (lean: number, nearThigh: number, nearShin: number, farThigh: number, farShin: number, nearUpper: number, nearFore: number, farUpper: number, farFore: number, lift = 0): Pose => ({
  lean,
  nearThigh,
  nearShin,
  farThigh,
  farShin,
  nearUpper,
  nearFore,
  farUpper,
  farFore,
  lift,
});

/** Soccer's poses (SoccerTheater.swift's `Pose` extension). */
export const PitchPose = {
  // A strike: the swing leg drawn back, through the ball, and on; the arms out for balance.
  backswing: pose(-0.12, -0.45, -1.45, 0.12, 0.05, -0.95, -0.6, 0.95, 1.15),
  strike: pose(0.05, 0.95, 0.55, -0.06, -0.05, -0.7, -0.35, 1.2, 1.45),
  followThrough: pose(0.18, 1.4, 1.3, -0.18, -0.1, -0.45, -0.1, 1.0, 1.2),
  /** Up for a header: legs tucked, arms out, the head through it. */
  header: pose(0.4, 0.55, -0.7, 0.15, -0.95, -1.5, -1.85, 1.55, 1.9, 0.2),
  /** Both hands over his head, then through: a throw-in. */
  throwBack: pose(-0.25, 0.35, 0.2, -0.3, -0.2, 2.75, -2.9, 2.65, -3.0),
  throwThrough: pose(0.3, 0.4, 0.15, -0.35, -0.4, 1.9, 1.55, 1.75, 1.45),
  /** Square to the shot, arms in, a stride wide: a block. */
  block: pose(-0.12, 0.5, 0.3, -0.5, -0.3, -0.25, 0.35, 0.25, -0.35),
  /** The keeper takes it into his chest. */
  gather: pose(0.22, 0.5, 0.1, -0.35, -0.15, 1.3, 1.75, 1.1, 1.65),
  /** Arms up, chest out. */
  celebrate: pose(-0.12, 0.22, 0.12, -0.22, -0.12, 2.55, 2.75, -2.55, -2.75),
  /** Hands on his head. */
  dejected: pose(0.05, 0.1, 0.05, -0.1, -0.05, 2.25, -2.2, -2.25, 2.2),
  /** At full stretch, flying: facing the way he dives. */
  dive: pose(1.25, -1.15, -1.35, -1.4, -1.6, 1.85, 1.95, 1.7, 1.8),
  /** Up high, more upright. */
  diveHigh: pose(0.8, -0.55, -1.1, -0.85, -1.3, 2.35, 2.45, 2.15, 2.3, 0.18),
  /** Down on the grass after it. */
  down: pose(1.5, -1.45, -1.55, -1.35, -1.5, 1.55, 1.45, 1.05, 1.3),
};

const envelope = (x: number, attack: number, release: number) => (x < 0 ? Math.max(1 + x / attack, 0) : Math.max(1 - x / release, 0));

function keyed(keys: readonly (readonly [number, Pose])[], x: number, way: number, base: Pose): Pose {
  let i = -1;
  for (let k = keys.length - 1; k >= 0; k--) {
    if (keys[k]![0] <= x) {
      i = k;
      break;
    }
  }
  if (i < 0 || i + 1 >= keys.length) return base;
  const [a, pa] = keys[i]!;
  const [b, pb] = keys[i + 1]!;
  // Poses are written facing right; the base already faces his way.
  const turn = (p: Pose) => (samePose(p, base) ? p : facing(p, way));
  return mixPose(turn(pa), turn(pb), smooth((x - a) / (b - a)));
}

/** The pose at t: what he's doing (a strike, a header, a block, arms up), else how he's moving, else how he stands: watching the ball. */
function actorPose(script: SoccerScript, scene: SoccerScene | null, actor: Actor, index: number, f: PitchProjection, t: number): Pose {
  const here = actor.position(t);
  const ballPoint = script.ball(t);
  const ball = ballPoint ? { x: ballPoint.x, y: ballPoint.y } : scene ? goalOf(scene) : Pitch.center;
  const hereX = f.pointGround(here).x;
  const facingToward = (p: Point) => (f.pointGround(p).x - hereX >= 0 ? 1 : -1);
  let base: Pose;
  const motion = actor.motion(t);
  if (motion && motion.speed > 1.2) {
    const way = facingToward({ x: here.x + motion.heading.x, y: here.y + motion.heading.y });
    base = motion.speed > 4.5 ? facing(Poses.run(2 * Math.PI * 2.6 * t + index), way) : facing(Poses.walk(2 * Math.PI * 1.8 * t + index), way);
  } else {
    base = facing(actor.role === "keeper" ? Poses.ready : Poses.stand, facingToward(ball));
  }
  for (const action of actor.actions) {
    const x = t - action.at;
    const way = facingToward(action.toward);
    switch (action.kind) {
      case "kick":
        if (!(x > -0.24 && x < 0.45)) break;
        base = keyed(
          [
            [-0.24, base],
            [-0.09, PitchPose.backswing],
            [0, PitchPose.strike],
            [0.13, PitchPose.followThrough],
            [0.45, base],
          ],
          x,
          way,
          base,
        );
        break;
      case "header":
        if (!(x > -0.32 && x < 0.42)) break;
        base = keyed(
          [
            [-0.32, base],
            [-0.02, PitchPose.header],
            [0.1, PitchPose.header],
            [0.42, base],
          ],
          x,
          way,
          base,
        );
        break;
      case "throwIn":
        if (!(x > -0.5 && x < 0.45)) break;
        base = keyed(
          [
            [-0.5, base],
            [-0.15, PitchPose.throwBack],
            [0.04, PitchPose.throwThrough],
            [0.45, base],
          ],
          x,
          way,
          base,
        );
        break;
      case "control":
        base = mixPose(base, facing(PitchPose.gather, way), envelope(x, 0.12, 0.2) * 0.4);
        break;
      case "block":
        base = mixPose(base, facing(PitchPose.block, way), envelope(x, 0.18, 0.5));
        break;
      case "gather":
        // Takes it in and holds it there.
        base = mixPose(base, facing(PitchPose.gather, way), x < 0 ? Math.max(1 + x / 0.2, 0) : 1);
        break;
      case "celebrate":
        base = mixPose(base, facing(PitchPose.celebrate, way), smooth((x + 0.25) / 0.35));
        break;
      case "dejected":
        base = mixPose(base, facing(PitchPose.dejected, way), smooth(x / 0.35));
        break;
    }
  }
  return base;
}

/** A player posed and placed at t; and where his hands are (a keeper holding the ball has it there). */
function place(script: SoccerScript, scene: SoccerScene | null, actor: Actor, index: number, f: PitchProjection, t: number): { figure: Figure; height: number; hands: Point } {
  const at = actor.position(t);
  const foot = f.pointGround(at);
  const height = f.figure(at);
  // The keeper at full stretch: his hands go exactly to the ball.
  const dive = actor.dive;
  if (dive && t >= dive.start) {
    const target = f.point(dive.target);
    const set = f.pointGround(actor.position(dive.start));
    const way = target.x >= set.x ? 1 : -1;
    const u = Math.min(Math.max((t - dive.start) / Math.max(dive.reach - dive.start, 0.01), 0), 1);
    const fall = Math.min(Math.max((t - dive.reach) / 0.32, 0), 1);
    const flying = dive.target.z > 1.5 ? PitchPose.diveHigh : PitchPose.dive;
    const p = facing(mixPose(mixPose(Poses.ready, flying, smooth(u * 1.3)), PitchPose.down, smooth(fall)), way);
    const first = figure(p, foot, height);
    const pull = fall > 0 ? 1 - smooth(fall) : smooth(u);
    const reach = { x: (target.x - first.near.hand.x) * pull, y: (target.y - first.near.hand.y) * pull };
    const placed = figure(p, { x: foot.x + reach.x, y: Math.min(foot.y + reach.y, foot.y) }, height);
    return { figure: placed, height, hands: placed.near.hand };
  }
  const fig = figure(actorPose(script, scene, actor, index, f, t), foot, height);
  return { figure: fig, height, hands: { x: (fig.near.hand.x + fig.far.hand.x) / 2, y: (fig.near.hand.y + fig.far.hand.y) / 2 } };
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
    const tone = scene.outcome === "goal" ? (scene.decisive ? ink.gold : accentOf(teams.attacking, ink)) : primary(ink);
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
}

/** One frame of a moment through the camera (SoccerFrame). */
export function drawSoccerFrame(ctx: Ctx, f: PitchProjection, input: FrameInputs): void {
  drawTrails(ctx, f, input);
  drawShadows(ctx, f, input);
  const hands = drawStage(ctx, f, input);
  drawTheBall(ctx, f, input, hands);
  drawImpacts(ctx, f, input);
  drawLabels(ctx, f, input);
}

/**
 * Each pass draws its line on the grass as the ball travels it, a run with
 * the ball a dotted one, then settles to a faint record of the move; the
 * shot's path, in the air, brighter.
 */
function drawTrails(ctx: Ctx, f: PitchProjection, { script, t, teams, ink }: FrameInputs): void {
  const width = Math.min(Math.max(f.size.height * 0.0065, 0.9), 1.8);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  script.flights.forEach((flight, i) => {
    if (!(t > flight.start)) return;
    const end = Math.min(t, flight.end);
    const after = t - flight.end;
    const fade = after <= 0 ? 1 : Math.max(1 - after / 0.6, 0);
    if (flight.kind === "pass" || flight.kind === "carry") {
      if (flight.from.x === flight.to.x && flight.from.y === flight.to.y) return;
      const a = f.pointGround(flight.from);
      const b = f.pointGround(flight.point(end));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = teamAlpha(teams.attacking, ink, 0.24 + 0.36 * fade);
      ctx.lineWidth = width;
      ctx.setLineDash(flight.kind === "carry" ? [width * 0.1, width * 2.6] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (flight.kind === "shot" && i === script.shot) {
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

function drawShadows(ctx: Ctx, f: PitchProjection, { script, t, ink }: FrameInputs): void {
  ctx.fillStyle = shadow(ink);
  for (const actor of script.actors) {
    const at = actor.position(t);
    const p = f.pointGround(at);
    const w = f.figure(at) * 0.3;
    ellipse(ctx, p.x, p.y, w, w * 0.3);
    ctx.fill();
  }
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

type Item = { readonly depth: number; readonly kind: "actor"; readonly index: number } | { readonly depth: number; readonly kind: "goalBack" | "nearPost"; readonly right: boolean };

/** The goals and the players, far to near (a man in front of the post covers it). Returns where the keeper holding the ball has his hands. */
function drawStage(ctx: Ctx, f: PitchProjection, input: FrameInputs): Point | null {
  const { script, scene, t, teams, ink } = input;
  const attacking = figureInks(teams.attacking, ink);
  const defending = figureInks(teams.defending, ink);
  const items: Item[] = script.actors.map((a, index) => ({ depth: a.position(t).y, kind: "actor", index }));
  for (const right of [false, true]) {
    items.push({ depth: Pitch.posts.far + 0.01, kind: "goalBack", right });
    items.push({ depth: Pitch.posts.near - 0.01, kind: "nearPost", right });
  }
  // Stable, as Swift's sort keeps equal depths in order.
  const order = items.map((item, i) => ({ item, i })).sort((a, b) => b.item.depth - a.item.depth || a.i - b.i);
  let hands: Point | null = null;
  for (const { item } of order) {
    if (item.kind === "actor") {
      const actor = script.actors[item.index]!;
      const placed = place(script, scene, actor, item.index, f, t);
      drawFigure(ctx, placed.figure, actor.team === "attacking" ? attacking : defending, placed.height, 1);
      if (script.heldBy === item.index && t >= script.heldFrom) hands = placed.hands;
    } else {
      drawGoal(ctx, f, input, item.right, item.kind === "nearPost");
    }
  }
  return hands;
}

/**
 * The goal on one end: the net (its back, roof and sides) with the far post
 * and the bar, or the near post alone. The net ripples where a goal went
 * in; the woodwork shivers where a shot struck it.
 */
function drawGoal(ctx: Ctx, f: PitchProjection, { script, t, ink }: FrameInputs, right: boolean, near: boolean): void {
  const x = right ? Pitch.length : 0;
  const s = right ? 1 : -1;
  const posts = Pitch.posts;
  const H = Pitch.goalHeight;
  const depthLow = 2;
  const depthHigh = 0.9;
  const post = Math.min(Math.max(0.12 * f.scale({ x, y: Pitch.width / 2, z: 0 }), 1.1), 3.2);
  // The woodwork shivers after a hit.
  let shiver = 0;
  const struck = script.impacts.find((i) => i.kind === "woodwork" && i.point.x > Pitch.length / 2 === right);
  if (struck && t >= struck.at && t < struck.at + 0.6) {
    const u = t - struck.at;
    shiver = 0.05 * Math.exp(-u * 7) * Math.sin(u * 2 * Math.PI * 16);
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const frame = (points: readonly FieldPoint[]) => {
    ctx.beginPath();
    points.forEach((q, i) => {
      const p = f.point(q);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = ink.halo;
    ctx.lineWidth = post + 1.4;
    ctx.stroke();
    ctx.strokeStyle = goalInk(ink);
    ctx.lineWidth = post;
    ctx.stroke();
  };
  if (near) {
    frame([
      { x, y: posts.near + shiver, z: 0 },
      { x, y: posts.near + shiver, z: H },
    ]);
    return;
  }
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
  ctx.lineWidth = 0.5;
  ctx.stroke();
  // The far post and the bar.
  frame([
    { x, y: posts.far + shiver, z: 0 },
    { x, y: posts.far + shiver, z: H + shiver },
    { x, y: posts.near + shiver, z: H + shiver },
  ]);
}

function drawTheBall(ctx: Ctx, f: PitchProjection, { script, t, ink }: FrameInputs, hands: Point | null): void {
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
