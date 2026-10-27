/**
 * Live scores as the app holds them: one TanStack Query per enabled league,
 * polled on ScoreStore's cadence, merged poll over poll, and derived into
 * the page's sections, tile board and live count.
 *
 * - Cadence (ScoreStore.pollInterval): 30s while anything the user sees is
 *   live, 60s before a start, otherwise 5 minutes. A failing league retries
 *   at 5, 15 and 30s, then waits for the next poll; its last good games stay
 *   on screen marked failed. Polling stops while the tab is hidden and
 *   catches up on return if the data is older than 30s.
 * - Each poll is merged onto the last (`mergePoll`): clocks learn whether
 *   they run, an unchanged game keeps its identity (so its row doesn't render).
 * - CS2: live matches with a followed team or pinned (and, in Tiles, the
 *   first few on the board) read bo3.gg's live round (`withLiveRounds`).
 * - Hidden tabs (web only): the shell's reader (`poll: "auto"`) keeps
 *   polling, at `backgroundInterval`, while the tab title or alerts need the
 *   news; it also polls whenever no page does (Settings on a phone).
 * - My Teams reaches into each followed team's schedule (`useNextGames`).
 *
 *     const { sections, board, liveCount, status } = useScoreboard();
 */
import { QueryClient, useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { leagueWithID } from "../data/leagues";
import { getJSON } from "../data/http";
import type { League, LeagueResult, ScoreEvent } from "../data/models";
import { fetchLeagueEvents } from "../data/providers";
import { csLiveWatch, withLiveRounds } from "../data/providers/counterStrike";
import {
  allFailed,
  backgroundInterval,
  board as buildBoard,
  climbingCountries,
  computeSections,
  involvesFollowed,
  keepIdentity,
  liveCount as countLive,
  mergePoll,
  pollInterval,
  quietLeagues as findQuiet,
  retryDelay,
  type Board,
  type Section,
} from "../data/scoreboard";
import { useNow } from "./clock";
import { useLogoColorsVersion, wearColors } from "./logoColors";
import { useNextGames } from "./nextGames";
import { pin, usePinnedID } from "./pin";
import { getSettings, useSettings, type Settings } from "./settings";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Coming back to the tab refreshes data older than this (ScoreStore.refreshIfStale).
      staleTime: 30_000,
      gcTime: 15 * 60_000,
      retry: 3,
      retryDelay: (attempt) => retryDelay(attempt + 1) * 1000,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
    },
  },
});

export const scoresKey = (league: string, countries: readonly string[]) =>
  ["scores", league, ...(league === "ifsc" ? [countries.join(",")] : [])] as const;

export interface Scoreboard {
  readonly settings: Settings;
  /** League ID → its latest result; absent until its first answer. */
  readonly results: Readonly<Record<string, LeagueResult>>;
  readonly sections: readonly Section[];
  readonly board: Board;
  readonly quietLeagues: readonly League[];
  readonly liveCount: number;
  /** "loading": nothing has answered yet; "offline": every league failed. */
  readonly status: "loading" | "ready" | "offline";
  /** When the newest data arrived (epoch ms), or null. */
  readonly lastUpdated: number | null;
  readonly fetching: boolean;
  /** Event ID → league ID. */
  readonly leagueOf: (eventID: string) => string | undefined;
  /** The freshest copy of an event, from whichever league has it. */
  readonly event: (eventID: string) => ScoreEvent | undefined;
  /** Refreshes every league now (the Refresh button). */
  readonly refresh: () => Promise<void>;
}

const all = (s: Settings) => s;

// MARK: - Who polls

/** Readers polling at the visible cadence (`poll: true`); an "auto" reader stands in when there are none. */
const pollers = new Set<symbol>();
const pollerListeners = new Set<() => void>();
function subscribePollers(listener: () => void) {
  pollerListeners.add(listener);
  return () => pollerListeners.delete(listener);
}
function subscribeVisibility(listener: () => void) {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}
const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/** One league's poll: the feed, merged onto the last poll; CS2 adds its live rounds. */
async function pollLeague(league: League, countries: readonly string[], signal: AbortSignal, queryKey: readonly unknown[]): Promise<ScoreEvent[]> {
  const previous = queryClient.getQueryData<ScoreEvent[]>(queryKey);
  const merged = mergePoll(previous, await fetchLeagueEvents(league, { countries, signal }));
  if (league.source.kind !== "counterStrike") return merged;
  // Read at poll time, not from a render: the follows, the pin and the view as they are now.
  const s = getSettings();
  const watch = csLiveWatch(merged, (e) => involvesFollowed(s, e), pin.get(), s.landingView === "tiles");
  return keepIdentity(previous, await withLiveRounds(merged, watch, getJSON, signal));
}

