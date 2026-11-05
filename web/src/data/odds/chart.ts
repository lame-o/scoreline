/**
 * Win Probability's chart, following Polymarket (OddsChart.swift at HEAD,
 * 5364680 onward), as pure data and geometry so a frame is a function of
 * its inputs: one line per outcome on a fixed 0–100% scale, each in its
 * team's color (soccer's draw in a neutral that recedes toward the surface),
 * each ending in a dot and a label that dodges its neighbors as a cluster.
 * Lines break over stretches nobody observed (`GAP`). The legend above is
 * every outcome's chance, summing to 100 (`percents`); pointing reads that
 * moment (`OddsReading`) into the legend, the sources line and the footer,
 * so nothing covers the lines.
 *
 * Lengths are Mac points; times are epoch ms (the Swift's seconds × 1000).
 */
import type { EventState } from "../models";
import { chroma, hue, oklabFromHex, toHex, type Scheme } from "../teamColors";
import { playAtOrBefore, type OddsBasis, type OddsPeriod, type WinPoint } from "./espn";
import { effectiveWindow, historyDomain, historyNow, shownUntil, windowPeriod, GAME, type Domain, type MatchHistory, type OddsWindow } from "./history";
import { GAP, lastAtOrBefore, percent, share, stacked, type Market, type OddsSplit, type OddsSplitPoint, type Outcome, type PricePoint } from "./polymarket";
import { momentHeadline, shortClock, type TimelineMark } from "./marks";

// MARK: - Style (OddsStyle)

/** The 0/50/100 labels' column at the left. */
export const GUTTER = 30;
/** Room above 100% and below 0%, so the end dots stay whole. */
export const INSET = 10;
/** The period names under the plot. */
export const AXIS = 15;
export const DOT = 8;
/** A final's ends: smaller, as nothing more is coming. */
export const FINAL_DOT = 6;
export const LINE = 2;
/** A new value glides in over this long (ms). */
export const GLIDE_MS = 500;
/** The pulse: from the dot to this, every `PULSE_PERIOD_MS`. */
export const PULSE = 22;
export const PULSE_PERIOD_MS = 1600;
/** From an end dot's center to its label: the dot, then room for a leader. */
export const LABEL_GAP = 13;
/** One label's line: dodged labels keep their centers this far apart. */
export const LABEL_HEIGHT = 13;
/** Team lines keep at least this much OKLCH chroma. */
export const CHROMA = 0.1;

/** The plot's height by the section's width (points): large and up, 150. */
export const plotHeight = (width: number): number => (width >= 460 ? 150 : 124);
export const dotSize = (final: boolean): number => (final ? FINAL_DOT : DOT);

/**
 * The end labels' column, sized for the widest label it can show ("Draw
 * 100%"), so the plot's width never changes as the values do. `measure` gives
 * a string's width at 10.5pt semibold with tabular digits, in points.
 */
export function labelWidth(names: readonly string[], measure: (text: string) => number): number {
  const widest = names.length > 0 ? Math.max(...names.map((n) => measure(`${n} 100%`))) : 40;
  return Math.ceil(widest) + 1;
}

/** Soccer's draw is "neither team", so it recedes toward the surface: each mode's own step, validated on the chart well. */
export const drawColor = (scheme: Scheme): string => (scheme === "dark" ? "#5d5d5d" : "#aeaeae");

/**
 * A team's line: its palette color, held to at least 0.10 chroma (City's sky
 * blue, toned for the light panel, reads gray at 0.07). Exactly 0.10, no
 * more: any further and City's sky blue on dark falls under ΔE 15 from
 * Brighton's blue. A color shown honestly as gray stays gray. (pure; tested)
 */
export function lineColor(color: string): string {
  const lab = oklabFromHex(color);
  if (!lab) return color;
  const c = chroma(lab);
  if (c < 0.03 || c >= CHROMA) return color;
  const h = (hue(lab) * Math.PI) / 180;
  return toHex({ l: lab.l, a: CHROMA * Math.cos(h), b: CHROMA * Math.sin(h) });
}

