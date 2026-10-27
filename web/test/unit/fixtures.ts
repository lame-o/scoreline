/**
 * Fixture helpers: read a recorded (or synthetic) response from
 * test/fixtures, and replay a set of them as a `Fetcher` keyed by URL
 * pattern, so providers run end to end with no network.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fetcher } from "../../src/data/http";

const DIR = join(import.meta.dirname, "..", "fixtures");

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(DIR, name), "utf8"));
}

/** The `events` of a scoreboard fixture, as an array for slicing. */
export function events(name: string): unknown[] {
  return (fixture(name) as { events: unknown[] }).events;
}

/** A fetcher that answers each URL with the first route whose pattern it matches, and records what it was asked. */
export function replay(routes: [RegExp, unknown][]): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new Error(`No fixture for ${url}`);
    return route[1];
  };
  return Object.assign(fetcher, { calls });
}
