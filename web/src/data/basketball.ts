/**
 * The NBA (and WNBA) page's data (Basketball.swift `NBADetail`,
 * `GameDetail.Basketball`; BasketballReplay.swift `CourtScene`; parts of
 * BasketballViews.swift and BasketballCelebrations.swift that are pure): the
 * shot chart, game flow, leaders, box score and injury report, parsed from
 * ESPN's game summary and kept current by the live lane
 * (data/liveFeeds/basketball.ts), plus the court's scene at a moment of a
 * replay, each shot's story, and the small rules the views share.
 *
 * Pure: no React, no DOM. "Top"/"bottom" follow the event's competitor
 * order (away first). ESPN lists plays in game order; sequence numbers
 * aren't (late and corrected plays get higher ones but sit where they
 * happened), so array order is game order everywhere here.
 *
 * The WNBA reads the same feed with 10-minute quarters (`QUARTER.wnba`); the
 * Mac app's NBA page is NBA-only, so that's the web's extension.
 */
import { periodLabel, overtime } from "./format";
import { arr, at, bool, num, str, type JSONValue } from "./json";
import type { Side } from "./models";
import type { Accent, LiveMoment } from "./moments";
import type { DetailMoment, SideOf } from "./gameDetail";
import { NEUTRAL, teamPalette, type Scheme, type TeamPalette } from "./teamColors";

// MARK: - Model

export const NBA_PATH = "basketball/nba";
export const WNBA_PATH = "basketball/wnba";

/** Seconds in a quarter: 12 minutes in the NBA, 10 in the WNBA (overtime is five minutes in both). */
export const QUARTER = { nba: 720, wnba: 600 } as const;
export const OVERTIME = 300;

export function quarterLength(path: string): number {
  return path === WNBA_PATH ? QUARTER.wnba : QUARTER.nba;
}

/**
 * A field-goal attempt in ESPN's half-court feet: x 0…50 across the court
 * (rim at 25), y out from the backboard (rim ≈ 1, baseline −4). Every shot
 * is measured toward the shooter's own basket.
 */
export interface Shot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly made: boolean;
  /** 2 or 3 (free throws have no position, so they aren't shots here). */
  readonly value: number;
  readonly side: Side | null;
  /** ESPN athlete ID of the shooter. */
  readonly player: string | null;
  readonly period: number | null;
  readonly clock: string;
  readonly text: string;
  /** Game seconds elapsed, for the game flow. */
  readonly elapsed: number | null;
  /** ESPN's play type (a dunk, a layup; 91 is a live placeholder that's refined later). */
  readonly typeID: number | null;
  /** Who blocked it (a miss with a second participant). */
  readonly blocker: string | null;
}

export interface FlowPoint {
  readonly id: string;
  readonly elapsed: number;
  readonly top: number;
  readonly bottom: number;
  readonly period: number;
  readonly clock: string;
  /** Who scored to make it this score. */
  readonly scorer: Side | null;
}

export const margin = (p: { top: number; bottom: number }) => p.top - p.bottom;

export interface Leader {
  readonly name: string;
  readonly value: string;
  readonly headshot: string | null;
  readonly player: string | null;
  /** The line behind the number ("9/16 FG"), when ESPN gives one. */
  readonly detail: string | null;
}

/** One category (points, rebounds, assists): each team's leader. */
export interface LeaderLine {
  readonly category: string;
  readonly top: Leader | null;
  readonly bottom: Leader | null;
}

export interface BoxPlayer {
  readonly id: string;
  readonly name: string;
  readonly starter: boolean;
  /** On the floor right now (live). */
  readonly onCourt: boolean;
  /**
   * ESPN's full line, keyed by its labels: MIN, PTS, FG, 3PT, FT, REB, AST,
   * TO, STL, BLK, OREB, DREB, PF, +/-. Wider layouts read more columns.
   */
  readonly stats: Readonly<Record<string, string>>;
  /** Why they haven't played ("Coach's decision", "Right calf"), if they haven't. Live, it also means "not in yet". */
  readonly didNotPlay: string | null;
}

export const played = (p: BoxPlayer) => p.didNotPlay == null;
export const points = (p: BoxPlayer) => Number(p.stats.PTS ?? "") || 0;

export interface Injury {
  readonly id: string;
  readonly name: string;
  /** "Out", "Day-to-day", "Out for season". */
  readonly status: string;
  /** "Left ankle sprain". */
  readonly detail: string | null;
  readonly side: Side | null;
  /** ESPN's estimated return (epoch ms, local midnight), when there is one. */
  readonly returnDate: number | null;
}

export type CourtKind =
  /** A field-goal attempt (2 or 3, by `pointsAttempted`). */
  | { readonly kind: "shot"; readonly made: boolean; readonly value: number }
  /** `last`: the trip's last free throw. A technical stands alone. */
  | { readonly kind: "freeThrow"; readonly made: boolean; readonly last: boolean; readonly technical: boolean }
  | { readonly kind: "rebound"; readonly offensive: boolean }
  /** `steal`: a defender took it (the second participant). */
  | { readonly kind: "turnover"; readonly steal: boolean }
  | { readonly kind: "foul"; readonly offensive: boolean }
  | { readonly kind: "jumpBall" }
  | { readonly kind: "periodEnd" };

/**
 * A play as the court and the replay use it: what happened, who did it,
 * where, and the score after it. Substitutions, timeouts and reviews move
 * nothing on the court, so they aren't kept.
 */
export interface CourtPlay {
  readonly id: string;
  readonly kind: CourtKind;
  /** The team that did it: the shooter's, rebounder's, the team that lost the ball, the fouling team, the team that won the jump ball. */
  readonly side: Side | null;
  /** Who did it: shooter, rebounder, the player who lost the ball, the fouler. */
  readonly player: string | null;
  /** The assister, blocker or stealer. */
  readonly other: string | null;
  /** ESPN's spot in half-court feet, measured toward the attacking team's basket; null when ESPN has none. */
  readonly x: number | null;
  readonly y: number | null;
  readonly period: number | null;
  readonly clock: string;
  /** Game seconds elapsed. */
  readonly elapsed: number | null;
  readonly text: string;
  /** The score after the play. */
  readonly top: number;
  readonly bottom: number;
  /** ESPN's play type, for the shot's story (a dunk slams, a jumper swishes). */
  readonly typeID: number | null;
}

/** The NBA page's parts of a game summary (GameDetail.Basketball). */
export interface Basketball {
  readonly shots: readonly Shot[];
  /** The score after every scoring play, from tip-off. */
  readonly flow: readonly FlowPoint[];
  readonly leaders: readonly LeaderLine[];
  /** Before tip-off ESPN's leaders are season averages (PPG), not this game's. */
  readonly seasonLeaders: boolean;
  readonly topBox: readonly BoxPlayer[];
  readonly bottomBox: readonly BoxPlayer[];
  /** Each team's totals line, keyed like a player's (no MIN or +/-). */
  readonly topTotals: Readonly<Record<string, string>>;
  readonly bottomTotals: Readonly<Record<string, string>>;
  readonly injuries: readonly Injury[];
  /** Every play the court and the replay use, in game order. */
  readonly plays: readonly CourtPlay[];
  /** Seconds in a quarter (overtime is five minutes). */
  readonly quarterLength: number;
  /** The summary's newest play's game time: the live lane adds only what's after it. */
  readonly newestElapsed: number | null;
}

/** Box score lines by athlete ID, both teams. */
export function boxPlayers(b: Basketball): ReadonlyMap<string, BoxPlayer> {
  const map = new Map<string, BoxPlayer>();
  for (const p of [...b.topBox, ...b.bottomBox]) if (!map.has(p.id)) map.set(p.id, p);
  return map;
}

/** Leaders' names by athlete ID, for players the box score doesn't list. */
export function leaderNames(b: Basketball): Readonly<Record<string, string>> {
  const names: Record<string, string> = {};
  for (const line of b.leaders) for (const l of [line.top, line.bottom]) if (l?.player) names[l.player] = l.name;
  return names;
}

export const opponent = (side: Side): Side => (side === "top" ? "bottom" : "top");

// MARK: - Reading JSON (Swift's lenient `int`, which takes numeric strings)

function intOf(value: JSONValue): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

const typeID = (play: JSONValue) => intOf(at(play, "type", "id"));
const periodOf = (play: JSONValue) => intOf(at(play, "period", "number"));
const clockOf = (play: JSONValue) => str(at(play, "clock", "displayValue")) ?? "";

// MARK: - Parse

