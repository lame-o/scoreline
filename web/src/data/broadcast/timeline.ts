/**
 * The game as one broadcast, part 1: the timeline (GameTimeline.swift;
 * BROADCAST.md §1).
 *
 * One event-time-ordered list of plays per game, merged from every lane that
 * carries plays (ESPN's summary, ESPN's core plays, MLB's live feed), with the
 * fast lane (the scoreboard, the core status) kept beside it as evidence, never
 * as state. Pure: no clock of its own, no React, no network. Callers pass `now`
 * (seconds since 1970, the same axis as ESPN's `wallclock`), so the recording
 * bench replays it exactly.
 *
 * The parts:
 * - **Ingest.** Each look at a lane is a `LaneSnapshot`: its plays in the
 *   lane's order, and whether they cover the whole game or a tail of it. The
 *   freshest lane wins each region of the game (a stale summary never undoes a
 *   fresher core read), so revisions, removals and order all follow the newest
 *   content, not the newest arrival.
 * - **Event time.** `wallclock` (ESPN) or MLB's `startTime`; batched logging
 *   times and missing ones are estimated from the game clock against their
 *   neighbors. A play at a stopped game clock after a stoppage (free throws
 *   and their rebounds after a foul, a timeout and a challenge) carries the
 *   stoppage's stamp, not its own moment: its event time is a bound, [the
 *   stoppage's start, the clock's restart], from the fast lane and the next
 *   running-clock play, and such plays never size the delay. Plays are
 *   presented at `presentAt`: event times made monotone in timeline order, a
 *   bounded cluster placed backward from its restart (or the theater's
 *   solved anchors, once it supplies them).
 * - **Told.** What's been presented is recorded and always a prefix of the
 *   timeline: a play inserted behind told plays is told at once ("late"), a
 *   revision to a told play is a quiet correction, and a told play is never
 *   untold.
 * - **Knowledge.** The watermark is how far the timeline is known complete
 *   for certain (`knowledge(now)`): the late-insertion floor, a running game's
 *   quiet allowance (confirmed or extended by the fast lane), a score the fast
 *   lane has and no play explains, and a network guard. The clock never
 *   presents past it less the binding horizon. How far behind live the page
 *   runs is a separate, statistical matter: `targetDelay`, sized so almost
 *   every live-ball play is known by its binding horizon (late binding).
 * - **Score.** The presented score is the score after the last told play, so
 *   score and plays can't disagree. The fast lane's score is a hint: one no
 *   play explains holds the watermark, and after a grace period it's applied
 *   quietly (the safety net), logged, and retired by the play when it comes.
 *
 * Swift's value types are classes here, mutated in place; a record handed out
 * (`tell`'s told plays, the theater's snapshot) is a copy, as Swift's is.
 */
import type { JSONValue } from "../json";

/**
 * Seconds since 1970 on the event-time axis (ESPN `wallclock`, MLB `startTime`).
 * The presentation clock presents it 1:1 (`p = now − D`). Seconds, not the web's
 * usual epoch milliseconds, so every number here reads as the Swift's does.
 */
export type PTime = number;

// MARK: - Plays

/** A score after a play, by home and away (the feeds' own terms). */
export interface ScoreLine {
  readonly home: number;
  readonly away: number;
}

export const sameScore = (a: ScoreLine | null | undefined, b: ScoreLine | null | undefined): boolean =>
  a == null || b == null ? a == b : a.home === b.home && a.away === b.away;

/** A score as a key for sets and maps ("3–1" in Swift's description is away–home). */
export const scoreKey = (s: ScoreLine): string => `${s.home}:${s.away}`;

/** "98–100": away first, as Swift's `description`. */
export const scoreText = (s: ScoreLine): string => `${s.away}–${s.home}`;

/** The game clock as a play has it. */
export interface GameClockReading {
  /** Seconds played in the period (null: a sport without a clock, or not given). */
  readonly elapsed: number | null;
  /** The source's resolution: 1 s, or 0.1 s under a minute (basketball). */
  readonly resolution: number;
  /** The source's text ("4:12", "33.8", "67'"). */
  readonly display: string | null;
}

export const NO_CLOCK: GameClockReading = { elapsed: null, resolution: 1, display: null };

export function clockReading(elapsed: number | null, display: string | null = null, resolution = 1): GameClockReading {
  return { elapsed, resolution, display };
}

const sameClock = (a: GameClockReading, b: GameClockReading) => a.elapsed === b.elapsed && a.resolution === b.resolution && a.display === b.display;

/** Where a play's event time comes from (CHOREOGRAPHY §10 `timeSource`). */
export type EventTimeSource =
  /** ESPN's `wallclock`, trusted: the game clock had moved since the last stoppage. */
  | "wallclock"
  /** MLB's `startTime` (the pitch's own moment, to the millisecond). */
  | "statsapi"
  /** Estimated from the game clock between neighbors (missing, or batched logging). */
  | "estimated"
  /** At a stopped clock after a stoppage: the stamp is the stoppage's; the moment lies within `bounds`. */
  | "bounded";

/** Why play has stopped: one table (lanes.ts `stoppage`), read by every surface. */
export type Stoppage =
  | {
      readonly kind:
        | "timeout"
        /** The NFL's TV break, the WNBA's: ESPN's "Official Timeout". */
        | "officialTimeout"
        | "twoMinuteWarning"
        /** A challenge, a replay review. */
        | "review"
        /** Soccer: VAR is looking at something. */
        | "varCheck"
        /** Soccer: a man down, or no reason given. */
        | "delay"
        | "pitchingChange"
        | "moundVisit";
    }
  /** Weather, a suspension: the game's own status, in ESPN's words ("Rain Delay"). */
  | { readonly kind: "status"; readonly words: string };

export const Stoppages = {
  timeout: { kind: "timeout" },
  officialTimeout: { kind: "officialTimeout" },
  twoMinuteWarning: { kind: "twoMinuteWarning" },
  review: { kind: "review" },
  varCheck: { kind: "varCheck" },
  delay: { kind: "delay" },
  pitchingChange: { kind: "pitchingChange" },
  moundVisit: { kind: "moundVisit" },
  status: (words: string): Stoppage => ({ kind: "status", words }),
} as const satisfies Record<string, Stoppage | ((words: string) => Stoppage)>;

export function stoppageWords(s: Stoppage): string {
  switch (s.kind) {
    case "timeout":
      return "Timeout";
    case "officialTimeout":
      return "Official timeout";
    case "twoMinuteWarning":
      return "Two-minute warning";
    case "review":
      return "Under review";
    case "varCheck":
      return "VAR check";
    case "delay":
      return "Delay in match";
    case "pitchingChange":
      return "Pitching change";
    case "moundVisit":
      return "Mound visit";
    case "status":
      return s.words;
  }
}

export const sameStoppage = (a: Stoppage | null | undefined, b: Stoppage | null | undefined): boolean =>
  a == null || b == null ? a == b : a.kind === b.kind && (a.kind !== "status" || (b.kind === "status" && a.words === b.words));

/** What kind of play it is, as far as the clock and the watermark care. */
export interface PlayKind {
  /**
   * "live": shots, rebounds, turnovers, snaps, located soccer entries, pitches: they size the delay and the
   * watermark (BROADCAST §2, CHOREOGRAPHY §3.5 law 3). "dead": fouls, substitutions, timeouts, reviews, admin:
   * routinely 50–230 s late, they attach to the stoppage they belong to and size nothing.
   */
  readonly phase: "live" | "dead";
  /** A word for the bench's breakdowns ("shot", "rebound", "free throw", "substitution"). */
  readonly label: string;
  /** The game clock stops after it (a foul, a timeout, an incompletion, a period end). */
  readonly stopsClock: boolean;
  /** The period it ends, if it ends one; `endsGame`: the game's last. */
  readonly endsPeriod: number | null;
  readonly endsGame: boolean;
  /**
   * Told as an event even when it comes late (a VAR decision): never a quiet
   * correction. Late, it's told at once where the broadcast is (CATCHING UP).
   */
  readonly announced: boolean;
  /**
   * It opens or closes a delay (soccer's VAR checks, injury stoppages): the
   * entries logged inside one carry its start's time but are decided at its end.
   */
  readonly delay: "opens" | "closes" | null;
  /**
   * The ball is dead after it until the next entry (soccer: out, a foul, a
   * corner or free kick given, a goal, a card) though the game clock runs on:
   * nothing on screen moves there, so the clock may skip or hold in it.
   */
  readonly stopsPlay: boolean;
  /** The stoppage it opens: it stands until something plays. */
  readonly stoppage: Stoppage | null;
  /** Bookkeeping during a stoppage (a substitution, the next batter's name): it doesn't end one. */
  readonly attaches: boolean;
}

export interface PlayKindOptions {
  readonly stopsClock?: boolean;
  readonly endsPeriod?: number | null;
  readonly endsGame?: boolean;
  readonly announced?: boolean;
  readonly delay?: "opens" | "closes" | null;
  readonly stopsPlay?: boolean;
  readonly stoppage?: Stoppage | null;
  readonly attaches?: boolean;
}

/** PlayKind.init: a period's end stops the clock too. */
export function playKind(phase: "live" | "dead", label: string, o: PlayKindOptions = {}): PlayKind {
  const endsPeriod = o.endsPeriod ?? null;
  return {
    phase,
    label,
    stopsClock: (o.stopsClock ?? false) || endsPeriod != null,
    endsPeriod,
    endsGame: o.endsGame ?? false,
    announced: o.announced ?? false,
    delay: o.delay ?? null,
    stopsPlay: o.stopsPlay ?? false,
    stoppage: o.stoppage ?? null,
    attaches: o.attaches ?? false,
  };
}

export const sameKind = (a: PlayKind, b: PlayKind): boolean =>
  a.phase === b.phase &&
  a.label === b.label &&
  a.stopsClock === b.stopsClock &&
  a.endsPeriod === b.endsPeriod &&
  a.endsGame === b.endsGame &&
  a.announced === b.announced &&
  a.delay === b.delay &&
  a.stopsPlay === b.stopsPlay &&
  sameStoppage(a.stoppage, b.stoppage) &&
  a.attaches === b.attaches;

/**
 * A lane: where a look at the game came from. "summary": ESPN's game summary
 * (the whole game, every ~10–30 s); "core": ESPN's core plays (the newest
 * plays, every ~5 s); "statsapi": MLB's live feed (the whole game, with
 * millisecond event times).
 */
export type LaneID = "summary" | "core" | "statsapi";

