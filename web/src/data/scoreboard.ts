/**
 * What the scores page shows, derived from league results and preferences:
 * a port of ScoreStore.swift's pure parts. Sections in the user's order with
 * My Teams first, filters (picks, college Top 25, climbing disciplines), the
 * visibility window (how long finals linger, how far ahead to look), the
 * tile board's tiers, the poll cadence, and what carries over between polls.
 *
 * Everything here is a function of its inputs and `now`, so the page can
 * memoize it and the tests can pin it down.
 */
import { clockReading } from "./clock";
import { leagueWithID } from "./leagues";
import type { Competitor, FollowedTeam, League, LeagueResult, ScoreEvent, Sport } from "./models";
import { competitorKey, competitors, STATE_ORDER, withChanges } from "./models";

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** The preferences the list is derived from (a slice of Settings). */
export interface ListPreferences {
  readonly enabledLeagues: readonly string[];
  readonly followed: readonly FollowedTeam[];
  /** League → picked team IDs (climbing: "country-SLO"). */
  readonly teamFilters: Readonly<Record<string, readonly string[]>>;
  /** Leagues where the pick filter is on (picks are kept when it's off). */
  readonly filteredLeagues: readonly string[];
  readonly collegeTop25Only: boolean;
  readonly climbingDisciplines: readonly string[];
  readonly showFinished: boolean;
  readonly liveFirst: boolean;
}

export interface Section {
  /** A league ID, or "my-teams". */
  readonly id: string;
  readonly title: string;
  readonly sport: Sport | null;
  readonly events: readonly ScoreEvent[];
  /** The league's last refresh failed and there's nothing to show. */
  readonly failed: boolean;
  readonly liveCount: number;
}

export const MY_TEAMS = "my-teams";

/** Every live game, then at most this many on either side of now, per league. */
const PER_STATE_LIMIT = 3;

/** Live first; upcoming soonest first; finals newest first. */
export function eventOrder(a: ScoreEvent, b: ScoreEvent): number {
  if (a.state !== b.state) return STATE_ORDER[a.state] - STATE_ORDER[b.state];
  return a.state === "final" ? b.start - a.start : a.start - b.start;
}

export function isFollowing(prefs: ListPreferences, c: Competitor): boolean {
  return c.id != null && prefs.followed.some((t) => t.id === c.id);
}

export function involvesFollowed(prefs: ListPreferences, event: ScoreEvent): boolean {
  return competitors(event).some((c) => isFollowing(prefs, c));
}

/** Climbing countries whose athletes get called out (IOC codes), when the climbing filter is on. */
export function climbingCountries(prefs: ListPreferences): string[] {
  if (!prefs.filteredLeagues.includes("ifsc")) return [];
  return (prefs.teamFilters["ifsc"] ?? []).map((id) => id.replace("country-", "")).sort();
}

// MARK: - Climbing disciplines

export const CLIMBING_DISCIPLINES = ["boulder", "lead", "speed"] as const;

/** The disciplines a category or round name mentions ("Boulder & Lead Women"); null for none. */
export function disciplinesOf(name: string): Set<string> | null {
  const lower = name.toLowerCase();
  const found = new Set(CLIMBING_DISCIPLINES.filter((d) => lower.includes(d)));
  return found.size > 0 ? found : null;
}

// MARK: - Filters and the window

/**
 * Head-to-head events limited to the picked teams. Climbing rounds aren't
 * filtered by country (countries highlight athletes instead), only by the
 * disciplines shown. College shows the Top 25's games and your teams', not
 * all sixty-odd FBS games.
 */
export function filtered(events: readonly ScoreEvent[], league: League, prefs: ListPreferences): readonly ScoreEvent[] {
  if (league.source.kind === "ifsc") {
    return events.filter((e) => {
      if (e.ref?.kind !== "climbing") return true;
      const found = disciplinesOf(e.ref.category);
      return found == null || prefs.climbingDisciplines.some((d) => found.has(d));
    });
  }
  const picks = prefs.teamFilters[league.id];
  if (prefs.filteredLeagues.includes(league.id) && picks && picks.length > 0) {
    return events.filter((e) => competitors(e).some((c) => c.id != null && picks.includes(c.id)));
  }
  if (league.id === "college-football" && prefs.collegeTop25Only) {
    return events.filter((e) => competitors(e).some((c) => c.rank != null || isFollowing(prefs, c)));
  }
  return events;
}

