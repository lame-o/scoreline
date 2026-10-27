/**
 * MLB's own pitch-by-pitch feed (Statcast.swift; statsapi.mlb.com): each
 * batted ball's launch speed, angle and distance, and each pitch's measured
 * flight. ESPN says where a ball went; this says how it got there. Public and
 * keyless; trimmed with `fields` to about 60 KB a game, and fetched when an
 * at-bat ends, never on the live lane's clock.
 *
 *     const game = statcastGame(schedule, ["Brewers", "Rays"]);   // 849804
 *     const atBats = statcastAtBats(feed);
 *     matchScene(scene, atBats, names)?.batted?.line;              // "104.4 MPH · 12° · 273 FT"
 *
 * The Mac app ports the parser and matcher but doesn't show them yet; the
 * web's play theater puts the batted-ball line on the stamp.
 */
import { arr, at, bool, num, str } from "../json";
import { surname, type PlayScene } from "./playScene";

type Vec3 = readonly [number, number, number];

/** A pitch's flight in Statcast's frame: feet and seconds from release, x toward the catcher's right, y from home plate toward the mound, z up. */
export interface StatcastPitch {
  readonly release: Vec3;
  readonly velocity: Vec3;
  readonly acceleration: Vec3;
  /** Where it crossed the front of the plate: feet from its center, and height. */
  readonly plate: readonly [number, number];
  /** This batter's zone, bottom and top (feet). */
  readonly zone: { readonly bottom: number; readonly top: number } | null;
  readonly mph: number | null;
  readonly spin: number | null;
  /** "FF", "SL". */
  readonly type: string | null;
}

/** Where it is `t` seconds after release (constant acceleration, as Statcast fits it). */
export function pitchPosition(p: StatcastPitch, t: number): Vec3 {
  const f = (i: 0 | 1 | 2) => p.release[i] + p.velocity[i] * t + p.acceleration[i] * 0.5 * t * t;
  return [f(0), f(1), f(2)];
}

/** When it reaches the front of the plate (17 inches in front of the point). */
export function plateTime(p: StatcastPitch): number | null {
  const a = p.acceleration[1] / 2;
  const b = p.velocity[1];
  const c = p.release[1] - 17 / 12;
  const d = b * b - 4 * a * c;
  if (d < 0) return null;
  const roots = a === 0 ? [-c / b] : [(-b - Math.sqrt(d)) / (2 * a), (-b + Math.sqrt(d)) / (2 * a)];
  const positive = roots.filter((r) => r > 0);
  return positive.length > 0 ? Math.min(...positive) : null;
}

export interface StatcastBatted {
  /** Exit velocity (mph) and launch angle (degrees). */
  readonly launchSpeed: number | null;
  readonly launchAngle: number | null;
  /** Feet, where it landed or was caught. */
  readonly distance: number | null;
  /** "ground_ball", "line_drive", "fly_ball", "popup". */
  readonly trajectory: string | null;
  /** Where it was fielded or landed, in the hit chart's space (home plate ≈ (125, 205)): ESPN's `hitCoordinate` comes from MLB. */
  readonly spot: readonly [number, number] | null;
}

/** Swift's `.rounded()`: halves away from zero. */
const rounded = (v: number) => Math.sign(v) * Math.round(Math.abs(v));

/** "104.4 MPH · 12° · 273 FT", as much as is known. */
export function battedLine(b: StatcastBatted): string | null {
  const parts = [
    b.launchSpeed != null ? `${b.launchSpeed.toFixed(1)} MPH` : null,
    b.launchAngle != null ? `${rounded(b.launchAngle)}°` : null,
    b.distance != null ? `${rounded(b.distance)} FT` : null,
  ].filter((p): p is string => p != null);
  return parts.length === 0 ? null : parts.join(" · ");
}

export interface StatcastAtBat {
  readonly index: number;
  readonly inning: number;
  readonly top: boolean;
  /** "Brice Turang". */
  readonly batter: string;
  /** "Groundout", "Home Run". */
  readonly event: string | null;
  readonly pitches: readonly StatcastPitch[];
  readonly batted: StatcastBatted | null;
}

/** Only what the theater reads: about a quarter of the feed. */
export const STATCAST_FIELDS = [
  "liveData", "plays", "allPlays", "about", "atBatIndex", "inning", "isTopInning", "matchup", "batter", "fullName",
  "result", "event", "playEvents", "isPitch", "details", "type", "code", "pitchData", "startSpeed", "strikeZoneTop",
  "strikeZoneBottom", "coordinates", "x0", "y0", "z0", "vX0", "vY0", "vZ0", "aX", "aY", "aZ", "pX", "pZ", "breaks",
  "spinRate", "hitData", "launchSpeed", "launchAngle", "totalDistance", "trajectory", "coordX", "coordY",
].join(",");

export function feedURL(game: number): string {
  return `https://statsapi.mlb.com/api/v1.1/game/${game}/feed/live?fields=${STATCAST_FIELDS}`;
}

const easternDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** MLB's schedule for a day, its own (Eastern) date: a 7 PM Pacific game is the same day. `start` in epoch ms. */
export function scheduleURL(start: number): string {
  return `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${easternDate.format(new Date(start))}`;
}

