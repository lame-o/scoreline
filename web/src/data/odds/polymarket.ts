/**
 * Polymarket's moneyline for a game (ODDS-SPEC.md, "Data"): which market is
 * this game's, its history, its live book, and the price Polymarket itself
 * shows. Pure: no fetching here (state/odds.ts fetches), so fixtures replay.
 *
 * The lookup is lighter than the spec's first draft (ODDS-DECISIONS.md, Web):
 * the day's listing is asked for without its markets (`include_markets=false`:
 * 8 KB where the full listing is 20 MB, each NBA game carrying ~450 props),
 * then only the matched game's moneyline, by slug.
 *
 * Matching is strict on purpose. A wrong market is worse than none: both
 * teams' names must agree (normalized; never the abbreviations, which differ:
 * ESPN's GS, NY, SA, UTAH against Polymarket's gsw, nyk, sas, uta) and the
 * start within 6 hours, and anything short of one confident candidate shows
 * no odds.
 */
import { arr, at, num, str, type JSONValue } from "../json";
import { d, s } from "../profiles/read";

export const GAMMA = "https://gamma-api.polymarket.com";
export const CLOB = "https://clob.polymarket.com";
export const SOCKET = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

/** Polymarket's series per ESPN league path (Gamma's `/sports`, verified 2026-10-28; eng.2 and the World Cup from `/sports` only). */
export const SERIES: Readonly<Record<string, number>> = {
  "basketball/nba": 10345,
  "basketball/wnba": 10105,
  "football/nfl": 12185,
  "football/college-football": 12756,
  "baseball/mlb": 3,
  "soccer/eng.1": 10188,
  "soccer/uefa.champions": 10204,
  "soccer/uefa.europa": 10209,
  "soccer/esp.1": 10193,
  "soccer/ger.1": 10194,
  "soccer/ita.1": 10203,
  "soccer/fra.1": 10195,
  "soccer/usa.1": 10189,
  "soccer/eng.2": 10355,
  "soccer/fifa.world": 11433,
};

export const seriesFor = (path: string): number | null => SERIES[path] ?? null;

/** Soccer's moneyline is three markets (top win, draw, bottom win), each Yes/No. */
export const isThreeWay = (path: string): boolean => path.startsWith("soccer/");

// MARK: - URLs

/** The league's events that day, without their markets (one cached listing serves every game that day). */
export const listingURL = (series: number, date: string) => `${GAMMA}/events?series_id=${series}&event_date=${date}&include_markets=false&limit=100`;
/** A two-way moneyline by its slug (US sports: the event's own slug). */
export const marketURL = (slug: string) => `${GAMMA}/markets/slug/${encodeURIComponent(slug)}`;
/** The whole event (soccer's three moneyline markets; the fallback elsewhere). */
export const eventURL = (slug: string) => `${GAMMA}/events/slug/${encodeURIComponent(slug)}`;
/** A token's price history, one point a minute (`fidelity` minutes), bounded to whole minutes so repeats hit caches. */
export function historyURL(token: string, from: number, to: number, fidelity = 1): string {
  const start = Math.floor(from / 60_000) * 60;
  const end = Math.ceil(to / 60_000) * 60;
  return `${CLOB}/prices-history?market=${token}&startTs=${start}&endTs=${end}&fidelity=${fidelity}`;
}
export const midpointURL = (token: string) => `${CLOB}/midpoint?token_id=${token}`;
/** Where "Polymarket ↗" goes. */
export const eventLink = (slug: string) => `https://polymarket.com/event/${slug}`;

// MARK: - Dates

const NY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** `event_date` candidates: the game's date in New York (Polymarket's US date), then a day either side. */
export function candidateDates(start: number): string[] {
  const day = 86_400_000;
  return [start, start - day, start + day].map((t) => NY.format(new Date(t)));
}

// MARK: - The listing

export interface PMTeam {
  readonly name: string;
  readonly alias: string | null;
  readonly abbreviation: string | null;
  /** "home" or "away", as Polymarket orders them. */
  readonly ordering: string | null;
}

export interface PMEvent {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly startTime: number | null;
  readonly teams: readonly PMTeam[];
}

