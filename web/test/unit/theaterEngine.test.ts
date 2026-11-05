/**
 * The choreography engine's core (TheaterEngineTests.swift, check by check,
 * the same thresholds; CHOREOGRAPHY §9.3): the anchor solver
 * (pool-adjacent-violators with gaps, ties spread, a stoppage's backdated
 * plays placed back from the restart, a frozen prefix), the quintic layer
 * (continuity at every key, the closed-form shortest move, retiming within
 * the limits, the cruise), the splice (a new plan reproduces the world it
 * starts from exactly: positions, velocities, accelerations, the stride with
 * its planted feet), the stride carried across it with no foot slip, the
 * camera's yaw (hysteresis, its dwell, critically damped and capped),
 * retiming as built (a travel always on time, pulling up before turning, a
 * run that beats the legs given its time), and the frame tiers and the one
 * wake from still.
 */
import { describe, expect, it } from "vitest";
import type { Point } from "../../src/data/mlb/theaterField";
import { Hoops } from "../../src/data/theater/basketballScript";
import { remainder, RigTrack, standingCarry } from "../../src/data/theater/rig";
import { AnchorSolver, anchorInput, type AnchorInput } from "../../src/data/theater/theaterAnchors";
import { CameraOperator, YawRule } from "../../src/data/theater/theaterCamera";
import { ClipPaths, ClipPlacement, Splice, type ClipBall, type ClipFigure, type TheaterClip } from "../../src/data/theater/theaterClips";
import { TheaterTime } from "../../src/data/theater/theaterDirector";
import { cameraState, length2, MotionLimits, sub2, v2, vec4, ZERO2, type ActorID, type MotionKey, type PTime, type Span, type Vec4 } from "../../src/data/theater/theaterEngine";
import { MotionPath, Quintic, TheaterMotion } from "../../src/data/theater/theaterMotion";
import { Plan, PlanChain, TheaterBake, type FrameTier } from "../../src/data/theater/theaterPlanChain";
import type { ClockEvent, ClockPiece, ClockRegime, TheaterClock } from "../../src/data/theater/theaterSource";
import { TheaterFrameGate } from "../../src/data/theater/theaterView";

const RIGHT = -Hoops.turn;
const basketballYaw = new YawRule(Hoops.length / 2, 6, 2, -Hoops.turn, Hoops.turn);

/** A clip for the tests: each figure on a straight line at its own speed from its own start, the camera on the first. */
class LineClip implements TheaterClip {
  length = 20;
  essential = 0;
  ambient = false;
  reportsMotion = true;
  decisive: number | null = 5;
  constructor(
    readonly starts: Point[],
    readonly velocities: Point[],
    readonly still = 0,
  ) {}
  get figures(): ClipFigure[] {
    return this.starts.map((_, i) => ({ group: i % 2, kind: "player", athlete: null, band: "wing", height: Hoops.ground }));
  }
  position(i: number, t: number): Point {
    const s = this.starts[i]!;
    const v = this.velocities[i]!;
    const dt = Math.max(t - this.still, 0);
    return v2(s.x + v.x * dt, s.y + v.y * dt);
  }
  heading(i: number): number {
    const v = this.velocities[i]!;
    return length2(v) > 0 ? Math.atan2(v.y, v.x) : 0;
  }
  opacity(): number {
    return 1;
  }
  ball(): ClipBall {
    return { kind: "held", figure: 0 };
  }
  camera(t: number): Vec4 {
    const p = this.position(0, t);
    return vec4(p.x, p.y, Math.log(40), RIGHT);
  }
  moving(): boolean {
    return this.reportsMotion;
  }
}

function play(id: string, w: PTime | null, g: number | null, o: { live?: boolean; stops?: boolean; weight?: number; gap?: number; bounds?: Span; restart?: number } = {}): AnchorInput {
  return anchorInput({
    id,
    period: 4,
    eventTime: w,
    bounds: o.bounds ?? null,
    elapsed: g,
    live: o.live ?? true,
    stopsClock: o.stops ?? false,
    weight: o.weight ?? 1,
    gapAfter: o.gap ?? 0.15,
    restartAfter: o.restart ?? 1,
  });
}