/** The page's NBA parts from a game summary. `side` maps an ESPN team ID to top/bottom (NBADetail.parse). */
export function parseBasketball(summary: JSONValue, side: SideOf, topIsHome: boolean, quarter: number = QUARTER.nba): Basketball {
  const plays = arr(at(summary, "plays"));
  const leaderTeams = arr(at(summary, "leaders"));
  let topBox: BoxPlayer[] = [];
  let bottomBox: BoxPlayer[] = [];
  let topTotals: Record<string, string> = {};
  let bottomTotals: Record<string, string> = {};
  for (const team of arr(at(summary, "boxscore", "players"))) {
    const players = box(team);
    const totals = boxTotals(team);
    const s = side(str(at(team, "team", "id")));
    if (s === "top") [topBox, topTotals] = [players, totals];
    else if (s === "bottom") [bottomBox, bottomTotals] = [players, totals];
  }
  const last = plays.at(-1);
  const lastPeriod = last != null ? periodOf(last) : null;
  return {
    shots: plays.flatMap((p) => shot(p, side, quarter) ?? []),
    flow: flow(plays, topIsHome, quarter),
    plays: courtPlays(plays, side, topIsHome, quarter),
    leaders: leaders(leaderTeams, side),
    seasonLeaders: leaderTeams.some((t) => arr(at(t, "leaders")).some((c) => (str(at(c, "name")) ?? "").endsWith("PerGame"))),
    topBox,
    bottomBox,
    topTotals,
    bottomTotals,
    injuries: arr(at(summary, "injuries")).flatMap((team) => arr(at(team, "injuries")).flatMap((i) => injury(i, side(str(at(team, "team", "id")))) ?? [])),
    quarterLength: quarter,
    newestElapsed: lastPeriod != null ? elapsed(lastPeriod, clockOf(last), quarter) : null,
  };
}

// MARK: - Time

/** "4:12" or, under a minute, "33.8" → seconds left in the period. */
export function seconds(clock: string): number | null {
  const parts = clock.split(":");
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    return parts[0] !== "" && parts[1] !== "" && Number.isFinite(m) && Number.isFinite(s) ? m * 60 + s : null;
  }
  const n = Number(clock);
  return clock.trim() !== "" && Number.isFinite(n) ? n : null;
}

/** Game seconds elapsed at a period and clock (overtime periods are five minutes). */
export function elapsed(period: number, clock: string, quarter: number = QUARTER.nba): number | null {
  const left = seconds(clock);
  if (period < 1 || left == null) return null;
  if (period <= 4) return (period - 1) * quarter + (quarter - left);
  return 4 * quarter + (period - 5) * OVERTIME + (OVERTIME - left);
}

/** Game seconds at the start of a period. */
export function periodStart(period: number, quarter: number = QUARTER.nba): number {
  return period <= 4 ? (period - 1) * quarter : 4 * quarter + (period - 5) * OVERTIME;
}

/** "Q2", "OT", "2OT" (`Period.label`, the one rule for every surface). */
export const periodName = (period: number) => periodLabel(period, "basketball");

/** "Q2 4:12", "OT 0:31". */
export function clockLabel(period: number | null, clock: string): string {
  if (period == null) return clock;
  return [periodName(period), clock].filter((s) => s.length > 0).join(" ");
}

/** A game second as the clock showed it: "Q3 4:12", "OT 0:31". At a boundary it's the end of the period before. */
export function clockLabelAt(t: number, quarter: number = QUARTER.nba): string {
  const time = Math.max(t, 0);
  let period = 1;
  while (periodStart(period + 1, quarter) < time && period < 14) period += 1;
  const length = period <= 4 ? quarter : OVERTIME;
  const left = Math.ceil(Math.max(0, periodStart(period, quarter) + length - time) - 1e-9);
  return clockLabel(period, `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`);
}

/**
 * A stretch of game time as the clock showed it: "Q3 6:40–3:15", or
 * "Q2 1:10–Q3 10:30" across a break.
 */
export function spanLabel(span: readonly [number, number], quarter: number = QUARTER.nba): string {
  const from = clockLabelAt(span[0], quarter);
  const to = clockLabelAt(span[1], quarter);
  const a = from.split(" ");
  const b = to.split(" ");
  if (a.length === 2 && b.length === 2 && a[0] === b[0]) return `${from}–${b[1]}`;
  return `${from}–${to}`;
}

/** Regulation, plus any overtime the plays, shots or clock reach. */
export function periodsPlayed(lastPeriod: number | null, now: number | null, quarter: number = QUARTER.nba): number {
  let byClock = 1;
  if (now != null) for (let p = 1; p <= 14; p++) if (periodStart(p, quarter) < now) byClock = p;
  return Math.max(4, lastPeriod ?? 1, byClock);
}

// MARK: - Shots

/** Free throws: types 97–106 (text as a fallback, for placeholders). */
export function isFreeThrow(play: JSONValue): boolean {
  const type = typeID(play);
  if (type != null && type >= 97 && type <= 106) return true;
  return (str(at(play, "text")) ?? "").toLowerCase().includes("free throw");
}

/** No position comes as a huge negative sentinel. */
const position = (value: JSONValue) => {
  const n = num(value);
  return n != null && n > -1000 ? n : null;
};

export function shot(play: JSONValue, side: SideOf, quarter: number = QUARTER.nba): Shot | null {
  if (bool(at(play, "shootingPlay")) !== true) return null;
  const x = position(at(play, "coordinate", "x"));
  const y = position(at(play, "coordinate", "y"));
  const id = str(at(play, "id"));
  if (x == null || y == null || !id || isFreeThrow(play)) return null;
  const made = bool(at(play, "scoringPlay")) === true;
  // The shooter comes first, blocked shots included ("A blocks B's jumper": B, then A).
  const people = participants(play);
  const period = periodOf(play);
  const clock = clockOf(play);
  return {
    id,
    x,
    y,
    made,
    value: shotValue(play, x, y),
    side: side(str(at(play, "team", "id"))),
    player: people[0] ?? null,
    period,
    clock,
    text: str(at(play, "text")) ?? "",
    elapsed: period != null ? elapsed(period, clock, quarter) : null,
    typeID: typeID(play),
    blocker: !made && people.length > 1 ? people[1]! : null,
  };
}

/** Dunks of every kind (alley-oop, putback, tip, reverse, driving…). */
export const DUNK_TYPES: ReadonlySet<number> = new Set([96, 115, 116, 117, 118, 138, 149, 150, 151, 152, 153]);

export const isDunk = (s: { typeID: number | null }) => s.typeID != null && DUNK_TYPES.has(s.typeID);

export function participants(play: JSONValue): string[] {
  return arr(at(play, "participants")).flatMap((p) => str(at(p, "athlete", "id")) ?? []);
}

/** Beyond the arc: 23.75 ft from the rim, or 22 ft along the corners. */
export function isThree(x: number, y: number): boolean {
  if (y <= 10 && Math.abs(x - 25) >= 21.8) return true;
  return Math.hypot(x - 25, y - 1) >= 23.6;
}

/** 2 or 3: `pointsAttempted` (it says so on misses too); geometry only as a fallback. */
export function shotValue(play: JSONValue, x: number, y: number): number {
  const attempted = intOf(at(play, "pointsAttempted"));
  if (attempted != null && attempted >= 2) return attempted;
  const points = intOf(at(play, "scoreValue"));
  if (bool(at(play, "scoringPlay")) === true && points != null && points >= 2) return points;
  return (str(at(play, "text")) ?? "").toLowerCase().includes("three point") || isThree(x, y) ? 3 : 2;
}

// MARK: - Flow and key moments

export function flow(plays: readonly JSONValue[], topIsHome: boolean, quarter: number = QUARTER.nba): FlowPoint[] {
  const points: FlowPoint[] = [{ id: "tip", elapsed: 0, top: 0, bottom: 0, period: 1, clock: quarter === QUARTER.wnba ? "10:00" : "12:00", scorer: null }];
  for (const play of plays) {
    if (bool(at(play, "scoringPlay")) !== true) continue;
    const point = flowPoint(play, points.at(-1) ?? null, topIsHome, quarter);
    if (point) points.push(point);
  }
  return points;
}

/** A scoring play as a point on the game flow (null if the score didn't change). */
export function flowPoint(play: JSONValue, last: FlowPoint | null, topIsHome: boolean, quarter: number = QUARTER.nba): FlowPoint | null {
  const home = intOf(at(play, "homeScore"));
  const away = intOf(at(play, "awayScore"));
  const period = periodOf(play);
  if (home == null || away == null || period == null) return null;
  const clock = clockOf(play);
  const t = elapsed(period, clock, quarter);
  if (t == null) return null;
  const [top, bottom] = topIsHome ? [home, away] : [away, home];
  if (last && last.top === top && last.bottom === bottom) return null;
  const scorer: Side | null = last ? (top > last.top ? "top" : bottom > last.bottom ? "bottom" : null) : null;
  return { id: str(at(play, "id")) ?? String(t), elapsed: Math.max(t, last?.elapsed ?? 0), top, bottom, period, clock, scorer };
}

/** An "End Period" or "End Game" entry. */
export function periodEnd(play: JSONValue): { period: number; final: boolean } | null {
  const type = str(at(play, "type", "id")) ?? (intOf(at(play, "type", "id")) != null ? String(intOf(at(play, "type", "id"))) : null);
  const label = (str(at(play, "type", "text")) ?? "").toLowerCase();
  const final = type === "402" || label === "end game";
  const period = periodOf(play);
  if (!(final || type === "412" || label === "end period") || period == null) return null;
  return { period, final };
}

