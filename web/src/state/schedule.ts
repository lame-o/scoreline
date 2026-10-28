/**
 * Schedules and results as the pages hold them (ScheduleStore.swift,
 * ResultsStore.swift): every board, calendar and team schedule goes through
 * TanStack Query, keyed by its upstream window, with the freshness its day
 * deserves (results more than 48 hours old are final: 30 days; the coming
 * week: 30 minutes; further out: 6 hours). One fetch serves Upcoming and
 * Results, and a step back to a round already loaded is instant. Nothing
 * here polls: live state comes from the scores list (same event IDs), read
 * by the rows.
 *
 * Per-page session state (the week shown, the round picked, the days folded
 * by hand, Show All Games) lives in `scheduleSession`, so Back lands where
 * you were, as on the Mac.
 */
import { useSyncExternalStore } from "react";
import { addingDays, compareDays, dayID, dayKeyIn, dayKeyOf, daysBetween, startOfDay, type DayKey } from "../data/days";
import { getJSON } from "../data/http";
import { leagueWithID } from "../data/leagues";
import type { League } from "../data/models";
import { collapseTournamentDays, filterItems, freshness } from "../data/agenda";
import {
  boardDays,
  csMatchesURL,
  csTeamMatchesURL,
  gameDays,
  monthWindows,
  parseByes,
  parseCalendar,
  parseCSMatches,
  parseScoreboard,
  parseTeamSchedule,
  scoreboardURL,
  teamScheduleURL,
  teamSource,
  weekAfter,
  weekAt,
  windowKey,
  type BoardWindow,
  type TeamSchedule,
} from "../data/providers/schedule";
import {
  boardDay,
  calendarRounds,
  counterStrikeResult,
  CS_HISTORY_PAGE,
  csHistoryURL,
  currentSeasonYear,
  dayRound,
  EASTERN,
  isFriendly,
  latestRound,
  pastGameDays,
  roundsLayout,
  roundSummary,
  seasonLabel,
  sortItems,
  summarizeSeason,
  type SeasonChoice,
} from "../data/results";
import { EMPTY_CALENDAR, scopeKey, sortDate, type CalendarWeek, type ResultRound, type ScheduleCalendar, type ScheduleItem, type ScheduleScope, type ScheduleTeamRef, type SeasonEvent, type TeamSeason } from "../data/schedule";
import type { ListPreferences } from "../data/scoreboard";
import { persisted } from "./persist";
import { queryClient } from "./scores";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Results that can no longer change (over more than 48 hours ago). */
export const FINAL_TTL = 30 * DAY;
const CALENDAR_TTL = 12 * HOUR;
const TEAM_TTL = 6 * HOUR;

const todayLocal = () => dayKeyOf(Date.now());
const todayEastern = () => dayKeyIn(Date.now(), EASTERN);

// MARK: - Fetching through the cache

/**
 * A query read through the shared client: a fresh entry answers at once, a
 * stale one refetches. It fails at its first failure (no retries of its own):
 * the page's query answers `ok: false` at once and retries on the ladder
 * (state/retry.ts), asking again only for what failed.
 *
 * Kept on disk across visits (state/persist.ts, ScheduleCache.swift): after
 * a reload a window answers from its last copy at once; one that's stale is
 * then fetched behind it, and the pages reading the cache refresh when it
 * lands (`revalidate`), as the Mac's disk cache revalidates by ETag.
 */
async function cached<T>(queryKey: readonly unknown[], staleTime: number, fn: () => Promise<T>): Promise<T> {
  const had = queryClient.getQueryState(queryKey)?.data !== undefined;
  let fetched = false;
  const persister = schedulePersister(staleTime);
  const data = await queryClient.fetchQuery({
    queryKey,
    queryFn: () => {
      fetched = true;
      return fn();
    },
    staleTime,
    gcTime: Math.max(staleTime, 30 * MINUTE),
    retry: false,
    persister,
  });
  // Answered from disk: its time arrives with the restore (a macrotask later); stale, fetch it again behind the page.
  if (!had && !fetched) {
    setTimeout(() => {
      const state = queryClient.getQueryState(queryKey);
      if (state && Date.now() - state.dataUpdatedAt > staleTime) revalidate(queryKey, fn, persister);
    }, 0);
  }
  return data as T;
}

/** The persisted schedule's version: the module's URL, which a build fingerprints with the parsers' code. */
const SCHEDULE_VERSION = `2:${import.meta.url}`;

/** Kept as long as its freshness says, twice over, between 2 and 30 days. */
function schedulePersister(staleTime: number, refetchOnRestore = false) {
  return persisted({ family: "schedule", version: SCHEDULE_VERSION, maxAge: Math.min(FINAL_TTL, Math.max(2 * DAY, 2 * staleTime)), refetchOnRestore });
}

/** The calendar's entry for a page that reads it directly (useAgenda): restored, it revalidates when stale. */
export const calendarPersister = () => schedulePersister(CALENDAR_TTL, true);

/** The queries that read the schedule cache: they re-read it once a window revalidates. */
const READERS = new Set(["agenda", "results", "nextGames", "footnote"]);
let refresh: ReturnType<typeof setTimeout> | null = null;

