/**
 * Who's on the wall, read from an IFSC round's results (LiveSnapshot.swift
 * `WallState.from`, and the parts of GameDetail.swift `ClimbingDetail` it
 * leans on: lead routes with each climber's high point, boulder cards, who
 * climbs next). The scores list reads it for its tiles; the round's page
 * (data/climbing.ts) builds on it. Light on purpose: it's on the first paint.
 *
 *     const wall = wallStateFrom(results); // { phase: { kind: "lead", climber, leader, route } }
 */
import { arr, at, bool, int, str, type JSONValue } from "./json";
import type { WallAscent, WallAthlete, WallReach, WallState } from "./models";
import { flagFromIOC } from "./teams";

/** Swift's `String.capitalized`: each word's first letter up, the rest down ("LEAD Women" → "Lead Women"). */
export function capitalized(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-&/])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

// MARK: - Model

/** A climber on a lead route: their high point (GameDetail.WallRoute.Climber). */
export interface Climber {
  readonly id: number;
  /** "J. Garnbret". */
  readonly name: string;
  /** IOC code ("SLO"). */
  readonly country: string | null;
  readonly flag: string | null;
  /** Hold number, +0.5 when moving to the next ("47+"). */
  readonly height: number;
  readonly top: boolean;
  /** "47+", "Top". */
  readonly label: string;
  readonly rank: number | null;
  /** Climbing right now. */
  readonly onWall: boolean;
}

export const holds = (c: Pick<Climber, "height">) => Math.floor(c.height);
export const moving = (c: Pick<Climber, "height">) => c.height > Math.floor(c.height);

/** A lead route: each climber's high point, highest first; topped climbers above everyone (GameDetail.WallRoute). */
export interface WallRoute {
  readonly name: string;
  readonly climbers: readonly Climber[];
  /** Everyone on this route's startlist, climbed or not. */
  readonly total: number;
}

/** Lead, live: who climbs next, from the starting order (GameDetail.UpNext). */
export interface UpNext {
  readonly name: string;
  readonly flag: string | null;
  /** Starting position, of `total`. */
  readonly position: number;
  readonly total: number;
}

export type Reach = WallReach;

export interface Problem {
  readonly reach: Reach;
  /** Attempts so far (IFSC counts them with or without a top). */
  readonly tries: number | null;
  /** Being climbed right now. */
  readonly active: boolean;
}

/** A boulder scorecard row: how far the athlete got on each problem (GameDetail.BoulderCard). */
export interface BoulderCard {
  readonly id: number;
  readonly rank: number | null;
  readonly name: string;
  readonly country: string | null;
  readonly flag: string | null;
  readonly problems: readonly Problem[];
  readonly score: string | null;
  /** On a boulder right now. */
  readonly onWall: boolean;
}

const present = (v: JSONValue, key: string) => at(v, key) != null;

/** "J. Garnbret" (ClimbingDetail.shortName). */
export function shortName(a: JSONValue): string {
  const first = str(at(a, "firstname"));
  const initial = first ? `${[...first][0]}. ` : "";
  return initial + capitalized(str(at(a, "lastname")) ?? "");
}

