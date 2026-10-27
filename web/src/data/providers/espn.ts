/**
 * ESPN scoreboards: soccer, the NFL and college football, MLB, the NBA and
 * the WNBA. A faithful port of Providers.swift `ESPN` (events, makeEvent,
 * liveSnapshot, Situation.line); the comments there explain each quirk and
 * are kept here beside the code they justify.
 */
import { broadcaster } from "../broadcasters";
import { enDash, periodLabel } from "../format";
import { arr, at, bool, int, num, str, text, type JSONValue } from "../json";
import type { Fetcher } from "../http";
import type {
  BaseState,
  Competitor,
  Content,
  FootballSpot,
  GameClock,
  LiveSnapshot,
  MatchMark,
  ScoreEvent,
  Side,
  Sport,
} from "../models";
import { espnTeamID } from "../teams";
import { reconcileMarks, markMinute } from "../soccer";

export const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports";
/** The NBA gets the play-by-play line and its own captions (Basketball.swift `NBADetail.path`). */
export const NBA_PATH = "basketball/nba";

/** "20261025" in the viewer's day (ESPN's `dates=`). */
export function espnDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The scoreboard URLs a league is read from (Providers.swift `ESPN.events`).
 * - Weekly leagues (NFL, college): the current week. College asks for every
 *   FBS game (`groups=80`): the default board is just the Top 25, which would
 *   hide an unranked team you follow.
 * - Daily leagues: the undated board (ESPN fills it with the current or next
 *   matchday, so the next fixture is known even midweek), then yesterday,
 *   today and tomorrow, one day at a time: ESPN rejects date ranges intermittently.
 */
export function scoreboardURLs(path: string, weekly: boolean, now: number): string[] {
  const base = `${ESPN_SITE}/${path}/scoreboard`;
  if (weekly) return [path.endsWith("college-football") ? `${base}?groups=80` : base];
  return [base, ...[-1, 0, 1].map((offset) => `${base}?dates=${espnDay(now + offset * 86_400_000)}`)];
}

/** Fetches a league's boards in parallel; a single failing day doesn't blank the league. */
export async function fetchESPN(path: string, weekly: boolean, sport: Sport, fetcher: Fetcher, signal?: AbortSignal): Promise<ScoreEvent[]> {
  const urls = scoreboardURLs(path, weekly, Date.now());
  const settled = await Promise.allSettled(urls.map((url) => fetcher(url, { signal })));
  const boards = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (boards.length === 0) throw new Error(`Couldn't load any ${path} scoreboard`);
  return parseBoards(boards, path, sport, Date.now());
}

/** Events from scoreboards in hand, deduplicated by ID (a game appears on the undated board and its day's). */
export function parseBoards(boards: readonly JSONValue[], path: string, sport: Sport, now: number): ScoreEvent[] {
  const seen = new Set<string>();
  const events: ScoreEvent[] = [];
  for (const board of boards) {
    for (const e of arr(at(board, "events"))) {
      const id = str(at(e, "id"));
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const event = makeEvent(e, sport, path, now);
      if (event) events.push(event);
    }
  }
  return events;
}

