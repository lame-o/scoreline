/**
 * The play theater's broadcast camera (PlayCamera.swift): a virtual camera
 * inside the field's projection, so every line is drawn at its zoom, never a
 * scaled bitmap. Each play is cut into shots (tight on the battery for the
 * pitch, the ball and the fielder going for it, each throw, then the
 * runners' last bases), and each shot names what must be in frame. The
 * camera follows on a critically damped spring (no overshoot, no wobble),
 * with a cap on how fast it pans and zooms, and shots hand over through a
 * short blend, so a move eases in as well as out. The track is integrated
 * once, when the script is built; any frame reads it at t. Between plays it
 * rests on the infield and the runners.
 *
 * Only types come from playScript.ts (which imports this module), so there is
 * no runtime import cycle.
 */
import type { Builder, PlayScript } from "./playScript";
import { Ballpark, fieldPoint, ground, samePoint, smooth, type FieldPoint } from "./theaterField";

/** A rectangle in projected feet (y up). */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const minX = (r: Rect) => r.x;
const maxX = (r: Rect) => r.x + r.width;
const minY = (r: Rect) => r.y;
const maxY = (r: Rect) => r.y + r.height;
const midX = (r: Rect) => r.x + r.width / 2;
const midY = (r: Rect) => r.y + r.height / 2;

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(maxX(a), maxX(b)) - x, height: Math.max(maxY(a), maxY(b)) - y };
}

/**
 * Where the camera looks: the middle of the view and how much field it takes
 * in, in projected feet (x across; y up the screen, a point's y × 0.5 + z ×
 * 0.82, as the projection draws it).
 */
export interface CameraFrame {
  readonly x: number;
  readonly y: number;
  /** Feet from the bottom of the view to the top. */
  readonly span: number;
}

export const CameraFrame = {
  /** The well's shape: half as tall as wide (wider panels see more at the sides). */
  aspect: 2,
  /** Kept clear at the bottom and the sides, as fractions of the view. */
  margin: 0.05,
  /** Kept clear at the top: a little, or room for the banner. */
  headroom: 0.07,
  bannerRoom: 0.22,
  /** The closest it goes (the battery) and the widest (the whole park). */
  tightest: 40,
  widest: 290,

  /** The framing that fits a region (projected feet, y up) in the view under `headroom`, no tighter than `closest`. */
  fit(region: Rect, headroom?: number, closest?: number): CameraFrame {
    headroom ??= this.headroom;
    closest ??= this.tightest;
    const tall = 1 - headroom - this.margin;
    const wide = this.aspect * (1 - 2 * this.margin);
    const span = Math.min(Math.max(region.height / tall, region.width / wide, closest, this.tightest), this.widest);
    return { x: midX(region), y: midY(region) + ((headroom - this.margin) * span) / 2, span };
  },

  /**
   * The same, keeping every figure and ball out of a bottom-left corner (the
   * scorer's mark: its width and height as fractions of the view). The
   * framing slides the least it can (right or up) to clear it, and widens
   * only when neither fits. `items` must stay in view; `others` (bystanders)
   * need only stay out of the corner.
   */
  fitClear(
    region: Rect,
    items: readonly Rect[],
    others: readonly Rect[],
    headroom: number,
    closest: number,
    corner: { readonly width: number; readonly height: number },
  ): CameraFrame {
    let frame = this.fit(region, headroom, closest);
    if (!(corner.width > 0 && corner.height > 0)) return frame;
    for (let pass = 0; pass < 5; pass++) {
      const w = frame.span * this.aspect;
      const f = frame;
      const across = (x: number) => 0.5 + (x - f.x) / w;
      const up = (y: number) => 0.5 + (y - f.y) / f.span;
      // Only what's in view counts.
      const inView = (r: Rect) => across(maxX(r)) > 0 && across(minX(r)) < 1 && up(maxY(r)) > 0 && up(minY(r)) < 1;
      const shown = items.filter(inView);
      const inside = [...shown, ...others.filter(inView)].filter((r) => across(minX(r)) < corner.width && up(minY(r)) < corner.height);
      if (inside.length === 0) return frame;
      const right = Math.max(...inside.map((r) => corner.width - across(minX(r))));
      const raise = Math.max(...inside.map((r) => corner.height - up(minY(r))));
      const roomRight = 1 - this.margin - (shown.length > 0 ? Math.max(...shown.map((r) => across(maxX(r)))) : 0);
      const roomUp = 1 - headroom - (shown.length > 0 ? Math.max(...shown.map((r) => up(maxY(r)))) : 0);
      if (right <= roomRight && (right * this.aspect <= raise || raise > roomUp)) {
        return { ...frame, x: frame.x - right * w };
      }
      if (raise <= roomUp) return { ...frame, y: frame.y - raise * frame.span };
      frame = { ...frame, span: Math.min(frame.span * 1.15, this.widest) };
    }
    return frame;
  },

  /** Part way to another framing; the zoom eases in proportion. */
  mix(a: CameraFrame, b: CameraFrame, u: number): CameraFrame {
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, span: a.span * (b.span / a.span) ** u };
  },

  equal(a: CameraFrame, b: CameraFrame): boolean {
    return a.x === b.x && a.y === b.y && a.span === b.span;
  },
};

