/**
 * ESPN's real-time baseball lane while a game page is open (LiveFeeds.swift
 * `BaseballFeed`): count, outs, runners, batter and pitcher every few seconds
 * (two requests of a few hundred bytes: the core API's `situation` and
 * `status`), and only the newest plays when something happens, so each pitch
 * lands in the zone as it's thrown.
 *
 * Plain TypeScript with no React: the page's fast lane calls `update` on its
 * cadence and re-renders what changed (`subscribe`; every field is replaced
 * only when its value changed, so selectors can compare by identity).
 *
 *     const feed = new BaseballFeed(theater);
 *     await feed.update(getJSON, { path, eventID, names, side });
 *     moments.offer(feed.takeMoments());
 */
import { battedBalls as readBattedBalls, currentAtBat, intOf, runners, type Baseball, type BattedBall, type Pitch, type SideOf } from "../gameDetail";
import type { Fetcher } from "../http";
import { arr, at, bool, has, num, str, type JSONValue } from "../json";
import { liveMoment, Tier, type Accent, type LiveMoment, type MomentKind } from "../moments";
import { baseballFacts } from "../scoringFacts";

/** The score as of the newest play the fast lane has seen. */
export interface LiveScore {
  readonly home: number;
  readonly away: number;
}

export function liveScore(play: JSONValue): LiveScore | null {
  const home = intOf(at(play, "homeScore"));
  const away = intOf(at(play, "awayScore"));
  return home == null || away == null ? null : { home, away };
}

/** What the theater needs from a state: its play's ID and when it happened. */
export interface TheaterLike {
  readonly play: { readonly id: string; readonly wallclock?: number | null } | null;
  readonly news: boolean;
}

/** The play theater's parser (data/mlb/playScene.ts `theater`), injected so the lane doesn't depend on the renderer's module. */
export type TheaterOf<T extends TheaterLike> = (plays: readonly JSONValue[], side: SideOf, names: Readonly<Record<string, string>>) => T;

export interface BaseballUpdate {
  readonly path: string;
  readonly eventID: string;
  readonly names: Readonly<Record<string, string>>;
  readonly side: SideOf;
  readonly signal?: AbortSignal;
}

const PAGE_SIZE = 25;
const WINDOW_SIZE = 80;
/** A play this fresh when the page opens still replays (ESPN publishes plays 15–45 s after they happen). */
export const RECENT_MS = 60_000;

export class BaseballFeed<T extends TheaterLike = TheaterLike> {
  situation: Baseball | null = null;
  /** Pitches of the at-bat in progress (or the last one between batters). */
  atBat: readonly Pitch[] = [];
  /** Balls in play seen since the page opened. */
  battedBalls: readonly BattedBall[] = [];
  /** "Top 7th". */
  inning: string | null = null;
  score: LiveScore | null = null;
  /** True once the play feed has been read, so an empty at-bat is a fresh batter, not missing data. */
  loaded = false;
  /** The play theater's last play and who's up now. Assigned only when they change, so a pitch doesn't redraw the theater. */
  theater: T | null = null;

  /** The most recent plays, enough to hold the current at-bat. */
  private window: JSONValue[] = [];
  /** At-bat results that arrived since the page opened. */
  private moments: LiveMoment[] = [];
  private primed = false;
  private fetched: number | null = null;
  private lastPlayRef: string | null = null;
  private newestID: string | null = null;
  private inflight: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private readonly theaterOf: TheaterOf<T> | null;
  private readonly now: () => number;

