/**
 * The odds chart's geometry (ODDS-SPEC.md, "The chart"), pure so a frame is
 * a function of its inputs and the tests can hold it to the spec:
 *
 * - One axis, 0–100%, the top team up: a tug-of-war, the 50% midline
 *   between. Never two y-scales.
 * - The domain: the game's span on the wall clock (start of play, or the
 *   scheduled start, to now while live, to the final play when over), the
 *   last 24 hours of the market before a game, or a sliding 10 minutes.
 * - The Polymarket line split exactly at 50% (each side in its team's
 *   color), with the area between it and the midline.
 * - The live end's badge: right of the dot, never clipped (the right edge is
 *   reserved for it; at 0% or 100% it slides inside the plot).
 * - The scrub: a crosshair that snaps to the nearest minute.
 * - The glide: a new value eases in over 0.5 s on Liveline's curve (8% of the
 *   way per 60 Hz frame), then the chart stops drawing.
 */
import type { PeriodMark, WinPoint } from "./espn";
import type { PricePoint } from "./polymarket";

export type OddsWindow = "game" | "10m";
export type GameState = "scheduled" | "live" | "final";

export interface Domain {
  readonly from: number;
  readonly to: number;
}

const MINUTE = 60_000;
export const TEN_MINUTES = 10 * MINUTE;
const DAY = 24 * 60 * MINUTE;

/**
 * The game's span on the wall clock: from the first play (else the scheduled
 * start) to the newest price while live (a quiet market's price is repeated
 * at now once a minute, so it keeps up), to the final play when over. Before
 * the game: the market's last 24 hours (or since it opened) to its newest price.
 */
export function gameDomain(input: { state: GameState; scheduled: number; start: number | null; end: number | null; now: number; firstPrice: number | null; lastPrice: number | null }): Domain {
  const { state, scheduled, start, end, now, firstPrice, lastPrice } = input;
  if (state === "scheduled") {
    const to = lastPrice ?? now;
    const from = Math.max(to - DAY, firstPrice ?? to - DAY);
    return { from, to: Math.max(to, from + MINUTE) };
  }
  const from = start ?? scheduled;
  if (state === "live") return { from, to: Math.max(lastPrice ?? now, from + MINUTE) };
  const to = end ?? lastPrice ?? from + 3 * 60 * MINUTE;
  return { from, to: Math.max(to, from + MINUTE) };
}

/** The window's domain: the whole game, or its last 10 minutes. */
export function windowDomain(game: Domain, window: OddsWindow): Domain {
  return window === "10m" ? { from: game.to - TEN_MINUTES, to: game.to } : game;
}

// MARK: - Layout

