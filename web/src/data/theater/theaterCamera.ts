/**
 * The game as one broadcast, part 10: the camera operator
 * (TheaterCamera.swift; CHOREOGRAPHY §5.6).
 *
 * One camera for the whole session: the ground point at the view's center,
 * the span (in log space, so zooms feel even), and the yaw, with their
 * velocities. It's integrated at 60 Hz toward each moment's goal and carried
 * across every splice, so a new goal never restarts it: the state keeps its
 * velocity and bends toward the new target, Apple's interruptible-animation
 * rule. Every axis is critically damped (a camera isn't a thrown object: no
 * overshoot, ever): pan and zoom at ω = 7 with today's caps (1.4 view heights
 * a second across; ×3 a second in, ×9 out), the yaw at ω = 3.6, capped at 45°
 * a second.
 *
 * It tracks a moving goal without lag: the goal's own velocity is fed
 * forward, so the error alone is what decays (critically, from wherever a
 * retarget left it), and inside one clip the camera is that clip's own
 * operator's work.
 *
 * The yaw is a camera parameter now, never a script's frame: basketball's
 * follows the ball's end of the floor (§5.6.3; `basketballYaw` in
 * basketballClips.ts), with hysteresis and a dwell, so a change of
 * possession is a broadcast pan, not a 60° snap under a crossfade.
 */
import { remainder, TheaterTiming, vec4, type CameraState, type PTime, type Vec4 } from "./theaterEngine";

export interface CameraTuning {
  readonly pan: number;
  readonly zoom: number;
  readonly yaw: number;
  /** View heights a second across the view. */
  readonly panCap: number;
  /** Log-span units a second: in (narrowing) and out. */
  readonly zoomIn: number;
  readonly zoomOut: number;
  /** Radians a second. */
  readonly yawCap: number;
  /** The dimetric view squashes the ground's depth: up the view is half the ground's. */
  readonly depth: number;
}

export const CAMERA_TUNING: CameraTuning = {
  pan: 7,
  zoom: 7,
  yaw: 3.6,
  panCap: 1.4,
  zoomIn: 1.1,
  zoomOut: 2.2,
  yawCap: (45 * Math.PI) / 180,
  depth: 0.5,
};

export class CameraOperator {
  state: CameraState;

  constructor(
    state: CameraState,
    readonly tuning: CameraTuning = CAMERA_TUNING,
  ) {
    this.state = state;
  }

  /** One step of `dt` toward `goal` (x, y, log span, yaw) moving at `goalVelocity`. */
  step(goal: Vec4, goalVelocity: Vec4, dt: number): void {
    const x = this.state.value;
    const v = this.state.velocity;
    const tuning = this.tuning;
    const ex = x.x - goal.x;
    const ey = x.y - goal.y;
    const ez = x.z - goal.z;
    const ew = remainder(x.w - goal.w, 2 * Math.PI);
    // Semi-implicit Euler (stable and smooth at ω·dt ≈ 0.12).
    const wp = tuning.pan;
    const wz = tuning.zoom;
    const wy = tuning.yaw;
    let vx = v.x + (-(wp * wp) * ex - 2 * wp * (v.x - goalVelocity.x)) * dt;
    let vy = v.y + (-(wp * wp) * ey - 2 * wp * (v.y - goalVelocity.y)) * dt;
    let vz = v.z + (-(wz * wz) * ez - 2 * wz * (v.z - goalVelocity.z)) * dt;
    let vw = v.w + (-(wy * wy) * ew - 2 * wy * (v.w - goalVelocity.w)) * dt;
    // The caps: across the view in view heights, the zoom's in and out, the yaw's.
    const yaw = x.w;
    const span = Math.exp(x.z);
    const across = vx * Math.cos(yaw) + vy * Math.sin(yaw);
    const up = (-vx * Math.sin(yaw) + vy * Math.cos(yaw)) * tuning.depth;
    const speed = Math.sqrt(across * across + up * up);
    const reach = tuning.panCap * span;
    if (speed > reach) {
      vx *= reach / speed;
      vy *= reach / speed;
    }
    vz = Math.min(Math.max(vz, -tuning.zoomIn), tuning.zoomOut);
    vw = Math.min(Math.max(vw, -tuning.yawCap), tuning.yawCap);
    this.state = {
      value: vec4(x.x + vx * dt, x.y + vy * dt, x.z + vz * dt, remainder(x.w + vw * dt, 2 * Math.PI)),
      velocity: vec4(vx, vy, vz, vw),
    };
  }

