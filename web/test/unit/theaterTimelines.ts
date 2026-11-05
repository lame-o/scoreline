/**
 * Recorded plays as the broadcast's timeline hands them to the theater
 * (BroadcastLanes.swift's kinds, GameTimeline's event times and clocks), for
 * the engine's tests: each play's wallclock its event time, its game clock
 * elapsed in the period, its kind as the lane labels it. The broadcast's own
 * lanes and timeline (bounds included) take this over once they're on the
 * web; until then this is what the director is tested against.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { isFreeThrow, periodEnd, seconds, TURNOVER_TYPES } from "../../src/data/basketball";
import { at, type JSONValue } from "../../src/data/json";
import type { PlayKind, RawPlay, TimelinePlay } from "../../src/data/theater/theaterSource";
import { digest, type Arrival } from "./theaterRun";

const dead = (label: string, stopsClock = true): PlayKind => ({ phase: "dead", label, stopsClock, announced: false });
const live = (label: string, stopsClock = false): PlayKind => ({ phase: "live", label, stopsClock, announced: false });

const typeID = (play: JSONValue): number | null => {
  const v = at(play, "type", "id");
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** An NBA play's kind (BroadcastLanes.basketball). */
export function basketballKind(play: JSONValue, period: number, remaining: number | null): PlayKind {
  const type = typeID(play);
  const people = (at(play, "participants") as unknown[] | undefined)?.length ?? 0;
  if (periodEnd(play)) return { ...dead(periodEnd(play)!.final ? "game end" : "period end") };
  if (isFreeThrow(play)) return dead("free throw");
  if (at(play, "shootingPlay") === true) {
    const late = period >= 4 && (remaining ?? Infinity) <= 120;
    return live("shot", at(play, "scoringPlay") === true && late);
  }
  if (type === 155 || type === 156) return people > 0 ? live("rebound") : dead("team rebound");
  if (type != null && TURNOVER_TYPES.has(type)) return live("turnover", people < 2 && [64, 65, 67, 68, 69, 70, 71, 72, 73, 78, 84, 86, 87, 90].includes(type));
  if (type === 615) return live("jump ball");
  if (type === 16 || type === 17) return dead("timeout");
  if (type === 584) return dead("substitution");
  if (type != null && type >= 213 && type <= 290) return dead("review");
  if (type != null && type >= 20 && type <= 60) return dead("foul");
  return dead("other");
}

/**
 * A recording of a game's summaries (Tests/Fixtures/theater/<sport>/<event>/<arrival ms>.json.gz, the
 * recorder's own files): each look in order, with when it arrived (seconds).
 */
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

/** ESPN basketball plays as the timeline's, each arriving `lag` seconds after its wallclock (or when the recording saw it). */
export function recordedBasketball(looks: readonly { at: number; json: JSONValue }[]): Arrival[] {
  const first = firstLooks(looks, (j) => (at(j, "plays") as JSONValue[] | undefined) ?? []);
  const arrivals = basketballArrivals(
    first.map((f) => f.play),
    0,
  );
  const when = new Map(first.map((f) => [at(f.play, "id") as string, f.at]));
  return arrivals.map((a) => ({ at: when.get(a.play.id) ?? a.at, play: { ...a.play, firstSeen: when.get(a.play.id) ?? a.at } })).sort((a, b) => a.at - b.at || a.play.order - b.play.order);
}

/** ESPN basketball plays as the timeline's, each arriving `lag` seconds after its wallclock. */
export function basketballArrivals(items: readonly JSONValue[], lag: number, periodLength = (p: number) => (p <= 4 ? 720 : 300)): Arrival[] {
  return items.flatMap((play, order): Arrival[] => {
    const id = at(play, "id");
    const wall = at(play, "wallclock");
    if (typeof id !== "string" || typeof wall !== "string") return [];
    const eventTime = Date.parse(wall) / 1000;
    const period = Number(at(play, "period", "number") ?? 0);
    const display = String(at(play, "clock", "displayValue") ?? "");
    const remaining = seconds(display) ?? (Number.isFinite(Number(display)) && display !== "" ? Number(display) : null);
    const elapsed = remaining == null ? null : Math.max(periodLength(period) - remaining, 0);
    const timeline: TimelinePlay<RawPlay> = {
      id,
      order,
      eventTime,
      eventBounds: null,
      timeSource: "wallclock",
      presentAt: eventTime,
      period,
      clock: { elapsed, resolution: display.includes(":") ? 1 : 0.1, display },
      kind: basketballKind(play, period, remaining),
      score: { home: Number(at(play, "homeScore") ?? 0), away: Number(at(play, "awayScore") ?? 0) },
      revision: 0,
      estimated: false,
      firstSeen: eventTime + lag,
      play: { json: play, digest: digest(JSON.stringify(play)) },
    };
    return [{ at: eventTime + lag, play: timeline }];
  });
}