export interface Plot {
  /** The canvas, in points. */
  readonly width: number;
  readonly height: number;
  /** The plot inside it. */
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export const DOT_RADIUS = 4;
export const RING = 2;
export const BADGE_HEIGHT = 18;
export const BADGE_TAIL = 4;
/** From the dot's center to the badge's pill (dot 4 + gap 3 + tail 4); the tail's tip is 7 from it. */
export const BADGE_OFFSET = 11;
/** The team abbreviations' gutter at the left. */
export const GUTTER = 30;
/** Above 100% and below 0%: room for the dot and the badge. */
export const PLOT_INSET = 10;

/** The plot inside a canvas: the gutter at the left, the badge's room at the right (`pillWidth` measured once for "<abbr> 100%"). */
export function plotIn(width: number, height: number, pillWidth: number, reserveBadge: boolean): Plot {
  const top = PLOT_INSET;
  const bottom = height - PLOT_INSET;
  const right = width - (reserveBadge ? pillWidth + BADGE_OFFSET + 2 : DOT_RADIUS + RING + 2);
  return { width, height, left: GUTTER, right: Math.max(right, GUTTER + 1), top, bottom: Math.max(bottom, top + 1) };
}

export const xOf = (plot: Plot, d: Domain) => (t: number) => plot.left + ((t - d.from) / Math.max(d.to - d.from, 1)) * (plot.right - plot.left);
/** Chance for the top team → y: 100% at the top, 0% at the bottom. */
export const yOf = (plot: Plot) => (p: number) => plot.top + (1 - Math.min(Math.max(p, 0), 1)) * (plot.bottom - plot.top);
export const midY = (plot: Plot) => yOf(plot)(0.5);

/**
 * The live end's badge (tail and pill): right of the dot, its tail's tip 7pt
 * from the dot's center, vertically centered on the dot but never outside the
 * canvas (at 0% or 100% the pill is held inside, and its tail moves along its
 * straight edge to keep pointing at the dot). Its right edge never passes the
 * canvas's: the plot reserves the room.
 */
export function badgeRect(plot: Plot, dot: { x: number; y: number }, pillWidth: number): { x: number; y: number; width: number; height: number; tail: number } {
  const h = BADGE_HEIGHT;
  const width = pillWidth + BADGE_TAIL;
  const x = Math.min(dot.x + BADGE_OFFSET - BADGE_TAIL, plot.width - width);
  const y = Math.min(Math.max(dot.y - h / 2, 0), plot.height - h);
  // Where the tail meets the dot's height, along the pill's left edge (kept off its rounded ends).
  const tail = Math.min(Math.max(dot.y - y, h / 2 - 3), h / 2 + 3);
  return { x, y, width, height: h, tail };
}

// MARK: - The line, split at 50%

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export interface Run {
  /** Above the midline: the top team's; below: the bottom team's. */
  readonly side: "top" | "bottom";
  readonly points: readonly Pt[];
}

/**
 * A polyline cut where it crosses the midline, the crossing interpolated
 * exactly onto it, so each run is wholly one side's (and is colored and
 * filled as that side). A point on the midline belongs to the run it ends.
 */
export function splitAtMid(points: readonly Pt[], mid: number): Run[] {
  const runs: Run[] = [];
  let current: Pt[] = [];
  let side: "top" | "bottom" | null = null;
  const sideOf = (p: Pt): "top" | "bottom" | null => (p.y < mid ? "top" : p.y > mid ? "bottom" : null);
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const s = sideOf(p);
    if (side == null) {
      current.push(p);
      side = s;
      continue;
    }
    if (s == null || s === side) {
      current.push(p);
      continue;
    }
    // Crossed: end this run on the midline, start the next there.
    const prev = points[i - 1]!;
    const f = (mid - prev.y) / (p.y - prev.y);
    const cross = { x: prev.x + (p.x - prev.x) * f, y: mid };
    current.push(cross);
    runs.push({ side, points: current });
    current = [cross, p];
    side = s;
  }
  if (current.length) runs.push({ side: side ?? "top", points: current });
  return runs;
}

// MARK: - Series in a domain

/** The value at a moment: the last price at or before it (a price holds until it changes); null before the first. */
export function valueAt<T extends { readonly t: number }>(points: readonly T[], t: number): T | null {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? points[lo - 1]! : null;
}

/**
 * The points to draw in a domain: the price at its start (carried in from
 * before), those inside it, and the end at the domain's right edge: `end`
 * (the live value, gliding), else the last price held there.
 */
export function visible(points: readonly PricePoint[], d: Domain, end: number | null): PricePoint[] {
  const out: PricePoint[] = [];
  const opening = valueAt(points, d.from);
  if (opening) out.push({ t: d.from, p: opening.p });
  for (const p of points) if (p.t > d.from && p.t <= d.to) out.push(p);
  const last = out.at(-1);
  if (!last) return out;
  if (last.t >= d.to) out[out.length - 1] = { t: d.to, p: end ?? last.p };
  else out.push({ t: d.to, p: end ?? last.p });
  return out;
}

/** ESPN's model in a domain, carried in from before its start like the prices. */
export function visibleWin(points: readonly WinPoint[], d: Domain): WinPoint[] {
  const out: WinPoint[] = [];
  const opening = valueAt(points, d.from);
  if (opening) out.push({ ...opening, t: d.from });
  for (const p of points) if (p.t > d.from && p.t <= d.to) out.push(p);
  return out;
}

// MARK: - The scrub