/** Fetches a restored, stale window again; when it lands, the pages reading it re-read (once for a burst). */
function revalidate<T>(queryKey: readonly unknown[], fn: () => Promise<T>, persister: ReturnType<typeof schedulePersister>): void {
  void queryClient
    .fetchQuery({ queryKey, queryFn: fn, staleTime: 0, gcTime: 30 * MINUTE, retry: false, persister })
    .then(() => {
      if (refresh) clearTimeout(refresh);
      refresh = setTimeout(() => {
        refresh = null;
        void queryClient.invalidateQueries({ predicate: (q) => READERS.has(String(q.queryKey[0])) });
      }, 50);
    })
    .catch(() => {});
}

export interface Board {
  readonly items: readonly ScheduleItem[];
  readonly byes: readonly string[];
  /** When the board was fetched. */
  readonly fetchedAt: number;
}

/** The query a league's calendar lives under (a hook reading it uses the same key and `loadCalendar`). */
export const calendarKey = (path: string) => ["schedule", "calendar", path] as const;
export const CALENDAR_STALE = CALENDAR_TTL;

/** A league's season calendar, fetched (no cache): the query function behind `calendarKey`. */
export async function loadCalendar(path: string): Promise<ScheduleCalendar> {
  return parseCalendar(await getJSON(scoreboardURL(path, { kind: "undated" })));
}

/** A league's season calendar (from its undated scoreboard), through the cache. */
export function fetchCalendar(path: string): Promise<ScheduleCalendar> {
  return cached(calendarKey(path), CALENDAR_TTL, () => loadCalendar(path));
}

/** How long a board stays fresh. */
function boardTTL(window: BoardWindow, floor = 0): number {
  const today = todayLocal();
  let ttl: number;
  switch (window.kind) {
    case "day":
      ttl = freshness(window.day, today);
      break;
    case "month": {
      const lastDay = addingDays({ year: window.month === 12 ? window.year + 1 : window.year, month: (window.month % 12) + 1, day: 1 }, -1);
      // A month over more than 48 hours ago is all results.
      ttl = compareDays(lastDay, addingDays(today, -2)) < 0 ? FINAL_TTL : freshness(compareDays({ year: window.year, month: window.month, day: 28 }, today) > 0 ? { year: window.year, month: window.month, day: 28 } : today, today);
      break;
    }
    default:
      ttl = 30 * MINUTE;
  }
  return Math.max(ttl, floor);
}

/** One scoreboard window, parsed into schedule items and byes. */
export function fetchBoard(path: string, league: string, window: BoardWindow, floor = 0): Promise<Board> {
  const sport = leagueWithID(league)?.sport ?? sportOfPath(path);
  return cached(["schedule", "board", path, windowKey(window)], boardTTL(window, floor), async () => {
    const json = await getJSON(scoreboardURL(path, window));
    return { items: parseScoreboard(json, path, league, sport), byes: parseByes(json), fetchedAt: Date.now() };
  });
}

function sportOfPath(path: string) {
  const s = path.split("/")[0];
  return s === "soccer" || s === "football" || s === "baseball" || s === "basketball" ? s : "soccer";
}

/** A team's schedule (any of ESPN's shapes). */
function fetchTeamSchedule(url: string, path: string, league: string, ttl: number): Promise<TeamSchedule & { fetchedAt: number }> {
  return cached(["schedule", "team", url], ttl, async () => {
    const json = await getJSON(url);
    return { ...parseTeamSchedule(json, path, league, sportOfPath(path)), fetchedAt: Date.now() };
  });
}

/** bo3.gg matches (a week, or followed teams), 10 minutes fresh. */
function fetchCSMatches(url: string, ttl = 10 * MINUTE): Promise<ScheduleItem[]> {
  return cached(["schedule", "bo3", url], ttl, async () => parseCSMatches(await getJSON(url)));
}

