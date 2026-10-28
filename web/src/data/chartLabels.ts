/**
 * Team labels inside charts: the soccer timeline's lanes, the NBA game flow's
 * halves, CS2's round rows, the line score's names. ESPN's abbreviations are
 * two to five letters, and the Mac gives them room for that (a 30pt gutter,
 * a 28pt row label); a few sources send more ("WOLVERHAMPTON", a club with
 * no code, a bo3.gg team without an acronym, a name in another script).
 *
 * A label never spills onto the chart. In order:
 *
 * 1. a gutter widens a little for a long label (`labelGutter`: 30pt grows to
 *    44pt at most, taken from the track, never from the label beside it);
 * 2. the label shrinks to 80% of its size (SwiftUI's `minimumScaleFactor`);
 * 3. past that it's cut at a whole character (a grapheme: an accent or an
 *    emoji flag is never split) with an ellipsis, and the full name goes in
 *    the tooltip; the chart's spoken label always has it whole.
 *
 * Pure: the caller passes how to measure (a canvas on the page, an estimate
 * in tests).
 *
 *     const fit = fitLabel("WOLVERHAMPTON", 24, measure)   // { text: "WOLV…", size: 7.2, cut: true }
 *     const gutter = labelGutter(["MCI", "WOLVES"], measure) // 44
 */

/** Width in points of `text` at `size` points and `weight`. */
export type Measure = (text: string, size: number, weight: number) => number;

export interface FittedLabel {
  /** What to draw: the text, or a prefix of it ending in "…". */
  readonly text: string;
  /** The size to draw it at (points). */
  readonly size: number;
  /** True when the text was cut (show the full name in a tooltip). */
  readonly cut: boolean;
}

export interface LabelStyle {
  /** The label's size in points (9 for chart labels). */
  readonly size?: number;
  readonly weight?: number;
  /** How small it may get before it's cut, as a fraction of `size`. */
  readonly minScale?: number;
}

const ELLIPSIS = "…";

/** The text's characters as a reader sees them (graphemes), so a cut never splits one. */
export function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/** A label fitted to `room` points: as it is, else smaller (to `minScale`), else cut with an ellipsis at that size. */
export function fitLabel(text: string, room: number, measure: Measure, { size = 9, weight = 600, minScale = 0.8 }: LabelStyle = {}): FittedLabel {
  const label = text.trim();
  if (label === "" || room <= 0) return { text: label, size, cut: false };
  const natural = measure(label, size, weight);
  if (natural <= room) return { text: label, size, cut: false };
  // Shrink just enough (width scales with size), down to the floor.
  const floor = size * minScale;
  const scaled = Math.max(floor, Math.floor(((size * room) / natural) * 10) / 10);
  if (measure(label, scaled, weight) <= room) return { text: label, size: scaled, cut: false };
  // Cut at the floor: the longest run of whole characters that fits with the ellipsis.
  const chars = graphemes(label);
  let lo = 1;
  let hi = chars.length - 1;
  let best = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (measure(chars.slice(0, mid).join("").trimEnd() + ELLIPSIS, floor, weight) <= room) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const head = chars.slice(0, best).join("").trimEnd().replace(/[\s.,·:;–—-]+$/u, "");
  return { text: (head || chars[0]!) + ELLIPSIS, size: floor, cut: true };
}

export interface GutterStyle extends LabelStyle {
  /** The Mac's gutter (points). */
  readonly base?: number;
  /** The most it grows to. */
  readonly max?: number;
  /** Room kept around the label inside the gutter. */
  readonly pad?: number;
}

/** A chart's label gutter: the Mac's width, grown for the widest label, never past `max`. */
export function labelGutter(names: readonly string[], measure: Measure, { size = 9, weight = 600, base = 30, max = 44, pad = 6 }: GutterStyle = {}): number {
  const widest = names.reduce((w, n) => Math.max(w, n.trim() ? measure(n.trim(), size, weight) : 0), 0);
  return Math.min(max, Math.max(base, Math.ceil(widest + pad)));
}
