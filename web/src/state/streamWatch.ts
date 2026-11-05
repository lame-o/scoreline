/**
 * Keeps what's streaming current (state/streams.ts), as ScoreStore does on
 * each refresh (`updateBroadcast`, `updateCoStream`). Runs in the shell's
 * LiveServices, beside every page, loaded after the first paint.
 *
 * - World Climbing's `/live` page, only while climbing is shown and a
 *   competition is underway or starts within two days (the page is about
 *   1.3 MB): every 10 minutes, every minute around a scheduled start, every
 *   2 while live. A failed look (or a consent or bot page) keeps what was
 *   known; out of season it's forgotten.
 * - The co-streamer's Twitch status (decapi.me) at most every 2 minutes,
 *   only while co-streams are on and a CS2 match is live; their avatar once.
 *   bo3.gg's listing (the match page's `streams.confirm`) holds on its own.
 *
 * Nothing polls in a hidden tab (the queries' default).
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { broadcastInterval, competitionNear, LIVE_URL, type ClimbingBroadcast } from "../data/climbingBroadcast";
import { coStreamAvatar, coStreamHandle, coStreamMatches, coStreamStatus } from "../data/coStream";
import { getText } from "../data/http";
import type { LeagueResult } from "../data/models";
import type { Settings } from "./settings";
import { streams } from "./streams";

const MINUTE = 60_000;

export const streamKeys = {
  climbing: ["streams", "youtube", "live"] as const,
  coStream: (handle: string) => ["streams", "twitch", handle] as const,
  avatar: (handle: string) => ["streams", "twitch", "avatar", handle] as const,
};

/** World Climbing's current or next stream; throws on a page that isn't the channel's (no answer). */
export async function fetchClimbingBroadcast(signal?: AbortSignal): Promise<ClimbingBroadcast | null> {
  const [{ parseLivePage }, html] = await Promise.all([import("../data/youtube"), getText(LIVE_URL, { signal })]);
  const b = parseLivePage(html);
  if (b === undefined) throw new Error("World Climbing's live page didn't answer (a consent or bot page)");
  return b;
}

export function useStreamWatch(results: Readonly<Record<string, LeagueResult>>, settings: Settings): void {
  const now = Date.now();

  // MARK: World Climbing (ScoreStore.updateBroadcast)
  const climbingEvents = results.ifsc?.events;
  const near = settings.enabledLeagues.includes("ifsc") && competitionNear(climbingEvents ?? [], now);
  const climbing = useQuery({
    queryKey: streamKeys.climbing,
    queryFn: ({ signal }) => fetchClimbingBroadcast(signal),
    enabled: near,
    staleTime: 50_000,
    refetchInterval: (query) => broadcastInterval(query.state.data ?? null, Date.now()),
    // A failed look keeps what was known; the next interval asks again.
    retry: false,
  });
  useEffect(() => {
    streams.setClimbing(near ? (climbing.data ?? null) : null);
  }, [near, climbing.data]);

  // MARK: The co-streamer (ScoreStore.updateCoStream)
  const handle = settings.showCoStream ? coStreamHandle(settings.coStreamer) : null;
  const cs = results.cs2?.events;
  const live = useMemo(() => (cs ?? []).filter((e) => e.state === "live"), [cs]);
  const watching = handle != null && live.length > 0;
  const status = useQuery({
    queryKey: streamKeys.coStream(handle ?? ""),
    queryFn: ({ signal }) => coStreamStatus(handle!, getText, signal),
    enabled: watching,
    staleTime: 110_000,
    refetchInterval: 2 * MINUTE,
    retry: false,
  });
  const avatar = useQuery({
    queryKey: streamKeys.avatar(handle ?? ""),
    queryFn: ({ signal }) => coStreamAvatar(handle!, getText, signal),
    enabled: watching,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  useEffect(() => {
    if (!handle || live.length === 0) {
      streams.clearCoStream();
      return;
    }
    const byTitle = status.data ? coStreamMatches(status.data, live) : new Set<string>();
    streams.setCoStream(handle, byTitle, new Set(live.map((e) => e.id)), avatar.data ?? null);
  }, [handle, live, status.data, avatar.data]);
}