function scoreOf(play: JSONValue, topIsHome: boolean): { top: number; bottom: number } {
  const home = intOf(at(play, "homeScore")) ?? 0;
  const away = intOf(at(play, "awayScore")) ?? 0;
  return topIsHome ? { top: home, bottom: away } : { top: away, bottom: home };
}

/**
 * The game's story for the key-plays list: every run of 8+ unanswered
 * points, lead changes in the fourth quarter and overtime, and the score at
 * the end of each period. Oldest first (NBADetail.keyMoments).
 */
export function keyMoments(summary: JSONValue, side: SideOf, topIsHome: boolean): DetailMoment[] {
  void side;
  const plays = arr(at(summary, "plays"));
  const moments: DetailMoment[] = [];
  let top = 0;
  let bottom = 0;
  /** The team ahead most recently (a tie doesn't end a lead; the other team going ahead does). */
  let leader: Side | null = null;
  let run: { side: Side; points: number; last: JSONValue } | null = null;
  let unique = 0;
  const moment = (play: JSONValue, text: string, s: Side | null, t: number, b: number, id?: string, clock?: string): DetailMoment => {
    const period = periodOf(play);
    return {
      id: id ?? str(at(play, "id")) ?? `moment-${unique++}`,
      kind: s == null ? "other" : "score",
      clock: clockLabel(period, clock ?? clockOf(play)),
      text,
      side: s,
      minute: null,
      score: `${t}–${b}`,
      period,
    };
  };
  const close = () => {
    if (!run || run.points < 8) return;
    const score = scoreOf(run.last, topIsHome);
    const id = str(at(run.last, "id")) ?? `run-${unique++}`;
    // A run's last basket can also be a lead change: keep IDs unique.
    const distinct = moments.some((m) => m.id === id) ? `${id}-run` : id;
    moments.push(moment(run.last, `${run.points}–0 run`, run.side, score.top, score.bottom, distinct));
  };
  plays.forEach((play, index) => {
    const end = periodEnd(play);
    if (end) {
      // "End of the 4th Quarter" then "End of Game": one row, "Final".
      const next = plays[index + 1];
      if (!end.final && next != null && periodEnd(next)?.final === true) return;
      const name = end.final ? "Final" : end.period === 2 ? "Halftime" : end.period === 4 ? "End of regulation" : `End of ${periodName(end.period)}`;
      moments.push(moment(play, name, null, top, bottom, undefined, "0:00"));
      return;
    }
    if (bool(at(play, "scoringPlay")) !== true) return;
    const next = scoreOf(play, topIsHome);
    const scorer: Side | null = next.top > top ? "top" : next.bottom > bottom ? "bottom" : null;
    const gained = Math.max(next.top - top, next.bottom - bottom);
    if (!scorer || gained <= 0) return;
    // Runs: unanswered points. A free throw by the other side ends one.
    if (run && run.side === scorer) {
      run.points += gained;
      run.last = play;
    } else {
      close();
      run = { side: scorer, points: gained, last: play };
    }
    const now: Side | null = next.top > next.bottom ? "top" : next.bottom > next.top ? "bottom" : null;
    // Lead changes that decide games: fourth quarter and overtime.
    if (now && leader && now !== leader && (periodOf(play) ?? 0) >= 4) {
      moments.push(moment(play, `Lead change · ${short(str(at(play, "text")) ?? "")}`, now, next.top, next.bottom));
    }
    if (now) leader = now;
    top = next.top;
    bottom = next.bottom;
  });
  close();
  return moments;
}

/** ESPN's play text tidied: one line, no assist, no stray space before "'s". */
export function plain(text: string): string {
  let s = text.split(/\s+/).filter(Boolean).join(" ");
  const open = s.lastIndexOf(" (");
  if (open >= 0 && s.endsWith(")") && s.slice(open + 2).includes("assist")) s = s.slice(0, open);
  return s.replaceAll(" 's ", "'s ");
}

/** For a caption: tidied, and a made shot is just the shot ("… makes 26-foot jumper (Reaves assists)" → "… 26-ft jumper"). */
export function short(text: string): string {
  return plain(text).replaceAll(" makes ", " ").replaceAll("-foot ", "-ft ");
}

/**
 * A shot after a "Made 3" / "Missed 2" lead: the shooter's short name and
 * the shot ("Mario Hezonja makes 25-foot three point jumper" → "M. Hezonja 25-ft three point jumper").
 */
export function shotText(text: string, shooter: string | null): string {
  let s = plain(text);
  for (const verb of [" makes ", " misses "]) {
    const i = s.indexOf(verb);
    if (i < 0) continue;
    s = `${shooter ?? s.slice(0, i)} ${s.slice(i + verb.length)}`;
    break;
  }
  return s.replaceAll("-foot ", "-ft ");
}

/** The last few plays, newest first, with their clock ("Q3 4:12  …"). */
export function recentPlays(plays: readonly JSONValue[], count = 4): string[] {
  return plays
    .filter((p) => (str(at(p, "text")) ?? "") !== "")
    .slice(-count)
    .reverse()
    .map((p) => `${clockLabel(periodOf(p), clockOf(p))}  ${plain(str(at(p, "text")) ?? "")}`);
}

/**
 * The home team's win probability after the newest play that has one.
 * ESPN lists `winprobability` by sequence number, not game order, so it's
 * joined to the plays by ID (the last entry isn't necessarily the latest play).
 */
export function homeWinProbability(summary: JSONValue): number | null {
  const byPlay = new Map<string, number>();
  const entries = arr(at(summary, "winprobability"));
  for (const entry of entries) {
    const id = str(at(entry, "playId"));
    const home = num(at(entry, "homeWinPercentage"));
    if (id && home != null) byPlay.set(id, home);
  }
  if (byPlay.size === 0) return null;
  const plays = arr(at(summary, "plays"));
  for (let i = plays.length - 1; i >= 0; i--) {
    const id = str(at(plays[i], "id"));
    if (id && byPlay.has(id)) return byPlay.get(id)!;
  }
  return num(at(entries.at(-1), "homeWinPercentage")) ?? null;
}

/** ESPN's pregame matchup predictor, for the top team (0…1). */
export function predictor(summary: JSONValue, topIsHome: boolean): number | null {
  const projection = num(at(summary, "predictor", topIsHome ? "homeTeam" : "awayTeam", "gameProjection"));
  return projection == null ? null : Math.min(Math.max(projection / 100, 0), 1);
}

/**
 * Plays worth a line in the scores list on their own: shots and free
 * throws, turnovers, fouls, goaltending, ejections, and anything that
 * scored. Rebounds, timeouts, substitutions, reviews and period ends aren't.
 */
export function isNotable(type: number | null, scoreValue: number | null): boolean {
  if ((scoreValue ?? 0) > 0) return true;
  if (type == null) return true;
  const fouls = new Set([22, 24, 29, 30, 31, 32, 33, 35, 40, 42, 43, 44, 45, 48]);
  return (type >= 91 && type <= 153) || type === 282 || (type >= 61 && type <= 90) || fouls.has(type) || type === 9 || type === 517;
}

// MARK: - Leaders, box score, injuries

const LEADER_LABELS: Readonly<Record<string, string>> = {
  points: "PTS",
  rebounds: "REB",
  assists: "AST",
  pointsPerGame: "PTS",
  reboundsPerGame: "REB",
  assistsPerGame: "AST",
};

export function leaders(teams: readonly JSONValue[], side: SideOf): LeaderLine[] {
  const byCategory = new Map<string, { top: Leader | null; bottom: Leader | null }>();
  const order: string[] = [];
  // Game stats live; season averages before tip-off.
  for (const team of teams) {
    const s = side(str(at(team, "team", "id")));
    for (const category of arr(at(team, "leaders"))) {
      const name = str(at(category, "name"));
      const label = name ? LEADER_LABELS[name] : undefined;
      const first = arr(at(category, "leaders"))[0];
      if (!label || first == null) continue;
      if (!order.includes(label)) order.push(label);
      const athlete = at(first, "athlete");
      // A scorer's shooting ("9/16 FG, 4/4 FT" → "9/16 FG"). Rebounds and assists say it all in the number.
      const summary = label === "PTS" ? (str(at(first, "summary")) ?? "").split(",")[0]?.trim() : "";
      const value = str(at(first, "displayValue")) ?? (intOf(at(first, "value")) != null ? String(intOf(at(first, "value"))) : "");
      const leader: Leader = {
        name: str(at(athlete, "shortName")) ?? str(at(athlete, "displayName")) ?? "",
        value,
        headshot: str(at(athlete, "headshot", "href")) ?? str(at(athlete, "headshot")) ?? null,
        player: str(at(athlete, "id")) ?? null,
        detail: summary ? summary : null,
      };
      const entry = byCategory.get(label) ?? { top: null, bottom: null };
      if (s === "top") entry.top = leader;
      if (s === "bottom") entry.bottom = leader;
      byCategory.set(label, entry);
    }
  }
  return ["PTS", "REB", "AST"].filter((c) => order.includes(c)).map((category) => ({ category, top: byCategory.get(category)?.top ?? null, bottom: byCategory.get(category)?.bottom ?? null }));
}