/** One scoreboard event, or null when it lacks a date or either side. */
export function makeEvent(e: JSONValue, sport: Sport, path: string, now: number): ScoreEvent | null {
  const id = str(at(e, "id"));
  const start = parseDate(str(at(e, "date")));
  const competition = at(e, "competitions", 0);
  const comps = arr(at(competition, "competitors"));
  const home = comps.find((c) => str(at(c, "homeAway")) === "home");
  const away = comps.find((c) => str(at(c, "homeAway")) === "away");
  if (!id || start == null || !home || !away) return null;

  const statusType = at(e, "status", "type");
  const rawState = str(at(statusType, "state"));
  const state = rawState === "in" ? "live" : rawState === "post" ? "final" : "scheduled";
  const completed = bool(at(statusType, "completed"));
  const statusName = str(at(statusType, "name"));
  const shortDetail = str(at(statusType, "shortDetail"));

  // Postponed and cancelled games come back "post" but not completed, with
  // 0–0 placeholder scores: show them without a score. A suspended game is
  // "post" and not completed too, but its score is real: it resumes from there.
  const played = state !== "final" || completed !== false || statusName === "STATUS_SUSPENDED";

  const homeScore = intScore(at(home, "score"));
  const awayScore = intScore(at(away, "score"));

  // The winner follows the score on the pitch: ESPN's `winner` follows a
  // two-legged tie or a friendly's bonus shootout (specs/results.md §1.1).
  const won = (c: JSONValue): boolean => {
    if (state !== "final" || completed === false || homeScore == null || awayScore == null || homeScore === awayScore) {
      return bool(at(c, "winner")) ?? false;
    }
    return str(at(c, "homeAway")) === "home" ? homeScore > awayScore : awayScore > homeScore;
  };

  const competitor = (c: JSONValue): Competitor => {
    const team = at(c, "team");
    const name = str(at(team, "shortDisplayName")) ?? str(at(team, "displayName")) ?? "TBD";
    const teamID = str(at(team, "id"));
    const rank = int(at(c, "curatedRank", "current"));
    const records = arr(at(c, "records"));
    const record = (type: string) => {
      const summary = str(at(records.find((r) => str(at(r, "type")) === type), "summary"));
      // One dash style everywhere: "7–1", as team pages and schedules show it.
      return summary ? enDash(summary) : null;
    };
    return {
      id: teamID ? espnTeamID(path, sport, teamID) : null,
      name,
      abbreviation: str(at(team, "abbreviation")) ?? name.slice(0, 3).toUpperCase(),
      score: state === "scheduled" || !played ? null : (str(at(c, "score")) ?? null),
      logo: str(at(team, "logo")) ?? null,
      isWinner: won(c),
      color: str(at(team, "color")) ?? null,
      // ESPN uses 99 for unranked.
      rank: rank != null && rank >= 1 && rank <= 25 ? rank : null,
      record: record("total"),
      conferenceRecord: record("vsconf"),
      alternateColor: str(at(team, "alternateColor")) ?? null,
    };
  };

  // Soccer lists the home side first; North American sports list away first.
  const content: Content =
    sport === "soccer"
      ? { kind: "match", top: competitor(home), bottom: competitor(away) }
      : { kind: "match", top: competitor(away), bottom: competitor(home) };

  const links = arr(at(e, "links"));
  const link =
    str(at(links.find((l) => arr(at(l, "rel")).includes("summary")), "href")) ?? str(at(links[0], "href")) ?? null;

  const situation = at(competition, "situation");
  const snapshot = state === "live" ? liveSnapshot(competition, sport, home, away, content) : null;

  // Sports whose clock means something to read: soccer counts up, the rest
  // count down. Baseball has innings, not a clock.
  let clock: GameClock | null = null;
  const seconds = num(at(e, "status", "clock"));
  const period = int(at(e, "status", "period"));
  if (state === "live" && seconds != null && period != null && shortDetail && (sport === "soccer" || sport === "football" || sport === "basketball")) {
    clock = {
      seconds,
      sampledAt: now,
      period,
      direction: sport === "soccer" ? "up" : "down",
      display: shortDetail,
      running: sport === "soccer" && shortDetail.includes("'"),
    };
  }

  // Postseason games say where they are: "World Series · Game 2 · MIL leads
  // 2–0"; college games carry their bowl, title game or rivalry name; NBA
  // games their NBA Cup or play-in round ("NBA Cup · Group Play").
  let caption: string | null = null;
  const postseason = str(at(e, "season", "slug")) === "post-season";
  const headline = text(at(competition, "notes", 0, "headline"));
  if ((postseason || path.endsWith("college-football") || path === NBA_PATH) && headline) {
    // ESPN attaches a later playoff series to regular-season meetings of the
    // same teams: a series line belongs to the postseason only.
    const series = postseason ? str(at(competition, "series", "summary")) : undefined;
    caption = [headline.replaceAll(" - ", " · "), series ? shortSeriesSummary(series) : null].filter(Boolean).join(" · ");
  }

  return {
    id: `espn-${id}`,
    content,
    state,
    start,
    // A delayed start stays "pre" for hours: say so, rather than a start time that has passed.
    detail: state === "scheduled" && statusName === "STATUS_DELAYED" ? "Delayed" : shortDetail === "FT-Pens" ? "Pens" : (shortDetail ?? null),
    caption,
    link,
    ref: { kind: "espn", path, id, sport },
    stage: str(at(e, "season", "slug")) ?? null,
    clock,
    possession: state === "live" ? possessionID(situation, path, sport) : null,
    liveLine: state === "live" ? situationLine(situation, sport, path) : null,
    liveLineRoutine: state === "live" && path === NBA_PATH && situationIsRoutine(situation),
    broadcast: broadcastLine(at(competition, "broadcasts")),
    venue: str(at(competition, "venue", "fullName")) ?? null,
    snapshot,
  };
}