/** Lead: "47+" means the climber held hold 47 and was moving to 48 (ClimbingDetail.wallRoute). */
export function wallRoute(name: string, athletes: readonly JSONValue[]): WallRoute {
  const climbers = athletes.flatMap((a): Climber[] => {
    const id = int(at(a, "athlete_id"));
    const ascent = arr(at(a, "ascents")).find((s) => str(at(s, "route_name")) === name);
    if (id == null || ascent == null) return [];
    const score = str(at(ascent, "score")) ?? "";
    // On the wall: IFSC flags the climber (and their ascent) as active.
    const onWall = bool(at(a, "active")) === true || str(at(ascent, "status")) === "active";
    if (!score && !onWall) return [];
    const top = bool(at(ascent, "top")) === true || score.toUpperCase().includes("TOP");
    const number = Number(/^[\d.]*/.exec(score)?.[0] || "0");
    const height = (Number.isFinite(number) ? number : 0) + (bool(at(ascent, "plus")) === true || score.endsWith("+") ? 0.5 : 0);
    return [
      {
        id,
        name: shortName(a),
        country: str(at(a, "country")) ?? null,
        flag: flagFromIOC(str(at(a, "country"))),
        height,
        top,
        label: top ? "Top" : score || "0",
        rank: int(at(ascent, "rank")) ?? int(at(a, "rank")) ?? null,
        onWall: onWall && !top,
      },
    ];
  });
  // IFSC scores a top as "TOP", with no hold number: place it one hold above
  // the best non-topped height, so heights stay ordered and nothing reads as zero.
  const best = Math.max(0, ...climbers.filter((c) => !c.top).map((c) => c.height));
  const topHeight = Math.max(Math.floor(best) + 1, ...climbers.filter((c) => c.top).map((c) => c.height));
  const normalized = climbers.map((c) => (c.top ? { ...c, height: Math.floor(Math.max(c.height, topHeight)), onWall: false } : c));
  // Highest first; topped climbers above everyone; ties by route rank.
  const ordered = normalized
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      if (a.c.top !== b.c.top) return a.c.top ? -1 : 1;
      if (a.c.height !== b.c.height) return b.c.height - a.c.height;
      return (a.c.rank ?? Infinity) - (b.c.rank ?? Infinity) || a.i - b.i;
    })
    .map((x) => x.c);
  return { name, climbers: ordered, total: athletes.length };
}

/** A boulder scorecard row (ClimbingDetail.boulderCard). */
export function boulderCard(a: JSONValue, routes: readonly string[]): BoulderCard | null {
  const id = int(at(a, "athlete_id"));
  if (id == null) return null;
  const ascents = arr(at(a, "ascents"));
  const problems = routes.map((route): Problem => {
    const s = ascents.find((x) => str(at(x, "route_name")) === route);
    if (s == null) return { reach: "none", tries: null, active: false };
    const active = str(at(s, "status")) === "active";
    // Attempts: IFSC counts them in top_tries whether or not there's a top.
    const attempts = int(at(s, "top_tries")) ?? int(at(s, "zone_tries")) ?? null;
    if (bool(at(s, "top")) === true) return { reach: "top", tries: int(at(s, "top_tries")) ?? null, active };
    if (bool(at(s, "zone")) === true) return { reach: "zone", tries: attempts, active };
    if (bool(at(s, "low_zone")) === true) return { reach: "lowZone", tries: attempts ?? int(at(s, "low_zone_tries")) ?? null, active };
    return { reach: "none", tries: attempts != null && attempts > 0 ? attempts : null, active };
  });
  const score = str(at(a, "score"));
  return {
    id,
    rank: int(at(a, "rank")) ?? null,
    name: shortName(a),
    country: str(at(a, "country")) ?? null,
    flag: flagFromIOC(str(at(a, "country"))),
    problems,
    score: score ? score : null,
    onWall: bool(at(a, "active")) === true || problems.some((p) => p.active),
  };
}

/** The first climber in the starting order who hasn't climbed yet and isn't on the wall now (ClimbingDetail.upNext). */
export function upNext(results: JSONValue, route: string | null): UpNext | null {
  if (route == null) return null;
  const athletes = arr(at(results, "ranking"));
  const ascent = (a: JSONValue) => arr(at(a, "ascents")).find((s) => str(at(s, "route_name")) === route);
  const waiting = new Set(
    athletes.filter((a) => bool(at(a, "active")) !== true && str(at(ascent(a), "status")) === "pending").flatMap((a) => int(at(a, "athlete_id")) ?? []),
  );
  const order = arr(at(results, "startlist"))
    .flatMap((s) => {
      const id = int(at(s, "athlete_id"));
      const position = int(at(arr(at(s, "route_start_positions")).find((p) => str(at(p, "route_name")) === route), "position"));
      return id != null && position != null ? [{ id, position, entry: s }] : [];
    })
    .sort((a, b) => a.position - b.position);
  const next = order.find((o) => waiting.has(o.id));
  if (!next) return null;
  return { name: shortName(next.entry), flag: flagFromIOC(str(at(next.entry, "country"))), position: next.position, total: order.length };
}