/** Boards in parallel; the ones that answered (one failing day doesn't sink the rest). */
async function boards(path: string, league: string, windows: readonly BoardWindow[], floors: ReadonlyMap<string, number> = new Map()) {
  const settled = await Promise.allSettled(windows.map((w) => fetchBoard(path, league, w, floors.get(windowKey(w)) ?? 0).then((b) => ({ window: w, board: b }))));
  return settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

export interface LeagueFetch {
  readonly items: readonly ScheduleItem[];
  readonly ok: boolean;
  readonly calendar: ScheduleCalendar | null;
  /** Week ID → teams on a bye. */
  readonly byes: Readonly<Record<string, readonly string[]>>;
  /** List scopes: more game days after these. */
  readonly more: boolean;
  /** The oldest response used. */
  readonly fetchedAt: number | null;
  /** NFL/college: the week shown. */
  readonly week: CalendarWeek | null;
}

const EMPTY_FETCH: LeagueFetch = { items: [], ok: true, calendar: null, byes: {}, more: false, fetchedAt: null, week: null };

/**
 * One league's items for the days `from…to`, with the fewest requests the
 * source allows: months (soccer), days (MLB, NBA), weeks (NFL, college).
 * Climbing comes from the season (`climbing`), CS2 folds tournament days.
 */
export async function fetchLeagueWindow(league: League, from: DayKey, to: DayKey, context: { followedCS: ReadonlySet<string>; climbing: readonly SeasonEvent[] | null }, floor = 0): Promise<LeagueFetch> {
  switch (league.source.kind) {
    case "espn": {
      const { path, weekly } = league.source;
      const calendar = await fetchCalendar(path).catch(() => null);
      let windows: BoardWindow[];
      const floors = new Map<string, number>();
      if (weekly) {
        const weeks = (calendar?.weeks ?? []).filter((w) => compareDays(dayKeyOf(w.start), to) <= 0 && compareDays(dayKeyOf(w.end), from) >= 0);
        windows = weeks.map((w): BoardWindow => ({ kind: "week", number: w.number, seasonType: w.seasonType }));
        // A week over more than 48 hours ago is all results.
        for (const w of weeks) if (w.end < Date.now() - 2 * DAY) floors.set(`w:${w.seasonType}-${w.number}`, FINAL_TTL);
        if (windows.length === 0) windows = [{ kind: "undated" }];
      } else if (league.sport === "soccer") {
        windows = monthWindows(addingDays(from, -1), addingDays(to, 1));
      } else {
        // Only the days the league plays, plus the edge day the viewer's zone needs.
        windows = boardDays(from, to, calendar).map((day): BoardWindow => ({ kind: "day", day }));
      }
      if (floor) for (const w of windows) floors.set(windowKey(w), Math.max(floors.get(windowKey(w)) ?? 0, floor));
      const got = await boards(path, league.id, windows, floors);
      const seen = new Set<string>();
      const items: ScheduleItem[] = [];
      const byes: Record<string, readonly string[]> = {};
      for (const { window, board } of got) {
        for (const item of board.items) if (!seen.has(item.id) && seen.add(item.id)) items.push(item);
        if (window.kind === "week" && board.byes.length) byes[`${window.seasonType}-${window.number}`] = board.byes;
      }
      return {
        ...EMPTY_FETCH,
        items,
        ok: got.length > 0 || windows.length === 0,
        calendar,
        byes,
        fetchedAt: got.length ? Math.min(...got.map((g) => g.board.fetchedAt)) : null,
      };
    }
    case "counterStrike": {
      try {
        const matches = await fetchCSMatches(csMatchesURL(startOfDay(from), startOfDay(addingDays(to, 1))), freshness(from, todayLocal()));
        return { ...EMPTY_FETCH, items: collapseTournamentDays(matches.map(counterStrikeResult), context.followedCS), fetchedAt: Date.now() };
      } catch {
        return { ...EMPTY_FETCH, ok: false };
      }
    }
    case "ifsc": {
      if (!context.climbing) return { ...EMPTY_FETCH, ok: false };
      // `climbingItems` needs SeasonEvent detail: the page adds them (they come from the season pages' store).
      return { ...EMPTY_FETCH, items: [] };
    }
  }
}

/** List scopes: a daily league's next `count` game days (from its calendar), as one list. */
export async function fetchLeagueList(league: League, count: number): Promise<LeagueFetch> {
  if (league.source.kind !== "espn") return { ...EMPTY_FETCH, ok: false };
  const { path } = league.source;
  const calendar = await fetchCalendar(path).catch(() => null);
  // Boards are Eastern days; what's shown is the viewer's.
  const boardToday = todayEastern();
  const today = todayLocal();
  // One more than shown, to know whether there's a next page.
  const listed = calendar ? gameDays(calendar, boardToday, count + 1) : null;
  const days = listed ? listed.slice(0, count) : Array.from({ length: count }, (_, i) => addingDays(boardToday, i));
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return { ...EMPTY_FETCH, calendar };
  const windows: BoardWindow[] = league.sport === "soccer" ? monthWindows(first, last) : days.map((day) => ({ kind: "day", day }));
  const got = await boards(path, league.id, windows);
  const seen = new Set<string>();
  const upcoming = got.flatMap((g) => g.board.items).filter((i) => compareDays(i.day, today) >= 0 && !seen.has(i.id) && seen.add(i.id));
  // A month brings more than was asked for: keep the first `count` game days.
  const shownDays = [...new Set(upcoming.map((i) => dayID(i.day)))].sort().slice(0, count);
  const shown = new Set(shownDays);
  return {
    ...EMPTY_FETCH,
    items: upcoming.filter((i) => shown.has(dayID(i.day))),
    ok: got.length > 0,
    calendar,
    more: (listed?.length ?? 0) > count || new Set(upcoming.map((i) => dayID(i.day))).size > count,
    fetchedAt: got.length ? Math.min(...got.map((g) => g.board.fetchedAt)) : null,
  };
}

/**
 * NFL/college: the selected week, defaulting to the current one, or the next
 * once every game of the current week is over (on a Sunday the college board
 * still shows the finished week).
 */
export async function fetchLeagueWeek(league: League, selected: CalendarWeek | null): Promise<LeagueFetch> {
  if (league.source.kind !== "espn") return { ...EMPTY_FETCH, ok: false };
  const { path } = league.source;
  const calendar = await fetchCalendar(path).catch(() => null);
  let week = selected ?? weekAt(calendar, Date.now());
  if (!week) {
    const board = await fetchBoard(path, league.id, { kind: "undated" }).catch(() => null);
    return { ...EMPTY_FETCH, items: board?.items ?? [], ok: board != null, calendar, fetchedAt: board?.fetchedAt ?? null };
  }
  let shown = await fetchBoard(path, league.id, { kind: "week", number: week.number, seasonType: week.seasonType }).catch(() => null);
  if (!selected && shown && shown.items.length > 0 && shown.items.every((i) => i.status === "final")) {
    const next = weekAfter(calendar, week);
    if (next) {
      week = next;
      shown = await fetchBoard(path, league.id, { kind: "week", number: next.number, seasonType: next.seasonType }).catch(() => null);
    }
  }
  return {
    ...EMPTY_FETCH,
    items: shown?.items ?? [],
    ok: shown != null,
    calendar,
    byes: shown?.byes.length ? { [`${week.seasonType}-${week.number}`]: shown.byes } : {},
    fetchedAt: shown?.fetchedAt ?? null,
    week,
  };
}

export interface TeamFetch {
  readonly items: readonly ScheduleItem[];
  readonly ok: boolean;
  readonly summary: string | null;
  readonly fetchedAt: number | null;
}

/** A team's season (ESPN) or upcoming matches (CS2). Soccer: fixtures and results are separate lists. */
export async function fetchTeam(team: ScheduleTeamRef): Promise<TeamFetch> {
  if (team.id.startsWith("cs-")) {
    const id = Number(team.id.slice(3));
    if (!Number.isInteger(id)) return { items: [], ok: false, summary: null, fetchedAt: null };
    try {
      return { items: await fetchCSMatches(csTeamMatchesURL([id])), ok: true, summary: null, fetchedAt: Date.now() };
    } catch {
      return { items: [], ok: false, summary: null, fetchedAt: null };
    }
  }
  const source = teamSource(team.id);
  if (!source) return { items: [], ok: false, summary: null, fetchedAt: null };
  const get = (url: string) => fetchTeamSchedule(url, source.path, source.league, TEAM_TTL).catch(() => null);
  if (source.sport === "soccer") {
    const [upcoming, played] = await Promise.all([get(teamScheduleURL(source.path, source.team, { fixtures: true })), get(teamScheduleURL(source.path, source.team))]);
    if (!upcoming && !played) return { items: [], ok: false, summary: null, fetchedAt: null };
    const items = [...(played?.items ?? []), ...(upcoming?.items ?? [])];
    // The record from the latest league game (cup ties carry none).
    const latest = items.filter((i) => i.status === "final" && leagueWithID(i.league)).sort((a, b) => sortDate(b) - sortDate(a))[0];
    const record = [latest?.top, latest?.bottom].find((t) => t?.id === team.id)?.record ?? null;
    return { items, ok: true, summary: record, fetchedAt: Math.min(...[upcoming, played].flatMap((x) => (x ? [x.fetchedAt] : []))) };
  }
  const main = await get(teamScheduleURL(source.path, source.team));
  if (!main) return { items: [], ok: false, summary: null, fetchedAt: null };
  let items = main.items;
  // In the postseason the default schedule is the postseason alone: add the regular season.
  if (main.seasonType === 3) {
    const regular = await get(teamScheduleURL(source.path, source.team, { seasonType: 2 }));
    if (regular) {
      const seen = new Set<string>();
      items = [...regular.items, ...main.items].filter((i) => !seen.has(i.id) && seen.add(i.id));
    }
  }
  return { items, ok: true, summary: main.summary, fetchedAt: main.fetchedAt };
}

// MARK: - Session state (per page, for Back)

interface Session {
  /** Strip scopes: the first day of the window shown. */
  readonly windowStart: Readonly<Record<string, DayKey>>;
  /** NFL/college: the week shown (week ID). */
  readonly week: Readonly<Record<string, string>>;
  /** Days unfolded or folded by hand; the rest follow `defaultOpen`. */
  readonly openedDays: Readonly<Record<string, readonly string[]>>;
  readonly closedDays: Readonly<Record<string, readonly string[]>>;
  /** Lifts team picks and the Top 25 filter for one page. */
  readonly showAll: readonly string[];
  /** List scopes: how many game days are loaded (a page at a time). */
  readonly listDays: Readonly<Record<string, number>>;
  /** Open tournament days (CS2 in the All scope). */
  readonly expanded: readonly string[];
  /** Results: the round picked (absent: the latest). */
  readonly round: Readonly<Record<string, string>>;
  /** Results, team scope: the season shown (ESPN `season=`). */
  readonly seasonYear: Readonly<Record<string, number>>;
  /** Results, lists: how many rows show. */
  readonly limit: Readonly<Record<string, number>>;
  /** Team IDs whose results include friendlies (this session). */
  readonly friendlies: readonly string[];
}

export const LIST_PAGE = 7;

let session: Session = { windowStart: {}, week: {}, openedDays: {}, closedDays: {}, showAll: [], listDays: {}, expanded: [], round: {}, seasonYear: {}, limit: {}, friendlies: [] };
const listeners = new Set<() => void>();

function write(change: (s: Session) => Partial<Session>) {
  session = { ...session, ...change(session) };
  listeners.forEach((l) => l());
}

export function useScheduleSession<T>(selector: (s: Session) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selector(session),
    () => selector(session),
  );
}