// MARK: - Pieces

/** ISO 8601 with or without seconds/fraction ("2026-10-26T17:00Z"). */
export function parseDate(value: string | undefined): number | null {
  if (!value) return null;
  // "2026-10-26T17:00Z" (no seconds) isn't ISO enough for every engine: add them.
  const normalized = /T\d{2}:\d{2}Z$/.test(value) ? value.replace("Z", ":00Z") : value.replace(" UTC", "Z").replace(" ", "T");
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : ms;
}

function intScore(value: JSONValue): number | null {
  const s = str(value);
  if (s == null || !/^-?\d+$/.test(s)) return null;
  return Number(s);
}

/** "MIL leads series 2-0" → "MIL leads 2–0" (Brackets.swift `MLBPostseason.shortSummary`). */
export function shortSeriesSummary(summary: string): string {
  return summary.replaceAll(" series", "").replaceAll("-", "–");
}

function possessionID(situation: JSONValue, path: string, sport: Sport): string | null {
  const team = str(at(situation, "possession"));
  return team ? espnTeamID(path, sport, team) : null;
}

/**
 * Where to watch: national networks (up to two); without one, just the first
 * listed (usually the league's own pass), never a string of regional feeds.
 */
function broadcastLine(broadcasts: JSONValue): string | null {
  const list = arr(broadcasts);
  if (list.length === 0) return null;
  const national = list.filter((b) => str(at(b, "market")) === "national").flatMap((b) => arr(at(b, "names")).flatMap((n) => str(n) ?? []));
  const all = list.flatMap((b) => arr(at(b, "names")).flatMap((n) => str(n) ?? []));
  const names = national.length > 0 ? national.slice(0, 2) : all.slice(0, 1);
  const line = names.map((n) => broadcaster(n).name).join(" · ");
  return line || null;
}

// MARK: - The live situation line (Providers.swift `Situation.line`)

/** Between snaps there's no down: say what just happened instead, so the line (and the row's height) holds steady. */
const BETWEEN_SNAPS: Readonly<Record<string, string>> = {
  "Field Goal Good": "Field goal",
  "Field Goal Missed": "Field goal missed",
  Kickoff: "Kickoff",
  "Extra Point Good": "Extra point",
  "Official Timeout": "Timeout",
  Timeout: "Timeout",
  "Two-minute warning": "Two-minute warning",
  Punt: "Punt",
  Safety: "Safety",
};
/** Breaks the status already says ("Halftime", "End of 3rd"): no line, rather than the same words twice. */
const BREAKS = new Set(["End Period", "End of Half"]);

export function situationLine(situation: JSONValue, sport: Sport, path: string): string | null {
  if (situation == null) return null;
  switch (sport) {
    case "basketball": {
      // NBA only: the last play, shortened ("L. Doncic makes 26-ft three point jumper").
      const lastText = text(at(situation, "lastPlay", "text"));
      if (path !== NBA_PATH || !lastText) return null;
      return nbaListLine(lastText, lastPlayNames(situation));
    }
    case "football": {
      const downDistance = text(at(situation, "downDistanceText"));
      if (downDistance) return downDistance;
      const type = text(at(situation, "lastPlay", "type", "text"));
      if (!type || BREAKS.has(type)) return null;
      return BETWEEN_SNAPS[type] ?? (type.toLowerCase().includes("touchdown") ? "Touchdown" : type);
    }
    case "baseball": {
      const outs = int(at(situation, "outs"));
      if (outs == null) return null;
      const parts = [outs === 1 ? "1 out" : `${outs} outs`];
      const balls = int(at(situation, "balls"));
      const strikes = int(at(situation, "strikes"));
      if (balls != null && strikes != null) parts.push(`${balls}–${strikes}`);
      const bases = (
        [
          [bool(at(situation, "onFirst")), "1st"],
          [bool(at(situation, "onSecond")), "2nd"],
          [bool(at(situation, "onThird")), "3rd"],
        ] as const
      )
        .filter(([on]) => on === true)
        .map(([, name]) => name);
      if (bases.length === 3) parts.push("Bases loaded");
      else if (bases.length === 2) parts.push(`Runners on ${bases[0]} & ${bases[1]}`);
      else if (bases.length === 1) parts.push(`Runner on ${bases[0]}`);
      return parts.join(" · ");
    }
    default:
      return null;
  }
}