/** "Game" or "10 min": what the window control offers (OddsWindow.label). */
export const windowLabel = (w: OddsWindow): string => (w.kind === "recent" ? "10 min" : "Game");

// MARK: - Lines

/** One outcome's line: what it's called and its color (OddsLine). */
export interface OddsLine {
  readonly outcome: Outcome;
  readonly name: string;
  readonly color: string;
}

/** The order they're drawn in: the draw beneath the teams, the top team over all. */
export function drawnOrder(lines: readonly OddsLine[]): OddsLine[] {
  const rank: Record<Outcome, number> = { draw: 0, bottom: 1, top: 2 };
  return [...lines].sort((a, b) => rank[a.outcome] - rank[b.outcome]);
}

/** The outcomes a split splits, in the legend's order. */
export const outcomesOf = (split: OddsSplit): Outcome[] => (split.draw == null ? ["top", "bottom"] : ["top", "draw", "bottom"]);

/**
 * Each outcome's whole percent, always summing to 100: largest remainder,
 * ties to the bigger chance, so two-way the trailing side is exactly 100
 * minus the leader (never 98 + 3, or 53 + 48). Never 0 or 100 while it's
 * undecided: those are for the final whistle. (pure; tested)
 */
export function percents(split: OddsSplit, final = false): Partial<Record<Outcome, number>> {
  const outcomes = outcomesOf(split);
  const shares = outcomes.map((o) => Math.max(share(split, o), 0));
  const total = shares.reduce((a, b) => a + b, 0);
  const exact = shares.map((x) => (total > 0 ? (x / total) * 100 : 100 / shares.length));
  const whole = exact.map((x) => Math.floor(x));
  const remainders = exact.map((x, k) => x - whole[k]!);
  const order = exact
    .map((_, k) => k)
    .sort((a, b) => {
      if (Math.abs(remainders[a]! - remainders[b]!) > 1e-9) return remainders[b]! - remainders[a]!;
      return exact[a] !== exact[b] ? exact[b]! - exact[a]! : a - b;
    });
  const missing = Math.max(100 - whole.reduce((a, b) => a + b, 0), 0);
  for (const k of order.slice(0, missing)) whole[k]! += 1;
  if (!final) {
    // Held off 0 and 100; what that adds comes off the biggest.
    for (let k = 0; k < whole.length; k++) whole[k] = Math.min(Math.max(whole[k]!, 1), 99);
    while (whole.reduce((a, b) => a + b, 0) > 100) {
      let biggest = 0;
      for (let k = 1; k < whole.length; k++) if (whole[k]! > whole[biggest]!) biggest = k;
      whole[biggest]! -= 1;
    }
  }
  const out: Partial<Record<Outcome, number>> = {};
  outcomes.forEach((o, k) => (out[o] = whole[k]!));
  return out;
}

// MARK: - Data (OddsChartData)

/**
 * What the plot draws, worked out once per change of the feed or the page:
 * every outcome's chance over time (US: the top team's price and its
 * complement; soccer: the three, normalized), ESPN's line for the readings,
 * the span of time shown. The last point is the live end, drawn and glided
 * apart from the rest.
 */
export interface OddsChartData {
  readonly revision: number;
  readonly threeWay: boolean;
  readonly points: readonly OddsSplitPoint[];
  readonly espn: readonly WinPoint[];
  readonly periods: readonly OddsPeriod[];
  readonly domain: Domain;
  readonly live: boolean;
  readonly final: boolean;
  /** Where a live game has got to: the lines end here, inside the domain. */
  readonly now: number | null;
  /** Showing one period, not the game. */
  readonly zoomed: boolean;
  /** The lines' live end is on the chart (not when zoomed to an earlier period). */
  readonly endVisible: boolean;
}

