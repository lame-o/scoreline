/**
 * What the theater director reads from the page's broadcast, and hands back
 * (Broadcast.swift `BroadcastTheaterSource`, CHOREOGRAPHY §10), with the
 * shapes of the timeline and the presentation clock it reads
 * (BroadcastEngine.swift `TimelinePlay`, `TimelineSnapshot`;
 * GameTimeline.swift `RawPlay`, `PlayKind`, `GameClockReading`,
 * `BindingHorizons`; PresentationClock.swift's pieces, regime and events).
 *
 * The timeline and the clock themselves are the broadcast's
 * (data/broadcast: `Broadcast`, `BroadcastEngine`, `PresentationClock`, its
 * own `BroadcastTheaterSource` in theaterSource.ts); these interfaces are
 * exactly what the theater reads of them, field for field, so the director
 * runs against the page's broadcast (the hosts hand it `useTheaterSource()`),
 * the bench's `RecordingReplay`, or a dev page's replay. The page's source
 * is one: checked below, so the two can't drift apart.
 */
import type { BroadcastTheaterSource as PageSource } from "../broadcast/theaterSource";
import type { PTime, Span } from "./theaterEngine";

// MARK: - The presentation clock, as the theater reads it

/** One stretch of the clock: p from `p0` at `t0`, at `v0` and accelerating `a`, until `t1`. */
export interface ClockPiece {
  readonly t0: PTime;
  readonly p0: PTime;
  readonly v0: number;
  readonly a: number;
  readonly t1: PTime;
  p(t: PTime): PTime;
}

/** What the clock did (PresentationClock.Event). */
export type ClockEvent =
  | { readonly kind: "start"; readonly at: PTime; readonly p: PTime }
  | { readonly kind: "wake"; readonly at: PTime; readonly from: PTime; readonly to: PTime }
  | { readonly kind: "jump"; readonly at: PTime; readonly from: PTime; readonly to: PTime }
  | { readonly kind: "skip"; readonly at: PTime; readonly from: PTime; readonly to: PTime }
  | { readonly kind: "stall"; readonly at: PTime; readonly p: PTime }
  | { readonly kind: "resume"; readonly at: PTime; readonly held: number };

export type ClockRegime = "off" | "tracking" | "catchingUp" | "fallingBack" | "stretching" | "stalled";

/** The presentation clock as the theater reads it: p at a wall time, its pieces, its regime and its events. */
export interface TheaterClock {
  readonly pieces: readonly ClockPiece[];
  readonly regime: ClockRegime;
  readonly started: boolean;
  readonly events: readonly ClockEvent[];
  p(t: PTime): PTime;
  /** A copy (PresentationClock.clone): the session keeps one, as Swift's struct is kept. Absent: the clock never changes in place. */
  clone?(): TheaterClock;
}

/** Two events are the same event (Swift's `Equatable` on the enum). */
export function sameEvent(a: ClockEvent, b: ClockEvent): boolean {
  if (a.kind !== b.kind || a.at !== b.at) return false;
  switch (a.kind) {
    case "start":
    case "stall":
      return a.p === (b as typeof a).p;
    case "resume":
      return a.held === (b as typeof a).held;
    default:
      return a.from === (b as typeof a).from && a.to === (b as typeof a).to;
  }
}

// MARK: - The timeline, as the theater reads it

/** The game clock as a play has it. */
export interface GameClockReading {
  /** Seconds played in the period (null: a sport without a clock, or not given). */
  readonly elapsed: number | null;
  /** The source's resolution: 1 s, or 0.1 s under a minute (basketball). */
  readonly resolution: number;
  readonly display: string | null;
}

/** What kind of play it is, as far as the clock and the watermark care. */
export interface PlayKind {
  readonly phase: "live" | "dead";
  /** A word for the bench's breakdowns ("shot", "rebound", "free throw", "substitution"). */
  readonly label: string;
  readonly stopsClock: boolean;
  readonly announced: boolean;
}

/** A score after a play, by home and away. */
export interface ScoreLine {
  readonly home: number;
  readonly away: number;
}

export type EventTimeSource = "wallclock" | "statsapi" | "estimated" | "bounded";

/** The feed's own entry, untouched (GameTimeline.swift `RawPlay`): its JSON and a digest of it. */
export interface RawPlay {
  readonly json: unknown;
  readonly digest: number;
}

/** One play of the timeline (BroadcastEngine.swift `TimelinePlay`). */
export interface TimelinePlay<Play> {
  readonly id: string;
  readonly order: number;
  readonly eventTime: PTime | null;
  /** A stopped-clock play after a stoppage: its moment lies in here. */
  readonly eventBounds: Span | null;
  readonly timeSource: EventTimeSource;
  readonly presentAt: PTime;
  readonly period: number;
  readonly clock: GameClockReading;
  readonly kind: PlayKind;
  readonly score: ScoreLine | null;
  readonly revision: number;
  readonly estimated: boolean;
  readonly firstSeen: PTime;
  readonly play: Play;
}

/** The timeline up to the watermark, and what's known past it (BroadcastEngine.swift `TimelineSnapshot`). */
export interface TimelineSnapshot<Play> {
  readonly plays: readonly TimelinePlay<Play>[];
  readonly watermark: PTime;
  readonly revision: number;
  readonly told: ReadonlySet<string>;
  readonly pending: readonly TimelinePlay<Play>[];
}

/** A play of the timeline carrying another payload (`TimelinePlay.map`). */
export function mapPlay<A, B>(play: TimelinePlay<A>, value: B): TimelinePlay<B> {
  return { ...play, play: value };
}

/** Each kind's binding horizon: how long before a play's moment the theater needs its details. */
export interface BindingHorizons {
  readonly live: number;
  readonly byKind: Readonly<Record<string, number>>;
}

// MARK: - The source

/**
 * What the theater director reads (CHOREOGRAPHY §10) and hands back
 * (Broadcast.swift `BroadcastTheaterSource`).
 */
export interface BroadcastTheaterSource {
  /** Bumps when the plays or what's told change: re-plan. */
  readonly revision: number;
  /** The presentation clock: `p(t)` per frame; changes only on a re-plan. */
  readonly clock: TheaterClock;
  /** Wall time on the event-time axis (seconds since 1970): the page's clock, or a test's virtual one (absent: the wall's). */
  now?(): PTime;
  /** The plays up to the watermark, in order, with what's told; `pending`: known past it. */
  snapshot(): TimelineSnapshot<RawPlay>;
  /** Late binding: each kind's binding horizon (the delay re-sizes from them). */
  setBindingHorizons(horizons: BindingHorizons): void;
  /**
   * The solved decisive moments: untold plays are presented there (one truth
   * for score, lists and theater). `covering`: the plays the theater planned
   * from; a newer one waits for its anchor (null: none waits).
   */
  setAnchors(anchors: ReadonlyMap<string, PTime>, covering: ReadonlySet<string> | null, leadIns: ReadonlyMap<string, number>): void;
  /** Tells the director when the revision or the clock changes (the page's observation); returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** The page's broadcast is a source the director reads (a compile-time check: it fails to build if they drift). */
export type PageSourceFits = PageSource extends BroadcastTheaterSource ? true : never;
export const PAGE_SOURCE_FITS: PageSourceFits = true;
