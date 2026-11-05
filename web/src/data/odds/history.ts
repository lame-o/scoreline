/**
 * A game's reported events on the same wall clock as market prices
 * (MatchHistory.swift). Game clocks label those events; they are never
 * stretched over a market chart. Breaks, overtime and added time therefore
 * keep their actual width. Times are epoch ms (the odds' axis); the Swift's
 * seconds are multiplied out where they appear.
 *
 * Plain data (`MatchHistory`) and functions on it, ported method by method:
 * `historyStart`/`historyEnd` (`start`, `end`), `timeOf` (`time(of:)`),
 * `shownUntil` (`shown(until:)`), `clippedPeriods` (`clipped`), `historyNow`
 * (`now`), `historyDomain` (`domain`), `parseHistory` (`parse`).
 */
import { overtime, ordinal } from "../format";
import type { EventState, Side, Sport } from "../models";
import { plain } from "../basketball";
import { at, b, i, s, type JSONValue } from "../profiles/read";
import { chronology, identity } from "./chronology";
import { minuteMark, oddsPeriodLabel, soccerLine, type OddsPeriod } from "./espn";

/** One reported event (MatchHistory.Event). */
export interface HistoryEvent {
  readonly id: string;
  readonly t: number;
  readonly period: number;
  readonly clock: string;
  readonly text: string;
  readonly side: Side | null;
  /** The team in `side` gave the ball away. */
  readonly turnover: boolean;
}

/**
 * How long a game usually runs, first play to last (ms), and how many
 * periods it's played in: what a live game's axis is sized for, so nothing on
 * it moves as the game goes on.
 */
export interface Pace {
  readonly game: number;
  readonly periods: number;
}

const MIN = 60_000;

export function paceOf(sport: Sport, path: string | null = null): Pace {
  switch (sport) {
    case "soccer":
      return { game: 113 * MIN, periods: 2 };
    case "baseball":
      return { game: 165 * MIN, periods: 9 };
    case "football":
      return path === "football/college-football" ? { game: 205 * MIN, periods: 4 } : { game: 185 * MIN, periods: 4 };
    case "basketball":
      if (path === "basketball/mens-college-basketball" || path === "basketball/womens-college-basketball") return { game: 125 * MIN, periods: 2 };
      if (path === "basketball/wnba") return { game: 125 * MIN, periods: 4 };
      return { game: 155 * MIN, periods: 4 };
    default:
      return { game: 155 * MIN, periods: 4 };
  }
}

export interface MatchHistory {
  readonly sport: Sport;
  readonly pace: Pace;
  readonly events: readonly HistoryEvent[];
  readonly periods: readonly OddsPeriod[];
}

export function emptyHistory(sport: Sport, path: string | null = null, events: readonly HistoryEvent[] = [], periods: readonly OddsPeriod[] = []): MatchHistory {
  return { sport, pace: paceOf(sport, path), events, periods };
}

/** A range of the wall clock (epoch ms), both ends included. */
export interface Domain {
  readonly from: number;
  readonly to: number;
}

/** Which stretch of the game the charts show: all of it, the last 10 minutes (live), or one period, zoomed by clicking its label (OddsWindow). */
export type OddsWindow = { readonly kind: "game" } | { readonly kind: "recent" } | { readonly kind: "period"; readonly number: number };

export const GAME: OddsWindow = { kind: "game" };
export const RECENT: OddsWindow = { kind: "recent" };
export const periodWindow = (number: number): OddsWindow => ({ kind: "period", number });
export const windowPeriod = (w: OddsWindow): number | null => (w.kind === "period" ? w.number : null);
export const sameWindow = (a: OddsWindow, b: OddsWindow): boolean => a.kind === b.kind && windowPeriod(a) === windowPeriod(b);

/** Only a live game has a last 10 minutes; before the game, no periods (OddsWindow.effective). */
export function effectiveWindow(w: OddsWindow, state: EventState): OddsWindow {
  if (state === "scheduled" || (w.kind === "recent" && state === "final")) return GAME;
  return w;
}

export const historyStart = (h: MatchHistory): number | null => h.periods[0]?.start ?? h.events[0]?.t ?? null;
export const historyEnd = (h: MatchHistory): number | null => h.periods.at(-1)?.end ?? h.events.at(-1)?.t ?? null;

/** A moment's play: an NBA run's moment ("…-run") is its last basket (Replays.play(of:)). */
export const playOf = (momentID: string): string => (momentID.endsWith("-run") ? momentID.slice(0, -4) : momentID);

/** When a play happened, by its ID. An NBA run's moment ("…-run") is its last basket. */
export function timeOf(h: MatchHistory, id: string): number | null {
  const play = playOf(id);
  return h.events.find((e) => e.id === play)?.t ?? null;
}

/**
 * Only knowledge already reached by the page's broadcast. Even period ends
 * are clipped: the duration of an upcoming half must not leak.
 */
export function shownUntil(h: MatchHistory, until: number | null): MatchHistory {
  if (until == null || !((historyEnd(h) ?? -Infinity) > until)) return h;
  return { ...h, events: h.events.filter((e) => e.t <= until), periods: clippedPeriods(h.periods, until) };
}

export function clippedPeriods(periods: readonly OddsPeriod[], until: number): OddsPeriod[] {
  return periods.filter((p) => p.start <= until).map((p) => ({ number: p.number, label: p.label, start: p.start, end: Math.min(p.end, until) }));
}

/**
 * Where a live game has got to: what the page has presented, or without a
 * broadcast the newest thing heard. The caller supplies the same newest
 * market timestamp to both modules; there is no hidden Date.now that could
 * move one a few pixels from the other.
 */