/** What a shot keeps in frame, in projected feet: each figure's or ball's room, and the box round them all. */
export class Box {
  items: Rect[] = [];

  add(p: FieldPoint, figure: boolean): void {
    const x = p.x;
    const y = p.y * 0.5 + p.z * 0.82;
    // A figure stands about 9 ft tall on screen (drawn larger than life); a ball needs a little room.
    const below = figure ? 3 : 5;
    const above = figure ? 10 : 5;
    this.items.push({ x: x - 6, y: y - below, width: 12, height: below + above });
  }

  addBox(other: Box): void {
    this.items.push(...other.items);
  }

  get rect(): Rect {
    const [first, ...rest] = this.items;
    if (!first) return regionOf(INFIELD);
    return rest.reduce(union, first);
  }
}

/** One shot of the broadcast: from when, and what it keeps in frame. */
export interface Shot {
  readonly from: number;
  /** A flight's ball, now and a beat ahead, and its shadow. */
  readonly flight: number | null;
  /** Figures by index, now and a beat ahead. */
  readonly actors: readonly number[];
  /** Fixed spots: a base, the wall. */
  readonly points: readonly FieldPoint[];
  /** No closer than this (feet top to bottom). */
  readonly closest: number;
  /** A cut, not a move: the camera is simply there (the home run's trot). */
  readonly cut: boolean;
}

export function shot(from: number, options: Partial<Omit<Shot, "from">> = {}): Shot {
  return { from, flight: options.flight ?? null, actors: options.actors ?? [], points: options.points ?? [], closest: options.closest ?? CameraFrame.tightest, cut: options.cut ?? false };
}

/** The battery: the pitcher on the rubber, the batter (either box) and the catcher. */
export const BATTERY: readonly FieldPoint[] = [
  { x: 0, y: 56, z: 0 },
  { x: -9, y: 1, z: 0 },
  { x: 9, y: 1, z: 0 },
  { x: 0, y: -8, z: 0 },
];

/** The bases, the plate and the infielders where they play (so the banner never sits on the middle infielders). */
export const INFIELD: readonly FieldPoint[] = [
  fieldPoint(Ballpark.base(1)),
  fieldPoint(Ballpark.base(2)),
  fieldPoint(Ballpark.base(3)),
  { x: 0, y: -8, z: 0 },
  { x: -9, y: 1, z: 0 },
  { x: 9, y: 1, z: 0 },
  fieldPoint(Ballpark.position(4)),
  fieldPoint(Ballpark.position(6)),
];

