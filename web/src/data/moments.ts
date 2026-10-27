/**
 * Live moments (Moments.swift): when a new play arrives on a live game page,
 * the chart it belongs to says what just happened with a small, transient
 * animation of the event's own mark, and a caption under the chart for the
 * ones that matter. One moment at a time; nothing replays what was already
 * on screen.
 *
 * Pure: `MomentCenter` is the page's single slot with its rules (the most
 * important wins, a catch-up plays only its newest score, a lesser event never
 * interrupts a greater one, one particle burst per 10 s). The React side
 * (`features/game/core/moments.tsx`) owns one per page and re-renders the
 * charts that read it.
 */
import type { Side } from "./models";

/** How much it matters: scores hold longest and are announced; routine plays only animate their mark. */
export const Tier = { routine: 1, swing: 2, score: 3 } as const;
export type Tier = (typeof Tier)[keyof typeof Tier];

/** The chart that shows it (and captions it). */
export type MomentChart = "field" | "pitch" | "plate" | "spray" | "rounds" | "wall" | "ascent" | "boulder" | "court";

export type MomentKind =
  // Football
  | "touchdown"
  | "fieldGoal"
  | "fieldGoalMissed"
  | "turnover"
  | "safety"
  | "sack"
  | "passComplete"
  | "passIncomplete"
  | "rush"
  | "penalty"
  // Soccer
  | "goal"
  | "shotSaved"
  | "shotBlocked"
  | "shotWide"
  | "yellowCard"
  | "redCard"
  // Baseball
  | "homeRun"
  | "runScored"
  | "hit"
  | "outInPlay"
  | "strikeout"
  | "walk"
  | "doublePlay"
  // CS2
  | "mapWon"
  | "roundWon"
  // Climbing
  | "top"
  | "passed"
  | "finished"
  | "zone"
  // Basketball (a make carries its value in `value`)
  | "made"
  | "missed"
  | "run"
  | "leadChange"
  | "periodEnd"
  | "block"
  | "steal";

/** What makes a moment more than its kind. "Decisive" is an accent on a score, not a fourth tier. */
export type Accent =
  /** Game-winner, walk-off, series or final won: gold, and a bigger burst. */
  | "decisive"
  /** Football: a pass or rush of 20+ yards. */
  | "bigPlay"
  | "dunk"
  | "andOne"
  /** Basketball: made with the clock at a second or less. */
  | "buzzer"
  /** The shooter's last 3+ attempts all went in (count in `streak`). */
  | "onFire"
  /** Basketball: last 5 minutes, within 5. */
  | "clutch"
  /** Soccer: xG 0.3 or more, not scored. */
  | "bigChance"
  | "woodwork"
  | "grandSlam"
  /** Boulder: topped on the first attempt. */
  | "flash"
  | "newLeader"
  /** Climbing final: into the top three for the first time this climb. */
  | "podium"
  /** Baseball: a triple (the play theater's banner brings confetti). */
  | "triple";

export interface LiveMoment {
  readonly id: string;
  readonly chart: MomentChart;
  readonly tier: Tier;
  readonly kind: MomentKind;
  /** Basketball: a make's points (1, 2, 3). */
  readonly value?: number;
  /** The outcome first ("Touchdown", "Round 14"). */
  readonly lead: string;
  /** The play as the source tells it. */
  readonly detail: string;
  readonly side: Side | null;
  readonly accents: ReadonlySet<Accent>;
  /** Consecutive makes (on fire), or rounds (a CS2 streak). */
  readonly streak?: number;
  /** Marks the moment touches beyond its own (climbers passed, the blocker). */
  readonly targets?: readonly string[];
  /** From…to: climbing heights for a pass; game seconds for an NBA run. */
  readonly span?: readonly [number, number];
  /** Set by MomentCenter: a particle burst may play (none on this page in the last 10 s). */
  readonly burst: boolean;
}

const NO_ACCENTS: ReadonlySet<Accent> = new Set();

/** A moment with the usual defaults: no accents, no burst. */
export function liveMoment(m: Omit<LiveMoment, "accents" | "burst" | "side"> & { side?: Side | null; accents?: Iterable<Accent> }): LiveMoment {
  return { ...m, side: m.side ?? null, accents: m.accents ? new Set(m.accents) : NO_ACCENTS, burst: false };
}

/** Routine moments animate without a caption. */
export const captioned = (m: LiveMoment): boolean => m.tier >= Tier.swing;
export const decisive = (m: LiveMoment): boolean => m.accents.has("decisive");

/** Whose score went up (MatchRules.scorer). A safety's side is the offense, tackled in its own end zone. */
export function scorer(m: LiveMoment): Side | null {
  if (!m.side) return null;
  return m.kind === "safety" ? opposite(m.side) : m.side;
}

export const opposite = (side: Side): Side => (side === "top" ? "bottom" : "top");

/** Between particle bursts (confetti, fireworks), per page (Celebrate.cooldown). */
export const BURST_COOLDOWN_MS = 10_000;
/** How long a moment holds the slot. */
export const HOLD_MS = 4000;
export const SCORE_HOLD_MS = 6000;

