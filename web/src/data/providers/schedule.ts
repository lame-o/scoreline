/**
 * Where schedules come from (ScheduleProvider.swift, the ESPN and bo3.gg
 * match parts; the IFSC and tournament parts live in `data/seasons.ts`).
 * Every parser is a pure function over a response, so tests replay
 * recordings through them directly; fetching takes a `Fetcher`.
 *
 * ESPN quirks kept from the Swift comments: there's no date range (every
 * `dates=A-B` answers 400), so windows are a day, a month (soccer, with
 * `limit=500`), a football week, or the undated board (the season calendar);
 * college asks for every FBS game (`groups=80`); games without a time are
 * listed on their Eastern day.
 */
import { broadcaster } from "../broadcasters";
import { addingDays, compactDay, compareDays, dayKeyFromISO, dayKeyIn, dayKeyOf, daysBetween, mediumDayLabel, offsetFrom, type DayKey } from "../days";
import { enDash } from "../format";
import { arr, at, bool, int, str, type JSONValue } from "../json";
import { leagueWithID, CATALOG } from "../leagues";
import type { Sport } from "../models";
import { espnTeamID } from "../teams";
import { parseDate } from "./espn";
import { abbreviate, TIER } from "./counterStrike";
import { EASTERN, isAwarded, parseESPNResult, settle, shortSeriesSummary } from "../results";
import { scheduleItem, scheduleTeam, type CalendarWeek, type ScheduleCalendar, type ScheduleItem, type ScheduleStatus, type ScheduleTeam, type StartTime } from "../schedule";

export const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const DAY = 86_400_000;

/** What a scoreboard request covers. There's deliberately no range. */
export type BoardWindow =
  | { readonly kind: "day"; readonly day: DayKey }
  | { readonly kind: "month"; readonly year: number; readonly month: number }
  | { readonly kind: "week"; readonly number: number; readonly seasonType: number }
  | { readonly kind: "undated" };

export const windowKey = (w: BoardWindow): string =>
  w.kind === "day" ? `d:${compactDay(w.day)}` : w.kind === "month" ? `m:${w.year}-${w.month}` : w.kind === "week" ? `w:${w.seasonType}-${w.number}` : "u";

/** Soccer leagues whose far-off kickoffs are placeholders until the TV picks. */
export const PROVISIONAL_LEAGUES = new Set(["eng.1", "eng.2"]);
export const PROVISIONAL_HORIZON = 42 * DAY;

export function scoreboardURL(path: string, window: BoardWindow): string {
  const items: string[] = [];
  switch (window.kind) {
    case "day":
      items.push(`dates=${compactDay(window.day)}`);
      break;
    case "month":
      items.push(`dates=${window.year}${String(window.month).padStart(2, "0")}`, "limit=500");
      break;
    case "week":
      items.push(`week=${window.number}`, `seasontype=${window.seasonType}`);
      break;
  }
  // College: every FBS game, as the scores list fetches them.
  if (path.endsWith("college-football")) items.push("groups=80");
  return `${ESPN_BASE}/${path}/scoreboard${items.length ? `?${items.join("&")}` : ""}`;
}

/**
 * A team's season. Soccer: `soccer/all` covers every competition, and only
 * `fixture=true` returns what's still to come. `seasonType` without a season
 * asks for that part of the current season (the postseason's default
 * schedule leaves the regular season out).
 */
export function teamScheduleURL(path: string, team: string, options: { fixtures?: boolean; season?: number | null; seasonType?: number | null } = {}): string {
  const items: string[] = [];
  if (options.fixtures) items.push("fixture=true");
  if (options.season != null) items.push(`season=${options.season}`);
  if (options.seasonType != null) items.push(`seasontype=${options.seasonType}`);
  return `${ESPN_BASE}/${path}/teams/${encodeURIComponent(team)}/schedule${items.length ? `?${items.join("&")}` : ""}`;
}

/**
 * The Eastern day boards covering the viewer's days `from…to`. Games are
 * listed on Eastern days, so a viewer ahead of New York also needs the
 * evening before, one behind it the day after. Days the league's calendar
 * doesn't list have no games, so they cost no request.
 */
