/**
 * MLB's own pitch-by-pitch feed (Statcast.swift; statsapi.mlb.com): each
 * batted ball's launch speed, angle and distance, and each pitch's measured
 * flight; and its official scorer's account of every play: each runner's
 * legs and each fielder's credits. ESPN says where a ball went; this says
 * how it got there and who handled it. Public and keyless; trimmed with
 * `fields` to about 65 KB a game, and fetched when an at-bat ends, never on
 * the live lane's clock.
 *
 *     const game = statcastGame(schedule, ["Brewers", "Rays"]);   // 849804
 *     const atBats = statcastAtBats(feed);
 *     scene.measurement(atBats)?.batted;                           // playScene.ts: the play's own at-bat, once it's over
 */
import { arr, at, bool, num, str } from "../json";

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
  /** Who fielded it, by scorer's number (MLB's `location`). */
  readonly fielder: number | null;
}

/** Swift's `.rounded()`: halves away from zero. */
const rounded = (v: number) => Math.sign(v) * Math.round(Math.abs(v));

/**
 * "104.4 MPH · 12° · 273 FT", as much as is known. A grounder's distance is
 * only its first hop, so it can be left off (`distance`).
 */
export function battedLine(b: StatcastBatted, distance = true): string | null {
  const parts = [
    b.launchSpeed != null ? `${b.launchSpeed.toFixed(1)} MPH` : null,
    // A true minus for a ball hit into the ground ("−29°").
    b.launchAngle != null ? `${rounded(b.launchAngle)}°`.replace("-", "\u2212") : null,
    distance && b.distance != null ? `${rounded(b.distance)} FT` : null,
  ].filter((p): p is string => p != null);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** A fielder's part in a runner's leg (Statcast.Credit.Kind), by MLB's name for it. */
export type CreditKind = "fielded" | "assist" | "outfieldAssist" | "putout" | "throwingError" | "fieldingError" | "deflection" | "other";

const CREDIT_KINDS: Readonly<Record<string, CreditKind>> = {
  f_fielded_ball: "fielded",
  f_assist: "assist",
  f_assist_of: "outfieldAssist",
  f_putout: "putout",
  f_throwing_error: "throwingError",
  f_fielding_error: "fieldingError",
  f_deflection: "deflection",
};

/** A fielder's part in a runner's leg, by scorer's number. */
export interface Credit {
  readonly position: number;
  readonly kind: CreditKind;
}

/**
 * One leg of a runner's way on a play, as MLB's official scorer recorded it:
 * base to base (0: the plate, where the batter starts; 4: home, a run), or put
 * out at a base, the outs numbered in the order they were made, with every
 * fielder's part in it.
 */
export interface Movement {
  /** MLB's ID for the runner: the same on each of his legs. */
  readonly runner: number;
  readonly from: number;
  /** Null when he was put out on this leg. */
  readonly to: number | null;
  /** Where he was put out (4: home), and which out of the inning it was. */
  readonly out: number | null;
  readonly outNumber: number | null;
  /** "r_adv_force", "r_adv_play", "r_out_stretching", "r_doubled_off"… */
  readonly reason: string | null;
  /** The at-bat's event it came on (its last pitch, or a steal between pitches). */
  readonly event: number | null;
  readonly credits: readonly Credit[];
}

/** Someone threw to the putout (not a catch or a tag by the man who fielded it). */
export const assisted = (m: Movement): boolean => m.credits.some((c) => c.kind === "assist" || c.kind === "outfieldAssist");

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
  /**
   * Over (MLB's `isComplete`): `event` alone isn't, since MLB names it
   * mid-at-bat for whatever just happened ("Mound Visit", "Batter Timeout",
   * "Stolen Base 2B").
   */
  readonly complete: boolean;
  /** Every runner's legs in the at-bat (a steal's between pitches too). */
  readonly runners: readonly Movement[];
  /** The event that ended it (its last pitch, or a pickoff): the result's legs are the ones on it. */
  readonly closing: number | null;
  /** Its last pitch was put in play. */
  readonly inPlay: boolean;
}

/** The legs on the play that ended the at-bat (AtBat.result). */
export const atBatResult = (a: StatcastAtBat): Movement[] => a.runners.filter((m) => m.event === a.closing);

/** Over, with all of it posted: complete and named, a ball put in play with its hitData (AtBat.over). */
export const atBatOver = (a: StatcastAtBat): boolean => a.complete && a.event != null && (!a.inPlay || a.batted != null);