/** ESPN's stat keys and the labels the box score keeps them under. */
const BOX_LABELS: Readonly<Record<string, string>> = {
  minutes: "MIN",
  points: "PTS",
  "fieldGoalsMade-fieldGoalsAttempted": "FG",
  "threePointFieldGoalsMade-threePointFieldGoalsAttempted": "3PT",
  "freeThrowsMade-freeThrowsAttempted": "FT",
  rebounds: "REB",
  assists: "AST",
  turnovers: "TO",
  steals: "STL",
  blocks: "BLK",
  offensiveRebounds: "OREB",
  defensiveRebounds: "DREB",
  fouls: "PF",
  plusMinus: "+/-",
};

/** Column labels in ESPN's order: by key, in case the order or wording changes; ESPN's label as a fallback. */
function boxColumns(group: JSONValue): string[] {
  const keys = arr(at(group, "keys")).map((k) => str(k) ?? "");
  const labels = arr(at(group, "labels")).map((l) => str(l) ?? "");
  return Array.from({ length: Math.max(keys.length, labels.length) }, (_, i) => (i < keys.length ? BOX_LABELS[keys[i]!] : undefined) ?? labels[i] ?? "");
}

/** One row of values as a label-keyed line (empty values left out). */
function line(values: readonly JSONValue[], columns: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  columns.forEach((column, i) => {
    const value = str(values[i]);
    if (value && column) out[column] = value;
  });
  return out;
}

/** A team's totals line ("40-88" FG, 112 PTS), keyed like a player's. */
export function boxTotals(team: JSONValue): Record<string, string> {
  const group = arr(at(team, "statistics"))[0];
  if (group == null) return {};
  return line(arr(at(group, "totals")), boxColumns(group));
}

/** One team's box score: starters as ESPN lists them, then the bench by minutes, then whoever hasn't played. */
export function box(team: JSONValue): BoxPlayer[] {
  const group = arr(at(team, "statistics"))[0];
  if (group == null) return [];
  const columns = boxColumns(group);
  const players = arr(at(group, "athletes")).flatMap((entry): BoxPlayer[] => {
    const athlete = at(entry, "athlete");
    const id = str(at(athlete, "id"));
    if (!id) return [];
    const stats = arr(at(entry, "stats")).filter((s) => typeof s === "string");
    const starter = bool(at(entry, "starter")) === true;
    // ESPN puts "COACH'S DECISION" on every row; only a real reason is worth showing.
    let dnp: string | null = null;
    if (bool(at(entry, "didNotPlay")) === true || (stats.length === 0 && !starter)) {
      const reason = str(at(entry, "reason")) ?? "";
      dnp = reason === "" || reason.toUpperCase() === "COACH'S DECISION" ? "Coach's decision" : reason.slice(0, 1).toUpperCase() + reason.slice(1).toLowerCase();
    }
    return [
      {
        id,
        name: str(at(athlete, "shortName")) ?? str(at(athlete, "displayName")) ?? "",
        starter,
        onCourt: bool(at(entry, "active")) === true,
        stats: line(arr(at(entry, "stats")), columns),
        didNotPlay: dnp,
      },
    ];
  });
  const minutes = (p: BoxPlayer) => Number.parseInt(p.stats.MIN ?? "", 10) || 0;
  const starters = players.filter((p) => p.starter && played(p));
  const bench = players
    .map((p, offset) => ({ p, offset }))
    .filter(({ p }) => !p.starter && played(p))
    .sort((a, b) => minutes(b.p) - minutes(a.p) || a.offset - b.offset)
    .map(({ p }) => p);
  return [...starters, ...bench, ...players.filter((p) => !played(p))];
}

export function injury(item: JSONValue, side: Side | null): Injury | null {
  const athlete = at(item, "athlete");
  const name = str(at(athlete, "shortName")) ?? str(at(athlete, "displayName"));
  const raw = str(at(item, "status"));
  if (!name || !raw) return null;
  const details = at(item, "details");
  const fantasy = str(at(details, "fantasyStatus", "abbreviation"));
  const status = fantasy === "OFS" ? "Out for season" : raw.toLowerCase() === "day-to-day" ? "Day-to-day" : raw;
  // "Left" + "Ankle" + "Sprain" → "Left ankle sprain".
  const sideWord = str(at(details, "side"));
  const place = [sideWord && ["left", "right"].includes(sideWord.toLowerCase()) ? sideWord : null, str(at(details, "type")) ?? null].filter(Boolean).join(" ");
  const what = str(at(details, "detail"));
  const whatText = what && what.toLowerCase() !== "not specified" ? what.toLowerCase() : null;
  const text = [place, whatText].filter((s): s is string => s != null && s !== "").join(" ");
  const back = str(at(details, "returnDate"));
  let returnDate: number | null = null;
  if (back && /^\d{4}-\d{2}-\d{2}/.test(back)) {
    const [y, m, d] = back.slice(0, 10).split("-").map(Number) as [number, number, number];
    returnDate = new Date(y, m - 1, d).getTime();
  }
  return {
    id: str(at(athlete, "id")) ?? name,
    name,
    status,
    detail: text === "" ? null : text.slice(0, 1).toUpperCase() + text.slice(1).toLowerCase(),
    side,
    returnDate,
  };
}