const time = (v: JSONValue): number | null => {
  const s = str(v);
  if (!s) return null;
  // Gamma writes "2026-10-29T00:00:00Z", markets "2026-10-29 00:00:00+00".
  const t = Date.parse(s.includes("T") ? s : s.replace(" ", "T").replace(/\+00$/, "Z"));
  return Number.isNaN(t) ? null : t;
};

export function parseListing(json: JSONValue): PMEvent[] {
  const rows = Array.isArray(json) ? json : arr(at(json, "events"));
  return rows.flatMap((e): PMEvent[] => {
    const slug = str(at(e, "slug"));
    const id = str(at(e, "id")) ?? (num(at(e, "id")) != null ? String(num(at(e, "id"))) : undefined);
    if (!slug || !id) return [];
    const teams = arr(at(e, "teams")).flatMap((t): PMTeam[] => {
      const name = str(at(t, "name"));
      return name ? [{ name, alias: str(at(t, "alias")) ?? null, abbreviation: str(at(t, "abbreviation")) ?? null, ordering: str(at(t, "ordering")) ?? null }] : [];
    });
    return [{ id, slug, title: str(at(e, "title")) ?? "", startTime: time(at(e, "startTime")) ?? time(at(e, "gameStartTime")), teams }];
  });
}

/**
 * A main event's slug ends with its date (`nba-gsw-min-2026-10-28`); a
 * sub-event's carries a suffix after it (`-exact-margin`, `-halftime-result`,
 * `-player-props`). Only main events hold the moneyline.
 */
export const isMainEvent = (slug: string): boolean => /-\d{4}-\d{2}-\d{2}$/.test(slug);

// MARK: - Matching (Odds.swift `OddsMatch`, calibrated by the Mac on 286 real games: 281 matched, none wrong)
//
// Polymarket writes official club names ("Club Atlético de Madrid", "FC Bayern
// München", "Como 1907"), ESPN its own ("Atlético Madrid", "Bayern", "Como"),
// so names are compared as words, scored, and both teams must fit, one to a side.

/** Words that name a club's type, not the club. */
const AFFIXES = new Set(["fc", "afc", "cf", "the", "sc", "sk", "fk", "ac", "as", "ssc", "ud", "cd", "sd", "bk", "kv", "osc", "club", "de", "cp", "sad"]);
/** Local names to the ones ESPN uses. */
const EXONYMS: Readonly<Record<string, string>> = {
  praha: "prague", munchen: "munich", koln: "cologne", milano: "milan", roma: "rome", lisboa: "lisbon", sevilla: "seville", torino: "turin",
  napoli: "naples", firenze: "florence", genova: "genoa", wien: "vienna", kobenhavn: "copenhagen", bruxelles: "brussels", moskva: "moscow",
  warszawa: "warsaw", beograd: "belgrade", bucuresti: "bucharest", athina: "athens", lyonnais: "lyon", olympiakos: "olympiacos", omonoia: "omonia",
};
const LETTERS: Readonly<Record<string, string>> = { ø: "o", æ: "ae", ß: "ss", ł: "l", đ: "d", þ: "th", œ: "oe", ı: "i" };

/** A name as comparable words: "FC Bayern München" → ["bayern", "munich"]. */
export function tokens(name: string): string[] {
  let s = [...name.toLowerCase()].map((c) => LETTERS[c] ?? c).join("");
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replaceAll("&", " and ").replaceAll("red bull", "rb");
  s = ` ${s.replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).join(" ")} `;
  for (const [short, long] of [[" la ", " los angeles "], [" ny ", " new york "], [" st ", " saint "]] as const) s = s.replaceAll(short, long);
  return s
    .split(" ")
    .filter((w) => w && !AFFIXES.has(w) && !/^\d+$/.test(w))
    .map((w) => EXONYMS[w] ?? w);
}

/** One word for another: equal, or a longer form of a 5+ letter word ("hamburg", "hamburger"). */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && long.startsWith(short) && long.length - short.length <= 3;
}

const within = (small: readonly string[], big: readonly string[]) => small.every((w) => big.some((x) => sameWord(w, x)));

