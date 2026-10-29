/**
 * Live odds (ODDS-SPEC.md): Polymarket's matching, market, history, book
 * and displayed price (data/odds/polymarket.ts), ESPN's half and DraftKings'
 * de-vig (data/odds/espn.ts), the chart's geometry (data/odds/chart.ts) and
 * the feed's coalescing, socket and fallback (state/odds.ts), on two real
 * finals: GSW 119–114 @ MIN (2026-10-28, ESPN 401909888, Polymarket
 * `nba-gsw-min-2026-10-28`) and Aston Villa 2–1 Manchester City
 * (2026-10-24, ESPN 401879256, `epl-ast-mac-2026-10-24`), from
 * `pnpm fixtures odds`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { badgeRect, gameDomain, glideProgress, heartbeat, percent, plotIn, scrubTime, splitAtMid, traded, visible, windowDomain, yOf } from "../../src/data/odds/chart";
import { clockAt, devig, draftKings, impliedChance, nearestPlay, parseOddsBasis } from "../../src/data/odds/espn";
import {
  applyUpdate,
  candidateDates,
  compact,
  displayedPrice,
  EMPTY_QUOTE,
  isMainEvent,
  marketFromEvent,
  matchEvent,
  nameScore,
  parseHistory,
  parseListing,
  parseSocketMessage,
  tokens,
  twoWayMarket,
  type GameKey,
} from "../../src/data/odds/polymarket";
import { findMarket, OddsFeed, resetOdds, setOddsEnvironment, type OddsGame } from "../../src/state/odds";
import { fixture, replay } from "./fixtures";

const nbaSummary = fixture("odds/espn-nba-gsw-min-summary.json");
const nbaListing = fixture("odds/pm-nba-gsw-min-listing.json") as { events: unknown[] };
const nbaMarket = fixture("odds/pm-nba-gsw-min-market.json");
const nbaHistory = fixture("odds/pm-nba-gsw-min-history.json") as { histories: Record<string, unknown> };
const eplSummary = fixture("odds/espn-epl-ast-mac-summary.json");
const eplListing = fixture("odds/pm-epl-ast-mac-listing.json") as { events: unknown[] };
const eplEvent = fixture("odds/pm-epl-ast-mac-event.json");
const eplHistory = fixture("odds/pm-epl-ast-mac-history.json") as { histories: Record<string, unknown> };
const socket = fixture("odds/pm-socket-messages.json") as { messages: string[]; tokens: { top: string; bottom: string } };

const WARRIORS = "41424811810090436635418852622590712864128153307552382181298046819630366692836";
const TIP = Date.parse("2026-10-29T00:00:00Z");

// GSW is the top team (North American sports list away first); ESPN's names for each side.
const nbaBasis = parseOddsBasis(nbaSummary, "basketball", false);
const gswMin: GameKey = { start: TIP, top: ["Warriors", ...nbaBasis.names.top], bottom: ["Timberwolves", ...nbaBasis.names.bottom] };
// Soccer lists the home side first.
const eplBasis = parseOddsBasis(eplSummary, "soccer", true);
const astMac: GameKey = { start: Date.parse("2026-10-24T11:30:00Z"), top: ["Aston Villa", ...eplBasis.names.top], bottom: ["Man City", ...eplBasis.names.bottom] };

describe("matching a game to its market", () => {
  const events = parseListing(nbaListing.events);

  it("finds GSW @ MIN by both names and the start, whatever the abbreviations (ESPN's GS, Polymarket's gsw)", () => {
    expect(nbaBasis.names.top).toContain("Golden State Warriors");
    expect(matchEvent(events, gswMin)?.slug).toBe("nba-gsw-min-2026-10-28");
  });

  it("skips sub-events, which carry a suffix after the date", () => {
    expect(events.some((e) => e.slug === "nba-gsw-min-2026-10-28-exact-margin")).toBe(true);
    expect(isMainEvent("nba-gsw-min-2026-10-28-exact-margin")).toBe(false);
    expect(isMainEvent("epl-ast-mac-2026-10-24")).toBe(true);
  });

  it("rejects near misses: a wrong team, a start more than 6 hours off, a name that fits both sides", () => {
    expect(matchEvent(events, { ...gswMin, bottom: ["Minnesota Lynx", "Lynx"] })).toBeNull();
    expect(matchEvent(events, { ...gswMin, start: TIP + 7 * 3_600_000 })).toBeNull();
    // "Los Angeles" is both LA teams' location: alone, it decides nothing.
    expect(matchEvent(events, { start: Date.parse("2026-10-29T02:30:00Z"), top: ["Los Angeles"], bottom: ["Los Angeles"] })).toBeNull();
    expect(matchEvent(events, { start: Date.parse("2026-10-29T02:30:00Z"), top: ["Lakers", "Los Angeles"], bottom: ["Clippers", "Los Angeles"] })?.slug).toBe("nba-lal-lac-2026-10-28");
    // Manchester City isn't Manchester United.
    const epl = parseListing(eplListing.events);
    expect(matchEvent(epl, astMac)?.slug).toBe("epl-ast-mac-2026-10-24");
    expect(matchEvent(epl, { ...astMac, bottom: ["Manchester United", "Man United"] })).toBeNull();
  });

  it("tells a doubleheader apart only when one start is clearly nearer", () => {
    const one = { id: "1", slug: "mlb-mil-chc-2026-07-04", title: "Brewers vs. Cubs", startTime: TIP, teams: [{ name: "Brewers", alias: null, abbreviation: null, ordering: "away" }, { name: "Cubs", alias: null, abbreviation: null, ordering: "home" }] };
    const key = { start: TIP + 30 * 60_000, top: ["Brewers"], bottom: ["Cubs"] };
    expect(matchEvent([one, { ...one, id: "2", startTime: TIP + 4 * 3_600_000 }], key)?.id).toBe("1");
    expect(matchEvent([one, { ...one, id: "2", startTime: TIP + 60 * 60_000 }], key)).toBeNull();
  });

  it("compares names as words (the Mac's OddsMatch): accents folded, club affixes and numbers dropped, local names to ESPN's", () => {
    expect(tokens("Aston Villa FC")).toEqual(["aston", "villa"]);
    expect(tokens("FC Bayern München")).toEqual(["bayern", "munich"]);
    expect(tokens("Club Atlético de Madrid")).toEqual(["atletico", "madrid"]);
    expect(tokens("Como 1907")).toEqual(["como"]);
    expect(tokens("Brighton & Hove Albion FC")).toEqual(["brighton", "and", "hove", "albion"]);
    // 3 the same words; 2 two or more found in the other; 1 a single word; 0 none.
    expect(nameScore("Manchester City FC", ["Man City", "Manchester City"])).toBe(3);
    expect(nameScore("Club Atlético de Madrid", ["Atlético Madrid"])).toBe(3);
    expect(nameScore("Hamburger SV", ["Hamburg"])).toBe(1);
    expect(nameScore("Manchester City FC", ["Manchester United", "Man United"])).toBe(0);
  });

  it("asks for the game's New York date first, then a day either side", () => {
    expect(candidateDates(TIP)).toEqual(["2026-10-28", "2026-10-27", "2026-10-29"]);
  });

  it("finds the market with two light requests: the day's listing without markets, then the moneyline by slug", async () => {
    resetOdds();
    const fetcher = replay([
      [/events\?series_id=10345&event_date=2026-10-28&include_markets=false/, nbaListing.events],
      [/markets\/slug\/nba-gsw-min-2026-10-28$/, nbaMarket],
    ]);
    setOddsEnvironment({ fetcher });
    const game: OddsGame = { id: "401909888", path: "basketball/nba", state: "final", start: TIP, playStart: nbaBasis.start, playEnd: nbaBasis.end, names: gswMin };
    const market = await findMarket(game);
    expect(market).toMatchObject({ slug: "nba-gsw-min-2026-10-28", kind: "two-way", tokens: [{ outcome: "top", token: WARRIORS }] });
    expect(fetcher.calls).toHaveLength(2);
    // Soccer: its event, whose three moneyline markets are all it holds.
    const soccer = replay([
      [/series_id=10188&event_date=2026-10-24/, eplListing.events],
      [/events\/slug\/epl-ast-mac-2026-10-24$/, eplEvent],
    ]);
    setOddsEnvironment({ fetcher: soccer });
    expect((await findMarket({ id: "401879256", path: "soccer/eng.1", state: "final", start: astMac.start, playStart: eplBasis.start, playEnd: eplBasis.end, names: astMac }))?.kind).toBe("three-way");
  });
});

describe("the market", () => {
  it("reads a two-way moneyline: the top team's token, its volume", () => {
    const m = twoWayMarket(nbaMarket, "nba-gsw-min-2026-10-28", gswMin)!;
    expect(m.tokens).toEqual([{ outcome: "top", token: WARRIORS }]);
    expect(traded(m.volume)).toBe("$3.1M traded");
    // The same market, the teams the other way round: the token follows the team, not the order.
    expect(twoWayMarket(nbaMarket, "x", { top: gswMin.bottom, bottom: gswMin.top })!.tokens[0]!.token).not.toBe(WARRIORS);
  });

  it("reads soccer's three moneyline markets: each outcome's Yes token, the volumes summed", () => {
    const m = marketFromEvent(eplEvent, astMac)!;
    expect(m.kind).toBe("three-way");
    expect(m.tokens.map((t) => t.outcome)).toEqual(["top", "draw", "bottom"]);
    expect(m.tokens[0]!.token).toBe("69889052490290426975941356469153102874446961508300512903222835990962403514551");
    expect(traded(m.volume)).toBe("$4.9M traded");
  });
});

describe("prices", () => {
  it("parses a token's history into time order (148 points through the game, 0.405 before tip-off to 0.9995 at the end)", () => {
    const h = parseHistory(nbaHistory.histories[WARRIORS]);
    expect(h.length).toBeGreaterThanOrEqual(148);
    expect(h[0]).toEqual({ t: 1793230232000, p: 0.405 });
    expect(h.at(-1)!.p).toBe(0.9995);
    expect(h.every((x, i) => i === 0 || x.t > h[i - 1]!.t)).toBe(true);
  });

  it("shows Polymarket's price: the midpoint, or the last trade when the spread is wider than 10¢", () => {
    expect(displayedPrice(0.49, 0.5, 0.5)).toBeCloseTo(0.495);
    expect(displayedPrice(0.3, 0.45, 0.41)).toBe(0.41);
    expect(displayedPrice(0.3, 0.4, 0.41)).toBeCloseTo(0.35);
    expect(displayedPrice(null, null, 0.62)).toBe(0.62);
    expect(displayedPrice(0.3, 0.45, null)).toBeCloseTo(0.375);
  });

  it("reads the socket's real messages: the book, price changes, a trade, PONG", () => {
    const [book, change, , trade, pong] = socket.messages;
    const b = parseSocketMessage(book!);
    expect(b).toEqual([{ token: socket.tokens.top, bid: 0.49, ask: 0.5, last: 0.5, t: 1793256238356 }]);
    const c = parseSocketMessage(change!);
    expect(c.map((u) => u.token).sort()).toEqual([socket.tokens.bottom, socket.tokens.top].sort());
    expect(c.find((u) => u.token === socket.tokens.top)).toMatchObject({ bid: 0.49, ask: 0.5 });
    expect(parseSocketMessage(trade!)[0]).toMatchObject({ last: 0.45 });
    expect(parseSocketMessage(pong!)).toEqual([]);
    const q = c.reduce((acc, u) => (u.token === socket.tokens.top ? applyUpdate(acc, u) : acc), applyUpdate(EMPTY_QUOTE, b[0]!));
    expect(displayedPrice(q.bid, q.ask, q.last)).toBeCloseTo(0.495);
  });

  it("keeps a series to about 600 points: the last 10 minutes by the second, older by the minute", () => {
    const now = TIP + 3 * 3_600_000;
    const dense = Array.from({ length: 21_600 }, (_, i) => ({ t: TIP + i * 500, p: 0.5 + 0.4 * Math.sin(i / 300) }));
    const c = compact(dense, now);
    expect(c.length).toBeLessThanOrEqual(600);
    expect(c[0]).toBe(dense[0]);
    expect(c.at(-1)).toBe(dense.at(-1));
    const old = c.filter((p) => p.t < now - 600_000);
    expect(new Set(old.map((p) => Math.floor(p.t / 60_000))).size).toBeGreaterThanOrEqual(old.length - 1);
  });
});

describe("ESPN and DraftKings", () => {
  it("removes DraftKings' vig: GSW +130 / MIN −155 is 42% / 58%", () => {
    expect(impliedChance(130)).toBeCloseTo(100 / 230);
    expect(impliedChance(-155)).toBeCloseTo(155 / 255);
    const dk = draftKings(nbaSummary, false)!;
    expect(dk.top).toBeCloseTo(0.417, 3);
    expect(dk.bottom).toBeCloseTo(0.583, 3);
    expect(dk.top + dk.bottom).toBeCloseTo(1);
    // Soccer's three outcomes: Villa +380, the draw +350, City −160.
    const soccer = draftKings(eplSummary, true)!;
    expect([soccer.top, soccer.draw, soccer.bottom].map((p) => Math.round(p! * 100))).toEqual([20, 21, 59]);
    expect(devig([0.5, null])).toBeNull();
  });

  it("puts ESPN's model on the wall clock in game order, joined to its plays (it lists by sequence number)", () => {
    const win = nbaBasis.win;
    expect(win.length).toBeGreaterThan(500);
    expect(win[0]).toEqual({ t: Date.parse("2026-10-29T00:10:41Z"), top: expect.closeTo(1 - 0.764, 5), draw: 0 });
    expect(win.every((w, i) => i === 0 || w.t >= win[i - 1]!.t)).toBe(true);
    // Shuffled, the entries land in the same order: the plays decide it.
    const shuffled = { ...(nbaSummary as object), winprobability: [...((nbaSummary as { winprobability: unknown[] }).winprobability)].reverse() };
    expect(parseOddsBasis(shuffled, "basketball", false).win).toEqual(win);
  });

  it("finds where each period starts, the game clock and the play nearest a moment", () => {
    expect(nbaBasis.periods.map((p) => p.label)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(nbaBasis.periods.every((p, i) => i === 0 || p.t > nbaBasis.periods[i - 1]!.t)).toBe(true);
    const q3 = nbaBasis.periods[2]!.t + 10 * 60_000;
    expect(clockAt(nbaBasis.plays, q3)).toMatch(/^Q3 \d+:\d\d$/);
    const play = nearestPlay(nbaBasis.plays, q3)!;
    expect(Math.abs(play.t - q3)).toBeLessThanOrEqual(3 * 60_000);
    expect(play.text).not.toMatch(/assists\)/);
    expect(nearestPlay(nbaBasis.plays, nbaBasis.end! + 3_600_000)).toBeNull();
    // Soccer: halves from the commentary, no ESPN model.
    expect(eplBasis.win).toEqual([]);
    expect(eplBasis.periods.map((p) => p.label)).toEqual(["1st", "2nd"]);
    expect(eplBasis.periods[0]!.t).toBe(Date.parse("2026-10-24T11:31:45Z"));
  });
});

describe("the chart's geometry", () => {
  const plot = plotIn(320, 144, 64, true);

  it("splits the line exactly at 50%, each run one side's", () => {
    const y = yOf(plot);
    const mid = y(0.5);
    const runs = splitAtMid([0.4, 0.45, 0.6, 0.7, 0.3].map((p, i) => ({ x: i * 10, y: y(p) })), mid);
    expect(runs.map((r) => r.side)).toEqual(["bottom", "top", "bottom"]);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i - 1]!.points.at(-1)!.y).toBe(mid);
      expect(runs[i]!.points[0]).toEqual(runs[i - 1]!.points.at(-1));
    }
    for (const r of runs) expect(r.points.every((p) => (r.side === "top" ? p.y <= mid : p.y >= mid))).toBe(true);
  });

  it("never clips the badge, at 0%, 50% or 100%, for any width the plot reserved", () => {
    for (const width of [40, 64]) {
      const p = plotIn(320, 144, width, true);
      for (const value of [0, 0.5, 1]) {
        const dot = { x: p.right, y: yOf(p)(value) };
        const r = badgeRect(p, dot, width);
        expect(r.x).toBeGreaterThan(dot.x);
        expect(r.x + r.width).toBeLessThanOrEqual(p.width);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.y + r.height).toBeLessThanOrEqual(p.height);
      }
    }
  });

  it("snaps the scrub to the nearest whole minute inside the domain", () => {
    const d = { from: TIP + 25_000, to: TIP + 90 * 60_000 + 10_000 };
    const at = (f: number) => scrubTime(plot.left + f * (plot.right - plot.left), plot, d);
    for (const f of [0, 0.13, 0.5, 0.999, 1, 1.4]) {
      const t = at(f);
      expect(t % 60_000).toBe(0);
      expect(t).toBeGreaterThanOrEqual(d.from);
      expect(t).toBeLessThanOrEqual(d.to);
    }
    expect(at(0.5)).toBe(Math.round((d.from + d.to) / 2 / 60_000) * 60_000);
  });

  it("spans the game: first to last play when final, to now while live, the market's last day before", () => {
    const final = gameDomain({ state: "final", scheduled: TIP, start: nbaBasis.start, end: nbaBasis.end, now: TIP + 9e6, firstPrice: null, lastPrice: null });
    expect(final).toEqual({ from: Date.parse("2026-10-29T00:10:41Z"), to: Date.parse("2026-10-29T02:43:59Z") });
    const live = gameDomain({ state: "live", scheduled: TIP, start: nbaBasis.start, end: null, now: TIP + 3_600_000, firstPrice: null, lastPrice: null });
    expect(live.to).toBe(TIP + 3_600_000);
    expect(windowDomain(live, "10m")).toEqual({ from: TIP + 3_000_000, to: TIP + 3_600_000 });
    const before = gameDomain({ state: "scheduled", scheduled: TIP, start: null, end: null, now: TIP - 3_600_000, firstPrice: null, lastPrice: null });
    expect(before.to - before.from).toBe(24 * 3_600_000);
    // The price at the domain's start is carried in from before it; the end holds the last price.
    const h = parseHistory(nbaHistory.histories[WARRIORS]);
    const v = visible(h, final, null);
    // 0.405 an hour before tip-off; 0.425 by the jump ball.
    expect(v[0]).toEqual({ t: final.from, p: 0.425 });
    expect(v.at(-1)!.t).toBe(final.to);
  });

  it("glides on Liveline's curve: quick at first, landing at 0.5 s", () => {
    expect(glideProgress(0)).toBe(0);
    expect(glideProgress(500)).toBe(1);
    expect(glideProgress(100)).toBeGreaterThan(0.4);
    expect(glideProgress(250)).toBeGreaterThan(0.75);
    for (let t = 0; t < 500; t += 25) expect(glideProgress(t + 25)).toBeGreaterThan(glideProgress(t));
  });

  it("writes chances and freshness as Polymarket and the theaters do", () => {
    // Never 0 or 100 while undecided: 100% is for the final whistle.
    expect([percent(0.9995), percent(0.004), percent(0.415), percent(0.9995, true)]).toEqual(["99%", "1%", "42%", "100%"]);
    expect([heartbeat(4), heartbeat(130)]).toEqual(["Live · 4s", "Waiting for Polymarket · 2m"]);
  });
});

describe("the live feed", () => {
  class FakeSocket {
    static all: FakeSocket[] = [];
    onopen: ((e: unknown) => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onclose: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    sent: string[] = [];
    closed = false;
    constructor() {
      FakeSocket.all.push(this);
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      this.closed = true;
    }
  }

  const game: OddsGame = { id: "401909888", path: "basketball/nba", state: "live", start: TIP, playStart: nbaBasis.start, playEnd: null, names: gswMin };
  const listeners = new Map<string, () => void>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TIP + 3_600_000);
    resetOdds();
    FakeSocket.all = [];
    listeners.clear();
    vi.stubGlobal("document", { hidden: false, addEventListener: (k: string, f: () => void) => listeners.set(k, f), removeEventListener: (k: string) => listeners.delete(k) });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const network = () =>
    replay([
      [/include_markets=false/, nbaListing.events],
      [/markets\/slug\//, nbaMarket],
      [/prices-history/, nbaHistory.histories[WARRIORS]],
      [/midpoint/, { mid: "0.61" }],
    ]);

  /** Lets the feed's chain of requests resolve (the fetcher answers asynchronously). */
  const settle = async () => {
    for (let i = 0; i < 12; i++) await vi.advanceTimersByTimeAsync(1);
  };

  /** The page opens (the market is found at once), then the section comes on screen (tracking after 0.25 s). */
  async function opened(fetcher = network(), socket: () => FakeSocket = () => new FakeSocket()) {
    setOddsEnvironment({ fetcher, socket: socket as never, now: () => Date.now() });
    const feed = new OddsFeed(game);
    feed.attach();
    await settle();
    feed.setOnScreen(true);
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    return feed;
  }

  it("finds the market as the page opens, but asks for history and opens the socket only on screen", async () => {
    setOddsEnvironment({ fetcher: network(), socket: (() => new FakeSocket()) as never, now: () => Date.now() });
    const feed = new OddsFeed(game);
    feed.attach();
    await settle();
    expect(feed.getSnapshot()).toMatchObject({ status: "ready", loaded: false });
    expect(FakeSocket.all).toHaveLength(0);
    // Scrolled past in a blink: nothing.
    feed.setOnScreen(true);
    await vi.advanceTimersByTimeAsync(100);
    feed.setOnScreen(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(feed.getSnapshot().loaded).toBe(false);
    feed.detach();
  });

  it("opens one socket only on screen, subscribes to the token, and closes it off screen, hidden and on leaving", async () => {
    const feed = await opened();
    expect(feed.getSnapshot()).toMatchObject({ status: "ready", loaded: true });
    const ws = FakeSocket.all[0]!;
    ws.onopen?.({});
    expect(JSON.parse(ws.sent[0]!)).toEqual({ assets_ids: [WARRIORS], type: "market" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ws.sent).toContain("PING");
    // Off screen: closed 2 s later (scrolling past doesn't churn connections).
    feed.setOnScreen(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ws.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1100);
    expect(ws.closed).toBe(true);
    feed.setOnScreen(true);
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(FakeSocket.all).toHaveLength(2);
    (globalThis.document as { hidden: boolean }).hidden = true;
    listeners.get("visibilitychange")?.();
    expect(FakeSocket.all[1]!.closed).toBe(true);
    feed.detach();
    expect(feed.connected).toBe(false);
  });

  it("coalesces a burst of ticks into at most two updates a second", async () => {
    const feed = await opened();
    const ws = FakeSocket.all[0]!;
    ws.onopen?.({});
    let updates = 0;
    feed.subscribe(() => updates++);
    for (let i = 0; i < 40; i++) {
      ws.onmessage?.({ data: JSON.stringify({ event_type: "price_change", timestamp: String(Date.now()), price_changes: [{ asset_id: WARRIORS, best_bid: String(0.6 + i / 500), best_ask: String(0.61 + i / 500) }] }) });
      await vi.advanceTimersByTimeAsync(25);
    }
    await vi.advanceTimersByTimeAsync(600);
    expect(updates).toBeGreaterThanOrEqual(2);
    expect(updates).toBeLessThanOrEqual(3);
    expect(feed.getSnapshot().current.top).toBeCloseTo(0.6 + 39 / 500 + 0.005);
  });

  it("polls the midpoint every 15 s after two failed connects, and stops when the page closes", async () => {
    const fetcher = network();
    const feed = await opened(fetcher, () => {
      const s = new FakeSocket();
      queueMicrotask(() => s.onclose?.({}));
      return s;
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(feed.getSnapshot().transport).toBe("poll");
    const polls = () => fetcher.calls.filter((u) => u.includes("/midpoint")).length;
    const before = polls();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(polls()).toBe(before + 1);
    expect(feed.getSnapshot().current.top).toBe(0.61);
    feed.detach();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(polls()).toBe(before + 1);
  });
});