const toggled = (list: readonly string[], value: string, on: boolean) => (on ? (list.includes(value) ? list : [...list, value]) : list.filter((x) => x !== value));

export const scheduleSession = {
  get: () => session,
  /** The days a strip scope shows: a week from its window start. */
  window(scope: ScheduleScope): { from: DayKey; to: DayKey } {
    const from = session.windowStart[scopeKey(scope)] ?? todayLocal();
    return { from, to: addingDays(from, 6) };
  },
  setWindow(scope: ScheduleScope, start: DayKey | null) {
    write((s) => {
      const next = { ...s.windowStart };
      if (start) next[scopeKey(scope)] = start;
      else delete next[scopeKey(scope)];
      return { windowStart: next };
    });
  },
  setWeek(scope: ScheduleScope, id: string | null) {
    write((s) => {
      const next = { ...s.week };
      if (id) next[scopeKey(scope)] = id;
      else delete next[scopeKey(scope)];
      return { week: next };
    });
  },
  isOpen(scope: ScheduleScope, day: string, defaults: ReadonlySet<string>): boolean {
    const key = scopeKey(scope);
    if (session.openedDays[key]?.includes(day)) return true;
    if (session.closedDays[key]?.includes(day)) return false;
    return defaults.has(day);
  },
  setOpen(scope: ScheduleScope, day: string, open: boolean) {
    const key = scopeKey(scope);
    write((s) => ({
      openedDays: { ...s.openedDays, [key]: toggled(s.openedDays[key] ?? [], day, open) },
      closedDays: { ...s.closedDays, [key]: toggled(s.closedDays[key] ?? [], day, !open) },
    }));
  },
  setShowAll(scope: ScheduleScope, on: boolean) {
    write((s) => ({ showAll: toggled(s.showAll, scopeKey(scope), on) }));
  },
  moreDays(scope: ScheduleScope) {
    write((s) => ({ listDays: { ...s.listDays, [scopeKey(scope)]: (s.listDays[scopeKey(scope)] ?? LIST_PAGE) + LIST_PAGE } }));
  },
  setExpanded(id: string, open: boolean) {
    write((s) => ({ expanded: toggled(s.expanded, id, open) }));
  },
  setRound(scope: ScheduleScope, id: string | null) {
    write((s) => {
      const next = { ...s.round };
      if (id) next[scopeKey(scope)] = id;
      else delete next[scopeKey(scope)];
      return { round: next };
    });
  },
  /** A raw entry beside the rounds (the All scope's reach back: "all:back"). */
  setRoundRaw(key: string, value: string) {
    write((s) => ({ round: { ...s.round, [key]: value } }));
  },
  setSeasonYear(scope: ScheduleScope, year: number | null) {
    write((s) => {
      const next = { ...s.seasonYear };
      if (year != null) next[scopeKey(scope)] = year;
      else delete next[scopeKey(scope)];
      const limit = { ...s.limit };
      delete limit[scopeKey(scope)];
      return { seasonYear: next, limit };
    });
  },
  showMore(scope: ScheduleScope) {
    write((s) => ({ limit: { ...s.limit, [scopeKey(scope)]: (s.limit[scopeKey(scope)] ?? CS_HISTORY_PAGE) + CS_HISTORY_PAGE } }));
  },
  /** Upcoming, pages that don't fold (a team's season): `count` more rows. */
  showMoreUpcoming(scope: ScheduleScope, count: number) {
    const key = `${scopeKey(scope)}:upcoming`;
    write((s) => ({ limit: { ...s.limit, [key]: (s.limit[key] ?? count) + count } }));
  },
  setFriendlies(teamID: string, on: boolean) {
    write((s) => ({ friendlies: toggled(s.friendlies, teamID, on) }));
  },
};

