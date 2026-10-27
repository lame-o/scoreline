/**
 * Every network read goes through `getJSON`: it maps the upstream URL onto
 * the `/api/*` proxy (shared/upstreams.ts), checks the status, and parses.
 * Providers take a `Fetcher` so tests can replay fixtures without a network.
 *
 *     const board = await fetcher("https://site.api.espn.com/apis/site/v2/sports/nfl/scoreboard", { signal });
 */
import { proxyPath } from "../../shared/upstreams";

export type Fetcher = (upstreamURL: string, init?: { signal?: AbortSignal }) => Promise<unknown>;

/** A non-2xx answer from the proxy (an upstream error, or a path off the allowlist). */
export class HTTPError extends Error {
  readonly status: number;
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HTTPError";
    this.status = status;
  }
}

/** The app's fetcher: through the proxy, JSON, throws on failure. */
export const getJSON: Fetcher = async (upstreamURL, init) => {
  const path = proxyPath(upstreamURL);
  const response = await fetch(path, { signal: init?.signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new HTTPError(response.status, upstreamURL);
  return response.json() as Promise<unknown>;
};

/** Resolves a path that may be relative ("/api/v1/events/1") against a base. */
export function resolveURL(path: string, base: string): string {
  return new URL(path, base).href;
}
