/**
 * Recorded plays as the broadcast's timeline hands them to a theater, for the
 * engine's tests, its bench and the directed theater's dev page: each play's
 * wallclock its event time, its game clock elapsed in the period, its kind as
 * the lane labels it (BroadcastLanes.swift), and a presentation clock that
 * runs at real time a fixed delay behind (`p = now − D`). The broadcast's own
 * lanes, timeline (with its event bounds and watermark) and clock are the
 * page's; this is what stands in for them where there's no page.
 */
import { isFreeThrow, periodEnd, seconds, TURNOVER_TYPES } from "../basketball";
import { at, type JSONValue } from "../json";
import type { PTime } from "./theaterEngine";
import type { ClockEvent, ClockPiece, PlayKind, RawPlay, TheaterClock, TimelinePlay, TimelineSnapshot } from "./theaterSource";

/** A play of a recording and when it arrived (seconds since 1970). */
export interface Arrival {
  readonly at: PTime;
  readonly play: TimelinePlay<RawPlay>;
}

/** A presentation clock running at real time a fixed delay behind the wall (`p = now − D`). */
export class DelayClock implements TheaterClock {
  readonly pieces: readonly ClockPiece[];
  readonly regime = "tracking" as const;
  readonly events: readonly ClockEvent[];

  constructor(
    readonly delay: number,
    start: PTime,
  ) {
    const p0 = start - delay;
    this.pieces = [{ t0: start, p0, v0: 1, a: 0, t1: Infinity, p: (t: number) => p0 + (t - start) }];
    this.events = [{ kind: "start", at: start, p: p0 }];
  }

  get started(): boolean {
    return true;
  }

  p(t: PTime): PTime {
    return t - this.delay;
  }
}

/**
 * The timeline as it stands at `now`: what's arrived, up to the watermark and
 * past it. The watermark runs `ahead` of p as the page's does in steady state
 * (the binding horizon and the margin: basketball's about 4 s, football's
 * snap horizon 6 s and its margin 10 s).
 */
export function snapshotAt(arrivals: readonly Arrival[], clock: TheaterClock, now: PTime, ahead = 4): TimelineSnapshot<RawPlay> {
  const known = arrivals.filter((a) => a.at <= now).map((a) => a.play);
  const watermark = clock.p(now) + ahead;
  return {
    plays: known.filter((p) => (p.eventTime ?? -Infinity) <= watermark),
    pending: known.filter((p) => (p.eventTime ?? -Infinity) > watermark),
    watermark,
    revision: known.length,
    told: new Set(),
  };
}

/** FNV-1a 32 of a string (a RawPlay's digest, as the timeline's is a hash of its fields). */
export function digest(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const dead = (label: string, stopsClock = true): PlayKind => ({ phase: "dead", label, stopsClock, announced: false });
const live = (label: string, stopsClock = false): PlayKind => ({ phase: "live", label, stopsClock, announced: false });

const typeID = (play: JSONValue): number | null => {
  const v = at(play, "type", "id");
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** Clock-stopping turnovers: violations and dead balls (BroadcastLanes.stoppingTurnovers). */
const STOPPING_TURNOVERS = new Set([64, 65, 67, 68, 69, 70, 71, 72, 73, 78, 84, 86, 87, 90]);

/** An NBA play's kind (BroadcastLanes.basketball). */
export function basketballKind(play: JSONValue, period: number, remaining: number | null): PlayKind {
  const type = typeID(play);
  const people = (at(play, "participants") as unknown[] | undefined)?.length ?? 0;
  const end = periodEnd(play);
  if (end) return dead(end.final ? "game end" : "period end");
  if (isFreeThrow(play)) return dead("free throw");
  if (at(play, "shootingPlay") === true) {
    const late = period >= 4 && (remaining ?? Infinity) <= 120;
    return live("shot", at(play, "scoringPlay") === true && late);
  }
  if (type === 155 || type === 156) return people > 0 ? live("rebound") : dead("team rebound");
  if (type != null && TURNOVER_TYPES.has(type)) return live("turnover", people < 2 && STOPPING_TURNOVERS.has(type));
  if (type === 615) return live("jump ball");
  if (type === 16 || type === 17) return dead("timeout");
  if (type === 584) return dead("substitution");
  if (type != null && type >= 213 && type <= 290) return dead("review");
  if (type != null && type >= 20 && type <= 60) return dead("foul");
  return dead("other");
}

/** ESPN basketball plays as the timeline's, each arriving when `arrived` says (else `lag` after its wallclock). */
export function basketballArrivals(items: readonly JSONValue[], lag: number, arrived: (id: string) => PTime | null = () => null, periodLength = (p: number) => (p <= 4 ? 720 : 300)): Arrival[] {
  return items
    .flatMap((play, order): Arrival[] => {
      const id = at(play, "id");
      const wall = at(play, "wallclock");
      if (typeof id !== "string" || typeof wall !== "string") return [];
      const eventTime = Date.parse(wall) / 1000;
      const period = Number(at(play, "period", "number") ?? 0);
      const display = String(at(play, "clock", "displayValue") ?? "");
      const remaining = seconds(display) ?? (Number.isFinite(Number(display)) && display !== "" ? Number(display) : null);
      const elapsed = remaining == null ? null : Math.max(periodLength(period) - remaining, 0);
      const came = arrived(id) ?? eventTime + lag;
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
        firstSeen: came,
        play: { json: play, digest: digest(JSON.stringify(play)) },
      };
      return [{ at: came, play: timeline }];
    })
    .sort((a, b) => a.at - b.at || a.play.order - b.play.order);
}
