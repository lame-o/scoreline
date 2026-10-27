/**
 * A game page's data (DetailView.swift `poll`, `LiveEventSync`): the event
 * and its detail, by ID.
 *
 * - The event: the scoreboard's copy when it has one (it stays live with the
 *   sidebar's polls, and matches the row it came from); otherwise built from
 *   the game's own ESPN summary, so any game loads, not only the
 *   scoreboard's. The league comes from the scoreboard, the URL's `?league=`
 *   (`gameHref`), or, failing both, every ESPN league is asked in parallel.
 * - The detail: one query per game, refreshed on DetailView's cadence: live
 *   games every 30 s when a fast lane keeps their moving parts current (15 s
 *   when not), everything else every 2 minutes; a final more than six hours
 *   old loads once. A first load that fails retries after 5 s.
 * - Stale: two failed refreshes in a row on a live game, and the hero says
 *   "Can't connect · Updated 10:42 AM".
 *
 *     const game = useGame(id, { poll: !split, league: search.get("league") });
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { eventFromSummary, fetchDetail, parseESPNDetail, scoreboardURL, summaryURL, type GameDetail } from "../../../data/gameDetail";
import { getJSON } from "../../../data/http";
import { CATALOG, espnPath, leagueWithID } from "../../../data/leagues";
import type { League, ScoreEvent, Sport } from "../../../data/models";
import { pageKind } from "../../../data/sections";
import { useLogoColorsVersion, wearColors } from "../../../state/logoColors";
import { queryClient, useScoreboard } from "../../../state/scores";

export interface GameData {
  /** The freshest copy of the event, or null while loading or when it can't be found. */
  readonly event: ScoreEvent | null;
  readonly detail: GameDetail | null;
  /** "loading" until the event is known; "missing" when no source has it. */
  readonly status: "loading" | "ready" | "missing";
  readonly detailFailed: boolean;
  /** When the detail last loaded (epoch ms). */
  readonly lastLoaded: number | null;
  /** Live and failing: when the page's data is from (epoch ms), else null. */
  readonly staleSince: number | null;
  /** The scoreboard's league for the event, when it came from one. */
  readonly leagueID: string | null;
  /** Refreshes the detail now (a score seen by the fast lane). */
  readonly refresh: () => void;
}

/** The game page's URL (data/gameHref.ts: light enough for the shell to import). */
export { gameHref } from "../../../data/gameHref";

/** Live sports whose fast lane keeps the moving parts current (DetailView.hasFastLane). */
export function hasFastLane(event: ScoreEvent): boolean {
  const kind = pageKind(event.ref);
  return kind === "baseball" || kind === "soccer" || kind === "nba" || kind === "football" || kind === "counterStrike" || kind === "climbing";
}

/** A final that started more than six hours ago: loaded once, never refreshed (DetailView.isHistory). */
export function isHistory(event: ScoreEvent, now = Date.now()): boolean {
  return event.state === "final" && event.start < now - 6 * 3_600_000;
}

/** The detail's refresh interval (ms) after a load (DetailView.poll). */
export function detailInterval(event: ScoreEvent, loaded: boolean): number | false {
  if (!loaded) return 5000;
  if (isHistory(event)) return false;
  if (event.state === "live") return hasFastLane(event) ? 30_000 : 15_000;
  return 120_000;
}

interface Resolved {
  readonly event: ScoreEvent;
  readonly league: string;
}

const ESPN_LEAGUES = CATALOG.filter((l) => l.source.kind === "espn");

