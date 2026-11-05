/**
 * The game as one broadcast, part 5: the engine (timeline + clock, one step
 * at a time) (BroadcastEngine.swift).
 *
 * The one code path the game page (broadcast.ts) and the recording bench
 * both run: lanes in, `advance(now)`, plays told, the next wake scheduled.
 * Pure and deterministic; nothing here reads a clock or sets a timer.
 *
 * Also here: the shapes the theater director reads (CHOREOGRAPHY §10:
 * `TimelinePlay`, `TimelineSnapshot`; `Hint` and `PTime` live with the timeline).
 */
import type { BroadcastSport } from "./lanes";
import { PresentationClock, tuningFor, type ClockEvent } from "./presentationClock";
import { nextChange, presentedAt, type PresentedGame } from "./presentedGame";
import {
  GameTimeline,
  type BindingHorizons,
  type Bounds,
  type BroadcastPolicy,
  type EventTimeSource,
  type FastReading,
  type GameClockReading,
  type Knowledge,
  type LaneID,
  type LaneSnapshot,
  type PlayKind,
  type PTime,
  type ScoreCorrection,
  type ScoreLine,
  type TimelineChange,
  type TimelineRecord,
} from "./timeline";

/** One step's effect: what was told, what the clock did, a safety-net score applied. */
export interface Step<Payload> {
  told: TimelineRecord<Payload>[];
  events: ClockEvent[];
  correction: ScoreCorrection | null;
  knowledge: Knowledge | null;
}

export class BroadcastEngine<Payload> {
  readonly timeline: GameTimeline<Payload>;
  readonly clock: PresentationClock;
  readonly sport: BroadcastSport;

  constructor(sport: BroadcastSport, policy: BroadcastPolicy) {
    this.sport = sport;
    this.timeline = new GameTimeline<Payload>(policy);
    this.clock = new PresentationClock(tuningFor(policy));
  }

  get policy(): BroadcastPolicy {
    return this.timeline.policy;
  }

  get started(): boolean {
    return this.clock.started;
  }

  // MARK: Inputs

  ingest(snapshot: LaneSnapshot<Payload>): TimelineChange {
    return this.timeline.ingest(snapshot);
  }

  noteRead(lane: LaneID, now: PTime): void {
    this.timeline.noteRead(lane, now);
  }

  observe(reading: FastReading): void {
    this.timeline.observe(reading);
  }

  /** The theater's binding horizons (late binding): the delay re-sizes from them. */
  setHorizons(horizons: BindingHorizons): void {
    this.timeline.horizons = horizons;
  }

  /**
   * The theater's solved decisive moments: untold plays are presented at them (one truth for score and slide).
   * `covering`: the plays the theater planned from; a newer one waits for its anchor (null: none waits; left out: as before).
   */
  setAnchors(anchors: ReadonlyMap<string, PTime>, leadIns: ReadonlyMap<string, number> = new Map(), covering?: ReadonlySet<string> | null): void {
    this.timeline.setAnchors(anchors, leadIns, covering);
  }

  // MARK: Stepping

  /**
   * Re-plans the clock with what the timeline knows at `now`, then tells
   * every play p has reached: as history on opening, waking or a declared
   * jump; on time (or late) otherwise. A score the fast lane has held the
   * clock with for longer than the grace is applied (the safety net).
   */
  advance(now: PTime): Step<Payload> {
    const step: Step<Payload> = { told: [], events: [], correction: null, knowledge: null };
    if (this.timeline.isEmpty) return step;
    this.replan(now, step);
    this.timeline.settleHeldScore(now);
    // The safety net: a score no play explains, past its grace.
    const correction = this.timeline.applySafetyNet(now, this.clock.p(now), this.clock.stalled(now));
    if (correction) {
      step.correction = correction;
      this.replan(now, step);
    }
    return step;
  }