/** "Left ankle sprain · Expected back Oct 27" (InjuryReport.detail). */
export function injuryDetail(i: Injury, now = Date.now()): string | null {
  const parts = i.detail ? [i.detail] : [];
  const today = new Date(now);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (i.returnDate != null && i.returnDate > midnight) {
    parts.push(`Expected back ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(i.returnDate)}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

// MARK: - Court plays (the live trail and the replay)

/** Turnovers, the live placeholder 61 ("No Turnover") included. */
export const TURNOVER_TYPES: ReadonlySet<number> = new Set([61, 62, 63, 64, 65, 67, 68, 69, 70, 71, 72, 73, 78, 84, 86, 87, 90]);
/** Offensive foul, charge. */
const OFFENSIVE_FOUL_TYPES: ReadonlySet<number> = new Set([42, 24]);
/** Shooting, personal, take, loose ball, flagrant 1 and 2, away from the play. */
const DEFENSIVE_FOUL_TYPES: ReadonlySet<number> = new Set([44, 45, 22, 43, 32, 31, 40]);

/** The plays the court and the replay use, in ESPN's order (game order). The bookkeeping team rebound between two free throws is left out. */
export function courtPlays(plays: readonly JSONValue[], side: SideOf, topIsHome: boolean, quarter: number = QUARTER.nba): CourtPlay[] {
  const result: CourtPlay[] = [];
  let score = { top: 0, bottom: 0 };
  for (const play of plays) {
    const home = intOf(at(play, "homeScore"));
    const away = intOf(at(play, "awayScore"));
    if (home != null && away != null) score = topIsHome ? { top: home, bottom: away } : { top: away, bottom: home };
    const next = courtPlay(play, side, score, quarter);
    if (!next) continue;
    const last = result.at(-1)?.kind;
    if (next.kind.kind === "rebound" && next.player == null && last?.kind === "freeThrow" && !last.made && !last.last && !last.technical) continue;
    result.push(next);
  }
  return result;
}

/** One play for the court, from its structured fields (type, team, participants, coordinates), never its text; null for plays that move nothing. */
export function courtPlay(play: JSONValue, side: SideOf, score: { top: number; bottom: number }, quarter: number = QUARTER.nba): CourtPlay | null {
  const id = str(at(play, "id"));
  if (!id) return null;
  const type = typeID(play);
  const made = bool(at(play, "scoringPlay")) === true;
  const x = position(at(play, "coordinate", "x"));
  const y = position(at(play, "coordinate", "y"));
  const shooting = bool(at(play, "shootingPlay")) === true;
  let kind: CourtKind;
  if (periodEnd(play)) kind = { kind: "periodEnd" };
  else if (shooting && isFreeThrow(play)) kind = { kind: "freeThrow", made, last: isLastFreeThrow(play), technical: type === 103 };
  else if (shooting) {
    if (x == null || y == null) return null;
    kind = { kind: "shot", made, value: shotValue(play, x, y) };
  } else if (type === 155 || type === 156) kind = { kind: "rebound", offensive: type === 156 };
  else if (type != null && TURNOVER_TYPES.has(type)) kind = { kind: "turnover", steal: participants(play).length > 1 };
  else if (type != null && OFFENSIVE_FOUL_TYPES.has(type)) kind = { kind: "foul", offensive: true };
  else if (type != null && DEFENSIVE_FOUL_TYPES.has(type)) kind = { kind: "foul", offensive: false };
  else if (type === 615) kind = { kind: "jumpBall" };
  else return null;
  const people = participants(play);
  const period = periodOf(play);
  const clock = clockOf(play);
  const jump = kind.kind === "jumpBall";
  return {
    id,
    kind,
    side: side(str(at(play, "team", "id"))),
    // A jump ball lists both jumpers, then who gained it.
    player: (jump ? people.at(-1) : people[0]) ?? null,
    other: jump || people.length < 2 ? null : people[1]!,
    x,
    y,
    period,
    clock,
    elapsed: period != null ? elapsed(period, clock, quarter) : null,
    text: str(at(play, "text")) ?? "",
    top: score.top,
    bottom: score.bottom,
    typeID: type,
  };
}

/** The last free throw of a trip: "1 of 1", "2 of 2", "3 of 3" (types 97, 99, 102, 105, 106), or the text's "n of n" for anything else. */
export function isLastFreeThrow(play: JSONValue): boolean {
  const type = typeID(play);
  if (type != null && type >= 97 && type <= 106 && type !== 103) return [97, 99, 102, 105, 106].includes(type);
  const words = (str(at(play, "text")) ?? "").toLowerCase().split(" ").filter(Boolean);
  const of = words.lastIndexOf("of");
  if (of <= 0 || of + 1 >= words.length) return true;
  return words[of - 1] === words[of + 1];
}

/**
 * The team on offense, whose basket `x`/`y` are measured toward. A
 * defensive rebound or foul belongs to the defense, but its spot is the
 * offense's end.
 */
export function attacking(play: CourtPlay): Side | null {
  switch (play.kind.kind) {
    case "shot":
    case "freeThrow":
    case "turnover":
      return play.side;
    case "rebound":
    case "foul":
      return play.kind.offensive ? play.side : play.side ? opponent(play.side) : null;
    default:
      return null;
  }
}

/**
 * Where it happened on the attacking team's half, in ESPN's feet. A
 * rebound's coordinates are a copy of the missed shot's, so it sits just off
 * the rim toward that shot instead; free throws are at the line. Jump balls
 * (center court) are the view's to place.
 */
export function spot(play: CourtPlay): { x: number; y: number } | null {
  switch (play.kind.kind) {
    case "shot":
    case "turnover":
    case "foul":
      return play.x != null && play.y != null ? { x: play.x, y: play.y } : null;
    case "freeThrow":
      return { x: 25, y: 15 };
    case "rebound": {
      // 3 ft off the rim, on the side the shot came from (straight out without one).
      const dx = (play.x ?? 25) - 25;
      const dy = (play.y ?? 4) - 1;
      const length = Math.hypot(dx, dy);
      if (length <= 0.5) return { x: 25, y: 4 };
      const reach = Math.min(3, length);
      return { x: 25 + (dx / length) * reach, y: 1 + (dy / length) * reach };
    }
    default:
      return null;
  }
}

/** It has a place on the court (the trail draws it). */
export const positioned = (play: CourtPlay) => play.kind.kind === "jumpBall" || spot(play) != null;
export const isShotPlay = (play: CourtPlay) => play.kind.kind === "shot";

/**
 * Who has the ball once this play is done, given who had it before. The
 * data spec's rule (§5), right 97.7% of the times it decides: a make, last
 * free throw, turnover or offensive foul hands the ball over; a defensive
 * foul gives it to the fouled team; a rebound or jump ball goes to that
 * team; a miss leaves it in the air (null).
 */
export function possessionAfter(play: CourtPlay, current: Side | null): Side | null {
  const k = play.kind;
  if (k.kind === "periodEnd") return null;
  const s = play.side;
  if (!s) return current;
  switch (k.kind) {
    case "shot":
      return k.made ? opponent(s) : null;
    case "freeThrow":
      if (k.technical) return current;
      if (!k.last) return s;
      return k.made ? opponent(s) : null;
    case "rebound":
    case "jumpBall":
      return s;
    case "turnover":
    case "foul":
      return opponent(s);
  }
}

/** What it was, as a readout's lead ("Made 3", "Steal", "Defensive rebound"). */
export function playLabel(play: CourtPlay): string {
  const k = play.kind;
  switch (k.kind) {
    case "shot":
      return `${k.made ? "Made" : "Missed"} ${k.value}`;
    case "freeThrow":
      return k.made ? "Free throw" : "Missed free throw";
    case "rebound":
      return k.offensive ? "Offensive rebound" : "Defensive rebound";
    case "turnover":
      return k.steal ? "Steal" : "Turnover";
    case "foul":
      return k.offensive ? "Offensive foul" : "Foul";
    case "jumpBall":
      return "Jump ball";
    case "periodEnd":
      return "End of period";
  }
}

/** A shot play as a shot-chart mark. */
export function shotOfPlay(play: CourtPlay): Shot | null {
  if (play.kind.kind !== "shot" || play.x == null || play.y == null) return null;
  return {
    id: play.id,
    x: play.x,
    y: play.y,
    made: play.kind.made,
    value: play.kind.value,
    side: play.side,
    player: play.player,
    period: play.period,
    clock: play.clock,
    text: play.text,
    elapsed: play.elapsed,
    typeID: play.typeID,
    blocker: play.kind.made ? null : play.other,
  };
}

/**
 * The summary's plays with the live lane's spliced over them. The lane is
 * fresher for everything from its first play the summary also has: its
 * version replaces the summary's from there (edits, deletions and late
 * inserts included). Without an overlap it adds only what's newer.
 */
export function mergePlays(summary: readonly CourtPlay[], lane: readonly CourtPlay[]): readonly CourtPlay[] {
  if (lane.length === 0) return summary;
  const index = new Map<string, number>();
  summary.forEach((p, i) => {
    if (!index.has(p.id)) index.set(p.id, i);
  });
  const cut = lane.map((p) => index.get(p.id)).find((i) => i != null);
  if (cut != null) {
    const fresh = new Set(lane.map((p) => p.id));
    return [...summary.slice(0, cut).filter((p) => !fresh.has(p.id)), ...lane];
  }
  const after = summary.at(-1)?.elapsed ?? -1;
  return [...summary, ...lane.filter((p) => !index.has(p.id) && (p.elapsed ?? 0) >= after)];
}

/** How many of `plays` (in game order) had happened by game second `t`: every play at or before it (free throws share their foul's clock). */
export function countThrough(plays: readonly CourtPlay[], t: number): number {
  let low = 0;
  let high = plays.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((plays[mid]!.elapsed ?? 0) <= t) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Who has the ball after these plays (null: nobody can say, e.g. a shot in the air). */
export function possession(plays: readonly CourtPlay[]): Side | null {
  return plays.reduce<Side | null>((current, play) => possessionAfter(play, current), null);
}

/**
 * Who has the ball, for the possession arrow: the data spec's rule, plus
 * what it can't decide. After a miss (or a missed last free throw) the ball
 * is in the air: it's still the shooting team's trip until the rebound, so
 * the arrow keeps pointing their way, dimmed. Null before the first play
 * that decides, and after a period ends.
 */
export interface Ball {
  readonly side: Side | null;
  readonly inAir: boolean;
}

export const NO_BALL: Ball = { side: null, inAir: false };

export function ball(plays: readonly CourtPlay[]): Ball {
  return plays.reduce<Ball>((state, play) => {
    if (play.kind.kind === "periodEnd") return NO_BALL;
    const decided = possessionAfter(play, state.inAir ? null : state.side);
    if (decided) return { side: decided, inAir: false };
    const k = play.kind;
    if ((k.kind === "shot" && !k.made) || (k.kind === "freeThrow" && !k.made && k.last && !k.technical)) {
      const s = play.side ?? state.side;
      return { side: s, inAir: s != null };
    }
    // A technical, or a play with no team: nothing changes.
    return state;
  }, NO_BALL);
}

/** Clutch time: the last five minutes of the fourth or any overtime, within five. */
export function clutch(period: number, secondsLeft: number, margin: number): boolean {
  return period >= 4 && secondsLeft <= 300 && Math.abs(margin) <= 5;
}

/** A make with the clock at a second or less ("0.6", "0:01", "0.0"). */
export function buzzer(clock: string): boolean {
  return (seconds(clock) ?? Infinity) <= 1.0;
}

/**
 * Each shooter's straight makes, counting back from their latest field-goal
 * attempt (free throws don't count; a blocked shot is a miss). Players whose
 * latest attempt missed are left out.
 */
export function streaks(plays: readonly CourtPlay[]): Record<string, number> {
  const run: Record<string, number> = {};
  for (const play of plays) {
    if (play.kind.kind !== "shot" || !play.player) continue;
    run[play.player] = play.kind.made ? (run[play.player] ?? 0) + 1 : 0;
  }
  return Object.fromEntries(Object.entries(run).filter(([, n]) => n > 0));
}

/**
 * The streak that sets a player on fire: four straight field goals. Tuned on
 * the data spec's 41 recorded games: at three the flame was always lit
 * somewhere; at four it's about 3 players a game; at five, too rare to learn.
 */
export const FIRE_STREAK = 4;

/** A make that's news for its streak: the one that sets the shooter on fire, then every second one after (4, 6, 8…). */
export function isFireMilestone(streak: number): boolean {
  return streak >= FIRE_STREAK && (streak - FIRE_STREAK) % 2 === 0;
}

/** A player's shooting and points from the plays, for the line at a moment of a replay. */
export function playerLine(player: string, plays: readonly CourtPlay[]): { fg: [number, number]; threes: [number, number]; points: number } {
  const fg: [number, number] = [0, 0];
  const threes: [number, number] = [0, 0];
  let total = 0;
  for (const play of plays) {
    if (play.player !== player) continue;
    const k = play.kind;
    if (k.kind === "shot") {
      fg[1] += 1;
      if (k.value === 3) threes[1] += 1;
      if (k.made) {
        fg[0] += 1;
        total += k.value;
        if (k.value === 3) threes[0] += 1;
      }
    } else if (k.kind === "freeThrow" && k.made) total += 1;
  }
  return { fg, threes, points: total };
}

/** "C. Cunningham" → "Cunningham", for a narrow column. A name without an initial ("Nikola Jokić") stays whole. */
export function lastName(name: string): string {
  const space = name.indexOf(" ");
  if (space < 0 || !name.slice(0, space).endsWith(".")) return name;
  return name.slice(space + 1);
}

/** "9-16" → [9, 16]. */
export function madeOf(text: string | undefined): [number, number] | null {
  const parts = (text ?? "").split("-").map((p) => Number.parseInt(p, 10));
  return parts.length === 2 && parts.every(Number.isFinite) ? [parts[0]!, parts[1]!] : null;
}

/** "9 of 16, 3 of 7 from three". */
export function shooting(fg: readonly [number, number], threes: readonly [number, number]): string {
  if (fg[1] <= 0) return "No shots yet";
  const text = `${fg[0]} of ${fg[1]}`;
  return threes[1] > 0 ? `${text}, ${threes[0]} of ${threes[1]} from three` : text;
}

export function shootingOf(shots: readonly Shot[]): string {
  const threes = shots.filter((s) => s.value === 3);
  return shooting([shots.filter((s) => s.made).length, shots.length], [threes.filter((s) => s.made).length, threes.length]);
}

/** "LAL 78–71", leader first; "Tied 74–74". */
export function scoreLine(top: number, bottom: number, topName: string, bottomName: string): string {
  if (top === bottom) return `Tied ${top}–${bottom}`;
  return top > bottom ? `${topName} ${top}–${bottom}` : `${bottomName} ${bottom}–${top}`;
}

/**
 * The summary's linescore with the live lane's score in it. The summary is
 * refreshed every 30 seconds and the lane every few, so without this T
 * trails the hero by up to half a minute. T takes the lane's score (top
 * first); the points since the summary go to the current period's cell
 * while the lane is still in the summary's last period. Never behind.
 */
export function laneLinescore<L extends { readonly headers: readonly string[]; readonly top: readonly string[]; readonly bottom: readonly string[] }>(
  summary: L,
  lane: { top: number; bottom: number },
  period: number | null,
): L {
  const t = summary.headers.length - 1;
  if (t < 0 || summary.headers[t] !== "T" || summary.top.length !== summary.headers.length || summary.bottom.length !== summary.headers.length) return summary;
  const wasTop = Number.parseInt(summary.top[t] ?? "", 10);
  const wasBottom = Number.parseInt(summary.bottom[t] ?? "", 10);
  const known = Number.isFinite(wasTop) && Number.isFinite(wasBottom);
  if (known && lane.top + lane.bottom < wasTop + wasBottom) return summary;
  const top = [...summary.top];
  const bottom = [...summary.bottom];
  top[t] = String(lane.top);
  bottom[t] = String(lane.bottom);
  if (period != null && period === t && t > 0 && known) {
    const cellTop = Number.parseInt(top[t - 1] ?? "", 10);
    const cellBottom = Number.parseInt(bottom[t - 1] ?? "", 10);
    if (Number.isFinite(cellTop) && Number.isFinite(cellBottom)) {
      top[t - 1] = String(Math.max(0, cellTop + lane.top - wasTop));
      bottom[t - 1] = String(Math.max(0, cellBottom + lane.bottom - wasBottom));
    }
  }
  return { ...summary, top, bottom };
}

// MARK: - Merging the live lane

/** The summary's shots, plus the live lane's newer ones (no duplicates). */
export function mergeShots(summary: readonly Shot[], newestElapsed: number | null, lane: readonly Shot[]): readonly Shot[] {
  if (lane.length === 0) return summary;
  const known = new Set(summary.map((s) => s.id));
  const after = newestElapsed ?? -1;
  return [...summary, ...lane.filter((s) => !known.has(s.id) && (s.elapsed ?? 0) >= after)];
}

export function mergeFlow(summary: readonly FlowPoint[], lane: readonly FlowPoint[]): readonly FlowPoint[] {
  const last = summary.at(-1);
  if (!last) return lane;
  if (lane.length === 0) return summary;
  const known = new Set(summary.map((p) => p.id));
  const merged = [...summary];
  for (const point of lane) {
    if (known.has(point.id) || point.elapsed < last.elapsed) continue;
    // The lane's first point may repeat the summary's last score under another play.
    const tail = merged.at(-1)!;
    if (tail.top === point.top && tail.bottom === point.bottom) continue;
    merged.push({ ...point, scorer: point.top > tail.top ? "top" : point.bottom > tail.bottom ? "bottom" : null });
  }
  return merged;
}

// MARK: - Game flow (GameFlowView's pure parts)

/** Lead changes, ties and each side's largest lead (a tie isn't a change). */
export function flowStory(points: readonly FlowPoint[]): { changes: number; ties: number; top: number; bottom: number } {
  let leader = 0;
  let changes = 0;
  let ties = 0;
  for (const p of points.slice(1)) {
    const m = margin(p);
    if (m === 0) {
      if (leader !== 0) ties += 1;
      continue;
    }
    if (leader !== 0 && Math.sign(m) !== leader) changes += 1;
    leader = Math.sign(m);
  }
  const margins = points.map(margin);
  return { changes, ties, top: Math.max(Math.max(...margins, 0), 0), bottom: Math.max(-Math.min(...margins, 0), 0) };
}

/** Value first: "LAL +4", then "88–84 · Q3 4:12" (the leader's score first). */
export function flowReadout(p: FlowPoint, topName: string, bottomName: string): { lead: string; detail: string } {
  const when = clockLabel(p.period, p.clock);
  if (p.top === p.bottom) return { lead: "Tied", detail: `${p.top}–${p.bottom} · ${when}` };
  const [name, high, low] = p.top > p.bottom ? [topName, p.top, p.bottom] : [bottomName, p.bottom, p.top];
  return { lead: `${name} +${high - low}`, detail: `${high}–${low} · ${when}` };
}

/** The margin the chart spans each way: at least 10, in fives. */
export function flowExtent(points: readonly FlowPoint[]): number {
  const largest = Math.max(0, ...points.map((p) => Math.abs(margin(p))));
  return Math.max(10, Math.ceil(largest / 5) * 5);
}

/**
 * The names under the flow plot and where they center: each quarter in its
 * own; each overtime in its own while every one has room for its name (and
 * 6pt around it), else one name over them all ("4OT", as the final says it).
 */
export function periodLabels(periods: number, x: (t: number) => number, measure: (text: string) => number, quarter: number = QUARTER.nba): { text: string; x: number }[] {
  const mid = (p: number) => (x(periodStart(p, quarter)) + x(periodStart(p + 1, quarter))) / 2;
  const room = (p: number) => x(periodStart(p + 1, quarter)) - x(periodStart(p, quarter));
  const quarters = Array.from({ length: Math.min(periods, 4) }, (_, i) => ({ text: periodName(i + 1), x: mid(i + 1) }));
  if (periods <= 4) return quarters;
  const overtimes = Array.from({ length: periods - 4 }, (_, i) => i + 5);
  if (overtimes.every((p) => measure(periodName(p)) + 6 <= room(p))) return [...quarters, ...overtimes.map((p) => ({ text: periodName(p), x: mid(p) }))];
  const span = (x(periodStart(5, quarter)) + x(periodStart(periods + 1, quarter))) / 2;
  return [...quarters, { text: overtime(periods - 4), x: span }];
}

// MARK: - The court's scene (CourtScene)

export type SceneStyle =
  /** Every shot at full strength: a final, or one player's shots. */
  | "chart"
  /** The last plays trail to the ball; earlier shots step back. */
  | "trail"
  /** A replay running: each shot lands as its time comes, then steps back. */
  | "playing";

export interface CourtScene {
  readonly style: SceneStyle;
  /** The shots to draw (up to the replay time; one player's, if picked). */
  readonly shots: readonly Shot[];
  /** The last plays with a place on the court, oldest first. */
  readonly trail: readonly CourtPlay[];
  /** The possession arrow: who has it, or whose shot is in the air. */
  readonly ball: Ball;
  /** The shot to draw larger: the newest, in a replay or for a picked player live. */
  readonly newest: Shot | null;
  /** The newest play with a place on the court (the footer's line). */
  readonly latest: CourtPlay | null;
  /** The score at the time shown. */
  readonly score: { top: number; bottom: number } | null;
}

/** How many plays trail the ball. */
export const TRAIL_LENGTH = 8;

/** What the court shows at a moment. `time`: the replay's game second (null: the whole game, or live now). */
export function courtScene(allShots: readonly Shot[], plays: readonly CourtPlay[], time: number | null, live: boolean, playing: boolean, pinned: string | null): CourtScene {
  const upTo = time != null ? plays.slice(0, countThrough(plays, time)) : plays;
  let shots: readonly Shot[];
  if (plays.length === 0) shots = time != null ? allShots.filter((s) => (s.elapsed ?? 0) <= time) : allShots;
  else shots = upTo.flatMap((p) => shotOfPlay(p) ?? []);
  if (pinned) shots = shots.filter((s) => s.player === pinned);
  const style: SceneStyle = playing ? "playing" : pinned != null || plays.length === 0 || (time == null && !live) ? "chart" : "trail";
  const trail = style === "trail" ? upTo.filter(positioned).slice(-TRAIL_LENGTH) : [];
  let latest: CourtPlay | null = null;
  if (pinned == null) for (let i = upTo.length - 1; i >= 0; i--) if (positioned(upTo[i]!)) { latest = upTo[i]!; break; }
  const last = upTo.at(-1);
  return {
    style,
    shots,
    trail,
    ball: style === "trail" ? ball(upTo) : NO_BALL,
    newest: time != null || (live && pinned != null) ? (shots.at(-1) ?? null) : null,
    latest,
    score: last ? { top: last.top, bottom: last.bottom } : time != null ? { top: 0, bottom: 0 } : null,
  };
}

/** The shots a focus means: one play; else a player's; else a stretch of game time (a run: the running team's shots in it); else a quarter's (CourtView.lit). */
export function litShots(shots: readonly Shot[], focus: { play?: string; player?: string; span?: readonly [number, number]; period?: number; side?: Side | null } | null): readonly Shot[] {
  if (!focus) return [];
  if (focus.play != null) return shots.filter((s) => s.id === focus.play);
  if (focus.player != null) return shots.filter((s) => s.player === focus.player);
  if (focus.span) {
    const [a, b] = focus.span;
    return shots.filter((s) => s.elapsed != null && s.elapsed >= a && s.elapsed <= b && (focus.side == null || s.side === focus.side));
  }
  if (focus.period != null) return shots.filter((s) => s.period === focus.period && (focus.side == null || s.side === focus.side));
  return [];
}

// MARK: - Court geometry (court feet: x along the court 0…94, y across it 0…50)

export const COURT = { length: 94, width: 50 } as const;

/** ESPN's half-court feet (toward `attacking`'s basket) as court feet. The top team shoots at the right basket. */
export function courtPoint(x: number, y: number, side: Side | null): { x: number; y: number } {
  const p = side === "bottom" ? { x: 4 + y, y: 50 - x } : { x: 90 - y, y: x };
  return { x: Math.min(Math.max(p.x, 0), COURT.length), y: Math.min(Math.max(p.y, 0), COURT.width) };
}

export const shotPoint = (s: Shot) => courtPoint(s.x, s.y, s.side);

/** The rim a team shoots at, in court feet. */
export function rim(side: Side | null): { x: number; y: number } {
  return side === "bottom" ? { x: 5, y: 25 } : { x: 89, y: 25 };
}

/** A team's backboard line, in court feet. */
export function backboard(side: Side | null): [{ x: number; y: number }, { x: number; y: number }] {
  const x = side === "bottom" ? 4 : 90;
  return [{ x, y: 22 }, { x, y: 28 }];
}

/** Where a play happened, in court feet (a jump ball at center court). */
export function playPoint(play: CourtPlay): { x: number; y: number } | null {
  if (play.kind.kind === "jumpBall") return { x: COURT.length / 2, y: COURT.width / 2 };
  const s = spot(play);
  const a = attacking(play);
  if (!s || !a) return null;
  return courtPoint(s.x, s.y, a);
}

/** How far along its path a blocked shot gets. */
export const BLOCK_REACH = 0.6;

/**
 * Where the ball ended up after a play: at the rim for a shot or free throw
 * (it went there, in or not), except a blocked shot, which never got there;
 * else where it happened.
 */
export function ballPoint(play: CourtPlay): { x: number; y: number } | null {
  const k = play.kind;
  if (k.kind === "shot" && !k.made && play.other != null) {
    const s = playPoint(play);
    const a = attacking(play);
    if (!s || !a) return null;
    const r = rim(a);
    return { x: s.x + (r.x - s.x) * BLOCK_REACH, y: s.y + (r.y - s.y) * BLOCK_REACH };
  }
  if (k.kind === "shot" || k.kind === "freeThrow") {
    const a = attacking(play);
    return a ? rim(a) : null;
  }
  return playPoint(play);
}

// MARK: - Shot stories (ShotArc and CourtStory's rules)

export type ArcKind = "swish" | "rimOut" | "stuffed" | "slam";

/** The ball reaches the rim at 0.40 s. */
export const FLIGHT = 0.4;

/** When the ball is through the net, off the rim or knocked away: the possession arrow turns then. */
export function throughTime(kind: ArcKind, reduceMotion: boolean): number {
  if (reduceMotion) return 0;
  switch (kind) {
    case "swish":
      return 0.52;
    case "rimOut":
      return 0.92 * FLIGHT + 0.2;
    case "stuffed":
      return BLOCK_REACH * FLIGHT + 0.26;
    case "slam":
      return 0.26;
  }
}

/** When the court's own ball shows again: once the net has settled, else as soon as the story lets it go. */
export function freeTime(kind: ArcKind, reduceMotion: boolean): number {
  return kind === "swish" && !reduceMotion ? 0.85 : throughTime(kind, reduceMotion);
}

/** When the story has handed over to the chart. */
export function arcDuration(kind: ArcKind, reduceMotion: boolean): number {
  if (reduceMotion) return kind === "stuffed" ? 0.85 : 0.2;
  switch (kind) {
    case "swish":
      return 1.0;
    case "rimOut":
      return 0.9;
    case "stuffed":
      return 1.05;
    case "slam":
      return 0.55;
  }
}

/**
 * A stylized flight between two real points (the spot and the rim): a
 * quadratic whose control point lifts straight up the picture by 22% of the
 * distance (40pt at most), the ball riding it at a constant parametric rate,
 * which on a quadratic is a projectile's motion (Celebrations.swift `FlightArc`).
 */
export function flightControl(from: { x: number; y: number }, to: { x: number; y: number }, cap = 40): { x: number; y: number } {
  const bow = Math.min(0.22 * Math.hypot(to.x - from.x, to.y - from.y), cap);
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - bow };
}

export function quadPoint(a: { x: number; y: number }, c: { x: number; y: number }, b: { x: number; y: number }, s: number): { x: number; y: number } {
  const u = 1 - s;
  return { x: u * u * a.x + 2 * u * s * c.x + s * s * b.x, y: u * u * a.y + 2 * u * s * c.y + s * s * b.y };
}

/** The effects a basket plays at the rim (CourtStory.basket): the swish or the rim, embers on fire. */
export function basketEffects(accents: ReadonlySet<Accent>, dunk: boolean): ("swish" | "swishEcho" | "rimPulse" | "embers")[] {
  return [dunk ? "rimPulse" : accents.has("andOne") ? "swishEcho" : "swish", ...(accents.has("onFire") ? (["embers"] as const) : [])];
}

/** What a play edited into more plays at the rim, after its first story already did (CourtStory.upgrade). */
export function upgradeEffects(a: LiveMoment, b: LiveMoment): ("rimPulse" | "echo" | "sparks")[] {
  const out: ("rimPulse" | "echo" | "sparks")[] = [];
  if (b.accents.has("dunk") && !a.accents.has("dunk")) out.push("rimPulse");
  if (b.accents.has("andOne") && !a.accents.has("andOne")) out.push("echo");
  if (a.kind === "made" && b.kind === "made" && (b.value ?? 0) > (a.value ?? 0)) out.push("sparks");
  return out;
}

export interface CourtStory {
  /** Identity: a new key plays from the start. An upgrade gets its own. */
  readonly key: string;
  readonly moment: LiveMoment;
  /** The shot it's about, when it's a field-goal attempt on the court. */
  readonly shot: Shot | null;
  /** The story the shot tells; null when the court plays no flight. */
  readonly kind: ArcKind | null;
  /** The story draws the landing (false for an upgrade: the mark is already there). */
  readonly lands: boolean;
  /** Replaces the stage's effects (null: the moment's own cue; empty: none). */
  readonly effects: readonly ("swish" | "swishEcho" | "rimPulse" | "embers" | "echo" | "sparks")[] | null;
  /** Which side's rim, and whose colors. */
  readonly side: Side | null;
}

/** The chart holds this shot back while the story draws it. */
export const holdsShot = (s: CourtStory) => s.kind != null && s.lands;

/**
 * What the court does with `moment`, given the moment first shown for that
 * play (if any). Steals and lead changes on a free throw have no shot;
 * period ends and runs belong to the game flow (CourtStory.make).
 */
export function courtStory(moment: LiveMoment, first: LiveMoment | null, shots: readonly Shot[]): CourtStory | null {
  let found: Shot | null = null;
  for (let i = shots.length - 1; i >= 0; i--) if (shots[i]!.id === moment.id) { found = shots[i]!; break; }
  const s = found;
  if (first && !sameMoment(first, moment)) {
    // ESPN added a block to a miss we flew: tell it again, stuffed.
    if (moment.kind === "block" && first.kind === "missed" && s) return { key: `${moment.id}-block`, moment, shot: s, kind: "stuffed", lands: true, effects: null, side: s.side };
    const effects = upgradeEffects(first, moment);
    if (effects.length === 0) return null;
    return { key: `${moment.id}-${[...moment.accents].sort().join(".")}-${moment.value ?? ""}`, moment, shot: s, kind: effects.includes("rimPulse") && s ? "slam" : null, lands: false, effects, side: s?.side ?? moment.side };
  }
  switch (moment.kind) {
    case "made":
    case "missed":
    case "block":
    case "run":
    case "leadChange": {
      if (!s) {
        // A make with no spot on the court still celebrates at its rim; a run on a free throw doesn't.
        return moment.kind === "made" ? { key: moment.id, moment, shot: null, kind: null, lands: true, effects: null, side: moment.side } : null;
      }
      const kind: ArcKind = s.made ? (moment.accents.has("dunk") || isDunk(s) ? "slam" : "swish") : moment.kind === "block" ? "stuffed" : "rimOut";
      // A run or lead change keeps its accent for the game flow; the court plays the basket.
      const effects = moment.kind === "run" || moment.kind === "leadChange" || moment.kind === "missed" || moment.kind === "block" ? (s.made ? basketEffects(moment.accents, kind === "slam") : []) : null;
      return { key: moment.id, moment, shot: s, kind, lands: true, effects, side: s.side };
    }
    case "steal":
      return { key: moment.id, moment, shot: null, kind: null, lands: true, effects: [], side: moment.side };
    default:
      return null;
  }
}

function sameMoment(a: LiveMoment, b: LiveMoment): boolean {
  if (a.id !== b.id || a.kind !== b.kind || a.tier !== b.tier || a.value !== b.value || a.accents.size !== b.accents.size) return false;
  for (const x of a.accents) if (!b.accents.has(x)) return false;
  return true;
}

// MARK: - Box score (BoxScoreView's pure parts)

export interface BoxColumn {
  readonly label: string;
  readonly width: number;
  readonly help: string;
  /** The narrowest width class that shows it. */
  readonly from: "compact" | "medium" | "large" | "xlarge";
}

/** Every column in reading order; a layout shows those it's wide enough for, so a column never moves when others join. */
export const BOX_COLUMNS: readonly BoxColumn[] = [
  { label: "MIN", width: 28, help: "Minutes", from: "compact" },
  { label: "PTS", width: 26, help: "Points", from: "compact" },
  { label: "FG", width: 40, help: "Field goals made–attempted", from: "medium" },
  { label: "3PT", width: 36, help: "Three-pointers made–attempted", from: "medium" },
  { label: "FT", width: 36, help: "Free throws made–attempted", from: "large" },
  { label: "REB", width: 26, help: "Rebounds", from: "compact" },
  { label: "AST", width: 26, help: "Assists", from: "compact" },
  { label: "STL", width: 26, help: "Steals", from: "large" },
  { label: "BLK", width: 26, help: "Blocks", from: "large" },
  { label: "TO", width: 24, help: "Turnovers", from: "xlarge" },
  { label: "PF", width: 24, help: "Personal fouls", from: "xlarge" },
  { label: "+/-", width: 30, help: "Plus-minus", from: "compact" },
];

const WIDTHS = { compact: 0, medium: 1, large: 2, xlarge: 3 } as const;

export function boxColumnsFor(width: keyof typeof WIDTHS): BoxColumn[] {
  return BOX_COLUMNS.filter((c) => WIDTHS[c.from] <= WIDTHS[width]);
}

/** A row read aloud: "12 points, 4 of 9 field goals, …, plus-minus +3". */
export function spokenBoxLine(stats: Readonly<Record<string, string>>, columns: readonly BoxColumn[]): string {
  return columns
    .flatMap((column): string[] => {
      const value = stats[column.label];
      if (!value) return [];
      switch (column.label) {
        case "FG":
        case "3PT":
        case "FT": {
          const parts = value.split("-");
          const name = column.label === "FG" ? "field goals" : column.label === "3PT" ? "threes" : "free throws";
          return parts.length === 2 ? [`${parts[0]} of ${parts[1]} ${name}`] : [];
        }
        case "+/-":
          return [`plus-minus ${value}`];
        default:
          return [`${value} ${column.help.toLowerCase()}`];
      }
    })
    .join(", ");
}

/** "+9", "−15" (a real minus sign), "0". */
export function signed(text: string): string {
  return text.startsWith("-") ? `−${text.slice(1)}` : text;
}

/** Live: "Not in yet: A, B". After: "DNP: A, B · Coach's decision", one clause per reason. */
export function notPlayed(players: readonly BoxPlayer[], live: boolean): string {
  if (live) return `Not in yet: ${players.map((p) => p.name).join(", ")}`;
  const groups: { reason: string; names: string[] }[] = [];
  for (const p of players) {
    const reason = p.didNotPlay ?? "Coach's decision";
    const g = groups.find((x) => x.reason === reason);
    if (g) g.names.push(p.name);
    else groups.push({ reason, names: [p.name] });
  }
  return `DNP: ${groups.map((g) => `${g.names.join(", ")} · ${g.reason}`).join("; ")}`;
}

// MARK: - Team stats (GameDetail.nbaStats)

/** NBA: shooting, the hustle numbers and how the game was won. */
export const NBA_STATS: readonly (readonly [string, string])[] = [
  ["fieldGoalPct", "Field Goal %"],
  ["threePointFieldGoalPct", "3-Point %"],
  ["freeThrowPct", "Free Throw %"],
  ["totalRebounds", "Rebounds"],
  ["assists", "Assists"],
  ["totalTurnovers", "Turnovers"],
  ["steals", "Steals"],
  ["blocks", "Blocks"],
  ["pointsInPaint", "Points in the Paint"],
  ["fastBreakPoints", "Fast Break Points"],
  ["largestLead", "Largest Lead"],
];

// MARK: - Team colors (TeamPalette.nba)

const rgbOf = (css: string): [number, number, number] => {
  if (!/^#[0-9a-f]{6}$/i.test(css)) return [0.5, 0.5, 0.5];
  const v = Number.parseInt(css.slice(1), 16);
  return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
};

/** How different two palette colors look (the sum of RGB differences; gray for neutral). */
export function colorDifference(a: string, b: string): number {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]);
}

/**
 * NBA teams share a lot of navy, purple, black and red. On NBA pages, when
 * the two colors as shown are hard to tell apart (Lakers and Jazz purple;
 * Pacers navy beside Nets black), a team wears its second color: the home
 * team (bottom) first, if its second color is vivid and separates them.
 */
export function nbaPalette(top: { color: string | null; alternateColor: string | null } | null, bottom: { color: string | null; alternateColor: string | null } | null, scheme: Scheme): TeamPalette {
  const palette = teamPalette(top?.color ?? null, bottom?.color ?? null, scheme);
  // Each color on its own: the pair's palette may already have grayed out a near-twin, which would hide the clash.
  const own = [teamPalette(top?.color ?? null, null, scheme).top, teamPalette(bottom?.color ?? null, null, scheme).top] as const;
  if (colorDifference(own[0], own[1]) >= 0.45) return palette;
  const vivid = (hex: string) => {
    const adjusted = teamPalette(hex, null, scheme).top;
    if (adjusted === NEUTRAL) return false;
    const c = rgbOf(adjusted);
    return Math.max(...c) - Math.min(...c) >= 0.3;
  };
  for (const swapBottom of [true, false]) {
    const alternate = swapBottom ? bottom?.alternateColor : top?.alternateColor;
    if (!alternate || !vivid(alternate)) continue;
    const swapped = swapBottom ? teamPalette(top?.color ?? null, alternate, scheme) : teamPalette(alternate, bottom?.color ?? null, scheme);
    if (colorDifference(swapped.top, swapped.bottom) >= 0.45) return swapped;
  }
  return palette;
}