/** A game off the scoreboards: its summary, from the hinted league or whichever ESPN league has it. */
async function resolveESPN(gameID: string, hint: League | undefined, signal: AbortSignal): Promise<Resolved | null> {
  const candidates = hint && espnPath(hint) ? [hint] : ESPN_LEAGUES;
  const attempts = candidates.map(async (league) => {
    const path = espnPath(league)!;
    const summary = await getJSON(summaryURL(path, gameID), { signal });
    const event = eventFromSummary(summary, path, league.sport, Date.now());
    if (!event) throw new Error("No event in summary");
    // The summary just read is the detail's first load too.
    queryClient.setQueryData<DetailResult>(["detail", event.id], { detail: parseESPNDetail(summary, { event, path, id: gameID, sport: league.sport }), event });
    return { event, league: league.id };
  });
  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

interface DetailResult {
  readonly detail: GameDetail;
  /** The event as the summary has it (for games off the scoreboards, which nothing else refreshes). */
  readonly event: ScoreEvent | null;
}

/** ESPN's detail with the event its summary describes; other sources' detail alone. */
async function loadDetail(event: ScoreEvent, signal: AbortSignal): Promise<DetailResult> {
  const ref = event.ref;
  if (ref?.kind !== "espn") return { detail: await fetchDetail(event, getJSON, { signal }), event: null };
  const needsSituation = event.state === "live" && (ref.sport === "football" || ref.sport === "baseball");
  const [summary, board] = await Promise.all([
    getJSON(summaryURL(ref.path, ref.id), { signal }),
    needsSituation ? getJSON(scoreboardURL(ref.path), { signal }).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    detail: parseESPNDetail(summary, { event, path: ref.path, id: ref.id, sport: ref.sport, board }),
    event: eventFromSummary(summary, ref.path, ref.sport as Sport, Date.now()),
  };
}

export function useGame(id: string, { poll, league }: { poll: boolean; league: string | null }): GameData {
  const scores = useScoreboard({ poll });
  const boardEvent = scores.event(id) ?? null;
  const hint = league ? leagueWithID(league) : undefined;

  // Off the scoreboards: find the game by its ID (ESPN only; bo3.gg and IFSC
  // games come with their refs from the scoreboard).
  const espnID = id.startsWith("espn-") ? id.slice(5) : null;
  const lookup = useQuery({
    queryKey: ["game-event", id, hint?.id ?? null],
    queryFn: ({ signal }) => resolveESPN(espnID!, hint, signal),
    enabled: !boardEvent && espnID != null && scores.status !== "loading",
    staleTime: Infinity,
    retry: 1,
  });

  const failures = useRef(0);
  const baseEvent = boardEvent ?? lookup.data?.event ?? null;
  const latest = useRef(baseEvent);
  latest.current = baseEvent;

  const detail = useQuery({
    queryKey: ["detail", baseEvent?.id ?? id],
    queryFn: async ({ signal }) => {
      const event = latest.current!;
      try {
        const result = await loadDetail(event, signal);
        failures.current = 0;
        return result;
      } catch (error) {
        failures.current += 1;
        throw error;
      }
    },
    enabled: baseEvent != null,
    retry: false,
    staleTime: 5000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (latest.current ? detailInterval(latest.current, query.state.data != null) : false),
  });

  // A game off the scoreboards stays current through its own summary, and wears its crests' colors like the rest.
  const summaryEvent = detail.data?.event ?? null;
  const offBoard = boardEvent ? null : ((summaryEvent && lookup.data ? summaryEvent : lookup.data?.event) ?? null);
  const colors = useLogoColorsVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const worn = useMemo(() => (offBoard ? (wearColors([offBoard])[0] ?? offBoard) : null), [offBoard, colors]);
  const event = boardEvent ?? worn;
  const loaded = detail.data?.detail ?? null;
  const lastLoaded = detail.dataUpdatedAt || null;
  const staleSince = event?.state === "live" && loaded && failures.current >= 2 ? lastLoaded : event?.state === "live" && scores.status === "offline" ? scores.lastUpdated : null;

  const status: GameData["status"] = event
    ? "ready"
    : scores.status === "loading" || lookup.isLoading || lookup.fetchStatus === "fetching"
      ? "loading"
      : espnID == null || lookup.isFetched
        ? "missing"
        : "loading";

  return {
    event,
    detail: loaded,
    status,
    detailFailed: detail.isError && !detail.data,
    lastLoaded,
    staleSince,
    leagueID: (boardEvent ? scores.leagueOf(id) : lookup.data?.league) ?? null,
    refresh: () => void detail.refetch(),
  };
}