/**
 * The window a league shows: every live game; finals from the last 18 hours
 * (when Show Finished is on); games from 6 hours ago to 36 hours ahead.
 * Nothing in it: the next fixture, so the league isn't silent. Then capped
 * at every live game plus three on either side of now.
 */
export function visible(events: readonly ScoreEvent[], now: number, showFinished: boolean): ScoreEvent[] {
  let shown = events.filter((e) => {
    // Climbing rounds belong to a multi-day competition the provider has
    // already scoped to "underway"; its start date says nothing about recency.
    if (e.content.kind === "field") return true;
    switch (e.state) {
      case "live":
        return true;
      case "final":
        return showFinished && e.start > now - 18 * HOUR;
      case "scheduled":
        return e.start > now - 6 * HOUR && e.start < now + 36 * HOUR;
    }
  });
  if (shown.length === 0) {
    const upcoming = events.filter((e) => e.state === "scheduled" && e.start > now);
    const next = upcoming.reduce<ScoreEvent | null>((best, e) => (best == null || e.start < best.start ? e : best), null);
    if (next) shown = events.filter((e) => e.state === "scheduled" && e.start === next.start);
  }
  shown.sort(eventOrder);
  const live = shown.filter((e) => e.state === "live");
  const upcoming = shown.filter((e) => e.state === "scheduled").slice(0, PER_STATE_LIMIT);
  const finals = shown.filter((e) => e.state === "final").slice(0, PER_STATE_LIMIT);
  return [...live, ...upcoming, ...finals];
}

// MARK: - Sections

/**
 * A followed team's coming games from its own schedule (ScheduleStore.nextGames),
 * soonest first: what My Teams falls back to when the scoreboards have nothing.
 */
export interface NextGame {
  readonly event: ScoreEvent;
  /** The league the schedule filed it under (a catalog ID, or a competition's slug). */
  readonly league: string;
}

/** How far ahead My Teams reaches into a team's schedule (ScoreStore.myTeamsEvents). */
export const NEXT_GAME_WINDOW = 21 * DAY;

/**
 * Each followed team's live game, latest result (past day) and next fixture
 * (next week). A team with nothing coming up on the scoreboards (a quiet
 * week, a cup tie in a league you don't show) gets its next game from its
 * schedule, when that's within three weeks.
 */
export function myTeamsEvents(
  results: Readonly<Record<string, LeagueResult>>,
  prefs: ListPreferences,
  now: number,
  nextGames: ReadonlyMap<string, readonly NextGame[]> = new Map(),
): ScoreEvent[] {
  if (prefs.followed.length === 0) return [];
  const picked = new Map<string, ScoreEvent>();
  for (const id of prefs.enabledLeagues) {
    const league = leagueWithID(id);
    if (!league) continue;
    const events = (results[id]?.events ?? []).filter((e) => involvesFollowed(prefs, e));
    for (const team of prefs.followed) {
      const theirs = events.filter((e) => competitors(e).some((c) => c.id === team.id));
      const live = theirs.filter((e) => e.state === "live");
      const last = theirs.filter((e) => e.state === "final" && e.start > now - DAY).sort((a, b) => b.start - a.start)[0];
      const next = theirs.filter((e) => e.state === "scheduled" && e.start < now + 7 * DAY).sort((a, b) => a.start - b.start)[0];
      for (const e of [...live, last, next]) {
        if (e && !picked.has(e.id)) picked.set(e.id, withChanges(e, { caption: e.caption ?? league.name }));
      }
    }
  }
  for (const game of fallbackGames(picked, results, prefs, now, nextGames)) {
    picked.set(game.event.id, withChanges(game.event, { caption: game.event.caption ?? leagueWithID(game.league)?.name ?? null }));
  }
  return [...picked.values()].sort(eventOrder);
}

/**
 * The schedule's next game for each followed team the scoreboards leave
 * uncovered (no live or upcoming game picked): the first one that hasn't
 * finished (by the scoreboard's copy when it has one, since a schedule read
 * hours ago still calls a finished game scheduled), started less than three
 * hours ago, and starts within three weeks.
 */
