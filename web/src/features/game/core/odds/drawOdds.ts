/**
 * The odds chart on one canvas (ODDS-SPEC.md, "The chart"): a frame is a
 * function of its inputs, drawn whole when something changes and on each
 * frame of a 0.5 s glide, never otherwise. The pulse, the badge and the
 * chevron are DOM layers over it (OddsChart.tsx), so time passing costs the
 * canvas nothing.
 *
 * Two-way (a tug-of-war, up is the top team): 0.5pt period dividers in the
 * grid's ink, the 1pt midline, ESPN's model as a 2pt line in primary ink at
 * 28% (light) / 32% (dark), the area between Polymarket's line and the
 * midline in each side's color (10% light, 14% dark), the line itself (2pt,
 * round caps and joins) in the top team's color above 50% and the bottom
 * team's below, over a soft glow of the same color (3pt, blur 6pt; 18% light,
 * 35% dark), DraftKings' pregame line as a neutral diamond at the left edge
 * with a 24pt stub, and a 2pt ring cut where the end's dot sits (the dot is a
 * DOM layer). Separations are cut out of the canvas, so they are the surface
 * itself, whatever it is. Values from ODDS-DECISIONS.md (the Mac's).
 *
 * Three-way (soccer): a 100% stacked area, top win over the draw over bottom
 * win, team colors at 22% (light) / 26% (dark) and the neutral at the same
 * strength, 2pt surface gaps between the bands with each team band's inner
 * edge drawn 2pt in its color, and three DraftKings diamonds.
 */
import { DOT_RADIUS, RING, midY, shares, splitAtMid, valueAt, visible, visibleWin, xOf, yOf, type Domain, type Plot, type Pt } from "../../../../data/odds/chart";
import type { Pregame, WinPoint } from "../../../../data/odds/espn";
import type { PricePoint } from "../../../../data/odds/polymarket";

/** Concrete colors (canvas can't read CSS variables): `rgb()` strings. */
export interface OddsInk {
  readonly top: string;
  readonly bottom: string;
  /** The draw's and DraftKings' neutral (`--viz-neutral`, primary at 55%). */
  readonly draw: string;
  /** The midline's gray and the stub (`--viz-reference`, primary at 35%). */
  readonly reference: string;
  /** Period dividers (`--viz-grid`, primary at 10%). */
  readonly grid: string;
  /** Primary ink, opaque: ESPN's line takes it at 28% (light) / 32% (dark). */
  readonly primary: string;
  readonly dark: boolean;
}

export interface TwoWayFrame {
  readonly kind: "two-way";
  /** The top team's prices; the newest point's value is the glide's. */
  readonly series: readonly PricePoint[];
  /** The top team's value at the domain's end (gliding), or null to hold the last price. */
  readonly end: number | null;
  readonly win: readonly WinPoint[];
  readonly pregame: Pregame | null;
}

export interface ThreeWayFrame {
  readonly kind: "three-way";
  readonly top: readonly PricePoint[];
  readonly draw: readonly PricePoint[];
  readonly bottom: readonly PricePoint[];
  /** The three shares at the domain's end (gliding), or null. */
  readonly end: { readonly top: number; readonly draw: number; readonly bottom: number } | null;
  readonly pregame: Pregame | null;
}

export interface Frame {
  readonly plot: Plot;
  readonly domain: Domain;
  readonly dividers: readonly number[];
  readonly body: TwoWayFrame | ThreeWayFrame;
  /** Cut the end's ring (live and before the game; a final ends quietly). The dot itself is a DOM layer. */
  readonly endDot: boolean;
  /** DraftKings' marks (not in the 10-minute window, where the left edge is ten minutes ago, not the start). */
  readonly pregame: boolean;
  /** Polymarket's layer fading in as its history lands (0…1). */
  readonly reveal: number;
}

/** Where the end's dot was drawn, and in whose color: the DOM layers follow it. */
export interface Drawn {
  readonly dot: Pt | null;
  readonly leader: "top" | "bottom" | "draw" | null;
}