  private replan(now: PTime, step: Step<Payload>): void {
    const knowledge = this.timeline.knowledge(now);
    step.knowledge = knowledge;
    // The director must know a play by its binding horizon: p stays that far short of the watermark.
    const cap = knowledge.frontier - this.timeline.horizons.live;
    const before = this.clock.eventRevision;
    const pBefore = this.clock.started ? this.clock.p(now) : cap;
    const quiet = this.timeline.quietSpan(pBefore, cap);
    this.clock.update(now, { target: this.timeline.targetDelay, cap, quietUntil: quiet, jumpLimit: this.timeline.jumpLimit });
    const events = this.clock.eventsSince(before);
    step.events.push(...events);
    const p = this.clock.p(now) + 1e-6;
    // The live edge (opening, waking) and a declared jump: what's passed is history, not news.
    const history = events.some((e) => e.kind === "start" || e.kind === "wake" || e.kind === "jump");
    step.told.push(...(history ? this.timeline.tellHistory(p) : this.timeline.tell(p, { barrier: this.timeline.tellBarrier ?? Infinity, now })));
  }

  static readonly heartbeat = 5;

  // MARK: Reading

  /** The moment presented at `now`. */
  p(now: PTime): PTime {
    return this.clock.p(now);
  }

  /** What's presented at `now`. */
  presented(now: PTime): PresentedGame {
    return presentedAt(this.clock.p(now), this.timeline);
  }

  /**
   * When something next changes on its own (a play's moment, the clock
   * stopping or restarting, the hold beginning, the safety net's grace
   * running out): the page sleeps until then; nothing polls.
   */
  nextWake(now: PTime): PTime | null {
    if (!this.clock.started) return null;
    const timeline = this.timeline;
    const policy = this.policy;
    const candidates: PTime[] = [];
    // A heartbeat while the game goes on: the clock is updated at least this often, so
    // a stretch with nothing read (our network down) is never taken for a wake
    // (a wake tells what passed as history; an outage must tell it live).
    if (timeline.records.at(-1)?.entry.kind.endsGame !== true) candidates.push(now + BroadcastEngine.heartbeat);
    const p = this.clock.p(now);
    const change = nextChange(p, timeline);
    if (change != null) {
      const t = this.clock.wallReaching(change, now);
      if (t != null) candidates.push(t);
    }
    // The hold's start (it's when a stall begins) and the safety net's deadline.
    const hold = this.clock.pieces.at(-1);
    if (hold && hold.v0 === 0 && hold.a === 0 && hold.t0 > now) candidates.push(hold.t0);
    if (this.clock.stalledSince != null && this.clock.regime === "stalled") candidates.push(this.clock.stalledSince + policy.safetyGrace + 0.01);
    // The order guard lifting on its own (the safety net's grace on p).
    const reading = timeline.fast.unexplainedReading(timeline);
    if (reading) {
      const t = this.clock.wallReaching(reading.arrived - timeline.fastLag + policy.safetyGrace + 0.01, now);
      if (t != null) candidates.push(t);
    }
    // A play waiting for the theater's anchor past its grace: the fallback tells it.
    const deadline = timeline.coverDeadline;
    if (deadline != null) candidates.push(deadline + 0.01);
    // A held score lapsing with nothing left to tell.
    if (timeline.heldScore && timeline.nextUntold == null && timeline.heldSince != null) candidates.push(timeline.heldSince + GameTimeline.heldScoreGrace + 0.01);
    // Slew pieces end: the regime changes (the bench logs D).
    for (const piece of this.clock.pieces) if (piece.t0 > now + 1e-3) candidates.push(piece.t0);
    let best: PTime | null = null;
    for (const c of candidates) if (c > now + 1e-3 && (best == null || c < best)) best = c;
    return best;
  }

