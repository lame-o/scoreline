/**
 * MLB's feed for the play on the theater (Statcast.swift `StatcastStore`,
 * LiveFeeds.swift `BaseballFeed.measure` and `publish`): which MLB game an
 * ESPN one is (MLB's schedule for its Eastern date, by both teams' names),
 * that game's at-bats, and the play's own at-bat in them once it's over
 * (`PlayScene.measurement`, `runnerMeasurement`): what Statcast measured,
 * and MLB's official account of the runners and fielders, which the
 * choreography follows.
 *
 * - Over means over: an at-bat MLB hasn't completed ("Mound Visit" is an
 *   event too) or a ball in play whose hitData hasn't posted (it can trail
 *   the result by seconds) isn't the play's yet, and the feed is asked again
 *   (every few seconds, only while the play is recent; never on the live
 *   lane's clock), until it is.
 * - A new play that replays waits up to `MEASURE_HOLD_MS` for it, then goes
 *   with ESPN's account alone (the field keeps the last play meanwhile); a
 *   measurement that lands later reaches the play once its replay is done
 *   (PlayTheater keeps the play a replay began with).
 *
 *     const shown = useMeasuredTheater(event, state);   // state.play.measured, when found
 *     shown.play?.readout;                               // "104.4 MPH · 12° · 273 FT"
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useReducer, useRef } from "react";
import { getJSON } from "../../../../data/http";
import type { ScoreEvent } from "../../../../data/models";
import type { Measured, TheaterState } from "../../../../data/mlb/playScene";
import { feedURL, liveURL, scheduleURL, statcastAtBats, statcastGame, statcastLive, type StatcastAtBat } from "../../../../data/mlb/statcast";

/** Statcast.swift `StatcastStore.minimumInterval`: the feed is asked again no sooner than this. */
const MINIMUM_INTERVAL_MS = 2_000;
/** While a recent play's at-bat isn't over in it, the feed is asked again this often (its edge copy lives 15 s). */
const RETRY_MS = 5_000;
/** A play this recent is still worth asking for (Statcast posts a few seconds after ESPN; ESPN 15–45 s after the play). */
const RECENT_MS = 120_000;
/** LiveFeeds.swift `BaseballFeed.measureHold`: how long a new play waits for MLB's account before it replays. */
export const MEASURE_HOLD_MS = 3_000;

function isMLB(event: ScoreEvent): boolean {
  return event.ref?.kind === "espn" && event.ref.sport === "baseball" && event.ref.path.endsWith("/mlb");
}

export function useMeasuredTheater(event: ScoreEvent, state: TheaterState): TheaterState {
  const teams = event.content.kind === "match" ? [event.content.top.name, event.content.bottom.name] : [];
  const play = state.play;
  const enabled = isMLB(event) && teams.length === 2 && play != null && (play.appearance != null || play.during != null);
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

  // The play's own at-bat, once it's over; one object per play and reading, so the script is built once.
  const found = useMemo(() => (play && feed.data ? (play.measurement(feed.data) ?? play.runnerMeasurement(feed.data)) : null), [play, feed.data]);
  const kept = useRef<{ key: string; measured: Measured } | null>(null);
  const key = play && found ? `${play.id}|${JSON.stringify(found)}` : null;
  if (key != null && found && kept.current?.key !== key) kept.current = { key, measured: found };
  const measured = key != null && kept.current?.key === key ? kept.current.measured : null;

  // Not there yet (or not over): asked again while the play is recent.
  const missing = enabled && feed.data != null && measured == null && play?.wallclock != null && Date.now() - play.wallclock < RECENT_MS;
  const { refetch, dataUpdatedAt, isFetching } = feed;
  useEffect(() => {
    if (!missing || isFetching) return;
    const wait = Math.max(RETRY_MS - (Date.now() - dataUpdatedAt), 0);
    const timer = setTimeout(() => void refetch(), wait);
    return () => clearTimeout(timer);
  }, [missing, isFetching, dataUpdatedAt, refetch, play?.id]);

  // The play with MLB's account in it (a copy: the lane's object stays ESPN's).
  const measuredPlay = useMemo(() => (play && measured ? play.copy({ measured }) : play), [play, measured]);
  const next: TheaterState = measuredPlay === play ? state : { ...state, play: measuredPlay };

  // A new play to replay is held (the field keeps the last one) until it's measured, or for the hold.
  const shown = useRef<TheaterState | null>(null);
  const hold = useRef<{ id: string; since: number } | null>(null);
  const [, wake] = useReducer((n: number) => n + 1, 0);
  const unknown = game.isError || (game.isFetched && gamePk == null) || feed.isError;
  const fresh = play != null && state.news && play.id !== shown.current?.play?.id;
  if (fresh && hold.current?.id !== play.id) hold.current = { id: play.id, since: Date.now() };
  const left = fresh && hold.current ? MEASURE_HOLD_MS - (Date.now() - hold.current.since) : 0;
  const holding = enabled && fresh && measured == null && !unknown && left > 0;
  useEffect(() => {
    if (!holding) return;
    const timer = setTimeout(wake, left + 10);
    return () => clearTimeout(timer);
  }, [holding, left]);
  if (holding) return shown.current ?? { ...state, play: null };
  shown.current = next;
  return next;
}

/** Statcast.swift `StatcastStore.liveInterval`: MLB's at-bat under way, no more often than this. */
export const LIVE_POLL_MS = 4_500;

/**
 * MLB's at-bats for the theater's timeline (LiveFeeds.swift `BaseballFeed`'s
 * live poll and `rebuildTimeline`): the game's full feed as it's cached when
 * plays are measured, and the at-bat under way, polled on its own pace (a few
 * kilobytes) while the game is live and the page is visible. Its status says
 * a delay before ESPN's does ("Delayed: Rain").
 */
export function useMLBTimeline(event: ScoreEvent, live: boolean): { readonly atBats: readonly StatcastAtBat[]; readonly status: string | null } {
  const teams = event.content.kind === "match" ? [event.content.top.name, event.content.bottom.name] : [];
  const enabled = isMLB(event) && teams.length === 2 && live;
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
    staleTime: 60_000,
    gcTime: 15 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const current = useQuery({
    queryKey: ["statcast", "live", gamePk],
    queryFn: async ({ signal }) => statcastLive(await getJSON(liveURL(gamePk!), { signal })),
    enabled: enabled && gamePk != null,
    staleTime: LIVE_POLL_MS,
    refetchInterval: LIVE_POLL_MS,
    refetchIntervalInBackground: false,
    gcTime: 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  });
  const atBats = useMemo(() => {
    const all = [...(feed.data ?? [])];
    const now = current.data?.atBat;
    if (now) {
      const i = all.findIndex((a) => a.index === now.index);
      if (i >= 0) all[i] = now;
      else all.push(now);
    }
    return all;
  }, [feed.data, current.data]);
  return { atBats, status: current.data?.status ?? null };
}
