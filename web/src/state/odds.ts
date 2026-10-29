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
 * - History is fetched once, then only its tail since the last point.
 * - One WebSocket at a time: opened when the section comes on screen, closed
 *   when it leaves, when the tab is hidden, and when the page closes;
 *   reconnecting with backoff, and polling the midpoint every 15 s when the
 *   socket can't connect.
 * - Incoming ticks are coalesced to at most two updates a second, and each
 *   series kept to about 600 points (older history in minute buckets).
 *
 * A feed is a small object outside React; the section reads it with
 * `useOddsFeed`, which re-renders only when a displayed price changes.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { GameState } from "../data/odds/chart";
import { getJSON, HTTPError, type Fetcher } from "../data/http";
import {
  applyUpdate,
  candidateDates,
  compact,
  displayedPrice,
  EMPTY_QUOTE,
  eventURL,
  historyURL,
  isThreeWay,
  listingURL,
  marketEventSlug,
  marketFromEvent,
  marketURL,
  matchEvent,
  midpointURL,
  parseHistory,
  parseListing,
  parseMidpoint,
  parseSocketMessage,
  seriesFor,
  SOCKET,
  twoWayMarket,
  type GameKey,
  type Market,
  type Outcome,
  type PMEvent,
  type PricePoint,
  type Quote,
} from "../data/odds/polymarket";

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
  if (!isThreeWay(game.path)) {
    try {
      const json = await env.fetcher(marketURL(event.slug));
      const parent = marketEventSlug(json);
      const two = parent == null || parent === event.slug ? twoWayMarket(json, event.slug, key) : null;
      if (two) return two;
    } catch (error) {
      if (!(error instanceof HTTPError && error.status === 404)) throw error;
    }
  }
  return marketFromEvent(await env.fetcher(eventURL(event.slug)), key);
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
  /** The first and last plays' wall clock (data/odds/espn.ts). */
  readonly playStart: number | null;
  readonly playEnd: number | null;
  /** Each side's names as ESPN writes them, for the match. */
  readonly names: { readonly top: readonly string[]; readonly bottom: readonly string[] };
}

export type OddsStatus = "idle" | "matching" | "none" | "ready" | "failed";

export interface OddsSnapshot {
  /** "ready": the market is known (its history may still be on its way: `loaded`). */
  readonly status: OddsStatus;
  readonly market: Market | null;
  /** The history has landed (the line can draw). */
  readonly loaded: boolean;
  /** Each tracked outcome's prices, oldest first. */
  readonly series: Readonly<Partial<Record<Outcome, readonly PricePoint[]>>>;
  /** The newest price per outcome. */
  readonly current: Readonly<Partial<Record<Outcome, number>>>;
  readonly transport: "socket" | "poll" | null;
  /** Bumped on every change of a price (the chart glides to it). */
  readonly version: number;
}

const IDLE: OddsSnapshot = { status: "idle", market: null, loaded: false, series: {}, current: {}, transport: null, version: 0 };

