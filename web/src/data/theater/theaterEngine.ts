/**
 * The game as one broadcast, part 7: the choreography engine's shared types
 * (TheaterEngine.swift; CHOREOGRAPHY.md §4, §10).
 *
 * The theaters stop owning time. Each known play's decisive moment (the ball
 * through the net, the catch, the pitch crossing the plate) gets an anchor on
 * the presentation clock's p (theaterAnchors.ts); a plan places what happens
 * around the anchors from the world as it stands on screen; the plan is baked
 * once into dense tracks (theaterMotion.ts, theaterCamera.ts); and a frame
 * only samples the tracks at p (theaterPlanChain.ts). New data never cuts the
 * picture: it splices a new plan in from a commit point, starting exactly
 * from the old plan's state there (positions, velocities, the stride, the
 * camera with its velocity), the way an interruptible animation retargets
 * from its presentation value.
 *
 * Everything here is a pure value: no React, no clock, no globals. Swift's
 * `SIMD2<Double>` is a `Point`, `SIMD3` a `FieldPoint`, `SIMD4` a `Vec4`.
 */
import type { FieldPoint, Point } from "../mlb/theaterField";
import type { RigCarry } from "./rig";

/** Seconds since 1970 on the event-time axis (GameTimeline.swift `PTime`). */
export type PTime = number;

/** One figure on the field for the whole session (CHOREOGRAPHY §5.3): a UInt16. */
export type ActorID = number;

/** x, y of the camera's center on the ground, log of its span, yaw (Swift's `SIMD4<Double>`). */
export interface Vec4 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export const vec4 = (x: number, y: number, z: number, w: number): Vec4 => ({ x, y, z, w });
export const ZERO4: Vec4 = vec4(0, 0, 0, 0);

// MARK: - 2-D vector arithmetic (SIMD2)

export const v2 = (x: number, y: number): Point => ({ x, y });
export const ZERO2: Point = v2(0, 0);
export const add2 = (a: Point, b: Point): Point => v2(a.x + b.x, a.y + b.y);
export const sub2 = (a: Point, b: Point): Point => v2(a.x - b.x, a.y - b.y);
export const scale2 = (a: Point, k: number): Point => v2(a.x * k, a.y * k);
export const dot2 = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
export const length2 = (a: Point): number => Math.sqrt(a.x * a.x + a.y * a.y);
export const same2 = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

/**
 * Where a play's decisive moment comes from: a play the feed logged, a rule
 * that inferred it from known plays, or filler that changes nothing the data says.
 */
export type Provenance =
  | { readonly kind: "known"; readonly play: string }
  | { readonly kind: "inferred"; readonly rule: string; readonly from: readonly string[] }
  | { readonly kind: "ambient" };

/** A closed range (Swift's `ClosedRange<PTime>`). */
export interface Span {
  readonly lower: number;
  readonly upper: number;
}

/** Where a known play's decisive moment lands on p. */
export interface PlayAnchor {
  readonly at: PTime;
  /** Where it may slide (a point for a hard anchor). */
  readonly window: Span;
  readonly hard: boolean;
  /** A declared catch-up: how much later than the data puts it the moment is told (0: on time). */
  readonly slip: number;
}

export const playAnchor = (at: PTime): PlayAnchor => ({ at, window: { lower: at, upper: at }, hard: true, slip: 0 });

/** The engine's timing rules that aren't per sport (CHOREOGRAPHY §4.5–§4.6; tune). */
export const TheaterTiming = {
  /** The commit point's lead over now: the bake runs in it. */
  commitLead: 0.25,
  /** A late play's decisive moment may slip this much, quietly (a declared micro catch-up). */
  microCatchUp: 1.5,
  /** Plans wholly before p less this are dropped from the chain. */
  keepBehind: 2.0,
  /** Baked tracks' rate. */
  rate: 60,
  /**
   * The receding horizon (§4.5, §8.1): a plan places the plays whose moments
   * fall this far past its splice and bakes about as far; the plan before
   * its horizon runs out reaches the rest.
   */
  planAhead: 30,
} as const;

