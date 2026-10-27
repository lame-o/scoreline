/**
 * What the football and soccer play theaters share, whatever the sport
 * (TheaterKit.swift § Camera): the broadcast camera's spring and its shot
 * blends, and a camera's path through a replay. The baseball theater came
 * first and keeps its own copies (data/mlb/playCamera.ts) with the same
 * constants; these are the general form, for any projection. Pure numbers:
 * the drawing half of TheaterKit (figures, the ball, the type) is
 * features/game/core/theater/theaterKit.ts.
 */
import { CameraFrame, union, type Rect } from "../mlb/playCamera";
import type { FieldPoint } from "../mlb/theaterField";

// MARK: - Camera

/**
 * The broadcast camera's follow, for any theater: framings every 1/60 s on
 * a critically damped spring (no overshoot, no wobble) toward each moment's
 * goal, panning and zooming in log space with capped speeds: 1.4
 * view-heights a second across, ×3 a second in, ×9 out. A cut is a cut:
 * the camera is simply there.
 */
export const CameraRig = {
  rate: 60,

  follow(settle: number, goal: (t: number) => CameraFrame, cuts: readonly number[] = []): CameraFrame[] {
    return follow(settle, goal, cuts);
  },

  /**
   * A new shot's region `elapsed` seconds in: it blends from the last
   * shot's over 0.4 s, or, from far across the field, pulls back through a
   * shot of both and pushes in again (0.9 s), as an operator would rather
   * than sliding across. Also how far the blend is (1: done).
   */
  blend(a: Rect, b: Rect, elapsed: number): { region: Rect; u: number } {
    const far = Math.hypot(midX(a) - midX(b), midY(a) - midY(b)) > 0.6 * Math.max(Math.min(a.height, b.height), 60);
    const length = far ? 0.9 : 0.4;
    const x = elapsed / length;
    if (!(x < 1)) return { region: b, u: 1 };
    const both = union(a, b);
    const region = far ? (x < 0.5 ? lerpRect(a, both, smooth(2 * x)) : lerpRect(both, b, smooth(2 * x - 1))) : lerpRect(a, b, smooth(x));
    return { region, u: smooth(x) };
  },

  /** Room kept clear at the top: a little, or the banner's while it's up (with 0.4 s either side). */
  headroom(t: number, banner: readonly [number, number] | null): number {
    if (!banner) return CameraFrame.headroom;
    const up = smooth((t - banner[0] + 0.5) / 0.4) * (1 - smooth((t - banner[1]) / 0.4));
    return CameraFrame.headroom + (CameraFrame.bannerRoom - CameraFrame.headroom) * up;
  },

  smooth,
  lerp: lerpRect,

  /**
   * Room round a spot in projected feet (y up), as the camera keeps it:
   * a figure about 9 ft tall on screen (larger than life), a ball a little.
   */
  room(p: FieldPoint, figure: boolean): Rect {
    const x = p.x;
    const y = p.y * 0.5 + p.z * 0.82;
    const below = figure ? 3 : 5;
    const above = figure ? 10 : 5;
    return { x: x - 6, y: y - below, width: 12, height: below + above };
  },
};

function smooth(x: number): number {
  const u = Math.min(Math.max(x, 0), 1);
  return u * u * (3 - 2 * u);
}

function lerpRect(a: Rect, b: Rect, s: number): Rect {
  return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, width: a.width + (b.width - a.width) * s, height: a.height + (b.height - a.height) * s };
}

export const midX = (r: Rect) => r.x + r.width / 2;
export const midY = (r: Rect) => r.y + r.height / 2;
export const maxX = (r: Rect) => r.x + r.width;
export const maxY = (r: Rect) => r.y + r.height;

/** Whether two rects overlap (CGRect.intersects: touching edges don't). */
export const intersects = (a: Rect, b: Rect): boolean => a.x < maxX(b) && b.x < maxX(a) && a.y < maxY(b) && b.y < maxY(a);

