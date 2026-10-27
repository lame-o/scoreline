/**
 * The profile charts' geometry and words (ProfileCharts.swift): the game-log
 * strip's bars, the hover's nearest bar, readouts, the map pool's shared
 * scale and the rank track's position. Pure; the components draw what this
 * computes.
 */
import { entryValue, type GameLog, type GameLogEntry, type MapStat } from "./models";
import { profileDay } from "./display";

export interface Bar {
  readonly x: number;
  readonly width: number;
  readonly height: number;
  readonly played: boolean;
}

export const barMid = (bar: Bar) => bar.x + bar.width / 2;

/** The strip's plot height in points. */
export const STRIP_HEIGHT = 56;
/** Room on the right for the reference's label. */
export const STRIP_LABEL_ROOM = 52;

/**
 * Bars left to right in date order: up to 10pt wide with 2pt gaps (1pt past
 * 40 games), heights against the largest value. A played zero is a 1pt
 * sliver (played, nothing scored); a game not played is a stub. A season
 * fills in from the left as it's played; a fixed window ("last 10",
 * `spread`) spaces its bars evenly across the chart, up to 14pt each.
 */
export function stripLayout(values: readonly (number | null)[], width: number, height: number, ceiling: number | null = null, spread = false): Bar[] {
  const n = values.length;
  if (n === 0 || width <= 0) return [];
  const gap = n > 40 ? 1 : 2;
  const slot = spread ? width / n : 0;
  const barWidth = spread ? Math.max(1, Math.min(14, slot * 0.6)) : Math.max(1, Math.min(10, (width - gap * (n - 1)) / n));
  const top = Math.max(Math.max(0, ...values.filter((v): v is number => v != null)), ceiling ?? 0, 1);
  return values.map((value, i) => {
    const x = spread ? i * slot + (slot - barWidth) / 2 : i * (barWidth + gap);
    if (value == null) return { x, width: barWidth, height: 0, played: false };
    const h = value <= 0 ? 1 : Math.max(1, (value / top) * height);
    return { x, width: barWidth, height: h, played: true };
  });
}

/** The bar under a pointer at `x`, or null when it's between bars. */
export function nearestBar(bars: readonly Bar[], x: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < bars.length; i++) {
    if (best == null || Math.abs(barMid(bars[i]!) - x) < Math.abs(barMid(bars[best]!) - x)) best = i;
  }
  if (best == null) return null;
  const bar = bars[best]!;
  return Math.abs(barMid(bar) - x) <= Math.max(6, bar.width / 2 + 2) ? best : null;
}

/** "12" or "12.5". */
export function formatValue(v: number): string {
  return Math.round(v) === v ? String(v) : v.toFixed(1);
}

/** The values the strip draws, one per entry (null: didn't play). */
export function stripValues(log: GameLog): (number | null)[] {
  return log.entries.map((e) => (e.played ? (entryValue(e, log.stripKey ?? "") ?? 0) : null));
}

/** bo3's "last 10 matches" is a fixed window, not a season in progress: its bars span the width. */
export const stripSpreads = (log: GameLog) => log.stripKey === "rating";

/** A season's shape needs a few games: before five, the table (which lists them all) says it better than three bars. */
export function drawsStrip(log: GameLog): boolean {
  return log.stripKey != null && log.entries.length >= 5;
}

export function stripMean(values: readonly (number | null)[]): number | null {
  const played = values.filter((v): v is number => v != null);
  return played.length === 0 ? null : played.reduce((a, b) => a + b, 0) / played.length;
}

/** The strip's label for its stat: the log's own column label, else its name. */
export function stripLabelOf(log: GameLog): string {
  return log.columns.find((c) => c.key === log.stripKey)?.label ?? log.stripLabel;
}

export function scoreText(e: GameLogEntry): string | null {
  return e.teamScore != null && e.opponentScore != null ? `${e.teamScore}–${e.opponentScore}` : null;
}

