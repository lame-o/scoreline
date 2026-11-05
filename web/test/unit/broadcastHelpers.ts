/**
 * The broadcast tests' helpers (BroadcastTests.swift's `testPolicy`, `play`,
 * `look`, `nbaPlay`): synthetic plays and looks, as the Swift builds them.
 */
import { digestOf } from "../../src/data/broadcast/lanes";
import { defaultPolicy, playKind, type BroadcastPolicy, type LaneID, type LaneSnapshot, type PTime, type RawPlay, type ScoreLine, type TimelineEntry } from "../../src/data/broadcast/timeline";
import type { JSONValue } from "../../src/data/json";

export function testPolicy(): BroadcastPolicy {
  const p = defaultPolicy();
  p.priorLag = 30;
  p.horizons = { live: 2, byKind: {} };
  p.margin = 1;
  p.slowPoll = 5;
  p.quietRunning = 60;
  p.insertionAllowance = 4;
  p.safetyGrace = 20;
  p.lagTrust = 1;
  p.periodLength = 720;
  return p;
}

export interface PlayOptions {
  elapsed?: number | null;
  period?: number;
  live?: boolean;
  stops?: boolean;
  score?: ScoreLine | null;
  text?: string;
  version?: number;
  label?: string | null;
  endsPeriod?: number | null;
}

export function play(id: string, w: PTime | null, o: PlayOptions = {}): TimelineEntry<RawPlay> {
  const text = o.text ?? "";
  const digest = digestOf([id, text, o.version ?? 0]);
  const live = o.live ?? true;
  const kind = playKind(live ? "live" : "dead", o.label ?? (live ? "shot" : "foul"), { stopsClock: o.stops ?? false, endsPeriod: o.endsPeriod ?? null });
  return {
    id,
    wallclock: w,
    period: o.period ?? 1,
    progress: o.elapsed ?? 0,
    clock: { elapsed: o.elapsed ?? null, resolution: 1, display: null },
    kind,
    score: o.score ?? null,
    text,
    reportedSource: "wallclock",
    digest,
    payload: { json: null, digest },
  };
}

export function look(list: readonly TimelineEntry<RawPlay>[], lane: LaneID = "summary", t: PTime, coverage: "full" | "tail" = "full"): LaneSnapshot<RawPlay> {
  return { lane, entries: list, coverage, arrived: t };
}

/** An ISO wallclock for seconds since 1970. */
export const iso = (seconds: number): string => new Date(seconds * 1000).toISOString().replace(".000Z", "Z");

/** An NBA play as ESPN's summary has it. */
export function nbaPlay(
  id: string,
  wall: PTime,
  clock: string,
  type: number,
  text: string,
  home: number,
  away: number,
  o: { shooting?: boolean; scoring?: boolean; team?: string; people?: string[] } = {},
): JSONValue {
  const scoring = o.scoring ?? false;
  return {
    id,
    period: { number: 1 },
    clock: { displayValue: clock },
    type: { id: String(type), text },
    text,
    homeScore: home,
    awayScore: away,
    shootingPlay: o.shooting ?? false,
    scoringPlay: scoring,
    scoreValue: scoring ? 3 : 0,
    wallclock: iso(wall),
    team: { id: o.team ?? "1" },
    participants: (o.people ?? ["9"]).map((p) => ({ athlete: { id: p } })),
  };
}

export const S = (home: number, away: number): ScoreLine => ({ home, away });