export const chartHead = (data: OddsChartData): OddsSplitPoint | null => data.points.at(-1) ?? null;

/** The split in effect at `t` (before the first point, the first's). (pure) */
export function splitAt(data: OddsChartData, t: number): OddsSplit | null {
  const first = data.points[0];
  if (!first) return null;
  return lastAtOrBefore(data.points, t, (p) => p.t)?.split ?? first.split;
}

/** The historical sample behind a reading: never a price from the future, and none across a stretch nobody observed. */
export function observedPoint(data: OddsChartData, t: number): OddsSplitPoint | null {
  const sample = lastAtOrBefore(data.points, t, (p) => p.t);
  if (!sample || sample.unobserved || t - sample.t > GAP) return null;
  return sample;
}

/** Where the drawn lines are at `t`, for the crosshair's dots: between two samples, on the segment joining them; nothing where the line is broken. */
export function drawnAt(data: OddsChartData, t: number): OddsSplit | null {
  const points = data.points;
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0 || points[lo - 1]!.unobserved) return null;
  const a = points[lo - 1]!;
  if (lo >= points.length) return t - a.t <= GAP ? a.split : null;
  const b = points[lo]!;
  const span = b.t - a.t;
  if (b.unobserved || span > GAP || !(span > 0)) return null;
  const k = (t - a.t) / span;
  const mix = (x: number, y: number) => x + (y - x) * k;
  return { top: mix(a.split.top, b.split.top), draw: b.split.draw != null ? mix(a.split.draw ?? b.split.draw, b.split.draw) : null, bottom: mix(a.split.bottom, b.split.bottom) };
}

/**
 * Only Latest and the exact end of a finished game may display 0/100. An
 * earlier inspected quote keeps its in-game cap even after the game
 * finishes. This changes rounding, never the observed price or its time.
 */
export function usesFinalPercentages(data: OddsChartData, moment: number | null): boolean {
  return data.final && (moment == null || (moment === data.domain.to && data.endVisible));
}

/** Before the game: the market's last day, from its first point within it. (pure; tested) */
export function pregameDomain(first: number | null, last: number | null, now: number): Domain {
  const from = Math.max(first ?? now - 86_400_000, now - 86_400_000);
  return { from, to: Math.max(last ?? now, from + 60_000) };
}

/** The market as it stood at `until` (each tick at its own time): what the page shows while it broadcasts. (pure; tested) */
export function shownPoints<T extends { readonly t: number }>(points: readonly T[], until: number | null): readonly T[] {
  if (until == null) return points;
  const index = points.findIndex((p) => p.t > until);
  return index < 0 ? points : points.slice(0, index);
}

/** The feed's part of the chart: the market and its series (state/odds.ts `OddsSnapshot`). */
export interface ChartFeed {
  readonly market: Pick<Market, "kind"> | null;
  readonly series: Readonly<Partial<Record<Outcome, readonly PricePoint[]>>>;
  readonly version: number;
}