export function fallbackGames(
  picked: ReadonlyMap<string, ScoreEvent>,
  results: Readonly<Record<string, LeagueResult>>,
  prefs: ListPreferences,
  now: number,
  nextGames: ReadonlyMap<string, readonly NextGame[]>,
): NextGame[] {
  if (nextGames.size === 0) return [];
  const current = new Map<string, ScoreEvent>();
  for (const r of Object.values(results)) for (const e of r.events) if (!current.has(e.id)) current.set(e.id, e);
  const out: NextGame[] = [];
  const taken = new Set(picked.keys());
  for (const team of prefs.followed) {
    const covered = [...picked.values()].some((e) => e.state !== "final" && competitors(e).some((c) => c.id === team.id));
    if (covered) continue;
    for (const game of nextGames.get(team.id) ?? []) {
      const event = current.get(game.event.id) ?? game.event;
      if (event.state === "final" || event.start < now - 3 * HOUR) continue;
      if (event.start >= now + NEXT_GAME_WINDOW || taken.has(event.id)) break;
      taken.add(event.id);
      out.push({ event, league: game.league });
      break;
    }
  }
  return out;
}

export function computeSections(
  results: Readonly<Record<string, LeagueResult>>,
  prefs: ListPreferences,
  now: number,
  nextGames: ReadonlyMap<string, readonly NextGame[]> = new Map(),
): Section[] {
  const output: Section[] = [];
  const mine = myTeamsEvents(results, prefs, now, nextGames);
  if (mine.length > 0) output.push(section(MY_TEAMS, "My Teams", null, mine, false));
  const mineIDs = new Set(mine.map((e) => e.id));

  const leagues: Section[] = [];
  for (const id of prefs.enabledLeagues) {
    const league = leagueWithID(id);
    const result = results[id];
    if (!league || !result) continue;
    const events = visible(filtered(result.events, league, prefs), now, prefs.showFinished).filter((e) => !mineIDs.has(e.id));
    if (events.length === 0 && !result.failed) continue;
    leagues.push(section(league.id, league.name, league.sport, events, result.failed && events.length === 0));
  }
  if (!prefs.liveFirst) return [...output, ...leagues];
  // Optionally, leagues with something live float up; the rest keep the user's order.
  const ranked = leagues.map((s, i) => ({ s, i }));
  ranked.sort((a, b) => {
    const al = a.s.liveCount > 0;
    const bl = b.s.liveCount > 0;
    return al !== bl ? (al ? -1 : 1) : a.i - b.i;
  });
  return [...output, ...ranked.map((r) => r.s)];
}

function section(id: string, title: string, sport: Sport | null, events: readonly ScoreEvent[], failed: boolean): Section {
  return { id, title, sport, events, failed, liveCount: events.filter((e) => e.state === "live").length };
}

/** Enabled leagues that loaded fine but have nothing to show (the footnotes name them). */
export function quietLeagues(results: Readonly<Record<string, LeagueResult>>, prefs: ListPreferences, now: number): League[] {
  return prefs.enabledLeagues.flatMap((id) => {
    const league = leagueWithID(id);
    const result = results[id];
    if (!league || !result || result.failed) return [];
    return visible(filtered(result.events, league, prefs), now, prefs.showFinished).length === 0 ? [league] : [];
  });
}

/** Live games the user would see: their filtered leagues plus followed teams. */
export function liveCount(results: Readonly<Record<string, LeagueResult>>, prefs: ListPreferences): number {
  let total = 0;
  for (const id of prefs.enabledLeagues) {
    const league = leagueWithID(id);
    const events = results[id]?.events ?? [];
    if (!league) continue;
    const shown = new Set(filtered(events, league, prefs).map((e) => e.id));
    total += events.filter((e) => e.state === "live" && (shown.has(e.id) || involvesFollowed(prefs, e))).length;
  }
  return total;
}

/** Every league failed: the page says it can't connect, and live dots hold still. */
export function allFailed(results: Readonly<Record<string, LeagueResult>>, prefs: ListPreferences): boolean {
  return prefs.enabledLeagues.length > 0 && prefs.enabledLeagues.every((id) => results[id]?.failed === true);
}

// MARK: - Polling (ScoreStore.pollInterval)

/**
 * Seconds until the next refresh: 30 while anything the user sees is live,
 * 60 when a game starts within 15 minutes, otherwise 300. (Events past their
 * listed start, such as climbing rounds without a time or late CS matches,
 * don't count as starting soon.)
 */
export function pollInterval(results: Readonly<Record<string, LeagueResult>>, prefs: ListPreferences, now: number): number {
  if (liveCount(results, prefs) > 0) return 30;
  const startingSoon = Object.values(results).some((r) =>
    r.events.some((e) => e.state === "scheduled" && e.start < now + 15 * 60_000 && e.start > now - HOUR),
  );
  return startingSoon ? 60 : 300;
}