export interface ScoreboardOptions {
  /**
   * `true` polls at the page's cadence. `false` reads the same queries
   * without polling (a second reader beside one that polls, so the feeds
   * aren't polled twice). `"auto"` (the app shell's reader) polls only when
   * no `true` reader is mounted, and while the tab is hidden if `background`.
   */
  readonly poll?: boolean | "auto";
  /** With `poll: "auto"`: keep polling while the tab is hidden (a score in the title, alerts to send). */
  readonly background?: boolean;
}

export function useScoreboard({ poll = true, background = false }: ScoreboardOptions = {}): Scoreboard {
  const settings = useSettings(all);
  const pinnedID = usePinnedID();
  const nextGames = useNextGames(settings.followed);
  const countries = climbingCountries(settings);
  const leagues = settings.enabledLeagues.flatMap((id) => leagueWithID(id) ?? []);
  // The cadence is read when each poll lands, from the latest results.
  const interval = useRef(300);

  // Register a visible-cadence poller; an "auto" reader watches the register and the tab.
  useEffect(() => {
    if (poll !== true) return;
    const me = Symbol("poller");
    pollers.add(me);
    pollerListeners.forEach((l) => l());
    return () => {
      pollers.delete(me);
      pollerListeners.forEach((l) => l());
    };
  }, [poll]);
  const othersPoll = useSyncExternalStore(subscribePollers, () => pollers.size > 0, () => true);
  const hidden = useSyncExternalStore(subscribeVisibility, isHidden, () => false);
  const auto = poll === "auto";
  const polling = poll === true || (auto && (hidden ? background : !othersPoll));

  const queries = useQueries({
    queries: leagues.map((league) => ({
      queryKey: scoresKey(league.id, countries),
      queryFn: ({ signal, queryKey }: { signal: AbortSignal; queryKey: readonly unknown[] }) => pollLeague(league, countries, signal, queryKey),
      refetchInterval: polling ? () => interval.current * 1000 : (false as const),
      refetchIntervalInBackground: auto,
    })),
  });

  // Recomputed only when some league's data or error changed, the settings
  // changed, or the minute turned (time windows move): ScoreStore's `version`.
  const minute = Math.floor(useNow(60_000) / 60_000);
  const colors = useLogoColorsVersion();
  const version = queries.reduce((v, q) => v + q.dataUpdatedAt + q.errorUpdatedAt, 0);
  const fetching = queries.some((q) => q.isFetching);

  const derived = useMemo(() => {
    const now = Date.now();
    const results: Record<string, LeagueResult> = {};
    const owner = new Map<string, string>();
    const byID = new Map<string, ScoreEvent>();
    leagues.forEach((league, i) => {
      const q = queries[i];
      if (!q || (q.data === undefined && !q.isError)) return;
      // Teams wear their logos' colors once read (TeamColors); climbing has no crests.
      const events = league.id === "ifsc" ? (q.data ?? []) : wearColors(q.data ?? []);
      results[league.id] = { events, failed: q.isError };
      for (const e of events) {
        if (!owner.has(e.id)) owner.set(e.id, league.id);
        if (!byID.has(e.id)) byID.set(e.id, e);
      }
    });
    const sections = computeSections(results, settings, now, nextGames);
    // A followed team's next game from its schedule isn't in any result: its league comes from the schedule.
    for (const [, games] of nextGames) for (const g of games) if (!owner.has(g.event.id)) owner.set(g.event.id, g.league);
    const leagueOf = (id: string) => owner.get(id);
    const event = (id: string) => byID.get(id);
    const matters = (e: ScoreEvent) => e.id === pinnedID || involvesFollowed(settings, e);
    const cadence = hidden ? backgroundInterval(results, matters, now) : pollInterval(results, settings, now);
    const answered = Object.keys(results).length > 0 || leagues.length === 0;
    return {
      results,
      sections,
      board: buildBoard(sections, settings, leagueOf, event, pinnedID),
      quietLeagues: findQuiet(results, settings, now),
      liveCount: countLive(results, settings),
      status: !answered ? ("loading" as const) : allFailed(results, settings) ? ("offline" as const) : ("ready" as const),
      lastUpdated: queries.reduce<number | null>((t, q) => (q.dataUpdatedAt > 0 ? Math.max(t ?? 0, q.dataUpdatedAt) : t), null),
      leagueOf,
      event,
      cadence,
    };
    // `version` stands for the queries' data; `leagues` and `countries` follow `settings`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, settings, minute, colors, pinnedID, nextGames, hidden]);

  useEffect(() => {
    interval.current = derived.cadence;
  }, [derived.cadence]);

  return {
    settings,
    ...derived,
    fetching,
    refresh: () => queryClient.refetchQueries({ queryKey: ["scores"], type: "active" }),
  };
}
