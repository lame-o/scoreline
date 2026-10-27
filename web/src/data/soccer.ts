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
