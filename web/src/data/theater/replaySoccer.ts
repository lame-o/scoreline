/**
 * Soccer's recorded core plays as the broadcast's timeline hands them to a
 * theater, for the engine's tests, its bench and the directed theater's dev
 * page (replayTimeline.ts has the rest: the presentation clock a fixed delay
 * behind, the snapshot): each entry's wallclock its event time, its match
 * clock its elapsed time, its kind as the core lane labels it
 * (BroadcastLanes.swift `soccer`).
 */
import { at, type JSONValue } from "../json";
import { digest, type Arrival } from "./replayTimeline";
import type { PTime } from "./theaterEngine";
import type { PlayKind, RawPlay, TimelinePlay } from "./theaterSource";

/** Entries after which the ball is out of play until the restart (BroadcastLanes.soccerDeadBall: the bench's breakdowns only). */
export const SOCCER_DEAD_BALL: ReadonlySet<string> = new Set(["out", "foul", "offside", "hand-ball", "penalty---won", "penalty-won", "injury", "drop-of-ball"]);

/**
 * A shot or a goal by its core type (BroadcastLanes.soccerShot). ESPN posts a
 * shot first as a "temp-attempt" and revises it in place to on target, off
 * target or blocked a minute or more later: the temporary one is the shot.
 * "goal-kick" is a restart, not a goal.
 */
export function soccerShot(type: string): boolean {
  return (
    type.startsWith("shot") ||
    type === "temp-attempt" ||
    type === "goal" ||
    type.startsWith("goal---") ||
    type === "own-goal" ||
    type.startsWith("penalty---") ||
    type === "hit-woodwork" ||
    type === "attempt-saved"
  );
}

const kind = (phase: "live" | "dead", label: string, stopsClock = false, announced = false): PlayKind => ({ phase, label, stopsClock, announced });

const str = (v: JSONValue): string | null => (typeof v === "string" ? v : null);
const double = (v: JSONValue): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const int = (v: JSONValue): number | null => {
  const d = double(v);
  return d == null ? null : Math.trunc(d);
};

/**
 * A soccer entry's kind (BroadcastLanes.soccer). Located entries and every
 * shot, goal and save are live; cards, substitutions, VAR and the half's admin
 * are dead. The clock never stops but at the half.
 */
export function soccerKind(play: JSONValue): PlayKind {
  const type = str(at(play, "type", "type")) ?? "";
  const located = (double(at(play, "fieldPositionX")) ?? 0) !== 0 || (double(at(play, "fieldPositionY")) ?? 0) !== 0;
  switch (type) {
    case "halftime":
      return kind("dead", "period end", true);
    case "end-regular-time":
    case "end-extra-time":
    case "full-time":
    case "end-of-game":
      return kind("dead", "game end", true);
    case "substitution":
    case "yellow-card":
    case "red-card":
    case "yellow-red-card":
      return kind("dead", type.replaceAll("-", " "));
    case "start-2nd-half":
    case "kickoff":
    case "start-extra-time":
      return kind("dead", type.replaceAll("-", " "));
    case "start-delay":
    case "end-delay":
      return kind("dead", "delay");
  }
  // A VAR decision (a goal ruled out, a penalty given) and the goal it struck: told as events even when they come minutes late.
  if (type.startsWith("var") || type === "deleted-after-review") return kind("dead", "review", false, true);
  if (soccerShot(type) || at(play, "scoringPlay") === true) return kind("live", "shot");
  if (type === "save" || type === "temp-save") return kind("live", "save");
  if (type === "corner-awarded") return kind("live", "corner");
  if (type === "free-kick") return kind("live", "free kick");
  if (located) return kind("live", "entry");
  return kind("dead", "other");
}

/** ESPN's soccer core plays as the timeline's, each arriving when `arrived` says (else `lag` after its wallclock). */
export function soccerArrivals(items: readonly JSONValue[], lag: number, arrived: (id: string) => PTime | null = () => null): Arrival[] {
  return items
    .flatMap((play, order): Arrival[] => {
      const raw = at(play, "id");
      const id = typeof raw === "string" ? raw : typeof raw === "number" ? String(Math.trunc(raw)) : null;
      if (id == null) return [];
      const wall = Date.parse(str(at(play, "wallclock")) ?? "");
      const eventTime = Number.isFinite(wall) ? wall / 1000 : null;
      const came = arrived(id) ?? (eventTime != null ? eventTime + lag : null);
      if (came == null) return [];
      const home = int(at(play, "homeScore"));
      const away = int(at(play, "awayScore"));
      const timeline: TimelinePlay<RawPlay> = {
        id,
        order,
        eventTime,
        eventBounds: null,
        timeSource: "wallclock",
        presentAt: eventTime ?? came,
        period: int(at(play, "period", "number")) ?? 0,
        clock: { elapsed: double(at(play, "clock", "value")), resolution: 1, display: str(at(play, "clock", "displayValue")) },
        kind: soccerKind(play),
        score: home != null && away != null ? { home, away } : null,
        revision: 0,
        estimated: false,
        firstSeen: came,
        play: { json: play, digest: digest(JSON.stringify(play)) },
      };
      return [{ at: came, play: timeline }];
    })
    .sort((a, b) => a.at - b.at || a.play.order - b.play.order);
}