/** "Sun, Oct 25 at SEA · L 3–20". */
export function entryContext(e: GameLogEntry): string {
  const opponent = e.opponent ? `${e.home ? "vs" : "at"} ${e.opponent.abbreviation ?? e.opponent.name}` : null;
  const result = [e.result, scoreText(e)].filter(Boolean).join(" ");
  return [profileDay(e.date) + (opponent ? ` ${opponent}` : ""), result || null].filter(Boolean).join(" · ");
}

/** "Game log: 15 games, points from 8 to 31, average 18.4. Last game: 22 points, …". */
export function stripSpoken(log: GameLog): string {
  const values = stripValues(log);
  const played = values.filter((v): v is number => v != null);
  const lbl = stripLabelOf(log).toLowerCase();
  if (played.length === 0) return "Game log: no games yet.";
  let text = `Game log: ${log.entries.length} games, ${lbl} from ${formatValue(Math.min(...played))} to ${formatValue(Math.max(...played))}`;
  const mean = stripMean(values);
  if (mean != null) text += `, average ${formatValue(mean)}`;
  const last = log.entries.at(-1);
  if (last) text += `. Last game: ${last.stats[log.stripKey ?? ""] ?? "0"} ${lbl}, ${entryContext(last)}.`;
  return text;
}

/** Month labels under the baseline where a new month starts, skipping one within 30pt of the last label. */
export function monthTicks(entries: readonly GameLogEntry[], bars: readonly Bar[]): { index: number; label: string }[] {
  const starts = entries.flatMap((e, i) => {
    if (i > 0 && new Date(e.date).getMonth() === new Date(entries[i - 1]!.date).getMonth()) return [];
    return [i];
  });
  if (starts.length < 2) return [];
  const kept: number[] = [];
  for (const i of starts) {
    const bar = bars[i];
    if (!bar) continue;
    const last = kept.at(-1);
    if (last != null && bar.x - bars[last]!.x < 30) continue;
    kept.push(i);
  }
  return kept.map((i) => ({ index: i, label: new Date(entries[i]!.date).toLocaleDateString("en-US", { month: "short" }) }));
}

// MARK: - Map pool

/** Average ratings sit close together (6.8–7.7): a shared scale, padded, so bars from zero don't hide the differences. */
export function mapDomain(maps: readonly MapStat[]): [number, number] {
  const ratings = maps.map((m) => m.rating);
  const lo = ratings.length ? Math.min(...ratings) : 0;
  const hi = ratings.length ? Math.max(...ratings) : 1;
  const pad = Math.max(0.15, (hi - lo) * 0.15);
  return [lo - pad, hi + pad];
}

/** The overall rating: each map's rating weighted by how often it's played. */
export function overallRating(maps: readonly MapStat[]): number {
  const total = maps.reduce((sum, m) => sum + m.maps, 0);
  return maps.length === 0 ? 0 : maps.reduce((sum, m) => sum + m.rating * m.maps, 0) / Math.max(1, total);
}

// MARK: - Rank track

/** Where rank `rank` of `field` sits on a 0…1 track, best on the left. */
export function rankPosition(rank: number, field: number): number {
  if (field <= 1) return 0;
  return (Math.min(Math.max(rank, 1), field) - 1) / (field - 1);
}

// MARK: - Soccer match strip

/** How many matches the result strip shows at a width class. */
export function matchStripCount(width: "compact" | "medium" | "large" | "xlarge"): number {
  return { compact: 12, medium: 15, large: 18, xlarge: 22 }[width];
}

/** A match's readout: "2 goals, 1 assist", "Clean sheet", "No goal involvement". */
export function matchReadout(log: GameLog, e: GameLogEntry): string {
  if (log.stripKey === "cleanSheet") return (entryValue(e, "cleanSheet") ?? 0) > 0 ? "Clean sheet" : `${e.stats.goalsConceded ?? "0"} conceded`;
  const g = Math.trunc(entryValue(e, "totalGoals") ?? 0);
  const a = Math.trunc(entryValue(e, "goalAssists") ?? 0);
  const parts = [g > 0 ? `${g} ${g === 1 ? "goal" : "goals"}` : null, a > 0 ? `${a} ${a === 1 ? "assist" : "assists"}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "No goal involvement";
}