// MARK: - Motion limits

/** How fast, how hard and how sharply a figure may move, by role (`MotionLimits.Band`). */
export interface Band {
  walk: number;
  jog: number;
  run: number;
  sprint: number;
  /** Over the sprint cap by this share, for at most `overspeedFor` seconds (logged). */
  overspeed: number;
  overspeedFor: number;
  accel: number;
  decel: number;
  lateral: number;
}

const band = (walk: number, jog: number, run: number, sprint: number, overspeed: number, overspeedFor: number, accel: number, decel: number, lateral: number): Band => ({
  walk,
  jog,
  run,
  sprint,
  overspeed,
  overspeedFor,
  accel,
  decel,
  lateral,
});

/**
 * How fast, how hard and how sharply a figure may move (CHOREOGRAPHY
 * §5.5.2), in the field's units and p-seconds; by role.
 */
export class MotionLimits {
  constructor(
    readonly bands: Readonly<Record<string, Band>>,
    /** The body's radius for collisions. */
    readonly bodyRadius: number,
    /** A rest-to-rest move longer than this cruises (ramp, cruise, ramp) instead of one easing. */
    readonly cruiseOver: number,
    /** The fallback band for a role the table doesn't name. */
    readonly standard: string,
  ) {}

  /** A copy of the role's band (the splice eases it for a gentle travel). */
  band(role: string): Band {
    return { ...(this.bands[role] ?? this.bands[this.standard]!) };
  }

  /** The fastest anyone may go at all (the hard-cut threshold's scale). */
  get fastest(): number {
    let most = 0;
    for (const b of Object.values(this.bands)) most = Math.max(most, b.sprint * (1 + b.overspeed));
    return most;
  }

  // The tables (all tune; drawn heights read ~20% faster on screen than court feet). Speed is the limit people can
  // see. The pushes are what looks right for athletes in a scripted animation, read off what they do: an NFL receiver
  // takes about 3 s to reach his top speed, but his first steps are explosive (about 1 g, and 40-yard splits put him
  // past 25 ft/s by 10 yards); stopping and cutting are harder than starting.

  static readonly basketball = new MotionLimits(
    {
      guard: band(4.5, 10, 16, 25, 0.12, 0.6, 30, 36, 32),
      wing: band(4.5, 10, 16, 25, 0.12, 0.6, 30, 36, 32),
      big: band(4.5, 10, 16, 22, 0.12, 0.6, 26, 32, 28),
      official: band(4.5, 10, 16, 22, 0.12, 0.6, 26, 32, 28),
    },
    1.0,
    12,
    "wing",
  );

  static readonly football = new MotionLimits(
    {
      skill: band(4.5, 10, 20, 32, 0.1, 0.8, 34, 40, 44),
      line: band(4.5, 10, 20, 24, 0.1, 0.8, 28, 34, 36),
      official: band(4.5, 10, 20, 24, 0.1, 0.8, 28, 34, 36),
    },
    1.0,
    20,
    "skill",
  );

  static readonly soccer = new MotionLimits(
    {
      outfield: band(1.4, 3.5, 6.0, 9.0, 0.1, 0.8, 8.0, 9.0, 8.0),
      keeper: band(1.4, 3.5, 6.0, 7.5, 0.1, 0.8, 8.0, 9.0, 8.0),
      official: band(1.4, 3.5, 6.0, 7.5, 0.1, 0.8, 6.5, 8.0, 7.0),
    },
    0.35,
    6,
    "outfield",
  );