describe("the anchor solver", () => {
  it("pool-adjacent-violators: the nearest nondecreasing sequence, weights pulling the pooled mean", () => {
    const iso = AnchorSolver.isotonic([3, 1, 2], [1, 1, 1]);
    expect(iso.every((x) => Math.abs(x - 2) < 1e-12), `${iso}`).toBe(true);
    const weighted = AnchorSolver.isotonic([4, 0], [3, 1]);
    expect(Math.abs(weighted[0]! - 3) < 1e-12 && Math.abs(weighted[1]! - 3) < 1e-12).toBe(true);
  });

  it("a tied miss and rebound are spread by the gap, centered on their second", () => {
    const tie = AnchorSolver.solve([play("miss", 1000, 300, { gap: 1.0 }), play("board", 1000, 300)]);
    const a = tie.get("miss")!.at;
    const b = tie.get("board")!.at;
    expect(Math.abs(b - a - 1.0) < 1e-9 && Math.abs((a + b) / 2 - 1000) < 1e-9, `${a - 1000}, ${b - 1000}`).toBe(true);
  });

  it("inside a running stretch the game clock times the plays (one offset for all)", () => {
    const stretch = AnchorSolver.solve([play("a", 1000, 100.4), play("b", 1003, 102.9), play("c", 1005, 105.2)]);
    const offsets = ["a", "b", "c"].map((id, i) => stretch.get(id)!.at - [100.4, 102.9, 105.2][i]!);
    expect(offsets.length === 3 && offsets.every((o) => Math.abs(o - offsets[0]!) < 1e-9), `${offsets}`).toBe(true);
  });

  it("a stoppage's plays go back from the restart by their gaps (the last a second before it), never collapsed onto the whistle's stamp", () => {
    // The foul stops the clock; the free throws and a substitution are stamped with the whistle's second, though they
    // happened just before play resumed; the next stretch says when that was.
    const cluster = AnchorSolver.solve([
      play("drive", 995, 495),
      play("foul", 1000, 500, { live: false, stops: true, weight: 0.75, gap: 2 }),
      play("ft1", 1000, 500, { live: false, stops: true, gap: 6 }),
      play("sub", 1000, 500, { live: false, stops: true, weight: 0, gap: 2 }),
      play("ft2", 1000, 500, { live: false, stops: true, gap: 0.15 }),
      play("shot", 1300, 510),
    ]);
    const restart = 1300 - 510 + 500;
    const ft1 = cluster.get("ft1")!.at;
    const sub = cluster.get("sub")!.at;
    const ft2 = cluster.get("ft2")!.at;
    const foul = cluster.get("foul")!.at;
    expect(Math.abs(ft2 - (restart - 1)) < 1e-6 && ft1 < sub && sub < ft2 && ft2 - ft1 >= 8 - 1e-9, `ft1 ${ft1 - restart}, sub ${sub - restart}, ft2 ${ft2 - restart}`).toBe(true);
    expect(ft1 > foul + 200 && Math.abs(foul - 1000) < 1e-6, `foul ${foul - 1000}, ft1 ${ft1 - 1000}`).toBe(true);
  });

  it("with the timeline's bounds: the rebound that restarts the clock at the restart, the free throw a carom before it", () => {
    const bounded = AnchorSolver.solve([
      play("foul", 1000, 500, { live: false, stops: true, weight: 0.75, gap: 2 }),
      play("ft", 1000, 500, { live: false, stops: true, gap: 0.9, bounds: { lower: 1000, upper: 1200 } }),
      play("board", 1000, 500, { live: true, gap: 0.15, bounds: { lower: 1000, upper: 1200 }, restart: 0 }),
    ]);
    expect(Math.abs((bounded.get("board")?.at ?? 0) - 1200) < 1e-6).toBe(true);
    expect(Math.abs((bounded.get("ft")?.at ?? 0) - 1199.1) < 1e-6).toBe(true);
  });

  it("a frozen anchor holds and the rest keep its gap after it", () => {
    const frozen = AnchorSolver.solve([play("a", 1000, 100, { gap: 1 }), play("b", 1000.2, 100.2), play("c", 1001, 101)], new Map([["a", 1003]]));
    expect(frozen.get("a")?.at).toBe(1003);
    expect(frozen.get("b")!.at).toBeGreaterThanOrEqual(1004 - 1e-9);
    expect(frozen.get("c")!.at).toBeGreaterThan(frozen.get("b")!.at);
  });
});

