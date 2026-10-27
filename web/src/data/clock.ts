/**
 * Game clocks between polls (Models.swift `GameClock`). Sources don't say
 * whether a clock is running; it's inferred from two readings in a row, and
 * between readings it ticks (or holds) on its own.
 */
import type { GameClock } from "./models";

/** Past this, a reading is stale: the clock holds rather than guess. */
const HORIZON_SECONDS = 90;

/** What the clock reads at `now`: the source's text, ticked forward while it runs. */
export function clockText(clock: GameClock, now: number): string {
  if (!clock.running) return clock.display;
  const elapsed = Math.min(Math.max((now - clock.sampledAt) / 1000, 0), HORIZON_SECONDS);
  if (clock.direction === "down") {
    // "3:10 - 2nd": tick the clock, keep the period.
    const dash = clock.display.indexOf(" - ");
    if (dash < 0) return clock.display;
    const left = Math.ceil(Math.max(clock.seconds - elapsed, 0));
    return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}${clock.display.slice(dash)}`;
  }
  // Up: match the source's minute at the reading, then count on from there.
  const parts = clock.display.split("+").map((p) => Number(p.replace(/\D/g, "")) || 0);
  const first = parts[0] ?? 0;
  if (first <= 0) return clock.display;
  const minute = Math.floor((clock.seconds + elapsed) / 60) + (parts.reduce((a, b) => a + b, 0) - Math.floor(clock.seconds / 60));
  const base = [45, 90, 105, 120][Math.min(Math.max(clock.period, 1), 4) - 1]!;
  return minute > base ? `${base}'+${minute - base}'` : `${minute}'`;
}

/**
 * The same clock read again: running if the time moved since the last
 * reading. The same reading again keeps the earlier one, its timestamp
 * included, so a game that didn't change compares equal and nothing
 * re-renders. (A countdown that read the same twice has stopped; a soccer
 * minute keeps counting on from when it was first read.)
 */
export function clockReading(next: GameClock, previous: GameClock | null): GameClock {
  if (
    previous &&
    previous.seconds === next.seconds &&
    previous.period === next.period &&
    previous.display === next.display &&
    previous.direction === next.direction
  ) {
    return { ...previous, running: next.direction === "down" ? false : next.running };
  }
  if (next.direction !== "down" || !previous || previous.period !== next.period) return next;
  return { ...next, running: previous.seconds - next.seconds >= 0.5 };
}
