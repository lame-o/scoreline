/**
 * The game as one broadcast, part 9: motion (TheaterMotion.swift;
 * CHOREOGRAPHY §5.5). Keyframes to tracks a person could run.
 *
 * Every segment between two keys is a quintic Hermite: position, velocity and
 * acceleration match at both ends, so a path is C² everywhere but at a
 * declared contact. Velocities at keys a figure runs through come from
 * non-uniform Catmull–Rom (clamped to his sprint), accelerations from their
 * neighbors (clamped to his limits); he arrives at rest where he stops. A long
 * move from rest to rest cruises (ramp, cruise, ramp), the way a man runs up
 * to a speed and holds it, rather than one easing that reads sluggish. The
 * splice's travel (theaterClips.ts) is the same synthesis from the world's
 * exact state to where the next clip wants him, timed by what his limits
 * allow: if the time isn't there, the plan takes more (a declared catch-up),
 * never a faster man.
 *
 * Closed forms and bounded searches only: deterministic, and portable.
 */
import type { Point } from "../mlb/theaterField";
import { add2, dot2, isRestKind, length2, scale2, sub2, TheaterTiming, v2, ZERO2, type Band, type MotionKey, type PTime } from "./theaterEngine";

/** One quintic Hermite segment of a 2-D path, on [t0, t0 + duration]. */
export class Quintic {
  readonly t0: PTime;
  readonly duration: number;
  /** p(s) = c0 + c1 s + … + c5 s⁵ with s = (t − t0)/duration: x and y of each, in order. */
  private readonly c: Float64Array;

  constructor(t0: PTime, duration: number, x0: Point, v0: Point, a0: Point, x1: Point, v1: Point, a1: Point) {
    this.t0 = t0;
    const T = Math.max(duration, 1e-6);
    this.duration = T;
    const c = new Float64Array(12);
    for (let k = 0; k < 2; k++) {
      const p0 = k === 0 ? x0.x : x0.y;
      const d = (k === 0 ? x1.x : x1.y) - p0;
      const V0 = (k === 0 ? v0.x : v0.y) * T;
      const V1 = (k === 0 ? v1.x : v1.y) * T;
      const A0 = (k === 0 ? a0.x : a0.y) * T * T;
      const A1 = (k === 0 ? a1.x : a1.y) * T * T;
      c[k] = p0;
      c[2 + k] = V0;
      c[4 + k] = 0.5 * A0;
      c[6 + k] = 10 * d - 6 * V0 - 4 * V1 - 1.5 * A0 + 0.5 * A1;
      c[8 + k] = -15 * d + 8 * V0 + 7 * V1 + 1.5 * A0 - A1;
      c[10 + k] = 6 * d - 3 * V0 - 3 * V1 - 0.5 * A0 + 0.5 * A1;
    }
    this.c = c;
  }

  get t1(): PTime {
    return this.t0 + this.duration;
  }

  private s(t: PTime): number {
    return Math.min(Math.max((t - this.t0) / this.duration, 0), 1);
  }

  private at(k: number, s: number): number {
    const c = this.c;
    return c[k]! + s * (c[2 + k]! + s * (c[4 + k]! + s * (c[6 + k]! + s * (c[8 + k]! + s * c[10 + k]!))));
  }

  private rate(k: number, s: number): number {
    const c = this.c;
    return (c[2 + k]! + s * (2 * c[4 + k]! + s * (3 * c[6 + k]! + s * (4 * c[8 + k]! + s * 5 * c[10 + k]!)))) / this.duration;
  }

  private push(k: number, s: number): number {
    const c = this.c;
    return (2 * c[4 + k]! + s * (6 * c[6 + k]! + s * (12 * c[8 + k]! + s * 20 * c[10 + k]!))) / (this.duration * this.duration);
  }

  position(t: PTime): Point {
    const s = this.s(t);
    return v2(this.at(0, s), this.at(1, s));
  }

  velocity(t: PTime): Point {
    const s = this.s(t);
    return v2(this.rate(0, s), this.rate(1, s));
  }

