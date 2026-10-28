/**
 * What the football and soccer theaters draw alike (TheaterKit.swift
 * § Figures and ball, § Type; FigureInks, TheaterDraw, TheaterType,
 * TheaterBanner/TheaterHeadline): a pictogram figure with its rim, the
 * glowing ball with its comet tail, the soft shadows, the headline and the
 * stamp and how they land, and the bursts drawn through the camera. The
 * baseball theater came first and keeps its own copies
 * (features/game/mlb/theater/drawTheater.ts) with the same constants, as on
 * the Mac; the camera half of the kit is data/theater/theaterKit.ts.
 *
 * Imperative canvas drawing, called from TheaterStage's frame loop only
 * while a replay runs (and once for a still). Type is laid out once per
 * play and size into `Block`s, drawn into each frame.
 */
import { cueDuration, drawParticles, particles, type CelebrationCue, type CelebrationPalette } from "../../../../data/celebrations";
import { TheaterBurst } from "../../../../data/theater/theaterKit";
import type { Uniform } from "../../../../data/mlb/theaterTeams";
import { criticalSpring, houseCurve, type FieldPoint, type Point } from "../../../../data/mlb/theaterField";
import { hsb, mixHex, rgba, type RGB, type TheaterInk } from "../../mlb/theater/theaterInk";

export type Ctx = CanvasRenderingContext2D;

export interface Size {
  readonly width: number;
  readonly height: number;
}

export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif';

/** SF's line box: the ascender and the whole line, as fractions of the font size (SwiftUI lays a Text out in these). */
export const ASCENT = 0.952;
export const LINE = 1.19;

export function polyline(ctx: Ctx, points: readonly Point[], close = false): void {
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  if (close) ctx.closePath();
}

export function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(rx, 0), Math.max(ry, 0), 0, 0, 2 * Math.PI);
}

// MARK: - Inks

/** The theater's chalk alpha (TheaterInk.chalk: white at 0.55 in the dark, 0.95 in the light). */
export const chalkAlpha = (ink: TheaterInk) => (ink.dark ? 0.55 : 0.95);

/** `ink.chalk.opacity(a)`. */
export const chalk = (ink: TheaterInk, a = 1) => rgba([255, 255, 255], chalkAlpha(ink) * a);

/**
 * The grass of a field marked out in lines (the gridiron, the pitch;
 * TheaterKit.swift `TheaterInk.turf`): the ballpark's tint in the dark; in
 * the light a deeper green, so white chalk has something to stand on.
 */
export const turf = (ink: TheaterInk) => (ink.dark ? ink.grass : rgba(hsb(0.37, 0.4, 0.52), 0.36));

/** Under the chalk in the light: a soft edge that keeps a white line crisp on pale grass (nothing in the dark). */
export const chalkEdge = (ink: TheaterInk): string | null => (ink.dark ? null : rgba(hsb(0.37, 0.5, 0.25), 0.16));

/** `ink.shadow.opacity(a)`. */
export const shadow = (ink: TheaterInk, a = 1) => rgba(ink.shadow, ink.shadowAlpha * a);

/** `ink.glow.opacity(a)`. */
export const glow = (ink: TheaterInk, a = 1) => rgba(ink.glow, ink.glowAlpha * a);

/** Color.primary, as the page's ink. */
export const primary = (ink: TheaterInk) => rgba(ink.primary, ink.primaryAlpha);

/** A team's type color: its accent, else the page's ink. */
export const accentOf = (u: Uniform, ink: TheaterInk) => u.accent ?? primary(ink);

// MARK: - Figures and ball

// The pictogram and its inks (FigureInks, TheaterDraw.figure) are rigFigure.ts, shared with the baseball theater.
export { drawFigure, figureInks, type FigureInks } from "./rigFigure";

/** A soft oval under a figure or the ball. */
export function drawShadow(ctx: Ctx, p: Point, r: number, color: string): void {
  ellipse(ctx, p.x, p.y, r, r * 0.32);
  ctx.fillStyle = color;
  ctx.fill();
}

/** The ball's comet tail: where it was over the last few hundredths, fading back, drawn only while it's moving fast enough to leave one. */
export function drawTrail(ctx: Ctx, points: readonly Point[], from: Point, r: number, color: RGB): void {
  const last = points[points.length - 1];
  if (!last || !(Math.hypot(last.x - from.x, last.y - from.y) > r * 3)) return;
  let previous = from;
  ctx.lineCap = "round";
  points.forEach((q, i) => {
    const u = i / points.length;
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(q.x, q.y);
    ctx.strokeStyle = rgba(color, 0.55 * (1 - u));
    ctx.lineWidth = 2 * r * (1 - u * 0.75);
    ctx.stroke();
    previous = q;
  });
}

/** The ball's glow: two soft discs round its core (`alpha` scales the ink's own). */
export function drawGlow(ctx: Ctx, p: Point, r: number, ink: TheaterInk, alpha = 1): void {
  for (const [grow, strength] of [
    [2.8, 0.1],
    [1.85, 0.22],
  ] as const) {
    ellipse(ctx, p.x, p.y, r * grow, r * grow);
    ctx.fillStyle = glow(ink, strength * alpha);
    ctx.fill();
  }
}

