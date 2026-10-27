/**
 * Statcast for the play on the theater (Statcast.swift `StatcastStore`):
 * which MLB game an ESPN one is (MLB's schedule for its Eastern date, by
 * both teams' names), and that game's at-bats. The feed is fetched once,
 * and again only when the play on screen is one it doesn't have yet
 * (Statcast posts a few seconds after ESPN), at most every 8 s and only for
 * a play from the last two minutes: never on the live lane's clock.
 *
 *     const line = useStatcastLine(event, state.play);   // "104.4 MPH · 12° · 273 FT"
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { getJSON } from "../../../../data/http";
import type { ScoreEvent } from "../../../../data/models";
import type { PlayScene } from "../../../../data/mlb/playScene";
import { battedLine, feedURL, matchScene, scheduleURL, statcastAtBats, statcastGame } from "../../../../data/mlb/statcast";

const MINIMUM_INTERVAL_MS = 8_000;
const RECENT_MS = 120_000;

function isMLB(event: ScoreEvent): boolean {
  return event.ref?.kind === "espn" && event.ref.sport === "baseball" && event.ref.path.endsWith("/mlb");
}

export function useStatcastLine(event: ScoreEvent, play: PlayScene | null, names: Readonly<Record<string, string>> = {}): string | null {
  const teams = event.content.kind === "match" ? [event.content.top.name, event.content.bottom.name] : [];
  const enabled = isMLB(event) && teams.length === 2 && play != null && play.inPlay;
  const game = useQuery({
    queryKey: ["statcast", "game", event.id],
    queryFn: async ({ signal }) => statcastGame(await getJSON(scheduleURL(event.start), { signal }), teams),
    enabled,
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const gamePk = game.data ?? null;
  const feed = useQuery({
    queryKey: ["statcast", "feed", gamePk],
    queryFn: async ({ signal }) => statcastAtBats(await getJSON(feedURL(gamePk!), { signal })),
    enabled: enabled && gamePk != null,
    staleTime: event.state === "final" ? Infinity : MINIMUM_INTERVAL_MS,
    gcTime: 15 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const found = feed.data && play ? matchScene(play, feed.data, names) : null;
  const missing = enabled && feed.data != null && found == null && play?.wallclock != null && Date.now() - play.wallclock < RECENT_MS;
  const { refetch, dataUpdatedAt, isFetching } = feed;
  useEffect(() => {
    if (!missing || isFetching) return;
    const wait = Math.max(MINIMUM_INTERVAL_MS - (Date.now() - dataUpdatedAt), 0);
    const timer = setTimeout(() => void refetch(), wait);
    return () => clearTimeout(timer);
  }, [missing, isFetching, dataUpdatedAt, refetch, play?.id]);
  return found?.batted ? battedLine(found.batted) : null;
}