/**
 * How old a look's content can be when it lands (its cache's max-age): a play
 * this lane lacks but another lane has had for less than this isn't gone, the
 * lane just hasn't caught up.
 */
export const contentAge = (lane: LaneID): number => (lane === "summary" ? 12 : 4);

/** One play as a lane reported it, parsed by the sport's adapter (lanes.ts). */
export interface TimelineEntry<Payload> {
  readonly id: string;
  /** The reported event time (ESPN `wallclock`, MLB `startTime`); null when the feed has none. */
  readonly wallclock: PTime | null;
  readonly period: number;
  /**
   * Game progress within the period, increasing with play (elapsed game
   * seconds; for baseball, an at-bat and pitch ordinal). Orders lanes by recency.
   */
  readonly progress: number;
  readonly clock: GameClockReading;
  readonly kind: PlayKind;
  /** The score after it, when the feed says. */
  readonly score: ScoreLine | null;
  /** The feed's line, for logs and the bench. */
  readonly text: string;
  /** Where `wallclock` came from (MLB's feed sets "statsapi"). */
  readonly reportedSource: EventTimeSource;
  /** What changed between versions, by the adapter's own fields (a revision is a new digest). */
  readonly digest: number;
  /** The sport's parsed play (Phase A: the feed's own entry, as JSON). */
  readonly payload: Payload;
}

/** TimelineEntry's `==`: the fields a revision changes (the payload goes by its digest). */
export function sameEntry<P>(a: TimelineEntry<P>, b: TimelineEntry<P>): boolean {
  return a.id === b.id && a.digest === b.digest && a.wallclock === b.wallclock && a.period === b.period && sameKind(a.kind, b.kind) && sameScore(a.score, b.score) && sameClock(a.clock, b.clock);
}

/** A look at one lane: its plays in game order, and how much of the game they are. */
export interface LaneSnapshot<Payload> {
  readonly lane: LaneID;
  readonly entries: readonly TimelineEntry<Payload>[];
  /** "full": the whole game so far (the summary, MLB's feed): a play it lacks is gone. "tail": a contiguous tail of the game (core plays' window). */
  readonly coverage: "full" | "tail";
  /** When it arrived (wall time on the event-time axis). */
  readonly arrived: PTime;
}

/**
 * The feed's own entry for a play, carried through the timeline so the page's
 * real parsers read the presented prefix; equality is by the adapter's digest.
 */
export interface RawPlay {
  readonly json: JSONValue;
  readonly digest: number;
}

// MARK: - Event time

/**
 * ISO 8601 UTC ("2026-10-31T04:49:18Z", with optional fractional seconds or a
 * numeric offset) to seconds since 1970, without a formatter: the summary
 * carries ~500 of these per look. Null for anything else (EventTime.parse).
 */
export function parseEventTime(text: string | null | undefined): PTime | null {
  if (text == null) return null;
  const n = text.length;
  const c = (i: number) => text.charCodeAt(i);
  if (!(n >= 19 && c(4) === 45 && c(7) === 45 && (c(10) === 84 || c(10) === 32) && c(13) === 58 && c(16) === 58)) {
    // DateParser's other shapes: the platform's parser, never a NaN.
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms / 1000 : null;
  }
  const number = (from: number, count: number): number | null => {
    let value = 0;
    for (let i = from; i < from + count; i++) {
      const d = c(i);
      if (!(d >= 48 && d <= 57)) return null;
      value = value * 10 + (d - 48);
    }
    return value;
  };
  const year = number(0, 4);
  const month = number(5, 2);
  const day = number(8, 2);
  const hour = number(11, 2);
  const minute = number(14, 2);
  const second = number(17, 2);
  if (year == null || month == null || day == null || hour == null || minute == null || second == null || month < 1 || month > 12 || day < 1 || day > 31) return null;
  let fraction = 0;
  let i = 19;
  if (i < n && c(i) === 46) {
    i += 1;
    let scale = 0.1;
    while (i < n && c(i) >= 48 && c(i) <= 57) {
      fraction += (c(i) - 48) * scale;
      scale /= 10;
      i += 1;
    }
  }
  let offset = 0;
  if (i < n && (c(i) === 43 || c(i) === 45) && i + 2 < n) {
    const h = number(i + 1, 2);
    if (h != null) {
      let m = 0;
      if (i + 5 < n && c(i + 3) === 58) m = number(i + 4, 2) ?? 0;
      else if (i + 4 < n) m = number(i + 3, 2) ?? 0;
      offset = (h * 3600 + m * 60) * (c(i) === 43 ? 1 : -1);
    }
  }
  // Days from the civil date (Howard Hinnant's algorithm).
  const y = month <= 2 ? year - 1 : year;
  const era = Math.trunc((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.trunc((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.trunc(yoe / 4) - Math.trunc(yoe / 100) + doy;
  const days = era * 146_097 + doe - 719_468;
  return days * 86_400 + hour * 3600 + minute * 60 + second - offset + fraction;
}

// MARK: - The timeline

/**
 * Why a play was told. "onTime": the clock reached it. "late": it arrived (or
 * was inserted) after the clock had passed where it belongs. "history": before
 * the page opened, or skipped by a declared jump: shown, never told as news.
 * "correction": far behind what's told (more than 30 s past its moment), or
 * inserted behind told plays: a scorer's correction, attached quietly, never
 * told as news. Never an announced kind (a VAR decision): inserted behind told
 * plays, it's "late".
 */
export type TellReason = "onTime" | "late" | "history" | "correction";

/** One ingest's effect, for the page (what to re-derive) and the bench (what to count). */
export interface TimelineChange {
  added: string[];
  revised: string[];
  removed: string[];
  /** Revised or removed after being told: quiet corrections, never re-told (BROADCAST §1). */
  correctedTold: string[];
  removedTold: string[];
  /** Inserted behind the told prefix: told at once, late. */
  lateInsertions: string[];
}

export const emptyChange = (): TimelineChange => ({ added: [], revised: [], removed: [], correctedTold: [], removedTold: [], lateInsertions: [] });
export const isEmptyChange = (c: TimelineChange): boolean => c.added.length === 0 && c.revised.length === 0 && c.removed.length === 0 && c.lateInsertions.length === 0;

/**
 * The knowledge frontier (the watermark): up to `frontier` the timeline is believed complete.
 * - "insertion": the newest live-ball play less the late-insertion allowance: the floor, when nothing better holds;
 * - "freshness": the network guard: the slow lane hasn't been read for a few read intervals;
 * - "quiet": the game clock runs and nothing's come for longer than the sport allows;
 * - "unexplainedScore": the fast lane shows a score no play explains yet;
 * - "empty": no plays yet.
 */
export interface Knowledge {
  readonly frontier: PTime;
  readonly bound: "insertion" | "freshness" | "quiet" | "unexplainedScore" | "empty";
}

/**
 * The fast lane's state: in play (the clock may be running or stopped);
 * between periods, halftime, between innings (nothing will be logged for a
 * while); held up (weather, a suspension) in the source's words; final.
 */
export type FastState = { readonly kind: "live" } | { readonly kind: "interval" } | { readonly kind: "stopped"; readonly words: string } | { readonly kind: "final" };

export const FAST_LIVE: FastState = { kind: "live" };
export const FAST_INTERVAL: FastState = { kind: "interval" };
export const FAST_FINAL: FastState = { kind: "final" };

/** Between periods or held up: nothing will be logged for a while. */
export const isQuiet = (s: FastState): boolean => s.kind === "interval" || s.kind === "stopped";
export const sameFastState = (a: FastState, b: FastState): boolean => a.kind === b.kind && (a.kind !== "stopped" || (b.kind === "stopped" && a.words === b.words));

/** One reading of the fast lane (the scoreboard, the core status), kept as evidence. */
export interface FastReading {
  readonly arrived: PTime;
  readonly state: FastState;
  readonly period: number | null;
  /** Seconds played in the period, if the lane has a clock. */
  readonly elapsed: number | null;
  /** Whether the clock moved since the lane's previous reading (null: can't tell). */
  readonly running: boolean | null;
  readonly score: ScoreLine | null;
  /** Which lane, for logs: "scoreboard", "status". */
  readonly source: string;
}

/** The fast lane's word on the clock, on the event-time axis (CHOREOGRAPHY §10). */
export type Hint =
  | { readonly kind: "clockStopped"; readonly period: number; readonly at: number; readonly seen: PTime }
  | { readonly kind: "clockRunning"; readonly period: number; readonly from: number; readonly seen: PTime };

/** A score the fast lane had that no play explained, applied after its grace (the safety net). */
export interface ScoreCorrection {
  /** The newest play when it was applied: it sits right after it. */
  readonly after: string | null;
  /** Where it's presented on p. */
  readonly at: PTime;
  readonly score: ScoreLine;
  /** When it was applied (wall time). */
  readonly applied: PTime;
}

/**
 * Late binding (BROADCAST §2): how long before a play's decisive moment the
 * director must know the play's details. Before that horizon the lead-in is
 * generic flow it can steer at bind time; inside it (the shooter's catch or
 * gather, the snap, the strike) it needs the play. Supplied per kind by the
 * theater side (`Broadcast.setBindingHorizons`); live-ball 2.5 s by default
 * (*tune*); dead-ball kinds attach late to their stoppage and need none.
 */
export interface BindingHorizons {
  readonly live: number;
  /** By the kind's label ("shot", "snap", "pitch"). */
  readonly byKind: Readonly<Record<string, number>>;
}

export const bindingHorizons = (live = 2.5, byKind: Readonly<Record<string, number>> = {}): BindingHorizons => ({ live, byKind });

/** The kind's own entry, else `live` for live-ball kinds and none for dead-ball (they attach late). */
export function horizonFor(h: BindingHorizons, kind: PlayKind): number {
  return Object.hasOwn(h.byKind, kind.label) ? h.byKind[kind.label]! : kind.phase === "dead" ? 0 : h.live;
}

export function sameHorizons(a: BindingHorizons, b: BindingHorizons): boolean {
  if (a.live !== b.live) return false;
  const ak = Object.keys(a.byKind);
  const bk = Object.keys(b.byKind);
  return ak.length === bk.length && ak.every((k) => Object.hasOwn(b.byKind, k) && b.byKind[k] === a.byKind[k]);
}

/** The numbers the timeline and the clock run on, per sport (lanes.ts `policy` sets them). */
export interface BroadcastPolicy {
  /** The quantile of live-ball (lag + binding horizon) the delay is sized from (tuned on the bench). */
  quantile: number;
  /** The binding horizons, until the theater supplies its own. */
  horizons: BindingHorizons;
  /** A little room on top. */
  margin: number;
  /** The live-ball lag assumed before enough plays have arrived (measured per sport). */
  priorLag: number;
  /** The lag window: this many of the newest live-ball arrivals. */
  lagWindow: number;
  /** Samples before the window is trusted alone (until then it's blended with the prior, never below what it's seen). */
  lagTrust: number;
  /** The delay's bounds. */
  minDelay: number;
  maxDelay: number;
  /** How far behind the newest live-ball play another may still be inserted (measured). */
  insertionAllowance: number;
  /**
   * No play reaches the feed sooner than this after it happens (measured p10 ≈ 23 s for the NBA): an upper bound
   * for a stopped-clock play's moment until the clock's restart is known.
   */
  minimumLag: number;
  /** The longest a running game goes without logging a live-ball play, in wall seconds. */
  quietRunning: number;
  /** The fast lane's lag behind event time, until it's measured. */
  priorFastLag: number;
  /**
   * Kinds a jump never skips (told live, in order), besides any play that
   * changes the score and the announced kinds: soccer's shots, saves and cards.
   */
  toldLive: ReadonlySet<string>;
  /**
   * The live-ball kinds whose moment the theater must bind (shots, saves, set
   * pieces); null: every live-ball kind. The others are flow (soccer's passes
   * and touches): the director can fold a late one into the flow around it.
   */
  decisive: ReadonlySet<string> | null;
  /**
   * Size the delay and the network guard on the decisive kinds only (late flow
   * is absorbed by the director, never told out of order). Off: every live-ball kind.
   */
  sizeOnDecisive: boolean;
  /**
   * Hold the clock before a score the fast lane has and no play explains. Off (the default, measured
   * on the bench: it cost ~10 s of delay to tell such baskets on time rather than as micro catch-ups):
   * the clock keeps time, and the order guard is at the tell (nothing after the score is told before it).
   */
  holdForUnexplainedScores: boolean;
  /** A score the fast lane has and no play explains is applied once it's held the clock this long. */
  safetyGrace: number;
  /** More than this far behind the target delay: a declared jump. */
  jumpMax: number;
  /** Catch up (or fall back) inside stoppages, where moving the clock changes nothing on screen. */
  skipStoppages: boolean;
  /** Whether the game clock counts down (basketball, football) or up (soccer); null: none (baseball). */
  clockCountsDown: boolean | null;
  /** Seconds in a regulation period and in an overtime one (0: untimed). */
  periodLength: number;
  overtimeLength: number;
  regulationPeriods: number;
  /** Approaching a hard cap, the clock slews down (0.92×) from this far ahead of it, then eases to a hold. */
  approach: number;
  /** The app's cadence for the slow lane (the bench replays it). */
  slowPoll: number;
  /** And for the fast lane's score (the scoreboard) and clock (the core status). */
  scoreboardPoll: number;
  statusPoll: number;
}

/** BroadcastPolicy's defaults. */
export function defaultPolicy(): BroadcastPolicy {
  return {
    quantile: 0.95,
    horizons: bindingHorizons(),
    margin: 1.0,
    priorLag: 45,
    lagWindow: 40,
    lagTrust: 10,
    minDelay: 8,
    maxDelay: 150,
    insertionAllowance: 4,
    minimumLag: 10,
    quietRunning: 60,
    priorFastLag: 24,
    toldLive: new Set(),
    decisive: null,
    sizeOnDecisive: false,
    holdForUnexplainedScores: false,
    safetyGrace: 20,
    jumpMax: 40,
    skipStoppages: true,
    clockCountsDown: true,
    periodLength: 720,
    overtimeLength: 300,
    regulationPeriods: 4,
    approach: 5,
    slowPoll: 5,
    scoreboardPoll: 30,
    statusPoll: 5,
  };
}

export const periodLengthOf = (policy: BroadcastPolicy, period: number): number => (period <= policy.regulationPeriods ? policy.periodLength : policy.overtimeLength);

/** The q-quantile, linearly interpolated (q in 0…1) (Stats.quantile). */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(Math.max(q, 0), 1) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo);
}

/** Swift's tuple `<`: lexicographic. */
const before = (a: readonly number[], b: readonly number[]): boolean => {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! < b[i]!) return true;
    if (a[i]! > b[i]!) return false;
  }
  return false;
};

