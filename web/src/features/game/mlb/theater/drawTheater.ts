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
import { PITCH_NAMES, type Hand, type PlayScene } from "../../../../data/mlb/playScene";
import { STAMP_MARKS, tarpCover, ZONE_FRONT, ZONE_HALF, type Actor, type PlayScript, type Signal } from "../../../../data/mlb/playScript";
import { burstEnd, type TheaterBurst } from "../../../../data/mlb/theaterCelebration";
import { Ballpark, easeValue, houseCurve, criticalSpring, ORIGIN, type Point } from "../../../../data/mlb/theaterField";
import { BaseballPoses, deliverAt } from "../../../../data/mlb/theaterPose";
import { umpire, type TheaterTeams, type Uniform } from "../../../../data/mlb/theaterTeams";
import { keyed, mirrored, mix, over, Rig, RigPoses, RigTrack, gait, type RigPose } from "../../../../data/theater/rig";
import { luminance } from "../../../../data/teamColors";
import { drawFigure, figureInks, grip, RigLens, rigFigure, type RigFigure } from "../../core/theater/rigFigure";
import { drawTags, ringBall, ringFigure, type PlacedTags } from "../../core/theater/theaterTags";
import { TheaterTagLayout, type TagFrame } from "../../../../data/theater/theaterNames";
import type { Rect } from "../../../../data/mlb/playCamera";
import { rgba, type TheaterInk } from "./theaterInk";

