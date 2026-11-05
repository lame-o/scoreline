/**
 * Recorded football plays as the broadcast's timeline hands them to a
 * theater (BroadcastLanes.swift `football`, `summaryPlays`), for the engine's
 * tests, its bench and the directed field's dev page: each play's wallclock
 * its event time, its game clock elapsed in the quarter, its kind as the lane
 * labels it ("snap", "kick", "penalty"; a stoppage dead, by its type), in
 * game order by the feed's sequence numbers (ESPN doesn't always list them in
 * play order). The broadcast's own lanes and timeline are the page's; this
 * stands in for them where there's no page, as replayTimeline.ts does for
 * basketball.
 */
import { seconds } from "../basketball";
import { at, type JSONValue } from "../json";
import { digest, type Arrival } from "./replayTimeline";
import type { PTime } from "./theaterEngine";
import type { PlayKind, RawPlay, TimelinePlay } from "./theaterSource";

/** A stop in play as ESPN names a play's type (BroadcastLanes.stoppage): the football rows and a review. */
function stoppageType(type: string): boolean {
  const t = type.toLowerCase();
  if (["official timeout", "timeout", "full timeout", "short timeout", "reset timeout", "two-minute warning"].includes(t)) return true;
  return t.startsWith("coach's challenge") || t.startsWith("ref-initiated review") || t === "challenge";
}

const KICKS = new Set(["52", "53", "59", "60", "18", "12", "17"]);

/**
 * How far the page's watermark runs ahead of p for football in steady state
 * (snapshotAt's `ahead`): the director must know a play by its binding
 * horizon (a snap's 6 s, GridSport.horizons) and the delay carries the
 * sport's margin on top (10 s, BroadcastLanes.policy). Football reads no
 * play past the watermark (`GridSport.scene`), so this is its lookahead.
 */
export const FOOTBALL_AHEAD = 16;

/** A football play's kind (BroadcastLanes.football): every snap (rush, pass, sack, kick, penalty) is live; stoppages and admin dead. */
export function footballKind(play: JSONValue): PlayKind {
  const typeText = String(at(play, "type", "text") ?? "");
  const typeID = String(at(play, "type", "id") ?? "");
  if (stoppageType(typeText) || typeText === "Coin Toss" || typeText.startsWith("End ")) {
    const ends = typeText.startsWith("End");
    const final = typeText === "End of Game";
    return { phase: "dead", label: ends ? (final ? "game end" : "period end") : typeText.toLowerCase(), stopsClock: true, announced: false };
  }
  // The clock stops after an incompletion, a score, a turnover, a kick, a penalty, a play out of bounds, a spike.
  const text = String(at(play, "text") ?? "").toLowerCase();
  const incomplete = typeID === "3";
  const kick = KICKS.has(typeID) || typeText.includes("Punt") || typeText.includes("Kickoff") || typeText.includes("Field Goal");
  const outOfBounds = text.includes(" ob ") || text.includes("out of bounds") || text.includes("pushed ob") || text.includes("ran ob");
  const penalty = at(play, "isPenalty") === true || typeID === "8";
  const stops = incomplete || kick || outOfBounds || at(play, "scoringPlay") === true || at(play, "isTurnover") === true || penalty || text.includes("spike");
  return { phase: "live", label: penalty ? "penalty" : kick ? "kick" : "snap", stopsClock: stops, announced: false };
}

/** A summary's plays in its drives' order (`BroadcastLanes.summaryPlays`): the previous drives', then the current one's not already listed. */
export function summaryPlays(summary: JSONValue): JSONValue[] {
  const plays: JSONValue[] = [];
  for (const drive of (at(summary, "drives", "previous") as JSONValue[] | undefined) ?? []) plays.push(...((at(drive, "plays") as JSONValue[] | undefined) ?? []));
  const current = (at(summary, "drives", "current", "plays") as JSONValue[] | undefined) ?? [];
  const known = new Set(plays.map((p) => at(p, "id")));
  for (const p of current) if (!known.has(at(p, "id"))) plays.push(p);
  return plays;
}

/**
 * ESPN football plays as the timeline's, in game order (the snapshot lists
 * what's arrived in this order), each arriving when `arrived` says (else
 * `lag` after its wallclock). `college`: no overtime clock (college's
 * overtime has none); the NFL's is 10 minutes.
 */
export function footballArrivals(items: readonly JSONValue[], lag: number, arrived: (id: string) => PTime | null = () => null, college = false): Arrival[] {
  const periodLength = (p: number) => (p <= 4 ? 900 : college ? 0 : 600);
  const parsed = items.flatMap((play, offset) => {
    const id = at(play, "id");
    const wall = at(play, "wallclock");
    if (typeof id !== "string") return [];
    const period = Number(at(play, "period", "number") ?? 0);
    const display = at(play, "clock", "displayValue");
    const value = at(play, "clock", "value");
    // College summaries give only "11:35" (no numeric value).
    const remaining = typeof value === "number" ? value : typeof display === "string" ? seconds(display) : null;
    const length = periodLength(period);
    const elapsed = remaining == null ? null : length > 0 ? Math.max(length - remaining, 0) : remaining;
    const s = at(play, "sequenceNumber");
    const sequence = typeof s === "string" && Number.isFinite(Number(s)) ? Number(s) : typeof s === "number" ? s : 0;
    return [{ play, id, offset, period, elapsed, display: typeof display === "string" ? display : null, eventTime: typeof wall === "string" ? Date.parse(wall) / 1000 : null, key: period * 1e7 + sequence }];
  });
  parsed.sort((a, b) => a.key - b.key || a.offset - b.offset);
  return parsed.map(({ play, id, period, elapsed, display, eventTime }, order): Arrival => {
    const came = arrived(id) ?? (eventTime ?? 0) + lag;
    const home = at(play, "homeScore");
    const away = at(play, "awayScore");
    const timeline: TimelinePlay<RawPlay> = {
      id,
      order,
      eventTime: eventTime != null && Number.isFinite(eventTime) ? eventTime : null,
      eventBounds: null,
      timeSource: "wallclock",
      presentAt: eventTime ?? came,
      period,
      clock: { elapsed, resolution: 1, display },
      kind: footballKind(play),
      score: typeof home === "number" && typeof away === "number" ? { home, away } : null,
      revision: 0,
      estimated: false,
      firstSeen: came,
      play: { json: play, digest: digest(JSON.stringify(play)) },
    };
    // Kept in game order: a play that arrived late still sits where it happened (the timeline's order, not the feed's).
    return { at: came, play: timeline };
  });
}
