/**
 * The upstream allowlist: every host the `/api/*` proxy will fetch, the path
 * prefixes it accepts on each, the headers each needs, and how long each kind
 * of response may be cached.
 *
 * Shared by the Worker (which enforces it) and the client (which maps an
 * upstream URL onto the proxy with `proxyPath`, and fails fast in development
 * when a URL isn't allowed). Pure TypeScript: no DOM, no Workers types.
 *
 * The scheme is transparent on purpose: an upstream URL becomes
 * `/api/<host><path>?<query>`, so a URL lifted from the Swift sources works
 * by prefixing it. `https://site.api.espn.com/apis/site/v2/sports/nfl/scoreboard`
 * is fetched as `/api/site.api.espn.com/apis/site/v2/sports/nfl/scoreboard`.
 *
 * Adding an upstream is a change here (and a line in ARCHITECTURE.md), never
 * in the Worker. Images are never proxied: `<img>` loads logos straight from
 * their CDNs.
 */

/** Seconds. `edge`: the Worker's shared cache. `browser`: the client's HTTP cache. */
export interface CachePolicy {
  readonly edge: number;
  readonly browser: number;
}

/** Live data (scoreboards, play-by-play, live rounds): the poll is 30s, so 15s at the edge halves upstream load at worst. */
export const LIVE: CachePolicy = { edge: 15, browser: 5 };
/** Lists that move a little (CS2 match lists, event pages): a minute. */
export const SHORT: CachePolicy = { edge: 60, browser: 15 };
/** Tables and polls change when games end (ScoreStore caches standings 10 minutes). */
export const TABLES: CachePolicy = { edge: 600, browser: 120 };
/** Schedules and calendars: half an hour. */
export const SCHEDULE: CachePolicy = { edge: 1800, browser: 300 };
/** Catalogs (team lists, seasons): six hours. */
export const CATALOG: CachePolicy = { edge: 21_600, browser: 3600 };

export interface Upstream {
  readonly host: string;
  /** Accepted path prefixes. A path must start with one of them. */
  readonly prefixes: readonly string[];
  /** Extra request headers the upstream needs. */
  readonly headers?: Readonly<Record<string, string>>;
  /** First match wins, tested against the path (no query). */
  readonly rules: readonly (readonly [RegExp, CachePolicy])[];
  readonly fallback: CachePolicy;
}

export const UPSTREAMS: readonly Upstream[] = [
  {
    // ESPN site API: scoreboards, summaries, teams, rankings, schedules.
    host: "site.api.espn.com",
    prefixes: ["/apis/site/v2/sports/", "/apis/v2/sports/"],
    rules: [
      [/\/scoreboard$/, LIVE],
      [/\/summary$/, LIVE],
      [/\/standings$/, TABLES],
      [/\/rankings$/, TABLES],
      [/\/teams\/[^/]+\/(schedule|roster)$/, SCHEDULE],
      [/\/teams(\/[^/]+)?$/, CATALOG],
    ],
    fallback: SHORT,
  },
  {
    // ESPN core API: play-by-play feeds, probabilities, seasons and brackets.
    host: "sports.core.api.espn.com",
    prefixes: ["/v2/"],
    rules: [
      [/\/(plays|probabilities|situation|status|drives)(\/.*)?$/, LIVE],
      [/\/seasons\/\d+(\/.*)?$/, SCHEDULE],
    ],
    fallback: SHORT,
  },
  {
    // ESPN common v3: athlete and team profile pages.
    host: "site.web.api.espn.com",
    prefixes: ["/apis/common/v3/"],
    rules: [],
    fallback: SCHEDULE,
  },
  {
    // bo3.gg: Counter-Strike 2 (S-tier only; see CounterStrike.TIER).
    host: "api.bo3.gg",
    prefixes: ["/api/v1/"],
    rules: [
      [/\/matches$/, { edge: 20, browser: 5 }],
      [/\/(live|games|rounds)(\/.*)?$/, LIVE],
      [/\/matches\/[^/]+$/, LIVE],
      [/\/teams(\/.*)?$/, CATALOG],
      [/\/tournaments(\/.*)?$/, SCHEDULE],
      // A stage's name and its rounds' names (SeasonResults.parseStage).
      [/\/stages\/\d+$/, SCHEDULE],
    ],
    fallback: SHORT,
  },
  {
    // IFSC results service (World Climbing). Answers only with its own Referer
    // (Providers.swift, `IFSC.headers`).
    host: "ifsc.results.info",
    prefixes: ["/api/v1/"],
    headers: { Referer: "https://ifsc.results.info/" },
    rules: [
      [/\/results$/, LIVE],
      [/^\/api\/v1\/?$/, SCHEDULE],
      [/\/(seasons|season_leagues)\/\d+$/, SCHEDULE],
      [/\/events\/\d+$/, SHORT],
      // Season pages: who's registered changes over days, not minutes.
      [/\/events\/\d+\/registrations$/, SCHEDULE],
    ],
    fallback: SHORT,
  },
  {
    // MLB Stats API: Statcast pitch and batted-ball data (Statcast.swift).
    host: "statsapi.mlb.com",
    prefixes: ["/api/"],
    rules: [
      [/\/feed\/live$/, LIVE],
      [/\/schedule$/, { edge: 300, browser: 60 }],
    ],
    fallback: SHORT,
  },
];

export interface ResolvedUpstream {
  readonly upstream: Upstream;
  /** The full upstream URL to fetch. */
  readonly url: URL;
  readonly policy: CachePolicy;
}

/** The proxy's mount point. */
export const API_PREFIX = "/api/";

/**
 * Resolves a proxy path (`/api/<host><path>?<query>`) to its upstream, or
 * null when it isn't allowed: an unknown host, a path outside the prefixes,
 * or anything that tries to climb out of them (`..`, encoded slashes).
 */
export function resolveProxyPath(pathname: string, search: string): ResolvedUpstream | null {
  if (!pathname.startsWith(API_PREFIX)) return null;
  const rest = pathname.slice(API_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const host = rest.slice(0, slash).toLowerCase();
  const path = rest.slice(slash);
  const upstream = UPSTREAMS.find((u) => u.host === host);
  if (!upstream) return null;
  // No traversal, no smuggled separators or schemes.
  if (/(^|\/)\.\.?(\/|$)/.test(path) || /%2f|%5c|%2e%2e|\\/i.test(path) || path.includes("//")) return null;
  if (!upstream.prefixes.some((p) => path.startsWith(p))) return null;
  const url = new URL(`https://${host}${path}${search}`);
  // `new URL` normalizes; it must still be the same host and path.
  if (url.host !== host || url.pathname !== path) return null;
  return { upstream, url, policy: policyFor(upstream, path) };
}

export function policyFor(upstream: Upstream, path: string): CachePolicy {
  return upstream.rules.find(([pattern]) => pattern.test(path))?.[1] ?? upstream.fallback;
}

/**
 * An upstream URL as the proxy path the client fetches. Throws for anything
 * not on the allowlist, so a new endpoint fails loudly in development instead
 * of at the Worker.
 */
export function proxyPath(upstreamURL: string | URL): string {
  const url = typeof upstreamURL === "string" ? new URL(upstreamURL) : upstreamURL;
  if (url.protocol !== "https:") throw new Error(`Not an https URL: ${url.href}`);
  const path = `${API_PREFIX}${url.host}${url.pathname}`;
  if (!resolveProxyPath(path, url.search)) throw new Error(`Not on the upstream allowlist: ${url.href}`);
  return path + url.search;
}