/** A play's event-time bound (Swift's `ClosedRange<PTime>`). */
export interface Bounds {
  readonly lower: PTime;
  readonly upper: PTime;
}

const sameBounds = (a: Bounds | null, b: Bounds | null) => (a == null || b == null ? a == b : a.lower === b.lower && a.upper === b.upper);

/** One play on the timeline, with what's been made of it. */
export interface TimelineRecord<Payload> {
  entry: TimelineEntry<Payload>;
  /** When the play first arrived, from any lane (wall time). */
  firstSeen: PTime;
  /** When its current version arrived. */
  changed: PTime;
  /** Versions after the first. */
  revisions: number;
  /** The event time used: the reported one, or an estimate (`estimated`). */
  eventTime: PTime;
  estimated: boolean;
  /** Where the event time comes from; for a stopped-clock play after a stoppage, the bound it lies in. */
  timeSource: EventTimeSource;
  bounds: Bounds | null;
  /** Its arrival lag, if it arrived at the frontier (it may still turn out to be untrustworthy). */
  arrivalLag: number | null;
  /** When it's presented on p: event times made monotone in timeline order. */
  presentAt: PTime;
  told: TellReason | null;
  /** p when it was told, and the version it was told in (a later one is a correction). */
  toldAt: PTime | null;
  toldDigest: number | null;
  /** The lane its current version came from. */
  lane: LaneID;
  /** Known before it could be news: in the opening look, or filled in behind the frontier. */
  backfill: boolean;
  /**
   * First seen in the look after our own outage (this lane unread for longer than
   * it should be: the network failed, the machine was busy): its lag is ours, not
   * the feed's, so it sizes nothing.
   */
  afterOutage: boolean;
}

export const recordID = <P>(r: TimelineRecord<P>): string => r.entry.id;
export const isTold = <P>(r: TimelineRecord<P>): boolean => r.told != null;

/**
 * A live-ball play whose event time is its own (the clock had moved since the
 * last stoppage): only these size the delay and calibrate the fast lane.
 */
export const isTrusted = <P>(r: TimelineRecord<P>): boolean => r.entry.kind.phase === "live" && (r.timeSource === "wallclock" || r.timeSource === "statsapi") && r.bounds == null;

interface LaneView<Payload> {
  readonly entries: readonly TimelineEntry<Payload>[];
  readonly coverage: "full" | "tail";
  readonly arrived: PTime;
  /** How far into the game a look is: its newest play, then when it came. */
  readonly recency: readonly [period: number, progress: number, arrived: PTime];
}

type Merged<P> = { readonly entry: TimelineEntry<P>; readonly lane: LaneID };

/** Where a play sits on the event-time axis, as a planner sees it. */
const placement = <P>(r: TimelineRecord<P>) => [r.eventTime, r.presentAt, r.bounds?.lower ?? null, r.bounds?.upper ?? null, r.timeSource] as const;

/**
 * One game's plays, merged from every lane, in game order. The page keeps one
 * (broadcast.ts), the bench replays one.
 */
export class GameTimeline<Payload> {
  readonly policy: BroadcastPolicy;
  private records_: TimelineRecord<Payload>[] = [];
  private index = new Map<string, number>();
  /** Bumps on any change to the plays or to what's told. */
  revision = 0;
  /** Each lane's latest look. */
  private lanes = new Map<LaneID, LaneView<Payload>>();
  /** When the first look arrived. */
  opened: PTime | null = null;
  private horizons_: BindingHorizons;
  /**
   * The theater's solved decisive moments (Phase 0's anchor solver), by play:
   * untold plays are presented there, so the score and the slide agree with the theater.
   */
  private anchors_ = new Map<string, PTime>();
  /**
   * The theater's actual lead-in to each anchor, including travel into the clip.
   * Catch-ups must finish before that travel starts, not merely before a sport's minimum horizon.
   */
  private leadIns_ = new Map<string, number>();
  /**
   * Anchored plays told while the order guard would have held them (newest last): the guard and the theater
   * disagreed, which is worth a report (the theater's anchor wins).
   */
  readonly guardOverrides: string[] = [];
  /**
   * The plays the theater's newest plan was made from (null: no theater schedules this timeline). A play past
   * them waits for its anchor rather than being told by the fallback first, up to `coverWait` after it arrived.
   */
  private covered_: ReadonlySet<string> | null = null;
  /**
   * Plays the fallback told while a theater scheduled (it hadn't anchored them within `coverWait`), newest last:
   * worth a report, as the court tells them late.
   */
  readonly uncoveredTells: string[] = [];
  /** How many of each there have been (the lists keep the newest 50). */
  guardOverrideCount = 0;
  uncoveredTellCount = 0;
  /**
   * How long after it arrived (wall time) a play the theater hasn't planned yet waits for its anchor (a plan
   * lands in well under a second; this is for a theater that has stopped planning).
   */
  static readonly coverWait = 5;
  /** When each slow lane was last read successfully, changed or not. */
  private lastRead = new Map<LaneID, PTime>();
  /**
   * After our own outage, the next reads' new plays waited on us too, until here
   * (the first read back may find nothing new, and the batch comes a read later).
   */
  private outageUntil = -Infinity;
  /** The gaps between the slow lane's reads (any lane), newest last. */
  private readGaps: number[] = [];
  /** Told plays since removed: one that flickers back isn't told again. */
  private toldTombstones = new Map<string, TellReason>();
  /** Every version each play has had: a stale cache's older version never wins again. */
  private digests = new Map<string, Set<number>>();
  /**
   * When each lane first answered with less than it had before (a stale cache,
   * or its newest play removed): believed once it says so for its content age.
   */
  private regressions = new Map<LaneID, PTime>();
  /** The fast lane, as evidence. */
  readonly fast = new FastLane();
  corrections: ScoreCorrection[] = [];
  /**
   * A told play's score revised down (a VAR overturn, a scorer's fix): the
   * presented score keeps what was told until the next play is told, so it
   * reverts with the review on screen, never quietly ahead of it. With
   * nothing left to tell, it lapses after `heldScoreGrace` (an end-of-game fix).
   */
  heldScore: ScoreLine | null = null;
  heldSince: PTime | null = null;
  /** How many plays were told when the score was held: the next play told releases it. */
  private heldAtTold = 0;
  static readonly heldScoreGrace = 60;
  /** How often the safety net has applied a score (it should be rare). */
  safetyNetApplied = 0;