/** How well a name fits a team's names: 3 the same words, 2 two or more words of one found in the other, 1 a single word, 0 none. */
export function nameScore(name: string, candidates: readonly string[]): number {
  const words = tokens(name);
  if (words.length === 0) return 0;
  let best = 0;
  for (const candidate of candidates) {
    const other = tokens(candidate);
    if (other.length === 0) continue;
    if (other.length === words.length && within(other, words) && within(words, other)) return 3;
    const small = within(other, words) ? other : within(words, other) ? words : null;
    if (!small) continue;
    if (new Set(small).size >= 2) best = Math.max(best, 2);
    else if (small[0]!.length >= 2) best = Math.max(best, 1);
  }
  return best;
}

/** What the match compares: each side's names (ESPN's shortDisplayName, name, displayName, location) and the start. */
export interface GameKey {
  readonly start: number;
  readonly top: readonly string[];
  readonly bottom: readonly string[];
}

export type Outcome = "top" | "bottom" | "draw";

/**
 * Which side each of two names is (the first's, the second's), straight or
 * crossed: both must fit (a score of 1 or more), and the better reading must
 * be strictly better. Null otherwise: never guess.
 */
export function assignSides(first: string, second: string, key: Pick<GameKey, "top" | "bottom">): readonly ["top" | "bottom", "top" | "bottom"] | null {
  const straight = [nameScore(first, key.top), nameScore(second, key.bottom)] as const;
  const crossed = [nameScore(first, key.bottom), nameScore(second, key.top)] as const;
  const s = Math.min(...straight) >= 1;
  const c = Math.min(...crossed) >= 1;
  const totals = [straight[0] + straight[1], crossed[0] + crossed[1]] as const;
  if (s && (!c || totals[0] > totals[1])) return ["top", "bottom"];
  if (c && (!s || totals[1] > totals[0])) return ["bottom", "top"];
  return null;
}

/** One name's side, when it clearly fits one and not the other (soccer's per-team markets). */
export function sideOf(name: string, key: Pick<GameKey, "top" | "bottom">): "top" | "bottom" | null {
  const top = nameScore(name, key.top);
  const bottom = nameScore(name, key.bottom);
  return top === bottom ? null : top > bottom ? "top" : "bottom";
}

const SIX_HOURS = 6 * 3_600_000;

/**
 * The one main event that is this game: both teams, one to each side, the
 * start within 6 hours, and clearly the closest such event: an hour closer
 * than any other (a doubleheader). Null otherwise.
 */
export function matchEvent(events: readonly PMEvent[], key: GameKey): PMEvent | null {
  const fits = events
    .filter((e) => isMainEvent(e.slug) && e.teams.length === 2 && e.startTime != null && Math.abs(e.startTime - key.start) <= SIX_HOURS)
    .filter((e) => assignSides(e.teams[0]!.name, e.teams[1]!.name, key))
    .map((e) => ({ e, off: Math.abs(e.startTime! - key.start) }))
    .sort((x, y) => x.off - y.off);
  const [best, next] = fits;
  if (!best) return null;
  if (next && next.off - best.off < 3_600_000) return null;
  return best.e;
}

// MARK: - The market

export interface OutcomeToken {
  readonly outcome: Outcome;
  readonly token: string;
}

export interface Market {
  /** The event's slug: the link. */
  readonly slug: string;
  readonly kind: "two-way" | "three-way";
  /**
   * The tokens tracked: a two-way market tracks the top team's token alone
   * (the bottom is its complement); soccer tracks each outcome's Yes token,
   * top, draw, bottom.
   */
  readonly tokens: readonly OutcomeToken[];
  /** Dollars traded on the moneyline (soccer: its three markets together). */
  readonly volume: number | null;
  /** The listed event's start (OddsMarket.start), when known: where its history begins. */
  readonly start?: number | null;
}

export const isThreeWayMarket = (market: Pick<Market, "kind"> | null | undefined): boolean => market?.kind === "three-way";

