/**
 * ESPN's half of the odds chart (Odds.swift `OddsBaseline`), read from the
 * summary the game page already polls (no requests of its own):
 *
 * - ESPN's win probability as a line on the wall clock. `winprobability`
 *   lists entries by sequence number, not game order, so each is joined to
 *   its play by ID and placed at that play's time, in exactly the timeline's
 *   chronology (chronology.ts: commentary ordering, drive overlap, corrected
 *   wall timestamps), so a corrected stamp moves the model and the
 *   timeline's event by the same amount.
 * - The plays worth naming, for the readings' "last play" and game clock, and
 *   each period's span (the axis's labels and dividers).
 * - DraftKings' pregame moneyline with the vig removed: each side's implied
 *   chance (−ml/(−ml+100) for a favorite, 100/(ml+100) for an underdog),
 *   normalized to sum to 1. ESPN has no live DraftKings line, so it's the
 *   pregame reference ("where the books opened").
 * - Each team's names, for matching Polymarket's (polymarket.ts).
 */
import { isNotable, plain } from "../basketball";
import { ordinal, periodLabel } from "../format";
import { arr, at, num, str, type JSONValue } from "../json";
import type { Sport } from "../models";
import { i, s } from "../profiles/read";
import { chronology } from "./chronology";
import { lastAtOrBefore } from "./polymarket";

/** "67'" for a clock of "67'", "45+2'" for "45'+2'"; null for none (ScoringSlide.swift `SlideWords.minuteMark`; scoringSlide.ts has the same, with the slide's imports). */
export function minuteMark(clock: string | null): string | null {
  if (!clock) return null;
  const mark = clock.replaceAll("'+", "+");
  return mark.endsWith("'") || !/\d/.test(mark) ? mark : `${mark}'`;
}

/** ESPN's chance for the top team at a moment (and the draw's, soccer), placed on the wall clock (epoch ms). */
export interface WinPoint {
  readonly t: number;
  readonly top: number;
  readonly draw: number;
}

/** A play on the wall clock, for the readings: when, the game clock, what happened (Odds.swift `OddsPlay`). */
export interface PlayMark {
  readonly t: number;
  readonly period: number;
  /** "Q3 4:12", "Top 7th", "67'". */
  readonly clock: string;
  readonly text: string;
}

/** A period on the wall clock (its first play to its last), named for the axis ("Q1", "OT", "7", "2nd") (Odds.swift `OddsPeriod`). */
export interface OddsPeriod {
  readonly number: number;
  readonly label: string;
  readonly start: number;
  readonly end: number;
}

/** A pregame line, vig removed, for the top team, the bottom team and the draw (soccer). */
export interface Pregame {
  readonly provider: string;
  readonly top: number;
  readonly bottom: number;
  readonly draw: number | null;
}

export interface OddsBasis {
  readonly sport: Sport;
  /** ESPN's model through the game, in game order; empty where ESPN has none (soccer, NHL). */
  readonly win: readonly WinPoint[];
  /** The plays worth naming, in game order. */
  readonly plays: readonly PlayMark[];
  readonly periods: readonly OddsPeriod[];
  /** The first and last plays worth naming (tip-off, kickoff, the first at-bat; the last): the game's span. */
  readonly start: number | null;
  readonly end: number | null;
  readonly pregame: Pregame | null;
  /** Each side's names as ESPN writes them (shortDisplayName, name, displayName, location). */
  readonly names: { readonly top: readonly string[]; readonly bottom: readonly string[] };
}

export const EMPTY_BASIS: OddsBasis = { sport: "basketball", win: [], plays: [], periods: [], start: null, end: null, pregame: null, names: { top: [], bottom: [] } };

/** "before tip-off", per sport (OddsBaseline.pregame). */
export function pregameWords(sport: Sport): string {
  return sport === "basketball" ? "before tip-off" : sport === "baseball" ? "before the first pitch" : "before kickoff";
}