  /** Baseball keeps today's approved compressed play pace (§11.4): its limits scale by the pace factor. */
  static baseball(pace = 1): MotionLimits {
    const scaled = (b: Band): Band =>
      band(b.walk * pace, b.jog * pace, b.run * pace, b.sprint * pace, b.overspeed, b.overspeedFor, b.accel * pace * pace, b.decel * pace * pace, b.lateral * pace * pace);
    return new MotionLimits(
      {
        runner: scaled(band(4.5, 10, 20, 28, 0, 0, 30, 36, 32)),
        fielder: scaled(band(4.5, 10, 20, 27, 0, 0, 30, 36, 32)),
        official: scaled(band(4.5, 10, 20, 27, 0, 0, 26, 32, 28)),
      },
      1.0,
      20,
      "fielder",
    );
  }
}

// MARK: - Keys, cues, notes

/** How a figure passes a key (`MotionKey.Kind`): `contact` is a meeting with another figure (C² waived there). */
export type MotionKeyKind = "through" | "arrive" | "depart" | { readonly contact: ActorID };

/**
 * A keyframe for one figure (CHOREOGRAPHY §5.5.1). Hard keys come from the
 * splice and from anchors; soft keys from tactics, and may slide in their window.
 */
export interface MotionKey {
  t: PTime;
  at: Point;
  kind: MotionKeyKind;
  velocity?: Point | null;
  acceleration?: Point | null;
  window?: Span | null;
  radius?: number;
  hard: boolean;
}

export const isRestKind = (k: MotionKeyKind): boolean => k === "arrive" || k === "depart";

/** A timed presentation event (CHOREOGRAPHY §5.6.5): the stamp, a banner, the score changing. */
export type CueKind =
  | { readonly kind: "stamp"; readonly text: string }
  | { readonly kind: "banner"; readonly text: string; readonly tone: number; readonly confetti: boolean }
  | { readonly kind: "flash"; readonly tone: number; readonly at: FieldPoint }
  | { readonly kind: "net"; readonly strength: number }
  | { readonly kind: "status"; readonly text: string | null }
  | { readonly kind: "celebrate"; readonly text: string }
  /** The scoring play's decisive moment: the score changes, the slide lands (BROADCAST §3). */
  | { readonly kind: "scored"; readonly play: string }
  | { readonly kind: "replayIn" }
  | { readonly kind: "replayOut" };

export interface Cue {
  readonly at: PTime;
  readonly until: PTime;
  readonly kind: CueKind;
  readonly source: Provenance;
}

/** What the bench reports about a plan: catch-ups, overspeeds, slips. */
export type PlanNoteKind =
  /** A decisive moment told later than its anchor (seconds). */
  | { readonly kind: "catchUp"; readonly play: string; readonly late: number }
  /** A figure over his sprint cap (the share over), for how long. */
  | { readonly kind: "overspeed"; readonly actor: ActorID; readonly over: number; readonly seconds: number }
  /** A transition that couldn't fit its window and took longer. */
  | { readonly kind: "stretched"; readonly actor: ActorID; readonly seconds: number }
  /** Two figures still overlapping after the collision pass. */
  | { readonly kind: "overlap"; readonly a: ActorID; readonly b: ActorID };

export interface PlanNote {
  readonly at: PTime;
  readonly kind: PlanNoteKind;
}

// MARK: - World state (the splice source)

/** The ball as the splice carries it: where, how fast, and in whose hands. */
export interface BallState {
  readonly position: FieldPoint;
  readonly velocity: FieldPoint;
  readonly holder: ActorID | null;
}

/**
 * The camera as one operator for the session (CHOREOGRAPHY §5.6.1): the
 * ground point at the view's center, the span (field units top to bottom,
 * kept in log space so zooms feel even), the yaw, and their velocities.
 */
export interface CameraState {
  /** x, y of the center on the ground (world frame), log of the span, yaw (radians). */
  readonly value: Vec4;
  readonly velocity: Vec4;
}

