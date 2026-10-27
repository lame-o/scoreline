/**
 * The `/api/*` proxy: fetches allowlisted upstreams (shared/upstreams.ts) on
 * the browser's behalf, so the client never fights CORS, and caches each
 * response at the edge for as long as its kind of data stays true, so
 * upstreams see one request per URL per cache lifetime rather than one per
 * viewer.
 *
 * - GET and HEAD only. Nothing else is proxied: unknown hosts, paths outside
 *   the allowed prefixes and traversal attempts get a 404.
 * - The Cache API holds successful responses under the upstream URL, stamped
 *   with when they were fetched, so a hit can say how long it has left
 *   (`Age`, and a browser `max-age` that never outlives the edge copy).
 * - Upstream failures are never cached; the client's poll retries them.
 * - Bodies stream through (no buffering), and only `Content-Type` is copied
 *   from upstream: no cookies, no upstream caching headers.
 */
import { resolveProxyPath, type CachePolicy } from "../shared/upstreams";

const USER_AGENT = "Scoreline/1.0 (web; +https://github.com/lame-o/scoreline)";
/** Milliseconds since the epoch at which the edge copy was fetched. Exposed: the client reads it as "updated at". */
export const FETCHED_AT = "x-scoreline-fetched-at";
/** HIT or MISS. */
export const CACHE_STATUS = "x-scoreline-cache";
const UPSTREAM_TIMEOUT_MS = 15_000;

export async function proxy(request: Request, url: URL, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return problem(405, "Only GET and HEAD are proxied.", { Allow: "GET, HEAD" });
  }
  const resolved = resolveProxyPath(url.pathname, url.search);
  if (!resolved) return problem(404, "Not an allowed upstream.");
  const { upstream, url: target, policy } = resolved;

  const cache = caches.default;
  const key = new Request(target.href, { method: "GET" });
  const cached = await cache.match(key);
  if (cached) return respond(cached, policy, "HIT", request.method);

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(target.href, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...upstream.headers },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    log("upstream_unreachable", { host: target.host, path: target.pathname, ms: Date.now() - started, error: String(error) });
    return problem(502, "The upstream didn't answer.");
  }
  if (!response.ok) {
    log("upstream_status", { host: target.host, path: target.pathname, status: response.status, ms: Date.now() - started });
    // Discard the body unread.
    await response.body?.cancel();
    return problem(response.status >= 500 ? 502 : response.status, `The upstream answered ${response.status}.`);
  }

  const headers = new Headers({
    "Content-Type": response.headers.get("Content-Type") ?? "application/json; charset=utf-8",
    [FETCHED_AT]: String(Date.now()),
    // For the Cache API: how long the edge copy lives.
    "Cache-Control": `public, max-age=${policy.edge}`,
  });
  const fresh = new Response(response.body, { status: 200, headers });
  ctx.waitUntil(cache.put(key, fresh.clone()));
  log("miss", { host: target.host, path: target.pathname, ms: Date.now() - started });
  return respond(fresh, policy, "MISS", request.method);
}

/** The client's copy: browser and CDN lifetimes cut to what the edge copy has left. */
function respond(source: Response, policy: CachePolicy, status: "HIT" | "MISS", method: string): Response {
  const fetchedAt = Number(source.headers.get(FETCHED_AT)) || Date.now();
  const age = Math.max(0, Math.floor((Date.now() - fetchedAt) / 1000));
  const remaining = Math.max(0, policy.edge - age);
  const headers = new Headers({
    "Content-Type": source.headers.get("Content-Type") ?? "application/json; charset=utf-8",
    "Cache-Control": `public, max-age=${Math.min(policy.browser, remaining)}`,
    // Workers Caching (and any CDN in front) keeps it only as long as the edge copy has left.
    "CDN-Cache-Control": `max-age=${remaining}`,
    Age: String(age),
    [FETCHED_AT]: String(fetchedAt),
    [CACHE_STATUS]: status,
    "X-Content-Type-Options": "nosniff",
  });
  return new Response(method === "HEAD" ? null : source.body, { status: 200, headers });
}

function problem(status: number, message: string, extra: Record<string, string> = {}): Response {
  return Response.json(
    { error: { status, message } },
    { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra } },
  );
}

/** One structured line per event (Workers Logs indexes the JSON fields). */
function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}
