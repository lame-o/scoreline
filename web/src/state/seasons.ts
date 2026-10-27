/**
 * The season pages' data, as TanStack Queries over the `/api/*` proxy:
 * climbing's calendar (IFSC), CS2's S-tier tournaments (bo3.gg), and their
 * results. Ports the season halves of ScheduleStore.swift (`loadClimbing`,
 * `loadClimbingDetail`, `loadTournaments`, `loadTournamentDetail`) and
 * SeasonResultsStore (SeasonResults.swift).
 *
 * Each upstream URL is one query with a stable key, so every page that reads
 * it (the season page, the All schedule, a league page) shares one cache
 * entry and one request. The Mac's disk cache and TTLs become each query's
 * `staleTime` here, over the browser's HTTP cache and the Worker's edge cache.
 *
 * The disciplines setting is honored twice: untracked disciplines are cut
 * from what pages read (`tracked`), and a competition with none you follow
 * never has its detail, registrations or results fetched.
 *
 *     const { events, status } = useClimbingSeasons();
 */
import { keepPreviousData, useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { dayKeyOf } from "../data/days";
import { getJSON } from "../data/http";
import type { SeasonEvent } from "../data/schedule";
import {
  best,
  categoryURL,
  finished as finishedEvents,
  finishedSlug,
  finishedURL,
  finalLine,
  matchGroups,
  PAGE_SIZE,
  parseCategory,
  parseFinished,
  parseStage,
  parseTournamentMatches,
  resultSeasons,
  resultsTTL,
  seasonTTL,
  slugURL,
  stageURL,
  standaloneEvent,
  tournamentMatchesURL,
  type CategoryResults,
  type CountryBest,
  type FinishedPage,
  type FinishedTournament,
  type MatchGroup,
  type StageInfo,
  type TournamentMatches,
} from "../data/seasonResults";
import {
  clocked,
  currentAndNext,
  IFSC_ROOT_URL,
  ifscEventURL,
  ifscRegistrationsURL,
  ifscSeasonURL,
  isDrawn,
  nextEvent,
  parseRegistrations,
  parseSeasonEvents,
  parseSeasonRefs,
  parseTournament,
  parseTournaments,
  tournamentsURL,
  tournamentURL,
  tracked,
  tracking,
  wantsDetail,
  withDetail,
  withTournamentDetail,
  type SeasonList,
} from "../data/seasons";
import { climbingCountries } from "../data/scoreboard";
import { useNow } from "./clock";
import { queryClient } from "./scores";
import { useSettings } from "./settings";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export type LoadStatus = "loading" | "ready" | "failed";

/** Query keys: one per upstream URL, shared by every reader. */
export const seasonKeys = {
  ifscRoot: ["seasons", "ifsc", "root"] as const,
  ifscSeason: (id: number) => ["seasons", "ifsc", "season", id] as const,
  ifscEvent: (id: number) => ["seasons", "ifsc", "event", id] as const,
  ifscRegistrations: (id: number, countries: string) => ["seasons", "ifsc", "registrations", id, countries] as const,
  ifscCategory: (event: number, dcat: number) => ["seasons", "ifsc", "category", event, dcat] as const,
  csList: (status: string) => ["seasons", "cs2", "tournaments", status] as const,
  csTournament: (slug: string) => ["seasons", "cs2", "tournament", slug] as const,
  csFinished: ["seasons", "cs2", "finished"] as const,
  csSlug: (slug: string) => ["seasons", "cs2", "slug", slug] as const,
  csMatches: (id: number) => ["seasons", "cs2", "matches", id] as const,
  csStage: (id: number) => ["seasons", "cs2", "stage", id] as const,
};

const climbingID = (e: SeasonEvent) => (e.kind.kind === "climbing" ? e.kind.id : null);
const slugOf = (e: SeasonEvent) => (e.kind.kind === "tournament" ? e.kind.slug : null);

/** Season data never polls on its own: it refreshes on return to the tab when stale, and with Refresh. */
const quiet = { refetchOnWindowFocus: true, refetchInterval: false as const, retry: 2 };

function useDisciplines() {
  return useSettings((s) => s.climbingDisciplines);
}

/** The followed countries for climbing (IOC codes), as a stable string. */
export function useClimbingCountries(): readonly string[] {
  const filters = useSettings((s) => s.teamFilters);
  const filtered = useSettings((s) => s.filteredLeagues);
  const key = climbingCountries({ teamFilters: filters, filteredLeagues: filtered } as Parameters<typeof climbingCountries>[0]).join(",");
  return useMemo(() => (key ? key.split(",") : []), [key]);
}

function useRoot() {
  return useQuery({
    queryKey: seasonKeys.ifscRoot,
    queryFn: async ({ signal }) => parseSeasonRefs(await getJSON(IFSC_ROOT_URL, { signal })),
    staleTime: 12 * HOUR,
    ...quiet,
  });
}

function seasonQuery(id: number, name: string, current: string | null) {
  return {
    queryKey: seasonKeys.ifscSeason(id),
    queryFn: async ({ signal }: { signal: AbortSignal }) => parseSeasonEvents(await getJSON(ifscSeasonURL(id), { signal }), Date.now()),
    staleTime: seasonTTL(name, current),
    ...quiet,
  };
}

function eventQuery(e: SeasonEvent, now: number) {
  const id = climbingID(e) ?? 0;
  return {
    queryKey: seasonKeys.ifscEvent(id),
    // The competition as its own detail tells it (used cold, too: a category page).
    queryFn: async ({ signal }: { signal: AbortSignal }) => standaloneEvent(await getJSON(ifscEventURL(id), { signal }), Date.now()),
    staleTime: e.status === "live" ? 10 * MINUTE : e.status === "finished" ? resultsTTL(e.endsAt, now) : 6 * HOUR,
    ...quiet,
  };
}

function registrationsQuery(id: number, countries: readonly string[]) {
  const set = new Set(countries);
  return {
    queryKey: seasonKeys.ifscRegistrations(id, countries.join(",")),
    queryFn: async ({ signal }: { signal: AbortSignal }) => parseRegistrations(await getJSON(ifscRegistrationsURL(id), { signal }), set),
    staleTime: 12 * HOUR,
    ...quiet,
  };
}

/** The newest `dataUpdatedAt` of some queries, or null. */
function updatedOf(queries: readonly { dataUpdatedAt: number }[]): number | null {
  const t = queries.reduce((m, q) => Math.max(m, q.dataUpdatedAt), 0);
  return t > 0 ? t : null;
}

// MARK: - Climbing: the calendar (ScheduleStore.loadClimbing)

export interface ClimbingSeasons {
  /** Every loaded season's competitions, in date order, cut to the disciplines you follow, with what detail has loaded. */
  readonly events: readonly SeasonEvent[];
  /** Season names in order ("2026", "2027"), and each one's competitions (tracked). */
  readonly seasons: readonly string[];
  readonly bySeason: Readonly<Record<string, readonly SeasonEvent[]>>;
  /** The season with the next unfinished competition. */
  readonly defaultSeason: string | null;
  readonly status: LoadStatus;
  readonly updated: number | null;
  readonly fetching: boolean;
  readonly refresh: () => void;
}

/**
 * Climbing's current and next seasons, with the detail (rounds, podiums,
 * your countries' registrations) of what's live or within two weeks, and of
 * any competition in `opened`. Shared by the climbing page and the All
 * schedule (one cache entry per URL).
 */
export function useClimbingSeasons(opened: readonly string[] = []): ClimbingSeasons {
  const disciplines = useDisciplines();
  const countries = useClimbingCountries();
  const root = useRoot();
  const list: SeasonList | undefined = root.data;
  const refs = list ? currentAndNext(list) : [];
  const seasonQueries = useQueries({ queries: refs.map((r) => seasonQuery(r.id, r.name, list?.current?.name ?? null)) });
  const minute = Math.floor(useNow(MINUTE) / MINUTE);
  const now = minute * MINUTE;
  const today = dayKeyOf(now);

  // Raw competitions (statuses from the clock), before any detail.
  const seasonVersion = seasonQueries.map((q) => q.dataUpdatedAt).join(",");
  const raw = useMemo(() => seasonQueries.flatMap((q) => clocked(q.data ?? [], now)), [seasonVersion, minute]); // eslint-disable-line react-hooks/exhaustive-deps
  // Details only for competitions in a discipline you follow.
  // The next competition too: the card and the split panel open on it, however far off.
  const followedRaw = raw.filter((e) => tracking(e, disciplines) != null);
  const soonest = nextEvent(followedRaw, now)?.id;
  const wanted = followedRaw.filter((e) => wantsDetail(e, today) || e.id === soonest || opened.includes(e.id));
  const detailQueries = useQueries({ queries: wanted.map((e) => eventQuery(e, now)) });
  const registered = wanted.filter((e) => e.status !== "finished" && countries.length > 0);
  const registrationQueries = useQueries({ queries: registered.map((e) => registrationsQuery(climbingID(e) ?? 0, countries)) });

  const version = [seasonVersion, detailQueries.map((q) => q.dataUpdatedAt).join(","), registrationQueries.map((q) => q.dataUpdatedAt).join(",")].join("|");
  const derived = useMemo(() => {
    const details = new Map<string, SeasonEvent>();
    wanted.forEach((e, i) => {
      const d = detailQueries[i]?.data;
      if (d) details.set(e.id, d);
    });
    const regs = new Map<string, Readonly<Record<string, number>>>();
    registered.forEach((e, i) => {
      const r = registrationQueries[i]?.data;
      if (r) regs.set(e.id, r);
    });
    const merge = (e: SeasonEvent): SeasonEvent => {
      const d = details.get(e.id);
      const r = regs.get(e.id);
      let out = d ? withDetail(d, e) : e;
      if (r) out = { ...out, registered: r };
      return out;
    };
    const bySeason: Record<string, SeasonEvent[]> = {};
    const seasons: string[] = [];
    refs.forEach((ref, i) => {
      const events = tracked(clocked(seasonQueries[i]?.data ?? [], now).map(merge), disciplines);
      if (events.length > 0 || (seasonQueries[i]?.data?.length ?? 0) > 0) {
        seasons.push(ref.name);
        bySeason[ref.name] = events;
      }
    });
    const events = seasons.flatMap((s) => bySeason[s] ?? []);
    const next = nextEvent(events, now);
    return { events, seasons, bySeason, defaultSeason: next ? String(next.startDay.year) : (seasons[seasons.length - 1] ?? null) };
  }, [version, minute, disciplines.join(","), countries.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const anyData = seasonQueries.some((q) => q.data);
  const status: LoadStatus = anyData ? "ready" : root.isError || (seasonQueries.length > 0 && seasonQueries.every((q) => q.isError)) ? "failed" : "loading";
  return {
    ...derived,
    status,
    updated: updatedOf(seasonQueries),
    fetching: root.isFetching || seasonQueries.some((q) => q.isFetching) || detailQueries.some((q) => q.isFetching),
    refresh: () => void queryClient.invalidateQueries({ queryKey: ["seasons", "ifsc"] }),
  };
}

// MARK: - CS2: the calendar (ScheduleStore.loadTournaments)

export interface Tournaments {
  /** Every tournament underway or ahead (canceled ones left out), soonest first. */
  readonly events: readonly SeasonEvent[];
  readonly current: readonly SeasonEvent[];
  readonly upcoming: readonly SeasonEvent[];
  readonly status: LoadStatus;
  readonly updated: number | null;
  readonly fetching: boolean;
  readonly refresh: () => void;
}

function tournamentDetailQuery(e: SeasonEvent) {
  const slug = slugOf(e) ?? "";
  return {
    queryKey: seasonKeys.csTournament(slug),
    queryFn: async ({ signal }: { signal: AbortSignal }) => parseTournament(await getJSON(tournamentURL(slug), { signal }), e),
    staleTime: e.status === "live" ? 10 * MINUTE : 6 * HOUR,
    ...quiet,
  };
}

/** CS2's S-tier tournaments underway and ahead, with the field of those within two months and any in `opened`. */
export function useTournaments(opened: readonly string[] = []): Tournaments {
  const current = useQuery({
    queryKey: seasonKeys.csList("current"),
    queryFn: async ({ signal }) => parseTournaments(await getJSON(tournamentsURL("current"), { signal })),
    staleTime: 10 * MINUTE,
    ...quiet,
  });
  const upcoming = useQuery({
    queryKey: seasonKeys.csList("upcoming"),
    queryFn: async ({ signal }) => parseTournaments(await getJSON(tournamentsURL("upcoming"), { signal })),
    staleTime: 30 * MINUTE,
    ...quiet,
  });
  const today = dayKeyOf(Math.floor(useNow(MINUTE) / MINUTE) * MINUTE);
  const listVersion = `${current.dataUpdatedAt},${upcoming.dataUpdatedAt}`;
  const raw = useMemo(() => [...(current.data ?? []), ...(upcoming.data ?? [])], [listVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  // Fields for the next two months (teams, place), and whatever's opened.
  const wanted = raw.filter((e) => e.status !== "canceled" && (dayDiff(today, e) <= 60 || opened.includes(e.id)));
  const detailQueries = useQueries({ queries: wanted.map(tournamentDetailQuery) });
  const version = `${listVersion}|${detailQueries.map((q) => q.dataUpdatedAt).join(",")}`;
  const derived = useMemo(() => {
    const details = new Map<string, SeasonEvent>();
    wanted.forEach((e, i) => {
      const d = detailQueries[i]?.data;
      if (d) details.set(e.id, d);
    });
    const events = raw.filter((e) => e.status !== "canceled").map((e) => {
      const d = details.get(e.id);
      return d ? withTournamentDetail(d, e) : e;
    });
    return { events, current: events.filter((e) => e.status === "live"), upcoming: events.filter((e) => e.status === "upcoming") };
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const status: LoadStatus = current.data || upcoming.data ? "ready" : current.isError && upcoming.isError ? "failed" : "loading";
  return {
    ...derived,
    status,
    updated: updatedOf([current, upcoming]),
    fetching: current.isFetching || upcoming.isFetching || detailQueries.some((q) => q.isFetching),
    refresh: () => void queryClient.invalidateQueries({ queryKey: ["seasons", "cs2"] }),
  };
}

function dayDiff(today: ReturnType<typeof dayKeyOf>, e: SeasonEvent): number {
  return Math.round((Date.UTC(e.startDay.year, e.startDay.month - 1, e.startDay.day) - Date.UTC(today.year, today.month - 1, today.day)) / DAY);
}

export { isDrawn };

// MARK: - Climbing results (SeasonResultsStore.loadClimbing)

export interface ClimbingResults {
  /** Seasons with results, newest first ("2026", "2025", …). */
  readonly menu: readonly string[];
  readonly season: string | null;
  /** The season's competitions (canceled left out), tracked, with podiums once loaded. */
  readonly events: readonly SeasonEvent[];
  /** Its finished competitions, newest first. */
  readonly finished: readonly SeasonEvent[];
  readonly status: LoadStatus;
  readonly updated: number | null;
  readonly fetching: boolean;
  readonly refresh: () => void;
}

/**
 * A season's results: the menu of seasons, the chosen one (the current
 * season, or the one before while nothing in this one has finished), and
 * the categories and podiums of its finished competitions in the disciplines
 * you follow.
 */
export function useClimbingResults(chosen: string | null): ClimbingResults {
  const disciplines = useDisciplines();
  const root = useRoot();
  const minute = Math.floor(useNow(MINUTE) / MINUTE);
  const now = minute * MINUTE;
  const today = dayKeyOf(now);
  const menuRefs = root.data ? resultSeasons(root.data, today) : [];
  const current = root.data?.current?.name ?? null;
  // The first two seasons decide the default; the chosen one loads too.
  const wantedRefs = menuRefs.filter((r, i) => i < 2 || r.name === chosen);
  const seasonQueries = useQueries({ queries: wantedRefs.map((r) => ({ ...seasonQuery(r.id, r.name, current), placeholderData: keepPreviousData })) });
  const loaded = new Map(wantedRefs.map((r, i) => [r.name, seasonQueries[i]?.data] as const));
  let season = chosen;
  if (!season) {
    for (const r of menuRefs.slice(0, 2)) {
      const events = loaded.get(r.name);
      if (!events) continue;
      season ??= r.name;
      if (clocked(events, now).some((e) => e.status === "finished")) {
        season = r.name;
        break;
      }
    }
  }
  const seasonIndex = wantedRefs.findIndex((r) => r.name === season);
  const seasonQ = seasonIndex >= 0 ? seasonQueries[seasonIndex] : undefined;
  const raw = clocked(seasonQ?.data ?? [], now);
  const finishedRaw = finishedEvents(raw).filter((e) => tracking(e, disciplines) != null);
  const detailQueries = useQueries({ queries: finishedRaw.map((e) => eventQuery(e, now)) });
  const version = `${seasonQ?.dataUpdatedAt ?? 0}|${detailQueries.map((q) => q.dataUpdatedAt).join(",")}|${season}`;
  const derived = useMemo(() => {
    const details = new Map<string, SeasonEvent>();
    finishedRaw.forEach((e, i) => {
      const d = detailQueries[i]?.data;
      if (d) details.set(e.id, d);
    });
    const events = tracked(
      raw.filter((e) => e.status !== "canceled").map((e) => {
        const d = details.get(e.id);
        return d ? withDetail(d, e) : e;
      }),
      disciplines,
    );
    return { events, finished: finishedEvents(events) };
  }, [version, minute, disciplines.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const status: LoadStatus = seasonQ?.data ? "ready" : root.isError || seasonQ?.isError ? "failed" : "loading";
  return {
    menu: menuRefs.map((r) => r.name),
    season,
    ...derived,
    status,
    updated: seasonQ?.dataUpdatedAt || null,
    fetching: root.isFetching || seasonQueries.some((q) => q.isFetching) || detailQueries.some((q) => q.isFetching),
    refresh: () => void queryClient.invalidateQueries({ queryKey: ["seasons", "ifsc"] }),
  };
}

function categoryQuery(event: number, dcat: number, endsAt: number | null, now: number) {
  return {
    queryKey: seasonKeys.ifscCategory(event, dcat),
    queryFn: async ({ signal }: { signal: AbortSignal }) => parseCategory(await getJSON(categoryURL(event, dcat), { signal })),
    staleTime: resultsTTL(endsAt, now),
    ...quiet,
  };
}

/**
 * Opened in the list: your countries' best athletes per category, one
 * full-results request per category you follow, only with countries
 * highlighted. "dcat" → best athletes.
 */
export function useYours(event: SeasonEvent | null, countries: readonly string[]): Readonly<Record<number, readonly CountryBest[]>> {
  const now = Math.floor(Date.now() / HOUR) * HOUR;
  const id = event ? climbingID(event) : null;
  const categories = id != null && countries.length > 0 ? (event?.categories ?? []).filter((c) => c.dcatID != null) : [];
  const queries = useQueries({ queries: categories.map((c) => categoryQuery(id ?? 0, c.dcatID ?? 0, event?.endsAt ?? null, now)) });
  const version = queries.map((q) => q.dataUpdatedAt).join(",");
  return useMemo(() => {
    const set = new Set(countries);
    const out: Record<number, readonly CountryBest[]> = {};
    categories.forEach((c, i) => {
      const data = queries[i]?.data;
      if (data && c.dcatID != null) out[c.dcatID] = best(data, set);
    });
    return out;
  }, [version, countries.join(","), event?.id]); // eslint-disable-line react-hooks/exhaustive-deps
}

// MARK: - A category's full results (SeasonResultsStore.loadCategory)

export interface CategoryPage {
  readonly event: SeasonEvent | null;
  readonly results: CategoryResults | null;
  readonly status: LoadStatus;
  readonly updated: number | null;
  readonly refresh: () => void;
}

export function useCategoryResults(eventID: number, dcatID: number): CategoryPage {
  const now = Math.floor(Date.now() / HOUR) * HOUR;
  const event = useQuery({
    queryKey: seasonKeys.ifscEvent(eventID),
    queryFn: async ({ signal }) => standaloneEvent(await getJSON(ifscEventURL(eventID), { signal }), Date.now()),
    staleTime: 6 * HOUR,
    ...quiet,
  });
  const endsAt = event.data?.endsAt ?? null;
  const results = useQuery({ ...categoryQuery(eventID, dcatID, endsAt, now), placeholderData: keepPreviousData });
  const clockedEvent = useMemo(() => (event.data ? (clocked([event.data], Date.now())[0] ?? null) : null), [event.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    event: clockedEvent,
    results: results.data ?? null,
    status: results.data ? "ready" : results.isError ? "failed" : "loading",
    updated: results.dataUpdatedAt || null,
    refresh: () => {
      void queryClient.invalidateQueries({ queryKey: seasonKeys.ifscEvent(eventID) });
      void queryClient.invalidateQueries({ queryKey: seasonKeys.ifscCategory(eventID, dcatID) });
    },
  };
}

// MARK: - CS2 results (SeasonResultsStore.loadTournaments, loadTournament)

export interface FinishedTournaments {
  readonly items: readonly FinishedTournament[];
  readonly more: boolean;
  readonly loadingMore: boolean;
  readonly loadMore: () => void;
  readonly status: LoadStatus;
  readonly updated: number | null;
  readonly refresh: () => void;
}

/** Finished S-tier tournaments, newest first, six at a time ("Show Earlier"). */
export function useFinishedTournaments(): FinishedTournaments {
  const q = useInfiniteQuery({
    queryKey: seasonKeys.csFinished,
    queryFn: async ({ pageParam, signal }) => parseFinished(await getJSON(finishedURL(pageParam), { signal })),
    initialPageParam: 0,
    getNextPageParam: (last: FinishedPage, pages: FinishedPage[]) => (pages.length * PAGE_SIZE < last.total ? pages.length : undefined),
    staleTime: 6 * HOUR,
    ...quiet,
  });
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (q.data?.pages ?? []).flatMap((p) => p.items).filter((t) => !seen.has(t.event.id) && (seen.add(t.event.id), true));
  }, [q.dataUpdatedAt, q.data?.pages.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    items,
    more: q.hasNextPage,
    loadingMore: q.isFetchingNextPage,
    loadMore: () => void q.fetchNextPage(),
    status: q.data ? "ready" : q.isError ? "failed" : "loading",
    updated: q.dataUpdatedAt || null,
    refresh: () => void q.refetch(),
  };
}

export interface TournamentPage {
  readonly tournament: FinishedTournament | null;
  readonly groups: readonly MatchGroup[];
  readonly matches: number;
  /** "beat MOUZ 3–0 in the grand final" */
  readonly final: string | null;
  readonly status: LoadStatus;
  readonly matchesStatus: LoadStatus;
  readonly updated: number | null;
  readonly refresh: () => void;
}

/** A finished tournament (from the results list when it's there, else by slug), its matches by round, and how the final went. */
export function useTournamentResults(slug: string): TournamentPage {
  const known = useMemo(() => {
    const data = queryClient.getQueryData<{ pages: FinishedPage[] }>(seasonKeys.csFinished);
    return data?.pages.flatMap((p) => p.items).find((t) => finishedSlug(t) === slug) ?? null;
  }, [slug]);
  const bySlug = useQuery({
    queryKey: seasonKeys.csSlug(slug),
    queryFn: async ({ signal }) => parseFinished(await getJSON(slugURL(slug), { signal })).items[0] ?? null,
    staleTime: 6 * HOUR,
    enabled: known == null,
    ...quiet,
  });
  const tournament = known ?? bySlug.data ?? null;
  const now = Math.floor(Date.now() / HOUR) * HOUR;
  const matches = useQuery({
    queryKey: seasonKeys.csMatches(tournament?.bo3ID ?? 0),
    enabled: tournament != null,
    // Every match (bo3.gg pages at 100).
    queryFn: async ({ signal }): Promise<TournamentMatches> => {
      const id = tournament?.bo3ID ?? 0;
      let all: TournamentMatches = { items: [], stage: {}, round: {}, total: 0 };
      let offset = 0;
      do {
        const page = parseTournamentMatches(await getJSON(tournamentMatchesURL(id, offset), { signal }), Date.now());
        all = { items: [...all.items, ...page.items], stage: { ...page.stage, ...all.stage }, round: { ...page.round, ...all.round }, total: page.total };
        offset += 100;
      } while (offset < all.total && offset < 1000);
      return all;
    },
    staleTime: resultsTTL(tournament?.event.endsAt ?? null, now),
    ...quiet,
  });
  const stageIDs = useMemo(() => [...new Set(Object.values(matches.data?.stage ?? {}))].sort((a, b) => a - b), [matches.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const stages = useQueries({
    queries: stageIDs.map((id) => ({
      queryKey: seasonKeys.csStage(id),
      queryFn: async ({ signal }: { signal: AbortSignal }) => parseStage(await getJSON(stageURL(id), { signal })),
      staleTime: resultsTTL(tournament?.event.endsAt ?? null, now),
      ...quiet,
    })),
  });
  const stageVersion = stages.map((s) => s.dataUpdatedAt).join(",");
  const groups = useMemo(() => {
    if (!matches.data || !tournament) return [];
    const infos = stages.flatMap((s) => (s.data ? [s.data as StageInfo] : []));
    return matchGroups(matches.data, infos, tournament.event.name);
  }, [matches.dataUpdatedAt, stageVersion, tournament?.event.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const stagesSettled = stages.every((s) => !s.isPending);
  return {
    tournament,
    groups: stagesSettled ? groups : [],
    matches: matches.data?.items.length ?? 0,
    final: tournament && stagesSettled ? finalLine(tournament, groups) : null,
    status: tournament ? "ready" : bySlug.isError ? "failed" : "loading",
    matchesStatus: matches.data && stagesSettled ? "ready" : matches.isError ? "failed" : "loading",
    updated: matches.dataUpdatedAt || bySlug.dataUpdatedAt || null,
    refresh: () => {
      void queryClient.invalidateQueries({ queryKey: seasonKeys.csSlug(slug) });
      if (tournament) void queryClient.invalidateQueries({ queryKey: seasonKeys.csMatches(tournament.bo3ID) });
    },
  };
}