  constructor(policy: BroadcastPolicy) {
    this.policy = policy;
    this.horizons_ = policy.horizons;
  }

  // MARK: Reading

  get records(): readonly TimelineRecord<Payload>[] {
    return this.records_;
  }

  /** The binding horizons (the theater's, once it supplies them). */
  get horizons(): BindingHorizons {
    return this.horizons_;
  }

  set horizons(next: BindingHorizons) {
    if (!sameHorizons(next, this.horizons_)) this.revision += 1;
    this.horizons_ = next;
  }

  get anchors(): ReadonlyMap<string, PTime> {
    return this.anchors_;
  }

  get leadIns(): ReadonlyMap<string, number> {
    return this.leadIns_;
  }

  get covered(): ReadonlySet<string> | null {
    return this.covered_;
  }

  get isEmpty(): boolean {
    return this.records_.length === 0;
  }

  get count(): number {
    return this.records_.length;
  }

  record(id: string): TimelineRecord<Payload> | null {
    const i = this.index.get(id);
    return i == null ? null : this.records_[i]!;
  }

  position(id: string): number | null {
    return this.index.get(id) ?? null;
  }

  knows(id: string): boolean {
    return this.index.has(id);
  }

  isTold(id: string): boolean {
    const i = this.index.get(id);
    return i == null ? false : this.records_[i]!.told != null;
  }

  /** How many plays are told (always the first ones). */
  get toldCount(): number {
    let lo = 0;
    let hi = this.records_.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.records_[mid]!.told != null) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  get lastTold(): TimelineRecord<Payload> | null {
    const n = this.toldCount;
    return n > 0 ? this.records_[n - 1]! : null;
  }

  /** The next play to tell, if one is known. */
  get nextUntold(): TimelineRecord<Payload> | null {
    const n = this.toldCount;
    return n < this.records_.length ? this.records_[n]! : null;
  }

  /** The newest live-ball event time known. */
  get newestLive(): PTime | null {
    for (let i = this.records_.length - 1; i >= 0; i--) if (this.records_[i]!.entry.kind.phase === "live") return this.records_[i]!.eventTime;
    return null;
  }

  /** The newest event time of anything known. */
  get newest(): PTime | null {
    let best: PTime | null = null;
    for (const r of this.records_) if (best == null || r.eventTime > best) best = r.eventTime;
    return best;
  }

  /** Every score the plays have, in order. */
  get scores(): ScoreLine[] {
    const out: ScoreLine[] = [];
    for (const r of this.records_) if (r.entry.score) out.push(r.entry.score);
    return out;
  }

  /** The score after the told plays, at `p` (a safety-net correction counts once p reaches it). */
  presentedScore(p: PTime): ScoreLine | null {
    if (this.heldScore && this.toldCount === this.heldAtTold) return this.heldScore;
    return this.scoreThrough(this.toldCount, p);
  }

  /** The score after the first `count` plays, and any correction due by `p` placed after them. */
  scoreThrough(count: number, p: PTime = Infinity): ScoreLine | null {
    let line: ScoreLine | null = null;
    let anchor = -1;
    for (let i = Math.min(count, this.records_.length) - 1; i >= 0; i--) {
      const s = this.records_[i]!.entry.score;
      if (s != null) {
        line = s;
        anchor = i;
        break;
      }
    }
    // A correction stands from where it's placed until a play after it carries a score.
    for (let k = this.corrections.length - 1; k >= 0; k--) {
      const c = this.corrections[k]!;
      const after = c.after != null ? (this.index.get(c.after) ?? -1) : -1;
      if (after >= anchor && after < count && c.at <= p) {
        line = c.score;
        break;
      }
    }
    return line;
  }

  /** Live-ball arrivals at the frontier with trusted event times, by arrival: lag and kind. */
  get lags(): { lag: number; kind: PlayKind }[] {
    const trusted = this.records_.filter((r) => isTrusted(r) && r.arrivalLag != null && this.sizes(r.entry.kind));
    // Swift's sort isn't stable either way: ties (one look's plays) keep timeline order here.
    trusted.sort((a, b) => a.firstSeen - b.firstSeen);
    return trusted.slice(-this.policy.lagWindow).map((r) => ({ lag: r.arrivalLag!, kind: r.entry.kind }));
  }

  /** Whether a kind sizes the delay: every live-ball kind, or (`sizeOnDecisive`) the decisive ones. */
  sizes(kind: PlayKind): boolean {
    return !this.policy.sizeOnDecisive || (this.policy.decisive ? this.policy.decisive.has(kind.label) : true);
  }

  /** Whether the theater must bind this kind's moment (not flow it can fold in). */
  isDecisive(kind: PlayKind): boolean {
    return kind.phase === "live" && (this.policy.decisive ? this.policy.decisive.has(kind.label) : true);
  }

  /** The live-ball lag quantile (the network guard's freshness allowance). */
  get lagQuantile(): number {
    return this.quantileOf(this.lags.map((l) => l.lag), this.policy.priorLag);
  }

  /** How often the slow lane is read. */
  get readInterval(): number {
    return this.readGaps.length < 3 ? this.policy.slowPoll : quantile(this.readGaps.slice(-12), 0.5);
  }

  /**
   * The delay the clock aims for (BROADCAST §2, late binding): the quantile
   * of each live-ball play's lag plus its binding horizon (the smallest delay
   * at which the director almost always has a play by the time it must bind
   * it), plus a margin. Plays later than that are recoverable: a compressed
   * lead-in, a declared micro catch-up of up to 1.5 s, else the clock slews
   * down (CHOREOGRAPHY §4.6).
   */
  get targetDelay(): number {
    const need = this.lags.map((l) => l.lag + horizonFor(this.horizons_, l.kind));
    const delay = this.quantileOf(need, this.policy.priorLag + this.horizons_.live) + this.policy.margin;
    return Math.min(Math.max(delay, this.policy.minDelay), this.policy.maxDelay);
  }

  /** The quantile over the newest window, leaning on the prior until the window is trusted (never below what it's seen). */
  private quantileOf(values: readonly number[], prior: number): number {
    const window = values.slice(-this.policy.lagWindow);
    if (window.length === 0) return prior;
    const measured = quantile(window, this.policy.quantile);
    if (window.length >= this.policy.lagTrust) return measured;
    const w = window.length / this.policy.lagTrust;
    return Math.max(measured, w * measured + (1 - w) * prior);
  }

  // MARK: Ingest

  /** A slow lane was read and had nothing new: it's fresh as of `now`. */
  noteRead(lane: LaneID, now: PTime): void {
    if (this.outage(lane, now)) this.outageUntil = now + Math.max(15, 2 * this.readInterval);
    const last = this.lastReadAt;
    if (last != null && now > last + 0.05) {
      this.readGaps.push(now - last);
      if (this.readGaps.length > 24) this.readGaps.splice(0, this.readGaps.length - 24);
    }
    this.lastRead.set(lane, Math.max(this.lastRead.get(lane) ?? -Infinity, now));
  }

  /** When a slow lane was last read. */
  get lastReadAt(): PTime | null {
    let best: PTime | null = null;
    for (const t of this.lastRead.values()) if (best == null || t > best) best = t;
    return best;
  }

  /** Whether a read of `lane` at `now` comes after our own outage: unread for over max(30 s, 3 reads), once the reading cadence is known. */
  private outage(lane: LaneID, now: PTime): boolean {
    const last = this.lastRead.get(lane);
    return this.readGaps.length >= 3 && last != null && now - last > Math.max(30, 3 * this.readInterval);
  }

  /**
   * A look at a lane. The freshest lane wins each region of the game; what
   * it has is diffed against what was known: new plays, revisions (by ID; a
   * version seen before never comes back), removals (only once the lane
   * lacking a play has had time to catch up with it), and late insertions
   * behind what's told.
   */
  ingest(snapshot: LaneSnapshot<Payload>): TimelineChange {
    const toldScore = this.scoreThrough(this.toldCount);
    const change = this.merge(snapshot);
    this.holdReversal(toldScore, change, snapshot.arrived);
    return change;
  }

  private merge(snapshot: LaneSnapshot<Payload>): TimelineChange {
    // This lane unread for longer than it should be (once its cadence is known), or just
    // back from that: what it brings now waited on us.
    const outage = this.outage(snapshot.lane, snapshot.arrived) || snapshot.arrived <= this.outageUntil;
    this.noteRead(snapshot.lane, snapshot.arrived);
    const opening = this.opened == null;
    if (opening) this.opened = snapshot.arrived;
    if (snapshot.entries.length === 0 && snapshot.coverage !== "full") return emptyChange();
    const last = snapshot.entries.at(-1);
    const view: LaneView<Payload> = {
      entries: snapshot.entries,
      coverage: snapshot.coverage,
      arrived: snapshot.arrived,
      recency: [last?.period ?? 0, last?.progress ?? 0, snapshot.arrived],
    };
    // Less than the lane had before: an older cache answering after a newer one, or
    // its newest play really removed. Believed only once the lane has said so for
    // longer than its content can be old.
    const was = this.lanes.get(snapshot.lane);
    if (was && before([view.recency[0], view.recency[1] + 0.001], [was.recency[0], was.recency[1]])) {
      const since = this.regressions.get(snapshot.lane);
      if (since == null || !(snapshot.arrived - since >= contentAge(snapshot.lane))) {
        if (since == null) this.regressions.set(snapshot.lane, snapshot.arrived);
        return emptyChange();
      }
    }
    this.regressions.delete(snapshot.lane);
    this.lanes.set(snapshot.lane, view);
    return this.apply(this.mergedEntries(), snapshot.arrived, opening, outage);
  }

