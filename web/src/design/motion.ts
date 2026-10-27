/**
 * Motion tokens for `motion` (motion.dev), mirroring Components.swift
 * `Motion`. CSS durations and curves are in tokens.css; use those for
 * anything a transition can do, and these for springs, layout animation and
 * exits.
 *
 * The rules (ARCHITECTURE.md § Motion):
 * - Springs never bounce. Exits are faster than entrances.
 * - Everything stays under 300ms and interruptible: springs retarget from
 *   the current value; never block input while something animates.
 * - Keyboard actions never animate.
 * - Reduce Motion: anything that moves becomes a short fade (`fade`), never nothing.
 * - Only transform and opacity move. With `motion`, animate `transform`
 *   strings, not the `x`/`y`/`scale` shorthands, for anything that plays
 *   while the page is busy.
 */
import type { Transition } from "motion/react";

/** Emil Kowalski's strong ease-out (Motion.reveal, .exit, .fade, .press). */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/** On-screen changes of light (Motion.light). */
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;

/** Critically damped springs. `visualDuration` is SwiftUI's `spring(duration:)`. */
export const spring = {
  /** Small state changes (a chip, a thumb, a chevron). Motion.quick. */
  quick: { type: "spring", visualDuration: 0.2, bounce: 0 },
  /** Things the system moves (sections collapsing, rows reordering). Motion.standard. */
  standard: { type: "spring", visualDuration: 0.3, bounce: 0 },
  /** Something travelling across the page (crests flying between preview and rows). Motion.travel. */
  travel: { type: "spring", visualDuration: 0.4, bounce: 0 },
} as const satisfies Record<string, Transition>;

export const tween = {
  /** Text arriving. */
  reveal: { duration: 0.25, ease: EASE_OUT },
  /** Leaving: faster than arriving. */
  exit: { duration: 0.12, ease: EASE_OUT },
  /** Small fades; and every movement under Reduce Motion. */
  fade: { duration: 0.15, ease: EASE_OUT },
  /** Press feedback. */
  press: { duration: 0.12, ease: EASE_OUT },
  /** An ambient highlight decaying on its own (a score flash). Deliberately slow. */
  decay: { duration: 1.2, ease: "easeOut" },
  /** A change of light across a surface (a wash taking a new color). */
  light: { duration: 0.9, ease: EASE_IN_OUT },
} as const satisfies Record<string, Transition>;

/** Gap between staggered rows (Motion.stagger), capped at four rows. */
export const STAGGER = 0.04;

/** A score flash: in on `fade`, hold, then a slow decay (TileFlash, EventRow.flash). */
export const FLASH = { inMs: 150, holdMs: 1600, decayMs: 1200 } as const;

/** The live dot's breathing: 1.1s each way, every dot on screen in phase. */
export const PULSE_PERIOD_MS = 2200;

/** The stagger delay for the `index`th row revealed (ScoresGrid.revealDelay). */
export function revealDelay(index: number): number {
  return 0.04 + Math.min(index, 4) * STAGGER;
}