const list = (v: JSONValue): string[] => {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  const s = str(v);
  if (!s) return [];
  try {
    const parsed: unknown = JSON.parse(s);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const isMoneyline = (m: JSONValue) => str(at(m, "sportsMarketType")) === "moneyline";
const amount = (v: JSONValue) => num(v) ?? (str(v) != null && str(v) !== "" ? Number(str(v)) : null);

/** A two-way moneyline (`outcomes` the two teams, `clobTokenIds` in the same order). */
export function twoWayMarket(json: JSONValue, slug: string, key: Pick<GameKey, "top" | "bottom">): Market | null {
  if (!isMoneyline(json)) return null;
  const outcomes = list(at(json, "outcomes"));
  const tokens = list(at(json, "clobTokenIds"));
  if (outcomes.length !== 2 || tokens.length !== 2) return null;
  const sides = assignSides(outcomes[0]!, outcomes[1]!, key);
  if (!sides) return null;
  const top = sides.indexOf("top");
  const volume = amount(at(json, "volume"));
  return { slug, kind: "two-way", tokens: [{ outcome: "top", token: tokens[top]! }], volume: volume != null && Number.isFinite(volume) ? volume : null };
}

/** The moneyline from a whole event: a two-way market among its markets, else soccer's three Yes/No markets. */
export function marketFromEvent(json: JSONValue, key: Pick<GameKey, "top" | "bottom">): Market | null {
  const slug = str(at(json, "slug"));
  if (!slug) return null;
  const markets = arr(at(json, "markets")).filter(isMoneyline);
  for (const m of markets) {
    const two = twoWayMarket(m, slug, key);
    if (two) return two;
  }
  const found: Partial<Record<Outcome, string>> = {};
  let volume = 0;
  for (const m of markets) {
    const outcomes = list(at(m, "outcomes"));
    const tokens = list(at(m, "clobTokenIds"));
    const yes = outcomes.findIndex((o) => o.toLowerCase() === "yes");
    if (yes < 0 || !tokens[yes]) continue;
    const title = str(at(m, "groupItemTitle")) ?? "";
    const outcome: Outcome | null = /^draw\b/i.test(title) || /end in a draw/i.test(str(at(m, "question")) ?? "") ? "draw" : sideOf(title, key);
    if (!outcome || found[outcome]) return null;
    found[outcome] = tokens[yes];
    volume += amount(at(m, "volume")) ?? 0;
  }
  if (!found.top || !found.draw || !found.bottom) return null;
  return {
    slug,
    kind: "three-way",
    tokens: (["top", "draw", "bottom"] as const).map((outcome) => ({ outcome, token: found[outcome]! })),
    volume: volume > 0 ? volume : null,
  };
}

/** The market's parent event's slug, as `/markets/slug/…` reports it (the market must belong to the matched event). */
export const marketEventSlug = (json: JSONValue): string | null => str(at(json, "events", 0, "slug")) ?? null;

// MARK: - Prices

/** A price at a moment: `t` in epoch ms, `p` the chance (0…1) (Odds.swift `OddsPoint`). */
export interface PricePoint {
  readonly t: number;
  readonly p: number;
}

/** `prices-history` → points in time order, one per moment. */
export function parseHistory(json: JSONValue): PricePoint[] {
  const out: PricePoint[] = [];
  for (const h of arr(at(json, "history"))) {
    const t = num(at(h, "t"));
    const p = num(at(h, "p"));
    if (t == null || p == null || p < 0 || p > 1) continue;
    out.push({ t: t * 1000, p });
  }
  out.sort((a, b) => a.t - b.t);
  return out.filter((x, i) => i === 0 || x.t !== out[i - 1]!.t);
}

/** `midpoint` → the mid (0…1), or null. */
export function parseMidpoint(json: JSONValue): number | null {
  const mid = d(at(json, "mid"));
  return mid != null && mid >= 0 && mid <= 1 ? mid : null;
}

// MARK: - The displayed price (Odds.swift `OddsQuote`)

/** One outcome's book as the market channel last told it. */
export interface Quote {
  readonly bid: number | null;
  readonly ask: number | null;
  readonly last: number | null;
  /** The last trade is news: none since the book was last tight enough to price itself. */
  readonly tradeIsNews: boolean;
}

export const EMPTY_QUOTE: Quote = { bid: null, ask: null, last: null, tradeIsNews: true };

/** A quote as the Mac's `OddsQuote(bid:ask:last:)` makes one: its last trade is news. */
export const quote = (bid: number | null = null, ask: number | null = null, last: number | null = null): Quote => ({ bid, ask, last, tradeIsNews: true });

/** An empty side is the contract boundary: no bid is 0, no ask is 1. Null when the spread is wider than 10¢ (in tenths of a cent) or crossed. */
function midpoint(q: Pick<Quote, "bid" | "ask">): number | null {
  const lower = q.bid ?? 0;
  const upper = q.ask ?? 1;
  if (!(upper >= lower) || Math.round((upper - lower) * 1000) > 100) return null;
  return (lower + upper) / 2;
}

/**
 * Polymarket's own rule: the midpoint of the best bid and ask, or the last
 * trade when the spread is wider than 10¢. Compared in tenths of a cent
 * (0.40 − 0.30 is 0.10000000000000003). (pure; tested)
 */
export function displayed(q: Quote): number | null {
  // An empty side is the contract boundary: no bid is 0, no ask is 1.
  // CLOB's price_change frames and /midpoint use these same bounds.
  // Thus a losing token with no bids and a 0.001 ask is 0.0005, not
  // whatever stale last trade happened to accompany a book snapshot.
  if (q.bid == null && q.ask == null) return q.last;
  const mid = midpoint(q);
  if (mid != null) return mid;
  // A book widening says nothing about the price. Only a trade since it
  // was tight does: an old one would draw a move that never happened,
  // and a book breathing around 10¢ would saw between the two. Until
  // one prints, the chart keeps the value it has.
  return q.tradeIsNews ? q.last : null;
}

// MARK: - The live book (Odds.swift `OddsFrame`)

/** What a market-channel frame says about one asset. */
export type FrameUpdate =
  /** A full book: its best bid and ask (max bid, min ask: the sides come in opposite orders). */
  | { readonly kind: "book"; readonly bid: number | null; readonly ask: number | null; readonly last: number | null }
  | { readonly kind: "best"; readonly bid: number | null; readonly ask: number | null }
  | { readonly kind: "trade"; readonly price: number };

export interface BookUpdate {
  readonly token: string;
  readonly update: FrameUpdate;
}

const extreme = (levels: readonly unknown[], pick: (a: number, b: number) => number): number | null => {
  let out: number | null = null;
  for (const level of levels) {
    const p = d(at(level, "price"));
    if (p != null) out = out == null ? p : pick(out, p);
  }
  return out;
};

/**
 * The CLOB market channel's frames (shapes verified 2026-10-28): the first
 * is an array of `book` snapshots (bids ascending, asks descending), then
 * `price_change` (each change carries the new best bid and ask, the
 * complementary token's too), `last_trade_price`, and a bare `PONG`. (pure; tested)
 */
export function parseSocketMessage(raw: string): BookUpdate[] {
  if (raw[0] !== "[" && raw[0] !== "{") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const out: BookUpdate[] = [];
  for (const f of Array.isArray(parsed) ? parsed : [parsed]) {
    switch (s(at(f, "event_type"))) {
      case "book": {
        const token = s(at(f, "asset_id"));
        if (!token) continue;
        out.push({ token, update: { kind: "book", bid: extreme(arr(at(f, "bids")), Math.max), ask: extreme(arr(at(f, "asks")), Math.min), last: d(at(f, "last_trade_price")) } });
        break;
      }
      case "price_change":
        for (const c of arr(at(f, "price_changes"))) {
          const token = s(at(c, "asset_id"));
          if (token) out.push({ token, update: { kind: "best", bid: d(at(c, "best_bid")), ask: d(at(c, "best_ask")) } });
        }
        break;
      case "last_trade_price": {
        const token = s(at(f, "asset_id"));
        const price = d(at(f, "price"));
        if (token && price != null) out.push({ token, update: { kind: "trade", price } });
        break;
      }
    }
  }
  return out;
}

/** After the book changed: a tight book prices itself, so the last trade is no longer news. */
function bookChanged(q: Quote): Quote {
  return (q.bid != null || q.ask != null) && midpoint(q) != null ? { ...q, tradeIsNews: false } : q;
}

/** A quote with a frame applied (OddsFrame.apply). (pure; tested) */
export function applyUpdate(q: Quote, update: FrameUpdate): Quote {
  switch (update.kind) {
    case "book":
      // The book's last_trade_price is not reliably asset-scoped:
      // captured BAL and BUF books both carried BUF's 0.999 trade.
      // Only last_trade_price events identify a trade by asset_id.
      // Preserve any such trusted trade when replacing the book.
      return bookChanged({ ...q, bid: update.bid, ask: update.ask });
    case "best":
      return bookChanged({ ...q, bid: update.bid ?? q.bid, ask: update.ask ?? q.ask });
    case "trade":
      return { ...q, last: update.price, tradeIsNews: true };
  }
}

// MARK: - Series (Odds.swift `OddsSeries`)

/** Points kept per series. */
export const CAP = 600;
/** The newest stretch kept tick by tick (ms; the 10 min window's span). */
export const RAW = 600_000;
/**
 * Samples further apart than this (ms) weren't observed in between: the
 * history's coarsest stride is 5 minutes, and a followed market says
 * something at least every minute. The line breaks here, rather than drawing
 * a price nobody saw.
 */
export const GAP = 360_000;

/** The value in effect at `t`: the last point at or before it. */
export function valueAt(points: readonly PricePoint[], t: number): number | null {
  return lastAtOrBefore(points, t, (p) => p.t)?.p ?? null;
}

/**
 * At most `cap` points, times strictly increasing: the last `RAW` as they
 * came, older ones one per minute (each minute's last value), then evenly
 * thinned if that's still too many. The newest point always survives. (pure; tested)
 */
export function compact(points: readonly PricePoint[], now: number, cap = CAP): PricePoint[] {
  const out: PricePoint[] = [];
  const cut = now - RAW;
  let bucket: { minute: number; point: PricePoint } | null = null;
  for (const point of points) {
    const last = out.at(-1);
    if (last && point.t <= last.t) continue;
    if (point.t < cut) {
      const minute = Math.trunc(point.t / 60_000);
      if (bucket && bucket.minute !== minute) out.push(bucket.point);
      bucket = { minute, point };
    } else {
      if (bucket) {
        out.push(bucket.point);
        bucket = null;
      }
      const latest = out.at(-1);
      if (latest && point.t <= latest.t) continue;
      out.push(point);
    }
  }
  if (bucket && (out.length === 0 || bucket.point.t > out.at(-1)!.t)) out.push(bucket.point);
  if (!(out.length > cap && cap > 1)) return out;
  // Still too many (a whole day of minutes): keep every k-th, and the newest.
  const stride = (out.length - 1) / (cap - 1);
  return Array.from({ length: cap }, (_, k) => out[Math.round(k * stride)]!);
}

/** Each outcome's chance at one moment: two-way (`draw` null) or soccer's three (Odds.swift `OddsSplit`). */
export interface OddsSplit {
  readonly top: number;
  readonly draw: number | null;
  readonly bottom: number;
}

export const share = (split: OddsSplit, outcome: Outcome): number => (outcome === "top" ? split.top : outcome === "draw" ? (split.draw ?? 0) : split.bottom);

/** The likeliest outcome. */
export function leader(split: OddsSplit): Outcome {
  if (split.draw != null && split.draw > split.top && split.draw > split.bottom) return "draw";
  return split.top >= split.bottom ? "top" : "bottom";
}

export const sameSplit = (a: OddsSplit | null, b: OddsSplit | null): boolean => a === b || (a != null && b != null && a.top === b.top && a.draw === b.draw && a.bottom === b.bottom);

/** Soccer's three prices scaled to sum to 1 (they list at 0.99–1.01). */
export function normalized(top: number, draw: number, bottom: number): OddsSplit {
  const sum = top + draw + bottom;
  if (!(sum > 0)) return { top: 1 / 3, draw: 1 / 3, bottom: 1 / 3 };
  return { top: top / sum, draw: draw / sum, bottom: bottom / sum };
}

/** Every outcome's chance at one moment (OddsChart.swift `OddsSplitPoint`). */
export interface OddsSplitPoint {
  readonly t: number;
  readonly split: OddsSplit;
  /** One of the outcomes hasn't been observed for a while: no reading, and the line breaks here. */
  readonly unobserved: boolean;
}

/**
 * Three series on one timeline: at each moment any of them moved, all three
 * as they stood, normalized. One walk over the three, as this runs with every
 * tick. A moment when one of them hasn't been observed for a `GAP` isn't a
 * reading of all three: it's marked, and the line breaks. (pure; tested)
 */
export function stacked(top: readonly PricePoint[], draw: readonly PricePoint[], bottom: readonly PricePoint[]): OddsSplitPoint[] {
  if (top.length === 0 || draw.length === 0 || bottom.length === 0) return [];
  const out: OddsSplitPoint[] = [];
  let a = 0;
  let dd = 0;
  let b = 0;
  while (a < top.length || dd < draw.length || b < bottom.length) {
    const t = Math.min(a < top.length ? top[a]!.t : Infinity, dd < draw.length ? draw[dd]!.t : Infinity, b < bottom.length ? bottom[b]!.t : Infinity);
    if (a < top.length && top[a]!.t === t) a++;
    if (dd < draw.length && draw[dd]!.t === t) dd++;
    if (b < bottom.length && bottom[b]!.t === t) b++;
    if (a === 0 || dd === 0 || b === 0) continue;
    const quiet = Math.max(t - top[a - 1]!.t, t - draw[dd - 1]!.t, t - bottom[b - 1]!.t);
    out.push({ t, split: normalized(top[a - 1]!.p, draw[dd - 1]!.p, bottom[b - 1]!.p), unobserved: quiet > GAP });
  }
  return out;
}

/** Whole points, never 0 or 100 while it's undecided: "100%" is for the final whistle (OddsSeries.percent). (pure; tested) */
export function percent(p: number, final = false): number {
  const whole = Math.round(p * 100);
  return final ? whole : Math.min(Math.max(whole, 1), 99);
}

/** "$4.1M", "$850K", "$12K", "$900" (OddsSeries.dollars). */
export function dollars(value: number): string {
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1e4) return `$${Math.round(value / 1e3)}K`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${Math.round(value)}`;
}

/** "$3.1M traded", or nothing when the volume isn't known. */
export function traded(volume: number | null | undefined): string | null {
  return volume == null || !Number.isFinite(volume) || volume <= 0 ? null : `${dollars(volume)} traded`;
}

// MARK: - History in the feed (OddsFeed.swift `holes`, `mergingHistory`)

/**
 * The stretches of `from…to` a series has nothing for: its opening, its tail,
 * and between samples a `GAP` apart. A hole the provider has already answered
 * for stays a hole; the tail is always worth asking. (pure; tested)
 */
export function holes(points: readonly PricePoint[], from: number, to: number, answered: ReadonlySet<number>): Domain[] {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return from < to ? [{ from, to }] : [];
  const out: Domain[] = [];
  if (first.t - from > GAP && !answered.has(from)) out.push({ from, to: first.t });
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k]!;
    const b = points[k + 1]!;
    if (b.t - a.t > GAP && !answered.has(a.t)) out.push({ from: a.t, to: b.t });
  }
  if (to > last.t + 1000) out.push({ from: last.t, to });
  return out;
}

/**
 * Fills a hole with history, keeping every observation already there:
 * history never overwrites a live quote at an overlapping time. (pure; tested)
 */
export function mergingHistory(history: readonly PricePoint[], current: readonly PricePoint[], hole: Domain, now: number): PricePoint[] {
  let split = current.findIndex((p) => p.t > hole.from);
  if (split < 0) split = current.length;
  const before = current.slice(0, split);
  const after = current.slice(split);
  const fill = history.filter((point) => (before.length === 0 || point.t > before.at(-1)!.t) && (after.length > 0 ? point.t < after[0]!.t : point.t <= hole.to));
  return compact([...before, ...fill, ...after], now);
}

/** A range of the wall clock (epoch ms), both ends included. */
interface Domain {
  readonly from: number;
  readonly to: number;
}

/** The last element at or before `t` (binary search; times ascending) (OddsSeries.last). */
export function lastAtOrBefore<T>(items: readonly T[], t: number, time: (item: T) => number): T | null {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (time(items[mid]!) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? items[lo - 1]! : null;
}