export function boardDays(from: DayKey, to: DayKey, calendar: ScheduleCalendar | null, now = Date.now()): DayKey[] {
  const offset = offsetFrom(EASTERN, now);
  const before = offset > 0 ? -1 : 0;
  const after = offset < 0 ? 1 : 0;
  const days: DayKey[] = [];
  for (let i = before; i <= daysBetween(from, to) + after; i++) days.push(addingDays(from, i));
  // Unknown (no calendar, or one that can't say): ask for the day.
  return days.filter((d) => (calendar ? plays(calendar, d) : null) ?? true);
}

/** Months touching the days from `from` through `to`. */
export function monthWindows(from: DayKey, to: DayKey): BoardWindow[] {
  const out: BoardWindow[] = [];
  let y = from.year;
  let m = from.month;
  while (y < to.year || (y === to.year && m <= to.month)) {
    out.push({ kind: "month", year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

// MARK: - Calendars (ScheduleModels.swift `ScheduleCalendar`)

/** Whether the league plays on `day`, or null when the calendar can't say. */
export function plays(c: ScheduleCalendar, day: DayKey): boolean | null {
  if (c.offDays) {
    if (!c.seasonStart || !c.seasonEnd) return null;
    return compareDays(c.seasonStart, day) <= 0 && compareDays(day, c.seasonEnd) <= 0 && !c.offDays.some((d) => compareDays(d, day) === 0);
  }
  return c.days.length === 0 ? null : c.days.some((d) => compareDays(d, day) === 0);
}

/** Up to `limit` game days from `day` on, or null when the calendar can't say. */
export function gameDays(c: ScheduleCalendar, day: DayKey, limit: number): DayKey[] | null {
  if (c.offDays) {
    if (!c.seasonStart || !c.seasonEnd) return null;
    const off = new Set(c.offDays.map(compactDay));
    const out: DayKey[] = [];
    let d = compareDays(day, c.seasonStart) >= 0 ? day : c.seasonStart;
    while (compareDays(d, c.seasonEnd) <= 0 && out.length < limit) {
      if (!off.has(compactDay(d))) out.push(d);
      d = addingDays(d, 1);
    }
    return out;
  }
  if (c.days.length === 0) return null;
  return c.days.filter((d) => compareDays(d, day) >= 0).slice(0, limit);
}

/** The next game day on or after `day`. */
export function nextGameDay(c: ScheduleCalendar | null, day: DayKey): DayKey | null {
  return (c ? gameDays(c, day, 1)?.[0] : null) ?? null;
}

const weekContains = (w: CalendarWeek, date: number) => w.start <= date && date < w.end;

/** The week containing `date`, else the next one, else the last. */
export function weekAt(c: ScheduleCalendar | null, date: number): CalendarWeek | null {
  const weeks = c?.weeks ?? [];
  return weeks.find((w) => weekContains(w, date)) ?? weeks.find((w) => w.start > date) ?? weeks[weeks.length - 1] ?? null;
}

export function weekAfter(c: ScheduleCalendar | null, week: CalendarWeek): CalendarWeek | null {
  const weeks = c?.weeks ?? [];
  const i = weeks.findIndex((w) => w.number === week.number && w.seasonType === week.seasonType);
  return i >= 0 && i + 1 < weeks.length ? weeks[i + 1]! : null;
}

export function weekBefore(c: ScheduleCalendar | null, week: CalendarWeek): CalendarWeek | null {
  const weeks = c?.weeks ?? [];
  const i = weeks.findIndex((w) => w.number === week.number && w.seasonType === week.seasonType);
  return i > 0 ? weeks[i - 1]! : null;
}

// MARK: - Parsing

export interface TeamSchedule {
  readonly items: ScheduleItem[];
  /** "5–0 · 1st in AFC West" */
  readonly summary: string | null;
  readonly byeWeek: number | null;
  /** The season type ESPN answered with (3: the postseason, whose default schedule leaves the regular season out). */
  readonly seasonType: number | null;
}

export function parseScoreboard(board: JSONValue, path: string, league: string, sport: Sport, now = Date.now()): ScheduleItem[] {
  const week = int(at(board, "week", "number")) ?? null;
  return arr(at(board, "events")).flatMap((e) => scheduleEvent(e, path, league, sport, week, now) ?? []);
}

export function parseTeamSchedule(json: JSONValue, path: string, league: string, sport: Sport, now = Date.now()): TeamSchedule {
  const items = arr(at(json, "events")).flatMap((e) => scheduleEvent(e, path, league, sport, null, now) ?? []);
  const team = at(json, "team");
  const record = str(at(team, "recordSummary"));
  const summary = [record ? enDash(record) : null, str(at(team, "standingSummary")) ?? null].filter((s): s is string => !!s).join(" · ");
  return { items, summary: summary || null, byeWeek: int(at(json, "byeWeek")) ?? null, seasonType: int(at(json, "requestedSeason", "type")) ?? null };
}

/** The scoreboard's season calendar: game days, or weeks. */
export function parseCalendar(json: JSONValue): ScheduleCalendar {
  const league = at(json, "leagues", 0);
  const entries = arr(at(league, "calendar"));
  if (str(at(league, "calendarType")) === "list") {
    const weeks: CalendarWeek[] = [];
    for (const section of entries) {
      const raw = at(section, "value");
      const type = (typeof raw === "string" ? Number.parseInt(raw, 10) : int(raw)) || 2;
      for (const e of arr(at(section, "entries"))) {
        const start = parseDate(str(at(e, "startDate")));
        const end = parseDate(str(at(e, "endDate")));
        if (start == null || end == null) continue;
        const v = at(e, "value");
        weeks.push({
          label: str(at(e, "label")) ?? "",
          detail: str(at(e, "detail")) ?? "",
          number: (typeof v === "string" ? Number.parseInt(v, 10) : int(v)) || 0,
          seasonType: type,
          start,
          end,
        });
      }
    }
    return { days: [], offDays: null, seasonStart: null, seasonEnd: null, weeks };
  }
  // Each date is stamped at US Pacific midnight: only the date part means anything.
  const listed = entries.flatMap((d) => dayKeyFromISO(str(d)) ?? []);
  if (bool(at(league, "calendarIsWhitelist")) === false) {
    // MLB: the days *without* games, between the season's first and last.
    const start = parseDate(str(at(league, "calendarStartDate")));
    const end = parseDate(str(at(league, "calendarEndDate")));
    return {
      days: [],
      offDays: listed,
      seasonStart: start != null ? dayKeyIn(start, "America/Los_Angeles") : null,
      seasonEnd: end != null ? dayKeyIn(end, "America/Los_Angeles") : null,
      weeks: [],
    };
  }
  return { days: listed, offDays: null, seasonStart: null, seasonEnd: null, weeks: [] };
}

/** NFL: the week's byes ("Titans"). */
export function parseByes(json: JSONValue): string[] {
  return arr(at(json, "week", "teamsOnBye")).flatMap((t) => str(at(t, "shortDisplayName")) ?? str(at(t, "displayName")) ?? []);
}

/** One ESPN event (a board's or a team schedule's) as a schedule item. */
export function scheduleEvent(e: JSONValue, path: string, league: string, sport: Sport, week: number | null, now: number): ScheduleItem | null {
  const c = at(e, "competitions", 0);
  const rawID = str(at(e, "id"));
  const date = parseDate(str(at(e, "date")));
  if (!rawID || date == null) return null;
  const comps = arr(at(c, "competitors"));
  const home = comps.find((x) => str(at(x, "homeAway")) === "home");
  const away = comps.find((x) => str(at(x, "homeAway")) === "away");
  if (!home || !away) return null;

  // soccer/all lists every competition: each fixture says which.
  let leagueID = league;
  let competition: string | null = null;
  if (at(e, "league", "slug") !== undefined) {
    const slug = str(at(e, "league", "slug")) ?? league;
    leagueID = leagueWithID(slug)?.id ?? slug;
    const parts = [str(at(e, "league", "abbreviation")) ?? str(at(e, "league", "name"))];
    // Stages read "Fourth Round", "League Phase"; a season label ("2026-27 …") says nothing.
    const stage = str(at(e, "seasonType", "name"));
    if (stage && !stage.includes("20")) parts.push(stage);
    competition = parts.filter(Boolean).join(" · ") || null;
  }

  const timeValid = bool(at(c, "timeValid")) ?? bool(at(e, "timeValid")) ?? true;
  const soccer = sport === "soccer";
  const day = timeValid ? dayKeyOf(date) : dayKeyIn(date, EASTERN);
  let start: StartTime;
  if (!timeValid) start = soccer ? { kind: "tbc" } : { kind: "tba" };
  else if (PROVISIONAL_LEAGUES.has(leagueID) && date - now > PROVISIONAL_HORIZON) start = { kind: "provisional", date, why: "tvPicks" };
  else start = { kind: "exact", date };

  const type = at(c, "status", "type") !== undefined ? at(c, "status", "type") : at(e, "status", "type");
  const name = str(at(type, "name")) ?? "";
  const state = str(at(type, "state"));
  let status: ScheduleStatus;
  if (state === "in") status = "live";
  else if (name === "STATUS_POSTPONED") status = "postponed";
  else if (name === "STATUS_CANCELED" || name === "STATUS_CANCELLED") status = "canceled";
  // Results whatever `completed` says: the score at the time, or awarded.
  else if (name === "STATUS_ABANDONED" || isAwarded(name)) status = "final";
  // Suspended: not completed, but the score stands (it resumes from there).
  else if (state === "post") status = bool(at(type, "completed")) === false && name !== "STATUS_SUSPENDED" ? "postponed" : "final";
  else status = "scheduled";

  const team = (comp: JSONValue): ScheduleTeam => {
    const t = at(comp, "team");
    const display = str(at(t, "shortDisplayName")) ?? str(at(t, "displayName")) ?? "TBD";
    const logo = str(at(t, "logo")) ?? str(at(t, "logos", 0, "href")) ?? null;
    const score = str(at(comp, "score")) ?? str(at(comp, "score", "displayValue")) ?? null;
    const record =
      str(at(arr(at(comp, "records")).find((r) => str(at(r, "type")) === "total"), "summary")) ??
      str(at(arr(at(comp, "record")).find((r) => str(at(r, "type")) === "total"), "displayValue")) ??
      null;
    const id = str(at(t, "id"));
    const rank = int(at(comp, "curatedRank", "current"));
    return scheduleTeam({
      id: id ? espnTeamID(path, sport, id) : null,
      name: display,
      abbreviation: str(at(t, "abbreviation")) ?? display.slice(0, 3).toUpperCase(),
      logo,
      record: record ? enDash(record) : null,
      rank: rank != null && rank >= 1 && rank <= 25 ? rank : null,
      score: status === "live" || status === "final" ? score : null,
      winner: bool(at(comp, "winner")) ?? false,
    });
  };

  // Notes, rewritten; the MLB postseason adds the series standing.
  const headlines = arr(at(c, "notes")).flatMap((n) => str(at(n, "headline")) || []);
  const ifNecessary = headlines.some((h) => h.toLowerCase().includes("if necessary"));
  const notes = headlines.map((h) => caption(h, date));
  const postseason = str(at(e, "season", "slug")) === "post-season" || int(at(e, "seasonType", "type")) === 3;
  const series = str(at(c, "series", "summary"));
  if (postseason && status !== "postponed" && status !== "canceled" && series && notes.length > 0) {
    notes[notes.length - 1] += ` · ${shortSeriesSummary(series)}`;
  }

  const venueName = str(at(c, "venue", "fullName")) ?? null;
  const city = str(at(c, "venue", "address", "city")) ?? null;
  const venue = [venueName, city && !(venueName ?? "").toLowerCase().includes(city.toLowerCase()) ? city : null].filter(Boolean).join(" · ");

  const links = arr(at(e, "links"));
  const link = str(at(links.find((l) => arr(at(l, "rel")).includes("summary")), "href")) ?? str(at(links[0], "href")) ?? null;

  // Results: scorers, decisions, performers, context; the winner follows the score on the pitch, not ESPN's tie winner.
  const topJSON = soccer ? home : away;
  const bottomJSON = soccer ? away : home;
  const result = parseESPNResult(e, c, sport, topJSON, bottomJSON, status, notes);
  const [top, bottom] = settle(team(topJSON), team(bottomJSON), result);

  return scheduleItem({
    id: `espn-${rawID}`,
    sport,
    league: leagueID,
    competition,
    day,
    start,
    status,
    statusDetail: status === "live" || status === "final" ? (str(at(type, "shortDetail")) ?? null) : null,
    top,
    bottom,
    venue: venue || null,
    networks: networks(c),
    notes,
    ifNecessary,
    week: week ?? int(at(e, "week", "number")) ?? null,
    link,
    ref: { kind: "espn", path, id: rawID },
    result,
  });
}

/** National networks first (up to three), from either response shape. */
export function networks(c: JSONValue): string[] {
  const national: string[] = [];
  const other: string[] = [];
  for (const b of arr(at(c, "broadcasts"))) {
    if (at(b, "names") !== undefined) {
      // Scoreboard: {market: "national", names: […]}
      const names = arr(at(b, "names")).flatMap((n) => str(n) ?? []);
      (str(at(b, "market")) === "national" ? national : other).push(...names);
    } else {
      const name = str(at(b, "media", "shortName"));
      if (!name) continue;
      // Team schedule: {market: {type: "National"}, media: {shortName}}
      const market = str(at(b, "market", "type"))?.toLowerCase();
      (market == null || market === "national" ? national : other).push(name);
    }
  }
  const names = national.length === 0 ? other.slice(0, 1) : national;
  const seen = new Set<string>();
  return names
    .map((n) => broadcaster(n).name)
    .filter((n) => !seen.has(n) && seen.add(n))
    .slice(0, 3);
}

/**
 * ESPN's notes, in the app's voice:
 * "World Series - Game 5 If Necessary" → "World Series · Game 5 · If necessary";
 * "ALCS - Game 4 Rain - Makeup on Oct 18" → "ALCS · Game 4 · Rain, makeup Oct 18";
 * "Flex Game: 1/2 or 1/3" → "Flex game: Sat, Jan 2 or Sun, Jan 3".
 */
export function caption(headline: string, near: number): string {
  if (headline.startsWith("Flex Game:")) {
    const days = headline
      .slice("Flex Game:".length)
      .split(" or ")
      .flatMap((t) => flexDay(t, near) ?? []);
    return days.length === 0 ? "Flex game" : `Flex game: ${days.join(" or ")}`;
  }
  let text = headline;
  const makeup = /(\w+) - Makeup on (.+)$/.exec(text);
  if (makeup) text = `${text.slice(0, makeup.index)}· ${makeup[1]}, makeup ${makeup[2]}`;
  text = text.replace(/ If Necessary/i, " · If necessary");
  return text.replaceAll(" - ", " · ");
}

/** "1/2" near a January date → "Sat, Jan 2". */
function flexDay(text: string, near: number): string | null {
  const parts = text
    .trim()
    .split("/")
    .map((p) => Number.parseInt(p, 10));
  if (parts.length !== 2 || parts.some((p) => Number.isNaN(p))) return null;
  const anchor = dayKeyIn(near, EASTERN);
  // The year that puts the date closest to the game's listed date.
  const candidates = [anchor.year - 1, anchor.year, anchor.year + 1].map((year) => ({ year, month: parts[0]!, day: parts[1]! }));
  const best = candidates.reduce((a, b) => (Math.abs(daysBetween(anchor, a)) <= Math.abs(daysBetween(anchor, b)) ? a : b));
  return mediumDayLabel(best);
}

/** The league a followed team's ID belongs to, and its ESPN path. */
export function teamSource(id: string): { path: string; league: string; sport: Sport; team: string } | null {
  const prefixes: readonly [string, string, string, Sport][] = [
    ["espn-ncaaf-", "football/college-football", "college-football", "football"],
    ["espn-football-", "football/nfl", "nfl", "football"],
    ["espn-baseball-", "baseball/mlb", "mlb", "baseball"],
    ["espn-basketball-", "basketball/nba", "nba", "basketball"],
    ["espn-soccer-", "soccer/all", "soccer", "soccer"],
  ];
  for (const [prefix, path, league, sport] of prefixes) {
    if (id.startsWith(prefix)) return { path, league, sport, team: id.slice(prefix.length) };
  }
  return null;
}

/** A league in the catalog for a schedule item's league ID, or its sport's first league (cross-competition fixtures). */
export function groupLeague(item: ScheduleItem): string {
  return leagueWithID(item.league) ? item.league : (CATALOG.find((l) => l.sport === item.sport)?.id ?? item.league);
}

// MARK: - bo3.gg matches (CS2)

export const BO3_API = "https://api.bo3.gg/api/v1";

/** Rounds an instant down to the hour, so a time-windowed query is cacheable (ARCHITECTURE.md § the allowlist). */
export function hourFloor(ms: number): number {
  return Math.floor(ms / 3_600_000) * 3_600_000;
}

/** Matches between two instants (the All scope's week), rounded to the hour. */
export function csMatchesURL(from: number, to: number): string {
  const params = new URLSearchParams({
    "filter[matches.discipline_id][eq]": "1",
    "filter[matches.status][in]": "upcoming,current,finished",
    "filter[matches.tier][in]": TIER,
    "filter[matches.start_date][gte]": new Date(hourFloor(from)).toISOString().replace(".000Z", "Z"),
    "filter[matches.start_date][lte]": new Date(hourFloor(to)).toISOString().replace(".000Z", "Z"),
    sort: "start_date",
    "page[limit]": "100",
    with: "teams,tournament",
  });
  return `${BO3_API}/matches?${params}`;
}

/** Upcoming and live matches for several teams at once (either side). */
export function csTeamMatchesURL(teamIDs: readonly number[]): string {
  const params = new URLSearchParams({
    "filter[matches.discipline_id][eq]": "1",
    "filter[matches.status][in]": "upcoming,current",
    "filter[matches.team_ids][overlap]": [...teamIDs].sort((a, b) => a - b).join(","),
    "filter[matches.tier][in]": TIER,
    sort: "start_date",
    "page[limit]": "30",
    with: "teams,tournament",
  });
  return `${BO3_API}/matches?${params}`;
}

/** bo3.gg match lists as schedule items (ScheduleProvider.CS.parseMatches). */
export function parseCSMatches(json: JSONValue, now = Date.now()): ScheduleItem[] {
  const matches = arr(at(json, "results"));
  // Placeholder order of play: four or more matches of one tournament listed
  // at the same minute, more than two days out.
  const sameMinute = new Map<string, number>();
  const key = (m: JSONValue) => `${int(at(m, "tournament_id")) ?? 0}|${str(at(m, "start_date")) ?? ""}`;
  for (const m of matches) if (str(at(m, "status")) === "upcoming") sameMinute.set(key(m), (sameMinute.get(key(m)) ?? 0) + 1);
  return matches.flatMap((m): ScheduleItem[] => {
    const id = int(at(m, "id"));
    const date = parseDate(str(at(m, "start_date")));
    if (id == null || date == null || (at(m, "team1", "id") === undefined && at(m, "team2", "id") === undefined)) return [];
    const raw = str(at(m, "status"));
    const status: ScheduleStatus = raw === "current" ? "live" : raw === "finished" || raw === "defwin" ? "final" : raw === "canceled" ? "canceled" : raw === "postponed" ? "postponed" : "scheduled";
    const placeholder = (sameMinute.get(key(m)) ?? 0) >= 4 && date - now > 2 * DAY;
    const team = (k: string, scoreKey: string): ScheduleTeam => {
      const t = at(m, k);
      const name = str(at(t, "name")) ?? "TBD";
      const teamID = int(at(t, "id"));
      return scheduleTeam({
        id: teamID != null ? `cs-${teamID}` : null,
        name,
        abbreviation: abbreviate(name),
        logo: str(at(t, "image_url")) ?? null,
        score: status === "live" || status === "final" ? String(int(at(m, scoreKey)) ?? 0) : null,
        winner: teamID != null && teamID === int(at(m, "winner_team_id")),
      });
    };
    const tournament = str(at(m, "tournament", "name")) ?? null;
    const slug = str(at(m, "slug"));
    const bo = int(at(m, "bo_type"));
    return [
      scheduleItem({
        id: `cs-${id}`,
        sport: "esports",
        league: "cs2",
        competition: tournament,
        day: dayKeyOf(date),
        start: placeholder ? { kind: "provisional", date, why: "orderOfPlay" } : { kind: "exact", date },
        status,
        statusDetail: raw === "defwin" ? "Forfeit" : status === "final" ? "Final" : null,
        top: team("team1", "team1_score"),
        bottom: team("team2", "team2_score"),
        format: bo != null ? `Best of ${bo}` : null,
        link: slug ? `https://bo3.gg/matches/${slug}` : null,
        ref: { kind: "counterStrike", slug: slug ?? String(id), tournament },
      }),
    ];
  });
}