  /**
   * The camera from `state` at `t0` through `t1`, every 1/60 s, toward
   * `goal(t)`: the samples (x, y, log span, yaw in Float, four to a sample;
   * the first is the state itself) and the state at the end.
   */
  static bake(state: CameraState, t0: PTime, t1: PTime, tuning: CameraTuning, goal: (t: PTime) => Vec4): { samples: Float32Array; end: CameraState } {
    const dt = 1 / TheaterTiming.rate;
    const n = Math.max(Math.ceil((t1 - t0) * TheaterTiming.rate), 0);
    const op = new CameraOperator(state, tuning);
    const samples = new Float32Array(4 * (n + 1));
    const write = (i: number) => {
      const v = op.state.value;
      samples[4 * i] = v.x;
      samples[4 * i + 1] = v.y;
      samples[4 * i + 2] = v.z;
      samples[4 * i + 3] = v.w;
    };
    write(0);
    let previous = goal(t0);
    for (let i = 1; i <= n; i++) {
      const t = t0 + i * dt;
      const g = goal(t);
      let gv = vec4((g.x - previous.x) / dt, (g.y - previous.y) / dt, (g.z - previous.z) / dt, remainder(g.w - previous.w, 2 * Math.PI) / dt);
      // A goal that cuts (a script's own cut) isn't a velocity to follow: the error takes it.
      if (Math.abs(gv.x) + Math.abs(gv.y) > 400 || Math.abs(gv.z) > 20 || Math.abs(gv.w) > 20) gv = vec4(0, 0, 0, 0);
      op.step(g, gv, dt);
      write(i);
      previous = g;
    }
    return { samples: samples.subarray(0, 4 * (n + 1)), end: op.state };
  }
}

/** A change of the yaw target: when, and to what. */
export interface YawTarget {
  readonly at: PTime;
  readonly yaw: number;
}

/**
 * Which way the camera looks along the floor: basketball's follows the
 * ball's end (§5.6.3). Beyond `band` of half court toward a basket, the yaw
 * is that basket's; inside the band it holds (hysteresis), and it changes at
 * most once every `dwell` seconds.
 */
export class YawRule {
  constructor(
    readonly middle: number,
    readonly band: number,
    readonly dwell: number,
    /** The yaw toward the higher-x end, and toward the lower. */
    readonly high: number,
    readonly low: number,
  ) {}

  /**
   * The yaw targets over a sampled ball track (`ball(t)`: its x, null while
   * unknown), from `yaw` at `t0`: each change of end and when it happened.
   */
  targets(yaw: number, changed: PTime, t0: PTime, t1: PTime, ball: (t: PTime) => number | null, step = 1 / TheaterTiming.rate): YawTarget[] {
    const out: YawTarget[] = [{ at: t0, yaw }];
    let current = yaw;
    let last = changed;
    let t = t0;
    while (t <= t1 + 1e-9) {
      const x = ball(t);
      if (x != null && t - last >= this.dwell) {
        const wanted = x > this.middle + this.band ? this.high : x < this.middle - this.band ? this.low : current;
        if (Math.abs(remainder(wanted - current, 2 * Math.PI)) > 1e-6) {
          current = wanted;
          last = t;
          out.push({ at: t, yaw: wanted });
        }
      }
      t += step;
    }
    return out;
  }

  /** The target in force at `t` from a list of changes. */
  static target(changes: readonly YawTarget[], t: PTime): number {
    let lo = 0;
    let hi = changes.length - 1;
    if (hi < 0) return 0;
    if (t < changes[0]!.at) return changes[0]!.yaw;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (changes[mid]!.at <= t) lo = mid;
      else hi = mid - 1;
    }
    return changes[lo]!.yaw;
  }
}