/** Failures retry sooner than the normal interval: 5, 15, 30, then 60 seconds. */
export function retryDelay(consecutiveFailures: number): number {
  return [5, 15, 30, 60][Math.min(Math.max(consecutiveFailures - 1, 0), 3)]!;
}

/**
 * Seconds between polls while the tab is hidden (web only): browsers stop
 * the visible cadence, but a pinned score in the tab title and alerts for
 * your teams still need the news. Only those games count: 30 while one is
 * live, 60 when one starts within 15 minutes, otherwise 300.
 */
export function backgroundInterval(results: Readonly<Record<string, LeagueResult>>, matters: (e: ScoreEvent) => boolean, now: number): number {
  const events = Object.values(results).flatMap((r) => r.events.filter(matters));
  if (events.some((e) => e.state === "live")) return 30;
  return events.some((e) => e.state === "scheduled" && e.start < now + 15 * 60_000 && e.start > now - HOUR) ? 60 : 300;
}

// MARK: - Between polls (ScoreStore.refresh)

/**
 * A fresh poll merged onto the last one, event by event: a clock that moved
 * since the last reading is running; an NBA rebound or timeout doesn't
 * replace the last line worth reading; a CS2 round score (fetched apart)
 * holds until the next one arrives. Unchanged events keep their identity.
 */
export function mergePoll(previous: readonly ScoreEvent[] | undefined, fresh: readonly ScoreEvent[]): ScoreEvent[] {
  if (!previous) return [...fresh];
  const old = new Map(previous.map((e) => [e.id, e]));
  return fresh.map((event) => {
    const before = old.get(event.id);
    if (!before) return event;
    let next = event;
    if (next.clock) next = { ...next, clock: clockReading(next.clock, before.clock) };
    if (next.liveLineRoutine && before.state === "live" && before.liveLine) {
      next = { ...next, liveLine: before.liveLine, liveLineRoutine: before.liveLineRoutine };
    }
    if (before.snapshot?.kind === "counterStrike" && next.snapshot == null && next.state === "live") {
      next = { ...next, snapshot: before.snapshot };
    }
    return sameEvent(before, next) ? before : next;
  });
}

/** A poll's events, each keeping its last object when nothing in it changed (so its row doesn't render). */
export function keepIdentity(previous: readonly ScoreEvent[] | undefined, next: readonly ScoreEvent[]): ScoreEvent[] {
  if (!previous) return [...next];
  const old = new Map(previous.map((e) => [e.id, e]));
  return next.map((e) => {
    const before = old.get(e.id);
    return before && sameEvent(before, e) ? before : e;
  });
}

/** Deep equality for two readings of an event (plain JSON data). */
export function sameEvent(a: ScoreEvent, b: ScoreEvent): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Which sides' numbers rose between two readings (the row's scorer dot, the
 * tile's digit flash). A correction downward has no scorer.
 */
export function scorers(before: ScoreEvent, after: ScoreEvent): Set<string> {
  const old = new Map(competitors(before).map((c) => [competitorKey(c), c.score]));
  const rose = new Set<string>();
  for (const c of competitors(after)) {
    const now = Number(c.score);
    const was = Number(old.get(competitorKey(c)) ?? NaN);
    if (c.score != null && Number.isFinite(now) && Number.isFinite(was) && now > was) rose.add(competitorKey(c));
  }
  return rose;
}

/** A live score changed between two live readings: the rule for every flash. */
export function liveScoreChanged(before: ScoreEvent, after: ScoreEvent): boolean {
  if (before.state !== "live" || after.state !== "live") return false;
  const a = competitors(before).map((c) => c.score);
  const b = competitors(after).map((c) => c.score);
  return a.length !== b.length || a.some((s, i) => s !== b[i]);
}

// MARK: - Tiles (ScoreStore.board)

export type TierKind = "live" | "mine" | "next" | "final";

export interface Tier {
  readonly kind: TierKind;
  readonly events: readonly ScoreEvent[];
}

export const TIER_TITLE: Readonly<Record<TierKind, string>> = { live: "Live", mine: "Your Teams", next: "Up Next", final: "Final" };

/** Tiers share the list's collapsed set under these IDs. */
export const tierID = (kind: TierKind) => `tiles.${kind}`;

export interface Board {
  readonly tiers: readonly Tier[];
  /** Event ID → league, for tile labels. */
  readonly league: ReadonlyMap<string, League>;
}