  constructor(theaterOf: TheaterOf<T> | null = null, now: () => number = Date.now) {
    this.theaterOf = theaterOf;
    this.now = now;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** One look: the situation and status, then new plays if the last play changed. One update at a time. */
  async update(fetcher: Fetcher, options: BaseballUpdate): Promise<void> {
    // One update at a time: a second caller waits for the first (an abandoned
    // page's look finishes, but commits nothing once its signal is aborted).
    while (this.inflight) await this.inflight.catch(() => {});
    if (options.signal?.aborted) return;
    this.inflight = this.look(fetcher, options);
    try {
      await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  private async look(fetcher: Fetcher, { path, eventID, names, side, signal }: BaseballUpdate): Promise<void> {
    {
      const league = path.split("/").pop() ?? path;
      const base = `https://sports.core.api.espn.com/v2/sports/baseball/leagues/${league}/events/${eventID}/competitions/${eventID}`;
      const [s, status] = await Promise.all([
        fetcher(`${base}/situation`, { signal }).catch(() => null),
        fetcher(`${base}/status`, { signal }).catch(() => null),
      ]);
      if (signal?.aborted) return;
      let changed = false;
      if (status != null && str(at(status, "type", "state")) === "in") {
        const inning = str(at(status, "type", "shortDetail")) ?? null;
        if (inning !== this.inning) {
          this.inning = inning;
          changed = true;
        }
      }
      if (s == null) {
        if (changed) this.emit();
        return;
      }
      const lastRef = str(at(s, "lastPlay", "$ref")) ?? null;
      if (lastRef !== this.lastPlayRef || !this.loaded) {
        if (await this.loadPlays(fetcher, base, names, side, signal)) changed = true;
        const lastID = lastRef ? playIDFromRef(lastRef) : null;
        if (!signal?.aborted && (lastID == null || lastID === this.newestID)) this.lastPlayRef = lastRef;
      }
      if (signal?.aborted) {
        if (changed) this.emit();
        return;
      }
      const last = findLast(this.window, (p) => str(at(p, "type", "type")) === "play-result");
      const next = baseballSituation(s, names, str(at(last, "text")) ?? null);
      if (!sameSituation(next, this.situation)) {
        this.situation = next;
        changed = true;
      }
      if (changed) this.emit();
    }
  }

  /** The moments since the last call. */
  takeMoments(): LiveMoment[] {
    const out = this.moments;
    this.moments = [];
    return out;
  }

  private async loadPlays(fetcher: Fetcher, base: string, names: Readonly<Record<string, string>>, side: SideOf, signal?: AbortSignal): Promise<boolean> {
    // First look: start a couple of pages from the end, not at the first pitch.
    if (this.fetched == null) {
      const head = await fetcher(`${base}/plays?limit=1`, { signal }).catch(() => null);
      if (head == null) return false;
      this.fetched = Math.max((intOf(at(head, "count")) ?? 0) - 2 * PAGE_SIZE, 0);
    }
    let start = this.fetched;
    let page = Math.floor(start / PAGE_SIZE) + 1;
    const fresh: JSONValue[] = [];
    let complete = false;
    let scoreChanged = false;
    while (!signal?.aborted) {
      const json = await fetcher(`${base}/plays?limit=${PAGE_SIZE}&page=${page}`, { signal }).catch(() => null);
      if (json == null) break;
      const items = arr(at(json, "items"));
      items.forEach((item, offset) => {
        if ((page - 1) * PAGE_SIZE + offset < start) return;
        fresh.push(normalized(item));
        this.newestID = str(at(item, "id")) ?? this.newestID;
        const latest = liveScore(item);
        if (latest && (latest.home !== this.score?.home || latest.away !== this.score?.away)) {
          this.score = latest;
          scoreChanged = true;
        }
      });
      start = Math.max(start, (page - 1) * PAGE_SIZE + items.length);
      if (page >= (intOf(at(json, "pageCount")) ?? page) || items.length === 0) {
        complete = true;
        break;
      }
      page += 1;
    }
    // An abandoned look keeps nothing, so the next one reads the same plays again.
    if (signal?.aborted) return scoreChanged;
    this.fetched = start;
    // Until a complete look it's history; after, at-bat results are news.
    const news = this.primed;
    if (this.primed) this.moments.push(...fresh.flatMap((item) => baseballMoment(item, side) ?? []));
    if (complete) this.primed = true;
    const wasLoaded = this.loaded;
    this.loaded = true;
    if (fresh.length === 0) return scoreChanged || !wasLoaded;
    this.window = [...this.window, ...fresh].slice(-WINDOW_SIZE);
    this.atBat = currentAtBat(this.window);
    if (this.theaterOf) {
      const next = theaterAfter(this.window, this.theater, news, this.now(), names, side, this.theaterOf);
      if (!sameTheater(next, this.theater)) this.theater = next;
    }
    const byID = new Map(this.battedBalls.map((b) => [b.id, b]));
    for (const ball of readBattedBalls(this.window, side)) byID.set(ball.id, ball);
    this.battedBalls = [...byID.values()];
    return true;
  }
}

/** "…/plays/4019080430005990057?lang=en" → "4019080430005990057". */
export function playIDFromRef(ref: string): string | null {
  const i = ref.indexOf("/plays/");
  if (i < 0) return null;
  const digits = /^\d+/.exec(ref.slice(i + "/plays/".length));
  return digits ? digits[0] : null;
}

/**
 * The theater after a look at the plays. Its play is news if it arrived after
 * the first complete look, or if it only just happened (a page opened right
 * after it); otherwise it's history, shown as it ended. A play already showing
 * keeps what it was. (pure; tested)
 */
export function theaterAfter<T extends TheaterLike>(
  window: readonly JSONValue[],
  previous: T | null,
  primed: boolean,
  now: number,
  names: Readonly<Record<string, string>>,
  side: SideOf,
  theaterOf: TheaterOf<T>,
): T {
  const next = theaterOf(window, side, names);
  if (!next.play) return next;
  const news =
    next.play.id === previous?.play?.id ? previous.news : primed || (next.play.wallclock != null && now - next.play.wallclock < RECENT_MS);
  return news === next.news ? next : { ...next, news };
}

function sameTheater(a: TheaterLike | null, b: TheaterLike | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.play?.id === b.play?.id && a.news === b.news && JSON.stringify(a) === JSON.stringify(b);
}

/** Core plays name their team by link; the summary parsers expect `team.id`. */
export function normalized(item: JSONValue): JSONValue {
  if (item == null || typeof item !== "object" || Array.isArray(item)) return item;
  const id = teamIDFromRef(str(at(item, "team", "$ref")));
  return id ? { ...(item as Record<string, unknown>), team: { id } } : item;
}

/** "…/teams/8?lang=en" → "8" (FootballFeed.teamID). */
export function teamIDFromRef(ref: string | undefined | null): string | null {
  if (!ref) return null;
  const i = ref.indexOf("/teams/");
  if (i < 0) return null;
  return ref.slice(i + "/teams/".length).split(/[?/]/)[0] || null;
}

/** The core API's situation (BaseballFeed.situation): runners by `playerId`, names from the box score. */
export function baseballSituation(s: JSONValue, names: Readonly<Record<string, string>>, lastPlay: string | null): Baseball | null {
  if (!has(s, "outs") && !has(s, "balls")) return null;
  const pid = (role: string) => {
    const n = num(at(s, role, "playerId"));
    return n != null ? String(n) : null;
  };
  const name = (role: string) => {
    const id = pid(role);
    return id ? (names[id] ?? null) : null;
  };
  return {
    balls: Math.min(intOf(at(s, "balls")) ?? 0, 3),
    strikes: Math.min(intOf(at(s, "strikes")) ?? 0, 2),
    outs: Math.min(intOf(at(s, "outs")) ?? 0, 3),
    onFirst: has(s, "onFirst") && at(s, "onFirst") != null,
    onSecond: has(s, "onSecond") && at(s, "onSecond") != null,
    onThird: has(s, "onThird") && at(s, "onThird") != null,
    batter: name("batter"),
    pitcher: name("pitcher"),
    lastPlay,
    runners: runners(s, names),
    batterID: pid("batter"),
    pitcherID: pid("pitcher"),
  };
}

function sameSituation(a: Baseball | null, b: Baseball | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const OUT_RESULTS = new Set([
  "ground-out",
  "fly-out",
  "line-out",
  "pop-out",
  "foul-out",
  "bunt-ground-out",
  "sacrifice",
  "sacrifice-fly",
  "batters-fielders-choice---runner-out",
]);

/**
 * An at-bat's result as a moment, from its structured type (the result
 * entry's `alternativeType`), never its text.
 */
export function baseballMoment(item: JSONValue, side: SideOf): LiveMoment | null {
  const id = str(at(item, "id"));
  if (str(at(item, "type", "type")) !== "play-result" || !id) return null;
  const result = str(at(item, "alternativeType", "type")) ?? "";
  const text = str(at(item, "text")) ?? "";
  const batting = side(str(at(item, "team", "id")));
  const moment = (kind: MomentKind, tier: Tier, lead: string, accents: Accent[] = []) =>
    liveMoment({ id, chart: "plate", tier, kind, lead, detail: text, side: batting, accents, ...(tier === Tier.score ? { facts: baseballFacts(item, batting) } : {}) });
  const runs = intOf(at(item, "scoreValue")) ?? 1;
  const off = walkOff(item);
  // The play theater's banner brings confetti for a triple, scored or not.
  const triple: Accent[] = result === "triple" ? ["triple"] : [];
  if (result === "home-run") {
    const accents: Accent[] = [];
    if (runs === 4) accents.push("grandSlam");
    if (off) accents.push("decisive");
    return moment("homeRun", Tier.score, runs === 4 ? "Grand slam" : off ? "Walk-off home run" : "Home run", accents);
  }
  if (bool(at(item, "scoringPlay")) === true) {
    return moment("runScored", Tier.score, off ? "Walk-off" : runs > 1 ? `${runs} runs score` : "Run scores", [...(off ? (["decisive"] as Accent[]) : []), ...triple]);
  }
  // Two outs on one play outranks the strikeout it may include (K + caught stealing).
  if (bool(at(item, "doublePlay")) === true) return moment("doublePlay", Tier.swing, "Double play");
  if (result.startsWith("strike-")) return moment("strikeout", Tier.swing, "Strikeout");
  if (result.startsWith("ball")) return moment("walk", Tier.swing, "Walk");
  if (result === "hit-by-pitch") return moment("walk", Tier.swing, "Hit by pitch");
  switch (result) {
    case "single":
    case "bunt-single":
      return moment("hit", Tier.swing, "Single");
    case "double":
      return moment("hit", Tier.swing, "Double");
    case "triple":
      return moment("hit", Tier.swing, "Triple", triple);
  }
  return OUT_RESULTS.has(result) ? moment("outInPlay", Tier.routine, "Out") : null;
}

/**
 * The home team takes the lead in the bottom of the 9th or later: the game is
 * over. A scoring result's score fields are the score after it (PlayScene.walkOff).
 */
export function walkOff(item: JSONValue): boolean {
  if (!(str(at(item, "period", "type")) ?? "").toLowerCase().startsWith("bot")) return false;
  const inning = intOf(at(item, "period", "number"));
  const home = intOf(at(item, "homeScore"));
  const away = intOf(at(item, "awayScore"));
  if (inning == null || inning < 9 || home == null || away == null) return false;
  const runs = intOf(at(item, "scoreValue")) ?? 1;
  return home > away && home - runs <= away;
}

function findLast<T>(items: readonly T[], test: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i]!)) return items[i];
  return undefined;
}
