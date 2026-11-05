/**
 * Polymarket on the open game page (ODDS-SPEC.md, "Performance"): the owner's
 * worry is that odds must not cost the app anything, with many markets
 * one could track. So:
 *
 * - Odds are fetched for the game page that's open, and only while its
 *   section is on screen: never for the scores list, tiles, alerts, the tab
 *   or the docked bar. At most one market is tracked at a time.
 * - The day's listing per league is kept in memory for 10 minutes and shared
 *   by every game that day; a game's market, once found, for the session
 *   (not finding one is remembered for 10 minutes, with the listing).
 * - History is what the chart is missing (OddsFeed.swift `holes`): the
 *   game's opening, its tail, and any stretch a `GAP` long, each asked for
 *   once and merged without overwriting a live tick; a failed request is asked
 *   again with backoff while the chart stays on screen.
 * - One WebSocket at a time: opened when the section comes on screen, closed
 *   when it leaves, when the tab is hidden, and when the page closes;
 *   reconnecting with backoff, and polling the midpoint every 15 s when the
 *   socket can't connect. Every (re)connect asks for the history's tail.
 * - Incoming ticks are coalesced to at most two updates a second, published
 *   at one instant for every outcome, and each series kept to about 600
 *   points (older history in minute buckets).
 *
 * A feed is a small object outside React that the page's timeline and Win
 * Probability share (`useOddsFeedObject`); readers subscribe narrowly
 * (`useOddsSnapshot`, `useOddsSelect`).
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getJSON, HTTPError, type Fetcher } from "../data/http";
import type { EventState } from "../data/models";
import {
  applyUpdate,
  candidateDates,
  CAP,
  compact,
  displayed,
  EMPTY_QUOTE,
  eventURL,
  GAP,
  historyURL,
  holes,
  isThreeWay,
  lastAtOrBefore,
  listingURL,
  marketEventSlug,
  marketFromEvent,
  marketURL,
  matchEvent,
  mergingHistory,
  midpointURL,
  parseHistory,
  parseListing,
  parseMidpoint,
  parseSocketMessage,
  seriesFor,
  SOCKET,
  twoWayMarket,
  type BookUpdate,
  type GameKey,
  type Market,
  type Outcome,
  type PMEvent,
  type PricePoint,
  type Quote,
} from "../data/odds/polymarket";

type GameState = EventState;

const MINUTE = 60_000;
const LISTING_TTL = 10 * MINUTE;
/** At most two updates a second reach the chart. */
const FLUSH_MS = 500;
const PING_MS = 10_000;
const POLL_MS = 15_000;
/** Failed connects in a row before polling the midpoint takes over (the socket is tried again every minute). */
const FAILURES_BEFORE_POLLING = 2;
const RETRY_SOCKET_MS = 60_000;
/** A change smaller than this (a tenth of a point) isn't one worth drawing. */
const EPSILON = 0.001;

// MARK: - The environment (the `?demo` harness replaces the clock and the socket)

interface SocketLike {
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  send(data: string): void;
  close(code?: number): void;
}

interface Environment {
  fetcher: Fetcher;
  socket: (url: string) => SocketLike;
  now: () => number;
}

const env: Environment = {
  fetcher: (url, init) => getJSON(url, init),
  socket: (url) => new WebSocket(url) as unknown as SocketLike,
  now: () => Date.now(),
};

/** Development and tests only: a stand-in network, socket and clock. */
export function setOddsEnvironment(next: Partial<Environment>): void {
  Object.assign(env, next);
}

/** The odds clock (the demo replays a recorded game on its own wall clock). */
export const oddsNow = () => env.now();

// MARK: - Finding the market

const listings = new Map<string, { at: number; value: Promise<PMEvent[]> }>();
const markets = new Map<string, { at: number | null; value: Promise<Market | null> }>();