/** `until`: while the page broadcasts, p: the market as it stood then (no tick after it) (OddsChartData.make). */
export function makeChartData(input: {
  readonly feed: ChartFeed;
  readonly basis: Pick<OddsBasis, "win">;
  readonly history: MatchHistory;
  readonly state: EventState;
  readonly window: OddsWindow;
  readonly eventStart: number;
  readonly now: number;
  readonly until?: number | null;
}): OddsChartData | null {
  const { feed, basis, history, state, window, eventStart } = input;
  const until = input.until ?? null;
  if (!feed.market) return null;
  const now = until ?? input.now;
  const threeWay = feed.market.kind === "three-way";
  const shown = (o: Outcome) => shownPoints(feed.series[o] ?? [], until);
  let points: OddsSplitPoint[] = threeWay ? stacked(shown("top"), shown("draw"), shown("bottom")) : shown("top").map((p) => ({ t: p.t, split: { top: p.p, draw: null, bottom: 1 - p.p }, unobserved: false }));
  const base = { revision: feed.version, threeWay, espn: [] as readonly WinPoint[], periods: [] as readonly OddsPeriod[], live: state === "live", final: state === "final", now: null as number | null, zoomed: false, endVisible: true };
  if (state === "scheduled") return { ...base, points, domain: pregameDomain(points[0]?.t ?? null, points.at(-1)?.t ?? null, now) };
  const visible = shownUntil(history, until);
  const latest = points.at(-1)?.t ?? null;
  const whole = historyDomain(visible, state, GAME, eventStart, latest, until);
  const domain = historyDomain(visible, state, window, eventStart, latest, until);
  let liveNow: number | null = null;
  let endVisible: boolean;
  if (state === "live") {
    liveNow = historyNow(visible, eventStart, latest, until);
    endVisible = liveNow >= domain.from && liveNow <= domain.to;
  } else {
    endVisible = domain.to >= whole.to;
  }
  // The end of a finished game is its last play: nothing after the buzzer.
  if (state === "final") {
    const index = points.findIndex((p) => p.t > whole.to);
    if (index >= 0) points = points.slice(0, index);
  }
  return { ...base, points, domain, now: liveNow, zoomed: windowPeriod(window) != null, endVisible, espn: shownPoints(basis.win, until), periods: visible.periods };
}

/** The window as it applies (OddsWindow.effective), re-exported for the section. */
export { effectiveWindow };

// MARK: - Geometry (OddsLayout)

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const maxX = (r: Rect) => r.x + r.width;
export const maxY = (r: Rect) => r.y + r.height;
export const midY = (r: Rect) => r.y + r.height / 2;

/** One end's label: where its line ends, and its center after dodging (OddsEndLabel). */
export interface OddsEndLabel {
  readonly outcome: Outcome;
  readonly dot: { readonly x: number; readonly y: number };
  readonly y: number;
}

/** Moved off its line: a hairline leads back to it. */
export const displaced = (label: OddsEndLabel): boolean => Math.abs(label.y - label.dot.y) > 2;

/**
 * Where everything sits in the plot (pure; tested): time across, a chance up
 * (100% at the top), with the end labels' column at the right and room above
 * and below for the dots.
 */
export class OddsLayout {
  /** The plot's area: the 0/50/100 gutter left of it, the end labels' column right of it. */
  readonly plot: Rect;
  /** The whole drawing area (the axis band below `plotHeight` excluded). */
  readonly bounds: Rect;

  constructor(
    width: number,
    height: number,
    readonly domain: Domain,
    readonly labelWidth: number,
    /** Where a live game has got to; nothing to read past it. Null: the lines end at the right edge. */
    readonly now: number | null = null,
  ) {
    this.bounds = { x: 0, y: 0, width, height };
    const right = LABEL_GAP + labelWidth + 4;
    this.plot = { x: GUTTER, y: INSET, width: Math.max(width - GUTTER - right, 1), height: Math.max(height - INSET * 2, 1) };
  }

  private get span(): number {
    return Math.max(this.domain.to - this.domain.from, 1000);
  }

  x(t: number): number {
    return this.plot.x + (this.plot.width * (t - this.domain.from)) / this.span;
  }

  /** A chance: 100% at the top, 0% at the bottom. */
  y(p: number): number {
    return this.plot.y + this.plot.height * (1 - Math.min(Math.max(p, 0), 1));
  }

  time(x: number): number {
    return this.domain.from + ((x - this.plot.x) / this.plot.width) * this.span;
  }

  /**
   * Inspection uses whole seconds inside the plot, but its edges retain the
   * exact domain bounds. Rounding a fractional final whistle down must not
   * make the final reading unreachable at the chart's right edge.
   */
  inspectionTime(x: number): number {
    if (x <= this.plot.x) return this.domain.from;
    if (x >= this.endX) return this.readable.to;
    const rounded = Math.round(this.time(x) / 1000) * 1000;
    return Math.min(Math.max(rounded, this.readable.from), this.readable.to);
  }