  /**
   * The game as the lanes have it: the freshest lane for its region, then each
   * staler lane only for what comes before the region already covered; then
   * plays the region's lane lacks but can't have caught up with yet.
   */
  private mergedEntries(): Merged<Payload>[] {
    const ordered = [...this.lanes.entries()].sort((a, b) => (before(b[1].recency, a[1].recency) ? -1 : before(a[1].recency, b[1].recency) ? 1 : 0));
    let merged: Merged<Payload>[] = [];
    const covered = new Set<string>();
    let boundary: TimelineEntry<Payload> | null = null;
    let complete = false;
    for (const [lane, view] of ordered) {
      if (view.entries.length === 0) continue;
      let part: readonly TimelineEntry<Payload>[];
      if (boundary) {
        const b: TimelineEntry<Payload> = boundary;
        const cut = view.entries.findIndex((e) => e.id === b.id);
        // The fresher region starts at a play this lane hasn't got: keep what's before it in the game.
        part = cut >= 0 ? view.entries.slice(0, cut) : view.entries.filter((e) => before([e.period, e.progress], [b.period, b.progress]));
      } else {
        part = view.entries;
      }
      const fresh: Merged<Payload>[] = [];
      for (const e of part) {
        if (covered.has(e.id)) continue;
        covered.add(e.id);
        fresh.push({ entry: e, lane });
      }
      merged = [...fresh, ...merged];
      if (view.coverage === "full") {
        complete = true;
        break;
      }
      if (view.entries[0]) boundary = view.entries[0];
    }
    // Before every lane's reach (a window that has moved on): what was known stays.
    const earliest = merged[0]?.entry;
    if (!complete && earliest) {
      let cut = this.index.get(earliest.id);
      if (cut == null) {
        const found = this.records_.findIndex((r) => !before([r.entry.period, r.entry.progress], [earliest.period, earliest.progress]));
        cut = found >= 0 ? found : this.records_.length;
      }
      const kept: Merged<Payload>[] = [];
      for (const r of this.records_.slice(0, cut)) {
        if (covered.has(r.entry.id)) continue;
        covered.add(r.entry.id);
        kept.push({ entry: r.entry, lane: r.lane });
      }
      merged = [...kept, ...merged];
    }
    // A play the region's lane lacks, but which arrived from another lane
    // too recently for this one to have it: kept, right after the play before it.
    const after = new Map<string, Merged<Payload>[]>();
    const leading: Merged<Payload>[] = [];
    const laneOf = new Map<string, LaneID>();
    for (const m of merged) laneOf.set(m.entry.id, m.lane);
    let anchor: string | null = null;
    let winner: LaneID | null = merged[0]?.lane ?? ordered[0]?.[0] ?? null;
    for (const r of this.records_) {
      const lane = laneOf.get(r.entry.id);
      if (lane != null) {
        anchor = r.entry.id;
        winner = lane;
        continue;
      }
      if (covered.has(r.entry.id) || winner == null) continue;
      const view = this.lanes.get(winner);
      if (!view || !(r.firstSeen > view.arrived - contentAge(winner))) continue;
      covered.add(r.entry.id);
      if (anchor != null) {
        const list = after.get(anchor) ?? [];
        list.push({ entry: r.entry, lane: r.lane });
        after.set(anchor, list);
      } else leading.push({ entry: r.entry, lane: r.lane });
    }
    if (after.size === 0 && leading.length === 0) return merged;
    const out = [...leading];
    for (const m of merged) {
      out.push(m);
      const extra = after.get(m.entry.id);
      if (extra) out.push(...extra);
    }
    return out;
  }

