/**
 * The names over a theater's figures, drawn into its frame
 * (TheaterNames.swift `TheaterNameTag`, `TheaterTags.draw`): the tag in the
 * status tag's own type (condensed black italic) on a slab cut on the same
 * 12° lean, in the color the man wears. Under the pointer his number leads
 * on the team's other color and his position follows; at rest the key man's
 * surname alone; a man the data can't name says what's known on a fainter
 * slab. Placed with TheaterTagLayout at the spot TheaterTagPlan chose for his
 * stretch of the replay (data/theater/theaterNames.ts): round him, or raised
 * clear of a crowd as a callout on a stem, riding with him.
 *
 * A tag never blocks the play: it's drawn on the surface, over the shadows
 * and under all that plays (the furniture stays on top); a callout's stem is
 * drawn by the theater just before its man, far to near (`drawStems`). Where
 * a man or the ball crosses a tag, a ring round him over the tag alone, so
 * his color never touches the slab's: white in the light, the slab cut away
 * to the surface in the dark (clips, never a blend). A tag nothing crosses
 * looks as it would alone. When the key man changes, his tag glides over.
 *
 * Called from each theater's frame, with its posed figures: a tag's type is
 * measured once per man, side and size (a few `measureText`s), its spots
 * ranked once per stretch, then each frame only fills two slabs and a few
 * runs, and rings only the figures whose box meets a tag.
 */
import { lightInk, luminanceOf, SLIDE_LEAN, type SlidePaint } from "../../../../data/scoringSlide";
import type { Rect } from "../../../../data/mlb/playCamera";
import { toHex, type OKLab } from "../../../../data/teamColors";
import type { Point } from "../../../../data/mlb/theaterField";
import {
  ringWidth,
  shownTags,
  stemWidth,
  tagEntering,
  tagHandoff,
  tagSpot,
  tagType,
  TheaterPointer,
  TheaterTagLayout,
  TheaterTagPlan,
  WHOLE,
  type CastMember,
  type Stretch,
  type TagAsk,
  type TagFrame,
  type TagLabel,
  type TheaterReplay,
  type TheaterWho,
} from "../../../../data/theater/theaterNames";
import { intersects } from "../../../../data/theater/theaterKit";
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

/**
 * A tag's own shape (LeanShape): the slab cut on the lean, its top edge
 * shifted forward, its bottom back (the full tag's number and name meet on
 * it, so it's one shape either way). The ring's clip. (pure; tested)
 */