/** On screen this long before tracking starts, off screen this long before it stops (scrolling past doesn't churn connections). */
const ON_AFTER_MS = 250;
const OFF_AFTER_MS = 2000;
/** While live and on screen, a quiet market's price is repeated at now once a minute, so the line reaches the present. */
const REPEAT_MS = 60_000;
/** A move after this much quiet gets a hold point a second before it: the line steps, not a diagonal across the quiet. */
const QUIET_MS = 10_000;

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
  private resuming: Promise<void> | null = null;
  private socket: SocketLike | null = null;
  private opened = false;
  private failures = 0;
  private readonly quotes = new Map<string, Quote>();
  private readonly stamps = new Map<string, number>();
  private dirty = false;
  private lastFlush = 0;
  /** When the feed last heard anything, by the wall clock of this machine (for "Live · 4s"). */
  heard: number | null = null;
  private timers: {
    flush?: ReturnType<typeof setTimeout>;
    ping?: ReturnType<typeof setInterval>;
    poll?: ReturnType<typeof setInterval>;
    retry?: ReturnType<typeof setTimeout>;
    repeat?: ReturnType<typeof setInterval>;
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

  /** The page polls the game: its state and plays move on. */
  setGame(game: OddsGame): void {
    const was = this.game.state;
    this.game = game;
    if (was === game.state) return;
    if (game.state === "final" && this.snapshot.loaded) {
      // Over: one last tail to the end, then nothing live.
      this.stopLive();
      void this.tail();
    }
    this.run();
  }

  /** The section is on screen, or not: tracking follows after 0.25 s on, or 2 s off. */
  setOnScreen(on: boolean): void {
    this.wantOnScreen = on;
    if (this.screenTimer != null) clearTimeout(this.screenTimer);
    this.screenTimer = null;
    if (on === this.onScreen) return;
    this.screenTimer = setTimeout(() => {
      this.screenTimer = null;
      this.onScreen = this.wantOnScreen;
      this.run();
    }, on ? ON_AFTER_MS : OFF_AFTER_MS);
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
    if (this.wantsLive && !this.socket && this.timers.poll == null && this.timers.retry == null && !this.resuming) {
      // Back on screen: fill the gap, then listen.
      this.resuming = this.tail().then(() => {
        this.resuming = null;
        this.startLive();
      });
    }
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

  private loadHistory(): Promise<void> {
    if (this.loading) return this.loading;
    const market = this.snapshot.market!;
    this.loading = (async () => {
      try {
        const now = env.now();
        const { from, to, fidelity } = historyRange(this.game, now);
        const histories = await Promise.all(market.tokens.map(({ token }) => env.fetcher(historyURL(token, from, to, fidelity)).then(parseHistory)));
        const series: Partial<Record<Outcome, readonly PricePoint[]>> = {};
        const current: Partial<Record<Outcome, number>> = {};
        market.tokens.forEach(({ outcome }, i) => {
          const points = compact(histories[i]!, now);
          series[outcome] = points;
          const last = points.at(-1);
          if (last) current[outcome] = last.p;
        });
        this.emit({ loaded: true, series, current, version: this.snapshot.version + 1 });
      } catch {
        // The frame stays without its line; the next appearance asks again.
      } finally {
        this.loading = null;
      }
      if (this.snapshot.loaded) this.run();
    })();
    return this.loading;
  }

  /** History since the last point, merged in (back on screen, a reconnect, or the game ending). */
  private async tail(): Promise<void> {
    const market = this.snapshot.market;
    if (!market || !this.snapshot.loaded) return;
    const now = env.now();
    try {
      const fresh = await Promise.all(
        market.tokens.map(({ outcome, token }) => {
          const last = this.snapshot.series[outcome]?.at(-1)?.t ?? historyRange(this.game, now).from;
          return now - last < MINUTE ? Promise.resolve([] as PricePoint[]) : env.fetcher(historyURL(token, last, now)).then(parseHistory);
        }),
      );
      if (fresh.every((f) => f.length === 0)) return;
      const series = { ...this.snapshot.series };
      const current = { ...this.snapshot.current };
      market.tokens.forEach(({ outcome }, i) => {
        const old = series[outcome] ?? [];
        const lastT = old.at(-1)?.t ?? -Infinity;
        const merged = compact([...old, ...fresh[i]!.filter((p) => p.t > lastT)], now);
        series[outcome] = merged;
        const last = merged.at(-1);
        if (last) current[outcome] = last.p;
      });
      this.emit({ series, current, version: this.snapshot.version + 1 });
    } catch {
      // The socket's ticks carry on from here; the gap stays a straight line.
    }
  }

  // MARK: Live

  private startLive(): void {
    if (!this.wantsLive || this.socket || this.timers.poll != null) return;
    if (tracker && tracker !== this) tracker.stopLive();
    tracker = this;
    this.openSocket();
    // A quiet market still reaches now.
    this.timers.repeat ??= setInterval(() => this.repeat(), REPEAT_MS);
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
    for (const key of ["ping", "poll", "repeat"] as const) if (this.timers[key] != null) clearInterval(this.timers[key]);
    for (const key of ["flush", "retry"] as const) if (this.timers[key] != null) clearTimeout(this.timers[key]);
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
      // Whatever was missed while it was down.
      void this.tail();
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
    const delay = this.timers.poll != null ? RETRY_SOCKET_MS : Math.min(1000 * 2 ** Math.max(this.failures - 1, 0), 30_000);
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
      for (const { token } of market.tokens) {
        try {
          const mid = parseMidpoint(await env.fetcher(midpointURL(token)));
          if (mid != null) this.quotes.set(token, { bid: mid, ask: mid, last: this.quotes.get(token)?.last ?? null });
          this.stamps.set(token, env.now());
          this.heard = Date.now();
          this.dirty = true;
        } catch {
          // The next poll tries again.
        }
      }
      if (this.timers.poll != null) this.flush();
    };
    this.timers.poll = setInterval(() => void poll(), POLL_MS);
    void poll();
    this.emit({ transport: "poll" });
  }

  /** A socket message: the quotes move at once; the chart hears at most twice a second. */
  receive(raw: string): void {
    const market = this.snapshot.market;
    if (!market) return;
    const updates = parseSocketMessage(raw, env.now());
    for (const u of updates) {
      if (!market.tokens.some((t) => t.token === u.token)) continue;
      // Heard: any frame for our tokens (a book, a price change, a trade), not only a price move.
      this.heard = Date.now();
      this.quotes.set(u.token, applyUpdate(this.quotes.get(u.token) ?? EMPTY_QUOTE, u));
      this.stamps.set(u.token, Math.max(this.stamps.get(u.token) ?? 0, u.t));
      this.dirty = true;
    }
    if (this.dirty && this.timers.flush == null) {
      const wait = Math.max(0, FLUSH_MS - (env.now() - this.lastFlush));
      this.timers.flush = setTimeout(() => {
        delete this.timers.flush;
        this.flush();
      }, wait);
    }
  }

  /** The displayed prices into the series, when one has moved a tenth of a point or more. */
  private flush(): void {
    this.dirty = false;
    this.lastFlush = env.now();
    const market = this.snapshot.market;
    if (!market) return;
    let changed = false;
    const series = { ...this.snapshot.series };
    const current = { ...this.snapshot.current };
    for (const { outcome, token } of market.tokens) {
      const q = this.quotes.get(token);
      const price = q ? displayedPrice(q.bid, q.ask, q.last) : null;
      if (price == null) continue;
      const before = current[outcome];
      if (before != null && Math.abs(before - price) < EPSILON) continue;
      const old = series[outcome] ?? [];
      const last = old.at(-1);
      const t = Math.max(this.stamps.get(token) ?? env.now(), last?.t ?? 0);
      const held = last && t - last.t > QUIET_MS ? [{ t: t - 1000, p: last.p }] : [];
      series[outcome] = compact([...old, ...held, { t, p: price }], env.now());
      current[outcome] = price;
      changed = true;
    }
    if (changed) this.emit({ series, current, version: this.snapshot.version + 1 });
  }

  /** A quiet minute: the price repeated at now, so the line reaches the present. */
  private repeat(): void {
    const market = this.snapshot.market;
    if (!market || !this.wantsLive) return;
    const now = env.now();
    const series = { ...this.snapshot.series };
    let moved = false;
    for (const { outcome } of market.tokens) {
      const old = series[outcome] ?? [];
      const last = old.at(-1);
      if (!last || now - last.t < REPEAT_MS) continue;
      series[outcome] = compact([...old, { t: now, p: last.p }], now);
      moved = true;
    }
    if (moved) this.emit({ series, version: this.snapshot.version + 1 });
  }
}

/** The history to ask for: the game and a 30-minute lead-in (its opening price); before a game, the last day at 5-minute grain. */
export function historyRange(game: OddsGame, now: number): { from: number; to: number; fidelity: number } {
  if (game.state === "scheduled") return { from: now - 24 * 60 * MINUTE, to: now, fidelity: 5 };
  const from = (game.playStart ?? game.start) - 30 * MINUTE;
  const to = game.state === "final" ? (game.playEnd ?? game.start + 4 * 60 * MINUTE) + 15 * MINUTE : now;
  return { from, to: Math.max(to, from + MINUTE), fidelity: 1 };
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
 * The game's odds feed while its section is mounted: `onScreen` opens and
 * closes it. Null `game`: odds are off or the league has none (no requests).
 */
export function useOddsFeed(game: OddsGame | null, onScreen: boolean): { feed: OddsFeed | null; snapshot: OddsSnapshot } {
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
  useEffect(() => {
    feed?.setOnScreen(onScreen);
  }, [feed, onScreen]);
  const snapshot = useSyncExternalStore(feed?.subscribe ?? noSubscribe, feed?.getSnapshot ?? idle, feed?.getSnapshot ?? idle);
  return { feed, snapshot };
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
