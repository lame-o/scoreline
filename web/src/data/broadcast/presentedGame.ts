/**
 * The game as one broadcast, part 4: what's presented at p
 * (PresentedGame.swift; BROADCAST.md §3).
 *
 * The score after the last told play, its period, the game clock as it read at
 * p, and the game's phase. The clock is derived, never extrapolated past what's
 * known: it runs from the last told play (unless that play stopped it, or the
 * fast lane says it was stopped then), restarts in time to reach the next
 * known play's clock exactly when that play is presented, and never runs below
 * it. So the scoreboard, the play lists and the theater can't disagree about
 * the time either. Pure: the page re-derives it at each change it schedules
 * (`nextChange`), never per frame.
 *
 * The phase is the one word every surface reads: the hero, the docked bar, the
 * status, the tags. The told plays say it, and so does the fast lane: ESPN can
 * post soccer's half-time entry a quarter of an hour after its status says HT,
 * so a break starts at whichever comes first (on p, the lane's lag taken off).
 */
import { ordinal } from "../format";
import type { BroadcastSport } from "./lanes";
import { periodLengthOf, sameScore, sameStoppage, stoppageWords, type BroadcastPolicy, type GameTimeline, type Hint, type PTime, type ScoreLine, type Stoppage, type TimelineRecord } from "./timeline";

/**
 * "pregame": nothing told yet. "stopped": under way, and held up (a timeout, a
 * review, a pitching change, a rain delay). "interval": between periods
 * (`period` just ended), halftime, between innings.
 */
export type Phase =
  | { readonly kind: "pregame" }
  | { readonly kind: "live" }
  | { readonly kind: "stopped"; readonly stoppage: Stoppage }
  | { readonly kind: "interval"; readonly period: number }
  | { readonly kind: "final" };

export const samePhase = (a: Phase, b: Phase): boolean =>
  a.kind === b.kind &&
  (a.kind !== "stopped" || (b.kind === "stopped" && sameStoppage(a.stoppage, b.stoppage))) &&
  (a.kind !== "interval" || (b.kind === "interval" && a.period === b.period));

/** The game clock at p. */
export interface PresentedClock {
  readonly period: number;
  /** Seconds played in the period. */
  readonly elapsed: number;
  readonly running: boolean;
  /** Counting down (basketball, football) or up (soccer). */
  readonly countsDown: boolean;
  /** Seconds in the period (0: untimed). */
  readonly length: number;
}

/** Seconds left, for a countdown. */
export const remaining = (c: PresentedClock): number => Math.max(c.length - c.elapsed, 0);

export const samePresentedClock = (a: PresentedClock | null, b: PresentedClock | null): boolean =>
  a == null || b == null ? a == b : a.period === b.period && a.elapsed === b.elapsed && a.running === b.running && a.countsDown === b.countsDown && a.length === b.length;

export interface PresentedGame {
  readonly phase: Phase;
  readonly score: ScoreLine | null;
  readonly period: number | null;
  readonly clock: PresentedClock | null;
  /** The last told play, and how many are told. */
  readonly lastID: string | null;
  readonly told: number;
  /** The timeline's revision this was derived from (a correction to a told play changes it). */
  readonly revision: number;
}

export const NOTHING_PRESENTED: PresentedGame = { phase: { kind: "pregame" }, score: null, period: null, clock: null, lastID: null, told: 0, revision: 0 };

export const samePresented = (a: PresentedGame, b: PresentedGame): boolean =>
  samePhase(a.phase, b.phase) && sameScore(a.score, b.score) && a.period === b.period && samePresentedClock(a.clock, b.clock) && a.lastID === b.lastID && a.told === b.told && a.revision === b.revision;

export const isFinal = (g: PresentedGame): boolean => g.phase.kind === "final";
export const isInterval = (g: PresentedGame): boolean => g.phase.kind === "interval";

/** Under way (held up or not): between the first play and the end, outside the breaks. */
export const isUnderway = (g: PresentedGame): boolean => g.phase.kind === "live" || g.phase.kind === "stopped";