/**
 * The tile board: exactly the list's games, regrouped by state, each in the
 * first tier it qualifies for.
 * - Live: followed → pinned → league order → start → ID.
 * - Your Teams: not live, involves a followed team; upcoming by start, then results newest first.
 * - Up Next: scheduled, by start then league order.
 * - Final: newest first, then league order.
 * `source` gives an event's own copy (My Teams rewrites captions to the league name).
 */
export function board(
  sections: readonly Section[],
  prefs: ListPreferences,
  leagueOf: (eventID: string) => string | undefined,
  source: (eventID: string) => ScoreEvent | undefined = () => undefined,
  pinnedID: string | null = null,
): Board {
  const seen = new Set<string>();
  const events: ScoreEvent[] = [];
  for (const s of sections) {
    for (const e of s.events) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      events.push(source(e.id) ?? e);
    }
  }
  const position = new Map(prefs.enabledLeagues.map((id, i) => [id, i]));
  const rank = (e: ScoreEvent) => position.get(leagueOf(e.id) ?? "") ?? Number.MAX_SAFE_INTEGER;
  const mine = new Set(events.filter((e) => involvesFollowed(prefs, e)).map((e) => e.id));
  const byID = (a: ScoreEvent, b: ScoreEvent) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const live = events
    .filter((e) => e.state === "live")
    .sort((a, b) => {
      const af = mine.has(a.id);
      const bf = mine.has(b.id);
      if (af !== bf) return af ? -1 : 1;
      const ap = a.id === pinnedID;
      const bp = b.id === pinnedID;
      if (ap !== bp) return ap ? -1 : 1;
      return rank(a) - rank(b) || a.start - b.start || byID(a, b);
    });
  const yours = events.filter((e) => e.state !== "live" && mine.has(e.id)).sort(eventOrder);
  const next = events.filter((e) => e.state === "scheduled" && !mine.has(e.id)).sort((a, b) => a.start - b.start || rank(a) - rank(b) || byID(a, b));
  const finals = events.filter((e) => e.state === "final" && !mine.has(e.id)).sort((a, b) => b.start - a.start || rank(a) - rank(b) || byID(a, b));

  const tiers = (
    [
      ["live", live],
      ["mine", yours],
      ["next", next],
      ["final", finals],
    ] as const
  )
    .filter(([, list]) => list.length > 0)
    .map(([kind, list]) => ({ kind, events: list }));
  const league = new Map<string, League>();
  for (const e of events) {
    const l = leagueWithID(leagueOf(e.id) ?? "");
    if (l) league.set(e.id, l);
  }
  return { tiers, league };
}

export type TileSize = "large" | "small";

export interface TierPlan {
  readonly tier: Tier;
  readonly tiles: readonly { readonly event: ScoreEvent; readonly size: TileSize }[];
  /** Two large columns and an odd count: the first large tile spans the row. */
  readonly heroFirst: boolean;
}

/** Live games shown large: 4 in one large column, 6 in two (TileMetrics.largeBudget). */
export const largeBudget = (largeColumns: number) => (largeColumns >= 2 ? 6 : 4);

/**
 * Which tiles are large (TileBoard.swift `TilePlanner.plan`):
 * 1. Live games are large while the budget lasts, in tier order; the rest small, after them.
 * 2. Nothing live: the next game within 24 hours is large (a followed team's first).
 * 3. Everything else is small.
 */
export function planTiles(b: Board, largeColumns: number, now: number): TierPlan[] {
  const budget = largeBudget(largeColumns);
  const hasLive = b.tiers.some((t) => t.kind === "live");
  let nextUpID: string | null = null;
  if (!hasLive) {
    const soon = (kind: TierKind) => b.tiers.find((t) => t.kind === kind)?.events.find((e) => e.state === "scheduled" && e.start < now + DAY);
    nextUpID = (soon("mine") ?? soon("next"))?.id ?? null;
  }
  return b.tiers.map((tier) => {
    let tiles: { event: ScoreEvent; size: TileSize }[];
    if (tier.kind === "live") {
      tiles = tier.events.map((event, i) => ({ event, size: i < budget ? "large" : "small" }));
    } else {
      tiles = tier.events.map((event) => ({ event, size: event.id === nextUpID ? "large" : "small" }));
      // The next-up tile leads its tier.
      const i = tiles.findIndex((t) => t.size === "large");
      if (i > 0) tiles.unshift(...tiles.splice(i, 1));
    }
    const large = tiles.filter((t) => t.size === "large").length;
    return { tier, tiles, heroFirst: largeColumns >= 2 && large % 2 === 1 };
  });
}