/** Under the axis: "Q1"…"OT" (basketball, football), "1"…"9", "10" (innings), "1st", "2nd", "ET", "Pens" (soccer halves) (OddsBaseline.periodLabel). */
export function oddsPeriodLabel(n: number, sport: Sport): string {
  switch (sport) {
    case "soccer":
      return ({ 1: "1st", 2: "2nd", 3: "ET", 4: "ET", 5: "Pens" } as Readonly<Record<number, string>>)[n] ?? "";
    case "baseball":
      return String(n);
    default:
      return periodLabel(n, sport);
  }
}

/** The game clock at a play: "Q3 4:12", "67'", "Top 7th" (OddsBaseline.clock). */
function clockOf(p: JSONValue, sport: Sport): string {
  const n = i(at(p, "period", "number"));
  const display = s(at(p, "clock", "displayValue")) ?? "";
  switch (sport) {
    case "soccer":
      return minuteMark(display) ?? "";
    case "baseball": {
      if (n == null) return "";
      const half = s(at(p, "period", "type"))?.toLowerCase();
      return half === "top" ? `Top ${ordinal(n)}` : half === "bottom" ? `Bot ${ordinal(n)}` : ordinal(n);
    }
    default:
      if (n == null) return display;
      return [periodLabel(n, sport), display].filter((x) => x !== "").join(" ");
  }
}

/**
 * ESPN's commentary, short (Odds.swift `soccerLine`): a goal as a scoreboard
 * says it ("Goal! Ollie Watkins (Aston Villa), 2–1"); otherwise the first
 * sentence, and the second up to its "(Team)" when the first is just the kind
 * of moment ("Attempt missed. Rayan (Bournemouth)").
 */
export function soccerLine(raw: string): string {
  const text = raw.split(/\s+/).filter(Boolean).join(" ");
  const goal = /^Goal! .+? (\d+), .+? (\d+)\. (.+?\))/.exec(text);
  if (goal) return `Goal! ${goal[3]}, ${goal[1]}–${goal[2]}`;
  const parts = text.split(". ");
  if (parts.length <= 1) return text;
  const close = parts[1]!.indexOf(")");
  if (parts[0]!.length < 45 && close >= 0) return `${parts[0]}. ${parts[1]!.slice(0, close + 1)}`;
  return text.length <= 80 ? text : `${parts[0]}.`;
}

/** What happened, in a line the readout can hold (OddsBaseline.text). */
function playText(p: JSONValue, sport: Sport): string {
  const raw = s(at(p, "text")) ?? "";
  switch (sport) {
    case "basketball":
      return plain(raw).replaceAll("-foot ", "-ft ");
    // Baseball: the at-bat's result, not each pitch ("Pitch 4 : Strike 3 Swinging").
    case "baseball":
      return raw.startsWith("Pitch ") ? "" : raw;
    // Soccer: who and what, not the shot's whole path.
    case "soccer":
      return soccerLine(raw);
    default:
      return raw.split(/\s+/).filter(Boolean).join(" ");
  }
}

/**
 * Implied chance from an American moneyline: −155 → 155/255 (a favorite),
 * +130 → 100/230 (an underdog). Null for nonsense.
 */
export function impliedChance(moneyline: number | null | undefined): number | null {
  if (moneyline == null || !Number.isFinite(moneyline) || Math.abs(moneyline) < 100) return null;
  return moneyline < 0 ? -moneyline / (-moneyline + 100) : 100 / (moneyline + 100);
}

/** The outcomes' implied chances normalized to sum to 1: the vig removed. Null when any is missing. */
export function devig(chances: readonly (number | null)[]): number[] | null {
  if (chances.some((c) => c == null)) return null;
  const sum = (chances as number[]).reduce((a, b) => a + b, 0);
  return sum > 0 ? (chances as number[]).map((c) => c / sum) : null;
}