  /** What can be read: the domain, up to where the game has got to. */
  get readable(): Domain {
    return { from: this.domain.from, to: Math.max(this.domain.from, Math.min(this.domain.to, this.now ?? this.domain.to)) };
  }

  /** Where the lines end: at now, or at the plot's right edge (a final's last price holds to its last play). */
  get endX(): number {
    return this.now != null ? Math.min(Math.max(this.x(this.now), this.plot.x), maxX(this.plot)) : maxX(this.plot);
  }

  /** Where an outcome's line ends. */
  end(split: OddsSplit, outcome: Outcome): { x: number; y: number } {
    return { x: this.endX, y: this.y(share(split, outcome)) };
  }

  /** The end labels' leading edge, just past the dots; the column at the plot's right keeps them whole when the lines reach it. */
  get labelX(): number {
    return this.endX + LABEL_GAP;
  }

  /** Every end's label, beside its dot, then dodged, kept whole inside the drawing area. */
  endLabels(split: OddsSplit, outcomes: readonly Outcome[], order: readonly Outcome[] | null = null): OddsEndLabel[] {
    const fixed = order && order.length === outcomes.length && outcomes.every((o) => order.includes(o)) && order.every((o) => outcomes.includes(o)) ? order : null;
    const arranged = fixed ?? outcomes;
    const dots = arranged.map((o) => this.end(split, o));
    const half = LABEL_HEIGHT / 2;
    const ys = OddsLayout.dodge(
      dots.map((d) => d.y),
      LABEL_HEIGHT,
      { from: this.bounds.y + half, to: maxY(this.bounds) - half },
      fixed != null,
    );
    const labels = arranged.map((outcome, k) => ({ outcome, dot: dots[k]!, y: ys[k]! }));
    return outcomes.flatMap((o) => labels.filter((l) => l.outcome === o).slice(0, 1));
  }

  /**
   * Label centers after dodging (pure; tested): labels that would overlap
   * merge into a cluster centered on their lines' mean, `gap` apart in their
   * lines' order (a tie keeps the given order), held within `range`.
   */
  static dodge(ideal: readonly number[], gap: number, range: { readonly from: number; readonly to: number }, preservingOrder = false): number[] {
    const cluster = (members: number[]) => {
      const mean = members.map((m, k) => ideal[m]! - k * gap).reduce((a, b) => a + b, 0) / members.length;
      const height = (members.length - 1) * gap;
      return { members, top: Math.min(Math.max(mean, range.from), range.to - height) };
    };
    const order = preservingOrder ? ideal.map((_, k) => k) : ideal.map((_, k) => k).sort((a, b) => (ideal[a] !== ideal[b] ? ideal[a]! - ideal[b]! : a - b));
    const clusters = order.map((k) => cluster([k]));
    let k = 0;
    while (k + 1 < clusters.length) {
      const a = clusters[k]!;
      const b = clusters[k + 1]!;
      if (a.top + a.members.length * gap > b.top + 0.01) {
        clusters.splice(k, 2, cluster([...a.members, ...b.members]));
        // Re-centered, it may now reach the cluster above.
        k = Math.max(k - 1, 0);
      } else {
        k++;
      }
    }
    const placed = [...ideal];
    for (const c of clusters) c.members.forEach((m, j) => (placed[m] = c.top + j * gap));
    return placed;
  }
}

// MARK: - End labels (OddsEndOrder, OddsLabelGlide)

/**
 * End labels keep their outcome identity through a close race. A real
 * crossing changes their order only after the dots are a label-height apart;
 * a one-tick wobble around 50/50 never flips the names back and forth.
 */
