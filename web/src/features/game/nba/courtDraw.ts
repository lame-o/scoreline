/**
 * The court's ink (BasketballViews.swift `CourtMarkings`, `CourtView`'s
 * Canvas; BasketballCelebrations.swift `CourtInk`, `ShotArc`): the lines to
 * scale, the shots and the trail, and each shot's story as a closed-form
 * function of time. The chart and the story draw marks with the same
 * functions, so a story's last frame and the chart's first are the same
 * pixels. Lengths are in Mac points (`pt` scales them to CSS pixels).
 */
import { houseCurve, SplitMix32, sweepCurve } from "../../../data/celebrations";
import {
  ballPoint,
  BLOCK_REACH,
  COURT,
  flightControl,
  FLIGHT,
  freeTime,
  isShotPlay,
  playPoint,
  quadPoint,
  shotPoint,
  type ArcKind,
  type CourtPlay,
  type CourtScene,
  type Shot,
} from "../../../data/basketball";
import type { Side } from "../../../data/models";

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** Court feet to CSS pixels. */
export interface CourtFrame {
  readonly scale: number;
  readonly pt: number;
  readonly map: (p: Pt) => Pt;
}

export function courtFrame(width: number, pt: number): CourtFrame {
  const scale = width / COURT.length;
  return { scale, pt, map: (p) => ({ x: p.x * scale, y: p.y * scale }) };
}

/** Resolved colors for one draw (canvas can't read CSS variables). */
export interface CourtInk {
  readonly top: string;
  readonly bottom: string;
  readonly neutral: string;
  readonly label: string;
  readonly markings: string;
  readonly reference: string;
  readonly track: string;
  readonly page: string;
}

export const sideInk = (ink: CourtInk, side: Side | null) => (side === "top" ? ink.top : side === "bottom" ? ink.bottom : ink.neutral);

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const ease = (x: number) => houseCurve(clamp01(x));
const ramp = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
/** Receded marks (Viz.receded). */
export const RECEDED = 0.55;

/** Court lines to scale (94 × 50 ft): keys, free-throw circles, the three-point line, restricted areas, center circle; rims and backboards a step stronger. */
export function drawMarkings(ctx: CanvasRenderingContext2D, width: number, height: number, ink: CourtInk, pt: number): void {
  const s = width / COURT.length;
  const p = (x: number, y: number) => [x * s, y * s] as const;
  ctx.lineWidth = pt;
  // The keys' paint first.
  ctx.fillStyle = ink.track;
  for (const baseline of [0, 94]) {
    const dir = baseline === 0 ? 1 : -1;
    ctx.fillRect(Math.min(baseline, baseline + dir * 19) * s, 17 * s, 19 * s, 16 * s);
  }
  ctx.strokeStyle = ink.markings;
  ctx.beginPath();
  ctx.rect(0.5, 0.5, width - 1, height - 1);
  ctx.moveTo(...p(47, 0));
  ctx.lineTo(...p(47, 50));
  ctx.moveTo(...p(53, 25));
  ctx.arc(...p(47, 25), 6 * s, 0, 2 * Math.PI);
  const corner = Math.sqrt(23.75 * 23.75 - 22 * 22);
  const dashed = new Path2D();
  const hoops = new Path2D();
  const rims = new Path2D();
  for (const baseline of [0, 94]) {
    const dir = baseline === 0 ? 1 : -1;
    const rim = baseline + dir * 5;
    // The key: 16 ft wide, 19 ft to the free-throw line.
    ctx.rect(Math.min(baseline, baseline + dir * 19) * s, 17 * s, 19 * s, 16 * s);
    // Free-throw circle: solid toward half court, dashed inside the key.
    const ft = baseline + dir * 19;
    const [fx, fy] = p(ft, 25);
    ctx.moveTo(fx, 19 * s);
    ctx.arc(fx, fy, 6 * s, -Math.PI / 2, Math.PI / 2, dir < 0);
    dashed.moveTo(fx, 31 * s);
    dashed.arc(fx, fy, 6 * s, Math.PI / 2, (3 * Math.PI) / 2, dir < 0);
    // Three-point line: straight along the corners, then the arc.
    const join = rim + dir * corner;
    ctx.moveTo(...p(baseline, 3));
    ctx.lineTo(...p(join, 3));
    const start = Math.atan2(-22, join - rim);
    const end = Math.atan2(22, join - rim);
    // Through the side toward half court: increasing angles for the left basket, decreasing for the right.
    ctx.arc(...p(rim, 25), 23.75 * s, start, end, dir < 0);
    ctx.lineTo(...p(baseline, 47));
    // Restricted area: 4 ft around the rim.
    ctx.moveTo(...p(rim, 21));
    ctx.arc(...p(rim, 25), 4 * s, -Math.PI / 2, Math.PI / 2, dir < 0);
    // Backboard (4 ft in) and rim (18 in across).
    hoops.moveTo(...p(baseline + dir * 4, 22));
    hoops.lineTo(...p(baseline + dir * 4, 28));
    rims.moveTo((rim + 0.75) * s, 25 * s);
    rims.arc(...p(rim, 25), 0.75 * s, 0, 2 * Math.PI);
  }
  ctx.stroke();
  ctx.setLineDash([2 * pt, 2.5 * pt]);
  ctx.stroke(dashed);
  ctx.setLineDash([]);
  ctx.strokeStyle = ink.reference;
  ctx.lineWidth = 1.5 * pt;
  ctx.stroke(hoops);
  ctx.lineWidth = pt;
  ctx.stroke(rims);
}