  private apply(merged: readonly Merged<Payload>[], arrived: PTime, opening: boolean, outage = false): TimelineChange {
    const change = emptyChange();
    const previous = this.records_;
    const previousIndex = this.index;
    const frontier = this.newest;
    const next: TimelineRecord<Payload>[] = [];
    const seen = new Set<string>();
    for (const { entry, lane: source } of merged) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      const i = previousIndex.get(entry.id);
      if (i != null) {
        const record = { ...previous[i]! };
        if (!sameEntry(record.entry, entry)) {
          // A version this play had before is a stale cache talking: keep the newer one.
          const versions = this.digests.get(entry.id);
          if (versions?.has(entry.digest) && record.entry.digest !== entry.digest) {
            next.push(record);
            continue;
          }
          this.addDigest(entry.id, entry.digest);
          record.revisions += 1;
          record.changed = arrived;
          change.revised.push(entry.id);
          if (record.told != null) change.correctedTold.push(entry.id);
        }
        record.entry = entry;
        record.lane = source;
        next.push(record);
      } else {
        const record: TimelineRecord<Payload> = {
          entry,
          firstSeen: arrived,
          changed: arrived,
          revisions: 0,
          eventTime: 0,
          estimated: false,
          timeSource: "wallclock",
          bounds: null,
          arrivalLag: null,
          presentAt: 0,
          told: null,
          toldAt: null,
          toldDigest: null,
          lane: source,
          backfill: false,
          afterOutage: false,
        };
        this.addDigest(entry.id, entry.digest);
        const behind = frontier != null ? (entry.wallclock ?? Infinity) < frontier - 60 : false;
        record.backfill = opening || behind;
        const tomb = this.toldTombstones.get(entry.id);
        if (tomb != null) {
          this.toldTombstones.delete(entry.id);
          record.told = tomb;
        }
        record.afterOutage = outage && !record.backfill;
        // A live-ball play at the frontier: its lag sizes the delay (if its time turns out trustworthy),
        // unless it waited on our own outage.
        if (!record.backfill && !outage && entry.kind.phase === "live" && entry.wallclock != null) record.arrivalLag = arrived - entry.wallclock;
        next.push(record);
        change.added.push(entry.id);
      }
    }
    for (const old of previous) {
      if (seen.has(old.entry.id)) continue;
      change.removed.push(old.entry.id);
      if (old.told != null) {
        change.removedTold.push(old.entry.id);
        this.toldTombstones.set(old.entry.id, old.told);
      }
    }
    this.records_ = next;
    this.reindex();
    this.estimateEventTimes();
    // Told is a prefix: anything behind a told play is told now, late.
    let lastTold = -1;
    for (let k = this.records_.length - 1; k >= 0; k--) {
      if (this.records_[k]!.told != null) {
        lastTold = k;
        break;
      }
    }
    if (lastTold >= 0) {
      const toldP = this.records_[lastTold]!.toldAt ?? this.records_[lastTold]!.presentAt;
      for (let k = 0; k < lastTold; k++) {
        const r = this.records_[k]!;
        if (r.told != null) continue;
        // An announced kind (a VAR decision) is told as an event even here, never quietly.
        r.told = r.backfill ? "history" : r.entry.kind.announced ? "late" : "correction";
        r.toldAt = toldP;
        r.toldDigest = r.entry.digest;
        r.presentAt = toldP;
        change.lateInsertions.push(r.entry.id);
      }
    }
    this.schedule();
    this.retireCorrections();
    this.fast.match(this);
    if (!isEmptyChange(change)) this.revision += 1;
    return change;
  }

  private addDigest(id: string, digest: number): void {
    const set = this.digests.get(id);
    if (set) set.add(digest);
    else this.digests.set(id, new Set([digest]));
  }

  private reindex(): void {
    this.index = new Map();
    this.records_.forEach((r, i) => this.index.set(r.entry.id, i));
  }

  /**
   * Event times: the reported one where it's believable; batched logging
   * times and missing ones estimated from the game clock against neighbors.
   */
  private estimateEventTimes(): void {
    const records = this.records_;
    const n = records.length;
    if (n === 0) return;
    const times: (number | null)[] = records.map((r) => r.entry.wallclock);
    const estimated = new Array<boolean>(n).fill(false);
    // A batch: plays logged together (one wallclock) across a long stretch of
    // game clock (college football logs that way). All but the last are
    // spread back by the game clock from the play before the batch.
    let i = 0;
    while (i < n) {
      const w = times[i];
      if (w == null) {
        i += 1;
        continue;
      }
      let j = i;
      while (j + 1 < n && times[j + 1] === w && records[j + 1]!.entry.period === records[i]!.entry.period) j += 1;
      const g0 = records[i]!.entry.clock.elapsed;
      const g1 = records[j]!.entry.clock.elapsed;
      if (j > i && g0 != null && g1 != null && g1 - g0 > 15) {
        let b = -1;
        for (let k = i - 1; k >= 0; k--) {
          if (times[k] != null && times[k]! < w) {
            b = k;
            break;
          }
        }
        const tb = b >= 0 ? times[b] : null;
        const gb = b >= 0 ? records[b]!.entry.clock.elapsed : null;
        if (b >= 0 && tb != null && gb != null && records[b]!.entry.period === records[i]!.entry.period && g1 > gb) {
          for (let k = i; k < j; k++) {
            const gk = records[k]!.entry.clock.elapsed;
            if (gk == null) continue;
            times[k] = tb + (w - tb) * Math.min(Math.max((gk - gb) / (g1 - gb), 0), 1);
            estimated[k] = true;
          }
        }
      }
      i = j + 1;
    }
    // Missing: between the neighbors that have one, by game clock where the period allows.
    for (let k = 0; k < n; k++) {
      if (times[k] != null) continue;
      let prev = -1;
      for (let x = k - 1; x >= 0; x--) {
        if (times[x] != null) {
          prev = x;
          break;
        }
      }
      let next = -1;
      for (let x = k + 1; x < n; x++) {
        if (records[x]!.entry.wallclock != null) {
          next = x;
          break;
        }
      }
      const gk = records[k]!.entry.clock.elapsed;
      if (prev >= 0 && next >= 0) {
        const tp = times[prev]!;
        const tq = times[next]!;
        let share = (k - prev) / (next - prev);
        const gp = records[prev]!.entry.clock.elapsed;
        const gq = records[next]!.entry.clock.elapsed;
        if (gp != null && gq != null && gk != null && records[prev]!.entry.period === records[k]!.entry.period && records[next]!.entry.period === records[k]!.entry.period && gq > gp) {
          share = Math.min(Math.max((gk - gp) / (gq - gp), 0), 1);
        }
        times[k] = tp + (tq - tp) * share;
      } else if (prev >= 0) {
        let t = times[prev]!;
        const gp = records[prev]!.entry.clock.elapsed;
        if (gp != null && gk != null && records[prev]!.entry.period === records[k]!.entry.period && gk > gp) t += gk - gp;
        times[k] = t;
      } else if (next >= 0) {
        times[k] = times[next]!;
      } else {
        times[k] = records[k]!.firstSeen;
      }
      estimated[k] = true;
    }
    for (let k = 0; k < n; k++) {
      const r = records[k]!;
      r.eventTime = times[k] ?? r.firstSeen;
      r.estimated = estimated[k]!;
      r.timeSource = estimated[k] ? "estimated" : r.entry.reportedSource;
      r.bounds = null;
    }
    this.boundStoppedClusters();
  }

  /**
   * Plays at a stopped game clock after a stoppage: ESPN stamps them with
   * the stoppage's time (a timeout's, a challenge's), sometimes minutes
   * before they happen. Each such play lies between the stoppage's start
   * and the clock's restart: the restart as the fast lane saw it, or as the
   * next running-clock play implies (its clock ran that long before it),
   * or, until either is known, its own arrival less the feed's minimum lag.
   * Every play of one cluster shares one bound (the theater groups clusters by it):
   * the union of its plays' bounds, which is the restart for all once that's known.
   */
  private boundStoppedClusters(): void {
    this.boundDelays();
    if (this.policy.clockCountsDown !== true) return;
    const records = this.records_;
    let stoppage: { period: number; elapsed: number; at: PTime; from: number } | null = null;
    let cluster: number[] = [];
    const close = () => {
      const s = stoppage;
      if (!s || cluster.length === 0) return;
      let upper = -Infinity;
      for (const k of cluster) upper = Math.max(upper, records[k]!.firstSeen - this.policy.minimumLag);
      const restart = this.restart(s, cluster[0]!);
      if (restart != null) upper = Math.min(upper, restart);
      const bound: Bounds = { lower: s.at, upper: Math.max(s.at, upper) };
      for (const k of cluster) {
        records[k]!.bounds = bound;
        records[k]!.timeSource = "bounded";
      }
      cluster = [];
    };
    for (let k = 0; k < records.length; k++) {
      const r = records[k]!;
      const e = r.entry;
      const g = e.clock.elapsed;
      if (g == null) {
        close();
        stoppage = null;
        continue;
      }
      // A stopped game clock does not make a later wallclock unreliable.
      // NFL snaps often share the timeout's game clock but have their own
      // timestamps. Bounding those by firstSeen can push an entire half
      // to the moment the page opened (CLE–PIT, 2026-11-01).
      if (stoppage && stoppage.period === e.period && Math.abs(g - stoppage.elapsed) < 0.05 && (e.wallclock == null || r.estimated || r.eventTime <= stoppage.at + 1)) {
        cluster.push(k);
        continue;
      }
      close();
      stoppage = e.kind.stopsClock ? { period: e.period, elapsed: g, at: r.eventTime, from: k } : null;
    }
    close();
  }

  /**
   * A delay (soccer's VAR check, an injury stoppage) runs from the entry that
   * opens it to the one that closes it. ESPN logs what's decided inside it
   * (the VAR decision) with the delay's start time, but it's decided at the
   * end: those entries are bounded by the two and placed backward from the
   * end (CHOREOGRAPHY §5.1's cluster placement), so the review plays out on
   * screen before the decision. Until the end is logged, their arrival bounds them.
   */
  private boundDelays(): void {
    const records = this.records_;
    let open: number | null = null;
    let inside: number[] = [];
    const bound = (upper: PTime) => {
      if (open == null || inside.length === 0) return;
      const lower = records[open]!.eventTime;
      const b: Bounds = { lower, upper: Math.max(lower, upper) };
      for (const k of inside) {
        if (records[k]!.bounds != null) continue;
        records[k]!.bounds = b;
        records[k]!.timeSource = "bounded";
      }
    };
    for (let k = 0; k < records.length; k++) {
      const kind = records[k]!.entry.kind;
      if (kind.delay === "opens") {
        open = k;
        inside = [];
        continue;
      }
      if (open == null) continue;
      if (records[k]!.entry.period !== records[open]!.entry.period || kind.phase === "live") {
        // Play went on without a logged end: not a delay to place anything in.
        open = null;
        inside = [];
        continue;
      }
      if (kind.delay === "closes") {
        bound(records[k]!.eventTime);
        open = null;
        inside = [];
        continue;
      }
      inside.push(k);
    }
    let upper = 0;
    if (inside.length > 0) {
      upper = -Infinity;
      for (const k of inside) upper = Math.max(upper, records[k]!.firstSeen - this.policy.minimumLag);
    }
    bound(upper);
  }

  /**
   * When the clock restarted after a stoppage at `s`: the fast lane's first
   * moving reading after it (between it and the last stopped one, less the
   * lane's lag), or the next running-clock play's moment less the time it ran.
   */
  private restart(s: { period: number; elapsed: number; at: PTime }, k: number): PTime | null {
    let best: PTime | null = null;
    const lag = this.fastLag;
    let previous: FastReading | null = null;
    for (const r of this.fast.readings) {
      if (r.period !== s.period) continue;
      if (r.arrived - lag > s.at && r.elapsed != null && r.elapsed > s.elapsed + 0.5) {
        const before = previous ? previous.arrived : r.arrived;
        best = (before + r.arrived) / 2 - lag;
        break;
      }
      previous = r;
    }
    const records = this.records_;
    for (let j = k + 1; j < records.length; j++) {
      const r = records[j]!;
      if (r.entry.period !== s.period) continue;
      const g = r.entry.clock.elapsed;
      if (g == null || !(g > s.elapsed + 0.05)) continue;
      if (r.timeSource === "wallclock" || r.timeSource === "statsapi" || r.estimated) {
        const implied = r.eventTime - (g - s.elapsed);
        best = Math.min(best ?? implied, implied);
      }
      break;
    }
    return best;
  }

  /**
   * `presentAt`: event times made monotone in timeline order; a bounded
   * cluster placed backward from its restart, a second apart (or at the
   * theater's anchors). Told plays keep theirs.
   */
  private schedule(): void {
    const records = this.records_;
    let floor = -Infinity;
    let i = 0;
    while (i < records.length) {
      // A run of plays sharing one bound: placed backward from its upper end.
      let j = i;
      const b = records[i]!.bounds;
      if (b) while (j + 1 < records.length && sameBounds(records[j + 1]!.bounds, b)) j += 1;
      for (let k = i; k <= j; k++) {
        const r = records[k]!;
        if (r.told != null) {
          if (r.toldAt == null) r.presentAt = Math.max(r.eventTime, floor);
          floor = Math.max(floor, r.presentAt);
          continue;
        }
        let at = r.eventTime;
        if (r.bounds) at = Math.max(r.bounds.lower, r.bounds.upper - GameTimeline.backoff(records, k, j));
        const anchor = this.anchors_.get(r.entry.id);
        if (anchor != null) at = anchor;
        r.presentAt = Math.max(at, floor);
        floor = r.presentAt;
      }
      i = j + 1;
    }
  }

  /**
   * The order guard: while the fast lane has a score no play explains, nothing
   * after the last reading the plays explain is told (the clock keeps time).
   */
  get tellBarrier(): PTime | null {
    if (this.policy.holdForUnexplainedScores) return null;
    return this.fast.unexplainedFrom(this, this.fastLag);
  }

  /**
   * How far before a bounded cluster's restart its `k`th play goes, placed
   * backward from the last (`j`): the last a second before the restart, free
   * throws the routine's ~14 s apart (CHOREOGRAPHY §3.1), the rest 2 s.
   * Provisional: the theater's anchor solver places the cluster precisely.
   */
  static backoff<P>(records: readonly TimelineRecord<P>[], k: number, j: number): number {
    let t = 1.0;
    let i = j;
    while (i > k) {
      const both = records[i]!.entry.kind.label === "free throw" && records[i - 1]!.entry.kind.label === "free throw";
      t += both ? 14 : 2;
      i -= 1;
    }
    return t;
  }

  /**
   * The theater's solved decisive moments (CHOREOGRAPHY §5.1): untold plays
   * are presented at them, so the score, the lists and the theater agree to the frame.
   * `covering`: the plays the theater planned from (a play past them waits for the next plan's anchor);
   * left out, the last plan's stand.
   */
  setAnchors(solved: ReadonlyMap<string, PTime>, leadIns: ReadonlyMap<string, number> = new Map(), covering: ReadonlySet<string> | null | undefined = undefined): void {
    const cover = covering === undefined ? this.covered_ : covering;
    const kept = new Map<string, number>();
    for (const [id, v] of leadIns) if (Number.isFinite(v) && v > 0) kept.set(id, v);
    this.leadIns_ = kept;
    const sameAnchors = solved.size === this.anchors_.size && [...solved].every(([id, t]) => this.anchors_.get(id) === t);
    const sameCover = cover == null || this.covered_ == null ? cover == this.covered_ : cover.size === this.covered_.size && [...cover].every((id) => this.covered_!.has(id));
    if (sameAnchors && sameCover) return;
    this.covered_ = cover;
    if (sameAnchors) return;
    this.anchors_ = new Map(solved);
    this.schedule();
    this.revision += 1;
  }

  /**
   * Whether the untold play at `i` waits for the theater: it schedules this timeline, and its newest plan was
   * made before the play was known (so it has no anchor yet).
   */
  private waitsForTheater(i: number): boolean {
    if (!this.covered_) return false;
    const id = this.records_[i]!.entry.id;
    return !this.anchors_.has(id) && !this.covered_.has(id);
  }

  /** When (wall time) the fallback tells the next play if the theater still hasn't anchored it (null: nothing waits). */
  get coverDeadline(): PTime | null {
    const n = this.toldCount;
    if (!(n < this.records_.length) || !this.waitsForTheater(n)) return null;
    return this.records_[n]!.firstSeen + GameTimeline.coverWait;
  }

  // MARK: Telling

  /**
   * Tells every play the clock has reached (`presentAt ≤ p`), in order, and
   * returns them; none past `barrier` (a score no play explains yet: the
   * order guard). One the clock passed by up to `lateAfter` is on time (a
   * micro catch-up, CHOREOGRAPHY §4.6); by more, late; by more than 30 s, a
   * quiet correction.
   *
   * One scheduler: a play the theater has anchored is told at its anchor,
   * the order guard or not (the theater's solver already put the plays in
   * order, and the court draws it then). The guard stays the fallback for
   * plays with no anchor; one it would have held against an anchor is
   * noted in `guardOverrides` (a bug to report, never a second schedule).
   * A play the theater hasn't planned yet (it came in after the newest
   * plan was made: a late arrival) waits for its anchor, and every play
   * after it with it; the fallback tells it only `coverWait` after it
   * arrived (wall time `now`; without one, past its `presentAt`), noted
   * in `uncoveredTells`.
   */
  tell(p: PTime, options: { reason?: TellReason; lateAfter?: number; barrier?: PTime; now?: PTime | null } = {}): TimelineRecord<Payload>[] {
    const reason = options.reason ?? "onTime";
    const lateAfter = options.lateAfter ?? 1.5;
    const barrier = options.barrier ?? Infinity;
    const now = options.now ?? null;
    const told: TimelineRecord<Payload>[] = [];
    const records = this.records_;
    let i = this.toldCount;
    while (i < records.length) {
      const r = records[i]!;
      if (!(r.presentAt <= p) || !(r.presentAt <= barrier || reason === "history" || this.anchors_.has(r.entry.id))) break;
      if (reason !== "history" && this.waitsForTheater(i)) {
        const waited = now != null ? now - r.firstSeen : p - r.presentAt;
        if (!(waited > GameTimeline.coverWait)) break;
        this.uncoveredTells.push(r.entry.id);
        this.uncoveredTellCount += 1;
        if (this.uncoveredTells.length > 50) this.uncoveredTells.shift();
      }
      if (reason !== "history" && r.presentAt > barrier) {
        this.guardOverrides.push(r.entry.id);
        this.guardOverrideCount += 1;
        if (this.guardOverrides.length > 50) this.guardOverrides.shift();
      }
      let why: TellReason = reason;
      if (why === "onTime" && r.backfill) why = "history";
      // More than 30 s late: a quiet correction, unless it's an announced kind (a VAR decision): told as an event, late.
      if (why === "onTime" && p - r.presentAt > 30) why = r.entry.kind.announced ? "late" : "correction";
      if (why === "onTime" && p - r.presentAt > lateAfter) why = "late";
      r.told = why;
      r.toldAt = p;
      r.toldDigest = r.entry.digest;
      told.push({ ...r });
      i += 1;
    }
    if (told.length > 0) this.revision += 1;
    return told;
  }

  /**
   * After an ingest: a VAR-style reversal (a told play's score revised down,
   * with the review that explains it: the told play turned into an announced
   * kind, or an announced play still waiting its turn) holds the told score
   * until the next play is told. A scorer's fix or a removal without a review
   * stays a quiet correction, as before.
   */
  private holdReversal(was: ScoreLine | null, change: TimelineChange, now: PTime): void {
    if (this.heldScore && this.toldCount !== this.heldAtTold) {
      this.heldScore = null;
      this.heldSince = null;
    }
    const current = this.scoreThrough(this.toldCount);
    if (!current) return;
    if (this.heldScore) {
      // Revised back up (the scorer undid it): nothing to hold.
      if (current.home >= this.heldScore.home && current.away >= this.heldScore.away) {
        this.heldScore = null;
        this.heldSince = null;
      }
      return;
    }
    if (!was || !(current.home < was.home || current.away < was.away)) return;
    // The review itself told in this ingest (inserted behind told plays): it reverts now, with it.
    if (change.lateInsertions.some((id) => this.record(id)?.entry.kind.announced === true)) return;
    const n = this.toldCount;
    const review = change.correctedTold.some((id) => this.record(id)?.entry.kind.announced === true) || this.records_.slice(n).some((r) => r.entry.kind.announced);
    if (!review) return;
    this.heldScore = was;
    this.heldSince = now;
    this.heldAtTold = n;
  }

  /**
   * A held score goes once the next play is told, or, with nothing left to
   * tell, after `heldScoreGrace` (an end-of-game fix stays quiet).
   */
  settleHeldScore(now: PTime): void {
    if (!this.heldScore) return;
    if (this.toldCount !== this.heldAtTold || (this.nextUntold == null && this.heldSince != null && now - this.heldSince >= GameTimeline.heldScoreGrace)) {
      this.heldScore = null;
      this.heldSince = null;
      this.revision += 1;
    }
  }

  /** Tells everything up to `p` as history (opening the page, waking, a declared jump). */
  tellHistory(p: PTime): TimelineRecord<Payload>[] {
    return this.tell(p, { reason: "history" });
  }

  /** The `presentAt` of the next play to tell, if one is known. */
  get nextPresentAt(): PTime | null {
    return this.nextUntold?.presentAt ?? null;
  }

  // MARK: Fast lane

  /** A fast-lane reading (the scoreboard every poll, the core status every few seconds). */
  observe(reading: FastReading): void {
    this.fast.observe(reading, this);
    // A restart seen: the stopped-clock plays before it are bounded by it now.
    if (this.records_.some((r) => r.bounds != null && r.told == null)) {
      const was = this.records_.map(placement);
      for (const r of this.records_) {
        r.bounds = null;
        r.timeSource = r.estimated ? "estimated" : r.entry.reportedSource;
      }
      this.boundStoppedClusters();
      this.schedule();
      // Plays that moved (bounds, event time, moment) are a new revision: a planner re-plans.
      const now = this.records_.map(placement);
      if (now.some((p, i) => p.some((v, k) => v !== was[i]![k]))) this.revision += 1;
    }
  }

  /** The fast lane's lag behind event time: measured where its score changes meet scoring plays, else the sport's prior. */
  get fastLag(): number {
    return this.fast.lag ?? this.policy.priorFastLag;
  }

  /** The clock's stops and starts as the fast lane saw them, on the event-time axis. */
  get hints(): Hint[] {
    return this.fast.hints(this.fastLag);
  }

  // MARK: Knowledge (the watermark)

  /**
   * How far the timeline is known complete at `now`, for certain (the
   * watermark: the clock never presents past it less the binding horizon).
   * Hard evidence only; how far behind live to run is `targetDelay`'s job.
   * - insertion: everything older than the newest live-ball play less the
   *   late-insertion allowance is in (the floor);
   * - quiet: a game whose clock may be running doesn't go silent for
   *   longer than the sport allows (`quietRunning`) after the newest play:
   *   past that, plays are missing (ESPN's play-by-play has stalled). The
   *   fast lane's stopped clock at the newest play's, or an interval,
   *   confirms a stoppage and restarts the allowance from that reading;
   * - unexplained score: not past the last fast reading whose score the
   *   timeline explains, while a newer one has a score no play does (a
   *   free throw during a stoppage holds only once the clock runs again);
   * - network: not past the last successful read plus a few read intervals,
   *   less the lag quantile: when reads fail the clock stalls rather than
   *   present a game it hasn't heard.
   */
  knowledge(now: PTime): Knowledge {
    const newestAny = this.newest;
    if (newestAny == null) return { frontier: -Infinity, bound: "empty" };
    const floor = (this.newestLive ?? newestAny) - this.policy.insertionAllowance;
    let cap = (this.lastReadAt ?? now) + 3 * this.readInterval - this.lagQuantile;
    let bound: Knowledge["bound"] = "freshness";
    const quietFrom = Math.max(newestAny, this.fast.quietConfirmed(this, this.fastLag) ?? -Infinity);
    if (quietFrom + this.policy.quietRunning < cap) {
      cap = quietFrom + this.policy.quietRunning;
      bound = "quiet";
    }
    if (this.policy.holdForUnexplainedScores) {
      const unexplained = this.fast.unexplainedFrom(this, this.fastLag);
      if (unexplained != null && unexplained < cap) {
        cap = unexplained;
        bound = "unexplainedScore";
      }
    }
    if (cap < floor) return { frontier: floor, bound: "insertion" };
    return { frontier: cap, bound };
  }

  /** A play a jump must not pass (told live, in order): it changes the score, it's announced (a VAR decision), or its kind is one the sport keeps live. */
  mustTellLive(k: number, previous: ScoreLine | null): boolean {
    const e = this.records_[k]!.entry;
    if (e.kind.announced || this.policy.toldLive.has(e.kind.label)) return true;
    if (e.score && previous && !sameScore(e.score, previous)) return true;
    return false;
  }

  /**
   * Where a jump may land at the latest: just short of the first untold play
   * that must be told live, its lead-in included (CHOREOGRAPHY §4.6: only
   * flow and dead-ball administration go by as history). Null: no such play known.
   */
  get jumpLimit(): PTime | null {
    let previous = this.scoreThrough(this.toldCount);
    for (let k = this.toldCount; k < this.records_.length; k++) {
      const r = this.records_[k]!;
      if (this.mustTellLive(k, previous)) return r.presentAt - Math.max(horizonFor(this.horizons_, r.entry.kind), this.leadIns_.get(r.entry.id) ?? 0) - 1;
      if (r.entry.score) previous = r.entry.score;
    }
    return null;
  }

  /**
   * How far past `p` nothing on screen would change: no play to tell before
   * it, and the game clock stopped all the way (the last told play stopped
   * it, or the fast lane says so for that stretch). The clock may skip or
   * hold anywhere inside it. Null when there's no such span.
   */
  quietSpan(p: PTime, knowledge: PTime): PTime | null {
    const last = this.lastTold;
    if (!last || !(last.presentAt <= p)) return null;
    // Protect every known approach. An administrative entry can precede a
    // shot while that shot's longer approach has already begun; protecting
    // only the next row would let a skip cut through the visible action.
    let end = knowledge;
    for (const record of this.records_.slice(this.toldCount)) {
      const lead = Math.max(horizonFor(this.horizons_, record.entry.kind), this.leadIns_.get(record.entry.id) ?? 0);
      end = Math.min(end, record.presentAt - lead);
    }
    if (!(end > p)) return null;
    // The ball dead (soccer's out of play, ~40% of a match): the game clock runs, but nothing on screen moves.
    const deadBall = last.entry.kind.stopsPlay;
    const stopped =
      deadBall ||
      last.entry.kind.stopsClock ||
      (this.policy.clockCountsDown == null && last.entry.kind.endsPeriod != null) ||
      this.fast.stopped({ lower: p, upper: Math.min(end, p + 600) }, this.fastLag, last.entry.period);
    if (!stopped || !(deadBall || this.policy.clockCountsDown !== false || last.entry.kind.endsPeriod != null)) return null;
    // A stopped clock restarts before the next play: its run stays in view.
    const upcoming = this.nextUntold;
    const g1 = upcoming?.entry.clock.elapsed;
    const g0 = last.entry.clock.elapsed;
    if (upcoming && this.policy.clockCountsDown === true && g1 != null && g0 != null && upcoming.entry.period === last.entry.period && g1 > g0) {
      const restart = upcoming.presentAt - (g1 - g0);
      return restart > p ? Math.min(end, restart) : null;
    }
    return end;
  }

  // MARK: Safety net

  /**
   * A score the fast lane has, that no play explains, applied once the
   * grace has run out: quietly, right after the newest play (BROADCAST §1).
   * The grace runs from the latest moment the score could have happened (its
   * reading, less the fast lane's lag) on p, or, with the clock held for it,
   * from the hold (`held`).
   */
  applySafetyNet(now: PTime, p: PTime, held: number | null): ScoreCorrection | null {
    const reading = this.fast.unexplainedReading(this);
    if (!reading?.score) return null;
    const overdue = this.policy.holdForUnexplainedScores ? (held ?? 0) : p - (reading.arrived - this.fastLag);
    if (!(overdue >= this.policy.safetyGrace)) return null;
    const last = this.records_.at(-1);
    const at = Math.max(reading.arrived - this.fastLag, last?.presentAt ?? -Infinity);
    const correction: ScoreCorrection = { after: last?.entry.id ?? null, at, score: reading.score, applied: now };
    this.corrections.push(correction);
    this.safetyNetApplied += 1;
    this.revision += 1;
    return correction;
  }

  /** A correction retires once a play after it carries its score. */
  private retireCorrections(): void {
    this.corrections = this.corrections.filter((c) => {
      const after = c.after != null ? this.index.get(c.after) : undefined;
      if (after == null) return c.after == null;
      return !this.records_.slice(after + 1).some((r) => sameScore(r.entry.score, c.score));
    });
  }
}