/** The union of a non-empty list. */
export function unionAll(rects: readonly Rect[]): Rect | null {
  const [first, ...rest] = rects;
  return first ? rest.reduce(union, first) : null;
}

/** One step a sample (semi-implicit Euler: at ω·dt ≈ 0.12, stable and smooth). */
function follow(end: number, goal: (t: number) => CameraFrame, cuts: readonly number[]): CameraFrame[] {
  const rate = CameraRig.rate;
  const dt = 1 / rate;
  const pan = 7;
  const zoom = 7;
  const first = goal(0);
  let x = first.x;
  let y = first.y;
  let z = Math.log(first.span);
  let vx = 0;
  let vy = 0;
  let vz = 0;
  const samples: CameraFrame[] = [first];
  let t = 0;
  while (t < end) {
    t += dt;
    const g = goal(t);
    if (cuts.some((c) => c > t - dt && c <= t)) {
      x = g.x;
      y = g.y;
      z = Math.log(g.span);
      vx = 0;
      vy = 0;
      vz = 0;
    } else {
      vx += (pan * pan * (g.x - x) - 2 * pan * vx) * dt;
      vy += (pan * pan * (g.y - y) - 2 * pan * vy) * dt;
      const speed = Math.hypot(vx, vy);
      const reach = 1.4 * Math.exp(z);
      if (speed > reach) {
        vx *= reach / speed;
        vy *= reach / speed;
      }
      vz = Math.min(Math.max(vz + (zoom * zoom * (Math.log(g.span) - z) - 2 * zoom * vz) * dt, -1.1), 2.2);
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
    }
    samples.push({ x, y, span: Math.exp(z) });
  }
  return samples;
}

/**
 * A camera's path through a replay: framings every 1/60 s until the play
 * settles, then an eased move to where it rests, reached exactly at `back`.
 */
export class CameraPath {
  constructor(
    readonly rest: CameraFrame,
    readonly samples: readonly CameraFrame[] = [],
    readonly settle = 0,
    readonly back = 0,
  ) {}

  frame(t: number): CameraFrame {
    if (this.samples.length === 0 || !(t < this.back)) return this.rest;
    if (t >= this.settle) {
      const u = (t - this.settle) / Math.max(this.back - this.settle, 0.01);
      return CameraFrame.mix(this.sample(this.settle), this.rest, u * u * (3 - 2 * u));
    }
    return this.sample(t);
  }

  private sample(t: number): CameraFrame {
    const i = Math.max(t, 0) * CameraRig.rate;
    const last = this.samples.length - 1;
    const lower = Math.min(Math.trunc(i), last);
    const upper = Math.min(lower + 1, last);
    return CameraFrame.mix(this.samples[lower]!, this.samples[upper]!, Math.min(i - lower, 1));
  }
}

/**
 * The broadcast camera's follow: a critically damped spring toward each
 * moment's framing (pan, and zoom in log space so it feels even), pans
 * capped at 1.4 view-heights a second, zooms at ×3 a second in and ×9 out,
 * and cuts that are simply there. Integrated once, when a script is built;
 * any frame reads the samples at t. (PlayCamera's track, without its
 * baseball rest framing.)
 */
export const CameraFollow = {
  rate: CameraRig.rate,

  /** Framings every 1/rate s from 0 through `end`. */
  samples(end: number, goal: (t: number) => CameraFrame, cuts: readonly number[] = []): CameraFrame[] {
    return follow(end, goal, cuts);
  },

  /** The framing at t, between samples; the last one from the end on. */
  frame(samples: readonly CameraFrame[], t: number): CameraFrame | null {
    const last = samples[samples.length - 1];
    if (!last) return null;
    if (!Number.isFinite(t)) return last;
    const i = Math.max(t, 0) * CameraRig.rate;
    const lower = Math.min(Math.trunc(i), samples.length - 1);
    const upper = Math.min(lower + 1, samples.length - 1);
    return CameraFrame.mix(samples[lower]!, samples[upper]!, Math.min(i - lower, 1));
  },
};