/** The minute under a pointer: the nearest whole minute of the wall clock, inside the domain. */
export function scrubTime(x: number, plot: Plot, d: Domain): number {
  const f = (x - plot.left) / Math.max(plot.right - plot.left, 1);
  const t = d.from + Math.min(Math.max(f, 0), 1) * (d.to - d.from);
  const snapped = Math.round(t / MINUTE) * MINUTE;
  // A minute boundary just outside the domain snaps back to the nearest one inside it.
  if (snapped < d.from) return Math.ceil(d.from / MINUTE) * MINUTE <= d.to ? Math.ceil(d.from / MINUTE) * MINUTE : d.from;
  if (snapped > d.to) return Math.floor(d.to / MINUTE) * MINUTE >= d.from ? Math.floor(d.to / MINUTE) * MINUTE : d.to;
  return snapped;
}

// MARK: - Periods under the plot

export interface PeriodLabel {
  readonly label: string;
  /** Center, in points. */
  readonly x: number;
}

/**
 * Period dividers (each period's start but the first, inside the domain)
 * and labels centered in each period's span, a label dropped where it
 * wouldn't fit (`measure` gives its width).
 */
export function periodGuides(periods: readonly PeriodMark[], d: Domain, plot: Plot, measure: (s: string) => number): { dividers: number[]; labels: PeriodLabel[] } {
  const x = xOf(plot, d);
  const dividers: number[] = [];
  const labels: PeriodLabel[] = [];
  let lastRight = -Infinity;
  periods.forEach((p, i) => {
    const next = periods[i + 1]?.t ?? d.to;
    const from = Math.max(p.t, d.from);
    const to = Math.min(next, d.to);
    if (i > 0 && p.t > d.from && p.t < d.to) dividers.push(x(p.t));
    if (to <= from) return;
    const width = measure(p.label);
    const center = (x(from) + x(to)) / 2;
    // Centered on its span; skipped when it doesn't fit with 4pt either side (a sliver at the window's edge goes unnamed).
    if (width + 8 > x(to) - x(from) || center - width / 2 < lastRight + 4) return;
    labels.push({ label: p.label, x: center });
    lastRight = center + width / 2;
  });
  return { dividers, labels };
}

// MARK: - Motion

/** The glide's length: a new value eases in over half a second, then nothing draws. */
export const GLIDE_MS = 500;

/**
 * Liveline's ease (8% of the remaining way per 60 Hz frame), normalized so it
 * lands exactly at `GLIDE_MS`: fast at first, settling. 0…1.
 */
export function glideProgress(elapsed: number): number {
  if (elapsed <= 0) return 0;
  if (elapsed >= GLIDE_MS) return 1;
  const frames = GLIDE_MS / (1000 / 60);
  return (1 - 0.92 ** ((elapsed / GLIDE_MS) * frames)) / (1 - 0.92 ** frames);
}

/** Which team's chance is rising (the chevron's color and direction): a move of 0.2 points or more, else none. */
export function momentum(previous: number | null, next: number | null, epsilon = 0.002): "top" | "bottom" | null {
  if (previous == null || next == null || Math.abs(next - previous) < epsilon) return null;
  return next > previous ? "top" : "bottom";
}

/** The chevron fades out after this long without a change. */
export const MOMENTUM_HOLD_MS = 5000;

// MARK: - Words

/** Whole points, never 0 or 100 while it's undecided: "100%" is for the final whistle (Odds.swift `OddsSeries.percent`). */
export function chance(p: number, final = false): number {
  const whole = Math.round(p * 100);
  return final ? Math.min(Math.max(whole, 0), 100) : Math.min(Math.max(whole, 1), 99);
}

export const percent = (p: number, final = false) => `${chance(p, final)}%`;

/** Both teams' chances from the top team's, as complements that add up to 100 ("49%" and "51%", never 52%). */
export function percentPair(top: number, final = false): [string, string] {
  const whole = chance(top, final);
  return [`${whole}%`, `${100 - whole}%`];
}

/** The same, spoken. */
export const spokenPercent = (p: number, final = false) => `${chance(p, final)} percent`;

