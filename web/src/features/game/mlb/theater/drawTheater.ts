/**
 * The play theater, drawn (PlayTheater.swift `FieldProjection`,
 * `BallparkLayer`, `PlayFrame`, `TheaterCelebration`): the dimetric view of
 * the field from behind home plate through the broadcast camera, then one
 * frame of the play: the ball's trace and shadow, the figures far to near,
 * the ball, the beats, the pitch's label, the headline and the scorer's
 * mark. Everything is projected through the camera, so lines stay crisp at
 * any zoom; nothing is a scaled bitmap.
 *
 * Imperative canvas drawing, called from the component's rAF loop only while
 * a replay runs (and once for a still). No allocation-heavy work per frame
 * beyond the paths themselves; type is laid out once per play and size
 * (`layoutLabels`).
 */
import { drawParticles, particles, type CelebrationPalette } from "../../../../data/celebrations";
import { CameraFrame } from "../../../../data/mlb/playCamera";
import { PITCH_NAMES, type Hand, type PlayScene } from "../../../../data/mlb/playScene";
import { STAMP_MARKS, type Actor, type PlayScript } from "../../../../data/mlb/playScript";
import { burstEnd, type TheaterBurst } from "../../../../data/mlb/theaterCelebration";
import { Ballpark, easeValue, houseCurve, criticalSpring, ORIGIN, smooth, type FieldPoint, type Point } from "../../../../data/mlb/theaterField";
import { facing, figure as poseFigure, mixPose, Poses, samePose, type Figure, type Pose } from "../../../../data/mlb/theaterPose";
import type { TheaterTeams, Uniform } from "../../../../data/mlb/theaterTeams";
import { luminance } from "../../../../data/teamColors";
import { hexRGB, mixHex, rgba, type TheaterInk } from "./theaterInk";

export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * The dimetric (2:1) view of the field from behind home plate, through the
 * camera: the ground squashed to half height, heights at 0.82, the camera's
 * framing filling the view.
 */
export class FieldProjection {
  readonly size: Size;
  readonly camera: CameraFrame;
  /** Points per foot. */
  readonly scale: number;
  /** A standing figure's height in points: larger than life, growing with the zoom, never a speck, never a giant. */
  readonly figure: number;

  constructor(size: Size, camera: CameraFrame) {
    this.size = size;
    this.camera = camera;
    this.scale = Math.max(Math.min(size.height / camera.span, size.width / (camera.span * CameraFrame.aspect)), 0.05);
    this.figure = Math.min(Math.max(8.5 * this.scale, Math.max(10, size.height * 0.07)), Math.max(size.height * 0.18, 10));
  }

  point(p: Point, z = 0): Point {
    const { size, camera, scale } = this;
    return { x: size.width / 2 + (p.x - camera.x) * scale, y: size.height / 2 - (p.y * 0.5 + z * 0.82 - camera.y) * scale };
  }

  at(p: FieldPoint): Point {
    return this.point(p, p.z);
  }
}

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif';

type Ctx = CanvasRenderingContext2D;

function polyline(ctx: Ctx, points: readonly Point[], close = false): void {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  if (close) ctx.closePath();
}

function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(rx, 0), Math.max(ry, 0), 0, 0, 2 * Math.PI);
}

// MARK: - Field

