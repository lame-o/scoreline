/**
 * Each page kind's hook (core/sport.tsx explains the seam), loaded on
 * demand: a sport's page, its charts and its lane are their own chunk, so a
 * soccer page never downloads the NBA court or the MLB theater.
 *
 * `sportPage(kind)` returns one promise per kind, marked settled the way
 * React's `use` reads a thenable, so a page whose chunk is already here
 * renders on its first pass with no fallback. `warmSportPages` loads the
 * kinds of the leagues a user follows once the list has painted (AppShell),
 * so a click rarely waits.
 */
import { leaguePageKind, type PageKind } from "../../data/sections";
import type { League } from "../../data/models";
import type { UseSportPage } from "./core/sport";
import { useCommonSections } from "./core/useCommonSections";

/** The generic ESPN page: the shared sections only (CS2 and climbing until their pages land). */
const useGenericPage: UseSportPage = (game) => ({ sections: useCommonSections(game) });
/** The generic page is part of the game page's own chunk: nothing to load. */
const GENERIC = (): Promise<UseSportPage> => Promise.resolve(useGenericPage);

/**
 * Each page kind's hook, behind a dynamic import (its own chunk). A new
 * sport adds a line: `kind: () => import("./x/XPage").then((m) => m.useXPage)`.
 */
export const SPORT_PAGES: Readonly<Record<PageKind, () => Promise<UseSportPage>>> = {
  baseball: () => import("./mlb/BaseballPage").then((m) => m.useBaseballPage),
  football: () => import("./football/FootballPage").then((m) => m.useFootballPage),
  soccer: () => import("./soccer/SoccerPage").then((m) => m.useSoccerPage),
  nba: () => import("./nba/BasketballPage").then((m) => m.useBasketballPage),
  espn: GENERIC,
  counterStrike: GENERIC,
  climbing: GENERIC,
  none: GENERIC,
};

/** A promise React's `use` reads synchronously once settled. */
type Tracked<T> = Promise<T> & { status?: "pending" | "fulfilled" | "rejected"; value?: T; reason?: unknown };

const loaded = new Map<PageKind, Tracked<UseSportPage>>();

function settled<T>(value: T): Tracked<T> {
  return Object.assign(Promise.resolve(value), { status: "fulfilled" as const, value });
}

/** The hook for a page kind, loading its chunk the first time (a failed load is retried on the next call). */
export function sportPage(kind: PageKind): Promise<UseSportPage> {
  const known = loaded.get(kind);
  if (known) return known;
  const load = SPORT_PAGES[kind];
  if (load === GENERIC) {
    const ready = settled(useGenericPage);
    loaded.set(kind, ready);
    return ready;
  }
  const promise: Tracked<UseSportPage> = load();
  promise.status = "pending";
  promise.then(
    (value) => {
      promise.status = "fulfilled";
      promise.value = value;
    },
    (reason: unknown) => {
      promise.status = "rejected";
      promise.reason = reason;
      loaded.delete(kind);
    },
  );
  loaded.set(kind, promise);
  return promise;
}

/** Loads the pages of these leagues' games ahead of a click. */
export function warmSportPages(leagues: readonly League[]): void {
  for (const kind of new Set(leagues.map(leaguePageKind))) void sportPage(kind).catch(() => {});
}