/** "$4.1M", "$850K", "$12K", "$900" (Odds.swift `OddsSeries.dollars`). */
export function dollars(value: number): string {
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1e4) return `$${Math.round(value / 1e3)}K`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${Math.round(value)}`;
}

/** "$3.1M traded", or nothing when the volume isn't known. */
export function traded(volume: number | null): string | null {
  return volume == null || !Number.isFinite(volume) || volume <= 0 ? null : `${dollars(volume)} traded`;
}

/**
 * Before the game (no periods): whole hours of the wall clock, the smallest
 * step of 1, 2, 3, 6 or 12 hours that keeps labels 56pt apart, none within
 * 14pt of the plot's ends. `hourOf` gives an hour's label ("5 PM").
 */
export function hourTicks(d: Domain, plot: Plot, label: (t: number) => string): { label: string; x: number }[] {
  const x = xOf(plot, d);
  const perHour = ((plot.right - plot.left) * 3_600_000) / Math.max(d.to - d.from, 1);
  const step = [1, 2, 3, 6, 12].find((h) => h * perHour >= 56) ?? 24;
  const out: { label: string; x: number }[] = [];
  // Whole hours of the local clock (setHours steps through daylight saving's changes).
  const hour = new Date(d.from);
  hour.setMinutes(0, 0, 0);
  if (hour.getTime() < d.from) hour.setHours(hour.getHours() + 1);
  for (; hour.getTime() <= d.to; hour.setHours(hour.getHours() + 1)) {
    if (hour.getHours() % step !== 0) continue;
    const px = x(hour.getTime());
    if (px >= plot.left + 14 && px <= plot.right - 14) out.push({ label: label(hour.getTime()), x: px });
  }
  return out;
}

export interface HeaderFigure {
  /** The chance shown (soccer: its share of the three). */
  readonly value: number;
  readonly text: string;
}

/**
 * The header row's figures: the newest price while live and before the game;
 * on a final the last price, which for a resolved market is its resolution
 * ("GSW 100% · 0% MIN", as the Mac writes it; 100% only once it's over). A
 * two-way market's sides are complements that add up to 100; soccer's three
 * are each one's share.
 */
export function headerFigures(
  series: Readonly<Partial<Record<"top" | "draw" | "bottom", readonly PricePoint[]>>>,
  current: Readonly<Partial<Record<"top" | "draw" | "bottom", number>>>,
  threeWay: boolean,
  final: boolean,
): { top: HeaderFigure | null; draw: HeaderFigure | null; bottom: HeaderFigure | null } {
  const read = (o: "top" | "draw" | "bottom") => (final ? (series[o]?.at(-1)?.p ?? current[o]) : (current[o] ?? series[o]?.at(-1)?.p)) ?? null;
  if (threeWay) {
    const a = read("top");
    const d = read("draw");
    const b = read("bottom");
    if (a == null || d == null || b == null) return { top: null, draw: null, bottom: null };
    const s = shares(a, d, b);
    const figure = (v: number) => ({ value: v, text: percent(v, final) });
    return { top: figure(s.top), draw: figure(s.draw), bottom: figure(s.bottom) };
  }
  const a = read("top");
  if (a == null) return { top: null, draw: null, bottom: null };
  const [top, bottom] = percentPair(a, final);
  return { top: { value: a, text: top }, draw: null, bottom: { value: 1 - a, text: bottom } };
}

/** TheaterStatus.swift `TheaterHeartbeat.label`: "Live · 4s", then "Waiting for Polymarket · 2m". */
export function heartbeat(seconds: number, source = "Polymarket"): string {
  const s = Math.max(Math.floor(seconds), 0);
  return s < 60 ? `Live · ${s}s` : `Waiting for ${source} · ${Math.floor(s / 60)}m`;
}

/** Soccer's three outcomes as shares of 100% (the Yes prices needn't sum to 1). */
export function shares(top: number, draw: number, bottom: number): { top: number; draw: number; bottom: number } {
  const sum = top + draw + bottom;
  if (!(sum > 0)) return { top: 1 / 3, draw: 1 / 3, bottom: 1 / 3 };
  return { top: top / sum, draw: draw / sum, bottom: bottom / sum };
}
