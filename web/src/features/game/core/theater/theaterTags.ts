/**
 * The names over a theater's figures, drawn into its frame
 * (TheaterNames.swift `TheaterNameTag`, `TheaterTags.draw`): the tag in the
 * status tag's own type (condensed black italic) on a slab cut on the same
 * 12° lean, in the color the man wears. Under the pointer his number leads
 * on the team's other color and his position follows; at rest the key man's
 * surname alone; a man the data can't name says what's known on a fainter
 * slab. Placed with TheaterTagLayout (data/theater/theaterNames.ts) over
 * each man's head as he's drawn, so a tag follows its man through a replay.
 *
 * A tag never blocks the play: it's drawn on the surface, over the shadows
 * and under every figure, the ball and its flight (the furniture stays on
 * top). Where a man or the ball crosses a tag he gets a thin ring, only over
 * the tag, so his color never touches the slab's; a tag nothing crosses
 * looks as it would alone.
 *
 * Called from each theater's frame, with its posed figures: a tag's type is
 * measured once per man, side and size (a few `measureText`s), then each
 * frame only fills two slabs and a few runs, and rings only the figures
 * whose box meets a tag.
 */
import { lightInk, luminanceOf, SLIDE_LEAN, type SlidePaint } from "../../../../data/scoringSlide";
import type { Rect } from "../../../../data/mlb/playCamera";
import { toHex, type OKLab } from "../../../../data/teamColors";
import type { Point } from "../../../../data/mlb/theaterField";
import { shownTags, tagType, TheaterPointer, TheaterTagLayout, type TagAsk, type TagFrame, type TagLabel, type TheaterWho } from "../../../../data/theater/theaterNames";
import { figureOutline, type RigFigure } from "./rigFigure";
import { statusTagSize } from "./TheaterStatus";

type Ctx = CanvasRenderingContext2D;

interface Size {
  readonly width: number;
  readonly height: number;
}

/** A piece of type drawn with its top-leading corner at (0, 0); `width` and `height` in points (theaterKit.ts `Block`). */
export interface Block {
  readonly width: number;
  readonly height: number;
  readonly draw: (ctx: Ctx) => void;
}

// The kit's type helpers, kept here (as the baseball theater keeps its own) so its chunk takes the tags without the football and soccer kit.
/** SF's line box: the ascender and the whole line, as fractions of the font size. */
const ASCENT = 0.952;
const LINE = 1.19;
const HAS_LETTER_SPACING = typeof CanvasRenderingContext2D !== "undefined" && "letterSpacing" in CanvasRenderingContext2D.prototype;
const HAS_FONT_STRETCH = typeof CanvasRenderingContext2D !== "undefined" && "fontStretch" in CanvasRenderingContext2D.prototype;

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

const measureTracked = (ctx: Ctx, text: string, tracking: number) => ctx.measureText(text).width + tracking * [...text].length;

// MARK: - Type

/** The status tag's faces (TheaterStatus.module.css): the system's condensed width, else a condensed face the system has. */
const SYSTEM = 'system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
const FALLBACK = '"Helvetica Neue", "Arial Narrow", "Roboto Condensed", system-ui, sans-serif';

let family: string | null = null;

/** Whether the canvas draws the system font condensed (SF Pro Condensed); measured once, as the status tag's `systemCondenses`. */
function tagFamily(ctx: Ctx): string {
  if (family != null) return family;
  ctx.save();
  const width = (stretch: string) => {
    setFont(ctx, SYSTEM, 900, 40, stretch);
    return ctx.measureText("HOME RUN").width;
  };
  family = width("condensed") < width("normal") * 0.95 ? SYSTEM : FALLBACK;
  ctx.restore();
  return family;
}

function setFont(ctx: Ctx, face: string, weight: number, size: number, stretch = "condensed"): void {
  if (HAS_FONT_STRETCH) {
    ctx.font = `italic ${weight} ${size}px ${face}`;
    ctx.fontStretch = stretch as CanvasFontStretch;
  } else {
    ctx.font = `italic ${weight} ${stretch === "normal" ? "" : `${stretch} `}${size}px ${face}`;
  }
}

/** A run of the tag's type: its words, weight, size and tracking, measured in the tag's face. */
interface Run {
  readonly text: string;
  readonly weight: number;
  readonly size: number;
  readonly tracking: number;
  readonly width: number;
}

function run(ctx: Ctx, text: string, weight: number, size: number, tracking: number): Run {
  setFont(ctx, tagFamily(ctx), weight, size);
  return { text, weight, size, tracking, width: measureTracked(ctx, text, tracking) };
}