describe("the quintic layer", () => {
  const band = MotionLimits.basketball.band("wing");

  it("quintic segments meet C² at every key; an arrival ends exactly there, at rest", () => {
    const keys: MotionKey[] = [
      { t: 0, at: v2(0, 0), kind: "depart", hard: true },
      { t: 1.2, at: v2(8, 3), kind: "through", hard: false },
      { t: 2.0, at: v2(12, 10), kind: "through", hard: false },
      { t: 3.4, at: v2(20, 10), kind: "arrive", hard: true },
    ];
    const path = TheaterMotion.path(keys, band);
    let seam = 0;
    for (let k = 1; k < path.segments.length; k++) {
      const a = path.segments[k - 1]!;
      const b = path.segments[k]!;
      seam = Math.max(
        seam,
        length2(sub2(a.position(a.t1), b.position(b.t0))),
        length2(sub2(a.velocity(a.t1), b.velocity(b.t0))),
        length2(sub2(a.acceleration(a.t1), b.acceleration(b.t0))),
      );
    }
    expect(path.segments.length).toBe(3);
    expect(seam, `seam ${seam}`).toBeLessThan(1e-9);
    expect(length2(sub2(path.position(3.4), v2(20, 10)))).toBeLessThan(1e-9);
    expect(length2(path.velocity(3.4))).toBeLessThan(1e-9);
  });

  it("the closed-form shortest move is just inside the limits (any quicker breaks them)", () => {
    const d = 30;
    const T = TheaterMotion.shortest(d, band);
    const rest = new MotionPath([new Quintic(0, T, ZERO2, ZERO2, ZERO2, v2(d, 0), ZERO2, ZERO2)]);
    const over = Math.max(0, ...TheaterMotion.violations(rest, 0, T, band).map((v) => v.over));
    const under = TheaterMotion.violations(new MotionPath([new Quintic(0, T * 0.9, ZERO2, ZERO2, ZERO2, v2(d, 0), ZERO2, ZERO2)]), 0, T * 0.9, band);
    expect(over, `over ${over}`).toBeLessThan(0.01);
    expect(under.length).toBeGreaterThan(0);
  });

  it("a travel from a man running the other way starts from his velocity and acceleration, and is timed by his limits", () => {
    const v0 = v2(-12, 4);
    const a0 = v2(3, 0);
    const need = TheaterMotion.shortestTravel(ZERO2, v0, a0, v2(24, -6), ZERO2, ZERO2, band, 12);
    const fits = TheaterMotion.travel(ZERO2, v0, a0, 0, v2(24, -6), ZERO2, ZERO2, need, band, 12);
    const tight = TheaterMotion.travel(ZERO2, v0, a0, 0, v2(24, -6), ZERO2, ZERO2, need * 0.85, band, 12);
    expect(TheaterMotion.violations(fits, 0, need, band)).toEqual([]);
    expect(TheaterMotion.violations(tight, 0, need * 0.85, band).length).toBeGreaterThan(0);
    expect(length2(sub2(fits.velocity(0), v0))).toBeLessThan(1e-9);
    expect(length2(sub2(fits.acceleration(0), a0))).toBeLessThan(1e-9);
  });

  it("a long move with time to spare ramps to an easy cruise and back (never a sprint it doesn't need)", () => {
    const long = TheaterMotion.travel(ZERO2, ZERO2, ZERO2, 0, v2(60, 0), ZERO2, ZERO2, 9, band, 12);
    let peak = 0;
    for (let t = 0; t <= 9; t += 1 / 60) peak = Math.max(peak, length2(long.velocity(t)));
    expect(long.segments.length).toBe(3);
    expect(peak, `peak ${peak} ft/s`).toBeLessThan(band.run);
    expect(length2(sub2(long.position(9), v2(60, 0)))).toBeLessThan(1e-6);
    expect(TheaterMotion.violations(long, 0, 9, band)).toEqual([]);
  });

  it("two men who'd run through each other: the lower-priority one steps round", () => {
    const lanes: MotionKey[][] = [
      [
        { t: 0, at: v2(0, 0), kind: "depart", hard: true },
        { t: 2, at: v2(20, 0), kind: "arrive", hard: true },
      ],
      [
        { t: 0, at: v2(20, 0.2), kind: "depart", hard: true },
        { t: 2, at: v2(0, 0.2), kind: "arrive", hard: true },
      ],
    ];
    const separated = TheaterMotion.separate(lanes, [band, band], [1, 0], 0, 2, 1);
    expect(separated.residual).toEqual([]);
    expect(separated.keys[1]!.length).toBe(3);
    expect(separated.keys[0]!.length).toBe(2);
  });
});