/** A shot: filled when made, a ring when missed (CourtInk.shot). */
export function drawShotMark(ctx: CanvasRenderingContext2D, made: boolean, c: Pt, color: string, pt: number, grow = 1): void {
  ctx.beginPath();
  if (made) {
    ctx.arc(c.x, c.y, 2.75 * grow * pt, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  } else {
    ctx.arc(c.x, c.y, 2.4 * grow * pt, 0, 2 * Math.PI);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2 * pt;
    ctx.stroke();
  }
}

/** A trail play's way to the rim (a shot's path, in its team's color). */
export function drawTrailLine(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, color: string, alpha: number, pt: number): void {
  ctx.save();
  ctx.globalAlpha *= 0.6 * alpha;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25 * pt;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();
}

/** The ball in flight: a team-color disc with a 1pt edge. */
export function drawFlightBall(ctx: CanvasRenderingContext2D, c: Pt, color: string, edge: string, pt: number, opacity = 1, radius = 2.5): void {
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.beginPath();
  ctx.arc(c.x, c.y, radius * pt, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = pt;
  ctx.stroke();
  ctx.restore();
}

function ring(ctx: CanvasRenderingContext2D, c: Pt, r: number, color: string, pt: number, opacity = 1): void {
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r * pt, 0, 2 * Math.PI);
  ctx.strokeStyle = color;
  ctx.lineWidth = pt;
  ctx.stroke();
  ctx.restore();
}

/** A trail play's mark: shots as the chart draws them, free throws smaller, a turnover as a cross, a foul as a small square, a rebound or jump ball as a dot. */
export function drawPlayMark(ctx: CanvasRenderingContext2D, play: CourtPlay, c: Pt, color: string, alpha: number, pt: number, grow = 1): void {
  ctx.save();
  ctx.globalAlpha *= alpha;
  const k = play.kind;
  switch (k.kind) {
    case "shot":
      drawShotMark(ctx, k.made, c, color, pt, grow);
      break;
    case "freeThrow":
      ctx.beginPath();
      ctx.arc(c.x, c.y, 2 * pt, 0, 2 * Math.PI);
      if (k.made) {
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = pt;
        ctx.stroke();
      }
      break;
    case "turnover": {
      const r = 2.6 * pt;
      ctx.beginPath();
      ctx.moveTo(c.x - r, c.y - r);
      ctx.lineTo(c.x + r, c.y + r);
      ctx.moveTo(c.x - r, c.y + r);
      ctx.lineTo(c.x + r, c.y - r);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4 * pt;
      ctx.lineCap = "round";
      ctx.stroke();
      break;
    }
    case "foul":
      ctx.strokeStyle = color;
      ctx.lineWidth = pt;
      ctx.strokeRect(c.x - 2 * pt, c.y - 2 * pt, 4 * pt, 4 * pt);
      break;
    default:
      ctx.beginPath();
      ctx.arc(c.x, c.y, 1.75 * pt, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
  }
  ctx.restore();
}

/** The trail's fade for the play at `index` (the oldest faintest, never fainter than the shots behind it). */
export const trailAlpha = (index: number, count: number) => 0.5 + (0.5 * (index + 1)) / Math.max(count, 1);

/**
 * The shot chart beneath and the trail over it (CourtView.drawShots,
 * drawTrail). Full strength on its own; behind a trail the earlier shots
 * step back; in a running replay each shot lands at full strength and steps
 * back over the next two seconds. `skip`: a shot its story is drawing.
 */
export function drawScene(ctx: CanvasRenderingContext2D, scene: CourtScene, frame: CourtFrame, ink: CourtInk, time: number | null, rate: number, skip: string | null): void {
  const { pt, map } = frame;
  const onTrail = new Set(scene.trail.map((p) => p.id));
  const newest = scene.newest?.id ?? null;
  for (const made of [false, true]) {
    for (const shot of scene.shots) {
      if (shot.made !== made || shot.id === newest || onTrail.has(shot.id) || shot.id === skip) continue;
      ctx.save();
      if (scene.style === "trail") ctx.globalAlpha = RECEDED;
      else if (scene.style === "playing") {
        // Real seconds since it landed in the replay.
        const age = Math.max(0, ((time ?? 0) - (shot.elapsed ?? 0)) / rate);
        ctx.globalAlpha = Math.max(RECEDED, 1 - (1 - RECEDED) * Math.min(age / 2, 1));
      }
      drawShotMark(ctx, shot.made, map(shotPoint(shot)), sideInk(ink, shot.side), pt);
      ctx.restore();
    }
  }
  // The newest shot of a replay (or a picked player's, live): larger, ringed.
  const n = scene.newest;
  if (n && n.id !== skip && (!onTrail.has(n.id) || scene.style !== "trail")) {
    const c = map(shotPoint(n));
    drawShotMark(ctx, n.made, c, sideInk(ink, n.side), pt, 1.4);
    ring(ctx, c, 6.5, ink.label, pt, 0.6);
  }
  // The trail: each shot's path to the rim, the ball's way from one play to the next within a half, and each play's mark.
  const count = scene.trail.length;
  const midcourt = map({ x: COURT.length / 2, y: 0 }).x;
  let newestShot: string | null = null;
  for (let i = count - 1; i >= 0; i--) if (isShotPlay(scene.trail[i]!)) { newestShot = scene.trail[i]!.id; break; }
  let previousEnd: Pt | null = null;
  scene.trail.forEach((play, index) => {
    const alpha = trailAlpha(index, count);
    const raw = playPoint(play);
    if (!raw) return;
    const spot = map(raw);
    const endRaw = ballPoint(play);
    const end = endRaw ? map(endRaw) : spot;
    if (previousEnd && Math.hypot(previousEnd.x - spot.x, previousEnd.y - spot.y) > 1 && previousEnd.x < midcourt === spot.x < midcourt) {
      ctx.save();
      ctx.globalAlpha = 0.28 * alpha;
      ctx.beginPath();
      ctx.moveTo(previousEnd.x, previousEnd.y);
      ctx.lineTo(spot.x, spot.y);
      ctx.strokeStyle = ink.label;
      ctx.lineWidth = pt;
      ctx.lineCap = "round";
      ctx.setLineDash([2 * pt, 2.5 * pt]);
      ctx.stroke();
      ctx.restore();
    }
    previousEnd = end;
    if (play.id === skip) return;
    if (end.x !== spot.x || end.y !== spot.y) drawTrailLine(ctx, spot, end, sideInk(ink, play.side), alpha, pt);
    drawPlayMark(ctx, play, spot, sideInk(ink, play.side), alpha, pt, play.id === newestShot ? 1.3 : 1);
  });
}

/** Shots (or one trail play) a focus picks out, emphasized on their own layer. */
export function drawLit(ctx: CanvasRenderingContext2D, shots: readonly Shot[], play: CourtPlay | null, frame: CourtFrame, ink: CourtInk, single: boolean): void {
  const { pt, map } = frame;
  for (const made of [false, true]) {
    for (const shot of shots) {
      if (shot.made !== made) continue;
      const c = map(shotPoint(shot));
      drawShotMark(ctx, shot.made, c, sideInk(ink, shot.side), pt, single ? 1.5 : 1);
      if (single) ring(ctx, c, 7.5, ink.label, pt);
    }
  }
  if (play) {
    const raw = playPoint(play);
    if (raw) {
      const c = map(raw);
      drawPlayMark(ctx, play, c, sideInk(ink, play.side), 1, pt);
      ring(ctx, c, 7, ink.label, pt);
    }
  }
}

// MARK: - Shot story

export interface StoryGeometry {
  readonly kind: ArcKind;
  readonly made: boolean;
  readonly spot: Pt;
  readonly rim: Pt;
  readonly color: string;
  readonly blocker: string;
  readonly backboard: readonly [Pt, Pt];
  readonly seed: number;
  /** How the chart draws this shot at rest, so the story ends on it. */
  readonly rest: { readonly grow: number; readonly alpha: number; readonly end: Pt | null };
  readonly lands: boolean;
  /** The court's ball, held back while the story plays; the story draws it once it's free. */
  readonly ball: Pt | null;
}

/** The arc's crossfade into the trail's line. */
function fadeSpan(kind: ArcKind): [number, number] {
  switch (kind) {
    case "swish":
      return [0.55, 0.95];
    case "rimOut":
      return [0.45, 0.85];
    case "stuffed":
      return [0.6, 1.0];
    case "slam":
      return [0.2, 0.5];
  }
}

const reachOf = (kind: ArcKind) => (kind === "swish" ? 1 : kind === "rimOut" ? 0.92 : kind === "stuffed" ? BLOCK_REACH : 0);

/** A smoothed keyframe track (Celebrate.knock's steps): the offset at `t`. */
function steps(list: readonly [number, number][], t: number): number {
  let from = 0;
  let at = 0;
  for (const [x, d] of list) {
    if (t <= at + d) {
      const u = clamp01((t - at) / d);
      const s = u * u * (3 - 2 * u);
      return from + (x - from) * s;
    }
    at += d;
    from = x;
  }
  return from;
}
const KNOCK: readonly [number, number][] = [
  [1, 0.05],
  [-0.8, 0.07],
  [0.5, 0.07],
  [-0.25, 0.07],
  [0, 0.08],
];
const RATTLE: readonly [number, number][] = [
  [1, 0.025],
  [-1, 0.05],
  [1, 0.05],
  [-0.5, 0.05],
  [0, 0.025],
];

/**
 * A shot as it happens (ShotArc.draw, spec §3.1.2), at time `t`: the flight
 * on a stylized arc, then a swish (the stage takes the ball at the rim), a
 * rim-out (it glances off ±35° and fades), a stuff (the path stops at 60%,
 * where the blocker's tick is knocked) or a slam (the backboard rattles).
 * The spot's mark lands at 0.30 s (0.12 s for a slam); the arc relaxes into
 * the trail's straight line. Reduce Motion: no flight, the mark and line fade in.
 */
export function drawStory(ctx: CanvasRenderingContext2D, g: StoryGeometry, t: number, level: "full" | "subtle" | "off", reduce: boolean, ink: CourtInk, pt: number): void {
  if (t < 0) return;
  const control = flightControl(g.spot, g.rim, 40 * pt);
  const point = (s: number) => quadPoint(g.spot, control, g.rim, s);
  const tangent = (s: number): Pt => {
    const dx = 2 * (1 - s) * (control.x - g.spot.x) + 2 * s * (g.rim.x - control.x);
    const dy = 2 * (1 - s) * (control.y - g.spot.y) + 2 * s * (g.rim.y - control.y);
    const l = Math.max(Math.hypot(dx, dy), 0.001);
    return { x: dx / l, y: dy / l };
  };
  const landMark = (opacity: number, scale: number) => {
    if (!g.lands || opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha *= g.rest.alpha * opacity;
    drawShotMark(ctx, g.made, g.spot, g.color, pt, g.rest.grow * scale);
    ctx.restore();
  };
  const tick = (offset: number, scale: number, opacity: number) => {
    if (opacity <= 0) return;
    const reach = reachOf(g.kind);
    const p = point(reach);
    const d = tangent(reach);
    const c = { x: p.x + d.x * offset, y: p.y + d.y * offset };
    const n = { x: -d.y, y: d.x };
    const half = 3.25 * scale * pt;
    ctx.save();
    ctx.globalAlpha *= opacity;
    ctx.beginPath();
    ctx.moveTo(c.x - n.x * half, c.y - n.y * half);
    ctx.lineTo(c.x + n.x * half, c.y + n.y * half);
    ctx.strokeStyle = g.blocker;
    ctx.lineWidth = 1.5 * pt;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  };
  const ping = (c: Pt, age: number) => {
    if (age < 0 || age > 0.6) return;
    const p = ease(age / 0.6);
    const grow = 0.6 + 1.2 * p;
    ctx.save();
    ctx.globalAlpha *= 0.9 * (1 - p);
    ctx.beginPath();
    ctx.arc(c.x, c.y, (5 * grow - 0.75 * grow) * pt, 0, 2 * Math.PI);
    ctx.strokeStyle = g.color;
    ctx.lineWidth = 1.5 * grow * pt;
    ctx.stroke();
    ctx.restore();
  };
  const standIn = () => {
    if (!g.ball) return;
    const free = freeTime(g.kind, reduce);
    const o = reduce ? 1 : ease((t - free) / 0.15);
    if (t < free || o <= 0) return;
    ctx.save();
    ctx.globalAlpha *= o;
    ctx.beginPath();
    ctx.arc(g.ball.x, g.ball.y, 5 * pt, 0, 2 * Math.PI);
    ctx.fillStyle = ink.page;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(g.ball.x, g.ball.y, 3.5 * pt, 0, 2 * Math.PI);
    ctx.fillStyle = ink.label;
    ctx.fill();
    ctx.restore();
  };

  if (reduce) {
    const o = ease(t / 0.15);
    if (g.lands && g.rest.end) {
      ctx.save();
      ctx.globalAlpha *= o;
      drawTrailLine(ctx, g.spot, g.rest.end, g.color, g.rest.alpha, pt);
      ctx.restore();
    }
    landMark(o, 1);
    if (g.kind === "stuffed") tick(0, 1, o * (1 - ramp(t, 0.5, 0.8)));
    standIn();
    return;
  }
  const s = Math.min(t / FLIGHT, 1);
  const reach = reachOf(g.kind);
  const head = Math.min(s, reach);
  const [fadeStart, fadeEnd] = fadeSpan(g.kind);
  const gone = ramp(t, fadeStart, fadeEnd);
  const line = g.lands ? g.rest.end : null;
  if (g.kind === "slam" || head <= 0) {
    if (line && gone > 0) {
      ctx.save();
      ctx.globalAlpha *= gone;
      drawTrailLine(ctx, g.spot, line, g.color, g.rest.alpha, pt);
      ctx.restore();
    }
  } else if (line && gone >= 1) {
    drawTrailLine(ctx, g.spot, line, g.color, g.rest.alpha, pt);
  } else {
    // The arc drawn to the ball, then relaxing into the trail's line (on-screen movement: ease-in-out).
    const tip = point(head);
    const bend = { x: g.spot.x + (control.x - g.spot.x) * head, y: g.spot.y + (control.y - g.spot.y) * head };
    const u = line ? sweepCurve(gone) : 0;
    const target = line ?? tip;
    const end = { x: tip.x + (target.x - tip.x) * u, y: tip.y + (target.y - tip.y) * u };
    const mid = { x: (g.spot.x + target.x) / 2, y: (g.spot.y + target.y) / 2 };
    ctx.save();
    if (!line) ctx.globalAlpha *= 1 - gone;
    ctx.beginPath();
    ctx.moveTo(g.spot.x, g.spot.y);
    ctx.quadraticCurveTo(bend.x + (mid.x - bend.x) * u, bend.y + (mid.y - bend.y) * u, end.x, end.y);
    ctx.globalAlpha *= 0.8 + (0.6 * g.rest.alpha - 0.8) * u;
    ctx.strokeStyle = g.color;
    ctx.lineWidth = (1.5 - 0.25 * u) * pt;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }
  // The spot's mark lands like a badge: 92% to full, fading in.
  const landing = g.kind === "slam" ? 0.12 : 0.3;
  if (g.lands && t >= landing) {
    const p = ease((t - landing) / 0.25);
    landMark(p, 0.92 + 0.08 * p);
  }
  switch (g.kind) {
    case "swish":
      if (t < FLIGHT) drawFlightBall(ctx, point(s), g.color, ink.markings, pt);
      else if (level === "off") {
        // No stage at Off: the ball drops through on its own, and the rim pings as it always has.
        const drop = ease((t - FLIGHT) / 0.12);
        if (drop < 1) drawFlightBall(ctx, g.rim, g.color, ink.markings, pt, 1 - drop, 2.5 * (1 - 0.5 * drop));
        ping(g.rim, t - FLIGHT);
      }
      break;
    case "rimOut": {
      const hit = reach * FLIGHT;
      if (t < hit) drawFlightBall(ctx, point(s), g.color, ink.markings, pt);
      else {
        const random = new SplitMix32(g.seed);
        const turn = random.sign() * 35 * (Math.PI / 180);
        const distance = random.in(8, 12) * pt;
        const u = ease((t - hit) / 0.2);
        const d0 = tangent(reach);
        const d = { x: d0.x * Math.cos(turn) - d0.y * Math.sin(turn), y: d0.x * Math.sin(turn) + d0.y * Math.cos(turn) };
        const from = point(reach);
        if (u < 1) drawFlightBall(ctx, { x: from.x + d.x * distance * u, y: from.y + d.y * distance * u }, g.color, ink.markings, pt, 1 - ramp(t, hit, hit + 0.2));
      }
      break;
    }
    case "stuffed": {
      const hit = reach * FLIGHT;
      const q = point(reach);
      const d = tangent(reach);
      if (t < hit) drawFlightBall(ctx, point(s), g.color, ink.markings, pt);
      else {
        // Knocked back the way it came.
        const u = ease((t - hit) / 0.25);
        if (u < 1) drawFlightBall(ctx, { x: q.x - d.x * 10 * pt * u, y: q.y - d.y * 10 * pt * u }, g.color, ink.markings, pt, 1 - ramp(t, hit, hit + 0.25));
        const amplitude = level === "off" ? 0 : level === "subtle" ? 1 : 2;
        tick(steps(KNOCK, t - hit) * amplitude * pt, 0.92 + 0.08 * u, u * (1 - gone));
      }
      break;
    }
    case "slam":
      if (level === "off") ping(g.rim, t);
      else if (t >= 0.12) {
        const o = ramp(t, 0.12, 0.16) * (1 - ramp(t, 0.34, 0.5));
        const shift = steps(RATTLE, t - 0.12) * (level === "subtle" ? 0.6 : 1.2) * pt;
        ctx.save();
        ctx.globalAlpha *= o;
        ctx.beginPath();
        ctx.moveTo(g.backboard[0].x + shift, g.backboard[0].y);
        ctx.lineTo(g.backboard[1].x + shift, g.backboard[1].y);
        ctx.strokeStyle = ink.label;
        ctx.globalAlpha *= 0.7;
        ctx.lineWidth = 1.5 * pt;
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.restore();
      }
      break;
  }
  standIn();
}
