/**
 * How far behind live the game page is (BehindLive.swift, the pure part;
 * BROADCAST §2: the presentation clock's current delay), shown only on hover
 * over the live indicator (the hero's red dot and clock, the docked bar's) and
 * given to screen readers as the hero's value. At rest the dot stays clean: no
 * number on the page. The card itself is features/game/core/BehindLive.tsx.
 */
import type { Regime } from "./presentationClock";

/** The readout: the delay rounded to 5 s, and a quieter note while the clock is catching up or waiting on the feed. (pure; tested) */
export interface BehindLive {
  /** Seconds behind live, rounded to 5 (never under 5). */
  readonly seconds: number;
  /** "Catching up", "Waiting for the feed", or null. */
  readonly note: string | null;
}

export const behindLive = (seconds: number, note: string | null = null): BehindLive => ({ seconds, note });

/**
 * From the clock's current delay and regime. (Swift's `Int(…)` here traps on a
 * non-finite delay; a delay that isn't a number has no readout on the web.)
 */
export function behindFromClock(delay: number, regime: Regime): BehindLive | null {
  if (!Number.isFinite(delay)) return null;
  const seconds = Math.max(5, Math.round(delay / 5) * 5);
  const note = regime === "catchingUp" ? "Catching up" : regime === "stalled" ? "Waiting for the feed" : null;
  return { seconds, note };
}

export const sameBehind = (a: BehindLive | null, b: BehindLive | null): boolean => (a == null || b == null ? a == b : a.seconds === b.seconds && a.note === b.note);

/** "About 55 s behind live", "About 1 min 40 s behind live". */
export const behindText = (b: BehindLive): string => `About ${duration(b.seconds, true)} behind live`;

/** The screen reader's: the same, in words ("About 55 seconds behind live, catching up"). */
export const behindSpoken = (b: BehindLive): string => `About ${duration(b.seconds, false)} behind live${b.note ? `, ${b.note.toLowerCase()}` : ""}`;

export function duration(seconds: number, short: boolean): string {
  const m = Math.trunc(seconds / 60);
  const s = seconds % 60;
  const unit = (n: number, abbreviation: string, word: string) => (short ? `${n} ${abbreviation}` : `${n} ${word}${n === 1 ? "" : "s"}`);
  if (m === 0) return unit(s, "s", "second");
  return s === 0 ? unit(m, "min", "minute") : `${unit(m, "min", "minute")} ${unit(s, "s", "second")}`;
}