/** Why play has stopped, while it has. */
export const stoppageOf = (g: PresentedGame): Stoppage | null => (g.phase.kind === "stopped" ? g.phase.stoppage : null);

/**
 * What the hero says under the clock while play has stopped. A status of the
 * game's own ("Rain Delay") is the status itself: it replaces the clock.
 */
export function noteOf(g: PresentedGame): string | null {
  const s = stoppageOf(g);
  if (!s || s.kind === "status") return null;
  return stoppageWords(s);
}

/** The clock has nothing to say: a break, the end, a game held up. */
export function clockless(g: PresentedGame): boolean {
  if (stoppageOf(g)?.kind === "status") return true;
  return isFinal(g) || isInterval(g);
}

/** What's presented at `p` (PresentedGame.at). */
export function presentedAt<P>(p: PTime, timeline: GameTimeline<P>): PresentedGame {
  const base: PresentedGame = { ...NOTHING_PRESENTED, revision: timeline.revision, told: timeline.toldCount, score: timeline.presentedScore(p) };
  const last = timeline.lastTold;
  if (!last) return base;
  const kind = last.entry.kind;
  const period = last.entry.period;
  let phase: Phase;
  if (kind.endsGame) phase = { kind: "final" };
  else if (kind.endsPeriod != null) phase = { kind: "interval", period: kind.endsPeriod };
  else {
    const s = stoppage(timeline);
    phase = s ? { kind: "stopped", stoppage: s } : { kind: "live" };
  }
  const game = { ...base, lastID: last.entry.id, period, phase, clock: presentedClock(p, last, timeline, timeline.policy) };
  return hear(timeline, p, last, game);
}

/** The stoppage the told plays are in: the newest play's, through whatever bookkeeping came after it; a play ends it. (pure; tested) */
function stoppage<P>(timeline: GameTimeline<P>): Stoppage | null {
  const told = timeline.records.slice(0, timeline.toldCount);
  for (let i = told.length - 1; i >= 0; i--) {
    const kind = told[i]!.entry.kind;
    if (kind.stoppage) return kind.stoppage;
    if (!kind.attaches) return null;
  }
  return null;
}

/**
 * The fast lane's word at `p`, over the plays': a game held up, or a break
 * the plays haven't logged yet (what's known of the period is told first).
 * The clock doesn't run through either.
 */
function hear<P>(timeline: GameTimeline<P>, p: PTime, last: TimelineRecord<P>, game: PresentedGame): PresentedGame {
  if (isFinal(game)) return game;
  const word = timeline.fast.reading(p, timeline.fastLag);
  if (!word) return game;
  const period = last.entry.period;
  const heard = word.period ?? period;
  /** A known play of the period, from before the lane said so: it comes first. */
  const owed = () => {
    const next = timeline.nextUntold;
    if (!next) return false;
    return next.entry.period <= heard && next.entry.kind.endsPeriod == null && next.eventTime <= word.arrived;
  };
  let out = game;
  switch (word.state.kind) {
    case "final":
      return game;
    case "stopped":
      out = { ...game, phase: { kind: "stopped", stoppage: { kind: "status", words: word.state.words } } };
      break;
    case "interval":
      if (isInterval(game) || !(heard >= period) || owed()) return game;
      out = { ...game, phase: { kind: "interval", period: heard }, period: heard };
      break;
    case "live":
      // The lane's in a later period than anything told: it's still the break, as far as this page knows.
      if (isInterval(game) || !(heard > period) || owed()) return game;
      out = { ...game, phase: { kind: "interval", period } };
      break;
  }
  return out.clock ? { ...out, clock: { ...out.clock, running: false } } : out;
}

