/**
 * What one soccer entry says about itself (SoccerScene.swift `isGoal`,
 * `credit`, `teamID`, `playID`), on its own so the live lane (SoccerFeed's
 * VAR reviews, data/liveFeeds/soccer.ts) can read it without loading the
 * scene parser, which loads with the theater. `SoccerScene` (soccerScene.ts)
 * carries these too.
 */
import { at, bool, type JSONValue } from "../json";

/** `JSON.string`: a string, or a number's text. */
export function string(v: JSONValue): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * A player exactly as ESPN credits him: athlete ID, shirt number and lineup
 * role (ESPN's soccer position: 1 the keeper, 4 CD-L, 5 CD-R, 8 LB, 9 RB, 14
 * AM, 16 LM, 17 RM, 19 F, 27 a substitute, 32 AM-L, 33 AM-R).
 */
export interface Credit {
  readonly athlete: string;
  readonly jersey: string | null;
  readonly role: number | null;
  /** Lineup role 1 (Swift's computed `keeper`). */
  readonly keeper: boolean;
}

/** A goal, as the entry stands (VAR may retype it later). */
export function isGoal(item: JSONValue): boolean {
  const type = string(at(item, "type", "type")) ?? "";
  return bool(at(item, "scoringPlay")) === true || type === "goal" || type.startsWith("goal---") || type === "own-goal" || type === "penalty---scored";
}

/** Who an entry credits, exactly: its first participant by default (the shooter, the passer), the assister second. */
export function credit(item: JSONValue, index = 0): Credit | null {
  const p = at(item, "participants", index);
  const athlete = idAfter(string(at(p, "athlete", "$ref")), "/athletes/");
  if (athlete == null) return null;
  const role = idAfter(string(at(p, "position", "$ref")), "/positions/");
  const n = role != null ? Number(role) : null;
  return { athlete, jersey: string(at(p, "jersey")), role: n, keeper: n === 1 };
}

/** ".../teams/362?lang=en" → "362". */
export function teamID(item: JSONValue): string | null {
  return idAfter(string(at(item, "team", "$ref")), "/teams/");
}

export function playID(item: JSONValue): string | null {
  return string(at(item, "id"));
}

/** The digits after a marker in a `$ref` ("…/athletes/236322?lang=en" → "236322"); null without any. */
function idAfter(ref: string | null, marker: string): string | null {
  if (ref == null) return null;
  const i = ref.indexOf(marker);
  if (i < 0) return null;
  const id = /^\d+/.exec(ref.slice(i + marker.length))?.[0];
  return id ? id : null;
}