export function nextEndOrder(previous: readonly Outcome[], split: OddsSplit, outcomes: readonly Outcome[], layout: OddsLayout): Outcome[] {
  if (previous.length !== outcomes.length || !outcomes.every((o) => previous.includes(o))) {
    return layout
      .endLabels(split, outcomes)
      .sort((a, b) => a.y - b.y)
      .map((l) => l.outcome);
  }
  const order = [...previous];
  for (let pass = 0; pass < order.length; pass++) {
    for (let k = 0; k < Math.max(order.length - 1, 0); k++) {
      const a = layout.y(share(split, order[k]!));
      const b = layout.y(share(split, order[k + 1]!));
      if (a - b > LABEL_HEIGHT) [order[k], order[k + 1]] = [order[k + 1]!, order[k]!];
    }
  }
  return order;
}

/**
 * A leader is only useful when its origin is unambiguous. Crossing leaders or
 * two almost coincident dots look like a line joining teams. The name's
 * outcome color carries identity in those cases.
 */
export function endLeaders(labels: readonly OddsEndLabel[]): OddsEndLabel[] {
  return labels.filter(
    (label) => displaced(label) && !labels.some((other) => other.outcome !== label.outcome && (Math.abs(other.dot.y - label.dot.y) < DOT + 2 || (other.dot.y - label.dot.y) * (other.y - label.y) < 0)),
  );
}

/** During a genuine reorder, names dissolve before their glyphs collide, then return in the new order. The outcome dots remain visible throughout. */
export function endOpacity(label: OddsEndLabel, labels: readonly OddsEndLabel[]): number {
  const others = labels.filter((l) => l.outcome !== label.outcome).map((l) => Math.abs(l.y - label.y));
  const distance = others.length > 0 ? Math.min(...others) : Infinity;
  return Math.min(Math.max((distance - LABEL_HEIGHT * 0.65) / (LABEL_HEIGHT * 0.35), 0), 1);
}

/** Geometry for a label transition, keyed by outcome rather than vertical rank. A new quote starts from the current centers, even mid-transition. */
export class OddsLabelGlide {
  readonly from: ReadonlyMap<Outcome, number>;
  readonly to: ReadonlyMap<Outcome, number>;
  constructor(
    from: readonly OddsEndLabel[],
    to: readonly OddsEndLabel[],
    readonly start: number,
  ) {
    this.from = new Map(from.map((l) => [l.outcome, l.y]));
    this.to = new Map(to.map((l) => [l.outcome, l.y]));
  }

  labels(time: number, dots: readonly OddsEndLabel[]): OddsEndLabel[] {
    const k = glideProgress(time - this.start);
    return dots.map((label) => {
      const a = this.from.get(label.outcome) ?? label.y;
      const b = this.to.get(label.outcome) ?? label.y;
      return { outcome: label.outcome, dot: label.dot, y: a + (b - a) * k };
    });
  }
}

// MARK: - The live end (OddsTail, OddsGlide, OddsMotion)

/**
 * Only the transient final connector, never historical samples. When a quote
 * interrupts a glide, the displayed dot can still be behind the preceding
 * recorded price. Connecting back to it invents a hook/spike. Keep that tiny
 * connector absent until the dot enters its true segment.
 */
export function tailConnector(previous: OddsSplitPoint | null, head: OddsSplitPoint, shown: OddsSplit, outcome: Outcome, layout: OddsLayout): { x: number; y: number }[] {
  const end = layout.end(shown, outcome);
  const last = { x: layout.x(head.t), y: end.y };
  // The market hasn't been heard for a while: no line claims it held.
  const tail = layout.now == null || layout.now - head.t <= GAP ? [last, end] : [last];
  if (!previous || head.unobserved || head.t - previous.t > GAP) return tail;
  const a = share(previous.split, outcome);
  const b = share(head.split, outcome);
  const p = share(shown, outcome);
  if (!(p >= Math.min(a, b) - 1e-9 && p <= Math.max(a, b) + 1e-9)) return [];
  return [{ x: layout.x(previous.t), y: layout.y(a) }, ...tail];
}