/** The game clock at `p` from the last told play, the next known one, and the fast lane's word. */
export function presentedClock<P>(p: PTime, last: TimelineRecord<P>, timeline: GameTimeline<P>, policy: BroadcastPolicy): PresentedClock | null {
  const countsDown = policy.clockCountsDown;
  const g0 = last.entry.clock.elapsed;
  if (countsDown == null || g0 == null) return null;
  const period = last.entry.period;
  const length = periodLengthOf(policy, period);
  if (last.entry.kind.endsPeriod != null) return { period, elapsed: countsDown ? length : g0, running: false, countsDown, length };
  const upcoming = timeline.nextUntold;
  const next = upcoming && upcoming.entry.period === period ? upcoming : null;
  const g1 = next?.entry.clock.elapsed ?? null;
  // When it started running after the last play, if it has.
  let runningFrom: PTime | null = null;
  if (countsDown) {
    const hint = latestHint(timeline.hints, p, period);
    if (hint?.kind === "clockRunning") runningFrom = Math.max(hint.seen, last.presentAt);
    else if (hint?.kind === "clockStopped") runningFrom = null;
    else runningFrom = last.entry.kind.stopsClock ? null : last.presentAt;
    // A stopped clock restarts in time to read the next play's clock when it's presented.
    if (runningFrom == null && next && g1 != null && g1 > g0) {
      const restart = next.presentAt - (g1 - g0);
      if (restart <= p) runningFrom = Math.max(restart, last.presentAt);
    }
  } else {
    // Soccer's clock runs through the half.
    runningFrom = last.presentAt;
  }
  let top = ceiling(g0, countsDown, length, policy);
  if (g1 != null && g1 >= g0) top = Math.min(top, g1);
  let elapsed = g0;
  if (runningFrom != null) elapsed = Math.min(g0 + Math.max(p - runningFrom, 0), top);
  return { period, elapsed, running: runningFrom != null && elapsed < top, countsDown, length };
}

/**
 * How far a clock can run on the last play alone. A countdown stops at the
 * period's end. Soccer's has no end to reach, so it stops well past the
 * longest a match goes without logging anything: it never climbs on its
 * own through a break nobody's told it about.
 */
function ceiling(g0: number, countsDown: boolean, length: number, policy: BroadcastPolicy): number {
  if (countsDown) return length > 0 ? length : Infinity;
  return g0 + 2.5 * policy.quietRunning;
}

/** The fast lane's latest word on the clock at `p`, in this period. */
export function latestHint(hints: readonly Hint[], p: PTime, period: number): Hint | null {
  for (let i = hints.length - 1; i >= 0; i--) {
    const h = hints[i]!;
    if (h.period === period && h.seen <= p) return h;
  }
  return null;
}

/**
 * The next p after `p` at which what's presented changes on its own: the
 * next play's presentation, the running clock reaching where it stops, a
 * stopped clock restarting, or the fast lane's next stop or start.
 */
export function nextChange<P>(p: PTime, timeline: GameTimeline<P>): PTime | null {
  const candidates: PTime[] = [];
  const next = timeline.nextPresentAt;
  if (next != null) candidates.push(next);
  for (const c of timeline.corrections) if (c.at > p) candidates.push(c.at);
  const word = timeline.fast.nextReading(p, timeline.fastLag);
  if (word != null) candidates.push(word);
  const last = timeline.lastTold;
  const clock = last ? presentedClock(p, last, timeline, timeline.policy) : null;
  if (last && clock) {
    const upcoming = timeline.nextUntold;
    const nextPlay = upcoming && upcoming.entry.period === last.entry.period ? upcoming : null;
    const g0 = last.entry.clock.elapsed;
    if (clock.running) {
      const limit = g0 != null ? ceiling(g0, clock.countsDown, clock.length, timeline.policy) : Infinity;
      const top = Math.min(nextPlay?.entry.clock.elapsed ?? Infinity, limit);
      if (Number.isFinite(top)) candidates.push(p + (top - clock.elapsed));
    } else if (clock.countsDown && nextPlay) {
      const g1 = nextPlay.entry.clock.elapsed;
      if (g1 != null && g0 != null && g1 > g0) {
        const restart = nextPlay.presentAt - (g1 - g0);
        if (restart > p) candidates.push(restart);
      }
    }
    for (const hint of timeline.hints) if (hint.period === last.entry.period && hint.seen > p) candidates.push(hint.seen);
  }
  let best: PTime | null = null;
  for (const c of candidates) if (c > p + 1e-6 && (best == null || c < best)) best = c;
  return best;
}

