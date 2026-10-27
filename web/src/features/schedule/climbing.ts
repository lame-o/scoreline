/**
 * Climbing in the All scope: the season's competitions (from the season
 * pages' store, `useClimbingSeasons`, already cut to the disciplines you
 * follow) as agenda items. The season loads only while climbing is enabled:
 * a small feed component mounts when it is and hands its data over, so the
 * page's hooks never change order.
 */
import { createElement, useEffect, useSyncExternalStore, type ReactElement } from "react";
import type { SeasonEvent } from "../../data/schedule";
import { useClimbingSeasons } from "../../state/seasons";

export interface ClimbingFeedData {
  readonly events: readonly SeasonEvent[];
  readonly ready: boolean;
  readonly ok: boolean;
  /** Bumped with every change (the agenda rebuilds on it). */
  readonly version: number;
}

let current: ClimbingFeedData | null = null;
const listeners = new Set<() => void>();

function publish(next: ClimbingFeedData | null) {
  current = next;
  listeners.forEach((l) => l());
}

function Feed(): null {
  const seasons = useClimbingSeasons();
  useEffect(() => {
    publish({ events: seasons.events, ready: seasons.status !== "loading", ok: seasons.status !== "failed", version: (current?.version ?? 0) + 1 });
  }, [seasons.events, seasons.status]);
  useEffect(() => () => publish(null), []);
  return null;
}

/** Mount beside a page that shows climbing in its agenda. */
export function ClimbingFeed({ enabled }: { enabled: boolean }): ReactElement | null {
  return enabled ? createElement(Feed) : null;
}

/** The climbing season for the agenda, or null while climbing isn't shown. */
export function useClimbingSeasonsForAgenda(enabled: boolean): ClimbingFeedData | null {
  const data = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
  return enabled ? data : null;
}
