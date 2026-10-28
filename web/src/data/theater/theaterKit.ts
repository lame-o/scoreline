/**
 * What the play theaters share, whatever the sport (TheaterKit.swift § Hold
 * and § Camera): how long a replay's end holds (all three), and for football
 * and soccer the broadcast camera's spring and its shot blends, and a
 * camera's path through a replay. The baseball theater came
 * first and keeps its own copies (data/mlb/playCamera.ts) with the same
 * constants; these are the general form, for any projection. Pure numbers:
 * the drawing half of TheaterKit (figures, the ball, the type) is
 * features/game/core/theater/theaterKit.ts.
 */
import type { Particle } from "../celebrations";
import { CameraFrame, union, type Rect } from "../mlb/playCamera";
import type { FieldPoint, Point } from "../mlb/theaterField";

// MARK: - Hold

/**
 * How long a replay's end stays up when nothing new has come
 * (TheaterKit.hold): then the theater returns to the game as it stands (the
 * next batter up, both teams set at the line, the quiet pitch).
 */
export const HOLD_MS = 8000;

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
 * The framing that fits a region, no closer than `closest` nor than
 * `tightest` (the ballpark's battery by default; a court frames tighter, a
 * man and the rim he's going at). (TheaterKit.swift
 * `CameraFrame.fitting(_:headroom:closest:tightest:)`.)
 */
export function fitting(region: Rect, headroom: number, closest: number, tightest: number = CameraFrame.tightest): CameraFrame {
  const { aspect, margin, widest } = CameraFrame;
  const tall = 1 - headroom - margin;
  const wide = aspect * (1 - 2 * margin);
  const span = Math.min(Math.max(region.height / tall, region.width / wide, closest, tightest), widest);
  return { x: midX(region), y: midY(region) + ((headroom - margin) * span) / 2, span };
}

/**
 * The framing that fits a region and keeps its corner clear (the stamp's),
 * checked again after every move: sliding the play over or up can bring
 * someone else into the corner (a pile trailing the play, a man jogging
 * back to the line), and then it moves again, or widens. `items` must stay
 * in view; `others` need only stay out of the corner. (The ballpark's
 * `fitClear` with a field's crowd in mind: TheaterKit.swift's
 * `CameraFrame.clearing`.)
 */
export function clearing(
  region: Rect,
  items: readonly Rect[],
  others: readonly Rect[],
  headroom: number,
  closest: number,
  corner: { readonly width: number; readonly height: number },
  tightest: number = CameraFrame.tightest,
): CameraFrame {
  let frame = fitting(region, headroom, closest, tightest);
  if (!(corner.width > 0 && corner.height > 0)) return frame;
  const { aspect, margin, widest } = CameraFrame;
  for (let pass = 0; pass < 10; pass++) {
    const w = frame.span * aspect;
    const f = frame;
    const across = (x: number) => 0.5 + (x - f.x) / w;
    const up = (y: number) => 0.5 + (y - f.y) / f.span;
    const inView = (r: Rect) => across(maxX(r)) > 0 && across(r.x) < 1 && up(maxY(r)) > 0 && up(r.y) < 1;
    const shown = items.filter(inView);
    const inside = [...shown, ...others.filter(inView)].filter((r) => across(r.x) < corner.width && up(r.y) < corner.height);
    if (inside.length === 0) break;
    const right = Math.max(...inside.map((r) => corner.width - across(r.x)));
    const raise = Math.max(...inside.map((r) => corner.height - up(r.y)));
    const roomRight = 1 - margin - (shown.length > 0 ? Math.max(...shown.map((r) => across(maxX(r)))) : 0);
    const roomUp = 1 - headroom - (shown.length > 0 ? Math.max(...shown.map((r) => up(maxY(r)))) : 0);
    // The smaller move that keeps the play in view: across (by its share of the width) or up.
    if (right <= roomRight && (right * aspect <= raise || raise > roomUp)) {
      frame = { ...frame, x: frame.x - (right + 0.005) * w };
    } else if (raise <= roomUp) {
      frame = { ...frame, y: frame.y - (raise + 0.005) * frame.span };
    } else {
      frame = { ...frame, span: Math.min(frame.span * 1.12, widest) };
    }
  }
  return frame;
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

// MARK: - Bursts

/**
 * A celebration on a theater's stage (a touchdown's or a goal's fireworks,
 * the headline's confetti), sized by the well (TheaterKit.swift
 * `TheaterBurst`): its spread in proportion to the well's height, as big in
 * the compact panel as in a wide one, its strokes growing more slowly so a
 * big burst stays finely drawn; and kept far enough inside the well that it
 * isn't cut off at an edge. Heights in points.
 */
export const TheaterBurst = {
  /** How far a burst spreads, as a multiple of the charts' bursts: about two fifths of the well's height either way. */
  scale(height: number): number {
    return 2.7 * (Math.max(height, 120) / 156) ** 0.75;
  },

  /** The particles of a burst at the origin, spread by `scale`. */
  spread(particles: readonly Particle[], scale: number): Particle[] {
    const fine = scale ** 0.6;
    return particles.map((p) => {
      const s = p.shape;
      const moved = { ...p, x: p.x * scale, y: p.y * scale };
      switch (s.kind) {
        case "piece":
          return { ...moved, shape: { ...s, w: s.w * fine, h: s.h * fine, corner: s.corner * fine } };
        case "streak":
          return { ...moved, shape: { ...s, x0: s.x0 * scale, y0: s.y0 * scale, x1: s.x1 * scale, y1: s.y1 * scale, width: s.width * fine } };
        case "ring":
          return { ...moved, shape: { ...s, radius: s.radius * scale, width: s.width * fine } };
        case "disc":
          return { ...moved, shape: { ...s, radius: s.radius * fine } };
        case "ball":
          return { ...moved, shape: { ...s, radius: s.radius * fine } };
      }
    });
  },

  /** A burst's origin, moved in from the well's edges so most of it shows, and down clear of the headline's band. */
  inside(p: Point, size: { readonly width: number; readonly height: number }): Point {
    const m = Math.min(size.height * 0.3, size.width * 0.2);
    return { x: Math.min(Math.max(p.x, m), size.width - m), y: Math.min(Math.max(p.y, size.height * 0.36), size.height - m) };
  },
};
