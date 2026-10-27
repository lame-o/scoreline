/**
 * Each followed team's coming games from its own schedule
 * (ScheduleStore.refreshNextGames), so My Teams can show the next one when
 * it's beyond the scoreboards' window: a quiet week, or a cup tie in a
 * league you don't show. One query per team, through the schedule layer's
 * cache (`fetchTeam`), refreshed every six hours. The schedule code loads
 * on demand, only once a team is followed, so the first paint never carries it.
 *
 * Which of these games My Teams shows is decided at derive time with the
 * clock and the scoreboards (`fallbackGames` in data/scoreboard.ts), so a
 * game that has just ended never stands in for the next one.
 */
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import type { FollowedTeam } from "../data/models";
import { itemEvent } from "../data/schedule";
import type { NextGame } from "../data/scoreboard";

const SIX_HOURS = 6 * 3_600_000;
/** Enough to step past a game that just ended or two; the window is three weeks. */
const KEEP = 4;

export const nextGamesKey = (teamID: string) => ["nextGames", teamID] as const;

async function load(team: FollowedTeam): Promise<NextGame[]> {
  const { fetchTeam } = await import("./schedule");
  const fetched = await fetchTeam({ id: team.id, name: team.name, logo: team.logo });
  const floor = Date.now() - 3 * 3_600_000;
  return fetched.items
    .filter((i) => i.status === "scheduled" || i.status === "live")
    .map((i) => ({ event: itemEvent(i), league: i.league }))
    .filter((g) => g.event.start > floor)
    .sort((a, b) => a.event.start - b.event.start)
    .slice(0, KEEP);
}

const EMPTY: ReadonlyMap<string, readonly NextGame[]> = new Map();

/** Team ID → its next few games. Empty until loaded (and with no teams followed). */
export function useNextGames(followed: readonly FollowedTeam[]): ReadonlyMap<string, readonly NextGame[]> {
  const queries = useQueries({
    queries: followed.map((team) => ({
      queryKey: nextGamesKey(team.id),
      queryFn: () => load(team),
      staleTime: SIX_HOURS,
      gcTime: SIX_HOURS,
      refetchInterval: SIX_HOURS,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  });
  const version = queries.map((q) => q.dataUpdatedAt).join();
  return useMemo(() => {
    if (followed.length === 0) return EMPTY;
    const map = new Map<string, readonly NextGame[]>();
    followed.forEach((team, i) => {
      const data = queries[i]?.data;
      if (data && data.length > 0) map.set(team.id, data);
    });
    return map.size > 0 ? map : EMPTY;
    // `version` stands for the queries' data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, followed]);
}