function listing(series: number, date: string): Promise<PMEvent[]> {
  const key = `${series}|${date}`;
  const hit = listings.get(key);
  if (hit && env.now() - hit.at < LISTING_TTL) return hit.value;
  const value = env.fetcher(listingURL(series, date)).then(parseListing);
  listings.set(key, { at: env.now(), value });
  // A failure isn't kept: the next look asks again.
  value.catch(() => listings.delete(key));
  return value;
}

/** The game's moneyline: the day's listing (cached), the one confident match, then its market alone. Null: none. */
export async function findMarket(game: OddsGame): Promise<Market | null> {
  const series = seriesFor(game.path);
  if (series == null) return null;
  const key: GameKey = { start: game.start, top: game.names.top, bottom: game.names.bottom };
  if (key.top.length === 0 || key.bottom.length === 0) return null;
  let event: PMEvent | null = null;
  for (const date of candidateDates(game.start)) {
    event = matchEvent(await listing(series, date), key);
    if (event) break;
  }
  if (!event) return null;
  const start = event.startTime;
  if (!isThreeWay(game.path)) {
    try {
      const json = await env.fetcher(marketURL(event.slug));
      const parent = marketEventSlug(json);
      const two = parent == null || parent === event.slug ? twoWayMarket(json, event.slug, key) : null;
      if (two) return { ...two, start };
    } catch (error) {
      if (!(error instanceof HTTPError && error.status === 404)) throw error;
    }
  }
  const market = marketFromEvent(await env.fetcher(eventURL(event.slug)), key);
  return market ? { ...market, start } : null;
}

function cachedMarket(game: OddsGame): Promise<Market | null> {
  const hit = markets.get(game.id);
  // Found: for the session. Not found: for 10 minutes (Polymarket lists games a few days ahead).
  if (hit && (hit.at == null || env.now() - hit.at < LISTING_TTL)) return hit.value;
  const value = findMarket(game);
  markets.set(game.id, { at: env.now(), value });
  value.then(
    (m) => {
      if (m) markets.set(game.id, { at: null, value });
    },
    () => markets.delete(game.id),
  );
  return value;
}

// MARK: - The feed

/** What the feed needs to know about the game. */
export interface OddsGame {
  /** The event's ID: the cache key. */
  readonly id: string;
  /** ESPN's league path ("basketball/nba"). */
  readonly path: string;
  readonly state: GameState;
  /** The scheduled start (epoch ms). */
  readonly start: number;
  /** Each side's names as ESPN writes them, for the match. */
  readonly names: { readonly top: readonly string[]; readonly bottom: readonly string[] };
}

export type OddsStatus = "idle" | "matching" | "none" | "ready" | "failed";

export interface OddsSnapshot {
  /** "ready": the market is known (its history may still be on its way: `loaded`). */
  readonly status: OddsStatus;
  readonly market: Market | null;
  /** The history has been asked for once (the line can draw; holes are asked for again behind it). */
  readonly loaded: boolean;
  /** Each tracked outcome's prices, oldest first, compacted (US: the top team's only). */
  readonly series: Readonly<Partial<Record<Outcome, readonly PricePoint[]>>>;
  readonly transport: "socket" | "poll" | null;
  /** Bumped with every change to `series`: readers compare this, not the arrays (OddsFeed.revision). */
  readonly version: number;
}

const IDLE: OddsSnapshot = { status: "idle", market: null, loaded: false, series: {}, transport: null, version: 0 };

/** On screen this long before tracking starts, off screen this long before it stops (scrolling past doesn't churn connections). */
const ON_AFTER_MS = 250;
const OFF_AFTER_MS = 2000;
/** Once a minute while live: a quiet market's price is repeated at now (when its last point is 50 s old or more), so its line reaches the present. */
const TICKER_MS = 60_000;
const TICKER_QUIET_MS = 50_000;
/** A move after this much quiet (observed) gets a hold point a second before it: the line steps, not a diagonal across the quiet. */
const QUIET_MS = 10_000;
/** The history's backfill and the socket's reconnects back off: 1, 2, 4, 8, 16, then every 30 s. */
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16_000, 30_000];