// MARK: - Results

export interface ResultsPage {
  /** Oldest first; the picker lists them newest first. */
  readonly rounds: readonly ResultRound[];
  readonly selected: string | null;
  /** The selected round's games in kickoff order (unfiltered), or a list scope's rows, newest first. */
  readonly items: readonly ScheduleItem[];
  readonly season: TeamSeason | null;
  readonly summary: string | null;
  /** NFL/college: the selected week's byes. */
  readonly byes: readonly string[];
  readonly more: boolean;
  readonly ok: boolean;
  readonly fetchedAt: number | null;
}

/** The boards a round needs, each with the freshness it deserves. */
function roundWindows(round: ResultRound): { window: BoardWindow; floor: number }[] {
  const over = compareDays(round.last, addingDays(todayEastern(), -2)) < 0;
  switch (round.kind) {
    case "week":
      return [{ window: { kind: "week", number: round.week ?? 0, seasonType: round.seasonType ?? 2 }, floor: over ? FINAL_TTL : 0 }];
    case "day":
      return [{ window: { kind: "day", day: round.first }, floor: 0 }];
    default:
      return monthWindows(round.first, round.last).map((window) => ({ window, floor: 0 }));
  }
}

/** Boards of a league already in the cache (a cached step paints at once; soccer rounds come from the months loaded). */
function loadedBoards(path: string): Map<string, Board> {
  const out = new Map<string, Board>();
  for (const [key, data] of queryClient.getQueriesData<Board>({ queryKey: ["schedule", "board", path] })) {
    if (data) out.set(String(key[3]), data);
  }
  return out;
}

