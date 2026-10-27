/**
 * The schedule pages' data (ScheduleStore.load / agenda, ResultsStore.open /
 * groups), as TanStack queries over the fetchers in `state/schedule.ts`.
 * The All scope streams: each league is its own query and shows as it
 * lands. Filters apply outside the queries, so changing a pick regroups
 * without a request. Rounds and windows keep the previous page on screen
 * while the next loads (a cached step is instant). A source that fails
 * shows at once (the page's error, or the footer's "Can't connect") and is
 * asked again on the retry ladder (state/retry.ts).
 */
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { addingDays, compareDays, dayID, dayKeyOf, type DayKey } from "../../data/days";
import { leagueWithID } from "../../data/leagues";
import type { League } from "../../data/models";
import { buildAgenda, climbingItems, filterItems, splitDays, type AgendaDay } from "../../data/agenda";
import { nextGameDay, weekAt } from "../../data/providers/schedule";
import { sortItems } from "../../data/results";
import { EMPTY_CALENDAR, scopeKey, scopeNavigator, weekID, type CalendarWeek, type ScheduleCalendar, type ScheduleItem, type ScheduleScope, type SeasonEvent } from "../../data/schedule";
import {
  CALENDAR_STALE,
  calendarKey,
  loadCalendar,
  fetchLeagueList,
  fetchLeagueWeek,
  fetchLeagueWindow,
  fetchTeam,
  LIST_PAGE,
  loadAllResults,
  loadLeagueResults,
  loadTeamSeason,
  loadYourTeamsResults,
  scheduleSession,
  useScheduleSession,
  filterResults,
  type LeagueFetch,
  type ResultsPage,
  type TeamFetch,
} from "../../state/schedule";
import { retrying } from "../../state/retry";
import { useSettings, type Settings } from "../../state/settings";
import { useClimbingSeasonsForAgenda } from "./climbing";

const all = (s: Settings) => s;

export interface AgendaData {
  readonly earlier: readonly AgendaDay[];
  readonly upcoming: readonly AgendaDay[];
  /** No answer yet (show the skeleton). */
  readonly loading: boolean;
  /** Fetching now (a window or week moved). */
  readonly fetching: boolean;
  /** Every source failed and there's nothing to show. */
  readonly failed: boolean;
  /** Some source failed: what's shown may be old. */
  readonly stale: boolean;
  readonly updated: number | null;
  readonly calendar: ScheduleCalendar | null;
  /** Enabled leagues with nothing in the window (All scope). */
  readonly quiet: readonly League[];
  /** The next game day of each quiet league, when its calendar knows. */
  readonly nextDay: ReadonlyMap<string, DayKey>;
  /** List scopes: more game days after the ones loaded. */
  readonly more: boolean;
  /** Team scope: "5–0 · 1st in AFC West". */
  readonly summary: string | null;
  /** NFL/college: the week shown, and the season's weeks. */
  readonly week: CalendarWeek | null;
  readonly weeks: readonly CalendarWeek[];
  /** The window (strip scopes). */
  readonly window: { readonly from: DayKey; readonly to: DayKey } | null;
  readonly refresh: () => void;
}

const STALE = 60_000;