/** The one feed tracking a market (history, socket, polling): starting another stops it. */
let tracker: OddsFeed | null = null;

export class OddsFeed {
  private game: OddsGame;
  private snapshot: OddsSnapshot = IDLE;
  private readonly listeners = new Set<() => void>();
  private attached = false;
  /** On screen (debounced). */
  private onScreen = false;
  private wantOnScreen = false;
  private screenTimer: ReturnType<typeof setTimeout> | null = null;
  private hidden = typeof document !== "undefined" ? document.hidden : false;
  private discovering: Promise<void> | null = null;
  private loading: Promise<void> | null = null;
  private socket: SocketLike | null = null;
  private opened = false;
  private failures = 0;
  private readonly quotes = new Map<string, Quote>();
  /** Holes in the history the provider has answered for, by token: asked once, even if it had nothing to say about them. */
  private readonly answered = new Map<string, Set<number>>();
  private backfillFailures = 0;
  private dirty = false;
  private lastFlush = -Infinity;
  /** When the feed last heard anything, by this machine's clock (for "Live · 4s"); written at most once a second. */
  heard: number | null = null;
  private lastHeard: number | null = null;
  private timers: {
    flush?: ReturnType<typeof setTimeout>;
    ping?: ReturnType<typeof setInterval>;
    poll?: ReturnType<typeof setInterval>;
    retry?: ReturnType<typeof setTimeout>;
    ticker?: ReturnType<typeof setInterval>;
    backfill?: ReturnType<typeof setTimeout>;
  } = {};

  constructor(game: OddsGame) {
    this.game = game;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): OddsSnapshot => this.snapshot;

  /** Whether a socket or the polling is open now (tests, and the performance check). */
  get connected(): boolean {
    return this.socket != null || this.timers.poll != null;
  }