export interface Kind {
  readonly boulder: boolean;
  readonly speed: boolean;
  readonly discipline: string | null;
}

/** IFSC names the discipline. (Lead ascents carry a time too, so a time alone doesn't mean speed.) */
export function kindOf(results: JSONValue): Kind {
  const ascents = arr(at(results, "ranking")).flatMap((a) => arr(at(a, "ascents")));
  const discipline = str(at(results, "discipline"))?.toLowerCase() ?? null;
  const boulder = discipline === "boulder" || (discipline == null && ascents.some((s) => present(s, "zone")));
  // Speed ascents are times, not heights: they don't belong on the wall.
  const speed = discipline === "speed" || (discipline == null && ascents.some((s) => present(s, "time_ms") && !present(s, "plus")));
  return { boulder, speed, discipline: discipline ?? (boulder ? "boulder" : speed ? "speed" : null) };
}

// MARK: - Who's on the wall (WallState.from)

/** The lead bar's domain: 0 to the next ten above the higher of the two heights, at least 10. */
export function wallDomain(height: number, leader: number | null): number {
  return Math.max(10, Math.ceil((Math.max(height, leader ?? 0) + 1) / 10) * 10);
}

/**
 * Reads an IFSC round-results JSON for a tile: the climber on the wall (and
 * the route's leader), the athlete on a boulder (their card), or who climbs
 * next. Null when nobody is on the wall and nobody is waiting (the round
 * hasn't started, or it's over).
 */
export function wallStateFrom(results: JSONValue): WallState | null {
  const athletes = arr(at(results, "ranking"));
  const routes = arr(at(results, "routes")).flatMap((r) => str(at(r, "name")) ?? []);
  const kind = kindOf(results);
  const athlete = (name: string, flag: string | null, country: string | null): WallAthlete => ({ name, flag, country });
  if (kind.boulder) {
    const card = athletes.flatMap((a) => boulderCard(a, routes) ?? []).find((c) => c.onWall);
    if (card) {
      const active = card.problems.findIndex((p) => p.active);
      return { phase: { kind: "boulder", athlete: athlete(card.name, card.flag, card.country), cells: card.problems.map((p) => p.reach), active: active >= 0 ? active : null } };
    }
  } else if (!kind.speed) {
    for (const route of routes) {
      const wall = wallRoute(route, athletes);
      const climber = wall.climbers.find((c) => c.onWall);
      if (!climber) continue;
      const ascent = (c: Climber): WallAscent => ({ athlete: athlete(c.name, c.flag, c.country), height: c.height, top: c.top, label: c.top ? "Top" : c.label });
      // The leader on this route: the highest climber who isn't climbing now.
      const leader = wall.climbers.find((c) => c.id !== climber.id && !c.onWall && (c.top || c.height > 0)) ?? null;
      return { phase: { kind: "lead", climber: ascent(climber), leader: leader ? ascent(leader) : null, route: routes.length > 1 ? route : null } };
    }
  }
  const next = upNext(results, routes[0] ?? null);
  if (next) {
    // `upNext` gives the display name and flag; find the country for the wash.
    const entry = arr(at(results, "startlist")).find((s) => shortName(s) === next.name);
    return { phase: { kind: "upNext", athlete: athlete(next.name, next.flag, str(at(entry, "country")) ?? null) } };
  }
  return null;
}

/** The athlete a tile is dressed in (flag colors). */
export function wallCountry(state: WallState): string | null {
  const p = state.phase;
  return p.kind === "lead" ? p.climber.athlete.country : p.athlete.country;
}