// MARK: - The fast lane, as evidence

/**
 * The fast lane's readings, kept as evidence about the event-time axis: its
 * lag (where its score changes meet scoring plays), the stretches it confirms
 * nothing happened, and the scores the timeline can't explain yet.
 */
export class FastLane {
  readings: FastReading[] = [];
  /** Matched lags: the lane's first sighting of a score − the scoring play's event time. */
  samples: number[] = [];
  private matched = new Set<string>();
  /** Each score's first sighting (wall time). */
  private firstSeen = new Map<string, PTime>();

  private static readonly keep = 160;

  /**
   * The matched lags' median, less half the lane's interval between score
   * readings: each sighting is late by up to one poll (half, on average).
   */
  get lag(): number | null {
    if (this.samples.length < 3) return null;
    const scored = this.readings.filter((r) => r.score != null).map((r) => r.arrived);
    const gaps: number[] = [];
    for (let i = 1; i < scored.length; i++) {
      const gap = scored[i]! - scored[i - 1]!;
      if (gap > 0.5) gaps.push(gap);
    }
    const interval = gaps.length === 0 ? 0 : quantile(gaps, 0.5);
    return Math.max(quantile(this.samples.slice(-20), 0.5) - interval / 2, 3);
  }

  observe<P>(reading: FastReading, timeline: GameTimeline<P>): void {
    this.readings.push(reading);
    if (this.readings.length > FastLane.keep) this.readings.splice(0, this.readings.length - FastLane.keep);
    if (reading.score && !this.firstSeen.has(scoreKey(reading.score))) this.firstSeen.set(scoreKey(reading.score), reading.arrived);
    this.match(timeline);
  }