/** Soccer leagues whose calendar has no game days (cups list stages): their rounds come from the months loaded. */
function growsBack(league: League, calendar: ScheduleCalendar | null): boolean {
  return league.sport === "soccer" && (calendar?.days.length ?? 0) === 0;
}

/** Rounds from the calendar and whatever is loaded, with each round's games. */
function leagueLayout(league: League, calendar: ScheduleCalendar | null): { rounds: ResultRound[]; members: Map<string, ScheduleItem[]> } {
  if (league.source.kind !== "espn") return { rounds: [], members: new Map() };
  const loaded = loadedBoards(league.source.path);
  const today = todayEastern();
  if (league.sport === "soccer") {
    const seen = new Set<string>();
    const items = [...loaded.entries()]
      .filter(([k]) => k.startsWith("m:"))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .flatMap(([, b]) => b.items)
      .filter((i) => !seen.has(i.id) && seen.add(i.id));
    return roundsLayout(calendar?.days ?? [], items, calendar, league, today);
  }
  const rounds = league.source.weekly ? calendarRounds(calendar, Date.now()) : pastGameDays(calendar, today).map(dayRound);
  const members = new Map<string, ScheduleItem[]>();
  const withCounts = rounds.map((r) => {
    const w = roundWindows(r)[0];
    const board = w ? loaded.get(windowKey(w.window)) : undefined;
    if (!board) return r;
    const games = sortItems(board.items);
    members.set(r.id, games);
    return { ...r, played: games.filter((g) => g.status === "final").length, total: games.length };
  });
  return { rounds: withCounts, members };
}

function isLoaded(league: League, round: ResultRound): boolean {
  if (league.source.kind !== "espn") return false;
  const loaded = loadedBoards(league.source.path);
  return roundWindows(round).every((w) => loaded.has(windowKey(w.window)));
}

async function loadRound(league: League, round: ResultRound): Promise<boolean> {
  if (league.source.kind !== "espn") return false;
  const { path } = league.source;
  const settled = await Promise.allSettled(roundWindows(round).map((w) => fetchBoard(path, league.id, w.window, w.floor)));
  return settled.every((s) => s.status === "fulfilled");
}

/** Cups: one more month of the past (the newest month first). False when there's nothing earlier to load. */
async function growBack(league: League, calendar: ScheduleCalendar | null): Promise<boolean> {
  if (league.source.kind !== "espn") return false;
  const loaded = [...loadedBoards(league.source.path).keys()].filter((k) => k.startsWith("m:")).sort();
  const today = todayEastern();
  let target: { year: number; month: number };
  const first = loaded[0];
  if (first) {
    const [y, m] = first.slice(2).split("-").map(Number);
    if (!y || !m) return false;
    target = m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
  } else {
    // The newest month that can hold a result: today's, or the season's last.
    const ends = (calendar?.weeks ?? []).map((w) => dayKeyIn(w.end, EASTERN)).sort(compareDays);
    const end = ends.length ? (compareDays(ends[ends.length - 1]!, today) < 0 ? ends[ends.length - 1]! : today) : today;
    target = { year: end.year, month: end.month };
  }
  const starts = (calendar?.weeks ?? []).map((w) => dayKeyIn(w.start, EASTERN)).sort(compareDays);
  const floor = starts[0] ? { y: starts[0].year, m: starts[0].month } : { y: today.year - 1, m: today.month };
  const before = (a: { year: number; month: number }, y: number, m: number) => a.year < y || (a.year === y && a.month < m);
  if (before(target, floor.y, floor.m) || before(target, today.year - 1, today.month)) return false;
  try {
    await fetchBoard(league.source.path, league.id, { kind: "month", year: target.year, month: target.month });
    return true;
  } catch {
    return false;
  }
}

/** The newest round with a result, loading as little as it can to know. */
async function findLatest(league: League, calendar: ScheduleCalendar | null): Promise<{ round: ResultRound | null; ok: boolean }> {
  const visited = new Set<string>();
  let ok = true;
  for (let i = 0; i < 8; i++) {
    const { rounds, members } = leagueLayout(league, calendar);
    const candidate = latestRound(rounds, (r) => (isLoaded(league, r) ? (members.get(r.id) ?? []).some((g) => g.status === "final") : null));
    if (!candidate) {
      if (growsBack(league, calendar) && (await growBack(league, calendar))) continue;
      return { round: null, ok };
    }
    if (!visited.has(candidate.id)) {
      visited.add(candidate.id);
      ok = (await loadRound(league, candidate)) && ok;
      continue;
    }
    if ((members.get(candidate.id) ?? []).some((g) => g.status === "final")) return { round: candidate, ok };
    // Nothing finished anywhere loaded: a cup looks a month further back.
    if (growsBack(league, calendar) && (await growBack(league, calendar))) continue;
    return { round: candidate, ok };
  }
  return { round: leagueLayout(league, calendar).rounds.at(-1) ?? null, ok };
}