describe("the splice", () => {
  it("reproduces the world it starts from, carries the stride and the camera across, and nothing slides", () => {
    // A first plan: two men running, one standing.
    const first = new LineClip([v2(20, 20), v2(40, 30), v2(60, 25)], [v2(9, 2), v2(-7, 0), ZERO2]);
    const ids: ActorID[] = [1, 2, 3];
    const actors = new Map<ActorID, ClipFigure>();
    ids.forEach((id, i) => actors.set(id, first.figures[i]!));
    const p0 = 1_000_000;
    const plan0 = new Plan<LineClip>(1, p0, p0 + 12, null, [new ClipPlacement(first, p0, p0, ids)], actors);
    const chain = new PlanChain<LineClip>();
    chain.splice(TheaterBake.bake(plan0), p0);
    // The splice: a second clip asks everyone somewhere else, met from the world as it stands.
    const c = chain.commit(p0 + 4.03);
    const state = chain.state(c);
    expect(state, "the chain has a state to splice from").not.toBeNull();
    const second = new LineClip([v2(70, 10), v2(30, 40), v2(62, 26)], [ZERO2, v2(3, 0), ZERO2], 2.5);
    const next = { next: 10 };
    // (Time enough for the first man to turn out of his run and get there: the ramp allows for the turn.)
    const meeting = Splice.meet(
      second,
      c + 1.0,
      c,
      MotionLimits.basketball,
      next,
      (t) =>
        ids.flatMap((id) => {
          const a = chain.state(t)?.actor(id);
          return a ? [{ state: a, figure: actors.get(id)! }] : [];
        }),
      new Map([
        [0, ids[0]!],
        [1, ids[1]!],
        [2, ids[2]!],
      ]),
    );
    const plan1 = new Plan<LineClip>(2, c, c + 30, state, [], actors);
    plan1.history = chain.history(c);
    const placement = new ClipPlacement(second, meeting.offset, meeting.start, meeting.cast);
    placement.travel = meeting.travel;
    placement.join = meeting.join;
    plan1.placements = [new ClipPlacement(first, p0, p0, ids), placement];
    const baked1 = TheaterBake.bake(plan1);
    // The new plan reproduces the world at c exactly.
    let worst = 0;
    for (const a of state!.actors) {
      const m = plan1.motion(a.id, c);
      if (!m) {
        worst = Infinity;
        continue;
      }
      worst = Math.max(worst, length2(sub2(m.position, a.position)), length2(sub2(m.velocity, a.velocity)) * 0.1, length2(sub2(m.acceleration, a.acceleration)) * 0.01);
    }
    expect(worst, `worst ${worst}`).toBeLessThan(1e-6);
    // The stride carries on: the same phase, heading and planted feet at c.
    let stride = 0;
    let feet = 0;
    for (const id of ids) {
      const old = chain.plan(c)?.track(id);
      const fresh = baked1.track(id);
      if (!old || !fresh) {
        stride = Infinity;
        continue;
      }
      const a = old.rig.carry(c);
      const b = fresh.rig.carry(c);
      stride = Math.max(stride, Math.abs(a.phase - b.phase), Math.abs(remainder(a.heading - b.heading, 2 * Math.PI)));
      for (const [x, y] of [
        [a.left, b.left],
        [a.right, b.right],
      ] as const) {
        if (x.lift === Infinity) feet = Math.max(feet, Math.hypot(x.at.x - y.at.x, x.at.y - y.at.y));
      }
    }
    expect(stride, `stride ${stride}`).toBeLessThan(1e-5);
    expect(feet, `feet ${feet}`).toBe(0);
    // No foot slides across the splice: each planted foot stays put frame to frame through it.
    chain.splice(baked1, c);
    let slip = 0;
    const previous = new Map<ActorID, [Point, Point, [boolean, boolean]]>();
    for (let t = c - 0.5; t < c + 1.5; t += 1 / 60) {
      for (const id of ids) {
        const track = chain.plan(t)?.track(id);
        if (!track) continue;
        const m = track.rig.motion(t);
        const at = track.position(t);
        const now = track.rig.feet(t, at, m.heading, 1, m.speed, { left: { x: 0, y: 0.1, z: 0 }, right: { x: 0, y: -0.1, z: 0 } });
        const world = (f: { x: number; y: number }): Point => v2(at.x + f.x * Math.cos(m.heading) - f.y * Math.sin(m.heading), at.y + f.x * Math.sin(m.heading) + f.y * Math.cos(m.heading));
        const planted = track.rig.planted(t);
        const here: [Point, Point, [boolean, boolean]] = [world(now.left), world(now.right), [planted.left && now.left.z === 0, planted.right && now.right.z === 0]];
        const was = previous.get(id);
        if (was && m.weight > 0.5) {
          if (here[2][0] && was[2][0]) slip = Math.max(slip, Math.hypot(here[0].x - was[0].x, here[0].y - was[0].y));
          if (here[2][1] && was[2][1]) slip = Math.max(slip, Math.hypot(here[1].x - was[1].x, here[1].y - was[1].y));
        }
        previous.set(id, here);
      }
    }
    expect(slip, `slip ${slip} ft`).toBeLessThan(1e-6);
    expect(meeting.slip, `slip ${meeting.slip}`).toBeLessThan(0.05);
    expect(meeting.travel.size).toBe(3);
    // The camera carries its velocity across.
    const cam0 = chain.plans[0]!.cameraState(c);
    const cam1 = baked1.cameraState(c);
    const d = Math.hypot(cam0.value.x - cam1.value.x, cam0.value.y - cam1.value.y, cam0.value.z - cam1.value.z, cam0.value.w - cam1.value.w);
    expect(d, `${JSON.stringify(cam0.value)} vs ${JSON.stringify(cam1.value)}`).toBeLessThan(1e-3);
  });
});

