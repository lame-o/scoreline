/**
 * What a feed knows about a score beyond its moment's caption
 * (ScoringSlide.swift `ScoringFacts`): the score after it, what it was worth,
 * the feed's full account and its own kind of play, and when. The lanes set
 * it on scores (`LiveMoment.facts`); only the scoring slide reads it
 * (data/scoringSlide.ts).
 *
 * Its own small file so the lanes stay light: the slide's rules and words
 * load with the game page, not with every lane.
 */
import { at, str, type JSONValue } from "./json";
import type { Side } from "./models";

export interface ScoringFacts {
  /** The score after the play, top team first. */
  readonly top?: number | null;
  readonly bottom?: number | null;
  /** What it was worth as the feed counts it (runs, a touchdown and its try, a basket). */
  readonly value?: number | null;
  /** The feed's full account ("Hicks homered to right center (411 feet), Caminero scored."). */
  readonly text?: string | null;
  /** The feed's own kind of play ("home-run", "goal---header", "Passing Touchdown"). */
  readonly type?: string | null;
  /** The clock as the feed shows it ("52'", "13:25", "0.0"). */
  readonly clock?: string | null;
  /** The inning, quarter or half. */
  readonly period?: number | null;
}

/** Swift's `json.int`: a number, or a numeric string. */
function intOf(value: JSONValue): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * A baseball play-result. ESPN's score fields are the score after it, home
 * and away; the visitors bat in the top of an inning.
 */
export function baseballFacts(item: JSONValue, batting: Side | null): ScoringFacts {
  let top: number | null = null;
  let bottom: number | null = null;
  const home = intOf(at(item, "homeScore"));
  const away = intOf(at(item, "awayScore"));
  if (batting && home != null && away != null) {
    const visitorsBat = str(at(item, "period", "type"))?.toLowerCase() !== "bottom";
    const [bats, fields] = visitorsBat ? [away, home] : [home, away];
    [top, bottom] = batting === "top" ? [bats, fields] : [fields, bats];
  }
  return {
    top,
    bottom,
    value: intOf(at(item, "scoreValue")),
    text: str(at(item, "text")) ?? null,
    type: str(at(item, "alternativeType", "type")) ?? null,
    period: intOf(at(item, "period", "number")),
  };
}

/** The part of a football snap the facts read (DrivePlay). */
export interface FootballScore {
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly text: string;
  readonly type: string;
  readonly clock: string;
  readonly period: number | null;
}

/**
 * A football scoring play: the score after it (its try included, once ESPN
 * has added it) and what it added, from the score going in.
 */
export function footballFacts(play: FootballScore, before: { readonly home: number; readonly away: number } | null, topIsHome: boolean): ScoringFacts {
  let top: number | null = null;
  let bottom: number | null = null;
  let value: number | null = null;
  if (play.homeScore != null && play.awayScore != null) {
    [top, bottom] = topIsHome ? [play.homeScore, play.awayScore] : [play.awayScore, play.homeScore];
    if (before) value = Math.max(play.homeScore - before.home, play.awayScore - before.away);
  }
  return { top, bottom, value, text: play.text, type: play.type, clock: play.clock, period: play.period };
}

/** The part of a soccer action the facts read (PitchAction). */
export interface SoccerScore {
  readonly topScore: number | null;
  readonly bottomScore: number | null;
  readonly minute: string;
  /** A goal's full commentary line and ESPN's type for it. */
  readonly account?: string | null;
  readonly playType?: string | null;
}

/** A soccer goal: the score after it, the commentary line and the minute. */
export function soccerFacts(action: SoccerScore): ScoringFacts {
  return { top: action.topScore, bottom: action.bottomScore, value: 1, text: action.account ?? null, type: action.playType ?? null, clock: action.minute };
}

/** An NBA play. */
export function nbaFacts(play: JSONValue, topIsHome: boolean): ScoringFacts {
  const home = intOf(at(play, "homeScore"));
  const away = intOf(at(play, "awayScore"));
  const scored = home != null && away != null;
  return {
    top: scored ? (topIsHome ? home : away) : null,
    bottom: scored ? (topIsHome ? away : home) : null,
    value: intOf(at(play, "scoreValue")),
    text: str(at(play, "text")) ?? null,
    clock: str(at(play, "clock", "displayValue")) ?? null,
    period: intOf(at(play, "period", "number")),
  };
}