  /** Each score the lane showed after the page opened, against the play that first had it. */
  match<P>(timeline: GameTimeline<P>): void {
    const opened = this.readings[0]?.arrived;
    if (opened == null) return;
    const earlier = new Set<string>();
    for (const record of timeline.records) {
      const score = record.entry.score;
      if (!score) continue;
      const key = scoreKey(score);
      const seen = this.firstSeen.get(key);
      const fresh = !earlier.has(key) && !this.matched.has(key) && seen != null;
      earlier.add(key);
      if (!fresh) continue;
      this.matched.add(key);
      const sample = seen - record.eventTime;
      // Only plays whose time is their own (a running-clock basket, not a free throw stamped at the stoppage).
      if (!(seen > opened) || !(isTrusted(record) || (record.timeSource === "wallclock" && record.bounds == null)) || !(sample > 0) || !(sample < 180)) continue;
      this.samples.push(sample);
      if (this.samples.length > 40) this.samples.splice(0, this.samples.length - 40);
    }
  }

  /**
   * The lane's word at `p` on the event-time axis: the status's newest by then
   * where the page polls it (the scoreboard's copy can run a poll behind it).
   */
  reading(p: PTime, lag: number): FastReading | null {
    let status: FastReading | null = null;
    let any: FastReading | null = null;
    for (let i = this.readings.length - 1; i >= 0; i--) {
      const r = this.readings[i]!;
      if (!(r.arrived - lag <= p)) continue;
      any ??= r;
      if (r.source === "status") {
        status = r;
        break;
      }
    }
    return status ?? any;
  }

  /** The first moment after `p` the lane says something new (event-time axis). */
  nextReading(p: PTime, lag: number): PTime | null {
    const word = this.reading(p, lag)?.state;
    if (!word) return this.readings[0] ? this.readings[0].arrived - lag : null;
    const next = this.readings.find((r) => r.arrived - lag > p && !sameFastState(r.state, word));
    return next ? next.arrived - lag : null;
  }

  /**
   * The newest event time the lane confirms nothing happened through: the
   * latest reading in an interval, or with the clock stopped at the newest
   * play's clock (same period), and the score the plays have. Readings
   * after it (the clock running again) don't undo it: the quiet allowance
   * simply runs from there.
   */
  quietConfirmed<P>(timeline: GameTimeline<P>, lag: number): PTime | null {
    const newest = timeline.records.at(-1);
    if (!newest) return null;
    const score = timeline.scoreThrough(timeline.records.length);
    for (let i = this.readings.length - 1; i >= 0; i--) {
      const r = this.readings[i]!;
      // Only evidence from after the newest play speaks about the time since it.
      if (!(r.arrived - lag >= newest.eventTime)) return null;
      if (!(r.score == null || score == null || sameScore(r.score, score))) continue;
      if (isQuiet(r.state)) return r.arrived - lag;
      const g = newest.entry.clock.elapsed;
      if (r.state.kind === "live" && r.running === false && r.elapsed != null && g != null && r.period === newest.entry.period && Math.abs(r.elapsed - g) < 1.5) {
        return r.arrived - lag;
      }
    }
    return null;
  }

  /** Whether the lane had the clock stopped (or an interval) over a stretch of event time. */
  stopped(span: Bounds, lag: number, period: number): boolean {
    const quiet = (r: FastReading) => isQuiet(r.state) || (r.running === false && (r.period == null || r.period === period));
    let before: FastReading | null = null;
    for (let i = this.readings.length - 1; i >= 0; i--) {
      if (this.readings[i]!.arrived - lag <= span.lower) {
        before = this.readings[i]!;
        break;
      }
    }
    if (!before || !quiet(before)) return false;
    return this.readings.every((r) => {
      const t = r.arrived - lag;
      return t <= span.lower || t > span.upper || quiet(r);
    });
  }

  /** The newest reading whose score no play (or correction) explains, if it's ahead of the plays. */
  unexplainedReading<P>(timeline: GameTimeline<P>): FastReading | null {
    let r: FastReading | null = null;
    for (let i = this.readings.length - 1; i >= 0; i--) {
      if (this.readings[i]!.score != null) {
        r = this.readings[i]!;
        break;
      }
    }
    const score = r?.score;
    if (!r || !score) return null;
    const scores = timeline.scores;
    const known = new Set([...scores, ...timeline.corrections.map((c) => c.score)].map(scoreKey));
    if (known.has(scoreKey(score))) return null;
    // A lower score than the plays already have is the lane lagging, not news.
    const newest = scores.at(-1);
    if (newest && score.home <= newest.home && score.away <= newest.away) return null;
    return r;
  }

  /**
   * While a reading shows a score no play explains, how far p may go:
   * - the score came with play (a basket, a touchdown, a goal): not past the
   *   last reading before it whose score the timeline explains (it changed after);
   * - the score came while the clock was already stopped at the same reading
   *   (free throws after the foul stopped it, an extra point): nothing live can
   *   happen until the clock runs again, so p goes on through the stoppage and
   *   the play attaches late (CHOREOGRAPHY §4.6); not past the restart, though.
   */
  unexplainedFrom<P>(timeline: GameTimeline<P>, lag: number): PTime | null {
    const bad = this.unexplainedReading(timeline);
    const score = bad?.score;
    if (!bad || !score) return null;
    const scores = timeline.scores;
    const known = new Set([...scores, ...timeline.corrections.map((c) => c.score)].map(scoreKey));
    const readings = this.readings;
    let first = readings.findIndex((r) => sameScore(r.score, score));
    if (first < 0) first = readings.length - 1;
    let consistent: FastReading | null = null;
    for (let i = first - 1; i >= 0; i--) {
      const s = readings[i]!.score;
      if (s && known.has(scoreKey(s))) {
        consistent = readings[i]!;
        break;
      }
    }
    // The score changed after the last reading that had the old one, and after the last
    // play that still carries the old one (every play carries the score after it).
    const old = scores.at(-1);
    let lastOld: PTime | null = null;
    if (old) {
      for (let i = timeline.records.length - 1; i >= 0; i--) {
        if (sameScore(timeline.records[i]!.entry.score, old)) {
          lastOld = timeline.records[i]!.eventTime;
          break;
        }
      }
    }
    const changedAfter = Math.max((consistent?.arrived ?? readings[first]!.arrived - 30) - lag, lastOld ?? -Infinity);
    // The clock as the lanes read it just before the score, and with it.
    let beforeScore: FastReading | null = null;
    for (let i = first - 1; i >= 0; i--) {
      if (readings[i]!.elapsed != null && readings[i]!.running != null) {
        beforeScore = readings[i]!;
        break;
      }
    }
    const withScore = readings.slice(first).find((r) => r.elapsed != null) ?? null;
    if (
      beforeScore &&
      withScore &&
      beforeScore.running === false &&
      beforeScore.period === withScore.period &&
      beforeScore.elapsed != null &&
      withScore.elapsed != null &&
      Math.abs(beforeScore.elapsed - withScore.elapsed) < 1.5
    ) {
      // Stopped since before the score: the cap is where it ran again (null while it hasn't).
      const restart = readings.findIndex((r, i) => i >= first && r.running === true);
      if (restart < 0) return null;
      let lastStopped = readings[first]!;
      for (let i = restart - 1; i >= first; i--) {
        if (readings[i]!.running === false) {
          lastStopped = readings[i]!;
          break;
        }
      }
      return Math.max(lastStopped.arrived - lag, changedAfter);
    }
    return changedAfter;
  }

  /** The clock's stops and starts, on the event-time axis. */
  hints(lag: number): Hint[] {
    const out: Hint[] = [];
    let was: boolean | null = null;
    for (const r of this.readings) {
      if (r.running == null || r.period == null || r.elapsed == null) continue;
      if (r.running !== was) {
        out.push(r.running ? { kind: "clockRunning", period: r.period, from: r.elapsed, seen: r.arrived - lag } : { kind: "clockStopped", period: r.period, at: r.elapsed, seen: r.arrived - lag });
        was = r.running;
      }
    }
    return out;
  }
}