/** A region in projected feet (y up) around spots where figures stand: room for a figure's height above each, a little below. */
export function regionOf(points: readonly FieldPoint[], figures = true): Rect {
  const box = new Box();
  for (const p of points) box.add(p, figures);
  const [first, ...rest] = box.items;
  return first ? rest.reduce(union, first) : { x: 0, y: 0, width: 0, height: 0 };
}

/** What a shot keeps in frame at t. */
export function shotRegion(s: Shot, script: PlayScript, t: number): Box {
  const box = new Box();
  for (const p of s.points) box.add(p, true);
  if (s.flight != null && s.flight < script.flights.length) {
    const f = script.flights[s.flight]!;
    for (const dt of [0, 0.2, 0.45]) {
      const p = f.point(Math.min(Math.max(t + dt, f.start), f.end));
      box.add(p, false);
      box.add(fieldPoint(ground(p)), false);
    }
  }
  for (const index of s.actors) {
    const actor = script.actors[index];
    if (!actor) continue;
    for (const dt of [0, 0.25]) {
      if (actor.opacity(t + dt) > 0.5) box.add(fieldPoint(actor.position(t + dt)), true);
    }
  }
  return box;
}

let restFrame: CameraFrame | null = null;

/**
 * Between plays: the four bases, the mound and the battery, with the
 * runners' leads, set a touch right of center so the widest scorer's mark
 * ("4–6–3 DP") clears the batter's box.
 */
export function restCamera(): CameraFrame {
  if (!restFrame) {
    const box = new Box();
    for (const p of INFIELD) box.add(p, true);
    restFrame = CameraFrame.fitClear(box.rect, box.items, [], CameraFrame.headroom, CameraFrame.tightest, { width: 0.47, height: 0.3 });
  }
  return restFrame;
}

/**
 * The camera through a play: framings every 1/60 s from the first pitch to
 * the field settling, then an eased move to the rest framing, which it
 * reaches exactly as the replay ends.
 */
export class CameraTrack {
  static readonly rate = 60;

  samples: CameraFrame[] = [];
  settle = 0;
  /** When it reaches the rest framing. */
  back = 0;

  frame(t: number): CameraFrame {
    if (this.samples.length === 0 || !(t < this.back)) return restCamera();
    if (t >= this.settle) {
      const u = (t - this.settle) / Math.max(this.back - this.settle, 0.01);
      return CameraFrame.mix(this.sample(this.settle), restCamera(), smooth(u));
    }
    return this.sample(t);
  }

  private sample(t: number): CameraFrame {
    const i = Math.max(t, 0) * CameraTrack.rate;
    const last = this.samples.length - 1;
    const lower = Math.min(Math.trunc(i), last);
    const upper = Math.min(lower + 1, last);
    return CameraFrame.mix(this.samples[lower]!, this.samples[upper]!, Math.min(i - lower, 1));
  }