/** Liveline's ease: 8% of the remaining distance a frame (at 60 fps), scaled to land exactly at `GLIDE_MS`. (pure; tested) */
export function glideProgress(elapsed: number): number {
  if (!(elapsed > 0)) return 0;
  const frames = 60 * (GLIDE_MS / 1000);
  return Math.min(1, (1 - 0.92 ** (60 * (elapsed / 1000))) / (1 - 0.92 ** frames));
}

/** A value easing to the next (OddsGlide). */
export interface OddsGlide {
  readonly from: OddsSplit;
  readonly to: OddsSplit;
  readonly start: number;
}

export function glideValue(g: OddsGlide, t: number): OddsSplit {
  const k = glideProgress(t - g.start);
  const mix = (a: number, b: number) => a + (b - a) * k;
  return { top: mix(g.from.top, g.to.top), draw: g.to.draw != null ? mix(g.from.draw ?? g.to.draw, g.to.draw) : null, bottom: mix(g.from.bottom, g.to.bottom) };
}

export const glideDone = (g: OddsGlide, t: number): boolean => t - g.start >= GLIDE_MS;

/**
 * Every end is live (pulsing, beating) while the market streams and the
 * chart is seen; a final, a market not streaming yet, a hidden chart or
 * Reduce Motion keep still dots.
 */
export function endsLive(final: boolean, streaming: boolean, seen: boolean, reduceMotion: boolean): boolean {
  return !final && streaming && seen && !reduceMotion;
}

/** The outcome that just moved, for its brighter beat: the biggest change (to a hundredth of a point), a tie to the one that rose. Two-way, the side gaining. */
export function mover(from: OddsSplit, to: OddsSplit): Outcome | null {
  let best: { outcome: Outcome; change: number } | null = null;
  for (const o of outcomesOf(to)) {
    const change = Math.round((share(to, o) - share(from, o)) * 10_000);
    if (!best || Math.abs(change) > Math.abs(best.change) || (Math.abs(change) === Math.abs(best.change) && change > best.change)) best = { outcome: o, change };
  }
  return best && best.change !== 0 ? best.outcome : null;
}

/** When a beat asked for at `t` plays: the next beat of the shared pulse (every pulse breathes from `epoch`), so dots never fall out of step. */
export function beatAfter(t: number, epoch: number): number {
  return epoch + Math.ceil(Math.max(t - epoch, 0) / PULSE_PERIOD_MS) * PULSE_PERIOD_MS;
}

// MARK: - Axis labels (OddsPlot.hourLabels, periodLabels)

export interface PeriodLabel {
  readonly label: string;
  readonly x: number;
}

/**
 * Before the game (no periods): the wall clock, on whole hours spaced at
 * least 56pt apart ("5 PM"), none within 14pt of the plot's ends. (pure; tested)
 */
export function hourLabels(layout: OddsLayout, label: (t: number) => string): PeriodLabel[] {
  const span = layout.domain.to - layout.domain.from;
  if (!(span > 0) || !(layout.plot.width > 0)) return [];
  const perHour = (layout.plot.width * 3_600_000) / span;
  const step = [1, 2, 3, 6, 12].find((h) => h * perHour >= 56);
  if (step == null) return [];
  const out: PeriodLabel[] = [];
  // Whole hours of the local clock, after the domain's start (setHours steps through daylight saving's changes).
  const hour = new Date(layout.domain.from);
  hour.setMinutes(0, 0, 0);
  if (hour.getTime() <= layout.domain.from) hour.setHours(hour.getHours() + 1);
  for (; hour.getTime() <= layout.domain.to; hour.setHours(hour.getHours() + 1)) {
    const x = layout.x(hour.getTime());
    if (hour.getHours() % step === 0 && x >= layout.plot.x + 14 && x <= maxX(layout.plot) - 14) out.push({ label: label(hour.getTime()), x });
  }
  return out;
}

