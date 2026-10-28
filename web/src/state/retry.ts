/**
 * How a page's data fails and recovers: ScoreStore's retry ladder, for every
 * page (ScoreStore.swift `retryDelay`; ProfileStore's failed parts).
 *
 * The Mac shows a page's error as soon as its load fails, keeps what it had
 * when a refresh fails, and keeps trying on its own: 5, 15, 30, then every
 * 60 seconds. A page's query does the same with `retrying()`:
 *
 * - No retries inside a fetch: the first failure is the query's error at
 *   once, so the page says so instead of holding its placeholders for the
 *   20–50 s a chain of retries takes.
 * - Then `refetchInterval` asks again on the ladder while the page is open
 *   and the tab visible. Offline, nothing is asked until the browser is back
 *   (refetchOnReconnect). A 404 is an answer, never asked again.
 * - A query whose function answers with a failure of its own instead of
 *   throwing (the schedules' `ok: false`, one source down of several) says
 *   so with `failed`, and climbs the same ladder.
 *
 * `loadState(query)` reads it for a page: `failed` from the first failure on,
 * through every attempt after it (TanStack puts a query without data back to
 * "pending" while it asks again, which would flash the placeholders between
 * the error and its retry); `retrying` while an attempt is out; `stale` when
 * a refresh failed under data the page still shows.
 *
 *     const table = useQuery({ queryKey, queryFn, ...retrying({ every: TEN_MINUTES }) });
 *     const { failed, retrying, stale } = loadState(table);
 *     failed ? <ErrorState subject="Table" retrying={retrying} … /> : …
 */
import type { Query, QueryObserverResult } from "@tanstack/react-query";
import { HTTPError } from "../data/http";
import { retryDelay } from "../data/scoreboard";

/** The source answered that there's nothing there (nobody by that ID): asking again won't change it. */
export const isAnswer = (error: unknown): boolean => error instanceof HTTPError && error.status === 404;

const online = () => typeof navigator === "undefined" || navigator.onLine !== false;

// MARK: - The ladder

/** What `retrying` remembers per query: the counts it last saw, and failures since the last good answer. */
interface Streak {
  readonly dataCount: number;
  readonly errorCount: number;
  readonly failures: number;
}

// Keyed by the query itself, so an entry goes when the query is collected.
const streaks = new WeakMap<object, Streak>();

type AnyQuery = Query<any, any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Failures in a row since the last good answer: thrown errors, and answers
 * that `failed` calls failures. Idempotent (TanStack asks for the interval
 * on every change of the query, and again from each observer), and never
 * less than 1 while the latest outcome is a failure, even for a query first
 * seen mid-streak.
 */
export function failureStreak<T>(query: AnyQuery, failed?: (data: T) => boolean): number {
  const s = query.state;
  const badData = s.data !== undefined && failed?.(s.data as T) === true;
  const latestFailed = s.status === "error" || s.errorUpdatedAt > s.dataUpdatedAt || badData;
  const seen = streaks.get(query);
  let failures: number;
  if (!seen) {
    // First sight: every error counts if it has never answered; otherwise only that the latest failed.
    failures = s.dataUpdateCount === 0 ? s.errorUpdateCount : 0;
  } else {
    failures = s.dataUpdateCount !== seen.dataCount ? (badData ? seen.failures + 1 : 0) : seen.failures;
    failures += s.errorUpdateCount - seen.errorCount;
  }
  failures = latestFailed ? Math.max(failures, 1) : 0;
  streaks.set(query, { dataCount: s.dataUpdateCount, errorCount: s.errorUpdateCount, failures });
  return failures;
}

export interface RetryingOptions<T> {
  /** The query's own cadence when nothing is failing (ms, or false: it doesn't poll). */
  readonly every?: number | false | ((query: AnyQuery) => number | false | undefined);
  /** An answer that is a failure of its own (`ok: false` with nothing to show): climbs the ladder too. */
  readonly failed?: (data: T) => boolean;
}

/**
 * A page query's failure policy: its first failure shows at once, then it
 * asks again at 5, 15, 30 and every 60 seconds while it's on screen.
 *
 *     useQuery({ queryKey, queryFn, staleTime, ...retrying() })
 *     useQuery({ queryKey, queryFn, ...retrying({ every: 60_000, failed: (page) => !page.ok }) })
 */
export function retrying<T>({ every = false, failed }: RetryingOptions<T> = {}) {
  return {
    retry: false as const,
    refetchIntervalInBackground: false,
    refetchInterval: (query: AnyQuery): number | false => {
      const n = failureStreak(query, failed);
      const error = query.state.status === "error" || query.state.errorUpdatedAt > query.state.dataUpdatedAt ? query.state.error : null;
      if (n > 0 && online() && !isAnswer(error)) return retryDelay(n) * 1000;
      const base = typeof every === "function" ? every(query) : every;
      return base ?? false;
    },
  };
}

// MARK: - Reading it

export interface LoadState {
  /** Nothing to show yet and no failure so far: the placeholders. */
  readonly loading: boolean;
  /** Nothing to show, and the load failed (from its first failure, through every retry after). */
  readonly failed: boolean;
  /** An attempt is out (the error state's "Retrying…"). */
  readonly retrying: boolean;
  /** Showing data whose latest refresh failed (the page's "Can't connect · Showing … from 10:42 AM"). */
  readonly stale: boolean;
  /** When the data shown arrived (epoch ms), or null. */
  readonly updated: number | null;
}

type Readable = Pick<QueryObserverResult<unknown, unknown>, "data" | "isError" | "isFetching" | "isPlaceholderData" | "failureCount" | "errorUpdateCount" | "dataUpdatedAt" | "fetchStatus" | "error">;

/** True when a query has nothing of its own to show and has failed at least once since (its retries may be going on). */
export function hasFailed(q: Readable): boolean {
  const own = q.data !== undefined && !q.isPlaceholderData;
  return !own && (q.isError || q.failureCount > 0 || q.errorUpdateCount > 0);
}

/** A page's reading of one query (see the header). */
export function loadState(q: Readable): LoadState {
  const own = q.data !== undefined && !q.isPlaceholderData;
  const failed = hasFailed(q);
  return {
    loading: !own && !failed && q.data === undefined,
    failed,
    retrying: failed && q.isFetching,
    stale: own && (q.isError || q.failureCount > 0),
    updated: own && q.dataUpdatedAt > 0 ? q.dataUpdatedAt : null,
  };
}