/** Upcoming: day sections for a scope, with the state the chrome needs. */
export function useAgenda(scope: ScheduleScope): AgendaData {
  const settings = useSettings(all);
  const key = scopeKey(scope);
  const windowStart = useScheduleSession((s) => s.windowStart[key]);
  const weekChoice = useScheduleSession((s) => s.week[key] ?? null);
  const listDays = useScheduleSession((s) => s.listDays[key] ?? LIST_PAGE);
  const showAll = useScheduleSession((s) => s.showAll.includes(key));
  const navigator = scopeNavigator(scope);
  const today = dayKeyOf(Date.now());
  const from = windowStart ?? today;
  const to = addingDays(from, 6);
  const leagues = useMemo(() => settings.enabledLeagues.flatMap((id) => leagueWithID(id) ?? []), [settings.enabledLeagues]);
  const followedCS = useMemo(() => new Set(settings.followed.map((t) => t.id).filter((id) => id.startsWith("cs-"))), [settings.followed]);
  const climbing = useClimbingSeasonsForAgenda(scope.kind === "all" && settings.enabledLeagues.includes("ifsc"));

  // MARK: All: one query per league, streaming.
  const allQueries = useQueries({
    queries: (scope.kind === "all" ? leagues : []).map((league) => ({
      queryKey: ["agenda", "all", league.id, dayID(from), league.id === "cs2" ? [...followedCS].join(",") : ""],
      queryFn: () => fetchLeagueWindow(league, from, to, { followedCS, climbing: null }),
      staleTime: STALE,
      placeholderData: keepPreviousData,
      // Climbing's row here is a stand-in (its items come from the seasons' store): nothing to ask again.
      ...retrying<LeagueFetch>({ failed: (f) => !f.ok && league.id !== "ifsc" }),
    })),
  });

  // MARK: A league: its week, or its coming game days.
  const league = scope.kind === "league" ? leagueWithID(scope.id) : undefined;
  const calendarQuery = useQuery({
    // The same entry `fetchCalendar` reads, with the raw loader (a query can't fetch itself).
    queryKey: calendarKey(league?.source.kind === "espn" ? league.source.path : "-"),
    queryFn: () => (league?.source.kind === "espn" ? loadCalendar(league.source.path) : Promise.resolve(EMPTY_CALENDAR)),
    enabled: league?.source.kind === "espn" && navigator === "weekPicker",
    staleTime: CALENDAR_STALE,
    ...retrying(),
  });
  const selectedWeek = useMemo(() => (weekChoice ? (calendarQuery.data?.weeks.find((w) => weekID(w) === weekChoice) ?? null) : null), [weekChoice, calendarQuery.data]);
  const leagueQuery = useQuery({
    queryKey: ["agenda", key, navigator === "weekPicker" ? (weekChoice ?? "current") : listDays],
    queryFn: () => (navigator === "weekPicker" ? fetchLeagueWeek(league!, selectedWeek) : fetchLeagueList(league!, listDays)),
    enabled: league != null && (navigator !== "weekPicker" || weekChoice == null || calendarQuery.data != null),
    staleTime: STALE,
    placeholderData: keepPreviousData,
    ...retrying<LeagueFetch>({ failed: (f) => !f.ok }),
  });

  // MARK: A team, your teams.
  const teams = scope.kind === "team" ? [scope.team] : scope.kind === "yourTeams" ? settings.followed.map((t) => ({ id: t.id, name: t.name, logo: t.logo })) : [];
  const teamQueries = useQueries({
    queries: teams.map((team) => ({ queryKey: ["agenda", "team", team.id], queryFn: () => fetchTeam(team), staleTime: STALE, ...retrying<TeamFetch>({ failed: (f) => !f.ok }) })),
  });

  const version = [...allQueries, leagueQuery, ...teamQueries].reduce((v, q) => v + q.dataUpdatedAt + q.errorUpdatedAt, 0);
  const climbingVersion = climbing?.version ?? 0;

  const derived = useMemo(() => {
    const order = settings.enabledLeagues;
    let items: ScheduleItem[] = [];
    let ok: boolean[] = [];
    let updated: number[] = [];
    let calendar: ScheduleCalendar | null = null;
    let quiet: League[] = [];
    const nextDay = new Map<string, DayKey>();
    let byes: Readonly<Record<string, readonly string[]>> = {};
    let more = false;
    let summary: string | null = null;
    let week: CalendarWeek | null = null;
    let answered = false;
    if (scope.kind === "all") {
      leagues.forEach((l, i) => {
        const q = allQueries[i];
        const fetch = q?.data as LeagueFetch | undefined;
        if (l.id === "ifsc") {
          if (!climbing) return;
          answered = answered || climbing.ready;
          ok.push(climbing.ok);
          const mine = climbing.events.filter((e) => compareDays(e.startDay, to) <= 0 && compareDays(e.endDay, from) >= 0 && e.status !== "canceled").flatMap((e) => climbingItems(e, from, to));
          if (climbing.ready && mine.length === 0) quiet.push(l);
          items = items.concat(mine);
          return;
        }
        if (!fetch) {
          if (q?.isError) ok.push(false);
          return;
        }
        answered = true;
        ok.push(fetch.ok);
        if (fetch.fetchedAt) updated.push(fetch.fetchedAt);
        const mine = fetch.ok ? filterItems(fetch.items, l, settings, false).filter((i) => compareDays(from, i.day) <= 0 && compareDays(i.day, to) <= 0) : [];
        if (fetch.ok && mine.length === 0) {
          quiet.push(l);
          const next = nextGameDay(fetch.calendar, addingDays(to, 1));
          if (next) nextDay.set(l.id, next);
        }
        items = items.concat(mine);
      });
      // Without a league that answered, nothing has: keep the skeleton.
      answered = answered || allQueries.some((q) => q.isError);
    } else if (league) {
      const fetch = leagueQuery.data;
      answered = fetch != null || leagueQuery.isError;
      if (fetch) {
        ok = [fetch.ok];
        if (fetch.fetchedAt) updated = [fetch.fetchedAt];
        calendar = fetch.calendar;
        byes = fetch.byes;
        more = fetch.more;
        week = fetch.week;
        items = filterItems(fetch.items, league, settings, showAll);
      } else if (leagueQuery.isError) ok = [false];
    } else if (teams.length > 0) {
      answered = teamQueries.every((q) => q.data != null || q.isError);
      const horizon = addingDays(today, 60);
      const back = addingDays(today, -14);
      teamQueries.forEach((q) => {
        if (!q.data) {
          if (q.isError) ok.push(false);
          return;
        }
        ok.push(q.data.ok);
        if (q.data.fetchedAt) updated.push(q.data.fetchedAt);
        if (scope.kind === "team") summary = q.data.summary;
        items = items.concat(scope.kind === "yourTeams" ? q.data.items.filter((i) => compareDays(back, i.day) <= 0 && compareDays(i.day, horizon) <= 0) : q.data.items);
      });
    } else {
      answered = true;
    }
    const days = buildAgenda(items, order, scope.kind === "all");
    if (week && byes[weekID(week)]?.length && days.length > 0) {
      const last = days[days.length - 1]!;
      days[days.length - 1] = { ...last, byes: byes[weekID(week)]! };
    }
    let earlier: AgendaDay[] = [];
    let upcoming: AgendaDay[] = days;
    if (navigator !== "weekStrip") ({ earlier, upcoming } = splitDays(days, today));
    return {
      earlier,
      upcoming,
      answered,
      failed: ok.length > 0 && !ok.includes(true),
      stale: ok.includes(false),
      updated: updated.length ? Math.min(...updated) : null,
      calendar: calendar ?? calendarQuery.data ?? null,
      quiet,
      nextDay,
      more,
      summary,
      week: week ?? (navigator === "weekPicker" ? weekAt(calendarQuery.data ?? null, Date.now()) : null),
    };
    // `version` stands for the queries' data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, climbingVersion, settings, key, dayID(from), showAll, calendarQuery.data, dayID(today)]);

  const fetching = [...allQueries, leagueQuery, ...teamQueries].some((q) => q.isFetching);
  return {
    earlier: derived.earlier,
    upcoming: derived.upcoming,
    loading: !derived.answered,
    fetching,
    failed: derived.failed && derived.upcoming.length === 0 && derived.earlier.length === 0,
    stale: derived.stale,
    updated: derived.updated,
    calendar: derived.calendar,
    quiet: derived.quiet,
    nextDay: derived.nextDay,
    more: derived.more,
    summary: derived.summary,
    week: derived.week,
    weeks: derived.calendar?.weeks ?? calendarQuery.data?.weeks ?? [],
    window: navigator === "weekStrip" ? { from, to } : null,
    refresh: () => {
      void Promise.all([...allQueries, leagueQuery, ...teamQueries].map((q) => q.refetch()));
    },
  };
}

// MARK: - Results

/** How a results scope moves through time (ResultsPage.swift `ResultsNavigation`). */
export type ResultsNavigation = "rounds" | "days" | "list";

export function resultsNavigation(scope: ScheduleScope): ResultsNavigation {
  switch (scope.kind) {
    case "all":
      return "days";
    case "league": {
      const league = leagueWithID(scope.id);
      if (league?.source.kind === "espn" && league.source.weekly) return "rounds";
      return league?.sport === "soccer" ? "rounds" : "days";
    }
    default:
      return "list";
  }
}

export interface ResultsData {
  readonly page: ResultsPage | null;
  /** The round's day sections, filtered as the scores list is; finals first within a day. */
  readonly days: readonly AgendaDay[];
  readonly loading: boolean;
  readonly fetching: boolean;
  /** The round shown is a placeholder while another loads. */
  readonly placeholder: boolean;
  readonly refresh: () => void;
}

/** Results: the round (or a team's season), loaded through the shared cache. */
export function useResults(scope: ScheduleScope): ResultsData {
  const settings = useSettings(all);
  const key = scopeKey(scope);
  const round = useScheduleSession((s) => s.round[key] ?? null);
  const seasonYear = useScheduleSession((s) => s.seasonYear[key] ?? null);
  const limit = useScheduleSession((s) => s.limit[key] ?? 20);
  const friendlies = useScheduleSession((s) => s.friendlies);
  const showAll = useScheduleSession((s) => s.showAll.includes(key));
  const back = useScheduleSession((s) => (s.round[`${key}:back`] ? Number(s.round[`${key}:back`]) : 60));
  const navigation = resultsNavigation(scope);
  const leagues = useMemo(() => settings.enabledLeagues.flatMap((id) => leagueWithID(id) ?? []), [settings.enabledLeagues]);
  const followedCS = useMemo(() => new Set(settings.followed.map((t) => t.id).filter((id) => id.startsWith("cs-"))), [settings.followed]);
  const friendliesKey = scope.kind === "team" ? friendlies.includes(scope.team.id) : friendlies.join(",");
  const followedKey = settings.followed.map((t) => t.id).join(",");

  const query = useQuery({
    queryKey: ["results", key, round ?? "latest", scope.kind === "all" ? `${back}:${settings.enabledLeagues.join(",")}` : "", seasonYear ?? "current", limit, friendliesKey, scope.kind === "yourTeams" ? followedKey : ""],
    queryFn: (): Promise<ResultsPage> => {
      switch (scope.kind) {
        case "league": {
          const league = leagueWithID(scope.id)!;
          const backFrom = round?.startsWith("back:") ? round.slice(5) : null;
          return loadLeagueResults(league, backFrom ? null : round, backFrom);
        }
        case "all":
          return loadAllResults(
            leagues.filter((l) => l.source.kind !== "ifsc"),
            round,
            back,
            { followedCS, climbing: null },
          );
        case "team":
          return loadTeamSeason(scope.team, seasonYear, limit, friendlies.includes(scope.team.id));
        case "yourTeams":
          return loadYourTeamsResults(
            settings.followed.map((t) => ({ id: t.id, name: t.name, logo: t.logo })),
            limit,
            friendlies,
          );
        default:
          return Promise.resolve({ rounds: [], selected: null, items: [], season: null, summary: null, byes: [], more: false, ok: true, fetchedAt: null });
      }
    },
    staleTime: STALE,
    placeholderData: keepPreviousData,
    ...retrying<ResultsPage>({ failed: (p) => !p.ok }),
  });

  const page = query.data ?? null;
  const days = useMemo(() => {
    if (!page) return [];
    if (navigation === "list") {
      // Newest day first, newest game first.
      return buildAgenda(page.items, [], false)
        .reverse()
        .map((d) => ({ ...d, groups: d.groups.map((g) => ({ ...g, items: [...g.items].reverse() })) }));
    }
    const filtered = filterResults(page.items, scope, settings, showAll);
    const built = buildAgenda(filtered, settings.enabledLeagues, scope.kind === "all").map((d) => ({
      ...d,
      // Finals first within a day, then what's still to play, by time.
      groups: d.groups.map((g) => ({ ...g, items: [...g.items.filter((i) => i.status !== "scheduled"), ...g.items.filter((i) => i.status === "scheduled")] })),
    }));
    if (built.length && page.byes.length) built[built.length - 1] = { ...built[built.length - 1]!, byes: page.byes };
    return built;
  }, [page, navigation, settings, showAll, key]);

  return {
    page,
    days,
    loading: query.data == null && !query.isError,
    fetching: query.isFetching,
    placeholder: query.isPlaceholderData,
    refresh: () => void query.refetch(),
  };
}

export { roundSections, stripStart, weekStep } from "../../data/results";
export { scheduleSession, sortItems };
export type { SeasonEvent };