describe("the camera's yaw", () => {
  it("the ball wandering inside ±6 ft of half court never turns the camera", () => {
    const wobble = basketballYaw.targets(basketballYaw.high, -10, 0, 10, (t) => 47 + 5 * Math.sin(t * 2));
    expect(wobble.length - 1).toBe(0);
  });

  it("the yaw turns when the ball crosses the band, and not again for two seconds", () => {
    const back = basketballYaw.targets(basketballYaw.high, -10, 0, 6, (t) => (t < 1 ? 60 : t < 1.5 ? 30 : 60));
    expect(back.length).toBe(3);
    expect(Math.abs(back[1]!.at - 1)).toBeLessThan(0.02);
    expect(Math.abs(back[2]!.at - 3)).toBeLessThan(0.02);
  });

  it("a change of ends orbits the camera smoothly: critically damped, never past 45°/s", () => {
    const op = new CameraOperator(cameraState(v2(47, 25), 40, basketballYaw.high));
    let peak = 0;
    let overshoot = 0;
    for (let i = 0; i < 600; i++) {
      op.step(vec4(47, 25, Math.log(40), basketballYaw.low), vec4(0, 0, 0, 0), 1 / 60);
      peak = Math.max(peak, Math.abs(op.state.velocity.w));
      overshoot = Math.max(overshoot, op.state.value.w - basketballYaw.low);
    }
    expect(peak, `peak ${(peak * 180) / Math.PI}°/s`).toBeLessThanOrEqual((45 * Math.PI) / 180 + 1e-9);
    expect(overshoot).toBeLessThan(1e-6);
    expect(Math.abs(op.state.value.w - basketballYaw.low)).toBeLessThan(1e-3);
  });
});

