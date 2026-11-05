/**
 * A stoppage's quiet (TheaterQuiet.swift). The isometric views never freeze
 * during a live game, and they never announce the same thing twice: once a
 * timeout, a TV break or a half has walked everyone where they're going, it
 * holds there, with a man shifting his feet, a knee taken, a hand up for the
 * bench. Sparse beats, cheap to draw, seeded from the stoppage so it's the
 * same every time, nobody still for long, and everyone back where he was by
 * the loop's end, so round it goes with no seam and nobody walking off again.
 */
import type { Point } from "../mlb/theaterField";
import type { SplitMix64 } from "./splitMix64";

export type QuietBeat =
  /** A few steps off (`toward`: each axis in -1...1, the sport's scale to apply) and, at `back`, back where he was. */
  | { readonly kind: "step"; readonly man: number; readonly at: number; readonly toward: Point; readonly back: number }
  /** On a knee for a while. */
  | { readonly kind: "knee"; readonly man: number; readonly at: number; readonly until: number }
  /** A hand up: a word to the bench. */
  | { readonly kind: "gesture"; readonly man: number; readonly at: number; readonly until: number };

export interface TheaterQuiet {
  /** In the order they happen. */
  readonly beats: readonly QuietBeat[];
  readonly period: number;
}

const QUIET_LENGTH = 48;
const QUIET_STRIDE = 1.2;
const QUIET_GAP = { lower: 3.5, upper: 5.5 };

export const TheaterQuiet = {
  /** How long a step takes. */
  stride: QUIET_STRIDE,
  /** A loop's length, long enough that it doesn't read as one. */
  length: QUIET_LENGTH,
  /** Between one beat and the next: nothing's still past about 8 s, the loop's seam included. */
  gap: QUIET_GAP,

  /**
   * `men`: who's there to move. `poses`: the sport can put a man on a knee or
   * a hand up (else every beat is a step). Empty with nobody to move. (pure; tested)
   */
  make(men: readonly number[], start: number, random: SplitMix64, length: number = QUIET_LENGTH, poses = true): TheaterQuiet {
    if (men.length === 0) return { beats: [], period: 0 };
    const stride = QUIET_STRIDE;
    const times: number[] = [];
    let t = start + random.in(0.5, 1.5);
    while (t + 2 * stride + 1 < start + length) {
      times.push(t);
      t += random.in(QUIET_GAP.lower, QUIET_GAP.upper);
    }
    // A small crew can't have two of its men away at once.
    const away = men.length >= 4 ? 2 : 1;
    // (Swift builds this with `Dictionary(uniqueKeysWithValues:)`, which traps on a man listed twice; here the last wins.)
    const free = new Map<number, number>(men.map((m) => [m, start]));
    const beats: QuietBeat[] = [];
    times.forEach((at, k) => {
      const ready = men.filter((m) => (free.get(m) ?? start) <= at);
      if (ready.length === 0) return;
      const man = ready[Math.min(Math.trunc(random.in(0, 1) * ready.length), ready.length - 1)]!;
      const until = k + away < times.length ? times[k + away]! : at + stride + 0.2;
      const roll = random.in(0, 1);
      if (poses && roll < 0.2) {
        const down = at + random.in(0.8, 1.2);
        beats.push({ kind: "gesture", man, at, until: down });
        free.set(man, down + 0.5);
      } else if (poses && roll < 0.4) {
        beats.push({ kind: "knee", man, at, until });
        free.set(man, until + 0.5);
      } else {
        beats.push({ kind: "step", man, at, toward: { x: random.in(-1, 1), y: random.in(-1, 1) }, back: until });
        free.set(man, until + stride);
      }
    });
    return { beats, period: length };
  },
};