function lastPlayNames(situation: JSONValue): { full: string; short: string }[] {
  return arr(at(situation, "lastPlay", "athletesInvolved")).flatMap((a) => {
    const full = str(at(a, "fullName")) ?? str(at(a, "displayName"));
    const short = str(at(a, "shortName"));
    return full && short ? [{ full, short }] : [];
  });
}

/**
 * NBA plays that say little on their own (rebounds, timeouts, substitutions,
 * reviews, period ends): the row keeps the line before (Basketball.swift `isNotable`).
 */
export function situationIsRoutine(situation: JSONValue): boolean {
  const rawType = str(at(situation, "lastPlay", "type", "id"));
  const type = rawType != null && /^\d+$/.test(rawType) ? Number(rawType) : null;
  return !nbaIsNotable(type, int(at(situation, "lastPlay", "scoreValue")) ?? null);
}

export function nbaIsNotable(type: number | null, scoreValue: number | null): boolean {
  if ((scoreValue ?? 0) > 0) return true;
  if (type == null) return true;
  const fouls = new Set([22, 24, 29, 30, 31, 32, 33, 35, 40, 42, 43, 44, 45, 48]);
  return (type >= 91 && type <= 153) || type === 282 || (type >= 61 && type <= 90) || fouls.has(type) || type === 9 || type === 517;
}

/** Tidied ESPN play text (Basketball.swift `NBADetail.plain`): whitespace collapsed, a trailing assist dropped. */
function nbaPlain(raw: string): string {
  let s = raw.split(/\s+/).filter(Boolean).join(" ");
  const open = s.lastIndexOf(" (");
  if (open >= 0 && s.endsWith(")") && s.slice(open + 2).includes("assist")) s = s.slice(0, open);
  return s.replaceAll(" 's ", "'s ");
}

/** The scores list's NBA line (Basketball.swift `NBADetail.listLine`). */
export function nbaListLine(raw: string, names: readonly { full: string; short: string }[] = []): string {
  let s = nbaPlain(raw);
  // "End of the 2nd Quarter" → "End of Q2"; "End of the 1st Overtime" → "End of OT".
  if (s.startsWith("End of the ")) {
    const words = s.slice("End of the ".length).split(" ");
    const number = Number.parseInt(words[0] ?? "", 10);
    const kind = words[words.length - 1] ?? "";
    if (Number.isFinite(number)) {
      return kind.toLowerCase().startsWith("quarter") ? `End of Q${number}` : `End of ${periodLabel(number + 4, "basketball")}`;
    }
  }
  for (const name of names) {
    if (name.full && name.short) s = s.replaceAll(name.full, name.short);
  }
  return s.replaceAll("-foot ", "-ft ").replaceAll(" enters the game for ", " in for ");
}

// MARK: - Live snapshots (Providers.swift `ESPN.liveSnapshot`)

