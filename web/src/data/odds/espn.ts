/**
 * ESPN's half of the odds chart (ODDS-SPEC.md, "ESPN"), read from the summary
 * the game page already polls (no requests of its own):
 *
 * - ESPN's win probability as a line on the wall clock. `winprobability`
 *   lists entries by sequence number, not game order, so each is joined to
 *   its play by ID and placed at that play's `wallclock` (summary plays carry
 *   one; football's sit inside drives; a play without one takes the last
 *   one before it, so time never runs backwards).
 * - The plays, for the scrub's "nearest play" and its game clock, and where
 *   each period starts (the x axis's labels and dividers).
 * - DraftKings' pregame moneyline with the vig removed: each side's implied
 *   chance (−ml/(−ml+100) for a favorite, 100/(ml+100) for an underdog),
 *   normalized to sum to 1. ESPN has no live DraftKings line, so it's the
 *   pregame reference ("where the books opened"), drawn as a diamond.
 * - Each team's names, for matching Polymarket's (polymarket.ts).
 */
import { isNotable, plain } from "../basketball";
import { arr, at, num, str, type JSONValue } from "../json";
import type { Sport } from "../models";

/** ESPN's chance for the top team at a moment (and the draw's, soccer), placed on the wall clock (epoch ms). */
export interface WinPoint {
  readonly t: number;
  readonly top: number;
  readonly draw: number;
}

/** A play on the wall clock: what the scrub names. */
export interface PlayMark {
  readonly t: number;
  /** "Q3 4:12", "Top 7th", "67'". */
  readonly clock: string;
  readonly text: string;
}

/** A period on the wall clock (its first play to its last), and its label under the plot ("Q1", "OT", "7", "2nd"). */
export interface PeriodMark {
  readonly t: number;
  readonly end: number;
  readonly period: number;
  readonly label: string;
}

/** A pregame line, vig removed, for the top team, the bottom team and the draw (soccer). */
export interface Pregame {
  readonly provider: string;
  readonly top: number;
  readonly bottom: number;
  readonly draw: number | null;
}

export interface OddsBasis {
  /** ESPN's model through the game, in game order; empty where ESPN has none (soccer, NHL). */
  readonly win: readonly WinPoint[];
  readonly plays: readonly PlayMark[];
  readonly periods: readonly PeriodMark[];
  /** The first and last plays' wall clock: the game's span. */
  readonly start: number | null;
  readonly end: number | null;
  readonly pregame: Pregame | null;
  /** Each side's names as ESPN writes them (shortDisplayName, name, displayName, location). */
  readonly names: { readonly top: readonly string[]; readonly bottom: readonly string[] };
}

export const EMPTY_BASIS: OddsBasis = { win: [], plays: [], periods: [], start: null, end: null, pregame: null, names: { top: [], bottom: [] } };

interface RawPlay {
  readonly id: string | null;
  readonly t: number | null;
  readonly period: number;
  readonly clock: string;
  readonly text: string;
  /** Worth naming in the scrub (baseball: the result of an at-bat, not each pitch). */
  readonly named: boolean;
}

const wall = (v: JSONValue): number | null => {
  const s = str(v);
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? null : t;
};

const ordinalOf = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

/** "67'" for a clock of "67'", "45+2'" for "45'+2'" (ScoringSlide.swift `SlideWords.minuteMark`). */
function minuteMark(clock: string): string {
  if (!clock) return "";
  const mark = clock.replaceAll("'+", "+");
  return mark.endsWith("'") || !/\d/.test(mark) ? mark : `${mark}'`;
}

/** A play's game clock as the scrub says it. */
function clockLabel(sport: Sport, play: JSONValue, period: number): string {
  const clock = str(at(play, "clock", "displayValue")) ?? "";
  switch (sport) {
    case "baseball": {
      const half = str(at(play, "period", "type"))?.toLowerCase();
      return half === "top" ? `Top ${ordinalOf(period)}` : half === "bottom" ? `Bot ${ordinalOf(period)}` : ordinalOf(period);
    }
    case "soccer":
      return minuteMark(clock);
    default: {
      const name = period <= 4 ? `Q${period}` : period === 5 ? "OT" : `${period - 4}OT`;
      return clock ? `${name} ${clock}` : name;
    }
  }
}