  private emit(next: Partial<OddsSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const l of this.listeners) l();
  }

  /** The page polls the game: its state moves on (live to final restarts with the new rules). */
  setGame(game: OddsGame): void {
    const was = this.game.state;
    this.game = game;
    if (was === game.state) return;
    // Restarted with the new rules (a final's history to its end, then nothing live).
    if (this.tracking && this.snapshot.loaded) {
      this.stopLive();
      void this.loadHistory();
      return;
    }
    this.run();
  }

  /** The section is on screen, or not: tracking follows after 0.25 s on, or 2 s off. */
  setOnScreen(on: boolean): void {
    this.wantOnScreen = on;
    if (this.screenTimer != null) clearTimeout(this.screenTimer);
    this.screenTimer = null;
    if (on === this.onScreen) return;
    this.screenTimer = setTimeout(
      () => {
        this.screenTimer = null;
        this.onScreen = this.wantOnScreen;
        this.run();
      },
      on ? ON_AFTER_MS : OFF_AFTER_MS,
    );
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    if (typeof document !== "undefined") {
      this.hidden = document.hidden;
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    this.run();
  }

  /** The page closed: nothing open, nothing scheduled. The data stays for a return visit. */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.screenTimer != null) clearTimeout(this.screenTimer);
    this.screenTimer = null;
    this.onScreen = false;
    this.stopLive();
  }

  private readonly onVisibility = () => {
    this.hidden = document.hidden;
    this.run();
  };

  /** History, socket and polling: only for the open page's section, on screen, in a visible tab. */
  private get tracking(): boolean {
    return this.attached && this.onScreen && !this.hidden;
  }

  private get wantsLive(): boolean {
    return this.tracking && this.game.state !== "final" && this.snapshot.market != null && this.snapshot.loaded;
  }

  private run(): void {
    if (!this.attached) return;
    // Which market (if any): as the page opens, since it decides whether the section shows at all.
    if (this.snapshot.status === "idle" || (this.snapshot.status === "failed" && this.tracking)) {
      void this.discover();
      return;
    }
    if (!this.tracking) {
      this.stopLive();
      return;
    }
    if (this.snapshot.market && !this.snapshot.loaded) {
      void this.loadHistory();
      return;
    }
    if (this.wantsLive && !this.socket && this.timers.poll == null && this.timers.retry == null) this.startLive();
  }

  private discover(): Promise<void> {
    if (this.discovering) return this.discovering;
    this.emit({ status: "matching" });
    this.discovering = (async () => {
      try {
        const market = await cachedMarket(this.game);
        this.emit(market ? { status: "ready", market } : { status: "none", market: null });
      } catch {
        // Quietly: the section keeps ESPN's bar; the next appearance asks again.
        this.emit({ status: "failed" });
      } finally {
        this.discovering = null;
      }
      if (this.snapshot.status === "ready") this.run();
    })();
    return this.discovering;
  }

  /**
   * What the chart is missing, asked for once a look and applied at once, so
   * three outcomes never draw from different moments. A request that fails is
   * asked again while the chart stays on screen: a game's opening is never
   * lost to one bad minute (OddsFeed.loadHistory).
   */
  private loadHistory(): Promise<void> {
    if (this.loading) return this.loading;
    const market = this.snapshot.market;
    if (!market) return Promise.resolve();
    this.loading = (async () => {
      const now = env.now();
      const { from, to } = historyRange(this.game, market, now);
      const fetched: { token: string; outcome: Outcome; hole: { from: number; to: number }; points: PricePoint[] }[] = [];
      let failed = false;
      for (const { token, outcome } of market.tokens) {
        for (const hole of holes(this.snapshot.series[outcome] ?? [], from, to, this.answered.get(token) ?? new Set())) {
          try {
            fetched.push({ token, outcome, hole, points: parseHistory(await env.fetcher(historyURL(token, hole.from, hole.to))) });
          } catch {
            failed = true;
          }
        }
      }
      this.loading = null;
      if (!this.attached || this.snapshot.market !== market) return;
      // A flush or the quiet-market ticker may have appended during the requests; those observations win.
      const series = { ...this.snapshot.series };
      let merged = false;
      for (const { token, outcome, hole, points } of fetched) {
        const answered = this.answered.get(token) ?? new Set<number>();
        answered.add(hole.from);
        this.answered.set(token, answered);
        if (points.length === 0) continue;
        const old = series[outcome] ?? [];
        const next = mergingHistory(points, old, hole, env.now());
        if (next.length === old.length && next.every((p, k) => p === old[k])) continue;
        series[outcome] = next;
        merged = true;
      }
      // Nothing new (a reconnect's tail already in hand): no change for readers.
      if (merged || !this.snapshot.loaded) this.emit({ series, loaded: true, version: this.snapshot.version + 1 });
      this.backfillFailures = failed ? this.backfillFailures + 1 : 0;
      if (this.timers.backfill != null) clearTimeout(this.timers.backfill);
      delete this.timers.backfill;
      if (failed && this.tracking) {
        const wait = BACKOFF_MS[Math.min(this.backfillFailures - 1, BACKOFF_MS.length - 1)]!;
        this.timers.backfill = setTimeout(() => {
          delete this.timers.backfill;
          if (this.tracking) void this.loadHistory();
        }, wait);
      }
      this.run();
    })();
    return this.loading;
  }

  // MARK: Live

  private startLive(): void {
    if (!this.wantsLive || this.socket || this.timers.poll != null) return;
    if (tracker && tracker !== this) tracker.stopLive();
    tracker = this;
    this.openSocket();
    // A quiet market still reaches now.
    this.timers.ticker ??= setInterval(() => this.tick(), TICKER_MS);
  }

  private stopLive(): void {
    if (tracker === this) tracker = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try {
        socket.close(1000);
      } catch {
        // Already closed.
      }
    }
    for (const key of ["ping", "poll", "ticker"] as const) if (this.timers[key] != null) clearInterval(this.timers[key]);
    for (const key of ["flush", "retry", "backfill"] as const) if (this.timers[key] != null) clearTimeout(this.timers[key]);
    this.timers = {};
    if (this.dirty) this.flush();
    if (this.snapshot.transport != null) this.emit({ transport: null });
  }

  private openSocket(): void {
    const market = this.snapshot.market;
    if (!market) return;
    let socket: SocketLike;
    try {
      socket = env.socket(SOCKET);
    } catch {
      this.failures++;
      this.failed();
      return;
    }
    this.socket = socket;
    this.opened = false;
    socket.onopen = () => {
      this.opened = true;
      this.failures = 0;
      socket.send(JSON.stringify({ assets_ids: market.tokens.map((t) => t.token), type: "market" }));
      this.timers.ping = setInterval(() => socket.send("PING"), PING_MS);
      if (this.timers.poll != null) {
        clearInterval(this.timers.poll);
        delete this.timers.poll;
      }
      this.emit({ transport: "socket" });
      // Connected: anything missed while away comes from the history's tail.
      void this.loadHistory();
    };
    socket.onmessage = (e) => {
      if (typeof e.data === "string") this.receive(e.data);
    };
    socket.onerror = () => {
      // onclose follows.
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.timers.ping != null) clearInterval(this.timers.ping);
      delete this.timers.ping;
      this.failures = this.opened ? 1 : this.failures + 1;
      this.failed();
    };
  }

  /** The socket closed or couldn't open: back off and try again (1, 2, 4… 30 s); after two failed connects, poll the midpoint meanwhile. */
  private failed(): void {
    if (!this.wantsLive) return;
    if (this.failures >= FAILURES_BEFORE_POLLING) this.startPolling();
    const delay = this.timers.poll != null ? RETRY_SOCKET_MS : BACKOFF_MS[Math.min(Math.max(this.failures - 1, 0), BACKOFF_MS.length - 1)]!;
    this.timers.retry = setTimeout(() => {
      delete this.timers.retry;
      if (this.wantsLive && !this.socket) this.openSocket();
    }, delay);
  }

  private startPolling(): void {
    if (this.timers.poll != null) return;
    const market = this.snapshot.market;
    if (!market) return;
    const poll = async () => {
      let series = this.snapshot.series;
      let changed = false;
      for (const { token, outcome } of market.tokens) {
        try {
          const mid = parseMidpoint(await env.fetcher(midpointURL(token)));
          if (mid == null) continue;
          const next = publish(series[outcome] ?? [], mid, env.now());
          if (next) {
            series = { ...series, [outcome]: next };
            changed = true;
          }
          this.lastHeard = Date.now();
        } catch {
          // The next poll tries again.
        }
      }
      if (this.timers.poll == null) return;
      if (changed) this.emit({ series, version: this.snapshot.version + 1 });
      this.noteHeard();
    };
    this.timers.poll = setInterval(() => void poll(), POLL_MS);
    void poll();
    this.emit({ transport: "poll" });
  }

  /** A socket message: the quotes move at once; the chart hears at most twice a second. */
  receive(raw: string): void {
    this.apply(parseSocketMessage(raw));
  }

  /** Frames for this market's tokens (another market's never touch a quote). Whether any did. */
  private take(updates: readonly BookUpdate[]): boolean {
    const market = this.snapshot.market;
    if (!market || updates.length === 0) return false;
    let touched = false;
    for (const u of updates) {
      if (!market.tokens.some((t) => t.token === u.token)) continue;
      this.quotes.set(u.token, applyUpdate(this.quotes.get(u.token) ?? EMPTY_QUOTE, u.update));
      touched = true;
    }
    if (touched) {
      this.lastHeard = Date.now();
      this.dirty = true;
    }
    return touched;
  }

  /** The frames taken, then a flush at most twice a second. */
  private apply(updates: readonly BookUpdate[]): void {
    if (!this.take(updates)) return;
    if (this.timers.flush == null) {
      const wait = Math.max(0, FLUSH_MS - (env.now() - this.lastFlush));
      this.timers.flush = setTimeout(() => {
        delete this.timers.flush;
        this.flush();
      }, wait);
    }
  }

  /** Every outcome's displayed price into its series, at one instant: one coalesced book snapshot has one time. */
  private flush(time = env.now()): void {
    this.dirty = false;
    this.lastFlush = time;
    const market = this.snapshot.market;
    if (!market) return;
    let series = this.snapshot.series;
    let changed = false;
    for (const { outcome, token } of market.tokens) {
      const q = this.quotes.get(token);
      const price = q ? displayed(q) : null;
      if (price == null) continue;
      // Separate clock reads would invent intermediate normalized soccer prices a few
      // microseconds apart, which render as false vertical spikes.
      const next = publish(series[outcome] ?? [], price, time);
      if (next) {
        series = { ...series, [outcome]: next };
        changed = true;
      }
    }
    if (changed) this.emit({ series, version: this.snapshot.version + 1 });
    this.noteHeard();
  }

  private noteHeard(): void {
    if (this.lastHeard == null) return;
    if (this.heard == null || this.lastHeard - this.heard >= 1000) this.heard = this.lastHeard;
  }

  /** Once a minute while live: a quiet market's line still reaches now. */
  private tick(): void {
    const market = this.snapshot.market;
    if (!market || !this.wantsLive) return;
    const now = env.now();
    let series = this.snapshot.series;
    let moved = false;
    for (const { outcome } of market.tokens) {
      const points = series[outcome] ?? [];
      const last = points.at(-1);
      if (!last || now - last.t < TICKER_QUIET_MS) continue;
      series = { ...series, [outcome]: [...points, { t: now, p: last.p }] };
      moved = true;
    }
    if (moved) this.emit({ series, version: this.snapshot.version + 1 });
  }

  /** Tests and the performance check: frames through the real receive and coalescing path, published at once at `time`. */
  simulate(updates: readonly BookUpdate[], time: number): void {
    this.take(updates);
    if (this.timers.flush != null) clearTimeout(this.timers.flush);
    delete this.timers.flush;
    this.flush(time);
  }

  /** Tests and the render harness: a market and its series without the network (OddsFeed.preview). */
  preview(market: Market, series: Partial<Record<Outcome, readonly PricePoint[]>>): void {
    this.emit({ status: "ready", market, loaded: true, series, version: this.snapshot.version + 1 });
  }

  // MARK: Reading

  /**
   * The newest moment the market has spoken for at `until`: what a live
   * chart's domain needs, without reading the whole series. Null until every
   * outcome has spoken. (Binary searches: this runs with every tick.)
   */
  latestTick(until: number | null = null): number | null {
    return latestTick(this.snapshot, until);
  }

  /** The ticks past `p`, oldest first: when a broadcasting chart next redraws. */
  ticks(after: number, limit = 240): number[] {
    return ticksAfter(this.snapshot, after, limit);
  }
}