  acceleration(t: PTime): Point {
    const s = this.s(t);
    return v2(this.push(0, s), this.push(1, s));
  }

  /** x and y of the position into `out` (the bake's read: no allocation). */
  positionInto(t: PTime, out: { x: number; y: number }): void {
    const s = this.s(t);
    out.x = this.at(0, s);
    out.y = this.at(1, s);
  }

  /** The velocity and acceleration at t into `out` (the limits check's read: the same numbers, no allocation). */
  motionInto(t: PTime, out: Kinematics, acceleration: boolean): void {
    const s = this.s(t);
    out.vx = this.rate(0, s);
    out.vy = this.rate(1, s);
    out.ax = acceleration ? this.push(0, s) : 0;
    out.ay = acceleration ? this.push(1, s) : 0;
  }

  equals(o: Quintic): boolean {
    if (this.t0 !== o.t0 || this.duration !== o.duration) return false;
    for (let i = 0; i < 12; i++) if (this.c[i] !== o.c[i]) return false;
    return true;
  }
}

/** A path from keys: quintic segments end to end, holding its first and last points outside them. */
export class MotionPath {
  readonly segments: readonly Quintic[];
  /** Where it stands before the first segment (and after the last, if it has none). */
  readonly rest: Point;

  constructor(segments: readonly Quintic[], rest?: Point) {
    this.segments = segments;
    const first = segments[0];
    this.rest = rest ?? (first ? first.position(first.t0) : ZERO2);
  }

  static at(point: Point): MotionPath {
    return new MotionPath([], point);
  }

  get start(): PTime {
    return this.segments[0]?.t0 ?? -Infinity;
  }

  get end(): PTime {
    return this.segments[this.segments.length - 1]?.t1 ?? -Infinity;
  }

  private segment(t: PTime): Quintic | null {
    const segments = this.segments;
    const first = segments[0];
    if (!first) return null;
    if (t <= first.t0) return first;
    let lo = 0;
    let hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segments[mid]!.t0 <= t) lo = mid;
      else hi = mid - 1;
    }
    return segments[lo]!;
  }

  position(t: PTime): Point {
    return this.segment(t)?.position(t) ?? this.rest;
  }

  /** Outside its segments it holds still. */
  velocity(t: PTime): Point {
    const s = this.segment(t);
    if (!s || !(t >= this.start) || !(t <= this.end)) return ZERO2;
    return s.velocity(t);
  }

  acceleration(t: PTime): Point {
    const s = this.segment(t);
    if (!s || !(t >= this.start) || !(t < this.end)) return ZERO2;
    return s.acceleration(t);
  }

  /** `velocity(t)` and `acceleration(t)` into `out`, the same numbers without allocating. */
  motionInto(t: PTime, out: Kinematics): void {
    const s = this.segment(t);
    if (!s || !(t >= this.start) || !(t <= this.end)) {
      out.vx = 0;
      out.vy = 0;
      out.ax = 0;
      out.ay = 0;
      return;
    }
    s.motionInto(t, out, t < this.end);
  }
}

/** A velocity and an acceleration, written in place. */
export interface Kinematics {
  vx: number;
  vy: number;
  ax: number;
  ay: number;
}

/** Where a path breaks the band (`TheaterMotion.Violation`). */
export interface Violation {
  readonly kind: "speed" | "accel" | "decel" | "lateral";
  readonly at: PTime;
  /** How far over the limit (a share: 0.1 is 10% over). */
  readonly over: number;
}

/** Two men who'd overlap: who, when they're closest, and how close. */
export interface Overlap {
  readonly a: number;
  readonly b: number;
  readonly at: PTime;
  readonly distance: number;
}

/** The limits check's one kinematics buffer (it never re-enters itself). */
const SCRATCH: Kinematics = { vx: 0, vy: 0, ax: 0, ay: 0 };

/** A pair of paths allowed to touch (a screen, a box-out): `"i,j"` with i < j. */
export const contactPair = (i: number, j: number) => `${i},${j}`;