/**
 * Each period's name at the middle of its visible span, when it fits there
 * (with 4pt either side); several overtimes share one. `measure` gives a
 * label's width at 9pt medium. (pure; tested)
 */
export function periodLabels(periods: readonly OddsPeriod[], layout: OddsLayout, measure: (text: string) => number): PeriodLabel[] {
  const out: PeriodLabel[] = [];
  periods.forEach((period, k) => {
    const next = periods[k + 1];
    const end = next ? Math.max(period.end, next.start - 1000) : period.end;
    const a = Math.max(layout.x(period.start), layout.plot.x);
    const b = Math.min(layout.x(end), maxX(layout.plot));
    if (!(b > a) || out.some((l) => l.label === period.label)) return;
    if (!(b - a >= measure(period.label) + 8 || periods.length === 1)) return;
    out.push({ label: period.label, x: (a + b) / 2 });
  });
  return out;
}

/** The points to draw: from the one in effect at the left edge to the one past the right edge, or to the one before the newest (the live ends draw the last stretch). */
export function visiblePoints<T>(points: readonly T[], time: (p: T) => number, domain: Domain, endVisible = true): readonly T[] {
  if (points.length <= 1) return [];
  const body = endVisible ? points.slice(0, -1) : points;
  let firstInside = body.findIndex((p) => time(p) >= domain.from);
  if (firstInside < 0) firstInside = body.length;
  const past = body.findIndex((p) => time(p) > domain.to);
  const firstPast = past < 0 ? body.length : past + 1;
  return body.slice(Math.max(0, firstInside - 1), firstPast);
}

// MARK: - Readings (OddsReading)

/** Every source at one moment, for the readers. (pure; tested) */
export interface OddsReading {
  readonly t: number;
  /** Polymarket's chances then. */
  readonly split: OddsSplit | null;
  /** ESPN's chance for the top team then. */
  readonly espn: number | null;
  readonly play: { readonly t: number; readonly period: number; readonly clock: string; readonly text: string } | null;
}

export function readingAt(t: number, data: OddsChartData, basis: Pick<OddsBasis, "start" | "plays">, marks: readonly TimelineMark[] = []): OddsReading {
  const espn = basis.start != null && t >= basis.start ? (lastAtOrBefore(data.espn, t, (w) => w.t)?.top ?? null) : null;
  // The key plays at this instant, by name; else the last play before
  // it. Never an upcoming play as if it had already happened.
  const exact = marks.filter((m) => m.t === t);
  const first = exact[0];
  const play = first
    ? { t, period: first.moment.period ?? 0, clock: playAtOrBefore(basis, t)?.clock ?? first.moment.clock, text: exact.map((m) => momentHeadline(m.moment)).join(" · ") }
    : playAtOrBefore(basis, t);
  return { t, split: observedPoint(data, t)?.split ?? null, espn: data.espn.length === 0 ? null : espn, play };
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
const shortTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekdayTime = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

/** "Q3 4:12 · GSW 62% · ESPN 58%": where in the game, and each source's chance for the top team. Before the game, the wall time. */
export function readingLead(reading: OddsReading, top: string, final: boolean, now = Date.now()): string {
  const clock = reading.play && reading.play.clock !== "" ? shortClock(reading.play.clock) : null;
  const when = clock ?? (sameDay(reading.t, now) ? shortTime.format(reading.t) : weekdayTime.format(reading.t));
  const chance = reading.split ? percents(reading.split, final).top : undefined;
  const parts = [when, chance != null ? `${top} ${chance}%` : null, reading.espn != null ? `ESPN ${percent(reading.espn, final)}%` : null];
  return parts.filter((x): x is string => x != null).join(" · ");
}