export interface MomentCenterOptions {
  /** Whether this moment's celebration would be a particle burst at Full (Celebration.wantsBurst). */
  readonly wantsBurst: (m: LiveMoment) => boolean;
  /** The page's clock (tests move it by hand). */
  readonly now?: () => number;
}

/**
 * The page's single moment slot (MomentCenter). `offer` returns the moment
 * that took the slot (or null); the caller schedules its `hold` and calls
 * `expire(id)` when it runs out, so the class has no timers of its own.
 */
export class MomentCenter {
  current: LiveMoment | null = null;
  /** Play IDs already shown (or on screen when the page opened), at the tier they were shown. */
  private seen = new Map<string, Tier>();
  private lastBurst: number | null = null;
  private readonly wantsBurst: (m: LiveMoment) => boolean;
  private readonly now: () => number;

  constructor(options: MomentCenterOptions) {
    this.wantsBurst = options.wantsBurst;
    this.now = options.now ?? Date.now;
  }

  /**
   * New events from one update. The most important wins the slot (the newest
   * breaks ties); a catch-up burst plays only its newest score, or nothing; a
   * lesser event never interrupts a greater one. Nothing queues: a late moment
   * would lie about "now".
   */
  offer(batch: readonly LiveMoment[]): LiveMoment | null {
    const fresh = batch.filter((m) => {
      const was = this.seen.get(m.id);
      return was === undefined || m.tier > was;
    });
    for (const m of fresh) this.seen.set(m.id, m.tier);
    if (fresh.length === 0) return null;
    // At equal tier, decisive beats non-decisive, then the newest wins.
    const catchUp = fresh.filter(captioned).length > 3;
    let candidate: LiveMoment | undefined;
    if (catchUp) {
      candidate = findLast(fresh, (m) => m.tier === Tier.score && decisive(m)) ?? findLast(fresh, (m) => m.tier === Tier.score);
    } else {
      for (const m of fresh) {
        if (!candidate || m.tier > candidate.tier || (m.tier === candidate.tier && (decisive(m) || !decisive(candidate)))) candidate = m;
      }
    }
    if (!candidate) return null;
    const current = this.current;
    if (current && (candidate.tier < current.tier || (candidate.tier === current.tier && decisive(current) && !decisive(candidate)))) return null;
    // A catch-up is old news by the time it lands: it may show, but it never bursts.
    return this.show(candidate, !catchUp);
  }

  /** A score taken back (overturned on review): if it's showing, it goes. Returns whether it went. */
  retract(ids: readonly string[]): boolean {
    if (!this.current || !ids.includes(this.current.id)) return false;
    this.current = null;
    return true;
  }

  /** Already on screen: never news. */
  remember(ids: Iterable<string>): void {
    for (const id of ids) this.seen.set(id, Tier.score);
  }

  /** The hold ran out for `id`; returns whether the slot emptied. */
  expire(id: string): boolean {
    if (this.current?.id !== id) return false;
    this.current = null;
    return true;
  }

  clear(): void {
    this.current = null;
  }

  /** How long `m` holds the slot. */
  static hold(m: LiveMoment): number {
    return m.tier === Tier.score ? SCORE_HOLD_MS : HOLD_MS;
  }

  private show(offered: LiveMoment, mayBurst: boolean): LiveMoment {
    // At most one particle burst every 10 s per page; a second score inside
    // the window gets the calmer substitute (sparks).
    let moment = offered;
    if (this.wantsBurst(moment)) {
      const time = this.now();
      const burst = mayBurst && (this.lastBurst === null || time - this.lastBurst >= BURST_COOLDOWN_MS);
      if (burst) this.lastBurst = time;
      moment = { ...moment, burst };
    }
    this.current = moment;
    return moment;
  }
}

function findLast<T>(items: readonly T[], test: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (test(item)) return item;
  }
  return undefined;
}

/**
 * ESPN's goal and card wording without the type ("Harvey Barnes Goal" →
 * "Harvey Barnes"); anything else unchanged (MomentList.shortened). Shared
 * with the pitch's labels and soccer captions.
 */
export function shortened(text: string): string {
  // "Aitor Paredes Goal - Header" → "Aitor Paredes (header)".
  const goal = text.indexOf(" Goal - ");
  if (goal >= 0) {
    const detail = text.slice(goal + " Goal - ".length).toLowerCase();
    return text.slice(0, goal) + (detail ? ` (${detail})` : "");
  }
  const endings: readonly [string, string][] = [
    [" Penalty - Scored", " (pen)"],
    [" Own Goal", " (OG)"],
    [" Second Yellow Card", " (2nd yellow)"],
    [" Goal", ""],
    [" Yellow Card", ""],
    [" Red Card", ""],
  ];
  for (const [ending, replacement] of endings) {
    if (text.endsWith(ending)) {
      const name = text.slice(0, -ending.length);
      return name ? name + replacement : text;
    }
  }
  return text;
}