/**
 * Retiming (§5.5.4 as built): a travel always lands on time; a man running the wrong way pulls up first; a run
 * that beats the legs gets its time (contacts unmoved); a clip's time stretches until nobody outruns his legs.
 */
describe("retiming", () => {
  const band = MotionLimits.basketball.band("wing");
  const peak = (keys: readonly MotionKey[]) => {
    const path = TheaterMotion.path(keys, band);
    let most = 0;
    for (let t = path.start; t <= path.end; t += 1 / 240) most = Math.max(most, length2(path.velocity(t)));
    return most;
  };
  const key = (t: number, x: number, y: number, kind: MotionKey["kind"], hard = false): MotionKey => ({ t, at: v2(x, y), kind, hard });

  it("a travel short of time still arrives on time, at rest (no man is left behind at the join)", () => {
    const rushed = TheaterMotion.travel(ZERO2, v2(10, 0), ZERO2, 2, v2(60, 20), ZERO2, ZERO2, 0.8, band, 12);
    expect(length2(sub2(rushed.position(2.8), v2(60, 20)))).toBeLessThan(1e-6);
    expect(length2(rushed.velocity(2.8))).toBeLessThan(1e-6);
  });

  it("a man sprinting the wrong way pulls up, then comes back, inside his limits and in a few seconds", () => {
    const v0 = v2(-22, 6);
    const need = TheaterMotion.shortestTravel(ZERO2, v0, ZERO2, v2(14, 0), ZERO2, ZERO2, band, 12);
    const back = TheaterMotion.travel(ZERO2, v0, ZERO2, 0, v2(14, 0), ZERO2, ZERO2, need, band, 12);
    expect(need, `need ${need} s`).toBeLessThan(6);
    expect(TheaterMotion.violations(back, 0, need, band)).toEqual([]);
    expect(length2(sub2(back.position(need), v2(14, 0)))).toBeLessThan(1e-6);
  });

  it("a run faster than the legs gets the time it needs (he arrives later); the catch stays exactly when and where it was, inside his sprint", () => {
    const keys = [key(0, 0, 0, "depart"), key(0.3, 30, 0, "arrive"), key(3.2, 30, 0, "depart"), key(3.6, 34, 4, "through", true), key(4.5, 36, 4, "arrive")];
    const later = ClipPaths.solved(keys, band, { lower: 0, upper: 6 });
    const arrived = later.find((k) => k.kind === "arrive")?.t ?? 0;
    expect(arrived, `${later.map((k) => k.t)}`).toBeGreaterThanOrEqual(ClipPaths.least(30, true, true, band) - 1e-9);
    expect(later.some((k) => k.hard && k.t === 3.6 && k.at.x === 34 && k.at.y === 4)).toBe(true);
    expect(peak(later), `peak ${peak(later)}`).toBeLessThanOrEqual(band.sprint * 1.02);
  });

  it("a spot he can't reach and isn't credited with: he ends short, and carries on from where he got to", () => {
    const short = ClipPaths.solved([key(0, 0, 0, "depart"), key(0.5, 100, 0, "arrive"), key(0.6, 100, 0, "depart"), key(4, 110, 0, "arrive")], band, { lower: 0, upper: 4 });
    const stopped = short.find((k) => k.kind === "arrive")?.at.x ?? 100;
    expect(stopped, `got to ${stopped}`).toBeLessThan(30);
    expect(short.find((k) => k.kind === "depart" && k.t > 0.1)?.at.x).toBe(stopped);
    expect(peak(short), `peak ${peak(short)}`).toBeLessThanOrEqual(band.sprint * 1.02);
  });

  it("the reset's far men start back and are still on their way as the clip ends: no glide, no stop", () => {
    const open = ClipPaths.solved([key(5, 0, 0, "depart"), key(5.75, 139, 0, "arrive")], band, { lower: 5, upper: 5.75 });
    const last = open[open.length - 1]!;
    expect(last.velocity ? length2(last.velocity) : 0).toBeGreaterThan(band.jog);
    expect(last.at.x, `${last.at.x}`).toBeLessThan(30);
    expect(peak(open)).toBeLessThanOrEqual(band.sprint * 1.02);
  });

  it("a credited man too far off starts nearer, and meets the ball exactly", () => {
    const meets = ClipPaths.solved([key(0, 0, 0, "depart"), key(0.6, 60, 0, "through", true), key(2, 70, 0, "arrive")], band, { lower: 0, upper: 2 });
    expect(meets[0]!.at.x, `starts ${meets[0]!.at.x}`).toBeGreaterThan(0);
    expect(meets.some((k) => k.hard && k.t === 0.6 && k.at.x === 60 && k.at.y === 0)).toBe(true);
    expect(peak(meets), `peak ${peak(meets)}`).toBeLessThanOrEqual(band.sprint * 1.1);
  });

  it("two contacts too close: the ball wins", () => {
    const both = [key(1, 0, 0, "through", true), key(1.2, 60, 0, "through", true)];
    expect(ClipPaths.solved(both, band, { lower: 0, upper: 2 }).map((k) => k.at)).toEqual(both.map((k) => k.at));
  });

  it("a long run keeps its time as a run, not one long easing", () => {
    const long = ClipPaths.solved([key(0, 0, 0, "depart"), key(4, 60, 0, "arrive")], band, { lower: 0, upper: 4 });
    expect(long.length, `${long.map((k) => k.t)}`).toBeGreaterThan(2);
    expect(peak(long), `peak ${peak(long)}`).toBeLessThanOrEqual(band.sprint * 1.001);
    expect(long[0]!.t).toBe(0);
    expect(long[long.length - 1]!.t).toBe(4);
  });
});