export const cameraState = (center: Point, span: number, yaw: number, velocity: Vec4 = ZERO4): CameraState => ({
  value: vec4(center.x, center.y, Math.log(Math.max(span, 1e-6)), yaw),
  velocity,
});

/** One figure as the splice carries him. */
export interface ActorState {
  readonly id: ActorID;
  readonly position: Point;
  readonly velocity: Point;
  readonly acceleration: Point;
  readonly rig: RigCarry;
  readonly opacity: number;
}

/** Everything on screen at one p, exactly: what a new plan starts from. */
export class WorldState {
  constructor(
    readonly at: PTime,
    /** Sorted by id. */
    readonly actors: readonly ActorState[],
    readonly ball: BallState | null,
    readonly camera: CameraState,
    /** Live at `at`. */
    readonly cues: readonly Cue[] = [],
  ) {}

  actor(id: ActorID): ActorState | null {
    let lo = 0;
    let hi = this.actors.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.actors[mid]!.id < id) lo = mid + 1;
      else hi = mid;
    }
    const a = this.actors[lo];
    return a && a.id === id ? a : null;
  }
}

// MARK: - Curves and hashing (pure, portable)

/** A cubic-bezier's coordinate at s (module-level, so a frame's easing allocates nothing). */
function coordinate(s: number, a: number, b: number): number {
  const k = 1 - s;
  return 3 * k * k * s * a + 3 * k * s * s * b + s * s * s;
}

function slope(s: number, a: number, b: number): number {
  const k = 1 - s;
  return 3 * k * k * a + 6 * k * s * (b - a) + 3 * s * s * (1 - b);
}

export const TheaterCurve = {
  /** A CSS cubic-bezier easing (x1, y1, x2, y2) at u in 0…1: x solved by Newton's method, then y. */
  bezier(x1: number, y1: number, x2: number, y2: number, raw: number): number {
    const u = Math.min(Math.max(raw, 0), 1);
    if (u === 0 || u === 1) return u;
    let s = u;
    for (let i = 0; i < 8; i++) {
      const dx = coordinate(s, x1, x2) - u;
      if (Math.abs(dx) < 1e-7) break;
      const d = slope(s, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      s = Math.min(Math.max(s - dx / d, 0), 1);
    }
    // A few bisection steps settle any case Newton's left close.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20 && Math.abs(coordinate(s, x1, x2) - u) > 1e-7; i++) {
      s = (lo + hi) / 2;
      if (coordinate(s, x1, x2) < u) lo = s;
      else hi = s;
    }
    return coordinate(s, y1, y2);
  },

  /** On-screen movement eases in and out: the house curve, cubic-bezier(0.77, 0, 0.175, 1). */
  inOut(u: number): number {
    return TheaterCurve.bezier(0.77, 0, 0.175, 1, u);
  },

  /** Entrances ease out: cubic-bezier(0.23, 1, 0.32, 1). */
  out(u: number): number {
    return TheaterCurve.bezier(0.23, 1, 0.32, 1, u);
  },
};

const MASK64 = (1n << 64n) - 1n;
const UTF8 = new TextEncoder();

export const TheaterHash = {
  /** FNV-1a of a string: stable across runs and platforms. */
  of(text: string): bigint {
    let hash = 0xcbf29ce484222325n;
    for (const byte of UTF8.encode(text)) {
      hash ^= BigInt(byte);
      hash = (hash * 0x100000001b3n) & MASK64;
    }
    return hash;
  },

  /** Mixes a value's 64 bits into a running FNV-1a hash (the bench's determinism check). */
  mix(hash: bigint, bits: bigint): bigint {
    let h = hash;
    for (let k = 0n; k < 8n; k++) {
      h ^= (bits >> (8n * k)) & 0xffn;
      h = (h * 0x100000001b3n) & MASK64;
    }
    return h;
  },
};

/** IEEE 754 remainder (Swift's `remainder`), re-exported from the rig for the engine's angles. */
export { remainder } from "./rig";