/**
 * Adds a point when the price moved at least a tenth of a point. A long
 * quiet spell is kept as the flat stretch it was (a hold point just before
 * the move), not a diagonal across it; after a stretch nobody saw (a `GAP`),
 * the new line just starts, moved or not. Null: nothing to add. (OddsFeed.publish)
 */
export function publish(points: readonly PricePoint[], price: number, t: number): PricePoint[] | null {
  const last = points.at(-1);
  const out = [...points];
  if (last) {
    const quiet = t - last.t;
    if (!(quiet > 0) || !(Math.abs(price - last.p) >= EPSILON || quiet > GAP)) return null;
    if (quiet > QUIET_MS && quiet <= GAP) out.push({ t: t - 1000, p: last.p });
  }
  out.push({ t, p: price });
  return out.length > CAP + 60 ? compact(out, t) : out;
}

/** The snapshot's newest tick at `until` (every outcome must have spoken). */
export function latestTick(snapshot: OddsSnapshot, until: number | null = null): number | null {
  const market = snapshot.market;
  if (!market) return null;
  let newest: number | null = null;
  for (const { outcome } of market.tokens) {
    const point = lastAtOrBefore(snapshot.series[outcome] ?? [], until ?? Infinity, (p) => p.t);
    if (!point) return null;
    newest = Math.max(newest ?? point.t, point.t);
  }
  return newest;
}

