/**
 * The recorder's looks at a game (Tests/Fixtures/theater/<sport>/<event>/<arrival
 * ms>.json.gz) as the timeline's arrivals, for the engine's tests and bench
 * (src/data/theater/replayTimeline.ts has the plays' kinds and clocks).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { at, type JSONValue } from "../../src/data/json";
import { basketballArrivals, type Arrival } from "../../src/data/theater/replayTimeline";

export { basketballArrivals };

/** A recording's looks in order, with when each arrived (seconds). */
export function recording(dir: string, event: string): { at: number; json: JSONValue }[] {
  const root = join(import.meta.dirname, "..", "..", "..", "Tests", "Fixtures", "theater", dir, event);
  return readdirSync(root)
    .filter((f) => f.endsWith(".json.gz"))
    .map((f) => ({ at: Number(f.split(".")[0]) / 1000, json: JSON.parse(gunzipSync(readFileSync(join(root, f))).toString("utf8")) as JSONValue }))
    .sort((a, b) => a.at - b.at);
}

/** Each play of a recording as it first arrived (a revision keeps its first look). */
export function firstLooks(looks: readonly { at: number; json: JSONValue }[], plays: (look: JSONValue) => readonly JSONValue[]): { at: number; play: JSONValue }[] {
  const seen = new Set<string>();
  const out: { at: number; play: JSONValue }[] = [];
  for (const look of looks) {
    for (const play of plays(look.json)) {
      const id = at(play, "id");
      if (typeof id !== "string" || seen.has(id)) continue;
      seen.add(id);
      out.push({ at: look.at, play });
    }
  }
  return out;
}

/** A basketball recording's plays as they arrived. */
export function recordedBasketball(looks: readonly { at: number; json: JSONValue }[]): Arrival[] {
  const first = firstLooks(looks, (j) => (at(j, "plays") as JSONValue[] | undefined) ?? []);
  const when = new Map(first.map((f) => [at(f.play, "id") as string, f.at]));
  return basketballArrivals(
    first.map((f) => f.play),
    0,
    (id) => when.get(id) ?? null,
  );
}