/** A run centered in a slab `h` tall from `top`, as SwiftUI centers a line of type (its line box, SF's metrics). */
function fillRun(ctx: Ctx, r: Run, x: number, top: number, h: number, box: number): void {
  setFont(ctx, tagFamily(ctx), r.weight, r.size);
  const baseline = top + (h - box) / 2 + (box - r.size * LINE) / 2 + r.size * ASCENT;
  fillTracked(ctx, r.text, x, baseline, r.tracking);
}

/** The slab cut on the lean (LeanShape): its top edge shifted forward, its bottom back. */
function lean(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const d = h * SLIDE_LEAN;
  ctx.beginPath();
  ctx.moveTo(x + d, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - d, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

// MARK: - Paint

const WHITE = "#ffffff";
/** `Color(white: 0.08)`. */
const NEAR_BLACK = "#141414";

const contrast = (a: OKLab, b: OKLab) => {
  const x = luminanceOf(a);
  const y = luminanceOf(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** The slab's type: white or near black, whichever reads (SlidePaint.ink). */
const ink = (p: SlidePaint) => (p.lightInk ? WHITE : NEAR_BLACK);

/** Type on the second color (SlidePaint.stripeInk): the slab's own color where it reads there (navy on gold), else white or near black. */
const stripeInk = (p: SlidePaint) => (contrast(p.slab, p.stripe) >= 4.5 ? toHex(p.slab) : lightInk(p.stripe) ? WHITE : NEAR_BLACK);

// MARK: - The tag

/**
 * One tag, laid out (its top-leading corner at the origin). Under the
 * pointer (`full`), his number leads on the team's other color and his
 * position follows; at rest, his surname alone. A man the data can't name
 * says what's known on a fainter slab: his team and his position, or his team.
 */
export function nameTag(ctx: Ctx, who: TheaterWho, label: TagLabel, full: boolean, size: number): Block {
  ctx.save();
  const h = size * 1.6;
  const d = h * SLIDE_LEAN;
  const paint = label.paint;
  const slab = toHex(paint.slab);
  let block: Block;
  if (who.kind === "known") {
    const p = who.person;
    const number = full && p.number ? run(ctx, p.number, 900, size, size * 0.04) : null;
    const name = run(ctx, p.last.toUpperCase(), 900, size, size * 0.06);
    const position = full && p.position ? run(ctx, p.position, 800, size * 0.86, 0) : null;
    const lead = number ? number.width + size * 0.55 + d * 0.5 + size * 0.45 + d : 0;
    const words = name.width + (position ? size * 0.4 + position.width : 0);
    const body = words + size * 0.55 + d + size * 0.6 + d * 0.5;
    // The name's slab tucks under the number's by the lean.
    const at = number ? lead - d : 0;
    const box = size * LINE;
    block = {
      width: at + body,
      height: h,
      draw: (c) => {
        const alpha = c.globalAlpha;
        lean(c, at, 0, body, h);
        c.fillStyle = slab;
        c.fill();
        c.fillStyle = ink(paint);
        fillRun(c, name, at + size * 0.55 + d, 0, h, box);
        if (position) {
          c.globalAlpha = alpha * 0.72;
          fillRun(c, position, at + size * 0.55 + d + name.width + size * 0.4, 0, h, box);
          c.globalAlpha = alpha;
        }
        if (number) {
          lean(c, 0, 0, lead, h);
          c.fillStyle = toHex(paint.stripe);
          c.fill();
          c.fillStyle = stripeInk(paint);
          fillRun(c, number, size * 0.55 + d * 0.5, 0, h, box);
        }
      },
    };
  } else {
    // What's known of a man the data can't name, on a fainter slab.
    const team = label.team.toUpperCase();
    const text = who.kind === "assumed" && who.position.length > 0 ? `${team} · ${who.position}` : team;
    const words = run(ctx, text, 700, size, size * 0.06);
    const width = words.width + 2 * (size * 0.55 + d);
    block = {
      width,
      height: h,
      draw: (c) => {
        const alpha = c.globalAlpha;
        lean(c, 0, 0, width, h);
        c.fillStyle = slab;
        c.globalAlpha = alpha * 0.7;
        c.fill();
        c.fillStyle = ink(paint);
        c.globalAlpha = alpha * 0.85;
        fillRun(c, words, size * 0.55 + d, 0, h, size * LINE);
        c.globalAlpha = alpha;
      },
    };
  }
  ctx.restore();
  return block;
}

/** The status tag's room, laid out as it lays out its words (never drawn): what a name tag keeps clear of. */
export function statusRoom(ctx: Ctx, tag: string, wellHeight: number): Size {
  const size = statusTagSize(wellHeight);
  ctx.save();
  const words = run(ctx, tag.toUpperCase(), 900, size, size * 0.06);
  ctx.restore();
  return { width: words.width + size * 0.75 + size * 1.6 * SLIDE_LEAN + size * 0.7, height: size * 1.6 };
}

// MARK: - A frame's tags

/** A figure as drawn: what a tag stands over. */
export interface TagFigure {
  readonly index: number;
  readonly figure: RigFigure;
  /** His height standing, in points. */
  readonly height: number;
  /** As he fades in or out (coming on, going off): his tag with him. */
  readonly opacity: number;
}

/** The top of a figure: his head, or a hand raised over it. */
export function figureTop(f: RigFigure): number {
  let y = f.head.y - f.headRadius;
  for (const l of f.limbs) if (l.arm) y = Math.min(y, l.end.y - f.limb / 2, l.joint.y - f.limb / 2);
  return y;
}

/** Laid-out tags, kept per canvas: a man's tag is measured once per side, size and say. */
const laidOut = new WeakMap<Ctx, Map<string, Block>>();

function cached(ctx: Ctx, key: string, make: () => Block): Block {
  let blocks = laidOut.get(ctx);
  if (!blocks) laidOut.set(ctx, (blocks = new Map()));
  let block = blocks.get(key);
  if (!block) {
    if (blocks.size > 48) blocks.clear();
    block = make();
    blocks.set(key, block);
  }
  return block;
}

/** The status tag's room, kept per canvas while its words stay the same. */
const statusRooms = new WeakMap<Ctx, { key: string; size: Size }>();

function statusRoomOf(ctx: Ctx, tag: string, wellHeight: number): Size {
  const key = `${tag}|${wellHeight}`;
  const kept = statusRooms.get(ctx);
  if (kept?.key === key) return kept.size;
  const size = statusRoom(ctx, tag, wellHeight);
  statusRooms.set(ctx, { key, size });
  return size;
}

/** Development and tests: the tags the last frame drew, read from `window.__theaterTags` when it's set. */
declare global {
  interface Window {
    __theaterTags?: { kind: "pointer" | "leaving" | "key"; text: string; rect: Rect }[];
  }
}

/** The ring round a figure or the ball where it crosses a tag: white in the light. */
const LIGHT_RING = "#ffffff";
/** In the dark: white, or the well's own dark surface; still being decided with the Mac (one line). */
const DARK_RING = "#ffffff";

/** A tag as placed in a frame: where (its shape the lean across `rect`), how strongly, and what it draws. */
export interface PlacedTag {
  readonly kind: "pointer" | "leaving" | "key";
  readonly rect: Rect;
  readonly opacity: number;
  readonly block: Block;
}

/** A frame's tags, placed and drawn under its figures, and the ring that keeps a figure crossing one off its slab. */
export interface PlacedTags {
  readonly tags: readonly PlacedTag[];
  readonly ring: string;
}

/**
 * Draws a frame's tags at t, on the surface under everything that plays
 * (the figures, the ball and its flight are drawn after, over them; the
 * furniture stays on top): placed over their men (the pointer's first),
 * faded and risen as they come and go. `clear`: the frame's own type to keep
 * clear of (its stamp, its headline, the pitch's label). Returns them placed,
 * for `ringFigure` and `ringBall`, or null when there are none.
 */
export function drawTags(
  ctx: Ctx,
  frame: TagFrame | null | undefined,
  figures: readonly TagFigure[],
  t: number,
  size: Size,
  clear: readonly Rect[] = [],
  dark = false,
): PlacedTags | null {
  const probe = typeof window !== "undefined" ? window.__theaterTags : undefined;
  if (probe) probe.length = 0;
  if (!frame) return null;
  const shown = shownTags(frame, t);
  if (shown.pointer == null && shown.leaving == null && shown.key == null) return null;
  const type = tagType(size.height);
  const status = frame.status ? statusRoomOf(ctx, frame.status, size.height) : null;
  const furniture = [...TheaterTagLayout.furniture(size, status, frame.flip, frame.heartbeat), ...clear];
  const asks: { kind: "pointer" | "leaving" | "key"; index: number; block: Block; ask: TagAsk; opacity: number }[] = [];
  for (const [kind, index] of [
    ["pointer", shown.pointer],
    ["leaving", shown.leaving],
    ["key", shown.key],
  ] as const) {
    if (index == null) continue;
    const f = figures.find((g) => g.index === index);
    const m = frame.cast.members.get(index);
    if (!f || !m) continue;
    const label = frame.labels[m.side];
    const full = kind !== "key";
    const block = cached(ctx, `${m.id}|${m.side}|${full}|${type}|${toHex(label.paint.slab)}|${label.team}|${JSON.stringify(m.who)}`, () => nameTag(ctx, m.who, label, full, type));
    asks.push({
      kind,
      index,
      block,
      opacity: f.opacity,
      ask: { width: block.width, height: block.height, head: { x: f.figure.head.x, y: figureTop(f.figure) }, feet: f.figure.ground.y + Math.max(f.height * 0.1, 2), pointer: full },
    });
  }
  const spots = TheaterTagLayout.place(
    asks.map((a) => a.ask),
    size,
    furniture,
  );
  const placed: PlacedTag[] = [];
  // The key man's first, the leaving tag over it, the pointer's on top.
  for (let k = asks.length - 1; k >= 0; k--) {
    const spot = spots[k];
    const a = asks[k]!;
    if (!spot) continue;
    let opacity = a.opacity;
    let lift = 0;
    if (a.kind === "pointer") {
      opacity *= frame.appear;
      if (frame.rise) lift = TheaterPointer.rise * (1 - frame.appear);
    } else if (a.kind === "leaving") {
      opacity *= frame.remaining;
    }
    if (!(opacity > 0.005)) continue;
    const rect = { ...spot, y: spot.y + lift };
    ctx.save();
    ctx.globalAlpha *= opacity;
    ctx.translate(rect.x, rect.y);
    a.block.draw(ctx);
    ctx.restore();
    placed.push({ kind: a.kind, rect, opacity, block: a.block });
    const m = frame.cast.members.get(a.index);
    if (probe && m) probe.push({ kind: a.kind, text: m.who.kind === "known" ? m.who.person.last : m.who.kind === "assumed" ? `${frame.labels[m.side].team} · ${m.who.position}` : frame.labels[m.side].team, rect });
  }
  return placed.length > 0 ? { tags: placed, ring: dark ? DARK_RING : LIGHT_RING } : null;
}

/** How wide the ring is round a figure: about 1.5 pt at the compact panel, with his line weight. */
const ringWidth = (f: RigFigure) => Math.max(f.limb * 0.9, 1);

const overlaps = (r: Rect, x0: number, y0: number, x1: number, y1: number) => r.x < x1 && x0 < r.x + r.width && r.y < y1 && y0 < r.y + r.height;

/** Each tag it crosses, clipped to the tag's own shape, filled with `fill` (the ring) at the tag's opacity. */
function ringOver(ctx: Ctx, placed: PlacedTags, x0: number, y0: number, x1: number, y1: number, opacity: number, fill: (c: Ctx) => void): void {
  for (const tag of placed.tags) {
    if (!overlaps(tag.rect, x0, y0, x1, y1)) continue;
    ctx.save();
    ctx.globalAlpha *= tag.opacity * opacity;
    lean(ctx, tag.rect.x, tag.rect.y, tag.rect.width, tag.rect.height);
    ctx.clip();
    ctx.fillStyle = placed.ring;
    fill(ctx);
    ctx.restore();
  }
}

/**
 * Where a figure crosses a tag, a thin ring round his silhouette, only over
 * the tag, so his color never touches the slab's (the dataviz surface ring
 * on overlapping marks); drawn just before him. Elsewhere nothing changes,
 * and a figure that crosses no tag costs a box test. `height`: the
 * projection's figure height, as `drawFigure` takes it.
 */
export function ringFigure(ctx: Ctx, placed: PlacedTags | null, f: RigFigure, height: number, opacity = 1): void {
  if (!placed) return;
  const grow = ringWidth(f) + Math.max(height * 0.045, 0.8) + Math.max(f.torso, f.limb, f.headRadius * 2);
  let x0 = f.head.x;
  let y0 = f.head.y;
  let x1 = f.head.x;
  let y1 = f.head.y;
  for (const p of [f.hip, f.neck, ...f.limbs.flatMap((l) => [l.root, l.joint, l.end])]) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  ringOver(ctx, placed, x0 - grow, y0 - grow, x1 + grow, y1 + grow, opacity, (c) => {
    figureOutline(c, f, height, ringWidth(f));
    c.fill();
  });
}

/** Where the ball (a disc of radius `r` at `p`) crosses a tag: the same ring round it, only over the tag. */
export function ringBall(ctx: Ctx, placed: PlacedTags | null, p: Point, r: number, opacity = 1): void {
  if (!placed) return;
  const outer = r + 0.6 + Math.max(r * 0.6, 1.2);
  ringOver(ctx, placed, p.x - outer, p.y - outer, p.x + outer, p.y + outer, opacity, (c) => {
    c.beginPath();
    c.ellipse(p.x, p.y, outer, outer, 0, 0, 2 * Math.PI);
    c.fill();
  });
}