// MARK: - Frame tiers and the one wake (presentationFrameTiers, theaterFrameGate)

/** A presentation clock of given pieces (the theater reads only these). */
class PieceClock implements TheaterClock {
  constructor(
    readonly pieces: ClockPiece[],
    readonly regime: ClockRegime,
    readonly events: ClockEvent[],
  ) {}
  get started(): boolean {
    return this.pieces.length > 0;
  }
  p(t: PTime): PTime {
    const first = this.pieces[0];
    if (!first) return -Infinity;
    if (t < first.t0) return first.p(t);
    const piece = this.pieces.findLast((x) => x.t0 <= t) ?? first;
    return piece.p(t);
  }
}

const piece = (t0: number, p0: number, v0: number, a = 0, t1 = Infinity): ClockPiece => ({
  t0,
  p0,
  v0,
  a,
  t1,
  p(t: number) {
    const dt = t - t0;
    return p0 + v0 * dt + 0.5 * a * dt * dt;
  },
});

/** PresentationClock().update(now: wall, target: wall − p): running from p at the wall time, at real time. */
function running(wall = 1000, p = 104): { time: TheaterTime; clock: PieceClock } {
  const clock = new PieceClock([piece(wall, p, 1)], "tracking", [{ kind: "start", at: wall, p }]);
  const time = new TheaterTime();
  time.advance(wall, clock, [], clock);
  return { time, clock };
}

describe("frame tiers", () => {
  it("visible walking draws at the display's rate; settled scenes still stop drawing frames", () => {
    const walking = new LineClip([v2(20, 20)], [v2(4, 0)]);
    const id = 1;
    const plan = new Plan<LineClip>(1, 1000, 1008, null, [new ClipPlacement(walking, 1000, 1000, [id])], new Map([[id, walking.figures[0]!]]));
    const baked = TheaterBake.bake(plan);
    expect(baked.tiers.filter((t) => t.from < 1005 && t.until > 1001).every((t) => t.moves)).toBe(true);
    const still = new LineClip([v2(20, 20)], [ZERO2]);
    still.reportsMotion = false;
    still.decisive = null;
    const quiet = new Plan<LineClip>(1, 1000, 1008, null, [new ClipPlacement(still, 1000, 1000, [id])], new Map([[id, still.figures[0]!]]));
    expect(TheaterBake.bake(quiet).tiers.some((t) => !t.moves)).toBe(true);
  });
});

