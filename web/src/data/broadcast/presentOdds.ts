/**
 * Polymarket's market as it stood at p (OddsChart.swift `OddsChartData.shown`,
 * `OddsSection.schedule`; BROADCAST §3): while the page broadcasts, each tick
 * shows at its own time once p reaches it, so the market line moves with the
 * basket, not 50 s before it; the chart redraws when p reaches each pending
 * tick, scheduled, never polled. Times here are the web's epoch milliseconds.
 */
import type { PresentationClock } from "./presentationClock";

/** The points up to `until` (each tick at its own time); null: all of them. (pure; tested) */
export function shownUntil<T extends { readonly t: number }>(points: readonly T[], until: number | null): readonly T[] {
  if (until == null) return points;
  const shown = points.filter((p) => p.t <= until);
  // Everything shown: the same array, so a chart memoized on it doesn't redraw.
  return shown.length === points.length ? points : shown;
}

/**
 * When p reaches each tick not yet shown (the next 240 of the market): the
 * chart's redraws, now first. (pure; tested)
 */
export function oddsSchedule(ticks: readonly number[], clock: PresentationClock, now: number): number[] {
  const t = now / 1000;
  const p = clock.p(t);
  const pending = ticks
    .map((x) => x / 1000)
    .filter((x) => x > p)
    .sort((a, b) => a - b)
    .slice(0, 240);
  const out = [now];
  for (const tick of pending) {
    const wall = clock.wallReaching(tick, t);
    if (wall != null) out.push((wall + 0.01) * 1000);
  }
  return out;
}

/** The steady beat while a page broadcasts: a quiet market's line and the timeline's now still reach p (ms). */
export const BEAT_MS = 15_000;

/**
 * The modules' next redraw while they broadcast (OddsSection.schedule(feed:clock:now:)):
 * when p reaches the next tick not yet shown, or the 15 s beat for the now line,
 * whichever comes first. (pure; tested)
 */
export function nextRedraw(ticks: readonly number[], clock: PresentationClock, now: number): number {
  const reached = oddsSchedule(ticks, clock, now)[1];
  return Math.min(reached ?? Infinity, now + BEAT_MS);
}
