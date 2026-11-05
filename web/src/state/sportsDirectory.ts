/**
 * Every team list a sport's page or Sports' search has asked for, kept for
 * the session (SportsView.swift `SportsDirectory`): one query per league
 * (`["teams", id]`, the pick lists' own, so the two share a cache), the
 * whole search index loaded four lists at a time. React reads it through
 * `useSportsDirectory()`, which re-renders as lists arrive.
 */
import { useSyncExternalStore } from "react";
import { getJSON } from "../data/http";
import type { League } from "../data/models";
import { teamOptions, type TeamOption } from "../data/providers/teams";
import { indexedLeagues } from "../data/sportsSearch";
import { queryClient } from "./scores";

export interface DirectorySnapshot {
  readonly teams: Readonly<Record<string, readonly TeamOption[]>>;
  readonly failed: ReadonlySet<string>;
  /** The whole index is loading (the search's "Looking through every team…"). */
  readonly indexing: boolean;
}

let snapshot: DirectorySnapshot = { teams: {}, failed: new Set(), indexing: false };
const listeners = new Set<() => void>();
const loading = new Set<string>();

function set(next: Partial<DirectorySnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
}

/** A league's teams, once (a failed list can be asked for again). */
export async function loadTeams(league: League): Promise<void> {
  if (snapshot.teams[league.id] || loading.has(league.id)) return;
  loading.add(league.id);
  try {
    const options = await queryClient.fetchQuery({
      queryKey: ["teams", league.id],
      queryFn: ({ signal }) => teamOptions(league, getJSON, signal),
      staleTime: 6 * 3_600_000,
    });
    const failed = new Set(snapshot.failed);
    failed.delete(league.id);
    set({ teams: { ...snapshot.teams, [league.id]: options }, failed });
  } catch {
    set({ failed: new Set([...snapshot.failed, league.id]) });
  } finally {
    loading.delete(league.id);
  }
}

/** The whole search index, four lists at a time. */
export async function loadAllTeams(): Promise<void> {
  const missing = indexedLeagues().filter((l) => !snapshot.teams[l.id]);
  if (missing.length === 0 || snapshot.indexing) return;
  set({ indexing: true });
  try {
    for (let i = 0; i < missing.length; i += 4) await Promise.all(missing.slice(i, i + 4).map(loadTeams));
  } finally {
    set({ indexing: false });
  }
}

export function useSportsDirectory(): DirectorySnapshot {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
    () => snapshot,
  );
}