function liveSnapshot(competition: JSONValue, sport: Sport, home: JSONValue, away: JSONValue, content: Content): LiveSnapshot | null {
  if (competition == null) return null;
  // Soccer lists home first (top); the other sports list away first.
  const topIsHome = sport === "soccer";
  const situation = at(competition, "situation");
  const homeID = str(at(home, "team", "id"));
  const awayID = str(at(away, "team", "id"));
  switch (sport) {
    case "football": {
      const yardLine = num(at(situation, "yardLine"));
      if (yardLine == null) return null;
      const possessionTeam = str(at(situation, "possession"));
      const possession: Side | null =
        possessionTeam == null ? null : possessionTeam === homeID ? (topIsHome ? "top" : "bottom") : possessionTeam === awayID ? (topIsHome ? "bottom" : "top") : null;
      return {
        kind: "football",
        spot: footballSpot(yardLine, int(at(situation, "down")) ?? null, int(at(situation, "distance")) ?? null, possession, topIsHome, bool(at(situation, "isRedZone")) ?? false),
      };
    }
    case "baseball": {
      const outs = int(at(situation, "outs"));
      if (outs == null) return null;
      const participant = (key: string) => str(at(situation, key, "athlete", "shortName")) ?? str(at(situation, key, "athlete", "displayName")) ?? null;
      const bases: BaseState = {
        onFirst: bool(at(situation, "onFirst")) ?? false,
        onSecond: bool(at(situation, "onSecond")) ?? false,
        onThird: bool(at(situation, "onThird")) ?? false,
        balls: int(at(situation, "balls")) ?? 0,
        strikes: int(at(situation, "strikes")) ?? 0,
        outs,
        batter: participant("batter"),
        pitcher: participant("pitcher"),
      };
      return { kind: "baseball", bases };
    }
    case "soccer": {
      const details = at(competition, "details");
      if (!Array.isArray(details)) return null;
      const marks = details
        .flatMap((d) => soccerMark(d, homeID ?? null, awayID ?? null, topIsHome) ?? [])
        .sort((a, b) => a.minute - b.minute);
      if (content.kind !== "match") return { kind: "soccer", marks };
      return { kind: "soccer", marks: reconcileMarks(marks, intOrNull(content.top.score), intOrNull(content.bottom.score)) };
    }
    case "basketball":
      return { kind: "basketball", lastPlay: str(at(situation, "lastPlay", "text")) ?? null };
    default:
      return null;
  }
}

function intOrNull(score: string | null): number | null {
  if (score == null || !/^\d+$/.test(score)) return null;
  return Number(score);
}

/** A goal or red card on the scoreboard as a timeline mark; null for anything else (Providers.swift `Detail.mark`). */
function soccerMark(d: JSONValue, homeID: string | null, awayID: string | null, topIsHome: boolean): MatchMark | null {
  let kind: MatchMark["kind"];
  if (bool(at(d, "redCard")) === true) kind = "redCard";
  else if (bool(at(d, "scoringPlay")) === true) kind = bool(at(d, "ownGoal")) === true ? "ownGoal" : bool(at(d, "penaltyKick")) === true ? "penalty" : "goal";
  else return null;
  const display = str(at(d, "clock", "displayValue")) ?? "";
  const value = num(at(d, "clock", "value"));
  const minute = markMinute(display) ?? (value != null ? value / 60 : null);
  if (minute == null) return null;
  const team = str(at(d, "team", "id"));
  const isHome = team != null && team === homeID;
  const isAway = team != null && team === awayID;
  const side: Side | null = isHome ? (topIsHome ? "top" : "bottom") : isAway ? (topIsHome ? "bottom" : "top") : null;
  // A goal or card for neither team can't be placed in a lane.
  if (side == null && kind !== "ownGoal") return null;
  const athlete = at(d, "athletesInvolved", 0);
  return { kind, minute, side, player: str(at(athlete, "shortName")) ?? str(at(athlete, "displayName")) ?? null, clock: display };
}

// MARK: - Football geometry (LiveSnapshot.swift `FootballGeometry`)

/** ESPN counts yard lines from the home goal line; x runs from the top team's. */
export function footballX(yardLine: number, topIsHome: boolean): number {
  return topIsHome ? yardLine : 100 - yardLine;
}

export function footballSpot(yardLine: number, down: number | null, distance: number | null, possession: Side | null, topIsHome: boolean, redZone: boolean): FootballSpot {
  const ballX = footballX(yardLine, topIsHome);
  let lineToGainX: number | null = null;
  let goalToGo = false;
  if (down != null && down >= 1 && down <= 4 && distance != null && possession != null) {
    const homeHasBall = (possession === "top") === topIsHome;
    const toEndzone = homeHasBall ? 100 - yardLine : yardLine;
    goalToGo = Math.trunc(toEndzone) <= distance;
    lineToGainX = goalToGo ? null : possession === "bottom" ? Math.max(ballX - distance, 0) : Math.min(ballX + distance, 100);
  }
  return { ballX, lineToGainX, possession, redZone, down, distance, goalToGo };
}