/** The ball: a bright core in a soft glow, with its comet tail while it's fast. */
export function drawBall(ctx: Ctx, p: Point, r: number, trail: readonly Point[], ink: TheaterInk, opacity: number): void {
  if (!(opacity > 0.01)) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  drawTrail(ctx, trail, p, r, ink.ball);
  drawGlow(ctx, p, r, ink);
  ellipse(ctx, p.x, p.y, r + 0.6, r + 0.6);
  ctx.fillStyle = ink.ballEdge;
  ctx.fill();
  ellipse(ctx, p.x, p.y, r, r);
  ctx.fillStyle = rgba(ink.ball, 1);
  ctx.fill();
  ctx.restore();
}

// MARK: - Type

/** A piece of type drawn at (0, 0) as its anchor point; `width` and `height` in points. */
export interface Block {
  readonly width: number;
  readonly height: number;
  readonly draw: (ctx: Ctx) => void;
}

const HAS_LETTER_SPACING = typeof CanvasRenderingContext2D !== "undefined" && "letterSpacing" in CanvasRenderingContext2D.prototype;
export const HAS_FONT_STRETCH = typeof CanvasRenderingContext2D !== "undefined" && "fontStretch" in CanvasRenderingContext2D.prototype;

/** Letter-spaced text: the context's `letterSpacing` where the browser has it, else character by character. */
export function fillTracked(ctx: Ctx, text: string, x: number, y: number, tracking: number): void {
  if (tracking === 0) {
    ctx.fillText(text, x, y);
    return;
  }
  if (HAS_LETTER_SPACING) {
    ctx.letterSpacing = `${tracking}px`;
    ctx.fillText(text, x, y);
    ctx.letterSpacing = "0px";
    return;
  }
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + tracking;
  }
}

export function measureTracked(ctx: Ctx, text: string, tracking: number): number {
  return ctx.measureText(text).width + tracking * [...text].length;
}

/** One run of type in a line: its text, font, color and tracking, measured. */
export interface Run {
  readonly text: string;
  readonly font: string;
  readonly color: string;
  readonly tracking: number;
  readonly size: number;
  readonly width: number;
}

export function run(ctx: Ctx, text: string, font: string, size: number, color: string, tracking = 0): Run {
  ctx.font = font;
  return { text, font, color, tracking, size, width: measureTracked(ctx, text, tracking) };
}

/** Runs side by side on their first text baseline (SwiftUI's HStack(alignment: .firstTextBaseline)), from x on `baseline`. */
export function drawRuns(ctx: Ctx, runs: readonly Run[], x: number, baseline: number, spacing: number): void {
  let cursor = x;
  for (const r of runs) {
    ctx.font = r.font;
    ctx.fillStyle = r.color;
    fillTracked(ctx, r.text, cursor, baseline, r.tracking);
    cursor += r.width + spacing;
  }
}

export const runsWidth = (runs: readonly Run[], spacing: number) => runs.reduce((sum, r) => sum + r.width, 0) + spacing * Math.max(runs.length - 1, 0);

/** The headline and the stamp: how big, where (TheaterType). Sizes in CSS px; `pt` is one Mac point. */
export const TheaterType = {
  /** Type sizes from the well's height: big where there's room. */
  height: (size: Size) => Math.max(size.height, 120),
  inset: (size: Size) => Math.max(size.height * 0.055, 9),
  banner: (size: Size, pt: number) => Math.min(Math.max(TheaterType.height(size) * 0.13, 17 * pt), 40 * pt),
  /**
   * The headline's size for its words: stepped down for a long one in a
   * narrow well (TURNOVER ON DOWNS in the compact panel), so it never runs off
   * the sides. (Wide heavy capitals and their tracking about 0.92 of the size
   * each; the rules either side about 3.1.)
   */
  bannerFitting: (size: Size, pt: number, text: string) => Math.min(TheaterType.banner(size, pt), (size.width * 0.92) / (0.92 * [...text].length + 3.1)),
  stamp: (size: Size, pt: number) => Math.min(Math.max(TheaterType.height(size) * 0.2, 24 * pt), 54 * pt),
  title: (size: Size, pt: number) => Math.min(Math.max(TheaterType.height(size) * 0.056, 8 * pt), 14 * pt),

  /** Where the banner's burst comes from: under the headline. */
  bannerOrigin(size: Size, pt: number): Point {
    return { x: size.width / 2, y: TheaterType.inset(size) * 0.7 + TheaterType.banner(size, pt) * 0.6 };
  },

  /** A quick, critically damped spring: no bounce. */
  land(x: number): number {
    return x >= 1 ? 1 : Math.min(criticalSpring(0.32, x), 1);
  },

  /** The headline across the top: wiped open from the middle as it drops in, held, then lifted away. */
  drawBanner(ctx: Ctx, block: Block, start: number, end: number, t: number, size: Size): void {
    if (!(t >= start && t < end + 0.3)) return;
    const x = t - start;
    const v = TheaterType.land(x);
    const out = Math.min(Math.max((t - end) / 0.28, 0), 1);
    const open = houseCurve(Math.min(x / 0.3, 1));
    const w = block.width;
    const cx = size.width / 2;
    const cy = TheaterType.inset(size) * 0.7 + block.height / 2 + (1 - v) * -8 - out * 5;
    ctx.save();
    ctx.globalAlpha = Math.min(x / 0.12, 1) * (1 - out);
    ctx.beginPath();
    ctx.rect(cx - (w / 2) * open - 2, 0, w * open + 4, size.height);
    ctx.clip();
    ctx.translate(cx, cy);
    block.draw(ctx);
    ctx.restore();
  },

  /**
   * The stamp, low on the left (or the right) as the play resolves: in from
   * larger on a quick spring that never bounces, never from nothing. The
   * block is anchored at its bottom-leading corner (bottom-trailing on the
   * right).
   */
  drawStamp(ctx: Ctx, block: Block, start: number, t: number, size: Size, grow = 0.28, right = false): void {
    if (!(t >= start)) return;
    const x = t - start;
    const v = TheaterType.land(x);
    const scale = 1 + grow - grow * v;
    const inset = TheaterType.inset(size);
    ctx.save();
    ctx.globalAlpha = Math.min(x / 0.1, 1);
    ctx.translate(right ? size.width - inset : inset, size.height - inset * 0.8);
    ctx.scale(scale, scale);
    block.draw(ctx);
    ctx.restore();
  },
};