/** A period's label under the plot. */
export function periodName(sport: Sport, period: number): string {
  switch (sport) {
    case "baseball":
      return String(period);
    case "soccer":
      return period === 1 ? "1st" : period === 2 ? "2nd" : period <= 4 ? "ET" : "Pens";
    default:
      return period <= 4 ? `Q${period}` : period === 5 ? "OT" : `${period - 4}OT`;
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

/** What happened, in a line the tooltip can hold; empty for a play not worth naming. */
function playText(sport: Sport, p: JSONValue, raw: string): string {
  switch (sport) {
    // The NBA's shots, fouls, turnovers and scores, not substitutions, timeouts or rebounds.
    case "basketball":
      return isNotable(num(at(p, "type", "id")) ?? null, num(at(p, "scoreValue")) ?? null) ? plain(raw).replaceAll("-foot ", "-ft ") : "";
    // The at-bat's result, not each pitch ("Pitch 4 : Strike 3 Swinging").
    case "baseball":
      return raw.startsWith("Pitch ") || str(at(p, "type", "type")) === "start-batterpitcher" ? "" : raw;
    case "soccer":
      return soccerLine(raw);
    default:
      return raw.split(/\s+/).filter(Boolean).join(" ");
  }
}

/** The summary's plays in game order, wherever the sport keeps them. */
function rawPlays(summary: JSONValue, sport: Sport): RawPlay[] {
  const read = (p: JSONValue, text?: string): RawPlay => {
    const period = num(at(p, "period", "number")) ?? 0;
    const said = playText(sport, p, text ?? str(at(p, "text")) ?? "");
    return { id: str(at(p, "id")) ?? null, t: wall(at(p, "wallclock")), period, clock: clockLabel(sport, p, period), text: said, named: said !== "" };
  };
  switch (sport) {
    case "football": {
      const drives = [...arr(at(summary, "drives", "previous")), at(summary, "drives", "current")];
      const seen = new Set<string>();
      return drives.flatMap((d) => arr(at(d, "plays"))).flatMap((p) => {
        const play = read(p);
        // The current drive repeats the last of the previous ones while it's being written.
        if (play.id && seen.has(play.id)) return [];
        if (play.id) seen.add(play.id);
        return [play];
      });
    }
    case "soccer":
      return arr(at(summary, "commentary")).flatMap((c) => {
        const play = at(c, "play");
        return play != null && typeof play === "object" ? [read(play, str(at(c, "text")))] : [];
      });
    default:
      return arr(at(summary, "plays")).map((p) => read(p));
  }
}

/** Times carried forward, so a play without a wall clock sits with the one before it and time never runs backwards. */
function placed(plays: readonly RawPlay[]): (RawPlay & { readonly at: number | null })[] {
  let last: number | null = null;
  return plays.map((p) => {
    if (p.t != null && (last == null || p.t >= last)) last = p.t;
    return { ...p, at: last };
  });
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

/** The odds chart's ESPN half, from the summary. */
export function parseOddsBasis(summary: JSONValue, sport: Sport, topIsHome: boolean): OddsBasis {
  const plays = placed(rawPlays(summary, sport));
  const index = new Map<string, number>();
  plays.forEach((p, i) => {
    if (p.id) index.set(p.id, i);
  });

  // ESPN's model, joined to its plays and put in game order.
  const joined: { i: number; t: number; top: number; draw: number }[] = [];
  for (const w of arr(at(summary, "winprobability"))) {
    const id = str(at(w, "playId"));
    const home = num(at(w, "homeWinPercentage"));
    const i = id != null ? index.get(id) : undefined;
    if (home == null || i == null) continue;
    const t = plays[i]!.at;
    if (t == null) continue;
    const tie = num(at(w, "tiePercentage")) ?? 0;
    joined.push({ i, t, top: topIsHome ? home : Math.max(1 - home - tie, 0), draw: tie });
  }
  joined.sort((a, b) => a.i - b.i);

  // Periods: each one's first play to its last, in order.
  const periods: PeriodMark[] = [];
  for (const p of plays) {
    if (p.at == null || p.period <= 0) continue;
    const last = periods.at(-1);
    if (last && last.period === p.period) periods[periods.length - 1] = { ...last, end: p.at };
    else if (!periods.some((x) => x.period === p.period)) periods.push({ t: p.at, end: p.at, period: p.period, label: periodName(sport, p.period) });
  }

  const timed = plays.filter((p) => p.at != null);
  return {
    win: joined.map(({ t, top, draw }) => ({ t, top, draw })),
    plays: timed.filter((p) => p.named).map((p) => ({ t: p.at!, clock: p.clock, text: p.text })),
    periods,
    start: timed[0]?.at ?? null,
    end: timed.at(-1)?.at ?? null,
    pregame: draftKings(summary, topIsHome),
    names: teamNames(summary, topIsHome),
  };
}

/**
 * The play nearest a moment, within `reach` ms (2½ minutes), and never across
 * a break: a moment between one period's last play and the next one's first
 * (half-time) names nothing.
 */
export function nearestPlay(plays: readonly PlayMark[], t: number, reach = 150_000, periods: readonly PeriodMark[] = []): PlayMark | null {
  for (let i = 1; i < periods.length; i++) if (t > periods[i - 1]!.end && t < periods[i]!.t) return null;
  let lo = 0;
  let hi = plays.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (plays[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  const after = plays[lo];
  const before = plays[lo - 1];
  const best = !before ? after : !after ? before : t - before.t <= after.t - t ? before : after;
  return best && Math.abs(best.t - t) <= reach ? best : null;
}

/** The game clock at a moment: the last play at or before it. */
export function clockAt(plays: readonly PlayMark[], t: number): string | null {
  let found: PlayMark | null = null;
  for (const p of plays) {
    if (p.t > t) break;
    found = p;
  }
  return found?.clock ?? null;
}