  /**
   * The theater's view (CHOREOGRAPHY §10): the plays up to the watermark, in
   * order, with what's told; `pending`: known plays past it (provisional).
   */
  snapshot(now: PTime): TimelineSnapshot<Payload> {
    const watermark = this.timeline.knowledge(now).frontier;
    const plays: TimelinePlay<Payload>[] = [];
    const pending: TimelinePlay<Payload>[] = [];
    const told = new Set<string>();
    this.timeline.records.forEach((r, order) => {
      const play: TimelinePlay<Payload> = {
        id: r.entry.id,
        order,
        eventTime: r.eventTime,
        eventBounds: r.bounds,
        timeSource: r.timeSource,
        presentAt: r.presentAt,
        period: r.entry.period,
        clock: r.entry.clock,
        kind: r.entry.kind,
        score: r.entry.score,
        revision: r.revisions,
        estimated: r.estimated,
        firstSeen: r.firstSeen,
        play: r.entry.payload,
      };
      if (r.told != null) told.add(r.entry.id);
      if (r.eventTime <= watermark || r.told != null) plays.push(play);
      else pending.push(play);
    });
    return { plays, watermark, revision: this.timeline.revision, told, pending };
  }
}

// MARK: - What the theater director reads (CHOREOGRAPHY §10)

/** One play on the timeline, as the engine reads it. */
export interface TimelinePlay<Play> {
  readonly id: string;
  /** The timeline's order (position): ESPN's list order, football's sequence, MLB's at-bat and pitch. */
  readonly order: number;
  /**
   * The event time as reported (wallclock, MLB's startTime) or estimated. For a
   * "bounded" play it's the stoppage's stamp: the moment is in `eventBounds`.
   */
  readonly eventTime: PTime | null;
  /**
   * A stopped-clock play after a stoppage: its moment lies between the
   * stoppage's start and the clock's restart (the anchor solver places the
   * cluster backward from the restart; nothing inside the bound is invented
   * here). Every play of one cluster has the identical bound: group by it.
   */
  readonly eventBounds: Bounds | null;
  /** Where `eventTime` comes from. */
  readonly timeSource: EventTimeSource;
  /**
   * Phase A's presentation time: event times made monotone in order. Phase
   * 0's anchor solver supersedes it with decisive moments.
   */
  readonly presentAt: PTime;
  readonly period: number;
  /** Game clock elapsed in the period and its resolution. */
  readonly clock: GameClockReading;
  readonly kind: PlayKind;
  readonly score: ScoreLine | null;
  readonly revision: number;
  readonly estimated: boolean;
  readonly firstSeen: PTime;
  /**
   * The sport's play: Phase A carries the feed's own entry (`RawPlay`); map it
   * to the sport's scene with `mapSnapshot`.
   */
  readonly play: Play;
}

export interface TimelineSnapshot<Play> {
  /** Up to the watermark (and everything told), in order. */
  readonly plays: readonly TimelinePlay<Play>[];
  readonly watermark: PTime;
  /** Bumps on any ingest that changes plays, or anything told. */
  readonly revision: number;
  /** Plays already presented: told plays never re-animate (BROADCAST §1). */
  readonly told: ReadonlySet<string>;
  /** Known plays past the watermark: provisional (something may still be inserted before them). */
  readonly pending: readonly TimelinePlay<Play>[];
}

export const EMPTY_SNAPSHOT: TimelineSnapshot<never> = { plays: [], watermark: -Infinity, revision: 0, told: new Set(), pending: [] };

/** TimelinePlay.map: the same play carrying the sport's parse of it (null: dropped). */
export function mapPlay<P, T>(play: TimelinePlay<P>, transform: (p: P) => T | null): TimelinePlay<T> | null {
  const mapped = transform(play.play);
  return mapped == null ? null : { ...play, play: mapped };
}

/** TimelineSnapshot.map. */
export function mapSnapshot<P, T>(snapshot: TimelineSnapshot<P>, transform: (p: P) => T | null): TimelineSnapshot<T> {
  return {
    plays: snapshot.plays.flatMap((p) => mapPlay(p, transform) ?? []),
    watermark: snapshot.watermark,
    revision: snapshot.revision,
    told: snapshot.told,
    pending: snapshot.pending.flatMap((p) => mapPlay(p, transform) ?? []),
  };
}