/** The snapshot's ticks past `p`, oldest first. */
export function ticksAfter(snapshot: OddsSnapshot, p: number, limit = 240): number[] {
  const out = new Set<number>();
  for (const points of Object.values(snapshot.series)) {
    if (!points) continue;
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid]!.t <= p) lo = mid + 1;
      else hi = mid;
    }
    for (const point of points.slice(lo, lo + limit)) out.add(point.t);
  }
  return [...out].sort((a, b) => a - b).slice(0, limit);
}

/** The history to ask for: before a game, the last day; else from half an hour before the earlier of the market's and the game's start, to now (a final: six hours from the start at most). */
export function historyRange(game: OddsGame, market: Pick<Market, "start">, now: number): { from: number; to: number } {
  if (game.state === "scheduled") return { from: now - 86_400_000, to: now };
  const from = Math.min(market.start ?? game.start, game.start) - 30 * MINUTE;
  const to = game.state === "final" ? Math.min(now, game.start + 6 * 3_600_000) : now;
  return { from, to };
}

// MARK: - React

/** Feeds kept for the session's last few games, so going back shows the chart at once (its tail fetched). */
const feeds = new Map<string, OddsFeed>();
const KEEP = 4;

function feedFor(game: OddsGame): OddsFeed {
  let feed = feeds.get(game.id);
  if (feed) {
    feeds.delete(game.id);
  } else {
    feed = new OddsFeed(game);
    for (const [id, old] of feeds) {
      if (feeds.size < KEEP) break;
      old.detach();
      feeds.delete(id);
    }
  }
  feeds.set(game.id, feed);
  return feed;
}