// MARK: - Words

/**
 * The game's status as ESPN words it ("4:12 - 3rd", "End of 3rd", "Halftime",
 * "67'", "Half-time", "Top 7th", "Rain Delay", "Final"), for the presented event.
 */
export function presentedStatus(game: PresentedGame, sport: BroadcastSport, regulationPeriods: number): string {
  const phase = game.phase;
  const period = game.period;
  switch (phase.kind) {
    case "pregame":
      return "Live";
    case "final": {
      const extra = (period ?? 0) > regulationPeriods;
      switch (sport) {
        case "soccer":
          return extra ? "AET" : "FT";
        case "baseball":
          return (period ?? 0) > regulationPeriods ? `Final/${Math.trunc(((period ?? 0) + 1) / 2)}` : "Final";
        default:
          return extra ? "Final/OT" : "Final";
      }
    }
    case "interval":
      return intervalName(phase.period, sport, regulationPeriods);
    case "stopped":
      // A game held up says so in ESPN's words; any other stoppage, the clock still says where.
      return phase.stoppage.kind === "status" ? phase.stoppage.words : underway(game, sport, regulationPeriods);
    case "live":
      return underway(game, sport, regulationPeriods);
  }
}

function underway(game: PresentedGame, sport: BroadcastSport, regulationPeriods: number): string {
  const period = game.period;
  if (period == null) return "Live";
  switch (sport) {
    case "baseball": {
      const inning = Math.trunc((period + 1) / 2);
      return `${period % 2 === 1 ? "Top" : "Bot"} ${ordinal(inning)}`;
    }
    case "soccer":
      return game.clock ? minuteText(game.clock, period) : "Live";
    default:
      if (!game.clock) return periodName(period, regulationPeriods);
      return `${countdown(remaining(game.clock))} - ${periodName(period, regulationPeriods)}`;
  }
}

/** A break's name, as the status and the theater's tag both say it. */
export function intervalName(ended: number, sport: BroadcastSport, regulationPeriods: number): string {
  switch (sport) {
    case "soccer":
      switch (ended) {
        case 1:
          return "Half-time";
        case 2:
          return "End of regular time";
        case 3:
          return "Half-time, extra time";
        default:
          return "End of extra time";
      }
    case "baseball":
      return ended % 2 === 1 ? `Mid ${ordinal(Math.trunc((ended + 1) / 2))}` : `End ${ordinal(Math.trunc((ended + 1) / 2))}`;
    default:
      return ended === Math.trunc(regulationPeriods / 2) ? "Halftime" : `End of ${periodName(ended, regulationPeriods)}`;
  }
}

/** "3rd", "OT", "2OT". */
export function periodName(period: number, regulation: number): string {
  if (period <= regulation) return ordinal(period);
  const n = period - regulation;
  return n === 1 ? "OT" : `${n}OT`;
}

/** "4:12", or under a minute "33.8" (ESPN's basketball clock). */
export function countdown(seconds: number): string {
  if (seconds < 60) return (Math.floor(seconds * 10 + 1e-6) / 10).toFixed(1);
  const whole = Math.ceil(seconds);
  return `${Math.trunc(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Soccer's minute: "67'", "45'+2'" in added time. */
export function minuteText(clock: PresentedClock, period: number): string {
  const minute = Math.trunc(clock.elapsed / 60) + 1;
  const base = [45, 90, 105, 120][Math.min(Math.max(period, 1), 4) - 1]!;
  return minute > base ? `${base}'+${minute - base}'` : `${minute}'`;
}