/** DraftKings' pregame line from `pickcenter`, for the top team (ESPN lists home and away). */
export function draftKings(summary: JSONValue, topIsHome: boolean): Pregame | null {
  // DraftKings is provider 100 (ESPN spells it "Draft Kings" and "DraftKings").
  const entry = arr(at(summary, "pickcenter")).find((p) => str(at(p, "provider", "id")) === "100" || /draft\s*kings/i.test(str(at(p, "provider", "name")) ?? ""));
  if (!entry) return null;
  const home = impliedChance(num(at(entry, "homeTeamOdds", "moneyLine")));
  const away = impliedChance(num(at(entry, "awayTeamOdds", "moneyLine")));
  const drawLine = num(at(entry, "drawOdds", "moneyLine"));
  const draw = drawLine != null ? impliedChance(drawLine) : null;
  const fair = devig(draw != null ? [home, away, draw] : [home, away]);
  if (!fair) return null;
  const [h, a, d] = fair as [number, number, number | undefined];
  return { provider: "DraftKings", top: topIsHome ? h : a, bottom: topIsHome ? a : h, draw: d ?? null };
}

/** Each side's names from the summary's header, for matching (polymarket.ts `GameKey`). */
function teamNames(summary: JSONValue, topIsHome: boolean): OddsBasis["names"] {
  const competitors = arr(at(summary, "header", "competitions", 0, "competitors"));
  const names = (homeAway: string) => {
    const team = at(
      competitors.find((c) => str(at(c, "homeAway")) === homeAway),
      "team",
    );
    return ["shortDisplayName", "name", "displayName", "location"].flatMap((k) => str(at(team, k)) ?? []).filter((n, i, all) => n && all.indexOf(n) === i);
  };
  return topIsHome ? { top: names("home"), bottom: names("away") } : { top: names("away"), bottom: names("home") };
}

/** The odds chart's ESPN half, from the summary (OddsBaseline.parse). (pure; tested) */
export function parseOddsBasis(summary: JSONValue, sport: Sport, topIsHome: boolean): OddsBasis {
  // Exactly the same chronology as the event timeline, including
  // commentary ordering, drive overlap and corrected wall timestamps.
  const placed: { id: string | null; play: PlayMark }[] = [];
  for (const entry of chronology(summary, sport)) {
    const p = entry.json;
    const period = i(at(p, "period", "number")) ?? 1;
    // The readings name plays worth naming: the NBA's shots, fouls, turnovers and scores, not substitutions or timeouts.
    const notable = sport !== "basketball" || isNotable(i(at(p, "type", "id")), i(at(p, "scoreValue")));
    const text = notable ? playText(p, sport) : "";
    placed.push({ id: s(at(p, "id")), play: { t: entry.t, period, clock: clockOf(p, sport), text } });
  }
  const plays = placed.filter((x) => x.play.text !== "").map((x) => x.play);

  // ESPN's model: per play, joined by ID, home's chance turned to the top team's (the draw's apart, soccer).
  const home = new Map<string, { home: number; tie: number }>();
  for (const w of arr(at(summary, "winprobability"))) {
    const id = s(at(w, "playId"));
    const h = num(at(w, "homeWinPercentage"));
    if (id != null && h != null) home.set(id, { home: h, tie: num(at(w, "tiePercentage")) ?? 0 });
  }
  const win: WinPoint[] = [];
  if (home.size > 0) {
    for (const item of placed) {
      const h = item.id != null ? home.get(item.id) : undefined;
      if (!h) continue;
      win.push({ t: item.play.t, top: topIsHome ? h.home : Math.max(1 - h.home - h.tie, 0), draw: h.tie });
    }
  }

  // Periods: each one's first play to its last, in order.
  const periods: OddsPeriod[] = [];
  for (const { play } of placed) {
    const last = periods.at(-1);
    if (last && last.number === play.period) periods[periods.length - 1] = { ...last, end: play.t };
    else if (!periods.some((x) => x.number === play.period)) periods.push({ number: play.period, label: oddsPeriodLabel(play.period, sport), start: play.t, end: play.t });
  }

  return {
    sport,
    win,
    plays,
    periods,
    start: plays[0]?.t ?? null,
    end: plays.at(-1)?.t ?? null,
    pregame: draftKings(summary, topIsHome),
    names: teamNames(summary, topIsHome),
  };
}

/** The last play worth naming at or before a moment (OddsBaseline.play(atOrBefore:)). */
export function playAtOrBefore(basis: Pick<OddsBasis, "plays">, t: number): PlayMark | null {
  return lastAtOrBefore(basis.plays, t, (p) => p.t);
}