/**
 * The game's odds feed while its page is open (the timeline and Win
 * Probability share it, as the Mac's page holds one): found as the page
 * opens; history and the socket follow only while the section is on screen
 * (`feed.setOnScreen`). Null `game`: odds are off or the league has none (no
 * requests). Subscribes to nothing: readers use `useOddsSnapshot` or
 * `useOddsSelect`.
 */
export function useOddsFeedObject(game: OddsGame | null): OddsFeed | null {
  const id = game?.id ?? null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const feed = useMemo(() => (game ? feedFor(game) : null), [id]);
  useEffect(() => {
    if (!feed) return;
    feed.attach();
    return () => feed.detach();
  }, [feed]);
  useEffect(() => {
    if (feed && game) feed.setGame(game);
  });
  return feed;
}

/** The feed's snapshot, re-rendering on every change of it. */
export function useOddsSnapshot(feed: OddsFeed | null): OddsSnapshot {
  return useSyncExternalStore(feed?.subscribe ?? noSubscribe, feed?.getSnapshot ?? idle, feed?.getSnapshot ?? idle);
}

/** One primitive read from the feed's snapshot: a reader re-renders only when it changes. */
export function useOddsSelect<T>(feed: OddsFeed | null, select: (snapshot: OddsSnapshot) => T): T {
  const read = () => select(feed?.getSnapshot() ?? IDLE);
  return useSyncExternalStore(feed?.subscribe ?? noSubscribe, read, read);
}

const noSubscribe = () => () => {};
const idle = () => IDLE;

/** Tests only: forget every cache and feed. */
export function resetOdds(): void {
  for (const f of feeds.values()) f.detach();
  feeds.clear();
  listings.clear();
  markets.clear();
}
