/**
 * What the theater director reads from the broadcast, and hands back
 * (Broadcast.swift `BroadcastTheaterSource`; CHOREOGRAPHY.md §10; BROADCAST.md
 * §4). The seam between the presentation clock (this folder) and the theater
 * engine (CHOREOGRAPHY Phase 0: the director, the clips, the anchor solver).
 *
 * The page's `Broadcast` (broadcast.ts) is the one implementation; the page's
 * hook hands it to the theaters (features/game/core/broadcast.tsx
 * `useTheaterSource`). Until the director reads it, the theaters keep today's
 * inputs, as the Mac's Phase A did.
 *
 *     const source = useTheaterSource();               // null: the page doesn't broadcast
 *     source.subscribe(() => replan(source.snapshot(), source.revision));
 *     const p = source.clock.p(source.now());          // per frame, on the theater's own loop
 *     source.setBindingHorizons({ live: 2.5, byKind: { shot: 3 } });
 *     source.setAnchors(solved, plannedFrom, leadIns); // untold plays are presented there
 *
 * The fallback when no anchor comes is the timeline's (timeline.ts `tell`,
 * `coverDeadline`): a play the theater's newest plan didn't cover waits for
 * its anchor `GameTimeline.coverWait` (5 s) after it arrived, then the
 * fallback tells it at its own `presentAt` and notes it (`uncoveredTells`),
 * so nothing waits forever on a theater that stopped planning.
 */
import type { TimelineSnapshot } from "./engine";
import type { PresentationClock } from "./presentationClock";
import type { BindingHorizons, Hint, PTime, RawPlay } from "./timeline";

export interface BroadcastTheaterSource {
  /** Bumps when the plays or what's told change: re-plan (hear it through `subscribe`). */
  readonly revision: number;
  /** The presentation clock: `p(t)` per frame; changes only on a re-plan (hear it through `subscribe`). */
  readonly clock: PresentationClock;
  /** Wall time on the event-time axis (seconds since 1970): the page's clock, or a test's virtual one. */
  now(): PTime;
  /** The plays up to the watermark, in order, with what's told; `pending`: known past it. */
  snapshot(): TimelineSnapshot<RawPlay>;
  /** The fast lane's word on the clock, on the event-time axis. */
  readonly hints: readonly Hint[];
  /** Late binding: each kind's binding horizon (the delay re-sizes from them). */
  setBindingHorizons(horizons: BindingHorizons): void;
  /**
   * The solved decisive moments: untold plays are presented there (one truth for score, lists and theater).
   * `covering`: the plays the theater planned from; a newer one waits for its anchor (null: none waits).
   * `leadIns`: the theater's actual lead-in to each anchor (a jump and a skip stop short of it).
   */
  setAnchors(anchors: ReadonlyMap<string, PTime>, covering: ReadonlySet<string> | null, leadIns?: ReadonlyMap<string, number>): void;
  /** Swift's observation: called after any published change (the revision, the clock, what's presented). */
  subscribe(listener: () => void): () => void;
}