  /**
   * Follows the shots' framings on a critically damped spring: pan and zoom
   * (in log space, so zooming feels even), with capped speeds: pans at 1.4
   * view-heights a second, zooms in at ×3 a second and out at ×9 (pulling
   * back to find a ball off the bat can't wait; pushing in can). A new shot
   * blends in over 0.4 s; one far from the last pulls back through a shot of
   * both and pushes in again (0.9 s), as a broadcast camera would, rather
   * than sliding across the field. While the scorer's mark is up, nothing
   * stays in its corner.
   */
  static follow(shots: readonly Shot[], script: PlayScript, settle: number, back: number): CameraTrack {
    const track = new CameraTrack();
    track.settle = settle;
    track.back = back;
    if (shots.length === 0) return track;
    const band = (t: number): number => {
      const banner = script.banner;
      if (!banner) return CameraFrame.headroom;
      const up = smooth((t - banner.at + 0.5) / 0.4) * (1 - smooth((t - banner.until) / 0.4));
      return CameraFrame.headroom + (CameraFrame.bannerRoom - CameraFrame.headroom) * up;
    };
    const lerp = (a: Rect, b: Rect, s: number): Rect => ({
      x: a.x + (b.x - a.x) * s,
      y: a.y + (b.y - a.y) * s,
      width: a.width + (b.width - a.width) * s,
      height: a.height + (b.height - a.height) * s,
    });
    const goal = (t: number): CameraFrame => {
      let k = 0;
      for (let i = shots.length - 1; i >= 0; i--) {
        if (shots[i]!.from <= t) {
          k = i;
          break;
        }
      }
      const s = shots[k]!;
      const box = shotRegion(s, script, t);
      let region = box.rect;
      let closest = s.closest;
      if (k > 0 && !s.cut) {
        const previous = shots[k - 1]!;
        const before = shotRegion(previous, script, t);
        const a = before.rect;
        const b = region;
        const far = Math.hypot(midX(a) - midX(b), midY(a) - midY(b)) > 0.6 * Math.max(Math.min(a.height, b.height), 60);
        const length = far ? 0.9 : 0.4;
        const x = (t - s.from) / length;
        if (x < 1) {
          const both = union(a, b);
          region = far ? (x < 0.5 ? lerp(a, both, smooth(2 * x)) : lerp(both, b, smooth(2 * x - 1))) : lerp(a, b, smooth(x));
          closest = previous.closest + (closest - previous.closest) * smooth(x);
          // Mid-blend, both shots' figures stay out of the mark's corner.
          box.addBox(before);
        }
      }
      if (!Number.isFinite(script.stamp) || t < script.stamp - 0.3) return CameraFrame.fit(region, band(t), closest);
      // The mark never sits on anyone in view, in the play or not.
      const others = new Box();
      for (const actor of script.actors) if (actor.opacity(t) > 0.5) others.add(fieldPoint(actor.position(t)), true);
      return CameraFrame.fitClear(region, box.items, others.items, band(t), closest, script.corner);
    };
    // One step a sample (semi-implicit Euler: at ω·dt ≈ 0.12, stable and smooth).
    const dt = 1 / CameraTrack.rate;
    const pan = 7;
    const zoom = 7;
    const first = goal(0);
    let x = first.x;
    let y = first.y;
    let z = Math.log(first.span);
    let vx = 0;
    let vy = 0;
    let vz = 0;
    track.samples.push(first);
    let t = 0;
    const cuts = shots.filter((s) => s.cut).map((s) => s.from);
    while (t < settle) {
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
      track.samples.push({ x, y, span: Math.exp(z) });
    }
    return track;
  }
}

// MARK: - Shots

/**
 * Cuts the play into shots: tight on the battery through the pitch; on
 * contact the ball and the fielder going for it (a grounder stays on the
 * infield, a fly widens with its height and distance, a home run is chased
 * to the wall and held for its fireworks); each throw, end to end; then the
 * runners' last bases, where it rests.
 */