export function tagShape(r: Rect): [Point, Point, Point, Point] {
  const d = r.height * SLIDE_LEAN;
  return [
    { x: r.x + d, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width - d, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}

/** The slab cut on the lean, as the current path. */
function lean(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const [a, b, c, d] = tagShape({ x, y, width: w, height: h });
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
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

/** A figure as drawn: what a tag stands over, or crosses. */
export interface TagFigure {
  readonly index: number;
  readonly figure: RigFigure;
  /** His height standing, in points. */
  readonly height: number;
  /** As he fades in or out (coming on, going off): his tag with him. */
  readonly opacity: number;
  /** As he's drawn, when that's fainter still (a man fading under the stamp): his ring with him. */
  readonly drawn?: number | null;
  /** What he holds out past his silhouette (the batter's bat): its line, and its width, outline and all. */
  readonly held?: { readonly from: Point; readonly to: Point; readonly width: number } | null;
}

/**
 * The ball as drawn: its shape (the disc and its edge, a football's oval:
 * an ellipse `rx` by `ry` turned `angle` round its middle), the height of a
 * man where it is (its ring's as wide as his), how faint.
 */
export interface TagBall {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly angle?: number;
  readonly height: number;
  readonly opacity?: number;
}

/** What parts a figure (or the ball) from a tag he crosses: a ring in a paint, or the slab cut away round him so the surface under it shows. */
export type TagRing = { readonly kind: "paint"; readonly color: string } | { readonly kind: "cutout" };

/** The ring white in the light (the owner asked); in the dark the tag cut away round him, the surface showing (white rang every man like a sticker). */
export const tagRing = (dark: boolean): TagRing => (dark ? { kind: "cutout" } : { kind: "paint", color: "#ffffff" });

/**
 * A raised tag's stem, as the theater draws it just before the man it
 * reaches: over the men behind him (so none of them seems to be the one it
 * names), under the men in front, who pass over it as they pass over his
 * tag; in the slab's color, at the tag's opacity.
 */
export interface Stem {
  readonly from: Point;
  readonly to: Point;
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
}

/** The raised tags' stems by the man each reaches. */
export type Stems = ReadonlyMap<number, readonly Stem[]>;

const NO_STEMS: Stems = new Map();

/** The stems of man `index`'s raised tags: drawn just before him, far to near. */
export function drawStems(ctx: Ctx, stems: Stems, index: number): void {
  const list = stems.get(index);
  if (!list) return;
  for (const s of list) {
    ctx.save();
    ctx.globalAlpha *= s.opacity;
    ctx.beginPath();
    ctx.moveTo(s.from.x, s.from.y);
    ctx.lineTo(s.to.x, s.to.y);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }
}

/** The top of a figure: his head, or a hand raised over it. */
export function figureTop(f: RigFigure): number {
  let y = f.head.y - f.headRadius;
  for (const l of f.limbs) if (l.arm) y = Math.min(y, l.end.y - f.limb / 2, l.joint.y - f.limb / 2);
  return y;
}

/** Where a tag under a figure's feet starts from. */
export const figureFeet = (f: TagFigure) => f.figure.ground.y + Math.max(f.height * 0.1, 2);

/** The outline's width round a figure `height` tall (TheaterDraw.halo). */
const halo = (height: number) => Math.max(height * 0.045, 0.8);

/**
 * The room a figure's ring takes: every part grown by its own width, his
 * outline and the ring (or, not `ringed`, the figure as drawn). (pure; tested)
 */
export function figureBox(f: TagFigure, ringed = true): Rect {
  const margin = ringed ? ringWidth(f.height) : 0;
  const grown = halo(f.height) + margin;
  const g = f.figure;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (p: Point, r: number) => {
    x0 = Math.min(x0, p.x - r);
    y0 = Math.min(y0, p.y - r);
    x1 = Math.max(x1, p.x + r);
    y1 = Math.max(y1, p.y + r);
  };
  for (const l of g.limbs) for (const p of [l.root, l.joint, l.end]) add(p, g.limb / 2 + grown);
  add(g.hip, g.torso / 2 + grown);
  add(g.neck, g.torso / 2 + grown);
  add(g.head, g.headRadius + grown);
  const held = f.held;
  if (held) {
    const r = held.width / 2 + margin;
    for (const p of [held.from, held.to]) add(p, r);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The ball's box: its shape's, turned. */
function ballBox(b: TagBall): Rect {
  const a = b.angle ?? 0;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const w = Math.hypot(b.rx * c, b.ry * s);
  const h = Math.hypot(b.rx * s, b.ry * c);
  return { x: b.x - w, y: b.y - h, width: 2 * w, height: 2 * h };
}

const grownBy = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, width: r.width + 2 * d, height: r.height + 2 * d });

/**
 * Who crosses a tag at `rect`: the figures (by their place in `figures`)
 * whose box meets it, and whether the ball does; only they are ringed, and a
 * tag nobody crosses draws as it always has. The tag's `own` man stands
 * clear of it by placement, closer than his ring in a big figure: only what
 * of him reaches into it counts (his bat), never the ring's margin, or it
 * would bite the tag over his head. (pure; tested)
 */
export function tagCrossing(figures: readonly TagFigure[], ball: TagBall | null, r: Rect, own: number | null = null): { figures: number[]; ball: boolean } {
  const hit: number[] = [];
  figures.forEach((f, i) => {
    if (f.opacity > 0.01 && (f.drawn ?? 1) > 0.01 && intersects(figureBox(f, f.index !== own), r)) hit.push(i);
  });
  const crossed = ball != null && (ball.opacity ?? 1) > 0.01 && intersects(grownBy(ballBox(ball), ringWidth(ball.height)), r);
  return { figures: hit, ball: crossed };
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
    __theaterTags?: { kind: "pointer" | "leaving" | "key"; text: string; rect: Rect; stem?: { from: Point; to: Point } }[];
  }
}

type Kind = "pointer" | "leaving" | "key" | "handoff";

/** A tag being drawn: which, its man, and what it asked of placement (where round him its stretch put it). */
interface Tag {
  readonly kind: Kind;
  readonly block: Block;
  readonly man: TagFigure;
  readonly member: CastMember;
  readonly ask: TagAsk;
}

/** A scratch canvas for a tag drawn as one layer (fading, it never shows its slab through its type). */
let scratch: HTMLCanvasElement | null = null;

/**
 * A tag's block at `r`, at `opacity`, as one layer (SwiftUI draws a resolved
 * symbol so): whole, it's drawn straight; fading, into a scratch canvas on
 * the device's pixels, then over at its opacity. The context's clip holds.
 */
function drawBlock(ctx: Ctx, block: Block, r: Rect, opacity: number): void {
  if (opacity >= 0.995 || typeof document === "undefined") {
    ctx.save();
    ctx.globalAlpha *= opacity;
    ctx.translate(r.x, r.y);
    block.draw(ctx);
    ctx.restore();
    return;
  }
  const m = ctx.getTransform();
  const xs = [r.x - 1, r.x + r.width + 1];
  const ys = [r.y - 1, r.y + r.height + 1];
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const x of xs) {
    for (const y of ys) {
      left = Math.min(left, m.a * x + m.c * y + m.e);
      top = Math.min(top, m.b * x + m.d * y + m.f);
      right = Math.max(right, m.a * x + m.c * y + m.e);
      bottom = Math.max(bottom, m.b * x + m.d * y + m.f);
    }
  }
  left = Math.floor(left);
  top = Math.floor(top);
  const width = Math.ceil(right) - left;
  const tall = Math.ceil(bottom) - top;
  scratch ??= document.createElement("canvas");
  if (scratch.width < width || scratch.height < tall) {
    scratch.width = Math.max(scratch.width, width);
    scratch.height = Math.max(scratch.height, tall);
  }
  const s = scratch.getContext("2d");
  if (!s || !(width > 0 && tall > 0 && width < 4096 && tall < 4096)) return;
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.clearRect(0, 0, width, tall);
  s.globalAlpha = 1;
  s.setTransform(m.a, m.b, m.c, m.d, m.e - left, m.f - top);
  s.translate(r.x, r.y);
  block.draw(s);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= opacity;
  ctx.drawImage(scratch, 0, 0, width, tall, left, top, width, tall);
  ctx.restore();
}

/** A figure's room as capsules (each a segment and how far round it): his silhouette grown by his outline and the ring, what he holds too. */
function rooms(f: TagFigure): [Point, Point, number][] {
  const g = f.figure;
  const margin = ringWidth(f.height);
  const grown = halo(f.height) + margin;
  const w = g.limb / 2;
  const out: [Point, Point, number][] = [];
  for (const l of g.limbs) out.push([l.root, l.joint, w + grown], [l.joint, l.end, w + grown]);
  out.push([g.hip, g.neck, g.torso / 2 + grown], [g.head, g.head, g.headRadius + grown]);
  if (f.held) out.push([f.held.from, f.held.to, f.held.width / 2 + margin]);
  return out;
}

/** The ball's room: its shape grown by the ring, as a polygon (the oval's offset curve). */
function ballRoom(ctx: Ctx, b: TagBall): void {
  const grow = ringWidth(b.height);
  const a = b.angle ?? 0;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const n = 40;
  for (let k = 0; k < n; k++) {
    const u = (k / n) * 2 * Math.PI;
    // A point on the ellipse and its outward normal, pushed out by the ring.
    const ex = b.rx * Math.cos(u);
    const ey = b.ry * Math.sin(u);
    const nx = b.ry * Math.cos(u);
    const ny = b.rx * Math.sin(u);
    const l = Math.hypot(nx, ny) || 1;
    const x = ex + (nx / l) * grow;
    const y = ey + (ny / l) * grow;
    const px = b.x + x * c - y * s;
    const py = b.y + x * s + y * c;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

const ellipsePath = (ctx: Ctx, b: TagBall) => ctx.ellipse(b.x, b.y, b.rx, b.ry, b.angle ?? 0, 0, 2 * Math.PI);

/**
 * Draws a frame's tags at t, under the play, round their men: placed (the
 * pointer's first, each where its stretch of the `replay` covers it least,
 * raised clear of a crowd where it must be), faded and risen as they come
 * and go, the key man's gliding over to the next, ringed where a figure or
 * the ball crosses one. Drawn after the surface and its shadows, before
 * everything that plays. `clear`: the frame's own type to keep clear of (its
 * stamp, its headline, the pitch's label). Returns the raised tags' stems by
 * the man each reaches, for the theater to draw just before him
 * (`drawStems`).
 */
export function drawTags(
  ctx: Ctx,
  frame: TagFrame | null | undefined,
  figures: readonly TagFigure[],
  t: number,
  size: Size,
  options: { readonly clear?: readonly Rect[]; readonly ring: TagRing; readonly replay?: TheaterReplay | null; readonly ball?: TagBall | null },
): Stems {
  const probe = typeof window !== "undefined" ? window.__theaterTags : undefined;
  if (probe) probe.length = 0;
  if (!frame) return NO_STEMS;
  const { pointer, leaving, key } = shownTags(frame, t);
  const glide = tagHandoff(frame, t);
  if (pointer == null && leaving == null && key == null && glide?.from == null) return NO_STEMS;
  const type = tagType(size.height);
  const status = frame.status && (pointer != null || leaving != null || key != null) ? statusRoomOf(ctx, frame.status, size.height) : null;
  const furniture = [...TheaterTagLayout.furniture(size, status, frame.flip, frame.heartbeat), ...(options.clear ?? [])];
  const replay = options.replay ?? null;
  // Each tag's ask, its spots its stretch's (the key man's while he's key; the pointer's man's the whole replay).
  const ask = (kind: Kind, index: number | null): Tag | null => {
    if (index == null) return null;
    const man = figures.find((g) => g.index === index);
    const member = frame.cast.members.get(index);
    if (!man || !member) return null;
    const label = frame.labels[member.side];
    const full = kind === "pointer" || kind === "leaving";
    const block = cached(ctx, `${member.id}|${member.side}|${full}|${type}|${toHex(label.paint.slab)}|${label.team}|${JSON.stringify(member.who)}`, () => nameTag(ctx, member.who, label, full, type));
    const stretch: Stretch = kind === "key" ? frame.cast.stretch(t) : kind === "handoff" ? (glide?.stretch ?? frame.cast.stretch(t)) : WHOLE;
    const tag = { width: block.width, height: block.height };
    const ranked = replay ? TheaterTagPlan.ranked(index, tag, full, stretch, size, frame.heartbeat, replay, frame.cast.scope) : [];
    return {
      kind,
      block,
      man,
      member,
      ask: { size: tag, head: { x: man.figure.head.x, y: figureTop(man.figure) }, feet: figureFeet(man), pointer: full, spot: ranked[0] ?? tagSpot(), then: ranked.slice(1), ground: man.figure.ground, height: man.height },
    };
  };
  const tags = [ask("pointer", pointer), ask("leaving", leaving), ask("key", key)].filter((a): a is Tag => a != null);
  const spots = TheaterTagLayout.place(
    tags.map((a) => a.ask),
    size,
    furniture,
  );
  // The last key man's tag where it was before the change (placed as if the new one weren't there yet).
  let from: { tag: Tag; rect: Rect } | null = null;
  if (glide) {
    const last = ask("handoff", glide.from);
    if (last) {
      const before = [...tags.filter((a) => a.kind !== "key"), last];
      const was = TheaterTagLayout.place(
        before.map((a) => a.ask),
        size,
        furniture,
      ).at(-1);
      if (was) from = { tag: last, rect: was };
    }
  }
  const stems = new Map<number, Stem[]>();
  const ball = options.ball ?? null;
  const show = (tag: Tag, r: Rect, opacity: number, stem: number) => {
    const drawn = put(ctx, tag, r, opacity, stem, frame, figures, ball, options.ring, size);
    const s = drawn?.stem;
    if (s) stems.set(tag.man.index, [...(stems.get(tag.man.index) ?? []), s]);
    if (probe && drawn && tag.kind !== "handoff") {
      const m = tag.member;
      const text = m.who.kind === "known" ? m.who.person.last : m.who.kind === "assumed" ? `${frame.labels[m.side].team} · ${m.who.position}` : frame.labels[m.side].team;
      probe.push({ kind: tag.kind, text, rect: r, ...(s ? { stem: { from: s.from, to: s.to } } : {}) });
    }
  };
  // The key man's first, the leaving tag over it, the pointer's on top.
  for (let k = tags.length - 1; k >= 0; k--) {
    const tag = tags[k]!;
    let opacity = tag.man.opacity;
    let lift = 0;
    if (tag.kind === "pointer") {
      opacity *= frame.appear;
      if (frame.rise) lift = TheaterPointer.rise * (1 - frame.appear);
    } else if (tag.kind === "leaving") {
      opacity *= frame.remaining;
    }
    const spot = spots[k];
    if (!spot) continue;
    const r = { ...spot, y: spot.y + lift };
    if (tag.kind !== "key" || !glide) {
      show(tag, r, opacity, 1);
      continue;
    }
    // Coming over from the last key man: gliding from his tag's place to this one's, the names crossfading (with Reduce
    // Motion, a crossfade where each stands), the old stem going first and the new one coming last; or fading in.
    const u = glide.u;
    if (from) {
      const was = from.rect;
      const at = (q: Rect): Rect => {
        if (!frame.rise) return q;
        const x = was.x + was.width / 2 + (r.x + r.width / 2 - (was.x + was.width / 2)) * u;
        const y = was.y + was.height / 2 + (r.y + r.height / 2 - (was.y + was.height / 2)) * u;
        return { x: x - q.width / 2, y: y - q.height / 2, width: q.width, height: q.height };
      };
      show(from.tag, at(was), from.tag.man.opacity * (1 - u), Math.max(1 - u / 0.4, 0));
      show(tag, at(r), opacity * u, Math.max((u - 0.6) / 0.4, 0));
    } else {
      show(tag, r, opacity * u, u);
    }
  }
  // The last key man's going with nobody after him: it fades where it stands.
  if (key == null && glide && from) show(from.tag, from.rect, from.tag.man.opacity * (1 - glide.u), 1);
  return stems;
}

/**
 * One tag at `r`, and the room round whoever crosses it; its stem to him
 * when it's raised clear of him (`stem`: how much of it), for the theater to
 * draw with him.
 */
function put(ctx: Ctx, tag: Tag, r: Rect, faded: number, stem: number, frame: TagFrame, figures: readonly TagFigure[], ball: TagBall | null, ring: TagRing, size: Size): { stem: Stem | null } | null {
  const opacity = faded * tagEntering(tag.ask, size);
  if (!(opacity > 0.005)) return null;
  const paint = frame.labels[tag.member.side].paint;
  const known = tag.member.who.kind === "known";
  const line = stem < 0.01 ? null : TheaterTagLayout.stem(r, tag.ask, size);
  const out: Stem | null = line ? { ...line, color: known ? toHex(paint.slab) : rgbaOf(paint.slab, 0.7), width: stemWidth(tag.man.height), opacity: opacity * stem } : null;
  // Who crosses the tag itself.
  const crossing = tagCrossing(figures, ball, r, tag.man.index);
  if (crossing.figures.length === 0 && !crossing.ball) {
    drawBlock(ctx, tag.block, r, opacity);
    return { stem: out };
  }
  if (ring.kind === "paint") {
    // A ring in a paint: round each man over the tag, faded with it (and with him).
    drawBlock(ctx, tag.block, r, opacity);
    ctx.save();
    lean(ctx, r.x, r.y, r.width, r.height);
    ctx.clip();
    ctx.fillStyle = ring.color;
    ctx.strokeStyle = ring.color;
    const base = ctx.globalAlpha * opacity;
    for (const i of crossing.figures) {
      const f = figures[i]!;
      const w = ringWidth(f.height);
      ctx.globalAlpha = base * (f.drawn ?? f.opacity);
      figureOutline(ctx, f.figure, f.height, w);
      ctx.fill();
      if (f.held) {
        ctx.beginPath();
        ctx.moveTo(f.held.from.x, f.held.from.y);
        ctx.lineTo(f.held.to.x, f.held.to.y);
        ctx.lineWidth = f.held.width + 2 * w;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }
    if (crossing.ball && ball) {
      ctx.globalAlpha = base * (ball.opacity ?? 1);
      ctx.beginPath();
      ellipsePath(ctx, ball);
      ctx.fill();
      ctx.lineWidth = 2 * ringWidth(ball.height);
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    ctx.restore();
    return { stem: out };
  }
  // The tag with each man's room cut out of it, so the surface shows round him: a clip, as the charts leave room round
  // their marks (never a blend). Canvas has no path subtraction: the tag's rect less each capsule of each room, one clip
  // at a time (the rect and the capsule together, even-odd: the rect outside it), so their union is cut. One fading in or
  // out takes his room with him: the tag there at what's left.
  const box = { x: r.x - 1, y: r.y - 1, width: r.width + 2, height: r.height + 2 };
  const parts: { room: (c: Ctx) => void; capsules: [Point, Point, number][]; seen: number }[] = [];
  for (const i of crossing.figures) {
    const f = figures[i]!;
    const capsules = rooms(f);
    parts.push({ room: (c) => capsules.forEach(([a, b, w]) => capsule(c, a, b, w)), capsules, seen: f.drawn ?? f.opacity });
  }
  if (crossing.ball && ball) parts.push({ room: (c) => ballRoom(c, ball), capsules: [], seen: ball.opacity ?? 1 });
  ctx.save();
  for (const part of parts) {
    const cuts = part.capsules.length > 0 ? part.capsules.map((cap) => (c: Ctx) => capsule(c, ...cap)) : [part.room];
    for (const cut of cuts) {
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.width, box.height);
      cut(ctx);
      ctx.clip("evenodd");
    }
  }
  drawBlock(ctx, tag.block, r, opacity);
  ctx.restore();
  for (const part of parts) {
    if (!(part.seen < 0.99)) continue;
    ctx.save();
    ctx.beginPath();
    part.room(ctx);
    ctx.clip();
    drawBlock(ctx, tag.block, r, opacity * (1 - part.seen));
    ctx.restore();
  }
  return { stem: out };
}

/** A capsule round a segment, wound as rigFigure's are (so any number of them fill as their union). */
function capsule(ctx: Ctx, a: Point, b: Point, r: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const angle = dx * dx + dy * dy > 1e-12 ? Math.atan2(dy, dx) : 0;
  const nx = -Math.sin(angle) * r;
  const ny = Math.cos(angle) * r;
  ctx.moveTo(b.x + nx, b.y + ny);
  ctx.arc(b.x, b.y, r, angle + Math.PI / 2, angle - Math.PI / 2, true);
  ctx.arc(a.x, a.y, r, angle - Math.PI / 2, angle - (3 * Math.PI) / 2, true);
  ctx.closePath();
}

/** A color in its OKLab at an alpha, as CSS. */
function rgbaOf(c: OKLab, alpha: number): string {
  const hex = toHex(c);
  const v = Number.parseInt(hex.slice(1, 7), 16);
  return `rgb(${(v >> 16) & 0xff} ${(v >> 8) & 0xff} ${v & 0xff} / ${alpha})`;
}
