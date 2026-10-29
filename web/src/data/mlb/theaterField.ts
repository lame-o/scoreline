/**
 * The play theater's field and its curves (PlayScript.swift `Ballpark`,
 * `FieldPoint`, `PlayScript.Ease`; Components.swift `Motion.curve`): the
 * ballpark in feet with home plate at the origin, x toward first base's
 * side, y out to center field, z up. Pure numbers, shared by the scene, the
 * script, the camera and the renderer.
 */

/** A point on the ground, in feet (Swift `CGPoint`). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A point on or over the field, in feet. */
export interface FieldPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const point = (x: number, y: number): Point => ({ x, y });
export const fieldPoint = (p: Point, z = 0): FieldPoint => ({ x: p.x, y: p.y, z });
export const ground = (p: FieldPoint): Point => ({ x: p.x, y: p.y });
export const ORIGIN: Point = { x: 0, y: 0 };
export const samePoint = (a: Point, b: Point, epsilon = 1e-9) => Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
export const distanceBetween = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

const SQRT2 = Math.SQRT2;

export const Ballpark = {
  baseline: 90,
  /** The pitcher's rubber. */
  rubber: { x: 0, y: 60.5 } as Point,
  /** Where the pitch leaves his hand: a stride (6.5 ft) off the rubber. */
  release: 54,
  /** The infield's dirt reaches 95 ft from the rubber. */
  skin: 95,
  wallHeight: 10,

  /** Home (0), first, second, third. */
  base(n: number): Point {
    const d = this.baseline / SQRT2;
    switch (((n % 4) + 4) % 4) {
      case 1:
        return { x: d, y: d };
      case 2:
        return { x: 0, y: 2 * d };
      case 3:
        return { x: -d, y: d };
      default:
        return ORIGIN;
    }
  },

  /** ESPN hit coordinates to feet: home plate at (125, 205), 2.42 ft a unit (the spray chart's fence, 165 units out, is 400 ft). */
  feet(espn: Point): Point {
    return { x: (espn.x - 125) * 2.42, y: (205 - espn.y) * 2.42 };
  },

  /** Radians off the line to center field, positive toward right. */
  bearing(p: Point): number {
    return Math.atan2(p.x, p.y);
  },

  /** The fence: 330 ft down the lines, 375 in the gaps, 400 to center. */
  fence(bearing: number): number {
    return 330 + 70 * Math.cos(2 * Math.min(Math.max(bearing, -Math.PI / 4), Math.PI / 4));
  },

  distance(p: Point): number {
    return Math.hypot(p.x, p.y);
  },

  polar(distance: number, degrees: number): Point {
    const a = (degrees * Math.PI) / 180;
    return { x: distance * Math.sin(a), y: distance * Math.cos(a) };
  },

  /** Where each fielder stands, by scorer's number. */
  position(n: number): Point {
    switch (n) {
      case 1:
        return { x: 0, y: 56 };
      case 2:
        return { x: 0, y: -8 };
      case 3:
        return this.polar(110, 37);
      case 4:
        return this.polar(150, 15);
      case 5:
        return this.polar(110, -37);
      case 6:
        return this.polar(150, -15);
      case 7:
        return this.polar(292, -27);
      case 8:
        return this.polar(322, 0);
      default:
        return this.polar(292, 27);
    }
  },

  /** The batter's spot, on his side of the plate: a right-handed batter stands on the third-base side (the left, from behind the plate). */
  box(bats: "L" | "R"): Point {
    return { x: bats === "L" ? 9 : -9, y: 1 };
  },

  /** A runner's lead: a step off the bag toward the next base. */
  lead(base: number): Point {
    const from = this.base(base);
    const to = this.base(base + 1);
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    return { x: from.x + ((to.x - from.x) / d) * 7, y: from.y + ((to.y - from.y) / d) * 7 };
  },

  /** Where a fielder takes a throw at a base: on the bag, a stride inside it. */
  bag(base: number): Point {
    const b = this.base(base);
    if (base % 4 === 0) return { x: 0, y: -2 };
    const toMound = { x: this.rubber.x - b.x, y: this.rubber.y - b.y };
    const d = Math.hypot(toMound.x, toMound.y);
    return { x: b.x + (toMound.x / d) * 3, y: b.y + (toMound.y / d) * 3 };
  },

  /** The first baseman holding a runner on: at the bag, a step toward second. */
  get holding(): Point {
    const b = this.base(1);
    return { x: b.x - 3, y: b.y + 1 };
  },

  /**
   * A team's dugout, in foul ground off the line: the home team's on the
   * first-base side, the visitors' on the third (parks differ; this is the
   * theater's one assumption, the same every game).
   */
  dugout(home: boolean): Point {
    return { x: home ? 84 : -84, y: 26 };
  },

  /** A team's bullpen gate, in the wall on its dugout's side, in the gap. */
  bullpen(home: boolean): Point {
    const degrees = home ? 36 : -36;
    return this.polar(this.fence((degrees * Math.PI) / 180) - 6, degrees);
  },

  /**
   * The plate umpire's spot: behind the catcher, in the slot on the batter's
   * side of him, a little wider and deeper than life so the two figures,
   * drawn larger than life, both read.
   */
  umpire(bats: "L" | "R" | null): Point {
    return { x: bats === "L" ? 3.2 : -3.2, y: -13 };
  },

  /** The fielder nearest a spot (outfielders only for a ball beyond the infield). */
  nearest(p: Point): number {
    const pool = this.distance(p) > 175 ? [7, 8, 9] : [1, 3, 4, 5, 6];
    let best = pool[0] ?? 8;
    let bestDistance = Infinity;
    for (const n of pool) {
      const q = this.position(n);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = n;
      }
    }
    return best;
  },
};

// MARK: - Curves

/**
 * A CSS-style cubic Bézier timing curve: y for a given x in 0…1 (SwiftUI
 * `UnitCurve.bezier(…).value(at:)`). Newton steps, then bisection.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-7) return sampleY(t);
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= error / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

/** The house ease-out (0.23, 1, 0.32, 1), evaluated inside a drawing (Motion.curve). */
export const houseCurve = cubicBezier(0.23, 1, 0.32, 1);

export type Ease = "linear" | "out" | "inOut";

export function easeValue(ease: Ease, raw: number): number {
  const u = Math.min(Math.max(raw, 0), 1);
  switch (ease) {
    case "linear":
      return u;
    // The house ease-out: arriving, it settles.
    case "out":
      return houseCurve(u);
    case "inOut":
      return u * u * (3 - 2 * u);
  }
}

/** smoothstep on 0…1. */
export function smooth(x: number): number {
  const u = Math.min(Math.max(x, 0), 1);
  return u * u * (3 - 2 * u);
}

/** A critically damped spring from 0 to 1 over SwiftUI's `Spring(duration:, bounce: 0)`, at `t` seconds. */
export function criticalSpring(duration: number, t: number): number {
  if (t <= 0) return 0;
  const omega = (2 * Math.PI) / duration;
  return 1 - (1 + omega * t) * Math.exp(-omega * t);
}
