/**
 * Recorded MLB plays as the broadcast's timeline hands them to the baseball
 * theater, for the engine's tests, its bench and the directed field's dev
 * page (BroadcastLanes.swift `baseball`): each entry's wallclock its event
 * time, its half-inning its period (Top 1 = 1, Bottom 1 = 2, …), no game
 * clock, and its kind as the lane labels it: pitches and results live, the
 * bookkeeping around a plate appearance dead. The clock and the snapshots
 * are replayTimeline.ts's (a fixed delay behind real time).
 */
import { at, type JSONValue } from "../json";
import { digest, type Arrival } from "../theater/replayTimeline";
import type { PTime } from "../theater/theaterEngine";
import type { PlayKind, RawPlay, TimelinePlay } from "../theater/theaterSource";

/** Entries that are bookkeeping around a plate appearance, not something on the field (BroadcastLanes.baseballAdmin). */
export const BASEBALL_ADMIN: ReadonlySet<string> = new Set([
  "start-inning",
  "start-batterpitcher",
  "end-batterpitcher",
  "end-inning",
  "pitching-change",
  "mound-visit",
  "defensive-substitution",
  "offensive-substitution",
  "pinch-hitter",
  "pinch-runner",
  "defensive-switch",
  "umpire-review",
  "manager-challenge",
]);

/** A half-inning as the timeline's period: Top 1 = 1, Bottom 1 = 2, … */
export function baseballPeriod(play: JSONValue): number {
  const number = Number(at(play, "period", "number") ?? 0);
  const half = String(at(play, "period", "type") ?? "").toLowerCase();
  return Math.max((Number.isFinite(number) ? Math.trunc(number) : 0) * 2 - (half === "top" ? 1 : 0), 0);
}

/** An MLB entry's kind (BroadcastLanes.baseball): pitches and results are live; admin is dead; a half's end and the game's stop the clock. */
export function baseballKind(play: JSONValue): PlayKind {
  const type = String(at(play, "type", "type") ?? "");
  const dead = (label: string, stopsClock = false): PlayKind => ({ phase: "dead", label, stopsClock, announced: false });
  if (type === "end-inning") return dead("half-inning end", true);
  if (type === "end-game" || type === "game-end") return dead("game end", true);
  if (BASEBALL_ADMIN.has(type) || type.includes("substitution") || type.includes("visit")) return dead(type.replaceAll("-", " "));
  // (ESPN logs a pitching change as a result too, "Rodriguez relieved Vásquez": its stoppage is the timeline's, not the theater's.)
  if (type === "play-result") return { phase: "live", label: "result", stopsClock: false, announced: false };
  const pitch = at(play, "pitchCoordinate") !== undefined || at(play, "summaryType") === "P";
  return { phase: "live", label: pitch ? "pitch" : "event", stopsClock: false, announced: false };
}

/** ESPN baseball entries (`items` in the game's order, as the summary lists them: each one's `order`) as the timeline's, each arriving when `arrived` says (else `lag` after its wallclock); sorted as they arrive. */
export function baseballArrivals(items: readonly JSONValue[], lag: number, arrived: (id: string) => PTime | null = () => null): Arrival[] {
  return items
    .flatMap((play, order): Arrival[] => {
      const raw = at(play, "id");
      const id = typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : null;
      if (id == null) return [];
      const wall = at(play, "wallclock");
      const eventTime = typeof wall === "string" && Number.isFinite(Date.parse(wall)) ? Date.parse(wall) / 1000 : null;
      const home = at(play, "homeScore");
      const away = at(play, "awayScore");
      const came = arrived(id) ?? (eventTime != null ? eventTime + lag : null);
      if (came == null) return [];
      const timeline: TimelinePlay<RawPlay> = {
        id,
        order,
        eventTime,
        eventBounds: null,
        timeSource: "wallclock",
        presentAt: eventTime ?? came,
        period: baseballPeriod(play),
        clock: { elapsed: null, resolution: 1, display: null },
        kind: baseballKind(play),
        score: typeof home === "number" && typeof away === "number" ? { home, away } : null,
        revision: 0,
        estimated: false,
        firstSeen: came,
        play: { json: play, digest: digest(JSON.stringify(play)) },
      };
      return [{ at: came, play: timeline }];
    })
    .sort((a, b) => a.at - b.at || a.play.order - b.play.order);
}