// The projection lives on its own so the football theater can share it without this drawing module.
export { FieldProjection, type Size } from "../../core/theater/fieldProjection";
import { FieldProjection, type Size } from "../../core/theater/fieldProjection";

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

  // The pitch: its name and speed, low in the foul ground on the right, across from the stamp,
  // and under them its spin when Statcast tracked it ("2,509 rpm").
  let pitch: Block | null = null;
  const p = scene?.pitch;
  const tracked = scene?.measured?.pitch ?? null;
  const code = p?.code ?? tracked?.type ?? null;
  const mph = p?.mph ?? (tracked?.mph != null ? Math.round(tracked.mph) : null);
  if (mph != null || code != null) {
    const name = (code != null ? PITCH_NAMES[code] : undefined) ?? p?.name ?? code ?? "";
    const fs = Math.min(Math.max(typeHeight * 0.068, 9.5 * pt), 15 * pt);
    const lines: [string, string, string][][] = [
      [
        [name, `500 ${fs}px ${FONT}`, ink.secondary],
        [mph != null ? `  ${mph}` : "", `600 ${fs}px ${FONT}`, primary],
        [mph != null ? " mph" : "", `500 ${fs}px ${FONT}`, ink.secondary],
      ],
    ];
    if (tracked?.spin != null) {
      lines.push([
        [tracked.spin.toLocaleString("en-US"), `600 ${fs}px ${FONT}`, primary],
        [" rpm", `500 ${fs}px ${FONT}`, ink.secondary],
      ]);
    }
    const widths = lines.map((parts) =>
      parts.map(([text, font]) => {
        ctx.font = font;
        return ctx.measureText(text).width;
      }),
    );
    const lineWidths = widths.map((w) => w.reduce((a, b) => a + b, 0));
    const width = Math.max(...lineWidths);
    const lead = fs * 1.2 + fs * 0.12;
    pitch = {
      width,
      height: fs * 1.2 + (lines.length - 1) * lead,
      // Anchored bottom-trailing, each line flush right.
      draw: (c) => {
        lines.forEach((parts, line) => {
          let x = -lineWidths[line]!;
          const y = -fs * 0.25 - (lines.length - 1 - line) * lead;
          parts.forEach(([text, font, color], i) => {
            c.font = font;
            c.fillStyle = color;
            c.fillText(text, x, y);
            x += widths[line]![i]!;
          });
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
  /** Room kept at the bottom trailing corner (the heartbeat's): the pitch's label sits above it. */
  readonly footer?: number;
  /** The names over the figures: the pointer's, the batter's. */
  readonly tags?: TagFrame | null;
}

/**
 * One frame: the tarp and the shadows on the field, the names (under
 * everything that plays), then the ball's trace and its dust, the figures far
 * to near, the zone, the ball, the beats and the type.
 */
export function drawFrame(ctx: Ctx, f: FieldProjection, input: FrameInputs): void {
  drawTarp(ctx, f, input);
  const figures = posed(f, input);
  drawShadows(ctx, f, input, figures);
  const tags = drawTags(
    ctx,
    input.tags,
    figures.map((p) => ({ index: p.index, figure: p.figure, height: f.figure, opacity: p.opacity })),
    input.t,
    f.size,
    tagRooms(f, input),
    input.ink.dark,
  );
  drawTrace(ctx, f, input);
  drawPuffs(ctx, f, input);
  drawFigures(ctx, f, input, figures, tags);
  drawZone(ctx, f, input);
  drawBall(ctx, f, input, tags);
  drawFlashes(ctx, f, input);
  drawLabels(ctx, f, input);
}

/** What the names keep clear of besides the furniture: the pitch's label, the headline and the mark while they're up. */
function tagRooms(f: FieldProjection, { script, t, labels, footer = 0 }: FrameInputs): Rect[] {
  const { size } = f;
  const inset = Math.max(size.height * 0.055, 9);
  const out: Rect[] = [];
  const label = script.label;
  if (labels.pitch && label && t > label.lower - 0.1 && t < label.upper + 0.3) {
    const s = labels.pitch;
    out.push({ x: size.width - inset - s.width, y: size.height - inset * 0.8 - footer - s.height, width: s.width, height: s.height });
  }
  const banner = script.banner;
  if (labels.banner && banner && t >= banner.at && t < banner.until + 0.3) out.push(TheaterTagLayout.banner(labels.banner, size));
  if (labels.stamp && t >= script.stamp) out.push(TheaterTagLayout.stamp(labels.stamp, size, inset));
  return out;
}

/** A rain delay's tarp over the infield dirt, rolled out from the first-base side to the third (or back in), its seams across it. */
function drawTarp(ctx: Ctx, f: FieldProjection, { script, t, ink }: FrameInputs): void {
  const tarp = script.tarp;
  if (!tarp) return;
  const cover = tarpCover(tarp, t);
  if (!(cover > 0.005)) return;
  const skin = () => {
    ctx.beginPath();
    SKIN.forEach((q, i) => {
      const p = f.point(q);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
  };
  // Rolled out from the right as far as `cover` has it.
  const edge = 100 - 200 * cover;
  ctx.save();
  polyline(ctx, [{ x: edge, y: -20 }, { x: 120, y: -20 }, { x: 120, y: 170 }, { x: edge, y: 170 }].map((q) => f.point(q)), true);
  ctx.clip();
  // PlayTheater.swift's Color(hue: 0.6, saturation: 0.3 / 0.35, brightness: 0.62 / 0.58): HSB, not HSL.
  const cloth = ink.dark ? "rgb(111 130 158)" : "rgb(96 117 148)";
  skin();
  ctx.globalAlpha = ink.dark ? 0.75 : 0.82;
  ctx.fillStyle = cloth;
  ctx.fill();
  ctx.globalAlpha = 1;
  skin();
  ctx.clip();
  ctx.beginPath();
  for (let x = -90; x <= 90; x += 18) {
    const a = f.point({ x, y: -10 });
    const b = f.point({ x, y: 160 });
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.strokeStyle = ink.dark ? "rgb(255 255 255 / 0.12)" : "rgb(255 255 255 / 0.3)";
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.restore();
  // The roll itself, at the edge, while it moves.
  if (cover < 0.995) {
    ctx.save();
    skin();
    ctx.clip();
    const a = f.point({ x: edge, y: -5 });
    const b = f.point({ x: edge, y: 150 });
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = cloth;
    ctx.lineWidth = Math.max(f.scale * 2.2, 2.5);
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * A pitch's strike zone, as a broadcast draws it: a faint frame at the front
 * of the plate while the ball's on its way, and once it's crossed a dot where
 * it did, then gone.
 */
function drawZone(ctx: Ctx, f: FieldProjection, { script, t, ink }: FrameInputs): void {
  const zone = script.zone;
  if (!zone || !(t > zone.from) || !(t < zone.until + 0.4)) return;
  const fade = Math.min((t - zone.from) / 0.2, 1) * (1 - Math.min(Math.max((t - zone.until) / 0.4, 0), 1));
  if (!(fade > 0.01)) return;
  const y = ZONE_FRONT;
  const w = ZONE_HALF;
  ctx.save();
  ctx.globalAlpha = fade;
  polyline(ctx, [f.point({ x: -w, y }, zone.bottom), f.point({ x: w, y }, zone.bottom), f.point({ x: w, y }, zone.top), f.point({ x: -w, y }, zone.top)], true);
  ctx.fillStyle = rgba([255, 255, 255], 0.07 * (ink.dark ? 0.55 : 0.95));
  ctx.fill();
  ctx.strokeStyle = ink.chalk;
  ctx.globalAlpha = fade * 0.7;
  ctx.lineWidth = Math.min(Math.max(f.scale * 0.1, 0.7), 1.3);
  ctx.stroke();
  if (t >= zone.at) {
    ctx.globalAlpha = fade;
    const c = f.point({ x: zone.crossing.x, y }, zone.crossing.y);
    const r = Math.min(Math.max(f.scale * 0.2, 1.6), 3.2);
    ellipse(ctx, c.x, c.y, r, r);
    ctx.fillStyle = rgba(ink.ball, 1);
    ctx.fill();
    ctx.strokeStyle = ink.ballEdge;
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  ctx.restore();
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
  const p = f.point(landing.point, landing.z ?? 0);
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

function drawShadows(ctx: Ctx, f: FieldProjection, { script, t, ink }: FrameInputs, figures: readonly Posed[]): void {
  // Under the hips; smaller and fainter as he leaves the ground.
  const w = f.figure * 0.3;
  for (const p of figures) {
    const air = Math.min(p.figure.air / 0.4, 1);
    const r = w * (1 - 0.35 * air);
    const g = p.figure.ground;
    ellipse(ctx, g.x, g.y, r, r * 0.32);
    ctx.fillStyle = rgba(ink.shadow, ink.shadowAlpha * p.opacity * (1 - 0.45 * air));
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

/** A figure posed and placed at t. */
interface Posed {
  readonly index: number;
  readonly figure: RigFigure;
  readonly opacity: number;
}

/** Everyone on the field at t, far to near: a figure in front covers the one behind. */
function posed(f: FieldProjection, input: FrameInputs): Posed[] {
  const { script, t } = input;
  const order = script.actors.map((actor, index) => ({ actor, index, at: actor.position(t) })).sort((a, b) => b.at.y - a.at.y);
  const out: Posed[] = [];
  for (const { actor, index, at } of order) {
    const o = actor.opacity(t);
    if (!(o > 0.01)) continue;
    const lens = RigLens.field(f, at);
    const [body, heading] = pose(script, t, actor, index, at, lens.unit);
    out.push({ index, figure: rigFigure(body, heading, lens), opacity: o });
  }
  return out;
}

function drawFigures(ctx: Ctx, f: FieldProjection, input: FrameInputs, figures: readonly Posed[], tags: PlacedTags | null): void {
  const { script, t, teams, ink } = input;
  const batting = figureInks(teams.batting, ink);
  const fielding = figureInks(teams.fielding, ink);
  // The umpires in their own kit (`umpire` in theaterTeams.ts), never a team's.
  const officials = figureInks(UMPIRES[ink.dark ? "dark" : "light"], ink);
  for (const p of figures) {
    const actor = script.actors[p.index]!;
    if (actor.bats && actor.dropsBat != null && t >= actor.dropsBat) {
      drawDroppedBat(ctx, f.point(Ballpark.box(actor.bats)), actor.bats, 1 - Math.min(Math.max((t - script.settle) / 0.4, 0), 1), f, ink);
    }
    const inks = actor.team === "batting" ? batting : actor.team === "official" ? officials : fielding;
    ringFigure(ctx, tags, p.figure, f.figure, p.opacity);
    drawFigure(ctx, p.figure, inks, f.figure, p.opacity);
    if (actor.bats && (actor.dropsBat == null || t < actor.dropsBat)) {
      ctx.globalAlpha = p.opacity;
      drawBat(ctx, t, actor, actor.bats, grip(p.figure), f.figure * 0.62, inks.rim, ink);
      ctx.globalAlpha = 1;
    }
  }
}

const envelope = (x: number, attack: number, release: number) => (x < 0 ? Math.max(1 + x / attack, 0) : Math.max(1 - x / release, 0));

/** The umpire's kit, one per scheme (figure inks are kept per uniform). */
const UMPIRES = { light: umpire("light"), dark: umpire("dark") } as const;

/**
 * How far through a swing he is at t (0 the stance, 0.4 through the zone, 1
 * the finish): a full swing; a check swing, started and held up short of the
 * zone; a practice swing, easy, halfway and back. Null: none.
 */
export function swingPhase(a: Actor, t: number): number | null {
  const bump = (start: number, rise: number, hold: number, fall: number) => Rig.smooth((t - start) / rise) * (1 - Rig.smooth((t - start - rise - hold) / fall));
  if (a.swing != null) return Math.min(Math.max((t - (a.swing - 0.09)) / 0.24, 0), 1);
  if (a.check != null && t > a.check - 0.1) return 0.3 * bump(a.check - 0.1, 0.11, 0.06, 0.35);
  if (a.practice != null && t > a.practice) return 0.62 * bump(a.practice, 0.42, 0.12, 0.5);
  return null;
}

/** Back into his stance after a swing he missed or fouled (one he ran on, he dropped the bat). */
export function recovery(a: Actor, t: number): number {
  if (a.swing == null || a.dropsBat != null) return 0;
  return Rig.smooth((t - a.swing - 0.75) / 0.5);
}

/** In any of these windows at t, eased in and out over `ramp`. */
export function within(windows: readonly { readonly lower: number; readonly upper: number }[], t: number, ramp: number): number {
  let best = 0;
  for (const w of windows) best = Math.max(best, Rig.smooth((t - w.lower) / ramp) * (1 - Rig.smooth((t - w.upper) / ramp)));
  return best;
}

/** An umpire's call as a pose, and how long he holds it: the punch-out and safe longest. */
export function callPose(kind: Signal["kind"]): [RigPose, number] {
  switch (kind) {
    case "strike":
      return [BaseballPoses.strikeCall, 0.35];
    case "punchOut":
      return [BaseballPoses.punchOut, 0.75];
    case "swinging":
      return [BaseballPoses.swingingCall, 0.3];
    case "foul":
      return [BaseballPoses.foulCall, 0.45];
    case "safe":
      return [BaseballPoses.safeCall, 0.6];
    case "out":
      return [BaseballPoses.outCall, 0.6];
    case "challenge":
      return [BaseballPoses.capTap, 0.45];
  }
}

const SWING_KEYS: readonly (readonly [number, RigPose])[] = [
  [0, BaseballPoses.stance],
  [0.4, BaseballPoses.contact],
  [1, BaseballPoses.finish],
];

const THROW_KEYS: readonly (readonly [number, RigPose])[] = [
  [-0.3, RigPoses.cock],
  [-0.04, RigPoses.cock],
  [0.1, RigPoses.release],
  [0.4, RigPoses.release],
];

/**
 * The body at t, and its heading (PlayFrame.pose): how he stands for his
 * position, how he's moving (striding to his planted feet), and over that
 * what he's doing (the delivery, a swing, a slide, a catch, a throw). `unit`:
 * body units to the foot where he stands. (tested)
 */
export function pose(script: PlayScript, t: number, actor: Actor, index: number, here: Point, unit: number): [RigPose, number] {
  const track = script.rig[index] ?? RigTrack.standing(here);
  const m = track.motion(t);

  // How he stands, and how he moves. The catcher squats behind the plate (up out of it when he rises).
  const role = actor.role;
  const home = Math.hypot(here.x - Ballpark.position(2).x, here.y - Ballpark.position(2).y) < 3;
  const lefty = actor.arm === "L";
  const hand = (p: RigPose) => (lefty ? mirrored(p) : p);
  let still: RigPose;
  if (role.kind === "fielder") {
    if (role.n === 1) {
      // Ready to field off his follow-through (a lefty's mirrored), then back up as the ball's away from him.
      const release = script.release;
      still = hand(release != null && t > release ? mix(BaseballPoses.fielding, RigPoses.ready, Rig.smooth((t - release - 1.1) / 0.5)) : RigPoses.ready);
    } else if (role.n === 2) still = actor.crouch && home ? mix(BaseballPoses.squat, RigPoses.stand, within(actor.rise, t, 0.22)) : RigPoses.stand;
    else still = role.n <= 6 ? RigPoses.ready : RigPoses.stand;
  } else if (role.kind === "batter" || role.kind === "coach" || role.kind === "umpire") still = RigPoses.stand;
  // Leading off a base, low, watching the pitcher.
  else still = Ballpark.distance(here) > 5 ? BaseballPoses.lead : RigPoses.stand;
  const feet = track.feet(t, here, m.heading, unit, m.speed, { left: still.left, right: still.right });
  let body = mix(still, gait(m, feet), m.weight);
  const moving = actor.motion(t);
  if (actor.slide != null && t >= actor.slide) {
    body = mix(body, BaseballPoses.slide, moving == null ? 1 : Rig.smooth((t - actor.slide) / 0.12));
  }
  // Back into the bag head first, and up again when he moves off it.
  if (actor.diveBack != null && t >= actor.diveBack) {
    const dive = actor.diveBack;
    const up = actor.moves.find((mv) => mv.start > dive + 0.1)?.start ?? dive + 1.2;
    body = mix(body, BaseballPoses.diveBack, Rig.smooth((t - dive) / 0.12) * (1 - Rig.smooth((t - up + 0.3) / 0.3)));
  }

  // The batter in the box: the stance, a swing (full, checked or practice), squared to bunt.
  if (role.kind === "batter" && actor.bats && (actor.dropsBat == null || t < actor.dropsBat) && moving == null) {
    let p = BaseballPoses.stance;
    const u = swingPhase(actor, t);
    if (u != null) {
      p = keyed(SWING_KEYS, u) ?? (u <= 0 ? BaseballPoses.stance : BaseballPoses.finish);
      p = mix(p, BaseballPoses.stance, recovery(actor, t));
    }
    if (actor.bunt != null) p = mix(p, BaseballPoses.bunt, Rig.smooth((t - actor.bunt) / 0.25) * (1 - Rig.smooth((t - actor.bunt - 1.7) / 0.4)));
    body = actor.bats === "L" ? mirrored(p) : p;
  }

  // The plate umpire: down in his set as the pitch comes, his calls over it.
  if (role.kind === "umpire") {
    if (actor.sets.length > 0 && moving == null) body = mix(body, BaseballPoses.umpireSet, within(actor.sets, t, 0.2));
    for (const signal of actor.signals) {
      const [call, hold] = callPose(signal.kind);
      const x = t - signal.at;
      const w = x < 0 ? Math.max(1 + x / 0.14, 0) : x < hold ? 1 : Math.max(1 - (x - hold) / 0.3, 0);
      if (w > 0) body = over(body, call, Rig.smooth(w), m.weight);
    }
  }

  // The pitcher: in for the sign, set in the stretch, the delivery at his arm slot (a lefty's
  // mirrored); then he's ready where he landed.
  if (role.kind === "fielder" && role.n === 1 && moving == null) {
    if (actor.sign) body = mix(body, hand(BaseballPoses.sign), within([actor.sign], t, 0.25));
    if (actor.sets.length > 0) body = mix(body, hand(BaseballPoses.set), within(actor.sets, t, 0.18));
    if (script.release != null) {
      const keys: (readonly [number, RigPose])[] = [
        [-0.55, actor.sets.length === 0 ? RigPoses.ready : hand(BaseballPoses.set)],
        [-0.42, hand(BaseballPoses.set)],
        [-0.24, hand(BaseballPoses.kick)],
        [-0.08, hand(BaseballPoses.stride)],
        [0, hand(deliverAt(actor.slot))],
        [0.16, hand(BaseballPoses.follow)],
        [0.45, hand(BaseballPoses.fielding)],
        [0.7, hand(BaseballPoses.fielding)],
      ];
      const p = keyed(keys, t - script.release);
      if (p) body = p;
    }
  }

  // Hands on the ball: a catch, a scoop, a glove, a throw. On the move, the legs keep running.
  for (const action of actor.actions) {
    const x = t - action.at;
    switch (action.kind) {
      case "catchHigh":
        body = over(body, RigPoses.catchHigh, envelope(x, 0.28, 0.35), m.weight);
        break;
      case "scoop":
        body = over(body, RigPoses.scoop, envelope(x, 0.22, 0.2), m.weight * 0.5);
        break;
      case "glove":
        body = over(body, RigPoses.glove, envelope(x, 0.2, 0.22), m.weight);
        break;
      case "throwBall": {
        if (!(x > -0.24 && x < 0.4)) break;
        const throwing = keyed(THROW_KEYS, x);
        if (!throwing) break;
        body = over(body, throwing, Math.min(envelope(x, 0.2, 0.36) * 1.6, 1), m.weight);
        break;
      }
    }
  }
  return [body, m.heading];
}

/**
 * The bat: on the shoulder, then round through the zone, level at contact,
 * and on into the follow-through (back to the shoulder after a miss); held
 * level out in front to bunt.
 */
function drawBat(ctx: Ctx, t: number, actor: Actor, bats: Hand, hands: Point, length: number, halo: string, ink: TheaterInk): void {
  // Azimuth on the ground (0: toward first base's side, 90: out to center), and lift.
  let azimuth = -105;
  let lift = 0.85;
  const u = swingPhase(actor, t);
  if (u != null) {
    const e = easeValue("inOut", u);
    azimuth = -105 + e * 255;
    lift = u <= 0 ? 0.85 : u < 0.4 ? 0.85 - (u / 0.4) * 0.7 : 0.15 + ((u - 0.4) / 0.6) * 0.5;
    const back = recovery(actor, t);
    azimuth += (-105 - azimuth) * back;
    lift += (0.85 - lift) * back;
  }
  if (actor.bunt != null) {
    const w = Rig.smooth((t - actor.bunt) / 0.25) * (1 - Rig.smooth((t - actor.bunt - 1.7) / 0.4));
    azimuth += (12 - azimuth) * w;
    lift += (0.08 - lift) * w;
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
function drawBall(ctx: Ctx, f: FieldProjection, { script, t, ink }: FrameInputs, tags: PlacedTags | null): void {
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
  ringBall(ctx, tags, p, r);
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

function drawLabels(ctx: Ctx, f: FieldProjection, { script, t, labels, footer = 0 }: FrameInputs): void {
  const { size } = f;
  const inset = Math.max(size.height * 0.055, 9);
  // The pitch: from the windup until the play is under way.
  const label = script.label;
  if (labels.pitch && label && t > label.lower - 0.1 && t < label.upper + 0.3) {
    const fadeIn = Math.min(Math.max((t - label.lower + 0.1) / 0.15, 0), 1);
    const fadeOut = 1 - Math.min(Math.max((t - label.upper) / 0.3, 0), 1);
    ctx.save();
    ctx.globalAlpha = fadeIn * fadeOut;
    ctx.translate(size.width - inset, size.height - inset * 0.8 - footer);
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