export const TheaterMotion = {
  // MARK: Closed forms

  /**
   * The shortest rest-to-rest quintic over `distance` within a band: its peak speed is
   * 1.875·d/T and its peak acceleration 5.77·d/T² (§5.5.4).
   */
  shortest(d: number, band: Band): number {
    if (!(d > 1e-9)) return 0;
    return Math.max((1.875 * d) / band.sprint, Math.sqrt((5.77 * d) / Math.min(band.accel, band.decel)));
  },

  // MARK: Synthesis

  /**
   * A path through `keys` (in time order) for a man with this band:
   * Catmull–Rom velocities at through keys, accelerations from the
   * neighbors, at rest at arrivals and departures, the given values at hard
   * keys that carry them (the splice's).
   */
  path(keys: readonly MotionKey[], band: Band): MotionPath {
    if (keys.length <= 1) return MotionPath.at(keys[0]?.at ?? ZERO2);
    const n = keys.length;
    const v: Point[] = new Array(n).fill(ZERO2);
    const a: Point[] = new Array(n).fill(ZERO2);
    for (let j = 0; j < n; j++) {
      const k = keys[j]!;
      if (k.velocity) {
        v[j] = k.velocity;
        continue;
      }
      if (isRestKind(k.kind)) {
        v[j] = ZERO2;
        continue;
      }
      if (!(j > 0 && j < n - 1)) {
        v[j] = ZERO2;
        continue;
      }
      const t0 = keys[j]!.t - keys[j - 1]!.t;
      const t1 = keys[j + 1]!.t - keys[j]!.t;
      if (!(t0 > 1e-9 && t1 > 1e-9)) continue;
      const back = scale2(sub2(keys[j]!.at, keys[j - 1]!.at), 1 / t0);
      const ahead = scale2(sub2(keys[j + 1]!.at, keys[j]!.at), 1 / t1);
      v[j] = TheaterMotion.clamp(add2(scale2(back, t1 / (t0 + t1)), scale2(ahead, t0 / (t0 + t1))), band.sprint);
    }
    for (let j = 0; j < n; j++) {
      const k = keys[j]!;
      if (k.acceleration) {
        a[j] = k.acceleration;
        continue;
      }
      if (!(k.kind === "through" && j > 0 && j < n - 1)) continue;
      const span = keys[j + 1]!.t - keys[j - 1]!.t;
      if (!(span > 1e-9)) continue;
      a[j] = TheaterMotion.clamp(scale2(sub2(v[j + 1]!, v[j - 1]!), 0.5 / span), Math.min(band.accel, band.decel));
    }
    const segments: Quintic[] = [];
    for (let j = 0; j < n - 1; j++) {
      if (!(keys[j + 1]!.t > keys[j]!.t + 1e-9)) continue;
      segments.push(new Quintic(keys[j]!.t, keys[j + 1]!.t - keys[j]!.t, keys[j]!.at, v[j]!, a[j]!, keys[j + 1]!.at, v[j + 1]!, a[j + 1]!));
    }
    return new MotionPath(segments);
  },

  clamp(v: Point, most: number): Point {
    const m = length2(v);
    return m > most && m > 0 ? scale2(v, most / m) : v;
  },

  // MARK: Travel (the splice's)

  /**
   * How a man gets from his state at `t0` (where, how fast, accelerating
   * how) to `x1`, arriving with `v1` (and `a1`) at `t0 + duration`. A short
   * move is one quintic; a long one ramps to a cruise and back, the cruise as
   * slow as the time allows (a jog when there's time, a sprint when there isn't).
   */
  travel(x0: Point, v0: Point, a0: Point, t0: PTime, x1: Point, v1: Point, a1: Point, duration: number, band: Band, cruiseOver: number): MotionPath {
    const direct = TheaterMotion.steer(x0, v0, a0, t0, x1, v1, a1, duration, band, cruiseOver);
    // Already on the move and the straight path asks more than his legs (running the wrong way, too fast to turn):
    // he pulls up first, as a man does, then goes.
    if (!(length2(v0) > 0.5) || TheaterMotion.fits(direct, t0, t0 + duration, band)) return direct;
    return TheaterMotion.brake(x0, v0, a0, t0, x1, v1, a1, duration, band, cruiseOver) ?? direct;
  },

  /**
   * Pulling up from his speed (as hard as the band allows, no harder),
   * standing a moment if there's time, then the move to `x1` at a natural
   * pace; null if the time doesn't allow both.
   */
  brake(x0: Point, v0: Point, a0: Point, t0: PTime, x1: Point, v1: Point, a1: Point, duration: number, band: Band, cruiseOver: number): MotionPath | null {
    const speed = length2(v0);
    const stop = Math.max(0.35, ((1.875 * speed) / Math.min(band.decel, band.lateral)) * 1.05);
    const xs = add2(add2(x0, scale2(v0, stop / 2)), scale2(a0, (stop * stop) / 12));
    const left = duration - stop;
    const need = length2(v1) > 1e-9 ? length2(sub2(x1, xs)) / Math.max(band.run, 1e-6) + 0.45 : TheaterMotion.shortest(length2(sub2(x1, xs)), band);
    if (!(left >= need)) return null;
    // As slow as a jog allows, no slower than the time left needs.
    const pace = Math.min(left, Math.max(need * 1.6, need));
    const pull = new Quintic(t0, stop, x0, v0, a0, xs, ZERO2, ZERO2);
    const go = TheaterMotion.steer(xs, ZERO2, ZERO2, t0 + duration - pace, x1, v1, a1, pace, band, cruiseOver);
    return new MotionPath([pull, ...go.segments]);
  },

  /** The straight form: one quintic, or a ramp, a cruise and a ramp. */
  steer(x0: Point, v0: Point, a0: Point, t0: PTime, x1: Point, v1: Point, a1: Point, duration: number, band: Band, cruiseOver: number): MotionPath {
    const d = length2(sub2(x1, x0));
    const T = Math.max(duration, 1e-3);
    if (!(d > cruiseOver && length2(v1) < 1e-9)) return new MotionPath([new Quintic(t0, T, x0, v0, a0, x1, v1, a1)]);
    const dir = scale2(sub2(x1, x0), 1 / d);
    // The cruise speed that fits the time: ramps of at least 0.45 s, each as long as its change of speed needs.
    const along = Math.max(dot2(v0, dir), 0);
    const plan = (vc: number) => {
      // The first ramp turns him onto the line as well as bringing him to speed: as long as the whole change of velocity needs.
      const change = length2(sub2(scale2(dir, vc), v0));
      const r1 = Math.max(0.45, (1.875 * change) / Math.min(band.accel, band.lateral));
      const r3 = Math.max(0.45, (1.875 * vc) / band.decel);
      const d1 = ((along + vc) / 2) * r1;
      const d3 = (vc / 2) * r3;
      const cruise = Math.max(d - d1 - d3, 0) / Math.max(vc, 1e-6);
      return { r1, r3, cruise, d1, d3 };
    };
    let lo = band.walk * 0.5;
    let hi = band.sprint;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const p = plan(mid);
      if (p.r1 + p.cruise + p.r3 > T) lo = mid;
      else hi = mid;
    }
    const vc = hi;
    const p = plan(vc);
    // Too little room for a cruise at all (or the ramps overrun, or not even a sprint fits the time): one quintic,
    // which lands on time whatever it asks of him (the limits check is the caller's: `shortestTravel` finds the time).
    if (!(p.d1 + p.d3 < d && p.r1 + p.r3 < T && p.r1 + p.cruise + p.r3 <= T + 1e-6)) {
      return new MotionPath([new Quintic(t0, T, x0, v0, a0, x1, ZERO2, ZERO2)]);
    }
    const slack = T - (p.r1 + p.cruise + p.r3);
    const cruise = p.cruise + Math.max(slack, 0);
    const xa = add2(x0, scale2(dir, p.d1));
    const xb = sub2(x1, scale2(dir, p.d3));
    const ta = t0 + p.r1;
    const tb = ta + cruise;
    const cruiseSpeed = cruise > 1e-6 ? length2(sub2(xb, xa)) / cruise : vc;
    const vCruise = scale2(dir, cruiseSpeed);
    return new MotionPath([
      new Quintic(t0, p.r1, x0, v0, a0, xa, vCruise, ZERO2),
      new Quintic(ta, Math.max(cruise, 1e-3), xa, vCruise, ZERO2, xb, vCruise, ZERO2),
      new Quintic(tb, p.r3, xb, vCruise, ZERO2, x1, ZERO2, ZERO2),
    ]);
  },

  /** The least time a travel needs to stay inside the band (sampled at 60 Hz): a scan, then bisection. */
  shortestTravel(x0: Point, v0: Point, a0: Point, x1: Point, v1: Point, a1: Point, band: Band, cruiseOver: number, limit = 30): number {
    // Already faster than his sprint (a clip's own glide): the travel may begin at that speed, and only slow from it.
    const lenient: Band = { ...band, sprint: Math.max(band.sprint, length2(v0) * 1.0001) };
    const fits = (T: number) => {
      const path = TheaterMotion.travel(x0, v0, a0, 0, x1, v1, a1, T, band, cruiseOver);
      return TheaterMotion.fits(path, 0, T, lenient);
    };
    const d = length2(sub2(x1, x0));
    if (d < 1e-6 && length2(v0) < 1e-6 && length2(a0) < 1e-6) return 0;
    let lo = 0;
    let hi = Math.max(0.25, TheaterMotion.shortest(d, band) * 0.8);
    while (!fits(hi)) {
      lo = hi;
      hi *= 1.3;
      if (hi > limit) return limit;
    }
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  },

  // MARK: Limits

  /** Where a path breaks the band, sampled every 1/60 s (§5.5.4). */
  violations(path: MotionPath, t0: PTime, t1: PTime, band: Band): Violation[] {
    const out: Violation[] = [];
    let t = t0;
    const dt = 1 / TheaterTiming.rate;
    while (t <= t1 + 1e-9) {
      const v = path.velocity(t);
      const a = path.acceleration(t);
      const speed = length2(v);
      if (speed > band.sprint * 1.0001) out.push({ kind: "speed", at: t, over: speed / band.sprint - 1 });
      if (speed > 0.25) {
        const dir = v2(v.x / speed, v.y / speed);
        const along = dot2(a, dir);
        const across = length2(sub2(a, scale2(dir, along)));
        if (along > band.accel * 1.0001) out.push({ kind: "accel", at: t, over: along / band.accel - 1 });
        if (-along > band.decel * 1.0001) out.push({ kind: "decel", at: t, over: -along / band.decel - 1 });
        if (across > band.lateral * 1.0001) out.push({ kind: "lateral", at: t, over: across / band.lateral - 1 });
      } else if (length2(a) > Math.max(band.accel, band.decel) * 1.0001) {
        out.push({ kind: "accel", at: t, over: length2(a) / Math.max(band.accel, band.decel) - 1 });
      }
      t += dt;
    }
    return out;
  },

  /**
   * Whether a path keeps inside the band throughout (`violations(…).isEmpty`,
   * the same samples and tests, stopping at the first break): the travel's
   * search asks it dozens of times a man (a web addition, for the main
   * thread's sake; the answers are the Swift's).
   */
  fits(path: MotionPath, t0: PTime, t1: PTime, band: Band): boolean {
    const k = SCRATCH;
    let t = t0;
    const dt = 1 / TheaterTiming.rate;
    const sprint = band.sprint * 1.0001;
    const accel = band.accel * 1.0001;
    const decel = band.decel * 1.0001;
    const lateral = band.lateral * 1.0001;
    const most = Math.max(band.accel, band.decel) * 1.0001;
    while (t <= t1 + 1e-9) {
      path.motionInto(t, k);
      const speed = Math.sqrt(k.vx * k.vx + k.vy * k.vy);
      if (speed > sprint) return false;
      if (speed > 0.25) {
        const dx = k.vx / speed;
        const dy = k.vy / speed;
        const along = k.ax * dx + k.ay * dy;
        const cx = k.ax - dx * along;
        const cy = k.ay - dy * along;
        if (along > accel || -along > decel || Math.sqrt(cx * cx + cy * cy) > lateral) return false;
      } else if (Math.sqrt(k.ax * k.ax + k.ay * k.ay) > most) {
        return false;
      }
      t += dt;
    }
    return true;
  },

  // MARK: Collisions (§5.5.5)

  /**
   * Overlaps between paths (sampled at 20 Hz) lasting longer than 0.1 s,
   * closer than two radii; `contacts` pairs (a screen, a box-out) are allowed
   * to `1.2 ×` the radius.
   */
  overlaps(paths: readonly MotionPath[], t0: PTime, t1: PTime, radius: number, contacts: ReadonlySet<string> = new Set()): Overlap[] {
    const out: Overlap[] = [];
    if (paths.length <= 1) return out;
    const dt = 0.05;
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const least = contacts.has(contactPair(i, j)) ? 1.2 * radius : 2 * radius;
        let run = 0;
        let closest = Infinity;
        let when = t0;
        let t = t0;
        while (t <= t1 + 1e-9) {
          const d = length2(sub2(paths[i]!.position(t), paths[j]!.position(t)));
          if (d < least) {
            run += dt;
            if (d < closest) {
              closest = d;
              when = t;
            }
          } else {
            if (run > 0.1) out.push({ a: i, b: j, at: when, distance: closest });
            run = 0;
            closest = Infinity;
          }
          t += dt;
        }
        if (run > 0.1) out.push({ a: i, b: j, at: when, distance: closest });
      }
    }
    return out;
  },

  /**
   * The collision pass: the lower-priority man of each overlapping pair
   * steps round the other (a detour key at the closest approach, `2.2 ×` the
   * radius off his line), his path re-made from his keys; three passes at
   * most. `priority`: higher keeps his line. Returns the keys and what's left over.
   */
  separate(
    input: readonly (readonly MotionKey[])[],
    bands: readonly Band[],
    priority: readonly number[],
    t0: PTime,
    t1: PTime,
    radius: number,
    contacts: ReadonlySet<string> = new Set(),
  ): { keys: MotionKey[][]; residual: Overlap[] } {
    const keys = input.map((k) => [...k]);
    const paths = keys.map((k, i) => TheaterMotion.path(k, bands[i]!));
    let left: Overlap[] = [];
    for (let pass = 0; pass < 3; pass++) {
      left = TheaterMotion.overlaps(paths, t0, t1, radius, contacts);
      if (left.length === 0) break;
      const moved = new Set<number>();
      for (const o of left) {
        const [mover, other] = priority[o.a]! < priority[o.b]! ? [o.a, o.b] : [o.b, o.a];
        if (moved.has(mover) || keys[mover]!.length < 2) continue;
        // Off his line at the closest approach, away from the other man.
        const here = paths[mover]!.position(o.at);
        const there = paths[other]!.position(o.at);
        const heading = paths[mover]!.velocity(o.at);
        let side = v2(-heading.y, heading.x);
        if (length2(side) < 1e-6) side = sub2(here, there);
        if (length2(side) < 1e-6) side = v2(1, 0);
        side = scale2(side, 1 / length2(side));
        if (dot2(side, sub2(here, there)) < 0) side = scale2(side, -1);
        const detour: MotionKey = { t: o.at, at: add2(here, scale2(side, 2.2 * radius)), kind: "through", hard: false };
        // Never in place of a hard key, and only between two of his keys.
        const k = keys[mover]!.findIndex((key) => key.t > o.at);
        if (!(k > 0) || keys[mover]!.some((key) => key.hard && Math.abs(key.t - o.at) < 0.15)) continue;
        keys[mover]!.splice(k, 0, detour);
        paths[mover] = TheaterMotion.path(keys[mover]!, bands[mover]!);
        moved.add(mover);
      }
      if (moved.size === 0) break;
    }
    return { keys, residual: left };
  },
};
