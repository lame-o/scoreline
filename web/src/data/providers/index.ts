/**
 * One entry point for a league's scores, whatever its source
 * (Providers.swift `Providers.events`). All sources are public, keyless
 * JSON read through the `/api/*` proxy; parsing is lenient (see json.ts).
 */
import { getJSON, type Fetcher } from "../http";
import type { League, ScoreEvent } from "../models";
import { fetchCounterStrike } from "./counterStrike";
import { fetchESPN } from "./espn";
import { fetchClimbing } from "./ifsc";

export interface FetchOptions {
  /** Climbing: countries whose best-placed athlete gets called out (IOC codes). */
  readonly countries?: readonly string[];
  readonly signal?: AbortSignal;
  /** Tests pass a fixture replayer. */
  readonly fetcher?: Fetcher;
}

export function fetchLeagueEvents(league: League, options: FetchOptions = {}): Promise<ScoreEvent[]> {
  const fetcher = options.fetcher ?? getJSON;
  switch (league.source.kind) {
    case "espn":
      return fetchESPN(league.source.path, league.source.weekly, league.sport, fetcher, options.signal);
    case "counterStrike":
      return fetchCounterStrike(fetcher, options.signal);
    case "ifsc":
      return fetchClimbing(options.countries ?? [], fetcher, options.signal);
  }
}