/** The MLB game between these teams in a day's schedule. ESPN's names are the short ones ("Brewers", "Red Sox"); MLB's end with them. */
export function statcastGame(schedule: unknown, teams: readonly string[]): number | null {
  const wanted = teams.map((t) => t.toLowerCase());
  if (wanted.length !== 2) return null;
  for (const day of arr(at(schedule, "dates"))) {
    for (const g of arr(at(day, "games"))) {
      const names = [str(at(g, "teams", "away", "team", "name")), str(at(g, "teams", "home", "team", "name"))]
        .filter((n): n is string => n != null)
        .map((n) => n.toLowerCase());
      if (wanted.every((team) => names.some((n) => n.endsWith(team)))) {
        const pk = num(at(g, "gamePk"));
        return pk != null ? Math.trunc(pk) : null;
      }
    }
  }
  return null;
}

export function statcastAtBats(feed: unknown): StatcastAtBat[] {
  const out: StatcastAtBat[] = [];
  for (const play of arr(at(feed, "liveData", "plays", "allPlays"))) {
    const about = at(play, "about");
    const index = num(at(about, "atBatIndex"));
    const inning = num(at(about, "inning"));
    if (index == null || inning == null) continue;
    const pitches: StatcastPitch[] = [];
    let batted: StatcastBatted | null = null;
    for (const event of arr(at(play, "playEvents"))) {
      const data = at(event, "pitchData");
      const c = at(data, "coordinates");
      const v = (k: string) => num(at(c, k));
      const [x0, y0, z0, vx, vy, vz, ax, ay, az, px, pz] = ["x0", "y0", "z0", "vX0", "vY0", "vZ0", "aX", "aY", "aZ", "pX", "pZ"].map(v);
      if (
        bool(at(event, "isPitch")) === true &&
        x0 != null && y0 != null && z0 != null && vx != null && vy != null && vz != null &&
        ax != null && ay != null && az != null && px != null && pz != null
      ) {
        const top = num(at(data, "strikeZoneTop"));
        const bottom = num(at(data, "strikeZoneBottom"));
        const spin = num(at(data, "breaks", "spinRate"));
        pitches.push({
          release: [x0, y0, z0],
          velocity: [vx, vy, vz],
          acceleration: [ax, ay, az],
          plate: [px, pz],
          zone: top != null && bottom != null && bottom < top ? { bottom, top } : null,
          mph: num(at(data, "startSpeed")) ?? null,
          spin: spin != null ? Math.trunc(spin) : null,
          type: str(at(event, "details", "type", "code")) ?? null,
        });
      }
      const hit = at(event, "hitData");
      if (hit != null && typeof hit === "object") {
        const x = num(at(hit, "coordinates", "coordX"));
        const y = num(at(hit, "coordinates", "coordY"));
        batted = {
          launchSpeed: num(at(hit, "launchSpeed")) ?? null,
          launchAngle: num(at(hit, "launchAngle")) ?? null,
          distance: num(at(hit, "totalDistance")) ?? null,
          trajectory: str(at(hit, "trajectory")) ?? null,
          spot: x != null && y != null ? [x, y] : null,
        };
      }
    }
    out.push({
      index: Math.trunc(index),
      inning: Math.trunc(inning),
      top: bool(at(about, "isTopInning")) ?? true,
      batter: str(at(play, "matchup", "batter", "fullName")) ?? "",
      event: str(at(play, "result", "event")) ?? null,
      pitches,
      batted,
    });
  }
  return out;
}

/** Accents and case aside (Swift `folding(options: [.diacriticInsensitive, .caseInsensitive])`). */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/**
 * The at-bat an ESPN result describes: the same half-inning, the batter by
 * surname (accents and case aside), and the nth of theirs in it when a team
 * bats around.
 */
export function match(inning: number, top: boolean, name: string, atBats: readonly StatcastAtBat[], occurrence = 0): StatcastAtBat | null {
  // Web: a trailing period aside too, so "Mesa Jr" (a surname as the box score shortens it) finds "Victor Mesa Jr.".
  const bare = (s: string) => fold(s).replace(/\.+$/, "");
  const key = bare(name);
  if (key === "") return null;
  const theirs = atBats.filter((a) => a.inning === inning && a.top === top && bare(a.batter).endsWith(key));
  return theirs[occurrence] ?? null;
}

/**
 * A play's Statcast at-bat (web): by its half-inning and its batter's
 * surname, from the box score's short name ("J. Chourio") or else the text's
 * leading capitalized words ("Turang grounded out…", "De La Cruz singled…").
 */
export function matchScene(scene: PlayScene, atBats: readonly StatcastAtBat[], names: Readonly<Record<string, string>> = {}): StatcastAtBat | null {
  if (scene.inning == null || scene.top == null || scene.batter == null) return null;
  const known = scene.batterID != null ? names[scene.batterID] : undefined;
  let key = known != null ? surname(known) : "";
  if (key === "") {
    const words: string[] = [];
    for (const word of scene.text.split(/\s+/)) {
      if (!/^\p{Lu}/u.test(word)) break;
      words.push(word);
    }
    key = words.join(" ").replace(/[.,]+$/, "");
  }
  if (key === "") return null;
  return match(scene.inning, scene.top, key, atBats, scene.batterOccurrence);
}