/** A league's results page: its rounds and the requested round (or the latest), loaded. */
export async function loadLeagueResults(league: League, requested: string | null, back: string | null): Promise<ResultsPage> {
  if (league.source.kind !== "espn") return emptyResults(false);
  let calendarFailed = false;
  const calendar = await fetchCalendar(league.source.path).catch(() => {
    calendarFailed = true;
    return null;
  });
  let round: ResultRound | null = null;
  let ok = true;
  if (back) {
    // Older than the oldest round loaded (a cup): load a month further back, then the round before.
    if (growsBack(league, calendar)) await growBack(league, calendar);
    const rounds = leagueLayout(league, calendar).rounds;
    const i = rounds.findIndex((r) => r.id === back);
    round = i > 0 ? rounds[i - 1]! : (rounds.find((r) => r.id === back) ?? null);
  } else if (requested) {
    round = leagueLayout(league, calendar).rounds.find((r) => r.id === requested) ?? null;
  }
  if (round) ok = await loadRound(league, round);
  else ({ round, ok } = await findLatest(league, calendar));
  const { rounds, members } = leagueLayout(league, calendar);
  // A round's ID can change once its month loads and it splits (a holiday run).
  const resolved = round ? (rounds.find((r) => r.id === round.id) ?? rounds.find((r) => compareDays(r.first, round.first) <= 0 && compareDays(round.first, r.last) <= 0) ?? null) : null;
  const items = resolved ? (members.get(resolved.id) ?? []) : [];
  const loaded = loadedBoards(league.source.path);
  const used = resolved ? roundWindows(resolved).flatMap((w) => loaded.get(windowKey(w.window)) ?? []) : [];
  return {
    rounds,
    selected: resolved?.id ?? null,
    items,
    season: null,
    summary: roundSummary(items, league.sport),
    byes: resolved?.kind === "week" ? (used[0]?.byes ?? []) : [],
    more: false,
    // No calendar and no rounds (offline): a failure to load, not a season without results.
    ok: (ok || (resolved ? isLoaded(league, resolved) : false)) && !(calendarFailed && rounds.length === 0),
    fetchedAt: used.length ? Math.min(...used.map((b) => b.fetchedAt)) : null,
  };
}

/** The All scope's day rounds: the last `back` days, oldest first. */
export function allRounds(back: number): ResultRound[] {
  const today = todayLocal();
  return Array.from({ length: back + 1 }, (_, i) => dayRound(addingDays(today, -i))).reverse();
}

/** A day of every enabled league (All scope results): today when something has finished, else yesterday. */
export async function loadAllResults(leagues: readonly League[], requested: string | null, back: number, context: { followedCS: ReadonlySet<string>; climbing: readonly SeasonEvent[] | null }): Promise<ResultsPage> {
  const rounds = allRounds(back);
  const loadDay = async (day: DayKey) => {
    const settled = await Promise.allSettled(leagues.map((l) => fetchLeagueWindow(l, day, day, context, FINAL_TTL * (daysBetween(day, todayLocal()) > 2 ? 1 : 0)).then((f) => ({ league: l, fetch: f }))));
    const fetched = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
    const items = sortItems(leagues.flatMap((l) => fetched.find((f) => f.league.id === l.id)?.fetch.items.filter((i) => compareDays(i.day, day) === 0) ?? []));
    return { items, ok: fetched.some((f) => f.fetch.ok), fetchedAt: Math.min(...fetched.flatMap((f) => (f.fetch.fetchedAt ? [f.fetch.fetchedAt] : [Date.now()]))) };
  };
  let round = requested ? (rounds.find((r) => r.id === requested) ?? null) : null;
  let day: Awaited<ReturnType<typeof loadDay>>;
  if (round) day = await loadDay(round.first);
  else {
    const today = todayLocal();
    day = await loadDay(today);
    const finished = day.items.some((i) => i.status === "final");
    if (!finished) day = await loadDay(addingDays(today, -1));
    round = rounds.find((r) => compareDays(r.first, finished ? today : addingDays(today, -1)) === 0) ?? null;
  }
  return { rounds, selected: round?.id ?? null, items: day.items, season: null, summary: roundSummary(day.items, null), byes: [], more: false, ok: day.ok, fetchedAt: day.fetchedAt };
}

/** The team scope's Season menu: this season and the two before it. */
export function seasonChoices(team: ScheduleTeamRef): SeasonChoice[] {
  const source = teamSource(team.id);
  if (!source) return [];
  const league = team.league ?? (source.sport === "soccer" ? null : source.league);
  const year = currentSeasonYear(source.sport, league, todayEastern());
  return [{ year: null, label: seasonLabel(year, source.sport, league) }, ...[1, 2].map((n) => ({ year: year - n, label: seasonLabel(year - n, source.sport, league) }))];
}

