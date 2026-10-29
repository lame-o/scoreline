/**
 * Soccer timeline marks (LiveSnapshot.swift `MatchMark`): minutes from clock
 * text, own goals placed so each side's count matches its score, and the
 * last goal in a line.
 */
import type { MatchMark, Side } from "./models";

const isGoal = (m: MatchMark) => m.kind !== "redCard";

/** "45'+2'" → 47; "64'" → 64; null without a number. */
export function markMinute(display: string): number | null {
  const parts = display
    .split("+")
    .map((p) => p.replace(/\D/g, ""))
    .filter((p) => p.length > 0)
    .map(Number);
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0);
}

/** "B. Saka" → "Saka"; single names stay. */
export function surname(name: string): string {
  const parts = name.split(" ");
  if (parts.length < 2 || !parts[0]!.endsWith(".")) return name;
  return parts.slice(1).join(" ");
}

/** The latest goal in a line: "Saka 64'", "Kane 23' (pen)", "Gross 17' (OG)". */
export function lastGoalLine(marks: readonly MatchMark[]): string | null {
  const goal = [...marks].reverse().find(isGoal);
  if (!goal) return null;
  const name = goal.player ? surname(goal.player) : "Goal";
  const suffix = goal.kind === "penalty" ? " (pen)" : goal.kind === "ownGoal" ? " (OG)" : "";
  return `${name} ${goal.clock}${suffix}`;
}

/**
 * Places own goals so each side's goal count matches its score. ESPN's team
 * on an own goal is ambiguous (sometimes the beneficiary, sometimes the
 * scorer's team), so the credited side is whichever makes the counts add
 * up; if no assignment does, the own goal draws on the track with no side.
 * Ordinary goals and cards keep the side the source gave.
 */
export function reconcileMarks(marks: readonly MatchMark[], topScore: number | null, bottomScore: number | null): MatchMark[] {
  const owns = marks.flatMap((m, i) => (m.kind === "ownGoal" ? [i] : []));
  if (owns.length === 0 || topScore == null || bottomScore == null) return [...marks];
  const fixed = (side: Side) => marks.filter((m) => isGoal(m) && m.kind !== "ownGoal" && m.side === side).length;
  const needTop = topScore - fixed("top");
  const needBottom = bottomScore - fixed("bottom");
  const withSide = (side: Side | null) => marks.map((m, i) => (owns.includes(i) ? { ...m, side } : m));
  if (needTop < 0 || needBottom < 0 || needTop + needBottom !== owns.length) return withSide(null);
  // The source's sides already add up: keep them.
  if (owns.filter((i) => marks[i]!.side === "top").length === needTop && owns.every((i) => marks[i]!.side != null)) return [...marks];
  // Only one way to split them when every own goal goes to the same side.
  if (needTop === 0 || needBottom === 0) return withSide(needTop > 0 ? "top" : "bottom");
  // Mixed, and the counts can't say which is which: no side.
  return withSide(null);
}

/** A knockout tie as a match page says it: the leg, the aggregate and the shootout, top first. */
export interface SoccerTie {
  /** "2nd Leg" (two-legged ties only). */
  readonly leg: string | null;
  readonly aggregate: readonly [number, number] | null;
  readonly shootout: readonly [number, number] | null;
}

const score = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);

/**
 * The tie from a summary's competition (its competitors' `aggregateScore` and
 * `shootoutScore`, its `leg`), with the competitors in top/bottom order.
 * Null for a league match.
 */
export function soccerTie(competition: unknown, top: unknown, bottom: unknown): SoccerTie | null {
  const field = (c: unknown, key: string) => score((c as Record<string, unknown> | null | undefined)?.[key]);
  const pair = (key: string): [number, number] | null => {
    const a = field(top, key);
    const b = field(bottom, key);
    return a != null && b != null ? [a, b] : null;
  };
  const leg = (competition as { leg?: { value?: unknown; displayValue?: unknown } } | null | undefined)?.leg;
  const legText = typeof leg?.displayValue === "string" && leg.displayValue ? leg.displayValue : null;
  const tie = { leg: legText, aggregate: pair("aggregateScore"), shootout: pair("shootoutScore") };
  return tie.leg || tie.aggregate || tie.shootout ? tie : null;
}

/** "2nd Leg · Agg 3–1 · Pens 4–2": the hero's line under the status. */
export function tieLine(tie: SoccerTie | null): string | null {
  if (!tie) return null;
  const parts = [tie.leg, tie.aggregate && tie.leg !== "1st Leg" ? `Agg ${tie.aggregate[0]}–${tie.aggregate[1]}` : null, tie.shootout ? `Pens ${tie.shootout[0]}–${tie.shootout[1]}` : null];
  const line = parts.filter(Boolean).join(" · ");
  return line || null;
}

/**
 * The added time the fourth official announced, and for which half
 * (SoccerIdle.swift `SoccerAddedTime`): the commentary has it ("Fourth
 * official has announced 4 minutes of added time."); the core plays don't.
 * The soccer theater tags it while it's being played.
 */
export interface SoccerAddedTime {
  readonly minutes: number;
  /** 1 or 2 (extra time's 3 and 4). */
  readonly half: number;
}

/** The latest announcement in a summary's commentary. (SoccerAddedTime.latest; pure; tested) */
export function latestAddedTime(commentary: readonly unknown[]): SoccerAddedTime | null {
  for (let i = commentary.length - 1; i >= 0; i--) {
    const c = commentary[i] as { text?: unknown; time?: { displayValue?: unknown } } | null;
    const text = typeof c?.text === "string" ? c.text : null;
    const m = text ? /announced (\d+) minutes? of added time/.exec(text) : null;
    if (!m) continue;
    const display = typeof c?.time?.displayValue === "string" ? c.time.displayValue : "";
    const digits = /^\d+/.exec(display)?.[0];
    const minute = digits ? Number(digits) : 90;
    return { minutes: Number(m[1]), half: minute <= 45 ? 1 : minute <= 90 ? 2 : minute <= 105 ? 3 : 4 };
  }
  return null;
}