const BEARINGS = Array.from({ length: 49 }, (_, i) => -Math.PI / 4 + (i / 48) * (Math.PI / 2));
const fenceLine = (inset: number) => BEARINGS.map((b) => Ballpark.polar(Ballpark.fence(b) - inset, (b * 180) / Math.PI));
const FENCE = fenceLine(0);
const FENCE_15 = fenceLine(15);
const STANDS_FRONT = fenceLine(-6);
const STANDS_BACK = fenceLine(-70).reverse();
const ROWS = [22, 35, 48, 61].map((row) => ({ row, line: fenceLine(-row) }));
/** The infield's clay reaches 95 ft round the rubber, between the lines. */
const SKIN: Point[] = (() => {
  const c = Ballpark.rubber;
  const r = Ballpark.skin;
  const along = c.y / Math.SQRT2;
  const t = along + Math.sqrt(along * along - (c.y * c.y - r * r));
  const corner = t / Math.SQRT2;
  const from = Math.atan2(corner - c.y, corner);
  const to = Math.PI - from;
  const arc = Array.from({ length: 33 }, (_, i) => {
    const a = from + (i / 32) * (to - from);
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
  return [ORIGIN, ...arc];
})();

/**
 * The field itself: grass, the infield's clay and grass, the mound, the foul
 * lines and boxes, the bases, the warning track, the wall with its poles and
 * the first rows behind it.
 */
export function drawField(ctx: Ctx, f: FieldProjection, ink: TheaterInk): void {
  const project = (points: readonly Point[], z = 0) => points.map((p) => f.point(p, z));
  const fillPolygon = (points: readonly Point[], color: string) => {
    polyline(ctx, project(points), true);
    ctx.fillStyle = color;
    ctx.fill();
  };
  const fillCircle = (center: Point, r: number, color: string) => {
    const c = f.point(center);
    ellipse(ctx, c.x, c.y, r * f.scale, (r * f.scale) / 2);
    ctx.fillStyle = color;
    ctx.fill();
  };
  // Chalk thickens a little as the camera closes in.
  const line = Math.min(Math.max(0.75, f.scale * 0.3), 1.6);
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";

  // The first rows behind the wall, rising: where a home run lands.
  polyline(ctx, [...project(STANDS_FRONT, Ballpark.wallHeight + 2), ...project(STANDS_BACK, 44)], true);
  ctx.fillStyle = ink.stands;
  ctx.fill();
  ctx.beginPath();
  for (const { row, line: rowLine } of ROWS) {
    project(rowLine, Ballpark.wallHeight + 2 + (row - 6) * 0.5).forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  }
  ctx.strokeStyle = ink.stands;
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // Fair territory, mowed in a checkerboard (the outfield grass only), and the warning track inside the fence.
  fillPolygon([ORIGIN, ...FENCE], ink.grass);
  ctx.save();
  const outfield = new Path2D();
  project([...FENCE_15, ORIGIN]).forEach((p, i) => (i === 0 ? outfield.moveTo(p.x, p.y) : outfield.lineTo(p.x, p.y)));
  outfield.closePath();
  project(SKIN).forEach((p, i) => (i === 0 ? outfield.moveTo(p.x, p.y) : outfield.lineTo(p.x, p.y)));
  outfield.closePath();
  ctx.clip(outfield, "evenodd");
  // Bands along each baseline, every other one lighter; where they cross, lighter still.
  const band = 26 * Math.SQRT2;
  ctx.fillStyle = ink.mow;
  for (const slope of [1, -1]) {
    ctx.beginPath();
    for (let i = 0; i <= 16; i += 2) {
      const low = i * band;
      const high = low + band;
      const corners = project([
        { x: -300, y: -300 * slope + low },
        { x: 300, y: 300 * slope + low },
        { x: 300, y: 300 * slope + high },
        { x: -300, y: -300 * slope + high },
      ]);
      corners.forEach((p, j) => (j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
    }
    ctx.fill();
  }
  ctx.restore();
  fillPolygon([...FENCE, ...[...FENCE_15].reverse()], ink.track);

  fillPolygon(SKIN, ink.dirt);
  // The infield grass, inside the base paths.
  const d = Ballpark.baseline / Math.SQRT2;
  const inset = 3 * Math.SQRT2;
  fillPolygon(
    [
      { x: 0, y: inset },
      { x: d - inset, y: d },
      { x: 0, y: 2 * d - inset },
      { x: -(d - inset), y: d },
    ],
    ink.infield,
  );
  // Cutouts round the bases (inside the lines: foul ground stays the well's), the circle round home, and the mound.
  ctx.save();
  polyline(ctx, project([ORIGIN, ...FENCE]), true);
  ctx.clip();
  for (let base = 1; base <= 3; base++) fillCircle(Ballpark.base(base), 11, ink.dirt);
  ctx.restore();
  fillCircle(ORIGIN, 13, ink.dirt);
  fillCircle({ x: 0, y: 59 }, 9, ink.dirt);

  // Foul lines to the poles.
  ctx.beginPath();
  for (const side of [-45, 45]) {
    const a = f.point(ORIGIN);
    const b = f.point(Ballpark.polar(Ballpark.fence((side * Math.PI) / 180), side));
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.strokeStyle = ink.chalk;
  ctx.lineWidth = line;
  ctx.stroke();
  // The batter's and catcher's boxes, where there's room to see them.
  if (f.scale >= 0.9) {
    const center = f.point(ORIGIN);
    const at = (x: number, y: number) => ({ x: center.x + x * f.scale, y: center.y - (y * f.scale) / 2 });
    ctx.beginPath();
    for (const x of [-4.7, 0.7]) {
      const corners = [at(x, -3), at(x + 4, -3), at(x + 4, 3), at(x, 3)];
      corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
    }
    [at(-1.75, -3), at(-1.75, -10), at(1.75, -10), at(1.75, -3)].forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = ink.chalkBoxes;
    ctx.lineWidth = line * 0.7;
    ctx.stroke();
  }

  // The wall: its face, its top, and the poles.
  polyline(ctx, [...project(FENCE), ...project([...FENCE].reverse(), Ballpark.wallHeight)], true);
  ctx.fillStyle = ink.wall;
  ctx.fill();
  polyline(ctx, project(FENCE, Ballpark.wallHeight));
  ctx.strokeStyle = ink.wallTop;
  ctx.lineWidth = line;
  ctx.stroke();
  ctx.beginPath();
  for (const p of [FENCE[0]!, FENCE[FENCE.length - 1]!]) {
    const a = f.point(p);
    const b = f.point(p, 42);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.strokeStyle = ink.pole;
  ctx.lineWidth = line + 0.25;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.lineCap = "butt";

  // Bases, the rubber and home plate, a little larger than life (and never specks).
  ctx.fillStyle = ink.chalk;
  const bag = Math.max(1.1 * f.scale, 2.4);
  for (let base = 1; base <= 3; base++) {
    const p = f.point(Ballpark.base(base));
    polyline(
      ctx,
      [
        { x: p.x - bag, y: p.y },
        { x: p.x, y: p.y - bag / 2 },
        { x: p.x + bag, y: p.y },
        { x: p.x, y: p.y + bag / 2 },
      ],
      true,
    );
    ctx.fill();
  }
  const rubber = f.point(Ballpark.rubber);
  const rw = Math.max(1.3 * f.scale, 1.2);
  ctx.fillRect(rubber.x - rw, rubber.y - rw / 8, 2 * rw, rw / 4);
  const h = f.point(ORIGIN);
  const pw = Math.max(1.15 * f.scale, 2);
  polyline(
    ctx,
    [
      { x: h.x - pw, y: h.y - pw * 0.4 },
      { x: h.x + pw, y: h.y - pw * 0.4 },
      { x: h.x + pw, y: h.y },
      { x: h.x, y: h.y + pw * 0.5 },
      { x: h.x - pw, y: h.y },
    ],
    true,
  );
  ctx.fill();
}

// MARK: - Labels (laid out once per play and size)

export interface Labels {
  readonly pitch: Block | null;
  readonly stamp: Block | null;
  readonly banner: Block | null;
}

/** A piece of type drawn at (0, 0) as its anchor point; `width` and `height` in points. */
export interface Block {
  readonly width: number;
  readonly height: number;
  readonly draw: (ctx: Ctx) => void;
}

const HAS_LETTER_SPACING = typeof CanvasRenderingContext2D !== "undefined" && "letterSpacing" in CanvasRenderingContext2D.prototype;

/** Letter-spaced text: the context's `letterSpacing` where the browser has it, else character by character. */
function fillTracked(ctx: Ctx, text: string, x: number, y: number, tracking: number): void {
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

function measureTracked(ctx: Ctx, text: string, tracking: number): number {
  return ctx.measureText(text).width + tracking * [...text].length;
}

const HAS_FONT_STRETCH = typeof CanvasRenderingContext2D !== "undefined" && "fontStretch" in CanvasRenderingContext2D.prototype;

/** Text or glyph color that stays legible on a filled mark (Viz.ink(on:)). */
const inkOn = (hex: string) => (luminance(hex) > 0.6 ? "rgb(0 0 0 / 0.8)" : "#fff");

export interface LabelInputs {
  readonly scene: PlayScene | null;
  readonly script: PlayScript;
  readonly teams: TheaterTeams;
  readonly ink: TheaterInk;
  readonly size: Size;
  /** One Mac point in CSS pixels. */
  readonly pt: number;
  /** Statcast's batted-ball line ("104.4 MPH · 12° · 273 FT"), when the play found its at-bat. */
  readonly statcast: string | null;
}

const accentOf = (u: Uniform, ink: TheaterInk) => u.accent ?? rgba(ink.primary, ink.primaryAlpha);

/** The color a play's type takes: hits and reaching base in the batting team's color, a home run gold, a strikeout red, outs neutral. */
function tone(scene: PlayScene | null, teams: TheaterTeams, ink: TheaterInk): string {
  if (!scene) return rgba(ink.primary, ink.primaryAlpha);
  switch (scene.kind.type) {
    case "homeRun":
      return ink.gold;
    case "strikeout":
      return rgba(ink.red, 1);
    case "single":
    case "double":
    case "triple":
    case "walk":
    case "hitByPitch":
    case "error":
    case "stolenBase":
    case "wildPitch":
    case "passedBall":
    case "balk":
    case "indifference":
      return accentOf(teams.batting, ink);
    default:
      return rgba(ink.primary, ink.primaryAlpha);
  }
}

export function layoutLabels(ctx: Ctx, input: LabelInputs): Labels {
  const { scene, script, teams, ink, size, pt, statcast } = input;
  // Type sizes from the well's height: big where there's room.
  const typeHeight = Math.max(size.height, 120);
  const primary = rgba(ink.primary, ink.primaryAlpha);
  ctx.save();
  ctx.textBaseline = "alphabetic";

  // The pitch: its name and speed, low in the foul ground on the right, across from the stamp.
  let pitch: Block | null = null;
  const p = scene?.pitch;
  if (p && (p.mph != null || p.code != null)) {
    const name = (p.code != null ? PITCH_NAMES[p.code] : undefined) ?? p.name ?? p.code ?? "";
    const fs = Math.min(Math.max(typeHeight * 0.068, 9.5 * pt), 15 * pt);
    const parts: [string, string, string][] = [
      [name, `500 ${fs}px ${FONT}`, ink.secondary],
      [p.mph != null ? `  ${p.mph}` : "", `600 ${fs}px ${FONT}`, primary],
      [p.mph != null ? " mph" : "", `500 ${fs}px ${FONT}`, ink.secondary],
    ];
    const widths = parts.map(([text, font]) => {
      ctx.font = font;
      return ctx.measureText(text).width;
    });
    const width = widths.reduce((a, b) => a + b, 0);
    pitch = {
      width,
      height: fs * 1.2,
      // Anchored bottom-trailing.
      draw: (c) => {
        let x = -width;
        parts.forEach(([text, font, color], i) => {
          c.font = font;
          c.fillStyle = color;
          c.fillText(text, x, -fs * 0.25);
          x += widths[i]!;
        });
      },
    };
  }

  // The scorer's mark: the code big and bold ("6–3", a backwards K) in the
  // play's color, runs in a pill in the batting team's color, the play in
  // small capitals under it, and (web) Statcast's line under that.
  let stamp: Block | null = null;
  if (scene && scene.notation.code !== "") {
    const s = Math.min(Math.max(typeHeight * 0.2, 24 * pt), 54 * pt);
    const color = tone(scene, teams, ink);
    const segments = scene.notation.code
      .split(" ")
      .filter((x) => x !== "")
      .map((part, i) => {
        const bold = /\d/.test(part) || STAMP_MARKS.has(part);
        const text = (i > 0 ? " " : "") + part.replaceAll("-", "–");
        const font = bold ? `800 ${s}px ${FONT}` : `700 ${s * 0.5}px ${FONT}`;
        ctx.font = font;
        return { text, font, color: bold ? color : ink.secondary, width: measureTracked(ctx, text, -0.5 * pt) };
      });
    const codeWidth = segments.reduce((a, x) => a + x.width, 0);
    let pill: { text: string; font: string; width: number; height: number } | null = null;
    if (scene.runs > 0) {
      const font = `900 ${s * 0.46}px ${FONT}`;
      ctx.font = font;
      const text = `+${scene.runs}`;
      pill = { text, font, width: ctx.measureText(text).width + s * 0.32, height: s * 0.46 * 1.15 + s * 0.08 };
    }
    const showDistance = scene.kind.type === "homeRun" && scene.distance != null && statcast == null;
    const title = [scene.title, showDistance ? `${scene.distance} ft` : null].filter(Boolean).join(" · ").toUpperCase();
    // A long title ("DEFENSIVE INDIFFERENCE") steps down rather than reach across the field.
    const tf = Math.min(Math.min(Math.max(typeHeight * 0.056, 8 * pt), 14 * pt), (size.width * 0.34) / Math.max(title.length * 0.72, 1));
    const titleFont = `700 ${tf}px ${FONT}`;
    ctx.font = titleFont;
    const titleWidth = measureTracked(ctx, title, 1 * pt);
    const lf = tf * 0.92;
    const lineFont = `600 ${lf}px ${FONT}`;
    ctx.font = lineFont;
    const lineWidth = statcast ? measureTracked(ctx, statcast, 0.5 * pt) : 0;
    const codeBox = s * 1.08;
    const titleBox = tf * 1.25;
    const lineBox = statcast ? lf * 1.45 : 0;
    const accent = accentOf(teams.batting, ink);
    const pillGap = s * 0.18;
    const width = Math.max(codeWidth + (pill ? pillGap + pill.width : 0), titleWidth, lineWidth);
    const height = codeBox + titleBox + lineBox;
    stamp = {
      width,
      height,
      // Anchored bottom-leading.
      draw: (c) => {
        const top = -height;
        const baseline = top + s * 0.86;
        c.save();
        if (scene.notation.backwards) {
          // A called third strike: the K turned round.
          c.translate(codeWidth / 2, 0);
          c.scale(-1, 1);
          c.translate(-codeWidth / 2, 0);
        }
        let x = 0;
        for (const seg of segments) {
          c.font = seg.font;
          c.fillStyle = seg.color;
          fillTracked(c, seg.text, x, baseline, -0.5 * pt);
          x += seg.width;
        }
        c.restore();
        if (pill) {
          const px = codeWidth + pillGap;
          const bottom = baseline + s * 0.08;
          c.fillStyle = accent;
          c.beginPath();
          c.roundRect(px, bottom - pill.height, pill.width, pill.height, pill.height / 2);
          c.fill();
          c.font = pill.font;
          c.fillStyle = teams.batting.accent ? inkOn(teams.batting.accent) : ink.dark ? "#000" : "#fff";
          c.textAlign = "center";
          c.fillText(pill.text, px + pill.width / 2, bottom - s * 0.04 - s * 0.46 * 0.2);
          c.textAlign = "left";
        }
        c.font = titleFont;
        c.fillStyle = ink.secondary;
        fillTracked(c, title, 0, top + codeBox + tf * 0.95, 1 * pt);
        if (statcast) {
          c.font = lineFont;
          c.fillStyle = ink.secondary;
          fillTracked(c, statcast, 0, top + codeBox + titleBox + lf * 1.1, 0.5 * pt);
        }
      },
    };
  }

  // The headline: heavy, wide capitals between two short rules, in the
  // play's color (a hit the batting team's, a grand slam or walk-off gold, a
  // strikeout red, a double play neutral).
  let banner: Block | null = null;
  const b = script.banner;
  if (b) {
    const s = Math.min(Math.max(typeHeight * 0.13, 17 * pt), 40 * pt);
    const color = b.tone === "hit" ? accentOf(teams.batting, ink) : b.tone === "gold" ? ink.gold : b.tone === "out" ? primary : rgba(ink.red, 1);
    const font = `900 ${s}px ${FONT}`;
    ctx.font = font;
    const expanded = HAS_FONT_STRETCH;
    if (expanded) ctx.fontStretch = "expanded";
    const tracking = s * 0.06;
    const textWidth = measureTracked(ctx, b.text, tracking) - tracking;
    if (expanded) ctx.fontStretch = "normal";
    const rule = { w: s * 1.1, h: Math.max(s * 0.07, 1.5) };
    const gap = s * 0.45;
    const width = rule.w * 2 + gap * 2 + textWidth;
    const height = s * 1.19;
    banner = {
      width,
      height,
      // Anchored at its center.
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
        fillTracked(c, b.text, -width / 2 + rule.w + gap, s * 0.36, tracking);
        if (expanded) c.fontStretch = "normal";
      },
    };
  }
  ctx.restore();
  return { pitch, stamp, banner };
}

// MARK: - A frame of the play

export interface FrameInputs {
  readonly scene: PlayScene | null;
  readonly script: PlayScript;
  readonly t: number;
  readonly teams: TheaterTeams;
  readonly ink: TheaterInk;
  readonly labels: Labels;
}

interface TeamInks {
  readonly rim: string;
  readonly inner: string;
  readonly far: string;
  readonly jersey: string;
  readonly cap: string;
}

const inkCache = new WeakMap<Uniform, Map<string, TeamInks>>();

/** Each team's inks, resolved once per uniform and scheme: resolving a team color per stroke was most of a frame's cost. */
function teamInks(u: Uniform, ink: TheaterInk): TeamInks {
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
  const made: TeamInks = { rim, inner, far: mixHex(u.jersey, "#000000", ink.dark ? 0.32 : 0.22), jersey: u.jersey, cap: u.cap };
  byScheme.set(key, made);
  return made;
}

export function drawFrame(ctx: Ctx, f: FieldProjection, input: FrameInputs): void {
  drawTrace(ctx, f, input);
  drawPuffs(ctx, f, input);
  drawShadows(ctx, f, input);
  drawFigures(ctx, f, input);
  drawBall(ctx, f, input);
  drawFlashes(ctx, f, input);
  drawLabels(ctx, f, input);
}

/** The ball's path: bright behind the ball, settling to a faint record of where it went; and where it came down. */
function drawTrace(ctx: Ctx, f: FieldProjection, { script, t, teams, ink }: FrameInputs): void {
  if (script.batted == null) return;
  const flight = script.flights[script.batted];
  if (!flight || !(t > flight.start)) return;
  const end = Math.min(t, flight.end);
  const samples = 40;
  const points: Point[] = [];
  for (let i = 0; i <= samples; i++) points.push(f.at(flight.point(flight.start + ((end - flight.start) * i) / samples)));
  const after = t - flight.end;
  const strength = (after <= 0 ? 0.75 : Math.max(0.75 - (after / 0.6) * 0.45, 0.3)) - (t > script.settle ? Math.min((t - script.settle) / 0.8, 1) * 0.1 : 0);
  polyline(ctx, points);
  if (t > script.settle + 0.8) {
    // At rest, a plain faint line: the static scene must be the same every time.
    ctx.strokeStyle = rgba(ink.trace, strength * 0.5);
  } else {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const gradient = ctx.createLinearGradient(first.x, first.y, last.x, last.y);
    gradient.addColorStop(0, rgba(ink.trace, strength * 0.15));
    gradient.addColorStop(1, rgba(ink.trace, strength));
    ctx.strokeStyle = gradient;
  }
  ctx.lineWidth = Math.min(Math.max(f.figure * 0.07, 0.9), 2);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();

  // Where it came down: the spray chart's marks (filled, a ring, a ringed dot).
  const landing = script.landing;
  if (!landing || !(t >= landing.at)) return;
  const p = f.point(landing.point);
  const grow = Math.min((t - landing.at) / 0.2, 1);
  const r = Math.max(f.figure * 0.16, 2.6) * (0.6 + 0.4 * grow);
  const color = accentOf(teams.batting, ink);
  ellipse(ctx, p.x, p.y, r, r / 2);
  switch (landing.mark) {
    case "out":
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    case "hit":
      ctx.fillStyle = color;
      ctx.fill();
      break;
    case "homeRun":
      ctx.fillStyle = color;
      ctx.fill();
      ellipse(ctx, p.x, p.y, r + 1.5, r / 2 + 0.75);
      ctx.strokeStyle = rgba(ink.primary, ink.primaryAlpha);
      ctx.lineWidth = 0.8;
      ctx.stroke();
      break;
  }
}

/** Dust where a grounder touches down between hops. */
function drawPuffs(ctx: Ctx, f: FieldProjection, { script, t, ink }: FrameInputs): void {
  for (const puff of script.puffs) {
    const age = t - puff.at;
    if (!(age >= 0 && age < 0.45)) continue;
    const u = age / 0.45;
    const c = f.point(puff.point);
    const grow = 1 - (1 - u) ** 3;
    const unit = Math.max(f.scale, 0.8);
    ctx.fillStyle = rgba(ink.dust, 0.55 * (1 - u));
    for (const [dx, dy, size] of [
      [-1.3, 0.2, 1.0],
      [1.2, 0.5, 0.85],
      [0.1, -0.5, 1.15],
    ] as const) {
      const r = (0.8 + 1.8 * grow) * size * unit;
      ellipse(ctx, c.x + dx * unit * (0.5 + grow), c.y + dy * unit * 0.5 - grow * 1.2 * unit, r, r * 0.6);
      ctx.fill();
    }
  }
}

function drawShadows(ctx: Ctx, f: FieldProjection, { script, t, ink }: FrameInputs): void {
  const w = f.figure * 0.3;
  for (const actor of script.actors) {
    const o = actor.opacity(t);
    if (!(o > 0.01)) continue;
    const p = f.point(actor.position(t));
    ellipse(ctx, p.x, p.y, w, w * 0.32);
    ctx.fillStyle = rgba(ink.shadow, ink.shadowAlpha * o);
    ctx.fill();
  }
  // The ball's: under it on the ground, larger and softer the higher it
  // flies, with a hairline up to the ball once it's well off the grass.
  const ball = script.ball(t);
  if (ball && ball.z > 0.3) {
    const o = script.ballOpacity(t);
    const g = f.point({ x: ball.x, y: ball.y });
    const spread = 1 + Math.min(ball.z / 50, 1.4);
    const r = Math.max(0.55 * f.scale, 1.6) * spread;
    const strength = 1.6 / (1 + ball.z / 40);
    ellipse(ctx, g.x, g.y, r, r / 2);
    ctx.fillStyle = rgba(ink.shadow, ink.shadowAlpha * Math.min(strength, 1) * o);
    ctx.fill();
    if (ball.z > 6) {
      const top = f.at(ball);
      ctx.beginPath();
      ctx.moveTo(g.x, g.y);
      ctx.lineTo(top.x, top.y);
      ctx.strokeStyle = rgba(ink.trace, 0.16 * Math.min((ball.z - 6) / 10, 1) * o);
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }
}

function limbs(ctx: Ctx, fig: Figure, which: "near" | "far"): void {
  const l = fig[which];
  ctx.moveTo(fig.hip.x, fig.hip.y);
  ctx.lineTo(l.knee.x, l.knee.y);
  ctx.lineTo(l.foot.x, l.foot.y);
  ctx.moveTo(fig.neck.x, fig.neck.y);
  ctx.lineTo(l.elbow.x, l.elbow.y);
  ctx.lineTo(l.hand.x, l.hand.y);
}

function drawFigures(ctx: Ctx, f: FieldProjection, input: FrameInputs): void {
  const { script, t, teams, ink } = input;
  const height = f.figure;
  const batting = teamInks(teams.batting, ink);
  const fielding = teamInks(teams.fielding, ink);
  // Far to near: a figure in front covers the one behind.
  const order = script.actors.map((actor, index) => ({ actor, index, at: actor.position(t) })).sort((a, b) => b.at.y - a.at.y);
  // Small figures lose their inner rim: it would only blur them.
  const rimmed = height >= 15;
  const halo = Math.max(height * 0.045, 0.8);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const { actor, index, at } of order) {
    const o = actor.opacity(t);
    if (!(o > 0.01)) continue;
    const fig = poseFigure(pose(input, actor, index), f.point(at), height);
    const team = actor.team === "batting" ? batting : fielding;
    ctx.globalAlpha = o;
    // The rim first, so lines and figures behind stop short of this one.
    ctx.strokeStyle = team.rim;
    ctx.beginPath();
    limbs(ctx, fig, "far");
    limbs(ctx, fig, "near");
    ctx.lineWidth = fig.limb + 2 * halo;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(fig.hip.x, fig.hip.y);
    ctx.lineTo(fig.neck.x, fig.neck.y);
    ctx.lineWidth = fig.torso + 2 * halo;
    ctx.stroke();
    ctx.fillStyle = team.rim;
    ellipse(ctx, fig.head.x, fig.head.y, fig.headRadius + halo, fig.headRadius + halo);
    ctx.fill();
    if (actor.bats && actor.dropsBat != null && t >= actor.dropsBat) {
      ctx.globalAlpha = 1;
      drawDroppedBat(ctx, f.point(Ballpark.box(actor.bats)), actor.bats, 1 - Math.min(Math.max((t - script.settle) / 0.4, 0), 1), f, ink);
      ctx.globalAlpha = o;
    }
    ctx.strokeStyle = team.far;
    ctx.lineWidth = fig.limb;
    ctx.beginPath();
    limbs(ctx, fig, "far");
    ctx.stroke();
    ctx.strokeStyle = team.jersey;
    ctx.lineWidth = fig.torso;
    ctx.beginPath();
    ctx.moveTo(fig.hip.x, fig.hip.y);
    ctx.lineTo(fig.neck.x, fig.neck.y);
    ctx.stroke();
    if (rimmed) {
      ctx.strokeStyle = team.inner;
      ctx.lineWidth = fig.limb + 1.2;
      ctx.beginPath();
      limbs(ctx, fig, "near");
      ctx.stroke();
    }
    ctx.strokeStyle = team.jersey;
    ctx.lineWidth = fig.limb;
    ctx.beginPath();
    limbs(ctx, fig, "near");
    ctx.stroke();
    ctx.fillStyle = team.cap;
    ellipse(ctx, fig.head.x, fig.head.y, fig.headRadius, fig.headRadius);
    ctx.fill();
    if (actor.bats && (actor.dropsBat == null || t < actor.dropsBat)) {
      drawBat(ctx, t, actor.bats, fig.near.hand, actor.swing, height * 0.62, team.rim, ink);
    }
  }
  ctx.globalAlpha = 1;
}

const PITCHER_KEYS: readonly (readonly [number, Pose])[] = [
  [-0.55, Poses.ready],
  [-0.42, Poses.set],
  [-0.24, Poses.kick],
  [-0.08, Poses.stride],
  [0, Poses.deliver],
  [0.16, Poses.follow],
  [0.7, Poses.ready],
];

/**
 * The pose at t: what he's doing (the delivery, a swing, a catch, a throw),
 * else how he's moving (running, walking, sliding), else how he stands for
 * his position.
 */
function pose({ script, t }: FrameInputs, actor: Actor, index: number): Pose {
  const here = actor.position(t);
  const facingToward = (p: Point) => (p.x - here.x >= 0 ? 1 : -1);
  const envelope = (x: number, attack: number, release: number) => (x < 0 ? Math.max(1 + x / attack, 0) : Math.max(1 - x / release, 0));

  // How he moves, else how he stands.
  let base: Pose;
  const motion = actor.motion(t);
  if (actor.slide != null && t >= actor.slide) {
    const heading = actor.motion(actor.slide + 0.05)?.heading ?? { x: 1, y: 0 };
    const down = motion == null ? 1 : smooth((t - actor.slide) / 0.12);
    const side = heading.x >= 0 ? 1 : -1;
    base = mixPose(facing(Poses.run(2 * Math.PI * 3.6 * actor.slide + index), side), facing(Poses.slide, side), down);
  } else if (motion && motion.speed > 3) {
    const side = motion.heading.x >= 0 ? 1 : -1;
    base = motion.speed > 40 ? facing(Poses.run(2 * Math.PI * 3.6 * t + index), side) : facing(Poses.walk(2 * Math.PI * 2.2 * t + index), side);
  } else {
    const role = actor.role;
    if (role.kind === "fielder") {
      base = role.n === 2 ? (actor.crouch ? Poses.squat : Poses.stand) : role.n <= 6 ? Poses.ready : Poses.stand;
    } else if (role.kind === "batter") {
      base = Poses.stand;
    } else {
      // Leading off, toward the next base: second and third are to the left, home to the right.
      base = Ballpark.distance(here) > 5 ? facing(Poses.lead, here.x < -20 ? 1 : -1) : Poses.stand;
    }
  }

  // The batter in the box: the stance, the swing.
  if (actor.role.kind === "batter" && actor.bats && (actor.dropsBat == null || t < actor.dropsBat) && motion == null) {
    const side = actor.bats === "L" ? -1 : 1;
    let p = Poses.stance;
    if (actor.swing != null) {
      const u = (t - (actor.swing - 0.09)) / 0.24;
      p = u <= 0 ? Poses.stance : u < 0.4 ? mixPose(Poses.stance, Poses.contact, smooth(u / 0.4)) : mixPose(Poses.contact, Poses.finish, smooth((u - 0.4) / 0.6));
    }
    base = facing(p, side);
  }

  // The pitcher's delivery, facing the third-base side (a right-hander's set).
  const r = script.release;
  if (actor.role.kind === "fielder" && actor.role.n === 1 && r != null && t > r - 0.55 && t < r + 0.7 && motion == null) {
    const x = t - r;
    let i = -1;
    for (let k = PITCHER_KEYS.length - 1; k >= 0; k--) {
      if (PITCHER_KEYS[k]![0] <= x) {
        i = k;
        break;
      }
    }
    if (i >= 0 && i + 1 < PITCHER_KEYS.length) {
      const [a, pa] = PITCHER_KEYS[i]!;
      const [b, pb] = PITCHER_KEYS[i + 1]!;
      const mirrored = (p: Pose) => (samePose(p, Poses.ready) ? p : facing(p, -1));
      base = mixPose(mirrored(pa), mirrored(pb), smooth((x - a) / (b - a)));
    }
  }

  // Hands on the ball: a catch, a scoop, a glove, a throw.
  for (const action of actor.actions) {
    const x = t - action.at;
    const side = facingToward(action.toward);
    switch (action.kind) {
      case "catchHigh":
        base = mixPose(base, facing(Poses.catchHigh, side), envelope(x, 0.28, 0.35));
        break;
      case "scoop":
        base = mixPose(base, facing(Poses.scoop, side), envelope(x, 0.22, 0.2));
        break;
      case "glove":
        base = mixPose(base, facing(Poses.glove, side), envelope(x, 0.2, 0.22));
        break;
      case "throwBall": {
        if (!(x > -0.24 && x < 0.4)) break;
        const throwing = x < -0.04 ? Poses.cock : mixPose(Poses.cock, Poses.release, smooth((x + 0.04) / 0.14));
        const e = envelope(x, 0.2, 0.36);
        base = mixPose(base, facing(throwing, side), e > 0 ? Math.min(e * 1.6, 1) : 0);
        break;
      }
    }
  }
  return base;
}

/** The bat: on the shoulder, then round through the zone, level at contact, and on into the follow-through. */
function drawBat(ctx: Ctx, t: number, bats: Hand, hands: Point, swing: number | null, length: number, halo: string, ink: TheaterInk): void {
  // Azimuth on the ground (0: toward first base's side, 90: out to center), and lift.
  let azimuth = -105;
  let lift = 0.85;
  if (swing != null) {
    const u = Math.min(Math.max((t - (swing - 0.09)) / 0.24, 0), 1);
    const e = easeValue("inOut", u);
    azimuth = -105 + e * 255;
    lift = u <= 0 ? 0.85 : u < 0.4 ? 0.85 - (u / 0.4) * 0.7 : 0.15 + ((u - 0.4) / 0.6) * 0.5;
  }
  if (bats === "L") azimuth = 180 - azimuth;
  const a = (azimuth * Math.PI) / 180;
  const flat = length * Math.sqrt(Math.max(1 - lift * lift, 0));
  const tip = { x: hands.x + Math.cos(a) * flat, y: hands.y - Math.sin(a) * flat * 0.5 - lift * length * 0.82 };
  const width = Math.max(length * 0.09, 1.1);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(hands.x, hands.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.strokeStyle = halo;
  ctx.lineWidth = width + 1.4;
  ctx.stroke();
  ctx.strokeStyle = ink.bat;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** Left lying by the plate when he runs, until the field settles. */
function drawDroppedBat(ctx: Ctx, p: Point, bats: Hand, fade: number, f: FieldProjection, ink: TheaterInk): void {
  if (!(fade > 0.01)) return;
  const s = bats === "L" ? 1 : -1;
  const l = f.figure * 0.5;
  ctx.save();
  ctx.globalAlpha = fade * 0.8;
  ctx.beginPath();
  ctx.moveTo(p.x + s * 0.12 * l, p.y + 0.14 * l);
  ctx.lineTo(p.x + s * 0.95 * l, p.y - 0.08 * l);
  ctx.strokeStyle = ink.bat;
  ctx.lineWidth = Math.max(l * 0.1, 1.1);
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();
}

/** A bright core in a soft glow, a short comet tail while it's fast, and its shadow on the grass (drawn with the shadows). */
function drawBall(ctx: Ctx, f: FieldProjection, { script, t, ink }: FrameInputs): void {
  const ball = script.ball(t);
  if (!ball) return;
  const o = script.ballOpacity(t);
  if (!(o > 0.01)) return;
  const p = f.at(ball);
  const r = Math.min(Math.max(0.42 * f.scale, 1.7), Math.max(f.figure * 0.12, 1.7));
  ctx.save();
  ctx.globalAlpha = o;
  // The tail: where it was over the last few hundredths, fading back.
  let flight = null;
  for (let i = script.flights.length - 1; i >= 0; i--) {
    const fl = script.flights[i]!;
    if (fl.start < t && t <= fl.end) {
      flight = fl;
      break;
    }
  }
  if (flight) {
    const trail: Point[] = [];
    for (let i = 1; i <= 6; i++) trail.push(f.at(flight.point(Math.max(t - i * 0.014, flight.start))));
    const last = trail[trail.length - 1]!;
    if (Math.hypot(last.x - p.x, last.y - p.y) > r * 3) {
      let previous = p;
      ctx.lineCap = "round";
      trail.forEach((q, i) => {
        const u = i / 6;
        ctx.beginPath();
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(q.x, q.y);
        ctx.strokeStyle = rgba(ink.ball, 0.55 * (1 - u));
        ctx.lineWidth = 2 * r * (1 - u * 0.75);
        ctx.stroke();
        previous = q;
      });
    }
  }
  for (const [grow, strength] of [
    [2.8, 0.1],
    [1.85, 0.22],
  ] as const) {
    ellipse(ctx, p.x, p.y, r * grow, r * grow);
    ctx.fillStyle = rgba(ink.glow, ink.glowAlpha * strength);
    ctx.fill();
  }
  ellipse(ctx, p.x, p.y, r + 0.6, r + 0.6);
  ctx.fillStyle = ink.ballEdge;
  ctx.fill();
  ellipse(ctx, p.x, p.y, r, r);
  ctx.fillStyle = rgba(ink.ball, 1);
  ctx.fill();
  ctx.restore();
}

function drawFlashes(ctx: Ctx, f: FieldProjection, { script, t, teams, ink }: FrameInputs): void {
  const unit = f.figure / 10;
  const accent = accentOf(teams.batting, ink);
  for (const flash of script.flashes) {
    const age = t - flash.at;
    switch (flash.beat) {
      case "contact": {
        // Short rays off the bat.
        if (!(age >= 0 && age < 0.24)) continue;
        const u = age / 0.24;
        const c = f.at(flash.point);
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
      case "out": {
        // A red ring where the out was made.
        if (!(age >= 0 && age < 0.6)) continue;
        const u = age / 0.6;
        const c = f.at(flash.point);
        const r = (2.5 + 7 * houseCurve(u)) * unit;
        ellipse(ctx, c.x, c.y, r, r / 2);
        ctx.strokeStyle = rgba(ink.red, 0.95 * (1 - u));
        ctx.lineWidth = 1.6;
        ctx.stroke();
        if (age < 0.25) {
          const d = 1.8 * unit;
          ellipse(ctx, c.x, c.y, d, d / 2);
          ctx.fillStyle = rgba(ink.red, 0.8 * (1 - age / 0.25));
          ctx.fill();
        }
        break;
      }
      case "run": {
        // The plate pops in the batting team's color.
        if (!(age >= 0 && age < 0.7)) continue;
        const u = age / 0.7;
        const c = f.at(flash.point);
        const r = (3 + 9 * houseCurve(u)) * unit;
        ctx.save();
        ctx.globalAlpha = 1 - u;
        ellipse(ctx, c.x, c.y, r, r / 2);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.restore();
        const pop = (age < 0.14 ? age / 0.14 : Math.max(1 - (age - 0.14) / 0.4, 0)) * 3.2 * unit;
        if (pop > 0.1) {
          ctx.save();
          ctx.globalAlpha = 0.9;
          ellipse(ctx, c.x, c.y, pop, pop / 2);
          ctx.fillStyle = accent;
          ctx.fill();
          ctx.restore();
        }
        break;
      }
      case "catchBall": {
        // The pop in the glove: a flash and a ring.
        if (!(age >= 0 && age < 0.32)) continue;
        const u = age / 0.32;
        const c = f.at(flash.point);
        const r = (1.2 + 3.6 * (1 - (1 - u) ** 3)) * unit;
        ellipse(ctx, c.x, c.y, r, r);
        ctx.strokeStyle = rgba(ink.trace, 0.85 * (1 - u));
        ctx.lineWidth = Math.max(unit * 0.2, 1);
        ctx.stroke();
        if (age < 0.1) {
          const d = (1.8 - age * 6) * unit;
          ellipse(ctx, c.x, c.y, d, d);
          ctx.fillStyle = rgba(ink.glow, ink.glowAlpha * 0.45);
          ctx.fill();
        }
        break;
      }
      case "hitBatter": {
        if (!(age >= 0 && age < 0.45)) continue;
        const u = age / 0.45;
        const c = f.at(flash.point);
        const r = (2 + 6 * u) * unit;
        ellipse(ctx, c.x, c.y, r, r);
        ctx.strokeStyle = rgba(ink.orange, 1 - u);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        break;
      }
    }
  }
}

/** A quick, critically damped spring: no bounce. */
const land = (x: number) => (x >= 1 ? 1 : Math.min(criticalSpring(0.32, x), 1));

/** The banner's point under the headline, where its confetti comes off. */
export function bannerAnchor(size: Size, pt: number): Point {
  return { x: size.width / 2, y: Math.max(size.height * 0.055, 9 * pt) * 0.7 + Math.min(Math.max(Math.max(size.height, 120) * 0.13, 17 * pt), 40 * pt) * 0.6 };
}

function drawLabels(ctx: Ctx, f: FieldProjection, { script, t, labels }: FrameInputs): void {
  const { size } = f;
  const inset = Math.max(size.height * 0.055, 9);
  // The pitch: from the windup until the play is under way.
  const label = script.label;
  if (labels.pitch && label && t > label.lower - 0.1 && t < label.upper + 0.3) {
    const fadeIn = Math.min(Math.max((t - label.lower + 0.1) / 0.15, 0), 1);
    const fadeOut = 1 - Math.min(Math.max((t - label.upper) / 0.3, 0), 1);
    ctx.save();
    ctx.globalAlpha = fadeIn * fadeOut;
    ctx.translate(size.width - inset, size.height - inset * 0.8);
    labels.pitch.draw(ctx);
    ctx.restore();
  }
  // The headline across the top: wiped open from the middle as it drops in,
  // held, then lifted away as the field settles.
  const banner = script.banner;
  if (labels.banner && banner && t >= banner.at && t < banner.until + 0.3) {
    const x = t - banner.at;
    const v = land(x);
    const out = Math.min(Math.max((t - banner.until) / 0.28, 0), 1);
    const open = houseCurve(Math.min(x / 0.3, 1));
    const w = labels.banner.width;
    const cx = size.width / 2;
    const cy = inset * 0.7 + labels.banner.height / 2 + (1 - v) * -8 - out * 5;
    ctx.save();
    ctx.globalAlpha = Math.min(x / 0.12, 1) * (1 - out);
    ctx.beginPath();
    ctx.rect(cx - (w / 2) * open - 2, 0, w * open + 4, size.height);
    ctx.clip();
    ctx.translate(cx, cy);
    labels.banner.draw(ctx);
    ctx.restore();
  }
  // The scorer's mark, as the play resolves: in from larger on a quick spring that never bounces, never from nothing.
  if (labels.stamp && t >= script.stamp) {
    const x = t - script.stamp;
    const v = land(x);
    const grow = 1.28 - 0.28 * v;
    ctx.save();
    ctx.globalAlpha = Math.min(x / 0.1, 1);
    ctx.translate(inset, size.height - inset * 0.8);
    ctx.scale(grow, grow);
    labels.stamp.draw(ctx);
    ctx.restore();
  }
}

// MARK: - Bursts

/** The theater's bursts, drawn through the camera so a firework stays on the wall as the camera moves. */
export function drawBursts(ctx: Ctx, f: FieldProjection, bursts: readonly TheaterBurst[], t: number, palette: CelebrationPalette, pt: number): void {
  for (const burst of bursts) {
    if (!(t >= burst.at && t <= burstEnd(burst))) continue;
    const origin = burst.anchor.kind === "field" ? f.at(burst.anchor.point) : bannerAnchor(f.size, pt);
    ctx.save();
    ctx.translate(origin.x, origin.y);
    ctx.scale(burst.scale, burst.scale);
    drawParticles(ctx, particles(burst.cue, { x: 0, y: 0 }, t - burst.at), palette);
    ctx.restore();
  }
}
