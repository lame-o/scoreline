/**
 * The /api/* proxy, with the Cache API and upstream fetch stubbed: what it
 * lets through, the headers it sends upstream, what it caches and for how
 * long, and what it says on a hit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_STATUS, FETCHED_AT, proxy } from "../../worker/proxy";

const stored = new Map<string, Response>();
const fakeCache = {
  match: vi.fn(async (key: Request) => stored.get(key.url)?.clone()),
  put: vi.fn(async (key: Request, response: Response) => {
    stored.set(key.url, response);
  }),
};
const waits: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p), passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stored.clear();
  waits.length = 0;
  vi.stubGlobal("caches", { default: fakeCache });
  upstream = vi.fn(async () => Response.json({ events: [] }, { headers: { "Set-Cookie": "x=1", "Cache-Control": "max-age=999" } }));
  vi.stubGlobal("fetch", upstream);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function call(path: string, method = "GET") {
  const url = new URL(`https://scoreline.example${path}`);
  const response = await proxy(new Request(url, { method }), url, ctx);
  await Promise.all(waits);
  return response;
}

describe("the /api proxy", () => {
  it("fetches an allowlisted upstream, caches it, and serves the next request from the cache", async () => {
    const first = await call("/api/site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261027");
    expect(first.status).toBe(200);
    expect(first.headers.get(CACHE_STATUS)).toBe("MISS");
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=5");
    expect(first.headers.get("CDN-Cache-Control")).toBe("max-age=15");
    // Nothing of the upstream's own headers leaks through but the content type.
    expect(first.headers.get("Set-Cookie")).toBeNull();
    expect(await first.json()).toEqual({ events: [] });

    const [url, init] = upstream.mock.calls[0]!;
    expect(url).toBe("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261027");
    expect((init as RequestInit).headers).toMatchObject({ Accept: "application/json" });
    expect(stored.get(url as string)?.headers.get(FETCHED_AT)).toBeTruthy();

    const second = await call("/api/site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261027");
    expect(second.headers.get(CACHE_STATUS)).toBe("HIT");
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("sends IFSC the Referer it requires", async () => {
    await call("/api/ifsc.results.info/api/v1/");
    expect((upstream.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ Referer: "https://ifsc.results.info/" });
  });

  it("never caches a failure", async () => {
    upstream.mockResolvedValueOnce(new Response("busy", { status: 503 }));
    const response = await call("/api/api.bo3.gg/api/v1/matches");
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fakeCache.put).not.toHaveBeenCalled();
  });

  it("refuses other methods, other hosts and other paths", async () => {
    expect((await call("/api/site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard", "POST")).status).toBe(405);
    expect((await call("/api/example.com/anything")).status).toBe(404);
    expect((await call("/api/site.api.espn.com/not/allowed")).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("serves the upstream when the cache fails, and never fails a response over a cache write", async () => {
    fakeCache.match.mockRejectedValueOnce(new Error("cache unavailable"));
    fakeCache.put.mockRejectedValueOnce(new Error("quota"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await call("/api/site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events: [] });
    const events = log.mock.calls.map(([line]) => JSON.parse(String(line)).event);
    expect(events).toEqual(expect.arrayContaining(["cache_match_failed", "cache_put_failed", "miss"]));
    log.mockRestore();
  });

  it("says when an upstream took too long (504), apart from one that's down (502)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    upstream.mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"));
    const slow = await call("/api/site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard");
    expect(slow.status).toBe(504);
    expect(slow.headers.get("Cache-Control")).toBe("no-store");
    upstream.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await call("/api/site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard")).status).toBe(502);
    expect(log.mock.calls.map(([line]) => JSON.parse(String(line)).event)).toEqual(["upstream_timeout", "upstream_unreachable"]);
    log.mockRestore();
  });

  it("answers HEAD without a body", async () => {
    const response = await call("/api/statsapi.mlb.com/api/v1/schedule?sportId=1", "HEAD");
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
  });
});