export function historyNow(h: MatchHistory, eventStart: number, latest: number | null = null, until: number | null = null): number {
  if (until != null) return until;
  const end = historyEnd(h);
  const known = [end, latest].filter((x): x is number => x != null);
  return known.length > 0 ? Math.max(...known) : eventStart;
}

/**
 * One domain for both modules, independent of market availability. A live
 * game's axis is the game's usual length from its first play, so marks stay
 * where they are and the game fills it from the left; past that it grows by a
 * quarter hour at a time. A final ends at its last play.
 */
export function historyDomain(h: MatchHistory, state: EventState, window: OddsWindow, eventStart: number, latest: number | null = null, until: number | null = null): Domain {
  const visible = shownUntil(h, until);
  const latestShown = latest != null ? (until != null ? Math.min(latest, until) : latest) : null;
  if (state === "scheduled") {
    const last = latestShown ?? until ?? eventStart;
    return { from: last - 86_400_000, to: last };
  }
  const first = historyStart(visible) ?? eventStart;
  const now = historyNow(visible, eventStart, latestShown, until);
  // During opening buffer warm-up p can precede the first recorded
  // play. Keep a valid, finite domain without exposing that future play.
  const lower = Math.min(first, now - 1000);
  const live = state === "live";
  const number = windowPeriod(window);
  if (number != null) {
    const index = visible.periods.findIndex((p) => p.number === number);
    if (index >= 0) {
      const period = visible.periods[index]!;
      if (!live || index !== visible.periods.length - 1) return { from: period.start, to: Math.max(period.end, period.start + 60_000) };
      return { from: period.start, to: axisEnd(period.start, now, h.pace.game / h.pace.periods) };
    }
  }
  if (!live) return { from: lower, to: Math.max(historyEnd(visible) ?? now, lower + 1000) };
  if (window.kind === "recent") return { from: Math.max(lower, now - 600_000), to: now };
  return { from: lower, to: axisEnd(lower, now, h.pace.game) };
}

function axisEnd(start: number, now: number, length: number): number {
  const end = start + length;
  if (!(now > end)) return end;
  return end + Math.ceil((now - end) / 900_000) * 900_000;
}

// MARK: - Parsing

/**
 * All currently supported ESPN sports. CS rounds and climbing attempts have
 * no comparable absolute event history in their current providers; those
 * views must not fabricate a market-aligned chronology. (pure; tested)
 */
export function parseHistory(summary: JSONValue, sport: Sport, topID: string | null, bottomID: string | null, path: string | null = null): MatchHistory {
  if (sport === "esports" || sport === "climbing") return emptyHistory(sport);
  const side = (id: string | null): Side | null => {
    if (id == null) return null;
    if (topID != null && id === topID) return "top";
    if (bottomID != null && id === bottomID) return "bottom";
    return null;
  };
  const placed = chronology(summary, sport);
  const events: HistoryEvent[] = [];
  for (const entry of placed) {
    const p = entry.json;
    const rawText = s(at(p, "text")) ?? s(at(p, "shortText")) ?? s(at(p, "type", "text")) ?? "";
    const text = (sport === "soccer" ? soccerLine(rawText) : sport === "basketball" ? plain(rawText) : rawText).split(/\s+/).filter(Boolean).join(" ");
    // Pitches retain their place in period bounds, without filling
    // the inspector with each pitch of the same baseball at-bat.
    if (text === "" || (sport === "baseball" && text.startsWith("Pitch "))) continue;
    // A turnover belongs to the team that had the ball at the snap.
    const turnover = sport === "football" && b(at(p, "isTurnover")) === true;
    events.push({
      id: identity(p, sport),
      t: entry.t,
      period: i(at(p, "period", "number")) ?? 1,
      clock: historyClock(p, sport, path),
      text,
      side: side(s(at(p, "team", "id")) ?? (turnover ? s(at(p, "start", "team", "id")) : null)),
      turnover,
    });
  }
  const periods: OddsPeriod[] = [];
  const indices = new Map<number, number>();
  for (const entry of placed) {
    const n = i(at(entry.json, "period", "number")) ?? 1;
    if (!(n > 0)) continue;
    const index = indices.get(n);
    if (index != null) {
      const old = periods[index]!;
      periods[index] = { number: n, label: old.label, start: old.start, end: entry.t };
    } else {
      indices.set(n, periods.length);
      periods.push({ number: n, label: historyPeriodLabel(n, sport, path), start: entry.t, end: entry.t });
    }
  }
  return { sport, pace: paceOf(sport, path), events, periods };
}

/** College basketball plays halves; everyone else is the odds chart's label (MatchHistory.periodLabel). */
export function historyPeriodLabel(n: number, sport: Sport, path: string | null): string {
  if (path === "basketball/mens-college-basketball") return n <= 2 ? `H${n}` : overtime(n - 2);
  return oddsPeriodLabel(n, sport);
}

/** "22'", "Bot 10th", "Q2 12:00" (MatchHistory.clock). */
export function historyClock(p: JSONValue, sport: Sport, path: string | null): string {
  const n = i(at(p, "period", "number"));
  const display = s(at(p, "clock", "displayValue")) ?? "";
  switch (sport) {
    case "soccer":
      return minuteMark(display) ?? display;
    case "baseball": {
      if (n == null) return "";
      const half = s(at(p, "period", "type"))?.toLowerCase();
      return half === "top" ? `Top ${ordinal(n)}` : half === "bottom" ? `Bot ${ordinal(n)}` : ordinal(n);
    }
    default:
      return [n != null ? historyPeriodLabel(n, sport, path) : "", display].filter((x) => x !== "").join(" ");
  }
}