export function shoot(b: Builder): void {
  const { script, scene, contact, batter } = b;
  const shots: Shot[] = [shot(0, { points: BATTERY })];
  let end = contact + 0.45;
  let running = false;
  const finish = () => {
    script.shots = shots;
    script.camera = CameraTrack.follow(shots, script, script.settle, script.duration);
  };
  if (script.batted != null) {
    const i = script.batted;
    const flight = script.flights[i]!;
    const fence = script.fence;
    if (fence) {
      const target = ground(flight.to);
      const bearing = Ballpark.bearing(target);
      const degrees = (bearing * 180) / Math.PI;
      const wall = Ballpark.polar(Ballpark.fence(bearing), degrees);
      let chaser: number | null = null;
      let nearest = Infinity;
      for (let a = 0; a < Math.min(9, script.actors.length); a++) {
        const p = script.actors[a]!.position(fence.at);
        const d = Math.hypot(p.x - wall.x, p.y - wall.y);
        if (d < nearest) {
          nearest = d;
          chaser = a;
        }
      }
      shots.push(shot(contact - 0.08, { flight: i, actors: chaser != null ? [chaser] : [], points: [fieldPoint(wall, Ballpark.wallHeight)], closest: 70 }));
      // Held on the wall for the fireworks, with room for them above it.
      const d = Math.max(Ballpark.distance(wall), 1);
      const side = { x: (wall.y / d) * 40, y: (-wall.x / d) * 40 };
      shots.push(
        shot(fence.at + 0.1, {
          points: [
            { x: wall.x - side.x, y: wall.y - side.y, z: 30 },
            { x: wall.x + side.x, y: wall.y + side.y, z: 30 },
            fieldPoint(target),
            fieldPoint(wall),
          ],
          closest: 100,
        }),
      );
      // Cut to the trot: the batter coming home (a broadcast cuts; it doesn't sweep the park).
      const runs = script.flashes.filter((f) => f.beat === "run").map((f) => f.at);
      const home = runs.length > 0 ? Math.max(...runs) : fence.at + 1.2;
      shots.push(shot(fence.at + 0.8, { actors: [batter], points: [{ x: 0, y: 0, z: 0 }, fieldPoint(Ballpark.base(3))], cut: true }));
      shots.push(shot(Math.max(home + 0.1, fence.at + 1.2), { points: INFIELD }));
      finish();
      return;
    }
    const first = scene.fielders[0] ?? scene.error ?? Ballpark.nearest(ground(flight.to));
    // A beat before contact the camera starts to open up, as an operator reads the swing.
    shots.push(shot(contact - 0.08, { flight: i, actors: [b.fielder(first)], closest: 56 }));
    end = flight.end + 0.35;
    // A clean hit: once the ball's run down, the story is the runners, not
    // the relay to the cutoff man. As the ball's gathered in the outfield it
    // cuts to the batter taking his base (sliding into third), or for a
    // single to the infield and its runners.
    const outfield = Ballpark.distance(ground(flight.to)) > 200;
    const batterEnd = scene.batter?.end;
    const gathered = script.actors[b.fielder(first)]?.actions.find((a) => a.kind === "scoop")?.at;
    if (!scene.runners.some((r) => r.end.kind === "out") && batterEnd?.kind === "base" && (batterEnd.base >= 2 || outfield) && gathered != null) {
      const base = batterEnd.base;
      const reach = script.actors[batter]?.moves.find((m) => {
        const last = m.path[m.path.length - 1];
        return last != null && samePoint(last, Ballpark.base(base));
      })?.end;
      if (base >= 2 && reach != null) {
        shots.push(shot(gathered, { actors: [batter], points: [fieldPoint(Ballpark.base(base)), fieldPoint(Ballpark.base(base - 1))], cut: outfield }));
        end = reach + 0.5;
      } else {
        shots.push(shot(gathered, { points: INFIELD, cut: true }));
        end = gathered;
      }
      running = true;
    }
  }
  // The throws (and a ball that gets away), end to end.
  const primary = new Set([0, ...(script.batted != null ? [script.batted] : [])]);
  script.flights.forEach((flight, j) => {
    if (primary.has(j) || !(flight.start > contact - 0.3) || running) return;
    const from = Math.max(flight.start - 0.3, (shots[shots.length - 1]?.from ?? 0) + 0.25);
    shots.push(shot(from, { flight: j, points: [fieldPoint(ground(flight.from)), fieldPoint(ground(flight.to))] }));
    end = Math.max(end, flight.end + 0.2);
  });
  // A strikeout's mark sinks in on the battery before it widens.
  if (script.batted == null && Number.isFinite(script.stamp)) end = Math.max(end, script.stamp + 0.5);
  shots.push(shot(Math.min(Math.max(end, (shots[shots.length - 1]?.from ?? 0) + 0.25), script.settle - 0.2), { points: INFIELD }));
  finish();
}