/** Only what the theater reads: about a third of the feed. */
export const STATCAST_FIELDS = [
  "liveData", "plays", "allPlays", "about", "atBatIndex", "inning", "isTopInning", "matchup", "batter", "fullName",
  "result", "event", "playEvents", "isPitch", "details", "type", "code", "pitchData", "startSpeed", "strikeZoneTop",
  "strikeZoneBottom", "coordinates", "x0", "y0", "z0", "vX0", "vY0", "vZ0", "aX", "aY", "aZ", "pX", "pZ", "breaks",
  "spinRate", "hitData", "launchSpeed", "launchAngle", "totalDistance", "trajectory", "coordX", "coordY", "location",
  "index", "runners", "movement", "start", "end", "isOut", "outBase", "outNumber", "movementReason", "runner", "id",
  "playIndex", "credits", "credit", "position", "isComplete",
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
    let closing: number | null = null;
    let inPlay = false;
    arr(at(play, "playEvents")).forEach((event, i) => {
      const code = str(at(event, "details", "code"));
      if (bool(at(event, "isPitch")) === true) {
        const n = num(at(event, "index"));
        closing = n != null ? Math.trunc(n) : i;
        inPlay = code != null && IN_PLAY.has(code);
      }
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
      // A ball in play's (a foul can carry hitData too).
      const hit = at(event, "hitData");
      if (hit != null && typeof hit === "object" && (code == null || IN_PLAY.has(code))) {
        const x = num(at(hit, "coordinates", "coordX"));
        const y = num(at(hit, "coordinates", "coordY"));
        // ("89": between two of them, no one's.)
        const location = str(at(hit, "location"));
        const fielder = location != null && /^\d+$/.test(location) ? Number(location) : null;
        batted = {
          launchSpeed: num(at(hit, "launchSpeed")) ?? null,
          launchAngle: num(at(hit, "launchAngle")) ?? null,
          distance: num(at(hit, "totalDistance")) ?? null,
          trajectory: str(at(hit, "trajectory")) ?? null,
          spot: x != null && y != null ? [x, y] : null,
          fielder: fielder != null && fielder >= 1 && fielder <= 9 ? fielder : null,
        };
      }
    });
    const runners = arr(at(play, "runners")).flatMap((r) => movement(r) ?? []);
    // Its last pitch, or a pickoff after it that ended it.
    const events = runners.flatMap((m) => (m.event != null ? [m.event] : []));
    const last = events.length > 0 ? Math.max(...events) : null;
    const ended = closing == null ? last : last == null ? closing : Math.max(closing, last);
    out.push({
      index: Math.trunc(index),
      inning: Math.trunc(inning),
      top: bool(at(about, "isTopInning")) ?? true,
      batter: str(at(play, "matchup", "batter", "fullName")) ?? "",
      event: str(at(play, "result", "event")) ?? null,
      pitches,
      batted,
      complete: bool(at(about, "isComplete")) ?? true,
      runners,
      closing: ended,
      inPlay,
    });
  }
  return out;
}

/** A pitch's call that put the ball in play: in play, out(s); in play, no out; in play, run(s). */
const IN_PLAY: ReadonlySet<string> = new Set(["X", "D", "E"]);

/** MLB's bases: "1B"…"3B", and "4B" and "score" home. */
function base(s: string | undefined): number | null {
  switch (s) {
    case "1B":
      return 1;
    case "2B":
      return 2;
    case "3B":
      return 3;
    case "4B":
    case "score":
      return 4;
    default:
      return null;
  }
}

/** A runner's leg from MLB's `runners`: the batter starts from nowhere (the plate). */
export function movement(entry: unknown): Movement | null {
  const m = at(entry, "movement");
  const details = at(entry, "details");
  const id = num(at(details, "runner", "id"));
  if (id == null) return null;
  const out = bool(at(m, "isOut")) === true;
  const credits = arr(at(entry, "credits")).flatMap((c): Credit[] => {
    const code = str(at(c, "position", "code"));
    if (code == null || !/^\d+$/.test(code)) return [];
    return [{ position: Number(code), kind: CREDIT_KINDS[str(at(c, "credit")) ?? ""] ?? "other" }];
  });
  const outNumber = num(at(m, "outNumber"));
  const event = num(at(details, "playIndex"));
  return {
    runner: Math.trunc(id),
    from: base(str(at(m, "start"))) ?? 0,
    to: out ? null : base(str(at(m, "end"))),
    out: out ? base(str(at(m, "outBase"))) : null,
    outNumber: out && outNumber != null ? Math.trunc(outNumber) : null,
    reason: str(at(details, "movementReason")) ?? null,
    event: event != null ? Math.trunc(event) : null,
    credits,
  };
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
