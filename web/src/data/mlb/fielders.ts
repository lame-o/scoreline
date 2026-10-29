/**
 * Who's in the field for each team now, as the summary has it
 * (PlayTheater.swift `BaseballFielders`, `BaseballNow`): each place's man
 * from ESPN's lineups (the man active at his spot in the order and the
 * position he plays now, so a defensive change, or a pinch hitter who stayed
 * in, stands where he went), the pitchers in the order they came in (the box
 * score's, the one in now marked active), and each side's men, to find a man
 * a beat names by his surname. Parsed once per summary (gameDetail.ts), for
 * the names over the play theater's figures. (pure; tested)
 */
import { arr, at, bool, str, type JSONValue } from "../json";
import type { Side } from "../models";

export interface BaseballFielders {
  /** By scorer's number (2 the catcher … 9 right field), ESPN athlete IDs. */
  readonly positions: Readonly<Partial<Record<Side, Readonly<Record<number, string>>>>>;
  readonly pitchers: Readonly<Partial<Record<Side, readonly string[]>>>;
  /** The pitcher in now. */
  readonly pitching: Readonly<Partial<Record<Side, string>>>;
  readonly men: Readonly<Partial<Record<Side, readonly string[]>>>;
}

export const NO_FIELDERS: BaseballFielders = { positions: {}, pitchers: {}, pitching: {}, men: {} };

/** A place in the field by its abbreviation, and back. */
export const PLACES: Readonly<Record<string, number>> = { P: 1, C: 2, "1B": 3, "2B": 4, "3B": 5, SS: 6, LF: 7, CF: 8, RF: 9 };
export const PLACE_NAMES: Readonly<Record<number, string>> = { 1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF" };

export function baseballFielders(summary: JSONValue, side: (teamID: string | undefined) => Side | null): BaseballFielders {
  const positions: Partial<Record<Side, Record<number, string>>> = {};
  const pitchers: Partial<Record<Side, string[]>> = {};
  const pitching: Partial<Record<Side, string>> = {};
  const men: Partial<Record<Side, string[]>> = {};
  for (const roster of arr(at(summary, "rosters"))) {
    const s = side(str(at(roster, "team", "id")));
    if (!s) continue;
    const places: Record<number, { id: string; starter: boolean }> = {};
    for (const entry of arr(at(roster, "roster"))) {
      const id = str(at(entry, "athlete", "id"));
      if (!id) continue;
      (men[s] ??= []).push(id);
      const n = PLACES[str(at(entry, "position", "abbreviation")) ?? ""];
      if (bool(at(entry, "active")) !== true || n == null) continue;
      // Two at one place while the lineups catch up with a change: the man who came in.
      const starter = bool(at(entry, "starter")) ?? false;
      const held = places[n];
      if (held && !held.starter && starter) continue;
      places[n] = { id, starter };
    }
    positions[s] = Object.fromEntries(Object.entries(places).map(([n, p]) => [n, p.id]));
  }
  for (const team of arr(at(summary, "boxscore", "players"))) {
    const s = side(str(at(team, "team", "id")));
    if (!s) continue;
    for (const group of arr(at(team, "statistics"))) {
      if (str(at(group, "type")) !== "pitching") continue;
      const list = arr(at(group, "athletes"));
      const ids = list.flatMap((e) => str(at(e, "athlete", "id")) ?? []);
      pitchers[s] = ids;
      const now = list.findLast((e) => bool(at(e, "active")) === true);
      const id = (now ? str(at(now, "athlete", "id")) : undefined) ?? ids.at(-1);
      if (id) pitching[s] = id;
      (men[s] ??= []).push(...ids);
    }
  }
  return { positions, pitchers, pitching, men };
}

/** The game as the live situation has it now: the side at bat, the batter, the pitcher, the runner on each base (ESPN athlete IDs). */
export interface BaseballNow {
  readonly side: Side | null;
  readonly batter: string | null;
  readonly pitcher: string | null;
  readonly runners: readonly [string | null, string | null, string | null];
}