/** A team's season: this one (`year` null) or a past one, summarized with the friendlies setting. */
export async function loadTeamSeason(team: ScheduleTeamRef, year: number | null, limit: number, friendlies: boolean): Promise<ResultsPage> {
  if (team.id.startsWith("cs-")) {
    const id = Number(team.id.slice(3));
    const pages = Math.max(1, Math.ceil(limit / CS_HISTORY_PAGE));
    const settled = await Promise.allSettled(
      Array.from({ length: pages }, (_, page) => cached(["schedule", "cs-history", id, page], page === 0 ? 30 * MINUTE : FINAL_TTL, async () => parseCSMatches(await getJSON(csHistoryURL([id], page))).map(counterStrikeResult))),
    );
    const got = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
    if (got.length === 0) return emptyResults(false);
    const seen = new Set<string>();
    const items = got.flat().filter((i) => !seen.has(i.id) && seen.add(i.id)).sort((a, b) => sortDate(b) - sortDate(a));
    const season = summarizeSeason(items, team, "Recent", true, null);
    const exhausted = (got[got.length - 1]?.length ?? 0) < CS_HISTORY_PAGE;
    return { ...emptyResults(true), season, items: season.results.slice(0, limit), more: season.results.length > limit || !exhausted, fetchedAt: Date.now() };
  }
  const source = teamSource(team.id);
  if (!source) return emptyResults(false);
  const leagueID = team.league && leagueWithID(team.league) ? team.league : null;
  // Soccer's past seasons come from the team's league; soccer/all is the fallback.
  const byLeague = year != null && source.sport === "soccer" && leagueID != null && leagueWithID(leagueID)?.sport === "soccer";
  const path = byLeague ? `soccer/${leagueID}` : source.path;
  const parseLeague = byLeague ? (leagueID ?? source.league) : source.league;
  const ttl = year == null ? TEAM_TTL : FINAL_TTL;
  const get = (url: string) => fetchTeamSchedule(url, path, parseLeague, ttl).catch(() => null);
  const fetched: (TeamSchedule & { fetchedAt: number })[] = [];
  if (year != null) {
    const types: (number | null)[] = source.sport === "soccer" ? [null] : [2, 3];
    for (const type of types) {
      const f = await get(teamScheduleURL(path, source.team, { season: year, seasonType: type }));
      if (f) fetched.push(f);
    }
  } else {
    const main = await get(teamScheduleURL(path, source.team));
    if (main) {
      fetched.push(main);
      if (source.sport !== "soccer" && main.seasonType === 3) {
        const regular = await get(teamScheduleURL(path, source.team, { seasonType: 2 }));
        if (regular) fetched.push(regular);
      }
      // Soccer: results come from the default list; fixtures aren't results.
    }
  }
  if (fetched.length === 0) return emptyResults(false);
  const seen = new Set<string>();
  const items = fetched.flatMap((f) => f.items).filter((i) => !seen.has(i.id) && seen.add(i.id));
  const league = team.league ?? (source.sport === "soccer" ? null : source.league);
  const seasonYear = year ?? currentSeasonYear(source.sport, league, todayEastern());
  const season = summarizeSeason(items, team, seasonLabel(seasonYear, source.sport, league), year == null, year == null ? (fetched[0]?.summary ?? null) : null, friendlies);
  return { ...emptyResults(true), season, items: season.results.slice(0, limit), more: season.results.length > limit, fetchedAt: Math.min(...fetched.map((f) => f.fetchedAt)) };
}

/** Every followed team's results of the last 30 days, newest first. */
export async function loadYourTeamsResults(teams: readonly ScheduleTeamRef[], limit: number, friendlies: readonly string[]): Promise<ResultsPage> {
  const from = addingDays(todayEastern(), -30);
  const settled = await Promise.allSettled(teams.map((t) => (t.id.startsWith("cs-") ? loadTeamSeason(t, null, 40, false).then((p) => ({ team: t, items: p.season?.results ?? [], ok: p.ok })) : fetchTeam(t).then((f) => ({ team: t, items: f.items, ok: f.ok })))));
  const got = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  const seen = new Set<string>();
  const all = got
    .flatMap(({ team, items }) => items.filter((i) => i.status === "final" && compareDays(i.day, from) >= 0 && (friendlies.includes(team.id) || !isFriendly(i))))
    .filter((i) => !seen.has(i.id) && seen.add(i.id))
    .sort((a, b) => sortDate(b) - sortDate(a));
  return { ...emptyResults(teams.length === 0 || got.some((g) => g.ok)), items: all.slice(0, limit), more: all.length > limit, fetchedAt: Date.now() };
}

function emptyResults(ok: boolean): ResultsPage {
  return { rounds: [], selected: null, items: [], season: null, summary: null, byes: [], more: false, ok, fetchedAt: null };
}

/** What Results already knows for a scope (nothing loads for the Upcoming page's link). */
export function cachedResults(scope: ScheduleScope): ResultsPage | undefined {
  const entries = queryClient.getQueriesData<ResultsPage>({ queryKey: ["results", scopeKey(scope)] });
  return entries.map(([, d]) => d).find((d) => d != null && d.rounds.length > 0);
}

/** The scores list's filters for a results round (League scope filters by its league; All by each item's). */
export function filterResults(items: readonly ScheduleItem[], scope: ScheduleScope, prefs: ListPreferences, showAll: boolean): ScheduleItem[] {
  const scoped = scope.kind === "league" ? leagueWithID(scope.id) : undefined;
  const byLeague = new Map<string, ScheduleItem[]>();
  for (const item of items) byLeague.set(item.league, [...(byLeague.get(item.league) ?? []), item]);
  return [...byLeague].flatMap(([id, list]) => {
    const league = scoped ?? leagueWithID(id);
    return league ? filterItems(list, league, prefs, showAll) : list;
  });
}

/** The Eastern board day of an item (calendars and boards are Eastern). */
export { boardDay };
export { EMPTY_CALENDAR };