/** The headline (TheaterBanner, TheaterHeadline): heavy, wide capitals between two short rules, in the play's color. Anchored at its center. */
export function bannerBlock(ctx: Ctx, text: string, color: string, s: number): Block {
  ctx.save();
  const font = `900 ${s}px ${FONT}`;
  ctx.font = font;
  const expanded = HAS_FONT_STRETCH;
  if (expanded) ctx.fontStretch = "expanded";
  const tracking = s * 0.06;
  const textWidth = measureTracked(ctx, text, tracking) - tracking;
  if (expanded) ctx.fontStretch = "normal";
  ctx.restore();
  const rule = { w: s * 1.1, h: Math.max(s * 0.07, 1.5) };
  const gap = s * 0.45;
  const width = rule.w * 2 + gap * 2 + textWidth;
  const height = s * LINE;
  return {
    width,
    height,
    draw: (c) => {
      c.fillStyle = color;
      const saved = c.globalAlpha;
      c.globalAlpha = saved * 0.65;
      c.beginPath();
      c.roundRect(-width / 2, -rule.h / 2, rule.w, rule.h, rule.h / 2);
      c.roundRect(width / 2 - rule.w, -rule.h / 2, rule.w, rule.h, rule.h / 2);
      c.fill();
      c.globalAlpha = saved;
      c.font = font;
      if (expanded) c.fontStretch = "expanded";
      c.textBaseline = "alphabetic";
      fillTracked(c, text, -width / 2 + rule.w + gap, s * 0.36, tracking);
      if (expanded) c.fontStretch = "normal";
    },
  };
}

// MARK: - Bursts

/** A burst on a theater's stage: a cue mounted at a script time, anchored on the field (through the camera) or under the headline. */
export interface StageBurst {
  readonly cue: CelebrationCue;
  readonly at: number;
  readonly anchor: { readonly kind: "field"; readonly point: FieldPoint } | { readonly kind: "banner" };
  readonly scale: number;
}

export const stageBurstEnd = (b: StageBurst) => b.at + cueDuration(b.cue);

/**
 * The theater's bursts at t, drawn through the camera (`project`) so a
 * firework stays over the goal line as the camera moves: moved in from the
 * well's edges, and spread by their scale with their strokes kept fine
 * (TheaterBurst).
 */
export function drawBursts(
  ctx: Ctx,
  bursts: readonly StageBurst[],
  t: number,
  project: (p: FieldPoint) => Point,
  bannerOrigin: Point,
  palette: (b: StageBurst) => CelebrationPalette,
  size: Size,
): void {
  for (const burst of bursts) {
    if (!(t >= burst.at && t <= stageBurstEnd(burst))) continue;
    const origin = burst.anchor.kind === "field" ? TheaterBurst.inside(project(burst.anchor.point), size) : bannerOrigin;
    ctx.save();
    ctx.translate(origin.x, origin.y);
    drawParticles(ctx, TheaterBurst.spread(particles(burst.cue, { x: 0, y: 0 }, t - burst.at), burst.scale), palette(burst));
    ctx.restore();
  }
}

/** A team's celebration palette (CelebrationColors.team): its color, a tint of it, the page's ink for the rest. */
export function teamPalette(color: string, ink: TheaterInk): CelebrationPalette {
  const hex = color.startsWith("#") ? color : ink.accent;
  return {
    primary: hex,
    tint: mixHex(hex, "#ffffff", 0.4),
    neutral: rgba(ink.primary, 0.55),
    gold: ink.yellow,
    glint: rgba(ink.primary, 0.8),
    edge: rgba(ink.primary, 0.5),
  };
}