describe("the one wake from still", () => {
  const tiers: FrameTier[] = [
    { from: 100, until: 102, moves: true },
    { from: 102, until: 110, moves: false },
    { from: 110, until: 114, moves: true },
    { from: 114, until: 200, moves: false },
  ];

  it("when a still field starts drawing again, on the plan's own time, however the clock runs", () => {
    const { time, clock } = running();
    const T = time.at(1000, clock);
    expect(Math.abs(T - 104), "the gate's clock starts where it's asked").toBeLessThan(1e-6);
    let state = TheaterFrameGate.state(tiers, time, clock, 1000);
    expect(!state.moving && state.wake != null, "a still tier draws nothing, and knows when it next moves").toBe(true);
    // Woken on time: the first frame past the moving tier's start is drawn by then.
    const wake = state.wake ?? 0;
    const atWake = time.at(wake, clock);
    expect(Math.abs(atWake - (110 - TheaterFrameGate.lead)), `wakes at T ${atWake}`).toBeLessThan(1e-3);
    state = TheaterFrameGate.state(tiers, time, clock, wake + 1e-3);
    expect(state.moving, "woken, it draws").toBe(true);
    // Past the moving tier: it rests again a frame after its last.
    const end = time.wallReaching(114 + 2 * TheaterFrameGate.tail, clock, 1000) ?? 0;
    expect(TheaterFrameGate.state(tiers, time, clock, end).moving, "past a moving tier it stops drawing").toBe(false);
    expect(TheaterFrameGate.state(tiers, time, clock, time.wallReaching(113, clock, 1000) ?? 0).moving, "inside a moving tier it draws").toBe(true);
    // Across a hold: p stands, the theater's time runs on the wall, and the wake lands at the same theater time.
    const stalled = new PieceClock([piece(1000, 104, 0)], "stalled", [
      { kind: "start", at: 1000, p: 104 },
      { kind: "stall", at: 1000, p: 104 },
    ]);
    expect(stalled.p(1020), `p ${stalled.p(1020)}`).toBeLessThan(104.5);
    const held = time.copy();
    held.advance(1000, clock, stalled.events, stalled);
    const heldState = TheaterFrameGate.state(tiers, held, stalled, 1000);
    const heldWake = heldState.wake ?? 0;
    expect(!heldState.moving && Math.abs(held.at(heldWake, stalled) - (110 - TheaterFrameGate.lead)) < 1e-3 && heldWake > 1000, `T ${held.at(heldWake, stalled)} at ${heldWake}`).toBe(true);
    // Coming back into view mid-tier: the state is simply read again from where the plan is now.
    const later = time.wallReaching(112, clock, 1000) ?? 0;
    expect(TheaterFrameGate.state(tiers, time, clock, later).moving, "back in view mid-move, it draws at once").toBe(true);
    const quiet = time.wallReaching(120, clock, 1000) ?? 0;
    const last = TheaterFrameGate.state(tiers, time, clock, quiet);
    expect(!last.moving && last.wake == null, "nothing further to move: no wake at all").toBe(true);
    expect(TheaterFrameGate.state([], time, clock, 1000).moving, "no plan, no frames").toBe(false);
  });
});

describe("the rig across a splice", () => {
  it("a standing carry is a figure that hasn't moved yet, both feet down where he stands", () => {
    const c = standingCarry(v2(3, 4), 0.5);
    const track = RigTrack.measure(0, 1, 2, () => v2(3, 4), () => null, 0, c);
    expect(track.planted(0.5)).toEqual({ left: true, right: true });
    expect(track.left[0]!.at).toEqual(v2(3, 4));
  });
});
