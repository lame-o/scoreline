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
   * (the bottom is its complement on a tug-of-war chart); soccer tracks each
   * outcome's Yes token, top, draw, bottom.
   */
  readonly tokens: readonly OutcomeToken[];
  /** Dollars traded on the moneyline (soccer: its three markets together). */
  readonly volume: number | null;
}

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

/** A price at a moment: `t` in epoch ms, `p` the chance (0…1). */
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
  const mid = num(at(json, "mid")) ?? (str(at(json, "mid")) != null ? Number(str(at(json, "mid"))) : null);
  return mid != null && Number.isFinite(mid) && mid >= 0 && mid <= 1 ? mid : null;
}

/**
 * The price Polymarket shows: the midpoint of the best bid and ask, or the
 * last trade when the spread is wider than 10¢ (a thin book's midpoint says
 * little). No book: the last trade.
 */
export function displayedPrice(bid: number | null, ask: number | null, last: number | null): number | null {
  if (bid != null && ask != null && ask >= bid) {
    const mid = (bid + ask) / 2;
    return ask - bid > 0.1 + 1e-9 ? (last ?? mid) : mid;
  }
  return last ?? null;
}

// MARK: - The live book

/** What one socket message says about a token's book. Absent fields didn't change. */
export interface BookUpdate {
  readonly token: string;
  readonly bid?: number | null;
  readonly ask?: number | null;
  readonly last?: number | null;
  /** The server's time for it (epoch ms). */
  readonly t: number;
}

const price = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
};

/**
 * The CLOB market channel's messages (shapes verified 2026-10-28): the first
 * is an array of `book` snapshots (bids ascending, asks descending), then
 * `price_change` (each change carries the new best bid and ask, the
 * complementary token's too), `last_trade_price`, and a bare `PONG`.
 */
export function parseSocketMessage(raw: string, now = Date.now()): BookUpdate[] {
  if (raw === "PONG" || raw === "" || (raw[0] !== "{" && raw[0] !== "[")) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const out: BookUpdate[] = [];
  for (const m of Array.isArray(parsed) ? parsed : [parsed]) {
    const type = str(at(m, "event_type"));
    const t = Number(str(at(m, "timestamp")) ?? num(at(m, "timestamp")) ?? now) || now;
    if (type === "book") {
      const token = str(at(m, "asset_id"));
      if (!token) continue;
      const bids = arr(at(m, "bids")).map((l) => price(at(l, "price"))).filter((p): p is number => p != null);
      const asks = arr(at(m, "asks")).map((l) => price(at(l, "price"))).filter((p): p is number => p != null);
      out.push({ token, bid: bids.length ? Math.max(...bids) : null, ask: asks.length ? Math.min(...asks) : null, last: price(at(m, "last_trade_price")), t });
    } else if (type === "price_change") {
      for (const c of arr(at(m, "price_changes"))) {
        const token = str(at(c, "asset_id"));
        if (token) out.push({ token, bid: price(at(c, "best_bid")), ask: price(at(c, "best_ask")), t });
      }
    } else if (type === "last_trade_price") {
      const token = str(at(m, "asset_id"));
      const last = price(at(m, "price"));
      if (token && last != null) out.push({ token, last, t });
    }
  }
  return out;
}

export interface Quote {
  readonly bid: number | null;
  readonly ask: number | null;
  readonly last: number | null;
}

export const EMPTY_QUOTE: Quote = { bid: null, ask: null, last: null };

/** A quote with an update applied (fields it doesn't mention stay). */
export function applyUpdate(q: Quote, u: BookUpdate): Quote {
  return {
    bid: u.bid !== undefined ? u.bid : q.bid,
    ask: u.ask !== undefined ? u.ask : q.ask,
    last: u.last !== undefined ? u.last : q.last,
  };
}

// MARK: - Keeping series small

const MINUTE = 60_000;

/**
 * At most `max` points: the last 10 minutes as they came (one per second,
 * the newest of each), anything older one per minute (the minute's last
 * price). Never drops the first or the newest point.
 */
export function compact(points: readonly PricePoint[], now: number, max = 600, fine = 10 * MINUTE): PricePoint[] {
  if (points.length <= 2) return points.slice();
  const cutoff = now - fine;
  const out: PricePoint[] = [];
  let bucket = Number.NaN;
  for (const p of points) {
    // Old: a bucket a minute (even keys); recent: a bucket a second (odd keys). A bucket keeps its newest.
    const key = p.t < cutoff ? Math.floor(p.t / MINUTE) * 2 : Math.floor(p.t / 1000) * 2 + 1;
    if (key === bucket) out[out.length - 1] = p;
    else out.push(p);
    bucket = key;
  }
  if (out[0] !== points[0]) out.unshift(points[0]!);
  if (out.length <= max) return out;
  // Still too many: everything a minute apart, then (a day of history) thinned evenly.
  if (fine > 0) return compact(out, now, max, 0);
  const step = Math.ceil(out.length / max);
  const thinned = out.filter((_, i) => i % step === 0);
  if (thinned.at(-1) !== out.at(-1)) thinned.push(out.at(-1)!);
  return thinned;
}