/** `rgb(r, g, b)` (or `rgba`) at an alpha, multiplying any alpha it has. */
export function withAlpha(color: string, alpha: number): string {
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (!m) return color;
  const parts = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
  const [r = 0, g = 0, b = 0, a = 1] = parts;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a * alpha))})`;
}

/** The ink's alpha (1 for an opaque color). */
export function alphaOf(color: string): number {
  const m = /rgba?\(([^)]+)\)/.exec(color);
  const parts = m ? m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number) : [];
  return parts[3] ?? 1;
}

/** Cut a shape out of the canvas: the separations are the surface itself. */
function erase(ctx: CanvasRenderingContext2D, path: () => void): void {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#000";
  ctx.beginPath();
  path();
  ctx.fill();
  ctx.restore();
}

function polyline(ctx: CanvasRenderingContext2D, points: readonly Pt[]): void {
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
}

const diamond = (ctx: CanvasRenderingContext2D, x: number, y: number, half: number) => {
  ctx.moveTo(x, y - half);
  ctx.lineTo(x + half, y);
  ctx.lineTo(x, y + half);
  ctx.lineTo(x - half, y);
  ctx.closePath();
};

/** DraftKings' pregame mark: an 8pt diamond with a 2pt surface ring, and a 24pt hairline stub to its right. */
function pregameMark(ctx: CanvasRenderingContext2D, x: number, y: number, fill: string, stub: string | null): void {
  if (stub) {
    ctx.strokeStyle = stub;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 24, y);
    ctx.stroke();
  }
  erase(ctx, () => diamond(ctx, x, y, 4 + RING * 1.41));
  ctx.fillStyle = fill;
  ctx.beginPath();
  diamond(ctx, x, y, 4.5);
  ctx.fill();
}

/** The end's 2pt ring, cut around where the dot sits (the dot is a DOM layer over it, so it can dim and glide alone). */
function endRing(ctx: CanvasRenderingContext2D, p: Pt): void {
  erase(ctx, () => ctx.arc(p.x, p.y, DOT_RADIUS + RING, 0, Math.PI * 2));
}

/** Draws a frame into a context already scaled to points (and cleared). `glow` is the blur in device pixels. */
export function drawOdds(ctx: CanvasRenderingContext2D, frame: Frame, ink: OddsInk, glowBlur: number): Drawn {
  const { plot, domain, dividers } = frame;
  const x = xOf(plot, domain);
  const y = yOf(plot);

  // Period dividers: 0.5pt hairlines in the grid's ink (about 30% of the midline's).
  if (dividers.length) {
    ctx.strokeStyle = ink.grid;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (const d of dividers) {
      ctx.moveTo(d, plot.top);
      ctx.lineTo(d, plot.bottom);
    }
    ctx.stroke();
  }

  if (frame.body.kind === "three-way") return drawThreeWay(ctx, frame, frame.body, ink);
  const body = frame.body;
  const mid = midY(plot);

  // The midline.
  ctx.strokeStyle = ink.reference;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.left, Math.round(mid) + 0.5);
  ctx.lineTo(plot.right, Math.round(mid) + 0.5);
  ctx.stroke();

  const points = visible(body.series, domain, body.end).map((p) => ({ x: x(p.t), y: y(p.p) }));
  const runs = splitAtMid(points, mid);
  const color = (side: "top" | "bottom") => (side === "top" ? ink.top : ink.bottom);

  // ESPN's model: the reference, under the star (primary at 28% light, 32% dark).
  const espn = visibleWin(body.win, domain);
  if (espn.length > 1) {
    ctx.strokeStyle = withAlpha(ink.primary, ink.dark ? 0.32 : 0.28);
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    polyline(
      ctx,
      espn.map((w) => ({ x: x(w.t), y: y(w.top) })),
    );
    ctx.stroke();
  }

  ctx.save();
  ctx.globalAlpha = frame.reveal;
  // The area between the line and the midline, each side's.
  for (const run of runs) {
    if (run.points.length < 2) continue;
    ctx.fillStyle = withAlpha(color(run.side), ink.dark ? 0.14 : 0.1);
    ctx.beginPath();
    polyline(ctx, run.points);
    ctx.lineTo(run.points.at(-1)!.x, mid);
    ctx.lineTo(run.points[0]!.x, mid);
    ctx.closePath();
    ctx.fill();
  }

  // Polymarket: one path, stroked twice through a clip at the midline (above, the top team's color; below,
  // the bottom team's), so it's one continuous line that changes color exactly at 50%, with no caps where it
  // crosses. Under it, a soft glow of the same colors.
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const halves: readonly ["top" | "bottom", number, number][] = [
    ["top", -plot.height, mid],
    ["bottom", mid, plot.height * 2],
  ];
  for (const pass of ["glow", "line"] as const) {
    for (const [side, from, to] of halves) {
      if (points.length < 2) break;
      ctx.save();
      ctx.beginPath();
      ctx.rect(-plot.width, from, plot.width * 3, to - from);
      ctx.clip();
      if (pass === "glow") {
        // The line stroked 3pt at 18% (light) / 35% (dark), blurred 6pt.
        const glow = withAlpha(color(side), ink.dark ? 0.35 : 0.18);
        ctx.strokeStyle = glow;
        ctx.shadowColor = glow;
        ctx.shadowBlur = glowBlur;
        ctx.lineWidth = 3;
      } else {
        ctx.strokeStyle = color(side);
        ctx.lineWidth = 2;
      }
      ctx.beginPath();
      polyline(ctx, points);
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.restore();

  // DraftKings: where the books opened, over the lines (cleared around by its ring).
  if (body.pregame && frame.pregame) pregameMark(ctx, plot.left + 5, y(body.pregame.top), ink.draw, ink.reference);

  const last = points.at(-1) ?? null;
  const value = body.end ?? (body.series.length ? valueAt(body.series, domain.to)?.p ?? null : null);
  const leader = value == null ? null : value >= 0.5 ? "top" : "bottom";
  if (frame.endDot && last && leader && frame.reveal > 0) endRing(ctx, last);
  return { dot: last, leader };
}

function drawThreeWay(ctx: CanvasRenderingContext2D, frame: Frame, body: ThreeWayFrame, ink: OddsInk): Drawn {
  const { plot, domain } = frame;
  const x = xOf(plot, domain);
  const h = plot.bottom - plot.top;
  // One column a minute (the outcomes' prices land seconds apart; read together at each minute's end, they
  // don't stair-step), each outcome's price then, as shares of 100%.
  const MINUTE = 60_000;
  const minutes = new Set<number>();
  for (const series of [body.top, body.draw, body.bottom]) for (const p of series) if (p.t > domain.from && p.t <= domain.to) minutes.add(Math.floor(p.t / MINUTE));
  if (body.top.length === 0) return { dot: null, leader: null };
  const times = [domain.from, ...[...minutes].sort((a, b) => a - b).map((m) => Math.min((m + 1) * MINUTE - 1, domain.to)), domain.to].filter((t, i, all) => i === 0 || t > all[i - 1]!);
  const at = (t: number) => {
    if (t === domain.to && body.end) return body.end;
    const a = valueAt(body.top, t)?.p ?? body.top[0]?.p ?? 1 / 3;
    const d = valueAt(body.draw, t)?.p ?? body.draw[0]?.p ?? 1 / 3;
    const b = valueAt(body.bottom, t)?.p ?? body.bottom[0]?.p ?? 1 / 3;
    return shares(a, d, b);
  };
  const columns = times.map((t) => ({ x: x(t), s: at(t) }));
  const first = plot.top;
  const upper = columns.map((c) => ({ x: c.x, y: first + c.s.top * h }));
  const lower = columns.map((c) => ({ x: c.x, y: first + (c.s.top + c.s.draw) * h }));
  const alpha = ink.dark ? 0.26 : 0.22;
  // A team with no usable color is drawn neutral: the draw then steps lighter, so the three bands stay apart.
  const neutralTeam = ink.top === ink.draw || ink.bottom === ink.draw;

  const band = (edgeA: readonly Pt[], edgeB: readonly Pt[], color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    polyline(ctx, edgeA);
    for (let i = edgeB.length - 1; i >= 0; i--) ctx.lineTo(edgeB[i]!.x, edgeB[i]!.y);
    ctx.closePath();
    ctx.fill();
  };
  ctx.save();
  ctx.globalAlpha = frame.reveal;
  const topEdge = columns.map((c) => ({ x: c.x, y: plot.top }));
  const bottomEdge = columns.map((c) => ({ x: c.x, y: plot.bottom }));
  band(topEdge, upper, withAlpha(ink.top, alpha));
  // The draw: the neutral gray (itself an ink at 55%) at the same strength, so it sits back between the teams.
  band(upper, lower, withAlpha(ink.draw, neutralTeam ? alpha * 0.45 : alpha));
  band(lower, bottomEdge, withAlpha(ink.bottom, alpha));

  // 2pt surface gaps between the bands.
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  for (const edge of [upper, lower]) {
    ctx.beginPath();
    polyline(ctx, edge);
    ctx.stroke();
  }
  ctx.restore();

  // Each team band's inner edge carries a 2pt line in its color, just inside the gap: the tug-of-war's line,
  // the draw the space between.
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const [edge, color, shift] of [
    [upper, ink.top, -2],
    [lower, ink.bottom, 2],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    polyline(
      ctx,
      edge.map((p) => ({ x: p.x, y: Math.min(Math.max(p.y + shift, plot.top + 1), plot.bottom - 1) })),
    );
    ctx.stroke();
  }
  ctx.restore();

  // DraftKings: a diamond per outcome at its pregame share, in the middle of where its band would be.
  if (body.pregame && body.pregame.draw != null && frame.pregame) {
    const p = shares(body.pregame.top, body.pregame.draw, body.pregame.bottom);
    const cx = plot.left + 5;
    pregameMark(ctx, cx, first + (p.top / 2) * h, ink.top, null);
    pregameMark(ctx, cx, first + (p.top + p.draw / 2) * h, ink.draw, null);
    pregameMark(ctx, cx, first + (p.top + p.draw + p.bottom / 2) * h, ink.bottom, null);
  }

  // The end: a dot in the middle of the leading outcome's band.
  const end = columns.at(-1)!;
  const s = end.s;
  const leader = s.top >= s.draw && s.top >= s.bottom ? "top" : s.bottom >= s.draw ? "bottom" : "draw";
  const center = leader === "top" ? s.top / 2 : leader === "draw" ? s.top + s.draw / 2 : s.top + s.draw + s.bottom / 2;
  const dot = { x: end.x, y: first + center * h };
  if (frame.endDot && frame.reveal > 0) endRing(ctx, dot);
  return { dot, leader };
}
